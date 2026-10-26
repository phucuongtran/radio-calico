# Radio Calico — System Architecture Diagram

Sơ đồ mô tả kiến trúc hiện có trong repository. Mở file trên GitHub hoặc Markdown Preview có hỗ trợ Mermaid để xem hình. Chi tiết API và module: [ARCHITECTURE.md](ARCHITECTURE.md). Cách vận hành: [DOCKER.md](DOCKER.md).

## 1. Production — http://localhost:3001

```mermaid
flowchart TB
    Browser["Trình duyệt người nghe<br/>HTML, CSS, JavaScript chạy tại đây"]

    subgraph Host["Docker host: máy của bạn hoặc server"]
        HostPort["Cổng host 127.0.0.1:3001<br/>PROD_PORT"]

        subgraph DefaultNet["Compose network: default"]
            subgraph FrontendContainer["web container — radio-calico:frontend"]
                Web["Nginx :8080"]
                Assets["index.html và static files<br/>đóng trong frontend image"]
            end
            App["app container<br/>Gunicorn + Flask :3000<br/>radio-calico:production"]
        end

        subgraph DatabaseNet["Compose network: database — internal"]
            DB[("db container<br/>PostgreSQL :5432<br/>postgres:17-alpine")]
        end

        Volume[("Docker volume<br/>radio-calico-prod_postgres-data")]
    end

    subgraph External["Dịch vụ Internet bên ngoài"]
        CloudFront["CloudFront<br/>HLS audio, metadata JSON, cover.jpg"]
        JsDelivr["jsDelivr<br/>HLS.js khi nhấn Play"]
        Fonts["Google Fonts<br/>Montserrat và Open Sans"]
    end

    Browser -->|"HTTP: trang web và API"| HostPort
    HostPort -->|"Docker publish 3001 → 8080"| Web
    Web -->|"Đọc HTML/CSS/JS/ảnh cho / và /static/*"| Assets
    Web -->|"Proxy HTTP /api/* tới app:3000"| App
    App -->|"Psycopg: SQL qua mạng database"| DB
    DB -->|"Mount /var/lib/postgresql/data"| Volume
    Browser -->|"HTTPS trực tiếp"| CloudFront
    Browser -->|"HTTPS tải thư viện player"| JsDelivr
    Browser -->|"HTTPS tải font"| Fonts
```

- **Nginx phục vụ frontend:** trả HTML/CSS/JS/ảnh cho trình duyệt; JavaScript được thực thi trong trình duyệt.
- **Nginx proxy API:** `/api/ratings`, `/api/health`, `/api/playback-diagnostics` được chuyển tới Gunicorn/Flask.
- **Flask kết nối database:** backend tham gia cả network `default` và `database`; PostgreSQL chỉ ở network `database` nội bộ. Nginx không kết nối trực tiếp PostgreSQL.
- **Chỉ cổng Nginx được publish:** backend `3000` và PostgreSQL `5432` không mở thành cổng host.
- **Audio không qua backend:** trình duyệt tải HLS/metadata/cover trực tiếp từ CloudFront; CORS của các dịch vụ ngoài vẫn áp dụng. API nội bộ đi cùng origin qua Nginx.
- **Build và runtime:** `docker/render_frontend.py` dùng Flask/Jinja render template thành `index.html` khi build image. Sau đó Nginx phục vụ file đã render; mở trang Production không cần Flask render lại HTML hoặc truy vấn PostgreSQL.

Thứ tự khởi động theo health check: **PostgreSQL → backend → Nginx**. `/api/health` đi qua Nginx tới Flask và kiểm tra kết nối database.

## 2. Development — http://localhost:3000

```mermaid
flowchart LR
    Browser["Trình duyệt<br/>HTML/CSS/JS chạy trong browser"]

    subgraph Host["Docker host"]
        HostPort["127.0.0.1:3000<br/>DEV_PORT"]
        Source["Source code trong repository"]
        Volume[("Docker volume<br/>radio-calico-dev_ratings-data")]

        subgraph Container["app container — radio-calico:development"]
            Flask["Flask development server :3000<br/>Render template + static + API"]
            SQLite[("SQLite file<br/>/data/radiocalico.sqlite")]
        end
    end

    CloudFront["CloudFront<br/>HLS audio, metadata, cover"]

    Browser -->|"HTTP /, /static/*, /api/*"| HostPort
    HostPort -->|"Docker publish 3000 → 3000"| Flask
    Source -->|"Bind mount /app, chỉ đọc; reload khi code đổi"| Flask
    Flask -->|"SQL qua sqlite3"| SQLite
    Volume -->|"Mount /data"| SQLite
    Browser -->|"HTTPS trực tiếp"| CloudFront
```

Development dùng một container ứng dụng, không có Nginx hay PostgreSQL. Flask vừa gửi file frontend vừa xử lý API trên cùng origin. SQLite là file, không có cổng mạng. Các nguồn jsDelivr/Google Fonts được trình duyệt truy cập như Production.

Khi chạy Flask trực tiếp bằng Python ngoài Docker, luồng HTTP tương tự; SQLite mặc định nằm trong `data/` của repository thay vì Docker volume.

## 3. Bảng cổng và dữ liệu

| Môi trường / thành phần | Cổng trên host | Cổng trong container | Lưu trữ |
| --- | --- | --- | --- |
| Development Flask | `127.0.0.1:3000` | `app:3000` | SQLite trong volume Development |
| Production Nginx | `127.0.0.1:3001` | `web:8080` | HTML/static trong image |
| Production backend | Không publish | `app:3000` | Kết nối PostgreSQL |
| Production PostgreSQL | Không publish | `db:5432` | Volume PostgreSQL riêng |

