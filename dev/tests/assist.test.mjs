// Website assistant on the About page: POST /api/assist (answers) and POST /api/assist/lead (a visitor's details).
// Checks what a reply may and may not say (never a price), the fixed answers used when Workers AI is off or fails,
// that the details reach the inbox through the same checks as the contact form, and that the inbox stays private.
// Run against the dev server with the AI mock (PAY=1) and again with NO_AI=1 (the answers are checked either way).
import { B, ok, done, signin, uniq } from "./lib.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const owner = await signin("d.eightdesigncenter@gmail.com", "D.EIGHT");
let ipN = 20 + Math.floor(Math.random() * 200);
const nextIp = () => "203.0.113." + (ipN++ % 250);
const post = async (path, body, ip = nextIp()) => {
  const r = await fetch(B + path, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const ask = (text, lang = "en") => post("/api/assist", { messages: [{ role: "user", text }], lang });

// ---------- requests that are not a question
let r = await post("/api/assist", { messages: [], lang: "en" });
ok(r.status === 400, "no messages: refused (" + r.status + ")");
r = await post("/api/assist", { messages: [{ role: "assistant", text: "Hello, how can I help?" }], lang: "en" });
ok(r.status === 400, "the last message must be the visitor's: refused (" + r.status + ")");
r = await fetch(B + "/api/assist").then((x) => x.status);
ok(r >= 400, "GET /api/assist is not an open door (" + r + ")");
const long = "Please tell me about your services and how a case works, " + "x".repeat(600);
r = await post("/api/assist", { messages: Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "turn " + i })).concat([{ role: "user", text: long }]), lang: "en" });
ok(r.status === 200 && typeof r.data.reply === "string" && r.data.reply.length > 0, "a long conversation is trimmed, not refused (" + r.status + ")");

// ---------- answers
r = await ask("Hello");
ok(r.status === 200 && typeof r.data.reply === "string" && /Hello/.test(r.data.reply), "a greeting gets a reply (" + r.status + ")");
ok(typeof r.data.ai === "boolean" && r.data.lead === false, "a greeting does not ask for details (lead false)");
ok(r.data.ai ? r.data.reply.startsWith("[assistant] ") : !/\[assistant\]/.test(r.data.reply), "the reply comes from the AI when it is on, from the fixed answers when it is off");

r = await ask("I want you to design a crown for me");
ok(r.status === 200 && r.data.lead === true, "a design request offers the details form (lead true)");
r = await ask("Bên bạn thiết kế những gì?", "vi");
ok(r.status === 200 && r.data.lead === true, "a design question in Vietnamese offers the details form too");
r = await ask("Tôi muốn bên bạn thiết kế cho ca của mình", "vi");
ok(r.status === 200 && r.data.lead === true, "“tôi muốn bên bạn thiết kế” offers the details form");

// the price guard: a price in the AI's reply is replaced by the fixed answer (the mock says "$500" for this text)
r = await ask("PRICE-TEST what is the price of a crown?");
ok(r.status === 200 && !/\$|500/.test(r.data.reply) && /quote/i.test(r.data.reply), "a price is never shown in a reply; the team quotes instead (" + r.data.reply.slice(0, 80) + ")");
r = await ask("How much does a crown cost?");
ok(r.status === 200 && !/\d/.test(r.data.reply) && /quote/i.test(r.data.reply), "asked for a price: no number in the reply, the team quotes");

// the fixed answers are checked when the AI is off (then every reply is a fixed one)
const aiOn = (await ask("Hello")).data.ai === true;
if (!aiOn) {
  const fixed = async (text, lang, re, label) => { const x = await ask(text, lang); ok(re.test(x.data.reply), label + " (" + x.data.reply.slice(0, 70) + ")"); };
  await fixed("How do I send a case?", "en", /\/portal/, "fixed: how to send a case names the portal");
  await fixed("How long does a case take?", "en", /24 hours/, "fixed: turnaround says 24 hours");
  await fixed("How many revisions do I get?", "en", /\d+ free revision/, "fixed: revisions come from the settings");
  await fixed("What do you design?", "en", /implant restorations/i, "fixed: the services are listed");
  await fixed("Who can I contact?", "en", /d\.eightdesigncenter@gmail\.com/, "fixed: the contact names the email");
  await fixed("Bên bạn thiết kế những gì?", "vi", /phục hình implant/i, "fixed: the services are listed in Vietnamese");
}

// ---------- a visitor's details: the inbox, through the contact checks
const T = await (await fetch(B + "/api/contact/token")).json();
await sleep(3100); // a person needs more than 3 s to fill the form
const name = uniq("Dr Chat ");
const lead = { name, email: "chat@smile.example", phone: "+84 90 000 0000", practice: "Smile Clinic", service: "Crown & bridge",
  message: "Please quote two crowns for teeth 14 and 15. I have an STL scan.", lang: "en", token: T.token, website: "",
  transcript: [{ role: "user", text: "I want you to design a crown for me" }, { role: "assistant", text: "Tell us which tooth and leave your details." }] };
r = await post("/api/assist/lead", lead);
ok(r.status === 201 && r.data.ok === true, "details are sent (" + r.status + ")");
const items = (await owner("/api/messages")).data.items || [];
const m = items.find((x) => x.name === name);
ok(!!m, "the details reach the inbox (Messages)");
ok(m && m.email === lead.email && m.service === "Crown & bridge", "the inbox keeps the email and the service");
ok(m && m.message.startsWith("[Chat on the About page]"), "the inbox says the message came from the chat");
ok(m && m.message.includes("WhatsApp / phone: +84 90 000 0000") && m.message.includes("Visitor: I want you to design a crown for me"), "the phone and the chat so far are with the message");

// bots and bad input: nothing stored, the same answers as the contact form
const botName = uniq("Bot ");
r = await post("/api/assist/lead", { ...lead, name: botName, token: "" });
ok(r.status === 200 && r.data.ok, "no token: looks sent (a bot), not stored");
r = await post("/api/assist/lead", { ...lead, name: botName, website: "http://spam.example" });
ok(r.status === 200 && r.data.ok, "the hidden field filled: looks sent, not stored");
r = await post("/api/assist/lead", { ...lead, email: "not-an-email" });
ok(r.status === 400 && /email/i.test(r.data.error), "a bad email: a clear message (" + r.status + ")");
r = await post("/api/assist/lead", { ...lead, message: "hi", phone: "", transcript: [] });
ok(r.status === 400, "a message too short to act on: refused (" + r.status + ")");
const bots = (await owner("/api/messages")).data.items.filter((x) => x.name === botName);
ok(bots.length === 0, "the bots did not reach the inbox");

// the inbox stays private
const anon = await fetch(B + "/api/messages").then((x) => x.status);
ok(anon === 401 || anon === 403, "the inbox is not open to visitors (" + anon + ")");

done();
