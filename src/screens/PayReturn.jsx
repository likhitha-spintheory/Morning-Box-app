/* Back from the card payment page (server/payments.js): the order or change is saved only once the
   payment is confirmed, so this screen asks the server, waits a little if the bank is still
   confirming, then carries on to the confirmation — or explains what happened. */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post } from '../api.js';
import { Screen, TopBar, Footer, Icon } from '../components/ui.jsx';
import { useStore } from '../state/store.jsx';
import { afterPersonalOrder } from './personal/Checkout.jsx';

const TRIES = 8;
const wait = ms => new Promise(r => setTimeout(r, ms));
/** Where to go back to when the payment didn't go through. */
const backTo = c => ({
  personal_order: '/checkout/review', business_order: '/business/review',
  personal_change: `/orders/${c.orderId}/${c.date}`, business_change: `/business/orders/${c.orderId}`
}[c.kind] || '/');

export default function PayReturn() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const cancelled = params.get('cancelled') === '1';
  const { set } = useStore();
  const nav = useNavigate();
  const [state, setState] = useState({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stop = false;
    (async () => {
      setState({ status: 'checking' });
      /* Coming back via "cancel" there is nothing to wait for; otherwise give the bank a few seconds. */
      const tries = cancelled ? 1 : TRIES;
      let c;
      for (let i = 0; i < tries; i++) {
        try { c = await post(`/payments/checkouts/${id}/confirm`); } catch (e) { if (!stop) setState({ status: 'error', message: e.message }); return; }
        if (stop) return;
        if (c.status === 'done') { await finish(c); return; }
        if (c.status !== 'open') { setState(c); return; }
        if (i < tries - 1) await wait(1500);
      }
      if (!stop) setState({ ...c, status: cancelled ? 'cancelled' : 'pending' });
    })();
    return () => { stop = true; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [id, attempt]);

  async function finish(c) {
    if (c.kind === 'personal_order') {
      const order = await get(`/orders/${c.result}`);
      set(s => afterPersonalOrder(s, order));
      nav(`/orders/${order.id}/confirmed`, { replace: true });
    } else if (c.kind === 'business_order') {
      const [order, { afterBusinessOrder }] = await Promise.all([get(`/business/orders/${c.result}`), import('./business/Business.jsx')]);
      set(s => afterBusinessOrder(s, order));
      nav(`/business/orders/${order.id}/confirmed`, { replace: true });
    } else if (c.kind === 'personal_change') {
      const order = await get(`/orders/${c.result}`);
      set(s => { s.orders = s.orders.map(o => (o.id === order.id ? order : o)); });
      nav(`/orders/${order.id}/${c.date}`, { replace: true });
    } else {
      const [order, { putOrder }] = await Promise.all([get(`/business/orders/${c.result}`), import('./business/Business.jsx')]);
      set(s => putOrder(s, order));
      nav(`/business/orders/${order.id}`, { replace: true });
    }
  }

  const s = state.status;
  const title = {
    checking: 'Confirming your payment…', pending: 'Still confirming with your bank', cancelled: 'Payment not completed',
    expired: 'The payment page timed out', failed: 'We couldn’t complete your order', error: 'We couldn’t check your payment'
  }[s] || 'Confirming your payment…';
  const text = {
    checking: 'One moment — please don’t close this page.',
    pending: 'This can take a minute. Nothing more is needed from you; check again shortly. You won’t be charged twice.',
    cancelled: 'Nothing was charged. Your mornings are still in your plan — you can pay when you’re ready.',
    expired: 'Nothing was charged. Your mornings are still in your plan — please try again.',
    failed: `${state.error || 'Your order could not be confirmed.'} Your payment is being refunded in full to your original payment method.`,
    error: state.message
  }[s];

  return (
    <Screen>
      <TopBar close="/"><span className="topbar-title">Payment</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 32, gap: 18 }} aria-live="polite">
        <Icon name={s === 'checking' || s === 'pending' ? 'clock' : s === 'failed' || s === 'error' ? 'alert' : 'card'} size={32} stroke={1.6} />
        <h1 className="h-display" style={{ fontSize: 30 }}>{title}</h1>
        {text && <p className="help" style={{ fontSize: 17 }}>{text}</p>}
      </main>
      {s !== 'checking' && (
        <Footer>
          {s === 'pending' || s === 'error'
            ? <button type="button" className="btn" onClick={() => setAttempt(a => a + 1)}>Check again</button>
            : <Link to={backTo(state)} className="btn">{s === 'failed' ? 'Back to my plan' : 'Try again'}</Link>}
          <Link to="/help" className="btn-text">Need help?</Link>
        </Footer>
      )}
    </Screen>
  );
}
