// i18n.js
// Module đa ngôn ngữ đơn giản cho renderer process. Không dùng thư viện ngoài vì nhu
// cầu chỉ là thay text tĩnh theo key.
//
// QUAN TRỌNG: không dùng fetch() để load file JSON dịch trực tiếp trong renderer, vì
// trang load qua file:// protocol (BrowserWindow.loadFile) có thể gặp vấn đề CORS/CSP
// không nhất quán giữa các phiên bản Electron/Chromium. Thay vào đó, main process đọc
// file JSON bằng Node fs (đã có sẵn quyền, không qua renderer) và trả qua IPC - đây
// cũng nhất quán với kiến trúc hiện tại (mọi logic nhạy cảm đều qua main process).

const SUPPORTED_LANGUAGES = ['en', 'vi', 'fr'];
const DEFAULT_LANGUAGE = 'en';

let translations = {};
let currentLang = DEFAULT_LANGUAGE;

async function loadLanguage(lang) {
  const safeLang = SUPPORTED_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
  translations = await window.itSupportAgent.loadTranslations(safeLang);
  currentLang = safeLang;
}

/**
 * Lấy chuỗi đã dịch theo key. Hỗ trợ placeholder dạng {name} thay bằng params.name.
 * Nếu thiếu key (lỗi đồng bộ file dịch), trả về chính key đó để dễ nhận ra lỗi khi
 * test, thay vì làm crash UI.
 */
function t(key, params) {
  let text = translations[key] !== undefined ? translations[key] : key;
  if (params) {
    Object.keys(params).forEach((p) => {
      text = text.replace(`{${p}}`, params[p]);
    });
  }
  return text;
}

/**
 * Áp dụng bản dịch vào toàn bộ DOM hiện có, dựa trên các attribute:
 * - data-i18n="key"            -> textContent
 * - data-i18n-placeholder="key" -> attribute placeholder
 * - data-i18n-title="key"        -> attribute title (tooltip)
 * - data-i18n-html="key"        -> innerHTML (chỉ dùng khi key không chứa input từ user)
 */
function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  document.documentElement.lang = currentLang;
}

async function setLanguage(lang) {
  await loadLanguage(lang);
  applyTranslations();
}

function getCurrentLanguage() {
  return currentLang;
}

// Renderer process load qua <script> tag thuần (nodeIntegration: false), không có
// require/module.exports - gán trực tiếp vào window để renderer.js dùng được.
window.i18n = { loadLanguage, applyTranslations, setLanguage, getCurrentLanguage, t, SUPPORTED_LANGUAGES };
