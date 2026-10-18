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

## Cấu trúc thư mục

| Đường dẫn | Vai trò |
|---|---|
| `public/_worker.js` | Phần máy chủ (Cloudflare Pages, chế độ advanced): API tải lên, danh sách, xóa; trang xem cho bác sĩ; trả file 3D |
| `public/admin.html` | Trang tạo link và quản lý link (tiếng Việt) |
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
