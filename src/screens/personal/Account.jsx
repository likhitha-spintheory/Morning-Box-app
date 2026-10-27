import { useEffect, useState } from 'react';
import { get, post, put, patch, del, setToken, goToPayment } from '../../api.js';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Screen, TopBar, Footer, Icon, Logo, TabBar, Switch, Qty, Money, Chip, PhoneField, InfoTip, PhotoPicker, AreaField, Ring } from '../../components/ui.jsx';
import { download, shareText, ownerOf } from '../../api.js';
import { useUnread } from '../Notifications.jsx';
import { LEGAL_PAGES } from '../Legal.jsx';
import { useStore } from '../../state/store.jsx';
import { useConfig, closedOn } from '../../state/config.js';
import {
  CONTEXTS, DELIVERY_WINDOWS, dateInfo, todayIso, boxName, sizeLabel, extrasText, windowLabel, contextLabel,
  eatingLabel, prefLabel, dietLabel, allergyLabel, componentName, componentIcon, trackingStage,
  isBeforeCutoff, cutoffLabel, timeLeft, dayPrice, sizePrice, canChooseSize, recommendDay, addonPrice, shortPlace, serverDateIso,
  whatsappLink, containsAllergens, planningWeeks, tomorrowIso
} from '../../domain/app.js';
import { BoxEditor, FlavourPicker, offeredPastries } from '../../components/BoxEditor.jsx';
import { addonGroups } from '../../domain/engine.js';
import { FEEDBACK, addDaysIso as addDays, areasText, cutoffFor } from '../../domain/standards.js';
import { useOrder, Loading } from '../../state/orders.jsx';
import { pastedCode } from './Checkout.jsx';

function useSignedIn(path) {
  const { state } = useStore();
  return state.session && state.user ? null : <Navigate to={`/sign-in?next=${path}`} replace />;
}

/** Orders are owned by the server; refresh the local copy on screens that show them. */
function useOrders() {
  const { state, set } = useStore();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!state.session) return;
    get('/orders').then(o => set(s => { s.orders = o; }))
      .catch(e => { if (e.status !== 401) setError(e.message); });
  }, [state.session, set]);
  return error;
}
/* Demo-only control: dev server, or a build made with VITE_DEMO=1. Hidden in production. */
const SHOW_DEMO = import.meta.env.DEV || import.meta.env.VITE_DEMO === '1';
const replaceOrder = (s, order) => { s.orders = s.orders.map(o => (o.id === order.id ? order : o)); };
const ErrorBanner = ({ children }) => children
  ? <div className="banner-err" role="alert"><Icon name="alert" size={18} stroke={2} />{children}</div> : null;
const dayComma = iso => { const d = dateInfo(iso); return `${d.wd}, ${d.day} ${d.mon}`; };
const emailValid = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
const ISSUE_REASONS = ['Not delivered', 'Arrived late', 'Wrong or missing items', 'Allergy concern', 'Quality issue', 'Packaging issue', 'Something else'];
const clock = iso => iso ? new Date(iso.replace(' ', 'T') + (iso.includes('Z') || iso.includes('+') ? '' : 'Z')).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase() : null;

function allDays(orders) {
  return orders.flatMap(o => o.days.map(d => ({ ...d, orderId: o.id, createdAt: o.createdAt })));
}

function StatusPill({ day }) {
  const st = trackingStage(day);
  if (st === -1) return <span className="status off">Cancelled · refunded</span>;
  if (day.problem === 'Not Fulfilled') return <span className="status off">Not prepared · refunded</span>;
  if (day.problem === 'Failed') return <span className="status off">Delivery missed</span>;
  if (st === 3) return <span className="status done">Delivered{day.feedback ? ` · ${day.feedback}` : ''}</span>;
  if (day.safetyReview) return <span className="status off">Needs review</span>;
  if (st === 0) return <span className="status ok">Confirmed</span>;
  return <span className="status prep">{st === 1 ? 'Being prepared' : 'On its way'}</span>;
}

/* Live 9:00 PM cutoff countdown (design board: Home, Orders, Order details). Re-renders every minute. */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 60000); return () => clearInterval(t); }, []);
}
const editableDay = d => !d.cancelled && isBeforeCutoff(d.date) && trackingStage(d) === 0;
function CutoffPanel({ iso, title }) {
  const left = timeLeft(iso);
  if (!left) return null;
  const hours = Math.max(0, (cutoffFor(iso) - new Date()) / 3.6e6);
  return (
    <div className="panel row" style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: '16px 20px' }} role="status">
      <Ring fraction={Math.min(1, hours / 24)} label={`${Math.floor(hours)}h`} size={42} />
      <span className="stack" style={{ lineHeight: 1.35 }}>
        <span className="strong" style={{ fontSize: 16 }}>{title}</span>
        <span className="help" style={{ fontSize: 15 }}>Edits and free cancellation until {cutoffLabel(iso)} · {left} left</span>
      </span>
    </div>
  );
}

function DateBox({ iso }) {
  const d = dateInfo(iso);
  return <span className="datebox"><span className="wd">{d.wd}</span><span className="dn">{d.day}</span><span className="mo">{d.mon}</span></span>;
}