Các cổng là mặc định hiện tại; `DEV_PORT`, `PROD_PORT`, `PROD_BIND` có thể thay đổi chúng. Tên volume trong sơ đồ dùng Compose project mặc định; đổi project name sẽ đổi tên volume. Container và volume được quản lý bởi Docker Engine đã chọn; Docker Desktop là một cách chạy/quản lý engine. Hai Docker engine độc lập không tự chia sẻ container hoặc volume.

SQLite Development và PostgreSQL Production độc lập, không tự đồng bộ hoặc migrate dữ liệu. Các volume giữ phiếu đánh giá và secret ký cookie qua lần tạo lại container. Không dùng `down --volumes` nếu cần giữ dữ liệu.

## 4. Luồng đánh giá bài hát trong Production

```mermaid
sequenceDiagram
    autonumber
    actor User as Người nghe
    participant Browser as Browser: metadata.js / ratings.js
    participant CDN as CloudFront
    participant Nginx as Nginx web:8080
    participant API as Flask API app:3000
    participant DB as PostgreSQL db:5432

    Browser->>CDN: GET metadatav2.json
    CDN-->>Browser: Tên bài, nghệ sĩ, lịch sử bài hát
    Note over Browser: Sự kiện radiocalico:track kích hoạt đọc rating
    Browser->>Nginx: GET /api/ratings?title=...&artist=...
    Nginx->>API: Proxy request, chuyển cookie nếu có
    Note over API: Tạo session người nghe nếu chưa có
    API->>DB: SELECT tổng phiếu và lựa chọn của listener
    DB-->>API: thumbs_up, thumbs_down, user_rating
    API-->>Nginx: JSON + csrf_token, Set-Cookie nếu tạo session
    Nginx-->>Browser: Response giữ cookie và header

    User->>Browser: Nhấn thích hoặc không thích
    Browser->>Nginx: POST /api/ratings, cookie + X-CSRF-Token + JSON
    Nginx->>API: Proxy request
    API->>API: Kiểm tra session, CSRF và dữ liệu
    alt Request hợp lệ
        API->>DB: UPSERT theo song_key và listener_id, COMMIT
        API->>DB: SELECT tổng phiếu sau cập nhật
        DB-->>API: Tổng phiếu và lựa chọn hiện tại
        API-->>Nginx: HTTP 200 + JSON
        Nginx-->>Browser: HTTP 200 + JSON
        Browser-->>User: Cập nhật số phiếu và nút được chọn
    else Session hoặc CSRF không hợp lệ
        API-->>Nginx: HTTP 403, không ghi phiếu
        Nginx-->>Browser: HTTP 403 + thông báo lỗi
    end
```

Backend chuẩn hóa title/artist rồi tạo `song_key` bằng SHA-256. `song_ratings` có khóa chính `(song_key, listener_id)`, nên đổi lựa chọn sẽ cập nhật phiếu hiện tại. Cookie `radiocalico_listener` có chữ ký, `HttpOnly`, `SameSite=Lax`; secret ký nằm trong `app_metadata`. Không có đăng nhập tài khoản; định danh gắn với cookie trình duyệt. Response API dùng `Cache-Control: no-store`.

Development có cùng luồng rating, với trình duyệt gọi thẳng Flask và Flask dùng SQLite thay cho PostgreSQL.

## 5. CI và quan hệ với triển khai

```mermaid
flowchart TB
    Change["GitHub: push hoặc pull request"] --> Workflow["GitHub Actions<br/>.github/workflows/tests.yml"]
    Workflow --> Lint["lint<br/>Ruff + ESLint"]
    Workflow --> Tests["tests<br/>Python unittest + Node test<br/>Ubuntu/Windows, Python 3.11/3.12"]
    Workflow --> Integration["integration<br/>Flask API + SQLite + PostgreSQL 17 tạm"]
    Workflow --> Build["build<br/>Dựng image development, production, frontend"]
    Workflow --> Security["security<br/>npm audit dependency trong lockfile"]
    Workflow --> Docker["docker<br/>Compose Dev/Prod smoke test<br/>HTTP, CSRF, persistence, lỗi và khôi phục"]
    Lint --> Result["Kết quả kiểm tra trên commit / PR"]
    Tests --> Result
    Integration --> Result
    Build --> Result
    Security --> Result
    Docker --> Result
```

Các job chạy độc lập và báo kết quả riêng. Database/schema/project/volume dùng cho test được tạo tạm; kiểm tra không dùng database Production. npm audit bao gồm dependency phát triển ESLint, không quét thư viện Python, image Docker hoặc HLS.js tải từ CDN.

Workflow hiện là **CI**: chưa tự publish image lên registry hoặc deploy ứng dụng. Người vận hành chạy `make dev` / `make prod` để build và khởi động môi trường tương ứng. Đề xuất cache/nén/tối ưu tải trang ở [PERFORMANCE.md](PERFORMANCE.md) chưa được áp dụng vào runtime trong sơ đồ này.

## Các file cấu hình làm nguồn đối chiếu

- [compose.dev.yaml](compose.dev.yaml), [compose.prod.yaml](compose.prod.yaml): container, network, port và volume.
- [Dockerfile](Dockerfile), [docker/render_frontend.py](docker/render_frontend.py): image và render frontend lúc build.
- [docker/nginx.conf](docker/nginx.conf), [gunicorn.conf.py](gunicorn.conf.py): web server và API server.
- [app.py](app.py), [ratings.py](ratings.py), [database.py](database.py): route, session/CSRF và lưu trữ.
- [static/main.js](static/main.js), [static/metadata.js](static/metadata.js), [static/player/hls-loader.js](static/player/hls-loader.js): frontend và dịch vụ ngoài.
- [.github/workflows/tests.yml](.github/workflows/tests.yml): CI.
