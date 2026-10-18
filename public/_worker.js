// D.EIGHT DESIGN CENTER — 3D preview links
// Cloudflare Pages "advanced mode" worker (single file, no build step).
//
// Bindings required (Pages project > Settings):
//   CASES            KV namespace that stores the uploaded exocad HTML files
//   UPLOAD_PASSWORD  Secret; password for the /admin page
//
// Routes:
//   /            landing page (static)
//   /admin       upload & manage page (static, password protected API)
//   /stl         exocad HTML -> STL converter (static; runs fully in the browser)
//   /v/<id>      viewer page sent to the doctor (branded header + 3D view)
//   /raw/<id>    the exocad HTML itself (sandboxed, opened inside /v/<id>)
//   /api/*       JSON API used by /admin

const ID_RE = /^[A-Za-z0-9]{12}$/;
const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // no 0/O/1/l/I
const MAX_BYTES = 25 * 1024 * 1024; // Workers KV value limit (25 MiB)
const QUOTA_BYTES = 1024 * 1024 * 1024; // KV free plan storage (1 GB)
const ALLOWED_DAYS = [7, 14, 30];
const DEFAULT_DAYS = 30;
const DAY_MS = 86400000;
const ASSET_VERSION = "2026-10-18.3"; // bump with brand.css changes

const PRIVATE_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path.startsWith("/api/")) return await handleApi(request, env, url);

      let m = path.match(/^\/v\/([^/]+)\/?$/);
      if (m) return await viewerPage(env, m[1]);

      m = path.match(/^\/raw\/([^/]+)\/?$/);
      if (m) return await rawFile(env, m[1]);

      const res = await env.ASSETS.fetch(request);
      return withHeaders(res, PRIVATE_HEADERS);
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
      if (path.startsWith("/api/")) return json({ error: "Lỗi máy chủ: " + String(err && err.message ? err.message : err) }, 500);
      return new Response("Server error", { status: 500 });
    }
  },
};

/* ------------------------------------------------------------------ API */

async function handleApi(request, env, url) {
  if (!env.CASES) return json({ error: "Chưa gắn KV namespace với tên biến CASES trong Settings > Bindings của dự án Pages." }, 500);
  if (!env.UPLOAD_PASSWORD) return json({ error: "Chưa đặt mật khẩu UPLOAD_PASSWORD trong Settings > Variables and Secrets của dự án Pages." }, 500);

  if (!(await isAuthorized(request, env))) {
    await sleep(400); // slow down password guessing
    return json({ error: "Sai mật khẩu." }, 401);
  }

  const path = url.pathname;
  if (path === "/api/ping" && request.method === "GET") return json({ ok: true }); // password check only, no KV use
  if (path === "/api/list" && request.method === "GET") return listCases(env);
  if (path === "/api/upload" && request.method === "POST") return uploadCase(request, env, url);

  const del = path.match(/^\/api\/cases\/([^/]+)$/);
  if (del && request.method === "DELETE") return deleteCase(env, del[1]);

  return json({ error: "Không tìm thấy." }, 404);
}

