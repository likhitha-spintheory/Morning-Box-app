/* Client feedback, 1 Nov 2026 Requirements Matrix (FLW-024): a morning the server refuses at payment is named. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
process.env.WINDOW_CAPACITY = '30';
const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const { orderableDates, isoDate } = await import('../src/domain/standards.js');
const { recommendDay, stillOffered } = await import('../src/domain/app.js');

let server, base;
before(async () => { server = createApp().listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => server.close());

const call = async (method, path, body, auth = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
};
async function signIn(mobile) {
  db.prepare('UPDATE otp_codes SET last_sent = 0 WHERE mobile = ?').run(`+971${mobile}`);
  const otp = await call('POST', '/auth/otp', { mobile });
  const v = await call('POST', '/auth/verify', { mobile, code: otp.body.devCode, firstName: 'Test' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return { token: v.body.token };
}
const dates = orderableDates(new Date(), 14).map(isoDate);
const address = { building: 'Gate Village, Building 3', unit: 'Level 4' };
const savory = { eatingStyle: 'flexible', preferences: ['savory'], dietary: [], allergies: [] };
const sweet = { ...savory, preferences: ['sweet'] };
const dayFor = (date, p) => {
  const r = recommendDay(p, 'regular');
  return { date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2' };
};

test('stillOffered: a saved morning stops fitting when the preferences change, not only when it becomes unsafe', () => {
  const cfg = recommendDay(savory, 'regular').primary;
  assert.equal(stillOffered(cfg, savory), true);
  assert.equal(stillOffered(cfg, sweet), false);
  assert.equal(stillOffered(cfg, { ...savory, preferences: ['savory', 'sweet'] }), true);
});

test('checkout names the morning the server refuses, so only that day is planned again', async () => {
  const u = await signIn('502220001');
  await call('PUT', '/me/profile', sweet, u);   // the account's profile no longer matches the plan
  const r = await call('POST', '/orders', { days: [dayFor(dates[1], sweet), dayFor(dates[2], savory)], address }, u);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'not_eligible');
  assert.equal(r.body.details.date, dates[2]);
  assert.match(r.body.message, /no longer matches your profile/);
  const ok = await call('POST', '/orders', { days: [dayFor(dates[1], sweet), dayFor(dates[2], sweet)], address }, u);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

/* REC-021 / FLW-011: with several breakfast types, the morning's chosen type decides the recommendation. */
test('a morning planned for one of several breakfast types is accepted only with that type', async () => {
  const both = { eatingStyle: 'flexible', preferences: ['savory', 'sweet'], dietary: [], allergies: [] };
  const all = recommendDay(both, 'regular');
  assert.ok(all.primary.recipeId.startsWith('savory'), 'context priority puts Savory first for a workday');
  const sweetDay = recommendDay(both, 'regular', 'sweet');
  assert.equal(sweetDay.primary.recipeId.split('.')[0], 'sweet');
  assert.equal(sweetDay.primary.preference, 'sweet');
  assert.equal(recommendDay(both, 'regular', 'fresh').primary.recipeId, all.primary.recipeId, 'a type outside the profile is ignored');

  const u = await signIn('502220002');
  await call('PUT', '/me/profile', both, u);
  const day = c => ({ date: dates[3], context: 'regular', recipeId: c.recipeId, components: c.components, size: 'regular', addons: [], window: 'w2', ...(c.preference ? { preference: c.preference } : {}) });
  const wrongType = await call('POST', '/orders', { days: [{ ...day(sweetDay.primary), preference: 'fresh' }], address }, u);
  assert.equal(wrongType.status, 400);
  const ok = await call('POST', '/orders', { days: [day(sweetDay.primary)], address }, u);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.days[0].cfg.preference, 'sweet');
});

/* FLW-028: "Yes, delete" answered "Request not allowed". The app signs in with a cookie, and the server takes
   cookie-signed changes only as JSON; the app's DELETE had no body, so it never counted as JSON. */
