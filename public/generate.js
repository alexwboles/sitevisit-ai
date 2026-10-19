/* SiteVisit AI work-product engine.
 * UMD module: required by server.js (Node) and usable in the browser.
 * Turns free-text site-visit observations into draft quote line items,
 * a punch list, and follow-up tasks. All local heuristics, no API keys.
 *
 * LINE-ITEM PRICING: sitevisit-ai does NOT keep its own keyword->price
 * bank. It consumes the canonical price bank owned by quotely-ai
 * (GET {quotely}/api/price-bank, versioned JSON). The server loads the
 * live bank when QUOTELY_URL is set, else the last cached copy, else the
 * shipped snapshot in price-bank.fallback.json (machine-generated from
 * quotely-ai, never hand-edited). Punch-list and follow-up rules below
 * are sitevisit-specific and stay here.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.SiteVisitEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TRADES = [
    "Plumbing", "Electrical", "Painting", "HVAC", "Roofing",
    "Landscaping", "Carpentry", "Flooring", "General Handyman"
  ];

  /* Shipped snapshot of the canonical bank (quotely-ai owned).
   * Regenerate with: node -e "const Q=require('<quotely>/public/generate.js');
   * require('fs').writeFileSync('public/price-bank.fallback.json',
   * JSON.stringify(Q.priceBank(),null,1))" */
  var FALLBACK = null;
  var FALLBACK_VERSION = null;
  try {
    if (typeof require !== "undefined") {
      FALLBACK = require("./price-bank.fallback.json");
      FALLBACK_VERSION = FALLBACK && FALLBACK.version;
    }
  } catch (e) { FALLBACK = null; }

  /* Active bank: set by the server at boot (live > cache > fallback).
   * The browser build never generates, so it stays null there. */
  var activeBank = null;
  var activeSource = "fallback";

  function setPriceBank(bank, source) {
    if (!bank || !Array.isArray(bank.items)) throw new Error("price bank needs an items array");
    activeBank = bank;
    activeSource = source || "quotely-live";
  }

  function currentBank() {
    return activeBank || FALLBACK;
  }

  function priceBankInfo() {
    var b = currentBank();
    return {
      source: activeBank ? activeSource : "fallback",
      version: (b && b.version) || FALLBACK_VERSION || null,
      itemCount: (b && b.items ? b.items.length : 0),
      trades: TRADES.slice()
    };
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /* Slice the canonical bank to one trade, in canonical order:
   * [{ k:[keywords], d:description, unit, price }]. */
  function lineBankFor(trade, bank) {
    bank = bank || currentBank();
    var out = [];
    ((bank && bank.items) || []).forEach(function (entry) {
      if ((entry.trades || []).indexOf(trade) === -1) return;
      out.push({
        k: entry.keys.slice(),
        d: entry.name,
        unit: entry.unit,
        price: entry.price
      });
    });
    return out;
  }

  /* Back-compat shape of the old hand-written LINE_BANK, built from the
   * shipped snapshot (machine-derived, never hand-edited). */
  var LINE_BANK = (function () {
    var m = {};
    TRADES.forEach(function (t) { m[t] = lineBankFor(t, FALLBACK); });
    return m;
  })();

  var PUNCH_RULES = [
    { k: ["paint"], t: "Touch up paint in all work areas" },
    { k: ["caulk"], t: "Re-caulk around fixtures and trim" },
    { k: ["tile", "grout"], t: "Clean and seal grout lines" },
    { k: ["floor", "hardwood", "carpet"], t: "Walk floors for scratches, chips, or damage" },
    { k: ["drywall", "patch"], t: "Sand and spot-prime all patches" },
    { k: ["plant", "mulch", "landscap", "sod"], t: "Water in new plantings; confirm mulch depth" },
    { k: ["roof", "shingle", "nail"], t: "Magnet-sweep yard and driveway for nails/debris" },
    { k: ["furnace", "ac ", "hvac", "thermostat"], t: "Replace filter; confirm thermostat programming with client" },
    { k: ["electrical", "outlet", "switch", "fixture"], t: "Test every outlet, switch, and fixture touched" },
    { k: ["plumb", "faucet", "toilet", "drain"], t: "Run water at every fixture; check for leaks under sinks" }
  ];

  var PUNCH_GENERIC = [
    "Walk through finished work with client",
    "Remove all debris, packaging, and old parts",
    "Wipe down all work areas",
    "Confirm client knows how to operate anything new"
  ];

  var FOLLOWUP_BASE = [
    { task: "Send quote draft to client", dueDays: 2 },
    { task: "Order materials / confirm supplier lead times", dueDays: 3 },
    { task: "Schedule work date with client", dueDays: 5 },
    { task: "Follow up if no reply to quote", dueDays: 7 }
  ];

  var FOLLOWUP_RULES = [
    { k: ["permit"], task: "Check permit requirements with city/county", dueDays: 2 },
    { k: ["hoa"], task: "Submit HOA approval paperwork", dueDays: 3 },
    { k: ["insurance", "certificate"], task: "Send certificate of insurance to client", dueDays: 2 },
    { k: ["subcontractor", "sub "], task: "Confirm subcontractor availability", dueDays: 3 },
    { k: ["asbestos", "lead paint", "mold"], task: "Arrange hazardous-material testing before work", dueDays: 2 }
  ];

  function dueDate(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function keywordHit(keys, text) {
    return keys.some(function (kw) {
      return new RegExp("\\b" + escapeRegExp(kw) + "s?\\b", "i").test(text);
    });
  }

  /* sitevisit status -> quotely quote status (the handoff contract). */
  var STATUS_TO_QUOTELY = {
    draft: "draft",
    sent: "sent",
    approved: "won",
    scheduled: "won",
    invoiced: "won",
    paid: "won"
  };
  function quotelyStatusFor(sitevisitStatus) {
    return STATUS_TO_QUOTELY[sitevisitStatus] || "draft";
  }

  /* Build the quotely import payload for a saved visit (the handoff
   * contract — mirrors POST /api/quotes/import on quotely-ai). */
  function quotelyPayload(visit) {
    var v = visit || {};
    var g = v.generated || {};
    var totals = g.totals || {};
    var items = (g.items || []).map(function (it) {
      return {
        description: String(it.description || ""),
        qty: Number(it.qty) || 0,
        unit: String(it.unit || "each"),
        unitPrice: Number(it.unitPrice) || 0
      };
    });
    var photos = (v.photos || []).slice(0, 8).map(function (p) {
      return { name: String(p.name || "photo"), dataUrl: String(p.dataUrl || "") };
    });
    var openFollowUps = (g.followUps || []).filter(function (f) { return !f.done && f.due; })
      .sort(function (a, b) { return String(a.due).localeCompare(String(b.due)); });
    return {
      source: "sitevisit-ai",
      visitId: v.id || "",
      visitNumber: v.number || "",
      customer: v.client || "",
      address: v.address || "",
      trade: v.trade || "General Handyman",
      description: ((v.observations || []).concat(v.photoNotes || [])).join("\n"),
      items: items,
      photos: photos,
      taxPct: Number(totals.taxPct) || 0,
      discountPct: Number(totals.discountPct) || 0,
      followUpDate: openFollowUps.length ? openFollowUps[0].due : "",
      notes: "",
      status: quotelyStatusFor(v.status)
    };
  }

  function generateWorkProduct(trade, observations, photoNotes, bank) {
    var text = ((observations || []).concat(photoNotes || [])).join("\n").toLowerCase();
    var items = [];
    var bankItems = lineBankFor(trade, bank || currentBank());
    bankItems.forEach(function (entry) {
      if (keywordHit(entry.k, text)) {
        items.push({
          description: entry.d, qty: 1, unit: entry.unit,
          unitPrice: entry.price, source: "local"
        });
      }
    });
    if (!items.length) {
      items.push({
        description: "Site-visit follow-up — scope to be confirmed (edit me)",
        qty: 1, unit: "job", unitPrice: 0, source: "local"
      });
    }
    var punch = [];
    PUNCH_RULES.forEach(function (r) {
      if (r.k.some(function (kw) { return text.indexOf(kw) !== -1; })) {
        punch.push({ task: r.t, done: false });
      }
    });
    PUNCH_GENERIC.forEach(function (t) { punch.push({ task: t, done: false }); });
    var followUps = FOLLOWUP_BASE.map(function (f) {
      return { task: f.task, due: dueDate(f.dueDays), done: false };
    });
    FOLLOWUP_RULES.forEach(function (r) {
      if (r.k.some(function (kw) { return text.indexOf(kw) !== -1; })) {
        followUps.push({ task: r.task, due: dueDate(r.dueDays), done: false });
      }
    });
    return { items: items, punchList: punch, followUps: followUps, source: "local" };
  }

  return {
    TRADES: TRADES,
    LINE_BANK: LINE_BANK,
    setPriceBank: setPriceBank,
    priceBankInfo: priceBankInfo,
    lineBankFor: lineBankFor,
    quotelyPayload: quotelyPayload,
    quotelyStatusFor: quotelyStatusFor,
    generateWorkProduct: generateWorkProduct,
    quoteTotals: quoteTotals
  };

  /* ---------- quote totals: subtotal -> discount -> tax ----------
   * Pure function: items [{qty, unitPrice}], taxPct >= 0, discountPct 0..100. */
  function quoteTotals(items, taxPct, discountPct) {
    var subtotal = 0;
    (items || []).forEach(function (it) {
      subtotal += Number(it.qty || 0) * Number(it.unitPrice || 0);
    });
    subtotal = Math.round(subtotal * 100) / 100;
    var d = Math.min(100, Math.max(0, Number(discountPct) || 0));
    var t = Math.max(0, Number(taxPct) || 0);
    var discountAmt = Math.round(subtotal * (d / 100) * 100) / 100;
    var taxable = subtotal - discountAmt;
    var taxAmt = Math.round(taxable * (t / 100) * 100) / 100;
    return {
      subtotal: subtotal,
      discountPct: d,
      discountAmt: discountAmt,
      taxPct: t,
      taxAmt: taxAmt,
      total: Math.round((taxable + taxAmt) * 100) / 100
    };
  }
});
