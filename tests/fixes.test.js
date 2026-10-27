/* Regression tests for the issues found in the October 2026 review. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
process.env.WINDOW_CAPACITY = '30';
const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const { queueDrinkReminders } = await import('../server/notify.js');
const { orderableDates, isoDate, cutoffFor } = await import('../src/domain/standards.js');
const { recommendDay } = await import('../src/domain/app.js');

let server, base;
before(async () => { server = createApp().listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => server.close());

const call = async (method, path, body, auth = {}, headers = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}), ...(auth.cookie ? { cookie: auth.cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
};
const allowResend = mobile => db.prepare('UPDATE otp_codes SET last_sent = 0 WHERE mobile = ?').run(`+971${mobile}`);
async function signIn(mobile, firstName = 'Test') {
  allowResend(mobile);
  const otp = await call('POST', '/auth/otp', { mobile });
  const v = await call('POST', '/auth/verify', { mobile, code: otp.body.devCode, firstName });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return { token: v.body.token, cookie: v.headers.get('set-cookie').split(';')[0] };
}
const dates = orderableDates(new Date(), 14).map(isoDate);
const address = { building: 'Gate Village, Building 3', unit: 'Level 4' };
const profile = { eatingStyle: 'flexible', preferences: ['savory'], dietary: [], allergies: [] };
const dayFor = (date, p = profile, extra = {}) => {
  const r = recommendDay(p, 'regular');
  return { date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2', ...extra };
};
const H = { 'x-ops-key': 'dev-ops-key' };

/* Walk one delivery through the real fulfilment steps as operations would (allocate → prepare → QC'd Ready → route → counted pickup → out → delivered). */
async function opsDeliver(kind, id, date, point = 'Reception') {
  const ops = (m, p, b) => call(m, `/ops${p}`, b, {}, H);
  await ops('POST', '/allocate', { date });
  const row = (await ops('GET', `/dashboard?date=${date}`)).body.rows.find(r => r.kind === kind && r.id === id);
  for (const [p, b] of [['bakery-state', { state: 'In Preparation' }], ['bakery-state', { state: 'Ready', qc: { order: true, components: true, size: true, addons: true, allergy: true, swaps: true, freshness: true, packaging: true, labels: true } }]]) {
    const r = await ops('POST', `/days/${kind}/${id}/${p}`, b); if (r.status !== 200) throw new Error(`${p}: ${JSON.stringify(r.body)}`);
  }
  const parts = kind === 'business' && row.allocation?.length > 1 ? row.allocation : [{ bakeryId: undefined, boxes: row.boxes }];
  for (const part of parts) {
    const r = await ops('POST', `/days/${kind}/${id}/handover`, { bakeryId: part.bakeryId, boxes: part.boxes, specialBoxes: parts.length > 1 ? undefined : row.specialBoxes });
    if (r.status !== 200) throw new Error(`handover: ${JSON.stringify(r.body)}`);
  }
  for (const [p, b] of [['delivered', { deliveryPoint: point }]]) {
    const r = await ops('POST', `/days/${kind}/${id}/${p}`, b); if (r.status !== 200) throw new Error(`${p}: ${JSON.stringify(r.body)}`);
  }
}

