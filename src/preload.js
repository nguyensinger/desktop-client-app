// preload.js
// Expose 1 API an toàn, có kiểm soát cho renderer process, tuân thủ contextIsolation.
// Renderer KHÔNG được truy cập trực tiếp Node.js API hay ipcRenderer thô để tránh
// rủi ro an ninh nếu renderer load nội dung không tin cậy.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('itSupportAgent', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (partial) => ipcRenderer.invoke('config:set', partial),
  loadTranslations: (lang) => ipcRenderer.invoke('i18n:load', lang),
  collectDeviceInfo: () => ipcRenderer.invoke('device:collectInfo'),
  registerDevice: (formData) => ipcRenderer.invoke('device:register', formData),
  pairWithCode: (formData) => ipcRenderer.invoke('device:pairWithCode', formData),
  createTicket: (payload) => ipcRenderer.invoke('ticket:create', payload),
  listTicketsForDevice: () => ipcRenderer.invoke('ticket:listForDevice'),
  postMessage: (ticketId, body) => ipcRenderer.invoke('ticket:postMessage', { ticketId, body }),
  getMessages: (ticketId) => ipcRenderer.invoke('ticket:getMessages', ticketId),
  getRealtimeChannel: (ticketId) => ipcRenderer.invoke('ticket:getRealtimeChannel', ticketId),

  // Realtime: subscribe bắt đầu vòng lặp long-polling nền trong main process,
  // onRealtimeEvent đăng ký callback nhận event khi có tin nhắn/thay đổi mới.
  subscribeRealtime: (ticketId) => ipcRenderer.invoke('realtime:subscribe', ticketId),
  unsubscribeRealtime: () => ipcRenderer.invoke('realtime:unsubscribe'),
  onRealtimeEvent: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('realtime:event', handler);
    return () => ipcRenderer.removeListener('realtime:event', handler);
  },
  getClipboardImage: () => ipcRenderer.invoke('clipboard:getImage'),
  verifyManager: (apiKey) => ipcRenderer.invoke('admin:verifyManager', apiKey),

  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateDownloaded: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('update:downloaded', handler);
    return () => ipcRenderer.removeListener('update:downloaded', handler);
  },
});
