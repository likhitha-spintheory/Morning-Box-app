import { Router } from 'express';
import { db, json, parse, tx } from './db.js';
import { requireUser, userPayload } from './auth.js';
import * as rules from './rules.js';
import { notify } from './notify.js';
import { newOrderId } from './personal.js';
import { startCheckout, registerCheckoutHandler, recordPayment, queueRefund, demoRef } from './payments.js';
import { sendBusinessOrderEmail } from './mail.js';
import { SUPPLIER, VAT_RATE } from './company.js';
import { DELIVERY_WINDOWS } from '../src/domain/standards.js';
import { recipeById, describe } from '../src/domain/recipes.js';

import { assertAllocatable, businessUnits, reallocateProvisional, isFinal } from './allocation.js';
import { dubaiTodayIso, PRICING } from '../src/domain/standards.js';
const { raiseException } = rules;
const { ApiError, bad, assertOrderable, assertEditable, assertCapacity, buildBusinessDay, validateBusinessDelivery, emailOk, plain, isIsoDate } = rules;
const idemKey = v => (typeof v === 'string' && /^[\w-]{8,64}$/.test(v) ? v : null);

/* Supplier details printed on the tax invoice (UAE FTA): see server/company.js. */

export const businessRouter = Router();
businessRouter.use(requireUser);

