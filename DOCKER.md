# Chạy Radio Calico bằng Docker

Máy chủ chỉ cần Docker Engine/Desktop với Linux containers, Docker Compose và Buildx. Python, Flask, SQLite, Node dành cho test và Gunicorn được cài trong image; không cần cài chúng trên máy chủ. Lần build đầu cần Internet để tải base image và dependency. Khi đã có image, có thể chuyển sang máy khác bằng `docker save`/`docker load`.

Chạy các lệnh dưới đây tại thư mục dự án. Hai file Compose độc lập, không cần ghép chúng với nhau.

| | Development | Production |
| --- | --- | --- |
| Lệnh | `docker compose -f compose.dev.yaml up --build` | `docker compose -f compose.prod.yaml up --build -d --wait` |
| Image | `radio-calico:development` | `radio-calico:production` |
| Server | Flask debug/reload, tắt interactive debugger | Gunicorn 26.2.0, 1 worker/4 threads, không bật debug/reload |
| Mã nguồn | Bind mount repository chỉ đọc; sửa trên host | Mã và static assets đóng trong image; không bind mount source |
| Database | Volume `radio-calico-dev_ratings-data` | Volume `radio-calico-prod_ratings-data` |
| Test | Python 3.11 và Node 22 có sẵn | Image runtime, không chứa Node hay bộ test |
| Quyền | UID/GID `10001:10001` | UID/GID `10001:10001`, root filesystem chỉ đọc, `/tmp` là tmpfs |

Cả hai mặc định phục vụ tại **http://127.0.0.1:3000**, có health check HTTP truy vấn SQLite, và ghi log ra stdout/stderr. Cổng trong container cố định là `3000`. Để chạy đồng thời hai môi trường, đổi một trong hai cổng trên host như hướng dẫn dưới đây.

## Development

```bash
docker compose -f compose.dev.yaml up --build
```

Chỉnh Python trên host sẽ kích hoạt reload; thay HTML/CSS/JavaScript rồi refresh trình duyệt. Source mount chỉ đọc để container không sửa file host. Khi đổi dependency hoặc Dockerfile, build lại image. Dừng bằng Ctrl+C hoặc:

```bash
docker compose -f compose.dev.yaml down
```

Chạy toàn bộ test và riêng rating trong container:

```bash
docker compose -f compose.dev.yaml run --rm --no-deps app python scripts/test.py
docker compose -f compose.dev.yaml run --rm --no-deps app python scripts/test.py --ratings
```

Các lệnh test dùng database tạm, không ghi vào dữ liệu đánh giá đang chạy. Có thể kiểm tra image Development hoàn toàn không dùng source trên host:

```bash
docker build --target development -t radio-calico:development .
docker run --rm --network none radio-calico:development python scripts/test.py
```

## Production

```bash
docker compose -f compose.prod.yaml up --build -d --wait
docker compose -f compose.prod.yaml ps
docker compose -f compose.prod.yaml logs -f app
```

Image Production cài thêm dependency đã ghim trong `requirements-production.txt`. Gunicorn là tiến trình server; 1 worker/4 threads phù hợp với SQLite trên một host và tránh khởi tạo ứng dụng đồng thời ở nhiều worker. `restart: unless-stopped` khởi động lại khi tiến trình thoát. Thời gian dừng cho phép Gunicorn hoàn tất các request đang xử lý. Log Docker được xoay theo giới hạn 10 MB/file, tối đa 3 file.

Để cập nhật mã nguồn:

```bash
docker compose -f compose.prod.yaml up --build -d --wait
```

Để dừng và bỏ container, giữ nguyên database:

```bash
docker compose -f compose.prod.yaml down
```

## Cấu hình và dữ liệu

Không bắt buộc tạo file môi trường. Nếu cần đổi cổng hoặc tên image, sao chép `.env.docker.example` thành `.env.docker` và sửa các giá trị:

```dotenv
DEV_PORT=3000
PROD_PORT=3001
PROD_BIND=127.0.0.1
RADIO_CALICO_IMAGE=radio-calico
```

Sau đó dùng cùng file môi trường cho các lệnh quản lý:

```bash
docker compose --env-file .env.docker -f compose.prod.yaml up --build -d --wait
docker compose --env-file .env.docker -f compose.prod.yaml ps
```

File `.env` dùng cho cách chạy Flask cục bộ không được đóng vào image. Compose luôn truyền `PORT=3000` và `DATABASE_PATH=/data/radiocalico.sqlite` bên trong container. `.dockerignore` loại môi trường ảo, Git metadata, cấu hình bí mật, database và log khỏi build context. Dockerfile chỉ chép các file cần cho mỗi môi trường.

