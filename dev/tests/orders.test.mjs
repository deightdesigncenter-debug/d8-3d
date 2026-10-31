// Order book (D1): product codes, price lists, customers, order codes yymmddxx with R / C, search, "already in the book" check, files in the chat,
// permissions (KTV never sees money), workflow, team chat, payments matched to orders, reports, export, import,
// portal cases becoming orders, 3D link previews. Run against: PAY=1 node dev/server.mjs public 8788 mat-khau-thu
import { B, PW, ok, done, signin, uniq } from "./lib.mjs";
import { readFileSync } from "node:fs";

const OWNER = "d.eightdesigncenter@gmail.com";
const owner = await signin(OWNER, "D.EIGHT");
const keyCall = (path, opts = {}) => fetch(B + path, { ...opts, headers: { "X-Upload-Key": PW, "X-D8": "1", ...(opts.headers || {}) } });
const sql = async (q) => (await fetch(B + "/__test/sql?q=" + encodeURIComponent(q))).json();
let r;

// ---------- settings: online payment and automatic free trial are off until switched on
r = await owner("/api/settings");
ok(r.status === 200 && r.data.settings.onlinePay === false && r.data.settings.autoTrial === false && r.data.db === true, "settings: payments + auto trial off, database on");
r = await (await fetch(B + "/api/config")).json();
ok(r.pay && r.pay.paypal === false && r.pay.stripe === false && r.db === true, "config: no online payment while switched off");

// ---------- product codes
r = await owner("/api/products/sample", { method: "POST" });
const fresh = r.status === 200;
ok((fresh && r.data.products.length === 20 && r.data.products.some((p) => p.code === "CR")) || r.status === 409, "sample product codes created (" + (r.data.products || []).length + ")");
r = await owner("/api/products/sample", { method: "POST" });
ok(r.status === 409, "sample catalogue only once");
const ZR = uniq("ZR").toUpperCase().slice(0, 12), CRZ = uniq("CR-Z").toUpperCase().slice(0, 12);
r = await owner("/api/products", { method: "POST", body: { items: [{ code: CRZ.toLowerCase(), name: "Mão zirconia", grp: "Crown & bridge", unit: "unit", price_usd: 12, price_vnd: 250000 }] } });
ok(r.status === 200 && r.data.products.some((p) => p.code === CRZ), "product code saved in capitals");
r = await owner("/api/products", { method: "POST", body: { items: [{ code: "bad code!", name: "x" }] } });
ok(r.status === 400, "bad product code refused");
r = await owner("/api/products");
ok(r.data.products.find((p) => p.code === CRZ).prices.USD === 12, "default price shown to the owner");
r = await owner("/api/products/rename", { method: "POST", body: { from: CRZ, to: ZR } });
ok(r.status === 200, "product code renamed");
r = await owner("/api/products");
ok(r.data.products.some((p) => p.code === ZR && p.prices.USD === 12) && !r.data.products.some((p) => p.code === CRZ), "rename keeps the prices");

// ---------- customers
const J = uniq("J").toUpperCase().slice(0, 10), A = uniq("AS").toUpperCase().slice(0, 10), K = uniq("KN").toUpperCase().slice(0, 10);
r = await owner("/api/customers", { method: "POST", body: { code: J.toLowerCase(), name: "Dr Jake – Colorado", kind: "doctor", country: "US", currency: "USD", phone: "+1 555" } });
ok(r.status === 200 && r.data.customer.code === J, "customer created with code " + J);
const jake = r.data.customer.id;
r = await owner("/api/customers", { method: "POST", body: { code: A, name: "All Smiles (Dr Annie)", kind: "platform", currency: "USD" } });
const alls = r.data.customer.id;
r = await owner("/api/customers", { method: "POST", body: { id: alls, code: J, name: "Clash" } });
ok(r.status === 400, "a customer code cannot be used twice");
r = await owner("/api/customers", { method: "POST", body: { code: "x y", name: "" } });
ok(r.status === 400, "bad customer refused");

// ---------- price lists
r = await owner("/api/prices", { method: "POST", body: { customer: jake, currency: "USD", items: [{ product: "CR", price: 30 }, { product: "IMC", price: 45 }] } });
ok(r.status === 200 && r.data.saved === 2, "Dr Jake price list saved");
r = await owner("/api/prices", { method: "POST", body: { customer: alls, currency: "USD", items: [{ product: "CR", price: 40 }] } });
r = await owner("/api/prices?customer=" + jake);
ok(r.data.own.length === 2 && r.data.defaults.some((d) => d.product === ZR), "price list read back with defaults");

// ---------- order codes
const day = "2026-10-20";
const before = (await sql(`SELECT COALESCE(MAX(seq),0) AS m FROM orders WHERE cday='${day}' AND kind='new'`))[0].m;
const code = (n) => "261020" + String(before + n).padStart(2, "0");
r = await owner("/api/orders", { method: "POST", body: { customer_id: jake, received: day, patient: "John Smith", doctor: "Dr Jake", clinic: "Smile Co",
  items: [{ product: "CR", teeth: "11, 21", qty: 2 }, { product: "IMC", qty: 1 }], adj_pct: 50 } });
