/* Real-app features added in October 2026: terms, feedback, support, history, receipts, closures, ops tools. */
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
  return { status: res.status, headers: res.headers, body: /^[[{]/.test(text) ? JSON.parse(text) : text };
};
async function signIn(mobile) {
  const otp = await call('POST', '/auth/otp', { mobile });
  const v = await call('POST', '/auth/verify', { mobile, code: otp.body.devCode, firstName: 'Lina' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return { token: v.body.token };
}
const H = { 'x-ops-key': 'dev-ops-key' };
const dates = orderableDates(new Date(), 14).map(isoDate);
const profile = { eatingStyle: 'flexible', preferences: ['savory'], dietary: [], allergies: [] };
const day = date => { const r = recommendDay(profile, 'regular'); return { date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2' }; };
async function customerWithOrder(mobile, n = 1) {
  const a = await signIn(mobile);
  await call('PUT', '/me/profile', profile, a);
  const o = await call('POST', '/orders', { days: dates.slice(0, n).map(day), address: { building: 'Gate Village, Building 3', unit: 'Level 4' } }, a);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  return { a, o: o.body };
}

/* Walk one delivery through the real fulfilment steps as operations would (allocate → prepare → QC'd Ready → route → counted pickup → out → delivered). */
async function opsDeliver(kind, id, date, point = 'Reception') {
  const ops = (m, p, b) => call(m, `/ops${p}`, b, {}, H);
  await ops('POST', '/allocate', { date });
  const row = (await ops('GET', `/dashboard?date=${date}`)).body.rows.find(r => r.kind === kind && r.id === id);
  for (const [p, b] of [['bakery-state', { state: 'In Preparation' }], ['bakery-state', { state: 'Ready', qcPassed: true }], ['route', { routeId: 'R1' }]]) {
    const r = await ops('POST', `/days/${kind}/${id}/${p}`, b); if (r.status !== 200) throw new Error(`${p}: ${JSON.stringify(r.body)}`);
  }
  const parts = kind === 'business' && row.allocation?.length > 1 ? row.allocation : [{ bakeryId: undefined, boxes: row.boxes }];
  for (const part of parts) {
    const r = await ops('POST', `/days/${kind}/${id}/handover`, { bakeryId: part.bakeryId, boxes: part.boxes, specialBoxes: parts.length > 1 ? undefined : row.specialBoxes });
    if (r.status !== 200) throw new Error(`handover: ${JSON.stringify(r.body)}`);
  }
  for (const [p, b] of [['out', {}], ['delivered', { deliveryPoint: point }]]) {
    const r = await ops('POST', `/days/${kind}/${id}/${p}`, b); if (r.status !== 200) throw new Error(`${p}: ${JSON.stringify(r.body)}`);
  }
}
const deliver = async (orderId, date) => {
  const id = db.prepare('SELECT id FROM order_days WHERE order_id = ? AND date = ?').get(orderId, date).id;
  await opsDeliver('personal', id, date);
};

test('signing in records acceptance of the current terms', async () => {
  const a = await signIn('502220001');
  const me = await call('GET', '/me', null, a);
  assert.equal(me.body.termsAccepted, true);
  const cfg = await call('GET', '/config');
  assert.ok(cfg.body.termsVersion && cfg.body.company.name && Array.isArray(cfg.body.closedDates));
});

test('feedback is Loved it / Not for me with an optional reason, and never changes the recommendation', async () => {
  const { a, o } = await customerWithOrder('502220002', 2);
  for (const d of o.days) await deliver(o.id, d.date);
  const before = (await call('POST', '/recommendations', { profile, context: o.days[0].cfg.context })).body;
  assert.equal((await call('POST', `/orders/${o.id}/days/${o.days[0].date}/feedback`, { rating: 5 }, a)).status, 400);
  assert.equal((await call('POST', `/orders/${o.id}/days/${o.days[0].date}/feedback`, { value: 'Loved it', reasons: ['Too much'] }, a)).status, 200);
  assert.equal((await call('POST', `/orders/${o.id}/days/${o.days[1].date}/feedback`, { value: 'Not for me', reasons: ['Too much', 'Nonsense'] }, a)).status, 200);
  const got = (await call('GET', `/orders/${o.id}`, null, a)).body.days;
  assert.equal(got[0].feedback, 'Loved it'); assert.deepEqual(got[0].feedbackReasons, []);
  assert.equal(got[1].feedback, 'Not for me'); assert.deepEqual(got[1].feedbackReasons, ['Too much']);
  /* MB-REC-001 §1.4 / §14: same inputs → same recommendation, whatever the feedback. */
  assert.deepEqual((await call('POST', '/recommendations', { profile, context: o.days[0].cfg.context })).body, before);
  assert.equal((await call('GET', '/ratings')).status, 404);
  const fb = await call('GET', '/ops/feedback', null, {}, H);
  assert.ok(fb.body.items.some(i => i.value === 'Not for me' && i.reasons.includes('Too much')));
});

test('order activity, receipt and calendar', async () => {
  const { a, o } = await customerWithOrder('502220003', 2);
  await call('PATCH', `/orders/${o.id}/days/${o.days[0].date}`, { window: 'w1', size: 'large' }, a);
  await call('POST', `/orders/${o.id}/days/${o.days[1].date}/cancel`, null, a);
  const got = (await call('GET', `/orders/${o.id}`, null, a)).body.days;
  assert.deepEqual(got[0].events.map(e => e.kind), ['placed', 'changed']);
  assert.match(got[0].events[1].message, /7:30 – 8:30 AM.*Large/);
  assert.deepEqual(got[1].events.map(e => e.kind), ['placed', 'cancelled']);
  const receipt = await call('GET', `/orders/${o.id}/receipt`, null, a);
  assert.match(receipt.body, /Receipt|Tax Invoice/); assert.match(receipt.body, /Refunded for cancelled mornings/);
  const ics = await call('GET', `/orders/${o.id}/calendar`, null, a);
  assert.match(ics.body, /BEGIN:VCALENDAR/); assert.equal((ics.body.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(ics.body, /T033000Z/, '7:30 Dubai is 03:30 UTC');
  const other = await signIn('502220004');
  assert.equal((await call('GET', `/orders/${o.id}/receipt`, null, other)).status, 404);
});

test('support requests and replies reach the customer', async () => {
  const a = await signIn('502220005');
  assert.equal((await call('POST', '/support', { topic: 'Nope', message: 'hello there' }, a)).status, 400);
  assert.equal((await call('POST', '/support', { topic: 'Delivery', message: 'hi' }, a)).status, 400);
  const s = await call('POST', '/support', { topic: 'Delivery', message: 'Can you deliver to Gate 5?' }, a);
  assert.equal(s.status, 201);
  const list = await call('GET', '/ops/support', null, {}, H);
  assert.ok(list.body.some(x => x.id === s.body.id));
  await call('POST', `/ops/support/${s.body.id}/reply`, { reply: 'Yes, Gate 5 is covered.' }, {}, H);
  const mine = await call('GET', '/support', null, a);
  assert.equal(mine.body[0].status, 'answered');
  const notes = await call('GET', '/me/notifications', null, a);
  assert.ok(notes.body.some(n => n.kind === 'support_reply'));
  const data = await call('GET', '/me/export', null, a);
  assert.equal(data.body.support.length, 1);
});

test('closed days block ordering and availability', async () => {
  const date = dates[3];
  const add = await call('POST', '/ops/closed-dates', { date, reason: 'National Day' }, {}, H);
  assert.equal(add.status, 201);
  assert.deepEqual((await call('GET', '/config')).body.closedDates.map(c => c.date), [date]);
  assert.equal((await call('GET', `/availability?dates=${date}`)).body[date].w1.available, false);
  const a = await signIn('502220006');
  await call('PUT', '/me/profile', profile, a);
  const o = await call('POST', '/orders', { days: [day(date)], address: { building: 'Gate Village', unit: 'L4' } }, a);
  assert.equal(o.status, 400); assert.equal(o.body.error, 'day_closed');
  await call('DELETE', `/ops/closed-dates/${date}`, null, {}, H);
  assert.equal((await call('GET', '/config')).body.closedDates.length, 0);
});

test('kitchen prep list and labels', async () => {
  const { o } = await customerWithOrder('502220007', 1);
  await call('POST', '/ops/allocate', { date: o.days[0].date }, {}, H);
  const prep = await call('GET', `/ops/prep?date=${o.days[0].date}`, null, {}, H);
  const plan = prep.body.bakeries.find(b => b.packing.some(p => p.ref === o.id));
  assert.ok(plan && plan.production[0].qty >= 1 && plan.readyBy);
  const labels = await call('GET', `/ops/labels?date=${o.days[0].date}`, null, {}, H);
  const label = labels.body.labels.find(l => l.ref === o.id);
  assert.ok(label && label.name === 'Lina' && label.size === 'Regular');
});

test('running late notifies the customer and shows the new time until delivery', async () => {
  const { a, o } = await customerWithOrder('502220017');
  const date = o.days[0].date;
  const id = db.prepare('SELECT id FROM order_days WHERE order_id = ? AND date = ?').get(o.id, date).id;
  assert.equal((await call('POST', `/ops/days/personal/${id}/late`, { eta: '' }, {}, H)).status, 400);
  assert.equal((await call('POST', `/ops/days/personal/${id}/late`, { eta: '9:20 AM' }, {}, H)).status, 200);
  let order = (await call('GET', `/orders/${o.id}`, null, a)).body;
  assert.equal(order.days[0].lateNote, '9:20 AM');
  assert.ok(order.days[0].events.some(e => e.kind === 'late'));
  const notes = (await call('GET', '/me/notifications', null, a)).body;
  assert.ok(notes.some(n => n.kind === 'late' && /9:20 AM/.test(n.message)));
  await deliver(o.id, date);
  order = (await call('GET', `/orders/${o.id}`, null, a)).body;
  assert.equal(order.days[0].lateNote, null);
  assert.equal((await call('POST', `/ops/days/personal/${id}/late`, { eta: '9:40 AM' }, {}, H)).status, 400);
});

test('report totals orders and revenue per day', async () => {
  const { a, o } = await customerWithOrder('502220018', 2);
  await call('POST', `/orders/${o.id}/days/${o.days[1].date}/cancel`, {}, a);
  const r = await call('GET', `/ops/report?from=${dates[0]}&to=${dates[13]}`, null, {}, H);
  assert.equal(r.status, 200);
  const first = r.body.days.find(d => d.date === o.days[0].date);
  assert.ok(first.personalMornings >= 1 && first.revenue >= o.days[0].price);
  assert.ok(r.body.totals.cancelled >= 1 && r.body.totals.refunds > 0);
  assert.equal((await call('GET', `/ops/report?from=${dates[5]}&to=${dates[0]}`, null, {}, H)).status, 400);
  assert.equal((await call('GET', `/ops/report?from=${dates[0]}&to=${dates[1]}`)).status, 401);
});

test('a box can only be changed by same-group swaps; no remove, no extra items (MB-BOX-001 §1, §5, §7)', async () => {
  const { a, o } = await customerWithOrder('502220019');
  const date = o.days[0].date;
  const cfg = o.days[0].cfg;
  const patchDay = body => call('PATCH', `/orders/${o.id}/days/${date}`, body, a);
  assert.equal((await patchDay({ components: cfg.components.slice(1) })).status, 400, 'remove is refused');
  assert.equal((await patchDay({ components: [...cfg.components, 'banana'] })).status, 400, 'adding an item is refused');
  assert.equal((await patchDay({ components: cfg.components, addons: [{ group: 'item', item: 'banana', qty: 2 }] })).status, 400, 'only bread and pastry add-ons');
  assert.equal((await patchDay({ components: cfg.components.map((c, i) => (i === 0 ? 'olives' : c)) })).status, 400, 'swap outside the swap group is refused');
  assert.equal((await patchDay({ components: cfg.components, size: 'large' })).status, 200);
});
