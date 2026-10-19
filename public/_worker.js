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
//   /portal      customer portal (Sign in with Google): send cases, files, approvals, messages
//   /api/*       JSON API (admin: password or admin Google account; customers: Google session cookie)

const ID_RE = /^[A-Za-z0-9]{12}$/;
const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // no 0/O/1/l/I
const MAX_BYTES = 25 * 1024 * 1024; // Workers KV value limit (25 MiB)
const QUOTA_BYTES = 1024 * 1024 * 1024; // KV free plan storage (1 GB)
const ALLOWED_DAYS = [7, 14, 30];
const DEFAULT_DAYS = 30;
const DAY_MS = 86400000;
const ASSET_VERSION = "2026-10-19.1"; // bump with brand.css changes
const MSG_DAILY_CAP = 30;      // contact messages stored per day (protects the 1,000 KV writes/day free quota)
const MSG_KEEP_DAYS = 180;     // contact messages are deleted automatically after this
const MSG_ID_RE = /^[0-9]{13}[A-Za-z0-9]{6}$/;

// Accounts (Sign in with Google) and customer jobs
const GOOGLE_CLIENT_ID = "647066906042-qvpp57jfba44799ooq2ajctomsffameu.apps.googleusercontent.com"; // public; env GOOGLE_CLIENT_ID overrides
const ADMIN_EMAILS = ["d.eightdesigncenter@gmail.com"]; // env ADMIN_EMAILS (comma separated) overrides
const SESSION_DAYS = 30;
const JOB_ID_RE = /^D8-[0-9]{6}-[A-Z2-9]{4}$/;
const FID_RE = /^[A-Za-z0-9]{10}$/;
const JOB_STATUSES = ["received", "needs_info", "in_design", "review", "approved", "delivered", "cancelled"];
const CHUNK_MAX = 20 * 1024 * 1024;                // bytes per stored file chunk (KV value limit is 25 MiB)
const FILE_MAX_PARTS = 15;                         // 300 MB per file after compression
const JOB_FILES_MAX = 300 * 1024 * 1024;           // stored bytes per job
const FILE_KEEP_DAYS = 60;                         // uploaded files expire after this
const THREAD_MAX = 400;

const PRIVATE_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  // Google sign-in needs the page origin; cross-site requests get the origin only, never the path.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
};
// 3D links for doctors send no referrer at all, so the link code never leaves the page.
const LINK_HEADERS = { ...PRIVATE_HEADERS, "Referrer-Policy": "no-referrer" };

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

  const path = url.pathname;
  const method = request.method;

  // Reject cross-site requests that change data (cookie sessions must not be usable from other sites).
  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ error: "Cross-site request blocked." }, 403);
  }

  /* ---- public ---- */
  if (path === "/api/contact") {
    if (method !== "POST") return json({ error: "Method not allowed." }, 405);
    return submitContact(request, env);
  }
  if (path === "/api/config" && method === "GET") {
    return json({ googleClientId: conf(env).clientId }, 200, { "Cache-Control": "public, max-age=300" });
  }
  if (path === "/api/auth/google" && method === "POST") return googleSignIn(request, env, url);
  if (path === "/api/auth/logout" && method === "POST") return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(url) });

  const session = await readSession(request, env);
  if (path === "/api/me" && method === "GET") return json({ user: session ? publicUser(session) : null });

  // A request authenticated only by the session cookie must carry X-D8 (blocks form-based CSRF).
  const keyOk = await isAuthorized(request, env);
  if (!keyOk && session && method !== "GET" && request.headers.get("X-D8") !== "1") {
    return json({ error: "Missing request header." }, 403);
  }
  const isAdmin = keyOk || !!(session && session.role === "admin");

  /* ---- signed-in customers (and admin) ---- */
  if (path.startsWith("/api/my/") || path.startsWith("/api/jobs/")) {
    if (!session && !keyOk) return json({ error: "Please sign in." }, 401);
    const who = session ? { email: session.email, name: session.name, admin: isAdmin, viaKey: keyOk } : { email: "", name: "D.EIGHT", admin: true, viaKey: true };
    return handleJobs(request, env, url, who);
  }

  /* ---- admin ---- */
  if (!isAdmin) {
    if (!session) await sleep(400); // slow down password guessing
    return json({ error: session ? "Tài khoản này không có quyền quản trị." : "Sai mật khẩu." }, session ? 403 : 401);
  }

  if (path === "/api/ping" && method === "GET") return json({ ok: true }); // password check only, no KV use
  if (path === "/api/list" && method === "GET") return listCases(env);
  if (path === "/api/upload" && method === "POST") return uploadCase(request, env, url);

  const del = path.match(/^\/api\/cases\/([^/]+)$/);
  if (del && method === "DELETE") return deleteCase(env, del[1]);

  if (path === "/api/messages" && method === "GET") return listMessages(env);
  const delMsg = path.match(/^\/api\/messages\/([^/]+)$/);
  if (delMsg && method === "DELETE") return deleteMessage(env, delMsg[1]);

  if (path === "/api/admin/jobs" && method === "GET") return listJobs(env, null);
  if (path === "/api/admin/users" && method === "GET") return listUsers(env);

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

