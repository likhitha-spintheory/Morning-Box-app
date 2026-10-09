import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Screen, TopBar, Option, Footer, Icon, MorningPills, Qty, IconButton, Ring, RuledDate, Go
} from '../../components/ui.jsx';
import { useStore } from '../../state/store.jsx';
import {
  CONTEXTS, dateInfo, planningWeeks, recommendDay, hydrate, serialize, dayPrice, sizePrice, todayIso,
  canChooseSize, boxName, componentName, componentIcon, componentPortion, contextLabel, eatingLabel, prefLabel,
  dietLabel, allergyLabel, sizeLabel, addonPrice
} from '../../domain/app.js';
import { swapOptions, applySwap, canSwap, addonGroups } from '../../domain/engine.js';
import { ADDON_PRICES, cutoffFor } from '../../domain/standards.js';

const CONTEXT_ICON = { active: 'bolt', regular: 'brief', busy: 'clock', relaxed: 'coffee' };
const CONTEXT_TEXT = {
  active: 'A more active or physically demanding start.',
  regular: 'A typical working morning.',
  busy: 'Time is tight — convenience matters most.',
  relaxed: 'Less rushed, more room to enjoy.'
};

/* ---------- helpers ---------- */
function usePlan() {
  const { state, set } = useStore();
  const plan = state.plan;
  const infos = plan.dates.map(dateInfo);
  return { state, set, plan, infos };
}

function afterSave(plan, iso) {
  const i = plan.dates.indexOf(iso);
  const next = plan.dates.slice(i + 1).find(d => !plan.days[d]?.saved) || plan.dates.find(d => !plan.days[d]?.saved);
  if (!next) return '/plan/summary';
  const prev = plan.dates[plan.dates.indexOf(next) - 1];
  return prev && plan.days[prev]?.saved ? `/plan/day/${next}/next` : `/plan/day/${next}/context`;
}

const dayComma = iso => { const d = dateInfo(iso); return `${d.wd}, ${d.day} ${d.mon}`; };
const extrasLine = addons => addons.map(a => `${a.qty} ${componentName(a.item)}${a.unit ? ` (${a.unit} loaf)` : ''}${a.qty > 1 && !a.unit ? 's' : ''}`).join(', ');
/** Copy a past morning onto a new date, re-checked against the current Morning Profile
    (PER §3.2: copies stay editable; safety rules always re-apply). */
function copyDay(cfg, profile) {
  const options = recommendDay(profile, cfg.context);
  if (options.none) return { context: cfg.context, which: 'primary', options, cfg: null, saved: false, copied: true, changed: true };
  const still = [options.primary, options.alternative].find(o => o && o.recipeId === cfg.recipeId);
  if (still) {
    const c = structuredClone(cfg);
    const sameParts = c.components.length === still.components.length;
    return { context: cfg.context, which: still.which, options, cfg: sameParts ? c : { ...still, size: c.size, addons: c.addons }, saved: true, copied: true };
  }
  return { context: cfg.context, which: 'primary', options, cfg: { ...options.primary, size: cfg.size, addons: cfg.addons }, saved: false, copied: true, changed: true };
}

const safeTags = p => [...p.dietary.map(dietLabel), ...p.allergies.map(a => `${allergyLabel(a).split(' /')[0]}-free`)];

/* ---------- Start: skip onboarding for returning users ---------- */
export function Start() {
  const { state } = useStore();
  return <Navigate to={state.profileDone ? '/plan/dates' : '/profile/eating'} replace />;
}

