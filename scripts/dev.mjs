// Runs the API (with --watch) and the Vite dev server together.
import { spawn } from 'node:child_process';
const run = (cmd, args) => spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
/* Development mode is opt-in (server/env.js): this script turns it on for the local API. */
const api = spawn('node', ['--watch', 'server/index.js'], { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' } });
const web = run('npx', ['vite']);
const stop = () => { api.kill(); web.kill(); process.exit(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
