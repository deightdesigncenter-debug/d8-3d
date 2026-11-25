// Price walls (owner's rule 2026-11-25): a KTV or QC never sees what a customer pays (the customer's own prices, the list and
// tier prices, order totals, payments), and a customer never sees what a KTV is paid. The test gives every price a number
// that appears nowhere else, then reads every page the workspace and the portal use, as each person, and looks for it.
// The admin here is the upload key, so no real account is used.
import { B, PW, ok, done, signin, uniq } from "./lib.mjs";

const key = (path, opts = {}) => fetch(B + path, { ...opts, headers: { "X-Upload-Key": PW, "X-D8": "1", "Content-Type": "application/json" },
  body: opts.body ? JSON.stringify(opts.body) : undefined }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));
const day = new Date().toISOString().slice(0, 10), month = day.slice(0, 7);

// the numbers: what the customer pays, and what the KTV is paid (none of them a round number, so they cannot appear by chance)
const CUST = { price: "137.13", total: "274.26", paid: "61.17", due: "213.09", list: "88.19", mid: "77.31", min: "66.43" };
const TECH = { rate: "23.71", cost: "47.42" };
const found = (text, nums) => Object.entries(nums).filter(([, n]) => text.includes(n)).map(([k, n]) => k + "=" + n);

// ---------- people and data
const ktvMail = uniq("pk") + "@team.example", ktv2Mail = uniq("pk2") + "@team.example", qcMail = uniq("pq") + "@team.example";
for (const [email, role] of [[ktvMail, "designer"], [ktv2Mail, "designer"], [qcMail, "qc"]]) await key("/api/staff", { method: "POST", body: { email, role } });
const ktv = await signin(ktvMail, "KTV Price"), ktv2 = await signin(ktv2Mail, "KTV Other"), qc = await signin(qcMail, "QC Price");
const emA = uniq("pa") + "@clinic.example", A = await signin(emA, "Clinic A");

// the price list as the owner imports it (list, then the two levels), the customer's own price, the KTV's pay
const svc = uniq("Wall Crown ");
const NO = 60 + Math.floor(Math.random() * 39);
const PL = (price) => [{ no: NO, group: "CROWN & BRIDGE", service: svc, desc: "Mão thử tường giá", unit: "Tooth", price }];
let r = await key("/api/pricelist", { method: "POST", body: { target: "list", currency: "USD", items: PL(+CUST.list) } });
ok(r.status === 200, "the list price is imported");
const code = (((await key("/api/products")).data.products || []).find((x) => x.name_en === svc) || {}).code;
ok(!!code, "the service has a code: " + code);
for (const [target, price] of [["mid", CUST.mid], ["min", CUST.min]]) {
  r = await key("/api/pricelist", { method: "POST", body: { target, currency: "USD", items: PL(+price) } });
  ok(r.status === 200, "the " + target + " level price is imported");
}
r = await key("/api/customers", { method: "POST", body: { name: uniq("Dr Wall "), kind: "doctor", currency: "USD" } });
const cid = r.data.customer.id;
r = await key("/api/prices", { method: "POST", body: { customer: cid, currency: "USD", items: [{ product: code, price: +CUST.price }] } });
ok(r.status === 200, "the customer's own price");
await key(`/api/customers/${cid}/logins`, { method: "POST", body: { email: emA } });
r = await key("/api/techrates", { method: "POST", body: { email: ktvMail, currency: "USD", from: "2026-01-01", items: [{ product: code, rate: +TECH.rate }] } });
ok(r.status === 200, "the KTV's pay for this service");

