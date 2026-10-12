const STORAGE_KEY = 'presenteData_v1';
const BLOCK_DURATION_MS = 15 * 60 * 1000;
const RING_CIRCUMFERENCE = 2 * Math.PI * 90;

let state = loadState();
let timerInterval = null;

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return { tasks: Array.isArray(d.tasks) ? d.tasks : [], activeTask: d.activeTask || null };
    }
  } catch (e) {}
  return { tasks: [], activeTask: null };
}

function loadState() {
  return readStored();
}

// Finished tasks are a set keyed by id: merging never drops one, whoever wrote last.
function mergeTasks(a, b) {
  const stamp = (t) => t.updatedAt || t.endedAt || 0;
  const byId = new Map();
  [...a, ...b].forEach((t) => {
    const cur = byId.get(t.id);
    if (!cur || stamp(t) > stamp(cur)) byId.set(t.id, t);
  });
  return [...byId.values()].sort((x, y) => y.endedAt - x.endedAt);
}

// Another window (or the installed app) may have archived tasks since this one loaded:
// merge with what is stored instead of overwriting it with this window's copy.
function saveState() {
  state.tasks = mergeTasks(readStored().tasks, state.tasks);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    setSyncStatus('Memoria del dispositivo piena: archivio salvato solo sul server.');
  }
}

/* ---------- Server archive ---------- */

let syncing = null;

function setSyncStatus(text) {
  const el = document.getElementById('sync-status');
  if (el) el.textContent = text;
}

function syncArchive() {
  if (syncing) return syncing;
  syncing = fetch('__api/archive', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tasks: readStored().tasks }),
  })
    .then((r) => {
      if (r.status === 401) throw new Error('auth');
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    })
    .then((body) => {
      state.activeTask = readStored().activeTask;
      state.tasks = body.tasks;
      saveState();
      setSyncStatus('Archivio salvato sul tuo account · ' + formatTime(Date.now()));
      if (screens.archive.classList.contains('active')) renderArchive();
    })
    .catch((e) => {
      setSyncStatus(e.message === 'auth'
        ? 'Sessione scaduta: ricarica e accedi per salvare sul tuo account.'
        : 'Offline: archivio salvato sul dispositivo, si sincronizza appena torni online.');
    })
    .finally(() => { syncing = null; });
  return syncing;
}

function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

const screens = {
  dashboard: document.getElementById('screen-dashboard'),
  running: document.getElementById('screen-running'),
  checkin: document.getElementById('screen-checkin'),
  closing: document.getElementById('screen-closing'),
  archive: document.getElementById('screen-archive'),
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function formatDay(ts) {
  if (isToday(ts)) return 'Oggi';
  return new Date(ts).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function isToday(ts) {
  const d = new Date(ts);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

/* ---------- Audio / haptics ---------- */

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.6);
    setTimeout(() => ctx.close(), 800);
  } catch (e) {}
}

function vibrate() {
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
}

/* ---------- Task lifecycle ---------- */

function startTask(title) {
  const now = Date.now();
  state.activeTask = {
    id: 'task_' + now,
    title: title || 'Task senza titolo',
    startedAt: now,
    blocks: [],
    currentBlockStart: now,
    currentBlockEnd: now + BLOCK_DURATION_MS,
  };
  saveState();
  showScreen('running');
  startTimerLoop();
}

function startTimerLoop() {
  stopTimerLoop();
  updateTimerDisplay();
  timerInterval = setInterval(updateTimerDisplay, 250);
}

