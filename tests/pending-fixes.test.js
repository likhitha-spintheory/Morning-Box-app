/* Pending-list fixes: nearest bakery per delivery area, editing a booked morning's address,
   automatic reallocation on a bakery condition, and no QC / plan-confirm shortcuts for operations. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
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
const profile = { eatingStyle: 'flexible', preferences: ['savory'], dietary: [], allergies: [] };
async function order(mobile, date, address = { building: 'Gate Village, Building 3', unit: 'Level 4', area: 'DIFC' }) {
  const a = await signIn(mobile);
  await call('PUT', '/me/profile', profile, a);
  const r = recommendDay(profile, 'regular');
  const o = await call('POST', '/orders', { days: [{ date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2' }], address }, a);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  return { a, o: o.body, id: db.prepare('SELECT id FROM order_days WHERE order_id = ?').get(o.body.id).id };
}
const bakeryOf = id => db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(id).bakery_id;

test('the nearest bakery is chosen for the delivery area, not always from DIFC', async () => {
  const active = db.prepare("SELECT id FROM bakeries WHERE status = 'Active' ORDER BY distance_km").all();
  const nearDifc = active[0].id, far = active[active.length - 1].id;
  assert.notEqual(nearDifc, far);
  assert.equal((await ops('PUT', '/admin/areas', { active: ['DIFC', 'Downtown Dubai'] })).status, 200);
  try {
  const put = await ops('PUT', `/admin/bakeries/${far}`, { areaDistances: { 'Downtown Dubai': 0.2 } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.areaDistances['Downtown Dubai'], 0.2);
  assert.equal((await ops('PUT', `/admin/bakeries/${far}`, { areaDistances: { 'Downtown Dubai': 500 } })).body.error, 'distance_invalid');

  const difc = await order('509400001', dates[1]);
  const downtown = await order('509400002', dates[1], { building: 'Boulevard Plaza', unit: 'Tower 1', area: 'Downtown Dubai' });
  await ops('POST', '/allocate', { date: dates[1] });
  assert.equal(bakeryOf(difc.id), nearDifc, 'DIFC delivery → nearest bakery to DIFC');
  assert.equal(bakeryOf(downtown.id), far, 'Downtown delivery → nearest bakery to Downtown');
  } finally { await ops('PUT', '/admin/areas', { active: ['DIFC'] }); }
});

test('a booked morning’s delivery address can be changed before cutoff', async () => {
  const { a, o } = await order('509400003', dates[2]);
  const r = await call('PATCH', `/orders/${o.id}/days/${dates[2]}`, { address: { building: 'Index Tower', unit: 'Office 1203', handover: 'door', notes: 'Ring twice' } }, a);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const day = r.body.days.find(d => d.date === dates[2]);
  assert.equal(day.address.building, 'Index Tower');
  assert.equal(day.address.handover, 'door');
  assert.ok(day.events.some(e => /delivery address to Index Tower/.test(e.message)), 'the change is in the order activity');
  assert.equal((await call('PATCH', `/orders/${o.id}/days/${dates[2]}`, { address: { building: '', unit: '' } }, a)).body.error, 'address_invalid');
});

test('a bakery condition moves its affected orders straight away; past dates are refused', async () => {
  const { id } = await order('509400004', dates[3]);
  await ops('POST', '/allocate', { date: dates[3] });
  const first = bakeryOf(id);
  const c = await ops('POST', `/admin/bakeries/${first}/conditions`, { date: dates[3], kind: 'Temporarily Unavailable' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.ok(bakeryOf(id) && bakeryOf(id) !== first, 'moved to another bakery without a manual re-run');
  const yesterday = addDaysIso(dubaiTodayIso(), -1);
  assert.equal((await ops('POST', `/admin/bakeries/${first}/conditions`, { date: yesterday, kind: 'Temporarily Unavailable' })).body.error, 'date_past');
  await ops('DELETE', `/admin/conditions/${c.body.conditions.find(x => x.date === dates[3]).id}`);
});

test('operations can’t confirm a plan for the bakery or skip the final check', async () => {
  const { id } = await order('509400005', dates[4]);
  await ops('POST', '/allocate', { date: dates[4] });
  assert.equal((await ops('POST', `/plans/${bakeryOf(id)}/${dates[4]}/confirm`)).status, 404, 'no confirm-for-bakery');
  assert.equal((await ops('POST', `/days/personal/${id}/bakery-state`, { state: 'In Preparation' })).status, 200);
  assert.equal((await ops('POST', `/days/personal/${id}/bakery-state`, { state: 'Ready', qcPassed: true })).body.error, 'qc_required', 'blanket QC pass refused');
});

test('reconciliation: mismatches go to the exception queue; a delivered morning with proof is Completed with its financial record', async () => {
  const { reconcileDate } = await import('../server/reconcile.js');
  const { demoStep } = await import('../server/fulfilment.js');
  const { id } = await order('509400006', dates[5]);
  await ops('POST', '/allocate', { date: dates[5] });
  reconcileDate(dates[5]);
  let row = db.prepare('SELECT * FROM order_days WHERE id = ?').get(id);
  assert.equal(row.reconcile_status, 'Mismatch', 'not delivered yet → mismatch');
  const ex = db.prepare("SELECT * FROM exceptions WHERE ref = ? AND kind = 'Reconciliation Mismatch' AND resolved = 0").get(`personal:${id}`);
  assert.ok(ex, 'mismatch is in the exception queue');
  assert.equal(ex.owner, 'Operations');

  for (let i = 0; i < 3; i++) demoStep('personal', id);
  reconcileDate(dates[5]);
  row = db.prepare('SELECT * FROM order_days WHERE id = ?').get(id);
  assert.equal(row.reconcile_status, 'Reconciled');
  assert.ok(row.completed_at, 'Completed after delivery with proof of delivery');
  const fin = JSON.parse(row.finance);
  assert.equal(fin.payment, row.price);
  assert.ok(fin.bakeryPayable > 0 && fin.margin <= fin.payment);
  assert.equal((await ops('POST', '/reconcile', { date: dates[5] })).body.error, 'date_not_over', 'only past mornings via the API');
});

test('dashboard: no courier route is needed — after the cutoff a confirmed, on-time order stays On Track', async () => {
  const { health } = await import('../server/days.js');
  const { cutoffFor } = await import('../src/domain/standards.js');
  const { id } = await order('509400007', dates[6]);
  await ops('POST', '/allocate', { date: dates[6] });
  const { dayRows } = await import('../server/days.js');
  const r = dayRows(dates[6]).find(x => x.kind === 'personal' && x.id === id);
  const afterCutoff = new Date(cutoffFor(dates[6]).getTime() + 60e3);
  db.prepare("INSERT INTO bakery_plans (bakery_id, date, status) VALUES (?, ?, 'Confirmed') ON CONFLICT(bakery_id, date) DO UPDATE SET status = 'Confirmed'").run(r.bakeryId, dates[6]);
  assert.equal(health({ ...r, routeId: null }, afterCutoff), 'On Track');
});

test('a new partner bakery can’t go Active until the onboarding gate is complete (Master Plan §6.1)', async () => {
  const b = (await ops('POST', '/admin/bakeries', { name: 'Gate Bakery', area: 'DIFC', distanceKm: 3, dailyCapacity: 20 })).body;
  await ops('PUT', `/admin/bakeries/${b.id}`, { bakesOwnBread: true, licenceNo: 'DM-900' });
  await ops('POST', `/admin/bakeries/${b.id}/samples`, { product: 'plainCroissant', result: 'Approved' });
  assert.equal((await ops('POST', `/admin/bakeries/${b.id}/status`, { status: 'Active' })).body.error, 'onboarding_incomplete');
  await ops('PUT', `/admin/bakeries/${b.id}`, { onboarding: { allergenRecords: true, packaging: true, systemReady: true, pilotPassed: true } });
  assert.equal((await ops('POST', `/admin/bakeries/${b.id}/status`, { status: 'Active' })).status, 200);
  await ops('POST', `/admin/bakeries/${b.id}/status`, { status: 'Suspended', note: 'test done' });
});

test('“Not for me” reasons are about taste only; delivery problems are reported separately', async () => {
  const { a, o } = await order('509400008', dates[7]);
  const { demoStep } = await import('../server/fulfilment.js');
  const id = db.prepare('SELECT id FROM order_days WHERE order_id = ?').get(o.id).id;
  await ops('POST', '/allocate', { date: dates[7] });
  for (let i = 0; i < 3; i++) demoStep('personal', id);
  await call('POST', `/orders/${o.id}/days/${dates[7]}/feedback`, { value: 'Not for me', reasons: ['Arrived late'] }, a);
  assert.equal(JSON.parse(db.prepare('SELECT feedback_reasons FROM order_days WHERE id = ?').get(id).feedback_reasons || '[]').length, 0);
});
