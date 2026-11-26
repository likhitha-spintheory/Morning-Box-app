/* ---------- Launch discounts (Morning Box Launch Discount Requirements v1.0, 25 Nov 2026) ----------
   One module for the app and the server, so the price shown is the price charged.

   Automatic discounts, decided per delivery day:
   - First order: 50% on the first scheduled delivery day of the customer's first order (personal or business).
   - Multi-day:   by the number of ordered delivery days in the order (not the calendar span).
   - Volume:      Business only, by the number of breakfasts on that day.
   Only the highest eligible automatic discount applies to a day; percentages are never added (§04).
   Discounts apply to breakfast charges only (delivery is included and never discounted).

   Promotional codes (§05) are set up in Admin. A code is a percentage or a fixed AED amount.
   - Combinable: it applies after the automatic discount (a percentage of what is left; a fixed amount
     taken from the first days onward).
   - Not combinable: the order gets either the automatic discounts or the code, whichever saves more.

   The admin settings below are the defaults; applyDiscounts() replaces them with the saved ones.
   Each ordered day keeps a "basis" (what it qualified for when ordered), so a later edit of that day
   re-prices it with the same discounts. */

export const DISCOUNTS = {
  firstOrder: { enabled: true, pct: 0.5, personal: true, business: true },
  multiDay: {
    enabled: true, personal: true, business: true,
    tiers: [{ min: 21, pct: 0.2 }, { min: 10, pct: 0.15 }, { min: 5, pct: 0.1 }, { min: 3, pct: 0.05 }]
  },
  volume: {
    enabled: true, business: true,
    tiers: [{ min: 100, pct: 0.2 }, { min: 50, pct: 0.15 }, { min: 25, pct: 0.1 }, { min: 10, pct: 0.05 }]
  }
};

const clone = v => JSON.parse(JSON.stringify(v));
export const DEFAULT_DISCOUNTS = clone(DISCOUNTS);
export const discountsSnapshot = () => clone(DISCOUNTS);

const cleanTiers = (list, fallback) => (Array.isArray(list)
  ? list.filter(t => Number.isInteger(t?.min) && t.min > 0 && Number.isFinite(t?.pct) && t.pct > 0 && t.pct < 1)
    .sort((a, b) => b.min - a.min).map(t => ({ min: t.min, pct: t.pct }))
  : fallback);

/** Replace the settings in place (the saved Admin settings, or the config the server sends the app). */
export function applyDiscounts(d) {
  if (!d || typeof d !== 'object') return;
  const bool = (v, f) => (typeof v === 'boolean' ? v : f);
  const f = d.firstOrder || {}, m = d.multiDay || {}, v = d.volume || {};
  Object.assign(DISCOUNTS.firstOrder, {
    enabled: bool(f.enabled, DISCOUNTS.firstOrder.enabled),
    pct: Number.isFinite(f.pct) && f.pct > 0 && f.pct <= 1 ? f.pct : DISCOUNTS.firstOrder.pct,
    personal: bool(f.personal, DISCOUNTS.firstOrder.personal), business: bool(f.business, DISCOUNTS.firstOrder.business)
  });
  Object.assign(DISCOUNTS.multiDay, {
    enabled: bool(m.enabled, DISCOUNTS.multiDay.enabled),
    personal: bool(m.personal, DISCOUNTS.multiDay.personal), business: bool(m.business, DISCOUNTS.multiDay.business),
    tiers: cleanTiers(m.tiers, DISCOUNTS.multiDay.tiers)
  });
  Object.assign(DISCOUNTS.volume, {
    enabled: bool(v.enabled, DISCOUNTS.volume.enabled), business: bool(v.business, DISCOUNTS.volume.business),
    tiers: cleanTiers(v.tiers, DISCOUNTS.volume.tiers)
  });
}

const tierPct = (tiers, n) => tiers.find(t => n >= t.min)?.pct || 0;
/** Multi-day rate for an order with `days` delivery days ('personal' | 'business'). */
export const multiDayPct = (kind, days) => (DISCOUNTS.multiDay.enabled && DISCOUNTS.multiDay[kind] ? tierPct(DISCOUNTS.multiDay.tiers, days) : 0);
/** Business volume rate for `boxes` breakfasts on one day. */
export const volumePct = (kind, boxes) => (kind === 'business' && DISCOUNTS.volume.enabled && DISCOUNTS.volume.business ? tierPct(DISCOUNTS.volume.tiers, boxes) : 0);
/** First-order rate for this kind of order, when the customer is eligible. */
export const firstOrderPct = (kind, eligible) => (eligible && DISCOUNTS.firstOrder.enabled && DISCOUNTS.firstOrder[kind] ? DISCOUNTS.firstOrder.pct : 0);

export const LABELS = { first: 'First-order discount', multi: 'Multi-day discount', volume: 'Volume discount', promo: 'Promo code' };
const pctText = p => `${Math.round(p * 1000) / 10}%`;

/**
 * Price one delivery day from its basis.
 * basis: { first: pct, multi: pct, auto: bool, promo: { code, type: 'percent'|'fixed', value, combinable, maxDiscount? } | null, promoFixed: AED for this day }
 * Returns { gross, discount, total, lines: [{ kind, label, pct?, amount }] } in whole dirhams.
 */
