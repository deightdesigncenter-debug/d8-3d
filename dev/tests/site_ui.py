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
    # the owner's figures (2026-11-11): single cases 6–8 h, full-arch 8–12 h, cases received 24/7, revisions free until approval
    body = pg.inner_text("body")
    ok("within 24 hours" not in body and "24-hour" not in body and "as standard" not in body, "nothing left of the 24-hour and 2-revision wording")
    ok("6–8 h" in pg.inner_text("#services .facts") and "until you approve" in pg.inner_text("#services .facts") and "8–12 h" in pg.inner_text("#process .turn"), "facts and process show the new times and the revision promise")
    faq = pg.text_content("#faq")   # the answers are folded away: read the text, not what is on screen
    ok(pg.eval_on_selector_all("#faq details", "els => els.length") == 10 and "By people" in faq and "never physical work" in faq and "free until you approve" in faq, "FAQ: ten questions, with who designs, that nothing is shipped, and free revisions until approval")
    ok("approve it in 3D before you pay" in pg.inner_text("#trial .offer2"), "trial: the first full-arch case is paid after approval")
    # the clock card: when a case sent now would be ready, on the visitor's own clock
    WIN = "(h) => { const f = (ms) => new Date(ms).toLocaleTimeString(document.documentElement.lang === 'vi' ? 'vi-VN' : undefined, { hour: 'numeric', minute: '2-digit' }); const out = []; for (const back of [0, 60000]) out.push(f(Date.now() - back + h[0] * 36e5) + ' – ' + f(Date.now() - back + h[1] * 36e5)); return out; }"
    ok(pg.inner_text("#etaSingle") in pg.evaluate(WIN, [6, 8]) and pg.inner_text("#etaArch") in pg.evaluate(WIN, [8, 12]), "clock card: single case ready in 6–8 hours from now, full-arch in 8–12 (" + pg.inner_text("#etaSingle") + ")")
    ok(pg.inner_text("#etaNow").startswith("It is ") and pg.inner_text("#etaSingleDay").startswith("Ready "), "clock card says what time it is for the visitor and which day the file is ready")
    ok(half("#turnaround .eta-card") and pg.eval_on_selector("#proof", "e => e.hidden"), "turnaround band fills its row; the proof section is hidden while nothing is set")
    pg.click(".sh-top .sh-lang button[data-lang=vi]"); pg.wait_for_timeout(300)
    ok("vẫn còn thắc mắc?" in pg.inner_text("#faq").lower() and "sửa đến khi bạn duyệt thiết kế" in pg.inner_text("#services").lower() and "gửi ca đầu tiên" in pg.inner_text("#trial").lower(), "new homepage text has its Vietnamese copy")
    ok(pg.inner_text("#etaNow").startswith("Bây giờ là") and pg.inner_text("#etaSingle") in pg.evaluate(WIN, [6, 8]) and "Hours, not days" in pg.inner_text("#turnaround") and "ca full-arch" in pg.inner_text("#turnaround").lower(),
       "clock card and turnaround band in Vietnamese (24-hour clock; the slogan stays in English)")
    # slogans stay in English in the Vietnamese version (owner's choice)
    ok("design to fit." in pg.inner_text("#stage h1").lower() and "precision, by design" in pg.inner_text(".editorial h2").lower() and pg.eval_on_selector("#stage h1", "e => e.lang") == "en", "slogans stay in English in Vietnamese")
    pg.click(".sh-top .sh-lang button[data-lang=en]")
    c.close()
    # proof on the homepage: what the owner entered in Settings, shown as text (never as markup); nothing set = hidden
    SET = "async (b) => (await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-D8': '1' }, body: JSON.stringify(b) })).status"
    c, pg = page(motion="reduce"); pg.goto(B + "/"); pg.evaluate(SIGNIN, ["d.eightdesigncenter@gmail.com", "Danny Do"])
    st = pg.evaluate(SET, {"proofCases": 1240, "quotes": [{"text": "Fits first time <img src=x onerror=window.__x=1>", "who": "Dr A. Example", "where": "Example Dental, Denver"}, {"text": "Fast and careful.", "who": "Lab owner", "where": "Sydney"}]})
    c.close()
    for vp, mob, tag in [({"width": 1366, "height": 860}, False, "desktop"), ({"width": 390, "height": 844}, True, "phone")]:
        c, pg = page(vp, mob, motion="reduce"); pg.goto(B + "/")
        try: pg.wait_for_selector("#proof:not([hidden])", timeout=6000)
        except Exception: pass
        ok(st == 200 and pg.is_visible("#proof") and "1,240" in pg.inner_text("#pfCount") and "Fits first time <img" in pg.inner_text("#pfQuotes") and "Lab owner" in pg.inner_text("#pfQuotes")
           and pg.query_selector("#pfQuotes img") is None and not pg.evaluate("window.__x"), tag + ": proof shows the number and the quotes as plain text")
        ok(pg.evaluate("document.documentElement.scrollWidth") <= vp["width"], tag + ": proof section fits the width")
        pg.evaluate("document.getElementById('proof').scrollIntoView()"); pg.wait_for_timeout(200)
        pg.locator("#proof").screenshot(path=f"{OUT}/home-proof-{tag}.png")
        c.close()
    c, pg = page(motion="reduce"); pg.goto(B + "/"); pg.evaluate(SIGNIN, ["d.eightdesigncenter@gmail.com", "Danny Do"])
    ok(pg.evaluate(SET, {"proofCases": 0, "quotes": []}) == 200, "proof cleared again")
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
