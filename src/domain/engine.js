/* ============================================================
   engine.js — Morning Box Recommendation Engine
   Implements MB-REC-001 Recommendation & Decision Logic (LOCKED).

   The four decision stages (§1.2):
     Understand → Filter → Match → Recommend

   Architecture (§1.3):
     User Profile + Daily Context → Safety & Dietary Filter →
     Eating Style Filter → Daily Context Match → Breakfast Preference
     Pool → Eligible Base Recommendations → Your Morning Box +
     Another Option for You

   MVP rule (§1.4):  Same Inputs → Same Recommendation.
   The engine is deterministic and rule-based. No randomness. No
   unsupported AI claims.
   ============================================================ */

import { CONTEXT_PRIORITY, REASON, PRICE_LEVELS, SIZE_ADJUSTMENT, ADDON_PRICES, volumeDiscount } from './standards.js';
import { COMPONENTS, SWAP_GROUPS, NO_DIRECT_SWAP, ADDON_BREAD, ADDON_PASTRY,
         isComponentEligible, portion } from './library.js';
import { BASE_RECOMMENDATIONS, recipeById, describe, priceLevel } from './recipes.js';

/* ============================================================
   §3 Safety & eligibility filter
   Base Recommendation → Component Check → Approved Safe Substitution
   → Eligible / Ineligible
   ============================================================ */

/**
 * MB-PRO-001 §11 — the Combination Compatibility Filter.
 * Prevents mechanically valid but unsuitable results: a component already
 * present elsewhere in the box, or one that cannot work in a ready-to-eat
 * format (for example, beans in a sandwich).
 */
function compatibleInComposition(altId, recipe, components, index) {
  if (components.some((c, i) => i !== index && c === altId)) return false;
  const readyToEat = /sandwich|ready-to-eat|cup/i.test(recipe.format || '');
  if (readyToEat && COMPONENTS[altId].notBusyFormat) return false;
  return true;
}

/**
 * Resolve one Base Recommendation against the user's safety and dietary
 * requirements, applying approved substitutions where they exist.
 * Returns null when the recommendation must be removed from the pool.
 */
export function resolveEligibility(recipe, profile) {
  const components = [];
  const substitutions = [];

  for (let i = 0; i < recipe.components.length; i++) {
    const id = recipe.components[i];
    if (isComponentEligible(id, profile)) { components.push(id); continue; }

    /* §3 — the engine first checks for an approved compatible substitution.
       A substitution may only come from the Morning Box-approved Component
       Library, never the Partner Bakery's general menu. */
    const group = COMPONENTS[id].swapGroup;
    const pool = group && !NO_DIRECT_SWAP.includes(id) ? SWAP_GROUPS[group] : [];
    const alt = pool.find(a =>
      a !== id && isComponentEligible(a, profile) &&
      compatibleInComposition(a, recipe, recipe.components, i));

    /* §3 — if no approved compatible substitution exists, the Base
       Recommendation is removed from the Candidate Pool. Safety
       requirements are never relaxed to create a recommendation. */
    if (!alt) return null;

    components.push(alt);
    substitutions.push({ from: id, to: alt, reason: REASON.SUBSTITUTION });
  }

  return { recipe, components, substitutions };
}

/* ============================================================
   §4–7 Match and tie-break
   ============================================================ */

/** §7 Context priority — used ONLY to break ties between selected preferences. */
const priorityRank = (context, preference) => {
  const order = CONTEXT_PRIORITY[context] || [];
  const i = order.indexOf(preference);
  return i < 0 ? 99 : i;
};

/**
 * Run the engine for one planned morning.
 * @param profile { eatingStyle, preferences[], dietary[], allergies[] }
 * @param context one of active | regular | busy | relaxed
 */
