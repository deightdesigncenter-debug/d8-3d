/* D.EIGHT workspace — technicians (KTV): the team at a glance, one KTV's month (work in hand, QC returns, redos, pay),
   "Công của tôi" for a KTV, and monthly pay slips in Excel. The server decides what each viewer gets (/api/tech). */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => D8.esc(s);
  const api = (p, o) => D8.api(p, o);
  const can = (p) => D8.can(p);
  const ws = () => D8.ws;
  const money = (v, c) => D8.fmtMoney(v || 0, c || "VND");
  const fmtDay = (d) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "");
  const num = (v) => (Math.round((v || 0) * 100) / 100).toLocaleString("vi-VN");
  const pct = (a, b) => (b ? Math.round(((a || 0) / b) * 100) + "%" : "—");
  const vnMonth = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7);
  const monthLabel = (m) => m.slice(5, 7) + "/" + m.slice(0, 4);
  const shift = (m, k) => { const t = +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1) + k; return Math.floor(t / 12) + "-" + String((t % 12) + 1).padStart(2, "0"); };
  const XL = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 2.5h7l4 4V17a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 5 17z"/><path d="M12 2.5v4h4M8 10l4 5M12 10l-4 5"/></svg>';
  const KIND = { new: "Mới", redo: "Làm lại", continue: "Làm tiếp" };
  const BASIS = { delivered: "Ngày giao", received: "Ngày nhận" };
  // managers see every KTV; a KTV (cases.design) sees their own page
  const canTeam = () => can("staff.manage") || can("techpay.manage") || can("reports.view");
  D8.canTeam = canTeam;
  const S = { month: vnMonth(), basis: "delivered" };
  const isNoDb = (err) => err && err.data && err.data.code === "no_db";
  const fail = (host, err) => { host.innerHTML = isNoDb(err) ? D8.noDbPanel(err) : `<p class="error">${esc(err.message)}</p>`; };
  const sumPay = (rows) => { const by = {}; rows.forEach((x) => { const k = x.k !== undefined ? x.k : x.tech_cost, c = x.kc || x.tech_currency || "VND"; if (k) by[c] = (by[c] || 0) + k; }); return by; };
  const payText = (by) => Object.entries(by).map(([c, v]) => money(v, c)).join(" + ") || "—";
  const nameOf = (e) => (e ? ws().teamName(e) : "");

  // month and basis picker, shared by both pages (kept when moving between them)
  function tools(id) {
    const now = vnMonth(), opts = [];
    for (let k = 0; k < 36; k++) { const m = shift(now, -k); opts.push(`<option value="${m}"${m === S.month ? " selected" : ""}>Tháng ${monthLabel(m)}</option>`); }
    return `<div class="o-tools t-tools"><div class="t-month"><button class="btn small" type="button" data-mon="-1" aria-label="Tháng trước">‹</button>
        <select class="input" id="${id}Mon" aria-label="Tháng">${opts.join("")}</select>
        <button class="btn small" type="button" data-mon="1" aria-label="Tháng sau">›</button></div>
      <select class="input" id="${id}Basis" aria-label="Tính theo"><option value="delivered">Ca giao trong tháng</option><option value="received"${S.basis === "received" ? " selected" : ""}>Ca nhận trong tháng</option></select>
      <span class="t-tools-r" id="${id}X"></span></div>`;
  }
  function wireTools(id, reload) {
    const sel = $(id + "Mon"), next = document.querySelector(`#p-tech [data-mon="1"]`);
    const sync = () => { sel.value = S.month; next.disabled = S.month >= vnMonth(); };
    sel.addEventListener("change", () => { S.month = sel.value; sync(); reload(); });
    document.querySelectorAll("#p-tech [data-mon]").forEach((b) => b.addEventListener("click", () => {
      const m = shift(S.month, +b.dataset.mon);
      if (m > vnMonth() || !sel.querySelector(`option[value="${m}"]`)) return;
      S.month = m; sync(); reload();
    }));
    $(id + "Basis").addEventListener("change", () => { S.basis = $(id + "Basis").value; reload(); });
    sync();
  }
  function readQ(q) {
    if (!q) return;
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(q.get("month") || "") && q.get("month") <= vnMonth()) S.month = q.get("month");
    if (BASIS[q.get("basis")]) S.basis = q.get("basis");
  }
  const clickRows = (host) => host.querySelectorAll("tr[data-href]").forEach((tr) => {
    tr.addEventListener("click", (e) => { if (!e.target.closest("a, button")) location.hash = tr.dataset.href; });
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") location.hash = tr.dataset.href; });
  });

  /* ============================================================ the team */
  let team = null;
  async function drawTeam(q) {
    const W = ws();
    if (!canTeam()) return W.denied();
    readQ(q);
    W.setBand("Kỹ thuật viên", "Việc đang làm, ca trong tháng, QC trả về" + (can("techpay.manage") ? " và tiền công" : ""));
    W.show("p-tech", true);
    const host = $("p-tech");
    host.innerHTML = tools("tm") + `<div id="tmBody">${D8.skel.card(5)}</div>`;
    wireTools("tm", load);
    W.show("p-tech");
    await load();
    async function load() {
      const body = $("tmBody");
      if (!body) return;
      body.classList.add("is-stale");
      try { team = await api(`/api/tech?month=${S.month}&basis=${S.basis}`); } catch (err) { body.classList.remove("is-stale"); return fail(body, err); }
      if (!$("tmBody")) return;
      body.classList.remove("is-stale");
      renderTeam();
    }
  }
  function teamRows(d) {
    const open = new Map(d.open.map((x) => [x.email, x])), mon = new Map(d.rows.map((x) => [x.email, x]));
    const emails = new Set([...ws().team().filter((t) => t.design && !t.owner).map((t) => t.email), ...mon.keys(), ...open.keys()]);
    return [...emails].map((e) => ({ email: e, name: nameOf(e), o: open.get(e) || {}, r: mon.get(e) || {} }))
      .sort((a, b) => (b.o.n || 0) - (a.o.n || 0) || (b.r.n || 0) - (a.r.n || 0) || a.name.localeCompare(b.name, "vi"));
  }
  function renderTeam() {
    const d = team, body = $("tmBody"), rows = teamRows(d), pay = d.pay;
    const t = rows.reduce((a, x) => ({ open: a.open + (x.o.n || 0), late: a.late + (x.o.late || 0), n: a.n + (x.r.n || 0), u: a.u + (x.r.u || 0), fo: a.fo + (x.r.fo || 0), rd: a.rd + (x.r.rd || 0) }), { open: 0, late: 0, n: 0, u: 0, fo: 0, rd: 0 });
    const busy = rows.filter((x) => x.o.n).length;
    body.innerHTML = `<div class="kpis kpis-lg">
        <div class="kpi"><span>Đang làm</span><b>${t.open}</b><small>${busy} KTV có việc${t.late ? ` · <span class="late">${t.late} quá hạn</span>` : ""}</small></div>
        <div class="kpi"><span>Chưa giao KTV</span><b>${d.unassigned}</b><small>đơn đang mở</small></div>
        <div class="kpi"><span>Ca ${S.basis === "delivered" ? "giao" : "nhận"} tháng ${monthLabel(S.month)}</span><b>${t.n}</b><small>${num(t.u)} đơn vị</small></div>
        <div class="kpi"><span>QC trả về</span><b>${pct(t.fo, t.n)}</b><small>${t.fo} / ${t.n} ca · ${t.rd} bị làm lại</small></div>
        ${pay ? `<div class="kpi"><span>Tiền công tháng</span><b>${esc(payText(sumPay(rows.map((x) => x.r))))}</b></div>` : ""}</div>
      <section class="card"><div class="card-head-row"><h2 class="h-caps">Từng KTV</h2><span class="chip">${rows.length} KTV</span></div>
        ${rows.length ? `<div class="tbl-wrap o-tbl-wrap"><table class="tbl o-tbl t-tbl"><thead><tr><th>KTV</th><th class="num">Đang làm</th><th class="num">Ca trong tháng</th><th class="num">Đơn vị</th><th class="num">QC trả về</th><th class="num">Bị làm lại</th>${pay ? '<th class="num">Tiền công</th>' : ""}</tr></thead>
        <tbody>${rows.map((x) => { const h = "#team/" + encodeURIComponent(x.email); return `<tr data-href="${h}" tabindex="0">
          <td class="o-code"><a href="${h}">${esc(x.name)}</a><small>${esc(x.email)}</small></td>
          <td class="num" data-l="Đang làm">${x.o.n || 0}${x.o.late ? `<small class="late">${x.o.late} quá hạn</small>` : ""}</td>
          <td class="num" data-l="Ca trong tháng">${x.r.n || 0}</td>
          <td class="num" data-l="Đơn vị">${num(x.r.u)}</td>
          <td class="num" data-l="QC trả về">${x.r.fo || 0}<small>${pct(x.r.fo, x.r.n)}</small></td>
          <td class="num" data-l="Bị làm lại">${x.r.rd || 0}</td>
          ${pay ? `<td class="num" data-l="Tiền công">${x.r.k ? esc(money(x.r.k, x.r.kc)) : "—"}</td>` : ""}</tr>`; }).join("")}</tbody></table></div>`
          : `<p class="muted">Chưa có KTV. Thêm KTV ở <a href="#staff">Nhân sự & phân quyền</a> với vai trò “Kỹ thuật viên thiết kế”.</p>`}</section>
      <p class="hint">“QC trả về”: số ca bị QC trả sửa ít nhất một lần. “Bị làm lại”: ca của KTV đó sau này phải làm lại (có mã R). Tiền công = số lượng × giá công của KTV, đặt ở <a href="#catalog">Mã hàng &amp; bảng giá</a>.</p>`;
    clickRows(body);
    $("tmX").innerHTML = pay && rows.some((x) => x.r.n) ? `<button class="btn small" type="button" id="tmExport">${XL}Xuất phiếu công tháng ${monthLabel(S.month)}</button>` : "";
    const ex = $("tmExport");
    if (ex) ex.addEventListener("click", async () => {
      D8.busy(ex, true);
      try { await exportAll(rows.filter((x) => x.r.n)); } catch (err) { D8.toast(err.message); }
      D8.busy(ex, false);
    });
  }

  /* ============================================================ one KTV */
  async function drawTech(email, self, q) {
    const W = ws(), boss = canTeam();
    if (!email || (!boss && !self) || (self && !can("cases.design"))) return W.denied();
    readQ(q);
    const name = nameOf(email);
    if (self) W.setBand("Công của tôi", "Ca đang làm, ca trong tháng, QC trả về" + (can("techpay.own") ? " và tiền công" : ""));
    else W.setBand(name, email, { back: true, backHref: "#team", backText: "Kỹ thuật viên" });
    W.show("p-tech", true);
    const host = $("p-tech");
    host.innerHTML = tools("tk") + `<div id="tkBody">${D8.skel.card(4)}${D8.skel.card(5)}</div>`;
    wireTools("tk", load);
    W.show("p-tech");
    await load();
    async function load() {
      const body = $("tkBody");
      if (!body) return;
      body.classList.add("is-stale");
      let d;
      try { d = await api(`/api/tech/${encodeURIComponent(email)}?month=${S.month}&basis=${S.basis}`); } catch (err) { body.classList.remove("is-stale"); return fail(body, err); }
      if (!$("tkBody")) return;
      body.classList.remove("is-stale");
      renderTech(d, name, self);
    }
  }
  function monthSum(orders) {
    return orders.reduce((a, o) => ({ n: a.n + 1, u: a.u + (o.units || 0), f: a.f + (o.qc_fails || 0), fo: a.fo + (o.qc_fails > 0 ? 1 : 0), rd: a.rd + (o.redone ? 1 : 0), r: a.r + (o.kind === "redo" ? 1 : 0) }), { n: 0, u: 0, f: 0, fo: 0, rd: 0, r: 0 });
  }
  function renderTech(d, name, self) {
    const body = $("tkBody"), pay = d.pay, now = Date.now();
    const t = monthSum(d.orders), payBy = sumPay(d.orders), late = d.open.filter((o) => o.due_at && o.due_at < now).length;
    const mine = d.open.filter((o) => ["new", "design", "fix", "revise"].includes(o.status)).length;
    // the last 12 months, empty months included
    const keys = []; for (let k = 11; k >= 0; k--) keys.push(shift(d.month, -k));
    const byM = new Map(d.months.map((x) => [x.m, x]));
    const series = keys.map((k) => byM.get(k) || { m: k, n: 0, u: 0, fo: 0, rd: 0, k: 0 });
    const orderRow = (o, open) => `<tr data-href="#orders/${o.id}" tabindex="0">
        <td class="o-code"><a href="#orders/${o.id}">${esc(o.code)}</a>${o.kind !== "new" ? `<span class="okind okind-${esc(o.kind)}">${esc(KIND[o.kind] || o.kind)}</span>` : ""}</td>
        <td data-l="Ngày nhận">${esc(fmtDay(o.day))}${open && o.due_at ? `<small class="${o.due_at < now ? "late" : ""}">hạn ${esc(D8.fmtDate(o.due_at, true))}</small>` : ""}</td>
        ${open ? "" : `<td data-l="Ngày giao">${esc(fmtDay(o.dday)) || "—"}</td>`}
        <td data-l="Bệnh nhân">${esc(o.patient || "—")}${o.doctor ? `<small>${esc(o.doctor)}</small>` : ""}</td>
        <td data-l="Hạng mục">${esc(o.items_text || "—")}</td>
        ${open ? `<td data-l="Trạng thái">${D8.ostChip(o.status)}</td>` : `<td class="num" data-l="Đơn vị">${num(o.units)}</td>
        <td class="num" data-l="QC trả về">${o.qc_fails ? `<span class="late">${o.qc_fails} lần</span>` : "—"}</td>
        <td data-l="Bị làm lại">${o.redone ? '<span class="late">Có</span>' : "—"}</td>
        ${pay ? `<td class="num" data-l="Tiền công">${o.tech_cost ? esc(money(o.tech_cost, o.tech_currency)) : "—"}</td>` : ""}`}</tr>`;
    body.innerHTML = `<div class="kpis kpis-lg">
        <div class="kpi"><span>Đang làm</span><b>${d.open.length}</b><small>${mine} cần KTV xử lý${late ? ` · <span class="late">${late} quá hạn</span>` : ""}</small></div>
        <div class="kpi"><span>Ca ${S.basis === "delivered" ? "giao" : "nhận"} tháng ${monthLabel(d.month)}</span><b>${t.n}</b><small>${num(t.u)} đơn vị${t.r ? " · " + t.r + " ca làm lại" : ""}</small></div>
        <div class="kpi"><span>QC trả về</span><b>${pct(t.fo, t.n)}</b><small>${t.fo} ca · ${t.f} lần</small></div>
        <div class="kpi"><span>Bị làm lại</span><b>${t.rd}</b><small>${pct(t.rd, t.n)} số ca</small></div>
        ${pay ? `<div class="kpi"><span>Tiền công tháng</span><b>${esc(payText(payBy))}</b></div>` : ""}</div>
      <section class="card"><div class="card-head-row"><h2 class="h-caps">Đang làm</h2><span class="chip">${d.open.length} đơn</span></div>
        ${d.open.length ? `<div class="tbl-wrap o-tbl-wrap"><table class="tbl o-tbl t-tbl"><thead><tr><th>Mã đơn</th><th>Ngày nhận</th><th>Bệnh nhân</th><th>Hạng mục</th><th>Trạng thái</th></tr></thead>
          <tbody>${d.open.map((o) => orderRow(o, true)).join("")}</tbody></table></div>` : '<p class="muted">Không có đơn đang làm.</p>'}</section>
      <section class="card"><div class="card-head-row"><h2 class="h-caps">12 tháng gần nhất</h2></div><div id="tkChart"></div>
        <div class="tbl-wrap"><table class="tbl t-months"><thead><tr><th>Tháng</th><th class="num">Ca</th><th class="num">Đơn vị</th><th class="num">QC trả về</th><th class="num">Bị làm lại</th>${pay ? '<th class="num">Tiền công</th>' : ""}</tr></thead>
          <tbody>${[...series].reverse().filter((x) => x.n || x.m === d.month).map((x) => `<tr class="${x.m === d.month ? "on" : ""}"><td><button class="linkish" type="button" data-pick="${x.m}">Tháng ${monthLabel(x.m)}</button></td><td class="num">${x.n || 0}</td><td class="num">${num(x.u)}</td><td class="num">${x.fo || 0} <span class="muted">${pct(x.fo, x.n)}</span></td><td class="num">${x.rd || 0}</td>${pay ? `<td class="num">${x.k ? esc(money(x.k, x.kc)) : "—"}</td>` : ""}</tr>`).join("")}</tbody></table></div></section>
      <section class="card"><div class="card-head-row"><h2 class="h-caps">Ca ${S.basis === "delivered" ? "giao" : "nhận"} tháng ${monthLabel(d.month)}</h2><span class="chip">${t.n} ca · ${num(t.u)} đơn vị</span></div>
        ${d.orders.length ? `<div class="tbl-wrap o-tbl-wrap"><table class="tbl o-tbl t-tbl"><thead><tr><th>Mã đơn</th><th>Ngày nhận</th><th>Ngày giao</th><th>Bệnh nhân</th><th>Hạng mục</th><th class="num">Đơn vị</th><th class="num">QC trả về</th><th>Bị làm lại</th>${pay ? '<th class="num">Tiền công</th>' : ""}</tr></thead>
          <tbody>${d.orders.map((o) => orderRow(o, false)).join("")}</tbody>
          <tfoot><tr><td colspan="5">Tổng ${t.n} ca</td><td class="num" data-l="Đơn vị">${num(t.u)}</td><td class="num" data-l="QC trả về">${t.fo} ca</td><td data-l="Bị làm lại">${t.rd || "—"}</td>${pay ? `<td class="num" data-l="Tiền công">${esc(payText(payBy))}</td>` : ""}</tr></tfoot></table></div>` : '<p class="muted">Không có ca trong tháng này.</p>'}</section>
      ${d.products.length ? `<section class="card"><h2 class="h-caps">Theo mã hàng (tháng ${monthLabel(d.month)})</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mã hàng</th><th class="num">Số lượng</th><th class="num">Số ca</th></tr></thead>
        <tbody>${d.products.map((x) => `<tr><td><b>${esc(x.code)}</b> <span class="muted">${esc(x.name || "")}</span></td><td class="num">${num(x.q)}</td><td class="num">${x.n}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      ${self && !pay ? '<p class="hint">Tiền công chỉ hiện khi quản trị bật quyền “Xem tiền công của chính mình”.</p>' : ""}`;
    clickRows(body);
    body.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => { const sel = $("tkMon"); if (!sel.querySelector(`option[value="${b.dataset.pick}"]`)) return; sel.value = b.dataset.pick; sel.dispatchEvent(new Event("change")); }));
    if (D8.columnChart) D8.columnChart($("tkChart"), { title: "Số ca theo tháng", int: true, labels: series.map((x) => x.m.slice(5, 7) + "/" + x.m.slice(2, 4)), longLabels: series.map((x) => "Tháng " + monthLabel(x.m)),
      fmt: (v) => v + " ca", series: [{ name: "Số ca", color: "--viz-1", values: series.map((x) => x.n || 0) }] });
    $("tkX").innerHTML = pay && d.orders.length ? `<button class="btn small" type="button" id="tkExport">${XL}Xuất phiếu công tháng ${monthLabel(d.month)}</button>` : "";
    const ex = $("tkExport");
    if (ex) ex.addEventListener("click", async () => {
      D8.busy(ex, true);
      try { await D8X.write(slip(d, name), fileName(name, d.month)); } catch (err) { D8.toast(err.message); }
      D8.busy(ex, false);
    });
  }

  /* ============================================================ pay slips (Excel) */
  const fileName = (name, month) => "D8-phieu-cong-" + String(name || "ktv").replace(/\s+/g, "-") + "-" + month + ".xlsx";
  const payType = (cur) => (cur === "USD" ? "usd" : "vnd");
  function detailSheet(sheetName, d) {
    const cur = (d.orders.find((o) => o.tech_currency) || {}).tech_currency || "VND";
    return { name: sheetName, cols: [{ h: "Mã đơn", w: 15 }, { h: "Ngày nhận", t: "d", w: 12 }, { h: "Ngày giao", t: "d", w: 12 }, { h: "Bác sĩ", w: 18 }, { h: "Bệnh nhân", w: 22 },
      { h: "Hạng mục", w: 26 }, { h: "Đơn vị", t: "n", w: 9 }, { h: "Loại", w: 10 }, { h: "QC trả về (lần)", t: "i", w: 10 }, { h: "Bị làm lại", w: 10 }, { h: "Tiền công", t: payType(cur), w: 14 }, { h: "Tiền tệ", w: 8 }],
      rows: d.orders.map((o) => [o.code, o.day, o.dday || "", o.doctor, o.patient, o.items_text, o.units, KIND[o.kind] || o.kind, o.qc_fails || 0, o.redone ? "Có" : "", o.tech_cost || 0, o.tech_currency || cur]),
      sum: [6, 8, 10], sumLabel: "Tổng" };
  }
  function slip(d, name) {
    const t = monthSum(d.orders), by = sumPay(d.orders);
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    return [
      { name: "Phiếu công", filter: false, cols: [{ h: "Phiếu công tháng " + monthLabel(d.month), w: 30 }, { h: "", t: "n", w: 34 }],
        rows: [["Kỹ thuật viên", name], ["Email", d.email], ["Tháng", monthLabel(d.month)], ["Tính theo", BASIS[d.basis] + " trong tháng"], ["Số ca", t.n], ["Số đơn vị", Math.round(t.u * 100) / 100],
          ["Ca làm lại (mã R) đã làm", t.r], ["Ca bị QC trả về", t.fo], ["Số lần QC trả về", t.f], ["Ca bị làm lại sau đó", t.rd],
          ...Object.entries(by).map(([c, v]) => ["Tổng tiền công (" + c + ")", { v, t: payType(c) }]), ...(Object.keys(by).length ? [] : [["Tổng tiền công", 0]]),
          ["Ngày xuất phiếu", fmtDay(today)], ["", ""], ["Ghi chú", "Tiền công = số lượng × giá công theo mã hàng. Chi tiết từng ca ở sheet “Chi tiết ca”."]] },
      detailSheet("Chi tiết ca", d),
      { name: "Theo mã hàng", cols: [{ h: "Mã hàng", w: 12 }, { h: "Tên hàng", w: 34 }, { h: "Số lượng", t: "n", w: 10 }, { h: "Số ca", t: "i", w: 9 }],
        rows: d.products.map((x) => [x.code, x.name, x.q, x.n]), sum: [2, 3] },
    ];
  }
  async function exportAll(rows) {
    const details = [];
    for (const x of rows) details.push({ x, d: await api(`/api/tech/${encodeURIComponent(x.email)}?month=${S.month}&basis=${S.basis}`) });
    const sheets = [{ name: "Tổng hợp", cols: [{ h: "KTV", w: 22 }, { h: "Email", w: 28 }, { h: "Số ca", t: "i", w: 9 }, { h: "Đơn vị", t: "n", w: 9 }, { h: "Ca bị QC trả về", t: "i", w: 12 },
      { h: "Ca bị làm lại", t: "i", w: 12 }, { h: "Tiền công", t: "n", w: 15 }, { h: "Tiền tệ", w: 8 }],
      rows: details.map(({ x, d }) => { const t = monthSum(d.orders), by = sumPay(d.orders), c = Object.keys(by)[0] || "VND"; return [x.name, x.email, t.n, Math.round(t.u * 100) / 100, t.fo, t.rd, by[c] || 0, c]; }),
      sum: [2, 3, 4, 5, 6] }];
    details.forEach(({ x, d }) => sheets.push(detailSheet(x.name, d)));
    await D8X.write(sheets, fileName("tat-ca-KTV", S.month));
  }

  /* ------------------------------------------------------------ routes */
  D8.wsRoutes.push(
    { re: /^team$/, fn: (m, q) => drawTeam(q) },
    { re: /^team\/([^/?]+)$/, fn: (m, q) => { let e = ""; try { e = decodeURIComponent(m[1]).toLowerCase(); } catch {} const me = (D8.user && D8.user.email) || ""; return drawTech(e, !!me && e === me && !canTeam(), q); } },
    { re: /^me$/, fn: (m, q) => drawTech((D8.user && D8.user.email) || "", true, q) },
  );
})();
