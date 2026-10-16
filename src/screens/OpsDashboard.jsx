import { useEffect, useState } from 'react';
import { Icon } from '../components/ui.jsx';
import { addDaysIso, dubaiTodayIso } from '../domain/standards.js';

/* Operations Dashboard — MB-OPS-001 §5, §8: "emphasize On Track, Attention Required and
   Late so operational staff can focus on exceptions instead of manually supervising every
   successful order". Read-only overview built from the console's existing endpoints;
   every action stays on its own section (Live, Exceptions, Support, …). */
export function Dashboard({ data, call, open }) {
  const [extra, setExtra] = useState(null);
  useEffect(() => {
    const today = dubaiTodayIso();
    Promise.all([
      call('GET', '/exceptions').catch(() => []),
      call('GET', '/support').catch(() => []),
      call('GET', `/report?from=${addDaysIso(today, -6)}&to=${today}`).catch(() => null)
    ]).then(([exceptions, support, report]) => setExtra({ exceptions, support, report }));
  }, [call]);

  const c = data.counts || {};
  const boxes = data.rows.reduce((t, r) => t + (r.kind === 'business' ? r.people || 0 : 1), 0);
  const delivered = (c.Delivered || 0) + (c['Delivered late'] || 0) + (c.Completed || 0);
  const tiles = [
    ['ok', 'check', 'On Track', c['On Track'] || 0],
    ['warn', 'alert', 'Attention Required', c['Attention Required'] || 0],
    ['risk', 'clock', 'Late / Failed', (c.Late || 0) + (c.Failed || 0)],
    ['done', 'box', 'Delivered', delivered]
  ];
  const exceptions = (extra?.exceptions || []).filter(e => !e.resolved).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
  const support = (extra?.support || []).filter(s => s.status === 'open');
  const days = extra?.report?.days || [];
  const peak = Math.max(1, ...days.map(d => d.boxes));
  const week = days.reduce((t, d) => ({ boxes: t.boxes + d.boxes, revenue: t.revenue + d.revenue, delivered: t.delivered + d.delivered, onTime: t.onTime + d.onTime }), { boxes: 0, revenue: 0, delivered: 0, onTime: 0 });
  const dayLabel = iso => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });

  return (
    <section className="dash">
      <div className="dash-tiles">
        {tiles.map(([tone, icon, label, n]) => (
          <button key={label} type="button" className={`dash-tile ${tone}`} onClick={() => open('days')}>
            <span className="dash-tile-ico"><Icon name={icon} size={20} stroke={1.8} /></span>
            <span className="dash-tile-n">{n}</span>
            <span className="dash-tile-l">{label}</span>
          </button>
        ))}
      </div>
      <p className="xs" style={{ margin: '-4px 0 0' }}>{data.rows.length} deliveries · {boxes} boxes on this date{data.allocated ? ` · ${data.allocated.final ? 'final' : 'provisional'} allocation` : ''}</p>

      <div className="dash-grid">
        <article className="dash-card">
          <header><span className="strong">Bakery capacity</span><button type="button" className="btn-text" onClick={() => open('days')}>Open Live</button></header>
          <ul className="dash-bars">
            {data.plans.map(p => {
              const pct = p.capacity ? Math.min(100, Math.round((p.booked / p.capacity) * 100)) : 0;
              const waiting = p.booked > 0 && p.plan?.status !== 'Confirmed';
              return (
                <li key={p.bakeryId}>
                  <span className="row"><span>{p.bakery}</span><span className="xs">{p.booked} / {p.capacity}</span></span>
                  <span className="dash-meter"><i style={{ width: `${pct}%` }} className={pct >= 90 ? 'full' : ''} /></span>
                  <span className={`xs ${waiting ? 'dash-warn' : ''}`}>{p.plan ? p.plan.status : p.booked ? 'Waiting for the bakery to confirm' : 'No boxes booked'}</span>
                </li>
              );
            })}
          </ul>
        </article>

        <article className="dash-card">
          <header><span className="strong">Open exceptions <span className="dash-count">{exceptions.length}</span></span><button type="button" className="btn-text" onClick={() => open('exceptions')}>View all</button></header>
          {!extra ? <p className="help">Loading…</p> : exceptions.length ? (
            <ul className="dash-list">
              {exceptions.slice(0, 5).map(e => (
                <li key={e.id}>
                  <span className={`dash-dot ${e.category === 'Safety' ? 'risk' : 'warn'}`} />
                  <span className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}><span className="strong">{e.kind}</span><span className="xs dash-clip">{e.note}</span></span>
                  <span className="xs" style={{ flex: 'none' }}>{e.category}</span>
                </li>
              ))}
            </ul>
          ) : <p className="help">No open exceptions.</p>}
        </article>

        <article className="dash-card">
          <header><span className="strong">Last 7 days</span><button type="button" className="btn-text" onClick={() => open('report')}>Reports</button></header>
          {!extra ? <p className="help">Loading…</p> : (
            <>
              <div className="dash-chart" role="img" aria-label="Boxes booked per day, last 7 days">
                {days.map(d => (
                  <span key={d.date} className="dash-col">
                    <span className="xs">{d.boxes || ''}</span>
                    <i style={{ height: `${Math.max(4, (d.boxes / peak) * 100)}%` }} />
                    <span className="xs">{dayLabel(d.date)}</span>
                  </span>
                ))}
              </div>
              <div className="dash-stats">
                <span><b>{week.boxes}</b><span className="xs">boxes</span></span>
                <span><b>AED {week.revenue.toLocaleString('en-GB')}</b><span className="xs">revenue incl. VAT</span></span>
                <span><b>{week.delivered ? `${Math.round((week.onTime / week.delivered) * 100)}%` : '—'}</b><span className="xs">on time</span></span>
              </div>
            </>
          )}
        </article>

        <article className="dash-card">
          <header><span className="strong">Open support <span className="dash-count">{support.length}</span></span><button type="button" className="btn-text" onClick={() => open('support')}>View all</button></header>
          {!extra ? <p className="help">Loading…</p> : support.length ? (
            <ul className="dash-list">
              {support.slice(0, 4).map(s => (
                <li key={s.id}>
                  <span className="dash-dot warn" />
                  <span className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}><span className="strong">{s.customer} · {s.topic}</span><span className="xs dash-clip">{s.message}</span></span>
                </li>
              ))}
            </ul>
          ) : <p className="help">No open support messages.</p>}
        </article>
      </div>
    </section>
  );
}
