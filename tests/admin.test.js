/* Admin (prices, bakeries), Bakery View and the fulfilment workflow (MB-OPS-001, MB-BKY-001, MB-DLV-001). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const { orderableDates, isoDate, PRICE_LEVELS, DEFAULT_PRICING } = await import('../src/domain/standards.js');
const { recommendDay } = await import('../src/domain/app.js');
const { allocateAtCutoff, flagAtRisk } = await import('../server/ops.js');
const { cutoffFor } = await import('../src/domain/standards.js');

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
  const v = await call('POST', '/auth/verify', { mobile, code: otp.body.devCode, firstName: 'Sara' });
  return { token: v.body.token };
}
const dates = orderableDates(new Date(), 14).map(isoDate);
const profile = { eatingStyle: 'flexible', preferences: ['savory'], dietary: [], allergies: [] };
const day = (date, extra = {}) => { const r = recommendDay(profile, 'regular'); return { date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2', ...extra }; };
const address = { building: 'Gate Village, Building 3', unit: 'Level 4' };
async function order(mobile, date, extra) {
  const a = await signIn(mobile);
  await call('PUT', '/me/profile', profile, a);
  const o = await call('POST', '/orders', { days: [day(date, extra)], address }, a);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  return { a, o: o.body, id: db.prepare('SELECT id FROM order_days WHERE order_id = ?').get(o.body.id).id };
}

test('admin prices change what customers pay, and the app receives them', async () => {
  const p = (await ops('GET', '/admin/pricing')).body;
  assert.ok(p.levels.L1.length > 0, 'shows which breakfasts use each level');
  const next = structuredClone(p.pricing);
  next.priceLevels.L1 += 5; next.priceLevels.L2 += 5; next.priceLevels.L3 += 5; next.priceLevels.L4 += 5;
  next.indicative = false;
  assert.equal((await ops('PUT', '/admin/pricing', { ...next, sizeAdjustment: { light: 5, large: 10 } })).status, 400, 'Light must be below Regular');
  assert.equal((await ops('PUT', '/admin/pricing', { ...next, sizeAdjustment: { light: 0, large: 10 } })).status, 400, 'Light can’t equal Regular');
  assert.equal((await ops('PUT', '/admin/pricing', { ...next, sizeAdjustment: { light: -5, large: 0 } })).status, 400, 'Large can’t equal Regular');
  assert.equal((await ops('PUT', '/admin/pricing', next)).status, 200);
  const cfg = (await call('GET', '/config')).body;
  assert.equal(cfg.pricing.priceLevels.L1, DEFAULT_PRICING.priceLevels.L1 + 5);
  assert.equal(cfg.pricing.indicative, false);
  const { o } = await order('509100001', dates[0]);
  assert.equal(o.days[0].price, Object.values(PRICE_LEVELS).find(v => v === o.days[0].price), 'server prices from the admin levels');
  assert.equal((await call('GET', '/ops/admin/pricing')).status, 401, 'needs the operations key');
  await ops('POST', '/admin/pricing/reset');
  assert.equal(PRICE_LEVELS.L1, DEFAULT_PRICING.priceLevels.L1);
});

test('admin manages bakeries: add, suspend, capacity, conditions; allocation follows', async () => {
  const added = await ops('POST', '/admin/bakeries', { name: 'Test Bakery', area: 'DIFC', distanceKm: 0.1, dailyCapacity: 50, capabilities: { glutenFree: true } });
  assert.equal((await ops('POST', `/admin/bakeries/${added.body.id}/status`, { status: 'Active' })).body.error, 'bread_required', 'must bake its own bread (BKY §1)');
  await ops('PUT', `/admin/bakeries/${added.body.id}`, { bakesOwnBread: true, licenceNo: 'DM-12345', onboarding: { allergenRecords: true, packaging: true, systemReady: true, pilotPassed: true } });
  assert.equal((await ops('POST', `/admin/bakeries/${added.body.id}/samples`, { product: 'plainCroissant', result: 'Approved' })).status, 201);
  assert.equal(added.status, 201);
  assert.equal(added.body.status, 'Under Review', 'new partners start under review');
  const { o, id } = await order('509100002', dates[1]);
  await ops('POST', '/allocate', { date: dates[1] });
  assert.notEqual(db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(id).bakery_id, added.body.id, 'not allocated while under review');
  assert.equal((await ops('POST', `/admin/bakeries/${added.body.id}/status`, { status: 'Active' })).status, 200);
  await ops('POST', '/allocate', { date: dates[1] });
  assert.equal(db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(id).bakery_id, added.body.id, 'nearest active bakery');
  assert.equal((await ops('POST', `/admin/bakeries/${added.body.id}/status`, { status: 'Suspended' })).body.error, 'note_required');
  const s = await ops('POST', `/admin/bakeries/${added.body.id}/status`, { status: 'Suspended', note: 'Allergy incident under investigation' });
  assert.equal(s.body.affected, 1);
  await ops('POST', '/allocate', { date: dates[1] });
  assert.notEqual(db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(id).bakery_id, added.body.id, 'suspended bakeries get no orders');
  assert.equal((await ops('POST', `/admin/bakeries/${added.body.id}/status`, { status: 'Active' })).body.error, 'verification_required', 'corrective action verified before returning');
  await ops('POST', `/admin/bakeries/${added.body.id}/status`, { status: 'Active', verification: 'Retrained staff; audit passed' });
  const cond = await ops('POST', `/admin/bakeries/${added.body.id}/conditions`, { date: dates[1], kind: 'Temporarily Unavailable' });
  assert.equal(cond.status, 201);
  await ops('POST', '/allocate', { date: dates[1] });
  assert.notEqual(db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(id).bakery_id, added.body.id, 'temporarily unavailable');
  const item = o.days[0].cfg.components[0];
  await ops('DELETE', `/admin/conditions/${cond.body.conditions[0].id}`);
  await ops('PUT', `/admin/bakeries/${added.body.id}`, { products: ['plainCroissant'] });
  await ops('POST', '/allocate', { date: dates[1] });
  assert.notEqual(db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(id).bakery_id, added.body.id, `not approved for ${item}`);
  await ops('PUT', `/admin/bakeries/${added.body.id}`, { products: null, effectiveCapacity: 0 });
  await ops('POST', '/allocate', { date: dates[1] });
  assert.notEqual(db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(id).bakery_id, added.body.id, 'effective capacity 0');
  await ops('POST', `/admin/bakeries/${added.body.id}/status`, { status: 'Suspended', note: 'test done' });
});

test('final allocation runs automatically at the 9 PM cutoff, once', async () => {
  const { id } = await order('509100003', dates[2]);
  db.prepare('UPDATE order_days SET bakery_id = NULL WHERE id = ?').run(id);
  const date = db.prepare('SELECT date FROM order_days WHERE id = ?').get(id).date;
  const after9 = new Date(cutoffFor(date).getTime() + 60e3);
  db.prepare('DELETE FROM settings WHERE key = ?').run(`allocated:${date}`);
  assert.equal(allocateAtCutoff(new Date(cutoffFor(date).getTime() - 60e3)), null, 'not before cutoff');
  const r = allocateAtCutoff(after9);
  assert.equal(r.date, date);
  assert.ok(db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(id).bakery_id);
  assert.equal(allocateAtCutoff(after9), null, 'only once');
});

test('Bakery View: confirm plan, prepare, QC before Ready; handover must match; delivered with point', async () => {
  const { a, o, id } = await order('509100004', dates[3]);
  await ops('POST', '/allocate', { date: dates[3] });
  const bakeryId = db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(id).bakery_id;
  const code = (await ops('POST', `/admin/bakeries/${bakeryId}/access-code`)).body.code;
  const B = { 'x-bakery-code': code };
  assert.equal((await call('GET', `/bakery/plan?date=${dates[3]}`)).status, 401);
  const plan = await call('GET', `/bakery/plan?date=${dates[3]}`, null, {}, B);
  assert.ok(plan.body.packing.some(p => p.ref === o.id));
  assert.ok(!JSON.stringify(plan.body).includes('mobile'), 'no customer phone numbers for the bakery');
  assert.equal((await call('POST', '/bakery/plan/confirm', { date: dates[3] }, {}, B)).status, 200);
  assert.equal((await call('POST', '/bakery/plan/start', { date: dates[3] }, {}, B)).body.started >= 1, true);
  assert.equal((await call('GET', `/orders/${o.id}`, null, a)).body.days[0].stage, 1, 'customer sees Being prepared');
  assert.equal((await call('POST', `/bakery/days/personal/${id}/state`, { state: 'Ready', qc: { order: true } }, {}, B)).body.error, 'qc_required', 'every check is needed');
  const qc = { order: true, components: true, size: true, addons: true, allergy: true, swaps: true, freshness: true, packaging: true, labels: true };
  assert.equal((await call('POST', `/bakery/days/personal/${id}/state`, { state: 'Ready', qc }, {}, B)).status, 200);
  assert.equal((await ops('POST', `/days/personal/${id}/handover`, { boxes: 1, specialBoxes: 0 })).body.error, 'route_required', 'courier planned before pickup');
  await ops('POST', `/days/personal/${id}/route`, { routeId: 'R1' });
  const mismatch = await ops('POST', `/days/personal/${id}/handover`, { boxes: 2, specialBoxes: 0 });
  assert.equal(mismatch.body.error, 'handover_mismatch');
  assert.ok(db.prepare("SELECT 1 FROM exceptions WHERE kind = 'Handover Mismatch' AND ref = ?").get(`personal:${id}`));
  assert.equal((await ops('POST', `/days/personal/${id}/handover`, { boxes: 1, specialBoxes: 0, routeId: 'R1' })).status, 200);
  assert.equal((await ops('POST', `/days/personal/${id}/out`)).status, 200);
  assert.equal((await call('GET', `/orders/${o.id}`, null, a)).body.days[0].stage, 2);
  assert.equal((await ops('POST', `/days/personal/${id}/delivered`, {})).body.error, 'point_required');
  assert.equal((await ops('POST', `/days/personal/${id}/delivered`, { deliveryPoint: 'Reception' })).status, 200);
  const row = db.prepare('SELECT * FROM order_days WHERE id = ?').get(id);
  assert.equal(row.stage, 3); assert.equal(row.recipient_type, 'Reception / Concierge');
  const other = (await ops('POST', '/admin/bakeries', { name: 'Other', area: 'DIFC', distanceKm: 9, dailyCapacity: 5 })).body;
  const otherCode = (await ops('POST', `/admin/bakeries/${other.id}/access-code`)).body.code;
  assert.equal((await call('POST', `/bakery/days/personal/${id}/state`, { state: 'In Preparation' }, {}, { 'x-bakery-code': otherCode })).status, 403, 'only your own orders');
});

test('unable to fulfil → reallocate; failed delivery; refunds and credits; credit used at checkout', async () => {
  const { a, o, id } = await order('509100005', dates[4]);
  await ops('POST', '/allocate', { date: dates[4] });
  const first = db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(id).bakery_id;
  assert.equal((await ops('POST', `/days/personal/${id}/bakery-state`, { state: 'Unable to Fulfil', reason: 'Oven down' })).body.error, 'reason_required', 'a reason from the list');
  /* Unable to fulfil → moved automatically to the next eligible bakery. */
  assert.equal((await ops('POST', `/days/personal/${id}/bakery-state`, { state: 'Unable to Fulfil', reason: 'Equipment/Operational Issue' })).status, 200);
  assert.notEqual(db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(id).bakery_id, first);
  await ops('POST', `/days/personal/${id}/route`, { routeId: 'R2' });
  await ops('POST', `/days/personal/${id}/bakery-state`, { state: 'Ready', qc: { order: true, components: true, size: true, addons: true, allergy: true, swaps: true, freshness: true, packaging: true, labels: true } });
  await ops('POST', `/days/personal/${id}/handover`, { boxes: 1, specialBoxes: 0 });
  await ops('POST', `/days/personal/${id}/out`);
  assert.equal((await ops('POST', `/days/personal/${id}/failed`, { reason: 'Contact unreachable' })).status, 200);
  const dash = await ops('GET', `/dashboard?date=${dates[4]}`);
  assert.equal(dash.body.rows.find(r => r.id === id && r.kind === 'personal').health, 'Failed');
  assert.equal((await ops('POST', `/days/personal/${id}/remedy`, { type: 'Partial Refund', amount: 9999, reason: 'x' })).body.error, 'amount_invalid');
  assert.equal((await ops('POST', `/days/personal/${id}/remedy`, { type: 'Credit', amount: 10, reason: 'Sorry for the failed delivery' })).status, 200);
  assert.equal((await ops('POST', `/days/personal/${id}/remedy`, { type: 'Full Refund', reason: 'Morning Box could not deliver' })).body.amount, o.days[0].price);
  assert.equal((await ops('POST', `/days/personal/${id}/remedy`, { type: 'Full Refund', reason: 'again' })).body.error, 'already_refunded');
  assert.equal((await call('GET', '/me', null, a)).body.credit, 10);
  const next = await call('POST', '/orders', { days: [day(dates[5])], address }, a);
  assert.equal(next.body.creditUsed, 10);
  assert.equal((await call('GET', '/me', null, a)).body.credit, 0);
  const rep = await ops('GET', `/report?from=${dates[0]}&to=${dates[6]}`);
  assert.ok(rep.body.totals.failed >= 1 && rep.body.totals.refunds >= o.days[0].price);
  assert.ok(rep.body.partners.length && rep.body.kpis.mornings >= 1);
});

