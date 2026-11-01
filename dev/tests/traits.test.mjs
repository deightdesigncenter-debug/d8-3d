// Customer traits: what staff keep in mind about one customer. Staff with customers.view read them, customers.edit
// change them; the customer never sees them. They stay on the customer (never copied into an order or a case).
import { ok, done, signin, uniq } from "./lib.mjs";

const OWNER = "d.eightdesigncenter@gmail.com";
const owner = await signin(OWNER, "D.EIGHT");
const custEmail = uniq("trait") + "@lab.example";
const cust = await signin(custEmail, "Trait Customer");

let r = await owner("/api/customers", { method: "POST", body: { name: uniq("Phòng khám đặc tính "), kind: "doctor", currency: "USD" } });
ok(r.status === 200 && r.data.customer && r.data.customer.id, "customer created for the traits test");
const id = r.data.customer.id, base = `/api/customers/${id}/traits`;

// ---------- a new customer has none
r = await owner(base);
ok(r.status === 200 && Array.isArray(r.data.traits) && r.data.traits.length === 0, "a new customer has no traits");

// ---------- add, check the text is cleaned and kept
r = await owner(base, { method: "POST", body: { text: "   " } });
ok(r.status === 400, "empty trait refused (" + r.status + ")");
r = await owner(base, { method: "POST", body: { text: "  Thích răng sứ màu A2  " } });
ok(r.status === 200 && r.data.ok, "trait added");
r = await owner(base, { method: "POST", body: { text: "Hay gửi gấp, gọi trước khi làm" } });
ok(r.status === 200, "second trait added");
r = await owner(base);
const [t1, t2] = r.data.traits;
ok(r.data.traits.length === 2 && t1.text === "Thích răng sứ màu A2" && t1.by === OWNER, "traits listed in order, text trimmed, author kept");

// ---------- edit and delete
r = await owner(`${base}/${t1.id}`, { method: "POST", body: { text: "Thích răng sứ màu A3" } });
ok(r.status === 200, "trait edited");
r = await owner(`${base}/999999`, { method: "POST", body: { text: "không có" } });
ok(r.status === 404, "editing an unknown trait gives 404 (" + r.status + ")");
r = await owner(base);
ok(r.data.traits.find((x) => x.id === t1.id).text === "Thích răng sứ màu A3", "edit is saved");
r = await owner(`${base}/${t2.id}`, { method: "DELETE" });
ok(r.status === 200, "trait deleted");
r = await owner(base);
ok(r.data.traits.length === 1 && r.data.traits[0].id === t1.id, "deleted trait is gone");

// ---------- limit per customer
for (let i = 0; i < 59; i++) await owner(base, { method: "POST", body: { text: "đặc tính " + i } });
r = await owner(base, { method: "POST", body: { text: "vượt giới hạn" } });
ok(r.status === 409, "61st trait refused (" + r.status + ")");

// ---------- the customer never sees them
r = await cust(base);
ok(r.status === 403, "customer cannot read traits (" + r.status + ")");
r = await cust(base, { method: "POST", body: { text: "khách tự thêm" } });
ok(r.status === 403, "customer cannot add traits (" + r.status + ")");

// ---------- unknown customer
r = await owner("/api/customers/999999/traits");
ok(r.status === 200 && r.data.traits.length === 0, "unknown customer: no traits, nothing leaks");
r = await owner("/api/customers/999999/traits", { method: "POST", body: { text: "x" } });
ok(r.status === 404, "adding to an unknown customer gives 404 (" + r.status + ")");

// ---------- removing the customer removes its traits too
r = await owner("/api/customers/" + id, { method: "DELETE" });
ok(r.status === 200, "customer without orders deleted (" + r.status + ")");

done();
