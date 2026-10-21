"""Rough speed check on a slow phone profile (4x CPU slowdown): time until each main screen is usable,
long main-thread tasks, and layout shift. Prints a table; fails if a screen takes over 2.5 s locally or shifts (CLS > 0.01)."""
import sys, os, json, time
from playwright.sync_api import sync_playwright
B = os.environ.get("D8_BASE", "http://localhost:8788")
SIGNIN = """async ([email,name]) => { const tok = await (await fetch('/__test/idtoken?email='+encodeURIComponent(email)+'&name='+encodeURIComponent(name))).text();
  const r = await fetch('/api/auth/google', {method:'POST', headers:{'Content-Type':'application/json','X-D8':'1'}, body: JSON.stringify({credential: tok})}); return r.status; }"""
OBS = """(() => { window.__long = 0; window.__cls = 0;
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.duration > 50) window.__long += e.duration; })).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true }); } catch (e) {} })();"""
rows, bad = [], []
with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    c.route("**/*", lambda r: r.abort() if ("fonts.g" in r.request.url or "accounts.google" in r.request.url or "cdnjs" in r.request.url) else r.continue_())
    c.add_init_script(OBS)
    pg = c.new_page()
    cdp = c.new_cdp_session(pg); cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    pg.goto(B + "/portal"); pg.evaluate(SIGNIN, ["d.eightdesigncenter@gmail.com", "Danny Do"])
    for name, url, ready in [("home", "/", ".stage-copy h1"), ("portal list", "/portal", ".pt-row, .pt-empty"), ("workspace home", "/admin", "#dash .card .dash-h"),
                             ("workspace cases", "/admin#jobs", "#jobList .pt-row, #jobList .pt-empty"), ("privacy", "/privacy", "article")]:
        t0 = time.time()
        pg.goto(B + url)
        pg.wait_for_selector(ready, timeout=15000)
        ms = int((time.time() - t0) * 1000)
        long_ms = int(pg.evaluate("window.__long || 0")); cls = round(pg.evaluate("window.__cls || 0"), 3)
        rows.append((name, ms, long_ms, cls))
        if ms > 2500 or cls > 0.01: bad.append(name)  # the owner's rule: no layout shift
    b.close()
print("%-18s %8s %12s %6s" % ("screen", "ready ms", "long tasks", "CLS"))
for r in rows: print("%-18s %8d %12d %6.3f" % r)
print("SLOW: " + ", ".join(bad) if bad else "ALL FAST")
sys.exit(1 if bad else 0)
