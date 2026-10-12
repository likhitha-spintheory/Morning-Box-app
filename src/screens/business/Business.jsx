import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  Screen, TopBar, Progress, Footer, Icon, Tick, Note, Money, Qty, Chip, Switch, InfoTip, AreaField
} from '../../components/ui.jsx';
import { useStore, emptyBusiness } from '../../state/store.jsx';
import { get, post, patch, del, download, applySession, setToken, resetPersonal, newIdempotencyKey, track } from '../../api.js';
import { pastedCode, Agreement } from '../personal/Checkout.jsx';
import { useConfig, closedOn } from '../../state/config.js';

const SHOW_DEMO = import.meta.env.DEV || import.meta.env.VITE_DEMO === '1';
import { businessModels, morningBoxMix, resolveSpecial, priceBusinessDay } from '../../domain/engine.js';
import { recipeById, describe, priceLevel } from '../../domain/recipes.js';
import { COMPONENTS } from '../../domain/library.js';
import { DIETARY, ALLERGENS, DELIVERY_WINDOWS, SIZE_ADJUSTMENT, PRICE_LEVELS, areaFor } from '../../domain/standards.js';
import {
  dateInfo, planningWeeks, cutoffLabel, isBeforeCutoff, windowLabel, componentName, dietLabel, allergyLabel,
  sizeLabel, todayIso, serverDateIso
} from '../../domain/app.js';

/* ============================================================
   Business Breakfast (MB-B2B-001)
   Breakfast Model × Size × Quantity only — no swaps, no add-ons,
   no component customization. Everything in state stays serializable:
   lines are { recipeId, size, qty }, specials are { dietary, allergies, qty }.
   ============================================================ */

/* No fixed maximum headcount (MB-DLV-001 §8): real bakery and delivery capacity is checked
   before payment. This is only the input limit of the people field. */
