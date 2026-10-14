const STORAGE_KEY = 'presenteData_v1';
const BLOCK_DURATION_MS = 15 * 60 * 1000; // tasks started before durations were chosen
const MIN_DURATION_MIN = 1;
const MAX_DURATION_MIN = 180;
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

// A deleted task stays in the set as a tombstone: newer than the task, so every merge
// (this window, other devices, the server) drops the task instead of bringing it back.
const live = (tasks) => tasks.filter((t) => !t.deleted);

function deleteTasks(ids) {
  const gone = new Set(ids);
  const now = Date.now();
  state.tasks = state.tasks.map((t) => (gone.has(t.id) && !t.deleted
    ? { id: t.id, startedAt: t.startedAt, endedAt: t.endedAt, blocks: [], deleted: true, updatedAt: now }
    : t));
  saveState();
  renderArchive();
  syncArchive();
}

// Destructive buttons take two taps: the first arms the button for 3 s and says what the second does.
function armable(btn, armedLabel, onConfirm) {
  const label = btn.innerHTML;
  let timer = null;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (btn.disabled) return;
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = typeof armedLabel === 'function' ? armedLabel() : armedLabel;
      timer = setTimeout(() => { btn.classList.remove('armed'); btn.innerHTML = label; }, 3000);
      return;
    }
    clearTimeout(timer);
    btn.classList.remove('armed');
    btn.innerHTML = label;
    onConfirm();
  });
}

/* ---------- Selection (archive) ---------- */

let selecting = false;
const selected = new Set();

function setSelecting(on) {
  selecting = on;
  selected.clear();
  renderArchive();
}

function updateSelectionBar() {
  const tasks = live(state.tasks);
  const n = selected.size;
  document.getElementById('select-count').textContent = n === 1 ? '1 selezionato' : n + ' selezionati';
  const all = tasks.length > 0 && tasks.every((t) => selected.has(t.id));
  document.getElementById('btn-select-all').textContent = all ? 'Deseleziona tutto' : 'Seleziona tutto';
  const del = document.getElementById('btn-delete-selected');
  del.disabled = n === 0;
  if (!del.classList.contains('armed')) del.textContent = 'Elimina';
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

function blockMs(t) {
  return t.blockDurationMs || BLOCK_DURATION_MS;
}

function startTask(title, minutes) {
  const now = Date.now();
  const durationMs = minutes * 60000;
  state.activeTask = {
    id: 'task_' + now,
    title: title || 'Task senza titolo',
    startedAt: now,
    blocks: [],
    blockDurationMs: durationMs,
    currentBlockStart: now,
    currentBlockEnd: now + durationMs,
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

  const totalSecs = Math.ceil(remaining / 1000);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const mmss = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  document.getElementById('timer-digital').textContent = hrs ? `${hrs}:${mmss}` : mmss;
  document.getElementById('running-task-title').textContent = t.title;
  document.getElementById('block-counter').textContent = `Blocco ${t.blocks.length + 1}`;

  const fraction = 1 - remaining / (t.currentBlockEnd - t.currentBlockStart);
  const ring = document.getElementById('ring-progress');
  ring.style.strokeDasharray = RING_CIRCUMFERENCE;
  ring.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - fraction);
}

function triggerCheckin() {
  const t = state.activeTask;
  if (t && !t.endedEarly) {
    playChime();
    vibrate();
  }
  const mins = t ? Math.max(1, Math.round((t.currentBlockEnd - t.currentBlockStart) / 60000)) : 0;
  document.getElementById('checkin-question').textContent = t && t.endedEarly
    ? `Chiuso prima (${mins} min). Cosa hai fatto? Perché? Come?`
    : `Cosa hai fatto in questi ${mins} min? Perché? Come?`;
  // Ended early means the task is done: only the close path is offered.
  document.getElementById('btn-avanti').classList.toggle('hidden', !!(t && t.endedEarly));
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
  t.currentBlockEnd = now + blockMs(t);
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
    blockDurationMs: blockMs(t),
    endedEarly: !!t.endedEarly,
    finalNote,
    completed: true,
  };
  state.tasks.unshift(completedTask);
  state.activeTask = null;
  saveState();
  showScreen('dashboard');
  syncArchive();
}

// Two taps, so a stray touch never ends the block: the first arms the button for 3 s.
let finishArmTimer = null;

function handleFinishEarly() {
  const t = state.activeTask;
  const btn = document.getElementById('btn-finish-early');
  if (!t) return;
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed');
    btn.textContent = 'Tocca di nuovo per chiudere';
    finishArmTimer = setTimeout(disarmFinish, 3000);
    return;
  }
  disarmFinish();
  stopTimerLoop();
  t.currentBlockEnd = Math.min(Date.now(), t.currentBlockEnd);
  t.endedEarly = true;
  saveState();
  triggerCheckin();
}

function disarmFinish() {
  clearTimeout(finishArmTimer);
  const btn = document.getElementById('btn-finish-early');
  btn.classList.remove('armed');
  btn.innerHTML = 'Ho finito &middot; chiudi il timer';
}

/* ---------- Duration step ---------- */

function showQuickstartStep(step) {
  document.getElementById('form-quickstart').classList.toggle('hidden', step !== 'title');
  document.getElementById('form-duration').classList.toggle('hidden', step !== 'duration');
  const focusId = step === 'title' ? 'input-task-title' : 'input-duration';
  setTimeout(() => document.getElementById(focusId).focus(), 50);
}

