#!/usr/bin/env bash
set -euo pipefail

PORT="${BROWSER_SMOKE_PORT:-4173}"
BASE_URL="http://127.0.0.1:${PORT}"
HTML_FILE="${RUNNER_TEMP:-/tmp}/randevu-browser-smoke.html"
LOG_FILE="${RUNNER_TEMP:-/tmp}/randevu-preview.log"

CHROME_BIN="${CHROME_BIN:-}"
if [[ -z "$CHROME_BIN" ]]; then
  for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      CHROME_BIN="$(command -v "$candidate")"
      break
    fi
  done
fi

if [[ -z "$CHROME_BIN" ]]; then
  echo "Browser smoke failed: Chrome/Chromium executable not found." >&2
  exit 1
fi

npm run preview -- --port "$PORT" >"$LOG_FILE" 2>&1 &
PREVIEW_PID=$!
trap 'kill "$PREVIEW_PID" >/dev/null 2>&1 || true' EXIT

ready=0
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error "$BASE_URL/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" -ne 1 ]]; then
  echo "Browser smoke failed: preview server did not become ready." >&2
  cat "$LOG_FILE" >&2 || true
  exit 1
fi

"$CHROME_BIN" \
  --headless \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --virtual-time-budget=4000 \
  --dump-dom \
  "$BASE_URL/" >"$HTML_FILE"

if ! grep -Fq 'Çalışma alanına girin' "$HTML_FILE"; then
  echo "Browser smoke failed: React login UI did not render." >&2
  cat "$HTML_FILE" >&2 || true
  exit 1
fi

if ! grep -Fq 'Yeni işletme hesabı oluştur' "$HTML_FILE"; then
  echo "Browser smoke failed: expected auth interaction is missing." >&2
  cat "$HTML_FILE" >&2 || true
  exit 1
fi

echo "Browser smoke passed with $CHROME_BIN at $BASE_URL/."

CHROME_BIN="$CHROME_BIN" node scripts/browser-booking-recovery.mjs
CHROME_BIN="$CHROME_BIN" node scripts/browser-f10-onboarding.mjs
CHROME_BIN="$CHROME_BIN" node scripts/browser-f10-customers.mjs
CHROME_BIN="$CHROME_BIN" node scripts/browser-f10-customers-conflict.mjs
CHROME_BIN="$CHROME_BIN" node scripts/browser-f12-public-profile.mjs
CHROME_BIN="$CHROME_BIN" node scripts/browser-f12-public-operator.mjs
CHROME_BIN="$CHROME_BIN" node scripts/browser-f10-catalog-settings.mjs
