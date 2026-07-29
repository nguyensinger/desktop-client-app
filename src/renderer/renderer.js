// renderer.js — chạy trong renderer process, chỉ gọi qua window.itSupportAgent (preload bridge)

const els = {
  deviceStatus: document.getElementById('deviceStatus'),
  tabs: document.getElementById('tabs'),
  setupPanel: document.getElementById('setupPanel'),
  newTicketPanel: document.getElementById('newTicketPanel'),
  chatPanel: document.getElementById('chatPanel'),
  settingsPanel: document.getElementById('settingsPanel'),
};

let currentConfig = null;
let isEditMode = false;

async function init() {
  currentConfig = await window.itSupportAgent.getConfig();
  await window.i18n.loadLanguage(currentConfig.language || 'en');
  window.i18n.applyTranslations();
  document.getElementById('languageSelect').value = window.i18n.getCurrentLanguage();

  bindEvents();
  if (currentConfig.deviceId) {
    showMainApp();
  } else {
    showSetup();
  }
}

function showSetup() {
  els.tabs.style.display = 'none';
  hideAllPanels();
  els.setupPanel.style.display = 'block';
  els.deviceStatus.textContent = window.i18n.t('status.notConfigured');
}

function showMainApp() {
  els.tabs.style.display = 'flex';
  hideAllPanels();
  els.deviceStatus.textContent = window.i18n.t('status.connected');
  refreshSettingsInfo();
  document.querySelector('.tab-btn[data-tab="chat"]').click();
}

function hideAllPanels() {
  [els.setupPanel, els.newTicketPanel, els.chatPanel, els.settingsPanel].forEach(
    (p) => (p.style.display = 'none')
  );
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  hideAllPanels();
  document.getElementById(`${tabName}Panel`).style.display = 'block';
  if (tabName === 'chat') {
    loadChatTab();
  }
}

async function refreshSettingsInfo() {
  const config = await window.itSupportAgent.getConfig();
  document.getElementById('infoBaseUrl').textContent = config.odooBaseUrl || '-';
  document.getElementById('infoDeviceId').textContent = config.deviceId || '-';
  document.getElementById('infoUltraview').textContent = config.ultraviewId || '-';
  document.getElementById('infoUser').textContent = config.endUserName || '-';
  if (document.getElementById('infoDepartment')) {
    document.getElementById('infoDepartment').textContent = config.endUserDepartment || '-';
  }
  if (document.getElementById('infoEmail')) {
    document.getElementById('infoEmail').textContent = config.endUserEmail || '-';
  }
  if (document.getElementById('infoPhone')) {
    document.getElementById('infoPhone').textContent = config.endUserPhone || '-';
  }
}

let unsubscribeRealtimeListener = null;
let currentChatTicketId = null;
let subscribedTicketId = null; // ticket đã subscribe realtime - tránh subscribe lại liên tục
let pendingOpenTicketId = null;
let attachedFiles = []; // [{name, base64, mime}] // ticket vừa tạo, cần ưu tiên mở ngay khi vào tab Chat