async function isAuthorized(request, env) {
  const given = request.headers.get("X-Upload-Key") || "";
  if (!given) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(String(env.UPLOAD_PASSWORD))]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function uploadCase(request, env, url) {
  const h = (k) => request.headers.get(k) || "";

  const daysRaw = parseInt(h("X-Expire-Days"), 10);
  const days = ALLOWED_DAYS.includes(daysRaw) ? daysRaw : DEFAULT_DAYS;

  let label = "";
  try { label = decodeURIComponent(h("X-Case-Label")); } catch { label = ""; }
  label = cleanLabel(label);

  const gzip = h("X-Content-Encoding") === "gzip";
  const originalSize = Math.max(0, parseInt(h("X-Original-Size"), 10) || 0);

  const body = await request.arrayBuffer();
  const size = body.byteLength;
  if (!size) return json({ error: "File rỗng." }, 400);
  if (size > MAX_BYTES) {
    return json({ error: `File quá lớn (${mb(size)} sau khi nén). Giới hạn lưu trữ là 25 MB mỗi file.` }, 413);
  }

  const head = new Uint8Array(body, 0, Math.min(size, 4096));
  if (gzip) {
    if (!(head[0] === 0x1f && head[1] === 0x8b)) return json({ error: "Dữ liệu nén không hợp lệ. Hãy thử tải lên lại." }, 400);
  } else {
    const text = new TextDecoder().decode(head);
    if (!/<html|<!doctype|<!--/i.test(text)) return json({ error: "File này không phải file HTML." }, 400);
  }

  const id = newId();
  const now = Date.now();
  const meta = {
    l: label,                       // case label shown to the doctor
    c: now,                         // created (ms)
    e: now + days * DAY_MS,         // expires (ms)
    s: size,                        // stored bytes
    o: originalSize || (gzip ? 0 : size), // original HTML bytes
    z: gzip ? 1 : 0,                // stored gzip-compressed
  };
  const expiration = Math.floor(meta.e / 1000);

  await env.CASES.put("case:" + id, body, { expiration, metadata: meta });
  await env.CASES.put("meta:" + id, JSON.stringify(meta), { expiration, metadata: meta });

  return json({ id, url: `${url.origin}/v/${id}`, ...publicMeta(meta) }, 201);
}

