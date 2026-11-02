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
