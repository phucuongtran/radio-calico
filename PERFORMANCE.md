# Phân tích tốc độ tải trang Radio Calico

## Phạm vi đo ngày 26/10/2026

Đã đọc mã frontend/Flask/Nginx và kiểm tra response HTTP trên stack Production Docker tạm. Chưa chạy Lighthouse hoặc trace trình duyệt, chưa có số đo LCP/INP/CLS hay tốc độ mạng người dùng thực tế. Các ưu tiên dưới đây dựa trên cấu hình và dung lượng đo được, không phải cam kết số giây cải thiện.

| Tài nguyên | Dung lượng chưa nén |
| --- | ---: |
| HTML đã render | 8.555 byte |
| 9 file JavaScript nội bộ | 27.835 byte |
| 7 file CSS nội bộ | 17.629 byte |
| Logo PNG, 672×672 pixel | 55.600 byte |

Tổng HTML/CSS/JS là **54.019 byte**; nén gzip từng file bằng công cụ local cho kết quả tổng **18.707 byte**, giảm khoảng **65,4% dung lượng văn bản**. Đây là ước tính byte, không phải giảm 65,4% thời gian tải trang; cấu hình nén thực tế sẽ cho số khác. Chưa tính Google Fonts, metadata/cover CloudFront và HLS.js khi nhấn phát.

Probe gửi `Accept-Encoding: gzip` tới `/`, `/static/main.js`, `/static/style.css`, `/static/images/radio-calico-logo.png` qua Nginx đều nhận `200`, `Cache-Control: no-store` và không có `Content-Encoding`. `docker/nginx.conf` áp dụng `no-store` cho toàn server, không bật gzip; Flask cũng trả `no-store` cho mọi response ở Development.

## Ưu tiên tối ưu

| Ưu tiên | Phát hiện | Đề xuất |
| --- | --- | --- |
| 1 | CSS/JS/ảnh Production đều không được lưu cache | Thêm tên file theo content hash và sửa toàn bộ tham chiếu/import con, rồi đặt static `public, max-age=31536000, immutable`. HTML dùng `no-cache` để tái xác thực; API/session giữ `no-store`. Lợi ích chính ở lần truy cập sau. |
| 1 | Văn bản chưa nén trong probe | Bật gzip cho HTML tĩnh, CSS, JS; kiểm tra `Content-Encoding` và `Vary: Accept-Encoding`. PNG không cần gzip. Giữ API/session theo chính sách riêng. |
| 2 | `style.css` dùng `@import` Google Fonts và 6 CSS con | Đưa font stylesheet vào HTML; gộp CSS khi build Production hoặc dùng `<link>` trực tiếp để giảm tầng khám phá stylesheet. Giữ chính xác thứ tự cascade. |
| 2 | Montserrat/Open Sans yêu cầu nhiều weight và phụ thuộc Google | Xác định weight/glyph cần dùng; cân nhắc WOFF2 variable/subset tự phục vụ hoặc font hệ thống. Nếu giữ Google, preconnect có chọn lọc tới Google Fonts và `fonts.gstatic.com` với `crossorigin`. |
| 2 | Logo 672×672 hiển thị ở 56×56, 96×96, 160×160 | Tạo ảnh đúng kích thước/mật độ pixel bằng WebP/AVIF có fallback PNG, dùng `srcset` phù hợp. Logo hiện nặng hơn tổng HTML/CSS/JS chưa nén. |
| 3 | 9 ES module tạo nhiều tầng import | Đo waterfall; cân nhắc `modulepreload` cho module cần ngay hoặc bundle/minify chỉ ở Production. Tổng JS nhỏ nên ưu tiên sau cache/CSS/font. |
| 3 | Metadata/cover phụ thuộc CloudFront; rating tải sau metadata | Cân nhắc preconnect tới CloudFront, đo thời gian hiện tên bài và nút rating sẵn sàng riêng. Không cache metadata lâu nếu cần theo kịp radio trực tiếp. |

Không đặt cache immutable một năm cho URL cố định như `/static/main.js` trước khi có version/content hash: người dùng có thể giữ mã cũ sau deploy. Phải xử lý cả import CSS/JS và ảnh con, không chỉ hai entrypoint. CSS con có thể tải song song sau khi đọc `style.css`; không phải sáu request lần lượt nối tiếp nhau.

## Các lựa chọn hiện tại nên giữ

- HTML Production được render khi build và Nginx phục vụ trực tiếp, không chờ PostgreSQL khi mở trang.
- JavaScript thuần, dung lượng nhỏ; chưa có lý do đổi framework chỉ để tăng tốc.
- `<audio preload="none">` và HLS.js chỉ tải khi người dùng nhấn phát; không đưa stream vào đường tải ban đầu.
- Ảnh đã có kích thước; cover dùng `decoding="async"`; Google Fonts đã dùng `display=swap`.
- Metadata độc lập với playback; dừng lịch polling khi trang ẩn và không tải lại cover mỗi poll nếu bài không đổi.
- API ratings chứa cookie/CSRF và trạng thái người nghe; giữ ngoài cache công khai.

Vì trang đầu do Nginx phục vụ, chưa có bằng chứng tăng Gunicorn worker, thêm Redis hay đổi database sẽ cải thiện render ban đầu. Thời gian từ nhấn Play tới nghe tiếng là chỉ số khác với thời gian tải trang.

## Kiểm chứng trước và sau

1. Đo Production Nginx; ghi rõ viewport, thiết bị và profile mạng/CPU.
2. Chạy Lighthouse/Chrome DevTools ít nhất ba lượt cho tải lần đầu và tải lại có cache; so sánh trung vị. Xem waterfall và phần tử LCP để xác định tài nguyên chặn render.
3. Theo dõi TTFB, FCP, LCP, CLS, byte truyền và số request. Đo thời gian metadata/rating riêng; dùng trace tương tác hoặc dữ liệu người dùng cho INP, không suy INP từ điểm Lighthouse đơn lẻ.
4. Sửa từng nhóm: cache/nén → CSS/font → ảnh → module; kiểm tra lại chức năng và playback nếu chạm player.
5. Khi có baseline ổn định, cân nhắc Lighthouse CI với budget về byte/request và LCP lab; nguồn CDN ngoài có thể làm kết quả dao động.

## Tham khảo

- [Nginx gzip module](https://nginx.org/en/docs/http/ngx_http_gzip_module.html): cấu hình nén response.
- [Optimize Largest Contentful Paint — web.dev](https://web.dev/articles/optimize-lcp): đo và phân tích tải nội dung chính.
- [Preconnect — MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preconnect): mở kết nối sớm tới origin cần thiết.

Chưa áp dụng các đề xuất tối ưu runtime trong lần phân tích này.