/* ---------- Choose dates (style-1 P07) ---------- */
export function ChooseDates() {
  const { state, set, plan } = usePlan();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const reuse = params.get('reuse');       // orderId — Use This Plan Again
  const reorder = params.get('reorder');   // orderId:date — Reorder a Previous Morning
  const weeks = useMemo(() => planningWeeks(), []);
  const [week, setWeek] = useState(0);
  const [picked, setPicked] = useState(() => plan.dates.filter(d => weeks.flat().some(w => w.iso === d)));

  const toggle = iso => setPicked(p => p.includes(iso) ? p.filter(x => x !== iso) : [...p, iso].sort());
  const sourceOrder = reuse ? state.orders.find(o => o.id === reuse) : null;
  const source = sourceOrder ? { ...sourceOrder, days: sourceOrder.days.filter(d => !d.cancelled) } : null;
  const [roId, roDate] = (reorder || '').split(':');
  const roDay = reorder ? state.orders.find(o => o.id === roId)?.days.find(d => d.date === roDate) : null;

  const proceed = () => {
    set(s => {
      const days = {};
      picked.forEach((iso, i) => {
        const copyFrom = source?.days.length ? source.days[i % source.days.length] : roDay;
        if (copyFrom) days[iso] = copyDay(copyFrom.cfg, s.profile);
        else if (s.plan.days[iso]) days[iso] = s.plan.days[iso];
      });
      s.plan = { dates: picked, days };
    });
    nav(source || roDay ? '/plan/summary' : `/plan/day/${picked.find(d => !plan.days[d]?.saved) || picked[0]}/context`);
  };

  if (!state.profileDone) return <Navigate to="/profile/eating" replace />;
  const first = weeks[0][0];
  const today = dateInfo(todayIso());
  const tomorrowIso = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return dateInfo(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`).iso; })();
  const tiles = week === 0 ? [{ ...today, disabled: true }, ...weeks[0]] : weeks[week];
  const weekLabel = week === 0 ? 'This week' : week === 1 ? 'Next week' : `${weeks[week][0].day}–${weeks[week][6].day} ${weeks[week][6].mon}`;
  const monthName = dateInfo(tiles[1]?.iso || tiles[0].iso).date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const hoursLeft = Math.max(0, (cutoffFor(first.iso) - new Date()) / 3.6e6);
  const isTomorrow = first.iso === tomorrowIso;

  return (
    <Screen>
      <TopBar back={-1} close={null}><span className="topbar-title">{source ? 'Use this plan again' : roDay ? 'Reorder a morning' : 'Plan your mornings'}</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 12, gap: 22 }}>
        <div className="stack gap-10">
          <span className="eyebrow">{source || roDay ? 'Choose new dates' : 'Step 1 · Choose your mornings'}</span>
          <h1 className="h-display">{source ? 'Which dates should we copy your plan to?' : roDay ? 'Which mornings would you like it again?' : 'Which mornings should we plan?'}</h1>
          <p className="help" style={{ fontSize: 17 }}>{source || roDay ? 'Each copied morning stays editable before you pay. Nothing is ordered automatically.' : 'Pick one or several. We’ll build each morning one at a time.'}</p>
        </div>

        <div className="row">
          <span className="strong" style={{ fontSize: 18, whiteSpace: 'nowrap' }}>{monthName}</span>
          <span className="row" style={{ gap: 4 }} role="group" aria-label="Week">
            <button type="button" className="icon-btn" style={{ border: 0, background: 'none' }} aria-label="Previous week" disabled={week === 0} onClick={() => setWeek(w => w - 1)}><Icon name="back" size={18} stroke={1.8} /></button>
            <span style={{ fontSize: 15.5, whiteSpace: 'nowrap', minWidth: 96, textAlign: 'center' }} aria-live="polite">{weekLabel}</span>
            <button type="button" className="icon-btn" style={{ border: 0, background: 'none' }} aria-label="Next week" disabled={week === weeks.length - 1} onClick={() => setWeek(w => w + 1)}><Icon name="chevron" size={18} stroke={1.8} /></button>
          </span>
        </div>

        <div className="grid-4">
          {tiles.map(d => {
            const on = picked.includes(d.iso);
            return (
              <button key={d.iso} type="button" className={`day${on ? ' on' : ''}`} aria-pressed={on} disabled={d.disabled}
                aria-label={`${d.long}${d.disabled ? ', closed' : on ? ', selected' : ''}`} onClick={() => toggle(d.iso)}>
                {on && <span className="ck"><Icon name="check" size={13} stroke={2.6} /></span>}
                <span className="wd">{d.wd}</span><span className="dn">{d.day}</span>
                <span className="mo">{d.disabled ? 'Today' : d.mon}</span>
                {d.iso === tomorrowIso && !on && <span className="sr-only">, tomorrow</span>}
              </button>
            );
          })}
        </div>

        {week === 0 && hoursLeft > 0 && (
          <div className="panel" style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: '18px 20px' }}>
            <Ring fraction={Math.min(1, hoursLeft / 24)} label={`${Math.floor(hoursLeft)}h`} size={42} />
            <span className="stack" style={{ lineHeight: 1.35 }}>
              <span className="strong" style={{ fontSize: 16 }}>{isTomorrow ? `Tomorrow (${dayComma(first.iso)})` : dayComma(first.iso)} closes at 9:00 PM{isTomorrow ? '' : ` the evening before`}</span>
              <span className="help" style={{ fontSize: 15 }}>Same-day orders aren’t available — we bake for the morning ahead.</span>
            </span>
          </div>
        )}

        {picked.length > 0 && (
          <div className="row" style={{ justifyContent: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
            <span className="date-pill" style={{ background: 'var(--espresso)', color: 'var(--ivory)', borderColor: 'var(--espresso)' }}>{picked.length} morning{picked.length > 1 ? 's' : ''}</span>
            <span className="help" style={{ fontSize: 15 }}>{picked.map(p => dateInfo(p).label).join(' · ')}</span>
          </div>
        )}
      </main>
      <Footer>
        <button className="btn" disabled={!picked.length} onClick={proceed}>
          {!picked.length ? 'Choose at least one morning'
            : source || roDay ? <Go>Copy to these dates</Go>
              : <Go>{picked.length > 1 ? `Plan ${dayComma(picked.find(d => !plan.days[d]?.saved) || picked[0])} first` : `Plan ${dayComma(picked[0])}`}</Go>}
        </button>
      </Footer>
    </Screen>
  );
}

/* ---------- Daily context (style-1 P08) ---------- */
export function DailyContext() {
  const { iso } = useParams();
  const { state, set, plan, infos } = usePlan();
  const nav = useNavigate();
  const [ctx, setCtx] = useState(plan.days[iso]?.context || null);
  if (!plan.dates.includes(iso)) return <Navigate to="/plan/dates" replace />;
  const i = plan.dates.indexOf(iso);

  const go = () => {
    const options = recommendDay(state.profile, ctx);
    set(s => { s.plan.days[iso] = { context: ctx, which: 'primary', options, cfg: options.none ? null : options.primary, saved: false }; });
    nav(`/plan/day/${iso}/box`);
  };

  return (
    <Screen>
      <TopBar back={-1} close={null}><span className="topbar-title">Morning {i + 1} of {plan.dates.length}</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8, gap: 24 }}>
        {infos.length > 1 && <MorningPills dates={infos} active={iso} done={plan.dates.filter(x => plan.days[x]?.saved)} />}
        <RuledDate eyebrow="Planning">{dateInfo(iso).long}</RuledDate>
        <div className="stack gap-8">
          <h1 className="q">What kind of morning will it be?</h1>
          <p className="help" style={{ fontSize: 17 }}>We’ll match the breakfast to this day only.</p>
        </div>
        <div className="stack gap-16" role="radiogroup" aria-label="Daily context">
          {CONTEXTS.map(c => (
            <Option key={c.id} icon={CONTEXT_ICON[c.id]} on={ctx === c.id} title={c.label} onClick={() => setCtx(c.id)}>{CONTEXT_TEXT[c.id]}</Option>
          ))}
        </div>
      </main>
      <Footer><button className="btn" disabled={!ctx} onClick={go}><Go>See my Morning Box</Go></button></Footer>
    </Screen>
  );
}

/* ---------- Your Morning Box (style-1 P09) ---------- */
export function MorningBox() {
  const { iso } = useParams();
  const { state, set, plan } = usePlan();
  const nav = useNavigate();
  const [swapIndex, setSwapIndex] = useState(null);
  const day = plan.days[iso];
  useEffect(() => {
    if (day && !day.options && day.context) {
      const options = recommendDay(state.profile, day.context);
      set(s => { if (s.plan.days[iso]) s.plan.days[iso].options = options; });
    }
  }, [iso, day?.options, day?.context]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!day) return <Navigate to={`/plan/day/${iso}/context`} replace />;
  if (!day.cfg) return <NoMatch iso={iso} />;

  const profile = state.profile;
  const cfg = day.cfg;
  const price = dayPrice(cfg, profile);
  const other = day.options ? (day.which === 'primary' ? day.options.alternative : day.options.primary) : null;

  const update = fn => set(s => {
    const h = hydrate(s.plan.days[iso].cfg, s.profile);
    fn(h);
    s.plan.days[iso].cfg = serialize(h, s.plan.days[iso].context, s.plan.days[iso].which);
    s.plan.days[iso].saved = false;
  });
  const switchOption = () => set(s => {
    const dd = s.plan.days[iso];
    dd.which = dd.which === 'primary' ? 'alternative' : 'primary';
    dd.cfg = structuredClone(dd.options[dd.which]);
    dd.saved = false;
  });
  const matched = [eatingLabel(profile.eatingStyle), prefLabel(profile.preferences.find(p => cfg.recipeId.startsWith(p)) || '').replace(' Breakfast', ''), contextLabel(day.context), ...safeTags(profile)].filter(Boolean);

  return (
    <Screen>
      <TopBar back={`/plan/day/${iso}/context`} close={null}><span className="topbar-title">{dayComma(iso)} · {contextLabel(day.context)}</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8, gap: 20 }}>
        <div className="stack gap-8">
          <span className="eyebrow row" style={{ justifyContent: 'flex-start', gap: 10 }}><Icon name="sparkle" size={18} stroke={1.6} color="var(--espresso)" />{day.which === 'primary' ? 'Your Morning Box' : 'Another option for you'}</span>
          <h1 className="h-display" style={{ fontSize: 36 }}>{boxName(cfg)}</h1>
          <p className="help">Matched to: {matched.join(' · ')}</p>
        </div>

        <div style={{ position: 'relative', borderRadius: 26, background: 'linear-gradient(160deg, #F6EBD8, #EBDcC3)', padding: '62px 16px 22px' }}>
          <span className="badge-float" style={{ top: 14, left: 14 }}><Icon name="shield" size={18} stroke={1.7} />Safe for your profile</span>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(cfg.components.length, 5)}, minmax(0, 1fr))`, gap: 8, textAlign: 'center' }} aria-hidden="true">
            {cfg.components.map(id => (
              <div key={id} className="stack" style={{ alignItems: 'center', gap: 8 }}>
                <span style={{ width: 58, height: 58, borderRadius: 18, background: 'rgba(255,255,255,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={componentIcon(id)} size={28} stroke={1.5} /></span>
                <span className="xs strong" style={{ fontSize: 12 }}>{componentName(id).replace(/^Halal /, '').split(' ').slice(-1)[0]}</span>
              </div>
            ))}
          </div>
        </div>

        <section className="card list" aria-label="In your box" style={{ padding: '6px 20px' }}>
          {cfg.components.map((id, i) => (
            <div key={id + i} className="list-row" style={{ padding: '16px 0' }}>
              <span className="ci"><Icon name={componentIcon(id)} size={22} stroke={1.6} /></span>
              <span className="stack" style={{ gap: 2 }}><span style={{ fontSize: 17, fontWeight: 500 }}>{componentName(id)}</span><span className="sm" style={{ fontSize: 15 }}>{componentPortion(id, cfg.size)}</span></span>
              {canSwap(id) && swapOptions(hydrate(cfg, profile), i).length > 0 && (
                <button type="button" className="swap-btn" onClick={() => setSwapIndex(i)} aria-label={`Swap ${componentName(id)}`}>
                  <Icon name="swap" size={16} stroke={1.7} />Swap
                </button>
              )}
            </div>
          ))}
        </section>

        {cfg.substitutions?.length > 0 && (
          <div className="note"><Icon name="shield" size={20} stroke={1.6} style={{ flex: 'none' }} />
            <span>Adjusted for your profile: {cfg.substitutions.map(s => `${componentName(s.to)} instead of ${componentName(s.from)}`).join('; ')}.</span></div>
        )}

        {other && (
          <button type="button" onClick={switchOption} className="row" aria-label="Show another option"
            style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--sand-soft)', border: 0, borderRadius: 24, padding: '18px 20px' }}>
            <span className="stack" style={{ gap: 4 }}>
              <span className="eyebrow grey" style={{ letterSpacing: '.14em' }}>{day.which === 'primary' ? 'Another option for you' : 'Back to your first match'}</span>
              <span className="strong" style={{ fontSize: 18 }}>{boxName(other)}</span>
              <span className="help" style={{ fontSize: 15 }}>{other.components.map(componentName).join(' · ')}</span>
            </span>
            <Icon name="chevron" size={20} stroke={1.8} />
          </button>
        )}
      </main>
      <Footer sheet>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <span className="stack"><span className="sm" style={{ fontSize: 15 }}>{sizeLabel(cfg.size)}{canChooseSize(cfg) ? ' · from' : ''}</span><span style={{ font: '700 28px/1.15 var(--sans)' }}>AED {price.base + price.sizeAdj}</span></span>
          <span className="live" style={{ fontSize: 14 }}><i />Price updates live</span>
        </div>
        <button className="btn" onClick={() => nav(`/plan/day/${iso}/extras`)}><Go>Choose this breakfast</Go></button>
      </Footer>

      {swapIndex !== null && (
        <SwapSheet cfg={cfg} profile={profile} index={swapIndex} onClose={() => setSwapIndex(null)}
          onSwap={altId => { if (altId !== cfg.components[swapIndex]) update(h => applySwap(h, swapIndex, altId)); setSwapIndex(null); }} />
      )}
    </Screen>
  );
}

