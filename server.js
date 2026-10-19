/*
 * SiteVisit AI - tiny zero-dependency Node server.
 * Job walkthrough notes -> quote draft + punch list + follow-ups.
 * Serves the single-page app and a small JSON API.
 * Everything works with NO API key and NO network services.
 */
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const Engine = require("./public/generate.js");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "visits.json");
const BANK_CACHE_FILE = path.join(DATA_DIR, "price-bank.cache.json");

/* quotely-ai owns the canonical line-item / price bank. Set QUOTELY_URL
 * (e.g. http://localhost:3001) and this server pulls the live bank at
 * boot; otherwise it uses the last cached copy, else the shipped
 * snapshot in public/price-bank.fallback.json. Offline-first: the app
 * always works, the bank just might be the shipped snapshot. */
const QUOTELY_URL = (process.env.QUOTELY_URL || "").replace(/\/+$/, "");

let priceBank = null;          // canonical bank object in memory
let priceBankSource = "fallback";
let priceBankFetchedAt = null;

function validateBank(b) {
  return b && typeof b === "object" && typeof b.version === "string" && Array.isArray(b.items) && b.items.length > 0;
}

function applyBank(bank, source) {
  priceBank = bank;
  priceBankSource = source;
  priceBankFetchedAt = new Date().toISOString();
  try { Engine.setPriceBank(bank, source); } catch (e) { /* engine keeps its fallback */ }
}

function fetchJson(urlStr, timeoutMs) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return resolve({ ok: false, error: "bad url" }); }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + (u.search || ""), method: "GET", timeout: timeoutMs || 2500
    }, (res) => {
      let raw = "";
      res.on("data", c => { raw += c; });
      res.on("end", () => {
        try {
          const body = JSON.parse(raw);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body });
        } catch (e) { resolve({ ok: false, error: "bad json" }); }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.end();
  });
}

function postJson(urlStr, payload, timeoutMs) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return resolve({ ok: false, error: "bad url" }); }
    const lib = u.protocol === "https:" ? https : http;
    const body = JSON.stringify(payload || {});
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + (u.search || ""), method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: timeoutMs || 6000
    }, (res) => {
      let raw = "";
      res.on("data", c => { raw += c; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: parsed });
        } catch (e) { resolve({ ok: false, status: res.statusCode, error: "bad json" }); }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.write(body);
    req.end();
  });
}

function readBankCache() {
  try {
    const raw = fs.readFileSync(BANK_CACHE_FILE, "utf8");
    const b = JSON.parse(raw);
    return validateBank(b) ? b : null;
  } catch (e) { return null; }
}

async function refreshPriceBank() {
  if (!QUOTELY_URL) return { ok: false, error: "QUOTELY_URL not set — using the shipped price-bank snapshot" };
  const r = await fetchJson(QUOTELY_URL + "/api/price-bank", 2500);
  if (r.ok && validateBank(r.body)) {
    applyBank(r.body, "quotely-live");
    try { fs.writeFileSync(BANK_CACHE_FILE, JSON.stringify(r.body), "utf8"); } catch (e) { /* cache is best-effort */ }
    return { ok: true, source: "quotely-live", version: r.body.version, items: r.body.items.length };
  }
  const cached = readBankCache();
  if (cached) {
    applyBank(cached, "cache");
    return { ok: false, error: "quotely unreachable (" + (r.error || "http " + r.status) + ") — using cached bank", source: "cache", version: cached.version };
  }
  return { ok: false, error: "quotely unreachable (" + (r.error || "http " + r.status) + ") — using shipped snapshot", source: "fallback" };
}

