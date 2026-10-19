// Staff roles, permissions, design → QC workflow, price lists and payment confirmation.
// Run against the dev server with payment mocks: PAY=1 node dev/server.mjs public 8788 mat-khau-thu
import { B, PW, ok, done, signin, follow, uniq } from "./lib.mjs";

const OWNER = "d.eightdesigncenter@gmail.com";
const owner = await signin(OWNER, "D.EIGHT");
const designerEmail = uniq("ktv") + "@d8.example", qcEmail = uniq("qc") + "@d8.example", leadEmail = uniq("lead") + "@d8.example";
const custEmail = uniq("lab") + "@lab.example";
const cust = await signin(custEmail, "Lab Customer");

// ---------- before being added, a staff email is just a customer
let ktv = await signin(designerEmail, "Minh KTV");
let r = await ktv("/api/me");
ok(r.data.user.staff === false && r.data.user.role === "client", "new account is a customer");
r = await ktv("/api/admin/jobs");
ok(r.status === 403, "customer cannot list workspace cases (" + r.status + ")");
r = await cust("/api/staff/team");
ok(r.status === 403, "customer cannot read the team (" + r.status + ")");

// ---------- owner manages staff and roles
r = await owner("/api/staff");
ok(r.status === 200 && r.data.roles.admin && r.data.roles.designer && r.data.roles.qc && r.data.perms.length >= 15, "owner sees roles and permissions");
ok(r.data.staff.some((s) => s.email === OWNER && s.owner), "owner listed as owner");
r = await owner("/api/staff", { method: "POST", body: { email: designerEmail, role: "designer" } });
ok(r.status === 200, "add designer");
r = await owner("/api/staff", { method: "POST", body: { email: qcEmail, role: "qc" } });
ok(r.status === 200, "add QC");
r = await owner("/api/staff", { method: "POST", body: { email: OWNER, role: "designer" } });
ok(r.status === 400, "owner account cannot be changed");
r = await owner("/api/staff", { method: "POST", body: { email: "not-an-email", role: "qc" } });
ok(r.status === 400, "bad email rejected");
r = await owner("/api/staff", { method: "POST", body: { email: leadEmail, role: "nope" } });
ok(r.status === 400, "unknown role rejected");

// custom role "lead": assign + all cases + notes, no billing
r = await owner("/api/staff");
const roles = r.data.roles;
roles.lead = { label: "Trưởng nhóm", perms: ["cases.all", "cases.assign", "cases.notes", "cases.files", "cases.qc", "cases.status"] };
r = await owner("/api/roles", { method: "POST", body: { roles } });
ok(r.status === 200 && r.data.roles.lead && r.data.roles.lead.perms.includes("cases.assign"), "custom role saved");
r = await owner("/api/staff", { method: "POST", body: { email: leadEmail, role: "lead" } });
ok(r.status === 200, "add lead");
delete roles.lead;
r = await owner("/api/roles", { method: "POST", body: { roles } });
ok(r.status === 400, "role in use cannot be deleted");

ktv = await signin(designerEmail, "Minh KTV");
const qc = await signin(qcEmail, "Lan QC");
const lead = await signin(leadEmail, "Hùng Lead");
r = await ktv("/api/me");
ok(r.data.user.staff && r.data.user.role === "designer" && r.data.user.perms.includes("cases.design") && !r.data.user.perms.includes("billing.view"), "designer session carries role and permissions");
r = await ktv("/api/staff");
ok(r.status === 403, "designer cannot manage staff");
r = await ktv("/api/staff/team");
ok(r.status === 200 && r.data.team.some((t) => t.email === qcEmail && t.qc), "designer can read the team");
r = await lead("/api/admin/users");
ok(r.status === 403, "lead without customers.view cannot list customers");

