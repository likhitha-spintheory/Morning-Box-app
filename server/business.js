import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db, json, parse, tx } from './db.js';
import { requireUser, userPayload } from './auth.js';
import * as rules from './rules.js';
import { DELIVERY_WINDOWS } from '../src/domain/standards.js';
import { recipeById, describe } from '../src/domain/recipes.js';

const { ApiError, bad, assertOrderable, assertEditable, assertCapacity, buildBusinessDay, validateBusinessDelivery } = rules;

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

const emailOk = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const windowOk = w => DELIVERY_WINDOWS.some(x => x.id === w);
/** Columns added by later migrations are read defensively. */
const dayColumns = () => db.prepare("PRAGMA table_info('business_days')").all().map(c => c.name);
const bakeryName = id => db.prepare('SELECT name FROM bakeries WHERE id = ?').get(id)?.name;

/* MB-FLW-001 §16: First Name, Mobile + OTP (session), Company Name, Business Email. */
businessRouter.post('/account', (req, res) => {
  const { company, email } = req.body;
  if (typeof company !== 'string' || !company.trim()) throw bad('company_required', 'Enter the company name.');
  if (!emailOk(email)) throw bad('email_invalid', 'Enter a valid business email.');
  db.prepare(`INSERT INTO business_accounts (user_id, company, email) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET company = excluded.company, email = excluded.email`).run(req.userId, company.trim(), email.trim());
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
      refund: d.cancelled ? (d.refund || d.total) : 0,
      stage: d.cancelled ? -1 : d.stage,
      bakeries: bakeriesOf(d.allocation),
      deliveredAt: d.delivered_at ?? null, deliveryPoint: d.delivery_point ?? null, recipientType: d.recipient_type ?? null
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
  const days = (req.body.days || []).map(d => ({ date: d.date, ...buildBusinessDay(d) }));
  res.json({ days, total: days.reduce((t, d) => t + d.total, 0) });
});

/** Union of Special Breakfast requirements for one day (bakery eligibility, MB-BKY-001). */
const needsOf = specials => ({
  dietary: [...new Set(specials.flatMap(s => s.dietary || []))],
  allergies: [...new Set(specials.flatMap(s => s.allergies || []))]
});

