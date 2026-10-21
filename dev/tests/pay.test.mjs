// PayPal / Stripe payments against the dev server mocks: PAY=1 node dev/server.mjs public 8788 mat-khau-thu
// A provider-confirmed payment waits ("check") until D.EIGHT confirms it.
import { B, ok, done, signin, follow } from "./lib.mjs";

const cust = await signin("payer" + Date.now() + "@lab.example", "Pay Lab");
const admin = await signin("d.eightdesigncenter@gmail.com", "D.EIGHT");
const other = await signin("other" + Date.now() + "@lab.example", "Other Lab");
// these checks need online payment and the automatic free trial, both off by default
await admin("/api/settings", { method: "POST", body: { onlinePay: true, autoTrial: true } });

const cfg = await (await fetch(B + "/api/config")).json();
ok(cfg.pay && cfg.pay.paypal && cfg.pay.stripe, "config reports both providers");

// three cases: two are trial, third is paid work
const mk = async (t) => (await cust("/api/my/jobs", { method: "POST", body: { title: t, service: "Crown & bridge" } })).data.job;
const j1 = await mk("Case A"), j2 = await mk("Case B"), j3 = await mk("Case C");
ok(j1.trial && j2.trial && !j3.trial, "first two cases are trial");
ok(!("price" in j3) && !("payTries" in j3), "customer view has no price / payTries");

// nothing due yet
let r = await cust(`/api/jobs/${j3.id}/pay`, { method: "POST", body: { via: "paypal" } });
ok(r.status === 409, "cannot pay before the case is due (" + r.status + ")");

// admin prices the case at 60, asks for 45
r = await admin(`/api/jobs/${j3.id}/billing`, { method: "POST", body: { price: 60, due: 45, pay: "due", trial: false } });
ok(r.status === 200 && r.data.job.price === 60 && r.data.job.due === 45, "admin sets price 60 / due 45");
r = await cust(`/api/jobs/${j3.id}`);
ok(r.data.job.amount === 45 && r.data.job.price === undefined && r.data.job.due === undefined, "customer sees amount 45 only");
const list = await cust("/api/my/jobs");
const row = list.data.items.find((x) => x.id === j3.id);
ok(row && row.pay === "due" && row.price === undefined, "customer list shows due without price");

// other customer / admin cannot start the payment
r = await other(`/api/jobs/${j3.id}/pay`, { method: "POST", body: { via: "paypal" } });
ok(r.status === 404, "another customer cannot see the case (" + r.status + ")");
r = await admin(`/api/jobs/${j3.id}/pay`, { method: "POST", body: { via: "paypal" } });
ok(r.status === 403, "admin cannot start a customer payment (" + r.status + ")");
r = await cust(`/api/jobs/${j3.id}/pay`, { method: "POST", body: { via: "bitcoin" } });
ok(r.status === 400, "unknown provider rejected");

// PayPal: start, cancel, then approve and capture
r = await cust(`/api/jobs/${j3.id}/pay`, { method: "POST", body: { via: "paypal" } });
ok(r.status === 200 && /\/__mock\/paypal\/checkout\?token=/.test(r.data.url), "PayPal order created");
const ppUrl = r.data.url, token = new URL(ppUrl).searchParams.get("token");
let loc = await follow(ppUrl + "&act=cancel");
ok(/\/portal\?pay=cancel&case=/.test(loc), "cancel returns to portal: " + loc);
r = await cust(`/api/jobs/${j3.id}/pay/check`, { method: "POST" });
ok(r.data.paid === false && r.data.job.pay === "due" && r.data.job.payOpen, "still due after cancel");
// tamper with amount: must not be accepted
await fetch(`${B}/__mock/paypal/tamper?token=${token}&value=1.00`);
loc = await follow(ppUrl);
ok(new URL(loc).searchParams.get("pay") === "paypal" && new URL(loc).searchParams.get("token") === token, "approve returns with token");
r = await cust(`/api/jobs/${j3.id}/pay/check`, { method: "POST" });
ok(r.data.paid === false, "order with a changed amount is not accepted");

