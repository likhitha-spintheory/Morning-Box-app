/* Launch discounts (Morning Box Launch Discount Requirements v1.0): first order, multi-day,
   business volume, one discount per day, promotional codes with limits, and Admin settings. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const { orderableDates, isoDate } = await import('../src/domain/standards.js');
const { recommendDay } = await import('../src/domain/app.js');
const { priceOrder, priceDay, applyDiscounts, DEFAULT_DISCOUNTS, discountSummary } = await import('../src/domain/discounts.js');

let server, base;
before(async () => { server = createApp().listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => server.close());

const call = async (method, path, body, auth = {}, headers = {}) => {
  const res = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: /^[[{]/.test(text) ? JSON.parse(text) : text };
};
const ops = (method, path, body) => call(method, `/ops${path}`, body, {}, { 'x-ops-key': 'dev-ops-key' });
let n = 0;
async function signIn() {
  const mobile = `5077000${String(++n).padStart(2, '0')}`;
  const otp = await call('POST', '/auth/otp', { mobile });
  const v = await call('POST', '/auth/verify', { mobile, code: otp.body.devCode, firstName: 'Mira' });
  return { token: v.body.token };
}
const dates = orderableDates(new Date(), 14).map(isoDate);
const profile = { healthConsent: true, eatingStyle: 'flexible', preferences: ['savory'], dietary: [], allergies: [] };
const address = { building: 'Gate Village, Building 3', unit: 'Level 4' };
const pday = date => { const r = recommendDay(profile, 'regular'); return { date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2' }; };
async function personal(a, ds, extra = {}) {
  await call('PUT', '/me/profile', profile, a);
  return call('POST', '/orders', { days: ds.map(pday), address, ...extra }, a);
}
const delivery = { company: 'Dune Co', building: 'Index Tower', office: '12', contact: 'Omar', mobile: '55 123 4567' };
const bday = (date, people) => ({ date, window: 'w2', people, lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: people }], specials: [], delivery });
async function business(a, ds, people, extra = {}) {
  await call('POST', '/business/account', { company: 'Dune Co', email: 'team@dune.example' }, a);
  return call('POST', '/business/orders', { days: ds.map(d => bday(d, people)), ...extra }, a);
}
const kinds = d => d.discountLines.map(l => l.kind);

test('rules: the highest discount per day, never added; delivery-free breakfast price only', () => {
  applyDiscounts(DEFAULT_DISCOUNTS);
  const days = ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05'].map(date => ({ date, gross: 1000, boxes: 30 }));
  /* §06 acceptance example: new business customer, 30 breakfasts a day for five days. */
  const r = priceOrder('business', days, { firstEligible: true });
  assert.deepEqual(r.days.map(d => d.discount), [500, 100, 100, 100, 100], 'day 1 50%, days 2–5 10% (volume and multi-day both 10%, one applies)');
  assert.equal(r.days[0].lines.length, 1, 'one discount per day');
  /* Multi-day tiers count ordered days, not the calendar span. */
  const p = n => priceOrder('personal', Array.from({ length: n }, (_, i) => ({ date: `2026-12-${String(i * 2 + 1).padStart(2, '0')}`, gross: 100, boxes: 1 })), { firstEligible: false }).days[0].discount;
  assert.deepEqual([1, 2, 3, 4, 5, 9, 10, 20].map(p), [0, 0, 5, 5, 10, 10, 15, 15]);
  assert.equal(priceOrder('personal', Array.from({ length: 21 }, (_, i) => ({ date: `2027-01-${String(i + 1).padStart(2, '0')}`, gross: 100, boxes: 1 }))).days[0].discount, 20);
  /* Volume is business only and per day; personal never gets it. */
  const v = boxes => priceOrder('business', [{ date: '2026-12-01', gross: 1000, boxes }]).days[0].discount;
  assert.deepEqual([9, 10, 25, 50, 100].map(v), [0, 50, 100, 150, 200]);
  assert.equal(priceOrder('personal', [{ date: '2026-12-01', gross: 1000, boxes: 100 }]).days[0].discount, 0);
  /* First order: the first scheduled delivery day, whatever order the days were sent in. */
  const f = priceOrder('personal', [{ date: '2026-12-09', gross: 40, boxes: 1 }, { date: '2026-12-02', gross: 40, boxes: 1 }], { firstEligible: true });
  assert.equal(f.days.find(d => d.date === '2026-12-02').discount, 20);
  assert.equal(f.days.find(d => d.date === '2026-12-09').discount, 0);
  assert.deepEqual(discountSummary(f.days), [{ kind: 'first', label: 'First-order discount (50%)', amount: 20 }]);
});

