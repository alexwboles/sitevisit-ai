# SiteVisit AI — Redesign Audit (2026-10-13)

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
