// Files sent to the customer (owner's rule 2026-11-25): the KTV of an order sends a team-chat file to the customer and it shows
// in the customer portal at once. Every portal account linked to the customer record sees all that customer's orders; the team
// chat, the staff, the prices and every file not sent stay internal. A customer record can say "pay first": the files of an
// order download only once it is paid (the picture and the list stay visible). Orders that came from a portal case show the
// sent files on that case. The admin here is the upload key, so no real account is used.
import { B, PW, ok, done, signin, uniq } from "./lib.mjs";

const key = (path, opts = {}) => fetch(B + path, { ...opts, headers: { "X-Upload-Key": PW, "X-D8": "1", "Content-Type": "application/json", ...(opts.headers || {}) },
  body: opts.body ? JSON.stringify(opts.body) : undefined }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));
const sql = async (q, params = []) => (await fetch(B + "/__test/exec", { method: "POST", body: JSON.stringify({ sql: q, params }) })).json();
const get = (who, path) => fetch(B + path, { headers: who.headers });
const bytes = async (res) => Buffer.from(await res.arrayBuffer());
const day = new Date().toISOString().slice(0, 10);

// ---------- people: two accounts of one lab, a stranger, the KTV of the order, another KTV, a QC
const emA = uniq("senta") + "@lab.example", emB = uniq("sentb") + "@lab.example";
const A = await signin(emA, "Sent Lab A"), Bb = await signin(emB, "Sent Lab B"), stranger = await signin(uniq("sentx") + "@lab.example", "Stranger");
const ktvMail = uniq("sk") + "@team.example", ktv2Mail = uniq("sk2") + "@team.example", qcMail = uniq("sq") + "@team.example";
for (const [email, role] of [[ktvMail, "designer"], [ktv2Mail, "designer"], [qcMail, "qc"]]) await key("/api/staff", { method: "POST", body: { email, role } });
const ktv = await signin(ktvMail, "KTV Sent"), ktv2 = await signin(ktv2Mail, "KTV Other"), qc = await signin(qcMail, "QC Sent");

const code = uniq("SF").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
let r = await key("/api/products", { method: "POST", body: { items: [{ code, name: "Sent test crown", grp: "Crown & bridge", unit: "unit", price_usd: 40, price_vnd: 900000 }] } });
ok(r.status === 200, "a product with a list price");
r = await key("/api/customers", { method: "POST", body: { name: uniq("Sent Lab "), kind: "lab", currency: "USD" } });
ok(r.status === 200 && r.data.customer && r.data.customer.id, "a customer record");
const cid = r.data.customer.id;
for (const em of [emA, emB]) { r = await key(`/api/customers/${cid}/logins`, { method: "POST", body: { email: em } }); ok(r.status === 200, "a portal account is linked to the customer"); }

r = await key("/api/orders", { method: "POST", body: { customer_id: cid, received: day, patient: "Sent Patient", ref: "SP-1", items: [{ product: code, qty: 1 }] } });
ok(r.status === 201 && r.data.order.total === 40, "an order of 40 USD is entered in the workspace (" + (r.data.order && r.data.order.total) + ")");
const oid = r.data.order.id;
r = await key("/api/orders/" + oid, { method: "POST", body: { designer: ktvMail, qc: qcMail } });
ok(r.status === 200, "the order is given to the KTV and the QC");

