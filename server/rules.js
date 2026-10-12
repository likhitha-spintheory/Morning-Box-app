/* Server-side rules. The browser is never trusted for safety, eligibility,
   price, cutoff or capacity: every order is re-validated and re-priced here
   with the same locked engine the app uses. */
import {
  recommend, configure, swapOptions, applySwap, applyUserSwaps, hasSizeSelector, addonGroups, priceBox, traceRecord,
  businessModels, resolveSpecial, priceBusinessDay
} from '../src/domain/engine.js';
import { recipeById, describe, priceLevel } from '../src/domain/recipes.js';
import { unsafeComponents } from '../src/domain/app.js';
import {
  CONTEXTS, DELIVERY_WINDOWS, DIETARY, ALLERGENS, PREFERENCES, EATING_STYLES, PRICE_LEVELS,
  isBeforeCutoff, orderableDates, isoDate, dubaiTodayIso, EXCEPTION_KINDS as BASE_EXCEPTION_KINDS
} from '../src/domain/standards.js';
import { db } from './db.js';

export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
export const bad = (code, message, details) => new ApiError(400, code, message, details);

const ids = list => list.map(x => x.id);
const isIso = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const str = (v, max = 120) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
/** Plain single-line text: control characters and angle brackets removed. */
export const plain = (v, max = 200) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
export const emailOk = e => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
export const isIsoDate = isIso;

/* ---------- Profile (MB-PER-001) ---------- */
export function validateProfile(p) {
  if (!p || !ids(EATING_STYLES).includes(p.eatingStyle)) throw bad('profile_invalid', 'Choose an eating style.');
  const prefs = Array.isArray(p.preferences) ? p.preferences : [];
  if (!prefs.length || prefs.some(x => !ids(PREFERENCES).includes(x))) throw bad('profile_invalid', 'Choose at least one breakfast preference.');
  const dietary = Array.isArray(p.dietary) ? p.dietary : [];
  const allergies = Array.isArray(p.allergies) ? p.allergies : [];
  if (dietary.some(x => !ids(DIETARY).includes(x))) throw bad('profile_invalid', 'Unknown dietary requirement.');
  if (allergies.some(x => !ids(ALLERGENS).includes(x))) throw bad('profile_invalid', 'Unknown allergy.');
  return {
    eatingStyle: p.eatingStyle, preferences: [...new Set(prefs)], dietary: [...new Set(dietary)], allergies: [...new Set(allergies)],
    otherAllergies: plain(p.otherAllergies, 120)
  };
}

/* Safety re-check of a built morning against a (changed) profile — shared with the app. */
export { unsafeComponents };

/* ---------- Dates & cutoff (MB-DLV-001 §2) ---------- */
/** "Mon 12 Oct" for customer-facing messages. */
export const prettyDate = iso => (isIso(iso) ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '') : String(iso));

/* ---------- Closed days (public holidays, closures) ---------- */
export const closedReason = date => db.prepare('SELECT reason FROM closed_dates WHERE date = ?').get(date)?.reason || null;
export const upcomingClosedDates = () => db.prepare('SELECT date, reason FROM closed_dates WHERE date >= ? ORDER BY date').all(dubaiTodayIso());

export function assertOrderable(date) {
  if (!isIso(date)) throw bad('date_invalid', 'Invalid date.');
  const closed = closedReason(date);
  if (closed) throw bad('day_closed', `We’re closed on ${prettyDate(date)} (${closed}). Please choose another morning.`);
  const horizon = orderableDates(new Date(), 28).map(isoDate);
  if (!horizon.includes(date) || !isBeforeCutoff(date)) {
    throw bad('cutoff_passed', `Orders for ${prettyDate(date)} closed at 9:00 PM the evening before.`);
  }
}
/** True for an ISO date inside the orderable horizon (used to ignore junk availability queries). */
export const inHorizon = date => isIso(date) && orderableDates(new Date(), 28).map(isoDate).includes(date);
export const isEditable = date => isBeforeCutoff(date);
export function assertEditable(date, stage = 0) {
  if (!isBeforeCutoff(date)) throw bad('cutoff_passed', 'Changes for this morning closed at 9:00 PM the evening before.');
  if (stage > 0) throw bad('in_production', 'This morning is already being prepared and can no longer be changed.');
}

/* ---------- Capacity (MB-DLV-001 §8) ----------
   A window stays available only while production and delivery capacity
   remain. Capacity is counted in boxes per date and window. */
