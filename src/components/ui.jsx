import { Link, useNavigate } from 'react-router-dom';

const PATHS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  swap: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  shieldAlert: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M12 8v5M12 16v.5"/>',
  brief: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>',
  sun: '<circle cx="12" cy="14" r="4"/><path d="M12 4v2M4.9 7l1.4 1.4M19.1 7l-1.4 1.4M3 20h18"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  busy: '<circle cx="13" cy="13" r="8"/><path d="M13 9v4l2.5 1.5M2 9h4M1 13h4M2 17h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  heart: '<path d="M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9z"/>',
  meh: '<circle cx="12" cy="12" r="9"/><path d="M8.5 15.5c1-1 2.2-1.5 3.5-1.5s2.5.5 3.5 1.5M9 10h.01M15 10h.01"/>',
  box: '<path d="M3 9l9-4 9 4-9 4z"/><path d="M3 9v7l9 4 9-4V9"/>',
  repeat: '<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v4h4"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  coffee: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3M12 3v3"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h4"/>',
  egg: '<ellipse cx="12" cy="13" rx="8" ry="6"/><circle cx="12" cy="13" r="2.6"/>',
  bread: '<path d="M5 10a4 4 0 0 1 3-6h8a4 4 0 0 1 3 6v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/>',
  avocado: '<path d="M12 3c3 0 6 5 6 10a6 6 0 0 1-12 0c0-5 3-10 6-10z"/><circle cx="12" cy="14" r="2.5"/>',
  tomato: '<circle cx="12" cy="13" r="7"/><path d="M9 5l3 2 3-2M12 7V4"/>',
  bowl: '<path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M12 4c0 3 2 4 4 4M12 4c0 3-2 4-4 4"/>',
  drop: '<path d="M12 20c-4 0-7-3-7-7 0-3 2-6 7-9 5 3 7 6 7 9 0 4-3 7-7 7z"/><path d="M12 9v6"/>',
  croissant: '<path d="M3 15c2-6 6-9 9-9s7 3 9 9c-3 2-6 3-9 3s-6-1-9-3z"/><path d="M9 8l1.5 9M15 8l-1.5 9"/>',
  fruit: '<circle cx="12" cy="14" r="6"/><path d="M12 8c0-3 2-5 4-5M12 8c-1-2-3-3-5-2"/>',
  cheese: '<path d="M3 17l9-11 9 6v5z"/><circle cx="10" cy="14" r="1"/><circle cx="15" cy="15" r="1"/>',
  jar: '<rect x="6" y="7" width="12" height="14" rx="3"/><path d="M8 3h8v4H8z"/>',
  sausage: '<rect x="3" y="9" width="18" height="6" rx="3"/>',
  leaf: '<path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z"/><path d="M5 19l8-8"/>',
  truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  home: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  leafy: '<path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z"/><path d="M5 19l7-7"/>',
  sunny: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  sunrise: '<path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 7v3M5.6 11.6l1.6 1.6M18.4 11.6l-1.6 1.6M2 18h1M21 18h1"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16v4M17 18h4"/>',
  apple: '<path d="M16 3c-1.5.2-3 1.3-3.3 3 1.6.1 3-.9 3.3-3z"/><path d="M12 7c-1.2 0-2-.6-3.2-.6C6.6 6.4 5 8.3 5 11c0 4 2.6 9 4.6 9 1 0 1.4-.6 2.4-.6s1.3.6 2.4.6c1.6 0 3.3-3.2 3.9-5-1.8-.8-2.6-2.4-2.6-4 0-1.5.8-2.8 2-3.4-.8-1.1-2-1.6-3.2-1.6C13.6 6 13 7 12 7z"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'
};

export function Icon({ name, size = 20, stroke = 1.7, color = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}
      dangerouslySetInnerHTML={{ __html: PATHS[name] || '' }} />
  );
}

