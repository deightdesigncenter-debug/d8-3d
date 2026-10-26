# D.EIGHT DESIGN CENTER — trang web, cổng khách hàng và công cụ quản trị

Một trang web duy nhất gồm trang giới thiệu (tiếng Anh / tiếng Việt), cổng khách hàng đăng nhập bằng Google, trang quản trị ca hàng, link xem thiết kế 3D cho bác sĩ và công cụ chuyển HTML exocad sang STL. Mọi trang dùng chung một thanh đầu trang, chân trang và thanh chuyển **Trang web / Khách hàng / Quản trị**.

- Trang web: `https://3d.d8designcenter.com/` (địa chỉ tạm: `https://d8-3d.pages.dev`)
- Cổng khách hàng: `/portal`
- Quản trị: `/admin` (Đơn hàng, Ca cổng khách, Khách hàng, Mã hàng & bảng giá, Báo cáo, Nhập Excel, Nhân sự, Cài đặt, Link xem 3D, Tin nhắn) và `/stl`
- Link gửi bác sĩ: `/v/<mã>`
- Giới thiệu: `/about` (ca tiêu biểu toàn hàm, 3 video quay màn hình, 17 ảnh màn hình CAD có lọc, thêm 6 ca; không đăng ảnh sản phẩm hoàn thiện vì D.EIGHT chỉ thiết kế; bố cục theo kiểu luminadental.com.au)
- Sửa file miễn phí: số lần thường lệ đặt ở **Cài đặt › Sửa file miễn phí** (mặc định 2, hiện trên trang chủ, Điều khoản và cổng khách); từng ca đặt riêng được ở trang ca (người có quyền billing.edit). Chuyển ca từ "Chờ duyệt" về "Đang thiết kế" tự tính 1 lần sửa; khách thấy "đã dùng X/N" trong ca.
- Đội ngũ trên trang Giới thiệu: Danny Do (liên hệ khách hàng), Nhut Hoa (kỹ thuật viên thiết kế).
- Font: chỉ dùng Be Vietnam Pro (tiêu đề đậm, viết thường như câu; nhãn nhỏ và nút in hoa). Dòng chữ nghiêng có chân (slogan) vẫn là Noto Serif Display.
- Pháp lý: `/privacy`, `/terms` (Google yêu cầu khi cho khách đăng nhập)

## Đăng nhập

- **Khách hàng** đăng nhập bằng Google (Google Identity Services). Máy chủ kiểm tra chữ ký ID token bằng khóa công khai của Google (RS256), rồi đặt cookie phiên `d8s` (ký HMAC, HttpOnly, SameSite=Lax, 30 ngày). Không lưu mật khẩu, chỉ nhận tên, email, ảnh đại diện.
- **Chủ tài khoản**: email trong `ADMIN_EMAILS` (mặc định `d.eightdesigncenter@gmail.com`) luôn là Quản trị, đủ mọi quyền, không bị khóa hay xóa được. Mật khẩu `UPLOAD_PASSWORD` vẫn dùng được như tài khoản chủ (header `X-Upload-Key`, chỉ gửi từ trang quản trị).
- **Ai thấy gì**: chưa đăng nhập → chỉ trang web giới thiệu (không có liên kết nào vào khu làm việc). Đăng nhập Google mà chưa được cấp quyền → tài khoản khách hàng: trang web + cổng khách hàng; mở `/admin` hay `/stl` chỉ thấy thẻ "Chỉ dành cho đội D.EIGHT", mọi API khu làm việc trả 403. Được cấp quyền → nút **Quản trị** hiện ở đầu trang, vào khu làm việc với đúng quyền của vai trò. Gỡ quyền → về lại tài khoản khách hàng.
- **Cấp quyền cho tài khoản khách**: ở **Nhân sự & phân quyền → Cấp quyền cho tài khoản khách** (danh sách người đã đăng nhập Google, tìm theo tên / email / lab), chọn vai trò rồi bấm **Cấp quyền** 2 lần; hoặc mở tài khoản đó ở Khách hàng → thẻ **Khu làm việc**.
- **Nhân sự** (Quản trị, Kỹ thuật viên thiết kế, QC, và vai trò tự tạo): chủ thêm email Google ở **Workspace → Nhân sự & phân quyền**; người đó đăng nhập Google là vào được khu làm việc với đúng quyền của mình. Ai không có trong danh sách là khách hàng.
- Chống giả mạo yêu cầu: yêu cầu ghi từ trang khác bị chặn (kiểm tra `Origin`), yêu cầu dùng cookie phải có header `X-D8: 1`.
- Client ID Google (công khai) nằm trong `_worker.js` (`GOOGLE_CLIENT_ID`), có thể ghi đè bằng biến môi trường cùng tên. Không cần client secret.

