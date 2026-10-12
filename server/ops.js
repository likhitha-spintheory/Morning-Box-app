import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { db, json, parse, tx, logEvent } from './db.js';
import {
  ApiError, bad, prettyDate, needsGlutenFreeHandling, needsFor, bakeryCovers, activeBakeries, raiseException, EXCEPTION_KINDS, isIsoDate,
  bakeriesFor, bakeryMakes, danishFlavours
} from './rules.js';
import { adminRouter } from './admin.js';
import { menuRouter } from './menu.js';
import { dayRows, readyBy as rbBy } from './days.js';
import { DELIVERY_COST } from './settings.js';
import { allocate } from './allocation.js';
export { allocate };
import { registerFulfilmentRoutes, flagAtRisk, demoStep } from './fulfilment.js';
export { flagAtRisk };
import { requireUser, checkStaffCode } from './auth.js';
import { notify } from './notify.js';
import { VAT_RATE } from './company.js';
import { addDaysIso, dubaiIsoOf, cutoffFor } from '../src/domain/standards.js';
import { componentName, boxName, sizeLabel, windowLabel } from '../src/domain/app.js';
import { recipeById, describe } from '../src/domain/recipes.js';

const DEV = process.env.NODE_ENV !== 'production';
/* In production the operations API stays closed until a real OPS_KEY is configured. */
const OPS_KEY = process.env.OPS_KEY || (DEV ? 'dev-ops-key' : '');
if (!DEV && (!OPS_KEY || OPS_KEY === 'dev-ops-key')) console.warn('[ops] OPS_KEY is not set — the operations API is disabled.');
const digest = s => createHash('sha256').update(String(s)).digest();

/* ---------- Operations & bakery API (MB-OPS-001, MB-BKY-001) ---------- */
export const opsRouter = Router();
opsRouter.use((req, _res, next) => {
  if (!OPS_KEY || (!DEV && OPS_KEY === 'dev-ops-key')) return next(new ApiError(503, 'ops_disabled', 'Operations API is not configured.'));
  const ok = timingSafeEqual(digest(req.get('x-ops-key') || ''), digest(OPS_KEY));
  try { checkStaffCode(req, 'ops', ok); } catch (e) { return next(e); }
  if (!ok) return next(new ApiError(401, 'unauthorised', 'Operations key required.'));
  next();
});
opsRouter.use('/admin/menu', menuRouter);
opsRouter.use('/admin', adminRouter);
registerFulfilmentRoutes(opsRouter);
/* Retention (Master Plan §15): repeat customers, repeat-week usage and mornings per active customer. */
function retention(from, to) {
  const rows = db.prepare(`SELECT o.user_id AS u, d.date FROM order_days d JOIN orders o ON o.id = d.order_id WHERE d.cancelled = 0 AND d.date BETWEEN ? AND ?`).all(from, to);
  const byUser = {};
  for (const r of rows) (byUser[r.u] ||= []).push(r.date);
  const users = Object.values(byUser);
  const weekOf = iso => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const biz = db.prepare(`SELECT o.user_id AS u, COUNT(DISTINCT o.id) AS n FROM business_days d JOIN business_orders o ON o.id = d.order_id WHERE d.cancelled = 0 AND d.date BETWEEN ? AND ? GROUP BY o.user_id`).all(from, to);
  return {
    activeCustomers: users.length,
    repeatCustomers: users.filter(ds => new Set(ds).size > 1).length,
    repeatWeekCustomers: users.filter(ds => new Set(ds.map(weekOf)).size > 1).length,
    morningsPerActiveCustomer: users.length ? Math.round((rows.length / users.length) * 10) / 10 : null,
    repeatBusinessCustomers: biz.filter(b => b.n > 1).length
  };
}
const plainText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, max) : '');
const requireDate = v => { const d = String(v || ''); if (!isIsoDate(d)) throw bad('date_invalid', 'Pass a date as YYYY-MM-DD'); return d; };

opsRouter.get('/bakeries', (_req, res) => res.json(activeBakeries()));

/** Production & delivery list for one morning. */
opsRouter.get('/days', (req, res) => {
  res.json(dayRows(requireDate(req.query.date)));
});

/**
 * Allocation at cutoff (MB-B2B-001 §9, MB-DLV-001 §7):
 * filter by eligibility (Active partners whose allergen capabilities cover the
 * boxes' needs) and remaining capacity, then
 * proximity first. Business orders use Single Bakery First and expand to the
 * next nearest eligible bakery only when capacity requires it.
 */
