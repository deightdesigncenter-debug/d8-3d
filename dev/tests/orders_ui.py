"""Order book in the browser: customer + price list, order form (codes, teeth -> quantity, surcharge), search,
redo (R), KTV / QC workflow and team chat (KTV never sees money), payment, reports with chart, Excel export
(checked with openpyxl), Excel import, 3D link with preview picture, phone layout. Screenshots in the folder given.
Run against: PAY=1 node dev/server.mjs public 8788 mat-khau-thu"""
import sys, os, time, json, re
from playwright.sync_api import sync_playwright
import openpyxl
B = os.environ.get("D8_BASE", "http://localhost:8788")
OUT = sys.argv[1] if len(sys.argv) > 1 else "shots-orders"
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
API = """async ([path, body, method]) => { const r = await fetch(path, {method: method || (body ? 'POST' : 'GET'), headers:{'Content-Type':'application/json','X-D8':'1'}, body: body ? JSON.stringify(body) : undefined}); return [r.status, await r.json().catch(()=>({}))]; }"""
stamp = str(int(time.time()))[-6:]
CODE = "UI" + stamp
KTV, QC = f"ktv{stamp}@d8.example", f"qc{stamp}@d8.example"
EXO = os.path.join(OUT, "scene-exocad.html")
open(EXO, "w").write("""<!doctype html><html><head><title>exocad scene</title></head><body style="margin:0;background:#473A6D">
<canvas id="c" width="1200" height="630" style="display:block;width:100vw;height:100vh"></canvas>
<script>window.DentalWebGL={hasEmbeddedData:function(){return true},m_SceneManager:{m_MeshSort:{m_SortedMeshs:[{IsLoaded:true}]}}};
var g=document.getElementById('c').getContext('webgl'); if (g) { g.clearColor(0.86,0.74,0.52,1); g.clear(g.COLOR_BUFFER_BIT); }</script></body></html>""")

