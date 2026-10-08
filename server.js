/*
 * SiteVisit AI - tiny zero-dependency Node server.
 * Job walkthrough notes -> quote draft + punch list + follow-ups.
 * Serves the single-page app and a small JSON API.
 * Everything works with NO API key and NO network services.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const Engine = require("./public/generate.js");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "visits.json");

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

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  const m = req.method;

  if (m === "GET" && p === "/api/health") {
    return sendJSON(res, 200, { ok: true, service: "sitevisit-ai", openai: false });
  }

  if (m === "POST" && p === "/api/generate") {
    const body = await readBody(req);
    const trade = body.trade || "General Handyman";
    if (!Engine.TRADES.includes(trade)) {
      return sendJSON(res, 400, { ok: false, error: "unknown trade: " + trade });
    }
    const wp = Engine.generateWorkProduct(trade, cleanList(body.observations), cleanList(body.photoNotes));
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
      ["number", "client", "address", "trade", "visitDate", "observations", "lineItems", "quoteSubtotal", "followUpsDone", "followUpsTotal"]
    ].concat(visits.map((v) => [
      v.number, v.client, v.address, v.trade, v.visitDate,
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

  if (p === "/api/visits") {
    if (m === "GET") {
      return sendJSON(res, 200, { visits: readVisits() });
    }
    if (m === "POST") {
      const body = await readBody(req);
      if (!String(body.client || "").trim()) {
        return sendJSON(res, 400, { ok: false, error: "client name required" });
      }
      const trade = body.trade || "General Handyman";
      if (!Engine.TRADES.includes(trade)) {
        return sendJSON(res, 400, { ok: false, error: "unknown trade: " + trade });
      }
      const visits = readVisits();
      const v = {
        id: newId(),
        number: nextNumber(visits),
        client: String(body.client).trim(),
        address: String(body.address || "").trim(),
        trade,
        visitDate: body.visitDate || new Date().toISOString().slice(0, 10),
        observations: cleanList(body.observations),
        photoNotes: cleanList(body.photoNotes),
        generated: body.generated || null,
        createdAt: new Date().toISOString()
      };
      visits.push(v);
      writeVisits(visits);
      return sendJSON(res, 201, { ok: true, visit: v });
    }
  }

  const vm = /^\/api\/visits\/([^/]+)(\/duplicate)?$/.exec(p);
  if (vm) {
    const id = vm[1];
    const visits = readVisits();
    const v = visits.find((x) => x.id === id);
    if (!v) return sendJSON(res, 404, { ok: false, error: "visit not found" });

    // duplicate a visit (e.g. recurring maintenance at the same site)
    if (m === "POST" && vm[2] === "/duplicate") {
      const copy = JSON.parse(JSON.stringify(v));
      copy.id = newId();
      copy.number = nextNumber(visits);
      copy.visitDate = new Date().toISOString().slice(0, 10);
      copy.createdAt = new Date().toISOString();
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
