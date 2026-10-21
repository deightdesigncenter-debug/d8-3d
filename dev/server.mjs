// Local emulator for Cloudflare Pages advanced mode (_worker.js) + Workers KV.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PUBLIC = process.argv[2];
const PORT = +process.argv[3] || 8788;
const PASSWORD = process.argv[4] || "test-pass";
const LAG_MS = +process.argv[5] || 0; // simulate KV list() eventual consistency
const tomb = new Map();

fs.copyFileSync(path.join(PUBLIC, "_worker.js"), new URL("./worker.mjs", import.meta.url));
const worker = (await import(pathToFileURL(new URL("./worker.mjs", import.meta.url).pathname).href + "?t=" + Date.now())).default;

// ---- KV mock following the documented Workers KV API and limits
const store = new Map();
const KV_MAX_VALUE = 25 * 1024 * 1024, KV_MAX_META = 1024;
async function toBuffer(v) {
  if (typeof v === "string") return Buffer.from(v);
  if (v instanceof ArrayBuffer) return Buffer.from(new Uint8Array(v));
  if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  if (v && typeof v.getReader === "function") return Buffer.from(await new Response(v).arrayBuffer());
  throw new TypeError("KV put: unsupported value type");
}
function alive(rec) { return rec && (!rec.expiration || rec.expiration * 1000 > Date.now()); }
function asType(buf, type) {
  if (type === "json") return JSON.parse(buf.toString("utf8"));
  if (type === "arrayBuffer") return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  if (type === "stream") return new Response(buf).body;
  return buf.toString("utf8");
}
const ops = { read: 0, write: 0, list: 0, delete: 0 }; // compare with the free plan: 100k reads, 1k writes/lists/deletes a day
const KV = {
  async put(key, value, opts = {}) {
    ops.write++;
    const buf = await toBuffer(value);
    if (buf.length > KV_MAX_VALUE) throw new Error("KV put failed: 413 Value length exceeds limit");
    if (opts.metadata && Buffer.byteLength(JSON.stringify(opts.metadata)) > KV_MAX_META) throw new Error("KV put failed: metadata too large");
    let expiration = opts.expiration;
    if (opts.expirationTtl) { if (opts.expirationTtl < 60) throw new Error("expirationTtl < 60"); expiration = Math.floor(Date.now()/1000) + opts.expirationTtl; }
    if (expiration && expiration * 1000 < Date.now() + 60000) throw new Error("KV put failed: expiration must be at least 60s in the future");
    store.set(key, { buf, metadata: opts.metadata ?? null, expiration, t: Date.now() });
  },
  async get(key, opt) {
    ops.read++;
    const type = typeof opt === "string" ? opt : opt?.type || "text";
    const rec = store.get(key);
    return alive(rec) ? asType(rec.buf, type) : null;
  },
  async getWithMetadata(key, opt) {
    ops.read++;
    const type = typeof opt === "string" ? opt : opt?.type || "text";
    const rec = store.get(key);
    return alive(rec) ? { value: asType(rec.buf, type), metadata: rec.metadata } : { value: null, metadata: null };
  },
  async list({ prefix = "", limit = 1000 } = {}) {
    ops.list++;
    const now = Date.now(); const all = [...store.entries(), ...[...tomb.entries()].filter(([, r]) => now - r.d < LAG_MS)];
    const keys = all.filter(([k, r]) => k.startsWith(prefix) && alive(r) && now - r.t >= LAG_MS).sort(([a],[b]) => a < b ? -1 : 1)
      .slice(0, limit).map(([name, r]) => ({ name, expiration: r.expiration, metadata: r.metadata }));
    return { keys, list_complete: true, cursor: "" };
  },
  async delete(key) { ops.delete++; const r = store.get(key); if (r) tomb.set(key, { ...r, d: Date.now() }); store.delete(key); },
};

