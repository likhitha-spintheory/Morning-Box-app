/* ============================================================
   library.js — The approved Morning Box Core Component Library
   Implements MB-PRO-001 Production & Food Specification:
     §3  Egg & hot savory      §4  Bread          §5  Pastry
     §6  Fresh savory          §7  Fruit          §8  Dairy & cheese
     §9  Grains & bowls        §10 Spreads        §11 Swap groups
     §15.1 Ingredient & Allergen Record

   "No product may enter the Morning Box recommendation, swap or
    add-on system without an approved ingredient and allergen record."
   Every entry below therefore carries `allergens` and `diet`.
   ============================================================ */

/* diet flags: which dietary requirements the component SATISFIES.
   A component missing a flag is excluded for a user who requires it. */
const V  = ['vegetarian', 'vegan', 'dairyFree', 'glutenFree', 'halal'];     // satisfies everything
const VG = ['vegetarian', 'dairyFree', 'glutenFree', 'halal'];              // vegetarian, not vegan
const VD = ['vegetarian', 'vegan', 'glutenFree', 'halal'];                  // vegan but contains... n/a
const DY = ['vegetarian', 'glutenFree', 'halal'];                           // dairy — not vegan, not dairy-free
const GL = ['vegetarian', 'vegan', 'dairyFree', 'halal'];                   // gluten — not gluten-free

/**
 * c(id, name, category, portions, allergens, diet, swapGroup, opts)
 * portions: { light, regular, large } in the unit appropriate to the product
 *           (MB-PRO-001 §2 — piece, egg count, grams or loaf unit).
 */
const c = (id, name, category, portions, allergens, diet, swapGroup, opts = {}) =>
  ({ id, name, category, portions, allergens, diet, swapGroup, ...opts });