// ---------- a case comes in
const j = (await cust("/api/my/jobs", { method: "POST", body: { title: "Case 501, crowns 11 21", service: "Crown & bridge", teeth: "11, 21", material: "Zirconia" } })).data.job;
await cust(`/api/jobs/${j.id}/messages`, { method: "POST", body: { text: "Please keep contacts light." } });
r = await ktv(`/api/jobs/${j.id}`);
ok(r.status === 404, "designer cannot open an unassigned case");
r = await ktv("/api/admin/jobs");
ok(r.status === 200 && !r.data.items.some((x) => x.id === j.id), "unassigned case not in designer list");
r = await lead("/api/admin/jobs");
const leadRow = r.data.items.find((x) => x.id === j.id);
ok(leadRow && leadRow.owner === "" && leadRow.price === null, "lead sees case without customer email or price");

// assign
r = await ktv(`/api/jobs/${j.id}/assign`, { method: "POST", body: { designer: designerEmail } });
ok(r.status === 404, "designer cannot assign (cannot even see it)");
r = await lead(`/api/jobs/${j.id}/assign`, { method: "POST", body: { designer: "stranger@x.example" } });
ok(r.status === 400, "cannot assign someone who is not staff");
r = await lead(`/api/jobs/${j.id}/assign`, { method: "POST", body: { designer: designerEmail, qcBy: "" } });
ok(r.status === 200 && r.data.job.designer === designerEmail && r.data.job.stage === "design" && r.data.job.status === "in_design", "lead assigns designer, case in design");

// designer works
r = await ktv(`/api/jobs/${j.id}`);
const dv = r.data.job;
ok(r.status === 200 && dv.owner === "" && !("price" in dv) && !("pay" in dv) && !("payTries" in dv), "designer view hides customer email and money");
ok(dv.thread.some((m) => m.text === "Please keep contacts light."), "designer reads the customer chat");
r = await ktv(`/api/jobs/${j.id}/messages`, { method: "POST", body: { text: "hello" } });
ok(r.status === 403, "designer cannot message the customer");
r = await ktv(`/api/jobs/${j.id}/status`, { method: "POST", body: { status: "delivered" } });
ok(r.status === 403, "designer cannot change status");
r = await ktv(`/api/jobs/${j.id}/billing`, { method: "POST", body: { price: 1, pay: "paid" } });
ok(r.status === 403, "designer cannot touch billing");
r = await ktv(`/api/jobs/${j.id}/stage`, { method: "POST", body: { action: "submit" } });
ok(r.status === 409, "cannot send to QC without design files");

// upload a design file (one part) as the designer
const html = "<!doctype html><html><head><script>/*d8-storage-shim*/</script></head><body>scene</body></html>";
const fid = "Dz" + Math.random().toString(36).slice(2, 10).padEnd(8, "x").slice(0, 8);
r = await fetch(`${B}/api/jobs/${j.id}/files/${fid}/0`, { method: "PUT", headers: { ...ktv.headers, "Content-Type": "application/octet-stream" }, body: html });
ok(r.status === 200, "designer uploads a design chunk");
r = await ktv(`/api/jobs/${j.id}/files`, { method: "POST", body: { files: [{ fid, name: "crowns.html", size: html.length, stored: html.length, parts: 1, gz: 0 }], kind: "output" } });
ok(r.status === 403, "designer cannot attach files for the customer");
r = await ktv(`/api/jobs/${j.id}/files`, { method: "POST", body: { files: [{ fid, name: "crowns.html", size: html.length, stored: html.length, parts: 1, gz: 0 }], kind: "design" } });
ok(r.status === 200 && r.data.job.files.some((f) => f.fid === fid && f.kind === "design" && f.by === designerEmail), "design file attached");
r = await cust(`/api/jobs/${j.id}`);
ok(!r.data.job.files.some((f) => f.fid === fid) && !("team" in r.data.job) && !("stage" in r.data.job) && !("designer" in r.data.job), "customer sees no design files or internal workflow");
r = await cust(`/api/jobs/${j.id}/files/${fid}`);
ok(r.status === 404, "customer cannot download a design file");
const view = await fetch(`${B}/api/jobs/${j.id}/files/${fid}?view=1`, { headers: ktv.headers });
ok(view.status === 200 && view.headers.get("content-type").startsWith("text/html") && /sandbox/.test(view.headers.get("content-security-policy") || ""), "staff opens design HTML in a sandbox");
r = await ktv(`/api/jobs/${j.id}/team`, { method: "POST", body: { text: "Đã làm xong, nhờ QC xem tiếp xúc." } });
ok(r.status === 200 && r.data.job.team.some((n) => n.kind === "note"), "designer adds an internal note");
r = await ktv(`/api/jobs/${j.id}/stage`, { method: "POST", body: { action: "submit", note: "Xong" } });
ok(r.status === 200 && r.data.job.stage === "qc", "designer sends to QC");

