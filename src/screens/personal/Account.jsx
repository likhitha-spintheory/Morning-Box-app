import { useEffect, useState } from 'react';
import { get, post, patch, setToken } from '../../api.js';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Screen, TopBar, Footer, Icon, Logo, TabBar, Switch, Qty, Money, Chip } from '../../components/ui.jsx';
import { useStore } from '../../state/store.jsx';
import {
  CONTEXTS, DELIVERY_WINDOWS, dateInfo, todayIso, boxName, sizeLabel, extrasText, windowLabel, contextLabel,
  eatingLabel, prefLabel, dietLabel, allergyLabel, componentName, componentIcon, trackingStage,
  isBeforeCutoff, cutoffLabel, timeLeft, dayPrice, sizePrice, canChooseSize, recommendDay, addonPrice, shortPlace
} from '../../domain/app.js';
import { addonGroups } from '../../domain/engine.js';

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
      .catch(e => { if (e.status === 401) set(s => { s.session = null; s.user = null; }); else setError(e.message); });
  }, [state.session, set]);
  return error;
}
/* Demo-only control: dev server, or a build made with VITE_DEMO=1. Hidden in production. */
const SHOW_DEMO = import.meta.env.DEV || import.meta.env.VITE_DEMO === '1';
const replaceOrder = (s, order) => { s.orders = s.orders.map(o => (o.id === order.id ? order : o)); };
const ErrorBanner = ({ children }) => children
  ? <div className="banner-err" role="alert"><Icon name="alert" size={18} stroke={2} />{children}</div> : null;
const dayComma = iso => { const d = dateInfo(iso); return `${d.wd}, ${d.day} ${d.mon}`; };
const clock = iso => iso ? new Date(iso.replace(' ', 'T') + (iso.includes('Z') || iso.includes('+') ? '' : 'Z')).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase() : null;

function allDays(orders) {
  return orders.flatMap(o => o.days.map(d => ({ ...d, orderId: o.id, createdAt: o.createdAt })));
}

function StatusPill({ day }) {
  const st = trackingStage(day);
  if (st === -1) return <span className="status off">Cancelled · refunded</span>;
  if (st === 3) return <span className="status done">Delivered{day.feedback ? ` · ${day.feedback}` : ''}</span>;
  if (st === 0) return <span className="status ok">Confirmed</span>;
  return <span className="status prep">{st === 1 ? 'Being prepared' : 'On its way'}</span>;
}

function DateBox({ iso }) {
  const d = dateInfo(iso);
  return <span className="datebox"><span className="wd">{d.wd}</span><span className="dn">{d.day}</span><span className="mo">{d.mon}</span></span>;
}

