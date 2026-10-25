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

  /* ------------------------------------------------------------ theme */
  // The page's inline head script already set html[data-theme] before first paint.
  const THEME_KEY = "d8-theme";
  const darkMq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  D8.themePref = () => { const t = store.get(THEME_KEY); return t === "dark" || t === "light" ? t : "auto"; };
  D8.theme = () => { const p = D8.themePref(); return p === "auto" ? (darkMq && darkMq.matches ? "dark" : "light") : p; };
  function applyTheme(animate) {
    const root = document.documentElement, t = D8.theme();
    if (animate) { root.classList.add("theme-anim"); clearTimeout(applyTheme.tm); applyTheme.tm = setTimeout(() => root.classList.remove("theme-anim"), 400); }
    root.setAttribute("data-theme", t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#0F2A52" : "#05316E");
    document.querySelectorAll(".sh-theme").forEach(paintThemeBtn);
  }
  D8.setTheme = (t) => {
    if (t === "dark" || t === "light") store.set(THEME_KEY, t); else store.del(THEME_KEY);
    applyTheme(true);
    document.dispatchEvent(new CustomEvent("d8:theme", { detail: D8.theme() }));
  };
  D8.toggleTheme = () => D8.setTheme(D8.theme() === "dark" ? "light" : "dark");
  if (darkMq) {
    const onSys = () => { if (D8.themePref() === "auto") { applyTheme(true); document.dispatchEvent(new CustomEvent("d8:theme", { detail: D8.theme() })); } };
    if (darkMq.addEventListener) darkMq.addEventListener("change", onSys); else if (darkMq.addListener) darkMq.addListener(onSys);
  }
  window.addEventListener("storage", (e) => { if (e.key === THEME_KEY) applyTheme(true); });
  function paintThemeBtn(b) {
    const dark = D8.theme() === "dark";
    const label = D8.t(dark ? "sh.theme.toLight" : "sh.theme.toDark");
    b.innerHTML = (dark ? ICON.sun : ICON.moon) + "<span>" + esc(D8.t(dark ? "sh.theme.light" : "sh.theme.dark")) + "</span>";
    b.setAttribute("aria-label", label); b.title = label;
  }
  applyTheme(false);

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
    "sh.view.admin": ["Workspace", "Quản trị"],
    "sh.mycases": ["My cases", "Ca của tôi"],
    "sh.todo": ["To do", "Việc cần làm"],
    "sh.todo.none": ["Nothing needs you right now.", "Không có việc nào cần làm."],
    "sh.newcase": ["New case", "Gửi ca mới"],
    "sh.profile": ["Profile", "Hồ sơ"],
    "sh.admintools": ["Workspace", "Khu quản trị"],
    "sh.signout": ["Sign out", "Đăng xuất"],
    "sh.top.tag": ["Remote dental CAD design · Vietnam, UTC+7", "Thiết kế CAD nha khoa từ xa · Việt Nam, UTC+7"],
    "sh.foot.blurb": ["Remote CAD design team for dental labs and clinics. Production-ready STL, designed to fit.", "Đội thiết kế CAD nha khoa từ xa cho labo và phòng khám. File STL sẵn sàng sản xuất, thiết kế vừa khít."],
    "sh.foot.explore": ["Explore", "Khám phá"],
    "sh.foot.customers": ["Customers", "Khách hàng"],
    "sh.foot.legal": ["Legal", "Pháp lý"],
    "sh.portal": ["Customer portal", "Cổng khách hàng"],
    "sh.privacy": ["Privacy policy", "Chính sách bảo mật"],
    "sh.terms": ["Terms of service", "Điều khoản dịch vụ"],
    "sh.menu": ["Menu", "Menu"],
    "sh.loading": ["Loading", "Đang tải"],
    "sh.done": ["Done", "Xong"],
    "sh.theme.dark": ["Dark", "Tối"],
    "sh.theme.light": ["Light", "Sáng"],
    "sh.theme.toDark": ["Switch to dark mode", "Chuyển sang giao diện tối"],
    "sh.theme.toLight": ["Switch to light mode", "Chuyển sang giao diện sáng"],
    "sh.promo": ["Free trial: your first 2 cases, up to US$50 in total", "Dùng thử: 2 ca đầu miễn phí, tổng đến 50 USD"],
    "sh.promo.s": ["2 free trial cases", "2 ca dùng thử miễn phí"],
    "sh.wa": ["WhatsApp · Danny Do", "WhatsApp · Danny Do"],
    "sh.wa.msg": ["Hi Danny, I'd like to know more about D.EIGHT's dental design services.", "Chào Danny, tôi muốn tìm hiểu dịch vụ thiết kế nha khoa của D.EIGHT."],
    "sh.gis.load": ["Google sign-in could not load. Check your connection or ad blocker, then reload the page.", "Không tải được nút đăng nhập Google. Kiểm tra mạng hoặc trình chặn quảng cáo rồi tải lại trang."],
    "sh.gis.cfg": ["Google sign-in is not configured yet.", "Chưa cấu hình đăng nhập Google."],
  });

  /* ------------------------------------------------------------ API + auth */
  D8.user = null;
  const HINT_KEY = "d8-hint";
  let meDone = false;
  const hint = (() => { try { const h = JSON.parse(localStorage.getItem(HINT_KEY) || "null"); return h && h.email ? h : null; } catch { return null; } })();
  const saveHint = (u) => {
    try {
      if (u) localStorage.setItem(HINT_KEY, JSON.stringify({ email: u.email, name: u.name, picture: u.picture, staff: !!u.staff, roleLabel: u.roleLabel || "", perms: u.perms || [] }));
      else localStorage.removeItem(HINT_KEY);
    } catch {}
  };
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
    "svc.Crown & bridge": ["Crown & bridge", "Mão & cầu răng"],
    "svc.Implant restorations": ["Implant restorations", "Phục hình implant"],
    "svc.All-on-X & bars": ["All-on-X & bars", "All-on-X & thanh bar"],
    "svc.Surgical guides": ["Surgical guides", "Máng hướng dẫn phẫu thuật"],
    "svc.Wax-up & smile design": ["Wax-up & smile design", "Wax-up & thiết kế nụ cười"],
    "svc.Dentures & partials": ["Dentures & partials", "Hàm tháo lắp"],
    "svc.Splints & trays": ["Splints & trays", "Máng & khay"],
    "svc.Aligner & ortho": ["Aligner & ortho", "Aligner & chỉnh nha"],
    "svc.Digital models": ["Digital models", "Mẫu hàm kỹ thuật số"],
    "svc.Trial case": ["Trial case", "Ca dùng thử"],
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
    "rx.mua": ["MUA angles / heights", "Góc / chiều cao MUA"], "rxp.mua": ["e.g. 17° posterior, straight anterior", "VD: nghiêng 17° vùng răng sau, thẳng vùng răng trước"],
    "rx.support": ["Guide support", "Kiểu tựa của máng"], "rx.sleeve": ["Guided kit / sleeve", "Bộ khoan hướng dẫn / ống dẫn khoan"], "rxp.sleeve": ["e.g. kit name, sleeve Ø", "VD: tên bộ khoan, đường kính ống dẫn"],
    "rx.sites": ["Implant sites", "Vị trí implant"], "rxp.sites": ["e.g. 36, 46", "VD: 36, 46"],
    "rx.restoration": ["Restoration type", "Loại phục hình"], "rx.cement_gap": ["Cement gap / min. thickness", "Khe hở xi măng / độ dày tối thiểu"],
    "rxp.cement_gap": ["e.g. 0.05 mm / 0.8 mm", "VD: 0,05 mm / 0,8 mm"],
    "rx.photo": ["Smile photo", "Ảnh nụ cười"], "rx.base": ["Base", "Nền hàm"], "rx.teeth_library": ["Teeth library / mould", "Thư viện răng / khuôn răng"],
    "rx.appliance": ["Appliance", "Loại khí cụ"], "rx.thickness": ["Thickness", "Độ dày"], "rxp.thickness": ["e.g. 2.0 mm", "VD: 2,0 mm"],
    "rx.goals": ["Treatment goals", "Mục tiêu điều trị"], "rx.model": ["Model type", "Loại mẫu"],
    "rx.choose": ["Choose…", "Chọn…"],
    "rxo.Upper": ["Upper", "Hàm trên"], "rxo.Lower": ["Lower", "Hàm dưới"], "rxo.Both": ["Both", "Cả hai hàm"],
    "rxo.Screw-retained crown": ["Screw-retained crown", "Mão bắt vít"], "rxo.Cement-retained crown": ["Cement-retained crown", "Mão gắn xi măng"],
    "rxo.Custom abutment + crown": ["Custom abutment + crown", "Abutment cá nhân hóa + mão"], "rxo.Ti-base crown": ["Ti-base crown", "Mão trên Ti-base"],
    "rxo.Implant bridge": ["Implant bridge", "Cầu trên implant"], "rxo.Hybrid bridge": ["Hybrid bridge", "Cầu hybrid"], "rxo.Bar": ["Bar", "Thanh bar"],
    "rxo.Bar + overlay": ["Bar + overlay", "Thanh bar + phục hình phủ (overlay)"], "rxo.Provisional (PMMA)": ["Provisional (PMMA)", "Phục hình tạm (PMMA)"],
    "rxo.Tooth-supported": ["Tooth-supported", "Tựa răng"], "rxo.Tissue-supported": ["Tissue-supported", "Tựa niêm mạc"], "rxo.Bone-supported": ["Bone-supported", "Tựa xương"],
    "rxo.Full contour": ["Full contour", "Nguyên khối"], "rxo.Cutback": ["Cutback", "Cut-back (chừa chỗ đắp sứ)"], "rxo.Coping / framework": ["Coping / framework", "Sườn / khung"],
    "rxo.Veneer": ["Veneer", "Mặt dán sứ (veneer)"], "rxo.Inlay / onlay": ["Inlay / onlay", "Inlay / onlay"], "rxo.Post and core": ["Post and core", "Cùi giả có chốt"],
    "rxo.Photo attached": ["Photo attached", "Có ảnh kèm theo"], "rxo.No photo": ["No photo", "Không có ảnh"],
    "rxo.Hard acrylic": ["Hard acrylic", "Nhựa cứng"], "rxo.Flexible": ["Flexible", "Nhựa dẻo"], "rxo.Metal framework": ["Metal framework", "Hàm khung kim loại"],
    "rxo.Night guard": ["Night guard", "Máng chống nghiến"], "rxo.Michigan splint": ["Michigan splint", "Máng Michigan"], "rxo.Kois deprogrammer": ["Kois deprogrammer", "Máng Kois"],
    "rxo.Sleep appliance": ["Sleep appliance", "Khí cụ chống ngáy"], "rxo.Retainer": ["Retainer", "Hàm duy trì"], "rxo.Bleach tray": ["Bleach tray", "Máng tẩy trắng"],
    "rxo.Custom impression tray": ["Custom impression tray", "Khay lấy dấu cá nhân"], "rxo.Dies": ["Dies", "Mẫu die (cùi tháo rời)"], "rxo.Articulated model": ["Articulated model", "Mẫu lên càng nhai"],
    "rxo.Ortho model": ["Ortho model", "Mẫu chỉnh nha"], "rxo.Implant model with gingiva": ["Implant model with gingiva", "Mẫu implant có nướu giả"],
    "tr.orig": ["Original", "Bản gốc"], "tr.in.vi": ["Vietnamese version", "Bản tiếng Việt"], "tr.in.en": ["English version", "Bản tiếng Anh"], "tr.all": ["Translate all", "Dịch tất cả"], "tr.auto": ["Always translate", "Luôn dịch"],
    "bill.price": ["Price", "Giá"], "bill.trial": ["Free trial", "Dùng thử miễn phí"], "bill.due": ["Awaiting payment", "Chờ thanh toán"], "bill.paid": ["Paid", "Đã thanh toán"],
    "pay.via.paypal": ["PayPal", "PayPal"], "pay.via.stripe": ["card (Stripe)", "thẻ (Stripe)"], "pay.via.manual": ["bank transfer", "chuyển khoản"], "pay.via.claim": ["transfer", "chuyển khoản"],
    "pay.ev.paid": ["Payment confirmed", "Đã xác nhận thanh toán"], "pay.ev.sent": ["Payment sent, being confirmed", "Đã gửi thanh toán, đang xác nhận"], "pay.ev.rejected": ["Payment not received", "Chưa nhận được thanh toán"],
    "bill.check": ["Confirming payment", "Đang xác nhận thanh toán"],
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
    if (m.by === "system") {
      const pay = /^pay:(paid|sent|rejected)(?::(\w+))?$/.exec(m.text);
      if (pay) {
        const via = pay[2] ? " · " + D8.t("pay.via." + pay[2], pay[2]) : "";
        const cls = pay[1] === "paid" ? "pay-paid" : pay[1] === "sent" ? "pay-check" : "pay-due";
        return `<div class="sys">${D8.esc(D8.fmtDate(m.at, true))} · <span class="pay ${cls}">${D8.esc(D8.t("pay.ev." + pay[1]) + via)}</span></div>`;
      }
      const s = String(m.text).replace(/^status:/, "");
      return `<div class="sys">${D8.esc(D8.fmtDate(m.at, true))} · <span class="st st-${D8.esc(s)}">${D8.esc(D8.statusLabel(s))}</span></div>`;
    }
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
  // gzip where it helps, split into 20 MB parts, PUT each part to <base>/<fid>/<n>; returns what to attach
  D8.uploadParts = async function (base, files, opts = {}) {
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
            await putPart(`${base}/${fid}/${n}`, part, (loaded) => {
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
    return metas;
  };
  D8.uploadJobFiles = async function (jobId, files, opts = {}) {
    const base = `/api/jobs/${encodeURIComponent(jobId)}/files`;
    const metas = await D8.uploadParts(base, files, opts);
    return D8.api(base, { method: "POST", body: { files: metas, deliver: !!opts.deliver, ...(opts.kind ? { kind: opts.kind } : {}) } });
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
      saveHint(D8.user);
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

  /* ------------------------------------------------------------ motion helpers */
  // Busy: spinner replaces the label (CSS keeps the width). Done: a tick draws in, then the label returns.
  D8.busy = (btn, on) => {
    if (!btn) return;
    if (on) { btn.setAttribute("aria-busy", "true"); btn.disabled = true; }
    else { btn.removeAttribute("aria-busy"); btn.disabled = false; }
  };
  const TICK = '<svg class="tick" width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 9.5l3.6 3.6L14.5 5"/></svg>';
  D8.done = (btn, label, ms) => {
    if (!btn || !btn.isConnected) return;
    D8.busy(btn, false);
    if (btn.dataset.idle == null) btn.dataset.idle = btn.innerHTML;
    clearTimeout(btn._doneT);
    btn.classList.add("is-done");
    btn.innerHTML = TICK + "<span>" + esc(label || D8.t("sh.done")) + "</span>";
    btn._doneT = setTimeout(() => {
      btn.classList.remove("is-done");
      if (btn.dataset.idle != null) { btn.innerHTML = btn.dataset.idle; delete btn.dataset.idle; }
    }, ms || 1600);
  };
  // Restart the short fade/slide-in on content the router just swapped in.
  D8.animIn = (el) => { if (!el) return; el.classList.remove("view-in"); void el.offsetWidth; el.classList.add("view-in"); };
  // Skeleton placeholders so a loading screen is never blank.
  const line = (w, h) => `<span class="sk sk-line w${w}${h ? " h" + h : ""}"></span>`;
  D8.skel = {
    rows(n) {
      let out = "";
      for (let i = 0; i < (n || 3); i++) out += `<div class="sk-row"><div>${line(20)}${line(i % 2 ? 40 : 60, 18)}${line(30)}</div><span class="sk sk-pill"></span></div>`;
      return `<div class="sk-list" role="status" aria-label="${esc(D8.t("sh.loading"))}">${out}</div>`;
    },
    card(lines) {
      let out = line(30, 18);
      for (let i = 0; i < (lines || 3); i++) out += line([100, 80, 60][i % 3]);
      return `<div class="sk-card">${out}</div>`;
    },
    page() {
      return `<div role="status" aria-label="${esc(D8.t("sh.loading"))}"><span class="sk sk-steps"></span><div class="sk-grid"><div>${D8.skel.card(3)}${D8.skel.card(4)}</div><div>${D8.skel.card(5)}</div></div></div>`;
    },
    form() {
      return `<div class="sk-grid" role="status" aria-label="${esc(D8.t("sh.loading"))}"><div class="sk-card">${line(30, 18)}${line(20)}${line(100, 28)}${line(20)}${line(100, 28)}${line(40, 28)}</div><div>${D8.skel.card(4)}</div></div>`;
    },
    tableRows(cols, n) {
      let out = "";
      for (let i = 0; i < (n || 4); i++) out += "<tr>" + Array.from({ length: cols }, (_, c) => `<td>${line(c ? 60 : 80)}</td>`).join("") + "</tr>";
      return out;
    },
  };

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
    saveHint(null);
    location.href = "/";
  };

  D8.ready = fetch("/api/me", { credentials: "same-origin" })
    .then((r) => r.json()).then((d) => { D8.user = d.user || null; })
    .catch(() => { D8.user = null; })
    .then(() => { meDone = true; saveHint(D8.user); renderHeader(); document.dispatchEvent(new CustomEvent("d8:user", { detail: D8.user })); return D8.user; });

  /* ------------------------------------------------------------ header */
  // The account last seen on this browser draws the header (and the workspace sidebar) at its final
  // size before /api/me answers, so nothing jumps while the page loads; the real answer replaces it.
  function who() { return D8.user || (!meDone ? hint : null); }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const home = page === "home" ? "" : "/";
  const aboutCur = page === "about" ? ' aria-current="page"' : "";
  const ICON = {
    menu: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 5h14M2 9h14M2 13h14"/></svg>',
    close: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4l10 10M14 4 4 14"/></svg>',
    globe: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="9" cy="9" r="7"/><path d="M2 9h14M9 2c2 2 3 4.3 3 7s-1 5-3 7c-2-2-3-4.3-3-7s1-5 3-7Z"/></svg>',
    mail: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="4" width="14" height="10" rx="2"/><path d="M2.5 5l6.5 5 6.5-5"/></svg>',
    chat: D8.ICON_CHAT,
    moon: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M15.2 11.3A6.6 6.6 0 0 1 6.7 2.8a6.6 6.6 0 1 0 8.5 8.5Z"/></svg>',
    sun: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="9" r="3.2"/><path d="M9 1.5v1.8M9 14.7v1.8M1.5 9h1.8M14.7 9h1.8M3.7 3.7l1.3 1.3M13 13l1.3 1.3M3.7 14.3 5 13M13 5l1.3-1.3"/></svg>',
    bell: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M5 8.5a5 5 0 0 1 10 0c0 4 1.5 5.5 1.5 5.5h-13S5 12.5 5 8.5Z"/><path d="M8.2 16.5a1.9 1.9 0 0 0 3.6 0"/></svg>',
    gift: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2.5" y="7" width="13" height="8.5" rx="1"/><path d="M1.5 4.5h15V7h-15zM9 4.5v11M9 4.5C8 2 5.5 1.8 5.3 3.3 5.1 4.6 7.4 4.5 9 4.5Zm0 0c1-2.5 3.5-2.7 3.7-1.2.2 1.3-2.1 1.2-3.7 1.2Z"/></svg>',
  };

  function viewSwitch() {
    const keyAdmin = isAdminPage && document.body.dataset.authed === "1";
    if (!who() && !keyAdmin) return "";
    const items = [["site", "/", "sh.view.site"], ["portal", "/portal", "sh.view.portal"]];
    if (keyAdmin || (who() && who().staff)) items.push(["admin", "/admin", "sh.view.admin"]);
    const cur = page === "portal" ? "portal" : isAdminPage ? "admin" : "site";
    return '<nav class="sh-switch" aria-label="View">' + items.map(([k, href, key]) =>
      `<a href="${href}"${k === cur ? ' aria-current="page"' : ""}>${esc(D8.t(key))}</a>`).join("") + "</nav>";
  }

  // ---- notifications: each page reports what needs this person (D8.notify.set(source, items)); the bell shows the total.
  // Items: { key, n, text, href }. Portal cases are counted from the list the page already has (no extra storage reads).
  const NOTE = { sources: {}, open: false };
  const noteItems = () => Object.values(NOTE.sources).flat().filter((x) => x && x.n > 0);
  function bellHtml() {
    const keyAdmin = isAdminPage && document.body.dataset.authed === "1";
    if (!(page === "portal" || isAdminPage) || !(who() || keyAdmin)) return "";
    const items = noteItems(), n = items.reduce((t, x) => t + x.n, 0);
    return `<div class="sh-bell"><button class="sh-bell-btn" type="button" aria-haspopup="true" aria-expanded="${NOTE.open}" aria-label="${esc(D8.t("sh.todo"))}${n ? " (" + n + ")" : ""}">${ICON.bell}<span class="sh-bell-n"${n ? "" : " hidden"}>${n > 99 ? "99+" : n}</span></button>
      <div class="sh-bell-pop" role="menu"${NOTE.open ? "" : " hidden"}><div class="sh-bell-h">${esc(D8.t("sh.todo"))}</div>
      ${items.length ? items.map((x) => `<a href="${esc(x.href)}" role="menuitem"><b>${x.n}</b><span>${esc(x.text)}</span></a>`).join("") : `<p class="sh-bell-none">${esc(D8.t("sh.todo.none"))}</p>`}</div></div>`;
  }
  function paintBell() { const el = document.querySelector("#d8-header .sh-bell"); if (el) el.outerHTML = bellHtml(); }
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest(".sh-bell-btn")) { NOTE.open = !NOTE.open; paintBell(); return; }
    if (NOTE.open && (!t.closest(".sh-bell-pop") || t.closest(".sh-bell-pop a"))) { NOTE.open = false; paintBell(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && NOTE.open) { NOTE.open = false; paintBell(); const b = document.querySelector(".sh-bell-btn"); if (b) b.focus(); } });
  D8.notify = { set(source, items) { NOTE.sources[source] = Array.isArray(items) ? items : []; paintBell(); }, items: noteItems };

  function userMenu() {
    if (!who()) {
      if (isAdminPage && document.body.dataset.authed === "1") return `<button class="btn small sh-keyout" type="button">${esc(D8.t("sh.signout"))}</button>`;
      return `<a class="btn small sh-signin" href="/portal">${esc(D8.t("sh.signin"))}</a>`;
    }
    const u = who();
    const initials = (u.name || u.email).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const avatar = u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<span>${esc(initials)}</span>`;
    const adminLinks = u.staff ? `<a href="/admin">${esc(D8.t("sh.admintools"))}</a>` : "";
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

  // Workspace sections, each shown only to staff with the permission it needs.
  const WS_ICON = {
    home: '<path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z"/>',
    jobs: '<rect x="3" y="4" width="14" height="13" rx="2"/><path d="M7 8h6M7 11h6M7 14h3"/>',
    customers: '<circle cx="8" cy="7.5" r="3"/><path d="M2.5 17c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M13.5 4.8a2.8 2.8 0 0 1 0 5.4M15.5 12.8c1.2.7 1.9 2 2.2 4.2"/>',
    prices: '<path d="M10.5 3H16a1 1 0 0 1 1 1v5.5l-7.5 7.5L3 10.5z"/><circle cx="13.2" cy="6.8" r="1.2"/>',
    staff: '<circle cx="10" cy="7" r="3.2"/><path d="M4 17c.7-3.2 3-5 6-5s5.3 1.8 6 5"/><path d="M15.5 3.5l1 1 2-2"/>',
    links: '<path d="M10 2.5 17 6.5v7L10 17.5 3 13.5v-7z"/><path d="M3 6.5 10 10.5l7-4M10 10.5v7"/>',
    stl: '<path d="M4 3h8l4 4v10H4z"/><path d="M12 3v4h4M7 11h6M7 14h4"/>',
    messages: '<path d="M3 5h14v9H8l-4 3v-3H3z"/>',
    orders: '<path d="M6 3.5h8a1 1 0 0 1 1 1V17a.5.5 0 0 1-.8.4L12 16l-2 1.5L8 16l-2.2 1.4A.5.5 0 0 1 5 17V4.5a1 1 0 0 1 1-1z"/><path d="M8 7.5h4M8 10.5h4"/>',
    reports: '<path d="M3.5 16.5h13"/><path d="M6 13.5v-4M10 13.5V6M14 13.5v-6"/>',
    team: '<circle cx="7" cy="7" r="2.6"/><path d="M2.5 16c.5-2.6 2.2-4 4.5-4s4 1.4 4.5 4"/><path d="M12.5 9.5l2-2 1.5 1.5 2-2.5M12.5 16h5"/>',
    me: '<circle cx="10" cy="6.5" r="3"/><path d="M4.5 17c.6-3 2.7-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><path d="M13.8 2.8l1 1 2-2"/>',
    import: '<path d="M4 13v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3"/><path d="M10 3v9M6.5 8.5 10 12l3.5-3.5"/>',
    settings: '<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  };
  D8.WS_NAV = [["home", "/admin#home", "Tổng quan", ""], ["orders", "/admin#orders", "Đơn hàng", ""], ["jobs", "/admin#jobs", "Ca cổng khách", ""],
    ["customers", "/admin#customers", "Khách hàng", "customers.view"], ["prices", "/admin#catalog", "Mã hàng & bảng giá", ["pricing.manage", "techpay.manage"]],
    ["me", "/admin#me", "Công của tôi", () => D8.can("cases.design") && !(D8.can("staff.manage") || D8.can("techpay.manage") || D8.can("reports.view"))],
    ["team", "/admin#team", "Kỹ thuật viên", ["staff.manage", "techpay.manage", "reports.view"]],
    ["reports", "/admin#reports", "Báo cáo", "reports.view"], ["import", "/admin#import", "Nhập Excel", ["orders.edit", "pricing.manage", "customers.edit", "billing.edit"]],
    ["staff", "/admin#staff", "Nhân sự & phân quyền", "staff.manage"], ["settings", "/admin#settings", "Cài đặt", "staff.manage"],
    ["links", "/admin#links", "Link xem 3D", "links.manage"], ["stl", "/stl", "HTML sang STL", "links.manage"], ["messages", "/admin#messages", "Tin nhắn web", "messages.view"]];
  // Permission check for the workspace (the admin password counts as an owner with every permission).
  D8.can = (p) => (isAdminPage && document.body.dataset.authMode === "key") || !!(who() && Array.isArray(who().perms) && who().perms.includes(p));
  function subNav() {
    if (page === "portal") {
      return [["#/", "sh.mycases"], ["#/new", "sh.newcase"], ["#/profile", "sh.profile"]];
    }
    if (isAdminPage) return D8.WS_NAV.filter((n) => !n[3] || (typeof n[3] === "function" ? n[3]() : Array.isArray(n[3]) ? n[3].some((p) => D8.can(p)) : D8.can(n[3]))).map(([k, href, label]) => [href, null, label, k]);
    return null;
  }
  // Workspace sidebar (admin page); other workspace pages use the tab row under the header.
  function renderSide(sub) {
    const side = document.getElementById("wsNav");
    if (!side) return false;
    const on = isAdminPage && (document.body.dataset.authed === "1" || (!meDone && !!hint && !!hint.staff));
    side.hidden = !on;
    document.querySelector(".ws") && document.querySelector(".ws").classList.toggle("has-nav", on);
    if (!on) { side.innerHTML = ""; return true; }
    const u = who();
    side.innerHTML = `<div class="ws-who">${u ? `<b>${esc(u.name || u.email)}</b><span>${esc(u.roleLabel || "")}</span>` : "<b>D.EIGHT</b><span>Mật khẩu quản trị</span>"}</div>
      <nav aria-label="Khu quản trị">${sub.map(([href, , label, k]) => `<a href="${href}" data-sub="${esc(href)}"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${WS_ICON[k] || ""}</svg><span>${esc(label)}</span></a>`).join("")}</nav>
      <div class="ws-side-foot"><a href="/">${esc(D8.t("sh.view.site"))}</a><a href="/portal">${esc(D8.t("sh.view.portal"))}</a></div>`;
    return true;
  }

  function renderHeader() {
    const host = document.getElementById("d8-header");
    if (!host) return;
    const L = (k) => esc(D8.t(k));
    const sub = subNav();
    const signedIn = !!who();
    if (meDone || document.body.dataset.authed === "1") document.documentElement.classList.remove("sub-pre", "ws-pre");
    const sideNav = isAdminPage && renderSide(sub || []);
    const showSub = sub && !sideNav && (page === "portal" ? signedIn : document.body.dataset.authed === "1");
    host.className = "sh" + (page === "home" ? " sh-home" : "") + (showSub ? " sh-has-sub" : "");
    host.innerHTML = `
      <div class="sh-top"><div class="wrap sh-top-in">
        ${isAdminPage ? `<span class="sh-tag">${L("sh.top.tag")}</span>`
          : `<a class="sh-promo" href="${home}#trial">${ICON.gift}<span class="l">${L("sh.promo")}</span><span class="s">${L("sh.promo.s")}</span></a>`}
        <div class="sh-top-r">
          ${isAdminPage ? "" : `<a href="${esc(D8.waLink())}" target="_blank" rel="noopener" class="sh-wa">${ICON.chat}<span>${L("sh.wa")}</span></a>`}
          <a href="mailto:d.eightdesigncenter@gmail.com">${ICON.mail}<span>d.eightdesigncenter@gmail.com</span></a>
          ${langSwitch()}
          <button type="button" class="sh-theme"></button>
        </div>
      </div></div>
      <div class="sh-bar"><div class="wrap sh-bar-in">
        <a class="sh-logo" href="/" aria-label="D.EIGHT DESIGN CENTER">
          <img class="full on-light" src="/brand/logo-horizontal.svg" alt="D.EIGHT DESIGN CENTER" width="127" height="36">
          <img class="full on-dark" src="/brand/logo-horizontal-reversed.svg" alt="" width="127" height="36">
          <img class="sym on-light" src="/brand/symbol.svg" alt="" width="33" height="30">
          <img class="sym on-dark" src="/brand/symbol-reversed.svg" alt="" width="33" height="30">
        </a>
        ${isAdminPage ? `<span class="sh-ws">Workspace</span>` : ""}
        <nav class="sh-nav" aria-label="Main"${isAdminPage ? " hidden" : ""}>
          <a href="${home}#services">${L("sh.services")}</a>
          <a href="${home}#process">${L("sh.process")}</a>
          <a href="${home}#work">${L("sh.work")}</a>
          <a href="/about"${aboutCur}>${L("sh.about")}</a>
          <a href="${home}#faq">${L("sh.faq")}</a>
          <a href="${home}#contact">${L("sh.contact")}</a>
        </nav>
        <div class="sh-right">
          ${viewSwitch()}
          ${signedIn || isAdminPage ? "" : `<a class="btn btn-primary small sh-cta" href="/portal#/new">${L("sh.send")}</a>`}
          ${bellHtml()}
          ${userMenu()}
          <button class="sh-burger" type="button" aria-expanded="false" aria-controls="sh-drawer" aria-label="${L("sh.menu")}">${ICON.menu}</button>
        </div>
      </div></div>
      ${showSub ? `<div class="sh-sub"><div class="wrap"><nav aria-label="Sections">${sub.map(([href, key, label]) =>
        `<a href="${href}" data-sub="${esc(href)}">${esc(key ? D8.t(key) : label)}</a>`).join("")}</nav></div></div>` : ""}
      <div class="sh-drawer" id="sh-drawer" hidden>
        <div class="wrap">
          ${viewSwitch()}
          <nav aria-label="Mobile"${isAdminPage ? " hidden" : ""}>
            <a href="${home}#services">${L("sh.services")}</a>
            <a href="${home}#process">${L("sh.process")}</a>
            <a href="${home}#work">${L("sh.work")}</a>
            <a href="/about"${aboutCur}>${L("sh.about")}</a>
            <a href="${home}#faq">${L("sh.faq")}</a>
            <a href="${home}#contact">${L("sh.contact")}</a>
          </nav>
          <div class="sh-drawer-foot">${langSwitch()}<button type="button" class="sh-theme"></button>${signedIn ? `<button type="button" class="btn small sh-out">${L("sh.signout")}</button>` : `<a class="btn btn-primary small" href="/portal">${L("sh.signin")}</a>`}</div>
        </div>
      </div>`;
    wireHeader(host);
    markSub();
  }

  function markSub() {
    const host = document.getElementById("d8-header");
    if (!host) return;
    const here = location.pathname.replace(/\/$/, "") + (location.hash || "");
    const ALIAS = { cust: "customers", prices: "catalog" };
    let section = (here.match(/^\/admin#([a-z]+)/) || [, "home"])[1];
    section = ALIAS[section] || section;
    document.querySelectorAll("#d8-header .sh-sub a, #wsNav nav a").forEach((a) => {
      const href = a.getAttribute("href");
      let on;
      if (page === "portal") on = (location.hash || "#/").startsWith(href) && (href !== "#/" || !/^#\/(new|profile)/.test(location.hash));
      else if (page === "stl") on = href === "/stl";
      else on = href === "/admin#" + section;
      a.toggleAttribute("aria-current", !!on);
      if (on) a.setAttribute("aria-current", "page");
    });
  }
  window.addEventListener("hashchange", markSub);
  D8.markSub = markSub;
  D8.renderHeader = () => renderHeader();

  function wireHeader(host) {
    host.querySelectorAll(".sh-lang button").forEach((b) => b.addEventListener("click", () => D8.setLang(b.dataset.lang)));
    host.querySelectorAll(".sh-theme").forEach((b) => { paintThemeBtn(b); b.addEventListener("click", D8.toggleTheme); });
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
      // Slide/fade the menu in and out; a scrim behind it closes it on tap.
      let scrim = document.querySelector(".sh-scrim");
      if (!scrim) { scrim = document.createElement("div"); scrim.className = "sh-scrim"; document.body.appendChild(scrim); }
      scrim.hidden = true; scrim.classList.remove("open"); // header re-rendered: start closed
      let closeT = null;
      const setOpen = (open) => {
        clearTimeout(closeT);
        burger.setAttribute("aria-expanded", String(open));
        burger.innerHTML = open ? ICON.close : ICON.menu;
        if (open) {
          drawer.hidden = false; scrim.hidden = false;
          host.classList.add("sh-open");
          void drawer.offsetWidth;
          drawer.classList.add("open"); scrim.classList.add("open");
        } else {
          drawer.classList.remove("open"); scrim.classList.remove("open");
          closeT = setTimeout(() => { drawer.hidden = true; scrim.hidden = true; host.classList.remove("sh-open"); }, 260);
        }
      };
      burger.addEventListener("click", () => setOpen(!drawer.classList.contains("open")));
      scrim.onclick = () => setOpen(false);
      drawer.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawer.classList.contains("open")) { setOpen(false); burger.focus(); } });
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
    if (isAdminPage) {
      // the workspace gets a one-line footer, not the marketing one
      host.className = "d8-footer sh-foot sh-foot-ws";
      host.innerHTML = `<div class="wrap"><span>© ${new Date().getFullYear()} D.EIGHT DESIGN CENTER · Workspace</span>
        <nav aria-label="Liên kết"><a href="/">${L("sh.view.site")}</a><a href="/portal">${L("sh.view.portal")}</a><a href="/privacy">${L("sh.privacy")}</a><a href="/terms">${L("sh.terms")}</a></nav></div>`;
      return;
    }
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
          <a href="${home}#work">${L("sh.work")}</a><a href="/about"${aboutCur}>${L("sh.about")}</a><a href="${home}#faq">${L("sh.faq")}</a></div>
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
