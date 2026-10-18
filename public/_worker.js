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
  const until = new Date(meta.e).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const raw = `/raw/${id}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${label} | D.EIGHT DESIGN CENTER</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500&family=Marcellus&display=swap" rel="stylesheet">
<style>
  :root { --navy:#05316E; --steel:#8FACCB; --cream:#FCFDF6; --ink:#0B1B33; --bar:48px; }
  * { box-sizing: border-box; }
  html, body { margin:0; height:100%; background:var(--ink); }
  body { display:flex; flex-direction:column; height:100vh; height:100dvh; overflow:hidden;
         font-family:"Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { flex:0 0 var(--bar); display:flex; align-items:center; gap:16px;
           padding:0 max(16px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left));
           background:var(--navy); color:var(--cream); }
  .mark { display:flex; align-items:baseline; gap:8px; text-decoration:none; color:inherit; white-space:nowrap; }
  .mark b { font-family:"Marcellus", Georgia, serif; font-weight:400; font-size:20px; letter-spacing:.06em; }
  .mark span { font-size:10px; letter-spacing:.18em; color:var(--steel); }
  .case { flex:1; min-width:0; display:flex; align-items:baseline; gap:12px; padding-left:16px;
          border-left:1px solid rgba(143,172,203,.35); }
  .case h1 { margin:0; font-size:15px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .case p { margin:0; font-size:13px; color:var(--steel); white-space:nowrap; }
  .full { flex:0 0 auto; display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 12px;
          border:1px solid rgba(143,172,203,.5); border-radius:6px; color:var(--cream);
          font-size:13px; text-decoration:none; }
  .full:hover { background:rgba(143,172,203,.15); }
  .full:focus-visible, .mark:focus-visible { outline:2px solid var(--steel); outline-offset:2px; }
  iframe { flex:1 1 auto; width:100%; border:0; display:block; background:#473A6D; }
  @media (max-width: 640px) {
    :root { --bar:44px; }
    .mark span, .case p, .full .t { display:none; }
    .case { padding-left:12px; }
    .case h1 { font-size:14px; }
    .full { padding:0 8px; }
  }
</style>
</head>
<body>
<header>
  <a class="mark" href="https://d8designcenter.com" target="_blank" rel="noopener"><b>D.EIGHT</b><span>DESIGN CENTER</span></a>
  <div class="case"><h1>${label}</h1><p>Available until ${until}</p></div>
  <a class="full" href="${raw}" title="Open the 3D view on its own page">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/></svg>
    <span class="t">Full screen</span>
  </a>
</header>
<iframe src="${raw}" title="3D design: ${label}" allow="fullscreen"></iframe>
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
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500&family=Marcellus&display=swap" rel="stylesheet">
<style>
  :root { --navy:#05316E; --steel:#8FACCB; --cream:#FCFDF6; --ink:#0B1B33; }
  body { margin:0; min-height:100vh; background:var(--cream); color:var(--ink);
         font-family:"Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", sans-serif;
         display:flex; align-items:center; }
  main { width:100%; max-width:560px; margin:0 auto; padding:48px 16px; }
  .mark { font-family:"Marcellus", Georgia, serif; font-size:24px; letter-spacing:.06em; color:var(--navy); }
  h1 { font-size:28px; line-height:1.25; font-weight:500; margin:40px 0 16px; color:var(--navy); }
  p { font-size:16px; line-height:1.6; margin:0 0 16px; }
  a { color:var(--navy); }
  .rule { height:3px; width:48px; background:var(--steel); margin-top:12px; }
</style>
</head>
<body>
<main>
  <div class="mark">D.EIGHT</div>
  <div class="rule"></div>
  <h1>This preview link is no longer available</h1>
  <p>Design previews stay online for a limited time, and this one has expired or been removed.</p>
  <p>To see the design again, ask D.EIGHT DESIGN CENTER for a new link.</p>
  <p><a href="https://d8designcenter.com">d8designcenter.com</a></p>
</main>
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