## Cổng khách hàng (`/portal`)

- Gửi ca mới: mã tham chiếu, dịch vụ, răng (FDI/Universal), vật liệu, màu, ngày cần, yêu cầu, link file và file tải lên.
- File được nén gzip trong trình duyệt khi có lợi, chia phần 20 MB, lưu KV khóa `jf:<ca>:<file>:<phần>`, tự xóa sau 60 ngày. Tối đa 300 MB mỗi ca.
- Trạng thái: Đã nhận → (Cần bổ sung) → Đang thiết kế → Chờ duyệt → Đã duyệt → Đã giao (hoặc Đã hủy).
- Khách xem link 3D, bấm **Duyệt thiết kế**, nhắn tin, tải file hoàn chỉnh (từng file hoặc cả ca dạng ZIP). Mỗi ca gửi qua cổng khách tự thành một đơn trong sổ đơn hàng và khách thấy **mã đơn** `yymmddxx`, ví dụ `26102101` (mã nội bộ của ca vẫn là `D8-YYMMDD-XXXX`, dùng trong đường dẫn).
- Phiếu chỉ định có thêm ô riêng theo dịch vụ (implant, All-on-X, máng, hàm tháo lắp…), lưu ở `rx` của ca.
- **Dùng thử miễn phí:** trang web giới thiệu 2 ca đầu miễn phí (tổng đến 50 USD). Việc tự đánh dấu 2 ca đầu là `trial` **tắt mặc định** (bạn tự thương lượng, đặt "Miễn phí" trong đơn); bật lại ở **Cài đặt**.
- **Dữ liệu ca lưu trong D1** (bảng `jobs`, từ 26/10/2026): thông tin ca, tin nhắn, ghi chú, danh sách file. Mỗi lần lưu có kiểm tra phiên bản, nên nhiều người (khách ở nước ngoài, KTV, QC, quản trị) lưu cùng một ca cùng lúc thì không ai mất thay đổi của ai. Các ca cũ trong KV tự được chép sang D1 (bản cũ trong KV giữ nguyên làm dự phòng). Không nối D1 thì ca vẫn lưu trong KV như trước, danh sách ca của khách đọc từ chỉ mục `own:<email>`.
- Không quay lại (rollback) bản triển khai trước ngày 26/10/2026: bản cũ chỉ đọc ca trong KV nên sẽ không thấy các ca mới.

## Workspace – khu làm việc (`/admin`)

Trang riêng cho đội D.EIGHT (thanh bên trái, không có menu trang web), liên kết qua lại với trang web và cổng khách hàng bằng nút chuyển ở đầu trang. Mỗi người chỉ thấy mục và nút mình có quyền; máy chủ kiểm tra lại mọi quyền.

