/* Launch discounts on the server: first-order eligibility, promotional codes and their usage
   (Morning Box Launch Discount Requirements v1.0). The arithmetic is in src/domain/discounts.js,
   shared with the app so the price shown is the price charged. */
import { db, tx } from './db.js';
import { ApiError, bad } from './rules.js';
import { dubaiTodayIso } from '../src/domain/standards.js';
import { priceOrder, priceDay } from '../src/domain/discounts.js';

db.exec(`
CREATE TABLE IF NOT EXISTS promo_codes (
  code TEXT PRIMARY KEY,
  type TEXT NOT NULL,                       -- 'percent' | 'fixed'
  value REAL NOT NULL,                      -- 0.1 for 10%, or AED
  active INTEGER NOT NULL DEFAULT 1,
  personal INTEGER NOT NULL DEFAULT 1,
  business INTEGER NOT NULL DEFAULT 1,
  customers TEXT NOT NULL DEFAULT 'all',    -- 'all' | 'new' (no earlier order) | 'existing'
  valid_from TEXT, valid_to TEXT,           -- Dubai dates, inclusive
  max_uses INTEGER,                         -- across all customers; NULL = no limit
  max_per_customer INTEGER NOT NULL DEFAULT 1,
  min_order REAL,                           -- AED before discounts; NULL = none
  max_discount REAL,                        -- AED cap for a percentage code; NULL = none
  combinable INTEGER NOT NULL DEFAULT 0,    -- applies after the automatic discounts, or instead of them
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS promo_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  order_kind TEXT NOT NULL,                 -- 'personal' | 'business'
  order_id TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS promo_redemptions_code ON promo_redemptions(code);
`);

/* An order counts while at least one of its days is still on (a fully cancelled order gives the
   first-order discount and the promo use back). */
const LIVE_PERSONAL = 'EXISTS (SELECT 1 FROM order_days d WHERE d.order_id = o.id AND d.cancelled = 0)';
const LIVE_BUSINESS = 'EXISTS (SELECT 1 FROM business_days d WHERE d.order_id = o.id AND d.cancelled = 0)';

/** Requirements §01: once per customer, on their first order (personal or business). */
export function firstOrderEligible(userId) {
  const p = db.prepare(`SELECT 1 FROM orders o WHERE o.user_id = ? AND ${LIVE_PERSONAL} LIMIT 1`).get(userId);
  const b = db.prepare(`SELECT 1 FROM business_orders o WHERE o.user_id = ? AND ${LIVE_BUSINESS} LIMIT 1`).get(userId);
  return !p && !b;
}

const liveUses = (code, userId = null) => db.prepare(`
  SELECT COUNT(*) AS n FROM promo_redemptions r WHERE r.code = ? AND (? IS NULL OR r.user_id = ?) AND (
    (r.order_kind = 'personal' AND EXISTS (SELECT 1 FROM order_days d WHERE d.order_id = r.order_id AND d.cancelled = 0)) OR
    (r.order_kind = 'business' AND EXISTS (SELECT 1 FROM business_days d WHERE d.order_id = r.order_id AND d.cancelled = 0)))`).get(code, userId, userId).n;

export const normaliseCode = v => (typeof v === 'string' ? v.trim().toUpperCase().replace(/\s+/g, '') : '');
const row = code => db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(normaliseCode(code));
const asPromo = r => ({ code: r.code, type: r.type, value: r.value, combinable: !!r.combinable, minOrder: r.min_order || 0, maxDiscount: r.max_discount || 0 });

/** Check a code for this customer and kind of order; throws a 400 with a customer-facing reason. */
export function loadPromo(code, { userId, kind }) {
  const r = row(code);
  const no = msg => bad('promo_invalid', msg);
  if (!r || !r.active) throw no('That code isn’t valid. Check the spelling and try again.');
  const today = dubaiTodayIso();
  if (r.valid_from && today < r.valid_from) throw no('That code isn’t active yet.');
  if (r.valid_to && today > r.valid_to) throw no('That code has expired.');
  if (!r[kind]) throw no(kind === 'business' ? 'That code is for personal orders only.' : 'That code is for Group & Business orders only.');
  const isNew = firstOrderEligible(userId);
  if (r.customers === 'new' && !isNew) throw no('That code is for your first order only.');
  if (r.customers === 'existing' && isNew) throw no('That code is for returning customers.');
  if (r.max_uses && liveUses(r.code) >= r.max_uses) throw no('That code has been fully used.');
  if (liveUses(r.code, userId) >= (r.max_per_customer || 1)) throw no('You’ve already used that code.');
  return asPromo(r);
}

/**
 * Price a new order's days with every discount the customer qualifies for.
 * days: [{ date, gross, boxes }]. Returns priceOrder's result (days with basis and lines).
 * A code that doesn't apply (e.g. a better discount is kept) is reported in `.promo`, not thrown.
 */
export function discountOrder(userId, kind, days, promoCode) {
  const firstEligible = firstOrderEligible(userId);
  const promo = normaliseCode(promoCode) ? loadPromo(promoCode, { userId, kind }) : null;
  return priceOrder(kind, days, { firstEligible, promo });
}

/** Record a used code inside the order's transaction, re-checking the limits so two orders can't both take the last use. */
export function recordPromo(priced, { userId, kind, orderId }) {
  if (!priced.promo?.applied) return;
  const r = row(priced.promo.code);
  if (r.max_uses && liveUses(r.code) >= r.max_uses) throw new ApiError(409, 'promo_used_up', 'That code has just been fully used. Your payment is being refunded. Please order again.');
  if (liveUses(r.code, userId) >= (r.max_per_customer || 1)) throw new ApiError(409, 'promo_used_up', 'You’ve already used that code. Your payment is being refunded. Please order again.');
  const amount = priced.days.reduce((t, d) => t + (d.lines.find(l => l.kind === 'promo')?.amount || 0), 0);
  db.prepare('INSERT INTO promo_redemptions (code, user_id, order_kind, order_id, amount) VALUES (?, ?, ?, ?, ?)').run(r.code, userId, kind, orderId, amount);
}

