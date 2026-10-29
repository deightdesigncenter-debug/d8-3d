// Website assistant limits (they need the database, so they run on a server with D1): 40 questions an hour from one
// address, 400 in a day for all visitors. A capped question gets a plain answer that points to the details form, and
// Workers AI is not called for it. Run on a fresh server: PAY=1 node dev/server.mjs public <port> <password>.
import { B, ok, done } from "./lib.mjs";

const ask = (ip, text = "Hello") => fetch(B + "/api/assist", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
  body: JSON.stringify({ messages: [{ role: "user", text }], lang: "en" }) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

const base = 30 + Math.floor(Math.random() * 100); // a fresh 198.18.x.x block for this run
const ipOf = (n) => "198.18." + (base + n) + ".9";

// one address: 40 answers, then the hourly cap
let last;
for (let i = 0; i < 40; i++) last = await ask(ipOf(0));
ok(last.status === 200 && last.data.ai !== undefined && !/last hour/.test(last.data.reply), "40 questions in an hour from one address are answered");
const capped = await ask(ipOf(0));
ok(capped.status === 200 && /last hour/.test(capped.data.reply) && capped.data.lead === true && capped.data.ai === false,
  "the 41st in the hour gets the plain answer and the form (no AI call)");
const other = await ask(ipOf(1));
ok(other.status === 200 && !/last hour/.test(other.data.reply), "another address is not held up by the first one's hour");

// the day: 400 answers for all visitors (40 from the first address, then 9 more addresses of 40)
for (let n = 1; n <= 9; n++) for (let i = 0; i < 40; i++) await ask(ipOf(n + 1));
const day = await ask(ipOf(50));
ok(day.status === 200 && /today/.test(day.data.reply) && day.data.lead === true && day.data.ai === false,
  "after 400 answers in the day, every address gets the plain answer (no AI call)");

done();
