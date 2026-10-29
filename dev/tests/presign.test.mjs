// Direct upload to R2: the Worker signs one URL per part (SigV4, 1 hour, the part's exact size). Run with
// R2=1 R2_KEYS=1 for the signed case, and without R2_KEYS for the case where the parts go through the Worker (urls: null).
import { B, ok, done, signin, uniq } from "./lib.mjs";
import { sigv4Presign } from "../../public/_worker.js";

const KEYS = !!process.env.R2_KEYS;
const SECRET = "test-secret-key", ACCESS = "test-access-key", ACCOUNT = "0123456789abcdef0123456789abcdef";
const CHUNK = 20 * 1024 * 1024;
const owner = await signin("d.eightdesigncenter@gmail.com", "Danny Do");
const cust = await signin(uniq("pre") + "@lab.example", "Lab Presign");
const other = await signin(uniq("pre2") + "@lab.example", "Other Presign");

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
  const key = `jf:${id}:${fid}:0`;
  ok(u0.startsWith(`https://${ACCOUNT}.r2.cloudflarestorage.com/d8-3d-files/jf%3A${id}%3A${fid}%3A0?`), "the URL names the bucket and the part's key");
  ok(u1.includes(`%3A${fid}%3A1?`), "the second part has its own key");
  ok(u0.includes("X-Amz-SignedHeaders=content-length%3Bhost") && u0.includes("X-Amz-Expires=3600"), "signs the content length and the host");
  // the signature covers the size: recompute it from the URL and the size asked for
  const check = async (u, size, k) => {
    const url = new URL(u), q = url.searchParams;
    const want = await sigv4Presign({ method: "PUT", host: url.host, path: url.pathname, headers: { host: url.host, "content-length": String(size) },
      accessKey: ACCESS, secret: SECRET, region: "auto", service: "s3", date: new Date(q.get("X-Amz-Date").replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z")), expires: 3600 });
    return want.endsWith("X-Amz-Signature=" + q.get("X-Amz-Signature")) && q.get("X-Amz-Credential").startsWith(ACCESS + "/");
  };
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

done();
