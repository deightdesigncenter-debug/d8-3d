"""About page chat assistant, in the browser (desktop and phone): the button opens the chat, greets, answers the quick
questions and a typed one, shows the details form for a design request, sends it, closes with Escape and gives focus back,
never shows a price, fits the screen, follows the language switch, and shows no page errors.
Usage: assist_ui.py <screenshot folder> [light|dark]"""
import sys, os, re, random
from playwright.sync_api import sync_playwright
B = os.environ.get("D8_BASE", "http://localhost:8788")
OUT = sys.argv[1] if len(sys.argv) > 1 else "shots-assist"
SCHEME = sys.argv[2] if len(sys.argv) > 2 else "light"
os.makedirs(OUT, exist_ok=True)
FAILS, errors = [], []
def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: FAILS.append(m)
def block(route):
    u = route.request.url
    if "fonts.g" in u or "accounts.google" in u or "cdnjs" in u or "challenges.cloudflare" in u: return route.abort()
    return route.continue_()
NOT_A_PRICE = re.compile(r"\$|\bVND\b|\bUSD\b|\d\s?k\b|\d\s?đ\b", re.I)

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, vp, mobile in [("desk", {"width": 1366, "height": 900}, False), ("mob", {"width": 390, "height": 844}, True)]:
        ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, color_scheme=SCHEME, reduced_motion="reduce")
        # each run has its own address, so the per-address limits of the contact checks never meet other tests
        ctx.set_extra_http_headers({"CF-Connecting-IP": "198.19.%d.%d" % (random.randint(1, 250), random.randint(1, 250))})
        ctx.route("**/*", block)
        ctx.add_init_script("try{localStorage.setItem('d8-lang','en');localStorage.setItem('d8-theme','%s')}catch(e){}" % SCHEME)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e, n=name: errors.append(n + " PAGEERROR " + str(e)))
        pg.on("console", lambda m, n=name: errors.append(n + " console: " + m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
        pg.goto(B + "/about"); pg.wait_for_timeout(800)

        ok(pg.is_visible("#asLaunch") and "Ask D.EIGHT" in pg.inner_text("#asLaunch"), name + ": the Ask D.EIGHT button is shown")
        ok(not pg.is_visible("#asPanel"), name + ": the chat starts closed")
        pg.click("#asLaunch"); pg.wait_for_timeout(350)
        ok(pg.is_visible("#asPanel") and pg.get_attribute("#asLaunch", "aria-expanded") == "true", name + ": the button opens the chat")
        ok("Hi, I'm the D.EIGHT assistant" in pg.inner_text("#asLog"), name + ": the chat greets the visitor")
        bx = pg.query_selector("#asPanel").bounding_box()
        ok(bx["x"] >= 0 and bx["x"] + bx["width"] <= vp["width"] + 0.5 and bx["y"] >= 0 and bx["y"] + bx["height"] <= vp["height"] + 0.5,
           name + ": the chat fits the screen")
        pg.screenshot(path=f"{OUT}/{name}-{SCHEME}-open.png")

        # a quick question from the chips
        before = pg.locator("#asLog .as-b.bot:not(.as-typing)").count()
        pg.click("#asChips .as-chip >> nth=1")  # "How do I send a case?"
        pg.wait_for_function(f"document.querySelectorAll('#asLog .as-b.bot:not(.as-typing)').length > {before}", timeout=15000)
        reply = pg.locator("#asLog .as-b.bot:not(.as-typing)").last.inner_text()
        ok(len(reply.strip()) > 0 and not NOT_A_PRICE.search(reply), name + ": a quick question gets an answer (" + reply[:50].replace("\n", " ") + ")")
        ok(not pg.is_visible("#asChips"), name + ": the quick questions go once the chat has started")

        # a typed question about a price: never a price in the answer
        before = pg.locator("#asLog .as-b.bot:not(.as-typing)").count()
        pg.fill("#asInput", "What is the price of a crown?")
        pg.press("#asInput", "Enter")
        pg.wait_for_function(f"document.querySelectorAll('#asLog .as-b.bot:not(.as-typing)').length > {before}", timeout=15000)
        reply = pg.locator("#asLog .as-b.bot:not(.as-typing)").last.inner_text()
        ok(not NOT_A_PRICE.search(reply), name + ": a price question shows no price")
        ok(pg.eval_on_selector_all("#asLog .as-b.me", "e => e.length") == 2, name + ": the visitor's own messages are shown on the right")

        # a design request asks for the details
        before = pg.locator("#asLog .as-b.bot:not(.as-typing)").count()
        pg.fill("#asInput", "I want you to design a crown for me")
        pg.press("#asInput", "Enter")
        pg.wait_for_function(f"document.querySelectorAll('#asLog .as-b.bot:not(.as-typing)').length > {before}", timeout=15000)
        pg.wait_for_selector("#asLog form.as-lead", timeout=10000)
        ok(pg.is_visible("#asLog form.as-lead input[name=name]"), name + ": a design request shows the details form")
        pg.screenshot(path=f"{OUT}/{name}-{SCHEME}-lead.png")
        pg.fill("#asLog form.as-lead input[name=name]", "Dr Chat Test")
        pg.fill("#asLog form.as-lead input[name=email]", "chat-test@smile.example")
        pg.fill("#asLog form.as-lead input[name=phone]", "+84 90 000 0000")
        pg.select_option("#asLog form.as-lead select[name=service]", "Crown & bridge")
        pg.fill("#asLog form.as-lead textarea[name=message]", "Please quote one crown for tooth 14. I have an STL scan.")
        pg.wait_for_timeout(3200)  # the time token must be at least 3 s old
        pg.click("#asLog form.as-lead button[type=submit]")
        pg.wait_for_function("document.querySelector('#asLog .as-done') || (document.querySelector('#asLog .as-err') && !document.querySelector('#asLog .as-err').hidden)", timeout=15000)
        if pg.query_selector("#asLog .as-done"):
            ok("Thank you" in pg.inner_text("#asLog .as-done"), name + ": the details are sent and the visitor is thanked")
        else:
            ok(False, name + ": the details are sent (refused: " + pg.inner_text("#asLog .as-err") + ")")

        # Escape closes and gives focus back to the button
        pg.focus("#asInput")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
        ok(not pg.is_visible("#asPanel") and pg.get_attribute("#asLaunch", "aria-expanded") == "false", name + ": Escape closes the chat")
        ok(pg.evaluate("document.activeElement && document.activeElement.id") == "asLaunch", name + ": focus goes back to the button")

        # the language switch changes the labels
        pg.evaluate("document.querySelector('[data-lang=\"vi\"]').click()"); pg.wait_for_timeout(300)
        ok("Hỏi D.EIGHT" in pg.inner_text("#asLaunch"), name + ": the button follows the language switch")
        pg.click("#asLaunch"); pg.wait_for_timeout(350)
        ok("Trợ lý D.EIGHT" in pg.inner_text("#asPanel"), name + ": the chat follows the language switch")
        pg.screenshot(path=f"{OUT}/{name}-{SCHEME}-vi.png")

        w = pg.evaluate("document.documentElement.scrollWidth")
        ok(w <= vp["width"], name + ": no horizontal overflow (" + str(w) + ")")
        ctx.close()
    b.close()

for e in errors: print("ERR", e)
ok(not errors, "no page errors")
print(("%d FAILED" % len(FAILS)) if FAILS else "ALL PASSED")
sys.exit(1 if FAILS else 0)
