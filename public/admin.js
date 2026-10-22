/* D.EIGHT workspace: dashboard, cases (design → QC → customer), customers and price lists,
   staff and permissions, 3D preview links, contact messages. What each person sees follows their permissions;
   the server checks every permission again. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => D8.esc(s);
  const api = (path, opts) => D8.api(path, opts);
  const KEY_NAME = "d8-upload-key";
  const ID_RE = /^D8-[0-9]{6}-[A-Z2-9]{4}$/;
  const STATUSES = ["received", "needs_info", "in_design", "review", "approved", "delivered", "cancelled"];
  const OPEN = ["received", "needs_info", "in_design", "review", "approved"];
  const STEPS = ["received", "in_design", "review", "approved", "delivered"];
  const ICON = {
    check: '<svg width="12" height="12" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M3 9.5l4 4 8-9"/></svg>',
    cube: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7L12 2.5Z"/><path d="M3.5 7 12 11.5 20.5 7M12 11.5v10"/></svg>',
    dl: '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 2.5v9M5 8l4 4 4-4M3 15.5h12"/></svg>',
    trash: '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 5h12M7 5V3.5h4V5M5 5l.8 10h6.4L13 5"/></svg>',
    up: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    warn: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M10 2.5 18 17H2L10 2.5Z"/><path d="M10 8v4M10 14.5v.5"/></svg>',
    spark: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" style="vertical-align:-2px"><path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6L10 2.5Z"/><path d="M15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/></svg>',
    out: '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M7 3H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M11 5.5 15 9l-4 3.5M15 9H7"/></svg>',
  };
  const stChip = (s) => `<span class="st st-${esc(s)}">${esc(D8.statusLabel(s))}</span>`;
  const money = (n) => "US$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const PAY_LABEL = { "": "Chưa báo giá", trial: "Miễn phí (dùng thử)", due: "Chờ thanh toán", check: "Khách báo đã trả, chờ xác nhận", paid: "Đã thanh toán" };
  const payChip = (x) => (typeof x.price === "number" || ["due", "check", "paid"].includes(x.pay))
    ? `<span class="pay ${["due", "check", "paid"].includes(x.pay) ? "pay-" + x.pay : ""}">${typeof x.price === "number" ? esc(money(x.price)) + " · " : ""}${esc(x.pay === "check" ? "Chờ xác nhận" : PAY_LABEL[x.pay || ""])}</span>` : "";
  const can = (p) => D8.can(p);
  const STAGE = { "": "Chưa giao KTV", design: "Đang thiết kế", qc: "Chờ QC", fix: "QC yêu cầu sửa", ready: "Đã qua QC", done: "Đã giao" };
  const stageChip = (s) => `<span class="stage stage-${esc(s || "none")}">${esc(STAGE[s || ""] || s)}</span>`;
  let team = [];              // staff, for names and assignment lists
  const teamName = (email) => { if (!email) return ""; const t = team.find((x) => x.email === email); return (t && (t.name || t.email.split("@")[0])) || email.split("@")[0]; };
  async function loadTeam() { try { team = (await api("/api/staff/team")).team || []; } catch { team = []; } }
  const myEmail = () => (D8.user && D8.user.email) || "";
  const TRIAL_CREDIT = 50;
  // free-trial credit used by a customer: sum of the prices of their trial cases
  const trialUse = (owner) => {
    const t = jobs.filter((x) => x.owner === owner && x.trial);
    return { cases: t.length, used: t.reduce((s, x) => s + (typeof x.price === "number" ? x.price : 0), 0) };
  };
  function csvDownload(name, rows) {
    const cell = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const blob = new Blob(["\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  const today = () => new Date().toISOString().slice(0, 10);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const clearKey = () => { try { localStorage.removeItem(KEY_NAME); } catch {} try { sessionStorage.removeItem(KEY_NAME); } catch {} };

  let mode = null;            // "google" | "key" once signed in
  let jobs = [], jobFilter = "open", jobQuery = "";
  let users = [];
  let current = null;         // job open in the detail panel
  let busy = false;
  const aiTried = new Set(); // cases whose summary was requested automatically in this visit
  const payChecked = new Set(); // cases whose open payments were checked with PayPal/Stripe in this visit
  let payCfg = {}, dbOn = false;
  D8.config().then((c) => { payCfg = (c && c.pay) || {}; dbOn = !!(c && c.db); });
  const payOnline = () => !!(payCfg.paypal || payCfg.stripe);
  const VIA = { paypal: "PayPal", stripe: "Thẻ (Stripe)", manual: "Chuyển khoản / thủ công", claim: "khách tự chuyển (chuyển khoản / Payoneer…)" };
  let jobWho = "";
  const TRY_STATE = { open: "đang chờ khách trả", held: "PayPal đang giữ tiền để xét duyệt", paid: "đã trả", dead: "đã hủy / hết hạn" };

  /* ------------------------------------------------------------ band + panels */
  const BANDS = {
    jobs: ["Ca cổng khách", "Ca khách gửi qua cổng khách hàng (cũng có trong Đơn hàng)"],
    denied: ["Không có quyền", "Nhờ quản trị cấp thêm quyền"],
    links: ["Link xem 3D", "Gửi bác sĩ xem thiết kế ngay trên trình duyệt"],
    messages: ["Tin nhắn", "Từ mục Liên hệ trên trang web"],
    customers: ["Khách hàng", "Tài khoản đăng nhập bằng Google"],
    gate: ["Workspace", "Khu làm việc của đội D.EIGHT"],
  };
  function setBand(title, sub, opts = {}) {
    $("bandTitle").textContent = title;
    $("bandSub").textContent = sub || "";
    $("bandSub").hidden = !sub;
    $("bandBack").hidden = !opts.back;
    $("bandBack").href = opts.backHref || "#jobs";
    $("bandBack").lastChild.textContent = opts.backText || "Ca hàng";
    $("bandEyebrow").hidden = !!opts.back;
    $("bandRight").innerHTML = opts.right || "";
  }
  // shared with orders.js / books.js / snap.js
  D8.wsRoutes = D8.wsRoutes || [];
  D8.ws = {
    show: (id, loading) => show(id, loading), setBand: (t, s, o) => setBand(t, s, o), armed: (b, fn) => armed(b, fn),
    team: () => team, teamName: (e) => teamName(e), loadTeam: () => loadTeam(), mode: () => mode,
    denied: () => { setBand(...BANDS.denied); show("p-denied"); }, setNavCount: (h, n) => setNavCount(h, n),
    createLink: (f, label, days, onProgress, og) => createLink(f, label, days, onProgress, og),
    legacyCustomers: () => { setBand(...BANDS.customers); show("p-customers"); $("p-customers").innerHTML = legacyCustomersHtml; loadCustomers(); },
  };
  let legacyCustomersHtml = "";
  let animKey = null; // fade a screen in once per route, not on every refresh
  function show(id, isLoading) {
    $("booting").hidden = true;
    document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.id !== id; });
    const key = location.hash || "#home";
    if (!isLoading && key !== animKey) { animKey = key; D8.animIn($(id)); }
  }

  /* ------------------------------------------------------------ sign in */
  async function boot() {
    const u = await D8.ready;
    if (u && u.staff) return enter("google");
    if (D8.adminKey()) {
      try { await api("/api/ping"); return enter("key"); }
      catch (err) { if (err.status === 401) clearKey(); }
    }
    showGate(u);
  }
  function showGate(u) {
    mode = null;
    setBand(...BANDS.gate);
    show("gate");
    // a signed-in customer only gets the website and the customer portal: no sign-in form, just the way back
    $("gateWho").innerHTML = u ? `<p class="who">Bạn đang đăng nhập bằng <b>${esc(u.email)}</b> — tài khoản khách hàng, không vào được khu làm việc. Bạn vẫn dùng trang web và cổng khách hàng như bình thường. Nếu bạn là kỹ thuật viên của D.EIGHT, nhờ quản trị cấp quyền cho email này.</p>
      <div class="who-btns"><a class="btn btn-primary small" href="/">Về trang web</a><a class="btn small" href="/portal">Cổng khách hàng</a><button class="btn small" type="button" id="gateOut">Đăng xuất để đổi tài khoản</button></div>` : "";
    $("gateIn").hidden = !!u;
    $("gateIntro").hidden = !!u;
    $("gateTitle").textContent = u ? "Chỉ dành cho đội D.EIGHT" : "Đăng nhập khu làm việc";
    if (u) $("gateOut").onclick = D8.signOut;
    else D8.renderGoogleButton($("gbtn"), null, { width: 320 });
  }
  document.addEventListener("d8:user", (e) => {
    if (mode || !e.detail) return;
    if (e.detail.staff) enter("google"); else showGate(e.detail);
  });
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("loginError").hidden = true;
    $("loginBtn").disabled = true;
    const k = $("pw").value;
    try { (($("remember").checked) ? localStorage : sessionStorage).setItem(KEY_NAME, k); } catch {}
    try { await api("/api/ping"); enter("key"); }
    catch (err) { clearKey(); $("loginError").textContent = err.message; $("loginError").hidden = false; }
    $("loginBtn").disabled = false;
  });

  async function enter(m) {
    mode = m;
    document.body.dataset.authed = "1";
    document.body.dataset.authMode = m;
    D8.renderHeader();
    ["jobCsv", "msgCsv"].forEach((id) => { $(id).hidden = !can("export.csv"); });
    legacyCustomersHtml = $("p-customers").innerHTML;
    await Promise.all([loadTeam(), D8.config()]);
    route();
    // Each listing is a KV "list" request (1,000 a day on the free plan), so load once and refresh sparingly.
    const h = location.hash.replace(/^#/, "") || "home";
    if (h !== "jobs" && h !== "home") loadJobs(true);
    if (h !== "messages" && can("messages.view")) refreshMessages(true);
    setInterval(() => { if (!document.hidden && !busy && (!$("p-jobs").hidden || !$("p-home").hidden)) loadJobs(true); }, 300000);
    setInterval(() => { if (!document.hidden && dbOn && D8.refreshOrderBadge) D8.refreshOrderBadge(); }, 60000);
  }

  /* ------------------------------------------------------------ router */
  function route() {
    if (!mode) return;
    const h = location.hash.replace(/^#/, "") || "home";
    window.scrollTo(0, 0);
    let m;
    const denied = () => { setBand(...BANDS.denied); show("p-denied"); };
    if ((m = h.match(/^jobs\/(.+)$/)) && ID_RE.test(m[1])) return openCase(m[1]);
    current = null;
    const qi = h.indexOf("?"), hp = qi < 0 ? h : h.slice(0, qi), hq = new URLSearchParams(qi < 0 ? "" : h.slice(qi + 1));
    for (const r of D8.wsRoutes) { const mm = hp.match(r.re); if (mm) { if (dbOn && D8.refreshOrderBadge) D8.refreshOrderBadge(); return r.fn(mm, hq); } }
    if ((m = h.match(/^customers\/(.+)$/))) { let e = ""; try { e = decodeURIComponent(m[1]); } catch {} return can("customers.view") && e ? openCustomer(e) : denied(); }
    if (h === "links") { if (!can("links.manage")) return denied(); setBand(...BANDS.links); show("p-links"); return refreshList(); }
    if (h === "messages") { if (!can("messages.view")) return denied(); setBand(...BANDS.messages); show("p-messages"); return refreshMessages(); }
    if (h === "customers") { if (!can("customers.view")) return denied(); setBand(...BANDS.customers); show("p-customers"); return loadCustomers(); }
    if (h === "staff") { if (!can("staff.manage")) return denied(); show("p-staff"); return drawStaff(); }
    if (h === "jobs") {
      setBand(...BANDS.jobs);
      show("p-jobs");
      drawJobs();
      return loadJobs(false, 30000);
    }
    show("p-home");
    drawHome();
    loadJobs(false, 30000);
    if (dbOn && D8.refreshOrderBadge) D8.refreshOrderBadge();
  }
  window.addEventListener("hashchange", route);

  function setNavCount(href, n) {
    const a = document.querySelector(`#wsNav a[href="${href}"], .sh-sub a[href="${href}"]`);
    if (!a) return;
    let b = a.querySelector(".count");
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("span"); b.className = "count"; a.appendChild(b); }
    b.textContent = n;
  }

  /* ------------------------------------------------------------ case list */
  let jobsAt = 0;
  async function loadJobs(quiet, maxAge) {
    if (maxAge && Date.now() - jobsAt < maxAge) return;
    try {
      jobs = (await api("/api/admin/jobs")).items || [];
      jobsAt = Date.now();
      $("jobErr").hidden = true;
      if (!$("p-jobs").hidden) drawJobs();
      if (!$("p-home").hidden) drawHome();
      updateJobCount();
    } catch (err) { if (!quiet) { $("jobErr").textContent = err.message; $("jobErr").hidden = false; if (!jobsAt) { jobsAt = -1; drawJobs(); if (!$("p-home").hidden) drawHome(); } } }
  }
  const adminSeen = () => store.get("d8-admin-seen", {});
  const needsReply = (x, seen) => x.lastBy === "client" && OPEN.includes(x.status) && (seen[x.id] || 0) < x.updated;
  function updateJobCount() {
    const seen = adminSeen(), me = myEmail();
    // the badge counts what needs this person: customer replies (if they read chat), their design work, QC queue
    setNavCount("/admin#jobs", jobs.filter((x) => (can("cases.chat_read") && needsReply(x, seen)) || (me && x.designer === me && x.stage === "fix") || (can("cases.qc") && x.stage === "qc" && (!x.qcBy || x.qcBy === me))).length);
  }

  function drawJobs() {
    const seen = adminSeen();
    const count = (f) => jobs.filter((x) => (f === "all" ? true : f === "open" ? OPEN.includes(x.status) : x.status === f)).length;
    const filters = [["open", "Đang mở"], ...STATUSES.map((s) => [s, D8.statusLabel(s)]), ["all", "Tất cả"]];
    $("jobFilters").innerHTML = filters.map(([f, l]) => `<button type="button" data-f="${f}" aria-pressed="${jobFilter === f}">${esc(l)}<b>${count(f)}</b></button>`).join("");
    $("jobFilters").querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { jobFilter = b.dataset.f; drawJobs(); }));
    if (!jobsAt && !jobs.length) { $("jobList").innerHTML = D8.skel.rows(4); return; }
    const q = jobQuery.toLowerCase(), me = myEmail();
    const whoOk = (x) => !jobWho || (jobWho === "mine" ? x.designer === me || x.qcBy === me : jobWho === "none" ? !x.designer : jobWho === "qc" ? x.stage === "qc" : jobWho === "ready" ? x.stage === "ready" : jobWho === "check" ? x.pay === "check" : true);
    const shown = jobs.filter((x) => (jobFilter === "all" || (jobFilter === "open" ? OPEN.includes(x.status) : x.status === jobFilter)) && whoOk(x) &&
      (!q || (x.id + " " + x.title + " " + x.owner + " " + (x.ownerName || "")).toLowerCase().includes(q)));
    $("jobList").innerHTML = shown.length ? shown.map((x) => {
      const nr = needsReply(x, seen);
      return `<a class="pt-row" href="#jobs/${esc(x.id)}">
        <div><span class="id">${esc(x.id)}</span><span class="ttl">${esc(x.title)}</span><span class="owner">${esc([x.ownerName, x.owner].filter(Boolean).join(" · "))}</span></div>
        <span class="meta">Gửi ${esc(D8.fmtDate(x.created, true))} · cập nhật ${esc(D8.ago(x.updated))}${x.storedMB ? " · " + x.storedMB + " MB" : ""}</span>
        <span class="right">${stChip(x.status)}${x.stage || OPEN.includes(x.status) ? stageChip(x.stage) : ""}${x.designer ? `<span class="who-chip" title="KTV">✎ ${esc(teamName(x.designer))}</span>` : ""}${x.qcBy ? `<span class="who-chip" title="QC">QC ${esc(teamName(x.qcBy))}</span>` : ""}${x.trial ? '<span class="badge-trial">Dùng thử</span>' : ""}${payChip(x)}${nr && can("cases.chat_read") ? '<span class="new client">Khách vừa nhắn</span>' : ""}</span></a>`;
    }).join("") : `<div class="pt-empty"><img src="/brand/symbol.svg" alt=""><h2 class="h-caps">${jobs.length ? "Không có ca nào khớp" : "Chưa có ca nào"}</h2>
      <p>${jobs.length ? "Thử bộ lọc khác hoặc xóa ô tìm kiếm." : "Khi khách đăng nhập cổng khách hàng và gửi ca, ca sẽ hiện ở đây."}</p></div>`;
  }
  $("jobQ").addEventListener("input", () => { jobQuery = $("jobQ").value; drawJobs(); });
  $("jobWho").addEventListener("change", () => { jobWho = $("jobWho").value; drawJobs(); });

  /* ------------------------------------------------------------ case detail */
  async function openCase(id) {
    setBand(id, "", { back: true });
    if (!current || current.id !== id) { show("p-case", true); $("p-case").innerHTML = D8.skel.page(); }
    try { [current] = await Promise.all([api("/api/jobs/" + id).then((r) => r.job), D8.config()]); }
    catch (err) { $("p-case").innerHTML = `<div class="pt-empty"><h2 class="h-caps">Không mở được ca</h2><p>${esc(err.message)}</p><a class="btn" href="#jobs">Về danh sách ca</a></div>`; return; }
    drawCase(current);
  }

  const TEMPLATES = [
    ["Đã nhận ca", "Hi, thanks for sending this case. We have everything we need and have started the design. We'll post a 3D preview here for your review."],
    ["Cần bổ sung", "Hi, before we continue we need a little more information:\n\n- \n\nThank you!"],
    ["Đã có bản 3D", "The 3D design is ready for your review. Open the preview on this page, then approve it or tell us what you'd like changed."],
    ["Đã giao file", "Final files are uploaded and ready to download on this page. Thank you for working with D.EIGHT!"],
  ];

  // What the team wrote or did on a case, in plain Vietnamese
  function noteText(n) {
    const t = String(n.text || "");
    if (n.kind === "assign") {
      const [d, q] = t.replace(/^assign:/, "").split("|");
      return "Phân công: KTV " + (d && d !== "-" ? teamName(d) : "chưa giao") + " · QC " + (q && q !== "-" ? teamName(q) : "chưa giao");
    }
    if (n.kind === "upload") return "Tải lên " + t.replace(/^upload:/, "") + " file thiết kế";
    if (n.kind === "deliver") { const k = +t.replace(/^deliver:/, "") || 0; return k ? "Giao " + k + " file thiết kế cho khách" : "Chuyển ca sang Đã giao"; }
    const head = { submit: "Gửi QC", qc_pass: "QC đạt", qc_fail: "QC không đạt, trả KTV sửa", reopen: "Mở lại để sửa" }[n.kind];
    return head ? head + (t ? ": " + t : "") : t;
  }
  const teamOptions = (list, sel) => {
    const items = list.map((t) => [t.email, (t.name || t.email) + " · " + t.label]);
    if (sel && !items.some((x) => x[0] === sel)) items.push([sel, teamName(sel) + " (không còn quyền)"]);
    return '<option value="">— Chưa giao —</option>' + items.map(([v, l]) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(l)}</option>`).join("");
  };

  function drawCase(j) {
    const seen = adminSeen(); seen[j.id] = j.updated; const ks = Object.keys(seen); if (ks.length > 500) delete seen[ks[0]]; store.set("d8-admin-seen", seen); updateJobCount();
    setBand(j.title, j.id + " · gửi " + D8.fmtDate(j.created, true), { back: true, right: stChip(j.status) + (j.trial ? ' <span class="badge-trial" style="background:var(--c-cream);color:var(--c-navy)">Dùng thử</span>' : "") });
    const st = j.status, idx = st === "needs_info" ? 0 : STEPS.indexOf(st);
    const steps = STEPS.map((s, i) => {
      const cls = st === "cancelled" ? "" : i < idx || (i === idx && s === "delivered") ? "done" : i === idx ? "cur" : "";
      return `<li class="${cls}"><span class="dot">${cls === "done" ? ICON.check : ""}</span><span class="lbl">${esc(D8.statusLabel(s))}</span></li>`;
    }).join("");
    const me = myEmail(), keyMode = mode === "key";
    const owner = j.owner || "";
    const initials = String(j.ownerName || owner || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const files = j.files || [];
    const ins = files.filter((f) => f.kind === "input"), outs = files.filter((f) => f.kind === "output"), designs = files.filter((f) => f.kind === "design");
    const canDl = can("cases.files"), canDeliver = can("cases.deliver"), canDesign = can("cases.design");
    const fileRow = (f, opt = {}) => {
      const ext = (f.name.split(".").pop() || "").slice(0, 4);
      const dl = f.kind !== "input" || canDl;
      const del = can("cases.delete") || (f.kind === "design" && f.by && f.by === me && canDesign);
      const html = /\.html?$/i.test(f.name);
      return `<li class="${f.kind === "output" ? "out" : ""}">${opt.select ? `<input type="checkbox" class="sel" data-pick="${esc(f.fid)}" aria-label="Chọn ${esc(f.name)}">` : ""}<span class="ext">${esc(ext)}</span><div class="nm"><b title="${esc(f.name)}">${esc(f.name)}</b>
        <small>${esc(D8.size(f.size))}${f.gz ? " (lưu nén " + esc(D8.size(f.stored)) + ")" : ""} · ${esc(D8.fmtDate(f.at, true))}${f.by ? " · " + esc(teamName(f.by)) : ""} · lưu đến ${esc(D8.fmtDate(f.exp))}</small></div>
        ${html && f.kind === "design" ? `<a class="btn small" href="/api/jobs/${esc(j.id)}/files/${esc(f.fid)}?view=1" target="_blank" rel="noopener">Xem 3D</a>` : ""}
        ${opt.publish && html ? `<button class="btn small" type="button" data-publish="${esc(f.fid)}">Gửi khách xem 3D</button>` : ""}
        ${dl ? `<a class="iconbtn" href="/api/jobs/${esc(j.id)}/files/${esc(f.fid)}" download="${esc(f.name)}" title="Tải về" aria-label="Tải ${esc(f.name)}">${ICON.dl}</a>` : ""}
        ${del ? `<button class="iconbtn del" type="button" data-del="${esc(f.fid)}" title="Xóa file" aria-label="Xóa ${esc(f.name)}">${ICON.trash}</button>` : ""}</li>`;
    };
    const previews = (j.previews || []).map((p) => `<div class="pv"><span class="ic">${ICON.cube}</span><div class="tx"><b>${esc(p.label || j.title)}</b>
      <small>Dùng được đến ${esc(D8.fmtDate(p.expires))}</small></div>
      <a class="btn small" href="${esc(p.url)}" target="_blank" rel="noopener">Mở</a>
      ${canDeliver ? `<button class="iconbtn del rm" type="button" data-unlink="${esc(p.id)}" title="Gỡ link khỏi ca" aria-label="Gỡ link">${ICON.x}</button>` : ""}</div>`).join("");
    const det = [["Dịch vụ", D8.svcLabel(j.service)], ["Răng", j.teeth ? j.teeth + " (" + (j.numbering === "UNS" ? "Universal" : "FDI") + ")" : ""],
      ["Vật liệu", j.material], ["Màu răng", j.shade], ["Cần trước", j.neededBy ? D8.fmtDate(Date.parse(j.neededBy + "T12:00:00")) : ""],
      ["Ngày gửi", D8.fmtDate(j.created, true)], ["Đã duyệt", j.approvedAt ? D8.fmtDate(j.approvedAt, true) : ""]]
      .filter((r) => r[1]).concat(D8.rxRows(j.rx)).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");

    // internal workflow
    const stage = j.stage || "";
    const openCase = !["delivered", "cancelled"].includes(st);
    const canSubmit = canDesign && (j.designer === me || can("cases.all") || keyMode) && ["", "design", "fix"].includes(stage) && openCase;
    const canQc = can("cases.qc") && stage === "qc" && (!j.qcBy || j.qcBy === me || can("cases.all") || keyMode);
    const canReopen = (can("cases.assign") || can("cases.qc")) && (stage === "ready" || stage === "done");
    const qcLine = j.qc && j.qc.state ? `<p class="hint" style="margin:10px 0 0">QC ${j.qc.state === "passed" ? "đạt" : j.qc.state === "failed" ? "không đạt" : "đang chờ"}${j.qc.by ? " · " + esc(teamName(j.qc.by)) : ""} · ${esc(D8.fmtDate(j.qc.at, true))}</p>` : "";
    const team_ = (j.team || []).slice().reverse();
    const wfCard = `<section class="card" id="wfCard"><div class="card-head-row"><h2 class="h-caps">Quy trình nội bộ</h2>${stageChip(stage)}</div>
      <p class="sub">Chỉ đội D.EIGHT thấy mục này. KTV tải file thiết kế lên rồi gửi QC; QC đạt thì mới gửi khách.</p>
      ${can("cases.assign") ? `<form id="asForm"><div class="wf-grid">
          <div><label class="field-label" for="asD">KTV thiết kế</label><select class="input" id="asD">${teamOptions(team.filter((t) => t.design), j.designer || "")}</select></div>
          <div><label class="field-label" for="asQ">QC</label><select class="input" id="asQ">${teamOptions(team.filter((t) => t.qc), j.qcBy || "")}</select></div></div>
          <div class="wf-actions"><button class="btn small btn-primary" type="submit">Lưu phân công</button></div></form>`
        : `<p style="margin:0">KTV: <b>${esc(teamName(j.designer) || "chưa giao")}</b> · QC: <b>${esc(teamName(j.qcBy) || "chưa giao")}</b></p>`}
      ${qcLine}
      ${canSubmit || canQc || canReopen ? `<div style="margin-top:16px"><label class="field-label" for="wfNote">${canQc ? "Nhận xét QC (bắt buộc khi không đạt)" : "Ghi chú kèm theo (không bắt buộc)"}</label>
        <textarea class="input" id="wfNote" rows="2" maxlength="2000" style="min-height:70px"></textarea>
        <div class="wf-actions">
          ${canSubmit ? `<button class="btn btn-primary small" type="button" id="wfSubmit"${designs.length ? "" : " disabled"}>Gửi QC</button>${designs.length ? "" : '<span class="hint" style="margin:0;align-self:center">Tải file thiết kế lên trước.</span>'}` : ""}
          ${canQc ? `<button class="btn btn-ok small" type="button" id="wfPass">${ICON.check}Đạt</button><button class="btn small btn-danger" type="button" id="wfFail">Không đạt, trả KTV sửa</button>` : ""}
          ${canReopen ? `<button class="btn small" type="button" id="wfReopen">Mở lại để sửa</button>` : ""}</div></div>` : ""}
      ${can("cases.notes") && j.orderId && dbOn ? `<div style="margin-top:18px"><span class="field-label">Chat nội bộ · ${esc(j.order || "")}</span><div id="jobChat"></div></div>` : can("cases.notes") ? `<form class="compose" id="teamForm" style="margin-top:18px"><label class="field-label" for="teamBox">Ghi chú nội bộ</label>
          <textarea class="input" id="teamBox" maxlength="2000" rows="2" style="min-height:70px" placeholder="Trao đổi trong đội (khách không thấy)…"></textarea>
          <div class="wf-actions"><button class="btn small" type="submit" id="teamSend">Thêm ghi chú</button></div></form>
        <div class="team">${team_.length ? team_.map((n) => `<div class="n k-${esc(n.kind || "note")}"><small>${esc(teamName(n.by) || n.name || "")} · ${esc(D8.fmtDate(n.at, true))}</small><p>${esc(noteText(n))}</p></div>`).join("") : '<p class="muted" style="margin:0">Chưa có ghi chú.</p>'}</div>` : ""}
    </section>`;

    const designCard = canDesign || designs.length ? `<section class="card"><h2 class="h-caps">File thiết kế (nội bộ)</h2>
      <p class="sub">Khách không thấy các file này cho tới khi được giao. File HTML exocad bấm <b>Xem 3D</b> để xem nhanh.</p>
      ${designs.length ? `<ul class="files">${designs.map((f) => fileRow(f, { select: canDeliver, publish: canDeliver })).join("")}</ul>` : '<p class="muted" style="margin:0">Chưa có file thiết kế.</p>'}
      ${canDeliver && designs.length ? `<div class="wf-actions" style="align-items:center"><label class="check" style="margin:0"><input type="checkbox" id="prDeliver" checked> Chuyển ca sang Đã giao</label>
          <button class="btn btn-primary small" type="button" id="prBtn">Giao file đã chọn cho khách</button></div>
          ${stage !== "ready" && stage !== "done" ? '<p class="hint" style="margin:6px 0 0">Ca này chưa qua QC.</p>' : ""}<div class="progress block" id="prProg" hidden><div class="progress-bar"><i></i></div><p></p></div><p class="error" id="prErr" hidden></p>` : ""}
      ${canDesign ? `<div style="margin-top:16px"><label class="drop compact" id="dsZone">${ICON.up}<strong>Kéo file thiết kế vào đây</strong><span>STL, HTML exocad, ảnh chụp… · nhiều file cùng lúc</span><input type="file" id="dsFiles" multiple></label>
          <ul class="picked" id="dsList"></ul>
          <div class="progress block" id="dsProg" hidden><div class="progress-bar"><i></i></div><p></p></div>
          <p class="error" id="dsErr" hidden></p>
          <div style="margin-top:12px"><button class="btn btn-primary small" type="button" id="dsBtn" disabled>Tải file thiết kế lên</button></div></div>` : ""}
    </section>` : "";

    const custCard = `<section class="card"><div class="card-head-row"><h2 class="h-caps">File của khách</h2>
        ${canDl && ins.length > 1 ? `<button class="btn small" type="button" id="zipAll">${ICON.dl}Tải tất cả (.zip)</button>` : ""}</div>
      <p class="sub">${canDl ? "Bấm để tải về máy. File tự xóa sau 60 ngày." : "Bạn chưa có quyền tải file của khách."}</p>
      ${ins.length ? `<ul class="files">${ins.map((f) => fileRow(f)).join("")}</ul>` : '<p class="muted" style="margin:0">Khách chưa tải file nào lên.</p>'}
      ${(j.links || []).length ? `<p class="grp" style="margin-top:18px">Link file khách gửi</p><div class="links">${j.links.map((l) => `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer">${esc(l)}</a>`).join("")}</div>` : ""}
    </section>`;

    const linkCard = canDeliver ? `<section class="card"><h2 class="h-caps">Link xem 3D cho khách</h2><p class="sub">Gắn link vào ca sẽ tự chuyển ca sang Chờ duyệt và khách thấy nút Duyệt thiết kế.</p>
      ${previews || '<p class="muted" style="margin:0">Chưa gắn link 3D nào.</p>'}
      <div class="attach">
        <span class="field-label" style="margin:0">Tạo link mới từ file HTML exocad</span>
        <div class="row"><input class="input" type="file" id="pvFile" accept=".html,.htm,text/html" aria-label="File HTML exocad">
          <div class="seg" role="radiogroup" aria-label="Hạn dùng">${[7, 14, 30].map((d) => `<label><input type="radio" name="pvDays" value="${d}"${d === 30 ? " checked" : ""}><span>${d} ngày</span></label>`).join("")}</div></div>
        <div class="row"><input class="input" id="pvLabel" maxlength="80" value="${esc(j.title)}" aria-label="Tên ca hiển thị"><button class="btn btn-primary small" type="button" id="pvCreate">Tạo &amp; gắn link</button></div>
        <div class="progress block" id="pvProg" hidden><div class="progress-bar"><i></i></div><p></p></div>
        <span class="field-label" style="margin:6px 0 0">Hoặc gắn link đã tạo</span>
        <div class="row"><select class="input" id="pvPick"><option value="">Đang tải danh sách link…</option></select><button class="btn small" type="button" id="pvAttach">Gắn link</button></div>
        <p class="error" id="pvErr" hidden></p>
      </div></section>` : (previews ? `<section class="card"><h2 class="h-caps">Link xem 3D</h2>${previews}</section>` : "");

    const outCard = canDeliver ? `<section class="card"><h2 class="h-caps">Giao file hoàn chỉnh</h2><p class="sub">File ở đây là file khách nhận (STL đã thiết kế).</p>
      ${outs.length ? `<ul class="files">${outs.map((f) => fileRow(f)).join("")}</ul>` : ""}
      <div style="margin-top:14px"><label class="drop compact" id="outZone">${ICON.up}<strong>Kéo file STL hoàn chỉnh vào đây</strong><span>hoặc bấm để chọn · nhiều file cùng lúc</span><input type="file" id="outFiles" multiple></label>
        <ul class="picked" id="outList"></ul>
        <label class="check"><input type="checkbox" id="outDeliver" checked> Chuyển ca sang <b>&nbsp;Đã giao&nbsp;</b> khi tải xong</label>
        <div class="progress block" id="outProg" hidden><div class="progress-bar"><i></i></div><p></p></div>
        <p class="error" id="outErr" hidden></p>
        <div style="margin-top:12px"><button class="btn btn-primary small" type="button" id="outBtn" disabled>Tải lên &amp; giao</button></div></div>
    </section>` : (outs.length ? `<section class="card"><h2 class="h-caps">File đã giao khách</h2><ul class="files">${outs.map((f) => fileRow(f)).join("")}</ul></section>` : "");

    const chatCard = can("cases.chat_read") ? `<section class="card"><h2 class="h-caps">Tin nhắn với khách</h2><p class="sub">${can("cases.chat") ? "Khách thấy tin nhắn trong cổng khách hàng. Bấm <b>Dịch</b> dưới tin của khách để xem tiếng Việt; viết tiếng Việt rồi bấm <b>Dịch sang tiếng Anh</b> trước khi gửi." : "Bạn chỉ được đọc tin nhắn. Muốn trả lời khách, nhờ quản trị hoặc ghi chú nội bộ."}</p>
      <div class="thread-tools"><label class="tr-auto" hidden><input type="checkbox" data-tr-auto> Luôn dịch tin của khách</label><button type="button" data-tr-all hidden>Dịch tất cả</button></div>
      <div class="thread" id="thread">${D8.threadHtml(j, "admin", "vi") || '<p class="muted" style="margin:0">Chưa có tin nhắn.</p>'}</div>
      ${can("cases.chat") ? `<form class="compose" id="composeForm">
        <div class="tpl">${TEMPLATES.map((t, i) => `<button type="button" data-tpl="${i}">${esc(t[0])}</button>`).join("")}</div>
        <label class="sr-only" for="composer">Tin nhắn</label>
        <textarea class="input" id="composer" maxlength="4000" placeholder="Viết tin nhắn cho khách (tiếng Việt hoặc tiếng Anh)…"></textarea>
        <p class="compose-orig" id="composeOrig" hidden></p>
        <div class="compose-foot"><p class="hint">Ctrl + Enter để gửi.</p>
          <div class="compose-tr"><button class="btn small" type="button" id="aiSuggest" hidden title="Gõ vài ý tiếng Việt (không bắt buộc) rồi bấm để AI soạn câu trả lời tiếng Anh">${ICON.spark}Gợi ý trả lời</button><button class="btn small" type="button" id="toEn">Dịch sang tiếng Anh</button><button class="btn btn-primary small" type="submit" id="sendMsg">Gửi</button></div></div>
        <p class="error" id="msgErr" hidden></p>
      </form>` : ""}
    </section>` : "";

    // billing (with the order book on, money lives in the order; this card is for online payment)
    let billing = "";
    const orderCard = j.orderId && dbOn ? `<section class="card" id="jobOrder"><div class="card-head-row"><h2 class="h-caps">Đơn hàng</h2><a class="btn small" href="#orders/${esc(j.orderId)}">Mở đơn</a></div>
      <p class="job-ocode">${esc(j.order || "")}</p><div id="jobOrderBody"><p class="muted" style="margin:0">Đang tải…</p></div></section>` : "";
    if (can("billing.view") && "pay" in j && (!dbOn || payOnline() || ["due", "check"].includes(j.pay))) {
      const tu = trialUse(j.owner);
      const left = TRIAL_CREDIT - tu.used;
      const tries = (j.payTries || []).filter((t) => t.state !== "paid");
      const openTry = tries.some((t) => t.state === "open" || t.state === "held");
      const online = [payCfg.paypal ? "PayPal" : "", payCfg.stripe ? "Stripe" : ""].filter(Boolean);
      const edit = can("billing.edit");
      const p = j.paid || {};
      const pend = j.pay === "check" ? `<div class="pay-box"><b>Khách báo đã thanh toán ${esc(money(p.amount || 0))}</b> qua ${esc(VIA[p.via] || p.via || "")}${p.ref ? " · mã " + esc(p.ref) : ""} lúc ${esc(D8.fmtDate(p.at, true))}.
          ${p.note ? `<br>Khách ghi: “${esc(p.note)}”` : ""}<br>Kiểm tra tài khoản ${p.via === "paypal" ? "PayPal" : p.via === "stripe" ? "Stripe" : "ngân hàng / Payoneer"} rồi xác nhận.
          ${edit ? `<div class="btns"><button class="btn btn-ok small" type="button" id="payOk">${ICON.check}Đã nhận tiền</button><button class="btn small btn-danger" type="button" id="payNo">Chưa nhận được</button></div>` : ""}</div>` : "";
      billing = `<section class="card"><h2 class="h-caps" style="margin-bottom:6px">Báo giá &amp; thanh toán</h2>
        <p class="sub">Giá ca chỉ đội D.EIGHT thấy. Khách chỉ thấy số tiền cần trả khi chọn <b>Chờ thanh toán</b>, trả qua ${online.length ? esc(online.join(" hoặc ")) : "PayPal/Stripe (chưa gắn khóa API)"} hoặc báo đã chuyển khoản. Mọi khoản đều chờ bạn xác nhận.</p>
        ${pend}
        ${j.pay === "paid" && p.amount != null ? `<div class="ai-ok" style="margin:0 0 14px">Đã nhận ${esc(money(p.amount))} qua ${esc(VIA[p.via] || p.via)}${p.ref ? ` · mã ${esc(p.ref)}` : ""}${p.confirmedAt ? ` · xác nhận ${esc(D8.fmtDate(p.confirmedAt, true))}${p.confirmedBy ? " bởi " + esc(teamName(p.confirmedBy) || p.confirmedBy) : ""}` : ""}</div>` : ""}
        ${tries.length ? `<ul class="pay-tries">${tries.map((t) => `<li>${esc(VIA[t.via] || t.via)} · ${esc(money(t.amount))} · ${esc(D8.fmtDate(t.at, true))} · <b>${esc(TRY_STATE[t.state] || t.state)}</b></li>`).join("")}</ul>
          ${openTry ? `<button class="btn small" type="button" id="payCheck" style="margin:0 0 14px">Kiểm tra thanh toán</button>` : ""}` : ""}
        ${edit ? `<form id="billForm" style="display:grid;gap:12px">
          <div><label class="field-label" for="billPrice">Giá ca (USD)</label><input class="input" id="billPrice" type="number" min="0" step="0.01" inputmode="decimal" value="${typeof j.price === "number" ? j.price : ""}" placeholder="VD: 35"></div>
          <div><label class="field-label" for="billDue">Số tiền khách cần trả (USD)</label><input class="input" id="billDue" type="number" min="0" step="0.01" inputmode="decimal" value="${typeof j.due === "number" ? j.due : ""}" placeholder="Để trống = bằng giá ca">
            <p class="hint" style="margin:6px 0 0">Dùng khi chỉ thu một phần (ví dụ phần vượt mức dùng thử bạn đã thương lượng).</p></div>
          <div><label class="field-label" for="billPay">Thanh toán</label><select class="input" id="billPay">${Object.entries(PAY_LABEL).filter(([k]) => k !== "check" || j.pay === "check").map(([k, l]) => `<option value="${k}"${(j.pay || "") === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
          <label class="check" style="margin:0"><input type="checkbox" id="billTrial"${j.trial ? " checked" : ""}> Ca dùng thử miễn phí</label>
          ${tu.cases ? `<p class="hint" style="margin:0">Khách này có ${tu.cases} ca dùng thử, tổng giá ${esc(money(tu.used))} / mức ${money(TRIAL_CREDIT)}${left < 0 ? ` (vượt ${esc(money(-left))})` : ` (còn ${esc(money(left))})`}.</p>` : ""}
          <button class="btn btn-primary small" type="submit" style="justify-self:start">Lưu báo giá</button>
        </form>` : `<dl class="dl"><div><dt>Giá ca</dt><dd>${typeof j.price === "number" ? esc(money(j.price)) : "—"}</dd></div><div><dt>Thanh toán</dt><dd>${esc(PAY_LABEL[j.pay || ""] || "")}</dd></div></dl>`}
      </section>`;
    }

    show("p-case");
    $("p-case").innerHTML = `
      <div class="adm-head">
        <div class="adm-cust"><span class="av">${esc(initials)}</span><div><b>${esc(j.ownerName || owner || "Khách hàng")}</b>
          ${owner ? `<a href="mailto:${esc(owner)}?subject=${encodeURIComponent(j.id + " · " + j.title)}">${esc(owner)}</a>` : ""}
          ${owner && can("customers.view") ? ` · <a href="#customers/${encodeURIComponent(owner)}">Hồ sơ khách</a>` : ""}</div></div>
        ${can("cases.status") ? `<form class="stat-form" id="statForm"><label class="sr-only" for="statSel">Trạng thái</label>
          <select class="input" id="statSel">${STATUSES.map((s) => `<option value="${s}"${s === st ? " selected" : ""}>${esc(D8.statusLabel(s))}</option>`).join("")}</select>
          <button class="btn btn-primary small" type="submit">Cập nhật trạng thái</button></form>` : ""}
      </div>
      <ol class="pt-steps" aria-label="Tiến độ">${steps}</ol>
      ${st === "review" ? `<div class="pt-alert info">${ICON.warn}<div>Đang chờ khách duyệt bản 3D.</div></div>` : ""}
      ${st === "approved" ? `<div class="pt-alert ok">${ICON.check}<div>Khách đã duyệt lúc ${esc(D8.fmtDate(j.approvedAt || j.updated, true))}. Xuất file hoàn chỉnh rồi giao cho khách.</div></div>` : ""}
      ${j.pay === "check" && can("billing.edit") ? `<div class="pt-alert info">${ICON.warn}<div>Khách báo đã thanh toán. Kiểm tra tiền đã về rồi bấm xác nhận ở mục Báo giá &amp; thanh toán.</div></div>` : ""}
      <div class="pt-grid">
        <div>${wfCard}${custCard}${designCard}${linkCard}${outCard}${chatCard}</div>
        <aside>${can("ai.use") ? `<section class="card" id="aiSumCard" hidden><div class="card-head-row"><h2 class="h-caps" style="display:flex;align-items:center;gap:8px">Tóm tắt cho KTV <span class="ai-tag">AI</span></h2>
            <button class="btn small" type="button" id="aiSumBtn">${j.ai && j.ai.sum ? "Làm mới" : "Tạo tóm tắt"}</button></div>
          <div id="aiSumBody">${j.ai && j.ai.sum ? `<p class="ai-sum">${esc(j.ai.sum)}</p><p class="ai-meta">Tạo lúc ${esc(D8.fmtDate(j.ai.sumAt, true))}${j.ai.sumUpd < j.updated ? " · <b>ca đã có cập nhật sau bản tóm tắt này</b>" : ""}. AI có thể sai, đối chiếu lại phiếu gốc.</p>` : '<p class="muted" style="margin:0">AI đọc phiếu chỉ định và tin nhắn của khách rồi tóm tắt bằng tiếng Việt.</p>'}</div></section>` : ""}
          <section class="card"><h2 class="h-caps" style="margin-bottom:16px">Thông tin ca</h2><dl class="dl">${det}</dl>
          ${j.notes ? `<p class="grp" style="margin-top:20px">Yêu cầu của khách</p><p class="notes">${esc(j.notes)}</p>` : ""}</section>
          ${orderCard}${billing}</aside>
      </div>`;
    const th = $("thread");
    if (th) { th.scrollTop = th.scrollHeight; D8.wireThread(th, j, "vi"); }
    if ($("jobChat") && D8.orderChat) D8.orderChat($("jobChat"), j.orderId);
    if ($("jobOrderBody")) api("/api/orders/" + j.orderId).then((d) => {
      const o = d.order, box = $("jobOrderBody"); if (!box || !current || current.id !== j.id) return;
      box.innerHTML = `<dl class="dl"><div><dt>Khách</dt><dd>${esc(o.customer_code + " — " + o.customer_name)}</dd></div><div><dt>Hạng mục</dt><dd>${esc(o.items_text || "Chưa có")}</dd></div>
        ${"total" in o ? `<div><dt>Thành tiền</dt><dd>${esc(D8.fmtMoney(o.total, o.currency))}</dd></div><div><dt>Còn nợ</dt><dd>${esc(D8.fmtMoney(o.due, o.currency))}</dd></div>` : ""}</dl>
        ${can("orders.edit") || can("billing.edit") ? `<p class="hint"><a href="#orders/${o.id}/edit">Thêm hạng mục, sửa giá ›</a></p>` : ""}`;
    }).catch((err) => { const box = $("jobOrderBody"); if (box) box.innerHTML = `<p class="hint">${esc(err.message)}</p>`; });
    wireCase(j);
  }

  function armed(btn, onGo) {
    let on = false, t;
    btn.addEventListener("click", async () => {
      if (!on) { on = true; btn.classList.add("armed"); t = setTimeout(() => { on = false; btn.classList.remove("armed"); }, 4000); return; }
      clearTimeout(t); btn.disabled = true;
      try { await onGo(); } catch (err) { btn.disabled = false; btn.classList.remove("armed"); on = false; D8.toast(err.message); }
    });
  }
  // file picker + drop zone shared by the design and delivery uploads
  function picker(zone, input, list, onChange, opts) {
    const files = [];
    const draw = () => { D8.renderPicked(list, files, (i) => { files.splice(i, 1); draw(); }, { ...opts, removeLabel: "Bỏ" }); onChange(files); };
    const add = (fs) => { fs.forEach((f) => { if (!files.some((x) => x.name === f.name && x.size === f.size)) files.push(f); }); draw(); };
    input.addEventListener("change", () => { add([...input.files]); input.value = ""; });
    ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("over"); }));
    zone.addEventListener("drop", (e) => add([...(e.dataTransfer.files || [])]));
    draw();
    return files;
  }

  function wireCase(j) {
    const redraw = (job) => {
      current = job;
      const i = jobs.findIndex((x) => x.id === job.id);
      if (i >= 0) Object.assign(jobs[i], { status: job.status, updated: job.updated, lastBy: job.lastBy, trial: !!job.trial, designer: job.designer || "", qcBy: job.qcBy || "", stage: job.stage || "",
        ...("pay" in job ? { price: typeof job.price === "number" ? job.price : null, pay: job.pay || "" } : {}) });
      drawCase(job);
    };
    const post = (path, body) => api(`/api/jobs/${j.id}${path}`, { method: "POST", body });
    const zip = $("zipAll");
    if (zip) zip.addEventListener("click", async () => {
      zip.disabled = true;
      try { await D8.downloadZip((j.files || []).filter((f) => f.kind === "input").map((f) => ({ name: f.name, url: `/api/jobs/${j.id}/files/${f.fid}` })), j.id + ".zip", (i, n) => { zip.textContent = "Đang gom file " + i + "/" + n + "…"; }); }
      catch (err) { D8.toast(err.message); }
      zip.disabled = false; zip.innerHTML = ICON.dl + "Tải tất cả (.zip)";
    });

    // workflow: assignment, QC, notes
    const asForm = $("asForm");
    if (asForm) asForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = asForm.querySelector("[type=submit]"); D8.busy(b, true);
      try { redraw((await post("/assign", { designer: $("asD").value, qcBy: $("asQ").value })).job); D8.done(asForm.querySelector("[type=submit]"), "Đã lưu"); }
      catch (err) { D8.busy(b, false); D8.toast(err.message); }
    });
    const stageBtn = (id, action, doneText) => {
      const b = $(id); if (!b) return;
      b.addEventListener("click", async () => {
        const note = (($("wfNote") || {}).value || "").trim();
        if (action === "fail" && note.length < 3) { D8.toast("Ghi rõ lỗi cần sửa để KTV biết."); return $("wfNote").focus(); }
        D8.busy(b, true);
        try { redraw((await post("/stage", { action, note })).job); D8.toast(doneText); }
        catch (err) { D8.busy(b, false); D8.toast(err.message); }
      });
    };
    stageBtn("wfSubmit", "submit", "Đã gửi QC.");
    stageBtn("wfPass", "pass", "QC đạt. Ca sẵn sàng gửi khách.");
    stageBtn("wfFail", "fail", "Đã trả KTV sửa.");
    stageBtn("wfReopen", "reopen", "Đã mở lại ca để sửa.");
    const teamForm = $("teamForm");
    if (teamForm) teamForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = $("teamBox").value.trim(); if (!text) return $("teamBox").focus();
      D8.busy($("teamSend"), true);
      try { redraw((await post("/team", { text })).job); D8.done($("teamSend"), "Đã thêm"); }
      catch (err) { D8.busy($("teamSend"), false); D8.toast(err.message); }
    });

    // design files: upload (exocad HTML gets the storage shim so "Xem 3D" works), deliver, publish as a 3D link
    if ($("dsZone")) {
      const btn = $("dsBtn");
      const picked = picker($("dsZone"), $("dsFiles"), $("dsList"), (fs) => { btn.disabled = !fs.length; btn.textContent = fs.length ? `Tải ${fs.length} file thiết kế lên` : "Tải file thiết kế lên"; }, { design: true });
      btn.addEventListener("click", async () => {
        const prog = $("dsProg"), err = $("dsErr");
        err.hidden = true; D8.busy(btn, true); prog.hidden = false; busy = true;
        try {
          const ready = await Promise.all(picked.map(async (f) => (/\.html?$/i.test(f.name) ? new File([await withStorageShim(f)], f.name, { type: "text/html" }) : f)));
          const out = await D8.uploadJobFiles(j.id, ready, { kind: "design", onProgress: (p) => { prog.querySelector("i").style.width = p.pct + "%"; prog.querySelector("p").textContent = p.text; } });
          busy = false; redraw(out.job); D8.toast("Đã tải file thiết kế lên.");
        } catch (ex) { busy = false; D8.busy(btn, false); prog.hidden = true; err.textContent = ex.message; err.hidden = false; }
      });
    }
    const prBtn = $("prBtn");
    if (prBtn) prBtn.addEventListener("click", async () => {
      const fids = [...document.querySelectorAll("#p-case [data-pick]:checked")].map((x) => x.dataset.pick);
      const err = $("prErr"); err.hidden = true;
      if (!fids.length && !$("prDeliver").checked) { err.textContent = "Chọn file cần giao cho khách."; err.hidden = false; return; }
      D8.busy(prBtn, true);
      try { redraw((await post("/promote", { fids, deliver: $("prDeliver").checked })).job); D8.toast(fids.length ? "Đã giao file cho khách." : "Đã chuyển ca sang Đã giao."); }
      catch (ex) { D8.busy(prBtn, false); err.textContent = ex.message; err.hidden = false; }
    });
    document.querySelectorAll("#p-case [data-publish]").forEach((b) => b.addEventListener("click", async () => {
      const f = (j.files || []).find((x) => x.fid === b.dataset.publish); if (!f) return;
      const prog = $("prProg"), bar = prog ? prog.querySelector("i") : null, txt = prog ? prog.querySelector("p") : null;
      D8.busy(b, true); busy = true; if (prog) prog.hidden = false;
      try {
        if (txt) txt.textContent = "Đang lấy file thiết kế…";
        const res = await fetch(`/api/jobs/${j.id}/files/${f.fid}`, { headers: D8.authHeaders(), credentials: "same-origin" });
        if (!res.ok) throw new Error("Không lấy được file (" + res.status + ").");
        const file = new File([await res.blob()], f.name, { type: "text/html" });
        const link = await createLink(file, j.title, 30, (p, t) => { if (bar) bar.style.width = Math.round(p * 100) + "%"; if (txt) txt.textContent = t; });
        pending.set(link.id, link);
        redraw((await post("/previews", { linkId: link.id, trust: true })).job);
        D8.toast("Đã gửi bản 3D cho khách duyệt.");
      } catch (err) { D8.busy(b, false); if (prog) prog.hidden = true; D8.toast(err.message); }
      busy = false;
    }));

    // billing and payment confirmation
    const bf = $("billForm");
    if (bf) {
      bf.addEventListener("submit", async (e) => {
        e.preventDefault();
        const raw = $("billPrice").value.trim(), rawDue = $("billDue").value.trim();
        const b = e.submitter || bf.querySelector("[type=submit]");
        D8.busy(b, true);
        try {
          redraw((await post("/billing", { price: raw === "" ? null : Number(raw), due: rawDue === "" ? null : Number(rawDue), pay: $("billPay").value, trial: $("billTrial").checked })).job);
          D8.done($("billForm").querySelector("[type=submit]"), "Đã lưu");
        } catch (err) { D8.busy(b, false); D8.toast(err.message); }
      });
    }
    const payOk = $("payOk"), payNo = $("payNo");
    if (payOk) payOk.addEventListener("click", async () => {
      D8.busy(payOk, true);
      try { redraw((await post("/pay/confirm", { ok: true })).job); D8.toast("Đã xác nhận thanh toán. Khách thấy ca Đã thanh toán."); }
      catch (err) { D8.busy(payOk, false); D8.toast(err.message); }
    });
    if (payNo) armed(payNo, async () => { redraw((await post("/pay/confirm", { ok: false })).job); D8.toast("Đã chuyển lại Chờ thanh toán."); });
    const pc = $("payCheck");
    const runPayCheck = async (loud) => {
      if (pc) D8.busy(pc, true);
      try {
        const out = await post("/pay/check");
        if (current && current.id === j.id && (out.job.updated !== current.updated || out.job.pay !== current.pay || JSON.stringify(out.job.payTries) !== JSON.stringify(current.payTries))) redraw(out.job);
        else if (pc && pc.isConnected) D8.busy(pc, false);
        if (loud) D8.toast(out.sent ? "Khách đã trả qua cổng thanh toán, chờ bạn xác nhận." : out.paid ? "Ca đã thanh toán." : "Chưa có thanh toán mới.");
      } catch (err) { if (pc && pc.isConnected) D8.busy(pc, false); if (loud) D8.toast(err.message); }
    };
    if (pc) pc.addEventListener("click", () => runPayCheck(true));
    if (pc && j.pay === "due" && !payChecked.has(j.id)) { payChecked.add(j.id); runPayCheck(false); }

    const sf = $("statForm");
    if (sf) sf.addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = e.submitter || sf.querySelector("[type=submit]");
      D8.busy(b, true);
      try { redraw((await post("/status", { status: $("statSel").value })).job); D8.done($("statForm").querySelector("[type=submit]"), "Đã cập nhật"); }
      catch (err) { D8.busy(b, false); D8.toast(err.message); }
    });
    document.querySelectorAll("#p-case [data-del]").forEach((b) => armed(b, async () => redraw((await api(`/api/jobs/${j.id}/files/${b.dataset.del}`, { method: "DELETE" })).job)));
    document.querySelectorAll("#p-case [data-unlink]").forEach((b) => armed(b, async () => redraw((await post("/previews", { linkId: b.dataset.unlink, remove: true })).job)));

    // 3D links for the customer
    if ($("pvPick")) {
      api("/api/list").then((d) => {
        const pick = $("pvPick"); if (!pick) return;
        const have = new Set((j.previews || []).map((p) => p.id));
        const items = (d.items || []).filter((x) => !have.has(x.id));
        pick.innerHTML = items.length ? '<option value="">Chọn link đang hoạt động…</option>' + items.map((x) => `<option value="${esc(x.id)}">${esc((x.label || "Chưa đặt tên") + " · đến " + D8.fmtDate(x.expires))}</option>`).join("")
          : '<option value="">Không có link nào khác</option>';
      }).catch(() => {});
      const pvErr = (m) => { $("pvErr").textContent = m; $("pvErr").hidden = !m; };
      $("pvAttach").addEventListener("click", async () => {
        const id = $("pvPick").value; if (!id) return;
        pvErr("");
        try { redraw((await post("/previews", { linkId: id })).job); } catch (err) { pvErr(err.message); }
      });
      $("pvCreate").addEventListener("click", async () => {
        const f = $("pvFile").files[0];
        if (!f) return pvErr("Chọn file HTML xuất từ exocad trước.");
        pvErr("");
        const prog = $("pvProg"), bar = prog.querySelector("i"), txt = prog.querySelector("p");
        const days = (document.querySelector('input[name="pvDays"]:checked') || {}).value || "30";
        D8.busy($("pvCreate"), true); prog.hidden = false; busy = true;
        try {
          const link = await createLink(f, $("pvLabel").value.trim(), days, (p, t) => { bar.style.width = Math.round(p * 100) + "%"; txt.textContent = t; });
          txt.textContent = "Đang gắn link vào ca…";
          pending.set(link.id, link);
          redraw((await post("/previews", { linkId: link.id, trust: true })).job);
          D8.toast("Đã tạo link 3D và gắn vào ca.");
        } catch (err) { D8.busy($("pvCreate"), false); prog.hidden = true; pvErr(err.message); }
        busy = false;
      });
    }

    // deliver final files
    if ($("outZone")) {
      const btn = $("outBtn");
      let outs = [];
      const label = () => {
        btn.disabled = !outs.length && !$("outDeliver").checked;
        btn.textContent = outs.length ? `Tải lên ${outs.length} file${$("outDeliver").checked ? " & giao" : ""}` : ($("outDeliver").checked ? "Chuyển sang Đã giao" : "Tải lên & giao");
        if (j.status === "delivered" && !outs.length) btn.disabled = true;
      };
      // design = true: finished restorations should be closed meshes
      outs = picker($("outZone"), $("outFiles"), $("outList"), label, { design: true });
      $("outDeliver").addEventListener("change", label);
      label();
      btn.addEventListener("click", async () => {
        const prog = $("outProg"), err = $("outErr");
        err.hidden = true; D8.busy(btn, true); busy = true;
        try {
          let job;
          if (outs.length) {
            prog.hidden = false;
            job = (await D8.uploadJobFiles(j.id, outs, { deliver: $("outDeliver").checked, onProgress: (p) => { prog.querySelector("i").style.width = p.pct + "%"; prog.querySelector("p").textContent = p.text; } })).job;
          } else job = (await post("/files", { files: [], deliver: true })).job;
          busy = false; redraw(job); D8.toast(job.status === "delivered" ? "Đã giao file cho khách." : "Đã tải file lên.");
        } catch (ex) { busy = false; D8.busy(btn, false); prog.hidden = true; err.textContent = ex.message; err.hidden = false; }
      });
    }

    // AI summary for the designer (made automatically the first time the case is opened)
    const sumCard = $("aiSumCard"), sumBtn = $("aiSumBtn"), sugBtn = $("aiSuggest");
    if (sumCard) {
      const runSummary = async () => {
        sumBtn.disabled = true; sumBtn.textContent = "Đang tóm tắt…";
        try {
          const r = await post("/summary");
          j.ai = { ...(j.ai || {}), sum: r.summary, sumAt: r.at, sumUpd: j.updated };
          $("aiSumBody").innerHTML = `<p class="ai-sum">${esc(r.summary)}</p><p class="ai-meta">Tạo lúc ${esc(D8.fmtDate(r.at, true))}. AI có thể sai, đối chiếu lại phiếu gốc.</p>`;
          sumBtn.textContent = "Làm mới";
        } catch (err) { D8.toast(err.message); sumBtn.textContent = j.ai && j.ai.sum ? "Làm mới" : "Tạo tóm tắt"; }
        sumBtn.disabled = false;
      };
      const aiReady = () => {
        sumCard.hidden = !D8.aiOn; if (sugBtn) sugBtn.hidden = !D8.aiOn;
        if (D8.aiOn && !(j.ai && j.ai.sum) && !aiTried.has(j.id)) { aiTried.add(j.id); runSummary(); }
      };
      aiReady(); if (!D8.aiOn) document.addEventListener("d8:config", aiReady, { once: true });
      sumBtn.addEventListener("click", runSummary);
    }

    // messages (write in Vietnamese, translate to English, send English with the Vietnamese kept as the original)
    const form = $("composeForm");
    if (!form) return;
    const box = $("composer");
    let orig = "";
    const showOrig = () => { const o = $("composeOrig"); o.hidden = !orig; o.innerHTML = orig ? "<b>Bản tiếng Việt</b>" + esc(orig) : ""; };
    $("toEn").addEventListener("click", async () => {
      const text = box.value.trim(); if (!text) return box.focus();
      const b = $("toEn"); b.disabled = true; b.textContent = "Đang dịch…";
      try {
        const r = await D8.translate({ text, to: "en" });
        if (r.opened) D8.toast("Đã mở Google Dịch ở thẻ mới. Dán bản tiếng Anh vào ô tin nhắn.");
        else if (r.text) { orig = text; box.value = r.text; showOrig(); }
      } catch (err) { D8.toast(err.message); }
      b.disabled = false; b.textContent = "Dịch sang tiếng Anh";
    });
    if (sugBtn && can("ai.use")) sugBtn.addEventListener("click", async () => {
      const hint = orig || box.value.trim(); // Vietnamese ideas typed by the designer guide the reply
      sugBtn.disabled = true; sugBtn.textContent = "Đang soạn…";
      try {
        const r = await post("/suggest", { hint });
        box.value = r.en; orig = r.vi || ""; showOrig(); box.focus();
      } catch (err) { D8.toast(err.message); }
      sugBtn.disabled = false; sugBtn.innerHTML = ICON.spark + "Gợi ý trả lời";
    });
    document.querySelectorAll("#p-case [data-tpl]").forEach((b) => b.addEventListener("click", () => { box.value = TEMPLATES[+b.dataset.tpl][1]; orig = ""; showOrig(); box.focus(); }));
    box.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = box.value.trim(); if (!text) return box.focus();
      D8.busy($("sendMsg"), true); $("msgErr").hidden = true;
      try { redraw((await post("/messages", orig ? { text, original: orig, originalLang: "vi" } : { text })).job); D8.done($("sendMsg"), "Đã gửi"); }
      catch (err) { D8.busy($("sendMsg"), false); $("msgErr").textContent = err.message; $("msgErr").hidden = false; }
    });
  }

  /* ------------------------------------------------------------ customers */
  async function loadCustomers() {
    if (!users.length && $("custBody")) $("custBody").innerHTML = D8.skel.tableRows(7, 4);
    try {
      const [u] = await Promise.all([api("/api/admin/users"), jobs.length ? null : loadJobs(true)]);
      users = u.users || [];
      $("custErr").hidden = true;
      drawCustomers();
    } catch (err) { if ($("custErr")) { $("custErr").textContent = err.message; $("custErr").hidden = false; } }
  }
  function drawCustomers() {
    if (!$("custQ")) return;
    const q = $("custQ").value.toLowerCase();
    const per = {}; jobs.forEach((x) => { per[x.owner] = (per[x.owner] || 0) + 1; });
    const shown = users.filter((u) => !q || (u.name + " " + u.email + " " + u.practice + " " + u.country).toLowerCase().includes(q));
    $("custBody").innerHTML = shown.length ? shown.map((u) => `<tr>
      <td><a href="#customers/${encodeURIComponent(u.email)}"><b>${esc(u.name || "—")}</b></a><small>${esc(u.email)}</small></td><td>${esc(u.practice || "—")}</td><td>${esc(u.country || "—")}</td><td>${esc(u.phone || "—")}</td>
      <td class="num">${per[u.email] ? `<a href="#jobs" data-owner="${esc(u.email)}">${per[u.email]} ca</a>` : "0"}</td>
      <td>${esc(D8.fmtDate(u.created))}</td><td>${esc(D8.ago(u.last))}</td></tr>`).join("")
      : `<tr><td colspan="7" class="muted">${users.length ? "Không có khách nào khớp." : "Chưa có khách nào đăng nhập."}</td></tr>`;
    $("custBody").querySelectorAll("[data-owner]").forEach((a) => a.addEventListener("click", () => { jobFilter = "all"; jobQuery = a.dataset.owner; $("jobQ").value = jobQuery; }));
  }
  document.addEventListener("input", (e) => { if (e.target && e.target.id === "custQ" && !$("cuQ")) drawCustomers(); });

  /* ------------------------------------------------------------ dashboard */
  let dashBusy = false;
  function drawHome() {
    const host = $("dash");
    const u = D8.user;
    // Quick buttons sit in the band on wide screens; on narrower ones they would wrap under the title and push the
    // page down after load (layout shift), so there they open the dashboard instead (.dash-quick).
    const quick = dbOn && can("orders.edit");
    setBand("Xin chào" + (u && u.name ? ", " + u.name : ""), u ? (u.roleLabel || "") + " · việc cần làm hôm nay" : "Việc cần làm hôm nay",
      { right: quick ? '<div class="band-btns home-q"><a class="btn btn-cream small" href="#orders/new">+ Đơn mới</a><a class="btn btn-light small" href="#orders">Tìm đơn</a></div>' : "" });
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
      const head = quick ? '<div class="dash-quick"><a class="btn btn-primary small" href="#orders/new">+ Đơn mới</a><a class="btn small" href="#orders">Tìm đơn</a></div>' : "";
      D8.ordersDash(host, portal.join(""), head).then((ok) => { host.dataset.dash = "1"; dashBusy = false; if (!ok) { dbOn = false; drawHome(); } })
        .catch((err) => { dashBusy = false; host.innerHTML = `<p class="error">${esc(err.message)}</p>`; });
      return;
    }
    if (!jobsAt && !jobs.length) { host.innerHTML = D8.skel.card(4) + D8.skel.card(4) + D8.skel.card(4); return; }
    const me = myEmail(), seen = adminSeen(), keyMode = mode === "key";
    const open = (x) => !["delivered", "cancelled"].includes(x.status);
    const row = (x) => `<li><a href="#jobs/${esc(x.id)}"><span class="t">${esc(x.title)}</span><span class="i">${esc(x.id)}${x.ownerName ? " · " + esc(x.ownerName) : ""}</span><span class="a">${esc(D8.ago(x.updated))}</span></a></li>`;
    const card = (title, list, empty, more) => `<section class="card"><div class="dash-h"><h2 class="h-caps">${esc(title)}</h2><b>${list.length}</b></div>
      ${list.length ? `<ul>${list.slice(0, 6).map(row).join("")}</ul>${list.length > 6 && more ? `<p class="hint"><a href="#jobs" data-who="${more}">Xem tất cả ${list.length} ca</a></p>` : ""}` : `<p class="none">${esc(empty)}</p>`}</section>`;
    const cards = [];
    if (can("cases.design") && !keyMode) cards.push(card("Việc thiết kế của tôi", jobs.filter((x) => open(x) && x.designer === me && ["", "design", "fix"].includes(x.stage)), "Không có ca nào đang chờ bạn thiết kế.", "mine"));
    if (can("cases.qc")) cards.push(card("Chờ QC", jobs.filter((x) => x.stage === "qc" && (!x.qcBy || x.qcBy === me || keyMode || can("cases.all"))), "Không có ca nào chờ QC.", "qc"));
    if (can("cases.deliver")) cards.push(card("Đã qua QC, chờ gửi khách", jobs.filter((x) => x.stage === "ready" && open(x)), "Không có ca nào chờ gửi.", "ready"));
    if (can("cases.assign")) cards.push(card("Chưa giao KTV", jobs.filter((x) => open(x) && !x.designer), "Ca nào cũng đã có người làm.", "none"));
    if (can("cases.chat_read")) cards.push(card("Khách vừa nhắn", jobs.filter((x) => needsReply(x, seen)), "Không có tin nhắn mới của khách."));
    if (can("billing.edit")) cards.push(card("Thanh toán chờ xác nhận", jobs.filter((x) => x.pay === "check"), "Không có khoản nào chờ xác nhận.", "check"));
    if (can("messages.view")) {
      const unread = messages.filter((m) => !seenMsgs.has(m.id)).length;
      cards.push(`<section class="card"><div class="dash-h"><h2 class="h-caps">Tin nhắn từ trang web</h2><b>${unread}</b></div><p class="none">${unread ? "Có tin nhắn mới chưa đọc." : "Không có tin nhắn mới."} <a href="#messages">Mở hộp thư</a></p></section>`);
    }
    if (!cards.length) cards.push(`<section class="card"><h2 class="h-caps">Ca hàng</h2><p class="none">Các ca được giao cho bạn sẽ hiện ở đây. <a href="#jobs">Xem danh sách ca</a></p></section>`);
    host.innerHTML = cards.join("");
    host.querySelectorAll("[data-who]").forEach((a) => a.addEventListener("click", () => { jobWho = a.dataset.who; $("jobWho").value = jobWho; jobFilter = "all"; }));
  }

  /* ------------------------------------------------------------ one customer */
  async function openCustomer(email) {
    setBand("Khách hàng", email, { back: true, backHref: "#customers", backText: "Khách hàng" });
    const host = $("p-customer");
    show("p-customer", true);
    host.innerHTML = D8.skel.page();
    try { await Promise.all([users.length ? null : api("/api/admin/users").then((u) => { users = u.users || []; }), jobsAt ? null : loadJobs(true)]); }
    catch (err) { host.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
    const u = users.find((x) => x.email === email) || { email, name: "", practice: "", country: "", phone: "" };
    const mine = jobs.filter((x) => x.owner === email);
    const tu = trialUse(email);
    setBand(u.name || email, [u.practice, u.country].filter(Boolean).join(" · ") || email, { back: true, backHref: "#customers", backText: "Khách hàng" });
    show("p-customer");
    host.innerHTML = `<div class="pt-grid"><div>
        <section class="card"><div class="card-head-row"><h2 class="h-caps">Các ca của khách</h2><span class="chip">${mine.length} ca</span></div>
          ${mine.length ? `<div class="pt-list">${mine.map((x) => `<a class="pt-row" href="#jobs/${esc(x.id)}"><div><span class="id">${esc(x.id)}</span><span class="ttl">${esc(x.title)}</span></div>
            <span class="meta">Gửi ${esc(D8.fmtDate(x.created, true))} · cập nhật ${esc(D8.ago(x.updated))}</span>
            <span class="right">${stChip(x.status)}${x.trial ? '<span class="badge-trial">Dùng thử</span>' : ""}${payChip(x)}</span></a>`).join("")}</div>` : '<p class="muted" style="margin:0">Khách chưa gửi ca nào.</p>'}
        </section>
        ${dbOn ? `<section class="card"><h2 class="h-caps">Hồ sơ khách hàng</h2><div id="custLink"><p class="muted" style="margin:0">Đang tải…</p></div></section>` : ""}
      </div><aside>
        <section class="card"><h2 class="h-caps" style="margin-bottom:16px">Hồ sơ</h2><dl class="dl">
          <div><dt>Tên</dt><dd>${esc(u.name || "—")}</dd></div><div><dt>Email</dt><dd><a href="mailto:${esc(email)}">${esc(email)}</a></dd></div>
          <div><dt>Lab / phòng khám</dt><dd>${esc(u.practice || "—")}</dd></div><div><dt>Quốc gia</dt><dd>${esc(u.country || "—")}</dd></div>
          <div><dt>Điện thoại</dt><dd>${esc(u.phone || "—")}</dd></div>
          <div><dt>Đăng nhập đầu</dt><dd>${u.created ? esc(D8.fmtDate(u.created)) : "—"}</dd></div><div><dt>Gần nhất</dt><dd>${u.last ? esc(D8.ago(u.last)) : "—"}</dd></div></dl></section>
        ${can("staff.manage") ? `<section class="card" id="custAccess"><h2 class="h-caps" style="margin-bottom:12px">Khu làm việc</h2><p class="muted" style="margin:0">Đang tải…</p></section>` : ""}
        ${can("billing.view") ? `<section class="card"><h2 class="h-caps" style="margin-bottom:12px">Dùng thử</h2><p class="muted" style="margin:0">${tu.cases ? `${tu.cases} ca dùng thử, tổng giá ${esc(money(tu.used))} / mức ${esc(money(TRIAL_CREDIT))}. Phần vượt do bạn thương lượng với khách.` : "Không có ca dùng thử."}</p></section>` : ""}
      </aside></div>`;
    if ($("custAccess")) drawAccess(email, u);
    if ($("custLink") && D8.book) D8.book.customers().then((cs) => {
      const c = cs.find((x) => (x.logins || []).includes(email)), box = $("custLink"); if (!box) return;
      box.innerHTML = c ? `<p style="margin:0 0 12px">Tài khoản này thuộc khách <b>${esc(c.code)}</b> — ${esc(c.name)}. Đơn hàng, bảng giá riêng và công nợ ở hồ sơ khách.</p><a class="btn small btn-primary" href="#cust/${c.id}">Mở hồ sơ khách</a>`
        : `<p style="margin:0 0 12px">Chưa gắn vào khách nào.</p><a class="btn small" href="#customers">Gắn ở danh sách khách hàng</a>`;
    }).catch(() => {});
  }

  // A customer account is locked out of the workspace until someone with staff.manage grants it a role.
  async function drawAccess(email, u) {
    let d;
    try { d = await api("/api/staff"); } catch { if ($("custAccess")) $("custAccess").hidden = true; return; }
    const box = $("custAccess");
    if (!box) return;
    const head = '<h2 class="h-caps" style="margin-bottom:12px">Khu làm việc</h2>';
    const rec = d.staff.find((x) => x.email === email);
    if (rec) {
      box.innerHTML = head + `<p style="margin:0 0 12px;line-height:1.6">Tài khoản này là nhân sự: <b>${esc(rec.owner ? "Chủ tài khoản" : (d.roles[rec.role] || {}).label || rec.role)}</b>${rec.active === false ? " (đang khóa)" : ""}.</p><a class="btn small" href="#staff">Sửa ở Nhân sự &amp; phân quyền</a>`;
      return;
    }
    box.innerHTML = head + `<p class="muted" style="margin:0 0 12px;line-height:1.6">Tài khoản khách hàng: chỉ thấy trang web và cổng khách hàng, bị khóa khu làm việc.</p>
      <label class="field-label" for="caRole">Vai trò khi cấp quyền</label>
      <select class="input" id="caRole">${Object.entries(d.roles).map(([k, r]) => `<option value="${esc(k)}"${k === "designer" ? " selected" : ""}>${esc(r.label)}</option>`).join("")}</select>
      <button class="btn btn-primary small" type="button" id="caGrant" style="margin-top:12px">Cấp quyền khu làm việc</button><p class="hint" style="margin:8px 0 0">Bấm 2 lần để xác nhận.</p>`;
    armed($("caGrant"), async () => {
      await api("/api/staff", { method: "POST", body: { email, role: $("caRole").value, perms: null, active: true, name: (u && u.name) || "" } });
      staffData = null; loadTeam();
      D8.toast("Đã cấp quyền: " + email + " vào được khu làm việc.");
      drawAccess(email, u);
    });
  }

  /* ------------------------------------------------------------ staff and permissions */
  let staffData = null, roleDraft = null;
  async function drawStaff() {
    setBand("Nhân sự & phân quyền", "Ai vào được khu làm việc và được làm gì");
    const host = $("p-staff");
    if (!staffData) host.innerHTML = D8.skel.card(5) + D8.skel.card(6);
    try {
      const [s, u] = await Promise.all([api("/api/staff"), api("/api/admin/users").catch(() => null)]);
      staffData = s; staffData.accounts = u ? u.users || [] : null;
      roleDraft = JSON.parse(JSON.stringify(staffData.roles));
    }
    catch (err) { host.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
    renderStaff();
  }
  const slugify = (s, taken) => {
    let k = String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);
    if (!/^[a-z]/.test(k)) k = "role_" + k;
    if (k.length < 2) k = "role";
    let out = k, n = 2;
    while (taken.includes(out)) out = (k.slice(0, 20) + "_" + n++);
    return out;
  };
  function renderStaff() {
    const host = $("p-staff");
    const { staff, roles, perms } = staffData;
    const roleName = (k) => (roles[k] ? roles[k].label : k);
    const groups = [...new Set(perms.map((p) => p.group))];
    const roleOpts = (sel) => Object.entries(roles).map(([k, r]) => `<option value="${esc(k)}"${k === sel ? " selected" : ""}>${esc(r.label)}</option>`).join("");
    const meEmail = myEmail();
    const rows = staff.map((s, i) => {
      const own = s.owner;
      const permList = Array.isArray(s.perms) ? s.perms : null;
      return `<tr class="staff-row${s.active === false ? " off" : ""}">
        <td><b>${esc(s.name || s.email.split("@")[0])}</b>${own ? '<span class="tag">Chủ</span>' : ""}${s.email === meEmail ? '<span class="tag">Bạn</span>' : ""}<small>${esc(s.email)}</small></td>
        <td>${own ? esc(roleName("admin")) : `<select class="input" data-role="${i}" style="height:40px;min-width:180px">${roleOpts(s.role)}</select>`}</td>
        <td>${own ? "Tất cả" : permList ? `Quyền riêng (${permList.length})` : "Theo vai trò"}</td>
        <td>${s.last ? esc(D8.ago(s.last)) : '<span class="muted">Chưa đăng nhập</span>'}</td>
        <td>${own ? "" : `<div class="row-tools">${(permList || (roles[s.role] || { perms: [] }).perms).includes("cases.design") ? `<a class="btn small" href="#team/${encodeURIComponent(s.email)}">Trang KTV</a>` : ""}<button class="btn small" type="button" data-perm="${i}">Sửa quyền</button>
          <button class="btn small" type="button" data-active="${i}">${s.active === false ? "Mở lại" : "Khóa"}</button>
          <button class="btn small btn-danger" type="button" data-remove="${i}">Xóa</button></div>`}</td></tr>
        ${own ? "" : `<tr hidden data-permrow="${i}"><td colspan="5"><div class="perm-grid">${groups.map((g) => `<p class="grp">${esc(g)}</p>` + perms.filter((p) => p.group === g).map((p) =>
          `<label><input type="checkbox" data-pk="${esc(p.key)}"${(permList || (roles[s.role] || { perms: [] }).perms).includes(p.key) ? " checked" : ""}> ${esc(p.label)}</label>`).join("")).join("")}</div>
          <div class="wf-actions"><button class="btn btn-primary small" type="button" data-psave="${i}">Lưu quyền riêng</button><button class="btn small" type="button" data-preset="${i}">Dùng quyền theo vai trò</button></div></td></tr>`}`;
    }).join("");
    const rk = Object.keys(roleDraft);
    const matrix = `<div class="tbl-wrap"><table class="grid-tbl matrix" style="min-width:${300 + rk.length * 130}px"><thead><tr><th>Quyền</th>${rk.map((k) => `<th class="r">
        ${k === "admin" ? esc(roleDraft[k].label) : `<input class="input" data-rlabel="${esc(k)}" value="${esc(roleDraft[k].label)}" maxlength="60" style="height:34px;text-align:center;font-size:13px">`}
        ${k === "admin" ? '<small class="muted">luôn đủ quyền</small>' : `<button class="btn small btn-danger rm" type="button" data-rdel="${esc(k)}">Xóa</button>`}</th>`).join("")}</tr></thead><tbody>
      ${groups.map((g) => `<tr class="grp-row"><td colspan="${rk.length + 1}">${esc(g)}</td></tr>` + perms.filter((p) => p.group === g).map((p) => `<tr><td>${esc(p.label)}</td>${rk.map((k) =>
        `<td class="c"><input type="checkbox" data-rk="${esc(k)}" data-rp="${esc(p.key)}"${roleDraft[k].perms.includes(p.key) ? " checked" : ""}${k === "admin" ? " disabled" : ""} aria-label="${esc(roleDraft[k].label + ": " + p.label)}"></td>`).join("")}</tr>`).join("")).join("")}
      </tbody></table></div>`;
    host.innerHTML = `<section class="card"><div class="card-head"><div><h2 class="h-caps">Nhân sự</h2><p class="muted" style="margin:6px 0 0;font-size:13px;line-height:1.6">Người đăng nhập Google bằng email trong danh sách này vào được khu làm việc với quyền của vai trò. Người khác chỉ là khách hàng. Quyền đổi có hiệu lực trong vòng vài giây.</p></div></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nhân sự</th><th>Vai trò</th><th>Quyền</th><th>Đăng nhập gần nhất</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        <form class="add-row" id="stAdd"><input class="input" type="email" id="stEmail" placeholder="Email Google của nhân sự mới" required autocomplete="off"><select class="input" id="stRole">${roleOpts("designer")}</select><button class="btn btn-primary" type="submit">Thêm nhân sự</button></form>
        <p class="error" id="stErr" hidden></p></section>
      ${staffData.accounts ? `<section class="card" id="stAccounts"><div class="card-head"><div><h2 class="h-caps">Cấp quyền cho tài khoản khách</h2><p class="muted" style="margin:6px 0 0;font-size:13px;line-height:1.6">Tài khoản đã đăng nhập Google ở cổng khách hàng nhưng chưa được cấp quyền: chỉ thấy trang web và cổng khách hàng, bị khóa khu làm việc. Chọn vai trò rồi bấm <b>Cấp quyền</b> (bấm 2 lần để xác nhận) để đưa vào nhân sự.</p></div></div>
        <input class="input" id="acQ" type="search" placeholder="Tìm theo tên, email, labo / phòng khám" autocomplete="off" style="margin-bottom:6px"><div id="acList"></div></section>` : ""}
      <section class="card"><div class="card-head"><div><h2 class="h-caps">Vai trò &amp; quyền</h2><p class="muted" style="margin:6px 0 0;font-size:13px">Tick quyền cho từng vai trò. Thêm vai trò mới (ví dụ Trưởng nhóm) nếu cần.</p></div></div>
        ${matrix}
        <div class="add-row"><input class="input" id="rNew" placeholder="Tên vai trò mới, ví dụ Trưởng nhóm" maxlength="60"><button class="btn small" type="button" id="rAdd">+ Thêm vai trò</button><button class="btn btn-primary" type="button" id="rSave">Lưu vai trò &amp; quyền</button></div>
        <p class="error" id="rErr" hidden></p></section>`;

    const err = (m) => { $("stErr").textContent = m; $("stErr").hidden = !m; };
    const save = async (s, patch, btn) => {
      err(""); if (btn) D8.busy(btn, true);
      try {
        await api("/api/staff", { method: "POST", body: { email: s.email, role: s.role, perms: Array.isArray(s.perms) ? s.perms : null, active: s.active !== false, name: s.name || "", ...patch } });
        await drawStaff(); loadTeam(); D8.toast("Đã lưu.");
      } catch (ex) { if (btn && btn.isConnected) D8.busy(btn, false); err(ex.message); }
    };
    host.querySelectorAll("[data-role]").forEach((sel) => sel.addEventListener("change", () => save(staff[+sel.dataset.role], { role: sel.value })));
    host.querySelectorAll("[data-perm]").forEach((b) => b.addEventListener("click", () => { const r = host.querySelector(`[data-permrow="${b.dataset.perm}"]`); r.hidden = !r.hidden; }));
    host.querySelectorAll("[data-psave]").forEach((b) => b.addEventListener("click", () => {
      const r = host.querySelector(`[data-permrow="${b.dataset.psave}"]`);
      save(staff[+b.dataset.psave], { perms: [...r.querySelectorAll("[data-pk]:checked")].map((x) => x.dataset.pk) }, b);
    }));
    host.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => save(staff[+b.dataset.preset], { perms: null }, b)));
    host.querySelectorAll("[data-active]").forEach((b) => b.addEventListener("click", () => { const s = staff[+b.dataset.active]; save(s, { active: s.active === false }, b); }));
    host.querySelectorAll("[data-remove]").forEach((b) => armed(b, async () => { await api("/api/staff/" + encodeURIComponent(staff[+b.dataset.remove].email), { method: "DELETE" }); await drawStaff(); loadTeam(); D8.toast("Đã xóa nhân sự."); }));
    $("stAdd").addEventListener("submit", (e) => { e.preventDefault(); save({ email: $("stEmail").value.trim(), role: $("stRole").value }, {}, $("stAdd").querySelector("[type=submit]")); });
    // customer accounts (signed in, not staff) that can be granted workspace access
    if ($("acList")) {
      const staffMails = new Set(staff.map((s) => s.email));
      const pool = staffData.accounts.filter((a) => !staffMails.has(a.email));
      const drawAc = () => {
        const fold = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().trim();
        const q = fold($("acQ").value);
        const hit = pool.filter((a) => !q || fold([a.name, a.email, a.practice].join(" ")).includes(q));
        $("acList").innerHTML = hit.length ? hit.slice(0, 8).map((a) => `<div class="ac-row"><div><b>${esc(a.name || a.email.split("@")[0])}</b><small>${esc(a.email)}${a.practice ? " · " + esc(a.practice) : ""}${a.last ? " · đăng nhập " + esc(D8.ago(a.last)) : ""}</small></div>
            <select class="input" data-acrole="${esc(a.email)}" aria-label="Vai trò cho ${esc(a.email)}">${roleOpts("designer")}</select>
            <button class="btn small btn-primary" type="button" data-grant="${esc(a.email)}">Cấp quyền</button></div>`).join("")
            + (hit.length > 8 ? `<p class="hint" style="margin:10px 0 0">Còn ${hit.length - 8} tài khoản nữa — gõ để tìm.</p>` : "")
          : `<p class="muted" style="margin:8px 0 0">${pool.length ? "Không có tài khoản nào khớp." : "Chưa có tài khoản khách nào đăng nhập."}</p>`;
        $("acList").querySelectorAll("[data-grant]").forEach((b) => armed(b, async () => {
          const email = b.dataset.grant, role = $("acList").querySelector(`[data-acrole="${CSS.escape(email)}"]`).value;
          await api("/api/staff", { method: "POST", body: { email, role, perms: null, active: true, name: (pool.find((a) => a.email === email) || {}).name || "" } });
          await drawStaff(); loadTeam(); D8.toast("Đã cấp quyền: " + email + " vào được khu làm việc.");
        }));
      };
      $("acQ").addEventListener("input", drawAc);
      drawAc();
    }

    // roles matrix (edited as a draft, saved together)
    host.querySelectorAll("[data-rk]").forEach((c) => c.addEventListener("change", () => {
      const r = roleDraft[c.dataset.rk], p = c.dataset.rp;
      r.perms = c.checked ? [...new Set([...r.perms, p])] : r.perms.filter((x) => x !== p);
    }));
    host.querySelectorAll("[data-rlabel]").forEach((i) => i.addEventListener("input", () => { roleDraft[i.dataset.rlabel].label = i.value; }));
    host.querySelectorAll("[data-rdel]").forEach((b) => armed(b, async () => { delete roleDraft[b.dataset.rdel]; renderStaff(); }));
    $("rAdd").addEventListener("click", () => {
      const label = $("rNew").value.trim(); if (!label) return $("rNew").focus();
      roleDraft[slugify(label, Object.keys(roleDraft))] = { label, perms: ["cases.notes"] };
      renderStaff();
    });
    $("rSave").addEventListener("click", async (e) => {
      const b = e.currentTarget; $("rErr").hidden = true; D8.busy(b, true);
      try { await api("/api/roles", { method: "POST", body: { roles: roleDraft } }); await drawStaff(); loadTeam(); D8.toast("Đã lưu vai trò và quyền."); }
      catch (ex) { if (b.isConnected) D8.busy(b, false); $("rErr").textContent = ex.message; $("rErr").hidden = false; }
    });
  }

  /* ------------------------------------------------------------ CSV exports (open in Excel) */
  const userName = (email) => (users.find((u) => u.email === email) || {}).name || "";
  $("jobCsv").addEventListener("click", async () => {
    await loadJobs(true);
    if (!users.length) { try { users = (await api("/api/admin/users")).users || []; } catch {} }
    csvDownload("D8-ca-hang-" + today() + ".csv", [["Mã ca", "Ngày gửi", "Khách", "Email", "Tên ca", "Dịch vụ", "Trạng thái", "Dùng thử", "Giá (USD)", "Thanh toán", "Cập nhật"],
      ...jobs.map((x) => [x.id, new Date(x.created).toLocaleString("vi-VN"), x.ownerName || userName(x.owner), x.owner, x.title, D8.svcLabel(x.service),
        D8.statusLabel(x.status), x.trial ? "Có" : "", typeof x.price === "number" ? x.price : "", PAY_LABEL[x.pay || ""], new Date(x.updated).toLocaleString("vi-VN")])]);
  });
  document.addEventListener("click", (e) => { if (e.target && e.target.id === "custCsv") custCsv(); });
  const custCsv = () => {
    const per = {}; jobs.forEach((x) => { per[x.owner] = (per[x.owner] || 0) + 1; });
    csvDownload("D8-khach-hang-" + today() + ".csv", [["Tên", "Email", "Lab / phòng khám", "Quốc gia", "Điện thoại", "Số ca", "Đăng nhập lần đầu", "Lần gần nhất"],
      ...users.map((u) => [u.name, u.email, u.practice, u.country, u.phone, per[u.email] || 0, u.created ? new Date(u.created).toLocaleString("vi-VN") : "", u.last ? new Date(u.last).toLocaleString("vi-VN") : ""])]);
  };
  $("msgCsv").addEventListener("click", () => {
    csvDownload("D8-tin-nhan-" + today() + ".csv", [["Ngày", "Tên", "Email", "Lab / phòng khám", "Quốc gia", "Chủ đề", "Nội dung"],
      ...messages.map((m) => [new Date(m.created).toLocaleString("vi-VN"), m.name, m.email, m.practice, m.country, m.service, m.message])]);
  });

  /* ------------------------------------------------------------ 3D links (exocad HTML) */
  const MAX_INPUT = 100 * 1024 * 1024;
  const MAX_STORED = 25 * 1024 * 1024;
  const pending = new Map();
  const removed = new Set();
  let file = null;

  // The 3D file is served in a sandbox where browser storage is switched off. exocad needs localStorage
  // for its settings, so a small in-memory stand-in goes at the top of <head> before uploading.
  const STORAGE_SHIM = "<scr" + "ipt>/*d8-storage-shim*/let localStorage=(function(){" +
    "function mem(){var d=Object.create(null);return{" +
      "getItem:function(k){k=String(k);return k in d?d[k]:null}," +
      "setItem:function(k,v){d[String(k)]=String(v)}," +
      "removeItem:function(k){delete d[String(k)]}," +
      "clear:function(){d=Object.create(null)}," +
      "key:function(i){var a=Object.keys(d);return i<a.length?a[i]:null}," +
      "get length(){return Object.keys(d).length}}}" +
    "try{var s=window.localStorage;s.length;return s}catch(e){}" +
    "var m=mem();" +
    "try{Object.defineProperty(window,'localStorage',{value:m,configurable:true,enumerable:true,writable:true})}catch(e){}" +
    "try{Object.defineProperty(window,'sessionStorage',{value:mem(),configurable:true,enumerable:true,writable:true})}catch(e){}" +
    "return m})();</scr" + "ipt>";
  async function withStorageShim(f) {
    const head = new Uint8Array(await f.slice(0, 65536).arrayBuffer());
    const text = new TextDecoder("windows-1252").decode(head);
    if (text.includes("d8-storage-shim")) return f;
    const m = /<head\b[^>]*>/i.exec(text) || /<html\b[^>]*>/i.exec(text);
    const at = m ? m.index + m[0].length : 0;
    return new Blob([f.slice(0, at), STORAGE_SHIM, f.slice(at)], { type: "text/html" });
  }
  async function compress(f) {
    if (!("CompressionStream" in window)) return null;
    return await new Response(f.stream().pipeThrough(new CompressionStream("gzip"))).blob();
  }
  function xhrUpload(body, headers, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("POST", "/api/upload");
      Object.entries({ ...D8.authHeaders(), ...headers }).forEach(([k, v]) => x.setRequestHeader(k, v));
      x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onload = () => {
        let data = {}; try { data = JSON.parse(x.responseText); } catch {}
        if (x.status >= 200 && x.status < 300) resolve(data);
        else reject(Object.assign(new Error(data.error || ("Lỗi máy chủ (" + x.status + ").")), { status: x.status }));
      };
      x.onerror = () => reject(new Error("Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại."));
      x.send(body);
    });
  }
  async function checkHtml(f) {
    if (!/\.html?$/i.test(f.name)) throw new Error("Chỉ nhận file .html xuất từ exocad.");
    if (f.size > MAX_INPUT) throw new Error("File lớn hơn 100 MB, không tải lên được.");
    const head = await f.slice(0, 4096).text();
    if (!/<html|<!doctype|<\!--/i.test(head)) throw new Error("File này không phải file HTML.");
  }
  async function createLink(f, label, days, onProgress, og = {}) {
    await checkHtml(f);
    onProgress(0, "Đang chuẩn bị và nén file…");
    const prepared = await withStorageShim(f);
    const gz = await compress(prepared);
    const body = gz || prepared;
    if (body.size > MAX_STORED) throw new Error("File sau khi nén vẫn lớn hơn 25 MB (" + fmtMB(body.size) + "), vượt giới hạn lưu trữ mỗi file.");
    const data = await xhrUpload(body, {
      "X-Case-Label": encodeURIComponent(label), "X-Expire-Days": String(days), "X-Content-Encoding": gz ? "gzip" : "identity",
      "X-Original-Size": String(prepared.size), "Content-Type": "application/octet-stream",
      "X-OG-Title": encodeURIComponent(og.title || ""), "X-OG-Desc": encodeURIComponent(og.desc || ""), "X-Order-Id": String(og.orderId || 0),
    }, (p) => onProgress(p, p < 1 ? "Đang tải lên " + Math.round(p * 100) + "% (" + fmtMB(body.size) + ")" : "Đang lưu…"));
    onProgress(1, "Xong.");
    return data;
  }

  const drop = $("drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files.length) pickFile(e.dataTransfer.files[0]); });
  $("file").addEventListener("change", (e) => { if (e.target.files.length) pickFile(e.target.files[0]); });
  async function pickFile(f) {
    $("uploadError").hidden = true;
    resetForm(true);
    try { await checkHtml(f); } catch (err) { return showUploadError(err.message); }
    file = f;
    drop.classList.add("has-file");
    $("dropTitle").textContent = f.name;
    $("dropSub").textContent = fmtMB(f.size) + ". Bấm hoặc kéo file khác vào để đổi.";
    $("create").disabled = false;
  }
  function showUploadError(msg) { $("uploadError").textContent = msg; $("uploadError").hidden = false; }
  function setProgress(fraction, text) { $("progress").hidden = false; $("progressFill").style.width = Math.round(fraction * 100) + "%"; $("progressText").textContent = text; }
  const selectedDays = () => (document.querySelector('input[name="days"]:checked') || {}).value || "30";
  $("create").addEventListener("click", async () => {
    if (!file) return;
    $("uploadError").hidden = true; $("create").disabled = true; busy = true;
    try {
      const used = file, ord = linkOrder;
      const data = await createLink(file, $("label").value.trim(), selectedDays(), setProgress, { title: $("label").value.trim(), desc: $("ogDesc") ? $("ogDesc").value.trim() : "", orderId: ord ? ord.id : 0 });
      pending.set(data.id, data);
      showResult(data);
      resetForm();
      refreshList();
      if (ord) api(`/api/orders/${ord.id}/previews`, { method: "POST", body: { linkId: data.id } }).then(() => D8.toast("Đã gắn link vào đơn " + ord.code + ".")).catch((e) => D8.toast(e.message));
      snapFor(used, data);
    } catch (err) { showUploadError(err.message); $("create").disabled = !file; }
    finally { busy = false; setTimeout(() => { $("progress").hidden = true; }, 1200); }
  });
  function resetForm(keepLabel) {
    file = null;
    $("file").value = "";
    if (!keepLabel) { $("label").value = ""; if ($("ogDesc")) $("ogDesc").value = ""; if ($("ogOrder")) $("ogOrder").value = ""; linkOrder = null; ogLooked = ""; if ($("ogOrderHint")) $("ogOrderHint").textContent = ""; }
    drop.classList.remove("has-file");
    $("dropTitle").textContent = "Kéo file HTML xuất từ exocad vào đây";
    $("dropSub").textContent = "hoặc bấm để chọn file";
    $("create").disabled = true;
  }

  // preview picture for chat apps: capture the design, frame it, upload it
  let snapCtl = null, linkOrder = null;
  async function snapFor(f, item) {
    if (!D8.snap || !$("snapBox")) return;
    if (snapCtl) { snapCtl.destroy(); snapCtl = null; }
    const box = $("snapBox"), say = (t) => { $("snapSay").textContent = t; };
    box.hidden = false; $("snapStage").innerHTML = ""; $("snapImg").src = "/og/" + item.id + ".jpg";
    $("snapT").textContent = item.title || item.label || "3D design preview"; $("snapD").textContent = item.desc || "D.EIGHT DESIGN CENTER"; $("snapHost").textContent = location.host;
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
  let ogLooked = "";
  if ($("ogOrder")) $("ogOrder").addEventListener("change", async () => {
    // the hint keeps its line while looking up, so nothing below moves (a click on "Tạo link" must not miss)
    const code = $("ogOrder").value.trim();
    if (code === ogLooked) return;
    ogLooked = code; linkOrder = null;
    if (!code) { $("ogOrderHint").textContent = ""; return; }
    try {
      const d = await api("/api/orders?status=&limit=5&q=" + encodeURIComponent(code));
      const want = code.toUpperCase().replace(/[\s/._-]+/g, "");
      const o = d.items.find((x) => x.code === want) || d.items[0];
      if (!o) { $("ogOrderHint").textContent = "Không tìm thấy đơn này."; return; }
      linkOrder = o;
      const t = D8.ogText(o, (o.previews || []).length, true);
      $("label").value = t.title; $("ogDesc").value = t.desc;
      $("ogOrderHint").textContent = "Đơn " + o.code + " · " + o.customer_name + (o.patient ? " · " + o.patient : "");
    } catch (err) { $("ogOrderHint").textContent = err.message; }
  });
  function messageEn(item) {
    const what = item.title || item.label || "your case";
    return "Hi Dr. [Name],\n\nThe 3D design for " + what + " is ready for your review. It opens in any browser on your phone or computer, no software needed:\n\n" +
      item.url + "\n\nThe link is available until " + fmtDateEn(item.expires) + ". Let me know if you would like any adjustments.\n\nD.EIGHT DESIGN CENTER";
  }
  function messageVi(item) {
    const what = item.title || item.label || "ca của bác sĩ";
    return "Chào bác sĩ [Tên],\n\nThiết kế 3D cho " + what + " đã sẵn sàng để bác sĩ xem. Bác sĩ mở được bằng bất kỳ trình duyệt nào trên điện thoại hoặc máy tính, không cần cài phần mềm:\n\n" +
      item.url + "\n\nLink dùng được đến " + fmtDateVi(item.expires) + ". Nếu cần chỉnh sửa gì, bác sĩ cứ báo cho tôi.\n\nD.EIGHT DESIGN CENTER";
  }
  let shown = null;
  function showResult(item) {
    shown = item;
    $("result").hidden = false;
    $("resUrl").textContent = item.url; $("resUrl").href = item.url; $("openLink").href = item.url;
    $("resSub").textContent = (item.label || "Chưa đặt tên ca") + ", dùng được đến " + fmtDateVi(item.expires);
    $("msgEn").textContent = messageEn(item);
    $("msgVi").textContent = messageVi(item);
    renderQr(item);
    resetButton($("copyLink"), "Sao chép link");
    resetButton($("copyMsg"), "Sao chép tin nhắn gửi bác sĩ");
    $("result").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function renderQr(item) {
    if (typeof window.qrcode !== "function") { $("qrBox").hidden = true; return; }
    try {
      const qr = window.qrcode(0, "M"); qr.addData(item.url); qr.make();
      $("qrCode").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      $("qrDownload").href = qr.createDataURL(8, 4);
      $("qrDownload").download = "QR-" + (item.label ? item.label.replace(/[^\w-]+/g, "-") : item.id) + ".gif";
      $("qrBox").hidden = false;
    } catch { $("qrBox").hidden = true; }
  }
  $("copyLink").addEventListener("click", (e) => shown && copy(shown.url, e.currentTarget, "Đã sao chép link"));
  $("copyMsg").addEventListener("click", (e) => shown && copy(messageEn(shown), e.currentTarget, "Đã sao chép tin nhắn"));
  async function copy(text, btn, doneText) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); try { ok = document.execCommand("copy"); } catch {} ta.remove();
    }
    if (!btn) return;
    const original = btn.dataset.label || btn.textContent;
    btn.dataset.label = original;
    btn.textContent = ok ? doneText : "Không sao chép được";
    btn.classList.toggle("done", ok);
    clearTimeout(btn._t); btn._t = setTimeout(() => resetButton(btn, original), 1800);
  }
  function resetButton(btn, text) { clearTimeout(btn._t); btn.textContent = text; btn.dataset.label = text; btn.classList.remove("done"); }

  async function refreshList() {
    try { renderList(await api("/api/list")); $("listError").hidden = true; }
    catch (err) { $("listError").textContent = err.message; $("listError").hidden = false; }
  }
  function renderList(data) {
    const ul = $("cases");
    ul.innerHTML = "";
    const listed = new Set(data.items.map((i) => i.id));
    for (const [id, item] of pending) { if (listed.has(id) || item.expires <= Date.now()) pending.delete(id); else data.items.unshift(item); }
    data.items = data.items.filter((i) => !removed.has(i.id));
    // the quota is shared by everyone: the server counts all links, the list shows only one's own (unless allowed all)
    const used = Math.max(data.usedBytes || 0, data.items.reduce((t, i) => t + (i.storedSize || 0), 0)), quota = data.quotaBytes || 1;
    $("usage").innerHTML = `<div class="caps">Đã dùng ${esc(fmtMB(used))} / ${quota >= 1073741824 ? "1 GB" : esc(fmtMB(quota))}</div>
      <div class="meter"><i style="width:${Math.min(100, Math.max(0.5, (used / quota) * 100)).toFixed(1)}%"></i></div>`;
    if (!data.items.length) {
      ul.innerHTML = '<p class="empty"><img src="/brand/symbol.svg" alt=""><span>Chưa có link nào. Kéo file HTML vào khung phía trên để tạo link đầu tiên.</span></p>';
      return;
    }
    const now = Date.now();
    for (const item of data.items) {
      const url = location.origin + "/v/" + item.id;
      const daysLeft = Math.max(0, Math.ceil((item.expires - now) / 86400000));
      const frac = Math.max(0, Math.min(1, (item.expires - now) / (item.expires - item.created)));
      const li = document.createElement("li");
      li.className = "case";
      li.innerHTML = `<div class="case-main"><div class="case-title${item.label ? "" : " untitled"}">${esc(item.label || "Chưa đặt tên ca")}</div>
        <div class="case-meta">Tạo ${esc(fmtDateTimeVi(item.created))}${item.by ? " bởi " + esc(teamName(item.by)) : ""}, còn ${daysLeft} ngày (đến ${esc(fmtDateVi(item.expires))}), ${esc(fmtMB(item.storedSize || 0))}</div>
        <div class="drain${daysLeft <= 3 ? " low" : ""}"><i style="width:${(frac * 100).toFixed(1)}%"></i></div></div>
        <div class="case-actions"><button class="btn small" data-act="copy">Sao chép link</button><a class="btn small" target="_blank" rel="noopener" href="${esc(url)}">Mở</a>
          <button class="btn small" data-act="qr">QR và tin nhắn</button><button class="btn small btn-danger" data-act="del">Xóa</button></div>`;
      li.querySelector('[data-act="copy"]').addEventListener("click", (e) => copy(url, e.currentTarget, "Đã sao chép"));
      li.querySelector('[data-act="qr"]').addEventListener("click", () => showResult({ ...item, url }));
      const del = li.querySelector('[data-act="del"]');
      del.addEventListener("click", async () => {
        if (!del.classList.contains("armed")) {
          del.classList.add("armed"); del.textContent = "Bấm lần nữa để xóa";
          clearTimeout(del._t); del._t = setTimeout(() => { del.classList.remove("armed"); del.textContent = "Xóa"; }, 4000);
          return;
        }
        clearTimeout(del._t); del.disabled = true; del.textContent = "Đang xóa…";
        try {
          await api("/api/cases/" + item.id, { method: "DELETE" });
          removed.add(item.id); pending.delete(item.id);
          if (shown && shown.id === item.id) $("result").hidden = true;
          refreshList();
        } catch (err) {
          del.disabled = false; del.classList.remove("armed"); del.textContent = "Xóa";
          $("listError").textContent = err.message; $("listError").hidden = false;
        }
      });
      ul.appendChild(li);
    }
  }

  /* ------------------------------------------------------------ contact messages */
  const SEEN_KEY = "d8-seen-messages";
  let seenMsgs = (() => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch { return new Set(); } })();
  const saveSeen = () => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seenMsgs].slice(-500))); } catch {} };
  let messages = [], msgsLoaded = false;
  const removedMsgs = new Set();
  async function refreshMessages(quiet) {
    if (!msgsLoaded && !quiet) $("msgList").innerHTML = `<li style="list-style:none">${D8.skel.rows(2)}</li>`;
    try {
      const data = await api("/api/messages");
      messages = data.items.filter((m) => !removedMsgs.has(m.id)); msgsLoaded = true;
      renderMessages();
      $("msgError").hidden = true;
    } catch (err) { if (!quiet) { $("msgError").textContent = err.message; $("msgError").hidden = false; } }
  }
  $("msgReload").addEventListener("click", () => refreshMessages());
  $("msgReadAll").addEventListener("click", () => { messages.forEach((m) => seenMsgs.add(m.id)); saveSeen(); renderMessages(); });
  function markSeen(id) { if (!seenMsgs.has(id)) { seenMsgs.add(id); saveSeen(); renderMessages(); } }
  function renderMessages() {
    const ul = $("msgList");
    ul.innerHTML = "";
    const unread = messages.filter((m) => !seenMsgs.has(m.id)).length;
    setNavCount("/admin#messages", unread);
    $("msgReadAll").hidden = !unread;
    if (!messages.length) {
      ul.innerHTML = '<p class="empty"><img src="/brand/symbol.svg" alt=""><span>Chưa có tin nhắn nào. Khách gửi qua mục Liên hệ ở trang web sẽ hiện ở đây.</span></p>';
      return;
    }
    for (const m of messages) {
      const isNew = !seenMsgs.has(m.id);
      const li = document.createElement("li");
      li.className = "msg" + (isNew ? "" : " seen");
      const mail = "mailto:" + encodeURIComponent(m.email) + "?subject=" + encodeURIComponent("Re: Your message to D.EIGHT DESIGN CENTER");
      const where = [m.practice, m.country || (m.country_hint ? "(IP: " + m.country_hint + ")" : "")].filter(Boolean).join(" · ") || "Không ghi phòng khám/lab";
      li.innerHTML = `<div class="msg-head"><div class="msg-who"><b>${esc(m.name)}</b><span>${esc(where)}</span></div>
          <div class="msg-when">${isNew ? '<span class="chip new">Mới</span>' : ""}${m.service ? `<span class="chip">${esc(m.service)}</span>` : ""}${m.lang === "vi" ? '<span class="chip">VI</span>' : ""}<span>${esc(fmtDateTimeVi(m.created))}</span></div></div>
        <a class="msg-email" href="${esc(mail)}">${esc(m.email)}</a>
        <pre class="msg-body">${esc(m.message)}</pre>
        <div class="msg-actions"><a class="btn small btn-primary" data-act="reply" href="${esc(mail)}">Trả lời qua email</a><button class="btn small" data-act="copy">Sao chép email</button>
          ${isNew ? '<button class="btn small" data-act="seen">Đã đọc</button>' : ""}<button class="btn small btn-danger" data-act="del">Xóa</button></div>`;
      li.querySelector('[data-act="reply"]').addEventListener("click", () => setTimeout(() => markSeen(m.id), 300));
      li.querySelector('[data-act="copy"]').addEventListener("click", (e) => copy(m.email, e.currentTarget, "Đã sao chép"));
      const s = li.querySelector('[data-act="seen"]'); if (s) s.addEventListener("click", () => markSeen(m.id));
      const del = li.querySelector('[data-act="del"]');
      del.addEventListener("click", async () => {
        if (!del.classList.contains("armed")) {
          del.classList.add("armed"); del.textContent = "Bấm lần nữa để xóa";
          clearTimeout(del._t); del._t = setTimeout(() => { del.classList.remove("armed"); del.textContent = "Xóa"; }, 4000);
          return;
        }
        clearTimeout(del._t); del.disabled = true; del.textContent = "Đang xóa…";
        try {
          await api("/api/messages/" + m.id, { method: "DELETE" });
          removedMsgs.add(m.id); messages = messages.filter((x) => x.id !== m.id); renderMessages();
        } catch (err) {
          del.disabled = false; del.classList.remove("armed"); del.textContent = "Xóa";
          $("msgError").textContent = err.message; $("msgError").hidden = false;
        }
      });
      ul.appendChild(li);
    }
  }

  /* ------------------------------------------------------------ formatting */
  function fmtMB(b) { return (b / 1048576).toLocaleString("vi-VN", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + " MB"; }
  function fmtDateVi(ms) { return new Date(ms).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  function fmtDateTimeVi(ms) { return new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) + " " + fmtDateVi(ms); }
  function fmtDateEn(ms) { return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }

  boot();
})();
