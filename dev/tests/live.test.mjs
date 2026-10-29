// Live case chat (every 2–3 s): the state poll, "is typing" for the other side only, and who may use it.
// Runs in the main block of run.sh (D1 on).
import { B, ok, done, signin, uniq } from "./lib.mjs";

const owner = await signin("d.eightdesigncenter@gmail.com", "Danny Do");
const KTV = uniq("live") + "@d8.example";
await owner("/api/staff", { method: "POST", body: { email: KTV, role: "designer" } });
const ktv = await signin(KTV, "Live KTV");
const cust = await signin(uniq("lv") + "@lab.example", "Lab Live");
const other = await signin(uniq("lv2") + "@lab.example", "Other Lab");

let r = await cust("/api/my/jobs", { method: "POST", body: { title: "", service: "Crown & bridge", teeth: "14" } });
ok(r.status === 201 && /^D8-/.test(r.data.job.id), "customer sends a case; the system gives the code");
const id = r.data.job.id;
r = await owner(`/api/jobs/${id}/assign`, { method: "POST", body: { designer: KTV } });
ok(r.status === 200, "admin assigns the case to a designer");

r = await cust(`/api/jobs/${id}`);
ok(r.data.job.assigned === true && !("designer" in r.data.job), "customer sees that the case is assigned, not who");

r = await cust(`/api/jobs/${id}/state`);
ok(r.status === 200 && r.data.state.typing === null && typeof r.data.state.updated === "number", "customer's state poll: version, nobody typing");
const v0 = r.data.state.updated;
r = await other(`/api/jobs/${id}/state`);
ok(r.status === 404, "another customer cannot poll this case");
r = await ktv(`/api/jobs/${id}/state`);
ok(r.status === 200, "the assigned designer can poll the case");

r = await cust(`/api/jobs/${id}/typing`, { method: "POST", body: { on: true } });
ok(r.status === 200, "customer pings typing");
r = await ktv(`/api/jobs/${id}/state`);
ok(r.data.state.typing && r.data.state.typing.side === "client" && r.data.state.typing.name === "Lab Live", "staff sees the customer is typing, with the name");
r = await cust(`/api/jobs/${id}/state`);
ok(r.data.state.typing === null, "the customer does not see their own typing");

r = await ktv(`/api/jobs/${id}/typing`, { method: "POST", body: { on: true } });
ok(r.status === 403, "a designer who only reads the chat cannot send a typing ping");

r = await owner(`/api/jobs/${id}/typing`, { method: "POST", body: { on: true } });
ok(r.status === 200, "admin pings typing");
r = await cust(`/api/jobs/${id}/state`);
ok(r.data.state.typing && r.data.state.typing.side === "admin" && r.data.state.typing.name === "D.EIGHT", "customer sees D.EIGHT typing (no individual staff name)");

r = await owner(`/api/jobs/${id}/messages`, { method: "POST", body: { text: "Hello from D.EIGHT" } });
ok(r.status === 200, "admin sends a message");
r = await cust(`/api/jobs/${id}/state`);
ok(r.data.state.typing === null && r.data.state.updated > v0, "after the message: no typing, version moved");

r = await cust(`/api/jobs/${id}/typing`, { method: "POST", body: { on: false } });
ok(r.status === 200, "customer stops typing");
r = await ktv(`/api/jobs/${id}`);
ok(r.data.job.thread.some((m) => m.text === "Hello from D.EIGHT"), "the message is in the case");

done();
