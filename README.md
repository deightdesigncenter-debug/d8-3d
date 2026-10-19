# D.EIGHT DESIGN CENTER — trang web, cổng khách hàng và công cụ quản trị

Một trang web duy nhất gồm trang giới thiệu (tiếng Anh / tiếng Việt), cổng khách hàng đăng nhập bằng Google, trang quản trị ca hàng, link xem thiết kế 3D cho bác sĩ và công cụ chuyển HTML exocad sang STL. Mọi trang dùng chung một thanh đầu trang, chân trang và thanh chuyển **Trang web / Khách hàng / Quản trị**.

- Trang web: `https://3d.d8designcenter.com/` (địa chỉ tạm: `https://d8-3d.pages.dev`)
- Cổng khách hàng: `/portal`
- Quản trị: `/admin` (Ca hàng, Link xem 3D, Tin nhắn, Khách hàng) và `/stl`
- Link gửi bác sĩ: `/v/<mã>`
- Pháp lý: `/privacy`, `/terms` (Google yêu cầu khi cho khách đăng nhập)

## Đăng nhập

- **Khách hàng** đăng nhập bằng Google (Google Identity Services). Máy chủ kiểm tra chữ ký ID token bằng khóa công khai của Google (RS256), rồi đặt cookie phiên `d8s` (ký HMAC, HttpOnly, SameSite=Lax, 30 ngày). Không lưu mật khẩu, chỉ nhận tên, email, ảnh đại diện.
- **Quản trị**: email trong `ADMIN_EMAILS` (mặc định `d.eightdesigncenter@gmail.com`) đăng nhập Google là vào được `/admin` và `/stl`. Mật khẩu `UPLOAD_PASSWORD` cũ vẫn dùng được (header `X-Upload-Key`, chỉ gửi từ trang quản trị).
- Chống giả mạo yêu cầu: yêu cầu ghi từ trang khác bị chặn (kiểm tra `Origin`), yêu cầu dùng cookie phải có header `X-D8: 1`.
- Client ID Google (công khai) nằm trong `_worker.js` (`GOOGLE_CLIENT_ID`), có thể ghi đè bằng biến môi trường cùng tên. Không cần client secret.

## Cổng khách hàng (`/portal`)

- Gửi ca mới: mã tham chiếu, dịch vụ, răng (FDI/Universal), vật liệu, màu, ngày cần, yêu cầu, link file và file tải lên.
- File được nén gzip trong trình duyệt khi có lợi, chia phần 20 MB, lưu KV khóa `jf:<ca>:<file>:<phần>`, tự xóa sau 60 ngày. Tối đa 300 MB mỗi ca.
- Trạng thái: Đã nhận → (Cần bổ sung) → Đang thiết kế → Chờ duyệt → Đã duyệt → Đã giao (hoặc Đã hủy).
- Khách xem link 3D, bấm **Duyệt thiết kế**, nhắn tin, tải file hoàn chỉnh (từng file hoặc cả ca dạng ZIP). Mã ca dạng `D8-YYMMDD-XXXX`.
- Phiếu chỉ định có thêm ô riêng theo dịch vụ (implant, All-on-X, máng, hàm tháo lắp…), lưu ở `rx` của ca.
- **Dùng thử miễn phí:** 2 ca đầu của mỗi khách tự được đánh dấu `trial` (tổng giá trị đến 50 USD; hằng số `TRIAL_CASES`, `TRIAL_CREDIT_USD` trong `_worker.js`).
- Danh sách ca của khách đọc từ chỉ mục `own:<email>` (không tốn lượt "list" của KV).

## Quản trị (`/admin`)

