/* Admin → Menu rules: the data the recommendation engine uses.
   Food items (allergens, suitable for, Flexible only), the 32 breakfasts and
   what is inside each one, and the priority order per Morning Type.
   Saved changes apply to the next recommendation (MB-PRO-001 §12, §15.1; MB-REC-001 §7). */
import { useEffect, useMemo, useState } from 'react';
import { autoPriceLevel, LEVEL_IDS } from '../domain/recipes.js';
import { PRICE_LEVELS } from '../domain/standards.js';

const Field = ({ label, children }) => <div className="field" style={{ gap: 6 }}><label>{label}</label>{children}</div>;
const STYLES = { health: 'Health-Conscious', flexible: 'Flexible' };
const toggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

function Chips({ options, value, onChange, label }) {
  return (
    <div className="chips" role="group" aria-label={label} style={{ gap: 6 }}>
      {options.map(o => (
        <button key={o.id} type="button" className={`chip${value.includes(o.id) ? ' on' : ''}`} aria-pressed={value.includes(o.id)}
          style={{ minHeight: 32, padding: '0 10px', fontSize: 13 }} onClick={() => onChange(toggle(value, o.id))}>
          {value.includes(o.id) ? '✓ ' : ''}{o.label.split(' /')[0]}
        </button>
      ))}
    </div>
  );
}

