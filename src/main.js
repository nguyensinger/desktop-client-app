// main.js
// Main process của Electron. Chạy nền với tray icon, mở cửa sổ khi người dùng click vào tray
// hoặc khi cần tạo ticket mới. Heartbeat tự động gửi định kỳ lên Odoo.

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const { getConfig, setConfig, isConfigured, hasServerCredentials } = require('./config');
const { collectDeviceInfo } = require('./deviceInfo');
const api = require('./api');

let mainWindow = null;
let tray = null;
let heartbeatTimer = null;

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 420,
    height: 640,
    resizable: false,
    title: 'IT Support Desktop Client',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Phím tắt F12 / Ctrl+Shift+I để mở DevTools - hữu ích khi cần debug lỗi renderer
  // (xem console.log, network request, exception) mà không cần build lại app.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toUpperCase() === 'I')) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('close', (e) => {
    // Đóng cửa sổ chỉ ẩn đi, app vẫn chạy nền ở tray để duy trì heartbeat
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Icon đặt tại assets/tray-icon.png (16x16 hoặc 32x32, nền trong suốt)
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch (e) {
    trayIcon = nativeImage.createEmpty();
  }
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  tray.setToolTip('IT Support Desktop Client');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open IT Support', click: () => createWindow() },
    { label: 'Create New Support Request', click: () => createWindow() },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => createWindow());
}

async function runHeartbeat() {
  try {
    const config = getConfig();
    if (!config.deviceId) return;
    const info = await collectDeviceInfo();
    await api.heartbeat(config.deviceId, info);
    console.log('[heartbeat] OK', new Date().toISOString());
  } catch (err) {
    console.error('[heartbeat] FAILED', err.message);
  }
}

function startHeartbeatLoop() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  const { heartbeatIntervalMs } = getConfig();
  runHeartbeat(); // chạy ngay 1 lần khi start
  heartbeatTimer = setInterval(runHeartbeat, heartbeatIntervalMs || 120000);
}

async function registerDeviceWithBackend(formData) {
  const info = await collectDeviceInfo();
  const result = await api.registerDevice({
    customer_id: formData.customerId,
    hostname: info.hostname,
    serial_number: info.machine_id,
    os_info: info.os_info,
    cpu_info: info.cpu_info,
    ram_gb: info.ram_gb,
    disk_info: info.disk_info,
    mac_address: info.mac_address,
    ip_address: info.ip_address,
    ultraview_id: formData.ultraviewId,
    end_user_name: formData.endUserName,
    end_user_email: formData.endUserEmail,
    end_user_phone: formData.endUserPhone || '',
    end_user_department: formData.endUserDepartment || '',
  });
  setConfig({
    customerId: formData.customerId,
    deviceId: result.device_id,
    ultraviewId: formData.ultraviewId,
    endUserName: formData.endUserName,
    endUserEmail: formData.endUserEmail,
    endUserPhone: formData.endUserPhone || '',
    endUserDepartment: formData.endUserDepartment || '',
  });
  return result;
}

async function tryRecoverDeviceId() {
  // Trường hợp đặc biệt: đã có đủ server/apiKey/customerId (config cũ hợp lệ) nhưng
  // thiếu deviceId - có thể do lần đăng ký trước bị lỗi giữa đường, hoặc config được
  // tạo từ bản cũ trước khi app lưu deviceId. Backend device_register là idempotent
  // (tìm theo customer_id + hostname, không tạo trùng), nên gọi lại an toàn, không cần
  // hỏi lại toàn bộ form Setup.
  const config = getConfig();
  try {
    await registerDeviceWithBackend({
      customerId: config.customerId,
      ultraviewId: config.ultraviewId,
      endUserName: config.endUserName,
      endUserEmail: config.endUserEmail,
      endUserPhone: config.endUserPhone || '',
      endUserDepartment: config.endUserDepartment || '',
    });
    console.log('[recover] Đã tự khôi phục deviceId thành công.');
    return true;
  } catch (err) {
    console.error('[recover] Không tự khôi phục được deviceId:', err.message);
    return false;
  }
}


// ---------- Auto-start cùng Windows ----------
function applyAutoStartSetting() {
  const { autoStart } = getConfig();
  app.setLoginItemSettings({
    openAtLogin: !!autoStart,
    openAsHidden: true,
  });
}

