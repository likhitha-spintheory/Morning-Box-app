/* Server-side rules. The browser is never trusted for safety, eligibility,
   price, cutoff or capacity: every order is re-validated and re-priced here
   with the same locked engine the app uses. */
import {
  recommend, configure, swapOptions, applySwap, hasSizeSelector, addonGroups, priceBox, traceRecord,
  businessModels, resolveSpecial, priceBusinessDay
} from '../src/domain/engine.js';
import { recipeById, describe, priceLevel } from '../src/domain/recipes.js';
import {
  CONTEXTS, DELIVERY_WINDOWS, DIETARY, ALLERGENS, PREFERENCES, EATING_STYLES, PRICE_LEVELS,
  isBeforeCutoff, orderableDates, isoDate
} from '../src/domain/standards.js';
import { db } from './db.js';

export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
export const bad = (code, message, details) => new ApiError(400, code, message, details);

const ids = list => list.map(x => x.id);
const isIso = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const str = (v, max = 120) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/* ---------- Profile (MB-PER-001) ---------- */
export function validateProfile(p) {
  if (!p || !ids(EATING_STYLES).includes(p.eatingStyle)) throw bad('profile_invalid', 'Choose an eating style.');
  const prefs = Array.isArray(p.preferences) ? p.preferences : [];
  if (!prefs.length || prefs.some(x => !ids(PREFERENCES).includes(x))) throw bad('profile_invalid', 'Choose at least one breakfast preference.');
  const dietary = Array.isArray(p.dietary) ? p.dietary : [];
  const allergies = Array.isArray(p.allergies) ? p.allergies : [];
  if (dietary.some(x => !ids(DIETARY).includes(x))) throw bad('profile_invalid', 'Unknown dietary requirement.');
  if (allergies.some(x => !ids(ALLERGENS).includes(x))) throw bad('profile_invalid', 'Unknown allergy.');
  return { eatingStyle: p.eatingStyle, preferences: [...new Set(prefs)], dietary: [...new Set(dietary)], allergies: [...new Set(allergies)] };
}

/* ---------- Dates & cutoff (MB-DLV-001 §2) ---------- */
export function assertOrderable(date) {
  if (!isIso(date)) throw bad('date_invalid', 'Invalid date.');
  const horizon = orderableDates(new Date(), 28).map(isoDate);
  if (!horizon.includes(date) || !isBeforeCutoff(date)) {
    throw bad('cutoff_passed', `Orders for ${date} closed at 9:00 PM the evening before.`);
  }
}
export function assertEditable(date, stage = 0) {
  if (!isBeforeCutoff(date)) throw bad('cutoff_passed', 'Changes for this morning closed at 9:00 PM the evening before.');
  if (stage > 0) throw bad('in_production', 'This morning is already being prepared and can no longer be changed.');
}

/* ---------- Capacity (MB-DLV-001 §8) ----------
   A window stays available only while production and delivery capacity
   remain. Capacity is counted in boxes per date and window. */
export const WINDOW_CAPACITY = Number(process.env.WINDOW_CAPACITY || 120);
export function boxesBooked(date, window, { excludeOrderDay, excludeBusinessDay } = {}) {
  const personal = db.prepare(`SELECT COUNT(*) AS n FROM order_days WHERE date = ? AND window = ? AND cancelled = 0 AND id IS NOT ?`)
    .get(date, window, excludeOrderDay ?? null).n;
  const business = db.prepare(`SELECT COALESCE(SUM(people), 0) AS n FROM business_days WHERE date = ? AND window = ? AND cancelled = 0 AND id IS NOT ?`)
    .get(date, window, excludeBusinessDay ?? null).n;
  return personal + business;
}
export function availability(date) {
  return Object.fromEntries(DELIVERY_WINDOWS.map(w => {
    const remaining = Math.max(0, WINDOW_CAPACITY - boxesBooked(date, w.id));
    return [w.id, { available: remaining > 0, remaining }];
  }));
}
export function assertCapacity(date, window, boxes, exclude = {}) {
  if (!ids(DELIVERY_WINDOWS).includes(window)) throw bad('window_invalid', 'Choose a delivery window.');
  if (boxesBooked(date, window, exclude) + boxes > WINDOW_CAPACITY) {
    throw bad('window_full', `The ${DELIVERY_WINDOWS.find(w => w.id === window).label} window on ${date} is fully booked.`, { date, window });
  }
}

