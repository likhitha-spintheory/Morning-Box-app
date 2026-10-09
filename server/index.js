// Cutoff (9:00 PM the previous day) and delivery windows are Dubai local time.
process.env.TZ = process.env.TZ || 'Asia/Dubai';
const { createApp } = await import('./app.js');
const port = Number(process.env.PORT || 8787);
createApp().listen(port, () => console.log(`Morning Box API on http://localhost:${port} (TZ ${process.env.TZ})`));