function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
      if (btn.dataset.tab !== 'chat') {
        window.itSupportAgent.unsubscribeRealtime();
        subscribedTicketId = null;
      }
    });
  });

  document.getElementById('btnRegister').addEventListener('click', onRegister);
  document.getElementById('btnEditSettings').addEventListener('click', () => {
    document.getElementById('editSettingsGate').style.display = 'none';
    document.getElementById('editSettingsPrompt').style.display = 'block';
    document.getElementById('adminApiKeyInput').value = '';
    document.getElementById('unlockError').textContent = '';
    document.getElementById('adminApiKeyInput').focus();
  });
  document.getElementById('btnCancelUnlock').addEventListener('click', () => {
    document.getElementById('editSettingsPrompt').style.display = 'none';
    document.getElementById('editSettingsGate').style.display = 'block';
  });
  document.getElementById('btnUnlockEdit').addEventListener('click', onUnlockEdit);
  document.getElementById('adminApiKeyInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onUnlockEdit();
  });
  document.getElementById('btnCancelEdit').addEventListener('click', exitEditMode);
  document.getElementById('btnCreateTicket').addEventListener('click', onCreateTicket);
  document.getElementById('btnAttach').addEventListener('click', () => {
    document.getElementById('attachInput').click();
  });
  document.getElementById('attachInput').addEventListener('change', onAttachChange);
  document.getElementById('btnGoToNewRequest').addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="newTicket"]').click();
  });
  document.getElementById('btnSendChat').addEventListener('click', onSendChat);
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSendChat();
  });
  document.getElementById('chatTicketSelect').addEventListener('change', (e) => {
    openTicketChat(e.target.value);
  });
  document.getElementById('languageSelect').addEventListener('change', async (e) => {
    const lang = e.target.value;
    await window.i18n.setLanguage(lang);
    await window.itSupportAgent.setConfig({ language: lang });
    currentConfig.language = lang;
    // Áp lại các đoạn text được set bằng JS (không qua data-i18n), vì applyTranslations()
    // chỉ cập nhật DOM hiện có theo attribute, không tự chạy lại logic hiển thị trạng thái.
    if (currentConfig.deviceId) {
      els.deviceStatus.textContent = window.i18n.t('status.connected');
    } else {
      els.deviceStatus.textContent = window.i18n.t('status.notConfigured');
    }
  });

  if (!unsubscribeRealtimeListener) {
    unsubscribeRealtimeListener = window.itSupportAgent.onRealtimeEvent((data) => {
      if (String(data.ticketId) === String(currentChatTicketId)) {
        // Có event mới (chat, đổi trạng thái...) cho ticket đang mở -> tải lại tin nhắn
        loadChatMessages(currentChatTicketId);
      }
    });
  }
}

async function onUnlockEdit() {
  const errorEl = document.getElementById('unlockError');
  const apiKey = document.getElementById('adminApiKeyInput').value.trim();
  errorEl.textContent = '';
  if (!apiKey) {
    errorEl.textContent = window.i18n.t('settings.errorEnterKey');
    return;
  }

  const btn = document.getElementById('btnUnlockEdit');
  btn.disabled = true;
  try {
    // Chỉ dùng key này để kiểm tra quyền qua whoami - KHÔNG lưu lại, không thay
    // apiKey đang hoạt động của thiết bị (đó là key riêng, dùng cho ticket/chat).
    await window.itSupportAgent.verifyManager(apiKey);
    document.getElementById('editSettingsPrompt').style.display = 'none';
    await enterEditMode();
  } catch (err) {
    errorEl.textContent = window.i18n.t('common.error', { error: err.message });
  } finally {
    btn.disabled = false;
  }
}

async function enterEditMode() {
  isEditMode = true;
  const config = await window.itSupportAgent.getConfig();
  document.getElementById('setupBaseUrl').value = config.odooBaseUrl || '';
  document.getElementById('setupApiKey').value = config.apiKey || '';
  document.getElementById('setupCustomerId').value = config.customerId || '';
  document.getElementById('setupUltraview').value = config.ultraviewId || '';
  document.getElementById('setupUserName').value = config.endUserName || '';
  document.getElementById('setupUserEmail').value = config.endUserEmail || '';
  document.getElementById('setupUserPhone').value = config.endUserPhone || '';
  document.getElementById('setupUserDepartment').value = config.endUserDepartment || '';
  document.getElementById('setupError').textContent = '';
  document.getElementById('btnRegister').textContent = window.i18n.t('setup.saveButton');
  document.getElementById('btnCancelEdit').style.display = 'inline-block';

  els.tabs.style.display = 'none';
  hideAllPanels();
  els.setupPanel.style.display = 'block';
}

function exitEditMode() {
  isEditMode = false;
  document.getElementById('btnRegister').textContent = window.i18n.t('setup.registerButton');
  document.getElementById('btnCancelEdit').style.display = 'none';
  document.getElementById('editSettingsGate').style.display = 'block';
  document.getElementById('editSettingsPrompt').style.display = 'none';
  showMainApp();
}

