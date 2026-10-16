/* ============================================================
   Daily reconciliation — MB-OPS-001 §9
   "Morning Box automatically reconciles Customer Order <-> Bakery Fulfilment <->
    Delivery Record. Where these records match, the order is Automatically
    Reconciled. Only mismatches enter a Reconciliation Exception queue."
   "An order becomes Completed only after a valid delivery and Proof of Delivery."
   "Each order retains the financial records required for later settlement:
    Customer Payment, Discounts/Refunds, Bakery Payable, Delivery Cost and
    Morning Box Revenue/Margin."
   Runs from the server's scheduler for mornings that are over; safe to repeat.
   ============================================================ */
import { db, json, parse } from './db.js';
import { raiseException } from './rules.js';
import { DELIVERY_COST } from './settings.js';
import { dubaiTodayIso, addDaysIso } from '../src/domain/standards.js';

const TABLE = { personal: 'order_days', business: 'business_days' };
const round = n => Math.round(n * 100) / 100;

/** Mismatches between the order, the bakery handover and the delivery record of one delivery day. */
function mismatches(kind, d) {
  const issues = [];
  const handovers = db.prepare('SELECT boxes, special_boxes FROM handovers WHERE day_kind = ? AND day_id = ?').all(kind, d.id);
  const remedied = d.refund > 0 || !!db.prepare('SELECT 1 FROM service_recovery WHERE day_kind = ? AND day_id = ?').get(kind, d.id);
  if (d.stage === 3) {
    if (!d.delivery_point || !d.recipient_type) issues.push('Delivered without proof of delivery (handover point and recipient)');
    if (!handovers.length) issues.push('Delivered without a bakery handover record');
    const expected = kind === 'personal' ? 1 : d.people;
    const handed = handovers.reduce((t, h) => t + h.boxes, 0);
    if (handovers.length && handed !== expected) issues.push(`Bakery handed over ${handed} box${handed === 1 ? '' : 'es'}; the order has ${expected}`);
  } else if (d.delivery_state === 'Failed' || d.delivery_state === 'Not Fulfilled') {
    if (!remedied) issues.push(`${d.delivery_state === 'Failed' ? 'Failed delivery' : 'Not fulfilled'} without a recorded refund or remedy`);
  } else {
    issues.push('Morning is over but the order is not marked delivered or failed');
  }
  return issues;
}

/** The order's financial record (OPS §9, BKY §11). Business volume discounts are Morning Box's cost, not the bakery's. */
function financeOf(kind, d) {
  const payment = kind === 'personal' ? d.price : d.total;
  const discount = kind === 'business' ? (d.discount || 0) : 0;
  const parts = kind === 'personal' ? (d.bakery_id ? [{ bakeryId: d.bakery_id, boxes: 1 }] : []) : (parse(d.allocation) || []);
  const boxes = kind === 'personal' ? 1 : d.people;
  const payBase = kind === 'business' ? (d.gross ?? d.total) : d.price;
  const fulfilled = d.stage === 3 || (d.bakery_state && d.bakery_state !== 'Unable to Fulfil');
  const payout = Object.fromEntries(db.prepare('SELECT id, payout_pct FROM bakeries').all().map(b => [b.id, b.payout_pct]));
  const bakeryPayable = fulfilled ? parts.reduce((t, p) => t + payBase * (p.boxes / boxes) * (payout[p.bakeryId] ?? 60) / 100, 0) : 0;
  const deliveryCost = fulfilled ? DELIVERY_COST.perDelivery : 0;
  const refunds = d.refund || 0;
  return { payment, discount: round(discount), refunds, bakeryPayable: round(bakeryPayable), deliveryCost, margin: round(payment - refunds - bakeryPayable - deliveryCost) };
}

/** Reconcile every delivery on one past date. Returns counts. */
export function reconcileDate(date) {
  const out = { date, reconciled: 0, mismatched: 0, completed: 0 };
  for (const kind of Object.keys(TABLE)) {
    for (const d of db.prepare(`SELECT * FROM ${TABLE[kind]} WHERE date = ? AND cancelled = 0 AND (reconcile_status IS NULL OR reconcile_status = 'Mismatch')`).all(date)) {
      const issues = mismatches(kind, d);
      const completed = d.stage === 3 && !!d.delivery_point && !!d.recipient_type;
      const status = issues.length ? 'Mismatch' : 'Reconciled';
      db.prepare(`UPDATE ${TABLE[kind]} SET reconcile_status = ?, reconcile_issues = ?, finance = ?, completed_at = COALESCE(completed_at, ?), reconciled_at = datetime('now') WHERE id = ?`)
        .run(status, issues.length ? json(issues) : null, json(financeOf(kind, d)), completed ? new Date().toISOString() : null, d.id);
      if (issues.length) {
        raiseException({ ref: `${kind}:${d.id}`, kind: 'Reconciliation Mismatch', note: `${d.order_id} · ${date}: ${issues.join('; ')}`,
          owner: 'Operations', action: 'Check the order, bakery and delivery records and correct them' });
        out.mismatched++;
      } else out.reconciled++;
      if (completed) out.completed++;
    }
  }
  return out;
}

/** Reconcile the mornings that are over (yesterday back `days` days). Mismatches are re-checked until they match. */
export function reconcilePastMornings(days = 14, today = dubaiTodayIso()) {
  return Array.from({ length: days }, (_, i) => reconcileDate(addDaysIso(today, -(i + 1))));
}
