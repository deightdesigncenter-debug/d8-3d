// Small helpers shared by the API tests (dev server on localhost).
export const B = process.env.D8_BASE || "http://localhost:8788";
export const PW = process.env.D8_PASSWORD || "mat-khau-thu";
let fails = 0, passes = 0;
export function ok(cond, msg) {
  if (cond) passes++; else fails++;
  console.log((cond ? "PASS " : "FAIL ") + msg);
}
export function done() {
  console.log(fails ? `${fails} FAILED, ${passes} passed` : `ALL ${passes} PASSED`);
  process.exitCode = fails ? 1 : 0;
}
export const uniq = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// Sign in with a fake Google token (dev server only); returns a fetch helper with that session.
export async function signin(email, name) {
  const tok = await (await fetch(`${B}/__test/idtoken?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`)).text();
  const r = await fetch(B + "/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json", "X-D8": "1" }, body: JSON.stringify({ credential: tok }) });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const headers = { Cookie: cookie, "X-D8": "1" };
  const call = (path, opts = {}) => fetch(B + path, { ...opts, redirect: "manual",
    headers: { ...headers, "Content-Type": "application/json", ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined })
    .then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));
  call.headers = headers;
  return call;
}
export const follow = async (url) => (await fetch(url, { redirect: "manual" })).headers.get("location");
