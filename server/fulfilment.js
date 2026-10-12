/* ============================================================
   Fulfilment — MB-OPS-001 §1–10, MB-BKY-001 §7, MB-DLV-001 §4–11
   Night before:  final allocation → production plan → bakery confirms
   Morning:       In Preparation → Ready (QC'd, packed, labelled) →
                  Handed Over / Picked Up (counts must match) →
                  Out for Delivery → Delivered (point + recipient) | Failed
   Exceptions get an owner, action and resolution; remedies are recorded.
   ============================================================ */
import { Router } from 'express';
import { db, json, parse, tx, logEvent } from './db.js';
import { ApiError, bad, prettyDate, raiseException, isIsoDate, bakeriesFor, bakeryCovers, bakeryMakes, danishFlavours, bakeryProducts } from './rules.js';
export { setStage };
import { notify } from './notify.js';
import { dayRows, personalRow, businessRow, rowBakeries, health, readyBy } from './days.js';
import { bakeryByCode, addCondition } from './admin.js';
import { personalUnits, businessUnits } from './allocation.js';
import { componentName, sizeLabel, windowLabel } from '../src/domain/app.js';
import { packingNote, COMPONENTS } from '../src/domain/library.js';

db.exec(`
CREATE TABLE IF NOT EXISTS bakery_plans (
  bakery_id INTEGER NOT NULL REFERENCES bakeries(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (bakery_id, date)
);
CREATE TABLE IF NOT EXISTS service_recovery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_kind TEXT NOT NULL,
  day_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS customer_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const TABLE = { personal: 'order_days', business: 'business_days' };
const OWNER_TABLE = { personal: 'orders', business: 'business_orders' };
export function loadDay(kind, id) {
  if (!TABLE[kind]) throw bad('kind_invalid', 'kind must be personal or business');
  const raw = db.prepare(`SELECT d.*, o.user_id FROM ${TABLE[kind]} d JOIN ${OWNER_TABLE[kind]} o ON o.id = d.order_id WHERE d.id = ?`).get(Number(id));
  if (!raw) throw new ApiError(404, 'not_found', 'Unknown delivery.');
  if (raw.cancelled) throw bad('cancelled', 'This delivery was cancelled.');
  return { raw, row: kind === 'personal' ? personalRow(raw) : businessRow(raw) };
}
const update = (kind, id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE ${TABLE[kind]} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
};
const ref = r => `${r.orderId}:${r.date}`;
const tell = (r, kind, message) => notify(r.userId, ref(r), kind, message);
const event = (r, kind, message) => { if (r.kind === 'personal') logEvent(r.orderId, r.date, kind, message); };

/* ---------- Customer-facing stage (0 Confirmed · 1 Being prepared · 2 Out for delivery · 3 Delivered) ---------- */
export const POINTS = { personal: ['Reception', 'your door', 'you in person'], business: ['Reception', 'the contact person'] };
const RECIPIENT = { Reception: 'Reception / Concierge', 'your door': 'Designated receiving point', 'you in person': 'Customer', 'the contact person': 'Contact Person' };
const dubaiTime = () => new Date().toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dubai' }).toUpperCase();
function setStage(kind, id, stage, point) {
  const { raw, row } = loadDay(kind, id);
  if (stage <= raw.stage) return;
  if (stage === 3 && !POINTS[kind].includes(point)) throw bad('point_required', `Choose where it was handed over: ${POINTS[kind].join(', ')}.`);
  update(kind, raw.id, { stage });
  if (stage === 3) {
    /* MB-DLV-001 §10–11: handover is delivery; after the window it is a late delivery (service failure). */
    const late = new Date() > new Date(row.windowEnds) ? 1 : 0;
    db.prepare(`UPDATE ${TABLE[kind]} SET delivered_at = datetime('now'), delivery_point = ?, recipient_type = ?, delivery_state = 'Delivered', late = ?, late_note = NULL WHERE id = ?`).run(point, RECIPIENT[point], late, raw.id);
    if (late) raiseException({ ref: `${kind}:${raw.id}`, kind: 'Courier Delay', note: `Delivered after the ${windowLabel(row.window)} window — late delivery (service failure)`, owner: 'Operations', action: 'Review the cause; apply service recovery if appropriate' });
  }
  event(row, 'stage', ['', 'Being prepared', 'Out for delivery', `Delivered to ${point}`][stage]);
  if (stage === 2) tell(row, 'on_the_way', `Your breakfast for ${prettyDate(row.date)} is on its way.`);
  /* DLV §5: "Delivered to Reception - 8:14 AM", then the simple feedback. */
  if (stage === 3) tell(row, 'delivered', `Delivered to ${point} · ${dubaiTime()}. Enjoy your morning! Loved it or not for you? Tell us in the app.`);
}

/* ---------- Each bakery's part of a delivery ----------
   A business order split by line has one part per bakery, each with its own
   state, quality check and handover (MB-B2B-001 §9, MB-OPS-001 §7). */
export function rowParts(row) {
  if (row.kind === 'personal') return row.bakeryId ? [{ bakeryId: row.bakeryId, boxes: 1, special: row.specialBoxes }] : [];
  return (row.allocation || []).map(p => ({
    bakeryId: p.bakeryId, boxes: p.boxes,
    special: p.items ? p.items.filter(it => row.production[it.entry]?.special?.length).reduce((t, it) => t + it.qty, 0) : row.specialBoxes
  }));
}
const partStates = raw => parse(raw.part_states) || {};
function aggregate(parts, states) {
  const list = parts.map(p => states[p.bakeryId]?.state || null);
  if (!list.length || list.every(x => !x)) return null;
  if (list.includes('Unable to Fulfil')) return 'Unable to Fulfil';
  if (list.includes('Delayed')) return 'Delayed';
  if (list.every(x => x === 'Handed Over')) return 'Handed Over';
  if (list.every(x => x === 'Ready' || x === 'Handed Over')) return 'Ready';
  if (list.some(x => ['In Preparation', 'Ready', 'Handed Over'].includes(x))) return 'In Preparation';
  return 'Confirmed';
}
function savePart(kind, raw, row, bakeryId, patch) {
  const states = partStates(raw);
  const targets = bakeryId ? [bakeryId] : rowParts(row).map(p => p.bakeryId);
  for (const t of targets) states[t] = { ...(states[t] || {}), ...patch };
  const agg = aggregate(rowParts(row), states);
  update(kind, raw.id, { part_states: json(states), bakery_state: agg });
  return { states, agg };
}

/* ---------- Bakery: plan confirmation (MB-OPS-001 §4) ---------- */
export const PLAN_ISSUES = ['Product/Ingredient Unavailable', 'Capacity Issue', 'Dietary/Allergy Issue', 'Equipment/Operational Issue', 'Other'];
const bakeryRows = (bakeryId, date) => dayRows(date).filter(r => rowBakeries(r).includes(bakeryId));
export function confirmPlan(bakeryId, date) {
  const b = db.prepare('SELECT status FROM bakeries WHERE id = ?').get(bakeryId);
  if (b?.status !== 'Active') throw bad('not_active', 'Only an Active partner bakery can confirm a production plan.');
  if (!bakeryRows(bakeryId, date).length) throw bad('nothing_allocated', 'No orders are allocated to this bakery for that date yet.');
  db.prepare(`INSERT INTO bakery_plans (bakery_id, date, status) VALUES (?, ?, 'Confirmed')
    ON CONFLICT(bakery_id, date) DO UPDATE SET status = 'Confirmed', reason = NULL, note = NULL, updated_at = datetime('now')`).run(bakeryId, date);
  for (const r of bakeryRows(bakeryId, date)) {
    const { raw } = loadDay(r.kind, r.id);
    if (!partStates(raw)[bakeryId]?.state) savePart(r.kind, raw, r, bakeryId, { state: 'Confirmed' });
  }
}
export function reportPlanIssue(bakeryId, date, reason, note) {
  if (!PLAN_ISSUES.includes(reason)) throw bad('reason_invalid', `Reason must be one of: ${PLAN_ISSUES.join(', ')}.`);
  const name = db.prepare('SELECT name FROM bakeries WHERE id = ?').get(bakeryId)?.name || `Bakery ${bakeryId}`;
  db.prepare(`INSERT INTO bakery_plans (bakery_id, date, status, reason, note) VALUES (?, ?, 'Issue Reported', ?, ?)
    ON CONFLICT(bakery_id, date) DO UPDATE SET status = 'Issue Reported', reason = excluded.reason, note = excluded.note, updated_at = datetime('now')`).run(bakeryId, date, reason, String(note || '').slice(0, 300) || null);
  return raiseException({ ref: `bakery:${bakeryId}:${date}`, kind: reason, category: 'Bakery', note: `${name} reported an issue with the ${date} plan${note ? `: ${note}` : ''}`, responsibleParty: name, owner: 'Operations', action: 'Reallocate affected orders or contact the customers' });
}
export const planStatus = (bakeryId, date) => db.prepare('SELECT status, reason, note, updated_at FROM bakery_plans WHERE bakery_id = ? AND date = ?').get(bakeryId, date) || null;

/* ---------- Bakery: production states (MB-OPS-001 §5, MB-BKY-001 §4, §7) ---------- */
export const BAKERY_STATES = ['In Preparation', 'Ready', 'Delayed', 'Unable to Fulfil'];
/* Final quality check before Ready (MB-BKY-001 §4). */
export const QC_CHECKS = { order: 'Correct order', components: 'Correct components', size: 'Correct size', addons: 'Add-ons included', allergy: 'Dietary / allergy identified', packaging: 'Packaging intact', labels: 'Labelled' };
export function setBakeryState(kind, id, state, { delayMinutes, reason, note, qcPassed, qc, bakeryId, byOps = false } = {}) {
  const { raw, row } = loadDay(kind, id);
  if (bakeryId && !rowBakeries(row).includes(bakeryId)) throw new ApiError(403, 'not_yours', 'This order is not allocated to your bakery.');
  if (!BAKERY_STATES.includes(state)) throw bad('state_invalid', `State must be one of: ${BAKERY_STATES.join(', ')}.`);
  if (raw.stage >= 2) throw bad('already_handed_over', 'This order has already left the bakery.');
  const targets = bakeryId ? [bakeryId] : rowBakeries(row);
  if (!targets.length) throw bad('not_allocated', 'This order has no bakery yet.');
  if (targets.some(t => partStates(raw)[t]?.state === 'Handed Over')) throw bad('already_handed_over', 'This part has already been handed over.');
  /* Every production plan is confirmed before morning production begins (MB-OPS-001 §4). */
  if (['In Preparation', 'Ready'].includes(state) && !byOps && targets.some(t => planStatus(t, row.date)?.status !== 'Confirmed')) throw bad('plan_not_confirmed', 'Confirm the production plan for this date first.');
  const bakeryName = db.prepare('SELECT name FROM bakeries WHERE id = ?').get(targets[0])?.name || 'The bakery';
  if (state === 'In Preparation') {
    for (const t of targets) savePart(kind, loadDay(kind, id).raw, row, t, { state, delay: null });
    if (raw.stage < 1) { update(kind, raw.id, { stage: 1, delay_minutes: null }); event(row, 'stage', 'Being prepared'); }
  } else if (state === 'Ready') {
    /* Ready only when prepared, quality checked, packed and labelled (MB-OPS-001 §5). */
    const checks = qcPassed === true ? Object.fromEntries(Object.keys(QC_CHECKS).map(k => [k, true])) : qc || {};
    const missing = Object.keys(QC_CHECKS).filter(k => checks[k] !== true);
    if (missing.length) throw bad('qc_required', `Complete the final check before Ready: ${missing.map(k => QC_CHECKS[k]).join(', ')}.`);
    for (const t of targets) savePart(kind, loadDay(kind, id).raw, row, t, { state: 'Ready', readyAt: new Date().toISOString(), qc: checks, delay: null });
    update(kind, raw.id, { qc_passed: 1, delay_minutes: null, ready_at: new Date().toISOString(), ...(raw.stage < 1 ? { stage: 1 } : {}) });
  } else if (state === 'Delayed') {
    const mins = Number(delayMinutes);
    if (!Number.isInteger(mins) || mins < 5 || mins > 180) throw bad('delay_invalid', 'Enter the expected delay in minutes (5–180).');
    for (const t of targets) savePart(kind, loadDay(kind, id).raw, row, t, { state: 'Delayed', delay: mins });
    update(kind, raw.id, { delay_minutes: mins });
    raiseException({ ref: `${kind}:${raw.id}`, kind: 'Pickup Delay', note: `${bakeryName}: ready about ${mins} min late${note ? ` — ${note}` : ''}`, responsibleParty: bakeryName, owner: 'Operations', action: 'Adjust pickup; warn the customer if the window will be missed' });
  } else {
    if (!PLAN_ISSUES.includes(reason)) throw bad('reason_required', `Choose why: ${PLAN_ISSUES.join(', ')}.`);
    for (const t of targets) savePart(kind, loadDay(kind, id).raw, row, t, { state: 'Unable to Fulfil' });
    update(kind, raw.id, { issue_reason: reason });
    const exId = raiseException({ ref: `${kind}:${raw.id}`, kind: reason, category: reason === 'Dietary/Allergy Issue' ? 'Safety' : 'Bakery', note: `${bakeryName} cannot fulfil: ${reason}${note ? ` — ${note}` : ''}`, responsibleParty: bakeryName, owner: 'Operations', action: 'Reallocate to the next eligible bakery, otherwise full refund', dedupe: false });
    /* MB-OPS-001 §4 / MB-DLV-001 §11: try the next eligible bakery; if none can, the breakfast is refunded in full and the customer told. */
    try {
      const next = reallocate(kind, raw.id, { exclude: targets });
      db.prepare('UPDATE exceptions SET resolution = ?, resolved = 1, resolved_at = datetime(\'now\') WHERE id = ?').run(`Reallocated automatically to ${next.name}`, exId);
    } catch {
      applyRemedy(kind, raw.id, { type: 'Full Refund', reason: 'We couldn’t prepare your breakfast this morning' });
      update(kind, raw.id, { delivery_state: 'Not Fulfilled' });
      db.prepare('UPDATE exceptions SET action = ? WHERE id = ?').run('No other bakery could take it — full refund issued; customer told', exId);
    }
  }
}

/** Move one delivery to the nearest other eligible bakery with room (MB-OPS-001 §4, MB-DLV-001 §6). */
export function reallocate(kind, id, { exclude = [] } = {}) {
  const { raw, row } = loadDay(kind, id);
  if (raw.stage >= 2) throw bad('already_dispatched', 'This order has already left the bakery.');
  const current = [...new Set([...rowBakeries(row), ...exclude])];
  const units = kind === 'personal' ? personalUnits(parse(raw.cfg), parse(raw.trace).inputs) : businessUnits(parse(raw.lines), parse(raw.specials));
  const rows = dayRows(row.date);
  const used = b => rows.filter(r => !(r.kind === kind && r.id === row.id)).reduce((t, r) => t + rowParts(r).filter(p => p.bakeryId === b).reduce((x, p) => x + p.boxes, 0), 0);
  const next = bakeriesFor(row.date).find(b => !current.includes(b.id) && units.every(u => bakeryCovers(b, u.needs) && (!u.glutenFree || b.gluten_free_certified) && bakeryMakes(b, u.items)
    && u.flavours.every(f => danishFlavours(b).includes(f))) && b.capacity - used(b.id) >= row.boxes);
  if (!next) throw bad('no_bakery', 'No other eligible bakery has capacity. Contact the customer and refund.');
  const reset = { bakery_state: null, part_states: null, issue_reason: null, delay_minutes: null, qc_passed: 0, ready_at: null };
  if (kind === 'personal') update(kind, raw.id, { bakery_id: next.id, ...reset });
  else update(kind, raw.id, { allocation: json([{ bakeryId: next.id, boxes: row.boxes, items: units.map(u => ({ entry: u.entry, qty: u.qty })) }]), ...reset });
  db.prepare(`UPDATE bakery_plans SET status = 'Changed — confirm again', updated_at = datetime('now') WHERE bakery_id = ? AND date = ? AND status = 'Confirmed'`).run(next.id, row.date);
  return next;
}

/* ---------- Courier routes, planned the night before (MB-OPS-001 §1, §6) ---------- */
export function assignRoute(kind, id, routeId) {
  const { raw } = loadDay(kind, id);
  const r = String(routeId || '').replace(/[^\w\- ]/g, '').trim().slice(0, 30);
  if (!r) throw bad('route_required', 'Enter the courier or route.');
  update(kind, raw.id, { route_id: r });
}

/* ---------- Handover: bakery hands over, courier picks up (MB-OPS-001 §6–7) ---------- */
export function recordHandover(kind, id, { boxes, specialBoxes, routeId, bakeryId, by = 'courier' }) {
  const { raw, row } = loadDay(kind, id);
  const parts = rowParts(row);
  const part = bakeryId ? parts.find(p => p.bakeryId === Number(bakeryId)) : parts.length === 1 ? parts[0] : null;
  if (!part) throw bad('part_required', parts.length > 1 ? 'This order comes from more than one bakery — record each bakery’s handover.' : 'This order has no bakery yet.');
  const states = partStates(raw);
  if (states[part.bakeryId]?.state !== 'Ready') throw bad('not_ready', 'The bakery has not marked this order Ready.');
  const route = String(routeId || raw.route_id || '').trim();
  if (!route) throw bad('route_required', 'Assign the courier or route before pickup.');
  /* Nothing leaves the bakery unless the physical handover matches the digital order record. */
  if (Number(boxes) !== part.boxes || Number(specialBoxes) !== part.special) {
    raiseException({ ref: `${kind}:${raw.id}`, kind: 'Handover Mismatch', note: `Counted ${boxes} boxes (${specialBoxes} special); expected ${part.boxes} (${part.special} special) from bakery #${part.bakeryId}. Not dispatched.`, owner: 'Operations', action: 'Resolve the count with the bakery before dispatch' });
    throw new ApiError(409, 'handover_mismatch', `Count doesn’t match: expected ${part.boxes} box${part.boxes > 1 ? 'es' : ''} (${part.special} special). Do not dispatch until resolved.`);
  }
  tx(() => {
    const at = new Date().toISOString();
    db.prepare(`INSERT INTO handovers (day_kind, day_id, bakery_id, boxes, special_boxes, ready_by, route_id, picked_up_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(kind, raw.id, part.bakeryId, part.boxes, part.special, readyBy(row.date, row.window, part.bakeryId).toISOString(), route.slice(0, 40), by === 'courier' ? at : null);
    const { states: next } = savePart(kind, raw, row, part.bakeryId, { state: 'Handed Over', handedOverAt: at, ...(by === 'courier' ? { pickedUpAt: at } : {}) });
    update(kind, raw.id, { route_id: route.slice(0, 40), handed_over_at: at });
    if (parts.every(p => next[p.bakeryId]?.state === 'Handed Over')) update(kind, raw.id, { delivery_state: 'Picked Up', picked_up_at: at });
  });
}
export function outForDelivery(kind, id) {
  const { raw } = loadDay(kind, id);
  if (!['Picked Up', 'Failed'].includes(raw.delivery_state)) throw bad('not_picked_up', 'Every part must be handed over and picked up first.');
  update(kind, raw.id, { delivery_state: 'Out for Delivery' });
  if (raw.stage < 2) setStage(kind, raw.id, 2);
}
export function markDelivered(kind, id, point) {
  const { raw } = loadDay(kind, id);
  if (raw.delivery_state !== 'Out for Delivery') throw bad('not_out', 'This order is not out for delivery.');
  setStage(kind, raw.id, 3, point);
}

/** Development only: walk one delivery through the real steps (plan, prepare, ready, handover, out, delivered). */
export function demoStep(kind, id) {
  const { raw, row } = loadDay(kind, id);
  if (raw.stage === 0) {
    for (const b of rowBakeries(row)) if (planStatus(b, row.date)?.status !== 'Confirmed') confirmPlan(b, row.date);
    setBakeryState(kind, id, 'In Preparation', { byOps: true });
  } else if (raw.stage === 1) {
    if (loadDay(kind, id).raw.bakery_state !== 'Ready') setBakeryState(kind, id, 'Ready', { qcPassed: true, byOps: true });
    for (const p of rowParts(row)) if (partStates(loadDay(kind, id).raw)[p.bakeryId]?.state !== 'Handed Over') recordHandover(kind, id, { bakeryId: p.bakeryId, boxes: p.boxes, specialBoxes: p.special, routeId: raw.route_id || 'DEMO' });
    outForDelivery(kind, id);
  } else if (raw.stage === 2) markDelivered(kind, id, 'Reception');
}

/* ---------- Failed delivery (MB-DLV-001 §6, §11) ---------- */
export const FAILURE_REASONS = ['Receiving point unavailable', 'Contact unreachable', 'Access refused', 'Wrong address', 'Other'];
export function markFailed(kind, id, reason, note) {
  const { raw, row } = loadDay(kind, id);
  if (!FAILURE_REASONS.includes(reason)) throw bad('reason_invalid', `Reason must be one of: ${FAILURE_REASONS.join(', ')}.`);
  if (raw.stage >= 3) throw bad('delivered', 'This order was already delivered.');
  db.prepare('INSERT INTO delivery_attempts (day_kind, day_id, reason, note) VALUES (?, ?, ?, ?)').run(kind, raw.id, reason, String(note || '').slice(0, 200) || null);
  update(kind, raw.id, { delivery_state: 'Failed' });
  raiseException({ ref: `${kind}:${raw.id}`, kind: 'Delivery Failed', category: reason === 'Wrong address' || reason === 'Receiving point unavailable' || reason === 'Contact unreachable' ? 'Customer/Location' : 'Courier', note: `${reason}${note ? ` — ${note}` : ''}`, owner: 'Operations', action: 'Contact the customer; re-attempt or apply the refund policy', dedupe: false });
  event(row, 'failed', `Delivery attempt failed: ${reason}`);
  tell(row, 'late', `We couldn’t hand over your breakfast for ${prettyDate(row.date)} (${reason.toLowerCase()}). We’ll contact you shortly.`);
}

/* ---------- Service recovery (MB-OPS-001 §10, MB-DLV-001 §11) ---------- */
export const REMEDIES = ['No Financial Action', 'Credit', 'Partial Refund', 'Full Refund'];
export function applyRemedy(kind, id, { type, amount, reason }) {
  if (!TABLE[kind]) throw bad('kind_invalid', 'kind must be personal or business');
  const raw = db.prepare(`SELECT d.*, o.user_id FROM ${TABLE[kind]} d JOIN ${OWNER_TABLE[kind]} o ON o.id = d.order_id WHERE d.id = ?`).get(Number(id));
  if (!raw) throw new ApiError(404, 'not_found', 'Unknown delivery.');
  if (!REMEDIES.includes(type)) throw bad('type_invalid', `Remedy must be one of: ${REMEDIES.join(', ')}.`);
  const why = String(reason || '').trim().slice(0, 200);
  if (!why) throw bad('reason_required', 'Record the reason.');
  const price = kind === 'personal' ? raw.price : raw.total;
  const already = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM service_recovery WHERE day_kind = ? AND day_id = ? AND type IN ('Partial Refund', 'Full Refund')`).get(kind, raw.id).n + (raw.cancelled ? price : 0);
  let value = 0;
  if (type === 'Full Refund') value = Math.max(0, price - already);
  if (type === 'Partial Refund' || type === 'Credit') {
    value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw bad('amount_invalid', 'Enter the amount in AED.');
    if (type === 'Partial Refund' && value > price - already) throw bad('amount_invalid', `At most AED ${price - already} can still be refunded.`);
  }
  if (type === 'Full Refund' && value === 0) throw bad('already_refunded', 'This morning has already been refunded in full.');
  const r = { orderId: raw.order_id, date: raw.date, userId: raw.user_id, kind };
  tx(() => {
    db.prepare('INSERT INTO service_recovery (day_kind, day_id, type, amount, reason) VALUES (?, ?, ?, ?, ?)').run(kind, raw.id, type, value, why);
    // Payment gateway integration point: refund `value` against the order's payment_ref.
    if (type.endsWith('Refund')) update(kind, raw.id, { refund: Math.round((raw.refund || 0) + value), refund_reason: why });
    if (type === 'Credit') db.prepare('INSERT INTO customer_credits (user_id, amount, reason, ref) VALUES (?, ?, ?, ?)').run(raw.user_id, value, why, ref(r));
  });
  if (type === 'Full Refund' || type === 'Partial Refund') { event(r, 'refund', `${type}: AED ${value} — ${why}`); tell(r, 'refund', `${type} of AED ${value} for ${prettyDate(raw.date)}: ${why}. It will reach your original payment method.`); }
  if (type === 'Credit') { event(r, 'credit', `Credit AED ${value} — ${why}`); tell(r, 'refund', `AED ${value} Morning Box credit added: ${why}. It’s used automatically on your next order.`); }
  return { type, amount: value };
}
export const creditBalance = userId => Math.max(0, db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM customer_credits WHERE user_id = ?').get(userId).n);

/* ---------- At risk of being late (MB-DLV-001 §6): tell the customer before the window ends ---------- */
export const AT_RISK_MINUTES = 15;
export function flagAtRisk(now = new Date()) {
  const date = now.toLocaleDateString('en-CA');
  let flagged = 0;
  for (const r of dayRows(date)) {
    if (r.stage >= 3 || r.atRisk || ['Failed', 'Not Fulfilled'].includes(r.deliveryState) || r.bakeryState === 'Unable to Fulfil') continue;
    const end = new Date(r.windowEnds);
    const delayedReady = r.bakeryState === 'Delayed' && readyBy(r.date, r.window, rowBakeries(r)[0]).getTime() + r.delayMinutes * 60e3 > end.getTime() - 20 * 60e3;
    const closeToEnd = now >= new Date(end.getTime() - AT_RISK_MINUTES * 60e3);
    if (!delayedReady && !closeToEnd) continue;
    /* At risk is a warning; "late" is only recorded when it is actually delivered after the window. */
    update(r.kind, r.id, { at_risk: 1, late_note: r.lateNote || 'a little after your window' });
    raiseException({ ref: `${r.kind}:${r.id}`, kind: r.deliveryState ? 'Courier Delay' : 'Pickup Delay', note: `At risk of missing the ${windowLabel(r.window)} window`, owner: 'Operations', action: 'Expedite; confirm the new time with the customer' });
    event(r, 'late', 'Running a little late');
    tell(r, 'late', `Sorry — your breakfast for ${prettyDate(r.date)} may arrive a little after your ${windowLabel(r.window)} window. We’re on it.`);
    flagged++;
  }
  return flagged;
}

/* ---------- Production plan & packing (MB-OPS-001 §3, MB-BKY-001 §5) ---------- */
const flavourText = a => (a.flavour ? ` — ${a.flavour}` : '');
/* forBakery: only what the bakery needs for production, safety and handover — no names or addresses (OPS §3, DLV §4). */
export function productionPlan(date, onlyBakery = null, { forBakery = false } = {}) {
  const names = Object.fromEntries(db.prepare('SELECT id, name FROM bakeries').all().map(b => [b.id, b.name]));
  const users = Object.fromEntries(db.prepare('SELECT id, first_name FROM users').all().map(u => [u.id, u.first_name]));
  const plans = {};
  for (const r of dayRows(date)) {
    const ids = rowBakeries(r);
    for (const bid of ids.length ? ids : [null]) {
      if (onlyBakery && bid !== onlyBakery) continue;
      const p = (plans[bid ?? 'none'] ||= { bakeryId: bid, bakery: bid ? names[bid] : 'Not allocated', status: bid ? planStatus(bid, date) : null, production: {}, addons: {}, packing: [], boxes: 0, special: 0, readyBy: null });
      /* A split business order: this bakery makes only its own lines (MB-B2B-001 §9). */
      const part = r.kind === 'business' && ids.length > 1 ? r.allocation.find(x => x.bakeryId === bid) : null;
      const production = part?.items ? part.items.map(it => ({ ...r.production[it.entry], qty: it.qty })).filter(l => l.qty > 0) : r.production;
      const share = part ? part.boxes : null;
      const specialShare = production.filter(l => l.special?.length).reduce((t, l) => t + l.qty, 0);
      p.boxes += share ?? r.boxes; p.special += part ? specialShare : r.specialBoxes;
      const ready = bid ? readyBy(r.date, r.window, bid).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : r.readyBy;
      if (!p.readyBy || ready < p.readyBy) p.readyBy = ready;
      for (const line of production) {
        const key = `${ready}|${line.box}|${line.size}|${(line.swaps || []).join(',')}|${(line.special || []).join(',')}|${line.components.join(',')}`;
        const agg = (p.production[key] ||= { readyBy: ready, box: line.box, size: sizeLabel(line.size), format: line.format, components: line.components, swaps: line.swaps || [], substitutions: line.substitutions || [], special: line.special || [], qty: 0 });
        agg.qty += line.qty;
        for (const a of line.addons || []) {
          const k = `${componentName(a.item)}${a.unit ? ` (${a.unit} loaf)` : ''}${flavourText(a)}`;
          p.addons[k] = (p.addons[k] || 0) + a.qty;
        }
      }
      p.packing.push({
        ref: r.orderId, kind: r.kind, id: r.id, name: forBakery ? null : r.kind === 'personal' ? users[r.userId] || '' : r.address.company,
        window: windowLabel(r.window), readyBy: ready, routeId: r.routeId, bakeryId: bid, boxes: share ?? r.boxes, specialBoxes: part ? specialShare : r.specialBoxes, shared: share !== null && share !== undefined ? `${share} of ${r.boxes} boxes` : null,
        state: (bid && r.partStates[bid]?.state) || r.bakeryState, safetyHold: r.safetyHold, otherAllergies: r.otherAllergies || '',
        lines: production.map(l => ({
          qty: l.qty, size: sizeLabel(l.size), box: l.box, components: l.components, special: l.special || [],
          addons: (l.addons || []).map(a => `${a.qty}× ${componentName(a.item)}${a.unit ? ` (${a.unit} loaf)` : ''}${flavourText(a)}`),
          format: l.format,
          packing: [...new Set([
            ...(l.format ? [`Format: ${l.format}`] : []),
            ...(l.componentIds || []).map(id => packingNote(id, { readyToEat: /ready-to-eat|sandwich/i.test(l.format || '') })),
            ...(l.addons || []).map(a => packingNote(a.item, { addon: true }))
          ].filter(Boolean))]
        }))
      });
    }
  }
  return Object.values(plans).map(p => ({
    ...p, production: Object.values(p.production).sort((a, b) => a.readyBy.localeCompare(b.readyBy) || b.qty - a.qty),
    addons: Object.entries(p.addons).map(([item, qty]) => ({ item, qty })), packing: p.packing.sort((a, b) => a.readyBy.localeCompare(b.readyBy))
  }));
}

/** One label per box (MB-BKY-001 §5): Morning Box, Order ID, breakfast, size and dietary/allergy indicators.
    The bakery's labels carry nothing else; the ops (courier) version adds name and drop-off point. */
export function labelsFor(date, onlyBakery = null, { forBakery = false } = {}) {
  const labels = [];
  const rows = dayRows(date);
  for (const p of productionPlan(date, onlyBakery, { forBakery })) {
    for (const o of p.packing) {
      const row = rows.find(r => r.kind === o.kind && r.id === o.id);
      const place = forBakery ? null : row.kind === 'personal' ? `${row.address.building}, ${row.address.unit}` : `${row.address.building}, ${row.address.office}`;
      const handover = forBakery ? null : row.kind === 'personal' ? (row.address.handover === 'door' ? 'Door' : 'Reception') : `Reception · ${row.address.contact}`;
      for (const l of o.lines) for (let i = 0; i < l.qty; i++) {
        labels.push({ ref: o.ref, name: o.name, window: o.window, readyBy: o.readyBy, place, handover, size: l.size, box: l.box, addons: i === 0 ? l.addons : [], warnings: l.special, safetyHold: o.safetyHold, bakery: p.bakery });
      }
    }
  }
  return labels;
}

/* ---------- Ops routes ---------- */
export function registerFulfilmentRoutes(router) {
  const kindId = req => [req.params.kind, Number(req.params.id)];
  router.get('/dashboard', (req, res) => {
    const date = String(req.query.date || '');
    if (!isIsoDate(date)) throw bad('date_invalid', 'Pass a date as YYYY-MM-DD');
    const now = new Date();
    const rows = dayRows(date).map(r => ({ ...r, health: health(r, now) }));
    const counts = rows.reduce((c, r) => ({ ...c, [r.health]: (c[r.health] || 0) + 1 }), {});
    const plans = bakeriesFor(date).map(b => ({ bakeryId: b.id, bakery: b.name, capacity: b.capacity, booked: rows.filter(r => rowBakeries(r).includes(b.id)).reduce((t, r) => t + r.boxes, 0), plan: planStatus(b.id, date) }));
    const read = k => parse(db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null);
    const fin = read(`final:${date}`), prov = read(`provisional:${date}`);
    const allocated = fin ? { ...fin, final: true } : prov ? { ...prov, final: false } : null;
    res.json({ date, rows, counts, plans, allocated });
  });
  router.post('/days/:kind/:id/bakery-state', (req, res) => { const [k, i] = kindId(req); setBakeryState(k, i, req.body.state, { ...req.body, bakeryId: req.body.bakeryId ? Number(req.body.bakeryId) : undefined, byOps: true }); res.json({ ok: true }); });
  router.post('/days/:kind/:id/route', (req, res) => { const [k, i] = kindId(req); assignRoute(k, i, req.body.routeId); res.json({ ok: true }); });
  /* Assign one courier/route to every delivery in a window the night before. */
  router.post('/routes', (req, res) => {
    const date = String(req.body.date || '');
    if (!isIsoDate(date)) throw bad('date_invalid', 'Pass a date as YYYY-MM-DD');
    const rows = dayRows(date).filter(r => !req.body.window || r.window === req.body.window).filter(r => r.stage < 2);
    rows.forEach(r => assignRoute(r.kind, r.id, req.body.routeId));
    res.json({ ok: true, assigned: rows.length });
  });
  router.post('/days/:kind/:id/reallocate', (req, res) => { const [k, i] = kindId(req); const b = reallocate(k, i); res.json({ ok: true, bakery: b.name }); });
  router.post('/days/:kind/:id/handover', (req, res) => { const [k, i] = kindId(req); recordHandover(k, i, req.body); res.json({ ok: true }); });
  router.post('/days/:kind/:id/out', (req, res) => { const [k, i] = kindId(req); outForDelivery(k, i); res.json({ ok: true }); });
  router.post('/days/:kind/:id/delivered', (req, res) => { const [k, i] = kindId(req); markDelivered(k, i, req.body.deliveryPoint); res.json({ ok: true }); });
  router.post('/days/:kind/:id/failed', (req, res) => { const [k, i] = kindId(req); markFailed(k, i, req.body.reason, req.body.note); res.json({ ok: true }); });
  router.post('/days/:kind/:id/remedy', (req, res) => { const [k, i] = kindId(req); res.json(applyRemedy(k, i, req.body)); });
  router.post('/plans/:bakeryId/:date/confirm', (req, res) => { confirmPlan(Number(req.params.bakeryId), req.params.date); res.json({ ok: true }); });
  router.get('/prep', (req, res) => {
    const date = String(req.query.date || '');
    if (!isIsoDate(date)) throw bad('date_invalid', 'Pass a date as YYYY-MM-DD');
    res.json({ date, bakeries: productionPlan(date) });
  });
  router.get('/labels', (req, res) => {
    const date = String(req.query.date || '');
    if (!isIsoDate(date)) throw bad('date_invalid', 'Pass a date as YYYY-MM-DD');
    res.json({ date, labels: labelsFor(date) });
  });
  router.get('/meta', (_req, res) => res.json({ planIssues: PLAN_ISSUES, failureReasons: FAILURE_REASONS, remedies: REMEDIES, points: POINTS, qcChecks: QC_CHECKS }));
}

/* ============================================================
   Bakery View — each Partner Bakery signs in with its own access code
   and sees only what is allocated to it (MB-OPS-001 §3; Master Plan §8).
   ============================================================ */
export const bakeryRouter = Router();
bakeryRouter.use((req, _res, next) => {
  const b = bakeryByCode(req.get('x-bakery-code'));
  if (!b) return next(new ApiError(401, 'unauthorised', 'Enter your bakery access code.'));
  /* A suspended bakery can still see and finish orders it has already started; it can't confirm new plans. */
  req.bakery = b; next();
});
const bakeryDate = req => { const d = String(req.query.date || req.body?.date || ''); if (!isIsoDate(d)) throw bad('date_invalid', 'Choose a date.'); return d; };
bakeryRouter.get('/me', (req, res) => {
  const approved = bakeryProducts(req.bakery);
  const items = Object.values(COMPONENTS).filter(c => !approved || approved.includes(c.id)).map(c => ({ id: c.id, name: c.name }));
  res.json({ id: req.bakery.id, name: req.bakery.name, status: req.bakery.status, danishFlavours: danishFlavours(req.bakery), planIssues: PLAN_ISSUES, qcChecks: QC_CHECKS, items });
});
bakeryRouter.get('/plan', (req, res) => {
  const date = bakeryDate(req);
  const plan = productionPlan(date, req.bakery.id, { forBakery: true })[0] || { bakeryId: req.bakery.id, bakery: req.bakery.name, status: planStatus(req.bakery.id, date), production: [], addons: [], packing: [], boxes: 0, special: 0, readyBy: null };
  res.json({ date, ...plan, conditions: db.prepare('SELECT id, kind, item, capacity, need, note FROM bakery_conditions WHERE bakery_id = ? AND date = ?').all(req.bakery.id, date) });
});
bakeryRouter.get('/labels', (req, res) => res.json({ labels: labelsFor(bakeryDate(req), req.bakery.id, { forBakery: true }) }));
bakeryRouter.post('/plan/confirm', (req, res) => { confirmPlan(req.bakery.id, bakeryDate(req)); res.json({ ok: true }); });
bakeryRouter.post('/plan/issue', (req, res) => { reportPlanIssue(req.bakery.id, bakeryDate(req), req.body.reason, req.body.note); res.json({ ok: true }); });
/** Batch: start preparing everything for one window (or the whole morning). */
bakeryRouter.post('/plan/start', (req, res) => {
  const date = bakeryDate(req);
  let n = 0;
  for (const r of bakeryRows(req.bakery.id, date)) {
    if (req.body.window && r.window !== req.body.window) continue;
    if (!r.bakeryState || r.bakeryState === 'Confirmed') { setBakeryState(r.kind, r.id, 'In Preparation', { bakeryId: req.bakery.id }); n++; }
  }
  res.json({ ok: true, started: n });
});
/** The bakery hands its part over to the courier: counts must match (MB-OPS-001 §6–7). */
bakeryRouter.post('/days/:kind/:id/handover', (req, res) => {
  recordHandover(req.params.kind, Number(req.params.id), { ...req.body, bakeryId: req.bakery.id, by: 'bakery' });
  res.json({ ok: true });
});
bakeryRouter.post('/days/:kind/:id/state', (req, res) => {
  setBakeryState(req.params.kind, Number(req.params.id), req.body.state, { ...req.body, bakeryId: req.bakery.id });
  res.json({ ok: true });
});
bakeryRouter.post('/conditions', (req, res) => res.status(201).json(addCondition(req.bakery.id, req.body).conditions));
