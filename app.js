(function () {
  'use strict';

  /* ========== Constants ========== */
  const ONE_HOUR = 1 * 60 * 60 * 1000;
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  const REMINDER_BEFORE = 10 * 60 * 1000; // 10 min before fee increase
  const CIRCUMFERENCE = 2 * Math.PI * 96;
  const STORAGE_KEY = 'parkingData';
  const HISTORY_KEY = 'parkingHistory';
  const BILLING_CYCLE_KEY = 'billingCycle';

  /* ========== DOM Elements ========== */
  const $ = (id) => document.getElementById(id);
  const idleState = $('idle-state');
  const activeState = $('active-state');
  const btnStart = $('btn-start');
  const btnCheckout = $('btn-checkout');
  const btnCalendar = $('btn-calendar');
  const btnEditTime = $('btn-edit-time');
  const parkTimeEl = $('park-time');
  const elapsedDisplayEl = $('elapsed-display');
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
  const cycleStatusEl = $('cycle-status');
  const cycleInfoEl = $('cycle-info');
  const calendarModal = $('calendar-modal');
  const calendarOptions = $('calendar-options');
  const btnCancelCalendar = $('btn-cancel-calendar');

  /* ========== State ========== */
  let parkingData = null;
  let billingCycle = null; // { cycleStart: ISO, cycleEnd: ISO }
  let tickInterval = null;
  let reminderTimeout = null;

  /* ==========================================================
     Billing Cycle Logic (Nanjing Rules)
     ----------------------------------------------------------
     - ≤ 1h per entry: free
     - > 1h per entry: ¥5 per 12h cycle
     - Within the same 12h billing cycle, multiple entries
       are charged only once (¥5 total).
     - After 12h, a new cycle begins.
     ========================================================== */

  // Load billing cycle from localStorage
  function loadBillingCycle() {
    try {
      const stored = localStorage.getItem(BILLING_CYCLE_KEY);
      if (stored) {
        billingCycle = JSON.parse(stored);
        // Clean up expired cycles
        if (Date.now() > new Date(billingCycle.cycleEnd).getTime()) {
          billingCycle = null;
          localStorage.removeItem(BILLING_CYCLE_KEY);
        }
      }
    } catch (e) {
      billingCycle = null;
    }
  }

  function saveBillingCycle() {
    if (billingCycle) {
      localStorage.setItem(BILLING_CYCLE_KEY, JSON.stringify(billingCycle));
    } else {
      localStorage.removeItem(BILLING_CYCLE_KEY);
    }
  }

  // Is the current moment within an active (previously paid) billing cycle?
  function isWithinPaidCycle() {
    if (!billingCycle) return false;
    return Date.now() < new Date(billingCycle.cycleEnd).getTime();
  }

  // Get the cycle end timestamp (ms), or null
  function getCycleEndMs() {
    if (!billingCycle) return null;
    return new Date(billingCycle.cycleEnd).getTime();
  }

  /* ========== Fee Calculation ========== */

  // Calculate fee for the current session, considering billing cycle
  function calculateFee(elapsedMs, parkTimeMs) {
    const now = parkTimeMs + elapsedMs;
    const cycleEnd = getCycleEndMs();

    // If within a paid billing cycle, portion before cycleEnd is free
    if (cycleEnd && parkTimeMs < cycleEnd) {
      if (now <= cycleEnd) {
        return 0; // entirely within paid cycle
      }
      // Session extends beyond cycle — bill only the post-cycle portion
      const afterCycleElapsed = now - cycleEnd;
      if (afterCycleElapsed <= ONE_HOUR) return 0; // 1h free in new cycle
      return Math.ceil(afterCycleElapsed / TWELVE_HOURS) * 5;
    }

    // Normal calculation (no active cycle)
    if (elapsedMs <= ONE_HOUR) return 0;
    return Math.ceil(elapsedMs / TWELVE_HOURS) * 5;
  }

  // Find the next time the fee will increase
  function getNextThreshold(elapsedMs, parkTimeMs) {
    const now = parkTimeMs + elapsedMs;
    const cycleEnd = getCycleEndMs();

    // Within a paid billing cycle
    if (cycleEnd && parkTimeMs < cycleEnd && now < cycleEnd) {
      // Next threshold: cycle ends, then 1h free, then ¥5
      const thresholdMs = (cycleEnd - parkTimeMs) + ONE_HOUR;
      return { threshold: thresholdMs, nextFee: 5, isCycleEnd: true,
               cycleRemaining: cycleEnd - now };
    }

    // Post-cycle or no cycle: calculate from the effective start
    let effectiveElapsed = elapsedMs;
    let feeBase = 0;

    if (cycleEnd && parkTimeMs < cycleEnd) {
      // Session started within cycle but now past it
      effectiveElapsed = now - cycleEnd;
      feeBase = 0;
    }

    if (effectiveElapsed < ONE_HOUR) {
      const effectiveStart = cycleEnd && parkTimeMs < cycleEnd ? cycleEnd : parkTimeMs;
      return {
        threshold: effectiveStart - parkTimeMs + ONE_HOUR,
        nextFee: feeBase + 5,
      };
    }

    const n = Math.ceil(effectiveElapsed / TWELVE_HOURS);
    const effectiveStart = cycleEnd && parkTimeMs < cycleEnd ? cycleEnd : parkTimeMs;
    const nextThresholdAbs = effectiveStart + ONE_HOUR + (effectiveElapsed > ONE_HOUR ? n * TWELVE_HOURS : 0);

    // Simplified: find next 12h boundary
    const currentCycles = Math.ceil(effectiveElapsed / TWELVE_HOURS);
    const nextBoundary = currentCycles * TWELVE_HOURS;

    if (effectiveElapsed < nextBoundary) {
      const offset = (cycleEnd && parkTimeMs < cycleEnd) ? cycleEnd - parkTimeMs : 0;
      return {
        threshold: offset + nextBoundary,
        nextFee: (currentCycles + 1) * 5 + feeBase,
      };
    }

    const offset = (cycleEnd && parkTimeMs < cycleEnd) ? cycleEnd - parkTimeMs : 0;
    return {
      threshold: offset + (currentCycles + 1) * TWELVE_HOURS,
      nextFee: (currentCycles + 2) * 5 + feeBase,
    };
  }

  // Simple version for no-cycle case
  function getNextThresholdSimple(elapsedMs) {
    if (elapsedMs < ONE_HOUR) {
      return { threshold: ONE_HOUR, nextFee: 5 };
    }
    const n = Math.ceil(elapsedMs / TWELVE_HOURS);
    const nextThreshold = n * TWELVE_HOURS;
    if (elapsedMs < nextThreshold) {
      return { threshold: nextThreshold, nextFee: (n + 1) * 5 };
    }
    return { threshold: (n + 1) * TWELVE_HOURS, nextFee: (n + 2) * 5 };
  }

  /* ========== Initialize ========== */
  function init() {
    loadData();
    loadBillingCycle();
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
    btnCalendar.addEventListener('click', showCalendarModal);
    btnEditTime.addEventListener('click', showEditModal);
    btnSaveTime.addEventListener('click', saveEditedTime);
    btnCancelEdit.addEventListener('click', hideEditModal);
    btnClearHistory.addEventListener('click', clearHistory);
    btnCancelCalendar.addEventListener('click', hideCalendarModal);

    if (btnEnableNotif) {
      btnEnableNotif.addEventListener('click', requestNotificationPermission);
    }
    if (btnDismissNotif) {
      btnDismissNotif.addEventListener('click', () => {
        notifBanner.classList.add('hidden');
        localStorage.setItem('notifDismissed', 'true');
      });
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        loadBillingCycle(); // refresh cycle status
        checkAndNotify();
        updateUI();
      }
    });

    timeEditModal.addEventListener('click', (e) => {
      if (e.target === timeEditModal) hideEditModal();
    });

    calendarModal.addEventListener('click', (e) => {
      if (e.target === calendarModal) hideCalendarModal();
    });
  }

  /* ========== Core Actions ========== */
  function startParking() {
    loadBillingCycle(); // check latest cycle
    parkingData = {
      parkTime: new Date().toISOString(),
      notifiedThresholds: [],
    };
    saveData();
    scheduleReminder();
    updateUI();
    vibrate(50);
  }

  function checkout() {
    if (!parkingData) return;

    const parkTimeMs = new Date(parkingData.parkTime).getTime();
    const now = Date.now();
    const duration = now - parkTimeMs;
    const fee = calculateFee(duration, parkTimeMs);

    // Save billing cycle if this session incurred a charge
    if (fee > 0) {
      // Determine the last active 12h cycle boundary
      const cycleEnd = getCycleEndMs();
      let effectiveStart;

      if (cycleEnd && parkTimeMs < cycleEnd) {
        // Session extended beyond previous cycle
        effectiveStart = cycleEnd;
      } else {
        effectiveStart = parkTimeMs;
      }

      const effectiveElapsed = now - effectiveStart;
      const numCycles = Math.ceil(effectiveElapsed / TWELVE_HOURS);
      const lastCycleStart = effectiveStart + (numCycles - 1) * TWELVE_HOURS;

      billingCycle = {
        cycleStart: new Date(lastCycleStart).toISOString(),
        cycleEnd: new Date(lastCycleStart + TWELVE_HOURS).toISOString(),
      };
      saveBillingCycle();
    }

    // Add to history
    const history = getHistory();
    history.unshift({
      parkTime: parkingData.parkTime,
      checkoutTime: new Date(now).toISOString(),
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

  /* ========== Calendar Export ========== */
  function showCalendarModal() {
    if (!parkingData) return;
    
    const parkTimeMs = new Date(parkingData.parkTime).getTime();
    const cycleEnd = getCycleEndMs();
    const now = Date.now();
    
    const thresholds = [];
    let baseTime = parkTimeMs;
    let feeBase = 0;
    
    if (cycleEnd && parkTimeMs < cycleEnd) {
      baseTime = cycleEnd;
    }
    
    // 1h threshold
    const t1 = baseTime + ONE_HOUR;
    if (t1 > now) thresholds.push({ time: t1, fee: feeBase + 5 });
    
    // 12h, 24h, 36h... thresholds
    let cycle = 1;
    while (thresholds.length < 2) {
      const t = baseTime + cycle * TWELVE_HOURS;
      if (t > now) thresholds.push({ time: t, fee: feeBase + (cycle + 1) * 5 });
      cycle++;
    }

    calendarOptions.innerHTML = '';
    thresholds.forEach(th => {
      const btn = document.createElement('button');
      btn.className = 'btn-calendar-option';
      
      const d = new Date(th.time);
      const today = new Date();
      const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth();
      const timeLabel = isToday ? `今天 ${formatTime(d)}` : `${d.getMonth() + 1}/${d.getDate()} ${formatTime(d)}`;
      
      btn.innerHTML = `📅 添加截止 ${timeLabel} 的加费提醒<br><small style="color:var(--text-sub);font-size:13px;margin-top:4px;display:inline-block;">(提醒此时加费至 ¥${th.fee})</small>`;
      btn.onclick = () => {
        addSingleEventToCalendar(th, parkTimeMs);
        hideCalendarModal();
      };
      calendarOptions.appendChild(btn);
    });
    
    calendarModal.classList.remove('hidden');
  }

  function hideCalendarModal() {
    calendarModal.classList.add('hidden');
  }

  function addSingleEventToCalendar(th, parkTimeMs) {
    const eventTimeMs = th.time;
    const startDate = new Date(eventTimeMs);
    const endDate = new Date(eventTimeMs + 15 * 60 * 1000); // 15 mins later
    
    const summary = `🅿️ 停车缴费提醒 (即将计费 ¥${th.fee})`;
    const description = `您的停车费即将增加到 ¥${th.fee}，请尽快缴费离场！`;

    const formatICSDate = (date) => {
      return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    };
    
    const uid = `parking-${parkTimeMs}-${eventTimeMs}@parking-reminder`;
    const dtstamp = formatICSDate(new Date());
    const dtstart = formatICSDate(startDate);
    const dtend = formatICSDate(endDate);
    
    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Parking Reminder//CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${dtstart}`,
      `DTEND:${dtend}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT10M', // 10 minutes before
      'ACTION:DISPLAY',
      `DESCRIPTION:${summary}`,
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const isAndroid = /Android/i.test(navigator.userAgent);
    
    if (isAndroid) {
      // Seamless Android Intent
      const intentUrl = `intent://#Intent;` +
        `action=android.intent.action.INSERT;` +
        `type=vnd.android.cursor.item/event;` +
        `S.title=${encodeURIComponent(summary)};` +
        `S.description=${encodeURIComponent(description)};` +
        `l.beginTime=${eventTimeMs};` +
        `l.endTime=${endDate.getTime()};` +
        `end;`;
        
      // Use an <a> tag to trigger intent, sometimes bypasses basic blocks
      const a = document.createElement('a');
      a.href = intentUrl;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Deep link fallback detection
      const start = Date.now();
      setTimeout(() => {
        // If document is hidden, intent successfully opened the Calendar app
        if (document.hidden) return; 
        
        // If we are still here, intent was blocked/ignored by the system/browser
        if (Date.now() - start < 1500) {
          const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const dl = document.createElement('a');
          dl.href = url;
          
          const timeLabel = `${new Date(eventTimeMs).getHours()}点${new Date(eventTimeMs).getMinutes()}分`;
          dl.download = `停车提醒_${timeLabel}.ics`;
          
          document.body.appendChild(dl);
          dl.click();
          document.body.removeChild(dl);
          URL.revokeObjectURL(url);
          
          alert('检测到您的系统或浏览器拦截了直接跳转 😅\n已为您自动下载备用日历文件，请在通知栏点击打开以导入提醒！');
        }
      }, 800);
    } else {
      // Seamless iOS/Universal approach
      window.location.href = 'data:text/calendar;charset=utf8,' + encodeURIComponent(icsContent);
    }
  }

  /* ========== Time Edit ========== */
  function showEditModal() {
    if (!parkingData) return;
    timeInput.value = toLocalISOString(new Date(parkingData.parkTime));
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
    parkingData.notifiedThresholds = [];
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
    const parkTimeMs = new Date(parkingData.parkTime).getTime();
    const now = Date.now();
    const elapsed = now - parkTimeMs;
    const currentFee = calculateFee(elapsed, parkTimeMs);
    const cycleEnd = getCycleEndMs();
    const inPaidCycle = cycleEnd && parkTimeMs < cycleEnd && now < cycleEnd;

    // Park time
    parkTimeEl.textContent = formatTime(new Date(parkingData.parkTime));

    // Elapsed
    const elapsedH = Math.floor(elapsed / 3600000);
    const elapsedM = Math.floor((elapsed % 3600000) / 60000);
    elapsedDisplayEl.textContent = `${elapsedH}h${pad(elapsedM)}m`;

    // Fee
    feeBadgeEl.textContent = currentFee === 0 ? '免费' : `¥${currentFee}`;
    feeBadgeEl.classList.toggle('overtime', currentFee >= 10);
    feeBadgeEl.classList.toggle('fee-free', currentFee === 0);

    // Billing cycle status banner
    if (inPaidCycle) {
      const cycleRemaining = cycleEnd - now;
      const expireTime = formatTime(new Date(cycleEnd));
      cycleStatusEl.classList.remove('hidden');
      cycleInfoEl.textContent = `上次缴费覆盖至 ${expireTime}，本次暂不计费`;

      // Countdown = time until cycle expires (then 1h free, then ¥5)
      countdownEl.textContent = formatDuration(cycleRemaining);
      countdownLabelEl.textContent = '缴费周期剩余';
      countdownDateEl.textContent = '周期结束后 1小时内免费';

      // Ring progress
      const totalCycleDuration = TWELVE_HOURS;
      const cycleElapsed = totalCycleDuration - cycleRemaining;
      const progress = cycleRemaining / totalCycleDuration;
      ringProgress.style.strokeDasharray = CIRCUMFERENCE;
      ringProgress.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);
      ringProgress.setAttribute('stroke', 'url(#grad-normal)');

      countdownEl.classList.remove('warning', 'urgent', 'overtime');
      document.body.classList.remove('urgent-pulse');
    } else {
      cycleStatusEl.classList.add('hidden');

      // Determine effective elapsed for threshold calc
      let effectiveElapsed = elapsed;
      if (cycleEnd && parkTimeMs < cycleEnd) {
        effectiveElapsed = now - cycleEnd;
      }

      const thresholdInfo = (cycleEnd && parkTimeMs < cycleEnd)
        ? getNextThreshold(elapsed, parkTimeMs)
        : getNextThresholdSimple(elapsed);
      const remaining = (thresholdInfo.threshold * 1) - elapsed;

      // Countdown
      countdownEl.textContent = formatDuration(Math.max(0, remaining));

      if (currentFee === 0 && !(cycleEnd && parkTimeMs < cycleEnd)) {
        countdownLabelEl.textContent = '免费时间剩余';
        countdownDateEl.textContent = `超时后费用: ¥${thresholdInfo.nextFee}`;
      } else {
        countdownLabelEl.textContent = '距离下次加费还有';
        countdownDateEl.textContent = `下次费用: ¥${thresholdInfo.nextFee}`;
      }

      // Ring & colors
      const periodDuration = (currentFee === 0 && effectiveElapsed < ONE_HOUR)
        ? ONE_HOUR : TWELVE_HOURS;
      const progress = Math.max(0, remaining) / periodDuration;
      ringProgress.style.strokeDasharray = CIRCUMFERENCE;
      ringProgress.style.strokeDashoffset = CIRCUMFERENCE * (1 - Math.min(1, progress));

      countdownEl.classList.remove('warning', 'urgent', 'overtime');
      document.body.classList.remove('urgent-pulse');

      if (remaining <= REMINDER_BEFORE && remaining > 0) {
        ringProgress.setAttribute('stroke', 'url(#grad-urgent)');
        countdownEl.classList.add('urgent');
        document.body.classList.add('urgent-pulse');
      } else if (remaining <= 30 * 60 * 1000 && remaining > 0) {
        ringProgress.setAttribute('stroke', 'url(#grad-warning)');
        countdownEl.classList.add('warning');
      } else {
        ringProgress.setAttribute('stroke', 'url(#grad-normal)');
      }
    }
  }

  function updateHistoryUI() {
    const history = getHistory();
    if (history.length === 0) {
      historyList.innerHTML = '<p class="empty-hint">暂无停车记录</p>';
      return;
    }
    historyList.innerHTML = history.slice(0, 20).map((item) => {
      const pt = new Date(item.parkTime);
      const ct = new Date(item.checkoutTime);
      const durH = Math.floor(item.duration / 3600000);
      const durM = Math.floor((item.duration % 3600000) / 60000);
      const dateStr = `${pt.getMonth() + 1}/${pt.getDate()}`;
      const feeClass = item.fee === 0 ? 'fee-5' : item.fee <= 5 ? 'fee-5' : 'fee-10';
      const feeText = item.fee === 0 ? '免费' : `¥${item.fee}`;
      return `
        <div class="history-item">
          <div class="history-info">
            <span class="history-date">${dateStr} ${formatTime(pt)} → ${formatTime(ct)}</span>
            <span class="history-duration">停车 ${durH}小时${durM}分钟</span>
          </div>
          <span class="history-fee ${feeClass}">${feeText}</span>
        </div>`;
    }).join('');
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
      if (perm === 'granted' && parkingData) scheduleReminder();
    });
  }

  function scheduleReminder() {
    clearTimeout(reminderTimeout);
    if (!parkingData) return;

    const parkTimeMs = new Date(parkingData.parkTime).getTime();
    const elapsed = Date.now() - parkTimeMs;
    const cycleEnd = getCycleEndMs();
    const inPaidCycle = cycleEnd && parkTimeMs < cycleEnd && Date.now() < cycleEnd;

    let nextThresholdMs;
    if (inPaidCycle) {
      // Next meaningful threshold: cycle end + 1h (when ¥5 would apply)
      nextThresholdMs = cycleEnd + ONE_HOUR;
    } else {
      const info = (cycleEnd && parkTimeMs < cycleEnd)
        ? getNextThreshold(elapsed, parkTimeMs)
        : getNextThresholdSimple(elapsed);
      nextThresholdMs = parkTimeMs + info.threshold;
    }

    const delay = nextThresholdMs - REMINDER_BEFORE - Date.now();
    if (delay > 0) {
      reminderTimeout = setTimeout(() => {
        sendNotification();
        scheduleReminder(); // schedule next
      }, delay);
    }
  }

  function checkAndNotify() {
    if (!parkingData) return;
    if (!parkingData.notifiedThresholds) parkingData.notifiedThresholds = [];

    const parkTimeMs = new Date(parkingData.parkTime).getTime();
    const elapsed = Date.now() - parkTimeMs;
    const cycleEnd = getCycleEndMs();
    const inPaidCycle = cycleEnd && parkTimeMs < cycleEnd && Date.now() < cycleEnd;

    if (inPaidCycle) return; // no fee upcoming while in paid cycle

    const info = (cycleEnd && parkTimeMs < cycleEnd)
      ? getNextThreshold(elapsed, parkTimeMs)
      : getNextThresholdSimple(elapsed);
    const remaining = info.threshold - elapsed;

    if (remaining <= REMINDER_BEFORE && remaining > 0) {
      const key = Math.round(info.threshold);
      if (!parkingData.notifiedThresholds.includes(key)) {
        sendNotification();
      }
    }
  }

  function sendNotification() {
    if (!parkingData) return;
    if (!parkingData.notifiedThresholds) parkingData.notifiedThresholds = [];

    const parkTimeMs = new Date(parkingData.parkTime).getTime();
    const elapsed = Date.now() - parkTimeMs;
    const cycleEnd = getCycleEndMs();

    const info = (cycleEnd && parkTimeMs < cycleEnd)
      ? getNextThreshold(elapsed, parkTimeMs)
      : getNextThresholdSimple(elapsed);

    const key = Math.round(info.threshold);
    if (parkingData.notifiedThresholds.includes(key)) return;
    parkingData.notifiedThresholds.push(key);
    saveData();

    vibrate([200, 100, 200, 100, 200]);

    const currentFee = calculateFee(elapsed, parkTimeMs);
    const body = currentFee === 0
      ? `免费时间即将结束，10分钟后开始计费 ¥${info.nextFee}，请尽快缴费离场！`
      : `停车费即将从 ¥${currentFee} 增加到 ¥${info.nextFee}，请尽快缴费离场！`;

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('🅿️ 停车缴费提醒', {
          body, icon: './icon-192.png',
          tag: 'parking-reminder-' + key, requireInteraction: true,
        });
      } catch (e) {
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then((reg) => {
            reg.showNotification('🅿️ 停车缴费提醒', {
              body, icon: './icon-192.png',
              tag: 'parking-reminder-' + key, requireInteraction: true,
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
      navigator.serviceWorker.register('./sw.js').catch(() => {});
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
      hour: '2-digit', minute: '2-digit', hour12: false,
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
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  /* ========== Boot ========== */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