export const COMPONENTS = {
  /* ---- §3 Egg & hot savory ---- */
  scrambledEggs: c('scrambledEggs', 'Scrambled Eggs', 'Egg & Hot Savory',
    { light: '1 egg', regular: '2 eggs', large: '3 eggs' }, ['egg'], VG, 'eggHotMain',
    { note: 'Eggs + light cooking fat and seasoning; no milk or cream. Soft, moist, fully cooked.' }),
  omelette: c('omelette', 'Plain Omelette', 'Egg & Hot Savory',
    { light: '1 egg', regular: '2 eggs', large: '3 eggs' }, ['egg'], VG, 'eggHotMain',
    { note: 'Plain. No variants.' }),
  boiledEggs: c('boiledEggs', 'Hard-boiled Eggs', 'Egg & Hot Savory',
    { light: '1 egg', regular: '2 eggs', large: '3 eggs' }, ['egg'], VG, 'eggHotMain',
    { note: 'Peeled and halved.' }),
  beans: c('beans', 'Breakfast Beans', 'Egg & Hot Savory',
    { light: '80 g', regular: '120 g', large: '160 g' }, [], V, 'eggHotMain',
    { note: 'White beans, light tomato sauce, seasoning.', notBusyFormat: true }),

  chickenSausage: c('chickenSausage', 'Halal Chicken Sausage', 'Savory Protein',
    { light: '1 pc', regular: '2 pcs', large: '3 pcs' }, [], ['dairyFree', 'glutenFree', 'halal'], 'savoryProtein',
    { flexibleOnly: true, note: 'Approx. 35–45 g per unit.' }),
  beefBacon: c('beefBacon', 'Halal Beef Bacon', 'Savory Protein',
    { light: '25 g', regular: '40 g', large: '60 g' }, [], ['dairyFree', 'glutenFree', 'halal'], 'savoryProtein',
    { flexibleOnly: true, note: 'Cooked weight.' }),
  turkeyBacon: c('turkeyBacon', 'Halal Turkey Bacon', 'Savory Protein',
    { light: '25 g', regular: '40 g', large: '60 g' }, [], ['dairyFree', 'glutenFree', 'halal'], 'savoryProtein',
    { flexibleOnly: true, note: 'Cooked weight.' }),

  /* ---- §4 Bread — all baked in-house, served untoasted by default ---- */
  whiteSourdough: c('whiteSourdough', 'White Sourdough', 'Bread',
    { light: '40 g', regular: '60 g', large: '80 g' }, ['gluten'], GL, 'bread'),
  wholeWheatSourdough: c('wholeWheatSourdough', 'Whole Wheat Sourdough', 'Bread',
    { light: '40 g', regular: '60 g', large: '80 g' }, ['gluten'], GL, 'bread'),
  multigrain: c('multigrain', 'Multigrain Bread', 'Bread',
    { light: '40 g', regular: '60 g', large: '80 g' }, ['gluten', 'sesame'], GL, 'bread'),
  ciabatta: c('ciabatta', 'Ciabatta', 'Bread',
    { light: '40 g', regular: '60 g', large: '80 g' }, ['gluten'], GL, 'bread'),
  focaccia: c('focaccia', 'Focaccia', 'Bread',
    { light: '40 g', regular: '60 g', large: '80 g' }, ['gluten'], GL, 'bread',
    { note: 'Plain or approved Olive variant.' }),

  /* ---- §5 Pastry — one piece regardless of breakfast size ---- */
  plainCroissant: c('plainCroissant', 'Plain Croissant', 'Pastry',
    { light: '1 pc', regular: '1 pc', large: '1 pc' }, ['gluten', 'dairy', 'egg'], ['vegetarian', 'halal'], 'pastry',
    { fixedUnit: true, standardPastry: true, note: '55–70 g.' }),
  cheeseCroissant: c('cheeseCroissant', 'Cheese Croissant', 'Pastry',
    { light: '1 pc', regular: '1 pc', large: '1 pc' }, ['gluten', 'dairy', 'egg'], ['vegetarian', 'halal'], 'pastry',
    { fixedUnit: true, standardPastry: true, note: '65–80 g.' }),
  painAuChocolat: c('painAuChocolat', 'Pain au Chocolat', 'Pastry',
    { light: '1 pc', regular: '1 pc', large: '1 pc' }, ['gluten', 'dairy', 'egg', 'soy'], ['vegetarian', 'halal'], 'pastry',
    { fixedUnit: true, standardPastry: true, note: '60–75 g.' }),
  fruitDanish: c('fruitDanish', 'Fruit Danish', 'Pastry',
    { light: '1 pc', regular: '1 pc', large: '1 pc' }, ['gluten', 'dairy', 'egg'], ['vegetarian', 'halal'], 'pastry',
    { fixedUnit: true, standardPastry: true, note: '70–90 g. Apple, Berry or Apricot.' }),

  /* ---- §6 Fresh savory ---- */
  avocado: c('avocado', 'Avocado', 'Fresh Savory',
    { light: '40 g', regular: '60 g', large: '80 g' }, [], V, null,
    { noDirectSwap: true, note: 'Sliced or chunked.' }),
  tomato: c('tomato', 'Tomato', 'Fresh Savory',
    { light: '50 g', regular: '75 g', large: '100 g' }, [], V, 'freshVegetable'),
  cucumber: c('cucumber', 'Cucumber', 'Fresh Savory',
    { light: '50 g', regular: '75 g', large: '100 g' }, [], V, 'freshVegetable'),
  mixedGreens: c('mixedGreens', 'Mixed Greens', 'Fresh Savory',
    { light: '20 g', regular: '30 g', large: '40 g' }, [], V, 'freshVegetable'),
  olives: c('olives', 'Olives', 'Fresh Savory',
    { light: '20 g', regular: '30 g', large: '40 g' }, [], V, null,
    { noDirectSwap: true, note: 'Pitted green only.' }),

  /* ---- §7 Fruit ---- */
  seasonalFruit: c('seasonalFruit', 'Seasonal Fruit Mix', 'Fruit',
    { light: '100 g', regular: '150 g', large: '200 g' }, [], V, 'fruit',
    { note: 'Minimum 3 fruits from melon, watermelon, pineapple, grapes, orange, apple, kiwi.' }),
  berries: c('berries', 'Berries', 'Fruit',
    { light: '50 g', regular: '75 g', large: '100 g' }, [], V, 'fruit',
    { note: 'Strawberry, blueberry, raspberry.' }),
  banana: c('banana', 'Banana', 'Fruit',
    { light: 'Small', regular: 'Medium', large: 'Large' }, [], V, 'fruit',
    { note: 'Whole and unpeeled.' }),

  /* ---- §8 Dairy & cheese ---- */
  greekYogurt: c('greekYogurt', 'Greek Yogurt', 'Dairy & Cheese',
    { light: '100 g', regular: '150 g', large: '200 g' }, ['dairy'], DY, null,
    { noDirectSwap: true, note: 'Plain, unsweetened.' }),
  labneh: c('labneh', 'Labneh', 'Dairy & Cheese',
    { light: '50 g', regular: '75 g', large: '100 g' }, ['dairy'], DY, 'savoryDairy', { note: 'Plain.' }),
  feta: c('feta', 'Feta', 'Dairy & Cheese',
    { light: '30 g', regular: '45 g', large: '60 g' }, ['dairy'], DY, 'savoryDairy', { note: 'Plain.' }),

  /* ---- §9 Grains & bowls ---- */
  overnightOats: c('overnightOats', 'Overnight Oats', 'Grains & Bowls',
    { light: '150 g', regular: '200 g', large: '250 g' }, ['gluten', 'dairy'], ['vegetarian', 'halal'], null,
    { noDirectSwap: true,
      note: 'Rolled oats with approved dairy or plant milk base; no added sugar by default.',
      /* MB-PRO-001 §9 approves a dairy OR plant milk base. The plant-milk
         build is therefore an approved variant of the same component, not a
         new product — so it is available to the engine as a compatible
         substitution under MB-REC-001 §3. The bakery must be told which
         build to produce, so the variant is carried into the production list. */
      variant: { id: 'plantMilk', label: 'Plant milk base',
                 allergens: ['gluten'], diet: ['vegetarian', 'vegan', 'dairyFree', 'halal'] } }),
  granola: c('granola', 'Granola', 'Grains & Bowls',
    { light: '30 g', regular: '45 g', large: '60 g' }, ['gluten', 'treenut'], GL, 'dryGrain',
    { note: 'Packed separately from wet components.' }),
  muesli: c('muesli', 'Muesli', 'Grains & Bowls',
    { light: '30 g', regular: '45 g', large: '60 g' }, ['gluten', 'treenut'], GL, 'dryGrain',
    { note: 'No added sugar or syrup. Packed separately.' }),

  /* ---- §10 Spreads & accompaniments — all portioned separately ---- */
  creamCheese: c('creamCheese', 'Cream Cheese', 'Spreads',
    { light: '20 g', regular: '30 g', large: '40 g' }, ['dairy'], DY, 'neutralSpread', { note: 'Plain.' }),
  butter: c('butter', 'Butter', 'Spreads',
    { light: '10 g', regular: '15 g', large: '20 g' }, ['dairy'], DY, 'neutralSpread', { note: 'Plain unsalted.' }),
  honey: c('honey', 'Pure Honey', 'Spreads',
    { light: '10 g', regular: '15 g', large: '20 g' }, [], VG, 'sweetSpread',
    { note: 'Pure honey, no added sugar or flavouring. Vegetarian yes, vegan no.' }),
  jam: c('jam', 'Jam', 'Spreads',
    { light: '10 g', regular: '15 g', large: '20 g' }, [], V, 'sweetSpread',
    { note: 'Approved strawberry, apricot or mixed berry.' }),
  peanutButter: c('peanutButter', 'Peanut Butter', 'Spreads',
    { light: '15 g', regular: '25 g', large: '35 g' }, ['peanut'], V, 'sweetSpread',
    { note: 'Smooth. Strict allergy and cross-contact control.' })
};

