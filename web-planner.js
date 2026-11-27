// PomoPal Planner (Val 2026-11-27): one page per day — Frog, Top 3, focus to-dos, journal
// entries (several a day, with screenshots), the day's timer sessions, and Focus for tomorrow
// (shown at the top of the next day).
// Planner notes are kept in this browser's IndexedDB only; they never go online.
// Every change saves on its own (half a second after typing stops, and when the tab is left).
(function initWebPlanner(globalScope) {
  const DB_NAME = 'pomopal-planner';
  const STORE = 'days';
  const IMAGES = 'images';
  const SETTINGS = 'settings';
  const BACKUP_DIR = 'PomoPal backup';
  const fileNameFor = (date) => `${date} Daily Note.docx`;
  const IMAGE_LINE = /^!\[screenshot\]\(pomopal-image:([\w-]+)\)$/;
  const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const SESSIONS_KEY = 'pomopal.web.sessions';
  const CARRY_DAYS = 7; // "Focus for tomorrow" is picked up from the last 7 days (Friday → Monday)

  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const dateOf = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const shiftDay = (key, by) => { const date = dateOf(key); date.setDate(date.getDate() + by); return dayKey(date); };

  function emptyDay(date) {
    return { date, frog: { text: '', done: false }, top3: [0, 1, 2].map(() => ({ text: '', done: false })), todos: [], entries: [], tomorrow: '' };
  }

  // Fills in anything missing, so older or partial days always open.
  function normaliseDay(day, date) {
    const base = emptyDay(date);
    if (!day || typeof day !== 'object') return base;
    const item = (x) => ({ text: String(x?.text || ''), done: Boolean(x?.done) });
    const entry = (x) => ({ ...x, id: String(x?.id || newId()), title: String(x?.title || ''), text: String(x?.text || ''), at: String(x?.at || '') });
    let entries = Array.isArray(day.entries) ? day.entries.map(entry) : [];
    // Days saved before entries existed (one journal box): that journal becomes the first entry.
    if (!Array.isArray(day.entries) && String(day.journal || '').trim()) entries = [entry({ id: `${date}-journal`, text: day.journal, at: day.updatedAt })];
    const { journal, ...rest } = day;
    return {
      ...rest,
      date,
      frog: item(day.frog),
      top3: [0, 1, 2].map((i) => item(day.top3?.[i])),
      todos: Array.isArray(day.todos) ? day.todos.map((t) => ({ ...item(t), id: String(t?.id || Math.random().toString(36).slice(2)) })) : [],
      entries,
      tomorrow: String(day.tomorrow || ''),
    };
  }

  const blankEntry = (e) => !String(e?.title || '').trim() && !String(e?.text || '').trim();
  const imagesIn = (text) => String(text || '').split('\n').map((l) => IMAGE_LINE.exec(l.trim())?.[1]).filter(Boolean);

  function isEmptyDay(day) {
    const d = normaliseDay(day, day?.date || '');
    return !d.frog.text.trim() && d.top3.every((t) => !t.text.trim()) && d.todos.every((t) => !t.text.trim())
      && d.entries.every(blankEntry) && !d.tomorrow.trim();
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

  // A day for its Word file: what it holds, in the order of the page.
  function daySections(day, sessions, images = {}) {
    const d = normaliseDay(day, day?.date || '');
    const tick = (item) => `${item.done ? '☑' : '☐'} ${item.text.trim()}`;
    const sections = [];
    if (d.frog.text.trim()) sections.push({ heading: 'Frog', blocks: [{ text: tick(d.frog) }] });
    const top = d.top3.filter((t) => t.text.trim());
    if (top.length) sections.push({ heading: 'Top 3', blocks: top.map((t) => ({ text: tick(t) })) });
    const todos = d.todos.filter((t) => t.text.trim());
    if (todos.length) sections.push({ heading: 'Focus to-dos', blocks: todos.map((t) => ({ text: tick(t) })) });
    const entries = d.entries.filter((e) => !blankEntry(e));
    if (entries.length) {
      sections.push({ heading: 'Journal', blocks: [] });
      entries.forEach((e) => {
        const at = new Date(e.at);
        const time = Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        sections.push({ heading: e.title.trim() || `Entry${time ? ` ${time}` : ''}`, level: 2, blocks: [{ note: e.text, images }] });
      });
    }
    const list = sessionsOn(sessions || [], d.date);
    if (list.length) {
      const minutes = list.reduce((n, x) => n + (Number(x.durationMinutes) || 0), 0);
      const blocks = [{ text: `Total ${minutes} min · ${list.length} ${list.length === 1 ? 'session' : 'sessions'}` }];
      list.forEach((x) => {
        blocks.push({ text: `**${String(x.time || '').slice(0, 5)} ${x.activity || ''}** · ${Number(x.durationMinutes) || 0} min · ${x.category === 'personal' ? 'Personal' : 'Work'}` });
        if (String(x.note || '').trim()) blocks.push({ note: x.note });
      });
      sections.push({ heading: 'Time', blocks });
    }
    if (d.tomorrow.trim()) sections.push({ heading: 'Focus for tomorrow', blocks: [{ note: d.tomorrow }] });
    return { title: `Daily Note — ${fullDate(d.date)}`, sections };
  }

  // Storage: IndexedDB in the browser. `backend` = { get(date), put(day), all(), putImage(image),
  // getImage(id) }, all promises. Screenshots are kept apart from the days, by id.
  function idbBackend(indexedDB, { onBlocked = () => {} } = {}) {
    const opened = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'date' });
        if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close(); // a newer PomoPal tab can update the storage
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      // An older Planner tab is still open: the update waits for it (nothing is lost meanwhile).
      request.onblocked = () => onBlocked();
    });
    const run = (mode, act, store = STORE) => opened.then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = act(tx.objectStore(store));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('not saved'));
    }));
    return {
      ready: opened.then(() => true),
      get: (date) => run('readonly', (s) => s.get(date)),
      put: (day) => run('readwrite', (s) => s.put(day)),
      all: () => run('readonly', (s) => s.getAll()),
      putImage: (image) => run('readwrite', (s) => s.put(image), IMAGES),
      getImage: (id) => run('readonly', (s) => s.get(id), IMAGES),
      getSetting: (key) => run('readonly', (s) => s.get(key), SETTINGS).then((row) => row?.value),
      putSetting: (key, value) => run('readwrite', (s) => s.put({ key, value }), SETTINGS),
    };
  }

  function memoryBackend() {
    const days = new Map();
    const images = new Map();
    const settings = new Map(); // kept as is: a folder handle can't be copied as text
    const copy = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
    return {
      ready: Promise.resolve(true),
      days,
      get: async (date) => copy(days.get(date)),
      put: async (day) => { days.set(day.date, copy(day)); },
      all: async () => [...days.values()].map(copy),
      images,
      putImage: async (image) => { images.set(image.id, copy(image)); },
      getImage: async (id) => copy(images.get(id)),
      settings,
      getSetting: async (key) => settings.get(key),
      putSetting: async (key, value) => { settings.set(key, value); },
    };
  }

  const exportsObject = { dayKey, shiftDay, emptyDay, normaliseDay, isEmptyDay, carriedFocus, sessionsOn, dayTitle, imagesIn, IMAGE_LINE, daySections, fileNameFor, BACKUP_DIR, idbBackend, memoryBackend };
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
    try {
      backend = idbBackend(globalScope.indexedDB, {
        onBlocked: () => {
          $('#store-problem').textContent = 'PomoPal was updated: close the other Planner tabs, and this one opens.';
          $('#store-problem').hidden = false;
        },
      });
    } catch { backend = null; }
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

  function linkable(editor) {
    editor.addEventListener('blur', () => linkify(editor));
    // A click on a link opens it (a new tab); a click anywhere else is for typing.
    editor.addEventListener('click', (event) => {
      const a = event.target.closest?.('a[href]');
      if (!a) return;
      event.preventDefault();
      globalScope.open(a.href, '_blank', 'noopener');
    });
    return editor;
  }
  const tomorrow = linkable(notes.makeEditor($('#tomorrow')));

  // Screenshots: the lines ![screenshot](pomopal-image:<id>) show as the picture.
  function imageBlock(id) {
    const wrap = el('div', { class: 'shot' });
    const img = el('img', { 'data-img': id, alt: 'Screenshot' });
    wrap.append(img);
    backend?.getImage(id).then((image) => {
      if (image?.dataUrl) img.src = image.dataUrl;
      else img.alt = 'Screenshot not found in this browser';
    }).catch(() => { img.alt = 'Screenshot could not be opened'; });
    return wrap;
  }
  function showImages(editor) {
    [...editor.children].forEach((line) => {
      const id = IMAGE_LINE.exec(line.textContent.trim())?.[1];
      if (id && !line.querySelector('img')) line.replaceWith(imageBlock(id));
    });
  }
  const readAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new globalScope.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  function imageFiles(data) {
    const files = [...(data?.files || [])];
    if (!files.length) [...(data?.items || [])].forEach((i) => { if (i.kind === 'file') { const f = i.getAsFile(); if (f) files.push(f); } });
    return files.filter((f) => /^image\//.test(f.type));
  }
  // The picture is saved first; only then does its line go into the entry, so an entry
  // never points to a picture that wasn't kept.
  async function addImages(editor, files) {
    const selection = doc.getSelection?.();
    let range = selection && selection.rangeCount && editor.contains(selection.anchorNode) ? selection.getRangeAt(0) : null;
    for (const file of files) {
      const id = newId();
      try {
        await backend.putImage({ id, type: file.type, dataUrl: await readAsDataUrl(file), at: new Date().toISOString(), day: current });
      } catch {
        $('#save-state').textContent = 'Screenshot not saved — this browser refused it.';
        return;
      }
      const block = imageBlock(id);
      const line = range ? [...editor.children].find((child) => child.contains(range.startContainer)) : null;
      if (line) line.after(block); else editor.append(block);
      if (!block.nextSibling) block.after(el('div', {}, '')); // a line to keep typing under the picture
      range = null;
      editor.dispatchEvent(new globalScope.Event('input', { bubbles: true }));
    }
  }

  // ---- Journal entries (several a day, Val 2026-11-27) ----
  const editors = new Map(); // entry id → its editor
  const openEntries = new Set();

  function entryPreview(entry) {
    const first = String(entry.text || '').split('\n').map((l) => (IMAGE_LINE.test(l.trim()) ? '[screenshot]' : log.noteToPlain(l).trim())).find(Boolean);
    return first || '';
  }
  const timeOf = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

  function entryCard(entry) {
    const card = el('article', { class: 'entry-card', 'data-entry': entry.id });
    const head = el('div', { class: 'entry-head' });
    const title = el('input', { type: 'text', class: 'entry-title', placeholder: 'Title (optional)', 'aria-label': 'Entry title' });
    title.value = entry.title;
    title.addEventListener('input', () => { entry.title = title.value; changed(); });
    const when = el('span', { class: 'entry-time' }, timeOf(entry.at));
    const toggle = el('button', { type: 'button', class: 'text-link entry-toggle' });
    const remove = el('button', { type: 'button', class: 'text-link entry-delete' }, 'Delete');
    head.append(title, when, toggle, remove);
    const preview = el('p', { class: 'entry-preview' });
    const body = el('div', { class: 'entry-body' });
    const area = el('div', { 'data-placeholder': 'Notes, decisions, links… paste a screenshot here' });
    body.append(area);
    card.append(head, preview, body);
    const editor = linkable(notes.makeEditor(area));
    editor.value = entry.text;
    showImages(editor);
    linkify(editor);
    editor.addEventListener('input', () => { entry.text = editor.value; changed(); });
    // A pasted picture is kept as a screenshot; pasted text goes to the editor as before.
    card.addEventListener('paste', (event) => {
      if (!body.contains(event.target)) return;
      const files = imageFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      addImages(editor, files);
    }, true);
    editors.set(entry.id, editor);

    const show = () => {
      const open = openEntries.has(entry.id);
      card.classList.toggle('closed', !open);
      body.hidden = !open;
      preview.hidden = open;
      preview.textContent = entryPreview(entry);
      toggle.textContent = open ? 'Close' : 'Open';
      toggle.setAttribute('aria-expanded', String(open));
    };
    const setOpen = (open) => { if (open) openEntries.add(entry.id); else openEntries.delete(entry.id); show(); };
    toggle.addEventListener('click', () => setOpen(!openEntries.has(entry.id)));
    preview.addEventListener('click', () => { setOpen(true); notes.caretToEnd(editor); });
    remove.addEventListener('click', () => {
      if (!blankEntry(entry) && !globalScope.confirm(`Delete this entry${entry.title ? ` ("${entry.title}")` : ''}? This can't be undone.`)) return;
      day.entries = day.entries.filter((e) => e !== entry);
      editors.delete(entry.id);
      renderEntries();
      changed();
    });
    show();
    return card;
  }

  function renderEntries() {
    editors.clear();
    // Always one entry to type into straight away; it's only saved once something is written.
    if (!day.entries.length) {
      const entry = { id: newId(), title: '', text: '', at: new Date().toISOString() };
      day.entries.push(entry);
      openEntries.add(entry.id);
    }
    $('#entries').replaceChildren(...day.entries.map(entryCard));
  }

  function newEntry() {
    const entry = { id: newId(), title: '', text: '', at: new Date().toISOString() };
    day.entries.push(entry);
    openEntries.clear();
    openEntries.add(entry.id);
    renderEntries();
    $(`[data-entry="${entry.id}"] .entry-title`).focus();
  }
  const channel = typeof globalScope.BroadcastChannel === 'function' ? new globalScope.BroadcastChannel('pomopal-planner') : null;

  let today = dayKey(new Date());
  let current = today;
  let day = emptyDay(current);
  let dirty = false;
  let timer = null;
  let broken = false;
  let loaded = false; // nothing can be typed or saved until the stored day has been read
  const lockStatic = (locked) => {
    ['#frog-text', '#frog-done', '#add-todo', '#new-entry'].forEach((s) => { $(s).disabled = locked; });
    $('#tomorrow').setAttribute('contenteditable', locked ? 'false' : 'true');
  };
  lockStatic(true);

  function problem(text) {
    broken = true;
    $('#store-problem').textContent = text;
    $('#store-problem').hidden = false;
    doc.querySelectorAll('.day input, .day [contenteditable], #add-todo, #new-entry, .entry-card button').forEach((node) => {
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
    // Newest entry open, earlier ones closed to a one-line preview (keeps the day tidy).
    openEntries.clear();
    if (day.entries.length) openEntries.add(day.entries[day.entries.length - 1].id);
    renderEntries();
    tomorrow.value = day.tomorrow;
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
    if (!loaded) { loaded = true; lockStatic(false); }
    renderDay();
    renderCarried();
    renderRecent();
    $('#save-state').textContent = '';
  }

  function changed() {
    if (broken || !loaded) return;
    dirty = true;
    $('#save-state').textContent = 'Saving…';
    globalScope.clearTimeout(timer);
    timer = globalScope.setTimeout(flush, 500);
  }

  async function flush() {
    globalScope.clearTimeout(timer);
    if (!dirty || broken) return;
    day.entries.forEach((entry) => { const editor = editors.get(entry.id); if (editor) entry.text = editor.value; });
    day.tomorrow = tomorrow.value;
    const toSave = { ...day, entries: day.entries.filter((e) => !blankEntry(e)), updatedAt: new Date().toISOString() };
    dirty = false;
    try {
      await backend.put(JSON.parse(JSON.stringify(toSave)));
      $('#save-state').textContent = 'Saved';
      channel?.postMessage({ saved: toSave.date });
      if (folder.state === 'on' || folder.state === 'paused') queueExport(toSave.date);
      renderRecent();
    } catch {
      dirty = true;
      $('#save-state').textContent = 'Not saved — this browser refused. Keep this tab open and try again.';
    }
  }

  $('#frog-text').addEventListener('input', () => { day.frog.text = $('#frog-text').value; changed(); });
  $('#frog-done').addEventListener('change', () => { day.frog.done = $('#frog-done').checked; $('.item.frog').classList.toggle('done', day.frog.done); changed(); });
  $('#add-todo').addEventListener('click', addTodo);
  $('#new-entry').addEventListener('click', newEntry);
  tomorrow.addEventListener('input', changed);
  // ---- OneDrive folder (Val 2026-11-27): each changed day saved as a Word file, plus a backup ----
  // Edge/Chrome on a computer only (File System Access). The folder is picked once; after a
  // browser restart one click allows it again. A Word file changed outside PomoPal is never
  // replaced. The backup (PomoPal backup/<date>.json, with its screenshots) is what Restore reads.
  const folder = { handle: null, state: 'none', note: '' };
  const canPickFolder = typeof globalScope.showDirectoryPicker === 'function';
  let exportTimer = null;
  const pendingExport = new Set();

  function renderFolder() {
    const name = folder.handle?.name || '';
    const link = $('#folder-link');
    const restore = $('#restore-link');
    link.hidden = false;
    restore.hidden = folder.state !== 'on';
    if (!canPickFolder) {
      $('#folder-state').textContent = 'This browser can\'t save to a folder. Use Edge or Chrome on a computer.';
      link.hidden = true;
      return;
    }
    if (folder.state === 'none') { $('#folder-state').textContent = 'Not saving to a folder yet.'; link.textContent = 'Choose folder…'; }
    if (folder.state === 'paused') { $('#folder-state').textContent = `Saving to “${name}” is paused until you allow it.`; link.textContent = 'Allow again'; }
    if (folder.state === 'on') { $('#folder-state').textContent = `Saving to “${name}”${folder.note ? ` · ${folder.note}` : ''}`; link.textContent = 'Change folder'; }
    if (folder.state === 'error') { $('#folder-state').textContent = folder.note; link.textContent = 'Allow again'; }
  }

  async function exportedRecords() { return (await backend.getSetting('exported')) || {}; }

  async function writeFile(dir, name, data) {
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    return handle.getFile();
  }

  // Writes one day's Word file and backup. Returns a note for the status line, or ''.
  async function exportDay(date) {
    const stored = await backend.get(date);
    if (!stored) return '';
    const d = normaliseDay(stored, date);
    const images = {};
    for (const id of d.entries.flatMap((e) => imagesIn(e.text))) {
      const image = await backend.getImage(id);
      if (image) images[id] = { type: image.type, dataUrl: image.dataUrl };
    }
    const backupDir = await folder.handle.getDirectoryHandle(BACKUP_DIR, { create: true });
    await writeFile(backupDir, `${date}.json`, JSON.stringify({ format: 1, savedAt: new Date().toISOString(), day: stored, images }, null, 1));
    const records = await exportedRecords();
    if (isEmptyDay(d)) return '';
    const name = fileNameFor(date);
    const record = records[date];
    let existing = null;
    try { existing = await (await folder.handle.getFileHandle(name)).getFile(); } catch { existing = null; }
    if (existing && (!record || existing.lastModified !== record.modified || existing.size !== record.size)) {
      return `${name} was changed outside PomoPal, so it was left as it is`;
    }
    const docx = globalScope.PomoDocx.dayDocument(daySections(d, readSessions(), images));
    const file = await writeFile(folder.handle, name, docx);
    records[date] = { modified: file.lastModified, size: file.size, updatedAt: stored.updatedAt || '' };
    await backend.putSetting('exported', records);
    return '';
  }

  async function runExports() {
    if (folder.state !== 'on') return;
    const dates = [...pendingExport];
    pendingExport.clear();
    const notes = [];
    for (const date of dates) {
      try {
        const note = await exportDay(date);
        if (note) notes.push(note);
      } catch (error) {
        if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') { folder.state = 'paused'; dates.forEach((x) => pendingExport.add(x)); renderFolder(); return; }
        folder.state = 'error';
        folder.note = `Couldn't save to “${folder.handle?.name}”: ${error?.message || 'the browser refused'}. Your notes are safe here.`;
        dates.forEach((x) => pendingExport.add(x));
        renderFolder();
        return;
      }
    }
    folder.note = notes.length ? notes.join('; ') : `last saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    renderFolder();
  }

  function queueExport(date, wait = 3000) {
    pendingExport.add(date);
    globalScope.clearTimeout(exportTimer);
    exportTimer = globalScope.setTimeout(runExports, wait);
  }

  // Days changed since their last save to the folder (or never saved there) go next.
  async function catchUp() {
    const records = await exportedRecords();
    (await backend.all()).forEach((d) => {
      if (!isEmptyDay(d) && (records[d.date]?.updatedAt || '') !== (d.updatedAt || '')) pendingExport.add(d.date);
    });
    await runExports();
  }

  async function connect(handle, ask) {
    let permission = 'denied';
    try {
      permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted' && ask) permission = await handle.requestPermission({ mode: 'readwrite' });
    } catch { permission = 'denied'; }
    folder.handle = handle;
    folder.state = permission === 'granted' ? 'on' : 'paused';
    folder.note = '';
    renderFolder();
    if (folder.state === 'on') await catchUp();
  }

  $('#folder-link').addEventListener('click', async () => {
    if (broken || !loaded) return;
    if (folder.handle && folder.state !== 'on') { await connect(folder.handle, true); return; }
    let handle;
    try { handle = await globalScope.showDirectoryPicker({ id: 'pomopal-planner', mode: 'readwrite' }); } catch { return; } // closed without choosing
    try { await backend.putSetting('folder', handle); } catch { /* still used for this visit */ }
    if (folder.handle && folder.handle !== handle) await backend.putSetting('exported', {}); // a new folder gets every day
    await connect(handle, true);
  });

  // Restore: days from the backup that are missing here or older here. Never replaces newer notes.
  $('#restore-link').addEventListener('click', async () => {
    if (folder.state !== 'on') return;
    await flush();
    let restored = 0;
    try {
      const dir = await folder.handle.getDirectoryHandle(BACKUP_DIR);
      for await (const [name, handle] of dir.entries()) {
        if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name) || handle.kind !== 'file') continue;
        let backup;
        try { backup = JSON.parse(await (await handle.getFile()).text()); } catch { continue; }
        const saved = backup?.day;
        if (!saved?.date) continue;
        const here = await backend.get(saved.date);
        if (here && String(here.updatedAt || '') >= String(saved.updatedAt || '')) continue;
        for (const [id, image] of Object.entries(backup.images || {})) {
          if (!(await backend.getImage(id))) await backend.putImage({ id, ...image, day: saved.date });
        }
        await backend.put(saved);
        restored += 1;
      }
    } catch {
      folder.note = 'nothing to restore in this folder';
      renderFolder();
      return;
    }
    folder.note = restored ? `restored ${restored} ${restored === 1 ? 'day' : 'days'}` : 'nothing older to restore — your notes here are up to date';
    renderFolder();
    await openDay(current);
  });

  $('#prev-day').addEventListener('click', () => openDay(shiftDay(current, -1)));
  $('#next-day').addEventListener('click', () => openDay(shiftDay(current, 1)));
  $('#go-today').addEventListener('click', () => openDay(dayKey(new Date())));

  // Leaving the tab or closing it saves straight away.
  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) { flush().then(() => { if (pendingExport.size) runExports(); }); return; }
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
  renderFolder();
  backend.ready.then(async () => {
    if (!broken) $('#store-problem').hidden = true;
    await openDay(current);
    // The folder picked before: saving goes on if the browser still allows it.
    let handle = null;
    try { handle = await backend.getSetting('folder'); } catch { handle = null; }
    if (handle && canPickFolder) await connect(handle, false);
  }).catch(() => {
    renderDay();
    problem('This browser can\'t keep planner notes (storage is switched off, e.g. a private window). Open PomoPal in a normal window.');
  });
  // For tests: lets a check wait for the save that typing started.
  globalScope.PomoPlannerFlush = flush;
  globalScope.PomoPlannerExportNow = () => { globalScope.clearTimeout(exportTimer); return runExports(); };
})(typeof window !== 'undefined' ? window : globalThis);
