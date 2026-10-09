/* ============================================================
   recipes.js — The 32 approved Base Recommendations
   Transcribed verbatim from MB-PRO-001 §12 (FINAL / LOCKED).

   "The 32 combinations below are backend Base Recommendations, not
    32 menu items. All compositions are defined at Regular size."
                                            — MB-PRO-001 §12

   4 Breakfast Preferences × 2 Eating Styles × 4 Daily Contexts = 32.
   Light and Large are derived from component-level portion standards
   (§13.5). No separate Light or Large recipes exist.
   ============================================================ */

import { COMPONENTS } from './library.js';

const r = (preference, eatingStyle, context, components, opts = {}) => ({
  id: `${preference}.${eatingStyle}.${context}`,
  preference, eatingStyle, context, components, ...opts
});

export const BASE_RECOMMENDATIONS = [
  /* ---------------- §12.1 Savory Breakfast ----------------
     "Regular Savory normally uses four core components; a fifth is used
      only when context justifies it." */
  r('savory', 'health', 'regular',
    ['scrambledEggs', 'wholeWheatSourdough', 'avocado', 'tomato']),
  r('savory', 'flexible', 'regular',
    ['scrambledEggs', 'chickenSausage', 'whiteSourdough', 'tomato']),
  r('savory', 'health', 'active',
    ['scrambledEggs', 'wholeWheatSourdough', 'avocado', 'greekYogurt', 'seasonalFruit']),
  r('savory', 'flexible', 'active',
    ['scrambledEggs', 'chickenSausage', 'whiteSourdough', 'avocado', 'seasonalFruit']),
  r('savory', 'health', 'busy',
    ['wholeWheatSourdough', 'scrambledEggs', 'avocado', 'mixedGreens'],
    { format: 'Ready-to-eat sandwich' }),
  r('savory', 'flexible', 'busy',
    ['ciabatta', 'scrambledEggs', 'chickenSausage', 'tomato'],
    { format: 'Ready-to-eat sandwich' }),
  r('savory', 'health', 'relaxed',
    ['omelette', 'wholeWheatSourdough', 'avocado', 'mixedGreens', 'berries']),
  r('savory', 'flexible', 'relaxed',
    ['omelette', 'beefBacon', 'focaccia', 'feta', 'tomato']),

  /* ---------------- §12.2 Bread & Pastry ----------------
     "Standard pastries are not used as the default recommendation for
      Health-Conscious users. Health-Conscious is a recommendation
      direction, not a dietary prohibition." */
  r('bakery', 'health', 'regular',
    ['wholeWheatSourdough', 'butter', 'honey', 'seasonalFruit']),
  r('bakery', 'flexible', 'regular',
    ['plainCroissant', 'whiteSourdough', 'butter', 'jam']),
  r('bakery', 'health', 'active',
    ['wholeWheatSourdough', 'peanutButter', 'greekYogurt', 'banana', 'honey']),
  r('bakery', 'flexible', 'active',
    ['plainCroissant', 'whiteSourdough', 'peanutButter', 'banana', 'greekYogurt']),
  r('bakery', 'health', 'busy',
    ['wholeWheatSourdough', 'peanutButter', 'banana'],
    { format: 'Peanut butter sandwich + whole banana' }),
  r('bakery', 'flexible', 'busy',
    ['cheeseCroissant', 'banana'],
    { format: 'Ready-to-eat. No assembly or cutlery.', standardSizeOnly: true }),
  r('bakery', 'health', 'relaxed',
    ['wholeWheatSourdough', 'butter', 'honey', 'berries', 'banana']),
  r('bakery', 'flexible', 'relaxed',
    ['plainCroissant', 'whiteSourdough', 'butter', 'jam', 'seasonalFruit']),

  /* ---------------- §12.3 Fresh & Wholesome ---------------- */
  r('fresh', 'health', 'regular',
    ['greekYogurt', 'granola', 'seasonalFruit', 'berries'],
    { format: 'Granola packed separately' }),
  r('fresh', 'flexible', 'regular',
    ['overnightOats', 'granola', 'banana', 'honey']),
  r('fresh', 'health', 'active',
    ['overnightOats', 'greekYogurt', 'granola', 'banana', 'berries']),
  r('fresh', 'flexible', 'active',
    ['overnightOats', 'greekYogurt', 'muesli', 'seasonalFruit', 'honey']),
  r('fresh', 'health', 'busy',
    ['greekYogurt', 'granola', 'banana'],
    { format: 'Yogurt and granola cup + whole banana. Granola separate until eating.' }),
  r('fresh', 'flexible', 'busy',
    ['overnightOats', 'banana', 'honey'],
    { format: 'Ready-to-eat oats cup + banana. Honey separate.' }),
  r('fresh', 'health', 'relaxed',
    ['greekYogurt', 'muesli', 'seasonalFruit', 'berries', 'honey']),
  r('fresh', 'flexible', 'relaxed',
    ['overnightOats', 'greekYogurt', 'granola', 'seasonalFruit', 'banana']),

  /* ---------------- §12.4 Sweet Breakfast ----------------
     "Sweet recommendations are created from the existing library.
      Pancakes, French Toast and Waffles are outside the Core MVP."
                                                  — MB-BOX-001 §4.9 */
  r('sweet', 'health', 'regular',
    ['wholeWheatSourdough', 'peanutButter', 'banana', 'honey']),
  r('sweet', 'flexible', 'regular',
    ['painAuChocolat', 'greekYogurt', 'seasonalFruit', 'berries']),
  r('sweet', 'health', 'active',
    ['overnightOats', 'peanutButter', 'banana', 'berries', 'honey']),
  r('sweet', 'flexible', 'active',
    ['painAuChocolat', 'greekYogurt', 'granola', 'banana', 'berries']),
  r('sweet', 'health', 'busy',
    ['wholeWheatSourdough', 'peanutButter', 'banana'],
    { format: 'Peanut butter and banana sandwich. No added sweetener.' }),
  r('sweet', 'flexible', 'busy',
    ['painAuChocolat', 'banana'],
    { format: 'Ready-to-eat.', standardSizeOnly: true }),
  r('sweet', 'health', 'relaxed',
    ['wholeWheatSourdough', 'peanutButter', 'greekYogurt', 'berries', 'honey']),
  r('sweet', 'flexible', 'relaxed',
    ['fruitDanish', 'whiteSourdough', 'butter', 'jam', 'seasonalFruit'])
];

