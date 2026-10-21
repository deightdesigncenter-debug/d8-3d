p='/home/claude/d8-3d/public/admin.js'; s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a[:80], s.count(a))
    s=s.replace(a,b)

# config: database + online payment
rep('''  let payCfg = {};
  D8.config().then((c) => { payCfg = (c && c.pay) || {}; });''','''  let payCfg = {}, dbOn = false;
  D8.config().then((c) => { payCfg = (c && c.pay) || {}; dbOn = !!(c && c.db); });
  const payOnline = () => !!(payCfg.paypal || payCfg.stripe);''')

# bands
rep('''    jobs: ["Ca hàng", "Ca khách gửi qua cổng khách hàng"],''','''    jobs: ["Ca cổng khách", "Ca khách gửi qua cổng khách hàng (cũng có trong Đơn hàng)"],''')

# helpers for the other workspace modules
rep('''  let animKey = null; // fade a screen in once per route, not on every refresh''','''  // shared with orders.js / books.js / snap.js
  D8.wsRoutes = D8.wsRoutes || [];
  D8.ws = {
    show: (id, loading) => show(id, loading), setBand: (t, s, o) => setBand(t, s, o), armed: (b, fn) => armed(b, fn),
    team: () => team, teamName: (e) => teamName(e), loadTeam: () => loadTeam(), mode: () => mode,
    denied: () => { setBand(...BANDS.denied); show("p-denied"); }, setNavCount: (h, n) => setNavCount(h, n),
    createLink: (f, label, days, onProgress, og) => createLink(f, label, days, onProgress, og),
    legacyCustomers: () => { setBand(...BANDS.customers); show("p-customers"); $("p-customers").innerHTML = legacyCustomersHtml; loadCustomers(); },
  };
  let legacyCustomersHtml = "";
  let animKey = null; // fade a screen in once per route, not on every refresh''')

# router: modules first
rep('''    const denied = () => { setBand(...BANDS.denied); show("p-denied"); };
    if ((m = h.match(/^jobs\\/(.+)$/)) && ID_RE.test(m[1])) return openCase(m[1]);
    current = null;''','''    const denied = () => { setBand(...BANDS.denied); show("p-denied"); };
    if ((m = h.match(/^jobs\\/(.+)$/)) && ID_RE.test(m[1])) return openCase(m[1]);
    current = null;
    const qi = h.indexOf("?"), hp = qi < 0 ? h : h.slice(0, qi), hq = new URLSearchParams(qi < 0 ? "" : h.slice(qi + 1));
    for (const r of D8.wsRoutes) { const mm = hp.match(r.re); if (mm) { if (dbOn && D8.refreshOrderBadge) D8.refreshOrderBadge(); return r.fn(mm, hq); } }''')
rep('''    if (h === "prices") { if (!can("pricing.manage")) return denied(); show("p-prices"); return drawPrices(); }
''','')
rep('''    show("p-home");
    drawHome();
    loadJobs(false, 30000);
  }
  window.addEventListener("hashchange", route);''','''    show("p-home");
    drawHome();
    loadJobs(false, 30000);
    if (dbOn && D8.refreshOrderBadge) D8.refreshOrderBadge();
  }
  window.addEventListener("hashchange", route);''')
rep('''    ["jobCsv", "custCsv", "msgCsv"].forEach((id) => { $(id).hidden = !can("export.csv"); });
    await loadTeam();''','''    ["jobCsv", "msgCsv"].forEach((id) => { $(id).hidden = !can("export.csv"); });
    legacyCustomersHtml = $("p-customers").innerHTML;
    await Promise.all([loadTeam(), D8.config()]);''')
rep('''    setInterval(() => { if (!document.hidden && !busy && (!$("p-jobs").hidden || !$("p-home").hidden)) loadJobs(true); }, 300000);''','''    setInterval(() => { if (!document.hidden && !busy && (!$("p-jobs").hidden || !$("p-home").hidden)) loadJobs(true); }, 300000);
    setInterval(() => { if (!document.hidden && dbOn && D8.refreshOrderBadge) D8.refreshOrderBadge(); }, 60000);''')

# legacy customers code reads elements that may be rebuilt
rep('''  function drawCustomers() {
    const q = $("custQ").value.toLowerCase();''','''  function drawCustomers() {
    if (!$("custQ")) return;
    const q = $("custQ").value.toLowerCase();''')
