/* MB-B2B-001 §10: Cancel Order and Update Special Breakfast for business orders. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const { orderableDates, isoDate } = await import('../src/domain/standards.js');

let server, base;
before(async () => { server = createApp().listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => server.close());

const call = async (method, path, body, auth = {}) => {
  const res = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: /^[[{]/.test(text) ? JSON.parse(text) : text };
};
async function signIn(mobile) {
  const otp = await call('POST', '/auth/otp', { mobile });
  const v = await call('POST', '/auth/verify', { mobile, code: otp.body.devCode, firstName: 'Omar' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return { token: v.body.token };
}
const dates = orderableDates(new Date(), 14).map(isoDate);
const delivery = { company: 'Acme', building: 'Index Tower', office: '21', contact: 'Omar', mobile: '55 123 4567' };
const bizDay = date => ({ date, window: 'w2', people: 6, delivery,
  lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 4 }], specials: [{ dietary: ['vegan'], allergies: [], qty: 2 }] });
async function businessOrder(mobile, ds) {
  const u = await signIn(mobile);
  await call('POST', '/business/account', { company: 'Acme', email: 'ops@acme.example' }, u);
  const o = await call('POST', '/business/orders', { days: ds.map(bizDay) }, u);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  return { u, o: o.body };
}

test('cancel order: every day before cutoff and not started is cancelled and refunded; the rest are reported', async () => {
  const { u, o } = await businessOrder('508880001', dates.slice(2, 5));
  /* The middle day has already gone into production. */
  db.prepare('UPDATE business_days SET stage = 1 WHERE order_id = ? AND date = ?').run(o.id, dates[3]);
  const r = await call('POST', `/business/orders/${o.id}/cancel`, {}, u);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.cancelled, [dates[2], dates[4]]);
  assert.deepEqual(r.body.notCancelled.map(x => x.date), [dates[3]]);
  const byDate = Object.fromEntries(r.body.order.days.map(d => [d.date, d]));
  assert.equal(byDate[dates[2]].cancelled, true);
  assert.equal(byDate[dates[4]].cancelled, true);
  assert.equal(byDate[dates[3]].cancelled, false);
  assert.equal(r.body.refund, byDate[dates[2]].refund + byDate[dates[4]].refund);
  assert.ok(r.body.refund > 0);
  /* The same refund notification as a single-day cancel, once per day. */
  const notes = db.prepare("SELECT ref FROM notifications WHERE kind = 'refund' AND ref LIKE ?").all(`${o.id}:%`).map(n => n.ref).sort();
  assert.deepEqual(notes, [`${o.id}:${dates[2]}`, `${o.id}:${dates[4]}`]);
  /* Repeating it changes nothing. */
  const again = await call('POST', `/business/orders/${o.id}/cancel`, {}, u);
  assert.deepEqual(again.body.cancelled, []);
  assert.deepEqual(again.body.notCancelled.map(x => x.date), [dates[3]]);
});

test('cancel order: only the owner can cancel', async () => {
  const { o } = await businessOrder('508880002', [dates[6]]);
  const other = await signIn('508880003');
  assert.equal((await call('POST', `/business/orders/${o.id}/cancel`, {}, other)).status, 404);
});

test('update special breakfast: changing a group’s requirements re-resolves the safe breakfast', async () => {
  const { u, o } = await businessOrder('508880004', [dates[7]]);
  const day = o.days[0];
  const specials = [{ ...day.specials[0], dietary: [], allergies: ['dairy', 'egg'] }];
  const r = await call('PATCH', `/business/orders/${o.id}/days/${day.date}`, { specials }, u);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = r.body.days[0].specials[0];
  assert.deepEqual(s.dietary, []);
  assert.deepEqual(s.allergies, ['dairy', 'egg']);
  assert.equal(s.qty, 2);
  assert.ok(s.recipeId && Array.isArray(s.components));
  const empty = await call('PATCH', `/business/orders/${o.id}/days/${day.date}`, { specials: [{ ...s, dietary: [], allergies: [] }] }, u);
  assert.equal(empty.body.error, 'special_invalid');
});