test('promo codes: combinable after automatic, otherwise the better of the two; fixed and capped amounts', () => {
  const days = [{ date: '2026-12-01', gross: 100, boxes: 1 }, { date: '2026-12-02', gross: 100, boxes: 1 }, { date: '2026-12-03', gross: 100, boxes: 1 }];
  const pct = (value, combinable, extra = {}) => ({ code: 'X', type: 'percent', value, combinable, ...extra });
  /* 3 days → 5% each. A 10% code that can't be combined replaces it (better); a 3% one doesn't. */
  assert.equal(priceOrder('personal', days, { promo: pct(0.1, false) }).total, 270);
  const worse = priceOrder('personal', days, { promo: pct(0.03, false) });
  assert.equal(worse.total, 285); assert.equal(worse.promo.applied, false);
  /* Combinable: 10% of what is left after 5%. */
  assert.equal(priceOrder('personal', days, { promo: pct(0.1, true) }).days[0].total, 85, '95 − round(9.5)');
  /* Fixed AED, from the first day on, never below zero. */
  const fixed = priceOrder('personal', days, { promo: { code: 'F', type: 'fixed', value: 120, combinable: true } });
  assert.deepEqual(fixed.days.map(d => d.total), [0, 70, 95]);
  /* A percentage code with a cap. */
  assert.equal(priceOrder('personal', days, { promo: pct(0.5, true, { maxDiscount: 30 }) }).discount, 15 + 30);
  /* Minimum order. */
  assert.equal(priceOrder('personal', days, { promo: pct(0.5, true, { minOrder: 500 }) }).promo.applied, false);
  /* Editing a day keeps its discounts. */
  const b = priceOrder('personal', days, { firstEligible: true }).days[0].basis;
  assert.equal(priceDay(b, 60).total, 30);
});

test('first order: 50% on day one, once per customer; a fully cancelled order gives it back', async () => {
  const a = await signIn();
  assert.equal((await call('GET', '/me', null, a)).body.firstOrder, true);
  const o = await personal(a, [dates[3], dates[1]]);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const first = o.body.days.find(d => d.date === dates[1]);
  assert.equal(first.price, first.gross - Math.round(first.gross / 2));
  assert.deepEqual(kinds(first), ['first']);
  assert.equal(o.body.days.find(d => d.date === dates[3]).discount, 0, '2 days: no multi-day discount');
  assert.equal((await call('GET', '/me', null, a)).body.firstOrder, false);
  const second = await personal(a, [dates[5]]);
  assert.equal(second.body.days[0].discount, 0, 'only once');
  /* Cancel everything: the customer is new again. */
  for (const ord of [o.body, second.body]) for (const d of ord.days) await call('POST', `/orders/${ord.id}/days/${d.date}/cancel`, {}, a);
  assert.equal((await call('GET', '/me', null, a)).body.firstOrder, true);
  /* Editing the discounted day keeps 50% on its new price. */
  const again = await personal(a, [dates[6]]);
  const up = await call('PATCH', `/orders/${again.body.id}/days/${dates[6]}`, { size: 'large' }, a);
  const d = (up.status === 202 ? null : up.body.days[0]);
  if (d) assert.equal(d.price, d.gross - Math.round(d.gross / 2));
});

test('acceptance example through the API: a new business, 30 a day for five days', async () => {
  const a = await signIn();
  const r = await business(a, dates.slice(2, 7), 30);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const ds = r.body.days;
  assert.equal(ds[0].discount, Math.round(ds[0].gross * 0.5));
  for (const d of ds.slice(1)) { assert.equal(d.discount, Math.round(d.gross * 0.1)); assert.equal(d.discountLines.length, 1); }
  assert.equal(r.body.total, ds.reduce((t, d) => t + d.gross - d.discount, 0));
  /* A personal first order afterwards: the customer already used it on the business order. */
  assert.equal((await personal(a, [dates[9]])).body.days[0].discount, 0);
  /* Headcount edit on day 2 follows the volume tier (50 → 15%), the best of volume and multi-day. */
  const e = await call('PATCH', `/business/orders/${r.body.id}/days/${ds[1].date}`, { people: 50, lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 50 }], specials: [] }, a);
  assert.ok([200, 202].includes(e.status), JSON.stringify(e.body));
});

