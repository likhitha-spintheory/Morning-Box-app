import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
process.env.WINDOW_CAPACITY = '25';
const { createApp } = await import('../server/app.js');
const { orderableDates, isoDate } = await import('../src/domain/standards.js');
const { recommendDay } = await import('../src/domain/app.js');
const { db } = await import('../server/db.js');
const { processRefunds } = await import('../server/payments.js');

let server, base;
before(async () => { server = createApp().listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => server.close());

/* ---------- A fake Stripe: records calls, sessions are paid when `paid` says so ---------- */
const realFetch = globalThis.fetch;
let stripeCalls = [];
const sessions = new Map();
let paid = new Set();
let n = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.stripe.com/')) return realFetch(url, init);
  const path = u.slice('https://api.stripe.com/v1'.length);
  const params = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {};
  stripeCalls.push({ method: init.method, path, params, headers: init.headers });
  const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (init.method === 'POST' && path === '/checkout/sessions') {
    const s = { id: `cs_${++n}`, url: `https://checkout.stripe.test/${n}`, client_reference_id: params.client_reference_id, amount_total: Number(params['line_items[0][price_data][unit_amount]']), status: 'open', payment_status: 'unpaid', payment_intent: `pi_${n}` };
    sessions.set(s.id, s);
    return ok(s);
  }
  if (init.method === 'GET' && path.startsWith('/checkout/sessions/')) {
    const s = sessions.get(decodeURIComponent(path.split('/').pop()));
    return ok(paid.has(s.id) ? { ...s, status: 'complete', payment_status: 'paid' } : s);
  }
  if (init.method === 'POST' && path === '/refunds') return ok({ id: `re_${++n}`, amount: Number(params.amount) });
  return new Response('{"error":{"message":"unexpected"}}', { status: 400 });
};
beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  stripeCalls = [];
});
after(() => { globalThis.fetch = realFetch; delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_WEBHOOK_SECRET; });

