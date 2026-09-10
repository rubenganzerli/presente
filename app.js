const STORAGE_KEY = 'presenteData_v1';
const BLOCK_DURATION_MS = 15 * 60 * 1000;
const RING_CIRCUMFERENCE = 2 * Math.PI * 90;

let state = loadState();
let timerInterval = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { tasks: [], activeTask: null };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

  state.tasks.forEach(t => {
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
    renderArchive();
    showScreen('archive');
  });

  document.getElementById('btn-back-dashboard').addEventListener('click', () => {
    showScreen('dashboard');
  });

  document.getElementById('btn-avanti').addEventListener('click', handleAvanti);
  document.getElementById('btn-obiettivo').addEventListener('click', handleObiettivo);
  document.getElementById('btn-confirm-archive').addEventListener('click', handleConfirmArchive);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.activeTask) {
      updateTimerDisplay();
    }
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function init() {
  registerServiceWorker();
  wireEvents();

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
