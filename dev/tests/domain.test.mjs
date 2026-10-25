// Main domain: set only from the address the site is open at; every other address (d8-3d.pages.dev, www…) sends pages
// and 3D links there, branch previews and the API stay; robots / sitemap / canonical tags follow it; a way back in.
// The emulator answers any Host header, so "d8-3d.pages.dev" etc. are simulated on the local port.
// Run against: PAY=1 node dev/server.mjs public 8788 mat-khau-thu
import http from "node:http";
import { B, ok, done, signin, uniq } from "./lib.mjs";

const port = new URL(B).port;
const get = (host, path, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: "localhost", port, path, method: "GET", headers: { Host: host + ":" + port, ...headers } }, (res) => {
    const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
  });
  req.on("error", reject); req.end();
});
const owner = await signin("d.eightdesigncenter@gmail.com", "D.EIGHT");
let r;

// ---------- before: no main domain, nothing moves, the site stays closed to search engines
r = await owner("/api/settings");
ok(r.status === 200 && r.data.settings.siteHost === "" && r.data.host === "localhost", "no main domain yet; settings tell the address in use");
r = await get("d8-3d.pages.dev", "/");
ok(r.status === 200 && !r.body.includes("https://d8-3d.pages.dev") && r.body.includes(`href="http://d8-3d.pages.dev:${port}/"`) && /noindex/.test(r.headers["x-robots-tag"] || ""), "no main domain: page served where it is, tags use that address, not indexed");
r = await get("d8-3d.pages.dev", "/robots.txt");
ok(r.status === 200 && /Disallow: \/\s*$/m.test(r.body) && !/Sitemap/.test(r.body), "robots.txt still closed");

// ---------- only the address in use can be the main domain
r = await owner("/api/settings", { method: "POST", body: { siteHost: "d8designcenter.com" } });
ok(r.status === 400 && /tên miền đang mở/.test(r.data.error), "a domain the site is not open at is refused (" + r.status + ")");
r = await owner("/api/settings", { method: "POST", body: { siteHost: "d8-3d.pages.dev" } });
ok(r.status === 400, "a .pages.dev address cannot be the main domain");
const ktv = uniq("ktvd") + "@d8.example";
await owner("/api/staff", { method: "POST", body: { email: ktv, role: "designer" } });
const k = await signin(ktv, "KTV Domain");
r = await k("/api/settings", { method: "POST", body: { siteHost: "localhost" } });
ok(r.status === 403, "a KTV cannot set it");
r = await owner("/api/settings", { method: "POST", body: { siteHost: " LocalHost " } });
ok(r.status === 200 && r.data.settings.siteHost === "localhost", "the owner sets the address in use (cleaned)");
ok(r.data.settings.onlinePay === false || r.data.settings.onlinePay === true, "other settings kept");

// ---------- every other address sends pages and links to it
r = await get("d8-3d.pages.dev", "/privacy?x=1");
ok(r.status === 301 && r.headers.location === `http://localhost:${port}/privacy?x=1` && /no-store/.test(r.headers["cache-control"] || ""), "d8-3d.pages.dev → main domain, same path and query (" + r.status + " " + r.headers.location + ")");
r = await get("d8-3d.pages.dev", "/v/abc123");
ok(r.status === 301 && r.headers.location.endsWith("/v/abc123"), "old 3D links move too");
r = await get("www.example.test", "/admin");
ok(r.status === 301 && r.headers.location === `http://localhost:${port}/admin`, "any other address (www…) too");
r = await get("wip-antispam.d8-3d.pages.dev", "/");
ok(r.status === 200, "a branch preview stays where it is");
r = await get("d8-3d.pages.dev", "/api/config");
ok(r.status === 200 && JSON.parse(r.body).googleClientId !== undefined, "the API is not moved (pages already open keep working)");
r = await get("localhost", "/");
ok(r.status === 200, "the main domain itself is served");

// ---------- at the main domain: open to search engines, right address in the tags
r = await get("localhost", "/");
ok(!("x-robots-tag" in r.headers) && !/name="robots"/.test(r.body), "homepage at the main domain: no noindex");
ok(r.body.includes(`<link rel="canonical" href="http://localhost:${port}/">`) && r.body.includes(`og:url" content="http://localhost:${port}/"`) && r.body.includes(`og:image" content="http://localhost:${port}/site/og.jpg"`) && !r.body.includes("pages.dev"), "canonical / share tags use the main domain");
r = await get("localhost", "/privacy");
ok(r.status === 200 && !("x-robots-tag" in r.headers) && r.body.includes(`rel="canonical" href="http://localhost:${port}/privacy"`), "privacy page indexable, canonical set");
r = await get("localhost", "/about");
ok(r.status === 200 && !("x-robots-tag" in r.headers) && !/name="robots"/.test(r.body) && r.body.includes(`rel="canonical" href="http://localhost:${port}/about"`) && r.body.includes(`og:url" content="http://localhost:${port}/about"`) && !r.body.includes("pages.dev"), "About page indexable, canonical / share tags on the main domain");
r = await get("localhost", "/admin");
ok(r.status === 200 && /noindex/.test(r.headers["x-robots-tag"] || ""), "the workspace stays out of search");
r = await get("localhost", "/portal");
ok(/noindex/.test(r.headers["x-robots-tag"] || ""), "the portal stays out of search");
r = await get("localhost", "/robots.txt");
ok(r.status === 200 && /Allow: \//.test(r.body) && /Disallow: \/admin/.test(r.body) && /Disallow: \/portal/.test(r.body) && r.body.includes(`Sitemap: http://localhost:${port}/sitemap.xml`), "robots.txt opens the public pages, closes the private ones, names the sitemap");
r = await get("localhost", "/sitemap.xml");
ok(r.status === 200 && /application\/xml/.test(r.headers["content-type"]) && ["/", "/about", "/privacy", "/terms"].every((p) => r.body.includes(`<loc>http://localhost:${port}${p}</loc>`)) && !r.body.includes("/admin"), "sitemap lists the homepage, About and the legal pages only");
r = await get("wip-antispam.d8-3d.pages.dev", "/");
ok(/noindex/.test(r.headers["x-robots-tag"] || "") && r.body.includes(`rel="canonical" href="http://localhost:${port}/"`), "a preview points search engines to the main domain and is not indexed itself");

// ---------- the way back in if the main domain stops working
r = await get("d8-3d.pages.dev", "/admin?stay=1");
const cookie = (r.headers["set-cookie"] || [""])[0].split(";")[0];
ok(r.status === 302 && r.headers.location === "/admin" && cookie === "d8stay=1", "/admin?stay=1 keeps this browser on this address");
r = await get("d8-3d.pages.dev", "/admin", { Cookie: cookie });
ok(r.status === 200, "with it the workspace opens here");
r = await get("d8-3d.pages.dev", "/admin.js?v=1", { Cookie: "other=1; " + cookie });
ok(r.status === 200, "and its files load here too");

// ---------- clear: everything back as before
r = await owner("/api/settings", { method: "POST", body: { siteHost: "" } });
ok(r.status === 200 && r.data.settings.siteHost === "", "main domain cleared");
await new Promise((res) => setTimeout(res, 50));
r = await get("d8-3d.pages.dev", "/");
ok(r.status === 200, "no more moving");
r = await get("localhost", "/robots.txt");
ok(/Disallow: \/\s*$/m.test(r.body), "robots.txt closed again");
done();
