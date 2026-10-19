/* D.EIGHT DESIGN CENTER — shared site shell
   One header, footer, language switch (EN/VI), Google sign-in state and the
   Website / Customer portal / Admin switcher for every page.
   Pages declare themselves with <body data-page="home|portal|admin|stl|legal">
   and provide <div id="d8-header"></div> and <div id="d8-footer"></div>. */
(function () {
  "use strict";
  const D8 = (window.D8 = window.D8 || {});
  const page = document.body.dataset.page || "home";
  const isAdminPage = page === "admin" || page === "stl";
  const LANG_KEY = "d8-lang";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  /* ------------------------------------------------------------ language */
  D8.lang = isAdminPage ? "vi" : (store.get(LANG_KEY) === "vi" ? "vi" : "en");
  const dict = {}; // key -> [en, vi]
  D8.addDict = (d) => Object.assign(dict, d);
  D8.t = (key, en) => {
    const e = dict[key];
    if (!e) return en || key;
    return D8.lang === "vi" ? (e[1] != null ? e[1] : e[0]) : e[0];
  };
  D8.applyLang = (root) => {
    root = root || document;
    document.documentElement.lang = D8.lang;
    root.querySelectorAll("[data-i]").forEach((el) => {
      const key = el.getAttribute("data-i");
      if (el.dataset.en == null) el.dataset.en = el.innerHTML;
      const e = dict[key];
      el.innerHTML = D8.lang === "vi" && e && e[1] != null ? e[1] : el.dataset.en;
    });
    root.querySelectorAll("[data-i-attr]").forEach((el) => {
      el.getAttribute("data-i-attr").split(",").forEach((pair) => {
        const [attr, key] = pair.split(":").map((s) => s.trim());
        const store = "en" + attr.replace(/[^a-z]/gi, "");
        if (el.dataset[store] == null) el.dataset[store] = el.getAttribute(attr) || "";
        const e = dict[key];
        el.setAttribute(attr, D8.lang === "vi" && e && e[1] != null ? e[1] : el.dataset[store]);
      });
    });
    if (document.body.dataset.titleKey) document.title = D8.t(document.body.dataset.titleKey, document.title);
  };
  D8.setLang = (lang) => {
    if (isAdminPage) return;
    D8.lang = lang === "vi" ? "vi" : "en";
    store.set(LANG_KEY, D8.lang);
    renderHeader(); renderFooter();
    D8.applyLang();
    document.dispatchEvent(new CustomEvent("d8:lang", { detail: D8.lang }));
  };

  D8.addDict({
    "sh.services": ["Services", "Dịch vụ"],
    "sh.process": ["How it works", "Quy trình"],
    "sh.work": ["Work", "Sản phẩm"],
    "sh.about": ["About", "Giới thiệu"],
    "sh.faq": ["FAQ", "Hỏi đáp"],
    "sh.contact": ["Contact", "Liên hệ"],
    "sh.signin": ["Sign in", "Đăng nhập"],
    "sh.send": ["Send a case", "Gửi ca"],
    "sh.view.site": ["Website", "Trang web"],
    "sh.view.portal": ["Customer", "Khách hàng"],
    "sh.view.admin": ["Admin", "Quản trị"],
    "sh.mycases": ["My cases", "Ca của tôi"],
    "sh.newcase": ["New case", "Gửi ca mới"],
    "sh.profile": ["Profile", "Hồ sơ"],
    "sh.admintools": ["Admin tools", "Công cụ quản trị"],
    "sh.signout": ["Sign out", "Đăng xuất"],
    "sh.top.tag": ["Remote dental CAD design · Vietnam, UTC+7", "Thiết kế CAD nha khoa từ xa · Việt Nam, UTC+7"],
    "sh.foot.blurb": ["Remote CAD design team for dental labs and clinics. Production-ready STL, designed to fit.", "Đội thiết kế CAD từ xa cho lab và phòng khám nha khoa. File STL sẵn sàng sản xuất, thiết kế vừa khít."],
    "sh.foot.explore": ["Explore", "Khám phá"],
    "sh.foot.customers": ["Customers", "Khách hàng"],
    "sh.foot.legal": ["Legal", "Pháp lý"],
    "sh.portal": ["Customer portal", "Cổng khách hàng"],
    "sh.privacy": ["Privacy policy", "Chính sách bảo mật"],
    "sh.terms": ["Terms of service", "Điều khoản dịch vụ"],
    "sh.menu": ["Menu", "Menu"],
    "sh.gis.load": ["Google sign-in could not load. Check your connection or ad blocker, then reload the page.", "Không tải được nút đăng nhập Google. Kiểm tra mạng hoặc trình chặn quảng cáo rồi tải lại trang."],
    "sh.gis.cfg": ["Google sign-in is not configured yet.", "Chưa cấu hình đăng nhập Google."],
  });

  /* ------------------------------------------------------------ API + auth */
  D8.user = null;
  // Admin password (fallback when the admin is not signed in with Google), kept by admin.html.
  D8.adminKey = () => { try { return sessionStorage.getItem("d8-upload-key") || localStorage.getItem("d8-upload-key") || ""; } catch { return ""; } };
  // Only the admin pages send the password; the customer portal always acts as the signed-in Google user.
  D8.authHeaders = () => { const k = isAdminPage ? D8.adminKey() : ""; return k ? { "X-D8": "1", "X-Upload-Key": k } : { "X-D8": "1" }; };
  D8.api = async function (path, opts = {}) {
    const headers = { ...D8.authHeaders(), ...(opts.headers || {}) };
    let body = opts.body;
    if (body && typeof body === "object" && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    let res;
    try { res = await fetch(path, { ...opts, headers, body, credentials: "same-origin" }); }
    catch { throw Object.assign(new Error(D8.lang === "vi" ? "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại." : "Can't reach the server. Check your connection and try again."), { status: 0 }); }
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw Object.assign(new Error(data.error || ("Error " + res.status)), { status: res.status, data });
    return data;
  };

  /* ------------------------------------------------------------ case helpers (portal + admin) */
  D8.addDict({
    "st.received": ["Received", "Đã nhận"],
    "st.needs_info": ["Needs info", "Cần bổ sung"],
    "st.in_design": ["In design", "Đang thiết kế"],
    "st.review": ["Ready for review", "Chờ duyệt"],
    "st.approved": ["Approved", "Đã duyệt"],
    "st.delivered": ["Delivered", "Đã giao"],
    "st.cancelled": ["Cancelled", "Đã hủy"],
    "up.prep": ["Preparing {name}…", "Đang chuẩn bị {name}…"],
    "up.send": ["Uploading {name} ({i}/{n})… {pct}%", "Đang tải lên {name} ({i}/{n})… {pct}%"],
    "up.attach": ["Saving files…", "Đang lưu file…"],
    "up.big": ["{name} is too large (max 300 MB after compression).", "{name} quá lớn (tối đa 300 MB sau khi nén)."],
    "up.fail": ["Upload failed. Check your connection and try again.", "Tải lên thất bại. Kiểm tra mạng rồi thử lại."],
    "svc.Crown & bridge": ["Crown & bridge", "Mão & cầu"],
    "svc.Implant restorations": ["Implant restorations", "Phục hình implant"],
    "svc.All-on-X & bars": ["All-on-X & bars", "All-on-X & bar"],
    "svc.Surgical guides": ["Surgical guides", "Máng hướng dẫn phẫu thuật"],
    "svc.Wax-up & smile design": ["Wax-up & smile design", "Wax-up & thiết kế nụ cười"],
    "svc.Dentures & partials": ["Dentures & partials", "Hàm tháo lắp"],
    "svc.Splints & trays": ["Splints & trays", "Máng nhai & khay"],
    "svc.Aligner & ortho": ["Aligner & ortho", "Niềng trong suốt & chỉnh nha"],
    "svc.Digital models": ["Digital models", "Mẫu hàm kỹ thuật số"],
    "svc.Trial case": ["Trial case", "Ca làm thử"],
    "svc.Something else": ["Something else", "Việc khác"],
  });
  D8.SERVICES = ["Crown & bridge", "Implant restorations", "All-on-X & bars", "Surgical guides", "Wax-up & smile design", "Dentures & partials",
                 "Splints & trays", "Aligner & ortho", "Digital models", "Trial case", "Something else"];
  D8.svcLabel = (v) => (v ? D8.t("svc." + v, v) : "");
  D8.statusLabel = (s) => D8.t("st." + s, s);
  D8.locale = () => (D8.lang === "vi" ? "vi-VN" : "en-GB");
  D8.fmtDate = (ts, time) => {
    if (!ts) return "";
    const o = time ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric" };
    try { return new Intl.DateTimeFormat(D8.locale(), o).format(ts); } catch { return new Date(ts).toLocaleString(); }
  };
  D8.ago = (ts) => {
    const s = Math.round((ts - Date.now()) / 1000), a = Math.abs(s);
    const [v, u] = a < 60 ? [s, "second"] : a < 3600 ? [Math.round(s / 60), "minute"] : a < 86400 ? [Math.round(s / 3600), "hour"] : a < 86400 * 30 ? [Math.round(s / 86400), "day"] : [0, ""];
    if (!u) return D8.fmtDate(ts);
    try { return new Intl.RelativeTimeFormat(D8.locale(), { numeric: "auto" }).format(v, u); } catch { return D8.fmtDate(ts, true); }
  };
  D8.size = (b) => (b >= 1048576 ? (b / 1048576).toFixed(b >= 104857600 ? 0 : 1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
  D8.esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Upload files to a case: gzip in the browser where it helps, split into 20 MB parts, then attach.
  const CHUNK = 20 * 1024 * 1024, MAX_PARTS = 15;
  const NO_GZIP = /\.(zip|7z|rar|gz|tgz|bz2|xz|jpe?g|png|webp|heic|gif|mp4|mov|avi|pdf|docx|xlsx|pptx)$/i;
  const fidChars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const newFid = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => fidChars[b % fidChars.length]).join("");
  function putPart(url, blob, onProg) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", url);
      const h = D8.authHeaders();
      Object.keys(h).forEach((k) => x.setRequestHeader(k, h[k]));
      x.setRequestHeader("Content-Type", "application/octet-stream");
      x.upload.onprogress = (e) => onProg && onProg(e.loaded);
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) return resolve();
        let msg = ""; try { msg = JSON.parse(x.responseText).error; } catch {}
        reject(Object.assign(new Error(msg || D8.t("up.fail")), { status: x.status }));
      };
      x.onerror = () => reject(new Error(D8.t("up.fail")));
      x.send(blob);
    });
  }
  D8.uploadJobFiles = async function (jobId, files, opts = {}) {
    const say = opts.onProgress || (() => {});
    const metas = [];
    files = Array.from(files);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const name = file.name;
      say({ text: D8.t("up.prep").replace("{name}", name), pct: Math.round((i / files.length) * 100) });
      let blob = file, gz = 0;
      if (!NO_GZIP.test(name) && file.size > 4096 && "CompressionStream" in window) {
        try {
          const z = await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
          if (z.size < file.size * 0.92) { blob = z; gz = 1; }
        } catch {}
      }
      const parts = Math.max(1, Math.ceil(blob.size / CHUNK));
      if (parts > MAX_PARTS) throw new Error(D8.t("up.big").replace("{name}", name));
      const fid = newFid();
      for (let n = 0; n < parts; n++) {
        const part = blob.slice(n * CHUNK, Math.min(blob.size, (n + 1) * CHUNK));
        let tries = 0;
        for (;;) {
          try {
            await putPart(`/api/jobs/${encodeURIComponent(jobId)}/files/${fid}/${n}`, part, (loaded) => {
              const filePct = (n * CHUNK + loaded) / Math.max(1, blob.size);
              say({ text: D8.t("up.send").replace("{name}", name).replace("{i}", i + 1).replace("{n}", files.length).replace("{pct}", Math.min(100, Math.round(filePct * 100))),
                    pct: Math.round(((i + Math.min(1, filePct)) / files.length) * 100) });
            });
            break;
          } catch (err) {
            if (++tries >= 3 || (err.status && err.status < 500)) throw err;
            await new Promise((r) => setTimeout(r, 1500 * tries));
          }
        }
      }
      metas.push({ fid, name, size: file.size, stored: blob.size, parts, gz });
    }
    say({ text: D8.t("up.attach"), pct: 100 });
    return D8.api(`/api/jobs/${encodeURIComponent(jobId)}/files`, { method: "POST", body: { files: metas, deliver: !!opts.deliver } });
  };

  let configP = null;
  D8.config = () => (configP = configP || fetch("/api/config").then((r) => r.json()).catch(() => ({})));

  let gisP = null;
  function loadGis() {
    if (gisP) return gisP;
    gisP = new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => { gisP = null; reject(new Error(D8.t("sh.gis.load"))); };
      document.head.appendChild(s);
    });
    return gisP;
  }

  const signInWaiters = [];
  async function onCredential(resp) {
    try {
      const data = await D8.api("/api/auth/google", { method: "POST", body: { credential: resp.credential } });
      D8.user = data.user;
      renderHeader();
      document.dispatchEvent(new CustomEvent("d8:user", { detail: D8.user }));
      signInWaiters.splice(0).forEach((fn) => { try { fn(D8.user); } catch {} });
    } catch (err) {
      document.dispatchEvent(new CustomEvent("d8:signin-error", { detail: err.message }));
      alertBox(err.message);
    }
  }
  function alertBox(msg) {
    let el = document.getElementById("d8-toast");
    if (!el) { el = document.createElement("div"); el.id = "d8-toast"; el.className = "sh-toast"; el.setAttribute("role", "alert"); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add("show");
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 6000);
  }
  D8.toast = alertBox;

  let gisReady = null;
  async function initGis() {
    if (gisReady) return gisReady;
    gisReady = (async () => {
      const [cfg] = await Promise.all([D8.config(), loadGis()]);
      if (!cfg.googleClientId) throw new Error(D8.t("sh.gis.cfg"));
      window.google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onCredential, ux_mode: "popup", auto_select: false, cancel_on_tap_outside: true, itp_support: true });
      return true;
    })();
    gisReady.catch(() => { gisReady = null; });
    return gisReady;
  }

  // Render the official "Sign in with Google" button into el. onSignedIn(user) runs after a successful sign-in.
  D8.renderGoogleButton = async function (el, onSignedIn, opts = {}) {
    if (onSignedIn) signInWaiters.push(onSignedIn);
    try {
      await initGis();
      el.innerHTML = "";
      window.google.accounts.id.renderButton(el, {
        type: "standard", theme: opts.theme || "outline", size: "large", shape: "pill", text: opts.text || "signin_with",
        logo_alignment: "left", locale: D8.lang === "vi" ? "vi" : "en", width: Math.min(opts.width || 300, 400),
      });
    } catch (err) {
      el.innerHTML = '<p class="error"></p>';
      el.firstChild.textContent = err.message;
    }
  };

  D8.signOut = async function () {
    try { await D8.api("/api/auth/logout", { method: "POST" }); } catch {}
    try { window.google && window.google.accounts.id.disableAutoSelect(); } catch {}
    store.del("d8-upload-key");
    try { sessionStorage.removeItem("d8-upload-key"); } catch {}
    D8.user = null;
    location.href = "/";
  };

  D8.ready = fetch("/api/me", { credentials: "same-origin" })
    .then((r) => r.json()).then((d) => { D8.user = d.user || null; })
    .catch(() => { D8.user = null; })
    .then(() => { renderHeader(); document.dispatchEvent(new CustomEvent("d8:user", { detail: D8.user })); return D8.user; });

  /* ------------------------------------------------------------ header */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const home = page === "home" ? "" : "/";
  const ICON = {
    menu: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 5h14M2 9h14M2 13h14"/></svg>',
    close: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4l10 10M14 4 4 14"/></svg>',
    globe: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="9" cy="9" r="7"/><path d="M2 9h14M9 2c2 2 3 4.3 3 7s-1 5-3 7c-2-2-3-4.3-3-7s1-5 3-7Z"/></svg>',
    mail: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="4" width="14" height="10" rx="2"/><path d="M2.5 5l6.5 5 6.5-5"/></svg>',
  };

  function viewSwitch() {
    const keyAdmin = isAdminPage && document.body.dataset.authed === "1";
    if (!D8.user && !keyAdmin) return "";
    const items = [["site", "/", "sh.view.site"], ["portal", "/portal", "sh.view.portal"]];
    if (keyAdmin || D8.user.role === "admin") items.push(["admin", "/admin", "sh.view.admin"]);
    const cur = page === "portal" ? "portal" : isAdminPage ? "admin" : "site";
    return '<nav class="sh-switch" aria-label="View">' + items.map(([k, href, key]) =>
      `<a href="${href}"${k === cur ? ' aria-current="page"' : ""}>${esc(D8.t(key))}</a>`).join("") + "</nav>";
  }

  function userMenu() {
    if (!D8.user) {
      if (isAdminPage && document.body.dataset.authed === "1") return `<button class="btn small sh-keyout" type="button">${esc(D8.t("sh.signout"))}</button>`;
      return `<a class="btn small sh-signin" href="/portal">${esc(D8.t("sh.signin"))}</a>`;
    }
    const u = D8.user;
    const initials = (u.name || u.email).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const avatar = u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<span>${esc(initials)}</span>`;
    const adminLinks = u.role === "admin" ? `<a href="/admin">${esc(D8.t("sh.admintools"))}</a>` : "";
    return `<div class="sh-user">
      <button class="sh-avatar" type="button" aria-haspopup="true" aria-expanded="false" aria-label="${esc(u.name || u.email)}">${avatar}</button>
      <div class="sh-menu" role="menu" hidden>
        <div class="sh-menu-who"><b>${esc(u.name || "")}</b><span>${esc(u.email)}</span></div>
        <a href="/portal">${esc(D8.t("sh.mycases"))}</a>
        <a href="/portal#/new">${esc(D8.t("sh.newcase"))}</a>
        ${adminLinks}
        <button type="button" class="sh-out">${esc(D8.t("sh.signout"))}</button>
      </div></div>`;
  }

  function langSwitch() {
    if (isAdminPage) return "";
    return `<div class="sh-lang" role="group" aria-label="Language">${ICON.globe}
      <button type="button" data-lang="en"${D8.lang === "en" ? ' aria-pressed="true"' : ""}>EN</button><span>|</span>
      <button type="button" data-lang="vi"${D8.lang === "vi" ? ' aria-pressed="true"' : ""}>VI</button></div>`;
  }

  function subNav() {
    if (page === "portal") {
      return [["#/", "sh.mycases"], ["#/new", "sh.newcase"], ["#/profile", "sh.profile"]];
    }
    if (isAdminPage) {
      return [["/admin#jobs", null, "Ca hàng"], ["/admin#links", null, "Link xem 3D"], ["/stl", null, "HTML sang STL"],
              ["/admin#messages", null, "Tin nhắn"], ["/admin#customers", null, "Khách hàng"]];
    }
    return null;
  }

  function renderHeader() {
    const host = document.getElementById("d8-header");
    if (!host) return;
    const L = (k) => esc(D8.t(k));
    const sub = subNav();
    const signedIn = !!D8.user;
    const showSub = sub && (page === "portal" ? signedIn : (signedIn && D8.user.role === "admin") || document.body.dataset.authed === "1");
    host.className = "sh" + (page === "home" ? " sh-home" : "") + (showSub ? " sh-has-sub" : "");
    host.innerHTML = `
      <div class="sh-top"><div class="wrap sh-top-in">
        <span class="sh-tag">${L("sh.top.tag")}</span>
        <div class="sh-top-r">
          <a href="mailto:d.eightdesigncenter@gmail.com">${ICON.mail}<span>d.eightdesigncenter@gmail.com</span></a>
          ${langSwitch()}
        </div>
      </div></div>
      <div class="sh-bar"><div class="wrap sh-bar-in">
        <a class="sh-logo" href="/" aria-label="D.EIGHT DESIGN CENTER">
          <img class="full on-light" src="/brand/logo-horizontal.svg" alt="D.EIGHT DESIGN CENTER" width="127" height="36">
          <img class="full on-dark" src="/brand/logo-horizontal-reversed.svg" alt="" width="127" height="36">
          <img class="sym on-light" src="/brand/symbol.svg" alt="" width="33" height="30">
          <img class="sym on-dark" src="/brand/symbol-reversed.svg" alt="" width="33" height="30">
        </a>
        <nav class="sh-nav" aria-label="Main">
          <a href="${home}#services">${L("sh.services")}</a>
          <a href="${home}#process">${L("sh.process")}</a>
          <a href="${home}#work">${L("sh.work")}</a>
          <a href="${home}#about">${L("sh.about")}</a>
          <a href="${home}#faq">${L("sh.faq")}</a>
          <a href="${home}#contact">${L("sh.contact")}</a>
        </nav>
        <div class="sh-right">
          ${viewSwitch()}
          ${signedIn || isAdminPage ? "" : `<a class="btn btn-primary small sh-cta" href="/portal#/new">${L("sh.send")}</a>`}
          ${userMenu()}
          <button class="sh-burger" type="button" aria-expanded="false" aria-controls="sh-drawer" aria-label="${L("sh.menu")}">${ICON.menu}</button>
        </div>
      </div></div>
      ${showSub ? `<div class="sh-sub"><div class="wrap"><nav aria-label="Sections">${sub.map(([href, key, label]) =>
        `<a href="${href}" data-sub="${esc(href)}">${esc(key ? D8.t(key) : label)}</a>`).join("")}</nav></div></div>` : ""}
      <div class="sh-drawer" id="sh-drawer" hidden>
        <div class="wrap">
          ${viewSwitch()}
          <nav aria-label="Mobile">
            <a href="${home}#services">${L("sh.services")}</a>
            <a href="${home}#process">${L("sh.process")}</a>
            <a href="${home}#work">${L("sh.work")}</a>
            <a href="${home}#about">${L("sh.about")}</a>
            <a href="${home}#faq">${L("sh.faq")}</a>
            <a href="${home}#contact">${L("sh.contact")}</a>
          </nav>
          <div class="sh-drawer-foot">${langSwitch()}${signedIn ? `<button type="button" class="btn small sh-out">${L("sh.signout")}</button>` : `<a class="btn btn-primary small" href="/portal">${L("sh.signin")}</a>`}</div>
        </div>
      </div>`;
    wireHeader(host);
    markSub();
  }

  function markSub() {
    const host = document.getElementById("d8-header");
    if (!host) return;
    const here = location.pathname.replace(/\/$/, "") + (location.hash || "");
    host.querySelectorAll(".sh-sub a").forEach((a) => {
      const href = a.getAttribute("href");
      let on;
      if (page === "portal") on = (location.hash || "#/").startsWith(href) && (href !== "#/" || !/^#\/(new|profile)/.test(location.hash));
      else if (page === "stl") on = href === "/stl";
      else on = href === here || (href === "/admin#jobs" && (here === "/admin" || here === "/admin#" || here.startsWith("/admin#jobs/")));
      a.toggleAttribute("aria-current", !!on);
      if (on) a.setAttribute("aria-current", "page");
    });
  }
  window.addEventListener("hashchange", markSub);
  D8.markSub = markSub;
  D8.renderHeader = () => renderHeader();

  function wireHeader(host) {
    host.querySelectorAll(".sh-lang button").forEach((b) => b.addEventListener("click", () => D8.setLang(b.dataset.lang)));
    host.querySelectorAll(".sh-out").forEach((b) => b.addEventListener("click", D8.signOut));
    host.querySelectorAll(".sh-keyout").forEach((b) => b.addEventListener("click", () => {
      try { localStorage.removeItem("d8-upload-key"); sessionStorage.removeItem("d8-upload-key"); } catch {}
      location.href = "/admin";
    }));
    const av = host.querySelector(".sh-avatar"), menu = host.querySelector(".sh-menu");
    if (av && menu) {
      av.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = menu.hidden;
        menu.hidden = !open; av.setAttribute("aria-expanded", String(open));
      });
      document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; av.setAttribute("aria-expanded", "false"); } });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { menu.hidden = true; av.setAttribute("aria-expanded", "false"); av.focus(); } });
    }
    const burger = host.querySelector(".sh-burger"), drawer = host.querySelector(".sh-drawer");
    if (burger && drawer) {
      burger.addEventListener("click", () => {
        const open = drawer.hidden;
        drawer.hidden = !open;
        burger.setAttribute("aria-expanded", String(open));
        burger.innerHTML = open ? ICON.close : ICON.menu;
        host.classList.toggle("sh-open", open);
      });
      drawer.addEventListener("click", (e) => { if (e.target.closest("a")) { drawer.hidden = true; burger.setAttribute("aria-expanded", "false"); burger.innerHTML = ICON.menu; host.classList.remove("sh-open"); } });
    }
  }

  // Home page: transparent header over the hero, solid once scrolled.
  if (page === "home") {
    const onScroll = () => {
      const h = document.getElementById("d8-header");
      if (h) h.classList.toggle("sh-solid", window.scrollY > 40);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("DOMContentLoaded", onScroll);
    onScroll();
  }

  /* ------------------------------------------------------------ footer */
  function renderFooter() {
    const host = document.getElementById("d8-footer");
    if (!host) return;
    const L = (k) => esc(D8.t(k));
    host.className = "d8-footer sh-foot";
    host.innerHTML = `
      <div class="wrap sh-foot-grid">
        <div class="sh-foot-brand">
          <img class="logo-rev" src="/brand/logo-horizontal-reversed.svg" alt="D.EIGHT DESIGN CENTER" width="127" height="36">
          <img class="tag" src="/brand/tagline.svg" alt="Design to fit" width="120" height="26">
          <p>${L("sh.foot.blurb")}</p>
        </div>
        <div><h4>${L("sh.foot.explore")}</h4>
          <a href="${home}#services">${L("sh.services")}</a><a href="${home}#process">${L("sh.process")}</a>
          <a href="${home}#work">${L("sh.work")}</a><a href="${home}#about">${L("sh.about")}</a><a href="${home}#faq">${L("sh.faq")}</a></div>
        <div><h4>${L("sh.foot.customers")}</h4>
          <a href="/portal">${L("sh.portal")}</a><a href="/portal#/new">${L("sh.send")}</a><a href="${home}#contact">${L("sh.contact")}</a>
          <a href="mailto:d.eightdesigncenter@gmail.com">d.eightdesigncenter@gmail.com</a></div>
        <div><h4>${L("sh.foot.legal")}</h4>
          <a href="/privacy">${L("sh.privacy")}</a><a href="/terms">${L("sh.terms")}</a></div>
      </div>
      <div class="sh-foot-bottom"><div class="wrap">
        <span class="caps">© 2026 D.EIGHT DESIGN CENTER</span>
        ${langSwitch()}
      </div></div>`;
    host.querySelectorAll(".sh-lang button").forEach((b) => b.addEventListener("click", () => D8.setLang(b.dataset.lang)));
  }

  /* ------------------------------------------------------------ boot */
  function boot() {
    if (window.D8_DICT) D8.addDict(window.D8_DICT);
    renderHeader();
    renderFooter();
    D8.applyLang();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
