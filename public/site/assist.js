/* D.EIGHT website assistant (About page): a chat box that answers visitors and takes their details for a quote.
   Answers come from POST /api/assist (Workers AI, or fixed answers when it is off). The details go through
   POST /api/assist/lead, which runs the same checks as the contact form (honeypot, time token, Turnstile, filters).
   Only on pages whose <body> has data-assist. Nothing is kept in the browser. */
(() => {
  "use strict";
  if (!document.body || !document.body.hasAttribute("data-assist")) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const L = (en, vi) => (window.D8 && D8.lang === "vi" ? vi : en);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const SERVICES = [
    ["Implant restorations", "Phục hình implant"], ["All-on-X & bars", "All-on-X và thanh bar"], ["Surgical guides", "Máng phẫu thuật"],
    ["Crown & bridge", "Mão và cầu răng"], ["Wax-up & smile design", "Wax-up và thiết kế nụ cười"], ["Dentures & partials", "Hàm giả và hàm khung"],
    ["Splints & trays", "Máng và khay"], ["Aligner & ortho", "Niềng và khí cụ chỉnh nha"], ["Digital models", "Mẫu hàm số"], ["Something else", "Dịch vụ khác"],
  ];
  const CHIPS = [
    ["What do you design?", "Bên bạn thiết kế những gì?"],
    ["How do I send a case?", "Gửi ca như thế nào?"],
    ["How long does a case take?", "Một ca mất bao lâu?"],
    ["I want you to design for me", "Tôi muốn bên bạn thiết kế cho ca của mình"],
  ];
  const ICON_CHAT = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3.5 4.5h13v9h-7l-3.5 3v-3h-3.5z" stroke-linejoin="round"/></svg>';
  const ICON_X = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

  /* ---------------- markup (built here so the static pages stay small) ---------------- */
  const host = document.createElement("div");
  host.className = "as-host";
  host.innerHTML = `
    <button type="button" class="as-launch" id="asLaunch" aria-expanded="false" aria-controls="asPanel">${ICON_CHAT}<span id="asLaunchTxt"></span></button>
    <section class="as-panel" id="asPanel" role="dialog" aria-modal="false" aria-labelledby="asTitle" hidden>
      <header class="as-head">
        <div><b id="asTitle"></b><small id="asSub"></small></div>
        <button type="button" class="as-x" id="asClose">${ICON_X}</button>
      </header>
      <div class="as-log" id="asLog" aria-live="polite"></div>
      <div class="as-chips" id="asChips"></div>
      <form class="as-form" id="asForm" autocomplete="off">
        <label class="as-sr" for="asInput" id="asInLbl"></label>
        <input class="as-in" id="asInput" maxlength="500">
        <button type="submit" class="as-send" id="asSend"></button>
      </form>
      <div class="as-foot"><button type="button" class="as-link" id="asLeadBtn"></button></div>
    </section>`;
  document.body.appendChild(host);
  const $ = (id) => document.getElementById(id);
  const launch = $("asLaunch"), panel = $("asPanel"), log = $("asLog"), chips = $("asChips"), form = $("asForm"), input = $("asInput"), send = $("asSend");

  const paint = () => {
    $("asLaunchTxt").textContent = L("Ask D.EIGHT", "Hỏi D.EIGHT");
    $("asTitle").textContent = L("D.EIGHT assistant", "Trợ lý D.EIGHT");
    $("asSub").textContent = L("Automatic replies. Our team follows up when you leave your details.", "Trả lời tự động. Nhân viên sẽ liên hệ khi bạn để lại thông tin.");
    $("asClose").setAttribute("aria-label", L("Close", "Đóng"));
    $("asInLbl").textContent = L("Your question", "Câu hỏi của bạn");
    input.placeholder = L("Type your question…", "Nhập câu hỏi…");
    send.textContent = L("Send", "Gửi");
    $("asLeadBtn").textContent = L("Leave your details for a quote", "Để lại thông tin để được báo giá");
    chips.innerHTML = CHIPS.map(([en, vi]) => `<button type="button" class="as-chip">${esc(L(en, vi))}</button>`).join("");
    if (leadEl) leadEl.querySelectorAll("[data-l]").forEach((n) => { n.textContent = L(n.dataset.en, n.dataset.vi); });
  };

  /* ---------------- conversation ---------------- */
  let msgs = [], greeted = false, busy = false, leadEl = null, tokenP = null, tsWidget = null, tsLoad = null;
  const scrollEnd = () => { log.scrollTop = log.scrollHeight; };
  const bubble = (who, text) => {
    const d = document.createElement("div");
    d.className = "as-b " + who;
    d.textContent = text;
    log.appendChild(d);
    if (leadEl) log.appendChild(leadEl);
    scrollEnd();
    return d;
  };
  const typingDots = () => {
    const d = document.createElement("div");
    d.className = "as-b bot as-typing";
    d.setAttribute("role", "status");
    d.setAttribute("aria-label", L("Replying", "Đang trả lời"));
    d.innerHTML = "<i></i><i></i><i></i>";
    log.appendChild(d);
    scrollEnd();
    return d;
  };
  const greeting = () => L(
    "Hi, I'm the D.EIGHT assistant. Ask me about our services, how to send a case or how long a case takes. For a design quote, leave your details and our team will reply.",
    "Xin chào, tôi là trợ lý của D.EIGHT. Bạn có thể hỏi về dịch vụ, cách gửi ca hoặc thời gian thực hiện. Muốn báo giá thiết kế, bạn để lại thông tin và đội ngũ sẽ trả lời.");

  // Call the assistant. Its own message is shown; a design or quote question also offers the details form.
  async function ask(text) {
    text = String(text || "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (!text || busy) return;
    busy = true;
    send.disabled = input.disabled = true;
    bubble("me", text);
    msgs.push({ role: "user", text });
    chips.hidden = true;
    input.value = "";
    const dots = typingDots();
    try {
      const r = await fetch("/api/assist", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs.slice(-12), lang: D8.lang === "vi" ? "vi" : "en" }) });
      const out = await r.json().catch(() => ({}));
      dots.remove();
      if (!r.ok) throw new Error(out.error || L("The assistant can't answer right now. Please try again later.", "Trợ lý chưa trả lời được, bạn thử lại sau nhé."));
      bubble("bot", out.reply);
      msgs.push({ role: "assistant", text: out.reply });
      if (out.lead) showLead();
    } catch (err) {
      dots.remove();
      bubble("bot err", err.message);
    } finally {
      busy = false;
      send.disabled = input.disabled = false;
      if (!coarse) input.focus();
    }
  }

  /* ---------------- details form (same checks as the contact form) ---------------- */
  const getToken = () => (tokenP = tokenP || fetch("/api/contact/token", { cache: "no-store" }).then((r) => r.json()).then((j) => j.token || "").catch(() => ""));
  const loadTs = () => (tsLoad = tsLoad || new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  }));
  function showLead() {
    if (!leadEl) {
      leadEl = document.createElement("form");
      leadEl.className = "as-lead";
      leadEl.innerHTML = `
        <p class="as-lead-h" data-l data-en="Leave your details and our team will reply" data-vi="Để lại thông tin, đội ngũ sẽ trả lời"></p>
        <label><span data-l data-en="Your name" data-vi="Họ tên"></span><input name="name" required maxlength="100" autocomplete="name"></label>
        <label><span data-l data-en="Email" data-vi="Email"></span><input name="email" type="email" required maxlength="160" autocomplete="email"></label>
        <label><span data-l data-en="WhatsApp or phone (optional)" data-vi="WhatsApp hoặc điện thoại (không bắt buộc)"></span><input name="phone" maxlength="40" autocomplete="tel"></label>
        <label><span data-l data-en="Clinic or lab (optional)" data-vi="Phòng khám hoặc labo (không bắt buộc)"></span><input name="practice" maxlength="120" autocomplete="organization"></label>
        <label><span data-l data-en="Service" data-vi="Dịch vụ"></span><select name="service">${SERVICES.map(([en, vi]) => `<option value="${esc(en)}">${esc(L(en, vi))}</option>`).join("")}</select></label>
        <label><span data-l data-en="What do you need?" data-vi="Bạn cần gì?"></span><textarea name="message" rows="3" maxlength="3000" minlength="10" required></textarea></label>
        <input class="as-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="as-ts" hidden></div>
        <p class="as-err" role="alert" hidden></p>
        <button type="submit" class="as-send" data-l data-en="Send to our team" data-vi="Gửi cho đội ngũ"></button>`;
      leadEl.addEventListener("submit", submitLead);
      D8.config().then((cfg) => {
        if (!cfg || !cfg.turnstile || !leadEl) return;
        const box = leadEl.querySelector(".as-ts");
        box.hidden = false;
        loadTs().then(() => {
          if (!leadEl || !window.turnstile) return;
          tsWidget = window.turnstile.render(box, { sitekey: cfg.turnstile, theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
            language: D8.lang === "vi" ? "vi" : "en", action: "assist" });
        }).catch(() => {});
      }).catch(() => {});
    }
    paint();
    log.appendChild(leadEl);
    scrollEnd();
    const first = leadEl.querySelector("input[name=name]");
    if (first && !coarse && !leadEl.dataset.done) first.focus();
  }
  async function submitLead(e) {
    e.preventDefault();
    const err = leadEl.querySelector(".as-err"), btn = leadEl.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(leadEl).entries());
    data.lang = D8.lang === "vi" ? "vi" : "en";
    data.transcript = msgs.slice(-8);
    data.token = await getToken();
    if (tsWidget != null && window.turnstile) data.turnstile = window.turnstile.getResponse(tsWidget) || "";
    btn.disabled = true; err.hidden = true;
    try {
      const r = await fetch("/api/assist/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) {
        const e2 = Object.assign(new Error(out.error || L("We couldn't send this. Please email d.eightdesigncenter@gmail.com.", "Chưa gửi được. Vui lòng email d.eightdesigncenter@gmail.com.")), { code: out.code });
        throw e2;
      }
      leadEl.dataset.done = "1";
      leadEl.innerHTML = `<p class="as-done">${esc(L("Thank you. Our team will reply by email or WhatsApp.", "Cảm ơn bạn. Đội ngũ sẽ trả lời qua email hoặc WhatsApp."))}</p>`;
      bubble("bot", L("Thank you, we have your details. Our team will reply soon.", "Cảm ơn, chúng tôi đã nhận thông tin. Đội ngũ sẽ trả lời sớm."));
      msgs.push({ role: "assistant", text: L("Thank you, we have your details.", "Cảm ơn, chúng tôi đã nhận thông tin.") });
    } catch (x) {
      err.textContent = x.message; err.hidden = false;
      if (x.code === "captcha" && tsWidget != null && window.turnstile) window.turnstile.reset(tsWidget);
      btn.disabled = false;
    }
  }

  /* ---------------- open / close ---------------- */
  function open() {
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add("on"));
    launch.setAttribute("aria-expanded", "true");
    if (!greeted) { greeted = true; bubble("bot", greeting()); }
    getToken();
    if (!coarse) input.focus();
  }
  function close() {
    panel.classList.remove("on");
    launch.setAttribute("aria-expanded", "false");
    setTimeout(() => { if (!panel.classList.contains("on")) panel.hidden = true; }, reduce ? 0 : 220);
    launch.focus();
  }
  launch.addEventListener("click", () => (panel.hidden ? open() : close()));
  $("asClose").addEventListener("click", close);
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });
  chips.addEventListener("click", (e) => { const b = e.target.closest(".as-chip"); if (b) ask(b.textContent); });
  $("asLeadBtn").addEventListener("click", () => {
    if (!greeted) open();
    showLead();
    if (leadEl && leadEl.dataset.done) leadEl.scrollIntoView({ block: "nearest" });
  });
  document.addEventListener("d8:lang", paint);
  paint();
})();