ok(r.status === 201 && r.data.order.code === code(1), "first order of the day: " + (r.data.order && r.data.order.code));
const o1 = r.data.order;
ok(o1.subtotal === 105 && o1.total === 157.5 && o1.units === 3, "priced from the customer list + 50% same-day surcharge (" + o1.subtotal + " → " + o1.total + ")");
r = await owner("/api/orders", { method: "POST", body: { customer_id: jake, received: day, patient: "Nguyễn Văn Kiệt", items: [{ product: ZR, qty: 1 }] } });
ok(r.data.order.code === code(2) && r.data.order.total === 12, "second order of the day " + r.data.order.code + ", default price used");
const o2 = r.data.order;
r = await owner("/api/orders", { method: "POST", body: { customer_id: jake, received: "2026-09-18", items: [{ product: "CR" }] } });
ok(/^260918\d{2}$/.test(r.data.order.code), "code follows the date received: " + r.data.order.code);
const typed = "261020" + String(before + 40).padStart(2, "0");
r = await owner("/api/orders", { method: "POST", body: { customer_id: jake, received: day, code: typed, items: [{ product: "CR" }] } });
ok(r.status === 201 && r.data.order.code === typed, "old order keeps a typed code");
const oTyped = r.data.order;
r = await owner("/api/orders", { method: "POST", body: { customer_id: jake, received: day, code: typed } });
ok(r.status === 409, "typed code cannot be used twice");
r = await owner("/api/orders", { method: "POST", body: { customer_id: jake, code: "2026/10/20" } });
ok(r.status === 400, "bad code format refused");
const oldStyle = "26/10/20/" + String(before + 45).padStart(2, "0");
r = await owner("/api/orders", { method: "POST", body: { customer_id: jake, received: day, code: oldStyle, items: [{ product: "CR" }] } });
ok(r.status === 201 && r.data.order.code === oldStyle.replace(/\//g, ""), "an old-style code 26/10/20/xx is stored as " + (r.data.order && r.data.order.code));
const oOld = r.data.order;
r = await owner("/api/orders", { method: "POST", body: { customer_id: jake, items: [{ product: "NOPE" }] } });
ok(r.status === 400, "unknown product code refused");

// redo (R) and next stage (C)
const child = async (parent, kind) => (await owner("/api/orders", { method: "POST", body: { kind, parent_id: parent.id, items: [{ product: "CR" }] } })).data.order;
// the owner's rules: stage 1 = 26102101, stage 2 = 26102101C2, first redo = 26102101R1, redo then stage 2 = 26102101R1C2
r = await owner(`/api/orders/${o1.id}/next?kind=redo`);
ok(r.status === 200 && r.data.code === o1.code + "R1", "the form shows the redo code before saving: " + r.data.code);
const r1 = await child(o1, "redo");
ok(r1.code === o1.code + "R1" && r1.kind === "redo" && r1.charge === "warranty" && r1.total === 0, "redo → " + r1.code + ", free under warranty by default");
const r2 = await child(r1, "redo");
ok(r2.code === o1.code + "R2", "second redo → " + r2.code);
const c2 = await child(o1, "continue");
ok(c2.code === o1.code + "C2" && c2.kind === "continue" && c2.stage === 2 && c2.total === 30, "stage 2 → " + c2.code + " (charged)");
const c3 = await child(c2, "continue");
ok(c3.code === o1.code + "C3" && c3.stage === 3, "stage 3 → " + c3.code);
const r1c2 = await child(r1, "continue");
ok(r1c2.code === o1.code + "R1C2" && r1c2.stage === 2, "redo, then stage 2 → " + r1c2.code);
const c2r1 = await child(c2, "redo");
ok(c2r1.code === o1.code + "C2R1", "redo of stage 2 → " + c2r1.code);
r = await owner("/api/orders", { method: "POST", body: { kind: "continue", parent_id: o1.id, items: [{ product: "CR" }] } });
ok(r.status === 409 && r.data.id === c2.id, "stage 2 cannot be made twice (points to " + o1.code + "C2)");
r = await owner(`/api/orders/${r1c2.id}/next?kind=continue`);
ok(r.data.code === o1.code + "R1C3", "after R1C2 the next stage is " + r.data.code);
const r3 = await child(o1, "redo");
ok(r3.code === o1.code + "R3", "another redo of the original counts on → " + r3.code);
r = await owner("/api/orders/" + o1.id);
ok(r.data.related.map((x) => x.code).join(" ") === ["", "C2", "C2R1", "C3", "R1", "R1C2", "R2", "R3"].map((x) => o1.code + x).join(" "), "order page lists the whole family: " + r.data.related.map((x) => x.code).join(" "));
r = await owner("/api/orders/next-code?day=" + day);
ok(r.data.code === code(46), "next code continues after the highest number of the day: " + r.data.code);

// search: code, patient, doctor, clinic, customer, without accents
const find = async (q) => ((await owner("/api/orders?limit=200&q=" + encodeURIComponent(q))).data.items || []).map((x) => x.code);
ok((await find("smith")).includes(o1.code), "search by patient");
ok((await find("dr jake")).includes(o1.code), "search by doctor");
ok((await find("smile co")).includes(o1.code), "search by clinic");
ok((await find(J)).includes(o2.code), "search by customer code");
ok((await find("colorado")).includes(o2.code), "search by customer name");
ok((await find("kiet")).includes(o2.code), "search without accents (Kiệt)");
ok((await find(o1.code)).includes(o1.code), "search by code");
ok((await find(o1.code.slice(0, 2) + "/" + o1.code.slice(2, 4) + "/" + o1.code.slice(4, 6) + "/" + o1.code.slice(6))).includes(o1.code), "search by a code typed the old way (26/10/20/xx)");
ok((await find(o1.code + "R2")).length === 1, "search by full redo code");

// ---------- team: KTV and QC
const KTV = uniq("ktv") + "@d8.example", QC = uniq("qc") + "@d8.example", KTV2 = uniq("ktv2") + "@d8.example";
for (const [e, role] of [[KTV, "designer"], [QC, "qc"], [KTV2, "designer"]]) await owner("/api/staff", { method: "POST", body: { email: e, role } });
const KNAME = "Minh KTV " + Date.now().toString(36);
const ktv = await signin(KTV, KNAME), qc = await signin(QC, "Lan QC"), ktv2 = await signin(KTV2, "Tú KTV");
r = await ktv("/api/orders");
ok(r.status === 200 && !r.data.items.some((x) => x.id === o1.id), "KTV does not see orders that are not theirs");
r = await owner("/api/orders/" + o1.id, { method: "POST", body: { designer: KTV, qc: QC } });
ok(r.status === 200 && r.data.order.designer === KTV && r.data.order.status === "design", "owner assigns KTV and QC");
r = await ktv("/api/orders");
const kRow = r.data.items.find((x) => x.id === o1.id);
ok(kRow && !("total" in kRow) && !("paid" in kRow) && !("subtotal" in kRow) && !("currency" in kRow), "KTV list has no money fields (only their own pay)");
r = await ktv("/api/orders/" + o1.id);
ok(r.status === 200 && r.data.items.length === 2 && r.data.items.every((x) => !("price" in x) && !("amount" in x)) && !r.data.customer && !r.data.payments, "KTV order page: items without prices, no customer contact, no payments");
ok(r.data.order.customer_name === "Dr Jake – Colorado", "KTV sees which customer the order is for");
for (const [p, label] of [["/api/prices?customer=" + jake, "price list"], ["/api/customers", "customers"], ["/api/reports", "reports"], ["/api/payments", "payments"],
  ["/api/techrates", "KTV pay rates"], ["/api/export", "export"], ["/api/prices?all=1", "all prices"]]) {
  r = await ktv(p);
  ok(r.status === 403, "KTV cannot read " + label + " (" + r.status + ")");
}
r = await ktv("/api/orders", { method: "POST", body: { customer_id: jake, items: [{ product: "CR" }] } });
ok(r.status === 403, "KTV without permission cannot enter orders");
r = await ktv2("/api/orders/" + o1.id);
ok(r.status === 404, "another KTV cannot open the order");

// workflow
const act = (who, id, action, note) => who(`/api/orders/${id}/act`, { method: "POST", body: { action, note } });
r = await act(ktv, o1.id, "submit");
ok(r.status === 200 && r.data.order.status === "qc", "KTV sends to QC");
r = await act(qc, o1.id, "fail");
ok(r.status === 400, "QC fail needs a note");
r = await act(qc, o1.id, "fail", "Tiếp xúc 21 quá chặt");
ok(r.status === 200 && r.data.order.status === "fix" && r.data.order.qc_fails === 1, "QC returns it, fail counted");
r = await act(ktv2, o1.id, "submit");
ok(r.status === 404, "other KTV cannot act on it");
await act(ktv, o1.id, "submit");
r = await act(qc, o1.id, "pass", "OK");
ok(r.data.order.status === "ready", "QC passes");
r = await act(ktv, o1.id, "deliver");
ok(r.status === 403, "KTV cannot deliver without permission");
r = await act(owner, o1.id, "deliver");
ok(r.data.order.status === "delivered" && r.data.order.dday, "owner delivers (" + r.data.order.dday + ")");

// team chat by order code
r = await ktv(`/api/orders/${o1.id}/chat`, { method: "POST", body: { text: "Anh ơi răng 21 cần chỉnh lại không?" } });
ok(r.status === 200, "KTV writes in the order chat");
r = await qc("/api/orders/unread");
ok(r.data.count >= 1, "QC has an unread order chat (" + r.data.count + ")");
r = await qc(`/api/orders/${o1.id}/chat`);
ok(r.data.msgs.some((m) => m.kind === "msg" && /21/.test(m.text)) && r.data.msgs.some((m) => m.kind === "sys" && /QC không đạt.*Tiếp xúc/.test(m.text)), "chat shows messages and workflow events");
r = await qc("/api/orders/unread");
const unreadAfter = r.data.count;
r = await qc(`/api/orders/${o1.id}/chat`, { method: "POST", body: { text: "Ok em", img: "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64") } });
ok(r.status === 200, "QC replies with a picture");
r = await ktv(`/api/orders/${o1.id}/chat`);
const pic = r.data.msgs.find((m) => m.img);
const imgRes = await fetch(`${B}/api/orders/${o1.id}/chat/${pic.id}/img`, { headers: ktv.headers });
ok(imgRes.status === 200 && imgRes.headers.get("content-type") === "image/jpeg", "picture in the chat opens");
r = await ktv2(`/api/orders/${o1.id}/chat`);
ok(r.status === 404, "chat closed to staff not on the order");
const cust0 = await signin(uniq("c") + "@lab.example", "Some Lab");
r = await cust0(`/api/orders/${o1.id}/chat`);
ok(r.status === 403, "customers never reach the team chat (" + r.status + ")");
ok(unreadAfter === 0 || unreadAfter < 99, "reading the chat clears the unread mark");

// a KTV allowed to enter orders: prices still come from the list, and stay hidden
const roleDes = (await owner("/api/staff")).data.roles.designer.perms;
ok(roleDes.includes("techpay.own") && !roleDes.includes("techpay.manage") && !roleDes.includes("billing.view"), "KTV role: sees own pay by default, never prices or other KTVs' pay");
const desPerms = roleDes.filter((p) => p !== "techpay.own");
await owner("/api/staff", { method: "POST", body: { email: KTV, role: "designer", perms: [...desPerms, "orders.edit"] } });
r = await ktv("/api/orders", { method: "POST", body: { customer_id: jake, received: day, items: [{ product: "CR", qty: 1, price: 1 }] } });
ok(r.status === 201 && !("total" in r.data.order), "KTV with permission enters an order, sees no money");
const kOrder = r.data.order;
r = await owner("/api/orders/" + kOrder.id);
ok(r.data.items[0].price === 30 && r.data.order.total === 30, "price typed by KTV ignored, list price used (" + r.data.items[0].price + ")");
r = await ktv("/api/orders", { method: "POST", body: { customer_id: jake, designer: KTV, items: [{ product: "CR" }] } });
ok(r.status === 403, "KTV cannot assign people");
r = await ktv("/api/customers");
ok(r.status === 200 && r.data.customers.every((c) => !("billed" in c) && !("phone" in c)), "KTV picks customers by name only");

// "this order is already in the book": a KTV typing an order the admin already entered is told so, with its code
r = await ktv2("/api/orders/dupes?patient=john%20smith&customer=" + jake);
ok(r.status === 403, "staff who cannot enter orders get no duplicate check");
await owner("/api/staff", { method: "POST", body: { email: KTV2, role: "designer", perms: [...desPerms, "orders.edit"] } });
r = await ktv2("/api/orders/dupes?patient=" + encodeURIComponent("JOHN  smith") + "&customer=" + jake);
// an order the KTV may not open is listed by code only: its id is 0 and its patient, KTV, doctor and clinic are blank
const dj = (r.data.dupes || []).find((x) => x.code === o1.code);
ok(r.status === 200 && dj && dj.id === 0 && dj.match === "patient" && dj.canOpen === false && !("total" in dj) && dj.patient === "" && dj.designer === "", "KTV sees the existing order code " + (dj && dj.code) + " (no money, no patient, cannot open it)");
ok(!(r.data.dupes || []).some((x) => x.canOpen ? x.patient !== "John Smith" : x.patient !== ""), "duplicates are matched on the patient, and hidden ones show no patient");
r = await ktv2("/api/orders/dupes?patient=Nobody%20Here&customer=" + jake);
ok(r.status === 200 && r.data.dupes.length === 0, "no false alarm for a new patient");
r = await owner("/api/orders", { method: "POST", body: { customer_id: alls, received: day, patient: "Mai Anh", ref: "AS-7781", items: [{ product: "CR" }] } });
const oRef = r.data.order;
r = await ktv2("/api/orders/dupes?ref=AS-7781&customer=" + alls);
ok(r.data.dupes.length === 1 && r.data.dupes[0].code === oRef.code && r.data.dupes[0].match === "ref", "same customer case number found: " + oRef.code);
r = await ktv2("/api/orders", { method: "POST", body: { customer_id: alls, received: day, patient: "mai anh", check_dupes: true, items: [{ product: "CR" }] } });
ok(r.status === 409 && r.data.code === "dupe" && r.data.dupes.some((x) => x.code === oRef.code), "saving it asks first: already in the book as " + oRef.code);
r = await ktv2("/api/orders", { method: "POST", body: { customer_id: alls, received: day, patient: "mai anh", items: [{ product: "CR" }] } });
ok(r.status === 201, "after confirming it is a different order, it is created");
await owner("/api/orders/" + r.data.order.id, { method: "DELETE" });
await owner("/api/orders/" + oRef.id, { method: "DELETE" });
await owner("/api/staff", { method: "POST", body: { email: KTV2, role: "designer", perms: null } });

// files in the team chat (sent in parts like case files)
const fid = "Fa1b2C3d4E", partA = Buffer.from("solid crown\n" + "x".repeat(3000)), partB = Buffer.from("endsolid crown\n");
const put = (who, n, buf, f = fid) => fetch(`${B}/api/orders/${o1.id}/files/${f}/${n}`, { method: "PUT", headers: { ...who.headers, "Content-Type": "application/octet-stream" }, body: buf });
ok((await put(ktv, 0, partA)).status === 200 && (await put(ktv, 1, partB)).status === 200, "KTV uploads a file in two parts");
r = await ktv(`/api/orders/${o1.id}/files`, { method: "POST", body: { files: [{ fid: "Zz9y8X7w6V", name: "missing.stl", size: 10, stored: 10, parts: 1 }], text: "x" } });
ok(r.status === 400, "a file that was not uploaded is refused");
r = await ktv(`/api/orders/${o1.id}/files`, { method: "POST", body: { files: [{ fid, name: "11-21 crown v2.stl", size: partA.length + partB.length, stored: partA.length + partB.length, parts: 2, gz: 0 }], text: "File thiết kế v2" } });
ok(r.status === 200 && r.data.files === 1, "file sent in the chat with a note");
r = await qc(`/api/orders/${o1.id}/chat`);
const fm = r.data.msgs.find((m) => m.files && m.files.length);
ok(fm && fm.text === "File thiết kế v2" && fm.files[0].name === "11-21 crown v2.stl" && fm.files[0].fid === fid, "QC sees the file in the chat");
const dl = await fetch(`${B}/api/orders/${o1.id}/files/${fid}`, { headers: qc.headers });
const got = Buffer.from(await dl.arrayBuffer());
ok(dl.status === 200 && got.equals(Buffer.concat([partA, partB])) && /attachment/.test(dl.headers.get("content-disposition") || ""), "QC downloads the same file (" + got.length + " bytes)");
ok((await fetch(`${B}/api/orders/${o1.id}/files/${fid}`, { headers: ktv2.headers })).status === 404, "staff not on the order cannot download it");
ok([401, 403].includes((await fetch(`${B}/api/orders/${o1.id}/files/${fid}`, { headers: cust0.headers })).status), "customers cannot download team files");
ok((await put(cust0, 0, partA, "Qq1w2e3r4T")).status >= 400, "customers cannot upload team files");

// ---------- payments matched to orders (deposit, payment for one order, cancellation)
const mk = async (d, qty) => (await owner("/api/orders", { method: "POST", body: { customer_id: alls, received: d, items: [{ product: "CR", qty }] } })).data.order;
const oa = await mk("2026-09-18", 3), ob = await mk("2026-10-01", 2), oc = await mk("2026-10-05", 1);
ok(oa.total === 120 && ob.total === 80 && oc.total === 40, "All Smiles orders 120 / 80 / 40");
r = await owner("/api/payments", { method: "POST", body: { customer_id: alls, day: "2026-09-01", amount: 200, method: "payoneer", note: "Ứng trước" } });
ok(r.status === 200, "deposit of 200 recorded");
const paidOf = async (o) => (await owner("/api/orders/" + o.id)).data.order;
let a1 = await paidOf(oa), b1 = await paidOf(ob), c1x = await paidOf(oc);
ok(a1.paid === 120 && b1.paid === 80 && c1x.paid === 0 && c1x.due === 40, "deposit pays the oldest orders first");
r = await owner("/api/payments", { method: "POST", body: { order_id: oc.id, day: "2026-10-06", amount: 50, method: "paypal" } });
c1x = await paidOf(oc);
ok(c1x.paid === 40 && c1x.due === 0, "payment for one order goes to it");
r = await owner("/api/customers/" + alls);
ok(r.data.stats[0].credit === 10 && r.data.stats[0].due === 0, "overpayment kept as credit (" + JSON.stringify(r.data.stats[0]) + ")");
r = await act(owner, ob.id, "cancel");
ok(r.status === 400, "cancelling needs a reason");
r = await act(owner, ob.id, "cancel", "Khách hủy");
r = await owner("/api/customers/" + alls);
ok(r.data.stats[0].credit === 90, "cancelled order releases its money as credit (" + r.data.stats[0].credit + ")");
r = await ktv("/api/payments", { method: "POST", body: { customer_id: alls, day: "2026-10-06", amount: 5 } });
ok(r.status === 403, "KTV cannot record payments");
r = await owner("/api/orders?pay=due&customer=" + jake);
ok(r.data.items.every((x) => x.due > 0) && r.data.sums.length >= 1, "filter: orders still owing");

// ---------- reports and export
r = await owner(`/api/reports?from=2026-09-01&to=2026-10-31`);
const cRow = r.data.customers.find((x) => x.code === A);
ok(r.status === 200 && r.data.days.length > 0 && cRow && cRow.t === 160 && cRow.p === 160, "report per customer (All Smiles billed 160, paid 160)");
ok(r.data.credit.some((x) => x.code === A && x.credit === 90) && r.data.debt.some((x) => x.code === J), "report lists credit and money owed");
ok(r.data.designers.some((x) => x.email === KTV && x.f === 1), "report per KTV with QC returns");
ok(r.data.products.some((x) => x.code === "CR"), "report per product code");
r = await owner(`/api/export?from=2026-09-01&to=2026-10-31`);
ok(r.status === 200 && r.data.orders.length >= 10 && r.data.items.length >= 10 && r.data.payments.length >= 2, "export: orders, items, payments");

// KTV pay rates: only admin, and the KTV's own pay only with its own permission
r = await owner("/api/techrates", { method: "POST", body: { email: KTV, currency: "VND", from: "2026-01-01", items: [{ product: "CR", rate: 100000 }, { product: "IMC", rate: 150000 }] } });
ok(r.status === 200, "KTV pay rates saved");
r = await owner("/api/orders/" + o1.id);
ok(r.data.order.tech_cost === 350000 && r.data.order.tech_currency === "VND", "KTV pay of an order: 2×100,000 + 150,000 (" + r.data.order.tech_cost + ")");
r = await ktv("/api/orders/" + o1.id);
ok(!("tech_cost" in r.data.order), "KTV does not see pay without permission");
await owner("/api/staff", { method: "POST", body: { email: KTV, role: "designer", perms: [...desPerms, "orders.edit", "techpay.own"] } });
r = await ktv("/api/orders/" + o1.id);
ok(r.data.order.tech_cost === 350000 && !("total" in r.data.order), "with “own pay” the KTV sees their pay, still no price");
r = await ktv2("/api/techrates");
ok(r.status === 403, "KTVs never see other KTVs' rates");

// ---------- KTV pages: managers see every KTV; a KTV only their own page, pay only with "own pay"
const mo = day.slice(0, 7), vnMo = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7), kq = encodeURIComponent(KTV);
r = await owner(`/api/tech?month=${mo}&basis=received`);
const tRow = (r.data.rows || []).find((x) => x.email === KTV);
ok(r.status === 200 && r.data.pay === true && tRow && tRow.n >= 1 && tRow.u >= 3 && tRow.fo >= 1 && tRow.rd >= 1 && tRow.k >= 350000 && typeof r.data.unassigned === "number",
  "team page: month per KTV with QC returns, redone cases and pay " + JSON.stringify(tRow));
