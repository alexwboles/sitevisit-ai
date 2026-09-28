/* SiteVisit AI work-product engine.
 * UMD module: required by server.js (Node) and usable in the browser.
 * Turns free-text site-visit observations into draft quote line items,
 * a punch list, and follow-up tasks. All local heuristics, no API keys.
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

  // keyword -> line item bank per trade. Hand-written for this project.
  var LINE_BANK = {
    "Plumbing": [
      { k: ["faucet", "tap"], d: "Faucet replacement (parts + labor)", unit: "each", price: 145 },
      { k: ["leak", "drip"], d: "Leak diagnosis and repair", unit: "each", price: 120 },
      { k: ["water heater", "hot water"], d: "Water heater install (40-gal)", unit: "each", price: 950 },
      { k: ["toilet", "wax ring"], d: "Toilet reset / replacement", unit: "each", price: 220 },
      { k: ["drain", "clog"], d: "Drain cleaning / auger service", unit: "each", price: 135 },
      { k: ["pipe", "repipe"], d: "Pipe repair / section replacement", unit: "each", price: 180 },
      { k: ["sump"], d: "Sump pump install / replacement", unit: "each", price: 425 }
    ],
    "Electrical": [
      { k: ["outlet", "receptacle"], d: "Outlet replacement / new outlet", unit: "each", price: 95 },
      { k: ["panel", "breaker"], d: "Panel / breaker work", unit: "each", price: 280 },
      { k: ["light", "fixture", "ceiling fan"], d: "Light fixture install", unit: "each", price: 140 },
      { k: ["switch"], d: "Switch replacement / 3-way wiring", unit: "each", price: 85 },
      { k: ["ev charger", "car charger"], d: "EV charger circuit install", unit: "each", price: 650 },
      { k: ["smoke detector", "co detector"], d: "Smoke/CO detector install", unit: "each", price: 75 },
      { k: ["troubleshoot", "no power"], d: "Electrical troubleshooting (first hour)", unit: "hour", price: 110 }
    ],
    "Painting": [
      { k: ["bedroom", "room"], d: "Interior room paint (2 coats)", unit: "room", price: 380 },
      { k: ["exterior", "siding"], d: "Exterior painting", unit: "sq ft", price: 2.5 },
      { k: ["drywall", "patch"], d: "Drywall patch and blend", unit: "each", price: 90 },
      { k: ["ceiling", "popcorn"], d: "Ceiling repaint / texture repair", unit: "each", price: 220 },
      { k: ["cabinet"], d: "Cabinet refinishing (per linear ft)", unit: "lin ft", price: 65 },
      { k: ["deck", "fence"], d: "Deck / fence stain", unit: "sq ft", price: 2.0 },
      { k: ["trim", "baseboard"], d: "Trim and baseboard enamel", unit: "lin ft", price: 4.5 }
    ],
    "HVAC": [
      { k: ["furnace"], d: "Furnace replacement (80% AFUE)", unit: "each", price: 3200 },
      { k: ["ac ", "air conditioner", "condenser"], d: "AC condenser replacement", unit: "each", price: 2800 },
      { k: ["thermostat", "nest", "ecobee"], d: "Smart thermostat install", unit: "each", price: 195 },
      { k: ["duct"], d: "Duct repair / sealing", unit: "each", price: 240 },
      { k: ["tune-up", "tuneup", "maintenance"], d: "Seasonal HVAC tune-up", unit: "each", price: 129 },
      { k: ["filter"], d: "Filter replacement + system check", unit: "each", price: 65 },
      { k: ["mini split", "ductless"], d: "Ductless mini-split install (per head)", unit: "each", price: 2100 }
    ],
    "Roofing": [
      { k: ["shingle", "re-roof", "reroof"], d: "Asphalt shingle re-roof", unit: "sq", price: 425 },
      { k: ["repair", "patch"], d: "Roof leak repair", unit: "each", price: 350 },
      { k: ["gutter"], d: "Gutter install / replacement", unit: "lin ft", price: 12 },
      { k: ["flashing", "chimney"], d: "Flashing repair / replacement", unit: "each", price: 275 },
      { k: ["skylight"], d: "Skylight replacement", unit: "each", price: 850 },
      { k: ["vent"], d: "Roof vent install", unit: "each", price: 180 },
      { k: ["inspection"], d: "Roof inspection + report", unit: "each", price: 149 }
    ],
    "Landscaping": [
      { k: ["mow", "lawn"], d: "Lawn renovation / sod (per sq ft)", unit: "sq ft", price: 1.8 },
      { k: ["mulch"], d: "Mulch bed install", unit: "cu yd", price: 85 },
      { k: ["plant", "shrub", "bed"], d: "Planting bed install", unit: "each", price: 320 },
      { k: ["tree", "trim"], d: "Tree trimming (per tree)", unit: "each", price: 260 },
      { k: ["sprinkler", "irrigation"], d: "Irrigation zone add / repair", unit: "zone", price: 450 },
      { k: ["paver", "patio", "walkway"], d: "Paver patio / walkway", unit: "sq ft", price: 16 },
      { k: ["cleanup", "leaves", "debris"], d: "Seasonal yard cleanup", unit: "each", price: 280 }
    ],
    "Carpentry": [
      { k: ["deck"], d: "Deck build / rebuild", unit: "sq ft", price: 28 },
      { k: ["door"], d: "Door hang / replacement", unit: "each", price: 240 },
      { k: ["trim", "casing"], d: "Trim / casing install", unit: "lin ft", price: 7.5 },
      { k: ["shelf", "closet"], d: "Custom shelving / closet build", unit: "each", price: 480 },
      { k: ["fence"], d: "Fence build / repair", unit: "lin ft", price: 32 },
      { k: ["rot", "siding"], d: "Rot repair / siding section", unit: "each", price: 310 },
      { k: ["stairs", "railing"], d: "Stair / railing repair", unit: "each", price: 390 }
    ],
    "Flooring": [
      { k: ["hardwood", "oak"], d: "Hardwood install / refinish", unit: "sq ft", price: 9.5 },
      { k: ["laminate", "vinyl", "lvp"], d: "LVP / laminate install", unit: "sq ft", price: 6.5 },
      { k: ["tile"], d: "Tile install", unit: "sq ft", price: 11 },
      { k: ["carpet"], d: "Carpet install (per sq yd)", unit: "sq yd", price: 38 },
      { k: ["grout"], d: "Grout repair / re-grout", unit: "sq ft", price: 4 },
      { k: ["subfloor", "squeak"], d: "Subfloor repair", unit: "each", price: 220 },
      { k: ["baseboard", "transition"], d: "Baseboard / transition install", unit: "lin ft", price: 5.5 }
    ],
    "General Handyman": [
      { k: ["drywall", "patch"], d: "Drywall patch and paint blend", unit: "each", price: 110 },
      { k: ["caulk"], d: "Caulk / seal refresh", unit: "each", price: 65 },
      { k: ["gutter"], d: "Gutter cleaning", unit: "each", price: 150 },
      { k: ["furniture", "assemble"], d: "Furniture assembly", unit: "each", price: 80 },
      { k: ["tv mount", "mount"], d: "TV / heavy item mounting", unit: "each", price: 95 },
      { k: ["pressure wash", "power wash"], d: "Pressure washing", unit: "sq ft", price: 0.35 },
      { k: ["odd job", "misc", "various"], d: "Half-day handyman block", unit: "half-day", price: 280 }
    ]
  };

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

  function generateWorkProduct(trade, observations, photoNotes) {
    var text = ((observations || []).concat(photoNotes || [])).join("\n").toLowerCase();
    var items = [];
    var bank = LINE_BANK[trade] || [];
    bank.forEach(function (entry) {
      var hit = entry.k.some(function (kw) { return text.indexOf(kw) !== -1; });
      if (hit) {
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
    generateWorkProduct: generateWorkProduct
  };
});
