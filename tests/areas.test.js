import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
const { createApp } = await import('../server/app.js');
const { orderableDates, isoDate } = await import('../src/domain/standards.js');
const { recommendDay } = await import('../src/domain/app.js');

let server, base;
before(async () => { server = createApp().listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => server.close());
const call = async (method, path, body, token, headers = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const ops = (m, p, b) => call(m, `/ops${p}`, b, null, { 'x-ops-key': 'dev-ops-key' });
const profile = { eatingStyle: 'flexible', preferences: ['bakery'], dietary: [], allergies: [] };
const date = orderableDates(new Date(), 14).map(isoDate)[2];
const day = () => { const r = recommendDay(profile, 'regular'); return { date, context: 'regular', recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2' }; };

test('service areas: DIFC only at launch; Phase 2 area accepted once switched on', async () => {
  const { devCode } = (await call('POST', '/auth/otp', { mobile: '500000301' })).body;
  const token = (await call('POST', '/auth/verify', { mobile: '500000301', code: devCode, firstName: 'Rana' })).body.token;
  await call('PUT', '/me/profile', profile, token);
  assert.deepEqual((await call('GET', '/config')).body.areas, ['DIFC']);
  assert.equal((await ops('GET', '/admin/areas')).body.areas.find(a => a.id === 'Downtown Dubai').active, false);
  const downtown = { building: 'Boulevard Plaza', unit: 'Tower 1, 12', area: 'Downtown Dubai', handover: 'reception' };
  /* With one area live, any address is stored as that area. */
  const one = await call('POST', '/orders', { days: [day()], address: downtown }, token);
  assert.equal(one.status, 201, JSON.stringify(one.body));
  assert.equal(one.body.days[0].address.area, 'DIFC');
  assert.equal((await ops('PUT', '/admin/areas', { active: [] })).status, 400, 'at least one area stays on');
  assert.equal((await ops('PUT', '/admin/areas', { active: ['DIFC', 'Downtown Dubai'] })).status, 200);
  assert.deepEqual((await call('GET', '/config')).body.areas, ['DIFC', 'Downtown Dubai']);
  const ok = await call('POST', '/orders', { days: [{ ...day(), date: orderableDates(new Date(), 14).map(isoDate)[3] }], address: downtown }, token);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.days[0].address.area, 'Downtown Dubai');
  const meydan = await call('POST', '/orders', { days: [{ ...day(), date: orderableDates(new Date(), 14).map(isoDate)[4] }], address: { ...downtown, area: 'Meydan One' } }, token);
  assert.equal(meydan.body.error, 'area_unavailable', 'an area that is off is refused');
  await ops('PUT', '/admin/areas', { active: ['DIFC'] });
});