async function listCases(env) {
  const now = Date.now();
  const items = [];
  let cursor;
  do {
    const page = await env.CASES.list({ prefix: "meta:", cursor });
    for (const k of page.keys) {
      const meta = k.metadata;
      if (!meta || meta.e <= now) continue;
      items.push({ id: k.name.slice(5), ...publicMeta(meta) });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  items.sort((a, b) => b.created - a.created);
  const usedBytes = items.reduce((t, i) => t + (i.storedSize || 0), 0);
  return json({ items, usedBytes, quotaBytes: QUOTA_BYTES });
}

async function deleteCase(env, id) {
  if (!ID_RE.test(id)) return json({ error: "Mã link không hợp lệ." }, 400);
  await Promise.all([env.CASES.delete("case:" + id), env.CASES.delete("meta:" + id)]);
  return json({ ok: true });
}

function publicMeta(meta) {
  return {
    label: meta.l || "",
    created: meta.c,
    expires: meta.e,
    storedSize: meta.s,
    originalSize: meta.o,
  };
}

/* --------------------------------------------------------- Doctor views */

async function viewerPage(env, id) {
  if (!ID_RE.test(id) || !env.CASES) return unavailablePage();
  const meta = await env.CASES.get("meta:" + id, "json");
  if (!meta || meta.e <= Date.now()) return unavailablePage();

  const label = meta.l ? escapeHtml(meta.l) : "3D design preview";
  const heading = meta.l ? label : "Ready for your review";
  const until = new Date(meta.e).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const raw = `/raw/${id}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#FCFDF6">
<title>${label} | D.EIGHT DESIGN CENTER</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@500;600&family=Lexend+Exa:wght@600&display=swap" rel="stylesheet">
<style>
  :root { --navy:#05316E; --navy-600:#315686; --steel:#8FACCB; --steel-100:#EBF0EF; --cream:#FCFDF6; --ink:#0B1B33; --line:#E3E7E6;
          --display:"Lexend Exa","Be Vietnam Pro",system-ui,sans-serif; --bar:64px; }
  * { box-sizing:border-box; }
  html, body { margin:0; height:100%; background:var(--navy); }
  body { display:flex; flex-direction:column; height:100vh; height:100dvh; overflow:hidden; color:var(--ink);
         font-family:"Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing:antialiased; }
  img, svg { display:block; }
  header { flex:0 0 var(--bar); display:flex; align-items:center; gap:20px; background:var(--cream); border-bottom:1px solid var(--line);
           padding:0 max(24px, env(safe-area-inset-right)) 0 max(24px, env(safe-area-inset-left)); }
  .logo { flex:0 0 auto; display:flex; align-items:center; border-radius:4px; }
  .logo .full { height:34px; width:auto; }
  .logo .sym { display:none; height:28px; width:auto; }
  .case { flex:1; min-width:0; padding-left:20px; border-left:1px solid var(--line); }
  .eyebrow { display:block; font-family:var(--display); font-weight:600; font-size:10px; line-height:1.3; letter-spacing:.16em;
             text-transform:uppercase; color:var(--navy-600); white-space:nowrap; }
  .case h1 { margin:2px 0 0; font-size:15px; line-height:1.3; font-weight:600; color:var(--navy);
             overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .until { flex:0 0 auto; text-align:right; }
  .until b { display:block; margin-top:2px; font-size:14px; font-weight:500; color:var(--navy); white-space:nowrap; }
  .full-btn { flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; gap:8px; height:38px; padding:0 18px;
              border:1.5px solid var(--navy); border-radius:999px; color:var(--navy); text-decoration:none; background:transparent;
              font-family:var(--display); font-weight:600; font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; white-space:nowrap;
              transition:background .15s; }
  .full-btn:hover { background:var(--steel-100); }
  .full-btn:focus-visible, .logo:focus-visible { outline:2px solid var(--navy); outline-offset:3px; }
  .stage { position:relative; flex:1 1 auto; min-height:0; background:var(--navy); }
  .stage iframe { position:absolute; inset:0; width:100%; height:100%; border:0; background:transparent; }
  .loader { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px;
            color:var(--steel); text-align:center; padding:24px; }
  .loader img { width:64px; height:auto; animation:breathe 1.8s ease-in-out infinite; }
  .loader span { font-family:var(--display); font-weight:600; font-size:11px; letter-spacing:.16em; text-transform:uppercase; }
  @keyframes breathe { 50% { opacity:.45; transform:scale(.94); } }
  .ready .stage { background:#473A6D; }
  .ready .loader { display:none; }
  .stage:fullscreen { background:#473A6D; }
  @media (max-width: 820px) { .until { display:none; } }
  @media (max-width: 640px) {
    :root { --bar:56px; }
    header { gap:14px; padding:0 max(16px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left)); }
    .logo .full { display:none; }
    .logo .sym { display:block; }
    .case { padding-left:14px; }
    .case h1 { font-size:14px; }
    .full-btn { width:38px; padding:0; }
    .full-btn .t { display:none; }
  }
  @media (prefers-reduced-motion: reduce) { .loader img { animation:none; } }
</style>
</head>
<body>
<header>
  <a class="logo" href="https://d8designcenter.com" target="_blank" rel="noopener" aria-label="D.EIGHT DESIGN CENTER">
    <img class="full" src="/brand/logo-horizontal.svg" alt="D.EIGHT DESIGN CENTER" width="120" height="34">
    <img class="sym" src="/brand/symbol.svg" alt="" width="31" height="28">
  </a>
  <div class="case"><span class="eyebrow">3D design preview</span><h1>${heading}</h1></div>
  <div class="until"><span class="eyebrow">Available until</span><b>${until}</b></div>
  <a class="full-btn" id="fs" href="${raw}" title="Open the 3D view full screen">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/></svg>
    <span class="t">Full screen</span>
  </a>
</header>
<main class="stage" id="stage">
  <div class="loader" aria-hidden="true">
    <img src="/brand/symbol-reversed.svg" alt="" width="64" height="58">
    <span>Loading 3D design</span>
  </div>
  <iframe src="${raw}" title="3D design: ${label}" allow="fullscreen" onload="document.body.classList.add('ready')"></iframe>
</main>
<script>
  // Full screen inside this page where the browser allows it (desktop, Android); otherwise the link opens the 3D view alone.
  document.getElementById("fs").addEventListener("click", function (e) {
    var s = document.getElementById("stage");
    if (s.requestFullscreen && document.fullscreenEnabled) { e.preventDefault(); s.requestFullscreen().catch(function () { location.href = "${raw}"; }); }
  });
</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...PRIVATE_HEADERS,
    },
  });
}

async function rawFile(env, id) {
  if (!ID_RE.test(id) || !env.CASES) return unavailablePage();
  const { value, metadata } = await env.CASES.getWithMetadata("case:" + id, { type: "stream" });
  if (!value || !metadata || metadata.e <= Date.now()) {
    if (value && value.cancel) value.cancel();
    return unavailablePage();
  }

  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, max-age=600",
    // Run the exocad file in an isolated (opaque) origin so it cannot touch /admin or the API.
    "Content-Security-Policy": "sandbox allow-scripts allow-downloads allow-popups allow-modals; frame-ancestors 'self'",
    ...PRIVATE_HEADERS,
  });
  if (metadata.z) headers.set("Content-Encoding", "gzip");

  return new Response(value, { headers, encodeBody: metadata.z ? "manual" : "automatic" });
}

function unavailablePage() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Link not available | D.EIGHT DESIGN CENTER</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">
<meta name="theme-color" content="#05316E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600&family=Lexend+Exa:wght@600;700&family=Noto+Serif+Display:wdth,wght@75..85,300..400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/brand.css?v=${ASSET_VERSION}">
<style>
  :root { --wrap: 680px; }
  .notice { margin-top: 64px; padding: 40px; }
  .notice h1 { margin-top: 22px; font-size: clamp(18px, 3vw, 22px); line-height: 1.4; }
  .notice .serif { margin: 10px 0 22px; font-size: clamp(26px, 4.4vw, 34px); line-height: 1.15; color: var(--steel); }
  .notice p { margin: 0 0 12px; font-size: 16px; line-height: 1.65; }
  .notice .btns { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
  @media (max-width: 640px) { .notice { margin-top: 32px; padding: 26px 22px; } }
</style>
</head>
<body>
<header class="d8-header">
  <div class="wrap d8-header-in">
    <a class="d8-logo" href="https://d8designcenter.com" aria-label="D.EIGHT DESIGN CENTER">
      <img class="full" src="/brand/logo-horizontal.svg" alt="D.EIGHT DESIGN CENTER" width="127" height="36">
      <img class="sym" src="/brand/symbol.svg" alt="" width="33" height="30">
    </a>
  </div>
</header>
<main>
  <div class="wrap">
    <section class="card notice">
      <span class="chip">Link unavailable</span>
      <h1 class="h-caps">This preview link is no longer available</h1>
      <p class="serif">A fresh link is one message away</p>
      <p>Design previews stay online for a limited time, and this one has expired or been removed.</p>
      <p>To see the design again, ask D.EIGHT DESIGN CENTER for a new link.</p>
      <div class="btns">
        <a class="btn btn-primary" href="https://d8designcenter.com">Visit our website</a>
        <a class="btn" href="mailto:d.eightdesigncenter@gmail.com">Email us</a>
      </div>
    </section>
  </div>
</main>
<footer class="d8-footer">
  <div class="wrap d8-footer-in">
    <img class="logo-rev" src="/brand/logo-horizontal-reversed.svg" alt="D.EIGHT DESIGN CENTER" width="106" height="30">
    <div class="d8-footer-meta">
      <a class="caps" href="https://d8designcenter.com">d8designcenter.com</a>
      <span class="caps">© 2026 D.EIGHT DESIGN CENTER</span>
    </div>
  </div>
</footer>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...PRIVATE_HEADERS },
  });
}

/* -------------------------------------------------------------- helpers */

function newId() {
  const out = [];
  const n = ID_ALPHABET.length; // 56
  const limit = 256 - (256 % n); // rejection sampling keeps it uniform
  while (out.length < 12) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    for (const b of bytes) {
      if (b < limit && out.length < 12) out.push(ID_ALPHABET[b % n]);
    }
  }
  return out.join("");
}

function cleanLabel(s) {
  return String(s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...PRIVATE_HEADERS },
  });
}

function withHeaders(res, extra) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  return r;
}

function mb(bytes) {
  return (bytes / 1048576).toFixed(1) + " MB";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
