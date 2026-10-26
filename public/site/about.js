/* D.EIGHT About page: reveal on scroll, CAD-screen filter, image lightbox, screen recordings that
   play only while on screen (never with reduced motion unless the visitor presses play). */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const t = (k, en) => (window.D8 && D8.t ? D8.t(k, en) : en);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasIO = "IntersectionObserver" in window;

  /* ---------------- WhatsApp links carry a greeting in the page language ---------------- */
  const setWa = () => { if (window.D8 && D8.waLink) document.querySelectorAll(".wa-link").forEach((a) => { a.href = D8.waLink(); }); };
  setWa();
  document.addEventListener("d8:lang", setWa);

  /* ---------------- reveal on scroll + floating chat button ---------------- */
  const fab = $("fab"), cta = $("start");
  let nearTop = true, ctaOn = false;
  const fabState = () => { if (fab) { const off = nearTop || ctaOn; fab.classList.toggle("hide", off); fab.tabIndex = off ? -1 : 0; } };
  if (hasIO) {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    }), { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    if (fab && cta) new IntersectionObserver((entries) => entries.forEach((en) => { ctaOn = en.isIntersecting; fabState(); }), { threshold: 0.2 }).observe(cta);
  } else {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
  }
  const onScroll = () => { nearTop = window.scrollY < window.innerHeight * 0.6; fabState(); };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------------- image buttons are named after their caption ---------------- */
  const zooms = [...document.querySelectorAll(".zoom")];
  const capText = (btn) => {
    const c = btn.closest("figure").querySelector("figcaption");
    return c ? c.textContent.replace(/\s+/g, " ").trim() : "";
  };
  const nameZooms = () => zooms.forEach((b) => b.setAttribute("aria-label", t("mc.open", "View larger") + ": " + capText(b)));
  nameZooms();
  document.addEventListener("d8:lang", nameZooms);

  /* ---------------- CAD screens filter ---------------- */
  const gal = $("gal");
  const fbtns = [...document.querySelectorAll(".filters [data-f]")];
  fbtns.forEach((b) => b.addEventListener("click", () => {
    const f = b.dataset.f;
    fbtns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    gal.querySelectorAll(".shot-card").forEach((fig) => {
      const show = f === "all" || fig.dataset.cat === f;
      if (show && fig.hidden) {
        fig.hidden = false;
        if (!reduce) { fig.classList.remove("fade"); void fig.offsetWidth; fig.classList.add("fade"); }
      } else if (!show) fig.hidden = true;
    });
  }));

  /* ---------------- lightbox ---------------- */
  const lb = $("lb"), lbImg = $("lbImg"), lbCap = $("lbCap"), lbN = $("lbN");
  let list = [], idx = 0, opener = null, padR = "";
  const show = (i) => {
    idx = (i + list.length) % list.length;
    const b = list[idx], img = b.querySelector("img");
    lbImg.width = +img.getAttribute("width"); lbImg.height = +img.getAttribute("height");
    lbImg.src = img.currentSrc || img.src;
    lbImg.alt = capText(b);
    lbCap.textContent = capText(b);
    lbN.textContent = (idx + 1) + " / " + list.length;
    $("lbPrev").hidden = $("lbNext").hidden = list.length < 2;
  };
  const open = (b) => {
    const group = b.closest("[data-lb]");
    list = [...group.querySelectorAll(".zoom")].filter((x) => !x.closest("[hidden]"));
    opener = b;
    show(Math.max(0, list.indexOf(b)));
    // keep the page still behind the viewer (the scrollbar's width is kept so nothing moves)
    const sb = window.innerWidth - document.documentElement.clientWidth;
    padR = document.documentElement.style.paddingRight;
    document.documentElement.style.overflow = "hidden";
    if (sb > 0) document.documentElement.style.paddingRight = sb + "px";
    if (typeof lb.showModal === "function") lb.showModal(); else lb.setAttribute("open", "");
    $("lbX").focus();
  };
  const close = () => { if (typeof lb.close === "function" && lb.open) lb.close(); else lb.removeAttribute("open"); };
  lb.addEventListener("close", () => {
    document.documentElement.style.overflow = "";
    document.documentElement.style.paddingRight = padR;
    lbImg.removeAttribute("src");
    if (opener) opener.focus({ preventScroll: true });
  });
  zooms.forEach((b) => b.addEventListener("click", () => open(b)));
  $("lbX").addEventListener("click", close);
  $("lbPrev").addEventListener("click", () => show(idx - 1));
  $("lbNext").addEventListener("click", () => show(idx + 1));
  lb.addEventListener("click", (e) => { if (e.target === lb || e.target.classList.contains("lb-in")) close(); });
  lb.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); show(idx + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); show(idx - 1); }
  });
  let x0 = null;
  lb.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50 && list.length > 1) show(idx + (dx < 0 ? 1 : -1));
  });

  /* ---------------- screen recordings: always running while on screen, no buttons (owner's choice 2026-10-26) ---------------- */
  // Nothing downloads until a clip is on screen (preload="none"); it rests when scrolled away or the tab is hidden
  // (nobody sees that; it saves data and battery). Paused any other way (browser menu), it starts again.
  // With reduced motion nothing starts by itself: the browser's own controls let the visitor play a clip.
  const clips = [...document.querySelectorAll(".clip video")].map((v) => ({ v, seen: false }));
  const run = (c) => !reduce && c.seen && !document.hidden;
  const sync = (c) => {
    if (run(c)) { if (c.v.paused) c.v.play().catch(() => {}); }
    else if (!reduce && !c.v.paused) c.v.pause();
  };
  clips.forEach((c) => {
    if (reduce) c.v.controls = true;
    c.v.addEventListener("pause", () => { if (run(c)) setTimeout(() => sync(c), 150); });
  });
  document.addEventListener("visibilitychange", () => clips.forEach(sync));
  if (hasIO) {
    const vio = new IntersectionObserver((entries) => entries.forEach((en) => {
      const c = clips.find((x) => x.v === en.target);
      if (c) { c.seen = en.isIntersecting; sync(c); }
    }), { threshold: 0.35 });
    clips.forEach((c) => vio.observe(c.v));
  }
})();
