import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Asia/Dubai';
process.env.DB_FILE = ':memory:';
const { createApp } = await import('../server/app.js');
const { recommendDay } = await import('../src/domain/app.js');

let server, base;
before(async () => { server = createApp().listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => server.close());

const ops = async (method, path, body, key = 'dev-ops-key') => {
  const res = await fetch(`${base}/ops${path}`, { method, headers: { 'content-type': 'application/json', 'x-ops-key': key }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const clone = v => structuredClone(v);

test('menu rules need the operations key', async () => {
  assert.equal((await ops('GET', '/admin/menu', null, 'wrong')).status, 401);
});

test('the approved menu is served with the lists the console needs', async () => {
  const r = await ops('GET', '/admin/menu');
  assert.equal(r.status, 200);
  assert.equal(Object.keys(r.body.menu.breakfasts).length, 32);
  assert.deepEqual(r.body.menu.breakfasts['savory.health.busy'].components, ['wholeWheatSourdough', 'scrambledEggs', 'avocado', 'mixedGreens']);
  assert.ok(r.body.lists.allergens.some(a => a.id === 'dairy'));
  assert.deepEqual(r.body.menu.priority.busy, ['bakery', 'savory', 'sweet', 'fresh']);
});

test('rejects unsafe or inconsistent rules', async () => {
  const { menu } = (await ops('GET', '/admin/menu')).body;
  const flex = clone(menu); flex.breakfasts['savory.health.regular'].components.push('chickenSausage');
  assert.match((await ops('PUT', '/admin/menu', flex)).body.message, /Health-Conscious/);
  const dairy = clone(menu); dairy.items.greekYogurt.diet.push('dairyFree');
  assert.match((await ops('PUT', '/admin/menu', dairy)).body.message, /contains dairy/);
  const badAllergen = clone(menu); badAllergen.items.honey.allergens = ['shellfish'];
  assert.equal((await ops('PUT', '/admin/menu', badAllergen)).status, 400);
  const prio = clone(menu); prio.priority.busy = ['bakery', 'bakery', 'sweet', 'fresh'];
  assert.match((await ops('PUT', '/admin/menu', prio)).body.message, /rank all four/);
  const gone = clone(menu); delete gone.items.honey;
  assert.match((await ops('PUT', '/admin/menu', gone)).body.message, /can't be deleted/);
  const empty = clone(menu); empty.breakfasts['sweet.flexible.busy'].components = [];
  assert.equal((await ops('PUT', '/admin/menu', empty)).status, 400);
});

test('a saved change applies to the next recommendation and is recorded', async () => {
  const profile = { eatingStyle: 'health', preferences: ['savory', 'fresh'], dietary: [], allergies: [] };
  assert.equal(recommendDay(profile, 'busy').primary.recipeId, 'savory.health.busy');
  const { menu } = (await ops('GET', '/admin/menu')).body;
  const next = clone(menu);
  next.priority.busy = ['fresh', 'savory', 'bakery', 'sweet'];
  next.items.avocado.allergens = ['sesame'];
  const saved = await ops('PUT', '/admin/menu', next);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.ok(saved.body.changes.some(c => /Priority busy/.test(c)) && saved.body.changes.some(c => /Avocado: allergens/.test(c)));
  assert.equal(recommendDay(profile, 'busy').primary.recipeId, 'fresh.health.busy', 'priority change used straight away');
  /* Avocado now "contains sesame": the savory busy sandwich is no longer safe for a sesame allergy. */
  const sesame = recommendDay({ ...profile, preferences: ['savory'], allergies: ['sesame'] }, 'busy');
  assert.notEqual(sesame.primary?.recipeId, 'savory.health.busy');
  const tried = await ops('POST', '/admin/menu/try', { ...profile, context: 'busy' });
  assert.equal(tried.body.primary.recipeId, 'fresh.health.busy');
  const config = await (await fetch(`${base}/config`)).json();
  assert.deepEqual(config.menu.priority.busy, ['fresh', 'savory', 'bakery', 'sweet'], 'the app receives the rules');
  assert.ok((await ops('GET', '/admin/menu')).body.history.length >= 1);
});

test('adds a food item and uses it in a breakfast', async () => {
  const { menu } = (await ops('GET', '/admin/menu')).body;
  const next = clone(menu);
  next.items.tmp = { name: 'Za’atar Manakish', category: 'Bread', portions: { light: '1/2 pc', regular: '1 pc', large: '1 1/2 pc' }, allergens: ['gluten', 'sesame'], diet: ['vegetarian', 'vegan', 'dairyFree', 'halal'], flexibleOnly: false, swapGroup: '' };
  const r = await ops('PUT', '/admin/menu', next);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const id = Object.keys(r.body.menu.items).find(k => r.body.menu.items[k].name === 'Za’atar Manakish');
  assert.ok(id && id !== 'tmp');
  const withIt = clone(r.body.menu);
  withIt.breakfasts['bakery.flexible.regular'].components[0] = id;
  assert.equal((await ops('PUT', '/admin/menu', withIt)).status, 200);
  const pick = recommendDay({ eatingStyle: 'flexible', preferences: ['bakery'], dietary: [], allergies: [] }, 'regular');
  assert.ok(pick.primary.components.includes(id));
  const blocked = recommendDay({ eatingStyle: 'flexible', preferences: ['bakery'], dietary: [], allergies: ['sesame'] }, 'regular');
  assert.ok(!blocked.primary?.components.includes(id), 'allergen filter applies to the new item');
});

test('reset brings back the approved menu', async () => {
  const r = await ops('POST', '/admin/menu/reset');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.menu.priority.busy, ['bakery', 'savory', 'sweet', 'fresh']);
  assert.deepEqual(r.body.menu.items.avocado.allergens, []);
  assert.ok(!Object.values(r.body.menu.items).some(i => i.custom), 'added items removed');
  assert.equal(recommendDay({ eatingStyle: 'health', preferences: ['savory', 'fresh'], dietary: [], allergies: [] }, 'busy').primary.recipeId, 'savory.health.busy');
});

test('staff codes: a device is blocked after 20 wrong codes in an hour', async () => {
  for (let i = 0; i < 20; i++) assert.equal((await fetch(`${base}/bakery/me`, { headers: { 'x-bakery-code': `wrong${i}` } })).status, 401);
  assert.equal((await fetch(`${base}/bakery/me`, { headers: { 'x-bakery-code': 'wrong-again' } })).status, 429);
  assert.equal((await ops('GET', '/admin/menu')).status, 200, 'the operations key is counted separately');
});

test('try-it shows the approved build used for an allergy', async () => {
  const r = await ops('POST', '/admin/menu/try', { eatingStyle: 'health', preferences: ['fresh'], allergies: ['dairy'], context: 'busy' });
  assert.ok(r.body.primary.names.some(n => /Coconut yogurt/.test(n)), JSON.stringify(r.body.primary.names));
  assert.ok(!r.body.primary.names.includes('Greek Yogurt'));
});