/* ---------- Returning user home (MB-FLW-001 §10) ---------- */
export function Today() {
  const { state } = useStore();
  const loadError = useOrders();
  const guard = useSignedIn('/today');
  if (guard) return guard;
  const today = todayIso();
  const upcoming = allDays(state.orders).filter(d => !d.cancelled && d.date >= today && trackingStage(d) < 3).sort((a, b) => a.date.localeCompare(b.date));
  const next = upcoming[0];
  const lastOrder = state.orders[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const inProgress = state.plan.dates.length > 0;

  return (
    <Screen>
      <header className="topbar">
        <Logo width={140} />
        <Link to="/me" className="icon-btn" style={{ width: 48, height: 48 }} aria-label="My Morning Profile"><Icon name="user" size={22} /></Link>
      </header>
      <main className="screen-main" style={{ paddingTop: 8, gap: 22 }}>
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
              <span className="help" style={{ fontSize: 15 }}>{windowLabel(next.window)} · {next.address.building}</span>
              {isBeforeCutoff(next.date) && trackingStage(next) === 0 && <span className="xs" style={{ marginTop: 4 }}>Changes possible until {cutoffLabel(next.date)}</span>}
            </span>
            <StatusPill day={next} />
          </Link>
        ) : (
          <div className="card stack gap-4"><span className="strong">No mornings planned yet</span><span className="help" style={{ fontSize: 15 }}>Plan tomorrow or the whole week in a few taps.</span></div>
        )}

        <ErrorBanner>{loadError}</ErrorBanner>
        {inProgress && (
          <Link to="/plan/summary" className="panel row" style={{ flexDirection: 'row', textDecoration: 'none', alignItems: 'center' }}>
            <Icon name="cal" size={22} stroke={1.6} /><span style={{ flex: 1 }}><b>Plan in progress</b> · {state.plan.dates.length} morning{state.plan.dates.length > 1 ? 's' : ''}. Continue where you left off.</span>
            <Icon name="chevron" size={18} stroke={1.8} />
          </Link>
        )}

        <Link to="/start" className="entry gold">
          <Icon name="sunny" size={24} stroke={1.6} />
          <span style={{ flex: 1 }}><b>Plan my mornings</b><span className="d">Your profile is saved — just pick the dates</span></span>
          <Icon name="arrow" size={22} stroke={1.8} />
        </Link>

        {lastOrder && (
          <section className="stack gap-12">
            <span className="eyebrow">Plan faster</span>
            <Link to={`/plan/dates?reuse=${lastOrder.id}`} className="option" style={{ textDecoration: 'none' }}>
              <span className="ico"><Icon name="repeat" size={22} stroke={1.6} /></span>
              <span className="stack" style={{ flex: 1, gap: 3 }}><span style={{ fontWeight: 600, fontSize: 18 }}>Use this plan again</span>
                <span className="help" style={{ fontSize: 15.5 }}>Copy {lastOrder.days.length} morning{lastOrder.days.length > 1 ? 's' : ''} to the dates you choose.</span></span>
              <Icon name="chevron" size={18} stroke={1.8} />
            </Link>
            <Link to="/orders?tab=past" className="option" style={{ textDecoration: 'none' }}>
              <span className="ico"><Icon name="box" size={22} stroke={1.6} /></span>
              <span className="stack" style={{ flex: 1, gap: 3 }}><span style={{ fontWeight: 600, fontSize: 18 }}>Reorder a previous morning</span>
                <span className="help" style={{ fontSize: 15.5 }}>Pick a breakfast you’ve had before.</span></span>
              <Icon name="chevron" size={18} stroke={1.8} />
            </Link>
          </section>
        )}
        <span className="hint" style={{ fontSize: 14 }}><Icon name="info" size={18} stroke={1.6} />Nothing is ordered automatically — you confirm every morning.</span>
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
                <span className="help" style={{ fontSize: 15 }}>{canChooseSize(d.cfg) ? sizeLabel(d.cfg.size) : 'Standard'}{d.cfg.addons.length ? ` · + ${extrasText(d.cfg.addons)}` : ''}</span>
                <span className="xs">{windowLabel(d.window)}{!d.cancelled && isBeforeCutoff(d.date) && trackingStage(d) === 0 ? ` · Editable until ${cutoffLabel(d.date)}` : ''}</span>
              </span>
              <StatusPill day={d} />
            </Link>
            {tab === 'past' && !d.cancelled && (
              <div className="row">
                {trackingStage(d) === 3 && !d.feedback ? <Link to={`/orders/${d.orderId}/${d.date}/feedback`} className="link">Rate this morning</Link> : <span />}
                <Link to={`/plan/dates?reorder=${d.orderId}:${d.date}`} className="swap-btn" style={{ textDecoration: 'none' }}><Icon name="repeat" size={16} stroke={1.7} />Order again</Link>
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
      <span className="badge-float" style={{ top: 16, left: 16 }}><Icon name="map" size={18} stroke={1.6} />DIFC</span>
    </div>
  );
}

export function OrderDay() {
  const { id, date } = useParams();
  const { state, set } = useStore();
  useOrders();
  const [busy, setBusy] = useState(false);
  const order = state.orders.find(o => o.id === id);
  const day = order?.days.find(d => d.date === date);
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
  const price = dayPrice(day.cfg, state.profile);
  const steps = [
    { t: 'Order confirmed', d: dayComma(order.createdAt.slice(0, 10)), time: clock(order.createdAt), icon: 'check' },
    { t: 'Being prepared', d: st >= 1 && day.bakery ? `Prepared by ${day.bakery}` : 'Fresh on the morning', icon: 'check' },
    { t: 'Out for delivery', d: 'Your courier left the bakery', icon: 'truck' },
    { t: 'Delivered', d: st === 3 ? `Delivered to ${day.deliveryPoint || 'Reception'}` : 'We’ll confirm the hand-over point', time: st === 3 ? clock(day.deliveredAt) : null, icon: 'home' }
  ];
  const shortBuilding = shortPlace(day.address.building);

  return (
    <Screen>
      <TopBar back="/orders" close={null}><span className="topbar-title">{dayComma(date)} · {id}</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 4, gap: 18 }}>
        <div className="row">
          {st === 1 || st === 2 ? <span className="live"><i />Live · updated just now</span> : <StatusPill day={day} />}
          {st >= 0 && <span className="status prep" style={{ fontSize: 15, padding: '8px 14px' }}>{windowLabel(day.window)}</span>}
        </div>
        <div className="stack gap-4">
          <h1 className="h-display" style={{ fontSize: 38 }}>{heading}</h1>
          <span className="help" style={{ fontSize: 17 }}>{st === 3 ? `${day.address.handover === 'door' ? 'At your door' : 'At reception'} · ${day.address.building}` : st >= 0 ? `Arriving within your ${windowLabel(day.window).replace(' AM', '').replace(' – ', '–')} window` : `Refund of AED ${price.total} to your original payment method`}</span>
        </div>

        {st >= 0 && <RouteCard stage={st} label={shortBuilding.length > 16 ? shortBuilding.slice(0, 15) + '…' : shortBuilding} />}

        {st >= 0 && (
          <section className="card track" style={{ padding: '6px 20px' }} aria-label="Delivery progress">
            {steps.map((s, i) => {
              const cls = i < st || st === 3 ? 'done' : i === st ? 'current' : '';
              return (
                <div key={s.t} className={`ts ${cls}`}>
                  <span className="b">{cls === 'done' ? <Icon name="check" size={17} stroke={2.2} /> : <Icon name={s.icon} size={17} stroke={1.8} />}</span>
                  <span className="t stack"><span className="strong" style={{ fontSize: 18, color: cls ? 'var(--espresso)' : 'var(--text-3)' }}>{s.t}</span><span className="help" style={{ fontSize: 15 }}>{s.d}</span></span>
                  <span className="time">{cls ? s.time || '' : '—'}</span>
                </div>
              );
            })}
          </section>
        )}

        <section className="card stack gap-10" style={{ padding: 20 }}>
          <div className="row"><span className="strong" style={{ fontSize: 17 }}>{boxName(day.cfg)} · {canChooseSize(day.cfg) ? sizeLabel(day.cfg.size) : 'Standard'}</span><Money value={price.total} /></div>
          <span className="help" style={{ fontSize: 15 }}>{day.cfg.components.map(componentName).join(' · ')}{day.cfg.addons.length ? ` · + ${extrasText(day.cfg.addons)}` : ''}</span>
        </section>

        {editable && <Link to={`/orders/${id}/${date}/edit`} className="btn-secondary">Edit or cancel this morning</Link>}
        {!editable && st >= 0 && st < 3 && (
          <div className="note"><Icon name="clock" size={20} stroke={1.6} style={{ flex: 'none' }} />
            <span>{st > 0 ? 'This morning is being prepared, so it can no longer be changed.' : 'Changes for this morning closed at 9:00 PM the evening before.'}{nextEditable ? ` ${dateInfo(nextEditable.date).label} can still be edited.` : ''}</span></div>
        )}
        {st === 3 && !day.feedback && <Link to={`/orders/${id}/${date}/feedback`} className="btn">How was your morning?</Link>}
        {nextEditable && !editable && <Link to={`/orders/${id}/${nextEditable.date}/edit`} className="btn-secondary">Manage {dateInfo(nextEditable.date).label}</Link>}
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
  const order = state.orders.find(o => o.id === id);
  const day = order?.days.find(d => d.date === date);
  const [draft, setDraft] = useState(() => day ? structuredClone({ cfg: day.cfg, window: day.window }) : null);
  const [ctxError, setCtxError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!day) return <Navigate to="/orders" replace />;
  if (!isBeforeCutoff(date) || day.cancelled || trackingStage(day) > 0) return <Navigate to={`/orders/${id}/${date}`} replace />;

  const price = dayPrice(draft.cfg, state.profile);
  const pastry = addonGroups(state.profile).find(g => g.id === 'pastry');
  const qtyOf = item => draft.cfg.addons.find(a => a.item === item && !a.unit)?.qty || 0;
  const setPastry = (item, q) => setDraft(d => {
    const n = structuredClone(d);
    n.cfg.addons = n.cfg.addons.filter(a => !(a.item === item && !a.unit));
    if (q > 0) n.cfg.addons.push({ group: 'pastry', item, qty: q });
    return n;
  });
  const changeContext = ctx => {
    const r = recommendDay(state.profile, ctx);
    if (r.none) { setCtxError(`No safe ${contextLabel(ctx)} breakfast matches your profile. Your current breakfast is kept.`); return; }
    setCtxError('');
    setDraft(d => ({ ...d, cfg: { ...r.primary, size: canChooseSize(r.primary) ? (d.cfg.size === 'standard' ? 'regular' : d.cfg.size) : 'standard', addons: d.cfg.addons } }));
  };
  const run = async fn => {
    setBusy(true); setError('');
    try { const o = await fn(); set(s => replaceOrder(s, o)); nav(`/orders/${id}/${date}`); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  const save = () => run(() => patch(`/orders/${id}/days/${date}`, {
    context: draft.cfg.context, recipeId: draft.cfg.recipeId, components: draft.cfg.components,
    size: draft.cfg.size, addons: draft.cfg.addons, window: draft.window
  }));
  const cancel = () => run(() => post(`/orders/${id}/days/${date}/cancel`));
  const others = order.days.filter(d => d.date !== date && !d.cancelled).map(d => dateInfo(d.date).short);

  return (
    <Screen>
      <TopBar back={`/orders/${id}/${date}`} close={null}><span className="topbar-title">Manage morning</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 4, gap: 22 }}>
        <div className="ruled"><span className="eyebrow grey">Editing</span><span className="date-title">{dateInfo(date).long}</span></div>
        <span className="help" style={{ marginTop: -10 }}>{boxName(draft.cfg)} · {canChooseSize(draft.cfg) ? sizeLabel(draft.cfg.size) : 'Standard'}</span>
        <div className="panel" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Icon name="clock" size={24} stroke={1.6} />
          <span className="stack"><span className="strong">Editable until {cutoffLabel(date)}</span><span className="help" style={{ fontSize: 15 }}>{timeLeft(date)} left</span></span>
        </div>

        <section className="stack gap-12">
          <h2 className="h3" style={{ fontSize: 19 }}>Morning type</h2>
          <div className="chips">
            {CONTEXTS.map(c => <Chip key={c.id} on={draft.cfg.context === c.id} onClick={() => changeContext(c.id)}>{c.label}</Chip>)}
          </div>
          {ctxError && <span className="err-msg"><Icon name="alert" size={14} stroke={2.2} />{ctxError}</span>}
        </section>

        {canChooseSize(draft.cfg) && (
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

        {pastry && (
          <section className="stack gap-12">
            <h2 className="h3" style={{ fontSize: 19 }}>Pastry extras</h2>
            <div className="card list">
              {pastry.items.map(item => (
                <div key={item} className="list-row">
                  <span className="ci"><Icon name="croissant" size={22} stroke={1.5} /></span>
                  <span className="stack" style={{ flex: 1 }}><span style={{ fontSize: 17, fontWeight: 500 }}>{componentName(item)}</span><span className="sm">AED {addonPrice({ group: 'pastry', item, qty: 1 })} each</span></span>
                  <Qty value={qtyOf(item)} max={9} label={componentName(item)} onChange={q => setPastry(item, q)} />
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="stack gap-12">
          <h2 className="h3" style={{ fontSize: 19 }}>Delivery window</h2>
          <div className="stack gap-10">
            {DELIVERY_WINDOWS.map(w => (
              <button key={w.id} type="button" className={`win${draft.window === w.id ? ' on' : ''}`} role="radio" aria-checked={draft.window === w.id} onClick={() => setDraft(d => ({ ...d, window: w.id }))}>
                <span className="ico"><Icon name={w.id === 'w1' ? 'sunrise' : 'sunny'} size={22} stroke={1.6} /></span>
                <span style={{ fontSize: 18, fontWeight: 600, flex: 1 }}>{w.label}</span>
                <span className="dot">{draft.window === w.id && <Icon name="check" size={15} stroke={2.2} />}</span>
              </button>
            ))}
          </div>
        </section>

        {price.total !== day.price && <p className="help" style={{ fontSize: 15, margin: 0 }}>Was AED {day.price}. The difference is charged or refunded to your original payment method.</p>}

        <section className="stack gap-10" style={{ marginTop: 4 }}>
          {!confirmCancel ? (
            <button className="btn-text" style={{ alignSelf: 'center', color: 'var(--err)', textDecorationColor: '#D9A79E' }} onClick={() => setConfirmCancel(true)}>Cancel this morning</button>
          ) : (
            <div className="card stack gap-12" role="alertdialog" aria-labelledby="cc">
              <strong id="cc" style={{ fontSize: 18 }}>Cancel {dateInfo(date).label}?</strong>
              <span className="help" style={{ fontSize: 15.5 }}>You’ll get a full refund of AED {day.price}.{others.length ? ` ${others.join(' and ')} stay as planned.` : ''}</span>
              <div className="grid-2"><button className="btn-secondary" onClick={() => setConfirmCancel(false)}>Keep it</button><button className="btn-danger" disabled={busy} onClick={cancel}>Yes, cancel</button></div>
            </div>
          )}
        </section>
        <ErrorBanner>{error}</ErrorBanner>
      </main>
      <Footer sheet>
        <div className="row" style={{ alignItems: 'flex-end' }}><span className="sm" style={{ fontSize: 15 }}>This morning</span><span style={{ font: '700 26px/1.15 var(--sans)' }}>AED {price.total}</span></div>
        <button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
      </Footer>
    </Screen>
  );
}

/* ---------- Delivered & feedback (style-1 P20) ---------- */
const REASONS = ['Not my taste', 'Too much', 'Too little', 'Not fresh enough', 'Arrived late'];
export function Feedback() {
  const { id, date } = useParams();
  const { state, set } = useStore();
  const [error, setError] = useState('');
  const order = state.orders.find(o => o.id === id);
  const day = order?.days.find(d => d.date === date);
  const [choice, setChoice] = useState(day?.feedback || null);
  const [reasons, setReasons] = useState(day?.feedbackReasons || []);
  const [busy, setBusy] = useState(false);
  if (!day) return <Navigate to="/orders" replace />;
  const sent = !!day.feedback;
  const toggle = r => setReasons(x => (x.includes(r) ? x.filter(y => y !== r) : [...x, r]));
  const send = () => {
    setBusy(true);
    post(`/orders/${id}/days/${date}/feedback`, { value: choice, reasons: choice === 'Not for me' ? reasons : [] })
      .then(o => { setError(''); set(s => replaceOrder(s, o)); })
      .catch(e => setError(e.message)).finally(() => setBusy(false));
  };
  const time = clock(day.deliveredAt);

  return (
    <Screen>
      <TopBar back={`/orders/${id}/${date}`} close={null}><span className="topbar-title">{dayComma(date)}</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 4, gap: 20 }}>
        <div className="card row" style={{ justifyContent: 'flex-start', gap: 16, padding: '18px 20px' }}>
          <span style={{ width: 46, height: 46, borderRadius: 999, background: 'var(--espresso)', color: 'var(--ivory)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name="check" size={22} stroke={2} /></span>
          <span className="stack">
            <span className="strong" style={{ fontSize: 17 }}>Delivered to {day.deliveryPoint || (day.address.handover === 'door' ? 'your door' : 'Reception')}{time ? ` · ${time}` : ''}</span>
            <span className="help" style={{ fontSize: 15 }}>{shortPlace(day.address.building)} · within your {windowLabel(day.window).replace(' AM', '').replace(' – ', '–')} window</span>
          </span>
        </div>

        <div style={{ borderRadius: 24, background: 'linear-gradient(160deg, #F6EBD8, #EBDcC3)', padding: '26px 16px', display: 'grid', gridTemplateColumns: `repeat(${Math.min(day.cfg.components.length, 5)}, minmax(0, 1fr))`, gap: 8 }} aria-hidden="true">
          {day.cfg.components.map(cid => (
            <span key={cid} style={{ height: 64, borderRadius: 18, background: 'rgba(255,255,255,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={componentIcon(cid)} size={30} stroke={1.4} /></span>
          ))}
        </div>

        <div className="stack gap-8">
          <span className="eyebrow">One quick thing</span>
          <h1 className="h-display" style={{ fontSize: 38 }}>How was {boxName(day.cfg)}?</h1>
          {day.bakery && <span className="help">Prepared by {day.bakery}</span>}
        </div>
        <div className="grid-2" role="radiogroup" aria-label="Feedback">
          {[['Loved it', 'heart'], ['Not for me', 'meh']].map(([v, icon]) => (
            <button key={v} type="button" className={`tile${choice === v ? ' on' : ''}`} role="radio" aria-checked={choice === v} disabled={sent}
              onClick={() => setChoice(v)} style={{ alignItems: 'center', justifyContent: 'center', minHeight: 150, gap: 12 }}>
              {choice === v && <span className="tick on" style={{ position: 'absolute', top: 12, right: 12, margin: 0 }}><Icon name="check" size={15} stroke={2.2} /></span>}
              <Icon name={icon} size={34} stroke={1.5} />
              <span className="strong" style={{ fontSize: 19 }}>{v}</span>
            </button>
          ))}
        </div>
        {choice === 'Not for me' && (
          <section className="stack gap-12">
            <span className="strong" style={{ fontSize: 17 }}>What didn’t work? <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></span>
            <div className="chips">{REASONS.map(r => <Chip key={r} on={reasons.includes(r)} disabled={sent} onClick={() => toggle(r)}>{r}</Chip>)}</div>
          </section>
        )}
        <ErrorBanner>{error}</ErrorBanner>
        {sent && <div className="banner-ok" role="status"><Icon name="check" size={20} stroke={2} /><span>Thanks, {state.user?.firstName} — noted for next time.</span></div>}
      </main>
      <Footer>
        {sent
          ? <Link to="/start" className="btn">Plan your next morning</Link>
          : <button className="btn" disabled={!choice || busy} onClick={send}>{busy ? 'Sending…' : 'Send feedback'}</button>}
      </Footer>
    </Screen>
  );
}

/* ---------- My Morning Profile ---------- */
export function Me() {
  const { state, set, reset } = useStore();
  const nav = useNavigate();
  const guard = useSignedIn('/me');
  if (guard) return guard;
  const p = state.profile;
  const a = state.delivery.address;
  const Row = ({ label, children, to }) => (
    <div className="list-row" style={{ minHeight: 76 }}>
      <span className="stack gap-4" style={{ flex: 1 }}><span className="eyebrow grey" style={{ letterSpacing: '.1em', fontWeight: 500 }}>{label}</span>{children}</span>
      {to && <Link to={to} className="link">Change</Link>}
    </div>
  );
  const tags = list => list.length ? <span className="tags">{list.map(t => <span key={t} className="tag">{t}</span>)}</span> : <span className="strong">None</span>;

  return (
    <Screen>
      <TopBar close={null}><span className="topbar-title">Profile</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 4, gap: 22 }}>
        <div className="row" style={{ justifyContent: 'flex-start', gap: 16 }}>
          <span style={{ width: 60, height: 60, borderRadius: 999, background: 'var(--gold-soft)', color: 'var(--espresso)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '400 28px/1 var(--serif)' }}>{state.user.firstName.charAt(0).toUpperCase()}</span>
          <span className="stack"><span className="serif" style={{ fontSize: 32, lineHeight: 1.1 }}>{state.user.firstName}</span><span className="help" style={{ fontSize: 15 }}>{state.user.mobile}</span></span>
        </div>
        <section className="stack gap-12">
          <span className="eyebrow">Your Morning Profile</span>
          <div className="card list">
            <Row label="Eating style" to="/profile/eating?edit=me"><span className="strong" style={{ fontSize: 17 }}>{eatingLabel(p.eatingStyle) || 'Not set'}</span></Row>
            <Row label="Breakfast I enjoy" to="/profile/preferences?edit=me">{tags(p.preferences.map(prefLabel))}</Row>
            <Row label="Dietary & allergies" to="/profile/dietary?edit=me">{tags([...p.dietary.map(dietLabel), ...p.allergies.map(x => `${allergyLabel(x)} allergy`)])}</Row>
          </div>
          <span className="hint" style={{ fontSize: 14 }}><Icon name="info" size={18} stroke={1.6} />Changes apply to mornings you plan from now on.</span>
        </section>
        {a.building && (
          <section className="stack gap-12">
            <span className="eyebrow">Saved delivery</span>
            <div className="card row" style={{ gap: 16, padding: '18px 20px' }}>
              <Icon name="pin" size={24} stroke={1.6} />
              <span className="stack" style={{ flex: 1 }}><span className="strong" style={{ fontSize: 17 }}>{a.building}</span>
                <span className="help" style={{ fontSize: 15 }}>{a.unit} · {a.area} · {a.handover === 'door' ? 'Door' : 'Reception'}{state.delivery.window ? ` · ${windowLabel(state.delivery.window)}` : ''}</span></span>
            </div>
          </section>
        )}
        <section className="card list">
          <div className="list-row"><span className="strong" style={{ flex: 1 }}>Receipt email</span><span className="help" style={{ fontSize: 15 }}>{state.user.email || 'Not added'}</span></div>
          <div className="list-row"><span className="strong" style={{ flex: 1 }}>Drink reminder</span>
            <Switch checked={state.settings.coffeeReminder} label="Drink reminder" onChange={v => set(s => { s.settings.coffeeReminder = v; })} /></div>
          <button type="button" className="list-row" style={{ width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--line-soft)', cursor: 'pointer', textAlign: 'left', color: 'var(--espresso)' }}
            onClick={async () => {
              await post('/auth/logout').catch(() => {});
              setToken(null);
              set(s => { s.session = null; s.user = null; s.orders = []; s.businessUser = null; s.businessOrders = []; });
              nav('/');
            }}>
            <Icon name="logout" size={20} /><span className="strong">Sign out</span>
          </button>
        </section>
        <button className="btn-text" style={{ alignSelf: 'center', fontSize: 13, color: 'var(--text-3)' }}
          onClick={() => { if (window.confirm('Clear Morning Box data saved on this device? Your account and orders stay on the server.')) { setToken(null); reset(); nav('/'); } }}>Clear data on this device</button>
      </main>
      <TabBar active="/me" />
    </Screen>
  );
}
