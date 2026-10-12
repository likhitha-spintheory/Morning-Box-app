/* ---------- Admin: prices, company details and partner bakeries ----------
   Mounted under /api/ops/admin, so it uses the operations key. */
import { Router } from 'express';
import { randomInt, createHash } from 'node:crypto';
import { db, json } from './db.js';
import { allocate, isFinal } from './allocation.js';
import { ApiError, bad, isIsoDate, BAKERY_CONDITIONS, bakeryCaps, bakeryProducts, danishFlavours, windowCapacity, WINDOW_IDS, cleanRouteId } from './rules.js';
import { getPricing, savePricing, resetPricing, pricingHistory, getCompany, saveCompany, getLibrary, saveLibrary, getDelivery, saveDelivery, getAreas, saveAreas } from './settings.js';
import { COMPONENTS, ADDON_BREAD, ADDON_PASTRY } from '../src/domain/library.js';
import { BASE_RECOMMENDATIONS, describe, priceLevel } from '../src/domain/recipes.js';
import { ALLERGENS, DIETARY } from '../src/domain/standards.js';

export const adminRouter = Router();

/* ---------- Pricing ---------- */
adminRouter.get('/pricing', (_req, res) => {
  /* Which breakfasts sit at each internal price level (never shown to customers, MB-BOX-001 §8). */
  const levels = {};
  for (const r of BASE_RECOMMENDATIONS) (levels[priceLevel(r)] ||= []).push(describe(r));
  /* Bread add-ons are priced per bread (MB-BOX-001 §8, MB-PRO-001 §14.1). */
  const breads = ADDON_BREAD.filter(id => COMPONENTS[id]).map(id => ({ id, name: COMPONENTS[id].name, sample: !!COMPONENTS[id].sample }));
  res.json({ pricing: getPricing(), levels, breads, history: pricingHistory() });
});
adminRouter.put('/pricing', (req, res) => res.json({ pricing: savePricing(req.body) }));
adminRouter.post('/pricing/reset', (_req, res) => res.json({ pricing: resetPricing() }));

/* ---------- Company & support details ---------- */
adminRouter.get('/company', (_req, res) => res.json(getCompany()));
adminRouter.get('/areas', (_req, res) => res.json(getAreas()));
adminRouter.put('/areas', (req, res) => res.json(saveAreas(req.body)));
adminRouter.put('/company', (req, res) => res.json(saveCompany(req.body)));
adminRouter.get('/library', (_req, res) => res.json({ ...getLibrary(), items: Object.values(COMPONENTS).filter(c => c.sample).map(c => c.name) }));
adminRouter.put('/library', (req, res) => res.json(saveLibrary(req.body)));
/** Read-only ingredient & allergen record of every product, with its approved variants (MB-PRO-001 §15.1). */
adminRouter.get('/products', (_req, res) => {
  const items = Object.values(COMPONENTS).map(c => ({
    id: c.id, name: c.name, category: c.category, allergens: c.allergens || [], diet: c.diet || [], sample: !!c.sample, note: c.note || '',
    variants: [].concat(c.variant || []).map(v => ({ id: v.id, label: v.label, allergens: v.allergens || [], diet: v.diet || [], sample: !!v.sample }))
  }));
  res.json({ items, allergens: ALLERGENS, dietary: DIETARY });
});
adminRouter.get('/delivery', (_req, res) => res.json(getDelivery()));
adminRouter.put('/delivery', (req, res) => res.json(saveDelivery(req.body)));

/* ---------- Partner bakeries (MB-BKY-001) ---------- */
export const BAKERY_STATUS = ['Active', 'Under Review', 'Suspended'];
export const CAPABILITIES = ['glutenFree', 'nutFree', 'peanutFree', 'dairyFree', 'eggFree', 'vegan', 'sesameFree', 'soyFree'];
export const DANISH_FLAVOURS = ['Apple', 'Berry', 'Apricot'];
const WINDOW_NAME = { w1: '7:30–8:30 AM', w2: '8:30–9:30 AM', w3: '9:30–10:30 AM' };
const hash = code => createHash('sha256').update(String(code)).digest('hex');
const log = (id, message) => db.prepare('INSERT INTO bakery_log (bakery_id, message) VALUES (?, ?)').run(id, String(message).slice(0, 300));
const clean = (v, max = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, max) : '');

