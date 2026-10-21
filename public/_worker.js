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
const ASSET_VERSION = "2026-10-21.2"; // bump with brand.css changes
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
const TRIAL_CASES = 2;                             // a new customer's first cases are a free trial
const TRIAL_CREDIT_USD = 50;                       // ...worth up to this much in total
// "check": the customer paid (provider said so) or says they paid another way; D.EIGHT confirms it.
const PAY_STATES = ["", "trial", "due", "check", "paid"];
const JOB_STAGES = ["", "design", "qc", "fix", "ready", "done"]; // internal design workflow, never shown to customers
const AI_MODELS = ["@cf/google/gemma-4-26b-a4b-it", "@cf/meta/llama-3.1-8b-instruct-fp8"]; // chat translation, tried in order

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
      if (m) return await viewerPage(env, m[1], url);

      m = path.match(/^\/raw\/([^/]+)\/?$/);
      if (m) return await rawFile(env, m[1]);

      m = path.match(/^\/og\/([^/]+)\.jpg$/);
      if (m) return await ogImage(request, env, m[1]);

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
    const pc = payConf(env), on = (await loadSettings(env)).onlinePay;
    return json({ googleClientId: conf(env).clientId, trialCases: TRIAL_CASES, trialCredit: TRIAL_CREDIT_USD, translate: !!env.AI, fileStore: activeStore(env),
      pay: { paypal: on && !!pc.paypal, stripe: on && !!pc.stripe }, db: !!env.DB },
      200, { "Cache-Control": "public, max-age=300" });
  }
  if (path === "/api/auth/google" && method === "POST") return googleSignIn(request, env, url);
  if (path === "/api/auth/logout" && method === "POST") return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(url) });

  const session = await readSession(request, env);
  const staff = session ? await staffFor(env, session.email) : null;
  if (path === "/api/me" && method === "GET") return json({ user: session ? publicUser(session, staff) : null });

  // A request authenticated only by the session cookie must carry X-D8 (blocks form-based CSRF).
  const keyOk = await isAuthorized(request, env);
  if (!keyOk && session && method !== "GET" && request.headers.get("X-D8") !== "1") {
    return json({ error: "Missing request header." }, 403);
  }
  // The admin password (X-Upload-Key) acts as an owner with every permission.
  const isStaff = keyOk || !!staff;
  const can = (p) => keyOk || !!(staff && staff.perms.has(p));

  /* ---- signed-in customers (and admin) ---- */
  if (path === "/api/ai/rx" && method === "POST") {
    if (!session && !keyOk) return json({ error: "Please sign in." }, 401);
    if (parseInt(request.headers.get("Content-Length") || "0", 10) > 3 * 1024 * 1024) return json({ error: "The photo is too large." }, 413);
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const text = clip(b.text, 4000), image = typeof b.image === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(b.image) ? b.image : "";
    if (!text && !image) return json({ error: "Add a photo or some text first." }, 400);
    const schema = Object.entries(RX_FIELDS).map(([s, f]) => "- " + s + ": " + Object.entries(f).map(([k, o]) => o ? k + " (one of: " + o.join(" | ") + ")" : k + " (free text)").join(", ")).join("\n");
    const system = "You read dental lab prescriptions (Rx) for D.EIGHT, a remote dental CAD design team, and turn them into form fields. " +
      "Return ONLY a JSON object with these keys: service (one of: " + SERVICE_NAMES.join(" | ") + ", or \"\"), teeth (tooth numbers as written, e.g. \"11, 21\" or \"14-24\"), " +
      "numbering (\"FDI\" or \"UNS\" for Universal 1-32; guess from the numbers), material, shade, neededBy (YYYY-MM-DD or \"\"), " +
      "notes (the remaining design instructions in clear English, concise), rx (object with the extra fields for the chosen service; use the listed option values exactly). " +
      "Extra fields per service:\n" + schema + "\nUse \"\" for anything not stated. Do not invent values. Do not include any patient name, date of birth or other patient identifier anywhere.";
    const content = image ? [{ type: "text", text: text || "Read this prescription." }, { type: "image_url", image_url: { url: image } }] : text;
    let out;
    try { out = parseJsonLoose(await aiChat(env, [{ role: "system", content: system }, { role: "user", content }], { maxTokens: 1200, vision: !!image })); }
    catch (err) { return json({ error: err.message, code: err.code || "" }, err.status || 502); }
    if (!out) return json({ error: "Couldn't read that. Try a clearer photo or paste the text." }, 422);
    const service = SERVICE_NAMES.includes(out.service) ? out.service : "";
    const rx = {};
    for (const [k, opts] of Object.entries(RX_FIELDS[service] || {})) {
      const v = clip(out.rx && out.rx[k], 160);
      if (v && (!opts || opts.includes(v))) rx[k] = v;
    }
    return json({ fields: { service, teeth: clip(out.teeth, 120), numbering: out.numbering === "UNS" ? "UNS" : out.numbering === "FDI" ? "FDI" : "",
      material: clip(out.material, 120), shade: clip(out.shade, 40), neededBy: /^\d{4}-\d{2}-\d{2}$/.test(out.neededBy || "") ? out.neededBy : "",
      notes: clip(out.notes, 4000), rx } });
  }

  if (path === "/api/ai/check" && method === "POST") {
    if (!session && !keyOk) return json({ error: "Please sign in." }, 401);
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const text = ["Case reference: " + clip(b.title, 80), "Instructions: " + clip(b.notes, 3000), "File names: " + clip((Array.isArray(b.files) ? b.files : []).join(", "), 1000)].join("\n");
    const system = "You check a dental case before it is sent to a design team. Patient privacy: the case reference, instructions and file names must not contain a patient's name, " +
      "date of birth, phone number or other personal identifier. Doctor names, lab names, tooth numbers, materials and brand names are fine. " +
      "Return ONLY JSON: {\"patient\": true|false, \"found\": \"the identifying text, or empty\"}.";
    try {
      const out = parseJsonLoose(await aiChat(env, [{ role: "system", content: system }, { role: "user", content: text }], { maxTokens: 200 }));
      return json({ patient: !!(out && out.patient === true), found: clip(out && out.found, 120) });
    } catch (err) { return json({ error: err.message, code: err.code || "" }, err.status || 502); }
  }

  if (path === "/api/translate" && method === "POST") {
    if (!session && !keyOk) return json({ error: "Please sign in." }, 401);
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const text = clip(b.text, 2000);
    if (!text) return json({ error: "Empty text." }, 400);
    try { return json({ text: await translateText(env, text, b.to === "vi" ? "vi" : "en") }); }
    catch (err) { return json({ error: err.message, code: err.code || "" }, err.status || 502); }
  }

  if (path.startsWith("/api/my/") || path.startsWith("/api/jobs/")) {
    if (!session && !keyOk) return json({ error: "Please sign in." }, 401);
    const who = staffWho(session, staff, keyOk, can);
    return handleJobs(request, env, url, who);
  }

  /* ---- workspace (staff) ---- */
  if (!isStaff) {
    if (!session) await sleep(400); // slow down password guessing
    return json({ error: session ? "Tài khoản này chưa được cấp quyền vào khu làm việc." : "Sai mật khẩu." }, session ? 403 : 401);
  }
  const who = staffWho(session, staff, keyOk, can);
  const deny = () => json({ error: "Bạn không có quyền dùng mục này." }, 403);

  if (path === "/api/ping" && method === "GET") return json({ ok: true, perms: keyOk ? PERM_KEYS : [...staff.perms] }); // no KV use for the password
  if (path === "/api/staff" || path.startsWith("/api/staff/") || path === "/api/roles") return handleStaff(request, env, url, who);
  if (path.startsWith("/api/prices/")) return handlePrices(request, env, url, who);
  if (/^\/api\/(orders|customers|products|prices|payments|techrates|reports|export|import|settings|book)(\/|$)/.test(path)) {
    try { return await handleBook(request, env, url, who); }
    catch (err) { if (err && err.status) return json({ error: err.message, code: err.code || "", ...(err.dupes ? { dupes: err.dupes } : {}), ...(err.id ? { id: err.id } : {}) }, err.status); throw err; }
  }
  const og = path.match(/^\/api\/cases\/([^/]+)\/og$/);
  if (og && method === "PUT") return can("links.manage") || can("cases.deliver") ? putOgImage(request, env, og[1]) : deny();

  if (path === "/api/list" && method === "GET") return can("links.manage") || can("cases.deliver") ? listCases(env) : deny();
  if (path === "/api/upload" && method === "POST") return can("links.manage") || can("cases.deliver") ? uploadCase(request, env, url) : deny();

  const del = path.match(/^\/api\/cases\/([^/]+)$/);
  if (del && method === "DELETE") return can("links.manage") ? deleteCase(env, del[1]) : deny();

  if (path === "/api/messages" && method === "GET") return can("messages.view") ? listMessages(env) : deny();
  const delMsg = path.match(/^\/api\/messages\/([^/]+)$/);
  if (delMsg && method === "DELETE") return can("messages.view") ? deleteMessage(env, delMsg[1]) : deny();

  if (path === "/api/admin/jobs" && method === "GET") return listJobs(env, null, who);
  // accounts that signed in with Google: customers.view for the customer pages, staff.manage to grant workspace access
  if (path === "/api/admin/users" && method === "GET") return can("customers.view") || can("staff.manage") ? listUsers(env) : deny();

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
  const dec = (k, n) => { try { return cleanLabel(decodeURIComponent(h(k))).slice(0, n); } catch { return ""; } };
  const ogTitle = dec("X-OG-Title", 120), ogDesc = dec("X-OG-Desc", 200), orderId = Math.max(0, parseInt(h("X-Order-Id"), 10) || 0);

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
  // title and description for link previews (Messenger, Zalo, WhatsApp…) live in the value, the list uses the short metadata
  const full = { ...meta, ...(ogTitle ? { t: ogTitle } : {}), ...(ogDesc ? { d: ogDesc } : {}), ...(orderId ? { oid: orderId } : {}) };
  await env.CASES.put("meta:" + id, JSON.stringify(full), { expiration, metadata: { ...meta, ...(orderId ? { oid: orderId } : {}) } });

  return json({ id, url: `${url.origin}/v/${id}`, ...publicMeta(full) }, 201);
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
  await Promise.all([env.CASES.delete("case:" + id), env.CASES.delete("meta:" + id), env.CASES.delete("og:" + id)]);
  return json({ ok: true });
}

function publicMeta(meta) {
  return {
    label: meta.l || "",
    title: meta.t || "",
    desc: meta.d || "",
    orderId: meta.oid || 0,
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

function publicUser(s, staff) {
  return { email: s.email, name: s.name, picture: s.picture, role: staff ? staff.role : "client", staff: !!staff,
    roleLabel: staff ? staff.label : "", perms: staff ? [...staff.perms] : [] };
}
function staffWho(session, staff, keyOk, can) {
  return session ? { email: session.email, name: session.name, staff: keyOk || !!staff, viaKey: keyOk, can }
    : { email: "", name: "D.EIGHT", staff: true, viaKey: true, can };
}

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
    return { email: String(p.e).toLowerCase(), name: p.n, picture: p.p };
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
  return json({ user: publicUser({ email, name: user.name, picture: user.picture }, await staffFor(env, email)) }, 200, { "Set-Cookie": cookie });
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

/* ------------------------------------------------- Payments (PayPal, Stripe) */
// Prices are set by D.EIGHT per case and never shown to customers until the case is marked
// "due". The customer is sent to PayPal or Stripe Checkout; when they come back (or whenever
// the case is opened later) the server asks the provider directly and only then marks it paid.
// Secrets: PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET (+ PAYPAL_ENV=live), STRIPE_SECRET_KEY.
const PAY_TRIES_MAX = 5;
function payConf(env) {
  const paypal = env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET ? {
    id: String(env.PAYPAL_CLIENT_ID), secret: String(env.PAYPAL_CLIENT_SECRET),
    base: env.PAYPAL_API || (String(env.PAYPAL_ENV || "").toLowerCase() === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"),
  } : null;
  const stripe = env.STRIPE_SECRET_KEY ? { key: String(env.STRIPE_SECRET_KEY), base: env.STRIPE_API || "https://api.stripe.com" } : null;
  return { paypal, stripe };
}
// What the customer is asked to pay: the "due" amount if D.EIGHT set one, otherwise the case price.
function amountDue(job) {
  const a = typeof job.due === "number" ? job.due : job.price;
  return typeof a === "number" && a > 0 ? Math.round(a * 100) / 100 : 0;
}
function payError(message, status = 502) { const e = new Error(message); e.status = status; return e; }
async function paypalToken(pp) {
  const r = await fetch(pp.base + "/v1/oauth2/token", { method: "POST",
    headers: { Authorization: "Basic " + btoa(pp.id + ":" + pp.secret), "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw payError("PayPal is not available right now. Please try again later.");
  return d.access_token;
}
async function paypalCall(pp, token, method, path, body, headers) {
  const r = await fetch(pp.base + path, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}
function stripeForm(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + "[" + k + "]" : k;
    if (v && typeof v === "object") stripeForm(v, key, out);
    else if (v !== undefined && v !== null) out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  }
  return out.join("&");
}
async function stripeCall(st, method, path, form, idem) {
  const headers = { Authorization: "Bearer " + st.key };
  if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idem) headers["Idempotency-Key"] = idem;
  const r = await fetch(st.base + path, { method, headers, body: form ? stripeForm(form) : undefined });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}
async function startPayment(env, job, via, origin, amount) {
  const cfg = payConf(env);
  const back = (state) => origin + "/portal?pay=" + state + "&case=" + encodeURIComponent(job.id);
  if (via === "paypal") {
    const pp = cfg.paypal, token = await paypalToken(pp);
    const r = await paypalCall(pp, token, "POST", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [{ reference_id: job.id, custom_id: job.id, invoice_id: job.id + "-" + Date.now().toString(36),
        description: "D.EIGHT dental CAD design, case " + job.id, amount: { currency_code: "USD", value: amount.toFixed(2) } }],
      payment_source: { paypal: { experience_context: { brand_name: "D.EIGHT DESIGN CENTER", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING",
        return_url: back("paypal"), cancel_url: back("cancel") } } },
    }, { "PayPal-Request-Id": crypto.randomUUID() });
    const link = (r.data.links || []).find((l) => l.rel === "payer-action" || l.rel === "approve");
    if (!r.ok || !r.data.id || !link) throw payError("PayPal could not start the payment. Please try again.");
    return { id: r.data.id, url: link.href };
  }
  const r = await stripeCall(cfg.stripe, "POST", "/v1/checkout/sessions", {
    mode: "payment", client_reference_id: job.id, customer_email: job.owner,
    success_url: back("stripe") + "&sid={CHECKOUT_SESSION_ID}", cancel_url: back("cancel"),
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: Math.round(amount * 100), product_data: { name: "D.EIGHT dental CAD design · " + job.id } } }],
    metadata: { case: job.id }, payment_intent_data: { metadata: { case: job.id }, description: "D.EIGHT case " + job.id },
  }, job.id + "-" + Date.now());
  if (!r.ok || !r.data.id || !r.data.url) throw payError("Card payment could not start. Please try again.");
  return { id: r.data.id, url: r.data.url };
}
// Payment reported (by PayPal / Stripe, or by the customer for a transfer): waits for D.EIGHT to confirm.
function paySent(job, t, via, ref, amount, note) {
  const now = Date.now();
  if (t) t.state = "paid";
  job.pay = "check";
  job.paid = { via, ref: String(ref || "").slice(0, 80), amount: Math.round(amount * 100) / 100, at: now, confirmed: false };
  if (note) job.paid.note = clip(note, 300);
  job.updated = now;
  job.thread.push({ by: "system", name: "", text: "pay:sent:" + via, at: now });
}
// D.EIGHT has the money: confirm a reported payment, or record one received another way.
function payConfirm(job, by, amount) {
  const now = Date.now();
  if (!job.paid) job.paid = { via: "manual", ref: "", amount: Math.round(amount * 100) / 100, at: now };
  Object.assign(job.paid, { confirmed: true, confirmedAt: now, confirmedBy: String(by || "").slice(0, 160) });
  job.pay = "paid"; job.updated = now;
  job.thread.push({ by: "system", name: "", text: "pay:paid:" + job.paid.via, at: now });
}
// The money did not arrive: back to "due" (the attempt that reported it is not trusted again).
function payReject(job) {
  const now = Date.now();
  (job.payTries || []).forEach((t) => { if (t.state === "paid") t.state = "dead"; });
  delete job.paid;
  job.pay = "due"; job.updated = now;
  job.thread.push({ by: "system", name: "", text: "pay:rejected", at: now });
}
// Ask the providers about every recent attempt. Mutates the job; returns true if anything changed.
async function syncPayment(env, job) {
  const tries = job.payTries || [];
  if (job.pay !== "due" || !tries.some((t) => t.state === "open" || t.state === "held")) return false;
  const cfg = payConf(env);
  let changed = false, token = null;
  for (const t of tries) {
    if (t.state !== "open" && t.state !== "held") continue;
    try {
      if (t.via === "paypal" && cfg.paypal) {
        token = token || await paypalToken(cfg.paypal);
        const path = "/v2/checkout/orders/" + encodeURIComponent(t.id);
        let o = await paypalCall(cfg.paypal, token, "GET", path);
        if (!o.ok) { if (o.status === 404) { t.state = "dead"; changed = true; } continue; }
        if (o.data.status === "APPROVED") {
          o = await paypalCall(cfg.paypal, token, "POST", path + "/capture", null, { "PayPal-Request-Id": t.id + "-capture", Prefer: "return=representation" });
          if (!o.ok) o = await paypalCall(cfg.paypal, token, "GET", path); // e.g. captured a moment ago
          if (!o.ok) continue;
        }
        if (o.data.status === "VOIDED") { t.state = "dead"; changed = true; continue; }
        if (o.data.status !== "COMPLETED") continue;
        const pu = (o.data.purchase_units || [])[0] || {};
        const cap = ((pu.payments || {}).captures || [])[0];
        const mine = cap && (pu.custom_id === job.id || pu.reference_id === job.id || cap.custom_id === job.id);
        if (!mine || !cap.amount || cap.amount.currency_code !== "USD" || Math.abs(Number(cap.amount.value) - t.amount) > 0.005) continue;
        if (cap.status === "COMPLETED") { paySent(job, t, "paypal", cap.id, Number(cap.amount.value)); return true; }
        if (cap.status === "PENDING" && t.state !== "held") { t.state = "held"; changed = true; }
      } else if (t.via === "stripe" && cfg.stripe) {
        const s = await stripeCall(cfg.stripe, "GET", "/v1/checkout/sessions/" + encodeURIComponent(t.id));
        if (!s.ok) { if (s.status === 404) { t.state = "dead"; changed = true; } continue; }
        const d = s.data;
        if (d.status === "expired") { t.state = "dead"; changed = true; continue; }
        if (d.payment_status === "paid" && d.client_reference_id === job.id && d.currency === "usd" && d.amount_total === Math.round(t.amount * 100)) {
          paySent(job, t, "stripe", typeof d.payment_intent === "string" ? d.payment_intent : (d.payment_intent && d.payment_intent.id) || d.id, d.amount_total / 100);
          return true;
        }
      }
    } catch { /* provider unreachable: checked again next time the case is opened */ }
  }
  return changed;
}

/* ------------------------------------------- Staff, roles and permissions */
// Everyone who signs in with Google is a customer unless D.EIGHT adds them as staff.
// Emails in ADMIN_EMAILS are owners: always admin with every permission (cannot be locked out).
// Roles (admin, designer, qc and any custom role) are permission sets kept in "cfg:roles";
// a staff member can also have their own permission list that replaces the role's.
const PERMS = [
  ["orders.view", "Xem tất cả đơn hàng (không chỉ đơn được giao)", "Đơn hàng"],
  ["orders.edit", "Nhập / sửa đơn hàng, tạo đơn làm lại (R) và làm tiếp (C)", "Đơn hàng"],
  ["orders.delete", "Xóa đơn hàng", "Đơn hàng"],
  ["cases.all", "Xem tất cả ca từ cổng khách (không chỉ ca được giao)", "Ca hàng"],
  ["cases.assign", "Giao ca cho KTV / QC", "Ca hàng"],
  ["cases.status", "Đổi trạng thái ca", "Ca hàng"],
  ["cases.customer", "Xem email và liên hệ của khách", "Ca hàng"],
  ["cases.files", "Tải file của khách", "Ca hàng"],
  ["cases.design", "Tải file thiết kế lên và gửi QC", "Thiết kế & QC"],
  ["cases.qc", "Kiểm tra QC (đạt / không đạt)", "Thiết kế & QC"],
  ["cases.notes", "Chat nội bộ theo mã đơn (KTV, QC, quản trị)", "Thiết kế & QC"],
  ["cases.deliver", "Gửi bản 3D và giao file cho khách", "Thiết kế & QC"],
  ["cases.delete", "Xóa file trong ca", "Thiết kế & QC"],
  ["cases.chat_read", "Đọc tin nhắn với khách", "Tin nhắn"],
  ["cases.chat", "Nhắn tin cho khách", "Tin nhắn"],
  ["ai.use", "Công cụ AI (tóm tắt, gợi ý trả lời)", "Tin nhắn"],
  ["billing.view", "Xem giá, tiền của đơn, công nợ", "Tiền"],
  ["billing.edit", "Sửa giá đơn, ghi nhận tiền khách trả", "Tiền"],
  ["pricing.manage", "Mã hàng và bảng giá theo khách", "Tiền"],
  ["techpay.manage", "Tiền công KTV (bảng công từng KTV)", "Tiền"],
  ["techpay.own", "Xem tiền công của chính mình", "Tiền"],
  ["customers.view", "Danh sách và hồ sơ khách hàng", "Quản lý"],
  ["customers.edit", "Thêm / sửa khách hàng", "Quản lý"],
  ["reports.view", "Báo cáo, biểu đồ thống kê", "Quản lý"],
  ["messages.view", "Tin nhắn từ form liên hệ", "Quản lý"],
  ["links.manage", "Link xem 3D và công cụ HTML sang STL", "Quản lý"],
  ["export.csv", "Xuất Excel / CSV", "Quản lý"],
  ["staff.manage", "Nhân sự và phân quyền", "Quản lý"],
];
const PERM_KEYS = PERMS.map((p) => p[0]);
const DEFAULT_ROLES = {
  admin: { label: "Quản trị", perms: PERM_KEYS },
  designer: { label: "Kỹ thuật viên thiết kế", perms: ["cases.files", "cases.design", "cases.notes", "cases.chat_read", "ai.use", "links.manage"] },
  qc: { label: "QC – kiểm tra chất lượng", perms: ["cases.files", "cases.qc", "cases.notes", "cases.chat_read", "ai.use", "links.manage"] },
};
const ROLE_KEY_RE = /^[a-z][a-z0-9_]{1,23}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const staffCache = new Map(); // per isolate, a few seconds: role changes apply almost at once
const cacheGet = (k) => { const c = staffCache.get(k); return c && Date.now() - c.at < 15000 ? c : null; };
async function loadRoles(env) {
  const c = cacheGet("@roles");
  if (c) return c.v;
  const saved = (await env.CASES.get("cfg:roles", "json")) || {};
  const roles = {};
  for (const [k, r] of Object.entries({ ...DEFAULT_ROLES, ...saved })) {
    if (!ROLE_KEY_RE.test(k) || !r) continue;
    roles[k] = { label: clip(r.label, 60) || k, perms: (Array.isArray(r.perms) ? r.perms : []).filter((p) => PERM_KEYS.includes(p)) };
  }
  roles.admin = { label: (saved.admin && clip(saved.admin.label, 60)) || DEFAULT_ROLES.admin.label, perms: PERM_KEYS };
  staffCache.set("@roles", { at: Date.now(), v: roles });
  return roles;
}
async function staffFor(env, email) {
  email = String(email || "").toLowerCase();
  if (!email) return null;
  const roles = await loadRoles(env);
  if (conf(env).admins.includes(email)) return { email, role: "admin", label: roles.admin.label, perms: new Set(PERM_KEYS), owner: true };
  const rec = (await loadStaffMap(env))[email];
  if (!rec || rec.active === false || !roles[rec.role]) return null;
  const perms = Array.isArray(rec.perms) ? rec.perms.filter((p) => PERM_KEYS.includes(p)) : roles[rec.role].perms;
  return { email, role: rec.role, label: roles[rec.role].label, perms: new Set(perms), custom: Array.isArray(rec.perms) };
}
// Who may see a case in the workspace (the customer who owns it is handled separately).
function staffSees(who, j) {
  if (!who || !who.staff) return false;
  if (who.viaKey || who.can("cases.all") || who.can("cases.assign")) return true;
  if (j.designer && j.designer === who.email) return true;
  if (j.qcBy && j.qcBy === who.email) return true;
  return who.can("cases.qc") && j.stage === "qc" && !j.qcBy;
}

async function handleStaff(request, env, url, who) {
  const path = url.pathname, method = request.method;
  // names and roles of the team, for assignment lists (any staff member)
  if (path === "/api/staff/team" && method === "GET") {
    const roles = await loadRoles(env);
    const team = [];
    for (const email of conf(env).admins) team.push({ email, name: "", role: "admin", label: roles.admin.label, owner: true, design: true, qc: true });
    for (const r of await listStaffRecords(env)) {
      if (r.active === false || !roles[r.role] || team.some((t) => t.email === r.email)) continue;
      const perms = Array.isArray(r.perms) ? r.perms : roles[r.role].perms;
      team.push({ email: r.email, name: r.name || "", role: r.role, label: roles[r.role].label, design: perms.includes("cases.design"), qc: perms.includes("cases.qc") });
    }
    await fillNames(env, team);
    return json({ team });
  }
  if (!who.can("staff.manage")) return json({ error: "Bạn không có quyền quản lý nhân sự." }, 403);

  if (path === "/api/staff" && method === "GET") {
    const roles = await loadRoles(env);
    const staff = (await listStaffRecords(env)).filter((r) => !conf(env).admins.includes(r.email));
    const owners = conf(env).admins.map((email) => ({ email, name: "", role: "admin", owner: true, active: true }));
    const all = [...owners, ...staff];
    await fillNames(env, all);
    return json({ staff: all, roles, perms: PERMS.map(([key, label, group]) => ({ key, label, group })) });
  }
  if (path === "/api/staff" && method === "POST") {
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const email = String(b.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 160) return json({ error: "Email không hợp lệ." }, 400);
    if (conf(env).admins.includes(email)) return json({ error: "Tài khoản chủ (ADMIN_EMAILS) luôn là Quản trị, không sửa được." }, 400);
    const roles = await loadRoles(env);
    if (!roles[b.role]) return json({ error: "Vai trò không tồn tại." }, 400);
    const perms = Array.isArray(b.perms) ? [...new Set(b.perms.filter((p) => PERM_KEYS.includes(p)))] : null;
    if (email === who.email && !(perms || roles[b.role].perms).includes("staff.manage")) return json({ error: "Bạn không thể tự bỏ quyền quản lý nhân sự của chính mình." }, 400);
    if (email === who.email && b.active === false) return json({ error: "Bạn không thể tự khóa tài khoản của mình." }, 400);
    const map = await loadStaffMap(env, true);
    const prev = map[email];
    const rec = { email, role: b.role, perms, name: clip(b.name, 80) || (prev && prev.name) || "", active: b.active !== false,
      added: (prev && prev.added) || Date.now(), by: (prev && prev.by) || who.email || "password", updated: Date.now() };
    map[email] = rec;
    await saveStaffMap(env, map);
    return json({ staff: rec });
  }
  let m = path.match(/^\/api\/staff\/(.+)$/);
  if (m && method === "DELETE") {
    const email = decodeURIComponent(m[1]).toLowerCase();
    if (conf(env).admins.includes(email)) return json({ error: "Không xóa được tài khoản chủ." }, 400);
    if (email === who.email) return json({ error: "Bạn không thể tự xóa mình." }, 400);
    const map = await loadStaffMap(env, true);
    delete map[email];
    await saveStaffMap(env, map);
    return json({ ok: true });
  }
  if (path === "/api/roles" && method === "POST") {
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const input = b && typeof b.roles === "object" ? b.roles : null;
    if (!input) return json({ error: "Bad request." }, 400);
    const out = {};
    for (const [k, r] of Object.entries(input)) {
      if (!ROLE_KEY_RE.test(k) || !r) return json({ error: "Mã vai trò không hợp lệ: " + k }, 400);
      out[k] = { label: clip(r.label, 60) || k, perms: k === "admin" ? PERM_KEYS : [...new Set((Array.isArray(r.perms) ? r.perms : []).filter((p) => PERM_KEYS.includes(p)))] };
    }
    if (!out.admin) out.admin = { label: DEFAULT_ROLES.admin.label, perms: PERM_KEYS };
    const used = new Set((await listStaffRecords(env)).map((r) => r.role));
    for (const k of Object.keys(await loadRoles(env))) {
      if (!out[k] && used.has(k)) return json({ error: "Vai trò \"" + k + "\" đang có người dùng, chuyển họ sang vai trò khác trước khi xóa." }, 400);
    }
    // the person saving must keep staff.manage through their role
    const me = await staffFor(env, who.email);
    if (me && !me.owner && !me.custom && out[me.role] && !out[me.role].perms.includes("staff.manage")) return json({ error: "Bạn không thể bỏ quyền quản lý nhân sự khỏi vai trò của chính mình." }, 400);
    await env.CASES.put("cfg:roles", JSON.stringify(out));
    staffCache.delete("@roles");
    return json({ roles: await loadRoles(env) });
  }
  return json({ error: "Không tìm thấy." }, 404);
}
// All staff records live in one KV value ("cfg:staff", email -> record): one read, no KV "list" requests.
async function loadStaffMap(env, fresh) {
  const c = !fresh && cacheGet("@staff");
  if (c) return c.v;
  const v = (await env.CASES.get("cfg:staff", "json")) || {};
  staffCache.set("@staff", { at: Date.now(), v });
  return v;
}
async function saveStaffMap(env, map) {
  await env.CASES.put("cfg:staff", JSON.stringify(map));
  staffCache.set("@staff", { at: Date.now(), v: map });
}
async function listStaffRecords(env) {
  return Object.values(await loadStaffMap(env)).filter((r) => r && r.email);
}
async function fillNames(env, list) {
  await Promise.all(list.map(async (t) => {
    const u = await env.CASES.get("user:" + t.email, "json");
    if (u) { t.name = t.name || u.name || ""; t.last = u.last || 0; t.picture = u.picture || ""; }
  }));
}

/* ---------------------------------------------------- Price lists (staff) */
// One list per customer ("price:<email>") and a default list ("price:default").
// Units: unit (per tooth / implant / unit), arch, case. Never shown to customers.
const PRICE_UNITS = ["unit", "arch", "case"];
async function handlePrices(request, env, url, who) {
  const m = url.pathname.match(/^\/api\/prices\/(.+)$/);
  const key = m ? decodeURIComponent(m[1]).toLowerCase() : "";
  if (!(key === "default" || EMAIL_RE.test(key))) return json({ error: "Không tìm thấy." }, 404);
  if (request.method === "GET") {
    if (!(who.can("pricing.manage") || who.can("billing.edit"))) return json({ error: "Không có quyền xem bảng giá." }, 403);
    const own = await env.CASES.get("price:" + key, "json");
    const def = key === "default" ? null : await env.CASES.get("price:default", "json");
    return json({ list: own || { items: [], note: "" }, fallback: def || { items: [], note: "" }, custom: !!own });
  }
  if (request.method === "POST") {
    if (!who.can("pricing.manage")) return json({ error: "Không có quyền sửa bảng giá." }, 403);
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    if (b.reset && key !== "default") { await env.CASES.delete("price:" + key); return json({ list: { items: [], note: "" }, custom: false }); }
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60).map((x) => ({
      service: clip(x.service, 60), name: clip(x.name, 80), unit: PRICE_UNITS.includes(x.unit) ? x.unit : "unit",
      price: Math.round(Math.max(0, Math.min(100000, Number(x.price) || 0)) * 100) / 100,
    })).filter((x) => x.service || x.name);
    const list = { items, note: clip(b.note, 600), updated: Date.now(), by: who.email || "password" };
    await env.CASES.put("price:" + key, JSON.stringify(list));
    return json({ list, custom: key !== "default" });
  }
  return json({ error: "Method not allowed." }, 405);
}

