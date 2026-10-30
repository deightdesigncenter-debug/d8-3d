// Two KTVs side by side: each sees only their own work. No other KTV's orders, chats, files, portal cases, 3D links,
// pay rates, pay or page; no customer prices, revenue, debts, reports, customers, staff, settings or admin actions.
// Run against: PAY=1 node dev/server.mjs public 8788 mat-khau-thu
import { B, PW, ok, done, signin, uniq } from "./lib.mjs";

const owner = await signin("d.eightdesigncenter@gmail.com", "D.EIGHT");
let r;
const A = uniq("ktva") + "@d8.example", Bm = uniq("ktvb") + "@d8.example", QC = uniq("qcp") + "@d8.example";
for (const [e, role] of [[A, "designer"], [Bm, "designer"], [QC, "qc"]]) await owner("/api/staff", { method: "POST", body: { email: e, role } });
const ka = await signin(A, "An KTV"), kb = await signin(Bm, "Bình KTV"), qc = await signin(QC, "Quân QC");

// the book: a customer with its own prices, one order for each KTV, pay rates for each
await owner("/api/products/sample", { method: "POST" });
const CC = uniq("PV").toUpperCase().slice(0, 10);
const cust = (await owner("/api/customers", { method: "POST", body: { code: CC, name: "Private Dental", currency: "USD", kind: "clinic", phone: "+1 555 0100" } })).data.customer;
await owner("/api/prices", { method: "POST", body: { customer: cust.id, currency: "USD", items: [{ product: "CR", price: 33 }] } });
const mk = async (designer, patient) => (await owner("/api/orders", { method: "POST", body: { customer_id: cust.id, received: "2026-10-21", patient, designer, qc: QC, items: [{ product: "CR", qty: 2 }] } })).data.order;
const oa = await mk(A, "Patient Of A"), ob = await mk(Bm, "Patient Of B");
ok(oa && ob && oa.designer === A && ob.designer === Bm, "one order for each KTV");
await owner("/api/techrates", { method: "POST", body: { email: A, currency: "VND", from: "2026-01-01", items: [{ product: "CR", rate: 111000 }] } });
await owner("/api/techrates", { method: "POST", body: { email: Bm, currency: "VND", from: "2026-01-01", items: [{ product: "CR", rate: 222000 }] } });
await kb(`/api/orders/${ob.id}/chat`, { method: "POST", body: { text: "Ghi chú riêng của B" } });

// ---------- orders: only one's own
r = await ka("/api/orders?status=&limit=200");
ok(r.status === 200 && r.data.items.some((x) => x.id === oa.id) && !r.data.items.some((x) => x.id === ob.id), "KTV A lists only their own order");
ok(r.data.items.every((x) => x.designer === A || x.qc === A), "nothing assigned to someone else in A's list");
ok(r.data.items.every((x) => !("total" in x) && !("paid" in x) && !("due" in x) && !("currency" in x)), "no money in A's list");
ok(!("sums" in r.data) || !r.data.sums || r.data.sums.length === 0, "no money totals in A's list");
r = await ka("/api/orders?status=&q=" + encodeURIComponent("Patient Of B"));
ok(r.status === 200 && !r.data.items.some((x) => x.id === ob.id) && r.data.items.every((x) => x.designer === A || x.qc === A), "searching B's patient never finds B's order for A");
r = await ka("/api/orders/" + ob.id);
ok(r.status === 404, "A cannot open B's order");
r = await ka(`/api/orders/${ob.id}/chat`);
ok(r.status === 404, "A cannot read B's order chat");
r = await ka(`/api/orders/${ob.id}/chat`, { method: "POST", body: { text: "xin chào" } });
ok(r.status === 404, "A cannot write in B's order chat");
r = await ka(`/api/orders/${ob.id}/act`, { method: "POST", body: { action: "submit" } });
ok(r.status === 404, "A cannot act on B's order");
r = await ka("/api/orders/" + oa.id);
ok(r.status === 200 && !("total" in r.data.order) && r.data.items.every((x) => !("price" in x) && !("amount" in x)) && !r.data.payments && !r.data.customer, "A's own order: no price, no payments, no customer contact");
ok(r.data.order.tech_cost === 2 * 111000, "A sees their own pay on their order, at A's rate (" + r.data.order.tech_cost + ")");
await ka(`/api/orders/${oa.id}/chat`); // A reads their own order's chat
await kb(`/api/orders/${ob.id}/chat`, { method: "POST", body: { text: "Ghi chú riêng thứ hai của B" } });
r = await ka("/api/orders/unread");
ok(r.status === 200 && r.data.count === 0, "B's chat does not count as unread for A (" + r.data.count + ")");
r = await kb("/api/orders/" + oa.id);
ok(r.status === 404, "and B cannot open A's order");