/* ---------- Archive ---------- */

function renderArchive() {
  const tasks = live(state.tasks);
  const todayTasks = tasks.filter(t => isToday(t.startedAt) || isToday(t.endedAt));
  let totalMs = 0;
  let totalBlocks = 0;
  tasks.forEach(t => {
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
  listEl.classList.toggle('selecting', selecting);
  document.getElementById('select-bar').classList.toggle('hidden', !selecting);
  document.getElementById('btn-select').textContent = selecting ? 'Fine' : 'Seleziona';
  document.getElementById('btn-select').classList.toggle('hidden', tasks.length === 0 && !selecting);
  [...selected].forEach((id) => { if (!tasks.some((t) => t.id === id)) selected.delete(id); });
  updateSelectionBar();

  if (tasks.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Nessun task ancora. Inizia il primo!</div>';
    return;
  }

  let lastDay = '';
  tasks.forEach(t => {
    const day = formatDay(t.endedAt);
    if (day !== lastDay) {
      lastDay = day;
      const h = document.createElement('div');
      h.className = 'day-header';
      h.textContent = day;
      listEl.appendChild(h);
    }
    const durMins = Math.round((t.endedAt - t.startedAt) / 60000);

    const card = document.createElement('div');
    card.className = 'task-card' + (selected.has(t.id) ? ' selected' : '');

    const header = document.createElement('div');
    header.className = 'task-card-header';
    header.innerHTML = `
      <span class="task-check" aria-hidden="true"></span>
      <div class="task-card-main">
        <div class="task-card-title">${escapeHtml(t.title)}</div>
        <div class="task-card-meta">${formatTime(t.startedAt)} &rarr; ${formatTime(t.endedAt)} &middot; ${durMins} min</div>
      </div>
      <button class="btn-x" aria-label="Elimina task">&times;</button>
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

    armable(header.querySelector('.btn-x'), 'Elimina?', () => deleteTasks([t.id]));

    // Tap the card: open or close it. While selecting, the tap picks it instead.
    header.addEventListener('click', () => {
      if (selecting) {
        if (selected.has(t.id)) selected.delete(t.id); else selected.add(t.id);
        card.classList.toggle('selected', selected.has(t.id));
        updateSelectionBar();
        return;
      }
      detail.classList.toggle('hidden');
      card.classList.toggle('open', !detail.classList.contains('hidden'));
    });

    card.appendChild(header);
    card.appendChild(detail);
    listEl.appendChild(card);
  });
}

// A copy the user holds, outside the browser and outside the account.
function exportArchive() {
  const data = JSON.stringify({ exportedAt: new Date().toISOString(), tasks: live(readStored().tasks) }, null, 2);
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
    showQuickstartStep('title');
  });

  document.getElementById('btn-cancel-quickstart').addEventListener('click', () => {
    document.getElementById('overlay-quickstart').classList.add('hidden');
  });

  // Step 1: name the task, Enter. Step 2: choose how long the timer runs.
  document.getElementById('form-quickstart').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('input-task-title').value.trim();
    document.getElementById('duration-task-title').textContent = title || 'Task senza titolo';
    document.getElementById('input-duration').value = String(BLOCK_DURATION_MS / 60000);
    showQuickstartStep('duration');
  });

  // One tap selects the 15, so typing replaces it.
  document.getElementById('input-duration').addEventListener('focus', (e) => e.target.select());

  document.getElementById('btn-back-duration').addEventListener('click', () => showQuickstartStep('title'));

  document.getElementById('form-duration').addEventListener('submit', (e) => {
    e.preventDefault();
    const minutes = Number(document.getElementById('input-duration').value);
    if (!Number.isInteger(minutes) || minutes < MIN_DURATION_MIN || minutes > MAX_DURATION_MIN) {
      document.getElementById('input-duration').reportValidity();
      return;
    }
    const title = document.getElementById('input-task-title').value.trim();
    document.getElementById('overlay-quickstart').classList.add('hidden');
    startTask(title, minutes);
  });

  document.getElementById('btn-finish-early').addEventListener('click', handleFinishEarly);

  document.getElementById('btn-archive').addEventListener('click', () => {
    state = loadState();
    renderArchive();
    showScreen('archive');
    syncArchive();
  });

  document.getElementById('btn-export').addEventListener('click', exportArchive);

  document.getElementById('btn-back-dashboard').addEventListener('click', () => {
    selecting = false;
    selected.clear();
    showScreen('dashboard');
  });

  document.getElementById('btn-select').addEventListener('click', () => setSelecting(!selecting));
  document.getElementById('btn-select-all').addEventListener('click', () => {
    const tasks = live(state.tasks);
    const all = tasks.every((t) => selected.has(t.id));
    selected.clear();
    if (!all) tasks.forEach((t) => selected.add(t.id));
    renderArchive();
  });
  armable(document.getElementById('btn-delete-selected'),
    () => (selected.size === 1 ? 'Elimina 1 task?' : 'Elimina ' + selected.size + ' task?'),
    () => { const ids = [...selected]; selecting = false; selected.clear(); deleteTasks(ids); });

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

function init() {
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
