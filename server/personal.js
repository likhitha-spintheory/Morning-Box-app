import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db, json, parse, tx } from './db.js';
import { requireUser, userPayload } from './auth.js';
import {
  ApiError, bad, validateProfile, assertOrderable, assertEditable, assertCapacity, availability,
  buildPersonalDay, validateAddress
} from './rules.js';
import { recommend } from '../src/domain/engine.js';

export const personalRouter = Router();

const newOrderId = prefix => `${prefix}-${randomBytes(3).toString('hex').toUpperCase()}`;

function loadProfile(userId) {
  const p = userPayload(userId).profile;
  if (!p) throw bad('profile_missing', 'Complete your Morning Profile first.');
  return p;
}

/* ---------- Public: availability & recommendation preview ---------- */
personalRouter.get('/availability', (req, res) => {
  const dates = String(req.query.dates || '').split(',').filter(Boolean).slice(0, 28);
  res.json(Object.fromEntries(dates.map(d => [d, availability(d)])));
});

/** Deterministic preview. The order endpoint re-runs the same engine. */
personalRouter.post('/recommendations', (req, res) => {
  const profile = validateProfile(req.body.profile);
  const r = recommend(profile, req.body.context);
  const out = c => c && { recipeId: c.recipe.id, components: c.components, substitutions: c.substitutions };
  res.json({ none: !r.primary, primary: out(r.primary), alternative: out(r.alternative), message: r.message || null });
});

/* ---------- Me ---------- */
personalRouter.get('/me', requireUser, (req, res) => res.json(userPayload(req.userId)));

personalRouter.put('/me/profile', requireUser, (req, res) => {
  const p = validateProfile(req.body);
  db.prepare(`INSERT INTO profiles (user_id, eating_style, preferences, dietary, allergies) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET eating_style = excluded.eating_style, preferences = excluded.preferences,
    dietary = excluded.dietary, allergies = excluded.allergies, updated_at = datetime('now')`)
    .run(req.userId, p.eatingStyle, json(p.preferences), json(p.dietary), json(p.allergies));
  res.json(userPayload(req.userId));
});

personalRouter.put('/me/settings', requireUser, (req, res) => {
  const { coffeeReminder, email, firstName } = req.body;
  if (typeof coffeeReminder === 'boolean') {
    db.prepare(`INSERT INTO profiles (user_id, coffee_reminder) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET coffee_reminder = excluded.coffee_reminder`)
      .run(req.userId, coffeeReminder ? 1 : 0);
  }
  if (typeof email === 'string') {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('email_invalid', 'Enter a valid email.');
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email || null, req.userId);
  }
  if (typeof firstName === 'string' && firstName.trim()) db.prepare('UPDATE users SET first_name = ? WHERE id = ?').run(firstName.trim().slice(0, 60), req.userId);
  res.json(userPayload(req.userId));
});

/* ---------- Orders (MB-FLW-001 §9, MB-DLV-001) ---------- */
function bakeryName(id) {
  return id ? db.prepare('SELECT name FROM bakeries WHERE id = ?').get(id)?.name || null : null;
}
export function serializeOrder(o) {
  const days = db.prepare('SELECT * FROM order_days WHERE order_id = ? ORDER BY date').all(o.id);
  return {
    id: o.id, createdAt: o.created_at, email: o.email || '', method: o.payment_method,
    total: days.filter(d => !d.cancelled).reduce((t, d) => t + d.price, 0),
    paid: o.total,
    days: days.map(d => ({
      date: d.date, window: d.window, cfg: parse(d.cfg), price: d.price, address: parse(d.address),
      cancelled: !!d.cancelled, refund: d.refund, feedback: d.feedback, stage: d.cancelled ? -1 : d.stage,
      bakery: d.stage >= 1 ? bakeryName(d.bakery_id) : null, deliveredAt: d.delivered_at, deliveryPoint: d.delivery_point
    }))
  };
}
function ownOrder(userId, id) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(id, userId);
  if (!o) throw new ApiError(404, 'not_found', 'Order not found.');
  return o;
}
function ownDay(order, date) {
  const d = db.prepare('SELECT * FROM order_days WHERE order_id = ? AND date = ?').get(order.id, date);
  if (!d) throw new ApiError(404, 'not_found', 'That morning is not part of this order.');
  return d;
}

personalRouter.get('/orders', requireUser, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.userId);
  res.json(orders.map(serializeOrder));
});

personalRouter.get('/orders/:id', requireUser, (req, res) => res.json(serializeOrder(ownOrder(req.userId, req.params.id))));