// ---------- pay: own only
r = await ka("/api/techrates");
ok(r.status === 403, "A cannot read the KTV pay rates");
r = await ka("/api/techrates", { method: "POST", body: { email: A, currency: "VND", items: [{ product: "CR", rate: 999999 }] } });
ok(r.status === 403, "A cannot change pay rates (not even their own)");
r = await ka("/api/tech/" + encodeURIComponent(Bm));
ok(r.status === 403, "A cannot open B's KTV page (cases, pay)");
r = await ka("/api/tech");
ok(r.status === 403, "A cannot open the team page");
r = await ka("/api/tech/" + encodeURIComponent(A) + "?month=2026-10&basis=received");
ok(r.status === 200 && r.data.orders.every((x) => x.id !== ob.id) && r.data.orders.some((x) => x.id === oa.id), "A's own page has only A's orders");

// ---------- the team list: no other KTVs
r = await ka("/api/staff/team");
ok(r.status === 200 && !r.data.team.some((t) => t.email === Bm) && r.data.team.some((t) => t.email === A) && r.data.team.some((t) => t.email === QC), "team list for A: themself and QC, not B");
r = await owner("/api/staff/team");
ok(r.data.team.some((t) => t.email === A) && r.data.team.some((t) => t.email === Bm), "the owner sees every KTV");

// ---------- portal cases: only assigned ones
const lab = await signin(uniq("lab") + "@clinic.example", "Clinic Lab");
const job = (await lab("/api/my/jobs", { method: "POST", body: { title: "Case for B only", service: "Crown & bridge", teeth: "11" } })).data.job;
await owner(`/api/jobs/${job.id}/assign`, { method: "POST", body: { designer: Bm } });
r = await ka("/api/admin/jobs");
ok(r.status === 200 && !(r.data.jobs || r.data.items || []).some((x) => x.id === job.id), "A does not see B's portal case");
r = await ka("/api/jobs/" + job.id);
ok(r.status === 404, "A cannot open B's portal case (files, messages)");
r = await kb("/api/admin/jobs");
ok(r.status === 200 && (r.data.jobs || r.data.items || []).some((x) => x.id === job.id), "B sees their portal case");

// ---------- 3D links: one's own only
const up = (who, label) => fetch(B + "/api/upload", { method: "POST", headers: { ...who.headers, "Content-Type": "text/html", "X-Case-Label": encodeURIComponent(label), "X-Expire-Days": "7" }, body: "<!doctype html><html><body>" + label + "</body></html>" }).then((x) => x.json());
const la = await up(ka, "Link of A"), lb = await up(kb, "Link of B");
ok(la.id && lb.id, "each KTV makes a 3D link");
r = await ka("/api/list");
ok(r.status === 200 && r.data.items.some((x) => x.id === la.id) && !r.data.items.some((x) => x.id === lb.id), "A's 3D link list has only A's links");
r = await ka("/api/cases/" + lb.id, { method: "DELETE" });
ok(r.status === 403, "A cannot delete B's 3D link");
r = await kb("/api/list");
ok(r.data.items.some((x) => x.id === lb.id), "B's link is still there");
r = await owner("/api/list");
ok(r.data.all === true && r.data.items.some((x) => x.id === la.id && x.by === A) && r.data.items.some((x) => x.id === lb.id && x.by === Bm), "the owner sees every link and who made it");
r = await ka("/api/cases/" + la.id, { method: "DELETE" });
ok(r.status === 200, "A deletes their own link");

// ---------- prices, money, customers, reports, admin: none of it
const no = async (path, why, opts) => { const x = await ka(path, opts); ok([401, 403, 404].includes(x.status), why + " (" + x.status + ")"); };
await no("/api/prices?customer=" + cust.id, "A cannot read customer prices");
await no("/api/prices?all=1", "A cannot read all price lists");
await no("/api/prices/default", "A cannot read the portal price list");
await no("/api/prices", "A cannot change prices", { method: "POST", body: { customer: cust.id, currency: "USD", items: [{ product: "CR", price: 1 }] } });
r = await ka("/api/products");
ok(r.status === 200 && r.data.products.every((p) => !("prices" in p)), "product codes without any price");
await no("/api/customers", "A cannot list customers");
await no("/api/customers/" + cust.id, "A cannot open a customer (revenue, debt, contacts)");
await no("/api/reports", "A cannot see revenue reports");
await no("/api/export?from=2026-01-01&to=2026-12-31", "A cannot export the books");
await no("/api/payments", "A cannot record payments", { method: "POST", body: { customer_id: cust.id, day: "2026-10-21", amount: 5 } });
await no("/api/orders", "A cannot enter orders", { method: "POST", body: { customer_id: cust.id, items: [{ product: "CR" }] } });
await no("/api/orders/" + oa.id, "A cannot edit their order's price or details", { method: "POST", body: { adj_pct: 50 } });
await no("/api/orders/" + oa.id, "A cannot delete orders", { method: "DELETE" });
await no("/api/import/orders", "A cannot import", { method: "POST", body: { rows: [] } });
await no("/api/staff", "A cannot see staff and permissions");
await no("/api/roles", "A cannot change roles", { method: "POST", body: { roles: {} } });
await no("/api/admin/users", "A cannot see accounts");
await no("/api/settings", "A cannot read settings");
await no("/api/settings", "A cannot change settings", { method: "POST", body: { onlinePay: true } });
await no("/api/messages", "A cannot read contact messages");
await no(`/api/jobs/${job.id}/assign`, "A cannot assign cases", { method: "POST", body: { designer: A } });
r = await ka(`/api/orders/${oa.id}/act`, { method: "POST", body: { action: "deliver" } });
ok(r.status === 403 || r.status === 400, "A cannot deliver to the customer (" + r.status + ")");
r = await ka("/api/orders/" + oa.id);
ok(r.data.order.status !== "delivered", "A's order is not delivered");