app.whenReady().then(async () => {
  applyAutoStartSetting();
  createTray();
  if (isConfigured()) {
    startHeartbeatLoop();
  } else if (hasServerCredentials()) {
    // Có đủ server/apiKey/customerId nhưng thiếu deviceId - thử tự đăng ký lại
    // trước khi bắt người dùng điền lại toàn bộ form Setup.
    const recovered = await tryRecoverDeviceId();
    if (recovered) {
      startHeartbeatLoop();
    } else {
      createWindow(); // tự phục hồi thất bại (server không tới được, v.v.) - mở Setup để xem lỗi
    }
  } else {
    createWindow(); // chưa từng cấu hình gì - mở cửa sổ setup lần đầu
  }
  // Trên macOS không tạo cửa sổ chính khi khởi động nếu đã setup - app chạy nền qua tray.
});

app.on('window-all-closed', (e) => {
  // Không quit app khi đóng hết cửa sổ - giữ app chạy nền qua tray icon
  e.preventDefault();
});

// ---------- IPC handlers (giao tiếp với renderer process / UI) ----------

ipcMain.handle('config:get', () => getConfig());

ipcMain.handle('i18n:load', (event, lang) => {
  // Chỉ cho phép đúng 3 mã ngôn ngữ đã hỗ trợ - tránh path traversal nếu renderer
  // bị compromise và truyền giá trị lang bất thường.
  const allowed = ['en', 'vi', 'fr'];
  const safeLang = allowed.includes(lang) ? lang : 'en';
  const filePath = path.join(__dirname, 'renderer', 'i18n', `${safeLang}.json`);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
});

ipcMain.handle('config:set', (event, partial) => setConfig(partial));

ipcMain.handle('device:collectInfo', async () => collectDeviceInfo());

ipcMain.handle('device:register', async (event, formData) => {
  const result = await registerDeviceWithBackend(formData);
  startHeartbeatLoop();
  return result;
});

ipcMain.handle('ticket:create', async (event, payload) => {
  const config = getConfig();
  return api.createTicket({
    device_id: config.deviceId,
    subject: payload.subject,
    description: payload.description,
    priority: payload.priority || '1',
    attachments: payload.attachments || undefined,
  });
});


ipcMain.handle('clipboard:getImage', () => {
  const { clipboard, nativeImage } = require('electron');
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  return img.toPNG().toString('base64');
});

ipcMain.handle('ticket:listForDevice', async () => {
  const config = getConfig();
  if (!config.deviceId) return [];
  return api.getDeviceTickets(config.deviceId);
});

ipcMain.handle('ticket:postMessage', async (event, { ticketId, body }) => {
  return api.postMessage(ticketId, body);
});

ipcMain.handle('ticket:getMessages', async (event, ticketId) => {
  return api.getMessages(ticketId);
});

ipcMain.handle('ticket:getRealtimeChannel', async (event, ticketId) => {
  return api.getRealtimeChannel(ticketId);
});

// ---------- Realtime polling loop (chạy trong main process) ----------
// Khi renderer mở tab chat cho 1 ticket, nó gọi 'realtime:subscribe' với ticketId.
// Main process chạy vòng lặp long-polling nền và đẩy event mới về renderer qua
// webContents.send, không phụ thuộc vào renderer còn "sống" hay không giữa các lần gọi.

let realtimeSubscription = null; // { ticketId, channel, lastId, stopped }

async function realtimePollLoop(channel, ticketId) {
  let last = 0;
  while (realtimeSubscription && realtimeSubscription.ticketId === ticketId && !realtimeSubscription.stopped) {
    try {
      const notifications = await api.poll([channel], last);
      if (notifications && notifications.length > 0) {
        for (const notif of notifications) {
          last = Math.max(last, notif.id || 0);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('realtime:event', { ticketId, notifications });
        }
      }
    } catch (err) {
      console.error('[realtime poll] lỗi, thử lại sau 5s:', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

ipcMain.handle('realtime:subscribe', async (event, ticketId) => {
  if (realtimeSubscription) {
    realtimeSubscription.stopped = true; // dừng loop cũ trước khi bắt đầu loop mới
  }
  const { channel } = await api.getRealtimeChannel(ticketId);
  realtimeSubscription = { ticketId, channel, stopped: false };
  realtimePollLoop(channel, ticketId); // chạy nền, không await
  return { channel };
});

ipcMain.handle('realtime:unsubscribe', () => {
  if (realtimeSubscription) {
    realtimeSubscription.stopped = true;
    realtimeSubscription = null;
  }
});
