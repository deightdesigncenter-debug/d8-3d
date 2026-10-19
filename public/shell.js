/* D.EIGHT DESIGN CENTER — shared site shell
   One header, footer, language switch (EN/VI), Google sign-in state and the
   Website / Customer portal / Admin switcher for every page.
   Pages declare themselves with <body data-page="home|portal|admin|stl|legal">
   and provide <div id="d8-header"></div> and <div id="d8-footer"></div>. */
(function () {
  "use strict";
  const D8 = (window.D8 = window.D8 || {});
  const page = document.body.dataset.page || "home";
  const isAdminPage = page === "admin" || page === "stl";
  const LANG_KEY = "d8-lang";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  /* ------------------------------------------------------------ language */
  D8.lang = isAdminPage ? "vi" : (store.get(LANG_KEY) === "vi" ? "vi" : "en");
  const dict = {}; // key -> [en, vi]
  D8.addDict = (d) => Object.assign(dict, d);
  D8.t = (key, en) => {
    const e = dict[key];
    if (!e) return en || key;
    return D8.lang === "vi" ? (e[1] != null ? e[1] : e[0]) : e[0];
  };
  D8.applyLang = (root) => {
    root = root || document;
    document.documentElement.lang = D8.lang;
    root.querySelectorAll("[data-i]").forEach((el) => {
      const key = el.getAttribute("data-i");
      if (el.dataset.en == null) el.dataset.en = el.innerHTML;
      const e = dict[key];
      el.innerHTML = D8.lang === "vi" && e && e[1] != null ? e[1] : el.dataset.en;
    });
    root.querySelectorAll("[data-i-attr]").forEach((el) => {
      el.getAttribute("data-i-attr").split(",").forEach((pair) => {
        const [attr, key] = pair.split(":").map((s) => s.trim());
        const store = "en" + attr.replace(/[^a-z]/gi, "");
        if (el.dataset[store] == null) el.dataset[store] = el.getAttribute(attr) || "";
        const e = dict[key];
        el.setAttribute(attr, D8.lang === "vi" && e && e[1] != null ? e[1] : el.dataset[store]);
      });
    });
    if (document.body.dataset.titleKey) document.title = D8.t(document.body.dataset.titleKey, document.title);
  };
  D8.setLang = (lang) => {
    if (isAdminPage) return;
    D8.lang = lang === "vi" ? "vi" : "en";
    store.set(LANG_KEY, D8.lang);
    renderHeader(); renderFooter();
    D8.applyLang();
    document.dispatchEvent(new CustomEvent("d8:lang", { detail: D8.lang }));
  };

  D8.addDict({
    "sh.services": ["Services", "Dịch vụ"],
    "sh.process": ["How it works", "Quy trình"],
    "sh.work": ["Work", "Sản phẩm"],
    "sh.about": ["About", "Giới thiệu"],
    "sh.faq": ["FAQ", "Hỏi đáp"],
    "sh.contact": ["Contact", "Liên hệ"],
    "sh.signin": ["Sign in", "Đăng nhập"],
    "sh.send": ["Send a case", "Gửi ca"],
    "sh.view.site": ["Website", "Trang web"],
    "sh.view.portal": ["Customer", "Khách hàng"],
    "sh.view.admin": ["Admin", "Quản trị"],
    "sh.mycases": ["My cases", "Ca của tôi"],
    "sh.newcase": ["New case", "Gửi ca mới"],
    "sh.profile": ["Profile", "Hồ sơ"],
    "sh.admintools": ["Admin tools", "Công cụ quản trị"],
    "sh.signout": ["Sign out", "Đăng xuất"],
    "sh.top.tag": ["Remote dental CAD design · Vietnam, UTC+7", "Thiết kế CAD nha khoa từ xa · Việt Nam, UTC+7"],
    "sh.foot.blurb": ["Remote CAD design team for dental labs and clinics. Production-ready STL, designed to fit.", "Đội thiết kế CAD từ xa cho lab và phòng khám nha khoa. File STL sẵn sàng sản xuất, thiết kế vừa khít."],
    "sh.foot.explore": ["Explore", "Khám phá"],
    "sh.foot.customers": ["Customers", "Khách hàng"],
    "sh.foot.legal": ["Legal", "Pháp lý"],
    "sh.portal": ["Customer portal", "Cổng khách hàng"],
    "sh.privacy": ["Privacy policy", "Chính sách bảo mật"],
    "sh.terms": ["Terms of service", "Điều khoản dịch vụ"],
    "sh.menu": ["Menu", "Menu"],
    "sh.promo": ["Free trial: your first 2 cases, up to US$50 in total", "Dùng thử: 2 ca đầu miễn phí, tổng đến 50 USD"],
    "sh.promo.s": ["2 free trial cases", "2 ca dùng thử miễn phí"],
    "sh.wa": ["WhatsApp · Danny Do", "WhatsApp · Danny Do"],
    "sh.wa.msg": ["Hi Danny, I'd like to know more about D.EIGHT's dental design services.", "Chào Danny, tôi muốn tìm hiểu dịch vụ thiết kế nha khoa của D.EIGHT."],
    "sh.gis.load": ["Google sign-in could not load. Check your connection or ad blocker, then reload the page.", "Không tải được nút đăng nhập Google. Kiểm tra mạng hoặc trình chặn quảng cáo rồi tải lại trang."],
    "sh.gis.cfg": ["Google sign-in is not configured yet.", "Chưa cấu hình đăng nhập Google."],
  });

  /* ------------------------------------------------------------ API + auth */
  D8.user = null;
  // Admin password (fallback when the admin is not signed in with Google), kept by admin.html.
  D8.adminKey = () => { try { return sessionStorage.getItem("d8-upload-key") || localStorage.getItem("d8-upload-key") || ""; } catch { return ""; } };
  // Only the admin pages send the password; the customer portal always acts as the signed-in Google user.
  D8.authHeaders = () => { const k = isAdminPage ? D8.adminKey() : ""; return k ? { "X-D8": "1", "X-Upload-Key": k } : { "X-D8": "1" }; };
  D8.api = async function (path, opts = {}) {
    const headers = { ...D8.authHeaders(), ...(opts.headers || {}) };
    let body = opts.body;
    if (body && typeof body === "object" && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    let res;
    try { res = await fetch(path, { ...opts, headers, body, credentials: "same-origin" }); }
    catch { throw Object.assign(new Error(D8.lang === "vi" ? "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại." : "Can't reach the server. Check your connection and try again."), { status: 0 }); }
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw Object.assign(new Error(data.error || ("Error " + res.status)), { status: res.status, data });
    return data;
  };

  /* ------------------------------------------------------------ case helpers (portal + admin) */
  D8.addDict({
    "st.received": ["Received", "Đã nhận"],
    "st.needs_info": ["Needs info", "Cần bổ sung"],
    "st.in_design": ["In design", "Đang thiết kế"],
    "st.review": ["Ready for review", "Chờ duyệt"],
    "st.approved": ["Approved", "Đã duyệt"],
    "st.delivered": ["Delivered", "Đã giao"],
    "st.cancelled": ["Cancelled", "Đã hủy"],
    "up.prep": ["Preparing {name}…", "Đang chuẩn bị {name}…"],
    "up.send": ["Uploading {name} ({i}/{n})… {pct}%", "Đang tải lên {name} ({i}/{n})… {pct}%"],
    "up.attach": ["Saving files…", "Đang lưu file…"],
    "up.big": ["{name} is too large (max 300 MB after compression).", "{name} quá lớn (tối đa 300 MB sau khi nén)."],
    "up.fail": ["Upload failed. Check your connection and try again.", "Tải lên thất bại. Kiểm tra mạng rồi thử lại."],
    "svc.Crown & bridge": ["Crown & bridge", "Mão & cầu"],
    "svc.Implant restorations": ["Implant restorations", "Phục hình implant"],
    "svc.All-on-X & bars": ["All-on-X & bars", "All-on-X & bar"],
    "svc.Surgical guides": ["Surgical guides", "Máng hướng dẫn phẫu thuật"],
    "svc.Wax-up & smile design": ["Wax-up & smile design", "Wax-up & thiết kế nụ cười"],
    "svc.Dentures & partials": ["Dentures & partials", "Hàm tháo lắp"],
    "svc.Splints & trays": ["Splints & trays", "Máng nhai & khay"],
    "svc.Aligner & ortho": ["Aligner & ortho", "Niềng trong suốt & chỉnh nha"],
    "svc.Digital models": ["Digital models", "Mẫu hàm kỹ thuật số"],
    "svc.Trial case": ["Trial case", "Ca làm thử"],
    "svc.Something else": ["Something else", "Việc khác"],
  });
  D8.SERVICES = ["Crown & bridge", "Implant restorations", "All-on-X & bars", "Surgical guides", "Wax-up & smile design", "Dentures & partials",
                 "Splints & trays", "Aligner & ortho", "Digital models", "Trial case", "Something else"];
  D8.svcLabel = (v) => (v ? D8.t("svc." + v, v) : "");
  D8.statusLabel = (s) => D8.t("st." + s, s);
  // WhatsApp contact
  D8.WA = { number: "84703233263", display: "+84 70 323 3263", name: "Danny Do" };
  D8.waLink = (text) => "https://wa.me/" + D8.WA.number + "?text=" + encodeURIComponent(text || D8.t("sh.wa.msg"));
  D8.ICON_CHAT = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M10 2.2a7.8 7.8 0 0 0-6.7 11.8L2.2 17.8l3.9-1.1A7.8 7.8 0 1 0 10 2.2Z"/><path d="M7.1 6.3c.3-.3.8-.3 1 .1l.7 1.4c.1.3 0 .6-.2.8l-.5.5a5 5 0 0 0 2.8 2.8l.5-.5c.2-.2.5-.3.8-.2l1.4.7c.4.2.4.7.1 1-.6.7-1.5 1-2.4.7a7.4 7.4 0 0 1-4.9-4.9c-.3-.9 0-1.8.7-2.4Z"/></svg>';
  D8.addDict({
    "tr.btn": ["Translate", "Dịch"],
    "tr.to.en": ["Translate to English", "Dịch sang tiếng Anh"],
    "tr.to.vi": ["Translate to Vietnamese", "Dịch sang tiếng Việt"],
    "tr.busy": ["Translating…", "Đang dịch…"],
    "tr.label": ["Translated", "Bản dịch"],
    "tr.hide": ["Hide translation", "Ẩn bản dịch"],
    "tr.show": ["Show translation", "Xem bản dịch"],
    "tr.opened": ["Opened Google Translate in a new tab.", "Đã mở Google Dịch ở thẻ mới."],
    "zip.btn": ["Download all (.zip)", "Tải tất cả (.zip)"],
    "zip.busy": ["Preparing {i}/{n}…", "Đang gom file {i}/{n}…"],
  });

  // Extra prescription fields per service (stored on the case as rx: {key: value}).
  const ARCH = ["Upper", "Lower", "Both"];
  D8.RX = {
    "Implant restorations": [["retention", ["Screw-retained crown", "Cement-retained crown", "Custom abutment + crown", "Ti-base crown", "Implant bridge"]], ["implant_system"], ["scan_body"]],
    "All-on-X & bars": [["arch", ARCH], ["prosthesis", ["Hybrid bridge", "Bar", "Bar + overlay", "Provisional (PMMA)"]], ["implant_system"], ["mua"]],
    "Surgical guides": [["support", ["Tooth-supported", "Tissue-supported", "Bone-supported"]], ["implant_system"], ["sleeve"], ["sites"]],
    "Crown & bridge": [["restoration", ["Full contour", "Cutback", "Coping / framework", "Veneer", "Inlay / onlay", "Post and core"]], ["cement_gap"]],
    "Wax-up & smile design": [["arch", ARCH], ["photo", ["Photo attached", "No photo"]]],
    "Dentures & partials": [["arch", ARCH], ["base", ["Hard acrylic", "Flexible", "Metal framework"]], ["teeth_library"]],
    "Splints & trays": [["appliance", ["Night guard", "Michigan splint", "Kois deprogrammer", "Sleep appliance", "Retainer", "Bleach tray", "Custom impression tray"]], ["arch", ARCH], ["thickness"]],
    "Aligner & ortho": [["arch", ARCH], ["goals"]],
    "Digital models": [["model", ["Dies", "Articulated model", "Ortho model", "Implant model with gingiva"]], ["arch", ARCH]],
  };
  D8.addDict({
    "rx.retention": ["Restoration type", "Loại phục hình"], "rx.implant_system": ["Implant system & platform", "Hệ implant & kết nối"],
    "rxp.implant_system": ["e.g. brand, line, platform size", "VD: hãng, dòng, kích thước kết nối"],
    "rx.scan_body": ["Scan body", "Scan body"], "rxp.scan_body": ["Brand and type", "Hãng và loại"],
    "rx.arch": ["Arch", "Hàm"], "rx.prosthesis": ["Prosthesis", "Loại phục hình"],
    "rx.mua": ["MUA angles / heights", "Góc / chiều cao MUA"], "rxp.mua": ["e.g. 17° posterior, straight anterior", "VD: 17° phía sau, thẳng phía trước"],
    "rx.support": ["Guide support", "Kiểu tựa máng"], "rx.sleeve": ["Guided kit / sleeve", "Bộ khoan / ống dẫn"], "rxp.sleeve": ["e.g. kit name, sleeve Ø", "VD: tên bộ khoan, đường kính ống"],
    "rx.sites": ["Implant sites", "Vị trí implant"], "rxp.sites": ["e.g. 36, 46", "VD: 36, 46"],
    "rx.restoration": ["Restoration type", "Loại phục hình"], "rx.cement_gap": ["Cement gap / min. thickness", "Khoảng xi măng / độ dày tối thiểu"],
    "rxp.cement_gap": ["e.g. 0.05 mm / 0.8 mm", "VD: 0,05 mm / 0,8 mm"],
    "rx.photo": ["Smile photo", "Ảnh nụ cười"], "rx.base": ["Base", "Nền hàm"], "rx.teeth_library": ["Teeth library / mould", "Thư viện răng / khuôn răng"],
    "rx.appliance": ["Appliance", "Loại khí cụ"], "rx.thickness": ["Thickness", "Độ dày"], "rxp.thickness": ["e.g. 2.0 mm", "VD: 2,0 mm"],
    "rx.goals": ["Treatment goals", "Mục tiêu điều trị"], "rx.model": ["Model type", "Loại mẫu"],
    "rx.choose": ["Choose…", "Chọn…"],
    "rxo.Upper": ["Upper", "Hàm trên"], "rxo.Lower": ["Lower", "Hàm dưới"], "rxo.Both": ["Both", "Cả hai hàm"],
    "rxo.Screw-retained crown": ["Screw-retained crown", "Mão bắt vít"], "rxo.Cement-retained crown": ["Cement-retained crown", "Mão gắn xi măng"],
    "rxo.Custom abutment + crown": ["Custom abutment + crown", "Abutment cá nhân + mão"], "rxo.Ti-base crown": ["Ti-base crown", "Mão trên Ti-base"],
    "rxo.Implant bridge": ["Implant bridge", "Cầu trên implant"], "rxo.Hybrid bridge": ["Hybrid bridge", "Cầu hybrid"], "rxo.Bar": ["Bar", "Thanh bar"],
    "rxo.Bar + overlay": ["Bar + overlay", "Bar + phần phủ"], "rxo.Provisional (PMMA)": ["Provisional (PMMA)", "Tạm (PMMA)"],
    "rxo.Tooth-supported": ["Tooth-supported", "Tựa răng"], "rxo.Tissue-supported": ["Tissue-supported", "Tựa mô"], "rxo.Bone-supported": ["Bone-supported", "Tựa xương"],
    "rxo.Full contour": ["Full contour", "Nguyên khối"], "rxo.Cutback": ["Cutback", "Cắt lớp"], "rxo.Coping / framework": ["Coping / framework", "Sườn"],
    "rxo.Veneer": ["Veneer", "Veneer"], "rxo.Inlay / onlay": ["Inlay / onlay", "Inlay / onlay"], "rxo.Post and core": ["Post and core", "Chốt và cùi"],
    "rxo.Photo attached": ["Photo attached", "Có ảnh kèm theo"], "rxo.No photo": ["No photo", "Không có ảnh"],
    "rxo.Hard acrylic": ["Hard acrylic", "Nhựa cứng"], "rxo.Flexible": ["Flexible", "Nhựa dẻo"], "rxo.Metal framework": ["Metal framework", "Khung kim loại"],
    "rxo.Night guard": ["Night guard", "Máng chống nghiến"], "rxo.Michigan splint": ["Michigan splint", "Máng Michigan"], "rxo.Kois deprogrammer": ["Kois deprogrammer", "Máng Kois"],
    "rxo.Sleep appliance": ["Sleep appliance", "Khí cụ ngủ ngáy"], "rxo.Retainer": ["Retainer", "Hàm duy trì"], "rxo.Bleach tray": ["Bleach tray", "Máng tẩy trắng"],
    "rxo.Custom impression tray": ["Custom impression tray", "Khay lấy dấu cá nhân"], "rxo.Dies": ["Dies", "Die"], "rxo.Articulated model": ["Articulated model", "Mẫu lên càng"],
    "rxo.Ortho model": ["Ortho model", "Mẫu chỉnh nha"], "rxo.Implant model with gingiva": ["Implant model with gingiva", "Mẫu implant có nướu"],
    "tr.orig": ["Original", "Bản gốc"], "tr.in.vi": ["Vietnamese version", "Bản tiếng Việt"], "tr.in.en": ["English version", "Bản tiếng Anh"], "tr.all": ["Translate all", "Dịch tất cả"], "tr.auto": ["Always translate", "Luôn dịch"],
    "bill.price": ["Price", "Giá"], "bill.trial": ["Free trial", "Dùng thử miễn phí"], "bill.due": ["Awaiting payment", "Chờ thanh toán"], "bill.paid": ["Paid", "Đã thanh toán"],
  });
  // [label, value] rows for a case's extra prescription fields, in the current language
  D8.rxRows = (rx) => Object.entries(rx || {}).map(([k, v]) => [D8.t("rx." + k, k.replace(/_/g, " ")), D8.t("rxo." + v, v)]);
  // form controls for a service's extra fields; values from `vals`
  D8.rxFields = (service, vals) => (D8.RX[service] || []).map(([k, opts]) => {
    const id = "rx_" + k, v = (vals || {})[k] || "";
    const ctl = opts ? `<select class="input" id="${id}" data-rx="${k}"><option value="">${D8.esc(D8.t("rx.choose"))}</option>${opts.map((o) => `<option value="${D8.esc(o)}"${o === v ? " selected" : ""}>${D8.esc(D8.t("rxo." + o, o))}</option>`).join("")}</select>`
      : `<input class="input" id="${id}" data-rx="${k}" maxlength="160" value="${D8.esc(v)}" placeholder="${D8.esc(D8.t("rxp." + k, ""))}">`;
    return `<div><label class="field-label" for="${id}">${D8.esc(D8.t("rx." + k))}</label>${ctl}</div>`;
  }).join("");

  // Chat thread (portal and admin). me = "client" | "admin"; to = language the viewer reads.
  D8.threadHtml = (job, me, to) => (job.thread || []).map((m) => {
    if (m.by === "system") { const s = String(m.text).replace(/^status:/, ""); return `<div class="sys">${D8.esc(D8.fmtDate(m.at, true))} · <span class="st st-${D8.esc(s)}">${D8.esc(D8.statusLabel(s))}</span></div>`; }
    const mine = m.by === me, tr = m.tr && m.tr[to];
    const name = mine ? "" : `<b>${D8.esc(m.name || (m.by === "admin" ? "D.EIGHT" : ""))}</b>`;
    const trBlock = tr && tr !== m.text ? `<div class="bub-tr"><span>${D8.esc(D8.t(mine ? "tr.in." + to : "tr.label"))}</span>${D8.esc(tr)}</div>` : "";
    const canTr = !mine && !tr && m.lang !== to;
    return `<div class="bub ${mine ? "me" : "them"}">${name}<div class="bub-text">${D8.esc(m.text)}</div>${trBlock}<small>${D8.esc(D8.fmtDate(m.at, true))}${canTr
      ? `<span class="tr-wrap"> · <button type="button" class="tr-btn" data-tr="${m.at}">${D8.esc(D8.t("tr.btn"))}</button></span>` : ""}</small></div>`;
  }).join("");
  D8.wireThread = (root, job, to) => {
    const one = async (b) => {
      const at = +b.dataset.tr, m = (job.thread || []).find((x) => x.at === at);
      if (!m || b.disabled) return;
      b.disabled = true; b.textContent = D8.t("tr.busy");
      try {
        const r = await D8.translate({ jobId: job.id, at, text: m.text, to });
        if (r.opened) { D8.toast(D8.t("tr.opened")); b.disabled = false; b.textContent = D8.t("tr.btn"); return false; }
        m.tr = { ...(m.tr || {}), [to]: r.text };
        const bub = b.closest(".bub"), div = document.createElement("div");
        div.className = "bub-tr"; div.innerHTML = `<span>${D8.esc(D8.t("tr.label"))}</span>`; div.appendChild(document.createTextNode(r.text));
        bub.insertBefore(div, bub.querySelector("small"));
        b.closest(".tr-wrap").remove();
        return true;
      } catch (err) { b.disabled = false; b.textContent = D8.t("tr.btn"); D8.toast(err.message); return false; }
    };
    root.querySelectorAll("[data-tr]").forEach((b) => b.addEventListener("click", () => one(b)));
    const all = root.parentElement && root.parentElement.querySelector("[data-tr-all]");
    const btns = root.querySelectorAll("[data-tr]");
    const runAll = async () => { for (const b of root.querySelectorAll("[data-tr]")) { if ((await one(b)) === false) break; } if (all) all.hidden = true; };
    if (all) {
      all.hidden = btns.length < 2;
      all.onclick = () => { all.disabled = true; runAll(); };
    }
    // "Always translate" (only when server translation is on, so nothing opens new tabs)
    const auto = root.parentElement && root.parentElement.querySelector("[data-tr-auto]");
    if (auto) {
      const key = "d8-autotr-" + (isAdminPage ? "admin" : "portal");
      let on = false; try { on = localStorage.getItem(key) === "1"; } catch {}
      auto.closest("label").hidden = !D8.aiOn;
      auto.checked = on;
      auto.onchange = () => { try { localStorage.setItem(key, auto.checked ? "1" : "0"); } catch {} if (auto.checked) runAll(); };
      if (on && D8.aiOn && btns.length) runAll();
    }
  };

  // List of files picked for upload, each with its quick health check. design = finished restorations.
  const meshCache = new WeakMap();
  D8.meshResult = async (file, design) => {
    const k = meshCache.get(file);
    if (k && k.design === design) return k.r;
    const r = await D8.checkMesh(file, design);
    meshCache.set(file, { design, r });
    return r;
  };
  D8.renderPicked = (el, files, onRemove, opts = {}) => {
    el.innerHTML = files.map((f, i) => `<li><div class="pk"><span class="pk-n" title="${D8.esc(f.name)}">${D8.esc(f.name)}</span><span class="pk-c" data-pk="${i}"></span></div>
      <small>${D8.esc(D8.size(f.size))}</small><button type="button" data-rm="${i}" aria-label="${D8.esc(opts.removeLabel || "Remove")} ${D8.esc(f.name)}">✕</button></li>`).join("");
    el.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => onRemove(+b.dataset.rm)));
    files.forEach(async (f, i) => {
      const r = await D8.meshResult(f, !!opts.design);
      const c = el.querySelector(`[data-pk="${i}"]`);
      if (!c || !r) return;
      c.className = "pk-c " + r.level;
      c.textContent = (r.level === "ok" ? "✓ " : "⚠ ") + [r.text, ...r.warn].filter(Boolean).join(" · ");
    });
  };

  // Quick health check of a scan or design file in the browser (no upload). design = finished restoration (should be closed).
  D8.addDict({
    "mc.stl": ["STL · {tris} triangles · {x} × {y} × {z} mm", "STL · {tris} tam giác · {x} × {y} × {z} mm"],
    "mc.closed": ["closed mesh", "lưới kín"],
    "mc.ply": ["PLY · {v} points · {f} faces", "PLY · {v} điểm · {f} mặt"],
    "mc.zip": ["ZIP archive", "File nén ZIP"],
    "mc.empty": ["The file is empty.", "File rỗng."],
    "mc.corrupt": ["The file looks damaged (its size doesn't match the STL header). Please export it again.", "File có vẻ bị hỏng (kích thước không khớp phần đầu STL). Vui lòng xuất lại."],
    "mc.badzip": ["This doesn't look like a valid ZIP file.", "File này không giống file ZIP hợp lệ."],
    "mc.badply": ["This doesn't look like a valid PLY file.", "File này không giống file PLY hợp lệ."],
    "mc.nan": ["The file contains invalid coordinates.", "File có tọa độ không hợp lệ."],
    "mc.tiny": ["Very small ({d} mm across). Check the export units (inches or cm instead of mm?).", "Rất nhỏ ({d} mm). Kiểm tra đơn vị khi xuất (inch hoặc cm thay vì mm?)."],
    "mc.huge": ["Very large ({d} mm across). Check the export units.", "Rất lớn ({d} mm). Kiểm tra đơn vị khi xuất."],
    "mc.open": ["The mesh is not closed ({n} open edges).", "Lưới chưa kín ({n} cạnh hở)."],
    "mc.quick": ["large file, quick check only", "file lớn, chỉ kiểm tra nhanh"],
  });
  const fmtN = (n) => Number(n).toLocaleString(D8.locale());
  D8.checkMesh = async function (file, design) {
    const name = file.name.toLowerCase(), r = { level: "ok", text: "", warn: [] };
    const warn = (k, vars) => { let t = D8.t(k); for (const [a, b] of Object.entries(vars || {})) t = t.replace("{" + a + "}", b); r.warn.push(t); if (r.level === "ok") r.level = "warn"; };
    const bad = (k) => { r.level = "bad"; r.warn.push(D8.t(k)); return r; };
    try {
      if (/\.zip$/.test(name)) {
        const h = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        if (!(h[0] === 0x50 && h[1] === 0x4b)) return bad("mc.badzip");
        r.text = D8.t("mc.zip"); return r;
      }
      if (/\.ply$/.test(name)) {
        const head = await file.slice(0, 65536).text();
        if (!/^ply\s/.test(head)) return bad("mc.badply");
        const end = head.indexOf("end_header");
        if (end < 0) { r.text = "PLY"; return r; } // very long header: don't guess
        const hdr = head.slice(0, end);
        const v = +(hdr.match(/element vertex (\d+)/) || [])[1] || 0, f = +(hdr.match(/element face (\d+)/) || [])[1] || 0;
        if (!/element vertex/.test(hdr)) return bad("mc.badply");
        if (!v) return bad("mc.empty");
        r.text = D8.t("mc.ply").replace("{v}", fmtN(v)).replace("{f}", fmtN(f)); return r;
      }
      if (!/\.stl$/.test(name)) return null;
      if (file.size < 84) return bad("mc.empty");
      const dv0 = new DataView(await file.slice(0, 84).arrayBuffer());
      const n = dv0.getUint32(80, true);
      let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], nan = false, tris = 0, quick = false, openEdges = -1;
      const grow = (x, y, z) => {
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { nan = true; return; }
        if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
      };
      if (84 + n * 50 === file.size) {
        if (!n) return bad("mc.empty");
        tris = n;
        if (file.size > 250 * 1048576) quick = true;
        else {
          const dv = new DataView(await file.arrayBuffer());
          const doEdges = design && n <= 3000000;
          const ids = doEdges ? new Map() : null, edges = doEdges ? new Map() : null;
          const vid = (x, y, z) => { const k = Math.round(x * 1e4) + "," + Math.round(y * 1e4) + "," + Math.round(z * 1e4); let i = ids.get(k); if (i === undefined) { i = ids.size; ids.set(k, i); } return i; };
          const edge = (a, b) => { if (a === b) return; const k = a < b ? a * 8388608 + b : b * 8388608 + a; edges.set(k, (edges.get(k) || 0) + 1); };
          for (let i = 0, o = 84; i < n; i++, o += 50) {
            const v = [];
            for (let j = 0; j < 3; j++) {
              const x = dv.getFloat32(o + 12 + j * 12, true), y = dv.getFloat32(o + 16 + j * 12, true), z = dv.getFloat32(o + 20 + j * 12, true);
              grow(x, y, z); if (doEdges) v.push(vid(x, y, z));
            }
            if (doEdges) { edge(v[0], v[1]); edge(v[1], v[2]); edge(v[2], v[0]); }
          }
          if (doEdges) { openEdges = 0; for (const c of edges.values()) if (c === 1) openEdges++; }
        }
      } else {
        const start = new TextDecoder().decode(new Uint8Array(dv0.buffer, 0, 5)).toLowerCase();
        if (start !== "solid") return bad("mc.corrupt");
        if (file.size > 150 * 1048576) { quick = true; }
        else {
          const text = await file.text();
          const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g; let m, c = 0;
          while ((m = re.exec(text))) { grow(+m[1], +m[2], +m[3]); c++; }
          tris = Math.floor(c / 3);
          if (!tris) return bad("mc.empty");
        }
      }
      if (nan) return bad("mc.nan");
      if (quick) { r.text = "STL · " + fmtN(tris || 0) + " · " + D8.t("mc.quick"); return r; }
      const d = max.map((v, i) => v - min[i]), big = Math.max(...d);
      r.text = D8.t("mc.stl").replace("{tris}", fmtN(tris)).replace("{x}", d[0].toFixed(1)).replace("{y}", d[1].toFixed(1)).replace("{z}", d[2].toFixed(1));
      if (openEdges === 0) r.text += " · " + D8.t("mc.closed");
      if (big < 3) warn("mc.tiny", { d: big.toFixed(2) });
      else if (big > 250) warn("mc.huge", { d: big.toFixed(0) });
      if (openEdges > 0) warn("mc.open", { n: fmtN(openEdges) });
      return r;
    } catch { return null; }
  };

  // Translate a case message (kept on the message for both sides) or a draft. Falls back to the browser's
  // built-in translator (Chrome) and finally to Google Translate in a new tab if server translation is off.
  // Uses Chrome's on-device translator only when its language pack is already installed (no waiting for downloads).
  const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
  async function deviceTranslate(text, to) {
    try {
      if ("Translator" in self) {
        const from = to === "vi" ? "en" : "vi";
        const a = await within(self.Translator.availability({ sourceLanguage: from, targetLanguage: to }), 1500);
        if (a === "available") { const t = await within(self.Translator.create({ sourceLanguage: from, targetLanguage: to }), 2000); return await within(t.translate(text), 4000); }
      }
    } catch {}
    return "";
  }
  D8.translate = async function ({ jobId, at, text, to }) {
    try {
      const r = jobId ? await D8.api(`/api/jobs/${encodeURIComponent(jobId)}/translate`, { method: "POST", body: { at, to } })
                      : await D8.api("/api/translate", { method: "POST", body: { text, to } });
      return { text: r.text, saved: !!jobId };
    } catch (err) {
      if (!(err.data && err.data.code === "no_ai") && err.status !== 0) throw err;
      const t = await deviceTranslate(text, to);
      if (t) return { text: t, saved: false };
      window.open("https://translate.google.com/?sl=auto&tl=" + to + "&op=translate&text=" + encodeURIComponent(text), "_blank", "noopener");
      return { text: "", opened: true };
    }
  };

  // Download several files as one ZIP (stored, no extra compression), built in the browser.
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  D8.downloadZip = async function (entries, zipName, onProgress) {
    const enc = new TextEncoder(), parts = [], central = [], used = new Set();
    let offset = 0;
    const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (let i = 0; i < entries.length; i++) {
      onProgress && onProgress(i + 1, entries.length);
      const res = await fetch(entries[i].url, { headers: D8.authHeaders(), credentials: "same-origin" });
      if (!res.ok) { let m = ""; try { m = (await res.json()).error; } catch {} throw new Error((m || "Error " + res.status) + " (" + entries[i].name + ")"); }
      const data = new Uint8Array(await res.arrayBuffer());
      let name = entries[i].name.replace(/[\\/:*?"<>|]+/g, "_") || "file";
      if (used.has(name.toLowerCase())) { const dot = name.lastIndexOf("."); let k = 2; let nn; do { nn = dot > 0 ? name.slice(0, dot) + " (" + k + ")" + name.slice(dot) : name + " (" + k + ")"; k++; } while (used.has(nn.toLowerCase())); name = nn; }
      used.add(name.toLowerCase());
      const nb = enc.encode(name), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true);
      parts.push(lh.buffer, nb, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, offset, true);
      central.push(ch.buffer, nb);
      offset += 30 + nb.length + data.length;
    }
    const cdSize = central.reduce((t, x) => t + (x.byteLength || x.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const blob = new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = zipName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  };
  D8.locale = () => (D8.lang === "vi" ? "vi-VN" : "en-GB");
  D8.fmtDate = (ts, time) => {
    if (!ts) return "";
    const o = time ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric" };
    try { return new Intl.DateTimeFormat(D8.locale(), o).format(ts); } catch { return new Date(ts).toLocaleString(); }
  };
  D8.ago = (ts) => {
    const s = Math.round((ts - Date.now()) / 1000), a = Math.abs(s);
    const [v, u] = a < 60 ? [s, "second"] : a < 3600 ? [Math.round(s / 60), "minute"] : a < 86400 ? [Math.round(s / 3600), "hour"] : a < 86400 * 30 ? [Math.round(s / 86400), "day"] : [0, ""];
    if (!u) return D8.fmtDate(ts);
    try { return new Intl.RelativeTimeFormat(D8.locale(), { numeric: "auto" }).format(v, u); } catch { return D8.fmtDate(ts, true); }
  };
  D8.size = (b) => (b >= 1048576 ? (b / 1048576).toFixed(b >= 104857600 ? 0 : 1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
  D8.esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Upload files to a case: gzip in the browser where it helps, split into 20 MB parts, then attach.
  const CHUNK = 20 * 1024 * 1024, MAX_PARTS = 15;
  const NO_GZIP = /\.(zip|7z|rar|gz|tgz|bz2|xz|jpe?g|png|webp|heic|gif|mp4|mov|avi|pdf|docx|xlsx|pptx)$/i;
  const fidChars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const newFid = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => fidChars[b % fidChars.length]).join("");
  function putPart(url, blob, onProg) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", url);
      const h = D8.authHeaders();
      Object.keys(h).forEach((k) => x.setRequestHeader(k, h[k]));
      x.setRequestHeader("Content-Type", "application/octet-stream");
      x.upload.onprogress = (e) => onProg && onProg(e.loaded);
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) return resolve();
        let msg = ""; try { msg = JSON.parse(x.responseText).error; } catch {}
        reject(Object.assign(new Error(msg || D8.t("up.fail")), { status: x.status }));
      };
      x.onerror = () => reject(new Error(D8.t("up.fail")));
      x.send(blob);
    });
  }
  D8.uploadJobFiles = async function (jobId, files, opts = {}) {
    const say = opts.onProgress || (() => {});
    const metas = [];
    files = Array.from(files);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const name = file.name;
      say({ text: D8.t("up.prep").replace("{name}", name), pct: Math.round((i / files.length) * 100) });
      let blob = file, gz = 0;
      if (!NO_GZIP.test(name) && file.size > 4096 && "CompressionStream" in window) {
        try {
          const z = await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
          if (z.size < file.size * 0.92) { blob = z; gz = 1; }
        } catch {}
      }
      const parts = Math.max(1, Math.ceil(blob.size / CHUNK));
      if (parts > MAX_PARTS) throw new Error(D8.t("up.big").replace("{name}", name));
      const fid = newFid();
      for (let n = 0; n < parts; n++) {
        const part = blob.slice(n * CHUNK, Math.min(blob.size, (n + 1) * CHUNK));
        let tries = 0;
        for (;;) {
          try {
            await putPart(`/api/jobs/${encodeURIComponent(jobId)}/files/${fid}/${n}`, part, (loaded) => {
              const filePct = (n * CHUNK + loaded) / Math.max(1, blob.size);
              say({ text: D8.t("up.send").replace("{name}", name).replace("{i}", i + 1).replace("{n}", files.length).replace("{pct}", Math.min(100, Math.round(filePct * 100))),
                    pct: Math.round(((i + Math.min(1, filePct)) / files.length) * 100) });
            });
            break;
          } catch (err) {
            if (++tries >= 3 || (err.status && err.status < 500)) throw err;
            await new Promise((r) => setTimeout(r, 1500 * tries));
          }
        }
      }
      metas.push({ fid, name, size: file.size, stored: blob.size, parts, gz });
    }
    say({ text: D8.t("up.attach"), pct: 100 });
    return D8.api(`/api/jobs/${encodeURIComponent(jobId)}/files`, { method: "POST", body: { files: metas, deliver: !!opts.deliver } });
  };

  let configP = null;
  D8.config = () => (configP = configP || fetch("/api/config").then((r) => r.json()).catch(() => ({})));
  D8.aiOn = false;
  D8.config().then((c) => { D8.aiOn = !!(c && c.translate); document.dispatchEvent(new CustomEvent("d8:config", { detail: c })); });

  let gisP = null;
  function loadGis() {
    if (gisP) return gisP;
    gisP = new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => { gisP = null; reject(new Error(D8.t("sh.gis.load"))); };
      document.head.appendChild(s);
    });
    return gisP;
  }

  const signInWaiters = [];
  async function onCredential(resp) {
    try {
      const data = await D8.api("/api/auth/google", { method: "POST", body: { credential: resp.credential } });
      D8.user = data.user;
      renderHeader();
      document.dispatchEvent(new CustomEvent("d8:user", { detail: D8.user }));
      signInWaiters.splice(0).forEach((fn) => { try { fn(D8.user); } catch {} });
    } catch (err) {
      document.dispatchEvent(new CustomEvent("d8:signin-error", { detail: err.message }));
      alertBox(err.message);
    }
  }
  function alertBox(msg) {
    let el = document.getElementById("d8-toast");
    if (!el) { el = document.createElement("div"); el.id = "d8-toast"; el.className = "sh-toast"; el.setAttribute("role", "alert"); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add("show");
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 6000);
  }
  D8.toast = alertBox;

  let gisReady = null;
  async function initGis() {
    if (gisReady) return gisReady;
    gisReady = (async () => {
      const [cfg] = await Promise.all([D8.config(), loadGis()]);
      if (!cfg.googleClientId) throw new Error(D8.t("sh.gis.cfg"));
      window.google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onCredential, ux_mode: "popup", auto_select: false, cancel_on_tap_outside: true, itp_support: true });
      return true;
    })();
    gisReady.catch(() => { gisReady = null; });
    return gisReady;
  }

  // Render the official "Sign in with Google" button into el. onSignedIn(user) runs after a successful sign-in.
  D8.renderGoogleButton = async function (el, onSignedIn, opts = {}) {
    if (onSignedIn) signInWaiters.push(onSignedIn);
    try {
      await initGis();
      el.innerHTML = "";
      window.google.accounts.id.renderButton(el, {
        type: "standard", theme: opts.theme || "outline", size: "large", shape: "pill", text: opts.text || "signin_with",
        logo_alignment: "left", locale: D8.lang === "vi" ? "vi" : "en", width: Math.min(opts.width || 300, 400),
      });
    } catch (err) {
      el.innerHTML = '<p class="error"></p>';
      el.firstChild.textContent = err.message;
    }
  };

  D8.signOut = async function () {
    try { await D8.api("/api/auth/logout", { method: "POST" }); } catch {}
    try { window.google && window.google.accounts.id.disableAutoSelect(); } catch {}
    store.del("d8-upload-key");
    try { sessionStorage.removeItem("d8-upload-key"); } catch {}
    D8.user = null;
    location.href = "/";
  };

  D8.ready = fetch("/api/me", { credentials: "same-origin" })
    .then((r) => r.json()).then((d) => { D8.user = d.user || null; })
    .catch(() => { D8.user = null; })
    .then(() => { renderHeader(); document.dispatchEvent(new CustomEvent("d8:user", { detail: D8.user })); return D8.user; });

  /* ------------------------------------------------------------ header */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const home = page === "home" ? "" : "/";
  const ICON = {
    menu: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 5h14M2 9h14M2 13h14"/></svg>',
    close: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4l10 10M14 4 4 14"/></svg>',
    globe: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="9" cy="9" r="7"/><path d="M2 9h14M9 2c2 2 3 4.3 3 7s-1 5-3 7c-2-2-3-4.3-3-7s1-5 3-7Z"/></svg>',
    mail: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="4" width="14" height="10" rx="2"/><path d="M2.5 5l6.5 5 6.5-5"/></svg>',
    chat: D8.ICON_CHAT,
    gift: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2.5" y="7" width="13" height="8.5" rx="1"/><path d="M1.5 4.5h15V7h-15zM9 4.5v11M9 4.5C8 2 5.5 1.8 5.3 3.3 5.1 4.6 7.4 4.5 9 4.5Zm0 0c1-2.5 3.5-2.7 3.7-1.2.2 1.3-2.1 1.2-3.7 1.2Z"/></svg>',
  };

  function viewSwitch() {
    const keyAdmin = isAdminPage && document.body.dataset.authed === "1";
    if (!D8.user && !keyAdmin) return "";
    const items = [["site", "/", "sh.view.site"], ["portal", "/portal", "sh.view.portal"]];
    if (keyAdmin || D8.user.role === "admin") items.push(["admin", "/admin", "sh.view.admin"]);
    const cur = page === "portal" ? "portal" : isAdminPage ? "admin" : "site";
    return '<nav class="sh-switch" aria-label="View">' + items.map(([k, href, key]) =>
      `<a href="${href}"${k === cur ? ' aria-current="page"' : ""}>${esc(D8.t(key))}</a>`).join("") + "</nav>";
  }

  function userMenu() {
    if (!D8.user) {
      if (isAdminPage && document.body.dataset.authed === "1") return `<button class="btn small sh-keyout" type="button">${esc(D8.t("sh.signout"))}</button>`;
      return `<a class="btn small sh-signin" href="/portal">${esc(D8.t("sh.signin"))}</a>`;
    }
    const u = D8.user;
    const initials = (u.name || u.email).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const avatar = u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<span>${esc(initials)}</span>`;
    const adminLinks = u.role === "admin" ? `<a href="/admin">${esc(D8.t("sh.admintools"))}</a>` : "";
    return `<div class="sh-user">
      <button class="sh-avatar" type="button" aria-haspopup="true" aria-expanded="false" aria-label="${esc(u.name || u.email)}">${avatar}</button>
      <div class="sh-menu" role="menu" hidden>
        <div class="sh-menu-who"><b>${esc(u.name || "")}</b><span>${esc(u.email)}</span></div>
        <a href="/portal">${esc(D8.t("sh.mycases"))}</a>
        <a href="/portal#/new">${esc(D8.t("sh.newcase"))}</a>
        ${adminLinks}
        <button type="button" class="sh-out">${esc(D8.t("sh.signout"))}</button>
      </div></div>`;
  }

  function langSwitch() {
    if (isAdminPage) return "";
    return `<div class="sh-lang" role="group" aria-label="Language">${ICON.globe}
      <button type="button" data-lang="en"${D8.lang === "en" ? ' aria-pressed="true"' : ""}>EN</button><span>|</span>
      <button type="button" data-lang="vi"${D8.lang === "vi" ? ' aria-pressed="true"' : ""}>VI</button></div>`;
  }

  function subNav() {
    if (page === "portal") {
      return [["#/", "sh.mycases"], ["#/new", "sh.newcase"], ["#/profile", "sh.profile"]];
    }
    if (isAdminPage) {
      return [["/admin#jobs", null, "Ca hàng"], ["/admin#links", null, "Link xem 3D"], ["/stl", null, "HTML sang STL"],
              ["/admin#messages", null, "Tin nhắn"], ["/admin#customers", null, "Khách hàng"]];
    }
    return null;
  }

  function renderHeader() {
    const host = document.getElementById("d8-header");
    if (!host) return;
    const L = (k) => esc(D8.t(k));
    const sub = subNav();
    const signedIn = !!D8.user;
    const showSub = sub && (page === "portal" ? signedIn : (signedIn && D8.user.role === "admin") || document.body.dataset.authed === "1");
    host.className = "sh" + (page === "home" ? " sh-home" : "") + (showSub ? " sh-has-sub" : "");
    host.innerHTML = `
      <div class="sh-top"><div class="wrap sh-top-in">
        ${isAdminPage ? `<span class="sh-tag">${L("sh.top.tag")}</span>`
          : `<a class="sh-promo" href="${home}#trial">${ICON.gift}<span class="l">${L("sh.promo")}</span><span class="s">${L("sh.promo.s")}</span></a>`}
        <div class="sh-top-r">
          ${isAdminPage ? "" : `<a href="${esc(D8.waLink())}" target="_blank" rel="noopener" class="sh-wa">${ICON.chat}<span>${L("sh.wa")}</span></a>`}
          <a href="mailto:d.eightdesigncenter@gmail.com">${ICON.mail}<span>d.eightdesigncenter@gmail.com</span></a>
          ${langSwitch()}
        </div>
      </div></div>
      <div class="sh-bar"><div class="wrap sh-bar-in">
        <a class="sh-logo" href="/" aria-label="D.EIGHT DESIGN CENTER">
          <img class="full on-light" src="/brand/logo-horizontal.svg" alt="D.EIGHT DESIGN CENTER" width="127" height="36">
          <img class="full on-dark" src="/brand/logo-horizontal-reversed.svg" alt="" width="127" height="36">
          <img class="sym on-light" src="/brand/symbol.svg" alt="" width="33" height="30">
          <img class="sym on-dark" src="/brand/symbol-reversed.svg" alt="" width="33" height="30">
        </a>
        <nav class="sh-nav" aria-label="Main">
          <a href="${home}#services">${L("sh.services")}</a>
          <a href="${home}#process">${L("sh.process")}</a>
          <a href="${home}#work">${L("sh.work")}</a>
          <a href="${home}#about">${L("sh.about")}</a>
          <a href="${home}#faq">${L("sh.faq")}</a>
          <a href="${home}#contact">${L("sh.contact")}</a>
        </nav>
        <div class="sh-right">
          ${viewSwitch()}
          ${signedIn || isAdminPage ? "" : `<a class="btn btn-primary small sh-cta" href="/portal#/new">${L("sh.send")}</a>`}
          ${userMenu()}
          <button class="sh-burger" type="button" aria-expanded="false" aria-controls="sh-drawer" aria-label="${L("sh.menu")}">${ICON.menu}</button>
        </div>
      </div></div>
      ${showSub ? `<div class="sh-sub"><div class="wrap"><nav aria-label="Sections">${sub.map(([href, key, label]) =>
        `<a href="${href}" data-sub="${esc(href)}">${esc(key ? D8.t(key) : label)}</a>`).join("")}</nav></div></div>` : ""}
      <div class="sh-drawer" id="sh-drawer" hidden>
        <div class="wrap">
          ${viewSwitch()}
          <nav aria-label="Mobile">
            <a href="${home}#services">${L("sh.services")}</a>
            <a href="${home}#process">${L("sh.process")}</a>
            <a href="${home}#work">${L("sh.work")}</a>
            <a href="${home}#about">${L("sh.about")}</a>
            <a href="${home}#faq">${L("sh.faq")}</a>
            <a href="${home}#contact">${L("sh.contact")}</a>
          </nav>
          <div class="sh-drawer-foot">${langSwitch()}${signedIn ? `<button type="button" class="btn small sh-out">${L("sh.signout")}</button>` : `<a class="btn btn-primary small" href="/portal">${L("sh.signin")}</a>`}</div>
        </div>
      </div>`;
    wireHeader(host);
    markSub();
  }

  function markSub() {
    const host = document.getElementById("d8-header");
    if (!host) return;
    const here = location.pathname.replace(/\/$/, "") + (location.hash || "");
    host.querySelectorAll(".sh-sub a").forEach((a) => {
      const href = a.getAttribute("href");
      let on;
      if (page === "portal") on = (location.hash || "#/").startsWith(href) && (href !== "#/" || !/^#\/(new|profile)/.test(location.hash));
      else if (page === "stl") on = href === "/stl";
      else on = href === here || (href === "/admin#jobs" && (here === "/admin" || here === "/admin#" || here.startsWith("/admin#jobs/")));
      a.toggleAttribute("aria-current", !!on);
      if (on) a.setAttribute("aria-current", "page");
    });
  }
  window.addEventListener("hashchange", markSub);
  D8.markSub = markSub;
  D8.renderHeader = () => renderHeader();

  function wireHeader(host) {
    host.querySelectorAll(".sh-lang button").forEach((b) => b.addEventListener("click", () => D8.setLang(b.dataset.lang)));
    host.querySelectorAll(".sh-out").forEach((b) => b.addEventListener("click", D8.signOut));
    host.querySelectorAll(".sh-keyout").forEach((b) => b.addEventListener("click", () => {
      try { localStorage.removeItem("d8-upload-key"); sessionStorage.removeItem("d8-upload-key"); } catch {}
      location.href = "/admin";
    }));
    const av = host.querySelector(".sh-avatar"), menu = host.querySelector(".sh-menu");
    if (av && menu) {
      av.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = menu.hidden;
        menu.hidden = !open; av.setAttribute("aria-expanded", String(open));
      });
      document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; av.setAttribute("aria-expanded", "false"); } });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { menu.hidden = true; av.setAttribute("aria-expanded", "false"); av.focus(); } });
    }
    const burger = host.querySelector(".sh-burger"), drawer = host.querySelector(".sh-drawer");
    if (burger && drawer) {
      burger.addEventListener("click", () => {
        const open = drawer.hidden;
        drawer.hidden = !open;
        burger.setAttribute("aria-expanded", String(open));
        burger.innerHTML = open ? ICON.close : ICON.menu;
        host.classList.toggle("sh-open", open);
      });
      drawer.addEventListener("click", (e) => { if (e.target.closest("a")) { drawer.hidden = true; burger.setAttribute("aria-expanded", "false"); burger.innerHTML = ICON.menu; host.classList.remove("sh-open"); } });
    }
  }

  // Home page: transparent header over the hero, solid once scrolled.
  if (page === "home") {
    const onScroll = () => {
      const h = document.getElementById("d8-header");
      if (h) h.classList.toggle("sh-solid", window.scrollY > 40);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("DOMContentLoaded", onScroll);
    onScroll();
  }

  /* ------------------------------------------------------------ footer */
  function renderFooter() {
    const host = document.getElementById("d8-footer");
    if (!host) return;
    const L = (k) => esc(D8.t(k));
    host.className = "d8-footer sh-foot";
    host.innerHTML = `
      <div class="wrap sh-foot-grid">
        <div class="sh-foot-brand">
          <img class="logo-rev" src="/brand/logo-horizontal-reversed.svg" alt="D.EIGHT DESIGN CENTER" width="127" height="36">
          <img class="tag" src="/brand/tagline.svg" alt="Design to fit" width="120" height="26">
          <p>${L("sh.foot.blurb")}</p>
        </div>
        <div><h4>${L("sh.foot.explore")}</h4>
          <a href="${home}#services">${L("sh.services")}</a><a href="${home}#process">${L("sh.process")}</a>
          <a href="${home}#work">${L("sh.work")}</a><a href="${home}#about">${L("sh.about")}</a><a href="${home}#faq">${L("sh.faq")}</a></div>
        <div><h4>${L("sh.foot.customers")}</h4>
          <a href="/portal">${L("sh.portal")}</a><a href="/portal#/new">${L("sh.send")}</a><a href="${home}#contact">${L("sh.contact")}</a>
          <a href="${esc(D8.waLink())}" target="_blank" rel="noopener">${L("sh.wa")}</a>
          <a href="mailto:d.eightdesigncenter@gmail.com">d.eightdesigncenter@gmail.com</a></div>
        <div><h4>${L("sh.foot.legal")}</h4>
          <a href="/privacy">${L("sh.privacy")}</a><a href="/terms">${L("sh.terms")}</a></div>
      </div>
      <div class="sh-foot-bottom"><div class="wrap">
        <span class="caps">© 2026 D.EIGHT DESIGN CENTER</span>
        ${langSwitch()}
      </div></div>`;
    host.querySelectorAll(".sh-lang button").forEach((b) => b.addEventListener("click", () => D8.setLang(b.dataset.lang)));
  }

  /* ------------------------------------------------------------ boot */
  function boot() {
    if (window.D8_DICT) D8.addDict(window.D8_DICT);
    renderHeader();
    renderFooter();
    D8.applyLang();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
