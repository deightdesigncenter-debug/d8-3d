# D.EIGHT — Link xem thiết kế 3D

Công cụ biến file HTML xuất từ exocad thành một đường link để bác sĩ mở xem 3D ngay trên trình duyệt (điện thoại hoặc máy tính), không cần cài exocad viewer.

- Trang tạo link (cho D.EIGHT): `https://3d.d8designcenter.com/admin`
- Link gửi bác sĩ có dạng: `https://3d.d8designcenter.com/v/<mã>`
- Địa chỉ tạm của Cloudflare: `https://d8-3d.pages.dev`

## Cách hoạt động

1. Trên trang `/admin`, kéo file HTML từ exocad vào, đặt tên ca, chọn hạn dùng (7, 14 hoặc 30 ngày).
2. Trình duyệt nén file (khoảng 10 MB còn 4–5 MB) rồi tải lên Cloudflare KV.
3. Máy chủ tạo một mã ngẫu nhiên 12 ký tự và trả về link, mã QR, tin nhắn tiếng Anh soạn sẵn.
4. Bác sĩ mở link thấy thanh tiêu đề D.EIGHT và bản xem 3D. Hết hạn thì file tự xóa.

Bảo mật: link không chứa tên file hay tên bệnh nhân; trang không cho Google lập chỉ mục; file 3D chạy trong môi trường cô lập (sandbox) nên không đọc được mật khẩu hay gọi được chức năng quản lý.

## Trang giới thiệu và tin nhắn liên hệ

- Trang chủ `/` là trang giới thiệu D.EIGHT cho khách (bác sĩ, lab), bằng tiếng Anh. Vẫn để `noindex` (chưa cho Google lập chỉ mục) cho tới khi gắn tên miền chính thức.
- Form Contact gửi tới `/api/contact` (không cần mật khẩu). Tin nhắn lưu trong KV với khóa `msg:<thời điểm><mã>`, tự xóa sau 180 ngày.
- Chống spam: ô ẩn (honeypot), bỏ qua form gửi trong vòng 3 giây sau khi mở trang, tối đa 30 tin mỗi ngày (giữ lượt ghi KV cho việc tạo link 3D).
- Xem tin nhắn ở `/admin`, mục **Tin nhắn từ khách** (biểu tượng phong bì có số tin mới trên thanh menu). Trạng thái "đã đọc" lưu trên trình duyệt đang dùng.

## Chuyển HTML sang STL (`/stl`)

Trang `https://3d.d8designcenter.com/stl` (đăng nhập bằng cùng mật khẩu với `/admin`) tách các lớp lưới 3D trong file HTML của exocad thành file STL.

- Xử lý hoàn toàn trong trình duyệt: file không được tải lên máy chủ, không tốn dung lượng KV.
- File exocad được mở trong khung cô lập (sandbox) kèm một đoạn mã nhỏ chờ exocad dựng xong mô hình, rồi gửi dữ liệu lưới (`DentalWebGL.m_SceneManager.m_MeshSort.m_SortedMeshs`) ra trang chính.
- Mỗi lớp (ví dụ *Merged parts*, *Antagonist*, *Jaw scans*) xuất thành STL nhị phân; lớp ảnh 2D được bỏ qua.
- Tọa độ giữ nguyên hệ tọa độ exocad (mm), các file khớp vị trí với nhau.
- Tải từng lớp, tải nhiều lớp dạng `.zip` (nén deflate), hoặc gộp các lớp đã chọn thành 1 file STL.

Đã kiểm tra với file mẫu: khung bao của từng lớp khớp tuyệt đối với số liệu exocad, lớp thiết kế là khối kín, mặt hướng ra ngoài.

## Cấu trúc thư mục

| Đường dẫn | Vai trò |
|---|---|
| `public/_worker.js` | Phần máy chủ (Cloudflare Pages, chế độ advanced): API tải lên, danh sách, xóa; trang xem cho bác sĩ; trả file 3D |
| `public/admin.html` | Trang tạo link và quản lý link (tiếng Việt) |
| `public/stl.html` | Trang chuyển HTML exocad sang STL (chạy trong trình duyệt) |
| `public/index.html` | Trang giới thiệu D.EIGHT (tiếng Anh): dịch vụ, quy trình, xem 3D, ảnh case, giới thiệu, FAQ, form liên hệ |
| `public/site/` | Ảnh dùng cho trang giới thiệu (cắt từ ảnh portfolio trong bộ nhận diện) và ảnh chia sẻ `og.jpg` |
| `public/brand.css` | Kiểu giao diện dùng chung theo bộ nhận diện D.EIGHT (màu, nút bo tròn, chữ in hoa giãn cách, header kem, hero navy, footer navy) |
| `public/brand/` | Logo SVG lấy từ DEIGHT-Brand-Kit: lockup ngang (thường và đảo màu), biểu tượng, tagline "Design to fit" (đã outline) |
| `public/favicon.ico`, `public/favicon.svg`, `public/icons/`, `public/site.webmanifest` | Biểu tượng tab, icon điện thoại, manifest (mở `/admin` khi thêm ra màn hình chính) |
| `public/robots.txt` | Chặn công cụ tìm kiếm |
| `dev/server.mjs` | Bộ giả lập Cloudflare Pages + KV để chạy thử trên máy (không được triển khai) |

## Giao diện thương hiệu

- Màu: navy `#05316E`, steel `#8FACCB`, kem `#FCFDF6`, ink `#0B1B33` (theo `03-COLOR/tokens.css` của bộ nhận diện).
- Logo và tagline dùng file SVG đã outline từ bộ nhận diện, không phụ thuộc font.
- Font gốc TF Phodest và TF The Gold Bachelor là bản quyền in ấn, không nhúng lên web. Trên web dùng font Google thay thế, đều có đủ dấu tiếng Việt: **Lexend Exa** (tiêu đề, nút, chữ in hoa) thay TF Phodest, **Noto Serif Display** dạng hẹp (dòng phụ kiểu serif) thay TF The Gold Bachelor, **Be Vietnam Pro** cho nội dung.
- Sửa `brand.css` thì tăng số phiên bản `?v=` trong các trang và `ASSET_VERSION` trong `_worker.js` để trình duyệt tải bản mới.

## Cài đặt trên Cloudflare (dự án Pages `d8-3d`)

- **Build:** nối với repo này, nhánh `main`. Build command: để trống. Build output directory: `public`.
- **Bindings:** KV namespace, tên biến `CASES`, trỏ tới kho `d8-3d-cases`.
- **Variables and secrets:** Secret `UPLOAD_PASSWORD` là mật khẩu của trang `/admin`.
- **Custom domain:** `3d.d8designcenter.com` (bản ghi CNAME `3d` ở P.A Vietnam trỏ về `d8-3d.pages.dev`).

## Cập nhật

Mọi thay đổi đẩy lên nhánh `main` sẽ được Cloudflare tự triển khai trong 1–2 phút. Kiểm tra tiến độ ở tab **Deployments** của dự án `d8-3d`.

## Chạy thử trên máy

```bash
cd dev
node server.mjs ../public 8788 mat-khau-thu
# mở http://localhost:8788/admin
```

## Giới hạn gói miễn phí (Cloudflare KV)

- 1 GB lưu trữ (khoảng 200 ca cùng lúc, mỗi ca 4–5 MB sau nén)
- 1.000 lượt tải lên mỗi ngày, 100.000 lượt xem mỗi ngày
- Tối đa 25 MB mỗi file sau khi nén
