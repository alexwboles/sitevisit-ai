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

No API keys. No network calls. Works offline on the job site.

## API

- `GET /api/health`
- `POST /api/generate` — `{trade, observations[], photoNotes[]}` → `{items, punchList, followUps, source}`
- `GET /api/visits` / `POST /api/visits` — `{client, address, trade, visitDate, observations[], photoNotes[], generated}`
- `GET /api/visits/:id` / `PATCH /api/visits/:id`
- `POST /api/visits/:id/duplicate` — re-book a visit at the same site (new id + number, today's date)
- `DELETE /api/visits/:id` — remove a visit from the ledger
- `GET /api/visits/export.csv` — whole ledger as CSV with quote subtotals + follow-up progress

## Price bank

`public/generate.js` holds the per-trade keyword → line-item bank (~60 entries). Prices are US ballparks — edit them for your market.

MIT licensed.