r = await key("/api/orders", { method: "POST", body: { customer_id: cid, received: day, patient: "Wall Patient", ref: "PW-1", items: [{ product: code, qty: 2 }] } });
ok(r.status === 201 && r.data.order.total === +CUST.total, "an order of 2 at the customer's price: " + (r.data.order && r.data.order.total));
const oid = r.data.order.id;
await key("/api/orders/" + oid, { method: "POST", body: { designer: ktvMail, qc: qcMail } });
r = await key("/api/payments", { method: "POST", body: { order_id: oid, day, amount: +CUST.paid, method: "paypal" } });
ok(r.status === 200 || r.status === 201, "a part payment");
r = await key("/api/orders/" + oid);
ok(r.data.order.total === +CUST.total && String(r.data.order.tech_cost || r.data.order.techCost || "").includes(TECH.cost) || JSON.stringify(r.data).includes(TECH.cost), "the owner sees the total and the KTV's pay");
// the KTV works the order: a message, a file sent to the customer
await ktv(`/api/orders/${oid}/chat`, { method: "POST", body: { text: "design done" } });
await fetch(`${B}/api/orders/${oid}/files/PriceWall1/0`, { method: "PUT", headers: { ...ktv.headers, "Content-Type": "application/octet-stream" }, body: Buffer.alloc(2000, 1) });
await ktv(`/api/orders/${oid}/files`, { method: "POST", body: { files: [{ fid: "PriceWall1", name: "wall.stl", size: 2000, stored: 2000, parts: 1, gz: 0 }], final: true } });
// a portal case of the same customer, priced, given to the same KTV
r = await A("/api/my/jobs", { method: "POST", body: { title: "", service: "Crown & bridge", teeth: "11" } });
const jid = r.data.job.id;
r = await key("/api/jobs/" + jid);
const poid = r.data.job.orderId;
await key("/api/orders/" + poid, { method: "POST", body: { designer: ktvMail, items: [{ product: code, qty: 2 }] } });

// ---------- the customer, while their record does not show prices: no money at all
const custPages = ["/api/me", "/api/my/profile", "/api/my/jobs", "/api/jobs/" + jid, "/api/my/orders", "/api/my/orders/" + oid, "/api/my/orders/" + poid, "/api/config"];
const scanCustomer = async (nums) => {
  const out = [];
  for (const p of custPages) { const text = await (await fetch(B + p, { headers: A.headers })).text(); const bad = found(text, nums); if (bad.length) out.push(p + " → " + bad.join(", ")); }
  return out;
};
let cleaks = await scanCustomer({ ...CUST, ...TECH });
ok(!cleaks.length, "prices off: the customer sees no money" + (cleaks.length ? " — " + cleaks.join(" | ") : ""));

// ---------- "show prices" is switched on the customer record, only by someone who may change money
for (const [who, label] of [[ktv, "the KTV"], [qc, "the QC"], [A, "the customer"]]) {
  r = await who(`/api/customers/${cid}/showprices`, { method: "POST", body: { on: true } });
  ok(r.status === 403 || r.status === 401, label + " cannot switch prices on (" + r.status + ")");
}
r = await key(`/api/customers/${cid}/showprices`, { method: "POST", body: { on: true } });
ok(r.status === 200 && r.data.show_prices === true, "the owner shows this customer their prices");
r = await key("/api/customers/" + cid);
ok(r.data.customer.show_prices === true, "the customer record says so");
r = await ktv("/api/customers/" + cid);
ok(!("show_prices" in (r.data.customer || {})), "a KTV does not even see the switch (" + r.status + ")");

// ---------- every page the workspace uses, read by the KTV of the order, the QC, and another KTV (prices shown to the customer)
const enc = encodeURIComponent;
const pages = (self) => ["/api/me", "/api/config", "/api/orders", "/api/orders?q=PW-1", `/api/orders?customer=${cid}&status=&limit=12`, "/api/orders/" + oid,
  `/api/orders/${oid}/chat?after=0&read=0`, `/api/orders/${oid}/previews`, "/api/orders/" + poid, "/api/orders/dash", "/api/orders/unread", "/api/todo",
  `/api/orders/dupes?patient=${enc("Wall Patient")}&ref=PW-1&customer=${cid}`, `/api/orders/next-code?day=${day}`,
  "/api/products", "/api/customers", "/api/customers/" + cid, `/api/customers/${cid}/traits`, `/api/prices?customer=${cid}`, "/api/prices?all=1", "/api/prices?tier=mid",
  "/api/prices?tier=max", "/api/techrates", `/api/tech?month=${month}&basis=received`, `/api/tech/${enc(self)}?month=${month}&basis=received`,
  `/api/tech/${enc(ktvMail)}?month=${month}&basis=received`, `/api/reports?from=2026-01-01&to=2026-12-31`, "/api/payments", `/api/payments?customer=${cid}`,
  `/api/export?from=2026-01-01&to=2026-12-31&offset=0`, "/api/staff/team", "/api/staff", "/api/roles", "/api/settings", "/api/book/status",
  "/api/admin/jobs", "/api/jobs/" + jid, "/api/list", "/api/messages", "/api/admin/users"];
