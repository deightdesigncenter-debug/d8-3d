/* D.EIGHT workspace — customers, product codes and price lists, KTV pay rates, payments, reports with charts,
   Excel export and import, settings. Works with the order book (D1) API; the server checks every permission. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => D8.esc(s);
  const api = (p, o) => D8.api(p, o);
  const can = (p) => D8.can(p);
  const ws = () => D8.ws;
  const money = (v, c) => D8.fmtMoney(v, c);
  const fmtDay = (d) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "");
  const vnToday = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  // customer kinds: DR (doctor / clinic) or LAB codes; older kinds are shown in the DR group
  const KINDS = { doctor: "Bác sĩ / Phòng khám", lab: "Labo", clinic: "Bác sĩ / Phòng khám", platform: "Nền tảng", other: "Khác" };
  const KIND_PICK = ["doctor", "lab"];
  const AUTO_CODE = /^(DR|LAB)\d{6,8}$/;
  const UNIT = { unit: "răng / đơn vị", arch: "hàm", bridge: "cầu", set: "bộ", case: "ca", hour: "giờ" };
  const TIER = { "": "Giá niêm yết (MAX)", mid: "Mức 2 (MID)", min: "Mức 3 (MIN)" };
  const noDb = (host, err) => { host.innerHTML = D8.noDbPanel(err); };
  const isNoDb = (err) => err && err.data && err.data.code === "no_db";

  /* ============================================================ customers */
  async function drawCustomers() {
    const W = ws();
    W.setBand("Khách hàng", "Bác sĩ, phòng khám và labo", {
      right: `<div class="band-btns">${can("customers.edit") ? '<a class="btn btn-cream small" href="#customers/new">+ Khách mới</a><a class="btn btn-light small" href="#import/customers">Nhập Excel</a>' : ""}${can("export.csv") ? '<button class="btn btn-light small" type="button" id="cuExport">Xuất Excel</button>' : ""}</div>` });
    W.show("p-customers", true);
    const host = $("p-customers");
    host.innerHTML = `<div id="cuRecode"></div><section class="card"><div class="card-head"><h2 class="h-caps">Danh sách khách hàng</h2>
        <input class="input pt-search" type="search" id="cuQ" placeholder="Tìm khách nào?" aria-label="Tìm khách hàng"></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mã</th><th>Khách hàng</th><th>Loại</th><th>Tiền tệ</th><th class="num">Số đơn</th>${can("billing.view") ? '<th class="num">Doanh thu</th><th class="num">Còn nợ</th>' : ""}<th>Đơn gần nhất</th></tr></thead>
        <tbody id="cuBody">${D8.skel.tableRows(can("billing.view") ? 8 : 6, 4)}</tbody></table></div></section>
      <section class="card" id="cuLogins"><h2 class="h-caps">Tài khoản cổng khách hàng</h2><div id="cuLoginList">${D8.skel.rows(2)}</div></section>`;
    W.show("p-customers");
    let list;
    try { list = await D8.book.customers(true); }
    catch (err) { if (isNoDb(err)) { W.legacyCustomers(); return; } host.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
    const draw = () => {
      const q = D8X.fold($("cuQ").value);
      const shown = list.filter((c) => !q || D8X.fold([c.code, c.name, c.country, c.email].join(" ")).includes(q));
      const m = can("billing.view");
      $("cuBody").innerHTML = shown.length ? shown.map((c) => `<tr class="${c.active ? "" : "off"}" data-href="#cust/${c.id}"><td><a href="#cust/${c.id}"><b>${esc(c.code)}</b></a></td><td>${esc(c.name)}${c.auto ? ' <span class="tag">từ cổng khách</span>' : ""}${c.country ? `<small>${esc(c.country)}</small>` : ""}</td>
        <td>${esc(KINDS[c.kind] || c.kind)}</td><td>${esc(c.currency)}</td><td class="num">${c.orders ? `<a href="#orders?customer=${c.id}&status=">${c.orders}</a>` : "0"}</td>
        ${m ? `<td class="num">${esc(money(c.billed || 0, c.currency))}</td><td class="num ${c.due > 0 ? "due" : ""}">${esc(money(c.due || 0, c.currency))}</td>` : ""}
        <td>${c.last_order ? esc(D8.fmtDate(c.last_order)) : "—"}</td></tr>`).join("")
        : `<tr><td colspan="8" class="muted">${list.length ? "Không có khách nào khớp." : "Chưa có khách hàng."}</td></tr>`;
      $("cuBody").querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("a")) location.hash = tr.dataset.href; }));
    };
    $("cuQ").addEventListener("input", draw);
    draw();
    // customers still on an old code (JAKE, VCAD…): one click gives them DR / LAB codes
    const old = list.filter((c) => !AUTO_CODE.test(c.code));
    if (old.length && can("customers.edit")) {
      $("cuRecode").innerHTML = `<div class="pt-alert info"><div><b>${old.length} khách đang dùng mã cũ</b> (${esc(old.slice(0, 4).map((c) => c.code).join(", "))}${old.length > 4 ? "…" : ""}).
        <div class="wf-actions"><button class="btn small" type="button" id="cuRecodeGo">Đổi sang mã DR / LAB</button></div></div></div>`;
      W.armed($("cuRecodeGo"), async () => {
        const r = await api("/api/customers/recode", { method: "POST" });
        D8.book.drop(); D8.toast("Đã đổi mã " + r.changed.length + " khách."); drawCustomers();
      });
    }
    const ex = $("cuExport");
    if (ex) ex.addEventListener("click", () => D8X.write([{ name: "Khách hàng", cols: [{ h: "Mã khách", w: 12 }, { h: "Tên khách", w: 32 }, { h: "Loại", w: 12 }, { h: "Quốc gia", w: 12 }, { h: "Tiền tệ", w: 8 },
      { h: "Người liên hệ", w: 20 }, { h: "Email", w: 26 }, { h: "Điện thoại / WhatsApp", w: 18 }, { h: "Địa chỉ", w: 26 }, { h: "Điều khoản thanh toán", w: 22 }, { h: "Ghi chú", w: 30 },
      { h: "Số đơn", t: "i", w: 8 }, ...(can("billing.view") ? [{ h: "Doanh thu", t: "n", w: 14 }, { h: "Còn nợ", t: "n", w: 14 }] : [])],
      rows: list.map((c) => [c.code, c.name, KINDS[c.kind] || c.kind, c.country, c.currency, c.contact, c.email, c.phone, c.address, c.terms, c.note, c.orders || 0, ...(can("billing.view") ? [c.billed || 0, c.due || 0] : [])]) }], "D8-khach-hang-" + vnToday() + ".xlsx"));
    // portal sign-ins and which customer they belong to
    try {
      const staffMails = new Set(W.team().map((t) => t.email));
      const u = ((await api("/api/admin/users")).users || []).filter((x) => !staffMails.has(x.email));
      const byLogin = new Map(); list.forEach((c) => (c.logins || []).forEach((e) => byLogin.set(e, c)));
      $("cuLoginList").innerHTML = u.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tài khoản</th><th>Lab / phòng khám</th><th>Thuộc khách</th><th>Lần gần nhất</th></tr></thead><tbody>
        ${u.map((x) => { const c = byLogin.get(x.email); return `<tr><td><a href="#customers/${encodeURIComponent(x.email)}"><b>${esc(x.name || "—")}</b></a><small>${esc(x.email)}</small></td><td>${esc(x.practice || "—")}</td>
          <td>${can("customers.edit") ? `<select class="input" data-login="${esc(x.email)}" style="height:38px;min-width:180px"><option value="">— Chưa gắn —</option>${list.map((k) => `<option value="${k.id}"${c && c.id === k.id ? " selected" : ""}>${esc(k.code + " — " + k.name)}</option>`).join("")}</select>` : c ? esc(c.code) : "—"}</td>
          <td>${esc(D8.ago(x.last))}</td></tr>`; }).join("")}</tbody></table></div>` : '<p class="muted" style="margin:0">Chưa có tài khoản nào.</p>';
      $("cuLoginList").querySelectorAll("[data-login]").forEach((s) => s.addEventListener("change", async () => {
        if (!s.value) return;
        try { await api(`/api/customers/${s.value}/logins`, { method: "POST", body: { email: s.dataset.login } }); D8.toast("Đã gắn tài khoản. Các đơn của tài khoản này chuyển về khách đã chọn."); D8.book.drop(); drawCustomers(); }
        catch (err) { D8.toast(err.message); }
      }));
    } catch { $("cuLogins").hidden = true; }
  }

  // the customer code is given by the system: DR / LAB + year + number (DR202601), its prefix follows the kind
  function custForm(c) {
    const v = (k) => esc((c && c[k]) || "");
    const kind = c && KIND_PICK.includes(c.kind) ? c.kind : c && c.kind === "lab" ? "lab" : "doctor";
    return `<form id="cfForm" class="cf"><div class="of-grid2">
      <div><label class="field-label" for="cfKind">Loại khách</label><select class="input" id="cfKind">${KIND_PICK.map((k) => `<option value="${k}"${k === kind ? " selected" : ""}>${KINDS[k]}</option>`).join("")}</select></div>
      <div><span class="field-label">Mã khách</span><div class="of-code cf-code"><output id="cfCode">${v("code") || "…"}</output></div></div>
      <div class="span2"><label class="field-label" for="cfName">Tên khách</label><input class="input" id="cfName" maxlength="120" value="${v("name")}" required placeholder="Tên bác sĩ, phòng khám hoặc labo là gì?"></div>
      <div><label class="field-label" for="cfCur">Tiền tệ</label><select class="input" id="cfCur">${["USD", "VND"].map((x) => `<option${(c ? c.currency : "USD") === x ? " selected" : ""}>${x}</option>`).join("")}</select></div>
      <div><label class="field-label" for="cfCountry">Quốc gia</label><input class="input" id="cfCountry" maxlength="60" value="${v("country")}" placeholder="Khách ở nước nào?"></div>
      <div><label class="field-label" for="cfContact">Người liên hệ</label><input class="input" id="cfContact" maxlength="100" value="${v("contact")}" placeholder="Liên hệ với ai?"></div>
      <div><label class="field-label" for="cfEmail">Email</label><input class="input" id="cfEmail" maxlength="160" value="${v("email")}" placeholder="Email của khách là gì?"></div>
      <div><label class="field-label" for="cfPhone">Điện thoại / WhatsApp</label><input class="input" id="cfPhone" maxlength="60" value="${v("phone")}" placeholder="Số điện thoại / WhatsApp?"></div>
      <div><label class="field-label" for="cfAddr">Địa chỉ</label><input class="input" id="cfAddr" maxlength="300" value="${v("address")}" placeholder="Địa chỉ ở đâu?"></div>
      <div class="span2"><label class="field-label" for="cfTerms">Điều khoản thanh toán</label><input class="input" id="cfTerms" maxlength="300" value="${v("terms")}" placeholder="Khách thanh toán theo cách nào?"></div>
      <div class="span2"><label class="field-label" for="cfNote">Ghi chú nội bộ</label><textarea class="input" id="cfNote" rows="3" maxlength="1000" placeholder="Khách này có đặc điểm gì cần lưu ý?">${v("note")}</textarea></div>
      <label class="check span2" style="margin:0"><input type="checkbox" id="cfActive"${!c || c.active ? " checked" : ""}> Đang hợp tác</label>
      </div><div class="wf-actions"><button class="btn btn-primary" type="submit">${c ? "Lưu hồ sơ" : "Tạo khách"}</button></div><p class="error" id="cfErr" hidden></p></form>`;
  }
  function wireCustCode(c) {
    const out = $("cfCode"), kindSel = $("cfKind");
    if (!out || !kindSel) return;
    const show = async () => {
      const pre = kindSel.value === "lab" ? "LAB" : "DR";
      if (c) { if (AUTO_CODE.test(c.code)) out.textContent = c.code.replace(/^(DR|LAB)/, pre); return; }
      try { out.textContent = (await api("/api/customers/next?kind=" + kindSel.value)).code; } catch { out.textContent = pre + "…"; }
    };
    kindSel.addEventListener("change", show);
    show();
  }
  function wireCustForm(c, onSaved) {
    wireCustCode(c);
    $("cfForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = e.submitter || $("cfForm").querySelector("[type=submit]"); D8.busy(b, true); $("cfErr").hidden = true;
      try {
        const r = await api("/api/customers", { method: "POST", body: { ...(c ? { id: c.id, code: c.code } : {}), name: $("cfName").value.trim(), kind: $("cfKind").value, currency: $("cfCur").value,
          country: $("cfCountry").value.trim(), contact: $("cfContact").value.trim(), email: $("cfEmail").value.trim(), phone: $("cfPhone").value.trim(), address: $("cfAddr").value.trim(),
          terms: $("cfTerms").value.trim(), note: $("cfNote").value.trim(), active: $("cfActive").checked } });
        D8.book.drop(); onSaved(r.customer);
      } catch (err) { D8.busy(b, false); $("cfErr").textContent = err.message; $("cfErr").hidden = false; }
    });
  }
  function drawNewCustomer() {
    const W = ws();
    W.setBand("Khách mới", "", { back: true, backHref: "#customers", backText: "Khách hàng" });
    W.show("p-cust");
    $("p-cust").innerHTML = `<section class="card" style="max-width:880px">${custForm(null)}</section>`;
    wireCustForm(null, (c) => { D8.toast("Đã tạo khách " + c.code + "."); location.hash = "#cust/" + c.id; });
    $("cfName").focus();
  }

  async function drawCustomer(id) {
    const W = ws();
    W.setBand("Khách hàng", "", { back: true, backHref: "#customers", backText: "Khách hàng" });
    W.show("p-cust", true);
    const host = $("p-cust");
    host.innerHTML = D8.skel.page();
    let d, orders, prods, prices, pays;
    try {
      [d, orders] = await Promise.all([api("/api/customers/" + id), api(`/api/orders?customer=${id}&status=&limit=12`)]);
      if (can("pricing.manage")) [prods, prices] = await Promise.all([D8.book.products(true), api("/api/prices?customer=" + id)]);
      if (can("billing.view")) pays = (await api("/api/payments?customer=" + id)).payments;
    } catch (err) { if (isNoDb(err)) return noDb(host, err); host.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
    const c = d.customer, m = can("billing.view");
    W.setBand(c.name, [c.code, KINDS[c.kind], c.country, c.currency].filter(Boolean).join(" · "), { back: true, backHref: "#customers", backText: "Khách hàng",
      right: can("orders.edit") ? `<a class="btn btn-cream small" href="#orders/new?customer=${c.id}">+ Đơn mới cho khách này</a>` : "" });
    const tiles = (d.stats.length ? d.stats : [{ currency: c.currency, orders: 0, units: 0, billed: 0, paid: 0, due: 0, credit: 0 }]).map((s) => `<div class="kpis">
      <div class="kpi"><span>Số đơn</span><b>${s.orders}</b></div><div class="kpi"><span>Đơn vị</span><b>${(+s.units || 0).toLocaleString("vi-VN")}</b></div>
      ${m ? `<div class="kpi"><span>Doanh thu</span><b>${esc(money(s.billed, s.currency))}</b></div><div class="kpi"><span>Đã thu</span><b>${esc(money(s.paid, s.currency))}</b></div>
      <div class="kpi ${s.due > 0 ? "due" : ""}"><span>Còn nợ</span><b>${esc(money(s.due, s.currency))}</b></div><div class="kpi"><span>Tiền ứng trước còn lại</span><b>${esc(money(s.credit, s.currency))}</b></div>` : ""}</div>`).join("");
    const orderRows = orders.items.map((o) => `<tr data-href="#orders/${o.id}"><td><a href="#orders/${o.id}"><b>${esc(o.code)}</b></a></td><td>${esc(fmtDay(o.day))}</td><td>${esc(o.patient || "—")}<small>${esc([o.clinic, o.doctor].filter(Boolean).join(" · "))}</small></td>
      <td>${esc(o.items_text || "—")}</td><td>${D8.ostChip(o.status)}</td>${m ? `<td class="num">${esc(money(o.total, o.currency))}</td><td class="num ${o.due > 0 ? "due" : ""}">${esc(money(o.due, o.currency))}</td>` : ""}</tr>`).join("");
    const payRows = (pays || []).map((p) => `<tr><td>${esc(fmtDay(p.day))}</td><td class="num"><b>${esc(money(p.amount, p.currency))}</b></td><td>${esc(D8.PAY_METHOD[p.method] || p.method)}</td><td>${p.order_code ? `<a href="#orders/${p.order_id}">${esc(p.order_code)}</a>` : "<span class=\"muted\">Chung / ứng trước</span>"}</td><td>${esc([p.ref, p.note].filter(Boolean).join(" · "))}</td>
      <td>${can("billing.edit") ? `<button class="iconbtn del" type="button" data-pdel="${p.id}" aria-label="Xóa khoản thu">${D8.ORDER_ICON.x}</button>` : ""}</td></tr>`).join("");
    host.innerHTML = `<div class="pt-grid cu-grid"><div>
        <section class="card">${tiles}</section>
        <section class="card"><div class="card-head-row"><h2 class="h-caps">Đơn hàng gần đây</h2><a class="btn small" href="#orders?customer=${c.id}&status=">Xem tất cả ${orders.count} đơn</a></div>
          ${orders.items.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mã đơn</th><th>Ngày nhận</th><th>Bệnh nhân</th><th>Hạng mục</th><th>Trạng thái</th>${m ? '<th class="num">Thành tiền</th><th class="num">Còn nợ</th>' : ""}</tr></thead><tbody>${orderRows}</tbody></table></div>` : '<p class="muted" style="margin:0">Chưa có đơn nào.</p>'}</section>
        ${prods ? `<section class="card" id="cuPriceCard"><div class="card-head-row"><h2 class="h-caps">Bảng giá của khách (${esc(c.currency)})</h2><div class="band-btns"><button class="btn small" type="button" id="cuPlImp">Nhập bảng giá riêng (Excel)</button></div></div>
          <div class="of-grid2 tight cu-tier"><div><label class="field-label" for="cuTier">Mức giá</label><select class="input" id="cuTier">${Object.entries(TIER).map(([k, l]) => `<option value="${k}"${(c.tier || "") === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div></div>
          <div id="cuPlBox"></div><div id="cuPrices"></div></section>` : ""}
        ${m ? `<section class="card"><div class="card-head-row"><h2 class="h-caps">Sổ thanh toán</h2>${can("billing.edit") ? '<button class="btn small" type="button" id="cpAdd">+ Ghi nhận tiền</button>' : ""}</div>
          <form id="cpForm" hidden class="o-payform"><div class="of-grid3 tight"><div><label class="field-label" for="cpDay">Ngày nhận tiền</label><input class="input" type="date" id="cpDay" value="${vnToday()}"></div>
            <div><label class="field-label" for="cpAmt">Số tiền (${esc(c.currency)})</label><input class="input" type="number" step="any" id="cpAmt" required></div>
            <div><label class="field-label" for="cpMethod">Hình thức</label><select class="input" id="cpMethod">${Object.entries(D8.PAY_METHOD).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></div></div>
            <div class="of-grid2 tight"><div><label class="field-label" for="cpOrder">Cho đơn</label><input class="input" id="cpOrder" placeholder="Tiền này trả cho mã đơn nào?"></div>
            <div><label class="field-label" for="cpRef">Mã giao dịch / ghi chú</label><input class="input" id="cpRef" maxlength="120" placeholder="Mã giao dịch là gì?"></div></div>
            <div class="wf-actions"><button class="btn btn-primary small" type="submit">Lưu khoản thu</button></div><p class="error" id="cpErr" hidden></p></form>
          ${payRows ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ngày</th><th class="num">Số tiền</th><th>Hình thức</th><th>Đơn</th><th>Ghi chú</th><th></th></tr></thead><tbody>${payRows}</tbody></table></div>` : '<p class="muted" style="margin:0">Chưa có khoản thu nào.</p>'}</section>` : ""}
      </div><aside>
        <section class="card"><h2 class="h-caps" style="margin-bottom:14px">Hồ sơ khách</h2>${can("customers.edit") ? custForm(c) : `<dl class="dl">${[["Mã", c.code], ["Tên", c.name], ["Loại", KINDS[c.kind]], ["Tiền tệ", c.currency], ["Quốc gia", c.country], ["Liên hệ", c.contact], ["Email", c.email], ["Điện thoại", c.phone], ["Thanh toán", c.terms], ["Ghi chú", c.note]].filter((x) => x[1]).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`}</section>
        <section class="card"><h2 class="h-caps">Tài khoản cổng khách</h2>
          ${d.logins.length ? `<ul class="logins">${d.logins.map((l) => `<li><span>${esc(l.email)}</span>${can("customers.edit") ? `<button class="iconbtn del" type="button" data-unlink="${esc(l.email)}" aria-label="Bỏ gắn">${D8.ORDER_ICON.x}</button>` : ""}</li>`).join("")}</ul>` : '<p class="muted" style="margin:0 0 10px">Chưa gắn tài khoản nào.</p>'}
          ${can("customers.edit") ? `<form class="add-row" id="clAdd" style="margin-top:10px"><input class="input" type="email" id="clEmail" placeholder="Email Google của khách là gì?" required><button class="btn small" type="submit">Gắn</button></form>` : ""}
          ${can("customers.edit") && !d.stats.some((s) => s.orders || s.paid || s.credit) ? `<button class="btn small btn-danger" type="button" id="cuDel" style="margin-top:16px">Xóa khách này</button>` : ""}</section>
      </aside></div>`;
    host.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("a")) location.hash = tr.dataset.href; }));
    if ($("cfForm")) wireCustForm(c, () => { D8.toast("Đã lưu hồ sơ."); drawCustomer(id); });
    if ($("cuPrices")) priceTable($("cuPrices"), { customer: c, prods, prices });
    if ($("cuTier")) $("cuTier").addEventListener("change", async () => {
      try { await api(`/api/customers/${c.id}/tier`, { method: "POST", body: { tier: $("cuTier").value } }); D8.toast("Khách " + c.code + " dùng " + TIER[$("cuTier").value] + "."); drawCustomer(id); }
      catch (err) { D8.toast(err.message); }
    });
    if ($("cuPlImp")) $("cuPlImp").addEventListener("click", () => priceListImport($("cuPlBox"), { target: "customer", customer: c, label: "bảng giá riêng của " + c.code, currency: c.currency, onDone: () => drawCustomer(id) }));
    const add = $("cpAdd");
    if (add) add.addEventListener("click", () => { $("cpForm").hidden = !$("cpForm").hidden; if (!$("cpForm").hidden) $("cpAmt").focus(); });
    const pf = $("cpForm");
    if (pf) pf.addEventListener("submit", async (e) => {
      e.preventDefault(); const b = pf.querySelector("[type=submit]"); D8.busy(b, true); $("cpErr").hidden = true;
      try {
        const r = await api("/api/payments", { method: "POST", body: { customer_id: c.id, day: $("cpDay").value, amount: +$("cpAmt").value, method: $("cpMethod").value, ref: $("cpRef").value.trim(), order_code: $("cpOrder").value.trim() } });
        void r; D8.toast("Đã ghi nhận khoản thu."); drawCustomer(id);
      } catch (err) { D8.busy(b, false); $("cpErr").textContent = err.message; $("cpErr").hidden = false; }
    });
    host.querySelectorAll("[data-pdel]").forEach((b) => W.armed(b, async () => { await api("/api/payments/" + b.dataset.pdel, { method: "DELETE" }); D8.toast("Đã xóa khoản thu."); drawCustomer(id); }));
    host.querySelectorAll("[data-unlink]").forEach((b) => W.armed(b, async () => { await api(`/api/customers/${c.id}/logins`, { method: "POST", body: { email: b.dataset.unlink, remove: true } }); drawCustomer(id); }));
    const la = $("clAdd");
    if (la) la.addEventListener("submit", async (e) => { e.preventDefault(); try { await api(`/api/customers/${c.id}/logins`, { method: "POST", body: { email: $("clEmail").value.trim() } }); D8.toast("Đã gắn tài khoản."); drawCustomer(id); } catch (err) { D8.toast(err.message); } });
    const del = $("cuDel");
    if (del) W.armed(del, async () => { await api("/api/customers/" + c.id, { method: "DELETE" }); D8.book.drop(); D8.toast("Đã xóa khách."); location.hash = "#customers"; });
  }

  // Price table for one customer (or the default list when customer is null)
  function priceTable(host, { customer, prods, prices }) {
    const cur = customer ? customer.currency : "USD";
    const own = new Map((prices.own || []).filter((p) => p.currency === cur).map((p) => [p.product, p.price]));
    const def = new Map((prices.defaults || []).filter((p) => p.currency === cur).map((p) => [p.product, p.price]));
    const rowsHtml = prods.filter((p) => p.active || own.has(p.code)).map((p) => `<tr><td><b>${esc(p.code)}</b><small>${esc(p.name)}</small></td><td>${esc(UNIT[p.unit] || p.unit)}</td>
      <td class="num"><input class="input" type="number" min="0" step="any" data-p="${esc(p.code)}" value="${own.has(p.code) ? esc(own.get(p.code)) : ""}" placeholder="${def.has(p.code) ? esc(def.get(p.code)) : "—"}" aria-label="Giá ${esc(p.code)}"></td></tr>`).join("");
    host.innerHTML = prods.length ? `<div class="tbl-wrap scroll-y"><table class="grid-tbl"><thead><tr><th>Mã hàng</th><th>Tính theo</th><th class="num">Giá riêng (${esc(cur)})</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
      <div class="wf-actions"><button class="btn btn-primary small" type="button" data-save>Lưu bảng giá</button></div><p class="error" data-err hidden></p>` : '<p class="muted">Chưa có mã hàng.</p>';
    const save = host.querySelector("[data-save]");
    if (save) save.addEventListener("click", async () => {
      const items = [...host.querySelectorAll("[data-p]")].map((i) => ({ product: i.dataset.p, price: i.value.trim() === "" ? null : +i.value })).filter((x) => x.price !== null || own.has(x.product));
      D8.busy(save, true);
      try { await api("/api/prices", { method: "POST", body: { customer: customer ? customer.id : 0, currency: cur, items } }); D8.done(save, "Đã lưu"); items.forEach((x) => { if (x.price === null) own.delete(x.product); else own.set(x.product, x.price); }); }
      catch (err) { D8.busy(save, false); const e = host.querySelector("[data-err]"); e.textContent = err.message; e.hidden = false; }
    });
  }

  /* ============================================================ product codes, price levels, KTV pay */
  async function drawCatalog() {
    const W = ws(), price = can("pricing.manage");
    W.setBand("Mã hàng & bảng giá", "Giá niêm yết, mức 2, mức 3 và giá công KTV");
    W.show("p-catalog", true);
    const host = $("p-catalog");
    host.innerHTML = D8.skel.card(6);
    let prods, tiers = {};
    try {
      prods = await D8.book.products(true);
      if (price) { const all = await Promise.all(Object.keys(TIER).map((t) => api("/api/prices?tier=" + (t || "max")))); Object.keys(TIER).forEach((t, i) => { tiers[t] = all[i].prices; }); }
    } catch (err) { if (isNoDb(err)) return noDb(host, err); host.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
    let draft = prods.map((p) => ({ ...p }));
    const GROUPS = D8.SERVICES;
    const tierTile = (t) => {
      const list = tiers[t] || [], curs = [...new Set(list.map((x) => x.currency))], at = Math.max(0, ...list.map((x) => x.updated_at || 0));
      return `<div class="pl-tile"><span class="eyebrow">${t ? "Mức " + (t === "mid" ? "2" : "3") : "Niêm yết"}</span><b>${esc(TIER[t])}</b>
        <small>${list.length ? `${list.length} mã có giá · ${esc(curs.join(", "))}${at ? " · " + esc(D8.fmtDate(at)) : ""}` : "Chưa có giá"}</small>
        <div class="band-btns"><button class="btn small" type="button" data-plimp="${t}">Nhập Excel</button>${list.length ? `<button class="btn small" type="button" data-plx="${t}">Xuất Excel</button>` : ""}</div></div>`;
    };
    const draw = () => {
      host.innerHTML = `${price ? `<section class="card"><div class="card-head-row"><h2 class="h-caps">Bảng giá</h2><div class="band-btns"><button class="btn small" type="button" id="pmExport">Xuất giá tất cả khách</button></div></div>
          <div class="pl-tiles">${Object.keys(TIER).map(tierTile).join("")}</div><div id="plBox"></div></section>` : ""}
        <section class="card"><div class="card-head-row"><h2 class="h-caps">Danh mục mã hàng</h2>${draft.length ? '<div class="band-btns"><button class="btn small" type="button" id="pcExport">Xuất Excel</button></div>' : ""}</div>
        ${draft.length ? "" : `<div class="pt-alert info"><div>Chưa có mã hàng.${price ? `<div class="wf-actions"><button class="btn btn-primary small" type="button" id="pcFirst">Nhập bảng giá niêm yết</button></div>` : ""}</div></div>`}
        ${draft.length ? `<div class="tbl-wrap scroll-y"><table class="grid-tbl pc-tbl"><thead><tr><th>Mã hàng</th><th>Tên tiếng Việt</th><th>Tên tiếng Anh</th><th>Nhóm dịch vụ</th><th>Tính theo</th><th>Dùng</th><th></th></tr></thead><tbody>
        ${draft.map((p, i) => `<tr class="${p.active ? "" : "off"}">
          <td>${p.isNew ? `<input class="input" data-i="${i}" data-k="code" value="${esc(p.code)}" maxlength="24" style="text-transform:uppercase;width:110px" placeholder="Mã nào?">` : `<b>${esc(p.code)}</b><button class="linkbtn" type="button" data-rename="${i}">đổi mã</button>`}</td>
          <td><input class="input" data-i="${i}" data-k="name" value="${esc(p.name)}" maxlength="120" placeholder="Tên tiếng Việt?"></td>
          <td><input class="input" data-i="${i}" data-k="name_en" value="${esc(p.name_en || "")}" maxlength="120" placeholder="Tên tiếng Anh?"></td>
          <td><select class="input" data-i="${i}" data-k="grp">${["", ...GROUPS].map((g) => `<option value="${esc(g)}"${g === (p.grp || "") ? " selected" : ""}>${esc(g ? D8.svcLabel(g) : "—")}</option>`).join("")}</select></td>
          <td><select class="input" data-i="${i}" data-k="unit">${Object.entries(UNIT).map(([k, l]) => `<option value="${k}"${k === p.unit ? " selected" : ""}>${l}</option>`).join("")}</select></td>
          <td><input type="checkbox" data-i="${i}" data-k="active"${p.active ? " checked" : ""} aria-label="Đang dùng"></td>
          <td>${p.isNew ? `<button class="iconbtn del" type="button" data-drop="${i}" aria-label="Bỏ dòng">${D8.ORDER_ICON.x}</button>` : `<button class="iconbtn del" type="button" data-del="${i}" aria-label="Xóa mã">${D8.ORDER_ICON.x}</button>`}</td></tr>`).join("")}
        </tbody></table></div>` : ""}
        ${price ? `<div class="wf-actions"><button class="btn small" type="button" id="pcAdd">+ Thêm mã hàng</button>${draft.length ? '<button class="btn btn-primary small" type="button" id="pcSave">Lưu danh mục</button>' : ""}</div><p class="error" id="pcErr" hidden></p>` : ""}</section>
        ${can("techpay.manage") ? `<section class="card" id="trCard"><h2 class="h-caps">Giá công KTV</h2><div id="trBody">${D8.skel.rows(2)}</div></section>` : ""}`;
      host.querySelectorAll("[data-i]").forEach((el) => el.addEventListener(el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input", () => {
        const p = draft[+el.dataset.i]; p[el.dataset.k] = el.type === "checkbox" ? el.checked : el.value;
      }));
      host.querySelectorAll("[data-drop]").forEach((b) => b.addEventListener("click", () => { draft.splice(+b.dataset.drop, 1); draw(); }));
      host.querySelectorAll("[data-del]").forEach((b) => W.armed(b, async () => {
        const p = draft[+b.dataset.del];
        const r = await api("/api/products/" + encodeURIComponent(p.code), { method: "DELETE" });
        D8.toast(r.archived ? "Mã " + p.code + " đã dùng trong đơn: chuyển sang ngưng dùng." : "Đã xóa mã " + p.code + ".");
        D8.book.drop(); drawCatalog();
      }));
      host.querySelectorAll("[data-rename]").forEach((b) => b.addEventListener("click", async () => {
        const p = draft[+b.dataset.rename];
        const to = (prompt("Mã mới cho " + p.code + "?", p.code) || "").trim().toUpperCase();
        if (!to || to === p.code) return;
        try { await api("/api/products/rename", { method: "POST", body: { from: p.code, to } }); D8.toast("Đã đổi " + p.code + " → " + to + "."); D8.book.drop(); drawCatalog(); } catch (err) { D8.toast(err.message); }
      }));
      const add = $("pcAdd");
      if (add) add.addEventListener("click", () => { draft.push({ code: "", name: "", name_en: "", grp: "", unit: "unit", active: true, isNew: true }); draw(); const ins = host.querySelectorAll('[data-k="code"]'); if (ins.length) ins[ins.length - 1].focus(); });
      const save = $("pcSave");
      if (save) save.addEventListener("click", async (e) => {
        const b = e.currentTarget; $("pcErr").hidden = true; D8.busy(b, true);
        try {
          await api("/api/products", { method: "POST", body: { items: draft.map((p, i) => ({ code: p.code, name: p.name, name_en: p.name_en, grp: p.grp, unit: p.unit, active: !!p.active, sort: p.sort || (i + 1) * 10 })) } });
          D8.book.drop(); D8.toast("Đã lưu danh mục."); drawCatalog();
        } catch (err) { D8.busy(b, false); $("pcErr").textContent = err.message; $("pcErr").hidden = false; }
      });
      const pe = $("pcExport");
      if (pe) pe.addEventListener("click", () => D8X.write([productSheet(draft.filter((p) => !p.isNew))], "D8-ma-hang-" + vnToday() + ".xlsx"));
      const pm = $("pmExport");
      if (pm) pm.addEventListener("click", async (e) => { const b = e.currentTarget; D8.busy(b, true); try { await D8X.write([await priceSheet()], "D8-bang-gia-" + vnToday() + ".xlsx"); } catch (err) { D8.toast(err.message); } D8.busy(b, false); });
      const imp = (t) => priceListImport($("plBox"), { target: t ? t : "list", label: TIER[t].toLowerCase(), onDone: () => { D8.book.drop(); drawCatalog(); } });
      host.querySelectorAll("[data-plimp]").forEach((b) => b.addEventListener("click", () => imp(b.dataset.plimp)));
      if ($("pcFirst")) $("pcFirst").addEventListener("click", () => imp(""));
      host.querySelectorAll("[data-plx]").forEach((b) => b.addEventListener("click", () => D8X.write([tierSheet(b.dataset.plx, prods, tiers[b.dataset.plx])], "D8-" + (b.dataset.plx || "niem-yet") + "-" + vnToday() + ".xlsx")));
      if ($("trBody")) techRates($("trBody"), draft.filter((p) => !p.isNew));
    };
    draw();
  }
  const productSheet = (list) => ({ name: "Mã hàng", cols: [{ h: "Mã hàng", w: 12 }, { h: "Tên tiếng Việt", w: 34 }, { h: "Tên tiếng Anh", w: 34 }, { h: "Nhóm dịch vụ", w: 22 },
    { h: "Tính theo", w: 14 }, { h: "Đang dùng", w: 10 }, { h: "Ghi chú", w: 24 }],
    rows: list.map((p) => [p.code, p.name, p.name_en, p.grp, UNIT[p.unit] || p.unit, p.active ? "Có" : "Không", p.note || ""]) });
  // one price level in the owner's layout (No. · SERVICE · DESCRIPTION · UNIT · UNIT PRICE), with the code added so it imports back exactly
  function tierSheet(t, prods, list) {
    const cur = (list[0] || {}).currency || "USD", P = new Map(list.filter((x) => x.currency === cur).map((x) => [x.product, x.price]));
    return { name: "PRICE LIST", cols: [{ h: "No.", t: "i", w: 6 }, { h: "Code", w: 10 }, { h: "SERVICE", w: 40 }, { h: "DESCRIPTION", w: 44 }, { h: "UNIT", w: 10 }, { h: "UNIT PRICE (" + cur + ")", t: cur === "VND" ? "vnd" : "usd", w: 16 }],
      rows: prods.filter((p) => p.active).map((p, i) => [i + 1, p.code, p.name_en || p.name, p.name, { unit: "Tooth", arch: "Jaw", bridge: "Bridge", set: "Set", case: "Case", hour: "Hour" }[p.unit] || p.unit, P.has(p.code) ? P.get(p.code) : ""]) };
  }
  async function priceSheet() {
    const [prods, custs, all] = await Promise.all([D8.book.products(true), D8.book.customers(true), api("/api/prices?all=1")]);
    const P = new Map(all.prices.map((p) => [p.customer_id + "|" + p.product + "|" + p.currency, p.price]));
    const cs = custs.filter((c) => c.active);
    return { name: "Bảng giá", cols: [{ h: "Mã hàng", w: 12 }, { h: "Tên hàng", w: 30 }, { h: "Niêm yết (USD)", t: "usd", w: 13 }, { h: "Mức 2 (USD)", t: "usd", w: 12 }, { h: "Mức 3 (USD)", t: "usd", w: 12 },
      ...cs.map((c) => ({ h: c.code + " (" + c.currency + ")", t: c.currency === "VND" ? "vnd" : "usd", w: 13 }))],
      rows: prods.map((p) => [p.code, p.name, P.get("0|" + p.code + "|USD") ?? "", P.get("-2|" + p.code + "|USD") ?? "", P.get("-3|" + p.code + "|USD") ?? "", ...cs.map((c) => P.get(c.id + "|" + p.code + "|" + c.currency) ?? "")]) };
  }

  /* ---- a price list file in the owner's layout → one list (list price, level 2, level 3, a customer's own, a KTV's pay) */
  function parsePriceList(sheets) {
    const pick = (head, re, not) => head.findIndex((x) => { const f = fold(x); return f && re.test(f) && !(not && not.test(f)); });
    for (const sh of sheets) {
      for (let h = 0; h < Math.min(25, sh.rows.length); h++) {
        const head = sh.rows[h] || [];
        const iSvc = pick(head, /^(service|services|dich vu|ten dich vu|ten tieng anh)$/), iPrice = pick(head, /price|gia|rate|cong/, /^(no|stt)$/);
        if (iSvc < 0 || iPrice < 0) continue;
        const iNo = pick(head, /^(no\.?|stt|so)$/), iDesc = pick(head, /^(description|mo ta|ten tieng viet)$/), iUnit = pick(head, /^(unit|don vi|tinh theo)$/, /price|gia/), iCode = pick(head, /^(code|ma|ma hang)$/);
        const ph = String(head[iPrice] || ""), currency = /vnd|đ\b|dong/i.test(ph) ? "VND" : /usd|\$/i.test(ph) ? "USD" : "";
        const items = [];
        let group = "";
        sh.rows.slice(h + 1).forEach((r, k) => {
          const cell = (i) => (i < 0 || r[i] === undefined || r[i] === null ? "" : r[i]);
          const svc = String(cell(iSvc)).trim(), desc = String(cell(iDesc)).trim(), first = String(cell(iNo >= 0 ? iNo : 0)).trim();
          const filled = r.filter((x) => x !== null && x !== undefined && String(x).trim() !== "").length;
          if (!svc && !desc) { if (filled === 1 && first && isNaN(+first)) group = first; return; }
          const pv = cell(iPrice), price = typeof pv === "number" ? pv : /^[\d.,\s]+$/.test(String(pv).trim()) && String(pv).trim() ? +String(pv).replace(/[,\s]/g, "") : null;
          items.push({ row: h + k + 2, no: iNo >= 0 && !isNaN(+first) ? +first : 0, code: iCode >= 0 ? String(cell(iCode)).trim() : "", group, service: svc, desc, unit: String(cell(iUnit)).trim(), price, raw: pv });
        });
        if (items.length) return { items, currency, sheet: sh.name };
      }
    }
    throw new Error("Không thấy cột SERVICE và UNIT PRICE trong file.");
  }
  function priceListImport(box, { target, label, customer, email, currency, onDone }) {
    const first = vnToday().slice(0, 8) + "01";
    box.innerHTML = `<div class="pl-imp"><div class="card-head-row"><h3 class="h-caps">Nhập ${esc(label)}</h3><button class="iconbtn" type="button" data-close aria-label="Đóng">${D8.ORDER_ICON.x}</button></div>
      <label class="drop compact"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg><strong>Chọn file bảng giá (.xlsx)</strong><input type="file" data-file accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
      <div class="of-grid2 tight">${target === "tech" ? `<div><label class="field-label">Tính lại công cho đơn nhận từ ngày</label><input class="input" type="date" data-from value="${first}"></div>` : ""}
        ${target === "list" ? `<label class="check" style="align-self:end"><input type="checkbox" data-retire> Ngưng dùng mã không có trong file</label>` : ""}</div>
      <p class="error" data-err hidden></p><div data-prev></div></div>`;
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const q = (sel) => box.querySelector(sel), err = (m) => { q("[data-err]").textContent = m; q("[data-err]").hidden = !m; };
    q("[data-close]").addEventListener("click", () => { box.innerHTML = ""; });
    let parsed = null;
    const body = (dry) => ({ target, dry, items: parsed.items, currency: parsed.currency || currency || (target === "tech" ? "VND" : "USD"),
      ...(customer ? { customer_id: customer.id } : {}), ...(target === "tech" ? { email, from: q("[data-from]").value } : {}), ...(target === "list" ? { retire: q("[data-retire]").checked } : {}) });
    q("[data-file]").addEventListener("change", async (e) => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      err(""); q("[data-prev]").innerHTML = D8.skel.rows(3);
      try {
        parsed = parsePriceList(await D8X.read(f));
        if (customer && parsed.currency && parsed.currency !== customer.currency) throw new Error("File tính bằng " + parsed.currency + ", khách " + customer.code + " dùng " + customer.currency + ".");
        const d = await api("/api/pricelist", { method: "POST", body: body(true) });
        const cur = d.currency;
        q("[data-prev]").innerHTML = `<div class="chips-row pl-sum"><span class="chip">${esc(f.name)}</span><span class="chip">${d.rows} dịch vụ</span><span class="chip">${d.priced} có giá (${esc(cur)})</span>${d.created ? `<span class="chip warn">${d.created} mã mới</span>` : ""}${d.noPrice ? `<span class="chip">${d.noPrice} báo giá theo ca</span>` : ""}</div>
          <div class="tbl-wrap pl-prev"><table class="tbl"><thead><tr><th>No.</th><th>Mã hàng</th><th>Dịch vụ</th><th>Tính theo</th><th class="num">${target === "tech" ? "Giá công" : "Giá"} (${esc(cur)})</th></tr></thead><tbody>
          ${d.items.map((x) => `<tr><td>${x.no || ""}</td><td><b>${esc(x.code)}</b>${x.isNew ? ' <span class="okind okind-portal">mới</span>' : ""}</td><td>${esc(x.name_en || x.name)}<small>${esc(x.name_en ? x.name : "")}</small></td><td>${esc(UNIT[x.unit] || x.unit)}</td><td class="num">${x.price === null ? '<span class="muted">—</span>' : esc(money(x.price, cur))}</td></tr>`).join("")}</tbody></table></div>
          ${d.errors.length ? `<div class="pt-alert warn"><div>${d.errors.map(esc).join("<br>")}</div></div>` : ""}
          <div class="wf-actions"><button class="btn btn-primary small" type="button" data-go>Nhập ${d.rows} dòng</button></div>`;
        const go = q("[data-go]");
        go.addEventListener("click", async () => {
          D8.busy(go, true);
          try { const r = await api("/api/pricelist", { method: "POST", body: body(false) }); D8.toast("Đã nhập " + label + ": " + r.priced + " mã có giá" + (r.created ? ", " + r.created + " mã mới" : "") + "."); box.innerHTML = ""; if (onDone) onDone(r); }
          catch (e2) { D8.busy(go, false); err(e2.message); }
        });
      } catch (e2) { q("[data-prev]").innerHTML = ""; err(e2.message); }
    });
  }
  async function techRates(host, prods) {
    let data;
    try { data = await api("/api/techrates"); } catch (err) { host.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
    const team = ws().team().filter((t) => t.design);
    let who = "*";
    const draw = () => {
      const mine = data.rates.filter((r) => r.email === who), def = data.rates.filter((r) => r.email === "*");
      const cur = (mine[0] || def[0] || {}).currency || "VND";
      host.innerHTML = `<div class="of-grid3 tight"><div><label class="field-label" for="trWho">KTV</label><select class="input" id="trWho"><option value="*">Mọi KTV (giá chung)</option>${team.map((t) => `<option value="${esc(t.email)}"${t.email === who ? " selected" : ""}>${esc(t.name || t.email)}</option>`).join("")}</select></div>
          <div><label class="field-label" for="trCur">Tiền tệ</label><select class="input" id="trCur">${["VND", "USD"].map((c) => `<option${c === cur ? " selected" : ""}>${c}</option>`).join("")}</select></div>
          <div><label class="field-label" for="trFrom">Tính lại công cho đơn nhận từ ngày</label><input class="input" type="date" id="trFrom" value="${vnToday().slice(0, 8)}01"></div></div>
        <div class="tbl-wrap scroll-y"><table class="grid-tbl"><thead><tr><th>Mã hàng</th><th>Tính theo</th><th class="num">Giá công</th></tr></thead><tbody>
        ${prods.filter((p) => p.active).map((p) => { const r = mine.find((x) => x.product === p.code), d0 = def.find((x) => x.product === p.code);
          return `<tr><td><b>${esc(p.code)}</b><small>${esc(p.name)}</small></td><td>${esc(UNIT[p.unit] || p.unit)}</td><td class="num"><input class="input" type="number" min="0" step="any" data-tr="${esc(p.code)}" value="${r ? esc(r.rate) : ""}" placeholder="${who !== "*" && d0 ? esc(d0.rate) : "—"}"></td></tr>`; }).join("")}</tbody></table></div>
        <div class="wf-actions"><button class="btn btn-primary small" type="button" id="trSave">Lưu giá công</button><button class="btn small" type="button" id="trImp">Nhập file giá công (Excel)</button></div><div id="trBox"></div>`;
      $("trWho").addEventListener("change", () => { who = $("trWho").value; draw(); });
      $("trImp").addEventListener("click", () => priceListImport($("trBox"), { target: "tech", email: who, label: "giá công " + (who === "*" ? "chung cho mọi KTV" : ws().teamName(who)), currency: $("trCur").value,
        onDone: async () => { data = await api("/api/techrates"); draw(); } }));
      $("trSave").addEventListener("click", async (e) => {
        const b = e.currentTarget; D8.busy(b, true);
        const items = [...host.querySelectorAll("[data-tr]")].map((i) => ({ product: i.dataset.tr, rate: i.value.trim() === "" ? null : +i.value }));
        try { await api("/api/techrates", { method: "POST", body: { email: who, currency: $("trCur").value, from: $("trFrom").value, items } }); data = await api("/api/techrates"); D8.toast("Đã lưu tiền công. Công các đơn từ " + fmtDay($("trFrom").value) + " đã tính lại."); draw(); }
        catch (err) { D8.busy(b, false); D8.toast(err.message); }
      });
    };
    draw();
  }

  /* ============================================================ reports and charts */
  const R = { period: "month", preset: "12m", from: "", to: "", cur: "USD", basis: "received" };
  const RPRESET = [["12w", "12 tuần qua"], ["6m", "6 tháng qua"], ["12m", "12 tháng qua"], ["ytd", "Năm nay"], ["ly", "Năm trước"], ["3y", "3 năm qua"], ["custom", "Chọn ngày…"]];
  function rRange(p) {
    const t = vnToday();
    if (p === "12w") return [addDays(t, -83), t];
    if (p === "6m") return [new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 6, 1)).toISOString().slice(0, 10), t];
    if (p === "12m") return [new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 12, 1)).toISOString().slice(0, 10), t];
    if (p === "ytd") return [t.slice(0, 4) + "-01-01", t];
    if (p === "ly") { const y = +t.slice(0, 4) - 1; return [y + "-01-01", y + "-12-31"]; }
    if (p === "3y") return [(+t.slice(0, 4) - 2) + "-01-01", t];
    return [R.from || addDays(t, -30), R.to || t];
  }
  // period key and label for a day
  const weekStart = (d) => { const dt = new Date(d + "T00:00:00Z"); const wd = (dt.getUTCDay() + 6) % 7; return addDays(d, -wd); };
  const periodOf = (d, p) => (p === "year" ? d.slice(0, 4) : p === "month" ? d.slice(0, 7) : weekStart(d));
  const periodLabel = (k, p) => (p === "year" ? k : p === "month" ? "T" + +k.slice(5, 7) + "/" + k.slice(2, 4) : k.slice(8, 10) + "/" + k.slice(5, 7));
  const periodLong = (k, p) => (p === "year" ? "Năm " + k : p === "month" ? "Tháng " + +k.slice(5, 7) + "/" + k.slice(0, 4) : "Tuần " + fmtDay(k) + " – " + fmtDay(addDays(k, 6)));
  function periodsBetween(from, to, p) {
    const out = [];
    let k = periodOf(from, p);
    for (let i = 0; i < 400; i++) {
      if (k > periodOf(to, p)) break;
      out.push(k);
      k = p === "year" ? String(+k + 1) : p === "month" ? new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 1)).toISOString().slice(0, 7) : addDays(k, 7);
    }
    return out;
  }
  function bucket(rep, p) {
    const keys = periodsBetween(rep.from, rep.to, p);
    const map = new Map(keys.map((k) => [k, { k, n: 0, u: 0, r: 0, c: 0, t: 0, p: 0, k2: 0, cash: 0 }]));
    for (const x of rep.days) {
      const b = map.get(periodOf(x.d, p)); if (!b) continue;
      b.n += x.n; b.u += x.u || 0; b.r += x.r || 0; b.c += x.c || 0;
      if (x.cur === R.cur) { b.t += x.t || 0; b.p += x.p || 0; }
      if (x.k) b.k2 += x.k;
    }
    for (const x of rep.payments || []) { const b = map.get(periodOf(x.d, p)); if (b && x.cur === R.cur) b.cash += x.a; }
    return keys.map((k) => map.get(k));
  }
  const compact = (v) => { const a = Math.abs(v); return a >= 1e9 ? (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B" : a >= 1e6 ? (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M" : a >= 1e3 ? (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "K" : String(Math.round(v * 100) / 100); };
  function niceMax(v) { if (v <= 0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; }
  // Column chart (one series, or two stacked). Hover/focus a column for its values.
  function columnChart(host, { labels, longLabels, series, fmt, title, int }) {
    // drawn at the width it is shown, so the axis text stays readable on a phone
    const W = Math.max(300, Math.min(1100, Math.round(host.clientWidth || 760))), H = W < 520 ? 220 : 260, padL = 48, padR = 8, padT = 14, padB = 34;
    const n = labels.length, band = (W - padL - padR) / Math.max(1, n), bw = Math.min(24, Math.max(4, band * 0.62));
    const totals = labels.map((_, i) => series.reduce((t, s) => t + Math.max(0, s.values[i] || 0), 0));
    // counts (int): whole-number ticks, at least 0–4
    const max = int ? Math.max(4, Math.ceil(niceMax(Math.max(...totals, 0)) / 4) * 4) : niceMax(Math.max(...totals, 0));
    const y = (v) => padT + (H - padT - padB) * (1 - v / max);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
    const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor((W - padL) / 58))));
    let marks = "";
    labels.forEach((_, i) => {
      const x = padL + band * i + (band - bw) / 2;
      let base = 0;
      series.forEach((s, si) => {
        const v = Math.max(0, s.values[i] || 0); if (!v) return;
        const top = y(base + v), bot = y(base), h = Math.max(1, bot - top - (base > 0 ? 2 : 0));
        const isTop = series.slice(si + 1).every((s2) => !(s2.values[i] > 0));
        const r = isTop ? Math.min(4, h / 2, bw / 2) : 0;
        const yy = base > 0 ? top : top;
        marks += r ? `<path d="M${x},${yy + h} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${yy + h} Z" fill="var(${s.color})"/>`
          : `<rect x="${x}" y="${yy}" width="${bw}" height="${h}" fill="var(${s.color})"/>`;
        base += v;
      });
    });
    const hits = labels.map((_, i) => `<rect class="hit" data-i="${i}" x="${padL + band * i}" y="${padT}" width="${band}" height="${H - padT - padB}" fill="transparent" tabindex="0" role="img" aria-label="${esc(longLabels[i] + ": " + series.map((s) => s.name + " " + fmt(s.values[i] || 0)).join(", "))}"/>`).join("");
    host.innerHTML = `<div class="chart"><div class="chart-legend">${series.length > 1 ? series.map((s) => `<span><i style="background:var(${s.color})"></i>${esc(s.name)}</span>`).join("") : ""}</div>
      <svg viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(title)}" preserveAspectRatio="xMidYMid meet">
        ${ticks.map((t) => `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" class="grid${t === 0 ? " base" : ""}"/><text x="${padL - 8}" y="${y(t) + 4}" class="tick" text-anchor="end">${esc(compact(t))}</text>`).join("")}
        ${marks}
        ${labels.map((l, i) => (i % every === 0 ? `<text x="${padL + band * i + band / 2}" y="${H - padB + 18}" class="tick" text-anchor="middle">${esc(l)}</text>` : "")).join("")}
        ${hits}</svg><div class="chart-tip" hidden></div></div>`;
    const tip = host.querySelector(".chart-tip"), svg = host.querySelector("svg");
    const showTip = (el) => {
      const i = +el.dataset.i, r = el.getBoundingClientRect(), hr = host.querySelector(".chart").getBoundingClientRect();
      tip.innerHTML = "";
      const h = document.createElement("b"); h.textContent = longLabels[i]; tip.appendChild(h);
      for (const s of [...series].reverse()) { const row = document.createElement("div"); const k = document.createElement("i"); k.style.background = `var(${s.color})`; const v = document.createElement("strong"); v.textContent = fmt(s.values[i] || 0); const nm = document.createElement("span"); nm.textContent = s.name; row.append(k, v, nm); tip.appendChild(row); }
      if (series.length > 1) { const row = document.createElement("div"); row.className = "sum"; const v = document.createElement("strong"); v.textContent = fmt(totals[i]); const nm = document.createElement("span"); nm.textContent = "Tổng"; row.append(v, nm); tip.appendChild(row); }
      tip.hidden = false;
      const x = r.left - hr.left + r.width / 2, w = tip.offsetWidth;
      tip.style.left = Math.max(4, Math.min(hr.width - w - 4, x - w / 2)) + "px";
      tip.style.top = "8px";
      svg.querySelectorAll(".hit").forEach((h2) => h2.classList.toggle("on", h2 === el));
    };
    svg.querySelectorAll(".hit").forEach((el) => { el.addEventListener("pointerenter", () => showTip(el)); el.addEventListener("focus", () => showTip(el)); });
    svg.addEventListener("pointerleave", () => { tip.hidden = true; svg.querySelectorAll(".hit.on").forEach((h2) => h2.classList.remove("on")); });
  }
  D8.columnChart = columnChart;
  let rep = null, repKey = "";
  async function drawReports() {
    const W = ws();
    W.setBand("Báo cáo", "Số ca, doanh thu, đã thu, còn nợ theo tuần / tháng / năm", { right: can("export.csv") ? '<div class="band-btns"><button class="btn btn-cream small" type="button" id="rpExport">Xuất Excel</button></div>' : "" });
    W.show("p-reports", true);
    const host = $("p-reports");
    if (!host.dataset.built) {
      host.dataset.built = "1";
      host.innerHTML = `<div class="o-tools rp-tools">
          <div class="seg seg-sm" role="radiogroup" aria-label="Kỳ">${[["week", "Tuần"], ["month", "Tháng"], ["year", "Năm"]].map(([k, l]) => `<label><input type="radio" name="rpPer" value="${k}"${k === R.period ? " checked" : ""}><span>${l}</span></label>`).join("")}</div>
          <select class="input" id="rpPreset" aria-label="Khoảng thời gian">${RPRESET.map(([k, l]) => `<option value="${k}"${k === R.preset ? " selected" : ""}>${l}</option>`).join("")}</select>
          <span class="o-range" id="rpRange" hidden><input class="input" type="date" id="rpFrom" aria-label="Từ ngày"><span>–</span><input class="input" type="date" id="rpTo" aria-label="Đến ngày"></span>
          ${can("billing.view") ? `<select class="input" id="rpCur" aria-label="Tiền tệ"><option>USD</option><option>VND</option></select>` : ""}
          <select class="input" id="rpBasis" aria-label="Theo ngày"><option value="received">Theo ngày nhận</option><option value="delivered">Theo ngày giao</option></select></div>
        <div id="rpBody">${D8.skel.card(4)}</div>`;
      host.querySelectorAll('input[name="rpPer"]').forEach((r) => r.addEventListener("change", () => { R.period = r.value; if (R.period === "year" && ["12w", "6m"].includes(R.preset)) { R.preset = "3y"; $("rpPreset").value = "3y"; } if (R.period === "week" && ["3y", "ly"].includes(R.preset)) { R.preset = "12w"; $("rpPreset").value = "12w"; } renderReport(); }));
      $("rpPreset").addEventListener("change", () => { R.preset = $("rpPreset").value; $("rpRange").hidden = R.preset !== "custom"; if (R.preset === "custom") { const [f, t] = rRange("12m"); $("rpFrom").value = R.from || f; $("rpTo").value = R.to || t; R.from = $("rpFrom").value; R.to = $("rpTo").value; } loadReport(); });
      for (const id of ["rpFrom", "rpTo"]) $(id).addEventListener("change", () => { R.from = $("rpFrom").value; R.to = $("rpTo").value; loadReport(); });
      if ($("rpCur")) $("rpCur").addEventListener("change", () => { R.cur = $("rpCur").value; renderReport(); });
      $("rpBasis").addEventListener("change", () => { R.basis = $("rpBasis").value; loadReport(); });
    }
    const ex = $("rpExport");
    if (ex) ex.addEventListener("click", async () => { D8.busy(ex, true); try { const [from, to] = rRange(R.preset); await D8.exportBook({ from, to, period: R.period, title: "Bao-cao" }); } catch (err) { D8.toast(err.message); } D8.busy(ex, false); });
    W.show("p-reports");
    loadReport();
  }
  async function loadReport() {
    const [from, to] = rRange(R.preset);
    const key = from + to + R.basis;
    const body = $("rpBody");
    if (rep && repKey === key) return renderReport();
    if (rep) body.classList.add("is-stale");
    try {
      rep = await api(`/api/reports?from=${from}&to=${to}&basis=${R.basis}`); repKey = key;
      const curs = [...new Set(rep.days.map((x) => x.cur))];
      if ($("rpCur") && curs.length && !curs.includes(R.cur)) { R.cur = curs[0]; $("rpCur").value = R.cur; }
      renderReport();
    } catch (err) { if (isNoDb(err)) noDb(body, err); else body.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    body.classList.remove("is-stale");
  }
  function renderReport() {
    if (!rep) return;
    const body = $("rpBody"), P = R.period, m = rep.money, cur = R.cur, f = (v) => money(v, cur);
    const b = bucket(rep, P);
    const tot = b.reduce((a, x) => ({ n: a.n + x.n, u: a.u + x.u, r: a.r + x.r, c: a.c + x.c, t: a.t + x.t, p: a.p + x.p, k: a.k + x.k2, cash: a.cash + x.cash }), { n: 0, u: 0, r: 0, c: 0, t: 0, p: 0, k: 0, cash: 0 });
    const team = (e) => (e ? ws().teamName(e) : "Chưa giao KTV");
    const custRows = rep.customers.filter((x) => !m || x.cur === cur || true);
    body.innerHTML = `<div class="kpis kpis-lg">
        <div class="kpi"><span>Số ca</span><b>${tot.n.toLocaleString("vi-VN")}</b><small>${tot.r ? tot.r + " làm lại · " : ""}${tot.c ? tot.c + " làm tiếp" : ""}</small></div>
        <div class="kpi"><span>Số đơn vị</span><b>${(Math.round(tot.u * 100) / 100).toLocaleString("vi-VN")}</b></div>
        ${m ? `<div class="kpi"><span>Doanh thu (${esc(cur)})</span><b>${esc(f(tot.t))}</b></div><div class="kpi"><span>Đã thu</span><b>${esc(f(tot.p))}</b></div>
          <div class="kpi ${tot.t - tot.p > 0.004 ? "due" : ""}"><span>Còn nợ</span><b>${esc(f(tot.t - tot.p))}</b><small>của các ca trong kỳ</small></div>
          <div class="kpi"><span>Tiền thực nhận</span><b>${esc(f(tot.cash))}</b><small>khách trả trong kỳ</small></div>` : ""}
        ${rep.tech ? `<div class="kpi"><span>Công KTV</span><b>${esc(money(tot.k, "VND"))}</b></div>` : ""}</div>
      ${m ? `<section class="card"><div class="card-head-row"><h2 class="h-caps">Doanh thu: đã thu và còn nợ (${esc(cur)})</h2></div><div id="rpMoney"></div></section>` : ""}
      <section class="card"><div class="card-head-row"><h2 class="h-caps">Số ca theo ${P === "week" ? "tuần" : P === "month" ? "tháng" : "năm"}</h2></div><div id="rpCases"></div></section>
      <section class="card"><h2 class="h-caps">Theo ${P === "week" ? "tuần" : P === "month" ? "tháng" : "năm"}</h2><div class="tbl-wrap"><table class="tbl rp-tbl"><thead><tr><th>Kỳ</th><th class="num">Số ca</th><th class="num">Đơn vị</th><th class="num">Làm lại</th>${m ? '<th class="num">Doanh thu</th><th class="num">Đã thu</th><th class="num">Còn nợ</th><th class="num">Thực nhận</th>' : ""}${rep.tech ? '<th class="num">Công KTV</th>' : ""}</tr></thead>
        <tbody>${[...b].reverse().map((x) => `<tr><td>${esc(periodLong(x.k, P))}</td><td class="num">${x.n}</td><td class="num">${Math.round(x.u * 100) / 100}</td><td class="num">${x.r || 0}</td>${m ? `<td class="num">${esc(f(x.t))}</td><td class="num">${esc(f(x.p))}</td><td class="num ${x.t - x.p > 0.004 ? "due" : ""}">${esc(f(x.t - x.p))}</td><td class="num">${esc(f(x.cash))}</td>` : ""}${rep.tech ? `<td class="num">${esc(money(x.k2, "VND"))}</td>` : ""}</tr>`).join("")}</tbody></table></div></section>
      <div class="rp-two">
        <section class="card"><h2 class="h-caps">Theo khách hàng</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Khách</th><th class="num">Số ca</th><th class="num">Đơn vị</th>${m ? '<th class="num">Doanh thu</th><th class="num">Còn nợ</th>' : ""}</tr></thead>
          <tbody>${custRows.map((x) => `<tr><td><a href="#cust/${x.id}"><b>${esc(x.code)}</b></a> <span class="muted">${esc(x.name)}</span></td><td class="num">${x.n}</td><td class="num">${Math.round((x.u || 0) * 100) / 100}</td>${m ? `<td class="num">${esc(money(x.t, x.cur))}</td><td class="num ${x.t - x.p > 0.004 ? "due" : ""}">${esc(money(x.t - x.p, x.cur))}</td>` : ""}</tr>`).join("") || '<tr><td colspan="5" class="muted">Không có ca trong kỳ.</td></tr>'}</tbody></table></div></section>
        <section class="card"><h2 class="h-caps">Theo KTV</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>KTV</th><th class="num">Số ca</th><th class="num">Đơn vị</th><th class="num">QC trả về</th><th class="num">Làm lại</th>${rep.tech ? '<th class="num">Công</th>' : ""}</tr></thead>
          <tbody>${rep.designers.map((x) => `<tr><td>${x.email && D8.canTeam && D8.canTeam() ? `<a href="#team/${encodeURIComponent(x.email)}">${esc(team(x.email))}</a>` : esc(team(x.email))}</td><td class="num">${x.n}</td><td class="num">${Math.round((x.u || 0) * 100) / 100}</td><td class="num">${x.f || 0}</td><td class="num">${x.r || 0}</td>${rep.tech ? `<td class="num">${esc(money(x.k || 0, x.kc || "VND"))}</td>` : ""}</tr>`).join("") || '<tr><td colspan="6" class="muted">Không có ca trong kỳ.</td></tr>'}</tbody></table></div></section>
      </div>
      <section class="card"><h2 class="h-caps">Theo mã hàng</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mã hàng</th><th class="num">Số lượng</th><th class="num">Số ca</th>${m ? '<th class="num">Thành tiền</th>' : ""}</tr></thead>
        <tbody>${rep.products.filter((x) => !m || x.cur === cur).map((x) => `<tr><td><b>${esc(x.code)}</b> <span class="muted">${esc(x.name)}</span></td><td class="num">${Math.round(x.q * 100) / 100}</td><td class="num">${x.n}</td>${m ? `<td class="num">${esc(money(x.a, x.cur))}</td>` : ""}</tr>`).join("") || '<tr><td colspan="4" class="muted">Không có dữ liệu.</td></tr>'}</tbody></table></div></section>
      ${m ? `<div class="rp-two"><section class="card"><h2 class="h-caps">Công nợ hiện tại</h2><p class="sub">Tất cả đơn còn nợ, không theo kỳ.</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Khách</th><th class="num">Số đơn</th><th>Từ ngày</th><th class="num">Còn nợ</th></tr></thead>
          <tbody>${rep.debt.map((x) => `<tr><td><a href="#cust/${x.id}"><b>${esc(x.code)}</b></a> <span class="muted">${esc(x.name)}</span></td><td class="num"><a href="#orders?customer=${x.id}&pay=due&status=">${x.n}</a></td><td>${esc(fmtDay(x.oldest))}</td><td class="num due">${esc(money(x.due, x.cur))}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">Không khách nào còn nợ.</td></tr>'}</tbody></table></div></section>
        <section class="card"><h2 class="h-caps">Tiền ứng trước còn lại</h2><p class="sub">Khách đã trả trước, chưa trừ hết vào đơn.</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Khách</th><th class="num">Còn lại</th></tr></thead>
          <tbody>${rep.credit.map((x) => `<tr><td><a href="#cust/${x.id}"><b>${esc(x.code)}</b></a> <span class="muted">${esc(x.name)}</span></td><td class="num">${esc(money(x.credit, x.cur))}</td></tr>`).join("") || '<tr><td colspan="2" class="muted">Không có.</td></tr>'}</tbody></table></div></section></div>` : ""}`;
    const labels = b.map((x) => periodLabel(x.k, P)), longs = b.map((x) => periodLong(x.k, P));
    if ($("rpMoney")) columnChart($("rpMoney"), { title: "Doanh thu theo kỳ", labels, longLabels: longs, fmt: f,
      series: [{ name: "Đã thu", color: "--viz-1", values: b.map((x) => x.p) }, { name: "Còn nợ", color: "--viz-2", values: b.map((x) => Math.max(0, x.t - x.p)) }] });
    columnChart($("rpCases"), { title: "Số ca theo kỳ", int: true, labels, longLabels: longs, fmt: (v) => v + " ca", series: [{ name: "Số ca", color: "--viz-1", values: b.map((x) => x.n) }] });
  }

  /* ============================================================ export to Excel */
  D8.exportBook = async function ({ from, to, period, title }) {
    const per = period || "month";
    const m = can("billing.view");
    const pages = [];
    let off = 0;
    for (let i = 0; i < 30; i++) { const d = await api(`/api/export?from=${from}&to=${to}&offset=${off}`); pages.push(d); if (!d.more) break; off = d.next; }
    const orders = pages.flatMap((d) => d.orders), items = pages.flatMap((d) => d.items), payments = pages[0].payments || [];
    const repD = can("reports.view") ? await api(`/api/reports?from=${from}&to=${to}`) : null;
    const team = (e) => (e ? ws().teamName(e) : "");
    const byOrder = new Map(); items.forEach((x) => { if (!byOrder.has(x.order_id)) byOrder.set(x.order_id, []); byOrder.get(x.order_id).push(x); });
    const sheets = [];
    if (repD) {
      const curs = [...new Set(repD.days.map((x) => x.cur))].sort();
      const keys = periodsBetween(from, to, per);
      const rowsS = keys.map((k) => {
        const days = repD.days.filter((x) => periodOf(x.d, per) === k);
        const base = [periodLong(k, per), days.reduce((t, x) => t + x.n, 0), Math.round(days.reduce((t, x) => t + (x.u || 0), 0) * 100) / 100, days.reduce((t, x) => t + (x.r || 0), 0)];
        if (!m) return base;
        for (const c of curs) { const dd = days.filter((x) => x.cur === c), t = dd.reduce((s, x) => s + (x.t || 0), 0), p = dd.reduce((s, x) => s + (x.p || 0), 0); base.push(t, p, Math.round((t - p) * 100) / 100); }
        return base;
      });
      sheets.push({ name: "Tổng hợp " + (per === "week" ? "tuần" : per === "month" ? "tháng" : "năm"), cols: [{ h: "Kỳ", w: 26 }, { h: "Số ca", t: "i", w: 9 }, { h: "Đơn vị", t: "n", w: 9 }, { h: "Làm lại", t: "i", w: 9 },
        ...(m ? curs.flatMap((c) => { const t = c === "VND" ? "vnd" : "usd"; return [{ h: "Doanh thu " + c, t, w: 15 }, { h: "Đã thu " + c, t, w: 15 }, { h: "Còn nợ " + c, t, w: 15 }]; }) : [])],
        rows: rowsS, sum: [1, 2, 3, ...(m ? curs.flatMap((_, i) => [4 + i * 3, 5 + i * 3, 6 + i * 3]) : [])] });
    }
    sheets.push({ name: "Đơn hàng", cols: [{ h: "Mã đơn", w: 14 }, { h: "Ngày nhận", t: "d", w: 12 }, { h: "Mã khách", w: 10 }, { h: "Khách hàng", w: 24 }, { h: "Nha khoa", w: 20 }, { h: "Bác sĩ", w: 16 },
      { h: "Bệnh nhân", w: 20 }, { h: "Mã của khách", w: 14 }, { h: "Loại", w: 10 }, { h: "Hạng mục", w: 24 }, { h: "Đơn vị", t: "n", w: 8 }, { h: "Trạng thái", w: 16 }, { h: "KTV", w: 14 }, { h: "QC", w: 14 },
      { h: "Ngày giao", t: "d", w: 12 }, ...(m ? [{ h: "Tiền tệ", w: 8 }, { h: "Tạm tính", t: "n", w: 12 }, { h: "Phụ phí %", t: "n", w: 9 }, { h: "Thành tiền", t: "n", w: 12 }, { h: "Đã thu", t: "n", w: 12 }, { h: "Còn nợ", t: "n", w: 12 }, { h: "Tính phí", w: 12 }] : []),
      ...(orders.some((o) => "tech_cost" in o) ? [{ h: "Công KTV", t: "n", w: 12 }] : [])],
      rows: orders.map((o) => [o.code, o.day, o.customer_code, o.customer_name, o.clinic, o.doctor, o.patient, o.ref, { new: "Mới", redo: "Làm lại", continue: "Làm tiếp" }[o.kind], o.items_text, o.units, D8.OST[o.status] || o.status,
        team(o.designer), team(o.qc), o.dday || "", ...(m ? [o.currency, o.subtotal, o.adj_pct || "", o.status === "cancelled" ? 0 : o.total, o.paid, o.status === "cancelled" ? 0 : o.due, { charge: "Tính tiền", free: "Miễn phí", warranty: "Bảo hành" }[o.charge] || ""] : []),
        ...("tech_cost" in (orders[0] || {}) ? [o.tech_cost || 0] : [])]),
      sum: m ? [10, 18, 19, 20] : [10] });
    sheets.push({ name: "Hạng mục", cols: [{ h: "Mã đơn", w: 14 }, { h: "Ngày nhận", t: "d", w: 12 }, { h: "Mã khách", w: 10 }, { h: "Mã hàng", w: 10 }, { h: "Tên hàng", w: 30 }, { h: "Răng", w: 16 }, { h: "Số lượng", t: "n", w: 9 },
      ...(m ? [{ h: "Đơn giá", t: "n", w: 12 }, { h: "Thành tiền", t: "n", w: 12 }, { h: "Tiền tệ", w: 8 }] : []), { h: "Ghi chú", w: 24 }],
      rows: orders.flatMap((o) => (byOrder.get(o.id) || []).map((x) => [o.code, o.day, o.customer_code, x.product, x.name, x.teeth, x.qty, ...(m ? [x.price, x.amount, o.currency] : []), x.note])), sum: m ? [6, 8] : [6] });
    if (m && payments.length) sheets.push({ name: "Thanh toán", cols: [{ h: "Ngày", t: "d", w: 12 }, { h: "Mã khách", w: 10 }, { h: "Khách hàng", w: 24 }, { h: "Số tiền", t: "n", w: 14 }, { h: "Tiền tệ", w: 8 }, { h: "Hình thức", w: 18 }, { h: "Cho đơn", w: 14 }, { h: "Mã giao dịch", w: 18 }, { h: "Ghi chú", w: 24 }],
      rows: payments.map((p) => [p.day, p.customer_code, p.customer_name, p.amount, p.currency, D8.PAY_METHOD[p.method] || p.method, p.order_code || "", p.ref, p.note]) });
    if (repD) {
      sheets.push({ name: "Theo khách", cols: [{ h: "Mã khách", w: 10 }, { h: "Khách hàng", w: 26 }, { h: "Số ca", t: "i", w: 9 }, { h: "Đơn vị", t: "n", w: 9 }, { h: "Làm lại", t: "i", w: 9 }, ...(m ? [{ h: "Tiền tệ", w: 8 }, { h: "Doanh thu", t: "n", w: 14 }, { h: "Đã thu", t: "n", w: 14 }, { h: "Còn nợ", t: "n", w: 14 }] : [])],
        rows: repD.customers.map((x) => [x.code, x.name, x.n, Math.round((x.u || 0) * 100) / 100, x.r || 0, ...(m ? [x.cur, x.t, x.p, Math.round((x.t - x.p) * 100) / 100] : [])]) });
      sheets.push({ name: "Theo KTV", cols: [{ h: "KTV", w: 22 }, { h: "Số ca", t: "i", w: 9 }, { h: "Đơn vị", t: "n", w: 9 }, { h: "QC trả về", t: "i", w: 10 }, { h: "Làm lại", t: "i", w: 9 }, ...(repD.tech ? [{ h: "Công KTV", t: "n", w: 14 }, { h: "Tiền tệ", w: 8 }] : [])],
        rows: repD.designers.map((x) => [x.email ? team(x.email) : "Chưa giao KTV", x.n, Math.round((x.u || 0) * 100) / 100, x.f || 0, x.r || 0, ...(repD.tech ? [x.k || 0, x.kc || ""] : [])]), sum: [1, 2, 3, 4] });
      if (m && repD.debt.length) sheets.push({ name: "Công nợ", cols: [{ h: "Mã khách", w: 10 }, { h: "Khách hàng", w: 26 }, { h: "Số đơn còn nợ", t: "i", w: 12 }, { h: "Từ ngày", t: "d", w: 12 }, { h: "Còn nợ", t: "n", w: 14 }, { h: "Tiền tệ", w: 8 }],
        rows: repD.debt.map((x) => [x.code, x.name, x.n, x.oldest, x.due, x.cur]) });
    }
    await D8X.write(sheets, "D8-" + (title || "so-don") + "-" + from + "_" + to + ".xlsx");
  };

  /* ============================================================ import from Excel */
  const IMPORTS = {
    customers: { title: "Khách hàng", perm: "customers.edit", desc: "Mỗi dòng một khách. Để trống Mã khách thì hệ thống tự cấp mã DR / LAB.",
      cols: { code: ["Mã khách", "ma khach", "code"], name: ["Tên khách", "ten khach", "khach hang", "name"], kind: ["Loại", "loai"], country: ["Quốc gia", "quoc gia", "country"], currency: ["Tiền tệ", "tien te", "currency"],
        contact: ["Người liên hệ", "lien he"], email: ["Email"], phone: ["Điện thoại / WhatsApp", "dien thoai", "whatsapp", "phone"], address: ["Địa chỉ", "dia chi"], terms: ["Điều khoản thanh toán", "dieu khoan"], note: ["Ghi chú", "ghi chu", "note"] },
      need: ["name"],
      template: () => [{ name: "Khách hàng", cols: [{ h: "Mã khách", w: 14 }, { h: "Tên khách", w: 32 }, { h: "Loại", w: 14 }, { h: "Quốc gia", w: 12 }, { h: "Tiền tệ", w: 9 }, { h: "Người liên hệ", w: 20 }, { h: "Email", w: 26 }, { h: "Điện thoại / WhatsApp", w: 18 }, { h: "Địa chỉ", w: 26 }, { h: "Điều khoản thanh toán", w: 26 }, { h: "Ghi chú", w: 26 }],
        rows: [["", "", "Bác sĩ", "", "USD", "", "", "", "", "", ""], ["", "", "Labo", "", "VND", "", "", "", "", "", ""]] }],
      row: (g) => ({ code: g("code"), name: g("name"), kind: kindOf(g("kind")), country: g("country"), currency: String(g("currency") || "").toUpperCase(), contact: g("contact"), email: g("email"), phone: g("phone"), address: g("address"), terms: g("terms"), note: g("note") }) },
    products: { title: "Mã hàng", perm: "pricing.manage", desc: "Danh mục mã hàng chung. Mã có rồi thì cập nhật tên, nhóm, đơn vị, giá mặc định.",
      cols: { code: ["Mã hàng", "ma hang", "code"], name: ["Tên tiếng Việt", "ten hang", "ten tieng viet", "ten"], name_en: ["Tên tiếng Anh", "ten tieng anh", "name"], grp: ["Nhóm dịch vụ", "nhom"], unit: ["Tính theo", "don vi", "don vi tinh", "unit"],
        price_usd: ["Giá mặc định USD", "gia usd", "usd"], price_vnd: ["Giá mặc định VND", "gia vnd", "vnd"], active: ["Đang dùng", "dang dung"], note: ["Ghi chú", "ghi chu"] },
      need: ["code", "name"],
      template: async () => { const p = await D8.book.products(true).catch(() => []); return [productSheet(p.length ? p.map((x) => ({ ...x, price_usd: x.prices && x.prices.USD != null ? x.prices.USD : "", price_vnd: x.prices && x.prices.VND != null ? x.prices.VND : "" })) : [{ code: "CR", name: "Mão răng (giải phẫu)", name_en: "Crown (full anatomy)", grp: "Crown & bridge", unit: "unit", price_usd: 30, price_vnd: "", active: true }, { code: "IMC", name: "Mão trên implant", name_en: "Implant crown", grp: "Implant restorations", unit: "unit", price_usd: 45, price_vnd: "", active: true }])]; },
      row: (g) => { const r = { code: g("code"), name: g("name"), name_en: g("name_en"), grp: grpOf(g("grp")), unit: unitOf(g("unit")), note: g("note"), active: !/^(khong|không|no|0)$/i.test(String(g("active") || "").trim()) };
        if (g("price_usd") !== "") r.price_usd = g("price_usd"); if (g("price_vnd") !== "") r.price_vnd = g("price_vnd"); return r; } },
    prices: { title: "Bảng giá theo khách", perm: "pricing.manage", desc: "File xuất từ “Bảng giá tất cả khách” (mỗi khách một cột, tiêu đề dạng MÃKHÁCH (USD)), hoặc dạng dòng: Mã khách · Mã hàng · Đơn giá · Tiền tệ. Ô trống = không đổi.",
      cols: { customer: ["Mã khách", "ma khach"], product: ["Mã hàng", "ma hang"], price: ["Đơn giá", "don gia", "gia", "price"], currency: ["Tiền tệ", "tien te", "currency"] },
      need: ["product"], template: async () => [await priceSheet()], wide: true },
    orders: { title: "Đơn hàng cũ", perm: "orders.edit", desc: "Mỗi dòng một hạng mục. Nhiều hạng mục của cùng một đơn: ghi cùng một ký hiệu ở cột Mã đơn (VD A1) hoặc mã đơn thật. Để trống Mã đơn thì hệ thống tự đánh mã theo Ngày nhận.",
      cols: { code: ["Mã đơn", "ma don", "order code", "order no"], day: ["Ngày nhận", "ngay nhan", "ngay", "created date", "date received", "received", "date"], customer: ["Mã khách", "ma khach", "customer code", "customer"],
        clinic: ["Nha khoa", "phong kham", "nha khoa / phong kham", "clinic", "practice"], doctor: ["Bác sĩ", "bac si", "doctor"],
        patient: ["Bệnh nhân", "benh nhan", "patient"], ref: ["Mã của khách", "ma cua khach", "case id", "case no", "case number"], product: ["Mã hàng", "ma hang", "ten hang", "san pham", "product"], teeth: ["Răng", "rang", "teeth", "tooth"], qty: ["Số lượng", "so luong", "sl", "unit", "units", "qty", "quantity"],
        price: ["Đơn giá", "don gia", "price"], adj_pct: ["Phụ phí %", "phu phi"], charge: ["Tính phí", "tinh phi"], status: ["Trạng thái", "trang thai", "tien do", "progress", "status"], dday: ["Ngày giao", "ngay giao", "delivered", "delivery date"], designer: ["KTV", "designer"], qc: ["QC"],
        paid: ["Đã thanh toán", "da thanh toan", "da tra", "paid"], pay_day: ["Ngày thanh toán", "ngay thanh toan", "paid date"], pay_method: ["Hình thức thanh toán", "hinh thuc"], service: ["Dịch vụ", "dich vu", "service"], material: ["Vật liệu", "vat lieu", "material"], shade: ["Màu", "mau", "shade"],
        notes: ["Ghi chú", "ghi chu", "yeu cau", "instruction", "instructions", "notes", "note"] },
      need: ["day", "product"],
      template: () => [{ name: "Đơn hàng", cols: [{ h: "Mã đơn", w: 12 }, { h: "Ngày nhận", t: "d", w: 12 }, { h: "Mã khách", w: 10 }, { h: "Nha khoa", w: 18 }, { h: "Bác sĩ", w: 14 }, { h: "Bệnh nhân", w: 18 }, { h: "Mã của khách", w: 13 }, { h: "Mã hàng", w: 10 },
        { h: "Răng", w: 12 }, { h: "Số lượng", t: "n", w: 9 }, { h: "Đơn giá", t: "n", w: 10 }, { h: "Phụ phí %", t: "n", w: 9 }, { h: "Tính phí", w: 11 }, { h: "Trạng thái", w: 12 }, { h: "Ngày giao", t: "d", w: 12 }, { h: "KTV", w: 14 }, { h: "QC", w: 14 },
        { h: "Đã thanh toán", w: 12 }, { h: "Ngày thanh toán", t: "d", w: 13 }, { h: "Hình thức thanh toán", w: 16 }, { h: "Dịch vụ", w: 16 }, { h: "Vật liệu", w: 12 }, { h: "Màu", w: 8 }, { h: "Ghi chú", w: 24 }],
        rows: [["A1", "2026-09-18", "ANNIE", "", "Dr Annie", "Nguyễn Văn A", "GC021", "SG", "", 1, "", "", "Tính tiền", "Đã giao", "2026-09-18", "", "", "x", "2026-09-20", "Payoneer", "", "", "", "3 implant"],
          ["A2", "2026-10-05", "JAKE", "Smile Co", "Dr Jake", "John Smith", "", "CR", "11, 21", 2, "", 50, "Tính tiền", "Đã giao", "2026-10-05", "", "", "", "", "", "", "Zirconia", "A2", "Làm gấp trong ngày"],
          ["A2", "2026-10-05", "JAKE", "", "", "", "", "IMC", "36", 1, "", "", "", "", "", "", "", "", "", "", "", "", "", ""]] },
        { name: "Hướng dẫn", filter: false, cols: [{ h: "Cột", w: 22 }, { h: "Cách ghi", w: 90 }], rows: [
          ["Mã đơn", "Để trống: tự tạo mã yymmddxx theo Ngày nhận (VD 26102101 = ca 01 ngày 21/10/2026). Ghi mã thật nếu đơn đã có mã: 26102101, làm lại 26102101R1, làm tiếp giai đoạn 2 26102101C2, làm lại rồi làm tiếp 26102101R1C2 (đơn gốc nên ở dòng trên). Ghi cùng một ký hiệu (VD A1) cho các dòng của cùng một đơn."],
          ["Ngày nhận", "dd/mm/yyyy, ví dụ 05/10/2026."], ["Mã khách", "Mã khách đã có trong mục Khách hàng (nhập khách trước)."], ["Mã hàng", "Mã trong danh mục Mã hàng & bảng giá."],
          ["Số lượng", "Để trống: 1 (hoặc số răng ở cột Răng với mã tính theo răng)."], ["Đơn giá", "Để trống: lấy theo bảng giá của khách (hoặc giá mặc định)."],
          ["Tính phí", "Tính tiền / Miễn phí / Bảo hành."], ["Trạng thái", "Để trống = Đã giao. Có thể ghi: Mới nhận, Đang thiết kế, Chờ QC, Chờ bác sĩ duyệt, Bác sĩ đã duyệt, Đã giao, Tạm dừng, Đã hủy."],
          ["KTV / QC", "Email hoặc tên nhân sự trong mục Nhân sự."], ["Đã thanh toán", "x = đã trả đủ, hoặc ghi số tiền đã trả. Để trống = chưa trả."]] }],
      group: true },
    payments: { title: "Thanh toán", perm: "billing.edit", desc: "Tiền khách đã trả. Có Mã đơn thì trừ vào đơn đó; không có thì trừ vào các đơn cũ nhất còn nợ (tiền ứng trước, trả gộp).",
      cols: { day: ["Ngày", "ngay", "ngay nhan tien"], customer: ["Mã khách", "ma khach"], amount: ["Số tiền", "so tien", "amount"], currency: ["Tiền tệ", "tien te"], method: ["Hình thức", "hinh thuc"], ref: ["Mã giao dịch", "ma giao dich"], order_code: ["Mã đơn", "cho don", "ma don"], note: ["Ghi chú", "ghi chu"] },
      need: ["day", "amount"],
      template: () => [{ name: "Thanh toán", cols: [{ h: "Ngày", t: "d", w: 12 }, { h: "Mã khách", w: 10 }, { h: "Số tiền", t: "n", w: 12 }, { h: "Tiền tệ", w: 8 }, { h: "Hình thức", w: 16 }, { h: "Mã giao dịch", w: 18 }, { h: "Mã đơn", w: 14 }, { h: "Ghi chú", w: 26 }],
        rows: [["2026-09-01", "ANNIE", 200, "USD", "Payoneer", "", "", "Ứng trước"], ["2026-10-06", "JAKE", 157.5, "USD", "PayPal", "", "26100501", ""]] }],
      row: (g) => ({ day: g("day"), customer: g("customer"), amount: g("amount"), currency: String(g("currency") || "").toUpperCase(), method: methodOf(g("method")), ref: g("ref"), order_code: g("order_code"), note: g("note") }) },
  };
  const fold = (s) => D8X.fold(s);
  const kindOf = (v) => (/^(lab|labo|laboratory)$/.test(fold(v)) ? "lab" : "doctor");
  const unitOf = (v) => { const f = fold(v); return /ham|arch|jaw/.test(f) ? "arch" : /^ca$|case/.test(f) ? "case" : /gio|hour/.test(f) ? "hour" : /^cau|bridge/.test(f) ? "bridge" : /^bo$|^set/.test(f) ? "set" : "unit"; };
  const grpOf = (v) => { const f = fold(v); return D8.SERVICES.find((s) => fold(s) === f || fold(D8.svcLabel(s)) === f) || String(v || "").trim(); };
  const methodOf = (v) => { const f = fold(v); return /paypal/.test(f) ? "paypal" : /payoneer/.test(f) ? "payoneer" : /remitly/.test(f) ? "remitly" : /chuyen|bank|ngan hang|swift|techcom/.test(f) ? "bank" : /tien mat|cash/.test(f) ? "cash" : /ung|deposit/.test(f) ? "deposit" : "other"; };
  const statusOf = (v) => { const f = fold(v); if (!f) return ""; const hit = Object.entries(D8.OST).find(([k, l]) => fold(l) === f || k === f); return hit ? hit[0] : /giao|done|deliver|complet|xong|hoan thanh/.test(f) ? "delivered" : /huy|cancel/.test(f) ? "cancelled" : /pending|progress|dang|cho|doing|design/.test(f) ? "design" : "INVALID"; };
  const chargeOf = (v) => { const f = fold(v); return !f ? "charge" : /bao hanh|warranty/.test(f) ? "warranty" : /mien phi|free|dung thu/.test(f) ? "free" : "charge"; };

  function drawImportHome() {
    const W = ws();
    W.setBand("Nhập dữ liệu từ Excel", "Khách hàng, mã hàng, bảng giá, đơn hàng cũ, thanh toán");
    W.show("p-import");
    const order = ["customers", "products", "prices", "orders", "payments"];
    $("p-import").innerHTML = `<div class="pt-alert info"><div>Nên nhập theo thứ tự: <b>1. Khách hàng</b> → <b>2. Mã hàng</b> → <b>3. Bảng giá</b> → <b>4. Đơn hàng cũ</b> → <b>5. Thanh toán</b>. Mỗi mục có file mẫu .xlsx: tải về, điền, rồi chọn file để xem trước trước khi nhập.</div></div>
      <div class="imp-grid">${order.map((k, i) => { const t = IMPORTS[k]; const ok = can(t.perm); return `<a class="card imp-card${ok ? "" : " off"}" href="${ok ? "#import/" + k : "#import"}"><span class="eyebrow">Bước ${i + 1}</span><h2 class="h-caps">${esc(t.title)}</h2><p>${esc(t.desc)}</p>${ok ? '<span class="btn small">Mở</span>' : '<span class="muted">Bạn chưa có quyền</span>'}</a>`; }).join("")}</div>`;
  }
  function drawImport(kind) {
    const W = ws(), T = IMPORTS[kind];
    if (!T || !can(T.perm)) return W.denied();
    W.setBand("Nhập " + T.title.toLowerCase(), "Tải file mẫu, điền, xem trước rồi nhập", { back: true, backHref: "#import", backText: "Nhập dữ liệu" });
    W.show("p-import");
    const host = $("p-import");
    host.innerHTML = `<section class="card"><div class="card-head-row"><h2 class="h-caps">1. File mẫu</h2></div><p class="sub">${esc(T.desc)}</p>
        <div class="wf-actions"><button class="btn small" type="button" id="imTpl">Tải file mẫu (.xlsx)</button></div></section>
      <section class="card"><h2 class="h-caps">2. Chọn file đã điền</h2>
        ${kind === "orders" ? `<p class="sub">Nhận cả bảng tự theo dõi (VD Google Sheets "GC - Case Detail": Case_ID, Created_Date, Doctor_Name, Patient_Name, Product_Name, Unit, Instruction_Note, Progress). Tải về dạng .xlsx rồi chọn ở đây.</p>
          <div class="im-opts"><div><label class="field-label" for="imCust">Khách cho các dòng không ghi Mã khách <span class="opt">(nếu cả file là của một khách)</span></label>
          <select class="input" id="imCust"><option value="">— Theo cột Mã khách / bác sĩ —</option></select></div>
          <div><label class="field-label" for="imKtv">KTV cho các dòng không ghi KTV <span class="opt">(bảng theo từng KTV)</span></label>
          <select class="input" id="imKtv"><option value="">— Theo cột KTV —</option>${W.team().filter((t) => t.design).map((t) => `<option value="${esc(t.email)}">${esc(t.name || t.email)}</option>`).join("")}</select></div></div>` : ""}
        <label class="drop compact" id="imDrop"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg><strong>Kéo file Excel (.xlsx) hoặc .csv vào đây</strong><span>hoặc bấm để chọn file</span><input type="file" id="imFile" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
        <p class="error" id="imErr" hidden></p></section>
      <section class="card" id="imCmap" hidden><h2 class="h-caps">Ghép bác sĩ với khách</h2>
        <p class="sub">Dòng không ghi Mã khách: bác sĩ trùng tên khách thì tự ghép, còn lại chọn khách cho từng bác sĩ một lần.</p><div id="imCmapBody"></div></section>
      <section class="card" id="imMap" hidden><h2 class="h-caps">Ghép tên hàng với mã hàng</h2>
        <p class="sub">File ghi tên hàng thay vì mã hàng. Chọn mã hàng cho từng tên một lần, mọi dòng cùng tên sẽ theo.</p><div id="imMapBody"></div></section>
      <section class="card" id="imPrev" hidden><div class="card-head-row"><h2 class="h-caps">3. Xem trước</h2><span class="chip" id="imCount"></span></div><div id="imBody"></div>
        <div class="wf-actions" style="align-items:center"><button class="btn btn-primary" type="button" id="imGo" disabled>Nhập</button><label class="check" id="imSkipW" hidden style="margin:0"><input type="checkbox" id="imSkip" checked> Bỏ qua đơn có thể đã có</label></div>
        <div class="progress block" id="imProg" hidden><div class="progress-bar"><i></i></div><p></p></div><div id="imDone"></div></section>`;
    $("imTpl").addEventListener("click", async (e) => { const b = e.currentTarget; D8.busy(b, true); try { await D8X.write(await T.template(), "D8-mau-" + kind + ".xlsx"); } catch (err) { D8.toast(err.message); } D8.busy(b, false); });
    const drop = $("imDrop");
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => { if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); });
    $("imFile").addEventListener("change", (e) => { if (e.target.files[0]) pick(e.target.files[0]); e.target.value = ""; });
    let prepared = null, last = null;
    const opts = { customer: "", designer: "", map: {}, mapName: {}, cmap: {}, cmapName: {} };
    if ($("imCust")) {
      $("imKtv").addEventListener("change", () => { opts.designer = $("imKtv").value; if (last) rebuild(); });
      D8.book.customers(true).then((cs) => { $("imCust").insertAdjacentHTML("beforeend", cs.filter((c) => c.active).map((c) => `<option value="${esc(c.code)}">${esc(D8.book.custLabel(c))}</option>`).join("")); }).catch(() => {});
      $("imCust").addEventListener("change", () => { opts.customer = $("imCust").value; if (last) rebuild(); });
    }
    async function pick(file) {
      $("imErr").hidden = true; $("imPrev").hidden = true; $("imDone").innerHTML = "";
      try { last = { name: file.name, sheets: await D8X.read(file) }; Object.assign(opts, { map: {}, mapName: {}, cmap: {}, cmapName: {} }); await rebuild(); }
      catch (err) { $("imErr").textContent = err.message; $("imErr").hidden = false; }
    }
    async function rebuild() {
      try {
        prepared = kind === "prices" ? await preparePrices(last.sheets) : prepareRows(T, last.sheets);
        if (kind === "orders") { prepared = await prepareOrders(prepared, opts); await drawMaps(); }
        showPreview(last.name);
      } catch (err) { $("imErr").textContent = err.message; $("imErr").hidden = false; }
    }
    // names in the file that are not product codes / doctors without a customer: pick once per name
    async function drawMaps() {
      const [prods, custs] = await Promise.all([D8.book.products(), D8.book.customers()]);
      pickCard("imCmap", prepared.unknownDoc, opts.cmap, opts.cmapName, custs.filter((c) => c.active).map((c) => [c.code, D8.book.custLabel(c)]), "— Chọn khách —");
      pickCard("imMap", prepared.unknown, opts.map, opts.mapName, prods.filter((p) => p.active).map((p) => [p.code, p.code + " — " + p.name]), "— Chọn mã hàng —");
    }
    function pickCard(id, keys, map, names, list, none) {
      const all = [...new Set([...(keys || []), ...Object.keys(map)])];
      $(id).hidden = !all.length;
      if (!all.length) return;
      $(id + "Body").innerHTML = `<div class="im-map">${all.map((k) => { const v = map[k] || ""; return `<label class="im-map-row"><span>${esc(names[k] || k)}</span>
          <select class="input" data-map="${esc(k)}"><option value="">${none}</option>${list.map(([code, label]) => `<option value="${esc(code)}"${code === v ? " selected" : ""}>${esc(label)}</option>`).join("")}</select></label>`; }).join("")}</div>`;
      $(id + "Body").querySelectorAll("[data-map]").forEach((sel) => sel.addEventListener("change", () => {
        if (sel.value) map[sel.dataset.map] = sel.value; else delete map[sel.dataset.map];
        rebuild();
      }));
    }
    function showPreview(fileName) {
      const p = prepared, good = p.rows.filter((r) => !r.err), bad = p.rows.filter((r) => r.err), dups = p.rows.filter((r) => r.dup && !r.err);
      const zero = kind === "orders" && can("billing.view") ? good.filter((r) => r.total === 0 && r.data.charge === "charge") : [];
      $("imPrev").hidden = false;
      $("imCount").textContent = fileName + " · " + p.rows.length + " " + (kind === "orders" ? "đơn" : "dòng");
      const cols = p.preview;
      $("imBody").innerHTML = `${bad.length ? `<div class="pt-alert warn"><div><b>${bad.length} ${kind === "orders" ? "đơn" : "dòng"} có lỗi</b> sẽ không được nhập. Sửa trong file rồi chọn lại, hoặc nhập các dòng hợp lệ.</div></div>` : ""}
        ${dups.length ? `<div class="pt-alert info"><div><b>${dups.length} đơn có thể đã có</b> (cùng khách, ngày nhận và bệnh nhân / mã của khách).</div></div>` : ""}
        ${zero.length ? `<div class="pt-alert warn" id="imZero"><div><b>${zero.length} đơn có thành tiền 0</b> vì mã hàng chưa có giá cho khách (${esc(zero.slice(0, 5).map((r) => r.code || r.data.label).join(", "))}${zero.length > 5 ? "…" : ""}). Thêm giá ở <a href="#catalog">Mã hàng &amp; bảng giá</a> rồi chọn lại file, hoặc nhập rồi sửa giá sau.</div></div>` : ""}
        <div class="tbl-wrap imp-tbl"><table class="tbl"><thead><tr><th></th>${cols.map((c) => `<th>${esc(c[0])}</th>`).join("")}</tr></thead><tbody>
        ${p.rows.slice(0, 300).map((r) => `<tr class="${r.err ? "bad" : r.dup ? "dup" : ""}"><td>${r.err ? `<span class="imp-x" title="${esc(r.err)}">✕</span>` : r.dup ? '<span class="imp-d" title="Có thể đã có">!</span>' : '<span class="imp-ok">✓</span>'}</td>${cols.map((c) => `<td>${esc(c[1](r))}</td>`).join("")}</tr>${r.err ? `<tr class="bad-msg"><td></td><td colspan="${cols.length}">${esc(r.err)}</td></tr>` : ""}`).join("")}
        </tbody></table></div>${p.rows.length > 300 ? `<p class="hint">Hiện 300 dòng đầu.</p>` : ""}`;
      $("imSkipW").hidden = !dups.length;
      const go = $("imGo");
      const count = () => good.length - (dups.length && $("imSkip").checked ? dups.length : 0);
      const label = () => { const n = count(); go.disabled = !n; go.textContent = n ? "Nhập " + n + " " + (kind === "orders" ? "đơn" : "dòng") + " hợp lệ" : "Không có dòng hợp lệ"; };
      $("imSkip").onchange = label; label();
      go.onclick = async () => {
        const list = good.filter((r) => !(r.dup && $("imSkip").checked)).map((r) => r.data);
        const size = kind === "orders" ? 100 : 200, prog = $("imProg");
        D8.busy(go, true); prog.hidden = false;
        let done = 0; const errs = [];
        try {
          for (let i = 0; i < list.length; i += size) {
            prog.querySelector("i").style.width = Math.round((i / list.length) * 100) + "%"; prog.querySelector("p").textContent = "Đang nhập " + Math.min(list.length, i + size) + " / " + list.length + "…";
            const r = await api("/api/import/" + kind, { method: "POST", body: { rows: list.slice(i, i + size), partial: true } });
            done += r.done || 0; errs.push(...(r.errors || []).map((e) => e.msg));
          }
          prog.querySelector("i").style.width = "100%"; prog.querySelector("p").textContent = "Xong.";
          D8.book.drop();
          $("imDone").innerHTML = `<div class="pt-alert ok"><div>Đã nhập <b>${done}</b> ${kind === "orders" ? "đơn" : "dòng"}.${errs.length ? " " + errs.length + " dòng bị máy chủ từ chối:" : ""}${errs.length ? `<ul>${errs.slice(0, 20).map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
            <div class="wf-actions">${kind === "orders" ? '<a class="btn small" href="#orders?status=">Xem đơn hàng</a>' : kind === "customers" ? '<a class="btn small" href="#customers">Xem khách hàng</a>' : kind === "payments" ? '<a class="btn small" href="#reports">Xem báo cáo</a>' : '<a class="btn small" href="#catalog">Xem mã hàng &amp; bảng giá</a>'}</div></div></div>`;
          go.textContent = "Đã nhập"; go.disabled = true; go.removeAttribute("aria-busy");
        } catch (err) { D8.busy(go, false); prog.hidden = true; D8.toast(err.message); }
      };
    }
  }
  // Rows of the first sheet that has the needed headers → [{ data, err }]
  function findSheet(T, sheets) {
    for (const s of sheets) {
      for (let h = 0; h < Math.min(10, s.rows.length); h++) {
        const idx = D8X.mapHeader(s.rows[h], T.cols);
        if (T.need.every((k) => k in idx)) return { sheet: s, h, idx };
      }
    }
    throw new Error("Không thấy các cột cần có (" + T.need.map((k) => T.cols[k][0]).join(", ") + "). Dùng file mẫu để đúng tên cột.");
  }
  function prepareRows(T, sheets) {
    const { sheet, h, idx } = findSheet(T, sheets);
    const out = [];
    sheet.rows.slice(h + 1).forEach((row, i) => {
      const g = (k) => (k in idx ? (row[idx[k]] === undefined || row[idx[k]] === null ? "" : typeof row[idx[k]] === "string" ? row[idx[k]].trim() : row[idx[k]]) : "");
      if (Object.keys(idx).every((k) => g(k) === "")) return;
      out.push({ line: h + i + 2, g });
    });
    if (T.group) return { rows: out, T };
    const rowsP = out.map((r) => {
      const data = T.row(r.g);
      data.row = r.line;
      let err = "";
      for (const k of T.need) if (data[k] === "" || data[k] === undefined) err = "Thiếu " + T.cols[k][0];
      if ("day" in data) { data.day = D8X.day(data.day); if (!data.day || data.day.startsWith("INVALID")) err = err || "Ngày không hợp lệ (dd/mm/yyyy)"; }
      return { data, err: err ? "Dòng " + r.line + ": " + err : "", line: r.line };
    });
    const pv = { customers: [["Mã", (r) => r.data.code], ["Tên", (r) => r.data.name], ["Loại", (r) => r.data.kind], ["Tiền tệ", (r) => r.data.currency || "USD"], ["Quốc gia", (r) => r.data.country]],
      products: [["Mã hàng", (r) => r.data.code], ["Tên", (r) => r.data.name], ["Tính theo", (r) => UNIT[r.data.unit]], ["Giá USD", (r) => r.data.price_usd ?? ""], ["Giá VND", (r) => r.data.price_vnd ?? ""]],
      payments: [["Ngày", (r) => fmtDay(r.data.day)], ["Khách", (r) => r.data.customer], ["Số tiền", (r) => r.data.amount], ["Tiền tệ", (r) => r.data.currency], ["Hình thức", (r) => D8.PAY_METHOD[r.data.method]], ["Đơn", (r) => r.data.order_code]] };
    return { rows: rowsP, preview: pv[Object.keys(IMPORTS).find((k) => IMPORTS[k] === T)] || [] };
  }
  async function preparePrices(sheets) {
    const T = IMPORTS.prices;
    const custs = await D8.book.customers(true);
    for (const s of sheets) {
      for (let h = 0; h < Math.min(10, s.rows.length); h++) {
        const head = s.rows[h] || [];
        const pi = head.findIndex((x) => /^ma hang$|^code$/.test(fold(x)));
        if (pi < 0) continue;
        // wide: columns "CODE (USD)" or "Mặc định (USD)"
        const wideCols = head.map((x, i) => { const m = /^(.+?)\s*\((USD|VND)\)\s*$/i.exec(String(x || "").trim()); if (!m || i === pi) return null; const f = fold(m[1]);
          const tier = /^(muc 2|mid)$/.test(f) ? "mid" : /^(muc 3|min)$/.test(f) ? "min" : ""; const def = !tier && /^(mac dinh|default|niem yet|max)$/.test(f);
          return { i, customer: def || tier ? "" : m[1].trim().toUpperCase(), tier, currency: m[2].toUpperCase(), def: def || !!tier }; }).filter(Boolean);
        if (wideCols.length) {
          const rowsP = [];
          s.rows.slice(h + 1).forEach((row, k) => {
            const product = String(row[pi] || "").trim().toUpperCase(); if (!product) return;
            for (const c of wideCols) {
              const v = row[c.i];
              if (v === "" || v === undefined || v === null) continue;
              const known = c.def || custs.some((x) => x.code === c.customer);
              rowsP.push({ data: { customer: c.customer, ...(c.tier ? { tier: c.tier } : {}), product, price: v, currency: c.currency, row: h + k + 2 }, err: !known ? "Dòng " + (h + k + 2) + ": không có khách mã " + c.customer : isNaN(+v) || +v < 0 ? "Dòng " + (h + k + 2) + ": giá không hợp lệ" : "" });
            }
          });
          return { rows: rowsP, preview: [["Khách", (r) => r.data.customer || TIER[r.data.tier || ""]], ["Mã hàng", (r) => r.data.product], ["Đơn giá", (r) => r.data.price], ["Tiền tệ", (r) => r.data.currency]] };
        }
      }
    }
    const p = prepareRows({ ...T, row: (g) => ({ customer: g("customer"), product: g("product"), price: g("price"), currency: String(g("currency") || "").toUpperCase() }) }, sheets);
    return { rows: p.rows, preview: [["Khách", (r) => r.data.customer || "Mặc định"], ["Mã hàng", (r) => r.data.product], ["Đơn giá", (r) => r.data.price], ["Tiền tệ", (r) => r.data.currency]] };
  }
  async function prepareOrders(p, opts = { customer: "", designer: "", map: {}, mapName: {}, cmap: {}, cmapName: {} }) {
    // product: a code, a name or English name from the catalogue, or a name the user matched to a code
    const [prods, custs] = await Promise.all([D8.book.products(), D8.book.customers()]);
    // customer of a line without a Mã khách: the user's match for its doctor, the file-wide choice, or a customer named like the doctor
    const docKey = (v) => fold(v).replace(/^(dr|doctor|bs|bac si|nha khoa|clinic)\.?\s+/, "");
    const custByName = new Map(), unknownDoc = new Set();
    custs.filter((c) => c.active).forEach((c) => [c.name, c.contact].forEach((n) => { const k = n && docKey(n); if (k) custByName.set(k, custByName.has(k) && custByName.get(k) !== c.code ? "" : c.code); }));
    // short forms too: "Implant crown" for "Implant crown (screw-retained / Ti-base)", "Night guard" for "Night guard / splint"
    // (a short form two products share is left for the user to match)
    const codes = new Set(prods.map((x) => x.code)), byName = new Map(), short = new Map(), unknown = new Set();
    const shortOf = (n) => { const base = String(n).split("(")[0]; return [base, ...base.split("/")].map(fold).filter((k) => k.length > 2); };
    prods.forEach((x) => [x.name, x.name_en].forEach((n) => { if (!n) return; byName.set(fold(n), x.code); shortOf(n).forEach((k) => short.set(k, short.has(k) && short.get(k) !== x.code ? "" : x.code)); }));
    const productOf = (raw) => {
      const s = String(raw == null ? "" : raw).trim();
      if (!s) return "";
      if (codes.has(s.toUpperCase())) return s.toUpperCase();
      const f = fold(s);
      if (opts.map[f]) return opts.map[f];
      if (byName.has(f)) return byName.get(f);
      if (short.get(f)) return short.get(f);
      unknown.add(s); opts.mapName[f] = s;
      return null;
    };
    // dates written month-first (US sheets) are recognised from the column as a whole
    const mdy = D8X.dateOrder([...p.rows.map((r) => r.g("day")), ...p.rows.map((r) => r.g("dday"))]) === "mdy";
    // group rows into orders: same "Mã đơn" (or temporary key) = one order; without a Mã đơn column, lines with the
    // same customer's case number on the same day are one order (sheets like "GC - Case Detail": one line per product)
    const groups = [], byKey = new Map();
    for (const r of p.rows) {
      const ref = String(r.g("ref") || "").trim();
      const key = String(r.g("code") || "").trim() || (ref ? "ref:" + fold(ref) + "|" + String(r.g("customer") || "").trim().toUpperCase() + "|" + String(r.g("day")) : "");
      let grp = key && byKey.get(key);
      if (!grp) { grp = { key: key && !key.startsWith("ref:") ? key : "#" + r.line, lines: [], first: r }; groups.push(grp); if (key) byKey.set(key, grp); }
      grp.lines.push(r);
    }
    const out = groups.map((grp, i) => {
      const g = grp.first.g, errs = [];
      const day = D8X.day(g("day"), mdy);
      if (!day || day.startsWith("INVALID")) errs.push("ngày nhận không hợp lệ");
      const doc = String(g("doctor") || "").trim(), dk = doc ? docKey(doc) : "";
      const customer = String(g("customer") || "").trim().toUpperCase() || (dk && opts.cmap[dk]) || opts.customer || (dk && custByName.get(dk)) || "";
      if (!customer && dk) { unknownDoc.add(dk); opts.cmapName[dk] = doc; errs.push("chưa biết khách của bác sĩ \"" + doc + "\" (chọn ở khung Ghép bác sĩ với khách)"); }
      else if (!customer) errs.push("thiếu Mã khách (ghi trong file, hoặc chọn khách ở bước 2)");
      const st = statusOf(g("status"));
      if (st === "INVALID") errs.push("trạng thái \"" + g("status") + "\" không hiểu");
      const dday = g("dday") !== "" ? D8X.day(g("dday"), mdy) : "";
      if (dday.startsWith("INVALID")) errs.push("ngày giao không hợp lệ");
      const payDay = g("pay_day") !== "" ? D8X.day(g("pay_day"), mdy) : "";
      const items = grp.lines.map((r) => ({ raw: String(r.g("product") || "").trim(), product: productOf(r.g("product")), teeth: String(r.g("teeth") || ""), qty: r.g("qty") !== "" ? r.g("qty") : D8.teethCount(r.g("teeth")) || 1,
        ...(r.g("price") !== "" ? { price: r.g("price") } : {}), note: "" })).filter((x) => x.raw);
      const unmatched = items.filter((x) => x.product === null).map((x) => x.raw);
      if (unmatched.length) errs.push("chưa ghép mã hàng cho \"" + [...new Set(unmatched)].join("\", \"") + "\" (chọn ở khung Ghép tên hàng)");
      else if (!items.length) errs.push("thiếu Mã hàng");
      const show = items.map((x) => (+x.qty !== 1 ? x.qty + "× " : "") + (x.product || x.raw)).join(", ");
      items.forEach((x) => { delete x.raw; });
      // a real order code (26102101, 26102101R1C2, old style 26/10/21/01) is kept; any other mark only groups the lines
      const code = String(g("code") || "").trim(), ncode = code.toUpperCase().replace(/[\s/._-]+/g, "");
      const data = { key: grp.key, label: code || "dòng " + grp.first.line, row: grp.first.line, code: /^\d{8,9}(?:[RC]\d{1,3})*$/.test(ncode) ? ncode : "", day, customer,
        clinic: g("clinic"), doctor: g("doctor"), patient: g("patient"), ref: String(g("ref") || ""), service: grpOf(g("service")), material: g("material"), shade: String(g("shade") || ""), notes: g("notes"),
        status: st || "delivered", dday: dday && !dday.startsWith("INVALID") ? dday : "", designer: g("designer") || opts.designer || "", qc: g("qc"), adj_pct: g("adj_pct") || 0, charge: chargeOf(g("charge")),
        paid: g("paid"), pay_day: payDay && !payDay.startsWith("INVALID") ? payDay : "", pay_method: methodOf(g("pay_method")), items };
      return { data, show, err: errs.length ? "Đơn " + data.label + ": " + errs.join(", ") : "", i };
    });
    // server dry run: unknown customers / products / staff, codes, possible duplicates
    const okRows = out.filter((r) => !r.err);
    for (let i = 0; i < okRows.length; i += 100) {
      const part = okRows.slice(i, i + 100);
      const r = await api("/api/import/orders", { method: "POST", body: { rows: part.map((x) => x.data), dry: true, partial: true } }).catch((err) => ({ errors: [{ row: -1, msg: err.message }], preview: [] }));
      (r.errors || []).forEach((e) => { if (e.row >= 0 && part[e.row]) part[e.row].err = e.msg; else if (e.row < 0) part.forEach((x) => { x.err = x.err || e.msg; }); });
      (r.preview || []).forEach((pv) => { const x = part[pv.i]; if (x) { x.code = pv.code; x.total = pv.total; x.currency = pv.currency; x.dup = pv.dup; } });
    }
    const m = can("billing.view");
    return { rows: out, unknown: [...unknown].map(fold), unknownDoc: [...unknownDoc], preview: [["Mã đơn", (r) => r.code || r.data.code || "(tự tạo)"], ["Ngày nhận", (r) => fmtDay(r.data.day)], ["Khách", (r) => r.data.customer], ["Bệnh nhân", (r) => r.data.patient],
      ["Hạng mục", (r) => r.show], ["Trạng thái", (r) => D8.OST[r.data.status] || ""], ...(m ? [["Thành tiền", (r) => (r.total !== undefined ? money(r.total, r.currency) : "")]] : [])] };
  }

  /* ============================================================ settings */
  async function drawSettings() {
    const W = ws();
    W.setBand("Cài đặt", "Thanh toán online, dùng thử, cơ sở dữ liệu");
    W.show("p-settings", true);
    const host = $("p-settings");
    host.innerHTML = D8.skel.card(4);
    let s, st;
    try { [s, st] = await Promise.all([api("/api/settings"), api("/api/book/status")]); } catch (err) { host.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
    // what this deployment actually has, so a binding set on the wrong environment or under another name shows up here
    const seen = (st.bindings || []).map((b) => `<code>${esc(b.name)}</code> (${esc(b.kind)})`).join(", ");
    host.innerHTML = `<section class="card"><h2 class="h-caps">Cơ sở dữ liệu đơn hàng</h2>
        ${st.db ? `<div class="pt-alert ok"><div>Đã kết nối (Cloudflare D1${st.dbName && st.dbName !== "DB" ? `, tên biến <code>${esc(st.dbName)}</code>` : ""}). ${st.orders} đơn hàng · ${st.customers} khách hàng · ${st.products} mã hàng.</div></div>`
          : `<div class="pt-alert warn"><div><b>Chưa kết nối.</b> Bản web đang chạy chưa nhận được cơ sở dữ liệu D1.${st.bindings ? ` Máy chủ đang thấy: ${seen || "không có binding nào"} — chưa có D1.` : ""}
            <p style="margin:10px 0 4px"><b>Nếu đã tạo <code>d8-db</code> và thêm binding mà vẫn thấy dòng này</b>, thường là do một trong ba chỗ:</p>
            <ol><li>Binding được thêm cho môi trường <b>Preview</b> thay vì <b>Production</b>: Workers &amp; Pages › <b>d8-3d</b> › Settings › chọn <b>Production</b> ở đầu trang › Bindings › Add › <b>D1 database</b>: tên biến <code>DB</code>, chọn <code>d8-db</code> › Save.</li>
              <li>Chưa triển khai lại sau khi thêm binding: Deployments › bản <b>Production</b> mới nhất › <b>⋯</b> › <b>Retry deployment</b> (binding chỉ có hiệu lực từ lần triển khai sau khi lưu).</li>
              <li>Cơ sở dữ liệu tạo ở một tài khoản Cloudflare khác với tài khoản chứa d8-3d.</li></ol>
            <p style="margin:6px 0 0">Chưa tạo thì: Storage &amp; Databases › D1 SQL Database › <b>Create</b>, tên <code>d8-db</code>, rồi làm bước 1 và 2 ở trên. Bảng dữ liệu tự tạo ở lần mở đầu tiên.</p></div></div>`}</section>
      <section class="card"><h2 class="h-caps">Thanh toán của khách</h2>
        <label class="switch"><input type="checkbox" id="setPay"${s.settings.onlinePay ? " checked" : ""}${can("staff.manage") ? "" : " disabled"}><span></span><b>Thanh toán online trên cổng khách hàng (PayPal / Stripe)</b></label>
        <p class="hint">Đang ${s.settings.onlinePay ? "bật" : "tắt"}. Khi tắt, khách không thấy nút trả tiền; công nợ và tiền khách trả ghi ở sổ thanh toán của từng khách.</p>
        <label class="switch" style="margin-top:18px"><input type="checkbox" id="setTrial"${s.settings.autoTrial ? " checked" : ""}${can("staff.manage") ? "" : " disabled"}><span></span><b>Tự đánh dấu 2 ca đầu của khách mới là dùng thử</b></label>
        <p class="hint">Tắt: bạn tự thương lượng dùng thử với từng khách (đặt “Miễn phí” trong đơn).</p></section>`;
    for (const [id, k] of [["setPay", "onlinePay"], ["setTrial", "autoTrial"]]) {
      const el = $(id);
      el.addEventListener("change", async () => {
        try { await api("/api/settings", { method: "POST", body: { [k]: el.checked } }); D8.toast("Đã lưu."); } catch (err) { el.checked = !el.checked; D8.toast(err.message); }
      });
    }
  }

  /* ------------------------------------------------------------ routes */
  D8.wsRoutes.push(
    { re: /^customers$/, fn: () => (can("customers.view") ? drawCustomers() : ws().denied()) },
    { re: /^customers\/new$/, fn: () => (can("customers.edit") ? drawNewCustomer() : ws().denied()) },
    { re: /^cust\/(\d+)$/, fn: (m) => (can("customers.view") ? drawCustomer(+m[1]) : ws().denied()) },
    { re: /^catalog$/, fn: () => (can("pricing.manage") || can("techpay.manage") ? drawCatalog() : ws().denied()) },
    { re: /^prices$/, fn: () => { location.replace("#catalog"); } },
    { re: /^reports$/, fn: () => (can("reports.view") ? drawReports() : ws().denied()) },
    { re: /^import$/, fn: () => drawImportHome() },
    { re: /^import\/([a-z]+)$/, fn: (m) => drawImport(m[1]) },
    { re: /^settings$/, fn: () => (can("staff.manage") || can("billing.edit") ? drawSettings() : ws().denied()) },
  );
})();
