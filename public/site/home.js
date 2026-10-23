/* D.EIGHT homepage behaviour: hero stage, service tabs, work rail, reveal, contact form. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const t = (k, en) => (window.D8 && D8.t ? D8.t(k, en) : en);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- hero stage ---------------- */
  const stage = $("stage");
  if (stage) {
    const slides = [...stage.querySelectorAll(".slide")];
    const dots = [...stage.querySelectorAll(".dots button")];
    const DUR = 6500;
    let cur = 0, timer = null, paused = false;
    stage.style.setProperty("--dur", DUR + "ms");
    const show = (i) => {
      cur = (i + slides.length) % slides.length;
      slides.forEach((s, n) => {
        const on = n === cur;
        s.classList.toggle("on", on);
        s.setAttribute("aria-hidden", on ? "false" : "true");
        s.inert = !on;
        if (on) s.querySelectorAll("img[loading=lazy]").forEach((im) => { im.loading = "eager"; });
      });
      dots.forEach((d, n) => {
        d.classList.remove("on"); d.setAttribute("aria-selected", "false");
        if (n === cur) { void d.offsetWidth; d.classList.add("on"); d.setAttribute("aria-selected", "true"); }
      });
      $("stageCount").textContent = String(cur + 1).padStart(2, "0") + " / " + String(slides.length).padStart(2, "0");
      schedule();
    };
    const schedule = () => {
      clearTimeout(timer);
      if (reduce || paused || document.hidden) return;
      timer = setTimeout(() => show(cur + 1), DUR);
    };
    const pause = (p) => { paused = p; stage.classList.toggle("paused", p); if (p) clearTimeout(timer); else show(cur); };
    slides.forEach((s, n) => { if (n) s.inert = true; });
    dots.forEach((d, n) => d.addEventListener("click", () => show(n)));
    $("prevSlide").addEventListener("click", () => show(cur - 1));
    $("nextSlide").addEventListener("click", () => show(cur + 1));
    stage.addEventListener("mouseenter", () => pause(true));
    stage.addEventListener("mouseleave", () => pause(false));
    stage.addEventListener("focusin", () => pause(true));
    stage.addEventListener("focusout", (e) => { if (!stage.contains(e.relatedTarget)) pause(false); });
    document.addEventListener("visibilitychange", schedule);
    let x0 = null;
    stage.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener("touchend", (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1));
    });
    show(0);
  }

  /* ---------------- service tabs ---------------- */
  const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
  const select = (tab, focus) => {
    tabs.forEach((b) => {
      const on = b === tab;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      $(b.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) tab.focus();
  };
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => select(b));
    b.addEventListener("keydown", (e) => {
      const k = e.key;
      let n = null;
      if (k === "ArrowRight") n = (i + 1) % tabs.length;
      else if (k === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
      else if (k === "Home") n = 0;
      else if (k === "End") n = tabs.length - 1;
      if (n != null) { e.preventDefault(); select(tabs[n], true); }
    });
  });

  /* ---------------- WhatsApp links carry a greeting in the page language ---------------- */
  const setWa = () => { if (window.D8 && D8.waLink) document.querySelectorAll(".wa-link").forEach((a) => { a.href = D8.waLink(); }); };
  setWa();
  document.addEventListener("d8:lang", setWa);

  /* ---------------- links that preset the contact topic ---------------- */
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-topic]");
    if (!a) return;
    const sel = $("cService");
    if (sel) sel.value = a.dataset.topic;
  });

  /* ---------------- work rail ---------------- */
  const rail = $("rail");
  if (rail) {
    const step = () => (rail.querySelector(".tile")?.getBoundingClientRect().width || 400) + 20;
    $("railPrev").addEventListener("click", () => rail.scrollBy({ left: -step(), behavior: reduce ? "auto" : "smooth" }));
    $("railNext").addEventListener("click", () => rail.scrollBy({ left: step(), behavior: reduce ? "auto" : "smooth" }));
    rail.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); rail.scrollBy({ left: step() }); }
      if (e.key === "ArrowLeft") { e.preventDefault(); rail.scrollBy({ left: -step() }); }
    });
  }

  /* ---------------- reveal on scroll + floating button ---------------- */
  const fab = $("fab"), contact = $("contact");
  let nearTop = true, contactOn = false;
  const fabState = () => { if (fab) { fab.classList.toggle("hide", nearTop || contactOn); fab.tabIndex = nearTop || contactOn ? -1 : 0; } };
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    }), { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    if (fab && contact) {
      new IntersectionObserver((entries) => entries.forEach((en) => { contactOn = en.isIntersecting; fabState(); }), { threshold: 0.15 }).observe(contact);
    }
  } else {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
  }
  const onScroll = () => { nearTop = window.scrollY < window.innerHeight * 0.6; fabState(); };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------------- parallax: background layers move slower than the page ---------------- */
  // Only the hero artwork and the editorial photo move (transform via a CSS variable);
  // nothing runs while they are off screen, and nothing at all with reduced motion.
  const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const layers = [document.querySelector(".stage"), document.querySelector(".editorial")].filter(Boolean);
  if (!still && layers.length && "IntersectionObserver" in window) {
    const live = new Set();
    let queued = false;
    const paint = () => {
      queued = false;
      const vh = window.innerHeight;
      live.forEach((el) => {
        const r = el.getBoundingClientRect();
        let y;
        if (el.classList.contains("stage")) y = Math.max(0, -r.top) * 0.18;
        else { const max = r.height * 0.11; y = Math.max(-max, Math.min(max, -(r.top + r.height / 2 - vh / 2) * 0.12)); }
        el.style.setProperty("--py", y.toFixed(1) + "px");
      });
    };
    const queue = () => { if (!queued && live.size) { queued = true; requestAnimationFrame(paint); } };
    const seen = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) live.add(en.target); else live.delete(en.target); queue(); }));
    layers.forEach((el) => seen.observe(el));
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
  }

  /* ---------------- contact form ---------------- */
  const form = $("contactForm");
  if (!form) return;
  const showError = (msg) => { $("cError").textContent = msg; $("cError").hidden = false; };
  // Anti-bot: a time token signed by the server (fetched when the visitor starts on the form; a message sent
  // sooner than 3 s after it, without it, or with a forged one is dropped) and, when the owner turns it on,
  // Cloudflare Turnstile (no puzzles for people; loaded only once someone starts on the form).
  let token = "", tokenAt = 0, tokenWait = 3000, tokenP = null;
  const getToken = () => {
    if (token && Date.now() - tokenAt < 12 * 3600e3) return Promise.resolve(token);
    return (tokenP = tokenP || fetch("/api/contact/token", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("token"))))
      .then((j) => { token = j.token || ""; tokenAt = Date.now(); tokenWait = (j.minMs || 3000) + 250; return token; })
      .finally(() => { tokenP = null; }));
  };
  let tsWidget = null, tsP = null;
  const turnstile = () => (tsP = tsP || D8.config().then((cfg) => new Promise((resolve) => {
    if (!cfg || !cfg.turnstile) return resolve(false);
    const box = $("cTurnstile");
    box.hidden = false;
    const draw = () => {
      try {
        tsWidget = window.turnstile.render(box, { sitekey: cfg.turnstile, theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light", language: (D8.lang === "vi" ? "vi" : "en"), action: "contact" });
        resolve(true);
      } catch { resolve(false); }
    };
    if (window.turnstile) return draw();
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = draw;
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  })));
  form.addEventListener("focusin", () => { getToken().catch(() => {}); turnstile(); }, { once: true });
  D8.config().then((cfg) => { if (cfg && cfg.turnstile) $("cTurnstile").hidden = false; }); // keep its place so nothing moves
  // Prefill name/email for signed-in customers.
  document.addEventListener("d8:user", (e) => {
    const u = e.detail;
    if (!u) return;
    if (!$("cName").value && u.name) $("cName").value = u.name;
    if (!$("cEmail").value && u.email) $("cEmail").value = u.email;
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("cError").hidden = true;
    const data = Object.fromEntries(new FormData(form).entries());
    for (const k of Object.keys(data)) data[k] = String(data[k]).trim();
    const missing = [];
    if (!data.name) missing.push(t("ct.m.name", "your name"));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) missing.push(t("ct.m.email", "a valid email"));
    if (data.message.length < 10) missing.push(t("ct.m.msg", "a message (at least 10 characters)"));
    if (missing.length) { showError(t("ct.add", "Please add {list}.").replace("{list}", missing.join(", "))); return; }
    data.lang = (window.D8 && D8.lang) || "en";
    const send = $("cSend");
    D8.busy(send, true);
    try {
      try { data.token = await getToken(); } catch { throw new Error("Failed to fetch"); }
      const wait = tokenAt + tokenWait - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (await turnstile()) {
        data.turnstile = (window.turnstile && tsWidget != null && window.turnstile.getResponse(tsWidget)) || "";
        if (!data.turnstile) throw new Error(t("ct.check", "Please complete the security check, then send again."));
      }
      const res = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      let out = {}; try { out = await res.json(); } catch {}
      if (!res.ok) {
        if (out.code === "captcha" && window.turnstile && tsWidget != null) window.turnstile.reset(tsWidget);
        throw new Error(out.error || t("ct.err", "Something went wrong. Please email us directly."));
      }
      form.hidden = true;
      $("cThanksText").textContent = t("ct.thanks", "Thank you, {name}. We'll reply to {email}.").replace("{name}", data.name).replace("{email}", data.email);
      $("cThanks").hidden = false;
      $("cThanks").focus();
    } catch (err) {
      showError(err.message === "Failed to fetch" ? t("ct.offline", "Couldn't reach the server. Check your connection, or email us directly.") : err.message);
    } finally {
      D8.busy(send, false);
    }
  });
})();
