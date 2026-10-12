/* One row per delivery (a personal morning or a business day) for a date:
   what to make, for whom, where, and how far it has got. Shared by the ops
   console, the Bakery View, allocation and the reports. */
import { db, parse } from './db.js';
import { needsGlutenFreeHandling, needsFor, windowStart, windowEnd } from './rules.js';
import { componentName, componentPortion } from '../src/domain/app.js';
import { recipeById, describe } from '../src/domain/recipes.js';
import { variantLabel } from '../src/domain/engine.js';
import { DIETARY, ALLERGENS, cutoffFor } from '../src/domain/standards.js';

/* Readable requirement names for bakery sheets and labels: "Vegan", "Tree nuts". */
const NAMES = Object.fromEntries([...DIETARY, ...ALLERGENS.map(a => ({ ...a, label: `${a.label.split(' /')[0]}-free` }))].map(x => [x.id, x.label]));
const readable = ids => ids.map(id => NAMES[id] || id);

/* Ready-by: packed and labelled 30 minutes before the delivery window opens (MB-OPS-001 §1, §6). */
export const READY_BY_MINUTES = 30;
const leadOf = bakeryId => (bakeryId ? db.prepare('SELECT ready_lead_minutes FROM bakeries WHERE id = ?').get(bakeryId)?.ready_lead_minutes : null) ?? READY_BY_MINUTES;
export const readyBy = (date, window, bakeryId = null) => new Date(windowStart(date, window).getTime() - leadOf(bakeryId) * 60e3);
const hhmm = d => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

/** "Overnight Oats (plant milk base) · 150 g" — the build and approved portion the bakery must make (MB-PRO-001 §15.3). */
const builtName = (id, variants = {}, size = 'regular', flavour = null) =>
  `${componentName(id)}${variantLabel(id, variants[id]) ? ` (${variantLabel(id, variants[id]).toLowerCase()})` : ''}${id === 'fruitDanish' && flavour ? ` — ${flavour}` : ''} · ${componentPortion(id, size === 'standard' ? 'regular' : size)}`;

/* An unresolved Dietary/Allergy exception on the order (e.g. the customer's free-text allergy note):
   the bakery must not accept, prepare or hand it over until operations resolves it (MB-BKY-001 §3). */
export const openSafetyCheck = (kind, id) => !!db.prepare("SELECT 1 FROM exceptions WHERE ref = ? AND kind = 'Dietary/Allergy Issue' AND resolved = 0").get(`${kind}:${id}`);

function fulfilment(d, date, window) {
  const firstBakery = d.kind === 'personal' ? d.bakery_id : (parse(d.allocation) || [])[0]?.bakeryId;
  return {
    partStates: parse(d.part_states) || {}, atRisk: !!d.at_risk, routeId: d.route_id || null, readyAt: d.ready_at || null,
    handedOverAt: d.handed_over_at || null, pickedUpAt: d.picked_up_at || null,
    bakeryState: d.bakery_state || null, deliveryState: d.delivery_state || null, delayMinutes: d.delay_minutes || null,
    issueReason: d.issue_reason || null, late: !!d.late, lateNote: d.late_note, deliveredAt: d.delivered_at, deliveryPoint: d.delivery_point,
    recipientType: d.recipient_type || null, readyBy: hhmm(readyBy(date, window, firstBakery)), windowEnds: windowEnd(date, window).toISOString(),
    handover: db.prepare('SELECT * FROM handovers WHERE day_kind = ? AND day_id = ? ORDER BY id DESC').get(d.kind, d.id) || null,
    handovers: db.prepare('SELECT * FROM handovers WHERE day_kind = ? AND day_id = ? ORDER BY id').all(d.kind, d.id),
    attempts: db.prepare('SELECT reason, note, created_at FROM delivery_attempts WHERE day_kind = ? AND day_id = ? ORDER BY id').all(d.kind, d.id),
    safetyCheck: openSafetyCheck(d.kind, d.id)
  };
}

export function personalRow(d) {
  const cfg = parse(d.cfg); const inputs = parse(d.trace).inputs;
  /* Free-text allergies travel with the box as a special requirement, so it is counted and labelled as special (MB-BKY-001 §5). */
  const special = [...readable([...inputs.dietary, ...inputs.allergies]), ...(inputs.otherAllergies ? [`Also avoid: ${inputs.otherAllergies}`] : [])];
  return {
    kind: 'personal', id: d.id, orderId: d.order_id, userId: d.user_id, date: d.date, window: d.window, boxes: 1, specialBoxes: special.length ? 1 : 0,
    stage: d.stage, price: d.price, bakeryId: d.bakery_id, glutenFree: needsGlutenFreeHandling(inputs.dietary, inputs.allergies),
    needs: needsFor(inputs.dietary, inputs.allergies), safetyHold: !!d.safety_hold, otherAllergies: inputs.otherAllergies || '',
    production: [{
      qty: 1, size: cfg.size, recipeId: cfg.recipeId, box: describe({ ...recipeById[cfg.recipeId], components: cfg.components }), format: recipeById[cfg.recipeId]?.format || null,
      components: cfg.components.map(id => builtName(id, cfg.variants, cfg.size, cfg.danishFlavour)), componentIds: cfg.components,
      swaps: (cfg.userSwaps || []).map(s => `${componentName(s.to)} instead of ${componentName(s.from)}`),
      substitutions: (cfg.substitutions || []).map(s => `${componentName(s.to)} instead of ${componentName(s.from)}`),
      addons: cfg.addons || [], special
    }],
    items: [...cfg.components, ...(cfg.addons || []).map(a => a.item)], flavours: [...(cfg.addons || []).filter(a => a.flavour).map(a => a.flavour), ...(cfg.danishFlavour ? [cfg.danishFlavour] : [])],
    address: parse(d.address), ...fulfilment({ ...d, kind: 'personal' }, d.date, d.window)
  };
}

