/* Test stub: fake quotely-ai for sitevisit-ai pipeline tests. NOT shipped. */
"use strict";
const http = require("http");
const port = Number(process.argv[2] || 3498);
const imports = [];
const bank = {
  version: "9.9.9-stub",
  currency: "USD",
  updated: "2026-10-19",
  tripFee: 65,
  trades: ["Plumbing", "General Handyman"],
  items: [
    { trades: ["Plumbing"], keys: ["faucet"], name: "Faucet replacement (parts + labor)", unit: "each", price: 145 },
    { trades: ["Plumbing"], keys: ["leak"], name: "Leak / pipe repair", unit: "each", price: 175 },
    { trades: ["General Handyman"], keys: ["caulk"], name: "Caulk / seal refresh", unit: "each", price: 65 }
  ]
};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let body = "";
  req.on("data", c => { body += c; });
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    const send = (code, obj) => { res.writeHead(code); res.end(JSON.stringify(obj)); };
    if (req.method === "GET" && u.pathname === "/api/price-bank") {
      return send(200, Object.assign({ servedBy: "quotely-ai-stub" }, bank));
    }
    if (req.method === "POST" && u.pathname === "/api/quotes/import") {
      let j = {};
      try { j = JSON.parse(body || "{}"); } catch (e) { return send(400, { error: "bad json" }); }
      imports.push(j);
      const created = imports.length === 1;
      return send(created ? 201 : 200, {
        quote: { id: "q_stub1", number: "Q-2026-9001", customer: j.customer, status: j.status || "draft" },
        created
      });
    }
    if (req.method === "GET" && u.pathname === "/stub/imports") {
      return send(200, { imports });
    }
    return send(404, {});
  });
});
server.listen(port, () => console.log("stub quotely-ai on " + port));