/* ---------- Returning user home (MB-FLW-001 §10) ---------- */
export function Today() {
  const { state, set } = useStore();
  const nav = useNavigate();
  const config = useConfig();
  const loadError = useOrders();
  const guard = useSignedIn('/today');
  useMinuteTick();
  const unread = useUnread(!!state.session);
  const [me, setMe] = useState(null);
  useEffect(() => {
    if (!state.session) return;
    get('/me').then(setMe).catch(() => {});
  }, [state.session]);
  if (guard) return guard;
  const today = todayIso();
  /* The most recent delivered morning from the last 7 days that hasn't been rated yet. */
  const toRate = allDays(state.orders).filter(d => trackingStage(d) === 3 && !d.feedback && d.date >= addDays(today, -7)).sort((a, b) => b.date.localeCompare(a.date))[0];
  const acceptTerms = () => post('/me/accept-terms').then(setMe).catch(() => {});
  const upcoming = allDays(state.orders).filter(d => !d.cancelled && d.date >= today && trackingStage(d) < 3).sort((a, b) => a.date.localeCompare(b.date));
  const next = upcoming[0];
  const lastOrder = state.orders[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const inProgress = state.plan.dates.length > 0;
  const review = upcoming.filter(d => d.safetyReview);
  /* PRD §8.2: a returning customer goes straight to Your Morning Box for the next open morning, with the
     single alternative and a link to edit preferences. Nothing is ordered until they confirm. */
  const nextOpen = planningWeeks()[0].find(d => !closedOn(config, d.iso) && !allDays(state.orders).some(x => x.date === d.iso && !x.cancelled));
  const usualContext = nextOpen && (allDays(state.orders).filter(d => !d.cancelled && dateInfo(d.date).wd === nextOpen.wd).sort((a, b) => b.date.localeCompare(a.date))[0]?.cfg?.context || 'regular');
  const suggestion = nextOpen && state.profileDone ? recommendDay(state.profile, usualContext) : null;
  const startWith = which => {
    const options = suggestion;
    set(s => { s.plan = { dates: [nextOpen.iso], days: { [nextOpen.iso]: { context: usualContext, which, options, cfg: structuredClone(options[which]), saved: false } } }; });
    nav(`/plan/day/${nextOpen.iso}/box`);
  };
  /* Have the most recent breakfast again: the customer picks the dates (MB-FLW-001 §10). */
  const quick = allDays(state.orders).filter(d => !d.cancelled).sort((a, b) => b.date.localeCompare(a.date))[0];
  /* DSN §9: one gold primary per screen — the suggestion's order button when shown, otherwise the first entry. */
  const hasSuggestion = !!(suggestion && !suggestion.none && !inProgress);

  return (
    <Screen>
      <header className="topbar">
        <Logo width={140} />
        <span className="row" style={{ gap: 10 }}>
          <Link to="/notifications" className="icon-btn bell" style={{ width: 48, height: 48 }} aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}><Icon name="bell" size={22} />{unread > 0 && <i className="badge" />}</Link>
          <Link to="/me" className="icon-btn" style={{ width: 48, height: 48 }} aria-label="My Morning Profile"><Icon name="user" size={22} /></Link>
        </span>
      </header>
      <main className="screen-main" style={{ paddingTop: 8, gap: 22 }}>
        {me && me.termsAccepted === false && (
          <div className="note" role="status"><Icon name="doc" size={20} stroke={1.6} style={{ flex: 'none' }} />
            <span style={{ flex: 1 }}>We’ve updated our <Link to="/legal/terms" className="link">Terms</Link> and <Link to="/legal/privacy" className="link">Privacy Policy</Link>.</span>
            <button type="button" className="link" onClick={acceptTerms}>OK</button></div>
        )}
        <div className="stack gap-8">
          <span className="eyebrow grey" style={{ letterSpacing: '.24em' }}>{greet}</span>
          <h1 className="h-display" style={{ fontSize: 40 }}>Hello, <em>{state.user.firstName}.</em></h1>
        </div>

        {next ? (
          <Link to={`/orders/${next.orderId}/${next.date}`} className="card row" style={{ textDecoration: 'none', alignItems: 'flex-start', gap: 16, padding: 18 }}>
            <DateBox iso={next.date} />
            <span className="stack" style={{ flex: 1, gap: 3 }}>
              <span className="eyebrow grey" style={{ letterSpacing: '.1em', fontWeight: 500 }}>{next.date === today ? 'Today' : 'Next breakfast'}</span>
              <span className="strong" style={{ fontSize: 18 }}>{boxName(next.cfg)}</span>
              <span className="help" style={{ fontSize: 15 }}>{windowLabel(next.window)} · {shortPlace(next.address.building)}</span>
            </span>
            <StatusPill day={next} />
          </Link>
        ) : (
          <div className="card"><span className="strong">No mornings planned yet</span></div>
        )}
        {next && editableDay(next) && <CutoffPanel iso={next.date} title={`${dateInfo(next.date).label} is still editable`} />}

        {toRate && (
          <section className="card stack gap-10" style={{ padding: 18 }} aria-label="Your feedback">
            <span className="strong" style={{ fontSize: 17 }}>How was {boxName(toRate.cfg)}?</span>
            <div className="grid-2">
              {[['Loved it', 'heart'], ['Not for me', 'meh']].map(([v, icon]) => (
                <Link key={v} to={`/orders/${toRate.orderId}/${toRate.date}/feedback?value=${encodeURIComponent(v)}`} className="btn-secondary"><Icon name={icon} size={20} stroke={1.6} />{v}</Link>
              ))}
            </div>
          </section>
        )}

        <ErrorBanner>{loadError}</ErrorBanner>
        {review.length > 0 && (
          <Link to={`/orders/${review[0].orderId}/${review[0].date}`} className="note" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Icon name="shield" size={20} stroke={1.6} style={{ flex: 'none' }} />
            <span><b>{review.length === 1 ? `${dateInfo(review[0].date).label} needs your review.` : `${review.length} mornings need your review.`}</b> They no longer match your allergies.</span>
          </Link>
        )}
        {inProgress && (
          <Link to="/plan/summary" className="panel row" style={{ flexDirection: 'row', textDecoration: 'none', alignItems: 'center' }}>
            <Icon name="cal" size={22} stroke={1.6} /><span style={{ flex: 1 }}><b>Plan in progress</b> · {state.plan.dates.length} morning{state.plan.dates.length > 1 ? 's' : ''}</span>
            <Icon name="chevron" size={18} stroke={1.8} />
          </Link>
        )}

        {suggestion && !suggestion.none && !inProgress && (
          <section className="card stack gap-12" style={{ padding: 18 }} aria-label="Your Morning Box">
            <span className="eyebrow row" style={{ justifyContent: 'flex-start', gap: 8 }}><Icon name="sparkle" size={16} stroke={1.6} color="var(--espresso)" />Your Morning Box · {nextOpen.iso === tomorrowIso() ? 'tomorrow' : dayComma(nextOpen.iso)}</span>
            <span className="strong" style={{ fontSize: 18 }}>{boxName(suggestion.primary)}</span>
            <span className="help" style={{ fontSize: 15 }}>{contextLabel(usualContext)} · AED {dayPrice(suggestion.primary, state.profile).total}</span>
            <button type="button" className="btn" onClick={() => startWith('primary')}>Order for {nextOpen.iso === tomorrowIso() ? 'tomorrow' : dayComma(nextOpen.iso)}</button>
            <div className="row">
              {suggestion.alternative ? <button type="button" className="btn-text" onClick={() => startWith('alternative')}>Another option: {boxName(suggestion.alternative)}</button> : <span />}
              <Link to="/me" className="link">Edit preferences</Link>
            </div>
          </section>
        )}
        {quick && (
          <Link to={`/plan/dates?reorder=${quick.orderId}:${quick.date}`} className={`entry ${hasSuggestion ? 'plain' : 'gold'}`}>
            <Icon name="repeat" size={24} stroke={1.6} />
            <span style={{ flex: 1 }}><b>Have it again</b>
              <span className="d">{boxName(quick.cfg)}</span></span>
            <Icon name="arrow" size={22} stroke={1.8} />
          </Link>
        )}
        <Link to="/start" className={`entry ${quick || hasSuggestion ? 'plain' : 'gold'}`}>
          <Icon name="sunny" size={24} stroke={1.6} />
          <span style={{ flex: 1 }}><b>Plan my mornings</b></span>
          <Icon name="arrow" size={22} stroke={1.8} />
        </Link>
        {/* FLW §1/§18: Business Breakfast stays reachable for signed-in customers (secondary). */}
        <Link to={state.businessUser ? '/business' : '/business/people'} className="option" style={{ textDecoration: 'none' }}>
          <span className="ico"><Icon name="brief" size={22} stroke={1.6} /></span>
          <span className="stack" style={{ flex: 1, gap: 2 }}>
            <span style={{ fontWeight: 600, fontSize: 18 }}>Business Breakfast</span>
            <span className="help" style={{ fontSize: 15 }}>{state.businessUser ? 'New order, reorder or a saved plan' : 'For teams & meetings'}</span>
          </span>
          <Icon name="chevron" size={18} stroke={1.8} />
        </Link>

        {lastOrder && (
          <section className="stack gap-12">
            <span className="eyebrow">Plan faster</span>
            <Link to={`/plan/dates?reuse=${lastOrder.id}`} className="option" style={{ textDecoration: 'none' }}>
              <span className="ico"><Icon name="repeat" size={22} stroke={1.6} /></span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 18 }}>Use this plan again</span>
              <Icon name="chevron" size={18} stroke={1.8} />
            </Link>
            <Link to="/orders?tab=past" className="option" style={{ textDecoration: 'none' }}>
              <span className="ico"><Icon name="box" size={22} stroke={1.6} /></span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 18 }}>Reorder a previous morning</span>
              <Icon name="chevron" size={18} stroke={1.8} />
            </Link>
          </section>
        )}

      </main>
      <TabBar active="/today" />
    </Screen>
  );
}

