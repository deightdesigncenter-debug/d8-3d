"""Without the D1 database (binding DB missing) the workspace still works: old dashboard and portal cases,
and the order book screens explain how to connect the database. Run against: NO_DB=1 node dev/server.mjs …"""
import sys, os
from playwright.sync_api import sync_playwright
B = os.environ.get("D8_BASE", "http://localhost:8788")
OUT = sys.argv[1] if len(sys.argv) > 1 else "shots-nodb"
os.makedirs(OUT, exist_ok=True)
FAILS, errors = [], []
def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: FAILS.append(m)
SIGNIN = """async ([email,name]) => { const tok = await (await fetch('/__test/idtoken?email='+encodeURIComponent(email)+'&name='+encodeURIComponent(name))).text();
  const r = await fetch('/api/auth/google', {method:'POST', headers:{'Content-Type':'application/json','X-D8':'1'}, body: JSON.stringify({credential: tok})}); return r.status; }"""
with sync_playwright() as p:
    b = p.chromium.launch(); c = b.new_context(viewport={"width": 1366, "height": 900})
    c.route("**/*", lambda r: r.abort() if ("fonts.g" in r.request.url or "accounts.google" in r.request.url or "cdnjs" in r.request.url) else r.continue_())
    pg = c.new_page()
    pg.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    pg.goto(B + "/admin"); pg.evaluate(SIGNIN, ["d.eightdesigncenter@gmail.com", "Danny Do"]); pg.reload(); pg.wait_for_timeout(1500)
    ok(pg.query_selector("#dash .card") is not None, "dashboard works without the database")
    pg.goto(B + "/admin#orders"); pg.wait_for_timeout(1200)
    ok("Chưa kết nối cơ sở dữ liệu" in pg.inner_text("#p-orders"), "order list explains the missing database")
    pg.goto(B + "/admin#settings"); pg.wait_for_timeout(1200)
    t = pg.inner_text("#p-settings")
    ok("Chưa kết nối" in t and "d8-db" in t and "DB" in t, "settings show how to connect D1")
    pg.screenshot(path=f"{OUT}/settings.png", full_page=True)
    pg.goto(B + "/admin#customers"); pg.wait_for_timeout(1500)
    ok(pg.query_selector("#custBody") is not None, "customers fall back to the Google account list")
    pg.goto(B + "/admin#jobs"); pg.wait_for_timeout(1200)
    ok(pg.is_visible("#p-jobs"), "portal cases list works")
    b.close()
for e in errors: print("ERR", e)
ok(not errors, "no page errors")
print(("%d FAILED" % len(FAILS)) if FAILS else "ALL PASSED")
sys.exit(1 if FAILS else 0)
