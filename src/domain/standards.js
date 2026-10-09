/* ============================================================
   standards.js — Controlled vocabularies and decision tables
   Implements:
     MB-PER-001  Personalization & Morning Profile (the 3 questions)
     MB-BOX-001  Product & Menu (contexts, dietary/allergy rules)
     MB-REC-001  Recommendation & Decision Logic (context priority)
     MB-DLV-001  Delivery & Fulfilment (cutoff, windows)
   Every value below is taken from a LOCKED standard. Nothing here
   is invented; where a standard defers a number, it is marked.
   ============================================================ */

export const CURRENCY = 'AED';

/* ---------- MB-PER-001 Q1 · Eating Style ---------- */
export const EATING_STYLES = [
  { id: 'health',   label: 'Health-Conscious',
    blurb: 'I usually prefer wholesome, balanced and less processed foods.' },
  { id: 'flexible', label: 'Flexible',
    blurb: "I enjoy a wider variety and don't limit myself to health-focused choices." }
];

/* ---------- MB-PER-001 Q2 · Breakfast Preference (multi-select) ---------- */
export const PREFERENCES = [
  { id: 'savory', label: 'Savory Breakfast',  blurb: 'Eggs, bread, fresh vegetables.' },
  { id: 'bakery', label: 'Bakery & Pastry',    blurb: 'Fresh bakery with spreads and fruit.' },
  { id: 'fresh',  label: 'Fresh & Wholesome', blurb: 'Yogurt, oats, granola, fruit.' },
  { id: 'sweet',  label: 'Sweet Breakfast',   blurb: 'A naturally sweeter start.' }
];

/* ---------- MB-PER-001 Q3 · Dietary requirements and allergies ----------
   Two clearly separated areas on one screen. Both multi-select.
   Safety restrictions always override preferences. */
export const DIETARY = [
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'vegan',      label: 'Vegan' },
  { id: 'dairyFree',  label: 'Dairy-Free' },
  { id: 'glutenFree', label: 'Gluten-Free', special: true },
  { id: 'halal',      label: 'Halal only' }
];

/* An allergy is a HARD safety filter. An allergen-restricted item must not
   appear in a recommendation, a swap or an add-on (MB-BOX-001 §9). */
export const ALLERGENS = [
  { id: 'gluten',  label: 'Gluten / Wheat' },
  { id: 'dairy',   label: 'Milk / Dairy' },
  { id: 'egg',     label: 'Egg' },
  { id: 'peanut',  label: 'Peanut' },
  { id: 'treenut', label: 'Tree nuts' },
  { id: 'sesame',  label: 'Sesame' },
  { id: 'soy',     label: 'Soy' }
];

/* ---------- MB-PER-001 §2 · Daily Morning Context ---------- */
export const CONTEXTS = [
  { id: 'active',  label: 'Active Morning',    blurb: 'A more active or physically demanding morning.' },
  { id: 'regular', label: 'Regular Workday',   blurb: 'A typical workday morning.' },
  { id: 'busy',    label: 'Busy & On the Go',  blurb: 'Time-sensitive. Convenience matters.' },
  { id: 'relaxed', label: 'Relaxed Morning',   blurb: 'Less rushed, with more flexibility.' }
];

/* ---------- MB-REC-001 §7 · Context priority (tie-break only) ----------
   Used ONLY when the user selected multiple Breakfast Preferences and more
   than one eligible candidate remains. It never introduces a Preference the
   user did not select. */
export const CONTEXT_PRIORITY = {
  active:  ['savory', 'fresh',  'bakery', 'sweet'],
  regular: ['savory', 'fresh',  'bakery', 'sweet'],
  busy:    ['bakery', 'savory', 'sweet',  'fresh'],
  relaxed: ['savory', 'bakery', 'fresh',  'sweet']
};

/* ---------- MB-REC-001 §15.1 · Internal reason codes ----------
   Backend / analytics only. Never shown to the customer. */
export const REASON = {
  PRIMARY: 'PRIMARY_CONTEXT_PRIORITY',
  SECONDARY: 'SECONDARY_ELIGIBLE_OPTION',
  SUBSTITUTION: 'SYSTEM_DIETARY_SUBSTITUTION',
  NONE: 'NO_ELIGIBLE_RECOMMENDATION'
};

/* ---------- MB-PRO-001 §2 · Size ----------
   Size changes quantity, not composition. Regular is the reference size. */
export const SIZES = [
  { id: 'light',   label: 'Light' },
  { id: 'regular', label: 'Regular', def: true },
  { id: 'large',   label: 'Large' }
];