export const WINDOW_CAPACITY = Number(process.env.WINDOW_CAPACITY || 120);
/* Delivery capacity per window (boxes the couriers can carry), set in Admin → Company & delivery. */
export const DELIVERY_CAPACITY = { w1: WINDOW_CAPACITY, w2: WINDOW_CAPACITY, w3: WINDOW_CAPACITY };
const capOf = w => DELIVERY_CAPACITY[w] ?? WINDOW_CAPACITY;
export function boxesBooked(date, window, { excludeOrderDay, excludeBusinessDay } = {}) {
  const personal = db.prepare(`SELECT COUNT(*) AS n FROM order_days WHERE date = ? AND window = ? AND cancelled = 0 AND id IS NOT ?`)
    .get(date, window, excludeOrderDay ?? null).n;
  const business = db.prepare(`SELECT COALESCE(SUM(people), 0) AS n FROM business_days WHERE date = ? AND window = ? AND cancelled = 0 AND id IS NOT ?`)
    .get(date, window, excludeBusinessDay ?? null).n;
  return personal + business;
}
export function availability(date) {
  if (closedReason(date)) return Object.fromEntries(DELIVERY_WINDOWS.map(w => [w.id, { available: false, remaining: 0, closed: true }]));
  return Object.fromEntries(DELIVERY_WINDOWS.map(w => {
    const remaining = Math.max(0, capOf(w.id) - boxesBooked(date, w.id));
    return [w.id, { available: remaining > 0, remaining }];
  }));
}
export function assertCapacity(date, window, boxes, exclude = {}) {
  if (!ids(DELIVERY_WINDOWS).includes(window)) throw bad('window_invalid', 'Choose a delivery window.');
  if (boxesBooked(date, window, exclude) + boxes > capOf(window)) {
    throw bad('window_full', `The ${DELIVERY_WINDOWS.find(w => w.id === window).label} window on ${prettyDate(date)} is fully booked.`, { date, window });
  }
}

/* ---------- Personal day (MB-BOX-001, MB-REC-001) ---------- */
export function buildPersonalDay(input, profile) {
  const { context, recipeId, components, size, addons = [], danishFlavour } = input;
  if (!ids(CONTEXTS).includes(context)) throw bad('context_invalid', 'Choose a daily context.');
  const rec = recommend(profile, context);
  const candidate = [rec.primary, rec.alternative].find(c => c && c.recipe.id === recipeId);
  if (!candidate) throw bad('not_eligible', 'This breakfast is not available for your profile and morning. Please plan it again.');

  const config = configure(candidate, profile);
  /* Same items as recommended, apart from eligible same-group swaps (MB-BOX-001 §5). */
  const custom = applyUserSwaps(config, components);
  if (!custom.ok) throw bad('components_invalid', custom.reason);
  /* Fruit Danish in the box: an approved variant a partner bakery makes (MB-PRO-001 §5, §14.2). */
  let flavour = null;
  if (config.components.includes('fruitDanish')) {
    const flavours = [...new Set(activeBakeries().flatMap(danishFlavours))];
    if (!flavours.length) throw bad('danish_unavailable', 'Fruit Danish is not available right now. Please swap it.');
    flavour = flavours.includes(danishFlavour) ? danishFlavour : flavours[0];
  }

  if (hasSizeSelector(config.recipe)) {
    if (!['light', 'regular', 'large'].includes(size)) throw bad('size_invalid', 'Choose a size.');
    config.size = size;
  }

  const groups = addonGroups(profile);
  config.addons = (Array.isArray(addons) ? addons : []).map(a => {
    const g = groups.find(x => x.id === a?.group);
    if (!g || !g.items.includes(a.item)) throw bad('addon_invalid', 'One of your extras is not available for your profile.');
    if (!Number.isInteger(a.qty) || a.qty < 1 || a.qty > 9) throw bad('addon_invalid', 'Extras quantity must be between 1 and 9.');
    if (g.units && !g.units.includes(a.unit)) throw bad('addon_invalid', 'Choose half or whole loaf.');
    if (g.units) return { group: g.id, item: a.item, unit: a.unit, qty: a.qty };
    /* Fruit Danish: only a variant a partner bakery makes (MB-PRO-001 §14.2). */
    if (a.item === 'fruitDanish') {
      const flavours = [...new Set(activeBakeries().flatMap(danishFlavours))];
      if (!flavours.includes(a.flavour)) throw bad('addon_invalid', flavours.length ? `Choose a Fruit Danish flavour: ${flavours.join(', ')}.` : 'Fruit Danish is not available right now.');
      return { group: g.id, item: a.item, qty: a.qty, flavour: a.flavour };
    }
    return { group: g.id, item: a.item, qty: a.qty };
  });

  const price = priceBox(config).total;
  const cfg = {
    recipeId: config.recipe.id, context, which: candidate === rec.primary ? 'primary' : 'alternative',
    components: config.components, substitutions: config.substitutions, userSwaps: config.userSwaps, danishFlavour: flavour,
    size: config.size, addons: config.addons, label: config.label, format: config.recipe.format || null,
    variants: config.variants
  };
  const other = candidate === rec.primary ? rec.alternative : rec.primary;
  return { cfg, price, trace: traceRecord(config, context, other?.recipe.id || null, { primary: rec.primary?.recipe.id || null, alternative: rec.alternative?.recipe.id || null, which: cfg.which }) };
}

