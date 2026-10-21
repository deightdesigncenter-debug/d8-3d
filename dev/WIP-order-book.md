# WIP: sổ đơn hàng (D1) — trạng thái ngày 20/10/2026

Nhánh `wip/order-book`. Chưa đưa lên `main`.

## Đã xong (máy chủ, đã có bộ kiểm tra `dev/tests/orders.test.mjs`, 122 kiểm tra đạt)
- Cơ sở dữ liệu D1 (biến `DB`), tự tạo bảng lần đầu: khách hàng, tài khoản cổng khách, mã hàng, bảng giá theo khách,
  tiền công KTV, đơn hàng + hạng mục, thanh toán, chat nội bộ theo mã đơn, đánh dấu đã đọc.
- Mã đơn `yy/mm/dd/xx` (01, 02… theo ngày nhận, giờ Việt Nam), làm lại `R1, R2…`, làm tiếp `C1, C2…`, làm lại giai đoạn `C1R1`.
- Tìm theo mã đơn / bệnh nhân / nha khoa / bác sĩ / lab / mã của khách, không dấu.
- KTV không thấy giá, công nợ, liên hệ khách, tiền công người khác; KTV được cấp `orders.edit` nhập đơn nhưng giá lấy theo bảng giá.
- Thanh toán: tiền trả cho 1 đơn vào đơn đó, tiền ứng trước / trả gộp trừ vào đơn cũ nhất, phần dư = tiền ứng trước còn lại.
- Báo cáo (theo ngày, gom tuần/tháng/năm ở trình duyệt), xuất dữ liệu, nhập Excel (khách, mã hàng, bảng giá, đơn cũ, thanh toán) có chạy thử.
- Ca từ cổng khách tự thành đơn (khách tự tạo từ hồ sơ Google), quy trình ca chép sang đơn và chat.
- Link 3D: tiêu đề / mô tả / ảnh xem trước (og:image), `/og/<id>.jpg`, robots.txt cho phép /v/ và /og/.
- Cài đặt: thanh toán online TẮT, tự đánh dấu dùng thử TẮT (mặc định).
- Bộ giả lập `dev/server.mjs` có D1 (node:sqlite), đếm 50 truy vấn / yêu cầu như gói miễn phí.

## Đang làm (giao diện, CHƯA chạy thử)
- `public/xlsx.js` (đọc/ghi Excel — đã thử với openpyxl và LibreOffice), `public/orders.js`, `public/books.js`, `public/snap.js`.
- Cần chạy `dev/../scratchpad/patch_admin.py` (nối các module vào `admin.js`): router, tổng quan, thẻ đơn + chat trên trang ca,
  trường tiêu đề/mô tả/mã đơn và ảnh xem trước trong trang Link 3D.

## Việc còn lại
1. `admin.html`: thêm panel `p-orders, p-order, p-order-edit, p-cust, p-catalog, p-reports, p-import, p-settings`, nạp
   `xlsx.js, orders.js, books.js, snap.js` trước `admin.js`, CSS cho bảng đơn, form đơn, chat, KPI, biểu đồ (màu `--viz-1/2`),
   ô ảnh xem trước trong trang Link 3D (`snapBox, snapStage, snapImg, snapT, snapD, snapTake, snapDef, snapSay`, `ogDesc, ogOrder, ogOrderHint`).
2. `shell.js`: menu mới (Đơn hàng, Ca cổng khách, Khách hàng, Mã hàng & bảng giá, Báo cáo, Nhập Excel, Cài đặt), quyền dạng mảng, `markSub` cho `#cust/…`.
3. Cổng khách: hiện mã đơn thay mã D8-….
4. Ảnh mặc định `public/brand/og-3d.jpg` (đang tạm là `site/og.jpg`): thiết kế "3D Design View".
5. Kiểm tra UI mới (`orders_ui.py`), sửa test cũ (menu, giá gợi ý cũ), chạy `dev/tests/run.sh`, xem ảnh chụp sáng/tối, điện thoại.
6. README, CLAUDE.md; đẩy lên `main`; tạo D1 `d8-db` + binding `DB` trên Cloudflare.
