/* Pre-launch security fixes: production is the default mode, money is never paid back twice
   or to the wrong tender, bakery requests can't use operations-only fields, sessions are
   stored hashed, malformed input is a clean 400, and limits work per IPv6 network. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const { clientKey } = await import('../server/auth.js');
const { priceBusinessDay } = await import('../src/domain/engine.js');
const { orderableDates, isoDate } = await import('../src/domain/standards.js');
const { recommendDay } = await import('../src/domain/app.js');

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
async function signIn(mobile) {
  const otp = await call('POST', '/auth/otp', { mobile });
  const v = await call('POST', '/auth/verify', { mobile, code: otp.body.devCode, firstName: 'Huda' });
  return { token: v.body.token, userId: v.body.id };
}
const dates = orderableDates(new Date(), 14).map(isoDate);
const profile = { eatingStyle: 'flexible', preferences: ['savory'], dietary: [], allergies: [] };
async function order(a, date) {
  await call('PUT', '/me/profile', profile, a);
  const r = recommendDay(profile, 'regular');
  const o = await call('POST', '/orders', { days: [{ date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2' }], address: { building: 'Gate Village, Building 3', unit: 'Level 4', area: 'DIFC' } }, a);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  return { o: o.body, day: db.prepare('SELECT * FROM order_days WHERE order_id = ?').get(o.body.id) };
}
const orderRow = id => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
const credits = userId => db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM customer_credits WHERE user_id = ?').get(userId).n;

/* ---------- production is the default ---------- */
function startServer(env) {
  const child = spawn(process.execPath, ['server/index.js'], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TZ: 'Asia/Dubai', DB_FILE: ':memory:', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  return { child, output: () => out, exited: new Promise(r => child.on('exit', code => r(code))) };
}

test('without NODE_ENV the server runs as production and refuses to start without a strong OPS_KEY', async () => {
  const s = startServer({});
  assert.equal(await s.exited, 1);
  assert.match(s.output(), /Refusing to start in production/);
  const weak = startServer({ OPS_KEY: 'dev-ops-key' });
  assert.equal(await weak.exited, 1);
});

test('production never returns the sign-in code and refuses the development ops key', async () => {
  const port = 20000 + (process.pid % 20000);
  const s = startServer({ OPS_KEY: 'x'.repeat(32), PORT: String(port), TRUST_PROXY: '1', PAYMENTS_DEMO: '1' });
  try {
    for (let i = 0; i < 50 && !/Morning Box API/.test(s.output()); i++) await new Promise(r => setTimeout(r, 100));
    assert.match(s.output(), /production/);
    /* No WhatsApp provider configured: the code is neither sent nor shown, and nothing pretends otherwise. */
    const otp = await fetch(`http://127.0.0.1:${port}/api/auth/otp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mobile: '509900001' }) });
    const body = await otp.json();
    assert.equal(otp.status, 503);
    assert.equal(body.error, 'whatsapp_unavailable');
    assert.equal(body.devCode, undefined, 'no code in the response');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/ops/meta`, { headers: { 'x-ops-key': 'dev-ops-key' } })).status, 401);
    assert.ok([401, 404].includes((await fetch(`http://127.0.0.1:${port}/api/demo/advance`, { method: 'POST' })).status), 'demo endpoint closed');
  } finally { s.child.kill(); }
});

/* ---------- money ---------- */
test('a morning already refunded by operations is not refunded again when the customer cancels', async () => {
  const a = await signIn('509900002');
  const { o, day } = await order(a, dates[2]);
  const full = await ops('POST', `/days/personal/${day.id}/remedy`, { type: 'Full Refund', reason: 'Bakery could not make it' });
  assert.equal(full.status, 200, JSON.stringify(full.body));
  assert.equal(orderRow(o.id).card_refunded, day.price);
  /* A refunded morning can't be changed... */
  assert.equal((await call('PATCH', `/orders/${o.id}/days/${day.date}`, { size: 'large' }, a)).body.error, 'refunded');
  /* ...and cancelling it pays nothing more back. */
  const c = await call('POST', `/orders/${o.id}/days/${day.date}/cancel`, {}, a);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(orderRow(o.id).card_refunded, day.price, 'card refunded once');
  assert.equal(db.prepare('SELECT refund FROM order_days WHERE id = ?').get(day.id).refund, day.price);
});

test('a morning paid with Morning Box credit gives credit back on cancel, not card money', async () => {
  const a = await signIn('509900003');
  /* Credit for an earlier morning... */
  const first = await order(a, dates[3]);
  assert.equal((await ops('POST', `/days/personal/${first.day.id}/remedy`, { type: 'Credit', amount: first.day.price, reason: 'Goodwill' })).status, 200);
  const userId = first.o.userId ?? db.prepare('SELECT user_id FROM orders WHERE id = ?').get(first.o.id).user_id;
  const before = credits(userId);
  assert.ok(before >= first.day.price);
  /* ...used in full on the next order. */
  const second = await order(a, dates[4]);
  const row = orderRow(second.o.id);
  assert.equal(row.credit_used, second.day.price, 'paid entirely with credit');
  const c = await call('POST', `/orders/${second.o.id}/days/${second.day.date}/cancel`, {}, a);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(orderRow(second.o.id).card_refunded, 0, 'nothing goes to the card, which paid nothing');
  assert.equal(credits(userId), before, 'the credit is back');
  /* Ops credits are limited to the morning's price. */
  assert.equal((await ops('POST', `/days/personal/${first.day.id}/remedy`, { type: 'Credit', amount: 1e9, reason: 'Typo' })).body.error, 'amount_invalid');
});

