// Four designers (KTV) and one QC working at the same time: portal cases and the order book (both D1).
// Receive the customer's files, upload designs, mark done (send to QC) or not done, QC pass / fail with a note,
// fix and resend, deliver; privacy between KTVs; what each person's to-do list says; KV usage for the day.
// Run against an emulator that behaves like Cloudflare's network, or requests never overlap:
//   PAY=1 NET_MS=25 KV_EDGE_MS=60000 node dev/server.mjs public 8788 mat-khau-thu
// NET_MS: each KV / D1 call takes about that long. KV_EDGE_MS: KV copies cached per location (x-test-colo header).
// KV_RATE=1 (server and test): Workers KV refuses a second write to the same key within one second.
import { B, ok, done, signin, uniq } from "./lib.mjs";

const OWNER = "d.eightdesigncenter@gmail.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => Array.from({ length: 10 }, () => "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 56)]).join("");
const ops = async () => (await fetch(B + "/__test/ops")).json(); // KV operations since the last call (and reset)
const kvRate = !!process.env.KV_RATE;
const problems = [];
const check = (cond, msg, detail) => { ok(cond, msg); if (!cond) problems.push(msg + (detail ? " — " + detail : "")); };

const owner = await signin(OWNER, "Danny Do");
await ops();
const KTV = [1, 2, 3, 4].map((n) => ({ email: uniq("ktv" + n) + "@d8.example", name: "KTV " + n }));
const QCE = uniq("qc") + "@d8.example";
for (const k of KTV) { await owner("/api/staff", { method: "POST", body: { email: k.email, role: "designer" } }); await sleep(kvRate ? 1100 : 0); }
let r = await owner("/api/staff", { method: "POST", body: { email: QCE, role: "qc" } });
check(r.status === 200, "owner adds 4 designers and 1 QC");
for (const k of KTV) k.call = await signin(k.email, k.name);
const qc = await signin(QCE, "QC Lan");
const labs = [await signin(uniq("laba") + "@lab.example", "Lab A"), await signin(uniq("labb") + "@lab.example", "Lab B")];

// helper: upload a small file in one part, then attach it to the case
async function upload(who, jid, name, kind) {
  const fid = rid(), body = "solid " + name + "\nendsolid\n";
  const p = await fetch(`${B}/api/jobs/${jid}/files/${fid}/0`, { method: "PUT", headers: { ...who.headers, "Content-Type": "application/octet-stream" }, body });
  if (p.status !== 200) return { status: p.status, fid };
  const a = await who(`/api/jobs/${jid}/files`, { method: "POST", body: { files: [{ fid, name, size: body.length, stored: body.length, parts: 1, gz: 0 }], kind } });
  return { status: a.status, fid, job: a.data.job, error: a.data.error };
}
const statusLine = (rs) => rs.map((x) => x.status).join(",");

/* =============================== A. portal cases (customer → KTV → QC → customer) =============================== */
// 8 cases arrive at the same time (two labs, four each)
r = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map((i) => labs[i % 2]("/api/my/jobs", { method: "POST", body: { title: "Ca " + (i + 1), service: "Crown & bridge", teeth: String(11 + i) } })));
const jobs = r.map((x) => x.data.job).filter(Boolean);
check(r.every((x) => x.status === 201) && new Set(jobs.map((j) => j.id)).size === 8, "8 cases sent at the same moment all arrive", statusLine(r));
const orders0 = await Promise.all(jobs.map((j) => owner("/api/jobs/" + j.id)));
const codes0 = orders0.map((x) => x.data.job && x.data.job.order).filter(Boolean);
check(codes0.length === 8 && new Set(codes0).size === 8, "each case gets its own order code in the order book", codes0.join(" "));

r = await Promise.all(labs.map((l) => l("/api/my/jobs")));
check(r.every((x, n) => jobs.filter((_, i) => i % 2 === n).every((j) => x.data.items.some((it) => it.id === j.id))), "each lab's own list shows all 4 cases it sent",
  r.map((x) => (x.data.items || []).length).join(","));

