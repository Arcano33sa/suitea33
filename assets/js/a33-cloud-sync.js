/*
  Suite A33 — A33CloudSync (Etapa 7/8)
  Motor híbrido local-first + sincronización manual inicial.
  Alcance real: Configuración segura + Catálogos maestros.
  No sincroniza POS, ventas, eventos, Caja Chica, Finanzas, cierres, saldos ni históricos.
*/
(function(g){
  'use strict';

  const QUEUE_KEY = 'suite_a33_sync_queue_v1';
  const STATE_KEY = 'suite_a33_sync_state_v1';
  const ENGINE_VERSION = 3;
  const SCHEMA_VERSION = 2;
  const CATALOG_DB_NAME = 'a33-pos';
  const CATALOG_DB_VERSION = 35;
  const TECHNICAL_COLLECTION = '_meta/syncEngineTests';
  const READY_MESSAGE = 'Sincronización manual lista para Configuración y Catálogos. La Suite sigue local-first.';
  const SYNC_SCOPE_MESSAGE = 'Alcance: Configuración + Catálogos. POS, ventas, Finanzas y Caja Chica permanecen locales.';

  const CONFIG_KEYS = {
    identity: 'suite_a33_identity_v1',
    appearance: 'suite_a33_appearance_preference',
    reports: 'suite_a33_reports_preferences_v1',
    currency: 'suite_a33_currency_settings_v1',
    pwaLastCheck: 'suite_a33_pwa_last_check_at',
    pwaLastUpdate: 'suite_a33_pwa_last_update_at',
    pwaStatus: 'suite_a33_pwa_update_status'
  };

  const META_KEYS = new Set(['id', 'createdAt', 'updatedAt', 'deviceId', 'rev', 'deleted', 'schemaVersion', '_syncKind']);
  const CATALOG_SPECS = [
    { id: 'productos', store: 'products', path: 'catalogos/productos', label: 'Productos', duplicateKey: duplicateProductKey },
    { id: 'extras', store: 'extras', path: 'catalogos/extras', label: 'Extras', duplicateKey: duplicateExtraKey },
    { id: 'bancos', store: 'banks', path: 'catalogos/bancos', label: 'Bancos', duplicateKey: duplicateBankKey }
  ];

  let state = {
    version: ENGINE_VERSION,
    status: 'inactive',
    label: 'Inactivo',
    message: 'Motor local-first preparado. Firebase no reemplaza almacenamiento local.',
    lastSyncAt: '',
    lastError: '',
    technicalPath: '',
    pendingCount: 0,
    syncedCount: 0,
    errorCount: 0,
    uploadedCount: 0,
    downloadedCount: 0,
    conflictCount: 0,
    queueStorageKey: QUEUE_KEY,
    lastSummary: null
  };

  let catalogDb = null;

  function nowIso(){
    try{ return new Date().toISOString(); }catch(_){ return ''; }
  }

  function clean(value, maxLen){
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen || 520);
  }

  function clone(value){
    try{ return JSON.parse(JSON.stringify(value == null ? null : value)); }catch(_){ return null; }
  }

  function stableJson(value){
    try{ return JSON.stringify(value == null ? null : value, Object.keys(flattenKeys(value)).sort()); }catch(_){ return JSON.stringify(value); }
  }

  function flattenKeys(value, out){
    const target = out || {};
    if (value && typeof value === 'object'){
      Object.keys(value).forEach(function(k){
        target[k] = true;
        flattenKeys(value[k], target);
      });
    }
    return target;
  }

  function getStorage(){
    try{ return g.localStorage || null; }catch(_){ return null; }
  }

  function readRaw(key, fallback){
    try{
      if (g.A33Storage && typeof g.A33Storage.getItem === 'function'){
        const v = g.A33Storage.getItem(key, 'local');
        if (v !== undefined && v !== null) return v;
      }
    }catch(_){ }
    try{
      const storage = getStorage();
      if (!storage) return fallback;
      const raw = storage.getItem(key);
      return raw == null ? fallback : raw;
    }catch(_){
      return fallback;
    }
  }

  function writeRaw(key, value){
    try{
      if (g.A33Storage && typeof g.A33Storage.setItem === 'function'){
        const ok = g.A33Storage.setItem(key, String(value == null ? '' : value), 'local');
        if (ok !== false) return true;
      }
    }catch(_){ }
    try{
      const storage = getStorage();
      if (!storage) return false;
      storage.setItem(key, String(value == null ? '' : value));
      return true;
    }catch(_){
      return false;
    }
  }

  function readJson(key, fallback){
    try{
      if (g.A33Storage && typeof g.A33Storage.getJSON === 'function'){
        return g.A33Storage.getJSON(key, fallback, 'local');
      }
    }catch(_){ }
    try{
      const raw = readRaw(key, '');
      return raw ? JSON.parse(raw) : fallback;
    }catch(_){
      return fallback;
    }
  }

  function writeJson(key, value){
    try{
      if (g.A33Storage && typeof g.A33Storage.setJSON === 'function'){
        return !!g.A33Storage.setJSON(key, value, 'local');
      }
    }catch(_){ }
    return writeRaw(key, JSON.stringify(value));
  }

  function readSettings(){
    try{
      if (g.A33FirebaseSettings && typeof g.A33FirebaseSettings.read === 'function'){
        return g.A33FirebaseSettings.read();
      }
    }catch(_){ }
    return null;
  }

  function saveSettings(settings){
    try{
      if (g.A33FirebaseSettings && typeof g.A33FirebaseSettings.save === 'function'){
        return !!(g.A33FirebaseSettings.save(settings || {}) || {}).ok;
      }
    }catch(_){ }
    return false;
  }

  function normalizeWorkspaceId(value){
    try{
      if (g.A33FirebaseSettings && typeof g.A33FirebaseSettings.normalizeWorkspaceId === 'function'){
        return g.A33FirebaseSettings.normalizeWorkspaceId(value);
      }
    }catch(_){ }
    let raw = clean(value || 'arcano33', 100).toLowerCase();
    try{ raw = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }catch(_){ }
    return raw.replace(/\s+/g, '').replace(/[^a-z0-9_-]/g, '').slice(0, 80) || 'arcano33';
  }

  function safePathSegment(value, fallback){
    const raw = clean(value || fallback || '', 160).toLowerCase();
    const safe = raw.replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return safe || clean(fallback || 'default', 80) || 'default';
  }

  function firebaseKey(value, fallback){
    const raw = clean(value == null ? fallback : value, 180);
    const base = raw || clean(fallback || 'record', 80) || 'record';
    return base.replace(/[.#$\[\]\/]/g, '_').replace(/\s+/g, '_').slice(0, 180) || 'record';
  }

  function getWorkspaceId(settings){
    const data = settings && typeof settings === 'object' ? settings : readSettings();
    return normalizeWorkspaceId(data && data.workspaceId ? data.workspaceId : 'arcano33') || 'arcano33';
  }

  function getDeviceId(settings){
    const data = settings && typeof settings === 'object' ? settings : readSettings();
    if (data && data.deviceId) return clean(data.deviceId, 120);
    try{
      if (g.A33FirebaseSettings && typeof g.A33FirebaseSettings.ensureDeviceId === 'function'){
        return g.A33FirebaseSettings.ensureDeviceId();
      }
    }catch(_){ }
    return 'device';
  }

  function getWorkspacePath(settings){
    return 'workspaces/' + safePathSegment(getWorkspaceId(settings), 'arcano33');
  }

  function getTechnicalPath(settings){
    const data = settings && typeof settings === 'object' ? settings : readSettings();
    return getWorkspacePath(data) + '/_meta/syncEngineTests/' + safePathSegment(getDeviceId(data), 'device');
  }

  function getSyncMetaPath(settings){
    return getWorkspacePath(settings) + '/_meta/sync';
  }

  function isOnline(){
    try{
      return !(typeof navigator !== 'undefined' && navigator && navigator.onLine === false);
    }catch(_){
      return true;
    }
  }

  function isConfigured(settings){
    try{
      if (g.A33FirebaseSettings && typeof g.A33FirebaseSettings.hasMinimumConfig === 'function'){
        return !!g.A33FirebaseSettings.hasMinimumConfig(settings || readSettings());
      }
    }catch(_){ }
    const data = settings && typeof settings === 'object' ? settings : readSettings();
    return !!(data && data.configured);
  }

  function makeId(){
    try{
      if (g.crypto && typeof g.crypto.randomUUID === 'function') return g.crypto.randomUUID();
    }catch(_){ }
    return 'sq_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function normalizeAction(action){
    const value = clean(action, 20).toLowerCase();
    return value === 'delete' ? 'delete' : 'upsert';
  }

  function normalizeQueueItem(item){
    const src = item && typeof item === 'object' ? item : {};
    const status = ['pending', 'synced', 'error'].includes(clean(src.status, 20)) ? clean(src.status, 20) : 'pending';
    const action = normalizeAction(src.action);
    const localUpdatedAt = clean(src.localUpdatedAt, 80) || clean(src.updatedAt, 80) || nowIso();
    const collection = clean(src.collection, 180) || TECHNICAL_COLLECTION;
    const recordId = clean(src.recordId || src.id, 180) || makeId();
    const deviceId = clean(src.deviceId, 120) || getDeviceId();
    const deleted = typeof src.deleted === 'boolean' ? src.deleted : action === 'delete';
    return {
      version: ENGINE_VERSION,
      id: clean(src.id, 180) || makeId(),
      collection,
      recordId,
      action,
      payload: clone(src.payload),
      localUpdatedAt,
      deviceId,
      workspaceId: normalizeWorkspaceId(src.workspaceId || getWorkspaceId()),
      status,
      attempts: Math.max(0, parseInt(src.attempts || 0, 10) || 0),
      lastError: clean(src.lastError, 360),
      queuedAt: clean(src.queuedAt, 80) || localUpdatedAt,
      syncedAt: clean(src.syncedAt, 80),
      updatedAt: clean(src.updatedAt, 80) || localUpdatedAt,
      rev: clean(src.rev, 80),
      deleted,
      conflict: {
        updatedAt: localUpdatedAt,
        deviceId,
        rev: clean(src.rev, 80),
        deleted
      }
    };
  }

  function normalizeQueue(raw){
    const list = Array.isArray(raw) ? raw : [];
    return list.map(normalizeQueueItem);
  }

  function readQueue(){
    return normalizeQueue(readJson(QUEUE_KEY, []));
  }

  function writeQueue(queue){
    return writeJson(QUEUE_KEY, normalizeQueue(queue));
  }

  function countQueue(queue){
    const list = Array.isArray(queue) ? queue : readQueue();
    return list.reduce(function(acc, item){
      const status = item && item.status ? item.status : 'pending';
      if (status === 'synced') acc.synced += 1;
      else if (status === 'error') acc.error += 1;
      else acc.pending += 1;
      return acc;
    }, { pending: 0, synced: 0, error: 0 });
  }

  function listPending(){
    return readQueue().filter(function(item){ return item && item.status === 'pending'; });
  }

  function saveState(next){
    const cleanState = Object.assign({}, state, next || {}, {
      version: ENGINE_VERSION,
      queueStorageKey: QUEUE_KEY,
      technicalPath: (next && next.technicalPath) ? next.technicalPath : (state.technicalPath || getSyncMetaPath())
    });
    writeJson(STATE_KEY, cleanState);
    state = cleanState;
    dispatch();
    return getStatus();
  }

  function loadStoredState(){
    const raw = readJson(STATE_KEY, null);
    if (raw && typeof raw === 'object'){
      state = Object.assign({}, state, raw, { version: ENGINE_VERSION, queueStorageKey: QUEUE_KEY, technicalPath: raw.technicalPath || getSyncMetaPath() });
    }
  }

  function getBaseStatus(settings){
    const data = settings && typeof settings === 'object' ? settings : readSettings();
    if (!data || !data.enabled) return { status: 'inactive', label: 'Inactivo', message: 'Firebase está desactivado. La Suite sigue local-first.' };
    if (!isOnline()) return { status: 'offline', label: 'Sin conexión', message: 'Sin conexión detectada. Los datos locales siguen disponibles.' };
    if (!isConfigured(data)) return { status: 'error', label: 'Error', message: 'Firebase está activo, pero faltan credenciales mínimas o databaseURL válida.' };
    return { status: 'ready', label: 'Listo', message: READY_MESSAGE };
  }

  function updateStatusFromLocal(extra){
    loadStoredState();
    const settings = readSettings();
    const counts = countQueue(readQueue());
    const base = getBaseStatus(settings);
    const hasRuntimeError = clean(state.lastError, 360) && state.status === 'error';
    return saveState(Object.assign({
      status: hasRuntimeError ? 'error' : base.status,
      label: hasRuntimeError ? 'Error' : base.label,
      message: hasRuntimeError ? state.lastError : base.message,
      pendingCount: counts.pending,
      syncedCount: counts.synced,
      errorCount: counts.error,
      technicalPath: getSyncMetaPath(settings)
    }, extra || {}));
  }

  function ensureQueue(){
    const queue = readQueue();
    writeQueue(queue);
    updateStatusFromLocal();
    return queue;
  }

  function dispatch(){
    try{
      if (typeof g.CustomEvent === 'function' && g.dispatchEvent){
        g.dispatchEvent(new CustomEvent('a33:cloud-sync-status', { detail: getStatus() }));
      }
    }catch(_){ }
  }

  function getStatus(){
    const counts = countQueue(readQueue());
    return Object.assign({}, state, {
      pendingCount: counts.pending,
      syncedCount: counts.synced,
      errorCount: counts.error,
      queueStorageKey: QUEUE_KEY,
      technicalPath: state.technicalPath || getSyncMetaPath()
    });
  }

  function enqueueChange(entry){
    const src = entry && typeof entry === 'object' ? entry : {};
    const collection = clean(src.collection, 180);
    const recordId = clean(src.recordId, 180);
    if (!collection || !recordId){
      const message = 'syncQueue requiere collection y recordId.';
      registerError(message);
      return { ok: false, message };
    }
    const item = normalizeQueueItem(Object.assign({}, src, {
      id: src.id || makeId(),
      localUpdatedAt: src.localUpdatedAt || nowIso(),
      queuedAt: src.queuedAt || nowIso(),
      status: 'pending',
      attempts: 0,
      lastError: '',
      workspaceId: src.workspaceId || getWorkspaceId(),
      deviceId: src.deviceId || getDeviceId()
    }));
    const queue = readQueue();
    queue.push(item);
    const ok = writeQueue(queue);
    updateStatusFromLocal();
    return { ok, item: clone(item), pendingCount: listPending().length };
  }

  function updateQueueItem(id, patch){
    const targetId = clean(id, 180);
    const queue = readQueue();
    let found = false;
    const next = queue.map(function(item){
      if (item.id !== targetId) return item;
      found = true;
      return normalizeQueueItem(Object.assign({}, item, patch || {}, { id: item.id, updatedAt: nowIso() }));
    });
    const ok = found ? writeQueue(next) : false;
    updateStatusFromLocal();
    return { ok, found };
  }

  function markSynced(id, extra){
    const at = nowIso();
    return updateQueueItem(id, Object.assign({ status: 'synced', syncedAt: at, lastError: '' }, extra || {}));
  }

  function markError(id, error){
    const queue = readQueue();
    const current = queue.find(function(item){ return item.id === clean(id, 180); });
    const attempts = current ? Math.max(0, Number(current.attempts || 0)) + 1 : 1;
    return updateQueueItem(id, { status: 'error', attempts, lastError: clean(error, 360) || 'Error de sincronización local.' });
  }

  function registerError(error){
    const message = clean(error && error.message ? error.message : error, 360) || 'Error del motor de sincronización.';
    return saveState({ status: 'error', label: 'Error', message, lastError: message });
  }

  function initSummary(startedAt){
    return {
      at: startedAt || nowIso(),
      uploaded: 0,
      downloaded: 0,
      conflicts: 0,
      errors: 0,
      skipped: 0,
      configUploaded: 0,
      configDownloaded: 0,
      catalogUploaded: 0,
      catalogDownloaded: 0,
      warnings: [],
      details: []
    };
  }

  function addWarning(summary, message){
    if (!summary) return;
    summary.conflicts += 1;
    summary.warnings.push(clean(message, 260));
  }

  function addError(summary, message){
    if (!summary) return;
    summary.errors += 1;
    summary.warnings.push(clean(message, 260));
  }

  function parseTime(value){
    const raw = clean(value, 80);
    if (!raw) return 0;
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  }

  function compareUpdatedAt(local, remote){
    const lt = parseTime(local && local.updatedAt);
    const rt = parseTime(remote && remote.updatedAt);
    if (lt && rt){
      if (lt > rt) return 1;
      if (rt > lt) return -1;
      return 0;
    }
    if (lt && !rt) return 1;
    if (rt && !lt) return -1;
    return null;
  }

  function stripMeta(record){
    const src = record && typeof record === 'object' ? record : {};
    const out = {};
    Object.keys(src).forEach(function(key){
      if (!META_KEYS.has(key)) out[key] = src[key];
    });
    return out;
  }

  function makeRev(base, deviceId){
    const stamp = clean(base && base.updatedAt, 80) || nowIso();
    const id = clean(base && base.id, 120) || 'record';
    return clean(stamp.replace(/[^0-9a-zA-Z_-]/g, '') + '_' + safePathSegment(deviceId, 'device') + '_' + firebaseKey(id, 'record'), 180);
  }

  function withSyncMeta(record, id, settings, syncKind){
    const now = nowIso();
    const src = record && typeof record === 'object' ? clone(record) || {} : {};
    const deviceId = getDeviceId(settings);
    const existingId = src.id != null && src.id !== '' ? src.id : id;
    const updatedAt = clean(src.updatedAt, 80) || now;
    src.id = existingId;
    src.createdAt = clean(src.createdAt, 80) || updatedAt || now;
    src.updatedAt = updatedAt;
    src.deviceId = clean(src.deviceId, 120) || deviceId;
    src.rev = clean(src.rev, 180) || makeRev(src, deviceId);
    src.deleted = src.deleted === true ? true : false;
    src.schemaVersion = Math.max(1, parseInt(src.schemaVersion || SCHEMA_VERSION, 10) || SCHEMA_VERSION);
    src._syncKind = syncKind || 'record';
    return src;
  }

  function hasObjectMeaning(value){
    if (!value || typeof value !== 'object') return false;
    return Object.keys(stripMeta(value)).some(function(key){
      const v = value[key];
      if (v == null) return false;
      if (typeof v === 'string') return v.trim() !== '';
      if (typeof v === 'number') return Number.isFinite(v) && v !== 0;
      if (typeof v === 'boolean') return true;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'object') return hasObjectMeaning(v);
      return true;
    });
  }

  function normalizeAppearance(value){
    const raw = clean(value, 40).toLowerCase();
    return ['dark', 'light', 'auto'].includes(raw) ? raw : 'dark';
  }

  function readConfigDoc(id){
    if (id === 'identidad') return readJson(CONFIG_KEYS.identity, {});
    if (id === 'apariencia') return { preference: normalizeAppearance(readRaw(CONFIG_KEYS.appearance, 'dark')) };
    if (id === 'reportes') return readJson(CONFIG_KEYS.reports, {});
    if (id === 'moneda'){
      try{
        if (g.A33Currency && typeof g.A33Currency.readSettings === 'function') return g.A33Currency.readSettings();
      }catch(_){ }
      return readJson(CONFIG_KEYS.currency, {});
    }
    if (id === 'pwa'){
      return {
        lastCheck: clean(readRaw(CONFIG_KEYS.pwaLastCheck, ''), 80),
        lastUpdate: clean(readRaw(CONFIG_KEYS.pwaLastUpdate, ''), 80),
        status: clean(readRaw(CONFIG_KEYS.pwaStatus, ''), 80)
      };
    }
    return {};
  }

  function writeConfigDoc(id, value){
    const data = value && typeof value === 'object' ? stripMeta(value) : {};
    if (id === 'identidad') return writeJson(CONFIG_KEYS.identity, data);
    if (id === 'apariencia'){
      const pref = normalizeAppearance(data.preference || data.value || data.mode || data.theme);
      try{
        if (g.A33Theme && typeof g.A33Theme.setPreference === 'function'){
          g.A33Theme.setPreference(pref);
          return true;
        }
      }catch(_){ }
      return writeRaw(CONFIG_KEYS.appearance, pref);
    }
    if (id === 'reportes') return writeJson(CONFIG_KEYS.reports, data);
    if (id === 'moneda'){
      try{
        if (g.A33Currency && typeof g.A33Currency.writeSettings === 'function'){
          const res = g.A33Currency.writeSettings(data);
          return !!(res && res.ok);
        }
      }catch(_){ }
      return writeJson(CONFIG_KEYS.currency, data);
    }
    if (id === 'pwa'){
      let ok = true;
      if (data.lastCheck) ok = writeRaw(CONFIG_KEYS.pwaLastCheck, data.lastCheck) && ok;
      if (data.lastUpdate) ok = writeRaw(CONFIG_KEYS.pwaLastUpdate, data.lastUpdate) && ok;
      if (data.status) ok = writeRaw(CONFIG_KEYS.pwaStatus, data.status) && ok;
      return ok;
    }
    return false;
  }

  function configHasMeaning(id, value){
    const data = value && typeof value === 'object' ? stripMeta(value) : {};
    if (id === 'apariencia') return !!normalizeAppearance(data.preference || data.value || data.mode || data.theme);
    if (id === 'moneda') return hasObjectMeaning(data);
    if (id === 'reportes') return hasObjectMeaning(data);
    if (id === 'pwa') return !!(data.lastCheck || data.lastUpdate || data.status);
    return hasObjectMeaning(data);
  }

  function readRemoteConfig(remote){
    if (!remote || typeof remote !== 'object') return {};
    const data = clone(remote) || {};
    if (data.value && typeof data.value === 'object'){
      const merged = Object.assign({}, data.value);
      ['id','createdAt','updatedAt','deviceId','rev','deleted','schemaVersion','_syncKind'].forEach(function(k){ if (data[k] != null) merged[k] = data[k]; });
      return merged;
    }
    if (typeof data.value === 'string'){
      data.preference = data.value;
      delete data.value;
    }
    return data;
  }

  function buildConfigPayload(id, data, settings){
    const base = stripMeta(data || {});
    if (id === 'apariencia') base.preference = normalizeAppearance(base.preference || base.value || base.mode || base.theme);
    return withSyncMeta(base, id, settings, 'configuracion');
  }

  function shouldProtectLocalConfig(id, local, remote){
    const l = stripMeta(local || {});
    const r = stripMeta(remote || {});
    if (id === 'moneda'){
      const localRate = clean(l.exchangeRate, 40);
      const remoteRate = clean(r.exchangeRate, 40);
      return !!localRate && !remoteRate;
    }
    if (id === 'identidad'){
      return hasObjectMeaning(l) && !hasObjectMeaning(r);
    }
    return false;
  }

  async function syncConfigDoc(db, settings, id, path, summary){
    const fullPath = getWorkspacePath(settings) + '/' + path;
    const ref = db.ref(fullPath);
    const localRaw = readConfigDoc(id);
    const localPayload = buildConfigPayload(id, localRaw, settings);
    const localHasData = configHasMeaning(id, localPayload);
    const snapshot = await ref.once('value');
    const remoteRaw = readRemoteConfig(snapshot && typeof snapshot.val === 'function' ? snapshot.val() : null);
    const remoteHasData = configHasMeaning(id, remoteRaw) && remoteRaw.deleted !== true;

    if (localHasData && !remoteHasData){
      await ref.set(localPayload);
      summary.uploaded += 1;
      summary.configUploaded += 1;
      summary.details.push('Configuración ' + id + ': subida local.');
      return;
    }
    if (!localHasData && remoteHasData){
      const ok = writeConfigDoc(id, remoteRaw);
      if (ok){
        summary.downloaded += 1;
        summary.configDownloaded += 1;
        summary.details.push('Configuración ' + id + ': descargada desde Firebase.');
      } else {
        addError(summary, 'No se pudo guardar Configuración ' + id + ' en cache local.');
      }
      return;
    }
    if (!localHasData && !remoteHasData){
      summary.skipped += 1;
      return;
    }

    if (shouldProtectLocalConfig(id, localPayload, remoteRaw)){
      await ref.set(localPayload);
      summary.uploaded += 1;
      summary.configUploaded += 1;
      summary.details.push('Configuración ' + id + ': local protegido y subido.');
      return;
    }

    const localClean = buildConfigPayload(id, localRaw, settings);
    const remoteClean = buildConfigPayload(id, remoteRaw, settings);
    if (stableJson(stripMeta(localClean)) === stableJson(stripMeta(remoteClean))){
      summary.skipped += 1;
      return;
    }

    const cmp = compareUpdatedAt(localRaw, remoteRaw);
    if (cmp === 1){
      await ref.set(localClean);
      summary.uploaded += 1;
      summary.configUploaded += 1;
      summary.details.push('Configuración ' + id + ': local más reciente.');
    } else if (cmp === -1){
      const ok = writeConfigDoc(id, remoteClean);
      if (ok){
        summary.downloaded += 1;
        summary.configDownloaded += 1;
        summary.details.push('Configuración ' + id + ': remoto más reciente.');
      } else {
        addError(summary, 'No se pudo actualizar Configuración ' + id + ' localmente.');
      }
    } else {
      addWarning(summary, 'Conflicto no decidido en Configuración ' + id + '. Se conservaron ambos lados sin borrar.');
    }
  }

  function openCatalogDb(){
    if (catalogDb) return Promise.resolve(catalogDb);
    return new Promise(function(resolve, reject){
      try{
        if (!g.indexedDB) throw new Error('indexeddb_unavailable');
        const req = g.indexedDB.open(CATALOG_DB_NAME, CATALOG_DB_VERSION);
        req.onupgradeneeded = function(event){
          const d = event.target.result;
          try{
            if (!d.objectStoreNames.contains('products')){
              const p = d.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
              try{ p.createIndex('by_name', 'name', { unique: false }); }catch(_){ }
            }
            if (!d.objectStoreNames.contains('extras')){
              const e = d.createObjectStore('extras', { keyPath: 'id', autoIncrement: true });
              try{ e.createIndex('by_name', 'name', { unique: false }); }catch(_){ }
              try{ e.createIndex('by_active', 'active', { unique: false }); }catch(_){ }
            }
            if (!d.objectStoreNames.contains('banks')){
              const b = d.createObjectStore('banks', { keyPath: 'id', autoIncrement: true });
              try{ b.createIndex('by_name', 'name', { unique: false }); }catch(_){ }
              try{ b.createIndex('by_active', 'isActive', { unique: false }); }catch(_){ }
              try{ b.createIndex('by_type', 'type', { unique: false }); }catch(_){ }
            }
          }catch(_){ }
        };
        req.onsuccess = function(){
          catalogDb = req.result;
          try{ catalogDb.onversionchange = function(){ try{ catalogDb.close(); }catch(_){ } catalogDb = null; }; }catch(_){ }
          resolve(catalogDb);
        };
        req.onerror = function(){ reject(req.error || new Error('indexeddb_open_failed')); };
        req.onblocked = function(){ reject(new Error('indexeddb_blocked')); };
      }catch(error){
        reject(error);
      }
    });
  }

  async function getAllStore(storeName){
    const db = await openCatalogDb();
    if (!db.objectStoreNames.contains(storeName)) return [];
    return new Promise(function(resolve, reject){
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = function(){ resolve(req.result || []); };
      req.onerror = function(){ reject(req.error || tx.error); };
      tx.onerror = function(){ reject(tx.error || req.error); };
    });
  }

  async function putStore(storeName, value){
    const db = await openCatalogDb();
    if (!db.objectStoreNames.contains(storeName)) return false;
    return new Promise(function(resolve, reject){
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(value);
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error || tx.error); };
      tx.onerror = function(){ reject(tx.error || req.error); };
    });
  }

  function normName(value){
    let raw = clean(value, 260).toLowerCase();
    try{ raw = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }catch(_){ }
    return raw.trim().replace(/\s+/g, ' ');
  }

  function normKey(value){ return normName(value).replace(/\s+/g, ''); }

  function syncProductId(record){
    const row = record && typeof record === 'object' ? record : {};
    const direct = clean(row.productId || row.productoId || row.catalogProductId, 160);
    if (direct) return direct;
    const legacyId = clean(row.id, 120);
    return legacyId ? ('prd_legacy_' + legacyId.toLowerCase().replace(/[^a-z0-9_-]+/g, '_')) : '';
  }

  function ensureSyncProductIdentity(record){
    const row = record && typeof record === 'object' ? clone(record) || {} : {};
    if (!clean(row.productId, 160)) row.productId = syncProductId(row);
    if (Object.prototype.hasOwnProperty.call(row, 'productoId')) delete row.productoId;
    return row;
  }

  function duplicateProductKey(record){
    const productId = syncProductId(record);
    return productId ? ('productId:' + productId) : '';
  }

  function duplicateExtraKey(record){
    const name = record && (record.name || record.nombre || record.extraName);
    return 'extra:' + normKey(name);
  }

  function normalizeBankType(value){
    const raw = clean(value, 40).toLowerCase();
    return raw === 'tarjeta' ? 'tarjeta' : 'transferencia';
  }

  function duplicateBankKey(record){
    const name = record && (record.name || record.nombre || record.bankName);
    const type = normalizeBankType(record && (record.type || record.bankType || record.paymentType));
    return 'bank:' + normKey(name) + ':' + type;
  }

  function activeValue(record, spec){
    const r = record && typeof record === 'object' ? record : {};
    if (spec && spec.id === 'bancos') return r.isActive === false || r.active === false ? false : true;
    return r.active === false ? false : true;
  }

  function duplicateScore(record, spec){
    let score = 0;
    if (activeValue(record, spec)) score += 1000;
    if (record && record.id != null) score += 50;
    if (record && clean(record.updatedAt, 80)) score += Math.min(10, parseTime(record.updatedAt) / 1e15);
    return score;
  }

  function normalizeRemoteCollection(value){
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.filter(Boolean).map(function(item, index){
      const row = item && typeof item === 'object' ? clone(item) || {} : {};
      if (row.id == null) row.id = index;
      return row;
    });
    return Object.keys(value).map(function(key){
      const row = value[key] && typeof value[key] === 'object' ? clone(value[key]) || {} : {};
      if (row.id == null || row.id === ''){
        const m = String(key).match(/^id_(\d+)$/);
        row.id = m ? Number(m[1]) : key;
      }
      return row;
    }).filter(function(row){ return row && typeof row === 'object'; });
  }

  function catalogIdentity(record, spec){
    if (spec && spec.id === 'productos') return syncProductId(record);
    const id = record && record.id;
    return id == null ? '' : String(id);
  }

  function catalogRecordKey(record, spec){
    const identity = catalogIdentity(record, spec);
    if (!identity) return '';
    if (!(spec && spec.id === 'productos') && (/^\d+$/.test(identity))) return 'id_' + identity;
    return firebaseKey(identity, 'record');
  }

  function withCatalogSyncMeta(record, settings, spec){
    const row = record && typeof record === 'object' ? record : {};
    const hadLegacyId = row.id != null && row.id !== '';
    const out = withSyncMeta(row, catalogIdentity(row, spec), settings, 'catalogos/' + (spec && spec.id || 'catalogo'));
    if (spec && spec.id === 'productos' && !hadLegacyId) delete out.id;
    return out;
  }

  function catalogMap(records, settings, spec){
    const out = {};
    (Array.isArray(records) ? records : []).forEach(function(record){
      if (!record || typeof record !== 'object') return;
      const normalized = spec && spec.id === 'productos' ? ensureSyncProductIdentity(record) : record;
      const identity = catalogIdentity(normalized, spec);
      const key = catalogRecordKey(normalized, spec);
      if (!key || !identity) return;
      out[key] = withCatalogSyncMeta(normalized, settings, spec);
    });
    return out;
  }

  function localMapById(records, spec){
    const map = new Map();
    (records || []).forEach(function(record){
      if (!record) return;
      const identity = catalogIdentity(record, spec);
      if (!identity) return;
      map.set(String(identity), record);
    });
    return map;
  }

  function prepareRemoteCatalogRecord(remote, spec, localRecords){
    if (!(spec && spec.id === 'productos')) return remote;
    const row = ensureSyncProductIdentity(remote);
    const productId = syncProductId(row);
    const local = (localRecords || []).find(function(item){ return syncProductId(item) === productId; });
    if (local && local.id != null){
      row.id = local.id;
      return row;
    }
    if (!clean(row.origin, 60)) row.origin = 'sincronizacion';
    const legacyId = row.id;
    const idCollision = legacyId != null && (localRecords || []).some(function(item){
      return item && String(item.id) === String(legacyId) && syncProductId(item) !== productId;
    });
    if (idCollision) delete row.id;
    return row;
  }

  function buildDuplicateMap(records, spec){
    const map = new Map();
    (records || []).forEach(function(record){
      if (!record) return;
      const key = spec.duplicateKey(record);
      if (!key || key.endsWith(':') || key === 'name:' || key === 'extra:' || key === 'bank::transferencia') return;
      const current = map.get(key);
      if (!current || duplicateScore(record, spec) > duplicateScore(current, spec)) map.set(key, record);
    });
    return map;
  }


  function readProductTombstones(){
    try{
      if (g.A33ProductIntegrity && typeof g.A33ProductIntegrity.readTombstones === 'function'){
        return g.A33ProductIntegrity.readTombstones();
      }
      if (g.A33Products && typeof g.A33Products.readDeletedMarkers === 'function'){
        return g.A33Products.readDeletedMarkers();
      }
    }catch(_){ }
    return [];
  }

  function isProductTombstoned(productId){
    const target = clean(productId, 160);
    if (!target) return false;
    try{
      if (g.A33ProductIntegrity && typeof g.A33ProductIntegrity.isTombstoned === 'function'){
        return g.A33ProductIntegrity.isTombstoned(target);
      }
      if (g.A33Products && typeof g.A33Products.isDeletedProductId === 'function'){
        return g.A33Products.isDeletedProductId(target);
      }
    }catch(_){ }
    return readProductTombstones().some(function(row){ return clean(row && row.productId, 160) === target; });
  }

  function productsClearlyDistinct(a, b){
    try{
      return !!(g.A33ProductIntegrity && typeof g.A33ProductIntegrity.clearlyDistinct === 'function' && g.A33ProductIntegrity.clearlyDistinct(a, b));
    }catch(_){ return false; }
  }

  async function syncProductTombstones(db, settings, summary){
    const path = getWorkspacePath(settings) + '/catalogos/productos_tombstones';
    const ref = db.ref(path);
    const local = readProductTombstones();
    const snapshot = await ref.once('value');
    const remote = normalizeRemoteCollection(snapshot && typeof snapshot.val === 'function' ? snapshot.val() : null);
    let merged = [];
    try{
      if (g.A33ProductIntegrity && typeof g.A33ProductIntegrity.mergeTombstones === 'function'){
        merged = g.A33ProductIntegrity.mergeTombstones(local, remote);
        g.A33ProductIntegrity.writeTombstones(merged);
        if (typeof g.A33ProductIntegrity.applyTombstonesToCatalog === 'function'){
          const applied = await g.A33ProductIntegrity.applyTombstonesToCatalog({ source:'sincronizacion_nube' });
          if (applied && applied.removed) summary.details.push('Productos: ' + applied.removed + ' registro(s) local(es) retirado(s) por tombstone.');
        }
      } else {
        const map = new Map();
        local.concat(remote).forEach(function(row){
          const id = clean(row && row.productId, 160);
          if (id) map.set(id, row);
        });
        merged = Array.from(map.values());
      }
    }catch(_){ merged = local.slice(); }
    const payload = {};
    merged.forEach(function(row){
      const productId = clean(row && row.productId, 160);
      if (!productId) return;
      payload[firebaseKey(productId, 'product')] = Object.assign({}, clone(row) || {}, {
        productId,
        syncedAt: nowIso(),
        deviceId: getDeviceId(settings),
        schemaVersion: SCHEMA_VERSION
      });
    });
    await ref.set(payload);
    if (merged.length){
      const localIds = new Set(local.map(function(row){ return clean(row && row.productId, 160); }));
      const remoteIds = new Set(remote.map(function(row){ return clean(row && row.productId, 160); }));
      const uploaded = merged.filter(function(row){ return !remoteIds.has(clean(row && row.productId, 160)); }).length;
      const downloaded = merged.filter(function(row){ return !localIds.has(clean(row && row.productId, 160)); }).length;
      summary.uploaded += uploaded;
      summary.downloaded += downloaded;
      summary.details.push('Productos borrados: tombstones sincronizados (' + merged.length + ').');
    }
    return merged;
  }

  async function syncCatalogCollection(db, settings, spec, summary){
    const ref = db.ref(getWorkspacePath(settings) + '/' + spec.path);
    if (spec && spec.id === 'productos' && g.A33Products && typeof g.A33Products.ensureIdentities === 'function'){
      await g.A33Products.ensureIdentities();
    }
    let localRecords = await getAllStore(spec.store);
    if (spec && spec.id === 'productos'){
      localRecords = localRecords.map(ensureSyncProductIdentity).filter(function(row){ return !isProductTombstoned(syncProductId(row)); });
    }
    localRecords = Array.isArray(localRecords) ? localRecords : [];
    const snapshot = await ref.once('value');
    let remoteRecords = normalizeRemoteCollection(snapshot && typeof snapshot.val === 'function' ? snapshot.val() : null).filter(function(row){ return row && row.deleted !== true; });
    if (spec && spec.id === 'productos'){
      remoteRecords = remoteRecords.map(ensureSyncProductIdentity);
      const blockedRemote = remoteRecords.filter(function(row){ return isProductTombstoned(syncProductId(row)); });
      for (const stale of blockedRemote){
        const staleKey = catalogRecordKey(stale, spec);
        if (staleKey){
          try{ await ref.child(staleKey).remove(); }catch(_){ }
        }
      }
      if (blockedRemote.length) summary.details.push('Productos: ' + blockedRemote.length + ' remoto(s) bloqueado(s) por tombstone.');
      remoteRecords = remoteRecords.filter(function(row){ return !isProductTombstoned(syncProductId(row)); });
    }

    if (localRecords.length && !remoteRecords.length){
      await ref.set(catalogMap(localRecords, settings, spec));
      summary.uploaded += localRecords.length;
      summary.catalogUploaded += localRecords.length;
      summary.details.push(spec.label + ': subida inicial local (' + localRecords.length + ').');
      return;
    }

    if (!localRecords.length && remoteRecords.length){
      for (const remote of remoteRecords){
        const prepared = prepareRemoteCatalogRecord(remote, spec, localRecords);
        const identity = catalogIdentity(prepared, spec);
        const insertedKey = await putStore(spec.store, withCatalogSyncMeta(prepared, settings, spec));
        if (prepared.id == null && insertedKey != null) prepared.id = insertedKey;
        localRecords.push(prepared);
        summary.downloaded += 1;
        summary.catalogDownloaded += 1;
      }
      summary.details.push(spec.label + ': descarga inicial remota (' + remoteRecords.length + ').');
      return;
    }

    if (!localRecords.length && !remoteRecords.length){
      summary.skipped += 1;
      return;
    }

    const localById = localMapById(localRecords, spec);
    const remoteById = localMapById(remoteRecords, spec);
    const duplicateMap = buildDuplicateMap(localRecords, spec);
    const allIds = new Set();
    localById.forEach(function(_, id){ allIds.add(id); });
    remoteById.forEach(function(_, id){ allIds.add(id); });

    for (const id of Array.from(allIds)){
      const local = localById.get(id);
      const remote = remoteById.get(id);
      const key = local ? catalogRecordKey(local, spec) : catalogRecordKey(remote, spec);
      const child = ref.child(key || firebaseKey(id, 'record'));

      if (local && !remote){
        await child.set(withCatalogSyncMeta(local, settings, spec));
        summary.uploaded += 1;
        summary.catalogUploaded += 1;
        continue;
      }

      if (!local && remote){
        const dupKey = spec.duplicateKey(remote);
        const dup = duplicateMap.get(dupKey);
        if (dup && catalogIdentity(dup, spec) !== catalogIdentity(remote, spec)){
          addWarning(summary, spec.label + ': identidad duplicada detectada (' + clean(catalogIdentity(remote, spec), 80) + '). No se insertó duplicado local.');
          continue;
        }
        const prepared = prepareRemoteCatalogRecord(remote, spec, localRecords);
        const insertedKey = await putStore(spec.store, withCatalogSyncMeta(prepared, settings, spec));
        if (prepared.id == null && insertedKey != null) prepared.id = insertedKey;
        localRecords.push(prepared);
        summary.downloaded += 1;
        summary.catalogDownloaded += 1;
        continue;
      }

      if (!local || !remote) continue;
      const localClean = withCatalogSyncMeta(local, settings, spec);
      const remoteClean = withCatalogSyncMeta(remote, settings, spec);

      if (spec && spec.id === 'productos' && productsClearlyDistinct(localClean, remoteClean)){
        addWarning(summary, spec.label + ': conflicto seguro de productId ' + clean(id, 80) + '. Los productos son claramente distintos; no se sobrescribió ningún lado.');
        continue;
      }

      if (stableJson(stripMeta(localClean)) === stableJson(stripMeta(remoteClean))){
        summary.skipped += 1;
        continue;
      }

      const cmp = compareUpdatedAt(local, remote);
      if (cmp === 1){
        await child.set(localClean);
        summary.uploaded += 1;
        summary.catalogUploaded += 1;
      } else if (cmp === -1){
        const dupKey = spec.duplicateKey(remoteClean);
        const dup = duplicateMap.get(dupKey);
        if (dup && catalogIdentity(dup, spec) !== catalogIdentity(remoteClean, spec)){
          addWarning(summary, spec.label + ': remoto más reciente duplica identidad. Se conservó local sin borrar.');
          continue;
        }
        const prepared = prepareRemoteCatalogRecord(remoteClean, spec, localRecords);
        await putStore(spec.store, prepared);
        summary.downloaded += 1;
        summary.catalogDownloaded += 1;
      } else {
        addWarning(summary, spec.label + ': conflicto no decidido para id ' + clean(id, 80) + '. Se conservaron ambos lados.');
      }
    }
  }

  function buildNonSensitiveFirebaseMeta(settings){
    const data = settings && typeof settings === 'object' ? settings : readSettings() || {};
    return {
      enabled: !!data.enabled,
      configured: !!data.configured,
      mode: 'hybrid',
      workspaceId: getWorkspaceId(data),
      workspaceName: clean(data.workspaceName, 140),
      environment: clean(data.environment, 40) || 'production',
      deviceId: getDeviceId(data),
      lastConnectionStatus: clean(data.lastConnectionStatus, 80),
      lastConnectionTestAt: clean(data.lastConnectionTestAt, 80),
      lastSyncAt: clean(data.lastSyncAt, 80),
      credentialsStoredLocally: !!(data.credentials && data.configured),
      credentialsSynced: false
    };
  }

  async function writeSyncMeta(db, settings, summary){
    const at = summary && summary.at ? summary.at : nowIso();
    const payload = withSyncMeta({
      id: 'sync',
      lastManualSyncAt: at,
      engineVersion: ENGINE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      localFirst: true,
      scope: ['configuracion', 'catalogos'],
      excluded: ['pos', 'ventas', 'eventos', 'caja_chica', 'cierres', 'finanzas', 'asientos', 'recibos', 'inventario_evento', 'reempaques_historicos', 'pedidos_historicos', 'saldos'],
      summary: clone(summary),
      firebase: buildNonSensitiveFirebaseMeta(settings),
      appVersion: clean((g.A33_RELEASE && g.A33_RELEASE.label) || g.A33_BUILD_TAG || 'Suite A33', 80)
    }, 'sync', settings, '_meta/sync');
    await db.ref(getSyncMetaPath(settings)).set(payload);
  }

  function validateReady(){
    const settings = readSettings();
    const base = getBaseStatus(settings);
    if (base.status !== 'ready'){
      saveState({ status: base.status, label: base.label, message: base.message, lastError: base.status === 'error' ? base.message : state.lastError || '' });
      return { ok: false, settings, status: base.status, message: base.message };
    }
    if (!g.A33Firebase || typeof g.A33Firebase.getRealtimeDatabase !== 'function'){
      const message = 'No se encontró A33Firebase.getRealtimeDatabase para sincronizar.';
      registerError(message);
      return { ok: false, settings, status: 'error', message };
    }
    return { ok: true, settings, status: 'ready', message: READY_MESSAGE };
  }

  function mapError(error){
    const raw = clean((error && (error.code || error.message)) || error || 'sync_error', 420).toLowerCase();
    if (raw.includes('permission')) return 'Firebase respondió, pero las reglas no permiten sincronizar Configuración/Catálogos.';
    if (raw.includes('indexeddb_blocked')) return 'IndexedDB está bloqueado por otra pestaña. Cerrá otras pestañas de Suite A33 e intentá de nuevo.';
    if (raw.includes('indexeddb') || raw.includes('database')) return 'No se pudo leer/escribir la base local de Catálogos.';
    if (raw.includes('network') || raw.includes('failed to fetch') || raw.includes('offline') || raw.includes('load')) return 'Sin conexión o Firebase no respondió. Se conservan datos locales y pendientes.';
    if (raw.includes('readback')) return 'Firebase escribió, pero no confirmó lectura de regreso.';
    return 'No se pudo completar la sincronización manual.';
  }

  async function syncNow(){
    ensureQueue();
    const validation = validateReady();
    const startedAt = nowIso();
    const summary = initSummary(startedAt);
    if (!validation.ok){
      return { ok: false, status: validation.status, message: validation.message, summary, at: startedAt };
    }
    saveState({ status: 'syncing', label: 'Sincronizando', message: 'Sincronizando Configuración y Catálogos…', lastError: '', lastSummary: summary });
    try{
      const settings = validation.settings;
      const db = await g.A33Firebase.getRealtimeDatabase(settings);

      await syncConfigDoc(db, settings, 'identidad', 'configuracion/identidad', summary);
      await syncConfigDoc(db, settings, 'apariencia', 'configuracion/apariencia', summary);
      await syncConfigDoc(db, settings, 'reportes', 'configuracion/reportes', summary);
      await syncConfigDoc(db, settings, 'moneda', 'configuracion/moneda', summary);
      await syncConfigDoc(db, settings, 'pwa', 'configuracion/pwa', summary);

      await syncProductTombstones(db, settings, summary);
      for (const spec of CATALOG_SPECS){
        await syncCatalogCollection(db, settings, spec, summary);
      }

      await writeSyncMeta(db, settings, summary);

      const currentSettings = readSettings();
      if (currentSettings && typeof currentSettings === 'object'){
        currentSettings.lastSyncAt = startedAt;
        currentSettings.lastError = summary.errors ? 'Sincronización parcial con errores.' : '';
        currentSettings.pendingLocalCount = listPending().length;
        currentSettings.updatedAt = currentSettings.updatedAt || startedAt;
        saveSettings(currentSettings);
      }

      const message = 'Sincronización completada · Subidos: ' + summary.uploaded + ' · Descargados: ' + summary.downloaded + ' · Conflictos: ' + summary.conflicts + ' · Errores: ' + summary.errors + '.';
      saveState({
        status: summary.errors ? 'error' : 'ready',
        label: summary.errors ? 'Error parcial' : 'Listo',
        message,
        lastSyncAt: startedAt,
        lastError: summary.errors ? 'Sincronización parcial con errores.' : '',
        uploadedCount: summary.uploaded,
        downloadedCount: summary.downloaded,
        conflictCount: summary.conflicts,
        lastSummary: summary,
        technicalPath: getSyncMetaPath(settings)
      });
      return { ok: summary.errors === 0, status: summary.errors ? 'partial' : 'ready', message, summary, path: getSyncMetaPath(settings), at: startedAt };
    }catch(error){
      const message = mapError(error);
      addError(summary, message);
      saveState({ status: 'error', label: 'Error', message, lastError: message, lastSummary: summary, technicalPath: getSyncMetaPath(validation.settings) });
      return { ok: false, status: 'error', message, summary, path: getSyncMetaPath(validation.settings), at: startedAt };
    }
  }

  async function retryPending(){
    ensureQueue();
    const pending = listPending();
    if (!pending.length){
      return { ok: true, status: 'ready', message: 'No hay pendientes locales en syncQueue.', pendingCount: 0 };
    }
    return syncNow();
  }

  function refreshStatus(){
    ensureQueue();
    return updateStatusFromLocal();
  }

  loadStoredState();
  ensureQueue();
  updateStatusFromLocal();
  try{ g.addEventListener && g.addEventListener('online', refreshStatus); }catch(_){ }
  try{ g.addEventListener && g.addEventListener('offline', refreshStatus); }catch(_){ }

  g.A33CloudSync = Object.assign({}, g.A33CloudSync || {}, {
    version: ENGINE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    queueKey: QUEUE_KEY,
    stateKey: STATE_KEY,
    technicalCollection: TECHNICAL_COLLECTION,
    readyMessage: READY_MESSAGE,
    scopeMessage: SYNC_SCOPE_MESSAGE,
    readSettings,
    getWorkspaceId,
    getDeviceId,
    getTechnicalPath,
    getSyncMetaPath,
    isOnline,
    ensureQueue,
    readQueue,
    writeQueue,
    enqueueChange,
    listPending,
    markSynced,
    markError,
    registerError,
    getStatus,
    refreshStatus,
    syncNow,
    retryPending
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
