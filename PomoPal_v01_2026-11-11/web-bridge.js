// PomoPal browser version: stands in for the Mac app's desktop bridge so the shared
// renderer (../renderer/app.js) runs unchanged in a browser. Loaded before app.js.
(function initWebBridge(globalScope) {
  // Browsers slow down timers in background tabs (down to once a minute). The shared
  // renderer ticks once per second, so a 1-second interval here catches up on any
  // missed seconds using the real clock. Other intervals are left alone.
  function installCatchUpInterval(win, doc, now = () => Date.now()) {
    const realSetInterval = win.setInterval.bind(win);
    const realClearInterval = win.clearInterval.bind(win);
    const entries = new Map();

    win.setInterval = function setCatchUpInterval(fn, delay, ...args) {
      if (delay !== 1000 || typeof fn !== 'function') return realSetInterval(fn, delay, ...args);
      const entry = { last: now(), active: true };
      entry.run = () => {
        let missed = Math.floor((now() - entry.last) / 1000);
        if (missed < 1) return;
        entry.last += missed * 1000;
        while (missed > 0 && entry.active) {
          missed -= 1;
          fn(...args);
        }
      };
      const id = realSetInterval(entry.run, 1000);
      entries.set(id, entry);
      return id;
    };

    win.clearInterval = function clearCatchUpInterval(id) {
      const entry = entries.get(id);
      if (entry) {
        entry.active = false;
        entries.delete(id);
      }
      return realClearInterval(id);
    };

    doc?.addEventListener?.('visibilitychange', () => {
      if (!doc.hidden) [...entries.values()].forEach((entry) => entry.run());
    });
  }

  function createBridge({ store, getCategory, onTimerState = () => {}, onRecorded = () => {}, createSession }) {
    return {
      setMiniMode() {},
      onMiniModeChanged() {},
      onOpenSettings() {},
      setAlwaysOnTop() {},
      setTimerState(status) { onTimerState(status); },
      recordCompletedSession(session) {
        try {
          const result = store.add(createSession({ ...session, category: getCategory() }));
          onRecorded(result);
          return Promise.resolve(result);
        } catch (error) {
          return Promise.reject(error);
        }
      },
      hide() {},
      platform: 'web',
    };
  }

  const exportsObject = { installCatchUpInterval, createBridge };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObject;

  if (typeof window !== 'undefined' && window.PomoWebLog) {
    const log = window.PomoWebLog;
    const state = {
      category: log.normaliseCategory(localStorage.getItem('pomopal.web.category')),
      status: 'ready',
      listeners: [],
      recordedListeners: [],
    };
    window.PomoWebState = state;
    installCatchUpInterval(window, document);
    window.pomoDesktop = createBridge({
      store: log.createStore(localStorage),
      getCategory: () => state.category,
      createSession: log.createSession,
      onTimerState(status) {
        state.status = status;
        state.listeners.forEach((listener) => listener(status));
      },
      onRecorded(result) {
        state.recordedListeners.forEach((listener) => listener(result));
      },
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
