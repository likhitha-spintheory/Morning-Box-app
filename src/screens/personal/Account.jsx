import { useEffect, useState } from 'react';
import { get, post, patch, setToken } from '../../api.js';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Screen, TopBar, Footer, Icon, Logo, TabBar, Switch, Note, Qty, Money } from '../../components/ui.jsx';
import { useStore } from '../../state/store.jsx';
import {
  CONTEXTS, DELIVERY_WINDOWS, dateInfo, todayIso, boxTitle, sizeLabel, extrasText, windowLabel, contextLabel,
  eatingLabel, prefLabel, dietLabel, allergyLabel, componentName, componentPortion, trackingStage, STAGES,
  isBeforeCutoff, cutoffLabel, timeLeft, dayPrice, sizePrice, canChooseSize, recommendDay, addonPrice
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

function allDays(orders) {
  return orders.flatMap(o => o.days.map(d => ({ ...d, orderId: o.id })));
}

function StatusPill({ day }) {
  const st = trackingStage(day);
  if (st === -1) return <span className="status off">Cancelled · refunded</span>;
  if (st === 3) return <span className="status done">Delivered{day.feedback ? ` · ${day.feedback}` : ''}</span>;
  if (st === 0) return <span className="status ok"><Icon name="check" size={12} stroke={3} />Confirmed</span>;
  return <span className="status prep">{STAGES[st]}</span>;
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
        <Logo width={122} />
        <Link to="/me" className="icon-btn" aria-label="My Morning Profile" style={{ background: 'var(--espresso)', color: 'var(--ivory)', borderColor: 'var(--espresso)', fontWeight: 600 }}>
          {state.user.firstName.charAt(0).toUpperCase()}
        </Link>
      </header>
      <main className="screen-main" style={{ paddingTop: 8, gap: 22 }}>
        <div className="stack gap-4">
          <span className="sm">{dateInfo(today).long}</span>
          <h1 className="h-display">{greet}, {state.user.firstName}</h1>
        </div>

        {next ? (
          <Link to={`/orders/${next.orderId}/${next.date}`} className="dark-band" style={{ textDecoration: 'none', padding: 18, gap: 8 }}>
            <div className="row"><span className="eyebrow">{next.date === dateInfo(today).iso ? 'Today' : 'Next breakfast'}</span><StatusPill day={next} /></div>
            <span style={{ font: '700 22px/1.2 var(--sans)' }}>{dateInfo(next.date).label} · {windowLabel(next.window)}</span>
            <span style={{ fontSize: 15, color: '#E9DCC6' }}>{boxTitle(next.cfg)} · {sizeLabel(next.cfg.size)}{next.cfg.addons.length ? ' + extras' : ''}</span>
            {isBeforeCutoff(next.date) && <span style={{ fontSize: 13, color: '#E9DCC6' }}>Changes possible until {cutoffLabel(next.date)}</span>}
          </Link>
        ) : (
          <div className="card stack gap-4"><span className="strong">No mornings planned yet</span><span className="sm">Plan tomorrow or the whole week in a few taps.</span></div>
        )}

        <ErrorBanner>{loadError}</ErrorBanner>
        {inProgress && (
          <Link to="/plan/summary" className="banner-warn" style={{ textDecoration: 'none', alignItems: 'center' }}>
            <Icon name="cal" size={20} color="#6E4F0E" /><span><b>Plan in progress</b> · {state.plan.dates.length} morning{state.plan.dates.length > 1 ? 's' : ''}. Continue where you left off.</span>
          </Link>
        )}

        <Link to="/start" className="btn">Plan My Mornings</Link>

        {lastOrder && (
          <section className="stack gap-10">
            <span className="eyebrow">Plan faster</span>
            <Link to={`/plan/dates?reuse=${lastOrder.id}`} className="card row" style={{ textDecoration: 'none', padding: '16px 18px' }}>
              <span className="ci"><Icon name="repeat" size={20} /></span>
              <span className="stack" style={{ flex: 1 }}><span className="strong">Use This Plan Again</span>
                <span className="sm">Copy {lastOrder.days.length} morning{lastOrder.days.length > 1 ? 's' : ''} to the dates you choose</span></span>
              <Icon name="chevron" size={18} stroke={1.8} />
            </Link>
            <Link to="/orders?tab=past" className="card row" style={{ textDecoration: 'none', padding: '16px 18px' }}>
              <span className="ci"><Icon name="box" size={20} /></span>
              <span className="stack" style={{ flex: 1 }}><span className="strong">Reorder a Previous Morning</span><span className="sm">Pick a breakfast you’ve had before</span></span>
              <Icon name="chevron" size={18} stroke={1.8} />
            </Link>
          </section>
        )}
        <p className="xs" style={{ margin: 0 }}>Nothing is ordered automatically — you confirm every morning.</p>
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
      <main className="screen-main" style={{ paddingTop: 28 }}>
        <h1 className="h-display">My orders</h1>
        <div className="seg" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }} role="tablist">
          {['upcoming', 'past'].map(t => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setParams({ tab: t })}>
              {t === 'upcoming' ? 'Upcoming' : 'Past'}
            </button>
          ))}
        </div>
        <ErrorBanner>{loadError}</ErrorBanner>
        {!list.length && (
          <div className="card stack gap-8">
            <span className="strong">{tab === 'past' ? 'No past mornings yet' : 'No upcoming mornings'}</span>
            <Link to="/start" className="btn-secondary">Plan My Mornings</Link>
          </div>
        )}
        {list.map(d => (
          <div key={d.orderId + d.date} className="card stack gap-4" style={{ padding: '16px 18px' }}>
            <Link to={`/orders/${d.orderId}/${d.date}`} className="stack gap-4" style={{ textDecoration: 'none' }}>
              <div className="row"><strong>{dateInfo(d.date).label}</strong><StatusPill day={d} /></div>
              <span className="sm" style={{ color: 'var(--espresso)' }}>{boxTitle(d.cfg)} · {sizeLabel(d.cfg.size)}{d.cfg.addons.length ? ` + ${extrasText(d.cfg.addons)}` : ''}</span>
              <span className="xs">{windowLabel(d.window)} · {d.orderId}{!d.cancelled && isBeforeCutoff(d.date) ? ` · Editable until ${cutoffLabel(d.date)}` : ''}</span>
            </Link>
            {tab === 'past' && !d.cancelled && (
              <div className="row" style={{ marginTop: 6 }}>
                {trackingStage(d) === 3 && !d.feedback ? <Link to={`/orders/${d.orderId}/${d.date}/feedback`} className="link">Rate this morning</Link> : <span />}
                <Link to={`/plan/dates?reorder=${d.orderId}:${d.date}`} className="add" style={{ textDecoration: 'none' }}>Order again</Link>
              </div>
            )}
          </div>
        ))}
      </main>
      <TabBar active="/orders" />
    </Screen>
  );
}

