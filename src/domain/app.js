/* App-level helpers on top of the locked engine (engine.js, library.js,
   recipes.js, standards.js are the MVP implementations of the standards and
   are used unchanged). */
import { recommend, configure, priceBox, hasSizeSelector, addonPrice } from './engine.js';
import { COMPONENTS, portion } from './library.js';
import { recipeById } from './recipes.js';
import {
  EATING_STYLES, PREFERENCES, DIETARY, ALLERGENS, CONTEXTS, DELIVERY_WINDOWS,
  orderableDates, isoDate, cutoffFor, isBeforeCutoff, SIZE_ADJUSTMENT, PRICE_LEVELS
} from './standards.js';
import { priceLevel } from './recipes.js';

export { EATING_STYLES, PREFERENCES, DIETARY, ALLERGENS, CONTEXTS, DELIVERY_WINDOWS, cutoffFor, isBeforeCutoff };

/* ---------- Dates: always the exact date, never the weekday alone ---------- */
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MOL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function dateInfo(iso) {
  const d = new Date(iso + 'T00:00:00');
  return {
    iso, date: d,
    wd: WD[d.getDay()], day: d.getDate(), mon: MO[d.getMonth()],
    short: `${WD[d.getDay()]} ${d.getDate()}`,
    label: `${WD[d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}`,
    long: `${WDL[d.getDay()]}, ${d.getDate()} ${MOL[d.getMonth()]}`
  };
}

/** Two planning weeks starting at the first orderable morning (9 PM cutoff applied). */
export function planningWeeks(now = new Date(), weeks = 4) {
  const dates = orderableDates(now, weeks * 7).map(d => dateInfo(isoDate(d)));
  return Array.from({ length: weeks }, (_, i) => dates.slice(i * 7, i * 7 + 7));
}

export const todayIso = () => isoDate(new Date());

export function cutoffLabel(iso) {
  const c = cutoffFor(iso);
  const sameDay = isoDate(c) === todayIso();
  return sameDay ? '9:00 PM tonight' : `9:00 PM, ${dateInfo(isoDate(c)).label}`;
}

export function timeLeft(iso, now = new Date()) {
  const ms = cutoffFor(iso) - now;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
  return h > 47 ? `${Math.floor(h / 24)} days` : `${h}h ${m}m`;
}

/* ---------- Vocabulary lookups ---------- */
const find = (list, id) => list.find(x => x.id === id);
export const eatingLabel = id => find(EATING_STYLES, id)?.label || '';
export const prefLabel = id => find(PREFERENCES, id)?.label || '';
export const dietLabel = id => find(DIETARY, id)?.label || '';
export const allergyLabel = id => find(ALLERGENS, id)?.label || '';
export const contextLabel = id => find(CONTEXTS, id)?.label || '';
export const windowLabel = id => find(DELIVERY_WINDOWS, id)?.label || '';
export const componentName = id => COMPONENTS[id]?.name || id;

const CATEGORY_ICON = {
  'Egg & Hot Savory': 'egg', 'Savory Protein': 'sausage', 'Bread': 'bread', 'Pastry': 'croissant',
  'Fresh Savory': 'leaf', 'Fruit': 'fruit', 'Dairy & Cheese': 'cheese', 'Grains & Bowls': 'bowl', 'Spreads': 'jar'
};
const ID_ICON = { avocado: 'avocado', tomato: 'tomato', greekYogurt: 'bowl' };
export const componentIcon = id => ID_ICON[id] || CATEGORY_ICON[COMPONENTS[id]?.category] || 'box';
export const componentPortion = (id, size) => portion(id, size === 'standard' ? 'regular' : size);

/* ---------- Day configuration (stored without object references) ---------- */
export function hydrate(cfg, profile) {
  if (!cfg) return null;
  return { ...cfg, recipe: recipeById[cfg.recipeId], profile };
}

export function serialize(config, context, which) {
  return {
    recipeId: config.recipe.id, context, which,
    components: config.components.slice(), substitutions: config.substitutions || [],
    userSwaps: config.userSwaps || [], size: config.size, addons: config.addons || [],
    label: config.label, format: config.recipe.format || null
  };
}

