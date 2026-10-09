import { useNavigate, useSearchParams } from 'react-router-dom';
import { Screen, TopBar, Progress, Option, Chip, Footer, Icon, Tick, Note } from '../../components/ui.jsx';
import { useStore } from '../../state/store.jsx';
import { EATING_STYLES, PREFERENCES, DIETARY, ALLERGENS } from '../../domain/app.js';

const PREF_ICON = { savory: 'egg', bakery: 'croissant', fresh: 'bowl', sweet: 'drop' };
const PREF_SHORT = {
  savory: 'Eggs, bread, fresh vegetables', bakery: 'Fresh bread, croissants, spreads',
  fresh: 'Yogurt, oats, granola, fruit', sweet: 'Pastry, berries, honey'
};

/** Shared frame: onboarding shows progress; editing from the profile returns there. */
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
        <span className="topbar-title">{editing ? 'Edit Morning Profile' : `Step ${step} of 5`}</span>
      </TopBar>
      {!editing && <Progress step={step} />}
      <main className="screen-main" style={{ paddingTop: 28 }}>{children}</main>
      <Footer>{footer}</Footer>
    </Screen>
  );
}

function Heading({ q, help }) {
  return (
    <div className="stack gap-10">
      <span className="eyebrow">Your Morning Profile</span>
      <h1 className="q">{q}</h1>
      {help && <p className="help">{help}</p>}
    </div>
  );
}

export function EatingStyle() {
  const { state, set } = useStore();
  const { editing, goNext } = useStep('/profile/preferences');
  const value = state.profile.eatingStyle;
  return (
    <Frame step={1} back="/" editing={editing}
      footer={<button className="btn" disabled={!value} onClick={goNext}>{editing ? 'Save' : 'Continue'}</button>}>
      <Heading q="How do you usually like to eat?" help="This shapes the version of each breakfast we recommend. You can change it any time." />
      <div className="stack gap-12" role="radiogroup" aria-label="Eating style">
        {EATING_STYLES.map(e => (
          <Option key={e.id} on={value === e.id} title={e.label}
            onClick={() => set(s => { s.profile.eatingStyle = e.id; })}>{e.blurb}</Option>
        ))}
      </div>
      <p className="sm" style={{ margin: 0 }}>Not a medical classification — just how you like to eat.</p>
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
      footer={<button className="btn" disabled={!sel.length} onClick={goNext}>{editing ? 'Save' : 'Continue'}</button>}>
      <Heading q="What kind of breakfast do you usually enjoy?" help="Choose as many as you like." />
      <div className="grid-2">
        {PREFERENCES.map(p => {
          const on = sel.includes(p.id);
          return (
            <button key={p.id} type="button" className={`tile${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggle(p.id)}>
              <Tick on={on} square />
              <span className="ico"><Icon name={PREF_ICON[p.id]} size={22} stroke={1.6} /></span>
              <span className="stack gap-4"><span className="strong">{p.label}</span><span className="sm">{PREF_SHORT[p.id]}</span></span>
            </button>
          );
        })}
      </div>
      <p className="sm" style={{ margin: 0 }}>
        {sel.length ? <><b className="strong">{sel.length} selected.</b> </> : null}
        More choices widen your recommendations — they never mix into one breakfast.
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
  return (
    <Frame step={3} back="/profile/preferences" editing={editing}
      footer={<button className="btn" onClick={finish}>{editing ? 'Save' : (dietary.length || allergies.length ? 'Continue' : 'None of these — continue')}</button>}>
      <Heading q="Do you have any dietary requirements or allergies?" help="Select all that apply. Leave both empty if none." />
      <section className="card stack gap-12" aria-labelledby="dr">
        <div className="stack"><h2 id="dr" className="h3">Dietary requirements</h2><span className="sm">How you eat, every morning.</span></div>
        <div className="chips">
          {DIETARY.map(d => <Chip key={d.id} on={dietary.includes(d.id)} onClick={() => toggle('dietary', d.id)}>{d.label}</Chip>)}
        </div>
      </section>
      <section className="card stack gap-12" aria-labelledby="al">
        <div className="stack"><h2 id="al" className="h3">Allergies</h2><span className="sm">Never included in your breakfast, swaps or extras.</span></div>
        <div className="chips">
          {ALLERGENS.map(a => <Chip key={a.id} on={allergies.includes(a.id)} onClick={() => toggle('allergies', a.id)}>{a.label}</Chip>)}
        </div>
      </section>
      <Note icon="shield">Safety always comes first. Your allergies override every preference, and Gluten-Free orders go only to bakeries certified to handle them.</Note>
    </Frame>
  );
}
