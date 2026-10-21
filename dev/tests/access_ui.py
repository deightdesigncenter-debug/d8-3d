"""Who sees what: a visitor who is not signed in only gets the website; a signed-in customer gets the website and
the customer portal but is locked out of the workspace; the owner can grant that customer account a role (staff page
or the account's page), after which the workspace opens; removing the role locks it out again.
Run against a local server: node dev/server.mjs public 8788 <password>  (with or without NO_DB=1)."""
import sys, os, time, json, urllib.parse
from playwright.sync_api import sync_playwright
B = os.environ.get("D8_BASE", "http://localhost:8788")
OUT = sys.argv[1] if len(sys.argv) > 1 else "shots-access"
os.makedirs(OUT, exist_ok=True)
FAILS, errors = [], []
def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: FAILS.append(m)
def block(route):
    u = route.request.url
    if "fonts.g" in u or "accounts.google" in u or "cdnjs" in u: return route.abort()
    return route.continue_()
SIGNIN = """async ([email,name]) => { const tok = await (await fetch('/__test/idtoken?email='+encodeURIComponent(email)+'&name='+encodeURIComponent(name))).text();
  const r = await fetch('/api/auth/google', {method:'POST', headers:{'Content-Type':'application/json','X-D8':'1'}, body: JSON.stringify({credential: tok})}); return r.status; }"""
