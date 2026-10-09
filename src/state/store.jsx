import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { put } from '../api.js';

const KEY = 'morningbox.app.v1';

export const emptyPlan = () => ({ dates: [], days: {} });
export const emptyBusiness = () => ({
  people: 20, hasSpecial: null, specials: [], mode: 'mix', lines: [],
  dates: [], sameForAll: true, perDay: {},
  delivery: { company: '', building: '', office: '', area: 'DIFC', contact: '', mobile: '', notes: '', window: 'w1' },
  invoice: { wanted: true, billingName: '', address: '', trn: '' }
});

const initial = () => ({
  profile: { eatingStyle: null, preferences: [], dietary: [], allergies: [] },
  profileDone: false,
  session: null,
  plan: emptyPlan(),
  user: null,
  delivery: { sameForAll: true, address: { building: '', unit: '', area: 'DIFC', handover: 'reception', notes: '' }, window: null, perDay: {} },
  orders: [],
  settings: { coffeeReminder: true },
  business: emptyBusiness(),
  businessUser: null,
  businessOrders: [],
  savedPlans: []
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...initial(), ...JSON.parse(raw) } : initial();
  } catch {
    return initial();
  }
}

const Ctx = createContext(null);

export function StoreProvider({ children }) {
  const [state, setState] = useState(load);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable — keep in memory */ }
  }, [state]);

  /** set(draft => { ...mutate draft... }) — the draft is a deep copy. */
  const set = useCallback(fn => {
    setState(prev => {
      const draft = structuredClone(prev);
      const out = fn(draft);
      return out || draft;
    });
  }, []);

  /* Once signed in, the Morning Profile and settings live on the server. */
  const synced = useRef({ profile: null, coffee: null });
  useEffect(() => {
    if (!state.session || !state.profileDone) return;
    const p = JSON.stringify(state.profile);
    if (synced.current.profile === null) { synced.current.profile = p; return; }
    if (p === synced.current.profile) return;
    synced.current.profile = p;
    put('/me/profile', state.profile).catch(() => { synced.current.profile = null; });
  }, [state.session, state.profileDone, state.profile]);
  useEffect(() => {
    if (!state.session) return;
    const c = state.settings.coffeeReminder;
    if (synced.current.coffee === null) { synced.current.coffee = c; return; }
    if (c === synced.current.coffee) return;
    synced.current.coffee = c;
    put('/me/settings', { coffeeReminder: c }).catch(() => {});
  }, [state.session, state.settings.coffeeReminder]);

  const reset = useCallback(() => setState(initial()), []);

  return <Ctx.Provider value={{ state, set, reset }}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);
