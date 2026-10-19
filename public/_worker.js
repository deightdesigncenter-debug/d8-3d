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
const ASSET_VERSION = "2026-10-19.5"; // bump with brand.css changes
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
    const pc = payConf(env);
    return json({ googleClientId: conf(env).clientId, trialCases: TRIAL_CASES, trialCredit: TRIAL_CREDIT_USD, translate: !!env.AI, fileStore: activeStore(env),
      pay: { paypal: !!pc.paypal, stripe: !!pc.stripe } },
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

  if (path === "/api/list" && method === "GET") return can("links.manage") || can("cases.deliver") ? listCases(env) : deny();
  if (path === "/api/upload" && method === "POST") return can("links.manage") || can("cases.deliver") ? uploadCase(request, env, url) : deny();

  const del = path.match(/^\/api\/cases\/([^/]+)$/);
  if (del && method === "DELETE") return can("links.manage") ? deleteCase(env, del[1]) : deny();

  if (path === "/api/messages" && method === "GET") return can("messages.view") ? listMessages(env) : deny();
  const delMsg = path.match(/^\/api\/messages\/([^/]+)$/);
  if (delMsg && method === "DELETE") return can("messages.view") ? deleteMessage(env, delMsg[1]) : deny();

  if (path === "/api/admin/jobs" && method === "GET") return listJobs(env, null, who);
  if (path === "/api/admin/users" && method === "GET") return can("customers.view") ? listUsers(env) : deny();

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
  ["cases.all", "Xem tất cả ca (không chỉ ca được giao)", "Ca hàng"],
  ["cases.assign", "Giao ca cho KTV / QC", "Ca hàng"],
  ["cases.status", "Đổi trạng thái ca", "Ca hàng"],
  ["cases.customer", "Xem email và liên hệ của khách", "Ca hàng"],
  ["cases.files", "Tải file của khách", "Ca hàng"],
  ["cases.design", "Tải file thiết kế lên và gửi QC", "Thiết kế & QC"],
  ["cases.qc", "Kiểm tra QC (đạt / không đạt)", "Thiết kế & QC"],
  ["cases.notes", "Ghi chú nội bộ của đội", "Thiết kế & QC"],
  ["cases.deliver", "Gửi bản 3D và giao file cho khách", "Thiết kế & QC"],
  ["cases.delete", "Xóa file trong ca", "Thiết kế & QC"],
  ["cases.chat_read", "Đọc tin nhắn với khách", "Tin nhắn"],
  ["cases.chat", "Nhắn tin cho khách", "Tin nhắn"],
  ["ai.use", "Công cụ AI (tóm tắt, gợi ý trả lời)", "Tin nhắn"],
  ["billing.view", "Xem giá và thanh toán", "Tiền"],
  ["billing.edit", "Báo giá, xác nhận thanh toán", "Tiền"],
  ["pricing.manage", "Bảng giá theo khách", "Tiền"],
  ["customers.view", "Danh sách và hồ sơ khách hàng", "Quản lý"],
  ["messages.view", "Tin nhắn từ form liên hệ", "Quản lý"],
  ["links.manage", "Link xem 3D và công cụ HTML sang STL", "Quản lý"],
  ["export.csv", "Xuất CSV", "Quản lý"],
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
    d: String(job.designer || "").slice(0, 120), q: String(job.qcBy || "").slice(0, 120), g: job.stage || "" };
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
      service: m.sv || "", ownerName: m.on || "", trial: !!m.tr, pay: m.py || "" });
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
      designer: m.d || "", qcBy: m.q || "", stage: m.g || "" });
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
    if (own.length < TRIAL_CASES) { job.trial = true; job.pay = "trial"; }
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
    if (!via || !payConf(env)[via]) return json({ error: "This payment method is not available." }, 400);
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
    return json({ job: await jobView(env, job, viewer) });
  }

  if (sub === "/approve" && method === "POST") {
    if (by !== "client") return json({ error: "Only the customer can approve." }, 403);
    if (job.status !== "review") return json({ error: "This design is not waiting for approval." }, 409);
    const now = Date.now();
    job.status = "approved"; job.approvedAt = now; job.updated = now; job.lastBy = "client";
    job.thread.push({ by: "system", name: "", text: "status:approved", at: now });
    await saveJob(env, job);
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
