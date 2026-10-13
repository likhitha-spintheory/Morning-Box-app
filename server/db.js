import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.env.DB_FILE || join(here, '..', 'data', 'morningbox.db');
if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mobile TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS otp_codes (
  mobile TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  eating_style TEXT,
  preferences TEXT NOT NULL DEFAULT '[]',
  dietary TEXT NOT NULL DEFAULT '[]',
  allergies TEXT NOT NULL DEFAULT '[]',
  coffee_reminder INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS addresses (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  building TEXT, unit TEXT, area TEXT, handover TEXT, notes TEXT, default_window TEXT
);
CREATE TABLE IF NOT EXISTS bakeries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  distance_km REAL NOT NULL,
  daily_capacity INTEGER NOT NULL,
  gluten_free_certified INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  email TEXT,
  payment_method TEXT NOT NULL,
  payment_ref TEXT NOT NULL,
  total INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  date TEXT NOT NULL,
  window TEXT NOT NULL,
  context TEXT NOT NULL,
  cfg TEXT NOT NULL,
  trace TEXT NOT NULL,
  price INTEGER NOT NULL,
  address TEXT NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0,
  refund INTEGER NOT NULL DEFAULT 0,
  feedback TEXT,
  stage INTEGER NOT NULL DEFAULT 0,
  bakery_id INTEGER REFERENCES bakeries(id),
  delivered_at TEXT,
  delivery_point TEXT,
  UNIQUE(order_id, date)
);
CREATE TABLE IF NOT EXISTS business_accounts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  company TEXT NOT NULL,
  email TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS business_orders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  company TEXT NOT NULL,
  email TEXT NOT NULL,
  invoice TEXT NOT NULL,
  payment_ref TEXT NOT NULL,
  total INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS business_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES business_orders(id),
  date TEXT NOT NULL,
  window TEXT NOT NULL,
  people INTEGER NOT NULL,
  lines TEXT NOT NULL,
  specials TEXT NOT NULL,
  delivery TEXT NOT NULL,
  gross INTEGER NOT NULL,
  discount INTEGER NOT NULL,
  total INTEGER NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0,
  stage INTEGER NOT NULL DEFAULT 0,
  allocation TEXT,
  UNIQUE(order_id, date)
);
CREATE TABLE IF NOT EXISTS exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL,
  kind TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved INTEGER NOT NULL DEFAULT 0
);
`);

/* Additive migrations for databases created by earlier versions. */
const columnsOf = table => db.prepare(`PRAGMA table_info('${table}')`).all().map(c => c.name);
function addColumns(table, defs) {
  const have = columnsOf(table);
  const added = [];
  for (const [name, def] of Object.entries(defs)) {
    if (!have.includes(name)) { db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`); added.push(name); }
  }
  return added;
}
/* Fulfilment columns shared by personal and business days (MB-DLV-001, MB-OPS-001, MB-BKY-001). */
const DAY_FULFILMENT = {
  delivered_at: 'TEXT', delivery_point: 'TEXT', recipient_type: 'TEXT',
  bakery_state: 'TEXT', issue_reason: 'TEXT', delay_minutes: 'INTEGER', qc_passed: 'INTEGER NOT NULL DEFAULT 0',
  delivery_state: 'TEXT', late: 'INTEGER NOT NULL DEFAULT 0', refund_reason: 'TEXT'
};
addColumns('order_days', { feedback_reasons: 'TEXT', ...DAY_FULFILMENT });
addColumns('business_days', { ...DAY_FULFILMENT, refund: 'INTEGER NOT NULL DEFAULT 0' });
addColumns('orders', { payment_status: "TEXT NOT NULL DEFAULT 'captured_demo'" });
addColumns('business_orders', { payment_status: "TEXT NOT NULL DEFAULT 'captured_demo'" });
/* capabilities: JSON { glutenFree, nutFree, dairyFree, eggFree, vegan, sesameFree, soyFree, peanutFree }.
   status: Active | Under Review | Suspended — only Active partners are allocated (MB-BKY-001). */
addColumns('bakeries', { capabilities: 'TEXT', status: "TEXT NOT NULL DEFAULT 'Active'" });
/* Admin → Bakeries (MB-BKY-001 §6, §10): effective capacity Morning Box allocates up to,
   approved products (null = every Morning Box product), Fruit Danish variants, contact,
   status note and the bakery's own access code for the Bakery View. */
