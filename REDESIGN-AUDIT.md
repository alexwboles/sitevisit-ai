# SiteVisit AI — Redesign Audit v2 (2026-10-19)

## Competitors studied
- **CompanyCam** — `companycam.com` beginner's guide + Google Play listing ("Camera App for Contractors", 4.7★). Camera-first capture flow; every photo GPS/time-stamped, auto-organized by project; **on-photo annotations and comments** (drawings, arrows, tags, voice notes); **before/after photo pairs** as the signature proof-of-work pattern; **live photo & project feed across the business**; project timelines; photo report builder; AI daily logs / walkthrough notes from spoken observations.
- **JobNimbus** — `jobnimbus.com` product page + Google Play listing (4.8★, 11k reviews). **Boards**: all leads/jobs on one board with estimated totals per stage; custom sales workflows; **tasks with due dates** and sales automation; **photo feed on the mobile app home screen**; photos with in-app annotation, photo reports "in seconds at the job site"; standardized inspection **forms**; works offline.

## Layout / IA / visual patterns worth borrowing (mobile-first)
1. **Camera-first capture flow (CompanyCam)** — the camera is the primary action, not a form field. The new-visit screen opens like a capture tool: big thumb-sized capture button, photo roll first, details after.
2. **On-photo annotations (CompanyCam)** — every photo is a documentation surface: captions/comments/tags tied to the *specific* photo, not floating free text.
3. **Before/after pairs (CompanyCam)** — the proof-of-work pattern contractors actually share with customers; a first-class tag on each photo, filterable in the gallery.
4. **Board by pipeline stage (JobNimbus)** — the Draft→Sent→Approved→Scheduled→Invoiced→Paid pipeline as a tappable dashboard strip with live counts, not just a filter dropdown.
5. **Sync reliability chrome (JobNimbus "works offline")** — explicit online/offline indicator + price-bank sync state in the top bar, with one-tap re-sync. A 100%-local app should *show* its offline capability, not just claim it.
6. **Industrial signage typography** — the trades domain reads premium with condensed display type (jobsite lettering) + mono ticket tape for numbers, not the generic Inter-on-cards look.

## Top functional gaps vs competitors (closing all 3 in this redesign)
1. **Photo notes are detached text.** Photo notes are free-text strings typed separately from the photos — no caption tied to a specific photo, no per-photo tag, no before/after pairing. CompanyCam's core pattern is that *the photo itself* carries annotations. → Fix: per-photo **captions** (editable) + **before/after tags** on every photo, shown in gallery, feed, and report; captions travel with the Quotely handoff payload.
2. **No pipeline board.** The 6 quote statuses exist as a filter, but there is no dashboard view of where the book of business stands — JobNimbus' boards are how crews see their week. → Fix: a tappable **quote-pipeline strip** (Draft→Paid) with live per-status counts; tapping a stage filters the ledger. Mobile: horizontally scrollable.
3. **Not capture-first, no field reliability surface.** Photos are buried mid-form with a plain file input; nothing says *camera* on mobile; and despite working 100% offline, there is no connectivity indicator and the price-bank source is a muted text line. → Fix: **capture-first new-visit layout** (camera capture button with `capture="environment"` intent at the top of the form, thumb-friendly 48px targets), a persistent **online/offline pill** in the top bar, and a **price-bank sync chip** (source + version + one-tap Refresh).

## New visual identity v2 — "The Field Clipboard, hardened"
The v1 identity (charcoal + safety orange, Oct 13, 6 days old) is this product's established brand — v2 hardens it, not replaces it:
- **Type**: Barlow Condensed (industrial jobsite lettering) for headlines, card titles, totals; Inter for body/UI; JetBrains Mono for ticket numbers, dates, prices, meta.
- **Layered field elements**: caution-stripe topbar edge, ticket-stub cards with perforated dashed dividers, tape-cornered gallery photos, blueprint-grid hero, chevron-shaped pipeline segments, numbered field-log rows.
- **Rules**: zero border-radius anywhere; flat safety orange `#ea580c` + charcoal `#1c1917` + warm paper — no gradients (except the flat caution-stripe pattern); no emoji in chrome (SVG icons only).
- **Mobile as primary surface**: sticky bottom action bar on the new-visit form, 44px+ touch targets, thumb-reach primary CTAs, fully responsive up to desktop.

## Preservation (non-negotiable)
- All API contracts and data shapes keep working: `/api/generate`, `/api/visits*`, `/api/photos/recent`, `/api/price-bank`, `/api/price-bank/refresh`, `/api/visits/:id/quotely-payload`, `/api/visits/:id/send-to-quotely`, CSV export, quote math, status pipeline.
- Consolidation work (2026-10-19): live price-bank pull via `QUOTELY_URL` → cache → machine-generated `public/price-bank.fallback.json` (never hand-edited); `GET /api/price-bank` (source/version); `POST /api/price-bank/refresh`; offline operation; "Send to Quotely" button + upsert behavior.
- Data extension only: photos gain optional `caption` (≤140 chars) and `tag` (`before`|`after`); old photo records without them keep working. Captions/tags ride the Quotely payload as extra fields (backward compatible).

---
# v1 audit (2026-10-13) — retained for record

Competitors researched: CompanyCam (photo-first workflow — photos auto-organized by
project/location/time; live photo + project feed across the business; project timelines;
photo annotations/comments; galleries and photo reports shared with customers; AI daily
logs from photos; before/after documentation), Raken/Buildertrend (daily logs with
photos, project feeds).

## Visual gaps
- Visit list is generic text cards; photos — the product's core asset — are reduced
  to a "3 photos" count. CompanyCam leads every surface with photos.
- No cross-visit photo feed (CompanyCam's signature "live feed across your business").
- Detail view: observations + photo notes in two text columns, photo strip as an
  afterthought. No project-page feel.
- Identity ("Field Clipboard", charcoal + safety orange) is already
  category-appropriate and distinctive — keep and extend it, don't replace.

## Functional gaps
- No way to browse recent site photos across visits (the #1 CompanyCam workflow).
- List API strips all photo blobs → cards can't show a cover photo.
- Photo notes are plain text; no captions tied to gallery images on the detail page.

## Redesign plan — "photo-first job file"
- Server: `visitSummary` keeps first photo as `coverPhoto`; new
  `GET /api/photos/recent` feed endpoint (newest-first, capped).
- List: photo-forward job cards (cover photo header, ticket tape, status pill,
  follow-up badges); new "Latest site photos" live feed strip (horizontal scroll,
  client + visit captions, click-through to visit).
- Detail: photo gallery grid with captions as the hero; field-log observations;
  estimate sheet + punch/follow-up checklists kept.
- All existing features preserved (quote pipeline, tax/discount math, duplicate,
  delete, search/filters, CSV, follow-up editing).

## QA notes
- Desktop 1440 + mobile 390; iterate until commercial-grade.
