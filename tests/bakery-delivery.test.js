/* The partner bakery delivers its own orders (MB-OPS-001 §6–7, MB-DLV-001 §4, §6, §10) and bakery capacity per delivery window (MB-B2B-001 §9). */
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
async function bakeryCode(id) {
  const code = (await ops('POST', `/admin/bakeries/${bakeryOf(id)}/access-code`)).body.code;
  return { 'x-bakery-code': code };
}
const bk = (method, path, body, B) => call(method, `/bakery${path}`, body, {}, B);

test('no courier: the Courier View, courier admin and route planning are gone', async () => {
  assert.equal((await call('GET', '/courier/me', null, {}, { 'x-courier-code': '123456789012' })).status, 404);
  assert.equal((await ops('GET', '/admin/couriers')).status, 404);
  assert.equal((await ops('POST', '/routes', { date: dates[0], routeId: 'R1' })).status, 404);
  assert.ok(!('couriers' in (await ops('GET', `/dashboard?date=${dates[0]}`)).body));
});

test('bakery delivers: counted dispatch → out for delivery → delivered with point; only its own orders', async () => {
  const date = dates[0];
  const { o, id } = await order('509400001', date);
  await ops('POST', '/allocate', { date });
  const B = await bakeryCode(id);
  const other = db.prepare('SELECT id FROM bakeries WHERE id != ? AND status = ? LIMIT 1').get(bakeryOf(id), 'Active').id;
  const O = { 'x-bakery-code': (await ops('POST', `/admin/bakeries/${other}/access-code`)).body.code };

  const me = (await bk('GET', '/me', null, B)).body;
  assert.ok(me.failureReasons.includes('Contact unreachable'));
  assert.deepEqual(me.points.personal, ['Reception', 'your door', 'you in person']);
  /* The bakery sees where to deliver, but not the customer's name or email. */
  const packed = (await bk('GET', `/plan?date=${date}`, null, B)).body.packing.find(x => x.id === id);
  assert.equal(packed.ref, o.id); assert.equal(packed.name, null);
  assert.deepEqual({ building: packed.dropOff.building, place: packed.dropOff.place, notes: packed.dropOff.notes, handover: packed.dropOff.handover }, { building: address.building, place: address.unit, notes: address.notes, handover: 'Door' });
  const label = (await bk('GET', `/labels?date=${date}`, null, B)).body.labels.find(l => l.ref === o.id);
  assert.equal(label.place, `${address.building}, ${address.unit}`); assert.equal(label.name, null);

  await bk('POST', '/plan/confirm', { date }, B);
  assert.equal((await bk('POST', `/days/personal/${id}/handover`, { boxes: 1, specialBoxes: 0 }, B)).body.error, 'not_ready');
  assert.equal((await bk('POST', `/days/personal/${id}/state`, { state: 'Ready', qc: QC }, B)).status, 200);
  /* Another bakery can't touch it. */
  assert.equal((await bk('POST', `/days/personal/${id}/handover`, { boxes: 1, specialBoxes: 0 }, O)).body.error, 'part_required');
  assert.equal((await bk('POST', `/days/personal/${id}/delivered`, { deliveryPoint: 'your door' }, O)).status, 403);

  /* Count mismatch blocks dispatch (OPS §7). */
  const bad = await bk('POST', `/days/personal/${id}/handover`, { boxes: 2, specialBoxes: 0 }, B);
  assert.equal(bad.status, 409); assert.equal(bad.body.error, 'handover_mismatch');
  assert.equal(dayOf(id).delivery_state, null);
  assert.ok(db.prepare("SELECT 1 FROM exceptions WHERE ref = ? AND kind = 'Handover Mismatch'").get(`personal:${id}`));

  /* No route needed: the counted dispatch takes it straight out for delivery and tells the customer. */
  assert.equal((await bk('POST', `/days/personal/${id}/handover`, { boxes: 1, specialBoxes: 0 }, B)).status, 200);
  const out = dayOf(id);
  assert.equal(out.delivery_state, 'Out for Delivery'); assert.equal(out.stage, 2); assert.ok(out.picked_up_at); assert.equal(out.route_id, null);
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE kind = 'on_the_way' AND ref LIKE ?").get(`${o.id}:%`));

  assert.equal((await bk('POST', `/days/personal/${id}/delivered`, { deliveryPoint: 'the contact person' }, B)).body.error, 'point_required');
  /* Optional photo proof (DLV §10): a bad photo is refused without recording the delivery. */
  assert.equal((await bk('POST', `/days/personal/${id}/delivered`, { deliveryPoint: 'your door', photo: 'not-an-image' }, B)).body.error, 'photo_invalid');
  assert.equal(dayOf(id).stage, 2);
  const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  assert.equal((await bk('POST', `/days/personal/${id}/delivered`, { deliveryPoint: 'your door', photo }, B)).status, 200);
  const done = dayOf(id);
  assert.equal(done.stage, 3); assert.equal(done.delivery_point, 'your door'); assert.equal(done.recipient_type, 'Designated receiving point');
  assert.equal((await ok('GET', `/days/personal/${id}/delivery-photo`)).body.photo, photo);
  assert.equal((await bk('GET', `/plan?date=${date}`, null, B)).body.packing.find(x => x.id === id).delivered.point, 'your door');
});