/* --------------------------------------------------------- Customer jobs */

function cleanRx(rx) {
  const out = {};
  if (!rx || typeof rx !== "object" || Array.isArray(rx)) return out;
  for (const [k, v] of Object.entries(rx).slice(0, 16)) {
    if (!/^[a-z_]{1,24}$/.test(k)) continue;
    const s = clip(v, 160);
    if (s) out[k] = s;
  }
  return out;
}

/* ---------------------------------------------------------- AI helpers (Workers AI, binding "AI") */
const noAi = (vi) => Object.assign(new Error(vi ? "Chưa bật AI (Workers AI)." : "AI features are not switched on yet."), { status: 503, code: "no_ai" });
const aiText = (out) => String((out && out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content) || (out && out.response) || "")
  .replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
// Chat completion: tries each model in turn. With an image, only the vision model (the first) is used.
async function aiChat(env, messages, { maxTokens = 1500, vi = false, vision = false } = {}) {
  if (!env.AI) throw noAi(vi);
  const models = vision ? AI_MODELS.slice(0, 1) : AI_MODELS;
  for (const model of models) {
    try {
      const t = aiText(await env.AI.run(model, { messages, temperature: 0.2, max_completion_tokens: maxTokens, chat_template_kwargs: { enable_thinking: false } }));
      if (t) return t;
    } catch (err) { console.error("ai", model, err && err.message); }
  }
  throw Object.assign(new Error(vi ? "AI đang bận, thử lại sau ít phút." : "The AI assistant is busy. Please try again in a minute."), { status: 502 });
}
function parseJsonLoose(t) {
  const s = String(t || "").replace(/```(?:json)?/gi, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
const RX_FIELDS = {
  "Implant restorations": { retention: ["Screw-retained crown", "Cement-retained crown", "Custom abutment + crown", "Ti-base crown", "Implant bridge"], implant_system: 0, scan_body: 0 },
  "All-on-X & bars": { arch: ["Upper", "Lower", "Both"], prosthesis: ["Hybrid bridge", "Bar", "Bar + overlay", "Provisional (PMMA)"], implant_system: 0, mua: 0 },
  "Surgical guides": { support: ["Tooth-supported", "Tissue-supported", "Bone-supported"], implant_system: 0, sleeve: 0, sites: 0 },
  "Crown & bridge": { restoration: ["Full contour", "Cutback", "Coping / framework", "Veneer", "Inlay / onlay", "Post and core"], cement_gap: 0 },
  "Wax-up & smile design": { arch: ["Upper", "Lower", "Both"], photo: ["Photo attached", "No photo"] },
  "Dentures & partials": { arch: ["Upper", "Lower", "Both"], base: ["Hard acrylic", "Flexible", "Metal framework"], teeth_library: 0 },
  "Splints & trays": { appliance: ["Night guard", "Michigan splint", "Kois deprogrammer", "Sleep appliance", "Retainer", "Bleach tray", "Custom impression tray"], arch: ["Upper", "Lower", "Both"], thickness: 0 },
  "Aligner & ortho": { arch: ["Upper", "Lower", "Both"], goals: 0 },
  "Digital models": { model: ["Dies", "Articulated model", "Ortho model", "Implant model with gingiva"], arch: ["Upper", "Lower", "Both"] },
};
const SERVICE_NAMES = [...Object.keys(RX_FIELDS), "Trial case", "Something else"];
// The case as plain text for the AI (no file contents, only names).
function caseContext(job, maxMsgs = 30) {
  const lines = [
    "Case " + job.id + ": " + job.title, "Service: " + (job.service || "-"),
    "Teeth: " + (job.teeth || "-") + " (" + (job.numbering === "UNS" ? "Universal" : "FDI") + " numbering)",
    "Material: " + (job.material || "-"), "Shade: " + (job.shade || "-"), "Needed by: " + (job.neededBy || "-"), "Status: " + job.status,
  ];
  for (const [k, v] of Object.entries(job.rx || {})) lines.push(k.replace(/_/g, " ") + ": " + v);
  if (job.notes) lines.push("Customer instructions: " + job.notes.slice(0, 3000));
  const files = (job.files || []).filter((f) => f.kind !== "output").map((f) => f.name);
  lines.push("Files from customer: " + (files.join(", ") || "none") + ((job.links || []).length ? " + " + job.links.length + " file link(s)" : ""));
  const outs = (job.files || []).filter((f) => f.kind === "output").map((f) => f.name);
  if (outs.length) lines.push("Files delivered: " + outs.join(", "));
  if ((job.previews || []).length) lines.push("3D previews shared: " + job.previews.length);
  const msgs = (job.thread || []).filter((m) => m.by !== "system").slice(-maxMsgs);
  if (msgs.length) {
    lines.push("", "Messages (oldest first):");
    for (const m of msgs) lines.push((m.by === "admin" ? "D.EIGHT" : "Customer") + ": " + String(m.text).slice(0, 1200));
  }
  return lines.join("\n");
}

// Chat translation with Workers AI (binding "AI"). Returns the translated text.
async function translateText(env, text, to) {
  if (!env.AI) throw Object.assign(new Error(to === "vi" ? "Chưa bật dịch tự động (Workers AI)." : "Translation is not switched on yet."), { status: 503, code: "no_ai" });
  const target = to === "vi" ? "Vietnamese" : "English";
  const system = "You translate chat messages between a dental lab or dental clinic and D.EIGHT, a remote dental CAD design team. " +
    "Translate the user's message into " + target + ". Keep dental and CAD terms accurate (for example crown, bridge, abutment, margin, " +
    "emergence profile, multi-unit abutment (MUA), screw channel, scan body, occlusion, surgical guide, sleeve). Keep tooth numbers, " +
    "measurements, units, file names, links and people's names exactly as written. Reply with the translation only, without notes or quotes. " +
    "If the message is already in " + target + ", return it unchanged.";
  try { return (await aiChat(env, [{ role: "system", content: system }, { role: "user", content: text }], { maxTokens: 2048, vi: to === "vi" })).slice(0, 8000); }
  catch (err) { if (err.code === "no_ai") throw err; }
  const out = await env.AI.run("@cf/meta/m2m100-1.2b", { text, source_lang: to === "vi" ? "en" : "vi", target_lang: to });
  const t = String((out && (out.translated_text || (out.result && out.result.translated_text))) || "").trim();
  if (!t) throw Object.assign(new Error(to === "vi" ? "Dịch không thành công, thử lại sau." : "Translation failed. Please try again."), { status: 502 });
  return t;
}

// Case files are stored in 20 MB parts: in the R2 bucket bound as FILES when there is one, otherwise in KV.
const partKey = (job, fid, n) => "jf:" + job + ":" + fid + ":" + n;
const activeStore = (env) => (env.FILES ? "r2" : "kv");
function partStore(env, kind) {
  if (kind === "r2" && env.FILES) {
    return {
      put: (k, data) => env.FILES.put(k, data),
      stream: async (k) => { const o = await env.FILES.get(k); return o ? o.body : null; },
      exists: async (k) => !!(await env.FILES.head(k)),
      del: (k) => env.FILES.delete(k),
    };
  }
  return {
    put: (k, data) => env.CASES.put(k, data, { expiration: Math.floor(Date.now() / 1000) + FILE_KEEP_DAYS * 86400, metadata: { s: data.byteLength } }),
    stream: (k) => env.CASES.get(k, { type: "stream" }),
    exists: async (k) => { const s = await env.CASES.get(k, { type: "stream" }); if (s && s.cancel) s.cancel(); return !!s; },
    del: (k) => env.CASES.delete(k),
  };
}

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
    sz: Math.round((job.files || []).reduce((t, f) => t + (f.stored || 0), 0) / 1048576),
    sv: String(job.service || "").slice(0, 40), on: String(job.ownerName || "").slice(0, 40), tr: job.trial ? 1 : 0,
    p: typeof job.price === "number" ? job.price : null, py: job.pay || "",
    d: String(job.designer || "").slice(0, 120), q: String(job.qcBy || "").slice(0, 120), g: job.stage || "", oc: normCode(job.order), oi: job.orderId || 0 };
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
    if (m) items.push({ id: ids[i], owner: m.o, title: m.t, status: m.s, created: m.c, updated: m.u, lastBy: m.lb, storedMB: m.sz || 0,
      service: m.sv || "", ownerName: m.on || "", trial: !!m.tr, pay: m.py || "", order: normCode(m.oc) });
  });
  items.sort((a, b) => b.updated - a.updated);
  return json({ items });
}

async function listJobs(env, owner, who) {
  let items = [];
  let cursor;
  do {
    const page = await env.CASES.list({ prefix: "job:", cursor });
    for (const k of page.keys) {
      const m = k.metadata || {};
      if (owner && m.o !== owner) continue;
      items.push({ id: k.name.slice(4), owner: m.o, title: m.t, status: m.s, created: m.c, updated: m.u, lastBy: m.lb, storedMB: m.sz || 0,
      service: m.sv || "", ownerName: m.on || "", trial: !!m.tr, price: m.p ?? null, pay: m.py || "",
      designer: m.d || "", qcBy: m.q || "", stage: m.g || "", order: normCode(m.oc), orderId: m.oi || 0 });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  if (who) {
    // each staff member sees the cases their permissions allow, without fields they may not see
    items = items.filter((j) => staffSees(who, j)).map((j) => {
      if (!who.can("cases.customer")) j.owner = "";
      if (!who.can("billing.view")) { j.price = null; j.pay = ""; }
      return j;
    });
  }
  items.sort((a, b) => b.updated - a.updated);
  return json({ items });
}

// The case as sent to the browser. Internal AI notes (job.ai), the price and payment
// attempts go only to D.EIGHT; the customer sees just the amount once it is due.
// who = the staff member looking (null for the customer who owns the case).
async function jobView(env, job, who = null) {
  const previews = [];
  for (const pid of job.previews || []) {
    const m = await env.CASES.get("meta:" + pid, "json");
    if (m && m.e > Date.now()) previews.push({ id: pid, label: m.l || "", expires: m.e, url: "/v/" + pid });
  }
  const { ai, payTries, price, due, team, designer, qcBy, stage, qc, ...rest } = job;
  if (rest.order) rest.order = normCode(rest.order);
  const num = (v) => (typeof v === "number" ? v : null);
  if (who) {
    const v = { ...rest, designer: designer || "", qcBy: qcBy || "", stage: stage || "", qc: qc || null, previews,
      team: who.can("cases.notes") ? team || [] : [] };
    if (who.can("billing.view")) Object.assign(v, { price: num(price), due: num(due), payTries: payTries || [] });
    else { delete v.pay; delete v.paid; }
    if (who.can("ai.use")) v.ai = ai || null;
    if (!who.can("cases.customer")) v.owner = "";
    if (!who.can("cases.chat_read")) v.thread = (v.thread || []).filter((m) => m.by === "system");
    return v;
  }
  // the customer: no internal files, notes, workflow, price or payment attempts
  rest.files = (rest.files || []).filter((f) => f.kind !== "design").map(({ by, ...f }) => f);
  delete rest.orderId;
  const amount = (job.pay === "paid" || job.pay === "check") && job.paid ? job.paid.amount : job.pay === "due" ? amountDue(job) || null : null;
  const payOpen = job.pay === "due" && (payTries || []).some((t) => t.state === "open" || t.state === "held");
  const held = payOpen && (payTries || []).some((t) => t.state === "held");
  if (rest.paid) rest.paid = { via: rest.paid.via, amount: rest.paid.amount, at: rest.paid.at, confirmed: !!rest.paid.confirmed };
  return { ...rest, amount, payOpen, payHeld: held, previews };
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
      rx: cleanRx(b.rx),
      status: "received", created: now, updated: now, lastBy: "client", approvedAt: 0,
      files: [], previews: [], thread: [], price: null, pay: "",
    };
    while (await env.CASES.get("job:" + job.id)) job.id = newJobId();
    const own = await ownerIds(env, who.email, true);
    if (own.length < TRIAL_CASES && (await loadSettings(env)).autoTrial) { job.trial = true; job.pay = "trial"; }
    await orderForNewJob(env, job);
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
  // The owner always acts as the customer; staff act as D.EIGHT on the cases their permissions show them.
  // Requests from the admin tools (password header) always act as D.EIGHT.
  const isOwner = !!(job && !who.viaKey && who.email && job.owner === who.email);
  if (!job || !(isOwner || staffSees(who, job))) return json({ error: "Case not found." }, 404);
  const sub = m[2] || "";
  const by = isOwner ? "client" : "admin";
  const viewer = isOwner ? null : who;
  const need = (p) => !isOwner && who.can(p);
  const nope = () => json({ error: "Bạn không có quyền làm việc này." }, 403);
  const actor = who.email || "D.EIGHT";
  const teamNote = (text, kind) => {
    job.team = [...(job.team || []), { by: actor, name: clip(who.name, 80) || actor, text: clip(text, 2000), at: Date.now(), kind: kind || "" }].slice(-300);
  };

  if (sub === "" && method === "GET") return json({ job: await jobView(env, job, viewer) });

  if (sub === "/messages" && method === "POST") {
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const text = clip(b.text, 4000);
    if (!text) return json({ error: "Empty message." }, 400);
    if (!isOwner && !who.can("cases.chat")) return nope();
    const msg = { by, name: by === "admin" ? "D.EIGHT" : clip(who.name, 100), text, at: Date.now() };
    const original = clip(b.original, 4000);
    if (original && original !== text && (b.originalLang === "vi" || b.originalLang === "en")) {
      msg.tr = { [b.originalLang]: original };
      msg.lang = b.originalLang === "vi" ? "en" : "vi"; // language of the sent text
    }
    job.thread.push(msg);
    if (job.thread.length > THREAD_MAX) job.thread = job.thread.slice(-THREAD_MAX);
    job.updated = Date.now(); job.lastBy = by;
    await saveJob(env, job);
    return json({ job: await jobView(env, job, viewer) });
  }

  // AI: Vietnamese work summary for the designer (kept on the case until regenerated)
  if (sub === "/summary" && method === "POST") {
    if (!need("ai.use")) return nope();
    const system = "Bạn là trưởng nhóm thiết kế CAD nha khoa của D.EIGHT. Đọc thông tin ca và tin nhắn (thường bằng tiếng Anh) rồi viết bản tóm tắt bằng tiếng Việt cho kỹ thuật viên. " +
      "Trình bày đúng 3 phần, mỗi ý một dòng bắt đầu bằng \"- \":\nTÓM TẮT: loại ca, răng, vật liệu, hạn giao.\nYÊU CẦU THIẾT KẾ: mọi yêu cầu cụ thể của bác sĩ (thông số, hệ implant, kênh vít, tiếp xúc, khớp cắn, thẩm mỹ), kể cả yêu cầu chỉnh sửa trong tin nhắn; ghi rõ yêu cầu mới nhất nếu có thay đổi.\n" +
      "CẦN HỎI LẠI: thông tin còn thiếu hoặc mâu thuẫn (ghi \"- Không có\" nếu đủ).\nGiữ nguyên số răng, số đo, tên hãng. Không bịa thông tin không có trong ca. Viết ngắn gọn.";
    let text;
    try { text = await aiChat(env, [{ role: "system", content: system }, { role: "user", content: caseContext(job) }], { maxTokens: 1200, vi: true }); }
    catch (err) { return json({ error: err.message, code: err.code || "" }, err.status || 502); }
    job.ai = { ...(job.ai || {}), sum: text.slice(0, 6000), sumAt: Date.now(), sumUpd: job.updated };
    await saveJob(env, job);
    return json({ summary: job.ai.sum, at: job.ai.sumAt });
  }

  // AI: draft a reply to the customer in English with a Vietnamese copy (nothing is sent)
  if (sub === "/suggest" && method === "POST") {
    if (!need("ai.use")) return nope();
    let b; try { b = await request.json(); } catch { b = {}; }
    const hint = clip(b.hint, 600);
    const system = "You write replies from D.EIGHT, a remote dental CAD design team, to a dental lab or clinic about one case. Read the case and the conversation, " +
      "then draft a short, warm and professional reply to the customer's latest message in English (2 to 5 sentences). Answer only from the case information; " +
      "never promise dates, prices or design results that are not stated, and never mention AI. If something must be checked, say we will confirm. " +
      (hint ? "The designer wants the reply to say: " + hint + ". " : "") +
      "Return ONLY JSON: {\"en\": \"the reply in English\", \"vi\": \"a faithful Vietnamese translation of the reply\"}.";
    let out;
    try { out = parseJsonLoose(await aiChat(env, [{ role: "system", content: system }, { role: "user", content: caseContext(job, 16) }], { maxTokens: 900, vi: true })); }
    catch (err) { return json({ error: err.message, code: err.code || "" }, err.status || 502); }
    if (!out || !out.en) return json({ error: "AI không soạn được câu trả lời, thử lại." }, 502);
    return json({ en: clip(out.en, 3000), vi: clip(out.vi, 3000) });
  }

  // translate one message for the person viewing it; the result is kept on the message for everyone
  if (sub === "/translate" && method === "POST") {
    if (!isOwner && !who.can("cases.chat_read")) return nope();
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const to = b.to === "vi" ? "vi" : "en";
    const msg = (job.thread || []).find((x) => x.at === b.at && x.by !== "system");
    if (!msg) return json({ error: "Message not found." }, 404);
    if (!(msg.tr && msg.tr[to])) {
      try { msg.tr = { ...(msg.tr || {}), [to]: await translateText(env, msg.text, to) }; }
      catch (err) { return json({ error: err.message, code: err.code || "" }, err.status || 502); }
      await saveJob(env, job);
    }
    return json({ at: msg.at, to, text: msg.tr[to] });
  }

  if (sub === "/billing" && method === "POST") {
    if (!need("billing.edit")) return nope();
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const price = b.price === null || b.price === "" || b.price === undefined ? null : Math.round(Number(b.price) * 100) / 100;
    if (price !== null && !(price >= 0 && price <= 100000)) return json({ error: "Giá không hợp lệ." }, 400);
    if (!PAY_STATES.includes(b.pay) || (b.pay === "check" && job.pay !== "check")) return json({ error: "Trạng thái thanh toán không hợp lệ." }, 400);
    const due = b.due === null || b.due === "" || b.due === undefined ? null : Math.round(Number(b.due) * 100) / 100;
    if (due !== null && !(due >= 0 && due <= 100000)) return json({ error: "Số tiền cần thu không hợp lệ." }, 400);
    job.price = price; job.due = due; job.trial = !!b.trial;
    if (b.pay === "paid" && job.pay !== "paid") {
      // D.EIGHT has the money: confirms a reported payment, or records one received another way
      await syncPayment(env, job);
      payConfirm(job, actor, amountDue(job));
    } else if (b.pay === "due" && job.pay === "check") payReject(job);
    else if (b.pay !== "paid" && b.pay !== "check") { job.pay = b.pay; delete job.paid; }
    job.updated = Date.now(); job.lastBy = "admin";
    await saveJob(env, job);
    return json({ job: await jobView(env, job, viewer) });
  }

  // customer starts a payment: returns the PayPal / Stripe page to send them to
  if (sub === "/pay" && method === "POST") {
    if (by !== "client") return json({ error: "Only the customer can pay for this case." }, 403);
    let b; try { b = await request.json(); } catch { b = {}; }
    const via = b.via === "paypal" || b.via === "stripe" ? b.via : "";
    if (!via || !payConf(env)[via] || !(await loadSettings(env)).onlinePay) return json({ error: "This payment method is not available." }, 400);
    if (await syncPayment(env, job)) await saveJob(env, job);   // an earlier attempt may already have gone through
    if (job.pay === "paid" || job.pay === "check") return json({ paid: job.pay === "paid", sent: job.pay === "check", job: await jobView(env, job) });
    const amount = amountDue(job);
    if (job.pay !== "due" || !amount) return json({ error: "There is nothing to pay on this case yet." }, 409);
    const recent = (job.payTries || []).filter((t) => Date.now() - t.at < 10 * 60 * 1000).length;
    if (recent >= PAY_TRIES_MAX) return json({ error: "Too many payment attempts. Please wait a few minutes and try again." }, 429);
    let out;
    try { out = await startPayment(env, job, via, url.origin, amount); }
    catch (err) { return json({ error: err.message }, err.status || 502); }
    job.payTries = [{ via, id: out.id, amount, at: Date.now(), state: "open" }, ...(job.payTries || []).filter((t) => t.state !== "dead")].slice(0, PAY_TRIES_MAX);
    await saveJob(env, job);
    return json({ url: out.url });
  }

  // after the provider's page, or when the case is opened: ask the provider what happened
  if (sub === "/pay/check" && method === "POST") {
    if (!isOwner && !who.can("billing.view")) return nope();
    if (await syncPayment(env, job)) await saveJob(env, job);
    return json({ paid: job.pay === "paid", sent: job.pay === "check", job: await jobView(env, job, viewer) });
  }

  // customer: "I paid another way" (bank transfer, Payoneer...) with a reference; D.EIGHT confirms it
  if (sub === "/pay/claim" && method === "POST") {
    if (!isOwner) return nope();
    let b; try { b = await request.json(); } catch { b = {}; }
    const note = clip(b.note, 300);
    if (job.pay !== "due" || !amountDue(job)) return json({ error: "There is nothing to pay on this case." }, 409);
    if (note.length < 3) return json({ error: "Please tell us how you paid (for example the transfer reference)." }, 400);
    paySent(job, null, "claim", "", amountDue(job), note);
    job.lastBy = "client";
    await saveJob(env, job);
    return json({ sent: true, job: await jobView(env, job) });
  }

  // D.EIGHT: the money arrived (or did not)
  if (sub === "/pay/confirm" && method === "POST") {
    if (!need("billing.edit")) return nope();
    let b; try { b = await request.json(); } catch { b = {}; }
    if (job.pay !== "check") return json({ error: "Ca này không có thanh toán chờ xác nhận." }, 409);
    if (b.ok) payConfirm(job, actor, amountDue(job)); else payReject(job);
    job.lastBy = "admin";
    await saveJob(env, job);
    return json({ job: await jobView(env, job, viewer) });
  }

  // assign a designer and a QC reviewer
  if (sub === "/assign" && method === "POST") {
    if (!need("cases.assign")) return nope();
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const pick = async (v) => {
      const email = String(v || "").trim().toLowerCase();
      if (!email) return "";
      return (await staffFor(env, email)) ? email : null;
    };
    const d = await pick(b.designer), q = await pick(b.qcBy);
    if (d === null || q === null) return json({ error: "Người được giao phải là nhân sự đang hoạt động." }, 400);
    if (d === (job.designer || "") && q === (job.qcBy || "")) return json({ job: await jobView(env, job, viewer) });
    const now = Date.now();
    job.designer = d; job.qcBy = q;
    if (d && !job.stage) job.stage = "design";
    if (d && job.status === "received") { job.status = "in_design"; job.thread.push({ by: "system", name: "", text: "status:in_design", at: now }); }
    teamNote("assign:" + (d || "-") + "|" + (q || "-"), "assign");
    job.updated = now;
    await saveJob(env, job);
    await syncJobOrder(env, job, { by: actor, name: who.name, text: "Phân công: KTV " + (d || "chưa giao") + " · QC " + (q || "chưa giao") });
    return json({ job: await jobView(env, job, viewer) });
  }

  // internal design workflow: designer sends to QC, QC passes or returns it
  if (sub === "/stage" && method === "POST") {
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const note = clip(b.note, 2000), mine = (e) => !!e && e === who.email;
    if (isOwner) return nope();
    if (b.action === "submit") {
      if (!who.can("cases.design") || !(mine(job.designer) || who.can("cases.all") || who.viaKey)) return nope();
      if (!(job.files || []).some((f) => f.kind === "design")) return json({ error: "Tải file thiết kế lên trước khi gửi QC." }, 409);
      job.stage = "qc"; job.qc = { state: "pending", at: Date.now(), by: "" };
      teamNote(note || "", "submit");
    } else if (b.action === "pass" || b.action === "fail") {
      if (!who.can("cases.qc") || !(mine(job.qcBy) || !job.qcBy || who.can("cases.all") || who.viaKey)) return nope();
      if (job.stage !== "qc") return json({ error: "Ca này không ở bước chờ QC." }, 409);
      if (b.action === "fail" && note.length < 3) return json({ error: "Ghi rõ lỗi cần sửa để KTV biết." }, 400);
      if (!job.qcBy && who.email) job.qcBy = who.email;
      job.stage = b.action === "pass" ? "ready" : "fix";
      job.qc = { state: b.action === "pass" ? "passed" : "failed", at: Date.now(), by: actor };
      teamNote(note, b.action === "pass" ? "qc_pass" : "qc_fail");
    } else if (b.action === "reopen") {
      if (!(who.can("cases.assign") || who.can("cases.qc"))) return nope();
      job.stage = job.designer ? "fix" : ""; job.qc = null;
      teamNote(note, "reopen");
    } else return json({ error: "Bad request." }, 400);
    job.updated = Date.now();
    await saveJob(env, job);
    await syncJobOrder(env, job, { by: actor, name: who.name, text: ({ submit: "Gửi QC", pass: "QC đạt", fail: "QC không đạt, trả KTV sửa", reopen: "Mở lại để sửa" })[b.action] + (note ? ": " + note : "") });
    return json({ job: await jobView(env, job, viewer) });
  }

  // internal team notes (never shown to the customer)
  if (sub === "/team" && method === "POST") {
    if (!need("cases.notes")) return nope();
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    if (!clip(b.text, 2000)) return json({ error: "Ghi chú trống." }, 400);
    teamNote(b.text, "note");
    job.updated = Date.now();
    await saveJob(env, job);
    await syncJobOrder(env, job, null);
    return json({ job: await jobView(env, job, viewer) });
  }

  // design files approved by QC become files the customer can download
  if (sub === "/promote" && method === "POST") {
    if (!need("cases.deliver")) return nope();
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const fids = new Set(Array.isArray(b.fids) ? b.fids : []);
    let moved = 0;
    for (const f of job.files || []) if (f.kind === "design" && fids.has(f.fid)) { f.kind = "output"; moved++; }
    if (!moved && !b.deliver) return json({ error: "Chọn ít nhất một file thiết kế." }, 400);
    const now = Date.now();
    if (b.deliver && job.status !== "delivered") { job.status = "delivered"; job.thread.push({ by: "system", name: "", text: "status:delivered", at: now }); }
    if (b.deliver) job.stage = "done";
    teamNote("deliver:" + moved, "deliver");
    job.updated = now; job.lastBy = "admin";
    await saveJob(env, job);
    await syncJobOrder(env, job, { by: actor, name: who.name, text: moved ? "Giao " + moved + " file thiết kế cho khách" : "Chuyển ca sang Đã giao" });
    return json({ job: await jobView(env, job, viewer) });
  }

  if (sub === "/approve" && method === "POST") {
    if (by !== "client") return json({ error: "Only the customer can approve." }, 403);
    if (job.status !== "review") return json({ error: "This design is not waiting for approval." }, 409);
    const now = Date.now();
    job.status = "approved"; job.approvedAt = now; job.updated = now; job.lastBy = "client";
    job.thread.push({ by: "system", name: "", text: "status:approved", at: now });
    await saveJob(env, job);
    await syncJobOrder(env, job, { by: "", name: "Khách hàng", text: "Khách đã duyệt thiết kế" });
    return json({ job: await jobView(env, job, viewer) });
  }

  if (sub === "/status" && method === "POST") {
    if (!need("cases.status")) return nope();
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    if (!JOB_STATUSES.includes(b.status)) return json({ error: "Trạng thái không hợp lệ." }, 400);
    if (b.status !== job.status) {
      const now = Date.now();
      job.status = b.status; job.updated = now; job.lastBy = "admin";
      if (b.status === "approved" && !job.approvedAt) job.approvedAt = now;
      job.thread.push({ by: "system", name: "", text: "status:" + b.status, at: now });
      await saveJob(env, job);
      await syncJobOrder(env, job, { by: actor, name: who.name, text: "Trạng thái ca: " + b.status });
    }
    return json({ job: await jobView(env, job, viewer) });
  }

  if (sub === "/previews" && method === "POST") {
    if (!need("cases.deliver")) return nope();
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
    if (!b.remove) await syncJobOrder(env, job, { by: actor, name: who.name, text: "Gửi bản xem 3D cho khách duyệt" });
    return json({ job: await jobView(env, job, viewer) });
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
    if (by === "admin" && !(who.can("cases.design") || who.can("cases.deliver"))) return nope();
    const used = (job.files || []).reduce((t, x) => t + (x.stored || 0), 0);
    if (used + len > JOB_FILES_MAX) return json({ error: "This case has reached its storage limit (300 MB)." }, 413);
    const data = await request.arrayBuffer();
    await partStore(env, activeStore(env)).put(partKey(job.id, f[1], n), data);
    return json({ ok: true });
  }

  // attach uploaded files: POST /api/jobs/<id>/files  {files:[{fid,name,size,stored,parts,gz}], deliver}
  if (sub === "/files" && method === "POST") {
    let b; try { b = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const list = Array.isArray(b.files) ? b.files.slice(0, 30) : [];
    // staff upload either internal design files (for QC) or final files for the customer
    const kind = by === "client" ? "input" : b.kind === "design" ? "design" : "output";
    if (kind === "design" && !who.can("cases.design")) return nope();
    if (by === "admin" && (kind === "output" || b.deliver) && !who.can("cases.deliver")) return nope();
    const now = Date.now();
    let added = 0;
    for (const x of list) {
      if (!FID_RE.test(x.fid || "") || (job.files || []).some((y) => y.fid === x.fid)) continue;
      const parts = Math.max(1, Math.min(FILE_MAX_PARTS, parseInt(x.parts, 10) || 1));
      const st = activeStore(env);
      if (!(await partStore(env, st).exists(partKey(job.id, x.fid, parts - 1)))) continue;
      job.files.push({ fid: x.fid, name: clip(x.name, 160) || "file", size: Math.max(0, +x.size || 0), stored: Math.max(0, +x.stored || 0),
        parts, gz: x.gz ? 1 : 0, st, kind, at: now, exp: now + FILE_KEEP_DAYS * DAY_MS, ...(by === "admin" ? { by: actor } : {}) });
      added++;
    }
    if (added || (by === "admin" && b.deliver)) {
      job.updated = now; job.lastBy = by;
      if (kind === "design" && added) teamNote("upload:" + added, "upload");
      if (by === "admin" && b.deliver && job.status !== "delivered") {
        job.stage = job.stage ? "done" : job.stage;
        job.status = "delivered";
        job.thread.push({ by: "system", name: "", text: "status:delivered", at: now });
      }
      await saveJob(env, job);
      if (by === "admin") await syncJobOrder(env, job, b.deliver ? { by: actor, name: who.name, text: "Giao file cho khách" } : null);
    }
    return json({ job: await jobView(env, job, viewer), added });
  }

  // download: GET /api/jobs/<id>/files/<fid>
  f = sub.match(/^\/files\/([A-Za-z0-9]{10})$/);
  if (f && method === "GET") {
    const file = (job.files || []).find((x) => x.fid === f[1]);
    if (!file || (isOwner && file.kind === "design")) return json({ error: "File not found." }, 404);
    if (!isOwner && file.kind === "input" && !who.can("cases.files")) return nope();
    const inline = !isOwner && url.searchParams.get("view") === "1" && /\.html?$/i.test(file.name);
    const store = partStore(env, file.st || "kv");
    const first = await store.stream(partKey(job.id, file.fid, 0));
    if (!first) return json({ error: "This file has expired." }, 410);
    const { readable, writable } = new TransformStream();
    (async () => {
      try {
        await first.pipeTo(writable, { preventClose: true });
        for (let i = 1; i < file.parts; i++) {
          const s = await store.stream(partKey(job.id, file.fid, i));
          if (!s) throw new Error("missing part " + i);
          await s.pipeTo(writable, { preventClose: true });
        }
        await writable.close();
      } catch (e) { try { await writable.abort(e); } catch {} }
    })();
    const headers = new Headers(inline ? {
      // exocad scene opened for review: isolated (opaque) origin, like the doctor links
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store",
      "Content-Security-Policy": "sandbox allow-scripts allow-downloads allow-popups allow-modals; frame-ancestors 'self'",
      ...LINK_HEADERS,
    } : {
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
    if (by === "admin" && !(who.can("cases.delete") || (file.kind === "design" && file.by === actor && who.can("cases.design")))) return nope();
    const store = partStore(env, file.st || "kv");
    await Promise.all(Array.from({ length: file.parts }, (_, i) => store.del(partKey(job.id, file.fid, i))));
    job.files = job.files.filter((x) => x.fid !== file.fid);
    job.updated = Date.now();
    await saveJob(env, job);
    return json({ job: await jobView(env, job, viewer) });
  }

  return json({ error: "Not found." }, 404);
}

/* ============================================== Order book (Cloudflare D1 database, binding "DB") */
// The backbone of the workspace: customers (clinics, labs, doctors), product codes, price lists per customer,
// KTV pay rates, orders with their items, redo (R) / next-stage (C) orders, payments and the team chat per order.
// Order code: yymmddxx (date received, Vietnam time; xx = 01, 02… per day, e.g. 26102101). Stage 1 is the plain code;
// the next stage adds C2, then C3…; a redo adds R1, R2…; a redo then its next stage: 26102101R1C2; a redone stage: 26102101C2R1.
// The tables are created automatically the first time the database is used.
// Free plan limits kept in mind: 50 queries per request (bulk work uses json_each), 100 bound values per query.

const DB_VERSION = 2;
const VN_MS = 7 * 3600 * 1000;
const vnDay = (ms) => new Date(ms + VN_MS).toISOString().slice(0, 10);
const dayStart = (day) => Date.parse(day + "T00:00:00Z") - VN_MS;      // 00:00 in Vietnam, as ms
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d) => DAY_RE.test(d || "") && !isNaN(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
const CODE_RE = /^(\d{2})(\d{2})(\d{2})(\d{2,3})((?:[RC]\d{1,3})*)$/;
// typed codes may still carry the old separators (26/10/21/01, 26-10-21-01): drop them
const normCode = (v) => String(v == null ? "" : v).toUpperCase().replace(/[\s/._-]+/g, "").slice(0, 30);
const PCODE_RE = /^[A-Z0-9][A-Z0-9._-]{0,23}$/;   // product code
const CCODE_RE = /^[A-Z0-9][A-Z0-9._-]{0,15}$/;   // customer code
const ORDER_STATUS = ["new", "design", "qc", "fix", "ready", "review", "revise", "approved", "delivered", "hold", "cancelled"];
const OPEN_STATUS = ORDER_STATUS.filter((s) => s !== "delivered" && s !== "cancelled");
const ORDER_KINDS = ["new", "redo", "continue"];
const CHARGES = ["charge", "free", "warranty"];
const CURRENCIES = ["USD", "VND"];
const CUST_KINDS = ["clinic", "lab", "doctor", "platform", "other"];
const PAY_METHODS = ["paypal", "payoneer", "remitly", "bank", "cash", "deposit", "other"];
const UNIT_KINDS = ["unit", "arch", "case", "hour"];
const ITEMS_MAX = 40;
const IMG_MAX = 1600 * 1024;

const ucode = (v) => clip(v, 24).toUpperCase().replace(/\s+/g, "");
const numv = (v) => { const n = typeof v === "number" ? v : Number(String(v == null ? "" : v).replace(/[\s,]/g, "")); return Number.isFinite(n) ? n : NaN; };
const rnd = (v, cur) => (cur === "VND" ? Math.round(v) : Math.round(v * 100) / 100);
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
const bookErr = (msg, status = 400) => Object.assign(new Error(msg), { status });
const codeOf = (day, seq) => day.slice(2, 4) + day.slice(5, 7) + day.slice(8, 10) + String(seq).padStart(2, "0");
// stage = the last C number (1 when there is none); kind = what the last letter says
function parseCode(raw) {
  const code = normCode(raw);
  const m = CODE_RE.exec(code);
  if (!m) return null;
  const day = "20" + m[1] + "-" + m[2] + "-" + m[3];
  if (!validDay(day)) return null;
  const suf = m[5] || "";
  const cs = [...suf.matchAll(/C(\d+)/g)];
  if (cs.some((x) => +x[1] < 2) || /R0|C0/.test(suf)) return null;
  return { code, day, seq: +m[4], base: code, root: code.slice(0, code.length - suf.length), suf,
    kind: !suf ? "new" : /R\d+$/.test(suf) ? "redo" : "continue", stage: cs.length ? +cs[cs.length - 1][1] : 1,
    parent: suf ? code.replace(/[RC]\d+$/, "") : "" };
}

const SCHEMA_V1 = [
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'clinic', country TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'USD', contact TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', terms TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, auto INTEGER NOT NULL DEFAULT 0, search TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS customer_logins (email TEXT PRIMARY KEY, customer_id INTEGER NOT NULL, at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS products (code TEXT PRIMARY KEY, name TEXT NOT NULL, name_en TEXT NOT NULL DEFAULT '', grp TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'unit', active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS prices (customer_id INTEGER NOT NULL, product TEXT NOT NULL, currency TEXT NOT NULL, price REAL NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (customer_id, product, currency))`,
  `CREATE TABLE IF NOT EXISTS tech_rates (email TEXT NOT NULL, product TEXT NOT NULL, rate REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'VND',
    updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (email, product))`,
  `CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, base TEXT NOT NULL, cday TEXT NOT NULL,
    seq INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'new', parent_id INTEGER, customer_id INTEGER NOT NULL,
    clinic TEXT NOT NULL DEFAULT '', doctor TEXT NOT NULL DEFAULT '', patient TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '',
    service TEXT NOT NULL DEFAULT '', teeth TEXT NOT NULL DEFAULT '', material TEXT NOT NULL DEFAULT '', shade TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new', designer TEXT NOT NULL DEFAULT '', qc TEXT NOT NULL DEFAULT '',
    received_at INTEGER NOT NULL, day TEXT NOT NULL, due_at INTEGER NOT NULL DEFAULT 0, delivered_at INTEGER NOT NULL DEFAULT 0, dday TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'USD', units REAL NOT NULL DEFAULT 0, subtotal REAL NOT NULL DEFAULT 0, adj_pct REAL NOT NULL DEFAULT 0,
    adj_amount REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0, charge TEXT NOT NULL DEFAULT 'charge', paid REAL NOT NULL DEFAULT 0,
    tech_cost REAL NOT NULL DEFAULT 0, tech_currency TEXT NOT NULL DEFAULT '', qc_fails INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual', job_id TEXT NOT NULL DEFAULT '', login TEXT NOT NULL DEFAULT '', previews TEXT NOT NULL DEFAULT '[]',
    last_msg_at INTEGER NOT NULL DEFAULT 0, last_msg_by TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, search TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '', teeth TEXT NOT NULL DEFAULT '', qty REAL NOT NULL DEFAULT 1, price REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, order_id INTEGER, day TEXT NOT NULL,
    paid_at INTEGER NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'other', ref TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS order_msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, at INTEGER NOT NULL, by TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'msg', text TEXT NOT NULL DEFAULT '', img TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS order_reads (email TEXT NOT NULL, order_id INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (email, order_id))`,
  `CREATE INDEX IF NOT EXISTS o_day ON orders (day)`,
  `CREATE INDEX IF NOT EXISTS o_dday ON orders (dday)`,
  `CREATE INDEX IF NOT EXISTS o_cust ON orders (customer_id, received_at)`,
  `CREATE INDEX IF NOT EXISTS o_designer ON orders (designer, status)`,
  `CREATE INDEX IF NOT EXISTS o_qc ON orders (qc, status)`,
  `CREATE INDEX IF NOT EXISTS o_status ON orders (status)`,
  `CREATE INDEX IF NOT EXISTS o_cday ON orders (cday, seq)`,
  `CREATE INDEX IF NOT EXISTS o_job ON orders (job_id)`,
  `CREATE INDEX IF NOT EXISTS o_parent ON orders (parent_id)`,
  `CREATE INDEX IF NOT EXISTS o_login ON orders (login)`,
  `CREATE INDEX IF NOT EXISTS i_order ON order_items (order_id)`,
  `CREATE INDEX IF NOT EXISTS pay_cust ON payments (customer_id)`,
  `CREATE INDEX IF NOT EXISTS pay_day ON payments (day)`,
  `CREATE INDEX IF NOT EXISTS msg_order ON order_msgs (order_id, id)`,
];

// v2: codes without "/", patient key + indexes for the "this order is already in the book" check, files in the team chat
const SCHEMA_V2 = [
  `ALTER TABLE orders ADD COLUMN pkey TEXT NOT NULL DEFAULT ''`,
  `CREATE INDEX IF NOT EXISTS o_pkey ON orders (pkey)`,
  `CREATE INDEX IF NOT EXISTS o_ref ON orders (customer_id, ref)`,
  `CREATE INDEX IF NOT EXISTS o_base ON orders (base)`,
  `CREATE TABLE IF NOT EXISTS order_files (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, msg_id INTEGER NOT NULL DEFAULT 0,
    fid TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, stored INTEGER NOT NULL DEFAULT 0, parts INTEGER NOT NULL DEFAULT 1,
    gz INTEGER NOT NULL DEFAULT 0, st TEXT NOT NULL DEFAULT 'kv', by TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS f_order ON order_files (order_id, fid)`,
];
async function migrateV2(DB) {
  for (const sql of SCHEMA_V2) {
    try { await DB.prepare(sql).run(); }
    catch (err) { if (!/duplicate column|already exists/i.test(String(err && err.message))) throw err; }
  }
  // old codes 26/10/21/01 → 26102101; base = the code of stage 1 (yymmddxx); patient key for the duplicate check
  const list = await rows(DB.prepare("SELECT id, code, patient, ref, doctor, clinic FROM orders WHERE code LIKE '%/%' OR pkey = '' AND patient != ''"));
  if (list.length) try {
    const fix = list.map((o) => { const code = normCode(o.code), pc = parseCode(code); return { id: o.id, code, base: pc ? pc.root : code, pkey: fold(o.patient), search: searchText({ ...o, code }) }; });
    for (let i = 0; i < fix.length; i += 500) {
      await DB.prepare(`UPDATE orders SET code = json_extract(j.value, '$.code'), base = json_extract(j.value, '$.base'), pkey = json_extract(j.value, '$.pkey'),
        search = json_extract(j.value, '$.search') FROM json_each(?) j WHERE orders.id = json_extract(j.value, '$.id')`).bind(JSON.stringify(fix.slice(i, i + 500))).run();
    }
  } catch (err) { console.error("order code migration", err && err.message); }
}
let DB_SCHEMA_OK = 0;
const noDb = () => bookErr("Chưa kết nối cơ sở dữ liệu. Trong Cloudflare: Pages › d8-3d › Settings › Bindings, thêm D1 database tên biến DB, rồi Retry deployment.", 503);
async function bookDb(env) {
  if (!env.DB) throw Object.assign(noDb(), { code: "no_db" });
  if (DB_SCHEMA_OK !== DB_VERSION) {
    let v = 0;
    try { const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'schema'").first(); v = r ? +r.v : 0; } catch { v = 0; }
    if (v < 1) await env.DB.batch(SCHEMA_V1.map((s) => env.DB.prepare(s)));
    if (v < 2) await migrateV2(env.DB);
    if (v < DB_VERSION) await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('schema', ?)").bind(String(DB_VERSION)).run();
    DB_SCHEMA_OK = DB_VERSION;
  }
  return env.DB;
}
const rows = async (stmt) => (await stmt.all()).results || [];

// INSERT … SELECT from a JSON array: many rows in one query (the free plan allows 50 queries per request).
function jsonInsert(DB, table, cols, list, tail = "") {
  const sel = cols.map((c) => `json_extract(value, '$.${c}')`).join(", ");
  return DB.prepare(`INSERT INTO ${table} (${cols.join(", ")}) SELECT ${sel} FROM json_each(?) ${tail}`).bind(JSON.stringify(list));
}

/* ---- settings (KV, work without the database) */
const SETTINGS_DEFAULT = { onlinePay: false, autoTrial: false };
async function loadSettings(env) {
  const c = cacheGet("@settings");
  if (c) return c.v;
  const s = { ...SETTINGS_DEFAULT, ...((await env.CASES.get("cfg:settings", "json")) || {}) };
  staffCache.set("@settings", { at: Date.now(), v: s });
  return s;
}

/* ---- who may see what */
const canMoney = (who) => who.viaKey || who.can("billing.view");
function orderScope(who) {
  if (who.viaKey || who.can("orders.view")) return { sql: "1 = 1", args: [] };
  const parts = ["o.designer = ?", "o.qc = ?"], args = [who.email, who.email];
  if (who.can("cases.qc")) parts.push("(o.status = 'qc' AND o.qc = '')");
  return { sql: "(" + parts.join(" OR ") + ")", args };
}
function seesOrder(who, o) {
  if (who.viaKey || who.can("orders.view")) return true;
  if (!who.email) return false;
  return o.designer === who.email || o.qc === who.email || (who.can("cases.qc") && o.status === "qc" && !o.qc);
}
function orderOut(o, who) {
  const out = {
    id: o.id, code: o.code, base: o.base, kind: o.kind, parent_id: o.parent_id || null, customer_id: o.customer_id, stage: (parseCode(o.code) || {}).stage || 1,
    customer_code: o.customer_code || "", customer_name: o.customer_name || "", clinic: o.clinic, doctor: o.doctor, patient: o.patient, ref: o.ref,
    service: o.service, teeth: o.teeth, material: o.material, shade: o.shade, notes: o.notes, status: o.status, designer: o.designer, qc: o.qc,
    received_at: o.received_at, day: o.day, due_at: o.due_at || 0, delivered_at: o.delivered_at || 0, dday: o.dday || "", units: o.units,
    source: o.source, job_id: o.job_id, qc_fails: o.qc_fails, created_by: o.created_by, created_at: o.created_at, updated_at: o.updated_at,
    last_msg_at: o.last_msg_at || 0, last_msg_by: o.last_msg_by || "", items_text: o.items_text || "",
  };
  if ("unread" in o) out.unread = !!o.unread;
  try { out.previews = JSON.parse(o.previews || "[]"); } catch { out.previews = []; }
  if (canMoney(who)) Object.assign(out, { currency: o.currency, subtotal: o.subtotal, adj_pct: o.adj_pct, adj_amount: o.adj_amount, total: o.total,
    charge: o.charge, paid: o.paid, due: rnd(Math.max(0, o.total - o.paid), o.currency) });
  else out.charge = o.charge === "charge" ? "" : o.charge; // free / warranty is not a secret
  if (who.viaKey || who.can("techpay.manage") || (who.can("techpay.own") && o.designer && o.designer === who.email)) Object.assign(out, { tech_cost: o.tech_cost, tech_currency: o.tech_currency });
  return out;
}
const itemOut = (x, money) => ({ id: x.id, product: x.product, name: x.name, teeth: x.teeth, qty: x.qty, note: x.note, ...(money ? { price: x.price, amount: x.amount } : {}) });
const ORDER_SELECT = `SELECT o.*, c.code AS customer_code, c.name AS customer_name,
  (SELECT group_concat(CASE WHEN i.qty = 1 THEN i.product WHEN i.qty = CAST(i.qty AS INTEGER) THEN (CAST(i.qty AS INTEGER) || '× ' || i.product) ELSE (i.qty || '× ' || i.product) END, ', ') FROM order_items i WHERE i.order_id = o.id) AS items_text
  FROM orders o JOIN customers c ON c.id = o.customer_id`;

/* ---- prices, KTV rates, totals */
async function priceBook(DB, customerId) {
  const list = await rows(DB.prepare("SELECT customer_id, product, currency, price FROM prices WHERE customer_id IN (0, ?)").bind(customerId || 0));
  return (product, cur) => {
    const own = list.find((p) => p.customer_id === customerId && p.product === product && p.currency === cur);
    const def = list.find((p) => p.customer_id === 0 && p.product === product && p.currency === cur);
    return own ? own.price : def ? def.price : null;
  };
}
// KTV pay for orders (one query): qty x the designer's rate, or the rate for every KTV ("*").
const TECH_COST_SQL = `UPDATE orders SET
  tech_cost = COALESCE((SELECT SUM(i.qty * COALESCE((SELECT t.rate FROM tech_rates t WHERE t.email = orders.designer AND t.product = i.product),
    (SELECT t.rate FROM tech_rates t WHERE t.email = '*' AND t.product = i.product), 0)) FROM order_items i WHERE i.order_id = orders.id), 0),
  tech_currency = COALESCE((SELECT t.currency FROM tech_rates t WHERE t.email IN (orders.designer, '*') ORDER BY t.email = '*' LIMIT 1), '')
  WHERE `;
function totalsOf(items, adjPct, adjAmt, charge, cur) {
  const subtotal = rnd(items.reduce((t, x) => t + x.amount, 0), cur);
  const units = Math.round(items.reduce((t, x) => t + x.qty, 0) * 100) / 100;
  let total = rnd(subtotal * (1 + adjPct / 100) + adjAmt, cur);
  if (charge !== "charge" || total < 0) total = 0;
  return { subtotal, units, total };
}

// Payments are matched to orders: a payment made for one order goes to it first; the rest (deposits,
// lump sums) pays the oldest unpaid orders of that customer in the same currency. Whatever is left is credit.
async function reallocate(DB, customerIds) {
  const ids = [...new Set(customerIds.filter((x) => x))];
  if (!ids.length) return {};
  const j = JSON.stringify(ids);
  const [o, p] = await DB.batch([
    DB.prepare("SELECT id, customer_id, total, paid, currency, status FROM orders WHERE customer_id IN (SELECT value FROM json_each(?)) ORDER BY received_at, id").bind(j),
    DB.prepare("SELECT customer_id, order_id, amount, currency FROM payments WHERE customer_id IN (SELECT value FROM json_each(?))").bind(j),
  ]);
  const credit = {}, changes = [];
  for (const cid of ids) {
    const orders = (o.results || []).filter((x) => x.customer_id === cid);
    const live = new Map(orders.filter((x) => x.status !== "cancelled").map((x) => [x.id, x]));
    const pool = {}, direct = {}, paid = new Map();
    for (const x of (p.results || []).filter((y) => y.customer_id === cid)) {
      const ord = x.order_id && live.get(x.order_id);
      if (ord && ord.currency === x.currency) direct[x.order_id] = (direct[x.order_id] || 0) + x.amount;
      else pool[x.currency] = (pool[x.currency] || 0) + x.amount;
    }
    for (const x of live.values()) {
      const d = direct[x.id] || 0, take = Math.max(0, Math.min(Math.max(0, x.total), d));
      paid.set(x.id, take);
      if (d !== take) pool[x.currency] = (pool[x.currency] || 0) + (d - take);
    }
    for (const x of live.values()) {
      const need = Math.max(0, x.total) - paid.get(x.id), avail = pool[x.currency] || 0;
      if (need > 0 && avail > 0) { const take = Math.min(need, avail); paid.set(x.id, paid.get(x.id) + take); pool[x.currency] = avail - take; }
    }
    for (const x of orders) {
      const v = x.status === "cancelled" ? 0 : rnd(paid.get(x.id) || 0, x.currency);
      if (Math.abs(v - x.paid) > 0.0001) changes.push({ id: x.id, p: v });
    }
    credit[cid] = Object.fromEntries(Object.entries(pool).map(([k, v]) => [k, rnd(v, k)]).filter(([, v]) => Math.abs(v) > 0.004));
  }
  if (changes.length) {
    await DB.prepare(`UPDATE orders SET paid = (SELECT json_extract(j.value, '$.p') FROM json_each(?1) j WHERE json_extract(j.value, '$.id') = orders.id)
      WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`).bind(JSON.stringify(changes)).run();
  }
  return credit;
}

/* ---- order codes */
async function nextSeq(DB, day) {
  const r = await DB.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM orders WHERE cday = ? AND kind = 'new'").bind(day).first();
  return (r ? r.n : 0) + 1;
}
// Redo: 26102101 → R1, a redo of that (or of the original again) → R2; a stage: 26102101C2 → C2R1.
// Next stage: 26102101 → C2, then C3 (stage 1 is the plain code); after a redo: 26102101R1 → R1C2; R1C2 → R1C3.
async function childCode(DB, parent, kind) {
  const code = normCode(parent.code);
  if (kind === "redo") {
    const base = code.replace(/R\d+$/, "");
    const list = await rows(DB.prepare("SELECT code FROM orders WHERE code LIKE ?").bind(base + "R%"));
    let n = 0;
    for (const x of list) { const m = /^R(\d+)$/.exec(x.code.slice(base.length)); if (m) n = Math.max(n, +m[1]); }
    return base + "R" + (n + 1);
  }
  const pc = parseCode(code), stage = (pc ? pc.stage : 1) + 1;
  const next = /C\d+$/.test(code) ? code.replace(/C\d+$/, "C" + stage) : code + "C" + stage;
  const have = await DB.prepare("SELECT id FROM orders WHERE code = ?").bind(next).first();
  if (have) throw Object.assign(bookErr("Đã có đơn giai đoạn " + stage + ": " + next + ".", 409), { code: "exists", id: have.id });
  return next;
}
const searchText = (o) => fold([o.code, o.ref, o.patient, o.doctor, o.clinic].join(" "));
// "Is this order already in the book?": same customer and the customer's own case number, or the same patient
// (any customer when none is chosen) received within the last 45 days. Index o_ref / o_pkey keep this cheap.
async function findDupes(DB, who, q) {
  const pk = fold(q.patient), ref = clip(q.ref, 80), cid = +q.customer_id || 0, since = (q.now || Date.now()) - 45 * DAY_MS;
  const w = [], a = [];
  if (cid && ref) { w.push("(o.customer_id = ? AND o.ref = ?)"); a.push(cid, ref); }
  if (pk.length >= 3) { w.push("(o.pkey = ? AND o.received_at >= ?" + (cid ? " AND o.customer_id = ?" : "") + ")"); a.push(pk, since, ...(cid ? [cid] : [])); }
  if (!w.length) return [];
  const list = await rows(DB.prepare(`SELECT o.id, o.code, o.kind, o.patient, o.ref, o.clinic, o.doctor, o.day, o.status, o.designer, o.qc, o.created_by, o.created_at,
      o.source, o.job_id, o.customer_id, c.code AS customer_code, c.name AS customer_name,
      (SELECT group_concat(CASE WHEN qty = CAST(qty AS INTEGER) THEN CAST(qty AS INTEGER) ELSE qty END || '× ' || product, ', ') FROM order_items WHERE order_id = o.id) AS items_text
    FROM orders o JOIN customers c ON c.id = o.customer_id WHERE (${w.join(" OR ")}) AND o.status != 'cancelled' AND o.id != ? ORDER BY o.received_at DESC LIMIT 6`).bind(...a, +q.exclude || 0));
  return list.map((o) => ({ ...o, match: cid && ref && o.customer_id === cid && o.ref === ref ? "ref" : "patient", canOpen: seesOrder(who, o) }));
}
const custSearch = (c) => fold([c.code, c.name, c.contact, c.email, c.country].join(" "));

/* ---- customers for portal sign-ins */
function codeFromName(name) {
  const words = fold(name).toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(" ").filter(Boolean);
  let c = words.length > 1 ? words.slice(0, 4).map((w) => w[0]).join("") : (words[0] || "KH").slice(0, 6);
  return c.length < 2 ? (c + "KH").slice(0, 3) : c;
}
async function freeCustomerCode(DB, want) {
  const base = (ucode(want).replace(/[^A-Z0-9]/g, "") || "KH").slice(0, 12);
  const taken = new Set((await rows(DB.prepare("SELECT code FROM customers WHERE code LIKE ?").bind(base + "%"))).map((x) => x.code));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 999; i++) if (!taken.has(base + i)) return base + i;
  return base + Date.now().toString(36).toUpperCase();
}
async function customerForLogin(env, DB, email) {
  const r = await DB.prepare("SELECT customer_id FROM customer_logins WHERE email = ?").bind(email).first();
  if (r) return r.customer_id;
  const u = (await env.CASES.get("user:" + email, "json")) || {};
  const name = clip(u.practice || u.name || email.split("@")[0], 120);
  const code = await freeCustomerCode(DB, codeFromName(name));
  const now = Date.now();
  const c = { code, name, country: clip(u.country, 60), email, phone: clip(u.phone, 40), contact: clip(u.name, 100) };
  const ins = await DB.prepare(`INSERT INTO customers (code, name, kind, country, currency, contact, email, phone, auto, search, created_at, updated_at)
    VALUES (?, ?, 'clinic', ?, 'USD', ?, ?, ?, 1, ?, ?, ?) RETURNING id`).bind(c.code, c.name, c.country, c.contact, c.email, c.phone, custSearch(c), now, now).first();
  await DB.prepare("INSERT OR REPLACE INTO customer_logins (email, customer_id, at) VALUES (?, ?, ?)").bind(email, ins.id, now).run();
  return ins.id;
}

/* ---- portal cases become orders, and their workflow is copied into the order */
function jobOrderStatus(job) {
  if (job.status === "cancelled") return "cancelled";
  if (job.status === "delivered" || job.stage === "done") return "delivered";
  if (job.status === "approved") return "approved";
  if (job.status === "review") return "review";
  if (job.status === "needs_info") return "hold";
  return { qc: "qc", fix: "fix", ready: "ready", design: "design" }[job.stage] || (job.designer ? "design" : "new");
}
// New portal case: create its order (before the case is first saved, so the case carries the order code).
async function orderForNewJob(env, job) {
  if (!env.DB) return;
  try {
    const DB = await bookDb(env);
    const cid = await customerForLogin(env, DB, job.owner);
    const cust = await DB.prepare("SELECT currency FROM customers WHERE id = ?").bind(cid).first();
    const day = vnDay(job.created);
    for (let tries = 0; tries < 4; tries++) {
      const seq = (await nextSeq(DB, day)) + tries;
      const code = codeOf(day, seq);
      const o = { code, base: code, cday: day, seq, kind: "new", customer_id: cid, ref: job.title, service: job.service, teeth: job.teeth,
        material: job.material, shade: job.shade, notes: job.notes, status: "new", received_at: job.created, day, currency: (cust && cust.currency) || "USD",
        charge: job.trial ? "free" : "charge", source: "portal", job_id: job.id, login: job.owner, created_by: job.owner, created_at: job.created, updated_at: job.created };
      o.search = searchText({ ...o, patient: "", doctor: "", clinic: "" });
      try {
        const r = await jsonInsert(DB, "orders", Object.keys(o), [o], "RETURNING id").first();
        job.orderId = r.id; job.order = code;
        return;
      } catch (err) { if (!/UNIQUE/i.test(String(err && err.message))) throw err; }
    }
  } catch (err) { console.error("order for job", err && err.message); }
}
// After a portal case changes: copy status / assignment into the order; ev = a line for the team chat.
async function syncJobOrder(env, job, ev) {
  if (!env.DB || !job.orderId) return;
  try {
    const DB = await bookDb(env);
    const now = Date.now(), st = jobOrderStatus(job);
    const fails = (job.team || []).filter((n) => n.kind === "qc_fail").length;
    const del = st === "delivered" ? job.updated || now : 0;
    const q = [DB.prepare(`UPDATE orders SET status = ?, designer = ?, qc = ?, qc_fails = ?, delivered_at = CASE WHEN ? > 0 AND delivered_at = 0 THEN ? WHEN ? = 0 THEN 0 ELSE delivered_at END,
        dday = CASE WHEN ? > 0 AND dday = '' THEN ? WHEN ? = 0 THEN '' ELSE dday END, updated_at = ? WHERE id = ?`)
      .bind(st, job.designer || "", job.qcBy || "", fails, del, del, del, del, del ? vnDay(del) : "", del, now, job.orderId)];
    if (ev && ev.text) {
      q.push(DB.prepare("INSERT INTO order_msgs (order_id, at, by, name, kind, text) VALUES (?, ?, ?, ?, 'sys', ?)").bind(job.orderId, now, ev.by || "", clip(ev.name, 80), clip(ev.text, 2000)));
      q.push(DB.prepare("UPDATE orders SET last_msg_at = ?, last_msg_by = ? WHERE id = ?").bind(now, ev.by || "", job.orderId));
    }
    await DB.batch(q);
  } catch (err) { console.error("order sync", err && err.message); }
}

/* ---- the API */
async function handleBook(request, env, url, who) {
  const path = url.pathname, method = request.method, P = url.searchParams;
  const deny = () => json({ error: "Bạn không có quyền dùng mục này." }, 403);
  const body = async () => { try { return await request.json(); } catch { throw bookErr("Bad request."); } };
  const actor = who.email || "D.EIGHT", actorName = clip(who.name, 80) || "D.EIGHT";

  // settings work without the database
  if (path === "/api/settings") {
    if (method === "GET") return json({ settings: await loadSettings(env), db: !!env.DB });
    if (method === "POST") {
      if (!who.can("staff.manage")) return deny();
      const b = await body(), cur = await loadSettings(env);
      const next = { ...cur };
      for (const k of Object.keys(SETTINGS_DEFAULT)) if (typeof b[k] === "boolean") next[k] = b[k];
      await env.CASES.put("cfg:settings", JSON.stringify(next));
      staffCache.delete("@settings");
      return json({ settings: next });
    }
  }
  if (path === "/api/book/status") {
    if (!env.DB) return json({ db: false });
    const DB = await bookDb(env);
    const [a, b, c] = await DB.batch([DB.prepare("SELECT COUNT(*) AS n FROM orders"), DB.prepare("SELECT COUNT(*) AS n FROM customers"), DB.prepare("SELECT COUNT(*) AS n FROM products")]);
    return json({ db: true, orders: a.results[0].n, customers: b.results[0].n, products: c.results[0].n });
  }

  const DB = await bookDb(env);
  const now = Date.now();
  let m;

  /* ---------------- products (the shared product codes) */
  if (path === "/api/products" && method === "GET") {
    const list = await rows(DB.prepare("SELECT * FROM products ORDER BY sort, code"));
    if (who.can("pricing.manage") || canMoney(who)) {
      const def = await rows(DB.prepare("SELECT product, currency, price FROM prices WHERE customer_id = 0"));
      for (const p of list) p.prices = Object.fromEntries(def.filter((d) => d.product === p.code).map((d) => [d.currency, d.price]));
    }
    return json({ products: list });
  }
  if (path === "/api/products" && method === "POST") {
    if (!who.can("pricing.manage")) return deny();
    const b = await body();
    const out = upsertProducts(DB, b.items, now);
    if (out.error) return json({ error: out.error }, 400);
    await DB.batch(out.stmts);
    return json({ ok: true, saved: out.count, products: await rows(DB.prepare("SELECT * FROM products ORDER BY sort, code")) });
  }
  if (path === "/api/products/sample" && method === "POST") {
    if (!who.can("pricing.manage")) return deny();
    const have = await DB.prepare("SELECT COUNT(*) AS n FROM products").first();
    if (have.n) return json({ error: "Danh mục đã có mã hàng." }, 409);
    const out = upsertProducts(DB, SAMPLE_PRODUCTS.map(([code, grp, unit, name, name_en], i) => ({ code, grp, unit, name, name_en, sort: (i + 1) * 10 })), now);
    await DB.batch(out.stmts);
    return json({ ok: true, products: await rows(DB.prepare("SELECT * FROM products ORDER BY sort, code")) });
  }
  if (path === "/api/products/rename" && method === "POST") {
    if (!who.can("pricing.manage")) return deny();
    const b = await body(), from = ucode(b.from), to = ucode(b.to);
    if (!PCODE_RE.test(to)) return json({ error: "Mã hàng mới không hợp lệ (chữ in hoa, số, dấu - . _, tối đa 24 ký tự)." }, 400);
    if (!(await DB.prepare("SELECT 1 AS x FROM products WHERE code = ?").bind(from).first())) return json({ error: "Không tìm thấy mã hàng." }, 404);
    if (from !== to && (await DB.prepare("SELECT 1 AS x FROM products WHERE code = ?").bind(to).first())) return json({ error: "Mã " + to + " đã có." }, 409);
    await DB.batch(["products SET code = ? WHERE code = ?", "prices SET product = ? WHERE product = ?", "tech_rates SET product = ? WHERE product = ?",
      "order_items SET product = ? WHERE product = ?"].map((s) => DB.prepare("UPDATE " + s).bind(to, from)));
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/products\/([^/]+)$/)) && method === "DELETE") {
    if (!who.can("pricing.manage")) return deny();
    const code = ucode(decodeURIComponent(m[1]));
    const used = await DB.prepare("SELECT 1 AS x FROM order_items WHERE product = ? LIMIT 1").bind(code).first();
    if (used) { await DB.prepare("UPDATE products SET active = 0, updated_at = ? WHERE code = ?").bind(now, code).run(); return json({ ok: true, archived: true }); }
    await DB.batch([DB.prepare("DELETE FROM products WHERE code = ?").bind(code), DB.prepare("DELETE FROM prices WHERE product = ?").bind(code),
      DB.prepare("DELETE FROM tech_rates WHERE product = ?").bind(code)]);
    return json({ ok: true });
  }

  /* ---------------- price lists (customer 0 = default list) */
  if (path === "/api/prices" && method === "GET") {
    if (!(who.can("pricing.manage") || canMoney(who))) return deny();
    if (P.get("all") === "1") {
      if (!who.can("pricing.manage")) return deny();
      return json({ prices: await rows(DB.prepare("SELECT customer_id, product, currency, price FROM prices")) });
    }
    const cid = Math.max(0, parseInt(P.get("customer") || "0", 10) || 0);
    const list = await rows(DB.prepare("SELECT customer_id, product, currency, price FROM prices WHERE customer_id IN (0, ?)").bind(cid));
    return json({ customer: cid, own: list.filter((x) => x.customer_id === cid && cid), defaults: list.filter((x) => x.customer_id === 0) });
  }
  if (path === "/api/prices" && method === "POST") {
    if (!who.can("pricing.manage")) return deny();
    const b = await body();
    const out = await priceRows(DB, b.rows || (b.items || []).map((x) => ({ customer_id: b.customer, currency: b.currency, ...x })));
    if (out.errors.length) return json({ error: out.errors[0].msg, errors: out.errors }, 400);
    await DB.batch(priceStmts(DB, out.rows, now));
    return json({ ok: true, saved: out.rows.length });
  }

  /* ---------------- KTV pay rates (admin only) */
  if (path === "/api/techrates") {
    if (!who.can("techpay.manage")) return deny();
    if (method === "GET") return json({ rates: await rows(DB.prepare("SELECT email, product, rate, currency FROM tech_rates")) });
    if (method === "POST") {
      const b = await body();
      const email = b.email === "*" ? "*" : String(b.email || "").trim().toLowerCase();
      if (email !== "*" && !EMAIL_RE.test(email)) return json({ error: "Chọn KTV." }, 400);
      const cur = CURRENCIES.includes(b.currency) ? b.currency : "VND";
      const set = [], del = [];
      for (const x of (Array.isArray(b.items) ? b.items : []).slice(0, 400)) {
        const product = ucode(x.product);
        if (!PCODE_RE.test(product)) continue;
        const r = numv(x.rate);
        if (x.rate === null || x.rate === "" || x.rate === undefined) del.push(product); else if (r >= 0) set.push({ email, product, rate: r, currency: cur, updated_at: now });
      }
      const from = validDay(b.from) ? b.from : vnDay(now).slice(0, 8) + "01";
      const q = [];
      if (del.length) q.push(DB.prepare("DELETE FROM tech_rates WHERE email = ? AND product IN (SELECT value FROM json_each(?))").bind(email, JSON.stringify(del)));
      if (set.length) q.push(jsonInsert(DB, "tech_rates", ["email", "product", "rate", "currency", "updated_at"], set, "WHERE 1 ON CONFLICT (email, product) DO UPDATE SET rate = excluded.rate, currency = excluded.currency, updated_at = excluded.updated_at"));
      q.push(DB.prepare(TECH_COST_SQL + (email === "*" ? "day >= ?" : "designer = ? AND day >= ?")).bind(...(email === "*" ? [from] : [email, from])));
      await DB.batch(q);
      return json({ ok: true, from });
    }
  }

  /* ---------------- customers */
  if (path === "/api/customers" && method === "GET") {
    if (!(who.can("customers.view") || who.can("orders.edit") || who.can("orders.view"))) return deny();
    const list = await rows(DB.prepare(`SELECT c.*, COUNT(o.id) AS orders, COALESCE(SUM(o.total), 0) AS billed, COALESCE(SUM(o.paid), 0) AS paid_in,
      MAX(o.received_at) AS last_order FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.status != 'cancelled' GROUP BY c.id ORDER BY c.code`));
    const logins = who.can("customers.view") ? await rows(DB.prepare("SELECT email, customer_id FROM customer_logins")) : [];
    return json({ customers: list.map((c) => custOut(c, who, logins)) });
  }
  if (path === "/api/customers" && method === "POST") {
    if (!who.can("customers.edit")) return deny();
    const b = await body();
    const r = await saveCustomers(DB, [b], now);
    if (r.errors.length) return json({ error: r.errors[0].msg }, 400);
    const c = await DB.prepare("SELECT * FROM customers WHERE code = ?").bind(r.codes[0]).first();
    return json({ customer: custOut(c, who, []) });
  }
  if ((m = path.match(/^\/api\/customers\/(\d+)(\/logins)?$/))) {
    const id = +m[1];
    const c = await DB.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first();
    if (!c) return json({ error: "Không tìm thấy khách hàng." }, 404);
    if (m[2] && method === "POST") {
      if (!who.can("customers.edit")) return deny();
      const b = await body(), email = String(b.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return json({ error: "Email không hợp lệ." }, 400);
      if (b.remove) { await DB.prepare("DELETE FROM customer_logins WHERE email = ? AND customer_id = ?").bind(email, id).run(); return json({ ok: true }); }
      const prev = await DB.prepare("SELECT customer_id FROM customer_logins WHERE email = ?").bind(email).first();
      await DB.batch([DB.prepare("INSERT OR REPLACE INTO customer_logins (email, customer_id, at) VALUES (?, ?, ?)").bind(email, id, now),
        DB.prepare("UPDATE orders SET customer_id = ?, updated_at = ? WHERE login = ?").bind(id, now, email)]);
      await reallocate(DB, [id, prev && prev.customer_id]);
      return json({ ok: true, moved_from: prev ? prev.customer_id : null });
    }
    if (method === "GET") {
      if (!who.can("customers.view")) return deny();
      const [st, lg, pays] = await DB.batch([
        DB.prepare(`SELECT currency, COUNT(*) AS n, SUM(units) AS units, SUM(total) AS billed, SUM(paid) AS paid_in FROM orders WHERE customer_id = ? AND status != 'cancelled' GROUP BY currency`).bind(id),
        DB.prepare("SELECT email, at FROM customer_logins WHERE customer_id = ?").bind(id),
        DB.prepare("SELECT currency, SUM(amount) AS a FROM payments WHERE customer_id = ? GROUP BY currency").bind(id),
      ]);
      const stats = (st.results || []).map((s) => {
        const inn = ((pays.results || []).find((p) => p.currency === s.currency) || {}).a || 0;
        return { currency: s.currency, orders: s.n, units: s.units, ...(canMoney(who) ? { billed: s.billed, paid: s.paid_in, due: rnd(s.billed - s.paid_in, s.currency), credit: rnd(Math.max(0, inn - s.paid_in), s.currency) } : {}) };
      });
      for (const p of pays.results || []) if (canMoney(who) && !stats.some((s) => s.currency === p.currency)) stats.push({ currency: p.currency, orders: 0, units: 0, billed: 0, paid: 0, due: 0, credit: rnd(p.a, p.currency) });
      return json({ customer: custOut(c, who, []), logins: lg.results || [], stats });
    }
    if (method === "DELETE") {
      if (!who.can("customers.edit")) return deny();
      const used = await DB.prepare("SELECT (SELECT COUNT(*) FROM orders WHERE customer_id = ?1) + (SELECT COUNT(*) FROM payments WHERE customer_id = ?1) AS n").bind(id).first();
      if (used.n) return json({ error: "Khách đã có đơn hàng hoặc thanh toán, không xóa được. Bỏ chọn \"Đang hợp tác\" để ẩn khách." }, 409);
      await DB.batch([DB.prepare("DELETE FROM customers WHERE id = ?").bind(id), DB.prepare("DELETE FROM customer_logins WHERE customer_id = ?").bind(id),
        DB.prepare("DELETE FROM prices WHERE customer_id = ?").bind(id)]);
      return json({ ok: true });
    }
  }

  /* ---------------- payments */
  if (path === "/api/payments" && method === "GET") {
    if (!canMoney(who)) return deny();
    const w = [], a = [];
    if (P.get("customer")) { w.push("p.customer_id = ?"); a.push(+P.get("customer") || 0); }
    if (validDay(P.get("from"))) { w.push("p.day >= ?"); a.push(P.get("from")); }
    if (validDay(P.get("to"))) { w.push("p.day <= ?"); a.push(P.get("to")); }
    if (P.get("order")) { w.push("p.order_id = ?"); a.push(+P.get("order") || 0); }
    const list = await rows(DB.prepare(`SELECT p.*, c.code AS customer_code, c.name AS customer_name, o.code AS order_code FROM payments p
      JOIN customers c ON c.id = p.customer_id LEFT JOIN orders o ON o.id = p.order_id ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY p.day DESC, p.id DESC LIMIT 2000`).bind(...a));
    return json({ payments: list });
  }
  if (path === "/api/payments" && method === "POST") {
    if (!who.can("billing.edit")) return deny();
    const b = await body();
    const r = await savePayments(DB, [b], actor, now);
    if (r.errors.length) return json({ error: r.errors[0].msg }, 400);
    const credit = await reallocate(DB, r.customers);
    return json({ ok: true, credit });
  }
  if ((m = path.match(/^\/api\/payments\/(\d+)$/)) && method === "DELETE") {
    if (!who.can("billing.edit")) return deny();
    const p = await DB.prepare("SELECT customer_id FROM payments WHERE id = ?").bind(+m[1]).first();
    if (!p) return json({ error: "Không tìm thấy khoản thanh toán." }, 404);
    await DB.prepare("DELETE FROM payments WHERE id = ?").bind(+m[1]).run();
    await reallocate(DB, [p.customer_id]);
    return json({ ok: true });
  }

  /* ---------------- orders */
  if (path === "/api/orders/next-code" && method === "GET") {
    const day = validDay(P.get("day")) ? P.get("day") : vnDay(now);
    return json({ code: codeOf(day, await nextSeq(DB, day)), day });
  }
  if (path === "/api/orders/dash" && method === "GET") return orderDash(DB, who, now);
  // while an order is typed in: is it already in the book? (only what is needed to recognise it, never money)
  if (path === "/api/orders/dupes" && method === "GET") {
    if (!who.can("orders.edit")) return deny();
    return json({ dupes: await findDupes(DB, who, { customer_id: P.get("customer"), patient: P.get("patient"), ref: P.get("ref"), exclude: P.get("exclude"), now }) });
  }
  if (path === "/api/orders/unread" && method === "GET") {
    const sc = orderScope(who);
    if (!who.can("cases.notes")) return json({ count: 0 });
    const r = await DB.prepare(`SELECT COUNT(*) AS n FROM orders o LEFT JOIN order_reads r ON r.order_id = o.id AND r.email = ?
      WHERE ${sc.sql} AND o.last_msg_at > COALESCE(r.at, 0) AND o.last_msg_by != ? AND o.last_msg_at > ?`).bind(who.email, ...sc.args, who.email, now - 60 * DAY_MS).first();
    return json({ count: r ? r.n : 0 });
  }
  if (path === "/api/orders" && method === "GET") return listOrders(DB, who, P, now);
  if (path === "/api/orders" && method === "POST") {
    if (!who.can("orders.edit")) return deny();
    const b = await body();
    const o = await createOrder(env, DB, b, who, now);
    return json({ order: o }, 201);
  }
  // files in the team chat: PUT parts /files/<fid>/<n>, then POST /files {files, text}; GET /files/<fid> downloads
  if ((m = path.match(/^\/api\/orders\/(\d+)\/files(?:\/([A-Za-z0-9]{10})(?:\/(\d{1,2}))?)?$/))) {
    const id = +m[1];
    const o = await DB.prepare("SELECT id, designer, qc, status FROM orders WHERE id = ?").bind(id).first();
    if (!o || !seesOrder(who, o)) return json({ error: "Không tìm thấy đơn hàng." }, 404);
    if (!who.can("cases.notes")) return deny();
    const pkey = (fid, n) => "ofp:" + id + ":" + fid + ":" + n;
    if (m[2] && m[3] && method === "PUT") {
      const n = +m[3], len = parseInt(request.headers.get("Content-Length") || "0", 10);
      if (n >= FILE_MAX_PARTS) return json({ error: "File quá lớn (tối đa 300 MB)." }, 413);
      if (!len) return json({ error: "File trống." }, 400);
      if (len > CHUNK_MAX + 1024) return json({ error: "Phần file quá lớn." }, 413);
      const used = await DB.prepare("SELECT COALESCE(SUM(stored), 0) AS n FROM order_files WHERE order_id = ?").bind(id).first();
      if (used.n + len > JOB_FILES_MAX) return json({ error: "Đơn này đã dùng hết 300 MB cho file trong chat." }, 413);
      await partStore(env, activeStore(env)).put(pkey(m[2], n), await request.arrayBuffer());
      return json({ ok: true });
    }
    if (!m[2] && method === "POST") {
      const b = await body();
      const st = activeStore(env), store = partStore(env, st);
      const files = [];
      for (const x of (Array.isArray(b.files) ? b.files : []).slice(0, 10)) {
        if (!FID_RE.test(x.fid || "") || files.some((y) => y.fid === x.fid)) continue;
        const parts = Math.max(1, Math.min(FILE_MAX_PARTS, parseInt(x.parts, 10) || 1));
        if (!(await store.exists(pkey(x.fid, parts - 1)))) continue;
        files.push({ order_id: id, fid: x.fid, name: clip(x.name, 160) || "file", size: Math.max(0, Math.round(+x.size || 0)), stored: Math.max(0, Math.round(+x.stored || 0)),
          parts, gz: x.gz ? 1 : 0, st, by: actor, at: now });
      }
      if (!files.length) return json({ error: "Không nhận được file. Thử gửi lại." }, 400);
      const text = clip(b.text, 4000);
      const msg = await DB.prepare("INSERT INTO order_msgs (order_id, at, by, name, kind, text) VALUES (?, ?, ?, ?, 'msg', ?) RETURNING id").bind(id, now, actor, actorName, text).first();
      await DB.batch([jsonInsert(DB, "order_files", ["order_id", "msg_id", "fid", "name", "size", "stored", "parts", "gz", "st", "by", "at"], files.map((f) => ({ ...f, msg_id: msg.id }))),
        DB.prepare("UPDATE orders SET last_msg_at = ?, last_msg_by = ? WHERE id = ?").bind(now, actor, id),
        DB.prepare("INSERT OR REPLACE INTO order_reads (email, order_id, at) VALUES (?, ?, ?)").bind(actor, id, now)]);
      return json({ ok: true, files: files.length });
    }
    if (m[2] && !m[3] && method === "GET") {
      const f = await DB.prepare("SELECT * FROM order_files WHERE order_id = ? AND fid = ?").bind(id, m[2]).first();
      if (!f) return json({ error: "Không tìm thấy file." }, 404);
      const store = partStore(env, f.st || "kv");
      const first = await store.stream(pkey(f.fid, 0));
      if (!first) return json({ error: "File đã hết hạn lưu." }, 410);
      const { readable, writable } = new TransformStream();
      (async () => {
        try {
          await first.pipeTo(writable, { preventClose: true });
          for (let i = 1; i < f.parts; i++) { const s2 = await store.stream(pkey(f.fid, i)); if (!s2) throw new Error("missing part " + i); await s2.pipeTo(writable, { preventClose: true }); }
          await writable.close();
        } catch (e) { try { await writable.abort(e); } catch {} }
      })();
      const headers = new Headers({ "Content-Type": "application/octet-stream", "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(f.name),
        "Cache-Control": "private, no-store", ...PRIVATE_HEADERS });
      if (f.gz) headers.set("Content-Encoding", "gzip");
      return new Response(readable, { headers, encodeBody: f.gz ? "manual" : "automatic" });
    }
    return json({ error: "Method not allowed." }, 405);
  }
  if ((m = path.match(/^\/api\/orders\/(\d+)(\/[a-z]+)?(\/\d+)?(\/img)?$/))) {
    const id = +m[1], sub = m[2] || "";
    const o = await DB.prepare(ORDER_SELECT + " WHERE o.id = ?").bind(id).first();
    if (!o || !seesOrder(who, o)) return json({ error: "Không tìm thấy đơn hàng." }, 404);

    if (sub === "" && method === "GET") {
      const root = o.code.replace(/[RC].*$/, "");
      const [it, rel, rd] = await DB.batch([
        DB.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY sort, id").bind(id),
        DB.prepare("SELECT id, code, kind, status, day, parent_id FROM orders WHERE code = ? OR code LIKE ? ORDER BY cday, seq, code").bind(root, root + "%"),
        DB.prepare("SELECT at FROM order_reads WHERE email = ? AND order_id = ?").bind(who.email, id),
      ]);
      const related = (rel.results || []).filter((x) => x.code === root || /^[RC]/.test(x.code.slice(root.length)));
      const out = { order: orderOut(o, who), items: (it.results || []).map((x) => itemOut(x, canMoney(who))), related, readAt: (rd.results[0] || {}).at || 0 };
      if (who.can("customers.view")) out.customer = await DB.prepare("SELECT id, code, name, kind, country, currency, contact, email, phone FROM customers WHERE id = ?").bind(o.customer_id).first();
      if (canMoney(who)) out.payments = await rows(DB.prepare("SELECT id, day, amount, currency, method, ref, note FROM payments WHERE order_id = ? ORDER BY day").bind(id));
      return json(out);
    }
    if (sub === "" && method === "POST") {
      if (!who.can("orders.edit") && !who.can("billing.edit") && !who.can("cases.assign") && !who.can("cases.status")) return deny();
      const b = await body();
      const out = await updateOrder(env, DB, o, b, who, now);
      return json({ order: out });
    }
    if (sub === "" && method === "DELETE") {
      if (!who.can("orders.delete")) return deny();
      if (o.job_id) return json({ error: "Đơn này khách gửi qua cổng khách hàng. Hãy hủy ca thay vì xóa." }, 409);
      const kids = await DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE parent_id = ?").bind(id).first();
      if (kids.n) return json({ error: "Đơn đã có đơn làm lại / làm tiếp. Xóa các đơn đó trước." }, 409);
      await DB.batch([DB.prepare("DELETE FROM order_items WHERE order_id = ?").bind(id), DB.prepare("DELETE FROM order_msgs WHERE order_id = ?").bind(id),
        DB.prepare("DELETE FROM order_files WHERE order_id = ?").bind(id),
        DB.prepare("DELETE FROM order_reads WHERE order_id = ?").bind(id), DB.prepare("UPDATE payments SET order_id = NULL WHERE order_id = ?").bind(id),
        DB.prepare("DELETE FROM orders WHERE id = ?").bind(id)]);
      await reallocate(DB, [o.customer_id]);
      return json({ ok: true });
    }
    if (sub === "/act" && method === "POST") return orderAction(env, DB, o, await body(), who, now);
    if (sub === "/next" && method === "GET") {
      if (!who.can("orders.edit")) return deny();
      const kind = P.get("kind") === "continue" ? "continue" : "redo";
      return json({ code: await childCode(DB, o, kind), kind, stage: ((parseCode(o.code) || {}).stage || 1) + (kind === "continue" ? 1 : 0) });
    }
    if (sub === "/previews" && method === "POST") {
      if (!(who.can("links.manage") || who.can("cases.deliver"))) return deny();
      const b = await body();
      if (!ID_RE.test(b.linkId || "")) return json({ error: "Mã link không hợp lệ." }, 400);
      let list = []; try { list = JSON.parse(o.previews || "[]"); } catch {}
      list = list.filter((x) => x !== b.linkId);
      if (!b.remove) list.push(b.linkId);
      const q = [DB.prepare("UPDATE orders SET previews = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(list.slice(-20)), now, id)];
      if (!b.remove && !o.job_id && ["new", "design", "ready", "revise"].includes(o.status)) q.push(DB.prepare("UPDATE orders SET status = 'review' WHERE id = ?").bind(id));
      if (!b.remove) q.push(...chatSys(DB, id, actor, actorName, "Gửi bản xem 3D cho bác sĩ", now));
      await DB.batch(q);
      return json({ order: orderOut(await DB.prepare(ORDER_SELECT + " WHERE o.id = ?").bind(id).first(), who) });
    }
    // team chat for this order (KTV, QC, admin; never the customer)
    if (sub === "/chat") {
      if (!who.can("cases.notes")) return deny();
      if (m[3] && m[4] && method === "GET") {
        const msg = await DB.prepare("SELECT img FROM order_msgs WHERE id = ? AND order_id = ?").bind(+m[3].slice(1), id).first();
        if (!msg || !msg.img) return json({ error: "Không tìm thấy ảnh." }, 404);
        const store = partStore(env, msg.img.startsWith("r2:") ? "r2" : "kv");
        const s = await store.stream(msg.img.replace(/^(r2|kv):/, ""));
        if (!s) return json({ error: "Ảnh đã hết hạn." }, 410);
        return new Response(s, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400", ...PRIVATE_HEADERS } });
      }
      if (method === "GET") {
        const after = parseInt(P.get("after") || "0", 10) || 0;
        const [ml, fl] = await DB.batch([DB.prepare(`SELECT id, at, by, name, kind, text, img != '' AS img FROM order_msgs WHERE order_id = ? AND id > ? ORDER BY id DESC LIMIT 300`).bind(id, after),
          DB.prepare("SELECT msg_id, fid, name, size FROM order_files WHERE order_id = ? AND msg_id > ? ORDER BY id").bind(id, after)]);
        const list = ml.results || [], byMsg = new Map();
        for (const f of fl.results || []) { if (!byMsg.has(f.msg_id)) byMsg.set(f.msg_id, []); byMsg.get(f.msg_id).push({ fid: f.fid, name: f.name, size: f.size }); }
        for (const x of list) if (byMsg.has(x.id)) x.files = byMsg.get(x.id);
        if (P.get("read") !== "0" && who.email) await DB.prepare("INSERT OR REPLACE INTO order_reads (email, order_id, at) VALUES (?, ?, ?)").bind(who.email, id, now).run();
        return json({ msgs: list.reverse() });
      }
      if (method === "POST") {
        const b = await body();
        const text = clip(b.text, 4000);
        let img = "";
        if (typeof b.img === "string" && b.img) {
          const mm = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(b.img);
          if (!mm) return json({ error: "Ảnh phải là JPEG." }, 400);
          const bin = Uint8Array.from(atob(mm[1]), (ch) => ch.charCodeAt(0));
          if (bin.length > IMG_MAX) return json({ error: "Ảnh quá lớn." }, 413);
          const key = "oimg:" + id + ":" + now.toString(36) + newId().slice(0, 4);
          if (env.FILES) { await env.FILES.put(key, bin); img = "r2:" + key; }
          else { await env.CASES.put(key, bin, { expiration: Math.floor(now / 1000) + 400 * 86400 }); img = "kv:" + key; }
        }
        if (!text && !img) return json({ error: "Tin nhắn trống." }, 400);
        await DB.batch([DB.prepare("INSERT INTO order_msgs (order_id, at, by, name, kind, text, img) VALUES (?, ?, ?, ?, 'msg', ?, ?)").bind(id, now, actor, actorName, text, img),
          DB.prepare("UPDATE orders SET last_msg_at = ?, last_msg_by = ? WHERE id = ?").bind(now, actor, id),
          DB.prepare("INSERT OR REPLACE INTO order_reads (email, order_id, at) VALUES (?, ?, ?)").bind(actor, id, now)]);
        return json({ ok: true });
      }
    }
  }

  /* ---------------- reports, export, import */
  if (path === "/api/reports" && method === "GET") {
    if (!who.can("reports.view")) return deny();
    return reportData(DB, who, P, now);
  }
  if (path === "/api/export" && method === "GET") {
    if (!who.can("export.csv")) return deny();
    return exportData(DB, who, P, now);
  }
  if ((m = path.match(/^\/api\/import\/(products|customers|prices|orders|payments)$/)) && method === "POST") {
    const b = await body();
    const list = Array.isArray(b.rows) ? b.rows.slice(0, 200) : [];
    const kind = m[1];
    if (kind === "products") {
      if (!who.can("pricing.manage")) return deny();
      const out = upsertProducts(DB, list, now, true);
      if (out.errors.length && !b.partial) return json({ errors: out.errors, done: 0 }, 400);
      if (out.stmts.length) await DB.batch(out.stmts);
      return json({ done: out.count, errors: out.errors });
    }
    if (kind === "customers") {
      if (!who.can("customers.edit")) return deny();
      const r = await saveCustomers(DB, list, now, b.partial);
      return json({ done: r.codes.length, errors: r.errors }, r.errors.length && !b.partial ? 400 : 200);
    }
    if (kind === "prices") {
      if (!who.can("pricing.manage")) return deny();
      const out = await priceRows(DB, list);
      if (out.errors.length && !b.partial) return json({ errors: out.errors, done: 0 }, 400);
      if (out.rows.length) await DB.batch(priceStmts(DB, out.rows, now));
      return json({ done: out.rows.length, errors: out.errors });
    }
    if (kind === "payments") {
      if (!who.can("billing.edit")) return deny();
      const r = await savePayments(DB, list, actor, now, b.partial);
      if (r.errors.length && !b.partial) return json({ errors: r.errors, done: 0 }, 400);
      await reallocate(DB, r.customers);
      return json({ done: r.count, errors: r.errors });
    }
    if (!who.can("orders.edit")) return deny();
    return importOrders(env, DB, list.slice(0, 100), who, now, !!b.partial, !!b.dry);
  }
  return json({ error: "Không tìm thấy." }, 404);
}

/* ---- products */
const SAMPLE_PRODUCTS = [
  ["CR", "Crown & bridge", "unit", "Mão răng (giải phẫu)", "Crown (full anatomy)"],
  ["CP", "Crown & bridge", "unit", "Sườn / mão cắt lớp", "Coping / cutback"],
  ["PT", "Crown & bridge", "unit", "Nhịp cầu", "Bridge pontic"],
  ["VN", "Crown & bridge", "unit", "Veneer", "Veneer"],
  ["IO", "Crown & bridge", "unit", "Inlay / onlay", "Inlay / onlay"],
  ["PC", "Crown & bridge", "unit", "Chốt cùi", "Post and core"],
  ["IMC", "Implant restorations", "unit", "Mão trên implant (bắt vít / Ti-base)", "Implant crown (screw-retained / Ti-base)"],
  ["IMA", "Implant restorations", "unit", "Abutment cá nhân", "Custom abutment"],
  ["IMAC", "Implant restorations", "unit", "Abutment cá nhân + mão", "Custom abutment + crown"],
  ["AOX", "All-on-X & bars", "arch", "Cầu hybrid All-on-X", "All-on-X hybrid bridge"],
  ["BAR", "All-on-X & bars", "arch", "Thanh bar", "Bar"],
  ["PMMA", "All-on-X & bars", "arch", "Hàm tạm PMMA", "Provisional (PMMA)"],
  ["SG", "Surgical guides", "arch", "Máng hướng dẫn phẫu thuật", "Surgical guide"],
  ["WX", "Wax-up & smile design", "unit", "Wax-up kỹ thuật số", "Digital wax-up"],
  ["SD", "Wax-up & smile design", "case", "Thiết kế nụ cười", "Smile design"],
  ["GUM", "Wax-up & smile design", "unit", "Mảnh nướu hồng rời", "Separate pink gingiva"],
  ["DEN", "Dentures & partials", "arch", "Hàm tháo lắp toàn hàm", "Full denture"],
  ["RPD", "Dentures & partials", "arch", "Hàm khung / bán phần", "Partial denture / framework"],
  ["NG", "Splints & trays", "arch", "Máng nhai / chống nghiến", "Night guard / splint"],
  ["MD", "Digital models", "arch", "Mẫu hàm in 3D", "3D printed model"],
];
function upsertProducts(DB, input, now, importing) {
  const list = Array.isArray(input) ? input.slice(0, 400) : [];
  const errors = [], set = [], prices = [], drop = [];
  list.forEach((x, i) => {
    const code = ucode(x.code);
    if (!PCODE_RE.test(code)) return errors.push({ row: i, msg: "Dòng " + (i + 1) + ": mã hàng \"" + clip(x.code, 30) + "\" không hợp lệ (chữ in hoa, số, dấu - . _)." });
    const name = clip(x.name, 120);
    if (!name) return errors.push({ row: i, msg: "Dòng " + (i + 1) + " (" + code + "): thiếu tên hàng." });
    const unit = UNIT_KINDS.includes(x.unit) ? x.unit : "unit";
    set.push({ code, name, name_en: clip(x.name_en, 120), grp: clip(x.grp, 60), unit, active: x.active === false || x.active === 0 ? 0 : 1,
      sort: Number.isFinite(+x.sort) ? Math.round(+x.sort) : (i + 1) * 10, note: clip(x.note, 300), updated_at: now });
    for (const cur of CURRENCIES) {
      const k = "price_" + cur.toLowerCase();
      if (!(k in x)) continue;
      if (x[k] === null || x[k] === "") { if (!importing) drop.push({ product: code, currency: cur }); continue; }
      const v = numv(x[k]);
      if (!(v >= 0)) return errors.push({ row: i, msg: "Dòng " + (i + 1) + " (" + code + "): giá " + cur + " không hợp lệ." });
      prices.push({ customer_id: 0, product: code, currency: cur, price: v, updated_at: now });
    }
  });
  if (errors.length && !importing) return { error: errors[0].msg, errors, stmts: [], count: 0 };
  const stmts = [];
  if (set.length) stmts.push(jsonInsert(DB, "products", ["code", "name", "name_en", "grp", "unit", "active", "sort", "note", "updated_at"], set,
    "WHERE 1 ON CONFLICT (code) DO UPDATE SET name = excluded.name, name_en = excluded.name_en, grp = excluded.grp, unit = excluded.unit, active = excluded.active, sort = excluded.sort, note = excluded.note, updated_at = excluded.updated_at"));
  if (prices.length) stmts.push(...priceStmts(DB, prices, now));
  if (drop.length) stmts.push(DB.prepare(`DELETE FROM prices WHERE customer_id = 0 AND (product || '|' || currency) IN (SELECT json_extract(value, '$.product') || '|' || json_extract(value, '$.currency') FROM json_each(?))`).bind(JSON.stringify(drop)));
  return { stmts, count: set.length, errors };
}
// rows: [{customer_id | customer (code), product, price (null = remove), currency}]
async function priceRows(DB, input) {
  const list = Array.isArray(input) ? input.slice(0, 2000) : [];
  const [cs, ps] = await DB.batch([DB.prepare("SELECT id, code, currency FROM customers"), DB.prepare("SELECT code FROM products")]);
  const byCode = new Map((cs.results || []).map((c) => [c.code, c])), byId = new Map((cs.results || []).map((c) => [c.id, c]));
  const prods = new Set((ps.results || []).map((p) => p.code));
  const errors = [], out = [];
  list.forEach((x, i) => {
    const where = "Dòng " + (x.row || i + 1);
    let cust = null;
    if (x.customer !== undefined && x.customer !== "" && x.customer !== null && String(x.customer).toUpperCase() !== "MAC-DINH" && String(x.customer) !== "0") {
      cust = byCode.get(ucode(x.customer));
      if (!cust) return errors.push({ row: i, msg: where + ": không có khách mã \"" + clip(x.customer, 20) + "\"." });
    } else if (x.customer_id) {
      cust = byId.get(+x.customer_id);
      if (!cust) return errors.push({ row: i, msg: where + ": không tìm thấy khách." });
    }
    const product = ucode(x.product);
    if (!prods.has(product)) return errors.push({ row: i, msg: where + ": mã hàng \"" + clip(x.product, 30) + "\" chưa có trong danh mục." });
    const currency = CURRENCIES.includes(String(x.currency || "").toUpperCase()) ? String(x.currency).toUpperCase() : cust ? cust.currency : "USD";
    if (x.price === null || x.price === "" || x.price === undefined) { out.push({ customer_id: cust ? cust.id : 0, product, currency, price: null }); return; }
    const v = numv(x.price);
    if (!(v >= 0)) return errors.push({ row: i, msg: where + ": giá không hợp lệ." });
    out.push({ customer_id: cust ? cust.id : 0, product, currency, price: v });
  });
  return { rows: out, errors };
}
function priceStmts(DB, list, now) {
  const set = list.filter((x) => x.price !== null).map((x) => ({ ...x, updated_at: now })), del = list.filter((x) => x.price === null);
  const q = [];
  if (set.length) q.push(jsonInsert(DB, "prices", ["customer_id", "product", "currency", "price", "updated_at"], set,
    "WHERE 1 ON CONFLICT (customer_id, product, currency) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at"));
  if (del.length) q.push(DB.prepare(`DELETE FROM prices WHERE (customer_id || '|' || product || '|' || currency) IN
    (SELECT json_extract(value, '$.customer_id') || '|' || json_extract(value, '$.product') || '|' || json_extract(value, '$.currency') FROM json_each(?))`).bind(JSON.stringify(del)));
  return q;
}

/* ---- customers */
function custOut(c, who, logins) {
  const out = { id: c.id, code: c.code, name: c.name, kind: c.kind, currency: c.currency, country: c.country, active: !!c.active, auto: !!c.auto };
  if (who.can("customers.view")) Object.assign(out, { contact: c.contact, email: c.email, phone: c.phone, address: c.address, terms: c.terms, note: c.note,
    created_at: c.created_at, updated_at: c.updated_at, logins: logins.filter((l) => l.customer_id === c.id).map((l) => l.email) });
  if ("orders" in c) { out.orders = c.orders; out.last_order = c.last_order || 0; }
  if ("billed" in c && canMoney(who)) Object.assign(out, { billed: c.billed, paid: c.paid_in, due: rnd(c.billed - c.paid_in, c.currency) });
  return out;
}
async function saveCustomers(DB, list, now, partial) {
  const errors = [], set = [], codes = [];
  const existing = await rows(DB.prepare("SELECT id, code FROM customers"));
  list.forEach((x, i) => {
    const where = "Dòng " + (x.row || i + 1);
    const code = ucode(x.code);
    if (!CCODE_RE.test(code)) return errors.push({ row: i, msg: where + ": mã khách \"" + clip(x.code, 20) + "\" không hợp lệ (chữ in hoa, số, dấu - . _, tối đa 16 ký tự)." });
    const name = clip(x.name, 120);
    if (!name) return errors.push({ row: i, msg: where + " (" + code + "): thiếu tên khách." });
    if (x.id) {
      const same = existing.find((e) => e.code === code);
      if (same && same.id !== +x.id) return errors.push({ row: i, msg: where + ": mã khách " + code + " đã dùng cho khách khác." });
    }
    const c = { code, name, kind: CUST_KINDS.includes(x.kind) ? x.kind : "clinic", country: clip(x.country, 60),
      currency: CURRENCIES.includes(String(x.currency || "").toUpperCase()) ? String(x.currency).toUpperCase() : "USD",
      contact: clip(x.contact, 100), email: clip(x.email, 160), phone: clip(x.phone, 60), address: clip(x.address, 300), terms: clip(x.terms, 300),
      note: clip(x.note, 1000), active: x.active === false || x.active === 0 ? 0 : 1, created_at: now, updated_at: now };
    c.search = custSearch(c);
    if (x.id) c.id = +x.id;
    set.push(c); codes.push(code);
  });
  if (errors.length && !partial) return { errors, codes: [] };
  const stmts = [];
  const upd = set.filter((c) => c.id), ins = set.filter((c) => !c.id);
  const cols = ["code", "name", "kind", "country", "currency", "contact", "email", "phone", "address", "terms", "note", "active", "search", "created_at", "updated_at"];
  if (ins.length) stmts.push(jsonInsert(DB, "customers", cols, ins, "WHERE 1 ON CONFLICT (code) DO UPDATE SET name = excluded.name, kind = excluded.kind, country = excluded.country, currency = excluded.currency, contact = excluded.contact, email = excluded.email, phone = excluded.phone, address = excluded.address, terms = excluded.terms, note = excluded.note, active = excluded.active, search = excluded.search, auto = 0, updated_at = excluded.updated_at"));
  for (const c of upd.slice(0, 20)) stmts.push(DB.prepare(`UPDATE customers SET code = ?, name = ?, kind = ?, country = ?, currency = ?, contact = ?, email = ?, phone = ?, address = ?, terms = ?, note = ?, active = ?, search = ?, auto = 0, updated_at = ? WHERE id = ?`)
    .bind(c.code, c.name, c.kind, c.country, c.currency, c.contact, c.email, c.phone, c.address, c.terms, c.note, c.active, c.search, now, c.id));
  if (stmts.length) await DB.batch(stmts);
  return { errors, codes };
}

/* ---- payments */
async function savePayments(DB, list, actor, now, partial) {
  const errors = [], set = [];
  const custs = await rows(DB.prepare("SELECT id, code, currency FROM customers"));
  const orderCodes = list.map((x) => normCode(x.order_code)).filter(Boolean);
  const orders = orderCodes.length ? await rows(DB.prepare("SELECT id, code, customer_id, currency FROM orders WHERE code IN (SELECT value FROM json_each(?))").bind(JSON.stringify(orderCodes))) : [];
  const ids = list.map((x) => +x.order_id).filter(Boolean);
  const byId = ids.length ? await rows(DB.prepare("SELECT id, code, customer_id, currency FROM orders WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids))) : [];
  list.forEach((x, i) => {
    const where = "Dòng " + (x.row || i + 1);
    let ord = x.order_id ? byId.find((o) => o.id === +x.order_id) : x.order_code ? orders.find((o) => o.code === normCode(x.order_code)) : null;
    if ((x.order_id || x.order_code) && !ord) return errors.push({ row: i, msg: where + ": không tìm thấy đơn " + clip(x.order_code || x.order_id, 30) + "." });
    let cust = x.customer_id ? custs.find((c) => c.id === +x.customer_id) : x.customer ? custs.find((c) => c.code === ucode(x.customer)) : null;
    if (!cust && ord) cust = custs.find((c) => c.id === ord.customer_id);
    if (!cust) return errors.push({ row: i, msg: where + ": chọn khách hàng." });
    if (ord && ord.customer_id !== cust.id) return errors.push({ row: i, msg: where + ": đơn " + ord.code + " không thuộc khách " + cust.code + "." });
    const amount = numv(x.amount);
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1e12) return errors.push({ row: i, msg: where + ": số tiền không hợp lệ." });
    const day = validDay(x.day) ? x.day : null;
    if (!day) return errors.push({ row: i, msg: where + ": ngày không hợp lệ (dd/mm/yyyy)." });
    const currency = CURRENCIES.includes(String(x.currency || "").toUpperCase()) ? String(x.currency).toUpperCase() : ord ? ord.currency : cust.currency;
    set.push({ customer_id: cust.id, order_id: ord ? ord.id : null, day, paid_at: dayStart(day) + 12 * 3600000, amount: rnd(amount, currency), currency,
      method: PAY_METHODS.includes(x.method) ? x.method : "other", ref: clip(x.ref, 120), note: clip(x.note, 300), created_by: actor, created_at: now });
  });
  if (errors.length && !partial) return { errors, count: 0, customers: [] };
  if (set.length) await jsonInsert(DB, "payments", ["customer_id", "order_id", "day", "paid_at", "amount", "currency", "method", "ref", "note", "created_by", "created_at"], set).run();
  return { errors, count: set.length, customers: set.map((x) => x.customer_id) };
}

/* ---- orders */
function chatSys(DB, orderId, by, name, text, now) {
  return [DB.prepare("INSERT INTO order_msgs (order_id, at, by, name, kind, text) VALUES (?, ?, ?, ?, 'sys', ?)").bind(orderId, now, by, clip(name, 80), clip(text, 2000)),
    DB.prepare("UPDATE orders SET last_msg_at = ?, last_msg_by = ? WHERE id = ?").bind(now, by, orderId)];
}
async function staffEmail(env, v) {
  const e = String(v || "").trim().toLowerCase();
  if (!e) return "";
  if (await staffFor(env, e)) return e;
  return null;
}
// Items from the form. Without the money permissions, prices come from the price list (kept for existing rows).
function cleanItems(input, prev, prods, priceOf, cur, canPrice) {
  const out = [], errors = [];
  (Array.isArray(input) ? input : []).slice(0, ITEMS_MAX).forEach((x, i) => {
    const product = ucode(x.product);
    if (!product) return;
    const p = prods.get(product);
    if (!p) return errors.push("Hạng mục " + (i + 1) + ": mã hàng \"" + product + "\" chưa có trong danh mục.");
    const qty = numv(x.qty === undefined || x.qty === "" ? 1 : x.qty);
    if (!(qty > 0 && qty <= 1000)) return errors.push("Hạng mục " + (i + 1) + ": số lượng không hợp lệ.");
    let price;
    const old = x.id && prev.get(+x.id);
    if (canPrice && x.price !== undefined && x.price !== null && x.price !== "") {
      price = numv(x.price);
      if (!(price >= 0 && price < 1e12)) return errors.push("Hạng mục " + (i + 1) + ": đơn giá không hợp lệ.");
    } else if (old && old.product === product && !(canPrice && x.price === "")) price = old.price;
    else price = priceOf(product, cur) ?? 0;
    out.push({ product, name: p.name, teeth: clip(x.teeth, 120), qty: Math.round(qty * 100) / 100, price, amount: rnd(qty * price, cur), note: clip(x.note, 300), sort: out.length });
  });
  return { items: out, errors };
}
const ORDER_COLS = ["code", "base", "cday", "seq", "kind", "parent_id", "customer_id", "clinic", "doctor", "patient", "ref", "service", "teeth", "material", "shade",
  "notes", "status", "designer", "qc", "received_at", "day", "due_at", "delivered_at", "dday", "currency", "units", "subtotal", "adj_pct", "adj_amount", "total",
  "charge", "paid", "tech_cost", "tech_currency", "qc_fails", "source", "job_id", "login", "previews", "last_msg_at", "last_msg_by", "created_by", "created_at", "updated_at", "search", "pkey"];
const ITEM_COLS = ["order_id", "product", "name", "teeth", "qty", "price", "amount", "note", "sort"];
function parseWhen(v, fallback) {
  if (typeof v === "number" && v > 0) return v;
  if (validDay(v)) return dayStart(v) + 9 * 3600000; // a date without time: 09:00 Vietnam time
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) { const t = Date.parse(v.length === 16 ? v + ":00+07:00" : v); if (t) return t; }
  return fallback;
}
async function createOrder(env, DB, b, who, now) {
  const canPrice = who.viaKey || who.can("billing.edit");
  const kind = ORDER_KINDS.includes(b.kind) ? b.kind : "new";
  let parent = null;
  if (kind !== "new") {
    parent = await DB.prepare("SELECT * FROM orders WHERE id = ?").bind(+b.parent_id || 0).first();
    if (!parent) throw bookErr("Không tìm thấy đơn gốc để " + (kind === "redo" ? "làm lại" : "làm tiếp") + ".");
    if (!seesOrder(who, parent)) throw bookErr("Không tìm thấy đơn gốc.", 404);
  }
  const custId = +(b.customer_id || (parent && parent.customer_id) || 0);
  const cust = await DB.prepare("SELECT * FROM customers WHERE id = ?").bind(custId).first();
  if (!cust) throw bookErr("Chọn khách hàng.");
  const received = parseWhen(b.received, now);
  const day = vnDay(received);
  const designer = await staffEmail(env, b.designer), qc = await staffEmail(env, b.qc);
  if (designer === null || qc === null) throw bookErr("KTV / QC phải là nhân sự đang hoạt động.");
  if ((designer || qc) && !who.can("cases.assign") && !who.viaKey) throw bookErr("Bạn không có quyền giao KTV / QC.", 403);
  const cur = canPrice && CURRENCIES.includes(b.currency) ? b.currency : cust.currency;
  const prods = new Map((await rows(DB.prepare("SELECT code, name, unit FROM products"))).map((p) => [p.code, p]));
  const priceOf = await priceBook(DB, cust.id);
  const { items, errors } = cleanItems(b.items, new Map(), prods, priceOf, cur, canPrice);
  if (errors.length) throw bookErr(errors[0]);
  const charge = canPrice && CHARGES.includes(b.charge) ? b.charge : kind === "redo" ? "warranty" : "charge";
  const adjPct = canPrice ? Math.max(-100, Math.min(1000, numv(b.adj_pct) || 0)) : 0, adjAmt = canPrice ? rnd(numv(b.adj_amount) || 0, cur) : 0;
  const t = totalsOf(items, adjPct, adjAmt, charge, cur);
  let status = ORDER_STATUS.includes(b.status) && (who.can("cases.status") || who.viaKey) ? b.status : designer ? "design" : "new";
  const delivered = status === "delivered" ? parseWhen(b.delivered, now) : 0;
  const base = {
    kind, parent_id: parent ? parent.id : null, customer_id: cust.id, clinic: clip(b.clinic, 120), doctor: clip(b.doctor, 120), patient: clip(b.patient, 120), pkey: fold(clip(b.patient, 120)),
    ref: clip(b.ref, 80), service: clip(b.service, 60), teeth: clip(b.teeth, 160), material: clip(b.material, 120), shade: clip(b.shade, 40), notes: clip(b.notes, 4000),
    status, designer, qc, received_at: received, day, due_at: parseWhen(b.due, 0), delivered_at: delivered, dday: delivered ? vnDay(delivered) : "",
    currency: cur, units: t.units, subtotal: t.subtotal, adj_pct: adjPct, adj_amount: adjAmt, total: t.total, charge, paid: 0, tech_cost: 0, tech_currency: "",
    qc_fails: 0, source: "manual", job_id: "", login: "", previews: "[]", last_msg_at: 0, last_msg_by: "", created_by: who.email || "D.EIGHT", created_at: now, updated_at: now,
  };
  // the form asks first whether this order is already in the book (an admin may have entered it)
  if (b.check_dupes && kind === "new") {
    const dupes = await findDupes(DB, who, { customer_id: cust.id, patient: base.patient, ref: base.ref, now });
    if (dupes.length) throw Object.assign(bookErr("Đơn này có thể đã có: " + dupes.map((x) => x.code).join(", ") + ".", 409), { code: "dupe", dupes });
  }
  // the code: typed in (old orders), from the parent (R / C), or the next number of the day
  let codes;
  if (b.code && kind === "new") {
    const pc = parseCode(b.code);
    if (!pc || pc.kind !== "new") throw bookErr("Mã đơn không đúng dạng yymmddxx, ví dụ " + codeOf(day, 1) + ".");
    codes = [{ code: pc.code, base: pc.code, cday: pc.day, seq: pc.seq }];
  } else if (parent) {
    const code = await childCode(DB, parent, kind);
    codes = [{ code, base: (parseCode(code) || {}).root || parent.base, cday: parent.cday, seq: parent.seq }];
  } else {
    const seq = await nextSeq(DB, day);
    codes = [0, 1, 2].map((k) => ({ code: codeOf(day, seq + k), cday: day, seq: seq + k })).map((c) => ({ ...c, base: c.code }));
  }
  for (const c of codes) {
    const o = { ...base, ...c };
    o.search = searchText(o);
    try {
      const ins = await jsonInsert(DB, "orders", ORDER_COLS, [o], "RETURNING id").first();
      const q = [];
      if (items.length) q.push(jsonInsert(DB, "order_items", ITEM_COLS, items.map((x) => ({ ...x, order_id: ins.id }))));
      q.push(DB.prepare(TECH_COST_SQL + "id = ?").bind(ins.id));
      q.push(...chatSys(DB, ins.id, who.email || "D.EIGHT", clip(who.name, 80) || "D.EIGHT", kind === "redo" ? "Tạo đơn làm lại từ " + parent.code : kind === "continue" ? "Tạo đơn làm tiếp từ " + parent.code : "Tạo đơn", now));
      if (b.chat) q.push(DB.prepare("INSERT INTO order_msgs (order_id, at, by, name, kind, text) VALUES (?, ?, ?, ?, 'msg', ?)").bind(ins.id, now + 1, who.email || "D.EIGHT", clip(who.name, 80) || "D.EIGHT", clip(b.chat, 4000)));
      await DB.batch(q);
      if (t.total > 0) await reallocate(DB, [cust.id]);
      return orderOut(await DB.prepare(ORDER_SELECT + " WHERE o.id = ?").bind(ins.id).first(), who);
    } catch (err) {
      if (!/UNIQUE/i.test(String(err && err.message))) throw err;
      if (codes.length === 1) throw bookErr("Mã đơn " + c.code + " đã có.", 409);
    }
  }
  throw bookErr("Không tạo được mã đơn, thử lại.", 409);
}
async function updateOrder(env, DB, o, b, who, now) {
  const canEdit = who.viaKey || who.can("orders.edit"), canPrice = who.viaKey || who.can("billing.edit");
  const set = {}, msgs = [];
  if (canEdit) {
    for (const k of ["clinic", "doctor", "patient"]) if (k in b) set[k] = clip(b[k], 120);
    if ("patient" in set) set.pkey = fold(set.patient);
    for (const [k, n] of [["ref", 80], ["service", 60], ["teeth", 160], ["material", 120], ["shade", 40], ["notes", 4000]]) if (k in b) set[k] = clip(b[k], n);
    if ("due" in b) set.due_at = parseWhen(b.due, 0);
    if ("received" in b && !o.job_id) { set.received_at = parseWhen(b.received, o.received_at); set.day = vnDay(set.received_at); }
    if ("customer_id" in b && +b.customer_id !== o.customer_id && !o.job_id) {
      const c = await DB.prepare("SELECT id, currency FROM customers WHERE id = ?").bind(+b.customer_id).first();
      if (!c) throw bookErr("Không tìm thấy khách hàng.");
      set.customer_id = c.id;
    }
    if ("code" in b && b.code && normCode(b.code) !== o.code && o.kind === "new" && !o.job_id) {
      const pc = parseCode(b.code);
      if (!pc || pc.kind !== "new") throw bookErr("Mã đơn không đúng dạng yymmddxx, ví dụ 26102101.");
      const kids = await DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE parent_id = ?").bind(o.id).first();
      if (kids.n) throw bookErr("Đơn đã có đơn làm lại / làm tiếp nên không đổi mã được.", 409);
      if (await DB.prepare("SELECT 1 AS x FROM orders WHERE code = ?").bind(pc.base).first()) throw bookErr("Mã đơn " + pc.base + " đã có.", 409);
      Object.assign(set, { code: pc.base, base: pc.base, cday: pc.day, seq: pc.seq });
      msgs.push("Đổi mã đơn " + o.code + " → " + pc.base);
    }
  }
  if ((who.viaKey || who.can("cases.assign")) && !o.job_id) {
    for (const k of ["designer", "qc"]) if (k in b) {
      const e = await staffEmail(env, b[k]);
      if (e === null) throw bookErr("KTV / QC phải là nhân sự đang hoạt động.");
      if (e !== o[k]) { set[k] = e; msgs.push((k === "designer" ? "Giao KTV: " : "Giao QC: ") + (e || "bỏ trống")); }
    }
    if (set.designer && o.status === "new" && !o.job_id) set.status = "design";
  }
  if ((who.viaKey || who.can("cases.status")) && "status" in b && ORDER_STATUS.includes(b.status) && b.status !== o.status && !o.job_id) {
    set.status = b.status; msgs.push("Trạng thái: " + b.status);
  }
  const st = set.status || o.status;
  if (!o.job_id && (set.status || "delivered" in b)) {
    if (st === "delivered") { const d = parseWhen(b.delivered, o.delivered_at || now); set.delivered_at = d; set.dday = vnDay(d); }
    else if (set.status) { set.delivered_at = 0; set.dday = ""; }
  }
  // items and money
  let items = null;
  const cust = await DB.prepare("SELECT id, currency FROM customers WHERE id = ?").bind(set.customer_id || o.customer_id).first();
  let cur = o.currency;
  if (canPrice && CURRENCIES.includes(b.currency)) cur = b.currency;
  else if (set.customer_id) cur = cust.currency;
  set.currency = cur;
  const prev = await rows(DB.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY sort, id").bind(o.id));
  if (cur !== o.currency && !Array.isArray(b.items)) b.items = prev.map((x) => ({ product: x.product, teeth: x.teeth, qty: x.qty, note: x.note }));
  if ((canEdit || canPrice || cur !== o.currency) && Array.isArray(b.items)) {
    const prods = new Map((await rows(DB.prepare("SELECT code, name, unit FROM products"))).map((p) => [p.code, p]));
    const priceOf = await priceBook(DB, cust.id);
    const r = cleanItems(b.items, new Map(prev.map((x) => [x.id, x])), prods, priceOf, cur, canPrice);
    if (r.errors.length) throw bookErr(r.errors[0]);
    items = r.items;
  }
  const useItems = items || prev.map((x) => ({ ...x, amount: rnd(x.qty * x.price, cur) }));
  const charge = canPrice && CHARGES.includes(b.charge) ? b.charge : o.charge;
  const adjPct = canPrice && "adj_pct" in b ? Math.max(-100, Math.min(1000, numv(b.adj_pct) || 0)) : o.adj_pct;
  const adjAmt = canPrice && "adj_amount" in b ? rnd(numv(b.adj_amount) || 0, cur) : o.adj_amount;
  const t = totalsOf(useItems, adjPct, adjAmt, charge, cur);
  Object.assign(set, { charge, adj_pct: adjPct, adj_amount: adjAmt, units: t.units, subtotal: t.subtotal, total: t.total, updated_at: now });
  const merged = { ...o, ...set };
  set.search = searchText(merged);
  const keys = Object.keys(set);
  const q = [DB.prepare(`UPDATE orders SET ${keys.map((k) => k + " = ?").join(", ")} WHERE id = ?`).bind(...keys.map((k) => set[k]), o.id)];
  if (items) {
    q.push(DB.prepare("DELETE FROM order_items WHERE order_id = ?").bind(o.id));
    if (items.length) q.push(jsonInsert(DB, "order_items", ITEM_COLS, items.map((x) => ({ ...x, order_id: o.id }))));
  }
  q.push(DB.prepare(TECH_COST_SQL + "id = ?").bind(o.id));
  for (const t2 of msgs) q.push(...chatSys(DB, o.id, who.email || "D.EIGHT", clip(who.name, 80) || "D.EIGHT", t2, now));
  await DB.batch(q);
  await reallocate(DB, [merged.customer_id, o.customer_id]);
  // a portal case keeps its price in step (used only if online payment is switched back on)
  if (o.job_id && canPrice && cur === "USD") {
    const job = await loadJob(env, o.job_id);
    if (job && job.price !== t.total) { job.price = t.total; await saveJob(env, job); }
  }
  return orderOut(await DB.prepare(ORDER_SELECT + " WHERE o.id = ?").bind(o.id).first(), who);
}
// Workflow of an order entered in the workspace (portal cases use their own case page).
async function orderAction(env, DB, o, b, who, now) {
  if (o.job_id) return json({ error: "Đơn từ cổng khách hàng: làm quy trình trên trang ca.", job: o.job_id }, 409);
  const note = clip(b.note, 2000), me = who.email, any = who.viaKey || who.can("orders.view");
  const go = async (status, text, extra = {}) => {
    const set = { status, updated_at: now, ...extra };
    if (status === "delivered") { set.delivered_at = now; set.dday = vnDay(now); }
    else if (o.status === "delivered") { set.delivered_at = 0; set.dday = ""; }
    const keys = Object.keys(set);
    await DB.batch([DB.prepare(`UPDATE orders SET ${keys.map((k) => k + " = ?").join(", ")} WHERE id = ?`).bind(...keys.map((k) => set[k]), o.id),
      ...chatSys(DB, o.id, me || "D.EIGHT", clip(who.name, 80) || "D.EIGHT", text + (note ? ": " + note : ""), now)]);
    if (status === "cancelled" || o.status === "cancelled") await reallocate(DB, [o.customer_id]);
    return json({ order: orderOut(await DB.prepare(ORDER_SELECT + " WHERE o.id = ?").bind(o.id).first(), who) });
  };
  const nope = () => json({ error: "Bạn không có quyền làm việc này." }, 403);
  switch (b.action) {
    case "start": if (!(who.can("cases.design") && (o.designer === me || any))) return nope(); return go("design", "Bắt đầu thiết kế");
    case "submit": if (!(who.can("cases.design") && (o.designer === me || any))) return nope();
      if (!["new", "design", "fix", "revise"].includes(o.status)) return json({ error: "Đơn không ở bước thiết kế." }, 409);
      return go("qc", "Gửi QC");
    case "pass": case "fail":
      if (!(who.can("cases.qc") && (o.qc === me || !o.qc || any))) return nope();
      if (o.status !== "qc") return json({ error: "Đơn không ở bước chờ QC." }, 409);
      if (b.action === "fail" && note.length < 3) return json({ error: "Ghi rõ lỗi cần sửa để KTV biết." }, 400);
      return go(b.action === "pass" ? "ready" : "fix", b.action === "pass" ? "QC đạt" : "QC không đạt, trả KTV sửa",
        { qc: o.qc || me || "", ...(b.action === "fail" ? { qc_fails: o.qc_fails + 1 } : {}) });
    case "review": if (!who.can("cases.deliver")) return nope(); return go("review", "Gửi bác sĩ duyệt");
    case "revise": if (!(who.can("cases.status") || who.can("cases.deliver"))) return nope(); return go("revise", "Bác sĩ yêu cầu chỉnh sửa");
    case "approve": if (!(who.can("cases.status") || who.can("cases.deliver"))) return nope(); return go("approved", "Bác sĩ đã duyệt");
    case "deliver": if (!who.can("cases.deliver")) return nope(); return go("delivered", "Đã giao file");
    case "hold": if (!who.can("cases.status")) return nope(); return go("hold", "Tạm dừng / chờ bổ sung");
    case "cancel": if (!who.can("cases.status")) return nope(); if (note.length < 3) return json({ error: "Ghi lý do hủy." }, 400);
      return go("cancelled", "Hủy đơn");
    case "reopen": if (!(who.can("cases.status") || who.can("cases.qc"))) return nope(); return go(o.designer ? "design" : "new", "Mở lại đơn");
  }
  return json({ error: "Bad request." }, 400);
}
async function listOrders(DB, who, P, now) {
  const w = [], a = [];
  const sc = orderScope(who);
  w.push(sc.sql); a.push(...sc.args);
  const q = fold(P.get("q") || "").slice(0, 60);
  for (const term of q.split(" ").filter(Boolean).slice(0, 4)) {
    const t = (/^[\d/rc-]+$/.test(term) ? term.replace(/[/-]/g, "") : term).slice(0, 40).replace(/[%_]/g, "");
    if (!t) continue;
    w.push("(o.search LIKE ? OR c.search LIKE ?)"); a.push("%" + t + "%", "%" + t + "%");
  }
  if (P.get("customer")) { w.push("o.customer_id = ?"); a.push(+P.get("customer") || 0); }
  if (P.get("designer")) { const d = P.get("designer"); if (d === "none") w.push("o.designer = ''"); else if (d === "me") { w.push("(o.designer = ? OR o.qc = ?)"); a.push(who.email, who.email); } else { w.push("o.designer = ?"); a.push(d); } }
  if (P.get("kind") && ORDER_KINDS.includes(P.get("kind"))) { w.push("o.kind = ?"); a.push(P.get("kind")); }
  if (P.get("source") === "portal") w.push("o.job_id != ''");
  const basis = P.get("basis") === "delivered" ? "o.dday" : "o.day";
  if (validDay(P.get("from"))) { w.push(basis + " >= ?"); a.push(P.get("from")); }
  if (validDay(P.get("to"))) { w.push(basis + " <= ?"); a.push(P.get("to")); if (basis === "o.dday") w.push("o.dday != ''"); }
  if (canMoney(who) && P.get("pay") === "due") w.push("o.total - o.paid > 0.004 AND o.status != 'cancelled'");
  if (canMoney(who) && P.get("pay") === "paid") w.push("o.total > 0 AND o.total - o.paid <= 0.004");
  if (canMoney(who) && CURRENCIES.includes(P.get("currency"))) { w.push("o.currency = ?"); a.push(P.get("currency")); }
  const where = "WHERE " + w.join(" AND ");
  const st = P.get("status") || "";
  const stW = [], stA = [];
  if (st === "open") stW.push("o.status NOT IN ('delivered', 'cancelled')");
  else if (st === "work") stW.push("o.status IN ('new', 'design', 'fix', 'revise')");
  else if (st) { const list = st.split(",").filter((s) => ORDER_STATUS.includes(s)); if (list.length) { stW.push("o.status IN (" + list.map(() => "?").join(", ") + ")"); stA.push(...list); } }
  if (P.get("unread") === "1") { stW.push("o.last_msg_at > COALESCE(r.at, 0) AND o.last_msg_by != ?"); stA.push(who.email); }
  const whereAll = where + (stW.length ? " AND " + stW.join(" AND ") : "");
  const limit = Math.max(1, Math.min(200, parseInt(P.get("limit") || "50", 10) || 50));
  const offset = Math.max(0, parseInt(P.get("offset") || "0", 10) || 0);
  const sort = { old: "o.received_at ASC, o.id ASC", due: "CASE WHEN o.due_at = 0 THEN 1 ELSE 0 END, o.due_at ASC", code: "o.cday DESC, o.seq DESC, o.code", updated: "o.updated_at DESC" }[P.get("sort")] || "o.received_at DESC, o.id DESC";
  const join = "FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN order_reads r ON r.order_id = o.id AND r.email = ?";
  const [list, sums, counts] = await DB.batch([
    DB.prepare(`SELECT o.*, c.code AS customer_code, c.name AS customer_name, (o.last_msg_at > COALESCE(r.at, 0) AND o.last_msg_by != ?) AS unread,
      (SELECT group_concat(CASE WHEN i.qty = 1 THEN i.product WHEN i.qty = CAST(i.qty AS INTEGER) THEN (CAST(i.qty AS INTEGER) || '× ' || i.product) ELSE (i.qty || '× ' || i.product) END, ', ') FROM order_items i WHERE i.order_id = o.id) AS items_text
      ${join} ${whereAll} ORDER BY ${sort} LIMIT ? OFFSET ?`).bind(who.email, who.email, ...a, ...stA, limit, offset),
    DB.prepare(`SELECT o.currency AS currency, COUNT(*) AS n, SUM(o.units) AS units, SUM(CASE WHEN o.status != 'cancelled' THEN o.total ELSE 0 END) AS total,
      SUM(CASE WHEN o.status != 'cancelled' THEN o.paid ELSE 0 END) AS paid ${join} ${whereAll} GROUP BY o.currency`).bind(who.email, ...a, ...stA),
    DB.prepare(`SELECT o.status AS status, COUNT(*) AS n ${join} ${where} GROUP BY o.status`).bind(who.email, ...a),
  ]);
  const money = canMoney(who);
  const s = sums.results || [];
  return json({
    items: (list.results || []).map((o) => orderOut(o, who)),
    count: s.reduce((t, x) => t + x.n, 0), units: s.reduce((t, x) => t + (x.units || 0), 0),
    sums: money ? s.map((x) => ({ currency: x.currency, n: x.n, total: rnd(x.total || 0, x.currency), paid: rnd(x.paid || 0, x.currency), due: rnd((x.total || 0) - (x.paid || 0), x.currency) })) : [],
    statusCounts: Object.fromEntries((counts.results || []).map((x) => [x.status, x.n])), limit, offset,
  });
}
async function orderDash(DB, who, now) {
  const sc = orderScope(who), me = who.email;
  const pick = (cond, args, sort = "o.received_at DESC") => DB.prepare(`${ORDER_SELECT} WHERE ${sc.sql} AND ${cond} ORDER BY ${sort} LIMIT 12`).bind(...sc.args, ...args);
  const parts = [];
  const want = [];
  if (who.can("cases.design") && me) { want.push("mine"); parts.push(pick("o.designer = ? AND o.status IN ('new', 'design', 'fix', 'revise')", [me], "CASE WHEN o.due_at = 0 THEN 1 ELSE 0 END, o.due_at, o.received_at")); }
  if (who.can("cases.qc")) { want.push("qc"); parts.push(pick("o.status = 'qc' AND (o.qc = ? OR o.qc = '' OR ?)", [me, who.viaKey || who.can("orders.view") ? 1 : 0])); }
  if (who.can("cases.deliver")) { want.push("ready"); parts.push(pick("o.status IN ('ready', 'approved')", [])); }
  if (who.can("cases.assign")) { want.push("unassigned"); parts.push(pick("o.designer = '' AND o.status NOT IN ('delivered', 'cancelled')", [])); }
  want.push("due"); parts.push(pick("o.due_at > 0 AND o.due_at < ? AND o.status NOT IN ('delivered', 'cancelled')", [now + DAY_MS], "o.due_at"));
  if (who.can("cases.notes")) { want.push("unread"); parts.push(DB.prepare(`${ORDER_SELECT} LEFT JOIN order_reads r ON r.order_id = o.id AND r.email = ? WHERE ${sc.sql} AND o.last_msg_at > COALESCE(r.at, 0) AND o.last_msg_by != ? AND o.last_msg_at > ? ORDER BY o.last_msg_at DESC LIMIT 12`).bind(me, ...sc.args, me, now - 60 * DAY_MS)); }
  const month = vnDay(now).slice(0, 8) + "01";
  if (canMoney(who)) {
    want.push("money"); parts.push(DB.prepare(`SELECT currency, COUNT(*) AS n, SUM(total) AS total, SUM(paid) AS paid FROM orders WHERE day >= ? AND status != 'cancelled' GROUP BY currency`).bind(month));
    want.push("debt"); parts.push(DB.prepare(`SELECT currency, SUM(total - paid) AS due, COUNT(*) AS n FROM orders WHERE status != 'cancelled' AND total - paid > 0.004 GROUP BY currency`));
  }
  want.push("today"); parts.push(DB.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${sc.sql} AND o.day = ?`).bind(...sc.args, vnDay(now)));
  const res = await DB.batch(parts);
  const out = {};
  want.forEach((k, i) => {
    const r = res[i].results || [];
    out[k] = ["money", "debt"].includes(k) ? r : k === "today" ? (r[0] || {}).n || 0 : r.map((o) => orderOut(o, who));
  });
  return json(out);
}
async function reportData(DB, who, P, now) {
  const to = validDay(P.get("to")) ? P.get("to") : vnDay(now);
  const from = validDay(P.get("from")) ? P.get("from") : vnDay(now - 365 * DAY_MS);
  const d = P.get("basis") === "delivered" ? "dday" : "day";
  const Wa = (a) => `${a}status != 'cancelled' AND ${a}${d} >= ? AND ${a}${d} <= ?` + (d === "dday" ? ` AND ${a}dday != ''` : "");
  const W = Wa("");
  const money = canMoney(who), tech = who.viaKey || who.can("techpay.manage");
  const [byDay, pays, byCust, byDes, byProd, debt, credit, open] = await DB.batch([
    DB.prepare(`SELECT ${d} AS d, currency AS cur, COUNT(*) AS n, SUM(units) AS u, SUM(total) AS t, SUM(paid) AS p, SUM(tech_cost) AS k, SUM(kind = 'redo') AS r, SUM(kind = 'continue') AS c
      FROM orders WHERE ${W} GROUP BY ${d}, currency`).bind(from, to),
    DB.prepare(`SELECT day AS d, currency AS cur, SUM(amount) AS a FROM payments WHERE day >= ? AND day <= ? GROUP BY day, currency`).bind(from, to),
    DB.prepare(`SELECT o.customer_id AS id, c.code, c.name, o.currency AS cur, COUNT(*) AS n, SUM(o.units) AS u, SUM(o.total) AS t, SUM(o.paid) AS p, SUM(o.kind = 'redo') AS r
      FROM orders o JOIN customers c ON c.id = o.customer_id WHERE ${Wa("o.")} GROUP BY o.customer_id, o.currency ORDER BY n DESC`).bind(from, to),
    DB.prepare(`SELECT designer AS email, COUNT(*) AS n, SUM(units) AS u, SUM(qc_fails) AS f, SUM(kind = 'redo') AS r, SUM(tech_cost) AS k, MAX(tech_currency) AS kc,
      SUM(status = 'delivered') AS done FROM orders WHERE ${W} GROUP BY designer ORDER BY n DESC`).bind(from, to),
    DB.prepare(`SELECT i.product AS code, MAX(i.name) AS name, o.currency AS cur, SUM(i.qty) AS q, SUM(i.amount) AS a, COUNT(DISTINCT o.id) AS n
      FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${Wa("o.")} GROUP BY i.product, o.currency ORDER BY q DESC`).bind(from, to),
    DB.prepare(`SELECT c.id, c.code, c.name, o.currency AS cur, SUM(o.total - o.paid) AS due, COUNT(*) AS n, MIN(o.day) AS oldest
      FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status != 'cancelled' AND o.total - o.paid > 0.004 GROUP BY c.id, o.currency ORDER BY due DESC`),
    DB.prepare(`SELECT c.id, c.code, c.name, x.cur, x.inn - COALESCE(y.used, 0) AS credit FROM
      (SELECT customer_id, currency AS cur, SUM(amount) AS inn FROM payments GROUP BY customer_id, currency) x JOIN customers c ON c.id = x.customer_id
      LEFT JOIN (SELECT customer_id, currency AS cur, SUM(paid) AS used FROM orders WHERE status != 'cancelled' GROUP BY customer_id, currency) y ON y.customer_id = x.customer_id AND y.cur = x.cur
      WHERE x.inn - COALESCE(y.used, 0) > 0.004 ORDER BY credit DESC`),
    DB.prepare(`SELECT status, COUNT(*) AS n FROM orders GROUP BY status`),
  ]);
  const strip = (list, keys) => list.map((r) => { const o = { ...r }; for (const k of keys) delete o[k]; return o; });
  const noMoney = money ? [] : ["t", "p", "a"], noTech = tech ? [] : ["k", "kc"];
  return json({
    from, to, basis: d === "dday" ? "delivered" : "received", money, tech,
    days: strip(byDay.results || [], [...noMoney, ...noTech]),
    payments: money ? pays.results || [] : [],
    customers: strip(byCust.results || [], noMoney),
    designers: strip(byDes.results || [], noTech),
    products: strip(byProd.results || [], noMoney),
    debt: money ? debt.results || [] : [], credit: money ? credit.results || [] : [],
    status: Object.fromEntries((open.results || []).map((x) => [x.status, x.n])),
  });
}
async function exportData(DB, who, P, now) {
  const to = validDay(P.get("to")) ? P.get("to") : vnDay(now);
  const from = validDay(P.get("from")) ? P.get("from") : vnDay(now - 31 * DAY_MS);
  const offset = Math.max(0, parseInt(P.get("offset") || "0", 10) || 0);
  const LIM = 800;
  const money = canMoney(who);
  const sc = orderScope(who);
  const [o, it, p] = await DB.batch([
    DB.prepare(`${ORDER_SELECT} WHERE ${sc.sql} AND o.day >= ? AND o.day <= ? ORDER BY o.received_at, o.id LIMIT ? OFFSET ?`).bind(...sc.args, from, to, LIM, offset),
    DB.prepare(`SELECT i.* FROM order_items i WHERE i.order_id IN (SELECT o.id FROM orders o WHERE ${sc.sql} AND o.day >= ? AND o.day <= ? ORDER BY o.received_at, o.id LIMIT ? OFFSET ?) ORDER BY i.order_id, i.sort`).bind(...sc.args, from, to, LIM, offset),
    DB.prepare(`SELECT p.*, c.code AS customer_code, c.name AS customer_name, o.code AS order_code FROM payments p JOIN customers c ON c.id = p.customer_id LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.day >= ? AND p.day <= ? ORDER BY p.day, p.id`).bind(from, to),
  ]);
  const orders = (o.results || []).map((x) => orderOut(x, who));
  return json({ from, to, orders, items: (it.results || []).map((x) => ({ ...itemOut(x, money), order_id: x.order_id })),
    payments: money && offset === 0 ? p.results || [] : [], more: orders.length === LIM, next: offset + LIM });
}
// Old orders from Excel: rows are already grouped into orders by the browser ({key, code, day, customer, items: [...], ...}).
async function importOrders(env, DB, list, who, now, partial, dry) {
  const canPrice = who.viaKey || who.can("billing.edit");
  const [cs, ps, pr] = await DB.batch([DB.prepare("SELECT id, code, currency FROM customers"), DB.prepare("SELECT code, name, unit FROM products"),
    DB.prepare("SELECT customer_id, product, currency, price FROM prices")]);
  const custs = new Map((cs.results || []).map((c) => [c.code, c]));
  const prods = new Map((ps.results || []).map((p) => [p.code, p]));
  const prices = pr.results || [];
  const priceFor = (cid) => (product, cur) => {
    const own = prices.find((p) => p.customer_id === cid && p.product === product && p.currency === cur);
    const def = prices.find((p) => p.customer_id === 0 && p.product === product && p.currency === cur);
    return own ? own.price : def ? def.price : null;
  };
  const team = (await listStaffRecords(env)).map((t) => ({ ...t }));
  await fillNames(env, team);
  const admins = conf(env).admins;
  const staffByKey = (v) => {
    const s = fold(v);
    if (!s) return "";
    if (admins.includes(s)) return s;
    const r = team.find((t) => t.active !== false && (t.email === s || fold(t.name) === s || t.email.split("@")[0] === s));
    return r ? r.email : null;
  };
  const errors = [], ready = [];
  const typed = list.map((x) => parseCode(x.code)).filter(Boolean).map((pc) => pc.code);
  const taken = new Set(typed.length ? (await rows(DB.prepare("SELECT code FROM orders WHERE code IN (SELECT value FROM json_each(?))").bind(JSON.stringify(typed)))).map((x) => x.code) : []);
  list.forEach((x, i) => {
    const where = "Đơn " + (x.label || x.code || x.key || i + 1) + (x.row ? " (dòng " + x.row + ")" : "");
    const cust = custs.get(ucode(x.customer));
    if (!cust) return errors.push({ row: i, msg: where + ": không có khách mã \"" + clip(x.customer, 20) + "\". Thêm khách trước." });
    if (!validDay(x.day)) return errors.push({ row: i, msg: where + ": ngày nhận không hợp lệ." });
    const cur = canPrice && CURRENCIES.includes(String(x.currency || "").toUpperCase()) ? String(x.currency).toUpperCase() : cust.currency;
    const r = cleanItems(x.items, new Map(), prods, priceFor(cust.id), cur, canPrice);
    if (r.errors.length) return errors.push({ row: i, msg: where + ": " + r.errors[0] });
    const designer = staffByKey(x.designer), qc = staffByKey(x.qc);
    if (designer === null) return errors.push({ row: i, msg: where + ": KTV \"" + clip(x.designer, 40) + "\" chưa có trong Nhân sự." });
    if (qc === null) return errors.push({ row: i, msg: where + ": QC \"" + clip(x.qc, 40) + "\" chưa có trong Nhân sự." });
    // a typed code is kept (26102101, old style 26/10/21/01 too); R / C codes are linked to their parent code after the insert
    const pc = parseCode(x.code);
    let code = pc ? pc.code : "";
    if (pc && taken.has(code)) return errors.push({ row: i, msg: where + ": mã " + code + " đã có." });
    if (pc) taken.add(code);
    const status = ORDER_STATUS.includes(x.status) ? x.status : "delivered";
    const charge = CHARGES.includes(x.charge) ? x.charge : pc && pc.kind === "redo" ? "warranty" : "charge";
    const adjPct = canPrice ? Math.max(-100, Math.min(1000, numv(x.adj_pct) || 0)) : 0;
    const t = totalsOf(r.items, adjPct, 0, charge, cur);
    const received = dayStart(x.day) + 9 * 3600000;
    const dd = status === "delivered" ? (validDay(x.dday) ? x.dday : x.day) : "";
    ready.push({ i, where, cust, cur, items: r.items, code, pc, o: {
      kind: pc ? pc.kind : "new", parent_id: null, customer_id: cust.id, clinic: clip(x.clinic, 120), doctor: clip(x.doctor, 120), patient: clip(x.patient, 120), pkey: fold(clip(x.patient, 120)), ref: clip(x.ref, 80),
      service: clip(x.service, 60), teeth: clip(x.teeth, 160), material: clip(x.material, 120), shade: clip(x.shade, 40), notes: clip(x.notes, 4000), status, designer, qc,
      received_at: received, day: x.day, due_at: 0, delivered_at: dd ? dayStart(dd) + 17 * 3600000 : 0, dday: dd, currency: cur, units: t.units, subtotal: t.subtotal,
      adj_pct: adjPct, adj_amount: 0, total: t.total, charge, paid: 0, tech_cost: 0, tech_currency: "", qc_fails: 0, source: "import", job_id: "", login: "", previews: "[]",
      last_msg_at: 0, last_msg_by: "", created_by: who.email || "D.EIGHT", created_at: now, updated_at: now },
      paid: canPrice ? x.paid : undefined, payMethod: x.pay_method, payDay: x.pay_day });
  });
  if (errors.length && !partial) return json({ errors, done: 0 }, 400);
  // codes for rows without one: next numbers of each day, in the order of the file
  const days = [...new Set(ready.filter((r) => !r.code).map((r) => r.o.day))];
  const maxes = days.length ? await rows(DB.prepare("SELECT cday, MAX(seq) AS m FROM orders WHERE kind = 'new' AND cday IN (SELECT value FROM json_each(?)) GROUP BY cday").bind(JSON.stringify(days))) : [];
  const next = new Map(days.map((d) => [d, ((maxes.find((x) => x.cday === d) || {}).m || 0) + 1]));
  for (const r of ready) if (r.code) { const s = next.get(r.pc.day); if (s && s <= r.pc.seq) next.set(r.pc.day, r.pc.seq + 1); }
  for (const r of ready) {
    if (r.code) Object.assign(r.o, { code: r.code, base: r.pc.root, cday: r.pc.day, seq: r.pc.seq });
    else { const s = next.get(r.o.day); next.set(r.o.day, s + 1); Object.assign(r.o, { code: codeOf(r.o.day, s), base: codeOf(r.o.day, s), cday: r.o.day, seq: s }); }
    r.o.search = searchText(r.o);
  }
  if (dry) {
    // orders that may already be in the book (same customer, date and patient or customer reference)
    let ex = [];
    if (ready.length) ex = await rows(DB.prepare("SELECT customer_id, day, patient, ref FROM orders WHERE customer_id IN (SELECT value FROM json_each(?)) AND day IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify([...new Set(ready.map((r) => r.cust.id))]), JSON.stringify([...new Set(ready.map((r) => r.o.day))])));
    const dup = (r) => ex.some((e) => e.customer_id === r.cust.id && e.day === r.o.day && ((r.o.patient && fold(e.patient) === fold(r.o.patient)) || (r.o.ref && e.ref === r.o.ref)));
    return json({ done: 0, preview: ready.map((r) => ({ i: r.i, code: r.o.code, customer: r.cust.code, day: r.o.day, items: r.items.length, dup: dup(r), ...(canPrice ? { total: r.o.total, currency: r.cur } : {}) })), errors });
  }
  if (!ready.length) return json({ done: 0, errors });
  const inserted = await rows(jsonInsert(DB, "orders", ORDER_COLS, ready.map((r) => r.o), "RETURNING id, code"));
  const idOf = new Map(inserted.map((x) => [x.code, x.id]));
  const items = [], pays = [];
  for (const r of ready) {
    const id = idOf.get(r.o.code);
    if (!id) continue;
    items.push(...r.items.map((x) => ({ ...x, order_id: id })));
    // "paid" column: yes / x = paid in full, a number = that amount, empty = not paid
    let amt = 0;
    if (r.paid === true || /^(có|co|x|yes|y|paid|đã trả|da tra|1)$/i.test(String(r.paid ?? "").trim())) amt = r.o.total;
    else if (numv(r.paid) > 0) amt = rnd(numv(r.paid), r.cur);
    if (amt > 0) {
      const pd = validDay(r.payDay) ? r.payDay : r.o.dday || r.o.day;
      pays.push({ customer_id: r.cust.id, order_id: id, day: pd, paid_at: dayStart(pd) + 12 * 3600000, amount: amt, currency: r.cur,
        method: PAY_METHODS.includes(r.payMethod) ? r.payMethod : "other", ref: "", note: "Nhập từ Excel", created_by: who.email || "D.EIGHT", created_at: now });
    }
  }
  const q = [];
  if (items.length) q.push(jsonInsert(DB, "order_items", ITEM_COLS, items));
  const kids = ready.filter((r) => r.pc && r.pc.parent && idOf.get(r.o.code)).map((r) => ({ id: idOf.get(r.o.code), p: r.pc.parent }));
  if (kids.length) q.push(DB.prepare(`UPDATE orders SET parent_id = (SELECT p.id FROM orders p WHERE p.code = json_extract(j.value, '$.p'))
    FROM json_each(?) j WHERE orders.id = json_extract(j.value, '$.id')`).bind(JSON.stringify(kids)));
  if (pays.length) q.push(jsonInsert(DB, "payments", ["customer_id", "order_id", "day", "paid_at", "amount", "currency", "method", "ref", "note", "created_by", "created_at"], pays));
  q.push(DB.prepare(TECH_COST_SQL + "id IN (SELECT value FROM json_each(?))").bind(JSON.stringify([...idOf.values()])));
  await DB.batch(q);
  await reallocate(DB, ready.map((r) => r.cust.id));
  return json({ done: inserted.length, codes: inserted.map((x) => x.code), errors });
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

// Preview image for a 3D link (shown by Messenger, Zalo, WhatsApp…): the snapshot made when the link was created,
// otherwise the D.EIGHT "3D design view" picture.
async function ogImage(request, env, id) {
  if (ID_RE.test(id) && env.CASES) {
    const v = await env.CASES.get("og:" + id, { type: "stream" });
    if (v) return new Response(v, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  }
  const u = new URL(request.url);
  u.pathname = "/brand/og-3d.jpg"; u.search = "";
  const res = await env.ASSETS.fetch(new Request(u.toString(), { headers: request.headers }));
  return withHeaders(res, { "Cache-Control": "public, max-age=3600" });
}
async function putOgImage(request, env, id) {
  if (!ID_RE.test(id)) return json({ error: "Mã link không hợp lệ." }, 400);
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (len > 900 * 1024) return json({ error: "Ảnh xem trước quá lớn." }, 413);
  const body = await request.arrayBuffer();
  const u = new Uint8Array(body, 0, Math.min(3, body.byteLength));
  if (body.byteLength < 500 || body.byteLength > 900 * 1024 || !(u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff)) return json({ error: "Ảnh xem trước phải là JPEG dưới 900 KB." }, 400);
  const meta = await env.CASES.get("meta:" + id, "json"); // a link made a moment ago may not be readable yet: keep the image 31 days then
  if (meta && meta.e <= Date.now()) return json({ error: "Link đã hết hạn." }, 410);
  await env.CASES.put("og:" + id, body, { expiration: Math.floor((meta ? meta.e : Date.now() + 31 * DAY_MS) / 1000) });
  return json({ ok: true });
}

async function viewerPage(env, id, url) {
  if (!ID_RE.test(id) || !env.CASES) return unavailablePage();
  const meta = await env.CASES.get("meta:" + id, "json");
  if (!meta || meta.e <= Date.now()) return unavailablePage();

  const label = meta.t ? escapeHtml(meta.t) : meta.l ? escapeHtml(meta.l) : "3D design preview";
  const heading = meta.t || meta.l ? label : "Ready for your review";
  const desc = escapeHtml(meta.d || "Open the link to view and rotate the 3D design in your browser. No software needed.");
  const pageUrl = escapeHtml(url.origin + "/v/" + id), img = escapeHtml(url.origin + "/og/" + id + ".jpg");
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
<meta name="description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="D.EIGHT DESIGN CENTER">
<meta property="og:title" content="${label}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:image" content="${img}">
<meta property="og:image:secure_url" content="${img}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="3D design view · D.EIGHT DESIGN CENTER">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${label}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${img}">
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
  .case .sub { margin:1px 0 0; font-size:12px; line-height:1.3; color:var(--navy-600); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
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
  <div class="case"><span class="eyebrow">3D design preview</span><h1>${heading}</h1>${meta.d ? `<p class="sub">${desc}</p>` : ""}</div>
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
