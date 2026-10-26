// Portal cases saved in Workers KV by the site before 2026-10-26 move into D1 by themselves: every list shows them,
// they open with their messages, notes and files, and from then on are saved in D1 (version-checked).
// Needs a fresh emulator with the database (nothing listed yet):  PAY=1 node dev/server.mjs public 8788 mat-khau-thu
import { B, ok, done, signin, uniq } from "./lib.mjs";

const OWNER = "d.eightdesigncenter@gmail.com";
const sql = async (q) => (await fetch(B + "/__test/sql?q=" + encodeURIComponent(q))).json();
const ops = async () => (await fetch(B + "/__test/ops")).json();
const seed = (key, value, metadata) => fetch(B + "/__test/kv", { method: "POST", body: JSON.stringify({ key, value, metadata }) });
const meta = (j) => ({ o: j.owner, t: j.title.slice(0, 60), s: j.status, c: j.created, u: j.updated, lb: j.lastBy, sz: 0, sv: j.service, on: j.ownerName, tr: 0,
  p: j.price, py: j.pay, d: j.designer || "", q: j.qcBy || "", g: j.stage || "", oc: "", oi: 0 });

const owner = await signin(OWNER, "Danny Do");
const ktvE = uniq("ktvm") + "@d8.example", labAE = uniq("olda") + "@lab.example", labBE = uniq("oldb") + "@lab.example";
await owner("/api/staff", { method: "POST", body: { email: ktvE, role: "designer" } });
const ktv = await signin(ktvE, "KTV Cũ");
const labA = await signin(labAE, "Old Lab A"), labB = await signin(labBE, "Old Lab B");

// four cases as the old site kept them: job:<id> with list metadata, own:<email>, file parts jf:<case>:<file>:<n>
const day = Date.now() - 20 * 86400000;
const ymd = new Date(day).toISOString().slice(2, 10).replace(/-/g, "");
const ids = ["AB2C", "AB3D", "AB4E", "AB5F"].map((x) => `D8-${ymd}-${x}`);
const old = ids.map((id, i) => ({
  id, owner: i < 3 ? labAE : labBE, ownerName: i < 3 ? "Old Lab A" : "Old Lab B", title: "Ca cũ " + (i + 1), service: "Crown & bridge", teeth: String(21 + i), numbering: "FDI",
  material: "", shade: "", neededBy: "", notes: "", links: [], rx: {}, status: i === 0 ? "in_design" : "received", created: day + i * 1000, updated: day + i * 1000, lastBy: "client", approvedAt: 0,
  files: i === 0 ? [{ fid: "OldScan001", name: "old-scan.stl", size: 16, stored: 16, parts: 1, gz: 0, st: "kv", kind: "input", at: day, exp: Date.now() + 40 * 86400000 }] : [],
  previews: [], thread: [{ by: "client", name: "Old Lab", text: "Old message " + (i + 1), at: day + 5 }], price: null, pay: "",
  ...(i === 0 ? { designer: ktvE, qcBy: "", stage: "design", team: [{ by: OWNER, name: "Danny Do", text: "Ghi chú cũ", at: day + 9, kind: "note" }] } : {}),
}));
for (const j of old) await seed("job:" + j.id, JSON.stringify(j), meta(j));
await seed("own:" + labAE, JSON.stringify(ids.slice(0, 3)));
await seed("own:" + labBE, JSON.stringify(ids.slice(3)));
await seed(`jf:${ids[0]}:OldScan001:0`, "solid old\nendsolid", { s: 16 });
await ops();

// the first list copies them into D1
let r = await owner("/api/admin/jobs");
ok(r.status === 200 && ids.every((id) => r.data.items.some((x) => x.id === id)), "the workspace lists the 4 old cases");
const row = r.data.items.find((x) => x.id === ids[0]);
ok(row && row.designer === ktvE && row.stage === "design" && row.title === "Ca cũ 1", "list fields come over (KTV, step, title)");
let d = await sql("SELECT id, ver, owner FROM jobs WHERE id IN ('" + ids.join("','") + "')");
ok(d.length === 4 && d.every((x) => x.ver === 1), "the 4 cases are now in D1", JSON.stringify(d));
r = await labA("/api/my/jobs");
ok(r.data.items.filter((x) => ids.includes(x.id)).length === 3, "lab A still sees its 3 old cases");
r = await labB("/api/my/jobs");
ok(r.data.items.filter((x) => ids.includes(x.id)).length === 1, "lab B still sees its 1 old case");
r = await ktv("/api/admin/jobs");
ok(r.data.items.length === 1 && r.data.items[0].id === ids[0], "the KTV sees only the old case assigned to them");
let o = await ops();
r = await owner("/api/admin/jobs");
o = await ops();
ok(o.list === 0, "once copied, lists use no KV list calls (" + o.list + ")");

