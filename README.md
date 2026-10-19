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
- Khách xem link 3D, bấm **Duyệt thiết kế**, nhắn tin, tải file hoàn chỉnh. Mã ca dạng `D8-YYMMDD-XXXX`.

## Quản trị (`/admin`)

- **Ca hàng**: lọc theo trạng thái, tìm theo mã/tên/email, dấu "Khách vừa nhắn". Trong từng ca: đổi trạng thái, tải file của khách, tạo link 3D từ HTML exocad và gắn vào ca (tự chuyển sang Chờ duyệt), tải file STL hoàn chỉnh lên để giao (tự chuyển Đã giao), nhắn tin với mẫu soạn sẵn.
- **Link xem 3D**: tạo link gửi bác sĩ như trước (QR, tin nhắn tiếng Anh kèm bản tiếng Việt).
- **Tin nhắn**: tin từ form Liên hệ trên trang web, tự xóa sau 180 ngày.
- **Khách hàng**: các tài khoản đã đăng nhập, lab, quốc gia, số điện thoại, số ca.

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

## Giao diện thương hiệu

- Màu: navy `#05316E`, steel `#8FACCB`, kem `#FCFDF6`, ink `#0B1B33`.
- Font web thay font in ấn: **Lexend Exa** (thay TF Phodest), **Noto Serif Display** hẹp (thay TF The Gold Bachelor), **Be Vietnam Pro** (nội dung).
- Sửa CSS/JS thì tăng số `?v=` trong các trang và `ASSET_VERSION` trong `_worker.js`.
- Thêm chữ song ngữ: gắn `data-i="khóa"` vào thẻ (nội dung tiếng Anh viết sẵn trong HTML), thêm `"khóa": ["English", "Tiếng Việt"]` vào từ điển của trang.

## Cài đặt trên Cloudflare (dự án Pages `d8-3d`)

- **Build:** repo này, nhánh `main`, build command để trống, output `public`.
- **Bindings:** KV namespace, biến `CASES`, kho `d8-3d-cases`.
- **Variables and secrets:** `UPLOAD_PASSWORD` (mật khẩu quản trị; cũng dùng làm khóa ký cookie phiên, đổi mật khẩu sẽ đăng xuất mọi người). Tùy chọn: `ADMIN_EMAILS` (danh sách email quản trị, cách nhau bằng dấu phẩy), `GOOGLE_CLIENT_ID`.
- **Custom domain:** `3d.d8designcenter.com` (cần bản ghi CNAME `3d` trỏ về `d8-3d.pages.dev` khi đã có tên miền).
- **Google Auth Platform:** thêm địa chỉ trang web vào *Authorized JavaScript origins* của OAuth client; trang Branding cần link trang chủ, `/privacy`, `/terms`.

Mọi thay đổi đẩy lên `main` được Cloudflare tự triển khai trong 1–2 phút.

## Chạy thử trên máy

```bash
cd dev
node server.mjs ../public 8788 mat-khau-thu
# http://localhost:8788/  ·  /portal  ·  /admin
# đăng nhập Google giả lập: lấy token ở /__test/idtoken?email=...&name=... rồi POST /api/auth/google
```

## Giới hạn gói miễn phí (Cloudflare KV)

- 1 GB lưu trữ tổng (file ca hàng tự xóa sau 60 ngày, link 3D sau 7–30 ngày)
- 1.000 lượt ghi mỗi ngày (mỗi phần file 20 MB, mỗi tin nhắn, mỗi lần đổi trạng thái là 1 lượt), 100.000 lượt đọc mỗi ngày
- Tối đa 25 MB mỗi giá trị (vì vậy file lớn được chia phần 20 MB)