Named volume được tạo với quyền ghi cho UID `10001` ngay lần đầu. Development và Production có project name/volume riêng. Phiếu đánh giá và bí mật ký cookie cùng được lưu trong SQLite, nên cả dữ liệu lẫn định danh người nghe vẫn tồn tại sau khi thay container. Database cục bộ trong thư mục `data/` trên host không tự chuyển vào Docker; lần chạy đầu với volume mới tạo database mới.

`docker compose down` giữ volume. Không dùng `down --volumes` hoặc xóa volume nếu cần giữ dữ liệu. Không chạy nhiều replica của ứng dụng trên nhiều host với volume SQLite này. Build image mới không cập nhật schema theo cơ chế migration ngoài những lệnh khởi tạo hiện có của ứng dụng.

Mặc định Production chỉ publish cổng loopback trên host. Có thể đặt phía sau reverse proxy/TLS của hệ thống. Nếu cần truy cập trực tiếp qua IP host, cấu hình `PROD_BIND=0.0.0.0`; thực hiện cấu hình mạng/TLS phù hợp trước khi công khai dịch vụ. Bộ cấu hình này không tự cấp tên miền, chứng chỉ hay triển khai ra Internet. Luồng âm thanh, album art, metadata, HLS.js và font vẫn lấy từ các dịch vụ Internet hiện có trên trình duyệt.

## Chuyển image đến máy chủ không có môi trường Python

Build và xuất Production trên máy build:

```bash
docker build --target production -t radio-calico:production .
docker save --output radio-calico-production.tar radio-calico:production
```

Chuyển `radio-calico-production.tar`, `compose.prod.yaml` và file `.env.docker` tùy chọn sang máy đích. Máy đích cần cùng kiến trúc CPU với image đã build, ví dụ Linux amd64. Trên máy đích:

```bash
docker load --input radio-calico-production.tar
docker compose -f compose.prod.yaml up -d --no-build --pull never --wait
```

Không cần chuyển source, Python, pip, Node hoặc chạy cài dependency trên máy đích. Nếu có `.env.docker`, thêm `--env-file .env.docker` như hướng dẫn cấu hình. Archive chỉ chứa image; database/volume phải được sao lưu và chuyển riêng nếu cần giữ dữ liệu cũ.

## Sao lưu SQLite

Dùng SQLite backup API để tạo snapshot nhất quán khi ứng dụng đang chạy, kể cả khi WAL đang hoạt động:

```bash
docker compose -f compose.prod.yaml exec -T app python -c "import sqlite3; source = sqlite3.connect('/data/radiocalico.sqlite'); target = sqlite3.connect('/data/backup.sqlite'); source.backup(target); target.close(); source.close()"
docker compose -f compose.prod.yaml cp app:/data/backup.sqlite ./radiocalico-backup.sqlite
```

File backup chứa dữ liệu đánh giá và bí mật ký cookie, cần lưu ở nơi riêng tư. Trước khi khôi phục hoặc thay volume đang có dữ liệu, dừng ứng dụng và giữ một bản backup hiện tại. Với bind mount dữ liệu tự cấu hình thay cho named volume, thư mục phải cho UID/GID `10001:10001` ghi.

## Kiểm tra Docker tự động

Nếu máy phát triển/CI có Python 3 và Docker, chạy:

```bash
python3 scripts/test_docker.py
```

Trên Windows dùng `python scripts/test_docker.py`. Script build cả hai image, tạo các project/volume có tên ngẫu nhiên, kiểm tra health, HTTP/static assets, user không phải root, rating, CSRF, giữ database và cookie sau khi tái tạo container. Với Development, script còn chạy toàn bộ test backend/frontend trong container. Production được kiểm tra root filesystem chỉ đọc và không có bind mount source. Script chỉ dọn container/volume/image tạm do chính nó tạo.

Workflow `.github/workflows/tests.yml` có job Docker riêng trên Ubuntu để thực hiện kiểm tra này. Cần kiểm tra kết quả CI sau khi đẩy thay đổi lên GitHub. Việc chạy Docker/HTTP smoke test không xác minh phát âm thanh thực tế qua trình duyệt.

Tham khảo: [Docker Compose cho Production](https://docs.docker.com/compose/how-tos/production/) và [cấu hình Gunicorn](https://gunicorn.org/reference/settings/).