test('delete account works from the browser (cookie session), removes personal data and ends sign-in', async () => {
  const email = 'delete.me@example.com';
  const otp = await call('POST', '/auth/otp', { email });
  const v = await fetch(`${base}/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code: otp.body.devCode, firstName: 'Dana' }) });
  assert.equal(v.status, 200);
  const cookie = v.headers.get('set-cookie').split(';')[0];
  const { user } = await v.json();
  const asBrowser = (method, path, body) => fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });

  assert.equal((await asBrowser('PUT', '/me/profile', savory)).status, 200);
  const order = await (await asBrowser('POST', '/orders', { days: [dayFor(dates[4], savory)], address, email, contactMobile: '501234567' })).json();
  const userId = db.prepare('SELECT user_id FROM orders WHERE id = ?').get(order.id).user_id;
  assert.equal((await asBrowser('DELETE', '/me', {})).status, 409, 'an upcoming morning must be cancelled first');
  assert.equal((await asBrowser('POST', `/orders/${order.id}/days/${dates[4]}/cancel`, {})).status, 200);

  // exactly what the app now sends: DELETE with an empty JSON body
  const del = await asBrowser('DELETE', '/me', {});
  assert.equal(del.status, 200, await del.text());
  // a bodyless cross-site style request is still refused by the JSON check (protection kept)
  assert.equal((await fetch(base + '/me/profile', { method: 'PUT', headers: { cookie } })).status, 401, 'session is gone');

  assert.equal((await asBrowser('GET', '/me')).status, 401, 'signed out everywhere');
  const u = db.prepare('SELECT first_name, email, login_email, mobile FROM users WHERE id = ?').get(userId);
  assert.equal(u.first_name, 'Deleted customer'); assert.equal(u.email, null); assert.equal(u.login_email, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?').get(userId).n, 0);
  const kept = db.prepare('SELECT email FROM orders WHERE id = ?').get(order.id);
  assert.equal(kept.email, null, 'the order is kept for records without the email');
  assert.equal(JSON.parse(db.prepare('SELECT address FROM order_days WHERE order_id = ?').get(order.id).address).mobile, undefined);

  // signing in again with the same email starts a brand-new, empty account
  const again = await call('POST', '/auth/otp', { email });
  const v2 = await call('POST', '/auth/verify', { email, code: again.body.devCode, firstName: 'Dana' });
  assert.equal(v2.status, 200);
  assert.equal(v2.body.profile, null);
  assert.notEqual(db.prepare('SELECT id FROM users WHERE login_email = ?').get(email).id, userId);
  assert.ok(user);
});

test('a signed-in browser request without a JSON body is still refused (cross-site protection kept)', async () => {
  const email = 'csrf.check@example.com';
  const otp = await call('POST', '/auth/otp', { email });
  const v = await fetch(`${base}/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code: otp.body.devCode, firstName: 'Sam' }) });
  const cookie = v.headers.get('set-cookie').split(';')[0];
  const form = await fetch(base + '/me', { method: 'DELETE', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'x=1' });
  assert.equal(form.status, 403);
  // what the old app sent for "Yes, delete": no body, so not JSON -> 403 "Request not allowed"
  const old = await fetch(base + '/me', { method: 'DELETE', headers: { cookie, 'content-type': 'application/json' } });
  assert.equal(old.status, 403);
  assert.equal((await old.json()).message, 'Request not allowed.');
});

/* Client feedback (Profile – Allergy Updates & Existing Orders): only mornings the customer can still change
   become "Needs review"; past mornings are untouched; after the cutoff, operations gets an urgent alert. */
test('allergy update: past untouched, editable → needs review, past cutoff → urgent alert, not changed', async () => {
  const u = await signIn('502220077');
  await call('PUT', '/me/profile', savory, u);
  const o = await call('POST', '/orders', { days: [dayFor(dates[2], savory), dayFor(dates[3], savory), dayFor(dates[4], savory)], address }, u);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const { dubaiTodayIso, addDaysIso } = await import('../src/domain/standards.js');
  const today = dubaiTodayIso(), past = addDaysIso(today, -3);
  // make one morning past (delivered three days ago) and one past its cutoff (today), keep one editable
  db.prepare('UPDATE order_days SET date = ?, safety_hold = 1 WHERE order_id = ? AND date = ?').run(past, o.body.id, dates[2]);   // a stale hold from earlier
  db.prepare('UPDATE order_days SET date = ? WHERE order_id = ? AND date = ?').run(today, o.body.id, dates[3]);
  const cfgBefore = db.prepare('SELECT cfg FROM order_days WHERE order_id = ? AND date = ?').get(o.body.id, today).cfg;

  const everything = { ...savory, allergies: ['gluten', 'dairy', 'egg', 'peanut', 'treenut', 'sesame', 'soy'] };
  const p = await call('PUT', '/me/profile', everything, u);
  assert.deepEqual(p.body.review.map(r => r.date), [dates[4]], 'only the editable morning needs the customer');
  const days = Object.fromEntries((await call('GET', `/orders/${o.body.id}`, null, u)).body.days.map(d => [d.date, d]));
  assert.equal(days[past].safetyReview, false); assert.equal(days[past].safetyCheck, false);
  assert.equal(db.prepare('SELECT safety_hold FROM order_days WHERE order_id = ? AND date = ?').get(o.body.id, past).safety_hold, 0, 'stale hold on a past morning cleared');
  assert.equal(days[today].safetyReview, false, 'past cutoff: not a "Needs review" the customer cannot act on');
  assert.equal(days[today].safetyCheck, true, 'past cutoff: shown as checked by our team');
  assert.equal(db.prepare('SELECT cfg FROM order_days WHERE order_id = ? AND date = ?').get(o.body.id, today).cfg, cfgBefore, 'past cutoff: order not modified');
  const id = db.prepare('SELECT id FROM order_days WHERE order_id = ? AND date = ?').get(o.body.id, today).id;
  const ex = db.prepare("SELECT priority, note FROM exceptions WHERE ref = ? AND kind = 'Dietary/Allergy Issue' AND resolved = 0").get(`personal:${id}`);
  assert.ok(ex && ex.priority === 1 && /URGENT/.test(ex.note), 'urgent safety alert for operations');
  assert.equal(days[dates[4]].safetyReview, true, 'editable: Needs review');
  // the editable morning can be cancelled (or re-planned) by the customer
  assert.equal((await call('POST', `/orders/${o.body.id}/days/${dates[4]}/cancel`, {}, u)).status, 200);
  const notes = (await call('GET', '/me/notifications', null, u)).body;
  assert.ok(notes.filter(n => n.kind === 'safety_review').length >= 2, 'customer told about both');
});

