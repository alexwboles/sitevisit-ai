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

# 15. CSV export of the visit ledger
curl -s -D /tmp/sv-hdrs.txt "$BASE/api/visits/export.csv" -o /tmp/sv-export.csv
grep -qi 'text/csv' /tmp/sv-hdrs.txt && ok "visits CSV export content-type" || bad "CSV content-type: $(head -1 /tmp/sv-hdrs.txt)"
head -1 /tmp/sv-export.csv | grep -q 'number.*client.*trade' && ok "visits CSV has header row" || bad "CSV header: $(head -1 /tmp/sv-export.csv)"
grep -q "$VNUM" /tmp/sv-export.csv && ok "visits CSV includes $VNUM" || bad "CSV missing visit"

# 16. duplicate visit -> new id/number, same client
DUP=$(curl -s -X POST "$BASE/api/visits/$VID/duplicate" -H 'Content-Type: application/json')
DID=$(echo "$DUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['visit']['id'])" 2>/dev/null)
DNUM=$(echo "$DUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['visit']['number'])" 2>/dev/null)
[ -n "$DID" ] && [ "$DID" != "$VID" ] && [ "$DNUM" != "$VNUM" ] && ok "duplicate visit: new id + number ($DNUM)" || bad "duplicate failed: ${DUP:0:200}"

# 17. delete visit
DEL=$(curl -s -X DELETE "$BASE/api/visits/$DID")
echo "$DEL" | grep -q '"ok":true' && ok "DELETE /api/visits/:id removes duplicate" || bad "delete failed: ${DEL:0:200}"
curl -s "$BASE/api/visits/$DID" | grep -q 'visit not found' && ok "deleted visit is gone" || bad "deleted visit still retrievable"
curl -s -X DELETE "$BASE/api/visits/nope" | grep -q 'visit not found' && ok "delete unknown visit 404s" || bad "delete 404 missing"

# 17b. quote status pipeline: default draft, valid transitions, invalid rejected
echo "$V" | grep -q '"status":"draft"' && ok "new visit defaults to draft status" || bad "status default: ${V:0:200}"
curl -s "$BASE/api/statuses" | grep -q '"paid"' && ok "GET /api/statuses lists pipeline" || bad "statuses endpoint"
PST=$(curl -s -X PATCH "$BASE/api/visits/$VID" -H 'Content-Type: application/json' -d '{"status":"approved"}')
echo "$PST" | grep -q '"status":"approved"' && ok "PATCH status -> approved" || bad "status patch: ${PST:0:200}"
PBAD=$(curl -s -X PATCH "$BASE/api/visits/$VID" -H 'Content-Type: application/json' -d '{"status":"teleported"}')
echo "$PBAD" | grep -q 'unknown status' && ok "PATCH rejects unknown status" || bad "status validation: ${PBAD:0:200}"
curl -s "$BASE/api/visits/export.csv" | grep -q 'approved' && ok "CSV carries quote status" || bad "CSV missing status"

# 18. quoteTotals math (node)
node -e "
var E=require('$DIR/public/generate.js');
var t=E.quoteTotals([{qty:2,unitPrice:100},{qty:1,unitPrice:50}],8,10);
if(t.subtotal!==250||t.discountAmt!==25||t.taxAmt!==18||t.total!==243) throw new Error('math '+JSON.stringify(t));
var c=E.quoteTotals([{qty:1,unitPrice:100}],-5,150);
if(c.taxPct!==0||c.discountPct!==100||c.total!==0) throw new Error('clamp '+JSON.stringify(c));
var z=E.quoteTotals([],0,0);
if(z.total!==0) throw new Error('empty');
" && ok "quoteTotals: discount-then-tax math + clamping" || bad "quoteTotals broken"

# new: photo upload, interactive checklists, due badges wired in UI
grep -q 'v-photofiles' "$DIR/public/index.html" && ok "index.html has photo file input" || bad "index.html missing photo input"
grep -q 'photoBlobs' "$DIR/public/app.js" && ok "app.js stages photo uploads" || bad "app.js missing photo staging"
grep -q 'sv-photostrip' "$DIR/public/app.js" && ok "app.js renders photo strip" || bad "app.js missing photo strip"
grep -q 'followUpBadges' "$DIR/public/app.js" && ok "app.js computes due/overdue badges" || bad "app.js missing followUpBadges"
grep -q 'data-kind' "$DIR/public/app.js" && ok "app.js has persistent check-off checkboxes" || bad "app.js missing check-off persistence"
grep -q 'OVERDUE' "$DIR/public/app.js" && ok "app.js flags overdue follow-ups" || bad "app.js missing overdue flag"

# new: quote status pipeline + follow-up management + client message wired in UI
grep -q 'visit-status-filter' "$DIR/public/index.html" && ok "index.html has status filter" || bad "index.html missing status filter"
grep -q 'sv-status' "$DIR/public/app.js" && ok "app.js has quote status selector" || bad "app.js missing status selector"
grep -q 'st-paid' "$DIR/public/style.css" && ok "style.css has status pill styles" || bad "style.css missing status styles"
grep -q 'sv-add-follow' "$DIR/public/app.js" && ok "app.js can add follow-ups on saved visits" || bad "app.js missing add-follow-up"
grep -q 'data-due' "$DIR/public/app.js" && ok "app.js edits follow-up due dates" || bad "app.js missing due-date editing"
grep -q 'data-rm-follow' "$DIR/public/app.js" && ok "app.js can remove follow-ups" || bad "app.js missing follow-up removal"
grep -q 'buildClientMessage' "$DIR/public/app.js" && ok "app.js builds copy-ready client quote message" || bad "app.js missing client message"

