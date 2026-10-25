# Radio Calico — Kiến trúc kỹ thuật

## Tech stack

| Thành phần | Công nghệ hiện có trong repository |
| --- | --- |
| Backend | Python 3.11 trong môi trường hiện tại; Flask 3.1.3, Werkzeug 3.1.8. |
| Template | Jinja2 3.1.6, HTML render phía server. |
| Frontend | JavaScript thuần dùng ES modules, CSS chia theo thành phần; không có bước build asset. |
| Âm thanh | HTML audio, HLS.js 1.6.19 từ jsDelivr; native HLS dự phòng. |
| Lưu trữ | SQLite qua `sqlite3` tích hợp Python; không dùng ORM. |
| Kiểm thử | Python `unittest`; Node.js `node:test` và `node:assert/strict`; runner chung `scripts/test.py`. |
| Vận hành | Flask development server, script PowerShell quản lý server nền. |

Dependency Python được ghim trong [requirements.txt](requirements.txt). Node chỉ cần cho test JavaScript; không cần cài package npm để chạy ứng dụng hoặc test. `package.json` khai báo ES modules cho Node và cung cấp lệnh `npm test` tùy chọn. Hiện chưa cấu hình formatter, linter hoặc ngưỡng coverage.

## File structure

```text
radiocalico/
├── AGENTS.md               # Quy tắc làm việc
├── PROJECT.md              # Tổng quan sản phẩm
├── ARCHITECTURE.md         # Kiến trúc và API
├── README.md               # Hướng dẫn chạy
├── README.vi.md            # Hướng dẫn tiếng Việt
├── requirements.txt        # Dependency Python
├── package.json            # ES modules và lệnh test Node, không có dependency npm
├── .env.example            # Cấu hình mẫu
├── .gitignore
├── app.py                  # Flask factory, route và CLI
├── config.py               # Đọc cấu hình
├── database.py             # Kết nối và schema SQLite
├── diagnostics.py          # Kiểm tra sự kiện và lọc trường diagnostics
├── ratings.py              # API đánh giá
├── templates/
│   └── index.html          # Trang chủ
├── static/
│   ├── main.js             # Khởi tạo player, ratings rồi metadata
│   ├── player.js           # Điều khiển phát nhạc
│   ├── player/
│   │   ├── hls-loader.js   # Tải HLS.js, timeout và thử lại
│   │   ├── listening-time.js # Tính và hiển thị thời gian nghe
│   │   └── diagnostics.js  # Thu thập và gửi trạng thái playback
│   ├── metadata.js         # Thông tin bài hát
│   ├── metadata-data.js    # Chuẩn hóa feed độc lập với DOM
│   ├── ratings.js          # Giao diện đánh giá
│   ├── ratings-api.js      # HTTP, timeout và hủy request đánh giá
│   ├── style.css           # Entry stylesheet, giữ thứ tự import
│   ├── styles/
│   │   ├── base.css        # Biến màu, phần tử cơ bản và header
│   │   ├── listening-room.css # Bố cục nghe nhạc và hình đĩa
│   │   ├── tracks.css      # Bài hiện tại, lịch sử và nút đánh giá
│   │   ├── player.css      # Điều khiển và trạng thái phát
│   │   ├── sections.css    # Giới thiệu, chi tiết stream và footer
│   │   └── responsive.css  # Animation, breakpoint và reduced motion
│   └── images/
│       └── radio-calico-logo.png
├── scripts/
│   ├── test.py             # Runner chung cho backend/frontend
│   └── background.ps1      # Quản lý server nền
├── tests/                  # Unit/integration test Python; support.py tạo SQLite tạm
├── test/                   # Test Node.js cho controller/API; helpers/ mô phỏng trình duyệt
├── .github/workflows/tests.yml # CI Ubuntu/Windows, Python 3.11/3.12, Node 22
├── RadioCalicoStyle/       # Tài nguyên thương hiệu gốc
├── public/                 # Thư mục trống hiện tại
├── data/                   # Database cục bộ
└── logs/                   # Log server
```

Đây là cấu trúc chính; lược bỏ môi trường ảo, cache và file nén. Flask phục vụ tài nguyên từ `static/`.

## Tổ chức module