export function recommend(profile, context) {
  const prefs = profile.preferences || [];

  /* §4.3 No automatic cross-over — Health-Conscious and Flexible remain
     separate branches. §5 Daily Context is never silently switched.
     §6 Selected preferences define the pool; they are never merged. */
  const pool = BASE_RECOMMENDATIONS.filter(r =>
    r.eatingStyle === profile.eatingStyle &&
    r.context === context &&
    prefs.includes(r.preference));

  const resolved = [];
  const rejected = [];
  for (const recipe of pool) {
    const r = resolveEligibility(recipe, profile);
    if (r) resolved.push(r); else rejected.push(recipe.id);
  }

  /* §7 — tie-break by context priority. The order in which the user tapped
     preferences creates no ranking. */
  resolved.sort((a, b) =>
    priorityRank(context, a.recipe.preference) - priorityRank(context, b.recipe.preference));

  /* §13 No-match: the engine does not weaken Safety, Dietary Requirements,
     Eating Style or Daily Context merely to create a result. */
  if (!resolved.length) {
    return {
      context, profile, primary: null, alternative: null,
      reasonCode: REASON.NONE, rejected,
      message: "We couldn't find a Morning Box that safely matches your requirements."
    };
  }

  const primary = { ...resolved[0], reasonCode: REASON.PRIMARY };
  /* §8 — Another Option is the next highest-priority eligible candidate and
     must stay within the selected preferences, Eating Style and Daily
     Context. If only one eligible candidate exists, it is not shown. */
  const alternative = resolved[1] ? { ...resolved[1], reasonCode: REASON.SECONDARY } : null;

  return { context, profile, primary, alternative, reasonCode: REASON.PRIMARY, rejected, candidates: resolved.length };
}

/* ============================================================
   §9 Swap eligibility — post-recommendation, never bypasses the filters
   ============================================================ */

/** Components with no meaningful equivalent display no Swap action (§9). */
export const canSwap = componentId =>
  !NO_DIRECT_SWAP.includes(componentId) && !!COMPONENTS[componentId].swapGroup;

/**
 * Eligible alternatives for one component of a configured box.
 * Safety, dietary and compatibility filters are applied again before any
 * alternative is shown, and a swap can never leave the Eating Style branch.
 */
export function swapOptions(config, index) {
  const id = config.components[index];
  if (!canSwap(id)) return [];
  const group = SWAP_GROUPS[COMPONENTS[id].swapGroup] || [];
  return group.filter(alt =>
    alt !== id &&
    isComponentEligible(alt, config.profile) &&
    compatibleInComposition(alt, config.recipe, config.components, index));
}

/** Apply a user swap. Same Swap Group means no price change (§9). */
export function applySwap(config, index, altId) {
  if (!swapOptions(config, index).includes(altId))
    return { ok: false, reason: 'That alternative is not eligible for this breakfast.' };
  const before = config.components[index];
  config.components = config.components.slice();
  config.components[index] = altId;
  (config.userSwaps ||= []).push({ from: before, to: altId });
  return { ok: true };
}

/* ============================================================
   §11 Size — quantity, not composition
   ============================================================ */

/** §11 / MB-PRO-001 §13.1 — some simple Busy boxes have one Standard Size. */
export const hasSizeSelector = recipe => !recipe.standardSizeOnly;

export function setSize(config, size) {
  if (!hasSizeSelector(config.recipe)) return { ok: false, reason: 'This breakfast is offered in one standard size.' };
  config.size = size;
  return { ok: true };
}

/* ============================================================
   §12 Add-ons — optional, never influence the recommendation
   ============================================================ */

/** Add-on groups, filtered through the user's safety and dietary rules. */
export function addonGroups(profile) {
  const bread = ADDON_BREAD.filter(id => isComponentEligible(id, { ...profile, eatingStyle: 'flexible' })
    && isComponentEligible(id, { dietary: profile.dietary, allergies: profile.allergies, eatingStyle: 'flexible' }));
  const pastry = ADDON_PASTRY.filter(id =>
    isComponentEligible(id, { dietary: profile.dietary, allergies: profile.allergies, eatingStyle: 'flexible' }));
  const groups = [];
  /* §12 — if an Add-on Group has no eligible products, that group is not shown. */
  if (bread.length) groups.push({ id: 'bread', label: 'Bread', items: bread, units: ['half', 'whole'] });
  if (pastry.length) groups.push({ id: 'pastry', label: 'Pastry', items: pastry, units: null });
  return groups;
}

/* ============================================================
   Pricing — MB-BOX-001 §8
     Breakfast Base Price + Size Adjustment + Add-ons = Final Price
   Numbers are indicative; the architecture is exact.
   ============================================================ */
export function priceBox(config) {
  const base = PRICE_LEVELS[priceLevel(config.recipe)];
  const sizeAdj = hasSizeSelector(config.recipe) ? SIZE_ADJUSTMENT[config.size] : 0;
  const addons = (config.addons || []).reduce((t, a) => t + addonPrice(a), 0);
  return { base, sizeAdj, addons, total: base + sizeAdj + addons };
}

