import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Screen, TopBar, Progress, Option, Footer, Icon, Tick, Note, Money, MorningPills, Qty, IconButton
} from '../../components/ui.jsx';
import { useStore } from '../../state/store.jsx';
import {
  CONTEXTS, dateInfo, planningWeeks, cutoffLabel, recommendDay, hydrate, serialize, dayPrice, sizePrice,
  canChooseSize, boxTitle, componentName, componentIcon, componentPortion, contextLabel, eatingLabel,
  dietLabel, allergyLabel, sizeLabel, extrasText, addonPrice
} from '../../domain/app.js';
import { swapOptions, applySwap, canSwap, addonGroups } from '../../domain/engine.js';
import { ADDON_PRICES } from '../../domain/standards.js';

const CONTEXT_ICON = { active: 'bolt', regular: 'brief', busy: 'busy', relaxed: 'sun' };

/* ---------- helpers ---------- */
function usePlan() {
  const { state, set } = useStore();
  const plan = state.plan;
  const infos = plan.dates.map(dateInfo);
  const saved = plan.dates.filter(d => plan.days[d]?.saved);
  const firstUnsaved = plan.dates.find(d => !plan.days[d]?.saved);
  return { state, set, plan, infos, saved, firstUnsaved };
}

function afterSave(plan, iso) {
  const i = plan.dates.indexOf(iso);
  const next = plan.dates.slice(i + 1).find(d => !plan.days[d]?.saved) || plan.dates.find(d => !plan.days[d]?.saved);
  if (!next) return '/plan/summary';
  const prev = plan.dates[plan.dates.indexOf(next) - 1];
  return prev && plan.days[prev]?.saved ? `/plan/day/${next}/next` : `/plan/day/${next}/context`;
}

function DayHeader({ iso, back }) {
  const { plan } = usePlan();
  const i = plan.dates.indexOf(iso);
  const d = dateInfo(iso);
  return (
    <TopBar back={back} close="/">
      <span className="date-pill"><Icon name="cal" size={16} stroke={1.8} />{d.label}{plan.dates.length > 1 && ` · ${i + 1} of ${plan.dates.length}`}</span>
    </TopBar>
  );
}

/* ---------- Start: skip onboarding for returning users ---------- */
export function Start() {
  const { state } = useStore();
  return <Navigate to={state.profileDone ? '/plan/dates' : '/profile/eating'} replace />;
}

/* ---------- Choose dates ---------- */
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
  const source = reuse ? state.orders.find(o => o.id === reuse) : null;
  const [roId, roDate] = (reorder || '').split(':');
  const roDay = reorder ? state.orders.find(o => o.id === roId)?.days.find(d => d.date === roDate) : null;

  const proceed = () => {
    set(s => {
      const days = {};
      picked.forEach((iso, i) => {
        const copyFrom = source ? source.days[i % source.days.length] : roDay;
        if (copyFrom) {
          days[iso] = { context: copyFrom.cfg.context, which: copyFrom.cfg.which, options: null, cfg: structuredClone(copyFrom.cfg), saved: true, copied: true };
        } else {
          days[iso] = s.plan.days[iso] || null;
        }
      });
      Object.keys(days).forEach(k => { if (!days[k]) delete days[k]; });
      s.plan = { dates: picked, days };
    });
    const allCopied = source || roDay;
    nav(allCopied ? '/plan/summary' : `/plan/day/${picked.find(d => !plan.days[d]?.saved) || picked[0]}/context`);
  };

  if (!state.profileDone) return <Navigate to="/profile/eating" replace />;
  const list = weeks[week];
  return (
    <Screen>
      <TopBar back={-1} close="/"><span className="topbar-title">{source || roDay ? 'Choose new dates' : 'Step 4 of 5'}</span></TopBar>
      {!source && !roDay && <Progress step={4} />}
      <main className="screen-main" style={{ paddingTop: 28 }}>
        <div className="stack gap-10">
          <span className="eyebrow">{source ? 'Use this plan again' : roDay ? 'Reorder a morning' : 'Plan your mornings'}</span>
          <h1 className="q">{source ? 'Which dates should we copy your plan to?' : roDay ? 'Which mornings would you like it again?' : 'Which mornings should we plan?'}</h1>
          <p className="help">{source || roDay ? 'Each copied morning stays editable before you pay. Nothing is ordered automatically.' : 'Choose one or more dates. We’ll build each morning, one at a time.'}</p>
        </div>
        <div className="seg" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }} role="tablist" aria-label="Week">
          {weeks.map((w, i) => (
            <button key={i} role="tab" aria-selected={week === i} className={week === i ? 'on' : ''} onClick={() => setWeek(i)}>
              {i === 0 ? 'This week' : 'Next week'} · {w[0].day}–{w[6].day} {w[6].mon}
            </button>
          ))}
        </div>
        <div className="grid-4">
          {list.map(d => {
            const on = picked.includes(d.iso);
            return (
              <button key={d.iso} type="button" className={`day${on ? ' on' : ''}`} aria-pressed={on}
                aria-label={`${d.long}${on ? ', selected' : ''}`} onClick={() => toggle(d.iso)}>
                {on && <span className="ck"><Icon name="check" size={11} stroke={3.5} /></span>}
                <span className="wd">{d.wd}</span><span className="dn">{d.day}</span><span className="mo">{d.mon}</span>
              </button>
            );
          })}
        </div>
        <div className="row sm" style={{ justifyContent: 'flex-start' }}>
          <Icon name="clock" size={18} color="#7A5A14" />
          {weeks[0][0].label} is open until {cutoffLabel(weeks[0][0].iso)}.
        </div>
        {picked.length > 0 && (
          <div className="card stack gap-4" style={{ padding: 16 }}>
            <span className="strong">{picked.length} morning{picked.length > 1 ? 's' : ''} selected</span>
            <span className="sm">{picked.map(p => dateInfo(p).label).join(' · ')}</span>
          </div>
        )}
      </main>
      <Footer>
        <button className="btn" disabled={!picked.length} onClick={proceed}>
          {!picked.length ? 'Choose at least one morning' : source || roDay ? 'Copy to these dates' : `Plan ${dateInfo(picked.find(d => !plan.days[d]?.saved) || picked[0]).label}`}
        </button>
      </Footer>
    </Screen>
  );
}