export const recipeById = Object.fromEntries(BASE_RECOMMENDATIONS.map(x => [x.id, x]));

/**
 * A descriptive label built from the composition itself.
 * The standard is explicit that these are backend Base Recommendations and
 * not a 32-item menu, so no marketing names are invented here — the label
 * simply reads back the leading components.
 */
export function describe(recipe) {
  const names = recipe.components.slice(0, 3).map(id => COMPONENTS[id].name.toLowerCase());
  const head = names[0][0].toUpperCase() + names[0].slice(1);
  const rest = names.slice(1);
  return rest.length ? `${head}, ${rest.slice(0, -1).join(', ')}${rest.length > 1 ? ' &' : ' &'} ${rest[rest.length - 1]}`
                     : head;
}

/**
 * Internal price level from composition cost, per MB-BOX-001 §8:
 * "Morning Box may use a limited number of internal price levels based on
 *  product composition and cost, but these levels are not shown as
 *  user-facing budget categories."
 */
export function priceLevel(recipe) {
  const n = recipe.components.length;
  const premium = recipe.components.filter(id =>
    ['Pastry', 'Savory Protein', 'Dairy & Cheese'].includes(COMPONENTS[id].category)).length;
  const score = n + premium;
  return score >= 7 ? 'L4' : score >= 6 ? 'L3' : score >= 5 ? 'L2' : 'L1';
}

/* ---------- Integrity checks the build relies on ---------- */
export function auditLibrary() {
  const issues = [];
  const seen = new Set();
  for (const rec of BASE_RECOMMENDATIONS) {
    if (seen.has(rec.id)) issues.push(`duplicate base recommendation: ${rec.id}`);
    seen.add(rec.id);
    for (const id of rec.components)
      if (!COMPONENTS[id]) issues.push(`${rec.id} references unknown component "${id}"`);
  }
  if (BASE_RECOMMENDATIONS.length !== 32)
    issues.push(`expected 32 base recommendations, found ${BASE_RECOMMENDATIONS.length}`);
  for (const p of ['savory', 'bakery', 'fresh', 'sweet'])
    for (const e of ['health', 'flexible'])
      for (const c of ['regular', 'active', 'busy', 'relaxed'])
        if (!recipeById[`${p}.${e}.${c}`]) issues.push(`missing combination ${p}.${e}.${c}`);
  return issues;
}
