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

  // Suggestions while typing, and one-click recent tasks
  const taskList = el('datalist', { id: 'web-task-list' });
  intentionWrap.append(taskList);
  intention.setAttribute('list', 'web-task-list');
  const recent = el('div', { class: 'web-recent full-only', 'aria-label': 'Recent tasks' });
  intentionWrap.after(recent);

  // Saved count and downloads
  const footer = el('section', { class: 'web-log full-only', 'aria-label': 'Your log' });
  const count = el('p', { class: 'web-count', 'aria-live': 'polite' });
  const links = el('p', { class: 'web-links' });
  const downloadButtons = Object.entries(log.CATEGORIES).map(([key, label]) => {
    const button = el('button', { type: 'button', class: 'web-link', 'data-export': key }, `Download ${label}`);
    button.addEventListener('click', () => download(key));
    return button;
  });
  links.append(downloadButtons[0], el('span', { 'aria-hidden': 'true' }, ' · '), downloadButtons[1]);
  footer.append(count, links);
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
      button.addEventListener('click', () => useTask(task));
      return button;
    }));
    recent.hidden = tasks.length === 0;
    taskList.replaceChildren(...log.recentTasks(sessions, state.category, 50).map((task) => el('option', { value: task })));

    const counts = Object.keys(log.CATEGORIES).map((key) => sessions.filter((s) => s.category === key).length);
    count.textContent = `Saved in this browser: ${counts[0]} Day job · ${counts[1]} Personal`;
    downloadButtons.forEach((button, i) => { button.disabled = counts[i] === 0; });
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