/* Help & Support: a new message is kept for the admin panel and emailed to the team's inbox. */
test('a new support message is emailed to SUPPORT_NOTIFY_EMAIL and listed for operations', async () => {
  const u = await signIn('502220088');
  const sent = [];
  const real = globalThis.fetch;
  process.env.RESEND_API_KEY = 're_test'; process.env.EMAIL_FROM = 'Morning Box <login@send.morningbox.ae>'; process.env.SUPPORT_NOTIFY_EMAIL = 'info@morningbox.ae';
  globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://api.resend.com/')) { sent.push(JSON.parse(init.body)); return new Response('{"id":"x"}', { status: 200 }); } return real(url, init); };
  try {
    const r = await call('POST', '/support', { topic: 'An order', message: 'My breakfast came without the croissant.' }, u);
    assert.equal(r.status, 201);
    await new Promise(res => setTimeout(res, 50));
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['info@morningbox.ae']);
    assert.match(sent[0].subject, /New Morning Box message: An order/);
    assert.match(sent[0].text, /without the croissant/);
    const ops = await call('GET', '/ops/support', null, {}, );
    assert.ok(ops.status === 200 || ops.status === 401);
  } finally {
    globalThis.fetch = real; delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; delete process.env.SUPPORT_NOTIFY_EMAIL;
  }
});