- **Tổng quan**: việc của mình (ca được giao thiết kế, chờ QC, đã qua QC chờ gửi khách, ca chưa giao KTV, khách vừa nhắn, thanh toán chờ xác nhận, tin nhắn web).
- **Phân quyền**: 28 quyền chia nhóm (đơn hàng, ca hàng, thiết kế & QC, tin nhắn, tiền, quản lý). Vai trò mặc định: *Quản trị* (tất cả), *Kỹ thuật viên thiết kế* (tải file khách, tải file thiết kế, gửi QC, ghi chú nội bộ, đọc tin nhắn, AI, link 3D), *QC* (như KTV nhưng duyệt QC thay vì thiết kế). Tạo thêm vai trò (ví dụ Trưởng nhóm), tick quyền theo bảng, hoặc đặt quyền riêng cho từng người. Người không có quyền "Xem tất cả ca" chỉ thấy ca được giao cho mình; không có quyền "Xem email khách" thì không thấy email; không có quyền tiền thì không thấy giá. KTV mặc định chỉ thấy đơn mình làm (không thấy giá, bảng giá, công nợ, khách hàng, báo cáo).
- **Quy trình một ca**: giao KTV + QC → KTV tải file thiết kế (nội bộ, khách không thấy; file HTML exocad bấm **Xem 3D**) → **Gửi QC** → QC **Đạt** hoặc **Không đạt** (bắt buộc ghi lỗi, ca quay lại KTV) → người có quyền giao: **Gửi khách xem 3D** (tạo link từ file HTML) hoặc **Giao file đã chọn cho khách**. Mọi bước ghi vào **Ghi chú nội bộ** (khách không thấy).
- **Ca hàng**: lọc theo trạng thái và người làm (của tôi, chưa giao KTV, chờ QC, đã qua QC, thanh toán chờ xác nhận), tìm theo mã/tên/khách. Trong từng ca: đổi trạng thái, tải file của khách, tạo link 3D, giao file STL, nhắn tin với mẫu soạn sẵn.
- **Link xem 3D**: tạo link gửi bác sĩ như trước (QR, tin nhắn tiếng Anh kèm bản tiếng Việt).
- **Tin nhắn**: tin từ form Liên hệ trên trang web, tự xóa sau 180 ngày. Thẻ **Tin bị chặn** bên dưới: tin bị bộ chống spam chặn trong 30 ngày qua, kèm lý do; bấm **Không phải spam** để chuyển vào hộp thư hoặc **Xóa**.
- **Chống spam form Liên hệ** (tương đương WPForms; trạng thái và danh sách chặn riêng ở **Cài đặt**): ô ẩn bẫy bot (honeypot); mã chống bot do máy chủ ký (bot gửi thẳng vào API, mã giả hoặc quá 24 giờ bị loại) và chặn tin gửi nhanh hơn 3 giây; mỗi IP tối đa 4 tin/ngày, cả trang 30 tin/ngày; lọc tin có từ 3 link, mã chèn link HTML/BBCode, link trong ô họ tên, từ khóa quảng cáo (SEO, casino, crypto…), email tạm thời; từ khóa và email / tên miền chặn thêm do quản trị nhập. Bot nhận "đã gửi" giả, không lưu; người bị bộ lọc chặn được nhắn email trực tiếp d.eightdesigncenter@gmail.com. Tùy chọn **Cloudflare Turnstile** (CAPTCHA miễn phí, không giải đố): tạo widget ở Cloudflare → Turnstile → Add widget (tên miền của web), thêm biến `TURNSTILE_SITE_KEY` và secret `TURNSTILE_SECRET` vào Pages `d8-3d` → Settings → Variables and Secrets, rồi triển khai lại.
- **Ca cổng khách**: ca khách gửi qua cổng khách hàng (file, tin nhắn với khách, bản 3D, giao file); mỗi ca có thẻ **Đơn hàng** và chat nội bộ theo mã đơn.
- **Báo giá & thanh toán online** trong từng ca (chỉ hiện khi bật thanh toán online): giá ca (USD), số tiền khách cần trả (để trống = bằng giá ca, dùng khi chỉ thu phần vượt dùng thử), trạng thái Chưa báo giá / Miễn phí (dùng thử) / Chờ thanh toán / Đã thanh toán; hiện số tiền dùng thử đã dùng / 50 USD của khách. **Giá chỉ admin thấy**: khách chỉ thấy số tiền khi ca ở trạng thái Chờ thanh toán (hoặc số đã trả).
- **Xuất CSV** (mở bằng Excel): ca hàng, khách hàng, tin nhắn.

## Sổ đơn hàng (cơ sở dữ liệu D1, binding `DB`)

Xương sống của khu làm việc: mọi đơn (nhập tay, nhập Excel, khách gửi qua cổng) nằm trong một cơ sở dữ liệu Cloudflare D1. Bảng dữ liệu tự tạo lần đầu dùng và tự nâng cấp khi có phiên bản mới (`SCHEMA_V1`, `SCHEMA_V2` trong `_worker.js`):

