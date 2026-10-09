import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
process.env.WINDOW_CAPACITY = '25';
const { createApp } = await import('../server/app.js');
const { orderableDates, isoDate } = await import('../src/domain/standards.js');
const { recommendDay } = await import('../src/domain/app.js');

let server, base;
before(async () => { server = createApp().listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => server.close());

const call = async (method, path, body, token, headers = {}) => {
  const res = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
};
const dates = orderableDates(new Date(), 14).map(isoDate);
const profile = { eatingStyle: 'health', preferences: ['savory', 'fresh'], dietary: ['vegetarian'], allergies: ['sesame'] };

async function signIn(mobile = '501234567', firstName = 'Sara') {
  const otp = await call('POST', '/auth/otp', { mobile });
  assert.equal(otp.status, 200);
  const wrong = await call('POST', '/auth/verify', { mobile, code: otp.body.devCode === '000000' ? '111111' : '000000', firstName });
  assert.equal(wrong.status, 400);
  const v = await call('POST', '/auth/verify', { mobile, code: otp.body.devCode, firstName });
  assert.equal(v.status, 200);
  return v.body.token;
}
function dayFor(date, context = 'regular') {
  const r = recommendDay(profile, context);
  return { date, context, recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2' };
}
const address = { building: 'Gate Village, Building 3', unit: 'Level 4, Unit 402', handover: 'reception' };

let token, orderId;

test('rejects a bad mobile and protected routes without a session', async () => {
  assert.equal((await call('POST', '/auth/otp', { mobile: '123' })).status, 400);
  assert.equal((await call('GET', '/me')).status, 401);
});

test('OTP sign-in and profile', async () => {
  token = await signIn();
  const me = await call('GET', '/me', null, token);
  assert.equal(me.body.user.firstName, 'Sara');
  assert.equal(me.body.profile, null);
  assert.equal((await call('PUT', '/me/profile', { ...profile, preferences: [] }, token)).status, 400);
  const p = await call('PUT', '/me/profile', profile, token);
  assert.deepEqual(p.body.profile.allergies, ['sesame']);
});

test('creates an order and prices it on the server', async () => {
  const d1 = { ...dayFor(dates[0]), size: 'large', addons: [{ group: 'pastry', item: 'plainCroissant', qty: 1 }], price: 1 };
  const d2 = dayFor(dates[1], 'busy');
  const r = await call('POST', '/orders', { days: [d1, d2], address, method: 'card', email: 'sara@example.com' }, token);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  orderId = r.body.id;
  assert.equal(r.body.days.length, 2);
  assert.ok(r.body.days[0].price > 30, 'server computed price, ignored client price');
  assert.equal(r.body.total, r.body.days[0].price + r.body.days[1].price);
});

test('blocks tampered compositions, allergens and unsafe add-ons', async () => {
  const d = dayFor(dates[2]);
  const tampered = { ...d, components: d.components.map((c, i) => (i === 0 ? 'beefBacon' : c)) };
  assert.equal((await call('POST', '/orders', { days: [tampered], address }, token)).status, 400);
  const wrongRecipe = { ...d, recipeId: 'sweet.flexible.regular' };
  assert.equal((await call('POST', '/orders', { days: [wrongRecipe], address }, token)).status, 400);
  const badAddon = { ...d, addons: [{ group: 'pastry', item: 'notAThing', qty: 1 }] };
  assert.equal((await call('POST', '/orders', { days: [badAddon], address }, token)).status, 400);
});

test('enforces cutoff and address', async () => {
  const past = isoDate(new Date(Date.now() - 86400000));
  const r = await call('POST', '/orders', { days: [dayFor(past)], address }, token);
  assert.equal(r.status, 400); assert.equal(r.body.error, 'cutoff_passed');
  assert.equal((await call('POST', '/orders', { days: [dayFor(dates[3])], address: { building: '' } }, token)).status, 400);
});

test('edits, feedback gating, cancellation with refund', async () => {
  const e = await call('PATCH', `/orders/${orderId}/days/${dates[0]}`, { size: 'light', window: 'w1' }, token);
  assert.equal(e.status, 200);
  assert.equal(e.body.days[0].cfg.size, 'light');
  assert.equal(e.body.days[0].window, 'w1');
  assert.equal((await call('POST', `/orders/${orderId}/days/${dates[0]}/feedback`, { value: 'Loved it' }, token)).status, 400);
  for (let i = 0; i < 3; i++) await call('POST', '/demo/advance', { orderId, date: dates[0] }, token);
  const f = await call('POST', `/orders/${orderId}/days/${dates[0]}/feedback`, { value: 'Loved it' }, token);
  const locked = await call('PATCH', `/orders/${orderId}/days/${dates[0]}`, { size: 'large' }, token);
  assert.equal(locked.body.error, 'in_production');
  assert.equal(f.body.days[0].feedback, 'Loved it');
  assert.equal(f.body.days[0].stage, 3);
  const c = await call('POST', `/orders/${orderId}/days/${dates[1]}/cancel`, {}, token);
  assert.equal(c.body.days[1].cancelled, true);
  assert.equal(c.body.days[1].refund, c.body.days[1].price);
  assert.equal(c.body.total, c.body.days[0].price);
});

test('another customer cannot read the order', async () => {
  const other = await signIn('509999999', 'Omar');
  assert.equal((await call('GET', `/orders/${orderId}`, null, other)).status, 404);
});

test('business: headcount must match boxes; capacity is checked before payment', async () => {
  assert.equal((await call('POST', '/business/orders', { days: [] }, token)).status, 400);
  await call('POST', '/business/account', { company: 'Alder & Finch', email: 'layla@alder.example' }, token);
  const delivery = { company: 'Alder & Finch', building: 'Index Tower', office: 'Floor 21', contact: 'Omar', mobile: '+971 55 123 4567' };
  const lines = [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 10 }, { recipeId: 'bakery.flexible.regular', size: 'regular', qty: 8 }];
  const specials = [{ dietary: ['vegan'], allergies: [], qty: 2 }];
  const mismatch = await call('POST', '/business/orders', { days: [{ date: dates[4], window: 'w1', people: 21, lines, specials, delivery }] }, token);
  assert.equal(mismatch.body.error, 'headcount_mismatch');
  const ok = await call('POST', '/business/orders', { days: [{ date: dates[4], window: 'w1', people: 20, lines, specials, delivery }] }, token);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.ok(ok.body.days[0].discount > 0, 'volume discount applied');
  const full = await call('POST', '/business/orders', { days: [{ date: dates[4], window: 'w1', people: 20, lines, specials, delivery }] }, token);
  assert.equal(full.body.error, 'window_full');
  const av = await call('GET', `/availability?dates=${dates[4]}`);
  assert.equal(av.body[dates[4]].w1.remaining, 5);
  const unsafe = await call('POST', '/business/quote', { days: [{ date: dates[5], people: 1, lines: [], specials: [{ dietary: ['vegan'], allergies: ['gluten'], qty: 1 }] }] }, token);
  assert.equal(unsafe.body.error, 'special_no_match');
  const inv = await call('GET', `/business/orders/${ok.body.id}/invoice`, null, token);
  assert.match(inv.body, /Tax Invoice/);
});

test('ops: key required, allocation and forward-only status', async () => {
  assert.equal((await call('GET', `/ops/days?date=${dates[4]}`)).status, 401);
  const H = { 'x-ops-key': 'dev-ops-key' };
  const days = await call('GET', `/ops/days?date=${dates[4]}`, null, null, H);
  assert.equal(days.body.length, 1);
  assert.equal(days.body[0].glutenFree, false);
  const a = await call('POST', '/ops/allocate', { date: dates[4] }, null, H);
  assert.equal(a.body.allocations[0].allocated, true);
  assert.equal((await call('POST', `/ops/days/business/${days.body[0].id}/stage`, { stage: 2 }, null, H)).status, 200);
  assert.equal((await call('POST', `/ops/days/business/${days.body[0].id}/stage`, { stage: 1 }, null, H)).status, 400);
});