// Boot: start on the shipped snapshot immediately, then try the live bank
// in the background when QUOTELY_URL is configured.
if (QUOTELY_URL) {
  refreshPriceBank().then(r => console.log("price bank:", r.ok ? "live from quotely-ai v" + r.version : r.error));
} else {
  const cached = readBankCache();
  if (cached) applyBank(cached, "cache");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function readVisits() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function writeVisits(v) {
  ensureDataDir();
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

function nextNumber(visits) {
  const year = new Date().getFullYear();
  let n = 0;
  visits.forEach((v) => {
    const m = /^SV-(\d{4})-(\d{4})$/.exec(v.number || "");
    if (m && Number(m[1]) === year) n = Math.max(n, Number(m[2]));
  });
  return "SV-" + year + "-" + String(n + 1).padStart(4, "0");
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function sendText(res, code, text) {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error("invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(ROOT, safe);
  if (!file.startsWith(ROOT)) return sendText(res, 403, "forbidden");
  fs.readFile(file, (err, data) => {
    if (err) return sendText(res, 404, "not found");
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function cleanList(x) {
  if (!Array.isArray(x)) return [];
  return x.map((s) => String(s || "").trim()).filter(Boolean);
}

/* Quote pipeline status: draft -> sent -> approved -> scheduled -> invoiced -> paid.
 * Pure bookkeeping — no side effects, just where this visit stands. */
const QUOTE_STATUSES = ["draft", "sent", "approved", "scheduled", "invoiced", "paid"];

function cleanStatus(x, fallback) {
  const s = String(x || "").trim().toLowerCase();
  if (QUOTE_STATUSES.includes(s)) return s;
  if (x === undefined || x === null || s === "") return fallback;
  return null; // invalid — caller turns this into a 400
}

/* Validate uploaded visit photos. Each must be a small data-URL image
 * (png/jpeg/gif/webp), <= 1.5MB, max 12 per visit. Returns {ok, photos, error}. */
function cleanPhotos(x) {
  if (x === undefined || x === null) return { ok: true, photos: [] };
  if (!Array.isArray(x)) return { ok: false, error: "photos must be an array" };
  if (x.length > 12) return { ok: false, error: "at most 12 photos per visit" };
  const photos = [];
  for (const p of x) {
    const name = String((p && p.name) || "photo").trim().slice(0, 80) || "photo";
    const dataUrl = String((p && p.dataUrl) || "");
    if (!/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
      return { ok: false, error: "photo '" + name + "' is not a supported image data URL" };
    }
    if (dataUrl.length > 2000000) {
      return { ok: false, error: "photo '" + name + "' exceeds the 1.5MB limit" };
    }
    photos.push({ name, dataUrl, addedAt: new Date().toISOString() });
  }
  return { ok: true, photos };
}

/* Strip photo blobs from a visit for list responses (bandwidth + privacy),
 * but keep the first photo as a card cover (already resized in-browser). */
function visitSummary(v) {
  const c = Object.assign({}, v);
  c.photoCount = (v.photos || []).length;
  if (v.photos && v.photos[0] && v.photos[0].dataUrl) {
    c.coverPhoto = v.photos[0].dataUrl;
  }
  delete c.photos;
  return c;
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  const m = req.method;

  if (m === "GET" && p === "/api/health") {
    return sendJSON(res, 200, { ok: true, service: "sitevisit-ai", openai: false });
  }

  if (m === "GET" && p === "/api/statuses") {
    return sendJSON(res, 200, { ok: true, statuses: QUOTE_STATUSES });
  }

  /* Price-bank contract: which bank is feeding the generator right now. */
  if (m === "GET" && p === "/api/price-bank") {
    const info = Engine.priceBankInfo();
    return sendJSON(res, 200, {
      ok: true,
      source: priceBank ? priceBankSource : info.source,
      version: info.version,
      itemCount: info.itemCount,
      fetchedAt: priceBankFetchedAt,
      quotelyConfigured: Boolean(QUOTELY_URL),
      owner: "quotely-ai"
    });
  }

  if (m === "POST" && p === "/api/price-bank/refresh") {
    const r = await refreshPriceBank();
    const info = Engine.priceBankInfo();
    if (r.ok) return sendJSON(res, 200, { ok: true, source: r.source, version: r.version, items: r.items });
    return sendJSON(res, 502, { ok: false, error: r.error, source: info.source, version: info.version });
  }

  if (m === "POST" && p === "/api/generate") {
    const body = await readBody(req);
    const trade = body.trade || "General Handyman";
    if (!Engine.TRADES.includes(trade)) {
      return sendJSON(res, 400, { ok: false, error: "unknown trade: " + trade });
    }
    const wp = Engine.generateWorkProduct(trade, cleanList(body.observations), cleanList(body.photoNotes), priceBank);
    return sendJSON(res, 200, Object.assign({ ok: true }, wp));
  }

  // CSV export of the visit ledger (line-item detail stays in the app)
  if (m === "GET" && p === "/api/visits/export.csv") {
    const visits = readVisits();
    const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const quoteTotal = (v) => {
      if (!v.generated || !v.generated.items) return "";
      return v.generated.items.reduce((t, it) =>
        t + Number(it.qty || 0) * Number(it.unitPrice || 0), 0).toFixed(2);
    };
    const rows = [
      ["number", "client", "address", "trade", "visitDate", "status", "observations", "lineItems", "quoteSubtotal", "followUpsDone", "followUpsTotal"]
    ].concat(visits.map((v) => [
      v.number, v.client, v.address, v.trade, v.visitDate, v.status || "draft",
      (v.observations || []).length, ((v.generated || {}).items || []).length, quoteTotal(v),
      ((v.generated || {}).followUps || []).filter((f) => f.done).length,
      ((v.generated || {}).followUps || []).length
    ]));
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sitevisit-visits.csv"'
    });
    return res.end("\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n"));
  }

  /* CompanyCam-style live photo feed: most recent site photos across
   * all visits, newest first. Capped for local bandwidth. */
  if (m === "GET" && p === "/api/photos/recent") {
    var limit = Math.min(24, Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 12));
    var feed = [];
    readVisits().forEach(function (v) {
      (v.photos || []).forEach(function (ph) {
        feed.push({
          visitId: v.id, client: v.client, address: v.address || "",
          visitDate: v.visitDate, name: ph.name, addedAt: ph.addedAt,
          dataUrl: ph.dataUrl
        });
      });
    });
    feed.sort(function (a, b) { return (b.addedAt || "").localeCompare(a.addedAt || ""); });
    return sendJSON(res, 200, { ok: true, photos: feed.slice(0, limit) });
  }

  if (p === "/api/visits") {
    if (m === "GET") {
      return sendJSON(res, 200, { visits: readVisits().map(visitSummary) });
    }    if (m === "POST") {
      const body = await readBody(req);
      if (!String(body.client || "").trim()) {
        return sendJSON(res, 400, { ok: false, error: "client name required" });
      }
      const trade = body.trade || "General Handyman";
      if (!Engine.TRADES.includes(trade)) {
        return sendJSON(res, 400, { ok: false, error: "unknown trade: " + trade });
      }
      const ph = cleanPhotos(body.photos);
      if (!ph.ok) return sendJSON(res, 400, { ok: false, error: ph.error });
      const st = cleanStatus(body.status, "draft");
      if (st === null) return sendJSON(res, 400, { ok: false, error: "unknown status (use one of: " + QUOTE_STATUSES.join(", ") + ")" });
      const visits = readVisits();
      const v = {
        id: newId(),
        number: nextNumber(visits),
        client: String(body.client).trim(),
        address: String(body.address || "").trim(),
        trade,
        visitDate: body.visitDate || new Date().toISOString().slice(0, 10),
        status: st,
        observations: cleanList(body.observations),
        photoNotes: cleanList(body.photoNotes),
        photos: ph.photos,
        generated: body.generated || null,
        createdAt: new Date().toISOString()
      };
      visits.push(v);
      writeVisits(visits);
      return sendJSON(res, 201, { ok: true, visit: v });
    }
  }

  const vm = /^\/api\/visits\/([^/]+)(\/(duplicate|quotely-payload|send-to-quotely))?$/.exec(p);
  if (vm) {
    const id = vm[1];
    const visits = readVisits();
    const v = visits.find((x) => x.id === id);
    if (!v) return sendJSON(res, 404, { ok: false, error: "visit not found" });
    const sub = vm[3] || null;

    // The quotely handoff payload for this visit (mirrors quotely-ai's
    // POST /api/quotes/import contract). A sitevisit draft IS a quotely quote.
    if (m === "GET" && sub === "quotely-payload") {
      return sendJSON(res, 200, { ok: true, payload: Engine.quotelyPayload(v) });
    }

    // Push this visit's quote draft into quotely-ai's quote ledger.
    // Upserts on the visit id — re-sending updates the same quotely quote.
    if (m === "POST" && sub === "send-to-quotely") {
      if (!QUOTELY_URL) {
        return sendJSON(res, 400, { ok: false, error: "QUOTELY_URL not set — point it at your quotely-ai server (e.g. http://localhost:3001)" });
      }
      const payload = Engine.quotelyPayload(v);
      const r = await postJson(QUOTELY_URL + "/api/quotes/import", payload, 6000);
      if (!r.ok || !r.body || !r.body.quote) {
        return sendJSON(res, 502, { ok: false, error: "quotely import failed: " + ((r.body && r.body.error) || r.error || ("http " + r.status)) });
      }
      v.sentToQuotely = {
        quoteId: r.body.quote.id,
        quoteNumber: r.body.quote.number,
        created: Boolean(r.body.created),
        at: new Date().toISOString()
      };
      writeVisits(visits);
      return sendJSON(res, 200, { ok: true, created: r.body.created, quote: r.body.quote, visit: v });
    }

    // duplicate a visit (e.g. recurring maintenance at the same site)
    if (m === "POST" && sub === "duplicate") {
      const copy = JSON.parse(JSON.stringify(v));
      copy.id = newId();
      copy.number = nextNumber(visits);
      copy.visitDate = new Date().toISOString().slice(0, 10);
      copy.createdAt = new Date().toISOString();
      copy.status = "draft"; // a re-book is a fresh quote, not a fresh paid invoice
      delete copy.sentToQuotely; // the copy hasn't been sent to quotely-ai
      visits.push(copy);
      writeVisits(visits);
      return sendJSON(res, 201, { ok: true, visit: copy });
    }

    if (m === "DELETE") {
      writeVisits(visits.filter((x) => x.id !== id));
      return sendJSON(res, 200, { ok: true, deleted: id });
    }
    if (m === "GET") return sendJSON(res, 200, { visit: v });
    if (m === "PATCH") {
      const body = await readBody(req);
      if (body.observations !== undefined) v.observations = cleanList(body.observations);
      if (body.photoNotes !== undefined) v.photoNotes = cleanList(body.photoNotes);
      if (body.generated !== undefined) v.generated = body.generated;
      if (body.status !== undefined) {
        const st = cleanStatus(body.status, v.status || "draft");
        if (st === null) return sendJSON(res, 400, { ok: false, error: "unknown status (use one of: " + QUOTE_STATUSES.join(", ") + ")" });
        v.status = st;
      }
      if (body.photos !== undefined) {
        const ph = cleanPhotos(body.photos);
        if (!ph.ok) return sendJSON(res, 400, { ok: false, error: ph.error });
        v.photos = ph.photos;
      }
      if (body.client !== undefined && String(body.client).trim()) v.client = String(body.client).trim();
      if (body.address !== undefined) v.address = String(body.address).trim();
      writeVisits(visits);
      return sendJSON(res, 200, { ok: true, visit: v });
    }
  }

  if (p.startsWith("/api/")) return sendJSON(res, 404, { ok: false, error: "unknown endpoint" });
  return serveStatic(req, res, p);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => sendJSON(res, 500, { ok: false, error: e.message || "server error" }));
});

server.listen(PORT, () => console.log("SiteVisit AI listening on port " + PORT));
