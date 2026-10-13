/* Courier View (MB-OPS-001 §6–7, MB-DLV-001 §4, §6, §10) and bakery capacity per delivery window (MB-B2B-001 §9). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
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
const H = { 'x-ops-key': 'dev-ops-key' };
const ops = (method, path, body) => call(method, `/ops${path}`, body, {}, H);
const ok = async (method, path, body) => { const r = await ops(method, path, body); assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body)}`); return r; };
async function signIn(mobile) {
  const otp = await call('POST', '/auth/otp', { mobile });
  const v = await call('POST', '/auth/verify', { mobile, code: otp.body.devCode, firstName: 'Noor' });
  return { token: v.body.token };
}
const dates = orderableDates(new Date(), 14).map(isoDate);
const profile = { eatingStyle: 'flexible', preferences: ['savory'], dietary: [], allergies: [] };
const address = { building: 'Gate Village, Building 3', unit: 'Level 4', handover: 'door', notes: 'Ask for Noor at the desk' };
const QC = { order: true, components: true, size: true, addons: true, allergy: true, swaps: true, freshness: true, packaging: true, labels: true };
async function order(mobile, date, window = 'w2') {
  const a = await signIn(mobile);
  await call('PUT', '/me/profile', profile, a);
  const r = recommendDay(profile, 'regular');
  const o = await call('POST', '/orders', { days: [{ date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window }], address }, a);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  return { o: o.body, id: db.prepare('SELECT id FROM order_days WHERE order_id = ?').get(o.body.id).id };
}
const bakeryOf = id => db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(id).bakery_id;
const dayOf = id => db.prepare('SELECT * FROM order_days WHERE id = ?').get(id);
async function courier(name, routeId) {
  const c = await ops('POST', '/admin/couriers', { name, phone: '0501234567', routeId });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const code = (await ops('POST', `/admin/couriers/${c.body.id}/access-code`)).body.code;
  assert.match(code, /^\d{8}$/);
  return { id: c.body.id, C: { 'x-courier-code': code } };
}
const cr = (method, path, body, C) => call(method, `/courier${path}`, body, {}, C);

test('courier admin: unique route, access code shown once, deactivated courier cannot sign in', async () => {
  const { id, C } = await courier('Omar', 'R10');
  assert.equal((await ops('POST', '/admin/couriers', { name: 'Other', routeId: 'r10' })).status, 409, 'route ids are unique (case-insensitive)');
  const list = (await ops('GET', '/admin/couriers')).body;
  assert.ok(list.some(c => c.id === id && c.hasAccessCode && !('access_hash' in c)));
  assert.equal((await cr('GET', '/me', null, C)).body.routeId, 'R10');
  assert.ok((await ops('GET', `/dashboard?date=${dates[0]}`)).body.couriers.some(c => c.routeId === 'R10'));
  await ok('PUT', `/admin/couriers/${id}`, { active: false });
  assert.equal((await cr('GET', '/me', null, C)).status, 401);
  assert.ok(!(await ops('GET', `/dashboard?date=${dates[0]}`)).body.couriers.some(c => c.routeId === 'R10'));
});

test('courier view: auth, only own route, only what is needed; pickup → out → delivered', async () => {
  const date = dates[0];
  const { o, id } = await order('509400001', date);
  await ops('POST', '/allocate', { date });
  const { C } = await courier('Sam', 'R7');
  const { C: other } = await courier('Lee', 'R8');
  await ok('POST', `/days/personal/${id}/route`, { routeId: 'R7' });

  assert.equal((await cr('GET', `/deliveries?date=${date}`, null, {})).status, 401);
  assert.equal((await cr('GET', `/deliveries?date=${date}`, null, { 'x-courier-code': '12345678' })).status, 401);
  assert.equal((await cr('GET', `/deliveries?date=${date}`, null, other)).body.deliveries.length, 0, 'another route sees nothing');

  const list = (await cr('GET', `/deliveries?date=${date}`, null, C)).body.deliveries;
  assert.equal(list.length, 1);
  const d = list[0];
  assert.equal(d.ref, o.id); assert.equal(d.window, 'w2'); assert.equal(d.boxes, 1); assert.equal(d.specialBoxes, 0);
  assert.equal(d.dropOff.building, address.building); assert.equal(d.dropOff.place, address.unit); assert.equal(d.dropOff.notes, address.notes);
  assert.equal(d.handover, 'Door'); assert.equal(d.contact, null);
  assert.equal(d.pickups.length, 1); assert.ok(d.pickups[0].bakery && d.pickups[0].pickupPoint && d.pickups[0].readyBy);
  const text = JSON.stringify(d);
  assert.ok(!/price|total|email|allerg|Noor"|userId/i.test(text.replace(address.notes, '')), `no unnecessary customer information: ${text}`);

  /* Not Ready yet → no pickup; another route's courier → 403. */
  assert.equal((await cr('POST', `/days/personal/${id}/pickup`, { boxes: 1, specialBoxes: 0 }, C)).body.error, 'not_ready');
  await ok('POST', `/days/personal/${id}/bakery-state`, { state: 'Ready', qc: QC });
  assert.equal((await cr('POST', `/days/personal/${id}/pickup`, { boxes: 1, specialBoxes: 0 }, other)).status, 403);
  assert.equal((await cr('POST', `/days/personal/${id}/out`, null, other)).status, 403);
  assert.equal((await cr('POST', `/days/personal/999999/pickup`, { boxes: 1, specialBoxes: 0 }, C)).status, 404);

  /* Count mismatch blocks the pickup (OPS §7). */
  const bad = await cr('POST', `/days/personal/${id}/pickup`, { boxes: 2, specialBoxes: 0 }, C);
  assert.equal(bad.status, 409); assert.equal(bad.body.error, 'handover_mismatch');
  assert.equal(dayOf(id).delivery_state, null);
  assert.ok(db.prepare("SELECT 1 FROM exceptions WHERE ref = ? AND kind = 'Handover Mismatch'").get(`personal:${id}`));

  assert.equal((await cr('POST', `/days/personal/${id}/pickup`, { boxes: 1, specialBoxes: 0 }, C)).status, 200);
  assert.equal(dayOf(id).delivery_state, 'Picked Up');
  assert.ok(db.prepare('SELECT picked_up_at FROM handovers WHERE day_kind = ? AND day_id = ?').get('personal', id).picked_up_at);
  assert.equal((await cr('POST', `/days/personal/${id}/delivered`, { deliveryPoint: 'your door' }, C)).body.error, 'not_out');
  assert.equal((await cr('POST', `/days/personal/${id}/out`, null, C)).status, 200);
  assert.equal(dayOf(id).stage, 2);
  assert.equal((await cr('POST', `/days/personal/${id}/delivered`, { deliveryPoint: 'the contact person' }, C)).body.error, 'point_required');
  /* Optional photo proof (DLV §10): a bad photo is refused without recording the delivery. */
  assert.equal((await cr('POST', `/days/personal/${id}/delivered`, { deliveryPoint: 'your door', photo: 'not-an-image' }, C)).body.error, 'photo_invalid');
  assert.equal(dayOf(id).stage, 2);
  assert.equal((await ops('GET', `/days/personal/${id}/delivery-photo`)).status, 404);
  const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  assert.equal((await cr('POST', `/days/personal/${id}/delivered`, { deliveryPoint: 'your door', photo }, C)).status, 200);
  const done = dayOf(id);
  assert.equal(done.stage, 3); assert.equal(done.delivery_point, 'your door'); assert.equal(done.recipient_type, 'Designated receiving point');
  assert.equal((await ok('GET', `/days/personal/${id}/delivery-photo`)).body.photo, photo);
  const after = (await cr('GET', `/deliveries?date=${date}`, null, C)).body.deliveries[0];
  assert.equal(after.delivered.recipientType, 'Designated receiving point');
  assert.equal(after.delivered.photo, true);
});