// each lab uploads its scan
r = await Promise.all(jobs.map((j, i) => upload(labs[i % 2], j.id, "scan-" + (i + 1) + ".stl", "input")));
check(r.every((x) => x.status === 200), "customers upload their scans at the same time", statusLine(r));
const scans = r.map((x) => x.fid);

// owner assigns case i to KTV i % 4, all to the same QC
r = await Promise.all(jobs.map((j, i) => owner(`/api/jobs/${j.id}/assign`, { method: "POST", body: { designer: KTV[i % 4].email, qcBy: QCE } })));
check(r.every((x) => x.status === 200 && x.data.job.designer), "owner assigns 2 cases to each KTV", statusLine(r));
const mine = (k) => jobs.filter((_, i) => i % 4 === KTV.indexOf(k));

// every KTV sees exactly their own 2 cases, no price; cannot open another KTV's case
r = await Promise.all(KTV.map((k) => k.call("/api/admin/jobs")));
check(r.every((x, n) => x.status === 200 && x.data.items.length === 2 && x.data.items.every((it) => mine(KTV[n]).some((j) => j.id === it.id))), "each KTV lists only their own 2 cases",
  r.map((x) => (x.data.items || []).length).join(","));
check(r.every((x) => x.data.items.every((it) => it.price == null && !it.pay && !it.owner)), "KTV list has no price, payment or customer email");
r = await KTV[0].call("/api/jobs/" + mine(KTV[1])[0].id);
check(r.status === 404, "a KTV cannot open another KTV's case (" + r.status + ")");

// KTVs download the customer's scans
r = await Promise.all(jobs.map((j, i) => fetch(`${B}/api/jobs/${j.id}/files/${scans[i]}`, { headers: KTV[i % 4].call.headers })));
check(r.every((x) => x.status === 200), "each KTV downloads the scans of their cases", r.map((x) => x.status).join(","));

// "not done": sending to QC without a design file is refused
r = await KTV[0].call(`/api/jobs/${mine(KTV[0])[0].id}/stage`, { method: "POST", body: { action: "submit" } });
check(r.status === 409, "sending to QC without a design file is refused");

// the same case touched by three people at once: KTV attaches a design, customer writes, owner leaves a team note
const hot = jobs[0], hotKtv = KTV[0];
const hotFid = rid(), hotBody = "solid hot\nendsolid\n";
await fetch(`${B}/api/jobs/${hot.id}/files/${hotFid}/0`, { method: "PUT", headers: { ...hotKtv.call.headers, "Content-Type": "application/octet-stream" }, body: hotBody });
const [u1, m1, n1] = await Promise.all([
  hotKtv.call(`/api/jobs/${hot.id}/files`, { method: "POST", body: { files: [{ fid: hotFid, name: "ca1-design-v1.stl", size: hotBody.length, stored: hotBody.length, parts: 1 }], kind: "design" } }),
  labs[0](`/api/jobs/${hot.id}/messages`, { method: "POST", body: { text: "Please make 11 a bit longer." } }),
  owner(`/api/jobs/${hot.id}/team`, { method: "POST", body: { text: "Ưu tiên ca này" } }),
]);
r = await owner("/api/jobs/" + hot.id);
const hj = r.data.job;
const kept = { file: (hj.files || []).some((f) => f.fid === hotFid), msg: (hj.thread || []).some((m) => /a bit longer/.test(m.text || "")), note: (hj.team || []).some((n) => /Ưu tiên/.test(n.text || "")) };
check(u1.status === 200 && m1.status === 200 && n1.status === 200, "three people saving the same case at once all get OK", [u1.status, m1.status, n1.status].join(","));
check(kept.file && kept.msg && kept.note, "nothing is lost when three people save the same case at once", JSON.stringify(kept));
// a customer attaching two scans to one case at the same time (two browser tabs, or two quick uploads)
const twin = jobs[1], tf = [rid(), rid()];
for (const fid of tf) await fetch(`${B}/api/jobs/${twin.id}/files/${fid}/0`, { method: "PUT", headers: { ...labs[1].headers, "Content-Type": "application/octet-stream" }, body: "solid x\nendsolid\n" });
await Promise.all(tf.map((fid, i) => labs[1](`/api/jobs/${twin.id}/files`, { method: "POST", body: { files: [{ fid, name: "extra-" + i + ".stl", size: 18, stored: 18, parts: 1 }] } })));
r = await owner("/api/jobs/" + twin.id);
check(tf.every((fid) => r.data.job.files.some((f) => f.fid === fid)), "two files attached to one case at the same moment are both kept",
  tf.map((fid) => r.data.job.files.some((f) => f.fid === fid)).join(","));

