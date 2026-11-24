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

  // Web links in a note (Val 2026-11-23): shown clickable in the Log, and as clickable
  // columns in the spreadsheet.
  function linksIn(text) {
    return [...String(text || '').matchAll(/https?:\/\/[^\s<>"]+/g)].map((m) => m[0].replace(/[).,;:!?'\]*]+$/, ''));
  }

  // Formatted notes (Val 2026-11-24) are kept as plain text with light Markdown:
  // **bold**, <u>underline</u> and "- " bullets. Old plain notes need no change, Markdown
  // exports keep the formatting, and Copy and the spreadsheet get clean text.
  const BULLET = /^\s*[-*•]\s(.*)$/;
  const escapeHtml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const inlineHtml = (line) => escapeHtml(line)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/g, '<u>$1</u>');

  function noteToHtml(text) {
    const lines = String(text || '').split('\n');
    if (!String(text || '')) return '';
    let html = ''; let inList = false;
    lines.forEach((line) => {
      const bullet = line.match(BULLET);
      if (bullet && !inList) { html += '<ul>'; inList = true; }
      if (!bullet && inList) { html += '</ul>'; inList = false; }
      html += bullet ? `<li>${inlineHtml(bullet[1]) || '<br>'}</li>` : `<div>${inlineHtml(line) || '<br>'}</div>`;
    });
    return inList ? `${html}</ul>` : html;
  }

  function noteToPlain(text) {
    return String(text || '').split('\n').map((line) => {
      const bullet = line.match(BULLET);
      const body = (bullet ? bullet[1] : line).replace(/\*\*(.+?)\*\*/g, '$1').replace(/<u>(.+?)<\/u>/g, '$1');
      return bullet ? `• ${body}` : body;
    }).join('\n');
  }

  // Excel and Google Sheets show =HYPERLINK as a clickable link. A cell holds one link, so
  // each link gets its own column, and the columns only appear when a note has a link.
  function toCsv(sessions, category) {
    const list = inCategory(sessions, category);
    const links = list.map((s) => linksIn(noteToPlain(s.note)));
    const most = Math.max(0, ...links.map((l) => l.length));
    const extra = Array.from({ length: most }, (_, i) => `,link_${i + 1}`).join('');
    const rows = list.map((s, i) => [
      s.date, s.time, CATEGORIES[s.category], s.activity, s.durationMinutes, noteToPlain(s.note),
      ...Array.from({ length: most }, (_, n) => (links[i][n] ? `=HYPERLINK("${links[i][n].replaceAll('"', '%22')}")` : '')),
    ].map(csvCell).join(','));
    return `date,time,category,work,duration_minutes,note${extra}\n${rows.map((r) => `${r}\n`).join('')}`;
  }

  function exportFileName(category, today = new Date(), ext = 'csv') {
    const label = category === 'personal' ? 'Personal' : category === 'all' ? 'All' : 'Work';
    return `PomoPal_${label}_${localParts(today).date}.${ext}`;
  }

  // Markdown for Obsidian and AI tools (Val 2026-11-23): a heading per day, one per session,
  // oldest first, notes as written.
  function toMarkdown(sessions, { category = 'dayjob', period = 'week', now = new Date() } = {}) {
    const list = inCategory(sessions, category);
    const which = category === 'all' ? 'All' : CATEGORIES[category];
    const lines = [`# PomoPal · ${which} · ${rangeLabel(period, now)}${period === 'week' ? ` ${now.getFullYear()}` : ''}`, '',
      `Total ${formatDuration(minutesOf(list))} · ${list.length} ${list.length === 1 ? 'session' : 'sessions'}`];
    let day = '';
    list.forEach((s) => {
      if (s.date !== day) { day = s.date; lines.push('', `## ${dayLabel(s.date)} ${String(s.date).slice(0, 4)}`); }
      const tag = category === 'all' ? ` · ${CATEGORIES[s.category]}` : '';
      lines.push('', `### ${String(s.time).slice(0, 5)} · ${s.activity} (${s.durationMinutes} min${tag})`);
      if (s.note) lines.push('', String(s.note).trim());
    });
    return `${lines.join('\n')}\n`;
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
    const start = weekStart(now);
    const first = localParts(start).date;
    const last = localParts(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)).date;
    return sessions.filter((s) => s.date >= first && s.date <= last);
  }

  const minutesOf = (list) => list.reduce((total, s) => total + (Number(s.durationMinutes) || 0), 0);

  // Bars for the Log screen: a bar per day of the week or month, or per month of the year.
  function chartFor(sessions, period, now = new Date(), today = now) {
    const todayDate = localParts(today).date;
    if (period === 'week') {
      const start = weekStart(now);
      return 'MTWTFSS'.split('').map((label, i) => {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const date = localParts(day).date;
        return { label, minutes: minutesOf(sessions.filter((s) => s.date === date)), current: date === todayDate };
      });
    }
    if (period === 'month') {
      const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const month = localParts(now).date.slice(0, 7);
      return Array.from({ length: days }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, '0')}`;
        return { label: (i + 1) % 7 === 1 ? String(i + 1) : '', minutes: minutesOf(sessions.filter((s) => s.date === date)), current: `${month}-${String(i + 1).padStart(2, '0')}` === todayDate };
      });
    }
    if (period === 'year') {
      const year = String(now.getFullYear());
      return 'JFMAMJJASOND'.split('').map((label, i) => {
        const month = `${year}-${String(i + 1).padStart(2, '0')}`;
        return { label, minutes: minutesOf(sessions.filter((s) => s.date?.slice(0, 7) === month)), current: month === todayDate.slice(0, 7) };
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

  // The day, week, month or year `offset` steps back from now (0 = the current one).
  function periodDate(period, offset = 0, now = new Date()) {
    const y = now.getFullYear(); const m = now.getMonth(); const d = now.getDate();
    if (period === 'today') return new Date(y, m, d - offset);
    if (period === 'month') return new Date(y, m - offset, 1);
    if (period === 'year') return new Date(y - offset, 0, 1);
    return new Date(y, m, d - 7 * offset);
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
  // columns separated by tabs so it also pastes into a spreadsheet. A note with several
  // lines is joined with " · " so each entry stays on one line.
  function toCopyText(sessions) {
    return sessions.slice().reverse()
      .map((s) => [dayLabel(s.date), String(s.time).slice(0, 5), `${s.durationMinutes} min`, CATEGORIES[s.category], s.activity, oneLine(s.note)].join('\t').replace(/\t+$/, ''))
      .join('\n');
  }

  const oneLine = (note) => noteToPlain(note).split('\n').map((l) => l.trim()).filter(Boolean).join(' · ');

  // ---- Importing a spreadsheet: the Mac app's pomopal_sessions.csv or this log's own download ----
  function parseCsv(text) {
    const rows = []; let row = []; let cell = ''; let quoted = false;
    const src = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < src.length; i += 1) {
      const c = src[i];
      if (quoted) {
        if (c === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
        if (c === '\r' && src[i + 1] === '\n') i += 1;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }

  // The same session always gets the same id, so importing a file twice adds nothing twice.
  function stableId(key) {
    const hex = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((seed) => {
      let h = seed >>> 0;
      for (let i = 0; i < key.length; i += 1) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; h = (h ^ (h >>> 13)) >>> 0; }
      return h.toString(16).padStart(8, '0');
    }).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
  }

  const sameSession = (s) => `${s.date}|${s.time}|${String(s.activity).trim().toLowerCase()}`;

  // Reads the file and returns the sessions not already in `existing`. Rows without a category
  // use `category`, or Work when the task contains one of `workWords`.
  function importCsv(text, { existing = [], category = 'personal', workWords = [] } = {}) {
    const [header = [], ...rows] = parseCsv(text);
    const col = (...names) => header.findIndex((h) => names.includes(h.trim().toLowerCase()));
    const at = { date: col('date'), time: col('time'), task: col('work', 'activity', 'task'), minutes: col('duration_minutes', 'minutes'), category: col('category'), note: col('note') };
    if (at.date < 0 || at.time < 0 || at.task < 0 || at.minutes < 0) return { error: 'This file does not look like a PomoPal log (it needs date, time, work and duration_minutes columns).' };
    const words = workWords.map((w) => w.trim().toLowerCase()).filter(Boolean);
    const have = new Set(existing.map(sameSession));
    const ids = new Set(existing.map((s) => s.id));
    const sessions = []; let skipped = 0; let bad = 0;
    rows.forEach((r) => {
      const date = (r[at.date] || '').trim(); const time = (r[at.time] || '').trim();
      const activity = (r[at.task] || '').trim() || 'Unspecified activity';
      const durationMinutes = Number(r[at.minutes]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time) || !(durationMinutes > 0)) { bad += 1; return; }
      const fullTime = time.length === 5 ? `${time}:00` : time;
      const label = at.category >= 0 ? (r[at.category] || '').trim().toLowerCase() : '';
      const cat = label === 'work' || label === 'day job' ? 'dayjob' : label === 'personal' ? 'personal'
        : words.some((w) => activity.toLowerCase().includes(w)) ? 'dayjob' : category;
      const [y, mo, d] = date.split('-').map(Number); const [h, mi, se = 0] = fullTime.split(':').map(Number);
      const session = { id: stableId(`pomopal-import|${date}|${fullTime}|${activity}`), completedAt: new Date(y, mo - 1, d, h, mi, se).toISOString(), date, time: fullTime, category: cat, activity, durationMinutes };
      const note = at.note >= 0 ? (r[at.note] || '').trim() : '';
      if (note) session.note = note;
      if (have.has(sameSession(session)) || ids.has(session.id)) { skipped += 1; return; }
      have.add(sameSession(session)); ids.add(session.id);
      sessions.push(session);
    });
    return { sessions, skipped, bad };
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
      // Adds imported sessions in time order.
      addMany(list) {
        const merged = [...read(), ...list].sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));
        write(merged);
        return list.length;
      },
      clear: () => storage.removeItem(STORAGE_KEY),
    };
  }

  const exportsObject = {
    STORAGE_KEY, CATEGORIES, normaliseCategory, parseSessions, newId, createSession, recentTasks, matchTasks, inCategory, toCsv, exportFileName, sessionsFor, summaryFor, createStore,
    chartFor, topTasks, formatDuration, dayLabel, rangeLabel, toCopyText,
    linksIn, noteToHtml, noteToPlain, toMarkdown, periodDate, parseCsv, stableId, importCsv,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObject;
  globalScope.PomoWebLog = exportsObject;
})(typeof window !== 'undefined' ? window : globalThis);