export function addonPrice(a) {
  if (a.group === 'bread') return ADDON_PRICES.bread[a.unit] * a.qty;
  return (ADDON_PRICES.pastry[COMPONENTS[a.item].name] || 12) * a.qty;
}

/* ============================================================
   Build a configurable box from a recommendation result
   ============================================================ */
export function configure(resolved, profile) {
  return {
    recipe: resolved.recipe,
    baseRecommendationId: resolved.recipe.id,
    components: resolved.components.slice(),
    substitutions: resolved.substitutions.slice(),
    userSwaps: [],
    size: hasSizeSelector(resolved.recipe) ? 'regular' : 'standard',
    addons: [],
    profile,
    reasonCode: resolved.reasonCode,
    label: describe({ ...resolved.recipe, components: resolved.components })
  };
}

/* ============================================================
   §15 Recommendation output & backend record
   Every recommendation must be traceable from the inputs to the final
   breakfast configuration.
   ============================================================ */
export function traceRecord(config, context) {
  return {
    inputs: {
      eatingStyle: config.profile.eatingStyle,
      preferences: config.profile.preferences,
      dailyContext: context,
      dietary: config.profile.dietary,
      allergies: config.profile.allergies
    },
    recommendation: {
      baseRecommendation: config.baseRecommendationId,
      reasonCode: config.reasonCode
    },
    changes: {
      systemSubstitutions: config.substitutions,
      userSwaps: config.userSwaps,
      size: config.size,
      addons: config.addons
    },
    output: {
      components: config.components.map(id => ({ id, name: COMPONENTS[id].name, portion: portion(id, config.size === 'standard' ? 'regular' : config.size) })),
      price: priceBox(config)
    }
  };
}

/* ============================================================
   MB-B2B-001 — Business Breakfast
   Business Breakfast exposes Breakfast Model × Size × Quantity only.
   No Swap, no Add-ons, no component-level customization (§5).
   ============================================================ */

/** The standardized models a business user can order, for one context. */
export function businessModels(context = 'regular') {
  return BASE_RECOMMENDATIONS
    .filter(r => r.context === context)
    .map(r => ({
      recipe: r,
      label: describe(r),
      preference: r.preference,
      eatingStyle: r.eatingStyle,
      base: PRICE_LEVELS[priceLevel(r)]
    }));
}

/**
 * §2 Morning Box Mix — distribute the general headcount as evenly as
 * practical across the available standardized models.
 * "20 people across four models becomes 5 + 5 + 5 + 5; 10 people may
 *  become 3 + 3 + 2 + 2."
 */
export function morningBoxMix(generalCount, context = 'regular', modelCount = 4) {
  const models = businessModels(context)
    .filter(m => m.eatingStyle === 'flexible')
    .slice(0, modelCount);
  const base = Math.floor(generalCount / models.length);
  let rem = generalCount % models.length;
  return models.map(m => {
    const qty = base + (rem-- > 0 ? 1 : 0);
    return { model: m, size: 'regular', qty };
  }).filter(l => l.qty > 0);
}

/**
 * A Special Breakfast group resolves the requirement against the library
 * exactly as a personal order would — safety rules are identical (§3).
 */
export function resolveSpecial(special, context = 'regular') {
  const profile = {
    eatingStyle: 'flexible',
    preferences: ['savory', 'bakery', 'fresh', 'sweet'],
    dietary: special.dietary || [],
    allergies: special.allergies || []
  };
  const res = recommend(profile, context);
  return res.primary ? { ...special, resolved: res.primary, profile } : { ...special, resolved: null, profile };
}

/** §7 Breakfast Price × Quantity → Volume Discount → Final Order Price. */
export function priceBusinessDay(lines, specials) {
  const boxes = lines.reduce((t, l) => t + l.qty, 0) + specials.reduce((t, s) => t + s.qty, 0);
  const gross =
    lines.reduce((t, l) => t + (l.model.base + SIZE_ADJUSTMENT[l.size]) * l.qty, 0) +
    specials.reduce((t, s) => t + (s.resolved ? PRICE_LEVELS[priceLevel(s.resolved.recipe)] : 0) * s.qty, 0);
  const pct = volumeDiscount(boxes);
  return { boxes, gross, discountPct: pct, discount: gross * pct, total: gross * (1 - pct) };
}
