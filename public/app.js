/* SiteVisit AI front-end. No build step, no API keys. */
(function () {
  "use strict";

  var TRADES = ["Plumbing","Electrical","Painting","HVAC","Roofing","Landscaping","Carpentry","Flooring","General Handyman"];

  /* Quote pipeline — mirrors QUOTE_STATUSES in server.js. */
  var STATUSES = [
    { id: "draft", label: "Draft" },
    { id: "sent", label: "Sent" },
    { id: "approved", label: "Approved" },
    { id: "scheduled", label: "Scheduled" },
    { id: "invoiced", label: "Invoiced" },
    { id: "paid", label: "Paid" }
  ];

  function statusOf(v) {
    var s = (v && v.status) || "draft";
    return STATUSES.some(function (x) { return x.id === s; }) ? s : "draft";
  }

  function statusLabel(id) {
    var hit = STATUSES.filter(function (x) { return x.id === id; })[0];
    return hit ? hit.label : id;
  }

  function statusPill(v) {
    var s = statusOf(v);
    return '<span class="status st-' + s + '">' + esc(statusLabel(s)) + "</span>";
  }

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

  /* Build a ready-to-send client message for a quote draft. */
  function buildClientMessage(v, st) {
    var lines = ["Hi " + v.client + " — here's your quote from my visit on " + v.visitDate +
      " (" + v.number + "):", ""];
    (v.generated.items || []).forEach(function (it) {
      lines.push(it.qty + "× " + it.description + " — " + money(Number(it.qty || 0) * Number(it.unitPrice || 0)));
    });
    lines.push("");
    lines.push("Subtotal: " + money(st.subtotal));
    if (st.discountAmt) lines.push("Discount (" + st.discountPct + "%): −" + money(st.discountAmt));
    if (st.taxAmt) lines.push("Tax (" + st.taxPct + "%): " + money(st.taxAmt));
    lines.push("Total: " + money(st.total));
    lines.push("");
    lines.push("Reply to this message if you'd like to move ahead — I can get you scheduled this week.");
    return lines.join("\n");
  }

  function copyClientMessage(v, st) {
    var text = buildClientMessage(v, st);
    function done() { return true; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
      return done();
    }
    fallbackCopy(text);
    return done();
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* manual copy */ }
    ta.remove();
  }

  /* ---------- list ---------- */
  var allVisits = [];

  /* Follow-up health for a visit: overdue / due-within-7-days badges. */
  function followUpBadges(v) {
    var ups = ((v.generated || {}).followUps || []).filter(function (f) { return !f.done && f.due; });
    if (!ups.length) return "";
    var today = new Date().toISOString().slice(0, 10);
    var soon = new Date(); soon.setDate(soon.getDate() + 7);
    var soonStr = soon.toISOString().slice(0, 10);
    var overdue = ups.filter(function (f) { return f.due < today; }).length;
    var dueSoon = ups.filter(function (f) { return f.due >= today && f.due <= soonStr; }).length;
    var out = "";
    if (overdue) out += '<span class="exp exp-over">' + overdue + " overdue</span>";
    if (dueSoon) out += '<span class="exp exp-soon">' + dueSoon + " due soon</span>";
    return out;
  }

  function visitCard(v) {
    var cover = v.coverPhoto
      ? '<a class="jobcover" href="#/visit/' + v.id + '"><img src="' + v.coverPhoto + '" alt="Site photo — ' + esc(v.client) + '" loading="lazy">' +
        (v.photoCount > 1 ? '<span class="cover-count">' + v.photoCount + " photos</span>" : "") + "</a>"
      : '<a class="jobcover nocover" href="#/visit/' + v.id + '"><span>No photos yet</span></a>';
    return '<div class="card jobcard">' + cover +
      '<div class="ticket-no">' + esc(v.number) + "</div>" +
      '<h3><a href="#/visit/' + v.id + '">' + esc(v.client) + "</a></h3>" +
      '<div class="ticket-meta"><span class="trade">' + esc(v.trade) + "</span>" +
      esc(v.address || "no address") + " · " + esc(v.visitDate) + "</div>" +
      '<div class="ticket-foot"><span>' + v.observations.length + " observations</span>" +
      statusPill(v) +
      followUpBadges(v) +
      (v.generated ? '<span class="ready">Work product ready</span>' : "<span></span>") + "</div></div>";
  }

  function renderPhotoFeed() {
    var wrap = document.getElementById("photo-feed-wrap");
    api("/api/photos/recent?limit=12").then(function (j) {
      var photos = (j && j.photos) || [];
      if (!photos.length) { wrap.classList.add("hidden"); return; }
      wrap.classList.remove("hidden");
      document.getElementById("photo-feed").innerHTML = photos.map(function (p) {
        return '<a class="feed-item" href="#/visit/' + p.visitId + '" title="' + esc(p.client) + " — " + esc(p.name) + '">' +
          '<img src="' + p.dataUrl + '" alt="' + esc(p.name) + '" loading="lazy">' +
          '<span class="feed-cap"><strong>' + esc(p.client) + "</strong>" + esc(p.name) + "</span></a>";
      }).join("");
    }).catch(function () { wrap.classList.add("hidden"); });
  }

  function applyVisitFilter() {
    var q = document.getElementById("visit-search").value.trim().toLowerCase();
    var tr = document.getElementById("visit-trade-filter").value;
    var st = document.getElementById("visit-status-filter").value;
    var list = allVisits.filter(function (v) {
      if (tr && v.trade !== tr) return false;
      if (st && statusOf(v) !== st) return false;
      if (!q) return true;
      var hay = (v.client + " " + v.number + " " + (v.address || "") + " " + v.trade).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    var el = document.getElementById("visit-list");
    if (!allVisits.length) {
      el.innerHTML = '<p class="muted">No visits yet. <a href="#/new">Log your first walkthrough</a>.</p>';
    } else if (!list.length) {
      el.innerHTML = '<p class="muted">No visits match your search.</p>';
    } else {
      el.innerHTML = list.map(visitCard).join("");
    }
  }

  function renderList() {
    show("view-list");
    api("/api/price-bank").then(function (b) {
      var el = document.getElementById("bank-src");
      if (el && b && b.version) {
        el.textContent = "Price bank v" + b.version + " (" +
          (b.source === "quotely-live" ? "live from Quotely" : b.source === "cache" ? "cached copy" : "shipped snapshot") + ")";
      }
    }).catch(function () { /* bank info is informational only */ });
    var sel = document.getElementById("visit-trade-filter");
    if (!sel.options.length) {
      sel.innerHTML = '<option value="">All trades</option>' +
        TRADES.map(function (t) { return "<option>" + t + "</option>"; }).join("");
    }
    var ssel = document.getElementById("visit-status-filter");
    if (!ssel.options.length) {
      ssel.innerHTML = '<option value="">All statuses</option>' +
        STATUSES.map(function (s) { return '<option value="' + s.id + '">' + s.label + "</option>"; }).join("");
    }
    api("/api/visits").then(function (j) {
      allVisits = j.visits;
      applyVisitFilter();
      renderPhotoFeed();
    }).catch(function (e) {
      document.getElementById("visit-list").innerHTML = '<p class="muted">Error: ' + esc(e.message) + "</p>";
    });
  }

  document.getElementById("visit-search").addEventListener("input", applyVisitFilter);
  document.getElementById("visit-trade-filter").addEventListener("change", applyVisitFilter);
  document.getElementById("visit-status-filter").addEventListener("change", applyVisitFilter);

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
    photoBlobs = [];
    renderPhotoThumbs();
    document.getElementById("work-product").classList.add("hidden");
    document.getElementById("edit-msg").textContent = "";
    document.getElementById("wp-tax").value = "0";
    document.getElementById("wp-discount").value = "0";
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

  /* ---------- photo attachments (resized client-side, stored with the visit) ---------- */
  var photoBlobs = []; // staged {name, dataUrl} for the visit being edited

  function renderPhotoThumbs() {
    var box = document.getElementById("photo-thumbs");
    box.innerHTML = "";
    photoBlobs.forEach(function (p, i) {
      var fig = document.createElement("figure");
      fig.className = "photo-thumb";
      var img = document.createElement("img");
      img.src = p.dataUrl; img.alt = p.name;
      var cap = document.createElement("figcaption");
      cap.textContent = p.name.length > 18 ? p.name.slice(0, 16) + "…" : p.name;
      var rm = document.createElement("button");
      rm.type = "button"; rm.className = "btn ghost"; rm.textContent = "✕";
      rm.addEventListener("click", function () { photoBlobs.splice(i, 1); renderPhotoThumbs(); });
      fig.appendChild(img); fig.appendChild(cap); fig.appendChild(rm);
      box.appendChild(fig);
    });
  }

  function stagePhoto(file) {
    if (!file || !file.type || file.type.indexOf("image/") !== 0) return;
    var img = new Image();
    img.onerror = function () {
      URL.revokeObjectURL(img.src);
      var msg = document.getElementById("edit-msg");
      if (msg) msg.textContent = "Could not load \"" + (file.name || "photo") + "\" — the file may be corrupt.";
    };
    img.onload = function () {
      var max = 900, scale = Math.min(1, max / Math.max(img.width, img.height));
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      photoBlobs.push({ name: file.name || "photo", dataUrl: c.toDataURL("image/jpeg", 0.75) });
      renderPhotoThumbs();
    };
    img.src = URL.createObjectURL(file);
  }

  document.getElementById("v-photofiles").addEventListener("change", function (e) {
    Array.prototype.forEach.call(e.target.files || [], stagePhoto);
    e.target.value = "";
  });

  function readTaxDiscount() {
    return {
      tax: Number(document.getElementById("wp-tax").value) || 0,
      discount: Number(document.getElementById("wp-discount").value) || 0
    };
  }

  function totals() {
    var td = readTaxDiscount();
    var t = window.SiteVisitEngine
      ? window.SiteVisitEngine.quoteTotals(wp ? wp.items : [], td.tax, td.discount)
      : { subtotal: 0, taxAmt: 0, discountAmt: 0, total: 0, taxPct: td.tax, discountPct: td.discount };
    if (wp) wp.totals = t;
    document.getElementById("wp-total").textContent = money(t.total);
    document.getElementById("wp-breakdown").innerHTML =
      '<div class="trow"><span>Subtotal</span><span>' + money(t.subtotal) + "</span></div>" +
      (t.discountAmt ? '<div class="trow"><span>Discount (' + t.discountPct + '%)</span><span>−' + money(t.discountAmt) + "</span></div>" : "") +
      (t.taxAmt ? '<div class="trow"><span>Tax (' + t.taxPct + '%)</span><span>' + money(t.taxAmt) + "</span></div>" : "") +
      '<div class="trow grand"><span>Total</span><span>' + money(t.total) + "</span></div>";
  }

  document.getElementById("wp-tax").addEventListener("input", totals);
  document.getElementById("wp-discount").addEventListener("input", totals);

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
        photos: photoBlobs,
        generated: wp
      }
    }).then(function (j) { location.hash = "#/visit/" + j.visit.id; })
      .catch(function (e) { msg.textContent = "Error: " + e.message; });
  });

  document.getElementById("btn-print").addEventListener("click", function () { window.print(); });
  document.getElementById("btn-print2").addEventListener("click", function () { window.print(); });

  /* ---------- detail ---------- */
  var currentVisit = null;

  function isOverdue(f) {
    if (f.done || !f.due) return false;
    return f.due < new Date().toISOString().slice(0, 10);
  }

  function renderGenerated(v) {
    var g = document.getElementById("sv-generated");
    if (!v.generated) {
      g.innerHTML = '<p class="muted">No work product generated for this visit yet.</p>';
      return;
    }
    var st = v.generated.totals || { subtotal: 0, discountPct: 0, discountAmt: 0, taxPct: 0, taxAmt: 0, total: 0 };
    // recompute so old visits (saved before tax/discount existed) still add up
    if (window.SiteVisitEngine) {
      st = window.SiteVisitEngine.quoteTotals(v.generated.items, st.taxPct || 0, st.discountPct || 0);
    }
    g.innerHTML = '<div class="quote-sheet"><div class="quote-head"><h2>Quote draft</h2>' +
      '<span class="quote-total">' + money(st.total) + "</span></div>" +
      '<div class="status-row"><label>Quote status <select id="sv-status" aria-label="Quote status">' +
      STATUSES.map(function (s) {
        return '<option value="' + s.id + '"' + (statusOf(v) === s.id ? " selected" : "") + ">" + s.label + "</option>";
      }).join("") + '</select></label> <span class="muted small" id="sv-status-saved"></span></div>' +
      '<div class="table-scroll"><table class="items"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Unit $</th></tr></thead><tbody>' +
      v.generated.items.map(function (it) {
        return "<tr><td>" + esc(it.description) + "</td><td>" + esc(it.qty) + "</td><td>" +
          esc(it.unit) + "</td><td>" + money(it.unitPrice) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<div class="totals-breakdown">' +
      '<div class="trow"><span>Subtotal</span><span>' + money(st.subtotal) + "</span></div>" +
      (st.discountAmt ? '<div class="trow"><span>Discount (' + st.discountPct + '%)</span><span>−' + money(st.discountAmt) + "</span></div>" : "") +
      (st.taxAmt ? '<div class="trow"><span>Tax (' + st.taxPct + '%)</span><span>' + money(st.taxAmt) + "</span></div>" : "") +
      '<div class="trow grand"><span>Total</span><span>' + money(st.total) + "</span></div></div>" +
      "<h3>Punch list <span class='muted' id='sv-punch-saved'></span></h3><ul class='checklist'>" +
      v.generated.punchList.map(function (p, i) {
        return '<li class="' + (p.done ? "done" : "") + '"><label><input type="checkbox" data-kind="punch" data-i="' + i + '"' +
          (p.done ? " checked" : "") + "> <span>" + esc(p.task) + "</span></label></li>";
      }).join("") + "</ul><h3>Follow-ups <span class='muted' id='sv-follow-saved'></span></h3><ul class='checklist'>" +
      v.generated.followUps.map(function (f, i) {
        var od = isOverdue(f);
        return '<li class="' + (f.done ? "done" : od ? "overdue" : "") + '"><label><input type="checkbox" data-kind="follow" data-i="' + i + '"' +
          (f.done ? " checked" : "") + "> <span>" + esc(f.task) +
          ' <span class="muted">— due ' + esc(f.due) + (od ? ' <strong class="od-tag">OVERDUE</strong>' : "") + "</span></span></label>" +
          ' <input type="date" class="due-edit" data-due="' + i + '" value="' + esc(f.due || "") + '" aria-label="Due date for ' + esc(f.task) + '"' + (f.done ? " disabled" : "") + ">" +
          ' <button class="btn ghost small" data-rm-follow="' + i + '" aria-label="Remove follow-up">✕</button></li>';
      }).join("") + "</ul>" +
      '<div class="add-follow"><input id="sv-new-follow-task" type="text" placeholder="New follow-up, e.g. Call HOA for approval" aria-label="New follow-up task">' +
      ' <input id="sv-new-follow-due" type="date" aria-label="Due date">' +
      ' <button id="sv-add-follow" class="btn small">+ Add follow-up</button></div></div>';
    // persist helper shared by every bookkeeping change below
    function persistGenerated(done) {
      api("/api/visits/" + v.id, { method: "PATCH", body: { generated: v.generated } })
        .then(function () { done && done("saved"); })
        .catch(function () { done && done("save failed"); });
    }
    // persist check-offs live
    g.querySelectorAll("input[data-kind]").forEach(function (c) {
      c.addEventListener("change", function () {
        var kind = c.getAttribute("data-kind"), i = Number(c.getAttribute("data-i"));
        var item = kind === "punch" ? v.generated.punchList[i] : v.generated.followUps[i];
        item.done = c.checked;
        var li = c.closest("li");
        li.classList.toggle("done", c.checked);
        if (kind === "follow") {
          li.classList.toggle("overdue", !c.checked && isOverdue(item));
          li.querySelector(".od-tag") && li.querySelector(".od-tag").remove();
          if (!c.checked && isOverdue(item)) {
            var tag = document.createElement("strong");
            tag.className = "od-tag"; tag.textContent = "OVERDUE";
            li.querySelector(".muted").appendChild(document.createTextNode(" "));
            li.querySelector(".muted").appendChild(tag);
          }
          var dueInput = li.querySelector("[data-due]");
          if (dueInput) dueInput.disabled = c.checked;
        }
        var saved = document.getElementById(kind === "punch" ? "sv-punch-saved" : "sv-follow-saved");
        persistGenerated(function (msg) { if (saved) saved.textContent = "· " + msg; });
      });
    });
    // due-date edits persist live
    g.querySelectorAll("[data-due]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var i = Number(inp.getAttribute("data-due"));
        v.generated.followUps[i].due = inp.value || v.generated.followUps[i].due;
        var saved = document.getElementById("sv-follow-saved");
        persistGenerated(function (msg) {
          if (saved) saved.textContent = "· " + msg;
          renderGenerated(v); // refresh overdue flags under the new date
        });
      });
    });
    // add a brand-new follow-up to the saved visit
    g.querySelector("#sv-add-follow").addEventListener("click", function () {
      var taskInput = g.querySelector("#sv-new-follow-task");
      var dueInput = g.querySelector("#sv-new-follow-due");
      var task = taskInput.value.trim();
      if (!task) { taskInput.focus(); return; }
      v.generated.followUps.push({
        task: task,
        due: dueInput.value || new Date().toISOString().slice(0, 10),
        done: false
      });
      var saved = document.getElementById("sv-follow-saved");
      persistGenerated(function (msg) {
        if (saved) saved.textContent = "· " + msg;
        renderGenerated(v);
      });
    });
    // remove a follow-up (e.g. no longer needed)
    g.querySelectorAll("[data-rm-follow]").forEach(function (b) {
      b.addEventListener("click", function () {
        var i = Number(b.getAttribute("data-rm-follow"));
        var f = v.generated.followUps[i];
        if (!f || !confirm('Remove follow-up "' + f.task + '"?')) return;
        v.generated.followUps.splice(i, 1);
        persistGenerated(function () { renderGenerated(v); });
      });
    });
    // quote status changes persist live
    g.querySelector("#sv-status").addEventListener("change", function (e) {
      var saved = document.getElementById("sv-status-saved");
      api("/api/visits/" + v.id, { method: "PATCH", body: { status: e.target.value } })
        .then(function () { if (saved) saved.textContent = "· saved"; })
        .catch(function (err) { if (saved) saved.textContent = "· " + err.message; });
    });
    // copy a ready-to-send client message for this quote
    var copyBtn = document.createElement("button");
    copyBtn.className = "btn ghost";
    copyBtn.id = "btn-copy-msg";
    copyBtn.textContent = "Copy client message";
    copyBtn.addEventListener("click", function () {
      copyClientMessage(v, st);
      copyBtn.textContent = "Copied!";
      setTimeout(function () { copyBtn.textContent = "Copy client message"; }, 2000);
    });
    var head = g.querySelector(".quote-head");
    if (head) head.appendChild(copyBtn);
  }

  /* ---------- quotely handoff ---------- */
  function renderQuotelyLink(v) {
    var el = document.getElementById("quotely-link");
    var st = v && v.sentToQuotely;
    if (!el) return;
    el.innerHTML = st && st.quoteNumber
      ? "In Quotely as <strong>" + esc(st.quoteNumber) + "</strong>" +
        (st.at ? " · sent " + esc(st.at.slice(0, 10)) : "") +
        ' <span class="muted">— re-sending updates that quote, never duplicates it.</span>'
      : "";
  }

  function renderVisit(id) {
    show("view-doc");
    api("/api/visits/" + id).then(function (j) {
      var v = j.visit;
      currentVisit = v;
      document.getElementById("sv-title").textContent = v.client;
      document.getElementById("sv-num").textContent = v.number;
      document.getElementById("sv-meta").textContent =
        v.trade + " · " + (v.address || "no address") + " · visited " + v.visitDate;
      document.getElementById("sv-obs").innerHTML =
        v.observations.map(function (o) { return "<li>" + esc(o) + "</li>"; }).join("") || "<li class='muted'>none</li>";
      document.getElementById("sv-photos").innerHTML =
        v.photoNotes.map(function (o) { return "<li>" + esc(o) + "</li>"; }).join("") || "<li class='muted'>none</li>";
      var strip = document.getElementById("sv-photostrip");
      if (v.photos && v.photos.length) {
        strip.innerHTML = "<h3>Site photos <span class='count'>" + v.photos.length + "</span></h3>";
        var gal = document.createElement("div");
        gal.className = "photo-gallery";
        v.photos.forEach(function (p) {
          var fig = document.createElement("figure");
          fig.className = "gal-item";
          var a = document.createElement("a");
          a.href = p.dataUrl; a.target = "_blank"; a.rel = "noopener";
          var img = document.createElement("img");
          img.src = p.dataUrl; img.alt = p.name; img.loading = "lazy";
          a.appendChild(img);
          var cap = document.createElement("figcaption");
          cap.textContent = p.name + " · " + (p.addedAt || "").slice(0, 10);
          fig.appendChild(a); fig.appendChild(cap);
          gal.appendChild(fig);
        });
        strip.appendChild(gal);
      } else {
        strip.innerHTML = "";
      }
      renderGenerated(v);
      renderQuotelyLink(v);
      document.getElementById("btn-send-quotely").onclick = function () {
        if (!v.generated || !(v.generated.items || []).length) {
          if (!confirm("This visit has no generated quote draft yet. Send anyway?")) return;
        }
        var btn = document.getElementById("btn-send-quotely");
        btn.disabled = true;
        btn.textContent = "Sending…";
        api("/api/visits/" + id + "/send-to-quotely", { method: "POST" })
          .then(function (r) {
            btn.disabled = false;
            btn.textContent = "Send to Quotely";
            currentVisit = r.visit || v;
            renderQuotelyLink(currentVisit);
            alert((r.created ? "Created " : "Updated ") + r.quote.number + " in Quotely.");
          })
          .catch(function (e) {
            btn.disabled = false;
            btn.textContent = "Send to Quotely";
            alert("Error: " + e.message);
          });
      };
      document.getElementById("btn-dup-visit").onclick = function () {
        api("/api/visits/" + id + "/duplicate", { method: "POST" })
          .then(function (r) { location.hash = "#/visit/" + r.visit.id; })
          .catch(function (e) { alert("Error: " + e.message); });
      };
      document.getElementById("btn-del-visit").onclick = function () {
        if (!confirm("Delete visit " + v.number + " (" + v.client + ")? This cannot be undone.")) return;
        api("/api/visits/" + id, { method: "DELETE" })
          .then(function () { location.hash = "#/"; })
          .catch(function (e) { alert("Error: " + e.message); });
      };
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
