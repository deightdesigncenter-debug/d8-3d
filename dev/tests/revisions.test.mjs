// Free revisions: until the customer approves (the owner's rule, 2026-11-11, the default) or a usual number set in Settings;
// the owner can give one case its own number. Also what the public pages and the terms say in each mode, the proof the
// homepage may show (cases designed, customers' words), and how long case files are kept (R2: with the case; KV: 60 days).
// Runs with and without R2 (R2=1).
import { B, ok, done, signin, uniq } from "./lib.mjs";

const OWNER = "d.eightdesigncenter@gmail.com";
const owner = await signin(OWNER, "D.EIGHT");
const cust = await signin(uniq("rev") + "@lab.example", "Rev Lab");
const ktvEmail = uniq("ktv") + "@d8.example";
const ktv = await signin(ktvEmail, "KTV Rev");
const cfg = async () => (await fetch(B + "/api/config")).json();

const page = async (path) => (await fetch(B + path)).text();

// ---------- the default: revisions are free until the customer approves
let r = await owner("/api/settings");
ok(r.status === 200 && r.data.settings.revOpen === true && r.data.settings.freeRevisions === 2, "default: free until approval (the usual number 2 is kept for the other mode)");
ok((await cfg()).revOpen === true, "/api/config says revisions are open");
r = await cust("/api/my/jobs", { method: "POST", body: { title: "Open rev case", service: "Crown & bridge", teeth: "21" } });
const jo = r.data.job;
ok(r.status === 201 && jo.rev && jo.rev.open === true && !jo.rev.custom && jo.rev.used === 0, "new case: free until the customer approves");
let home = await page("/"), terms0 = await page("/terms");
ok(/Free revisions until you approve/.test(home) && /Revisions are free until you approve/.test(home) && !/rev:(open|count)/.test(home) && !/class="rev-n"/.test(home),
  "homepage: says free until approval, no fixed number, no leftover markers");
ok(/6–8 hours/.test(home) && /8–12/.test(home) && !/(in|within) 24 hours|24-hour/.test(home), "homepage: 6–8 hours for single cases, 8–12 for full-arch, nothing about 24 hours");
ok(/Revisions are free until you approve the design/.test(terms0) && /Chỉnh sửa miễn phí cho đến khi bạn duyệt thiết kế/.test(terms0) && !/rev:(open|count)/.test(terms0) && !/class="rev-n"/.test(terms0),
  "terms (EN and VI): free until approval");
ok(/within 6 to 8 hours/.test(terms0) && /within 8 to 12 hours/.test(terms0) && /trong vòng 6 đến 8 giờ/.test(terms0) && !/24 hours of receiving|vòng 24 giờ/.test(terms0), "terms: the new delivery times, in both languages");
// one case can still have its own number
r = await owner(`/api/jobs/${jo.id}/revisions`, { method: "POST", body: { free: 2 } });
ok(r.status === 200 && r.data.job.rev.free === 2 && r.data.job.rev.custom && r.data.job.rev.open === false, "owner limits this one case to 2");
r = await owner(`/api/jobs/${jo.id}/revisions`, { method: "POST", body: { free: null } });
ok(r.data.job.rev.open === true && !r.data.job.rev.custom, "limit removed: open again");

// ---------- the other mode: a usual number (owner only, 0–20, public in /api/config)
r = await owner("/api/settings", { method: "POST", body: { revOpen: false } });
ok(r.status === 200 && r.data.settings.revOpen === false && (await cfg()).revOpen === false, "owner switches to a fixed number");
home = await page("/"); terms0 = await page("/terms");
ok(/<span class="rev-n">2<\/span> free revisions before final export/.test(home) && !/until you approve/.test(home) && !/rev:(open|count)/.test(home), "homepage: the fixed-number wording, with the number");
ok(/<span class="rev-n">2<\/span> as standard/.test(terms0) && !/Revisions are free until you approve/.test(terms0) && !/rev:(open|count)/.test(terms0), "terms: the fixed-number wording");
r = await owner("/api/settings");
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
ok(r.status === 201 && j.rev && j.rev.free === 3 && j.rev.used === 0 && !j.rev.custom && j.rev.open === false, "new case shows the usual number to the customer");
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
const terms = await page("/terms");
ok(/<span class="rev-n">3<\/span> as standard/.test(terms), "terms carry the usual number set in Settings (written by the server)");

// leave the settings as the other suites expect them: free until approval, usual number 2
r = await owner("/api/settings", { method: "POST", body: { freeRevisions: 2, revOpen: true } });
ok(r.data.settings.freeRevisions === 2 && r.data.settings.revOpen === true, "back to free until approval");
r = await cust(`/api/jobs/${j.id}`);
ok(r.data.job.rev.open === true, "the same case is open again");

// ---------- proof on the homepage: cases designed and customers' own words (staff.manage; empty by default)
let c = await cfg();
ok(c.proof && c.proof.cases === 0 && Array.isArray(c.proof.quotes) && c.proof.quotes.length === 0, "no proof by default: the homepage section stays hidden");
r = await cust("/api/settings", { method: "POST", body: { proofCases: 5000, quotes: [{ text: "Great", who: "Me" }] } });
ok(r.status === 403 && (await cfg()).proof.cases === 0, "a customer cannot write the proof");
for (const bad of [-1, 2.5, "many", 2000000]) {
  r = await owner("/api/settings", { method: "POST", body: { proofCases: bad } });
  ok(r.status === 400, "cases designed: rejects " + JSON.stringify(bad));
}
r = await owner("/api/settings", { method: "POST", body: { quotes: [1, 2, 3, 4].map((n) => ({ text: "q" + n, who: "w" + n })) } });
ok(r.status === 400, "more than three quotes are refused");
r = await owner("/api/settings", { method: "POST", body: { quotes: "not a list" } });
ok(r.status === 400, "quotes must be a list");
r = await owner("/api/settings", { method: "POST", body: { proofCases: 1240, quotes: [
  { text: "  Fits first time.  ", who: "Dr A. Example", where: "Example Dental, Denver" }, { text: "no name" }, { text: "x".repeat(500), who: "Lab owner" }] } });
c = await cfg();
ok(r.status === 200 && c.proof.cases === 1240 && c.proof.quotes.length === 2, "owner sets the number and the quotes; a quote without a name is dropped");
ok(c.proof.quotes[0].text === "Fits first time." && c.proof.quotes[0].where === "Example Dental, Denver" && c.proof.quotes[1].text.length === 320, "quotes are trimmed and cut at 320 characters");
r = await owner("/api/settings", { method: "POST", body: { proofCases: 0, quotes: [] } });
ok((await cfg()).proof.cases === 0 && (await cfg()).proof.quotes.length === 0, "proof cleared again");
done();
