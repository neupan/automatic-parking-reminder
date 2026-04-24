(function () {
  'use strict';

  /* ========== Constants ========== */
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  const REMINDER_BEFORE = 20 * 60 * 1000; // 20 minutes before deadline
  const CIRCUMFERENCE = 2 * Math.PI * 96; // ring radius = 96
  const STORAGE_KEY = 'parkingData';
  const HISTORY_KEY = 'parkingHistory';

  /* ========== DOM Elements ========== */
  const $ = (id) => document.getElementById(id);
  const idleState = $('idle-state');
  const activeState = $('active-state');
  const btnStart = $('btn-start');
  const btnCheckout = $('btn-checkout');
  const btnEditTime = $('btn-edit-time');
  const parkTimeEl = $('park-time');
  const expireTimeEl = $('expire-time');
  const feeBadgeEl = $('fee-badge');
  const countdownEl = $('countdown');
  const countdownLabelEl = $('countdown-label');
  const countdownDateEl = $('countdown-date');
  const ringProgress = $('ring-progress');
  const historyList = $('history-list');
  const btnClearHistory = $('btn-clear-history');
  const timeEditModal = $('time-edit-modal');
  const timeInput = $('time-input');
  const btnSaveTime = $('btn-save-time');
  const btnCancelEdit = $('btn-cancel-edit');
  const notifBanner = $('notif-banner');
  const btnEnableNotif = $('btn-enable-notif');
  const btnDismissNotif = $('btn-dismiss-notif');

  /* ========== State ========== */
  let parkingData = null;
  let tickInterval = null;
  let reminderTimeout = null;

  /* ========== Initialize ========== */
  function init() {
    loadData();
    bindEvents();
    checkNotificationPermission();
    registerServiceWorker();
    startTicker();
    updateUI();
  }

  /* ========== Data Persistence ========== */
  function loadData() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) parkingData = JSON.parse(stored);
    } catch (e) {
      parkingData = null;
    }
  }

  function saveData() {
    if (parkingData) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parkingData));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(history) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }

  /* ========== Event Binding ========== */
  function bindEvents() {
    btnStart.addEventListener('click', startParking);
    btnCheckout.addEventListener('click', checkout);
    btnEditTime.addEventListener('click', showEditModal);
    btnSaveTime.addEventListener('click', saveEditedTime);
    btnCancelEdit.addEventListener('click', hideEditModal);
    btnClearHistory.addEventListener('click', clearHistory);

    if (btnEnableNotif) {
      btnEnableNotif.addEventListener('click', requestNotificationPermission);
    }
    if (btnDismissNotif) {
      btnDismissNotif.addEventListener('click', () => {
        notifBanner.classList.add('hidden');
        localStorage.setItem('notifDismissed', 'true');
      });
    }

    // Re-check when app becomes visible
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkAndNotify();
        updateUI();
      }
    });

    // Close modal on overlay click
    timeEditModal.addEventListener('click', (e) => {
      if (e.target === timeEditModal) hideEditModal();
    });
  }

  /* ========== Core Actions ========== */
  function startParking() {
    parkingData = {
      parkTime: new Date().toISOString(),
      reminderSent: false,
    };
    saveData();
    scheduleReminder();
    updateUI();
    vibrate(50);
  }

  function checkout() {
    if (!parkingData) return;

    const parkTime = new Date(parkingData.parkTime);
    const now = new Date();
    const duration = now - parkTime;
    const fee = duration > TWELVE_HOURS ? 10 : 5;

    // Add to history
    const history = getHistory();
    history.unshift({
      parkTime: parkingData.parkTime,
      checkoutTime: now.toISOString(),
      duration,
      fee,
    });
    if (history.length > 50) history.length = 50;
    saveHistory(history);

    // Clear session
    parkingData = null;
    saveData();
    clearTimeout(reminderTimeout);
    document.body.classList.remove('urgent-pulse');
    updateUI();
    vibrate(50);
  }

  /* ========== Time Edit ========== */
  function showEditModal() {
    if (!parkingData) return;
    const dt = new Date(parkingData.parkTime);
    timeInput.value = toLocalISOString(dt);
    timeEditModal.classList.remove('hidden');
  }

  function hideEditModal() {
    timeEditModal.classList.add('hidden');
  }

  function saveEditedTime() {
    const val = timeInput.value;
    if (!val) return;
    const newTime = new Date(val);
    if (isNaN(newTime.getTime())) return;
    if (newTime > new Date()) {
      alert('入库时间不能晚于当前时间');
      return;
    }
    parkingData.parkTime = newTime.toISOString();
    parkingData.reminderSent = false;
    saveData();
    scheduleReminder();
    updateUI();
    hideEditModal();
    vibrate(50);
  }

  /* ========== UI Updates ========== */
  function updateUI() {
    if (!parkingData) {
      idleState.classList.remove('hidden');
      activeState.classList.add('hidden');
    } else {
      idleState.classList.add('hidden');
      activeState.classList.remove('hidden');
      updateActiveUI();
    }
    updateHistoryUI();
  }

  function updateActiveUI() {
    const parkTime = new Date(parkingData.parkTime);
    const expireTime = new Date(parkTime.getTime() + TWELVE_HOURS);
    const now = new Date();
    const elapsed = now - parkTime;
    const remaining = TWELVE_HOURS - elapsed;

    // Basic info
    parkTimeEl.textContent = formatTime(parkTime);
    expireTimeEl.textContent = formatTime(expireTime);

    // Show expire date if different from today
    const today = new Date();
    if (expireTime.toDateString() !== today.toDateString()) {
      const month = expireTime.getMonth() + 1;
      const day = expireTime.getDate();
      countdownDateEl.textContent = `到期日: ${month}月${day}日`;
    } else {
      countdownDateEl.textContent = '';
    }

    if (remaining > 0) {
      // Within 12 hours
      countdownEl.textContent = formatDuration(remaining);
      countdownLabelEl.textContent = '距离到期还有';
      feeBadgeEl.textContent = '¥5';
      feeBadgeEl.classList.remove('overtime');

      // Ring progress
      const progress = remaining / TWELVE_HOURS;
      ringProgress.style.strokeDasharray = CIRCUMFERENCE;
      ringProgress.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);

      // Color states
      countdownEl.classList.remove('warning', 'urgent', 'overtime');
      document.body.classList.remove('urgent-pulse');

      if (remaining <= REMINDER_BEFORE) {
        // < 20 min: urgent
        ringProgress.setAttribute('stroke', 'url(#grad-urgent)');
        countdownEl.classList.add('urgent');
        document.body.classList.add('urgent-pulse');
      } else if (remaining <= 60 * 60 * 1000) {
        // < 1 hour: warning
        ringProgress.setAttribute('stroke', 'url(#grad-warning)');
        countdownEl.classList.add('warning');
      } else {
        // normal
        ringProgress.setAttribute('stroke', 'url(#grad-normal)');
      }
    } else {
      // Overtime
      const overtime = Math.abs(remaining);
      countdownEl.textContent = '+' + formatDuration(overtime);
      countdownLabelEl.textContent = '已超过12小时';
      feeBadgeEl.textContent = '¥10';
      feeBadgeEl.classList.add('overtime');
      countdownEl.classList.remove('warning', 'urgent');
      countdownEl.classList.add('overtime');

      ringProgress.style.strokeDasharray = CIRCUMFERENCE;
      ringProgress.style.strokeDashoffset = 0;
      ringProgress.setAttribute('stroke', 'url(#grad-urgent)');
      document.body.classList.add('urgent-pulse');
    }
  }

  function updateHistoryUI() {
    const history = getHistory();
    if (history.length === 0) {
      historyList.innerHTML = '<p class="empty-hint">暂无停车记录</p>';
      return;
    }

    historyList.innerHTML = history
      .slice(0, 20)
      .map((item) => {
        const parkTime = new Date(item.parkTime);
        const checkoutTime = new Date(item.checkoutTime);
        const durH = Math.floor(item.duration / 3600000);
        const durM = Math.floor((item.duration % 3600000) / 60000);
        const dateStr = `${parkTime.getMonth() + 1}/${parkTime.getDate()}`;
        const feeClass = item.fee <= 5 ? 'fee-5' : 'fee-10';

        return `
          <div class="history-item">
            <div class="history-info">
              <span class="history-date">${dateStr} ${formatTime(parkTime)} → ${formatTime(checkoutTime)}</span>
              <span class="history-duration">停车 ${durH}小时${durM}分钟</span>
            </div>
            <span class="history-fee ${feeClass}">¥${item.fee}</span>
          </div>
        `;
      })
      .join('');
  }

  /* ========== Ticker ========== */
  function startTicker() {
    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(() => {
      if (parkingData) {
        updateActiveUI();
        checkAndNotify();
      }
    }, 1000);
  }

  /* ========== Notification & Reminder ========== */
  function checkNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default' && !localStorage.getItem('notifDismissed')) {
      notifBanner.classList.remove('hidden');
    }
  }

  function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    Notification.requestPermission().then((perm) => {
      notifBanner.classList.add('hidden');
      if (perm === 'granted' && parkingData) {
        scheduleReminder();
      }
    });
  }

  function scheduleReminder() {
    clearTimeout(reminderTimeout);
    if (!parkingData) return;

    const parkTime = new Date(parkingData.parkTime);
    const reminderTime = parkTime.getTime() + TWELVE_HOURS - REMINDER_BEFORE;
    const delay = reminderTime - Date.now();

    if (delay > 0) {
      // Schedule in main thread
      reminderTimeout = setTimeout(() => {
        sendNotification();
      }, delay);

      // Also try to schedule in Service Worker
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SCHEDULE_REMINDER',
          delay: delay,
        });
      }
    } else if (delay > -REMINDER_BEFORE && !parkingData.reminderSent) {
      // Already past reminder time but within 12h - notify immediately
      sendNotification();
    }
  }

  function checkAndNotify() {
    if (!parkingData || parkingData.reminderSent) return;

    const parkTime = new Date(parkingData.parkTime);
    const elapsed = Date.now() - parkTime.getTime();
    const remaining = TWELVE_HOURS - elapsed;

    if (remaining <= REMINDER_BEFORE && remaining > 0) {
      sendNotification();
    }
  }

  function sendNotification() {
    if (!parkingData || parkingData.reminderSent) return;

    parkingData.reminderSent = true;
    saveData();

    // Vibrate
    vibrate([200, 100, 200, 100, 200]);

    // Browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('🅿️ 停车缴费提醒', {
          body: '距离12小时到期还有约20分钟，请尽快缴费离场！当前费用 ¥5',
          icon: './icon-192.png',
          tag: 'parking-reminder',
          requireInteraction: true,
        });
      } catch (e) {
        // Fallback: try via Service Worker
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then((reg) => {
            reg.showNotification('🅿️ 停车缴费提醒', {
              body: '距离12小时到期还有约20分钟，请尽快缴费离场！当前费用 ¥5',
              icon: './icon-192.png',
              tag: 'parking-reminder',
              requireInteraction: true,
              vibrate: [200, 100, 200, 100, 200],
            });
          });
        }
      }
    }
  }

  /* ========== Service Worker ========== */
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // SW registration failed, notifications will still work in foreground
      });
    }
  }

  /* ========== History Management ========== */
  function clearHistory() {
    if (!confirm('确定要清空所有停车记录吗？')) return;
    localStorage.removeItem(HISTORY_KEY);
    updateHistoryUI();
  }

  /* ========== Utility Functions ========== */
  function formatTime(date) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function formatDuration(ms) {
    const totalSec = Math.floor(Math.abs(ms) / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function toLocalISOString(date) {
    const y = date.getFullYear();
    const mo = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const h = pad(date.getHours());
    const mi = pad(date.getMinutes());
    return `${y}-${mo}-${d}T${h}:${mi}`;
  }

  function vibrate(pattern) {
    if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }

  /* ========== Boot ========== */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