// all KTVs upload their designs at the same time (cases other than the hot one)
const rest = jobs.slice(1);
r = await Promise.all(rest.map((j) => upload(KTV[jobs.indexOf(j) % 4].call, j.id, "design-" + j.title + ".stl", "design")));
check(r.every((x) => x.status === 200), "4 KTVs upload 7 designs at the same time", statusLine(r));

// "done": all 8 sent to QC at the same time
r = await Promise.all(jobs.map((j, i) => KTV[i % 4].call(`/api/jobs/${j.id}/stage`, { method: "POST", body: { action: "submit", note: "Xong" } })));
check(r.every((x) => x.status === 200 && x.data.job.stage === "qc"), "4 KTVs mark 8 cases done (sent to QC) at once", statusLine(r));
r = await qc("/api/admin/jobs");
check(r.data.items.filter((x) => jobs.some((j) => j.id === x.id) && x.stage === "qc").length === 8, "QC sees all 8 cases waiting");
r = await KTV[1].call(`/api/jobs/${mine(KTV[1])[0].id}/stage`, { method: "POST", body: { action: "pass" } });
check(r.status === 403, "a KTV cannot pass QC");
r = await qc(`/api/jobs/${jobs[1].id}/stage`, { method: "POST", body: { action: "fail", note: "" } });
check(r.status === 400, "QC must say what is wrong");

// QC fails one case per KTV and passes the other, all at once
const failSet = new Set(KTV.map((k) => mine(k)[0].id));
r = await Promise.all(jobs.map((j) => qc(`/api/jobs/${j.id}/stage`, { method: "POST", body: failSet.has(j.id) ? { action: "fail", note: "Tiếp xúc quá chặt ở " + j.teeth } : { action: "pass", note: "OK" } })));
check(r.every((x) => x.status === 200), "QC passes 4 and returns 4 at the same time", statusLine(r));
r = await Promise.all(KTV.map((k) => k.call("/api/jobs/" + mine(k)[0].id)));
check(r.every((x) => x.data.job.stage === "fix" && (x.data.job.team || []).some((n) => n.kind === "qc_fail" && /Tiếp xúc/.test(n.text))), "each KTV sees the QC note on their returned case");

// fix: new file + resend, QC passes
r = await Promise.all(KTV.map((k) => upload(k.call, mine(k)[0].id, "fixed-v2.stl", "design")));
check(r.every((x) => x.status === 200), "KTVs upload the fixed designs at once", statusLine(r));
r = await Promise.all(KTV.map((k) => k.call(`/api/jobs/${mine(k)[0].id}/stage`, { method: "POST", body: { action: "submit", note: "Đã sửa" } })));
check(r.every((x) => x.status === 200 && x.data.job.stage === "qc"), "KTVs resend to QC", statusLine(r));
r = await Promise.all(KTV.map((k) => qc(`/api/jobs/${mine(k)[0].id}/stage`, { method: "POST", body: { action: "pass", note: "OK" } })));
check(r.every((x) => x.status === 200 && x.data.job.stage === "ready"), "QC passes the fixed cases", statusLine(r));