addColumns('bakeries', {
  effective_capacity: 'INTEGER', products: 'TEXT', danish_flavours: 'TEXT', contact_name: 'TEXT', contact_phone: 'TEXT',
  status_note: 'TEXT', access_hash: 'TEXT', updated_at: 'TEXT'
});
/* Session expiry (sliding), OTP abuse limits, payment idempotency, safety review, profile notes. */
addColumns('sessions', { expires_at: 'INTEGER' });
addColumns('otp_codes', { sends: 'INTEGER NOT NULL DEFAULT 0', window_start: 'INTEGER', last_sent: 'INTEGER', failures: 'INTEGER NOT NULL DEFAULT 0' });
addColumns('orders', { idempotency_key: 'TEXT', credit_used: 'REAL NOT NULL DEFAULT 0' });
addColumns('business_orders', { idempotency_key: 'TEXT' });
addColumns('order_days', { safety_hold: 'INTEGER NOT NULL DEFAULT 0', feedback_note: 'TEXT', feedback_at: 'TEXT' });
addColumns('profiles', { other_allergies: 'TEXT' });
/* Terms acceptance, marketing consent; rating/feedback_tags are no longer written (kept for old rows). */
addColumns('users', { terms_version: 'TEXT', terms_accepted_at: 'TEXT', marketing_opt_in: 'INTEGER NOT NULL DEFAULT 0' });
addColumns('order_days', { rating: 'INTEGER', feedback_tags: 'TEXT', late_note: 'TEXT' });
addColumns('business_days', { late_note: 'TEXT' });
/* Fulfilment detail: per-bakery parts, timestamps for Ready-on-Time and Pickup vs Courier delay, at-risk flag, route. */
const FULFIL_DETAIL = { part_states: 'TEXT', ready_at: 'TEXT', handed_over_at: 'TEXT', picked_up_at: 'TEXT', at_risk: 'INTEGER NOT NULL DEFAULT 0', route_id: 'TEXT' };
addColumns('order_days', FULFIL_DETAIL);
addColumns('business_days', FULFIL_DETAIL);
addColumns('bakeries', { ready_lead_minutes: 'INTEGER NOT NULL DEFAULT 30', licence_no: 'TEXT', licence_expiry: 'TEXT', bakes_own_bread: 'INTEGER NOT NULL DEFAULT 0', payout_pct: 'REAL NOT NULL DEFAULT 60' });
addColumns('exceptions', {
  category: 'TEXT', priority: 'INTEGER NOT NULL DEFAULT 3', owner: 'TEXT', action: 'TEXT', resolution: 'TEXT',
  cause: 'TEXT', responsible_party: 'TEXT', customer_category: 'TEXT', resolved_at: 'TEXT'
});

