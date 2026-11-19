import { Fragment } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Screen, TopBar } from '../components/ui.jsx';
import { useConfig } from '../state/config.js';
import { legalDocument, legalDate, inlineParts, LEGAL_PAGES } from '../legal/documents.js';
import { DELIVERY_WINDOWS } from '../domain/standards.js';

/* Customer-facing legal pages: the client's UAE legal pack (src/legal/documents.js), the same text the
   server publishes at /terms, /refunds, /privacy and /cookies. */
export { LEGAL_PAGES };

const Inline = ({ text }) => inlineParts(text).map((p, i) => (typeof p === 'string'
  ? <Fragment key={i}>{p}</Fragment>
  : <Link key={i} to={`/legal/${p.id}`} className="link">{p.label}</Link>));

const pStyle = { margin: 0, fontSize: 16, lineHeight: 1.6 };

function Block({ b }) {
  if (b.h) return <h2 className="h3" style={{ fontSize: 19, marginTop: 6 }}>{b.h}</h2>;
  if (b.p) return <p className="help" style={pStyle}><Inline text={b.p} /></p>;
  if (b.ul || b.ol) {
    const L = b.ul ? 'ul' : 'ol';
    return <L className="help" style={{ ...pStyle, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>{(b.ul || b.ol).map((x, i) => <li key={i}><Inline text={x} /></li>)}</L>;
  }
  if (b.table) {
    /* One card per row: readable on a phone, no sideways scrolling. */
    const [first, ...rest] = b.table.head;
    return (
      <div className="stack gap-10">
        {b.table.rows.map((r, i) => (
          <div key={i} className="card stack gap-6" style={{ padding: 14 }}>
            <span className="strong" style={{ fontSize: 15.5 }}><Inline text={r[0]} /></span>
            {rest.map((h, k) => (
              <span key={h} className="help" style={{ margin: 0, fontSize: 15 }}>
                <span className="xs" style={{ display: 'block', textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</span>
                <Inline text={r[k + 1]} />
              </span>
            ))}
          </div>
        ))}
        <span className="sr-only">{first}</span>
      </div>
    );
  }
  return null;
}

export default function Legal() {
  const { doc } = useParams();
  const config = useConfig();
  const page = legalDocument(doc, { ...config, windows: DELIVERY_WINDOWS });
  if (!page) return <Navigate to="/" replace />;
  const title = page.title.replace('Morning Box – ', '');
  return (
    <Screen>
      <TopBar back={-1} close={null}><span className="topbar-title">{title}</span></TopBar>
      <main className="screen-main legal" style={{ paddingTop: 8, gap: 16 }}>
        <div className="stack gap-8">
          <h1 className="h-display" style={{ fontSize: 32 }}>{title}</h1>
          <span className="xs">Last updated {legalDate(page.updated)}</span>
        </div>
        <p style={{ ...pStyle, fontSize: 17, fontWeight: 500 }}><Inline text={page.summary} /></p>
        {page.blocks.map((b, i) => <Block key={i} b={b} />)}
        {page.footer && <p className="xs" style={{ margin: '8px 0 0' }}>{page.footer}</p>}
        <nav className="stack gap-6" aria-label="Other legal documents" style={{ paddingTop: 8, borderTop: '1px solid var(--line-soft)' }}>
          {LEGAL_PAGES.filter(([id]) => id !== doc).map(([id, label]) => <Link key={id} to={`/legal/${id}`} className="link" style={{ fontSize: 15 }}>{label}</Link>)}
          <Link to="/help" className="link" style={{ fontSize: 15 }}>Questions? Contact us</Link>
        </nav>
      </main>
    </Screen>
  );
}