function bakeryOut(b) {
  const today = new Date().toLocaleDateString('en-CA');
  const booked = db.prepare(`SELECT COUNT(*) AS n FROM order_days WHERE bakery_id = ? AND date >= ? AND cancelled = 0`).get(b.id, today).n;
  const kpi = db.prepare(`SELECT COUNT(*) AS total, SUM(stage = 3 AND late = 0) AS onTime, SUM(late = 1) AS late, SUM(bakery_state = 'Unable to Fulfil') AS unable,
      SUM(feedback = 'Loved it') AS loved, SUM(feedback = 'Not for me') AS notForMe
    FROM order_days WHERE bakery_id = ? AND cancelled = 0 AND date < ?`).get(b.id, today);
  /* Unable to Fulfil from the partner log: it stays with this bakery after the order is reallocated (MB-BKY-001 §9). */
  kpi.unable = db.prepare("SELECT COUNT(DISTINCT day_kind || day_id) AS n FROM bakery_events WHERE bakery_id = ? AND kind = 'Unable to Fulfil' AND date < ?").get(b.id, today).n;
  return {
    id: b.id, name: b.name, area: b.area, distanceKm: b.distance_km, dailyCapacity: b.daily_capacity,
    effectiveCapacity: b.effective_capacity ?? null, windowCapacity: windowCapacity(b), glutenFreeCertified: !!b.gluten_free_certified,
    capabilities: bakeryCaps(b), status: b.status, statusNote: b.status_note || '', products: bakeryProducts(b),
    danishFlavours: danishFlavours(b), contactName: b.contact_name || '', contactPhone: b.contact_phone || '', hasAccessCode: !!b.access_hash,
    payoutPct: b.payout_pct ?? 60, licenceNo: b.licence_no || '', licenceExpiry: b.licence_expiry || '', bakesOwnBread: !!b.bakes_own_bread, readyLeadMinutes: b.ready_lead_minutes ?? 30,
    samples: db.prepare('SELECT id, product, result, note, created_at FROM bakery_samples WHERE bakery_id = ? ORDER BY id DESC LIMIT 50').all(b.id).map(x => ({ ...x, productName: COMPONENTS[x.product]?.name || x.product })),
    openSafety: db.prepare("SELECT COUNT(*) AS n FROM exceptions WHERE resolved = 0 AND category = 'Safety' AND responsible_party = ?").get(b.name).n,
    upcomingBoxes: booked,
    performance: { mornings: kpi.total || 0, onTime: kpi.onTime || 0, late: kpi.late || 0, unableToFulfil: kpi.unable || 0, loved: kpi.loved || 0, notForMe: kpi.notForMe || 0 },
    conditions: db.prepare('SELECT * FROM bakery_conditions WHERE bakery_id = ? AND date >= ? ORDER BY date').all(b.id, today)
      .map(c => ({ id: c.id, date: c.date, kind: c.kind, item: c.item, itemName: c.item ? COMPONENTS[c.item]?.name || c.item : null, capacity: c.capacity, need: c.need, note: c.note })),
    log: db.prepare('SELECT message, created_at FROM bakery_log WHERE bakery_id = ? ORDER BY id DESC LIMIT 10').all(b.id)
  };
}

/** Everything a bakery can be approved for: every library component, with the add-on groups marked. */
adminRouter.get('/catalog', (_req, res) => {
  const items = Object.values(COMPONENTS).map(c => ({ id: c.id, name: c.name, category: c.category, addon: ADDON_BREAD.includes(c.id) ? 'bread' : ADDON_PASTRY.includes(c.id) ? 'pastry' : null, sample: !!c.sample }));
  res.json({ items, statuses: BAKERY_STATUS, capabilities: CAPABILITIES, conditions: BAKERY_CONDITIONS, danishFlavours: DANISH_FLAVOURS, sampleResults: SAMPLE_RESULTS });
});

adminRouter.get('/bakeries', (_req, res) => {
  res.json(db.prepare("SELECT * FROM bakeries ORDER BY CASE status WHEN 'Active' THEN 0 WHEN 'Under Review' THEN 1 ELSE 2 END, distance_km").all().map(bakeryOut));
});