export function validateAddress(a) {
  if (!a || !str(a.building) || !str(a.unit)) throw bad('address_invalid', 'Add your building and floor or unit.');
  return {
    building: plain(a.building, 120), unit: plain(a.unit, 120), area: 'DIFC',
    handover: a.handover === 'door' ? 'door' : 'reception',
    notes: plain(a.notes, 200)
  };
}

/* ---------- Business day (MB-B2B-001) ---------- */
const REGULAR_MODELS = () => businessModels('regular');
export function modelFor(recipeId) {
  const r = recipeById[recipeId];
  if (!r || !REGULAR_MODELS().some(m => m.recipe.id === recipeId)) throw bad('model_invalid', 'Unknown breakfast model.');
  return { recipe: r, label: describe(r), base: PRICE_LEVELS[priceLevel(r)] };
}

export function buildBusinessDay(input) {
  const people = Number(input.people);
  /* No fixed maximum headcount (MB-DLV-001 §8); window and bakery capacity are checked before payment. */
  if (!Number.isInteger(people) || people < 1 || people > 999) throw bad('people_invalid', 'Enter the number of people.');
  if (!Array.isArray(input.lines ?? []) || !Array.isArray(input.specials ?? [])) throw bad('lines_invalid', 'Invalid breakfast selection.');
  /* The same model and size listed twice is merged into one line. */
  const merged = new Map();
  for (const l of input.lines || []) {
    if (!l || !(l.qty > 0)) continue;
    if (!['light', 'regular', 'large'].includes(l.size)) throw bad('size_invalid', 'Choose a size for each breakfast.');
    if (!Number.isInteger(l.qty)) throw bad('qty_invalid', 'Quantities must be whole numbers.');
    const key = `${l.recipeId}|${l.size}`;
    merged.set(key, { recipeId: l.recipeId, size: l.size, qty: (merged.get(key)?.qty || 0) + l.qty });
  }
  const lines = [...merged.values()].map(l => ({ ...l, model: modelFor(l.recipeId) }));
  if ((input.specials || []).length > 20) throw bad('special_invalid', 'Up to 20 Special Breakfast groups per day.');
  const specials = (input.specials || []).map(s => {
    const dietary = (s.dietary || []).filter(x => ids(DIETARY).includes(x));
    const allergies = (s.allergies || []).filter(x => ids(ALLERGENS).includes(x));
    if (!dietary.length && !allergies.length) throw bad('special_invalid', 'Each Special Breakfast needs at least one requirement.');
    if (!Number.isInteger(s.qty) || s.qty < 1) throw bad('special_invalid', 'Each Special Breakfast needs a quantity.');
    const size = s.size || 'regular';
    if (!['light', 'regular', 'large'].includes(size)) throw bad('size_invalid', 'Choose a size for each Special Breakfast.');
    const r = resolveSpecial({ dietary: [...new Set(dietary)], allergies: [...new Set(allergies)], qty: s.qty, size }, 'regular');
    if (!r.resolved) throw bad('special_no_match', 'No approved breakfast can safely meet one of your Special Breakfast requirements.', { dietary, allergies });
    return r;
  });
  const boxes = lines.reduce((t, l) => t + l.qty, 0) + specials.reduce((t, s) => t + s.qty, 0);
  if (boxes !== people) throw bad('headcount_mismatch', `Total boxes (${boxes}) must equal the number of people (${people}).`, { boxes, people });
  const p = priceBusinessDay(lines, specials);
  return {
    people,
    lines: lines.map(({ recipeId, size, qty }) => ({ recipeId, size, qty })),
    /* Each Special Breakfast carries its resolved build so the bakery produces
       exactly the safe composition (substitutions and approved variants). */
    specials: specials.map(s => ({
      dietary: s.dietary, allergies: s.allergies, qty: s.qty, size: s.size, recipeId: s.resolved.recipe.id,
      components: s.resolved.components, substitutions: s.resolved.substitutions, variants: s.resolved.variants || {}
    })),
    gross: Math.round(p.gross), discount: Math.round(p.discount), total: Math.round(p.total), discountPct: p.discountPct
  };
}