| Bảng | Một dòng là | Trường chính |
|---|---|---|
| `customers` | một khách (lab, phòng khám, bác sĩ, nền tảng) | mã khách, tên, loại, tiền tệ, liên hệ, điều khoản thanh toán |
| `customer_logins` | một tài khoản Google của cổng khách | email → khách |
| `products` | một mã hàng chung | mã, tên, nhóm, tính theo (răng / hàm / ca / giờ) |
| `prices` | giá một mã hàng cho một khách (khách 0 = giá mặc định) | khách, mã hàng, tiền tệ, giá |
| `tech_rates` | tiền công một mã hàng cho một KTV (`*` = mọi KTV) | KTV, mã hàng, giá công |
| `orders` | một đơn (một giai đoạn hoặc một lần làm lại) | mã đơn, đơn gốc, loại, khách, nha khoa, bác sĩ, bệnh nhân, mã của khách, yêu cầu, trạng thái, KTV, QC, ngày nhận / hạn / ngày giao, đơn vị, tạm tính, phụ phí, tổng, đã thu, công KTV, số lần QC trả |
| `order_items` | một hạng mục trong đơn | mã hàng, răng, số lượng, đơn giá, thành tiền |
| `payments` | một khoản khách trả | khách, đơn (nếu trả riêng), ngày, số tiền, hình thức, mã giao dịch |
| `order_msgs`, `order_files`, `order_reads` | chat nội bộ theo mã đơn | tin nhắn, ảnh, file đính kèm, ai đã đọc đến đâu |

Chỉ mục (index) cho các việc hay làm: tìm theo mã đơn, theo ngày nhận / ngày giao, theo khách, theo KTV / QC + trạng thái, họ đơn theo mã gốc, kiểm tra đơn trùng theo tên bệnh nhân và mã của khách.

