"""Files sent to the customer, in the browser (owner's rule 2026-11-25). Staff: the KTV sends a chat file with two clicks,
uploads and sends from the "File gửi khách" card, takes one back; the QC sees what was sent but cannot send. Customer: the
order is in the portal list with its files, the order page downloads them, views them in 3D, and shows no designer, chat
or price; "pay first" on the customer record locks the downloads until the order is paid; a portal case shows the files
sent from its order. The admin is the upload password (no real account). Screenshots (desktop and phone) in the folder
given; light or dark as the second argument.
Run against: PAY=1 node dev/server.mjs public 8788 mat-khau-thu"""
import sys, os, time, json, math, struct
from playwright.sync_api import sync_playwright
B = os.environ.get("D8_BASE", "http://localhost:8788")
PW = os.environ.get("D8_PASSWORD", "mat-khau-thu")
OUT = sys.argv[1] if len(sys.argv) > 1 else "shots-sent"
THEME = sys.argv[2] if len(sys.argv) > 2 else "light"
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
FITS = """() => document.documentElement.scrollWidth <= window.innerWidth + 1"""
stamp = str(int(time.time()))[-6:] + THEME[0]
KTV, QC = f"sktv{stamp}@team.example", f"sqc{stamp}@team.example"
EMA, EMB = f"senta{stamp}@lab.example", f"sentb{stamp}@lab.example"

def stl_file(path, scale=1.0, lift=0.0):
    """a small rounded crown, binary STL"""
    v = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
    f = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
    for _ in range(3):
        cache, nf = {}, []
        def mid(a, b):
            k = (min(a, b), max(a, b))
            if k not in cache:
                q = [(v[a][i] + v[b][i]) / 2 for i in range(3)]; l = math.sqrt(sum(x * x for x in q)); v.append(tuple(x / l for x in q)); cache[k] = len(v) - 1
            return cache[k]
        for a, b_, c in f:
            ab, bc, ca = mid(a, b_), mid(b_, c), mid(c, a); nf += [(a, ab, ca), (b_, bc, ab), (c, ca, bc), (ab, bc, ca)]
        f = nf
    pts = [(x * 5 * scale, y * 4.5 * scale, z * 3.6 * scale + lift) for x, y, z in v]
    with open(path, "wb") as fh:
        fh.write(b"solid sent test".ljust(80, b" ")); fh.write(struct.pack("<I", len(f)))
        for a, b_, c in f: fh.write(struct.pack("<12fH", 0, 0, 0, *pts[a], *pts[b_], *pts[c], 0))
    return open(path, "rb").read()

