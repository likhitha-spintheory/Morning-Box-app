import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, post } from '../api.js';
import { Screen, TopBar, Icon, Chip } from '../components/ui.jsx';
import { useStore } from '../state/store.jsx';
import { useConfig } from '../state/config.js';
import { LEGAL_PAGES } from './Legal.jsx';

const FAQ = [
  ['How does Morning Box work?', 'Tell us how you like to eat once. For each morning you plan, we recommend a breakfast that fits your profile and your day, a partner bakery prepares it fresh, and we deliver it in the window you choose.'],
  ['When do I need to order?', 'Orders for a morning close at 9:00 PM (Dubai time) the evening before. You can plan up to four weeks ahead.'],
  ['Can I change or cancel?', 'Yes, until 9:00 PM the evening before. Open the morning from Orders and tap Edit or cancel. Cancelled mornings are refunded in full.'],
  ['Where do you deliver?', 'Within DIFC, to your building’s reception or your door, in one of three morning windows.'],
  ['How do you handle allergies?', 'We never recommend, swap in or add anything containing an allergy or dietary requirement you’ve marked. Bakeries handle common allergens, so traces can’t be ruled out. See Allergen Information.'],
  ['What if my breakfast is late or wrong?', 'Open the morning from Orders and tap Report a problem. Our team reviews every report the same day.'],
  ['When will I get my refund?', 'Refunds go back to your original payment method. Most banks show them within 5–10 working days.'],
  ['Can I order for my team?', 'Yes. Choose Business Breakfast on the home screen to order for meetings and teams, with a tax invoice.']
];
const TOPICS = ['An order', 'Delivery', 'Allergies & ingredients', 'Payments & refunds', 'My account', 'Business orders', 'Feedback or idea', 'Something else'];

export default function Help() {
  const { state } = useStore();
  const config = useConfig();
  const [params] = useSearchParams();
  const orderRef = params.get('order') || '';
  const signedIn = !!(state.session && state.user);
  const [topic, setTopic] = useState(orderRef ? 'An order' : params.get('topic') === 'business' ? 'Business orders' : '');
  const [message, setMessage] = useState(params.get('note') || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [requests, setRequests] = useState([]);
  useEffect(() => { if (signedIn) get('/support').then(setRequests).catch(() => {}); }, [signedIn, sent]);
  const s = config.support || {};

  const send = async () => {
    setBusy(true); setError('');
    try { await post('/support', { topic, message: message.trim(), orderRef: orderRef || undefined }); setSent(true); setMessage(''); setTopic(''); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <TopBar back={-1} close={null}><span className="topbar-title">Help &amp; Support</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8, gap: 22 }}>
        <h1 className="h-display" style={{ fontSize: 36 }}>How can we help?</h1>

        <section className="card list faq" aria-label="Frequently asked questions" style={{ padding: '4px 20px' }}>
          {FAQ.map(([q, a]) => (
            <details key={q} className="list-row">
              <summary><span className="strong" style={{ fontSize: 17 }}>{q}</span><Icon name="chevron" size={18} stroke={1.8} /></summary>
              <p className="help" style={{ margin: '0 0 6px', fontSize: 15.5, lineHeight: 1.55 }}>{a}</p>
            </details>
          ))}
        </section>

        {(s.whatsapp || s.phone || s.email) && (
          <section className="stack gap-12">
            <span className="eyebrow">Talk to us</span>
            <div className="card list" style={{ padding: '4px 20px' }}>
              {s.whatsapp && <a className="list-row" href={`https://wa.me/${s.whatsapp}`} target="_blank" rel="noopener noreferrer"><Icon name="phone" size={20} /><span className="strong" style={{ flex: 1 }}>WhatsApp</span><Icon name="chevron" size={18} stroke={1.8} /></a>}
              {s.phone && <a className="list-row" href={`tel:${s.phone.replace(/\s/g, '')}`}><Icon name="phone" size={20} /><span className="strong" style={{ flex: 1 }}>Call {s.phone}</span><Icon name="chevron" size={18} stroke={1.8} /></a>}
              {s.email && <a className="list-row" href={`mailto:${s.email}${orderRef ? `?subject=Order ${orderRef}` : ''}`}><Icon name="mail" size={20} /><span className="strong" style={{ flex: 1 }}>{s.email}</span><Icon name="chevron" size={18} stroke={1.8} /></a>}
            </div>
            {s.hours && <span className="xs">Open {s.hours}</span>}
          </section>
        )}

        <section className="stack gap-12" aria-labelledby="msg-h">
          <span id="msg-h" className="eyebrow">Send us a message</span>
          {!signedIn ? (
            <div className="card stack gap-12"><span className="help" style={{ fontSize: 15.5 }}>Sign in so we can reply to you.</span>
              <Link to="/sign-in?next=/help" className="btn-secondary">Sign in</Link></div>
          ) : sent ? (
            <div className="banner-ok" role="status"><Icon name="check" size={20} stroke={2} /><span>Thanks, we’ve got your message and will reply here.</span></div>
          ) : (
            <div className="card stack gap-14" style={{ padding: 20, gap: 14 }}>
              {orderRef && <span className="tag" style={{ alignSelf: 'flex-start' }}>Order {orderRef}</span>}
              <div className="chips" role="radiogroup" aria-label="Topic">{TOPICS.map(t => <Chip key={t} on={topic === t} onClick={() => setTopic(t)}>{t}</Chip>)}</div>
              <div className="field"><label htmlFor="help-m">Message</label>
                <textarea id="help-m" className="input" rows={4} maxLength={1000} value={message} onChange={e => setMessage(e.target.value)} style={{ resize: 'vertical', minHeight: 110, paddingTop: 12 }} /></div>
              {topic === 'Allergies & ingredients' && <span className="help" style={{ fontSize: 15 }}>If anyone is having a reaction, call 998 first.</span>}
              {error && <div className="banner-err" role="alert"><Icon name="alert" size={18} stroke={2} />{error}</div>}
              <button type="button" className="btn" disabled={busy || !topic || message.trim().length < 5} onClick={send}>{busy ? 'Sending…' : 'Send message'}</button>
            </div>
          )}
        </section>

        {requests.length > 0 && (
          <section className="stack gap-12">
            <span className="eyebrow">Your messages</span>
            {requests.map(r => (
              <article key={r.id} className="card stack gap-8" style={{ padding: 18 }}>
                <div className="row"><span className="strong">{r.topic}{r.orderRef ? ` · ${r.orderRef}` : ''}</span>
                  <span className={`status ${r.status === 'answered' ? 'ok' : 'prep'}`}>{r.status === 'open' ? 'Received' : r.status === 'answered' ? 'Replied' : 'Closed'}</span></div>
                <span className="help" style={{ fontSize: 15 }}>{r.message}</span>
                {r.reply && <div className="note" style={{ marginTop: 4 }}><Icon name="info" size={18} stroke={1.6} style={{ flex: 'none' }} /><span><b>Morning Box:</b> {r.reply}</span></div>}
              </article>
            ))}
          </section>
        )}

        <section className="card list" aria-label="Policies" style={{ padding: '4px 20px' }}>
          {LEGAL_PAGES.map(([id, label]) => (
            <Link key={id} to={`/legal/${id}`} className="list-row" style={{ textDecoration: 'none', color: 'var(--espresso)' }}>
              <Icon name="doc" size={20} /><span className="strong" style={{ flex: 1 }}>{label}</span><Icon name="chevron" size={18} stroke={1.8} />
            </Link>
          ))}
        </section>
      </main>
    </Screen>
  );
}