// ---- ASSETS mock (Pages static asset behaviour incl. .html stripping)
const TYPES = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".js": "text/javascript",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".webp": "image/webp", ".jpg": "image/jpeg" };
const ASSETS = {
  async fetch(req) {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith(".html")) return new Response(null, { status: 308, headers: { Location: p.replace(/(index)?\.html$/, "") } });
    if (p === "/_worker.js") return new Response("Not found", { status: 404 });
    let file = path.join(PUBLIC, p);
    if (p.endsWith("/")) file = path.join(PUBLIC, p, "index.html");
    else if (!path.extname(p)) file = path.join(PUBLIC, p + ".html");
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response("Not found", { status: 404 });
    return new Response(fs.readFileSync(file), { headers: { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" } });
  },
};

// ---- Fake Google sign-in for local tests: a local RSA key stands in for Google's signing keys.
import crypto from "node:crypto";
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const TEST_KID = "local-test-key";
const TEST_CLIENT_ID = "local-test-client.apps.googleusercontent.com";
const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: TEST_KID, alg: "RS256", use: "sig" }] };
function fakeIdToken(email, name) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "RS256", kid: TEST_KID, typ: "JWT" });
  const body = b64({ iss: "https://accounts.google.com", aud: TEST_CLIENT_ID, sub: "x" + email, email, email_verified: true, name, picture: "", iat: now, exp: now + 3600 });
  const sig = crypto.sign("RSA-SHA256", Buffer.from(head + "." + body), privateKey).toString("base64url");
  return head + "." + body + "." + sig;
}