- **Mã đơn** `yymmddxx` theo ngày nhận (giờ Việt Nam): ca đầu tiên ngày 21/10/2026 là `26102101`, `xx` = 01, 02… tự đếm lại mỗi ngày, chung cho mọi khách. Mã gốc là **giai đoạn 1**; **làm tiếp giai đoạn 2** là `26102101C2` (rồi `C3`…); **làm lại lần 1** là `26102101R1` (lần 2 `R2`…); **làm lại xong rồi làm tiếp giai đoạn 2** là `26102101R1C2`; làm lại giai đoạn 2 là `26102101C2R1`. Số R / C tự đếm, form hiện mã mới trước khi lưu, mỗi giai đoạn chỉ tạo được một lần. Mã cũ dạng `26/10/21/01` (gõ tay, file Excel, dữ liệu trước đây) tự đổi thành `26102101`. Đơn cũ giữ được mã đã có (gõ mã khi nhập). Đơn làm lại mặc định "Bảo hành (miễn phí)", đổi được.
- **Đơn đã có thì báo ngay**: khi nhập đơn mới (admin hoặc KTV được quyền nhập đơn), gõ tên bệnh nhân hoặc mã của khách mà sổ đã có đơn trùng (cùng khách + cùng mã của khách, hoặc cùng tên bệnh nhân trong 45 ngày) thì hiện khung đỏ "case này đã có mã đơn hàng …" kèm ai nhập, trạng thái, KTV. Muốn tạo vẫn được nhưng phải tick "Đây là đơn khác". KTV chỉ thấy mã, bệnh nhân, trạng thái, không thấy tiền.
- **Tìm đơn** theo mã đơn (gõ `26102101` hay kiểu cũ `26/10/21/01` đều được), bệnh nhân, nha khoa, bác sĩ, lab / mã khách, mã của khách; gõ không dấu vẫn tìm được. Lọc theo trạng thái, thời gian, khách, KTV, loại đơn (mới / R / C), còn nợ.
- **Đơn hàng**: nhiều hạng mục (mã hàng, răng, số lượng tự theo số răng, đơn giá theo bảng giá của khách), phụ phí % (vd +50% làm gấp trong ngày), cộng/trừ, tính tiền / miễn phí / bảo hành, tiền tệ USD hoặc VND theo khách. Quy trình: Mới nhận → Đang thiết kế → Chờ QC → (QC trả sửa) → Đã qua QC → Chờ bác sĩ duyệt → Đã duyệt → Đã giao; Tạm dừng, Hủy (ghi lý do).
- **Chat nội bộ theo mã đơn** (KTV – QC – quản trị, khách không thấy): tin nhắn, ảnh chụp màn hình (dán Ctrl+V), **file** (STL, PLY, HTML exocad, PDF, ZIP…, bấm File hoặc kéo thả, tối đa 300 MB mỗi file, lưu như file ca: 60 ngày nếu chưa có R2), sự kiện quy trình; chấm đỏ đơn có tin chưa đọc, số trên menu Đơn hàng. Ca từ cổng khách dùng chung chat này.
- **Khách hàng**: mã khách tự cấp theo Loại: **DR** (bác sĩ / phòng khám) hoặc **LAB** (labo) + năm + số chạy chung trong năm (DR202601, LAB202602); đổi Loại thì đổi tiền tố, giữ số; khách mã cũ có nút đổi sang mã mới. Ghi chú nội bộ về đặc điểm khách. Loại, tiền tệ, liên hệ, điều khoản thanh toán; gắn tài khoản Google của cổng khách để đơn tự vào đúng khách. Trang khách: số đơn, doanh thu, đã thu, còn nợ, tiền ứng trước còn lại, đơn gần đây, bảng giá riêng, sổ thanh toán.
- **Mã hàng & bảng giá**: 3 bảng giá — **Giá niêm yết (MAX)**, **Mức 2 (MID)**, **Mức 3 (MIN)** — nhập từ file Excel theo mẫu BANG_GIA (No. · SERVICE · DESCRIPTION · UNIT · UNIT PRICE, các dòng tiêu đề nhóm); mã hàng tự tạo theo nhóm + số thứ tự (Full Contour, số 7 nhóm CROWN & BRIDGE → CB07; Die Only → MD01); "Quote on request" = không có giá. Mỗi khách chọn 1 mức giá; nhập thêm file giá riêng của khách (ưu tiên hơn mức). Danh mục chỉ còn mã, tên Việt/Anh, nhóm, tính theo (răng, hàm, cầu, bộ, ca). **Giá công KTV**: giá công theo mã hàng cho từng KTV (hoặc chung), nhập tay hoặc từ file Excel cùng mẫu; công mỗi đơn = số lượng × giá công.
- **Xem trước 3D** (STL, PLY, OBJ): file KTV gửi trong chat của đơn hiện ở mục "Xem trước 3D" trên trang đơn; file thiết kế của ca cổng khách hiện ngay trong mục File thiết kế; nút **Xem 3D** mở cửa sổ lớn. Xoay (kéo / một ngón), phóng to (lăn chuột / chụm hai ngón), di chuyển (chuột phải / hai ngón), góc nhìn mặt nhai / trước / bên, toàn màn hình. Không cần tải file về.
- **Thông báo** (chuông trên đầu trang, khu làm việc và cổng khách): việc cần làm của từng người — KTV: đơn / ca cần thiết kế, bị trả sửa; QC: chờ QC; quản trị: ca mới chờ giao KTV, đơn chưa giao KTV, chờ giao khách, thanh toán chờ xác nhận, tin nhắn; khách: thiết kế chờ duyệt, cần bổ sung, chờ thanh toán, có cập nhật. Ca cổng khách cần xử lý có **chấm đỏ** và nhãn đỏ; bộ lọc "Cần tôi xử lý".
- **Thanh toán**: ghi nhận tiền khách trả (PayPal, Payoneer, Remitly, chuyển khoản, tiền mặt, ứng trước…). Tiền trả cho một đơn vào đơn đó; tiền ứng trước / trả gộp tự trừ vào đơn cũ nhất còn nợ; phần dư là tiền ứng trước còn lại. Hủy đơn thì tiền của đơn đó thành tiền ứng trước.
- **Báo cáo**: theo tuần / tháng / năm, theo ngày nhận hoặc ngày giao, theo tiền tệ: số ca, đơn vị, làm lại, doanh thu, đã thu, còn nợ, tiền thực nhận, công KTV; biểu đồ đã thu / còn nợ và số ca; theo khách, theo KTV (QC trả về, làm lại), theo mã hàng; công nợ hiện tại; tiền ứng trước còn lại.
- **Kỹ thuật viên** (`#team`, cần `staff.manage`, `techpay.manage` hoặc `reports.view`): mỗi KTV một dòng — đơn đang làm (quá hạn), ca trong tháng, đơn vị, QC trả về (số ca bị trả sửa, %), bị làm lại (ca sau đó có mã R), tiền công (chỉ người có `techpay.manage`); số đơn chưa giao KTV. Tính theo **ngày giao** (mặc định, đơn đã giao; đơn cũ không ghi ngày giao thì lấy ngày nhận) hoặc **ngày nhận**. Bấm một KTV → trang riêng: đơn đang làm và hạn, biểu đồ 12 tháng, danh sách ca trong tháng, theo mã hàng. Nút **Xuất phiếu công tháng**: một file cho từng KTV (Phiếu công, Chi tiết ca, Theo mã hàng) hoặc cho tất cả KTV (Tổng hợp + mỗi KTV một sheet). Trang Nhân sự có nút "Trang KTV".
- **Công của tôi** (`#me`, KTV có `cases.design`): KTV tự xem việc đang làm, ca từng tháng, QC trả về, bị làm lại; tiền công tháng và tải phiếu công của chính mình nếu có `techpay.own` (vai trò KTV mặc định đã bật; nếu đã chỉnh vai trò thì tick lại quyền này). Không thấy giá, khách hàng hay KTV khác.
- **Xuất Excel** (.xlsx tạo trong trình duyệt, `public/xlsx.js`): tổng hợp theo kỳ, đơn hàng, hạng mục, thanh toán, theo khách, theo KTV, công nợ.
- **Nhập Excel**: khách hàng, mã hàng, bảng giá (dạng mỗi khách một cột như file xuất ra, hoặc dạng dòng), đơn hàng cũ (nhiều dòng cùng một ký hiệu ở cột Mã đơn = một đơn nhiều hạng mục), thanh toán. Có file mẫu, xem trước từng dòng, báo lỗi, báo đơn có thể trùng; chạy thử phía máy chủ trước khi ghi.
  Đơn hàng cũ còn nhận thẳng bảng của khách (VD Google Sheets "GC - Case Detail": Case_ID, Created_Date, Doctor_Name, Patient_Name, Product_Name, Unit, Instruction_Note, Progress):
  bác sĩ trùng tên một khách thì tự ghép khách, bác sĩ khác chọn khách một lần (hoặc chọn một khách cho cả file); chọn KTV cho cả file khi bảng theo từng KTV; tên hàng được ghép với mã hàng theo tên Việt/Anh trong danh mục (cả tên ngắn như "Implant crown"), tên lạ thì chọn mã một lần;
  ngày kiểu Mỹ (10/21/2026) tự nhận ra theo cả cột; Completed = Đã giao, Pending = Đang thiết kế; các dòng cùng Case_ID cùng ngày = một đơn nhiều hạng mục; báo đơn có thành tiền 0 (chưa có giá).