test('business totals always add up: total = gross − discount, in whole dirhams', () => {
  const model = base => ({ base });
  for (let qty = 1; qty <= 300; qty++) {
    for (const price of [32, 39, 46, 54, 32.5]) {
      const p = priceBusinessDay([{ model: model(price), size: 'regular', qty }], []);
      assert.equal(p.total, p.gross - p.discount, `qty ${qty} @ ${price}`);
      assert.ok(Number.isInteger(p.gross) && Number.isInteger(p.discount));
    }
  }
});

/* ---------- partner and input checks ---------- */
test('a bakery cannot skip plan confirmation by sending operations-only fields', async () => {
  const a = await signIn('509900004');
  const { day } = await order(a, dates[5]);
  await ops('POST', '/allocate', { date: dates[5] });
  const bakeryId = db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(day.id).bakery_id;
  assert.ok(bakeryId, 'allocated');
  const { code } = (await ops('POST', `/admin/bakeries/${bakeryId}/access-code`)).body;
  assert.match(code, /^\d{12}$/);
  const r = await call('POST', `/bakery/days/personal/${day.id}/state`, { state: 'In Preparation', byOps: true }, {}, { 'x-bakery-code': code });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'plan_not_confirmed');
});

test('sessions are stored hashed, never as the token itself', async () => {
  const a = await signIn('509900005');
  assert.equal(db.prepare('SELECT 1 FROM sessions WHERE token = ?').get(a.token), undefined);
  assert.ok(db.prepare('SELECT 1 FROM sessions WHERE token = ?').get(createHash('sha256').update(`session:${a.token}`).digest('hex')));
  assert.equal((await call('GET', '/me', null, a)).status, 200, 'the token still signs in');
});

test('malformed business breakfasts are a 400, not a server error; extras are capped', async () => {
  const a = await signIn('509900006');
  for (const specials of [[null], [{ dietary: 'vegan', qty: 1 }], 'x']) {
    const r = await call('POST', '/business/quote', { days: [{ people: 2, lines: [], specials }] }, a);
    assert.equal(r.status, 400, JSON.stringify({ specials, body: r.body }));
  }
  await call('PUT', '/me/profile', profile, a);
  const r = recommendDay(profile, 'regular');
  const many = Array.from({ length: 11 }, () => ({ group: 'bread', item: 'whiteSourdough', qty: 1 }));
  const o = await call('POST', '/orders', { days: [{ date: dates[6], context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: many, window: 'w2' }], address: { building: 'Gate Village', unit: 'L4', area: 'DIFC' } }, a);
  assert.equal(o.status, 400);
  assert.equal(o.body.error, 'addon_invalid');
});

test('rate limits group IPv6 clients by /64 network', () => {
  assert.equal(clientKey({ ip: '2001:db8:1:2:aaaa::1' }), clientKey({ ip: '2001:db8:1:2:bbbb:cccc:dddd:eeee' }));
  assert.notEqual(clientKey({ ip: '2001:db8:1:2::1' }), clientKey({ ip: '2001:db8:1:3::1' }));
  assert.equal(clientKey({ ip: '::ffff:10.0.0.7' }), '10.0.0.7');
  assert.equal(clientKey({ ip: '10.0.0.7' }), '10.0.0.7');
});

test('credits and refunds for a morning together never exceed what it cost', async () => {
  const a = await signIn('509900061');
  const { day } = await order(a, dates[4]);
  const half = Math.floor(day.price / 2);
  assert.equal((await ops('POST', `/days/personal/${day.id}/remedy`, { type: 'Credit', amount: half, reason: 'Late' })).status, 200);
  assert.equal((await ops('POST', `/days/personal/${day.id}/remedy`, { type: 'Credit', amount: half, reason: 'Late again' })).status, 200);
  const over = await ops('POST', `/days/personal/${day.id}/remedy`, { type: 'Credit', amount: day.price - 2 * half + 1, reason: 'Too much' });
  assert.equal(over.body.error, 'amount_invalid');
});

test('an account without a mobile must give a contact mobile for the delivery', async () => {
  const otp = await call('POST', '/auth/otp', { email: 'nomobile@example.com' });
  const a = { token: (await call('POST', '/auth/verify', { email: 'nomobile@example.com', code: otp.body.devCode, firstName: 'Dana' })).body.token };
  await call('PUT', '/me/profile', profile, a);
  const r = recommendDay(profile, 'regular');
  const body = { days: [{ date: dates[5], context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2' }], address: { building: 'Gate Village, Building 3', unit: 'Level 4', area: 'DIFC' } };
  assert.equal((await call('POST', '/orders', body, a)).body.error, 'mobile_invalid');
  const o = await call('POST', '/orders', { ...body, contactMobile: '050 111 2233' }, a);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.equal(JSON.parse(db.prepare('SELECT address FROM order_days WHERE order_id = ?').get(o.body.id).address).mobile, '+971501112233');
});