/* ---------- Swap (style-1 P10) ---------- */
function SwapSheet({ cfg, profile, index, onClose, onSwap }) {
  const current = cfg.components[index];
  const options = swapOptions(hydrate(cfg, profile), index);
  const [pick, setPick] = useState(current);
  const row = (id, isCurrent) => (
    <Option key={id} icon={componentIcon(id)} on={pick === id} title={componentName(id)} onClick={() => setPick(id)}>
      {componentPortion(id, cfg.size)}{isCurrent ? ' · current choice' : ''}
    </Option>
  );
  return (
    <div className="scrim" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="swap-title" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <div className="row" style={{ alignItems: 'flex-start', marginTop: 8 }}>
          <span className="eyebrow" style={{ paddingTop: 12 }}>Swap</span>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className="stack gap-8" style={{ marginTop: -8 }}>
          <h2 id="swap-title" className="q" style={{ fontSize: 26 }}>Swap {componentName(current)}</h2>
          <span className="help" style={{ fontSize: 15.5 }}>Same role in your box. Same price. Only options safe for your profile are shown.</span>
        </div>
        <div className="stack gap-12" role="radiogroup" aria-label="Replacement">
          {row(current, true)}
          {options.map(o => row(o, false))}
        </div>
        <span className="hint"><Icon name="check" size={18} stroke={1.8} />No price change for swaps</span>
        <button className="btn" onClick={() => onSwap(pick)}>{pick === current ? `Keep ${componentName(current)}` : `Swap to ${componentName(pick)}`}</button>
      </section>
    </div>
  );
}

