import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db, json, parse, tx, logEvent } from './db.js';
import { SUPPLIER, VAT_RATE, SUPPORT, TERMS_VERSION } from './company.js';
import { requireUser, userPayload, cleanName, SESSION_COOKIE } from './auth.js';
import {
  ApiError, bad, validateProfile, assertOrderable, assertEditable, assertCapacity, availability,
  buildPersonalDay, validateAddress, unsafeComponents, inHorizon, emailOk, plain, raiseException,
  assertBakeryCapacity, needsFor, upcomingClosedDates, prettyDate
} from './rules.js';
import { creditBalance } from './fulfilment.js';
import { assertAllocatable, personalUnits, reallocateProvisional, isFinal } from './allocation.js';
import { activeBakeries, danishFlavours } from './rules.js';
import { pricingSnapshot } from '../src/domain/standards.js';
import { LIBRARY_SETTINGS } from '../src/domain/library.js';
import { notify, listNotifications, markRead, alreadyNotified } from './notify.js';
import { recommend } from '../src/domain/engine.js';
import { boxName, componentName, sizeLabel, windowLabel, extrasText } from '../src/domain/app.js';
import { DELIVERY_WINDOWS } from '../src/domain/standards.js';
import { dubaiTodayIso, isBeforeCutoff } from '../src/domain/standards.js';

export const personalRouter = Router();