/**
 * Create an order. Body:
 * { days: [{ date, context, recipeId, components, size, addons, window }], address, email, method }
 * Every day is re-validated (cutoff, eligibility, swaps, add-ons, capacity) and re-priced.
 */
personalRouter.post('/orders', requireUser, (req, res) => {
  const profile = loadProfile(req.userId);
  const days = Array.isArray(req.body.days) ? req.body.days : [];
  if (!days.length || days.length > 28) throw bad('days_invalid', 'Plan at least one morning.');
  if (new Set(days.map(d => d.date)).size !== days.length) throw bad('days_invalid', 'Each morning can only appear once.');
  const address = validateAddress(req.body.address);
  const method = ['card', 'apple'].includes(req.body.method) ? req.body.method : 'card';
  const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';

  const built = days.map(d => {
    assertOrderable(d.date);
    const b = buildPersonalDay(d, profile);
    const dayAddress = d.address ? validateAddress(d.address) : address;
    return { ...b, date: d.date, window: d.window, address: dayAddress };
  });
  const id = newOrderId('MB');
  const order = tx(() => {
    built.forEach(b => assertCapacity(b.date, b.window, 1));
    const total = built.reduce((t, b) => t + b.price, 0);
    // Payment gateway integration point: authorise `total` before persisting.
    const paymentRef = `demo_${randomBytes(6).toString('hex')}`;
    db.prepare('INSERT INTO orders (id, user_id, email, payment_method, payment_ref, total) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, req.userId, email || null, method, paymentRef, total);
    const ins = db.prepare('INSERT INTO order_days (order_id, date, window, context, cfg, trace, price, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    built.forEach(b => ins.run(id, b.date, b.window, b.cfg.context, json(b.cfg), json(b.trace), b.price, json(b.address)));
    db.prepare(`INSERT INTO addresses (user_id, building, unit, area, handover, notes, default_window) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET building = excluded.building, unit = excluded.unit, area = excluded.area,
      handover = excluded.handover, notes = excluded.notes, default_window = excluded.default_window`)
      .run(req.userId, address.building, address.unit, address.area, address.handover, address.notes, built[0].window);
    if (email) db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, req.userId);
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  });
  res.status(201).json(serializeOrder(order));
});

/** Edit one morning before its cutoff: context, size, add-ons, window. */
personalRouter.patch('/orders/:id/days/:date', requireUser, (req, res) => {
  const order = ownOrder(req.userId, req.params.id);
  const day = ownDay(order, req.params.date);
  if (day.cancelled) throw bad('cancelled', 'This morning was cancelled.');
  assertEditable(day.date, day.stage);
  const profile = loadProfile(req.userId);
  const current = parse(day.cfg);
  const input = {
    context: req.body.context ?? current.context,
    recipeId: req.body.recipeId ?? current.recipeId,
    components: req.body.components ?? current.components,
    size: req.body.size ?? current.size,
    addons: req.body.addons ?? current.addons
  };
  const b = buildPersonalDay(input, profile);
  const window = req.body.window ?? day.window;
  tx(() => {
    if (window !== day.window) assertCapacity(day.date, window, 1, { excludeOrderDay: day.id });
    db.prepare('UPDATE order_days SET cfg = ?, trace = ?, price = ?, context = ?, window = ? WHERE id = ?')
      .run(json(b.cfg), json(b.trace), b.price, b.cfg.context, window, day.id);
  });
  res.json(serializeOrder(order));
});

/** Cancel before cutoff → full refund for that morning; other mornings unaffected (MB-DLV-001 §11). */
personalRouter.post('/orders/:id/days/:date/cancel', requireUser, (req, res) => {
  const order = ownOrder(req.userId, req.params.id);
  const day = ownDay(order, req.params.date);
  if (!day.cancelled) {
    assertEditable(day.date, day.stage);
    // Payment gateway integration point: refund `day.price` against order.payment_ref.
    db.prepare('UPDATE order_days SET cancelled = 1, refund = price WHERE id = ?').run(day.id);
  }
  res.json(serializeOrder(order));
});

/** Loved it / Not for me — collected as a learning signal only (MB-REC-001 §14). */
personalRouter.post('/orders/:id/days/:date/feedback', requireUser, (req, res) => {
  const order = ownOrder(req.userId, req.params.id);
  const day = ownDay(order, req.params.date);
  if (!['Loved it', 'Not for me'].includes(req.body.value)) throw bad('feedback_invalid', 'Choose Loved it or Not for me.');
  if (day.stage < 3) throw bad('not_delivered', 'Feedback opens after delivery.');
  db.prepare('UPDATE order_days SET feedback = ? WHERE id = ?').run(req.body.value, day.id);
  res.json(serializeOrder(order));
});
