/*
  Suite A33 — Firebase Settings (Etapa 5/6)
  Configuración local de credenciales web para integración híbrida con Firebase Realtime Database.
  Permite guardar estado de prueba técnica y lectura futura del motor híbrido sin sincronizar datos de negocio.
*/
(function(g){
  'use strict';

  const STORAGE_KEY = 'suite_a33_firebase_settings_v1';
  const DEVICE_KEY = 'suite_a33_firebase_device_id_v1';
  const CREDENTIAL_KEYS = [
    'apiKey',
    'authDomain',
    'databaseURL',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId',
    'measurementId'
  ];

  function clean(value, maxLen){
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen || 520);
  }

  function normalizeWorkspaceId(value){
    let raw = clean(value, 100).toLowerCase();
    try{ raw = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }catch(_){ }
    return raw.replace(/\s+/g, '').replace(/[^a-z0-9_-]/g, '').slice(0, 80);
  }

  function generateDeviceId(){
    const stamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    return `device_${stamp}_${random}`;
  }

  function ensureDeviceId(){
    try{
      const current = g.localStorage ? clean(g.localStorage.getItem(DEVICE_KEY), 120) : '';
      if (current) return current;
      const next = generateDeviceId();
      if (g.localStorage) g.localStorage.setItem(DEVICE_KEY, next);
      return next;
    }catch(_){
      return generateDeviceId();
    }
  }

  function normalizeEnvironment(value){
    const env = clean(value, 40).toLowerCase();
    return ['production', 'staging', 'development'].includes(env) ? env : 'production';
  }

  function isProbablyDatabaseURL(value){
    const raw = clean(value, 420);
    if (!raw) return false;
    try{
      const url = new URL(raw);
      const host = String(url.hostname || '').toLowerCase();
      return url.protocol === 'https:' && (
        host.endsWith('.firebaseio.com') ||
        host.endsWith('.firebasedatabase.app') ||
        host.includes('-default-rtdb.')
      );
    }catch(_){
      return false;
    }
  }

  function hasMinimumConfig(settings){
    const data = settings && typeof settings === 'object' ? settings : {};
    const c = data.credentials && typeof data.credentials === 'object' ? data.credentials : data;
    return !!(
      normalizeWorkspaceId(data.workspaceId || '') &&
      clean(c.apiKey) &&
      clean(c.authDomain) &&
      clean(c.databaseURL) &&
      isProbablyDatabaseURL(c.databaseURL) &&
      clean(c.projectId) &&
      clean(c.appId)
    );
  }

  function defaults(){
    return {
      version: 3,
      enabled: false,
      configured: false,
      mode: 'hybrid',
      workspaceId: 'arcano33',
      workspaceName: 'Arcano 33',
      environment: 'production',
      deviceId: ensureDeviceId(),
      deviceName: '',
      credentials: {
        apiKey: '',
        authDomain: '',
        databaseURL: '',
        projectId: '',
        storageBucket: '',
        messagingSenderId: '',
        appId: '',
        measurementId: ''
      },
      lastConnectionTestAt: '',
      lastConnectionStatus: 'not-tested',
      lastConnectionPath: '',
      lastSyncAt: '',
      lastError: '',
      pendingLocalCount: 0,
      updatedAt: ''
    };
  }

  function normalize(settings){
    const base = defaults();
    const src = settings && typeof settings === 'object' ? settings : {};
    const srcCreds = src.credentials && typeof src.credentials === 'object' ? src.credentials : src;
    const credentials = {};
    CREDENTIAL_KEYS.forEach(function(key){ credentials[key] = clean(srcCreds[key]); });
    const hasWorkspace = Object.prototype.hasOwnProperty.call(src, 'workspaceId');
    const rawWorkspace = hasWorkspace ? src.workspaceId : base.workspaceId;

    const out = {
      version: 3,
      enabled: !!src.enabled,
      configured: false,
      mode: 'hybrid',
      workspaceId: normalizeWorkspaceId(rawWorkspace),
      workspaceName: clean(src.workspaceName || base.workspaceName, 140) || base.workspaceName,
      environment: normalizeEnvironment(src.environment || base.environment),
      deviceId: clean(src.deviceId, 120) || ensureDeviceId(),
      deviceName: clean(src.deviceName, 120),
      credentials,
      lastConnectionTestAt: clean(src.lastConnectionTestAt, 80),
      lastConnectionStatus: clean(src.lastConnectionStatus, 80) || 'not-tested',
      lastConnectionPath: clean(src.lastConnectionPath, 240),
      lastSyncAt: clean(src.lastSyncAt, 80),
      lastError: clean(src.lastError, 240),
      pendingLocalCount: Math.max(0, parseInt(src.pendingLocalCount || 0, 10) || 0),
      updatedAt: clean(src.updatedAt, 80)
    };
    out.configured = hasMinimumConfig(out);
    return out;
  }

  function read(){
    try{
      if (g.A33Storage && typeof g.A33Storage.getJSON === 'function'){
        return normalize(g.A33Storage.getJSON(STORAGE_KEY, defaults(), 'local'));
      }
    }catch(_){ }
    try{
      const raw = g.localStorage ? g.localStorage.getItem(STORAGE_KEY) : '';
      return normalize(raw ? JSON.parse(raw) : defaults());
    }catch(_){
      return normalize(defaults());
    }
  }

  function save(settings){
    const data = normalize(settings);
    try{
      if (g.A33Storage && typeof g.A33Storage.setJSON === 'function'){
        return { ok: !!g.A33Storage.setJSON(STORAGE_KEY, data, 'local'), settings: data };
      }
    }catch(_){ }
    try{
      if (g.localStorage) g.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return { ok: true, settings: data };
    }catch(error){
      return { ok: false, settings: data, error: String(error && error.message || error || 'storage_error') };
    }
  }

  g.A33FirebaseSettings = Object.assign({}, g.A33FirebaseSettings || {}, {
    storageKey: STORAGE_KEY,
    deviceKey: DEVICE_KEY,
    defaults,
    normalize,
    read,
    save,
    hasMinimumConfig,
    normalizeWorkspaceId,
    isProbablyDatabaseURL,
    ensureDeviceId,
    credentialKeys: CREDENTIAL_KEYS.slice()
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
