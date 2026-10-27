/* Payments (MB-PRD-001 §6.5, MB-B2B-001 §8: prepaid, one checkout, refunds to the original method).

   Pay first, then create: an order or a paid change is stored as a pending *checkout*; the order
   tables only ever hold paid orders. When the gateway confirms payment (webhook, or the app
   checking on return) the checkout's handler creates the order through the normal code path.
   If that fails (cutoff passed, capacity gone, price changed) the payment is refunded in full.

   Gateway: Stripe Checkout (card, Apple Pay, Google Pay) when STRIPE_SECRET_KEY is set.
   Without it, development (and PAYMENTS_DEMO=1) pays instantly with a `demo_…` reference;
   production refuses to start (server/env.js). Refunds are queued in `refunds` and sent by
   processRefunds(), which retries failures. */
import { Router } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, json, parse } from './db.js';
import { ApiError } from './rules.js';
import { requireUser } from './auth.js';
import { DEV } from './env.js';

const STRIPE = 'https://api.stripe.com/v1';
const CHECKOUT_TTL_S = 30 * 60;                 // Stripe's minimum session lifetime
const fils = aed => Math.round(Number(aed) * 100);
const money = n => Math.round(Number(n) * 100) / 100;

db.exec(`
CREATE TABLE IF NOT EXISTS checkouts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  amount REAL NOT NULL,
  provider TEXT NOT NULL,
  session_id TEXT,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  result TEXT,
  error TEXT,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS checkouts_user_key ON checkouts(user_id, idempotency_key);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  order_id TEXT NOT NULL,
  checkout_id TEXT,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  amount REAL NOT NULL,
  refunded REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS payments_order ON payments(kind, order_id);
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  order_id TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  provider_refs TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT
);
`);

/** 'stripe' with a key; 'demo' in development or with PAYMENTS_DEMO=1; otherwise 'off'. */
export function paymentsMode(env = process.env) {
  if (env.STRIPE_SECRET_KEY) return 'stripe';
  if (DEV || env.PAYMENTS_DEMO === '1') return 'demo';
  return 'off';
}
export const demoRef = () => `demo_${randomBytes(6).toString('hex')}`;

/* ---------- Stripe API (form-encoded, no SDK) ---------- */
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}
async function stripe(method, path, params, idempotencyKey) {
  let res;
  try {
    res = await fetch(STRIPE + path, {
      method,
      headers: {
        authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        ...(params ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {})
      },
      body: params ? form(params) : undefined,
      signal: AbortSignal.timeout(15_000)
    });
  } catch (e) {
    console.error(`[payments] Stripe ${method} ${path}:`, e.message);
    throw new ApiError(502, 'payment_unavailable', 'We couldn’t reach the payment service. Please try again.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[payments] Stripe ${method} ${path} ${res.status}:`, body?.error?.message);
    throw new ApiError(502, 'payment_failed', 'The payment service refused the request. Please try again.', { stripe: body?.error?.code });
  }
  return body;
}

/** Where the gateway sends the customer back: APP_URL (e.g. https://morningbox.ae), or this request's origin in development. */
function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (DEV) return `${req.protocol}://${req.get('host')}`;
  throw new ApiError(503, 'payment_unavailable', 'Payments are not configured.');
}

/* ---------- Checkouts ---------- */
const handlers = {};
/** kind → (userId, payload, payment: { provider, ref, amount }) => result id (order id). Throws ApiError when it can no longer be done. */
export function registerCheckoutHandler(kind, fn) { handlers[kind] = fn; }

const outOf = c => ({ id: c.id, kind: c.kind, status: c.status, amount: c.amount, url: c.status === 'open' ? c.url : undefined, result: c.result || undefined, error: c.error || undefined, ...changeOf(c) });
/** For a paid change: which order and date it is for. */
const changeOf = c => (c.kind.endsWith('_change') ? { orderId: parse(c.payload).orderId, date: parse(c.payload).date } : {});

/**
 * Take payment for `amount` AED, then run the `kind` handler with `payload`.
 * Demo mode (or nothing to pay) runs the handler straight away and returns { done: result }.
 * With Stripe, stores the checkout and returns { checkout: { id, url, … } } for the app to open.
 */
