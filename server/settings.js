/* Admin settings stored in the database: prices (MB-BOX-001 §8, MB-B2B-001 §7)
   and company / support details. Saved values are applied to the shared
   objects in place, so every route prices and prints from the same numbers. */
import { db, json, parse } from './db.js';
import { applyPricing, pricingSnapshot, DEFAULT_PRICING, PRICE_LEVELS, ADDON_PRICES, expandBreadPrices } from '../src/domain/standards.js';
import { SUPPLIER, SUPPORT } from './company.js';
import { LIBRARY_SETTINGS, setLibrarySettings, COMPONENTS } from '../src/domain/library.js';
import { menuSnapshot, applyMenu, validateMenu, DEFAULT_MENU } from '../src/domain/menu.js';
import { SERVICE_AREAS, ACTIVE_AREAS, applyAreas } from '../src/domain/standards.js';
import { bad, DELIVERY_CAPACITY } from './rules.js';

db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
db.exec(`CREATE TABLE IF NOT EXISTS settings_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const read = key => parse(db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null);
function write(key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(key, json(value));
  db.prepare('INSERT INTO settings_history (key, value) VALUES (?, ?)').run(key, json(value));
}

const money = (v, { min = 0, max = 1000 } = {}) => Number.isFinite(v) && v >= min && v <= max && Math.round(v * 100) === v * 100;

/** Validate a full pricing object from the console; throws a 400 with the first problem. */
function validatePricing(p) {
  if (!p || typeof p !== 'object') throw bad('pricing_invalid', 'Send the full price list.');
  for (const k of Object.keys(PRICE_LEVELS)) if (!money(p.priceLevels?.[k], { min: 1 })) throw bad('pricing_invalid', `Price level ${k} must be an amount in AED.`);
  /* MB-BOX-001 §8: Light is priced below Regular and Large above it — never the same. */
  if (!money(p.sizeAdjustment?.light, { min: -500, max: 0 }) || p.sizeAdjustment.light === 0) throw bad('pricing_invalid', 'Light must be priced below Regular (a negative adjustment).');
  if (!money(p.sizeAdjustment?.large, { min: 0 }) || p.sizeAdjustment.large === 0) throw bad('pricing_invalid', 'Large must be priced above Regular (a positive adjustment).');
  const lowest = Math.min(...Object.keys(PRICE_LEVELS).map(k => p.priceLevels[k]));
  if (lowest + p.sizeAdjustment.light <= 0) throw bad('pricing_invalid', 'A Light breakfast would cost nothing — reduce the Light adjustment.');
  /* Each bread has its own half / whole price; a single { half, whole } (older saves) applies to every bread. */
  const bread = expandBreadPrices(p.addons?.bread);
  for (const id of Object.keys(ADDON_PRICES.breads)) for (const k of ['half', 'whole']) {
    if (!money(bread[id]?.[k], { min: 1 })) throw bad('pricing_invalid', `${COMPONENTS[id]?.name || id} ${k} loaf price must be an amount in AED.`);
  }
  for (const k of Object.keys(ADDON_PRICES.pastry)) if (!money(p.addons?.pastry?.[k], { min: 1 })) throw bad('pricing_invalid', `${k} price must be an amount in AED.`);
  if (!Array.isArray(p.volumeDiscount) || p.volumeDiscount.length > 6) throw bad('pricing_invalid', 'Up to 6 discount tiers.');
  for (const t of p.volumeDiscount) {
    if (!Number.isInteger(t?.min) || t.min < 2 || t.min > 999) throw bad('pricing_invalid', 'Each discount tier needs a minimum number of boxes (2–999).');
    if (!Number.isFinite(t?.pct) || t.pct <= 0 || t.pct > 0.5) throw bad('pricing_invalid', 'Discounts must be between 0.1% and 50%.');
  }
  if (new Set(p.volumeDiscount.map(t => t.min)).size !== p.volumeDiscount.length) throw bad('pricing_invalid', 'Two discount tiers have the same minimum.');
  return {
    indicative: !!p.indicative,
    priceLevels: Object.fromEntries(Object.keys(PRICE_LEVELS).map(k => [k, p.priceLevels[k]])),
    sizeAdjustment: { light: p.sizeAdjustment.light, regular: 0, large: p.sizeAdjustment.large },
    addons: { bread: Object.fromEntries(Object.keys(ADDON_PRICES.breads).map(id => [id, { half: bread[id].half, whole: bread[id].whole }])), pastry: Object.fromEntries(Object.keys(ADDON_PRICES.pastry).map(k => [k, p.addons.pastry[k]])) },
    volumeDiscount: p.volumeDiscount.map(t => ({ min: t.min, pct: Math.round(t.pct * 10000) / 10000 })).sort((a, b) => b.min - a.min)
  };
}

export const getPricing = () => pricingSnapshot();
export function savePricing(input) {
  const p = validatePricing(input);
  write('pricing', p);
  applyPricing(p);
  return pricingSnapshot();
}
export function resetPricing() {
  db.prepare("DELETE FROM settings WHERE key = 'pricing'").run();
  applyPricing(DEFAULT_PRICING);
  return pricingSnapshot();
}
export const pricingHistory = () => db.prepare("SELECT value, created_at FROM settings_history WHERE key = 'pricing' ORDER BY id DESC LIMIT 20").all()
  .map(r => ({ at: r.created_at, pricing: parse(r.value) }));

/* ---------- Company & support details ---------- */
const COMPANY_FIELDS = { name: 120, trn: 15, address: 200 };
const SUPPORT_FIELDS = { email: 120, phone: 30, whatsapp: 20, hours: 80 };
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, max) : '');
export const getCompany = () => ({ company: { ...SUPPLIER }, support: { ...SUPPORT } });
export function saveCompany(input = {}) {
  const company = Object.fromEntries(Object.entries(COMPANY_FIELDS).map(([k, max]) => [k, clean(input.company?.[k], max)]));
  const support = Object.fromEntries(Object.entries(SUPPORT_FIELDS).map(([k, max]) => [k, clean(input.support?.[k], max)]));
  company.trn = company.trn.replace(/\D/g, '');
  support.whatsapp = support.whatsapp.replace(/\D/g, '');
  if (!company.name) throw bad('company_invalid', 'Enter the company name.');
  if (company.trn && company.trn.length !== 15) throw bad('trn_invalid', 'The TRN has 15 digits.');
  if (support.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(support.email)) throw bad('email_invalid', 'Enter a valid support email.');
  write('company', { company, support });
  Object.assign(SUPPLIER, company);
  Object.assign(SUPPORT, support);
  return getCompany();
}

/* ---------- Menu rules: food items, the 32 breakfasts, priority (MB-PRO-001 §12, §15.1; MB-REC-001 §7) ----------
   Saved menus apply to the next recommendation; every save records what changed. */
const menuName = (m, id) => m.items[id]?.name || id;
function menuChanges(before, after) {
  const out = [];
  for (const [id, it] of Object.entries(after.items)) {
    const was = before.items[id];
    if (!was) { out.push(`Added item ${it.name}`); continue; }
    for (const [k, label] of [['name', 'name'], ['allergens', 'allergens'], ['diet', 'suitable for'], ['flexibleOnly', 'Flexible only']]) {
      if (JSON.stringify(was[k]) !== JSON.stringify(it[k])) out.push(`${was.name}: ${label} ${JSON.stringify(was[k])} → ${JSON.stringify(it[k])}`);
    }
  }
  for (const id of Object.keys(before.items)) if (!after.items[id]) out.push(`Removed item ${menuName(before, id)}`);
  for (const [id, b] of Object.entries(after.breakfasts)) {
    if (JSON.stringify(before.breakfasts[id]?.components) !== JSON.stringify(b.components)) out.push(`${id}: ${b.components.map(x => menuName(after, x)).join(' + ')}`);
    if ((before.breakfasts[id]?.level || '') !== (b.level || '')) out.push(`${id}: price level ${before.breakfasts[id]?.level || 'Auto'} → ${b.level || 'Auto'}`);
  }
  for (const [c, list] of Object.entries(after.priority)) if (JSON.stringify(before.priority[c]) !== JSON.stringify(list)) out.push(`Priority ${c}: ${list.join(' → ')}`);
  return out;
}
const failMenu = msg => { throw bad('menu_invalid', msg); };
export const getMenu = () => menuSnapshot();
export function saveMenu(input) {
  const m = validateMenu(input, failMenu);
  const before = menuSnapshot();
  applyMenu(m);
  const after = menuSnapshot();
  const changes = menuChanges(before, after);
  if (changes.length) {
    write('menu', after);
    db.prepare('INSERT INTO settings_history (key, value) VALUES (?, ?)').run('menu_changes', json(changes));
  }
  return { menu: after, changes };
}
export function resetMenu() {
  const before = menuSnapshot();
  db.prepare("DELETE FROM settings WHERE key = 'menu'").run();
  applyMenu(DEFAULT_MENU);
  const changes = menuChanges(before, menuSnapshot());
  db.prepare('INSERT INTO settings_history (key, value) VALUES (?, ?)').run('menu_changes', json(['Reset to the approved menu', ...changes]));
  return { menu: menuSnapshot(), changes };
}
export const menuHistory = () => db.prepare("SELECT value, created_at FROM settings_history WHERE key = 'menu_changes' ORDER BY id DESC LIMIT 30").all()
  .map(r => ({ at: r.created_at, changes: parse(r.value) }));

/* ---------- Menu: SAMPLE items (MB-PRO-001 §15.1) ----------
   Testing-only items stay off in production until the client approves their records. */
export const getLibrary = () => ({ samples: LIBRARY_SETTINGS.samples });
export function saveLibrary(input = {}) {
  if (typeof input.samples !== 'boolean') throw bad('samples_invalid', 'Choose on or off.');
  write('library', { samples: input.samples });
  setLibrarySettings({ samples: input.samples });
  return getLibrary();
}

/* ---------- Delivery capacity per window (MB-DLV-001 §8) ---------- */
/* Delivery cost per delivery for the margin view (OPS §9); set by Morning Box. */
export const DELIVERY_COST = { perDelivery: 0 };
export const getDelivery = () => ({ capacity: { ...DELIVERY_CAPACITY }, costPerDelivery: DELIVERY_COST.perDelivery });
export function saveDelivery(input = {}) {
  const cap = {};
  for (const w of Object.keys(DELIVERY_CAPACITY)) {
    const n = Number(input.capacity?.[w]);
    if (!Number.isInteger(n) || n < 0 || n > 5000) throw bad('capacity_invalid', 'Each window needs a whole number of boxes (0–5000).');
    cap[w] = n;
  }
  const cost = Number(input.costPerDelivery ?? DELIVERY_COST.perDelivery);
  if (!Number.isFinite(cost) || cost < 0 || cost > 500) throw bad('cost_invalid', 'Delivery cost must be 0–500 AED.');
  write('delivery', { capacity: cap, costPerDelivery: cost });
  Object.assign(DELIVERY_CAPACITY, cap);
  DELIVERY_COST.perDelivery = cost;
  return getDelivery();
}

/* Apply what was saved when the server starts. */
const savedDelivery = read('delivery');
if (savedDelivery) { Object.assign(DELIVERY_CAPACITY, savedDelivery.capacity); DELIVERY_COST.perDelivery = savedDelivery.costPerDelivery ?? 0; }
setLibrarySettings(read('library') || { samples: process.env.NODE_ENV !== 'production' });
applyPricing(read('pricing'));
/* A saved menu is re-checked on start; one that no longer passes is ignored (approved menu used) rather than half-applied. */
try { const m = read('menu'); if (m) applyMenu(validateMenu(m, failMenu)); } catch (e) { console.error('[menu] Saved menu ignored:', e.message); }
const savedCompany = read('company');
if (savedCompany) { Object.assign(SUPPLIER, savedCompany.company); Object.assign(SUPPORT, savedCompany.support); }

/* ---------- Service areas (MB-PRD-001 §3): Phase 1 DIFC, then Downtown Dubai, then Meydan One ---------- */
export const getAreas = () => ({ areas: SERVICE_AREAS.map(a => ({ ...a, active: ACTIVE_AREAS.includes(a.id) })) });
export function saveAreas(input = {}) {
  const ids = SERVICE_AREAS.map(a => a.id);
  const active = Array.isArray(input.active) ? input.active.filter(id => ids.includes(id)) : [];
  if (!active.length) throw bad('areas_invalid', 'Keep at least one service area switched on.');
  write('areas', active);
  applyAreas(active);
  return getAreas();
}
applyAreas(read('areas') || ['DIFC']);