/* ---------- Order details & tracking (MB-DLV-001 §5) ---------- */
export function OrderDay() {
  const { id, date } = useParams();
  const { state, set } = useStore();
  useOrders();
  const [busy, setBusy] = useState(false);
  const order = state.orders.find(o => o.id === id);
  const day = order?.days.find(d => d.date === date);
  if (!day) return <Navigate to="/orders" replace />;
  const st = trackingStage(day);
  const editable = !day.cancelled && isBeforeCutoff(date) && trackingStage(day) === 0;
  const nextEditable = order.days.find(d => !d.cancelled && d.date !== date && isBeforeCutoff(d.date) && trackingStage(d) === 0);
  const heading = st === -1 ? 'This morning was cancelled'
    : st === 3 ? 'Delivered — enjoy your breakfast'
    : st === 2 ? `On its way — arriving by ${windowLabel(day.window).split('–')[1]?.trim() || ''}`
    : st === 1 ? 'Being prepared fresh this morning'
    : 'Confirmed and planned';
  const advance = async () => {
    setBusy(true);
    try { await post('/demo/advance', { orderId: id, date }); const o = await get(`/orders/${id}`); set(s => replaceOrder(s, o)); }
    catch { /* demo helper only */ } finally { setBusy(false); }
  };
  const price = dayPrice(day.cfg, state.profile);

  return (
    <Screen>
      <TopBar back="/orders" close={null}><span className="topbar-title">{id}</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8, gap: 18 }}>
        <div className="stack gap-4">
          <span className="date-title" style={{ fontSize: 28 }}>{dateInfo(date).long}</span>
          <span className="serif" style={{ fontSize: 26, lineHeight: 1.15 }}>{heading}</span>
        </div>

        {st >= 0 && (
          <section className="card track" aria-label="Delivery progress">
            {STAGES.map((label, i) => (
              <div key={label} className={`ts${i < st || st === 3 ? ' done' : i === st ? ' current' : ''}`}>
                {i < 3 && <span className="ln" />}
                <span className="b">{i < st || st === 3 ? <Icon name="check" size={13} stroke={3.5} /> : i === st ? <Icon name="arrow" size={13} stroke={2.6} /> : null}</span>
                <span className="stack"><strong style={i > st ? { color: 'var(--text-3)' } : undefined}>{label}</strong>
                  <span className="xs">{i === 0 ? `Order ${id}` : i === 1 ? 'Fresh on the morning' : i === 2 ? `Within ${windowLabel(day.window)}` : `${day.address.handover === 'door' ? 'Your door' : 'Reception'}, ${day.address.building}`}</span></span>
              </div>
            ))}
          </section>
        )}

        <section className="card stack gap-10">
          <h2 className="h3">Your Morning Box · {sizeLabel(day.cfg.size)}</h2>
          <span className="sm">{day.cfg.components.map(componentName).join(' · ')}</span>
          {day.cfg.addons.length > 0 && <span className="sm">Extras: {extrasText(day.cfg.addons)}</span>}
          <hr className="divider" style={{ background: 'var(--line-soft)' }} />
          <div className="sr"><span className="sm">Prepared by</span><span className="strong" style={{ textAlign: 'right' }}>{st >= 1 && day.bakery ? day.bakery : 'Assigned after the 9:00 PM cutoff'}</span></div>
          <div className="sr"><span className="sm">Deliver to</span><span className="strong" style={{ textAlign: 'right' }}>{day.address.handover === 'door' ? 'Door' : 'Reception'} · {day.address.unit}</span></div>
          <div className="sr"><span className="sm">This morning</span><Money value={price.total} /></div>
        </section>

        {day.cancelled ? (
          <Note>Cancelled before the cutoff — a full refund of AED {price.total} goes back to your original payment method.</Note>
        ) : editable ? (
          <Link to={`/orders/${id}/${date}/edit`} className="btn-secondary">Edit or Cancel This Morning</Link>
        ) : st === 3 ? null : (
          <div className="note"><Icon name="clock" size={20} color="#7A5A14" style={{ flex: 'none' }} />
            <span>{st > 0 ? 'This morning is being prepared, so it can no longer be changed.' : 'Changes for this morning closed at 9:00 PM the evening before.'}{nextEditable ? ` ${dateInfo(nextEditable.date).label} can still be edited.` : ''}</span></div>
        )}
        {st === 3 && !day.feedback && <Link to={`/orders/${id}/${date}/feedback`} className="btn">How was your morning?</Link>}
        {nextEditable && !editable && <Link to={`/orders/${id}/${nextEditable.date}/edit`} className="btn-secondary">Manage {dateInfo(nextEditable.date).label}</Link>}
        {SHOW_DEMO && !day.cancelled && st < 3 && <button className="btn-text" disabled={busy} style={{ alignSelf: 'center', fontSize: 13, color: 'var(--text-3)' }} onClick={advance}>Demo: advance delivery status</button>}
      </main>
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
      <main className="screen-main" style={{ paddingTop: 8 }}>
        <div className="stack gap-4">
          <span className="date-title" style={{ fontSize: 28 }}>{dateInfo(date).long}</span>
          <span className="sm">{boxTitle(draft.cfg)} · {sizeLabel(draft.cfg.size)}</span>
        </div>
        <div className="banner-warn" style={{ alignItems: 'center' }}>
          <Icon name="clock" size={22} color="#6E4F0E" />
          <span><b>Editable until {cutoffLabel(date)}</b><br /><span className="xs" style={{ color: 'var(--text-2)' }}>{timeLeft(date)} left</span></span>
        </div>

        <section className="stack gap-10">
          <h2 className="h3">Morning type</h2>
          <div className="chips">
            {CONTEXTS.map(c => (
              <button key={c.id} type="button" className={`chip${draft.cfg.context === c.id ? ' on' : ''}`} aria-pressed={draft.cfg.context === c.id} onClick={() => changeContext(c.id)}>{c.label}</button>
            ))}
          </div>
          {ctxError && <span className="err-msg"><Icon name="alert" size={14} stroke={2.2} />{ctxError}</span>}
        </section>

        {canChooseSize(draft.cfg) && (
          <section className="stack gap-10">
            <h2 className="h3">Size</h2>
            <div className="seg tall" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }} role="radiogroup">
              {['light', 'regular', 'large'].map(sz => (
                <button key={sz} role="radio" aria-checked={draft.cfg.size === sz} className={draft.cfg.size === sz ? 'on' : ''}
                  onClick={() => setDraft(d => ({ ...d, cfg: { ...d.cfg, size: sz } }))}>{sizeLabel(sz)}<span>AED {sizePrice(draft.cfg, sz)}</span></button>
              ))}
            </div>
          </section>
        )}

        {pastry && (
          <section className="stack gap-10">
            <h2 className="h3">Pastry extras</h2>
            <div className="card list">
              {pastry.items.map(item => (
                <div key={item} className="list-row">
                  <span className="stack" style={{ flex: 1 }}><span className="strong">{componentName(item)}</span><span className="xs">AED {addonPrice({ group: 'pastry', item, qty: 1 })} each</span></span>
                  <Qty value={qtyOf(item)} max={9} label={componentName(item)} onChange={q => setPastry(item, q)} />
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="stack gap-10">
          <h2 className="h3">Delivery window</h2>
          <div className="grid-3">
            {DELIVERY_WINDOWS.map(w => (
              <button key={w.id} type="button" className={`win${draft.window === w.id ? ' on' : ''}`} style={{ justifyContent: 'center', padding: '0 6px', fontSize: 14, fontWeight: 600 }}
                aria-pressed={draft.window === w.id} onClick={() => setDraft(d => ({ ...d, window: w.id }))}>{w.label.replace(' AM', '')}</button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="sr total"><span>This morning</span><span>AED {price.total}</span></div>
          {price.total !== day.price && <span className="xs">Was AED {day.price}. The difference is charged or refunded to your original payment method.</span>}
        </section>

        <section className="stack gap-10" style={{ marginTop: 8 }}>
          {!confirmCancel ? (
            <button className="btn-danger" onClick={() => setConfirmCancel(true)}>Cancel This Morning</button>
          ) : (
            <div className="card stack gap-10" role="alertdialog" aria-labelledby="cc">
              <strong id="cc">Cancel {dateInfo(date).label}?</strong>
              <span className="sm">You’ll get a full refund of AED {day.price}.{others.length ? ` ${others.join(' and ')} stay as planned.` : ''}</span>
              <div className="grid-2"><button className="btn-secondary" onClick={() => setConfirmCancel(false)}>Keep it</button><button className="btn-danger" disabled={busy} onClick={cancel}>Yes, cancel</button></div>
            </div>
          )}
        </section>
        <ErrorBanner>{error}</ErrorBanner>
      </main>
      <Footer><button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save Changes'}</button></Footer>
    </Screen>
  );
}

/* ---------- Loved it / Not for me (MB-REC-001 §14) ---------- */
export function Feedback() {
  const { id, date } = useParams();
  const { state, set } = useStore();
  const [error, setError] = useState('');
  const order = state.orders.find(o => o.id === id);
  const day = order?.days.find(d => d.date === date);
  if (!day) return <Navigate to="/orders" replace />;
  const give = v => post(`/orders/${id}/days/${date}/feedback`, { value: v })
    .then(o => { setError(''); set(s => replaceOrder(s, o)); }).catch(e => setError(e.message));
  return (
    <Screen>
      <TopBar back={`/orders/${id}/${date}`} close={null}><span /></TopBar>
      <main className="screen-main" style={{ paddingTop: 16, gap: 24 }}>
        <div className="stack gap-10">
          <span className="sm">Delivered to {day.address.handover === 'door' ? 'your door' : 'Reception'} · {dateInfo(date).label}</span>
          <h1 className="h-display" style={{ fontSize: 38 }}>How was your Morning Box?</h1>
          <p className="help">One tap helps us get your next morning even more right.</p>
        </div>
        <div className="grid-2">
          {[['Loved it', 'heart'], ['Not for me', 'meh']].map(([v, icon]) => (
            <button key={v} type="button" className={`tile${day.feedback === v ? ' on' : ''}`} aria-pressed={day.feedback === v} onClick={() => give(v)}
              style={{ alignItems: 'center', justifyContent: 'center', minHeight: 168 }}>
              <span className="ico" style={{ width: 60, height: 60 }}><Icon name={icon} size={28} stroke={1.6} /></span>
              <span className="strong" style={{ fontSize: 17 }}>{v}</span>
            </button>
          ))}
        </div>
        <ErrorBanner>{error}</ErrorBanner>
        {day.feedback && (
          <div className="banner-ok" role="status"><Icon name="check" size={18} stroke={2.6} /><span>Thanks, {state.user?.firstName} — noted for next time.</span></div>
        )}
      </main>
      <Footer><Link to="/start" className="btn">Plan Your Next Morning</Link></Footer>
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
    <div className="list-row" style={{ minHeight: 72 }}>
      <span className="stack gap-4" style={{ flex: 1 }}><span className="xs">{label}</span>{children}</span>
      {to && <Link to={to} style={{ fontWeight: 600, fontSize: 14, padding: '12px 0' }}>Change</Link>}
    </div>
  );
  const tags = list => list.length ? <span className="tags">{list.map(t => <span key={t} className="tag">{t}</span>)}</span> : <span className="strong">None</span>;

  return (
    <Screen>
      <main className="screen-main" style={{ paddingTop: 28 }}>
        <div className="row" style={{ justifyContent: 'flex-start', gap: 14 }}>
          <span style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--espresso)', color: 'var(--ivory)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '600 22px/1 var(--sans)' }}>{state.user.firstName.charAt(0).toUpperCase()}</span>
          <span className="stack"><span className="serif" style={{ fontSize: 30, lineHeight: 1.1 }}>{state.user.firstName}</span><span className="sm">{state.user.mobile}</span></span>
        </div>
        <section className="stack gap-10">
          <span className="eyebrow">My Morning Profile</span>
          <div className="card list">
            <Row label="Eating style" to="/profile/eating?edit=me"><span className="strong">{eatingLabel(p.eatingStyle) || 'Not set'}</span></Row>
            <Row label="Breakfast I enjoy" to="/profile/preferences?edit=me">{tags(p.preferences.map(prefLabel))}</Row>
            <Row label="Dietary & allergies" to="/profile/dietary?edit=me">{tags([...p.dietary.map(dietLabel), ...p.allergies.map(x => `${allergyLabel(x)} allergy`)])}</Row>
          </div>
          <p className="xs" style={{ margin: 0 }}>Changes apply to mornings you plan from now on. Confirmed mornings stay as they are.</p>
        </section>
        {a.building && (
          <section className="stack gap-10">
            <span className="eyebrow">Saved delivery</span>
            <div className="card list">
              <Row label="Address"><span className="strong">{a.building}</span><span className="sm">{a.unit} · {a.area} · {a.handover === 'door' ? 'Door' : 'Reception'}</span></Row>
              {state.delivery.window && <Row label="Usual window"><span className="strong">{windowLabel(state.delivery.window)}</span></Row>}
            </div>
          </section>
        )}
        <section className="card list">
          <div className="list-row"><span className="strong" style={{ flex: 1 }}>Receipt email</span><span className="sm">{state.user.email || 'Not added'}</span></div>
          <div className="list-row"><span className="strong" style={{ flex: 1 }}>Coffee reminder</span>
            <Switch checked={state.settings.coffeeReminder} label="Coffee reminder" onChange={v => set(s => { s.settings.coffeeReminder = v; })} /></div>
          <button type="button" className="list-row" style={{ width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--line-soft)', cursor: 'pointer', textAlign: 'left' }}
            onClick={async () => {
              await post('/auth/logout').catch(() => {});
              setToken(null);
              set(s => { s.session = null; s.user = null; s.orders = []; s.businessUser = null; s.businessOrders = []; });
              nav('/');
            }}>
            <Icon name="logout" size={18} /><span className="strong">Sign out</span>
          </button>
        </section>
        <button className="btn-text" style={{ alignSelf: 'center', fontSize: 13, color: 'var(--text-3)' }}
          onClick={() => { if (window.confirm('Clear Morning Box data saved on this device? Your account and orders stay on the server.')) { setToken(null); reset(); nav('/'); } }}>Clear data on this device</button>
      </main>
      <TabBar active="/me" />
    </Screen>
  );
}