/* ---------- My orders ---------- */
export function Orders() {
  const { state } = useStore();
  const [params, setParams] = useSearchParams();
  const loadError = useOrders();
  const guard = useSignedIn('/orders');
  useMinuteTick();
  if (guard) return guard;
  const tab = params.get('tab') || 'upcoming';
  const today = todayIso();
  const days = allDays(state.orders);
  const isPast = d => d.cancelled || d.date < today || trackingStage(d) === 3;
  const list = days.filter(d => (tab === 'past' ? isPast(d) : !isPast(d)))
    .sort((a, b) => (tab === 'past' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));

  return (
    <Screen>
      <TopBar close={null}><span className="topbar-title">Orders</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 4, gap: 16 }}>
        <h1 className="h-display" style={{ fontSize: 38 }}>Your mornings</h1>
        <div className="seg" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }} role="tablist">
          {['upcoming', 'past'].map(t => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setParams({ tab: t })}>
              {t === 'upcoming' ? 'Upcoming' : 'Past'}
            </button>
          ))}
        </div>
        <ErrorBanner>{loadError}</ErrorBanner>
        {!list.length && (
          <div className="card stack gap-12">
            <span className="strong">{tab === 'past' ? 'No past mornings yet' : 'No upcoming mornings'}</span>
            <Link to="/start" className="btn-secondary">Plan my mornings</Link>
          </div>
        )}
        {list.map(d => (
          <div key={d.orderId + d.date} className="card stack gap-12" style={{ padding: 18 }}>
            <Link to={`/orders/${d.orderId}/${d.date}`} className="row" style={{ textDecoration: 'none', alignItems: 'flex-start', gap: 16 }}>
              <DateBox iso={d.date} />
              <span className="stack" style={{ flex: 1, gap: 3, minWidth: 0 }}>
                <span className="strong" style={{ fontSize: 17 }}>{boxName(d.cfg)}</span>
                <span className="help" style={{ fontSize: 15 }}>{canChooseSize(d.cfg) ? sizeLabel(d.cfg.size) : 'Standard'} · {windowLabel(d.window)}</span>
                {tab !== 'past' && editableDay(d) && timeLeft(d.date) && <span className="xs row" style={{ justifyContent: 'flex-start', gap: 6 }}><Icon name="clock" size={14} stroke={1.8} />Changes close in {timeLeft(d.date)}</span>}
              </span>
              <StatusPill day={d} />
            </Link>
            {tab === 'past' && !d.cancelled && (
              <div className="row">
                {trackingStage(d) === 3 && !d.feedback ? <Link to={`/orders/${d.orderId}/${d.date}/feedback`} className="link">Rate this morning</Link> : <span />}
                <span className="row" style={{ gap: 8 }}>
                  {/* PER §3.2: any earlier multi-day plan can be reused for chosen dates. */}
                  {(state.orders.find(o => o.id === d.orderId)?.days.length || 0) > 1 && state.orders.find(o => o.id === d.orderId).days.find(x => !x.cancelled)?.date === d.date && (
                    <Link to={`/plan/dates?reuse=${d.orderId}`} className="link">Use this plan again</Link>
                  )}
                  <Link to={`/plan/dates?reorder=${d.orderId}:${d.date}`} className="swap-btn" style={{ textDecoration: 'none' }}><Icon name="repeat" size={16} stroke={1.7} />Order again</Link>
                </span>
              </div>
            )}
          </div>
        ))}
      </main>
      <TabBar active="/orders" />
    </Screen>
  );
}

/* ---------- Order tracking (style-1 P19, MB-DLV-001 §5) ---------- */
/* Illustration of the trip from the bakery to you. Progress follows the
   order's status (prepared → out for delivery → delivered); it is not a
   GPS position. */
function RouteCard({ stage, label }) {
  const p = stage <= 0 ? 0 : stage === 1 ? 0.12 : stage === 2 ? 0.7 : 1;
  const path = 'M70 380 C 140 300, 200 290, 300 288 S 430 288, 470 250 S 540 150, 580 120';
  return (
    <div className="route">
      <svg viewBox="0 0 700 420" role="img" aria-label={`Delivery progress: ${Math.round(p * 100)}%`}>
        <rect width="700" height="420" fill="#EFE4D2" />
        <g stroke="#E5D6BD" strokeWidth="26" fill="none">
          <path d="M0 110 H700" /><path d="M0 290 H700" /><path d="M160 0 V420" /><path d="M480 0 V420" /><path d="M0 420 L330 100" />
        </g>
        <g fill="#E9DcC8">
          <rect x="30" y="160" width="100" height="100" rx="14" /><rect x="200" y="160" width="110" height="100" rx="14" />
          <rect x="340" y="160" width="110" height="100" rx="14" /><rect x="520" y="320" width="140" height="80" rx="14" />
        </g>
        <path d={path} fill="none" stroke="#3B2D22" strokeWidth="5" strokeDasharray="4 12" strokeLinecap="round" />
        <path d={path} fill="none" stroke="#D99A12" strokeWidth="9" strokeLinecap="round" pathLength="1" strokeDasharray={`${p} 1`} />
        <circle cx="70" cy="380" r="14" fill="#fff" stroke="#3B2D22" strokeWidth="5" />
        <circle cx="580" cy="120" r="18" fill="#3B2D22" /><circle cx="580" cy="120" r="7" fill="#fff" />
        <g transform="translate(470 152)"><rect x="-6" y="-6" width="220" height="62" rx="31" fill="#3B2D22" /><text x="104" y="35" textAnchor="middle" fill="#FBF7EF" fontFamily="Inter, sans-serif" fontSize="26" fontWeight="600">{label}</text></g>
      </svg>
      <span className="badge-float" style={{ top: 16, left: 16 }}><Icon name="map" size={18} stroke={1.6} />{areasText()}</span>
    </div>
  );
}

