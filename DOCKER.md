# Chạy Radio Calico bằng Docker

Máy chủ cần Docker Engine/Desktop với Linux containers, Compose và Buildx. Dependency ứng dụng nằm trong image. Development dùng Flask/SQLite; Production có ba service Nginx, Gunicorn và PostgreSQL 17. Hai file Compose độc lập.

| Thành phần | Development | Production |
| --- | --- | --- |
| Frontend | Flask phục vụ template và static | Nginx phục vụ HTML/CSS/JS trong image `frontend` |
| Backend | Flask debug/reload, tắt interactive debugger | Gunicorn 26.2.0, 1 worker/4 threads trong image `production` |
| Database | SQLite trong `radio-calico-dev_ratings-data` | PostgreSQL trong `radio-calico-prod_postgres-data` |
| Source | Bind mount repository chỉ đọc | Source đóng trong image, không bind mount |
| Test tools | Python 3.11, Node 22 | Python runtime và Psycopg 3.3.6; không chứa bộ test |

Mặc định cả hai dùng **http://127.0.0.1:3000**. Đổi `DEV_PORT` hoặc `PROD_PORT` nếu chạy đồng thời. Các lệnh dưới đây chạy tại thư mục dự án.

## Lệnh Make

Nếu có GNU Make trên Linux/macOS/WSL, chạy `make help` để xem các lệnh rút gọn:

| Lệnh | Hành vi |
| --- | --- |
| `make env` | Tạo `.env.docker` với quyền riêng tư từ file mẫu, giữ nguyên file nếu đã tồn tại. Sau đó đặt `POSTGRES_PASSWORD` trước khi chạy Production. |
| `make dev` | Build/chạy Development ở foreground; Ctrl+C để dừng. |
| `make prod` | Kiểm tra file môi trường, build/chạy Production ở background và chờ healthy. |
| `make dev-down`, `make prod-down` | Dừng container, giữ volume dữ liệu. |
| `make dev-logs`, `make prod-logs` | Theo dõi log. |
| `make dev-status`, `make prod-status` | Xem trạng thái container. |
| `make test` | Build image Development và chạy toàn bộ test trong container. |
| `make test-ratings`, `make test-backend`, `make test-frontend` | Chọn bộ test trong Docker. |
| `make test-local` | Chạy test bằng Python/Node trên host. |
| `make test-docker` | Chạy smoke test bằng project/volume tạm, gồm PostgreSQL thật; cần Python 3 trên host. |

`make test` không khởi động Production. Các ca PostgreSQL được skip khi không có `TEST_DATABASE_URL`; dùng `make test-docker` để kiểm tra đầy đủ với PostgreSQL tạm. `make test-local` tự chọn `.venv/bin/python` nếu có, nếu không dùng `python3`; có thể đặt `PYTHON` rõ ràng. Ví dụ: `make test-local PYTHON=.venv/bin/python TEST_ARGS=--ratings`.

Mặc định Production dùng `.env.docker`; đổi bằng `make prod ENV_FILE=/path/to/private.env`. Các lệnh Make nhận biến Docker từ môi trường, gồm `DOCKER_CONFIG`, `DEV_PORT`, `PROD_PORT`. Có thể đổi tên project qua `DEV_PROJECT`/`PROD_PROJECT`; giữ cùng tên project khi chạy/dừng để dùng đúng volume. Make không có target xóa dữ liệu.

## Development

```bash
docker compose -f compose.dev.yaml up --build
```

Sửa Python trên host để tự reload; sửa HTML/CSS/JavaScript rồi refresh trình duyệt. Khi đổi dependency hoặc Dockerfile, build lại. Dừng bằng Ctrl+C hoặc `docker compose -f compose.dev.yaml down`.

```bash
docker compose -f compose.dev.yaml run --rm --no-deps app python scripts/test.py
docker compose -f compose.dev.yaml run --rm --no-deps app python scripts/test.py --ratings
```

Test dùng SQLite tạm. Có thể chạy cả suite từ image Development, không mount source và không cần mạng:

