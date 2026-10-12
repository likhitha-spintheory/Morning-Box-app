import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { get, post } from '../api.js';
import { Screen, TopBar, Icon } from '../components/ui.jsx';
import { useStore } from '../state/store.jsx';

const ICON = { confirmed: 'check', on_the_way: 'truck', delivered: 'home', late: 'clock', refund: 'card', issue_update: 'info', reminder: 'coffee', safety_review: 'shield', cancelled: 'close', support_reply: 'mail', changed: 'card' };
const TITLE = { confirmed: 'Order confirmed', on_the_way: 'On its way', delivered: 'Delivered', late: 'Running late', refund: 'Refund', issue_update: 'Your report', reminder: 'Reminder', safety_review: 'Please review', cancelled: 'Cancelled', support_reply: 'Reply from Morning Box', changed: 'Order updated' };

/** Where a notification leads: the morning it is about, or Help for support replies. */
function linkFor(n) {
  if (n.kind === 'support_reply') return '/help';
  const [order, date] = String(n.ref || '').split(':');
  if (/^MB-[0-9A-F]{8}$/.test(order)) return date ? `/orders/${order}/${date}` : '/orders';
  if (/^MB-B-/.test(order)) return `/business/orders/${order}`;
  return null;
}
const when = ts => {
  const d = new Date(String(ts).replace(' ', 'T') + 'Z');
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/** Unread count for the bell on Today. */
export function useUnread(signedIn) {
  const [n, setN] = useState(0);
  useEffect(() => { if (signedIn) get('/me/notifications').then(list => setN(list.filter(x => !x.read).length)).catch(() => {}); }, [signedIn]);
  return n;
}

export default function Notifications() {
  const { state } = useStore();
  const [list, setList] = useState(null);
  useEffect(() => {
    if (!state.session) return;
    get('/me/notifications').then(l => { setList(l); if (l.some(x => !x.read)) post('/me/notifications/read', { ids: [] }).catch(() => {}); }).catch(() => setList([]));
  }, [state.session]);
  if (!state.session) return <Navigate to="/sign-in?next=/notifications" replace />;
  return (
    <Screen>
      <TopBar back={-1} close={null}><span className="topbar-title">Notifications</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8, gap: 18 }}>
        <h1 className="h-display" style={{ fontSize: 36 }}>Updates</h1>
        {list && !list.length && <div className="card"><span className="strong">You’re all caught up</span></div>}
        {list && list.length > 0 && (
          <section className="card" style={{ padding: '4px 20px' }}>
            {list.map(n => {
              const to = linkFor(n);
              const body = (
                <>
                  <span className="ci" style={{ flex: 'none' }}><Icon name={ICON[n.kind] || 'bell'} size={20} stroke={1.6} /></span>
                  <span className="stack" style={{ flex: 1, gap: 3 }}>
                    <span className="strong" style={{ fontSize: 16 }}>{TITLE[n.kind] || 'Update'}</span>
                    <span className="help" style={{ fontSize: 15 }}>{n.message}</span>
                    <span className="xs">{when(n.createdAt)}</span>
                  </span>
                </>
              );
              return to
                ? <Link key={n.id} to={to} className={`notice${n.read ? '' : ' unread'}`}>{body}</Link>
                : <div key={n.id} className={`notice${n.read ? '' : ' unread'}`}>{body}</div>;
            })}
          </section>
        )}
      </main>
    </Screen>
  );
}
