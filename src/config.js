// config.js
// Lưu trữ config đơn giản bằng file JSON trong thư mục userData của app.
// Không dùng electron-store vì từ v9 trở lên là pure ESM, không tương thích
// với main process CommonJS truyền thống -> tự viết để tránh rủi ro.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

const DEFAULTS = {
  odooBaseUrl: '',       // ví dụ: https://erp.yourcompany.com
  apiKey: '',             // API key đã tạo trong Odoo (Settings > Technical > API Keys)
  customerId: null,       // id res.partner của khách hàng (cấu hình khi setup lần đầu)
  deviceId: null,         // id it.customer.device - tự động lưu sau khi đăng ký lần đầu
  ultraviewId: '',
  endUserName: '',
  endUserEmail: '',
  heartbeatIntervalMs: 120000, // 2 phút
  language: 'en',         // 'en' | 'vi' | 'fr' - lựa chọn ngôn ngữ giao diện, mặc định tiếng Anh
  autoStart: true,         // tự động khởi động cùng Windows
};

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (err) {
    return { ...DEFAULTS };
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

function getConfig() {
  return readConfig();
}

function setConfig(partialConfig) {
  const current = readConfig();
  const updated = { ...current, ...partialConfig };
  writeConfig(updated);
  return updated;
}

function isConfigured() {
  const c = readConfig();
  return Boolean(c.odooBaseUrl && c.apiKey && c.customerId && c.deviceId);
}

function hasServerCredentials() {
  // Đã có đủ thông tin để gọi API (server, key, customer) nhưng có thể còn thiếu deviceId
  // - dùng để tự động thử đăng ký lại thiết bị mà không cần hỏi lại toàn bộ form Setup.
  const c = readConfig();
  return Boolean(c.odooBaseUrl && c.apiKey && c.customerId);
}

module.exports = { getConfig, setConfig, isConfigured, hasServerCredentials, CONFIG_FILE };
