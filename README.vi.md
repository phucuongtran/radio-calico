# Hướng dẫn phát triển Radio Calico với Flask và SQLite

Dự án sử dụng **Flask 3.1.3**, **Python 3.11** và mô-đun **sqlite3** có sẵn trong Python để xây dựng và thử nghiệm website trên máy tính cá nhân.

Địa chỉ website khi máy chủ đang chạy: **http://127.0.0.1:3000**. Máy chủ chỉ nhận kết nối trên máy tính này. Dữ liệu SQLite từ cấu hình trước đã được giữ nguyên. Node.js chỉ cần để chạy test JavaScript; npm là tùy chọn và không cần cài package npm.

## 1. Mở thư mục dự án

Mở PowerShell và chạy:

```powershell
Set-Location E:\radiocalico
```

Các lệnh tiếp theo được thực hiện trong thư mục này. Dùng trực tiếp `.venv\Scripts\python.exe` giúp bạn chạy đúng môi trường Python của dự án mà không cần kích hoạt môi trường ảo.

## 2. Chạy máy chủ khi phát triển

Nếu máy chủ đang chạy nền, hãy dừng trước để tránh trùng cổng:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/background.ps1 stop
```

Chạy Flask với chế độ phát triển:

```powershell
.\.venv\Scripts\python.exe app.py --debug
```

Mở **http://127.0.0.1:3000** trong trình duyệt. Chế độ này tự tải lại máy chủ khi mã Python thay đổi và bật trình gỡ lỗi Flask trên máy cá nhân. Nhấn **Ctrl+C** trong cửa sổ đang chạy máy chủ để dừng.

Nếu muốn chạy trong cửa sổ hiện tại mà không bật chế độ gỡ lỗi:

```powershell
.\.venv\Scripts\python.exe app.py
```

Sau khi sửa CSS hoặc JavaScript phía trình duyệt, hãy tải lại trang để xem thay đổi.

## 3. Chạy nền và dừng máy chủ

Khởi động máy chủ chạy nền, không bật chế độ gỡ lỗi:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/background.ps1 start
```

