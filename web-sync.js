// PomoPal browser version: online saving through Supabase.
// - Log in once per device (email + password); the device stays logged in.
// - Every session is locked (AES-GCM) on the device with a key made from the password, so
//   Supabase only ever stores scrambled data. The key never leaves the device.
// - Sessions upload when they finish; each device fetches the others' sessions.
// - "Sign out everywhere" ends every device's login; a device that finds its login ended
//   wipes its key and its copy of the log.
(function initWebSync(globalScope) {
  const AUTH_KEY = 'pomopal.web.auth';
  const LOCK_KEY = 'pomopal.web.key';
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

  async function deriveLock(subtle, password, email) {
    const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`pomopal:${String(email).trim().toLowerCase()}`), iterations: 310000 },
      base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
    );
    return toB64(await subtle.exportKey('raw', key));
  }

  const importLock = (subtle, b64) => subtle.importKey('raw', fromB64(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);

  async function lockSession(subtle, key, session, randomBytes) {
    const { synced, ...plain } = session;
    const iv = randomBytes(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(plain)));
    return JSON.stringify({ v: 1, iv: toB64(iv), ct: toB64(ct) });
  }

  async function unlockSession(subtle, key, data) {
    const { iv, ct } = JSON.parse(data);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ct));
    return JSON.parse(dec.decode(plain));
  }

  class AuthEnded extends Error {}

  function createSync({ config = {}, storage, store, fetch, subtle, randomBytes, now = () => Date.now(), onChange = () => {} }) {
    const url = String(config.url || '').replace(/\/+$/, '');
    const apikey = String(config.anonKey || '');
    const status = { configured: Boolean(url && apikey), signedIn: false, email: '', lastSync: null, error: '', signedOutReason: '' };
    let busy = null;

    const readAuth = () => { try { return JSON.parse(storage.getItem(AUTH_KEY) || 'null'); } catch { return null; } };
    const writeAuth = (auth) => storage.setItem(AUTH_KEY, JSON.stringify(auth));
    const refreshStatus = () => {
      const auth = readAuth();
      status.signedIn = Boolean(status.configured && auth?.refresh_token && storage.getItem(LOCK_KEY));
      status.email = status.signedIn ? auth.email : '';
    };
    const changed = () => { refreshStatus(); onChange({ ...status }); };

    async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: { apikey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      return { ok: response.ok, status: response.status, json };
    }

    const saveTokens = (json, email) => writeAuth({
      access_token: json.access_token, refresh_token: json.refresh_token,
      expires_at: now() + (Number(json.expires_in) || 3600) * 1000, email,
    });

    async function freshToken(force = false) {
      const auth = readAuth();
      if (!auth?.refresh_token) throw new AuthEnded('not signed in');
      if (!force && auth.expires_at - now() > 60000) return auth.access_token;
      const r = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: auth.refresh_token } });
      if (r.ok) { saveTokens(r.json, auth.email); return r.json.access_token; }
      if (r.status >= 400 && r.status < 500) throw new AuthEnded('login ended');
      throw new Error(`Supabase is not answering (${r.status})`);
    }

    async function authed(path, options = {}) {
      let r = await call(path, { ...options, token: await freshToken() });
      if (r.status === 401 || r.status === 403) r = await call(path, { ...options, token: await freshToken(true) });
      if (r.status === 401 || r.status === 403) throw new AuthEnded('login ended');
      return r;
    }

    function wipe(reason) {
      storage.removeItem(AUTH_KEY);
      storage.removeItem(LOCK_KEY);
      store.clear();
      status.signedOutReason = reason;
      status.lastSync = null;
      changed();
    }

    async function syncOnce() {
      refreshStatus();
      if (!status.signedIn) return;
      try {
        await authed('/auth/v1/user'); // a login ended by "Sign out everywhere" fails here
        const key = await importLock(subtle, storage.getItem(LOCK_KEY));
        const pending = store.unsynced();
        if (pending.length) {
          const rows = await Promise.all(pending.map(async (s) => ({ id: s.id, data: await lockSession(subtle, key, s, randomBytes) })));
          const r = await authed('/rest/v1/sessions', { method: 'POST', body: rows, headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' } });
          if (!r.ok) throw new Error(`Could not save online (${r.status})`);
          store.markSynced(pending.map((s) => s.id));
        }
        const r = await authed('/rest/v1/sessions?select=id,data&order=created_at.asc');
        if (!r.ok) throw new Error(`Could not read the online log (${r.status})`);
        const remote = [];
        for (const row of r.json || []) {
          try { remote.push({ ...(await unlockSession(subtle, key, row.data)), id: row.id }); } catch { /* not readable with this password */ }
        }
        store.merge(remote);
        status.lastSync = now();
        status.error = '';
        changed();
      } catch (error) {
        if (error instanceof AuthEnded) { wipe('elsewhere'); return; }
        status.error = 'offline';
        changed();
      }
    }

    // One sync at a time; a request during a sync runs once more afterwards.
    function syncNow() {
      if (busy) { busy.again = true; return busy.promise; }
      busy = { again: false };
      busy.promise = (async () => {
        do { busy.again = false; await syncOnce(); } while (busy.again);
        busy = null;
      })();
      return busy.promise;
    }

    async function signIn(email, password) {
      if (!status.configured) throw new Error('Online saving is not set up yet.');
      const cleanEmail = String(email || '').trim();
      let r;
      try {
        r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: cleanEmail, password } });
      } catch {
        throw new Error('Could not reach the online saving service. Check the internet connection.');
      }
      if (!r.ok) throw new Error(r.status === 400 ? 'Email or password not recognised.' : `Login failed (${r.status}).`);
      saveTokens(r.json, cleanEmail);
      storage.setItem(LOCK_KEY, await deriveLock(subtle, password, cleanEmail));
      status.signedOutReason = '';
      changed();
      await syncNow();
    }

    async function signOutEverywhere() {
      await syncNow(); // save anything still waiting first
      refreshStatus();
      if (!status.signedIn) return;
      let r;
      try {
        r = await call('/auth/v1/logout?scope=global', { method: 'POST', token: await freshToken() });
      } catch (error) {
        if (!(error instanceof AuthEnded)) throw new Error('Could not reach the online saving service, so the other devices are still signed in. Try again when online.');
      }
      if (r && !r.ok && r.status >= 500) throw new Error('The online saving service did not answer, so the other devices are still signed in. Try again in a minute.');
      wipe('you');
    }

    refreshStatus();
    return { status: () => ({ ...status }), signIn, syncNow, signOutEverywhere };
  }

  const exportsObject = { createSync, deriveLock, importLock, lockSession, unlockSession, AUTH_KEY, LOCK_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObject;
  globalScope.PomoWebSync = exportsObject;
})(typeof window !== 'undefined' ? window : globalThis);
