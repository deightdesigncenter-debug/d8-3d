// Direct upload to R2: the Worker signs one URL per part (SigV4, 1 hour, the part's exact size). Run with
// R2=1 R2_KEYS=1 for the signed case, and without R2_KEYS for the case where the parts go through the Worker (urls: null).
// Covers case files and the team chat files of an order (the same parts under their own prefix).
import { B, ok, done, signin, uniq } from "./lib.mjs";
import { sigv4Presign } from "../../public/_worker.js";

const KEYS = !!process.env.R2_KEYS;
const SECRET = "test-secret-key", ACCESS = "test-access-key", ACCOUNT = "0123456789abcdef0123456789abcdef";
const CHUNK = 20 * 1024 * 1024;
const owner = await signin("d.eightdesigncenter@gmail.com", "Danny Do");
const cust = await signin(uniq("pre") + "@lab.example", "Lab Presign");
const other = await signin(uniq("pre2") + "@lab.example", "Other Presign");

// the signature covers the size: recompute it from the URL and the size asked for
const check = async (u, size) => {
  const url = new URL(u), q = url.searchParams;
  const want = await sigv4Presign({ method: "PUT", host: url.host, path: url.pathname, headers: { host: url.host, "content-length": String(size) },
    accessKey: ACCESS, secret: SECRET, region: "auto", service: "s3", date: new Date(q.get("X-Amz-Date").replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z")), expires: 3600 });
  return want.endsWith("X-Amz-Signature=" + q.get("X-Amz-Signature")) && q.get("X-Amz-Credential").startsWith(ACCESS + "/");
};

let r = await cust("/api/my/jobs", { method: "POST", body: { title: "", service: "Crown & bridge", teeth: "14" } });
ok(r.status === 201, "a case is created");
const id = r.data.job.id, fid = "Presign001";
const sizes = [1000, CHUNK];

r = await cust(`/api/jobs/${id}/files/presign`, { method: "POST", body: { fid, sizes } });
ok(r.status === 200, "customer asks for upload URLs");
if (!KEYS) {
  ok(r.data.urls === null, "without the R2 secrets the parts go through the Worker (urls: null)");
  r = await cust(`/api/jobs/${id}/files/presign`, { method: "POST", body: { fid, sizes: [1000] } });
  ok(r.status === 200 && r.data.urls === null, "same answer for any size");
} else {
  ok(Array.isArray(r.data.urls) && r.data.urls.length === 2, "one signed URL per part");
  ok(r.data.expires === 3600, "URLs last an hour");
  const [u0, u1] = r.data.urls;
  ok(u0.startsWith(`https://${ACCOUNT}.r2.cloudflarestorage.com/d8-3d-files/jf%3A${id}%3A${fid}%3A0?`), "the URL names the bucket and the part's key");
  ok(u1.includes(`%3A${fid}%3A1?`), "the second part has its own key");
  ok(u0.includes("X-Amz-SignedHeaders=content-length%3Bhost") && u0.includes("X-Amz-Expires=3600"), "signs the content length and the host");
  ok(await check(u0, 1000), "the signature of part 1 matches its size (1000 bytes)");
  ok(await check(u1, CHUNK), "the signature of part 2 matches its size (20 MB)");
  ok(!(await check(u0, 999)), "a part of another size would not match the signature");
}

// refusals: wrong people, closed cases, bad sizes
r = await other(`/api/jobs/${id}/files/presign`, { method: "POST", body: { fid, sizes } });
ok(r.status === 404, "another customer cannot ask for URLs on this case");
r = await cust(`/api/jobs/${id}/files/presign`, { method: "POST", body: { fid, sizes: [CHUNK + 1] } });
ok(r.status === 400, "a part bigger than 20 MB is refused");
r = await cust(`/api/jobs/${id}/files/presign`, { method: "POST", body: { fid, sizes: new Array(16).fill(1000) } });
ok(r.status === 400, "more than 15 parts is refused");
r = await cust(`/api/jobs/${id}/files/presign`, { method: "POST", body: { fid: "bad", sizes } });
ok(r.status === 400, "a bad file id is refused");
r = await owner(`/api/jobs/${id}/status`, { method: "POST", body: { status: "delivered" } });
r = await cust(`/api/jobs/${id}/files/presign`, { method: "POST", body: { fid, sizes } });
ok(r.status === 409, "a delivered case takes no new files");

// ---------- team chat files of an order: the same signed parts, under the order's own prefix (ofp:)
const day = new Date().toISOString().slice(0, 10);
const lab = await owner("/api/customers", { method: "POST", body: { code: uniq("PL").toUpperCase().slice(0, 10), name: "Presign Lab", kind: "doctor", country: "US", currency: "USD" } });
ok(lab.status === 200, "a customer for the order");
const ord = await owner("/api/orders", { method: "POST", body: { customer_id: lab.data.customer.id, received: day } });
ok(ord.status === 201, "an order is created");
const oid = ord.data.order.id, ofid = "OrdPre0001";
r = await owner(`/api/orders/${oid}/files/presign`, { method: "POST", body: { fid: ofid, sizes: [1000, CHUNK] } });
ok(r.status === 200, "team chat: staff ask for upload URLs");
if (!KEYS) ok(r.data.urls === null, "team chat: without the R2 secrets the parts go through the Worker (urls: null)");
else {
  ok(Array.isArray(r.data.urls) && r.data.urls.length === 2 && r.data.expires === 3600, "team chat: one signed URL per part, an hour");
  ok(r.data.urls[0].includes(`/d8-3d-files/ofp%3A${oid}%3A${ofid}%3A0?`), "team chat: the URL names the order's part key");
  ok((await check(r.data.urls[0], 1000)) && (await check(r.data.urls[1], CHUNK)), "team chat: each signature matches its part's size");
}
r = await other(`/api/orders/${oid}/files/presign`, { method: "POST", body: { fid: ofid, sizes: [1000] } });
ok(r.status === 403, "team chat: a customer is kept out of the staff area (no URLs)");
// a technician who is not on this order: not found, as for every order route
const ktv = uniq("pk") + "@lab.example";
await owner("/api/staff", { method: "POST", body: { email: ktv, role: "designer" } });
const outsiderKtv = await signin(ktv, "Presign KTV");
r = await outsiderKtv(`/api/orders/${oid}/files/presign`, { method: "POST", body: { fid: ofid, sizes: [1000] } });
ok(r.status === 404, "team chat: a technician not on the order gets no URLs");
r = await owner(`/api/orders/${oid}/files/presign`, { method: "POST", body: { fid: ofid, sizes: [CHUNK + 1] } });
ok(r.status === 400, "team chat: a part bigger than 20 MB is refused");
r = await owner(`/api/orders/${oid}/files/presign`, { method: "POST", body: { fid: "bad", sizes: [1000] } });
ok(r.status === 400, "team chat: a bad file id is refused");

// the file itself: parts through the Worker (the store the server reads), attached to the chat, downloaded byte for byte
const data = Buffer.alloc(3000, 7);
const put = await fetch(`${B}/api/orders/${oid}/files/${ofid}/0`, { method: "PUT", headers: { ...owner.headers, "Content-Type": "application/octet-stream" }, body: data });
ok(put.status === 200, "team chat: a part is stored");
r = await owner(`/api/orders/${oid}/files`, { method: "POST", body: { files: [{ fid: ofid, name: "crown.stl", size: data.length, stored: data.length, parts: 1, gz: 0 }], text: "presign test" } });
ok(r.status === 200 && r.data.files === 1, "team chat: the file is attached to a message");
const dl = await fetch(`${B}/api/orders/${oid}/files/${ofid}`, { headers: owner.headers });
ok(dl.status === 200 && Buffer.compare(Buffer.from(await dl.arrayBuffer()), data) === 0, "team chat: the file downloads byte for byte");

done();