/** Order references: 8 hex characters, re-drawn on the (rare) collision. */
export function newOrderId(prefix, table) {
  for (;;) {
    const id = `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) return id;
  }
}
const idemKey = v => (typeof v === 'string' && /^[\w-]{8,64}$/.test(v) ? v : null);

function loadProfile(userId) {
  const p = userPayload(userId).profile;
  if (!p) throw bad('profile_missing', 'Complete your Morning Profile first.');
  return p;
}

/** Upcoming mornings that the kitchen has not finished with yet. */
const upcomingDays = userId => db.prepare(`SELECT d.* FROM order_days d JOIN orders o ON o.id = d.order_id
  WHERE o.user_id = ? AND d.cancelled = 0 AND d.stage < 3 AND d.date >= ?`).all(userId, dubaiTodayIso());

/** Free-text allergies can't be filtered automatically: operations checks each morning with the bakery. */
function flagOtherAllergies(userId, profile, days) {
  if (!profile.otherAllergies) return;
  for (const d of days) {
    raiseException({ ref: `personal:${d.id}`, kind: 'Dietary/Allergy Issue', note: `Customer allergy note: "${profile.otherAllergies}" — confirm with the bakery before production.`, customerCategory: 'personal' });
  }
}

/**
 * After a Morning Profile change, re-check every upcoming morning (MB-BOX-001 §9:
 * safety always overrides). Unsafe mornings are put on hold for the customer to
 * update or cancel; mornings already past cutoff go to operations as a safety exception.
 */
function reviewUpcoming(userId, profile) {
  const review = [];
  for (const d of upcomingDays(userId)) {
    const unsafe = unsafeComponents(parse(d.cfg), profile);
    if (unsafe.length) {
      if (!d.safety_hold) db.prepare('UPDATE order_days SET safety_hold = 1 WHERE id = ?').run(d.id);
      review.push({ orderId: d.order_id, date: d.date });
      const ref = `${d.order_id}:${d.date}`;
      if (!alreadyNotified(userId, ref, 'safety_review')) {
        notify(userId, ref, 'safety_review', `Your ${prettyDate(d.date)} breakfast no longer matches your updated allergies or dietary needs. Please update or cancel it.`);
      }
      if (!isBeforeCutoff(d.date) || d.stage > 0) {
        raiseException({ ref: `personal:${d.id}`, kind: 'Dietary/Allergy Issue', note: `Profile changed after cutoff; unsafe items: ${unsafe.join(', ')}`, customerCategory: 'personal' });
      }
    } else if (d.safety_hold) {
      db.prepare('UPDATE order_days SET safety_hold = 0 WHERE id = ?').run(d.id);
    }
  }
  return review;
}

/* ---------- Public: availability & recommendation preview ---------- */
personalRouter.get('/availability', (req, res) => {
  const dates = String(req.query.dates || '').split(',').filter(inHorizon).slice(0, 28);
  res.json(Object.fromEntries(dates.map(d => [d, availability(d)])));
});

/** App configuration the customer app needs: closures, support contacts, company details. */
personalRouter.get('/config', (_req, res) => {
  /* Prices set in Admin, and the Fruit Danish variants partner bakeries can make (MB-PRO-001 §14.2). */
  const flavours = [...new Set(activeBakeries().flatMap(danishFlavours))];
  res.json({ closedDates: upcomingClosedDates(), support: SUPPORT, company: SUPPLIER, termsVersion: TERMS_VERSION, pricing: pricingSnapshot(), danishFlavours: flavours, library: { samples: LIBRARY_SETTINGS.samples } });
});

/** Product analytics (Master Plan §15): the app reports funnel steps and no-match results. */
const EVENT_KINDS = ['visit', 'profile_completed', 'plan_started', 'recommendation_shown', 'another_option_viewed', 'no_match', 'summary_viewed', 'checkout_started', 'business_inquiry'];
personalRouter.post('/events', (req, res) => {
  const kind = req.body?.kind;
  if (!EVENT_KINDS.includes(kind)) throw bad('kind_invalid', 'Unknown event.');
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  const userId = token ? db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token)?.user_id ?? null : null;
  db.prepare('INSERT INTO analytics_events (kind, user_id, data) VALUES (?, ?, ?)').run(kind, userId, json(req.body.data ?? null).slice(0, 500));
  res.status(204).end();
});

/** Deterministic preview. The order endpoint re-runs the same engine. */
personalRouter.post('/recommendations', (req, res) => {
  const profile = validateProfile(req.body.profile);
  const r = recommend(profile, req.body.context);
  const out = c => c && { recipeId: c.recipe.id, components: c.components, substitutions: c.substitutions };
  res.json({ none: !r.primary, primary: out(r.primary), alternative: out(r.alternative), message: r.message || null });
});

/* ---------- Me ---------- */
personalRouter.get('/me', requireUser, (req, res) => res.json({ ...userPayload(req.userId), credit: creditBalance(req.userId) }));

personalRouter.put('/me/profile', requireUser, (req, res) => {
  const p = validateProfile(req.body);
  const before = db.prepare('SELECT other_allergies FROM profiles WHERE user_id = ?').get(req.userId)?.other_allergies || '';
  db.prepare(`INSERT INTO profiles (user_id, eating_style, preferences, dietary, allergies, other_allergies) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET eating_style = excluded.eating_style, preferences = excluded.preferences,
    dietary = excluded.dietary, allergies = excluded.allergies, other_allergies = excluded.other_allergies, updated_at = datetime('now')`)
    .run(req.userId, p.eatingStyle, json(p.preferences), json(p.dietary), json(p.allergies), p.otherAllergies || null);
  const review = reviewUpcoming(req.userId, p);
  if (p.otherAllergies && p.otherAllergies !== before) flagOtherAllergies(req.userId, p, upcomingDays(req.userId));
  res.json({ ...userPayload(req.userId), review });
});

personalRouter.put('/me/settings', requireUser, (req, res) => {
  const { coffeeReminder, email, firstName, offers } = req.body;
  if (typeof offers === 'boolean') db.prepare('UPDATE users SET marketing_opt_in = ? WHERE id = ?').run(offers ? 1 : 0, req.userId);
  if (typeof coffeeReminder === 'boolean') {
    db.prepare(`INSERT INTO profiles (user_id, coffee_reminder) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET coffee_reminder = excluded.coffee_reminder`)
      .run(req.userId, coffeeReminder ? 1 : 0);
  }
  if (typeof email === 'string') {
    if (email.trim() && !emailOk(email)) throw bad('email_invalid', 'Enter a valid email, e.g. name@company.com.');
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email.trim() || null, req.userId);
  }
  const name = cleanName(firstName);
  if (name) db.prepare('UPDATE users SET first_name = ? WHERE id = ?').run(name, req.userId);
  res.json(userPayload(req.userId));
});

/* Notification outbox, as the customer sees it. */
personalRouter.get('/me/notifications', requireUser, (req, res) => res.json(listNotifications(req.userId)));
personalRouter.post('/me/notifications/read', requireUser, (req, res) => {
  markRead(req.userId, Array.isArray(req.body.ids) ? req.body.ids : []);
  res.json({ ok: true });
});

/** Accept the current Terms & Privacy Policy (after they change). */
personalRouter.post('/me/accept-terms', requireUser, (req, res) => {
  db.prepare("UPDATE users SET terms_version = ?, terms_accepted_at = datetime('now') WHERE id = ?").run(TERMS_VERSION, req.userId);
  res.json(userPayload(req.userId));
});

/** Everything we hold about me, as JSON (UAE PDPL right of access). */
personalRouter.get('/me/export', requireUser, (req, res) => {
  const user = db.prepare('SELECT mobile, first_name, email, created_at, terms_version, terms_accepted_at, marketing_opt_in FROM users WHERE id = ?').get(req.userId);
  const orders = serializeOrders(db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at').all(req.userId));
  res.set('Content-Disposition', 'attachment; filename="morning-box-my-data.json"').json({
    exportedAt: new Date().toISOString(), account: user, ...userPayload(req.userId), orders,
    support: db.prepare('SELECT topic, order_ref, message, status, reply, created_at, replied_at FROM support_requests WHERE user_id = ?').all(req.userId),
    notifications: listNotifications(req.userId, 500)
  });
});

/* ---------- Help & support ---------- */
export const SUPPORT_TOPICS = ['An order', 'Delivery', 'Allergies & ingredients', 'Payments & refunds', 'My account', 'Business orders', 'Feedback or idea', 'Something else'];
const supportOut = x => ({ id: x.id, topic: x.topic, orderRef: x.order_ref, message: x.message, status: x.status, reply: x.reply, createdAt: x.created_at, repliedAt: x.replied_at });
personalRouter.get('/support', requireUser, (req, res) => {
  res.json(db.prepare('SELECT * FROM support_requests WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.userId).map(supportOut));
});
personalRouter.post('/support', requireUser, (req, res) => {
  const topic = SUPPORT_TOPICS.includes(req.body.topic) ? req.body.topic : null;
  if (!topic) throw bad('topic_invalid', 'Choose what your message is about.');
  const message = plain(req.body.message, 1000);
  if (message.length < 5) throw bad('message_required', 'Tell us a little more so we can help.');
  if (db.prepare(`SELECT COUNT(*) AS n FROM support_requests WHERE user_id = ? AND created_at > datetime('now', '-1 day')`).get(req.userId).n >= 10) {
    throw new ApiError(429, 'support_limit', 'We already have your messages — our team will reply soon.');
  }
  const orderRef = typeof req.body.orderRef === 'string' && /^MB(-B)?-[0-9A-F]{8}$/.test(req.body.orderRef) ? req.body.orderRef : null;
  const r = db.prepare('INSERT INTO support_requests (user_id, topic, order_ref, message) VALUES (?, ?, ?, ?)').run(req.userId, topic, orderRef, message);
  if (topic === 'Allergies & ingredients') raiseException({ ref: `support:${r.lastInsertRowid}`, kind: 'Dietary/Allergy Issue', note: message, customerCategory: 'personal', dedupe: false });
  res.status(201).json(supportOut(db.prepare('SELECT * FROM support_requests WHERE id = ?').get(r.lastInsertRowid)));
});

/** Delete my account. Order records are kept for accounting, without personal details. */
personalRouter.delete('/me', requireUser, (req, res) => {
  const open = upcomingDays(req.userId).length
    + db.prepare(`SELECT COUNT(*) AS n FROM business_days d JOIN business_orders o ON o.id = d.order_id
        WHERE o.user_id = ? AND d.cancelled = 0 AND d.stage < 3 AND d.date >= ?`).get(req.userId, dubaiTodayIso()).n;
  if (open) throw new ApiError(409, 'orders_open', 'Cancel your upcoming mornings first, then delete your account.');
  const u = db.prepare('SELECT mobile FROM users WHERE id = ?').get(req.userId);
  tx(() => {
    for (const t of ['sessions', 'profiles', 'addresses', 'business_accounts', 'business_plans', 'notifications', 'support_requests', 'nps_responses']) {
      db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(req.userId);
    }
    db.prepare('DELETE FROM otp_codes WHERE mobile = ?').run(u.mobile);
    db.prepare(`UPDATE users SET mobile = ?, first_name = 'Deleted customer', email = NULL WHERE id = ?`).run(`deleted:${req.userId}:${randomBytes(4).toString('hex')}`, req.userId);
    db.prepare('UPDATE orders SET email = NULL WHERE user_id = ?').run(req.userId);
    db.prepare(`UPDATE order_days SET feedback_note = NULL, address = json_set(address, '$.notes', '') WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)`).run(req.userId);
  });
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

/* ---------- Orders (MB-FLW-001 §9, MB-DLV-001) ---------- */
const bakeryNames = () => Object.fromEntries(db.prepare('SELECT id, name FROM bakeries').all().map(b => [b.id, b.name]));

/** Serialise orders with their days and issues, in three queries however many orders there are. */
export function serializeOrders(orders) {
  if (!orders.length) return [];
  const ids = orders.map(o => o.id);
  const marks = ids.map(() => '?').join(',');
  const days = db.prepare(`SELECT * FROM order_days WHERE order_id IN (${marks}) ORDER BY date`).all(...ids);
  const issues = db.prepare(`SELECT order_id, date, reason, created_at FROM customer_issues WHERE order_id IN (${marks}) ORDER BY id`).all(...ids);
  const events = db.prepare(`SELECT order_id, date, kind, message, created_at FROM order_events WHERE order_id IN (${marks}) ORDER BY id`).all(...ids);
  const names = bakeryNames();
  return orders.map(o => {
    const own = days.filter(d => d.order_id === o.id);
    return {
      id: o.id, createdAt: o.created_at, email: o.email || '', method: o.payment_method,
      total: own.filter(d => !d.cancelled).reduce((t, d) => t + d.price, 0),
      paid: o.total, creditUsed: o.credit_used || 0,
      days: own.map(d => ({
        date: d.date, window: d.window, cfg: parse(d.cfg), price: d.price, address: parse(d.address),
        cancelled: !!d.cancelled, refund: d.refund, feedback: d.feedback, feedbackReasons: parse(d.feedback_reasons) || [],
        feedbackNote: d.feedback_note || '',
        /* DLV §5–6: the customer sees a missed delivery, a breakfast we couldn't prepare, and any refund. */
        problem: ['Failed', 'Not Fulfilled'].includes(d.delivery_state) && d.stage < 3 ? d.delivery_state : null, recoveryRefund: !d.cancelled ? d.refund || 0 : 0, lateNote: d.stage < 3 && !d.cancelled ? d.late_note || null : null, stage: d.cancelled ? -1 : d.stage,
        /* Prepared by [Partner Bakery] once the final allocation has been made (FLW §9, PRD §11). */
        bakery: d.bakery_id && isFinal(d.date) ? names[d.bakery_id] || null : null, deliveredAt: d.delivered_at, deliveryPoint: d.delivery_point,
        safetyReview: !!d.safety_hold && !d.cancelled,
        issues: issues.filter(i => i.order_id === o.id && i.date === d.date).map(i => ({ reason: i.reason, createdAt: i.created_at })),
        events: events.filter(e => e.order_id === o.id && (e.date === d.date || e.date === null)).map(e => ({ kind: e.kind, message: e.message, createdAt: e.created_at }))
      }))
    };
  });
}
export const serializeOrder = o => serializeOrders([o])[0];

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

/** Newest first. `?limit=` (default 50, max 200) and `?before=<createdAt>` page through older orders. */
personalRouter.get('/orders', requireUser, (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const before = typeof req.query.before === 'string' ? req.query.before : null;
  const orders = db.prepare(`SELECT * FROM orders WHERE user_id = ? AND (? IS NULL OR created_at < ?) ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(req.userId, before, before, limit);
  res.json(serializeOrders(orders));
});