async function onRegister() {
  const errorEl = document.getElementById('setupError');
  errorEl.textContent = '';

  const baseUrl = document.getElementById('setupBaseUrl').value.trim();
  const apiKey = document.getElementById('setupApiKey').value.trim();
  const customerId = parseInt(document.getElementById('setupCustomerId').value, 10);
  const ultraviewId = document.getElementById('setupUltraview').value.trim();
  const endUserName = document.getElementById('setupUserName').value.trim();
  const endUserEmail = document.getElementById('setupUserEmail').value.trim();
  const endUserPhone = document.getElementById('setupUserPhone')?.value.trim() || '';
  const endUserDepartment = document.getElementById('setupUserDepartment')?.value.trim() || '';

  if (!baseUrl || !apiKey || !customerId) {
    errorEl.textContent = window.i18n.t('setup.errorFillFields');
    return;
  }

  const btn = document.getElementById('btnRegister');
  const wasEditMode = isEditMode;
  btn.disabled = true;
  btn.textContent = window.i18n.t('setup.registering');

  try {
    await window.itSupportAgent.setConfig({ odooBaseUrl: baseUrl, apiKey });
    await window.itSupportAgent.registerDevice({
      customerId,
      ultraviewId,
      endUserName,
      endUserEmail,
      endUserPhone,
      endUserDepartment,
    });
    if (wasEditMode) {
      isEditMode = false;
      document.getElementById('btnCancelEdit').style.display = 'none';
      document.getElementById('editSettingsGate').style.display = 'block';
    }
    showMainApp();
  } catch (err) {
    errorEl.textContent = window.i18n.t('common.error', { error: err.message });
  } finally {
    btn.disabled = false;
    btn.textContent = window.i18n.t(wasEditMode ? 'setup.saveButton' : 'setup.registerButton');
  }
}


async function onAttachChange(e) {
  const files = Array.from(e.target.files);
  for (const file of files) {
    if (attachedFiles.length >= 5) break; // max 5 images
    const base64 = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result.split(',')[1]);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
    attachedFiles.push({ name: file.name, base64, mime: file.type });
  }
  // Reset input so same file can be re-added after remove
  e.target.value = '';
  renderAttachPreview();
}

function renderAttachPreview() {
  const preview = document.getElementById('attachPreview');
  preview.innerHTML = '';
  attachedFiles.forEach((f, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb-wrap';
    const img = document.createElement('img');
    img.src = `data:${f.mime};base64,${f.base64}`;
    img.title = f.name;
    const btn = document.createElement('button');
    btn.className = 'thumb-remove';
    btn.textContent = '×';
    btn.onclick = () => { attachedFiles.splice(idx, 1); renderAttachPreview(); };
    wrap.appendChild(img);
    wrap.appendChild(btn);
    preview.appendChild(wrap);
  });
}


// Paste from clipboard (Ctrl+V) - dùng Electron clipboard API
// Dùng cả keydown và paste event để đảm bảo hoạt động
async function handleClipboardPaste() {
  // Chỉ xử lý khi tab New Request đang active
  const newRequestPanel = document.getElementById('panelNewRequest');
  if (!newRequestPanel || newRequestPanel.style.display === 'none') return;

  try {
    const base64 = await window.itSupportAgent.getClipboardImage();
    console.log('[clipboard] getClipboardImage result:', base64 ? 'has image' : 'no image');
    if (!base64) return;
    if (attachedFiles.length >= 5) return;
    const name = `screenshot_${Date.now()}.png`;
    attachedFiles.push({ name, base64, mime: 'image/png' });
    renderAttachPreview();
  } catch (err) {
    console.error('clipboard paste error:', err);
  }
}

document.addEventListener('keydown', async (e) => {
  if (e.ctrlKey && e.key === 'v') {
    console.log('[clipboard] Ctrl+V detected, active:', document.activeElement?.tagName);
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    await handleClipboardPaste();
  }
});

