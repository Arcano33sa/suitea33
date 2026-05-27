/*
  Suite A33 — Firebase Core (Etapa 5/6)
  Inicialización segura de Firebase Web SDK + prueba técnica de Realtime Database.
  No sincroniza datos de negocio y solo escribe en workspaces/{workspaceId}/_meta/syncEngineTests/{deviceId}.
*/
(function(g){
  'use strict';

  const SDK_VERSION = '10.12.5';
  const APP_SCRIPT_ID = 'a33-firebase-sdk-app-compat';
  const DB_SCRIPT_ID = 'a33-firebase-sdk-database-compat';
  const APP_NAME = 'suite-a33-realtime-test';
  const SDK_URLS = {
    app: 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/firebase-app-compat.js',
    database: 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/firebase-database-compat.js'
  };

  let firebaseApp = null;
  let firebaseDatabase = null;
  let currentSignature = '';
  let sdkLoadPromise = null;

  let state = {
    status: 'disabled',
    message: 'Firebase está en modo local-first. La conexión real solo se usa para prueba técnica.',
    configReady: false,
    appReady: false,
    authReady: false,
    firestoreReady: false,
    databaseReady: false,
    functionsReady: false,
    projectId: '',
    workspaceId: 'arcano33',
    deviceId: '',
    lastConnectionTestAt: '',
    lastError: '',
    connectionPath: '',
    configFile: 'assets/js/a33-firebase-config.js'
  };

  function nowIso(){
    try{ return new Date().toISOString(); }catch(_){ return ''; }
  }

  function clean(value, maxLen){
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen || 520);
  }

  function safePathSegment(value, fallback){
    const raw = clean(value || fallback || '', 160).toLowerCase();
    const safe = raw.replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return safe || clean(fallback || 'default', 80) || 'default';
  }

  function getSettings(){
    try{
      if (g.A33FirebaseSettings && typeof g.A33FirebaseSettings.read === 'function'){
        return g.A33FirebaseSettings.read();
      }
    }catch(_){ }
    return null;
  }

  function saveSettings(next){
    try{
      if (g.A33FirebaseSettings && typeof g.A33FirebaseSettings.save === 'function'){
        const result = g.A33FirebaseSettings.save(next || {});
        return !!(result && result.ok);
      }
    }catch(_){ }
    return false;
  }

  function isProbablyDatabaseURL(value){
    try{
      if (g.A33FirebaseSettings && typeof g.A33FirebaseSettings.isProbablyDatabaseURL === 'function'){
        return g.A33FirebaseSettings.isProbablyDatabaseURL(value);
      }
    }catch(_){ }
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

  function getFirebaseConfig(settings){
    const data = settings && typeof settings === 'object' ? settings : getSettings();
    const c = data && data.credentials && typeof data.credentials === 'object' ? data.credentials : {};
    const config = {
      apiKey: clean(c.apiKey, 520),
      authDomain: clean(c.authDomain, 260),
      databaseURL: clean(c.databaseURL, 420),
      projectId: clean(c.projectId, 180),
      storageBucket: clean(c.storageBucket, 240),
      messagingSenderId: clean(c.messagingSenderId, 160),
      appId: clean(c.appId, 260),
      measurementId: clean(c.measurementId, 160)
    };
    Object.keys(config).forEach(function(key){ if (!config[key]) delete config[key]; });
    return config;
  }

  function isFirebaseConfigured(settings){
    try{
      if (g.A33FirebaseSettings && typeof g.A33FirebaseSettings.hasMinimumConfig === 'function'){
        return !!g.A33FirebaseSettings.hasMinimumConfig(settings || getSettings());
      }
    }catch(_){ }
    const data = settings && typeof settings === 'object' ? settings : getSettings();
    const config = getFirebaseConfig(data);
    const workspaceId = clean(data && data.workspaceId, 100);
    return !!(
      workspaceId &&
      config.apiKey &&
      config.authDomain &&
      config.databaseURL &&
      isProbablyDatabaseURL(config.databaseURL) &&
      config.projectId &&
      config.appId
    );
  }

  function buildSignature(config){
    const parts = [
      clean(config.apiKey, 120),
      clean(config.authDomain, 120),
      clean(config.databaseURL, 180),
      clean(config.projectId, 120),
      clean(config.appId, 160)
    ];
    return parts.join('|');
  }

  function getConnectionPath(settings){
    const workspaceId = safePathSegment(settings && settings.workspaceId, 'arcano33');
    const deviceId = safePathSegment(settings && settings.deviceId, 'device');
    return 'workspaces/' + workspaceId + '/_meta/syncEngineTests/' + deviceId;
  }

  function dispatch(){
    try{
      if (typeof g.CustomEvent === 'function' && g.dispatchEvent){
        g.dispatchEvent(new CustomEvent('a33:firebase-status', { detail: getState() }));
      }
    }catch(_){ }
  }

  function setState(patch){
    state = Object.assign({}, state, patch || {});
    dispatch();
    return getState();
  }

  function getState(){
    return Object.assign({}, state);
  }

  function mapError(error){
    const raw = clean((error && (error.code || error.message)) || error || 'firebase_error', 420);
    const lower = raw.toLowerCase();
    if (lower.includes('permission') || lower.includes('permission_denied') || lower.includes('permission-denied')){
      return {
        status: 'permission-denied',
        message: 'Firebase respondió, pero las reglas no permiten esta prueba.'
      };
    }
    if (lower.includes('database url') || lower.includes('databaseurl') || lower.includes('invalid-url') || lower.includes('invalid url')){
      return {
        status: 'error',
        message: 'databaseURL no pudo usarse para Realtime Database. Revisá que sea la URL exacta de Firebase Realtime Database.'
      };
    }
    if (lower.includes('network') || lower.includes('failed to fetch') || lower.includes('load') || lower.includes('offline')){
      return {
        status: 'offline',
        message: 'No se pudo cargar o contactar Firebase. Revisá conexión a internet y bloqueo de red.'
      };
    }
    if (lower.includes('app/duplicate-app')){
      return {
        status: 'error',
        message: 'Firebase ya estaba inicializado con otra configuración. Guardá cambios y probá de nuevo.'
      };
    }
    return {
      status: 'error',
      message: 'No se pudo completar la prueba de conexión Firebase. Revisá credenciales, databaseURL y reglas.'
    };
  }

  function loadScriptOnce(id, src){
    return new Promise(function(resolve, reject){
      try{
        if (typeof document === 'undefined' || !document.createElement){
          reject(new Error('document_not_available'));
          return;
        }
        const current = document.getElementById(id);
        if (current && current.getAttribute('data-loaded') === 'true'){
          resolve();
          return;
        }
        if (current){
          current.addEventListener('load', function(){ resolve(); }, { once: true });
          current.addEventListener('error', function(){ reject(new Error('sdk_load_error')); }, { once: true });
          return;
        }
        const script = document.createElement('script');
        script.id = id;
        script.src = src;
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.onload = function(){
          try{ script.setAttribute('data-loaded', 'true'); }catch(_){ }
          resolve();
        };
        script.onerror = function(){ reject(new Error('sdk_load_error')); };
        (document.head || document.documentElement).appendChild(script);
      }catch(error){
        reject(error);
      }
    });
  }

  function loadFirebaseSdk(){
    if (g.firebase && typeof g.firebase.initializeApp === 'function' && typeof g.firebase.database === 'function'){
      return Promise.resolve(g.firebase);
    }
    if (!sdkLoadPromise){
      sdkLoadPromise = loadScriptOnce(APP_SCRIPT_ID, SDK_URLS.app)
        .then(function(){ return loadScriptOnce(DB_SCRIPT_ID, SDK_URLS.database); })
        .then(function(){
          if (!g.firebase || typeof g.firebase.initializeApp !== 'function' || typeof g.firebase.database !== 'function'){
            throw new Error('firebase_sdk_unavailable');
          }
          return g.firebase;
        });
    }
    return sdkLoadPromise;
  }

  function findExistingApp(firebase){
    try{
      const apps = Array.isArray(firebase.apps) ? firebase.apps : [];
      return apps.find(function(app){ return app && app.name === APP_NAME; }) || null;
    }catch(_){ return null; }
  }

  async function initFirebaseApp(settings){
    const data = settings && typeof settings === 'object' ? settings : getSettings();
    const config = getFirebaseConfig(data);
    const signature = buildSignature(config);
    if (!signature || !isFirebaseConfigured(data)){
      throw new Error('missing_minimum_config');
    }
    const firebase = await loadFirebaseSdk();
    if (firebaseApp && currentSignature === signature){
      return firebaseApp;
    }
    const existing = findExistingApp(firebase);
    if (existing && currentSignature === signature){
      firebaseApp = existing;
      return firebaseApp;
    }
    if (existing && currentSignature && currentSignature !== signature && typeof existing.delete === 'function'){
      try{ await existing.delete(); }catch(_){ }
    }
    const afterDelete = findExistingApp(firebase);
    firebaseApp = afterDelete || firebase.initializeApp(config, APP_NAME);
    currentSignature = signature;
    return firebaseApp;
  }

  async function getRealtimeDatabase(settings){
    const app = await initFirebaseApp(settings || getSettings());
    if (firebaseDatabase && firebaseApp === app) return firebaseDatabase;
    firebaseDatabase = g.firebase.database(app);
    return firebaseDatabase;
  }

  function persistConnectionResult(settings, result){
    const data = settings && typeof settings === 'object' ? settings : getSettings();
    if (!data || typeof data !== 'object') return false;
    data.lastConnectionTestAt = result && result.at ? result.at : nowIso();
    data.lastError = result && result.ok ? '' : clean(result && result.message, 240);
    data.lastConnectionStatus = result && result.status ? clean(result.status, 80) : (result && result.ok ? 'ok' : 'error');
    data.lastConnectionPath = clean(result && result.path, 240);
    data.updatedAt = data.updatedAt || data.lastConnectionTestAt;
    return saveSettings(data);
  }

  async function testConnection(){
    const settings = getSettings();
    const credentials = settings && settings.credentials ? settings.credentials : {};
    const config = getFirebaseConfig(settings);
    const startedAt = nowIso();
    const path = getConnectionPath(settings || {});

    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false){
      const message = 'Sin conexión a internet. No se puede probar Firebase en este momento.';
      persistConnectionResult(settings, { ok: false, status: 'offline', at: startedAt, message, path });
      setState({ status: 'offline', message, configReady: isFirebaseConfigured(settings), databaseReady: false, lastConnectionTestAt: startedAt, lastError: message, connectionPath: path });
      return { ok: false, status: 'offline', message, path, at: startedAt };
    }

    if (!settings || !settings.enabled){
      const message = 'Firebase está desactivado. Activá y guardá la configuración antes de probar conexión.';
      persistConnectionResult(settings, { ok: false, status: 'disabled', at: startedAt, message, path });
      setState({ status: 'disabled', message, configReady: false, databaseReady: false, lastConnectionTestAt: startedAt, lastError: message, connectionPath: path });
      return { ok: false, status: 'disabled', message, path, at: startedAt };
    }

    if (!isFirebaseConfigured(settings)){
      const missing = [];
      ['apiKey','authDomain','databaseURL','projectId','appId'].forEach(function(key){ if (!clean(credentials[key])) missing.push(key); });
      if (clean(credentials.databaseURL) && !isProbablyDatabaseURL(credentials.databaseURL)) missing.push('databaseURL válida');
      const message = missing.length
        ? 'Faltan credenciales mínimas guardadas: ' + missing.join(', ') + '.'
        : 'Faltan credenciales mínimas guardadas para probar Firebase.';
      persistConnectionResult(settings, { ok: false, status: 'not-configured', at: startedAt, message, path });
      setState({ status: 'not-configured', message, configReady: false, databaseReady: false, lastConnectionTestAt: startedAt, lastError: message, connectionPath: path });
      return { ok: false, status: 'not-configured', message, path, at: startedAt };
    }

    setState({
      status: 'testing',
      message: 'Probando conexión técnica con Firebase Realtime Database…',
      configReady: true,
      appReady: !!firebaseApp,
      databaseReady: false,
      projectId: config.projectId || '',
      workspaceId: settings.workspaceId || 'arcano33',
      deviceId: settings.deviceId || '',
      lastConnectionTestAt: startedAt,
      lastError: '',
      connectionPath: path
    });

    try{
      const db = await getRealtimeDatabase(settings);
      const ref = db.ref(path);
      const payload = {
        ts: startedAt,
        deviceId: clean(settings.deviceId, 120),
        appVersion: clean((g.A33_RELEASE && g.A33_RELEASE.label) || g.A33_BUILD_TAG || 'Suite A33', 80),
        status: 'ok'
      };
      await ref.set(payload);
      const snapshot = await ref.once('value');
      const value = snapshot && typeof snapshot.val === 'function' ? snapshot.val() : null;
      if (!value || value.status !== 'ok'){
        throw new Error('readback_failed');
      }
      persistConnectionResult(settings, { ok: true, status: 'connected', at: startedAt, message: '', path });
      setState({
        status: 'connected',
        message: 'Conexión probada correctamente. Solo se escribió una marca técnica segura en _meta/syncEngineTests.',
        configReady: true,
        appReady: true,
        databaseReady: true,
        projectId: config.projectId || '',
        workspaceId: settings.workspaceId || 'arcano33',
        deviceId: settings.deviceId || '',
        lastConnectionTestAt: startedAt,
        lastError: '',
        connectionPath: path
      });
      return { ok: true, status: 'connected', message: 'Conexión Firebase correcta.', path, at: startedAt };
    }catch(error){
      const mapped = mapError(error);
      persistConnectionResult(settings, { ok: false, status: mapped.status, at: startedAt, message: mapped.message, path });
      setState({
        status: mapped.status,
        message: mapped.message,
        configReady: true,
        appReady: !!firebaseApp,
        databaseReady: false,
        projectId: config.projectId || '',
        workspaceId: settings.workspaceId || 'arcano33',
        deviceId: settings.deviceId || '',
        lastConnectionTestAt: startedAt,
        lastError: mapped.message,
        connectionPath: path
      });
      return { ok: false, status: mapped.status, message: mapped.message, path, at: startedAt };
    }
  }

  function refresh(){
    const settings = getSettings();
    const config = getFirebaseConfig(settings || {});
    const configured = isFirebaseConfigured(settings);
    const online = !(typeof navigator !== 'undefined' && navigator && navigator.onLine === false);
    const baseStatus = !settings || !settings.enabled
      ? 'disabled'
      : (configured ? 'ready-to-test' : 'not-configured');
    const storedStatus = settings && settings.lastConnectionStatus && settings.lastConnectionStatus !== 'not-tested'
      ? clean(settings.lastConnectionStatus, 80)
      : '';
    const visibleStatus = storedStatus || baseStatus;
    const message = !settings || !settings.enabled
      ? 'Firebase está desactivado. La Suite sigue local-first.'
      : (configured
        ? (storedStatus === 'connected' || storedStatus === 'ok'
          ? 'Última prueba de conexión correcta. No hay sincronización de datos de negocio.'
          : 'Campos mínimos completos. Podés probar conexión con Realtime Database sin sincronizar datos de negocio.')
        : 'Firebase está activado, pero faltan credenciales mínimas o databaseURL válida.');
    return Promise.resolve(setState({
      status: online ? visibleStatus : 'offline',
      message: online ? (settings && settings.lastError ? settings.lastError : message) : 'Sin conexión detectada por el navegador.',
      configReady: !!configured,
      appReady: !!firebaseApp,
      authReady: false,
      firestoreReady: false,
      databaseReady: !!firebaseDatabase,
      functionsReady: false,
      projectId: config.projectId || '',
      workspaceId: settings && settings.workspaceId ? settings.workspaceId : 'arcano33',
      deviceId: settings && settings.deviceId ? settings.deviceId : '',
      lastConnectionTestAt: settings && settings.lastConnectionTestAt ? settings.lastConnectionTestAt : '',
      lastError: settings && settings.lastError ? settings.lastError : '',
      connectionPath: getConnectionPath(settings || {})
    }));
  }

  g.A33Firebase = Object.assign({}, g.A33Firebase || {}, {
    getState,
    refresh,
    getFirebaseConfig,
    isFirebaseConfigured,
    initFirebaseApp,
    getRealtimeDatabase,
    testConnection,
    getConnectionPath: function(){ return getConnectionPath(getSettings() || {}); },
    isRealConnectionEnabled: function(){ return true; }
  });

  try{ refresh(); }catch(_){ }
})(typeof globalThis !== 'undefined' ? globalThis : window);
