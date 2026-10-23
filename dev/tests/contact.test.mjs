// Contact form anti-spam (WPForms-style): signed time token, honeypot, too-fast, link / keyword / email filters,
// the owner's own block lists, per-address limit, blocked messages kept for review, and Cloudflare Turnstile when on.
// Run against: PAY=1 node dev/server.mjs public 8788 mat-khau-thu   (and again with TS=1 for the Turnstile part)
import { B, ok, done, signin, uniq } from "./lib.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const owner = await signin("d.eightdesigncenter@gmail.com", "D.EIGHT");
const cfg = await (await fetch(B + "/api/config")).json();
const TS = !!cfg.turnstile;
let ipN = 10 + Math.floor(Math.random() * 200);
const nextIp = () => "198.51." + Math.floor(ipN / 250) + "." + (ipN++ % 250);
const getToken = async () => {
  const r = await fetch(B + "/api/contact/token");
  return { status: r.status, cache: r.headers.get("cache-control") || "", ...(await r.json()) };
};
const T = await getToken();
ok(T.status === 200 && /^\d{13}\.[A-Za-z0-9_-]{32}$/.test(T.token) && T.minMs === 3000 && /no-store/.test(T.cache), "token: signed, 3 s minimum, never cached");
await sleep(3100); // a person takes longer than 3 s to fill the form; this token is old enough for the sends below
const send = async (fields = {}, { token = T.token, ip = nextIp(), turnstile = TS ? "ok-token" : undefined } = {}) => {
  const name = fields.name || uniq("Dr Test ");
  const body = { name, email: "dr@smile.example", practice: "Smile Clinic", country: "US", service: "Crown & bridge",
    message: "Could you send your price list for implant crowns, please?", lang: "en", ...fields, name, ...(token == null ? {} : { token }), ...(turnstile ? { turnstile } : {}) };
  const r = await fetch(B + "/api/contact", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})), name };
};
const inbox = async () => (await owner("/api/messages")).data.items || [];
const spamList = async () => (await owner("/api/messages/spam")).data;
const stored = async (name) => (await inbox()).some((m) => m.name === name);
const blocked = async (name) => ((await spamList()).items || []).find((m) => m.name === name);

// ---------- a real message goes through, a link to a scan is fine
let r = await send();
ok(r.status === 201 && (await stored(r.name)), "a real message is stored (" + r.status + ")");
r = await send({ message: "Here is the scan for a trial case: https://www.dropbox.com/s/abc/case.stl Thanks!" });
ok(r.status === 201, "one link (a scan to share) is fine (" + r.status + ")");
r = await send({ message: "We visited the museo service desk; please design 2 crowns for our lab (exocad)." });
ok(r.status === 201, "a word that only contains a keyword is not blocked (" + r.status + ")");

// ---------- bots: a quiet "ok", nothing stored, kept in the blocked list
r = await send({}, { token: null });
ok(r.status === 200 && r.data.ok && !(await stored(r.name)), "no token: looks sent, not stored");
ok((await blocked(r.name))?.reason === "token", "no token: in the blocked list (reason token)");
r = await send({}, { token: T.token.split(".")[0] + "." + "A".repeat(32) });
ok(r.status === 200 && !(await stored(r.name)) && (await blocked(r.name))?.reason === "token", "forged token: dropped");
r = await send({}, { token: String(Date.now() - 2 * 86400e3) + "." + T.token.split(".")[1] });
ok(r.status === 200 && !(await stored(r.name)) && (await blocked(r.name))?.reason === "token", "old time with another token's signature: dropped");
const fresh = await getToken();
r = await send({}, { token: fresh.token });
ok(r.status === 200 && !(await stored(r.name)) && (await blocked(r.name))?.reason === "fast", "sent within 3 s of the token: dropped (reason fast)");
r = await send({ website: "http://spam.example" });
ok(r.status === 200 && !(await stored(r.name)) && (await blocked(r.name))?.reason === "honeypot", "hidden field filled: dropped (reason honeypot)");

// ---------- filters: a person is told to email instead
const refused = (x, code) => x.status === 400 && x.data.code === code && /d\.eightdesigncenter@gmail\.com/.test(x.data.error);
r = await send({ message: "Great deals http://a.example http://b.example http://c.example check them all" });
ok(refused(r, "links") && !(await stored(r.name)) && (await blocked(r.name))?.reason === "links", "three links: refused with our email (links)");
const linkName = r.name;
r = await send({ name: "Visit http://spam.example now" });
ok(refused(r, "links"), "a link in the name: refused");
r = await send({ message: "Hello, see [url=http://spam.example]our offer[/url] today" });
ok(refused(r, "links"), "BBCode link: refused");
r = await send({ message: "<a href=\"http://spam.example\">cheap</a> offer for your clinic" });
ok(refused(r, "links"), "HTML link: refused");
r = await send({ message: "We offer SEO services to rank your website on the first page." });
ok(refused(r, "words") && (await blocked(r.name))?.reason === "words", "advertising words (SEO services): refused (words)");
const wordName = r.name;
r = await send({ message: "Buy CRYPTO now and earn big, best returns for dentists" });
ok(refused(r, "words"), "keywords ignore upper / lower case");
r = await send({ email: "bot@mailinator.com" });
ok(refused(r, "email"), "disposable email: refused");
r = await send({ email: "bot@x.yopmail.com" });
ok(refused(r, "email"), "disposable email on a sub-domain: refused");

