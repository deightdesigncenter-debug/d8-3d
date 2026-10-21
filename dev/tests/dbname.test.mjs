// The D1 database bound under another variable name (not "DB") is still used, and the settings page says which name.
// Run against: DB_AS=d8_db node dev/server.mjs public 8788 <password>
import { ok, done, signin } from "./lib.mjs";
const owner = await signin("d.eightdesigncenter@gmail.com", "D.EIGHT");
let r = await owner("/api/book/status");
ok(r.status === 200 && r.data.db === true && r.data.dbName === "d8_db", "database found under the name d8_db (" + JSON.stringify(r.data) + ")");
ok((r.data.bindings || []).some((b) => b.name === "d8_db" && b.kind === "D1") && (r.data.bindings || []).some((b) => b.name === "CASES" && b.kind === "KV"), "bindings listed with their kind");
ok((r.data.bindings || []).some((b) => b.name === "ASSETS" && b.kind === "Service") && !(r.data.bindings || []).some((b) => b.name === "ASSETS" && b.kind === "D1"), "the ASSETS service binding (answers any property like Cloudflare's RPC stubs) is not taken for a database");
r = await owner("/api/products/sample", { method: "POST", body: {} });
ok(r.status === 200 || r.status === 409, "order book works with that binding (" + r.status + ")");
const kt = await signin("nobody" + Date.now() + "@lab.example", "Lab");
r = await kt("/api/book/status");
ok(r.status === 403 || !("bindings" in (r.data || {})), "customers never see the binding list");
done();