/* ------------------------------------------------- Accounts (Google sign-in) */

function conf(env) {
  const admins = (env.ADMIN_EMAILS ? String(env.ADMIN_EMAILS).split(",") : ADMIN_EMAILS).map((e) => e.trim().toLowerCase()).filter(Boolean);
  return {
    clientId: env.GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID,
    admins,
    jwksUrl: env.GOOGLE_JWKS_URL || "https://www.googleapis.com/oauth2/v3/certs",
  };
}

const te = new TextEncoder();
function b64urlEncode(bytes) {
  let bin = "";
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlJson = (str) => JSON.parse(new TextDecoder().decode(b64urlDecode(str)));

let JWKS_CACHE = { keys: null, until: 0, url: "" };
async function googleKeys(env, force) {
  const url = conf(env).jwksUrl;
  if (!force && JWKS_CACHE.keys && JWKS_CACHE.url === url && Date.now() < JWKS_CACHE.until) return JWKS_CACHE.keys;
  const res = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error("could not load Google keys (" + res.status + ")");
  const data = await res.json();
  const m = /max-age=(\d+)/.exec(res.headers.get("Cache-Control") || "");
  JWKS_CACHE = { keys: data.keys || [], until: Date.now() + Math.min(6 * 3600, m ? +m[1] : 3600) * 1000, url };
  return JWKS_CACHE.keys;
}

async function verifyGoogleIdToken(token, env) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const header = b64urlJson(parts[0]);
  const claims = b64urlJson(parts[1]);
  if (header.alg !== "RS256") throw new Error("unexpected token algorithm");
  let keys = await googleKeys(env, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) { keys = await googleKeys(env, true); jwk = keys.find((k) => k.kid === header.kid); }
  if (!jwk) throw new Error("unknown signing key");
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(parts[2]), te.encode(parts[0] + "." + parts[1]));
  if (!ok) throw new Error("bad token signature");
  const now = Math.floor(Date.now() / 1000);
  const c = conf(env);
  if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) throw new Error("bad issuer");
  if (!c.clientId || claims.aud !== c.clientId) throw new Error("token is for another app");
  if (!(claims.exp > now - 60)) throw new Error("token expired");
  if (!claims.email || (claims.email_verified !== true && claims.email_verified !== "true")) throw new Error("email not verified");
  return claims;
}

let SESSION_KEY = { key: null, src: "" };
async function sessionKey(env) {
  const src = String(env.UPLOAD_PASSWORD);
  if (SESSION_KEY.key && SESSION_KEY.src === src) return SESSION_KEY.key;
  const raw = await crypto.subtle.digest("SHA-256", te.encode("d8-session-v1:" + src));
  SESSION_KEY = { key: await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]), src };
  return SESSION_KEY.key;
}

function roleFor(env, email) { return conf(env).admins.includes(String(email).toLowerCase()) ? "admin" : "client"; }
function publicUser(s) { return { email: s.email, name: s.name, picture: s.picture, role: s.role }; }