/* ---------- MB-PRO-001 §11 · Swap Groups ----------
   "Swap Groups represent functional breakfast roles, not exact nutritional
    equivalence. A swap preserves the role of the component, not exact
    weight or nutrition." */
export const SWAP_GROUPS = {
  eggHotMain:    ['scrambledEggs', 'omelette', 'boiledEggs', 'beans'],
  savoryProtein: ['chickenSausage', 'beefBacon', 'turkeyBacon'],
  bread:         ['whiteSourdough', 'wholeWheatSourdough', 'multigrain', 'ciabatta', 'focaccia'],
  pastry:        ['plainCroissant', 'cheeseCroissant', 'painAuChocolat', 'fruitDanish'],
  freshVegetable:['tomato', 'cucumber', 'mixedGreens'],
  fruit:         ['seasonalFruit', 'berries', 'banana'],
  savoryDairy:   ['labneh', 'feta'],
  dryGrain:      ['granola', 'muesli'],
  neutralSpread: ['creamCheese', 'butter'],
  sweetSpread:   ['honey', 'jam', 'peanutButter']
};

/* Components with no meaningful equivalent show no Swap action (§11). */
export const NO_DIRECT_SWAP = ['avocado', 'olives', 'greekYogurt', 'overnightOats'];

/* ---------- MB-PRO-001 §14 · Add-on library ----------
   MVP add-ons are limited to two groups only. */
