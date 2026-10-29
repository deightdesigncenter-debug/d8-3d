/* D.EIGHT customer portal: sign in with Google, send cases, follow status, approve, message, download. */
(() => {
  "use strict";
  const view = document.getElementById("view");
  const T = (k) => D8.t(k);
  const esc = (s) => D8.esc(s);
  const ID_RE = /^D8-[0-9]{6}-[A-Z2-9]{4}$/;
  const STEPS = ["received", "in_design", "review", "approved", "delivered"];
  const SERVICES = D8.SERVICES;
  const CLIENT_UPLOAD = ["received", "needs_info", "in_design", "review"];
  const CLIENT_DELETE = ["received", "needs_info"];
  const ICON = {
    check: '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 9.5l4 4 8-9"/></svg>',
    back: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
    cube: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7L12 2.5Z"/><path d="M3.5 7 12 11.5 20.5 7M12 11.5v10"/></svg>',
    dl: '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 2.5v9M5 8l4 4 4-4M3 15.5h12"/></svg>',
    trash: '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 5h12M7 5V3.5h4V5M5 5l.8 10h6.4L13 5"/></svg>',
    up: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg>',
    warn: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M10 2.5 18 17H2L10 2.5Z"/><path d="M10 8v4M10 14.5v.5"/></svg>',
    spark: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6L10 2.5Z"/><path d="M15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/></svg>',
    cam: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 6.5h3l1.5-2h5l1.5 2h3v9.5H3z"/><circle cx="10" cy="11" r="3"/></svg>',
    info: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M10 9v5M10 6v.5"/></svg>',
    card: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="4.5" width="16" height="11" rx="2"/><path d="M2 8.5h16M5 12.5h3"/></svg>',
    wallet: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 6.5A2 2 0 0 1 5 4.5h9.5v2"/><rect x="3" y="6.5" width="14" height="9.5" rx="2"/><path d="M13 11.25h1.5"/></svg>',
    lock: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
  };
  const money = (n) => "US$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let payCfg = {};             // which payment providers are switched on (from /api/config)
  // Back from PayPal or Stripe: /portal?pay=paypal|stripe|cancel&case=<id>
  let payBack = null;
  {
    const q = new URLSearchParams(location.search), id = q.get("case") || "";
    if (q.get("pay") && ID_RE.test(id)) { payBack = { via: q.get("pay"), id }; history.replaceState(null, "", location.pathname + "#/case/" + id); }
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const svcLabel = D8.svcLabel;
  const stChip = (s) => `<span class="st st-${esc(s)}">${esc(D8.statusLabel(s))}</span>`;

  let user = null;
  let filter = "all", query = "";
  let caseCount = null;        // number of cases this customer has sent (for the free-trial banner)
  const GIFT = '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2.5" y="7" width="13" height="8.5" rx="1"/><path d="M1.5 4.5h15V7h-15zM9 4.5v11M9 4.5C8 2 5.5 1.8 5.3 3.3 5.1 4.6 7.4 4.5 9 4.5Zm0 0c1-2.5 3.5-2.7 3.7-1.2.2 1.3-2.1 1.2-3.7 1.2Z"/></svg>';
  const trialBanner = () => `<div class="pt-trial">${GIFT}<div>${T("p.trial")}</div></div>`;
  let current = null;          // case currently shown
  let draft = freshDraft();    // new-case form state (survives language switches)
  let busy = false;
  const recent = new Map();    // cases created in this tab (the KV list can lag by up to a minute)

  function freshDraft() { return { title: "", service: "", teeth: "", numbering: "FDI", material: "", shade: "", neededBy: "", notes: "", links: [""], files: [], rx: {} }; }

  /* ------------------------------------------------------------ chrome */
  function band(inner) { return `<section class="pt-band"><div class="wrap">${inner}</div></section>`; }
  let animKey = null; // fade new screens in once per route, not on every refresh
  function page(bandHtml, body, isLoading) {
    view.innerHTML = bandHtml + `<div class="pt-main"><div class="wrap">${body}</div></div>`;
    D8.markSub && D8.markSub();
    const key = location.hash || "#/";
    if (!isLoading && key !== animKey) { animKey = key; D8.animIn(view.querySelector(".pt-main")); }
  }
  function loading(kind) {
    const body = kind === "case" ? D8.skel.page() : kind === "form" ? D8.skel.form() : D8.skel.rows(3);
    page(band(`<div><span class="eyebrow">${esc(T("p.eyebrow"))}</span><span class="sk sk-line h28" style="margin:14px 0 0;width:min(420px,70vw);height:40px"></span><span class="sk sk-line" style="margin:12px 0 0;width:min(300px,55vw);height:30px"></span></div>`), body, true);
  }
  function failed(msg) {
    page(band(`<div><span class="eyebrow">${esc(T("p.eyebrow"))}</span><h1>${esc(T("p.list.h"))}</h1></div>`),
      `<div class="pt-empty"><h2 class="h-caps">${esc(msg || T("p.err.load"))}</h2><p></p><button class="btn btn-primary" type="button" id="retry">${esc(T("p.retry"))}</button></div>`);
    document.getElementById("retry").onclick = route;
  }

  /* ------------------------------------------------------------ router */
  function route() {
    if (busy) return;
    if (!user) return renderSignIn();
    const h = location.hash || "#/";
    let m;
    window.scrollTo(0, 0);
    if (h === "#/new") return renderNew();
    if (h === "#/profile") return renderProfile();
    const fm = h.match(/^#\/\?f=(all|active|review|done)$/);
    if (fm) filter = fm[1];
    if ((m = h.match(/^#\/case\/([^/]+)$/)) && ID_RE.test(m[1])) return renderCase(m[1]);
    return renderList();
  }
  window.addEventListener("hashchange", () => { stopPoll(); route(); });
  document.addEventListener("d8:lang", () => { if (!busy) rerender(); });
  let booted = false;
  D8.ready.then((u) => { booted = true; user = u; route(); });
  document.addEventListener("d8:user", (e) => { if (!booted) return; const was = user; user = e.detail; if (!!was !== !!user) route(); });

  function rerender() {
    const h = location.hash || "#/";
    if (current && h === "#/case/" + current.id) return drawCase(current);
    route();
  }

  /* ------------------------------------------------------------ sign in */
  function renderSignIn() {
    page(band(`<div><span class="eyebrow">${esc(T("p.eyebrow"))}</span><h1>${esc(T("p.si.title"))}</h1></div>`), `
      <section class="pt-signin">
        <div class="pt-signin-art">
          <span class="eyebrow" style="color:var(--steel)">${esc(T("p.eyebrow"))}</span>
          <h1>${esc(T("p.si.h"))}</h1>
          <p class="serif" lang="en">${esc(T("p.si.serif"))}</p>
          <ul>${["p.si.l1", "p.si.l2", "p.si.l3", "p.si.l4"].map((k) => `<li>${ICON.check}<span>${esc(T(k))}</span></li>`).join("")}</ul>
          <img class="mark" src="/brand/symbol-reversed.svg" alt="">
        </div>
        <div class="pt-signin-card">
          <h2 class="h-caps">${esc(T("p.si.title"))}</h2>
          <p class="muted" style="margin:10px 0 0;line-height:1.7">${esc(T("p.si.p"))}</p>
          <div class="pt-gbtn" id="gbtn"></div>
          <p class="hint">${esc(T("p.si.new"))}</p>
          <p class="pt-fine">${T("p.si.fine")}</p>
          <div class="pt-or">${esc(T("p.si.or"))}</div>
          <p style="margin:14px 0 0;display:flex;gap:10px;flex-wrap:wrap"><a class="btn small" href="/#contact">${esc(T("p.si.contact"))}</a>
            <a class="btn small" href="${esc(D8.waLink())}" target="_blank" rel="noopener">${D8.ICON_CHAT.replace("<svg ", '<svg width="16" height="16" ')}WhatsApp · Danny Do</a></p>
          <div class="pt-trial" style="margin:22px 0 0">${GIFT}<div>${T("p.trial")}</div></div>
        </div>
      </section>`);
    const el = document.getElementById("gbtn");
    D8.renderGoogleButton(el, null, { width: Math.min(320, el.clientWidth || 320), text: "continue_with" });
  }

  /* ------------------------------------------------------------ list */
  async function renderList() {
    current = null;
    loading();
    let items;
    try { items = (await D8.api("/api/my/jobs")).items || []; }
    catch (err) { if (err.status === 401) { user = null; return renderSignIn(); } return failed(err.message); }
    caseCount = items.length;
    const known = new Set(items.map((x) => x.id));
    for (const [id, j] of recent) if (!known.has(id)) items.unshift(j); else recent.delete(id);
    drawList(items);
  }

  function drawList(items) {
    const seen = store.get("d8-seen", {});
    const first = String(user.greet || user.name || user.email).slice(0, 48);
    const counts = {
      all: items.length,
      active: items.filter((x) => ["received", "needs_info", "in_design", "approved"].includes(x.status)).length,
      review: items.filter((x) => x.status === "review").length,
      done: items.filter((x) => x.status === "delivered").length,
    };
    const match = (x) => (filter === "all" || (filter === "active" && ["received", "needs_info", "in_design", "approved"].includes(x.status)) ||
      (filter === "review" && x.status === "review") || (filter === "done" && x.status === "delivered")) &&
      (!query || (x.id + " " + x.title).toLowerCase().includes(query.toLowerCase()));
    const shown = items.filter(match);
    // what needs the customer (the bell, and a red dot on the case)
    const needs = (x) => x.status === "review" || x.status === "needs_info" || x.pay === "due" || (x.lastBy === "admin" && (seen[x.id] || 0) < x.updated);
    const nCount = (f) => items.filter(f).length;
    D8.notify.set("cases", [
      { key: "review", n: nCount((x) => x.status === "review"), text: T("nt.review"), href: "#/?f=review" },
      { key: "info", n: nCount((x) => x.status === "needs_info"), text: T("nt.info"), href: "#/?f=active" },
      { key: "due", n: nCount((x) => x.pay === "due"), text: T("nt.due"), href: "#/?f=all" },
      { key: "reply", n: nCount((x) => x.lastBy === "admin" && (seen[x.id] || 0) < x.updated), text: T("nt.reply"), href: "#/?f=all" },
    ]);
    const rows = shown.map((x) => {
      const fresh = x.lastBy === "admin" && (seen[x.id] || 0) < x.updated;
      return `<a class="pt-row${needs(x) ? " need" : ""}" href="#/case/${esc(x.id)}">
        <div>${needs(x) ? '<span class="attn-dot" aria-hidden="true"></span>' : ""}<span class="id">${esc(x.order || x.id)}</span><span class="ttl">${esc(x.title)}</span></div>
        <span class="meta">${esc(T("p.sent").replace("{d}", D8.fmtDate(x.created)))} · ${esc(T("p.updated").replace("{t}", D8.ago(x.updated)))}</span>
        <span class="right">${stChip(x.status)}${x.trial ? `<span class="badge-trial">${esc(T("bill.trial"))}</span>` : ""}${x.pay === "due" ? `<span class="pay pay-due">${esc(T("bill.due"))}</span>` : x.pay === "check" ? `<span class="pay pay-check">${esc(T("bill.check"))}</span>` : ""}${fresh ? `<span class="new">${esc(T("p.newreply"))}</span>` : ""}</span></a>`;
    }).join("");
    const empty = !items.length
      ? `<div class="pt-empty"><img src="/brand/symbol.svg" alt=""><h2 class="h-caps">${esc(T("p.empty.h"))}</h2><p>${esc(T("p.empty.p"))}</p>
         <a class="btn btn-primary cta-shine" href="#/new">${ICON.plus}${esc(T("p.new"))}</a></div>`
      : `<div class="pt-empty"><p style="margin:0">${esc(T("p.nomatch"))}</p></div>`;
    page(band(`<div><span class="eyebrow">${esc(T("p.eyebrow"))}</span><h1>${esc(T("p.list.h"))}</h1><p class="serif">${esc(T("p.list.hi").replace("{name}", first))}</p></div>
      <a class="btn btn-cream" href="#/new">${ICON.plus}${esc(T("p.new"))}</a>`), `
      ${items.length < 2 ? trialBanner() : ""}
      ${items.length ? `<div class="pt-tools"><div class="pt-filters" role="group" aria-label="Filter">${["all", "active", "review", "done"].map((f) =>
        `<button type="button" data-f="${f}" aria-pressed="${filter === f}">${esc(T("p.f." + f))}<b>${counts[f]}</b></button>`).join("")}</div>
        <input class="input pt-search" type="search" id="q" value="${esc(query)}" placeholder="${esc(T("p.search"))}" aria-label="${esc(T("p.search"))}"></div>` : ""}
      <div class="pt-list">${shown.length ? rows : empty}</div>`);
    view.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; drawList(items); }));
    const q = document.getElementById("q");
    if (q) q.addEventListener("input", () => { query = q.value; const pos = q.selectionStart; drawList(items); const n = document.getElementById("q"); n.focus(); n.setSelectionRange(pos, pos); });
  }

  /* ------------------------------------------------------------ case */
  let pollT = null;
  function stopPoll() { clearInterval(pollT); pollT = null; }
  async function renderCase(id) {
    stopPoll();
    if (!current || current.id !== id) { current = null; loading("case"); }
    try { [current] = await Promise.all([D8.api("/api/jobs/" + id).then((r) => r.job), D8.config().then((c) => { payCfg = (c && c.pay) || {}; })]); }
    catch (err) {
      if (err.status === 401) { user = null; return renderSignIn(); }
      return failed(err.status === 404 ? T("p.err.nf") : err.message);
    }
    drawCase(current);
    pollT = setInterval(refreshCase, 60000);
    if (payBack && payBack.id === id) {
      const pb = payBack; payBack = null;
      if (pb.via === "cancel") D8.toast(T("pay.cancel"));
      else checkPay(true);
    } else if (current.pay === "due" && current.payOpen) checkPay(false);
  }
  // Ask the server to check with PayPal / Stripe (the server never trusts the return URL alone).
  async function checkPay(loud) {
    const id = current && current.id;
    if (!id) return;
    try {
      const out = await D8.api(`/api/jobs/${id}/pay/check`, { method: "POST" });
      if (!current || current.id !== id) return;
      if (out.job.updated !== current.updated || out.job.pay !== current.pay || out.job.payHeld !== current.payHeld) { current = out.job; drawCase(current); }
      if (loud) D8.toast(T(out.paid ? "pay.ok" : out.sent ? "pay.sent" : out.job.payHeld ? "pay.held" : "pay.wait"));
    } catch (err) { if (loud) D8.toast(err.message); }
  }
  async function refreshCase() {
    if (document.hidden || !current || busy) return;
    const box = document.getElementById("composer");
    if ((box && box.value.trim()) || document.querySelector("#addList li")) return; // don't redraw while the customer is typing or picking files
    try {
      const j = (await D8.api("/api/jobs/" + current.id)).job;
      if (j.updated !== current.updated) { current = j; drawCase(j); }
    } catch {}
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && pollT) refreshCase(); });

  function markSeen(j) { const s = store.get("d8-seen", {}); s[j.id] = j.updated; const keys = Object.keys(s); if (keys.length > 300) delete s[keys[0]]; store.set("d8-seen", s); }

  function drawCase(j) {
    markSeen(j);
    const st = j.status;
    const idx = st === "needs_info" ? 0 : STEPS.indexOf(st);
    const steps = STEPS.map((s, i) => {
      const cls = st === "cancelled" ? "" : i < idx || (i === idx && s === "delivered") ? "done" : i === idx ? "cur" : "";
      return `<li class="${cls}"><span class="dot">${cls === "done" ? ICON.check.replace('width="16" height="16"', 'width="12" height="12"') : ""}</span><span class="lbl">${esc(D8.statusLabel(s))}</span></li>`;
    }).join("");
    const alerts = [];
    if (st === "needs_info") alerts.push(`<div class="pt-alert warn">${ICON.warn}<div>${esc(T("p.c.needs"))}</div></div>`);
    if (st === "cancelled") alerts.push(`<div class="pt-alert mute">${ICON.info}<div>${esc(T("p.c.cancelled"))}</div></div>`);
    if (st === "delivered") alerts.push(`<div class="pt-alert ok">${ICON.check}<div>${esc(T("p.c.delivered"))}</div></div>`);
    if (st === "approved") alerts.push(`<div class="pt-alert ok">${ICON.check}<div>${esc(T("p.c.approvedOn").replace("{d}", D8.fmtDate(j.approvedAt || j.updated, true)))}</div></div>`);

    const previews = (j.previews || []).map((p) => `<div class="pv"><span class="ic">${ICON.cube}</span><div class="tx"><b>${esc(p.label || j.title)}</b>
      <small>${esc(T("p.pv.exp").replace("{d}", D8.fmtDate(p.expires)))}</small></div>
      <a class="btn btn-primary small" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(T("p.pv.open"))}</a></div>`).join("");
    const rv = j.rev || { free: 2, used: 0 }, revLeft = Math.max(0, rv.free - rv.used);
    const revLine = `<p class="rev-left">${esc(revLeft ? T("p.ap.rev").replace("{l}", revLeft).replace("{n}", rv.free) : T("p.ap.rev0"))}</p>`;
    const approveBox = st === "review" ? `<div class="approve"><p>${T("p.ap.p")}</p>${revLine}<div class="btns">
      <button class="btn small" type="button" id="askChanges">${esc(T("p.ap.change"))}</button>
      <button class="btn btn-ok small" type="button" id="approve">${ICON.check}${esc(T("p.ap.ok"))}</button></div></div>` : "";

    const files = j.files || [];
    const outs = files.filter((f) => f.kind === "output"), ins = files.filter((f) => f.kind !== "output");
    const fileRow = (f) => {
      const ext = (f.name.split(".").pop() || "").slice(0, 4);
      const canDel = f.kind !== "output" && CLIENT_DELETE.includes(st);
      return `<li class="${f.kind === "output" ? "out" : ""}"><span class="ext">${esc(ext)}</span><div class="nm"><b title="${esc(f.name)}">${esc(f.name)}</b>
        <small>${esc(D8.size(f.size))} · ${esc(D8.fmtDate(f.at))} · ${esc(f.exp ? T("p.fl.exp").replace("{d}", D8.fmtDate(f.exp)) : T("p.fl.keep"))}</small></div>
        <a class="iconbtn" href="/api/jobs/${esc(j.id)}/files/${esc(f.fid)}" download="${esc(f.name)}" aria-label="${esc(T("p.fl.dl"))} ${esc(f.name)}" title="${esc(T("p.fl.dl"))}">${ICON.dl}</a>
        ${canDel ? `<button class="iconbtn del" type="button" data-del="${esc(f.fid)}" aria-label="${esc(T("p.fl.del"))} ${esc(f.name)}" title="${esc(T("p.fl.del"))}">${ICON.trash}</button>` : ""}</li>`;
    };
    const canUpload = CLIENT_UPLOAD.includes(st);

    const readLang = D8.lang === "vi" ? "vi" : "en";
    const thread = D8.threadHtml(j, "client", readLang);

    const det = [
      ["p.dt.service", svcLabel(j.service)], ["p.dt.teeth", j.teeth ? j.teeth + " (" + (j.numbering === "UNS" ? "Universal" : "FDI") + ")" : ""],
      ["p.dt.material", j.material], ["p.dt.shade", j.shade], ["p.dt.needed", j.neededBy ? D8.fmtDate(Date.parse(j.neededBy + "T12:00:00")) : ""],
      ...(j.order ? [["p.dt.order", j.order]] : []),
      ["p.dt.sent", D8.fmtDate(j.created, true)],
      ["p.dt.rev", T("p.dt.revv").replace("{u}", rv.used).replace("{n}", rv.free)],
    ].filter((r) => r[1]).map(([k, v]) => [T(k), v]).concat(D8.rxRows(j.rx))
      .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
    // Customers never see a price list or the case price, only a free trial or the amount they are asked to pay.
    const paidLine = j.pay === "paid" && j.paid ? T("pay.paidline").replace("{amt}", money(j.paid.amount)).replace("{via}", D8.t("pay.via." + j.paid.via, j.paid.via)).replace("{d}", D8.fmtDate(j.paid.at)) : "";
    const bill = j.trial || ["due", "check", "paid"].includes(j.pay)
      ? `<div><dt>${esc(T("bill.pay"))}</dt><dd>${j.trial && !["due", "check", "paid"].includes(j.pay) ? `<span class="badge-trial">${esc(T("bill.trial"))}</span>` : ""}${
          j.pay === "due" || j.pay === "check" ? `<span class="pay pay-${j.pay}">${esc(T("bill." + j.pay))}</span>${typeof j.amount === "number" ? " " + esc(money(j.amount)) : ""}` : ""}${
          j.pay === "paid" ? `<span class="pay pay-paid">${esc(T("bill.paid"))}</span>${paidLine ? `<small class="paid-line">${esc(paidLine)}</small>` : ""}` : ""}</dd></div>` : "";
    let payBox = "";
    if (j.pay === "due") {
      const btns = [];
      if (payCfg.paypal) btns.push(`<button class="btn btn-primary cta-shine" type="button" data-pay="paypal">${ICON.wallet}${esc(T("pay.pp"))}</button>`);
      if (payCfg.stripe) btns.push(`<button class="btn${payCfg.paypal ? "" : " btn-primary cta-shine"}" type="button" data-pay="stripe">${ICON.card}${esc(T("pay.card"))}</button>`);
      const amt = typeof j.amount === "number" && j.amount > 0;
      payBox = `<section class="pay-card" aria-labelledby="payH">
        <div class="pay-amt"><span class="eyebrow" id="payH">${esc(T("pay.due.h"))}</span><b>${esc(amt ? money(j.amount) : T("pay.tbd"))}</b><small>${esc(T("pay.for").replace("{id}", j.id))}</small></div>
        <div class="pay-act">${amt && btns.length
          ? `<div class="btns">${btns.join("")}</div><p class="hint">${ICON.lock}<span>${esc(T("pay.safe"))}</span></p>`
          : `<p class="hint">${esc(T("pay.none"))} <a href="${esc(D8.waLink(T("pay.wamsg").replace("{id}", j.id)))}" target="_blank" rel="noopener">WhatsApp · Danny Do</a></p>`}
          ${j.payHeld ? `<p class="hint">${esc(T("pay.held"))}</p>` : ""}
          ${amt ? `<details class="pay-other"><summary>${esc(T("pay.other"))}</summary>
            <form id="claimForm"><label class="field-label" for="claimNote">${esc(T("pay.other.l"))}</label>
              <input class="input" id="claimNote" maxlength="300" placeholder="${esc(T("pay.other.ph"))}">
              <button class="btn small" type="submit" id="claimBtn">${esc(T("pay.other.b"))}</button></form></details>` : ""}</div></section>`;
    } else if (j.pay === "check") {
      payBox = `<section class="pay-card pay-card-check" aria-labelledby="payH">
        <div class="pay-amt"><span class="eyebrow" id="payH">${esc(T("pay.check.h"))}</span><b>${esc(typeof j.amount === "number" ? money(j.amount) : "")}</b><small>${esc(T("pay.for").replace("{id}", j.id))}</small></div>
        <div class="pay-act"><p class="hint">${esc(T("pay.check.p"))}</p></div></section>`;
    }

    page(band(`<div><a class="pt-back" href="#/">${ICON.back}${esc(T("p.back"))}</a>
        <h1>${esc(j.title)}</h1><p class="muted" style="margin:8px 0 0;color:var(--on-brand-2)">${esc(j.order ? T("p.order").replace("{c}", j.order) : j.id)} · ${esc(T("p.c.sent").replace("{d}", D8.fmtDate(j.created)))}</p></div>
        <div>${stChip(st)}</div>`), `
      <ol class="pt-steps" aria-label="Progress">${steps}</ol>
      ${alerts.join("")}${payBox}
      <div class="pt-grid">
        <div>
          <section class="card" aria-labelledby="pvH">
            <h2 class="h-caps" id="pvH">${esc(T("p.pv.h"))}</h2>
            ${previews ? "" : `<p class="sub">${esc(T("p.pv.none"))}</p>`}
            ${previews}${approveBox}
          </section>
          <section class="card" aria-labelledby="flH">
            <div class="card-head-row"><h2 class="h-caps" id="flH">${esc(T("p.fl.h"))}</h2>
              ${files.length > 1 ? `<button class="btn small" type="button" id="zipAll">${ICON.dl}${esc(T("zip.btn"))}</button>` : ""}</div>
            ${outs.length ? `<p class="grp">${esc(T("p.fl.out"))}</p><ul class="files">${outs.map(fileRow).join("")}</ul>` : ""}
            <p class="grp">${esc(T("p.fl.in"))}</p>
            ${ins.length ? `<ul class="files">${ins.map(fileRow).join("")}</ul>` : `<p class="muted" style="margin:0 0 6px">${esc(T("p.fl.none"))}</p>`}
            ${canUpload ? `<div style="margin-top:16px">${dropZone("addFiles")}<ul class="picked" id="addList"></ul>
              <div class="progress block" id="addProg" hidden><div class="progress-bar"><i></i></div><p></p></div>
              <p class="error" id="addErr" hidden></p>
              <div style="margin-top:12px" id="addBtnWrap" hidden><button class="btn btn-primary small" type="button" id="addBtn"></button></div></div>`
              : `<p class="hint">${esc(T("p.fl.closed"))}</p>`}
          </section>
          <section class="card" aria-labelledby="msH" id="messages">
            <h2 class="h-caps" id="msH">${esc(T("p.ms.h"))}</h2>
            <p class="sub"><a href="${esc(D8.waLink(T("p.ms.wamsg").replace("{id}", j.id)))}" target="_blank" rel="noopener">${esc(T("p.ms.wa"))}</a></p>
            <div class="thread-tools"><label class="tr-auto" hidden><input type="checkbox" data-tr-auto> ${esc(T("tr.auto"))}</label><button type="button" data-tr-all hidden>${esc(T("tr.all"))}</button></div>
            <div class="thread" id="thread">${thread || `<p class="muted" style="margin:0">${esc(T("p.ms.none"))}</p>`}</div>
            <form class="compose" id="composeForm">
              <label class="sr-only" for="composer">${esc(T("p.ms.ph"))}</label>
              <textarea class="input" id="composer" maxlength="4000" placeholder="${esc(T("p.ms.ph"))}"></textarea>
              <div class="compose-foot"><p class="hint">${esc(T("p.ms.hint"))}</p><button class="btn btn-primary small" type="submit" id="sendMsg">${esc(T("p.ms.send"))}</button></div>
              <p class="error" id="msgErr" hidden></p>
            </form>
          </section>
        </div>
        <aside>
          <section class="card" aria-labelledby="dtH">
            <h2 class="h-caps" id="dtH" style="margin-bottom:16px">${esc(T("p.dt.h"))}</h2>
            <dl class="dl">${det}${bill}</dl>
            ${j.notes ? `<p class="grp" style="margin-top:20px">${esc(T("p.dt.notes"))}</p><p class="notes">${esc(j.notes)}</p>` : ""}
            ${(j.links || []).length ? `<p class="grp" style="margin-top:20px">${esc(T("p.dt.links"))}</p><div class="links">${j.links.map((l) => `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer">${esc(l)}</a>`).join("")}</div>` : ""}
          </section>
        </aside>
      </div>`);

    const th = document.getElementById("thread");
    th.scrollTop = th.scrollHeight;
    D8.wireThread(th, j, readLang);
    wireCase(j);
  }

  function dropZone(id) {
    return `<label class="drop compact" id="${id}Zone">${ICON.up}<strong>${esc(T("p.drop.t"))}</strong><span>${esc(T("p.drop.s"))}</span><span>${esc(T("p.drop.dicom"))}</span>
      <input type="file" id="${id}" multiple></label>`;
  }
  function wireDrop(id, onFiles) {
    const zone = document.getElementById(id + "Zone"), input = document.getElementById(id);
    if (!zone) return;
    input.addEventListener("change", () => { onFiles([...input.files]); input.value = ""; });
    ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("over"); }));
    zone.addEventListener("drop", (e) => onFiles([...(e.dataTransfer.files || [])]));
  }
  function pickedList(el, files, onRemove) {
    return D8.renderPicked(el, files, onRemove, { removeLabel: T("p.fl.del") });
  }
  const sameFile = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

  function wireCase(j) {
    const zip = document.getElementById("zipAll");
    if (zip) zip.addEventListener("click", async () => {
      zip.disabled = true;
      try {
        await D8.downloadZip((j.files || []).map((f) => ({ name: f.name, url: `/api/jobs/${j.id}/files/${f.fid}` })), j.id + ".zip",
          (i, n) => { zip.textContent = T("zip.busy").replace("{i}", i).replace("{n}", n); });
      } catch (err) { D8.toast(err.message); }
      zip.disabled = false; zip.innerHTML = ICON.dl + esc(T("zip.btn"));
    });
    // pay: the server creates the PayPal order / Stripe Checkout session and we go there
    view.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", async () => {
      const all = view.querySelectorAll("[data-pay]");
      all.forEach((x) => { x.disabled = true; });
      D8.busy(b, true);
      try {
        const out = await D8.api(`/api/jobs/${j.id}/pay`, { method: "POST", body: { via: b.dataset.pay } });
        if (out.url) { location.href = out.url; return; }
        if (out.job) { current = out.job; drawCase(current); D8.toast(T(out.paid ? "pay.ok" : "pay.sent")); }
      } catch (err) { D8.busy(b, false); all.forEach((x) => { x.disabled = false; }); D8.toast(err.message); }
    }));
    // paid another way (bank transfer, Payoneer): tell D.EIGHT, who confirms when the money arrives
    const cf = document.getElementById("claimForm");
    if (cf) cf.addEventListener("submit", async (e) => {
      e.preventDefault();
      const note = document.getElementById("claimNote").value.trim();
      if (note.length < 3) return document.getElementById("claimNote").focus();
      const b = document.getElementById("claimBtn"); D8.busy(b, true);
      try { current = (await D8.api(`/api/jobs/${j.id}/pay/claim`, { method: "POST", body: { note } })).job; drawCase(current); D8.toast(T("pay.sent")); }
      catch (err) { D8.busy(b, false); D8.toast(err.message); }
    });
    // approve (two-step, no browser dialog)
    const ap = document.getElementById("approve");
    if (ap) {
      let armed = false, t;
      ap.addEventListener("click", async () => {
        if (!armed) { armed = true; ap.textContent = T("p.ap.sure"); t = setTimeout(() => { armed = false; ap.innerHTML = ICON.check + esc(T("p.ap.ok")); }, 4000); return; }
        clearTimeout(t); D8.busy(ap, true);
        try { current = (await D8.api(`/api/jobs/${j.id}/approve`, { method: "POST" })).job; D8.toast(T("p.ap.done")); drawCase(current); }
        catch (err) { D8.busy(ap, false); D8.toast(err.message); }
      });
      document.getElementById("askChanges").addEventListener("click", () => {
        const c = document.getElementById("composer");
        c.placeholder = T("p.ms.phc");
        c.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => c.focus(), 300);
      });
    }
    // delete own files (two-step)
    view.querySelectorAll("[data-del]").forEach((b) => {
      let armed = false;
      b.addEventListener("click", async () => {
        if (!armed) { armed = true; b.classList.add("armed"); b.title = T("p.fl.delsure"); setTimeout(() => { armed = false; b.classList.remove("armed"); b.title = T("p.fl.del"); }, 4000); return; }
        b.disabled = true;
        try { current = (await D8.api(`/api/jobs/${j.id}/files/${b.dataset.del}`, { method: "DELETE" })).job; drawCase(current); }
        catch (err) { b.disabled = false; D8.toast(err.message); }
      });
    });
    // add files
    let adding = [];
    const list = document.getElementById("addList"), wrap = document.getElementById("addBtnWrap"), btn = document.getElementById("addBtn");
    const redraw = () => {
      if (!list) return;
      pickedList(list, adding, (i) => { adding.splice(i, 1); redraw(); });
      wrap.hidden = !adding.length;
      btn.textContent = T("p.fl.upload").replace("{n}", adding.length);
    };
    wireDrop("addFiles", (fs) => { fs.forEach((f) => { if (!adding.some((x) => sameFile(x, f))) adding.push(f); }); redraw(); });
    if (btn) btn.addEventListener("click", async () => {
      const prog = document.getElementById("addProg"), err = document.getElementById("addErr");
      err.hidden = true; prog.hidden = false; D8.busy(btn, true); busy = true;
      try {
        const out = await D8.uploadJobFiles(j.id, adding, { onProgress: (p) => { prog.querySelector("i").style.width = p.pct + "%"; prog.querySelector("p").textContent = p.text; } });
        busy = false; current = out.job; drawCase(current);
      } catch (e) {
        busy = false; D8.busy(btn, false); prog.hidden = true; err.textContent = e.message; err.hidden = false;
      }
    });
    // messages
    const form = document.getElementById("composeForm"), box = document.getElementById("composer"), send = document.getElementById("sendMsg");
    box.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = box.value.trim();
      if (!text) return box.focus();
      const err = document.getElementById("msgErr");
      err.hidden = true; D8.busy(send, true);
      try {
        current = (await D8.api(`/api/jobs/${j.id}/messages`, { method: "POST", body: { text } })).job;
        drawCase(current);
        const c = document.getElementById("composer"); c && c.focus();
        D8.done(document.getElementById("sendMsg"), T("p.ms.sent"));
      } catch (ex) { D8.busy(send, false); err.textContent = ex.message; err.hidden = false; }
    });
  }

  /* ------------------------------------------------------------ new case */
  function renderNew() {
    current = null;
    const d = draft;
    const opt = (v) => `<option value="${esc(v)}"${d.service === v ? " selected" : ""}>${esc(svcLabel(v))}</option>`;
    page(band(`<div><a class="pt-back" href="#/">${ICON.back}${esc(T("p.back"))}</a><h1>${esc(T("p.nf.h"))}</h1><p class="serif">${esc(T("p.nf.serif"))}</p></div>`), `
      <div id="trialSlot">${caseCount !== null && caseCount < 2 ? trialBanner() : ""}</div>
      <form class="form-grid" id="newForm" novalidate>
        <div class="card">
          <details class="ai-box" id="aiBox" hidden${d.aiOpen ? " open" : ""}>
            <summary>${ICON.spark}<span>${esc(T("ai.rx.h"))}</span><span class="tag">AI</span></summary>
            <div class="in">
              <p class="hint" style="margin:0">${esc(T("ai.rx.p"))}</p>
              <label class="sr-only" for="aiText">${esc(T("ai.rx.h"))}</label>
              <textarea class="input" id="aiText" maxlength="4000" placeholder="${esc(T("ai.rx.ph"))}">${esc(d.aiText || "")}</textarea>
              <div class="ai-row">
                <label class="btn small" for="aiPhoto">${ICON.cam}${esc(T("ai.rx.photo"))}</label>
                <input type="file" id="aiPhoto" accept="image/*" capture="environment" hidden>
                <span class="nm" id="aiPhotoName">${esc(d.aiPhoto ? d.aiPhoto.name : "")}</span>
                <button class="btn btn-primary small" type="button" id="aiRead">${esc(T("ai.rx.read"))}</button>
              </div>
              ${d.aiDone ? `<p class="ai-ok">${esc(T("ai.rx.done").replace("{n}", d.aiDone))}</p>` : ""}
              <p class="error" id="aiErr" hidden></p>
            </div>
          </details>
          <fieldset class="fs"><legend><span class="n">1</span><span class="h-caps">${T("p.nf.s1")}</span></legend>
            <div class="row2">
              <div class="full"><label class="field-label" for="nService">${esc(T("p.nf.service"))}</label>
                <select class="input" id="nService" data-k="service"><option value="">${esc(T("p.nf.choose"))}</option>${SERVICES.map(opt).join("")}</select></div>
              <div class="full row2" id="rxBox" style="gap:18px 16px"></div>
              <div><label class="field-label" for="nTeeth">${esc(T("p.nf.teeth"))}</label>
                <input class="input" id="nTeeth" data-k="teeth" maxlength="120" value="${esc(d.teeth)}" placeholder="${esc(T("p.nf.teethph"))}"></div>
              <div><span class="field-label" id="numL">${esc(T("p.nf.num"))}</span>
                <div class="seg" role="radiogroup" aria-labelledby="numL">
                  <label><input type="radio" name="numbering" value="FDI"${d.numbering !== "UNS" ? " checked" : ""}><span>FDI</span></label>
                  <label><input type="radio" name="numbering" value="UNS"${d.numbering === "UNS" ? " checked" : ""}><span>Universal</span></label></div></div>
              <div><label class="field-label" for="nMat">${esc(T("p.nf.material"))}</label>
                <input class="input" id="nMat" data-k="material" maxlength="120" value="${esc(d.material)}" placeholder="${esc(T("p.nf.materialph"))}"></div>
              <div><label class="field-label" for="nShade">${esc(T("p.nf.shade"))}</label>
                <input class="input" id="nShade" data-k="shade" maxlength="40" value="${esc(d.shade)}" placeholder="${esc(T("p.nf.shadeph"))}"></div>
              <div><label class="field-label" for="nNeed">${esc(T("p.nf.needed"))}</label>
                <input class="input" id="nNeed" data-k="neededBy" type="date" value="${esc(d.neededBy)}"></div>
            </div>
          </fieldset>
          <fieldset class="fs"><legend><span class="n">2</span><span class="h-caps">${T("p.nf.s2")}</span></legend>
            ${dropZone("nFiles")}<ul class="picked" id="nList"></ul>
            <p class="field-label" style="margin-top:22px">${esc(T("p.nf.links"))}</p>
            <div id="nLinks"></div>
            <p class="hint">${esc(T("p.nf.linksh"))}</p>
          </fieldset>
          <fieldset class="fs"><legend><span class="n">3</span><span class="h-caps">${T("p.nf.s3")}</span></legend>
            <label class="field-label" for="nNotes">${esc(T("p.nf.notes"))}</label>
            <textarea class="input" id="nNotes" data-k="notes" maxlength="4000" placeholder="${esc(T("p.nf.notesph"))}">${esc(d.notes)}</textarea>
          </fieldset>
          <div class="progress block" id="nProg" hidden><div class="progress-bar"><i></i></div><p></p></div>
          <p class="error" id="nErr" role="alert" hidden></p>
          <div class="warnbox" id="nWarn" hidden></div>
          <div class="submit-row"><p class="hint" style="margin:0;max-width:420px">${esc(T("p.nf.agree"))}</p>
            <button class="btn btn-primary" type="submit" id="nSubmit">${esc(T("p.nf.submit"))}</button></div>
        </div>
        <aside class="card tips"><h2 class="h-caps">${esc(T("p.tips.h"))}</h2>
          <ul>${[1, 2, 3, 4, 5].map((i) => `<li>${esc(T("p.tips." + i))}</li>`).join("")}</ul></aside>
      </form>`);

    const form = document.getElementById("newForm");
    form.querySelectorAll("[data-k]").forEach((el) => el.addEventListener("input", () => { d[el.dataset.k] = el.value; el.classList.remove("ai-filled"); }));
    // AI: fill the form from a photo or text of the prescription
    const aiBox = document.getElementById("aiBox");
    const showAi = () => { aiBox.hidden = !D8.aiOn; };
    showAi(); document.addEventListener("d8:config", showAi, { once: true });
    aiBox.addEventListener("toggle", () => { d.aiOpen = aiBox.open; });
    document.getElementById("aiText").addEventListener("input", (e) => { d.aiText = e.target.value; });
    document.getElementById("aiPhoto").addEventListener("change", (e) => { d.aiPhoto = e.target.files[0] || null; document.getElementById("aiPhotoName").textContent = d.aiPhoto ? d.aiPhoto.name : ""; });
    document.getElementById("aiRead").addEventListener("click", async () => {
      const b = document.getElementById("aiRead"), er = document.getElementById("aiErr");
      er.hidden = true;
      if (!(d.aiText || "").trim() && !d.aiPhoto) { er.textContent = T("ai.rx.need"); er.hidden = false; return; }
      b.disabled = true; b.textContent = T("ai.rx.busy");
      try {
        const image = d.aiPhoto ? await shrinkImage(d.aiPhoto) : "";
        const f = (await D8.api("/api/ai/rx", { method: "POST", body: { text: (d.aiText || "").trim(), image } })).fields;
        const filled = [];
        for (const k of ["service", "teeth", "material", "shade", "neededBy"]) if (f[k]) { d[k] = f[k]; filled.push(k); }
        if (f.numbering) d.numbering = f.numbering;
        if (f.notes) { d.notes = d.notes && !d.notes.includes(f.notes) ? d.notes.trim() + "\n" + f.notes : f.notes; filled.push("notes"); }
        for (const [k, v] of Object.entries(f.rx || {})) { d.rx[k] = v; filled.push("rx_" + k); }
        d.aiFilled = filled; d.aiDone = filled.length; d.aiOpen = true;
        renderNew();
        return;
      } catch (ex) { er.textContent = ex.message; er.hidden = false; }
      b.disabled = false; b.textContent = T("ai.rx.read");
    });
    const rxBox = document.getElementById("rxBox");
    const drawRx = () => {
      rxBox.innerHTML = D8.rxFields(d.service, d.rx);
      rxBox.style.display = rxBox.innerHTML ? "" : "none";
      rxBox.querySelectorAll("[data-rx]").forEach((el) => el.addEventListener("input", () => { d.rx[el.dataset.rx] = el.value; }));
    };
    document.getElementById("nService").addEventListener("change", drawRx);
    drawRx();
    const KEY_ID = { service: "nService", teeth: "nTeeth", material: "nMat", shade: "nShade", neededBy: "nNeed", notes: "nNotes" };
    (d.aiFilled || []).forEach((k) => { const el = document.getElementById(KEY_ID[k] || k); if (el) el.classList.add("ai-filled"); });
    if (caseCount === null) D8.api("/api/my/jobs").then((r) => {
      caseCount = (r.items || []).length;
      const slot = document.getElementById("trialSlot");
      if (slot && caseCount < 2) slot.innerHTML = trialBanner();
    }).catch(() => {});
    form.querySelectorAll('input[name="numbering"]').forEach((r) => r.addEventListener("change", () => { d.numbering = r.value; }));
    const list = document.getElementById("nList");
    const redraw = () => pickedList(list, d.files, (i) => { d.files.splice(i, 1); redraw(); });
    wireDrop("nFiles", (fs) => { fs.forEach((f) => { if (!d.files.some((x) => sameFile(x, f))) d.files.push(f); }); redraw(); });
    redraw();
    const links = document.getElementById("nLinks");
    const drawLinks = () => {
      links.innerHTML = d.links.map((l, i) => `<div class="linkrow"><input class="input" type="url" inputmode="url" data-l="${i}" value="${esc(l)}" placeholder="https://" aria-label="${esc(T("p.nf.links"))} ${i + 1}">
        ${i === d.links.length - 1 && d.links.length < 5 ? `<button class="btn small" type="button" id="addLink" style="height:48px">${ICON.plus}<span class="sr-only">${esc(T("p.nf.addlink"))}</span></button>` : ""}</div>`).join("");
      links.querySelectorAll("[data-l]").forEach((el) => el.addEventListener("input", () => { d.links[+el.dataset.l] = el.value; }));
      const add = document.getElementById("addLink");
      if (add) add.addEventListener("click", () => { d.links.push(""); drawLinks(); links.querySelector(`[data-l="${d.links.length - 1}"]`).focus(); });
    };
    drawLinks();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = document.getElementById("nErr"), prog = document.getElementById("nProg"), btn = document.getElementById("nSubmit");
      const fail = (m, el) => { err.textContent = m; err.hidden = false; if (el) el.focus(); };
      err.hidden = true;
      d.title = d.title.trim();
      const linkList = d.links.map((l) => l.trim()).filter(Boolean);
      if (linkList.some((l) => !/^https?:\/\/\S+$/i.test(l))) return fail(T("p.nf.badlink"));
      if (!d.files.length && !linkList.length) return fail(T("p.nf.needfile"));
      if (!d.checked) {
        btn.disabled = true; btn.textContent = T("chk.checking");
        const warns = await preCheck(d, linkList);
        btn.disabled = false; btn.textContent = T("p.nf.submit");
        if (warns.length) return showWarns(warns);
      }
      document.getElementById("nWarn").hidden = true;
      D8.busy(btn, true); busy = true; prog.hidden = false;
      const bar = prog.querySelector("i"), txt = prog.querySelector("p");
      bar.style.width = "2%"; txt.textContent = T("p.nf.creating");
      let job;
      try {
        job = (await D8.api("/api/my/jobs", { method: "POST", body: { title: d.title, service: d.service, teeth: d.teeth, numbering: d.numbering,
          material: d.material, shade: d.shade, neededBy: d.neededBy, notes: d.notes, links: linkList,
          rx: Object.fromEntries((D8.RX[d.service] || []).map(([k]) => [k, (d.rx[k] || "").trim()]).filter(([, v]) => v)) } })).job;
      caseCount = (caseCount || 0) + 1;
      } catch (ex) { busy = false; D8.busy(btn, false); prog.hidden = true; return fail(ex.message); }
      recent.set(job.id, { id: job.id, title: job.title, status: job.status, created: job.created, updated: job.updated, lastBy: "client" });
      let upErr = "";
      if (d.files.length) {
        try { job = (await D8.uploadJobFiles(job.id, d.files, { onProgress: (p) => { bar.style.width = Math.max(4, p.pct) + "%"; txt.textContent = p.text; } })).job; }
        catch (ex) { upErr = ex.message; }
      }
      busy = false;
      draft = freshDraft();
      current = job;
      d.checked = false;
      if (upErr) D8.toast(T("p.nf.partial").replace("{e}", upErr)); else D8.toast(T("p.nf.done"));
      location.hash = "#/case/" + job.id;
    });
  }

  // Things worth a second look before a case is sent: missing details for the service, possible patient names, damaged files.
  async function preCheck(d, linkList) {
    const w = [], rx = d.rx || {}, svc = d.service;
    const names = d.files.map((f) => f.name.toLowerCase());
    const scans = names.filter((n) => /\.(stl|ply|obj|dcm)$/.test(n)).length;
    const implant = svc === "Implant restorations" || svc === "All-on-X & bars";
    if (implant && !(rx.implant_system || "").trim()) w.push(T("chk.implant_system"));
    if (svc === "Implant restorations" && !(rx.scan_body || "").trim()) w.push(T("chk.scan_body"));
    if (svc === "Surgical guides") {
      if (!names.some((n) => /\.(zip|dcm|7z|rar)$/.test(n)) && !linkList.length) w.push(T("chk.dicom"));
      if (!(rx.implant_system || "").trim() || !(rx.sleeve || "").trim()) w.push(T("chk.sleeve"));
    }
    if (["Crown & bridge", "Implant restorations", "All-on-X & bars", "Wax-up & smile design"].includes(svc) && scans < 2 && !linkList.length && !names.some((n) => n.endsWith(".zip"))) w.push(T("chk.bite"));
    if (["Crown & bridge", "Implant restorations"].includes(svc) && !d.teeth.trim()) w.push(T("chk.teeth"));
    if (["Crown & bridge", "Implant restorations", "All-on-X & bars"].includes(svc) && !d.material.trim()) w.push(T("chk.material"));
    if (svc === "Wax-up & smile design" && !names.some((n) => /\.(jpe?g|png|heic|webp)$/.test(n))) w.push(T("chk.photo"));
    for (const f of d.files) {
      const r = await D8.meshResult(f, false);
      if (r && r.level !== "ok") w.push(f.name + ": " + r.warn.join(" "));
    }
    if (D8.aiOn) {
      try {
        const r = await Promise.race([D8.api("/api/ai/check", { method: "POST", body: { title: d.title, notes: d.notes, files: d.files.map((f) => f.name) } }),
          new Promise((res) => setTimeout(() => res(null), 8000))]);
        if (r && r.patient) w.push(T("chk.patient").replace("{found}", r.found || ""));
      } catch {}
    }
    return w;
  }
  function showWarns(warns) {
    const box = document.getElementById("nWarn");
    box.innerHTML = `<h3 class="h-caps">${esc(T("chk.title"))}</h3><ul>${warns.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <div class="btns"><button class="btn small" type="button" id="wFix">${esc(T("chk.fix"))}</button><button class="btn btn-primary small" type="button" id="wSend">${esc(T("chk.send"))}</button></div>`;
    box.hidden = false;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("wFix").onclick = () => { box.hidden = true; window.scrollTo({ top: 0, behavior: "smooth" }); };
    document.getElementById("wSend").onclick = () => { draft.checked = true; document.getElementById("newForm").requestSubmit(); };
  }
  // Downscale a photo to keep the upload small (max 1400 px, JPEG).
  async function shrinkImage(file) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  }

  /* ------------------------------------------------------------ profile */
  async function renderProfile() {
    current = null;
    loading("form");
    let p;
    try { p = (await D8.api("/api/my/profile")).profile || {}; }
    catch (err) { if (err.status === 401) { user = null; return renderSignIn(); } return failed(err.message); }
    const avatar = user.picture ? `<img src="${esc(user.picture)}" alt="" referrerpolicy="no-referrer" style="width:56px;height:56px;border-radius:50%">` : "";
    page(band(`<div><span class="eyebrow">${esc(T("p.eyebrow"))}</span><h1>${esc(T("p.pf.h"))}</h1><p class="serif">${esc(T("p.pf.serif"))}</p></div>`), `
      <div class="form-grid">
        <form class="card" id="pfForm" novalidate>
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px">${avatar}<div><span class="field-label" style="margin:0 0 4px">${esc(T("p.pf.google"))}</span>
            <b style="color:var(--navy)">${esc(user.name || "")}</b><div class="muted" style="word-break:break-all">${esc(user.email)}</div></div></div>
          <div class="row2">
            <div class="full"><label class="field-label" for="pfPractice">${esc(T("p.pf.practice"))}</label><input class="input" id="pfPractice" maxlength="120" autocomplete="organization" value="${esc(p.practice || "")}"></div>
            <div><label class="field-label" for="pfCountry">${esc(T("p.pf.country"))}</label><input class="input" id="pfCountry" maxlength="60" autocomplete="country-name" value="${esc(p.country || "")}"></div>
            <div><label class="field-label" for="pfPhone">${esc(T("p.pf.phone"))}</label><input class="input" id="pfPhone" maxlength="40" type="tel" autocomplete="tel" value="${esc(p.phone || "")}"></div>
          </div>
          <p class="hint">${esc(T("p.pf.note"))}</p>
          <p class="error" id="pfErr" hidden></p>
          <div class="submit-row"><button class="btn btn-danger small" type="button" id="pfOut">${esc(T("p.pf.out"))}</button>
            <button class="btn btn-primary" type="submit" id="pfSave">${esc(T("p.pf.save"))}</button></div>
        </form>
      </div>`);
    document.getElementById("pfOut").addEventListener("click", D8.signOut);
    document.getElementById("pfForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("pfSave"), err = document.getElementById("pfErr");
      D8.busy(btn, true); err.hidden = true;
      try {
        await D8.api("/api/my/profile", { method: "POST", body: { practice: document.getElementById("pfPractice").value, country: document.getElementById("pfCountry").value, phone: document.getElementById("pfPhone").value } });
        D8.done(btn, T("p.pf.ok"));
      } catch (ex) { D8.busy(btn, false); err.textContent = ex.message; err.hidden = false; }
    });
  }
})();
