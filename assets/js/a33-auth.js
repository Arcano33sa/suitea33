/*
  Suite A33 — A33Auth (core)
  Autenticación simple (1 usuario) con sesión (token) en sessionStorage.

  - 1 usuario (registro único): username + password hash (PBKDF2-SHA256)
  - Sesión: token + expiración
  - Compat: migra PIN legacy (suite_a33_pin) a credenciales iniciales
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
  const SESSION_KEY = 'suite_a33_session_v1';

  const LEGACY_PIN_KEY = 'suite_a33_pin';

  const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12h
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

  const A33Auth = {
    AUTH_KEY,
    SESSION_KEY,

    isConfigured(){
      const rec = readAuthRecord();
      return !!(rec && rec.username && rec.saltB64 && rec.hashB64);
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

      const rec = {
        v: 1,
        username: u,
        algo: 'PBKDF2-SHA256',
        iterations: PBKDF2_ITERS,
        saltB64: b64FromBytes(salt),
        hashB64: b64FromBytes(hash),
        createdAt: new Date().toISOString()
      };
      writeAuthRecord(rec);
      if (displayName != null) this.setDisplayName(displayName);
      return true;
    },

    async verify({ username, password } = {}){
      const rec = readAuthRecord();
      if (!rec) return { ok:false, reason:'No configurado' };
      const u = normalizeUser(username);
      if (u !== String(rec.username || '')) return { ok:false, reason:'Usuario incorrecto' };
      const salt = bytesFromB64(rec.saltB64);
      const hash = await pbkdf2Hash(String(password || ''), salt, Number(rec.iterations || PBKDF2_ITERS));
      const hashB64 = b64FromBytes(hash);
      return { ok: hashB64 === String(rec.hashB64 || '') };
    },

    async login({ username, password, ttlMs } = {}){
      const res = await this.verify({ username, password });
      if (!res.ok) throw new Error('Credenciales incorrectas.');
      const ttl = Number(ttlMs || DEFAULT_TTL_MS);
      const sess = {
        token: randomB64(24),
        issuedAt: now(),
        expiresAt: now() + ttl
      };
      LS.setJSON(SESSION_KEY, sess, 'session');
      return sess;
    },

    logout(){
      LS.removeItem(SESSION_KEY, 'session');
    },

    isAuthenticated(){
      const s = LS.getJSON(SESSION_KEY, null, 'session');
      if (!s || !s.token || !s.expiresAt) return false;
      return now() < Number(s.expiresAt);
    },

    async changePassword({ username, currentPassword, newPassword } = {}){
      const check = await this.verify({ username, password: currentPassword });
      if (!check.ok) throw new Error('Contraseña actual incorrecta.');
      const rec = readAuthRecord();
      const salt = new Uint8Array(SALT_BYTES);
      crypto.getRandomValues(salt);
      const hash = await pbkdf2Hash(String(newPassword || ''), salt, PBKDF2_ITERS);
      rec.iterations = PBKDF2_ITERS;
      rec.saltB64 = b64FromBytes(salt);
      rec.hashB64 = b64FromBytes(hash);
      rec.updatedAt = new Date().toISOString();
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
      writeAuthRecord(rec);
      this.logout();
      return true;
    },

    // Guard para páginas de módulos
    async requireAuth({ redirectTo='../index.html' } = {}){
      await migrateLegacyPinIfNeeded();
      if (this.isConfigured() && this.isAuthenticated()) return true;
      // Si no está configurado, lo llevamos al Home para setup.
      try{
        const target = redirectTo || '../index.html';
        if (location.pathname.endsWith('/index.html') && location.pathname.split('/').length <= 2){
          // Home: no redirigir
          return false;
        }
        location.href = target;
      }catch(_){ }
      return false;
    },

    // Expuesto para index.html: corre migración si aplica.
    async ensureMigrated(){
      await migrateLegacyPinIfNeeded();
    },

    // Hard reset solo de credenciales (no toca datos de módulos)
    resetCredentials(){
      LS.removeItem(AUTH_KEY, 'local');
      LS.removeItem(PROFILE_KEY, 'local');
      this.logout();
    }
  };

  window.A33Auth = A33Auth;
})();
