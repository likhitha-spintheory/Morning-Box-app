/* Operations, allergy and partner fixes (MB-OPS-001, MB-BKY-001, MB-DLV-001, MB-PRO-001 §15.1). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const { flagAtRisk } = await import('../server/ops.js');
const { bakeriesFor } = await import('../server/rules.js');
const { orderableDates, isoDate, addDaysIso, dubaiTodayIso } = await import('../src/domain/standards.js');
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
async function signIn(mobile) {
  const otp = await call('POST', '/auth/otp', { mobile });
  const v = await call('POST', '/auth/verify', { mobile, code: otp.body.devCode, firstName: 'Noor' });
  return { token: v.body.token };
}
const dates = orderableDates(new Date(), 14).map(isoDate);
const yesterday = addDaysIso(dubaiTodayIso(), -1);
const profile = { eatingStyle: 'flexible', preferences: ['savory'], dietary: [], allergies: [] };
const address = { building: 'Gate Village, Building 3', unit: 'Level 4' };
const QC = { order: true, components: true, size: true, addons: true, allergy: true, swaps: true, freshness: true, packaging: true, labels: true };
async function order(mobile, date, p = profile) {
  const a = await signIn(mobile);
  await call('PUT', '/me/profile', p, a);
  const r = recommendDay(p, 'regular');
  const o = await call('POST', '/orders', { days: [{ date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2' }], address }, a);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  return { a, o: o.body, id: db.prepare('SELECT id FROM order_days WHERE order_id = ?').get(o.body.id).id };
}
const bakeryOf = id => db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(id).bakery_id;
const ok = async (method, path, body) => { const r = await ops(method, path, body); assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body)}`); return r; };
async function conditionAll(date, except = []) {
  const ids = [];
  for (const b of db.prepare("SELECT id FROM bakeries WHERE status = 'Active'").all().filter(b => !except.includes(b.id))) {
    ids.push((await ops('POST', `/admin/bakeries/${b.id}/conditions`, { date, kind: 'Temporarily Unavailable' })).body.conditions.find(c => c.date === date).id);
  }
  return async () => { for (const c of ids) await ops('DELETE', `/admin/conditions/${c}`); };
}

test('other allergies: special box, label warning, and no preparation or handover until the safety check is resolved', async () => {
  const { o, id } = await order('509300001', dates[0], { ...profile, otherAllergies: 'kiwi' });
  await ops('POST', '/allocate', { date: dates[0] });
  const row = (await ops('GET', `/days?date=${dates[0]}`)).body.find(r => r.kind === 'personal' && r.id === id);
  assert.equal(row.specialBoxes, 1, 'a box with an allergy note is a special box');
  assert.ok(row.production[0].special.includes('Also avoid: kiwi'));
  const label = (await ops('GET', `/labels?date=${dates[0]}`)).body.labels.find(l => l.ref === o.id);
  assert.ok(label.warnings.some(w => /Also avoid: kiwi/.test(w)), 'label carries the free-text allergy');
  assert.equal(row.safetyCheck, true);

  /* Refused for operations and for the bakery, singly and in the batch start (BKY §3). */
  const prep = await ops('POST', `/days/personal/${id}/bakery-state`, { state: 'In Preparation' });
  assert.equal(prep.status, 409); assert.equal(prep.body.error, 'safety_check');
  assert.equal((await ops('POST', `/days/personal/${id}/bakery-state`, { state: 'Ready', qc: QC })).body.error, 'safety_check');
  const code = (await ops('POST', `/admin/bakeries/${bakeryOf(id)}/access-code`)).body.code;
  const B = { 'x-bakery-code': code };
  assert.equal((await call('POST', '/bakery/plan/confirm', { date: dates[0] }, {}, B)).status, 200);
  const start = await call('POST', '/bakery/plan/start', { date: dates[0] }, {}, B);
  assert.equal(start.body.started, 0); assert.ok(start.body.held.includes(o.id));
  assert.equal((await call('POST', `/bakery/days/personal/${id}/state`, { state: 'In Preparation' }, {}, B)).status, 409);

  /* OPS §8: owner, action and resolution are all required. */
  const ex = db.prepare("SELECT id FROM exceptions WHERE ref = ? AND kind = 'Dietary/Allergy Issue' AND resolved = 0").get(`personal:${id}`);
  assert.equal((await ops('POST', `/exceptions/${ex.id}/resolve`, { resolution: 'Bakery confirmed kiwi-free' })).body.error, 'owner_required');
  assert.equal((await ops('POST', `/exceptions/${ex.id}/resolve`, { resolution: 'Bakery confirmed kiwi-free', owner: 'Aisha' })).body.error, 'action_required');
  await ok('POST', `/exceptions/${ex.id}/resolve`, { resolution: 'Bakery confirmed kiwi-free', owner: 'Aisha', action: 'Called the bakery' });

  assert.equal((await call('POST', '/bakery/plan/start', { date: dates[0] }, {}, B)).body.started, 1);
  /* A safety hold blocks Ready too. */
  db.prepare('UPDATE order_days SET safety_hold = 1 WHERE id = ?').run(id);
  assert.equal((await call('POST', `/bakery/days/personal/${id}/state`, { state: 'Ready', qc: QC }, {}, B)).body.error, 'safety_hold');
  db.prepare('UPDATE order_days SET safety_hold = 0 WHERE id = ?').run(id);
  assert.equal((await call('POST', `/bakery/days/personal/${id}/state`, { state: 'Ready', qc: QC }, {}, B)).status, 200);
  await ok('POST', `/days/personal/${id}/route`, { routeId: 'R1' });
  assert.equal((await ops('POST', `/days/personal/${id}/handover`, { boxes: 1, specialBoxes: 0 })).body.error, 'handover_mismatch', 'the allergy box must be counted as special');
  await ok('POST', `/days/personal/${id}/handover`, { boxes: 1, specialBoxes: 1 });

  /* The exception counts on the delivery date, not the day it was raised (OPS §9). */
  const rep = (await ops('GET', `/report?from=${dates[0]}&to=${dates[0]}`)).body;
  assert.ok(rep.days.find(d => d.date === dates[0]).safety >= 1);
});