export function businessRow(d) {
  const lines = parse(d.lines); const specials = parse(d.specials);
  const specialBoxes = specials.reduce((t, s) => t + s.qty, 0);
  return {
    kind: 'business', id: d.id, orderId: d.order_id, userId: d.user_id, date: d.date, window: d.window, boxes: d.people, specialBoxes,
    stage: d.stage, price: d.total, allocation: parse(d.allocation), glutenFree: specials.some(s => needsGlutenFreeHandling(s.dietary, s.allergies)),
    needs: needsFor([...new Set(specials.flatMap(s => s.dietary))], [...new Set(specials.flatMap(s => s.allergies))]),
    production: [
      ...lines.map(l => ({ qty: l.qty, size: l.size, recipeId: l.recipeId, box: describe(recipeById[l.recipeId] || { components: [] }), format: recipeById[l.recipeId]?.format || null, components: (recipeById[l.recipeId]?.components || []).map(id => builtName(id, {}, l.size)), componentIds: recipeById[l.recipeId]?.components || [], addons: [] })),
      ...specials.map(s => ({
        qty: s.qty, size: s.size || 'regular', recipeId: s.recipeId, box: describe({ ...recipeById[s.recipeId], components: s.components || recipeById[s.recipeId]?.components || [] }), format: recipeById[s.recipeId]?.format || null,
        components: (s.components || recipeById[s.recipeId]?.components || []).map(id => builtName(id, s.variants, s.size || 'regular')), componentIds: s.components || recipeById[s.recipeId]?.components || [],
        substitutions: (s.substitutions || []).map(x => `${componentName(x.to)} instead of ${componentName(x.from)}`), addons: [], special: readable([...s.dietary, ...s.allergies])
      }))
    ],
    items: [...new Set([...lines.flatMap(l => recipeById[l.recipeId]?.components || []), ...specials.flatMap(s => s.components || recipeById[s.recipeId]?.components || [])])], flavours: [],
    address: parse(d.delivery), ...fulfilment({ ...d, kind: 'business' }, d.date, d.window)
  };
}

export function dayRows(date) {
  const personal = db.prepare(`SELECT d.*, o.user_id FROM order_days d JOIN orders o ON o.id = d.order_id WHERE d.date = ? AND d.cancelled = 0`).all(date).map(personalRow);
  const business = db.prepare(`SELECT d.*, o.user_id FROM business_days d JOIN business_orders o ON o.id = d.order_id WHERE d.date = ? AND d.cancelled = 0`).all(date).map(businessRow);
  return [...personal, ...business];
}

/** A row's bakery ids (business days may be split across bakeries). */
export const rowBakeries = r => (r.kind === 'personal' ? (r.bakeryId ? [r.bakeryId] : []) : (r.allocation || []).map(p => p.bakeryId));

/**
 * Dashboard status (MB-OPS-001 §5, §8): On Track, Attention Required, Late or Failed.
 * Normal orders need no attention; only the exceptions are surfaced.
 */
export function health(r, now = new Date()) {
  if (r.stage >= 3) return r.late ? 'Delivered late' : 'Delivered';
  if (['Failed', 'Not Fulfilled'].includes(r.deliveryState) || r.bakeryState === 'Unable to Fulfil') return 'Failed';
  if (now > new Date(r.windowEnds)) return 'Late';
  /* Attention: safety hold, no bakery, a delay or at-risk warning, an unconfirmed plan after cutoff, or not ready by ready-by. */
  const unconfirmed = now >= cutoffFor(r.date) && rowBakeries(r).some(b => db.prepare('SELECT status FROM bakery_plans WHERE bakery_id = ? AND date = ?').get(b, r.date)?.status !== 'Confirmed');
  const attention = r.safetyHold || r.safetyCheck || !rowBakeries(r).length || r.bakeryState === 'Delayed' || r.atRisk || (unconfirmed && !r.bakeryState?.match(/Ready|Handed/))
    || (now > readyBy(r.date, r.window, rowBakeries(r)[0]) && !['Ready', 'Handed Over'].includes(r.bakeryState) && !r.deliveryState);
  return attention ? 'Attention Required' : 'On Track';
}
