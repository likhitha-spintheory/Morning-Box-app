import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CONSENT } from '../../legal/documents.js';
import { put, track } from '../../api.js';
import { Screen, TopBar, Option, Chip, Footer, Icon, Tick, SunArc, Go, InfoTip, goBack } from '../../components/ui.jsx';
import { useStore } from '../../state/store.jsx';
import { EATING_STYLES, PREFERENCES, DIETARY, ALLERGENS, allergyLabel, dietLabel } from '../../domain/app.js';
import { glutenFreeBlocked, GLUTEN_FREE_MESSAGE } from '../../domain/standards.js';

export const hasHealthData = p => !!(p.dietary?.length || p.allergies?.length || (p.otherAllergies || '').trim());

const EATING_ICON = { health: 'leafy', flexible: 'sunny' };
/* MB-PER-001 Q1 — the approved descriptions, word for word. */
const EATING_TEXT = Object.fromEntries(EATING_STYLES.map(e => [e.id, e.blurb]));
export const PREF_ICON = { savory: 'egg', bakery: 'croissant', fresh: 'bowl', sweet: 'heart' };
export const PREF_SHORT = {
  savory: 'Eggs, warm & hearty', bakery: 'Fresh bread, croissants',
  fresh: 'Yogurt, oats, fruit', sweet: 'Pastry, berries, honey'
};
/* MB-PER-001 Q2 titles. */
export const PREF_TITLE = Object.fromEntries(PREFERENCES.map(p => [p.id, p.label]));

/**
 * Onboarding shows the sun-arc progress and saves as you go. Editing from the
 * profile works on a draft: Save applies it (and re-checks booked mornings on
 * the server), Back discards it.
 */