- **Quyền**: `orders.view` (xem mọi đơn; không có thì chỉ thấy đơn mình làm KTV/QC), `orders.edit`, `orders.delete`, `billing.view` (thấy tiền), `billing.edit`, `pricing.manage`, `techpay.manage`, `techpay.own`, `customers.view`, `customers.edit`, `reports.view`, `export.csv`. **KTV mặc định không thấy giá, công nợ, liên hệ khách, tiền công của người khác**; KTV được cấp `orders.edit` nhập đơn thì giá vẫn tự lấy theo bảng giá và vẫn không thấy giá.
- **Riêng tư giữa các KTV** (kiểm tra bằng `dev/tests/privacy.test.mjs` với 2 KTV): mỗi KTV chỉ thấy đơn, chat, file, ca cổng khách được giao cho mình; không mở được đơn / ca / trang KTV / tiền công của người khác; danh sách nhân sự KTV nhận được không có các KTV khác; **link xem 3D**: mỗi người chỉ thấy và xóa link mình tạo, quyền `links.all` (quản trị) thấy và xóa mọi link. Không xem được giá khách, bảng giá, khách hàng, doanh thu, công nợ, báo cáo, xuất Excel, nhân sự, cài đặt, tin nhắn liên hệ; không nhập / sửa / xóa / giao đơn, không đổi giá công.
- Giới hạn gói miễn phí D1 (50 truy vấn mỗi yêu cầu, 100 giá trị mỗi truy vấn): ghi nhiều dòng dùng `json_each`; bộ giả lập đếm truy vấn để bắt lỗi vượt giới hạn.

## Link xem 3D có ảnh xem trước

