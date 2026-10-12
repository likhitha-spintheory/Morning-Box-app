/* ============================================================
   menu.js — Admin-editable recommendation data
   The defaults are the approved library (library.js), the 32 Base
   Recommendations (recipes.js) and the context priority (standards.js).
   Morning Box edits them in the ops console (Admin → Menu rules); the
   server stores the result and sends it to the app, and applyMenu()
   updates those same objects in place, so the engine, the screens and the
   server all recommend from one source — exactly like applyPricing().
   ============================================================ */
import { COMPONENTS, SWAP_GROUPS } from './library.js';
import { BASE_RECOMMENDATIONS, recipeById } from './recipes.js';
import { CONTEXT_PRIORITY, ALLERGENS, DIETARY, PREFERENCES, CONTEXTS } from './standards.js';

export const CATEGORIES = [...new Set(Object.values(COMPONENTS).map(c => c.category))];
const PREF_IDS = PREFERENCES.map(p => p.id);
const CONTEXT_IDS = CONTEXTS.map(c => c.id);
const SIZES = ['light', 'regular', 'large'];

/* MB-REC-001 §4.1: Flexible-only proteins and standard pastries are both "Flexible only" to the admin. */
const isFlexibleOnly = k => !!(k.flexibleOnly || k.standardPastry);

const itemOut = k => ({
  name: k.name, category: k.category, portions: { ...k.portions }, allergens: [...k.allergens], diet: [...k.diet],
  flexibleOnly: isFlexibleOnly(k), swapGroup: k.swapGroup || null, note: k.note || '', custom: !!k.custom
});
export const menuSnapshot = () => ({
  items: Object.fromEntries(Object.entries(COMPONENTS).map(([id, k]) => [id, itemOut(k)])),
  breakfasts: Object.fromEntries(BASE_RECOMMENDATIONS.map(r => [r.id, { components: [...r.components], format: r.format || '' }])),
  priority: Object.fromEntries(Object.entries(CONTEXT_PRIORITY).map(([c, list]) => [c, [...list]]))
});

/* The approved originals, captured before anything is applied. */
const ORIGINAL = {
  items: Object.fromEntries(Object.entries(COMPONENTS).map(([id, k]) => [id, { flexibleOnly: !!k.flexibleOnly, standardPastry: !!k.standardPastry }])),
  swapGroups: Object.fromEntries(Object.entries(SWAP_GROUPS).map(([g, ids]) => [g, [...ids]]))
};
export const DEFAULT_MENU = menuSnapshot();

/** Apply a validated menu (or the defaults) to the shared objects in place. */
export function applyMenu(m) {
  if (!m || typeof m !== 'object' || !m.items) return;
  /* Items added in Admin that are no longer in the menu are removed (e.g. after a reset). */
  for (const id of Object.keys(COMPONENTS)) if (COMPONENTS[id].custom && !m.items[id]) delete COMPONENTS[id];
  for (const [id, it] of Object.entries(m.items)) {
    const k = COMPONENTS[id] || (COMPONENTS[id] = { id, custom: true });
    Object.assign(k, { name: it.name, allergens: [...it.allergens], diet: [...it.diet], note: it.note || '' });
    if (k.custom) Object.assign(k, { category: it.category, portions: { ...it.portions }, swapGroup: it.swapGroup || null, flexibleOnly: !!it.flexibleOnly });
    else {
      /* Keep which flag the approved item used; switching off clears both. */
      const o = ORIGINAL.items[id];
      k.flexibleOnly = it.flexibleOnly && (o.flexibleOnly || !o.standardPastry);
      k.standardPastry = it.flexibleOnly && o.standardPastry;
    }
  }
  /* Swap groups: the approved members plus Admin-added items in that group. */
  for (const [g, ids] of Object.entries(ORIGINAL.swapGroups)) {
    SWAP_GROUPS[g] = [...ids, ...Object.keys(COMPONENTS).filter(id => COMPONENTS[id].custom && COMPONENTS[id].swapGroup === g)];
  }
  for (const [id, b] of Object.entries(m.breakfasts || {})) {
    if (!recipeById[id]) continue;
    recipeById[id].components = [...b.components];
    if (b.format) recipeById[id].format = b.format; else delete recipeById[id].format;
  }
  for (const [c, list] of Object.entries(m.priority || {})) if (CONTEXT_PRIORITY[c]) CONTEXT_PRIORITY[c].splice(0, 4, ...list);
}

/* ---------- Validation (server side; the console shows the message) ---------- */
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const slug = name => `x${text(name, 40).replace(/[^A-Za-z0-9]+(.)?/g, (_, ch) => (ch ? ch.toUpperCase() : '')).replace(/^./, ch => ch.toUpperCase())}`;

