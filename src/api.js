// api.js
// Client gọi REST API của module it_support_management trên Odoo.
// Toàn bộ endpoint dùng type='json' (JSON-RPC style nội bộ của Odoo controller),
// nên ta POST trực tiếp payload params, không cần bọc theo chuẩn JSON-RPC 2.0 đầy đủ
// vì Odoo tự xử lý phần đó ở tầng http.route(type='json').

const axios = require('axios');
const { getConfig } = require('./config');

function client() {
  const { odooBaseUrl, apiKey } = getConfig();
  if (!odooBaseUrl || !apiKey) {
    throw new Error('Chưa cấu hình odooBaseUrl hoặc apiKey. Vào Cài đặt để thiết lập.');
  }
  return axios.create({
    baseURL: odooBaseUrl.replace(/\/+$/, ''),
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Odoo controller type='json' nhận body dạng JSON-RPC 2.0:
 * { jsonrpc: "2.0", method: "call", params: {...} }
 * và trả về { jsonrpc: "2.0", result: {...} } hoặc { error: {...} }
 */
async function callApi(path, params = {}) {
  const http = client();
  const response = await http.post(path, {
    jsonrpc: '2.0',
    method: 'call',
    params,
  });
  const data = response.data;

  // Lỗi JSON-RPC chuẩn của Odoo (exception ném ra từ code, ví dụ UserError, lỗi server 500) ->
  // nằm ở top-level data.error, là 1 object có .message/.data.message
  if (data.error) {
    const msg = data.error.data?.message || data.error.message || 'Lỗi không xác định từ server';
    throw new Error(msg);
  }

  const result = data.result;

  // Lỗi nghiệp vụ tự định nghĩa trong controller (ví dụ "Thiếu customer_id", "Ticket không tồn tại")
  // -> nằm trong data.result.error, là string thuần (xem _json_error trong controller Odoo)
  if (result && typeof result === 'object' && !Array.isArray(result) && result.error) {
    throw new Error(result.error);
  }

  return result;
}

async function registerDevice(payload) {
  return callApi('/api/v1/device/register', payload);
}

async function heartbeat(deviceId, payload = {}) {
  return callApi(`/api/v1/device/${deviceId}/heartbeat`, payload);
}

async function createTicket(payload) {
  return callApi('/api/v1/ticket/create', payload);
}

async function getDeviceTickets(deviceId) {
  return callApi(`/api/v1/device/${deviceId}/tickets`, {});
}

async function postMessage(ticketId, body) {
  return callApi(`/api/v1/ticket/${ticketId}/message`, { body, from_customer: true });
}

async function getMessages(ticketId) {
  return callApi(`/api/v1/ticket/${ticketId}/messages`, {});
}

async function getRealtimeChannel(ticketId) {
  return callApi(`/api/v1/ticket/${ticketId}/realtime_channel`, {});
}

async function poll(channels, last = 0) {
  // Long-polling: request này có thể treo lại trên server vài chục giây
  // chờ có event mới, nên đặt timeout dài hơn các API khác.
  const { odooBaseUrl, apiKey } = getConfig();
  const http = axios.create({
    baseURL: odooBaseUrl.replace(/\/+$/, ''),
    timeout: 65000,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  const response = await http.post('/api/v1/poll', {
    jsonrpc: '2.0',
    method: 'call',
    params: { channels, last },
  });
  const data = response.data;
  if (data.error) {
    throw new Error(data.error.data?.message || data.error.message || 'Lỗi không xác định từ server');
  }
  const result = data.result;
  if (result && typeof result === 'object' && !Array.isArray(result) && result.error) {
    throw new Error(result.error);
  }
  return result;
}

async function verifyManager(apiKey) {
  // Dùng để mở khoá "Edit Settings" - gọi whoami bằng API key NGƯỜI ADMIN vừa nhập
  // (không phải apiKey đang lưu của thiết bị), chỉ để kiểm tra quyền, không lưu lại.
  const { odooBaseUrl } = getConfig();
  if (!odooBaseUrl) {
    throw new Error('Chưa cấu hình odooBaseUrl.');
  }
  const http = axios.create({
    baseURL: odooBaseUrl.replace(/\/+$/, ''),
    timeout: 15000,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  const response = await http.post('/api/v1/whoami', {
    jsonrpc: '2.0',
    method: 'call',
    params: {},
  });
  const data = response.data;
  if (data.error) {
    throw new Error(data.error.data?.message || data.error.message || 'Lỗi không xác định từ server');
  }
  const result = data.result;
  if (result && typeof result === 'object' && !Array.isArray(result) && result.error) {
    throw new Error(result.error);
  }
  return result;
}

module.exports = {
  registerDevice,
  heartbeat,
  createTicket,
  getDeviceTickets,
  postMessage,
  getMessages,
  getRealtimeChannel,
  poll,
  verifyManager,
};
