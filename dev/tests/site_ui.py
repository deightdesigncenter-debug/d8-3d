"""Public site and shared shell: homepage (light/dark), theme toggle, phone menu, reveal and reduced motion,
contact form, legal pages, sign-in gates, no horizontal overflow, no page errors."""
import sys, os, time
from playwright.sync_api import sync_playwright
B = os.environ.get("D8_BASE", "http://localhost:8788")
OUT = sys.argv[1] if len(sys.argv) > 1 else "shots-site"
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
with sync_playwright() as p:
    b = p.chromium.launch()
    def page(vp=None, mobile=False, scheme="light", motion="no-preference"):
        c = b.new_context(viewport=vp or {"width": 1366, "height": 900}, is_mobile=mobile, has_touch=mobile, color_scheme=scheme, reduced_motion=motion)
        c.route("**/*", block)
        pg = c.new_page()
        pg.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
        pg.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
        return c, pg
    # theme follows the system the first time, then the visitor's choice
    c, pg = page(scheme="dark"); pg.goto(B + "/"); pg.wait_for_timeout(600)
    ok(pg.evaluate("document.documentElement.dataset.theme") == "dark", "dark system -> dark site")
    pg.click(".sh-top .sh-theme"); pg.wait_for_timeout(300)
    ok(pg.evaluate("document.documentElement.dataset.theme") == "light" and pg.evaluate("localStorage.getItem('d8-theme')") == "light", "toggle to light is remembered")
    pg.reload(); pg.wait_for_timeout(300)
    ok(pg.evaluate("document.documentElement.dataset.theme") == "light", "light after reload")
    pg.screenshot(path=f"{OUT}/home-light.png")
    # reveal + parallax + CTA accents
    pg.mouse.wheel(0, 1200); pg.wait_for_timeout(700)
    ok(pg.eval_on_selector_all(".reveal.in", "e=>e.length") > 0, "content reveals on scroll")
    ok(pg.eval_on_selector(".stage", "e=>e.style.getPropertyValue('--py')") != "", "hero parallax runs")
    ok(pg.eval_on_selector("#fab", "e=>getComputedStyle(e,'::after').animationName") == "d8-ring", "chat button accent")
    dur = pg.eval_on_selector(".btn", "e=>getComputedStyle(e).transitionDuration")
    ok(all(float(x.strip()[:-1]) <= 0.3 for x in dur.split(",")), "button transitions <= 300ms (" + dur + ")")
    # contact form: busy then thanks
    pg.evaluate("document.getElementById('contact').scrollIntoView()"); pg.wait_for_timeout(300)
    pg.fill("#cName", "Dr. Anna Smith"); pg.fill("#cEmail", "anna@smile.example"); pg.fill("#cMsg", "Could you send your price list for implant crowns?")
    pg.wait_for_timeout(3100); pg.click("#cSend")
    pg.wait_for_selector("#cThanks:not([hidden])", timeout=5000)
    ok(True, "contact form sends")
    c.close()
    # reduced motion switches the effects off
    c, pg = page(motion="reduce"); pg.goto(B + "/"); pg.wait_for_timeout(500)
    ok(pg.eval_on_selector("#trial .cta-shine", "e=>getComputedStyle(e,'::before').animationName") == "none", "reduced motion: no shine")
    ok(pg.eval_on_selector(".reveal", "e=>getComputedStyle(e).opacity") == "1", "reduced motion: content visible at once")
    c.close()
    # phone: menu slides, every page fits the width
    c, pg = page({"width": 390, "height": 844}, True)
    pg.goto(B + "/privacy"); pg.wait_for_timeout(500)
    pg.click(".sh-burger"); pg.wait_for_timeout(400)
    ok(pg.eval_on_selector(".sh-drawer", "e=>!e.hidden && e.classList.contains('open')"), "phone menu opens")
    pg.click(".sh-scrim", position={"x": 200, "y": 780}); pg.wait_for_timeout(450)
    ok(pg.eval_on_selector(".sh-drawer", "e=>e.hidden"), "phone menu closes")
    for path in ["/", "/about", "/privacy", "/terms", "/portal", "/admin", "/stl"]:
        pg.goto(B + path); pg.wait_for_timeout(700)
        w = pg.evaluate("document.documentElement.scrollWidth")
        ok(w <= 390, f"phone width ok on {path} ({w})")
    pg.screenshot(path=f"{OUT}/phone-stl-gate.png", full_page=True)
    c.close()
    # wide monitor (1920): content uses the width, no section leaves half the row empty
    c, pg = page({"width": 1920, "height": 1080}, motion="reduce"); pg.goto(B + "/"); pg.wait_for_timeout(900)
    ww = pg.eval_on_selector("#services .wrap", "e => e.getBoundingClientRect().width")
    ok(ww >= 1400, "wide screen: content is %d px wide (side margins under 260 px)" % ww)
    half = lambda sel: pg.eval_on_selector(sel, "e => { const r = e.getBoundingClientRect(), w = e.closest('.wrap').getBoundingClientRect(); return r.right > w.left + w.width * 0.6 && r.height > 40; }")
    ok(half("#services .facts") and half("#why .head-lead") and half("#process .turn") and half("#faq .faq-help"), "wide screen: the right half of the section heads and FAQ is filled")
    fig, txt = pg.eval_on_selector("#trial .offer-fig", "e => e.getBoundingClientRect().height"), pg.eval_on_selector("#trial .offer-in > div:last-child", "e => e.getBoundingClientRect().height")
    ok(abs(fig - txt) < 4, "free-trial card is as tall as the text beside it (%d / %d)" % (fig, txt))
    w = pg.evaluate("document.documentElement.scrollWidth")
    ok(w <= 1920, f"wide screen: no sideways scroll ({w})")
    pg.screenshot(path=f"{OUT}/home-1920.png", full_page=True)
    pg.click(".sh-top .sh-lang button[data-lang=vi]"); pg.wait_for_timeout(300)
    ok("vẫn còn thắc mắc?" in pg.inner_text("#faq").lower() and "lần chỉnh sửa miễn phí mỗi ca" in pg.inner_text("#services").lower() and "gửi ca đầu tiên" in pg.inner_text("#trial").lower(), "new homepage text has its Vietnamese copy")
    # slogans stay in English in the Vietnamese version (owner's choice)
    ok("design to fit." in pg.inner_text("#stage h1").lower() and "precision, by design" in pg.inner_text(".editorial h2").lower() and pg.eval_on_selector("#stage h1", "e => e.lang") == "en", "slogans stay in English in Vietnamese")
    pg.click(".sh-top .sh-lang button[data-lang=en]")
    c.close()
    # legal pages switch language; a customer sees no Workspace link, staff do
    c, pg = page(); pg.goto(B + "/terms"); pg.wait_for_timeout(400)
    pg.click(".sh-top .sh-lang button[data-lang=vi]"); pg.wait_for_timeout(300)
    ok("ĐIỀU KHOẢN" in pg.inner_text(".pt-band h1").upper() and pg.is_visible('article[data-lang-block="vi"]') and not pg.is_visible('article[data-lang-block="en"]'), "terms in Vietnamese")
    pg.click(".sh-top .sh-lang button[data-lang=en]")
    pg.goto(B + "/portal"); pg.evaluate(SIGNIN, ["visitor%d@lab.example" % int(time.time()), "Visitor"]); pg.reload(); pg.wait_for_timeout(700)
    ok("Workspace" not in pg.inner_text(".sh-bar"), "customer header has no Workspace switch")
    pg.goto(B + "/admin"); pg.wait_for_timeout(800)
    ok(pg.is_visible("#gate") and "tài khoản khách hàng" in pg.inner_text("#gate") and not pg.is_visible("#wsNav"), "customer sees the locked workspace card")
    pg.evaluate(SIGNIN, ["d.eightdesigncenter@gmail.com", "Danny Do"]); pg.goto(B + "/"); pg.wait_for_timeout(700)
    ok("WORKSPACE" in pg.inner_text(".sh-bar").upper(), "staff header shows the Workspace switch")
    c.close()
    b.close()
for e in errors: print("ERR", e)
ok(not errors, "no page errors")
print(("%d FAILED" % len(FAILS)) if FAILS else "ALL PASSED")
sys.exit(1 if FAILS else 0)