```bash
docker build --target development -t radio-calico:development .
docker run --rm --network none radio-calico:development python scripts/test.py
```

## Khởi tạo Production

Sao chép `.env.docker.example` thành `.env.docker` bằng `cp .env.docker.example .env.docker` trên Linux/WSL hoặc `Copy-Item .env.docker.example .env.docker` trên PowerShell. Đặt mật khẩu riêng, đủ dài cho `POSTGRES_PASSWORD` trong file này trước khi chạy. Compose từ chối khởi động nếu mật khẩu còn trống. Không commit `.env.docker`.

```dotenv
PROD_PORT=3000
PROD_BIND=127.0.0.1
RADIO_CALICO_IMAGE=radio-calico
POSTGRES_DB=radiocalico
POSTGRES_USER=radiocalico
POSTGRES_PASSWORD=<your-random-password>
```

```bash
docker compose --env-file .env.docker -f compose.prod.yaml up --build -d --wait
docker compose --env-file .env.docker -f compose.prod.yaml ps
docker compose --env-file .env.docker -f compose.prod.yaml logs -f web app db
```

Luồng request:

```text
Browser -> Nginx web:8080 -> /api/* -> Gunicorn app:3000 -> PostgreSQL db:5432
              |
              +-> HTML, /static/* từ image frontend
```

Chỉ Nginx publish cổng ra host. Backend và PostgreSQL không publish port; PostgreSQL ở mạng Docker nội bộ. Compose chờ PostgreSQL healthy trước backend, rồi backend healthy trước Nginx. Health check frontend gọi `/api/health` qua Nginx, backend kiểm tra truy vấn database và báo `engine: postgresql`.

HTML được render từ template lúc build bằng Flask/Jinja, không khởi tạo ứng dụng hoặc mở database. Nginx tiếp tục phục vụ HTML/static khi backend dừng. Cookie và header CSRF được chuyển qua proxy cùng origin; API rating giữ nguyên payload và hành vi. Phiên nghe được khởi tạo khi frontend đọc API rating lần đầu.

Nginx chạy bằng user không phải root; backend dùng UID/GID `10001:10001`. Hai service có root filesystem chỉ đọc và `/tmp` là tmpfs. Log stdout/stderr được xoay 10 MB/file, tối đa 3 file. `restart: unless-stopped` áp dụng khi tiến trình thoát. Cập nhật mã bằng cách chạy lại `up --build -d --wait`, để rebuild cả backend lẫn frontend.

## Database và dữ liệu cũ

**Production mới khởi tạo PostgreSQL trống. SQLite cũ được giữ nguyên, không tự chuyển dữ liệu.** Volume cũ `radio-calico-prod_ratings-data`, volume Development và database trong `data/` trên host không bị tái sử dụng hay xóa. PostgreSQL dùng volume mới `radio-calico-prod_postgres-data`.

Ứng dụng giữ cả phiếu và bí mật ký cookie trong PostgreSQL. Thay container vẫn giữ dữ liệu và session. Vì database mới có secret riêng, danh tính cookie từ SQLite cũ không được chuyển sang PostgreSQL.

`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` chỉ khởi tạo PostgreSQL ở volume mới. Đổi mật khẩu trong `.env.docker` không đổi mật khẩu của role trong database đã có; cần đổi credential trong PostgreSQL và cấu hình backend tương ứng. Giữ cùng Compose project name khi cập nhật để tiếp tục dùng volume hiện tại.

Backend nhận `DATABASE_URL=postgresql://` cùng các biến libpq `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`. Password truyền riêng, nên ký tự đặc biệt không cần URL-encode. Chạy trực tiếp ngoài Compose có thể dùng một URL PostgreSQL đầy đủ. Khi `DATABASE_URL` trống, ứng dụng dùng `DATABASE_PATH` cho SQLite. Psycopg chỉ cần cho PostgreSQL; cài qua `requirements-production.txt`.

Dừng Production, giữ dữ liệu:

