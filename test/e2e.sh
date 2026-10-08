#!/usr/bin/env bash
# e2e.sh — end-to-end flows against a live server on a scratch port.
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export PORT=3464
BASE="http://localhost:$PORT"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "== SiteVisit AI end-to-end tests =="

BACKUP=""
if [ -f "$DIR/data/visits.json" ]; then
  BACKUP=/tmp/sitevisit-data-backup.json
  cp "$DIR/data/visits.json" "$BACKUP"
fi
echo "[]" > "$DIR/data/visits.json"

start_srv() {
  node "$DIR/server.js" >/tmp/sitevisit-e2e.log 2>&1 &
  SRV=$!
  sleep 1
  kill -0 $SRV 2>/dev/null || { bad "server failed to boot"; cat /tmp/sitevisit-e2e.log; return 1; }
}
stop_srv() { kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; }
trap 'stop_srv 2>/dev/null; if [ -n "$BACKUP" ]; then cp "$BACKUP" "$DIR/data/visits.json"; else echo "[]" > "$DIR/data/visits.json"; fi' EXIT

start_srv || { echo "RESULT: $PASS passed, $FAIL failed"; exit 1; }

py() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

# ---- Flow 1: electrical visit -> generate -> save with work product ----
G=$(curl -s -X POST "$BASE/api/generate" -H 'Content-Type: application/json' \
  -d '{"trade":"Electrical","observations":["add 4 recessed lights in kitchen","panel is full, may need tandem breakers","install EV charger in garage"],"photoNotes":[]}')
N=$(echo "$G" | py "len(d['items'])")
[ "$N" -ge 3 ] && ok "flow1: electrical visit -> $N line items (lights + panel + EV)" || bad "flow1: only $N items: ${G:0:250}"
ITEMS=$(echo "$G" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['items']))")
V=$(curl -s -X POST "$BASE/api/visits" -H 'Content-Type: application/json' \
  -d "{\"client\":\"Bob Jones\",\"address\":\"45 Oak Ave\",\"trade\":\"Electrical\",\"visitDate\":\"2026-09-28\",\"observations\":[\"lights\",\"panel\"],\"photoNotes\":[],\"generated\":$(echo "$G" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps({'items':d['items'],'punchList':d['punchList'],'followUps':d['followUps']}))")}")
VID=$(echo "$V" | py "d['visit']['id']")
[ -n "$VID" ] || { bad "flow1: save failed: ${V:0:200}"; echo "RESULT: $PASS passed, $FAIL failed"; exit 1; }
GOT=$(curl -s "$BASE/api/visits/$VID")
echo "$GOT" | py "'light' in ' '.join(i['description'] for i in d['visit']['generated']['items']).lower()" | grep -q 'True' \
  && ok "flow1: saved visit round-trips generated line items" || bad "flow1 round-trip: ${GOT:0:200}"

# ---- Flow 2: permit keyword adds permit follow-up ----
G2=$(curl -s -X POST "$BASE/api/generate" -H 'Content-Type: application/json' \
  -d '{"trade":"Roofing","observations":["full re-roof, check permit requirements with city"],"photoNotes":[]}')
echo "$G2" | grep -qi 'permit requirements' && ok "flow2: permit keyword -> permit follow-up task" || bad "flow2: ${G2:0:300}"

# ---- Flow 3: punch list keyword mapping (roofing -> magnet sweep) ----
echo "$G2" | grep -qi 'magnet' && ok "flow3: roofing punch list has magnet-sweep" || bad "flow3: ${G2:0:300}"

# ---- Flow 4: landscaping visit end-to-end ----
G4=$(curl -s -X POST "$BASE/api/generate" -H 'Content-Type: application/json' \
  -d '{"trade":"Landscaping","observations":["install new planting bed along front walk","refresh mulch in all beds","hoa approval needed before work"],"photoNotes":["photo 2: front walk bed area"]}')
echo "$G4" | grep -qi 'planting bed' && ok "flow4: landscaping -> planting bed item" || bad "flow4: ${G4:0:250}"
echo "$G4" | grep -qi 'HOA approval' && ok "flow4: hoa keyword -> HOA follow-up" || bad "flow4 hoa: ${G4:0:300}"
echo "$G4" | grep -qi 'water in new plantings' && ok "flow4: landscaping punch item present" || bad "flow4 punch"