rep('''  $("custQ").addEventListener("input", drawCustomers);''','''  document.addEventListener("input", (e) => { if (e.target && e.target.id === "custQ" && !$("cuQ")) drawCustomers(); });''')
rep('''  $("custCsv").addEventListener("click", () => {''','''  document.addEventListener("click", (e) => { if (e.target && e.target.id === "custCsv") custCsv(); });
  const custCsv = () => {''')
rep('''      ...users.map((u) => [u.name, u.email, u.practice, u.country, u.phone, per[u.email] || 0, u.created ? new Date(u.created).toLocaleString("vi-VN") : "", u.last ? new Date(u.last).toLocaleString("vi-VN") : ""])]);
  });''','''      ...users.map((u) => [u.name, u.email, u.practice, u.country, u.phone, per[u.email] || 0, u.created ? new Date(u.created).toLocaleString("vi-VN") : "", u.last ? new Date(u.last).toLocaleString("vi-VN") : ""])]);
  };''')
rep('''  async function loadCustomers() {
    if (!users.length) $("custBody").innerHTML = D8.skel.tableRows(7, 4);''','''  async function loadCustomers() {
    if (!users.length && $("custBody")) $("custBody").innerHTML = D8.skel.tableRows(7, 4);''')
rep('''    } catch (err) { $("custErr").textContent = err.message; $("custErr").hidden = false; }
  }
  function drawCustomers() {''','''    } catch (err) { if ($("custErr")) { $("custErr").textContent = err.message; $("custErr").hidden = false; } }
  }
  function drawCustomers() {''')

# dashboard: orders first when the database is on
rep('''  function drawHome() {
    const host = $("dash");
    const u = D8.user;
    setBand("Xin chào" + (u && u.name ? ", " + u.name : ""), u ? (u.roleLabel || "") + " · việc cần làm hôm nay" : "Việc cần làm hôm nay");
    if (!jobsAt && !jobs.length) { host.innerHTML = D8.skel.card(4) + D8.skel.card(4) + D8.skel.card(4); return; }''','''  let dashBusy = false;
  function drawHome() {
    const host = $("dash");
    const u = D8.user;
    setBand("Xin chào" + (u && u.name ? ", " + u.name : ""), u ? (u.roleLabel || "") + " · việc cần làm hôm nay" : "Việc cần làm hôm nay",
      { right: dbOn && can("orders.edit") ? '<div class="band-btns"><a class="btn btn-cream small" href="#orders/new">+ Đơn mới</a><a class="btn btn-light small" href="#orders">Tìm đơn</a></div>' : "" });
    if (dbOn && D8.ordersDash) {
      if (!host.dataset.dash) host.innerHTML = D8.skel.card(4) + D8.skel.card(4) + D8.skel.card(4);
      if (dashBusy) return;
      dashBusy = true;
      const seen = adminSeen();
      const portal = [];
      const row = (x) => `<li><a href="#jobs/${esc(x.id)}"><span class="t">${esc(x.order || x.id)} · ${esc(x.title)}</span><span class="i">${esc(x.ownerName || "")}</span><span class="a">${esc(D8.ago(x.updated))}</span></a></li>`;
      const pcard = (title, list, empty) => `<section class="card"><div class="dash-h"><h2 class="h-caps">${esc(title)}</h2><b>${list.length}</b></div>${list.length ? `<ul>${list.slice(0, 6).map(row).join("")}</ul>` : `<p class="none">${esc(empty)}</p>`}</section>`;
      if (can("cases.chat_read")) portal.push(pcard("Khách vừa nhắn (cổng khách)", jobs.filter((x) => needsReply(x, seen)), "Không có tin nhắn mới của khách."));
      if (can("billing.edit") && payOnline()) portal.push(pcard("Thanh toán online chờ xác nhận", jobs.filter((x) => x.pay === "check"), "Không có khoản nào chờ xác nhận."));
      if (can("messages.view")) { const unread = messages.filter((x) => !seenMsgs.has(x.id)).length; portal.push(`<section class="card"><div class="dash-h"><h2 class="h-caps">Tin nhắn từ trang web</h2><b>${unread}</b></div><p class="none">${unread ? "Có tin nhắn mới chưa đọc." : "Không có tin nhắn mới."} <a href="#messages">Mở hộp thư</a></p></section>`); }
      D8.ordersDash(host, portal.join("")).then((ok) => { host.dataset.dash = "1"; dashBusy = false; if (!ok) { dbOn = false; drawHome(); } })
        .catch((err) => { dashBusy = false; host.innerHTML = `<p class="error">${esc(err.message)}</p>`; });
      return;
    }
    if (!jobsAt && !jobs.length) { host.innerHTML = D8.skel.card(4) + D8.skel.card(4) + D8.skel.card(4); return; }''')

