# Radio Calico — Tổng quan dự án

## Mục tiêu

Radio Calico là website nghe radio trực tuyến, hiển thị bài hát đang phát và cho phép người nghe đánh giá bài hát. Ứng dụng hiện chạy cục bộ bằng Flask và SQLite tại `http://127.0.0.1:3000` theo cấu hình mặc định.

## Tính năng chính

- **Nghe trực tiếp:** phát/tạm dừng luồng HLS, điều chỉnh âm lượng, hiển thị thời gian thực sự đã nghe. Chỉ phát sau thao tác của người dùng; tiếp tục nghe sẽ kết nối lại chương trình trực tiếp.
- **Thông tin bài hát:** tên bài, nghệ sĩ, ảnh album và tối đa năm bài vừa phát theo thứ tự mới đến cũ. Metadata cập nhật độc lập với trạng thái phát nhạc.
- **Đánh giá:** thích/không thích bài hát và tổng phiếu của người nghe dùng chung server. Có thể đổi lựa chọn; gửi lại cùng lựa chọn không tăng số phiếu.
- **Xử lý lỗi:** thông báo khi metadata, ảnh, đánh giá hoặc âm thanh gặp lỗi; có cơ chế thử lại phù hợp từng phần.
- **Giao diện:** responsive, sử dụng nhận diện Radio Calico, hỗ trợ bàn phím, thông báo trạng thái và reduced motion.

## Phạm vi và giới hạn

- Âm thanh, metadata và ảnh album lấy từ dịch vụ bên ngoài; Flask không chuyển mã hoặc chuyển tiếp âm thanh.
- SQLite lưu đánh giá và thông tin nội bộ; dữ liệu vẫn còn sau khi khởi động lại ứng dụng.
- Không có đăng nhập. Định danh dựa trên cookie trình duyệt; xóa cookie hoặc đổi thiết bị tạo định danh mới. Chưa bảo đảm một phiếu cho mỗi người trên mọi thiết bị.
- Khả năng phát lossless phụ thuộc trình duyệt, thiết bị, codec và dịch vụ stream. Test mô phỏng không bảo đảm phát thực tế.
- Cách chạy hiện tại là môi trường phát triển cục bộ, bind `127.0.0.1`; chưa có quy trình triển khai production được mô tả trong repository.

## Bản đồ tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| [PROJECT.md](PROJECT.md) | Mục tiêu, tính năng, phạm vi sản phẩm. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Tech stack, module, luồng dữ liệu, API và database. |
| [AGENTS.md](AGENTS.md) | Cách làm việc, khi cần hỏi lại, kiểm chứng và bàn giao. |
| [README.md](README.md), [README.vi.md](README.vi.md) | Cài đặt, chạy, kiểm tra và vận hành cục bộ. |
| [Hướng dẫn thương hiệu](RadioCalicoStyle/RadioCalico_Style_Guide.txt) | Logo, màu sắc, typography và giao diện. |

## Bắt đầu nhanh

Chạy trong PowerShell tại thư mục gốc sau khi tạo `.venv` và cài `requirements.txt` theo README:

```powershell
.\.venv\Scripts\python.exe app.py --debug
```

Mở `http://127.0.0.1:3000`. Dừng server nền do `scripts/background.ps1` quản lý trước khi chạy để tránh trùng cổng. Chi tiết cấu hình xem [ARCHITECTURE.md](ARCHITECTURE.md).