// owner delivers all 8 at once; customers download, see no internal files
const full = await Promise.all(jobs.map((j) => owner("/api/jobs/" + j.id)));
r = await Promise.all(jobs.map((j, i) => owner(`/api/jobs/${j.id}/promote`, { method: "POST", body: { fids: full[i].data.job.files.filter((f) => f.kind === "design").map((f) => f.fid).slice(-1), deliver: true } })));
check(r.every((x) => x.status === 200 && x.data.job.status === "delivered"), "owner delivers 8 cases at once", statusLine(r));
r = await Promise.all(jobs.map((j, i) => labs[i % 2]("/api/jobs/" + j.id)));
check(r.every((x) => x.data.job.files.some((f) => f.kind === "output") && !x.data.job.files.some((f) => f.kind === "design") && !("team" in x.data.job) && !("designer" in x.data.job)),
  "customers see the delivered file only, no internal files, notes or KTV");
const outs = r.map((x) => x.data.job.files.find((f) => f.kind === "output").fid);
r = await Promise.all(jobs.map((j, i) => fetch(`${B}/api/jobs/${j.id}/files/${outs[i]}`, { headers: labs[i % 2].headers })));
check(r.every((x) => x.status === 200), "customers download their files");
r = await labs[1]("/api/jobs/" + jobs[0].id);
check(r.status === 404, "a lab cannot open another lab's case");

// the order book follows the cases: designer, QC, QC returns, delivered
r = await owner("/api/orders?source=portal&limit=200");
const synced = (r.data.items || []).filter((o) => jobs.some((j) => j.id === o.job_id));
check(synced.length === 8 && synced.every((o) => o.status === "delivered" && o.designer && o.qc === QCE), "order book shows the 8 cases delivered, with KTV and QC",
  synced.map((o) => o.status + "/" + (o.designer ? "d" : "-")).join(" "));
check(synced.filter((o) => o.qc_fails === 1).length === 4, "order book counts one QC return on 4 cases", synced.map((o) => o.qc_fails).join(","));

const opsA = await ops();
console.log("KV operations for 8 portal cases (create, scans, assign, design, QC, fix, deliver): " + JSON.stringify(opsA));

/* =============================== B. order book (staff orders, D1) =============================== */
r = await owner("/api/products/sample", { method: "POST" });
r = await owner("/api/customers", { method: "POST", body: { name: "Team test lab", kind: "lab", currency: "USD" } });
const cust = r.data.customer && r.data.customer.id;
check(!!cust, "customer for the order book");
// 12 orders entered at the same time, 3 per KTV
r = await Promise.all(Array.from({ length: 12 }, (_, i) => owner("/api/orders", { method: "POST", body: { customer_id: cust, patient: "BN " + (i + 1), designer: KTV[i % 4].email, qc: QCE, items: [{ product: "CR", qty: 1 + (i % 3) }] } })));
const ords = r.map((x) => x.data.order).filter(Boolean);
check(r.every((x) => x.status === 201) && new Set(ords.map((o) => o.code)).size === 12, "12 orders entered at the same moment get 12 different codes", statusLine(r) + " " + ords.map((o) => o.code).join(" "));
// the rest of the order-book flow runs on the orders that were created
const ktvOf = (o) => KTV.find((k) => k.email === o.designer);
const kOrders = (k) => ords.filter((o) => o.designer === k.email);
if (KTV.some((k) => kOrders(k).length < 2)) {
  for (let i = 0; ords.length < 12 && i < 30; i++) { // enter the missing ones one by one, like a person retrying
    const k = KTV.find((x) => kOrders(x).length < 3);
    const x = await owner("/api/orders", { method: "POST", body: { customer_id: cust, patient: "BN retry " + i, designer: k.email, qc: QCE, items: [{ product: "CR", qty: 1 }] } });
    if (x.data.order) ords.push(x.data.order);
  }
}
r = await Promise.all(KTV.map((k) => k.call("/api/orders?limit=200")));
check(r.every((x, n) => x.data.items.filter((o) => ords.some((y) => y.id === o.id)).length === kOrders(KTV[n]).length && x.data.items.every((o) => o.designer === KTV[n].email || o.qc === KTV[n].email)), "each KTV sees only their own orders",
  r.map((x) => (x.data.items || []).length).join(","));