with sync_playwright() as p:
    b = p.chromium.launch()
    def ctx(vp=None, mobile=False):
        c = b.new_context(viewport=vp or {"width": 1366, "height": 900}, is_mobile=mobile, has_touch=mobile, reduced_motion="reduce", accept_downloads=True)
        c.route("**/*", block)
        c.add_init_script(f"try{{localStorage.setItem('d8-theme','{THEME}')}}catch(e){{}}")
        return c
    def watch(pg, name):
        pg.on("pageerror", lambda e: errors.append(name + " PAGEERROR " + str(e)))
        pg.on("console", lambda m: errors.append(name + " console: " + m.text) if m.type == "error" and "ERR_FAILED" not in m.text and "401" not in m.text and "403" not in m.text and "404" not in m.text and "409" not in m.text else None)
    def text(pg, sel): return pg.inner_text(sel) if pg.query_selector(sel) else ""

    oc = ctx(); op = oc.new_page(); watch(op, "owner")
    op.goto(B + "/admin"); op.evaluate(SIGNIN, ["d.eightdesigncenter@gmail.com", "Danny Do"])
    op.evaluate(API, ["/api/products/sample", {}])
    for e, role in [(KTV, "designer"), (QC, "qc")]: op.evaluate(API, ["/api/staff", {"email": e, "role": role}])
    op.reload(); op.wait_for_timeout(1200)

    # customer through the form, then its price list
    op.goto(B + "/admin#customers/new"); op.wait_for_timeout(700)
    op.fill("#cfCode", CODE.lower()); op.fill("#cfName", "Lux Smile Studio " + stamp); op.select_option("#cfKind", "clinic"); op.select_option("#cfCur", "USD")
    op.fill("#cfTerms", "Trả từng ca qua Payoneer"); op.click("#cfForm [type=submit]"); op.wait_for_timeout(1500)
    m = re.search(r"#cust/(\d+)", op.url); ok(m is not None, "customer created, customer page opened")
    CID = m.group(1) if m else "0"
    op.fill('#cuPrices [data-p="CR"]', "35"); op.click("#cuPrices [data-save]"); op.wait_for_timeout(900)
    st, pr = op.evaluate(API, [f"/api/prices?customer={CID}"])
    ok(any(x["product"] == "CR" and x["price"] == 35 for x in pr.get("own", [])), "customer price saved from the customer page")
    op.screenshot(path=f"{OUT}/customer.png", full_page=True)

    # new order through the form
    op.goto(B + f"/admin#orders/new?customer={CID}"); op.wait_for_timeout(1500)
    ok(CODE in op.input_value("#ofCust"), "form opens with the customer filled in")
    code_preview = op.inner_text("#ofCodeOut")
    ok(re.match(r"^\d{8,9}$", code_preview) is not None, "code preview " + code_preview)
    op.fill("#ofClinic", "Lux Smile"); op.fill("#ofDoctor", "Dr Kiệt"); op.fill("#ofPatient", "Chuang Tsung Wei"); op.fill("#ofRef", "KN" + stamp)
    op.fill('#ofItems [data-i="0"] [data-k="product"]', "CR"); op.wait_for_timeout(500)
    op.fill('#ofItems [data-i="0"] [data-k="teeth"]', "11-13"); op.wait_for_timeout(700)
    ok(op.input_value('#ofItems [data-i="0"] [data-k="qty"]') == "3", "teeth 11-13 → quantity 3")
    op.click("#ofAdd"); op.fill('#ofItems [data-i="1"] [data-k="product"]', "IMC"); op.wait_for_timeout(600)
    op.fill('#ofItems [data-i="1"] [data-k="price"]', "45"); op.wait_for_timeout(600)
    op.click('[data-pct="50"]'); op.wait_for_timeout(300)
    ok("US$225" in text(op, "#ofMoney"), "form total (3×35 + 45) +50% = US$225: " + text(op, "#ofMoney").replace("\n", " "))
    op.select_option("#ofDes", KTV); op.select_option("#ofQc", QC)
    op.fill("#ofChat", "Lưu ý tiếp xúc nhẹ, khớp cắn 0.4 mm")
    op.screenshot(path=f"{OUT}/order-form.png", full_page=True)
    op.click("#ofSave"); op.wait_for_timeout(2000)
    m = re.search(r"#orders/(\d+)$", op.url); ok(m is not None, "order saved, order page opened")
    OID = m.group(1) if m else "0"
    band = op.inner_text(".pt-band")
    ok(code_preview in band and "Chuang Tsung Wei" in band, "order page title: code + patient")
    body = op.inner_text("#p-order")
    ok("US$225" in body and "Đang thiết kế" in body, "order page: total and status")
    op.wait_for_timeout(600)
    ok("khớp cắn 0.4" in text(op, "#oChat"), "first team message is in the order chat")
    op.screenshot(path=f"{OUT}/order-page.png", full_page=True)

    # search
    old_style = "/".join([code_preview[0:2], code_preview[2:4], code_preview[4:6], code_preview[6:]])
    for q, why in [("chuang", "patient"), ("kiet", "doctor without accents"), (code_preview, "code"), (old_style, "code typed the old way"), (CODE, "customer code")]:
        op.goto(B + "/admin#orders"); op.wait_for_timeout(800)
        op.fill("#oQ", q); op.wait_for_timeout(1200)
        ok(code_preview in text(op, "#oList"), "list search by " + why)
    op.screenshot(path=f"{OUT}/orders-list.png", full_page=True)

    # the same case typed in again: the form says it is already in the book, with its code
    op.goto(B + f"/admin#orders/new?customer={CID}"); op.wait_for_timeout(1500)
    op.fill("#ofPatient", "chuang tsung wei"); op.wait_for_timeout(1300)
    ok(op.is_visible("#ofDupes") and code_preview in text(op, "#ofDupes"), "duplicate warning shows the existing code " + code_preview)
    op.fill('#ofItems [data-i="0"] [data-k="product"]', "CR"); op.wait_for_timeout(400)
    op.click("#ofSave"); op.wait_for_timeout(900)
    ok("#orders/new" in op.url and op.is_visible("#ofErr") and "đã có" in text(op, "#ofErr"), "saving is held back until confirmed")
    op.screenshot(path=f"{OUT}/order-dupe.png", full_page=True)
    op.check("#ofDupOk"); op.click("#ofSave"); op.wait_for_timeout(1800)
    m2 = re.search(r"#orders/(\d+)$", op.url)
    ok(m2 is not None, "after ticking 'this is another order' it is created")
    if m2: op.evaluate("async (id) => (await fetch('/api/orders/' + id, {method: 'DELETE', headers: {'X-D8': '1'}})).status", m2.group(1))

    # redo (R) and next stage (C): the code is shown before saving
    op.goto(B + f"/admin#orders/new?redo={OID}"); op.wait_for_timeout(1500)
    ok(text(op, "#ofKidCode") == code_preview + "R1", "redo form shows the new code " + text(op, "#ofKidCode"))
    op.click("#ofSave"); op.wait_for_timeout(1800)
    ok(code_preview + "R1" in op.inner_text(".pt-band"), "redo order " + code_preview + "R1")
    ok(code_preview in text(op, ".o-fam") and "R1" in text(op, ".o-fam"), "family of orders shown")
    op.goto(B + f"/admin#orders/new?continue={OID}"); op.wait_for_timeout(1500)
    ok(text(op, "#ofKidCode") == code_preview + "C2", "next-stage form shows " + text(op, "#ofKidCode") + " (stage 1 is the plain code)")
    op.click("#ofSave"); op.wait_for_timeout(1800)
    ok(code_preview + "C2" in op.inner_text(".pt-band") and "Giai đoạn 2" in op.inner_text(".pt-band"), "stage 2 order " + code_preview + "C2")

    # KTV: no money, workflow, chat
    kc = ctx(); kp = kc.new_page(); watch(kp, "ktv")
    kp.goto(B + "/admin"); kp.evaluate(SIGNIN, [KTV, "Minh KTV " + stamp]); kp.reload(); kp.wait_for_timeout(1500)
    nav = kp.eval_on_selector_all("#wsNav nav a > span:not(.count)", "els=>els.map(e=>e.textContent.trim())")
    ok("Báo cáo" not in nav and "Khách hàng" not in nav and "Mã hàng & bảng giá" not in nav, "KTV sidebar has no reports, customers or prices")
    ok(code_preview in text(kp, "#dash"), "KTV dashboard lists the order")
    kp.goto(B + "/admin#orders/" + OID); kp.wait_for_timeout(1500)
    kb = kp.inner_text("#p-order")
    ok("US$" not in kb and "Thanh toán" not in kb and "Còn nợ" not in kb, "KTV order page shows no money")
    ok("CR" in kb and "IMC" in kb and "11-13" in kb, "KTV sees the items and teeth")
    kp.fill("#oChat textarea", "Anh ơi 12 cần dài thêm không?"); kp.click("#oChat [type=submit]"); kp.wait_for_timeout(900)
    # a design file in the chat
    stl = os.path.join(OUT, "11-13 crown v1.stl")
    with open(stl, "w") as fh: fh.write("solid crown\n" + "facet normal 0 0 1\n" * 400 + "endsolid crown\n")
    kp.set_input_files('#oChat [data-ochat="file"]', stl); kp.wait_for_timeout(300)
    ok("11-13 crown v1.stl" in text(kp, "#oChat .ochat-files"), "file waits under the message box")
    kp.fill("#oChat textarea", "File thiết kế v1"); kp.click("#oChat [type=submit]"); kp.wait_for_timeout(2000)
    ok(kp.query_selector("#oChat a.ochat-file") is not None and "11-13 crown v1.stl" in text(kp, "#oChat .ochat-list"), "file sent in the chat")
    href = kp.eval_on_selector("#oChat a.ochat-file", "a => a.getAttribute('href')")
    fr = kp.request.get(B + href)
    ok(fr.status == 200 and fr.body().startswith(b"solid crown"), "file downloads from the chat")
    kp.click('[data-act="submit"]'); kp.wait_for_timeout(1000)
    ok("Chờ QC" in kp.inner_text(".pt-band"), "KTV sends to QC")
    kp.screenshot(path=f"{OUT}/ktv-order.png", full_page=True)
    kp.goto(B + "/admin#reports"); kp.wait_for_timeout(600)
    ok(kp.is_visible("#p-denied"), "KTV cannot open reports")

    qcx = ctx(); qp = qcx.new_page(); watch(qp, "qc")
    qp.goto(B + "/admin"); qp.evaluate(SIGNIN, [QC, "Lan QC " + stamp]); qp.reload(); qp.wait_for_timeout(1500)
    qp.goto(B + "/admin#orders"); qp.wait_for_timeout(1200)
    ok(qp.query_selector("#oList .o-dot") is not None, "QC sees an unread chat mark")
    qp.goto(B + "/admin#orders/" + OID); qp.wait_for_timeout(1500)
    ok("12 cần dài thêm" in text(qp, "#oChat"), "QC reads the KTV message")
    qp.click('[data-act="fail"]'); qp.wait_for_timeout(500)
    ok("Chờ QC" in qp.inner_text(".pt-band"), "QC fail needs a note")
    qp.fill("#oNote", "Tiếp xúc 21 quá chặt"); qp.click('[data-act="fail"]'); qp.wait_for_timeout(1000)
    ok("QC trả sửa" in qp.inner_text(".pt-band"), "QC returns the order")
    kp.goto(B + "/admin#orders/" + OID); kp.wait_for_timeout(1500)
    ok("Tiếp xúc 21 quá chặt" in text(kp, "#oChat"), "KTV sees the QC note in the chat")
    kp.click('[data-act="submit"]'); kp.wait_for_timeout(900)
    qp.reload(); qp.wait_for_timeout(1500); qp.click('[data-act="pass"]'); qp.wait_for_timeout(1000)
    ok("Đã qua QC" in qp.inner_text(".pt-band"), "QC passes")

    # owner delivers and records the payment
    op.goto(B + "/admin#orders/" + OID); op.wait_for_timeout(1500)
    op.click('[data-act="deliver"]'); op.wait_for_timeout(1000)
    ok("Đã giao" in op.inner_text(".pt-band"), "owner delivers")
    op.click("#opAddBtn"); op.fill("#opRef", "PP-" + stamp); op.click("#opForm [type=submit]"); op.wait_for_timeout(1500)
    ok(re.search(r"Còn nợ\s*US\$0", op.inner_text("#p-order")) is not None, "payment recorded, nothing owed")

    # reports + Excel export
    op.goto(B + "/admin#reports"); op.wait_for_timeout(1800)
    ok(op.query_selector("#rpMoney svg path, #rpMoney svg rect:not(.hit)") is not None and op.query_selector("#rpCases svg") is not None, "report charts drawn")
    hit = op.query_selector_all("#rpCases .hit")
    if hit:
        hit[-1].hover(); op.wait_for_timeout(300)
        ok(op.is_visible("#rpCases .chart-tip"), "chart tooltip on hover")
    op.screenshot(path=f"{OUT}/reports.png", full_page=True)
    with op.expect_download() as dl:
        op.click("#rpExport")
    path = os.path.join(OUT, "export.xlsx"); dl.value.save_as(path)
    wb = openpyxl.load_workbook(path)
    ok(wb.sheetnames[:3] == ["Tổng hợp tháng", "Đơn hàng", "Hạng mục"] and "Theo khách" in wb.sheetnames and "Theo KTV" in wb.sheetnames, "export sheets: " + ", ".join(wb.sheetnames))
    rows = list(wb["Đơn hàng"].iter_rows(values_only=True))
    hit_row = [r for r in rows if r and r[0] == code_preview]
    ok(hit_row and hit_row[0][6] == "Chuang Tsung Wei" and 225 in hit_row[0], "exported order row has patient and total")
    ok(isinstance(rows[1][1], __import__("datetime").datetime), "dates exported as real Excel dates")

    # Excel import of old orders, from the template
    op.goto(B + "/admin#import/orders"); op.wait_for_timeout(800)
    with op.expect_download() as dl:
        op.click("#imTpl")
    tpl = os.path.join(OUT, "mau-don.xlsx"); dl.value.save_as(tpl)
    wb = openpyxl.load_workbook(tpl); ws = wb["Đơn hàng"]
    ws.delete_rows(2, ws.max_row)
    for r in [["B1", "05/08/2026", CODE, "Lux", "Dr Kiệt", "Old patient " + stamp, "", "CR", "11 21", "", "", "", "", "Đã giao", "", "", "", "x"],
              ["B1", "05/08/2026", CODE, "", "", "", "", "IMC", "", 1, 40],
              ["", "06/08/2026", CODE, "", "", "Second old " + stamp, "", "CR", "", 1, "", "", "Miễn phí"],
              ["", "07/08/2026", "NOPE" + stamp, "", "", "Bad", "", "CR"]]:
        ws.append(r)
    filled = os.path.join(OUT, "don-cu.xlsx"); wb.save(filled)
    op.set_input_files("#imFile", filled); op.wait_for_timeout(2500)
    prev = text(op, "#imBody")
    ok("không có khách mã" in prev.lower() or "NOPE" in prev, "preview flags the unknown customer")
    ok(op.is_enabled("#imGo") and "2" in op.inner_text("#imGo"), "2 valid orders ready: " + op.inner_text("#imGo"))
    op.screenshot(path=f"{OUT}/import-preview.png", full_page=True)
    op.click("#imGo"); op.wait_for_timeout(2500)
    ok("Đã nhập 2" in text(op, "#imDone"), "imported 2 old orders")
    st, lst = op.evaluate(API, [f"/api/orders?customer={CID}&status=&limit=50&q=old"])
    olds = lst.get("items", [])
    o1 = next((x for x in olds if x["patient"] == "Old patient " + stamp), None)
    ok(o1 and o1["day"] == "2026-08-05" and o1["total"] == 110 and o1["paid"] == 110 and o1["units"] == 3, "imported order: 2×CR(35) + IMC 40, paid: " + json.dumps(o1)[:160] if o1 else "imported order missing")

    # a customer's own sheet ("GC - Case Detail": no customer column, product names, US dates, Progress)
    gc = openpyxl.Workbook(); gs = gc.active; gs.title = "GC - Case Detail"
    gs.append(["Case_ID", "Created_Date", "Doctor_Name", "Patient_Name", "Product_Name", "Unit", "Instruction_Note", "Progress"])
    for r in [["GC" + stamp + "1", "10/14/2026", "Dr Gene", "GC Alpha " + stamp, "Crown (full anatomy)", 2, "Light contact", "Completed"],
              ["GC" + stamp + "1", "10/14/2026", "Dr Gene", "GC Alpha " + stamp, "Implant crown", 1, "", "Completed"],
              ["GC" + stamp + "2", "10/15/2026", "Dr Gene", "GC Beta " + stamp, "Night guard XYZ", 1, "", "Pending"],
              ["GC" + stamp + "3", __import__("datetime").datetime(2026, 10, 16), "Dr Gene", "GC Gamma " + stamp, "Zirconia crown special", 1, "", "Completed"]]:
        gs.append(r)
    gcf = os.path.join(OUT, "GC - Case Detail.xlsx"); gc.save(gcf)
    op.goto(B + "/admin#import/orders"); op.wait_for_timeout(1000)
    op.set_input_files("#imFile", gcf); op.wait_for_timeout(2500)
    ok(op.is_visible("#imPrev") and "thiếu Mã khách" in text(op, "#imBody"), "customer's own sheet read; asks for the customer")
    names = op.eval_on_selector_all("#imMapBody .im-map-row span", "els => els.map((e) => e.textContent)")
    ok(sorted(names) == ["Night guard XYZ", "Zirconia crown special"], "only names not in the catalogue need matching: " + ", ".join(names))
    op.select_option("#imCust", CODE); op.wait_for_timeout(2000)
    ok("nhập 1" in op.inner_text("#imGo").lower(), "with the customer picked, the matched case is ready: " + op.inner_text("#imGo"))
    op.select_option('#imMapBody [data-map="night guard xyz"]', "NG"); op.wait_for_timeout(1800)
    op.select_option('#imMapBody [data-map="zirconia crown special"]', "CR"); op.wait_for_timeout(1800)
    ok("nhập 3" in op.inner_text("#imGo").lower() and op.is_visible("#imMap"), "after matching names: 3 orders ready: " + op.inner_text("#imGo"))
    ok(op.is_visible("#imZero") and "1 đơn có thành tiền 0" in text(op, "#imZero"), "warns about the order with no price (NG has none for this customer)")
    op.screenshot(path=f"{OUT}/import-gc.png", full_page=True)
    op.click("#imGo"); op.wait_for_timeout(2500)
    ok("Đã nhập 3" in text(op, "#imDone"), "imported 3 orders from the customer's sheet")
    st, lst = op.evaluate(API, [f"/api/orders?customer={CID}&status=&limit=50&q=gc"])
    gcs = {x["patient"].split(" ")[1]: x for x in lst.get("items", []) if x["patient"].startswith("GC ")}
    a, bt, g = gcs.get("Alpha"), gcs.get("Beta"), gcs.get("Gamma")
    ok(a and a["day"] == "2026-10-14" and a["units"] == 3 and a["status"] == "delivered" and a["ref"] == "GC" + stamp + "1", "lines with the same Case_ID are one order, US date read right: " + json.dumps(a)[:200] if a else "GC order missing")
    st, ad = op.evaluate(API, ["/api/orders/" + str(a["id"])]) if a else (0, {})
    its = sorted((x["product"], x["qty"]) for x in ad.get("items", []))
    ok(its == [("CR", 2), ("IMC", 1)] and "Light contact" in (ad.get("order", {}).get("notes") or ""), "items by product name: " + str(its))
    ok(bt and bt["status"] == "design" and bt["day"] == "2026-10-15", "Pending → in design")
    ok(g and g["day"] == "2026-10-16", "real Excel date cell read")

    # 3D link with a preview picture, attached to the order
    op.goto(B + "/admin#links"); op.wait_for_timeout(900)
    op.fill("#ogOrder", code_preview); op.dispatch_event("#ogOrder", "change"); op.wait_for_timeout(1200)
    ok("CHUANG TSUNG WEI" in op.input_value("#label") and code_preview in op.input_value("#ogDesc"), "order code fills the preview title and description")
    op.set_input_files("#file", EXO); op.wait_for_timeout(400)
    op.click("#create"); op.wait_for_timeout(2500)
    for _ in range(30):
        if "Đã lưu ảnh" in text(op, "#snapSay") or "mặc định" in text(op, "#snapSay"): break
        op.wait_for_timeout(500)
    say = text(op, "#snapSay")
    ok("Đã lưu ảnh" in say, "preview picture captured from the 3D view: " + say)
    link = op.inner_text("#resUrl"); lid = link.rsplit("/", 1)[-1]
    op.screenshot(path=f"{OUT}/link-preview.png", full_page=True)
    r = op.request.get(B + "/og/" + lid + ".jpg"); default = op.request.get(B + "/brand/og-3d.jpg")
    ok(r.status == 200 and r.headers["content-type"] == "image/jpeg" and r.body() != default.body(), "link preview picture is the captured design")
    page = op.request.get(B + "/v/" + lid).text()
    ok('og:title" content="Patient: CHUANG TSUNG WEI' in page, "doctor link carries the preview title")
    st, od = op.evaluate(API, ["/api/orders/" + OID])
    ok(lid in od["order"]["previews"], "3D link attached to the order")

    # phone layout
    mc = ctx({"width": 390, "height": 844}, True); mp = mc.new_page(); watch(mp, "mobile")
    mp.goto(B + "/admin"); mp.evaluate(SIGNIN, ["d.eightdesigncenter@gmail.com", "Danny Do"]); mp.reload(); mp.wait_for_timeout(1200)
    # quick buttons: in the band on a wide screen, under it on a phone (no layout shift after load)
    ok(mp.is_visible("#dash .dash-quick a[href='#orders/new']") and not mp.is_visible("#bandRight .home-q"), "phone: quick order buttons under the band")
    op.evaluate("location.hash = '#home'")
    op.wait_for_selector("#dash .card", timeout=10000); op.wait_for_timeout(600)
    ok(op.is_visible("#bandRight .home-q a[href='#orders/new']") and not op.is_visible("#dash .dash-quick"), "desktop: quick order buttons in the band")
    mp.goto(B + "/admin#orders/" + OID); mp.wait_for_timeout(1500)
    rows = mp.eval_on_selector_all(".o-items tbody tr", "els => els.map((e) => e.getBoundingClientRect().width)")
    ok(rows and all(w <= 360 for w in rows) and mp.eval_on_selector(".o-items tbody tr td", "e => e.getBoundingClientRect().width") > 250, "phone: order items as full-width rows")
    for h in ["orders", "orders/" + OID, "orders/new", "reports", "catalog", "cust/" + CID, "import/orders"]:
        mp.goto(B + "/admin#" + h); mp.wait_for_timeout(1500)
        w = mp.evaluate("document.documentElement.scrollWidth")
        ok(w <= 390, "phone: no sideways scroll on #" + h + " (" + str(w) + ")")
        mp.screenshot(path=f"{OUT}/m-{h.replace('/', '-')}.png", full_page=True)
    b.close()
for e in errors: print("ERR", e)
ok(not errors, "no page errors")
print(("%d FAILED" % len(FAILS)) if FAILS else "ALL PASSED")
sys.exit(1 if FAILS else 0)
