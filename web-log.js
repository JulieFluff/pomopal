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

  function newId() {
    const c = globalScope.crypto;
    if (c?.randomUUID) return c.randomUUID();
    const bytes = new Uint8Array(16);
    if (c?.getRandomValues) c.getRandomValues(bytes); else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function createSession({ activity, durationMinutes, category, completedAt = new Date() }) {
    const when = completedAt instanceof Date ? completedAt : new Date(completedAt);
    return {
      id: newId(),
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

  // Each session has an id so the same session is never saved twice when devices share
  // one online log. `synced` marks sessions already saved online.
  function createStore(storage) {
    const write = (sessions) => storage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    const read = () => {
      const sessions = parseSessions(storage.getItem(STORAGE_KEY));
      if (sessions.some((s) => !s.id)) {
        sessions.forEach((s) => { if (!s.id) s.id = newId(); });
        write(sessions);
      }
      return sessions;
    };
    return {
      all: read,
      add(session) {
        const sessions = read();
        sessions.push(session);
        write(sessions);
        return { ok: true, count: sessions.length };
      },
      unsynced: () => read().filter((s) => !s.synced),
      markSynced(ids) {
        const done = new Set(ids);
        const sessions = read();
        sessions.forEach((s) => { if (done.has(s.id)) s.synced = true; });
        write(sessions);
      },
      // Adds sessions from the online log that this device doesn't have yet. Returns how many were new.
      merge(remote) {
        const sessions = read();
        const have = new Set(sessions.map((s) => s.id));
        const fresh = remote.filter((s) => s && s.id && !have.has(s.id)).map((s) => ({ ...s, synced: true }));
        if (!fresh.length) return 0;
        const merged = [...sessions, ...fresh].sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));
        write(merged);
        return fresh.length;
      },
      clear: () => storage.removeItem(STORAGE_KEY),
    };
  }

  const exportsObject = {
    STORAGE_KEY, CATEGORIES, normaliseCategory, parseSessions, newId, createSession, recentTasks, toCsv, exportFileName, createStore,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObject;
  globalScope.PomoWebLog = exportsObject;
})(typeof window !== 'undefined' ? window : globalThis);