document.addEventListener('paste', async (e) => {
  const itemTypes = Array.from(e.clipboardData?.items || []).map(i => i.type);
  console.log('[clipboard] paste event, items:', e.clipboardData?.items?.length, 'types:', itemTypes);
  const newRequestTab2 = document.querySelector('.tab-btn[data-tab="newTicket"]');
  console.log('[clipboard] tab check:', newRequestTab2?.classList?.contains('active'));
  if (!newRequestTab2 || !newRequestTab2.classList.contains('active')) return;
  
  // Thử DOM paste trước
  const items = e.clipboardData?.items;
  if (items) {
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue;
      if (attachedFiles.length >= 5) break;
      const file = item.getAsFile();
      if (!file) continue;
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result.split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      attachedFiles.push({ name: `screenshot_${Date.now()}.png`, base64, mime: file.type });
    }
    renderAttachPreview();
    return;
  }
  // Fallback: Electron clipboard API
  await handleClipboardPaste();
});

async function onCreateTicket() {
  const successEl = document.getElementById('ticketSuccess');
  const errorEl = document.getElementById('ticketError');
  successEl.textContent = '';
  errorEl.textContent = '';

  const priority = document.getElementById('ticketPriority').value;
  const subject = document.getElementById('ticketSubject').value.trim();
  const description = document.getElementById('ticketDescription').value.trim();

  if (!subject) {
    errorEl.textContent = window.i18n.t('newTicket.errorSubject');
    return;
  }

  const btn = document.getElementById('btnCreateTicket');
  btn.disabled = true;
  btn.textContent = window.i18n.t('newTicket.submitting');

  try {
    console.log('[ticket] creating, attachments count:', attachedFiles.length);
    const result = await window.itSupportAgent.createTicket({
      subject,
      description,
      priority,
      attachments: attachedFiles.length > 0 ? attachedFiles : undefined,
    });
    pendingOpenTicketId = result.ticket_id;

    successEl.textContent = window.i18n.t('newTicket.successCreated', { name: result.ticket_name });
    document.getElementById('ticketSubject').value = '';
    document.getElementById('ticketDescription').value = '';
    attachedFiles = [];
    renderAttachPreview();

    // Đưa người dùng sang tab chat ngay - đây là lúc họ cần trao đổi thêm với IT support
    setTimeout(() => {
      successEl.textContent = '';
      document.querySelector('.tab-btn[data-tab="chat"]').click();
    }, 900);
  } catch (err) {
    errorEl.textContent = window.i18n.t('common.error', { error: err.message });
  } finally {
    btn.disabled = false;
    btn.textContent = window.i18n.t('newTicket.submitButton');
  }
}

function ticketStateLabel(state) {
  return window.i18n.t(`ticketState.${state}`);
}

async function loadChatTab() {
  // Gọi mỗi khi vào tab Chat - tải lại danh sách ticket của thiết bị này (kể cả ticket
  // đã hoàn thành, để xem lại lịch sử trao đổi) và build dropdown chọn ticket.
  const selectEl = document.getElementById('chatTicketSelect');
  const emptyStateEl = document.getElementById('chatEmptyState');
  const activeAreaEl = document.getElementById('chatActiveArea');

  let tickets = [];
  try {
    tickets = await window.itSupportAgent.listTicketsForDevice();
  } catch (err) {
    selectEl.style.display = 'none';
    emptyStateEl.style.display = 'block';
    activeAreaEl.style.display = 'none';
    emptyStateEl.querySelector('p').textContent = window.i18n.t('common.error', { error: err.message });
    return;
  }

  if (!tickets || tickets.length === 0) {
    currentChatTicketId = null;
    selectEl.style.display = 'none';
    emptyStateEl.style.display = 'block';
    activeAreaEl.style.display = 'none';
    emptyStateEl.querySelector('p').textContent = window.i18n.t('chat.emptyState');
    if (subscribedTicketId !== null) {
      window.itSupportAgent.unsubscribeRealtime();
      subscribedTicketId = null;
    }
    return;
  }

  selectEl.style.display = 'block';
  selectEl.innerHTML = tickets
    .map((t) => `<option value="${t.id}">${escapeHtml(t.name)} - ${escapeHtml(t.subject)} (${ticketStateLabel(t.state)})</option>`)
    .join('');

  // Ưu tiên mở ticket vừa tạo (nếu user vừa submit request) > giữ ticket đang xem (nếu
  // vẫn còn trong danh sách) > mặc định ticket mới nhất.
  let ticketIdToOpen;
  if (pendingOpenTicketId && tickets.some((t) => String(t.id) === String(pendingOpenTicketId))) {
    ticketIdToOpen = pendingOpenTicketId;
    pendingOpenTicketId = null;
  } else if (tickets.some((t) => String(t.id) === String(currentChatTicketId))) {
    ticketIdToOpen = currentChatTicketId;
  } else {
    ticketIdToOpen = tickets[0].id;
  }
  selectEl.value = ticketIdToOpen;

  await openTicketChat(ticketIdToOpen);
}