/** The approved logo, cropped to its mark with clear space; never redrawn. */
export function Logo({ width = 122, to = '/' }) {
  const s = width / 1140;
  return (
    <Link to={to} className="logo" aria-label="Morning Box home" style={{ width, height: Math.round(575 * s) }}>
      <img src="./assets/morningbox-logo.png" alt="Morning Box"
        style={{ width: 1536 * s, marginLeft: -165 * s, marginTop: -230 * s }} />
    </Link>
  );
}

export function IconButton({ icon, label, to, onClick }) {
  const nav = useNavigate();
  return (
    <button type="button" className="icon-btn" aria-label={label}
      onClick={onClick || (() => (to === -1 ? nav(-1) : nav(to)))}>
      <Icon name={icon} size={icon === 'close' ? 18 : 20} stroke={1.8} />
    </button>
  );
}

export function TopBar({ back, close = '/', title, children }) {
  return (
    <header className="topbar">
      {back !== undefined ? <IconButton icon="back" label="Back" to={back} /> : <span style={{ width: 44 }} />}
      {children || <span className="topbar-title">{title}</span>}
      {close ? <IconButton icon="close" label="Close" to={close} /> : <span style={{ width: 44 }} />}
    </header>
  );
}

export function Progress({ step, total = 5 }) {
  return (
    <div className="progress" aria-label={`Step ${step} of ${total}`} role="img">
      {Array.from({ length: total }, (_, i) =>
        <i key={i} className={i + 1 < step ? 'done' : i + 1 === step ? 'current' : ''} />)}
    </div>
  );
}

export function Tick({ on, square }) {
  return <span className={`tick${square ? ' square' : ''}${on ? ' on' : ''}`}>{on && <Icon name="check" size={15} stroke={2.2} />}</span>;
}

export function Option({ on, onClick, icon, title, children, role = 'radio', square }) {
  return (
    <button type="button" className={`option${on ? ' on' : ''}`} role={role} aria-checked={on} onClick={onClick}>
      {icon && <span className="ico"><Icon name={icon} size={24} stroke={1.6} /></span>}
      <span className="stack" style={{ gap: 3, flex: 1 }}>
        <span style={{ fontWeight: 600, fontSize: 18, lineHeight: 1.3 }}>{title}</span>
        {children && <span className="help" style={{ fontSize: 15.5, lineHeight: 1.45 }}>{children}</span>}
      </span>
      <Tick on={on} square={square} />
    </button>
  );
}

export function Chip({ on, onClick, children, disabled }) {
  return (
    <button type="button" className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick} disabled={disabled}>
      {on && <Icon name="check" size={14} stroke={3} />}{children}
    </button>
  );
}

export function Qty({ value, onChange, min = 0, max = 99, label = 'quantity' }) {
  return (
    <span className={`qty${value > 0 ? ' on' : ''}`}>
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}><Icon name="minus" size={16} stroke={2} /></button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}><Icon name="plus" size={16} stroke={2} /></button>
    </span>
  );
}

