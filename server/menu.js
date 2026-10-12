/* Admin → Menu rules (ops key required): the food items, the 32 breakfasts and
   the Morning Type priority the recommendation engine uses. Saved changes apply
   to the next recommendation, on the server and in the app. */
import { Router } from 'express';
import { getMenu, saveMenu, resetMenu, menuHistory } from './settings.js';
import { ALLERGENS, DIETARY, PREFERENCES, CONTEXTS } from '../src/domain/standards.js';
import { CATEGORIES } from '../src/domain/menu.js';
import { SWAP_GROUPS } from '../src/domain/library.js';
import { recommend } from '../src/domain/engine.js';
import { bad } from './rules.js';

export const menuRouter = Router();

const lists = () => ({ allergens: ALLERGENS, dietary: DIETARY, preferences: PREFERENCES, contexts: CONTEXTS, categories: CATEGORIES, swapGroups: Object.keys(SWAP_GROUPS) });
menuRouter.get('/', (_req, res) => res.json({ menu: getMenu(), lists: lists(), history: menuHistory() }));
menuRouter.put('/', (req, res) => res.json({ ...saveMenu(req.body), history: menuHistory() }));
menuRouter.post('/reset', (_req, res) => res.json({ ...resetMenu(), history: menuHistory() }));

/** Try it: what a profile would be recommended with the current rules. */
menuRouter.post('/try', (req, res) => {
  const { eatingStyle, preferences = [], dietary = [], allergies = [], context } = req.body || {};
  if (!['health', 'flexible'].includes(eatingStyle)) throw bad('profile_invalid', 'Choose an eating style.');
  if (!CONTEXTS.some(c => c.id === context)) throw bad('profile_invalid', 'Choose a morning type.');
  const pick = (v, ids) => (Array.isArray(v) ? v.filter(x => ids.includes(x)) : []);
  const profile = { eatingStyle, preferences: pick(preferences, PREFERENCES.map(p => p.id)), dietary: pick(dietary, DIETARY.map(d => d.id)), allergies: pick(allergies, ALLERGENS.map(a => a.id)) };
  if (!profile.preferences.length) throw bad('profile_invalid', 'Choose at least one preference.');
  const r = recommend(profile, context);
  const box = x => x && { recipeId: x.recipe.id, components: x.components, substitutions: x.substitutions || [] };
  res.json({ primary: box(r.primary), alternative: box(r.alternative), rejected: r.rejected || [], message: r.message || null });
});
