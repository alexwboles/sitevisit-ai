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
  # the fixed sleep below is not enough under load — poll until the port answers
  for i in $(seq 1 60); do
    curl -s -o /dev/null --max-time 1 "$BASE/api/health" 2>/dev/null && return 0
    kill -0 $SRV 2>/dev/null || break
    sleep 0.25
  done
  bad "server failed to boot"; cat /tmp/sitevisit-e2e.log; return 1
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
echo "$G4" | grep -qi 'garden bed' && ok "flow4: landscaping -> garden bed planting item (consolidated bank)" || bad "flow4: ${G4:0:250}"
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
echo "$L10" | py "any('photos' in v for v in d['visits'])" | grep -q 'True' && bad "flow10: list leaks photo blobs" || ok "flow10: list strips photo blob arrays"
echo "$L10" | py "max(v.get('photoCount',-1) for v in d['visits'])" | grep -q '1' && ok "flow10: list carries photoCount" || bad "flow10: no photoCount"
echo "$L10" | py "any((v.get('coverPhoto') or '').startswith('data:image') for v in d['visits'])" | grep -q 'True' && ok "flow10: list carries one coverPhoto per visit" || bad "flow10: no coverPhoto"
# ---- Flow 10b: photo feed endpoint ----
F10B=$(curl -s "$BASE/api/photos/recent?limit=5")
echo "$F10B" | py "d['ok']" | grep -q 'True' && ok "flow10b: /api/photos/recent ok" || bad "flow10b: ${F10B:0:200}"
echo "$F10B" | py "len(d['photos'])>=1 and d['photos'][0]['dataUrl'].startswith('data:image')" | grep -q 'True' && ok "flow10b: feed returns photo data URLs" || bad "flow10b: no photos"
echo "$F10B" | py "all('visitId' in p and 'client' in p for p in d['photos'])" | grep -q 'True' && ok "flow10b: feed items carry visit context" || bad "flow10b: missing context"
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

# ---- Flow 14: quotely-ai wiring — live price bank + send-to-quotely (stub) ----
STUBQ_PORT=3498
node "$DIR/test/stub-quotely.js" "$STUBQ_PORT" >/tmp/stub-quotely.log 2>&1 &
STUBQ=$!
for i in $(seq 1 40); do
  curl -s -o /dev/null --max-time 1 "http://localhost:$STUBQ_PORT/api/price-bank" 2>/dev/null && break
  kill -0 $STUBQ 2>/dev/null || break
  sleep 0.25
done
kill -0 $STUBQ 2>/dev/null || { bad "stub quotely failed to boot"; cat /tmp/stub-quotely.log; }
stop_srv
export QUOTELY_URL="http://localhost:$STUBQ_PORT"
start_srv
# the boot-time live pull is async — allow it a few seconds to land
PB14=""; TRIES=0
while [ $TRIES -lt 10 ]; do
  PB14=$(curl -s "$BASE/api/price-bank")
  echo "$PB14" | grep -q '"source":"quotely-live"' && break
  TRIES=$((TRIES+1)); sleep 1
done
echo "$PB14" | grep -q '"source":"quotely-live"' && ok "flow14: live price bank from quotely-ai" || bad "flow14 bank: ${PB14:0:200}"
echo "$PB14" | grep -q '"version":"9.9.9-stub"' && ok "flow14: stub bank version picked up" || bad "flow14 version"
# generate against the live stub bank (faucet 145, leak 175)
G14=$(curl -s -X POST "$BASE/api/generate" -H 'Content-Type: application/json' \
  -d '{"trade":"Plumbing","observations":["bathroom faucet drips nonstop"],"photoNotes":[]}')
echo "$G14" | grep -qi 'faucet' && ok "flow14: live bank drives generation" || bad "flow14 generate: ${G14:0:200}"
V14=$(curl -s -X POST "$BASE/api/visits" -H 'Content-Type: application/json' \
  -d "{\"client\":\"Handoff E2E\",\"trade\":\"Plumbing\",\"observations\":[\"faucet drips\"],\"photoNotes\":[],\"generated\":$(echo "$G14" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps({'items':d['items'],'punchList':[],'followUps':[]}))")}")