/**
 * Check a full menu from the console; returns the cleaned menu or throws
 * { message } describing the first problem. Rules:
 *  - allergens / dietary flags only from the standard lists (MB-PRO-001 §15.1);
 *  - each of the 32 breakfasts keeps 1–6 distinct known items; Health-Conscious
 *    breakfasts never contain Flexible-only items (MB-REC-001 §4.1);
 *  - the priority for each Morning Type ranks all four preferences once (MB-REC-001 §7);
 *  - approved items can't be deleted; added items only while no breakfast uses them.
 */
export function validateMenu(input, fail) {
  if (!input || typeof input !== 'object' || !input.items || !input.breakfasts || !input.priority) fail('Send the full menu.');
  const allergenIds = ALLERGENS.map(a => a.id), dietIds = DIETARY.map(d => d.id);
  const items = {};
  for (const id of Object.keys(DEFAULT_MENU.items)) if (!input.items[id] && !DEFAULT_MENU.items[id].custom) fail(`${DEFAULT_MENU.items[id].name} is an approved item and can't be deleted.`);
  for (const [rawId, it] of Object.entries(input.items)) {
    const known = !!DEFAULT_MENU.items[rawId] || !!COMPONENTS[rawId]?.custom;
    const name = text(it?.name, 60);
    if (name.length < 2) fail('Every item needs a name.');
    const id = known ? rawId : slug(name);
    if (!known && (COMPONENTS[id] || items[id])) fail(`An item called “${name}” already exists.`);
    if (!Array.isArray(it.allergens) || it.allergens.some(a => !allergenIds.includes(a))) fail(`${name}: choose allergens from the list.`);
    if (!Array.isArray(it.diet) || it.diet.some(d => !dietIds.includes(d))) fail(`${name}: choose “suitable for” from the list.`);
    /* An item containing an allergen can't be dairy-free / gluten-free at the same time. */
    if (it.allergens.includes('dairy') && (it.diet.includes('dairyFree') || it.diet.includes('vegan'))) fail(`${name} contains dairy, so it can't be dairy-free or vegan.`);
    if (it.allergens.includes('gluten') && it.diet.includes('glutenFree')) fail(`${name} contains gluten, so it can't be gluten-free.`);
    if (it.allergens.includes('egg') && it.diet.includes('vegan')) fail(`${name} contains egg, so it can't be vegan.`);
    if (it.diet.includes('vegan') && !it.diet.includes('vegetarian')) fail(`${name}: a vegan item is also vegetarian.`);
    const clean = { name, allergens: [...new Set(it.allergens)], diet: [...new Set(it.diet)], flexibleOnly: !!it.flexibleOnly, note: text(it.note, 200) };
    const custom = known ? !!DEFAULT_MENU.items[rawId]?.custom || !!COMPONENTS[rawId]?.custom : true;
    if (custom) {
      if (!CATEGORIES.includes(it.category)) fail(`${name}: choose a category.`);
      const portions = {};
      for (const s of SIZES) { portions[s] = text(it.portions?.[s], 20); if (!portions[s]) fail(`${name}: enter the ${s} portion (e.g. 60 g).`); }
      if (it.swapGroup && !ORIGINAL.swapGroups[it.swapGroup]) fail(`${name}: unknown swap group.`);
      Object.assign(clean, { category: it.category, portions, swapGroup: it.swapGroup || null, custom: true });
    }
    items[id] = clean;
  }
  const flexibleOnly = id => items[id]?.flexibleOnly;
  const breakfasts = {};
  for (const r of BASE_RECOMMENDATIONS) {
    const b = input.breakfasts[r.id];
    if (!b || !Array.isArray(b.components)) fail(`Breakfast ${r.id} is missing.`);
    const comps = b.components.map(String);
    if (comps.length < 1 || comps.length > 6) fail(`${r.id}: a breakfast has 1–6 items.`);
    if (new Set(comps).size !== comps.length) fail(`${r.id}: the same item is listed twice.`);
    for (const id of comps) if (!items[id]) fail(`${r.id}: unknown item “${id}”.`);
    if (r.eatingStyle === 'health') for (const id of comps) if (flexibleOnly(id)) fail(`${r.id} is a Health-Conscious breakfast, so it can't include ${items[id].name} (Flexible only).`);
    breakfasts[r.id] = { components: comps, format: text(b.format, 120) };
  }
  /* A removed (added) item still used by a breakfast fails above as an unknown item. */
  const priority = {};
  for (const c of CONTEXT_IDS) {
    const list = input.priority[c];
    if (!Array.isArray(list) || list.length !== 4 || new Set(list).size !== 4 || list.some(p => !PREF_IDS.includes(p))) fail(`Priority for ${c}: rank all four preferences once.`);
    priority[c] = [...list];
  }
  return { items, breakfasts, priority };
}
