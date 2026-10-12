// Loads test data for trying the app and the operations console (development only).
//
//   npm run seed                 # into data/morningbox.db (or DB_FILE)
//
// Everything goes through the real API, so prices, capacity, safety rules and
// allocation are applied exactly as for real orders. Test customers use mobiles
// +971 50 000 01xx; running it again does nothing once they exist.
process.env.TZ = process.env.TZ || 'Asia/Dubai';
if (process.env.NODE_ENV === 'production') { console.error('[seed] Refusing to load test data in production.'); process.exit(1); }

const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const { orderableDates, isoDate } = await import('../src/domain/standards.js');
const { recommendDay } = await import('../src/domain/app.js');

if (db.prepare("SELECT 1 FROM users WHERE mobile = '+971500000101'").get()) {
  console.log('[seed] Test data is already loaded (customer +971 50 000 0101 exists). Nothing to do.');
  process.exit(0);
}

const server = createApp().listen(0);
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/api`;
const OPS = { 'x-ops-key': process.env.OPS_KEY || 'dev-ops-key' };

async function call(method, path, body, token, headers = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const data = text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const ops = (method, path, body) => call(method, `/ops${path}`, body, null, OPS);

async function customer(mobile, firstName, profile) {
  const { devCode } = await call('POST', '/auth/otp', { mobile });
  if (!devCode) throw new Error('No development sign-in code — is NODE_ENV production?');
  const { token } = await call('POST', '/auth/verify', { mobile, code: devCode, firstName });
  await call('POST', '/me/accept-terms', {}, token);
  if (profile) await call('PUT', '/me/profile', profile, token);
  return token;
}
const day = (profile, date, context, extra = {}) => {
  const r = recommendDay(profile, context);
  if (!r.primary) throw new Error(`No safe breakfast for ${context}`);
  return { date, context, recipeId: r.primary.recipeId, components: r.primary.components, size: 'regular', addons: [], window: 'w2', ...extra };
};

const dates = orderableDates(new Date(), 14).map(isoDate);
const [d1, d2, d3, d4] = dates;
const office = { building: 'Gate Village, Building 3', unit: 'Level 4, Unit 402', area: 'DIFC', handover: 'reception' };

try {
  /* Personal customers: a vegetarian with a sesame allergy, a flexible eater, and one with nut allergies plus a typed "other allergy". */
  const saraP = { eatingStyle: 'health', preferences: ['savory', 'fresh'], dietary: ['vegetarian'], allergies: ['sesame'] };
  const sara = await customer('500000101', 'Sara', saraP);
  const saraOrder = await call('POST', '/orders', { method: 'card', email: 'sara.test@example.com', address: office,
    days: [day(saraP, d1, 'regular'), day(saraP, d2, 'busy', { window: 'w1' }), day(saraP, d3, 'active', { size: 'large' })] }, sara);

  const omarP = { eatingStyle: 'flexible', preferences: ['bakery', 'sweet'], dietary: [], allergies: [] };
  const omar = await customer('500000102', 'Omar', omarP);
  const omarOrder = await call('POST', '/orders', { method: 'card', email: 'omar.test@example.com',
    address: { building: 'Index Tower', unit: 'Floor 21, Office 2104', area: 'DIFC', handover: 'door' },
    days: [day(omarP, d1, 'relaxed', { size: 'large', addons: [{ group: 'pastry', item: 'plainCroissant', qty: 2 }] }), day(omarP, d2, 'regular', { window: 'w3' })] }, omar);

  const aishaP = { eatingStyle: 'health', preferences: ['fresh', 'bakery'], dietary: [], allergies: ['peanut', 'treenut'], otherAllergies: 'Kiwi' };
  const aisha = await customer('500000103', 'Aisha', aishaP);
  const aishaOrder = await call('POST', '/orders', { method: 'card', email: 'aisha.test@example.com', address: office,
    days: [day(aishaP, d1, 'regular')] }, aisha);

  /* Business customer: a team breakfast with Special Breakfast groups, and a two-day meeting order. */
  const layla = await customer('500000104', 'Layla', null);
  await call('POST', '/business/account', { company: 'Alder & Finch Consulting', email: 'layla.test@example.com' }, layla);
  const delivery = { company: 'Alder & Finch Consulting', building: 'Index Tower', office: 'Floor 21', contact: 'Layla', mobile: '55 000 0104' };
  const team = await call('POST', '/business/orders', { days: [{ date: d2, window: 'w1', people: 20, delivery,
    lines: [{ recipeId: 'savory.flexible.regular', size: 'regular', qty: 9 }, { recipeId: 'bakery.flexible.regular', size: 'regular', qty: 8 }],
    specials: [{ dietary: ['vegan'], allergies: ['treenut'], qty: 2 }, { dietary: ['dairyFree'], allergies: [], qty: 1 }] }] }, layla);
  const meeting = await call('POST', '/business/orders', { days: [d3, d4].map(date => ({ date, window: 'w2', people: 8, delivery,
    lines: [{ recipeId: 'fresh.flexible.regular', size: 'light', qty: 4 }, { recipeId: 'sweet.flexible.regular', size: 'regular', qty: 4 }], specials: [] })) }, layla);

  /* Help & support: a business inquiry and an allergy question, one already answered. */
  await call('POST', '/support', { topic: 'Business orders', message: 'Can you do a breakfast for 60 people next month?' }, layla);
  const q = await call('POST', '/support', { topic: 'Allergies & ingredients', message: 'Is the granola made without nuts?' }, aisha);
  await ops('POST', `/support/${q.id}/reply`, { reply: 'Our granola contains tree nuts, so we never recommend it for you.' });

  /* Operations: allocate the first morning, then walk Omar's breakfast through to delivered and Sara's into preparation. */
  await ops('POST', '/allocate', { date: d1 });
  for (let i = 0; i < 3; i++) await call('POST', '/demo/advance', { orderId: omarOrder.id, date: d1 }, omar);
  await call('POST', `/orders/${omarOrder.id}/days/${d1}/feedback`, { value: 'Loved it' }, omar);
  await call('POST', `/orders/${omarOrder.id}/days/${d1}/issue`, { reason: 'Packaging issue', note: 'The lid was cracked.' }, omar);
  await call('POST', '/demo/advance', { orderId: saraOrder.id, date: d1 }, sara);

  /* A partner bakery waiting for onboarding approval. */
  await ops('POST', '/admin/bakeries', { name: 'Test Bakery D (onboarding)', area: 'Business Bay', distanceKm: 4.2, dailyCapacity: 80, contactName: 'Test Contact', contactPhone: '50 000 0199' })
    .catch(e => console.warn('[seed] Skipped the onboarding bakery:', e.message));

  console.log(`[seed] Loaded test data:
  Customers (sign in with the mobile; the code is shown on screen in development):
    50 000 0101  Sara   — vegetarian, sesame allergy · order ${saraOrder.id} (3 mornings, first one being prepared)
    50 000 0102  Omar   — flexible · order ${omarOrder.id} (first morning delivered, feedback + packaging issue)
    50 000 0103  Aisha  — peanut & tree nut allergy, "Kiwi" typed as other allergy · order ${aishaOrder.id} (held for an allergy check)
    50 000 0104  Layla  — business, Alder & Finch Consulting · orders ${team.id} (20 people, 3 special) and ${meeting.id} (2 days)
  Operations console: #/ops with key ${OPS['x-ops-key']} · first test morning ${d1}`);
} catch (e) {
  console.error('[seed] Failed:', e.message);
  process.exitCode = 1;
} finally {
  server.close();
}
