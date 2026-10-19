# 🧰 SiteVisit AI

Job walkthrough notes → quote draft + punch list + follow-ups. Log a site visit on your phone or laptop, tap one button, and get a structured work product you can quote from. 100% local — no accounts, no API keys.

## Features

- **Structured visit form** — client, address, trade, date, free-text observations, photo notes ("photo 3: water stain on ceiling"), plus **real photo attachments** — images are resized in the browser, stored with the visit, and shown as a thumbnail strip; blobs are stripped from list responses and CSV exports
- **One-click work product** — keyword → line-item bank across 9 trades generates:
  - **Quote draft** — line items with quantities, units, and local price-bank rates (editable in the browser)
  - **Punch list** — keyword-matched closeout tasks (re-caulk, magnet-sweep, filter check…) plus generic closeout items
  - **Follow-ups** — dated task list (send quote, order materials, schedule work…), with smart extras for permit/HOA/insurance/subcontractor keywords
- **Live check-offs** — punch-list and follow-up items are interactive checkboxes on the saved visit and persist immediately; overdue follow-ups are flagged, and list cards show "N overdue / N due soon" badges
- **Follow-up management** — add new follow-ups to a saved visit, edit any due date, or remove items you no longer need — everything persists live and overdue flags refresh
- **Saved visits** — every visit stored with its generated work product; printable summary
- **Copy-ready client message** — one click builds a send-ready text/email with the quote line items, discount/tax breakdown, and total, personalized with the client's name and visit number
- **Quote math** — editable tax % and discount % with a full subtotal → discount → tax → total breakdown on the draft and the saved report
- **Quotely handoff** — one click sends the quote draft to Quotely AI (`Send to Quotely` on the visit page). A sitevisit draft *is* a quotely quote: the visit id upserts, so re-sending updates the same quote instead of duplicating it. Needs `QUOTELY_URL` pointed at your quotely-ai server; the button explains what's missing when it isn't set
- **Duplicate visits** — one click re-books a visit at the same site (new number, today's date)
- **Delete visits** — remove mistaken entries from the ledger
- **Visit search + trade filter** — find visits by client, address, or number
- **CSV export** — download the whole visit ledger (`GET /api/visits/export.csv`) with quote subtotals and follow-up progress
- **Quote status pipeline** — every visit carries a status (Draft → Sent → Approved → Scheduled → Invoiced → Paid): set it on the visit page, see the pill on every list card, filter the ledger by status, and export it in the CSV; duplicating a visit resets the copy to Draft
- **Honest by design** — everything is tagged `source: "local"`; prices are starting points from a hand-written bank, not live market data

## Run it

```bash
node server.js            # serves on http://localhost:3000 (PORT env overrides)
# or
npm start
npm test                  # smoke + end-to-end tests
```

Pipeline wiring (optional): point `QUOTELY_URL` at your quotely-ai server
(e.g. `QUOTELY_URL=http://localhost:3001 node server.js`) to pull the live
price bank and enable the Send-to-Quotely handoff. Without it the app works
fully offline on the shipped price-bank snapshot.

No API keys. No network calls (except the optional quotely-ai link above). Works offline on the job site.

## API

- `GET /api/health`
- `POST /api/generate` — `{trade, observations[], photoNotes[]}` → `{items, punchList, followUps, source}`
- `GET /api/visits` / `POST /api/visits` — `{client, address, trade, visitDate, observations[], photoNotes[], generated}`
- `GET /api/visits/:id` / `PATCH /api/visits/:id`
- `POST /api/visits/:id/duplicate` — re-book a visit at the same site (new id + number, today's date)
- `DELETE /api/visits/:id` — remove a visit from the ledger
- `GET /api/visits/export.csv` — whole ledger as CSV with quote subtotals + follow-up progress
- `GET /api/visits/:id/quotely-payload` — the quotely import payload for this visit (see contract below)
- `POST /api/visits/:id/send-to-quotely` — push this visit's quote draft into quotely-ai's ledger (needs `QUOTELY_URL`; upserts on the visit id)

## Price bank

SiteVisit AI does **not** keep its own keyword→price bank — it consumes the
canonical bank owned by **quotely-ai** (this was the portfolio's duplicated
bank: the two hand-written banks are now one).

- **Format**: `{version, currency, updated, tripFee, trades[], items[]}`, each item `{trades[], keys[], name, unit, price}` (USD, parts + labor ballparks).
- **Location/URL**: live at `GET {quotely-ai}/api/price-bank`. This server tries, in order: the live bank (when `QUOTELY_URL` is set) → the last cached copy (`data/price-bank.cache.json`) → the shipped snapshot (`public/price-bank.fallback.json`, machine-generated from quotely-ai, never hand-edited).
- **Versioning**: semver — major = breaking field changes, minor = new items/trades, patch = price tweaks.
- **Status**: `GET /api/price-bank` reports `{source: "quotely-live"|"cache"|"fallback", version, itemCount}`; `POST /api/price-bank/refresh` re-pulls the live bank on demand. The list view shows which bank is feeding the generator.

Punch-list and follow-up rules are sitevisit-specific and stay in this repo (`public/generate.js`).

## Quotely handoff contract

A sitevisit quote draft **is** a quotely quote. `GET /api/visits/:id/quotely-payload`
returns exactly what quotely-ai's `POST /api/quotes/import` accepts:
`{source: "sitevisit-ai", visitId, visitNumber, customer, address, trade,
description, items[], photos[], taxPct, discountPct, followUpDate, notes, status}`.
Status mapping: `draft→draft`, `sent→sent`, `approved/scheduled/invoiced/paid→won`.
Photos ride along (first 8); the soonest open follow-up becomes the quote's
follow-up date. Re-sending updates the same quotely quote (upsert on `visitId`);
the visit records the quotely quote number in `sentToQuotely`.

MIT licensed.
