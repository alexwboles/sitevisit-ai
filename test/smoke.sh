#!/usr/bin/env bash
# smoke.sh — quick checks: files, syntax, server boot, API endpoints.
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3463}"
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "== SiteVisit AI smoke tests =="

# 1. required files exist
for f in server.js package.json public/index.html public/app.js public/style.css public/generate.js README.md; do
  [ -f "$DIR/$f" ] && ok "file exists: $f" || bad "missing file: $f"
done

# 2-4. JS syntax
for f in server.js public/app.js public/generate.js; do
  node --check "$DIR/$f" >/dev/null 2>&1 && ok "syntax ok: $f" || bad "syntax error: $f"
done

# start server
export PORT
node "$DIR/server.js" >/tmp/sitevisit-smoke.log 2>&1 &
SRV=$!
cleanup() { kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; }
trap cleanup EXIT
sleep 1
kill -0 $SRV 2>/dev/null || { bad "server process died on boot"; cat /tmp/sitevisit-smoke.log; echo "RESULT: $PASS passed, $FAIL failed"; exit 1; }

BASE="http://localhost:$PORT"

# 5. health
H=$(curl -s "$BASE/api/health")
echo "$H" | grep -q '"ok":true' && ok "GET /api/health ok" || bad "GET /api/health: $H"

# 6. generate: plumbing observations -> faucet + leak line items
G=$(curl -s -X POST "$BASE/api/generate" -H 'Content-Type: application/json' \
  -d '{"trade":"Plumbing","observations":["master bath faucet drips constantly","caulk failing around tub","water stain on ceiling below bath"],"photoNotes":["photo 1: stain"]} ')
echo "$G" | grep -qi 'faucet' && ok "generate finds faucet keyword" || bad "generate missed faucet: ${G:0:200}"
echo "$G" | grep -q '"source":"local"' && ok "generate source=local (no API key)" || bad "source wrong: ${G:0:200}"
echo "$G" | grep -qi 'leak' && ok "generate finds leak keyword" || bad "generate missed leak"

# 7. punch list: caulk keyword -> re-caulk task; generic closeout present
echo "$G" | grep -qi 'caulk' && ok "punch list has caulk task" || bad "punch missed caulk: ${G:0:300}"
echo "$G" | grep -q 'Walk through finished work with client' && ok "punch list has generic closeout items" || bad "punch generic missing"

# 8. follow-ups have due dates
echo "$G" | grep -q 'Send quote draft to client' && ok "follow-ups include quote draft task" || bad "follow-ups missing"
echo "$G" | grep -qE '"due":"202[0-9]-[0-9]{2}-[0-9]{2}"' && ok "follow-ups carry due dates" || bad "no due dates: ${G:0:300}"

# 9. unknown job -> editable fallback, never empty
G2=$(curl -s -X POST "$BASE/api/generate" -H 'Content-Type: application/json' \
  -d '{"trade":"Roofing","observations":["asdf qwerty zzz not a real observation"]}')
echo "$G2" | grep -q '"items":\[' && echo "$G2" | grep -qv '"items":\[\]' \
  && ok "generate fallback returns editable item for unknown text" \
  || bad "generate empty for unknown text: ${G2:0:200}"

# 10. unknown trade rejected
G3=$(curl -s -X POST "$BASE/api/generate" -H 'Content-Type: application/json' \
  -d '{"trade":"Blacksmithing","observations":["horseshoe"]}')
echo "$G3" | grep -q 'unknown trade' && ok "unknown trade rejected" || bad "trade not validated: ${G3:0:200}"

# 11. save a visit
V=$(curl -s -X POST "$BASE/api/visits" -H 'Content-Type: application/json' \
  -d '{"client":"Jane Smith","address":"123 Main St","trade":"Plumbing","visitDate":"2026-09-28","observations":["faucet drips"],"photoNotes":[]}')
VID=$(echo "$V" | python3 -c "import json,sys; print(json.load(sys.stdin)['visit']['id'])" 2>/dev/null)
VNUM=$(echo "$V" | python3 -c "import json,sys; print(json.load(sys.stdin)['visit']['number'])" 2>/dev/null)
[ -n "$VID" ] && ok "POST /api/visits saved (id=$VID)" || bad "save visit failed: ${V:0:200}"
echo "$VNUM" | grep -qE '^SV-2026-[0-9]{4}$' && ok "visit number format: $VNUM" || bad "number bad: $VNUM"

# 12. visit requires client name
V2=$(curl -s -X POST "$BASE/api/visits" -H 'Content-Type: application/json' -d '{"trade":"Plumbing"}')
echo "$V2" | grep -q 'client name required' && ok "visit requires client name" || bad "no validation: ${V2:0:200}"

# 13. patch visit with generated work product
P=$(curl -s -X PATCH "$BASE/api/visits/$VID" -H 'Content-Type: application/json' \
  -d '{"generated":{"items":[{"description":"Faucet replacement","qty":1,"unit":"each","unitPrice":145}],"punchList":[],"followUps":[]}}')
echo "$P" | grep -q 'Faucet replacement' && ok "PATCH saves generated work product" || bad "patch failed: ${P:0:200}"

# 14. index page serves
curl -s "$BASE/" | grep -q 'SiteVisit AI' && ok "index page serves" || bad "index missing"

echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
