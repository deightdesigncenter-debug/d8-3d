// "Chép file cũ sang R2" (Settings): case files still in KV move into the R2 bucket under the same keys; the file
// record says "r2" with no expiry; a file whose parts KV has already dropped is marked "kv-lost" and left alone.
// Needs the bucket: run with R2=1 (run.sh does):  R2=1 PAY=1 node dev/server.mjs public 8788 mat-khau-thu
import { B, ok, done, signin, uniq } from "./lib.mjs";

const OWNER = "d.eightdesigncenter@gmail.com";
const sql = async (q) => (await fetch(B + "/__test/sql?q=" + encodeURIComponent(q))).json();
const exec = async (q, params = []) => (await fetch(B + "/__test/exec", { method: "POST", body: JSON.stringify({ sql: q, params }) })).json();
const seedKv = (key, value) => fetch(B + "/__test/kv", { method: "POST", body: JSON.stringify({ key, value }) });

const owner = await signin(OWNER, "Danny Do");
const cust = await signin(uniq("kvc") + "@lab.example", "Lab KV");

// a case with two files: the upload writes them to R2, as it does now
let r = await cust("/api/my/jobs", { method: "POST", body: { title: "Ca file KV", service: "Crown & bridge" } });
ok(r.status === 201, "a case is created");
const id = r.data.job.id;
const fidA = "Kvcopy0001", fidB = "Kvcopy0002";
for (const [fid, name, text] of [[fidA, "a.stl", "r2 original A"], [fidB, "b.stl", "r2 original B"]]) {
  r = await fetch(`${B}/api/jobs/${id}/files/${fid}/0`, { method: "PUT", headers: { ...cust.headers, "Content-Type": "application/octet-stream" }, body: text });
  ok(r.status === 200, `customer uploads a part of ${name}`);
  r = await cust(`/api/jobs/${id}/files`, { method: "POST", body: { files: [{ fid, name, size: text.length, stored: text.length, parts: 1, gz: 0 }] } });
  ok(r.status === 200, `${name} is listed on the case`);
}

// the state the old site left: both files are recorded as KV-stored, only file A's part is still in KV
const set = await exec(`UPDATE jobs SET doc = REPLACE(doc, '"st":"r2"', '"st":"kv"') WHERE id = ?`, [id]);
ok(set.changes === 1, "the case is recorded with its files in KV");
await seedKv(`jf:${id}:${fidA}:0`, "kv copy A");

r = await owner("/api/settings");
ok(r.data.files.store === "r2" && r.data.cases.kvCases >= 1, "settings: files go to R2, and the cases with files still in KV are counted", JSON.stringify(r.data.cases));

r = await cust("/api/settings/files", { method: "POST", body: {} });
ok(r.status !== 200, "a customer cannot start the copy");

r = await owner("/api/settings/files", { method: "POST", body: {} });
ok(r.status === 200 && r.data.copied >= 1, "the copy moves file A into R2", JSON.stringify(r.data));
ok(Array.isArray(r.data.lost) && r.data.lost.includes("b.stl"), "file B, which KV no longer has, is reported as lost");

const dl = await fetch(`${B}/api/jobs/${id}/files/${fidA}`, { headers: owner.headers });
ok(dl.status === 200 && (await dl.text()) === "kv copy A", "file A now downloads the bytes that were in KV");

const row = JSON.parse((await sql(`SELECT doc FROM jobs WHERE id = '${id}'`))[0].doc);
const fa = row.files.find((f) => f.fid === fidA), fb = row.files.find((f) => f.fid === fidB);
ok(fa.st === "r2" && fa.exp === 0, "file A is recorded in R2 with no expiry");
ok(fb.st === "kv-lost", "file B is recorded as kv-lost, so it is not tried again");

r = await owner("/api/settings/files", { method: "POST", body: {} });
ok(r.status === 200 && r.data.copied === 0 && r.data.lost.length === 0 && r.data.left === 0, "a second call has nothing left to copy", JSON.stringify(r.data));
r = await owner("/api/settings");
ok(r.data.cases.kvCases === 0, "settings: no case has files in KV any more");
done();