export function OrderDay() {
  const { id, date } = useParams();
  const { state, set } = useStore();
  const guard = useSignedIn(`/orders/${id}/${date}`);
  const { order, loading } = useOrder(id);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(() => new Date());
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState('');
  const [reportError, setReportError] = useState('');
  useMinuteTick();
  const day = order?.days.find(d => d.date === date);
  const live = !!day && !day.cancelled && trackingStage(day) < 3 && date <= todayIso();
  /* While a morning is in progress, refresh its status every 30 seconds. */
  useEffect(() => {
    if (!live || !state.session) return undefined;
    const t = setInterval(() => {
      get(`/orders/${id}`).then(o => { set(s => replaceOrder(s, o)); setUpdated(new Date()); }).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [live, id, state.session, set]);
  if (guard) return guard;
  if (loading) return <Loading />;
  if (!day) return <Navigate to="/orders" replace />;
  const st = trackingStage(day);
  const editable = !day.cancelled && isBeforeCutoff(date) && st === 0;
  const nextEditable = order.days.find(d => !d.cancelled && d.date !== date && isBeforeCutoff(d.date) && trackingStage(d) === 0);
  const wd = dateInfo(date).long.split(',')[0];
  const heading = st === -1 ? 'This morning was cancelled' : st === 3 ? 'Delivered. Enjoy!' : st === 2 ? 'On its way to you' : st === 1 ? 'Being prepared fresh' : `All set for ${wd}`;
  const advance = async () => {
    setBusy(true);
    try { await post('/demo/advance', { orderId: id, date }); const o = await get(`/orders/${id}`); set(s => replaceOrder(s, o)); }
    catch { /* demo helper only */ } finally { setBusy(false); }
  };
  /* Amounts come from the order as charged, never re-priced on the device. */
  const price = { total: day.price };
  const refund = day.refund || day.price;
  /* From the delivery morning, or as soon as the box is out for delivery. */
  const canReport = !day.cancelled && (date <= todayIso() || trackingStage(day) >= 2);
  const sendReport = async () => {
    setBusy(true); setReportError('');
    try {
      const o = await post(`/orders/${id}/days/${date}/issue`, { reason, note: note.trim(), ...(photo ? { photo } : {}) });
      set(s => replaceOrder(s, o)); setReporting(false); setReason(''); setNote(''); setPhoto('');
    } catch (e) { setReportError(e.message); } finally { setBusy(false); }
  };
  const steps = [
    { t: 'Order confirmed', d: dayComma(serverDateIso(order.createdAt)), time: clock(order.createdAt), icon: 'check' },
    { t: 'Being prepared', d: day.bakery ? `Prepared by ${day.bakery}` : '', icon: 'check' },
    { t: 'Out for delivery', d: day.lateNote ? `Running late · now around ${day.lateNote}` : '', icon: 'truck' },
    { t: 'Delivered', d: st === 3 ? `Delivered to ${day.deliveryPoint || 'Reception'}` : '', time: st === 3 ? clock(day.deliveredAt) : null, icon: 'home' }
  ];
  const shortBuilding = shortPlace(day.address.building);

  return (
    <Screen>
      <TopBar back="/orders" close={null}><span className="topbar-title">{dayComma(date)} · {id}</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 4, gap: 18 }}>
        <div className="row">
          {st === 1 || st === 2 ? <span className="live"><i />Updated {updated.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}</span> : <StatusPill day={day} />}
          {st >= 0 && <span className="status prep" style={{ fontSize: 15, padding: '8px 14px' }}>{windowLabel(day.window)}</span>}
        </div>
        <div className="stack gap-4">
          <h1 className="h-display" style={{ fontSize: 38 }}>{heading}</h1>
          {st !== 0 && st !== 1 && st !== 2 && <span className="help" style={{ fontSize: 17 }}>{st === 3 ? `${day.address.handover === 'door' ? 'At your door' : 'At reception'} · ${day.address.building}` : `Refund of AED ${refund} to your original payment method`}</span>}
        </div>

        {day.problem && (
          <div className="banner-warn" role="alert">
            <Icon name="alert" size={18} stroke={2} color="var(--warn)" style={{ flex: 'none' }} />
            <span>{day.problem === 'Not Fulfilled' ? 'We’re sorry — we couldn’t prepare this breakfast.' : 'We couldn’t hand over your breakfast. Our team will contact you.'}{day.recoveryRefund ? ` AED ${day.recoveryRefund} is being refunded to your original payment method.` : ''}</span>
          </div>
        )}
        {!day.problem && day.recoveryRefund > 0 && <div className="note"><Icon name="card" size={20} stroke={1.6} style={{ flex: 'none' }} /><span>AED {day.recoveryRefund} refunded to your original payment method.</span></div>}
        {day.safetyReview && (
          <div className="banner-warn" role="alert">
            <Icon name="shield" size={18} stroke={2} color="var(--warn)" style={{ flex: 'none' }} />
            <span>This breakfast no longer matches your allergies.{editable ? ' Please update or cancel it.' : ' Our team will contact you.'}</span>
          </div>
        )}

        {st >= 0 && <RouteCard stage={st} label={shortBuilding.length > 16 ? shortBuilding.slice(0, 15) + '…' : shortBuilding} />}

        {st >= 0 && (
          <section className="card track" style={{ padding: '6px 20px' }} aria-label="Delivery progress">
            {steps.map((s, i) => {
              const cls = i < st || st === 3 ? 'done' : i === st ? 'current' : '';
              return (
                <div key={s.t} className={`ts ${cls}`}>
                  <span className="b">{cls === 'done' ? <Icon name="check" size={17} stroke={2.2} /> : <Icon name={s.icon} size={17} stroke={1.8} />}</span>
                  <span className="t stack"><span className="strong" style={{ fontSize: 18, color: cls ? 'var(--espresso)' : 'var(--text-3)' }}>{s.t}</span>{s.d && <span className="help" style={{ fontSize: 15 }}>{s.d}</span>}</span>
                  <span className="time">{cls ? s.time || '' : '—'}</span>
                </div>
              );
            })}
          </section>
        )}

        <section className="card stack gap-10" style={{ padding: 20 }}>
          <div className="row"><span className="strong" style={{ fontSize: 17 }}>{boxName(day.cfg)} · {canChooseSize(day.cfg) ? sizeLabel(day.cfg.size) : 'Standard'}</span><Money value={price.total} /></div>
          <span className="help" style={{ fontSize: 15 }}>{day.cfg.components.map(componentName).join(' · ')}{day.cfg.addons.length ? ` · + ${extrasText(day.cfg.addons)}` : ''}</span>
          {containsAllergens(day.cfg).length > 0 && <span className="xs">Contains: {containsAllergens(day.cfg).join(', ')} <InfoTip label="About allergens">Prepared in a kitchen that handles other allergens, so traces can’t be ruled out. <Link to="/legal/allergens" className="link" style={{ color: 'inherit' }}>Allergen information</Link></InfoTip></span>}
        </section>

        {editable && <CutoffPanel iso={date} title="You can still make changes" />}
        {editable && <Link to={`/orders/${id}/${date}/edit`} className={day.safetyReview ? 'btn' : 'btn-secondary'}>{day.safetyReview ? 'Review this morning' : 'Edit or cancel this morning'}</Link>}
        {!editable && st >= 0 && st < 3 && (
          <div className="note"><Icon name="clock" size={20} stroke={1.6} style={{ flex: 'none' }} />
            <span>{st > 0 ? 'Being prepared — changes are closed.' : 'Changes for this morning are closed.'}{nextEditable ? ` ${dateInfo(nextEditable.date).label} can still be edited.` : ''}</span></div>
        )}
        {st === 3 && !day.feedback && <Link to={`/orders/${id}/${date}/feedback`} className="btn">How was your morning?</Link>}
        {day.issues?.length > 0 && (
          <div className="note" role="status"><Icon name="info" size={20} stroke={1.6} style={{ flex: 'none' }} />
            <span>You reported: {day.issues.map(i => i.reason).join(', ')}. We’ll be in touch.</span></div>
        )}
        {canReport && !reporting && (
          <button type="button" className="btn-text" style={{ alignSelf: 'center' }} onClick={() => setReporting(true)}>Report a problem</button>
        )}
        {canReport && reporting && (
          <section className="card stack gap-12" style={{ padding: 20 }} aria-label="Report a problem">
            <span className="strong" style={{ fontSize: 17 }}>What went wrong?</span>
            <div className="chips">{ISSUE_REASONS.map(r => <Chip key={r} on={reason === r} onClick={() => setReason(r)}>{r}</Chip>)}</div>
            <div className="field"><label htmlFor="rp-n">Tell us more <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
              <input id="rp-n" className="input" maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></div>
            <PhotoPicker value={photo} onChange={setPhoto} />
            {reason === 'Allergy concern' && <span className="help" style={{ fontSize: 15 }}>If anyone is having a reaction, call 998 for an ambulance first.</span>}
            <ErrorBanner>{reportError}</ErrorBanner>
            <div className="grid-2"><button type="button" className="btn-secondary" onClick={() => setReporting(false)}>Not now</button>
              <button type="button" className="btn" disabled={!reason || busy} onClick={sendReport}>{busy ? 'Sending…' : 'Send report'}</button></div>
          </section>
        )}
        {nextEditable && !editable && <Link to={`/orders/${id}/${nextEditable.date}/edit`} className="btn-secondary">Manage {dateInfo(nextEditable.date).label}</Link>}
        {day.events?.length > 0 && (
          <details className="card activity" style={{ padding: '4px 20px' }}>
            <summary className="row" style={{ minHeight: 52, cursor: 'pointer' }}><span className="strong">Order activity</span><Icon name="chevron" size={18} stroke={1.8} /></summary>
            <ol className="stack gap-10" style={{ listStyle: 'none', margin: 0, padding: '0 0 16px' }}>
              {day.events.map((e, i) => <li key={i} className="stack" style={{ gap: 2 }}><span style={{ fontSize: 15 }}>{e.message}</span><span className="xs">{dayComma(serverDateIso(e.createdAt))} · {clock(e.createdAt)}</span></li>)}
            </ol>
          </details>
        )}
        <div className="row" style={{ justifyContent: 'center', gap: 22, flexWrap: 'wrap' }}>
          <button type="button" className="btn-text" onClick={() => download(`/orders/${id}/receipt`, `Morning-Box-receipt-${id}.html`).catch(() => {})}><Icon name="download" size={16} /> Receipt</button>
          {!day.cancelled && st < 3 && <button type="button" className="btn-text" onClick={() => download(`/orders/${id}/calendar`, `Morning-Box-${id}.ics`, 'text/calendar').catch(() => {})}><Icon name="cal" size={16} /> Add to calendar</button>}
          {!day.cancelled && <button type="button" className="btn-text" onClick={() => shareText(`My Morning Box for ${dayComma(date)}: ${boxName(day.cfg)}, ${windowLabel(day.window)} at ${shortBuilding}. Order ${id}.`).catch(() => {})}><Icon name="share" size={16} /> Share</button>}
          <Link to={`/help?order=${id}`} className="btn-text"><Icon name="help" size={16} /> Get help</Link>
        </div>
        {whatsappLink() && <a href={whatsappLink(`Hi Morning Box, about order ${id} (${dayComma(date)}): `)} target="_blank" rel="noopener noreferrer" className="btn-text" style={{ alignSelf: 'center' }}>Chat with us on WhatsApp</a>}
        {SHOW_DEMO && !day.cancelled && st < 3 && <button className="btn-text" disabled={busy} style={{ alignSelf: 'center', fontSize: 13, color: 'var(--text-3)' }} onClick={advance}>Demo: advance delivery status</button>}
      </main>
      <TabBar active="/orders" />
    </Screen>
  );
}

/* ---------- Edit or cancel a morning (MB-DLV-001 §2, §11) ---------- */
export function EditMorning() {
  const { id, date } = useParams();
  const { state, set } = useStore();
  const nav = useNavigate();
  const guard = useSignedIn(`/orders/${id}/${date}/edit`);
  const { order, loading } = useOrder(id);
  const day = order?.days.find(d => d.date === date);
  /* A morning on safety review starts from a fresh, safe recommendation for the same morning type. */
  const startCfg = () => {
    if (!day.safetyReview) return day.cfg;
    const r = recommendDay(state.profile, day.cfg.context);
    return r.none ? null : { ...r.primary, size: canChooseSize(r.primary) ? (day.cfg.size === 'standard' ? 'regular' : day.cfg.size) : 'standard', addons: [] };
  };
  const [draft, setDraft] = useState(null);
  const [ctxError, setCtxError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [avail, setAvail] = useState({});
  const [moreBread, setMoreBread] = useState(false);
  const config = useConfig();
  useEffect(() => { if (day && !draft) setDraft(structuredClone({ cfg: startCfg(), window: day.window, address: { notes: '', ...day.address } })); }, [!!day]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { get(`/availability?dates=${date}`).then(a => setAvail(a[date] || {})).catch(() => {}); }, [date]);
  if (guard) return guard;
  if (loading || (day && !draft)) return <Loading back={`/orders/${id}/${date}`} />;
  if (!day) return <Navigate to="/orders" replace />;
  if (!isBeforeCutoff(date) || day.cancelled || trackingStage(day) > 0) return <Navigate to={`/orders/${id}/${date}`} replace />;

  const noSafe = !draft.cfg;
  const price = noSafe ? { total: 0 } : dayPrice(draft.cfg, state.profile);
  const groups = addonGroups(state.profile);
  const pastry = groups.find(g => g.id === 'pastry');
  const bread = groups.find(g => g.id === 'bread');
  const flavours = config.danishFlavours || [];
  const qtyOf = item => draft.cfg.addons.find(a => a.item === item && !a.unit)?.qty || 0;
  const flavourOf = item => draft.cfg.addons.find(a => a.item === item && !a.unit)?.flavour;
  const setPastry = (item, q, f = flavourOf(item)) => setDraft(d => {
    const n = structuredClone(d);
    n.cfg.addons = n.cfg.addons.filter(a => !(a.item === item && !a.unit));
    const flavour = item === 'fruitDanish' ? (flavours.includes(f) ? f : flavours[0]) : null;
    if (q > 0) n.cfg.addons.push(flavour ? { group: 'pastry', item, qty: q, flavour } : { group: 'pastry', item, qty: q });
    return n;
  });
  const loafOf = item => draft.cfg.addons.find(a => a.item === item && a.unit);
  const setLoaf = (item, unit, q) => setDraft(d => {
    const n = structuredClone(d);
    n.cfg.addons = n.cfg.addons.filter(a => !(a.item === item && a.unit));
    if (q > 0) n.cfg.addons.push({ group: 'bread', item, unit, qty: q });
    return n;
  });
  const windowFull = w => w !== day.window && avail[w] && !avail[w].available;
  /* The other recommended breakfast is one tap away. */
  const options = noSafe ? null : recommendDay(state.profile, draft.cfg.context);
  const other = options && !options.none ? [options.primary, options.alternative].find(o => o && o.recipeId !== draft.cfg.recipeId) : null;
  const useOther = () => setDraft(d => ({ ...d, cfg: { ...structuredClone(other), size: canChooseSize(other) ? (d.cfg.size === 'standard' ? 'regular' : d.cfg.size) : 'standard', addons: d.cfg.addons } }));
  const breadItems = bread ? bread.items.filter((item, i) => moreBread || loafOf(item) || i < 2) : [];
  const changeContext = ctx => {
    const r = recommendDay(state.profile, ctx);
    if (r.none) { setCtxError(`No safe ${contextLabel(ctx)} breakfast matches your profile. Your current breakfast is kept.`); return; }
    setCtxError('');
    setDraft(d => ({ ...d, cfg: { ...r.primary, size: canChooseSize(r.primary) ? (d.cfg.size === 'standard' ? 'regular' : d.cfg.size) : 'standard', addons: d.cfg.addons } }));
  };
  const run = async fn => {
    setBusy(true); setError('');
    try {
      const o = await fn();
      if (o.checkout) return goToPayment(o.checkout);   // the change costs more: pay the difference first
      set(s => replaceOrder(s, o)); nav(`/orders/${id}/${date}`);
    }
    catch (e) { setError(e.message); setBusy(false); }
  };
  /* Only what changed is sent: a window-only change keeps the breakfast exactly as ordered. */
  const recipe = c => ({ context: c.context, recipeId: c.recipeId, components: c.components, size: c.size, addons: c.addons, ...(c.components.includes('fruitDanish') ? { danishFlavour: c.danishFlavour } : {}) });
  const recipeChanged = day.safetyReview || JSON.stringify(recipe(draft.cfg)) !== JSON.stringify(recipe(day.cfg));
  /* FLW §8: the delivery location of this morning can change before cutoff too. */
  const setAddr = (k, v) => setDraft(d => ({ ...d, address: { ...d.address, [k]: v } }));
  const addrChanged = ['building', 'unit', 'area', 'handover', 'notes'].some(k => (draft.address[k] || '') !== (day.address[k] || ''));
  const addrOk = !!(draft.address.building.trim() && draft.address.unit.trim());
  const save = () => {
    if (addrChanged && !addrOk) { setError('Add your building and office or floor.'); return; }
    run(() => patch(`/orders/${id}/days/${date}`, { ...(recipeChanged ? recipe(draft.cfg) : {}), window: draft.window, ...(addrChanged ? { address: draft.address } : {}) }));
  };
  const cancel = () => run(() => post(`/orders/${id}/days/${date}/cancel`));

  return (
    <Screen>
      <TopBar back={`/orders/${id}/${date}`} close={null}><span className="topbar-title">Manage morning</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 4, gap: 22 }}>
        <div className="ruled"><span className="eyebrow grey">Editing</span><span className="date-title">{dateInfo(date).long}</span></div>
        {day.safetyReview && (
          <div className="banner-warn" role="alert">
            <Icon name="shield" size={18} stroke={2} color="var(--warn)" style={{ flex: 'none' }} />
            <span>{noSafe
              ? 'Nothing on our menu safely matches your profile for this morning. Please cancel it for a full refund.'
              : `Your breakfast no longer matches your profile. We suggest ${boxName(draft.cfg)} instead.`}</span>
          </div>
        )}
        <div className="panel" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Icon name="clock" size={24} stroke={1.6} />
          <span className="strong" style={{ flex: 1 }}>Editable until {cutoffLabel(date)}</span>
          <InfoTip label="About changes">{timeLeft(date)} left. If the price changes, we’ll charge or refund the difference to your original payment method.</InfoTip>
        </div>

        {!noSafe && <section className="stack gap-12">
          <h2 className="h3" style={{ fontSize: 19 }}>Morning type</h2>
          <div className="chips">
            {CONTEXTS.map(c => <Chip key={c.id} on={draft.cfg.context === c.id} onClick={() => changeContext(c.id)}>{c.label}</Chip>)}
          </div>
          {ctxError && <span className="err-msg"><Icon name="alert" size={14} stroke={2.2} />{ctxError}</span>}
        </section>}

        {!noSafe && <section className="stack gap-12">
          <h2 className="h3" style={{ fontSize: 19 }}>{boxName(draft.cfg)}</h2>
          <BoxEditor cfg={draft.cfg} profile={state.profile} onChange={c => setDraft(d => ({ ...d, cfg: c }))} />
          {other && (
            <button type="button" onClick={useOther} className="row" aria-label="Choose the other breakfast"
              style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--sand-soft)', border: 0, borderRadius: 24, padding: '18px 20px' }}>
              <span className="stack" style={{ gap: 4 }}>
                <span className="eyebrow grey" style={{ letterSpacing: '.14em' }}>Or choose</span>
                <span className="strong" style={{ fontSize: 18 }}>{boxName(other)}</span>
              </span>
              <Icon name="chevron" size={20} stroke={1.8} />
            </button>
          )}
        </section>}

        {!noSafe && canChooseSize(draft.cfg) && (
          <section className="stack gap-12">
            <h2 className="h3" style={{ fontSize: 19 }}>Size</h2>
            <div className="seg tall" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }} role="radiogroup">
              {['light', 'regular', 'large'].map(sz => (
                <button key={sz} role="radio" aria-checked={draft.cfg.size === sz} className={draft.cfg.size === sz ? 'on' : ''}
                  onClick={() => setDraft(d => ({ ...d, cfg: { ...d.cfg, size: sz } }))}>
                  <b className="row" style={{ gap: 6, fontWeight: 600 }}>{draft.cfg.size === sz && <Icon name="check" size={16} stroke={2.2} />}{sizeLabel(sz)}</b><span>AED {sizePrice(draft.cfg, sz)}</span></button>
              ))}
            </div>
          </section>
        )}

        {!noSafe && pastry && (
          <section className="stack gap-12">
            <h2 className="h3" style={{ fontSize: 19 }}>Pastry extras</h2>
            <div className="card list">
              {offeredPastries(pastry.items, flavours).map(item => (
                <div key={item}>
                  <div className="list-row">
                    <span className="ci"><Icon name="croissant" size={22} stroke={1.5} /></span>
                    <span className="stack" style={{ flex: 1 }}><span style={{ fontSize: 17, fontWeight: 500 }}>{componentName(item)}</span><span className="sm">AED {addonPrice({ group: 'pastry', item, qty: 1 })} each</span></span>
                    <Qty value={qtyOf(item)} max={9} label={componentName(item)} onChange={q => setPastry(item, q)} />
                  </div>
                  {item === 'fruitDanish' && qtyOf(item) > 0 && <FlavourPicker value={flavourOf(item)} flavours={flavours} onChange={f => setPastry(item, qtyOf(item), f)} />}
                </div>
              ))}
            </div>
          </section>
        )}

        {!noSafe && bread && (
          <section className="stack gap-12">
            <div className="row"><h2 className="h3" style={{ fontSize: 19 }}>Bread to take home</h2><span className="xs">Half or whole loaf</span></div>
            <div className="card list">
              {breadItems.map(item => {
                const l = loafOf(item);
                return (
                  <div key={item} className="list-row">
                    <span className="ci"><Icon name="bread" size={22} stroke={1.5} /></span>
                    <span className="stack" style={{ flex: 1 }}><span style={{ fontSize: 17, fontWeight: 500 }}>{componentName(item)}</span>
                      <span className="sm">
                        {['half', 'whole'].map((u, k) => (
                          <span key={u}>{k ? ' · ' : ''}
                            <button type="button" disabled={!l} onClick={() => setLoaf(item, u, l.qty)} aria-pressed={l?.unit === u}
                              style={{ background: 'none', border: 0, padding: '12px 2px', minHeight: 44, font: 'inherit', color: 'inherit', cursor: l ? 'pointer' : 'default', textDecoration: l?.unit === u ? 'underline' : 'none', textUnderlineOffset: 3 }}>
                              {u === 'half' ? 'Half loaf' : 'Whole loaf'} · AED {addonPrice({ group: 'bread', item, unit: u, qty: 1 })}
                            </button>
                          </span>
                        ))}
                      </span></span>
                    <Qty value={l?.qty || 0} max={9} label={componentName(item)} onChange={q => setLoaf(item, l?.unit || 'half', q)} />
                  </div>
                );
              })}
            </div>
            {breadItems.length < bread.items.length && (
              <button type="button" className="btn-text" style={{ alignSelf: 'flex-start', textDecoration: 'none', color: 'var(--text-3)' }} onClick={() => setMoreBread(true)}>+ {bread.items.length - breadItems.length} more bread{bread.items.length - breadItems.length > 1 ? 's' : ''}</button>
            )}
          </section>
        )}

        {!noSafe && <section className="stack gap-12">
          <h2 className="h3" style={{ fontSize: 19 }}>Delivery window</h2>
          <div className="stack gap-10">
            {DELIVERY_WINDOWS.map(w => (
              <button key={w.id} type="button" className={`win${draft.window === w.id ? ' on' : ''}`} role="radio" aria-checked={draft.window === w.id} disabled={windowFull(w.id)} onClick={() => setDraft(d => ({ ...d, window: w.id }))}>
                <span className="ico"><Icon name={w.id === 'w1' ? 'sunrise' : 'sunny'} size={22} stroke={1.6} /></span>
                <span style={{ fontSize: 18, fontWeight: 600, flex: 1 }}>{w.label}</span>
                {windowFull(w.id) ? <span className="tag" style={{ marginLeft: 'auto' }}>Full</span> : <span className="dot">{draft.window === w.id && <Icon name="check" size={15} stroke={2.2} />}</span>}
              </button>
            ))}
          </div>
        </section>}

        {!noSafe && <section className="card stack gap-12" style={{ padding: 20 }} aria-labelledby="ed-addr">
          <h2 id="ed-addr" className="h3" style={{ fontSize: 19 }}>Delivery address</h2>
          <div className="field"><label htmlFor="ed-b">Building / Tower</label>
            <input id="ed-b" className="input" value={draft.address.building} onChange={e => setAddr('building', e.target.value)} /></div>
          <div className="grid-2">
            <div className="field"><label htmlFor="ed-u">Office / Floor</label>
              <input id="ed-u" className="input" value={draft.address.unit} onChange={e => setAddr('unit', e.target.value)} /></div>
            <AreaField id="ed-ar" value={draft.address.area} onChange={v => setAddr('area', v)} />
          </div>
          <div className="stack gap-8">
            <span className="label">Hand over at</span>
            <div className="chips">
              <Chip on={draft.address.handover !== 'door'} onClick={() => setAddr('handover', 'reception')}>Reception</Chip>
              <Chip on={draft.address.handover === 'door'} onClick={() => setAddr('handover', 'door')}>My door</Chip>
            </div>
          </div>
          <div className="field"><label htmlFor="ed-n">Delivery notes <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
            <input id="ed-n" className="input" maxLength={200} value={draft.address.notes || ''} onChange={e => setAddr('notes', e.target.value)} /></div>
        </section>}

        {!noSafe && price.total !== day.price && <p className="help" style={{ fontSize: 15, margin: 0 }}>Was AED {day.price}. We’ll charge or refund the difference.</p>}

        <section className="stack gap-10" style={{ marginTop: 4 }}>
          {!confirmCancel ? (
            <button className="btn-text" style={{ alignSelf: 'center', color: 'var(--err)', textDecorationColor: '#D9A79E' }} onClick={() => setConfirmCancel(true)}>Cancel this morning</button>
          ) : (
            <div className="card stack gap-12" role="alertdialog" aria-labelledby="cc">
              <strong id="cc" style={{ fontSize: 18 }}>Cancel {dateInfo(date).label}?</strong>
              <span className="help" style={{ fontSize: 15.5 }}>You’ll get a full refund of AED {day.price}.</span>
              <div className="grid-2"><button className="btn-secondary" onClick={() => setConfirmCancel(false)}>Keep it</button><button className="btn-danger" disabled={busy} onClick={cancel}>Yes, cancel</button></div>
            </div>
          )}
        </section>
        <ErrorBanner>{error}</ErrorBanner>
      </main>
      <Footer sheet>
        {!noSafe && <div className="row" style={{ alignItems: 'flex-end' }}><span className="sm" style={{ fontSize: 15 }}>This morning</span><span style={{ font: '700 26px/1.15 var(--sans)' }}>AED {price.total}</span></div>}
        <button className="btn" disabled={busy || noSafe} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
      </Footer>
    </Screen>
  );
}