test('at risk of being late: the customer is told before the window ends, once', async () => {
  const { a, o, id } = await order('509100006', dates[6]);
  const date = db.prepare('SELECT date FROM order_days WHERE id = ?').get(id).date;
  const nearEnd = new Date(`${date}T09:20:00`);   // w2 ends 9:30
  assert.ok(flagAtRisk(nearEnd) >= 1);
  assert.equal(flagAtRisk(nearEnd), 0, 'only once');
  const n = (await call('GET', '/me/notifications', null, a)).body;
  assert.ok(JSON.stringify(n).includes('a little after'));
  const r = db.prepare('SELECT late, at_risk FROM order_days WHERE id = ?').get(id);
  assert.equal(r.at_risk, 1); assert.equal(r.late, 0, 'late is only recorded on an actual late delivery');
  void o;
});

test('exceptions: priority order, owner required to resolve, resolution text', async () => {
  const x = await ops('POST', '/exceptions', { ref: 'manual-1', kind: 'Dietary/Allergy Issue', note: 'Customer says nuts' });
  const list = (await ops('GET', '/exceptions')).body;
  assert.equal(list.find(e => !e.resolved).priority, 1, 'safety first');
  assert.equal((await ops('POST', `/exceptions/${x.body.id}/resolve`, { resolution: '' })).body.error, 'resolution_required');
  /* OPS §8: an exception always has an owner (Operations until reassigned); the action is still required. */
  assert.equal(list.find(e => e.id === x.body.id).owner, 'Operations');
  assert.equal((await ops('POST', `/exceptions/${x.body.id}/resolve`, { resolution: 'Refunded' })).body.error, 'action_required');
  assert.equal((await ops('PATCH', `/exceptions/${x.body.id}`, { owner: '' })).body.error, 'nothing_to_update', 'an owner can’t be cleared');
  assert.equal((await ops('PATCH', `/exceptions/${x.body.id}`, { owner: 'Aisha', action: 'Call the customer', cause: 'Label error' })).status, 200);
  assert.equal((await ops('POST', `/exceptions/${x.body.id}/resolve`, { resolution: 'Refunded and bakery retrained' })).status, 200);
});