- Trang bác sĩ `/v/<mã>` có thẻ `og:title`, `og:description`, `og:image` (`/og/<mã>.jpg`) nên Messenger, Zalo, WhatsApp hiện ảnh, tiêu đề kiểu "Patient: … - Second design" và dòng "Code: 26/10/20/03 | Nha khoa | Bác sĩ".
- Khi tạo link (trang Link xem 3D hoặc trong đơn hàng), file exocad mở trong khung sandbox, chụp góc nhìn 3D (xoay rồi bấm **Chụp góc này** để chọn góc khác), ghép khung D.EIGHT, lưu KV `og:<mã>`. Không chụp được thì dùng ảnh mặc định `public/brand/og-3d.jpg`.
- `robots.txt` cho phép `/v/` và `/og/` để ứng dụng chat đọc được (trang vẫn `noindex`).

## Cài đặt (`/admin#settings`, cần quyền Nhân sự)

- **Thanh toán online (PayPal / Stripe): tắt mặc định.** Khi tắt, khách không thấy nút trả tiền, công nợ ghi ở sổ thanh toán. Lưu ở KV `cfg:settings`.
- **Tự đánh dấu 2 ca đầu là dùng thử: tắt mặc định.**

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
| `public/orders.js`, `public/books.js`, `public/tech.js` | Sổ đơn hàng; khách hàng, mã hàng & bảng giá, báo cáo, nhập/xuất Excel, cài đặt; trang Kỹ thuật viên, Công của tôi, phiếu công |
| `public/stl.html` | Chuyển HTML exocad sang STL |
| `public/about.html`, `public/site/about.js`, `public/site/about-dict.js`, `public/site/about/` | Trang Giới thiệu: ca tiêu biểu, ảnh màn hình CAD, video, thêm ca (song ngữ). Ảnh và video đặt tên trung tính, không có tên bệnh nhân hay lab |
| `public/privacy.html`, `public/terms.html` | Chính sách bảo mật, Điều khoản dịch vụ (song ngữ) |
| `public/brand.css`, `public/case.css` | Giao diện theo bộ nhận diện; giao diện ca hàng dùng chung cho cổng khách và quản trị |
| `public/brand/`, `public/site/`, `public/icons/` | Logo SVG, ảnh trang chủ, biểu tượng |
| `dev/server.mjs` | Bộ giả lập Cloudflare Pages + KV + Google (khóa thử) để chạy trên máy, không được triển khai |

## Thanh toán PayPal / Stripe

