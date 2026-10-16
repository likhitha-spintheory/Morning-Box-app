import { Link } from 'react-router-dom';
import { Icon } from '../components/ui.jsx';

/* Shared look for the partner screens (Bakery View, Courier View): Morning Box ivory,
   gold and espresso (MB-DSN-001 §3, §6). Layout only — each screen keeps its own logic. */

/** Branded sign-in card: the screen passes its own fields and button as children. */
export function StaffSignIn({ icon, eyebrow, title, help, children }) {
  return (
    <div className="staff-signin">
      <div className="staff-signin-card">
        <Link to="/" className="staff-back" aria-label="Back to Morning Box"><Icon name="back" size={20} stroke={1.8} /></Link>
        <span className="staff-mark"><Icon name={icon} size={26} stroke={1.6} /></span>
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="h-display" style={{ fontSize: 32 }}>{title}</h1>
        <p className="help">{help}</p>
        {children}
      </div>
    </div>
  );
}

/** Quiet progress line: done / current / upcoming steps. `current` is the index reached; `bad` marks it as a problem. */
export function Stepper({ steps, current, bad = false }) {
  return (
    <ol className="staff-steps" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className={i < current ? 'done' : i === current ? (bad ? 'bad' : 'now') : ''} aria-current={i === current ? 'step' : undefined}>
          <span className="staff-step-dot">{i < current ? <Icon name="check" size={12} stroke={2.4} /> : null}</span>
          <span className="staff-step-l">{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** Summary tile row used at the top of both screens. */
export function StaffTiles({ items }) {
  return (
    <div className="staff-tiles">
      {items.map(([icon, label, value, tone]) => (
        <div key={label} className={`staff-tile ${tone || ''}`}>
          <span className="staff-tile-ico"><Icon name={icon} size={18} stroke={1.8} /></span>
          <span className="staff-tile-n">{value}</span>
          <span className="staff-tile-l">{label}</span>
        </div>
      ))}
    </div>
  );
}
