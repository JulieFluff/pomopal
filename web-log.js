// PomoPal browser version: the session log kept in this browser, recent tasks, and split CSV export.
(function initWebLog(globalScope) {
  const STORAGE_KEY = 'pomopal.web.sessions';
  const CATEGORIES = { dayjob: 'Work', personal: 'Personal' };

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

  // Typing suggestions remember only the last 15 different task names (Val, 2026-11-18).
  function recentTasks(sessions, category, limit = 15) {
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

  // Suggestions while typing: names that start with the typed text first, then names that
  // contain it. With nothing typed yet, the last few tasks.
  function matchTasks(tasks, typed, limit = 5) {
    const text = String(typed || '').trim().toLowerCase();
    if (!text) return tasks.slice(0, 3);
    const starts = tasks.filter((t) => t.toLowerCase().startsWith(text));
    const contains = tasks.filter((t) => !t.toLowerCase().startsWith(text) && t.toLowerCase().includes(text));
    return [...starts, ...contains].filter((t) => t.toLowerCase() !== text).slice(0, limit);
  }

  function inCategory(sessions, category) {
    return category === 'all' ? sessions : sessions.filter((s) => s.category === category);
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function toCsv(sessions, category) {
    const rows = inCategory(sessions, category)
      .map((s) => [s.date, s.time, CATEGORIES[s.category], s.activity, s.durationMinutes, s.note || ''].map(csvCell).join(','));
    return `date,time,category,work,duration_minutes,note\n${rows.map((r) => `${r}\n`).join('')}`;
  }

  function exportFileName(category, today = new Date()) {
    const label = category === 'personal' ? 'Personal' : category === 'all' ? 'All' : 'Work';
    return `PomoPal_${label}_${localParts(today).date}.csv`;
  }

  function weekStart(now) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return start;
  }

  function sessionsFor(sessions, period, now = new Date()) {
    const today = localParts(now).date;
    if (period === 'today') return sessions.filter((s) => s.date === today);
    if (period === 'month') return sessions.filter((s) => s.date?.slice(0, 7) === today.slice(0, 7));
    if (period === 'year') return sessions.filter((s) => s.date?.slice(0, 4) === today.slice(0, 4));
    const first = localParts(weekStart(now)).date;
    return sessions.filter((s) => s.date >= first && s.date <= today);
  }

  const minutesOf = (list) => list.reduce((total, s) => total + (Number(s.durationMinutes) || 0), 0);

  // Bars for the Log screen: a bar per day of the week or month, or per month of the year.
  function chartFor(sessions, period, now = new Date()) {
    if (period === 'week') {
      const start = weekStart(now);
      return 'MTWTFSS'.split('').map((label, i) => {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const date = localParts(day).date;
        return { label, minutes: minutesOf(sessions.filter((s) => s.date === date)), current: date === localParts(now).date };
      });
    }
    if (period === 'month') {
      const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const month = localParts(now).date.slice(0, 7);
      return Array.from({ length: days }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, '0')}`;
        return { label: (i + 1) % 7 === 1 ? String(i + 1) : '', minutes: minutesOf(sessions.filter((s) => s.date === date)), current: i + 1 === now.getDate() };
      });
    }
    if (period === 'year') {
      const year = String(now.getFullYear());
      return 'JFMAMJJASOND'.split('').map((label, i) => {
        const month = `${year}-${String(i + 1).padStart(2, '0')}`;
        return { label, minutes: minutesOf(sessions.filter((s) => s.date?.slice(0, 7) === month)), current: i === now.getMonth() };
      });
    }
    return [];
  }

  // Time per task, biggest first.
  function topTasks(sessions, limit = 5) {
    const totals = new Map();
    sessions.forEach((s) => {
      const key = String(s.activity).toLowerCase();
      const entry = totals.get(key) || { activity: s.activity, minutes: 0 };
      entry.minutes += Number(s.durationMinutes) || 0;
      totals.set(key, entry);
    });
    return [...totals.values()].sort((a, b) => b.minutes - a.minutes).slice(0, limit);
  }

  function formatDuration(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    if (!hours) return `${rest}m`;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }

  const DAY = { weekday: 'short', day: 'numeric', month: 'short' };
  function dayLabel(date) {
    const [y, m, d] = String(date).split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', DAY).replace(',', '');
  }

  function rangeLabel(period, now = new Date()) {
    if (period === 'today') return now.toLocaleDateString('en-GB', DAY).replace(',', '');
    if (period === 'month') return now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    if (period === 'year') return String(now.getFullYear());
    const start = weekStart(now);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    const short = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `${short(start)} – ${short(end)}`;
  }

  // The list as plain text for copy and paste: one line per entry, newest first,
  // columns separated by tabs so it also pastes into a spreadsheet.
  function toCopyText(sessions) {
    return sessions.slice().reverse()
      .map((s) => [dayLabel(s.date), String(s.time).slice(0, 5), `${s.durationMinutes} min`, CATEGORIES[s.category], s.activity, s.note || ''].join('\t').replace(/\t+$/, ''))
      .join('\n');
  }

  function summaryFor(sessions, period, now = new Date()) {
    const selected = sessionsFor(sessions, period, now);
    return { sessions: selected.length, minutes: selected.reduce((total, s) => total + (Number(s.durationMinutes) || 0), 0) };
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
      // A session waits to go online while its note card is open, so the note goes with it.
      unsynced: () => read().filter((s) => !s.synced && !s.pendingNote),
      update(id, patch) {
        const sessions = read();
        const session = sessions.find((s) => s.id === id);
        if (!session) return false;
        Object.assign(session, patch);
        write(sessions);
        return true;
      },
      // On opening the page, nothing is still waiting for a note.
      releaseNotes() {
        const sessions = read();
        if (!sessions.some((s) => s.pendingNote)) return;
        sessions.forEach((s) => { delete s.pendingNote; });
        write(sessions);
      },
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
    STORAGE_KEY, CATEGORIES, normaliseCategory, parseSessions, newId, createSession, recentTasks, matchTasks, inCategory, toCsv, exportFileName, sessionsFor, summaryFor, createStore,
    chartFor, topTasks, formatDuration, dayLabel, rangeLabel, toCopyText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObject;
  globalScope.PomoWebLog = exportsObject;
})(typeof window !== 'undefined' ? window : globalThis);