/** MVP business orders are prepaid (MB-B2B-001 §8). Capacity is validated before payment (MB-DLV-001 §8). */
businessRouter.post('/orders', (req, res) => {
  const acct = db.prepare('SELECT * FROM business_accounts WHERE user_id = ?').get(req.userId);
  if (!acct) throw bad('account_required', 'Add your company details first.');
  const days = Array.isArray(req.body.days) ? req.body.days : [];
  if (!days.length || days.length > 28) throw bad('days_invalid', 'Choose at least one date.');
  if (new Set(days.map(d => d.date)).size !== days.length) throw bad('days_invalid', 'Each date can only appear once.');
  const built = days.map(d => {
    assertOrderable(d.date);
    if (!windowOk(d.window)) throw bad('window_invalid', 'Choose a delivery window.');
    return { date: d.date, window: d.window, delivery: validateBusinessDelivery(d.delivery), ...buildBusinessDay(d) };
  });
  const inv = req.body.invoice || {};
  const invoice = {
    wanted: inv.wanted !== false, billingName: String(inv.billingName || acct.company).slice(0, 120),
    address: String(inv.address || '').slice(0, 200), trn: String(inv.trn || '').replace(/\D/g, '').slice(0, 15),
    mode: req.body.mode === 'choose' ? 'choose' : 'mix'
  };
  const id = `MB-B-${randomBytes(3).toString('hex').toUpperCase()}`;
  const order = tx(() => {
    built.forEach(b => assertCapacity(b.date, b.window, b.people));
    if (typeof rules.assertBakeryCapacity === 'function') built.forEach(b => { const n = needsOf(b.specials); rules.assertBakeryCapacity(b.date, b.people, rules.needsFor(n.dietary, n.allergies)); });
    const total = built.reduce((t, b) => t + b.total, 0);
    // Payment gateway integration point: charge `total` before persisting.
    db.prepare('INSERT INTO business_orders (id, user_id, company, email, invoice, payment_ref, total) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, req.userId, acct.company, acct.email, json(invoice), `demo_${randomBytes(6).toString('hex')}`, total);
    const ins = db.prepare(`INSERT INTO business_days (order_id, date, window, people, lines, specials, delivery, gross, discount, total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    built.forEach(b => ins.run(id, b.date, b.window, b.people, json(b.lines), json(b.specials), json(b.delivery), b.gross, b.discount, b.total));
    return db.prepare('SELECT * FROM business_orders WHERE id = ?').get(id);
  });
  res.status(201).json(serialize(order));
});

/** Edit headcount, boxes, sizes, Special Breakfasts, window and delivery until cutoff.
    Total Boxes must equal Total People (MB-B2B-001 §10). */
businessRouter.patch('/orders/:id/days/:date', (req, res) => {
  const o = own(req.userId, req.params.id);
  const d = ownDay(o, req.params.date);
  if (d.cancelled) throw bad('cancelled', 'This day was cancelled.');
  assertEditable(d.date, d.stage);
  const window = req.body.window ?? d.window;
  if (!windowOk(window)) throw bad('window_invalid', 'Choose a delivery window.');
  const delivery = req.body.delivery ? validateBusinessDelivery({ ...parse(d.delivery), ...req.body.delivery }) : parse(d.delivery);
  const b = buildBusinessDay({
    people: req.body.people ?? d.people,
    lines: req.body.lines ?? parse(d.lines),
    specials: req.body.specials ?? parse(d.specials)
  });
  tx(() => {
    if (window !== d.window || b.people > d.people) assertCapacity(d.date, window, b.people, { excludeBusinessDay: d.id });
    db.prepare('UPDATE business_days SET window = ?, delivery = ?, people = ?, lines = ?, specials = ?, gross = ?, discount = ?, total = ? WHERE id = ?')
      .run(window, json(delivery), b.people, json(b.lines), json(b.specials), b.gross, b.discount, b.total, d.id);
  });
  res.json(serialize(o));
});

/** Cancel one day before cutoff → full refund for that day; other days unaffected. */
businessRouter.post('/orders/:id/days/:date/cancel', (req, res) => {
  const o = own(req.userId, req.params.id);
  const d = ownDay(o, req.params.date);
  if (!d.cancelled) {
    assertEditable(d.date, d.stage);
    // Payment gateway integration point: refund `d.total` against the order's payment_ref.
    const sql = dayColumns().includes('refund') ? 'UPDATE business_days SET cancelled = 1, refund = total WHERE id = ?' : 'UPDATE business_days SET cancelled = 1 WHERE id = ?';
    db.prepare(sql).run(d.id);
  }
  res.json(serialize(o));
});

/** Company / tax invoice (HTML; PDF rendering is a later step). */
businessRouter.get('/orders/:id/invoice', (req, res) => {
  const o = serialize(own(req.userId, req.params.id));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const name = id => { const r = recipeById[id]; return r ? describe(r) : id; };
  const rows = o.days.map(d => `<tr><td>${esc(d.date)}${d.cancelled ? ` (cancelled — refunded AED ${d.refund})` : ''}</td><td>${d.people}</td>
    <td>${d.lines.map(l => `${esc(name(l.recipeId))} · ${esc(l.size)} × ${l.qty}`).join('<br>')}${d.specials.length ? `<br>Special Breakfasts × ${d.specials.reduce((t, s) => t + s.qty, 0)}` : ''}</td>
    <td style="text-align:right">${d.cancelled ? 0 : d.gross}</td><td style="text-align:right">${d.cancelled ? 0 : d.discount}</td><td style="text-align:right">${d.cancelled ? 0 : d.total}</td></tr>`).join('');
  const inv = o.invoice || {};
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Invoice ${esc(o.id)}</title>
<style>body{font-family:Inter,Arial,sans-serif;color:#3B2D22;max-width:820px;margin:40px auto;padding:0 20px}h1{font-family:Georgia,serif;font-weight:400}table{width:100%;border-collapse:collapse;font-size:14px}td,th{border-bottom:1px solid #EADCC1;padding:8px;text-align:left;vertical-align:top}</style>
<h1>Morning Box — ${inv.wanted ? 'Tax Invoice' : 'Receipt'}</h1>
<p>Invoice ${esc(o.id)} · ${esc(o.createdAt)}</p>
<p><b>Billed to:</b> ${esc(inv.billingName || o.company)}<br>Company: ${esc(o.company)}<br>Email: ${esc(o.email)}${inv.address ? `<br>${esc(inv.address)}` : ''}${inv.trn ? `<br>TRN ${esc(inv.trn)}` : ''}</p>
<table><tr><th>Date</th><th>People</th><th>Breakfasts</th><th>Gross AED</th><th>Discount AED</th><th>Total AED</th></tr>${rows}</table>
<p style="text-align:right;font-size:18px"><b>Total AED ${o.total}</b></p><p style="font-size:12px">Prices indicative pending final costing. Delivery included.</p>`);
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
    specials: day.specials.map((s, i) => ({
      dietary: s.dietary, allergies: s.allergies, qty: s.qty,
      size: SIZES.includes(s.size) ? s.size : SIZES.includes(input[i]?.size) ? input[i].size : 'regular'
    })),
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