// QC (unassigned QC queue)
r = await qc("/api/admin/jobs");
ok(r.data.items.some((x) => x.id === j.id && x.stage === "qc"), "QC sees the case in the QC queue");
r = await qc(`/api/jobs/${j.id}/stage`, { method: "POST", body: { action: "fail", note: "" } });
ok(r.status === 400, "QC fail needs a note");
r = await qc(`/api/jobs/${j.id}/stage`, { method: "POST", body: { action: "fail", note: "Tiếp xúc 21 quá chặt" } });
ok(r.status === 200 && r.data.job.stage === "fix" && r.data.job.qcBy === qcEmail && r.data.job.qc.state === "failed", "QC returns the case to the designer");
r = await ktv(`/api/jobs/${j.id}/stage`, { method: "POST", body: { action: "pass" } });
ok(r.status === 403, "designer cannot pass QC");
r = await ktv(`/api/jobs/${j.id}/stage`, { method: "POST", body: { action: "submit", note: "Đã sửa" } });
ok(r.status === 200 && r.data.job.stage === "qc", "designer resubmits");
r = await qc(`/api/jobs/${j.id}/stage`, { method: "POST", body: { action: "pass", note: "OK" } });
ok(r.status === 200 && r.data.job.stage === "ready" && r.data.job.qc.state === "passed", "QC passes");

// owner delivers the design file to the customer
r = await qc(`/api/jobs/${j.id}/promote`, { method: "POST", body: { fids: [fid], deliver: true } });
ok(r.status === 403, "QC cannot deliver");
r = await owner(`/api/jobs/${j.id}/promote`, { method: "POST", body: { fids: [fid], deliver: true } });
ok(r.status === 200 && r.data.job.status === "delivered" && r.data.job.stage === "done" && r.data.job.files.find((f) => f.fid === fid).kind === "output", "owner delivers QC-passed files");
r = await cust(`/api/jobs/${j.id}/files/${fid}`);
ok(r.status === 200, "customer downloads the delivered file");
r = await cust(`/api/jobs/${j.id}`);
ok(r.data.job.files.some((f) => f.fid === fid && !("by" in f)), "delivered file has no staff email for the customer");

// ---------- price lists
r = await owner("/api/prices/default", { method: "POST", body: { items: [{ service: "Crown & bridge", name: "Zirconia crown", unit: "unit", price: 12 }], note: "base" } });
ok(r.status === 200 && r.data.list.items[0].price === 12, "default price list saved");
r = await owner("/api/prices/" + encodeURIComponent(custEmail), { method: "POST", body: { items: [{ service: "Crown & bridge", unit: "unit", price: 10 }] } });
ok(r.status === 200 && r.data.custom, "customer price list saved");
r = await owner("/api/prices/" + encodeURIComponent(custEmail));
ok(r.data.custom && r.data.list.items[0].price === 10 && r.data.fallback.items[0].price === 12, "customer list with default as fallback");
r = await ktv("/api/prices/default");
ok(r.status === 403, "designer cannot read prices");
r = await cust("/api/prices/default");
ok(r.status === 403, "customer cannot read prices (" + r.status + ")");
r = await owner("/api/prices/" + encodeURIComponent(custEmail), { method: "POST", body: { reset: true } });
ok(r.status === 200 && !r.data.custom, "customer list reset to default");