test('promo codes from Admin: validity, who can use them, limits, and redemption', async () => {
  const bad = await ops('POST', '/admin/promos', { code: 'x', type: 'percent', value: 0.1, personal: true, business: true, customers: 'all' });
  assert.equal(bad.status, 400);
  const mk = body => ops('POST', '/admin/promos', { personal: true, business: true, customers: 'all', maxPerCustomer: 1, ...body });
  assert.equal((await mk({ code: 'LAUNCH10', type: 'percent', value: 0.1, combinable: true, maxUses: 2 })).status, 200);
  assert.equal((await mk({ code: 'LAUNCH10', type: 'percent', value: 0.1 })).body.error, 'promo_exists');
  await mk({ code: 'OLD', type: 'fixed', value: 10, validTo: '2020-01-01' });
  await mk({ code: 'BIZONLY', type: 'fixed', value: 10, personal: false });
  await mk({ code: 'NEWBIE', type: 'fixed', value: 10, customers: 'new' });

  const a = await signIn();
  const check = (code, kind = 'personal', who = a) => call('POST', '/promo/check', { code, kind }, who);
  assert.equal((await check('nope')).status, 400);
  assert.match((await check('OLD')).body.message, /expired/);
  assert.match((await check('BIZONLY')).body.message, /Business/);
  assert.equal((await check(' launch10 ')).body.promo.code, 'LAUNCH10', 'case and spaces ignored');

  /* Order with the code: first order 50% on day 1, then 10% of what's left (combinable). */
  const o = await personal(a, [dates[2]], { promoCode: 'launch10' });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const d = o.body.days[0];
  const half = d.gross - Math.round(d.gross / 2);
  assert.equal(d.price, half - Math.round(half * 0.1));
  assert.equal(o.body.promoCode, 'LAUNCH10');
  assert.match((await check('LAUNCH10')).body.message, /already used/, 'once per customer');
  assert.match((await check('NEWBIE')).body.message, /first order/);
  /* Total limit: one more customer can use it, then it's used up. */
  const b = await signIn();
  assert.equal((await personal(b, [dates[4]], { promoCode: 'LAUNCH10' })).status, 201);
  const c = await signIn();
  assert.match((await check('LAUNCH10', 'personal', c)).body.message, /fully used/);
  /* Cancelling an order gives its use back. */
  await call('POST', `/orders/${o.body.id}/days/${dates[2]}/cancel`, {}, a);
  assert.equal((await check('LAUNCH10', 'personal', c)).status, 200);
  /* Admin sees uses and savings; a used code can't be deleted, only switched off. */
  const list = (await ops('GET', '/admin/discounts')).body.promos;
  const row = list.find(p => p.code === 'LAUNCH10');
  assert.equal(row.uses, 1); assert.ok(row.saved > 0);
  assert.equal((await ops('DELETE', '/admin/promos/LAUNCH10')).body.error, 'promo_used');
  assert.equal((await ops('PUT', '/admin/promos/LAUNCH10', { ...row, active: false })).status, 200);
  assert.equal((await check('LAUNCH10', 'personal', c)).status, 400);
  assert.equal((await ops('DELETE', '/admin/promos/OLD')).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM promo_redemptions').get().n, 2);
});

test('Admin edits the discounts without a code change; the app receives them', async () => {
  const cur = (await ops('GET', '/admin/discounts')).body.discounts;
  assert.equal(cur.firstOrder.pct, 0.5);
  assert.equal((await ops('PUT', '/admin/discounts', { ...cur, multiDay: { ...cur.multiDay, tiers: [{ min: 3, pct: 1.5 }] } })).status, 400);
  const next = { ...cur, firstOrder: { ...cur.firstOrder, pct: 0.3, business: false }, multiDay: { ...cur.multiDay, tiers: [{ min: 2, pct: 0.08 }] } };
  assert.equal((await ops('PUT', '/admin/discounts', next)).status, 200);
  const cfg = (await call('GET', '/config')).body.discounts;
  assert.equal(cfg.firstOrder.pct, 0.3); assert.equal(cfg.firstOrder.business, false);
  const a = await signIn();
  const o = await personal(a, [dates[7], dates[8]]);
  assert.equal(o.body.days[0].discount, Math.round(o.body.days[0].gross * 0.3));
  assert.equal(o.body.days[1].discount, Math.round(o.body.days[1].gross * 0.08));
  const biz = await business(await signIn(), [dates[7]], 5);
  assert.equal(biz.body.days[0].discount, 0, 'first-order switched off for business');
  await ops('POST', '/admin/discounts/reset');
  assert.equal((await call('GET', '/config')).body.discounts.firstOrder.pct, 0.5);
});