test('courier view: bakery handed over first → courier pickup checks its own count; failed with reason', async () => {
  const date = dates[1];
  const { id } = await order('509400002', date);
  await ops('POST', '/allocate', { date });
  const { C } = await courier('Ali', 'R9');
  await ok('POST', `/days/personal/${id}/route`, { routeId: 'r9' });
  const B = { 'x-bakery-code': (await ops('POST', `/admin/bakeries/${bakeryOf(id)}/access-code`)).body.code };
  await call('POST', '/bakery/plan/confirm', { date }, {}, B);
  assert.equal((await call('POST', `/bakery/days/personal/${id}/state`, { state: 'Ready', qc: QC }, {}, B)).status, 200);
  assert.equal((await call('POST', `/bakery/days/personal/${id}/handover`, { boxes: 1, specialBoxes: 0 }, {}, B)).status, 200);
  assert.equal(dayOf(id).delivery_state, null, 'bakery handover is not the courier pickup');

  assert.equal((await cr('POST', `/days/personal/${id}/pickup`, {}, C)).body.error, 'count_required');
  assert.equal((await cr('POST', `/days/personal/${id}/pickup`, { boxes: 1, specialBoxes: 1 }, C)).body.error, 'handover_mismatch');
  assert.equal(dayOf(id).delivery_state, null);
  assert.equal((await cr('POST', `/days/personal/${id}/pickup`, { boxes: 1, specialBoxes: 0 }, C)).status, 200);
  assert.equal(dayOf(id).delivery_state, 'Picked Up');
  assert.equal((await cr('POST', `/days/personal/${id}/pickup`, { boxes: 1, specialBoxes: 0 }, C)).body.error, 'already_picked_up');

  assert.equal((await cr('POST', `/days/personal/${id}/failed`, { reason: 'Contact unreachable' }, C)).body.error, 'not_out');
  await cr('POST', `/days/personal/${id}/out`, null, C);
  assert.equal((await cr('POST', `/days/personal/${id}/failed`, { reason: 'Lost it' }, C)).body.error, 'reason_invalid');
  assert.equal((await cr('POST', `/days/personal/${id}/failed`, { reason: 'Contact unreachable', note: 'No answer at the door' }, C)).status, 200);
  assert.equal(dayOf(id).delivery_state, 'Failed');
  const attempt = db.prepare('SELECT reason, note FROM delivery_attempts WHERE day_kind = ? AND day_id = ?').get('personal', id);
  assert.deepEqual({ ...attempt }, { reason: 'Contact unreachable', note: 'No answer at the door' });
  const row = (await cr('GET', `/deliveries?date=${date}`, null, C)).body.deliveries[0];
  assert.equal(row.deliveryState, 'Failed'); assert.equal(row.attempts[0].reason, 'Contact unreachable');
  /* Re-attempt after a failure. */
  assert.equal((await cr('POST', `/days/personal/${id}/out`, null, C)).status, 200);
  assert.equal((await cr('POST', `/days/personal/${id}/delivered`, { deliveryPoint: 'Reception' }, C)).status, 200);
});