function useStep(nextPath) {
  const [params] = useSearchParams();
  const editing = params.get('edit');
  const nav = useNavigate();
  const { state, set, markProfileSynced } = useStore();
  const [draft, setDraft] = useState(() => structuredClone(state.profile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const profile = editing ? draft : state.profile;
  const update = fn => (editing ? setDraft(d => { const n = structuredClone(d); fn(n); return n; }) : set(s => { fn(s.profile); }));
  /* `fix` adjusts the profile being saved (e.g. drops allergy data the customer didn't agree to keep). */
  const goNext = async (extra = s => s, fix = null) => {
    const fixed = p => { const n = structuredClone(p); if (fix) fix(n); return n; };
    if (!editing) {
      if (nextPath === '/plan/dates') track('profile_completed');
      const prof = fixed(state.profile);
      /* Finishing onboarding while signed in: save the profile to the account now. */
      if (state.session && nextPath === '/plan/dates') {
        await put('/me/profile', prof).then(() => markProfileSynced(prof)).catch(() => {});
      }
      set(s => { s.profile = prof; extra(s); }); nav(nextPath); return;
    }
    const saving = fixed(draft);
    let review = [];
    if (state.session && state.profileDone) {
      setBusy(true); setError('');
      try {
        const r = await put('/me/profile', saving);
        markProfileSynced(saving);
        review = r.review || [];
      } catch (e) { setBusy(false); setError(e.message); return; }
    }
    set(s => { s.profile = saving; extra(s); });
    const withdrawn = !saving.healthConsent && state.profile.healthConsent && !hasHealthData(saving);
    if (editing === 'plan') { goBack(nav); return; }
    nav(review.length ? `/me?review=${review.length}` : withdrawn ? '/me?withdrawn=1' : '/me');
  };
  return { editing, goNext, profile, update, busy, error };
}

const SaveError = ({ children }) => children
  ? <div className="banner-err" role="alert"><Icon name="alert" size={18} stroke={2} />{children}</div> : null;

function Frame({ step, back, editing, children, footer }) {
  return (
    <Screen>
      <TopBar back={editing ? (editing === 'plan' ? -1 : '/me') : back} close={editing ? null : '/'}>
        <span className="topbar-title">{editing ? 'Edit Morning Profile' : `Your Morning Profile: Step ${step} of 5`}</span>
      </TopBar>
      {!editing && <div style={{ paddingTop: 8 }}><SunArc step={step} total={5} /></div>}
      <main className="screen-main" style={{ paddingTop: 24, gap: 24 }}>{children}</main>
      <Footer>{footer}</Footer>
    </Screen>
  );
}

function Heading({ q, help, tip }) {
  return (
    <div className="stack gap-10">
      <h1 className="q">{q}{tip && <> <InfoTip label="Why we ask">{tip}</InfoTip></>}</h1>
      {help && <p className="help" style={{ fontSize: 17 }}>{help}</p>}
    </div>
  );
}

export function EatingStyle() {
  const { editing, goNext, profile, update, busy, error } = useStep('/profile/preferences');
  const value = profile.eatingStyle;
  return (
    <Frame step={1} back="/" editing={editing}
      footer={<button className="btn" disabled={!value || busy} onClick={() => goNext()}>{editing ? (busy ? 'Saving…' : 'Save') : <Go>Continue</Go>}</button>}>
      <Heading q="How do you usually like to eat?" help="This shapes the version of breakfast we recommend. You can change it anytime." />
      <div className="stack gap-16" role="radiogroup" aria-label="Eating style">
        {EATING_STYLES.map(e => (
          <Option key={e.id} icon={EATING_ICON[e.id]} on={value === e.id} title={e.label}
            onClick={() => update(p => { p.eatingStyle = e.id; })}>{EATING_TEXT[e.id]}</Option>
        ))}
      </div>
      <span className="hint"><Icon name="info" size={20} stroke={1.6} />A preference, not a medical classification or permanent restriction.</span>
      <SaveError>{error}</SaveError>
    </Frame>
  );
}

export function Preferences() {
  const { editing, goNext, profile, update, busy, error } = useStep('/profile/dietary');
  const sel = profile.preferences;
  const toggle = id => update(pr => {
    const p = pr.preferences;
    pr.preferences = p.includes(id) ? p.filter(x => x !== id) : [...p, id];
  });
  return (
    <Frame step={2} back="/profile/eating" editing={editing}
      footer={<button className="btn" disabled={!sel.length || busy} onClick={() => goNext()}>{editing ? (busy ? 'Saving…' : 'Save') : <Go>Continue</Go>}</button>}>
      <Heading q="What kind of breakfast do you usually enjoy?" help="Choose as many as you like." />
      <div className="grid-2" style={{ gap: 16 }}>
        {PREFERENCES.map(p => {
          const on = sel.includes(p.id);
          return (
            <button key={p.id} type="button" className={`tile${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggle(p.id)}>
              <Tick on={on} square />
              <span className="ico"><Icon name={PREF_ICON[p.id]} size={24} stroke={1.6} /></span>
              <span className="stack" style={{ gap: 4, marginTop: 'auto' }}>
                <span style={{ fontWeight: 600, fontSize: 18, lineHeight: 1.25 }}>{PREF_TITLE[p.id]}</span>
                <span className="help" style={{ fontSize: 15.5 }}>{PREF_SHORT[p.id]}</span>
              </span>
            </button>
          );
        })}
      </div>
      <SaveError>{error}</SaveError>
    </Frame>
  );
}

export function Dietary() {
  const { editing, goNext, profile, update, busy, error } = useStep('/plan/dates');
  const { dietary, allergies } = profile;
  const other = profile.otherAllergies || '';
  const toggle = (key, id) => update(p => {
    const a = p[key];
    p[key] = a.includes(id) ? a.filter(x => x !== id) : [...a, id];
  });
  /* First-time profile: dates and daily context follow as steps 4 and 5 of the same flow. */
  const done = s => { if (!editing) s.onboarding = true; s.profileDone = true; };
  /* Legal pack B1: allergy and dietary details are kept only with the customer's explicit, unticked-by-default consent. */
  const hasData = hasHealthData(profile);
  const consent = !!profile.healthConsent;
  const [asking, setAsking] = useState(false);
  /* The question sits below the fold: bring it (and the "Continue without" choice) into view. */
  useEffect(() => { if (asking) document.getElementById('hc-ask')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [asking]);
  const finish = () => {
    if (hasData && !consent) { setAsking(true); return; }
    goNext(done, p => { if (!hasHealthData(p)) p.healthConsent = false; });
  };
  const withoutData = () => goNext(done, p => { p.dietary = []; p.allergies = []; p.otherAllergies = ''; p.healthConsent = false; });
  const gfBlocked = consent && glutenFreeBlocked(dietary);   // client feedback PRD-004
  const safetyText = allergies.length
    ? `We’ll leave out anything with ${allergies.map(a => allergyLabel(a).split(' /')[0].toLowerCase()).join(', ')}.`
    : other.trim() ? 'We’ll check your other allergies with the bakery.'
    : dietary.length ? `Only ${dietary.map(d => dietLabel(d).toLowerCase()).join(' and ')} breakfasts.`
      : '';

  return (
    <Frame step={3} back="/profile/preferences" editing={editing}
      footer={<button className="btn" disabled={busy || gfBlocked} onClick={finish}>{editing ? (busy ? 'Saving…' : 'Save') : <Go>Save my profile</Go>}</button>}>
      <Heading q="Do you have any dietary requirements or allergies?" help="Safety always comes first. Anything you mark here is never recommended to you." tip="We never recommend anything you mark here, in breakfasts, swaps or extras. If you add an allergy later, mornings you’ve already ordered are checked again." />
      <section className="card stack gap-16" style={{ padding: 20 }} aria-labelledby="dr">
        <h2 id="dr" className="h3 row" style={{ justifyContent: 'flex-start', gap: 12, fontSize: 18 }}><Icon name="leafy" size={20} stroke={1.6} />Dietary requirements</h2>
        <div className="chips">
          {DIETARY.map(d => <Chip key={d.id} on={dietary.includes(d.id)} onClick={() => toggle('dietary', d.id)}>{d.label}</Chip>)}
        </div>
        {gfBlocked && <div className="banner-warn" role="alert"><Icon name="alert" size={18} stroke={2} color="var(--warn)" style={{ flex: 'none' }} /><span>{GLUTEN_FREE_MESSAGE}</span></div>}
      </section>
      <section className="card stack gap-16" style={{ padding: 20 }} aria-labelledby="al">
        <h2 id="al" className="h3 row" style={{ justifyContent: 'flex-start', gap: 12, fontSize: 18 }}><Icon name="shield" size={20} stroke={1.6} />Allergies</h2>
        <div className="chips">
          {ALLERGENS.map(a => <Chip key={a.id} on={allergies.includes(a.id)} onClick={() => toggle('allergies', a.id)}>{a.label}</Chip>)}
        </div>
        <div className="field">
          <label htmlFor="oa">Other allergies <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
          <input id="oa" className="input" maxLength={120} placeholder="e.g. fish, shellfish, mustard" value={other}
            onChange={e => update(p => { p.otherAllergies = e.target.value; })} />
        </div>
      </section>
      {(hasData || consent) && (
        <section className="card stack gap-8" style={{ padding: 16, borderColor: asking ? 'var(--warn)' : undefined }} aria-label={CONSENT.healthTitle}>
          <label className="row" style={{ gap: 12, justifyContent: 'flex-start', alignItems: 'flex-start', cursor: 'pointer' }}>
            <input id="hc" type="checkbox" checked={consent} style={{ width: 22, height: 22, flex: 'none', marginTop: 1, accentColor: 'var(--espresso)' }}
              onChange={e => { setAsking(false); update(p => { p.healthConsent = e.target.checked; }); }} />
            <span style={{ fontSize: 15 }}>{CONSENT.healthShort}</span>
          </label>
          <span className="xs" style={{ paddingLeft: 34 }}>
            <Link to="/legal/privacy" className="link">Privacy Policy</Link>, <Link to="/legal/allergens" className="link">Allergen information</Link>
          </span>
        </section>
      )}
      {asking && (
        <div id="hc-ask" className="banner-warn" role="alert" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <span>Tick the box to save these details, or continue without them.</span>
          <button type="button" className="btn-secondary" onClick={withoutData}>Continue without saving them</button>
        </div>
      )}
      {safetyText && consent && (
        <div className="note" role="status" aria-live="polite">
          <Icon name="shield" size={22} stroke={1.6} style={{ flex: 'none' }} />
          <span>{safetyText}</span>
        </div>
      )}
      <SaveError>{error}</SaveError>
    </Frame>
  );
}