// the KTV puts two files in the team chat: one only for the team, one sent to the customer as well
const stl1 = Buffer.alloc(4000, 3), stl2 = Buffer.alloc(5000, 5), stl3 = Buffer.alloc(3000, 8);
const up = async (who, fid, data) => (await fetch(`${B}/api/orders/${oid}/files/${fid}/0`, { method: "PUT", headers: { ...who.headers, "Content-Type": "application/octet-stream" }, body: data })).status;
ok((await up(ktv, "SentIntern", stl1)) === 200 && (await up(ktv, "SentFinal1", stl2)) === 200, "the KTV stores two files");
r = await ktv(`/api/orders/${oid}/files`, { method: "POST", body: { files: [{ fid: "SentIntern", name: "draft-internal.stl", size: stl1.length, stored: stl1.length, parts: 1, gz: 0 }], text: "for QC only" } });
ok(r.status === 200, "a file for the team only");
r = await ktv(`/api/orders/${oid}/files`, { method: "POST", body: { files: [{ fid: "SentFinal1", name: "crown-final.stl", size: stl2.length, stored: stl2.length, parts: 1, gz: 0 }], text: "done", final: true } });
ok(r.status === 200 && (r.data.fids || []).includes("SentFinal1"), "a file sent to the customer straight from the upload");
ok((await up(qc, "SentByQc01", stl3)) === 200, "the QC stores a file");
r = await qc(`/api/orders/${oid}/files`, { method: "POST", body: { files: [{ fid: "SentByQc01", name: "qc.stl", size: stl3.length, stored: stl3.length, parts: 1, gz: 0 }], final: true } });
ok(r.status === 403, "a QC (no delivery, not the designer) cannot send a file to the customer (" + r.status + ")");

// ---------- the customer: both linked accounts see the order and only the sent file
for (const [who, label] of [[A, "account A"], [Bb, "account B"]]) {
  r = await who("/api/my/orders");
  const row = (r.data.items || []).find((x) => x.id === oid);
  ok(r.status === 200 && row && row.files === 1 && row.code && row.status === "in_design" && !("designer" in row), label + ": the order is in the list with 1 file");
}
r = await A("/api/my/orders/" + oid);
const det = r.data.order || {};
ok(r.status === 200 && det.files.length === 1 && det.files[0].name === "crown-final.stl" && det.locked === false, "detail: only the sent file, not locked");
const txt = JSON.stringify(r.data);
ok(!txt.includes(ktvMail) && !txt.includes(qcMail) && !txt.includes("draft-internal") && !txt.includes("for QC only") && !/"(total|paid|price|subtotal|designer|qc|due|by)"/.test(txt),
  "detail: no KTV, no QC, no internal file or chat, no price");
let res = await get(A, `/api/my/orders/${oid}/files/SentFinal1`);
ok(res.status === 200 && Buffer.compare(await bytes(res), stl2) === 0, "the customer downloads the sent file byte for byte");
res = await get(Bb, `/api/my/orders/${oid}/files/SentFinal1`);
ok(res.status === 200, "the other account of the same customer downloads it too");
res = await get(A, `/api/my/orders/${oid}/files/SentIntern`);
ok(res.status === 404, "a file not sent stays internal (" + res.status + ")");
res = await get(A, `/api/orders/${oid}/files/SentFinal1`);
ok(res.status === 403, "the customer cannot use the team's download (" + res.status + ")");
r = await A(`/api/orders/${oid}/chat?after=0`);
ok(r.status === 403, "the customer cannot read the team chat (" + r.status + ")");

// a stranger, and the methods the portal does not offer
r = await stranger("/api/my/orders");
ok(r.status === 200 && !(r.data.items || []).some((x) => x.id === oid), "another customer does not see the order");
r = await stranger("/api/my/orders/" + oid);
ok(r.status === 404, "another customer: order not found");
res = await get(stranger, `/api/my/orders/${oid}/files/SentFinal1`);
ok(res.status === 404, "another customer cannot download the file (" + res.status + ")");
r = await A("/api/my/orders/" + oid, { method: "POST", body: {} });
ok(r.status === 405, "the customer cannot change an order (" + r.status + ")");

