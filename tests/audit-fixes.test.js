/* Final spec audit fixes: bakery pay before volume discount (MB-BKY-001 §11), full final check (MB-PRO-001 §15.3),
   bakery delivery delay (MB-OPS-001 §6, MB-DLV-001 §6), optional issue photo (OPS §10),
   "Prepared by" once the bakery is final (MB-PRD-001 §11). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const { orderableDates, isoDate } = await import('../src/domain/standards.js');
const { recommendDay } = await import('../src/domain/app.js');
const { allocate } = await import('../server/allocation.js');
const { setBakeryState, QC_CHECKS } = await import('../server/fulfilment.js');

let server, base;
before(async () => { server = createApp().listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => server.close());

const call = async (method, path, body, token, headers = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: /^[[{]/.test(text) ? JSON.parse(text) : text };
};
const ops = (m, p, b) => call(m, `/ops${p}`, b, null, { 'x-ops-key': 'dev-ops-key' });
async function signIn(mobile) {
  const { devCode } = (await call('POST', '/auth/otp', { mobile })).body;
  return (await call('POST', '/auth/verify', { mobile, code: devCode, firstName: 'Lina' })).body.token;
}
const dates = orderableDates(new Date(), 14).map(isoDate);
const profile = { eatingStyle: 'flexible', preferences: ['savory'], dietary: [], allergies: [] };
const address = { building: 'Gate Village, Building 3', unit: 'Level 4', handover: 'reception' };
async function personal(mobile, date, window = 'w2') {
  const t = await signIn(mobile);
  await call('PUT', '/me/profile', profile, t);
  const r = recommendDay(profile, 'regular');
  const o = await call('POST', '/orders', { days: [{ date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window }], address }, t);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  return { t, o: o.body, id: db.prepare('SELECT id FROM order_days WHERE order_id = ?').get(o.body.id).id };
}

test('bakery payable is worked out before the business volume discount', async () => {
  const date = dates[5];
  const t = await signIn('500000401');
  await call('POST', '/business/account', { company: 'Pay Co', email: 'pay@example.com' }, t);
  const o = await call('POST', '/business/orders', { days: [{ date, window: 'w1', people: 12, lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 12 }], specials: [],
    delivery: { company: 'Pay Co', building: 'Index Tower', office: '21', contact: 'Lina', mobile: '55 123 4567' } }] }, t);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const d = db.prepare('SELECT * FROM business_days WHERE order_id = ?').get(o.body.id);
  assert.ok(d.discount > 0 && d.total < d.gross, 'a volume discount applies');
  await ops('POST', '/allocate', { date });
  db.prepare("UPDATE business_days SET bakery_state = 'Ready' WHERE id = ?").run(d.id);
  const pct = db.prepare('SELECT payout_pct FROM bakeries WHERE id = ?').get(JSON.parse(db.prepare('SELECT allocation FROM business_days WHERE id = ?').get(d.id).allocation)[0].bakeryId).payout_pct;
  const f = (await ops('GET', `/report?from=${date}&to=${date}`)).body.finance;
  assert.equal(f.payments, d.total);
  assert.equal(f.bakeryPayable, Math.round(d.gross * pct) / 100, 'payable uses the price before discount');
});

test('final check before Ready includes swaps and freshness & appearance', async () => {
  assert.ok(QC_CHECKS.swaps && QC_CHECKS.freshness);
  const { id } = await personal('500000402', dates[6]);
  await ops('POST', '/allocate', { date: dates[6] });
  setBakeryState('personal', id, 'In Preparation', { byOps: true });
  const partial = Object.fromEntries(Object.keys(QC_CHECKS).filter(k => k !== 'freshness').map(k => [k, true]));
  assert.throws(() => setBakeryState('personal', id, 'Ready', { qc: partial, byOps: true }), /Fresh and well presented/);
  setBakeryState('personal', id, 'Ready', { qc: { ...partial, freshness: true }, byOps: true });
});

test('the delivering bakery can report running late: customer told, Delivery Delay recorded', async () => {
  const date = dates[8];
  const { t, o, id } = await personal('500000405', date);
  await ops('POST', '/allocate', { date });
  const bakeryId = db.prepare('SELECT bakery_id FROM order_days WHERE id = ?').get(id).bakery_id;
  const B = { 'x-bakery-code': (await ops('POST', `/admin/bakeries/${bakeryId}/access-code`)).body.code };
  assert.equal((await call('POST', `/bakery/days/personal/${id}/late`, { eta: '' }, null, B)).body.error, 'eta_required');
  assert.equal((await call('POST', `/bakery/days/personal/${id}/late`, { eta: '9:45 AM', note: 'traffic' }, null, B)).status, 200);
  const n = (await call('GET', '/me/notifications', null, t)).body;
  assert.ok((n.items || n).some(x => x.kind === 'late' && /9:45 AM/.test(x.message)), 'customer told the new time');
  assert.ok(db.prepare("SELECT 1 FROM exceptions WHERE ref = ? AND kind = 'Delivery Delay' AND category = 'Bakery'").get(`personal:${id}`), 'Delivery Delay recorded');
  const plan = (await call('GET', `/bakery/plan?date=${date}`, null, null, B)).body;
  assert.equal(plan.packing.find(x => x.id === id).lateNote, '9:45 AM');
  assert.ok(o.id);
});

test('optional photo on a problem report; Admin can view it', async () => {
  const date = dates[9];
  const { t, o, id } = await personal('500000406', date);
  db.prepare('UPDATE order_days SET stage = 2 WHERE id = ?').run(id);
  const issue = (body) => call('POST', `/orders/${o.id}/days/${date}/issue`, body, t);
  assert.equal((await issue({ reason: 'Quality issue', photo: 'data:text/html;base64,PHNjcmlwdD4=' })).body.error, 'photo_invalid');
  assert.equal((await issue({ reason: 'Quality issue', photo: `data:image/jpeg;base64,${'A'.repeat(200_000)}` })).body.error, 'photo_too_large');
  const photo = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal((await issue({ reason: 'Quality issue', note: 'Squashed', photo })).status, 200);
  assert.equal((await issue({ reason: 'Packaging issue' })).status, 200, 'a photo is never required');
  const ex = (await ops('GET', '/exceptions')).body.filter(e => e.ref === `personal:${id}`);
  const withPhoto = ex.find(e => e.has_photo);
  assert.ok(withPhoto && ex.some(e => !e.has_photo));
  assert.equal((await ops('GET', `/exceptions/${withPhoto.id}/photo`)).body.photo, photo);
});

test('"Prepared by" is sent once when the bakery is final', async () => {
  const date = dates[10];
  const { t, o } = await personal('500000407', date);
  allocate(date, { final: true });
  allocate(date, { final: true });
  const n = (await call('GET', '/me/notifications', null, t)).body;
  const prepared = (n.items || n).filter(x => x.kind === 'prepared_by');
  assert.equal(prepared.length, 1);
  assert.match(prepared[0].message, /prepared by Partner Bakery/);
  assert.ok(o.id);
});