// ---- Workers AI mock (chat translation): set NO_AI=1 to test the fallbacks
const AI = {
  async run(model, input) {
    ops.ai = (ops.ai || 0) + 1;
    if (model.includes("m2m100")) return { translated_text: "[" + input.target_lang + "] " + input.text };
    const sys = input.messages[0].content, user = input.messages[1].content;
    const text = Array.isArray(user) ? user.map((c) => c.text || (c.image_url ? "[image " + c.image_url.url.length + " chars]" : "")).join(" ") : user;
    const say = (content) => ({ choices: [{ message: { role: "assistant", content } }] });
    if (/"en": "the reply/.test(sys)) return say(JSON.stringify({ en: "Thanks for your message. We'll confirm shortly.", vi: "Cảm ơn bạn đã nhắn. Chúng tôi sẽ xác nhận sớm." }));
    if (/"patient"/.test(sys)) { const m = text.match(/\b(Mr|Mrs|Ms)\.? [A-Z][a-z]+/); return say(JSON.stringify({ patient: !!m, found: m ? m[0] : "" })); }
    if (/turn them into form fields/.test(sys)) return say("```json\n" + JSON.stringify({ service: /implant/i.test(text) ? "Implant restorations" : "Crown & bridge",
      teeth: (text.match(/\b\d{2}(?:\s*,\s*\d{2})*/) || [""])[0], numbering: "FDI", material: /e\.?max/i.test(text) ? "e.max" : "", shade: (text.match(/\b[A-D][1-4]\b/) || [""])[0],
      neededBy: "", notes: "Cement gap 0.05 mm.", rx: { retention: "Screw-retained crown", restoration: "Full contour", implant_system: "Brand Z RP" } }) + "\n```");
    if (/Tóm tắt|TÓM TẮT/.test(sys)) return say("TÓM TẮT:\n- Ca mẫu\nYÊU CẦU THIẾT KẾ:\n- " + text.split("\n")[0] + "\nCẦN HỎI LẠI:\n- Không có");
    const to = /into Vietnamese/.test(sys) ? "vi" : "en";
    return say("[" + to + "] " + text);
  },
};
// ---- D1 mock (order book) on SQLite (node:sqlite). Set NO_DB=1 to run without a database.
// Like D1 it refuses undefined values and counts queries: more than 50 in one request fails, as on the free plan
// (each statement of a batch counted, to stay on the safe side).
import { DatabaseSync } from "node:sqlite";
const sdb = new DatabaseSync(":memory:");
const D1_LIMIT = 50;
function d1(counter) {
  const norm = (args) => args.map((v) => {
    if (v === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
    return typeof v === "boolean" ? (v ? 1 : 0) : v;
  });
  const tick = (n = 1) => { counter.n += n; ops.d1 = (ops.d1 || 0) + n; if (counter.n > D1_LIMIT) throw new Error("D1: too many queries in one request (" + counter.n + ")"); };
  const exec1 = (sql, args) => {
    const st = sdb.prepare(sql), a = norm(args);
    if (/^\s*(SELECT|WITH|PRAGMA|VALUES)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
      const results = st.all(...a).map((r) => ({ ...r }));
      return { results, success: true, meta: { changes: 0, rows_read: results.length } };
    }
    const info = st.run(...a);
    return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  };
  class Stmt {
    constructor(sql, args) { this.sql = sql; this.args = args || []; }
    bind(...a) { return new Stmt(this.sql, a); }
    async all() { tick(); return exec1(this.sql, this.args); }
    async run() { tick(); return exec1(this.sql, this.args); }
    async first(col) { tick(); const r = exec1(this.sql, this.args).results[0]; return r === undefined ? null : col ? r[col] : r; }
    async raw() { tick(); return exec1(this.sql, this.args).results.map((r) => Object.values(r)); }
  }
  return {
    prepare: (sql) => new Stmt(sql),
    async batch(list) {
      tick(list.length);
      sdb.exec("BEGIN");
      try { const out = list.map((st) => exec1(st.sql, st.args)); sdb.exec("COMMIT"); return out; }
      catch (e) { sdb.exec("ROLLBACK"); throw e; }
    },
    async exec(sql) { tick(); sdb.exec(sql); return { count: 1 }; },
  };
}
// ---- R2 mock (case files): set R2=1 to store case files in a bucket instead of KV
const r2 = new Map();
const FILES = {
  async put(k, v) { r2.set(k, await toBuffer(v)); return {}; },
  async get(k) { const b = r2.get(k); return b ? { body: new Response(b).body } : null; },
  async head(k) { return r2.has(k) ? { key: k, size: r2.get(k).length } : null; },
  async delete(k) { r2.delete(k); },
};
// ---- PayPal / Stripe mocks: PAY=1 (both), PAY=paypal or PAY=stripe (one provider)
const PAY = process.env.PAY || "";
const payEnv = {
  ...(PAY === "1" || PAY === "paypal" ? { PAYPAL_CLIENT_ID: "test-client", PAYPAL_CLIENT_SECRET: "test-secret", PAYPAL_API: `http://localhost:${PORT}/__mock/paypal` } : {}),
  ...(PAY === "1" || PAY === "stripe" ? { STRIPE_SECRET_KEY: "sk_test_mock", STRIPE_API: `http://localhost:${PORT}/__mock/stripe` } : {}),
};
const ppOrders = new Map(), stSessions = new Map();
const rid = (p) => p + crypto.randomBytes(6).toString("hex").toUpperCase();
function sendJson(res, status, obj) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); }
function redirect(res, to) { res.writeHead(302, { Location: to }); res.end(); }
async function payMock(req, res) {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  ops.pay = (ops.pay || 0) + 1;
  // PayPal
  if (p === "/__mock/paypal/v1/oauth2/token") {
    if (req.headers.authorization !== "Basic " + Buffer.from("test-client:test-secret").toString("base64")) return sendJson(res, 401, { error: "invalid_client" });
    return sendJson(res, 200, { access_token: "A21-test", expires_in: 32400 });
  }
  if (p.startsWith("/__mock/paypal/v2/") && req.headers.authorization !== "Bearer A21-test") return sendJson(res, 401, { name: "AUTHENTICATION_FAILURE" });
  if (p === "/__mock/paypal/v2/checkout/orders" && req.method === "POST") {
    const b = JSON.parse(raw), ctx = b.payment_source.paypal.experience_context, id = rid("PP");
    ppOrders.set(id, { id, intent: b.intent, status: "PAYER_ACTION_REQUIRED", purchase_units: b.purchase_units.map((x) => ({ ...x })), ret: ctx.return_url, cancel: ctx.cancel_url });
    return sendJson(res, 200, { id, status: "PAYER_ACTION_REQUIRED", links: [{ rel: "self", href: "x" }, { rel: "payer-action", href: `http://localhost:${PORT}/__mock/paypal/checkout?token=${id}` }] });
  }
  if (p === "/__mock/paypal/checkout") {
    const o = ppOrders.get(u.searchParams.get("token")); if (!o) return sendJson(res, 404, {});
    const act = u.searchParams.get("act") || "approve";
    if (act === "cancel") return redirect(res, o.cancel + "&token=" + o.id);
    o.status = "APPROVED"; o.pending = act === "pending";
    return redirect(res, o.ret + "&token=" + o.id + "&PayerID=TESTPAYER");
  }
  if (p === "/__mock/paypal/tamper") { const o = ppOrders.get(u.searchParams.get("token")); o.purchase_units[0].amount.value = u.searchParams.get("value"); return sendJson(res, 200, {}); }
  let m;
  if ((m = p.match(/^\/__mock\/paypal\/v2\/checkout\/orders\/(\w+)(\/capture)?$/))) {
    const o = ppOrders.get(m[1]);
    if (!o) return sendJson(res, 404, { name: "RESOURCE_NOT_FOUND" });
    const view = () => ({ id: o.id, status: o.status, purchase_units: o.purchase_units });
    if (!m[2]) return sendJson(res, 200, view());
    if (o.status === "COMPLETED") return sendJson(res, 422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] });
    if (o.status !== "APPROVED") return sendJson(res, 422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }] });
    o.status = "COMPLETED";
    const pu = o.purchase_units[0];
    pu.payments = { captures: [{ id: rid("CAP"), status: o.pending ? "PENDING" : "COMPLETED", amount: { ...pu.amount }, custom_id: pu.custom_id }] };
    return sendJson(res, 201, view());
  }
  // Stripe
  if (p.startsWith("/__mock/stripe/v1/") && req.headers.authorization !== "Bearer sk_test_mock") return sendJson(res, 401, { error: { message: "Invalid API Key" } });
  if (p === "/__mock/stripe/v1/checkout/sessions" && req.method === "POST") {
    const f = new URLSearchParams(raw), id = rid("cs_test_");
    stSessions.set(id, { id, object: "checkout.session", status: "open", payment_status: "unpaid", currency: f.get("line_items[0][price_data][currency]"),
      amount_total: +f.get("line_items[0][price_data][unit_amount]") * +f.get("line_items[0][quantity]"), client_reference_id: f.get("client_reference_id"),
      customer_email: f.get("customer_email"), success_url: f.get("success_url"), cancel_url: f.get("cancel_url"), payment_intent: null,
      url: `http://localhost:${PORT}/__mock/stripe/pay?sid=${id}`, metadata: { case: f.get("metadata[case]") } });
    return sendJson(res, 200, stSessions.get(id));
  }
  if (p === "/__mock/stripe/pay") {
    const s = stSessions.get(u.searchParams.get("sid")); if (!s) return sendJson(res, 404, {});
    if (u.searchParams.get("act") === "cancel") return redirect(res, s.cancel_url);
    s.status = "complete"; s.payment_status = "paid"; s.payment_intent = rid("pi_");
    return redirect(res, s.success_url.replace("{CHECKOUT_SESSION_ID}", s.id));
  }
  if (p === "/__mock/stripe/tamper") { const s = stSessions.get(u.searchParams.get("sid")); s.amount_total = +u.searchParams.get("amount"); return sendJson(res, 200, {}); }
  if ((m = p.match(/^\/__mock\/stripe\/v1\/checkout\/sessions\/(\w+)$/))) {
    const s = stSessions.get(m[1]); return s ? sendJson(res, 200, s) : sendJson(res, 404, { error: { message: "No such checkout.session" } });
  }
  return sendJson(res, 404, { error: "mock: not found" });
}
const env = { CASES: KV, ASSETS, UPLOAD_PASSWORD: PASSWORD, GOOGLE_CLIENT_ID: TEST_CLIENT_ID, GOOGLE_JWKS_URL: `http://localhost:${PORT}/__test/jwks` , ...(process.env.NO_AI ? {} : { AI }), ...(process.env.R2 ? { FILES } : {}), ...payEnv };