/* ---------- Personal day (MB-BOX-001, MB-REC-001) ---------- */
export function buildPersonalDay(input, profile) {
  const { context, recipeId, components, size, addons = [] } = input;
  if (!ids(CONTEXTS).includes(context)) throw bad('context_invalid', 'Choose a daily context.');
  const rec = recommend(profile, context);
  const candidate = [rec.primary, rec.alternative].find(c => c && c.recipe.id === recipeId);
  if (!candidate) throw bad('not_eligible', 'This breakfast is not available for your profile and morning. Please plan it again.');

  const config = configure(candidate, profile);
  if (!Array.isArray(components) || components.length !== config.components.length) throw bad('components_invalid', 'Breakfast composition changed. Please plan it again.');
  components.forEach((id, i) => {
    if (id === config.components[i]) return;
    const r = applySwap(config, i, id);
    if (!r.ok) throw bad('swap_invalid', 'One of your swaps is not eligible for your profile.');
  });

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
    return g.units ? { group: g.id, item: a.item, unit: a.unit, qty: a.qty } : { group: g.id, item: a.item, qty: a.qty };
  });

  const price = priceBox(config).total;
  const cfg = {
    recipeId: config.recipe.id, context, which: candidate === rec.primary ? 'primary' : 'alternative',
    components: config.components, substitutions: config.substitutions, userSwaps: config.userSwaps,
    size: config.size, addons: config.addons, label: config.label, format: config.recipe.format || null
  };
  return { cfg, price, trace: traceRecord(config, context) };
}

export function validateAddress(a) {
  if (!a || !str(a.building) || !str(a.unit)) throw bad('address_invalid', 'Add your building and floor or unit.');
  return {
    building: a.building.trim(), unit: a.unit.trim(), area: 'DIFC',
    handover: a.handover === 'door' ? 'door' : 'reception',
    notes: typeof a.notes === 'string' ? a.notes.slice(0, 200) : ''
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
  if (!Number.isInteger(people) || people < 1 || people > 500) throw bad('people_invalid', 'Number of people must be between 1 and 500.');
  const lines = (input.lines || []).filter(l => l && l.qty > 0).map(l => {
    if (!['light', 'regular', 'large'].includes(l.size)) throw bad('size_invalid', 'Choose a size for each breakfast.');
    if (!Number.isInteger(l.qty) || l.qty < 0) throw bad('qty_invalid', 'Quantities must be whole numbers.');
    return { recipeId: l.recipeId, size: l.size, qty: l.qty, model: modelFor(l.recipeId) };
  });
  const specials = (input.specials || []).map(s => {
    const dietary = (s.dietary || []).filter(x => ids(DIETARY).includes(x));
    const allergies = (s.allergies || []).filter(x => ids(ALLERGENS).includes(x));
    if (!dietary.length && !allergies.length) throw bad('special_invalid', 'Each Special Breakfast needs at least one requirement.');
    if (!Number.isInteger(s.qty) || s.qty < 1) throw bad('special_invalid', 'Each Special Breakfast needs a quantity.');
    const r = resolveSpecial({ dietary, allergies, qty: s.qty }, 'regular');
    if (!r.resolved) throw bad('special_no_match', 'No approved breakfast can safely meet one of your Special Breakfast requirements.', { dietary, allergies });
    return r;
  });
  const boxes = lines.reduce((t, l) => t + l.qty, 0) + specials.reduce((t, s) => t + s.qty, 0);
  if (boxes !== people) throw bad('headcount_mismatch', `Total boxes (${boxes}) must equal the number of people (${people}).`, { boxes, people });
  const p = priceBusinessDay(lines, specials);
  return {
    people,
    lines: lines.map(({ recipeId, size, qty }) => ({ recipeId, size, qty })),
    specials: specials.map(s => ({ dietary: s.dietary, allergies: s.allergies, qty: s.qty, recipeId: s.resolved.recipe.id })),
    gross: Math.round(p.gross), discount: Math.round(p.discount), total: Math.round(p.total), discountPct: p.discountPct
  };
}

export function validateBusinessDelivery(d) {
  const need = ['company', 'building', 'office', 'contact', 'mobile'];
  const missing = need.filter(k => !str(d?.[k]));
  if (missing.length) throw bad('delivery_invalid', 'Complete the delivery details.', { missing });
  if (!/^5\d{8}$/.test(String(d.mobile).replace(/\D/g, '').replace(/^971/, ''))) throw bad('delivery_invalid', 'Enter a valid UAE mobile number for the contact person.');
  return { company: d.company.trim(), building: d.building.trim(), office: d.office.trim(), area: 'DIFC', contact: d.contact.trim(), mobile: d.mobile.trim(), notes: (d.notes || '').slice(0, 200) };
}

export const needsGlutenFreeHandling = (dietary = [], allergies = []) => dietary.includes('glutenFree') || allergies.includes('gluten');