/* ---------- Daily context ---------- */
export function DailyContext() {
  const { iso } = useParams();
  const { state, set, plan, infos } = usePlan();
  const nav = useNavigate();
  const [ctx, setCtx] = useState(plan.days[iso]?.context || null);
  if (!plan.dates.includes(iso)) return <Navigate to="/plan/dates" replace />;
  const d = dateInfo(iso);

  const go = () => {
    const options = recommendDay(state.profile, ctx);
    set(s => {
      s.plan.days[iso] = { context: ctx, which: 'primary', options, cfg: options.none ? null : options.primary, saved: false };
    });
    nav(`/plan/day/${iso}/box`);
  };

  return (
    <Screen>
      <TopBar back={-1} close="/"><span className="topbar-title">Step 5 of 5</span></TopBar>
      <Progress step={5} />
      <main className="screen-main" style={{ paddingTop: 24 }}>
        <div className="stack gap-12">
          {infos.length > 1 && <MorningPills dates={infos} active={iso} done={plan.dates.filter(x => plan.days[x]?.saved)} />}
          <div className="date-title">{d.long}</div>
          <h1 className="q" style={{ fontSize: 24 }}>What will this morning look like?</h1>
        </div>
        <div className="stack gap-10" role="radiogroup" aria-label="Daily context">
          {CONTEXTS.map(c => (
            <Option key={c.id} icon={CONTEXT_ICON[c.id]} on={ctx === c.id} title={c.label} onClick={() => setCtx(c.id)}>{c.blurb}</Option>
          ))}
        </div>
      </main>
      <Footer><button className="btn" disabled={!ctx} onClick={go}>See My Morning Box</button></Footer>
    </Screen>
  );
}