opsRouter.post('/allocate', (req, res) => {
  const date = requireDate(req.body.date);
  res.json(allocate(date));
});

/** Final allocation at the 9:00 PM cutoff: once per date, for the morning that just closed. */
export function allocateAtCutoff(now = new Date()) {
  const date = addDaysIso(dubaiIsoOf(now), 1);
  if (cutoffFor(date) > now) return null;
  if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(`final:${date}`)) return null;
  return allocate(date, { final: true });
}

/** Running late: tell the customer the new time. Shown on their order until it is delivered. */
opsRouter.post('/days/:kind/:id/late', (req, res) => {
  const kind = req.params.kind;
  if (!['personal', 'business'].includes(kind)) throw bad('kind_invalid', 'kind must be personal or business');
  const eta = String(req.body.eta || '').trim().slice(0, 40);
  if (!eta) throw bad('eta_required', 'Enter the new time, e.g. 9:20 AM.');
  const table = kind === 'business' ? 'business_days' : 'order_days';
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(req.params.id));
  if (!row) throw new ApiError(404, 'not_found', 'Unknown delivery.');
  if (row.cancelled || row.stage >= 3) throw bad('not_open', 'This delivery is already closed.');
  db.prepare(`UPDATE ${table} SET late_note = ?, at_risk = 1 WHERE id = ?`).run(eta, row.id);
  const owner = db.prepare(`SELECT user_id FROM ${kind === 'business' ? 'business_orders' : 'orders'} WHERE id = ?`).get(row.order_id);
  if (kind === 'personal') logEvent(row.order_id, row.date, 'late', `Running late — now expected around ${eta}`);
  if (owner) notify(owner.user_id, `${row.order_id}:${row.date}`, 'late', `Sorry — your breakfast for ${prettyDate(row.date)} is running late. It should arrive around ${eta}.`);
  res.json({ ok: true });
});

/* ---------- Reports (MB-OPS-001 §9, §11; Master Plan §15) ----------
   Per day: orders, revenue, refunds, delivered / on time / late / failed, exceptions
   by category; plus partner performance and recommendation KPIs for the range. */