test('security headers, 413 and junk availability', async () => {
  const h = await call('GET', '/health');
  assert.match(h.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(h.headers.get('x-frame-options'), 'DENY');
  assert.equal(h.headers.get('cache-control'), 'no-store');
  const big = await call('POST', '/business/quote', { pad: 'x'.repeat(300000) });
  assert.equal(big.status, 413);
  const av = await call('GET', `/availability?dates=hello,1999-01-01,${dates[0]}`);
  assert.deepEqual(Object.keys(av.body), [dates[0]]);
});

test('OTP: no account enumeration, resend spacing, failures survive resends', async () => {
  const otp = await call('POST', '/auth/otp', { mobile: '501110000' });
  assert.equal(otp.body.existingUser, undefined);
  assert.equal((await call('POST', '/auth/otp', { mobile: '501110000' })).status, 429, 'resend too soon');
  let wrong = 0;
  for (let round = 0; round < 4; round++) {
    allowResend('501110000');
    const r = await call('POST', '/auth/otp', { mobile: '501110000' });
    if (r.status !== 200) break;
    for (let i = 0; i < 5; i++) { const v = await call('POST', '/auth/verify', { mobile: '501110000', code: '000000' }); if (v.body.error === 'otp_wrong') wrong++; }
  }
  assert.ok(wrong <= 10, `at most 10 wrong guesses per hour, got ${wrong}`);
});

test('OTP: new number keeps its code until a first name is given', async () => {
  const otp = await call('POST', '/auth/otp', { mobile: '501112222' });
  const noName = await call('POST', '/auth/verify', { mobile: '501112222', code: otp.body.devCode });
  assert.equal(noName.body.error, 'name_required');
  const ok = await call('POST', '/auth/verify', { mobile: '501112222', code: otp.body.devCode, firstName: '<b>Lina</b>' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.firstName, 'bLina/b');
});

test('sessions: httpOnly cookie, expiry, sign out on all devices', async () => {
  const a = await signIn('502220000');
  const b = await signIn('502220000');
  assert.equal((await call('GET', '/me', null, { cookie: a.cookie })).status, 200);
  assert.equal((await call('PUT', '/me/settings', { coffeeReminder: false }, { cookie: a.cookie }, { 'content-type': 'text/plain' })).status, 403, 'cookie writes must be JSON');
  await call('POST', '/auth/logout-all', {}, { token: a.token });
  assert.equal((await call('GET', '/me', null, { token: b.token })).status, 401);
  const c = await signIn('502220000');
  db.prepare('UPDATE sessions SET expires_at = 1 WHERE token = ?').run(createHash('sha256').update(`session:${c.token}`).digest('hex'));   // stored hashed
  assert.equal((await call('GET', '/me', null, { token: c.token })).status, 401);
});

test('orders: email validated, idempotent, price check, edit adjustments', async () => {
  const u = await signIn('503330000');
  await call('PUT', '/me/profile', profile, u);
  const bad = await call('POST', '/orders', { days: [dayFor(dates[2])], address, email: 'not-an-email' }, u);
  assert.equal(bad.body.error, 'email_invalid');
  const wrongTotal = await call('POST', '/orders', { days: [dayFor(dates[2])], address, expectedTotal: 1 }, u);
  assert.equal(wrongTotal.status, 409);
  const key = 'checkout-abc12345';
  const first = await call('POST', '/orders', { days: [dayFor(dates[2])], address, idempotencyKey: key, expectedTotal: wrongTotal.body.details.total }, u);
  assert.equal(first.status, 201);
  const again = await call('POST', '/orders', { days: [dayFor(dates[2])], address, idempotencyKey: key }, u);
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id);
  assert.match(first.body.id, /^MB-[0-9A-F]{8}$/);
  const up = await call('PATCH', `/orders/${first.body.id}/days/${dates[2]}`, { size: 'large' }, u);
  assert.equal(up.status, 200);
  const dayId = db.prepare('SELECT id FROM order_days WHERE order_id = ?').get(first.body.id).id;
  const adj = db.prepare('SELECT amount FROM payment_adjustments WHERE order_day_id = ?').get(dayId);
  assert.ok(adj && adj.amount > 0, 'upsize recorded as a charge to collect');
  const n = await call('GET', '/me/notifications', null, u);
  assert.ok(n.body.some(x => x.kind === 'confirmed'));
});

test('safety: adding an allergy puts booked mornings on hold; window-only edits still work', async () => {
  const u = await signIn('504440000');
  await call('PUT', '/me/profile', profile, u);
  const o = await call('POST', '/orders', { days: [dayFor(dates[3]), dayFor(dates[4])], address }, u);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const okWindow = await call('PATCH', `/orders/${o.body.id}/days/${dates[4]}`, { window: 'w3' }, u);
  assert.equal(okWindow.body.days[1].window, 'w3');
  const allergic = { ...profile, allergies: ['egg', 'gluten', 'dairy'] };
  const p = await call('PUT', '/me/profile', allergic, u);
  assert.equal(p.body.review.length, 2);
  const after = await call('GET', `/orders/${o.body.id}`, null, u);
  assert.ok(after.body.days.every(d => d.safetyReview));
  const rec = recommendDay(allergic, 'regular');
  if (!rec.none) {
    const fixed = await call('PATCH', `/orders/${o.body.id}/days/${dates[3]}`, { recipeId: rec.primary.recipeId, components: rec.primary.components, size: 'regular', addons: [] }, u);
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
    assert.equal(fixed.body.days[0].safetyReview, false);
  }
  const notes = await call('GET', '/me/notifications', null, u);
  assert.ok(notes.body.some(x => x.kind === 'safety_review'));
});

test('feedback takes no free text (MB-PRD-001 §12), issue reports and account deletion', async () => {
  const u = await signIn('505550000');
  await call('PUT', '/me/profile', profile, u);
  const o = await call('POST', '/orders', { days: [dayFor(dates[5])], address }, u);
  assert.equal((await call('POST', `/orders/${o.body.id}/days/${dates[5]}/issue`, { reason: 'Not delivered' }, u)).body.error, 'issue_too_early');
  for (let i = 0; i < 3; i++) await call('POST', '/demo/advance', { orderId: o.body.id, date: dates[5] }, u);
  const f = await call('POST', `/orders/${o.body.id}/days/${dates[5]}/feedback`, { value: 'Loved it', note: 'Great eggs' }, u);
  assert.equal(f.body.days[0].feedback, 'Loved it');
  assert.equal(f.body.days[0].feedbackNote, '');
  db.prepare('UPDATE order_days SET date = ? WHERE order_id = ?').run(isoDate(new Date()), o.body.id);
  const today = isoDate(new Date());
  const r = await call('POST', `/orders/${o.body.id}/days/${today}/issue`, { reason: 'Allergy concern', note: 'Felt unwell' }, u);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.days[0].issues[0].reason, 'Allergy concern');
  const ex = await call('GET', '/ops/exceptions', null, {}, H);
  assert.ok(ex.body.some(e => e.kind === 'Safety Incident' && e.priority === 1));
  const open = await call('POST', '/orders', { days: [dayFor(dates[6])], address }, u);
  assert.equal((await call('DELETE', '/me', null, u)).body.error, 'orders_open');
  await call('POST', `/orders/${open.body.id}/days/${dates[6]}/cancel`, {}, u);
  assert.equal((await call('DELETE', '/me', null, u)).status, 200);
  assert.equal((await call('GET', '/me', null, u)).status, 401);
});