r = await owner(`/api/tech/${kq}?month=${mo}&basis=received`);
const t1 = (r.data.orders || []).find((x) => x.id === o1.id);
ok(r.status === 200 && t1 && t1.tech_cost === 350000 && t1.redone === true && t1.qc_fails === 1 && /CR/.test(t1.items_text) && !("total" in t1) && !("customer_name" in t1),
  "KTV page: the order with pay, QC return, redo — no price, no customer");
ok(r.data.months.some((x) => x.m === mo && x.n >= 1 && x.k >= 350000) && r.data.products.some((x) => x.code === "CR" && x.q >= 2), "KTV page: months and product counts");
r = await owner(`/api/tech/${kq}?month=${vnMo}`);
ok(r.status === 200 && r.data.basis === "delivered" && r.data.orders.some((x) => x.id === o1.id && x.dday), "by delivery day (default): the delivered order counts in the month it was delivered");
ok(r.data.orders.every((x) => x.status === "delivered"), "by delivery day: only delivered orders");
r = await owner(`/api/tech/${kq}?month=2019-01&basis=received`);
ok(r.status === 200 && r.data.orders.length === 0 && Array.isArray(r.data.open), "an empty month");
r = await owner(`/api/tech/${kq}?month=bad`);
ok(r.status === 200 && r.data.month === vnMo, "a bad month falls back to this month");
r = await ktv(`/api/tech/${kq}?month=${mo}&basis=received`);
ok(r.status === 200 && r.data.pay === true && r.data.orders.some((x) => x.id === o1.id && x.tech_cost === 350000), "KTV sees their own page with their own pay");
r = await ktv("/api/tech");
ok(r.status === 403, "KTV cannot see the team page");
r = await ktv(`/api/tech/${encodeURIComponent(KTV2)}`);
ok(r.status === 403, "KTV cannot open another KTV's page");
r = await qc(`/api/tech/${encodeURIComponent(QC)}`);
ok(r.status === 403, "QC (not a designer) has no KTV page");
await owner("/api/staff", { method: "POST", body: { email: KTV, role: "designer", perms: [...desPerms, "orders.edit"] } });
r = await ktv(`/api/tech/${kq}?month=${mo}&basis=received`);
ok(r.status === 200 && r.data.pay === false && r.data.orders.length > 0 && r.data.orders.every((x) => !("tech_cost" in x)) && r.data.months.every((x) => !("k" in x)),
  "without “own pay”: work is shown, pay is not");
