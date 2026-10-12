/* Per-bread add-on prices, Admin-set price levels (MB-BOX-001 §8) and
   preparation standards on the production sheet (MB-PRO-001 §1, §4). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
const { createApp } = await import('../server/app.js');
const { orderableDates, isoDate, PRICE_LEVELS, ADDON_PRICES } = await import('../src/domain/standards.js');
const { recommendDay } = await import('../src/domain/app.js');
const { recipeById, autoPriceLevel, priceLevel } = await import('../src/domain/recipes.js');
const { dayRows } = await import('../server/days.js');

let server, base;
before(async () => { server = createApp().listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => server.close());

const call = async (method, path, body, token, headers = {}) => {
  const res = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: /^[[{]/.test(text) ? JSON.parse(text) : text };
};
const ops = (method, path, body) => call(method, `/ops${path}`, body, null, { 'x-ops-key': 'dev-ops-key' });
const dates = orderableDates(new Date(), 14).map(isoDate);
const profile = { eatingStyle: 'flexible', preferences: ['savory'], dietary: [], allergies: [] };
const day = (date, extra = {}) => { const r = recommendDay(profile, 'regular'); return { date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2', ...extra }; };
const address = { building: 'Gate Village, Building 3', unit: 'Level 4' };
let n = 0;
async function priceOf(date, extra) {
  const mobile = `5099900${String(++n).padStart(2, '0')}`;
  const otp = await call('POST', '/auth/otp', { mobile });
  const token = (await call('POST', '/auth/verify', { mobile, code: otp.body.devCode, firstName: 'Lina' })).body.token;
  await call('PUT', '/me/profile', profile, token);
  const o = await call('POST', '/orders', { days: [day(date, extra)], address }, token);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  return o.body.days[0].price;
}
const bread = (item, unit = 'half', qty = 1) => ({ addons: [{ group: 'bread', item, unit, qty }] });

test('each bread has its own price; changing one changes only that bread', async () => {
  const { pricing, breads } = (await ops('GET', '/admin/pricing')).body;
  assert.ok(breads.some(b => b.id === 'multigrain'), 'Admin lists every bread');
  assert.deepEqual(pricing.addons.bread.whiteSourdough, { half: 12, whole: 20 }, 'defaults to the old shared price');
  const plain = await priceOf(dates[0]);
  const next = structuredClone(pricing);
  next.addons.bread.multigrain = { half: 15, whole: 26 };
  assert.equal((await ops('PUT', '/admin/pricing', next)).status, 200);
  assert.equal(await priceOf(dates[0], bread('multigrain', 'half', 2)), plain + 30, 'multigrain half × 2');
  assert.equal(await priceOf(dates[0], bread('multigrain', 'whole')), plain + 26);
  assert.equal(await priceOf(dates[0], bread('whiteSourdough', 'half', 2)), plain + 24, 'other breads unchanged');
  const bad = structuredClone(next); bad.addons.bread.ciabatta = { half: 0, whole: 20 };
  assert.equal((await ops('PUT', '/admin/pricing', bad)).status, 400);
  await ops('POST', '/admin/pricing/reset');
  assert.equal(ADDON_PRICES.breads.multigrain.half, 12);
});

test('a legacy { half, whole } bread price is accepted and applied to every bread', async () => {
  const { pricing } = (await ops('GET', '/admin/pricing')).body;
  const r = await ops('PUT', '/admin/pricing', { ...pricing, addons: { ...pricing.addons, bread: { half: 13, whole: 22 } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (const b of Object.values(r.body.pricing.addons.bread)) assert.deepEqual(b, { half: 13, whole: 22 });
  assert.equal(ADDON_PRICES.bread.half, 13, '"from" price kept for older screens');
  await ops('POST', '/admin/pricing/reset');
});

test('Admin sets a breakfast price level; Auto falls back to the formula', async () => {
  const d = day(dates[1]);
  const auto = autoPriceLevel(recipeById[d.recipeId].components);
  const set = auto === 'L4' ? 'L1' : 'L4';
  const autoPrice = await priceOf(dates[1]);
  assert.equal(autoPrice, PRICE_LEVELS[auto]);
  const { menu } = (await ops('GET', '/admin/menu')).body;
  assert.equal(menu.breakfasts[d.recipeId].level, '');
  const bad = structuredClone(menu); bad.breakfasts[d.recipeId].level = 'L9';
  const rej = await ops('PUT', '/admin/menu', bad);
  assert.equal(rej.status, 400); assert.match(rej.body.message, /price level/);
  const next = structuredClone(menu); next.breakfasts[d.recipeId].level = set;
  const saved = await ops('PUT', '/admin/menu', next);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.ok(saved.body.changes.some(c => c.includes(`price level Auto → ${set}`)));
  assert.equal(priceLevel(recipeById[d.recipeId]), set);
  assert.equal(await priceOf(dates[1]), PRICE_LEVELS[set]);
  const { levels } = (await ops('GET', '/admin/pricing')).body;
  assert.equal(levels[set].length, Object.values(recipeById).filter(r => priceLevel(r) === set).length, 'Admin price levels reflect it');
  next.breakfasts[d.recipeId].level = '';
  assert.equal((await ops('PUT', '/admin/menu', next)).status, 200);
  assert.equal(await priceOf(dates[1]), autoPrice, 'Auto again');
  await ops('POST', '/admin/menu/reset');
});

test('the production data carries each item’s preparation standard', async () => {
  await priceOf(dates[2], bread('whiteSourdough'));
  const row = dayRows(dates[2]).find(r => r.kind === 'personal');
  const { standards } = row.production[0];
  assert.ok(Array.isArray(standards) && standards.length > 0);
  assert.ok(standards.some(s => s.item === 'White Sourdough' && /Served untoasted/.test(s.note)), 'bread is served untoasted');
  assert.equal(new Set(standards.map(s => s.item)).size, standards.length, 'each item once');
});