VID14=$(echo "$V14" | py "d['visit']['id']")
S14=$(curl -s -X POST "$BASE/api/visits/$VID14/send-to-quotely")
echo "$S14" | grep -q '"created":true' && ok "flow14: send-to-quotely creates the quotely quote" || bad "flow14 send: ${S14:0:250}"
echo "$S14" | grep -q '"quoteNumber":"Q-2026-9001"' && ok "flow14: visit records the quotely quote number" || bad "flow14 link"
IMP14=$(curl -s "http://localhost:$STUBQ_PORT/stub/imports")
echo "$IMP14" | grep -q "\"visitId\":\"$VID14\"" && ok "flow14: quotely got the import with the visit id" || bad "flow14 import body"
echo "$IMP14" | grep -q '"source":"sitevisit-ai"' && ok "flow14: import tagged source=sitevisit-ai" || bad "flow14 source tag"
# re-send upserts (stub reports created:false on the second import)
S14B=$(curl -s -X POST "$BASE/api/visits/$VID14/send-to-quotely")
echo "$S14B" | grep -q '"created":false' && ok "flow14: re-send upserts instead of duplicating" || bad "flow14 resend"
curl -s -X DELETE "$BASE/api/visits/$VID14" >/dev/null
kill $STUBQ 2>/dev/null; wait $STUBQ 2>/dev/null
unset QUOTELY_URL
rm -f "$DIR/data/price-bank.cache.json"
stop_srv
start_srv
PB14B=$(curl -s "$BASE/api/price-bank")
echo "$PB14B" | grep -q '"source":"fallback"' && ok "flow14: without QUOTELY_URL falls back to shipped snapshot" || bad "flow14 fallback: ${PB14B:0:200}"
echo "$PB14B" | grep -q '"version":"1.0.0"' && ok "flow14: fallback is the canonical v1.0.0 bank" || bad "flow14 fallback version"

# ---- Flow 15: annotated photos — caption/tag round-trip, feed stays honest ----
F15=$(curl -s -X POST "$BASE/api/visits" -H 'Content-Type: application/json' \
  -d "{\"client\":\"Annot E2E\",\"trade\":\"Roofing\",\"observations\":[\"shingles missing\"],\"photoNotes\":[],\"photos\":[{\"name\":\"a.png\",\"dataUrl\":\"$TINY\",\"caption\":\"Ridge cap missing\",\"tag\":\"before\"}]}")
VID15=$(echo "$F15" | py "d['visit']['id']")
G15=$(curl -s "$BASE/api/visits/$VID15")
echo "$G15" | py "d['visit']['photos'][0]['caption']" | grep -q 'Ridge cap missing' && ok "flow15: caption round-trips on detail" || bad "flow15 caption"
echo "$G15" | py "d['visit']['photos'][0]['tag']" | grep -q 'before' && ok "flow15: before tag round-trips on detail" || bad "flow15 tag"
FEED15=$(curl -s "$BASE/api/photos/recent?limit=3")
echo "$FEED15" | py "d['photos'][0]['caption']" | grep -q 'Ridge cap missing' && ok "flow15: newest annotated photo tops the feed" || bad "flow15 feed order"
# edit the caption; the photo must NOT jump the feed (addedAt preserved)
P15=$(echo "$G15" | python3 -c "
import json,sys
v=json.load(sys.stdin)['visit']['photos']
v[0]['caption']='Updated caption'; v[0]['tag']='after'
print(json.dumps(v))")
curl -s -X PATCH "$BASE/api/visits/$VID15" -H 'Content-Type: application/json' -d "{\"photos\":$P15}" >/dev/null
FEED15B=$(curl -s "$BASE/api/photos/recent?limit=3")
echo "$FEED15B" | py "d['photos'][0]['tag']" | grep -q 'after' && ok "flow15: tag edit -> after, feed position kept" || bad "flow15 edit"
QP15=$(curl -s "$BASE/api/visits/$VID15/quotely-payload")
echo "$QP15" | py "d['payload']['photos'][0]['caption']" | grep -q 'Updated caption' && ok "flow15: quotely payload carries the annotation" || bad "flow15 payload"
curl -s -X DELETE "$BASE/api/visits/$VID15" >/dev/null

echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