Dừng máy chủ chạy nền:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/background.ps1 stop
```

Script ghi nhận đúng tiến trình Python chạy Flask, đồng thời kiểm tra tên và thời điểm tạo tiến trình trước khi dừng. Cách này cũng xử lý trường hợp Windows sử dụng tiến trình trung gian để mở Python trong môi trường ảo.

Nhật ký được lưu tại:

- `logs/server.log`: đầu ra thông thường.
- `logs/server-error.log`: thông báo của Flask và lỗi nếu có.

Dữ liệu SQLite được giữ lại sau khi dừng. Máy chủ không tự khởi động cùng Windows. Chỉ chạy một máy chủ trên cùng một cổng tại một thời điểm.

## 4. Môi trường Python và thư viện

Môi trường `.venv` đã được chuẩn bị sẵn trong dự án. Do kết nối tải thư viện từ PyPI bị chặn, Flask và các thư viện phụ thuộc đã được sao chép từ môi trường Python có sẵn tại `E:\conda_env\mlflow-env\Lib\site-packages` vào môi trường ảo riêng của dự án. Môi trường nguồn không bị chỉnh sửa.

Môi trường ảo hiện sử dụng bản Python tại `E:\conda_env\mlflow-env`; cần giữ bản Python này để tiếp tục chạy `.venv`.

Khi thiết lập trên máy khác có Python 3.11 trở lên và truy cập được kho thư viện:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

File `requirements.txt` ghi rõ phiên bản các thư viện. SQLite đã đi kèm Python nên không cần cài máy chủ cơ sở dữ liệu riêng.

## 5. Cấu hình

File `.env` hỗ trợ các dòng cấu hình đơn giản theo dạng `KEY=value`:

```dotenv
PORT=3000
DATABASE_PATH=./data/radiocalico.sqlite
```

- `PORT`: cổng của máy chủ web.
- `DATABASE_PATH`: đường dẫn cơ sở dữ liệu; đường dẫn tương đối được tính từ thư mục dự án.

Nếu biến môi trường cùng tên đã được đặt trong tiến trình, giá trị đó được ưu tiên hơn `.env`. Hãy khởi động lại máy chủ sau khi thay đổi file này.

Nếu thiếu `.env`, tạo từ file mẫu:

```powershell
Copy-Item .env.example .env
```

## 6. Cấu trúc dự án

| Đường dẫn | Chức năng |
| --- | --- |
| `app.py` | Tạo ứng dụng Flask, khai báo tuyến API, chạy máy chủ và lệnh SQL. |
| `database.py` | Quản lý kết nối SQLite và tạo cấu trúc bảng ban đầu. |
| `diagnostics.py` | Kiểm tra sự kiện và lọc trường diagnostics trước khi ghi log. |
| `ratings.py` | API đánh giá, định danh người nghe và CSRF. |
| `config.py` | Đọc cấu hình từ `.env` và biến môi trường. |
| `templates/index.html` | Mẫu HTML Jinja cho trang chủ. |
| `static/main.js` | Entry ES module khởi tạo ba controller. |
| `static/player/` | Helper tải HLS, thời gian nghe và diagnostics. |
| `static/style.css`, `static/styles/` | Entry CSS và stylesheet theo thành phần. |
| `data/radiocalico.sqlite` | File SQLite lưu dữ liệu lâu dài. |
| `requirements.txt` | Danh sách thư viện và phiên bản. |
| `package.json` | Khai báo ES modules và lệnh test Node, không có dependency npm. |
| `scripts/background.ps1` | Quản lý máy chủ chạy nền. |
| `tests/test_app.py` | Kiểm thử tích hợp Flask và SQLite. |

Flask hiển thị trang chủ từ mẫu HTML và phục vụ tài nguyên công khai trong `static/`. Các file Python, cấu hình và cơ sở dữ liệu không được cung cấp như file tĩnh.

Frontend dùng ES modules thuần, không cần bundler hoặc build. `static/main.js` khởi tạo player, ratings rồi metadata. `static/player/` chứa helper HLS, thời gian nghe và diagnostics; `metadata-data.js` chuẩn hóa feed; `ratings-api.js` quản lý HTTP, timeout và hủy request đánh giá. `style.css` import các stylesheet trong `static/styles/` theo đúng thứ tự cascade ban đầu. Backend lọc diagnostics bằng `diagnostics.py`. Cây thư mục đầy đủ ở [ARCHITECTURE.md](ARCHITECTURE.md).

Môi trường ảo, cơ sở dữ liệu, nhật ký và `.env` được loại khỏi Git qua `.gitignore`.

## 7. Sử dụng SQLite

SQLite chạy ngay trong ứng dụng Python, không cần dịch vụ, cổng hoặc tài khoản riêng. Dữ liệu tồn tại sau khi máy chủ khởi động lại.

Ứng dụng mở kết nối theo ngữ cảnh Flask và tự đóng khi ngữ cảnh kết thúc. Mỗi kết nối bật kiểm tra khóa ngoại và chờ tối đa 5 giây khi cơ sở dữ liệu bị khóa. Cơ sở dữ liệu sử dụng chế độ ghi nhật ký WAL.

Liệt kê các bảng:

```powershell
.\.venv\Scripts\python.exe app.py db
```

Xem dữ liệu bảng ban đầu:

```powershell
.\.venv\Scripts\python.exe app.py db "SELECT * FROM app_metadata"
```

Bảng `app_metadata` lưu thời điểm tạo cơ sở dữ liệu. Công cụ nhận một câu lệnh SQL mỗi lần gọi, hỗ trợ cả ghi dữ liệu và xác nhận lưu thay đổi.

Khi phát triển website, thêm bảng trong `database.py` và tuyến xử lý trong `app.py`. Với dữ liệu người dùng nhập, sử dụng câu lệnh SQL có tham số; có thể xem ví dụ trong `tests/test_app.py`.

Để sao lưu, dừng máy chủ rồi sao chép toàn bộ thư mục `data/`, bao gồm các file phụ của SQLite nếu có.

## 8. Kiểm tra hoạt động

Chạy kiểm thử:

```powershell
.\.venv\Scripts\python.exe scripts/test.py
.\.venv\Scripts\python.exe scripts/test.py --ratings
```

Lệnh đầu chạy cả backend và frontend; `--ratings` chỉ chạy phần đánh giá. Python cần có dependency trong `requirements.txt`, và `node` cần có trong PATH. Dùng thêm `--backend` hoặc `--frontend` để chọn một phía. Trên Linux/WSL, thay `.\.venv\Scripts\python.exe` bằng `.venv/bin/python`. Runner báo kết quả từng phía, vẫn chạy frontend khi backend lỗi và trả mã lỗi nếu có bộ test thất bại hoặc thiếu Node.

Backend có unit test chuẩn hóa bài hát/session trong `tests/test_ratings_unit.py` và integration test API/SQLite trong `tests/test_ratings.py`; fixture dùng chung nằm ở `tests/support.py`. Frontend kiểm tra riêng HTTP client trong `test/ratings-api.test.cjs` và controller trong `test/ratings.test.cjs`, dùng DOM, fetch và timer mô phỏng từ `test/helpers/ratings.cjs`. Các ca lỗi bao gồm cookie/CSRF sai, payload quá lớn, lỗi database, response sai định dạng, timeout, đổi bài khi request chưa xong và xác nhận lại phiếu khi mất response POST. Test dùng dữ liệu tạm và không gọi dịch vụ radio thật.

GitHub Actions tại `.github/workflows/tests.yml` chạy toàn bộ test khi push hoặc tạo/cập nhật pull request, trên Ubuntu/Windows với Python 3.11/3.12 và Node 22. Chi tiết cấu trúc và cách bổ sung test xem [README.md](README.md#verify). Kết quả CI cần được xác minh sau khi đẩy workflow lên GitHub.

Các kiểm thử dùng cơ sở dữ liệu tạm để kiểm tra trang web, tài nguyên tĩnh, kết nối và lỗi cơ sở dữ liệu, lưu dữ liệu qua lần khởi tạo ứng dụng mới, cấu hình SQLite và việc ngăn truy cập file riêng tư.

Để chỉ chạy backend trực tiếp: `.\.venv\Scripts\python.exe -m unittest discover -v`.

Chạy test controller JavaScript bằng Node.js, không cần `npm install`:

```powershell
& 'C:\Program Files\nodejs\node.exe' --test test/player.test.cjs test/metadata.test.cjs test/ratings.test.cjs test/ratings-api.test.cjs
```

Nếu Node.js và npm có trong PATH, có thể dùng `npm test` hoặc `npm run test:ratings` cho riêng đánh giá. Các controller nhận môi trường mô phỏng trực tiếp qua hàm khởi tạo; test không gọi stream thật. Khi sửa player, kiểm tra thêm playback bằng trình duyệt có Internet để xác minh CDN, CORS và codec.

Kiểm tra các thư viện phụ thuộc:

```powershell
.\.venv\Scripts\python.exe -m pip check
```

Khi máy chủ đang chạy, kiểm tra API trạng thái:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

Kết quả bình thường:

```json
{
  "status": "ok",
  "database": "connected",
  "engine": "sqlite"
}
```

API thực hiện truy vấn SQLite để xác nhận kết nối. Nếu xảy ra lỗi truy vấn, API trả mã HTTP 503.

## 9. Xử lý sự cố

- **Cổng 3000 đã được sử dụng:** dừng máy chủ cũ hoặc đổi `PORT` trong `.env`, sau đó khởi động lại và truy cập cổng mới.
- **Không mở được trang:** kiểm tra máy chủ đã chạy và xem các file trong `logs/` nếu sử dụng chế độ chạy nền.
- **Thiếu thư viện Flask:** dùng đúng `.venv\Scripts\python.exe`; nếu vừa tạo lại môi trường, cài `requirements.txt` khi có kết nối kho thư viện.
- **Thiếu Python gốc:** nếu bản Python tại `E:\conda_env\mlflow-env` đã bị xóa hoặc di chuyển, tạo lại môi trường ảo từ bản Python khác rồi cài lại thư viện.
- **Sửa giao diện nhưng chưa thấy thay đổi:** tải lại trang trong trình duyệt.

Môi trường này dùng để phát triển và thử nghiệm website trên máy cá nhân.