/* Saved plans (MB-FLW-001 §18): a deliberate, named template — never a subscription. */
db.exec(`CREATE TABLE IF NOT EXISTS business_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  plan TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const windowOk = w => DELIVERY_WINDOWS.some(x => x.id === w);
/** Columns added by later migrations are read defensively. */
const dayColumns = () => db.prepare("PRAGMA table_info('business_days')").all().map(c => c.name);
const bakeryName = id => db.prepare('SELECT name FROM bakeries WHERE id = ?').get(id)?.name;

/* MB-FLW-001 §16: First Name, Mobile + OTP (session), Company Name, Business Email. */
businessRouter.post('/account', (req, res) => {
  const { company, email } = req.body;
  if (!plain(company, 120)) throw bad('company_required', 'Enter the company name.');
  if (!emailOk(email)) throw bad('email_invalid', 'Enter a valid business email.');
  db.prepare(`INSERT INTO business_accounts (user_id, company, email) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET company = excluded.company, email = excluded.email`).run(req.userId, plain(company, 120), email.trim());
  res.json(userPayload(req.userId));
});

function bakeriesOf(allocation) {
  const parts = parse(allocation);
  return Array.isArray(parts) ? [...new Set(parts.map(p => bakeryName(p.bakeryId)).filter(Boolean))] : [];
}

function serialize(o) {
  const days = db.prepare('SELECT * FROM business_days WHERE order_id = ? ORDER BY date').all(o.id);
  const contact = parse(days[0]?.delivery) || {};
  return {
    id: o.id, createdAt: o.created_at, company: o.company, email: o.email,
    contact: { name: contact.contact, mobile: contact.mobile }, invoice: parse(o.invoice), mode: parse(o.invoice)?.mode || 'mix',
    total: days.filter(d => !d.cancelled).reduce((t, d) => t + d.total, 0), paid: o.total,
    days: days.map(d => ({
      date: d.date, people: d.people, lines: parse(d.lines), specials: parse(d.specials), window: d.window,
      delivery: parse(d.delivery), cancelled: !!d.cancelled, total: d.total, gross: d.gross, discount: d.discount,
      refund: d.cancelled ? (d.refund || d.total) : (d.refund || 0),
      problem: ['Failed', 'Not Fulfilled'].includes(d.delivery_state) && d.stage < 3 ? d.delivery_state : null,
      stage: d.cancelled ? -1 : d.stage,
      bakeries: isFinal(d.date) ? bakeriesOf(d.allocation) : [],
      deliveredAt: d.delivered_at ?? null, deliveryPoint: d.delivery_point ?? null, recipientType: d.recipient_type ?? null,
      lateNote: !d.cancelled && d.stage < 3 ? d.late_note || null : null,
      editable: !d.cancelled && d.stage === 0 && rules.isEditable(d.date)
    }))
  };
}
function own(userId, id) {
  const o = db.prepare('SELECT * FROM business_orders WHERE id = ? AND user_id = ?').get(id, userId);
  if (!o) throw new ApiError(404, 'not_found', 'Order not found.');
  return o;
}
function ownDay(o, date) {
  const d = db.prepare('SELECT * FROM business_days WHERE order_id = ? AND date = ?').get(o.id, date);
  if (!d) throw new ApiError(404, 'not_found', 'That date is not part of this order.');
  return d;
}

businessRouter.get('/orders', (req, res) => {
  res.json(db.prepare('SELECT * FROM business_orders WHERE user_id = ? ORDER BY created_at DESC').all(req.userId).map(serialize));
});
businessRouter.get('/orders/:id', (req, res) => res.json(serialize(own(req.userId, req.params.id))));

/** Quote without saving — same pricing as the order endpoint. */
businessRouter.post('/quote', (req, res) => {
  const input = Array.isArray(req.body.days) ? req.body.days : [];
  if (!input.length || input.length > 28) throw bad('days_invalid', 'Quote between 1 and 28 days.');
  const days = input.map(d => {
    if (d?.date !== undefined && !isIsoDate(d.date)) throw bad('date_invalid', 'Invalid date.');
    return { date: d.date, ...buildBusinessDay(d) };
  });
  res.json({ days, total: days.reduce((t, d) => t + d.total, 0) });
});

/** Union of Special Breakfast requirements for one day (bakery eligibility, MB-BKY-001). */
const needsOf = specials => ({
  dietary: [...new Set(specials.flatMap(s => s.dietary || []))],
  allergies: [...new Set(specials.flatMap(s => s.allergies || []))]
});

/** Validates and prices a business order without saving anything. */
function prepareBusinessOrder(userId, body) {
  const acct = db.prepare('SELECT * FROM business_accounts WHERE user_id = ?').get(userId);
  if (!acct) throw bad('account_required', 'Add your company details first.');
  const days = Array.isArray(body.days) ? body.days : [];
  if (!days.length || days.length > 28) throw bad('days_invalid', 'Choose at least one date.');
  if (new Set(days.map(d => d?.date)).size !== days.length) throw bad('days_invalid', 'Each date can only appear once.');
  const built = days.map(d => {
    assertOrderable(d.date);
    if (!windowOk(d.window)) throw bad('window_invalid', 'Choose a delivery window.');
    return { date: d.date, window: d.window, delivery: validateBusinessDelivery(d.delivery), ...buildBusinessDay(d) };
  });
  const inv = body.invoice || {};
  const trn = String(inv.trn || '').replace(/\D/g, '');
  if (trn && trn.length !== 15) throw bad('trn_invalid', 'A UAE TRN has 15 digits. Check it or leave it empty.');
  const invoice = {
    wanted: inv.wanted !== false, billingName: plain(inv.billingName, 120) || acct.company,
    address: plain(inv.address, 200), trn, po: plain(inv.po, 40), mode: body.mode === 'choose' ? 'choose' : 'mix'
  };
  const total = built.reduce((t, b) => t + b.total, 0);
  if (body.expectedTotal !== undefined && Number(body.expectedTotal) !== total) {
    throw new ApiError(409, 'price_changed', `Your total is now AED ${total}. Please check it and pay again.`, { total });
  }
  const capacity = () => {
    built.forEach(b => assertCapacity(b.date, b.window, b.people));
    built.forEach(b => assertAllocatable(b.date, [{ kind: 'business', window: b.window, area: b.delivery.area, boxes: b.people, units: businessUnits(b.lines, b.specials) }]));
  };
  return { acct, built, invoice, total, capacity };
}

/** Saves a paid business order (`payment`: { provider, ref, amount }). */
function createBusinessOrder(userId, body, payment, key = null) {
  const { acct, built, invoice, total, capacity } = prepareBusinessOrder(userId, body);
  if (Math.abs(total - payment.amount) > 0.001) throw new ApiError(409, 'price_changed', 'The price changed while you were paying. Your payment is being refunded — please order again.');
  const id = newOrderId('MB-B', 'business_orders');
  const order = tx(() => {
    capacity();
    db.prepare('INSERT INTO business_orders (id, user_id, company, email, invoice, payment_ref, total, idempotency_key, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, acct.company, acct.email, json(invoice), payment.ref || demoRef(), total, key, payment.provider === 'stripe' ? 'captured' : 'captured_demo');
    recordPayment('business', id, payment);
    const ins = db.prepare(`INSERT INTO business_days (order_id, date, window, people, lines, specials, delivery, gross, discount, total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    built.forEach(b => ins.run(id, b.date, b.window, b.people, json(b.lines), json(b.specials), json(b.delivery), b.gross, b.discount, b.total));
    return db.prepare('SELECT * FROM business_orders WHERE id = ?').get(id);
  });
  reallocateProvisional(built.map(b => b.date));
  notify(userId, id, 'confirmed', `Business order ${id} is confirmed: ${built.length} day${built.length > 1 ? 's' : ''}, AED ${total}.`);
  sendBusinessOrderEmail(order);
  return id;
}
registerCheckoutHandler('business_order', (userId, p, payment) => createBusinessOrder(userId, p.body, payment, p.key));

