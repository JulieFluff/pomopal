// PomoPal browser version: the session log kept in this browser, recent tasks, and split CSV export.
(function initWebLog(globalScope) {
  const STORAGE_KEY = 'pomopal.web.sessions';
  const CATEGORIES = { dayjob: 'Day job', personal: 'Personal' };

  function normaliseCategory(value) {
    return Object.hasOwn(CATEGORIES, value) ? value : 'dayjob';
  }

  function localParts(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return {
      date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    };
  }

  function parseSessions(raw) {
    try {
      const list = JSON.parse(raw || '[]');
      return Array.isArray(list) ? list.filter((s) => s && typeof s === 'object') : [];
    } catch {
      return [];
    }
  }

  function createSession({ activity, durationMinutes, category, completedAt = new Date() }) {
    const when = completedAt instanceof Date ? completedAt : new Date(completedAt);
    return {
      completedAt: when.toISOString(),
      ...localParts(when),
      category: normaliseCategory(category),
      activity: String(activity || '').trim() || 'Unspecified activity',
      durationMinutes: Number(durationMinutes) || 0,
    };
  }

  function recentTasks(sessions, category, limit = 6) {
    const seen = new Set();
    const tasks = [];
    for (let i = sessions.length - 1; i >= 0 && tasks.length < limit; i -= 1) {
      const s = sessions[i];
      if (s.category !== category || s.activity === 'Unspecified activity') continue;
      const key = s.activity.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push(s.activity);
    }
    return tasks;
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function toCsv(sessions, category) {
    const rows = sessions
      .filter((s) => s.category === category)
      .map((s) => [s.date, s.time, CATEGORIES[s.category], s.activity, s.durationMinutes].map(csvCell).join(','));
    return `date,time,category,work,duration_minutes\n${rows.map((r) => `${r}\n`).join('')}`;
  }

  function exportFileName(category, today = new Date()) {
    const label = category === 'personal' ? 'Personal' : 'DayJob';
    return `PomoPal_${label}_${localParts(today).date}.csv`;
  }

  function createStore(storage) {
    return {
      all: () => parseSessions(storage.getItem(STORAGE_KEY)),
      add(session) {
        const sessions = parseSessions(storage.getItem(STORAGE_KEY));
        sessions.push(session);
        storage.setItem(STORAGE_KEY, JSON.stringify(sessions));
        return { ok: true, count: sessions.length };
      },
    };
  }

  const exportsObject = {
    STORAGE_KEY, CATEGORIES, normaliseCategory, parseSessions, createSession, recentTasks, toCsv, exportFileName, createStore,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObject;
  globalScope.PomoWebLog = exportsObject;
})(typeof window !== 'undefined' ? window : globalThis);