// an old case opens with everything it had; the file downloads
r = await labA("/api/jobs/" + ids[0]);
ok(r.status === 200 && r.data.job.thread.some((m) => m.text === "Old message 1") && r.data.job.files.some((f) => f.fid === "OldScan001"), "old case opens with its message and file");
const dl = await fetch(`${B}/api/jobs/${ids[0]}/files/OldScan001`, { headers: labA.headers });
ok(dl.status === 200 && (await dl.text()).includes("solid old"), "the old file still downloads");
r = await owner("/api/jobs/" + ids[0]);
ok(r.data.job.team.some((n) => n.text === "Ghi chú cũ"), "old team notes are kept");
r = await labB("/api/jobs/" + ids[0]);
ok(r.status === 404, "another lab still cannot open it");

// new work on an old case is saved in D1 (the KV copy stays as it was, a backup of the day of the move)
r = await labA(`/api/jobs/${ids[0]}/messages`, { method: "POST", body: { text: "New message after the move" } });
ok(r.status === 200, "customer writes on an old case");
d = await sql(`SELECT ver FROM jobs WHERE id = '${ids[0]}'`);
ok(d[0].ver === 2, "the save went to D1 (version 2)");
const kvCopy = await (await fetch(B + "/__test/kv?key=" + encodeURIComponent("job:" + ids[0]))).text();
ok(kvCopy.includes("Old message 1") && !kvCopy.includes("after the move"), "the KV copy is left untouched");

// ten people saving the same case at the same moment: all ten changes are kept
r = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? owner(`/api/jobs/${ids[1]}/team`, { method: "POST", body: { text: "note " + i } })
  : labA(`/api/jobs/${ids[1]}/messages`, { method: "POST", body: { text: "msg " + i } }))));
ok(r.every((x) => x.status === 200), "10 saves of one case at once all succeed", r.map((x) => x.status).join(","));
r = await owner("/api/jobs/" + ids[1]);
const texts = [...r.data.job.thread.map((m) => m.text), ...r.data.job.team.map((n) => n.text)];
ok(Array.from({ length: 10 }, (_, i) => (i % 2 ? "note " : "msg ") + i).every((t) => texts.includes(t)), "all 10 changes are on the case");

// a case left in KV after the copy (e.g. written by the old site during the deploy) is copied when it is opened
const late = { ...old[3], id: `D8-${ymd}-AB6G`, title: "Ca cũ muộn", thread: [] };
await seed("job:" + late.id, JSON.stringify(late), meta(late));
r = await labB("/api/jobs/" + late.id);
ok(r.status === 200 && r.data.job.title === "Ca cũ muộn", "a late old case opens");
d = await sql(`SELECT id FROM jobs WHERE id = '${late.id}'`);
ok(d.length === 1, "and is copied into D1 then");

// a new case goes straight to D1, never to KV
r = await labA("/api/my/jobs", { method: "POST", body: { title: "Ca mới", service: "Crown & bridge" } });
ok(r.status === 201 && r.data.job.order, "a new case is created, with its order code");
d = await sql(`SELECT id FROM jobs WHERE id = '${r.data.job.id}'`);
const kvNew = await fetch(B + "/__test/kv?key=" + encodeURIComponent("job:" + r.data.job.id));
ok(d.length === 1 && kvNew.status === 404, "it is saved in D1 only");
r = await labA("/api/my/jobs");
ok(r.data.items.filter((x) => ids.includes(x.id)).length === 3 && r.data.items.some((x) => x.title === "Ca mới"), "lab A's list: old cases and the new one");

// during the deploy a request still served by the old site may save a case to KV after it was copied: for 15 minutes
// the check runs once a minute and takes the newer KV copy, unless the case has been saved in D1 since the copy
await new Promise((res) => setTimeout(res, 61000));
const bumped = (j, title) => ({ ...j, title, updated: Date.now() });
await seed("job:" + ids[2], JSON.stringify(bumped(old[2], "Ca cũ 3 (sửa lúc deploy)")), meta(bumped(old[2], "Ca cũ 3 (sửa lúc deploy)")));
await seed("job:" + ids[0], JSON.stringify(bumped(old[0], "Không được ghi đè")), meta(bumped(old[0], "Không được ghi đè")));
r = await owner("/api/admin/jobs");
ok(r.data.items.find((x) => x.id === ids[2]).title === "Ca cũ 3 (sửa lúc deploy)", "a newer KV copy of a case untouched in D1 wins");
r = await owner("/api/jobs/" + ids[0]);
ok(r.data.job.title === "Ca cũ 1" && r.data.job.thread.some((m) => /after the move/.test(m.text)), "a case already saved in D1 is never overwritten by KV");

// Settings shows where the cases are
r = await owner("/api/settings");
ok(r.data.cases && r.data.cases.store === "d1" && r.data.cases.count >= 6 && !r.data.cases.left, "Settings: cases in D1, none left in KV", JSON.stringify(r.data.cases));
done();