test('re-allocation clears a stale provisional bakery; started orders are never touched', async () => {
  const date = dates[1];
  const { id: a } = await order('509300002', date);
  const { id: b } = await order('509300003', date);
  await ops('POST', '/allocate', { date });
  const started = bakeryOf(b);
  assert.ok(bakeryOf(a) && started);
  await ok('POST', `/days/personal/${b}/bakery-state`, { state: 'In Preparation' });
  const clear = await conditionAll(date);
  const r = await ops('POST', '/allocate', { date });
  assert.equal(r.body.allocations.find(x => x.id === a).allocated, false);
  assert.equal(bakeryOf(a), null, 'the old bakery no longer sees it');
  assert.equal(bakeryOf(b), started, 'started order stays');
  await clear();
  await ops('POST', '/allocate', { date });
  assert.ok(bakeryOf(a), 'allocated again once a bakery is available');
});

test('a delivery is only marked failed after it went out; re-attempt still works', async () => {
  const date = dates[2];
  const { id } = await order('509300004', date);
  await ops('POST', '/allocate', { date });
  await ok('POST', `/days/personal/${id}/bakery-state`, { state: 'Ready', qc: QC });
  assert.equal((await ops('POST', `/days/personal/${id}/failed`, { reason: 'Contact unreachable' })).body.error, 'not_out');
  await ok('POST', `/days/personal/${id}/route`, { routeId: 'R2' });
  await ok('POST', `/days/personal/${id}/handover`, { boxes: 1, specialBoxes: 0 });
  assert.equal((await ops('POST', `/days/personal/${id}/failed`, { reason: 'Contact unreachable' })).body.error, 'not_out');
  await ok('POST', `/days/personal/${id}/out`);
  await ok('POST', `/days/personal/${id}/failed`, { reason: 'Contact unreachable' });
  await ok('POST', `/days/personal/${id}/out`);
  await ok('POST', `/days/personal/${id}/delivered`, { deliveryPoint: 'Reception' });
});