/* ---------- Delivered & feedback (style-1 P20) ----------
   MB-PRD-001 §12: Loved it or Not for me; after Not for me, an optional predefined reason. */
const REASONS = ['Not my taste', 'Too much', 'Too little', 'Not fresh enough'];
export function Feedback() {
  const { id, date } = useParams();
  const [params] = useSearchParams();
  const { state, set } = useStore();
  const [error, setError] = useState('');
  const guard = useSignedIn(`/orders/${id}/${date}/feedback`);
  const { order, loading } = useOrder(id);
  const day = order?.days.find(d => d.date === date);
  const [choice, setChoice] = useState(() => FEEDBACK.includes(params.get('value')) ? params.get('value') : null);
  const [reasons, setReasons] = useState([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!day) return;
    if (day.feedback) setChoice(day.feedback);
    setReasons(day.feedbackReasons || []);
  }, [!!day]); // eslint-disable-line react-hooks/exhaustive-deps
  if (guard) return guard;
  if (loading) return <Loading />;
  if (!day) return <Navigate to="/orders" replace />;
  /* Feedback can be changed for 7 days after delivery (the server enforces the limit). */
  const sent = !!day.feedback && !editing;
  /* PRD §12: one short predefined reason. */
  const toggle = r => setReasons(x => (x.includes(r) ? [] : [r]));
  const send = () => {
    setBusy(true);
    post(`/orders/${id}/days/${date}/feedback`, { value: choice, reasons: choice === 'Not for me' ? reasons : [] })
      .then(o => { setError(''); setEditing(false); set(s => replaceOrder(s, o)); })
      .catch(e => setError(e.message)).finally(() => setBusy(false));
  };
  const time = clock(day.deliveredAt);

  return (
    <Screen>
      <TopBar back={`/orders/${id}/${date}`} close={null}><span className="topbar-title">{dayComma(date)}</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 4, gap: 20 }}>
        <div className="card row" style={{ justifyContent: 'flex-start', gap: 16, padding: '18px 20px' }}>
          <span style={{ width: 46, height: 46, borderRadius: 999, background: 'var(--espresso)', color: 'var(--ivory)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name="check" size={22} stroke={2} /></span>
          <span className="strong" style={{ fontSize: 17 }}>Delivered to {day.deliveryPoint || (day.address.handover === 'door' ? 'your door' : 'Reception')}{time ? ` · ${time}` : ''}</span>
        </div>

        <div style={{ borderRadius: 24, background: 'linear-gradient(160deg, #F6EBD8, #EBDcC3)', padding: '26px 16px', display: 'grid', gridTemplateColumns: `repeat(${Math.min(day.cfg.components.length, 5)}, minmax(0, 1fr))`, gap: 8 }} aria-hidden="true">
          {day.cfg.components.map(cid => (
            <span key={cid} style={{ height: 64, borderRadius: 18, background: 'rgba(255,255,255,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={componentIcon(cid)} size={30} stroke={1.4} /></span>
          ))}
        </div>

        <div className="stack gap-8">
          <h1 className="h-display" style={{ fontSize: 38 }}>How was {boxName(day.cfg)}?</h1>
          {day.bakery && <span className="help">Prepared by {day.bakery}</span>}
        </div>
        <div className="grid-2" role="radiogroup" aria-label="Feedback">
          {FEEDBACK.map(v => (
            <button key={v} type="button" className={`tile${choice === v ? ' on' : ''}`} role="radio" aria-checked={choice === v} disabled={sent}
              onClick={() => setChoice(v)} style={{ alignItems: 'center', justifyContent: 'center', minHeight: 150, gap: 12 }}>
              {choice === v && <span className="tick on" style={{ position: 'absolute', top: 12, right: 12, margin: 0 }}><Icon name="check" size={15} stroke={2.2} /></span>}
              <Icon name={v === 'Loved it' ? 'heart' : 'meh'} size={34} stroke={1.5} />
              <span className="strong" style={{ fontSize: 19 }}>{v}</span>
            </button>
          ))}
        </div>
        {choice === 'Not for me' && (
          <section className="stack gap-12">
            <span className="strong" style={{ fontSize: 17 }}>What didn’t work? <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></span>
            <div className="chips" role="radiogroup" aria-label="Reason">{REASONS.map(r => <Chip key={r} on={reasons.includes(r)} disabled={sent} onClick={() => toggle(r)}>{r}</Chip>)}</div>
          </section>
        )}
        <ErrorBanner>{error}</ErrorBanner>
        {sent && <div className="banner-ok" role="status"><Icon name="check" size={20} stroke={2} /><span>Thanks, {state.user?.firstName} — noted for next time.</span></div>}
        {sent && <button type="button" className="btn-text" style={{ alignSelf: 'center', fontSize: 14, color: 'var(--text-3)' }} onClick={() => setEditing(true)}>Change my feedback</button>}
      </main>
      <Footer>
        {sent
          ? <Link to="/start" className="btn">Plan your next morning</Link>
          : <button className="btn" disabled={!choice || busy} onClick={send}>{busy ? 'Sending…' : day.feedback ? 'Update feedback' : 'Send feedback'}</button>}
      </Footer>
    </Screen>
  );
}

/* ---------- My Morning Profile ---------- */
export function Me() {
  const { state, set, reset } = useStore();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const guard = useSignedIn('/me');
  const [editEmail, setEditEmail] = useState(false);
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(state.user?.firstName || '');
  const [email, setEmail] = useState(state.user?.email || '');
  const [mobileStep, setMobileStep] = useState(null);   // null | 'number' | 'code'
  const [changing, setChanging] = useState('mobile');     // which sign-in detail: 'mobile' | 'email'
  const [newMobile, setNewMobile] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState(null);          // null | 'delete'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (guard) return guard;
  const p = state.profile;
  const a = state.delivery.address;
  const reviewCount = Number(params.get('review')) || 0;
  const Row = ({ label, children, to }) => (
    <div className="list-row" style={{ minHeight: 76 }}>
      <span className="stack gap-4" style={{ flex: 1 }}><span className="eyebrow grey" style={{ letterSpacing: '.1em', fontWeight: 500 }}>{label}</span>{children}</span>
      {to && <Link to={to} className="link">Change</Link>}
    </div>
  );
  const tags = list => list.length ? <span className="tags">{list.map(t => <span key={t} className="tag">{t}</span>)}</span> : <span className="strong">None</span>;
  const run = async fn => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const digits = newMobile.replace(/\D/g, '').replace(/^(00)?971/, '').replace(/^0/, '');
  const saveName = () => {
    if (!name.trim()) { setError('Enter your first name.'); return; }
    run(async () => { const r = await put('/me/settings', { firstName: name.trim() }); set(s => { s.user = r.user; }); setEditName(false); });
  };
  const setOffers = v => {
    set(s => { s.settings.offers = v; });
    put('/me/settings', { offers: v }).catch(e => { set(s => { s.settings.offers = !v; }); setError(e.message); });
  };
  const saveEmail = () => {
    if (email.trim() && !emailValid(email)) { setError('Enter a valid email, e.g. name@company.com — or leave it empty.'); return; }
    run(async () => { const r = await put('/me/settings', { email: email.trim() }); set(s => { s.user = r.user; }); setEditEmail(false); });
  };
  const startChange = kind => { setChanging(kind); setMobileStep('number'); setError(''); };
  const sendMobileCode = () => {
    if (changing === 'email' ? !emailValid(newEmail) : !/^5\d{8}$/.test(digits)) {
      setError(changing === 'email' ? 'Enter a valid email, e.g. name@company.com.' : 'Enter a UAE mobile number, e.g. 50 123 4567.'); return;
    }
    run(async () => {
      await post('/auth/otp', changing === 'email' ? { email: newEmail.trim() } : { mobile: digits });
      setCode(''); setMobileStep('code');
    });
  };
  const verifyMobile = () => run(async () => {
    const r = changing === 'email'
      ? await post('/auth/change-email', { email: newEmail.trim(), code })
      : await post('/auth/change-mobile', { mobile: digits, code });
    set(s => { s.user = r.user; s.owner = ownerOf(r.user); });
    setMobileStep(null); setNewMobile(''); setNewEmail('');
  });
  const signOut = async all => {
    await post(all ? '/auth/logout-all' : '/auth/logout').catch(() => {});
    setToken(null);
    reset();
    nav('/');
  };
  const rowButton = { color: 'var(--espresso)' };
  const deleteAccount = () => run(async () => { await del('/me'); setToken(null); reset(); nav('/'); });

  return (
    <Screen>
      <TopBar close={null}><span className="topbar-title">Profile</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 4, gap: 22 }}>
        <div className="row" style={{ justifyContent: 'flex-start', gap: 16 }}>
          <span style={{ width: 60, height: 60, borderRadius: 999, background: 'var(--gold-soft)', color: 'var(--espresso)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '400 28px/1 var(--serif)' }}>{state.user.firstName.charAt(0).toUpperCase()}</span>
          <span className="stack" style={{ flex: 1 }}><button type="button" className="serif" aria-label="Edit name" onClick={() => { setEditName(true); setName(state.user.firstName); setError(''); }} style={{ fontSize: 32, lineHeight: 1.1, background: 'none', border: 0, padding: 0, textAlign: 'left', color: 'inherit', cursor: 'pointer' }}>{state.user.firstName} <Icon name="edit" size={18} stroke={1.6} color="var(--text-3)" /></button>{state.user.mobile && <span className="help" style={{ fontSize: 15 }}>{state.user.mobile}</span>}</span>
          {!mobileStep && <button type="button" className="link" onClick={() => startChange('mobile')}>{state.user.mobile ? 'Change number' : 'Add number'}</button>}
        </div>
        {!mobileStep && (
          <div className="row" style={{ justifyContent: 'flex-start', gap: 8 }}>
            <span className="help" style={{ fontSize: 15 }}>Sign-in email: {state.user.loginEmail || 'none'}</span>
            <button type="button" className="link" style={{ padding: 0 }} onClick={() => startChange('email')}>{state.user.loginEmail ? 'Change' : 'Add'}</button>
          </div>
        )}
        {editName && (
          <section className="card stack gap-12" style={{ padding: 20 }} aria-label="Edit name">
            <div className="field"><label htmlFor="me-n">First name</label>
              <input id="me-n" className="input" autoComplete="given-name" maxLength={40} value={name} onChange={e => setName(e.target.value)} /></div>
            <div className="grid-2"><button type="button" className="btn-secondary" onClick={() => setEditName(false)}>Cancel</button>
              <button type="button" className="btn" disabled={busy} onClick={saveName}>{busy ? 'Saving…' : 'Save'}</button></div>
          </section>
        )}
        {mobileStep && (
          <section className="card stack gap-12" style={{ padding: 20 }} aria-label={changing === 'email' ? 'Change sign-in email' : 'Change mobile number'}>
            {mobileStep === 'number' ? (changing === 'email' ? (
              <div className="field"><label htmlFor="ne">Sign-in email</label>
                <input id="ne" className="input" type="email" inputMode="email" autoComplete="email" placeholder="name@company.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} /></div>
            ) : (
              <div className="field"><label htmlFor="nm">{state.user.mobile ? 'New mobile number' : 'Mobile number'}</label>
                <PhoneField id="nm" value={newMobile} onChange={setNewMobile} /></div>
            )) : (
              <div className="field"><label htmlFor="nm-c">Code sent to {changing === 'email' ? newEmail.trim() : `+971 ${digits}`}</label>
                <input id="nm-c" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                  onPaste={e => { const t = pastedCode(e); if (t) { e.preventDefault(); setCode(t); } }}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} /></div>
            )}
            <div className="grid-2">
              <button type="button" className="btn-secondary" onClick={() => { setMobileStep(null); setError(''); }}>Cancel</button>
              {mobileStep === 'number'
                ? <button type="button" className="btn" disabled={busy} onClick={sendMobileCode}>{busy ? 'Sending…' : 'Send code'}</button>
                : <button type="button" className="btn" disabled={busy || code.length < 6} onClick={verifyMobile}>{busy ? 'Checking…' : 'Verify'}</button>}
            </div>
          </section>
        )}
        {reviewCount > 0 && (
          <Link to="/orders" className="note" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Icon name="shield" size={20} stroke={1.6} style={{ flex: 'none' }} />
            <span><b>{reviewCount === 1 ? 'One upcoming morning needs' : `${reviewCount} upcoming mornings need`} your review.</b></span>
          </Link>
        )}
        <section className="stack gap-12">
          <span className="eyebrow row" style={{ justifyContent: 'flex-start', gap: 6 }}>Your Morning Profile<InfoTip label="About your profile">We use this to choose every breakfast. New allergies are also checked against mornings you’ve already ordered.</InfoTip></span>
          <div className="card list">
            <Row label="Eating style" to="/profile/eating?edit=me"><span className="strong" style={{ fontSize: 17 }}>{eatingLabel(p.eatingStyle) || 'Not set'}</span></Row>
            <Row label="Breakfast I enjoy" to="/profile/preferences?edit=me">{tags(p.preferences.map(prefLabel))}</Row>
            <Row label="Dietary & allergies" to="/profile/dietary?edit=me">{tags([...p.dietary.map(dietLabel), ...p.allergies.map(x => `${allergyLabel(x)} allergy`), ...(p.otherAllergies ? [p.otherAllergies] : [])])}</Row>
          </div>
        </section>
        {a.building && (
          <section className="stack gap-12">
            <span className="eyebrow">Saved delivery</span>
            <div className="card row" style={{ gap: 16, padding: '18px 20px' }}>
              <Icon name="pin" size={24} stroke={1.6} />
              <span className="stack" style={{ flex: 1 }}><span className="strong" style={{ fontSize: 17 }}>{a.building}</span>
                <span className="help" style={{ fontSize: 15 }}>{a.unit}{state.delivery.window ? ` · ${windowLabel(state.delivery.window)}` : ''}</span></span>
            </div>
          </section>
        )}
        <section className="stack gap-12">
          <span className="eyebrow">Settings</span>
          <div className="card list">
            {editEmail ? (
              <div className="list-row stack" style={{ alignItems: 'stretch', gap: 10, padding: '14px 0' }}>
                <label htmlFor="me-em" className="strong">Receipt email</label>
                <input id="me-em" className="input" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} />
                <div className="grid-2"><button type="button" className="btn-secondary" onClick={() => { setEditEmail(false); setEmail(state.user.email || ''); setError(''); }}>Cancel</button>
                  <button type="button" className="btn" disabled={busy} onClick={saveEmail}>{busy ? 'Saving…' : 'Save'}</button></div>
              </div>
            ) : (
              <div className="list-row"><Icon name="mail" size={20} /><span className="strong" style={{ flex: 1 }}>Email</span><span className="help" style={{ fontSize: 15 }}>{state.user.email || 'Not added'}</span>
                <button type="button" className="link" style={{ marginLeft: 12 }} onClick={() => setEditEmail(true)}>{state.user.email ? 'Change' : 'Add'}</button></div>
            )}
            <Link to="/notifications" className="list-row"><Icon name="bell" size={20} /><span className="strong" style={{ flex: 1 }}>Notifications</span><Icon name="chevron" size={18} stroke={1.8} /></Link>
            <div className="list-row"><Icon name="coffee" size={20} /><span className="strong" style={{ flex: 1 }}>Reminder the night before</span>
              <Switch checked={state.settings.coffeeReminder} label="Reminder the night before" onChange={v => set(s => { s.settings.coffeeReminder = v; })} /></div>
            <div className="list-row"><Icon name="sparkle" size={20} /><span className="strong" style={{ flex: 1 }}>Offers &amp; news</span>
              <Switch checked={!!state.settings.offers} label="Offers and news" onChange={setOffers} /></div>
          </div>
        </section>

        <section className="stack gap-12">
          <span className="eyebrow">Help &amp; legal</span>
          <div className="card list">
            <Link to="/help" className="list-row"><Icon name="help" size={20} /><span className="strong" style={{ flex: 1 }}>Help &amp; Support</span><Icon name="chevron" size={18} stroke={1.8} /></Link>
            {LEGAL_PAGES.map(([lid, label]) => <Link key={lid} to={`/legal/${lid}`} className="list-row"><Icon name="doc" size={20} /><span className="strong" style={{ flex: 1 }}>{label}</span><Icon name="chevron" size={18} stroke={1.8} /></Link>)}
          </div>
        </section>

        <section className="stack gap-12">
          <span className="eyebrow">Account</span>
          <div className="card list">
            <button type="button" className="list-row" style={rowButton} onClick={() => run(() => download('/me/export', 'morning-box-my-data.json', 'application/json'))}>
              <Icon name="download" size={20} /><span className="strong" style={{ flex: 1 }}>Download my data</span><Icon name="chevron" size={18} stroke={1.8} /></button>
            <button type="button" className="list-row" style={rowButton} onClick={() => signOut(false)}>
              <Icon name="logout" size={20} /><span className="strong" style={{ flex: 1 }}>Sign out</span></button>
            <button type="button" className="list-row" style={rowButton} onClick={() => signOut(true)}>
              <Icon name="lock" size={20} /><span className="strong" style={{ flex: 1 }}>Sign out on all devices</span></button>
            <button type="button" className="list-row" style={{ ...rowButton, color: 'var(--err)' }} onClick={() => setConfirm('delete')}>
              <Icon name="close" size={20} /><span className="strong" style={{ flex: 1, color: 'var(--err)' }}>Delete my account</span></button>
          </div>
        </section>
        <ErrorBanner>{error}</ErrorBanner>
        {confirm && (
          <div className="card stack gap-12" role="alertdialog" aria-labelledby="cf">
            <strong id="cf" style={{ fontSize: 18 }}>Delete your Morning Box account?</strong>
            <span className="help" style={{ fontSize: 15.5 }}>Your profile and saved address will be removed. This can’t be undone.</span>
            <div className="grid-2"><button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>Keep it</button>
              <button type="button" className="btn-danger" disabled={busy}
                onClick={deleteAccount}>Yes, delete</button></div>
          </div>
        )}
        <span className="xs center">Morning Box {typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''}</span>
      </main>
      <TabBar active="/me" />
    </Screen>
  );
}