// ---------- the owner's own lists
r = await owner("/api/settings");
ok(r.status === 200 && r.data.spam && r.data.spam.perIp === 4 && r.data.spam.daily === 30 && r.data.spam.minSec === 3 && r.data.turnstile === TS, "settings show the anti-spam limits and Turnstile status");
r = await owner("/api/settings", { method: "POST", body: { spamWords: "Free iPhone\n  gift card ,", blockEmails: "Spammer.example\nonly@bad.example" } });
ok(r.status === 200 && r.data.settings.spamWords === "free iphone\ngift card" && r.data.settings.blockEmails === "spammer.example\nonly@bad.example", "own lists are saved cleaned (lower case, one per line)");
ok(r.data.settings.onlinePay === false || r.data.settings.onlinePay === true, "other settings kept");
r = await send({ message: "Claim your FREE iPhone today, limited offer for clinics" });
ok(refused(r, "words"), "own keyword blocks");
r = await send({ email: "bob@spammer.example" });
ok(refused(r, "email"), "own blocked domain");
r = await send({ email: "bob@mail.spammer.example" });
ok(refused(r, "email"), "own blocked domain covers sub-domains");
r = await send({ email: "only@bad.example" });
ok(refused(r, "email"), "own blocked address");
r = await send({ email: "other@bad.example" });
ok(r.status === 201, "another address on that domain still works (" + r.status + ")");
r = await owner("/api/settings", { method: "POST", body: { spamWords: "", blockEmails: "" } });
ok(r.data.settings.spamWords === "" && r.data.settings.blockEmails === "", "own lists cleared");
r = await send({ email: "bob@spammer.example" });
ok(r.status === 201, "cleared list no longer blocks (" + r.status + ")");

// ---------- one address: a few messages a day
const ip = nextIp();
const codes = [];
for (let i = 0; i < 5; i++) codes.push((await send({}, { ip })).status);
ok(codes.slice(0, 4).every((c) => c === 201) && codes[4] === 429, "one address: 4 messages a day, the 5th is refused (" + codes.join(",") + ")");
r = await send({}, { ip });
ok(r.status === 429 && r.data.code === "ip" && /email/i.test(r.data.error), "the limit message offers our email");
r = await send({}, { ip: nextIp() });
ok(r.status === 201, "another address still works");

// ---------- review: restore or delete a blocked message
let list = await spamList();
ok(list.db === true && list.items.length >= 8 && list.items.every((x) => x.reason && x.at && "message" in x), "blocked list: reason, time and the message");
const lk = list.items.find((x) => x.name === linkName), wd = list.items.find((x) => x.name === wordName);
r = await owner(`/api/messages/spam/${lk.id}/restore`, { method: "POST" });
ok(r.status === 200 && r.data.restored && (await stored(linkName)), "“not spam” moves it into the inbox");
ok(!(await blocked(linkName)), "and out of the blocked list");
r = await owner(`/api/messages/spam/${wd.id}`, { method: "DELETE" });
ok(r.status === 200 && !(await blocked(wordName)) && !(await stored(wordName)), "delete removes it");
r = await owner(`/api/messages/spam/${wd.id}`, { method: "DELETE" });
ok(r.status === 404, "already gone: 404");

// ---------- who may see it
const ktv = uniq("ktvs") + "@d8.example";
await owner("/api/staff", { method: "POST", body: { email: ktv, role: "designer" } });
const k = await signin(ktv, "KTV Spam");
r = await k("/api/messages/spam");
ok(r.status === 403, "a KTV cannot read blocked messages");
r = await k(`/api/messages/spam/${list.items[0].id}/restore`, { method: "POST" });
ok(r.status === 403, "a KTV cannot restore one");
r = await k("/api/settings", { method: "POST", body: { spamWords: "dental" } });
ok(r.status === 403, "a KTV cannot change the block lists");
const cust = await signin(uniq("cus") + "@clinic.example", "Clinic");
r = await cust("/api/messages/spam");
ok([401, 403].includes(r.status), "a customer cannot read blocked messages (" + r.status + ")");
r = await fetch(B + "/api/messages/spam");
ok([401, 403].includes(r.status), "nobody signed out can (" + r.status + ")");

// ---------- Cloudflare Turnstile (only when the keys are set: TS=1)
if (TS) {
  ok(cfg.turnstile === "1x-test-site", "config hands the page the Turnstile site key");
  r = await send({}, { turnstile: "" });
  ok(r.status === 400 && r.data.code === "captcha" && !(await stored(r.name)), "Turnstile on: no check, refused");
  r = await send({}, { turnstile: "bad-token" });
  ok(r.status === 400 && r.data.code === "captcha" && (await blocked(r.name))?.reason === "captcha", "Turnstile on: a failed check, refused and kept for review");
  r = await send({}, { turnstile: "ok-token" });
  ok(r.status === 201, "Turnstile on: a passed check goes through");
} else {
  ok(!("turnstile" in cfg), "Turnstile off: nothing in the config");
}
done();