| Đường dẫn | Trách nhiệm |
| --- | --- |
| `app.py` | Factory `create_app(test_config=None)`, trang chủ, health check, diagnostics, CLI. |
| `config.py` | Đọc `.env`, biến môi trường và chuẩn hóa cấu hình. |
| `database.py` | Kết nối theo application context, khởi tạo schema, đóng kết nối khi teardown. |
| `diagnostics.py` | Danh sách sự kiện/trường được phép và hàm lọc payload diagnostics. |
| `ratings.py` | Blueprint đánh giá, định danh bài hát/người nghe, CSRF. |
| `templates/index.html` | Trang chủ Jinja, nạp controller và CSS. |
| `static/main.js` | Entry ES module, khởi tạo các controller theo thứ tự. |
| `static/player.js`, `static/player/` | Controller điều phối playback; helper tải HLS, tính thời gian nghe và gửi diagnostics. |
| `static/metadata.js`, `static/metadata-data.js` | Controller poll/render và hàm chuẩn hóa feed độc lập với DOM. |
| `static/ratings.js`, `static/ratings-api.js` | Controller xử lý lựa chọn/race; API client quản lý HTTP, timeout và hủy request. |
| `static/style.css`, `static/styles/`, `static/images/` | Entry CSS, stylesheet theo thành phần và ảnh công khai. |
| `tests/`, `test/` | Unit/integration test Python (`test*.py`) và controller/API test Node (`*.test.cjs`), có helper dùng chung. |
| `scripts/test.py` | Chạy hai phía, lọc `--ratings`, chọn `--backend`/`--frontend`, tổng hợp mã lỗi. |
| `scripts/background.ps1` | Start/stop server nền; log trong `logs/`. |

## Luồng xử lý

Template nạp `static/main.js` bằng `<script type="module">`. Entry khởi tạo player, ratings rồi metadata, để bộ nhận sự kiện đánh giá sẵn sàng trước phản hồi metadata đầu tiên. Các controller export `initPlayer`, `initRatings`, `initMetadata`, nhận môi trường trình duyệt qua tham số mặc định `globalThis`; test truyền môi trường mô phỏng trực tiếp, không dùng VM để thực thi chuỗi mã nguồn.

`style.css` import font và các stylesheet theo đúng thứ tự cascade ban đầu. Các breakpoint dành riêng cho bài hát vẫn nằm trong `tracks.css`; breakpoint của toàn trang nằm trong `responsive.css`.

1. Trình duyệt tải `/`; Flask khởi tạo định danh người nghe nếu cần và render template.
2. Khi người dùng nhấn phát, `player.js` kết nối trực tiếp CloudFront qua HLS.js hoặc native HLS. Audio không đi qua Flask.
3. `metadata.js` lấy dữ liệu khi tải trang và làm mới sau 10 giây kể từ lúc request hoàn tất khi trang hiển thị. Chuỗi từ feed được render bằng text.
4. Metadata phát sự kiện `radiocalico:track` gồm `title`, `artist`, `available`; controller đánh giá dùng sự kiện này để đồng bộ bài hát và khóa nút khi dữ liệu không đáng tin cậy.
5. `ratings.js` gọi API cùng origin; SQLite là nguồn dữ liệu đánh giá. Controller bỏ qua phản hồi cũ khi đã đổi bài.
6. Diagnostics gửi về Flask để ghi log; không chứa định danh người nghe hoặc token đánh giá.

### Dịch vụ bên ngoài

Các URL sau nằm trong controller, không phải endpoint Flask:

| Nguồn | URL |
| --- | --- |
| HLS | `https://d3d4yli4hf5bmh.cloudfront.net/hls/live.m3u8` |
| Metadata | `https://d3d4yli4hf5bmh.cloudfront.net/metadatav2.json` |
| Ảnh album | `https://d3d4yli4hf5bmh.cloudfront.net/cover.jpg` |

Metadata sử dụng `title`, `artist`, `album`, các cặp `prev_title_1`/`prev_artist_1` đến `prev_title_5`/`prev_artist_5`. Ảnh thêm tham số làm mới cache khi đổi bài/album; lỗi ảnh dùng logo dự phòng. CSS tải font từ Google Fonts và có font hệ thống thay thế.

## API nội bộ

API trả JSON; lỗi thường có dạng `{"error":"..."}`. Response có `Cache-Control: no-store` và `X-Content-Type-Options: nosniff`.

### `GET /api/health`

Thực thi truy vấn SQLite để kiểm tra kết nối:

- `200`: `{"status":"ok","database":"connected","engine":"sqlite"}`.
- `503`: `{"status":"error","database":"unavailable"}` nếu truy vấn gặp lỗi database.

### `GET /api/ratings?title=...&artist=...`