const validDate = v => { if (!v) return null; if (!isIsoDate(v)) throw bad('date_invalid', 'Licence expiry must be a date.'); return v; };
const payoutPct = v => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 100) throw bad('payout_invalid', 'Payout must be 0–100% of the breakfast price.'); return n; };
const readyLead = v => { const n = Number(v); if (!Number.isInteger(n) || n < 10 || n > 180) throw bad('lead_invalid', 'Ready-by lead time must be 10–180 minutes before the window.'); return n; };
function validateBakery(input, existing = {}) {
  const name = clean(input.name ?? existing.name);
  const area = clean(input.area ?? existing.area, 60);
  const distance = Number(input.distanceKm ?? existing.distance_km);
  const daily = Number(input.dailyCapacity ?? existing.daily_capacity);
  const effective = input.effectiveCapacity === '' || input.effectiveCapacity == null ? null : Number(input.effectiveCapacity);
  /* Optional capacity per delivery window (blank = no limit for that window); null when none is set. */
  let perWindow = input.windowCapacity === undefined ? windowCapacity(existing) : null;
  if (input.windowCapacity !== undefined && input.windowCapacity !== null) {
    if (typeof input.windowCapacity !== 'object' || Array.isArray(input.windowCapacity)) throw bad('window_capacity_invalid', 'Window capacity must be set per window.');
    perWindow = {};
    for (const w of WINDOW_IDS) {
      const raw = input.windowCapacity[w];
      if (raw === '' || raw == null) continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > daily) throw bad('window_capacity_invalid', `Capacity for ${WINDOW_NAME[w]} must be a whole number of boxes between 0 and the stated daily capacity.`);
      perWindow[w] = n;
    }
    if (!Object.keys(perWindow).length) perWindow = null;
  }
  if (perWindow && Object.values(perWindow).some(n => n > daily)) throw bad('window_capacity_invalid', 'Window capacity can’t be more than the stated daily capacity.');
  if (!name) throw bad('name_required', 'Enter the bakery name.');
  if (!area) throw bad('area_required', 'Enter the area.');
  if (!Number.isFinite(distance) || distance < 0 || distance > 100) throw bad('distance_invalid', 'Distance must be 0–100 km.');
  if (!Number.isInteger(daily) || daily < 0 || daily > 5000) throw bad('capacity_invalid', 'Daily capacity must be a whole number of boxes.');
  if (effective !== null && (!Number.isInteger(effective) || effective < 0 || effective > daily)) throw bad('capacity_invalid', 'Effective capacity must be between 0 and the stated daily capacity.');
  const caps = input.capabilities ? Object.fromEntries(CAPABILITIES.map(k => [k, !!input.capabilities[k]])) : bakeryCaps(existing);
  let products = input.products === undefined ? bakeryProducts(existing) : input.products;
  if (products !== null) {
    if (!Array.isArray(products)) throw bad('products_invalid', 'Products must be a list.');
    products = [...new Set(products.filter(id => COMPONENTS[id]))];
  }
  const flavours = input.danishFlavours === undefined ? danishFlavours(existing) : (Array.isArray(input.danishFlavours) ? input.danishFlavours.filter(f => DANISH_FLAVOURS.includes(f)) : []);
  return {
    name, area, distance_km: distance, daily_capacity: daily, effective_capacity: effective, window_capacity: perWindow ? json(perWindow) : null,
    gluten_free_certified: input.glutenFreeCertified === undefined ? existing.gluten_free_certified || 0 : input.glutenFreeCertified ? 1 : 0,
    capabilities: json(caps), products: products === null ? null : json(products), danish_flavours: json([...new Set(flavours)]),
    contact_name: clean(input.contactName ?? existing.contact_name ?? ''), contact_phone: clean(input.contactPhone ?? existing.contact_phone ?? '', 30),
    licence_no: clean(input.licenceNo ?? existing.licence_no ?? '', 40), licence_expiry: validDate(input.licenceExpiry ?? existing.licence_expiry),
    bakes_own_bread: input.bakesOwnBread === undefined ? existing.bakes_own_bread || 0 : input.bakesOwnBread ? 1 : 0,
    ready_lead_minutes: readyLead(input.readyLeadMinutes ?? existing.ready_lead_minutes ?? 30),
    payout_pct: payoutPct(input.payoutPct ?? existing.payout_pct ?? 60)
  };
}