/* ---------- Safe no-match (style-1 P21) ---------- */
function NoMatch({ iso }) {
  const { state, set, plan } = usePlan();
  const nav = useNavigate();
  const day = plan.days[iso];
  const p = state.profile;
  const skip = () => {
    const nextDates = plan.dates.filter(x => x !== iso);
    set(s => { s.plan.dates = nextDates; delete s.plan.days[iso]; });
    const next = nextDates.find(x => !plan.days[x]?.saved);
    nav(nextDates.length === 0 ? '/plan/dates' : next ? `/plan/day/${next}/context` : '/plan/summary');
  };
  return (
    <Screen>
      <TopBar back={`/plan/day/${iso}/context`} close={null}><span className="topbar-title">{dayComma(iso)} · {contextLabel(day.context)}</span></TopBar>
      <main className="screen-main center" style={{ alignItems: 'center', paddingTop: 36, gap: 22 }}>
        <span style={{ width: 96, height: 96, borderRadius: 999, background: 'var(--sand-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="shield" size={34} stroke={1.5} />
        </span>
        <h1 className="h-display" style={{ fontSize: 31 }}>We couldn’t find a Morning Box that safely matches your requirements.</h1>
        <p className="help" style={{ fontSize: 17 }}>Your safety comes first, so we never relax your allergies or dietary needs to force a result.</p>
        <div className="card stack gap-12" style={{ width: '100%', textAlign: 'left', padding: 20 }}>
          <span className="eyebrow grey" style={{ letterSpacing: '.12em' }}>For this morning you selected</span>
          <div className="tags">
            <span className="tag">{eatingLabel(p.eatingStyle)}</span>
            {p.preferences.map(x => <span key={x} className="tag">{prefLabel(x).replace(' Breakfast', '')}</span>)}
            <span className="tag">{contextLabel(day.context)}</span>
            {p.dietary.map(x => <span key={x} className="tag warn">{dietLabel(x)}</span>)}
            {p.allergies.map(x => <span key={x} className="tag warn">{allergyLabel(x)}</span>)}
          </div>
        </div>
      </main>
      <Footer>
        <Link to="/profile/preferences?edit=plan" className="btn">Review my preferences</Link>
        <Link to={`/plan/day/${iso}/context`} className="btn-text" style={{ alignSelf: 'center' }}>Try a different morning context</Link>
        {plan.dates.length > 1 && <button className="btn-text" style={{ alignSelf: 'center', fontSize: 14, color: 'var(--text-3)' }} onClick={skip}>Skip {dateInfo(iso).label}</button>}
      </Footer>
    </Screen>
  );
}

/* ---------- Size & something extra (style-1 P11) ---------- */
export function Extras() {
  const { iso } = useParams();
  const { state, set, plan } = usePlan();
  const nav = useNavigate();
  const [moreBread, setMoreBread] = useState(false);
  const day = plan.days[iso];
  if (!day?.cfg) return <Navigate to={`/plan/day/${iso}/context`} replace />;
  const cfg = day.cfg;
  const groups = addonGroups(state.profile);
  const pastry = groups.find(g => g.id === 'pastry');
  const bread = groups.find(g => g.id === 'bread');
  const price = dayPrice(cfg, state.profile);

  const setSize = sz => set(s => { s.plan.days[iso].cfg.size = sz; s.plan.days[iso].saved = false; });
  const pastryQty = item => cfg.addons.find(a => a.item === item && !a.unit)?.qty || 0;
  const loaf = item => cfg.addons.find(a => a.item === item && a.unit);
  const setAddon = (group, item, unit, qty) => set(s => {
    const c = s.plan.days[iso].cfg;
    c.addons = c.addons.filter(a => !(a.item === item && (group === 'bread' ? !!a.unit : !a.unit)));
    if (qty > 0) c.addons.push(unit ? { group, item, unit, qty } : { group, item, qty });
    s.plan.days[iso].saved = false;
  });
  const save = () => {
    set(s => { s.plan.days[iso].saved = true; });
    const p2 = structuredClone(plan); p2.days[iso].saved = true;
    nav(afterSave(p2, iso));
  };
  const portionText = id => {
    const amount = componentPortion(id, cfg.size === 'standard' ? 'regular' : cfg.size);
    const noun = componentName(id).replace(/^Halal /, '').toLowerCase().split(' ').slice(-1)[0];
    if (/egg/.test(amount)) return amount;
    if (/pcs?$/.test(amount)) return amount.replace(/\s*pcs?$/, ` ${noun}${/pcs$/.test(amount) && !noun.endsWith('s') ? 's' : ''}`);
    return `${amount} ${noun}`;
  };
  const portions = cfg.components.map(portionText).join(' · ');
  const breadItems = bread ? (moreBread ? bread.items : bread.items.slice(0, 2)) : [];

  return (
    <Screen>
      <TopBar back={`/plan/day/${iso}/box`} close={null}><span className="topbar-title">{dayComma(iso)} · {boxName(cfg)}</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8, gap: 18 }}>
        <div className="stack gap-6" style={{ gap: 6 }}>
          <h1 className="q">Choose your size</h1>
          <p className="help">Size changes the quantity — never what’s in your box.</p>
        </div>
        {canChooseSize(cfg) ? (
          <div className="seg tall" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }} role="radiogroup" aria-label="Size">
            {['light', 'regular', 'large'].map(sz => (
              <button key={sz} role="radio" aria-checked={cfg.size === sz} className={cfg.size === sz ? 'on' : ''} onClick={() => setSize(sz)}>
                <b className="row" style={{ gap: 6, fontWeight: 600 }}>{cfg.size === sz && <Icon name="check" size={16} stroke={2.2} />}{sizeLabel(sz)}</b>
                <span>AED {sizePrice(cfg, sz)}</span>
              </button>
            ))}
          </div>
        ) : <p className="note" style={{ margin: 0 }}>This ready-to-eat breakfast comes in one standard size.</p>}
        <p className="help" style={{ fontSize: 15.5, margin: 0 }}>{sizeLabel(cfg.size === 'standard' ? 'regular' : cfg.size)}: {portions}</p>

        {(pastry || bread) && <hr className="divider" style={{ margin: '8px 0' }} />}
        {(pastry || bread) && (
          <div className="stack" style={{ gap: 4 }}>
            <div className="row"><h2 className="q" style={{ fontSize: 26 }}>Add something extra</h2><span className="tag" style={{ fontSize: 14, fontWeight: 500 }}>Optional</span></div>
            <p className="help">Fresh from the bakery, packed separately.</p>
          </div>
        )}

        {pastry && (
          <section className="stack gap-10">
            <span className="eyebrow grey" style={{ letterSpacing: '.1em', fontWeight: 500 }}>Pastry</span>
            <div className="card list" style={{ padding: '4px 18px' }}>
              {pastry.items.map(item => (
                <div key={item} className="list-row">
                  <span className="ci"><Icon name="croissant" size={22} stroke={1.5} /></span>
                  <span className="stack" style={{ flex: 1 }}><span style={{ fontSize: 17, fontWeight: 500 }}>{componentName(item)}</span>
                    <span className="sm" style={{ fontSize: 15 }}>AED {addonPrice({ group: 'pastry', item, qty: 1 })} each</span></span>
                  {pastryQty(item) ? <Qty value={pastryQty(item)} max={9} label={componentName(item)} onChange={q => setAddon('pastry', item, null, q)} />
                    : <button type="button" className="add round" aria-label={`Add ${componentName(item)}`} onClick={() => setAddon('pastry', item, null, 1)}><Icon name="plus" size={20} stroke={1.6} /></button>}
                </div>
              ))}
            </div>
          </section>
        )}

        {bread && (
          <section className="stack gap-10">
            <div className="row"><span className="eyebrow grey" style={{ letterSpacing: '.1em', fontWeight: 500 }}>Bread to take home</span><span className="xs">Half AED {ADDON_PRICES.bread.half} · Whole AED {ADDON_PRICES.bread.whole}</span></div>
            <div className="card list" style={{ padding: '4px 18px' }}>
              {breadItems.map(item => {
                const l = loaf(item);
                return (
                  <div key={item} className="list-row">
                    <span className="ci"><Icon name="bread" size={22} stroke={1.5} /></span>
                    <span className="stack" style={{ flex: 1 }}>
                      <span style={{ fontSize: 17, fontWeight: 500 }}>{componentName(item)}</span>
                      <span className="sm" style={{ fontSize: 15 }}>
                        {['half', 'whole'].map((u, k) => (
                          <span key={u}>{k ? ' · ' : ''}
                            <button type="button" disabled={!l} onClick={() => setAddon('bread', item, u, l.qty)} aria-pressed={l?.unit === u}
                              style={{ background: 'none', border: 0, padding: '12px 2px', minHeight: 44, font: 'inherit', color: 'inherit', cursor: l ? 'pointer' : 'default', textDecoration: l?.unit === u ? 'underline' : 'none', textUnderlineOffset: 3 }}>
                              {u === 'half' ? 'Half loaf' : 'Whole loaf'}
                            </button>
                          </span>
                        ))}
                      </span>
                    </span>
                    {l ? <Qty value={l.qty} max={9} label={componentName(item)} onChange={q => setAddon('bread', item, l.unit, q)} />
                      : <button type="button" className="add round" aria-label={`Add ${componentName(item)}`} onClick={() => setAddon('bread', item, 'half', 1)}><Icon name="plus" size={20} stroke={1.6} /></button>}
                  </div>
                );
              })}
            </div>
            {bread.items.length > 2 && !moreBread && (
              <button type="button" className="btn-text" style={{ alignSelf: 'flex-start', textDecoration: 'none', color: 'var(--text-3)' }} onClick={() => setMoreBread(true)}>+ {bread.items.length - 2} more bread{bread.items.length - 2 > 1 ? 's' : ''}</button>
            )}
          </section>
        )}
      </main>
      <Footer sheet>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <span className="stack"><span className="sm" style={{ fontSize: 15 }}>Breakfast AED {price.base + price.sizeAdj}{price.addons ? ` + Extras AED ${price.addons}` : ''}</span>
            <span style={{ font: '700 28px/1.15 var(--sans)' }}>AED {price.total}</span></span>
        </div>
        <button className="btn" onClick={save}>Save this morning</button>
      </Footer>
    </Screen>
  );
}

