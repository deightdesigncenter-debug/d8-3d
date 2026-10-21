"""Customer portal end to end (desktop and phone): sign in, new case with files and Rx, pre-send checks,
messages, staff reply + 3D link (admin password), approve, download, profile, list. Fails on any page error."""
import sys, os, json, hashlib, time, re
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixtures import make_all
B = os.environ.get("D8_BASE", "http://localhost:8788")
PW = os.environ.get("D8_PASSWORD", "mat-khau-thu")
OUT = sys.argv[1] if len(sys.argv) > 1 else "shots-portal"
os.makedirs(OUT, exist_ok=True)
F = make_all(os.path.join(OUT, "fixtures"))
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
    b = p.chromium.launch()
    for name, vp, mobile in [("desk", {"width": 1366, "height": 900}, False), ("mob", {"width": 390, "height": 844}, True)]:
        ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, accept_downloads=True, reduced_motion="reduce")
        ctx.route("**/*", block)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(name + " PAGEERROR " + str(e)))
        pg.on("console", lambda m: errors.append(name + " console: " + m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
        pg.goto(B + "/portal"); pg.wait_for_timeout(500)
        ok(pg.is_visible("#gbtn"), name + ": sign-in screen")
        ok(pg.evaluate(SIGNIN, [f"{name}{stamp}@lab.example", "Dr. Jamie Lee"]) == 200, name + ": signed in")
        pg.reload(); pg.wait_for_timeout(700)
        pg.goto(B + "/portal#/new"); pg.wait_for_timeout(500)
        pg.fill("#nTitle", "Case 1024, upper full arch")
        pg.select_option("#nService", "Implant restorations")
        pg.fill("#nTeeth", "14-24"); pg.fill("#nMat", "Zirconia"); pg.fill("#nShade", "A2")
        pg.fill("#nNotes", "Cement gap 0.05 mm. Screw access palatal.")
        pg.set_input_files("#nFiles", [F["stl"], F["ply"]]); pg.wait_for_timeout(600)
        checks = pg.eval_on_selector_all(".picked .pk-c", "els=>els.map(e=>e.className+' '+e.textContent)")
        ok(any("ok" in c and "STL" in c for c in checks), name + ": STL checked in the browser")
        pg.screenshot(path=f"{OUT}/{name}-new.png", full_page=True)
        pg.click("#nSubmit"); pg.wait_for_timeout(1500)
        if pg.is_visible("#wSend"):
            ok(True, name + ": pre-send warnings shown (" + str(pg.eval_on_selector_all("#nWarn li", "e=>e.length")) + ")")
            pg.click("#wSend")
        pg.wait_for_function("location.hash.startsWith('#/case/')", timeout=60000); pg.wait_for_timeout(900)
        jid = pg.evaluate("location.hash.split('/')[2]")
        ok(jid.startswith("D8-"), name + ": case created " + jid)
        # with the order book (D1) the case gets an order code yy/mm/dd/xx, shown to the customer instead of D8-…
        oc = pg.evaluate("D8.api('/api/jobs/' + location.hash.split('/')[2]).then((r) => r.job.order || '')")
        if oc:
            ok(re.match(r"^\d{8,9}$", oc) is not None, name + ": order code " + oc)
            ok(oc in pg.inner_text(".pt-band"), name + ": order code in the case header")
        ok(pg.eval_on_selector_all(".files li", "e=>e.length") >= 2, name + ": files attached")
        pg.fill("#composer", "Hi, please keep the screw access palatal on 12 and 22."); pg.click("#sendMsg"); pg.wait_for_timeout(700)
        ok("screw access palatal on 12" in pg.inner_text("#thread"), name + ": message sent")
        # D.EIGHT replies and posts a 3D link (admin password)
        H = {"X-Upload-Key": PW, "Content-Type": "application/json", "X-D8": "1"}
        api = ctx.request
        api.post(B + f"/api/jobs/{jid}/messages", headers=H, data=json.dumps({"text": "Thanks, noted."}))
        r = api.post(B + "/api/upload", headers={"X-Upload-Key": PW, "X-D8": "1", "X-Case-Label": "Upper v1", "X-Expire-Days": "14", "Content-Type": "application/octet-stream"}, data=open(F["html"], "rb").read())
        link = r.json(); ok(r.status == 201, name + ": 3D link created")
        r = api.post(B + f"/api/jobs/{jid}/previews", headers=H, data=json.dumps({"linkId": link["id"]}))
        ok(r.status == 200 and r.json()["job"]["status"] == "review", name + ": case in review")
        pg.reload(); pg.wait_for_timeout(1000)
        ok(pg.is_visible("#approve"), name + ": approve button")
        pg.click("#approve"); pg.wait_for_timeout(200); pg.click("#approve"); pg.wait_for_timeout(900)
        ok("approved" in pg.inner_text(".pt-band .st").lower(), name + ": approved")
        with pg.expect_download() as dl: pg.click(".files li a.iconbtn")
        d = dl.value; data = open(d.path(), "rb").read()
        same = hashlib.md5(data).hexdigest() in (hashlib.md5(open(F["stl"], "rb").read()).hexdigest(), hashlib.md5(open(F["ply"], "rb").read()).hexdigest())
        ok(same, name + ": download matches the upload (" + d.suggested_filename + ")")
        pg.goto(B + "/portal#/"); pg.wait_for_timeout(800)
        ok((oc or jid) in pg.inner_text("#view"), name + ": case in list (" + (oc or jid) + ")")
        pg.goto(B + "/portal#/profile"); pg.wait_for_timeout(700)
        pg.fill("#pfPractice", "Lee Dental Lab"); pg.click("#pfSave"); pg.wait_for_timeout(700)
        ok("saved" in pg.inner_text("#pfSave").lower() or "đã lưu" in pg.inner_text("#pfSave").lower(), name + ": profile saved")
        w = pg.evaluate("document.documentElement.scrollWidth")
        ok(w <= vp["width"], name + ": no horizontal overflow (" + str(w) + ")")
        ctx.close()
    b.close()
for e in errors: print("ERR", e)
ok(not errors, "no page errors")
print(("%d FAILED" % len(FAILS)) if FAILS else "ALL PASSED")
sys.exit(1 if FAILS else 0)