test('bakery handover is not a courier pickup; pickup is confirmed separately; delays attributed correctly', async () => {
  const date = dates[3];
  const { id } = await order('509300005', date);
  await ops('POST', '/allocate', { date });
  const code = (await ops('POST', `/admin/bakeries/${bakeryOf(id)}/access-code`)).body.code;
  const B = { 'x-bakery-code': code };
  await call('POST', '/bakery/plan/confirm', { date }, {}, B);
  await call('POST', `/bakery/days/personal/${id}/state`, { state: 'Ready', qc: QC }, {}, B);
  await ok('POST', `/days/personal/${id}/route`, { routeId: 'R3' });
  assert.equal((await call('POST', `/bakery/days/personal/${id}/handover`, { boxes: 1, specialBoxes: 0 }, {}, B)).status, 200);
  let raw = db.prepare('SELECT delivery_state, picked_up_at FROM order_days WHERE id = ?').get(id);
  assert.equal(raw.delivery_state, null); assert.equal(raw.picked_up_at, null);
  assert.equal((await ops('POST', `/days/personal/${id}/out`)).body.error, 'not_picked_up');
  await ok('POST', `/days/personal/${id}/pickup`);
  raw = db.prepare('SELECT delivery_state, picked_up_at FROM order_days WHERE id = ?').get(id);
  assert.equal(raw.delivery_state, 'Picked Up'); assert.ok(raw.picked_up_at);
  assert.equal((await ops('POST', `/days/personal/${id}/pickup`)).body.error, 'already_picked_up');
  await ok('POST', `/days/personal/${id}/out`);
  /* Delivered after the window: the bakery was Ready after ready-by → a bakery delay. */
  db.prepare('UPDATE order_days SET date = ? WHERE id = ?').run(yesterday, id);
  await ok('POST', `/days/personal/${id}/delivered`, { deliveryPoint: 'Reception' });
  const late = db.prepare('SELECT kind, category FROM exceptions WHERE ref = ?').get(`personal:${id}`);
  assert.equal(late.kind, 'Pickup Delay'); assert.equal(late.category, 'Bakery');

  /* …and Ready on time → the courier's delay. */
  const { id: id2 } = await order('509300006', date);
  await ops('POST', '/allocate', { date });
  await ok('POST', `/days/personal/${id2}/bakery-state`, { state: 'Ready', qc: QC });
  await ok('POST', `/days/personal/${id2}/route`, { routeId: 'R3' });
  await ok('POST', `/days/personal/${id2}/handover`, { boxes: 1, specialBoxes: 0 });
  await ok('POST', `/days/personal/${id2}/out`);
  const states = JSON.parse(db.prepare('SELECT part_states FROM order_days WHERE id = ?').get(id2).part_states);
  for (const k of Object.keys(states)) states[k].readyAt = new Date(`${yesterday}T06:00:00`).toISOString();
  db.prepare('UPDATE order_days SET date = ?, part_states = ? WHERE id = ?').run(yesterday, JSON.stringify(states), id2);
  await ok('POST', `/days/personal/${id2}/delivered`, { deliveryPoint: 'Reception' });
  assert.equal(db.prepare('SELECT kind FROM exceptions WHERE ref = ?').get(`personal:${id2}`).kind, 'Courier Delay');
});

test('at risk: Pickup Delay only when the bakery was not Ready by ready-by', async () => {
  const date = dates[4];
  const { id: ready } = await order('509300007', date);
  const { id: notReady } = await order('509300008', date);
  await ops('POST', '/allocate', { date });
  await ok('POST', `/days/personal/${ready}/bakery-state`, { state: 'Ready', qc: QC });
  assert.equal(flagAtRisk(new Date(`${date}T09:20:00`)), 2);
  assert.equal(db.prepare('SELECT kind FROM exceptions WHERE ref = ?').get(`personal:${ready}`).kind, 'Courier Delay');
  assert.equal(db.prepare('SELECT kind FROM exceptions WHERE ref = ?').get(`personal:${notReady}`).kind, 'Pickup Delay');
});