await owner("/api/staff", { method: "POST", body: { email: KTV, role: "designer", perms: [...desPerms, "orders.edit", "techpay.own"] } });
const REP = uniq("rep") + "@d8.example";
await owner("/api/staff", { method: "POST", body: { email: REP, role: "designer", perms: ["reports.view"] } });
const rep0 = await signin(REP, "Báo cáo");
r = await rep0(`/api/tech?month=${mo}&basis=received`);
ok(r.status === 200 && r.data.pay === false && r.data.rows.every((x) => !("k" in x)), "report viewer sees the team without pay");
r = await rep0(`/api/tech/${kq}?month=${mo}&basis=received`);
ok(r.status === 200 && r.data.pay === false && r.data.orders.every((x) => !("tech_cost" in x)), "report viewer opens a KTV page without pay");
r = await cust0("/api/tech");
ok([401, 403].includes(r.status), "customers cannot see KTV pages (" + r.status + ")");
r = await cust0(`/api/tech/${kq}`);
ok([401, 403].includes(r.status), "customers cannot see a KTV's page");

// ---------- import from Excel (rows prepared by the browser)
r = await owner("/api/import/customers", { method: "POST", body: { rows: [{ code: K, name: "Khai Nguyen Lab", currency: "VND", kind: "lab" }, { code: "bad code", name: "" }] } });
ok(r.status === 400 && r.data.errors.length === 1 && r.data.done === 0, "import refuses a file with errors (nothing saved)");
r = await owner("/api/import/customers", { method: "POST", body: { partial: true, rows: [{ code: K, name: "Khai Nguyen Lab", currency: "VND", kind: "lab" }, { code: "bad code", name: "" }] } });
ok(r.status === 200 && r.data.done === 1, "import of the valid rows only");
r = await owner("/api/import/prices", { method: "POST", body: { partial: true, rows: [{ customer: K, product: "CR", price: 150000 }, { customer: "NOPE", product: "CR", price: 1 }, { customer: "", product: "CR", currency: "VND", price: 120000 }] } });
ok(r.data.done === 2 && r.data.errors.length === 1, "price import (one bad customer code)");
const kn = (await owner("/api/customers")).data.customers.find((c) => c.code === K);
const t5 = "26/08/05/05", t5n = "26080505";
const existing5 = (await sql(`SELECT COUNT(*) AS n FROM orders WHERE code='${t5n}'`))[0].n;
r = await owner("/api/import/orders", { method: "POST", body: { dry: true, rows: [{ key: "A1", day: "2026-08-05", customer: K, patient: "P1", items: [{ product: "CR", qty: 2 }], paid: "x", status: "delivered" }] } });
ok(r.status === 200 && r.data.preview.length === 1 && (await sql(`SELECT COUNT(*) AS n FROM orders WHERE customer_id=${kn.id}`))[0].n === 0, "dry run saves nothing");
r = await owner("/api/import/orders", { method: "POST", body: { rows: [
  { key: "A1", day: "2026-08-05", customer: K, patient: "P1", doctor: "BS Kiệt", items: [{ product: "CR", qty: 2, teeth: "11 21" }], paid: "x", status: "delivered", designer: KNAME },
  ...(existing5 ? [] : [{ key: "A2", code: t5, day: "2026-08-05", customer: K, items: [{ product: "CR", qty: 1 }] },
    { key: t5n + "R1", code: t5n + "R1", day: "2026-08-07", customer: K, items: [{ product: "CR", qty: 1 }] },
    { key: t5n + "R1C2", code: t5n + "R1C2", day: "2026-08-09", customer: K, items: [{ product: "IMC", qty: 1 }] }]),
  { key: "A3", day: "2026-08-05", customer: K, items: [{ product: "CR" }, { product: "IMC" }] },
] } });
ok(r.status === 200 && r.data.done === (existing5 ? 2 : 5), "old orders imported (" + JSON.stringify(r.data.codes || r.data.errors) + ")");
if (!existing5) {
  const fam = await sql(`SELECT o.code, o.kind, p.code AS parent, o.charge FROM orders o LEFT JOIN orders p ON p.id = o.parent_id WHERE o.code LIKE '${t5n}%' ORDER BY o.code`);
  ok(fam.map((x) => x.code + ":" + x.kind + ":" + (x.parent || "")).join(" ") === `${t5n}:new: ${t5n}R1:redo:${t5n} ${t5n}R1C2:continue:${t5n}R1`, "imported redo / next-stage codes are linked to their parent: " + fam.map((x) => x.code + "←" + (x.parent || "")).join(" "));
  ok(fam.find((x) => x.code === t5n + "R1").charge === "warranty", "an imported redo is free under warranty unless the file says otherwise");
}
r = await owner("/api/orders?customer=" + kn.id + "&limit=50&sort=code");
const imp = r.data.items;
const a1row = imp.find((x) => x.patient === "P1");
ok(a1row && a1row.total === 300000 && a1row.paid === 300000 && a1row.currency === "VND" && a1row.designer === KTV, "imported order priced in VND, marked paid, KTV matched by name");
ok(imp.every((x) => /^260805\d{2}(?:[RC]\d+)*$/.test(x.code)), "imported codes follow the date: " + imp.map((x) => x.code).join(", "));
r = await owner("/api/import/orders", { method: "POST", body: { rows: [{ key: "B1", day: "2026-13-01", customer: K, items: [{ product: "CR" }] }, { key: "B2", day: "2026-08-06", customer: "NOPE", items: [] }] } });
ok(r.status === 400 && r.data.errors.length === 2, "import explains bad dates and unknown customers");
// a big file in one request stays within the database limits of the free plan
const many = Array.from({ length: 100 }, (_, i) => ({ key: "M" + i, day: "2026-07-" + String(1 + (i % 28)).padStart(2, "0"), customer: K, patient: "Bulk " + i, items: [{ product: "CR", qty: 1 }, { product: "IMC", qty: 1 }], paid: i % 2 ? "x" : "" }));
r = await owner("/api/import/orders", { method: "POST", body: { rows: many } });
ok(r.status === 200 && r.data.done === 100, "100 orders imported in one request (" + r.status + " " + (r.data.error || "") + ")");

