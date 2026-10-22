/* D.EIGHT workspace — order book: order list and search, entry form (new, redo R, next stage C), order page with
   workflow, items and money, team chat by order code, and the dashboard. Uses the D1 API (/api/orders…).
   What each person sees follows their permissions; the server strips money for anyone without billing.view. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => D8.esc(s);
  const api = (p, o) => D8.api(p, o);
  const can = (p) => D8.can(p);
  const ws = () => D8.ws;
  D8.wsRoutes = D8.wsRoutes || [];

  /* ------------------------------------------------------------ labels and formatting */
  const OST = { new: "Mới nhận", design: "Đang thiết kế", qc: "Chờ QC", fix: "QC trả sửa", ready: "Đã qua QC", review: "Chờ bác sĩ duyệt",
    revise: "Bác sĩ yêu cầu sửa", approved: "Bác sĩ đã duyệt", delivered: "Đã giao", hold: "Tạm dừng", cancelled: "Đã hủy" };
  const OST_ORDER = ["new", "design", "qc", "fix", "ready", "review", "revise", "approved", "delivered", "hold", "cancelled"];
  const KIND = { new: "Đơn mới", redo: "Làm lại", continue: "Làm tiếp" };
  const CHARGE = { charge: "Tính tiền", free: "Miễn phí", warranty: "Bảo hành (miễn phí)" };
  const UNIT = { unit: "răng / đơn vị", arch: "hàm", bridge: "cầu", set: "bộ", case: "ca", hour: "giờ" };
  D8.OST = OST; D8.OST_ORDER = OST_ORDER; D8.UNIT_LABEL = UNIT;
  D8.ostChip = (s) => `<span class="ost ost-${esc(s)}">${esc(OST[s] || s)}</span>`;
  // code 26102101R1C2: stage 1 is the plain code, C2 = stage 2, R1 = first redo
  const lastSeg = (code) => { const m = /([RC])(\d+)$/.exec(String(code || "")); return m ? { k: m[1], n: +m[2] } : null; };
  const codeSteps = (code) => (String(code || "").match(/[RC]\d+/g) || []).map((x) => (x[0] === "R" ? "làm lại " + x.slice(1) : "giai đoạn " + x.slice(1))).join(" → ");
  const kindText = (o) => { const l = lastSeg(o.code); return !l ? (o.kind === "new" || !o.kind ? "Đơn mới · giai đoạn 1" : KIND[o.kind]) : l.k === "R" ? "Làm lại lần " + l.n : "Làm tiếp · giai đoạn " + l.n; };
  const kindChip = (o) => { const l = lastSeg(o.code); return l ? `<span class="okind okind-${l.k === "R" ? "redo" : "continue"}">${esc(l.k === "R" ? "Làm lại " + l.n : "Giai đoạn " + l.n)}</span>` : ""; };
  D8.codeSteps = codeSteps;
  D8.fmtMoney = (v, cur) => {
    if (v === null || v === undefined || v === "" || isNaN(v)) return "—";
    if (cur === "VND") return Math.round(v).toLocaleString("vi-VN") + " ₫";
    return "US$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 });
  };
  const money = D8.fmtMoney;
  const fmtDay = (d) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "");
  const vnToday = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const vnDayOf = (ms) => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
  const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  const toLocalInput = (ms) => (ms ? new Date(ms + 7 * 3600000).toISOString().slice(0, 16) : "");
  const name = (e) => (e ? ws().teamName(e) : "");
  const money_ = () => can("billing.view");
  const ICON = {
    plus: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    img: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="2"/><circle cx="7" cy="8.5" r="1.5"/><path d="M3 14l4.5-4 3.5 3 2.5-2 4 3.5"/></svg>',
    xl: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 2.5h7l4 4V17a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 5 17z"/><path d="M12 2.5v4h4M8 10l4 5M12 10l-4 5"/></svg>',
    redo: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 10a6 6 0 1 0 2-4.5M4 3v3.5h3.5"/></svg>',
    next: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5"/></svg>',
    edit: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M13.5 3.5l3 3L7 16H4v-3z"/></svg>',
    chat: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 5h14v9H8l-4 3v-3H3z"/></svg>',
    clip: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M15.5 9.5 10 15a3.5 3.5 0 0 1-5-5l6-6a2.3 2.3 0 0 1 3.3 3.3l-6 6a1.2 1.2 0 0 1-1.7-1.7L12 6.2"/></svg>',
    warn: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 18 17H2z"/><path d="M10 8.5v4M10 14.6v.1"/></svg>',
  };
  D8.ORDER_ICON = ICON;
  const parseHash = () => {
    const h = location.hash.replace(/^#/, ""), i = h.indexOf("?");
    return { path: i < 0 ? h : h.slice(0, i), q: new URLSearchParams(i < 0 ? "" : h.slice(i + 1)) };
  };
  // Teeth typed as "11, 21", "14-16" or Universal "3-5": how many units
  const FDI = [[18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28], [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]];
  function teethCount(s) {
    const set = new Set();
    for (const tok of String(s || "").replace(/[–—]/g, "-").split(/[,;\s]+/).filter(Boolean)) {
      const r = /^(\d{1,2})-(\d{1,2})$/.exec(tok);
      if (r) {
        const a = +r[1], b = +r[2];
        const row = FDI.find((x) => x.includes(a) && x.includes(b));
        if (row) { const i = row.indexOf(a), k = row.indexOf(b); row.slice(Math.min(i, k), Math.max(i, k) + 1).forEach((n) => set.add(n)); }
        else if (a >= 1 && b <= 32 && a <= 32) for (let n = Math.min(a, b); n <= Math.max(a, b); n++) set.add("u" + n);
      } else if (/^\d{1,2}$/.test(tok)) set.add(+tok);
    }
    return set.size;
  }
  D8.teethCount = teethCount;

  /* ------------------------------------------------------------ shared lists */
  let products = null, customers = null, productsAt = 0, customersAt = 0;
  D8.book = {
    async products(force) {
      if (force || !products || Date.now() - productsAt > 120000) { products = (await api("/api/products")).products || []; productsAt = Date.now(); }
      return products;
    },
    async customers(force) {
      if (force || !customers || Date.now() - customersAt > 60000) { customers = (await api("/api/customers")).customers || []; customersAt = Date.now(); }
      return customers;
    },
    drop() { products = null; customers = null; },
    custLabel: (c) => (c ? c.code + " — " + c.name : ""),
  };
  const noDbPanel = (err) => `<div class="pt-empty"><img src="/brand/symbol.svg" alt=""><h2 class="h-caps">Chưa kết nối cơ sở dữ liệu</h2>
    <p>${esc(err && err.message ? err.message : "")}</p><p class="muted">Xem hướng dẫn trong mục <a href="#settings">Cài đặt</a>.</p></div>`;
  D8.noDbPanel = noDbPanel;

  /* ------------------------------------------------------------ order list */
  const L = { q: "", status: "open", customer: "", designer: "", preset: "all", from: "", to: "", pay: "", kind: "", offset: 0, sort: "" };
  let listData = null, listBusy = 0;
  const PRESETS = [["all", "Mọi lúc"], ["today", "Hôm nay"], ["7d", "7 ngày qua"], ["month", "Tháng này"], ["lastmonth", "Tháng trước"], ["year", "Năm nay"], ["custom", "Chọn ngày…"]];
  function presetRange(p) {
    const t = vnToday();
    if (p === "today") return [t, t];
    if (p === "7d") return [addDays(t, -6), t];
    if (p === "month") return [t.slice(0, 8) + "01", t];
    if (p === "lastmonth") { const first = t.slice(0, 8) + "01", end = addDays(first, -1); return [end.slice(0, 8) + "01", end]; }
    if (p === "year") return [t.slice(0, 4) + "-01-01", t];
    return ["", ""];
  }
  const STATUS_TABS = [["open", "Đang làm"], ["work", "Đang thiết kế"], ["qc", "Chờ QC"], ["review", "Chờ duyệt"], ["delivered", "Đã giao"], ["hold", "Tạm dừng"], ["cancelled", "Đã hủy"], ["", "Tất cả"]];
  function tabCount(counts, k) {
    const sum = (list) => list.reduce((t, s) => t + (counts[s] || 0), 0);
    if (k === "open") return sum(OST_ORDER.filter((s) => s !== "delivered" && s !== "cancelled"));
    if (k === "work") return sum(["new", "design", "fix", "revise"]);
    if (k === "review") return sum(["review", "approved", "ready"]);
    if (!k) return sum(OST_ORDER);
    return counts[k] || 0;
  }
  function listQuery(extra = {}) {
    const p = new URLSearchParams();
    const st = { review: "review,approved,ready" }[L.status] || L.status;
    const vals = { q: L.q, status: st, customer: L.customer, designer: L.designer, from: L.from, to: L.to, pay: L.pay, kind: L.kind, sort: L.sort, limit: 50, offset: L.offset, ...extra };
    for (const [k, v] of Object.entries(vals)) if (v !== "" && v !== null && v !== undefined) p.set(k, v);
    return p.toString();
  }
  async function drawOrders(q) {
    if (q) {
      for (const k of ["customer", "designer", "status", "pay", "kind", "q"]) if (q.has(k)) L[k] = q.get(k);
      if (q.has("from") || q.has("to")) { L.preset = "custom"; L.from = q.get("from") || ""; L.to = q.get("to") || ""; }
    }
    const W = ws();
    W.setBand("Đơn hàng", "", {
      right: `<div class="band-btns">${can("orders.edit") ? `<a class="btn btn-cream small" href="#orders/new">${ICON.plus}Đơn mới</a><a class="btn btn-light small" href="#import/orders">Nhập Excel</a>` : ""}${can("export.csv") ? `<button class="btn btn-light small" type="button" id="oExport">${ICON.xl}Xuất Excel</button>` : ""}</div>` });
    W.show("p-orders", true);
    const host = $("p-orders");
    if (!host.dataset.built) {
      host.dataset.built = "1";
      host.innerHTML = `<div class="o-tools">
          <div class="o-search"><input class="input pt-search" type="search" id="oQ" placeholder="Tìm đơn nào?" aria-label="Tìm đơn hàng" autocomplete="off"></div>
          <div class="o-filt">
            <select class="input" id="oPreset" aria-label="Thời gian">${PRESETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
            <span class="o-range" id="oRange" hidden><input class="input" type="date" id="oFrom" aria-label="Từ ngày"><span>–</span><input class="input" type="date" id="oTo" aria-label="Đến ngày"></span>
            <select class="input" id="oCust" aria-label="Khách hàng"><option value="">Mọi khách hàng</option></select>
            <select class="input" id="oDes" aria-label="KTV"><option value="">Mọi KTV</option><option value="me">Đơn của tôi</option></select>
            <select class="input" id="oKind" aria-label="Loại đơn"><option value="">Mọi loại đơn</option><option value="new">Đơn mới</option><option value="redo">Làm lại (R)</option><option value="continue">Làm tiếp (C)</option></select>
            ${money_() ? `<select class="input" id="oPay" aria-label="Thanh toán"><option value="">Mọi thanh toán</option><option value="due">Còn nợ</option><option value="paid">Đã thu đủ</option></select>` : ""}
          </div></div>
        <div class="pt-filters o-tabs" id="oTabs" role="group" aria-label="Trạng thái"></div>
        <div class="o-sum" id="oSum" aria-live="polite"></div>
        <div id="oList"></div>
        <div class="o-more" id="oMore" hidden><button class="btn small" type="button" id="oMoreBtn">Xem thêm</button></div>
        <p class="error" id="oErr" hidden></p>`;
      let t;
      $("oQ").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { L.q = $("oQ").value.trim(); L.offset = 0; loadList(); }, 250); });
      $("oPreset").addEventListener("change", () => {
        L.preset = $("oPreset").value; $("oRange").hidden = L.preset !== "custom";
        if (L.preset !== "custom") { [L.from, L.to] = presetRange(L.preset); } else { L.from = $("oFrom").value; L.to = $("oTo").value; }
        L.offset = 0; loadList();
      });
      for (const id of ["oFrom", "oTo"]) $(id).addEventListener("change", () => { L.from = $("oFrom").value; L.to = $("oTo").value; L.offset = 0; loadList(); });
      const sel = { oCust: "customer", oDes: "designer", oKind: "kind", oPay: "pay" };
      for (const [id, k] of Object.entries(sel)) if ($(id)) $(id).addEventListener("change", () => { L[k] = $(id).value; L.offset = 0; loadList(); });
      $("oMoreBtn").addEventListener("click", () => { L.offset = (listData ? listData.items.length : 0); loadList(true); });
    }
    $("oQ").value = L.q; $("oPreset").value = L.preset; $("oRange").hidden = L.preset !== "custom"; $("oFrom").value = L.from; $("oTo").value = L.to;
    if ($("oKind")) $("oKind").value = L.kind; if ($("oPay")) $("oPay").value = L.pay;
    const ex = $("oExport"); if (ex) ex.addEventListener("click", () => exportOrders(ex));
    // filters that need lists
    D8.book.customers().then((cs) => {
      const s = $("oCust"); if (!s) return;
      s.innerHTML = '<option value="">Mọi khách hàng</option>' + cs.map((c) => `<option value="${c.id}">${esc(c.code + " — " + c.name)}</option>`).join("");
      s.value = L.customer;
    }).catch(() => { const s = $("oCust"); if (s) s.hidden = true; });
    const ds = $("oDes");
    const team = W.team().filter((x) => x.design);
    ds.innerHTML = '<option value="">Mọi KTV</option><option value="me">Đơn của tôi</option>' + (can("orders.view") || can("cases.assign") ? '<option value="none">Chưa giao KTV</option>' + team.map((x) => `<option value="${esc(x.email)}">${esc(x.name || x.email)}</option>`).join("") : "");
    ds.value = L.designer;
    W.show("p-orders");
    loadList();
  }
  async function loadList(append) {
    const my = ++listBusy;
    const list = $("oList");
    if (!append && !listData) list.innerHTML = D8.skel.rows(5);
    else if (!append) list.classList.add("is-stale");
    try {
      const d = await api("/api/orders?" + listQuery());
      if (my !== listBusy) return;
      if (append && listData) d.items = [...listData.items, ...d.items];
      listData = d;
      $("oErr").hidden = true;
      drawList();
    } catch (err) {
      if (my !== listBusy) return;
      if (err.data && err.data.code === "no_db") { list.innerHTML = noDbPanel(err); return; }
      $("oErr").textContent = err.message; $("oErr").hidden = false;
    } finally { list.classList.remove("is-stale"); }
  }
  function drawList() {
    const d = listData, counts = d.statusCounts || {};
    $("oTabs").innerHTML = STATUS_TABS.map(([k, l]) => `<button type="button" data-st="${k}" aria-pressed="${L.status === k}">${esc(l)}<b>${tabCount(counts, k)}</b></button>`).join("");
    $("oTabs").querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", () => { L.status = b.dataset.st; L.offset = 0; loadList(); }));
    const sums = (d.sums || []).map((s) => `<span><b>${money(s.total, s.currency)}</b> thành tiền</span><span>đã thu <b>${money(s.paid, s.currency)}</b></span><span class="${s.due > 0 ? "due" : ""}">còn nợ <b>${money(s.due, s.currency)}</b></span>`).join('<i class="sep"></i>');
    $("oSum").innerHTML = `<span><b>${d.count}</b> đơn</span><span><b>${(+d.units || 0).toLocaleString("vi-VN")}</b> đơn vị</span>${sums ? '<i class="sep"></i>' + sums : ""}`;
    const m = money_();
    if (!d.items.length) {
      $("oList").innerHTML = `<div class="pt-empty"><img src="/brand/symbol.svg" alt=""><h2 class="h-caps">${d.count || L.q || L.status !== "open" ? "Không có đơn nào khớp" : "Chưa có đơn hàng"}</h2>
        <p>${L.q || L.customer || L.designer ? "Thử bộ lọc khác hoặc xóa ô tìm kiếm." : can("orders.edit") ? "Bấm Đơn mới để nhập đơn, hoặc nhập các đơn cũ từ Excel." : "Các đơn được giao cho bạn sẽ hiện ở đây."}</p>
        ${can("orders.edit") && !L.q ? '<p><a class="btn btn-primary small" href="#orders/new">Đơn mới</a> <a class="btn small" href="#import/orders">Nhập Excel</a></p>' : ""}</div>`;
      $("oMore").hidden = true; return;
    }
    $("oList").innerHTML = `<div class="tbl-wrap o-tbl-wrap"><table class="tbl o-tbl"><thead><tr><th>Mã đơn</th><th>Ngày nhận</th><th>Khách hàng</th><th>Bệnh nhân</th><th>Hạng mục</th><th>KTV · QC</th><th>Trạng thái</th>${m ? '<th class="num">Thành tiền</th><th class="num">Còn nợ</th>' : ""}</tr></thead>
      <tbody>${d.items.map((o) => `<tr data-href="#orders/${o.id}" tabindex="0">
        <td class="o-code"><a href="#orders/${o.id}">${esc(o.code)}</a>${o.unread ? '<span class="o-dot" title="Tin nhắn nội bộ chưa đọc"></span>' : ""}${kindChip(o)}${o.source === "portal" ? '<span class="okind okind-portal">Cổng khách</span>' : ""}</td>
        <td data-l="Ngày nhận">${esc(fmtDay(o.day))}${o.due_at && !["delivered", "cancelled"].includes(o.status) ? `<small class="${o.due_at < Date.now() ? "late" : ""}">hạn ${esc(D8.fmtDate(o.due_at, true))}</small>` : ""}</td>
        <td data-l="Khách hàng"><b>${esc(o.customer_code)}</b> <span class="muted">${esc(o.customer_name)}</span>${o.clinic || o.doctor ? `<small>${esc([o.clinic, o.doctor].filter(Boolean).join(" · "))}</small>` : ""}</td>
        <td data-l="Bệnh nhân">${esc(o.patient || "—")}${o.ref ? `<small>Mã khách: ${esc(o.ref)}</small>` : ""}</td>
        <td data-l="Hạng mục">${esc(o.items_text || "—")}</td>
        <td data-l="KTV · QC">${esc(name(o.designer) || "—")}${o.qc ? `<small>QC ${esc(name(o.qc))}</small>` : ""}</td>
        <td data-l="Trạng thái">${D8.ostChip(o.status)}${o.charge && o.charge !== "charge" ? `<small>${esc(CHARGE[o.charge])}</small>` : ""}</td>
        ${m ? `<td class="num" data-l="Thành tiền">${esc(money(o.total, o.currency))}</td><td class="num ${o.due > 0 && o.status !== "cancelled" ? "due" : ""}" data-l="Còn nợ">${o.status === "cancelled" ? "—" : esc(money(o.due, o.currency))}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
    $("oList").querySelectorAll("tr[data-href]").forEach((tr) => {
      tr.addEventListener("click", (e) => { if (!e.target.closest("a")) location.hash = tr.dataset.href; });
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") location.hash = tr.dataset.href; });
    });
    $("oMore").hidden = d.items.length >= d.count;
    $("oMoreBtn").textContent = "Xem thêm (" + (d.count - d.items.length) + " đơn)";
  }
  async function exportOrders(btn) {
    D8.busy(btn, true);
    try {
      const [from, to] = L.from || L.to ? [L.from || "2000-01-01", L.to || vnToday()] : [addDays(vnToday(), -365 * 5), vnToday()];
      await D8.exportBook({ from, to, title: "Don-hang" });
    } catch (err) { D8.toast(err.message); }
    D8.busy(btn, false);
  }

  /* ------------------------------------------------------------ the order form (new, edit, redo, next stage) */
  async function drawForm(id, q) {
    const W = ws();
    const kind = q.get("redo") ? "redo" : q.get("continue") ? "continue" : "new";
    const parentId = +(q.get("redo") || q.get("continue") || 0);
    W.setBand(id ? "Sửa đơn" : kind === "redo" ? "Đơn làm lại" : kind === "continue" ? "Đơn làm tiếp giai đoạn" : "Đơn mới", "", { back: true, backHref: id ? "#orders/" + id : parentId ? "#orders/" + parentId : "#orders", backText: id ? "Đơn hàng" : "Đơn hàng" });
    W.show("p-order-edit", true);
    const host = $("p-order-edit");
    host.innerHTML = D8.skel.form();
    let order = null, items = [], parent = null, prods, custs;
    try {
      [prods, custs] = await Promise.all([D8.book.products(), D8.book.customers()]);
      if (id) { const d = await api("/api/orders/" + id); order = d.order; items = d.items; }
      if (parentId) { const d = await api("/api/orders/" + parentId); parent = d.order; items = d.items.map(({ id: _i, price: _p, amount: _a, ...x }) => x); }
    } catch (err) { host.innerHTML = err.data && err.data.code === "no_db" ? noDbPanel(err) : `<p class="error">${esc(err.message)}</p>`; return; }
    if (!prods.length) {
      host.innerHTML = `<div class="pt-empty"><img src="/brand/symbol.svg" alt=""><h2 class="h-caps">Chưa có mã hàng</h2><p>Đơn hàng dùng chung danh mục mã hàng. Tạo danh mục trước (có sẵn danh mục mẫu 20 mã để sửa lại).</p>
        <p>${can("pricing.manage") ? '<a class="btn btn-primary small" href="#catalog">Mở Mã hàng &amp; bảng giá</a>' : "Nhờ quản trị tạo danh mục mã hàng."}</p></div>`;
      W.show("p-order-edit"); return;
    }
    const src = order || parent || {};
    const portal = !!(order && order.job_id);
    const canPrice = can("billing.edit"), canAssign = can("cases.assign") && !portal, canStatus = can("cases.status") && !portal;
    const cust0 = custs.find((c) => c.id === (src.customer_id || +q.get("customer") || 0));
    const today = vnToday();
    const st = { cust: cust0 || null, prices: null, codeEdit: false, items: items.length ? items.map((x) => ({ ...x, auto: false })) : [{ product: "", teeth: "", qty: 1, note: "", auto: true }] };
    const designers = W.team().filter((t) => t.design), qcs = W.team().filter((t) => t.qc);
    const opt = (list, sel, none) => `<option value="">${none}</option>` + list.map((t) => `<option value="${esc(t.email)}"${t.email === sel ? " selected" : ""}>${esc((t.name || t.email) + " · " + t.label)}</option>`).join("") +
      (sel && !list.some((t) => t.email === sel) ? `<option value="${esc(sel)}" selected>${esc(name(sel))}</option>` : "");
    const svc = (v) => ["", ...D8.SERVICES].map((s) => `<option value="${esc(s)}"${s === (v || "") ? " selected" : ""}>${esc(s ? D8.svcLabel(s) : "— Chọn —")}</option>`).join("");
    const charge0 = order ? order.charge || "charge" : kind === "redo" ? "warranty" : "charge";
    host.innerHTML = `<form id="ofForm" class="of" novalidate>
      <div class="of-main">
        ${parent ? `<div class="pt-alert info">${ICON.redo}<div>${kind === "redo" ? "Làm lại" : "Làm tiếp giai đoạn sau"} từ đơn <a href="#orders/${parent.id}"><b>${esc(parent.code)}</b></a> → mã đơn mới <b id="ofKidCode">…</b>. ${kind === "redo" ? "Làm lại thêm R + số lần làm lại (R1, R2…)." : "Giai đoạn 1 là mã gốc, làm tiếp thêm C + số giai đoạn (C2, C3…)."}</div></div>` : ""}
        ${portal ? `<div class="pt-alert info">${ICON.chat}<div>Đơn này khách gửi qua cổng khách hàng. Khách hàng, ngày nhận, phân công và trạng thái theo trang ca; ở đây sửa hạng mục, thông tin và tiền.</div></div>` : ""}
        <section class="card"><h2 class="h-caps">Thông tin đơn</h2>
          <div class="of-grid3">
            <div><label class="field-label" for="ofDay">Ngày nhận</label><input class="input" type="date" id="ofDay" value="${esc(src.day && order ? src.day : today)}"${portal || parent ? " disabled" : ""} required></div>
            <div><label class="field-label" for="ofCode">Mã đơn</label>
              <div class="of-code"><output id="ofCodeOut">${esc(order ? order.code : "…")}</output>${!parent && !portal && (!order || order.kind === "new") ? '<button class="linkbtn" type="button" id="ofCodeEdit">Sửa mã</button>' : ""}</div>
              <input class="input" id="ofCode" hidden placeholder="Mã đơn cũ là gì?" value="${esc(order ? order.code : "")}" autocomplete="off" style="text-transform:uppercase">
              <p class="hint" id="ofCodeHint"></p></div>
            <div><label class="field-label" for="ofDue">Hạn giao</label><input class="input" type="datetime-local" id="ofDue" value="${esc(toLocalInput(src.due_at && order ? src.due_at : 0))}"></div>
          </div>
          <div class="of-grid2">
            <div><label class="field-label" for="ofCust">Khách hàng (labo / phòng khám / bác sĩ trả tiền)</label>
              <input class="input" id="ofCust" list="ofCustList" autocomplete="off" placeholder="Khách nào?" value="${esc(D8.book.custLabel(cust0))}"${portal || parent ? " disabled" : ""} required>
              <datalist id="ofCustList">${custs.filter((c) => c.active).map((c) => `<option value="${esc(D8.book.custLabel(c))}"></option>`).join("")}</datalist>
              <p class="hint" id="ofCustHint">${cust0 ? esc(cust0.kind === "lab" ? "Labo" : "Khách") + " · tiền " + esc(cust0.currency) : can("customers.edit") ? '<a href="#customers/new">+ Thêm khách mới</a>' : ""}</p></div>
            <div><label class="field-label" for="ofRef">Mã của khách</label><input class="input" id="ofRef" maxlength="80" value="${esc(src.ref || "")}" placeholder="Mã ca bên khách là gì?"></div>
            <div><label class="field-label" for="ofClinic">Nha khoa / phòng khám</label><input class="input" id="ofClinic" maxlength="120" list="ofClinicList" value="${esc(src.clinic || "")}" placeholder="Nha khoa nào?"><datalist id="ofClinicList"></datalist></div>
            <div><label class="field-label" for="ofDoctor">Bác sĩ</label><input class="input" id="ofDoctor" maxlength="120" list="ofDoctorList" value="${esc(src.doctor || "")}" placeholder="Bác sĩ nào?"><datalist id="ofDoctorList"></datalist></div>
            <div class="span2"><label class="field-label" for="ofPatient">Bệnh nhân</label><input class="input" id="ofPatient" maxlength="120" value="${esc(src.patient || "")}" placeholder="Bệnh nhân là ai?"></div>
          </div>
          <div id="ofDupes" class="of-dupes" aria-live="polite" hidden></div></section>
        <section class="card"><div class="card-head-row"><h2 class="h-caps">Hạng mục</h2></div>
          <div class="of-items" id="ofItems"></div>
          <datalist id="ofProdList">${prods.filter((p) => p.active).map((p) => `<option value="${esc(p.code)}">${esc(p.name)}</option>`).join("")}</datalist>
          <div class="wf-actions"><button class="btn small" type="button" id="ofAdd">${ICON.plus}Thêm hạng mục</button></div>
        </section>
        <section class="card"><h2 class="h-caps">Thiết kế</h2>
          <div class="of-grid3">
            <div><label class="field-label" for="ofSvc">Dịch vụ</label><select class="input" id="ofSvc">${svc(src.service)}</select></div>
            <div><label class="field-label" for="ofMat">Vật liệu</label><input class="input" id="ofMat" maxlength="120" value="${esc(src.material || "")}"></div>
            <div><label class="field-label" for="ofShade">Màu răng</label><input class="input" id="ofShade" maxlength="40" value="${esc(src.shade || "")}"></div>
          </div>
          <label class="field-label" for="ofNotes" style="margin-top:14px">Yêu cầu của bác sĩ</label>
          <textarea class="input" id="ofNotes" rows="3" maxlength="4000" placeholder="Bác sĩ yêu cầu gì?">${esc(src.notes || "")}</textarea>
          ${!order ? `<label class="field-label" for="ofChat" style="margin-top:14px">Nhắn cho KTV / QC <span class="opt">(vào chat nội bộ của đơn)</span></label><textarea class="input" id="ofChat" rows="2" maxlength="4000"></textarea>` : ""}
        </section>
        ${canAssign || canStatus ? `<section class="card"><h2 class="h-caps">Phân công &amp; trạng thái</h2><div class="of-grid3">
          ${canAssign ? `<div><label class="field-label" for="ofDes">KTV thiết kế</label><select class="input" id="ofDes">${opt(designers, src.designer && order ? src.designer : parent ? parent.designer : "", "— Chưa giao —")}</select></div>
            <div><label class="field-label" for="ofQc">QC</label><select class="input" id="ofQc">${opt(qcs, src.qc && order ? src.qc : parent ? parent.qc : "", "— Chưa giao —")}</select></div>` : ""}
          ${canStatus ? `<div><label class="field-label" for="ofSt">Trạng thái</label><select class="input" id="ofSt"><option value="">${order ? "— Giữ nguyên —" : "Tự động (mới / đang thiết kế)"}</option>${OST_ORDER.map((s) => `<option value="${s}"${order && order.status === s ? " selected" : ""}>${esc(OST[s])}</option>`).join("")}</select>
            </div>
            <div id="ofDelWrap" hidden><label class="field-label" for="ofDel">Ngày giao</label><input class="input" type="date" id="ofDel" value="${esc(order && order.dday ? order.dday : today)}"></div>` : ""}
        </div></section>` : ""}
      </div>
      <aside class="of-side">
        <section class="card of-sum">
          <span class="eyebrow">${order ? "Sửa đơn" : KIND[kind]}</span>
          <b class="of-sum-code" id="ofSumCode">${esc(order ? order.code : "…")}</b>
          <p class="muted" id="ofSumCust">${esc(cust0 ? cust0.name : "Chưa chọn khách")}</p>
          ${money_() ? `<div class="of-money" id="ofMoney"></div>` : ""}
          ${canPrice ? `<div class="of-adj">
            <span class="field-label">Tính phí</span>
            <div class="seg seg-sm" role="radiogroup" aria-label="Tính phí">${Object.entries(CHARGE).map(([k, l]) => `<label><input type="radio" name="ofCharge" value="${k}"${k === charge0 ? " checked" : ""}><span>${esc(k === "warranty" ? "Bảo hành" : l)}</span></label>`).join("")}</div>
            <div class="of-grid2 tight">
              <div><label class="field-label" for="ofPct">Phụ phí %</label><input class="input" type="number" id="ofPct" step="1" min="-100" max="1000" value="${order ? order.adj_pct || "" : ""}" placeholder="0"></div>
              <div><label class="field-label" for="ofAmt">Cộng / trừ</label><input class="input" type="number" id="ofAmt" step="0.01" value="${order ? order.adj_amount || "" : ""}" placeholder="0"></div>
            </div>
            <div class="chips-row"><button class="chipbtn" type="button" data-pct="50">+50% làm gấp trong ngày</button><button class="chipbtn" type="button" data-pct="0">Bỏ phụ phí</button></div>
            <div><label class="field-label" for="ofCur">Tiền tệ</label><select class="input" id="ofCur">${["USD", "VND"].map((c) => `<option${(order ? order.currency : cust0 ? cust0.currency : "USD") === c ? " selected" : ""}>${c}</option>`).join("")}</select></div>
          </div>` : ""}
          <button class="btn btn-primary of-save" type="submit" id="ofSave">${order ? "Lưu thay đổi" : "Tạo đơn"}</button>
          <p class="error" id="ofErr" hidden></p>
        </section>
      </aside></form>`;
    W.show("p-order-edit");
    const err0 = (m) => { $("ofErr").textContent = m; $("ofErr").hidden = !m; };

    const prodOf = (code) => prods.find((p) => p.code === String(code || "").trim().toUpperCase());
    const priceFor = (code) => {
      if (!st.prices) return null;
      const cur = $("ofCur") ? $("ofCur").value : st.cust ? st.cust.currency : "USD";
      const own = st.prices.own.find((p) => p.product === code && p.currency === cur), def = st.prices.defaults.find((p) => p.product === code && p.currency === cur);
      return own ? own.price : def ? def.price : null;
    };
    const drawItems = () => {
      const m = money_();
      $("ofItems").classList.toggle("m", m);
      $("ofItems").innerHTML = `<div class="of-item of-item-h"><span>Mã hàng</span><span>Răng</span><span>SL</span>${m ? "<span>Đơn giá</span><span>Thành tiền</span>" : ""}<span>Ghi chú</span><span></span></div>` +
        st.items.map((x, i) => {
          const p = prodOf(x.product), lp = priceFor(p ? p.code : "");
          const price = x.price !== undefined && x.price !== null && x.price !== "" ? +x.price : lp;
          return `<div class="of-item" data-i="${i}">
            <div><input class="input" data-k="product" list="ofProdList" value="${esc(x.product || "")}" placeholder="Mã hàng?" aria-label="Mã hàng" autocomplete="off"><small class="${x.product && !p ? "bad" : ""}">${esc(p ? p.name + " · /" + (UNIT[p.unit] || p.unit) : x.product ? "Không có mã này" : "")}</small></div>
            <div><input class="input" data-k="teeth" value="${esc(x.teeth || "")}" placeholder="Răng số mấy?" aria-label="Răng"></div>
            <div><input class="input" data-k="qty" type="number" min="0.01" step="any" value="${esc(x.qty ?? 1)}" aria-label="Số lượng"></div>
            ${m ? `<div><input class="input" data-k="price" type="number" min="0" step="any" value="${x.price !== undefined && x.price !== null ? esc(x.price) : ""}" placeholder="${lp !== null ? esc(lp) : "—"}" aria-label="Đơn giá"${canPrice ? "" : " disabled"}></div>
              <div class="of-amt">${price !== null && price !== undefined ? esc(money(price * (+x.qty || 0), $("ofCur") ? $("ofCur").value : "USD")) : "—"}</div>` : ""}
            <div><input class="input" data-k="note" value="${esc(x.note || "")}" maxlength="300" aria-label="Ghi chú"></div>
            <button class="iconbtn del" type="button" data-rm="${i}" aria-label="Bỏ hạng mục">${ICON.x}</button></div>`;
        }).join("");
      $("ofItems").querySelectorAll("[data-k]").forEach((el) => {
        el.addEventListener("input", () => {
          const i = +el.closest("[data-i]").dataset.i, x = st.items[i], k = el.dataset.k;
          x[k] = el.value;
          if (k === "qty") x.auto = false;
          if (k === "teeth" && x.auto !== false) { const p = prodOf(x.product), n = teethCount(el.value); if (n && (!p || p.unit === "unit")) { x.qty = n; const q2 = el.closest("[data-i]").querySelector('[data-k="qty"]'); q2.value = n; } }
          if (k === "product" || k === "price" || k === "qty" || k === "teeth") { clearTimeout(drawItems.t); drawItems.t = setTimeout(() => { const f = document.activeElement; const key = f && f.dataset && f.dataset.k, row = f && f.closest && f.closest("[data-i]"); drawItems(); if (key && row) { const el2 = $("ofItems").querySelector(`[data-i="${row.dataset.i}"] [data-k="${key}"]`); if (el2) { el2.focus(); try { el2.setSelectionRange(el2.value.length, el2.value.length); } catch {} } } }, k === "product" ? 350 : 500); }
          sum();
        });
      });
      $("ofItems").querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { st.items.splice(+b.dataset.rm, 1); if (!st.items.length) st.items.push({ product: "", teeth: "", qty: 1, note: "", auto: true }); drawItems(); sum(); }));
    };
    const sum = () => {
      const box = $("ofMoney"); if (!box) return;
      const cur = $("ofCur") ? $("ofCur").value : st.cust ? st.cust.currency : "USD";
      let sub = 0, missing = 0;
      for (const x of st.items) {
        const p = prodOf(x.product); if (!p) continue;
        const price = x.price !== undefined && x.price !== null && x.price !== "" ? +x.price : priceFor(p.code);
        if (price === null || price === undefined) missing++;
        sub += (price || 0) * (+x.qty || 0);
      }
      const pct = +(($("ofPct") || {}).value || 0), amt = +(($("ofAmt") || {}).value || 0);
      const charge = (document.querySelector('input[name="ofCharge"]:checked') || {}).value || charge0;
      const total = charge === "charge" ? Math.max(0, sub * (1 + pct / 100) + amt) : 0;
      box.innerHTML = `<div><span>Tạm tính</span><b>${esc(money(sub, cur))}</b></div>${pct ? `<div><span>Phụ phí ${pct}%</span><b>${esc(money(sub * pct / 100, cur))}</b></div>` : ""}${amt ? `<div><span>Cộng / trừ</span><b>${esc(money(amt, cur))}</b></div>` : ""}
        <div class="tot"><span>Tổng</span><b>${esc(money(total, cur))}</b></div>${charge !== "charge" ? `<p class="hint">${esc(CHARGE[charge])}: không tính tiền đơn này.</p>` : ""}${missing ? `<p class="hint warn">${missing} hạng mục chưa có giá trong bảng giá (tính 0).</p>` : ""}`;
    };
    const loadPrices = async () => {
      st.prices = null;
      if (money_() && st.cust) { try { st.prices = await api("/api/prices?customer=" + st.cust.id); } catch { st.prices = { own: [], defaults: [] }; } }
      drawItems(); sum();
    };
    const setCust = () => {
      const v = $("ofCust").value.trim(), code = v.split(" — ")[0].trim().toUpperCase();
      const c = custs.find((x) => x.code === code) || custs.find((x) => D8.book.custLabel(x) === v);
      st.cust = c || null;
      $("ofCustHint").innerHTML = c ? esc((c.kind === "lab" ? "Labo" : "Khách") + " · tiền " + c.currency) : v ? '<span class="bad">Không có khách này.</span>' + (can("customers.edit") ? ' <a href="#customers/new">+ Thêm khách mới</a>' : "") : "";
      $("ofSumCust").textContent = c ? c.name : "Chưa chọn khách";
      if (c && $("ofCur") && !order) $("ofCur").value = c.currency;
      loadPrices();
      if (c) api("/api/orders?limit=100&customer=" + c.id + "&status=").then((d) => {
        const uniq = (k) => [...new Set(d.items.map((o) => o[k]).filter(Boolean))].slice(0, 40);
        $("ofClinicList").innerHTML = uniq("clinic").map((x) => `<option value="${esc(x)}"></option>`).join("");
        $("ofDoctorList").innerHTML = uniq("doctor").map((x) => `<option value="${esc(x)}"></option>`).join("");
      }).catch(() => {});
    };
    const codePreview = async () => {
      if (order || parent) return;
      const d = $("ofDay").value;
      if (!d) return;
      try { const r = await api("/api/orders/next-code?day=" + d); if (!st.codeEdit) { $("ofCodeOut").textContent = r.code; $("ofSumCode").textContent = r.code; } } catch {}
    };
    // redo / next stage: show the code it will get (and say so at once if that stage already exists)
    if (parent && !order) api(`/api/orders/${parent.id}/next?kind=${kind}`).then((r) => { $("ofKidCode").textContent = r.code; $("ofCodeOut").textContent = r.code; $("ofSumCode").textContent = r.code; })
      .catch((ex) => { $("ofKidCode").textContent = "—"; err0(ex.message); if (ex.data && ex.data.id) $("ofErr").innerHTML = esc(ex.message) + ` <a href="#orders/${ex.data.id}">Mở đơn đó</a>`; });
    // "is this order already in the book?" while a new order is typed in (an admin or another KTV may have entered it)
    const dupBox = $("ofDupes");
    let dupList = [], dupT = 0, dupSeq = 0;
    const drawDupes = () => {
      if (!dupList.length) { dupBox.hidden = true; dupBox.innerHTML = ""; return; }
      const ok0 = $("ofDupOk") && $("ofDupOk").checked;
      dupBox.hidden = false;
      dupBox.innerHTML = `<div class="pt-alert warn">${ICON.warn}<div><b>Đơn này có thể đã có trong sổ</b> — ${dupList.length > 1 ? "các case này đã có mã đơn hàng" : "case này đã có mã đơn hàng"}:
        <ul>${dupList.map((x) => `<li>${x.canOpen ? `<a href="#orders/${x.id}"><b>${esc(x.code)}</b></a>` : `<b>${esc(x.code)}</b>`} · ${esc(x.patient || x.ref || "—")} · ${esc(x.customer_code)} · nhận ${esc(fmtDay(x.day))} · ${esc(OST[x.status] || x.status)}
          · ${x.source === "portal" ? "khách gửi qua cổng khách" : "nhập bởi " + esc(name(x.created_by) || x.created_by)}${x.designer ? " · KTV " + esc(name(x.designer)) : ""}
          <small>${x.match === "ref" ? "trùng mã của khách" : "trùng tên bệnh nhân"}${x.canOpen ? "" : " · đơn chưa giao cho bạn, hỏi quản trị nếu cần nhận làm"}</small></li>`).join("")}</ul>
        <label class="check"><input type="checkbox" id="ofDupOk"${ok0 ? " checked" : ""}> Đây là đơn khác, vẫn tạo đơn mới</label></div></div>`;
    };
    const checkDupes = () => {
      if (order || parent) return;
      clearTimeout(dupT);
      dupT = setTimeout(async () => {
        const pt = $("ofPatient").value.trim(), ref = $("ofRef").value.trim();
        if (pt.length < 3 && !(ref && st.cust)) { dupList = []; drawDupes(); return; }
        const n = ++dupSeq;
        try {
          const r = await api(`/api/orders/dupes?patient=${encodeURIComponent(pt)}&ref=${encodeURIComponent(ref)}&customer=${st.cust ? st.cust.id : ""}`);
          if (n === dupSeq) { dupList = r.dupes || []; drawDupes(); }
        } catch {}
      }, 450);
    };
    ["ofPatient", "ofRef"].forEach((k) => $(k).addEventListener("input", checkDupes));
    $("ofCust").addEventListener("change", setCust);
    $("ofCust").addEventListener("change", checkDupes);
    $("ofCust").addEventListener("input", () => { if (custs.some((c) => D8.book.custLabel(c) === $("ofCust").value)) { setCust(); checkDupes(); } });
    $("ofDay").addEventListener("change", codePreview);
    const ce = $("ofCodeEdit");
    if (ce) ce.addEventListener("click", () => {
      st.codeEdit = !st.codeEdit; $("ofCode").hidden = !st.codeEdit;
      ce.textContent = st.codeEdit ? "Dùng mã tự động" : "Sửa mã";
      $("ofCodeHint").textContent = "";
      if (st.codeEdit) { if (!$("ofCode").value) $("ofCode").value = $("ofCodeOut").textContent; $("ofCode").focus(); }
    });
    $("ofAdd").addEventListener("click", () => { st.items.push({ product: "", teeth: "", qty: 1, note: "", auto: true }); drawItems(); $("ofItems").querySelector(`[data-i="${st.items.length - 1}"] [data-k="product"]`).focus(); });
    host.querySelectorAll('input[name="ofCharge"], #ofPct, #ofAmt').forEach((el) => el.addEventListener("input", sum));
    host.querySelectorAll("[data-pct]").forEach((b) => b.addEventListener("click", () => { $("ofPct").value = b.dataset.pct === "0" ? "" : b.dataset.pct; sum(); }));
    if ($("ofCur")) $("ofCur").addEventListener("change", () => { drawItems(); sum(); });
    const stSel = $("ofSt");
    const delVis = () => { if ($("ofDelWrap")) $("ofDelWrap").hidden = !(stSel && stSel.value === "delivered"); };
    if (stSel) { stSel.addEventListener("change", delVis); delVis(); }
    drawItems(); sum();
    if (st.cust) setCust(); else loadPrices();
    codePreview();

    $("ofForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("ofErr"); err.hidden = true;
      const fail = (m, el) => { err.textContent = m; err.hidden = false; if (el) el.focus(); };
      if (dupList.length && !($("ofDupOk") && $("ofDupOk").checked)) { dupBox.scrollIntoView({ block: "center", behavior: "smooth" }); return fail("Đơn này có thể đã có (xem khung đỏ ở trên). Mở đơn đã có, hoặc tick \"Đây là đơn khác\" để vẫn tạo đơn mới."); }
      if (!st.cust && !portal && !parent) return fail("Chọn khách hàng có trong danh sách.", $("ofCust"));
      const its = st.items.filter((x) => String(x.product || "").trim());
      const bad = its.find((x) => !prodOf(x.product));
      if (bad) return fail("Mã hàng \"" + bad.product + "\" chưa có trong danh mục.");
      const body = {
        clinic: $("ofClinic").value.trim(), doctor: $("ofDoctor").value.trim(), patient: $("ofPatient").value.trim(), ref: $("ofRef").value.trim(),
        service: $("ofSvc").value, material: $("ofMat").value.trim(), shade: $("ofShade").value.trim(), notes: $("ofNotes").value.trim(),
        due: $("ofDue").value || "",
        teeth: its.map((x) => String(x.teeth || "").trim()).filter(Boolean).join("; "),
        items: its.map((x) => ({ ...(x.id ? { id: x.id } : {}), product: String(x.product).trim().toUpperCase(), teeth: String(x.teeth || "").trim(), qty: +x.qty || 1, note: String(x.note || "").trim(),
          ...(canPrice ? { price: x.price === undefined || x.price === null || String(x.price).trim() === "" ? "" : +x.price } : {}) })),
      };
      if (!portal && !parent) { body.received = $("ofDay").value; body.customer_id = st.cust.id; }
      if (st.codeEdit && $("ofCode").value.trim()) body.code = $("ofCode").value.trim();
      if (canPrice) {
        body.charge = (document.querySelector('input[name="ofCharge"]:checked') || {}).value || "charge";
        body.adj_pct = +($("ofPct").value || 0); body.adj_amount = +($("ofAmt").value || 0); body.currency = $("ofCur").value;
      }
      if ($("ofDes")) { body.designer = $("ofDes").value; body.qc = $("ofQc").value; }
      if (stSel && stSel.value) { body.status = stSel.value; if (stSel.value === "delivered") body.delivered = $("ofDel").value; }
      if ($("ofChat") && $("ofChat").value.trim()) body.chat = $("ofChat").value.trim();
      if (parent) { body.kind = kind; body.parent_id = parent.id; }
      if (!order && !parent && !($("ofDupOk") && $("ofDupOk").checked)) body.check_dupes = true;
      const btn = $("ofSave"); D8.busy(btn, true);
      try {
        const r = order ? await api("/api/orders/" + order.id, { method: "POST", body }) : await api("/api/orders", { method: "POST", body });
        D8.toast(order ? "Đã lưu đơn " + r.order.code + "." : "Đã tạo đơn " + r.order.code + ".");
        listData = null;
        location.hash = "#orders/" + r.order.id;
      } catch (ex) {
        D8.busy(btn, false);
        if (ex.data && ex.data.code === "dupe") { dupList = ex.data.dupes || []; drawDupes(); dupBox.scrollIntoView({ block: "center", behavior: "smooth" }); }
        fail(ex.message);
      }
    });
  }

  /* ------------------------------------------------------------ the order page */
  const STEPS = [["new", "Mới nhận"], ["design", "Thiết kế"], ["qc", "QC"], ["review", "Bác sĩ duyệt"], ["approved", "Đã duyệt"], ["delivered", "Đã giao"]];
  const stepOf = (s) => ({ new: 0, design: 1, fix: 1, revise: 1, qc: 2, ready: 3, review: 3, approved: 4, delivered: 5 }[s] ?? -1);
  let cur = null;
  async function drawOrder(id) {
    const W = ws();
    W.setBand("Đơn hàng", "", { back: true, backHref: "#orders", backText: "Đơn hàng" });
    if (!cur || cur.order.id !== id) { W.show("p-order", true); $("p-order").innerHTML = D8.skel.page(); }
    let d;
    try { d = await api("/api/orders/" + id); }
    catch (err) { $("p-order").innerHTML = err.data && err.data.code === "no_db" ? noDbPanel(err) : `<div class="pt-empty"><h2 class="h-caps">Không mở được đơn</h2><p>${esc(err.message)}</p><a class="btn" href="#orders">Về danh sách đơn</a></div>`; W.show("p-order"); return; }
    cur = d;
    renderOrder(d);
  }
  function renderOrder(d) {
    const W = ws(), o = d.order, m = money_(), me = (D8.user && D8.user.email) || "", any = can("orders.view") || W.mode() === "key";
    const portal = !!o.job_id;
    W.setBand(o.code, [o.customer_name, o.patient].filter(Boolean).join(" · "), { back: true, backHref: "#orders", backText: "Đơn hàng", right: D8.ostChip(o.status) + kindChip(o) });
    const si = stepOf(o.status);
    const steps = STEPS.map(([k, l], i) => {
      const cls = o.status === "cancelled" || o.status === "hold" ? "" : i < si || (i === si && k === "delivered") ? "done" : i === si ? "cur" : "";
      return `<li class="${cls}"><span class="dot">${cls === "done" ? '<svg width="12" height="12" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M3 9.5l4 4 8-9"/></svg>' : ""}</span><span class="lbl">${esc(l)}</span></li>`;
    }).join("");
    // workflow actions (orders entered in the workspace)
    const acts = [];
    if (!portal) {
      const mine = o.designer === me || any;
      if (["new", "design", "fix", "revise"].includes(o.status) && can("cases.design") && mine) acts.push(["submit", "Gửi QC", "btn-primary"]);
      if (o.status === "new" && can("cases.design") && o.designer === me) acts.push(["start", "Bắt đầu thiết kế", ""]);
      if (o.status === "qc" && can("cases.qc") && (o.qc === me || !o.qc || any)) acts.push(["pass", "QC đạt", "btn-ok"], ["fail", "Không đạt, trả KTV", "btn-danger"]);
      if (["ready", "revise"].includes(o.status) && can("cases.deliver")) acts.push(["review", "Đã gửi bác sĩ duyệt", ""]);
      if (o.status === "review" && (can("cases.status") || can("cases.deliver"))) acts.push(["approve", "Bác sĩ đã duyệt", "btn-ok"], ["revise", "Bác sĩ yêu cầu sửa", ""]);
      if (["ready", "review", "approved"].includes(o.status) && can("cases.deliver")) acts.push(["deliver", "Đã giao file", "btn-primary"]);
      if (!["delivered", "cancelled", "hold"].includes(o.status) && can("cases.status")) acts.push(["hold", "Tạm dừng", ""], ["cancel", "Hủy đơn", "btn-danger"]);
      if (["delivered", "cancelled", "hold"].includes(o.status) && (can("cases.status") || can("cases.qc"))) acts.push(["reopen", "Mở lại", ""]);
    }
    const needNote = acts.some((a) => a[0] === "fail" || a[0] === "cancel");
    const fam = (d.related || []).length > 1 ? `<nav class="o-fam" aria-label="Đơn cùng ca">${d.related.map((x) => `<a href="#orders/${x.id}"${x.id === o.id ? ' aria-current="page"' : ""}><b>${esc(x.code)}</b><small>${esc(lastSeg(x.code) ? codeSteps(x.code) : "giai đoạn 1")} · ${esc(OST[x.status] || x.status)}</small></a>`).join("")}</nav>` : "";
    const det = [["Khách hàng", o.customer_code + " — " + o.customer_name], ["Nha khoa", o.clinic], ["Bác sĩ", o.doctor], ["Bệnh nhân", o.patient], ["Mã của khách", o.ref],
      ["Ngày nhận", fmtDay(o.day)], ["Hạn giao", o.due_at ? D8.fmtDate(o.due_at, true) : ""], ["Ngày giao", o.dday ? fmtDay(o.dday) : ""],
      ["Dịch vụ", D8.svcLabel(o.service)], ["Vật liệu", o.material], ["Màu", o.shade], ["Loại đơn", kindText(o) + (codeSteps(o.code) ? " (" + codeSteps(o.code) + ")" : "")], ["Nguồn", o.source === "portal" ? "Cổng khách hàng" : o.source === "import" ? "Nhập từ Excel" : "Nhập tay"]]
      .filter((r) => r[1]).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
    const items = d.items || [];
    const itemsHtml = items.length ? `<div class="tbl-wrap"><table class="grid-tbl o-items"><thead><tr><th>Mã hàng</th><th>Răng</th><th class="num">SL</th>${m ? '<th class="num">Đơn giá</th><th class="num">Thành tiền</th>' : ""}</tr></thead>
      <tbody>${items.map((x) => `<tr><td><b>${esc(x.product)}</b><small>${esc(x.name)}${x.note ? " · " + esc(x.note) : ""}</small></td><td data-l="Răng">${esc(x.teeth || "—")}</td><td class="num" data-l="SL">${esc(x.qty)}</td>${m ? `<td class="num" data-l="Đơn giá">${esc(money(x.price, o.currency))}</td><td class="num amt">${esc(money(x.amount, o.currency))}</td>` : ""}</tr>`).join("")}</tbody></table></div>` : '<p class="muted" style="margin:0">Chưa có hạng mục.</p>';
    const moneyHtml = m ? `<dl class="o-money">
        <div><dt>Tạm tính</dt><dd>${esc(money(o.subtotal, o.currency))}</dd></div>
        ${o.adj_pct ? `<div><dt>Phụ phí ${esc(o.adj_pct)}%</dt><dd>${esc(money(o.subtotal * o.adj_pct / 100, o.currency))}</dd></div>` : ""}
        ${o.adj_amount ? `<div><dt>Cộng / trừ</dt><dd>${esc(money(o.adj_amount, o.currency))}</dd></div>` : ""}
        <div class="tot"><dt>Tổng${o.charge !== "charge" ? " · " + esc(CHARGE[o.charge]) : ""}</dt><dd>${esc(money(o.total, o.currency))}</dd></div>
        <div><dt>Đã thu</dt><dd>${esc(money(o.paid, o.currency))}</dd></div>
        <div class="${o.due > 0 && o.status !== "cancelled" ? "due" : ""}"><dt>Còn nợ</dt><dd>${o.status === "cancelled" ? "—" : esc(money(o.due, o.currency))}</dd></div>
        ${"tech_cost" in o ? `<div class="tech"><dt>Công KTV</dt><dd>${o.tech_cost ? esc(money(o.tech_cost, o.tech_currency || "VND")) : "—"}</dd></div>` : ""}</dl>`
      : o.charge && o.charge !== "charge" ? `<p class="hint">${esc(CHARGE[o.charge])}</p>` : ("tech_cost" in o ? `<p class="hint">Công của bạn: <b>${o.tech_cost ? esc(money(o.tech_cost, o.tech_currency || "VND")) : "—"}</b></p>` : "");
    const pays = d.payments || [];
    const payCard = m ? `<section class="card"><div class="card-head-row"><h2 class="h-caps">Thanh toán</h2>${can("billing.edit") && o.status !== "cancelled" ? `<button class="btn small" type="button" id="opAddBtn">${ICON.plus}Ghi nhận tiền</button>` : ""}</div>
      ${pays.length ? `<ul class="o-pays">${pays.map((p) => `<li><b>${esc(money(p.amount, p.currency))}</b><span>${esc(fmtDay(p.day))} · ${esc(D8.PAY_METHOD[p.method] || p.method)}${p.ref ? " · " + esc(p.ref) : ""}${p.note ? " · " + esc(p.note) : ""}</span></li>`).join("")}</ul>` : '<p class="muted" style="margin:0">Chưa có khoản trả riêng cho đơn này.</p>'}
      <form id="opForm" hidden class="o-payform"><div class="of-grid3 tight"><div><label class="field-label" for="opDay">Ngày nhận tiền</label><input class="input" type="date" id="opDay" value="${vnToday()}"></div>
        <div><label class="field-label" for="opAmt">Số tiền (${esc(o.currency)})</label><input class="input" type="number" step="any" id="opAmt" value="${o.due > 0 ? o.due : ""}"></div>
        <div><label class="field-label" for="opMethod">Hình thức</label><select class="input" id="opMethod">${Object.entries(D8.PAY_METHOD).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></div></div>
        <label class="field-label" for="opRef">Mã giao dịch / ghi chú</label><input class="input" id="opRef" maxlength="120">
        <div class="wf-actions"><button class="btn btn-primary small" type="submit">Lưu khoản thu</button></div></form>
      <a class="hint" href="#cust/${o.customer_id}">Sổ thanh toán của khách ›</a></section>` : "";
    const linkCard = can("links.manage") || can("cases.deliver") ? `<section class="card"><div class="card-head-row"><h2 class="h-caps">Link xem 3D</h2></div>
      <div id="oLinks">${(o.previews || []).length ? o.previews.map((pid) => `<div class="pv"><span class="ic">${D8.ORDER_ICON.next}</span><div class="tx"><b>${esc(location.origin + "/v/" + pid)}</b></div><a class="btn small" href="/v/${esc(pid)}" target="_blank" rel="noopener">Mở</a><button class="btn small" type="button" data-copy="${esc(pid)}">Sao chép</button></div>`).join("") : ""}</div>
      ${portal ? `<p class="hint"><a href="#jobs/${esc(o.job_id)}">Mở trang ca ›</a></p>` : `<div id="oLinkNew"></div>`}</section>` : "";
    const chatCard = can("cases.notes") ? `<section class="card o-chat-card"><div class="card-head-row"><h2 class="h-caps">Chat nội bộ · ${esc(o.code)}</h2></div>
      <div id="oChat"></div></section>` : "";
    W.show("p-order");
    $("p-order").innerHTML = `
      ${fam}
      <div class="o-actbar">
        ${can("orders.edit") ? `<a class="btn small" href="#orders/${o.id}/edit">${ICON.edit}Sửa đơn</a>${o.status !== "cancelled" ? `<a class="btn small" href="#orders/new?redo=${o.id}" title="Tạo đơn ${esc(o.code.replace(/R\d+$/, ""))}R…">${ICON.redo}Làm lại (R)</a><a class="btn small" href="#orders/new?continue=${o.id}">${ICON.next}Làm tiếp giai đoạn (C)</a>` : ""}` : ""}
        ${portal ? `<a class="btn small btn-primary" href="#jobs/${esc(o.job_id)}">Mở ca cổng khách</a>` : ""}
        ${can("orders.delete") && !portal ? `<button class="btn small btn-danger" type="button" id="oDel">Xóa đơn</button>` : ""}
      </div>
      <ol class="pt-steps o-steps" aria-label="Tiến độ">${steps}</ol>
      ${o.status === "hold" ? '<div class="pt-alert warn"><div>Đơn đang tạm dừng (chờ bổ sung).</div></div>' : ""}${o.status === "cancelled" ? '<div class="pt-alert mute"><div>Đơn đã hủy, không tính tiền.</div></div>' : ""}
      <div class="pt-grid o-grid">
        <div>
          <section class="card" id="oWf"><div class="card-head-row"><h2 class="h-caps">Quy trình</h2>${D8.ostChip(o.status)}</div>
            ${portal ? `<p class="hint"><a href="#jobs/${esc(o.job_id)}">Mở trang ca ›</a></p>` : ""}
            <p class="o-who">KTV: <b>${esc(name(o.designer) || "chưa giao")}</b> · QC: <b>${esc(name(o.qc) || "chưa giao")}</b>${o.qc_fails ? ` · <span class="muted">QC trả về ${o.qc_fails} lần</span>` : ""}</p>
            ${can("cases.assign") && !portal ? `<form class="o-assign" id="oAssign"><select class="input" id="oaD" aria-label="KTV">${['<option value="">— KTV —</option>', ...W.team().filter((t) => t.design).map((t) => `<option value="${esc(t.email)}"${t.email === o.designer ? " selected" : ""}>${esc(t.name || t.email)}</option>`)].join("")}</select>
              <select class="input" id="oaQ" aria-label="QC">${['<option value="">— QC —</option>', ...W.team().filter((t) => t.qc).map((t) => `<option value="${esc(t.email)}"${t.email === o.qc ? " selected" : ""}>${esc(t.name || t.email)}</option>`)].join("")}</select>
              <button class="btn small" type="submit">Lưu phân công</button></form>` : ""}
            ${acts.length ? `<div class="o-acts">${needNote ? '<label class="field-label" for="oNote">Ghi chú (bắt buộc khi QC không đạt hoặc hủy)</label><textarea class="input" id="oNote" rows="2" maxlength="2000"></textarea>' : '<label class="field-label" for="oNote">Ghi chú kèm theo (không bắt buộc)</label><textarea class="input" id="oNote" rows="2" maxlength="2000"></textarea>'}
              <div class="wf-actions">${acts.map(([a, l, c]) => `<button class="btn small ${c}" type="button" data-act="${a}">${esc(l)}</button>`).join("")}</div></div>` : ""}
          </section>
          <section class="card o3d" id="o3d" hidden></section>
          <section class="card"><div class="card-head-row"><h2 class="h-caps">Hạng mục</h2><span class="chip">${esc(o.units)} đơn vị</span></div>${itemsHtml}${moneyHtml}</section>
          <section class="card"><h2 class="h-caps" style="margin-bottom:14px">Thông tin</h2><dl class="dl">${det}</dl>
            ${o.notes ? `<p class="grp" style="margin-top:18px">Yêu cầu của bác sĩ</p><p class="notes">${esc(o.notes)}</p>` : ""}</section>
          ${linkCard}${payCard}
        </div>
        <aside>${chatCard}</aside>
      </div>`;
    // wiring
    const post = (path, body) => api("/api/orders/" + o.id + path, { method: "POST", body });
    const again = (r) => { cur = { ...cur, order: r.order }; drawOrder(o.id); };
    const as = $("oAssign");
    if (as) as.addEventListener("submit", async (e) => {
      e.preventDefault(); const b = as.querySelector("[type=submit]"); D8.busy(b, true);
      try { const r = await post("", { designer: $("oaD").value, qc: $("oaQ").value }); D8.toast("Đã lưu phân công."); again(r); } catch (err) { D8.busy(b, false); D8.toast(err.message); }
    });
    $("p-order").querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      const note = ($("oNote") || {}).value ? $("oNote").value.trim() : "";
      if ((b.dataset.act === "fail" || b.dataset.act === "cancel") && note.length < 3) { D8.toast(b.dataset.act === "fail" ? "Ghi rõ lỗi cần sửa để KTV biết." : "Ghi lý do hủy."); return $("oNote").focus(); }
      D8.busy(b, true);
      try { const r = await post("/act", { action: b.dataset.act, note }); D8.toast(OST[r.order.status] + "."); again(r); } catch (err) { D8.busy(b, false); D8.toast(err.message); }
    }));
    const del = $("oDel");
    if (del) W.armed(del, async () => { await api("/api/orders/" + o.id, { method: "DELETE" }); D8.toast("Đã xóa đơn " + o.code + "."); listData = null; location.hash = "#orders"; });
    const pa = $("opAddBtn");
    if (pa) pa.addEventListener("click", () => { $("opForm").hidden = !$("opForm").hidden; if (!$("opForm").hidden) $("opAmt").focus(); });
    const pf = $("opForm");
    if (pf) pf.addEventListener("submit", async (e) => {
      e.preventDefault(); const b = pf.querySelector("[type=submit]"); D8.busy(b, true);
      try {
        await api("/api/payments", { method: "POST", body: { order_id: o.id, customer_id: o.customer_id, day: $("opDay").value, amount: +$("opAmt").value, method: $("opMethod").value, ref: $("opRef").value.trim() } });
        D8.toast("Đã ghi nhận khoản thu."); drawOrder(o.id);
      } catch (err) { D8.busy(b, false); D8.toast(err.message); }
    });
    $("p-order").querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.origin + "/v/" + b.dataset.copy); D8.done(b, "Đã chép"); } catch { D8.toast(location.origin + "/v/" + b.dataset.copy); } }));
    if ($("oLinkNew") && D8.linkMaker) D8.linkMaker($("oLinkNew"), { order: o, previews: o.previews || [], onDone: async (link) => {
      const r = await post("/previews", { linkId: link.id });
      cur = { ...cur, order: r.order };
      const row = document.createElement("div"); row.className = "pv";
      row.innerHTML = `<span class="ic">${ICON.next}</span><div class="tx"><b>${esc(link.url)}</b></div><a class="btn small" href="${esc(link.url)}" target="_blank" rel="noopener">Mở</a>`;
      $("oLinks").appendChild(row);
    } });
    if ($("oChat")) {
      $("oChat").addEventListener("d8:models", (e) => { if ($("o3d") && D8.view3d) D8.view3d.gallery($("o3d"), e.detail); });
      D8.orderChat($("oChat"), o.id);
    }
  }

  /* ------------------------------------------------------------ team chat by order code */
  const imgCache = new Map();
  async function imgUrl(orderId, mid) {
    const k = orderId + ":" + mid;
    if (!imgCache.has(k)) imgCache.set(k, fetch(`/api/orders/${orderId}/chat/${mid}/img`, { headers: D8.authHeaders(), credentials: "same-origin" }).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? URL.createObjectURL(b) : "")));
    return imgCache.get(k);
  }
  async function toJpeg(file) {
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const s = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.82);
    } finally { URL.revokeObjectURL(url); }
  }
  D8.orderChat = function (host, orderId) {
    host.innerHTML = `<div class="ochat"><div class="ochat-list" id="ocList-${orderId}" role="log" aria-live="polite">${D8.skel.rows(2)}</div>
      <form class="ochat-form"><label class="sr-only" for="ocText-${orderId}">Tin nhắn nội bộ</label>
        <textarea class="input" id="ocText-${orderId}" rows="2" maxlength="4000" placeholder="Nhắn gì cho KTV / QC?"></textarea>
        <div class="ochat-img" hidden><img alt=""><button class="iconbtn" type="button" aria-label="Bỏ ảnh">${ICON.x}</button></div>
        <ul class="ochat-files" hidden></ul>
        <div class="ochat-foot"><label class="btn small ochat-pick" title="Gửi ảnh">${ICON.img}<span>Ảnh</span><input type="file" accept="image/*" hidden data-ochat="img"></label>
          <label class="btn small ochat-pick" title="Gửi file (STL, PLY, HTML exocad, PDF, ZIP…)">${ICON.clip}<span>File</span><input type="file" multiple hidden data-ochat="file"></label>
          <button class="btn btn-primary small" type="submit">Gửi</button></div>
        <p class="hint ochat-prog" hidden></p>
        <p class="error" hidden></p></form></div>`;
    const list = host.querySelector(".ochat-list"), form = host.querySelector("form"), box = form.querySelector("textarea"), err = form.querySelector(".error");
    const prevBox = form.querySelector(".ochat-img"), prevImg = prevBox.querySelector("img"), fileBox = form.querySelector(".ochat-files"), prog = form.querySelector(".ochat-prog");
    let msgs = [], last = 0, img = "", files = [], timer = null, loading = false;
    const FILE_MAX = 300 * 1024 * 1024;
    const drawFiles = () => {
      fileBox.hidden = !files.length;
      fileBox.innerHTML = files.map((f, i) => `<li>${ICON.clip}<span>${esc(f.name)}</span><small>${esc(D8.size(f.size))}</small><button class="iconbtn" type="button" data-rmf="${i}" aria-label="Bỏ ${esc(f.name)}">${ICON.x}</button></li>`).join("");
      fileBox.querySelectorAll("[data-rmf]").forEach((b) => b.addEventListener("click", () => { files.splice(+b.dataset.rmf, 1); drawFiles(); }));
    };
    const addFiles = (list) => {
      for (const f of list) {
        if (f.size > FILE_MAX) { D8.toast("File " + f.name + " quá lớn (tối đa 300 MB)."); continue; }
        if (!files.some((x) => x.name === f.name && x.size === f.size)) files.push(f);
      }
      files = files.slice(0, 10); drawFiles();
    };
    const me = (D8.user && D8.user.email) || "";
    const draw = () => {
      if (!msgs.length) { list.innerHTML = '<p class="muted ochat-empty">Chưa có tin nhắn.</p>'; return; }
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
      list.innerHTML = msgs.map((x) => x.kind === "sys" ? `<div class="sys">${esc(D8.fmtDate(x.at, true))} · ${esc(x.name || name(x.by) || "")}: ${esc(x.text)}</div>`
        : `<div class="bub ${x.by === me ? "me" : "them"}">${x.by === me ? "" : `<b>${esc(x.name || name(x.by))}</b>`}${x.text ? `<div class="bub-text">${esc(x.text)}</div>` : ""}${x.img ? `<a class="ochat-photo" data-mid="${x.id}" href="#" aria-label="Mở ảnh"><img alt="Ảnh" data-mid="${x.id}"></a>` : ""}${(x.files || []).map((f) => `<a class="ochat-file" href="/api/orders/${orderId}/files/${esc(f.fid)}" download="${esc(f.name)}">${ICON.clip}<span class="fn">${esc(f.name)}</span><span class="fs">${esc(D8.size(f.size))}</span></a>${D8.view3d && D8.view3d.is(f.name) ? `<button class="ochat-3d" type="button" data-v3d="/api/orders/${orderId}/files/${esc(f.fid)}" data-name="${esc(f.name)}" data-size="${f.size}">Xem 3D</button>` : ""}`).join("")}<small>${esc(D8.fmtDate(x.at, true))}</small></div>`).join("");
      list.querySelectorAll("img[data-mid]").forEach(async (im) => { const u = await imgUrl(orderId, im.dataset.mid); if (u) im.src = u; else im.alt = "Ảnh đã hết hạn"; });
      list.querySelectorAll("a.ochat-photo").forEach((a) => a.addEventListener("click", async (e) => { e.preventDefault(); const u = await imgUrl(orderId, a.dataset.mid); if (u) window.open(u, "_blank", "noopener"); }));
      if (atBottom || !draw.done) list.scrollTop = list.scrollHeight;
      draw.done = true;
      // 3D files sent in the chat (newest first) for the preview on the order page
      const models = msgs.flatMap((x) => (x.files || []).map((f) => ({ url: `/api/orders/${orderId}/files/${f.fid}`, name: f.name, size: f.size, at: x.at }))).filter((f) => D8.view3d && D8.view3d.is(f.name)).reverse();
      host.dispatchEvent(new CustomEvent("d8:models", { detail: models }));
    };
    const load = async () => {
      if (loading || !host.isConnected) return;
      loading = true;
      try {
        const r = await api(`/api/orders/${orderId}/chat?after=${last}`);
        if (r.msgs.length) { msgs = [...msgs, ...r.msgs].slice(-400); last = msgs[msgs.length - 1].id; }
        draw();
        document.dispatchEvent(new CustomEvent("d8:chat-read", { detail: orderId }));
      } catch (e) { if (!msgs.length) list.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
      loading = false;
    };
    const tick = () => { if (!host.isConnected) { clearInterval(timer); return; } if (!document.hidden) load(); };
    timer = setInterval(tick, 15000);
    load();
    const setImg = async (file) => {
      if (!file || !/^image\//.test(file.type)) return;
      try { img = await toJpeg(file); prevImg.src = img; prevBox.hidden = false; } catch { D8.toast("Không đọc được ảnh này."); }
    };
    form.querySelector('[data-ochat="img"]').addEventListener("change", (e) => { setImg(e.target.files[0]); e.target.value = ""; });
    form.querySelector('[data-ochat="file"]').addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });
    form.addEventListener("dragover", (e) => { if ([...(e.dataTransfer ? e.dataTransfer.types : [])].includes("Files")) { e.preventDefault(); form.classList.add("drop"); } });
    form.addEventListener("dragleave", (e) => { if (!form.contains(e.relatedTarget)) form.classList.remove("drop"); });
    form.addEventListener("drop", (e) => { e.preventDefault(); form.classList.remove("drop"); addFiles([...(e.dataTransfer ? e.dataTransfer.files : [])]); });
    prevBox.querySelector("button").addEventListener("click", () => { img = ""; prevBox.hidden = true; prevImg.removeAttribute("src"); });
    box.addEventListener("paste", (e) => { const f = [...(e.clipboardData ? e.clipboardData.files : [])].find((x) => /^image\//.test(x.type)); if (f) { e.preventDefault(); setImg(f); } });
    box.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = box.value.trim();
      if (!text && !img && !files.length) return box.focus();
      const b = form.querySelector("[type=submit]"); D8.busy(b, true); err.hidden = true;
      try {
        if (img || (text && !files.length)) await api(`/api/orders/${orderId}/chat`, { method: "POST", body: { text: files.length ? "" : text, ...(img ? { img } : {}) } });
        img = ""; prevBox.hidden = true;
        if (files.length) {
          const base = `/api/orders/${orderId}/files`;
          prog.hidden = false;
          const metas = await D8.uploadParts(base, files, { onProgress: (p) => { prog.textContent = p.text; } });
          await api(base, { method: "POST", body: { files: metas, text } });
          files = []; drawFiles(); prog.hidden = true;
        }
        box.value = ""; D8.busy(b, false);
        await load();
        list.scrollTop = list.scrollHeight;
      } catch (ex) { D8.busy(b, false); prog.hidden = true; err.textContent = ex.message; err.hidden = false; }
    });
  };

  /* ------------------------------------------------------------ dashboard */
  const PAY_METHOD = { paypal: "PayPal", payoneer: "Payoneer", remitly: "Remitly", bank: "Chuyển khoản ngân hàng", cash: "Tiền mặt", deposit: "Tiền ứng trước", other: "Khác" };
  D8.PAY_METHOD = PAY_METHOD;
  const orderHref = (o) => "#orders/" + o.id;
  D8.ordersDash = async function (host, extraCards, head) {
    let d;
    try { d = await api("/api/orders/dash"); }
    catch (err) { if (err.data && err.data.code === "no_db") return false; throw err; }
    const row = (o) => `<li><a href="${orderHref(o)}"><span class="t">${esc(o.code)}${o.patient ? " · " + esc(o.patient) : ""}</span><span class="i">${esc(o.customer_code)}${o.items_text ? " · " + esc(o.items_text) : ""}${o.designer ? " · " + esc(name(o.designer)) : ""}</span><span class="a">${o.due_at ? (o.due_at < Date.now() ? '<b class="late">trễ</b> ' : "hạn ") + esc(D8.fmtDate(o.due_at, true)) : esc(fmtDay(o.day))}</span></a></li>`;
    const card = (title, list, empty, link) => `<section class="card"><div class="dash-h"><h2 class="h-caps">${esc(title)}</h2><b>${list.length}${list.length >= 12 ? "+" : ""}</b></div>
      ${list.length ? `<ul>${list.slice(0, 6).map(row).join("")}</ul>${link ? `<p class="hint"><a href="${link}">Xem tất cả</a></p>` : ""}` : `<p class="none">${esc(empty)}</p>`}</section>`;
    const cards = [];
    if (d.money) {
      const by = (list, c) => list.find((x) => x.currency === c) || {};
      const curs = [...new Set([...d.money.map((x) => x.currency), ...(d.debt || []).map((x) => x.currency)])];
      if (!curs.length) curs.push("USD");
      cards.push(`<section class="card dash-money"><div class="dash-h"><h2 class="h-caps">Tháng này</h2><a class="hint" href="#reports">Báo cáo ›</a></div>
        ${curs.map((c) => { const mo = by(d.money, c), db = by(d.debt || [], c); return (curs.length > 1 ? `<span class="dm-cur">${esc(c)}</span>` : "") + `<div class="dm-row"><div><span>Doanh thu</span><b>${esc(money(mo.total || 0, c))}</b><small>${mo.n || 0} đơn</small></div><div><span>Đã thu</span><b>${esc(money(mo.paid || 0, c))}</b></div><div class="${db.due > 0 ? "due" : ""}"><span>Tổng công nợ</span><b>${esc(money(db.due || 0, c))}</b><small>${db.n || 0} đơn còn nợ</small></div></div>`; }).join("")}</section>`);
    }
    if (d.mine) cards.push(card("Việc thiết kế của tôi", d.mine, "Không có đơn nào đang chờ bạn thiết kế.", "#orders?designer=me&status=work"));
    if (d.qc) cards.push(card("Chờ QC", d.qc, "Không có đơn nào chờ QC.", "#orders?status=qc"));
    if (d.unread) cards.push(card("Chat nội bộ chưa đọc", d.unread, "Không có tin nhắn nội bộ mới.", "#orders?status="));
    if (d.ready) cards.push(card("Đã qua QC / đã duyệt, chờ giao", d.ready, "Không có đơn nào chờ giao.", "#orders?status=review"));
    if (d.unassigned) cards.push(card("Chưa giao KTV", d.unassigned, "Đơn nào cũng đã có người làm.", "#orders?designer=none"));
    cards.push(card("Sắp đến hạn (24 giờ)", d.due || [], "Không có đơn nào sắp đến hạn."));
    host.innerHTML = (head || "") + cards.join("") + (extraCards || "");
    return true;
  };
  // sidebar badge: unread team chats
  let unreadAt = 0;
  D8.refreshOrderBadge = async function (force) {
    if (!force && Date.now() - unreadAt < 30000) return;
    unreadAt = Date.now();
    try { const r = await api("/api/orders/unread"); ws().setNavCount("/admin#orders", r.count || 0); } catch {}
  };
  document.addEventListener("d8:chat-read", () => { unreadAt = 0; setTimeout(() => D8.refreshOrderBadge(true), 300); });

  /* ------------------------------------------------------------ routes */
  D8.wsRoutes.push(
    { re: /^orders$/, fn: (m, q) => drawOrders(q) },
    { re: /^orders\/new$/, fn: (m, q) => (can("orders.edit") ? drawForm(0, q) : ws().denied()) },
    { re: /^orders\/(\d+)\/edit$/, fn: (m, q) => (can("orders.edit") || can("billing.edit") ? drawForm(+m[1], q) : ws().denied()) },
    { re: /^orders\/(\d+)$/, fn: (m) => drawOrder(+m[1]) },
  );
  D8.orderParseHash = parseHash;
})();
