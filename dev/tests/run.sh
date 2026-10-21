#!/usr/bin/env bash
# Full regression run. Starts the local emulator twice (with payment + AI mocks, then with neither),
# runs every API and browser test, and stops on nothing: the summary at the end lists what failed.
# Usage: dev/tests/run.sh [screenshot folder]      (needs node 18+, python3 + playwright with chromium)
set -u
cd "$(dirname "$0")/../.."
OUT="${1:-/tmp/d8-test-shots}"
PORT=8799
export D8_BASE="http://localhost:$PORT" D8_PASSWORD="test-pass-$$"
mkdir -p "$OUT"
FAILED=()

start() { # $@: extra env
  env "$@" node dev/server.mjs public "$PORT" "$D8_PASSWORD" > "$OUT/server.log" 2>&1 &
  SERVER=$!
  for _ in $(seq 1 50); do curl -s -o /dev/null "$D8_BASE/api/config" && return 0; sleep 0.2; done
  echo "server did not start"; cat "$OUT/server.log"; exit 1
}
stop() { kill "$SERVER" 2>/dev/null; wait "$SERVER" 2>/dev/null; }
run() { # name, command...
  local name="$1"; shift
  echo "=== $name"
  if "$@" > "$OUT/$name.log" 2>&1; then echo "    ok ($(grep -c '^PASS' "$OUT/$name.log") checks)"; else echo "    FAILED"; grep -E '^(FAIL|ERR)|Error' "$OUT/$name.log" | head -20; FAILED+=("$name"); fi
}

start PAY=1
run rbac      node dev/tests/rbac.test.mjs
run orders    node dev/tests/orders.test.mjs
run pay       node dev/tests/pay.test.mjs
run workspace python3 dev/tests/workspace_ui.py "$OUT/workspace" light
run workspace-dark python3 dev/tests/workspace_ui.py "$OUT/workspace-dark" dark
run orders-ui python3 dev/tests/orders_ui.py "$OUT/orders" light
run orders-ui-dark python3 dev/tests/orders_ui.py "$OUT/orders-dark" dark
run access    python3 dev/tests/access_ui.py "$OUT/access"
run portal    python3 dev/tests/portal_ui.py "$OUT/portal"
run site      python3 dev/tests/site_ui.py "$OUT/site"
run speed     python3 dev/tests/perf.py
stop

# no payment keys, no Workers AI, no database: the site must still work
start NO_AI=1 NO_DB=1
run portal-plain python3 dev/tests/portal_ui.py "$OUT/portal-plain"
run site-plain   python3 dev/tests/site_ui.py "$OUT/site-plain"
run nodb-ui      python3 dev/tests/nodb_ui.py "$OUT/nodb"
run access-plain python3 dev/tests/access_ui.py "$OUT/access-plain"
stop

# the database bound under another variable name still works
start DB_AS=d8_db
run db-name   node dev/tests/dbname.test.mjs
stop

echo
if [ ${#FAILED[@]} -eq 0 ]; then echo "ALL TEST SUITES PASSED (logs and screenshots in $OUT)"; else echo "FAILED: ${FAILED[*]} (logs in $OUT)"; exit 1; fi
