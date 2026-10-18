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
| `public/index.html` | Trang chủ ngắn (tiếng Anh) |
| `public/robots.txt`, `public/favicon.svg` | Chặn công cụ tìm kiếm; biểu tượng tab |
| `dev/server.mjs` | Bộ giả lập Cloudflare Pages + KV để chạy thử trên máy (không được triển khai) |

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