/* ---------- Your Morning Box ---------- */
export function MorningBox() {
  const { iso } = useParams();
  const { state, set, plan } = usePlan();
  const nav = useNavigate();
  const [swapIndex, setSwapIndex] = useState(null);
  const day = plan.days[iso];
  const [extrasOpen, setExtrasOpen] = useState(() => (day?.cfg?.addons?.length || 0) > 0);
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

  const tags = [...profile.dietary.map(dietLabel), ...profile.allergies.map(a => `${allergyLabel(a).split(' /')[0]}-free`)];
  const save = () => {
    set(s => { s.plan.days[iso].saved = true; });
    const p2 = structuredClone(plan); p2.days[iso].saved = true;
    nav(afterSave(p2, iso));
  };

  return (
    <Screen>
      <DayHeader iso={iso} back={`/plan/day/${iso}/context`} />
      <main className="screen-main" style={{ paddingTop: 12, gap: 22 }}>
        <div className="row">
          <span className="sm">{contextLabel(day.context)} · {eatingLabel(profile.eatingStyle)}</span>
          <Link to={`/plan/day/${iso}/context`} className="link" style={{ padding: '12px 0' }}>Change</Link>
        </div>
        <div className="stack gap-8">
          <span className="eyebrow">{day.which === 'primary' ? 'Recommended for your morning' : 'Another option for you'}</span>
          <h1 className="h-display" style={{ fontSize: 40 }}>Your Morning Box</h1>
          <p className="help">{boxTitle(cfg)}{cfg.format ? ` — ${cfg.format.replace(/\.$/, '')}` : ''}.</p>
        </div>

        <div className="box-visual" style={{ gridTemplateColumns: `repeat(${Math.min(cfg.components.length, 5)}, minmax(0, 1fr))` }} aria-hidden="true">
          {cfg.components.map(id => (
            <div key={id}><span className="c"><Icon name={componentIcon(id)} size={28} stroke={1.5} /></span>
              <span className="xs strong">{componentName(id).replace(/^Halal /, '').split(' ').slice(-1)[0]}</span></div>
          ))}
        </div>

        <section className="card list" aria-label="In your box">
          <div className="row" style={{ padding: '14px 0 4px' }}>
            <h2 className="h3">In your box</h2><span className="xs">Swaps never change the price</span>
          </div>
          {cfg.components.map((id, i) => (
            <div key={id + i} className="list-row">
              <span className="ci"><Icon name={componentIcon(id)} size={20} stroke={1.6} /></span>
              <span className="stack"><span className="strong">{componentName(id)}</span><span className="xs">{componentPortion(id, cfg.size)}</span></span>
              {canSwap(id) && swapOptions(hydrate(cfg, profile), i).length > 0 && (
                <button type="button" className="swap-btn" onClick={() => setSwapIndex(i)} aria-label={`Swap ${componentName(id)}`}>
                  <Icon name="swap" size={15} stroke={1.8} />Swap
                </button>
              )}
            </div>
          ))}
        </section>

        {cfg.substitutions?.length > 0 && (
          <Note icon="shield">Adjusted for your profile: {cfg.substitutions.map(s => `${componentName(s.to)} instead of ${componentName(s.from)}`).join('; ')}.</Note>
        )}

        {tags.length > 0 && (
          <div className="tags">{tags.map(t => <span key={t} className="tag"><Icon name="check" size={13} stroke={3} />{t}</span>)}</div>
        )}

        <section className="stack gap-12">
          <div className="row"><h2 className="h3">Size</h2><span className="xs">Changes the portion, not what’s in the box</span></div>
          {canChooseSize(cfg) ? (
            <div className="seg tall" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }} role="radiogroup" aria-label="Size">
              {['light', 'regular', 'large'].map(sz => (
                <button key={sz} role="radio" aria-checked={cfg.size === sz} className={cfg.size === sz ? 'on' : ''}
                  onClick={() => update(h => { h.size = sz; })}>{sizeLabel(sz)}<span>AED {sizePrice(cfg, sz)}</span></button>
              ))}
            </div>
          ) : <p className="sm" style={{ margin: 0 }}>This ready-to-eat breakfast comes in one standard size.</p>}
        </section>

        {other && (
          <button type="button" onClick={switchOption} className="row card" style={{ border: '1px dashed #D8C29C', textAlign: 'left', cursor: 'pointer', background: 'transparent' }}>
            <span className="stack">
              <span className="strong">{day.which === 'primary' ? 'Another option for you' : 'Back to your first recommendation'}</span>
              <span className="sm">{boxTitle(other)} · AED {dayPrice(other, profile).total}</span>
            </span>
            <Icon name="chevron" size={20} stroke={1.8} />
          </button>
        )}

        <ExtrasSection iso={iso} open={extrasOpen} onToggle={() => setExtrasOpen(o => !o)} />
      </main>
      <Footer split>
        <div className="stack">
          <span className="xs">This morning</span>
          <span style={{ font: '700 22px/1.2 var(--sans)' }}>AED {price.total}</span>
        </div>
        <button className="btn auto" onClick={save}>Save This Morning</button>
      </Footer>

      {swapIndex !== null && (
        <SwapSheet cfg={cfg} profile={profile} index={swapIndex} onClose={() => setSwapIndex(null)}
          onSwap={altId => { update(h => applySwap(h, swapIndex, altId)); setSwapIndex(null); }} />
      )}
    </Screen>
  );
}

