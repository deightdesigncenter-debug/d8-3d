"""Main domain in the browser: the Settings card (not set → set from the address in use → clear), another address of the
site sends the visitor to the main domain and the page works there, a KTV has no Settings.
Screenshots (light, dark, phone) go to the folder given as the first argument."""
import sys, os, time, json
from playwright.sync_api import sync_playwright
B = os.environ.get("D8_BASE", "http://localhost:8788")
PORT = B.rsplit(":", 1)[1]
OUT = sys.argv[1] if len(sys.argv) > 1 else "shots-domain"
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
stamp = str(int(time.time()))
with sync_playwright() as p:
    # "www.d8.test" stands for another address of the site (the emulator answers any host name)
    b = p.chromium.launch(args=["--host-resolver-rules=MAP www.d8.test 127.0.0.1"])
    rq = p.request.new_context(base_url=B)
    H = {"Content-Type": "application/json", "X-D8": "1"}
    tok = rq.get("/__test/idtoken?email=d.eightdesigncenter%40gmail.com&name=D.EIGHT").text()
    rq.post("/api/auth/google", data=json.dumps({"credential": tok}), headers=H)
    main = lambda: rq.get("/api/settings", headers=H).json()["settings"]["siteHost"]
    def ctx(vp=None, mobile=False, theme="light"):
        c = b.new_context(viewport=vp or {"width": 1366, "height": 900}, is_mobile=mobile, has_touch=mobile, reduced_motion="reduce")
        c.route("**/*", block)
        c.add_init_script(f"try{{localStorage.setItem('d8-theme','{theme}')}}catch(e){{}}")
        pg = c.new_page()
        pg.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
        pg.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
        return c, pg
    ok(main() == "", "starts without a main domain")
    for theme, vp, mobile in [("light", None, False), ("dark", None, False), ("light", {"width": 390, "height": 844}, True)]:
        tag = theme + ("-phone" if mobile else "")
        c, pg = ctx(vp, mobile, theme)
        pg.goto(B + "/"); pg.evaluate(SIGNIN, ["d.eightdesigncenter@gmail.com", "D.EIGHT"])
        pg.goto(B + "/admin#settings"); pg.wait_for_selector("#domCard", timeout=8000)
        ok("Chưa đặt tên miền chính" in pg.inner_text("#domCard") and pg.locator("#domSet").count() == 1, tag + ": not set yet, offers the address in use")
        ok("cơ sở dữ liệu D1" in pg.inner_text("#caseStore"), tag + ": settings say the cases are kept in D1")
        pg.locator("#domCard").scroll_into_view_if_needed()
        pg.screenshot(path=f"{OUT}/settings-unset-{tag}.png", full_page=True)
        pg.click("#domSet"); pg.wait_for_selector("#domOff", timeout=6000)
        ok(main() == "localhost" and "Tên miền chính: localhost" in pg.inner_text("#domCard"), tag + ": set from the page")
        pg.locator("#domCard").scroll_into_view_if_needed()
        pg.screenshot(path=f"{OUT}/settings-set-{tag}.png", full_page=True)
        w = pg.evaluate("document.documentElement.scrollWidth")
        ok(w <= (vp or {"width": 1366})["width"], tag + ": settings page fits the width (%d)" % w)
        if tag == "light":
            # another address: the visitor lands on the main domain and the homepage works there
            v = b.new_context(reduced_motion="reduce"); v.route("**/*", block); vp_ = v.new_page()
            vp_.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
            vp_.goto(f"http://www.d8.test:{PORT}/privacy"); vp_.wait_for_load_state("load")
            ok(vp_.url == f"http://localhost:{PORT}/privacy", "another address → the main domain (" + vp_.url + ")")
            ok(vp_.locator("article").count() > 0, "and the page is there")
            vp_.goto(f"http://www.d8.test:{PORT}/admin?stay=1#settings"); vp_.wait_for_load_state("load")
            ok(vp_.url.startswith(f"http://www.d8.test:{PORT}/admin") and "stay" not in vp_.url, "/admin?stay=1 keeps the workspace on that address (" + vp_.url + ")")
            v.close()
        pg.click("#domOff"); pg.wait_for_selector("#domSet", timeout=6000)
        ok(main() == "", tag + ": cleared")
        c.close()
    ktv = f"ktvdom{stamp}@d8.example"
    rq.post("/api/staff", data=json.dumps({"email": ktv, "role": "designer"}), headers=H)
    c, pg = ctx()
    pg.goto(B + "/"); pg.evaluate(SIGNIN, [ktv, "KTV Dom"])
    pg.goto(B + "/admin#settings"); pg.wait_for_timeout(1000)
    ok(pg.locator("#domCard").count() == 0, "KTV: no domain settings")
    c.close()
    b.close()
real = [e for e in errors if "401" not in e and "403" not in e]
ok(not real, "no page errors" + ("" if not real else ": " + "; ".join(real[:5])))
print(f"{len(FAILS)} FAILED" if FAILS else "ALL PASSED")
sys.exit(1 if FAILS else 0)