export function MenuRules({ data, act, busy, call }) {
  const [m, setM] = useState(() => structuredClone(data.menu));
  useEffect(() => setM(structuredClone(data.menu)), [data]);
  const [section, setSection] = useState('items');
  const [notice, setNotice] = useState('');
  const dirty = useMemo(() => JSON.stringify(m) !== JSON.stringify(data.menu), [m, data.menu]);
  const { lists } = data;
  const name = id => m.items[id]?.name || id;
  const prefLabel = id => lists.preferences.find(p => p.id === id)?.label || id;
  const ctxLabel = id => lists.contexts.find(c => c.id === id)?.label || id;

  const setItem = (id, patch) => setM(x => ({ ...x, items: { ...x.items, [id]: { ...x.items[id], ...patch } } }));
  const setBreakfast = (id, patch) => setM(x => ({ ...x, breakfasts: { ...x.breakfasts, [id]: { ...x.breakfasts[id], ...patch } } }));
  const save = async () => { setNotice(''); if (await act('PUT', '/admin/menu', m)) setNotice('Saved. New recommendations use these rules now.'); };
  const reset = async () => {
    if (!window.confirm('Reset every food item, breakfast and priority to the approved menu? Items you added are removed.')) return;
    if (await act('POST', '/admin/menu/reset')) setNotice('Back to the approved menu.');
  };

  return (
    <section className="stack gap-16">
      <div className="card stack gap-8" style={{ padding: 18 }}>
        <h2 className="h3">Menu rules</h2>
        <span className="xs">The recommendation is a fixed set of rules: it finds the breakfasts that match the customer’s Eating Style, Morning Type and preferences,
          removes anything unsafe for their allergies or diet (using an approved replacement where one exists), and ranks what is left by the priority below.
          Changes here apply to the next recommendation. Orders already placed keep their breakfast.</span>
        <div className="row" style={{ gap: 10, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          {[['items', 'Food items'], ['breakfasts', 'Breakfasts (32)'], ['priority', 'Priority order'], ['try', 'Try it'], ['history', 'Change history']].map(([id, label]) => (
            <button key={id} type="button" className={`chip${section === id ? ' on' : ''}`} aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>
          ))}
        </div>
        {notice && !dirty && <span className="tag" role="status">{notice}</span>}
      </div>

      {section === 'items' && <Items m={m} lists={lists} setItem={setItem} setM={setM} />}
      {section === 'breakfasts' && <Breakfasts m={m} lists={lists} name={name} prefLabel={prefLabel} ctxLabel={ctxLabel} setBreakfast={setBreakfast} />}
      {section === 'priority' && <Priority m={m} lists={lists} prefLabel={prefLabel} ctxLabel={ctxLabel} setM={setM} />}
      {section === 'try' && <TryIt lists={lists} call={call} name={name} dirty={dirty} />}
      {section === 'history' && (
        <div className="card stack gap-8" style={{ padding: 18 }}>
          {data.history.length === 0 && <span className="xs">No changes yet — the approved menu is in use.</span>}
          {data.history.map((h, i) => <div key={i} className="stack gap-4"><span className="strong xs">{h.at}</span>{h.changes.map((c, k) => <span key={k} className="xs">· {c}</span>)}</div>)}
        </div>
      )}

      {section !== 'try' && section !== 'history' && (
        <div className="row no-print" style={{ gap: 10, position: 'sticky', bottom: 0, background: 'var(--ivory)', padding: '12px 0' }}>
          <button type="button" className="btn" style={{ maxWidth: 260 }} disabled={busy || !dirty} onClick={save}>{dirty ? 'Save menu rules' : 'No unsaved changes'}</button>
          {dirty && <button type="button" className="btn-text" onClick={() => setM(structuredClone(data.menu))}>Discard changes</button>}
          <button type="button" className="btn-text" disabled={busy} onClick={reset}>Reset to approved menu</button>
        </div>
      )}
    </section>
  );
}

function Items({ m, lists, setItem, setM }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(null);
  const ids = Object.keys(m.items).filter(id => !q || m.items[id].name.toLowerCase().includes(q.toLowerCase()) || m.items[id].category.toLowerCase().includes(q.toLowerCase()));
  const usedIn = id => Object.entries(m.breakfasts).filter(([, b]) => b.components.includes(id)).length;
  const blank = { name: '', category: lists.categories[0], portions: { light: '', regular: '', large: '' }, allergens: [], diet: [], flexibleOnly: false, swapGroup: '', note: '' };
  const add = () => {
    /* Saved with a temporary key; the server gives it its id when the menu is saved. */
    setM(x => ({ ...x, items: { ...x.items, [`new${Date.now()}`]: { ...adding, custom: true } } }));
    setAdding(null);
  };
  return (
    <div className="stack gap-12">
      <div className="row" style={{ gap: 10 }}>
        <input className="input" placeholder="Search items or categories" value={q} onChange={e => setQ(e.target.value)} aria-label="Search items" style={{ maxWidth: 320, minHeight: 44 }} />
        {!adding && <button type="button" className="btn-secondary" style={{ width: 'auto' }} onClick={() => setAdding(blank)}>Add a food item</button>}
      </div>
      {adding && (
        <div className="card stack gap-12" style={{ padding: 18 }}>
          <h3 className="h3">New food item</h3>
          <span className="xs">Every item needs a verified ingredient and allergen record before it is used (MB-PRO-001 §15.1). Add it to a breakfast afterwards.</span>
          <div className="grid-2">
            <Field label="Name"><input className="input" value={adding.name} onChange={e => setAdding({ ...adding, name: e.target.value })} /></Field>
            <Field label="Category"><select className="input" value={adding.category} onChange={e => setAdding({ ...adding, category: e.target.value })}>{lists.categories.map(c => <option key={c}>{c}</option>)}</select></Field>
            {['light', 'regular', 'large'].map(s => <Field key={s} label={`${s[0].toUpperCase()}${s.slice(1)} portion`}><input className="input" placeholder="e.g. 60 g" value={adding.portions[s]} onChange={e => setAdding({ ...adding, portions: { ...adding.portions, [s]: e.target.value } })} /></Field>)}
            <Field label="Swap group (optional)"><select className="input" value={adding.swapGroup} onChange={e => setAdding({ ...adding, swapGroup: e.target.value })}><option value="">No swap</option>{lists.swapGroups.map(g => <option key={g}>{g}</option>)}</select></Field>
          </div>
          <Field label="Contains allergens"><Chips options={lists.allergens} value={adding.allergens} onChange={v => setAdding({ ...adding, allergens: v })} label="Allergens" /></Field>
          <Field label="Suitable for"><Chips options={lists.dietary} value={adding.diet} onChange={v => setAdding({ ...adding, diet: v })} label="Suitable for" /></Field>
          <label className="row xs" style={{ gap: 8, justifyContent: 'flex-start' }}><input type="checkbox" checked={adding.flexibleOnly} onChange={e => setAdding({ ...adding, flexibleOnly: e.target.checked })} /> Flexible only (never for Health-Conscious)</label>
          <div className="row" style={{ gap: 10, justifyContent: 'flex-start' }}>
            <button type="button" className="btn" style={{ maxWidth: 220 }} disabled={adding.name.trim().length < 2} onClick={add}>Add to list</button>
            <button type="button" className="btn-text" onClick={() => setAdding(null)}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="ops-table">
          <thead><tr><th>Item</th><th>Category · portions (L / R / L)</th><th>Contains allergens</th><th>Suitable for</th><th>Flexible only</th><th>Used in</th></tr></thead>
          <tbody>{ids.map(id => {
            const it = m.items[id];
            return (
              <tr key={id}>
                <td style={{ minWidth: 180 }}><input className="input" style={{ minHeight: 40 }} aria-label="Item name" value={it.name} onChange={e => setItem(id, { name: e.target.value })} />
                  {it.custom && <span className="xs"> Added in Admin{!usedIn(id) && <> · <button type="button" className="btn-text" onClick={() => setM(x => { const items = { ...x.items }; delete items[id]; return { ...x, items }; })}>Remove</button></>}</span>}</td>
                <td className="xs">{it.category}<br />{it.portions.light} / {it.portions.regular} / {it.portions.large}</td>
                <td style={{ minWidth: 220 }}><Chips options={lists.allergens} value={it.allergens} onChange={v => setItem(id, { allergens: v })} label={`Allergens in ${it.name}`} /></td>
                <td style={{ minWidth: 220 }}><Chips options={lists.dietary} value={it.diet} onChange={v => setItem(id, { diet: v })} label={`${it.name} is suitable for`} /></td>
                <td><input type="checkbox" aria-label={`${it.name} is Flexible only`} checked={it.flexibleOnly} onChange={e => setItem(id, { flexibleOnly: e.target.checked })} /></td>
                <td className="xs">{usedIn(id)} breakfast{usedIn(id) === 1 ? '' : 's'}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

function Breakfasts({ m, lists, name, prefLabel, ctxLabel, setBreakfast }) {
  const [pref, setPref] = useState('all');
  const ids = Object.keys(m.breakfasts).filter(id => pref === 'all' || id.startsWith(`${pref}.`));
  const itemIds = Object.keys(m.items).sort((a, b) => name(a).localeCompare(name(b)));
  return (
    <div className="stack gap-12">
      <div className="row" style={{ gap: 8, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        {[{ id: 'all', label: 'All' }, ...lists.preferences].map(p => <button key={p.id} type="button" className={`chip${pref === p.id ? ' on' : ''}`} aria-pressed={pref === p.id} onClick={() => setPref(p.id)}>{p.label}</button>)}
      </div>
      <span className="xs">Portions are set per item; these are the Regular-size compositions. Health-Conscious breakfasts can’t contain Flexible-only items.
        Price level: Auto follows the composition (items plus pastry, protein and cheese); choose L1–L4 to set it. Level prices are set in Admin → Pricing and are never shown to customers.</span>
      <div style={{ overflowX: 'auto' }}>
        <table className="ops-table">
          <thead><tr><th>Breakfast</th><th>What’s inside</th><th>Format note</th><th>Price level</th></tr></thead>
          <tbody>{ids.map(id => {
            const [p, style, ctx] = id.split('.');
            const b = m.breakfasts[id];
            const blocked = x => style === 'health' && m.items[x]?.flexibleOnly;
            const auto = autoPriceLevel(b.components, x => m.items[x]?.category);
            const level = b.level || auto;
            return (
              <tr key={id}>
                <td className="xs" style={{ minWidth: 170 }}><b>{prefLabel(p)}</b><br />{STYLES[style]} · {ctxLabel(ctx)}</td>
                <td style={{ minWidth: 320 }}>
                  <div className="chips" style={{ gap: 6 }}>
                    {b.components.map((x, i) => (
                      <span key={x} className={`tag${blocked(x) ? ' warn' : ' light'}`}>
                        {i > 0 && <button type="button" className="btn-text" aria-label={`Move ${name(x)} earlier`} onClick={() => { const c = [...b.components]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; setBreakfast(id, { components: c }); }}>‹</button>}
                        {name(x)}{blocked(x) ? ' (Flexible only!)' : ''}
                        {b.components.length > 1 && <button type="button" className="btn-text" aria-label={`Remove ${name(x)}`} onClick={() => setBreakfast(id, { components: b.components.filter(y => y !== x) })}>×</button>}
                      </span>
                    ))}
                    {b.components.length < 6 && (
                      <select className="input" style={{ minHeight: 36, width: 170 }} value="" aria-label="Add an item" onChange={e => e.target.value && setBreakfast(id, { components: [...b.components, e.target.value] })}>
                        <option value="">+ Add item</option>
                        {itemIds.filter(x => !b.components.includes(x) && !blocked(x)).map(x => <option key={x} value={x}>{name(x)}</option>)}
                      </select>
                    )}
                  </div>
                </td>
                <td style={{ minWidth: 200 }}><input className="input" style={{ minHeight: 40 }} aria-label="Format note" placeholder="e.g. Ready-to-eat sandwich" value={b.format} onChange={e => setBreakfast(id, { format: e.target.value })} /></td>
                <td style={{ minWidth: 150 }}>
                  <select className="input" style={{ minHeight: 40 }} aria-label="Price level" value={b.level || ''} onChange={e => setBreakfast(id, { level: e.target.value })}>
                    <option value="">Auto ({auto})</option>
                    {LEVEL_IDS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <span className="xs">{level} · AED {PRICE_LEVELS[level]} Regular{b.level ? '' : ' (auto)'}</span>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

function Priority({ m, lists, prefLabel, ctxLabel, setM }) {
  const move = (ctx, i, d) => setM(x => {
    const list = [...x.priority[ctx]];
    [list[i], list[i + d]] = [list[i + d], list[i]];
    return { ...x, priority: { ...x.priority, [ctx]: list } };
  });
  return (
    <div className="card stack gap-12" style={{ padding: 18 }}>
      <span className="xs">Used only to break a tie when the customer likes more than one preference and more than one breakfast is safe for them (MB-REC-001 §7). 1st becomes “Your Morning Box”, the next “Another Option”.</span>
      <table className="ops-table">
        <thead><tr><th>Morning Type</th><th>1st</th><th>2nd</th><th>3rd</th><th>4th</th></tr></thead>
        <tbody>{lists.contexts.map(c => (
          <tr key={c.id}>
            <td className="strong">{ctxLabel(c.id)}</td>
            {m.priority[c.id].map((p, i) => (
              <td key={p}><span className="row" style={{ gap: 4, justifyContent: 'flex-start' }}>
                {i > 0 && <button type="button" className="btn-text" aria-label={`Move ${prefLabel(p)} up for ${ctxLabel(c.id)}`} onClick={() => move(c.id, i, -1)}>‹</button>}
                <span className="xs">{prefLabel(p)}</span>
                {i < 3 && <button type="button" className="btn-text" aria-label={`Move ${prefLabel(p)} down for ${ctxLabel(c.id)}`} onClick={() => move(c.id, i, 1)}>›</button>}
              </span></td>
            ))}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function TryIt({ lists, call, name, dirty }) {
  const [p, setP] = useState({ eatingStyle: 'health', preferences: ['savory'], dietary: [], allergies: [], context: 'busy' });
  const [r, setR] = useState(null);
  const [err, setErr] = useState('');
  const run = async () => { setErr(''); try { setR(await call('POST', '/admin/menu/try', p)); } catch (e) { setErr(e.message); setR(null); } };
  const box = x => x && <><b>{(x.names || x.components.map(name)).join(' + ')}</b> <span className="xs">({x.recipeId})</span></>;
  return (
    <div className="card stack gap-12" style={{ padding: 18 }}>
      <span className="xs">See what a customer would be recommended with the saved rules.{dirty ? ' Save your changes first to try them.' : ''}</span>
      <Field label="Eating style"><Chips options={Object.entries(STYLES).map(([id, label]) => ({ id, label }))} value={[p.eatingStyle]} onChange={v => setP({ ...p, eatingStyle: v.at(-1) || p.eatingStyle })} label="Eating style" /></Field>
      <Field label="Likes"><Chips options={lists.preferences} value={p.preferences} onChange={v => setP({ ...p, preferences: v })} label="Preferences" /></Field>
      <Field label="Dietary"><Chips options={lists.dietary} value={p.dietary} onChange={v => setP({ ...p, dietary: v })} label="Dietary" /></Field>
      <Field label="Allergies"><Chips options={lists.allergens} value={p.allergies} onChange={v => setP({ ...p, allergies: v })} label="Allergies" /></Field>
      <Field label="Morning type"><Chips options={lists.contexts} value={[p.context]} onChange={v => setP({ ...p, context: v.at(-1) || p.context })} label="Morning type" /></Field>
      <button type="button" className="btn" style={{ maxWidth: 220 }} disabled={!p.preferences.length} onClick={run}>Show recommendation</button>
      {err && <span className="tag warn" role="alert">{err}</span>}
      {r && (r.primary
        ? <div className="stack gap-6"><span>Your Morning Box: {box(r.primary)}</span><span>Another Option: {r.alternative ? box(r.alternative) : <span className="xs">none — only one safe breakfast matches</span>}</span>
          {r.rejected?.length > 0 && <span className="xs">Removed as unsafe for this profile: {r.rejected.join(', ')}</span>}</div>
        : <span className="tag warn">{r.message}</span>)}
    </div>
  );
}