export function validateBusinessDelivery(d) {
  const need = ['company', 'building', 'office', 'contact', 'mobile'];
  const missing = need.filter(k => !str(d?.[k]));
  if (missing.length) throw bad('delivery_invalid', 'Complete the delivery details.', { missing });
  if (!/^5\d{8}$/.test(String(d.mobile).replace(/\D/g, '').replace(/^00/, '').replace(/^971/, '').replace(/^0/, ''))) throw bad('delivery_invalid', 'Enter a valid UAE mobile number for the contact person.');
  return { company: plain(d.company, 120), building: plain(d.building, 120), office: plain(d.office, 120), area: 'DIFC', contact: plain(d.contact, 120), mobile: plain(d.mobile, 30), notes: plain(d.notes, 200) };
}

export const needsGlutenFreeHandling = (dietary = [], allergies = []) => dietary.includes('glutenFree') || allergies.includes('gluten');

/* ---------- Bakery capability & capacity (MB-BKY-001, MB-DLV-001 §7–8) ---------- */
export const CAPABILITIES = ['glutenFree', 'nutFree', 'dairyFree', 'eggFree', 'vegan', 'sesameFree', 'soyFree', 'peanutFree'];
export const BAKERY_STATUSES = ['Active', 'Under Review', 'Suspended'];

/** Bakery capabilities a box with these requirements needs. Vegetarian / Halal are met by every partner. */
export function needsFor(dietary = [], allergies = []) {
  const n = new Set();
  if (dietary.includes('glutenFree') || allergies.includes('gluten')) n.add('glutenFree');
  if (dietary.includes('dairyFree') || allergies.includes('dairy')) n.add('dairyFree');
  if (dietary.includes('vegan')) n.add('vegan');
  if (allergies.includes('egg')) n.add('eggFree');
  if (allergies.includes('treenut')) n.add('nutFree');
  if (allergies.includes('peanut')) n.add('peanutFree');
  if (allergies.includes('sesame')) n.add('sesameFree');
  if (allergies.includes('soy')) n.add('soyFree');
  return [...n];
}
export const bakeryCaps = b => { try { return JSON.parse(b.capabilities || '{}') || {}; } catch { return {}; } };
export const bakeryCovers = (b, needs = []) => needs.every(k => bakeryCaps(b)[k]);
/* Active partners only, and only while their food business licence is valid on that date (MB-BKY-001 §1). */
export const activeBakeries = (date = dubaiTodayIso()) => db.prepare("SELECT * FROM bakeries WHERE status = 'Active' AND (licence_expiry IS NULL OR licence_expiry = '' OR licence_expiry >= ?) ORDER BY distance_km").all(date);

/* ---------- Bakery availability for one date (MB-BKY-001 §6) ----------
   Active partners only, after the temporary conditions they reported for that date:
   Temporarily Unavailable removes the bakery, Reduced Capacity lowers it, Item Unavailable
   and Special Requirement Unavailable narrow what it can take. Morning Box allocates up to
   the effective capacity it set, which may be below the bakery's stated maximum. */
export const BAKERY_CONDITIONS = ['Item Unavailable', 'Reduced Capacity', 'Special Requirement Unavailable', 'Temporarily Unavailable'];
export const bakeryProducts = b => { try { return JSON.parse(b.products || 'null'); } catch { return null; } };
export const danishFlavours = b => { try { return JSON.parse(b.danish_flavours || 'null') || []; } catch { return []; } };
export function bakeriesFor(date) {
  const conds = db.prepare('SELECT * FROM bakery_conditions WHERE date = ?').all(date);
  return activeBakeries(date).flatMap(b => {
    const mine = conds.filter(c => c.bakery_id === b.id);
    if (mine.some(c => c.kind === 'Temporarily Unavailable')) return [];
    const reduced = mine.filter(c => c.kind === 'Reduced Capacity' && Number.isInteger(c.capacity)).map(c => c.capacity);
    const capacity = Math.max(0, Math.min(b.daily_capacity, b.effective_capacity ?? b.daily_capacity, ...reduced));
    const caps = { ...bakeryCaps(b) };
    for (const c of mine) if (c.kind === 'Special Requirement Unavailable' && c.need) caps[c.need] = false;
    const unavailable = mine.filter(c => c.kind === 'Item Unavailable' && c.item).map(c => c.item);
    return [{ ...b, capacity, capabilities: JSON.stringify(caps), unavailable, approved: bakeryProducts(b) }];
  });
}
/** Can this bakery make every item (components and add-ons) on that date? */
export const bakeryMakes = (b, items = []) => items.every(id => !(b.unavailable || []).includes(id) && (!b.approved || b.approved.includes(id)));