# case page: order card + team chat by order code; billing only with online payment (or no database)
rep('''    // billing
    let billing = "";
    if (can("billing.view") && "pay" in j) {''','''    // billing (with the order book on, money lives in the order; this card is for online payment)
    let billing = "";
    const orderCard = j.orderId && dbOn ? `<section class="card" id="jobOrder"><div class="card-head-row"><h2 class="h-caps">Đơn hàng</h2><a class="btn small" href="#orders/${esc(j.orderId)}">Mở đơn</a></div>
      <p class="job-ocode">${esc(j.order || "")}</p><div id="jobOrderBody"><p class="muted" style="margin:0">Đang tải…</p></div></section>` : "";
    if (can("billing.view") && "pay" in j && (!dbOn || payOnline() || ["due", "check"].includes(j.pay))) {''')
rep('''      ${can("cases.notes") ? `<form class="compose" id="teamForm" style="margin-top:18px"><label class="field-label" for="teamBox">Ghi chú nội bộ</label>''','''      ${can("cases.notes") && j.orderId && dbOn ? `<div style="margin-top:18px"><span class="field-label">Chat nội bộ · ${esc(j.order || "")}</span><div id="jobChat"></div></div>` : can("cases.notes") ? `<form class="compose" id="teamForm" style="margin-top:18px"><label class="field-label" for="teamBox">Ghi chú nội bộ</label>''')
rep('''          ${billing}</aside>
      </div>`;''','''          ${orderCard}${billing}</aside>
      </div>`;''')
rep('''    const th = $("thread");
    if (th) { th.scrollTop = th.scrollHeight; D8.wireThread(th, j, "vi"); }
    wireCase(j);''','''    const th = $("thread");
    if (th) { th.scrollTop = th.scrollHeight; D8.wireThread(th, j, "vi"); }
    if ($("jobChat") && D8.orderChat) D8.orderChat($("jobChat"), j.orderId);
    if ($("jobOrderBody")) api("/api/orders/" + j.orderId).then((d) => {
      const o = d.order, box = $("jobOrderBody"); if (!box || !current || current.id !== j.id) return;
      box.innerHTML = `<dl class="dl"><div><dt>Khách</dt><dd>${esc(o.customer_code + " — " + o.customer_name)}</dd></div><div><dt>Hạng mục</dt><dd>${esc(o.items_text || "Chưa có")}</dd></div>
        ${"total" in o ? `<div><dt>Thành tiền</dt><dd>${esc(D8.fmtMoney(o.total, o.currency))}</dd></div><div><dt>Còn nợ</dt><dd>${esc(D8.fmtMoney(o.due, o.currency))}</dd></div>` : ""}</dl>
        ${can("orders.edit") || can("billing.edit") ? `<p class="hint"><a href="#orders/${o.id}/edit">Thêm hạng mục, sửa giá ›</a></p>` : ""}`;
    }).catch((err) => { const box = $("jobOrderBody"); if (box) box.innerHTML = `<p class="hint">${esc(err.message)}</p>`; });
    wireCase(j);''')

# 3D links: preview title / description / order, then a preview picture
rep('''  async function createLink(f, label, days, onProgress) {''','''  async function createLink(f, label, days, onProgress, og = {}) {''')
rep('''      "X-Original-Size": String(prepared.size), "Content-Type": "application/octet-stream",
    }''','''      "X-Original-Size": String(prepared.size), "Content-Type": "application/octet-stream",
      "X-OG-Title": encodeURIComponent(og.title || ""), "X-OG-Desc": encodeURIComponent(og.desc || ""), "X-Order-Id": String(og.orderId || 0),
    }''')
rep('''    try {
      const data = await createLink(file, $("label").value.trim(), selectedDays(), setProgress);
      pending.set(data.id, data);
      showResult(data);
      resetForm();
      refreshList();''','''    try {
      const used = file, ord = linkOrder;
      const data = await createLink(file, $("label").value.trim(), selectedDays(), setProgress, { title: $("label").value.trim(), desc: $("ogDesc") ? $("ogDesc").value.trim() : "", orderId: ord ? ord.id : 0 });
      pending.set(data.id, data);
      showResult(data);
      resetForm();
      refreshList();
      if (ord) api(`/api/orders/${ord.id}/previews`, { method: "POST", body: { linkId: data.id } }).then(() => D8.toast("Đã gắn link vào đơn " + ord.code + ".")).catch((e) => D8.toast(e.message));
      snapFor(used, data);''')