// ---------- a KTV given the wider permissions (all orders, all cases, assign, team reports) still sees only their own work
const Cm = uniq("ktvc") + "@d8.example";
await owner("/api/staff", { method: "POST", body: { email: Cm, role: "designer", perms: ["cases.files", "cases.design", "cases.notes", "cases.chat_read", "orders.view", "orders.edit", "cases.all", "cases.assign", "cases.status", "cases.deliver", "reports.view", "techpay.own"] } });
const kc = await signin(Cm, "Chi KTV");
const oc = (await owner("/api/orders", { method: "POST", body: { customer_id: cust.id, received: "2026-10-21", patient: "Patient Of C", designer: Cm, qc: QC, items: [{ product: "CR", qty: 1 }] } })).data.order;
await owner("/api/orders", { method: "POST", body: { customer_id: cust.id, received: "2026-10-21", patient: "Unassigned Patient", items: [{ product: "CR", qty: 1 }] } });
r = await kc("/api/orders?status=&limit=200");
ok(r.status === 200 && r.data.items.some((x) => x.id === oc.id) && !r.data.items.some((x) => x.id === oa.id || x.id === ob.id), "with all-orders and assign permissions, a KTV lists only their own orders");
ok(r.data.items.every((x) => x.designer === Cm || x.qc === Cm), "nothing of another KTV in that list");
r = await kc("/api/orders/" + ob.id);
ok(r.status === 404, "...and cannot open B's order");
r = await kc("/api/orders/" + oa.id);
ok(r.status === 404, "...nor A's order");
r = await kc("/api/orders/" + oc.id);
ok(r.status === 200, "their own order opens");
r = await kc(`/api/orders/${ob.id}/act`, { method: "POST", body: { action: "start" } });
ok(r.status === 404, "...and cannot start B's order");
r = await kc("/api/staff/team");
ok(r.status === 200 && !r.data.team.some((t) => t.email === A || t.email === Bm) && r.data.team.some((t) => t.email === QC), "the team list leaves out the other KTVs");
r = await kc("/api/tech/" + encodeURIComponent(Bm));
ok(r.status === 403, "...and cannot open another KTV's page");
r = await kc("/api/tech");
ok(r.status === 403, "...nor the team page");
r = await kc("/api/admin/jobs");
ok(r.status === 200 && !(r.data.jobs || r.data.items || []).some((x) => x.id === job.id), "B's portal case is not in C's list, even with cases.all and cases.assign");
r = await kc("/api/jobs/" + job.id);
ok(r.status === 404, "...and cannot open it");
r = await kc("/api/todo");
ok(r.status === 200 && !r.data.items.some((x) => x.key === "free" || x.key === "ready"), "bell counts: no team-wide counts for a KTV");
const dupesOf = async (who) => (await who(`/api/orders/dupes?customer=${cust.id}&patient=${encodeURIComponent("Patient Of B")}`)).data.dupes || [];
const dk = await dupesOf(kc);
ok(dk.some((x) => x.code === ob.code && !x.canOpen), "a duplicate check says that B's patient has an order (for a KTV who may not open it)");
ok(dk.every((x) => x.canOpen || (!x.patient && !x.designer && !x.qc && !x.doctor && !x.clinic && !x.customer_name)), "...but shows neither the patient, doctor, clinic, customer nor KTV of that order");
const dOwner = await dupesOf(owner);
ok(dOwner.some((x) => x.code === ob.code && x.patient === "Patient Of B" && x.designer === Bm), "the owner still sees the patient and KTV of the matched order");

// ---------- QC: checks the work, still no money
r = await qc("/api/orders/" + ob.id);
ok(r.status === 200 && !("total" in r.data.order) && !("tech_cost" in r.data.order), "QC on the order: no price, no KTV pay");
r = await qc("/api/tech/" + encodeURIComponent(Bm));
ok(r.status === 403, "QC cannot open a KTV's page");

done();