STATUS = """async (paths) => { const out = {}; for (const p of paths) { const r = await fetch(p, {headers: {'X-D8': '1'}}); out[p] = r.status; } return out; }"""
LINKS = """() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => /^\\/(admin|stl)\\b/.test(h))"""
STAFF_API = ["/api/staff", "/api/staff/team", "/api/admin/users", "/api/orders", "/api/customers", "/api/reports?from=2026-01-01&to=2026-12-31", "/api/settings", "/api/jobs"]
stamp = str(int(time.time()))
CUST, NAME = f"tech{stamp}@lab.example", "Lan Tech " + stamp
with sync_playwright() as p:
    b = p.chromium.launch()
    def ctx(vp=None, mobile=False):
        c = b.new_context(viewport=vp or {"width": 1366, "height": 900}, is_mobile=mobile, has_touch=mobile, reduced_motion="reduce")
        c.route("**/*", block)
        return c
    def watch(pg, name):
        pg.on("pageerror", lambda e: errors.append(name + " PAGEERROR " + str(e)))
        pg.on("console", lambda m: errors.append(name + " console: " + m.text) if m.type == "error" and not any(x in m.text for x in ["ERR_FAILED", "401", "403", "404", "503"]) else None)
    def visible_panels(pg):
        return pg.eval_on_selector_all(".panel", "els => els.filter((e) => !e.hidden && e.offsetParent !== null).map((e) => e.id)")

    # 1. not signed in: only the website
    vc = ctx(); vp = vc.new_page(); watch(vp, "visitor")
    for path in ["/", "/portal", "/privacy", "/terms"]:
        vp.goto(B + path); vp.wait_for_timeout(700)
        ok(vp.evaluate(LINKS) == [], f"visitor: no workspace / STL link on {path}")
        ok(not vp.is_visible(".sh-switch"), f"visitor: no view switch on {path}")
    vp.goto(B + "/admin"); vp.wait_for_timeout(900)
    ok(vp.is_visible("#gate") and visible_panels(vp) == ["gate"], "visitor on /admin: only the sign-in card")
    ok(not vp.is_visible("#wsNav") and not vp.is_visible("#loginForm"), "visitor on /admin: no sidebar, password form folded away")
    vp.screenshot(path=f"{OUT}/visitor-admin.png", full_page=True)
    st = vp.evaluate(STATUS, STAFF_API)
    ok(all(v in (401, 403) for v in st.values()), "visitor: staff API refused " + json.dumps(st))
    vp.goto(B + "/stl"); vp.wait_for_timeout(700)
    ok(vp.is_visible("#login") and not vp.is_visible("#pick") and not vp.is_visible("#workspace"), "visitor on /stl: sign-in only")

    # 2. signed-in customer: website + customer portal, workspace locked
    cc = ctx(); cp = cc.new_page(); watch(cp, "customer")
    cp.goto(B + "/portal"); ok(cp.evaluate(SIGNIN, [CUST, NAME]) == 200, "customer signs in")
    def customer_locked(tag):
        cp.goto(B + "/"); cp.wait_for_timeout(800)
        sw = cp.eval_on_selector(".sh-switch", "e => [...e.querySelectorAll('a')].map((a) => a.getAttribute('href'))")
        ok(sw == ["/", "/portal"], f"{tag}: header switch is website + portal only {sw}")
        ok(cp.evaluate(LINKS) == [], f"{tag}: no workspace link on the website (menu included)")
        cp.goto(B + "/portal"); cp.wait_for_timeout(800)
        ok(cp.evaluate(LINKS) == [], f"{tag}: no workspace link in the customer portal")
        cp.goto(B + "/admin"); cp.wait_for_timeout(1000)
        ok(cp.is_visible("#gate") and visible_panels(cp) == ["gate"] and not cp.is_visible("#wsNav"), f"{tag}: /admin shows only the locked card")
        g = cp.inner_text("#gate")
        ok("tài khoản khách hàng" in g and CUST in g, f"{tag}: told this is a customer account")
        ok(not cp.is_visible("#gbtn") and not cp.is_visible(".pw-box") and cp.is_visible("#gate a[href='/']") and cp.is_visible("#gate a[href='/portal']"), f"{tag}: only the way back (website, portal, sign out)")
        st = cp.evaluate(STATUS, STAFF_API)
        ok(all(v in (401, 403) for v in st.values()), f"{tag}: staff API refused " + json.dumps(st))
        cp.goto(B + "/stl"); cp.wait_for_timeout(700)
        ok(not cp.is_visible("#pick") and not cp.is_visible("#workspace"), f"{tag}: STL tool locked")
    customer_locked("customer")
    cp.goto(B + "/admin"); cp.wait_for_timeout(900); cp.screenshot(path=f"{OUT}/customer-admin.png", full_page=True)
    mc = ctx({"width": 390, "height": 844}, True); mp = mc.new_page(); watch(mp, "customer-phone")
    mp.goto(B + "/portal"); mp.evaluate(SIGNIN, [CUST, NAME]); mp.goto(B + "/admin"); mp.wait_for_timeout(1000)
    ok(mp.evaluate("document.documentElement.scrollWidth") <= 390, "phone: locked card fits the width")
    mp.screenshot(path=f"{OUT}/customer-admin-phone.png", full_page=True)
    mc.close()

    # 3. the owner grants the customer account a role from the staff page
    oc = ctx(); op = oc.new_page(); watch(op, "owner")
    op.goto(B + "/admin"); op.evaluate(SIGNIN, ["d.eightdesigncenter@gmail.com", "Danny Do"]); op.goto(B + "/admin#staff"); op.reload(); op.wait_for_timeout(1500)
    ok(op.is_visible("#stAccounts"), "staff page: customer accounts card")
    op.fill("#acQ", "tech" + stamp); op.wait_for_timeout(300)
    rows = op.eval_on_selector_all("#acList .ac-row small", "els => els.map((e) => e.textContent)")
    ok(len(rows) == 1 and CUST in rows[0], "search finds the customer account")
    op.fill("#acQ", "lan tech " + stamp); op.wait_for_timeout(300)
    ok(op.eval_on_selector_all("#acList .ac-row", "e => e.length") == 1, "search by name works")
    op.select_option(f"#acList [data-acrole='{CUST}']", "designer")
    op.click(f"#acList [data-grant='{CUST}']"); op.wait_for_timeout(500)
    staff_now = op.eval_on_selector_all(".staff-row small", "els => els.map((e) => e.textContent)")
    ok(CUST not in staff_now, "one click does not grant yet (confirm needed)")
    op.screenshot(path=f"{OUT}/staff-accounts.png", full_page=True)
    op.click(f"#acList [data-grant='{CUST}']"); op.wait_for_timeout(1500)
    staff_now = op.eval_on_selector_all(".staff-row small", "els => els.map((e) => e.textContent)")
    ok(CUST in staff_now, "second click grants: account is now staff")
    op.fill("#acQ", "tech" + stamp); op.wait_for_timeout(300)
    ok(op.eval_on_selector_all("#acList .ac-row", "e => e.length") == 0, "granted account leaves the customer list")

    # 4. the same account now opens the workspace with the designer's menu
    cp.goto(B + "/"); cp.wait_for_timeout(800)
    sw = cp.eval_on_selector(".sh-switch", "e => [...e.querySelectorAll('a')].map((a) => a.getAttribute('href'))")
    ok("/admin" in sw, "granted: header shows the workspace switch")
    cp.goto(B + "/admin"); cp.wait_for_timeout(1500)
    nav = cp.eval_on_selector_all("#wsNav nav a > span:not(.count)", "els => els.map((e) => e.textContent.trim())")
    ok(cp.is_visible("#wsNav") and not cp.is_visible("#gate") and "Nhân sự & phân quyền" not in nav and "Báo cáo" not in nav and len(nav) >= 3, "granted: workspace opens with the designer menu " + str(nav))
    st = cp.evaluate(STATUS, ["/api/staff", "/api/admin/users"])
    ok(all(v == 403 for v in st.values()), "granted designer still cannot manage staff or settings " + json.dumps(st))

    # 5. removing the role locks the account out again
    op.evaluate("async (e) => (await fetch('/api/staff/' + encodeURIComponent(e), {method: 'DELETE', headers: {'X-D8': '1'}})).status", CUST)
    customer_locked("removed")

    # 6. grant from the account's own page (Khách hàng > tài khoản)
    op.goto(B + "/admin#customers/" + urllib.parse.quote(CUST)); op.wait_for_timeout(1800)
    box = op.inner_text("#custAccess") if op.is_visible("#custAccess") else ""
    ok("Tài khoản khách hàng" in box, "account page: shows the account is locked out")
    op.click("#caGrant"); op.wait_for_timeout(300); op.click("#caGrant"); op.wait_for_timeout(1500)
    ok("là nhân sự" in op.inner_text("#custAccess"), "account page: granted from here")
    op.screenshot(path=f"{OUT}/account-granted.png", full_page=True)
    cp.goto(B + "/admin"); cp.wait_for_timeout(1500)
    ok(cp.is_visible("#wsNav") and not cp.is_visible("#gate"), "granted from the account page: workspace opens")
    op.evaluate("async (e) => (await fetch('/api/staff/' + encodeURIComponent(e), {method: 'DELETE', headers: {'X-D8': '1'}})).status", CUST)
    b.close()
for e in errors: print("ERR", e)
ok(not errors, "no page errors")
print(("%d FAILED" % len(FAILS)) if FAILS else "ALL PASSED")
sys.exit(1 if FAILS else 0)
