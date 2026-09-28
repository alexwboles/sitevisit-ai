# 🧰 SiteVisit AI

Job walkthrough notes → quote draft + punch list + follow-ups. Log a site visit on your phone or laptop, tap one button, and get a structured work product you can quote from. 100% local — no accounts, no API keys.

## Features

- **Structured visit form** — client, address, trade, date, free-text observations, photo notes ("photo 3: water stain on ceiling")
- **One-click work product** — keyword → line-item bank across 9 trades generates:
  - **Quote draft** — line items with quantities, units, and local price-bank rates (editable in the browser)
  - **Punch list** — keyword-matched closeout tasks (re-caulk, magnet-sweep, filter check…) plus generic closeout items
  - **Follow-ups** — dated task list (send quote, order materials, schedule work…), with smart extras for permit/HOA/insurance/subcontractor keywords
- **Saved visits** — every visit stored with its generated work product; printable summary
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

## Price bank

`public/generate.js` holds the per-trade keyword → line-item bank (~60 entries). Prices are US ballparks — edit them for your market.

MIT licensed.
