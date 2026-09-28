/* SiteVisit AI front-end. No build step, no API keys. */
(function () {
  "use strict";

  var TRADES = ["Plumbing","Electrical","Painting","HVAC","Roofing","Landscaping","Carpentry","Flooring","General Handyman"];

  function api(path, opts) {
    opts = opts || {};
    return fetch(path, {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && j.error) || "request failed");
        return j;
      });
    });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function show(id) {
    ["view-list", "view-edit", "view-doc"].forEach(function (v) {
      document.getElementById(v).classList.toggle("hidden", v !== id);
    });
  }

  function money(n) {
    var v = Number(n);
    if (!isFinite(v)) return "$0.00";
    return "$" + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* ---------- list ---------- */
  function renderList() {
    show("view-list");
    api("/api/visits").then(function (j) {
      var el = document.getElementById("visit-list");
      if (!j.visits.length) {
        el.innerHTML = '<p class="muted">No visits yet. <a href="#/new">Log your first walkthrough</a>.</p>';
        return;
      }
      el.innerHTML = j.visits.map(function (v) {
        return '<div class="card"><h3><a href="#/visit/' + v.id + '">' + esc(v.client) + "</a></h3>" +
          '<div class="muted">' + esc(v.number) + " · " + esc(v.trade) + "</div>" +
          '<div class="muted" style="font-size:.85rem">' + esc(v.address || "no address") + " · " + esc(v.visitDate) + "</div>" +
          '<div class="muted" style="font-size:.82rem;margin-top:6px">' + v.observations.length + " observations" +
          (v.generated ? " · ⚡ work product ready" : "") + "</div></div>";
      }).join("");
    }).catch(function (e) {
      document.getElementById("visit-list").innerHTML = '<p class="muted">Error: ' + esc(e.message) + "</p>";
    });
  }

  /* ---------- editor ---------- */
  var wp = null; // current generated work product (editable)

  function dynRow(container, placeholder) {
    var div = document.createElement("div");
    div.className = "dyn-row";
    div.innerHTML = '<input type="text" placeholder="' + esc(placeholder) + '">' +
      '<button class="btn ghost" type="button">✕</button>';
    div.querySelector("button").addEventListener("click", function () { div.remove(); });
    container.appendChild(div);
  }

  function readRows(container) {
    var out = [];
    container.querySelectorAll("input").forEach(function (i) {
      if (i.value.trim()) out.push(i.value.trim());
    });
    return out;
  }

  function renderEdit() {
    show("view-edit");
    wp = null;
    document.getElementById("work-product").classList.add("hidden");
    document.getElementById("edit-msg").textContent = "";
    var sel = document.getElementById("v-trade");
    sel.innerHTML = TRADES.map(function (t) { return "<option>" + t + "</option>"; }).join("");
    document.getElementById("v-date").value = new Date().toISOString().slice(0, 10);
    document.getElementById("v-client").value = "";
    document.getElementById("v-address").value = "";
    var oc = document.getElementById("obs-list"), pc = document.getElementById("photo-list");
    oc.innerHTML = ""; pc.innerHTML = "";
    dynRow(oc, "e.g. master bath faucet drips constantly");
    dynRow(oc, "e.g. caulk failing around tub");
    dynRow(pc, "e.g. photo 1: water stain on ceiling");
  }

  document.getElementById("btn-add-obs").addEventListener("click", function () {
    dynRow(document.getElementById("obs-list"), "observation…");
  });
  document.getElementById("btn-add-photo").addEventListener("click", function () {
    dynRow(document.getElementById("photo-list"), "photo note…");
  });

  function totals() {
    var t = 0;
    (wp ? wp.items : []).forEach(function (it) { t += Number(it.qty || 0) * Number(it.unitPrice || 0); });
    document.getElementById("wp-total").textContent = "— estimated total " + money(t);
  }

  function renderWp() {
    if (!wp) return;
    document.getElementById("work-product").classList.remove("hidden");
    var tb = document.getElementById("wp-items");
    tb.innerHTML = "";
    wp.items.forEach(function (it, i) {
      var tr = document.createElement("tr");
      tr.innerHTML = '<td><input data-i="' + i + '" data-k="description" value="' + esc(it.description) + '"></td>' +
        '<td><input data-i="' + i + '" data-k="qty" type="number" min="0" step="any" value="' + esc(it.qty) + '" style="width:70px"></td>' +
        '<td><input data-i="' + i + '" data-k="unit" value="' + esc(it.unit) + '" style="width:70px"></td>' +
        '<td><input data-i="' + i + '" data-k="unitPrice" type="number" min="0" step="any" value="' + esc(it.unitPrice) + '" style="width:90px"></td>' +
        '<td><button class="btn ghost" data-del="' + i + '">✕</button></td>';
      tb.appendChild(tr);
    });
    tb.querySelectorAll("input").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var it = wp.items[Number(inp.getAttribute("data-i"))];
        it[inp.getAttribute("data-k")] = inp.type === "number" ? Number(inp.value) : inp.value;
        totals();
      });
    });
    tb.querySelectorAll("[data-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        wp.items.splice(Number(b.getAttribute("data-del")), 1);
        renderWp();
      });
    });
    totals();
    var pl = document.getElementById("wp-punch");
    pl.innerHTML = wp.punchList.map(function (p, i) {
      return '<li><input type="checkbox" data-p="' + i + '"' + (p.done ? " checked" : "") + "> <span>" + esc(p.task) + "</span></li>";
    }).join("");
    pl.querySelectorAll("input").forEach(function (c) {
      c.addEventListener("change", function () {
        wp.punchList[Number(c.getAttribute("data-p"))].done = c.checked;
      });
    });
    var fl = document.getElementById("wp-follow");
    fl.innerHTML = wp.followUps.map(function (f, i) {
      return '<li><input type="checkbox" data-f="' + i + '"' + (f.done ? " checked" : "") + "> <span>" + esc(f.task) +
        ' <span class="muted">— due ' + esc(f.due) + "</span></span></li>";
    }).join("");
    fl.querySelectorAll("input").forEach(function (c) {
      c.addEventListener("change", function () {
        wp.followUps[Number(c.getAttribute("data-f"))].done = c.checked;
      });
    });
  }

  document.getElementById("btn-add-item").addEventListener("click", function () {
    if (!wp) return;
    wp.items.push({ description: "", qty: 1, unit: "each", unitPrice: 0, source: "local" });
    renderWp();
  });

  document.getElementById("btn-generate").addEventListener("click", function () {
    var msg = document.getElementById("edit-msg");
    var trade = document.getElementById("v-trade").value;
    var obs = readRows(document.getElementById("obs-list"));
    if (!obs.length) { msg.textContent = "Add at least one observation first."; return; }
    msg.textContent = "Generating…";
    api("/api/generate", {
      method: "POST",
      body: { trade: trade, observations: obs, photoNotes: readRows(document.getElementById("photo-list")) }
    }).then(function (j) {
      wp = { items: j.items, punchList: j.punchList, followUps: j.followUps };
      renderWp();
      msg.textContent = "Work product generated from " + obs.length + " observations (" + j.source + " engine).";
      document.getElementById("work-product").scrollIntoView();
    }).catch(function (e) { msg.textContent = "Error: " + e.message; });
  });

  document.getElementById("btn-save-visit").addEventListener("click", function () {
    var msg = document.getElementById("edit-msg");
    var client = document.getElementById("v-client").value.trim();
    if (!client) { msg.textContent = "Client name is required."; return; }
    api("/api/visits", {
      method: "POST",
      body: {
        client: client,
        address: document.getElementById("v-address").value.trim(),
        trade: document.getElementById("v-trade").value,
        visitDate: document.getElementById("v-date").value,
        observations: readRows(document.getElementById("obs-list")),
        photoNotes: readRows(document.getElementById("photo-list")),
        generated: wp
      }
    }).then(function (j) { location.hash = "#/visit/" + j.visit.id; })
      .catch(function (e) { msg.textContent = "Error: " + e.message; });
  });

  document.getElementById("btn-print").addEventListener("click", function () { window.print(); });
  document.getElementById("btn-print2").addEventListener("click", function () { window.print(); });

  /* ---------- detail ---------- */
  function renderVisit(id) {
    show("view-doc");
    api("/api/visits/" + id).then(function (j) {
      var v = j.visit;
      document.getElementById("sv-title").textContent = v.client;
      document.getElementById("sv-num").textContent = v.number;
      document.getElementById("sv-meta").textContent =
        v.trade + " · " + (v.address || "no address") + " · visited " + v.visitDate;
      document.getElementById("sv-obs").innerHTML =
        v.observations.map(function (o) { return "<li>" + esc(o) + "</li>"; }).join("") || "<li class='muted'>none</li>";
      document.getElementById("sv-photos").innerHTML =
        v.photoNotes.map(function (o) { return "<li>" + esc(o) + "</li>"; }).join("") || "<li class='muted'>none</li>";
      var g = document.getElementById("sv-generated");
      if (!v.generated) {
        g.innerHTML = '<p class="muted">No work product generated for this visit yet.</p>';
        return;
      }
      var t = 0;
      v.generated.items.forEach(function (it) { t += Number(it.qty || 0) * Number(it.unitPrice || 0); });
      g.innerHTML = '<div class="panel"><h3>Quote draft — ' + money(t) + "</h3>" +
        '<table class="items"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Unit $</th></tr></thead><tbody>' +
        v.generated.items.map(function (it) {
          return "<tr><td>" + esc(it.description) + "</td><td>" + esc(it.qty) + "</td><td>" +
            esc(it.unit) + "</td><td>" + money(it.unitPrice) + "</td></tr>";
        }).join("") + "</tbody></table>" +
        "<h3>Punch list</h3><ul class='checklist'>" +
        v.generated.punchList.map(function (p) {
          return "<li>" + (p.done ? "☑" : "☐") + " " + esc(p.task) + "</li>";
        }).join("") + "</ul><h3>Follow-ups</h3><ul class='checklist'>" +
        v.generated.followUps.map(function (f) {
          return "<li>" + (f.done ? "☑" : "☐") + " " + esc(f.task) +
            ' <span class="muted">— due ' + esc(f.due) + "</span></li>";
        }).join("") + "</ul></div>";
    }).catch(function (e) {
      document.getElementById("sv-title").textContent = "Error: " + e.message;
    });
  }

  /* ---------- router ---------- */
  function route() {
    var h = location.hash || "#/";
    var m;
    if (h === "#/" || h === "") renderList();
    else if (h === "#/new") renderEdit();
    else if ((m = /^#\/visit\/(.+)$/.exec(h))) renderVisit(m[1]);
    else renderList();
  }
  window.addEventListener("hashchange", route);
  route();
})();