# price bank contract: quotely-ai owns it, sitevisit-ai consumes it
PB=$(curl -s "$BASE/api/price-bank")
echo "$PB" | grep -q '"version":"1.0.0"' && ok "price bank version 1.0.0 (quotely-ai owned)" || bad "price bank version: ${PB:0:150}"
echo "$PB" | grep -q '"owner":"quotely-ai"' && ok "price bank names quotely-ai as owner" || bad "owner missing"
echo "$PB" | grep -q '"source":"fallback"' && ok "price bank source=fallback without QUOTELY_URL" || bad "source: ${PB:0:150}"
PBN=$(echo "$PB" | python3 -c "import json,sys; print(json.load(sys.stdin)['itemCount'])")
[ "$PBN" -ge 60 ] && ok "price bank feeds $PBN line items" || bad "itemCount: $PBN"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/price-bank/refresh")" = "502" ] \
  && ok "price-bank refresh without QUOTELY_URL -> 502 (keeps shipped snapshot)" || bad "refresh http"
node -e "
var E=require('$DIR/public/generate.js');
var pl=E.lineBankFor('Plumbing', null);
if(!pl.length) throw new Error('empty plumbing slice');
var f=pl.filter(function(e){return e.d.indexOf('Faucet')!==-1;})[0];
if(!f||f.price!==145) throw new Error('faucet price');
if(E.quotelyStatusFor('approved')!=='won'||E.quotelyStatusFor('paid')!=='won'||E.quotelyStatusFor('sent')!=='sent'||E.quotelyStatusFor('draft')!=='draft') throw new Error('status map');
var p=E.quotelyPayload({id:'v1',number:'SV-2026-0001',client:'C',address:'A',trade:'Plumbing',status:'approved',observations:['faucet drips'],photoNotes:[],photos:[{name:'n',dataUrl:'d'}],generated:{items:[{description:'x',qty:1,unit:'each',unitPrice:10}],totals:{taxPct:5,discountPct:0},followUps:[{task:'t',due:'2026-11-01',done:false}],punchList:[]}});
if(p.source!=='sitevisit-ai'||p.visitId!=='v1'||p.status!=='won'||p.taxPct!==5||p.followUpDate!=='2026-11-01') throw new Error('payload '+JSON.stringify(p));
" && ok "engine: lineBankFor slices canonical bank; status map + quotelyPayload contract" || bad "engine contract"

# quotely handoff: payload endpoint + send without QUOTELY_URL
VQ=$(curl -s -X POST "$BASE/api/visits" -H 'Content-Type: application/json' \
  -d '{"client":"Handoff Case","address":"9 Pipe St","trade":"Plumbing","observations":["faucet drips"],"photoNotes":[],"generated":{"items":[{"description":"Faucet replacement (parts + labor)","qty":1,"unit":"each","unitPrice":145}],"punchList":[],"followUps":[],"totals":{"subtotal":145,"discountPct":0,"taxPct":0,"total":145}}}')
VQID=$(echo "$VQ" | python3 -c "import json,sys; print(json.load(sys.stdin)['visit']['id'])" 2>/dev/null)
curl -s -X PATCH "$BASE/api/visits/$VQID" -H 'Content-Type: application/json' -d '{"status":"approved"}' >/dev/null
QP=$(curl -s "$BASE/api/visits/$VQID/quotely-payload")
echo "$QP" | grep -q '"status":"won"' && echo "$QP" | grep -q '"visitId":"'"$VQID"'"' \
  && echo "$QP" | grep -q 'Faucet replacement' && ok "quotely-payload mirrors the import contract (approved -> won)" || bad "payload: ${QP:0:250}"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/visits/$VQID/send-to-quotely")" = "400" ] \
  && ok "send-to-quotely without QUOTELY_URL -> 400 (documented)" || bad "send-to-quotely http"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/visits/nope/quotely-payload")" = "404" ] \
  && ok "quotely-payload 404s on unknown visit" || bad "payload 404"

# quotely handoff UI wiring
grep -q 'btn-send-quotely' "$DIR/public/index.html" && ok "index.html has Send to Quotely button" || bad "index.html missing send button"
grep -q 'btn-send-quotely' "$DIR/public/app.js" && ok "app.js wires send-to-quotely" || bad "app.js missing send wiring"
grep -q 'quotely-link' "$DIR/public/app.js" && ok "app.js shows quotely quote link" || bad "app.js missing quotely link"
grep -q 'bank-src' "$DIR/public/index.html" && ok "index.html shows price-bank source" || bad "index.html missing bank source"
curl -s -X DELETE "$BASE/api/visits/$VQID" >/dev/null
# clean up the visit created in check 11 (keeps the committed demo data tidy)
curl -s -X DELETE "$BASE/api/visits/$VID" >/dev/null 2>&1

echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
