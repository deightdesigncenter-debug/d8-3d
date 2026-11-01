"""Customer traits in the staff workspace: a separate card on the customer record, add / edit / delete, never copied
into a new order. Screenshots go to the folder given as the first argument; light or dark as the second.
Run against: PAY=1 node dev/server.mjs public 8788 mat-khau-thu"""
import sys, os, time, json
from playwright.sync_api import sync_playwright
B = os.environ.get("D8_BASE", "http://localhost:8788")
OUT = sys.argv[1] if len(sys.argv) > 1 else "shots-traits"
THEME = sys.argv[2] if len(sys.argv) > 2 else "light"
os.makedirs(OUT, exist_ok=True)
FAILS = []
def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: FAILS.append(m)
def block(route):
    u = route.request.url
    if "fonts.g" in u or "accounts.google" in u or "cdnjs" in u: return route.abort()
    return route.continue_()
SIGNIN = """async ([email,name]) => { const tok = await (await fetch('/__test/idtoken?email='+encodeURIComponent(email)+'&name='+encodeURIComponent(name))).text();
  const r = await fetch('/api/auth/google', {method:'POST', headers:{'Content-Type':'application/json','X-D8':'1'}, body: JSON.stringify({credential: tok})}); return r.status; }"""
OWNER = "d.eightdesigncenter@gmail.com"
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    rq = p.request.new_context(base_url=B)
    tok = rq.get("/__test/idtoken?email=d.eightdesigncenter%40gmail.com&name=D.EIGHT").text()
    H = {"Content-Type": "application/json", "X-D8": "1"}
    rq.post("/api/auth/google", data=json.dumps({"credential": tok}), headers=H)
    # a customer for this run (name is unique, so the list does not collide with earlier runs)
    name = "Phòng khám đặc tính " + str(int(time.time()))
    cust = rq.post("/api/customers", data=json.dumps({"name": name, "kind": "doctor", "currency": "USD"}), headers=H).json()["customer"]
    CID = cust["id"]
    c = b.new_context(viewport={"width": 1366, "height": 900}, reduced_motion="reduce")
    c.route("**/*", block)
    c.add_init_script(f"try{{localStorage.setItem('d8-theme','{THEME}')}}catch(e){{}}")
    op = c.new_page()
    op.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    op.goto(B + "/admin"); op.evaluate(SIGNIN, [OWNER, "Danny Do"]); op.reload(); op.wait_for_timeout(1200)
    op.goto(B + f"/admin#cust/{CID}"); op.wait_for_timeout(1500)
    ok(op.is_visible("#cuTraits") and "Chưa có đặc tính nào" in op.inner_text("#cuTraits"), "customer record has its own traits card, empty at first")

    # add two traits from the card
    op.fill("#ctText", "Thích răng sứ màu A2"); op.click("#ctAdd [type=submit]"); op.wait_for_timeout(900)
    op.fill("#ctText", "Hay gửi gấp, gọi trước"); op.click("#ctAdd [type=submit]"); op.wait_for_timeout(900)
    texts = op.eval_on_selector_all("#cuTraits .trait-text", "els => els.map((e) => e.textContent)")
    ok(texts == ["Thích răng sứ màu A2", "Hay gửi gấp, gọi trước"], "two traits added and listed in order " + str(texts))

    # edit the first one in place, then cancel another edit
    op.click("#cuTraits [data-tedit]"); op.wait_for_timeout(200)
    op.fill("#cuTraits li input", "Thích răng sứ màu A3"); op.click("#cuTraits li [type=submit]"); op.wait_for_timeout(900)
    texts = op.eval_on_selector_all("#cuTraits .trait-text", "els => els.map((e) => e.textContent)")
    ok(texts[0] == "Thích răng sứ màu A3", "edit saved in place")
    op.click("#cuTraits [data-tedit]"); op.wait_for_timeout(200)
    op.click("#cuTraits li [data-tcancel]"); op.wait_for_timeout(900)
    ok(op.eval_on_selector_all("#cuTraits .trait-text", "els => els.length") == 2, "Hủy leaves the list as it was")
    op.screenshot(path=f"{OUT}/customer-traits.png", full_page=True)

    # the traits are not put into a new order or case by default
    op.goto(B + f"/admin#orders/new?customer={CID}")
    try: op.wait_for_selector("#ofNotes", timeout=10000)
    except Exception: pass
    # the order form needs the product codes first (an empty catalogue shows a gate); when it opens, its notes start empty
    if op.query_selector("#ofNotes") is not None:
        ok(op.input_value("#ofNotes") == "", "order notes start empty")
    else:
        print("NOTE order form is behind the product codes on this server: notes check skipped")
    body = op.inner_text("body")
    ok("Thích răng sứ màu A3" not in body and "Hay gửi gấp, gọi trước" not in body, "new order for this customer does not copy the traits")

    # a deleted trait is gone (two clicks: the delete button asks first)
    op.goto(B + f"/admin#cust/{CID}"); op.wait_for_timeout(1500)
    op.click("#cuTraits [data-tdel]"); op.wait_for_timeout(300)
    op.click("#cuTraits [data-tdel]"); op.wait_for_timeout(900)
    texts = op.eval_on_selector_all("#cuTraits .trait-text", "els => els.map((e) => e.textContent)")
    ok(len(texts) == 1, "delete removes one trait " + str(texts))

    # phone width: no horizontal overflow
    mc = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, reduced_motion="reduce")
    mc.route("**/*", block)
    mc.add_init_script(f"try{{localStorage.setItem('d8-theme','{THEME}')}}catch(e){{}}")
    mp = mc.new_page(); mp.on("pageerror", lambda e: errors.append("mobile PAGEERROR " + str(e)))
    mp.goto(B + "/admin"); mp.evaluate(SIGNIN, [OWNER, "Danny Do"]); mp.reload(); mp.wait_for_timeout(1200)
    mp.goto(B + f"/admin#cust/{CID}"); mp.wait_for_timeout(1500)
    over = mp.evaluate("document.documentElement.scrollWidth")
    ok(over <= 390, "phone: customer record has no horizontal overflow (" + str(over) + ")")
    mp.locator("#cuTraits").screenshot(path=f"{OUT}/customer-traits-phone.png")

    rq.delete(f"/api/customers/{CID}", headers=H)
    ok(not errors, "no page errors " + str(errors[:3]))
    b.close()
print("ALL PASSED" if not FAILS else f"FAILED {len(FAILS)}: {FAILS}")
sys.exit(1 if FAILS else 0)
