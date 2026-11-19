/* Client feedback from the Requirements Matrix that was still open (Nov 2026). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const { allocate } = await import('../server/allocation.js');
const { orderableDates, isoDate } = await import('../src/domain/standards.js');
const { recommendDay } = await import('../src/domain/app.js');

let server, base;
before(async () => { server = createApp().listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => server.close());
const call = async (method, path, body, token) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
};
const signIn = async mobile => {
  const { devCode } = (await call('POST', '/auth/otp', { mobile })).body;
  return (await call('POST', '/auth/verify', { mobile, code: devCode, firstName: 'Omar' })).body.token;
};
const profile = { eatingStyle: 'flexible', preferences: ['savory'], dietary: [], allergies: [] };
const dates = orderableDates(new Date(), 14).map(isoDate);

test('USR-006: a group order needs at least 2 people', async () => {
  const t = await signIn('500000951');
  const line = { recipeId: 'savory.flexible.regular', size: 'regular', qty: 1 };
  const one = await call('POST', '/business/quote', { days: [{ date: dates[2], people: 1, lines: [line] }] }, t);
  assert.equal(one.status, 400);
  assert.equal(one.body.error, 'people_min');
  const two = await call('POST', '/business/quote', { days: [{ date: dates[2], people: 2, lines: [{ ...line, qty: 2 }] }] }, t);
  assert.equal(two.status, 200, JSON.stringify(two.body));
});

test('FLW-044: the partner bakery is the seller; Morning Box the platform; Studio Nest the platform operator', async () => {
  const t = await signIn('500000952');
  await call('PUT', '/me/profile', profile, t);
  const r = recommendDay(profile, 'regular');
  const date = dates[3];
  const order = await call('POST', '/orders', { days: [{ date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2' }],
    address: { building: 'Gate Village 4', unit: 'Floor 2', area: 'DIFC', handover: 'reception' } }, t);
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const before = await call('GET', `/orders/${order.body.id}/receipt`, null, t);
  assert.match(before.body, /Supplier \/ Seller:<\/b> Partner Bakery assigned by Morning Box/);
  assert.match(before.body, /Platform:<\/b> Morning Box/);
  assert.match(before.body, /Platform Operator:<\/b> Studio Nest L\.L\.C-FZ/);
  assert.match(before.body, /Morning Box Receipt/, 'no tax invoice until the seller is known and has a TRN');

  allocate(date, { final: true });
  const bakeryId = db.prepare('SELECT bakery_id FROM order_days WHERE order_id = ?').get(order.body.id).bakery_id;
  assert.ok(bakeryId, 'allocated');
  db.prepare("UPDATE bakeries SET legal_name = 'Golden Crust Bakery L.L.C', trn = '100123456700003', legal_address = 'Al Quoz 1, Dubai' WHERE id = ?").run(bakeryId);
  const after = await call('GET', `/orders/${order.body.id}/receipt`, null, t);
  assert.match(after.body, /Supplier \/ Seller:<\/b> Golden Crust Bakery L\.L\.C<br>Al Quoz 1, Dubai<br>TRN 100123456700003/);
  assert.match(after.body, /Morning Box Tax Invoice/);
});

test('Admin products: Hummus is a Spread, not Dairy & Cheese', async () => {
  const { COMPONENTS } = await import('../src/domain/library.js');
  assert.equal(COMPONENTS.hummus.category, 'Spreads');
});

test('FLW-023: an address in another part of Dubai is refused even with Area = DIFC', async () => {
  const t = await signIn('500000953');
  await call('PUT', '/me/profile', profile, t);
  const r = recommendDay(profile, 'regular');
  const day = { date: dates[4], context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2' };
  const meydan = await call('POST', '/orders', { days: [day], address: { building: 'Azizi Riviera 46', unit: 'Apt 1203', area: 'DIFC', handover: 'reception' } }, t);
  assert.equal(meydan.status, 400);
  assert.equal(meydan.body.error, 'area_unavailable');
  assert.equal(meydan.body.message, 'Sorry, Morning Box is currently available for delivery in DIFC only. More areas are coming soon!');
  const marina = await call('POST', '/address/check', { address: { building: 'Marina Gate 1, Dubai Marina', unit: '5', area: 'DIFC' } });
  assert.equal(marina.body.error, 'area_unavailable');
  const ok = await call('POST', '/address/check', { address: { building: 'Gate Village Building 3', unit: 'Level 2', area: 'DIFC' } });
  assert.deepEqual(ok.body, { ok: true });
  const plain = await call('POST', '/address/check', { address: { building: 'Al Fattan Currency House', unit: 'Office 401', area: 'DIFC' } });
  assert.deepEqual(plain.body, { ok: true }, 'an ordinary building name is not refused');
  const inactive = await call('POST', '/address/check', { address: { building: 'Boulevard Plaza', unit: '1', area: 'Downtown Dubai' } });
  assert.equal(inactive.body.error, 'area_unavailable', 'an area switched off in Admin');
  const biz = await call('POST', '/business/quote', { days: [{ date: dates[4], people: 2, lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 2 }] }] }, t);
  assert.equal(biz.status, 200);
  await call('POST', '/business/account', { company: 'Acme', email: 'a@acme.ae' }, t);
  const bizOrder = await call('POST', '/business/orders', { company: 'Acme', email: 'a@acme.ae', days: [{ date: dates[4], people: 2, window: 'w2', lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 2 }],
    delivery: { type: 'business', company: 'Acme', building: 'Sobha Hartland Tower', office: '3', area: 'DIFC', contact: 'Omar', mobile: '501234567' } }] }, t);
  assert.equal(bizOrder.body.error, 'area_unavailable', JSON.stringify(bizOrder.body));
});

test('FLW-023: the coordinate check places a geocoded point in its area', async () => {
  const { areaAt } = await import('../server/geo.js');
  assert.equal(areaAt(25.2120, 55.2810), 'DIFC');          // Gate Village
  assert.equal(areaAt(25.1972, 55.2744), 'Downtown Dubai'); // Burj Khalifa
  assert.equal(areaAt(25.1617, 55.3044), 'Meydan One');    // Azizi Riviera
  assert.equal(areaAt(25.0800, 55.1400), null);            // Dubai Marina
});