/** MVP business orders are prepaid (MB-B2B-001 §8). Capacity is validated before payment (MB-DLV-001 §8)
    and again when the paid order is saved. 201 with the order (demo mode), or 202 { checkout } to pay first. */
businessRouter.post('/orders', (req, res, next) => {
  const key = idemKey(req.body.idempotencyKey);
  if (key) {
    const existing = db.prepare('SELECT * FROM business_orders WHERE user_id = ? AND idempotency_key = ?').get(req.userId, key);
    if (existing) return res.status(200).json(serialize(existing));
  }
  const { acct, built, total, capacity } = prepareBusinessOrder(req.userId, req.body);
  capacity();
  startCheckout(req, {
    kind: 'business_order', payload: { body: { ...req.body, idempotencyKey: undefined }, key }, amount: total, idempotencyKey: key,
    email: acct.email, description: `Morning Box Business Breakfast · ${acct.company} · ${built.length} day${built.length > 1 ? 's' : ''}`
  }).then(r => (r.checkout
    ? res.status(202).json({ checkout: r.checkout })
    : res.status(201).json(serialize(db.prepare('SELECT * FROM business_orders WHERE id = ?').get(r.done))))).catch(next);
});

/** Edit headcount, boxes, sizes, Special Breakfasts, window and delivery until cutoff.
    Total Boxes must equal Total People (MB-B2B-001 §10). A higher total is paid first:
    without `payment` such an edit changes nothing and returns { due }. A lower total is refunded to the card. */
