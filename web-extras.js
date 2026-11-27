// PomoPal browser version (work look, locked design Val 2026-11-18): Work / Personal,
// typing suggestions, the note card after time's up or Done, the Log screen, the pop-out
// timer and online saving. Loaded after ../renderer/app.js; changes nothing in it.
(() => {
  const log = window.PomoWebLog;
  const state = window.PomoWebState;
  const store = log.createStore(localStorage);
  store.releaseNotes();
  const $ = (selector) => document.querySelector(selector);
  const intention = $('#intention');
  const timeEl = $('#time'); // kept: it moves into the pop-out window and back
  const isComplete = () => document.body.classList.contains('timer-complete');
  const notes = window.PomoNotes;

  function el(tag, attributes = {}, text = '') {
    const node = document.createElement(tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    if (text) node.textContent = text;
    return node;
  }

  function link(text, onClick, extraClass = '') {
    const button = el('button', { type: 'button', class: `text-link ${extraClass}`.trim() }, text);
    button.addEventListener('click', onClick);
    return button;
  }

  // The mug in the full timer is only the logo. (In the pop-out the shared app uses it to
  // start the same task again once time is up.)
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('#mascot')) event.stopPropagation();
  }, true);

  // ---- Work / Personal ----
  const categoryRow = el('div', { class: 'seg web-category', role: 'group', 'aria-label': 'Work or personal' });
  const categoryButtons = Object.entries(log.CATEGORIES).map(([key, label]) => {
    const button = el('button', { type: 'button', 'data-category': key }, label);
    button.addEventListener('click', () => setCategory(key));
    categoryRow.append(button);
    return button;
  });
  $('#category-slot').append(categoryRow);

  function setCategory(key) {
    state.category = log.normaliseCategory(key);
    localStorage.setItem('pomopal.web.category', state.category);
    refresh();
  }

  // ---- Status word, progress line and tab title ----
  const STATUS = { ready: 'Ready', running: 'Focusing', paused: 'Paused', complete: "Time's up" };
  let plannedMinutes = Number($('#custom-minutes').value) || 25;
  const secondsOf = (text) => {
    const [m, s] = String(text).split(':').map(Number);
    return (m || 0) * 60 + (s || 0);
  };

  function refreshClock() {
    const { status } = state;
    const shown = timeEl.textContent;
    const total = (Number($('#custom-minutes').value) || 0) * 60;
    const done = status === 'complete' ? 1 : total ? Math.min(1, Math.max(0, 1 - secondsOf(shown) / total)) : 0;
    $('#web-status').textContent = STATUS[status] || 'Ready';
    $('#progress-bar').style.width = `${(done * 100).toFixed(2)}%`;
    $('#done-hint').hidden = status !== 'running' && status !== 'paused';
    updateTab(status, shown, done);
    syncPopout();
  }

  // ---- The browser tab (Val 2026-11-24): discreet in an open office ----
  // The title shows only the time, never the task. The icon becomes a ring that empties as
  // time runs down. When time's up while you're on another tab or the window is minimised,
  // the title and icon gently alternate until you come back.
  const tabIcon = document.querySelector('link[rel="icon"]');
  const MUG_ICON = tabIcon?.getAttribute('href') || '';
  const svgIcon = (body) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`)}`;
  const UP_ICON = svgIcon('<g fill="none" stroke="#c4553f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(1.5 2) scale(1.2)"><path d="M5 10h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M16 12h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M9 3.5c-.8.9-.8 2.1 0 3"/><path d="M12.5 3.5c-.8.9-.8 2.1 0 3"/></g>');
  const ringIcon = (left, paused) => svgIcon(`<circle cx="16" cy="16" r="11" fill="none" stroke="#8a8279" stroke-opacity=".35" stroke-width="6"/>${left > 0 ? `<circle cx="16" cy="16" r="11" fill="none" stroke="${paused ? '#8a8279' : '#5b544d'}" stroke-width="6" pathLength="100" stroke-dasharray="${left} 100" transform="rotate(-90 16 16)"/>` : ''}`);
  let flashTimer = null;
  const setIcon = (href) => { if (tabIcon && href && tabIcon.getAttribute('href') !== href) tabIcon.setAttribute('href', href); };
  function stopFlash() {
    if (!flashTimer) return;
    clearInterval(flashTimer);
    flashTimer = null;
  }
  function updateTab(status, shown, done) {
    if (status === 'complete' && document.hidden) {
      if (flashTimer) return;
      let on = false;
      const tick = () => { on = !on; document.title = on ? "Time's up" : 'Focus'; setIcon(on ? UP_ICON : MUG_ICON); };
      tick();
      flashTimer = setInterval(tick, 1000);
      return;
    }
    stopFlash();
    if (status === 'running' || status === 'paused') {
      document.title = status === 'paused' ? `${shown} · paused` : shown;
      setIcon(ringIcon(Math.round((1 - done) * 48) / 48 * 100, status === 'paused'));
    } else {
      document.title = status === 'complete' ? "Time's up" : 'Focus';
      setIcon(MUG_ICON);
    }
  }
  document.addEventListener('visibilitychange', () => refreshClock());
  new MutationObserver(refreshClock).observe(timeEl, { childList: true, characterData: true, subtree: true });

  // ---- Typing suggestions (replace "Choose a previous task", Val 2026-11-18) ----
  const suggestions = $('#suggestions');
  let options = [];
  let active = -1;

  function hideSuggestions() {
    suggestions.hidden = true;
    options = [];
    active = -1;
  }

  function showSuggestions() {
    if (document.activeElement !== intention) { hideSuggestions(); return; }
    options = log.matchTasks(log.recentTasks(store.all(), state.category), intention.value);
    active = -1;
    const typed = intention.value.trim();
    suggestions.replaceChildren(...options.map((task) => {
      const button = el('button', { type: 'button', role: 'option', class: 'suggestion' });
      if (typed && task.toLowerCase().startsWith(typed.toLowerCase())) {
        button.append(el('b', {}, task.slice(0, typed.length)), document.createTextNode(task.slice(typed.length)));
      } else {
        button.textContent = task;
      }
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => choose(task));
      return button;
    }));
    suggestions.hidden = options.length === 0;
  }

  function choose(task) {
    intention.value = task;
    intention.dispatchEvent(new Event('input', { bubbles: true }));
    hideSuggestions();
  }

  function highlight() {
    [...suggestions.children].forEach((button, i) => button.classList.toggle('hi', i === active));
  }

  intention.addEventListener('input', showSuggestions);
  intention.addEventListener('focus', showSuggestions);
  intention.addEventListener('blur', hideSuggestions);
  intention.addEventListener('keydown', (event) => {
    if (suggestions.hidden || !options.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      highlight();
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === 'Escape') {
      event.stopPropagation(); // closes the list only; doesn't reset the timer
      hideSuggestions();
    }
  });

  // ---- No Start without a task (Val 2026-11-19) ----
  // Start (button, Space, or the pop-out) asks for the task first instead of logging an
  // "Unspecified activity". Resume, Continue and Same task again are not affected.
  const taskNeeded = $('#task-needed');
  const needsTask = () => state.status === 'ready' && !intention.value.trim();
  function askForTask() {
    taskNeeded.hidden = false;
    intention.setAttribute('aria-invalid', 'true');
    intention.focus();
  }
  document.addEventListener('click', (event) => {
    if (!event.target?.closest?.('#start-stop') || !needsTask()) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (document.body.classList.contains('mini')) askInPopout(); else askForTask();
  }, true);
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || !needsTask() || document.body.classList.contains('mini')) return;
    if (event.target?.closest?.('input, select, textarea, button, [role="button"], [contenteditable="true"]')) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    askForTask();
  }, true);
  intention.addEventListener('input', () => {
    if (!intention.value.trim()) return;
    taskNeeded.hidden = true;
    intention.removeAttribute('aria-invalid');
  });

  // ---- Custom minutes: a quiet "Custom" link opens the small box ----
  const customForm = $('#custom-duration');
  $('#custom-toggle').addEventListener('click', () => {
    customForm.hidden = !customForm.hidden;
    $('#custom-toggle').setAttribute('aria-expanded', String(!customForm.hidden));
    if (!customForm.hidden) $('#custom-minutes').focus();
  });
  customForm.addEventListener('submit', () => {
    customForm.hidden = true;
    $('#custom-toggle').setAttribute('aria-expanded', 'false');
    refreshClock();
  });
  document.querySelectorAll('[data-minutes]').forEach((button) => button.addEventListener('click', refreshClock));

  // ---- Screens: timer, note card, Log ----
  let view = 'timer';
  function showView(next) {
    view = next;
    $('#timer-view').hidden = next !== 'timer';
    $('#note-card').hidden = next !== 'note';
    $('#log-view').hidden = next !== 'log';
    editingId = null;
    importing = null;
    if (next === 'log') renderLog();
  }

  // ---- Note card: after time's up or Done (Val 2026-11-18) ----
  // It opens with the notes jotted while the timer ran, ready to tidy or add to.
  let noteFor = null;
  const noteText = notes.makeEditor($('#note-text'));

  function openNote(session, timeUp) {
    const jotted = readDraft().trim();
    noteFor = { session, timeUp, jotted };
    $('#note-status').textContent = timeUp ? "Time's up · logged" : 'Logged';
    $('#note-card').classList.toggle('up', timeUp);
    $('#note-title').textContent = `${session.durationMinutes} min · ${session.activity}`;
    $('#note-sub').textContent = `${log.CATEGORIES[session.category]} · ${log.dayLabel(session.date)}, ${String(session.time).slice(0, 5)}`;
    $('label[for="note-text"]').textContent = jotted ? 'Your notes (edit or add more)' : 'Add a note (optional)';
    noteText.value = jotted;
    showView('note');
    renderLines();
    syncPopout();
  }

  function closeNote(text = '') {
    if (!noteFor) return null;
    const { session } = noteFor;
    const note = String(text).trim();
    store.update(session.id, note ? { note, pendingNote: undefined } : { pendingNote: undefined });
    writeDraft(''); // the jotted notes now live with the session
    noteFor = null;
    renderLines();
    showView('timer');
    sync?.syncNow();
    refresh();
    return session;
  }

  function freshTask() {
    if (isComplete()) $('#new-task').click();
  }

  $('#save-note').addEventListener('click', () => { closeNote(noteText.value); freshTask(); });
  // Skip adds nothing more, but never drops notes already typed (in the card, the timer or the pop-out).
  $('#skip-note').addEventListener('click', () => { closeNote(noteText.value); freshTask(); });
  $('#same-again').addEventListener('click', () => {
    const complete = isComplete();
    const session = closeNote($('#note-text').value);
    if (!session) return;
    if (complete) { $('#continue-task').click(); return; }
    // After Done the timer is cleared, so set the same task and length again and start.
    intention.value = session.activity;
    intention.dispatchEvent(new Event('input', { bubbles: true }));
    hideSuggestions();
    $('#custom-minutes').value = String(plannedMinutes);
    if (customForm.requestSubmit) customForm.requestSubmit();
    else customForm.dispatchEvent(new Event('submit', { cancelable: true }));
    $('#start-stop').click();
  });
  noteText.addEventListener('keydown', (event) => { if (event.key === 'Escape') event.stopPropagation(); });

  // ---- Notes while the timer runs (Val 2026-11-19) ----
  // One roomy box: type as much as you like (meetings too). Saved in this browser as you
  // type (nothing lost on refresh) and handed to the note card when the session is logged;
  // the session gives it its date, time and task. Notes written before Start go with the
  // next session logged. The same box moves into the pop-out window.
  const DRAFT_KEY = 'pomopal.web.liveNotes';
  const liveNotes = $('#live-notes');
  const liveInput = notes.makeEditor($('#live-note'));

  function readDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY) || '';
      if (raw.startsWith('[')) { const lines = JSON.parse(raw); return Array.isArray(lines) ? lines.join('\n') : ''; }
      return raw;
    } catch {
      return '';
    }
  }

  function writeDraft(text) {
    try {
      if (String(text).trim()) localStorage.setItem(DRAFT_KEY, text);
      else localStorage.removeItem(DRAFT_KEY);
    } catch { /* storage full or blocked: the text still shows until the page closes */ }
  }

  // While the note card is open, the box and the card hold the same text (so typing in the
  // pop-out adds to the card).
  function renderLines() {
    const text = noteFor ? noteText.value : readDraft();
    if (liveInput.value !== text) liveInput.value = text;
  }

  liveInput.addEventListener('input', () => {
    if (noteFor) noteText.value = liveInput.value;
    writeDraft(liveInput.value);
  });
  liveInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation(); // leaves the box; never resets the timer
      liveInput.blur();
    }
  });
  noteText.addEventListener('input', () => {
    if (!noteFor) return;
    writeDraft(noteText.value); // kept safe while the card is open
    renderLines();
  });

  // N jumps to the notes box (when not already typing somewhere).
  function notesKey(event, target) {
    if (event.key !== 'n' && event.key !== 'N') return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (!target) return;
    event.preventDefault();
    notes.caretToEnd(target);
  }
  document.addEventListener('keydown', (event) => {
    if (document.body.classList.contains('mini')) return; // the box is in the pop-out
    notesKey(event, view === 'timer' ? liveInput : view === 'note' ? noteText : null);
  });
  window.addEventListener('storage', (event) => { if (event.key === DRAFT_KEY && !noteFor) renderLines(); });
  renderLines();

  // ---- Log screen (separate from the timer) ----
  let logPeriod = 'week';
  let logOffset = 0; // 0 = this day/week/month/year, 1 = the one before, and so on
  let logCategory = state.category;
  const logBody = el('div', { class: 'log-body' });
  const online = el('div', { class: 'web-online' });
  $('#log-view').append(logBody, online);
  $('#open-log').addEventListener('click', () => { logCategory = state.category; logOffset = 0; showView('log'); });

  function seg(items, current, onPick, label) {
    const row = el('div', { class: 'seg', role: 'group', 'aria-label': label });
    items.forEach(([key, text]) => {
      const button = el('button', { type: 'button', 'aria-pressed': String(key === current) }, text);
      if (key === current) button.classList.add('on');
      button.addEventListener('click', () => { onPick(key); renderLog(); });
      row.append(button);
    });
    return row;
  }

  function download(text, type, name) {
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function copyText(text, button) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const area = el('textarea', { class: 'copy-buffer', 'aria-hidden': 'true' });
      area.value = text;
      document.body.append(area);
      area.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      area.remove();
    }
    button.textContent = ok ? 'Copied' : 'Could not copy';
    setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  }

  // Editing a note in the Log (Val 2026-11-19). One entry at a time; the Log doesn't redraw
  // underneath while you type.
  let editingId = null;

  function noteEditor(session) {
    const box = el('div', { class: 'note-edit' });
    const area = el('div', { 'aria-label': `Note for ${session.activity}`, 'data-placeholder': 'Add a note' });
    box.append(area);
    notes.makeEditor(area);
    area.value = session.note || '';
    const done = (save) => {
      if (save) {
        const note = area.value.trim();
        store.update(session.id, { note: note || undefined });
      }
      editingId = null;
      renderLog();
    };
    area.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); done(false); }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); done(true); }
    });
    const actions = el('div', { class: 'links' });
    actions.append(link('Cancel', () => done(false)), link('Save', () => done(true), 'strong'));
    box.append(actions);
    setTimeout(() => notes.caretToEnd(area), 0);
    return box;
  }

  // A note as formatted (bold, underline, bullets), with its web links clickable (they open
  // in a new tab).
  function noteWithLinks(text) {
    const box = el('div', { class: 'note' });
    box.innerHTML = log.noteToHtml(text); // built from escaped text: only b, u, ul, li, div, br
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
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

  // ---- Import the Mac app's log (or a downloaded spreadsheet) (Val 2026-11-23) ----
  let importing = null; // { name, text } while the import panel is open
  const importPicker = el('input', { type: 'file', accept: '.csv,text/csv', hidden: '' });
  document.body.append(importPicker);
  importPicker.addEventListener('change', async () => {
    const file = importPicker.files?.[0];
    importPicker.value = '';
    if (!file) return;
    importing = { name: file.name, text: await file.text(), category: 'personal', words: '' };
    renderLog();
  });

  function importPanel() {
    const box = el('div', { class: 'import-box' });
    const words = () => importing.words.split(',');
    const result = log.importCsv(importing.text, { existing: store.all(), category: importing.category, workWords: words() });
    const close = () => { importing = null; renderLog(); };
    box.append(el('p', { class: 'import-title' }, `Import ${importing.name}`));
    if (result.error) {
      box.append(el('p', {}, result.error));
      const actions = el('div', { class: 'links' });
      actions.append(link('Close', close));
      box.append(actions);
      return box;
    }
    const found = result.sessions;
    const dates = found.map((x) => x.date).sort();
    const work = found.filter((x) => x.category === 'dayjob').length;
    box.append(el('p', {}, found.length
      ? `${found.length} new ${found.length === 1 ? 'session' : 'sessions'}, ${log.dayLabel(dates[0])} ${dates[0].slice(0, 4)} – ${log.dayLabel(dates[dates.length - 1])} ${dates[dates.length - 1].slice(0, 4)}.`
      : 'Nothing new to add: everything in this file is already in your log.'));
    if (result.skipped) box.append(el('p', { class: 'muted' }, `${result.skipped} already in your log, so they're skipped.`));
    if (found.length) {
      box.append(el('p', { class: 'muted' }, 'Sessions without Work or Personal go in:'));
      const cats = seg([['personal', 'Personal'], ['dayjob', 'Work']], importing.category, (key) => { importing.category = key; }, 'Import into');
      const label = el('label', { for: 'import-words' }, 'Work instead, if the task contains (separate with commas):');
      const input = el('input', { id: 'import-words', autocomplete: 'off', placeholder: 'e.g. scrum, reporting, meeting' });
      input.value = importing.words;
      const count = el('p', { class: 'muted' }, `${work} Work · ${found.length - work} Personal`);
      input.addEventListener('input', () => {
        importing.words = input.value;
        const now = log.importCsv(importing.text, { existing: store.all(), category: importing.category, workWords: words() }).sessions;
        const w = now.filter((x) => x.category === 'dayjob').length;
        count.textContent = `${w} Work · ${now.length - w} Personal`;
      });
      box.append(cats, label, input, count);
    }
    const actions = el('div', { class: 'links' });
    actions.append(link('Cancel', close));
    if (found.length) {
      actions.append(link(`Import ${found.length}`, () => {
        const latest = log.importCsv(importing.text, { existing: store.all(), category: importing.category, workWords: words() }).sessions;
        store.addMany(latest);
        importing = null;
        logOffset = 0;
        renderLog();
        sync?.syncNow?.();
      }, 'strong'));
    }
    box.append(actions);
    return box;
  }

  function renderLog() {
    if (importing) { logBody.replaceChildren(importPanel()); return; }
    const now = new Date();
    const shown = log.periodDate(logPeriod, logOffset, now);
    const selected = log.sessionsFor(log.inCategory(store.all(), logCategory), logPeriod, shown);
    const minutes = selected.reduce((total, s) => total + (Number(s.durationMinutes) || 0), 0);

    const head = el('div', { class: 'log-head' });
    head.append($('#note-card .mug').cloneNode(true), el('span', { class: 'log-title' }, 'Log'), link('← Timer', () => showView(noteFor ? 'note' : 'timer'), 'back'));

    const rangeRow = el('div', { class: 'log-row' });
    rangeRow.append(
      seg([['today', 'D'], ['week', 'W'], ['month', 'M'], ['year', 'Y']], logPeriod, (key) => { logPeriod = key; logOffset = 0; }, 'Period'),
      stepper(log.rangeLabel(logPeriod, shown)),
    );
    const cats = seg([['dayjob', 'Work'], ['personal', 'Personal'], ['all', 'All']], logCategory, (key) => { logCategory = key; }, 'Which log');
    cats.classList.add('log-cats');

    const total = el('p', { class: 'total' }, log.formatDuration(minutes));
    total.append(el('small', {}, `${selected.length} ${selected.length === 1 ? 'session' : 'sessions'}`));

    const parts = [head, rangeRow, cats, total];
    const chart = log.chartFor(selected, logPeriod, shown, now);
    if (chart.length) {
      const most = Math.max(1, ...chart.map((b) => b.minutes));
      const bars = el('div', { class: 'days', 'aria-hidden': 'true' });
      const labels = el('div', { class: 'day-labels', 'aria-hidden': 'true' });
      chart.forEach((b) => {
        const bar = el('div', { class: b.current ? 'today' : '', title: `${log.formatDuration(b.minutes)}` });
        bar.style.height = `${Math.max(b.minutes ? 6 : 2, (b.minutes / most) * 100)}%`;
        bars.append(bar);
        labels.append(el('span', {}, b.label));
      });
      parts.push(bars, labels);
    }

    const tasks = log.topTasks(selected);
    if (tasks.length) {
      const most = tasks[0].minutes || 1;
      const list = el('div', { class: 'task-bars' });
      tasks.forEach((t) => {
        const row = el('div', { class: 'bar' });
        const fill = el('i');
        fill.style.width = `${Math.max(2, (t.minutes / most) * 100)}%`;
        row.append(el('span', { title: t.activity }, t.activity), fill, el('b', {}, log.formatDuration(t.minutes)));
        list.append(row);
      });
      parts.push(list);
    }

    const listHead = el('div', { class: 'listhead' });
    const actions = el('span', { class: 'act' });
    const copy = link('Copy', () => copyText(log.toCopyText(selected), copy));
    const save = link('Spreadsheet', () => download(log.toCsv(selected, logCategory), 'text/csv', log.exportFileName(logCategory, shown)));
    const md = link('Markdown', () => download(log.toMarkdown(selected, { category: logCategory, period: logPeriod, now: shown }), 'text/markdown', log.exportFileName(logCategory, shown, 'md')));
    save.title = 'Download a spreadsheet (CSV) of this list';
    md.title = 'Download this list as Markdown, for Obsidian or AI tools';
    copy.disabled = save.disabled = md.disabled = !selected.length;
    actions.append(copy, save, md);
    listHead.append(el('span', {}, 'List'), actions);

    const entries = el('div', { class: 'list' });
    selected.slice().reverse().forEach((s) => {
      const row = el('div', { class: 'entry' });
      row.append(
        el('span', { class: 'd' }, `${log.dayLabel(s.date)} · ${String(s.time).slice(0, 5)}`),
        el('span', { class: 'm' }, `${s.durationMinutes} min`),
        el('span', { class: 'a' }, logCategory === 'all' ? `${s.activity} (${log.CATEGORIES[s.category]})` : s.activity),
      );
      if (editingId === s.id) row.append(noteEditor(s));
      else {
        if (s.note) row.append(noteWithLinks(s.note));
        if (!s.pendingNote) row.append(link(s.note ? 'Edit note' : 'Add note', () => { editingId = s.id; renderLog(); }, 'edit-note'));
      }
      entries.append(row);
    });
    if (!selected.length) entries.append(el('p', { class: 'empty' }, 'Nothing logged in this period yet.'));
    parts.push(listHead, entries);
    const more = el('p', { class: 'log-more' });
    more.append(link('Import a log…', () => importPicker.click()));
    more.lastChild.title = "Add sessions from the Mac app's pomopal_sessions.csv or a PomoPal spreadsheet";
    parts.push(more);
    logBody.replaceChildren(...parts);
  }

  // ‹ 16 Nov – 22 Nov ›  Click the dates to come back to now.
  function stepper(label) {
    const box = el('span', { class: 'range' });
    const names = { today: 'day', week: 'week', month: 'month', year: 'year' };
    const back = el('button', { type: 'button', class: 'step', 'aria-label': `Previous ${names[logPeriod]}` }, '‹');
    const dates = el('button', { type: 'button', class: 'range-label', title: logOffset ? 'Back to now' : '' }, label);
    const next = el('button', { type: 'button', class: 'step', 'aria-label': `Next ${names[logPeriod]}` }, '›');
    next.disabled = logOffset === 0;
    dates.disabled = logOffset === 0;
    back.addEventListener('click', () => { logOffset += 1; renderLog(); });
    next.addEventListener('click', () => { logOffset = Math.max(0, logOffset - 1); renderLog(); });
    dates.addEventListener('click', () => { logOffset = 0; renderLog(); });
    box.append(back, dates, next);
    return box;
  }

  // ---- Pop-out timer: the mug and countdown in a small window ----
  // Chrome and Edge keep it above other windows (Picture-in-Picture); other browsers get a
  // normal small window. The real mug and countdown move into it, so the shared app keeps
  // driving them exactly as in the Mac app's mini mode.
  const popout = { win: null, moved: [], linksKey: '', notesOpen: false, shortHeight: 0 };
  const exitMini = () => { if (document.body.classList.contains('mini')) $('#expand-toggle').click(); };

  // "Bring it back" (Val 2026-11-27: it never worked): puts the timer back on this page itself,
  // closes the pop-out if it's still there, then leaves pop-out mode; each step on its own, so
  // a pop-out the browser already closed can't stop the others.
  function bringBack() {
    const { win } = popout;
    try { restoreFromPopout(); } catch { /* keep going */ }
    try { win?.close?.(); } catch { /* already gone */ }
    try { exitMini(); } catch { /* keep going */ }
    if (document.body.classList.contains('mini')) document.body.classList.remove('mini');
  }
  $('#bring-back').addEventListener('click', bringBack);
  // A pop-out the browser closed without telling this page (another picture-in-picture, a
  // sleeping tab): noticed within a second, or when this tab is looked at again.
  const checkPopout = () => { if (popout.win && popout.win.closed) bringBack(); };
  setInterval(checkPopout, 1000);
  document.addEventListener('visibilitychange', checkPopout);
  window.addEventListener('focus', checkPopout);

  function restoreFromPopout() {
    popout.moved.forEach(({ node, marker }) => {
      try { if (marker.isConnected) marker.replaceWith(node); } catch { /* the next one still goes back */ }
    });
    popout.moved = [];
    popout.win = null;
    popout.linksKey = '';
    popout.notesOpen = false;
    popout.shortHeight = 0;
    popout.taskInput = null;
  }

  function miniLinks() {
    const { status } = state;
    const press = (selector) => () => $(selector).click();
    const notes = [popout.notesOpen ? 'Hide notes' : 'Notes', toggleNotes];
    const newTask = () => {
      if (noteFor) $('#skip-note').click(); else $('#new-task').click();
      exitMini();
      setTimeout(() => intention.focus(), 0);
    };
    if (status === 'complete') return [['New task', newTask], notes, ['Open', exitMini]];
    if (status === 'running') return [['Pause', press('#start-stop')], ['Done', press('#log-time'), 'strong'], notes, ['Open', exitMini]];
    if (status === 'paused') return [['Resume', press('#start-stop')], ['Done', press('#log-time'), 'strong'], notes, ['Open', exitMini]];
    if (noteFor) return [notes, ['Open', exitMini]];
    return timeEl.textContent === '00:00' ? [notes, ['Open', exitMini]] : [['Start', press('#start-stop')], notes, ['Open', exitMini]];
  }

  // Notes in the pop-out (Val 2026-11-19): a Notes link beside Open shows the notes box under
  // the timer and makes the window taller; Hide notes puts it back to the size it was.
  const NOTES_HEIGHT = 380;
  function askInPopout() {
    const { win, taskInput } = popout;
    if (!win || !taskInput) return;
    win.document.body.classList.add('asking-task');
    taskInput.focus();
  }

  function toggleNotes() {
    const { win } = popout;
    if (!win) return;
    popout.notesOpen = !popout.notesOpen;
    win.document.body.classList.toggle('notes-open', popout.notesOpen);
    try {
      if (popout.notesOpen && win.innerHeight < NOTES_HEIGHT) {
        popout.shortHeight = win.innerHeight;
        win.resizeBy(0, NOTES_HEIGHT - win.innerHeight);
      } else if (!popout.notesOpen && popout.shortHeight) {
        win.resizeBy(0, popout.shortHeight - win.innerHeight);
        popout.shortHeight = 0;
      }
    } catch { /* the browser said no: drag the window taller instead */ }
    syncPopout();
    if (popout.notesOpen) setTimeout(() => notes.caretToEnd(liveInput), 0);
  }

  function syncPopout() {
    const { win } = popout;
    if (!win) return;
    const doc = win.document;
    doc.body.classList.toggle('timer-complete', state.status === 'complete');
    const items = miniLinks();
    const key = items.map(([text]) => text).join('|');
    if (key === popout.linksKey) return;
    popout.linksKey = key;
    const row = doc.querySelector('.mini-links');
    row.replaceChildren(...items.map(([text, onClick, extra]) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = `text-link ${extra || ''}`.trim();
      button.textContent = text;
      button.addEventListener('click', onClick);
      return button;
    }));
  }

  function fillPopout(win) {
    const doc = win.document;
    doc.title = 'Focus';
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((sheet) => {
      const copy = doc.createElement(sheet.tagName === 'STYLE' ? 'style' : 'link');
      if (sheet.tagName === 'STYLE') copy.textContent = sheet.textContent;
      else Object.assign(copy, { rel: 'stylesheet', href: sheet.href });
      doc.head.append(copy);
    });
    doc.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light';
    doc.body.className = 'web mini web-popout';
    const card = doc.createElement('section');
    card.className = 'card mini-card';
    const row = doc.createElement('div');
    row.className = 'mini-row';
    const move = (node, parent) => {
      const marker = document.createComment('pomopal-popout');
      node.before(marker);
      popout.moved.push({ node, marker });
      parent.append(node);
    };
    ['#mascot', '#time'].forEach((selector) => move($(selector), row));
    const links = doc.createElement('div');
    links.className = 'links mini-links';
    card.append(row, links);
    // Start with no task: a one-line task box takes the links' place; Return starts.
    const task = doc.createElement('div');
    task.className = 'mini-task';
    const taskInput = doc.createElement('input');
    taskInput.maxLength = 120;
    taskInput.autocomplete = 'off';
    taskInput.placeholder = 'What are you working on? ↵';
    taskInput.setAttribute('aria-label', 'What are you working on? Press Return to start');
    taskInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        const text = taskInput.value.trim();
        if (!text) { taskInput.setAttribute('aria-invalid', 'true'); return; }
        intention.value = text;
        intention.dispatchEvent(new Event('input', { bubbles: true }));
        doc.body.classList.remove('asking-task');
        taskInput.value = '';
        taskInput.removeAttribute('aria-invalid');
        $('#start-stop').click();
      } else if (event.key === 'Escape') {
        doc.body.classList.remove('asking-task');
        taskInput.removeAttribute('aria-invalid');
      }
    });
    task.append(taskInput);
    card.append(task);
    popout.taskInput = taskInput;
    move(liveNotes, card); // under the timer; shows with the Notes link
    doc.body.append(card);
    renderLines();
    // N in the pop-out opens the notes (or jumps into them when they're showing).
    doc.addEventListener('keydown', (event) => {
      if (popout.notesOpen) { notesKey(event, liveInput); return; }
      if ((event.key === 'n' || event.key === 'N') && !event.metaKey && !event.ctrlKey && !event.altKey && !event.target?.closest?.('input, textarea, [contenteditable="true"]')) {
        event.preventDefault();
        toggleNotes();
      }
    });
    const ticker = win.setInterval(() => state.catchUpNow?.(), 500);
    win.addEventListener('pagehide', () => {
      win.clearInterval(ticker);
      if (popout.win === win) {
        restoreFromPopout();
        exitMini();
      }
    });
  }

  async function openPopout() {
    if (popout.win) return;
    let win = null;
    try {
      win = window.documentPictureInPicture
        ? await window.documentPictureInPicture.requestWindow({ width: 240, height: 150 })
        : window.open('', 'pomopal-popout', 'popup,width=240,height=170');
    } catch {
      win = null;
    }
    if (!win || !document.body.classList.contains('mini')) {
      win?.close?.();
      exitMini();
      return;
    }
    popout.win = win;
    fillPopout(win);
    syncPopout();
  }

  function closePopout() {
    const { win } = popout;
    if (!win) return;
    restoreFromPopout();
    win.close();
  }

  state.miniListeners.push((enabled) => (enabled ? openPopout() : closePopout()));
  new MutationObserver(() => {
    if (popout.win) popout.win.document.documentElement.dataset.theme = document.documentElement.dataset.theme;
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // A saved "mini" from last time can't reopen a pop-out without a click, so start full.
  exitMini();

  // ---- Online saving (quiet text at the bottom of the Log screen) ----
  // Hidden until web-config.js has the Supabase details.
  const onlineLine = el('p', { class: 'web-online-line', 'aria-live': 'polite' });
  const onlineLinks = el('p', { class: 'web-links' });
  const form = el('form', { class: 'web-login', hidden: '' });
  const email = el('input', { type: 'email', autocomplete: 'username', placeholder: 'Email', 'aria-label': 'Email', required: '' });
  const password = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password', 'aria-label': 'Password', required: '' });
  const loginButton = el('button', { type: 'submit' }, 'Log in');
  const formNote = el('p', { class: 'web-login-note', 'aria-live': 'polite' });
  form.append(email, password, loginButton, formNote);
  online.append(onlineLine, onlineLinks, form);

  const subtle = window.crypto?.subtle;
  const sync = window.PomoWebSync && subtle ? window.PomoWebSync.createSync({
    config: window.PomoWebConfig || {},
    storage: localStorage,
    store,
    fetch: (...args) => window.fetch(...args),
    subtle,
    randomBytes: (n) => window.crypto.getRandomValues(new Uint8Array(n)),
    onChange: () => { renderOnline(); refresh(); },
  }) : null;

  const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  function renderOnline() {
    const s = sync?.status();
    online.hidden = !s?.configured;
    if (!s?.configured) return;
    if (s.signedIn) {
      form.hidden = true;
      onlineLine.textContent = s.error === 'offline'
        ? 'Online saving: can\'t reach it right now — will keep trying'
        : `Saved online${s.lastSync ? ` · last saved ${timeOf(s.lastSync)}` : ''}`;
      onlineLinks.replaceChildren(link('Sign out everywhere', signOutEverywhere));
      return;
    }
    const kept = s.keptUnsaved
      ? ` ${s.keptUnsaved} ${s.keptUnsaved === 1 ? 'session' : 'sessions'} not yet saved online ${s.keptUnsaved === 1 ? 'is' : 'are'} kept here and will save when you log in.`
      : '';
    onlineLine.textContent = s.signedOutReason === 'elsewhere'
      ? `Signed out from another device. Sessions saved online were removed from this browser.${kept}`
      : s.signedOutReason === 'you' ? `Signed out on every device.${kept}` : 'Online saving is off on this browser.';
    onlineLinks.replaceChildren(link(form.hidden ? 'Log in to save online' : 'Cancel', () => {
      form.hidden = !form.hidden;
      formNote.textContent = '';
      renderOnline();
      if (!form.hidden) email.focus();
    }));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginButton.disabled = true;
    formNote.textContent = 'Logging in…';
    try {
      await sync.signIn(email.value, password.value);
      password.value = '';
      formNote.textContent = '';
    } catch (error) {
      formNote.textContent = error.message;
    } finally {
      loginButton.disabled = false;
      renderOnline();
    }
  });

  async function signOutEverywhere() {
    if (!window.confirm('Sign out on every device?\n\nYour log stays safe online. Each device will need your email and password again.')) return;
    try {
      await sync.signOutEverywhere();
    } catch (error) {
      onlineLine.textContent = error.message;
    }
  }

  // ---- Keeping everything in step ----
  function refresh() {
    const locked = state.status === 'running' || state.status === 'paused';
    categoryButtons.forEach((button) => {
      const selected = button.dataset.category === state.category;
      button.classList.toggle('on', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = locked && !selected;
    });
    if (!suggestions.hidden) showSuggestions();
    if (view === 'log' && !editingId && !importing) renderLog();
  }

  state.recordedListeners.push((result) => {
    if (result?.session) openNote(result.session, isComplete());
  });
  if (sync) {
    state.recordedListeners.push(() => sync.syncNow());
    window.setInterval(() => sync.syncNow(), 120000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync.syncNow(); });
    sync.syncNow();
  }
  renderOnline();

  let lastStatus = state.status;
  state.listeners.push((status) => {
    if (status === 'running') {
      plannedMinutes = Number($('#custom-minutes').value) || plannedMinutes;
      if (noteFor) closeNote($('#note-text').value); // started again (mug, Space): the note card closes
    }
    if (status === lastStatus) return;
    lastStatus = status;
    refresh();
    refreshClock();
  });
  state.recordedListeners.push(refresh);
  window.addEventListener('storage', (event) => {
    if (event.key === log.STORAGE_KEY || event.key === 'pomopal.web.category') {
      state.category = log.normaliseCategory(localStorage.getItem('pomopal.web.category'));
      refresh();
    }
  });
  showView('timer');
  refresh();
  refreshClock();
})();
