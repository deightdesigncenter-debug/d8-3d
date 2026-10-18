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
const KV = {
  async put(key, value, opts = {}) {
    const buf = await toBuffer(value);
    if (buf.length > KV_MAX_VALUE) throw new Error("KV put failed: 413 Value length exceeds limit");
    if (opts.metadata && Buffer.byteLength(JSON.stringify(opts.metadata)) > KV_MAX_META) throw new Error("KV put failed: metadata too large");
    let expiration = opts.expiration;
    if (opts.expirationTtl) { if (opts.expirationTtl < 60) throw new Error("expirationTtl < 60"); expiration = Math.floor(Date.now()/1000) + opts.expirationTtl; }
    if (expiration && expiration * 1000 < Date.now() + 60000) throw new Error("KV put failed: expiration must be at least 60s in the future");
    store.set(key, { buf, metadata: opts.metadata ?? null, expiration, t: Date.now() });
  },
  async get(key, opt) {
    const type = typeof opt === "string" ? opt : opt?.type || "text";
    const rec = store.get(key);
    return alive(rec) ? asType(rec.buf, type) : null;
  },
  async getWithMetadata(key, opt) {
    const type = typeof opt === "string" ? opt : opt?.type || "text";
    const rec = store.get(key);
    return alive(rec) ? { value: asType(rec.buf, type), metadata: rec.metadata } : { value: null, metadata: null };
  },
  async list({ prefix = "", limit = 1000 } = {}) {
    const now = Date.now(); const all = [...store.entries(), ...[...tomb.entries()].filter(([, r]) => now - r.d < LAG_MS)];
    const keys = all.filter(([k, r]) => k.startsWith(prefix) && alive(r) && now - r.t >= LAG_MS).sort(([a],[b]) => a < b ? -1 : 1)
      .slice(0, limit).map(([name, r]) => ({ name, expiration: r.expiration, metadata: r.metadata }));
    return { keys, list_complete: true, cursor: "" };
  },
  async delete(key) { const r = store.get(key); if (r) tomb.set(key, { ...r, d: Date.now() }); store.delete(key); },
};

// ---- ASSETS mock (Pages static asset behaviour incl. .html stripping)
const TYPES = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".js": "text/javascript",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
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

const env = { CASES: KV, ASSETS, UPLOAD_PASSWORD: PASSWORD };

http.createServer(async (req, res) => {
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
    const out = await worker.fetch(request, env, {});
    const headers = {}; out.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(out.status, headers);
    if (out.body && req.method !== "HEAD") { for await (const c of out.body) res.write(c); }
    res.end();
  } catch (e) { console.error(e); res.writeHead(500); res.end(String(e)); }
}).listen(PORT, () => console.log("listening", PORT));