test('reconciliation skips refunded Not Fulfilled orders; partner log keeps Unable to Fulfil after reallocation', async () => {
  const date = dates[5];
  /* Reallocated: the original bakery keeps the record (BKY §9). */
  const { id: moved } = await order('509300009', date);
  await ops('POST', '/allocate', { date });
  const first = bakeryOf(moved);
  await ok('POST', `/days/personal/${moved}/bakery-state`, { state: 'Unable to Fulfil', reason: 'Equipment/Operational Issue' });
  assert.notEqual(bakeryOf(moved), first);
  let rep = (await ops('GET', `/report?from=${date}&to=${date}`)).body;
  assert.equal(rep.partners.find(p => p.id === first).unable, 1);
  assert.equal(rep.partners.find(p => p.id === bakeryOf(moved)).unable, 0);

  /* Nobody can take it → refunded, Not Fulfilled; not a reconciliation mismatch once the date has passed. */
  const { id } = await order('509300010', date);
  await ops('POST', '/allocate', { date });
  const clear = await conditionAll(date, [bakeryOf(id)]);
  await ok('POST', `/days/personal/${id}/bakery-state`, { state: 'Unable to Fulfil', reason: 'Capacity Issue' });
  await clear();
  const { o: open, id: openId } = await order('509300011', date);
  const refunded = db.prepare('SELECT order_id, delivery_state, refund FROM order_days WHERE id = ?').get(id);
  assert.equal(refunded.delivery_state, 'Not Fulfilled'); assert.ok(refunded.refund > 0);
  db.prepare('UPDATE order_days SET date = ? WHERE id IN (?, ?)').run(yesterday, id, openId);
  rep = (await ops('GET', `/report?from=${yesterday}&to=${yesterday}`)).body;
  assert.ok(!rep.reconciliation.some(r => r.ref.startsWith(refunded.order_id)), 'refunded Not Fulfilled is closed');
  assert.ok(rep.reconciliation.some(r => r.ref.startsWith(open.id)), 'an undelivered past order is still flagged');
  assert.ok(rep.days.find(d => d.date === yesterday).refundedOrders >= 1);
  assert.ok('repeatBreakfast' in rep.kpis && 'exceptionRate' in rep.kpis && 'averageOrderValueBusiness' in rep.kpis);
  assert.ok(rep.partners.every(p => 'planConfirmation' in p));
});

test('samples: Not Approved removes a product even from "every product"; Active needs an Approved sample', async () => {
  const b = (await ops('POST', '/admin/bakeries', { name: 'Sample Bakery', area: 'DIFC', distanceKm: 40, dailyCapacity: 10 })).body;
  assert.equal(b.products, null);
  const after = (await ops('POST', `/admin/bakeries/${b.id}/samples`, { product: 'plainCroissant', result: 'Not Approved' })).body;
  assert.ok(Array.isArray(after.products) && after.products.length > 10 && !after.products.includes('plainCroissant'));
  await ops('PUT', `/admin/bakeries/${b.id}`, { bakesOwnBread: true, licenceNo: 'DM-777' });
  assert.equal((await ops('POST', `/admin/bakeries/${b.id}/status`, { status: 'Active' })).body.error, 'sample_required');
  await ops('POST', `/admin/bakeries/${b.id}/samples`, { product: 'feta', result: 'Approved' });
  assert.equal((await ops('POST', `/admin/bakeries/${b.id}/status`, { status: 'Active' })).status, 200);
  await ops('POST', `/admin/bakeries/${b.id}/status`, { status: 'Suspended', note: 'test done' });
});

test('an expired licence takes a bakery out of allocation; products & allergens record is listed', async () => {
  const A = db.prepare("SELECT id FROM bakeries WHERE name = 'Partner Bakery A'").get().id;
  db.prepare('UPDATE bakeries SET licence_expiry = ? WHERE id = ?').run(dates[6], A);
  assert.ok(bakeriesFor(dates[6]).some(b => b.id === A), 'valid on its expiry day');
  assert.ok(!bakeriesFor(dates[7]).some(b => b.id === A), 'expired before the delivery date');
  db.prepare('UPDATE bakeries SET licence_expiry = NULL WHERE id = ?').run(A);
  const p = (await ops('GET', '/admin/products')).body;
  const yogurt = p.items.find(i => i.id === 'greekYogurt');
  assert.deepEqual(yogurt.allergens, ['dairy']);
  assert.ok(yogurt.variants.some(v => v.id === 'coconutYogurt' && v.sample));
  assert.ok(p.allergens.length && p.dietary.length);
  assert.equal((await call('GET', '/ops/admin/products')).status, 401);
});