/* ---------- MB-DLV-001 §2–3 · Cutoff and delivery windows ---------- */
export const CUTOFF_HOUR = 21;                 // 21:00 the previous day
export const DELIVERY_WINDOWS = [
  { id: 'w1', label: '7:30 – 8:30 AM' },
  { id: 'w2', label: '8:30 – 9:30 AM' },
  { id: 'w3', label: '9:30 – 10:30 AM' }
];

/* ---------- MB-DLV-001 §5 · Customer-facing tracking ----------
   Deliberately simple. Richer states exist in operations. */
export const CUSTOMER_STATUS = ['Order Confirmed', 'Being Prepared', 'Out for Delivery', 'Delivered'];

/* ---------- MB-OPS-001 §5–7 · Operational states ---------- */
export const BAKERY_STATES   = ['Assigned', 'Confirmed', 'In Preparation', 'Ready', 'Handed Over'];
export const DELIVERY_STATES = ['Picked Up', 'Out for Delivery', 'Delivered'];
export const EXCEPTION_KINDS = [
  'Product/Ingredient Unavailable', 'Capacity Issue', 'Dietary/Allergy Issue',
  'Equipment/Operational Issue', 'Courier Delay', 'Location Unavailable', 'Other'
];

/* ---------- MB-REC-001 §14 · Feedback ---------- */
export const FEEDBACK = ['Loved it', 'Not for me'];

/* ============================================================
   Pricing architecture — MB-BOX-001 §8
     Breakfast Base Price + Size Adjustment + Add-ons = Final Price
   The standard is explicit: "Actual AED prices remain TBD pending
   component costing, bakery economics, packaging, Morning Box margin
   and delivery economics."
   The ARCHITECTURE below is implemented exactly. The NUMBERS are
   indicative placeholders and are labelled as such everywhere they
   appear in the interface.
   ============================================================ */
export const PRICES_ARE_INDICATIVE = true;

/* "Morning Box may use a limited number of internal price levels based on
   product composition and cost; these levels are not shown as user-facing
   budget categories." (MB-BOX-001 §8) */
export const PRICE_LEVELS = { L1: 32, L2: 39, L3: 46, L4: 54 };   // AED, indicative

/* Light is below the Regular base; Large is above it. */
export const SIZE_ADJUSTMENT = { light: -7, regular: 0, large: 11 };   // AED, indicative

export const ADDON_PRICES = {                                     // AED, indicative
  bread: { half: 12, whole: 20 },
  pastry: { 'Plain Croissant': 11, 'Cheese Croissant': 13, 'Pain au Chocolat': 13, 'Fruit Danish': 14, 'Gluten-Free Blueberry Muffin': 15 /* SAMPLE */ }
};

export const DELIVERY_FEE = 0;        // included in MVP pricing, indicative

/* MB-B2B-001 §7 — volume discount exists; tiers are explicitly TBD. */
export const VOLUME_DISCOUNT = [
  { min: 50, pct: 0.10 }, { min: 25, pct: 0.07 }, { min: 10, pct: 0.04 }
];
export function volumeDiscount(qty) {
  const t = VOLUME_DISCOUNT.find(t => qty >= t.min);
  return t ? t.pct : 0;
}

export const fmtAED = n =>
  new Intl.NumberFormat('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n));

/* Dates are always shown with the exact date, never the weekday alone
   (MB-FLW-001 §3). */
export const fmtDate = d => d.toLocaleDateString('en-GB',
  { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtDateLong = d => d.toLocaleDateString('en-GB',
  { weekday: 'long', day: 'numeric', month: 'long' });
/* Local calendar date — toISOString() would shift the day in any timezone
   east or west of UTC, which silently moves every cutoff. */
export const isoDate = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The earliest orderable morning, honouring the 9:00 PM cutoff. */
export function firstOrderableDate(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (now.getHours() >= CUTOFF_HOUR ? 2 : 1));
  return d;
}

/** The orderable horizon: the next 14 mornings from the first available. */
export function orderableDates(now = new Date(), days = 14) {
  const start = firstOrderableDate(now);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i); return d;
  });
}

/** A planned day may be edited or cancelled until 9:00 PM the evening before. */
export function cutoffFor(dateIso) {
  const d = new Date(dateIso + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  d.setHours(CUTOFF_HOUR, 0, 0, 0);
  return d;
}
export const isBeforeCutoff = (dateIso, now = new Date()) => now < cutoffFor(dateIso);