/** Runs the deterministic engine for one morning. */
export function recommendDay(profile, context) {
  const res = recommend(profile, context);
  if (!res.primary) return { none: true, message: res.message };
  const primary = configure(res.primary, profile);
  const alternative = res.alternative ? configure(res.alternative, profile) : null;
  return {
    none: false,
    primary: serialize(primary, context, 'primary'),
    alternative: alternative ? serialize(alternative, context, 'alternative') : null
  };
}

export const dayPrice = (cfg, profile) => priceBox(hydrate(cfg, profile));
export const sizePrice = (cfg, size) => {
  const base = PRICE_LEVELS[priceLevel(recipeById[cfg.recipeId])];
  return base + (hasSizeSelector(recipeById[cfg.recipeId]) ? SIZE_ADJUSTMENT[size] : 0);
};
export const canChooseSize = cfg => hasSizeSelector(recipeById[cfg.recipeId]);
export { addonPrice };

/** A short, honest description built from the box composition. */
export function boxTitle(cfg) {
  if (!cfg) return '';
  const names = cfg.components.slice(0, 3).map(id => componentName(id).replace(/^Halal /, ''));
  const s = names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}` : names[0];
  return s.charAt(0) + s.slice(1).toLowerCase();
}
/**
 * Display name derived from the breakfast's own preference and morning type
 * (e.g. "The Savory Workday"). Ready-to-eat Busy boxes are named by their
 * contents (e.g. "Cheese Croissant & Banana"). No marketing claims.
 */
const PREF_WORD = { savory: 'Savory', bakery: 'Bakery', fresh: 'Fresh', sweet: 'Sweet' };
export function boxName(cfg) {
  if (!cfg) return '';
  const r = recipeById[cfg.recipeId];
  const p = PREF_WORD[r?.preference] || '';
  switch (cfg.context || r?.context) {
    case 'regular': return `The ${p} Workday`;
    case 'active': return `The Active ${p}`;
    case 'relaxed': return `The Relaxed ${p}`;
    default: {
      const n = cfg.components.slice(0, 2).map(id => componentName(id).replace(/^Halal /, ''));
      return n.join(' & ');
    }
  }
}
/** Short place name for compact lines: "Gate Village, Building 3" → "Gate Village 3". */
export const shortPlace = b => (b || '').replace(/,?\s*(Building|Bldg\.?|Tower)\s+/i, ' ').trim();
export const sizeLabel = s => ({ light: 'Light', regular: 'Regular', large: 'Large', standard: 'Standard' }[s] || s);

export function extrasText(addons) {
  if (!addons?.length) return '';
  return addons.map(a => `${componentName(a.item)}${a.group === 'bread' ? ` (${a.unit} loaf)` : ''} × ${a.qty}`).join(', ');
}

/* ---------- Customer-facing tracking (MB-DLV-001 §5) ----------
   Order Confirmed → Being Prepared → Out for Delivery → Delivered.
   In this demo the status is derived from the clock and the chosen window;
   a demo control can advance it. */
const WINDOW_START = { w1: [7, 30], w2: [8, 30], w3: [9, 30] };
export function trackingStage(day, now = new Date()) {
  if (day.cancelled) return -1;
  if (typeof day.stage === 'number') return day.stage;          // authoritative, from the server
  if (typeof day.demoStage === 'number') return day.demoStage;
  const [h, m] = WINDOW_START[day.window] || [8, 30];
  const d = new Date(day.date + 'T00:00:00');
  const prep = new Date(d); prep.setHours(6, 0, 0, 0);
  const out = new Date(d); out.setHours(h, m - 15, 0, 0);
  const done = new Date(d); done.setHours(h + 1, m, 0, 0);
  if (now >= done) return 3;
  if (now >= out) return 2;
  if (now >= prep) return 1;
  return 0;
}
export const STAGES = ['Order confirmed', 'Being prepared', 'Out for delivery', 'Delivered'];

export const newId = prefix => `${prefix}-${Math.floor(10000 + Math.random() * 89999)}`;