// fresh PayPal order, approved properly
r = await cust(`/api/jobs/${j3.id}/pay`, { method: "POST", body: { via: "paypal" } });
await follow(r.data.url);
r = await cust(`/api/jobs/${j3.id}/pay/check`, { method: "POST" });
ok(r.data.paid === false && r.data.sent === true && r.data.job.pay === "check" && r.data.job.paid.via === "paypal" && r.data.job.paid.amount === 45, "PayPal capture reported (45), waiting for D.EIGHT");
ok(r.data.job.thread.some((m) => m.text === "pay:sent:paypal"), "thread has a payment-sent event");
r = await cust(`/api/jobs/${j3.id}/pay/check`, { method: "POST" });
ok(r.data.sent === true, "check again is stable");
r = await cust(`/api/jobs/${j3.id}/pay`, { method: "POST", body: { via: "stripe" } });
ok(r.data.sent === true && !r.data.url, "paying again returns sent, no new checkout");
r = await admin(`/api/jobs/${j3.id}`);
ok(r.data.job.payTries.some((t) => t.state === "paid") && r.data.job.paid.ref.startsWith("CAP"), "admin sees attempts and capture id");
r = await admin(`/api/jobs/${j3.id}/pay/confirm`, { method: "POST", body: { ok: true } });
ok(r.data.job.pay === "paid" && r.data.job.paid.confirmed, "admin confirms");

// Stripe on a fourth case
const j4 = await mk("Case D");
await admin(`/api/jobs/${j4.id}/billing`, { method: "POST", body: { price: 120, pay: "due", trial: false } });
r = await cust(`/api/jobs/${j4.id}/pay`, { method: "POST", body: { via: "stripe" } });
ok(r.status === 200 && /\/__mock\/stripe\/pay\?sid=/.test(r.data.url), "Stripe session created");
const sid = new URL(r.data.url).searchParams.get("sid");
r = await cust(`/api/jobs/${j4.id}/pay/check`, { method: "POST" });
ok(r.data.paid === false, "unpaid session is not paid");
loc = await follow(`${B}/__mock/stripe/pay?sid=${sid}`);
ok(loc.includes("/portal?pay=stripe&case=" + j4.id) && loc.includes("sid=" + sid), "Stripe success URL carries session id");
await fetch(`${B}/__mock/stripe/tamper?sid=${sid}&amount=100`);
r = await cust(`/api/jobs/${j4.id}/pay/check`, { method: "POST" });
ok(r.data.paid === false, "Stripe session with the wrong amount is not accepted");
await fetch(`${B}/__mock/stripe/tamper?sid=${sid}&amount=12000`);
r = await admin(`/api/jobs/${j4.id}/pay/check`, { method: "POST" });
ok(r.data.paid === false && r.data.sent === true && r.data.job.paid.via === "stripe" && r.data.job.paid.amount === 120 && r.data.job.paid.ref.startsWith("pi_"), "admin check picks up the Stripe payment (to confirm)");

// PayPal held (pending capture) on a fifth case
const j5 = await mk("Case E");
await admin(`/api/jobs/${j5.id}/billing`, { method: "POST", body: { price: 30, pay: "due", trial: false } });
r = await cust(`/api/jobs/${j5.id}/pay`, { method: "POST", body: { via: "paypal" } });
await follow(r.data.url + "&act=pending");
r = await cust(`/api/jobs/${j5.id}/pay/check`, { method: "POST" });
ok(r.data.paid === false && r.data.job.payHeld === true, "pending PayPal capture shows as held");
// admin marks it paid by hand
r = await admin(`/api/jobs/${j5.id}/billing`, { method: "POST", body: { price: 30, pay: "paid", trial: false } });
ok(r.data.job.pay === "paid" && r.data.job.paid.via === "manual" && r.data.job.paid.confirmed, "admin can mark paid by hand");
r = await admin(`/api/jobs/${j5.id}/billing`, { method: "POST", body: { price: 30, pay: "due", trial: false } });
ok(r.data.job.pay === "due" && !r.data.job.paid, "back to due clears the paid record");

// trial case cannot be paid
r = await cust(`/api/jobs/${j1.id}/pay`, { method: "POST", body: { via: "paypal" } });
ok(r.status === 409, "trial case has nothing to pay");

// rate limit
const j6 = await mk("Case F");
await admin(`/api/jobs/${j6.id}/billing`, { method: "POST", body: { price: 10, pay: "due", trial: false } });
let last;
for (let i = 0; i < 6; i++) last = await cust(`/api/jobs/${j6.id}/pay`, { method: "POST", body: { via: i % 2 ? "stripe" : "paypal" } });
ok(last.status === 429, "too many attempts are limited (" + last.status + ")");

await admin("/api/settings", { method: "POST", body: { onlinePay: false, autoTrial: false } });
done();
