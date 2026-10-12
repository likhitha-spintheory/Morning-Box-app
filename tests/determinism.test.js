/* Engine test matrix (Master Plan §13; MB-REC-001 §1.4, §3, §8, §13):
   every Eating Style × Daily Context × preference set × dietary/allergy profile.
   Same inputs → same recommendation; nothing unsafe; alternatives stay in the branch. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend, swapOptions, configure, addonGroups } from '../src/domain/engine.js';
import { COMPONENTS, isComponentEligible } from '../src/domain/library.js';
import { EATING_STYLES, CONTEXTS, PREFERENCES, DIETARY, ALLERGENS } from '../src/domain/standards.js';

const prefSets = [];
for (let mask = 1; mask < 1 << PREFERENCES.length; mask++) prefSets.push(PREFERENCES.filter((_, i) => mask & (1 << i)).map(p => p.id));
const safety = [{ dietary: [], allergies: [] }, ...DIETARY.map(d => ({ dietary: [d.id], allergies: [] })), ...ALLERGENS.map(a => ({ dietary: [], allergies: [a.id] })),
  { dietary: ['vegan', 'glutenFree'], allergies: [] }, { dietary: ['vegetarian'], allergies: ['egg', 'dairy'] }, { dietary: ['halal'], allergies: ['treenut', 'peanut', 'sesame'] }];

const cases = [];
for (const e of EATING_STYLES) for (const c of CONTEXTS) for (const preferences of prefSets) for (const s of safety)
  cases.push({ profile: { eatingStyle: e.id, preferences, ...s }, context: c.id });

test(`engine matrix: ${cases.length} profiles`, () => {
  let matched = 0;
  for (const { profile, context } of cases) {
    const a = recommend(profile, context), b = recommend(structuredClone(profile), context);
    const key = r => JSON.stringify([r.primary?.recipe.id, r.primary?.components, r.alternative?.recipe.id, r.alternative?.components]);
    assert.equal(key(a), key(b), 'same inputs → same recommendation');
    /* Order of preference taps creates no ranking (MB-REC-001 §7). */
    assert.equal(key(recommend({ ...profile, preferences: [...profile.preferences].reverse() }, context)), key(a));
    if (!a.primary) { assert.equal(a.alternative, null); continue; }
    matched++;
    for (const opt of [a.primary, a.alternative].filter(Boolean)) {
      assert.equal(opt.recipe.eatingStyle, profile.eatingStyle, 'never leaves the Eating Style branch');
      assert.equal(opt.recipe.context, context, 'never switches the Daily Context');
      assert.ok(profile.preferences.includes(opt.recipe.preference), 'stays within the selected preferences');
      for (const id of opt.components) assert.ok(isComponentEligible(id, profile), `${id} is safe for ${JSON.stringify(profile)}`);
      const cfg = configure(opt, profile);
      cfg.components.forEach((_, i) => swapOptions({ ...cfg, profile }, i).forEach(alt => assert.ok(isComponentEligible(alt, profile), `swap ${alt} is safe`)));
    }
    if (a.alternative) assert.notDeepEqual([...a.alternative.components].sort(), [...a.primary.components].sort(), 'Another option is a different breakfast');
    for (const g of addonGroups(profile)) for (const id of g.items) {
      assert.ok(!(profile.allergies || []).some(x => COMPONENTS[id].allergens.includes(x)), `add-on ${id} has no declared allergen`);
      assert.ok(['bread', 'pastry'].includes(g.id), 'add-ons are bread and pastry only');
    }
  }
  assert.ok(matched > cases.length * 0.5, `most profiles get a recommendation (${matched}/${cases.length})`);
});
