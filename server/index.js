// Cutoff (9:00 PM the previous day) and delivery windows are Dubai local time.
process.env.TZ = process.env.TZ || 'Asia/Dubai';
const { createApp } = await import('./app.js');
const { queueDrinkReminders } = await import('./notify.js');
const { allocateAtCutoff, flagAtRisk } = await import('./ops.js');
const { reconcilePastMornings } = await import('./reconcile.js');
const port = Number(process.env.PORT || 8787);
createApp().listen(port, () => console.log(`Morning Box API on http://localhost:${port} (TZ ${process.env.TZ})`));

/* Every 10 minutes: drink reminders, final bakery allocation at the 9:00 PM cutoff,
   and the "at risk of being late" check before each delivery window ends. */
const tick = () => {
  try { queueDrinkReminders(); } catch (e) { console.error('[reminders]', e); }
  try { const r = allocateAtCutoff(); if (r) console.log(`[allocation] ${r.date}: ${r.allocations.length} deliveries`); } catch (e) { console.error('[allocation]', e); }
  try { flagAtRisk(); } catch (e) { console.error('[at-risk]', e); }
  /* MB-OPS-001 §9: mornings that are over are reconciled automatically; only mismatches reach the exception queue. */
  try { reconcilePastMornings(); } catch (e) { console.error('[reconcile]', e); }
};
setInterval(tick, 10 * 60 * 1000).unref();
tick();
