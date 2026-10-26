// Free revisions (the owner sets the usual number in Settings and can change it per case) and how long case files
// are kept (R2: with the case; KV: 60 days), including what the legal pages say. Runs with and without R2 (R2=1).
import { B, ok, done, signin, uniq } from "./lib.mjs";

const OWNER = "d.eightdesigncenter@gmail.com";
const owner = await signin(OWNER, "D.EIGHT");
const cust = await signin(uniq("rev") + "@lab.example", "Rev Lab");
const ktvEmail = uniq("ktv") + "@d8.example";
const ktv = await signin(ktvEmail, "KTV Rev");
const cfg = async () => (await fetch(B + "/api/config")).json();

// ---------- the usual number: owner only, 0–20, public in /api/config
let r = await owner("/api/settings");
ok(r.status === 200 && r.data.settings.freeRevisions === 2, "usual free revisions start at 2");
const r2 = (await cfg()).fileStore === "r2";
ok(r.data.files && r.data.files.store === (r2 ? "r2" : "kv") && r.data.files.keepDays === 60, "settings report where files are kept (" + (r2 ? "R2" : "KV") + ")");
ok((await cfg()).freeRevisions === 2, "/api/config shares the usual number");
r = await owner("/api/settings", { method: "POST", body: { freeRevisions: 3 } });
ok(r.status === 200 && r.data.settings.freeRevisions === 3, "owner sets 3");
ok((await cfg()).freeRevisions === 3, "/api/config follows at once");
for (const bad of [25, -1, 1.5, "x"]) {
  r = await owner("/api/settings", { method: "POST", body: { freeRevisions: bad } });
  ok(r.status === 400, "rejects " + JSON.stringify(bad));
}
r = await cust("/api/settings", { method: "POST", body: { freeRevisions: 9 } });
ok(r.status === 403, "a customer cannot change it");

// ---------- per case
r = await owner("/api/staff", { method: "POST", body: { email: ktvEmail, role: "designer" } });
ok(r.status === 200, "designer added");
r = await cust("/api/my/jobs", { method: "POST", body: { title: "Rev case", service: "Crown & bridge", teeth: "11" } });
const j = r.data.job;
ok(r.status === 201 && j.rev && j.rev.free === 3 && j.rev.used === 0 && !j.rev.custom, "new case shows the usual number to the customer");
ok(!("revFree" in j) && !("revUsed" in j), "raw fields stay internal");
r = await cust(`/api/jobs/${j.id}/revisions`, { method: "POST", body: { free: 9 } });
ok(r.status === 404 || r.status === 403, "customer cannot change their free revisions (" + r.status + ")");
r = await owner(`/api/jobs/${j.id}/assign`, { method: "POST", body: { designer: ktvEmail } });
r = await ktv(`/api/jobs/${j.id}/revisions`, { method: "POST", body: { free: 9 } });
ok(r.status === 403, "a designer cannot change them either (" + r.status + ")");
r = await owner(`/api/jobs/${j.id}/revisions`, { method: "POST", body: { free: 1 } });
ok(r.status === 200 && r.data.job.rev.free === 1 && r.data.job.rev.custom, "owner gives this case 1 free revision");
ok((r.data.job.team || []).some((n) => n.kind === "rev"), "the change is noted for the team");
r = await owner(`/api/jobs/${j.id}/revisions`, { method: "POST", body: { free: 50 } });
ok(r.status === 400, "per-case number is checked too");
// sent back from review to design = one revision used
await owner(`/api/jobs/${j.id}/status`, { method: "POST", body: { status: "review" } });
r = await owner(`/api/jobs/${j.id}/status`, { method: "POST", body: { status: "in_design" } });
ok(r.data.job.rev.used === 1, "review → design counts one revision");
await owner(`/api/jobs/${j.id}/status`, { method: "POST", body: { status: "approved" } });
r = await owner(`/api/jobs/${j.id}/status`, { method: "POST", body: { status: "in_design" } });
ok(r.data.job.rev.used === 1, "other moves back to design do not count");
r = await cust(`/api/jobs/${j.id}`);
ok(r.data.job.rev.free === 1 && r.data.job.rev.used === 1, "customer sees 1 of 1 used");
r = await owner(`/api/jobs/${j.id}/revisions`, { method: "POST", body: { free: null, used: 0 } });
ok(r.data.job.rev.free === 3 && !r.data.job.rev.custom && r.data.job.rev.used === 0, "back to the usual number, count reset");

// ---------- files: kept with the case in R2, 60 days in KV
const fid = "Rv" + Math.random().toString(36).slice(2, 10).padEnd(8, "x").slice(0, 8);
r = await fetch(`${B}/api/jobs/${j.id}/files/${fid}/0`, { method: "PUT", headers: { ...cust.headers, "Content-Type": "application/octet-stream" }, body: "solid scan\nendsolid" });
ok(r.status === 200, "customer uploads a scan part");
r = await cust(`/api/jobs/${j.id}/files`, { method: "POST", body: { files: [{ fid, name: "upper.stl", size: 20, stored: 20, parts: 1, gz: 0 }] } });
const f = (r.data.job.files || []).find((x) => x.fid === fid);
ok(f && (r2 ? f.exp === 0 && f.st === "r2" : f.exp > Date.now() + 59 * 864e5 && f.st === "kv"), r2 ? "R2: file kept with the case (no expiry)" : "KV: file expires in 60 days");
r = await cust(`/api/jobs/${j.id}/files/${fid}`);
ok(r.status === 200 || r.status === 0, "file downloads");

// ---------- the legal pages say the same
for (const page of ["/privacy", "/terms"]) {
  const html = await (await fetch(B + page)).text();
  const sixty = /60 days after upload/.test(html), kept = /kept with (the|each) case/.test(html);
  ok(!html.includes("<!--store:") && (r2 ? kept && !sixty : sixty && !kept), page + ": file keeping matches the storage in use");
}
const terms = await (await fetch(B + "/terms")).text();
ok(/<span class="rev-n">2<\/span> as standard/.test(terms), "terms carry the usual number (filled in from Settings in the browser)");

// leave the usual number as the other suites expect it
r = await owner("/api/settings", { method: "POST", body: { freeRevisions: 2 } });
ok(r.data.settings.freeRevisions === 2, "usual number back to 2");
done();
