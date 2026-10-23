"""Contact form anti-spam in the browser: a person who sends fast still gets through (the page waits for the token),
a bot that fills the hidden field is dropped quietly, a link-spam message is refused with our email, Turnstile
(when the keys are set: TS=1) renders in a reserved box and its answer is sent; the workspace lists blocked messages
(restore / delete) and the Settings page shows the anti-spam card and saves the block lists.
Screenshots (light, dark, phone) go to the folder given as the first argument."""
import sys, os, time, json
from playwright.sync_api import sync_playwright
B = os.environ.get("D8_BASE", "http://localhost:8788")
OUT = sys.argv[1] if len(sys.argv) > 1 else "shots-contact"
os.makedirs(OUT, exist_ok=True)
FAILS, errors = [], []
def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: FAILS.append(m)
def block(route):
    u = route.request.url
    if "fonts.g" in u or "accounts.google" in u or "cdnjs" in u or "challenges.cloudflare" in u: return route.abort()
    return route.continue_()
SIGNIN = """async ([email,name]) => { const tok = await (await fetch('/__test/idtoken?email='+encodeURIComponent(email)+'&name='+encodeURIComponent(name))).text();
  const r = await fetch('/api/auth/google', {method:'POST', headers:{'Content-Type':'application/json','X-D8':'1'}, body: JSON.stringify({credential: tok})}); return r.status; }"""
# stands in for Cloudflare's script (no network in tests): records the options, answers "ok-token" unless told not to
STUB = """window.turnstile = { render(el, o) { window.__ts = o; el.innerHTML = '<div class="ts-stub" style="height:65px;width:300px;border:1px solid #8888;border-radius:6px"></div>'; return 7; },
  getResponse(id) { return id === 7 && !window.__tsBad ? 'ok-token' : ''; }, reset() { window.__tsReset = (window.__tsReset || 0) + 1; } };"""
stamp = str(int(time.time()))
ipn = [int(time.time()) % 200]
def next_ip():
    ipn[0] += 1
    return "192.0.2." + str(ipn[0] % 250 + 1)