/** Re-price one existing day after an edit, with the discounts it was ordered with. */
export const repriceDay = (basisJson, gross, opts) => priceDay(basisJson ? JSON.parse(basisJson) : null, gross, opts);

/* ---------- Admin: promotional codes ---------- */
export function listPromos() {
  return db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC').all().map(r => ({
    code: r.code, type: r.type, value: r.value, active: !!r.active, personal: !!r.personal, business: !!r.business,
    customers: r.customers, validFrom: r.valid_from || '', validTo: r.valid_to || '', maxUses: r.max_uses || null,
    maxPerCustomer: r.max_per_customer || 1, minOrder: r.min_order || null, maxDiscount: r.max_discount || null,
    combinable: !!r.combinable, note: r.note || '', createdAt: r.created_at,
    uses: liveUses(r.code),
    saved: db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM promo_redemptions WHERE code = ?').get(r.code).s
  }));
}

const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v);
function validatePromo(p, { creating }) {
  const code = normaliseCode(p.code);
  if (creating && !/^[A-Z0-9_-]{3,24}$/.test(code)) throw bad('promo_invalid', 'Codes are 3–24 letters, numbers, - or _.');
  if (!['percent', 'fixed'].includes(p.type)) throw bad('promo_invalid', 'Choose a percentage or a fixed AED amount.');
  const value = Number(p.value);
  if (p.type === 'percent' && !(value > 0 && value <= 1)) throw bad('promo_invalid', 'A percentage code must be between 0.1% and 100%.');
  if (p.type === 'fixed' && !(value >= 1 && value <= 10000)) throw bad('promo_invalid', 'A fixed code must be between AED 1 and AED 10,000.');
  if (!p.personal && !p.business) throw bad('promo_invalid', 'Choose who can use the code: personal, business or both.');
  if (!['all', 'new', 'existing'].includes(p.customers)) throw bad('promo_invalid', 'Choose which customers can use the code.');
  const from = p.validFrom || null, to = p.validTo || null;
  if ((from && !isDate(from)) || (to && !isDate(to))) throw bad('promo_invalid', 'Dates must be YYYY-MM-DD.');
  if (from && to && from > to) throw bad('promo_invalid', 'The end date is before the start date.');
  const int = (v, name) => { if (v === null || v === '' || v === undefined) return null; const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 1e6) throw bad('promo_invalid', `${name} must be a whole number of 1 or more.`); return n; };
  const aed = (v, name) => { if (v === null || v === '' || v === undefined) return null; const n = Number(v); if (!(n > 0 && n <= 100000)) throw bad('promo_invalid', `${name} must be an amount in AED.`); return Math.round(n * 100) / 100; };
  return {
    code, type: p.type, value: p.type === 'percent' ? Math.round(value * 10000) / 10000 : Math.round(value * 100) / 100,
    active: p.active === false ? 0 : 1, personal: p.personal ? 1 : 0, business: p.business ? 1 : 0, customers: p.customers,
    valid_from: from, valid_to: to, max_uses: int(p.maxUses, 'Total uses'), max_per_customer: int(p.maxPerCustomer, 'Uses per customer') || 1,
    min_order: aed(p.minOrder, 'Minimum order'), max_discount: p.type === 'percent' ? aed(p.maxDiscount, 'Maximum discount') : null,
    combinable: p.combinable ? 1 : 0, note: typeof p.note === 'string' ? p.note.replace(/[<>]/g, '').trim().slice(0, 200) : null
  };
}

export function createPromo(input) {
  const p = validatePromo(input || {}, { creating: true });
  if (row(p.code)) throw bad('promo_exists', 'A code with that name already exists.');
  db.prepare(`INSERT INTO promo_codes (code, type, value, active, personal, business, customers, valid_from, valid_to, max_uses, max_per_customer, min_order, max_discount, combinable, note)
    VALUES (@code, @type, @value, @active, @personal, @business, @customers, @valid_from, @valid_to, @max_uses, @max_per_customer, @min_order, @max_discount, @combinable, @note)`).run(p);
  return listPromos();
}
export function updatePromo(code, input) {
  const cur = row(code);
  if (!cur) throw new ApiError(404, 'not_found', 'Code not found.');
  const p = validatePromo({ ...input, code: cur.code }, { creating: false });
  tx(() => db.prepare(`UPDATE promo_codes SET type = @type, value = @value, active = @active, personal = @personal, business = @business, customers = @customers,
    valid_from = @valid_from, valid_to = @valid_to, max_uses = @max_uses, max_per_customer = @max_per_customer, min_order = @min_order, max_discount = @max_discount,
    combinable = @combinable, note = @note, updated_at = datetime('now') WHERE code = @code`).run({ ...p, code: cur.code }));
  return listPromos();
}
/** Only a code nobody has used can be deleted; a used one is switched off instead (its history stays). */
export function deletePromo(code) {
  const cur = row(code);
  if (!cur) throw new ApiError(404, 'not_found', 'Code not found.');
  if (db.prepare('SELECT 1 FROM promo_redemptions WHERE code = ?').get(cur.code)) throw bad('promo_used', 'This code has been used, so it can’t be deleted. Switch it off instead.');
  db.prepare('DELETE FROM promo_codes WHERE code = ?').run(cur.code);
  return listPromos();
}