export const ADDON_BREAD = ['whiteSourdough', 'wholeWheatSourdough', 'multigrain', 'ciabatta', 'focaccia'];
export const ADDON_PASTRY = ['plainCroissant', 'cheeseCroissant', 'painAuChocolat', 'fruitDanish'];

/* ---------- Packaging rules (MB-PRO-001 §15.2) ---------- */
export const PACKING_RULES = {
  dryGrain:  'Pack separately from wet components to protect texture.',
  pastry:    'Protect from hot and wet components to prevent softening.',
  bread:     'Protect from crushing and moisture.',
  spread:    'Portioned and packed separately unless the specification defines a ready-to-eat format.'
};
export function packingNote(componentId) {
  const k = COMPONENTS[componentId];
  if (!k) return null;
  if (k.swapGroup === 'dryGrain') return PACKING_RULES.dryGrain;
  if (k.category === 'Pastry') return PACKING_RULES.pastry;
  if (k.category === 'Bread') return PACKING_RULES.bread;
  if (k.category === 'Spreads') return PACKING_RULES.spread;
  return null;
}

/* ---------- Eligibility ---------- */

/** Does this component satisfy every dietary requirement the user set? */
export const satisfiesDiet = (id, dietary) =>
  (dietary || []).every(d => (COMPONENTS[id].diet || []).includes(d));

/** Is this component free of every allergen the user declared? */
export const isAllergenSafe = (id, allergies) =>
  !(allergies || []).some(a => (COMPONENTS[id].allergens || []).includes(a));

/**
 * A component is eligible when it is allergen-safe, satisfies the dietary
 * requirements, and is permitted in the user's Eating Style branch.
 * MB-REC-001 §4.1: Flexible-only savory proteins and standard pastries are
 * not default recommendations for Health-Conscious users.
 */
export function isComponentEligible(id, ctx) {
  return !!resolveBuild(id, ctx);
}

/**
 * Which approved build of a component is eligible — the default build, or an
 * approved variant where the standard defines one.
 * Returns null when no build of this component can be served to this user.
 */
export function resolveBuild(id, { dietary = [], allergies = [], eatingStyle } = {}) {
  const k = COMPONENTS[id];
  if (!k) return null;
  /* Eating Style defines the recommendation branch (MB-REC-001 §4). */
  if (eatingStyle === 'health' && (k.flexibleOnly || k.standardPastry)) return null;

  const builds = [{ variant: null, allergens: k.allergens, diet: k.diet }];
  if (k.variant) builds.push({ variant: k.variant, allergens: k.variant.allergens, diet: k.variant.diet });

  for (const b of builds) {
    if (allergies.some(a => b.allergens.includes(a))) continue;
    if (!dietary.every(d => b.diet.includes(d))) continue;
    return b;
  }
  return null;
}

/** Portion text for a component at a given size (MB-PRO-001 §2). */
export const portion = (id, size = 'regular') =>
  COMPONENTS[id].portions[COMPONENTS[id].fixedUnit ? 'regular' : size];

export const allComponentIds = () => Object.keys(COMPONENTS);