function SwapSheet({ cfg, profile, index, onClose, onSwap }) {
  const current = cfg.components[index];
  const options = swapOptions(hydrate(cfg, profile), index);
  const [pick, setPick] = useState(options[0]);
  return (
    <div className="scrim" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="swap-title" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="stack gap-4">
            <h2 id="swap-title" style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.25 }}>Swap {componentName(current)}</h2>
            <span className="sm">Choose one replacement. The price stays the same.</span>
          </div>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className="stack gap-8" role="radiogroup" aria-label="Replacement">
          <Option on={false} title={componentName(current)} onClick={onClose}>Currently in your box</Option>
          {options.map(o => <Option key={o} on={pick === o} title={componentName(o)} onClick={() => setPick(o)} />)}
        </div>
        <p className="xs" style={{ margin: 0 }}>Only options that fit your dietary needs and allergies are shown.</p>
        <div className="stack gap-4">
          <button className="btn" onClick={() => onSwap(pick)}>Swap to {componentName(pick)}</button>
          <button className="btn-text" style={{ alignSelf: 'center' }} onClick={onClose}>Keep {componentName(current)}</button>
        </div>
      </section>
    </div>
  );
}

/* ---------- Safe no-match ---------- */
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
      <DayHeader iso={iso} back={`/plan/day/${iso}/context`} />
      <main className="screen-main center" style={{ alignItems: 'center', paddingTop: 40 }}>
        <span style={{ width: 88, height: 88, borderRadius: 999, background: 'var(--sand-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7A5A14' }}>
          <Icon name="shieldAlert" size={40} stroke={1.4} />
        </span>
        <h1 className="h-display" style={{ fontSize: 32 }}>We couldn’t find a safe breakfast for this morning</h1>
        <p className="help">With your current requirements and a {contextLabel(day.context)} morning, none of our approved breakfasts are a safe match. We never weaken your allergies or dietary needs to make one fit.</p>
        <div className="tags" style={{ justifyContent: 'center' }}>
          <span className="tag">{eatingLabel(p.eatingStyle)}</span>
          {p.dietary.map(x => <span key={x} className="tag">{dietLabel(x)}</span>)}
          {p.allergies.map(x => <span key={x} className="tag">{allergyLabel(x)} allergy</span>)}
        </div>
      </main>
      <Footer>
        <Link to="/profile/preferences?edit=plan" className="btn">Review My Preferences</Link>
        <Link to={`/plan/day/${iso}/context`} className="btn-secondary">Try a Different Morning Type</Link>
        <button className="btn-text" style={{ alignSelf: 'center' }} onClick={skip}>Skip {dateInfo(iso).label}</button>
      </Footer>
    </Screen>
  );
}

/* ---------- Add something extra (optional, MB-BOX-001 §5–6) ----------
   Shown inside Your Morning Box so planning a morning stays one screen. */