http.createServer(async (req, res) => {
  if (req.url.startsWith("/__test/sql?")) { // test hook: read-only look into the database
    const q = new URL(req.url, "http://x").searchParams.get("q") || "";
    try { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(/^\s*select/i.test(q) ? sdb.prepare(q).all().map((r) => ({ ...r })) : [])); }
    catch (e) { res.writeHead(400); res.end(String(e)); }
    return;
  }
  if (req.url === "/__test/ops") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(ops)); for (const k in ops) ops[k] = 0; return; }
  if (req.url.startsWith("/__mock/")) return payMock(req, res);
  if (req.url === "/__test/jwks") { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "max-age=3600" }); res.end(JSON.stringify(jwks)); return; }
  const tk = req.url.match(/^\/__test\/idtoken\?email=([^&]+)&name=(.*)$/);
  if (tk) { res.end(fakeIdToken(decodeURIComponent(tk[1]), decodeURIComponent(tk[2]))); return; }
  // test hook: force a case to look expired
  const m = req.url.match(/^\/__test\/expire\/(\w+)$/);
  if (m) {
    for (const k of ["case:" + m[1], "meta:" + m[1]]) {
      const r = store.get(k); if (r) { r.metadata = { ...r.metadata, e: Date.now() - 1000 }; if (k.startsWith("meta:")) r.buf = Buffer.from(JSON.stringify(r.metadata)); }
    }
    res.end("ok"); return;
  }
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body, duplex: "half",
  });
  try {
    const out = await worker.fetch(request, process.env.NO_DB ? env : { ...env, DB: d1({ n: 0 }) }, {});
    const headers = {}; out.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(out.status, headers);
    if (out.body && req.method !== "HEAD") { for await (const c of out.body) res.write(c); }
    res.end();
  } catch (e) { console.error(e); res.writeHead(500); res.end(String(e)); }
}).listen(PORT, () => console.log("listening", PORT));