// ---------- delete
r = await owner("/api/orders/" + o1.id, { method: "DELETE" });
ok(r.status === 409, "an order with redo / next-stage orders cannot be deleted");
r = await ktv("/api/orders/" + c3.id, { method: "DELETE" });
ok(r.status === 403 || r.status === 404, "KTV cannot delete");
r = await owner("/api/orders/" + oTyped.id, { method: "DELETE" });
ok(r.status === 200, "owner deletes a plain order");

// ---------- portal cases become orders
const labEmail = uniq("lab") + "@lab.example";
const lab = await signin(labEmail, "Smile Lab");
await lab("/api/my/profile", { method: "POST", body: { practice: "Bright Smile Dental", country: "USA" } });
r = await lab("/api/my/jobs", { method: "POST", body: { title: "Case 990, crown 36", service: "Crown & bridge", teeth: "36" } });
const job = r.data.job;
ok(job.order && /^\d{8,9}$/.test(job.order) && !("orderId" in job) && !job.trial, "portal case gets an order code (" + job.order + "), no automatic free trial");
r = await lab("/api/my/jobs");
ok(r.data.items.some((x) => x.id === job.id && x.order === job.order), "customer's list shows the order code");
r = await owner("/api/orders?q=" + encodeURIComponent("case 990"));
const po = r.data.items.find((x) => x.job_id === job.id);
ok(po && po.source === "portal" && po.code === job.order && po.customer_name === "Bright Smile Dental", "order made for the portal case, customer created from the profile");
r = await owner("/api/customers");
const autoC = r.data.customers.find((c) => c.id === po.customer_id);
ok(autoC && autoC.auto && autoC.logins.includes(labEmail), "new customer is linked to the Google account");
await owner(`/api/jobs/${job.id}/assign`, { method: "POST", body: { designer: KTV, qcBy: QC } });
r = await owner("/api/orders/" + po.id);
ok(r.data.order.designer === KTV && r.data.order.status === "design", "assignment copied into the order");
r = await ktv("/api/orders/" + po.id + "/act", { method: "POST", body: { action: "submit" } });
ok(r.status === 409, "portal orders use the case page for the workflow");
r = await owner(`/api/jobs/${job.id}/status`, { method: "POST", body: { status: "delivered" } });
r = await owner("/api/orders/" + po.id);
ok(r.data.order.status === "delivered" && r.data.order.dday, "delivery copied into the order");
r = await owner(`/api/orders/${po.id}/chat`);
ok(r.data.msgs.some((m) => /Phân công/.test(m.text)), "case events appear in the order chat");
// relinking the Google account to an existing customer moves its orders
r = await owner(`/api/customers/${jake}/logins`, { method: "POST", body: { email: labEmail } });
r = await owner("/api/orders/" + po.id);
ok(r.data.order.customer_id === jake, "linking the account to Dr Jake moves its orders");
r = await lab("/api/me");
ok(r.data.user && r.data.user.greet === "Dr Jake – Colorado", "customer is greeted by the name entered in the customer list (" + (r.data.user && r.data.user.greet) + ")");
r = await lab("/api/my/jobs", { method: "POST", body: { title: "", service: "Crown", teeth: "14", material: "Zirconia" } });
ok(r.status === 201 && r.data.job && /^D8-/.test(r.data.job.id) && r.data.job.title === "Crown", "case without a typed reference: the system makes the code (" + (r.data.job && r.data.job.id) + ")");