// ---------- payments wait for D.EIGHT
const j2 = (await cust("/api/my/jobs", { method: "POST", body: { title: "Case 502", service: "Crown & bridge" } })).data.job;
const j3 = (await cust("/api/my/jobs", { method: "POST", body: { title: "Case 503", service: "Crown & bridge" } })).data.job;
await owner(`/api/jobs/${j3.id}/billing`, { method: "POST", body: { price: 40, pay: "due", trial: false } });
r = await cust(`/api/jobs/${j3.id}/pay`, { method: "POST", body: { via: "paypal" } });
await follow(r.data.url);
r = await cust(`/api/jobs/${j3.id}/pay/check`, { method: "POST" });
ok(r.data.paid === false && r.data.sent === true && r.data.job.pay === "check" && r.data.job.amount === 40, "PayPal payment waits for confirmation");
r = await cust(`/api/jobs/${j3.id}/pay`, { method: "POST", body: { via: "stripe" } });
ok(r.data.sent === true && !r.data.url, "no second checkout while confirming");
r = await lead(`/api/jobs/${j3.id}/pay/confirm`, { method: "POST", body: { ok: true } });
ok(r.status === 403, "lead without billing cannot confirm");
r = await owner(`/api/jobs/${j3.id}`);
ok(r.data.job.pay === "check" && r.data.job.paid.via === "paypal" && r.data.job.paid.ref.startsWith("CAP"), "owner sees the reported payment");
r = await owner(`/api/jobs/${j3.id}/pay/confirm`, { method: "POST", body: { ok: true } });
ok(r.status === 200 && r.data.job.pay === "paid" && r.data.job.paid.confirmed && r.data.job.paid.confirmedBy === OWNER, "owner confirms the payment");
r = await cust(`/api/jobs/${j3.id}`);
ok(r.data.job.pay === "paid" && r.data.job.paid.confirmed && !("confirmedBy" in r.data.job.paid) && r.data.job.thread.some((m) => m.text === "pay:paid:paypal"), "customer sees it paid");

// customer reports a bank transfer, owner says it did not arrive, then it arrives
await owner(`/api/jobs/${j2.id}/billing`, { method: "POST", body: { price: 25, pay: "due", trial: false } });
r = await cust(`/api/jobs/${j2.id}/pay/claim`, { method: "POST", body: { note: "" } });
ok(r.status === 400, "claim needs a reference");
r = await cust(`/api/jobs/${j2.id}/pay/claim`, { method: "POST", body: { note: "Payoneer 19/10 ref 777" } });
ok(r.status === 200 && r.data.job.pay === "check", "customer reports a transfer");
r = await owner(`/api/jobs/${j2.id}/pay/confirm`, { method: "POST", body: { ok: false } });
ok(r.status === 200 && r.data.job.pay === "due" && !r.data.job.paid, "owner: not received, back to due");
r = await owner(`/api/jobs/${j2.id}/billing`, { method: "POST", body: { price: 25, pay: "paid", trial: false } });
ok(r.data.job.pay === "paid" && r.data.job.paid.via === "manual" && r.data.job.paid.confirmed, "owner records a payment by hand");

// ---------- removing a staff member takes effect
r = await owner("/api/staff/" + encodeURIComponent(designerEmail), { method: "DELETE" });
ok(r.status === 200, "remove designer");
await new Promise((res) => setTimeout(res, 50));
r = await ktv("/api/me");
ok(r.data.user.staff === false, "removed designer is a customer again");
r = await owner("/api/staff/" + encodeURIComponent(OWNER), { method: "DELETE" });
ok(r.status === 400, "owner cannot be removed");

// the admin password still works as an owner
r = await fetch(B + "/api/staff", { headers: { "X-Upload-Key": PW, "X-D8": "1" } });
ok(r.status === 200, "password acts as owner");
r = await fetch(B + "/api/ping", { headers: { "X-Upload-Key": "wrong" } });
ok(r.status === 401, "wrong password rejected");

done();