function editBusinessDay(userId, orderId, date, body, payment = null) {
  const o = own(userId, orderId);
  const d = ownDay(o, date);
  if (d.cancelled) throw bad('cancelled', 'This day was cancelled.');
  /* A refunded day is settled: changing it could pay back twice. */
  if ((d.refund || 0) > 0 || d.delivery_state === 'Not Fulfilled') throw bad('refunded', 'This day has already been refunded, so it can’t be changed. Contact us if you need help.');
  assertEditable(d.date, d.stage);
  const window = body.window ?? d.window;
  if (!windowOk(window)) throw bad('window_invalid', 'Choose a delivery window.');
  const delivery = body.delivery ? validateBusinessDelivery({ ...parse(d.delivery), ...body.delivery }) : parse(d.delivery);
  const b = buildBusinessDay({
    people: body.people ?? d.people,
    lines: body.lines ?? parse(d.lines),
    specials: body.specials ?? parse(d.specials)
  });
  const diff = Math.round((b.total - d.total) * 100) / 100;
  if (diff > 0 && !payment) return { due: diff, label: `Morning Box Business Breakfast · change to ${rules.prettyDate(d.date)}` };
  if (diff > 0 && Math.abs(payment.amount - diff) > 0.001) throw new ApiError(409, 'price_changed', 'The price of this change moved while you were paying. Your payment is being refunded — please try again.');
  tx(() => {
    if (window !== d.window || b.people > d.people) assertCapacity(d.date, window, b.people, { excludeBusinessDay: d.id });
    /* Any change of boxes or Special Breakfasts must still be allocatable (DLV §8). */
    assertAllocatable(d.date, [{ kind: 'business', window, area: delivery.area, boxes: b.people, units: businessUnits(b.lines, b.specials) }], { exclude: [`business:${d.id}`] });
    db.prepare('UPDATE business_days SET window = ?, delivery = ?, people = ?, lines = ?, specials = ?, gross = ?, discount = ?, total = ? WHERE id = ?')
      .run(window, json(delivery), b.people, json(b.lines), json(b.specials), b.gross, b.discount, b.total, d.id);
    /* Business Breakfast is prepaid: an edit that changes the total is settled — paid before this point, or refunded. */
    if (diff !== 0) db.prepare('INSERT INTO business_payment_adjustments (business_day_id, amount) VALUES (?, ?)').run(d.id, diff);
    if (diff > 0) recordPayment('business', o.id, payment);
    if (diff < 0) queueRefund('business', o.id, -diff, `change to ${d.date}`);
  });
  reallocateProvisional([d.date]);
  if (diff !== 0) {
    notify(userId, `${o.id}:${d.date}`, diff > 0 ? 'changed' : 'refund',
      `Business breakfast on ${rules.prettyDate(d.date)} updated. AED ${Math.abs(diff)} ${diff > 0 ? 'was charged' : 'will be refunded to your original payment method'}.`);
  }
  return { order: o };
}
registerCheckoutHandler('business_change', (userId, p, payment) => { editBusinessDay(userId, p.orderId, p.date, p.body, payment); return p.orderId; });

/** Response: the order, or 202 { checkout } when the change costs more and must be paid first. */
businessRouter.patch('/orders/:id/days/:date', (req, res, next) => {
  const r = editBusinessDay(req.userId, req.params.id, req.params.date, req.body);
  if (r.order) return res.json(serialize(r.order));
  const p = { orderId: req.params.id, date: req.params.date, body: req.body };
  startCheckout(req, { kind: 'business_change', payload: p, amount: r.due, description: r.label,
    email: db.prepare('SELECT email FROM business_accounts WHERE user_id = ?').get(req.userId)?.email })
    .then(x => (x.checkout ? res.status(202).json({ checkout: x.checkout }) : res.json(serialize(own(req.userId, req.params.id))))).catch(next);
});