// ---------- 3D link previews
const html = "<!doctype html><html><head><title>scene</title></head><body>exocad</body></html>";
const up = await keyCall("/api/upload", { method: "POST", body: html, headers: { "Content-Type": "application/octet-stream", "X-Case-Label": encodeURIComponent("Case 1"),
  "X-OG-Title": encodeURIComponent("Patient: JOHN SMITH - Second design"), "X-OG-Desc": encodeURIComponent("Code: " + o1.code + " | Smile Co | Dr Jake"), "X-Order-Id": String(o1.id) } });
const link = await up.json();
ok(up.status === 201 && link.title === "Patient: JOHN SMITH - Second design", "3D link keeps its preview title");
const page = await (await fetch(B + "/v/" + link.id)).text();
ok(page.includes('property="og:title" content="Patient: JOHN SMITH - Second design"') && page.includes("/og/" + link.id + ".jpg") && page.includes('og:description" content="Code: ' + o1.code), "doctor page carries the link preview tags");
let img = await fetch(B + "/og/" + link.id + ".jpg");
const fallback = new Uint8Array(await img.arrayBuffer());
ok(img.status === 200 && img.headers.get("content-type") === "image/jpeg" && fallback[0] === 0xff, "preview image: D.EIGHT picture until a snapshot is uploaded");
const jpg = new Uint8Array(4000); jpg.set([0xff, 0xd8, 0xff, 0xe0]);
r = await keyCall(`/api/cases/${link.id}/og`, { method: "PUT", body: jpg, headers: { "Content-Type": "image/jpeg" } });
ok(r.status === 200, "snapshot uploaded");
img = await fetch(B + "/og/" + link.id + ".jpg");
ok((await img.arrayBuffer()).byteLength === 4000, "preview image is the snapshot");
r = await keyCall(`/api/cases/${link.id}/og`, { method: "PUT", body: "not a jpeg at all".repeat(100), headers: { "Content-Type": "image/jpeg" } });
ok(r.status === 400, "only JPEG accepted as preview");
// the default picture is the owner's (2026-10-31), small enough for WhatsApp (no picture over ~300 KB there)
const newDefault = Buffer.from(await (await fetch(B + "/brand/og-3d.jpg")).arrayBuffer());
ok(newDefault.byteLength < 300 * 1024 && Buffer.compare(Buffer.from(fallback), newDefault) === 0, "default preview picture: the owner's picture, under 300 KB (" + newDefault.byteLength + " bytes)");
// a link made before keeps a copy of the old default picture: it shows the new one
r = await keyCall(`/api/cases/${link.id}/og`, { method: "PUT", body: readFileSync(new URL("./old-og-3d.jpg", import.meta.url)), headers: { "Content-Type": "image/jpeg" } });
img = await fetch(B + "/og/" + link.id + ".jpg");
ok(r.status === 200 && Buffer.compare(Buffer.from(await img.arrayBuffer()), newDefault) === 0, "a link holding the old default picture shows the new one");
ok(page.includes("/og/" + link.id + ".jpg?v="), "the picture's address carries the site version (chat apps fetch a changed picture)");
r = await owner(`/api/orders/${o1.id}/previews`, { method: "POST", body: { linkId: link.id } });
ok(r.status === 200 && r.data.order.previews.includes(link.id), "3D link attached to the order");
const robots = await (await fetch(B + "/robots.txt")).text();
ok(/Allow: \/v\//.test(robots) && /Allow: \/og\//.test(robots), "robots.txt lets chat apps read link previews");

// ---------- settings changes
r = await ktv("/api/settings", { method: "POST", body: { onlinePay: true } });
ok(r.status === 403, "KTV cannot change settings");
r = await owner("/api/settings", { method: "POST", body: { onlinePay: true } });
ok(r.data.settings.onlinePay === true, "owner switches online payment on");
await new Promise((res) => setTimeout(res, 50));
r = await owner("/api/settings", { method: "POST", body: { onlinePay: false } });
ok(r.data.settings.onlinePay === false, "and off again");

// ---------- customer codes (owner's rule): DR / LAB + year + running number of the year, the prefix follows the kind
const yr = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 4);
r = await owner("/api/customers/next?kind=lab");
ok(r.status === 200 && new RegExp("^LAB" + yr + "\\d{2,}$").test(r.data.code), "next code for a lab: " + r.data.code);
const nLab = (await owner("/api/customers", { method: "POST", body: { name: "Dũng Lab", kind: "lab", currency: "VND" } })).data.customer;
const nDr = (await owner("/api/customers", { method: "POST", body: { name: "Dr Jake (new code)", kind: "doctor" } })).data.customer;
const numOf = (c) => +c.slice(-2);
ok(nLab.code === r.data.code && new RegExp("^DR" + yr + "\\d{2,}$").test(nDr.code) && numOf(nDr.code) === numOf(nLab.code) + 1, "codes given in turn, shared by DR and LAB: " + nLab.code + ", " + nDr.code);
r = await owner("/api/customers", { method: "POST", body: { id: nLab.id, code: nLab.code, name: "Dũng Lab", kind: "doctor", currency: "VND" } });
ok(r.data.customer.code === nLab.code.replace(/^LAB/, "DR"), "changing the kind changes the prefix, keeps the number: " + r.data.customer.code);
r = await ktv("/api/customers/next?kind=lab");
ok(r.status === 403, "KTV cannot reserve customer codes");