with sync_playwright() as p:
    b = p.chromium.launch()
    rq = p.request.new_context(base_url=B)
    KH = {"Content-Type": "application/json", "X-D8": "1", "X-Upload-Key": PW}
    def key(path, body=None, method=None):
        r = rq.fetch(path, method=method or ("POST" if body is not None else "GET"), headers=KH, data=json.dumps(body) if body is not None else None)
        try: return r.status, r.json()
        except Exception: return r.status, {}
    def ctx(vp=None, mobile=False, admin=False):
        c = b.new_context(viewport=vp or {"width": 1366, "height": 900}, is_mobile=mobile, has_touch=mobile, reduced_motion="reduce", accept_downloads=True)
        c.route("**/*", block)
        c.add_init_script(f"try{{localStorage.setItem('d8-theme','{THEME}')}}catch(e){{}}")
        if admin: c.add_init_script(f"try{{sessionStorage.setItem('d8-upload-key',{json.dumps(PW)})}}catch(e){{}}")
        return c
    def page(c, email=None, name=None, start="/admin"):
        pg = c.new_page()
        pg.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
        pg.on("console", lambda m: errors.append("CONSOLE " + m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
        pg.goto(B + start)
        if email: pg.evaluate(SIGNIN, [email, name]); pg.reload()
        pg.wait_for_timeout(1200)
        return pg
    # textContent: headings and chips are drawn in capitals by CSS, the words themselves are what is checked
    text = lambda pg, sel: (pg.text_content(sel) or "") if pg.query_selector(sel) else ""

    # ---------- the data: a lab with two portal accounts, an order of 40 USD for the KTV, two files in the team chat
    for email, role in [(KTV, "designer"), (QC, "qc")]: key("/api/staff", {"email": email, "role": role})
    code = "SU" + stamp.upper()
    key("/api/products", {"items": [{"code": code, "name": "Sent UI crown", "grp": "Crown & bridge", "unit": "unit", "price_usd": 40, "price_vnd": 900000}]})
    st, cr = key("/api/customers", {"name": "Lab gửi file " + stamp, "kind": "lab", "currency": "USD"})
    CID = cr["customer"]["id"]
    for em in (EMA, EMB): key(f"/api/customers/{CID}/logins", {"email": em})
    day = time.strftime("%Y-%m-%d")
    st, od = key("/api/orders", {"customer_id": CID, "received": day, "ref": "LAB-7781", "doctor": "Dr. Test", "items": [{"product": code, "qty": 1}]})
    OID, OCODE = od["order"]["id"], od["order"]["code"]
    key(f"/api/orders/{OID}", {"designer": KTV, "qc": QC})
    STL1 = stl_file(os.path.join(OUT, "crown-21.stl"))
    STL2 = stl_file(os.path.join(OUT, "crown-22 final.stl"), 0.9, 2)
    PDF = b"%PDF-1.4\n% sent test\n" + b"0" * 2000
    open(os.path.join(OUT, "notes.pdf"), "wb").write(PDF)
    for fid, data in (("SentUiStl1", STL1), ("SentUiPdf1", PDF)):
        rq.put(f"/api/orders/{OID}/files/{fid}/0", headers={"X-D8": "1", "X-Upload-Key": PW, "Content-Type": "application/octet-stream"}, data=data)
    key(f"/api/orders/{OID}/files", {"files": [{"fid": "SentUiStl1", "name": "crown-21.stl", "size": len(STL1), "stored": len(STL1), "parts": 1, "gz": 0},
                                              {"fid": "SentUiPdf1", "name": "notes.pdf", "size": len(PDF), "stored": len(PDF), "parts": 1, "gz": 0}], "text": "v1 cho QC"})

    # ---------- KTV: the card, send from the chat (two clicks), upload and send from the card, take one back
    kc = ctx(); kp = page(kc, KTV, "KTV Gửi File")
    kp.goto(B + f"/admin#orders/{OID}"); kp.wait_for_selector("#oSent", timeout=15000); kp.wait_for_timeout(1500)
    ok("File gửi khách" in text(kp, "#oSent") and "0 file" in text(kp, "#oSent") and "2 tài khoản" in text(kp, "#oSent"), "KTV: the card says nothing sent yet, 2 portal accounts")
    ok("thanh toán" not in text(kp, "#oSent").lower(), "KTV: nothing about payment in the card")
    ok(kp.query_selector("#osFile") is not None, "KTV: may upload and send from the card")
    send = kp.query_selector('#oChat button.ot-send[data-send="SentUiStl1"]')
    ok(send is not None and kp.query_selector('#oChat button.of-send[data-send="SentUiPdf1"]') is not None, "KTV: each chat file has a send button")
    send.click(); kp.wait_for_timeout(400)
    ok("armed" in (kp.get_attribute('#oChat button.ot-send[data-send="SentUiStl1"]', "class") or "") and "0 file" in text(kp, "#oSent"), "first click only arms the button")
    kp.click('#oChat button.ot-send[data-send="SentUiStl1"]'); kp.wait_for_timeout(2000)
    ok("1 file" in text(kp, "#oSent") and "crown-21.stl" in text(kp, "#oSent .o-sent-list"), "second click sends: the card lists it")
    ok(kp.query_selector('#oChat .ochat-thumb.sent .ot-badge') is not None and "is-sent" in (kp.get_attribute('#oChat button.ot-send[data-send="SentUiStl1"]', "class") or ""), "chat: the file is marked sent")
    ok("Đã gửi khách: crown-21.stl" in text(kp, "#oChat .ochat-list"), "chat: a line says it was sent")
    kp.set_input_files("#osFile", os.path.join(OUT, "crown-22 final.stl")); kp.wait_for_timeout(3500)
    ok("2 file" in text(kp, "#oSent") and "crown-22 final.stl" in text(kp, "#oSent .o-sent-list"), "upload from the card: sent at once")
    ok("crown-22 final.stl" in text(kp, "#oChat .ochat-list"), "the upload shows in the team chat too")
    kp.click('#oChat button.of-send[data-send="SentUiPdf1"]'); kp.wait_for_timeout(250); kp.click('#oChat button.of-send[data-send="SentUiPdf1"]'); kp.wait_for_timeout(2000)
    ok("3 file" in text(kp, "#oSent"), "a non-3D file is sent from its row")
    rb = kp.query_selector('#oSent [data-recall="SentUiPdf1"]')
    rb.click(); kp.wait_for_timeout(250); kp.click('#oSent [data-recall="SentUiPdf1"]'); kp.wait_for_timeout(2000)
    ok("2 file" in text(kp, "#oSent") and "notes.pdf" not in text(kp, "#oSent .o-sent-list"), "Thu hồi (two clicks) takes it back")
    kp.wait_for_timeout(500)
    ok("is-sent" not in (kp.get_attribute('#oChat button.of-send[data-send="SentUiPdf1"]', "class") or "is-sent"), "chat: the taken-back file is not marked any more")
    kp.evaluate("() => window.scrollTo(0, 0)"); kp.wait_for_timeout(300)
    kp.screenshot(path=f"{OUT}/staff-order-ktv.png", full_page=True)
    kc.close()

    # ---------- QC: sees what was sent, cannot send
    qc_ = ctx(); qp = page(qc_, QC, "QC Gửi File")
    qp.goto(B + f"/admin#orders/{OID}"); qp.wait_for_selector("#oSent", timeout=15000); qp.wait_for_timeout(1500)
    ok("2 file" in text(qp, "#oSent") and qp.query_selector("#osFile") is None and qp.query_selector("#oSent [data-recall]") is None, "QC: sees the sent files, no upload or take back")
    ok(qp.query_selector("#oChat button[data-send]") is None and qp.query_selector("#oChat span.ot-send.is-sent") is not None, "QC: chat shows what was sent, no send buttons")
    qc_.close()

    # ---------- customer account A: the order in the list, the files, no designer, chat or price
    ac = ctx(); ap = page(ac, EMA, "Lab Account A", "/portal")
    ap.wait_for_selector(".pt-list", timeout=15000); ap.wait_for_timeout(800)
    row = ap.query_selector(f'.pt-list a[href="#/order/{OID}"]')
    ok(row is not None and OCODE in row.inner_text() and "LAB-7781" in row.inner_text(), "portal: the order is in the list with its code and reference")
    ok(row is not None and row.query_selector(".pt-fchip") is not None and row.query_selector(".attn-dot") is not None, "portal: files ready, marked new")
    ok(ap.evaluate(FITS), "portal list: no sideways scroll")
    ap.screenshot(path=f"{OUT}/portal-list.png", full_page=True)
    row.click(); ap.wait_for_selector("#oFiles", timeout=15000); ap.wait_for_timeout(1200)
    body = ap.inner_text("#view")
    ok("crown-21.stl" in body and "crown-22 final.stl" in body and "notes.pdf" not in body, "order page: the two sent files, not the taken-back one")
    ok(KTV not in body and QC not in body and "KTV Gửi File" not in body and "v1 cho QC" not in body and "40" not in body.replace(OCODE, ""), "order page: no designer, QC, chat or price")
    href = ap.get_attribute('#oFiles a.iconbtn[download="crown-21.stl"]', "href") or ""
    ok(href == f"/api/my/orders/{OID}/files/SentUiStl1", "download link points at the customer's own route")
    with ap.expect_download() as dl: ap.click('#oFiles a.iconbtn[download="crown-21.stl"]')
    ok(open(dl.value.path(), "rb").read() == STL1, "the customer downloads the file byte for byte")
    ok(ap.query_selector("#oZip") is not None, "download all (.zip) is offered")
    ap.click("#o3dBtn"); ap.wait_for_timeout(2500)
    ok(ap.query_selector("#o3dHost canvas") is not None and ap.is_visible("#o3dHost"), "View in 3D opens the viewer")
    ok(ap.evaluate(FITS), "order page: no sideways scroll")
    ap.screenshot(path=f"{OUT}/portal-order.png", full_page=True)
    ap.goto(B + "/portal#/"); ap.wait_for_selector(".pt-list", timeout=15000); ap.wait_for_timeout(800)
    row = ap.query_selector(f'.pt-list a[href="#/order/{OID}"]')
    ok(row is not None and row.query_selector(".attn-dot") is None, "after opening it the order is no longer marked new")

    # account B of the same lab sees the same order
    bc = ctx({"width": 390, "height": 844}, True); bp = page(bc, EMB, "Lab Account B", "/portal")
    bp.wait_for_selector(".pt-list", timeout=15000); bp.wait_for_timeout(800)
    ok(bp.query_selector(f'.pt-list a[href="#/order/{OID}"]') is not None, "the other account of the lab sees the order")
    ok(bp.evaluate(FITS), "phone: the list has no sideways scroll")
    bp.screenshot(path=f"{OUT}/portal-list-phone.png", full_page=True)
    bp.goto(B + f"/portal#/order/{OID}"); bp.wait_for_selector("#oFiles", timeout=15000); bp.wait_for_timeout(1000)
    ok(bp.evaluate(FITS), "phone: the order page has no sideways scroll")
    bp.screenshot(path=f"{OUT}/portal-order-phone.png", full_page=True)

    # ---------- admin (password): pay first on the customer record locks the downloads until the order is paid
    xc = ctx(admin=True); xp = page(xc)
    xp.goto(B + f"/admin#cust/{CID}"); xp.wait_for_selector("#cuPayFirst", state="attached", timeout=15000); xp.wait_for_timeout(800)
    ok(not xp.is_checked("#cuPayFirst") and "tải file ngay" in text(xp, "#cuPortal"), "customer record: pay first is off")
    xp.click("#cuPortal .cu-payfirst span"); xp.wait_for_timeout(1500)
    ok(xp.is_checked("#cuPayFirst") and "chỉ tải được khi đơn đã trả đủ" in text(xp, "#cuPortal"), "pay first switched on")
    xp.screenshot(path=f"{OUT}/staff-customer-payfirst.png", full_page=True)
    xp.goto(B + f"/admin#orders/{OID}"); xp.wait_for_selector("#oSent", timeout=15000); xp.wait_for_timeout(1200)
    ok("phải thanh toán trước khi tải" in text(xp, "#oSent"), "order page: the card says the customer pays first")
    ap.goto(B + f"/portal#/order/{OID}"); ap.wait_for_selector("#oFiles", timeout=15000); ap.wait_for_timeout(1000)
    ok(ap.query_selector(".pt-alert.info") is not None and "US$40.00" in text(ap, ".pt-alert.info"), "locked: the customer sees the amount due")
    ok(ap.query_selector("#oFiles a.iconbtn[download]") is None and ap.query_selector("#oFiles .iconbtn.is-locked") is not None, "locked: no download links")
    ok(ap.query_selector("#oZip") is None and ap.query_selector("#o3dBtn") is None, "locked: no zip, no 3D")
    ap.screenshot(path=f"{OUT}/portal-order-locked.png", full_page=True)
    # paid in full: unlocked
    key("/api/payments", {"order_id": OID, "day": day, "amount": 40, "method": "paypal"})
    ap.reload(); ap.wait_for_selector("#oFiles", timeout=15000); ap.wait_for_timeout(1000)
    ok(ap.query_selector("#oFiles a.iconbtn[download]") is not None, "paid: the downloads are back")
    key(f"/api/customers/{CID}/payfirst", {"on": False})

    # ---------- "show prices" on the customer record: the customer sees the charges and their balance; the KTV still sees none
    xp.goto(B + f"/admin#cust/{CID}"); xp.wait_for_selector("#cuShowPrices", state="attached", timeout=15000); xp.wait_for_timeout(800)
    ok(not xp.is_checked("#cuShowPrices"), "customer record: prices are hidden from the customer by default")
    xp.click("#cuPortal label:has(#cuShowPrices) span"); xp.wait_for_timeout(1500)
    ok(xp.is_checked("#cuShowPrices") and "đơn giá riêng" in text(xp, "#cuPortal"), "show prices switched on")
    xp.screenshot(path=f"{OUT}/staff-customer-prices.png", full_page=True)
    ap.goto(B + "/portal#/"); ap.wait_for_selector(".pt-list", timeout=15000); ap.wait_for_timeout(800)
    bal = text(ap, ".pt-balance")
    ok("US$40.00" in bal and "Balance due" in bal, "portal list: the account balance")
    row = ap.query_selector(f'.pt-list a[href="#/order/{OID}"]')
    ok(row is not None and "Paid in full" in (row.text_content() or ""), "portal list: the order says paid in full")
    ap.screenshot(path=f"{OUT}/portal-list-balance.png", full_page=True)
    ap.goto(B + f"/portal#/order/{OID}"); ap.wait_for_selector(".pt-charges", timeout=15000); ap.wait_for_timeout(800)
    chg = text(ap, ".pt-charges")
    ok("Sent UI crown" in chg and chg.count("US$40.00") >= 3 and "US$0.00" in chg, "order page: the service, unit price, total, paid and nothing left")
    ok(ap.evaluate(FITS), "order page with charges: no sideways scroll")
    ap.screenshot(path=f"{OUT}/portal-order-charges.png", full_page=True)
    bp.goto(B + f"/portal#/order/{OID}"); bp.reload(); bp.wait_for_selector(".pt-charges", timeout=15000); bp.wait_for_timeout(800)
    ok(bp.evaluate(FITS), "phone: the charges fit the screen")
    bp.screenshot(path=f"{OUT}/portal-order-charges-phone.png", full_page=True)
    kc2 = ctx(); kp2 = page(kc2, KTV, "KTV Gửi File")
    kp2.goto(B + f"/admin#orders/{OID}"); kp2.wait_for_selector("#oSent", timeout=15000); kp2.wait_for_timeout(1200)
    kt = kp2.text_content("body") or ""
    ok("40.00" not in kt and "40,00" not in kt and "cổng khách (đơn giá" not in kt, "the KTV's order page still shows no price")
    kc2.close()

    # ---------- a portal case: the files sent from its order show on the case page
    sc, cj = ap.evaluate("""async () => { const r = await fetch('/api/my/jobs', {method:'POST', headers:{'Content-Type':'application/json','X-D8':'1'}, body: JSON.stringify({title:'', service:'Crown & bridge', teeth:'36'})}); return [r.status, await r.json()]; }""")
    JID = cj["job"]["id"]
    st, jv = key(f"/api/jobs/{JID}")
    POID = jv["job"].get("orderId")
    rq.put(f"/api/orders/{POID}/files/SentUiCase/0", headers={"X-D8": "1", "X-Upload-Key": PW, "Content-Type": "application/octet-stream"}, data=STL2)
    key(f"/api/orders/{POID}/files", {"files": [{"fid": "SentUiCase", "name": "case-36.stl", "size": len(STL2), "stored": len(STL2), "parts": 1, "gz": 0}], "final": True})
    ap.goto(B + f"/portal#/case/{JID}"); ap.wait_for_selector("#flH", timeout=15000); ap.wait_for_timeout(1200)
    ok(ap.get_attribute('a.iconbtn[download="case-36.stl"]', "href") == f"/api/my/orders/{POID}/files/SentUiCase", "portal case: the sent file is listed with its download")
    ap.screenshot(path=f"{OUT}/portal-case-sent.png", full_page=True)
    bp.goto(B + "/portal#/"); bp.wait_for_selector(".pt-list", timeout=15000); bp.wait_for_timeout(800)
    ok(bp.query_selector(f'.pt-list a[href="#/order/{POID}"]') is not None, "the other account sees that case as an order of the lab")
    ap.goto(B + f"/portal#/order/{POID}"); ap.wait_for_timeout(1500)
    ok(ap.evaluate("location.hash") == f"#/case/{JID}", "the account that sent the case is taken to the case page")
    b.close()

errs = [e for e in errors if "favicon" not in e]
ok(not errs, "no page errors " + str(errs[:3]))
print(f"{len(FAILS)} FAILED" if FAILS else "ALL PASSED")
sys.exit(1 if FAILS else 0)
