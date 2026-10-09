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

/* Launch partner set for the DIFC pilot (MB-BKY-001). Names are placeholders
   until partner agreements are signed. */
if (db.prepare('SELECT COUNT(*) AS n FROM bakeries').get().n === 0) {
  const ins = db.prepare('INSERT INTO bakeries (name, area, distance_km, daily_capacity, gluten_free_certified) VALUES (?, ?, ?, ?, ?)');
  ins.run('Partner Bakery A', 'DIFC', 0.6, 120, 1);
  ins.run('Partner Bakery B', 'Downtown Dubai', 2.1, 150, 0);
  ins.run('Partner Bakery C', 'Business Bay', 3.4, 200, 1);
}

export const json = v => JSON.stringify(v ?? null);
export const parse = s => (s == null ? null : JSON.parse(s));

/** Run fn inside a transaction; rolls back on throw. */
export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