// ---------- send and take back from the chat
r = await ktv2(`/api/orders/${oid}/files/SentIntern/send`, { method: "POST", body: { on: true } });
ok(r.status === 404, "a KTV not on the order cannot send its files (" + r.status + ")");
r = await qc(`/api/orders/${oid}/files/SentIntern/send`, { method: "POST", body: { on: true } });
ok(r.status === 403, "the QC of the order cannot send its files (" + r.status + ")");
r = await A(`/api/orders/${oid}/files/SentIntern/send`, { method: "POST", body: { on: true } });
ok(r.status === 403, "a customer cannot send files (" + r.status + ")");
r = await ktv(`/api/orders/${oid}/files/NoSuchFile/send`, { method: "POST", body: { on: true } });
ok(r.status === 404, "an unknown file cannot be sent");
r = await ktv(`/api/orders/${oid}/files/SentIntern/send`, { method: "POST", body: { on: true } });
ok(r.status === 200 && r.data.final === true && r.data.changed === true, "the KTV sends the earlier file");
r = await ktv(`/api/orders/${oid}/files/SentIntern/send`, { method: "POST", body: { on: true } });
ok(r.status === 200 && r.data.changed === false, "sending twice changes nothing");
r = await A("/api/my/orders/" + oid);
ok((r.data.order.files || []).length === 2, "the customer sees it at once");
r = await ktv(`/api/orders/${oid}/chat?after=0&read=0`);
const msgs = r.data.msgs || [];
ok(msgs.some((m) => /Đã gửi khách: draft-internal\.stl/.test(m.text)) && msgs.some((m) => /Đã gửi khách: crown-final\.stl/.test(m.text)), "the team chat notes each file sent");
ok((r.data.finals || []).length === 2 && msgs.some((m) => (m.files || []).some((f) => f.fid === "SentFinal1" && f.final === 1)), "chat: sent files are marked");
r = await ktv(`/api/orders/${oid}/files/SentIntern/send`, { method: "POST", body: { on: false } });
ok(r.status === 200 && r.data.final === false, "the KTV takes it back");
r = await A("/api/my/orders/" + oid);
ok((r.data.order.files || []).length === 1, "taken back: gone from the portal");
res = await get(A, `/api/my/orders/${oid}/files/SentIntern`);
ok(res.status === 404, "taken back: no longer downloads");
r = await key(`/api/orders/${oid}/files/SentIntern/send`, { method: "POST", body: { on: true } });
ok(r.status === 200, "someone who may deliver sends it again (not the KTV)");
r = await key(`/api/orders/${oid}/files/SentIntern/send`, { method: "POST", body: { on: false } });

// ---------- the order page for staff: what the customer gets
r = await key("/api/orders/" + oid);
ok(r.status === 200 && r.data.sent.length === 1 && r.data.portal.accounts === 2 && r.data.portal.canSend === true && r.data.portal.payFirst === false && r.data.portal.locked === false,
  "order page: sent files, 2 portal accounts, not pay-first");
r = await ktv("/api/orders/" + oid);
ok(r.status === 200 && r.data.sent.length === 1 && r.data.portal.canSend === true && !("payFirst" in r.data.portal) && !("locked" in r.data.portal),
  "order page for the KTV: may send, nothing about payment");
r = await qc("/api/orders/" + oid);
ok(r.status === 200 && r.data.portal.canSend === false, "order page for the QC: may not send");

// ---------- pay first
r = await ktv(`/api/customers/${cid}/payfirst`, { method: "POST", body: { on: true } });
ok(r.status === 403, "a KTV cannot change pay-first (" + r.status + ")");
r = await key(`/api/customers/${cid}/payfirst`, { method: "POST", body: { on: true } });
ok(r.status === 200 && r.data.pay_first === true, "the customer record says pay first");
r = await key(`/api/customers/${cid}`);
ok(r.data.customer.pay_first === true, "the customer record shows it");
r = await A("/api/my/orders/" + oid);
ok(r.data.order.locked === true && r.data.order.due === 40 && r.data.order.currency === "USD" && r.data.order.files.length === 1, "unpaid: locked, 40 USD due, the file still listed");
res = await get(A, `/api/my/orders/${oid}/files/SentFinal1`);
ok(res.status === 402, "unpaid: the download waits for payment (" + res.status + ")");
r = await key("/api/orders/" + oid);
ok(r.data.portal.payFirst === true && r.data.portal.locked === true, "order page: locked until paid");
r = await key("/api/payments", { method: "POST", body: { order_id: oid, day, amount: 25, method: "paypal" } });
ok(r.status === 200 || r.status === 201, "a part payment");
res = await get(A, `/api/my/orders/${oid}/files/SentFinal1`);
ok(res.status === 402, "part paid: still locked");
r = await key("/api/payments", { method: "POST", body: { order_id: oid, day, amount: 15, method: "paypal" } });
res = await get(A, `/api/my/orders/${oid}/files/SentFinal1`);
ok(res.status === 200 && Buffer.compare(await bytes(res), stl2) === 0, "paid in full: the file downloads");
r = await A("/api/my/orders/" + oid);
ok(r.data.order.locked === false && !("due" in r.data.order), "paid: not locked, nothing due");

