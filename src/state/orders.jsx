import { useEffect, useState } from 'react';
import { get } from '../api.js';
import { useStore, pruneExpired } from './store.jsx';
import { Screen, TopBar } from '../components/ui.jsx';
import { dateInfo, isBeforeCutoff } from '../domain/app.js';

/**
 * One personal order by id. Opening a link to an order (notification, another
 * device) loads it from the server instead of bouncing to the order list.
 */
export function useOrder(id) {
  const { state, set } = useStore();
  const order = state.orders.find(o => o.id === id);
  const signedIn = !!state.session;
  const [missing, setMissing] = useState(false);
  /* Always refresh from the server: a copy saved on the phone may be out of date
     (status, bakery, edits made on another device). Cached data shows meanwhile. */
  useEffect(() => {
    if (!signedIn) return undefined;
    let live = true;
    setMissing(false);
    get(`/orders/${encodeURIComponent(id)}`)
      .then(o => { if (live) set(s => { s.orders = s.orders.some(x => x.id === o.id) ? s.orders.map(x => (x.id === o.id ? o : x)) : [o, ...s.orders]; }); })
      .catch(() => { if (live) setMissing(true); });
    return () => { live = false; };
  }, [id, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  return { order, loading: !order && signedIn && !missing };
}

/** Shown while an order loads from the server. */
export function Loading({ back = '/orders', title = 'Loading…' }) {
  return (
    <Screen>
      <TopBar back={back} close={null}><span className="topbar-title">{title}</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 24 }}>
        <p className="help" role="status">Loading your morning…</p>
      </main>
    </Screen>
  );
}

/**
 * Removes planned mornings whose 9:00 PM cutoff has passed (e.g. a plan left
 * open overnight) and returns a message naming them, or ''.
 */
export function usePruneExpired() {
  const { state, set } = useStore();
  const [notice, setNotice] = useState('');
  const expired = state.plan.dates.filter(d => !isBeforeCutoff(d));
  useEffect(() => {
    if (!expired.length) return;
    set(s => { pruneExpired(s); });
    setNotice(`${expired.map(d => dateInfo(d).label).join(', ')} closed at 9:00 PM the evening before and ${expired.length > 1 ? 'were' : 'was'} removed from your plan.`);
  }, [expired.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  return notice;
}
