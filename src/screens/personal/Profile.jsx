import { useNavigate, useSearchParams } from 'react-router-dom';
import { Screen, TopBar, Option, Chip, Footer, Icon, Tick, SunArc, Go } from '../../components/ui.jsx';
import { useStore } from '../../state/store.jsx';
import { EATING_STYLES, PREFERENCES, DIETARY, ALLERGENS, allergyLabel, dietLabel } from '../../domain/app.js';

const EATING_ICON = { health: 'leafy', flexible: 'sunny' };
const EATING_TEXT = {
  health: 'Wholesome, balanced and less processed foods.',
  flexible: 'A wider variety — not specifically limited to health-focused choices.'
};
const PREF_ICON = { savory: 'egg', bakery: 'croissant', fresh: 'bowl', sweet: 'heart' };
const PREF_SHORT = {
  savory: 'Eggs, warm & hearty', bakery: 'Fresh bread, croissants',
  fresh: 'Yogurt, oats, fruit', sweet: 'Pastry, berries, honey'
};
const PREF_TITLE = { savory: 'Savory', bakery: 'Bakery & Pastry', fresh: 'Fresh & Wholesome', sweet: 'Sweet' };

/** Onboarding shows the sun-arc progress; editing from the profile returns there. */
function useStep(nextPath) {
  const [params] = useSearchParams();
  const editing = params.get('edit');
  const nav = useNavigate();
  const goNext = () => nav(editing ? (editing === 'plan' ? -1 : '/me') : nextPath);
  return { editing, goNext };
}

function Frame({ step, back, editing, children, footer }) {
  return (
    <Screen>
      <TopBar back={editing ? (editing === 'plan' ? -1 : '/me') : back} close={editing ? null : '/'}>
        <span className="topbar-title">{editing ? 'Edit Morning Profile' : `Your Morning Profile · ${step} of 3`}</span>
      </TopBar>
      {!editing && <div style={{ paddingTop: 8 }}><SunArc step={step} /></div>}
      <main className="screen-main" style={{ paddingTop: 28, gap: 24 }}>{children}</main>
      <Footer>{footer}</Footer>
    </Screen>
  );
}

function Heading({ q, help }) {
  return (
    <div className="stack gap-10">
      <h1 className="q">{q}</h1>
      {help && <p className="help" style={{ fontSize: 17 }}>{help}</p>}
    </div>
  );
}

export function EatingStyle() {
  const { state, set } = useStore();
  const { editing, goNext } = useStep('/profile/preferences');
  const value = state.profile.eatingStyle;
  return (
    <Frame step={1} back="/" editing={editing}
      footer={<button className="btn" disabled={!value} onClick={goNext}>{editing ? 'Save' : <Go>Continue</Go>}</button>}>
      <Heading q="How do you usually like to eat?" help="This shapes the version of breakfast we recommend. You can change it anytime." />
      <div className="stack gap-16" role="radiogroup" aria-label="Eating style">
        {EATING_STYLES.map(e => (
          <Option key={e.id} icon={EATING_ICON[e.id]} on={value === e.id} title={e.label}
            onClick={() => set(s => { s.profile.eatingStyle = e.id; })}>{EATING_TEXT[e.id]}</Option>
        ))}
      </div>
      <span className="hint"><Icon name="info" size={20} stroke={1.6} />A preference, not a medical classification.</span>
    </Frame>
  );
}

export function Preferences() {
  const { state, set } = useStore();
  const { editing, goNext } = useStep('/profile/dietary');
  const sel = state.profile.preferences;
  const toggle = id => set(s => {
    const p = s.profile.preferences;
    s.profile.preferences = p.includes(id) ? p.filter(x => x !== id) : [...p, id];
  });
  return (
    <Frame step={2} back="/profile/eating" editing={editing}
      footer={<button className="btn" disabled={!sel.length} onClick={goNext}>{editing ? 'Save' : <Go>Continue</Go>}</button>}>
      <Heading q="What kind of breakfast do you usually enjoy?" help="Choose as many as you like." />
      <div className="grid-2" style={{ gap: 14 }}>
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
      <p className="help" style={{ margin: 0, fontSize: 15.5 }}>
        {sel.length ? `${sel.length} selected · ` : ''}More choices give us more ways to match your morning.
      </p>
    </Frame>
  );
}

export function Dietary() {
  const { state, set } = useStore();
  const { editing, goNext } = useStep('/plan/dates');
  const { dietary, allergies } = state.profile;
  const toggle = (key, id) => set(s => {
    const a = s.profile[key];
    s.profile[key] = a.includes(id) ? a.filter(x => x !== id) : [...a, id];
  });
  const finish = () => { set(s => { s.profileDone = true; }); goNext(); };
  const safetyText = allergies.length
    ? `${allergies.map(a => allergyLabel(a).split(' /')[0]).join(', ')}-containing items will be filtered out of every recommendation, swap and extra.`
    : dietary.length ? `Only breakfasts that are ${dietary.map(d => dietLabel(d).toLowerCase()).join(' and ')} will be recommended.`
      : 'Nothing selected — that’s fine. You can add requirements anytime.';

  return (
    <Frame step={3} back="/profile/preferences" editing={editing}
      footer={<button className="btn" onClick={finish}>{editing ? 'Save' : <Go>Save my profile</Go>}</button>}>
      <Heading q="Any dietary requirements or allergies?" help="Safety always comes first — anything you mark here is never recommended to you." />
      <section className="card stack gap-16" style={{ padding: 20 }} aria-labelledby="dr">
        <h2 id="dr" className="h3 row" style={{ justifyContent: 'flex-start', gap: 12, fontSize: 18 }}><Icon name="leafy" size={20} stroke={1.6} />Dietary requirements</h2>
        <div className="chips">
          {DIETARY.map(d => <Chip key={d.id} on={dietary.includes(d.id)} onClick={() => toggle('dietary', d.id)}>{d.label}</Chip>)}
        </div>
      </section>
      <section className="card stack gap-16" style={{ padding: 20 }} aria-labelledby="al">
        <h2 id="al" className="h3 row" style={{ justifyContent: 'flex-start', gap: 12, fontSize: 18 }}><Icon name="shield" size={20} stroke={1.6} />Allergies</h2>
        <div className="chips">
          {ALLERGENS.map(a => <Chip key={a.id} on={allergies.includes(a.id)} onClick={() => toggle('allergies', a.id)}>{a.label}</Chip>)}
        </div>
      </section>
      <div className="note" role="status" aria-live="polite">
        <Icon name="shield" size={22} stroke={1.6} style={{ flex: 'none' }} />
        <span>{safetyText}</span>
      </div>
    </Frame>
  );
}
