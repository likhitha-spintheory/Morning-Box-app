/* Launch discounts at review (personal and business): the discount lines of the order summary,
   and the promo code field. Prices come from src/domain/discounts.js, the same code the server charges with. */
import { useState } from 'react';
import { post } from '../api.js';
import { Icon } from './ui.jsx';
import { discountSummary } from '../domain/discounts.js';

/** Green "− AED" lines for each kind of discount in the order, then nothing if there are none. */
export function DiscountLines({ days }) {
  const lines = discountSummary(days);
  return lines.map(l => (
    <div key={l.label} className="sr" style={{ color: 'var(--ok)' }}><span>{l.label}</span><span className="money">− AED {l.amount}</span></div>
  ));
}

/** "You save AED X" under the total, when the order has any discount. */
export function Savings({ amount }) {
  if (!(amount > 0)) return null;
  return <span className="xs" style={{ color: 'var(--ok)', fontWeight: 600 }}>You save AED {amount} on this order.</span>;
}

/**
 * Promo code entry. `promo` is the checked code (or null); `result` is priceOrder()'s `.promo`
 * (whether the code lowered the price, and why not).
 */
export function PromoField({ kind, promo, onChange, result }) {
  const [open, setOpen] = useState(!!promo);
  const [code, setCode] = useState(promo?.code || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const apply = async () => {
    if (!code.trim()) return;
    setBusy(true); setError('');
    try { const r = await post('/promo/check', { code, kind }); onChange(r.promo); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  if (promo) {
    return (
      <div className="stack gap-4">
        <div className="row" style={{ gap: 12 }}>
          <span className="row" style={{ gap: 8, justifyContent: 'flex-start', minWidth: 0 }}>
            <Icon name="check" size={16} stroke={2.2} style={{ flex: 'none', color: result?.applied ? 'var(--ok)' : 'var(--text-3)' }} />
            <span className="strong" style={{ overflowWrap: 'anywhere' }}>Promo code {promo.code}</span>
          </span>
          <button type="button" className="btn-text" onClick={() => { onChange(null); setCode(''); }}>Remove</button>
        </div>
        {result && !result.applied && result.reason && <span className="help" style={{ fontSize: 14.5 }}>{result.reason}</span>}
      </div>
    );
  }
  if (!open) return <button type="button" className="link" style={{ alignSelf: 'flex-start', padding: '6px 0' }} onClick={() => setOpen(true)}>Have a promo code?</button>;
  return (
    <div className="field">
      <label htmlFor={`promo-${kind}`}>Promo code</label>
      <div className="row" style={{ gap: 10 }}>
        <input id={`promo-${kind}`} className={`input${error ? ' invalid' : ''}`} style={{ flex: 1, minWidth: 0, textTransform: 'uppercase' }} autoCapitalize="characters" autoComplete="off" spellCheck={false}
          maxLength={24} value={code} onChange={e => { setCode(e.target.value); setError(''); }} onKeyDown={e => { if (e.key === 'Enter') apply(); }} />
        <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '0 20px', flex: 'none' }} disabled={busy || !code.trim()} onClick={apply}>{busy ? 'Checking…' : 'Apply'}</button>
      </div>
      {error && <span className="err-msg"><Icon name="alert" size={14} stroke={2.2} />{error}</span>}
    </div>
  );
}