- **Ca hàng**: lọc theo trạng thái, tìm theo mã/tên/email, dấu "Khách vừa nhắn". Trong từng ca: đổi trạng thái, tải file của khách, tạo link 3D từ HTML exocad và gắn vào ca (tự chuyển sang Chờ duyệt), tải file STL hoàn chỉnh lên để giao (tự chuyển Đã giao), nhắn tin với mẫu soạn sẵn.
- **Link xem 3D**: tạo link gửi bác sĩ như trước (QR, tin nhắn tiếng Anh kèm bản tiếng Việt).
- **Tin nhắn**: tin từ form Liên hệ trên trang web, tự xóa sau 180 ngày.
- **Khách hàng**: các tài khoản đã đăng nhập, lab, quốc gia, số điện thoại, số ca.
- **Báo giá & thanh toán** trong từng ca: giá ca (USD), số tiền khách cần trả (để trống = bằng giá ca, dùng khi chỉ thu phần vượt dùng thử), trạng thái Chưa báo giá / Miễn phí (dùng thử) / Chờ thanh toán / Đã thanh toán; hiện số tiền dùng thử đã dùng / 50 USD của khách. **Giá chỉ admin thấy**: khách chỉ thấy số tiền khi ca ở trạng thái Chờ thanh toán (hoặc số đã trả).
- **Xuất CSV** (mở bằng Excel): ca hàng, khách hàng, tin nhắn.

## Dịch tin nhắn Anh ↔ Việt

- Dưới mỗi tin của bên kia có nút **Dịch / Translate**. Bản dịch lưu luôn vào tin nhắn nên lần sau mở không phải dịch lại. Quản trị viết tiếng Việt rồi bấm **Dịch sang tiếng Anh**: khách nhận bản tiếng Anh, quản trị vẫn thấy bản gốc tiếng Việt.
- Dùng **Cloudflare Workers AI** (binding tên `AI` trong Settings → Bindings của dự án Pages). Mô hình: `@cf/google/gemma-4-26b-a4b-it`, dự phòng `@cf/meta/llama-3.1-8b-instruct-fp8`, cuối cùng `@cf/meta/m2m100-1.2b`. Gói miễn phí 10.000 neuron/ngày (khoảng hơn 1.000 lượt dịch tin ngắn).
- Chưa gắn binding `AI` thì nút Dịch dùng trình dịch có sẵn của Chrome (nếu có), nếu không thì mở Google Dịch ở thẻ mới.

## Công cụ AI (cần binding `AI`)

- **Tóm tắt cho KTV** (trang quản trị, trong từng ca): AI đọc phiếu chỉ định và tin nhắn rồi tóm tắt bằng tiếng Việt thành 3 phần: Tóm tắt, Yêu cầu thiết kế, Cần hỏi lại. Tự tạo lần đầu mở ca, lưu trong ca (`job.ai`, khách không thấy), bấm Làm mới khi có tin mới.
- **Gợi ý trả lời** (quản trị): gõ vài ý tiếng Việt (hoặc để trống) rồi bấm, AI soạn câu trả lời tiếng Anh kèm bản tiếng Việt; bạn sửa rồi mới gửi.
- **Luôn dịch**: công tắc trên khung chat (lưu theo trình duyệt) để tự dịch tin của bên kia.
- **Điền phiếu tự động từ Rx** (cổng khách hàng): khách dán chữ hoặc chụp ảnh phiếu, AI điền các ô và tô sáng để khách kiểm tra. Bỏ qua thông tin bệnh nhân.
- **Kiểm tra trước khi gửi** (cổng khách hàng): báo thiếu thông tin theo loại ca (hệ implant, scan body, DICOM, file khớp cắn…), file hỏng, và tên bệnh nhân lỡ ghi (AI).
- Chưa bật binding `AI` thì các nút AI tự ẩn, phần kiểm tra trước khi gửi vẫn chạy (trừ bước tìm tên bệnh nhân).

## Kiểm tra file trong trình duyệt

Khi chọn file, trang đọc nhanh file ngay trên máy (không tải lên): STL nhị phân/ASCII, số tam giác, kích thước (mm), cảnh báo đơn vị nghi sai (quá nhỏ hoặc quá lớn), file hỏng hoặc rỗng; PLY và ZIP kiểm tra phần đầu file. Với file giao cho khách (trang quản trị) còn kiểm tra lưới có kín không.

## Liên hệ WhatsApp

Số WhatsApp của Danny Do (`D8.WA` trong `shell.js`): +84 70 323 3263, link `https://wa.me/84703233263` kèm lời chào theo ngôn ngữ trang. Có ở thanh trên cùng, nút nổi trên trang chủ, mục Liên hệ, chân trang, trang đăng nhập và tin nhắn trong ca.

## Chuyển HTML sang STL (`/stl`)