/* ---------- Next morning (style-1 P12) ---------- */
export function NextMorning() {
  const { iso } = useParams();
  const { set, plan, infos } = usePlan();
  const nav = useNavigate();
  const [choice, setChoice] = useState('same');
  const i = plan.dates.indexOf(iso);
  const prevIso = plan.dates[i - 1];
  const prev = plan.days[prevIso];
  if (!prev?.saved) return <Navigate to={`/plan/day/${iso}/context`} replace />;

  const go = () => {
    if (choice === 'different') return nav(`/plan/day/${iso}/context`);
    const p2 = structuredClone(plan);
    p2.days[iso] = { ...structuredClone(prev), saved: true, copied: true };
    set(s => { s.plan.days[iso] = p2.days[iso]; });
    nav(afterSave(p2, iso));
  };
  const savedLine = [boxName(prev.cfg), sizeLabel(prev.cfg.size), prev.cfg.addons.length ? extrasLine(prev.cfg.addons) : null].filter(Boolean).join(' · ');

  return (
    <Screen>
      <TopBar back={-1} close={null}><span className="topbar-title">Morning {i + 1} of {plan.dates.length}</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8, gap: 22 }}>
        <MorningPills dates={infos} active={iso} done={plan.dates.filter(x => plan.days[x]?.saved)} />
        <div className="banner-ok" role="status">
          <Icon name="check" size={22} stroke={2} />
          <span style={{ fontSize: 16, lineHeight: 1.35 }}><b>{dateInfo(prevIso).long} saved.</b> {savedLine}</span>
        </div>
        <RuledDate eyebrow="Next up">{dateInfo(iso).long}</RuledDate>
        <h1 className="q">How should we plan this morning?</h1>
        <div className="stack gap-16" role="radiogroup">
          <Option icon="copy" on={choice === 'same'} title="Same as previous day" onClick={() => setChoice('same')}>
            Copy {dateInfo(prevIso).label} — context, breakfast, size, swaps &amp; extras. Still editable.
          </Option>
          <Option icon="sparkle" on={choice === 'different'} title="Choose a different morning" onClick={() => setChoice('different')}>
            Pick a new daily context for {dateInfo(iso).long.split(',')[0]}.
          </Option>
        </div>
      </main>
      <Footer><button className="btn" onClick={go}><Go>Continue with {dayComma(iso)}</Go></button></Footer>
    </Screen>
  );
}