function stopTimerLoop() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerDisplay() {
  const t = state.activeTask;
  if (!t) return;
  const now = Date.now();
  const remaining = t.currentBlockEnd - now;

  if (remaining <= 0) {
    stopTimerLoop();
    triggerCheckin();
    return;
  }

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  document.getElementById('timer-digital').textContent =
    `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  document.getElementById('running-task-title').textContent = t.title;
  document.getElementById('block-counter').textContent = `Blocco ${t.blocks.length + 1}`;

  const fraction = 1 - remaining / BLOCK_DURATION_MS;
  const ring = document.getElementById('ring-progress');
  ring.style.strokeDasharray = RING_CIRCUMFERENCE;
  ring.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - fraction);
}

function triggerCheckin() {
  playChime();
  vibrate();
  document.getElementById('checkin-note').value = '';
  showScreen('checkin');
  setTimeout(() => document.getElementById('checkin-note').focus(), 50);
}

function handleAvanti() {
  const t = state.activeTask;
  if (!t) return;
  const note = document.getElementById('checkin-note').value.trim();
  t.blocks.push({
    startedAt: t.currentBlockStart,
    endedAt: t.currentBlockEnd,
    note,
  });
  const now = Date.now();
  t.currentBlockStart = now;
  t.currentBlockEnd = now + BLOCK_DURATION_MS;
  saveState();
  showScreen('running');
  startTimerLoop();
}

function handleObiettivo() {
  const t = state.activeTask;
  if (!t) return;
  const note = document.getElementById('checkin-note').value.trim();
  t.blocks.push({
    startedAt: t.currentBlockStart,
    endedAt: t.currentBlockEnd,
    note,
  });
  saveState();
  document.getElementById('closing-note').value = '';
  showScreen('closing');
  setTimeout(() => document.getElementById('closing-note').focus(), 50);
}

function handleConfirmArchive() {
  const t = state.activeTask;
  if (!t) return;
  const finalNote = document.getElementById('closing-note').value.trim();
  const now = Date.now();
  const completedTask = {
    id: t.id,
    title: t.title,
    startedAt: t.startedAt,
    endedAt: now,
    blocks: t.blocks,
    finalNote,
    completed: true,
  };
  state.tasks.unshift(completedTask);
  state.activeTask = null;
  saveState();
  showScreen('dashboard');
  syncArchive();
}

/* ---------- Archive ---------- */

function renderArchive() {
  const todayTasks = state.tasks.filter(t => isToday(t.startedAt) || isToday(t.endedAt));
  let totalMs = 0;
  let totalBlocks = 0;
  state.tasks.forEach(t => {
    t.blocks.forEach(b => {
      if (isToday(b.startedAt)) {
        totalMs += b.endedAt - b.startedAt;
        totalBlocks++;
      }
    });
  });

  const hours = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  document.getElementById('stat-hours').textContent = `${hours}h ${mins}m`;
  document.getElementById('stat-tasks').textContent = String(todayTasks.length);
  document.getElementById('stat-blocks').textContent = String(totalBlocks);

  const listEl = document.getElementById('task-list');
  listEl.innerHTML = '';

  if (state.tasks.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Nessun task ancora. Inizia il primo!</div>';
    return;
  }

  let lastDay = '';
  state.tasks.forEach(t => {
    const day = formatDay(t.endedAt);
    if (day !== lastDay) {
      lastDay = day;
      const h = document.createElement('div');
      h.className = 'day-header';
      h.textContent = day;
      listEl.appendChild(h);
    }
    const durationMs = t.endedAt - t.startedAt;
    const durMins = Math.round(durationMs / 60000);

    const card = document.createElement('div');
    card.className = 'task-card';

    const header = document.createElement('div');
    header.className = 'task-card-header';
    header.innerHTML = `
      <div class="task-card-title">${escapeHtml(t.title)}</div>
      <div class="task-card-meta">${formatTime(t.startedAt)} &rarr; ${formatTime(t.endedAt)} &middot; ${durMins} min</div>
    `;

    const detail = document.createElement('div');
    detail.className = 'task-card-detail hidden';
    detail.innerHTML = `
      ${t.blocks.map((b, i) => `
        <div class="block-log">
          <div class="block-log-header">Blocco ${i + 1} &middot; ${formatTime(b.startedAt)} &rarr; ${formatTime(b.endedAt)}</div>
          <div class="block-log-note">${escapeHtml(b.note || '(nessuna nota)')}</div>
        </div>
      `).join('')}
      ${t.finalNote ? `<div class="final-note"><strong>Note finali:</strong> ${escapeHtml(t.finalNote)}</div>` : ''}
    `;

    header.addEventListener('click', () => {
      detail.classList.toggle('hidden');
    });

    card.appendChild(header);
    card.appendChild(detail);
    listEl.appendChild(card);
  });
}

// A copy the user holds, outside the browser and outside the account.
function exportArchive() {
  const data = JSON.stringify({ exportedAt: new Date().toISOString(), tasks: readStored().tasks }, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = 'presente-archivio-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Wiring ---------- */

function wireEvents() {
  document.getElementById('btn-start-task').addEventListener('click', () => {
    document.getElementById('input-task-title').value = '';
    document.getElementById('overlay-quickstart').classList.remove('hidden');
    setTimeout(() => document.getElementById('input-task-title').focus(), 50);
  });

  document.getElementById('btn-cancel-quickstart').addEventListener('click', () => {
    document.getElementById('overlay-quickstart').classList.add('hidden');
  });

  document.getElementById('form-quickstart').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('input-task-title').value.trim();
    document.getElementById('overlay-quickstart').classList.add('hidden');
    startTask(title);
  });

  document.getElementById('btn-archive').addEventListener('click', () => {
    state = loadState();
    renderArchive();
    showScreen('archive');
    syncArchive();
  });

  document.getElementById('btn-export').addEventListener('click', exportArchive);

  document.getElementById('btn-back-dashboard').addEventListener('click', () => {
    showScreen('dashboard');
  });

  document.getElementById('btn-avanti').addEventListener('click', handleAvanti);
  document.getElementById('btn-obiettivo').addEventListener('click', handleObiettivo);
  document.getElementById('btn-confirm-archive').addEventListener('click', handleConfirmArchive);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resume();
  });
  window.addEventListener('online', () => syncArchive());
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && screens.archive.classList.contains('active')) {
      state = loadState();
      renderArchive();
    }
  });
}

// Coming back to the app: the stored state is the truth, never this window's memory of it.
function resume() {
  state = loadState();
  const onArchive = screens.archive.classList.contains('active');
  const editing = screens.checkin.classList.contains('active') || screens.closing.classList.contains('active');
  if (!editing || !state.activeTask) {
    if (state.activeTask) {
      if (Date.now() >= state.activeTask.currentBlockEnd) triggerCheckin();
      else { showScreen('running'); startTimerLoop(); }
    } else if (onArchive) {
      renderArchive();
    } else {
      stopTimerLoop();
      showScreen('dashboard');
    }
  }
  syncArchive();
}

/* ---------- Install toast ---------- */

const INSTALL_SNOOZE_KEY = 'presenteInstallSnooze';
const INSTALL_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
let installPrompt = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function installSnoozed() {
  try { return Date.now() < Number(localStorage.getItem(INSTALL_SNOOZE_KEY) || 0); } catch (e) { return false; }
}

// Browsers without an install prompt still install the app: tell each one where its own button is.
function manualInstallHint() {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) return `Tocca ${SHARE_ICON} <b>Condividi</b>, poi <b>Aggiungi alla schermata Home</b>.`;
  if (/Android/.test(ua)) {
    if (/Firefox/.test(ua)) return 'Apri il menu <b>&#8942;</b> e scegli <b>Installa</b>.';
    return 'Apri il menu <b>&#8942;</b> e scegli <b>Installa app</b> o <b>Aggiungi a schermata Home</b>.';
  }
  const safariMac = /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(ua);
  if (safariMac) return `Menu <b>File</b> &rarr; <b>Aggiungi al Dock</b>, oppure ${SHARE_ICON} &rarr; <b>Aggiungi al Dock</b>.`;
  return null; // desktop Chromium offers its own prompt; desktop Firefox cannot install
}

function showInstallToast(hint) {
  if (isStandalone() || installSnoozed()) return;
  const hintEl = document.getElementById('install-hint');
  const btn = document.getElementById('btn-install');
  if (installPrompt) {
    hintEl.textContent = 'A tutto schermo, anche offline.';
    btn.classList.remove('hidden');
  } else if (hint) {
    hintEl.innerHTML = hint;
    btn.classList.add('hidden');
  } else {
    return;
  }
  document.getElementById('install-toast').classList.remove('hidden');
}

function hideInstallToast(snooze) {
  document.getElementById('install-toast').classList.add('hidden');
  if (snooze) {
    try { localStorage.setItem(INSTALL_SNOOZE_KEY, String(Date.now() + INSTALL_SNOOZE_MS)); } catch (e) {}
  }
}

function setupInstallToast() {
  if (isStandalone()) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    showInstallToast();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    hideInstallToast(false);
  });
  document.getElementById('btn-install').addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    prompt.prompt();
    const { outcome } = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    hideInstallToast(outcome !== 'accepted');
  });
  document.getElementById('btn-install-close').addEventListener('click', () => hideInstallToast(true));
  // Give the native prompt a moment to arrive before falling back to written steps.
  setTimeout(() => { if (!installPrompt) showInstallToast(manualInstallHint()); }, 2500);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function init() {
  registerServiceWorker();
  setupInstallToast();
  requestPersistentStorage();
  wireEvents();
  syncArchive();

  if (state.activeTask) {
    const now = Date.now();
    if (now >= state.activeTask.currentBlockEnd) {
      triggerCheckin();
    } else {
      showScreen('running');
      startTimerLoop();
    }
  } else {
    showScreen('dashboard');
  }
}

init();