function ExtrasSection({ iso, open, onToggle }) {
  const { state, set, plan } = usePlan();
  const groups = addonGroups(state.profile).sort((a, b) => (a.id === 'pastry' ? -1 : b.id === 'pastry' ? 1 : 0));
  const cfg = plan.days[iso].cfg;
  if (!groups.length) return null;
  const count = cfg.addons.reduce((t, a) => t + a.qty, 0);
  const qtyOf = (item, unit) => cfg.addons.find(a => a.item === item && (a.unit || null) === (unit || null))?.qty || 0;
  const setQty = (group, item, unit, qty) => set(s => {
    const c = s.plan.days[iso].cfg;
    c.addons = c.addons.filter(a => !(a.item === item && (a.unit || null) === (unit || null)));
    if (qty > 0) c.addons.push(unit ? { group, item, unit, qty } : { group, item, qty });
    s.plan.days[iso].saved = false;
  });

  const loaf = item => cfg.addons.find(a => a.item === item && a.unit);
  const setUnit = (item, unit) => set(s => {
    const c = s.plan.days[iso].cfg;
    const a = c.addons.find(x => x.item === item && x.unit);
    if (a) a.unit = unit;
    s.plan.days[iso].saved = false;
  });

  return (
    <section className="stack gap-12" aria-labelledby="extras-h">
      <button type="button" className="row card" onClick={onToggle} aria-expanded={open} aria-controls="extras-body"
        style={{ textAlign: 'left', cursor: 'pointer', padding: '16px 18px' }}>
        <span className="stack gap-4">
          <span id="extras-h" className="strong">Add something extra <span className="xs" style={{ fontWeight: 400 }}>· optional</span></span>
          <span className="sm">{count ? extrasText(cfg.addons) : 'Fresh bread or pastry from the same bakery'}</span>
        </span>
        <Icon name="chevron" size={20} stroke={1.8} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flex: 'none' }} />
      </button>
      {open && (
        <div id="extras-body" className="stack gap-16">
          {groups.map(g => (
            <div key={g.id} className="stack gap-10">
              <div className="row">
                <h3 className="h3" style={{ fontSize: 15 }}>{g.id === 'pastry' ? 'Pastry' : 'Bread to take home'}</h3>
              </div>
              <div className="card list">
                {g.items.map(item => g.units ? (
                  <div key={item} className="list-row" style={{ flexWrap: 'wrap', rowGap: 10 }}>
                    <span className="stack" style={{ flex: 1 }}><span className="strong">{componentName(item)}</span>
                      <span className="xs">Half AED {ADDON_PRICES.bread.half} · Whole AED {ADDON_PRICES.bread.whole}</span></span>
                    {loaf(item) ? (
                      <>
                        <Qty value={loaf(item).qty} max={9} label={componentName(item)} onChange={q => setQty('bread', item, loaf(item).unit, q)} />
                        <div className="seg" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', width: '100%' }} role="radiogroup" aria-label={`${componentName(item)} loaf size`}>
                          {g.units.map(u => (
                            <button key={u} type="button" role="radio" aria-checked={loaf(item).unit === u} className={loaf(item).unit === u ? 'on' : ''}
                              onClick={() => setUnit(item, u)}>{u === 'half' ? 'Half loaf' : 'Whole loaf'}</button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <button type="button" className="add" onClick={() => setQty('bread', item, 'half', 1)}><Icon name="plus" size={14} stroke={2.2} /> Add</button>
                    )}
                  </div>
                ) : (
                  <div key={item} className="list-row">
                    <span className="stack" style={{ flex: 1 }}><span className="strong">{componentName(item)}</span>
                      <span className="xs">AED {addonPrice({ group: 'pastry', item, qty: 1 })} each</span></span>
                    {qtyOf(item) ? <Qty value={qtyOf(item)} max={9} label={componentName(item)} onChange={q => setQty('pastry', item, null, q)} />
                      : <button type="button" className="add" onClick={() => setQty('pastry', item, null, 1)}><Icon name="plus" size={14} stroke={2.2} /> Add</button>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Old route kept so existing links still work. */
export function Extras() {
  const { iso } = useParams();
  return <Navigate to={`/plan/day/${iso}/box`} replace />;
}

/* ---------- Next morning ---------- */
export function NextMorning() {
  const { iso } = useParams();
  const { state, set, plan, infos } = usePlan();
  const nav = useNavigate();
  const [choice, setChoice] = useState('same');
  const i = plan.dates.indexOf(iso);
  const prevIso = plan.dates[i - 1];
  const prev = plan.days[prevIso];
  if (!prev?.saved) return <Navigate to={`/plan/day/${iso}/context`} replace />;
  const prevPrice = dayPrice(prev.cfg, state.profile).total;

  const go = () => {
    if (choice === 'different') return nav(`/plan/day/${iso}/context`);
    const p2 = structuredClone(plan);
    p2.days[iso] = { ...structuredClone(prev), saved: true, copied: true };
    set(s => { s.plan.days[iso] = p2.days[iso]; });
    nav(afterSave(p2, iso));
  };

  return (
    <Screen>
      <TopBar back={-1} close="/"><span className="topbar-title">Morning {i + 1} of {plan.dates.length}</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 12, gap: 22 }}>
        <div className="banner-ok" role="status">
          <span style={{ width: 28, height: 28, borderRadius: 999, background: '#3F6B43', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name="check" size={15} stroke={3} /></span>
          <span style={{ fontSize: 15, color: 'var(--espresso)' }}><b>{dateInfo(prevIso).label} saved.</b> AED {prevPrice}</span>
        </div>
        <MorningPills dates={infos} active={iso} done={plan.dates.filter(x => plan.days[x]?.saved)} />
        <div className="stack gap-8">
          <div className="date-title">{dateInfo(iso).long}</div>
          <h1 className="q" style={{ fontSize: 24 }}>How should we plan this morning?</h1>
        </div>
        <div className="stack gap-12" role="radiogroup">
          <Option on={choice === 'same'} title="Same as Previous Day" onClick={() => setChoice('same')}>
            {contextLabel(prev.context)} · Your Morning Box · {sizeLabel(prev.cfg.size)}{prev.cfg.addons.length ? ` · ${extrasText(prev.cfg.addons)}` : ''}. You can still edit it on its own afterwards.
          </Option>
          <Option on={choice === 'different'} title="Choose a Different Morning" onClick={() => setChoice('different')}>
            Tell us what {dateInfo(iso).wd} looks like and get a fresh recommendation.
          </Option>
        </div>
      </main>
      <Footer><button className="btn" onClick={go}>Continue</button></Footer>
    </Screen>
  );
}

/* ---------- Weekly summary ---------- */
export function WeeklySummary() {
  const { state, set, plan } = usePlan();
  const nav = useNavigate();
  const rows = plan.dates.filter(d => plan.days[d]?.saved);
  if (!plan.dates.length) return <Navigate to="/plan/dates" replace />;
  const unsaved = plan.dates.find(d => !plan.days[d]?.saved);
  const prices = rows.map(d => dayPrice(plan.days[d].cfg, state.profile));
  const boxes = prices.reduce((t, p) => t + p.base + p.sizeAdj, 0);
  const extras = prices.reduce((t, p) => t + p.addons, 0);
  const remove = iso => set(s => { s.plan.dates = s.plan.dates.filter(x => x !== iso); delete s.plan.days[iso]; });

  return (
    <Screen>
      <TopBar back={-1} close="/"><span className="topbar-title">Your plan</span></TopBar>
      <main className="screen-main tight">
        <div className="stack gap-8" style={{ marginBottom: 4 }}>
          <span className="eyebrow">{unsaved ? 'Almost planned' : 'All mornings planned'}</span>
          <h1 className="h-display">Your week of mornings</h1>
        </div>
        {rows.map((iso, k) => {
          const day = plan.days[iso];
          return (
            <article key={iso} className="card stack gap-8" style={{ padding: '16px 18px' }}>
              <div className="row">
                <span style={{ font: '700 17px/1.2 var(--sans)' }}>{dateInfo(iso).label}</span>
                <span className="row gap-12">
                  <Link to={`/plan/day/${iso}/box`} className="row" style={{ gap: 6, fontWeight: 600, fontSize: 14, minHeight: 44 }}><Icon name="edit" size={15} stroke={1.8} />Edit</Link>
                  <button type="button" className="link" style={{ fontSize: 13, color: 'var(--text-3)' }} onClick={() => remove(iso)}>Remove</button>
                </span>
              </div>
              <span className="strong">{boxTitle(day.cfg)}</span>
              <div className="tags">
                <span className="tag">{day.copied ? 'Copied' : contextLabel(day.context)}</span>
                <span className="tag">{sizeLabel(day.cfg.size)}</span>
                {day.cfg.addons.map(a => <span key={a.item + (a.unit || '')} className="tag">+ {componentName(a.item)}{a.unit ? ` (${a.unit})` : ''} × {a.qty}</span>)}
              </div>
              <div className="row"><span /><Money value={prices[k].total} /></div>
            </article>
          );
        })}
        {unsaved && (
          <Link to={`/plan/day/${unsaved}/context`} className="btn-secondary">Plan {dateInfo(unsaved).label}</Link>
        )}
        <section className="panel">
          <div className="sr"><span>{rows.length} morning{rows.length === 1 ? '' : 's'}</span><span className="money">AED {boxes}</span></div>
          {extras > 0 && <div className="sr"><span>Extras</span><span className="money">AED {extras}</span></div>}
          <hr className="divider" />
          <div className="sr total"><span>Total</span><span>AED {boxes + extras}</span></div>
        </section>
        <p className="xs center" style={{ margin: 0 }}>Your plan is saved while you sign in — nothing to rebuild.</p>
      </main>
      <Footer>
        <button className="btn" disabled={!!unsaved || !rows.length}
          onClick={() => nav(state.user ? '/checkout/delivery' : '/sign-in?next=/checkout/delivery')}>
          Continue to Delivery
        </button>
      </Footer>
    </Screen>
  );
}