/** Report a problem with a business delivery (MB-OPS-001 §10) — same categories as personal orders. */
const BUSINESS_ISSUES = { 'Not delivered': 'Delivery Failed', 'Arrived late': 'Delivery Delay', 'Wrong or missing items': 'Order Accuracy', 'Allergy concern': 'Safety Incident', 'Quality issue': 'QC Failure', 'Packaging issue': 'Packaging Issue', 'Something else': 'Customer Issue' };
businessRouter.post('/orders/:id/days/:date/issue', (req, res) => {
  const o = own(req.userId, req.params.id);
  const d = ownDay(o, req.params.date);
  const kind = BUSINESS_ISSUES[req.body.reason];
  if (!kind) throw bad('issue_invalid', 'Choose what went wrong.');
  if (d.cancelled) throw bad('cancelled', 'This day was cancelled.');
  if (d.date > dubaiTodayIso() && d.stage < 2) throw bad('issue_too_early', 'You can report a problem on the morning of delivery.');
  /* Same limits as personal reports: 5 per delivery day, 20 per account per day (keeps the ops queue usable). */
  if (db.prepare('SELECT COUNT(*) AS n FROM customer_issues WHERE order_id = ? AND date = ?').get(o.id, d.date).n >= 5) {
    throw new ApiError(429, 'issue_limit', 'We already have your reports for this day. Our team will contact you — or message Support.');
  }
  if (db.prepare("SELECT COUNT(*) AS n FROM customer_issues WHERE user_id = ? AND created_at > datetime('now', '-1 day')").get(req.userId).n >= 20) {
    throw new ApiError(429, 'issue_limit', 'Too many reports today. Please message Support.');
  }
  const note = plain(req.body.note, 500);
  const photo = rules.cleanPhoto(req.body.photo);
  const names = (parse(d.allocation) || []).map(p => db.prepare('SELECT name FROM bakeries WHERE id = ?').get(p.bakeryId)?.name).filter(Boolean).join(' + ');
  const exceptionId = raiseException({ ref: `business:${d.id}`, kind, note: `${req.body.reason}${note ? `: ${note}` : ''} (${o.company})`, customerCategory: 'business', dedupe: false,
    owner: 'Operations', responsibleParty: names || null, action: 'Contact the business contact; decide the remedy' });
  db.prepare('INSERT INTO customer_issues (user_id, order_id, date, reason, note, exception_id, photo) VALUES (?, ?, ?, ?, ?, ?, ?)').run(req.userId, o.id, d.date, req.body.reason, note || null, exceptionId, photo);
  notify(req.userId, `${o.id}:${d.date}`, 'issue_update', 'Thanks for telling us. Our team has your report and will contact you shortly.');
  res.json(serialize(o));
});

/** Cancel one day: allowed only before its cutoff and before production starts; full refund for that day.
    Throws (via assertEditable) when the day can no longer be cancelled. */
function cancelDay(userId, o, d) {
  if (d.cancelled) return null;
  assertEditable(d.date, d.stage);
  /* Only what has not been refunded already is paid back (e.g. after a pro-rata refund), to the card. */
  const due = Math.max(0, Math.round((d.total - (d.refund || 0)) * 100) / 100);
  tx(() => {
    db.prepare('UPDATE business_days SET cancelled = 1, refund = ? WHERE id = ?').run((d.refund || 0) + due, d.id);
    queueRefund('business', o.id, due, `cancelled ${d.date}`);
  });
  notify(userId, `${o.id}:${d.date}`, 'refund', `Business breakfast on ${rules.prettyDate(d.date)} is cancelled. ${due > 0 ? `AED ${due} will be refunded.` : 'It was already refunded.'}`);
  return due;
}

/** Cancel one day before cutoff → full refund for that day; other days unaffected. */
businessRouter.post('/orders/:id/days/:date/cancel', (req, res) => {
  const o = own(req.userId, req.params.id);
  cancelDay(req.userId, o, ownDay(o, req.params.date));
  res.json(serialize(o));
});

/** Cancel Order (MB-B2B-001 §10): every day still before its cutoff and not started is cancelled and
    refunded in full; days past cutoff, in progress or delivered stay as they are and are reported back. */
businessRouter.post('/orders/:id/cancel', (req, res) => {
  const o = own(req.userId, req.params.id);
  const days = db.prepare('SELECT * FROM business_days WHERE order_id = ? ORDER BY date').all(o.id);
  const cancelled = [];
  const notCancelled = [];
  let refund = 0;
  tx(() => days.forEach(d => {
    if (d.cancelled) return;
    try {
      const due = cancelDay(req.userId, o, d);
      if (due !== null) { cancelled.push(d.date); refund += due; }
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      notCancelled.push({ date: d.date, reason: e.message });
    }
  }));
  if (cancelled.length) reallocateProvisional(cancelled);
  res.json({ cancelled, notCancelled, refund, order: serialize(o) });
});