```bash
docker compose --env-file .env.docker -f compose.prod.yaml down
```

Không thêm `--volumes` hoặc xóa volume nếu cần giữ dữ liệu. Schema dùng khởi tạo `CREATE TABLE IF NOT EXISTS`; hiện chưa có framework migration. PostgreSQL lưu khóa chính `(song_key, listener_id)`, ràng buộc rating và cập nhật UPSERT nguyên tử như SQLite.

## Sao lưu PostgreSQL

Tạo dump nhất quán bằng công cụ nằm sẵn trong container, sau đó chép ra host:

```bash
docker compose --env-file .env.docker -f compose.prod.yaml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/radiocalico.dump'
docker compose --env-file .env.docker -f compose.prod.yaml cp db:/tmp/radiocalico.dump ./radiocalico-backup.dump
```

Dump chứa rating và bí mật ký cookie, cần lưu riêng tư. Dùng `pg_restore` với một database đích đã chuẩn bị để khôi phục; sao lưu hiện trạng trước khi thay dữ liệu. Development SQLite vẫn có thể sao lưu bằng SQLite backup API như cách chạy cục bộ.

## Chuyển image dựng sẵn đến máy chủ

Trên máy build, cấu hình `.env.docker` rồi:

```bash
docker compose --env-file .env.docker -f compose.prod.yaml build
docker compose --env-file .env.docker -f compose.prod.yaml pull db
docker save --output radio-calico-production.tar radio-calico:production radio-calico:frontend postgres:17-alpine
```

Chuyển archive, `compose.prod.yaml` và `.env.docker` theo kênh riêng tư đến máy đích có cùng kiến trúc CPU. Trên máy đích:

```bash
docker load --input radio-calico-production.tar
docker compose --env-file .env.docker -f compose.prod.yaml up -d --no-build --pull never --wait
```

Không cần source, Python, pip, Node hoặc cài dependency trên máy đích. Nếu đổi `RADIO_CALICO_IMAGE`, thay hai tên image ứng dụng trong lệnh `docker save`. Archive không chứa volume; dữ liệu cũ cần chuyển bằng backup/restore riêng.

Mặc định chỉ publish loopback trên host. Có thể đặt trước Nginx một reverse proxy/TLS của hệ thống; `PROD_BIND=0.0.0.0` cho phép truy cập qua IP host khi bạn chủ động cấu hình mạng. Bộ cấu hình chưa tự cấp tên miền/chứng chỉ. Âm thanh, metadata, ảnh, HLS.js và font vẫn được trình duyệt tải từ các dịch vụ Internet hiện có.

## Kiểm tra tự động

```bash
python3 scripts/test_docker.py
```

Trên Windows dùng `python scripts/test_docker.py`. Script tạo project/volume/mật khẩu tạm, build Development và Production, kiểm tra HTTP/static, rating/CSRF, health, persistence của database và session sau khi tái tạo toàn bộ container. Production còn kiểm tra Nginx trả JSON cho body quá lớn, PostgreSQL mất kết nối trả 503 rồi phục hồi, và frontend phục vụ được khi backend dừng.

Development chạy toàn bộ test Python/Node; Production chạy lại suite rating trên PostgreSQL thật bằng các schema test có tên ngẫu nhiên. `TEST_DATABASE_URL` phải được đặt rõ ràng để chạy `tests/test_ratings_postgres.py`; nếu không, suite PostgreSQL được báo skip. Script chỉ xóa schema/project/volume/image tạm do nó tạo. Các test SQLite luôn ghi đè `DATABASE_URL` thành rỗng để không chạm database Production.

Workflow `.github/workflows/tests.yml` có job Docker riêng để chạy các kiểm tra này. Kiểm tra CI sau khi đẩy thay đổi; HTTP smoke test không xác minh playback thực tế trong trình duyệt.

Tham khảo: [Psycopg parameterized queries](https://www.psycopg.org/psycopg3/docs/basic/params.html), [Nginx proxy](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [PostgreSQL official image](https://hub.docker.com/_/postgres).
