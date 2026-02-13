/*
  Suite A33 — A33Auth (core)
  Autenticación simple (1 usuario) — Auth local.

  NUEVO MODELO (Etapa 1: Login por ARRANQUE)
  - Credenciales recordadas (persistentes): username + password hash/config
    - Expiran a las 72h SIN USO REAL (lastUseAt)
  - Estado desbloqueado en esta ejecución (NO persistente entre arranques reales)
    - Se guarda en sessionStorage y se limpia en recarga (reload)
    - Permite navegar entre módulos sin re-login dentro de la misma ejecución

  Nota iOS/PWA:
  - sessionStorage suele sobrevivir a navegación interna, pero NO debe sobrevivir a "arranque real".
  - Por eso: limpiamos el flag de ejecución cuando detectamos recarga (reload).
*/

(function(){
  'use strict';

  if (!window.A33Storage){
    console.error('A33Auth requiere A33Storage.');
    return;
  }

  const LS = window.A33Storage;

  const AUTH_KEY = 'suite_a33_auth_v1';
  const PROFILE_KEY = 'suite_a33_profile_v1';
  const SESSION_KEY = 'suite_a33_session_v1'; // legacy (ya no se usa para auth)

  const LEGACY_PIN_KEY = 'suite_a33_pin';

  // Flag de "desbloqueo en esta ejecución" (solo sessionStorage)
  const EXEC_UNLOCK_KEY = 'suite_a33_exec_unlock_v1';
  const LAST_URL_KEY = 'suite_a33_last_url_v1';

  // TTL de credenciales recordadas (sin uso real)
  const TTL_CRED_IDLE_MS = 72 * 60 * 60 * 1000; // 72h
  const USE_MIN_INTERVAL_MS = 45 * 1000; // rate-limit escrituras (lastUseAt)

  const PBKDF2_ITERS = 150000;
  const SALT_BYTES = 16;

  // --- Utils ---
  const enc = new TextEncoder();

  function b64FromBytes(buf){
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function bytesFromB64(b64){
    const bin = atob(String(b64 || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function now(){ return Date.now(); }
  function randomB64(nBytes){
    const b = new Uint8Array(nBytes);
    crypto.getRandomValues(b);
    return b64FromBytes(b);
  }
  function normalizeUser(u){
    return String(u || '').trim();
  }

  async function pbkdf2Hash(password, saltBytes, iterations){
    const passKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(String(password || '')),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: saltBytes,
        iterations: iterations
      },
      passKey,
      256
    );
    return new Uint8Array(bits);
  }

  function readAuthRecord(){
    return LS.getJSON(AUTH_KEY, null, 'local');
  }
  function writeAuthRecord(rec){
    return LS.setJSON(AUTH_KEY, rec, 'local');
  }
  function readProfile(){
    return LS.getJSON(PROFILE_KEY, { displayName: '' }, 'local') || { displayName: '' };
  }
  function writeProfile(p){
    return LS.setJSON(PROFILE_KEY, p || { displayName: '' }, 'local');
  }

  function clearCredentialsOnly(){
    try{ LS.removeItem(AUTH_KEY, 'local'); }catch(_){ }
    try{ LS.removeItem(PROFILE_KEY, 'local'); }catch(_){ }
  }

  function clearLegacySessionKeys(){
    try{ LS.removeItem(SESSION_KEY, 'local'); }catch(_){ }
    try{ LS.removeItem(SESSION_KEY, 'session'); }catch(_){ }
  }

  function getNavType(){
    // 'navigate' | 'reload' | 'back_forward' | 'prerender'
    try{
      const nav = performance && performance.getEntriesByType ? performance.getEntriesByType('navigation') : null;
      if (nav && nav[0] && nav[0].type) return String(nav[0].type);
    }catch(_){ }
    try{
      // Deprecated, pero aún útil en Safari viejo
      const t = performance && performance.navigation ? performance.navigation.type : null;
      if (t === 1) return 'reload';
      if (t === 2) return 'back_forward';
    }catch(_){ }
    return 'navigate';
  }

  function clearExecUnlock(){
    try{ LS.removeItem(EXEC_UNLOCK_KEY, 'session'); }catch(_){ }
  }

  function setExecUnlock(){
    const n = now();
    const payload = { v: 1, token: randomB64(16), unlockedAt: n };
    LS.setJSON(EXEC_UNLOCK_KEY, payload, 'session');
    return payload;
  }

  function isExecUnlocked(){
    const v = LS.getJSON(EXEC_UNLOCK_KEY, null, 'session');
    if (!v) return false;
    if (v === true || v === 1 || v === '1') return true;
    if (typeof v === 'object'){
      return !!(v.token && Number(v.unlockedAt) > 0);
    }
    return false;
  }

  function isConfiguredInternal(){
    const rec = readAuthRecord();
    return !!(rec && rec.username && rec.saltB64 && rec.hashB64);
  }

  function parseIsoToMs(iso){
    try{
      const t = Date.parse(String(iso || ''));
      return Number.isFinite(t) ? t : 0;
    }catch(_){ return 0; }
  }

  function getLastUseAtMs(rec){
    if (!rec || typeof rec !== 'object') return 0;
    const lu = Number(rec.lastUseAt);
    if (Number.isFinite(lu) && lu > 0) return lu;
    const iso = rec.lastUseIso || rec.updatedAt || rec.createdAt;
    const t = parseIsoToMs(iso);
    return (Number.isFinite(t) && t > 0) ? t : 0;
  }

  function setLastUseAt(rec, ms){
    const t = Number(ms || 0);
    if (!Number.isFinite(t) || t <= 0) return rec;
    rec.lastUseAt = t;
    try{ rec.lastUseIso = new Date(t).toISOString(); }catch(_){ rec.lastUseIso = ''; }
    return rec;
  }

  function migrateLastUseFromLegacySessionIfNeeded(rec){
    // Si venimos del modelo anterior (sesión persistente), usamos su lastActivityAt como lastUseAt.
    if (!rec || typeof rec !== 'object') return rec;
    if (Number.isFinite(Number(rec.lastUseAt)) && Number(rec.lastUseAt) > 0) return rec;

    let legacy = null;
    try{ legacy = LS.getJSON(SESSION_KEY, null, 'local'); }catch(_){ }
    if (!legacy){
      try{ legacy = LS.getJSON(SESSION_KEY, null, 'session'); }catch(_){ }
    }

    let t = 0;
    if (legacy && typeof legacy === 'object'){
      t = Number(legacy.lastActivityAt) || Number(legacy.issuedAt) || 0;
      if ((!Number.isFinite(t) || t <= 0) && legacy.expiresAt){
        const exp = Number(legacy.expiresAt);
        if (Number.isFinite(exp) && exp > 0) t = exp - TTL_CRED_IDLE_MS;
      }
    }

    if (Number.isFinite(t) && t > 0){
      setLastUseAt(rec, t);
      writeAuthRecord(rec);
    }

    // Limpieza: ya no usamos SESSION_KEY.
    clearLegacySessionKeys();
    return rec;
  }

  function expireCredentialsIfNeeded(){
    const rec0 = readAuthRecord();
    if (!rec0) return false;

    const rec = migrateLastUseFromLegacySessionIfNeeded({ ...rec0 });
    const last = getLastUseAtMs(rec);
    if (!last) return false;

    const idle = now() - last;
    if (idle > TTL_CRED_IDLE_MS){
      clearCredentialsOnly();
      clearExecUnlock();
      clearLegacySessionKeys();
      return true;
    }
    return false;
  }

  // Estado interno (por pestaña)
  let _lastUseWriteAt = 0;

  function bumpLastUseRateLimited(){
    // Solo cuenta si el usuario ya está desbloqueado en esta ejecución.
    if (!isConfiguredInternal()) return false;
    if (!isExecUnlocked()) return false;

    // Si las credenciales ya expiraron, cortar.
    if (expireCredentialsIfNeeded()) return false;

    const n = now();
    const rec0 = readAuthRecord();
    if (!rec0) return false;

    const prev = getLastUseAtMs(rec0);
    if (Number.isFinite(prev) && prev > 0 && (n - prev) < USE_MIN_INTERVAL_MS) return true;
    if ((n - _lastUseWriteAt) < USE_MIN_INTERVAL_MS) return true;

    const rec = { ...rec0 };
    setLastUseAt(rec, n);
    writeAuthRecord(rec);
    _lastUseWriteAt = n;
    return true;
  }

  function bindUseListenersOnce(){
    if (typeof document === 'undefined') return;
    if (window.__A33_AUTH_USE_BOUND) return;
    window.__A33_AUTH_USE_BOUND = true;

    const handler = () => {
      try{ bumpLastUseRateLimited(); }catch(_){ }
    };

    // Solo interacción real. Nada de focus/pageshow/visibility.
    try{ document.addEventListener('pointerdown', handler, { passive:true, capture:true }); }catch(_){ }
    try{ document.addEventListener('click', handler, { passive:true, capture:true }); }catch(_){ }
    try{ document.addEventListener('keydown', handler, { passive:true, capture:true }); }catch(_){ }
  }

  // Migra PIN legacy (si existe) → username/password inicial.
  // - Si PIN estaba en JSON legacy {pin,name}, tomamos ambos.
  async function migrateLegacyPinIfNeeded(){
    if (readAuthRecord()) return;
    const raw = LS.getItem(LEGACY_PIN_KEY, 'local');
    if (!raw) return;

    let pin = null;
    let name = '';
    const s = String(raw).trim();
    const onlyDigits6 = /^[0-9]{6}$/.test(s);
    if (onlyDigits6){
      pin = s;
    } else {
      try{
        const obj = JSON.parse(s);
        if (obj && typeof obj === 'object'){
          const p = String(obj.pin || '').trim();
          if (/^[0-9]{6}$/.test(p)) pin = p;
          if (obj.name) name = String(obj.name).trim();
        }
      }catch(_){ }
    }

    if (!pin) return;

    // Creamos auth con ese PIN como contraseña inicial.
    const username = 'admin';
    await A33Auth.setup({ username, password: pin, displayName: name || '' });
    // Limpiamos la key legacy (ya no se usa)
    try{ LS.removeItem(LEGACY_PIN_KEY, 'local'); }catch(_){ }
  }

  function clearExecUnlockIfReload(){
    const navType = getNavType();
    let cur = '';
    let prev = '';
    try{ cur = (typeof location !== 'undefined' && location && location.href) ? String(location.href) : ''; }catch(_){ cur = ''; }
    try{ prev = LS.getItem(LAST_URL_KEY, 'session') || ''; }catch(_){ prev = ''; }

    const isReload = (navType === 'reload') || (!!cur && !!prev && cur === prev);
    if (isReload){
      clearExecUnlock();
    }

    // Guardamos URL actual para detectar reload en el próximo arranque de esta misma pestaña.
    try{ if (cur) LS.setItem(LAST_URL_KEY, cur, 'session'); }catch(_){ }
  }

  const A33Auth = {
    AUTH_KEY,
    PROFILE_KEY,
    SESSION_KEY,
    EXEC_UNLOCK_KEY,

    isConfigured(){
      // Expirar antes de responder.
      try{ expireCredentialsIfNeeded(); }catch(_){ }
      return isConfiguredInternal();
    },

    getUsername(){
      const rec = readAuthRecord();
      return rec && rec.username ? String(rec.username) : '';
    },

    getDisplayName(){
      const p = readProfile();
      return String(p.displayName || '').trim();
    },

    setDisplayName(name){
      const p = readProfile();
      p.displayName = String(name || '').trim();
      writeProfile(p);
      return p.displayName;
    },

    async setup({ username, password, displayName } = {}){
      const u = normalizeUser(username);
      const p = String(password || '');
      if (!u) throw new Error('Usuario requerido.');
      if (p.length < 4) throw new Error('Contraseña muy corta (mínimo 4).');

      const salt = new Uint8Array(SALT_BYTES);
      crypto.getRandomValues(salt);
      const hash = await pbkdf2Hash(p, salt, PBKDF2_ITERS);

      const n = now();
      const rec = {
        v: 2,
        username: u,
        algo: 'PBKDF2-SHA256',
        iterations: PBKDF2_ITERS,
        saltB64: b64FromBytes(salt),
        hashB64: b64FromBytes(hash),
        createdAt: new Date().toISOString(),
        lastUseAt: n,
        lastUseIso: new Date(n).toISOString()
      };
      writeAuthRecord(rec);
      if (displayName != null) this.setDisplayName(displayName);
      // Ya no usamos sesión persistente legacy
      clearLegacySessionKeys();
      return true;
    },

    async verify({ username, password } = {}){
      try{ expireCredentialsIfNeeded(); }catch(_){ }
      const rec = readAuthRecord();
      if (!rec) return { ok:false, reason:'No configurado' };
      const u = normalizeUser(username);
      if (u !== String(rec.username || '')) return { ok:false, reason:'Usuario incorrecto' };
      const salt = bytesFromB64(rec.saltB64);
      const hash = await pbkdf2Hash(String(password || ''), salt, Number(rec.iterations || PBKDF2_ITERS));
      const hashB64 = b64FromBytes(hash);
      return { ok: hashB64 === String(rec.hashB64 || '') };
    },

    async login({ username, password } = {}){
      const res = await this.verify({ username, password });
      if (!res.ok) throw new Error('Credenciales incorrectas.');

      // Desbloqueo SOLO en esta ejecución
      setExecUnlock();

      // lastUseAt SIEMPRE en login exitoso
      const rec0 = readAuthRecord();
      if (rec0){
        const n = now();
        const rec = { ...rec0 };
        setLastUseAt(rec, n);
        writeAuthRecord(rec);
        _lastUseWriteAt = n;
      }

      clearLegacySessionKeys();
      return true;
    },

    logout(){
      // No borra credenciales recordadas: solo cierra el desbloqueo de ejecución.
      clearExecUnlock();
    },

    isAuthenticated(){
      // Expirar antes de responder.
      try{ expireCredentialsIfNeeded(); }catch(_){ }
      return isConfiguredInternal() && isExecUnlocked();
    },

    // Compat: renovar "uso" por actividad real (rate-limited)
    touchActivityIfAuthenticated(){
      return bumpLastUseRateLimited();
    },

    async changePassword({ username, currentPassword, newPassword } = {}){
      const check = await this.verify({ username, password: currentPassword });
      if (!check.ok) throw new Error('Contraseña actual incorrecta.');
      const rec = readAuthRecord();
      if (!rec) throw new Error('No configurado.');
      const salt = new Uint8Array(SALT_BYTES);
      crypto.getRandomValues(salt);
      const hash = await pbkdf2Hash(String(newPassword || ''), salt, PBKDF2_ITERS);
      rec.iterations = PBKDF2_ITERS;
      rec.saltB64 = b64FromBytes(salt);
      rec.hashB64 = b64FromBytes(hash);
      rec.updatedAt = new Date().toISOString();
      setLastUseAt(rec, now());
      writeAuthRecord(rec);
      // Forzar re-login
      this.logout();
      return true;
    },

    async changeUsername({ currentUsername, password, newUsername } = {}){
      const rec = readAuthRecord();
      if (!rec) throw new Error('No configurado.');
      const check = await this.verify({ username: currentUsername, password });
      if (!check.ok) throw new Error('Credenciales incorrectas.');
      const nu = normalizeUser(newUsername);
      if (!nu) throw new Error('Nuevo usuario inválido.');
      rec.username = nu;
      rec.updatedAt = new Date().toISOString();
      setLastUseAt(rec, now());
      writeAuthRecord(rec);
      this.logout();
      return true;
    },

    // Guard para páginas de módulos
    async requireAuth({ redirectTo='../index.html' } = {}){
      await migrateLegacyPinIfNeeded();
      try{ expireCredentialsIfNeeded(); }catch(_){ }

      if (this.isConfigured() && this.isAuthenticated()) return true;

      try{
        const target = redirectTo || '../index.html';
        if (location && location.pathname && location.pathname.endsWith('/index.html') && location.pathname.split('/').length <= 2){
          // Home: no redirigir
          return false;
        }
        location.href = target;
      }catch(_){ }
      return false;
    },

    // Expuesto para index.html: migración + bind
    async ensureMigrated(){
      await migrateLegacyPinIfNeeded();
      try{ expireCredentialsIfNeeded(); }catch(_){ }
      try{ bindUseListenersOnce(); }catch(_){ }
      clearLegacySessionKeys();
      return true;
    },

    // Hard reset solo de credenciales (no toca datos de módulos)
    resetCredentials(){
      try{ LS.removeItem(LEGACY_PIN_KEY, 'local'); }catch(_){ }
      clearCredentialsOnly();
      clearExecUnlock();
      clearLegacySessionKeys();
    }
  };

  // --- Boot ---
  try{ clearExecUnlockIfReload(); }catch(_){ }
  try{ expireCredentialsIfNeeded(); }catch(_){ }
  try{ clearLegacySessionKeys(); }catch(_){ }
  try{ bindUseListenersOnce(); }catch(_){ }

  window.A33Auth = A33Auth;
})();