export function priceDay(basis, gross, { kind = 'personal', boxes = 1 } = {}) {
  const g = Math.max(0, Math.round(gross));
  const b = basis || {};
  const lines = [];
  let left = g;
  if (b.auto !== false) {
    const cands = [['first', b.first || 0], ['multi', b.multi || 0], ['volume', volumePct(kind, boxes)]].filter(c => c[1] > 0);
    const best = cands.sort((x, y) => y[1] - x[1])[0];
    if (best) {
      const amount = Math.min(left, Math.round(g * best[1]));
      if (amount > 0) { lines.push({ kind: best[0], label: LABELS[best[0]], pct: best[1], amount }); left -= amount; }
    }
  }
  const p = b.promo;
  if (p) {
    const amount = Math.min(left, p.type === 'percent' ? Math.round(left * p.value) : Math.round(b.promoFixed || 0));
    if (amount > 0) { lines.push({ kind: 'promo', label: `${LABELS.promo} ${p.code}`, pct: p.type === 'percent' ? p.value : undefined, amount }); left -= amount; }
  }
  return { gross: g, discount: g - left, total: left, lines };
}

/** The basis for every day of a new order, sorted by date. days: [{ date, gross, boxes }]. */
function bases(kind, days, firstEligible, promo, auto) {
  const order = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const first = firstOrderPct(kind, firstEligible);
  const multi = multiDayPct(kind, days.length);
  return order.map((d, i) => ({ date: d.date, basis: { first: i === 0 ? first : 0, multi, auto, promo: promo || null, promoFixed: 0 } }));
}

/** Spread a fixed AED promo over the days in date order, after their automatic discounts.
    `maxDiscount` caps a percentage promo for the whole order the same way. */
function spreadFixed(list, days, kind, amount) {
  let rest = Math.round(amount);
  for (const x of list) {
    const d = days.find(y => y.date === x.date);
    const before = priceDay({ ...x.basis, promo: null }, d.gross, { kind, boxes: d.boxes }).total;
    const take = Math.min(before, rest);
    x.basis.promoFixed = take; rest -= take;
  }
}

/** Percentage promo with an order cap: turn it into a fixed amount equal to the capped saving. */
function capPercent(list, days, kind, promo) {
  const uncapped = list.reduce((t, x) => {
    const d = days.find(y => y.date === x.date);
    const r = priceDay(x.basis, d.gross, { kind, boxes: d.boxes });
    return t + (r.lines.find(l => l.kind === 'promo')?.amount || 0);
  }, 0);
  if (!(promo.maxDiscount > 0) || uncapped <= promo.maxDiscount) return;
  list.forEach(x => { x.basis.promo = { ...promo, type: 'fixed', value: promo.maxDiscount }; });
  spreadFixed(list, days, kind, promo.maxDiscount);
}

function build(kind, days, firstEligible, promo, auto) {
  const list = bases(kind, days, firstEligible, promo, auto);
  if (promo?.type === 'fixed') spreadFixed(list, days, kind, promo.value);
  else if (promo?.type === 'percent') capPercent(list, days, kind, promo);
  const priced = list.map(x => {
    const d = days.find(y => y.date === x.date);
    return { date: x.date, basis: x.basis, ...priceDay(x.basis, d.gross, { kind, boxes: d.boxes }) };
  });
  return { days: priced, gross: priced.reduce((t, d) => t + d.gross, 0), discount: priced.reduce((t, d) => t + d.discount, 0), total: priced.reduce((t, d) => t + d.total, 0) };
}

/**
 * Price a whole new order.
 * kind: 'personal' | 'business'; days: [{ date, gross, boxes }]; firstEligible: the customer has no earlier order;
 * promo: a validated code ({ code, type, value, combinable, maxDiscount, minOrder }) or null.
 * Returns { days: [{ date, basis, gross, discount, total, lines }], gross, discount, total, promo: { applied, reason } }.
 */
export function priceOrder(kind, days, { firstEligible = false, promo = null } = {}) {
  const autoOnly = build(kind, days, firstEligible, null, true);
  if (!promo) return { ...autoOnly, promo: null };
  if (promo.minOrder > 0 && autoOnly.gross < promo.minOrder) return { ...autoOnly, promo: { applied: false, code: promo.code, reason: `This code needs an order of at least AED ${promo.minOrder}.` } };
  if (promo.combinable) {
    const r = build(kind, days, firstEligible, promo, true);
    return { ...r, promo: { applied: r.discount > autoOnly.discount, code: promo.code, reason: r.discount > autoOnly.discount ? null : 'This code doesn’t lower this order’s price.' } };
  }
  const promoOnly = build(kind, days, firstEligible, promo, false);
  if (promoOnly.discount > autoOnly.discount) return { ...promoOnly, promo: { applied: true, code: promo.code, reason: null, replaces: autoOnly.discount > 0 } };
  return { ...autoOnly, promo: { applied: false, code: promo.code, reason: 'Your current discount saves more than this code, so we kept it. Codes can’t be combined with other discounts.' } };
}

/** Totals by kind of discount for an order summary: [{ kind, label, amount, pct? }] (pct only when every day had the same rate). */
export function discountSummary(days) {
  const by = new Map();
  for (const d of days) for (const l of d.lines || []) {
    const key = l.kind === 'promo' ? l.label : l.kind;
    const cur = by.get(key) || { kind: l.kind, label: l.label, amount: 0, pcts: new Set() };
    cur.amount += l.amount; cur.pcts.add(l.pct);
    by.set(key, cur);
  }
  const order = ['first', 'multi', 'volume', 'promo'];
  return [...by.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map(x => ({ kind: x.kind, label: x.pcts.size === 1 && [...x.pcts][0] ? `${x.label} (${pctText([...x.pcts][0])})` : x.label, amount: x.amount }));
}

/** One line for a day: "First-order discount 50%" etc. */
export const dayDiscountText = lines => (lines || []).map(l => `${l.label}${l.pct ? ` ${pctText(l.pct)}` : ''}`).join(' + ');
export { pctText };
