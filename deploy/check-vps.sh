#!/usr/bin/env bash
# Verifikasi cepat agar VPS hanya menjalankan app Wai yang benar.
# Pakai:
#   deploy/check-vps.sh
#   SSH_HOST=mastery@103.181.143.107 deploy/check-vps.sh
set -euo pipefail

SSH_HOST=${SSH_HOST:-mastery@103.181.143.107}
APP_DIR=${APP_DIR:-/var/www/Wai}
SERVICE=${SERVICE:-wai}
OLD_SERVICE=${OLD_SERVICE:-wa-assistant}
APP_PORT=${APP_PORT:-3031}
OLD_PORT=${OLD_PORT:-3030}

ssh -o BatchMode=yes -o ConnectTimeout=15 "$SSH_HOST" \
  "APP_DIR='$APP_DIR' SERVICE='$SERVICE' OLD_SERVICE='$OLD_SERVICE' APP_PORT='$APP_PORT' OLD_PORT='$OLD_PORT' bash -s" <<'REMOTE'
set -euo pipefail

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "== service =="
systemctl is-active --quiet "$SERVICE" || fail "$SERVICE is not active"
systemctl is-enabled --quiet "$SERVICE" || fail "$SERVICE is not enabled"
echo "$SERVICE active + enabled"

old_active=$(systemctl is-active "$OLD_SERVICE" 2>/dev/null || true)
old_enabled=$(systemctl is-enabled "$OLD_SERVICE" 2>/dev/null || true)
echo "$OLD_SERVICE active=$old_active enabled=$old_enabled"
if [ "$old_active" = "active" ]; then
  fail "$OLD_SERVICE is still running"
fi
if [ "$old_enabled" != "masked" ]; then
  fail "$OLD_SERVICE must be masked to avoid duplicate backend"
fi

echo "== process/listener =="
wa_count=$(pgrep -fc "$APP_DIR/wa-server" || true)
[ "$wa_count" = "1" ] || fail "expected exactly 1 $APP_DIR/wa-server process, got $wa_count"

if ss -ltnp 2>/dev/null | grep -q ":$OLD_PORT "; then
  ss -ltnp 2>/dev/null | grep ":$OLD_PORT " >&2 || true
  fail "old port $OLD_PORT is still listening"
fi
ss -ltnp 2>/dev/null | grep -q ":$APP_PORT " || fail "app port $APP_PORT is not listening"
echo "only current backend is listening"

echo "== app source =="
cd "$APP_DIR"
[ -x wa-server ] || fail "$APP_DIR/wa-server missing or not executable"
grep -q "StartReconnectWatchdog" backend/main.go || fail "watchdog source marker missing"
grep -q "finishBroadcast" backend/handlers/broadcast.go || fail "broadcast status source marker missing"
grep -q "WA_LOG_LEVEL" backend/services/wa.go || fail "WA log source marker missing"
stat -c "%y %s %n" wa-server

echo "== nginx =="
if grep -R --include='*.conf' -E "127\.0\.0\.1:$OLD_PORT|root $APP_DIR/../wa-assistant|root /var/www/wa-assistant" /etc/nginx/conf.d /etc/nginx/sites-enabled 2>/dev/null; then
  fail "active nginx config still references old backend/app"
fi
curl -fsS "http://127.0.0.1/api/plans" >/dev/null || fail "port 80 /api/plans failed"
curl -fsS "http://127.0.0.1:8080/api/plans" >/dev/null || fail "port 8080 /api/plans failed"
echo "nginx points to current backend"

echo "OK: VPS is running only $SERVICE from $APP_DIR"
REMOTE