// ---------- an order from a portal case: the sent files show on the case
r = await A("/api/my/jobs", { method: "POST", body: { title: "", service: "Crown & bridge", teeth: "36" } });
ok(r.status === 201, "the customer sends a case from the portal");
const jid = r.data.job.id;
r = await key("/api/jobs/" + jid);
const poid = (r.data.job || {}).orderId;
ok(r.status === 200 && poid > 0, "the case has its order in the book");
r = await A("/api/my/orders");
ok(!(r.data.items || []).some((x) => x.id === poid), "an order from a portal case is not listed twice (it shows as the case)");
const upP = async (fid, data) => (await fetch(`${B}/api/orders/${poid}/files/${fid}/0`, { method: "PUT", headers: { "X-Upload-Key": PW, "X-D8": "1", "Content-Type": "application/octet-stream" }, body: data })).status;
ok((await upP("CaseFinal1", stl3)) === 200, "a file for the case's order is stored");
r = await key(`/api/orders/${poid}/files`, { method: "POST", body: { files: [{ fid: "CaseFinal1", name: "case-crown.stl", size: stl3.length, stored: stl3.length, parts: 1, gz: 0 }], final: true } });
ok(r.status === 200, "it is sent to the customer");
r = await A("/api/my/jobs");
const jrow = (r.data.items || []).find((x) => x.id === jid);
ok(jrow && jrow.lastBy === "admin", "the case in the customer's list shows a new update from D.EIGHT");
r = await Bb("/api/my/orders");
ok((r.data.items || []).some((x) => x.id === poid && x.files === 1), "the other account of the lab sees that case as an order with its file");
r = await Bb("/api/my/orders/" + poid);
ok(r.status === 200 && r.data.order.case === "" && r.data.order.files.length === 1, "the other account: order page, not the case (it did not send it)");
r = await A("/api/my/orders/" + poid);
ok(r.status === 200 && r.data.order.case === jid, "the account that sent the case is pointed to it");
r = await A("/api/jobs/" + jid);
const sent = (r.data.job || {}).sent || [];
ok(r.status === 200 && sent.length === 1 && sent[0].url === `/api/my/orders/${poid}/files/CaseFinal1` && !("orderId" in r.data.job), "the case shows the sent file (the order id stays internal)");
ok(r.data.job.sentLocked === false, "the case is not locked (no payment asked)");
res = await get(A, sent[0].url);
ok(res.status === 200 && Buffer.compare(await bytes(res), stl3) === 0, "the customer downloads it from the case");
res = await get(stranger, sent[0].url);
ok(res.status === 404, "another customer cannot (" + res.status + ")");
// pay first + the case waits for payment: locked
await sql("UPDATE jobs SET doc = json_set(doc, '$.pay', 'due'), ver = ver + 1 WHERE id = ?", [jid]);
r = await A("/api/jobs/" + jid);
ok(r.data.job.sentLocked === true, "case waiting for payment: the sent files are locked");
res = await get(A, sent[0].url);
ok(res.status === 402, "case waiting for payment: the download waits (" + res.status + ")");
await sql("UPDATE jobs SET doc = json_set(doc, '$.pay', 'paid'), ver = ver + 1 WHERE id = ?", [jid]);
res = await get(A, sent[0].url);
ok(res.status === 200, "case paid: the file downloads");

// ---------- pay first off again, a cancelled order disappears
r = await key(`/api/customers/${cid}/payfirst`, { method: "POST", body: { on: false } });
ok(r.status === 200 && r.data.pay_first === false, "pay first is turned off");
await sql("UPDATE orders SET status = 'cancelled' WHERE id = ?", [oid]);
r = await A("/api/my/orders");
ok(!(r.data.items || []).some((x) => x.id === oid), "a cancelled order leaves the list");
r = await A("/api/my/orders/" + oid);
ok(r.status === 404, "a cancelled order is not found");

done();