test('drink reminder is queued once the evening before', async () => {
  const u = await signIn('506660000');
  await call('PUT', '/me/profile', profile, u);
  await call('POST', '/orders', { days: [dayFor(dates[7])], address }, u);
  const evening = new Date(cutoffFor(dates[7]).getTime() - 3600e3); // 8:00 PM Dubai the evening before
  assert.ok(queueDrinkReminders(evening) >= 1);
  assert.equal(queueDrinkReminders(evening), 0, 'only once');
});

test('business: no fixed headcount, capacity checked before payment, merged lines, TRN, special size, delivered time', async () => {
  const u = await signIn('507770000');
  await call('POST', '/business/account', { company: 'Acme', email: 'ops@acme.example' }, u);
  const delivery = { company: 'Acme', building: 'Index Tower', office: '21', contact: 'Omar', mobile: '55 123 4567' };
  /* MB-DLV-001 §8: no fixed maximum headcount — a large group can be quoted… */
  assert.equal((await call('POST', '/business/quote', { days: [{ people: 31, lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 31 }] }] }, u)).status, 200);
  const merged = await call('POST', '/business/quote', { days: [{ people: 4, lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 2 }, { recipeId: 'savory.flexible.regular', size: 'regular', qty: 2 }] }] }, u);
  assert.equal(merged.body.days[0].lines.length, 1);
  assert.equal((await call('POST', '/business/quote', { days: Array.from({ length: 29 }, () => ({ people: 1, lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 1 }] })) }, u)).status, 400);
  const day = { date: dates[8], window: 'w1', people: 6, delivery,
    lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 4 }], specials: [{ dietary: ['vegan'], allergies: [], qty: 2, size: 'large' }] };
  assert.equal((await call('POST', '/business/orders', { days: [day], invoice: { trn: '123' } }, u)).body.error, 'trn_invalid');
  /* …but it isn't accepted when the window can't carry it (capacity 30 in this test). */
  const tooBig = await call('POST', '/business/orders', { days: [{ ...day, people: 31, lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 31 }], specials: [] }] }, u);
  assert.ok(['window_full', 'capacity_full'].includes(tooBig.body.error), JSON.stringify(tooBig.body));
  const o = await call('POST', '/business/orders', { days: [day] }, u);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const rows = await call('GET', `/ops/days?date=${dates[8]}`, null, {}, H);
  const row = rows.body.find(r => r.kind === 'business');
  assert.ok(row.production.some(p => p.special && p.size === 'large'));
  await assert.rejects(opsDeliver('business', row.id, dates[8], 'nowhere'), /point_required/);
  assert.equal((await call('POST', `/ops/days/business/${row.id}/delivered`, { deliveryPoint: 'Reception' }, {}, H)).status, 200);
  assert.ok((await call('GET', `/business/orders/${o.body.id}`, null, u)).body.days[0].deliveredAt);
  const inv = await call('GET', `/business/orders/${o.body.id}/invoice`, null, u);
  assert.match(inv.body, /VAT 5%/);
});

test('ops: validated dates, 404 on unknown exception, allocation honours allergen capability', async () => {
  assert.equal((await call('POST', '/ops/allocate', { date: 'garbage' }, {}, H)).status, 400);
  assert.equal((await call('POST', '/ops/exceptions/99999/resolve', {}, {}, H)).status, 404);
  const u = await signIn('508880000');
  const nutFree = { ...profile, allergies: ['treenut'] };
  await call('PUT', '/me/profile', nutFree, u);
  const o = await call('POST', '/orders', { days: [dayFor(dates[9], nutFree)], address }, u);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  /* Only Partner Bakery A is nut-free; with it inactive the box must not go to B or C. */
  db.prepare("UPDATE bakeries SET status = 'Suspended' WHERE name = 'Partner Bakery A'").run();
  const a = await call('POST', '/ops/allocate', { date: dates[9] }, {}, H);
  db.prepare("UPDATE bakeries SET status = 'Active' WHERE name = 'Partner Bakery A'").run();
  assert.equal(a.body.allocations.find(x => x.kind === 'personal').allocated, false);
  await call('POST', '/ops/allocate', { date: dates[9] }, {}, H);
  const open = db.prepare("SELECT COUNT(*) AS n FROM exceptions WHERE kind = 'Capacity Issue' AND resolved = 0").get().n;
  assert.equal(open, 1, 'repeated allocation does not duplicate exceptions');
});