test('bakery delivery: running late is a Delivery Delay on the bakery; failed with reason, then re-attempt', async () => {
  const date = dates[1];
  const { id } = await order('509400002', date);
  await ops('POST', '/allocate', { date });
  const B = await bakeryCode(id);
  const name = db.prepare('SELECT name FROM bakeries WHERE id = ?').get(bakeryOf(id)).name;
  await bk('POST', '/plan/confirm', { date }, B);
  await bk('POST', `/days/personal/${id}/state`, { state: 'Ready', qc: QC }, B);
  assert.equal((await bk('POST', `/days/personal/${id}/failed`, { reason: 'Contact unreachable' }, B)).body.error, 'not_out');
  await bk('POST', `/days/personal/${id}/handover`, { boxes: 1, specialBoxes: 0 }, B);

  assert.equal((await bk('POST', `/days/personal/${id}/late`, { eta: '' }, B)).body.error, 'eta_required');
  assert.equal((await bk('POST', `/days/personal/${id}/late`, { eta: '9:45 AM', note: 'traffic' }, B)).status, 200);
  assert.equal(dayOf(id).late_note, '9:45 AM');
  const delay = db.prepare("SELECT category, responsible_party FROM exceptions WHERE ref = ? AND kind = 'Delivery Delay'").get(`personal:${id}`);
  assert.deepEqual({ ...delay }, { category: 'Bakery', responsible_party: name });

  assert.equal((await bk('POST', `/days/personal/${id}/failed`, { reason: 'Lost it' }, B)).body.error, 'reason_invalid');
  assert.equal((await bk('POST', `/days/personal/${id}/failed`, { reason: 'Access refused', note: 'Security said no' }, B)).status, 200);
  assert.equal(dayOf(id).delivery_state, 'Failed');
  const attempt = db.prepare('SELECT reason, note FROM delivery_attempts WHERE day_kind = ? AND day_id = ?').get('personal', id);
  assert.deepEqual({ ...attempt }, { reason: 'Access refused', note: 'Security said no' });
  assert.equal(db.prepare("SELECT category FROM exceptions WHERE ref = ? AND kind = 'Delivery Failed'").get(`personal:${id}`).category, 'Bakery');
  assert.equal((await bk('POST', `/days/personal/${id}/out`, null, B)).status, 200);
  assert.equal((await bk('POST', `/days/personal/${id}/delivered`, { deliveryPoint: 'Reception' }, B)).status, 200);
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