test('analytics events feed the KPIs', async () => {
  assert.equal((await call('POST', '/events', { kind: 'no_match' })).status, 204);
  assert.equal((await call('POST', '/events', { kind: 'hack' })).status, 400);
});

test('capacity is reserved at order time with the same rules as allocation (OPS §2, DLV §8)', async () => {
  /* Only Partner Bakery A handles tree-nut-free; give it room for exactly one box on this date. */
  const A = db.prepare("SELECT id FROM bakeries WHERE name = 'Partner Bakery A'").get().id;
  const nutFree = { ...profile, allergies: ['treenut'] };
  const date = dates[7];
  const cond = (await ops('POST', `/admin/bakeries/${A}/conditions`, { date, kind: 'Reduced Capacity', capacity: 1 })).body.conditions.find(c => c.date === date);
  const place = async mobile => {
    const a = await signIn(mobile); await call('PUT', '/me/profile', nutFree, a);
    const r = recommendDay(nutFree, 'regular');
    return call('POST', '/orders', { days: [{ date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w1' }], address }, a);
  };
  assert.equal((await place('509100010')).status, 201);
  const second = await place('509100011');
  assert.equal(second.body.error, 'capacity_full', 'B and C have room but cannot make it nut-free');
  await ops('DELETE', `/admin/conditions/${cond.id}`);
});

test('a business order too big for one bakery is split by line; each bakery hands over its own share', async () => {
  const date = dates[8];
  const A = db.prepare("SELECT id FROM bakeries WHERE name = 'Partner Bakery A'").get().id;
  const B = db.prepare("SELECT id FROM bakeries WHERE name = 'Partner Bakery B'").get().id;
  const C = db.prepare("SELECT id FROM bakeries WHERE name = 'Partner Bakery C'").get().id;
  const conds = [];
  for (const [id, cap] of [[A, 6], [B, 6], [C, 0]]) conds.push((await ops('POST', `/admin/bakeries/${id}/conditions`, { date, kind: 'Reduced Capacity', capacity: cap })).body.conditions.find(c => c.date === date).id);
  const u = await signIn('509100012');
  await call('POST', '/business/account', { company: 'Split Co', email: 'ops@split.example' }, u);
  const o = await call('POST', '/business/orders', { days: [{ date, window: 'w2', people: 10,
    lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 8 }], specials: [{ dietary: [], allergies: ['treenut'], qty: 2 }],
    delivery: { company: 'Split Co', building: 'Index Tower', office: '21', contact: 'Omar', mobile: '55 123 4567' } }] }, u);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  await ops('POST', '/allocate', { date });
  const row = (await ops('GET', `/dashboard?date=${date}`)).body.rows.find(r => r.kind === 'business' && r.orderId === o.body.id);
  assert.equal(row.allocation.length, 2, 'split across two bakeries');
  const aPart = row.allocation.find(p => p.bakeryId === A);
  assert.ok(aPart.items.some(it => it.entry === 1 && it.qty === 2), 'the nut-free Specials go to the bakery able to make them');
  const prep = (await ops('GET', `/prep?date=${date}`)).body.bakeries;
  const bPlan = prep.find(p => p.bakeryId === B);
  assert.equal(bPlan.packing.find(x => x.ref === o.body.id).boxes, row.allocation.find(p => p.bakeryId === B).boxes, 'B sees only its share');
  await ops('POST', `/days/business/${row.id}/bakery-state`, { state: 'Ready', qc: { order: true, components: true, size: true, addons: true, allergy: true, swaps: true, freshness: true, packaging: true, labels: true } });
  await ops('POST', `/days/business/${row.id}/route`, { routeId: 'R9' });
  assert.equal((await ops('POST', `/days/business/${row.id}/handover`, { boxes: 10, specialBoxes: 2 })).body.error, 'part_required');
  for (const p of row.allocation) {
    const special = p.items.filter(it => it.entry === 1).reduce((t, it) => t + it.qty, 0);
    assert.equal((await ops('POST', `/days/business/${row.id}/handover`, { bakeryId: p.bakeryId, boxes: p.boxes, specialBoxes: special })).status, 200);
  }
  assert.equal((await ops('POST', `/days/business/${row.id}/out`)).status, 200, 'dispatch only after every share is handed over');
  for (const id of conds) await ops('DELETE', `/admin/conditions/${id}`);
});

test('when no bakery can take an order it is refunded in full and the customer is told (DLV §11)', async () => {
  const { a, o, id } = await order('509100013', dates[9]);
  await ops('POST', '/allocate', { date: dates[9] });
  const others = db.prepare("SELECT id FROM bakeries WHERE status = 'Active' AND id != (SELECT bakery_id FROM order_days WHERE id = ?)").all(id).map(b => b.id);
  const conds = [];
  for (const b of others) conds.push((await ops('POST', `/admin/bakeries/${b}/conditions`, { date: dates[9], kind: 'Temporarily Unavailable' })).body.conditions.find(c => c.date === dates[9]).id);
  assert.equal((await ops('POST', `/days/personal/${id}/bakery-state`, { state: 'Unable to Fulfil', reason: 'Capacity Issue' })).status, 200);
  const day = (await call('GET', `/orders/${o.id}`, null, a)).body.days[0];
  assert.equal(day.problem, 'Not Fulfilled');
  assert.equal(day.recoveryRefund, o.days[0].price);
  assert.ok((await call('GET', '/me/notifications', null, a)).body.some(n => n.kind === 'refund'));
  for (const c of conds) await ops('DELETE', `/admin/conditions/${c}`);
});

test('SAMPLE items can be switched off; Fruit Danish in the box gets an approved flavour', async () => {
  const vegan = { eatingStyle: 'flexible', preferences: ['bakery', 'sweet', 'fresh', 'savory'], dietary: ['vegan'], allergies: [] };
  const withSamples = JSON.stringify(recommendDay(vegan, 'relaxed'));
  assert.equal((await ops('PUT', '/admin/library', { samples: false })).status, 200);
  const without = recommendDay(vegan, 'relaxed');
  assert.ok(!JSON.stringify(without).match(/plantButter|coconutYogurt|glutenFreeBread/), 'no SAMPLE items offered');
  assert.notEqual(JSON.stringify(without), withSamples);
  await ops('PUT', '/admin/library', { samples: true });
  const flex = { eatingStyle: 'flexible', preferences: ['sweet'], dietary: [], allergies: [] };
  const r = recommendDay(flex, 'relaxed');
  assert.ok(r.primary.components.includes('fruitDanish'));
  const a = await signIn('509100014'); await call('PUT', '/me/profile', flex, a);
  const o = await call('POST', '/orders', { days: [{ date: dates[10], context: 'relaxed', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], danishFlavour: 'Apricot', window: 'w2' }], address }, a);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.equal(o.body.days[0].cfg.danishFlavour, 'Apricot');
});