db.exec(`
CREATE TABLE IF NOT EXISTS delivery_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_kind TEXT NOT NULL,
  day_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS handovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_kind TEXT NOT NULL,
  day_id INTEGER NOT NULL,
  bakery_id INTEGER NOT NULL REFERENCES bakeries(id),
  boxes INTEGER NOT NULL,
  special_boxes INTEGER NOT NULL DEFAULT 0,
  ready_by TEXT,
  route_id TEXT,
  picked_up_at TEXT
);
/* Outbox: an SMS / email / push provider consumes undelivered rows. */
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  ref TEXT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);
CREATE TABLE IF NOT EXISTS customer_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  order_id TEXT NOT NULL,
  date TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  exception_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
/* Help & support requests; operations replies in the ops console. */
CREATE TABLE IF NOT EXISTS support_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  topic TEXT NOT NULL,
  order_ref TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  reply TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  replied_at TEXT
);
/* What happened to each morning, in order: shown to the customer as the order's activity. */
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  date TEXT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
/* Days Morning Box does not deliver (public holidays, closures). */
CREATE TABLE IF NOT EXISTS closed_dates (
  date TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT 'Closed'
);
CREATE TABLE IF NOT EXISTS nps_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  score INTEGER NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payment_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_day_id INTEGER NOT NULL REFERENCES order_days(id),
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
/* Onboarding sample production results per product (MB-BKY-001 §8). */
CREATE TABLE IF NOT EXISTS bakery_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bakery_id INTEGER NOT NULL REFERENCES bakeries(id),
  product TEXT NOT NULL,
  result TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
/* Temporary conditions a bakery reports for a date (MB-BKY-001 §6). */
CREATE TABLE IF NOT EXISTS bakery_conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bakery_id INTEGER NOT NULL REFERENCES bakeries(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  item TEXT,
  capacity INTEGER,
  need TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
/* Partner status changes and corrective actions (MB-BKY-001 §10). */
CREATE TABLE IF NOT EXISTS bakery_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bakery_id INTEGER NOT NULL REFERENCES bakeries(id),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
/* Product analytics for the MVP KPIs (Master Plan §15): funnel steps and no-match events. */
CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  user_id INTEGER,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS business_payment_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_day_id INTEGER NOT NULL REFERENCES business_days(id),
  amount REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/* Indexes for the hot paths: capacity checks, order lists, sessions, outbox. */
db.exec(`
CREATE INDEX IF NOT EXISTS idx_order_days_date_window ON order_days(date, window, cancelled);
CREATE INDEX IF NOT EXISTS idx_business_days_date_window ON business_days(date, window, cancelled);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_business_orders_user ON business_orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_exceptions_open ON exceptions(ref, kind, resolved);
CREATE INDEX IF NOT EXISTS idx_support_user ON support_requests(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idem ON orders(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_orders_idem ON business_orders(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
`);

/* Partner reliability log (MB-BKY-001 §9): a bakery's Delayed / Unable to Fulfil reports stay
   on its record even after the order is reallocated to another bakery. */
db.exec(`
CREATE TABLE IF NOT EXISTS bakery_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bakery_id INTEGER NOT NULL REFERENCES bakeries(id),
  date TEXT NOT NULL,
  day_kind TEXT NOT NULL,
  day_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bakery_events ON bakery_events(bakery_id, date);
`);

/* Couriers (MB-OPS-001 §6, MB-DLV-001 §4): one courier per route, each with its own
   access code for the Courier View. Deliveries carry the route id ops assigns the night before. */
db.exec(`
CREATE TABLE IF NOT EXISTS couriers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  route_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
  access_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
/* Optional capacity per delivery window, JSON { w1, w2, w3 } (MB-B2B-001 §9; DLV §7).
   NULL = only the daily capacity applies. */
addColumns('bakeries', { window_capacity: 'TEXT' });

/* Launch partner set for the DIFC pilot (MB-BKY-001). Names are placeholders
   until partner agreements are signed. */
if (db.prepare('SELECT COUNT(*) AS n FROM bakeries').get().n === 0) {
  const ins = db.prepare('INSERT INTO bakeries (name, area, distance_km, daily_capacity, gluten_free_certified) VALUES (?, ?, ?, ?, ?)');
  ins.run('Partner Bakery A', 'DIFC', 0.6, 120, 1);
  ins.run('Partner Bakery B', 'Downtown Dubai', 2.1, 150, 0);
  ins.run('Partner Bakery C', 'Business Bay', 3.4, 200, 1);
}
/* Capability placeholders for the launch partners until their allergen-control
   audits are on file (MB-BKY-001). Unknown bakeries fall back to their
   gluten-free certification only. */
const ALL_CAPS = ['glutenFree', 'nutFree', 'dairyFree', 'eggFree', 'vegan', 'sesameFree', 'soyFree', 'peanutFree'];
const caps = on => Object.fromEntries(ALL_CAPS.map(k => [k, on.includes(k)]));
const PLACEHOLDER_CAPS = {
  'Partner Bakery A': caps(ALL_CAPS),
  'Partner Bakery B': caps(['dairyFree', 'eggFree', 'vegan', 'soyFree']),
  'Partner Bakery C': caps(['glutenFree', 'dairyFree', 'eggFree', 'vegan', 'sesameFree', 'soyFree'])
};
for (const b of db.prepare('SELECT id, name, gluten_free_certified FROM bakeries WHERE capabilities IS NULL').all()) {
  const c = PLACEHOLDER_CAPS[b.name] || caps(b.gluten_free_certified ? ['glutenFree'] : []);
  db.prepare('UPDATE bakeries SET capabilities = ? WHERE id = ?').run(JSON.stringify(c), b.id);
}

/* Placeholder onboarding facts for the launch partners until real records are entered in Admin. */
db.prepare("UPDATE bakeries SET bakes_own_bread = 1, licence_no = COALESCE(licence_no, 'PENDING') WHERE name IN ('Partner Bakery A', 'Partner Bakery B', 'Partner Bakery C') AND bakes_own_bread = 0").run();
/* Placeholder Fruit Danish variants for the launch partners (MB-PRO-001 §14.2) until confirmed in Admin. */
const PLACEHOLDER_DANISH = { 'Partner Bakery A': ['Apple', 'Berry', 'Apricot'], 'Partner Bakery B': ['Apple', 'Berry'], 'Partner Bakery C': ['Apricot'] };
for (const b of db.prepare('SELECT id, name FROM bakeries WHERE danish_flavours IS NULL').all()) {
  db.prepare('UPDATE bakeries SET danish_flavours = ? WHERE id = ?').run(JSON.stringify(PLACEHOLDER_DANISH[b.name] || []), b.id);
}

export const json = v => JSON.stringify(v ?? null);

/** Record something that happened to an order (shown as its activity). */
export function logEvent(orderId, date, kind, message) {
  db.prepare('INSERT INTO order_events (order_id, date, kind, message) VALUES (?, ?, ?, ?)').run(orderId, date ?? null, kind, String(message).slice(0, 300));
}
export const parse = s => (s == null ? null : JSON.parse(s));

/** Run fn inside a transaction; rolls back on throw. */
export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* Route capacity: most boxes one courier carries in a delivery window; null = no limit (MB-OPS-001 §6). */
addColumns('couriers', { capacity: 'INTEGER' });
/* Optional photo on a customer's problem report (MB-OPS-001 §10), a small data URL. */
addColumns('customer_issues', { photo: 'TEXT' });
/* Optional proof-of-delivery photo from the courier (MB-DLV-001 §10: "Photo proof may be used operationally
   where supported, without requiring a photograph of the customer"), a small data URL. */
addColumns('order_days', { delivery_photo: 'TEXT' });
addColumns('business_days', { delivery_photo: 'TEXT' });
