/* D.EIGHT workspace — 3D link maker with a link-preview picture.
   When a 3D link is made from an exocad HTML file, the file also opens here in a sandboxed frame; once exocad has
   drawn the design, its 3D view is captured (the admin can turn the model and capture again) and framed in the
   D.EIGHT style as a 1200×630 JPEG. Chat apps (Messenger, Zalo, WhatsApp…) show that picture with the link. */
(() => {
  "use strict";
  const esc = (s) => D8.esc(s);
  const OPEN = "<scr" + "ipt>", CLOSE = "</scr" + "ipt>";
  // Runs inside the exocad file: keeps the WebGL picture readable, waits for the meshes, answers "snap-take".
  // The picture is taken from the WebGL canvas itself. exocad lays a see-through 2D canvas of the same on-screen
  // size over it (pick points); with the browser zoomed out (devicePixelRatio < 1) that one has more pixels than the
  // WebGL canvas, and "the biggest canvas" used to be the empty overlay: a picture with no design (2026-11-26).
  // The frame also reports a devicePixelRatio of at least 1, so the design is drawn at full size for the picture.
  function capturer() {
    var gc = HTMLCanvasElement.prototype.getContext, gls = [];
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (/webgl/i.test(String(type))) {
        var a = {}; for (var k in attrs || {}) a[k] = attrs[k]; a.preserveDrawingBuffer = true;
        var x = gc.call(this, type, a); if (x && gls.indexOf(this) < 0) gls.push(this); return x;
      }
      return gc.apply(this, arguments);
    };
    try {
      var dd = Object.getOwnPropertyDescriptor(window, "devicePixelRatio") || Object.getOwnPropertyDescriptor(Window.prototype, "devicePixelRatio");
      if (dd && dd.get && dd.configurable !== false) Object.defineProperty(window, "devicePixelRatio", { configurable: true, enumerable: true, get: function () { var v = dd.get.call(window); return v > 0 && v < 1 ? 1 : v; } });
    } catch (e) {}
    var post = function (m) { try { parent.postMessage(m, "*"); } catch (e) {} };
    post({ d8: "snap", type: "hello" });
    var started = Date.now(), last = "", stable = 0;
    function list() { try { return window.DentalWebGL.m_SceneManager.m_MeshSort.m_SortedMeshs || null; } catch (e) { return null; } }
    function tick() {
      var L = list();
      if (!window.DentalWebGL && Date.now() - started > 15000) { post({ d8: "snap", type: "ready", exocad: false }); return; }
      if (L && L.length) {
        var sig = "", all = true;
        for (var i = 0; i < L.length; i++) { var e = L[i]; if (!e) continue; if (!e.IsLoaded) all = false; sig += e.IsLoaded ? 1 : 0; }
        stable = all && sig === last ? stable + 1 : 0; last = sig;
        if (stable >= 3) { setTimeout(function () { post({ d8: "snap", type: "ready", exocad: true }); }, 900); return; }
      }
      if (Date.now() - started > 90000) { post({ d8: "snap", type: "ready", exocad: !!window.DentalWebGL, timeout: true }); return; }
      setTimeout(tick, 400);
    }
    function shown(c) { return c.isConnected && c.width > 0 && c.height > 0 && c.getClientRects().length > 0 && c.clientWidth * c.clientHeight > 0 && getComputedStyle(c).visibility !== "hidden"; }
    // one colour everywhere = the design is not drawn yet (or hidden): such a picture is never saved
    function plain(c) {
      try {
        var t = document.createElement("canvas"); t.width = 96; t.height = 50;
        var g = t.getContext("2d"); g.drawImage(c, 0, 0, 96, 50);
        var d = g.getImageData(0, 0, 96, 50).data;
        for (var i = 4; i < d.length; i += 4) if (Math.abs(d[i] - d[0]) > 8 || Math.abs(d[i + 1] - d[1]) > 8 || Math.abs(d[i + 2] - d[2]) > 8 || Math.abs(d[i + 3] - d[3]) > 8) return false;
        return true;
      } catch (e) { return false; }
    }
    function shot() {
      // the WebGL canvas that is on screen and biggest on screen; any big canvas only when there is no WebGL one
      var cs = gls.filter(shown);
      if (!cs.length) cs = Array.prototype.slice.call(document.getElementsByTagName("canvas")).filter(function (c) { return shown(c) && c.width * c.height > 40000; });
      cs.sort(function (a, b) { return (b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight) || (b.width * b.height - a.width * a.height); });
      var c = cs[0];
      if (!c) { post({ d8: "snap", type: "shot", error: "nocanvas" }); return; }
      try {
        if (plain(c)) { post({ d8: "snap", type: "shot", error: "blank" }); return; }
        var url = c.toDataURL("image/png");
        if (!/^data:image\/png;base64,./.test(url)) { post({ d8: "snap", type: "shot", error: "empty" }); return; }
        post({ d8: "snap", type: "shot", url: url, w: c.width, h: c.height });
      } catch (e) { post({ d8: "snap", type: "shot", error: String(e && e.message || e) }); }
    }
    window.addEventListener("message", function (e) { if (e.data && e.data.d8 === "snap-take") shot(); });
    if (document.readyState === "complete") setTimeout(tick, 300); else window.addEventListener("load", function () { setTimeout(tick, 300); });
  }
  const STORAGE = "/*d8-storage-shim*/let localStorage=(function(){function mem(){var d=Object.create(null);return{getItem:function(k){k=String(k);return k in d?d[k]:null},setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},clear:function(){d=Object.create(null)},key:function(i){var a=Object.keys(d);return i<a.length?a[i]:null},get length(){return Object.keys(d).length}}}try{var s=window.localStorage;s.length;return s}catch(e){}var m=mem();try{Object.defineProperty(window,'localStorage',{value:m,configurable:true,enumerable:true,writable:true})}catch(e){}try{Object.defineProperty(window,'sessionStorage',{value:mem(),configurable:true,enumerable:true,writable:true})}catch(e){}return m})();";
  const INJECT = OPEN + "/*d8-snap*/(" + capturer.toString() + ")();" + CLOSE + OPEN + STORAGE + CLOSE;

  // Open the file in a frame inside `stage`; resolves `ready` when the design is drawn.
  function open(file, stage) {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.title = "Ảnh xem trước 3D";
    iframe.className = "snap-frame";
    let url = "", hello = false, readyFn, shotFn = null;
    const ready = new Promise((res) => { readyFn = res; });
    const onMsg = (e) => {
      if (e.source !== iframe.contentWindow || !e.data || e.data.d8 !== "snap") return;
      if (e.data.type === "hello") hello = true;
      if (e.data.type === "ready") readyFn(e.data);
      if (e.data.type === "shot" && shotFn) { const f = shotFn; shotFn = null; f(e.data); }
    };
    window.addEventListener("message", onMsg);
    (async () => {
      const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
      const text = new TextDecoder("windows-1252").decode(head);
      const m = /<head\b[^>]*>/i.exec(text) || /<html\b[^>]*>/i.exec(text);
      const at = m ? m.index + m[0].length : 0;
      const blob = new Blob([file.slice(0, at), INJECT, file.slice(at)], { type: "text/html" });
      url = URL.createObjectURL(blob);
      iframe.src = url;
      stage.appendChild(iframe);
      // the frame renders at 1200 × 630 (the picture size) and is shown scaled to the box
      const fit = () => { if (stage.clientWidth) iframe.style.transform = "scale(" + stage.clientWidth / 1200 + ")"; };
      fit();
      if ("ResizeObserver" in window) new ResizeObserver(fit).observe(stage);
      setTimeout(async () => { if (hello || !iframe.isConnected) return; iframe.removeAttribute("src"); iframe.srcdoc = await blob.text(); }, 8000);
    })();
    return {
      ready, iframe,
      capture: () => new Promise((res) => {
        shotFn = res;
        try { iframe.contentWindow.postMessage({ d8: "snap-take" }, "*"); } catch { res({ error: "noframe" }); }
        setTimeout(() => { if (shotFn === res) { shotFn = null; res({ error: "timeout" }); } }, 5000);
      }),
      destroy() { window.removeEventListener("message", onMsg); iframe.remove(); if (url) URL.revokeObjectURL(url); },
    };
  }
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  // The picture chat apps show: the design with the logo and "3D Design View", or the D.EIGHT default picture.
  // WhatsApp shows no picture over ~300 KB: the JPEG is kept under 290 KB.
  const OG_MAX = 290 * 1024;
  async function compose(shotUrl) {
    if (!shotUrl) { const r = await fetch("/brand/og-3d.jpg?v=2026-10-31", { cache: "no-cache" }); if (r.ok) return await r.blob(); }
    const W = 1200, H = 630;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#0B2A5C"); bg.addColorStop(1, "#05316E");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    try {
      const im = await loadImg(shotUrl || "/site/hero-full-mouth.webp");
      // trim a plain background around the model so it fills the frame
      const s = Math.max(W / im.width, H / im.height) * (shotUrl ? 1.04 : 0.98);
      const w = im.width * s, h = im.height * s;
      g.drawImage(im, (W - w) / 2, (H - h) / 2 + (shotUrl ? 20 : 40), w, h);
    } catch {}
    const top = g.createLinearGradient(0, 0, 0, 170); top.addColorStop(0, "rgba(5,37,82,.92)"); top.addColorStop(1, "rgba(5,37,82,0)");
    g.fillStyle = top; g.fillRect(0, 0, W, 170);
    try { const logo = await loadImg("/brand/logo-horizontal-reversed.svg"); const lh = 46; g.drawImage(logo, 48, 38, lh * (logo.width / logo.height || 3.52), lh); } catch {}
    try { await document.fonts.load('300 54px "Noto Serif Display"'); } catch {}
    g.fillStyle = "#FCFDF6"; g.textAlign = "right"; g.textBaseline = "alphabetic";
    g.font = '300 54px "Noto Serif Display", Georgia, "Times New Roman", serif';
    g.fillText("3D Design View", W - 48, 86);
    const bot = g.createLinearGradient(0, H - 70, 0, H); bot.addColorStop(0, "rgba(5,37,82,0)"); bot.addColorStop(1, "rgba(5,37,82,.75)");
    g.fillStyle = bot; g.fillRect(0, H - 70, W, 70);
    g.textAlign = "left"; g.font = '600 15px "Be Vietnam Pro", system-ui, sans-serif'; g.fillStyle = "#D6E1E7";
    try { g.letterSpacing = "3px"; } catch {}
    g.fillText("OPEN TO ROTATE AND ZOOM · NO SOFTWARE NEEDED", 48, H - 30);
    for (const q of [0.86, 0.8, 0.72, 0.64, 0.56]) {
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
      if (blob && blob.size < OG_MAX) return blob;
    }
    return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.45));
  }
  // A picture from the open design. exocad can still be putting the design on screen (textures, a big photo):
  // a plain picture (background only) is tried again every 1.5 s until `ms` has passed, never saved.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function take(ctl, ms) {
    const end = Date.now() + ms;
    for (;;) {
      const s = await ctl.capture();
      if (s.url || !ctl.iframe.isConnected || Date.now() + 1500 > end || (s.error !== "blank" && s.error !== "nocanvas")) return s;
      await wait(1500);
    }
  }
  const WHY = { blank: "khung 3D mới có màu nền, mô hình chưa hiện", nocanvas: "chưa thấy khung 3D", empty: "trình duyệt không đọc được hình",
    timeout: "khung 3D không trả lời", noframe: "khung 3D đã đóng" };
  const why = (s) => WHY[s && s.error] || (s && s.error) || "không rõ lý do";
  D8.snap = { open, compose, take, why };

  /* ------------------------------------------------------------ link maker (order page and 3D links page) */
  const ROUND = ["First design", "Second design", "Third design", "Fourth design", "Fifth design"];
  D8.ogText = (o, round, withPatient) => {
    const who = withPatient && o.patient ? "Patient: " + o.patient.toUpperCase() : "Case " + (o.ref || o.code);
    return { title: (who + " - " + (ROUND[round] || "Design " + (round + 1))).slice(0, 120),
      desc: ["Code: " + o.code, o.clinic || o.customer_name, o.doctor].filter(Boolean).join(" | ").slice(0, 200) };
  };
  // host: element; opts: { order, onDone(link) }; without an order the title/description are typed in.
  D8.linkMaker = function (host, opts = {}) {
    const o = opts.order || null, round = (opts.previews || []).length;
    const t0 = o ? D8.ogText(o, round, true) : { title: "", desc: "" };
    host.innerHTML = `<div class="lm">
      <div class="lm-row"><label class="btn small lm-file">Chọn file HTML exocad<input type="file" accept=".html,.htm,text/html" hidden></label><span class="lm-name muted">Chưa chọn file</span></div>
      <div class="of-grid2 tight">
        <div class="span2"><label class="field-label">Tiêu đề khi gửi link</label><input class="input" data-k="title" maxlength="120" value="${esc(t0.title)}" placeholder="Tiêu đề khi gửi link là gì?"></div>
        <div class="span2"><label class="field-label">Dòng mô tả</label><input class="input" data-k="desc" maxlength="200" value="${esc(t0.desc)}" placeholder="Dòng mô tả là gì?"></div>
        ${o && o.patient ? `<label class="check span2" style="margin:0"><input type="checkbox" data-k="pt" checked> Ghi tên bệnh nhân (ai có link đều thấy)</label>` : ""}
        <div><span class="field-label">Hạn dùng link</span><div class="seg seg-sm" role="radiogroup" aria-label="Hạn dùng">${[7, 14, 30].map((d) => `<label><input type="radio" name="lmDays${o ? o.id : ""}" value="${d}"${d === 30 ? " checked" : ""}><span>${d} ngày</span></label>`).join("")}</div></div>
      </div>
      <div class="wf-actions"><button class="btn btn-primary small" type="button" data-go disabled>Tạo link 3D</button></div>
      <div class="progress block" hidden><div class="progress-bar"><i></i></div><p></p></div>
      <p class="error" hidden></p>
      <div class="lm-out" hidden>
        <div class="lm-stagewrap"><div class="lm-stage" aria-label="Xem trước 3D để chụp ảnh"></div><p class="hint lm-tip">Xoay mô hình trong khung này tới góc đẹp rồi bấm <b>Chụp góc này</b>.</p></div>
        <div class="lm-card"><div class="lm-card-img"><img alt="Ảnh xem trước"></div><div class="lm-card-tx"><b class="lm-card-t"></b><span class="lm-card-d"></span><small>${esc(location.host)}</small></div></div>
        <div class="wf-actions"><button class="btn small" type="button" data-snap disabled>Chụp góc này</button><button class="btn small" type="button" data-def>Dùng ảnh mặc định</button><button class="btn small" type="button" data-copy>Sao chép link</button><a class="btn small" data-open target="_blank" rel="noopener">Mở link</a></div>
        <p class="hint lm-status"></p>
      </div></div>`;
    const q = (s) => host.querySelector(s);
    const input = q('input[type="file"]'), go = q("[data-go]"), prog = q(".progress"), err = q(".error"), out = q(".lm-out");
    const title = q('[data-k="title"]'), desc = q('[data-k="desc"]'), pt = q('[data-k="pt"]');
    let file = null, link = null, snap = null, dirty = false;
    if (pt) pt.addEventListener("change", () => { if (!dirty) title.value = D8.ogText(o, round, pt.checked).title; });
    title.addEventListener("input", () => { dirty = true; });
    input.addEventListener("change", () => {
      file = input.files[0] || null;
      q(".lm-name").textContent = file ? file.name + " · " + D8.size(file.size) : "Chưa chọn file";
      go.disabled = !file;
    });
    const say = (t) => { q(".lm-status").textContent = t; };
    const setCard = (src) => { q(".lm-card-img img").src = src; q(".lm-card-t").textContent = title.value || "3D design preview"; q(".lm-card-d").textContent = desc.value || "D.EIGHT DESIGN CENTER"; };
    const upload = async (blob) => {
      const r = await fetch(`/api/cases/${link.id}/og`, { method: "PUT", headers: { ...D8.authHeaders(), "Content-Type": "image/jpeg" }, body: blob, credentials: "same-origin" });
      if (!r.ok) { let m = ""; try { m = (await r.json()).error; } catch {} throw new Error(m || "Không lưu được ảnh xem trước."); }
    };
    const useShot = async (url) => {
      const blob = await D8.snap.compose(url);
      setCard(URL.createObjectURL(blob));
      await upload(blob);
    };
    go.addEventListener("click", async () => {
      if (!file) return;
      err.hidden = true; D8.busy(go, true); prog.hidden = false;
      const bar = prog.querySelector("i"), txt = prog.querySelector("p");
      const days = (host.querySelector('input[type="radio"]:checked') || {}).value || "30";
      try {
        link = await D8.ws.createLink(file, title.value.trim() || (o ? o.code : ""), days, (p, t) => { bar.style.width = Math.round(p * 100) + "%"; txt.textContent = t; },
          { title: title.value.trim(), desc: desc.value.trim(), orderId: o ? o.id : 0 });
        prog.hidden = true; out.hidden = false; D8.done(go, "Đã tạo link");
        q("[data-open]").href = link.url;
        if (opts.onDone) Promise.resolve(opts.onDone(link)).catch((e2) => D8.toast(e2.message));
        setCard("/og/" + link.id + ".jpg");
        say("Đang mở thiết kế để chụp ảnh xem trước…");
        snap = D8.snap.open(file, q(".lm-stage"));
        const r = await snap.ready;
        if (!r.exocad) { say("File không phải bản xem trước exocad: dùng ảnh mặc định của D.EIGHT."); await useShot(""); return; }
        const s = await D8.snap.take(snap, 30000);
        if (s.url) { await useShot(s.url); say("Đã lưu ảnh xem trước. Muốn góc khác: xoay mô hình rồi bấm Chụp góc này."); }
        else { await useShot(""); say("Chưa chụp được 3D (" + D8.snap.why(s) + "), đang dùng ảnh mặc định. Khi mô hình hiện trong khung, bấm Chụp góc này."); }
        q("[data-snap]").disabled = false;
      } catch (ex) { D8.busy(go, false); prog.hidden = true; err.textContent = ex.message; err.hidden = false; }
    });
    q("[data-snap]").addEventListener("click", async (e) => {
      const b = e.currentTarget; D8.busy(b, true);
      try { const s = await D8.snap.take(snap, 4500); if (!s.url) throw new Error("Chưa chụp được: " + D8.snap.why(s) + ". Đợi mô hình hiện trong khung rồi bấm lại."); await useShot(s.url); D8.done(b, "Đã lưu ảnh"); say("Đã lưu ảnh xem trước theo góc này."); }
      catch (ex) { D8.busy(b, false); D8.toast(ex.message); }
    });
    q("[data-def]").addEventListener("click", async (e) => {
      const b = e.currentTarget; D8.busy(b, true);
      try { await useShot(""); D8.done(b, "Đã dùng"); say("Đang dùng ảnh mặc định của D.EIGHT."); } catch (ex) { D8.busy(b, false); D8.toast(ex.message); }
    });
    q("[data-copy]").addEventListener("click", async (e) => { try { await navigator.clipboard.writeText(link.url); D8.done(e.currentTarget, "Đã chép"); } catch { D8.toast(link.url); } });
  };
})();