adminRouter.post('/bakeries', (req, res) => {
  const v = validateBakery(req.body);
  const cols = Object.keys(v);
  const r = db.prepare(`INSERT INTO bakeries (${cols.join(', ')}, status, updated_at) VALUES (${cols.map(() => '?').join(', ')}, 'Under Review', datetime('now'))`).run(...Object.values(v));
  const id = Number(r.lastInsertRowid);
  log(id, 'Added. Status Under Review until onboarding samples are approved.');
  res.status(201).json(bakeryOut(db.prepare('SELECT * FROM bakeries WHERE id = ?').get(id)));
});

const bakeryById = id => {
  const b = db.prepare('SELECT * FROM bakeries WHERE id = ?').get(Number(id));
  if (!b) throw new ApiError(404, 'not_found', 'Bakery not found.');
  return b;
};

adminRouter.put('/bakeries/:id', (req, res) => {
  const b = bakeryById(req.params.id);
  const v = validateBakery(req.body, b);
  db.prepare(`UPDATE bakeries SET ${Object.keys(v).map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(v), b.id);
  log(b.id, 'Details updated.');
  res.json(bakeryOut(bakeryById(b.id)));
});

/** Active / Under Review / Suspended (MB-BKY-001 §10). Only Active partners receive orders. */
adminRouter.post('/bakeries/:id/status', (req, res) => {
  const b = bakeryById(req.params.id);
  const status = req.body.status;
  if (!BAKERY_STATUS.includes(status)) throw bad('status_invalid', `Status must be one of: ${BAKERY_STATUS.join(', ')}.`);
  const note = clean(req.body.note, 300);
  if (status !== 'Active' && !note) throw bad('note_required', 'Say why (e.g. the issue and the corrective action).');
  /* MB-BKY-001 §1: licensed, and bakes its own bread in-house, before it can receive orders. */
  if (status === 'Active') {
    if (!b.bakes_own_bread) throw bad('bread_required', 'A partner bakery must bake its own bread in-house before it can be Active.');
    if (!b.licence_no) throw bad('licence_required', 'Record the food business licence before making the bakery Active.');
    if (b.licence_expiry && b.licence_expiry < new Date().toLocaleDateString('en-CA')) throw bad('licence_expired', 'The food business licence has expired.');
    /* §8: onboarding sample production approved for at least one product before the first orders. */
    if (b.status !== 'Active' && !db.prepare("SELECT 1 FROM bakery_samples WHERE bakery_id = ? AND result = 'Approved'").get(b.id)) throw bad('sample_required', 'Record at least one Approved onboarding sample before making the bakery Active.');
    /* §10: Identify Issue → Corrective Action → Verification → Return to Active (for a partner that was taken off Active). */
    const wasActive = db.prepare("SELECT 1 FROM bakery_log WHERE bakery_id = ? AND message LIKE 'Active →%'").get(b.id);
    if (b.status !== 'Active' && wasActive && !clean(req.body.verification, 300)) throw bad('verification_required', 'Record the corrective action and how it was verified before returning to Active.');
  }
  db.prepare("UPDATE bakeries SET status = ?, status_note = ?, active = ?, updated_at = datetime('now') WHERE id = ?").run(status, note || null, status === 'Active' ? 1 : 0, b.id);
  log(b.id, `${b.status} → ${status}${note ? ` — ${note}` : ''}${req.body.verification ? ` · Verified: ${clean(req.body.verification, 300)}` : ''}`);
  /* Orders this bakery hasn't started move to the next eligible bakery (MB-BKY-001 §10); started ones stay to be finished. */
  const today = new Date().toLocaleDateString('en-CA');
  const dates = [...new Set([
    ...db.prepare(`SELECT date FROM order_days WHERE bakery_id = ? AND date >= ? AND cancelled = 0 AND stage = 0`).all(b.id, today).map(r => r.date),
    ...db.prepare(`SELECT date, allocation FROM business_days WHERE date >= ? AND cancelled = 0 AND stage = 0 AND allocation IS NOT NULL`).all(today)
      .filter(r => (JSON.parse(r.allocation) || []).some(p => p.bakeryId === b.id)).map(r => r.date)
  ])];
  let affected = 0;
  if (status !== 'Active') for (const date of dates) affected += allocate(date, { final: isFinal(date) }).allocations.length;
  res.json({ ...bakeryOut(bakeryById(b.id)), affected, reallocatedDates: status === 'Active' ? [] : dates });
});

/** Onboarding sample production (MB-BKY-001 §8): approval may be product-specific. */
export const SAMPLE_RESULTS = ['Approved', 'Needs Improvement', 'Not Approved'];
adminRouter.post('/bakeries/:id/samples', (req, res) => {
  const b = bakeryById(req.params.id);
  if (!COMPONENTS[req.body.product]) throw bad('product_invalid', 'Choose the product that was assessed.');
  if (!SAMPLE_RESULTS.includes(req.body.result)) throw bad('result_invalid', `Result must be one of: ${SAMPLE_RESULTS.join(', ')}.`);
  db.prepare('INSERT INTO bakery_samples (bakery_id, product, result, note) VALUES (?, ?, ?, ?)').run(b.id, req.body.product, req.body.result, clean(req.body.note, 300) || null);
  /* An approved sample adds the product to the bakery's approved list (when it has one); Not Approved always
     removes it — "every product" (null) becomes every product except that one (MB-BKY-001 §8). */
  const products = bakeryProducts(b);
  if (products && req.body.result === 'Approved' && !products.includes(req.body.product)) db.prepare('UPDATE bakeries SET products = ? WHERE id = ?').run(json([...products, req.body.product]), b.id);
  if (req.body.result === 'Not Approved' && (!products || products.includes(req.body.product))) db.prepare('UPDATE bakeries SET products = ? WHERE id = ?').run(json((products || Object.keys(COMPONENTS)).filter(p => p !== req.body.product)), b.id);
  log(b.id, `Sample: ${COMPONENTS[req.body.product].name} — ${req.body.result}${req.body.note ? ` (${clean(req.body.note, 120)})` : ''}`);
  res.status(201).json(bakeryOut(bakeryById(b.id)));
});

/** Temporary condition for a date (MB-BKY-001 §6). */
export function addCondition(bakeryId, body) {
  const b = bakeryById(bakeryId);
  if (!isIsoDate(body.date)) throw bad('date_invalid', 'Choose the date.');
  if (!BAKERY_CONDITIONS.includes(body.kind)) throw bad('kind_invalid', `Condition must be one of: ${BAKERY_CONDITIONS.join(', ')}.`);
  const item = body.kind === 'Item Unavailable' ? body.item : null;
  if (body.kind === 'Item Unavailable' && !COMPONENTS[item]) throw bad('item_invalid', 'Choose the item that is unavailable.');
  const capacity = body.kind === 'Reduced Capacity' ? Number(body.capacity) : null;
  if (body.kind === 'Reduced Capacity' && (!Number.isInteger(capacity) || capacity < 0)) throw bad('capacity_invalid', 'Enter the reduced capacity in boxes.');
  const need = body.kind === 'Special Requirement Unavailable' ? body.need : null;
  if (body.kind === 'Special Requirement Unavailable' && !CAPABILITIES.includes(need)) throw bad('need_invalid', 'Choose the requirement it cannot handle.');
  db.prepare('INSERT INTO bakery_conditions (bakery_id, date, kind, item, capacity, need, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(b.id, body.date, body.kind, item, capacity, need, clean(body.note, 200) || null);
  log(b.id, `${body.date}: ${body.kind}${item ? ` — ${COMPONENTS[item].name}` : ''}${capacity !== null ? ` — ${capacity} boxes` : ''}${need ? ` — ${need}` : ''}`);
  return bakeryOut(bakeryById(b.id));
}
adminRouter.post('/bakeries/:id/conditions', (req, res) => res.status(201).json(addCondition(req.params.id, req.body)));
adminRouter.delete('/conditions/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM bakery_conditions WHERE id = ?').get(Number(req.params.id));
  if (!c) throw new ApiError(404, 'not_found', 'Condition not found.');
  db.prepare('DELETE FROM bakery_conditions WHERE id = ?').run(c.id);
  log(c.bakery_id, `${c.date}: ${c.kind} cleared.`);
  res.json({ ok: true });
});

/** A new 8-digit access code for the Bakery View. Shown once; only its hash is stored. */
adminRouter.post('/bakeries/:id/access-code', (req, res) => {
  const b = bakeryById(req.params.id);
  const code = String(randomInt(10_000_000, 100_000_000));
  db.prepare('UPDATE bakeries SET access_hash = ? WHERE id = ?').run(hash(code), b.id);
  log(b.id, 'New Bakery View access code issued.');
  res.json({ code });
});
export const bakeryByCode = code => (code ? db.prepare('SELECT * FROM bakeries WHERE access_hash = ?').get(hash(code)) : null);


/* ---------- Couriers (MB-OPS-001 §6): one courier per route, each with a Courier View access code ---------- */
const courierOut = c => ({ id: c.id, name: c.name, phone: c.phone || '', routeId: c.route_id, capacity: c.capacity ?? null, active: !!c.active, hasAccessCode: !!c.access_hash, createdAt: c.created_at });
const courierById = id => {
  const c = db.prepare('SELECT * FROM couriers WHERE id = ?').get(Number(id));
  if (!c) throw new ApiError(404, 'not_found', 'Courier not found.');
  return c;
};
function validateCourier(input, existing = {}) {
  const name = clean(input.name ?? existing.name);
  const phone = clean(input.phone ?? existing.phone ?? '', 30);
  const routeId = cleanRouteId(input.routeId ?? existing.route_id);
  if (!name) throw bad('name_required', 'Enter the courier’s name.');
  if (!routeId) throw bad('route_required', 'Enter the route id (letters, digits, dash).');
  const taken = db.prepare('SELECT id FROM couriers WHERE route_id = ? AND id IS NOT ?').get(routeId, existing.id ?? null);
  if (taken) throw new ApiError(409, 'route_taken', `Route ${routeId} already has a courier.`);
  /* Route capacity (OPS §6): boxes per delivery window; blank = no limit. */
  const rawCap = input.capacity === undefined ? existing.capacity ?? null : input.capacity === '' || input.capacity === null ? null : Number(input.capacity);
  if (rawCap !== null && (!Number.isInteger(rawCap) || rawCap < 1 || rawCap > 500)) throw bad('capacity_invalid', 'Route capacity is a whole number of boxes (1–500), or blank for no limit.');
  return { name, phone: phone || null, route_id: routeId, capacity: rawCap, active: input.active === undefined ? existing.active ?? 1 : input.active ? 1 : 0 };
}
adminRouter.get('/couriers', (_req, res) => res.json(db.prepare('SELECT * FROM couriers ORDER BY active DESC, route_id').all().map(courierOut)));
adminRouter.post('/couriers', (req, res) => {
  const v = validateCourier(req.body);
  const r = db.prepare('INSERT INTO couriers (name, phone, route_id, capacity, active) VALUES (?, ?, ?, ?, ?)').run(v.name, v.phone, v.route_id, v.capacity, v.active);
  res.status(201).json(courierOut(courierById(r.lastInsertRowid)));
});
/** Edit, or deactivate with { active: false } — a deactivated courier can no longer sign in. */
adminRouter.put('/couriers/:id', (req, res) => {
  const c = courierById(req.params.id);
  const v = validateCourier(req.body, c);
  db.prepare('UPDATE couriers SET name = ?, phone = ?, route_id = ?, capacity = ?, active = ? WHERE id = ?').run(v.name, v.phone, v.route_id, v.capacity, v.active, c.id);
  res.json(courierOut(courierById(c.id)));
});
/** A new 8-digit access code for the Courier View. Shown once; only its hash is stored. */
adminRouter.post('/couriers/:id/access-code', (req, res) => {
  const c = courierById(req.params.id);
  const code = String(randomInt(10_000_000, 100_000_000));
  db.prepare('UPDATE couriers SET access_hash = ? WHERE id = ?').run(hash(code), c.id);
  res.json({ code });
});
export const courierByCode = code => (code ? db.prepare('SELECT * FROM couriers WHERE access_hash = ? AND active = 1').get(hash(code)) : null);