async function makeSessionCookie(env, url, user) {
  const payload = { e: user.email, n: user.name || "", p: user.picture || "", x: Date.now() + SESSION_DAYS * DAY_MS };
  const body = b64urlEncode(te.encode(JSON.stringify(payload)));
  const sig = b64urlEncode(await crypto.subtle.sign("HMAC", await sessionKey(env), te.encode(body)));
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `d8s=${body}.${sig}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}
function clearSessionCookie(url) {
  return `d8s=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${url.protocol === "https:" ? "; Secure" : ""}`;
}

async function readSession(request, env) {
  const m = /(?:^|;\s*)d8s=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/.exec(request.headers.get("Cookie") || "");
  if (!m) return null;
  try {
    const sig = b64urlDecode(m[2]);
    if (b64urlEncode(sig) !== m[2]) return null; // only the canonical encoding is accepted
    const ok = await crypto.subtle.verify("HMAC", await sessionKey(env), sig, te.encode(m[1]));
    if (!ok) return null;
    const p = b64urlJson(m[1]);
    if (!p.e || !(p.x > Date.now())) return null;
    return { email: p.e, name: p.n, picture: p.p, role: roleFor(env, p.e) };
  } catch { return null; }
}

async function googleSignIn(request, env, url) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  let claims;
  try { claims = await verifyGoogleIdToken(body && body.credential, env); }
  catch (err) { return json({ error: "Google sign-in failed: " + err.message }, 401); }

  const email = String(claims.email).toLowerCase();
  const now = Date.now();
  const key = "user:" + email;
  const existing = await env.CASES.get(key, "json");
  const user = { practice: "", country: "", phone: "", ...(existing || {}), email, name: String(claims.name || email).slice(0, 100),
    picture: String(claims.picture || "").slice(0, 300), created: existing ? existing.created : now, last: now };
  if (!existing || now - (existing.last || 0) > 12 * 3600 * 1000 || existing.name !== user.name || existing.picture !== user.picture) {
    await env.CASES.put(key, JSON.stringify(user), { metadata: userMeta(user) });
  }
  const cookie = await makeSessionCookie(env, url, user);
  return json({ user: { email, name: user.name, picture: user.picture, role: roleFor(env, email) } }, 200, { "Set-Cookie": cookie });
}

function userMeta(u) {
  return { n: String(u.name || "").slice(0, 80), c: u.created || 0, l: u.last || Date.now(), p: String(u.practice || "").slice(0, 120),
    co: String(u.country || "").slice(0, 60), ph: String(u.phone || "").slice(0, 40) };
}
async function listUsers(env) {
  const users = [];
  let cursor;
  do {
    const page = await env.CASES.list({ prefix: "user:", cursor });
    for (const k of page.keys) {
      const m = k.metadata || {};
      users.push({ email: k.name.slice(5), name: m.n || "", created: m.c || 0, last: m.l || 0, practice: m.p || "", country: m.co || "", phone: m.ph || "" });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  users.sort((a, b) => b.last - a.last);
  return json({ users });
}

/* --------------------------------------------------------- Customer jobs */

function newJobId() {
  const d = new Date();
  const ymd = String(d.getUTCFullYear() % 100).padStart(2, "0") + String(d.getUTCMonth() + 1).padStart(2, "0") + String(d.getUTCDate()).padStart(2, "0");
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(4));
  return "D8-" + ymd + "-" + Array.from(r, (b) => A[b % 32]).join("");
}
const clip = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);

function jobMeta(job) {
  return { o: job.owner.slice(0, 120), t: job.title.slice(0, 60), s: job.status, c: job.created, u: job.updated, lb: job.lastBy || "client",
    sz: Math.round((job.files || []).reduce((t, f) => t + (f.stored || 0), 0) / 1048576) };
}
async function saveJob(env, job) {
  await env.CASES.put("job:" + job.id, JSON.stringify(job), { metadata: jobMeta(job) });
}
async function loadJob(env, id) {
  if (!JOB_ID_RE.test(id)) return null;
  return env.CASES.get("job:" + id, "json");
}

// Each customer's case ids are kept in "own:<email>" so their list needs no KV "list" request
// (the free plan allows 1,000 list requests a day but 100,000 reads).
async function ownerIds(env, email, rebuild) {
  const ids = await env.CASES.get("own:" + email, "json");
  if (Array.isArray(ids) || !rebuild) return Array.isArray(ids) ? ids : [];
  const found = [];
  let cursor;
  do {
    const page = await env.CASES.list({ prefix: "job:", cursor });
    for (const k of page.keys) if ((k.metadata || {}).o === email) found.push({ id: k.name.slice(4), c: k.metadata.c || 0 });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const list = found.sort((a, b) => b.c - a.c).map((x) => x.id);
  await env.CASES.put("own:" + email, JSON.stringify(list)); // also stored when empty, so the scan runs once per customer
  return list;
}
async function listOwnJobs(env, email) {
  const ids = (await ownerIds(env, email, true)).slice(0, 500);
  const rows = await Promise.all(ids.map((id) => env.CASES.getWithMetadata("job:" + id)));
  const items = [];
  rows.forEach((r, i) => {
    const m = r && r.metadata;
    if (m) items.push({ id: ids[i], owner: m.o, title: m.t, status: m.s, created: m.c, updated: m.u, lastBy: m.lb, storedMB: m.sz || 0 });
  });
  items.sort((a, b) => b.updated - a.updated);
  return json({ items });
}

async function listJobs(env, owner) {
  const items = [];
  let cursor;
  do {
    const page = await env.CASES.list({ prefix: "job:", cursor });
    for (const k of page.keys) {
      const m = k.metadata || {};
      if (owner && m.o !== owner) continue;
      items.push({ id: k.name.slice(4), owner: m.o, title: m.t, status: m.s, created: m.c, updated: m.u, lastBy: m.lb, storedMB: m.sz || 0 });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  items.sort((a, b) => b.updated - a.updated);
  return json({ items });
}

async function jobView(env, job) {
  const previews = [];
  for (const pid of job.previews || []) {
    const m = await env.CASES.get("meta:" + pid, "json");
    if (m && m.e > Date.now()) previews.push({ id: pid, label: m.l || "", expires: m.e, url: "/v/" + pid });
  }
  return { ...job, previews };
}

async function handleJobs(request, env, url, who) {
  const path = url.pathname;
  const method = request.method;
  let m;

  if (path === "/api/my/jobs" && method === "GET") return who.email ? listOwnJobs(env, who.email) : json({ items: [] });

  if (path === "/api/my/jobs" && method === "POST") {
    if (!who.email) return json({ error: "Sign in with Google to send a case." }, 403);
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const title = clip(b.title, 80);
    if (!title) return json({ error: "Please give the case a reference." }, 400);
    const now = Date.now();
    const links = (Array.isArray(b.links) ? b.links : []).map((l) => clip(l, 500)).filter((l) => /^https?:\/\//i.test(l)).slice(0, 5);
    const job = {
      id: newJobId(), owner: who.email, ownerName: clip(who.name, 100),
      title, service: clip(b.service, 60), teeth: clip(b.teeth, 120), numbering: b.numbering === "UNS" ? "UNS" : "FDI",
      material: clip(b.material, 120), shade: clip(b.shade, 40), neededBy: clip(b.neededBy, 20), notes: clip(b.notes, 4000), links,
      status: "received", created: now, updated: now, lastBy: "client", approvedAt: 0,
      files: [], previews: [], thread: [],
    };
    while (await env.CASES.get("job:" + job.id)) job.id = newJobId();
    const own = await ownerIds(env, who.email, true);
    await saveJob(env, job);
    await env.CASES.put("own:" + who.email, JSON.stringify([job.id, ...own.filter((x) => x !== job.id)].slice(0, 2000)));
    return json({ job: await jobView(env, job) }, 201);
  }

  if (path === "/api/my/profile") {
    if (!who.email) return json({ error: "Not signed in with Google." }, 403);
    const key = "user:" + who.email;
    const user = (await env.CASES.get(key, "json")) || { email: who.email, name: who.name, created: Date.now(), last: Date.now() };
    if (method === "GET") return json({ profile: user });
    if (method === "POST") {
      let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
      user.practice = clip(b.practice, 120); user.country = clip(b.country, 60); user.phone = clip(b.phone, 40);
      await env.CASES.put(key, JSON.stringify(user), { metadata: userMeta(user) });
      return json({ profile: user });
    }
  }

  // /api/jobs/<id>[/...]
  m = path.match(/^\/api\/jobs\/([^/]+)(\/.*)?$/);
  if (!m) return json({ error: "Not found." }, 404);
  const job = await loadJob(env, m[1]);
  if (!job || !(who.admin || (who.email && job.owner === who.email))) return json({ error: "Case not found." }, 404);
  const sub = m[2] || "";
  // The owner always acts as the customer; an admin looking at someone else's case acts as D.EIGHT.
  // Requests from the admin tools (password header) always act as D.EIGHT.
  const by = !who.viaKey && who.email && job.owner === who.email ? "client" : "admin";

  if (sub === "" && method === "GET") return json({ job: await jobView(env, job) });

  if (sub === "/messages" && method === "POST") {
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const text = clip(b.text, 4000);
    if (!text) return json({ error: "Empty message." }, 400);
    job.thread.push({ by, name: by === "admin" ? "D.EIGHT" : clip(who.name, 100), text, at: Date.now() });
    if (job.thread.length > THREAD_MAX) job.thread = job.thread.slice(-THREAD_MAX);
    job.updated = Date.now(); job.lastBy = by;
    await saveJob(env, job);
    return json({ job: await jobView(env, job) });
  }

  if (sub === "/approve" && method === "POST") {
    if (by !== "client") return json({ error: "Only the customer can approve." }, 403);
    if (job.status !== "review") return json({ error: "This design is not waiting for approval." }, 409);
    const now = Date.now();
    job.status = "approved"; job.approvedAt = now; job.updated = now; job.lastBy = "client";
    job.thread.push({ by: "system", name: "", text: "status:approved", at: now });
    await saveJob(env, job);
    return json({ job: await jobView(env, job) });
  }

  if (sub === "/status" && method === "POST") {
    if (!who.admin) return json({ error: "Not allowed." }, 403);
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    if (!JOB_STATUSES.includes(b.status)) return json({ error: "Trạng thái không hợp lệ." }, 400);
    if (b.status !== job.status) {
      const now = Date.now();
      job.status = b.status; job.updated = now; job.lastBy = "admin";
      if (b.status === "approved" && !job.approvedAt) job.approvedAt = now;
      job.thread.push({ by: "system", name: "", text: "status:" + b.status, at: now });
      await saveJob(env, job);
    }
    return json({ job: await jobView(env, job) });
  }

  if (sub === "/previews" && method === "POST") {
    if (!who.admin) return json({ error: "Not allowed." }, 403);
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    if (!ID_RE.test(b.linkId || "")) return json({ error: "Mã link không hợp lệ." }, 400);
    job.previews = (job.previews || []).filter((p) => p !== b.linkId);
    if (!b.remove) {
      const meta = await env.CASES.get("meta:" + b.linkId, "json");
      if (!meta && !b.trust) return json({ error: "Không tìm thấy link 3D này (link vừa tạo có thể cần khoảng 1 phút)." }, 404);
      job.previews.push(b.linkId);
      if (["received", "needs_info", "in_design"].includes(job.status)) {
        job.status = "review";
        job.thread.push({ by: "system", name: "", text: "status:review", at: Date.now() });
      }
      job.lastBy = "admin";
    }
    job.updated = Date.now();
    await saveJob(env, job);
    return json({ job: await jobView(env, job) });
  }

  // file chunk upload: PUT /api/jobs/<id>/files/<fid>/<n>
  let f = sub.match(/^\/files\/([A-Za-z0-9]{10})\/(\d{1,2})$/);
  if (f && method === "PUT") {
    const n = +f[2];
    if (n >= FILE_MAX_PARTS) return json({ error: "File too large." }, 413);
    const len = parseInt(request.headers.get("Content-Length") || "0", 10);
    if (!len) return json({ error: "Empty upload." }, 400);
    if (len > CHUNK_MAX + 1024) return json({ error: "Chunk too large." }, 413);
    if (by === "client" && !["received", "needs_info", "in_design", "review"].includes(job.status)) return json({ error: "This case is closed for new files." }, 409);
    const used = (job.files || []).reduce((t, x) => t + (x.stored || 0), 0);
    if (used + len > JOB_FILES_MAX) return json({ error: "This case has reached its storage limit (300 MB)." }, 413);
    const data = await request.arrayBuffer();
    await env.CASES.put("jf:" + job.id + ":" + f[1] + ":" + n, data, {
      expiration: Math.floor(Date.now() / 1000) + FILE_KEEP_DAYS * 86400, metadata: { s: data.byteLength },
    });
    return json({ ok: true });
  }

  // attach uploaded files: POST /api/jobs/<id>/files  {files:[{fid,name,size,stored,parts,gz}], deliver}
  if (sub === "/files" && method === "POST") {
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const list = Array.isArray(b.files) ? b.files.slice(0, 30) : [];
    const now = Date.now();
    let added = 0;
    for (const x of list) {
      if (!FID_RE.test(x.fid || "") || (job.files || []).some((y) => y.fid === x.fid)) continue;
      const parts = Math.max(1, Math.min(FILE_MAX_PARTS, parseInt(x.parts, 10) || 1));
      const lastPart = await env.CASES.get("jf:" + job.id + ":" + x.fid + ":" + (parts - 1), { type: "stream" });
      if (!lastPart) continue;
      if (lastPart.cancel) lastPart.cancel();
      job.files.push({ fid: x.fid, name: clip(x.name, 160) || "file", size: Math.max(0, +x.size || 0), stored: Math.max(0, +x.stored || 0),
        parts, gz: x.gz ? 1 : 0, kind: by === "admin" ? "output" : "input", at: now, exp: now + FILE_KEEP_DAYS * DAY_MS });
      added++;
    }
    if (added || (by === "admin" && b.deliver)) {
      job.updated = now; job.lastBy = by;
      if (by === "admin" && b.deliver && job.status !== "delivered") {
        job.status = "delivered";
        job.thread.push({ by: "system", name: "", text: "status:delivered", at: now });
      }
      await saveJob(env, job);
    }
    return json({ job: await jobView(env, job), added });
  }

  // download: GET /api/jobs/<id>/files/<fid>
  f = sub.match(/^\/files\/([A-Za-z0-9]{10})$/);
  if (f && method === "GET") {
    const file = (job.files || []).find((x) => x.fid === f[1]);
    if (!file) return json({ error: "File not found." }, 404);
    const first = await env.CASES.get("jf:" + job.id + ":" + file.fid + ":0", { type: "stream" });
    if (!first) return json({ error: "This file has expired." }, 410);
    const { readable, writable } = new TransformStream();
    (async () => {
      try {
        await first.pipeTo(writable, { preventClose: true });
        for (let i = 1; i < file.parts; i++) {
          const s = await env.CASES.get("jf:" + job.id + ":" + file.fid + ":" + i, { type: "stream" });
          if (!s) throw new Error("missing part " + i);
          await s.pipeTo(writable, { preventClose: true });
        }
        await writable.close();
      } catch (e) { try { await writable.abort(e); } catch {} }
    })();
    const headers = new Headers({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(file.name),
      "Cache-Control": "private, no-store",
      ...PRIVATE_HEADERS,
    });
    if (file.gz) headers.set("Content-Encoding", "gzip");
    return new Response(readable, { headers, encodeBody: file.gz ? "manual" : "automatic" });
  }

  // delete a file: DELETE /api/jobs/<id>/files/<fid>
  if (f && method === "DELETE") {
    const file = (job.files || []).find((x) => x.fid === f[1]);
    if (!file) return json({ error: "File not found." }, 404);
    if (by === "client" && (file.kind !== "input" || !["received", "needs_info"].includes(job.status))) return json({ error: "Not allowed." }, 403);
    await Promise.all(Array.from({ length: file.parts }, (_, i) => env.CASES.delete("jf:" + job.id + ":" + file.fid + ":" + i)));
    job.files = job.files.filter((x) => x.fid !== file.fid);
    job.updated = Date.now();
    await saveJob(env, job);
    return json({ job: await jobView(env, job) });
  }

  return json({ error: "Not found." }, 404);
}

/* ------------------------------------------------------ Contact messages */

async function submitContact(request, env) {
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (len > 16384) return json({ error: "Your message is too long." }, 413);
  let body;
  try { body = JSON.parse(await request.text()); } catch { return json({ error: "Please check the form and try again." }, 400); }
  if (!body || typeof body !== "object") return json({ error: "Please check the form and try again." }, 400);

  // Bots: hidden field filled in, or the form sent within 3 seconds of loading. Pretend it worked.
  if (String(body.website || "").trim() || !(Number(body.elapsed) >= 3000)) return json({ ok: true });

  const field = (k, max) => String(body[k] == null ? "" : body[k]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
  const vi = body.lang === "vi";
  const E = (en, v) => (vi ? v : en);
  const msg = {
    lang: vi ? "vi" : "en",
    name: field("name", 100).replace(/\s+/g, " "),
    email: field("email", 160).replace(/\s+/g, ""),
    practice: field("practice", 120).replace(/\s+/g, " "),
    country: field("country", 60).replace(/\s+/g, " "),
    service: field("service", 60).replace(/\s+/g, " "),
    message: field("message", 4000),
  };
  if (!msg.name) return json({ error: E("Please add your name.", "Vui lòng nhập họ tên.") }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(msg.email)) return json({ error: E("Please add a valid email address.", "Vui lòng nhập email hợp lệ.") }, 400);
  if (msg.message.length < 10) return json({ error: E("Please write a little more in your message.", "Vui lòng viết thêm nội dung.") }, 400);

  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const countKey = "msgcount:" + day;
  const count = parseInt((await env.CASES.get(countKey)) || "0", 10) || 0;
  if (count >= MSG_DAILY_CAP) {
    return json({ error: E("We've received a lot of messages today. Please email us at d.eightdesigncenter@gmail.com.", "Hôm nay chúng tôi nhận rất nhiều tin nhắn. Vui lòng gửi email đến d.eightdesigncenter@gmail.com.") }, 429);
  }

  const id = String(now) + newId().slice(0, 6);
  msg.created = now;
  msg.country_hint = request.headers.get("CF-IPCountry") || "";
  const expiration = Math.floor(now / 1000) + MSG_KEEP_DAYS * 86400;
  const meta = { n: msg.name.slice(0, 60), s: msg.service.slice(0, 40), c: now };
  await env.CASES.put("msg:" + id, JSON.stringify(msg), { expiration, metadata: meta });
  await env.CASES.put(countKey, String(count + 1), { expiration: Math.floor(now / 1000) + 2 * 86400 });
  return json({ ok: true }, 201);
}

async function listMessages(env) {
  const keys = [];
  let cursor;
  do {
    const page = await env.CASES.list({ prefix: "msg:", cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && keys.length < 300);

  keys.sort((a, b) => (b.metadata?.c || 0) - (a.metadata?.c || 0));
  const recent = keys.slice(0, 100);
  const items = (await Promise.all(recent.map(async (k) => {
    const m = await env.CASES.get(k.name, "json");
    return m ? { id: k.name.slice(4), ...m } : null;
  }))).filter(Boolean);
  return json({ items, total: keys.length });
}

async function deleteMessage(env, id) {
  if (!MSG_ID_RE.test(id)) return json({ error: "Mã tin nhắn không hợp lệ." }, 400);
  await env.CASES.delete("msg:" + id);
  return json({ ok: true });
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
  <a class="logo" href="/" target="_blank" rel="noopener" aria-label="D.EIGHT DESIGN CENTER">
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
      ...LINK_HEADERS,
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
    ...LINK_HEADERS,
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
    <a class="d8-logo" href="/" aria-label="D.EIGHT DESIGN CENTER">
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
        <a class="btn btn-primary" href="/">Visit our website</a>
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
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...LINK_HEADERS },
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

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...PRIVATE_HEADERS, ...extra },
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