/** Company / tax invoice (HTML; PDF rendering is a later step).
    Prices are VAT-inclusive; the VAT amount is shown separately (UAE FTA).
    It is titled "Tax Invoice" only once the supplier TRN (MB_TRN) is configured. */
businessRouter.get('/orders/:id/invoice', (req, res) => {
  const o = serialize(own(req.userId, req.params.id));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const name = id => { const r = recipeById[id]; return r ? describe(r) : id; };
  const money = n => (Math.round(n * 100) / 100).toFixed(2);
  const vatOf = gross => gross - gross / (1 + VAT_RATE);
  const rows = o.days.map(d => `<tr><td>${esc(d.date)}${d.cancelled ? ` (cancelled — refunded AED ${esc(d.refund)})` : ''}</td><td>${esc(d.people)}</td>
    <td>${d.lines.map(l => `${esc(name(l.recipeId))} · ${esc(l.size)} × ${esc(l.qty)}`).join('<br>')}${d.specials.length ? `<br>Special Breakfasts × ${d.specials.reduce((t, s) => t + s.qty, 0)}` : ''}</td>
    <td style="text-align:right">${d.cancelled ? 0 : esc(d.gross)}</td><td style="text-align:right">${d.cancelled ? 0 : esc(d.discount)}</td><td style="text-align:right">${d.cancelled ? 0 : esc(d.total)}</td></tr>`).join('');
  /* B2B §8: what was paid, then each edit charge, refund and credit, so the invoice matches the money moved. */
  const dayIds = db.prepare('SELECT id, date FROM business_days WHERE order_id = ?').all(o.id);
  const settlement = [{ at: o.createdAt, label: 'Paid at order', amount: o.paid },
    ...dayIds.flatMap(d => db.prepare('SELECT amount, created_at FROM business_payment_adjustments WHERE business_day_id = ?').all(d.id)
      .map(a => ({ at: a.created_at, label: `${a.amount > 0 ? 'Charge' : 'Refund'} for change to ${d.date}`, amount: a.amount }))),
    ...o.days.filter(d => d.cancelled).map(d => ({ at: d.date, label: `Refund — ${d.date} cancelled`, amount: -d.refund })),
    ...dayIds.flatMap(d => db.prepare("SELECT type, amount, reason, created_at FROM service_recovery WHERE day_kind = 'business' AND day_id = ? AND type LIKE '%Refund'").all(d.id)
      .map(r => ({ at: r.created_at, label: `${r.type} — ${d.date}: ${r.reason}`, amount: -r.amount })))];
  const inv = o.invoice || {};
  const isTax = inv.wanted && !!SUPPLIER.trn;
  const vat = vatOf(o.total);
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Invoice ${esc(o.id)}</title>
<style>body{font-family:Inter,Arial,sans-serif;color:#3B2D22;max-width:820px;margin:40px auto;padding:0 20px}h1{font-family:Georgia,serif;font-weight:400}table{width:100%;border-collapse:collapse;font-size:14px}td,th{border-bottom:1px solid #EADCC1;padding:8px;text-align:left;vertical-align:top}</style>
<h1>${esc(SUPPLIER.name)} — ${isTax ? 'Tax Invoice' : inv.wanted ? 'Invoice' : 'Receipt'}</h1>
<p>Invoice ${esc(o.id)} · ${esc(o.createdAt)} UTC</p>
<p><b>Supplier:</b> ${esc(SUPPLIER.name)}<br>${esc(SUPPLIER.address)}${SUPPLIER.trn ? `<br>TRN ${esc(SUPPLIER.trn)}` : ''}</p>
<p><b>Billed to:</b> ${esc(inv.billingName || o.company)}<br>Company: ${esc(o.company)}<br>Email: ${esc(o.email)}${inv.address ? `<br>${esc(inv.address)}` : ''}${inv.trn ? `<br>TRN ${esc(inv.trn)}` : ''}${inv.po ? `<br>PO number: ${esc(inv.po)}` : ''}</p>
<table><tr><th>Date</th><th>People</th><th>Breakfasts</th><th>Gross AED</th><th>Discount AED</th><th>Total AED</th></tr>${rows}</table>
<p style="text-align:right">Total excluding VAT: AED ${money(o.total - vat)}<br>VAT ${Math.round(VAT_RATE * 100)}%: AED ${money(vat)}</p>
<p style="text-align:right;font-size:18px"><b>Total AED ${esc(o.total)}</b></p>
${settlement.length ? `<h3>Payments &amp; adjustments</h3><table><tr><th>Date</th><th>Item</th><th style="text-align:right">AED</th></tr>${settlement.map(x => `<tr><td>${esc(x.at)}</td><td>${esc(x.label)}</td><td style="text-align:right">${money(x.amount)}</td></tr>`).join('')}</table><p style="text-align:right"><b>Net paid AED ${money(settlement.reduce((t, x) => t + x.amount, 0))}</b></p>` : ''}
<p style="font-size:12px">Prices include VAT.${PRICING.indicative ? ' Prices indicative pending final costing.' : ''} Delivery included.</p>`);
});

/* ---------- Saved plans ---------- */
const SIZES = ['light', 'regular', 'large'];
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);

/** Validate a plan template exactly like an order day; dates are never stored. */
function cleanPlan(p) {
  if (!p || typeof p !== 'object') throw bad('plan_invalid', 'Nothing to save.');
  const input = Array.isArray(p.specials) ? p.specials : [];
  const day = buildBusinessDay({ people: p.people, lines: p.lines, specials: input });
  const dl = p.delivery || {};
  return {
    people: day.people, mode: p.mode === 'choose' ? 'choose' : 'mix', lines: day.lines,
    specials: day.specials.map(s => ({ dietary: s.dietary, allergies: s.allergies, qty: s.qty, size: SIZES.includes(s.size) ? s.size : 'regular' })),
    delivery: {
      ...Object.fromEntries(['company', 'building', 'office', 'contact', 'mobile', 'notes'].map(k => [k, text(dl[k])])),
      window: windowOk(dl.window) ? dl.window : 'w1'
    }
  };
}
const planOut = r => ({ id: r.id, name: r.name, createdAt: r.created_at, plan: parse(r.plan) });

businessRouter.get('/plans', (req, res) => {
  res.json(db.prepare('SELECT * FROM business_plans WHERE user_id = ? ORDER BY id DESC').all(req.userId).map(planOut));
});
businessRouter.post('/plans', (req, res) => {
  const name = text(req.body.name, 60);
  if (!name) throw bad('name_required', 'Give the plan a name.');
  const plan = cleanPlan(req.body.plan);
  if (db.prepare('SELECT COUNT(*) AS n FROM business_plans WHERE user_id = ?').get(req.userId).n >= 20) throw bad('plans_full', 'You can keep up to 20 saved plans. Remove one first.');
  const r = db.prepare('INSERT INTO business_plans (user_id, name, plan) VALUES (?, ?, ?)').run(req.userId, name, json(plan));
  res.status(201).json(planOut(db.prepare('SELECT * FROM business_plans WHERE id = ?').get(r.lastInsertRowid)));
});
businessRouter.delete('/plans/:id', (req, res) => {
  const r = db.prepare('DELETE FROM business_plans WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.userId);
  if (!r.changes) throw new ApiError(404, 'not_found', 'Plan not found.');
  res.json({ ok: true });
});