const MAX_PEOPLE = 999;
const PREF_NAME = { savory: 'Savory Box', bakery: 'Bakery Box', fresh: 'Fresh Box', sweet: 'Sweet Box' };
const SIZES = ['light', 'regular', 'large'];
const SEG2 = { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' };
const SEG3 = { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' };

/* ---------- helpers ---------- */
const sum = (list, f = x => x.qty || 0) => list.reduce((t, x) => t + f(x), 0);
const modelName = r => `${PREF_NAME[r.preference] || 'Morning Box'}${r.eatingStyle === 'health' ? ' · Health-Conscious' : ''}`;
const toModel = r => ({ recipe: r, label: describe(r), base: PRICE_LEVELS[priceLevel(r)] });
const hydrateLine = l => ({ model: toModel(recipeById[l.recipeId]), size: l.size, qty: l.qty });
const linePrice = l => toModel(recipeById[l.recipeId]).base + SIZE_ADJUSTMENT[l.size];
const mixLines = (general, sizes = {}) =>
  general > 0 ? morningBoxMix(general, 'regular').map(l => ({ recipeId: l.model.recipe.id, size: sizes[l.model.recipe.id] || 'regular', qty: l.qty })) : [];
const fmtMobile = d => `+971 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
const mobileDigits = v => v.replace(/\D/g, '').replace(/^971/, '').replace(/^0/, '');
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
const trnOk = v => { const d = v.replace(/\D/g, ''); return !d || d.length === 15; };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const activeSpecials = b => (b.hasSpecial ? b.specials : []);
const specialQty = b => sum(activeSpecials(b));
const specialText = s => [...s.dietary.map(dietLabel), ...s.allergies.map(a => `${allergyLabel(a).split(' /')[0]}-free`)].join(', ') + (s.size && s.size !== 'regular' ? ` (${sizeLabel(s.size)})` : '');
const linesText = lines => lines.filter(l => l.qty > 0)
  .map(l => `${modelName(recipeById[l.recipeId])} × ${l.qty} (${sizeLabel(l.size)})`).join(' · ');

/**
 * Edit one day's breakfasts: every model × size × quantity, plus Special Breakfast groups
 * (add, change requirements or size, remove). Used for "Customize Each Day" and when
 * managing a confirmed order (MB-FLW-001 §14, MB-B2B-001 §10).
 */
function DayBoxes({ lines, specials, onChange, max = MAX_PEOPLE }) {
  const models = useMemo(() => businessModels('regular'), []);
  /* null | { recipeId, size } | { special: { dietary, allergies, size }, index? } — `index` edits an existing group (B2B §10 Update Special Breakfast). */
  const [adding, setAdding] = useState(null);
  const set = (nextLines, nextSpecials) => onChange(nextLines.filter(l => l.qty > 0), nextSpecials.filter(x => x.qty > 0));
  const toggleNeed = (k, id) => setAdding(a => ({ ...a, special: { ...a.special, [k]: a.special[k].includes(id) ? a.special[k].filter(x => x !== id) : [...a.special[k], id] } }));
  const resolved = adding?.special && (adding.special.dietary.length + adding.special.allergies.length) ? resolveSpecial({ ...adding.special, qty: 1 }, 'regular') : null;
  return (
    <div className="stack gap-10">
      {lines.map((l, i) => (
        <div key={`${l.recipeId}-${l.size}-${i}`} className="stack gap-6" style={{ paddingBottom: 8, borderBottom: '1px solid var(--line-soft)' }}>
          <div className="row">
            <span className="stack"><span className="strong">{modelName(recipeById[l.recipeId])}</span><span className="xs">{describe(recipeById[l.recipeId])} · AED {linePrice(l)}</span></span>
            <Qty value={l.qty} max={max} label={modelName(recipeById[l.recipeId])} onChange={v => set(lines.map((x, k) => (k === i ? { ...x, qty: v } : x)), specials)} />
          </div>
          <SizeSeg value={l.size} label={`Size for ${modelName(recipeById[l.recipeId])}`} onChange={sz => set(lines.map((x, k) => (k === i ? { ...x, size: sz } : x)), specials)} />
        </div>
      ))}
      {specials.map((x, i) => (
        <div key={`sp${i}`} className="stack gap-6" style={{ paddingBottom: 8, borderBottom: '1px solid var(--line-soft)' }}>
          <div className="row">
            <span className="row" style={{ gap: 10 }}><Icon name="shield" size={18} stroke={1.6} /><span className="stack"><span className="strong">Special Breakfast</span><span className="xs">{specialText({ ...x, size: 'regular' })}</span></span></span>
            <Qty value={x.qty} min={0} max={max} label={`special breakfasts (${specialText(x)})`} onChange={v => set(lines, specials.map((y, k) => (k === i ? { ...y, qty: v } : y)))} />
          </div>
          <SizeSeg value={x.size || 'regular'} label="Special Breakfast size" onChange={sz => set(lines, specials.map((y, k) => (k === i ? { ...y, size: sz } : y)))} />
          {!adding && <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding({ index: i, special: { dietary: [...x.dietary], allergies: [...x.allergies], size: x.size || 'regular' } })}>Change requirements</button>}
        </div>
      ))}
      {!adding && (
        <div className="row" style={{ justifyContent: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
          <button type="button" className="link" onClick={() => setAdding({ recipeId: '', size: 'regular' })}>+ Add a breakfast</button>
          <button type="button" className="link" onClick={() => setAdding({ special: { dietary: [], allergies: [], size: 'regular' } })}>+ Add a Special Breakfast</button>
        </div>
      )}
      {adding && !adding.special && (
        <div className="card stack gap-8" style={{ padding: 14 }}>
          <select className="input" aria-label="Breakfast" value={adding.recipeId} onChange={e => setAdding(a => ({ ...a, recipeId: e.target.value }))}>
            <option value="">Choose a breakfast…</option>{models.map(m => <option key={m.recipe.id} value={m.recipe.id}>{modelName(m.recipe)} — {m.label}</option>)}</select>
          <SizeSeg value={adding.size} label="Size" onChange={sz => setAdding(a => ({ ...a, size: sz }))} />
          <div className="row"><button type="button" className="link" onClick={() => setAdding(null)}>Cancel</button>
            <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '0 18px' }} disabled={!adding.recipeId}
              onClick={() => { const at = lines.findIndex(l => l.recipeId === adding.recipeId && l.size === adding.size); set(at >= 0 ? lines.map((l, k) => (k === at ? { ...l, qty: l.qty + 1 } : l)) : [...lines, { recipeId: adding.recipeId, size: adding.size, qty: 1 }], specials); setAdding(null); }}>Add</button></div>
        </div>
      )}
      {adding?.special && (
        <div className="card stack gap-8" style={{ padding: 14 }} aria-label={adding.index !== undefined ? 'Change Special Breakfast requirements' : 'Add a Special Breakfast'}>
          <span className="label">Dietary</span>
          <div className="chips">{DIETARY.map(x => <Chip key={x.id} on={adding.special.dietary.includes(x.id)} onClick={() => toggleNeed('dietary', x.id)}>{x.label}</Chip>)}</div>
          <span className="label">Allergens</span>
          <div className="chips">{ALLERGENS.map(x => <Chip key={x.id} on={adding.special.allergies.includes(x.id)} onClick={() => toggleNeed('allergies', x.id)}>{x.label}</Chip>)}</div>
          {resolved && !resolved.resolved && <Err>No approved breakfast can safely meet this combination yet.</Err>}
          <div className="row"><button type="button" className="link" onClick={() => setAdding(null)}>Cancel</button>
            <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '0 18px' }} disabled={!resolved?.resolved}
              onClick={() => {
                const { index, special } = adding;
                /* Only the requirements change; quantity and size stay, and the safe breakfast is re-resolved from them. */
                set(lines, index !== undefined
                  ? specials.map((y, k) => (k === index ? { dietary: special.dietary, allergies: special.allergies, qty: y.qty, size: y.size || 'regular' } : y))
                  : [...specials, { ...special, qty: 1 }]);
                setAdding(null);
              }}>{adding.index !== undefined ? 'Save' : 'Add'}</button></div>
        </div>
      )}
    </div>
  );
}

/** Price one day from serializable lines and specials. */
function priceDay(lines, specials) {
  const p = priceBusinessDay(lines.filter(l => l.qty > 0).map(hydrateLine), specials.map(s => resolveSpecial(s, 'regular')));
  return { ...p, gross: Math.round(p.gross), discount: Math.round(p.discount), total: Math.round(p.total) };
}

/** Largest-remainder rescale of chosen lines to a new general count. */
function scaleLines(lines, target) {
  const total = sum(lines);
  if (!total || target <= 0) return lines.map(l => ({ ...l, qty: 0 }));
  const raw = lines.map(l => (l.qty * target) / total);
  const out = lines.map((l, i) => ({ ...l, qty: Math.floor(raw[i]) }));
  let rem = target - sum(out);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rem > 0) { out[i].qty++; rem--; } });
  return out;
}

const dayPeople = (b, iso) => (!b.sameForAll && b.perDay?.[iso]?.people ? b.perDay[iso].people : b.people);
/* Customize Each Day (MB-FLW-001 §14): a date may have its own boxes and Special Breakfasts. */
const daySpecials = (b, iso) => (!b.sameForAll && b.perDay?.[iso]?.specials ? b.perDay[iso].specials : activeSpecials(b));

/** The general lines for one date, rescaled when that date has its own headcount. */
function dayLines(b, iso, people = dayPeople(b, iso)) {
  if (!b.sameForAll && b.perDay?.[iso]?.lines) return b.perDay[iso].lines;
  const general = Math.max(0, people - sum(daySpecials(b, iso)));
  const base = b.lines || [];
  if (general === sum(base)) return base;
  if (b.mode === 'mix' || !sum(base)) return mixLines(general, Object.fromEntries(base.map(l => [l.recipeId, l.size])));
  return scaleLines(base, general);
}
const windowFor = (b, iso) => (b.deliverySameForAll === false ? (b.perDay?.[iso]?.window || b.delivery.window) : b.delivery.window);

function useBiz() {
  const { state, set } = useStore();
  const b = state.business;
  const upd = fn => set(s => { fn(s.business); });
  return { state, set, b, upd };
}

const Err = ({ id, children }) => <span id={id} className="err-msg"><Icon name="alert" size={14} stroke={2.2} />{children}</span>;

function StepBar({ n, back }) {
  return (
    <>
      <TopBar back={back} close="/"><span className="topbar-title">Business Breakfast · {n} of 5</span></TopBar>
      <Progress step={n} />
    </>
  );
}

function SizeSeg({ value, onChange, label }) {
  return (
    <div className="seg" style={SEG3} role="radiogroup" aria-label={label}>
      {SIZES.map(sz => (
        <button key={sz} type="button" role="radio" aria-checked={value === sz} className={value === sz ? 'on' : ''}
          style={{ fontSize: 14, minHeight: 44 }} onClick={() => onChange(sz)}>{value === sz && <Icon name="check" size={14} stroke={2.4} style={{ marginRight: 4 }} />}{sizeLabel(sz)}</button>
      ))}
    </div>
  );
}

function PriceSummary({ price, people }) {
  return (
    <section className="panel" aria-label="Price per day">
      <div className="sr"><span>{price.boxes} boxes</span><Money value={price.gross} /></div>
      {price.discount > 0 && (
        <div className="sr" style={{ color: 'var(--ok)' }}><span>Volume discount ({Math.round(price.discountPct * 100)}%)</span><span className="money">− AED {price.discount}</span></div>
      )}
      <hr className="divider" />
      <div className="sr total"><span>Per day</span><span>AED {price.total}</span></div>
      {people !== undefined && (
        <span className="sm" style={{ color: price.boxes === people ? 'var(--ok)' : 'var(--err)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name={price.boxes === people ? 'check' : 'alert'} size={15} stroke={2.4} />
          {price.boxes} boxes {price.boxes === people ? '=' : '≠'} {people} people{price.boxes === people ? ' ✓' : ''}
        </span>
      )}
    </section>
  );
}

const ApiErr = ({ error }) => (error
  ? <div className="banner-err" role="alert"><Icon name="alert" size={18} stroke={2.2} style={{ flex: 'none' }} /><span>{error}</span></div>
  : null);

/** Replace an order by id, or add it to the top. */
function putOrder(s, order) {
  const i = s.businessOrders.findIndex(o => o.id === order.id);
  if (i >= 0) s.businessOrders[i] = order; else s.businessOrders.unshift(order);
}

/** Refresh business orders from the server when signed in (401 / offline ignored). */
function useSyncOrders() {
  const { state, set } = useStore();
  const signedIn = !!state.session;
  useEffect(() => {
    if (!signedIn) return undefined;
    let live = true;
    get('/business/orders').then(res => { if (live && Array.isArray(res)) set(s => { s.businessOrders = res; }); }).catch(() => {});
    return () => { live = false; };
  }, [signedIn, set]);
}

/** Server invoice when signed in; local demo invoice otherwise (or if the server can't be reached). */
function getInvoice(order, signedIn) {
  if (signedIn) return download(`/business/orders/${order.id}/invoice`, `Morning-Box-${order.id}.html`).catch(() => downloadInvoice(order));
  downloadInvoice(order);
  return Promise.resolve();
}

function downloadInvoice(order) {
  /* Offline copy only: the tax invoice itself always comes from the server. */
  const rows = order.days.map(d => `<tr><td>${esc(dateInfo(d.date).label)}${d.cancelled ? ' (cancelled, refunded)' : ''}</td><td>${esc(d.people)} people</td><td>${esc(linesText(d.lines))}${d.specials.length ? ` · Special × ${sum(d.specials)}` : ''}</td><td style="text-align:right">AED ${d.cancelled ? 0 : esc(d.total)}</td></tr>`).join('');
  const inv = order.invoice || {};
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Order summary ${esc(order.id)}</title>
<style>body{font-family:Arial,sans-serif;color:#3B2D22;max-width:720px;margin:40px auto;padding:0 20px}td,th{padding:8px;border-bottom:1px solid #EADCC1;text-align:left;font-size:14px}table{border-collapse:collapse;width:100%}</style></head>
<body><h1>Morning Box — Order summary</h1><p>Order ${esc(order.id)}<br>Placed ${esc(dateInfo(serverDateIso(order.createdAt)).label)}</p>
<p><b>Billed to:</b> ${esc(inv.billingName || order.company)}<br>${esc(inv.address || '')}${inv.trn ? `<br>TRN ${esc(inv.trn)}` : ''}${inv.po ? `<br>PO number: ${esc(inv.po)}` : ''}</p>
<table><thead><tr><th>Date</th><th>Headcount</th><th>Breakfasts</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<p style="text-align:right"><b>Total: AED ${esc(order.total)}</b><br>Delivery included</p><p style="font-size:12px">Saved offline — this summary is not a tax invoice. Download the invoice again when you’re back online.</p></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url; a.download = `MorningBox-Order-${order.id}.html`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Welcome back ---------- */
export function BizWelcome() {
  const { state, set } = useBiz();
  const nav = useNavigate();
  useSyncOrders();
  const user = state.businessUser;
  const orders = state.businessOrders || [];
  const [plans, setPlans] = useState([]);
  useEffect(() => {
    if (!state.session) return undefined;
    let live = true;
    get('/business/plans').then(p => { if (live && Array.isArray(p)) setPlans(p); }).catch(() => {});
    return () => { live = false; };
  }, [state.session]);
  if (!user && !orders.length) return <Navigate to="/business/people" replace />;

  const today = todayIso();
  const next = orders.flatMap(o => o.days.filter(d => !d.cancelled && d.date >= today).map(d => ({ o, d })))
    .sort((a, b) => a.d.date.localeCompare(b.d.date))[0];
  const last = orders[0];

  const fresh = () => {
    set(s => { s.business = { ...emptyBusiness(), delivery: { ...emptyBusiness().delivery, company: user?.company || '' } }; });
    nav('/business/people');
  };
  /* FLW §18: reorder any previous order; a multi-day order keeps each day's boxes for the dates chosen next. */
  const reorder = (which, orderId = s0 => s0.businessOrders[0].id) => {
    set(s => {
      const id = typeof orderId === 'function' ? orderId(s) : orderId;
      const o = s.businessOrders.find(x => x.id === id) || s.businessOrders[0];
      const live = o.days.filter(x => !x.cancelled);
      const d = live[0] || o.days[0];
      s.business = {
        ...emptyBusiness(),
        people: d.people, hasSpecial: d.specials.length > 0, specials: structuredClone(d.specials),
        mode: o.mode || 'mix', lines: structuredClone(d.lines),
        delivery: { ...emptyBusiness().delivery, ...structuredClone(d.delivery || {}), area: areaFor(d.delivery?.area) || '', window: d.window || null },
        source: { orderId: o.id, kind: which },
        sourceDays: live.length > 1 ? live.map(x => ({ lines: structuredClone(x.lines), specials: structuredClone(x.specials) })) : null
      };
    });
    nav('/business/dates');
  };
  const fromPlan = pl => {
    const p = pl.plan;
    set(s => {
      s.business = {
        ...emptyBusiness(),
        people: p.people, hasSpecial: p.specials.length > 0, specials: structuredClone(p.specials), mode: p.mode, lines: structuredClone(p.lines),
        delivery: { ...emptyBusiness().delivery, ...structuredClone(p.delivery), area: areaFor(p.delivery?.area) || '', window: p.delivery.window || null },
        source: { planId: pl.id, kind: 'plan' }
      };
    });
    nav('/business/dates');
  };
  const removePlan = id => del(`/business/plans/${id}`).then(() => setPlans(ps => ps.filter(p => p.id !== id))).catch(() => {});

  return (
    <Screen>
      <TopBar back="/" close={null}><span className="topbar-title">Business Breakfast</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 12, gap: 22 }}>
        <div className="stack gap-8">
          {user?.company && <span className="eyebrow">{user.company}</span>}
          <h1 className="h-display">{user ? `Welcome back, ${user.firstName}` : 'Business Breakfast'}</h1>
        </div>

        {next && (
          <Link to={`/business/orders/${next.o.id}`} className="dark-band" style={{ textDecoration: 'none' }}>
            <span className="eyebrow">Next delivery</span>
            <span style={{ font: '400 28px/1.15 var(--serif)' }}>{dateInfo(next.d.date).long}</span>
            <span style={{ fontSize: 15, color: '#E9DCC6' }}>{next.d.people} people · {windowLabel(next.d.window)}</span>
            <span className="row" style={{ fontSize: 14, fontWeight: 600 }}>
              <span>Order {next.o.id}</span><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Manage<Icon name="chevron" size={16} stroke={2} /></span>
            </span>
          </Link>
        )}

        <div className="stack gap-10">
          {last ? (
            <>
              <span className="eyebrow grey">Reorder a Previous Order</span>
              {orders.slice(0, 5).map(o => {
                const live = o.days.filter(d => !d.cancelled);
                const d = live[0] || o.days[0];
                return (
                  <button key={o.id} type="button" className="option" onClick={() => reorder('reorder', o.id)}>
                    <span className="ico"><Icon name="repeat" size={22} stroke={1.6} /></span>
                    <span className="stack gap-4"><span style={{ fontWeight: 600, fontSize: 17 }}>Order {o.id}</span>
                      <span className="sm">{live.length > 1 ? `${live.length} days · ` : ''}{d.people} people · {dateInfo(d.date).label}. You choose the dates.</span></span>
                    <Icon name="chevron" size={20} stroke={1.8} style={{ marginLeft: 'auto' }} />
                  </button>
                );
              })}
            </>
          ) : <p className="sm" style={{ margin: 0 }}>Your past orders will appear here so you can reorder in a few taps.</p>}
          {plans.map(pl => (
            <div key={pl.id} className="stack" style={{ gap: 2 }}>
              <button type="button" className="option" onClick={() => fromPlan(pl)}>
                <span className="ico"><Icon name="bookmark" size={22} stroke={1.6} /></span>
                <span className="stack gap-4"><span style={{ fontWeight: 600, fontSize: 17 }}>Use a Saved Plan · {pl.name}</span>
                  <span className="sm">{pl.plan.people} people. Headcount, special breakfasts and boxes are copied — you choose the dates.</span></span>
                <Icon name="chevron" size={20} stroke={1.8} style={{ marginLeft: 'auto' }} />
              </button>
              <button type="button" className="btn-text" style={{ alignSelf: 'flex-end', fontSize: 13, color: 'var(--text-3)' }} onClick={() => removePlan(pl.id)}>Remove saved plan</button>
            </div>
          ))}
        </div>
        <Note>Every order is one-off — never a subscription.</Note>
      </main>
      <Footer><button className="btn" onClick={fresh}><Icon name="plus" size={18} stroke={2} />New Business Breakfast</button></Footer>
    </Screen>
  );
}

/* ---------- Step 1 · People ---------- */
export function People() {
  const { b, upd } = useBiz();
  const nav = useNavigate();
  const [text, setText] = useState(String(b.people));
  const setPeople = n => {
    const v = Math.max(1, Math.min(MAX_PEOPLE, Math.round(n) || 1));
    upd(d => { d.people = v; });
    setText(String(v));
  };
  const big = { width: 60, height: 60 };

  return (
    <Screen>
      <StepBar n={1} back="/business" />
      <main className="screen-main" style={{ paddingTop: 28 }}>
        <div className="stack gap-10">
          <span className="eyebrow">Business Breakfast</span>
          <h1 className="q">How many people are you ordering for? <InfoTip label="Who to include">Include everyone. You can add special breakfasts for dietary needs or allergies in the next step.</InfoTip></h1>
        </div>
        <div className="row" style={{ justifyContent: 'center', gap: 20, padding: '12px 0' }}>
          <button type="button" className="icon-btn" style={big} aria-label="Fewer people" disabled={b.people <= 1} onClick={() => setPeople(b.people - 1)}><Icon name="minus" size={22} stroke={2} /></button>
          <label className="stack center" style={{ alignItems: 'center', gap: 2 }}>
            <span className="sr-only">Number of people</span>
            <input className="input" inputMode="numeric" value={text} aria-label="Number of people"
              style={{ width: 130, minHeight: 72, textAlign: 'center', font: '700 40px/1 var(--sans)' }}
              onChange={e => { const t = e.target.value.replace(/\D/g, '').slice(0, 3); setText(t); if (t) upd(d => { d.people = Math.max(1, Math.min(MAX_PEOPLE, +t)); }); }}
              onBlur={() => setPeople(+text)} />
            <span className="sm">people</span>
          </label>
          <button type="button" className="icon-btn" style={big} aria-label="More people" disabled={b.people >= MAX_PEOPLE} onClick={() => setPeople(b.people + 1)}><Icon name="plus" size={22} stroke={2} /></button>
        </div>
        <div className="chips" style={{ justifyContent: 'center' }} aria-label="Quick pick">
          {[5, 10, 20, 30, 50].map(n => <Chip key={n} on={b.people === n} onClick={() => setPeople(n)}>{n}</Chip>)}
        </div>
        <Note icon="info">Volume discount applies automatically.</Note>
      </main>
      <Footer><button className="btn" onClick={() => nav('/business/special')}>Continue</button></Footer>
    </Screen>
  );
}

/* ---------- Step 2 · Special Breakfasts ---------- */
export function Specials() {
  const { b, upd } = useBiz();
  const nav = useNavigate();
  const [touched, setTouched] = useState(false);
  const specials = b.specials || [];
  const sq = b.hasSpecial ? sum(specials) : 0;
  const general = b.people - sq;
  const resolved = specials.map(s => resolveSpecial(s, 'regular'));
  const groupErr = s => !(s.dietary.length + s.allergies.length) ? 'Choose at least one requirement' : s.qty < 1 ? 'Add at least one breakfast' : null;
  const overLimit = sq > b.people;
  const ok = b.hasSpecial === false ||
    (b.hasSpecial === true && specials.length > 0 && !overLimit && specials.every((s, i) => !groupErr(s) && resolved[i].resolved));

  const setHas = v => upd(d => { d.hasSpecial = v; if (v && !d.specials.length) d.specials = [{ dietary: [], allergies: [], qty: 1 }]; });
  const toggle = (i, key, id) => upd(d => {
    const list = d.specials[i][key];
    d.specials[i][key] = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
  });

  return (
    <Screen>
      <StepBar n={2} back="/business/people" />
      <main className="screen-main" style={{ paddingTop: 28 }}>
        <div className="stack gap-10">
          <span className="eyebrow">Special Breakfasts</span>
          <h1 className="q">Does anyone have dietary requirements or allergies?</h1>
        </div>
        <div className="seg" style={SEG2} role="radiogroup" aria-label="Dietary requirements or allergies">
          <button type="button" role="radio" aria-checked={b.hasSpecial === false} className={b.hasSpecial === false ? 'on' : ''} onClick={() => setHas(false)}>{b.hasSpecial === false && <Icon name="check" size={14} stroke={2.4} style={{ marginRight: 6 }} />}No</button>
          <button type="button" role="radio" aria-checked={b.hasSpecial === true} className={b.hasSpecial === true ? 'on' : ''} onClick={() => setHas(true)}>{b.hasSpecial === true && <Icon name="check" size={14} stroke={2.4} style={{ marginRight: 6 }} />}Yes</button>
        </div>

        {b.hasSpecial && (
          <>
            {specials.map((s, i) => {
              const err = groupErr(s);
              const unsafe = !err && !resolved[i].resolved;
              return (
                <section key={i} className="card stack gap-12" aria-label={`Special Breakfast ${i + 1}`}
                  style={unsafe || (touched && err) ? { borderColor: '#C9877C' } : undefined}>
                  <div className="row">
                    <h2 className="h3">Special Breakfast {i + 1}</h2>
                    <button type="button" className="link" style={{ padding: '10px 0' }} onClick={() => upd(d => { d.specials.splice(i, 1); if (!d.specials.length) d.hasSpecial = false; })}>Remove</button>
                  </div>
                  <span className="label">Dietary</span>
                  <div className="chips">{DIETARY.map(x => <Chip key={x.id} on={s.dietary.includes(x.id)} onClick={() => toggle(i, 'dietary', x.id)}>{x.label}</Chip>)}</div>
                  <span className="label">Allergens</span>
                  <div className="chips">{ALLERGENS.map(x => <Chip key={x.id} on={s.allergies.includes(x.id)} onClick={() => toggle(i, 'allergies', x.id)}>{x.label}</Chip>)}</div>
                  <div className="row">
                    <span className="label">Qty</span>
                    <Qty value={s.qty} min={1} max={b.people} label="special breakfasts" onChange={v => upd(d => { d.specials[i].qty = v; })} />
                  </div>
                  <SizeSeg value={s.size || 'regular'} label={`Size for Special Breakfast ${i + 1}`} onChange={sz => upd(d => { d.specials[i].size = sz; })} />
                  {!err && resolved[i].resolved && <span className="xs">{describe(resolved[i].resolved.recipe)}</span>}
                  {unsafe && <>
                    <Err>No approved breakfast can safely meet this combination yet.</Err>
                    {/* Master Plan §16: a safe no-match, with a way to reach us; recorded as a business inquiry (§15). */}
                    <Link to={`/help?topic=business&note=${encodeURIComponent(`Special Breakfast for: ${specialText(s)}`)}`} className="link" onClick={() => track('business_inquiry', { dietary: s.dietary, allergies: s.allergies })}>Ask our team about this requirement</Link>
                  </>}
                  {touched && err && <Err>{err}</Err>}
                </section>
              );
            })}
            <button type="button" className="chip dashed" style={{ justifyContent: 'center' }} onClick={() => upd(d => { d.specials.push({ dietary: [], allergies: [], qty: 1 }); })}>
              <Icon name="plus" size={16} stroke={2} />Add another Special Breakfast
            </button>
            {overLimit && <Err>Special Breakfasts ({sq}) can’t be more than the {b.people} people in the order</Err>}
            <Note icon="shield">Special Breakfasts are packed and labelled separately.</Note>
            <Note icon="info">Please confirm dietary needs and allergies with your attendees before ordering — we prepare exactly what you enter here.</Note>
          </>
        )}
      </main>
      <Footer>
        <div className="grid-3 center" aria-live="polite">
          <span className="stack"><span className="xs">People</span><span className="strong">{b.people}</span></span>
          <span className="stack"><span className="xs">Special</span><span className="strong">{sq}</span></span>
          <span className="stack"><span className="xs">General</span><span className="strong" style={general < 0 ? { color: 'var(--err)' } : undefined}>{general}</span></span>
        </div>
        <button className="btn" disabled={b.hasSpecial === null} onClick={() => { setTouched(true); if (ok) nav('/business/selection'); }}>
          {b.hasSpecial === null ? 'Choose No or Yes' : 'Continue'}
        </button>
      </Footer>
    </Screen>
  );
}

/* ---------- Step 3 · Selection ---------- */
export function Selection() {
  const { b, upd } = useBiz();
  const nav = useNavigate();
  const sq = specialQty(b);
  const general = b.people - sq;
  const stored = b.lines || [];
  const storedOk = stored.length > 0 && sum(stored) === general;
  const [mode, setMode] = useState(b.mode === 'choose' && storedOk ? 'choose' : 'mix');
  const [lines, setLines] = useState(() =>
    mode === 'choose' ? stored : b.mode === 'mix' && storedOk ? stored : mixLines(general, Object.fromEntries(stored.map(l => [l.recipeId, l.size]))));
  if (general < 0) return <Navigate to="/business/special" replace />;

  const specials = activeSpecials(b);
  const price = priceDay(lines, specials);
  const confirm = () => { upd(d => { d.mode = mode; d.lines = lines.filter(l => l.qty > 0); }); nav('/business/dates'); };

  return (
    <Screen>
      <StepBar n={3} back="/business/special" />
      <main className="screen-main" style={{ paddingTop: 28 }}>
        <div className="stack gap-10">
          <span className="eyebrow">Breakfast selection</span>
          <h1 className="q">How should we choose the {general} general breakfasts? <InfoTip label="About the options"><b>Morning Box Mix</b> gives a balanced spread across our breakfasts. <b>Choose Your Boxes</b> lets you pick each breakfast, size and quantity.</InfoTip></h1>
        </div>
        <div className="grid-2" role="radiogroup" aria-label="Selection method">
          <button type="button" className={`tile${mode === 'mix' ? ' on' : ''}`} role="radio" aria-checked={mode === 'mix'}
            onClick={() => { if (mode !== 'mix') { setMode('mix'); setLines(mixLines(general)); } }}>
            <span className="ico"><Icon name="box" size={22} stroke={1.6} /></span>
            <span className="strong">Morning Box Mix</span>
            <Tick on={mode === 'mix'} />
          </button>
          <button type="button" className={`tile${mode === 'choose' ? ' on' : ''}`} role="radio" aria-checked={mode === 'choose'} onClick={() => nav('/business/boxes')}>
            <span className="ico"><Icon name="edit" size={22} stroke={1.6} /></span>
            <span className="strong">Choose Your Boxes</span>
            <Tick on={mode === 'choose'} />
          </button>
        </div>

        <section className="card list" aria-label={mode === 'mix' ? 'Morning Box Mix' : 'Your boxes'}>
          <div className="row" style={{ padding: '14px 0 4px' }}>
            <h2 className="h3">{mode === 'mix' ? 'Morning Box Mix' : 'Your boxes'}</h2>
            {mode === 'choose' && <Link to="/business/boxes" className="link" style={{ padding: '8px 0' }}>Change</Link>}
          </div>
          {lines.length === 0 && <p className="sm" style={{ padding: '10px 0' }}>Everyone is covered by Special Breakfasts.</p>}
          {lines.map((l, i) => {
            const r = recipeById[l.recipeId];
            return (
              <div key={l.recipeId} className="stack gap-10" style={{ padding: '14px 0', borderTop: '1px solid var(--line-soft)' }}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <span className="stack"><span className="strong">{modelName(r)}</span><span className="xs">{describe(r)}</span></span>
                  <span className="strong" style={{ whiteSpace: 'nowrap' }}>× {l.qty}</span>
                </div>
                {mode === 'mix'
                  ? <SizeSeg value={l.size} label={`Size for ${modelName(r)}`} onChange={sz => setLines(ls => ls.map((x, k) => (k === i ? { ...x, size: sz } : x)))} />
                  : <span className="xs">{sizeLabel(l.size)}</span>}
              </div>
            );
          })}
          {specials.length > 0 && (
            <div className="list-row">
              <span className="ci"><Icon name="shield" size={20} stroke={1.6} /></span>
              <span className="stack"><span className="strong">Special Breakfasts × {sq} <InfoTip label="About special breakfasts">Packed and labelled separately for each person.</InfoTip></span>
                <span className="xs">{specials.map(specialText).join(' · ')}</span></span>
            </div>
          )}
        </section>
        <PriceSummary price={price} people={b.people} />
      </main>
      <Footer><button className="btn" disabled={price.boxes !== b.people} onClick={confirm}>Confirm Selection</button></Footer>
    </Screen>
  );
}

/* ---------- Choose Your Boxes ---------- */
export function ChooseBoxes() {
  const { b, upd } = useBiz();
  const nav = useNavigate();
  const general = b.people - specialQty(b);
  const models = useMemo(() => businessModels('regular'), []);
  const [pick, setPick] = useState(() => {
    const init = Object.fromEntries(models.map(m => [m.recipe.id, { size: 'regular', qty: 0 }]));
    if (b.mode === 'choose') (b.lines || []).forEach(l => { if (init[l.recipeId]) init[l.recipeId] = { size: l.size, qty: l.qty }; });
    return init;
  });
  if (general < 0) return <Navigate to="/business/special" replace />;

  const lines = models.map(m => ({ recipeId: m.recipe.id, ...pick[m.recipe.id] })).filter(l => l.qty > 0);
  const chosen = sum(lines);
  const diff = general - chosen;
  const running = sum(lines, l => linePrice(l) * l.qty);
  const setP = (id, patch) => setPick(p => ({ ...p, [id]: { ...p[id], ...patch } }));
  const groups = [['flexible', 'Flexible'], ['health', 'Health-Conscious']];

  return (
    <Screen>
      <TopBar back="/business/selection" close="/"><span className="topbar-title">Business Breakfast · 3 of 5</span></TopBar>
      <Progress step={3} />
      <main className="screen-main" style={{ paddingTop: 28 }}>
        <div className="stack gap-10">
          <span className="eyebrow">Choose your boxes</span>
          <h1 className="q">Pick breakfasts for {general} people</h1>
        </div>
        {groups.map(([style, label]) => (
          <section key={style} className="stack gap-12" aria-label={label}>
            <h2 className="h3">{label}</h2>
            {models.filter(m => m.eatingStyle === style).map(m => {
              const r = m.recipe;
              const p = pick[r.id];
              const comps = r.components.map(id => COMPONENTS[id]).filter(Boolean);
              const veg = comps.every(c => c.diet.includes('vegetarian'));
              const allergens = [...new Set(comps.flatMap(c => c.allergens))];
              return (
                <div key={r.id} className="card stack gap-12" style={p.qty > 0 ? { border: '2px solid var(--gold)', background: 'var(--gold-wash)', padding: 17 } : undefined}>
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    <span className="stack gap-4"><span className="strong" style={{ fontSize: 17 }}>{modelName(r)}</span>
                      <span className="sm">{r.components.map(componentName).join(', ')}</span></span>
                    <span className="money">AED {m.base + SIZE_ADJUSTMENT[p.size]}</span>
                  </div>
                  <div className="tags">
                    {veg && <span className="tag"><Icon name="leaf" size={13} stroke={2} />Vegetarian</span>}
                    {allergens.length > 0 && <span className="tag">Contains {allergens.map(a => allergyLabel(a).split(' /')[0].toLowerCase()).join(', ')}</span>}
                  </div>
                  <SizeSeg value={p.size} label={`Size for ${modelName(r)}`} onChange={sz => setP(r.id, { size: sz })} />
                  <div className="row"><span className="label">Quantity</span>
                    <Qty value={p.qty} max={MAX_PEOPLE} label={modelName(r)} onChange={v => setP(r.id, { qty: v })} /></div>
                </div>
              );
            })}
          </section>
        ))}
      </main>
      <Footer>
        {diff !== 0 && (
          <div className="banner-err" role="status">
            <Icon name="alert" size={18} stroke={2.2} />
            <span>{chosen} of {general} chosen. {diff > 0 ? 'Add' : 'Remove'} {Math.abs(diff)} to match your headcount.</span>
          </div>
        )}
        {diff !== 0 && chosen > 0 && (
          <button type="button" className="btn-secondary" onClick={() => {
            /* Keep the chosen mix, rescaled to exactly the headcount. */
            const scaled = scaleLines(lines, general);
            setPick(p => ({ ...p, ...Object.fromEntries(scaled.map(l => [l.recipeId, { size: l.size, qty: l.qty }])) }));
          }}>Match my headcount ({general})</button>
        )}
        {diff === 0 ? <PriceSummary price={priceDay(lines, activeSpecials(b))} /> : <div className="sr"><span className="sm">{chosen} of {general} chosen</span><span className="money">AED {running}</span></div>}
        <button className="btn" disabled={diff !== 0} onClick={() => { upd(d => { d.mode = 'choose'; d.lines = lines; }); nav('/business/dates'); }}>Confirm</button>
      </Footer>
    </Screen>
  );
}

/* ---------- Step 4 · Dates ---------- */
export function BizDates() {
  const { b, upd } = useBiz();
  const nav = useNavigate();
  const weeks = useMemo(() => planningWeeks(), []);
  const all = weeks.flat().map(d => d.iso);
  const [week, setWeek] = useState(0);
  const config = useConfig();
  const [picked, setPicked] = useState(() => (b.dates || []).filter(d => all.includes(d)));
  const [same, setSame] = useState(b.sameForAll !== false);
  const [dp, setDp] = useState(() => Object.fromEntries(all.map(iso => [iso, b.perDay?.[iso]?.people || b.people])));
  /* Per-date boxes and Special Breakfasts, once the customer edits that date. */
  const [own, setOwn] = useState(() => Object.fromEntries(all.filter(iso => b.perDay?.[iso]?.lines).map(iso => [iso, { lines: b.perDay[iso].lines, specials: b.perDay[iso].specials || activeSpecials(b) }])));
  const [editing, setEditing] = useState(null);
  const sq = specialQty(b);
  const minPeople = Math.max(1, sq);
  if (!b.lines?.length && b.people - sq > 0) return <Navigate to="/business/selection" replace />;

  const toggle = iso => setPicked(p => (p.includes(iso) ? p.filter(x => x !== iso) : [...p, iso].sort()));
  const custom = picked.length > 1 && !same;
  const emptyDay = custom && picked.some(iso => own[iso] && sum(own[iso].lines) + sum(own[iso].specials) < 1);
  const proceed = () => {
    if (emptyDay) return;
    if (picked.some(iso => closedOn(config, iso))) { setPicked(p => p.filter(iso => !closedOn(config, iso))); return; }
    upd(d => {
      d.dates = picked;
      d.sameForAll = !custom;
      picked.forEach(iso => {
        const mine = custom && own[iso];
        d.perDay[iso] = { ...(d.perDay[iso] || {}), people: mine ? sum(mine.lines) + sum(mine.specials) : custom ? dp[iso] : d.people, lines: mine ? mine.lines : null, specials: mine ? mine.specials : null };
      });
    });
    nav('/business/delivery');
  };

  return (
    <Screen>
      <StepBar n={4} back={b.mode === 'choose' ? '/business/boxes' : '/business/selection'} />
      <main className="screen-main" style={{ paddingTop: 28 }}>
        <div className="stack gap-10">
          <span className="eyebrow">{b.source ? 'Reorder' : 'Delivery dates'}</span>
          <h1 className="q">Which mornings should we deliver?</h1>
        </div>
        <div className="seg" style={SEG2} role="tablist" aria-label="Week">
          {weeks.map((w, i) => (
            <button key={i} role="tab" aria-selected={week === i} className={week === i ? 'on' : ''} onClick={() => setWeek(i)}>
              {i === 0 ? 'This week · ' : i === 1 ? 'Next week · ' : ''}{w[0].day}{w[0].mon === w[6].mon ? '' : ` ${w[0].mon}`}–{w[6].day} {w[6].mon}
            </button>
          ))}
        </div>
        <div className="grid-4">
          {weeks[week].map(d => {
            const on = picked.includes(d.iso);
            const shut = closedOn(config, d.iso);
            return (
              <button key={d.iso} type="button" className={`day${on ? ' on' : ''}`} aria-pressed={on} disabled={!!shut}
                aria-label={`${d.long}${shut ? `, closed (${shut})` : on ? ', selected' : ''}`} onClick={() => toggle(d.iso)}>
                {on && <span className="ck"><Icon name="check" size={11} stroke={3.5} /></span>}
                <span className="wd">{d.wd}</span><span className="dn">{d.day}</span><span className="mo">{shut ? 'Closed' : d.mon}</span>
              </button>
            );
          })}
        </div>
        <div className="row sm" style={{ justifyContent: 'flex-start' }}>
          <Icon name="clock" size={18} color="#7A5A14" />
          {weeks[0][0].label} is open until {cutoffLabel(weeks[0][0].iso)}.
        </div>

        {picked.length > 1 && (
          <section className="stack gap-10">
            <h2 className="h3">{picked.length} days selected</h2>
            <div className="stack gap-8" role="radiogroup" aria-label="Order across days">
              {[[true, 'Same Order for All Days', `${b.people} people every day`], [false, 'Customize Each Day', 'Set the headcount for each date']].map(([v, l, d]) => (
                <button key={l} type="button" className={`win${same === v ? ' on' : ''}`} role="radio" aria-checked={same === v} onClick={() => setSame(v)}>
                  <span className="dot" /><span className="strong">{l}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {custom && (
          <section className="card list" aria-label="Headcount per day">
            {picked.map((iso, k) => {
              const mine = own[iso];
              const lines = mine ? mine.lines : dayLines({ ...b, sameForAll: true }, iso, dp[iso]);
              const sp = mine ? mine.specials : activeSpecials(b);
              const people = mine ? sum(lines) + sum(sp) : dp[iso];
              const price = priceDay(lines, sp);
              return (
                <div key={iso} className="stack gap-8" style={{ padding: '14px 0', borderTop: k ? '1px solid var(--line-soft)' : 0 }}>
                  <div className="row">
                    <span className="stack"><span className="strong">{dateInfo(iso).label}</span><span className="xs">{people} people · AED {price.total}</span></span>
                    {mine ? <span className="strong">{people}</span> : <Qty value={people} min={minPeople} max={MAX_PEOPLE} label={`people on ${dateInfo(iso).label}`} onChange={v => setDp(p => ({ ...p, [iso]: v }))} />}
                  </div>
                  <button type="button" className="link-hit" style={{ alignSelf: 'flex-start', fontWeight: 600, fontSize: 14 }} onClick={() => setEditing(editing === iso ? null : iso)}>{editing === iso ? 'Done' : 'Change boxes for this day'}</button>
                  {editing === iso && (
                    <div className="stack gap-6">
                      <DayBoxes lines={lines} specials={sp} onChange={(l, x) => setOwn(o => ({ ...o, [iso]: { lines: l, specials: x } }))} />
                      {mine && <button type="button" className="link-hit" style={{ alignSelf: 'flex-start', fontSize: 14, color: 'var(--text-3)' }} onClick={() => { setOwn(o => { const n = { ...o }; delete n[iso]; return n; }); setEditing(null); }}>Use the main order for this day</button>}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}
        {picked.length > 1 && b.sourceDays && (
          <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => { setSame(false); setOwn(Object.fromEntries(picked.map((iso, k) => [iso, structuredClone(b.sourceDays[k % b.sourceDays.length])]))); }}>
            Copy each day as in order {b.source?.orderId} ({b.sourceDays.length} days)
          </button>
        )}
        {custom && <Note>Change a day’s headcount and its boxes are rescaled — or change the boxes for that day directly. Volume discount is calculated per day.</Note>}
        {picked.length > 0 && !custom && (
          <div className="card stack gap-4" style={{ padding: 16 }}>
            <span className="strong">{picked.length} morning{picked.length > 1 ? 's' : ''} selected</span>
            <span className="sm">{picked.map(p => dateInfo(p).label).join(' · ')}</span>
          </div>
        )}
      </main>
      <Footer>
        <button className="btn" disabled={!picked.length || emptyDay} onClick={proceed}>{!picked.length ? 'Choose at least one date' : emptyDay ? 'Each day needs at least one box' : 'Continue'}</button>
      </Footer>
    </Screen>
  );
}

/* ---------- Step 5 · Delivery ---------- */
export function BizDelivery() {
  const { state, b, upd } = useBiz();
  const nav = useNavigate();
  const [touched, setTouched] = useState(false);
  /* Live window availability: a window is offered only if it can take the whole headcount (MB-DLV-001 §8). */
  const [avail, setAvail] = useState({});
  const key = (b.dates || []).join(',');
  useEffect(() => { if (key) get(`/availability?dates=${key}`).then(setAvail).catch(() => {}); }, [key]);
  if (!b.dates?.length) return <Navigate to="/business/dates" replace />;
  const fullOn = (iso, w) => { const r = avail[iso]?.[w]?.remaining; return typeof r === 'number' && r < dayPeople(b, iso); };
  const dl = b.delivery;
  const same = b.deliverySameForAll !== false || b.dates.length < 2;
  const digits = mobileDigits(dl.mobile || '');
  const errs = {
    company: !dl.company.trim() && 'Enter the company name',
    building: !dl.building.trim() && 'Enter the building or tower',
    office: !dl.office.trim() && 'Enter the office, floor or unit',
    area: !areaFor(dl.area) && 'Choose the delivery area',
    contact: !dl.contact.trim() && 'Enter who will receive the delivery',
    mobile: !/^5\d{8}$/.test(digits) && 'Enter a UAE mobile number, e.g. 50 123 4567',
    window: (!(same ? dl.window : b.dates.every(iso => windowFor(b, iso))) && 'Choose a delivery window')
      || (b.dates.some(iso => fullOn(iso, same ? dl.window : windowFor(b, iso))) && 'That window is full for your headcount — choose another')
  };
  const ok = !Object.values(errs).some(Boolean) && (same || !b.dates.some(iso => ownBad(iso)));
  const field = (key, label, placeholder, extra = {}) => (
    <div className="field">
      <label htmlFor={`bd-${key}`}>{label}</label>
      <input id={`bd-${key}`} className={`input${touched && errs[key] ? ' invalid' : ''}`} placeholder={placeholder} value={dl[key]}
        aria-invalid={touched && !!errs[key]} aria-describedby={touched && errs[key] ? `bd-${key}-e` : undefined}
        onChange={e => upd(d => { d.delivery[key] = e.target.value; })} {...extra} />
      {touched && errs[key] && <Err id={`bd-${key}-e`}>{errs[key]}</Err>}
    </div>
  );
  const Windows = ({ iso }) => {
    const cur = iso ? windowFor(b, iso) : dl.window;
    return (
      <div className="grid-3" role="radiogroup" aria-label={`Delivery window${iso ? ` for ${dateInfo(iso).label}` : ''}`}>
        {DELIVERY_WINDOWS.map(w => {
          const full = iso ? fullOn(iso, w.id) : b.dates.some(d => fullOn(d, w.id));
          return (
            <button key={w.id} type="button" className={`win${cur === w.id ? ' on' : ''}`} role="radio" aria-checked={cur === w.id} disabled={full}
              style={{ flexDirection: 'column', justifyContent: 'center', gap: 2, padding: '10px 6px', minHeight: 64, textAlign: 'center' }}
              onClick={() => upd(d => { if (iso) d.perDay[iso] = { ...(d.perDay[iso] || {}), window: w.id }; else d.delivery.window = w.id; })}>
              <span className="strong row" style={{ fontSize: 14, gap: 4 }}>{cur === w.id && <Icon name="check" size={13} stroke={2.6} />}{w.label.replace(' AM', '')}</span><span className="xs">{full ? 'Full' : 'AM'}</span>
            </button>
          );
        })}
      </div>
    );
  };
  /* FLW §15: a day can have its own location and contact when "Set per day" is chosen. */
  const own = iso => b.perDay?.[iso]?.delivery || null;
  const setOwn = (iso, patch) => upd(d => { d.perDay[iso] = { ...(d.perDay[iso] || {}), delivery: patch === null ? null : { ...(d.perDay[iso]?.delivery || { building: d.delivery.building, office: d.delivery.office, contact: d.delivery.contact, mobile: d.delivery.mobile, notes: d.delivery.notes }), ...patch } }; });
  const ownBad = iso => { const o = own(iso); return o && (!o.building?.trim() || !o.office?.trim() || !o.contact?.trim() || !/^5\d{8}$/.test(mobileDigits(o.mobile || ''))); };

  return (
    <Screen>
      <StepBar n={5} back="/business/dates" />
      <main className="screen-main" style={{ paddingTop: 28, gap: 22 }}>
        <div className="stack gap-10">
          <span className="eyebrow">Delivery</span>
          <h1 className="q">Where should we bring breakfast?</h1>
        </div>
        {b.dates.length > 1 && (
          <div className="seg" style={SEG2} role="radiogroup" aria-label="Delivery across days">
            <button type="button" role="radio" aria-checked={same} className={same ? 'on' : ''} onClick={() => upd(d => { d.deliverySameForAll = true; })}>{same && <Icon name="check" size={14} stroke={2.4} style={{ marginRight: 6 }} />}Same for all days</button>
            <button type="button" role="radio" aria-checked={!same} className={!same ? 'on' : ''} onClick={() => upd(d => { d.deliverySameForAll = false; d.dates.forEach(iso => { d.perDay[iso] = { ...(d.perDay[iso] || {}), window: d.perDay[iso]?.window || d.delivery.window }; }); })}>{!same && <Icon name="check" size={14} stroke={2.4} style={{ marginRight: 6 }} />}Set per day</button>
          </div>
        )}
        <section className="stack gap-12">
          {field('company', 'Company name', 'e.g. Gulf Capital Partners', { autoComplete: 'organization' })}
          {field('building', 'Building / Tower', 'e.g. Gate Village, Building 3')}
          {field('office', 'Office / Floor / Unit', 'e.g. Level 4, Office 402')}
          <AreaField id="bd-area" value={dl.area} invalid={touched} onChange={v => upd(d => { d.delivery.area = v; })} />
        </section>
        <hr className="divider" />
        <section className="stack gap-12">
          <h2 className="h3">Contact on the day</h2>
          {field('contact', 'Contact person', 'Who will receive the delivery', { autoComplete: 'name' })}
          <div className="field">
            <label htmlFor="bd-mobile">Mobile number</label>
            <div className="input-prefix">
              <span className="input pre">+971</span>
              <input id="bd-mobile" className={`input${touched && errs.mobile ? ' invalid' : ''}`} inputMode="tel" autoComplete="tel-national"
                placeholder="50 123 4567" value={dl.mobile} aria-invalid={touched && !!errs.mobile} aria-describedby={touched && errs.mobile ? 'bd-mobile-e' : undefined}
                onChange={e => upd(d => { d.delivery.mobile = e.target.value; })} />
            </div>
            {touched && errs.mobile && <Err id="bd-mobile-e">{errs.mobile}</Err>}
          </div>
        </section>
        {same ? (
          <section className="stack gap-10">
            <div className="row"><h2 className="h3">Delivery window</h2></div>
            <Windows />
          </section>
        ) : b.dates.map(iso => (
          <section key={iso} className="stack gap-10">
            <h2 className="h3">{dateInfo(iso).long}</h2>
            <Windows iso={iso} />
            {own(iso) ? (
              <div className="card stack gap-10" style={{ padding: 16 }}>
                {[['building', 'Building / Tower'], ['office', 'Office / Floor / Unit'], ['contact', 'Contact person'], ['mobile', 'Mobile number'], ['notes', 'Delivery notes (optional)']].map(([k, label]) => (
                  <div key={k} className="field"><label htmlFor={`bd-${iso}-${k}`}>{label}</label>
                    <input id={`bd-${iso}-${k}`} className={`input${touched && k !== 'notes' && ownBad(iso) && !(own(iso)[k] || '').trim() ? ' invalid' : ''}`} inputMode={k === 'mobile' ? 'tel' : undefined} value={own(iso)[k] || ''} onChange={e => setOwn(iso, { [k]: e.target.value })} /></div>
                ))}
                {touched && ownBad(iso) && <Err>Complete this day’s location and contact (UAE mobile, e.g. 50 123 4567)</Err>}
                <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setOwn(iso, null)}>Use the main location and contact</button>
              </div>
            ) : <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setOwn(iso, {})}>Different location or contact this day</button>}
          </section>
        ))}
        {touched && errs.window && <Err>{errs.window}</Err>}
        <div className="field"><label htmlFor="bd-notes">Delivery notes <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
          <input id="bd-notes" className="input" placeholder="e.g. Ask for the office manager at reception" value={dl.notes} onChange={e => upd(d => { d.delivery.notes = e.target.value; })} /></div>
      </main>
      <Footer>
        <button className="btn" onClick={() => { setTouched(true); if (ok) nav(state.businessUser ? '/business/review' : '/business/account'); }}>Continue</button>
      </Footer>
    </Screen>
  );
}

/* ---------- Account (first name + mobile OTP + company + email) ---------- */
export function BizAccount() {
  const { state, set, b } = useBiz();
  const nav = useNavigate();
  const signedIn = !!state.session;
  const [name, setName] = useState(state.user?.firstName || b.delivery.contact.split(' ')[0] || '');
  const [mobile, setMobile] = useState(b.delivery.mobile || '');
  const [company, setCompany] = useState(state.businessUser?.company || b.delivery.company || '');
  const [email, setEmail] = useState(state.businessUser?.email || state.user?.email || '');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [needName, setNeedName] = useState(false);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);
  const refs = useRef([]);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait(w => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  if (signedIn && state.businessUser) return <Navigate to="/business/review" replace />;
  if (!b.dates?.length) return <Navigate to="/business/dates" replace />;

  const digits = mobileDigits(mobile);
  const nameOk = name.trim().length > 0;
  const mobileOk = /^5\d{8}$/.test(digits);
  const companyOk = company.trim().length > 0;
  const mailOk = emailOk(email);
  const typeDigit = (i, v) => {
    const all = v.replace(/\D/g, '');
    if (all.length > 1) { // pasted or auto-filled code
      const ds = all.slice(0, 6).split('');
      setCode(c => c.map((_, k) => ds[k] || ''));
      refs.current[Math.min(ds.length, 5)]?.focus();
      return;
    }
    setCode(c => { const n = c.slice(); n[i] = all; return n; });
    if (all && i < 5) refs.current[i + 1]?.focus();
  };
  const onPaste = e => { const t = pastedCode(e); if (t) { e.preventDefault(); typeDigit(0, t); } };
  const run = async fn => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const saveAccount = async () => {
    const res = await post('/business/account', { company: company.trim(), email: email.trim() });
    set(s => {
      applySession(s, res);
      if (!s.business.delivery.company.trim()) s.business.delivery.company = company.trim();
    });
    nav('/business/review', { replace: true });
  };
  const sendCode = () => {
    setTouched(true);
    if (!mobileOk) return;
    run(async () => {
      const res = await post('/auth/otp', { mobile: digits });
      setDevCode(res.devCode || '');
      setSent(true); setWait(30); setCode(['', '', '', '', '', '']);
      setTimeout(() => refs.current[0]?.focus(), 50);
    });
  };
  const verify = () => {
    setTouched(true);
    if ((needName && !nameOk) || !companyOk || !mailOk || code.join('').length < 6) return;
    setBusy(true); setError('');
    (async () => {
      try {
        const res = await post('/auth/verify', { mobile: digits, code: code.join(''), firstName: nameOk ? name.trim() : undefined });
        setToken(null);
        /* A different customer signing in on this device: drop the previous customer's data (the business draft stays). */
        set(s => { if (s.owner && s.owner !== res.user.mobile) resetPersonal(s); applySession(s, res); });
        await saveAccount();
      } catch (e) {
        if (e.code === 'name_required') { setNeedName(true); setError('New to Morning Box? Enter your first name to create your account.'); }
        else setError(e.message);
        if (e.code === 'otp_wrong') { setCode(['', '', '', '', '', '']); refs.current[0]?.focus(); }
      } finally { setBusy(false); }
    })();
  };
  const continueSignedIn = () => {
    setTouched(true);
    if (!companyOk || !mailOk) return;
    run(saveAccount);
  };

  return (
    <Screen>
      <TopBar back="/business/delivery" close="/"><span className="topbar-title">Almost there</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8, gap: 22 }}>
        <div className="note" style={{ alignItems: 'center' }}>
          <Icon name="cal" size={22} color="#7A5A14" />
          <span style={{ fontSize: 15 }}><b>{b.people} people · {b.dates.length} day{b.dates.length > 1 ? 's' : ''}</b> saved and ready</span>
        </div>
        <div className="stack gap-8">
          <h1 className="h-display" style={{ fontSize: 34 }}>Save your business order</h1>
        </div>
        {signedIn ? (
          <section className="card list" aria-label="Signed in as">
            <div className="sr" style={{ padding: '12px 0' }}><span className="sm">First name</span><span className="strong">{state.user?.firstName}</span></div>
            <div className="sr" style={{ padding: '12px 0', borderTop: '1px solid var(--line-soft)' }}><span className="sm">Mobile</span><span className="strong">{state.user?.mobile}</span></div>
          </section>
        ) : (
          <>
            <div className="field">
              <label htmlFor="ba-mb">Mobile number</label>
              <div className="input-prefix">
                <span className="input pre">+971</span>
                <input id="ba-mb" className={`input${touched && !sent && !mobileOk ? ' invalid' : ''}`} inputMode="tel" autoComplete="tel-national"
                  placeholder="50 123 4567" value={mobile} disabled={sent} onChange={e => setMobile(e.target.value)} />
              </div>
              {touched && !sent && !mobileOk && <Err>Enter a UAE mobile number, e.g. 50 123 4567</Err>}
            </div>
            {sent && (
              <div className="stack gap-10">
                <div className="row">
                  <span className="label">Enter the 6-digit code</span>
                  <button type="button" className="link" disabled={busy} onClick={() => { setSent(false); setDevCode(''); setError(''); setTouched(false); setCode(['', '', '', '', '', '']); }}>Change number</button>
                </div>
                <div className="otp">
                  {code.map((c, i) => (
                    <input key={i} ref={el => (refs.current[i] = el)} inputMode="numeric" maxLength={i === 0 ? 6 : 1} aria-label={`Digit ${i + 1}`}
                      autoComplete={i === 0 ? 'one-time-code' : 'off'} value={c} onChange={e => typeDigit(i, e.target.value)} onPaste={onPaste}
                      onKeyDown={e => { if (e.key === 'Backspace' && !c && i > 0) refs.current[i - 1]?.focus(); }} />
                  ))}
                </div>
                <div className="row">
                  <span className="help" style={{ fontSize: 15 }}>Didn’t get it?</span>
                  {wait > 0
                    ? <span className="strong" style={{ fontSize: 15 }}>Resend in 0:{String(wait).padStart(2, '0')}</span>
                    : <button type="button" className="link" disabled={busy} onClick={sendCode}>Resend code</button>}
                </div>
                {devCode && <span className="demo-note">Development build — your code is <b>{devCode}</b>. In production it arrives by SMS.</span>}
              </div>
            )}
            {sent && needName && (
              <div className="field">
                <label htmlFor="ba-fn">Your first name</label>
                <input id="ba-fn" className={`input${touched && !nameOk ? ' invalid' : ''}`} value={name} autoComplete="given-name" onChange={e => setName(e.target.value)} />
                {touched && !nameOk && <Err>Enter your first name</Err>}
              </div>
            )}
          </>
        )}
        {(signedIn || sent) && (
          <>
            <div className="field">
              <label htmlFor="ba-co">Company name</label>
              <input id="ba-co" className={`input${touched && !companyOk ? ' invalid' : ''}`} value={company} autoComplete="organization" onChange={e => setCompany(e.target.value)} />
              {touched && !companyOk && <Err>Enter the company name</Err>}
            </div>
            <div className="field">
              <label htmlFor="ba-em">Business email</label>
              <input id="ba-em" type="email" className={`input${touched && !mailOk ? ' invalid' : ''}`} value={email} autoComplete="email" placeholder="name@company.com" onChange={e => setEmail(e.target.value)} />
              {touched && !mailOk && <Err>Enter a valid email, e.g. name@company.com</Err>}
            </div>
          </>
        )}
        <ApiErr error={error} />
      </main>
      <Footer>
        {signedIn
          ? <button className="btn" disabled={busy} onClick={continueSignedIn}>{busy ? 'Saving…' : 'Continue'}</button>
          : !sent
            ? <button className="btn" disabled={busy} onClick={sendCode}>{busy ? 'Sending…' : 'Send code'}</button>
            : <button className="btn" disabled={busy || code.join('').length < 6} onClick={verify}>{busy ? 'Verifying…' : 'Verify & Continue'}</button>}
        <Agreement className="xs center" style={{ fontSize: undefined }} />
      </Footer>
    </Screen>
  );
}

/* ---------- Review & pay ---------- */
export function BizReview() {
  const { state, set, b, upd } = useBiz();
  const nav = useNavigate();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [trnTouched, setTrnTouched] = useState(false);
  /* One key per checkout: double taps and retries never create a second order. */
  const [idemKey] = useState(newIdempotencyKey);
  const [serverTotal, setServerTotal] = useState(null);
  if (!state.session || !state.businessUser) return <Navigate to="/business/account" replace />;
  if (!b.dates?.length) return <Navigate to="/business/dates" replace />;

  const user = state.businessUser;
  const dl = b.delivery;
  const days = b.dates.map(iso => {
    const people = dayPeople(b, iso);
    const lines = dayLines(b, iso, people).filter(l => l.qty > 0);
    const specials = daySpecials(b, iso).filter(x => x.qty > 0);
    return { iso, people, lines, specials, window: windowFor(b, iso), price: priceDay(lines, specials), delivery: b.deliverySameForAll === false ? b.perDay?.[iso]?.delivery || null : null };
  });
  const gross = sum(days, d => d.price.gross);
  const discount = sum(days, d => d.price.discount);
  const total = sum(days, d => d.price.total);
  const inv = b.invoice;
  const payTotal = serverTotal ?? total;
  const trnBad = inv.wanted && !trnOk(inv.trn);

  const pay = async () => {
    setTrnTouched(true);
    if (trnBad) return;
    setPaying(true); setError('');
    const snap = { company: dl.company.trim(), building: dl.building.trim(), office: dl.office.trim(),
      contact: dl.contact.trim(), mobile: fmtMobile(mobileDigits(dl.mobile)), notes: dl.notes.trim() };
    try {
      const order = await post('/business/orders', {
        idempotencyKey: idemKey, expectedTotal: payTotal,
        mode: b.mode === 'choose' ? 'choose' : 'mix',
        invoice: { wanted: inv.wanted, billingName: inv.billingName.trim() || snap.company, address: inv.address.trim(), trn: inv.trn.trim(), po: (inv.po || '').trim() },
        days: days.map(d => ({
          date: d.iso, window: d.window, people: d.people,
          lines: d.lines.filter(l => l.qty > 0).map(l => ({ recipeId: l.recipeId, size: l.size, qty: l.qty })),
          specials: d.specials.map(x => ({ dietary: x.dietary.slice(), allergies: x.allergies.slice(), qty: x.qty, size: x.size || 'regular' })),
          delivery: d.delivery ? { ...snap, building: d.delivery.building.trim(), office: d.delivery.office.trim(), contact: d.delivery.contact.trim(), mobile: fmtMobile(mobileDigits(d.delivery.mobile)), notes: (d.delivery.notes || '').trim() } : snap
        }))
      });
      set(s => {
        putOrder(s, order);
        s.business = { ...emptyBusiness(), delivery: { ...emptyBusiness().delivery, company: snap.company, building: snap.building, office: snap.office, contact: snap.contact, mobile: s.business.delivery.mobile } };
      });
      nav(`/business/orders/${order.id}/confirmed`, { replace: true });
    } catch (e) {
      if (e.code === 'price_changed' && typeof e.details?.total === 'number') setServerTotal(e.details.total);
      setError(e.message);
      setPaying(false);
    }
  };

  return (
    <Screen>
      <TopBar back="/business/delivery" close="/"><span className="topbar-title">Review &amp; pay</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8 }}>
        <h1 className="h-display" style={{ fontSize: 34 }}>One last look</h1>
        {days.map(d => (
          <section key={d.iso} className="card stack gap-8" aria-label={dateInfo(d.iso).label}>
            <div className="sr"><strong>{dateInfo(d.iso).label}</strong><Link to={b.sameForAll === false && b.dates.length > 1 ? '/business/dates' : '/business/selection'} className="link-hit" style={{ fontWeight: 600, fontSize: 14 }}>Edit</Link></div>
            <span className="sm" style={{ color: 'var(--espresso)' }}>{d.people} people · {windowLabel(d.window)}</span>
            <span className="xs">{linesText(d.lines) || 'No general breakfasts'}</span>
            {d.specials.length > 0 && <span className="xs"><Icon name="shield" size={12} stroke={2} style={{ verticalAlign: '-2px', marginRight: 4 }} />Special × {sum(d.specials)}: {d.specials.map(s => `${specialText(s)} × ${s.qty}`).join(' · ')}</span>}
            <span className="xs">{(d.delivery || dl).building}, {(d.delivery || dl).office}, DIFC · {(d.delivery || dl).contact}, {fmtMobile(mobileDigits((d.delivery || dl).mobile))}</span>
            <div className="sr">
              <span className="xs" style={d.price.discount ? { color: 'var(--ok)' } : undefined}>{d.price.discount ? `Includes ${Math.round(d.price.discountPct * 100)}% volume discount` : ''}</span>
              <span className="money">AED {d.price.total}</span>
            </div>
          </section>
        ))}
        <section className="panel">
          <div className="sr"><span>Breakfast total</span><span className="money">AED {gross}</span></div>
          <div className="sr"><span>Delivery</span><span>Included</span></div>
          {discount > 0 && <div className="sr" style={{ color: 'var(--ok)' }}><span>Volume discount <InfoTip label="About the volume discount">Calculated separately for each day, based on that day’s headcount.</InfoTip></span><span className="money">− AED {discount}</span></div>}
          <hr className="divider" />
          <div className="sr total"><span>Final total</span><span>AED {payTotal}</span></div>
        </section>
        <section className="stack gap-12">
          <div className="row">
            <span className="stack"><span className="strong">Tax invoice</span><span className="xs">Sent to {user.email}</span></span>
            <Switch checked={inv.wanted} label="Tax invoice" onChange={v => upd(d => { d.invoice.wanted = v; })} />
          </div>
          {inv.wanted && (
            <>
              <div className="field"><label htmlFor="bi-n">Billing name</label>
                <input id="bi-n" className="input" placeholder={dl.company} value={inv.billingName} onChange={e => upd(d => { d.invoice.billingName = e.target.value; })} /></div>
              <div className="field"><label htmlFor="bi-a">Billing address</label>
                <input id="bi-a" className="input" placeholder={`${dl.building}, DIFC, Dubai`} value={inv.address} onChange={e => upd(d => { d.invoice.address = e.target.value; })} /></div>
              <div className="field"><label htmlFor="bi-t">TRN <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
                <input id="bi-t" className={`input${trnTouched && trnBad ? ' invalid' : ''}`} inputMode="numeric" maxLength={20} value={inv.trn}
                  aria-invalid={trnTouched && trnBad} onBlur={() => setTrnTouched(true)} onChange={e => upd(d => { d.invoice.trn = e.target.value; })} />
                {trnTouched && trnBad && <Err>A UAE TRN has 15 digits — check it or leave it empty</Err>}</div>
              <div className="field"><label htmlFor="bi-p">PO number <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
                <input id="bi-p" className="input" maxLength={40} value={inv.po || ''} onChange={e => upd(d => { d.invoice.po = e.target.value; })} /></div>
            </>
          )}
        </section>
        <p className="xs" style={{ margin: 0 }}>Free changes until 9:00 PM the night before.</p>
        {SHOW_DEMO && <span className="demo-note">Development build: no payment is taken.</span>}
      </main>
      <Footer>
        <ApiErr error={error} />
        <button className="btn" onClick={pay} disabled={paying}><Icon name="lock" size={16} stroke={2} />{paying ? 'Processing…' : `Pay AED ${payTotal}`}</button>
      </Footer>
    </Screen>
  );
}

/* ---------- Confirmation ---------- */
export function BizConfirmed() {
  const { id } = useParams();
  const { state } = useStore();
  const [planSaved, setPlanSaved] = useState('');
  const order = (state.businessOrders || []).find(o => o.id === id);
  if (!order) return <Navigate to="/business" replace />;
  const first = order.days[0];
  /* Save this team setup as a named plan for next time (never a subscription). */
  const savePlan = () => {
    const d = order.days.find(x => !x.cancelled) || first;
    post('/business/plans', {
      name: `${order.company} · ${d.people} people`.slice(0, 60),
      plan: { people: d.people, mode: order.mode, lines: d.lines, specials: d.specials, delivery: { ...d.delivery, window: d.window } }
    }).then(() => setPlanSaved('Saved — find it under Use a Saved Plan next time.')).catch(e => setPlanSaved(e.message));
  };
  const heads = [...new Set(order.days.map(d => d.people))];
  const wins = [...new Set(order.days.map(d => windowLabel(d.window)))];
  const rows = [
    ['Order', order.id],
    ['Dates', order.days.map(d => dateInfo(d.date).label).join(' · ')],
    ['Headcount', heads.length > 1 ? `${Math.min(...heads)}–${Math.max(...heads)} people` : `${heads[0]} people`],
    ['Location', `${first.delivery.building}, ${first.delivery.office}, DIFC`],
    ['Window', wins.join(' · ')],
    ['Paid', `AED ${order.paid ?? order.total}`]
  ];
  return (
    <Screen>
      <main className="screen-main" style={{ paddingTop: 56, gap: 22 }}>
        <div className="stack center" style={{ alignItems: 'center', gap: 14 }}>
          <span style={{ width: 80, height: 80, borderRadius: 999, background: 'var(--gold)', color: 'var(--on-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={38} stroke={2.4} /></span>
          <h1 className="h-display">Breakfast is arranged for the team</h1>
          <p className="help">{order.invoice?.wanted === false ? `Confirmation sent to ${order.email}` : `Confirmation and tax invoice sent to ${order.email}`}</p>
        </div>
        <section className="card list">
          {rows.map(([k, v], i) => (
            <div key={k} className="sr" style={{ padding: '12px 0', borderTop: i ? '1px solid var(--line-soft)' : 0 }}>
              <span className="sm">{k}</span><span className="strong" style={{ textAlign: 'right' }}>{v}</span>
            </div>
          ))}
        </section>
        <Note icon="shield">{first.delivery.contact} will receive the delivery.</Note>
      </main>
      <Footer>
        <Link to={`/business/orders/${order.id}`} className="btn">Manage Order</Link>
        <button type="button" className="btn-secondary" onClick={() => getInvoice(order, !!state.session)}><Icon name="download" size={18} />Download Invoice</button>
        {state.session && (planSaved
          ? <span className="hint" role="status" style={{ justifyContent: 'center', fontSize: 15 }}><Icon name="check" size={18} stroke={1.8} />{planSaved}</span>
          : <button type="button" className="btn-text" style={{ alignSelf: 'center' }} onClick={savePlan}>Save as a plan</button>)}
      </Footer>
    </Screen>
  );
}

/* ---------- Manage order ---------- */
export function BizManage() {
  const { id } = useParams();
  const { state, set } = useStore();
  useSyncOrders();
  const order = (state.businessOrders || []).find(o => o.id === id);
  const [tab, setTab] = useState(() => Math.max(0, order ? order.days.findIndex(d => !d.cancelled) : 0));
  if (!order) return <Navigate to="/business" replace />;
  const day = order.days[Math.min(tab, order.days.length - 1)];

  return (
    <Screen>
      <TopBar back="/business" close="/"><span className="topbar-title">Order {order.id}</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8 }}>
        <div className="stack gap-8">
          <span className="eyebrow">{order.company}</span>
          <h1 className="h-display" style={{ fontSize: 34 }}>Manage order</h1>
        </div>
        {order.days.length > 1 && (
          <div className="seg" style={{ gridTemplateColumns: `repeat(${Math.min(order.days.length, 4)}, minmax(0, 1fr))`, borderRadius: order.days.length > 4 ? 18 : 999 }} role="tablist" aria-label="Delivery date">
            {order.days.map((d, i) => (
              <button key={d.date} role="tab" aria-selected={tab === i} className={tab === i ? 'on' : ''} onClick={() => setTab(i)}
                style={d.cancelled ? { textDecoration: 'line-through' } : undefined}>{dateInfo(d.date).short}</button>
            ))}
          </div>
        )}
        <DayEditor key={day.date} order={order} day={day} set={set} signedIn={!!state.session} />
        {state.session && order.days.length > 1 && <CancelOrder order={order} set={set} />}
      </main>
      <Footer>
        <Link to="/business" className="btn-text" style={{ alignSelf: 'center' }}>Back to Business Breakfast</Link>
      </Footer>
    </Screen>
  );
}

/** Cancel Order (MB-B2B-001 §10): every day still before its cutoff is cancelled and refunded in full;
    days past cutoff or already being prepared stay as they are. The confirm step lists both. */
function CancelOrder({ order, set }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const live = order.days.filter(d => !d.cancelled);
  const cancellable = live.filter(d => d.editable ?? (isBeforeCutoff(d.date) && d.stage <= 0));
  const kept = live.filter(d => !cancellable.includes(d));
  const refund = sum(cancellable, d => d.total);
  const run = async () => {
    setBusy(true); setError('');
    try {
      const res = await post(`/business/orders/${order.id}/cancel`);
      set(s => putOrder(s, res.order));
      setResult(res); setConfirm(false);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (result) {
    return (
      <div className="banner-ok" role="status"><Icon name="check" size={18} stroke={2.4} style={{ flex: 'none' }} />
        <span>{result.cancelled.length ? `${result.cancelled.length} day${result.cancelled.length === 1 ? '' : 's'} cancelled · AED ${result.refund} will be refunded.` : 'Nothing could be cancelled.'}
          {result.notCancelled.length > 0 && ` ${result.notCancelled.map(x => dateInfo(x.date).label).join(', ')} could not be cancelled.`}</span>
      </div>
    );
  }
  if (!cancellable.length) return null;
  if (!confirm) return <button type="button" className="btn-danger" disabled={busy} onClick={() => setConfirm(true)}>Cancel whole order</button>;
  return (
    <div className="card stack gap-12" role="alertdialog" aria-labelledby={`co-${order.id}`}>
      <strong id={`co-${order.id}`} style={{ fontSize: 18 }}>Cancel order {order.id}?</strong>
      <span className="help" style={{ fontSize: 15.5 }}>These days will be cancelled and refunded in full to your original payment method:</span>
      <div className="stack gap-6">
        {cancellable.map(d => <div key={d.date} className="sr"><span>{dateInfo(d.date).long}</span><Money value={d.total} /></div>)}
        <hr className="divider" />
        <div className="sr total"><span>Refund</span><span>AED {refund}</span></div>
      </div>
      {kept.length > 0 && <span className="help" style={{ fontSize: 15.5 }}>{kept.map(d => dateInfo(d.date).label).join(', ')} {kept.length === 1 ? 'is' : 'are'} past the change cutoff or already being prepared, so {kept.length === 1 ? 'it stays' : 'they stay'} as ordered.</span>}
      <ApiErr error={error} />
      <div className="grid-2"><button type="button" className="btn-secondary" onClick={() => setConfirm(false)}>Keep order</button>
        <button type="button" className="btn-danger" disabled={busy} onClick={run}>{busy ? 'Cancelling…' : 'Yes, cancel'}</button></div>
    </div>
  );
}

/** Report a problem (MB-OPS-001 §10): Morning Box investigates and decides the remedy. */
const BIZ_ISSUES = ['Not delivered', 'Arrived late', 'Wrong or missing items', 'Allergy concern', 'Quality issue', 'Packaging issue', 'Something else'];
function ReportIssue({ order, day, set }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState({ busy: false, error: '', sent: false });
  const send = async () => {
    setState({ busy: true, error: '', sent: false });
    try { const res = await post(`/business/orders/${order.id}/days/${day.date}/issue`, { reason, note }); set(s => putOrder(s, res)); setState({ busy: false, error: '', sent: true }); setOpen(false); }
    catch (e) { setState({ busy: false, error: e.message, sent: false }); }
  };
  if (state.sent) return <div className="banner-ok" role="status"><Icon name="check" size={18} stroke={2.4} />Thanks — our team has your report and will contact you.</div>;
  if (!open) return <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>Report a problem</button>;
  return (
    <section className="card stack gap-10" aria-label="Report a problem">
      <span className="strong">What went wrong?</span>
      <div className="chips" role="radiogroup" aria-label="Problem">{BIZ_ISSUES.map(r => <Chip key={r} on={reason === r} onClick={() => setReason(r)}>{r}</Chip>)}</div>
      {reason === 'Allergy concern' && <span className="help">If anyone is having a reaction, call 998 first.</span>}
      <input className="input" maxLength={500} placeholder="Details (optional)" aria-label="Details" value={note} onChange={e => setNote(e.target.value)} />
      <ApiErr error={state.error} />
      <button type="button" className="btn" disabled={!reason || state.busy} onClick={send}>{state.busy ? 'Sending…' : 'Send report'}</button>
    </section>
  );
}

/** Delivery tracking for one business day (MB-DLV-001 §5) and who prepared it (MB-FLW-001 §17). */
const TRACK = ['Confirmed', 'Being prepared', 'Out for delivery', 'Delivered'];
function Tracking({ day }) {
  const st = Math.max(0, day.stage);
  const time = day.deliveredAt ? new Date(`${day.deliveredAt.replace(' ', 'T')}Z`).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dubai' }) : '';
  return (
    <section className="card stack gap-10" aria-label="Delivery status">
      <div className="row" style={{ gap: 6 }}>
        {TRACK.map((t, i) => <span key={t} className={`status ${i <= st ? (i === 3 ? 'ok' : 'prep') : 'done'}`} style={{ opacity: i <= st ? 1 : 0.55, fontSize: 12 }}>{t}</span>)}
      </div>
      {st === 3 && <span className="strong">Delivered to {day.deliveryPoint || 'Reception'}{time ? ` · ${time}` : ''}</span>}
      {day.lateNote && st < 3 && !day.problem && <span className="help">Running late · now around {day.lateNote}</span>}
      {day.problem && <span className="help" style={{ color: 'var(--err)' }}>{day.problem === 'Not Fulfilled' ? 'We couldn’t prepare this order.' : 'We couldn’t complete the handover — our team will contact you.'}</span>}
      {day.refund > 0 && <span className="help">AED {day.refund} refunded to your original payment method.</span>}
      {day.bakeries?.length > 0 && <span className="help">Prepared by {day.bakeries.join(' & ')}</span>}
    </section>
  );
}

function DayEditor({ order, day, set, signedIn }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [people, setPeople] = useState(day.people);
  const [lines, setLines] = useState(day.lines.map(l => ({ ...l })));
  const [specials, setSpecials] = useState(day.specials.map(x => ({ ...x })));
  const [win, setWin] = useState(day.window);
  const [contact, setContact] = useState({ building: day.delivery.building || '', office: day.delivery.office || '', contact: day.delivery.contact || '', mobile: day.delivery.mobile || '', notes: day.delivery.notes || '' });
  const [avail, setAvail] = useState({});
  const [saved, setSaved] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const info = dateInfo(day.date);
  const open = !day.cancelled && (day.editable ?? (isBeforeCutoff(day.date) && day.stage <= 0));
  useEffect(() => { if (open) get(`/availability?dates=${day.date}`).then(a => setAvail(a[day.date] || {})).catch(() => {}); }, [open, day.date]);
  const sq = sum(specials);
  const boxes = sum(lines) + sq;
  const diff = people - boxes;
  const contactChanged = ['building', 'office', 'contact', 'mobile', 'notes'].some(k => (contact[k] || '') !== (day.delivery[k] || ''));
  const changed = people !== day.people || win !== day.window || contactChanged
    || JSON.stringify(lines.map(l => [l.recipeId, l.size, l.qty])) !== JSON.stringify(day.lines.map(l => [l.recipeId, l.size, l.qty]))
    || JSON.stringify(specials.map(x => [x.dietary, x.allergies, x.size || 'regular', x.qty])) !== JSON.stringify(day.specials.map(x => [x.dietary, x.allergies, x.size || 'regular', x.qty]));
  const price = priceDay(lines, specials);
  const contactOk = contact.building.trim() && contact.office.trim() && contact.contact.trim() && /^5\d{8}$/.test(mobileDigits(contact.mobile));
  /* A window is offered only if it can take this day's headcount (its own boxes don't count against it). */
  const winFull = w => { const r = avail[w]?.remaining; return typeof r === 'number' && r + (w === day.window ? day.people : 0) < people; };

  const base = `/business/orders/${order.id}/days/${day.date}`;
  const run = async fn => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const kept = lines.filter(l => l.qty > 0);
    const res = await patch(base, {
      people, lines: kept, window: win,
      specials: specials.map(x => ({ dietary: x.dietary, allergies: x.allergies, qty: x.qty, size: x.size || 'regular' })),
      ...(contactChanged ? { delivery: { building: contact.building.trim(), office: contact.office.trim(), contact: contact.contact.trim(), mobile: contact.mobile.trim(), notes: contact.notes.trim() } } : {})
    });
    set(s => putOrder(s, res));
    setLines(kept);
    setSaved(true);
  });
  const cancel = () => run(async () => {
    const res = await post(`${base}/cancel`);
    set(s => putOrder(s, res));
    setConfirmCancel(false);
  });

  if (!signedIn) {
    return (
      <div className="card stack gap-12">
        <span className="strong">Sign in to manage this order</span>
        <Link to={`/sign-in?next=/business/orders/${order.id}`} className="btn-secondary">Sign in</Link>
      </div>
    );
  }

  return (
    <>
      <div className="stack gap-8">
        <div className="date-title">{info.long}</div>
        <span className="sm">{windowLabel(day.window)} · {day.delivery.building}, {day.delivery.office}</span>
        {day.cancelled
          ? <span className="status off" style={{ alignSelf: 'flex-start' }}><Icon name="close" size={12} stroke={2.4} />Cancelled · refunded</span>
          : open
            ? <span className="status ok" style={{ alignSelf: 'flex-start' }}><Icon name="clock" size={13} stroke={2} />Editable until {cutoffLabel(day.date)}</span>
            : <span className="status done" style={{ alignSelf: 'flex-start' }}><Icon name="lock" size={13} stroke={2} />Changes closed</span>}
      </div>
      {!day.cancelled && <Tracking day={day} />}
      {!day.cancelled && signedIn && (day.stage >= 2 || day.date <= todayIso()) && <ReportIssue order={order} day={day} set={set} />}

      {!day.cancelled && (
        <>
          <section className="card stack gap-12">
            <div className="row"><span className="strong">Number of people</span>
              {open ? <Qty value={people} min={Math.max(1, sq)} max={MAX_PEOPLE} label="people" onChange={v => { setPeople(v); setSaved(false); }} />
                : <span className="strong">{people}</span>}
            </div>
          </section>
          <section className="card list" aria-label="Boxes">
            <div className="row" style={{ padding: '14px 0 4px' }}><h2 className="h3">Boxes</h2><span className="xs">{boxes} total</span></div>
            {open ? <DayBoxes lines={lines} specials={specials} onChange={(l, x) => { setLines(l); setSpecials(x); setSaved(false); }} />
              : <>
                {lines.map(l => <div key={`${l.recipeId}-${l.size}`} className="list-row"><span className="stack"><span className="strong">{modelName(recipeById[l.recipeId])}</span><span className="xs">{sizeLabel(l.size)}</span></span><span className="strong" style={{ marginLeft: 'auto' }}>× {l.qty}</span></div>)}
                {specials.map((x, i) => <div key={`sp${i}`} className="list-row"><span className="ci"><Icon name="shield" size={20} stroke={1.6} /></span><span className="stack"><span className="strong">Special Breakfast</span><span className="xs">{specialText(x)}</span></span><span className="strong" style={{ marginLeft: 'auto' }}>× {x.qty}</span></div>)}
              </>}
          </section>

          {open && (
            <section className="stack gap-10">
              <h2 className="h3">Delivery window</h2>
              <div className="grid-3" role="radiogroup" aria-label="Delivery window">
                {DELIVERY_WINDOWS.map(w => {
                  const full = winFull(w.id);
                  return (
                    <button key={w.id} type="button" className={`win${win === w.id ? ' on' : ''}`} role="radio" aria-checked={win === w.id} disabled={full && win !== w.id}
                      style={{ flexDirection: 'column', justifyContent: 'center', gap: 2, padding: '10px 6px', minHeight: 64, textAlign: 'center' }}
                      onClick={() => { setWin(w.id); setSaved(false); }}>
                      <span className="strong" style={{ fontSize: 14 }}>{w.label.replace(' AM', '')}</span><span className="xs">{full ? 'Full' : 'AM'}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {open && (
            <section className="stack gap-12">
              <h2 className="h3">Location &amp; contact on the day</h2>
              {[['building', 'Building / Tower', 'Enter the building or tower'], ['office', 'Office / Floor / Unit', 'Enter the office, floor or unit'], ['contact', 'Contact person', 'Enter who will receive the delivery']].map(([k, label, msg]) => (
                <div key={k} className="field"><label htmlFor={`d${k}-${day.date}`}>{label}</label>
                  <input id={`d${k}-${day.date}`} className={`input${!contact[k].trim() ? ' invalid' : ''}`} aria-invalid={!contact[k].trim()} value={contact[k]} onChange={e => { setContact(c => ({ ...c, [k]: e.target.value })); setSaved(false); }} />
                  {!contact[k].trim() && <Err>{msg}</Err>}</div>
              ))}
              <div className="field"><label htmlFor={`dm-${day.date}`}>Mobile number</label>
                <input id={`dm-${day.date}`} className={`input${!/^5\d{8}$/.test(mobileDigits(contact.mobile)) ? ' invalid' : ''}`} inputMode="tel" value={contact.mobile} onChange={e => { setContact(c => ({ ...c, mobile: e.target.value })); setSaved(false); }} />
                {!/^5\d{8}$/.test(mobileDigits(contact.mobile)) && <Err>Enter a UAE mobile number, e.g. 50 123 4567</Err>}</div>
              <div className="field"><label htmlFor={`dn-${day.date}`}>Delivery notes <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
                <input id={`dn-${day.date}`} className="input" maxLength={200} value={contact.notes} onChange={e => { setContact(c => ({ ...c, notes: e.target.value })); setSaved(false); }} /></div>
            </section>
          )}

          {open && diff !== 0 && (
            <div className="banner-warn" role="status">
              <Icon name="alert" size={18} stroke={2.2} color="var(--warn)" style={{ flex: 'none' }} />
              <span>{diff > 0 ? `${diff} ${diff === 1 ? 'person' : 'people'} without a breakfast — add ${diff} box${diff === 1 ? '' : 'es'}` : `${-diff} extra box${diff === -1 ? '' : 'es'} — remove ${-diff}`}</span>
            </div>
          )}
          {open && diff !== 0 && sum(lines) > 0 && people - sq > 0 && (
            <button type="button" className="btn-secondary" onClick={() => { setLines(scaleLines(lines, people - sq)); setSaved(false); }}>Match my headcount ({people})</button>
          )}
          {diff === 0 && <PriceSummary price={price} />}
          {/* B2B §10: show the effect of the change before reconfirming. */}
          {open && changed && diff === 0 && price.total !== day.total && (
            <div className="note" role="status"><Icon name="card" size={20} stroke={1.6} style={{ flex: 'none' }} /><span>{price.total > day.total ? `AED ${price.total - day.total} will be charged` : `AED ${day.total - price.total} will be refunded`} to your original payment method when you confirm.</span></div>
          )}
          {saved && !changed && <div className="banner-ok" role="status"><Icon name="check" size={18} stroke={2.4} />Changes saved for {info.label}</div>}
          {open && <button className="btn" disabled={busy || diff !== 0 || !changed || !contactOk || winFull(win)} onClick={save}>{busy ? 'Saving…' : 'Confirm Changes'}</button>}
        </>
      )}

      <ApiErr error={error} />
      <button type="button" className="btn-secondary" onClick={() => getInvoice(order, signedIn)}><Icon name="download" size={18} />Download invoice</button>
      {open && !confirmCancel && <button type="button" className="btn-danger" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel {info.label} · full refund</button>}
      {open && confirmCancel && (
        <div className="card stack gap-12" role="alertdialog" aria-labelledby={`bc-${day.date}`}>
          <strong id={`bc-${day.date}`} style={{ fontSize: 18 }}>Cancel breakfast on {info.long}?</strong>
          <span className="help" style={{ fontSize: 15.5 }}>You’ll receive a full refund of AED {day.total} for this day. Other days are not affected.</span>
          <div className="grid-2"><button type="button" className="btn-secondary" onClick={() => setConfirmCancel(false)}>Keep it</button>
            <button type="button" className="btn-danger" disabled={busy} onClick={cancel}>Yes, cancel</button></div>
        </div>
      )}
    </>
  );
}