- Khi admin chọn **Chờ thanh toán**, ca của khách hiện khung "Payment due" với nút **Pay with PayPal** và/hoặc **Pay by card** (Stripe Checkout). Nút nào hiện tùy khóa API đã gắn; chưa gắn khóa nào thì khung chỉ báo số tiền và link WhatsApp.
- Luồng: máy chủ tạo đơn PayPal (Orders v2) hoặc phiên Stripe Checkout với số tiền tính ở máy chủ → khách trả trên trang PayPal/Stripe → quay về `/portal?pay=...&case=...` → máy chủ hỏi thẳng PayPal/Stripe (capture đơn PayPal, đọc phiên Stripe), kiểm tra mã ca, số tiền, USD → ca chuyển sang **Khách báo đã trả, chờ xác nhận**. Khách đóng tab giữa chừng thì lần sau mở ca (khách hoặc admin) hệ thống tự kiểm tra lại; admin có nút **Kiểm tra thanh toán**.
- **Admin xác nhận mọi khoản** (giảm rủi ro): khi tiền đã về tài khoản PayPal/Stripe/ngân hàng, người có quyền "Báo giá, xác nhận thanh toán" bấm **Đã nhận tiền** → ca **Đã thanh toán**; bấm **Chưa nhận được** → ca quay về Chờ thanh toán. Khách cũng có thể báo "đã trả bằng chuyển khoản / Payoneer" kèm mã giao dịch; khoản này cũng chờ admin xác nhận.
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
- **Bindings:** KV namespace, biến `CASES`, kho `d8-3d-cases`. **D1 database, tên biến (Name) `DB`, cơ sở dữ liệu (Value) `d8-db`** (sổ đơn hàng; tạo ở Storage & Databases → D1 SQL Database → Create, rồi thêm binding ở Pages `d8-3d` → Settings → chọn **Production** → Bindings, sau đó triển khai lại; bảng tự tạo và tự nâng cấp lần đầu dùng). Đặt tên biến khác (vd `d8-db`) web vẫn tự nhận; mục **Cài đặt** trong khu làm việc cho biết máy chủ đang thấy những binding nào. Tùy chọn: **Workers AI** tên `AI` (dịch tin nhắn); **R2 bucket** tên `FILES` (lưu file ca, 10 GB miễn phí, vượt mức khoảng 0,015 USD/GB/tháng; khi có, file mới lưu vào R2 và **được giữ cùng ca, kể cả ca đã hoàn thành**, đến khi xóa; file cũ trong KV vẫn tải được đến hạn 60 ngày). **Không** đặt Lifecycle rule xóa tiền tố `jf:`. Mục **Cài đặt › Lưu trữ file ca** cho biết web đang lưu ở R2 hay KV; Chính sách bảo mật và Điều khoản tự ghi đúng theo đó.
- **Variables and secrets:** `UPLOAD_PASSWORD` (mật khẩu quản trị; cũng dùng làm khóa ký cookie phiên, đổi mật khẩu sẽ đăng xuất mọi người). Tùy chọn: `ADMIN_EMAILS` (danh sách email quản trị, cách nhau bằng dấu phẩy), `GOOGLE_CLIENT_ID`, thanh toán `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` (+ `PAYPAL_ENV=live`), `STRIPE_SECRET_KEY` (xem mục Thanh toán), chống spam `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET` (Cloudflare Turnstile).
- **Tên miền chính thức:** gắn ở Workers & Pages → `d8-3d` → Custom domains. Tên miền gốc (`d8designcenter.com`) cần DNS do Cloudflare quản lý (đổi nameserver); tên miền phụ (`www.`, `3d.`) chỉ cần bản ghi CNAME trỏ về `d8-3d.pages.dev` ở nơi quản lý DNS. Khi web mở được ở tên miền mới: mở **Cài đặt** ngay tại tên miền đó → **Đặt … làm tên miền chính**. Từ đó `d8-3d.pages.dev` và link xem 3D cũ tự chuyển về tên miền chính (API và bản xem thử nhánh không đổi), trang chủ / Chính sách / Điều khoản mở cho Google (robots.txt, sitemap.xml, thẻ canonical). Nếu tên miền chính hỏng: mở `https://d8-3d.pages.dev/admin?stay=1` để vào Cài đặt và bấm **Bỏ tên miền chính**. Nhớ thêm tên miền mới vào *Authorized JavaScript origins* của Google (đăng nhập) và Hostnames của Turnstile.
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

**Kiểm tra trước mỗi lần đưa lên web** (bắt buộc, xem `CLAUDE.md`):

```bash
dev/tests/run.sh /tmp/d8-shots    # API + trình duyệt (máy tính, điện thoại, sáng/tối), tốc độ, không có lỗi trang
```

Gồm: phân quyền và quy trình KTV → QC → giao khách (`rbac.test.mjs`), sổ đơn hàng: mã đơn R/C, quyền KTV, thanh toán, báo cáo, nhập Excel, ảnh xem trước (`orders.test.mjs`, `orders_ui.py`), khu làm việc khi chưa có D1 (`nodb_ui.py`), ai thấy gì: khách vãng lai / khách hàng / được cấp quyền (`access_ui.py`), thanh toán (`pay.test.mjs`), Workspace (`workspace_ui.py`), cổng khách hàng (`portal_ui.py`), trang web và giao diện chung (`site_ui.py`), tốc độ và độ ổn định bố cục trên điện thoại chậm (`perf.py`), chuyển ca cũ từ KV sang D1 (`move.test.mjs`), 4 KTV + 1 QC làm cùng lúc với độ trễ mạng giống Cloudflare (`team.test.mjs`). Chạy hai lần: có và không có PayPal/Stripe/AI.

## Giới hạn gói miễn phí (Cloudflare KV)

- 1 GB lưu trữ tổng (file ca hàng tự xóa sau 60 ngày, link 3D sau 7–30 ngày)
- 1.000 lượt ghi mỗi ngày (mỗi phần file 20 MB là 1 lượt khi chưa bật R2; tin nhắn, đổi trạng thái của ca lưu ở D1 nên không tốn lượt KV), 100.000 lượt đọc mỗi ngày
- D1 (gói miễn phí): 100.000 dòng ghi và 5 triệu dòng đọc mỗi ngày, 5 GB
- Tối đa 25 MB mỗi giá trị (vì vậy file lớn được chia phần 20 MB)
