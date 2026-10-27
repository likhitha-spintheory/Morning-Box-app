import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_FROM;
const { createApp } = await import('../server/app.js');

let server, base;
before(async () => { server = createApp().listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => server.close());

const call = async (method, path, body, token) => {
  const res = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
};

/** Runs fn with Resend configured and its API replaced by `reply` (requests to the test server pass through). */
async function withResend(reply, fn) {
  const real = globalThis.fetch;
  const sent = [];
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.EMAIL_FROM = 'Morning Box <login@send.morningbox.ae>';
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.resend.com/')) return real(url, init);
    sent.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return reply();
  };
  try { await fn(sent); } finally {
    globalThis.fetch = real;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  }
}

test('sign up and sign back in with an email code', async () => {
  assert.equal((await call('POST', '/auth/otp', { email: 'not-an-email' })).body.error, 'email_invalid');
  const otp = await call('POST', '/auth/otp', { email: ' Lina@Example.com ' });
  assert.equal(otp.status, 200);
  const wrong = await call('POST', '/auth/verify', { email: 'lina@example.com', code: otp.body.devCode === '000000' ? '111111' : '000000' });
  assert.equal(wrong.body.error, 'otp_wrong');
  assert.match(wrong.body.message, /Check the email/);
  assert.equal((await call('POST', '/auth/verify', { email: 'lina@example.com', code: otp.body.devCode })).body.error, 'name_required');
  const v = await call('POST', '/auth/verify', { email: 'lina@example.com', code: otp.body.devCode, firstName: 'Lina' });
  assert.equal(v.status, 200);
  assert.equal(v.body.user.loginEmail, 'lina@example.com');
  assert.equal(v.body.user.email, 'lina@example.com');
  assert.equal(v.body.user.mobile, '');
  assert.equal((await call('GET', '/me', null, v.body.token)).status, 200);
  /* A used code cannot be used again. */
  assert.equal((await call('POST', '/auth/verify', { email: 'lina@example.com', code: otp.body.devCode })).body.error, 'otp_expired');

  /* Addresses are case-insensitive, and the 30 s resend spacing applies to emails too. */
  const again = await call('POST', '/auth/otp', { email: 'LINA@example.com' });
  assert.equal(again.body.error, 'otp_wait');
});

test('a mobile account can add a sign-in email, which then signs in to it', async () => {
  const m = await call('POST', '/auth/otp', { mobile: '501230001' });
  const token = (await call('POST', '/auth/verify', { mobile: '501230001', code: m.body.devCode, firstName: 'Omar' })).body.token;
  const e = await call('POST', '/auth/otp', { email: 'omar@company.ae' });
  const wrong = await call('POST', '/auth/change-email', { email: 'omar@company.ae', code: e.body.devCode === '000000' ? '111111' : '000000' }, token);
  assert.equal(wrong.body.error, 'otp_wrong');
  const linked = await call('POST', '/auth/change-email', { email: 'omar@company.ae', code: e.body.devCode }, token);
  assert.equal(linked.status, 200);
  assert.equal(linked.body.user.loginEmail, 'omar@company.ae');
  assert.equal(linked.body.user.mobile, '+971 50 123 0001');

  /* Another account cannot claim it. */
  const other = await call('POST', '/auth/otp', { mobile: '501230002' });
  const otherToken = (await call('POST', '/auth/verify', { mobile: '501230002', code: other.body.devCode, firstName: 'Rana' })).body.token;
  assert.equal((await call('POST', '/auth/change-email', { email: 'omar@company.ae', code: '123456' }, otherToken)).body.error, 'email_taken');

  /* Wait out the resend spacing by clearing it, then sign in by email: Omar's account. */
  const { db } = await import('../server/db.js');
  db.prepare("UPDATE otp_codes SET last_sent = 0 WHERE mobile = 'email:omar@company.ae'").run();
  const e2 = await call('POST', '/auth/otp', { email: 'omar@company.ae' });
  const v = await call('POST', '/auth/verify', { email: 'omar@company.ae', code: e2.body.devCode });
  assert.equal(v.status, 200);
  assert.equal(v.body.user.firstName, 'Omar');
  assert.equal(v.body.user.mobile, '+971 50 123 0001');
});

test('with Resend configured the code is emailed from the configured sender', async () => {
  await withResend(() => new Response('{"id":"x"}', { status: 200 }), async sent => {
    const r = await call('POST', '/auth/otp', { email: 'noor@example.com' });
    assert.equal(r.status, 200);
    assert.equal(sent.length, 1);
    const [{ url, headers, body }] = sent;
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(headers.authorization, 'Bearer re_test_key');
    assert.deepEqual(body.to, ['noor@example.com']);
    assert.equal(body.from, 'Morning Box <login@send.morningbox.ae>');
    assert.ok(body.subject.includes(r.body.devCode) && body.text.includes(r.body.devCode));
  });
});

test('an email Resend refuses is a 502 and can be retried straight away', async () => {
  await withResend(() => new Response('{"message":"domain not verified"}', { status: 403 }), async () => {
    const r = await call('POST', '/auth/otp', { email: 'mira@example.com' });
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'email_failed');
    assert.equal((await call('POST', '/auth/otp', { email: 'mira@example.com' })).status, 502);   // not blocked by the 30 s spacing
  });
});

test('the app is told which sign-in methods can deliver codes', async () => {
  const { body } = await call('GET', '/config');
  assert.deepEqual(body.signIn, { email: true, mobile: true });   // development: codes go to the server log
});

/** Runs fn with WhatsApp configured and Meta's API replaced by `reply`. */
async function withWhatsApp(reply, fn) {
  const real = globalThis.fetch;
  const sent = [];
  Object.assign(process.env, { WHATSAPP_TOKEN: 'EAAG-test', WHATSAPP_PHONE_NUMBER_ID: '1234567890' });
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://graph.facebook.com/')) return real(url, init);
    sent.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return reply();
  };
  try { await fn(sent); } finally {
    globalThis.fetch = real;
    delete process.env.WHATSAPP_TOKEN; delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  }
}

test('mobile sign-in codes are sent as a WhatsApp authentication template', async () => {
  await withWhatsApp(() => new Response('{"messages":[{"id":"wamid.x"}]}', { status: 200 }), async sent => {
    const r = await call('POST', '/auth/otp', { mobile: '050 777 1234' });
    assert.equal(r.status, 200);
    assert.equal(sent.length, 1);
    const [{ url, headers, body }] = sent;
    assert.equal(url, 'https://graph.facebook.com/v21.0/1234567890/messages');
    assert.equal(headers.authorization, 'Bearer EAAG-test');
    assert.equal(body.to, '971507771234');
    assert.equal(body.template.name, 'morningbox_login');
    assert.deepEqual(body.template.components[0].parameters, [{ type: 'text', text: r.body.devCode }]);
    assert.equal(body.template.components[1].parameters[0].text, r.body.devCode);
    const wrong = await call('POST', '/auth/verify', { mobile: '507771234', code: r.body.devCode === '000000' ? '111111' : '000000' });
    assert.match(wrong.body.message, /Check the WhatsApp/);
  });
});

test('a WhatsApp message Meta refuses is a 502 and can be retried straight away', async () => {
  await withWhatsApp(() => new Response('{"error":{"code":132001,"message":"template does not exist"}}', { status: 400 }), async () => {
    const r = await call('POST', '/auth/otp', { mobile: '507771299' });
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'whatsapp_failed');
    assert.equal((await call('POST', '/auth/otp', { mobile: '507771299' })).status, 502);
  });
});