export async function startCheckout(req, { kind, payload, amount, description, email, idempotencyKey }) {
  if (!handlers[kind]) throw new Error(`no checkout handler for ${kind}`);
  const userId = req.userId;
  amount = money(amount);
  const mode = paymentsMode();
  if (mode === 'off') throw new ApiError(503, 'payment_unavailable', 'Payments are not available right now. Please try again later.');
  if (amount <= 0 || mode === 'demo') {
    const provider = amount > 0 ? 'demo' : 'none';
    return { done: handlers[kind](userId, payload, { provider, ref: amount > 0 ? demoRef() : null, amount }) };
  }
  if (idempotencyKey) {
    const prev = db.prepare('SELECT * FROM checkouts WHERE user_id = ? AND idempotency_key = ? AND kind = ? ORDER BY created_at DESC').get(userId, idempotencyKey, kind);
    if (prev && (prev.status !== 'open' || prev.created_at > Date.now() - (CHECKOUT_TTL_S - 120) * 1000) && prev.amount === amount) return { checkout: outOf(prev) };
  }
  const id = `co_${randomBytes(12).toString('hex')}`;
  const base = appUrl(req);
  const session = await stripe('POST', '/checkout/sessions', {
    mode: 'payment',
    client_reference_id: id,
    customer_email: email || undefined,
    success_url: `${base}/#/pay/${id}`,
    cancel_url: `${base}/#/pay/${id}?cancelled=1`,
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_S,
    line_items: { 0: { quantity: 1, price_data: { currency: 'aed', unit_amount: fils(amount), product_data: { name: String(description).slice(0, 250) } } } },
    metadata: { checkout: id, kind },
    payment_intent_data: { metadata: { checkout: id, kind }, description: String(description).slice(0, 250) }
  }, `checkout-${id}`);
  db.prepare('INSERT INTO checkouts (id, user_id, kind, payload, amount, provider, session_id, url, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, kind, json(payload), amount, 'stripe', session.id, session.url, idempotencyKey || null, Date.now());
  return { checkout: outOf(db.prepare('SELECT * FROM checkouts WHERE id = ?').get(id)) };
}

/** Moves a checkout on once the gateway says it is paid. Safe to call repeatedly and concurrently (webhook + app).
    A checkout expired locally is still completed if the gateway reports it paid (e.g. a late webhook). */
export async function completeCheckout(id, session = null) {
  const c = db.prepare('SELECT * FROM checkouts WHERE id = ?').get(id);
  if (!c || !['open', 'expired'].includes(c.status)) return c;
  session ||= await stripe('GET', `/checkout/sessions/${encodeURIComponent(c.session_id)}`);
  if (session.status === 'expired') {
    db.prepare("UPDATE checkouts SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'open'").run(Date.now(), id);
    return db.prepare('SELECT * FROM checkouts WHERE id = ?').get(id);
  }
  if (session.payment_status !== 'paid') return c;
  /* Claim it: only one caller gets past this line. */
  if (!db.prepare("UPDATE checkouts SET status = 'paid', updated_at = ? WHERE id = ? AND status IN ('open', 'expired')").run(Date.now(), id).changes) {
    return db.prepare('SELECT * FROM checkouts WHERE id = ?').get(id);
  }
  const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  const paidAmount = money((session.amount_total ?? fils(c.amount)) / 100);
  const pay = db.prepare('INSERT INTO payments (kind, order_id, checkout_id, provider, provider_ref, amount) VALUES (?, ?, ?, ?, ?, ?)')
    .run(c.kind.split('_')[0], id, id, 'stripe', intent, paidAmount);
  try {
    const result = handlers[c.kind](c.user_id, parse(c.payload), { provider: 'stripe', ref: intent, amount: paidAmount, paymentId: Number(pay.lastInsertRowid) });
    db.prepare('UPDATE payments SET order_id = ? WHERE id = ?').run(String(result), pay.lastInsertRowid);
    db.prepare("UPDATE checkouts SET status = 'done', result = ?, updated_at = ? WHERE id = ?").run(String(result), Date.now(), id);
  } catch (e) {
    /* Paid but can no longer be fulfilled: refund in full (Master Plan §12). */
    const message = e instanceof ApiError ? e.message : 'Something went wrong while confirming your order.';
    if (!(e instanceof ApiError)) console.error('[payments] checkout handler failed', id, e);
    db.prepare("UPDATE checkouts SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(message, Date.now(), id);
    queueRefund(c.kind.split('_')[0], id, paidAmount, `Payment not used: ${message}`);
  }
  return db.prepare('SELECT * FROM checkouts WHERE id = ?').get(id);
}

/** Record a payment that did not go through a checkout (demo mode, or the first payment of an order created by a handler). */
export function recordPayment(kind, orderId, { provider, ref, amount, paymentId }) {
  if (!(amount > 0) || provider === 'none') return;
  if (paymentId) { db.prepare('UPDATE payments SET order_id = ? WHERE id = ?').run(orderId, paymentId); return; }
  db.prepare('INSERT INTO payments (kind, order_id, provider, provider_ref, amount) VALUES (?, ?, ?, ?, ?)').run(kind, orderId, provider, ref, money(amount));
}

/* ---------- Refunds ---------- */
/** Queue `amount` AED back to the card(s) that paid for this order. Runs inside the caller's transaction; sent by processRefunds(). */
export function queueRefund(kind, orderId, amount, reason) {
  amount = money(amount);
  if (!(amount > 0)) return null;
  const r = db.prepare('INSERT INTO refunds (kind, order_id, amount, reason) VALUES (?, ?, ?, ?)').run(kind, orderId, amount, String(reason || '').slice(0, 200));
  setImmediate(() => processRefunds().catch(e => console.error('[refunds]', e)));
  return Number(r.lastInsertRowid);
}

let running = false;
/** Send pending refunds to the gateway, spreading each over the order's payments (oldest first). Retries up to 8 times. */
export async function processRefunds() {
  if (running) return 0;
  running = true;
  let n = 0;
  try {
    for (const r of db.prepare("SELECT * FROM refunds WHERE status = 'pending' AND attempts < 8 ORDER BY id").all()) {
      let left = money(r.amount - (parse(r.provider_refs) || []).reduce((t, x) => t + x.amount, 0));
      const refs = parse(r.provider_refs) || [];
      try {
        const pays = db.prepare('SELECT * FROM payments WHERE kind = ? AND order_id = ? AND amount > refunded ORDER BY id').all(r.kind, r.order_id);
        for (const p of pays) {
          if (left <= 0) break;
          const part = money(Math.min(left, p.amount - p.refunded));
          let ref = null;
          if (p.provider === 'stripe') {
            if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
            ref = (await stripe('POST', '/refunds', { payment_intent: p.provider_ref, amount: fils(part), metadata: { refund: r.id, order: r.order_id } }, `refund-${r.id}-${p.id}-${fils(part)}`)).id;
          }
          db.prepare('UPDATE payments SET refunded = refunded + ? WHERE id = ?').run(part, p.id);
          refs.push({ payment: p.id, provider: p.provider, ref, amount: part });
          db.prepare('UPDATE refunds SET provider_refs = ? WHERE id = ?').run(json(refs), r.id);
          left = money(left - part);
        }
        /* Orders from before real payments (demo references) have nothing to send. */
        db.prepare("UPDATE refunds SET status = 'done', done_at = datetime('now'), last_error = ? WHERE id = ?").run(left > 0 ? `AED ${left} had no gateway payment to refund` : null, r.id);
        n++;
      } catch (e) {
        db.prepare("UPDATE refunds SET attempts = attempts + 1, last_error = ?, status = CASE WHEN attempts + 1 >= 8 THEN 'failed' ELSE 'pending' END WHERE id = ?")
          .run(String(e.details?.stripe || e.message).slice(0, 300), r.id);
        console.error(`[refunds] #${r.id} ${r.order_id}:`, e.message);
      }
    }
  } finally { running = false; }
  return n;
}

/** Card refunds for an order, for receipts and the ops console. */
export const refundsFor = (kind, orderId) => db.prepare('SELECT amount, reason, status, created_at, done_at FROM refunds WHERE kind = ? AND order_id = ? ORDER BY id').all(kind, orderId);

/* ---------- Routes ---------- */
export const paymentsRouter = Router();

/** Stripe webhook (configure the endpoint https://<host>/api/payments/webhook for checkout.session.completed and .expired). */
paymentsRouter.post('/webhook', (req, res, next) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return next(new ApiError(503, 'payment_unavailable', 'Webhook not configured.'));
  const sig = String(req.get('stripe-signature') || '');
  const t = sig.match(/(?:^|,)t=(\d+)/)?.[1];
  const v1s = [...sig.matchAll(/(?:^|,)v1=([0-9a-f]+)/g)].map(m => m[1]);
  const raw = req.rawBody || Buffer.alloc(0);
  const want = t && createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex');
  const ok = want && v1s.some(v => v.length === want.length && timingSafeEqual(Buffer.from(v), Buffer.from(want)));
  if (!ok || Math.abs(Date.now() / 1000 - Number(t)) > 300) return next(new ApiError(400, 'bad_signature', 'Invalid signature.'));
  const event = JSON.parse(raw.toString('utf8'));
  const session = event.data?.object;
  const id = session?.client_reference_id || session?.metadata?.checkout;
  if (!id || !['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired'].includes(event.type)) return res.json({ received: true });
  completeCheckout(id, session).then(() => res.json({ received: true })).catch(next);
});

const ownCheckout = (userId, id) => {
  const c = db.prepare('SELECT * FROM checkouts WHERE id = ? AND user_id = ?').get(String(id), userId);
  if (!c) throw new ApiError(404, 'not_found', 'Payment not found.');
  return c;
};
/** The app calls this when the customer comes back from the payment page. */
paymentsRouter.post('/checkouts/:id/confirm', requireUser, (req, res, next) => {
  const c = ownCheckout(req.userId, req.params.id);
  if (c.status !== 'open') return res.json(outOf(c));
  completeCheckout(c.id).then(x => res.json(outOf(x))).catch(next);
});
paymentsRouter.get('/checkouts/:id', requireUser, (req, res) => res.json(outOf(ownCheckout(req.userId, req.params.id))));

/** Expire checkouts the customer abandoned, so they don't linger as open (Stripe expires the session itself). */
export function expireCheckouts(now = Date.now()) {
  return db.prepare("UPDATE checkouts SET status = 'expired', updated_at = ? WHERE status = 'open' AND created_at < ?").run(now, now - (CHECKOUT_TTL_S + 15 * 60) * 1000).changes;
}

/** For tests and ops: a checkout row. */
export const getCheckout = id => db.prepare('SELECT * FROM checkouts WHERE id = ?').get(id);