const call = async (method, path, body, token, headers = {}) => {
  const res = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const text = await res.text();
  return { status: res.status, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
};
const dates = orderableDates(new Date(), 14).map(isoDate);
const profile = { eatingStyle: 'health', preferences: ['savory', 'fresh'], dietary: ['vegetarian'], allergies: ['sesame'] };
const address = { building: 'Gate Village, Building 3', unit: 'Level 4, Unit 402', handover: 'reception' };
function dayFor(date, size = 'regular') {
  const r = recommendDay(profile, 'regular');
  return { date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size, addons: [], window: 'w2' };
}
async function signIn(mobile, firstName) {
  const otp = await call('POST', '/auth/otp', { mobile });
  const token = (await call('POST', '/auth/verify', { mobile, code: otp.body.devCode, firstName })).body.token;
  await call('PUT', '/me/profile', profile, token);
  return token;
}
const sessionFor = checkoutId => [...sessions.values()].find(s => s.client_reference_id === checkoutId);

let token, orderId;

test('an order is only created once the payment is confirmed', async () => {
  token = await signIn('502220001', 'Huda');
  const r = await call('POST', '/orders', { days: [dayFor(dates[0]), dayFor(dates[1])], address, email: 'huda@example.com', idempotencyKey: 'pay-test-0001' }, token);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const { checkout } = r.body;
  assert.match(checkout.url, /^https:\/\/checkout\.stripe\.test\//);
  const create = stripeCalls.find(c => c.path === '/checkout/sessions');
  assert.equal(create.params['line_items[0][price_data][currency]'], 'aed');
  assert.equal(create.params.customer_email, 'huda@example.com');
  assert.match(create.params.success_url, new RegExp(`/#/pay/${checkout.id}$`));
  assert.equal((await call('GET', '/orders', null, token)).body.length, 0, 'nothing ordered before payment');

  /* A double tap returns the same payment page, not a second one. */
  const again = await call('POST', '/orders', { days: [dayFor(dates[0]), dayFor(dates[1])], address, email: 'huda@example.com', idempotencyKey: 'pay-test-0001' }, token);
  assert.equal(again.body.checkout.id, checkout.id);

  /* Back from Stripe before paying: still open. */
  assert.equal((await call('POST', `/payments/checkouts/${checkout.id}/confirm`, {}, token)).body.status, 'open');
  paid.add(sessionFor(checkout.id).id);
  const done = await call('POST', `/payments/checkouts/${checkout.id}/confirm`, {}, token);
  assert.equal(done.body.status, 'done');
  orderId = done.body.result;
  const order = (await call('GET', `/orders/${orderId}`, null, token)).body;
  assert.equal(order.days.length, 2);
  assert.equal(db.prepare('SELECT payment_status, payment_ref FROM orders WHERE id = ?').get(orderId).payment_status, 'captured');
  assert.equal(db.prepare('SELECT provider_ref FROM payments WHERE order_id = ?').get(orderId).provider_ref, sessionFor(checkout.id).payment_intent);
  /* Confirming twice (webhook + app) never creates a second order. */
  assert.equal((await call('POST', `/payments/checkouts/${checkout.id}/confirm`, {}, token)).body.result, orderId);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id = (SELECT user_id FROM orders WHERE id = ?)').get(orderId).n, 1);
  /* Another customer can't see someone else's payment. */
  const other = await signIn('502220002', 'Rami');
  assert.equal((await call('GET', `/payments/checkouts/${checkout.id}`, null, other)).status, 404);
});

test('cancelling a morning refunds the card through Stripe', async () => {
  const c = await call('POST', `/orders/${orderId}/days/${dates[1]}/cancel`, {}, token);
  const price = c.body.days.find(d => d.date === dates[1]).price;
  await processRefunds();
  const refund = stripeCalls.find(x => x.path === '/refunds');
  assert.ok(refund, 'refund sent');
  assert.equal(refund.params.payment_intent, db.prepare('SELECT provider_ref FROM payments WHERE order_id = ?').get(orderId).provider_ref);
  assert.equal(Number(refund.params.amount), Math.round(price * 100));
  const row = db.prepare('SELECT * FROM refunds WHERE order_id = ?').get(orderId);
  assert.equal(row.status, 'done');
});

test('a change that costs more is paid before it is applied', async () => {
  const before = (await call('GET', `/orders/${orderId}`, null, token)).body.days[0];
  const r = await call('PATCH', `/orders/${orderId}/days/${dates[0]}`, { size: 'large' }, token);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal((await call('GET', `/orders/${orderId}`, null, token)).body.days[0].cfg.size, before.cfg.size, 'not changed before payment');
  paid.add(sessionFor(r.body.checkout.id).id);
  const done = await call('POST', `/payments/checkouts/${r.body.checkout.id}/confirm`, {}, token);
  assert.equal(done.body.status, 'done');
  const after = (await call('GET', `/orders/${orderId}`, null, token)).body.days[0];
  assert.equal(after.cfg.size, 'large');
  assert.equal(Math.round(r.body.checkout.amount * 100), Math.round((after.price - before.price) * 100));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments WHERE order_id = ?').get(orderId).n, 2);
  /* A cheaper change goes straight through and refunds the difference. */
  const cheaper = await call('PATCH', `/orders/${orderId}/days/${dates[0]}`, { size: 'regular' }, token);
  assert.equal(cheaper.status, 200);
  assert.ok(db.prepare("SELECT 1 FROM refunds WHERE order_id = ? AND reason LIKE 'price change%'").get(orderId));
});

test('a payment that can no longer be used is refunded in full', async () => {
  const r = await call('POST', '/orders', { days: [dayFor(dates[2])], address }, token);
  assert.equal(r.status, 202);
  /* Simulate the morning closing while the customer was on the payment page. */
  db.prepare('UPDATE checkouts SET payload = ? WHERE id = ?').run(JSON.stringify({ body: { days: [dayFor(isoDate(new Date(Date.now() - 86400000)))], address }, key: null }), r.body.checkout.id);
  paid.add(sessionFor(r.body.checkout.id).id);
  const done = await call('POST', `/payments/checkouts/${r.body.checkout.id}/confirm`, {}, token);
  assert.equal(done.body.status, 'failed');
  assert.ok(done.body.error);
  await processRefunds();
  const refund = db.prepare('SELECT * FROM refunds WHERE order_id = ?').get(r.body.checkout.id);
  assert.equal(refund.status, 'done');
  assert.equal(Math.round(refund.amount * 100), sessionFor(r.body.checkout.id).amount_total);
});

test('the Stripe webhook needs a valid signature and completes the payment', async () => {
  const r = await call('POST', '/orders', { days: [dayFor(dates[3])], address }, token);
  const s = sessionFor(r.body.checkout.id);
  const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: { ...s, status: 'complete', payment_status: 'paid' } } });
  const t = Math.floor(Date.now() / 1000);
  const sign = secret => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${event}`).digest('hex')}`;
  assert.equal((await call('POST', '/payments/webhook', event, null, { 'stripe-signature': sign('wrong') })).status, 400);
  const ok = await call('POST', '/payments/webhook', event, null, { 'stripe-signature': sign('whsec_test') });
  assert.equal(ok.status, 200);
  const c = (await call('GET', `/payments/checkouts/${r.body.checkout.id}`, null, token)).body;
  assert.equal(c.status, 'done');
  assert.ok((await call('GET', `/orders/${c.result}`, null, token)).body.id);
});

test('business orders are paid first and cancellations refunded to the card', async () => {
  const u = await signIn('502220003', 'Omar');
  await call('POST', '/business/account', { company: 'Acme', email: 'ops@acme.example' }, u);
  const delivery = { company: 'Acme', building: 'Index Tower', office: '21', contact: 'Omar', mobile: '55 123 4567' };
  const day = date => ({ date, window: 'w2', people: 6, delivery, lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 4 }], specials: [{ dietary: ['vegan'], allergies: [], qty: 2 }] });
  const r = await call('POST', '/business/orders', { days: [day(dates[4]), day(dates[5])] }, u);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  paid.add(sessionFor(r.body.checkout.id).id);
  const done = await call('POST', `/payments/checkouts/${r.body.checkout.id}/confirm`, {}, u);
  assert.equal(done.body.status, 'done');
  const id = done.body.result;
  const cancelled = await call('POST', `/business/orders/${id}/cancel`, {}, u);
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  await processRefunds();
  const sent = stripeCalls.filter(x => x.path === '/refunds').reduce((t, x) => t + Number(x.params.amount), 0);
  assert.equal(sent, Math.round(r.body.checkout.amount * 100));
});

test('without a Stripe key development pays instantly (demo)', async () => {
  delete process.env.STRIPE_SECRET_KEY;
  const r = await call('POST', '/orders', { days: [dayFor(dates[6])], address }, token);
  assert.equal(r.status, 201);
  assert.match(r.body.id, /^MB-/);
});
