/* Availability follows production capacity (MB-DLV-001 §8); a failed part of a split business
   order moves on its own or is refunded pro-rata (MB-OPS-001 §4, MB-DLV-001 §11, MB-B2B-001 §9). */
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
  const v = await call('POST', '/auth/verify', { mobile, code: otp.body.devCode, firstName: 'Mira' });
  return { token: v.body.token };
}
const dates = orderableDates(new Date(), 14).map(isoDate);
const profile = { eatingStyle: 'flexible', preferences: ['savory'], dietary: [], allergies: [] };
const address = { building: 'Gate Village, Building 3', unit: 'Level 4' };
async function order(mobile, date) {
  const a = await signIn(mobile);
  await call('PUT', '/me/profile', profile, a);
  const r = recommendDay(profile, 'regular');
  const o = await call('POST', '/orders', { days: [{ date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2' }], address }, a);
  return { a, o: o.body, status: o.status, id: o.status === 201 ? db.prepare('SELECT id FROM order_days WHERE order_id = ?').get(o.body.id).id : null };
}
const bakery = name => db.prepare('SELECT id FROM bakeries WHERE name = ?').get(name).id;
const condition = async (id, date, capacity) => (await ops('POST', `/admin/bakeries/${id}/conditions`, { date, kind: 'Reduced Capacity', capacity })).body.conditions.find(c => c.date === date).id;

/* 10 boxes: 8 savoury + 2 tree-nut-free (only A makes those). A and B have room for 6 each → split A (2 special + 4) / B (4). */
async function splitOrder(mobile, date) {
  const u = await signIn(mobile);
  await call('POST', '/business/account', { company: 'Split Co', email: `ops${mobile}@split.example` }, u);
  const o = await call('POST', '/business/orders', { days: [{ date, window: 'w2', people: 10,
    lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 8 }], specials: [{ dietary: [], allergies: ['treenut'], qty: 2 }],
    delivery: { company: 'Split Co', building: 'Index Tower', office: '21', contact: 'Omar', mobile: '55 123 4567' } }] }, u);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  await ok('POST', '/allocate', { date });
  const d = db.prepare('SELECT * FROM business_days WHERE order_id = ?').get(o.body.id);
  return { u, o: o.body, id: d.id };
}
const dayOf = id => { const d = db.prepare('SELECT * FROM business_days WHERE id = ?').get(id); return { ...d, allocation: JSON.parse(d.allocation || 'null'), states: JSON.parse(d.part_states || '{}') }; };

test('a window is unavailable when every bakery is at capacity, though couriers still have room (DLV §8)', async () => {
  const date = dates[3];
  const conds = [];
  for (const name of ['Partner Bakery A', 'Partner Bakery B', 'Partner Bakery C']) conds.push(await condition(bakery(name), date, 1));
  assert.equal((await call('GET', `/availability?dates=${date}`)).body[date].w2.remaining, 3, 'production capacity is the limit');
  assert.equal((await order('509400001', date)).status, 201);
  assert.equal((await order('509400002', date)).status, 201);
  let av = (await call('GET', `/availability?dates=${date}`)).body[date];
  assert.equal(av.w2.remaining, 1); assert.equal(av.w2.available, true);
  assert.equal((await order('509400003', date)).status, 201);
  av = (await call('GET', `/availability?dates=${date}`)).body[date];
  assert.equal(av.w2.available, false, 'no bakery has room left');
  assert.equal(av.w2.remaining, 0);
  assert.equal(av.w1.available, false, 'daily bakery capacity is shared by every window');
  assert.equal((await order('509400004', date)).o.error, 'capacity_full', 'checkout agrees with availability');
  for (const c of conds) await ops('DELETE', `/admin/conditions/${c}`);
  assert.equal((await call('GET', `/availability?dates=${date}`)).body[date].w2.remaining, 120 - 3, 'delivery capacity again once bakeries have room');
});

test('a bakery that can’t fulfil its part of a split order: only that part moves to another bakery', async () => {
  const date = dates[4];
  const [A, B, C] = ['Partner Bakery A', 'Partner Bakery B', 'Partner Bakery C'].map(bakery);
  const conds = [await condition(A, date, 6), await condition(B, date, 6), await condition(C, date, 0)];
  const { id } = await splitOrder('509400010', date);
  await ops('DELETE', `/admin/conditions/${conds.pop()}`);   // C has room again
  const before = dayOf(id);
  assert.equal(before.allocation.length, 2);
  const aPart = before.allocation.find(p => p.bakeryId === A);
  const bPart = before.allocation.find(p => p.bakeryId === B);
  await ok('POST', `/days/business/${id}/bakery-state`, { state: 'In Preparation', bakeryId: A });
  await ok('POST', `/days/business/${id}/bakery-state`, { state: 'Unable to Fulfil', reason: 'Equipment/Operational Issue', bakeryId: B });
  const after = dayOf(id);
  assert.deepEqual(after.allocation.find(p => p.bakeryId === A), aPart, 'A’s part is untouched');
  assert.equal(after.states[A].state, 'In Preparation', 'A’s progress is kept');
  assert.ok(!after.allocation.some(p => p.bakeryId === B), 'B no longer has a part');
  const cPart = after.allocation.find(p => p.bakeryId === C);
  assert.equal(cPart.boxes, bPart.boxes, 'B’s boxes went to C');
  assert.deepEqual(cPart.items, bPart.items);
  assert.equal(after.delivery_state, null);
  assert.equal(after.refund || 0, 0, 'nothing refunded');
  assert.equal(after.bakery_state, 'In Preparation');
  assert.ok(db.prepare("SELECT 1 FROM bakery_events WHERE bakery_id = ? AND day_id = ? AND kind = 'Unable to Fulfil'").get(B, id), 'B keeps the record');
  for (const c of conds) await ops('DELETE', `/admin/conditions/${c}`);
});

test('when no bakery can take the failed part: partial refund of that part only; the rest proceeds', async () => {
  const date = dates[5];
  const [A, B, C] = ['Partner Bakery A', 'Partner Bakery B', 'Partner Bakery C'].map(bakery);
  const conds = [await condition(A, date, 6), await condition(B, date, 6), await condition(C, date, 0)];
  const { u, o, id } = await splitOrder('509400020', date);
  const before = dayOf(id);
  const aPart = before.allocation.find(p => p.bakeryId === A);
  const bPart = before.allocation.find(p => p.bakeryId === B);
  await ok('POST', `/days/business/${id}/bakery-state`, { state: 'Unable to Fulfil', reason: 'Capacity Issue', bakeryId: B });
  const after = dayOf(id);
  assert.deepEqual(after.allocation, [aPart], 'A still makes its part');
  assert.notEqual(after.delivery_state, 'Not Fulfilled', 'the delivery goes ahead');
  const expected = Math.round(before.total * bPart.boxes / before.people * 100) / 100;
  const rec = db.prepare("SELECT * FROM service_recovery WHERE day_kind = 'business' AND day_id = ?").all(id);
  assert.equal(rec.length, 1); assert.equal(rec[0].type, 'Partial Refund'); assert.equal(rec[0].amount, expected);
  assert.ok((await call('GET', '/me/notifications', null, u)).body.some(n => n.kind === 'refund'), 'customer told');
  /* A then fails too: nothing can be made → Full Refund of the rest and Not Fulfilled. */
  await ok('POST', `/days/business/${id}/bakery-state`, { state: 'Unable to Fulfil', reason: 'Capacity Issue', bakeryId: A });
  const last = dayOf(id);
  assert.equal(last.delivery_state, 'Not Fulfilled');
  assert.equal(db.prepare("SELECT SUM(amount) AS n FROM service_recovery WHERE day_kind = 'business' AND day_id = ?").get(id).n, before.total, 'refunded in full overall');
  void o;
  for (const c of conds) await ops('DELETE', `/admin/conditions/${c}`);
});

test('personal orders: unable to fulfil still moves the whole box, or refunds it in full', async () => {
  const date = dates[6];
  const { a, o, id } = await order('509400030', date);
  await ok('POST', '/allocate', { date });
  const first = db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(id).bakery_id;
  await ok('POST', `/days/personal/${id}/bakery-state`, { state: 'Unable to Fulfil', reason: 'Equipment/Operational Issue' });
  const moved = db.prepare('SELECT bakery_id, bakery_state, delivery_state, refund FROM order_days WHERE id = ?').get(id);
  assert.notEqual(moved.bakery_id, first); assert.equal(moved.bakery_state, null); assert.equal(moved.refund || 0, 0);
  const conds = [];
  for (const b of db.prepare("SELECT id FROM bakeries WHERE status = 'Active' AND id != ?").all(moved.bakery_id)) conds.push((await ops('POST', `/admin/bakeries/${b.id}/conditions`, { date, kind: 'Temporarily Unavailable' })).body.conditions.find(c => c.date === date).id);
  await ok('POST', `/days/personal/${id}/bakery-state`, { state: 'Unable to Fulfil', reason: 'Capacity Issue' });
  const day = (await call('GET', `/orders/${o.id}`, null, a)).body.days[0];
  assert.equal(day.problem, 'Not Fulfilled');
  assert.equal(day.recoveryRefund, o.days[0].price);
  for (const c of conds) await ops('DELETE', `/admin/conditions/${c}`);
});