opsRouter.get('/report', (req, res) => {
  const from = requireDate(req.query.from), to = requireDate(req.query.to);
  if (to < from) throw bad('range_invalid', 'The end date is before the start date.');
  const FULFIL = `SUM(stage = 3 AND cancelled = 0) AS delivered, SUM(stage = 3 AND cancelled = 0 AND late = 0) AS onTime,
      SUM(cancelled = 0 AND late = 1) AS late, SUM(cancelled = 0 AND (delivery_state = 'Failed' OR bakery_state = 'Unable to Fulfil')) AS failed`;
  const personal = db.prepare(`SELECT date, SUM(cancelled = 0) AS mornings, SUM(CASE WHEN cancelled = 0 THEN price ELSE 0 END) AS revenue,
      SUM(cancelled) AS cancelled, SUM(CASE WHEN cancelled = 1 THEN COALESCE(NULLIF(refund, 0), price) ELSE refund END) AS refunds,
      SUM(cancelled = 1 OR refund > 0) AS refundedOrders,
      ${FULFIL}, SUM(feedback = 'Loved it') AS loved, SUM(feedback = 'Not for me') AS notForMe
    FROM order_days WHERE date BETWEEN ? AND ? GROUP BY date`).all(from, to);
  const business = db.prepare(`SELECT date, SUM(cancelled = 0) AS orders, SUM(CASE WHEN cancelled = 0 THEN people ELSE 0 END) AS boxes,
      SUM(CASE WHEN cancelled = 0 THEN total ELSE 0 END) AS revenue, SUM(CASE WHEN cancelled = 0 THEN discount ELSE 0 END) AS discounts,
      SUM(cancelled) AS cancelled, SUM(refund) AS refunds, SUM(refund > 0) AS refundedOrders, ${FULFIL}
    FROM business_days WHERE date BETWEEN ? AND ? GROUP BY date`).all(from, to);
  const credits = db.prepare(`SELECT substr(ref, -10) AS date, SUM(amount) AS n FROM customer_credits WHERE substr(ref, -10) BETWEEN ? AND ? GROUP BY date`).all(from, to);
  /* Exceptions count against the delivery date of the order they concern; others by the day they were raised (MB-OPS-001 §9). */
  const exceptions = db.prepare(`SELECT date, category, COUNT(*) AS n FROM (
      SELECT COALESCE(
        CASE WHEN e.ref LIKE 'personal:%' THEN (SELECT d.date FROM order_days d WHERE d.id = CAST(substr(e.ref, 10) AS INTEGER)) END,
        CASE WHEN e.ref LIKE 'business:%' THEN (SELECT d.date FROM business_days d WHERE d.id = CAST(substr(e.ref, 10) AS INTEGER)) END,
        CASE WHEN e.ref LIKE 'bakery:%:____-__-__' THEN substr(e.ref, -10) END,
        date(e.created_at)) AS date, e.category FROM exceptions e)
    WHERE date BETWEEN ? AND ? GROUP BY date, category`).all(from, to);
  const dates = [...new Set([...personal, ...business].map(r => r.date))].sort();
  const days = dates.map(date => {
    const p = personal.find(r => r.date === date) || {}, b = business.find(r => r.date === date) || {};
    const ex = cat => exceptions.filter(e => e.date === date && (!cat || e.category === cat)).reduce((t, e) => t + e.n, 0);
    return {
      date, personalMornings: p.mornings || 0, businessOrders: b.orders || 0, businessBoxes: b.boxes || 0,
      boxes: (p.mornings || 0) + (b.boxes || 0), revenue: (p.revenue || 0) + (b.revenue || 0),
      personalRevenue: p.revenue || 0, businessRevenue: b.revenue || 0, businessDiscounts: b.discounts || 0,
      cancelled: (p.cancelled || 0) + (b.cancelled || 0), refunds: (p.refunds || 0) + (b.refunds || 0), refundedOrders: (p.refundedOrders || 0) + (b.refundedOrders || 0), credits: credits.find(c => c.date === date)?.n || 0,
      delivered: (p.delivered || 0) + (b.delivered || 0), onTime: (p.onTime || 0) + (b.onTime || 0), late: (p.late || 0) + (b.late || 0), failed: (p.failed || 0) + (b.failed || 0),
      exceptions: ex(), safety: ex('Safety'), bakeryIssues: ex('Bakery'), courierIssues: ex('Courier'), customerIssues: ex('Customer/Location'),
      loved: p.loved || 0, notForMe: p.notForMe || 0
    };
  });
  const sum = k => days.reduce((t, d) => t + d[k], 0);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  /* Every delivery in the range (personal and business), with its bakery parts — for partner, courier and finance figures. */
  const all = [];
  for (const [kind, table, price] of [['personal', 'order_days', 'price'], ['business', 'business_days', 'total']]) {
    for (const d of db.prepare(`SELECT * FROM ${table} WHERE date BETWEEN ? AND ? AND cancelled = 0`).all(from, to)) {
      const parts = kind === 'personal' ? (d.bakery_id ? [{ bakeryId: d.bakery_id, boxes: 1 }] : []) : (parse(d.allocation) || []);
      const ready = rbBy(d.date, d.window, parts[0]?.bakeryId);
      const picked = d.picked_up_at ? new Date(d.picked_up_at) : null;
      all.push({ kind, d, parts, price: d[price], boxes: kind === 'personal' ? 1 : d.people,
        readyOnTime: d.ready_at ? new Date(d.ready_at) <= ready : null, pickupLate: picked ? picked > new Date(ready.getTime() + 15 * 60e3) : null,
        issues: db.prepare(`SELECT reason FROM customer_issues WHERE order_id = ? AND date = ?`).all(d.order_id, d.date).map(x => x.reason),
        refunds: (d.refund || 0) });
    }
  }
  /* Partner performance (MB-BKY-001 §9, OPS §11): order accuracy, ready on time, quality, fulfilment reliability, feedback. */
  /* Delayed / Unable to Fulfil come from the partner log, so a reallocated order still counts against the bakery that reported it (BKY §9). */
  const logged = db.prepare('SELECT bakery_id, kind, COUNT(DISTINCT day_kind || day_id) AS n FROM bakery_events WHERE date BETWEEN ? AND ? GROUP BY bakery_id, kind').all(from, to);
  const loggedOf = (id, kind) => logged.find(e => e.bakery_id === id && e.kind === kind)?.n || 0;
  const plansIn = db.prepare("SELECT bakery_id, COUNT(*) AS total, SUM(status = 'Confirmed') AS confirmed FROM bakery_plans WHERE date BETWEEN ? AND ? GROUP BY bakery_id").all(from, to);
  const partners = db.prepare('SELECT id, name FROM bakeries ORDER BY distance_km').all().map(b => {
    const mine = all.filter(x => x.parts.some(p => p.bakeryId === b.id));
    const n = mine.length;
    const plans = plansIn.find(x => x.bakery_id === b.id);
    return {
      id: b.id, name: b.name, mornings: n, boxes: mine.reduce((t, x) => t + (x.parts.find(p => p.bakeryId === b.id)?.boxes || 0), 0),
      delivered: mine.filter(x => x.d.stage === 3).length, late: mine.filter(x => x.d.late).length,
      readyOnTime: pct(mine.filter(x => x.readyOnTime).length, mine.filter(x => x.readyOnTime !== null).length),
      delayed: loggedOf(b.id, 'Delayed'), unable: loggedOf(b.id, 'Unable to Fulfil'),
      plans: plans?.total || 0, planConfirmation: plans ? pct(plans.confirmed || 0, plans.total) : null,
      accuracyIssues: mine.filter(x => x.issues.includes('Wrong or missing items')).length,
      qualityIssues: mine.filter(x => x.issues.some(i => ['Quality issue', 'Packaging issue'].includes(i))).length,
      loved: mine.filter(x => x.d.feedback === 'Loved it').length, notForMe: mine.filter(x => x.d.feedback === 'Not for me').length
    };
  });
  /* Delivery partner / courier performance (OPS §11): pickup, on time, failed, delivery complaints. */
  const routes = [...new Set(all.map(x => x.d.route_id).filter(Boolean))].map(route => {
    const mine = all.filter(x => x.d.route_id === route);
    return { route, deliveries: mine.length, pickupLate: mine.filter(x => x.pickupLate).length, delivered: mine.filter(x => x.d.stage === 3).length,
      late: mine.filter(x => x.d.late).length, failed: mine.filter(x => x.d.delivery_state === 'Failed').length,
      complaints: mine.filter(x => x.issues.some(i => ['Not delivered', 'Arrived late'].includes(i))).length };
  });
  /* Finance per order (OPS §9): customer payment, refunds, bakery payable, delivery cost, Morning Box margin. */
  const deliveryCost = DELIVERY_COST.perDelivery;
  const payout = Object.fromEntries(db.prepare('SELECT id, payout_pct FROM bakeries').all().map(b => [b.id, b.payout_pct]));
  const finance = { payments: 0, refunds: 0, bakeryPayable: 0, deliveryCost: 0, margin: 0 };
  for (const x of all) {
    const fulfilled = x.d.stage === 3 || (x.d.bakery_state && x.d.bakery_state !== 'Unable to Fulfil');
    /* Bakery payable: each bakery's share of the breakfast price at its agreed payout percentage (BKY §11). */
    const payable = fulfilled ? x.parts.reduce((t, p) => t + x.price * (p.boxes / x.boxes) * (payout[p.bakeryId] ?? 60) / 100, 0) : 0;
    finance.payments += x.price; finance.refunds += x.refunds; finance.bakeryPayable += payable; finance.deliveryCost += fulfilled ? deliveryCost : 0;
  }
  finance.margin = finance.payments - finance.refunds - finance.bakeryPayable - finance.deliveryCost;
  for (const k of Object.keys(finance)) finance[k] = Math.round(finance[k] * 100) / 100;
  const completed = all.filter(x => x.d.stage === 3 && x.d.delivery_point && x.d.recipient_type && db.prepare('SELECT 1 FROM handovers WHERE day_kind = ? AND day_id = ?').get(x.kind, x.d.id)).length;
  /* Recommendation KPIs (Master Plan §15). */
  const cfgRows = db.prepare('SELECT d.cfg, o.user_id FROM order_days d JOIN orders o ON o.id = d.order_id WHERE d.date BETWEEN ? AND ? AND d.cancelled = 0').all(from, to);
  const cfgs = cfgRows.map(r => parse(r.cfg));
  /* Repeat breakfast: of customers with more than one morning, the share who had the same breakfast more than once. */
  const recipesBy = {};
  for (const r of cfgRows) (recipesBy[r.user_id] ||= []).push(parse(r.cfg).recipeId);
  const multi = Object.values(recipesBy).filter(l => l.length > 1);
  const supportBusiness = db.prepare("SELECT COUNT(*) AS n FROM support_requests WHERE topic = 'Business orders' AND date(created_at) BETWEEN ? AND ?").get(from, to).n;
  const avgOf = sql => { const a = db.prepare(sql).get(from, to).a; return a ? Math.round(a) : null; };
  const events = Object.fromEntries(db.prepare(`SELECT kind, COUNT(*) AS n FROM analytics_events WHERE date(created_at) BETWEEN ? AND ? GROUP BY kind`).all(from, to).map(e => [e.kind, e.n]));
  const kpis = {
    mornings: cfgs.length,
    yourMorningBoxAccepted: pct(cfgs.filter(c => c.which === 'primary').length, cfgs.length),
    anotherOptionChosen: pct(cfgs.filter(c => c.which === 'alternative').length, cfgs.length),
    swapRate: pct(cfgs.filter(c => (c.userSwaps || []).length).length, cfgs.length),
    addonRate: pct(cfgs.filter(c => (c.addons || []).length).length, cfgs.length),
    sizeMix: ['light', 'regular', 'large', 'standard'].map(z => ({ size: z, pct: pct(cfgs.filter(c => c.size === z).length, cfgs.length) })).filter(x => x.pct),
    noMatchRate: pct(events.no_match || 0, (events.recommendation_shown || 0) + (events.no_match || 0)),
    funnel: ['visit', 'profile_completed', 'plan_started', 'recommendation_shown', 'summary_viewed', 'checkout_started', 'order_placed'].map(k => ({ step: k, count: events[k] || 0 })),
    /* Retention, B2B, delivery and economics (Master Plan §15). */
    ...retention(from, to),
    businessInquiries: (events.business_inquiry || 0) + supportBusiness,
    repeatBreakfast: pct(multi.filter(l => new Set(l).size < l.length).length, multi.length),
    exceptionRate: pct(sum('exceptions'), all.length),
    peoplePerBusinessOrder: (() => { const b = all.filter(x => x.kind === 'business'); return b.length ? Math.round(b.reduce((t, x) => t + x.boxes, 0) / b.length) : null; })(),
    onTimeByWindow: ['w1', 'w2', 'w3'].map(w => { const m = all.filter(x => x.d.window === w && x.d.stage === 3); return { window: w, onTime: pct(m.filter(x => !x.d.late).length, m.length), delivered: m.length }; }),
    podCompletion: pct(completed, all.filter(x => x.d.stage === 3).length),
    averageOrderValue: avgOf('SELECT AVG(total) AS a FROM orders WHERE id IN (SELECT order_id FROM order_days WHERE date BETWEEN ? AND ?)'),
    averageOrderValueBusiness: avgOf('SELECT AVG(total) AS a FROM business_orders WHERE id IN (SELECT order_id FROM business_days WHERE date BETWEEN ? AND ?)')
  };
  /* Reconciliation (MB-OPS-001 §9): order ↔ bakery ↔ delivery records must match; only mismatches are listed. */
  const reconciliation = [];
  for (const [kind, table] of [['personal', 'order_days'], ['business', 'business_days']]) {
    for (const d of db.prepare(`SELECT d.*, (SELECT COUNT(*) FROM handovers h WHERE h.day_kind = ? AND h.day_id = d.id) AS handovers FROM ${table} d WHERE d.date BETWEEN ? AND ? AND d.date < ?`).all(kind, from, to, new Date().toLocaleDateString('en-CA'))) {
      const ref = `${d.order_id} · ${d.date}`;
      if (d.cancelled) continue;
      if (d.stage === 3 && !d.delivery_point) reconciliation.push({ ref, kind, issue: 'Delivered without a recorded handover point' });
      if (d.stage === 3 && !d.handovers) reconciliation.push({ ref, kind, issue: 'Delivered without a bakery handover record' });
      const remedied = d.refund > 0 || !!db.prepare('SELECT 1 FROM service_recovery WHERE day_kind = ? AND day_id = ?').get(kind, d.id);
      /* Not Fulfilled and refunded is a closed outcome, not a mismatch. */
      if (d.stage < 3 && d.delivery_state !== 'Failed' && !(d.delivery_state === 'Not Fulfilled' && remedied)) reconciliation.push({ ref, kind, issue: 'Past date not marked delivered or failed' });
      if (d.delivery_state === 'Failed' && !d.refund && !db.prepare('SELECT 1 FROM service_recovery WHERE day_kind = ? AND day_id = ?').get(kind, d.id)) reconciliation.push({ ref, kind, issue: 'Failed delivery without a recorded remedy' });
    }
  }
  res.json({
    from, to, days, vatRate: VAT_RATE, partners, routes, finance, completed, kpis, reconciliation,
    totals: { boxes: sum('boxes'), revenue: sum('revenue'), personalRevenue: sum('personalRevenue'), businessRevenue: sum('businessRevenue'), cancelled: sum('cancelled'), refunds: sum('refunds'), credits: sum('credits'),
      delivered: sum('delivered'), onTime: sum('onTime'), late: sum('late'), failed: sum('failed'), exceptions: sum('exceptions'), safety: sum('safety'),
      loved: sum('loved'), notForMe: sum('notForMe'), refundedOrders: sum('refundedOrders'), businessBoxes: sum('businessBoxes'), businessOrders: sum('businessOrders'),
      customers: db.prepare(`SELECT COUNT(DISTINCT o.user_id) AS n FROM order_days d JOIN orders o ON o.id = d.order_id WHERE d.date BETWEEN ? AND ? AND d.cancelled = 0`).get(from, to).n }
  });
});

