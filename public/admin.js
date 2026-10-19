/* D.EIGHT admin: cases from the customer portal, 3D preview links, contact messages, customers. */
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
    out: '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M7 3H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M11 5.5 15 9l-4 3.5M15 9H7"/></svg>',
  };
  const stChip = (s) => `<span class="st st-${esc(s)}">${esc(D8.statusLabel(s))}</span>`;
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

  /* ------------------------------------------------------------ band + panels */
  const BANDS = {
    jobs: ["Ca hàng", "Ca khách gửi qua cổng khách hàng"],
    links: ["Link xem 3D", "Gửi bác sĩ xem thiết kế ngay trên trình duyệt"],
    messages: ["Tin nhắn", "Từ mục Liên hệ trên trang web"],
    customers: ["Khách hàng", "Tài khoản đăng nhập bằng Google"],
    gate: ["Quản trị", "Ca hàng, link xem 3D, tin nhắn và khách hàng"],
  };
  function setBand(title, sub, opts = {}) {
    $("bandTitle").textContent = title;
    $("bandSub").textContent = sub || "";
    $("bandSub").hidden = !sub;
    $("bandBack").hidden = !opts.back;
    $("bandEyebrow").hidden = !!opts.back;
    $("bandRight").innerHTML = opts.right || "";
  }
  function show(id) {
    $("booting").hidden = true;
    document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.id !== id; });
  }

  /* ------------------------------------------------------------ sign in */
  async function boot() {
    const u = await D8.ready;
    if (u && u.role === "admin") return enter("google");
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
    $("gateWho").innerHTML = u ? `<p class="who">Bạn đang đăng nhập bằng <b>${esc(u.email)}</b>. Tài khoản này không có quyền quản trị.
      <button class="btn small" type="button" id="gateOut" style="margin-top:10px">Đăng xuất tài khoản này</button></p>` : "";
    if (u) $("gateOut").onclick = D8.signOut;
    D8.renderGoogleButton($("gbtn"), null, { width: 320 });
  }
  document.addEventListener("d8:user", (e) => {
    if (mode || !e.detail) return;
    if (e.detail.role === "admin") enter("google"); else showGate(e.detail);
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

  function enter(m) {
    mode = m;
    document.body.dataset.authed = "1";
    D8.renderHeader();
    route();
    // Each listing is a KV "list" request (1,000 a day on the free plan), so load once and refresh sparingly.
    const h = location.hash.replace(/^#/, "") || "jobs";
    if (h !== "jobs") loadJobs(true);
    if (h !== "messages") refreshMessages(true);
    setInterval(() => { if (!document.hidden && !busy && !$("p-jobs").hidden) loadJobs(true); }, 300000);
  }

  /* ------------------------------------------------------------ router */
  function route() {
    if (!mode) return;
    const h = location.hash.replace(/^#/, "") || "jobs";
    window.scrollTo(0, 0);
    let m;
    if ((m = h.match(/^jobs\/(.+)$/)) && ID_RE.test(m[1])) return openCase(m[1]);
    current = null;
    if (h === "links") { setBand(...BANDS.links); show("p-links"); return refreshList(); }
    if (h === "messages") { setBand(...BANDS.messages); show("p-messages"); return refreshMessages(); }
    if (h === "customers") { setBand(...BANDS.customers); show("p-customers"); return loadCustomers(); }
    setBand(...BANDS.jobs);
    show("p-jobs");
    drawJobs();
    loadJobs(false, 30000);
  }
  window.addEventListener("hashchange", route);

  function setNavCount(href, n) {
    const a = document.querySelector(`.sh-sub a[href="${href}"]`);
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
      updateJobCount();
    } catch (err) { if (!quiet) { $("jobErr").textContent = err.message; $("jobErr").hidden = false; } }
  }
  const adminSeen = () => store.get("d8-admin-seen", {});
  const needsReply = (x, seen) => x.lastBy === "client" && OPEN.includes(x.status) && (seen[x.id] || 0) < x.updated;
  function updateJobCount() { const seen = adminSeen(); setNavCount("/admin#jobs", jobs.filter((x) => needsReply(x, seen)).length); }

  function drawJobs() {
    const seen = adminSeen();
    const count = (f) => jobs.filter((x) => (f === "all" ? true : f === "open" ? OPEN.includes(x.status) : x.status === f)).length;
    const filters = [["open", "Đang mở"], ...STATUSES.map((s) => [s, D8.statusLabel(s)]), ["all", "Tất cả"]];
    $("jobFilters").innerHTML = filters.map(([f, l]) => `<button type="button" data-f="${f}" aria-pressed="${jobFilter === f}">${esc(l)}<b>${count(f)}</b></button>`).join("");
    $("jobFilters").querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { jobFilter = b.dataset.f; drawJobs(); }));
    const q = jobQuery.toLowerCase();
    const shown = jobs.filter((x) => (jobFilter === "all" || (jobFilter === "open" ? OPEN.includes(x.status) : x.status === jobFilter)) &&
      (!q || (x.id + " " + x.title + " " + x.owner).toLowerCase().includes(q)));
    $("jobList").innerHTML = shown.length ? shown.map((x) => {
      const nr = needsReply(x, seen);
      return `<a class="pt-row" href="#jobs/${esc(x.id)}">
        <div><span class="id">${esc(x.id)}</span><span class="ttl">${esc(x.title)}</span><span class="owner">${esc(x.owner)}</span></div>
        <span class="meta">Gửi ${esc(D8.fmtDate(x.created, true))} · cập nhật ${esc(D8.ago(x.updated))}${x.storedMB ? " · " + x.storedMB + " MB" : ""}</span>
        <span class="right">${stChip(x.status)}${nr ? '<span class="new client">Khách vừa nhắn</span>' : ""}</span></a>`;
    }).join("") : `<div class="pt-empty"><img src="/brand/symbol.svg" alt=""><h2 class="h-caps">${jobs.length ? "Không có ca nào khớp" : "Chưa có ca nào"}</h2>
      <p>${jobs.length ? "Thử bộ lọc khác hoặc xóa ô tìm kiếm." : "Khi khách đăng nhập cổng khách hàng và gửi ca, ca sẽ hiện ở đây."}</p></div>`;
  }
  $("jobQ").addEventListener("input", () => { jobQuery = $("jobQ").value; drawJobs(); });

  /* ------------------------------------------------------------ case detail */
  async function openCase(id) {
    setBand(id, "", { back: true });
    if (!current || current.id !== id) { show("p-case"); $("p-case").innerHTML = '<div class="pt-loading"><div class="spin"></div>Đang tải ca…</div>'; }
    try { current = (await api("/api/jobs/" + id)).job; }
    catch (err) { $("p-case").innerHTML = `<div class="pt-empty"><h2 class="h-caps">Không mở được ca</h2><p>${esc(err.message)}</p><a class="btn" href="#jobs">Về danh sách ca</a></div>`; return; }
    drawCase(current);
  }

  const TEMPLATES = [
    ["Đã nhận ca", "Hi, thanks for sending this case. We have everything we need and have started the design. We'll post a 3D preview here for your review."],
    ["Cần bổ sung", "Hi, before we continue we need a little more information:\n\n- \n\nThank you!"],
    ["Đã có bản 3D", "The 3D design is ready for your review. Open the preview on this page, then approve it or tell us what you'd like changed."],
    ["Đã giao file", "Final files are uploaded and ready to download on this page. Thank you for working with D.EIGHT!"],
  ];

  function drawCase(j) {
    const seen = adminSeen(); seen[j.id] = j.updated; const ks = Object.keys(seen); if (ks.length > 500) delete seen[ks[0]]; store.set("d8-admin-seen", seen); updateJobCount();
    setBand(j.title, j.id + " · gửi " + D8.fmtDate(j.created, true), { back: true, right: stChip(j.status) });
    const st = j.status, idx = st === "needs_info" ? 0 : STEPS.indexOf(st);
    const steps = STEPS.map((s, i) => {
      const cls = st === "cancelled" ? "" : i < idx || (i === idx && s === "delivered") ? "done" : i === idx ? "cur" : "";
      return `<li class="${cls}"><span class="dot">${cls === "done" ? ICON.check : ""}</span><span class="lbl">${esc(D8.statusLabel(s))}</span></li>`;
    }).join("");
    const initials = String(j.ownerName || j.owner).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const files = j.files || [];
    const ins = files.filter((f) => f.kind !== "output"), outs = files.filter((f) => f.kind === "output");
    const fileRow = (f) => {
      const ext = (f.name.split(".").pop() || "").slice(0, 4);
      return `<li class="${f.kind === "output" ? "out" : ""}"><span class="ext">${esc(ext)}</span><div class="nm"><b title="${esc(f.name)}">${esc(f.name)}</b>
        <small>${esc(D8.size(f.size))}${f.gz ? " (lưu nén " + esc(D8.size(f.stored)) + ")" : ""} · ${esc(D8.fmtDate(f.at, true))} · lưu đến ${esc(D8.fmtDate(f.exp))}</small></div>
        <a class="iconbtn" href="/api/jobs/${esc(j.id)}/files/${esc(f.fid)}" download="${esc(f.name)}" title="Tải về" aria-label="Tải ${esc(f.name)}">${ICON.dl}</a>
        <button class="iconbtn del" type="button" data-del="${esc(f.fid)}" title="Xóa file" aria-label="Xóa ${esc(f.name)}">${ICON.trash}</button></li>`;
    };
    const previews = (j.previews || []).map((p) => `<div class="pv"><span class="ic">${ICON.cube}</span><div class="tx"><b>${esc(p.label || j.title)}</b>
      <small>Dùng được đến ${esc(D8.fmtDate(p.expires))}</small></div>
      <a class="btn small" href="${esc(p.url)}" target="_blank" rel="noopener">Mở</a>
      <button class="iconbtn del rm" type="button" data-unlink="${esc(p.id)}" title="Gỡ link khỏi ca" aria-label="Gỡ link">${ICON.x}</button></div>`).join("");
    const thread = (j.thread || []).map((m) => {
      if (m.by === "system") return `<div class="sys">${esc(D8.fmtDate(m.at, true))} · ${stChip(String(m.text).replace(/^status:/, ""))}</div>`;
      const mine = m.by === "admin";
      return `<div class="bub ${mine ? "me" : "them"}">${mine ? "" : `<b>${esc(m.name || "Khách")}</b>`}${esc(m.text)}<small>${esc(D8.fmtDate(m.at, true))}</small></div>`;
    }).join("");
    const det = [["Dịch vụ", D8.svcLabel(j.service)], ["Răng", j.teeth ? j.teeth + " (" + (j.numbering === "UNS" ? "Universal" : "FDI") + ")" : ""],
      ["Vật liệu", j.material], ["Màu răng", j.shade], ["Cần trước", j.neededBy ? D8.fmtDate(Date.parse(j.neededBy + "T12:00:00")) : ""],
      ["Ngày gửi", D8.fmtDate(j.created, true)], ["Đã duyệt", j.approvedAt ? D8.fmtDate(j.approvedAt, true) : ""]]
      .filter((r) => r[1]).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");

    show("p-case");
    $("p-case").innerHTML = `
      <div class="adm-head">
        <div class="adm-cust"><span class="av">${esc(initials)}</span><div><b>${esc(j.ownerName || j.owner)}</b>
          <a href="mailto:${esc(j.owner)}?subject=${encodeURIComponent(j.id + " · " + j.title)}">${esc(j.owner)}</a></div></div>
        <form class="stat-form" id="statForm"><label class="sr-only" for="statSel">Trạng thái</label>
          <select class="input" id="statSel">${STATUSES.map((s) => `<option value="${s}"${s === st ? " selected" : ""}>${esc(D8.statusLabel(s))}</option>`).join("")}</select>
          <button class="btn btn-primary small" type="submit">Cập nhật trạng thái</button></form>
      </div>
      <ol class="pt-steps" aria-label="Tiến độ">${steps}</ol>
      ${st === "review" ? `<div class="pt-alert info">${ICON.warn}<div>Đang chờ khách duyệt bản 3D.</div></div>` : ""}
      ${st === "approved" ? `<div class="pt-alert ok">${ICON.check}<div>Khách đã duyệt lúc ${esc(D8.fmtDate(j.approvedAt || j.updated, true))}. Xuất file hoàn chỉnh rồi tải lên ở mục Giao file.</div></div>` : ""}
      <div class="pt-grid">
        <div>
          <section class="card"><h2 class="h-caps">File của khách</h2><p class="sub">Bấm để tải về máy. File tự xóa sau 60 ngày.</p>
            ${ins.length ? `<ul class="files">${ins.map(fileRow).join("")}</ul>` : '<p class="muted" style="margin:0">Khách chưa tải file nào lên.</p>'}
            ${(j.links || []).length ? `<p class="grp" style="margin-top:18px">Link file khách gửi</p><div class="links">${j.links.map((l) => `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer">${esc(l)}</a>`).join("")}</div>` : ""}
          </section>
          <section class="card"><h2 class="h-caps">Link xem 3D</h2><p class="sub">Gắn link vào ca sẽ tự chuyển ca sang Chờ duyệt và khách thấy nút Duyệt thiết kế.</p>
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
            </div>
          </section>
          <section class="card"><h2 class="h-caps">Giao file hoàn chỉnh</h2><p class="sub">File tải lên ở đây là file khách nhận (STL đã thiết kế).</p>
            ${outs.length ? `<ul class="files">${outs.map(fileRow).join("")}</ul>` : ""}
            <div style="margin-top:14px"><label class="drop compact" id="outZone">${ICON.up}<strong>Kéo file STL hoàn chỉnh vào đây</strong><span>hoặc bấm để chọn · nhiều file cùng lúc</span><input type="file" id="outFiles" multiple></label>
              <ul class="picked" id="outList"></ul>
              <label class="check"><input type="checkbox" id="outDeliver" checked> Chuyển ca sang <b>&nbsp;Đã giao&nbsp;</b> khi tải xong</label>
              <div class="progress block" id="outProg" hidden><div class="progress-bar"><i></i></div><p></p></div>
              <p class="error" id="outErr" hidden></p>
              <div style="margin-top:12px"><button class="btn btn-primary small" type="button" id="outBtn" disabled>Tải lên &amp; giao</button></div></div>
          </section>
          <section class="card"><h2 class="h-caps">Tin nhắn với khách</h2><p class="sub">Khách thấy tin nhắn trong cổng khách hàng. Nên viết tiếng Anh.</p>
            <div class="thread" id="thread">${thread || '<p class="muted" style="margin:0">Chưa có tin nhắn.</p>'}</div>
            <form class="compose" id="composeForm">
              <div class="tpl">${TEMPLATES.map((t, i) => `<button type="button" data-tpl="${i}">${esc(t[0])}</button>`).join("")}</div>
              <label class="sr-only" for="composer">Tin nhắn</label>
              <textarea class="input" id="composer" maxlength="4000" placeholder="Viết tin nhắn cho khách…"></textarea>
              <div class="compose-foot"><p class="hint">Ctrl + Enter để gửi.</p><button class="btn btn-primary small" type="submit" id="sendMsg">Gửi</button></div>
              <p class="error" id="msgErr" hidden></p>
            </form>
          </section>
        </div>
        <aside><section class="card"><h2 class="h-caps" style="margin-bottom:16px">Thông tin ca</h2><dl class="dl">${det}</dl>
          ${j.notes ? `<p class="grp" style="margin-top:20px">Yêu cầu của khách</p><p class="notes">${esc(j.notes)}</p>` : ""}</section></aside>
      </div>`;
    const th = $("thread"); th.scrollTop = th.scrollHeight;
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

  function wireCase(j) {
    const redraw = (job) => { current = job; drawCase(job); const i = jobs.findIndex((x) => x.id === job.id); if (i >= 0) Object.assign(jobs[i], { status: job.status, updated: job.updated, lastBy: job.lastBy }); };
    $("statForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { redraw((await api(`/api/jobs/${j.id}/status`, { method: "POST", body: { status: $("statSel").value } })).job); D8.toast("Đã cập nhật trạng thái."); }
      catch (err) { D8.toast(err.message); }
    });
    document.querySelectorAll("#p-case [data-del]").forEach((b) => armed(b, async () => redraw((await api(`/api/jobs/${j.id}/files/${b.dataset.del}`, { method: "DELETE" })).job)));
    document.querySelectorAll("#p-case [data-unlink]").forEach((b) => armed(b, async () => redraw((await api(`/api/jobs/${j.id}/previews`, { method: "POST", body: { linkId: b.dataset.unlink, remove: true } })).job)));

    // 3D links: pick an existing one
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
      try { redraw((await api(`/api/jobs/${j.id}/previews`, { method: "POST", body: { linkId: id } })).job); } catch (err) { pvErr(err.message); }
    });
    $("pvCreate").addEventListener("click", async () => {
      const f = $("pvFile").files[0];
      if (!f) return pvErr("Chọn file HTML xuất từ exocad trước.");
      pvErr("");
      const prog = $("pvProg"), bar = prog.querySelector("i"), txt = prog.querySelector("p");
      const days = (document.querySelector('input[name="pvDays"]:checked') || {}).value || "30";
      $("pvCreate").disabled = true; prog.hidden = false; busy = true;
      try {
        const link = await createLink(f, $("pvLabel").value.trim(), days, (p, t) => { bar.style.width = Math.round(p * 100) + "%"; txt.textContent = t; });
        txt.textContent = "Đang gắn link vào ca…";
        pending.set(link.id, link);
        redraw((await api(`/api/jobs/${j.id}/previews`, { method: "POST", body: { linkId: link.id, trust: true } })).job);
        D8.toast("Đã tạo link 3D và gắn vào ca.");
      } catch (err) { $("pvCreate").disabled = false; prog.hidden = true; pvErr(err.message); }
      busy = false;
    });

    // deliver output files
    let outs = [];
    const list = $("outList"), btn = $("outBtn");
    const drawPicked = () => {
      list.innerHTML = outs.map((f, i) => `<li><span title="${esc(f.name)}">${esc(f.name)}</span><small>${esc(D8.size(f.size))}</small><button type="button" data-rm="${i}" aria-label="Bỏ ${esc(f.name)}">✕</button></li>`).join("");
      list.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { outs.splice(+b.dataset.rm, 1); drawPicked(); }));
      btn.disabled = !outs.length && !$("outDeliver").checked;
      btn.textContent = outs.length ? `Tải lên ${outs.length} file${$("outDeliver").checked ? " & giao" : ""}` : ($("outDeliver").checked ? "Chuyển sang Đã giao" : "Tải lên & giao");
    };
    const add = (fs) => { fs.forEach((f) => { if (!outs.some((x) => x.name === f.name && x.size === f.size)) outs.push(f); }); drawPicked(); };
    const zone = $("outZone"), input = $("outFiles");
    input.addEventListener("change", () => { add([...input.files]); input.value = ""; });
    ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("over"); }));
    zone.addEventListener("drop", (e) => add([...(e.dataTransfer.files || [])]));
    $("outDeliver").addEventListener("change", drawPicked);
    drawPicked();
    if (j.status === "delivered" && !outs.length) btn.disabled = true;
    btn.addEventListener("click", async () => {
      const prog = $("outProg"), err = $("outErr");
      err.hidden = true; btn.disabled = true; busy = true;
      try {
        let job;
        if (outs.length) {
          prog.hidden = false;
          job = (await D8.uploadJobFiles(j.id, outs, { deliver: $("outDeliver").checked, onProgress: (p) => { prog.querySelector("i").style.width = p.pct + "%"; prog.querySelector("p").textContent = p.text; } })).job;
        } else {
          job = (await api(`/api/jobs/${j.id}/files`, { method: "POST", body: { files: [], deliver: true } })).job;
        }
        busy = false; redraw(job); D8.toast(job.status === "delivered" ? "Đã giao file cho khách." : "Đã tải file lên.");
      } catch (ex) { busy = false; btn.disabled = false; prog.hidden = true; err.textContent = ex.message; err.hidden = false; }
    });

    // messages
    const form = $("composeForm"), box = $("composer");
    document.querySelectorAll("#p-case [data-tpl]").forEach((b) => b.addEventListener("click", () => { box.value = TEMPLATES[+b.dataset.tpl][1]; box.focus(); }));
    box.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = box.value.trim(); if (!text) return box.focus();
      $("sendMsg").disabled = true; $("msgErr").hidden = true;
      try { redraw((await api(`/api/jobs/${j.id}/messages`, { method: "POST", body: { text } })).job); }
      catch (err) { $("sendMsg").disabled = false; $("msgErr").textContent = err.message; $("msgErr").hidden = false; }
    });
  }

  /* ------------------------------------------------------------ customers */
  async function loadCustomers() {
    try {
      const [u] = await Promise.all([api("/api/admin/users"), jobs.length ? null : loadJobs(true)]);
      users = u.users || [];
      $("custErr").hidden = true;
      drawCustomers();
    } catch (err) { $("custErr").textContent = err.message; $("custErr").hidden = false; }
  }
  function drawCustomers() {
    const q = $("custQ").value.toLowerCase();
    const per = {}; jobs.forEach((x) => { per[x.owner] = (per[x.owner] || 0) + 1; });
    const shown = users.filter((u) => !q || (u.name + " " + u.email + " " + u.practice + " " + u.country).toLowerCase().includes(q));
    $("custBody").innerHTML = shown.length ? shown.map((u) => `<tr>
      <td><b>${esc(u.name || "—")}</b><small>${esc(u.email)}</small></td><td>${esc(u.practice || "—")}</td><td>${esc(u.country || "—")}</td><td>${esc(u.phone || "—")}</td>
      <td class="num">${per[u.email] ? `<a href="#jobs" data-owner="${esc(u.email)}">${per[u.email]} ca</a>` : "0"}</td>
      <td>${esc(D8.fmtDate(u.created))}</td><td>${esc(D8.ago(u.last))}</td></tr>`).join("")
      : `<tr><td colspan="7" class="muted">${users.length ? "Không có khách nào khớp." : "Chưa có khách nào đăng nhập."}</td></tr>`;
    $("custBody").querySelectorAll("[data-owner]").forEach((a) => a.addEventListener("click", () => { jobFilter = "all"; jobQuery = a.dataset.owner; $("jobQ").value = jobQuery; }));
  }
  $("custQ").addEventListener("input", drawCustomers);

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
  async function createLink(f, label, days, onProgress) {
    await checkHtml(f);
    onProgress(0, "Đang chuẩn bị và nén file…");
    const prepared = await withStorageShim(f);
    const gz = await compress(prepared);
    const body = gz || prepared;
    if (body.size > MAX_STORED) throw new Error("File sau khi nén vẫn lớn hơn 25 MB (" + fmtMB(body.size) + "), vượt giới hạn lưu trữ mỗi file.");
    const data = await xhrUpload(body, {
      "X-Case-Label": encodeURIComponent(label), "X-Expire-Days": String(days), "X-Content-Encoding": gz ? "gzip" : "identity",
      "X-Original-Size": String(prepared.size), "Content-Type": "application/octet-stream",
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
      const data = await createLink(file, $("label").value.trim(), selectedDays(), setProgress);
      pending.set(data.id, data);
      showResult(data);
      resetForm();
      refreshList();
    } catch (err) { showUploadError(err.message); $("create").disabled = !file; }
    finally { busy = false; setTimeout(() => { $("progress").hidden = true; }, 1200); }
  });
  function resetForm(keepLabel) {
    file = null;
    $("file").value = "";
    if (!keepLabel) $("label").value = "";
    drop.classList.remove("has-file");
    $("dropTitle").textContent = "Kéo file HTML xuất từ exocad vào đây";
    $("dropSub").textContent = "hoặc bấm để chọn file";
    $("create").disabled = true;
  }

  function messageEn(item) {
    const what = item.label ? item.label : "your case";
    return "Hi Dr. [Name],\n\nThe 3D design for " + what + " is ready for your review. It opens in any browser on your phone or computer, no software needed:\n\n" +
      item.url + "\n\nThe link is available until " + fmtDateEn(item.expires) + ". Let me know if you would like any adjustments.\n\nD.EIGHT DESIGN CENTER";
  }
  function messageVi(item) {
    const what = item.label ? item.label : "ca của bác sĩ";
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
    const used = data.items.reduce((t, i) => t + (i.storedSize || 0), 0), quota = data.quotaBytes || 1;
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
        <div class="case-meta">Tạo ${esc(fmtDateTimeVi(item.created))}, còn ${daysLeft} ngày (đến ${esc(fmtDateVi(item.expires))}), ${esc(fmtMB(item.storedSize || 0))}</div>
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
  let messages = [];
  const removedMsgs = new Set();
  async function refreshMessages(quiet) {
    try {
      const data = await api("/api/messages");
      messages = data.items.filter((m) => !removedMsgs.has(m.id));
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