export function Switch({ checked, onChange, label }) {
  return <button type="button" className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

export function Money({ value, className = '' }) {
  return <span className={`money ${className}`}>AED {Math.round(value).toLocaleString('en-AE')}</span>;
}

export function Footer({ children, split, sheet }) {
  return <div className={`footer${split ? ' split' : ''}${sheet ? ' sheet' : ''}`}>{children}</div>;
}

export function Screen({ children }) {
  return <div className="screen">{children}</div>;
}

export function MorningPills({ dates, active, done = [] }) {
  return (
    <div className="mpills">
      {dates.map(d => (
        <span key={d.iso} className={`mpill${d.iso === active ? ' on' : done.includes(d.iso) ? ' done' : ''}`}>
          {done.includes(d.iso) && d.iso !== active && <Icon name="check" size={15} stroke={2.2} />}{d.label}
        </span>
      ))}
    </div>
  );
}

export function Note({ icon = 'info', children }) {
  return (
    <div className="note">
      <Icon name={icon} size={20} stroke={1.7} color="#7A5A14" style={{ flex: 'none', marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

export function TabBar({ active }) {
  const tabs = [['/today', 'home', 'Today'], ['/start', 'cal', 'Plan'], ['/orders', 'box', 'Orders'], ['/me', 'user', 'Profile']];
  return (
    <nav className="tabbar" aria-label="Primary">
      {tabs.map(([to, icon, label]) => (
        <Link key={to} to={to} className={active === to ? 'active' : ''} aria-current={active === to ? 'page' : undefined}>
          <Icon name={icon} size={24} stroke={1.6} /><span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** Primary label with trailing arrow, as in the approved style. */
export function Go({ children }) {
  return <>{children}<Icon name="arrow" size={20} stroke={1.8} /></>;
}

/** Morning Profile progress: the sun rises along an arc across the three questions. */
export function SunArc({ step, labels = ['Eating style', 'Preferences', 'Dietary & allergies'] }) {
  const pts = [[60, 74], [270, 38], [470, 64]];
  const [sx, sy] = pts[step - 1];
  const solid = step === 1 ? `M30 82 L${sx} ${sy}` : step === 2 ? `M30 82 Q150 40 ${sx} ${sy}` : `M30 82 Q150 40 270 38 Q400 38 ${sx} ${sy}`;
  const rays = [0, 1, 2, 3, 4, 5, 6].map(i => {
    const a = Math.PI * (0.95 + i * 0.185);
    return <line key={i} x1={sx + 17 * Math.cos(a)} y1={sy + 17 * Math.sin(a)} x2={sx + 24 * Math.cos(a)} y2={sy + 24 * Math.sin(a)} stroke="#D99A12" strokeWidth="2.6" strokeLinecap="round" />;
  });
  return (
    <div className="sunarc" aria-hidden="true">
      <svg viewBox="0 0 520 96">
        <line x1="0" y1="92" x2="520" y2="92" stroke="#EADCC1" strokeWidth="1.5" />
        <path d="M30 82 Q150 40 270 38 Q400 38 500 84" fill="none" stroke="#E6D3AE" strokeWidth="2.5" strokeDasharray="2 7" strokeLinecap="round" />
        <path d={solid} fill="none" stroke="#D99A12" strokeWidth="3.5" strokeLinecap="round" />
        {rays}
        <circle cx={sx} cy={sy} r="11" fill="#D99A12" />
      </svg>
      <div className="sunarc-labels">
        {labels.map((l, i) => <span key={l} className={i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}>{l}</span>)}
      </div>
    </div>
  );
}

/** Small countdown ring (e.g. hours left until the 9:00 PM cutoff). */
export function Ring({ fraction, label, size = 40 }) {
  const r = size / 2 - 3, c = 2 * Math.PI * r;
  return (
    <span className="ring" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F1E3C6" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#D99A12" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${c * Math.max(0, Math.min(1, fraction))} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span>{label}</span>
    </span>
  );
}

export function UaeFlag() {
  return (
    <svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true" style={{ borderRadius: 3, flex: 'none' }}>
      <rect width="26" height="6" fill="#00732F" /><rect y="6" width="26" height="6" fill="#FFFFFF" /><rect y="12" width="26" height="6" fill="#000000" />
      <rect width="7" height="18" fill="#FF0000" />
    </svg>
  );
}

/** UAE mobile field with flag and +971 inside one control. */
export function PhoneField({ id, value, onChange, invalid, disabled, describedBy }) {
  return (
    <div className={`phone${invalid ? ' invalid' : ''}`}>
      <span className="cc"><UaeFlag />+971</span>
      <input id={id} inputMode="tel" autoComplete="tel-national" placeholder="50 123 4567" value={value}
        onChange={e => onChange(e.target.value)} disabled={disabled} aria-describedby={describedBy} aria-invalid={invalid || undefined} />
    </div>
  );
}

/** Eyebrow + serif date with the gold rule ("PLANNING / Friday, 9 October"). */
export function RuledDate({ eyebrow, children }) {
  return (
    <div className="ruled">
      <span className="eyebrow grey">{eyebrow}</span>
      <span className="date-title">{children}</span>
    </div>
  );
}
