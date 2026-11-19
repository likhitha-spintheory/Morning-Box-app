import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const { LEGAL_PAGES, legalDocument } = await import('../src/legal/documents.js');

let server, root, base;
before(async () => { server = createApp().listen(0); await new Promise(r => server.once('listening', r)); root = `http://127.0.0.1:${server.address().port}`; base = `${root}/api`; });
after(() => server.close());
const call = async (method, path, body, token) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const signIn = async (mobile, extra = {}) => {
  const { devCode } = (await call('POST', '/auth/otp', { mobile })).body;
  return (await call('POST', '/auth/verify', { mobile, code: devCode, firstName: 'Layla', ...extra })).body.token;
};
const plain = { eatingStyle: 'flexible', preferences: ['savory'], dietary: [], allergies: [] };

test('legal pages are public, complete and have no unfilled [placeholders]', async () => {
  for (const [id] of LEGAL_PAGES) {
    const res = await fetch(`${root}/${id}`);
    assert.equal(res.status, 200, id);
    const html = await res.text();
    assert.match(html, /<h1>/);
    assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/, ''), /\[[^\]]*\]/, `${id} has a bracketed placeholder`);
    assert.match(html, /Studio Nest L\.L\.C-FZ/, `${id} names the operator`);
  }
  assert.match(legalDocument('refunds', { windows: ['7:30 – 8:30 AM'] }).blocks.find(b => b.ul?.some(x => x.startsWith('Windows'))).ul.join(), /7:30 – 8:30 AM/);
});

test('allergy and dietary data is saved only with explicit consent, and withdrawal deletes it (B1, B6)', async () => {
  const t = await signIn('500000901');
  const nut = { ...plain, allergies: ['treenut'] };
  const refused = await call('PUT', '/me/profile', nut, t);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'consent_required');
  assert.equal((await call('PUT', '/me/profile', plain, t)).status, 200, 'no health data needs no consent');
  const ok = await call('PUT', '/me/profile', { ...nut, healthConsent: true }, t);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.profile.healthConsent, true);
  const off = await call('PUT', '/me/profile', { ...plain, healthConsent: false }, t);
  assert.equal(off.body.profile.healthConsent, false);
  assert.deepEqual(off.body.profile.allergies, []);
  const userId = db.prepare('SELECT id FROM users WHERE mobile = ?').get('+971500000901').id;
  assert.deepEqual(db.prepare("SELECT value FROM consent_log WHERE user_id = ? AND kind = 'health' ORDER BY id").all(userId).map(r => r.value), ['granted', 'withdrawn']);
  assert.ok(db.prepare("SELECT version, created_at FROM consent_log WHERE user_id = ? AND kind = 'terms'").get(userId)?.version, 'terms acceptance is recorded with its version');
  const exported = await call('GET', '/me/export', null, t);
  assert.ok(exported.body.consents.length >= 3, 'consent history is part of the data export');
});

test('an account holding allergy data without consent cannot order until it is confirmed', async () => {
  const t = await signIn('500000902');
  await call('PUT', '/me/profile', { ...plain, allergies: ['egg'], healthConsent: true }, t);
  db.prepare("UPDATE profiles SET health_consent_at = NULL WHERE user_id = (SELECT id FROM users WHERE mobile = '+971500000902')").run();
  const r = await call('POST', '/orders', { days: [], address: { building: 'Gate Village 4', unit: '2', area: 'DIFC' } }, t);
  assert.equal(r.body.error, 'consent_required');
});

test('marketing is opt-in at sign-up and recorded; cookie choices are recorded (B2, B5)', async () => {
  const yes = await signIn('500000903', { offers: true });
  assert.equal((await call('GET', '/me', null, yes)).body.settings.offers, true);
  const no = await signIn('500000904');
  assert.equal((await call('GET', '/me', null, no)).body.settings.offers, false, 'never pre-ticked');
  assert.equal((await call('PUT', '/me/settings', { offers: true }, no)).body.settings.offers, true);
  const id = db.prepare("SELECT id FROM users WHERE mobile = '+971500000904'").get().id;
  assert.ok(db.prepare('SELECT marketing_opt_in_at FROM users WHERE id = ?').get(id).marketing_opt_in_at);
  assert.equal((await call('POST', '/consents', { analytics: false })).status, 204);
  assert.equal((await call('POST', '/consents', { analytics: 'yes' })).status, 400);
  assert.equal(db.prepare("SELECT value FROM consent_log WHERE kind = 'cookies' ORDER BY id DESC").get().value, 'analytics:off');
});