async function openTicketChat(ticketId) {
  const emptyStateEl = document.getElementById('chatEmptyState');
  const activeAreaEl = document.getElementById('chatActiveArea');
  const labelEl = document.getElementById('chatTicketLabel');

  currentChatTicketId = ticketId;
  emptyStateEl.style.display = 'none';
  activeAreaEl.style.display = 'block';
  labelEl.textContent = window.i18n.t('chat.requestLabel', { id: ticketId });
  await loadChatMessages(ticketId);

  // Chỉ realtime cho ticket đang mở xem - chuyển sang ticket khác trong dropdown sẽ
  // dừng subscribe cũ và subscribe ticket mới, không theo dõi đồng thời nhiều ticket.
  if (subscribedTicketId !== ticketId) {
    await window.itSupportAgent.subscribeRealtime(ticketId);
    subscribedTicketId = ticketId;
  }
}

async function loadChatMessages(ticketId) {
  const messagesEl = document.getElementById('chatMessages');
  messagesEl.innerHTML = `<p class="hint">${window.i18n.t('chat.loading')}</p>`;
  try {
    const messages = await window.itSupportAgent.getMessages(ticketId);
    renderMessages(messages);
  } catch (err) {
    messagesEl.innerHTML = `<p class="error">${window.i18n.t('common.error', { error: err.message })}</p>`;
  }
}

function renderMessages(messages) {
  const messagesEl = document.getElementById('chatMessages');
  messagesEl.innerHTML = '';
  const myDept = currentConfig?.endUserDepartment || '';
  const customerName = ''; // loaded separately if needed
  const myName = currentConfig?.endUserName || '';
  // Display format for outgoing messages: kept as endUserName
  // The server formats it as Customer-Department-UserName via author field
  messages.forEach((m) => {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${m.author === myName ? 'mine' : 'other'}`;
    bubble.innerHTML = `<span class="author">${escapeHtml(m.author || 'IT Support')}</span>${escapeHtml(stripHtml(m.body))}`;
    messagesEl.appendChild(bubble);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function onSendChat() {
  const ticketId = currentChatTicketId;
  const input = document.getElementById('chatInput');
  const body = input.value.trim();
  if (!ticketId || !body) return;

  input.value = '';
  try {
    await window.itSupportAgent.postMessage(ticketId, body);
    await loadChatMessages(ticketId);
  } catch (err) {
    alert(window.i18n.t('chat.errorSendFailed', { error: err.message }));
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function stripHtml(htmlText) {
  // Odoo message_post lưu body dạng HTML (thường bọc trong <p>...</p>).
  // Loại bỏ tag để hiển thị dạng text thuần cho gọn trên khung chat desktop - nhưng
  // đổi <br>/</p> thành newline TRƯỚC khi lấy textContent, vì textContent bỏ hẳn các
  // tag đó (không tự chèn \n), khiến tin nhắn nhiều dòng (vd tin chào tự động khi tạo
  // ticket) bị dồn lại thành 1 dòng dài. Cần .chat-bubble có white-space: pre-wrap để
  // \n thực sự hiển thị xuống dòng.
  const withBreaks = (htmlText || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
  const div = document.createElement('div');
  div.innerHTML = withBreaks;
  return (div.textContent || div.innerText || '').trim();
}

init();
