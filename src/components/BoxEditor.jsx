import { useEffect, useRef, useState } from 'react';
import { Icon, IconButton, Option } from './ui.jsx';
import { hydrate, serialize, componentName, componentIcon, componentPortion } from '../domain/app.js';
import { swapOptions, applySwap, canSwap } from '../domain/engine.js';
import { useConfig } from '../state/config.js';

/* MB-BOX-001 §5: a Swap replaces one item with one eligible item from the same
   Swap Group, at the same price. There is no Remove and no build-your-own (§1, §7);
   extras are the Bread and Pastry add-ons on the next screen. */

/** Dialog behaviour: focus moves in, Escape (or phone Back) closes, focus returns. */
function useSheet(onClose) {
  const sheet = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    sheet.current?.querySelector('button')?.focus();
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); before?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return sheet;
}

/* ---------- Swap (style-1 P10) ---------- */
export function SwapSheet({ cfg, profile, index, onClose, onSwap }) {
  const current = cfg.components[index];
  const flavours = useConfig().danishFlavours || [];
  const options = offeredPastries(swapOptions(hydrate(cfg, profile), index), flavours);
  const [pick, setPick] = useState(current);
  const sheet = useSheet(onClose);
  const row = (id, isCurrent) => (
    <Option key={id} icon={componentIcon(id)} on={pick === id} title={componentName(id)} onClick={() => setPick(id)}>
      {componentPortion(id, cfg.size)}{isCurrent ? ' · current choice' : ''}
    </Option>
  );
  return (
    <div className="scrim" onClick={onClose}>
      <section ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-labelledby="swap-title" onClick={e => e.stopPropagation()}>
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

/** The items in a morning's box, each with Swap where an eligible alternative exists. `onChange` receives the new day configuration. */
export function BoxEditor({ cfg, profile, onChange }) {
  const [swapIndex, setSwapIndex] = useState(null);
  const flavours = useConfig().danishFlavours || [];
  const swappable = (id, i) => canSwap(id) && offeredPastries(swapOptions(hydrate(cfg, profile), i), flavours).length > 0;
  const swap = (index, altId) => {
    if (altId === cfg.components[index]) return;
    const h = hydrate(structuredClone(cfg), profile);
    if (!applySwap(h, index, altId).ok) return;
    onChange({ ...serialize(h, cfg.context, cfg.which), size: cfg.size, addons: cfg.addons, danishFlavour: cfg.danishFlavour });
  };

  return (
    <>
      <section className="card list" aria-label="In your box" style={{ padding: '6px 20px' }}>
        {cfg.components.map((id, i) => (
          <div key={id + i}>
          <div className="list-row" style={{ padding: '16px 0' }}>
            <span className="ci"><Icon name={componentIcon(id)} size={22} stroke={1.6} /></span>
            <span className="stack" style={{ gap: 2 }}><span style={{ fontSize: 17, fontWeight: 500 }}>{componentName(id)}</span><span className="sm" style={{ fontSize: 15 }}>{componentPortion(id, cfg.size)}</span></span>
            {swappable(id, i) && (
              <button type="button" className="swap-btn" onClick={() => setSwapIndex(i)} aria-label={`Swap ${componentName(id)}`}>
                <Icon name="swap" size={16} stroke={1.7} />Swap
              </button>
            )}
          </div>
          {id === 'fruitDanish' && flavours.length > 0 && <FlavourPicker value={flavours.includes(cfg.danishFlavour) ? cfg.danishFlavour : flavours[0]} flavours={flavours} onChange={f => onChange({ ...cfg, danishFlavour: f })} />}
          </div>
        ))}
      </section>

      {swapIndex !== null && (
        <SwapSheet cfg={cfg} profile={profile} index={swapIndex} onClose={() => setSwapIndex(null)}
          onSwap={altId => { swap(swapIndex, altId); setSwapIndex(null); }} />
      )}
    </>
  );
}

/* MB-PRO-001 §14.2: Fruit Danish comes in approved variants; only those a partner
   bakery can make are offered. Without any, Fruit Danish isn't offered as an add-on. */
export const offeredPastries = (items, flavours = []) => items.filter(id => id !== 'fruitDanish' || flavours.length > 0);
export function FlavourPicker({ value, flavours, onChange }) {
  return (
    <div className="chips" role="radiogroup" aria-label="Fruit Danish flavour" style={{ padding: '0 0 12px 58px' }}>
      {flavours.map(f => (
        <button key={f} type="button" role="radio" aria-checked={value === f} className={`chip${value === f ? ' on' : ''}`} onClick={() => onChange(f)}>{f}</button>
      ))}
    </div>
  );
}