check(r.every((x) => x.data.items.every((o) => !("total" in o) && !("paid" in o))), "KTVs see no prices in the order book");
r = await Promise.all(KTV.map((k) => k.call("/api/todo")));
check(r.every((x) => (x.data.items.find((t) => t.key === "design") || {}).n >= kOrders(KTV[r.indexOf(x)]).length), "each KTV's to-do shows their orders to design", r.map((x) => JSON.stringify((x.data.items.find((t) => t.key === "design") || {}).n)).join(","));

// start + design file in the order chat + done (send to QC), everyone at once
const act = (who, id, action, note) => who(`/api/orders/${id}/act`, { method: "POST", body: { action, note } });
r = await Promise.all(ords.map((o) => act(ktvOf(o).call, o.id, "start")));
check(r.every((x) => x.status === 200 && x.data.order.status === "design"), "KTVs start their orders at once", statusLine(r));
r = await Promise.all(ords.map(async (o) => {
  const who = ktvOf(o).call, fid = rid(), buf = "solid order\nendsolid\n";
  const p = await fetch(`${B}/api/orders/${o.id}/files/${fid}/0`, { method: "PUT", headers: { ...who.headers, "Content-Type": "application/octet-stream" }, body: buf });
  const a = await who(`/api/orders/${o.id}/files`, { method: "POST", body: { files: [{ fid, name: o.code + ".stl", size: buf.length, stored: buf.length, parts: 1 }], text: "File thiết kế" } });
  return { status: p.status === 200 ? a.status : p.status, fid };
}));
check(r.every((x) => x.status === 200), "KTVs post their design files in the order chat at once", statusLine(r));
const ofids = r.map((x) => x.fid);
r = await KTV[0].call(`/api/orders/${kOrders(KTV[1])[0].id}`);
check(r.status === 404, "a KTV cannot open another KTV's order (" + r.status + ")");
r = await Promise.all(ords.map((o) => act(ktvOf(o).call, o.id, "submit", "Xong")));
check(r.every((x) => x.status === 200 && x.data.order.status === "qc"), "KTVs mark all their orders done at once", statusLine(r));
r = await qc("/api/todo");
check((r.data.items.find((t) => t.key === "qc") || {}).n >= ords.length, "QC's to-do shows the orders waiting", JSON.stringify(r.data.items));
r = await Promise.all(ords.map((o, i) => fetch(`${B}/api/orders/${o.id}/files/${ofids[i]}`, { headers: qc.headers })));
check(r.every((x) => x.status === 200), "QC downloads every design file from the order chats");

