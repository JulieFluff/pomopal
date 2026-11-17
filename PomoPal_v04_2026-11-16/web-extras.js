// PomoPal browser version: adds Day job / Personal, recent tasks and split export
// around the shared screens. Loaded after ../renderer/app.js; changes nothing in it.
(() => {
  const log = window.PomoWebLog;
  const state = window.PomoWebState;
  const store = log.createStore(localStorage);
  const $ = (selector) => document.querySelector(selector);
  const intention = $('#intention');
  const intentionWrap = $('.intention-wrap');

  function el(tag, attributes = {}, text = '') {
    const node = document.createElement(tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    if (text) node.textContent = text;
    return node;
  }

  // Day job / Personal
  const categoryRow = el('div', { class: 'web-category full-only', role: 'group', 'aria-label': 'Who is this for?' });
  const categoryButtons = Object.entries(log.CATEGORIES).map(([key, label]) => {
    const button = el('button', { type: 'button', 'data-category': key }, label);
    button.addEventListener('click', () => setCategory(key));
    categoryRow.append(button);
    return button;
  });
  intentionWrap.before(categoryRow);

  // Previous tasks stay out of the way until Val asks for one.
  const taskPickerButton = el('button', { type: 'button', class: 'web-link web-task-picker-toggle' }, 'Choose a previous task');
  const recent = el('div', { class: 'web-recent full-only', 'aria-label': 'Previous tasks', hidden: '' });
  taskPickerButton.addEventListener('click', () => { recent.hidden = !recent.hidden; });
  intentionWrap.after(recent, taskPickerButton);

  // A compact Today line and an on-demand private log.
  const footer = el('section', { class: 'web-log full-only', 'aria-label': 'Your log' });
  const count = el('p', { class: 'web-count', 'aria-live': 'polite' });
  const links = el('p', { class: 'web-links' });
  const logButton = el('button', { type: 'button', class: 'web-link' }, 'Your log');
  const logPanel = el('section', { class: 'web-log-panel', hidden: '', 'aria-label': 'Your log details' });
  logButton.addEventListener('click', () => { logPanel.hidden = !logPanel.hidden; refreshLog(); });
  links.append(logButton);
  footer.append(count, links, logPanel);
  $('.settings').after(footer);

  function setCategory(key) {
    state.category = log.normaliseCategory(key);
    localStorage.setItem('pomopal.web.category', state.category);
    refresh();
  }

  function useTask(task) {
    intention.value = task;
    intention.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function download(category) {
    const csv = log.toCsv(store.all(), category);
    const link = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: log.exportFileName(category) });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function formatMinutes(minutes) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? `${hours} hr${hours === 1 ? '' : 's'}${rest ? ` ${rest} min` : ''}` : `${rest} min`;
  }

  let logPeriod = 'today';
  function refreshLog() {
    const sessions = log.sessionsFor(store.all(), logPeriod).slice().reverse();
    const summary = log.summaryFor(store.all(), logPeriod);
    const heading = el('p', { class: 'web-log-summary' }, `${logPeriod === 'today' ? 'Today' : logPeriod === 'week' ? 'This week' : 'This month'}: ${summary.sessions} ${summary.sessions === 1 ? 'session' : 'sessions'} · ${formatMinutes(summary.minutes)}`);
    const periods = el('p', { class: 'web-log-periods' });
    [['today', 'Today'], ['week', 'This week'], ['month', 'This month']].forEach(([key, label]) => {
      const button = el('button', { type: 'button', class: 'web-link', 'aria-pressed': String(key === logPeriod) }, label);
      button.addEventListener('click', () => { logPeriod = key; refreshLog(); });
      periods.append(button);
    });
    const entries = el('div', { class: 'web-log-entries' });
    entries.replaceChildren(...sessions.map((s) => el('p', {}, `${s.date} · ${s.time.slice(0, 5)} · ${s.activity} · ${s.durationMinutes} min · ${log.CATEGORIES[s.category]}`)));
    if (!sessions.length) entries.append(el('p', {}, 'No completed sessions in this period yet.'));
    const downloads = el('p', { class: 'web-links' });
    Object.entries(log.CATEGORIES).forEach(([key, label]) => {
      const button = el('button', { type: 'button', class: 'web-link' }, `Download ${label}`);
      button.disabled = !store.all().some((s) => s.category === key);
      button.addEventListener('click', () => download(key));
      downloads.append(button);
    });
    logPanel.replaceChildren(heading, periods, entries, downloads);
  }

  function refresh() {
    const sessions = store.all();
    const locked = state.status === 'running' || state.status === 'paused';
    categoryButtons.forEach((button) => {
      const selected = button.dataset.category === state.category;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = locked && !selected;
    });

    const tasks = log.recentTasks(sessions, state.category);
    recent.replaceChildren(...tasks.map((task) => {
      const button = el('button', { type: 'button', title: task }, task);
      button.addEventListener('click', () => { useTask(task); recent.hidden = true; });
      return button;
    }));
    taskPickerButton.hidden = tasks.length === 0;
    if (tasks.length === 0) recent.hidden = true;

    const today = log.summaryFor(sessions, 'today');
    count.textContent = `Today: ${today.sessions} ${today.sessions === 1 ? 'session' : 'sessions'} · ${formatMinutes(today.minutes)}`;
    refreshLog();
  }

  // Pop-out timer: the Mac app's mini button (↘) opens PomoPal's friend and countdown in a
  // small window. Chrome and Edge keep it above other windows (Picture-in-Picture); other
  // browsers get a normal small window. The real mascot and countdown move into it, so the
  // shared app keeps driving them exactly as in the Mac app's mini mode.
  const popped = el('p', { class: 'mini-only web-popped' }, 'PomoPal is in the pop-out window');
  $('.timer-card').append(popped);
  const popout = { win: null, moved: [] };

  const exitMini = () => { if (document.body.classList.contains('mini')) $('#expand-toggle').click(); };

  function restoreFromPopout() {
    popout.moved.forEach(({ node, marker }) => { marker.replaceWith(node); });
    popout.moved = [];
    popout.win = null;
  }

  function fillPopout(win) {
    const doc = win.document;
    doc.title = 'PomoPal';
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((sheet) => {
      const copy = doc.createElement(sheet.tagName === 'STYLE' ? 'style' : 'link');
      if (sheet.tagName === 'STYLE') copy.textContent = sheet.textContent;
      else Object.assign(copy, { rel: 'stylesheet', href: sheet.href });
      doc.head.append(copy);
    });
    doc.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light';
    doc.body.className = 'web mini web-popout';
    const card = doc.createElement('section');
    card.className = 'timer-card';
    const back = doc.createElement('button');
    back.type = 'button';
    back.className = 'expand-button';
    back.textContent = '↗';
    back.setAttribute('aria-label', 'Return to full timer');
    back.addEventListener('click', exitMini);
    card.append(back);
    ['#mascot', '#time'].forEach((selector) => {
      const node = $(selector);
      const marker = document.createComment('pomopal-popout');
      node.before(marker);
      popout.moved.push({ node, marker });
      card.append(node);
    });
    const shell = doc.createElement('main');
    shell.className = 'app-shell';
    shell.append(card);
    doc.body.append(shell);
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
        ? await window.documentPictureInPicture.requestWindow({ width: 230, height: 210 })
        : window.open('', 'pomopal-popout', 'popup,width=230,height=230');
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

  // Online saving (quiet text in the footer). Hidden until web-config.js has the Supabase details.
  const online = el('div', { class: 'web-online' });
  const onlineLine = el('p', { class: 'web-online-line', 'aria-live': 'polite' });
  const onlineLinks = el('p', { class: 'web-links' });
  const form = el('form', { class: 'web-login', hidden: '' });
  const email = el('input', { type: 'email', autocomplete: 'username', placeholder: 'Email', 'aria-label': 'Email', required: '' });
  const password = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password', 'aria-label': 'Password', required: '' });
  const loginButton = el('button', { type: 'submit' }, 'Log in');
  const formNote = el('p', { class: 'web-login-note', 'aria-live': 'polite' });
  form.append(email, password, loginButton, formNote);
  online.append(onlineLine, onlineLinks, form);
  footer.append(online);

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
  function link(text, onClick) {
    const button = el('button', { type: 'button', class: 'web-link' }, text);
    button.addEventListener('click', onClick);
    return button;
  }

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
    onlineLine.textContent = s.signedOutReason === 'elsewhere'
      ? 'Signed out from another device. This browser\'s copy of the log was removed.'
      : s.signedOutReason === 'you' ? 'Signed out on every device.' : 'Online saving is off on this browser.';
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
    if (!window.confirm('Sign out of PomoPal on every device?\n\nYour log stays safe online. Each device will need your email and password again.')) return;
    try {
      await sync.signOutEverywhere();
    } catch (error) {
      onlineLine.textContent = error.message;
    }
  }

  if (sync) {
    state.recordedListeners.push(() => sync.syncNow());
    window.setInterval(() => sync.syncNow(), 120000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync.syncNow(); });
    sync.syncNow();
  }
  renderOnline();

  let lastStatus = state.status;
  state.listeners.push((status) => {
    if (status === lastStatus) return;
    lastStatus = status;
    refresh();
  });
  state.recordedListeners.push(refresh);
  window.addEventListener('storage', (event) => {
    if (event.key === log.STORAGE_KEY || event.key === 'pomopal.web.category') {
      state.category = log.normaliseCategory(localStorage.getItem('pomopal.web.category'));
      refresh();
    }
  });
  refresh();
})();