Hai tham số là chuỗi bắt buộc, dài 1–300 ký tự sau chuẩn hóa. Request hợp lệ tạo session người nghe nếu chưa có. Ví dụ response `200`:

```json
{
  "title": "A Song",
  "artist": "An Artist",
  "thumbs_up": 2,
  "thumbs_down": 1,
  "user_rating": null,
  "csrf_token": "<session-token>"
}
```

`user_rating` là `1`, `-1` hoặc `null`. Trả `400` nếu tên bài/nghệ sĩ sai, `503` nếu không đọc được database.

### `POST /api/ratings`

Gửi cùng cookie session nhận trước đó, `Content-Type: application/json` và header `X-CSRF-Token` từ response GET:

```json
{"title":"A Song","artist":"An Artist","rating":1}
```

- `rating` chỉ nhận số nguyên `1` hoặc `-1`, không nhận boolean, chuỗi hoặc số thực.
- `200`: cùng cấu trúc response GET, chứa tổng phiếu và lựa chọn hiện tại.
- `400`: payload/trường không hợp lệ; `403`: thiếu/sai session hoặc CSRF; `415`: không gửi JSON; `503`: lỗi database. Giới hạn body 4 KiB; vượt giới hạn trả `413`.
- Gửi lại cùng lựa chọn không cộng thêm phiếu. Trường định danh người nghe do client gửi không được sử dụng.

### `POST /api/playback-diagnostics`

Nhận JSON có `event` thuộc: `engine-selected`, `manifest-parsed`, `waiting`, `stalled`, `hls-error`, `timeout`.

Các trường tùy chọn được giữ lại: `engine`, `state`, `currentTime`, `paused`, `seeking`, `readyState`, `networkState`, `buffered`, `seekable`, `mediaError`, `lastHlsError`, `fragmentsLoaded`, `fragmentsBuffered`, `lastFragment`. Trường ngoài danh sách bị loại; trường tùy chọn chưa được kiểm tra kiểu chi tiết. Endpoint hiện không yêu cầu session hoặc CSRF.

Trả `204` sau khi ghi log, `400` khi payload/event sai, `415` khi không gửi JSON, `413` khi vượt 8 KiB.

## Database và định danh

- `app_metadata`: bảng STRICT với `key` khóa chính và `value`; lưu `created_at` và bí mật ký session `rating_session_secret`.
- `song_ratings`: bảng STRICT gồm `song_key`, `listener_id`, `title`, `artist`, `rating`, `created_at`; khóa chính ghép `(song_key, listener_id)`, ràng buộc `rating IN (-1, 1)`.
- Khóa bài hát là SHA-256 của JSON chứa `[title, artist]` sau chuẩn hóa Unicode NFKC, khoảng trắng và `casefold()`.
- Ghi phiếu bằng SQL có tham số và UPSERT nguyên tử; đổi phiếu cập nhật dòng hiện có, giữ `created_at` ban đầu.
- Kết nối bật foreign keys và timeout khóa 5 giây; khởi tạo bật WAL. Schema dùng `CREATE TABLE IF NOT EXISTS`; chưa có framework migration.
- Cookie `radiocalico_listener` có chữ ký, `HttpOnly`, `SameSite=Lax`, thời hạn tối đa 365 ngày. Bí mật ký lưu trong database để giữ định danh qua lần khởi động lại. Chữ ký cookie không mã hóa nội dung.

## Cấu hình và vận hành

Thứ tự ưu tiên: biến môi trường tiến trình → `.env` → mặc định.

| Khóa | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PORT` | `3000` | Cổng HTTP, trong khoảng 1–65535. |
| `DATABASE_PATH` | `./data/radiocalico.sqlite` | Đường dẫn tương đối tính từ thư mục dự án. |

Khởi động lại sau khi đổi `.env`. Flask CLI bind `127.0.0.1`; `--debug` bật reload/debugger. Script nền ghi `logs/server.log`, `logs/server-error.log` và theo dõi tiến trình bằng PID cùng thời điểm khởi tạo.

`app.py db` liệt kê bảng; `app.py db "SQL"` chạy một câu SQL và commit, kể cả lệnh ghi. Khi sao lưu, dừng server rồi sao chép toàn bộ `data/`, gồm file SQLite phụ. Không đưa `.env`, dữ liệu, log hoặc bí mật vào quản lý phiên bản.

Lệnh cài đặt, chạy và test: [README.md](README.md). Mục tiêu sản phẩm: [PROJECT.md](PROJECT.md). Quy tắc làm việc: [AGENTS.md](AGENTS.md).