// (the KTV of the order may see their own pay for it; nobody else on the team sees a KTV's pay)
for (const [who, email, label, ownPay] of [[ktv, ktvMail, "KTV of the order", true], [qc, qcMail, "QC of the order", false], [ktv2, ktv2Mail, "another KTV", false]]) {
  const leaks = [], read = [];
  for (const p of pages(email)) {
    const res = await fetch(B + p, { headers: who.headers });
    const text = await res.text();
    if (res.status === 200) read.push(p);
    // what the customer pays: never
    const bad = found(text, CUST).concat(ownPay ? [] : found(text, TECH));
    if (bad.length) leaks.push(p + " → " + bad.join(", "));
  }
  ok(read.length >= 8, label + ": reads " + read.length + " workspace pages");
  ok(!leaks.length, label + ": no customer price anywhere" + (leaks.length ? " — LEAK " + leaks.join(" | ") : ""));
}
// the KTV still sees their own pay for the order on their own page
r = await ktv(`/api/tech/${enc(ktvMail)}?month=${month}&basis=received`);
ok(r.status === 200 && JSON.stringify(r.data).includes(TECH.cost), "the KTV sees their own pay for the order");

// ---------- the customer with prices shown: their own prices, totals and balance; never the KTV's pay, list or level prices
r = await A("/api/my/orders");
const row = (r.data.items || []).find((x) => x.id === oid), bal = (r.data.balance || []).find((x) => x.currency === "USD") || {};
ok(row && row.money && row.money.total === +CUST.total && row.money.paid === +CUST.paid && row.money.due === +CUST.due, "list: the order's total, paid and left to pay");
ok(bal.billed === 2 * +CUST.total && bal.paid === +CUST.paid && bal.due === Math.round((2 * +CUST.total - +CUST.paid) * 100) / 100 && bal.credit === 0, "list: the account balance as the staff see it " + JSON.stringify(bal));
r = await A("/api/my/orders/" + oid);
const ch = r.data.order.charges || {}, it = (ch.items || [])[0] || {};
ok(ch.total === +CUST.total && ch.paid === +CUST.paid && ch.due === +CUST.due && ch.currency === "USD", "order page: total, paid, left to pay");
ok(it.qty === 2 && it.price === +CUST.price && it.amount === +CUST.total && it.name === svc, "order page: the service in English, 2 × the customer's own price");
ok(!JSON.stringify(ch).includes(code) && !("note" in it) && !("product" in it), "order page: no product code or item note");
r = await A("/api/jobs/" + jid);
ok(r.data.job.charges && r.data.job.charges.total === +CUST.total && !("orderId" in r.data.job), "the portal case shows the money of its order");
cleaks = await scanCustomer({ ...TECH, list: CUST.list, mid: CUST.mid, min: CUST.min });
ok(!cleaks.length, "prices on: still no KTV pay, no list or level prices" + (cleaks.length ? " — LEAK " + cleaks.join(" | ") : ""));
// a same-day surcharge shows as its own line
r = await key("/api/orders", { method: "POST", body: { customer_id: cid, received: day, ref: "PW-2", adj_pct: 50, items: [{ product: code, qty: 1 }] } });
const o2 = r.data.order;
r = await A("/api/my/orders/" + o2.id);
ok(r.data.order.charges.adj_pct === 50 && r.data.order.charges.subtotal === +CUST.price && r.data.order.charges.total === o2.total, "a 50% same-day surcharge: subtotal, surcharge, total " + o2.total);
// a free order says so, and asks nothing
r = await key("/api/orders", { method: "POST", body: { customer_id: cid, received: day, ref: "PW-3", charge: "free", items: [{ product: code, qty: 1 }] } });
const o3 = r.data.order;
r = await A("/api/my/orders/" + o3.id);
ok(r.data.order.charges.charge === "free" && r.data.order.charges.total === 0 && r.data.order.charges.due === 0, "a free order: no charge, nothing to pay");
// switched off again: the money disappears
r = await key(`/api/customers/${cid}/showprices`, { method: "POST", body: { on: false } });
r = await A("/api/my/orders/" + oid);
ok(!("charges" in r.data.order) && !(await A("/api/my/orders")).data.balance, "switched off: no money on the order or the list");
r = await key(`/api/customers/${cid}/showprices`, { method: "POST", body: { on: true } });
for (const p of ["/api/orders/" + oid, `/api/orders/${oid}/chat?after=0`, "/api/tech", "/api/techrates", `/api/prices?customer=${cid}`, "/api/products", "/api/reports"]) {
  const res = await fetch(B + p, { headers: A.headers });
  ok(res.status === 401 || res.status === 403, "customer: no staff page " + p + " (" + res.status + ")");
}