test('per-window capacity: validated; a bakery with w1 capacity 0 gets no w1 order but does get w2', async () => {
  const A = db.prepare("SELECT id, daily_capacity FROM bakeries WHERE name = 'Partner Bakery A'").get();
  const B = db.prepare("SELECT id FROM bakeries WHERE name = 'Partner Bakery B'").get().id;
  assert.equal((await ops('PUT', `/admin/bakeries/${A.id}`, { windowCapacity: { w1: A.daily_capacity + 1 } })).body.error, 'window_capacity_invalid');
  assert.equal((await ops('PUT', `/admin/bakeries/${A.id}`, { windowCapacity: { w1: -1 } })).body.error, 'window_capacity_invalid');
  assert.equal((await ops('PUT', `/admin/bakeries/${A.id}`, { windowCapacity: { w1: '', w2: '', w3: '' } })).body.windowCapacity, null, 'blank = no limit');
  const saved = await ok('PUT', `/admin/bakeries/${A.id}`, { windowCapacity: { w1: 0, w2: '', w3: 5 } });
  assert.deepEqual(saved.body.windowCapacity, { w1: 0, w3: 5 });
  assert.deepEqual((await ops('PUT', `/admin/bakeries/${A.id}`, { name: 'Partner Bakery A' })).body.windowCapacity, { w1: 0, w3: 5 }, 'kept when not sent');

  const date = dates[2];
  const { id: early } = await order('509400003', date, 'w1');
  const { id: later } = await order('509400004', date, 'w2');
  await ok('POST', '/allocate', { date });
  assert.ok(bakeryOf(early), 'the w1 order is allocated');
  assert.notEqual(bakeryOf(early), A.id, 'not to the bakery with no w1 capacity');
  assert.equal(bakeryOf(later), A.id, 'the w2 order goes to the nearest bakery');
  const plan = (await ops('GET', `/dashboard?date=${date}`)).body.plans.find(p => p.bakeryId === A.id);
  assert.deepEqual(plan.bookedByWindow, { w1: 0, w3: 0 });

  /* Reallocation respects the window too: away from B, but never to A for w1. */
  assert.equal(bakeryOf(early), B);
  const moved = await ok('POST', `/days/personal/${early}/reallocate`);
  assert.notEqual(bakeryOf(early), A.id); assert.notEqual(bakeryOf(early), B);
  assert.ok(moved.body.bakery);

  await ok('PUT', `/admin/bakeries/${A.id}`, { windowCapacity: null });
  assert.equal(db.prepare('SELECT window_capacity FROM bakeries WHERE id = ?').get(A.id).window_capacity, null);
});