with sync_playwright() as p:
    b = p.chromium.launch()
    rq = p.request.new_context(base_url=B)
    H = {"Content-Type": "application/json", "X-D8": "1"}
    tok = rq.get("/__test/idtoken?email=d.eightdesigncenter%40gmail.com&name=D.EIGHT").text()
    rq.post("/api/auth/google", data=json.dumps({"credential": tok}), headers=H)
    TS = "turnstile" in rq.get("/api/config").json()
    inbox = lambda: [m["name"] for m in rq.get("/api/messages", headers=H).json().get("items", [])]
    spam = lambda: rq.get("/api/messages/spam", headers=H).json().get("items", [])
    def ctx(vp=None, mobile=False, theme="light"):
        c = b.new_context(viewport=vp or {"width": 1366, "height": 900}, is_mobile=mobile, has_touch=mobile, reduced_motion="reduce",
                          extra_http_headers={"CF-Connecting-IP": next_ip()})
        c.route("**/*", block)
        c.add_init_script(STUB)
        c.add_init_script(f"try{{localStorage.setItem('d8-theme','{theme}')}}catch(e){{}}")
        pg = c.new_page()
        pg.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
        pg.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and "ERR_FAILED" not in m.text and "400" not in m.text else None)
        return c, pg
    def home(pg):
        pg.goto(B + "/"); pg.wait_for_timeout(500)
        pg.evaluate("document.getElementById('contact').scrollIntoView()"); pg.wait_for_timeout(200)
    def fill(pg, name, msg="Could you send your price list for implant crowns, please?"):
        pg.fill("#cName", name); pg.fill("#cEmail", "dr@smile.example"); pg.fill("#cMsg", msg)

    # ---------- a person who types fast (or autofills) still gets through: the page waits for the minimum time
    c, pg = ctx()
    home(pg)
    ok(pg.eval_on_selector("#cTurnstile", "e => e.hidden") == (not TS), "Turnstile box " + ("shown (space kept before it loads)" if TS else "hidden when Turnstile is off"))
    name = "Fast Person " + stamp
    t0 = time.time(); fill(pg, name)
    pg.locator(".contact-form").screenshot(path=f"{OUT}/form.png")
    pg.click("#cSend")
    pg.wait_for_selector("#cThanks:not([hidden])", timeout=9000)
    took = time.time() - t0
    ok(took >= 2.5, "sent straight away: the page waited for the token (%.1f s)" % took)
    ok(name in inbox(), "and the message arrived")
    if TS:
        o = pg.evaluate("window.__ts")
        ok(o and o.get("sitekey") == "1x-test-site" and o.get("action") == "contact", "Turnstile rendered with the site key")
    c.close()

    # ---------- a bot fills the hidden field: looks sent, is not stored, shows up in the blocked list
    c, pg = ctx()
    home(pg)
    bot = "Bot Hidden " + stamp
    fill(pg, bot); pg.evaluate("document.getElementById('cWebsite').value = 'http://spam.example'")
    pg.wait_for_timeout(3200); pg.click("#cSend")
    pg.wait_for_selector("#cThanks:not([hidden])", timeout=6000)
    ok(bot not in inbox() and any(x["name"] == bot and x["reason"] == "honeypot" for x in spam()), "hidden field filled: quiet thanks, not stored, kept as blocked")
    c.close()

    # ---------- link spam: refused, with our email, the form stays
    c, pg = ctx()
    home(pg)
    sp = "Link Spam " + stamp
    fill(pg, sp, "Deals http://a.example http://b.example http://c.example for you")
    pg.wait_for_timeout(3200); pg.click("#cSend")
    pg.wait_for_selector("#cError:not([hidden])", timeout=6000)
    ok("d.eightdesigncenter@gmail.com" in pg.inner_text("#cError") and not pg.eval_on_selector("#contactForm", "e => e.hidden"), "link spam: refused, the error gives our email, the form stays")
    if TS:
        pg.evaluate("window.__tsBad = true")
        pg.fill("#cMsg", "Please send the price list for zirconia crowns.")
        pg.click("#cSend"); pg.wait_for_timeout(600)
        ok(not pg.eval_on_selector("#cError", "e => e.hidden") and "security check" in pg.inner_text("#cError").lower(), "Turnstile not passed: asks to finish the check")
        pg.evaluate("window.__tsBad = false"); pg.click("#cSend")
        pg.wait_for_selector("#cThanks:not([hidden])", timeout=6000)
        ok(sp in inbox(), "Turnstile passed: the message arrives")
    c.close()

    # ---------- workspace: blocked messages and the anti-spam settings (light, dark, phone)
    for i in range(4):  # a few more bots, so every pass below has a list to show
        rq.post("/api/contact", data=json.dumps({"name": f"Bot Seed {i} {stamp}", "email": "bot@x.example", "message": "cheap offer for everyone here", "website": "x"}), headers={"Content-Type": "application/json"})
    for theme, vp, mobile in [("light", None, False), ("dark", None, False), ("light", {"width": 390, "height": 844}, True)]:
        tag = theme + ("-phone" if mobile else "")
        c, pg = ctx(vp, mobile, theme)
        pg.goto(B + "/"); pg.evaluate(SIGNIN, ["d.eightdesigncenter@gmail.com", "D.EIGHT"])
        pg.goto(B + "/admin#messages"); pg.wait_for_selector("#spamCard:not([hidden])", timeout=8000)
        ok(pg.inner_text("#spamCount").strip().startswith("("), tag + ": blocked messages counted (" + pg.inner_text("#spamCount") + ")")
        pg.click("#spamToggle"); pg.wait_for_timeout(250)
        ok(pg.eval_on_selector_all("#spamList li.spam", "e => e.length") >= 2 and "Bot điền ô ẩn" in pg.text_content("#spamList"), tag + ": list shows each message with its reason")
        pg.screenshot(path=f"{OUT}/messages-{tag}.png", full_page=True)
        if tag == "light":
            row = pg.locator("#spamList li.spam", has_text=bot)
            row.locator('[data-act="ok"]').click()
            pg.wait_for_function("name => ![...document.querySelectorAll('#spamList li.spam')].some((li) => li.textContent.includes(name))", arg=bot, timeout=5000)
            pg.wait_for_function("name => document.getElementById('msgList').textContent.includes(name)", arg=bot, timeout=5000)
            ok(bot in inbox(), "“Không phải spam”: the message moves into the inbox")
            n0 = len(spam())
            pg.locator("#spamList li.spam").first.locator('[data-act="del"]').click(); pg.wait_for_timeout(500)
            ok(len(spam()) == n0 - 1, "“Xóa” removes a blocked message")
        w = pg.evaluate("document.documentElement.scrollWidth")
        ok(w <= (vp or {"width": 1366})["width"], tag + ": messages page fits the width (%d)" % w)
        pg.goto(B + "/admin#settings"); pg.wait_for_selector("#asCard", timeout=8000)
        on = pg.eval_on_selector_all("#asCard .as-st:not(.off)", "e => e.length")
        ok(on == (6 if TS else 5) and ("Chưa bật" in pg.inner_text("#asCard")) != TS, tag + ": anti-spam card shows what is on (%d)" % on)
        ok(TS or "TURNSTILE_SITE_KEY" in pg.inner_text("#asCard"), tag + ": how to turn Turnstile on")
        ok(pg.get_attribute("#asWords", "placeholder").endswith("?"), tag + ": the input asks a question")
        pg.locator("#asCard").scroll_into_view_if_needed()
        pg.screenshot(path=f"{OUT}/settings-{tag}.png", full_page=True)
        w = pg.evaluate("document.documentElement.scrollWidth")
        ok(w <= (vp or {"width": 1366})["width"], tag + ": settings page fits the width (%d)" % w)
        if tag == "light":
            pg.fill("#asWords", "Free Phone\nGift card"); pg.fill("#asMails", "spam.example")
            pg.click("#asSave"); pg.wait_for_selector("#asSave.is-done", timeout=5000)
            st = rq.get("/api/settings", headers=H).json()["settings"]
            ok(st["spamWords"] == "free phone\ngift card" and st["blockEmails"] == "spam.example", "block lists saved from the page")
            pg.fill("#asWords", ""); pg.fill("#asMails", ""); pg.click("#asSave"); pg.wait_for_timeout(600)
            ok(rq.get("/api/settings", headers=H).json()["settings"]["spamWords"] == "", "and cleared")
        c.close()

    # ---------- a KTV has neither page
    ktv = f"ktvc{stamp}@d8.example"
    rq.post("/api/staff", data=json.dumps({"email": ktv, "role": "designer"}), headers=H)
    c, pg = ctx()
    pg.goto(B + "/"); pg.evaluate(SIGNIN, [ktv, "KTV C"])
    pg.goto(B + "/admin#messages"); pg.wait_for_timeout(1200)
    ok(pg.eval_on_selector("#spamCard", "e => e.hidden") and not pg.locator("#spamList li").count(), "KTV: no blocked messages")
    pg.goto(B + "/admin#settings"); pg.wait_for_timeout(1000)
    ok(not pg.locator("#asCard").count(), "KTV: no anti-spam settings")
    c.close()
    b.close()

real = [e for e in errors if "401" not in e and "403" not in e]
ok(not real, "no page errors" + ("" if not real else ": " + "; ".join(real[:5])))
print(f"{len(FAILS)} FAILED" if FAILS else "ALL PASSED")
sys.exit(1 if FAILS else 0)