// QC: return one order per KTV, pass the rest
const failO = new Set(KTV.map((k) => kOrders(k)[0].id));
r = await Promise.all(ords.map((o) => act(qc, o.id, failO.has(o.id) ? "fail" : "pass", failO.has(o.id) ? "Sai đường hoàn tất" : "OK")));
check(r.every((x) => x.status === 200), "QC passes 8 and returns 4 at once", statusLine(r));
r = await Promise.all(KTV.map((k) => k.call("/api/todo")));
check(r.every((x) => (x.data.items.find((t) => t.key === "fix") || {}).n >= 1), "each KTV's to-do shows the order returned by QC");
r = await act(KTV[0].call, kOrders(KTV[0])[1].id, "submit");
check(r.status === 409, "an order already passed by QC cannot be sent again by the KTV");
r = await Promise.all(KTV.map((k) => act(k.call, kOrders(k)[0].id, "submit", "Đã sửa")));
check(r.every((x) => x.status === 200 && x.data.order.status === "qc"), "KTVs resend the fixed orders", statusLine(r));
r = await Promise.all(KTV.map((k) => act(qc, kOrders(k)[0].id, "pass", "OK")));
check(r.every((x) => x.status === 200 && x.data.order.status === "ready"), "QC passes them");
r = await Promise.all(ords.map((o) => act(owner, o.id, "deliver")));
check(r.every((x) => x.status === 200 && x.data.order.status === "delivered"), "owner delivers all the orders at once", statusLine(r));
r = await act(KTV[0].call, kOrders(KTV[0])[0].id, "deliver");
check(r.status === 403, "a KTV cannot deliver");
const mo = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7);
r = await Promise.all(KTV.map((k) => k.call(`/api/tech/${encodeURIComponent(k.email)}?month=${mo}`)));
check(r.every((x, n) => x.status === 200 && x.data.orders.filter((o) => ords.some((y) => y.id === o.id)).length === kOrders(KTV[n]).length
  && x.data.orders.filter((o) => ords.some((y) => y.id === o.id)).reduce((s, o) => s + o.qc_fails, 0) === 1), "each KTV's own page: their delivered orders, 1 QC return",
  r.map((x) => (x.data.orders || []).length).join(","));
r = await KTV[0].call(`/api/tech/${encodeURIComponent(KTV[1].email)}?month=${mo}`);
check(r.status === 403, "a KTV cannot open another KTV's page (" + r.status + ")");

/* =============================== C. customer abroad, team in Vietnam =============================== */
// Workers KV keeps a copy of each value at every Cloudflare location for up to 60 s (why cases moved to D1). The customer
// (USA) and the KTV (Vietnam) reach different locations: does a KTV action right after the customer writes keep it?
const at = (colo, who) => { const f = (p, o = {}) => who(p, { ...o, headers: { ...(o.headers || {}), "x-test-colo": colo } }); f.headers = { ...who.headers, "x-test-colo": colo }; return f; };
const labUS = at("LAX", labs[0]), ktvVN = at("SGN", KTV[2].call), ownerVN = at("SGN", owner), qcVN = at("SGN", qc);
r = await labUS("/api/my/jobs", { method: "POST", body: { title: "Ca xa", service: "Crown & bridge", teeth: "36" } });
const far = r.data.job;
await sleep(1100);
await ownerVN(`/api/jobs/${far.id}/assign`, { method: "POST", body: { designer: KTV[2].email, qcBy: QCE } });
await ktvVN("/api/jobs/" + far.id);                     // the KTV opens the case in Vietnam
await sleep(1100);
r = await labUS(`/api/jobs/${far.id}/messages`, { method: "POST", body: { text: "Change: make 36 an onlay instead." } });
check(r.status === 200, "customer in the USA writes on the case");
await sleep(1100);
r = await ktvVN("/api/jobs/" + far.id);
check((r.data.job.thread || []).some((m) => /onlay/.test(m.text || "")), "KTV in Vietnam sees the customer's new message at once", "the case still shows the old copy");
await sleep(1100);
const fu = await upload(ktvVN, far.id, "ca-xa.stl", "design");
await sleep(1100);
await ktvVN(`/api/jobs/${far.id}/stage`, { method: "POST", body: { action: "submit" } });
await sleep(1100);
r = await owner("/api/jobs/" + far.id);            // no location: what is really stored
check((r.data.job.thread || []).some((m) => /onlay/.test(m.text || "")), "the customer's message is still on the case after the KTV works on it", "the KTV's save wrote over it");
r = await qcVN("/api/jobs/" + far.id);
check(r.data.job.stage === "qc" && r.data.job.files.some((f) => f.fid === fu.fid), "QC in Vietnam sees the KTV's file and the case waiting");

/* =============================== D. KV budget ============================== */
const used = await ops();
console.log("KV operations in this run: " + JSON.stringify(used));
if (problems.length) { console.log("\nPROBLEMS FOUND:"); problems.forEach((p) => console.log(" - " + p)); }
done();
