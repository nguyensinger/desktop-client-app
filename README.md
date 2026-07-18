# IT Support Desktop Client

> **Lưu ý nếu bạn đang nâng cấp từ bản tên cũ "IT Support Agent"**: app đã được đổi tên
> thành "IT Support Desktop Client" để phân biệt rõ với "IT Support Agent Desktop App"
> (app mới dành cho nhân viên IT, khác hoàn toàn). Vì cấu hình lưu trữ theo tên app
> (`app.getPath('userData')`), config cũ (`deviceId`, `apiKey`...) tại
> `%APPDATA%\it-support-desktop-agent\config.json` sẽ KHÔNG tự chuyển sang vị trí mới
> `%APPDATA%\it-support-desktop-client\config.json`. Cần copy file `config.json` từ thư
> mục cũ sang thư mục mới (tạo thư mục mới trước nếu chưa có, bằng cách chạy app 1 lần),
> hoặc đăng ký lại từ đầu (app sẽ tự phục hồi `deviceId` nếu các trường khác đã đúng,
> theo cơ chế tự phục hồi đã có).

Ứng dụng Electron cài trên máy tính của khách hàng để:
- Khai báo thông tin máy tính (hostname, OS, CPU, RAM, MAC/IP) và người sử dụng
- Khai báo UltraViewer ID để IT support kết nối từ xa
- Tạo ticket yêu cầu support (chọn Online/Onsite)
- Chat với IT support theo ticket
- Tự động gửi heartbeat định kỳ để backend biết máy đang online

## Icon

File `assets/tray-icon.png` hiện là placeholder (hình vuông màu xanh rêu 32x32). Trước khi build
bản chính thức, thay bằng icon thật của công ty. Với `electron-builder`, cũng cần thêm
`assets/icon.ico` (Windows) và `assets/icon.icns` (macOS) cho icon ứng dụng đầy đủ — xem
[hướng dẫn icon của electron-builder](https://www.electron.build/icons).

## Cài đặt (môi trường phát triển)

```bash
npm install
npm start
```

## Build file cài đặt

```bash
# Windows (.exe installer)
npm run build:win

# macOS (.dmg)
npm run build:mac
```

File build nằm trong thư mục `dist/`.

## Cấu hình lần đầu

Khi mở app lần đầu (chưa có `deviceId` lưu trong config), app sẽ hiện màn hình **Thiết lập** yêu cầu:

| Trường | Ý nghĩa | Lấy ở đâu |
|---|---|---|
| Địa chỉ Odoo server | URL backend, ví dụ `https://erp.yourcompany.com` | IT quản trị cung cấp |
| API Key | Khóa xác thực API | Tạo tại Odoo: Settings > Technical > API Keys, gán cho user kỹ thuật (ví dụ `agent-bot`, scope `rpc`) |
| Mã khách hàng (Customer ID) | id của `res.partner` (khách hàng) trong Odoo | IT quản trị cung cấp, hoặc xem trên URL khi mở contact trong Odoo |
| UltraViewer ID | ID remote desktop của máy này | Mở app UltraViewer trên máy, copy ID |
| Tên / Email người dùng | Người đang sử dụng máy | Nhập tay |

Sau khi đăng ký thành công, thiết bị được lưu vào Odoo (`it.customer.device`) và app chuyển sang
chế độ chạy nền (system tray), tự động gửi heartbeat mỗi 2 phút.

## Cấu trúc thư mục

```
src/
  main.js          # Main process: tray icon, window, heartbeat scheduler, IPC handlers
  preload.js        # contextBridge - cầu nối an toàn renderer <-> main
  config.js          # Lưu config cục bộ vào file JSON (không dùng electron-store vì ESM-only)
  api.js              # Gọi REST API của module Odoo it_support_management
  deviceInfo.js        # Thu thập thông tin phần cứng (systeminformation, node-machine-id)
  renderer/
    index.html
    style.css
    renderer.js     # Logic UI, chỉ gọi qua window.itSupportAgent (preload bridge)
```

## Bảo mật

- `contextIsolation: true`, `nodeIntegration: false` — renderer không có quyền Node.js trực tiếp.
- Toàn bộ giao tiếp Node.js đi qua `contextBridge` trong `preload.js`.
- API key lưu trong file config cục bộ (`app.getPath('userData')/config.json`) — không mã hóa.
  Với yêu cầu bảo mật cao hơn, có thể thay bằng `safeStorage` API của Electron (mã hóa theo OS keychain)
  trước khi ghi xuống đĩa.
- CSP cơ bản (`default-src 'self'`) được set trong `index.html` để giảm rủi ro nếu nội dung chat
  từ server chứa mã độc.

## Realtime chat

Khi mở tab Chat và tải tin nhắn của 1 ticket, app tự động subscribe vào channel realtime
của ticket đó (`/api/v1/ticket/<id>/realtime_channel`) và bắt đầu vòng lặp long-polling
nền trong main process (`/api/v1/poll`, dựa trên `bus.bus._poll()` của Odoo). Khi có tin
nhắn mới hoặc ticket đổi trạng thái, main process nhận event và tự động tải lại danh sách
tin nhắn trong renderer — không cần bấm "Tải" lại bằng tay.

Vòng lặp polling dừng khi chuyển sang tab khác, và một ticket cũ sẽ được hủy subscribe khi
mở chat cho ticket khác (chỉ giữ 1 polling loop hoạt động tại một thời điểm để tránh tốn
tài nguyên không cần thiết).