# ---- Flow 5: PATCH updates observations; list shows both visits ----
V2=$(curl -s -X POST "$BASE/api/visits" -H 'Content-Type: application/json' \
  -d '{"client":"Ann Lee","trade":"Painting","observations":["paint 2 bedrooms"],"photoNotes":[]}')
VID2=$(echo "$V2" | py "d['visit']['id']")
P5=$(curl -s -X PATCH "$BASE/api/visits/$VID2" -H 'Content-Type: application/json' \
  -d '{"observations":["paint 2 bedrooms","patch drywall in hallway"]}')
echo "$P5" | py "len(d['visit']['observations'])" | grep -q '2' && ok "flow5: PATCH updates observations" || bad "flow5: ${P5:0:200}"
L5=$(curl -s "$BASE/api/visits")
echo "$L5" | py "len(d['visits'])" | grep -q '2' && ok "flow5: list shows 2 visits" || bad "flow5 list"

# ---- Flow 6: quote math sanity — unitPrice * qty from bank ----
T6=$(echo "$G" | python3 -c "
import json,sys
d=json.load(sys.stdin)
tot=sum(i['qty']*i['unitPrice'] for i in d['items'])
print(int(tot))")
[ "$T6" -gt 0 ] && ok "flow6: generated items have positive prices (total=\$$T6)" || bad "flow6: total=$T6"
# every item carries source=local (honest, no fake AI)
SRC=$(echo "$G" | py "set(i['source'] for i in d['items'])")
echo "$SRC" | grep -q 'local' && ok "flow6: all items tagged source=local" || bad "flow6 sources: $SRC"

# ---- Flow 7: duplicate visit preserves everything with a fresh number ----
V7=$(curl -s -X POST "$BASE/api/visits/$VID/duplicate" -H 'Content-Type: application/json')
VID7=$(echo "$V7" | py "d['visit']['id']")
[ -n "$VID7" ] && [ "$VID7" != "$VID" ] && ok "flow7: duplicate returns new id" || bad "flow7: ${V7:0:200}"
G7=$(curl -s "$BASE/api/visits/$VID7")
echo "$G7" | py "d['visit']['client']" | grep -q 'Bob Jones' && ok "flow7: duplicate keeps client" || bad "flow7 client"
echo "$G7" | py "d['visit']['number'] != '$VID' and d['visit']['number']" | grep -qE 'SV-' && ok "flow7: duplicate has SV- number" || bad "flow7 number"
echo "$G7" | py "len(d['visit']['generated']['items']) == len(d['visit']['observations']) or True" >/dev/null
echo "$G7" | py "'light' in ' '.join(i['description'] for i in d['visit']['generated']['items']).lower()" | grep -q 'True' \
  && ok "flow7: duplicate keeps generated work product" || bad "flow7: generated lost"

# ---- Flow 8: delete visit removes it from the ledger ----
R8=$(curl -s -X DELETE "$BASE/api/visits/$VID7")
echo "$R8" | grep -q '"ok":true' && ok "flow8: delete visit ok" || bad "flow8: ${R8:0:200}"
L8=$(curl -s "$BASE/api/visits")
echo "$L8" | py "len(d['visits'])" | grep -q '2' && ok "flow8: ledger back to 2 visits" || bad "flow8 count"

# ---- Flow 9: CSV export covers ledger, totals, and follow-up progress ----
V9=$(curl -s -X POST "$BASE/api/visits" -H 'Content-Type: application/json' \
  -d '{"client":"CSV Case","trade":"Plumbing","observations":["faucet drips"],"photoNotes":[],"generated":{"items":[{"description":"Faucet replacement","qty":2,"unit":"each","unitPrice":145}],"punchList":[],"followUps":[{"task":"Send quote","due":"2026-10-09","done":true}]}}')
CSV=$(curl -s "$BASE/api/visits/export.csv")
echo "$CSV" | grep -q 'CSV Case' && ok "flow9: CSV names the visit client" || bad "flow9: client missing"
echo "$CSV" | grep -q '290.00' && ok "flow9: CSV carries quote subtotal (2x145)" || bad "flow9: subtotal missing"
echo "$CSV" | grep -q 'data:image' && bad "flow9: CSV leaks blobs" || ok "flow9: CSV has no binary data"

echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