Tách các lớp lưới 3D trong file HTML của exocad thành file STL, xử lý hoàn toàn trong trình duyệt (không tải file lên máy chủ). Tọa độ giữ nguyên hệ tọa độ exocad (mm). Tải từng lớp, nhiều lớp dạng `.zip`, hoặc gộp thành 1 file.

## Cấu trúc thư mục

| Đường dẫn | Vai trò |
|---|---|
| `public/_worker.js` | Máy chủ (Cloudflare Pages, chế độ advanced): đăng nhập Google, phiên, API ca hàng, file, tin nhắn, link 3D, trang xem cho bác sĩ |
| `public/shell.js` | Đầu trang, chân trang, đổi ngôn ngữ EN/VI, trạng thái đăng nhập, thanh chuyển, hàm tải file theo phần |
| `public/index.html`, `public/site/home.js`, `public/site/home-dict.js` | Trang chủ (slider toàn màn hình, các dòng dịch vụ, quy trình, sản phẩm, FAQ, liên hệ) và bản dịch |
| `public/portal.html`, `public/portal.js` | Cổng khách hàng |
| `public/admin.html`, `public/admin.js` | Trang quản trị (tiếng Việt) |
| `public/stl.html` | Chuyển HTML exocad sang STL |
| `public/privacy.html`, `public/terms.html` | Chính sách bảo mật, Điều khoản dịch vụ (song ngữ) |
| `public/brand.css`, `public/case.css` | Giao diện theo bộ nhận diện; giao diện ca hàng dùng chung cho cổng khách và quản trị |
| `public/brand/`, `public/site/`, `public/icons/` | Logo SVG, ảnh trang chủ, biểu tượng |
| `dev/server.mjs` | Bộ giả lập Cloudflare Pages + KV + Google (khóa thử) để chạy trên máy, không được triển khai |

## Thanh toán PayPal / Stripe

- Khi admin chọn **Chờ thanh toán**, ca của khách hiện khung "Payment due" với nút **Pay with PayPal** và/hoặc **Pay by card** (Stripe Checkout). Nút nào hiện tùy khóa API đã gắn; chưa gắn khóa nào thì khung chỉ báo số tiền và link WhatsApp.
- Luồng: máy chủ tạo đơn PayPal (Orders v2) hoặc phiên Stripe Checkout với số tiền tính ở máy chủ → khách trả trên trang PayPal/Stripe → quay về `/portal?pay=...&case=...` → máy chủ hỏi thẳng PayPal/Stripe (capture đơn PayPal, đọc phiên Stripe), kiểm tra mã ca, số tiền, USD rồi mới đánh dấu **Đã thanh toán** và ghi vào chat. Khách đóng tab giữa chừng thì lần sau mở ca (khách hoặc admin) hệ thống tự kiểm tra lại; admin có nút **Kiểm tra thanh toán**.
- Lưu trên ca: `payTries` (tối đa 5 lần thử gần nhất, chỉ admin thấy) và `paid` (cách trả, mã giao dịch, số tiền, thời gian). Không bao giờ lưu thông tin thẻ.
- Admin vẫn có thể chọn Đã thanh toán bằng tay (chuyển khoản, Payoneer…), ghi là "Chuyển khoản / thủ công".
- **Biến bí mật (Cloudflare → Settings → Variables and secrets, loại Secret):**
  - PayPal: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (tạo REST app ở developer.paypal.com → Apps & Credentials). Mặc định chạy **sandbox** để thử; khi dùng thật thêm `PAYPAL_ENV` = `live` và dùng khóa Live.
  - Stripe: `STRIPE_SECRET_KEY` (`sk_test_...` để thử, `sk_live_...` khi dùng thật). Stripe chỉ mở tài khoản cho doanh nghiệp ở quốc gia được hỗ trợ.
- Thử trên máy: `PAY=1 node server.mjs ...` bật PayPal + Stripe giả lập (`PAY=paypal` hoặc `PAY=stripe` cho một bên).

## Giao diện sáng / tối và hiệu ứng

