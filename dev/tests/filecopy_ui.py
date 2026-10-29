"""Settings › Lưu trữ file ca in the browser (R2 bound): while case files are still in KV the card offers
"Chép file cũ từ KV sang R2"; the click copies them and the card then says nothing is left, the file downloads from R2.
Needs the R2 bucket: run with R2=1 (run.sh does). Screenshots (phone, dark, light) go to the folder given as the first argument."""
import sys, os, time, json
from playwright.sync_api import sync_playwright
B = os.environ.get("D8_BASE", "http://localhost:8788")
OUT = sys.argv[1] if len(sys.argv) > 1 else "shots-filecopy"
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
H = {"Content-Type": "application/json", "X-D8": "1"}
stamp = str(int(time.time()))
with sync_playwright() as p:
    b = p.chromium.launch()
    rq = p.request.new_context(base_url=B)
    tok = rq.get("/__test/idtoken?email=d.eightdesigncenter%40gmail.com&name=D.EIGHT").text()
    rq.post("/api/auth/google", data=json.dumps({"credential": tok}), headers=H)
    # a customer's case with one file, then the file moved to "kv" as the old site left it, with its part in KV
    cq = p.request.new_context(base_url=B)
    ctok = cq.get(f"/__test/idtoken?email=kvui{stamp}%40lab.example&name=Lab%20KV").text()
    cq.post("/api/auth/google", data=json.dumps({"credential": ctok}), headers=H)
    jid = cq.post("/api/my/jobs", data=json.dumps({"title": "Ca UI file KV", "service": "Crown & bridge"}), headers=H).json()["job"]["id"]
    fid = "Kvui000001"
    put = cq.put(f"/api/jobs/{jid}/files/{fid}/0", data="r2 original", headers={"Content-Type": "application/octet-stream", "X-D8": "1"})
    ok(put.status == 200, "setup: the customer uploads the part (%d)" % put.status)
    listed = cq.post(f"/api/jobs/{jid}/files", data=json.dumps({"files": [{"fid": fid, "name": "ui.stl", "size": 11, "stored": 11, "parts": 1, "gz": 0}]}), headers=H)
    ok(listed.status == 200, "setup: the file is listed on the case (%d)" % listed.status)
    flip = rq.post("/__test/exec", data=json.dumps({"sql": "UPDATE jobs SET doc = REPLACE(doc, '\"st\":\"r2\"', '\"st\":\"kv\"') WHERE id = ?", "params": [jid]}), headers=H)
    ok(flip.json().get("changes") == 1, "setup: the case is recorded with its file in KV (%s)" % flip.text())
    rq.post("/__test/kv", data=json.dumps({"key": f"jf:{jid}:{fid}:0", "value": "kv copy UI"}), headers=H)

    def open_settings(vp, mobile=False, theme="light"):
        c = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, reduced_motion="reduce")
        c.route("**/*", block)
        c.add_init_script(f"try{{localStorage.setItem('d8-theme','{theme}')}}catch(e){{}}")
        pg = c.new_page()
        pg.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
        pg.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
        pg.goto(B + "/"); pg.evaluate(SIGNIN, ["d.eightdesigncenter@gmail.com", "D.EIGHT"])
        pg.goto(B + "/admin#settings"); pg.wait_for_selector("#storeCard", timeout=8000)
        return c, pg

    # phone and dark: the card offers the copy and fits the width
    c, pg = open_settings({"width": 390, "height": 844}, mobile=True)
    ok(pg.locator("#copyKvFiles").count() == 1 and "còn" in pg.inner_text("#copyKvFiles").lower(), "phone: the card offers to copy the files still in KV")
    pg.locator("#storeCard").scroll_into_view_if_needed()
    w = pg.evaluate("document.documentElement.scrollWidth")
    ok(w <= 390, "phone: settings page fits the width (%d)" % w)
    pg.screenshot(path=f"{OUT}/copy-before-phone.png", full_page=True)
    c.close()
    c, pg = open_settings({"width": 1366, "height": 900}, theme="dark")
    ok(pg.locator("#copyKvFiles").count() == 1, "dark: the copy button is there")
    pg.locator("#storeCard").scroll_into_view_if_needed()
    pg.screenshot(path=f"{OUT}/copy-before-dark.png", full_page=True)
    c.close()

    # light: the click copies the file, the card then says nothing is left, and the file downloads from R2
    c, pg = open_settings({"width": 1366, "height": 900})
    pg.click("#copyKvFiles")
    pg.wait_for_function("() => !document.getElementById('copyKvFiles')", timeout=20000)
    ok("Không còn file cũ nào trong KV" in pg.inner_text("#storeCard"), "after the copy the card says nothing is left in KV")
    pg.locator("#storeCard").scroll_into_view_if_needed()
    pg.screenshot(path=f"{OUT}/copy-after-light.png", full_page=True)
    c.close()
    ok(rq.get(f"/api/jobs/{jid}/files/{fid}", headers=H).text() == "kv copy UI", "the file now downloads the bytes that were in KV, from R2")
    ok(not errors, "no page errors (" + "; ".join(errors[:3]) + ")")
    b.close()

print("ALL PASSED" if not FAILS else f"{len(FAILS)} FAILED")
sys.exit(1 if FAILS else 0)