// ---------- price lists in the owner's layout: list price (MAX), level 2 (MID), level 3 (MIN), a customer's own, a KTV's pay
const PL = (p1, p2) => [{ no: 7, group: "CROWN & BRIDGE", service: "Full Contour", desc: "Mão răng hoàn thiện toàn phần", unit: "Tooth", price: p1 },
  { no: 30, group: "IMPLANTS", service: "Screw Retained Full Contour Implant", desc: "Phục hình implant toàn phần, bắt vít", unit: "Tooth", price: p2 },
  { no: 48, group: "ORTHODONTICS / ALIGNER", service: "Visualizing Ortho Analyzer", desc: "Trực quan hoá phân tích chỉnh nha", unit: "Case", price: null }];
r = await owner("/api/pricelist", { method: "POST", body: { target: "list", currency: "USD", items: PL(4.28, 6.17), dry: true } });
const cb = r.data.items && r.data.items.find((x) => x.name_en === "Full Contour");
ok(r.status === 200 && cb && cb.code === "CB07" && cb.isNew && r.data.items.find((x) => x.no === 30).code === "IM30" && r.data.noPrice === 1, "dry run: codes from group + number (CB07, IM30), quote-on-request has no price");
ok(!(await owner("/api/products")).data.products.some((p) => p.code === "CB07"), "dry run saves nothing");
r = await owner("/api/pricelist", { method: "POST", body: { target: "list", currency: "USD", items: PL(4.28, 6.17) } });
ok(r.status === 200 && r.data.created === 3 && r.data.priced === 2, "list price imported, 3 codes created");
r = await owner("/api/products");
const cb07 = r.data.products.find((p) => p.code === "CB07"), or48 = r.data.products.find((p) => p.code === "OR48");
ok(cb07 && cb07.name === "Mão răng hoàn thiện toàn phần" && cb07.name_en === "Full Contour" && cb07.grp === "Crown & bridge" && cb07.unit === "unit" && or48 && or48.unit === "case", "products: Vietnamese and English names, group, unit");
await owner("/api/pricelist", { method: "POST", body: { target: "mid", currency: "USD", items: PL(3.83, 5.67) } });
r = await owner("/api/pricelist", { method: "POST", body: { target: "min", currency: "USD", items: PL(3.38, 5.17) } });
ok(r.status === 200 && r.data.created === 0, "levels 2 and 3 match the same codes by name");
r = await owner("/api/prices?tier=mid");
ok(r.data.prices.some((x) => x.product === "CB07" && x.price === 3.83) && !r.data.prices.some((x) => x.product === "OR48"), "level 2 prices stored");
const plC = (await owner("/api/customers", { method: "POST", body: { name: "Level Clinic", kind: "doctor", currency: "USD" } })).data.customer;
const total = async (cid) => (await owner("/api/orders", { method: "POST", body: { customer_id: cid, received: "2026-10-22", items: [{ product: "CB07", qty: 2 }, { product: "IM30", qty: 1 }] } })).data.order.total;
ok(await total(plC.id) === 14.73, "list price for a new customer: 2×4.28 + 6.17");
r = await owner(`/api/customers/${plC.id}/tier`, { method: "POST", body: { tier: "mid" } });
ok(r.status === 200 && await total(plC.id) === 13.33, "level 2 customer: 2×3.83 + 5.67");
await owner(`/api/customers/${plC.id}/tier`, { method: "POST", body: { tier: "min" } });
ok(await total(plC.id) === 11.93, "level 3 customer: 2×3.38 + 5.17");
r = await owner("/api/prices?customer=" + plC.id);
ok(r.data.tier === "min" && r.data.defaults.some((x) => x.product === "CB07" && x.price === 3.38), "the customer's price page shows their level's prices");
r = await owner("/api/pricelist", { method: "POST", body: { target: "customer", customer_id: plC.id, currency: "USD", items: [{ no: 7, group: "CROWN & BRIDGE", service: "Full Contour", unit: "Tooth", price: 3 }] } });
ok(r.status === 200 && await total(plC.id) === 11.17, "a customer's own price wins over the level: 2×3 + 5.17");
r = await owner("/api/customers/" + plC.id);
ok(r.data.customer.tier === "min", "the level is on the customer");
r = await ktv("/api/customers");
ok(r.data.customers.every((c) => !("tier" in c)), "KTV never sees a customer's price level");
r = await ktv("/api/pricelist", { method: "POST", body: { target: "list", currency: "USD", items: PL(1, 1) } });
ok(r.status === 403, "KTV cannot import prices");
r = await ktv("/api/prices?tier=mid");
ok(r.status === 403, "KTV cannot read price levels");
r = await ktv(`/api/customers/${plC.id}/tier`, { method: "POST", body: { tier: "max" } });
ok(r.status === 403, "KTV cannot change a customer's level");
r = await owner("/api/pricelist", { method: "POST", body: { target: "tech", email: KTV2, currency: "VND", from: "2026-01-01", items: [{ no: 7, group: "CROWN & BRIDGE", service: "Full Contour", unit: "Tooth", price: 60000 }] } });
ok(r.status === 200 && r.data.priced === 1, "a KTV's pay imported from the same layout");
r = await owner("/api/techrates");
ok(r.data.rates.some((x) => x.email === KTV2 && x.product === "CB07" && x.rate === 60000 && x.currency === "VND"), "pay rate stored for that KTV");
r = await owner("/api/pricelist", { method: "POST", body: { target: "nope", items: PL(1, 1) } });
ok(r.status === 400, "an unknown price list is refused");

// ---------- old customer codes (JAKE…) move to DR / LAB codes; their orders follow
const jBefore = (await owner("/api/customers/" + jake)).data.customer.code;
r = await owner("/api/customers/recode", { method: "POST" });
const jAfter = (await owner("/api/customers/" + jake)).data.customer.code;
ok(r.status === 200 && r.data.changed.some((x) => x.from === jBefore && x.code === jAfter) && /^DR\d{6,}$/.test(jAfter), "old code " + jBefore + " → " + jAfter);
r = await owner("/api/orders?status=&customer=" + jake + "&limit=5");
ok(r.data.items.length > 0 && r.data.items.every((x) => x.customer_code === jAfter), "the customer's orders show the new code");
r = await owner("/api/orders?status=&q=" + encodeURIComponent(jAfter));
ok(r.data.items.some((x) => x.customer_code === jAfter), "search finds the new customer code");
r = await owner("/api/customers/recode", { method: "POST" });
ok(r.data.changed.length === 0, "nothing left to re-code");

done();
