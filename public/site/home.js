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

  /* ---------------- contact form ---------------- */
  const form = $("contactForm");
  if (!form) return;
  const started = Date.now();
  const showError = (msg) => { $("cError").textContent = msg; $("cError").hidden = false; };
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
    data.elapsed = Date.now() - started;
    data.lang = (window.D8 && D8.lang) || "en";
    const send = $("cSend");
    send.disabled = true; send.textContent = t("ct.sending", "Sending…");
    try {
      const res = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      let out = {}; try { out = await res.json(); } catch {}
      if (!res.ok) throw new Error(out.error || t("ct.err", "Something went wrong. Please email us directly."));
      form.hidden = true;
      $("cThanksText").textContent = t("ct.thanks", "Thank you, {name}. We'll reply to {email}.").replace("{name}", data.name).replace("{email}", data.email);
      $("cThanks").hidden = false;
      $("cThanks").focus();
    } catch (err) {
      showError(err.message === "Failed to fetch" ? t("ct.offline", "Couldn't reach the server. Check your connection, or email us directly.") : err.message);
    } finally {
      send.disabled = false; send.textContent = t("ct.send", "Send message");
    }
  });
})();
