// PomoPal Planner (Val 2026-11-27): one page per day — Frog, Top 3, focus to-dos, journal,
// the day's timer sessions, and Focus for tomorrow (shown at the top of the next day).
// Planner notes are kept in this browser's IndexedDB only; they never go online.
// Every change saves on its own (half a second after typing stops, and when the tab is left).
(function initWebPlanner(globalScope) {
  const DB_NAME = 'pomopal-planner';
  const STORE = 'days';
  const SESSIONS_KEY = 'pomopal.web.sessions';
  const CARRY_DAYS = 7; // "Focus for tomorrow" is picked up from the last 7 days (Friday → Monday)

  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const dateOf = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const shiftDay = (key, by) => { const date = dateOf(key); date.setDate(date.getDate() + by); return dayKey(date); };

  function emptyDay(date) {
    return { date, frog: { text: '', done: false }, top3: [0, 1, 2].map(() => ({ text: '', done: false })), todos: [], journal: '', tomorrow: '' };
  }

  // Fills in anything missing, so older or partial days always open.
  function normaliseDay(day, date) {
    const base = emptyDay(date);
    if (!day || typeof day !== 'object') return base;
    const item = (x) => ({ text: String(x?.text || ''), done: Boolean(x?.done) });
    return {
      ...day,
      date,
      frog: item(day.frog),
      top3: [0, 1, 2].map((i) => item(day.top3?.[i])),
      todos: Array.isArray(day.todos) ? day.todos.map((t) => ({ ...item(t), id: String(t?.id || Math.random().toString(36).slice(2)) })) : [],
      journal: String(day.journal || ''),
      tomorrow: String(day.tomorrow || ''),
    };
  }

  function isEmptyDay(day) {
    const d = normaliseDay(day, day?.date || '');
    return !d.frog.text.trim() && d.top3.every((t) => !t.text.trim()) && d.todos.every((t) => !t.text.trim())
      && !d.journal.trim() && !d.tomorrow.trim();
  }

  // The latest "Focus for tomorrow" written on one of the 7 days before `date`.
  function carriedFocus(days, date) {
    for (let back = 1; back <= CARRY_DAYS; back += 1) {
      const key = shiftDay(date, -back);
      const day = days.find((d) => d?.date === key);
      if (day && String(day.tomorrow || '').trim()) return { from: key, text: day.tomorrow };
    }
    return null;
  }

  function sessionsOn(sessions, date) {
    return sessions.filter((s) => s && s.date === date)
      .sort((a, b) => String(a.completedAt || a.time).localeCompare(String(b.completedAt || b.time)));
  }

  function dayTitle(key, today) {
    if (key === today) return 'Today';
    if (key === shiftDay(today, -1)) return 'Yesterday';
    if (key === shiftDay(today, 1)) return 'Tomorrow';
    return dateOf(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  const fullDate = (key) => dateOf(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Storage: IndexedDB in the browser. `backend` = { get(date), put(day), all() }, all promises.
  function idbBackend(indexedDB) {
    const opened = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'date' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('blocked'));
    });
    const run = (mode, act) => opened.then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = act(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('not saved'));
    }));
    return {
      ready: opened.then(() => true),
      get: (date) => run('readonly', (s) => s.get(date)),
      put: (day) => run('readwrite', (s) => s.put(day)),
      all: () => run('readonly', (s) => s.getAll()),
    };
  }

  function memoryBackend() {
    const days = new Map();
    const copy = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
    return {
      ready: Promise.resolve(true),
      days,
      get: async (date) => copy(days.get(date)),
      put: async (day) => { days.set(day.date, copy(day)); },
      all: async () => [...days.values()].map(copy),
    };
  }

  const exportsObject = { dayKey, shiftDay, emptyDay, normaliseDay, isEmptyDay, carriedFocus, sessionsOn, dayTitle, idbBackend, memoryBackend };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObject;
  globalScope.PomoPlanner = exportsObject;

  // ---- The page ----
  const doc = globalScope.document;
  if (!doc || !doc.querySelector('.planner-page')) return;
  const $ = (selector) => doc.querySelector(selector);
  const log = globalScope.PomoWebLog;
  const notes = globalScope.PomoNotes;
  const el = (tag, attrs = {}, text) => {
    const node = doc.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // Same light/dark as the timer.
  const applyTheme = () => {
    let theme = 'light';
    try { theme = JSON.parse(globalScope.localStorage.getItem('pomopal.preferences') || '{}').theme === 'dark' ? 'dark' : 'light'; } catch { /* light */ }
    doc.documentElement.dataset.theme = theme;
  };
  applyTheme();

  let backend = globalScope.PomoPlannerTestBackend || null;
  if (!backend && globalScope.indexedDB) {
    try { backend = idbBackend(globalScope.indexedDB); } catch { backend = null; }
  }
  // Ask the browser to keep this site's data when space runs low.
  try { globalScope.navigator?.storage?.persist?.(); } catch { /* not offered */ }

  // Web links become clickable (new tab), in note views and in the journal when not typing.
  function linkify(box) {
    const walker = doc.createTreeWalker(box, globalScope.NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) if (!walker.currentNode.parentNode.closest('a')) texts.push(walker.currentNode);
    texts.forEach((node) => {
      const urls = log.linksIn(node.textContent);
      if (!urls.length) return;
      const parts = [];
      let rest = node.textContent;
      urls.forEach((url) => {
        const at = rest.indexOf(url);
        parts.push(rest.slice(0, at), el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url));
        rest = rest.slice(at + url.length);
      });
      parts.push(rest);
      node.replaceWith(...parts.filter((p) => p !== ''));
    });
    return box;
  }
  const showNote = (box, text) => { box.innerHTML = log.noteToHtml(text); linkify(box); }; // noteToHtml escapes the text

  const journal = notes.makeEditor($('#journal'));
  const tomorrow = notes.makeEditor($('#tomorrow'));
  [journal, tomorrow].forEach((editor) => {
    editor.addEventListener('blur', () => linkify(editor));
    // A click on a link opens it (a new tab); a click anywhere else is for typing.
    editor.addEventListener('click', (event) => {
      const a = event.target.closest?.('a[href]');
      if (!a) return;
      event.preventDefault();
      globalScope.open(a.href, '_blank', 'noopener');
    });
  });
  const channel = typeof globalScope.BroadcastChannel === 'function' ? new globalScope.BroadcastChannel('pomopal-planner') : null;

  let today = dayKey(new Date());
  let current = today;
  let day = emptyDay(current);
  let dirty = false;
  let timer = null;
  let broken = false;

  function problem(text) {
    broken = true;
    $('#store-problem').textContent = text;
    $('#store-problem').hidden = false;
    doc.querySelectorAll('.day input, .day [contenteditable], #add-todo').forEach((node) => {
      if (node.tagName === 'INPUT' || node.tagName === 'BUTTON') node.disabled = true; else node.setAttribute('contenteditable', 'false');
    });
  }

  function itemRow(item, { label, onRemove } = {}) {
    const row = el('div', { class: 'item' });
    const box = el('input', { type: 'checkbox', 'aria-label': `${label} done` });
    box.checked = item.done;
    const text = el('input', { type: 'text', class: 'line', 'aria-label': label });
    text.value = item.text;
    row.classList.toggle('done', item.done);
    box.addEventListener('change', () => { item.done = box.checked; row.classList.toggle('done', item.done); changed(); });
    text.addEventListener('input', () => { item.text = text.value; changed(); });
    row.append(box, text);
    if (onRemove) {
      const remove = el('button', { type: 'button', class: 'text-link remove', 'aria-label': `Remove ${label}` }, '×');
      remove.addEventListener('click', onRemove);
      row.append(remove);
    }
    return { row, text };
  }

  function renderTop3() {
    $('#top3').replaceChildren(...day.top3.map((item, i) => itemRow(item, { label: `Top ${i + 1}` }).row));
  }

  function renderTodos(focusLast = false) {
    const rows = day.todos.map((item, i) => {
      const { row, text } = itemRow(item, {
        label: `To-do ${i + 1}`,
        onRemove: () => { day.todos = day.todos.filter((t) => t !== item); renderTodos(); changed(); },
      });
      text.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); addTodo(); }
      });
      return { row, text };
    });
    $('#todos').replaceChildren(...rows.map((r) => r.row));
    if (focusLast && rows.length) rows[rows.length - 1].text.focus();
  }

  function addTodo() {
    day.todos.push({ id: Math.random().toString(36).slice(2), text: '', done: false });
    renderTodos(true);
    changed();
  }

  function readSessions() {
    try { return log.parseSessions(globalScope.localStorage.getItem(SESSIONS_KEY)); } catch { return []; }
  }

  function renderTime() {
    const list = sessionsOn(readSessions(), current);
    const box = $('#time-list');
    if (!list.length) { box.replaceChildren(el('p', { class: 'quiet' }, 'No timer sessions on this day.')); return; }
    const minutes = list.reduce((total, s) => total + (Number(s.durationMinutes) || 0), 0);
    const rows = list.map((s) => {
      const row = el('div', { class: 'session' });
      const head = el('p', { class: 'session-head' });
      head.append(
        el('span', { class: 't' }, String(s.time || '').slice(0, 5)),
        el('span', { class: 'a' }, s.activity || ''),
        el('span', { class: 'm' }, `${log.formatDuration(Number(s.durationMinutes) || 0)} · ${log.CATEGORIES[s.category] || ''}`),
      );
      row.append(head);
      if (s.note) {
        const note = el('div', { class: 'note-view session-note' });
        showNote(note, s.note);
        row.append(note);
      }
      return row;
    });
    box.replaceChildren(el('p', { class: 'total-line' }, `${log.formatDuration(minutes)} · ${list.length} ${list.length === 1 ? 'session' : 'sessions'}`), ...rows);
  }

  async function renderCarried() {
    let carried = null;
    try {
      const days = [];
      for (let back = 1; back <= CARRY_DAYS; back += 1) {
        const found = await backend.get(shiftDay(current, -back));
        if (found) days.push(found);
      }
      carried = carriedFocus(days, current);
    } catch { carried = null; }
    $('#carried').hidden = !carried;
    if (!carried) return;
    const when = dayTitle(carried.from, today);
    $('#carried-label').textContent = `Focus you set ${['Today', 'Yesterday'].includes(when) ? when.toLowerCase() : `on ${when}`}`;
    showNote($('#carried-text'), carried.text);
  }

  async function renderRecent() {
    let days = [];
    try { days = (await backend.all()).filter((d) => !isEmptyDay(d)); } catch { days = []; }
    days.sort((a, b) => b.date.localeCompare(a.date));
    $('#recent-days').replaceChildren(...days.slice(0, 14).map((d) => {
      const item = el('li');
      const go = el('button', { type: 'button', class: `text-link${d.date === current ? ' on' : ''}` }, dayTitle(d.date, today));
      go.addEventListener('click', () => openDay(d.date));
      item.append(go);
      return item;
    }));
  }

  function renderDay() {
    $('#day-title').textContent = dayTitle(current, today);
    $('#day-title').title = fullDate(current);
    doc.title = `Planner · ${dayTitle(current, today)}`;
    $('#frog-text').value = day.frog.text;
    $('#frog-done').checked = day.frog.done;
    $('.item.frog').classList.toggle('done', day.frog.done);
    renderTop3();
    renderTodos();
    journal.value = day.journal;
    tomorrow.value = day.tomorrow;
    linkify(journal);
    linkify(tomorrow);
    renderTime();
  }

  async function openDay(key) {
    await flush();
    current = key;
    let stored;
    try { stored = await backend.get(key); } catch { problem('Planner notes can\'t be opened in this browser right now. Nothing was changed.'); return; }
    day = normaliseDay(stored, key);
    dirty = false;
    renderDay();
    renderCarried();
    renderRecent();
    $('#save-state').textContent = '';
  }

  function changed() {
    if (broken) return;
    dirty = true;
    $('#save-state').textContent = 'Saving…';
    globalScope.clearTimeout(timer);
    timer = globalScope.setTimeout(flush, 500);
  }

  async function flush() {
    globalScope.clearTimeout(timer);
    if (!dirty || broken) return;
    day.journal = journal.value;
    day.tomorrow = tomorrow.value;
    const toSave = { ...day, updatedAt: new Date().toISOString() };
    dirty = false;
    try {
      await backend.put(JSON.parse(JSON.stringify(toSave)));
      $('#save-state').textContent = 'Saved';
      channel?.postMessage({ saved: toSave.date });
      renderRecent();
    } catch {
      dirty = true;
      $('#save-state').textContent = 'Not saved — this browser refused. Keep this tab open and try again.';
    }
  }

  $('#frog-text').addEventListener('input', () => { day.frog.text = $('#frog-text').value; changed(); });
  $('#frog-done').addEventListener('change', () => { day.frog.done = $('#frog-done').checked; $('.item.frog').classList.toggle('done', day.frog.done); changed(); });
  $('#add-todo').addEventListener('click', addTodo);
  [journal, tomorrow].forEach((editor) => editor.addEventListener('input', changed));
  $('#prev-day').addEventListener('click', () => openDay(shiftDay(current, -1)));
  $('#next-day').addEventListener('click', () => openDay(shiftDay(current, 1)));
  $('#go-today').addEventListener('click', () => openDay(dayKey(new Date())));

  // Leaving the tab or closing it saves straight away.
  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) { flush(); return; }
    applyTheme();
    renderTime();
    const now = dayKey(new Date());
    if (now !== today) { const wasToday = current === today; today = now; if (wasToday && !dirty) openDay(now); else renderDay(); }
  });
  globalScope.addEventListener('pagehide', () => { flush(); });
  // Closing the tab within half a second of typing: the browser asks first, so nothing is lost.
  globalScope.addEventListener('beforeunload', (event) => { if (dirty) { flush(); event.preventDefault(); event.returnValue = ''; } });
  // New timer sessions and theme changes from the timer tab show up here.
  globalScope.addEventListener('storage', (event) => {
    if (event.key === SESSIONS_KEY) renderTime();
    if (event.key === 'pomopal.preferences') applyTheme();
  });
  // Another Planner tab saved this day: show its version if nothing is being typed here.
  if (channel) channel.onmessage = (event) => {
    if (event.data?.saved === current && !dirty) openDay(current);
    else renderRecent();
  };

  if (!backend) {
    renderDay();
    problem('This browser can\'t keep planner notes (storage is switched off, e.g. a private window). Open PomoPal in a normal window.');
    return;
  }
  backend.ready.then(() => openDay(current)).catch(() => {
    renderDay();
    problem('This browser can\'t keep planner notes (storage is switched off, e.g. a private window). Open PomoPal in a normal window.');
  });
  // For tests: lets a check wait for the save that typing started.
  globalScope.PomoPlannerFlush = flush;
})(typeof window !== 'undefined' ? window : globalThis);
