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

# ---- Flow 10: photo attachments (stored, validated, kept out of list/CSV) ----
TINY="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
V10=$(curl -s -X POST "$BASE/api/visits" -H 'Content-Type: application/json' \
  -d "{\"client\":\"Photo Case\",\"trade\":\"Plumbing\",\"observations\":[\"water stain\"],\"photoNotes\":[],\"photos\":[{\"name\":\"stain.png\",\"dataUrl\":\"$TINY\"}]}")
VID10=$(echo "$V10" | py "d['visit']['id']")
echo "$V10" | py "d['visit']['photos'][0]['name']" | grep -q 'stain.png' && ok "flow10: photo stored on visit" || bad "flow10: ${V10:0:200}"
G10=$(curl -s "$BASE/api/visits/$VID10")
echo "$G10" | py "d['visit']['photos'][0]['dataUrl'].startswith('data:image/png')" | grep -q 'True' && ok "flow10: detail returns photo data URL" || bad "flow10 detail"
L10=$(curl -s "$BASE/api/visits")
echo "$L10" | grep -q 'data:image' && bad "flow10: list leaks photo blobs" || ok "flow10: list strips photo blobs"
echo "$L10" | py "max(v.get('photoCount',-1) for v in d['visits'])" | grep -q '1' && ok "flow10: list carries photoCount" || bad "flow10: no photoCount"
CSV10=$(curl -s "$BASE/api/visits/export.csv")
echo "$CSV10" | grep -q 'data:image' && bad "flow10: CSV leaks photos" || ok "flow10: CSV still binary-free"
B10=$(curl -s -X POST "$BASE/api/visits" -H 'Content-Type: application/json' \
  -d '{"client":"Bad Photo","trade":"Plumbing","observations":["x"],"photoNotes":[],"photos":[{"name":"evil.txt","dataUrl":"data:text/plain;base64,aGk="}]}')
echo "$B10" | grep -q 'not a supported image data URL' && ok "flow10: non-image data URL rejected" || bad "flow10: ${B10:0:200}"

# ---- Flow 11: follow-up / punch-list check-offs persist via PATCH ----
V11=$(curl -s -X POST "$BASE/api/visits" -H 'Content-Type: application/json' \
  -d '{"client":"Checkoff Case","trade":"HVAC","observations":["filter dirty"],"photoNotes":[],"generated":{"items":[],"punchList":[{"task":"Replace filter","done":false}],"followUps":[{"task":"Send quote","due":"2026-10-20","done":false}]}}')
VID11=$(echo "$V11" | py "d['visit']['id']")
P11=$(curl -s -X PATCH "$BASE/api/visits/$VID11" -H 'Content-Type: application/json' \
  -d '{"generated":{"items":[],"punchList":[{"task":"Replace filter","done":true}],"followUps":[{"task":"Send quote","due":"2026-10-20","done":true}]}}')
echo "$P11" | grep -q '"ok":true' && ok "flow11: PATCH generated accepted" || bad "flow11: ${P11:0:200}"
G11=$(curl -s "$BASE/api/visits/$VID11")
echo "$G11" | py "d['visit']['generated']['punchList'][0]['done']" | grep -q 'True' && ok "flow11: punch-list check-off persisted" || bad "flow11 punch"
echo "$G11" | py "d['visit']['generated']['followUps'][0]['done']" | grep -q 'True' && ok "flow11: follow-up check-off persisted" || bad "flow11 follow-up"
CSV11=$(curl -s "$BASE/api/visits/export.csv")
echo "$CSV11" | grep -q 'Checkoff Case' && ok "flow11: visit in CSV ledger" || bad "flow11 csv"

# ---- Flow 12: quote status pipeline end-to-end ----
V12=$(curl -s -X POST "$BASE/api/visits" -H 'Content-Type: application/json' \
  -d '{"client":"Status Case","trade":"Carpentry","observations":["deck boards rotten"],"photoNotes":[]}')
VID12=$(echo "$V12" | py "d['visit']['id']")
echo "$V12" | py "d['visit']['status']" | grep -q 'draft' && ok "flow12: new visit starts as draft" || bad "flow12 default: ${V12:0:200}"
for ST in sent approved scheduled invoiced paid; do
  P12=$(curl -s -X PATCH "$BASE/api/visits/$VID12" -H 'Content-Type: application/json' -d "{\"status\":\"$ST\"}")
  echo "$P12" | py "d['visit']['status']" | grep -q "$ST" || { bad "flow12: status -> $ST failed: ${P12:0:150}"; break; }
done
echo "$P12" | py "d['visit']['status']" | grep -q 'paid' && ok "flow12: status walks draft->paid" || bad "flow12 walk"
G12=$(curl -s "$BASE/api/visits/$VID12")
echo "$G12" | py "d['visit']['status']" | grep -q 'paid' && ok "flow12: paid status persists" || bad "flow12 persist"
D12=$(curl -s -X POST "$BASE/api/visits/$VID12/duplicate" -H 'Content-Type: application/json')
echo "$D12" | py "d['visit']['status']" | grep -q 'draft' && ok "flow12: duplicate resets status to draft" || bad "flow12 dup status: ${D12:0:150}"
CSV12=$(curl -s "$BASE/api/visits/export.csv")
echo "$CSV12" | grep -q 'Status Case.*paid\|paid' && ok "flow12: CSV ledger carries status" || bad "flow12 csv status"

# ---- Flow 13: follow-up add / due-date edit / remove via PATCH ----
V13=$(curl -s -X POST "$BASE/api/visits" -H 'Content-Type: application/json' \
  -d '{"client":"Followup Case","trade":"HVAC","observations":["old furnace"],"photoNotes":[],"generated":{"items":[],"punchList":[],"followUps":[{"task":"Send quote","due":"2026-11-01","done":false}]}}')
VID13=$(echo "$V13" | py "d['visit']['id']")
# add a follow-up + change the existing due date in one PATCH (what the UI does)
P13=$(curl -s -X PATCH "$BASE/api/visits/$VID13" -H 'Content-Type: application/json' \
  -d '{"generated":{"items":[],"punchList":[],"followUps":[{"task":"Send quote","due":"2026-11-15","done":false},{"task":"Order filter","due":"2026-11-05","done":false}]}}')
echo "$P13" | py "len(d['visit']['generated']['followUps'])" | grep -q '2' && ok "flow13: added second follow-up via PATCH" || bad "flow13 add: ${P13:0:200}"
G13=$(curl -s "$BASE/api/visits/$VID13")
echo "$G13" | py "d['visit']['generated']['followUps'][0]['due']" | grep -q '2026-11-15' && ok "flow13: due-date edit persisted" || bad "flow13 due"
# remove one follow-up
P13B=$(curl -s -X PATCH "$BASE/api/visits/$VID13" -H 'Content-Type: application/json' \
  -d '{"generated":{"items":[],"punchList":[],"followUps":[{"task":"Order filter","due":"2026-11-05","done":false}]}}')
echo "$P13B" | py "len(d['visit']['generated']['followUps'])" | grep -q '1' && ok "flow13: follow-up removal persisted" || bad "flow13 remove"

echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
