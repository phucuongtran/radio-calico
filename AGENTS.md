# Repository Guidelines

## Đọc ngữ cảnh trước khi làm

- Đọc [PROJECT.md](PROJECT.md) để hiểu mục tiêu và phạm vi; [ARCHITECTURE.md](ARCHITECTURE.md) để hiểu kỹ thuật và API.
- Xem [README.md](README.md) hoặc [README.vi.md](README.vi.md) cho hướng dẫn chạy.
- Kiểm tra mã nguồn, cấu hình và thay đổi hiện có trước khi sửa. Giữ nguyên công việc của người dùng ngoài phạm vi yêu cầu.

## Hỏi khi chưa rõ

- Phải hỏi lại khi chưa rõ mục tiêu, hành vi mong muốn, tiêu chí hoàn thành hoặc có nhiều cách hiểu dẫn đến kết quả khác nhau.
- Nêu điểm chưa rõ và lựa chọn cụ thể; chỉ tiếp tục phần việc không phụ thuộc câu trả lời.
- Với chi tiết triển khai nhỏ, dễ hoàn tác và phù hợp quy ước hiện có, chủ động xử lý rồi nêu giả định.
- Xin xác nhận trước khi xóa dữ liệu, đổi schema làm mất dữ liệu, triển khai công khai hoặc thêm dịch vụ trả phí, trừ khi đã được cho phép rõ ràng.

## Thực hiện thay đổi

- Sửa đúng phạm vi; tránh refactor hoặc thêm dependency không cần thiết.
- Python dùng 4 dấu cách, `snake_case`; JavaScript, HTML, CSS dùng 2 dấu cách; JavaScript dùng `camelCase`, hằng số dùng chữ hoa.
- JavaScript dùng ES modules qua `static/main.js`; test gọi hàm `init*` với môi trường mô phỏng. Khi thêm stylesheet, giữ thứ tự import trong `static/style.css` để bảo toàn cascade.
- Giữ SQL có tham số, cookie có chữ ký, CSRF và khả năng dùng bàn phím. Không đưa bí mật, database hoặc log vào mã nguồn.
- Cập nhật tài liệu tương ứng khi đổi tính năng, API hoặc cách vận hành.

## Kiểm chứng và bàn giao

- Backend: chạy `.\.venv\Scripts\python.exe -m unittest discover -v`; test dùng database tạm.
- Controller: chạy `node --test test/player.test.cjs test/metadata.test.cjs test/ratings.test.cjs test/ratings-api.test.cjs`.
- Runner chung: chạy `.\.venv\Scripts\python.exe scripts/test.py` trên Windows hoặc `.venv/bin/python scripts/test.py` trên Linux/WSL. Dùng `--ratings` để chạy riêng rating, thêm `--backend`/`--frontend` để chọn một phía. Xem phần Verify trong README để dùng helper và bổ sung test.
- Thêm test hồi quy cho thay đổi có rủi ro; kiểm tra phát âm thanh thực tế khi sửa player.
- Khi sửa Docker: kiểm tra `docker compose -f compose.dev.yaml config --quiet`, với Production dùng `docker compose --env-file .env.docker -f compose.prod.yaml config --quiet` (cần `POSTGRES_PASSWORD`), rồi chạy `python3 scripts/test_docker.py` nếu có Docker daemon. Script chỉ dọn project/volume tạm của test; không xóa volume dữ liệu người dùng. Xem [DOCKER.md](DOCKER.md).
- Nếu chỉ sửa tài liệu, kiểm tra nội dung, đường dẫn và lệnh; không bắt buộc chạy test ứng dụng.
- Báo cáo thay đổi, kiểm tra đã chạy, kết quả và phần chưa xác minh. Không khẳng định test đạt nếu chưa chạy.

## Sau khi hoàn thành hết các bước trên

- Hãy cập nhật các file .md tương ứng.