/* ---------- Exceptions (MB-OPS-001 §8): Safety first; every exception has an Owner, Action and Resolution ---------- */
opsRouter.get('/exceptions', (_req, res) => res.json(db.prepare('SELECT * FROM exceptions ORDER BY resolved, priority, created_at DESC LIMIT 300').all()));
opsRouter.get('/exceptions/kinds', (_req, res) => res.json(EXCEPTION_KINDS));
opsRouter.post('/exceptions', (req, res) => {
  const id = raiseException({ ref: String(req.body.ref || 'manual').slice(0, 60), kind: req.body.kind, note: req.body.note, category: req.body.category,
    owner: plainText(req.body.owner, 60), action: plainText(req.body.action, 200), cause: plainText(req.body.cause, 200), responsibleParty: plainText(req.body.responsibleParty, 60), dedupe: false });
  res.status(201).json({ id });
});
opsRouter.patch('/exceptions/:id', (req, res) => {
  const fields = { owner: 60, action: 200, cause: 200, responsible_party: 60 };
  const body = { owner: req.body.owner, action: req.body.action, cause: req.body.cause, responsible_party: req.body.responsibleParty };
  const set = Object.keys(fields).filter(k => typeof body[k] === 'string');
  if (!set.length) throw bad('nothing_to_update', 'Nothing to update.');
  const r = db.prepare(`UPDATE exceptions SET ${set.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...set.map(k => plainText(body[k], fields[k]) || null), Number(req.params.id));
  if (!r.changes) throw new ApiError(404, 'not_found', 'Exception not found.');
  res.json({ ok: true });
});
opsRouter.post('/exceptions/:id/resolve', (req, res) => {
  const x = db.prepare('SELECT * FROM exceptions WHERE id = ?').get(Number(req.params.id));
  if (!x) throw new ApiError(404, 'not_found', 'Exception not found.');
  const resolution = plainText(req.body.resolution, 500);
  if (!resolution) throw bad('resolution_required', 'Write what was done to resolve it.');
  /* MB-OPS-001 §8: every exception is closed with an Owner, an Action and a Resolution. */
  const owner = plainText(req.body.owner, 60) || x.owner, action = plainText(req.body.action, 200) || x.action;
  if (!owner) throw bad('owner_required', 'Assign an owner before resolving.');
  if (!action) throw bad('action_required', 'Record the action taken before resolving.');
  db.prepare("UPDATE exceptions SET resolved = 1, resolved_at = datetime('now'), resolution = ?, owner = ?, action = ? WHERE id = ?").run(resolution, owner, action, x.id);
  res.json({ ok: true });
});

/* ---------- Feedback: Loved it / Not for me (MB-PRD-001 §12) ---------- */
opsRouter.get('/feedback', (_req, res) => {
  const rows = db.prepare(`SELECT d.order_id, d.date, d.cfg, d.feedback, d.feedback_reasons, d.feedback_at, u.first_name
    FROM order_days d JOIN orders o ON o.id = d.order_id JOIN users u ON u.id = o.user_id
    WHERE d.feedback IS NOT NULL ORDER BY d.feedback_at DESC LIMIT 200`).all();
  res.json({
    items: rows.map(r => ({ orderId: r.order_id, date: r.date, box: boxName(parse(r.cfg)), value: r.feedback, reasons: parse(r.feedback_reasons) || [], at: r.feedback_at, customer: r.first_name }))
  });
});

/* ---------- Customer support ---------- */
opsRouter.get('/support', (_req, res) => {
  res.json(db.prepare(`SELECT s.*, u.first_name, u.mobile FROM support_requests s JOIN users u ON u.id = s.user_id ORDER BY s.status = 'open' DESC, s.id DESC LIMIT 200`).all()
    .map(x => ({ id: x.id, customer: x.first_name, mobile: x.mobile, topic: x.topic, orderRef: x.order_ref, message: x.message, status: x.status, reply: x.reply, createdAt: x.created_at })));
});
opsRouter.post('/support/:id/reply', (req, res) => {
  const reply = String(req.body.reply || '').trim().slice(0, 1000);
  if (!reply) throw bad('reply_required', 'Write a reply.');
  const row = db.prepare('SELECT * FROM support_requests WHERE id = ?').get(Number(req.params.id));
  if (!row) throw new ApiError(404, 'not_found', 'Request not found.');
  db.prepare("UPDATE support_requests SET reply = ?, status = 'answered', replied_at = datetime('now') WHERE id = ?").run(reply, row.id);
  notify(row.user_id, `support:${row.id}`, 'support_reply', `Morning Box replied: ${reply}`);
  res.json({ ok: true });
});
opsRouter.post('/support/:id/close', (req, res) => {
  const r = db.prepare("UPDATE support_requests SET status = 'closed' WHERE id = ?").run(Number(req.params.id));
  if (!r.changes) throw new ApiError(404, 'not_found', 'Request not found.');
  res.json({ ok: true });
});

/* ---------- Closed days ---------- */
opsRouter.get('/closed-dates', (_req, res) => res.json(db.prepare('SELECT date, reason FROM closed_dates ORDER BY date').all()));
opsRouter.post('/closed-dates', (req, res) => {
  const date = requireDate(req.body.date);
  const reason = String(req.body.reason || 'Closed').trim().slice(0, 60) || 'Closed';
  db.prepare('INSERT INTO closed_dates (date, reason) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET reason = excluded.reason').run(date, reason);
  const booked = db.prepare('SELECT COUNT(*) AS n FROM order_days WHERE date = ? AND cancelled = 0').get(date).n
    + db.prepare('SELECT COUNT(*) AS n FROM business_days WHERE date = ? AND cancelled = 0').get(date).n;
  res.status(201).json({ ok: true, alreadyBooked: booked });
});
opsRouter.delete('/closed-dates/:date', (req, res) => {
  db.prepare('DELETE FROM closed_dates WHERE date = ?').run(requireDate(req.params.date));
  res.json({ ok: true });
});

/* ---------- Demo helper: lets a signed-in customer step their own delivery through the stages ---------- */
export const demoRouter = Router();
demoRouter.post('/advance', requireUser, (req, res) => {
  if (!DEV) throw new ApiError(404, 'not_found', 'Not found.');
  const { kind = 'personal', orderId, date } = req.body;
  const row = kind === 'business'
    ? db.prepare(`SELECT d.id, d.stage FROM business_days d JOIN business_orders o ON o.id = d.order_id WHERE o.id = ? AND o.user_id = ? AND d.date = ?`).get(orderId, req.userId, date)
    : db.prepare(`SELECT d.id, d.stage, d.bakery_id FROM order_days d JOIN orders o ON o.id = d.order_id WHERE o.id = ? AND o.user_id = ? AND d.date = ?`).get(orderId, req.userId, date);
  if (!row) throw new ApiError(404, 'not_found', 'Not found.');
  if (kind !== 'business' && !row.bakery_id) {
    const b = activeBakeries()[0];
    db.prepare('UPDATE order_days SET bakery_id = ? WHERE id = ?').run(b.id, row.id);
  }
  demoStep(kind, row.id);
  res.json({ ok: true });
});
