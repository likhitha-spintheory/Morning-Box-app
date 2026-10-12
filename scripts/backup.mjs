// Consistent snapshot of the live database (safe while the server runs).
//   npm run backup                 → data/backups/morningbox-YYYYMMDD-HHMM.db, keeps the newest 14
//   MB_BACKUP_DIR=/mnt/backups npm run backup
// Schedule it daily (cron / systemd timer) and copy the folder off the server.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.env.DB_FILE || join(root, 'data', 'morningbox.db');
const dir = process.env.MB_BACKUP_DIR || join(root, 'data', 'backups');
const keep = Number(process.env.MB_BACKUP_KEEP || 14);
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const out = join(dir, `morningbox-${stamp}.db`);
const db = new DatabaseSync(file);
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
const old = readdirSync(dir).filter(f => /^morningbox-\d{8}-\d{4}\.db$/.test(f)).sort().slice(0, -keep);
old.forEach(f => rmSync(join(dir, f)));
console.log(`[backup] ${out}${old.length ? ` (removed ${old.length} old)` : ''}`);