rep('''  function resetForm(keepLabel) {
    file = null;
    $("file").value = "";
    if (!keepLabel) $("label").value = "";''','''  function resetForm(keepLabel) {
    file = null;
    $("file").value = "";
    if (!keepLabel) { $("label").value = ""; if ($("ogDesc")) $("ogDesc").value = ""; if ($("ogOrder")) $("ogOrder").value = ""; linkOrder = null; if ($("ogOrderHint")) $("ogOrderHint").textContent = ""; }''')
rep('''  function messageEn(item) {''','''  // preview picture for chat apps: capture the design, frame it, upload it
  let snapCtl = null, linkOrder = null;
  async function snapFor(f, item) {
    if (!D8.snap || !$("snapBox")) return;
    if (snapCtl) { snapCtl.destroy(); snapCtl = null; }
    const box = $("snapBox"), say = (t) => { $("snapSay").textContent = t; };
    box.hidden = false; $("snapStage").innerHTML = ""; $("snapImg").src = "/og/" + item.id + ".jpg";
    $("snapT").textContent = item.title || item.label || "3D design preview"; $("snapD").textContent = item.desc || "D.EIGHT DESIGN CENTER";
    const put = async (url) => {
      const blob = await D8.snap.compose(url);
      $("snapImg").src = URL.createObjectURL(blob);
      const r = await fetch(`/api/cases/${item.id}/og`, { method: "PUT", headers: { ...D8.authHeaders(), "Content-Type": "image/jpeg" }, body: blob, credentials: "same-origin" });
      if (!r.ok) throw new Error("Không lưu được ảnh xem trước.");
    };
    say("Đang mở thiết kế để chụp ảnh xem trước…");
    $("snapTake").disabled = true;
    const ctl = snapCtl = D8.snap.open(f, $("snapStage"));
    $("snapTake").onclick = async (e) => { const b = e.currentTarget; D8.busy(b, true); try { const s = await ctl.capture(); if (!s.url) throw new Error("Không chụp được."); await put(s.url); D8.done(b, "Đã lưu ảnh"); say("Đã lưu ảnh xem trước theo góc này."); } catch (ex) { D8.busy(b, false); D8.toast(ex.message); } };
    $("snapDef").onclick = async (e) => { const b = e.currentTarget; D8.busy(b, true); try { await put(""); D8.done(b, "Đã dùng"); say("Đang dùng ảnh mặc định của D.EIGHT."); } catch (ex) { D8.busy(b, false); D8.toast(ex.message); } };
    try {
      const r = await ctl.ready;
      if (snapCtl !== ctl) return;
      if (!r.exocad) { await put(""); say("Không phải bản xem trước exocad: dùng ảnh mặc định."); return; }
      const s = await ctl.capture();
      await put(s.url || "");
      $("snapTake").disabled = false;
      say(s.url ? "Đã lưu ảnh xem trước. Muốn góc khác: xoay mô hình trong khung rồi bấm Chụp góc này." : "Không chụp được 3D, đang dùng ảnh mặc định.");
    } catch (ex) { say(ex.message); }
  }
  if ($("ogOrder")) $("ogOrder").addEventListener("change", async () => {
    const code = $("ogOrder").value.trim(); linkOrder = null; $("ogOrderHint").textContent = "";
    if (!code) return;
    try {
      const d = await api("/api/orders?status=&limit=5&q=" + encodeURIComponent(code));
      const o = d.items.find((x) => x.code === code) || d.items[0];
      if (!o) { $("ogOrderHint").textContent = "Không tìm thấy đơn này."; return; }
      linkOrder = o;
      const t = D8.ogText(o, (o.previews || []).length, true);
      $("label").value = t.title; $("ogDesc").value = t.desc;
      $("ogOrderHint").textContent = "Đơn " + o.code + " · " + o.customer_name + (o.patient ? " · " + o.patient : "");
    } catch (err) { $("ogOrderHint").textContent = err.message; }
  });
  function messageEn(item) {''', 1)
rep('''  function messageEn(item) {
    const what = item.label ? item.label : "your case";''','''  function messageEn(item) {
    const what = item.title || item.label || "your case";''')
rep('''  function messageVi(item) {
    const what = item.label ? item.label : "ca của bác sĩ";''','''  function messageVi(item) {
    const what = item.title || item.label || "ca của bác sĩ";''')
open(p,'w').write(s)
print("ok")