// ---------- "view as customer": staff who see customers and money see exactly the customer's portal, read only
const mgrMail = uniq("pm") + "@team.example";
await key("/api/staff", { method: "POST", body: { email: mgrMail, role: "admin" } });
const mgr = await signin(mgrMail, "Manager Preview");
const pv = "/api/my/preview/" + cid;
for (const [who, label] of [[ktv, "the KTV"], [qc, "the QC"], [ktv2, "another KTV"], [A, "the customer"]]) {
  for (const p of [pv, pv + "/orders", pv + "/orders/" + oid, pv + "/jobs", pv + "/jobs/" + jid, pv + `/orders/${oid}/files/PriceWall1`]) {
    const res = await fetch(B + p, { headers: who.headers });
    if (res.status !== 403) ok(false, label + " must not preview " + p + " (" + res.status + ")");
  }
}
ok(true, "KTV, QC, another KTV and the customer cannot use the preview (403 on every preview page)");
r = await mgr(pv);
ok(r.status === 200 && r.data.customer.id === cid && r.data.customer.show_prices === true && r.data.accounts === 1, "a manager opens the preview of the customer");
const mine = (await A("/api/my/orders")).data, seen = (await mgr(pv + "/orders")).data;
ok(JSON.stringify(seen.items.map((x) => x.id).sort()) === JSON.stringify(mine.items.map((x) => x.id).sort()) && JSON.stringify(seen.balance) === JSON.stringify(mine.balance),
  "preview list = what the customer's account sees (same orders, same balance)");
const a1 = (await A("/api/my/orders/" + oid)).data.order, p1 = (await mgr(pv + "/orders/" + oid)).data.order;
ok(JSON.stringify(a1) === JSON.stringify(p1), "preview order page = the customer's order page, field for field");
ok((await mgr(pv + "/orders/" + poid)).data.order.case === jid, "an order from the customer's portal case points to the case in the preview too");
r = await mgr(pv + "/jobs");
ok((r.data.items || []).some((x) => x.id === jid), "preview: the customer's portal cases");
r = await mgr(pv + "/jobs/" + jid);
const aj = (await A("/api/jobs/" + jid)).data.job;
ok(r.status === 200 && r.data.job.charges && r.data.job.charges.total === aj.charges.total && !("designer" in r.data.job) && !("team" in r.data.job) && !("ai" in r.data.job),
  "preview case page = the customer's view (no designer, team notes or AI notes)");
let res = await fetch(B + pv + `/orders/${oid}/files/PriceWall1`, { headers: mgr.headers });
ok(res.status === 200 && (await res.arrayBuffer()).byteLength === 2000, "preview: the sent file downloads");
cleaks = [];
for (const p of [pv, pv + "/orders", pv + "/orders/" + oid, pv + "/orders/" + poid, pv + "/jobs", pv + "/jobs/" + jid]) {
  const bad = found(await (await fetch(B + p, { headers: mgr.headers })).text(), { ...TECH, list: CUST.list, mid: CUST.mid, min: CUST.min });
  if (bad.length) cleaks.push(p + " → " + bad.join(", "));
}
ok(!cleaks.length, "preview: no KTV pay, no list or level prices (only what the customer sees)" + (cleaks.length ? " — " + cleaks.join(" | ") : ""));
r = await mgr(pv + "/orders/" + oid, { method: "POST", body: {} });
ok(r.status === 405, "preview is read only (" + r.status + ")");
r = await mgr("/api/my/preview/999999");
ok(r.status === 404, "preview of an unknown customer: not found");

done();