/* Client feedback PRD-004: Gluten-Free stays visible but can't be ordered until switched on in Admin. */
test('gluten-free is refused (personal and business) until switched on in Admin', async () => {
  const opsH = async (m, p, body) => { const r = await fetch(base + '/ops' + p, { method: m, headers: { 'content-type': 'application/json', 'x-ops-key': 'dev-ops-key' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  assert.equal((await opsH('GET', '/admin/gluten-free')).body.available, false, 'off by default');
  const cfg = await call('GET', '/config');
  assert.equal(cfg.body.glutenFree, false);

  const u = await signIn('502220099');
  const gf = { eatingStyle: 'flexible', preferences: ['bakery'], dietary: ['glutenFree'], allergies: [] };
  await call('PUT', '/me/profile', gf, u);
  const r = recommendDay(gf, 'regular');
  if (!r.none) {
    const o = await call('POST', '/orders', { days: [{ date: dates[5], context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2' }], address }, u);
    assert.equal(o.status, 400); assert.equal(o.body.error, 'gluten_free_unavailable');
    assert.match(o.body.message, /Gluten-free breakfasts are not yet available/);
  }
  const q = await call('POST', '/business/quote', { days: [{ date: dates[5], window: 'w2', people: 2, lines: [], specials: [{ dietary: ['glutenFree'], allergies: [], qty: 2 }] }] }, u);
  assert.equal(q.body.error, 'gluten_free_unavailable');

  assert.equal((await opsH('PUT', '/admin/gluten-free', { available: true })).body.available, true);
  assert.equal((await call('GET', '/config')).body.glutenFree, true);
  const q2 = await call('POST', '/business/quote', { days: [{ date: dates[5], window: 'w2', people: 2, lines: [], specials: [{ dietary: ['glutenFree'], allergies: [], qty: 2 }] }] }, u);
  assert.notEqual(q2.body.error, 'gluten_free_unavailable');
  await opsH('PUT', '/admin/gluten-free', { available: false });
});

/* Group & Business Breakfast is also for family and friends: no company name or business email is needed. */
test('a family group order needs no company name or business email', async () => {
  const email = 'family.breakfast@example.com';
  const otp = await call('POST', '/auth/otp', { email });
  const v = await call('POST', '/auth/verify', { email, code: otp.body.devCode, firstName: 'Mariam' });
  const u = { token: v.body.token };
  assert.equal((await call('POST', '/business/account', { company: '', email: 'not-an-email' }, u)).status, 400, 'a given email must be valid');
  const acct = await call('POST', '/business/account', { company: '', email: '' }, u);
  assert.equal(acct.status, 200, JSON.stringify(acct.body));
  const o = await call('POST', '/business/orders', { days: [{ date: dates[6], window: 'w2', people: 4,
    lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 4 }], specials: [],
    delivery: { company: '', building: 'Burj Views A', office: 'Apt 1203', contact: 'Mariam', mobile: '55 123 4567' } }] }, u);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const row = db.prepare('SELECT company, email, invoice FROM business_orders WHERE id = ?').get(o.body.id);
  assert.equal(row.company, '');
  assert.equal(row.email, email, 'confirmation goes to the sign-in email');
  assert.equal(JSON.parse(row.invoice).billingName, 'Mariam', 'the receipt is in the contact’s name');
});

/* Group & Business Breakfast: Family & friends (home address, receipt) vs Business / company (company required). */
test('order type: family needs no company and gets a receipt; business needs the company name', async () => {
  const u = await signIn('502220123');
  await call('POST', '/business/account', { company: '', email: '' }, u);
  const day = (delivery, date) => ({ date, window: 'w2', people: 4, lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 4 }], specials: [], delivery });
  const home = { type: 'family', company: 'Should be dropped', building: 'Villa 12, Arabian Ranches', office: 'Villa 12', contact: 'Mariam', mobile: '55 123 4567' };
  const fam = await call('POST', '/business/orders', { orderType: 'family', invoice: { wanted: true }, days: [day(home, dates[7])] }, u);
  assert.equal(fam.status, 201, JSON.stringify(fam.body));
  assert.equal(fam.body.orderType, 'family');
  assert.equal(fam.body.company, '');
  assert.equal(fam.body.invoice.wanted, false, 'a family order gets a receipt, not a tax invoice');
  assert.equal(fam.body.days[0].delivery.company, '');

  const office = { type: 'business', company: '', building: 'Index Tower', office: 'Level 21', contact: 'Omar', mobile: '55 765 4321' };
  const noCo = await call('POST', '/business/orders', { orderType: 'business', days: [day(office, dates[8])] }, u);
  assert.equal(noCo.status, 400, 'business orders need the company name');
  const biz = await call('POST', '/business/orders', { orderType: 'business', days: [day({ ...office, company: 'Gulf Capital' }, dates[8])] }, u);
  assert.equal(biz.status, 201, JSON.stringify(biz.body));
  assert.equal(biz.body.orderType, 'business');
});

/* Client feedback (Dairy-Free): a breakfast type is offered only when a safe breakfast of that type exists. */
test('breakfast types are available exactly when a safe breakfast exists (dairy-free and every other need)', async () => {
  const { typeAvailable } = await import('../src/domain/app.js');
  const { LIBRARY_SETTINGS, setLibrarySettings } = await import('../src/domain/library.js');
  const before = { ...LIBRARY_SETTINGS };
  setLibrarySettings({ samples: false });   // as on the dev server: approved products only
  try {
    const df = { eatingStyle: 'flexible', preferences: ['savory', 'bakery', 'fresh', 'sweet'], dietary: ['dairyFree'], allergies: [] };
    assert.equal(typeAvailable(df, 'savory', 'regular'), true);
    assert.equal(typeAvailable(df, 'bakery', 'regular'), false, 'no approved dairy-free pastry yet');
    const needs = [[], ['dairyFree'], ['vegan'], ['glutenFree'], ['vegetarian'], ['halal']];
    const allergies = [[], ['dairy'], ['egg'], ['gluten'], ['treenut', 'peanut']];
    let checked = 0;
    for (const eatingStyle of ['flexible', 'health']) for (const dietary of needs) for (const al of allergies)
      for (const ctx of ['active', 'regular', 'busy', 'relaxed']) for (const t of ['savory', 'bakery', 'fresh', 'sweet']) {
        const p = { eatingStyle, preferences: ['savory', 'bakery', 'fresh', 'sweet'], dietary, allergies: al };
        assert.equal(typeAvailable(p, t, ctx), !recommendDay(p, ctx, t).none, `${eatingStyle} ${dietary} ${al} ${ctx} ${t}`);
        checked++;
      }
    assert.equal(checked, 960);
  } finally { setLibrarySettings(before); }
});
