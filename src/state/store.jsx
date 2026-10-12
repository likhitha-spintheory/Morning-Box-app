import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { put, UNAUTHORISED_EVENT } from '../api.js';
import { isBeforeCutoff } from '../domain/standards.js';

const KEY = 'morningbox.app.v1';

export const emptyPlan = () => ({ dates: [], days: {} });
export const emptyBusiness = () => ({
  people: 20, hasSpecial: null, specials: [], mode: 'mix', lines: [],
  dates: [], sameForAll: true, perDay: {},
  delivery: { company: '', building: '', office: '', area: 'DIFC', contact: '', mobile: '', notes: '', window: null },
  invoice: { wanted: false, billingName: '', address: '', trn: '', po: '' }
});
export const emptyProfile = () => ({ eatingStyle: null, preferences: [], dietary: [], allergies: [], otherAllergies: '' });

const initial = () => ({
  profile: emptyProfile(),
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

/** Drop planned mornings whose 9:00 PM cutoff has passed. Returns the removed dates. */
export function pruneExpired(s) {
  const gone = s.plan.dates.filter(d => !isBeforeCutoff(d));
  if (gone.length) {
    s.plan.dates = s.plan.dates.filter(d => !gone.includes(d));
    gone.forEach(d => { delete s.plan.days[d]; });
  }
  const bizGone = (s.business.dates || []).filter(d => !isBeforeCutoff(d));
  if (bizGone.length) s.business.dates = s.business.dates.filter(d => !bizGone.includes(d));
  return gone;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initial();
    const saved = JSON.parse(raw);
    const s = { ...initial(), ...saved, profile: { ...emptyProfile(), ...(saved.profile || {}) } };
    pruneExpired(s);
    return s;
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

  /* The server ended the session (expired, signed out elsewhere): stop showing
     the customer's data and ask them to sign in again. */
  useEffect(() => {
    const onUnauthorised = () => setState(prev => (prev.session ? { ...prev, session: null, user: null, orders: [], businessOrders: [], businessUser: null } : prev));
    window.addEventListener(UNAUTHORISED_EVENT, onUnauthorised);
    return () => window.removeEventListener(UNAUTHORISED_EVENT, onUnauthorised);
  }, []);

  /* Once signed in, the Morning Profile and settings live on the server. */
  const synced = useRef({ profile: null, coffee: null });
  useEffect(() => {
    if (!state.session || !state.profileDone) { synced.current.profile = null; return; }
    const p = JSON.stringify(state.profile);
    if (synced.current.profile === null) { synced.current.profile = p; return; }
    if (p === synced.current.profile) return;
    synced.current.profile = p;
    put('/me/profile', state.profile).catch(() => { synced.current.profile = null; });
  }, [state.session, state.profileDone, state.profile]);
  useEffect(() => {
    if (!state.session) { synced.current.coffee = null; return; }
    const c = state.settings.coffeeReminder;
    if (synced.current.coffee === null) { synced.current.coffee = c; return; }
    if (c === synced.current.coffee) return;
    synced.current.coffee = c;
    put('/me/settings', { coffeeReminder: c }).catch(() => {});
  }, [state.session, state.settings.coffeeReminder]);

  /** Sign-out and "clear this device": nothing personal survives for the next person. */
  const reset = useCallback(() => setState(initial()), []);
  /** A screen that already saved the profile to the server records it here to avoid a second save. */
  const markProfileSynced = useCallback(profile => { synced.current.profile = JSON.stringify(profile); }, []);

  return <Ctx.Provider value={{ state, set, reset, markProfileSynced }}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);
