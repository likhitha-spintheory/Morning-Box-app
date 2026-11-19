#!/usr/bin/env bash
# Deploy the Morning Box app to dev.morningbox.ae (run ON the server as root, or with sudo).
#   ssh root@82.27.71.167 'bash -s' < scripts/deploy-dev.sh
# Backs up the database, settings and Caddyfile first; touches only Morning Box's files.
set -euo pipefail
APP=/opt/morningbox/app
ENVF=/etc/morningbox/env
BRANCH=${BRANCH:-email-otp-payments}
STAMP=$(date +%Y%m%d-%H%M%S)
BK=/opt/morningbox/backups/deploy-$STAMP

echo "== Backup to $BK"
mkdir -p "$BK"
cp -a "$ENVF" "$BK/env"
cp -a /etc/caddy/Caddyfile "$BK/Caddyfile"
DB=$(grep -E '^DB_FILE=' "$ENVF" | cut -d= -f2- || true); DB=${DB:-$APP/data/morningbox.db}
if [ -f "$DB" ]; then sqlite3 "$DB" ".backup '$BK/morningbox.db'" 2>/dev/null || cp -a "$DB"* "$BK/"; fi
ls -la "$BK"

echo "== Settings: TRUST_PROXY (required by this version in production)"
grep -q '^TRUST_PROXY=' "$ENVF" || echo 'TRUST_PROXY=1' >> "$ENVF"

echo "== Code: $BRANCH"
cd "$APP"
sudo -u morningbox git fetch origin
sudo -u morningbox git checkout "$BRANCH"
sudo -u morningbox git pull --ff-only origin "$BRANCH"
sudo -u morningbox git log --oneline -1

echo "== Install and build"
sudo -u morningbox npm ci --no-audit --no-fund
sudo -u morningbox npm run build

echo "== Restart"
systemctl restart morningbox
sleep 4
systemctl is-active morningbox
PORT=$(grep -E "^PORT=" "$ENVF" | cut -d= -f2- || true); curl -fsS "http://127.0.0.1:${PORT:-8787}/api/health" && echo
for p in / /terms /privacy /api/config; do printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' https://dev.morningbox.ae$p)" "$p"; done
echo "== Done. To roll back: restore $BK and 'git checkout <previous commit>' in $APP, then rebuild and restart."