personalRouter.get('/orders/:id', requireUser, (req, res) => res.json(serializeOrder(ownOrder(req.userId, req.params.id))));

/**
 * Create an order. Body:
 * { days: [{ date, context, recipeId, components, size, addons, window, address? }], address, email, method,
 *   idempotencyKey?, expectedTotal? }
 * Every day is re-validated (cutoff, eligibility, swaps, add-ons, capacity) and re-priced.
 * A repeated idempotencyKey returns the order already created (double taps, retries).
 * If expectedTotal differs from the server price, nothing is charged and 409 price_changed is returned.
 */
personalRouter.post('/orders', requireUser, (req, res) => {
  const key = idemKey(req.body.idempotencyKey);
  if (key) {
    const existing = db.prepare('SELECT * FROM orders WHERE user_id = ? AND idempotency_key = ?').get(req.userId, key);
    if (existing) return res.status(200).json(serializeOrder(existing));
  }
  const profile = loadProfile(req.userId);
  const days = Array.isArray(req.body.days) ? req.body.days : [];
  if (!days.length || days.length > 28) throw bad('days_invalid', 'Plan at least one morning.');
  if (new Set(days.map(d => d?.date)).size !== days.length) throw bad('days_invalid', 'Each morning can only appear once.');
  const address = validateAddress(req.body.address);
  const method = ['card', 'apple'].includes(req.body.method) ? req.body.method : 'card';
  const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  if (email && !emailOk(email)) throw bad('email_invalid', 'Enter a valid email for your confirmation, or leave it empty.');

  const built = days.map(d => {
    assertOrderable(d.date);
    const b = buildPersonalDay(d, profile);
    const dayAddress = d.address ? validateAddress(d.address) : address;
    return { ...b, date: d.date, window: d.window, address: dayAddress };
  });
  const total = built.reduce((t, b) => t + b.price, 0);
  if (req.body.expectedTotal !== undefined && Number(req.body.expectedTotal) !== total) {
    throw new ApiError(409, 'price_changed', `Your total is now AED ${total}. Please check it and pay again.`, { total, prices: built.map(b => ({ date: b.date, price: b.price })) });
  }
  const id = newOrderId('MB', 'orders');
  const needs = needsFor(profile.dietary, profile.allergies);
  const order = tx(() => {
    built.forEach(b => { assertCapacity(b.date, b.window, 1); assertAllocatable(b.date, [{ kind: 'personal', boxes: 1, units: personalUnits(b.cfg, b.trace.inputs) }]); });
    /* Morning Box credit (service recovery) is used first; the card pays the rest. */
    const credit = Math.min(creditBalance(req.userId), total);
    // Payment gateway integration point: authorise `total - credit` before persisting.
    const paymentRef = `demo_${randomBytes(6).toString('hex')}`;
    db.prepare('INSERT INTO orders (id, user_id, email, payment_method, payment_ref, total, idempotency_key, credit_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, req.userId, email || null, method, paymentRef, total, key, credit);
    if (credit > 0) db.prepare('INSERT INTO customer_credits (user_id, amount, reason, ref) VALUES (?, ?, ?, ?)').run(req.userId, -credit, 'Used on order', id);
    const ins = db.prepare('INSERT INTO order_days (order_id, date, window, context, cfg, trace, price, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    built.forEach(b => ins.run(id, b.date, b.window, b.cfg.context, json(b.cfg), json(b.trace), b.price, json(b.address)));
    db.prepare(`INSERT INTO addresses (user_id, building, unit, area, handover, notes, default_window) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET building = excluded.building, unit = excluded.unit, area = excluded.area,
      handover = excluded.handover, notes = excluded.notes, default_window = excluded.default_window`)
      .run(req.userId, address.building, address.unit, address.area, address.handover, address.notes, built[0].window);
    if (email) db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, req.userId);
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  });
  flagOtherAllergies(req.userId, profile, db.prepare('SELECT * FROM order_days WHERE order_id = ?').all(id));
  reallocateProvisional(built.map(b => b.date));
  db.prepare("INSERT INTO analytics_events (kind, user_id) VALUES ('order_placed', ?)").run(req.userId);
  logEvent(id, null, 'placed', `Order placed and paid · AED ${total}${order.credit_used ? ` (AED ${order.credit_used} credit used)` : ''}`);
  notify(req.userId, id, 'confirmed', `Order ${id} is confirmed: ${built.length} morning${built.length > 1 ? 's' : ''}, AED ${total}.`);
  res.status(201).json(serializeOrder(order));
});

const RECIPE_FIELDS = ['context', 'recipeId', 'components', 'size', 'addons', 'danishFlavour'];

/** Edit one morning before its cutoff: context, size, add-ons, window.
    A window-only change keeps the breakfast exactly as ordered. A morning on
    safety hold must be re-planned against the current profile. */
personalRouter.patch('/orders/:id/days/:date', requireUser, (req, res) => {
  const order = ownOrder(req.userId, req.params.id);
  const day = ownDay(order, req.params.date);
  if (day.cancelled) throw bad('cancelled', 'This morning was cancelled.');
  assertEditable(day.date, day.stage);
  const window = req.body.window ?? day.window;
  const rebuild = RECIPE_FIELDS.some(k => req.body[k] !== undefined) || !!day.safety_hold;
  let b = null;
  if (rebuild) {
    const profile = loadProfile(req.userId);
    const current = parse(day.cfg);
    b = buildPersonalDay({
      context: req.body.context ?? current.context,
      recipeId: req.body.recipeId ?? current.recipeId,
      components: req.body.components ?? current.components,
      danishFlavour: req.body.danishFlavour ?? current.danishFlavour,
      size: req.body.size ?? current.size,
      addons: req.body.addons ?? current.addons
    }, profile);
  }
  const changes = [];
  if (window !== day.window) changes.push(`delivery window to ${windowLabel(window)}`);
  if (b) {
    const cur = parse(day.cfg);
    if (b.cfg.recipeId !== cur.recipeId || b.cfg.context !== cur.context) changes.push(`breakfast to ${boxName(b.cfg)}`);
    else if (JSON.stringify(b.cfg.components) !== JSON.stringify(cur.components)) {
      const gone = cur.components.filter(c => !b.cfg.components.includes(c)), added = b.cfg.components.filter(c => !cur.components.includes(c));
      changes.push(`breakfast items (${[...added.map(c => `+ ${componentName(c)}`), ...gone.map(c => `− ${componentName(c)}`)].join(', ')})`);
    }
    if (b.cfg.size !== cur.size) changes.push(`size to ${sizeLabel(b.cfg.size)}`);
    if (JSON.stringify(b.cfg.addons) !== JSON.stringify(cur.addons)) changes.push(b.cfg.addons.length ? `extras to ${extrasText(b.cfg.addons)}` : 'removed extras');
    if (b.price !== day.price) changes.push(`price AED ${day.price} → AED ${b.price}`);
  }
  tx(() => {
    if (window !== day.window) assertCapacity(day.date, window, 1, { excludeOrderDay: day.id });
    /* The changed breakfast must still be makeable by a bakery with capacity (DLV §8). */
    if (b) assertAllocatable(day.date, [{ kind: 'personal', boxes: 1, units: personalUnits(b.cfg, b.trace.inputs) }], { exclude: [`personal:${day.id}`] });
    if (b) {
      db.prepare('UPDATE order_days SET cfg = ?, trace = ?, price = ?, context = ?, window = ?, safety_hold = 0 WHERE id = ?')
        .run(json(b.cfg), json(b.trace), b.price, b.cfg.context, window, day.id);
      // Payment gateway integration point: charge (positive) or refund (negative) the difference.
      if (b.price !== day.price) db.prepare('INSERT INTO payment_adjustments (order_day_id, amount) VALUES (?, ?)').run(day.id, b.price - day.price);
    } else {
      db.prepare('UPDATE order_days SET window = ? WHERE id = ?').run(window, day.id);
    }
    if (changes.length) logEvent(order.id, day.date, 'changed', `You changed ${changes.join(', ')}`);
  });
  if (b) reallocateProvisional([day.date]);
  res.json(serializeOrder(order));
});

/** Cancel before cutoff → full refund for that morning; other mornings unaffected (MB-DLV-001 §11). */
personalRouter.post('/orders/:id/days/:date/cancel', requireUser, (req, res) => {
  const order = ownOrder(req.userId, req.params.id);
  const day = ownDay(order, req.params.date);
  if (!day.cancelled) {
    assertEditable(day.date, day.stage);
    // Payment gateway integration point: refund `day.price` against order.payment_ref.
    db.prepare('UPDATE order_days SET cancelled = 1, refund = price, safety_hold = 0 WHERE id = ?').run(day.id);
    logEvent(order.id, day.date, 'cancelled', `You cancelled this morning · AED ${day.price} refund`);
    notify(req.userId, `${order.id}:${day.date}`, 'refund', `Your ${prettyDate(day.date)} morning is cancelled. AED ${day.price} will be refunded to your original payment method.`);
  }
  res.json(serializeOrder(order));
});

/** MB-PRD-001 §12 / MB-REC-001 §14: Loved it or Not for me, with an optional
    predefined reason after Not for me. Stored as a learning signal only — it never
    changes recommendations. Feedback can be changed for 7 days after delivery. */
const FEEDBACK_REASONS = ['Not my taste', 'Too much', 'Too little', 'Not fresh enough', 'Arrived late'];
const FEEDBACK_DAYS = 7;
personalRouter.post('/orders/:id/days/:date/feedback', requireUser, (req, res) => {
  const order = ownOrder(req.userId, req.params.id);
  const day = ownDay(order, req.params.date);
  const value = req.body.value;
  if (!['Loved it', 'Not for me'].includes(value)) throw bad('feedback_invalid', 'Choose Loved it or Not for me.');
  if (day.cancelled || day.stage < 3) throw bad('not_delivered', 'Feedback opens after delivery.');
  const delivered = day.delivered_at ? new Date(day.delivered_at.replace(' ', 'T') + 'Z') : null;
  if (delivered && Date.now() - delivered > FEEDBACK_DAYS * 864e5) throw bad('feedback_closed', `Feedback closes ${FEEDBACK_DAYS} days after delivery.`);
  const reasons = value === 'Not for me' && Array.isArray(req.body.reasons)
    ? req.body.reasons.filter(r => FEEDBACK_REASONS.includes(r)).slice(0, 1) : [];
  db.prepare(`UPDATE order_days SET feedback = ?, feedback_reasons = ?, feedback_tags = NULL, rating = NULL, feedback_note = NULL, feedback_at = datetime('now') WHERE id = ?`)
    .run(value, json(reasons), day.id);
  logEvent(order.id, day.date, 'feedback', `You said: ${value}`);
  res.json(serializeOrder(order));
});

/** Report a problem with a morning (missing, late, wrong items, allergy concern…).
    Each report opens an operations exception; allergy concerns are top priority. */
export const ISSUE_REASONS = {
  'Not delivered': 'Delivery Failed',
  'Arrived late': 'Courier Delay',
  'Wrong or missing items': 'Order Accuracy',
  'Allergy concern': 'Safety Incident',
  'Quality issue': 'QC Failure',
  'Packaging issue': 'Packaging Issue',
  'Something else': 'Customer Issue'
};
personalRouter.post('/orders/:id/days/:date/issue', requireUser, (req, res) => {
  const order = ownOrder(req.userId, req.params.id);
  const day = ownDay(order, req.params.date);
  const kind = ISSUE_REASONS[req.body.reason];
  if (!kind) throw bad('issue_invalid', 'Choose what went wrong.');
  if (day.cancelled) throw bad('cancelled', 'This morning was cancelled.');
  if (day.date > dubaiTodayIso() && day.stage < 2) throw bad('issue_too_early', 'You can report a problem on the morning of delivery.');
  if (db.prepare('SELECT COUNT(*) AS n FROM customer_issues WHERE order_id = ? AND date = ?').get(order.id, day.date).n >= 5) {
    throw bad('issue_limit', 'We already have your reports for this morning — our team will be in touch.');
  }
  const note = plain(req.body.note, 500);
  /* Complaint data feeds partner performance (OPS §10): link it to the bakery that prepared it, or the route that delivered it. */
  const bakery = day.bakery_id ? db.prepare('SELECT name FROM bakeries WHERE id = ?').get(day.bakery_id)?.name : null;
  const courierSide = ['Not delivered', 'Arrived late'].includes(req.body.reason);
  const exceptionId = raiseException({ ref: `personal:${day.id}`, kind, note: `${req.body.reason}${note ? `: ${note}` : ''}`, customerCategory: 'personal', dedupe: false,
    owner: 'Operations', responsibleParty: courierSide ? (day.route_id ? `Route ${day.route_id}` : 'Delivery partner') : bakery, action: 'Contact the customer; decide the remedy' });
  db.prepare('INSERT INTO customer_issues (user_id, order_id, date, reason, note, exception_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.userId, order.id, day.date, req.body.reason, note || null, exceptionId);
  logEvent(order.id, day.date, 'issue', `You reported: ${req.body.reason}`);
  notify(req.userId, `${order.id}:${day.date}`, 'issue_update', 'Thanks for telling us. Our team has your report and will contact you shortly.');
  res.json(serializeOrder(order));
});

/* ---------- Receipt & calendar ---------- */
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (Math.round(n * 100) / 100).toFixed(2);

/** VAT receipt for a personal order (HTML). Prices include VAT; it is a "Tax Invoice" once MB_TRN is set. */
personalRouter.get('/orders/:id/receipt', requireUser, (req, res) => {
  const o = serializeOrder(ownOrder(req.userId, req.params.id));
  const u = db.prepare('SELECT first_name FROM users WHERE id = ?').get(req.userId);
  const vat = o.total - o.total / (1 + VAT_RATE);
  const refunded = o.days.filter(d => d.cancelled).reduce((t, d) => t + (d.refund || d.price), 0);
  const rows = o.days.map(d => `<tr><td>${esc(d.date)}</td><td>${esc(boxName(d.cfg))} · ${esc(sizeLabel(d.cfg.size))}${d.cfg.addons.length ? `<br><small>+ ${esc(extrasText(d.cfg.addons))}</small>` : ''}${d.cancelled ? '<br><small>Cancelled — refunded</small>' : ''}</td><td>${esc(windowLabel(d.window))}</td><td style="text-align:right">${d.cancelled ? '0.00' : money(d.price)}</td></tr>`).join('');
  res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt ${esc(o.id)}</title>
<style>body{font-family:Inter,Arial,sans-serif;color:#3B2D22;max-width:720px;margin:32px auto;padding:0 20px}h1{font-family:Georgia,serif;font-weight:400}table{width:100%;border-collapse:collapse;font-size:14px}td,th{border-bottom:1px solid #EADCC1;padding:8px;text-align:left;vertical-align:top}.r{text-align:right}</style>
<h1>${esc(SUPPLIER.name)} — ${SUPPLIER.trn ? 'Tax Invoice' : 'Receipt'}</h1>
<p>${SUPPLIER.trn ? 'Invoice' : 'Receipt'} ${esc(o.id)} · ${esc(o.createdAt)} UTC</p>
<p><b>From:</b> ${esc(SUPPLIER.name)}<br>${esc(SUPPLIER.address)}${SUPPLIER.trn ? `<br>TRN ${esc(SUPPLIER.trn)}` : ''}</p>
<p><b>Customer:</b> ${esc(u?.first_name)}${o.email ? `<br>${esc(o.email)}` : ''}</p>
<table><tr><th>Date</th><th>Breakfast</th><th>Delivery</th><th class="r">AED</th></tr>${rows}</table>
<p class="r">Delivery: included<br>Total excluding VAT: AED ${money(o.total - vat)}<br>VAT ${Math.round(VAT_RATE * 100)}%: AED ${money(vat)}</p>
<p class="r" style="font-size:18px"><b>Total AED ${money(o.total)}</b></p>
${refunded ? `<p class="r">Refunded for cancelled mornings: AED ${money(refunded)}</p>` : ''}
<p style="font-size:12px">Paid by ${o.method === 'apple' ? 'Apple Pay' : 'card'}. Prices include VAT.</p>`);
});

/** Add the order's mornings to a calendar (.ics). Times are Dubai local (UTC+4, no daylight saving). */
personalRouter.get('/orders/:id/calendar', requireUser, (req, res) => {
  const o = serializeOrder(ownOrder(req.userId, req.params.id));
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const at = (date, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(Date.UTC(...date.split('-').map((x, i) => (i === 1 ? x - 1 : +x)), h - 4, m)).toISOString().replace(/[-:]|\.\d{3}/g, ''); };
  const line = s => String(s).replace(/[\\,;]/g, c => `\\${c}`).replace(/\n/g, '\\n');
  const events = o.days.filter(d => !d.cancelled).map(d => {
    const w = DELIVERY_WINDOWS.find(x => x.id === d.window);
    const [from, to] = (w?.label || '8:00 – 9:00 AM').replace(/\s*AM/g, '').split(/\s*[–-]\s*/).map(t => (t.length === 4 ? `0${t}` : t));
    return ['BEGIN:VEVENT', `UID:${o.id}-${d.date}@morningbox`, `DTSTAMP:${stamp}`, `DTSTART:${at(d.date, from)}`, `DTEND:${at(d.date, to)}`,
      `SUMMARY:${line(`Morning Box · ${boxName(d.cfg)}`)}`, `LOCATION:${line(`${d.address.building}, ${d.address.unit}, DIFC`)}`,
      `DESCRIPTION:${line(`Order ${o.id}. Delivered to ${d.address.handover === 'door' ? 'your door' : 'reception'}.`)}`, 'END:VEVENT'].join('\r\n');
  });
  res.type('text/calendar').send(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Morning Box//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n'));
});
