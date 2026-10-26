"""Workspace UI: owner, designer and QC views, sidebar by permission, design -> QC -> deliver, price suggestion,
payment confirmation, customer portal states. Screenshots go to the folder given as the first argument.
Run against: PAY=1 node dev/server.mjs public 8788 mat-khau-thu"""
import sys, os, time, json
from playwright.sync_api import sync_playwright
B = os.environ.get("D8_BASE", "http://localhost:8788")
OUT = sys.argv[1] if len(sys.argv) > 1 else "shots-ws"
THEME = sys.argv[2] if len(sys.argv) > 2 else "light"
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
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
API = """async ([path, body]) => { const r = await fetch(path, {method: body ? 'POST' : 'GET', headers:{'Content-Type':'application/json','X-D8':'1'}, body: body ? JSON.stringify(body) : undefined}); return [r.status, await r.json().catch(()=>({}))]; }"""
stamp = str(int(time.time()))
KTV, QC, CUST = f"ktv{stamp}@d8.example", f"qc{stamp}@d8.example", f"lab{stamp}@lab.example"
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    # this suite also covers online payment, which is off by default: switch it on before any page loads /api/config
    rq = p.request.new_context(base_url=B)
    tok = rq.get("/__test/idtoken?email=d.eightdesigncenter%40gmail.com&name=D.EIGHT").text()
    H = {"Content-Type": "application/json", "X-D8": "1"}
    rq.post("/api/auth/google", data=json.dumps({"credential": tok}), headers=H)
    rq.post("/api/settings", data=json.dumps({"onlinePay": True}), headers=H)
    def ctx(vp=None, mobile=False):
        c = b.new_context(viewport=vp or {"width": 1366, "height": 900}, is_mobile=mobile, has_touch=mobile, reduced_motion="reduce")
        c.route("**/*", block)
        c.add_init_script(f"try{{localStorage.setItem('d8-theme','{THEME}')}}catch(e){{}}")
        return c
    def watch(pg, name):
        pg.on("pageerror", lambda e: errors.append(name + " PAGEERROR " + str(e)))
        pg.on("console", lambda m: errors.append(name + " console: " + m.text) if m.type == "error" and "ERR_FAILED" not in m.text and "401" not in m.text and "403" not in m.text else None)

    # customer sends a case
    cc = ctx(); cp = cc.new_page(); watch(cp, "cust"); cp.goto(B + "/portal"); cp.evaluate(SIGNIN, [CUST, "Smile Lab"])
    st, out = cp.evaluate(API, ["/api/my/jobs", {"title": "Case 777, crowns 14-16", "service": "Crown & bridge", "teeth": "14-16", "material": "Zirconia"}])
    JID = out["job"]["id"]; order_code = out["job"]["order"]
    cp.evaluate(API, [f"/api/jobs/{JID}/messages", {"text": "Light contacts please."}])
    for t in ["Second", "Third"]:
        cp.evaluate(API, ["/api/my/jobs", {"title": t, "service": "Crown & bridge"}])

    # owner: dashboard, staff page, add designer + QC, default prices
    oc = ctx(); op = oc.new_page(); watch(op, "owner")
    op.goto(B + "/admin"); op.evaluate(SIGNIN, ["d.eightdesigncenter@gmail.com", "Danny Do"]); op.reload(); op.wait_for_timeout(1200)
    nav = op.eval_on_selector_all("#wsNav nav a > span:not(.count)", "els=>els.map(e=>e.textContent.trim())")
    ok(nav == ["Tổng quan", "Đơn hàng", "Ca cổng khách", "Khách hàng", "Mã hàng & bảng giá", "Kỹ thuật viên", "Báo cáo", "Nhập Excel", "Nhân sự & phân quyền", "Cài đặt", "Link xem 3D", "HTML sang STL", "Tin nhắn web"], "owner sidebar: " + str(nav))
    ok(op.is_visible("#dash .card"), "dashboard shows cards")
    op.screenshot(path=f"{OUT}/owner-home.png", full_page=True)
    op.goto(B + "/admin#staff"); op.wait_for_timeout(900)
    op.fill("#stEmail", KTV); op.select_option("#stRole", "designer"); op.click("#stAdd [type=submit]"); op.wait_for_timeout(900)
    op.fill("#stEmail", QC); op.select_option("#stRole", "qc"); op.click("#stAdd [type=submit]"); op.wait_for_timeout(900)
    rows = op.eval_on_selector_all(".staff-row small", "els=>els.map(e=>e.textContent)")
    ok(KTV in rows and QC in rows, "staff added through the page")
    op.screenshot(path=f"{OUT}/owner-staff.png", full_page=True)
    # a new case from the portal needs the owner: red dot + label, menu badge, bell
    op.goto(B + "/admin#jobs?who=need"); op.wait_for_timeout(1500)
    row = op.query_selector(f'#jobList a.pt-row.need[href="#jobs/{JID}"]')
    ok(row is not None and row.query_selector(".attn-dot") is not None and "giao ktv" in row.inner_text().lower(), "new portal case marked red: needs a KTV")
    ok(op.is_visible(".sh-bell-n"), "owner bell shows a count")
    op.click(".sh-bell-btn"); op.wait_for_timeout(200)
    ok("chờ giao KTV" in op.inner_text(".sh-bell-pop"), "owner bell: new portal case waiting for a KTV")
    op.screenshot(path=f"{OUT}/owner-bell.png")
    op.keyboard.press("Escape")
    # assign on the case page; the case carries its order (code, money, team chat)
    op.goto(B + "/admin#jobs/" + JID); op.wait_for_timeout(1800)
    ok(op.query_selector("#jobOrder") is not None and op.query_selector("#jobChat .ochat") is not None, "case page shows its order and the team chat")
    op.select_option("#asD", KTV); op.select_option("#asQ", QC); op.click("#asForm [type=submit]"); op.wait_for_timeout(900)
    ok("đang thiết kế" in op.inner_text("#wfCard").lower(), "case assigned, stage design")
    op.screenshot(path=f"{OUT}/owner-case.png", full_page=True)

    # designer: limited sidebar, upload design html, send to QC
    dc = ctx(); dp = dc.new_page(); watch(dp, "designer")
    dp.goto(B + "/admin"); dp.evaluate(SIGNIN, [KTV, "Minh KTV"]); dp.reload(); dp.wait_for_timeout(1200)
    nav = dp.eval_on_selector_all("#wsNav nav a > span:not(.count)", "els=>els.map(e=>e.textContent.trim())")
    ok(nav == ["Tổng quan", "Đơn hàng", "Ca cổng khách", "Công của tôi", "Link xem 3D", "HTML sang STL"], "designer sidebar: " + str(nav))
    ok(order_code in dp.inner_text("#dash"), "designer dashboard lists the assigned case by its order code")
    dp.click(".sh-bell-btn"); dp.wait_for_timeout(200)
    bell = dp.inner_text(".sh-bell-pop")
    ok("ca cổng khách cần thiết kế" in bell, "designer bell: the case to design (" + bell.replace("\n", " | ")[:120] + ")")
    dp.keyboard.press("Escape")
    dp.screenshot(path=f"{OUT}/designer-home.png", full_page=True)
    dp.goto(B + "/admin#staff"); dp.wait_for_timeout(500)
    ok(dp.is_visible("#p-denied"), "designer sees no-access page for staff")
    dp.goto(B + "/admin#jobs/" + JID); dp.wait_for_timeout(1400)
    txt = dp.inner_text("#p-case")
    ok("Báo giá" not in txt and "@lab.example" not in txt and not dp.query_selector("#statForm") and not dp.query_selector("#composeForm"), "designer case view hides billing, customer email, status and chat box")
    ok("Light contacts please." in txt, "designer reads customer chat")
    tmp = os.path.join(OUT, "crowns-design.html")
    open(tmp, "w").write("<!doctype html><html><head><title>scene</title></head><body><p>exocad scene</p></body></html>")
    dp.set_input_files("#dsFiles", tmp); dp.wait_for_timeout(300); dp.click("#dsBtn"); dp.wait_for_timeout(2000)
    ok("crowns-design.html" in dp.inner_text("#p-case"), "design file uploaded")
    # an STL design: rotate it right on the case page
    import struct
    stl = os.path.join(OUT, "crown 15 final.stl")
    with open(stl, "wb") as fh:
        tris = [((0,0,0),(8,0,0),(0,7,0)), ((0,0,0),(0,7,0),(0,0,6)), ((0,0,0),(0,0,6),(8,0,0)), ((8,0,0),(0,0,6),(0,7,0))]
        fh.write(b"tooth".ljust(80, b" ")); fh.write(struct.pack("<I", len(tris)))
        for a, b_, c in tris: fh.write(struct.pack("<12fH", 0, 0, 0, *a, *b_, *c, 0))
    dp.set_input_files("#dsFiles", stl); dp.wait_for_timeout(300); dp.click("#dsBtn"); dp.wait_for_timeout(2000)
    try: dp.wait_for_selector("#case3d .v3d[data-tris]", timeout=15000)
    except Exception: pass
    ok(dp.get_attribute("#case3d .v3d", "data-tris") == "4", "the STL design shows in 3D on the case page")
    with dc.expect_page() as newp:
        dp.click('#p-case a[href*="?view=1"]')
    v = newp.value; v.wait_for_load_state(); ok("exocad scene" in v.content() and "d8-storage-shim" in v.content(), "design 3D opens with storage shim"); v.close()
    dp.fill("#wfNote", "Xong, nhờ QC"); dp.click("#wfSubmit"); dp.wait_for_timeout(1000)
    ok("chờ qc" in dp.inner_text("#wfCard").lower(), "sent to QC")
    dp.screenshot(path=f"{OUT}/designer-case.png", full_page=True)

    # QC: fail then pass
    qc = ctx(); qp = qc.new_page(); watch(qp, "qc")
    qp.goto(B + "/admin"); qp.evaluate(SIGNIN, [QC, "Lan QC"]); qp.reload(); qp.wait_for_timeout(1200)
    ok(order_code in qp.inner_text("#dash"), "QC dashboard lists the case")
    qp.goto(B + "/admin#jobs"); qp.wait_for_timeout(1300)
    row = qp.query_selector(f'#jobList a.pt-row.need[href="#jobs/{JID}"]')
    ok(row is not None and "chờ qc" in row.inner_text().lower(), "the case waits for QC: red dot for the QC")
    qp.click(".sh-bell-btn"); qp.wait_for_timeout(200)
    ok("ca cổng khách chờ QC" in qp.inner_text(".sh-bell-pop"), "QC bell: the case to check")
    qp.keyboard.press("Escape")
    qp.goto(B + "/admin#jobs/" + JID); qp.wait_for_timeout(1300)
    qp.click("#wfFail"); qp.wait_for_timeout(700)
    ok(qp.is_visible("#wfFail") or "Ghi rõ" in qp.inner_text("body"), "fail without note is refused")
    qp.fill("#wfNote", "Tiếp xúc 15 quá chặt"); qp.click("#wfFail"); qp.wait_for_timeout(1000)
    ok("qc yêu cầu sửa" in qp.inner_text("#wfCard").lower(), "QC returned the case")
    dp.reload(); dp.wait_for_timeout(1300)
    ok("Tiếp xúc 15 quá chặt" in dp.inner_text("#wfCard"), "designer sees QC feedback")
    dp.click("#wfSubmit"); dp.wait_for_timeout(900)
    qp.reload(); qp.wait_for_timeout(1300); qp.fill("#wfNote", "OK"); qp.click("#wfPass"); qp.wait_for_timeout(1000)
    ok("đã qua qc" in qp.inner_text("#wfCard").lower(), "QC passed")
    qp.screenshot(path=f"{OUT}/qc-case.png", full_page=True)

    # owner delivers the design file, sets payment due
    op.reload(); op.wait_for_timeout(1500)
    op.check("#p-case [data-pick]"); op.click("#prBtn"); op.wait_for_timeout(1200)
    ok("đã giao" in op.inner_text(".pt-band").lower(), "owner delivered")
    ok("đã dùng 0 / 2" in op.inner_text("#revBox").lower(), "case shows free revisions (0 of the usual 2)")
    op.fill("#revFree", "3"); op.click("#revForm [type=submit]"); op.wait_for_timeout(900)
    ok("đã dùng 0 / 3" in op.inner_text("#revBox").lower() and "riêng ca này" in op.inner_text("#revBox").lower(), "owner gives this case 3 free revisions")
    op.fill("#billPrice", "36"); op.select_option("#billPay", "due"); op.click("#billForm [type=submit]"); op.wait_for_timeout(1000)

    # customer pays with PayPal (mock) -> confirming
    cp.goto(B + "/portal#/case/" + JID); cp.reload(); cp.wait_for_timeout(1200)
    ok(cp.query_selector('[data-pay="paypal"]') is not None, "customer sees pay buttons")
    ok("crowns-design.html" in cp.inner_text("#view"), "customer sees the delivered file")
    cp.click('[data-pay="paypal"]'); cp.wait_for_url("**/portal**#/case/**", timeout=10000); cp.wait_for_timeout(1500)
    ok("payment being confirmed" in cp.inner_text("#view").lower(), "customer: payment being confirmed")
    cp.screenshot(path=f"{OUT}/customer-confirming.png", full_page=True)
    # owner confirms
    op.reload(); op.wait_for_timeout(1500)
    ok(op.query_selector("#payOk") is not None, "owner sees confirm button")
    op.screenshot(path=f"{OUT}/owner-confirm.png", full_page=True)
    op.click("#payOk"); op.wait_for_timeout(1000)
    ok("đã nhận" in op.inner_text("#p-case").lower(), "owner confirmed")
    cp.reload(); cp.wait_for_timeout(1200)
    ok(cp.query_selector(".pay-card") is None and cp.query_selector(".dl .pay-paid") is not None, "customer sees paid")
    t = cp.inner_text("#view")
    ok("Minh KTV" not in t and KTV not in t and "Tiếp xúc 15" not in t, "customer never sees staff names or QC notes")

    # customer detail page + mobile workspace
    op.goto(B + "/admin#customers/" + CUST); op.wait_for_timeout(1500)
    ok(JID in op.inner_text("#p-customer") and op.query_selector("#custLink a") is not None, "portal account page with cases and a link to the customer record")
    op.screenshot(path=f"{OUT}/owner-customer.png", full_page=True)
    mc = ctx({"width": 390, "height": 844}, True); mp = mc.new_page(); watch(mp, "mobile")
    mp.goto(B + "/admin"); mp.evaluate(SIGNIN, ["d.eightdesigncenter@gmail.com", "Danny Do"]); mp.reload(); mp.wait_for_timeout(1300)
    mp.screenshot(path=f"{OUT}/mobile-home.png", full_page=True)
    over = mp.evaluate("document.documentElement.scrollWidth")
    ok(over <= 390, "mobile workspace has no horizontal overflow (" + str(over) + ")")
    mp.goto(B + "/admin#jobs/" + JID); mp.wait_for_timeout(1500)
    over = mp.evaluate("document.documentElement.scrollWidth")
    ok(over <= 390, "mobile case page has no horizontal overflow (" + str(over) + ")")
    mp.screenshot(path=f"{OUT}/mobile-case.png", full_page=True)
    mp.goto(B + "/admin#staff"); mp.wait_for_timeout(1200)
    over = mp.evaluate("document.documentElement.scrollWidth")
    ok(over <= 390, "mobile staff page has no horizontal overflow (" + str(over) + ")")
    rq.post("/api/settings", data=json.dumps({"onlinePay": False}), headers=H)
    b.close()
for e in errors: print("ERR", e)
ok(not errors, "no page errors")
print(("%d FAILED" % len(FAILS)) if FAILS else "ALL PASSED")
sys.exit(1 if FAILS else 0)