/** All boxes booked for a date (personal + business, not cancelled). */
export function boxesBookedOnDate(date) {
  const personal = db.prepare('SELECT COUNT(*) AS n FROM order_days WHERE date = ? AND cancelled = 0').get(date).n;
  const business = db.prepare('SELECT COALESCE(SUM(people), 0) AS n FROM business_days WHERE date = ? AND cancelled = 0').get(date).n;
  return personal + business;
}

/** Production capacity: booked boxes + new boxes must fit the Active bakeries able to make them. */
export function assertBakeryCapacity(date, boxes, needs = []) {
  const capacity = bakeriesFor(date).filter(b => bakeryCovers(b, needs)).reduce((t, b) => t + b.capacity, 0);
  if (boxesBookedOnDate(date) + boxes > capacity) {
    throw bad('capacity_full', `Our partner bakeries are fully booked for ${prettyDate(date)}. Please choose another morning.`, { date, needs });
  }
}

/* ---------- Delivery windows (local server time, Asia/Dubai) ---------- */
const WINDOW_START = { w1: '07:30', w2: '08:30', w3: '09:30' };
const WINDOW_END = { w1: '08:30', w2: '09:30', w3: '10:30' };
export const windowStart = (date, window) => new Date(`${date}T${WINDOW_START[window] || '07:30'}:00`);
export const windowEnd = (date, window) => new Date(`${date}T${WINDOW_END[window] || '10:30'}:00`);

/* ---------- Exceptions (MB-OPS-001 §8) ---------- */
export const EXCEPTION_CATEGORIES = ['Safety', 'Bakery', 'Courier', 'Customer/Location', 'Payment'];
export const EXCEPTION_KINDS = [...BASE_EXCEPTION_KINDS, 'Safety Incident', 'Pickup Delay', 'QC Failure', 'Delivery Failed', 'Payment Issue', 'Customer Issue', 'Handover Mismatch', 'Order Accuracy', 'Packaging Issue'];
const KIND_CATEGORY = {
  'Product/Ingredient Unavailable': 'Bakery', 'Capacity Issue': 'Bakery', 'Dietary/Allergy Issue': 'Safety',
  'Equipment/Operational Issue': 'Bakery', 'Courier Delay': 'Courier', 'Location Unavailable': 'Customer/Location',
  'Other': 'Customer/Location', 'Safety Incident': 'Safety', 'Pickup Delay': 'Bakery', 'QC Failure': 'Bakery',
  'Delivery Failed': 'Courier', 'Payment Issue': 'Payment', 'Customer Issue': 'Customer/Location', 'Handover Mismatch': 'Bakery', 'Order Accuracy': 'Bakery', 'Packaging Issue': 'Bakery'
};
/** Safety concerns receive the highest operational priority (1). */
export const PRIORITY = { Safety: 1, Bakery: 2, Courier: 2, Payment: 2, 'Customer/Location': 3 };

/**
 * Record an exception. Unless `dedupe` is false, an unresolved exception with
 * the same ref + kind is reused instead of creating a duplicate.
 * Returns the exception id.
 */
export function raiseException({ ref, kind, note = '', category, owner = null, action = null, cause = null, responsibleParty = null, customerCategory = null, dedupe = true }) {
  if (!EXCEPTION_KINDS.includes(kind)) throw bad('kind_invalid', `kind must be one of: ${EXCEPTION_KINDS.join(', ')}`);
  const cat = EXCEPTION_CATEGORIES.includes(category) ? category : KIND_CATEGORY[kind] || 'Customer/Location';
  if (dedupe) {
    const existing = db.prepare('SELECT id FROM exceptions WHERE ref = ? AND kind = ? AND resolved = 0').get(String(ref || ''), kind);
    if (existing) return existing.id;
  }
  const r = db.prepare(`INSERT INTO exceptions (ref, kind, note, category, priority, owner, action, cause, responsible_party, customer_category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(String(ref || ''), kind, String(note || '').slice(0, 1000), cat, PRIORITY[cat], owner, action, cause, responsibleParty, customerCategory);
  return Number(r.lastInsertRowid);
}