/* ---------- Weekly summary (style-1 P13) ---------- */
const NUM = ['', 'One morning', 'Two mornings', '3 mornings', '4 mornings', '5 mornings', '6 mornings', '7 mornings'];
export function WeeklySummary() {
  const { state, set, plan } = usePlan();
  const remove = iso => set(s => { s.plan.dates = s.plan.dates.filter(x => x !== iso); delete s.plan.days[iso]; });
  const nav = useNavigate();
  const rows = plan.dates.filter(d => plan.days[d]?.saved);
  if (!plan.dates.length) return <Navigate to="/plan/dates" replace />;
  const unsaved = plan.dates.find(d => !plan.days[d]?.saved);
  const prices = rows.map(d => dayPrice(plan.days[d].cfg, state.profile));
  const total = prices.reduce((t, p) => t + p.total, 0);
  const signedIn = !!(state.session && state.user);

  return (
    <Screen>
      <TopBar back={-1} close={null}><span className="topbar-title">Your mornings</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8, gap: 16 }}>
        <div className="stack gap-10" style={{ marginBottom: 4 }}>
          <span className="eyebrow">{unsaved ? 'Almost planned' : 'All planned'}</span>
          <h1 className="h-display" style={{ fontSize: 38 }}>{rows.length === 1 ? 'Your morning,' : `${NUM[rows.length] || `${rows.length} mornings`},`} beautifully sorted.</h1>
        </div>
        {rows.map((iso, k) => {
          const day = plan.days[iso];
          const d = dateInfo(iso);
          const details = [canChooseSize(day.cfg) ? sizeLabel(day.cfg.size) : 'Standard size', day.cfg.addons.length ? `+ ${extrasLine(day.cfg.addons)}` : null].filter(Boolean).join(' · ');
          return (
            <article key={iso} className="card row" style={{ alignItems: 'flex-start', gap: 16, padding: 18 }}>
              <span className="datebox"><span className="wd">{d.wd}</span><span className="dn">{d.day}</span><span className="mo">{d.mon}</span></span>
              <span className="stack" style={{ flex: 1, gap: 3, minWidth: 0 }}>
                <span className="eyebrow grey" style={{ letterSpacing: '.1em', fontWeight: 500 }}>{contextLabel(day.context)}</span>
                <span className="strong" style={{ fontSize: 18, lineHeight: 1.3 }}>{boxName(day.cfg)}</span>
                <span className="help" style={{ fontSize: 15 }}>{details}</span>
              </span>
              <span className="stack" style={{ alignItems: 'flex-end', gap: 8 }}>
                <span className="money" style={{ fontSize: 18 }}>AED {prices[k].total}</span>
                <span className="row" style={{ gap: 14 }}>
                  <button type="button" className="link" style={{ minHeight: 44, color: 'var(--text-3)', textDecorationColor: 'var(--line)' }} onClick={() => remove(iso)} aria-label={`Remove ${dateInfo(iso).label}`}>Remove</button>
                  <Link to={`/plan/day/${iso}/box`} className="link" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} aria-label={`Edit ${dateInfo(iso).label}`}>Edit</Link>
                </span>
              </span>
            </article>
          );
        })}
        {plan.dates.some(d => plan.days[d]?.changed && !plan.days[d]?.saved) && (
          <div className="note"><Icon name="shield" size={20} stroke={1.6} style={{ flex: 'none' }} />
            <span>Some copied mornings no longer match your current profile, so we updated or held them for review. Check them before continuing.</span></div>
        )}
        {unsaved
          ? <Link to={plan.days[unsaved]?.cfg ? `/plan/day/${unsaved}/box` : `/plan/day/${unsaved}/context`} className="btn-secondary">Plan {dateInfo(unsaved).label}</Link>
          : <Link to="/plan/dates" className="row" style={{ justifyContent: 'flex-start', gap: 12, textDecoration: 'none', fontSize: 17, fontWeight: 500, padding: '6px 4px' }}><Icon name="plus" size={20} stroke={1.6} />Add another morning</Link>}
      </main>
      <Footer sheet>
        <div className="stack gap-4">
          <div className="row sm" style={{ fontSize: 15 }}><span>{rows.length} morning{rows.length === 1 ? '' : 's'}</span><span>Delivery included</span></div>
          <div className="row"><span className="strong" style={{ fontSize: 18 }}>Breakfast total</span><span style={{ font: '700 28px/1.15 var(--sans)' }}>AED {total}</span></div>
        </div>
        <button className="btn" disabled={!!unsaved || !rows.length}
          onClick={() => nav(signedIn ? '/checkout/delivery' : '/sign-in?next=/checkout/delivery')}>
          <Go>{signedIn ? 'Continue to delivery' : 'Continue to secure my mornings'}</Go>
        </button>
        {!signedIn && <span className="hint" style={{ justifyContent: 'center', fontSize: 15 }}><Icon name="lock" size={18} stroke={1.6} />Your plan is saved while you sign in.</span>}
      </Footer>
    </Screen>
  );
}