- Nút mặt trời / mặt trăng ở thanh trên cùng (trên điện thoại nằm cả trong menu). Lần đầu theo cài đặt sáng/tối của máy; lựa chọn lưu ở `localStorage` khóa `d8-theme`. Mỗi trang có đoạn script nhỏ trong `<head>` đặt `html[data-theme]` trước khi vẽ để không bị nháy.
- Màu tối khai báo bằng biến CSS trong `brand.css` (`html[data-theme="dark"]`). Mảng màu thương hiệu (dải navy, nút chính) dùng `--brand`, `--band`, `--on-brand` nên giữ màu navy/kem ở cả hai chế độ.
- Hiệu ứng: 200–300 ms, đường cong ease-out (không dùng linear), chỉ CSS `transform`/`opacity`: nút nhấn (scale nhẹ), nút gửi có vòng xoay rồi dấu tick (`D8.busy`, `D8.done`), khung xương khi tải (`D8.skel`), khối nội dung hiện dần khi cuộn, parallax nhẹ ở ảnh đầu trang và ảnh giữa trang, menu điện thoại trượt, chuyển trang mờ dần (View Transitions), nút chính lóe sáng mỗi 8 giây (`.cta-shine`, `.cta-ring`). Tất cả tắt khi máy bật "giảm chuyển động" (`prefers-reduced-motion`).

## Giao diện thương hiệu

- Màu: navy `#05316E`, steel `#8FACCB`, kem `#FCFDF6`, ink `#0B1B33`.
- Font web thay font in ấn: **Lexend Exa** (thay TF Phodest), **Noto Serif Display** hẹp (thay TF The Gold Bachelor), **Be Vietnam Pro** (nội dung).
- Sửa CSS/JS thì tăng số `?v=` trong các trang và `ASSET_VERSION` trong `_worker.js`.
- Thêm chữ song ngữ: gắn `data-i="khóa"` vào thẻ (nội dung tiếng Anh viết sẵn trong HTML), thêm `"khóa": ["English", "Tiếng Việt"]` vào từ điển của trang.

## Cài đặt trên Cloudflare (dự án Pages `d8-3d`)

- **Build:** repo này, nhánh `main`, build command để trống, output `public`.
- **Bindings:** KV namespace, biến `CASES`, kho `d8-3d-cases`. Tùy chọn: **Workers AI** tên `AI` (dịch tin nhắn); **R2 bucket** tên `FILES` (lưu file ca, 10 GB miễn phí; khi có, file mới lưu vào R2, file cũ trong KV vẫn tải được). Với R2, đặt Lifecycle rule xóa object có tiền tố `jf:` sau 60 ngày.
- **Variables and secrets:** `UPLOAD_PASSWORD` (mật khẩu quản trị; cũng dùng làm khóa ký cookie phiên, đổi mật khẩu sẽ đăng xuất mọi người). Tùy chọn: `ADMIN_EMAILS` (danh sách email quản trị, cách nhau bằng dấu phẩy), `GOOGLE_CLIENT_ID`, thanh toán `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` (+ `PAYPAL_ENV=live`), `STRIPE_SECRET_KEY` (xem mục Thanh toán).
- **Custom domain:** `3d.d8designcenter.com` (cần bản ghi CNAME `3d` trỏ về `d8-3d.pages.dev` khi đã có tên miền).
- **Google Auth Platform:** thêm địa chỉ trang web vào *Authorized JavaScript origins* của OAuth client; trang Branding cần link trang chủ, `/privacy`, `/terms`.

Mọi thay đổi đẩy lên `main` được Cloudflare tự triển khai trong 1–2 phút.

## Chạy thử trên máy

```bash
cd dev
node server.mjs ../public 8788 mat-khau-thu
# http://localhost:8788/  ·  /portal  ·  /admin
# đăng nhập Google giả lập: lấy token ở /__test/idtoken?email=...&name=... rồi POST /api/auth/google
# R2=1 node server.mjs ...   giả lập R2;  NO_AI=1 ... tắt Workers AI giả lập;  /__test/ops đếm lượt dùng KV
# PAY=1 node server.mjs ...  giả lập PayPal + Stripe (trang thanh toán giả tự quay về cổng khách hàng)
```

## Giới hạn gói miễn phí (Cloudflare KV)

- 1 GB lưu trữ tổng (file ca hàng tự xóa sau 60 ngày, link 3D sau 7–30 ngày)
- 1.000 lượt ghi mỗi ngày (mỗi phần file 20 MB, mỗi tin nhắn, mỗi lần đổi trạng thái là 1 lượt), 100.000 lượt đọc mỗi ngày
- Tối đa 25 MB mỗi giá trị (vì vậy file lớn được chia phần 20 MB)
