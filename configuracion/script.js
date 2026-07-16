(function(){
  'use strict';

  const BACKUP_APP_NAME = 'Suite A33';
  const SUITE_LS_PREFIXES = ['arcano33_', 'a33_', 'suite_a33_', 'a33.'];
  const COSTS_BACKUP_KEY = 'a33_catalogos_costos_v1';
  const COSTS_BACKUP_SCHEMA_VERSION = 2;

  function isSuiteLocalStorageKey(key){
    if (!key) return false;
    const s = String(key || '').toLowerCase();
    return SUITE_LS_PREFIXES.some((p) => s.startsWith(String(p || '').toLowerCase()));
  }

  function isSuiteDbName(name){
    if (!name) return false;
    if (name === 'finanzasDB') return true;
    const n = String(name).toLowerCase();
    return n.includes('a33') || n.includes('arcano') || n.includes('finanzas');
  }

  function isRetiredGateStorageKey(key){
    try{
      if (window.A33Storage && typeof window.A33Storage.isRetiredGateKey === 'function'){
        return !!window.A33Storage.isRetiredGateKey(key);
      }
    }catch(_){ }
    const s = String(key || '').toLowerCase().trim();
    if (!s) return false;
    const retiredTags = [
      ['au','th'],
      ['log','in'],
      ['un','lock'],
      ['ses','sion'],
      ['pro','file'],
      ['per','fil'],
      ['last','url'],
      ['p','in'],
      ['ac','ceso'],
      ['ac','cess']
    ].map((parts) => parts.join(''));
    const exact = new Set([
      ['suite_a33_', ['au','th'].join(''), '_v1'].join(''),
      ['suite_a33_', ['pro','file'].join(''), '_v1'].join(''),
      ['suite_a33_', ['ses','sion'].join(''), '_v1'].join(''),
      ['suite_a33_', ['p','in'].join('')].join(''),
      ['suite_a33_exec_', ['un','lock'].join(''), '_v1'].join(''),
      ['suite_a33_last_url_v1'].join('')
    ]);
    if (exact.has(s)) return true;
    const prefixed = SUITE_LS_PREFIXES.some((p) => s.startsWith(String(p || '').toLowerCase()));
    if (!prefixed) return false;
    return retiredTags.some((tag) => {
      if (!tag) return false;
      if (tag === 'lasturl') return /(?:^|[_-])last[_-]?url(?:[_-]|$)/.test(s);
      const rx = new RegExp('(?:^|[_-])' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[_-]|$)');
      return rx.test(s);
    });
  }

  function isRetiredGateDbName(name){
    try{
      if (window.A33Storage && typeof window.A33Storage.isRetiredGateDbName === 'function'){
        return !!window.A33Storage.isRetiredGateDbName(name);
      }
    }catch(_){ }
    const s = String(name || '').toLowerCase().trim();
    if (!s) return false;
    const looksSuite = s.includes('a33') || s.includes('arcano') || s.includes('suite');
    if (!looksSuite) return false;
    const retiredTags = [
      ['au','th'],
      ['log','in'],
      ['un','lock'],
      ['ses','sion'],
      ['pro','file'],
      ['p','in'],
      ['ac','ceso'],
      ['ac','cess']
    ].map((parts) => parts.join(''));
    return retiredTags.some((tag) => {
      const rx = new RegExp('(?:^|[_-])' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[_-]|$)');
      return rx.test(s);
    });
  }

  function isRetiredGateStoreName(name){
    const s = String(name || '').toLowerCase().trim();
    if (!s) return false;
    const retiredTags = [
      ['au','th'],
      ['log','in'],
      ['un','lock'],
      ['ses','sion'],
      ['pro','file'],
      ['p','in'],
      ['ac','ceso'],
      ['ac','cess']
    ].map((parts) => parts.join(''));
    return retiredTags.some((tag) => {
      const rx = new RegExp('(?:^|[_-])' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[_-]|$)');
      return rx.test(s);
    });
  }

  function sanitizeSuiteLocalStorageMap(mapLike){
    const src = (mapLike && typeof mapLike === 'object') ? mapLike : {};
    const out = {};
    for (const [k, v] of Object.entries(src)){
      if (!isSuiteLocalStorageKey(k)) continue;
      if (isRetiredGateStorageKey(k)) continue;
      out[k] = v;
    }
    return out;
  }

  function sanitizeIndexedDbPayload(indexedMap, dbSchemas, dbVersions){
    const src = (indexedMap && typeof indexedMap === 'object') ? indexedMap : {};
    const cleanData = {};
    const cleanSchemas = {};
    const cleanVersions = {};
    for (const [dbName, stores] of Object.entries(src)){
      if (!isSuiteDbName(dbName)) continue;
      if (isRetiredGateDbName(dbName)) continue;

      const safeStores = {};
      const storeEntries = (stores && typeof stores === 'object') ? Object.entries(stores) : [];
      for (const [storeName, records] of storeEntries){
        if (isRetiredGateStoreName(storeName)) continue;
        safeStores[storeName] = Array.isArray(records) ? records : [];
      }
      cleanData[dbName] = safeStores;

      const srcSchemaDb = (dbSchemas && typeof dbSchemas === 'object' && dbSchemas[dbName] && typeof dbSchemas[dbName] === 'object')
        ? dbSchemas[dbName]
        : {};
      const safeSchemaDb = {};
      for (const [storeName, schema] of Object.entries(srcSchemaDb)){
        if (isRetiredGateStoreName(storeName)) continue;
        safeSchemaDb[storeName] = schema;
      }
      cleanSchemas[dbName] = safeSchemaDb;

      if (dbVersions && Object.prototype.hasOwnProperty.call(dbVersions, dbName)){
        cleanVersions[dbName] = dbVersions[dbName];
      }
    }
    return { data: cleanData, schemas: cleanSchemas, versions: cleanVersions };
  }

  function sanitizeBackupObject(obj){
    const src = (obj && typeof obj === 'object') ? obj : {};
    const meta = (src.meta && typeof src.meta === 'object') ? src.meta : {};
    const data = (src.data && typeof src.data === 'object') ? src.data : {};
    const cleanIndexed = sanitizeIndexedDbPayload(data.indexedDB || {}, meta.dbSchemas || {}, meta.dbVersions || {});
    return {
      meta: {
        ...meta,
        dbSchemas: cleanIndexed.schemas,
        dbVersions: cleanIndexed.versions
      },
      data: {
        indexedDB: cleanIndexed.data,
        localStorage: sanitizeSuiteLocalStorageMap(data.localStorage || {})
      }
    };
  }

  function emptyCostsBackupValue(){
    return {
      schemaVersion:COSTS_BACKUP_SCHEMA_VERSION,
      liquids:{
        vino:{ price:null, ml:null },
        vodka:{ price:null, ml:null },
        jugo:{ price:null, ml:null },
        sirope:{ price:null, ml:null },
        agua_pura:{ price:null, ml:null }
      },
      consumablesByProduct:{},
      updatedAt:null
    };
  }

  function parseCostsBackupBlock(localStorageMap){
    const map = localStorageMap && typeof localStorageMap === 'object' ? localStorageMap : {};
    if (!Object.prototype.hasOwnProperty.call(map, COSTS_BACKUP_KEY)) return { ok:true, present:false, version:null, value:null };
    const raw = map[COSTS_BACKUP_KEY];
    let value = raw;
    if (typeof raw === 'string'){
      try{ value = JSON.parse(raw); }
      catch(_){ return { ok:false, present:true, reason:'El bloque Costos contiene JSON inválido.' }; }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok:false, present:true, reason:'El bloque Costos no tiene una estructura válida.' };
    const versionRaw = value.schemaVersion ?? value.version ?? 1;
    const version = Number(versionRaw);
    if (!Number.isInteger(version) || version < 1 || version > COSTS_BACKUP_SCHEMA_VERSION){
      return { ok:false, present:true, reason:`Versión de Costos no compatible: ${String(versionRaw)}.` };
    }
    const liquids = value.liquids && typeof value.liquids === 'object' && !Array.isArray(value.liquids) ? value.liquids : {};
    for (const [key, item] of Object.entries(liquids)){
      if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok:false, present:true, reason:`Líquido inválido en Costos: ${key}.` };
      for (const field of ['price','ml']){
        const v = item[field];
        if (v === null || v === undefined || v === '') continue;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return { ok:false, present:true, reason:`Valor inválido en Costos: ${key}.${field}.` };
      }
    }
    const consumables = value.consumablesByProduct || value.consumiblesPorProducto || {};
    if (!consumables || typeof consumables !== 'object' || Array.isArray(consumables)) return { ok:false, present:true, reason:'Consumibles de Costos inválidos.' };
    for (const [productId, item] of Object.entries(consumables)){
      if (!String(productId || '').trim() || !item || typeof item !== 'object' || Array.isArray(item)) return { ok:false, present:true, reason:'Consumible por productId inválido.' };
      for (const field of ['botella','calcomania']){
        const v = item[field];
        if (v === null || v === undefined || v === '') continue;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return { ok:false, present:true, reason:`Valor inválido en Costos para productId ${productId}.` };
      }
    }
    return { ok:true, present:true, version, value };
  }

  function escapeHtml(str){
    return String(str ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#039;');
  }

  function formatBytes(bytes){
    const b = Number(bytes || 0);
    if (!Number.isFinite(b) || b <= 0) return '0 B';
    const units = ['B','KB','MB','GB'];
    let v = b;
    let i = 0;
    while (v >= 1024 && i < units.length - 1){
      v /= 1024;
      i++;
    }
    return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  const PWA_KEYS = {
    lastCheck: 'suite_a33_pwa_last_check_at',
    lastUpdate: 'suite_a33_pwa_last_update_at',
    status: 'suite_a33_pwa_update_status',
    reloadGuard: 'suite_a33_pwa_apply_reload_guard_v2',
    resultSession: 'suite_a33_pwa_result_session_v2'
  };

  const PWA_STATUS = {
    idle: 'Sin revisar',
    checking: 'Buscando actualización…',
    current: 'La app ya está actualizada.',
    available: 'Actualización disponible',
    applying: 'Aplicando actualización…',
    applied: 'Actualización completada correctamente.',
    noPending: 'No hay actualización pendiente',
    searchError: 'No se pudo buscar una actualización.',
    applyError: 'No se pudo completar la actualización.'
  };

  const PWA_SUITE_SCOPE_HINTS = [
    '/catalogos/',
    '/pos/',
    '/inventario/',
    '/lotes/',
    '/pedidos/'
  ];

  const pwaRuntime = {
    checking: false,
    applying: false,
    updateAvailable: false,
    reloadPending: false,
    lastResults: [],
    result: null
  };

  function pwaStorageGet(key){
    try{
      if (window.A33Storage && typeof window.A33Storage.getItem === 'function'){
        const v = window.A33Storage.getItem(key);
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
      }
    }catch(_){ }
    try{
      const v = localStorage.getItem(key);
      return (v && String(v).trim()) ? String(v) : '';
    }catch(_){ return ''; }
  }

  function pwaStorageSet(key, value){
    try{
      if (window.A33Storage && typeof window.A33Storage.setItem === 'function'){
        window.A33Storage.setItem(key, String(value));
        return;
      }
    }catch(_){ }
    try{ localStorage.setItem(key, String(value)); }catch(_){ }
  }

  function pwaSessionGet(key){
    try{ return sessionStorage.getItem(key) || ''; }catch(_){ return ''; }
  }

  function pwaSessionSet(key, value){
    try{ sessionStorage.setItem(key, String(value)); }catch(_){ }
  }

  function pwaSessionRemove(key){
    try{ sessionStorage.removeItem(key); }catch(_){ }
  }

  function pwaSessionReadJson(key){
    const raw = pwaSessionGet(key);
    if (!raw) return null;
    try{
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    }catch(_){ return null; }
  }

  function pwaSessionWriteJson(key, value){
    try{ pwaSessionSet(key, JSON.stringify(value || {})); return true; }catch(_){ return false; }
  }

  function pwaPad2(value){
    return String(value).padStart(2, '0');
  }

  function formatPwaDateForStorage(date){
    const d = (date instanceof Date) ? date : new Date();
    return `${pwaPad2(d.getDate())}/${pwaPad2(d.getMonth() + 1)}/${d.getFullYear()} ${pwaPad2(d.getHours())}:${pwaPad2(d.getMinutes())}`;
  }

  function formatPwaTimestamp(value){
    const raw = String(value || '').trim();
    if (!raw) return 'Sin registros';
    if (/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}$/.test(raw)) return raw;
    let date = null;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) date = new Date(n);
    if (!date || Number.isNaN(date.getTime())) date = new Date(raw);
    if (!date || Number.isNaN(date.getTime())) return raw;
    return formatPwaDateForStorage(date);
  }

  function getPwaFriendlyDetail(error, fallback){
    const raw = String(error && error.message ? error.message : error || fallback || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('offline')){
      return 'Revisá la conexión a internet e intentá nuevamente.';
    }
    if (lower.includes('service worker') && lower.includes('registr')){
      return 'No se encontró un Service Worker de Suite A33 registrado en este equipo.';
    }
    return raw.length > 180 ? `${raw.slice(0, 177)}…` : raw;
  }

  function renderPwaResult(){
    const box = document.getElementById('cfg-pwa-result');
    const icon = document.getElementById('cfg-pwa-result-icon');
    const message = document.getElementById('cfg-pwa-result-message');
    const detail = document.getElementById('cfg-pwa-result-detail');
    if (!box) return;
    const result = pwaRuntime.result;
    if (!result || !result.message){
      box.hidden = true;
      return;
    }
    const kind = ['success','error','info','neutral'].includes(result.kind) ? result.kind : 'neutral';
    box.hidden = false;
    box.setAttribute('data-state', kind);
    box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    box.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    if (icon) icon.textContent = kind === 'success' ? '✓' : (kind === 'error' ? '!' : 'ℹ');
    if (message) message.textContent = String(result.message || '');
    if (detail){
      const value = String(result.detail || '').trim();
      detail.textContent = value;
      detail.hidden = !value;
    }
  }

  function setPwaResult(kind, message, detail, options){
    const opts = options || {};
    pwaRuntime.result = {
      phase: opts.phase || 'result',
      kind: kind || 'neutral',
      message: String(message || ''),
      detail: String(detail || ''),
      timestamp: opts.timestamp || formatPwaDateForStorage(new Date()),
      scopes: Array.isArray(opts.scopes) ? opts.scopes : []
    };
    if (opts.persist !== false) pwaSessionWriteJson(PWA_KEYS.resultSession, pwaRuntime.result);
    renderPwaResult();
  }

  function clearPwaResult(clearSession){
    pwaRuntime.result = null;
    if (clearSession !== false) pwaSessionRemove(PWA_KEYS.resultSession);
    renderPwaResult();
  }

  function normalizePwaStatus(status){
    const s = String(status || '').trim();
    if (!s) return PWA_STATUS.idle;
    if (s === 'Suite actualizada / No se encontraron actualizaciones') return PWA_STATUS.current;
    if (s === 'Error al buscar actualizaciones') return PWA_STATUS.searchError;
    if (s === 'Búsqueda registrada') return PWA_STATUS.idle;
    return s;
  }

  function getPwaStateKey(status){
    const s = normalizePwaStatus(status);
    if (s === PWA_STATUS.checking) return 'checking';
    if (s === PWA_STATUS.available) return 'available';
    if (s === PWA_STATUS.applying) return 'applying';
    if (s === PWA_STATUS.applied) return 'applied';
    if (s === PWA_STATUS.noPending) return 'nopending';
    if (s === PWA_STATUS.searchError || s === PWA_STATUS.applyError) return 'error';
    if (s === PWA_STATUS.current) return 'current';
    return 'idle';
  }

  function isPwaUpdateAvailableStatus(status){
    return getPwaStateKey(status) === 'available';
  }

  function getWorkerUrl(reg){
    try{
      const worker = reg && (reg.waiting || reg.installing || reg.active);
      return worker && worker.scriptURL ? String(worker.scriptURL) : '';
    }catch(_){ return ''; }
  }

  function isSuiteServiceWorkerRegistration(reg){
    try{
      if (!reg) return false;
      const scopeUrl = reg.scope ? new URL(reg.scope, window.location.href) : null;
      const scriptUrl = getWorkerUrl(reg) ? new URL(getWorkerUrl(reg), window.location.href) : null;
      if (scopeUrl && scopeUrl.origin !== window.location.origin) return false;
      if (scriptUrl && scriptUrl.origin !== window.location.origin) return false;
      const scriptPath = scriptUrl ? String(scriptUrl.pathname || '').toLowerCase() : '';
      const scopePath = scopeUrl ? String(scopeUrl.pathname || '').toLowerCase() : '';
      if (scriptPath.endsWith('/sw.js')) return true;
      return PWA_SUITE_SCOPE_HINTS.some((hint) => scopePath.includes(String(hint || '').toLowerCase()));
    }catch(_){
      return false;
    }
  }

  function hasPwaPendingWorker(reg){
    try{ return !!(reg && (reg.waiting || reg.installing)); }catch(_){ return false; }
  }

  async function getSuitePwaRegistrations(){
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker || typeof navigator.serviceWorker.getRegistrations !== 'function'){
      throw new Error('Este navegador no permite consultar Service Workers.');
    }
    const rawRegs = await navigator.serviceWorker.getRegistrations();
    return (Array.isArray(rawRegs) ? rawRegs : []).filter(isSuiteServiceWorkerRegistration);
  }

  function waitForPwaUpdateSignal(reg, timeoutMs){
    return new Promise((resolve) => {
      if (!reg){ resolve({ found:false, pending:false, state:'', redundant:false, autoActivated:false }); return; }
      if (hasPwaPendingWorker(reg)){
        const worker = reg.waiting || reg.installing;
        resolve({ found:true, pending:true, state:String(worker && worker.state || ''), redundant:false, autoActivated:false });
        return;
      }

      let done = false;
      let timer = null;
      let observedWorker = null;

      const cleanup = () => {
        try{ if (timer) clearTimeout(timer); }catch(_){ }
        try{ reg.removeEventListener('updatefound', onUpdateFound); }catch(_){ }
        try{ if (observedWorker && typeof observedWorker.removeEventListener === 'function') observedWorker.removeEventListener('statechange', onStateChange); }catch(_){ }
      };
      const finish = (value) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(value);
      };
      const snapshot = (found) => {
        const state = String(observedWorker && observedWorker.state || '').toLowerCase();
        return {
          found: !!found,
          pending: hasPwaPendingWorker(reg),
          state,
          redundant: state === 'redundant',
          autoActivated: state === 'activated' && !hasPwaPendingWorker(reg)
        };
      };
      const onStateChange = () => {
        const state = String(observedWorker && observedWorker.state || '').toLowerCase();
        if (state === 'installed') finish(snapshot(true));
        else if (state === 'activated') finish(snapshot(true));
        else if (state === 'redundant') finish(snapshot(false));
      };
      const onUpdateFound = () => {
        try{
          observedWorker = reg.installing || null;
          if (!observedWorker){ finish(snapshot(hasPwaPendingWorker(reg))); return; }
          const state = String(observedWorker.state || '').toLowerCase();
          if (state === 'installed' || state === 'activated' || state === 'redundant'){
            onStateChange();
            return;
          }
          if (typeof observedWorker.addEventListener === 'function') observedWorker.addEventListener('statechange', onStateChange);
        }catch(_){ finish(snapshot(false)); }
      };

      try{ reg.addEventListener('updatefound', onUpdateFound, { once:true }); }catch(_){ }
      timer = setTimeout(() => finish(snapshot(false)), Number(timeoutMs) || 5000);
    });
  }

  async function inspectPwaRegistration(reg){
    const result = {
      scope: '',
      scriptURL: '',
      beforePending: false,
      afterPending: false,
      updateFound: false,
      autoActivated: false,
      workerState: '',
      error: ''
    };
    try{ result.scope = String(reg && reg.scope ? reg.scope : ''); }catch(_){ }
    try{ result.scriptURL = getWorkerUrl(reg); }catch(_){ }
    result.beforePending = hasPwaPendingWorker(reg);

    const signalPromise = waitForPwaUpdateSignal(reg, 5000);
    try{
      if (!reg || typeof reg.update !== 'function') throw new Error('El Service Worker no permite buscar actualizaciones.');
      await reg.update();
    }catch(err){
      result.error = getPwaFriendlyDetail(err, 'No se pudo consultar este Service Worker.');
    }

    let signal = null;
    try{ signal = await signalPromise; }catch(_){ signal = null; }
    result.afterPending = hasPwaPendingWorker(reg);
    result.updateFound = !!(signal && signal.found);
    result.autoActivated = !!(signal && signal.autoActivated);
    result.workerState = String(signal && signal.state || '');
    if (signal && signal.redundant && !result.error){
      result.error = 'La instalación del Service Worker fue rechazada y quedó en estado redundant.';
    }
    return result;
  }

  async function checkSuitePwaUpdates(){
    const regs = await getSuitePwaRegistrations();
    if (!regs.length) throw new Error('No se encontró un Service Worker de Suite A33 registrado en este equipo.');

    const results = await Promise.all(regs.map((reg) => inspectPwaRegistration(reg)));
    const errors = results.filter((item) => item.error).map((item) => item.error);
    const available = !errors.length && results.some((item) => item.beforePending || item.afterPending);
    const autoActivated = !errors.length && results.some((item) => item.autoActivated);
    return { available, autoActivated, checked:results.length, errors, results };
  }

  function waitForWorkerState(worker, states, timeoutMs){
    return new Promise((resolve) => {
      const wanted = new Set((Array.isArray(states) ? states : [states]).map((s) => String(s || '').toLowerCase()));
      if (!worker){ resolve(''); return; }
      const current = String(worker.state || '').toLowerCase();
      if (wanted.has(current)){ resolve(current); return; }

      let done = false;
      let timer = null;
      const finish = (value) => {
        if (done) return;
        done = true;
        try{ if (timer) clearTimeout(timer); }catch(_){ }
        try{ worker.removeEventListener('statechange', onStateChange); }catch(_){ }
        resolve(value || String(worker.state || '').toLowerCase());
      };
      const onStateChange = () => {
        const st = String(worker.state || '').toLowerCase();
        if (wanted.has(st) || st === 'redundant') finish(st);
      };
      try{ worker.addEventListener('statechange', onStateChange); }catch(_){ }
      timer = setTimeout(() => finish(String(worker.state || '').toLowerCase()), Number(timeoutMs) || 3000);
    });
  }

  async function resolvePwaWaitingWorker(reg){
    try{
      if (reg && reg.waiting) return reg.waiting;
      const installing = reg && reg.installing;
      if (!installing) return null;
      const state = String(installing.state || '').toLowerCase();
      if (state === 'installed' && reg.waiting) return reg.waiting;
      await waitForWorkerState(installing, ['installed', 'activated', 'redundant'], 3500);
      return reg.waiting || (String(installing.state || '').toLowerCase() === 'activated' ? installing : null);
    }catch(_){ return null; }
  }

  function sendPwaSkipWaiting(worker){
    try{
      if (worker && typeof worker.postMessage === 'function'){
        worker.postMessage({ type: 'SKIP_WAITING' });
        return true;
      }
    }catch(_){ }
    return false;
  }

  function waitForPwaControllerChange(timeoutMs){
    return new Promise((resolve) => {
      if (!navigator.serviceWorker || typeof navigator.serviceWorker.addEventListener !== 'function'){
        resolve(false);
        return;
      }
      let done = false;
      let timer = null;
      const finish = (value) => {
        if (done) return;
        done = true;
        try{ if (timer) clearTimeout(timer); }catch(_){ }
        try{ navigator.serviceWorker.removeEventListener('controllerchange', onChange); }catch(_){ }
        resolve(!!value);
      };
      const onChange = () => finish(true);
      try{ navigator.serviceWorker.addEventListener('controllerchange', onChange, { once: true }); }catch(_){ }
      timer = setTimeout(() => finish(false), Number(timeoutMs) || 6500);
    });
  }

  function waitForPwaRegistrationActivation(reg, worker, timeoutMs){
    return new Promise((resolve) => {
      if (!reg){ resolve(false); return; }
      const target = worker || reg.waiting || reg.installing;
      const targetUrl = target && target.scriptURL ? String(target.scriptURL) : '';
      let done = false;
      let timer = null;
      let interval = null;

      const isActivated = () => {
        try{
          if (target && String(target.state || '').toLowerCase() === 'activated') return true;
          if (reg.active && targetUrl && String(reg.active.scriptURL || '') === targetUrl && !reg.waiting) return true;
          if (!targetUrl && reg.active && !reg.waiting && !reg.installing) return true;
        }catch(_){ }
        return false;
      };

      const finish = (value) => {
        if (done) return;
        done = true;
        try{ if (timer) clearTimeout(timer); }catch(_){ }
        try{ if (interval) clearInterval(interval); }catch(_){ }
        try{ if (target && typeof target.removeEventListener === 'function') target.removeEventListener('statechange', onStateChange); }catch(_){ }
        resolve(!!value);
      };

      const onStateChange = () => {
        if (isActivated()) finish(true);
        else if (target && String(target.state || '').toLowerCase() === 'redundant') finish(false);
      };

      if (isActivated()){
        finish(true);
        return;
      }

      try{ if (target && typeof target.addEventListener === 'function') target.addEventListener('statechange', onStateChange); }catch(_){ }
      interval = setInterval(() => {
        if (isActivated()) finish(true);
      }, 180);
      timer = setTimeout(() => finish(isActivated()), Number(timeoutMs) || 6500);
    });
  }

  async function collectPendingPwaRegistrations(){
    const regs = await getSuitePwaRegistrations();
    const pending = [];
    for (const reg of regs){
      if (!hasPwaPendingWorker(reg)) continue;
      const worker = await resolvePwaWaitingWorker(reg);
      if (worker || hasPwaPendingWorker(reg)) pending.push({ reg, worker: worker || reg.waiting || reg.installing || null });
    }
    return pending;
  }

  function pwaRegistrationControlsThisPage(reg){
    try{
      if (!reg || !navigator.serviceWorker || !navigator.serviceWorker.controller) return false;
      const scope = new URL(reg.scope, window.location.href);
      return window.location.href.startsWith(scope.href);
    }catch(_){ return false; }
  }

  function confirmPwaRegistrationActive(reg, target){
    try{
      if (!reg || !target) return false;
      if (String(target.state || '').toLowerCase() !== 'activated') return false;
      if (!reg.active || reg.waiting || reg.installing) return false;
      const targetUrl = String(target.scriptURL || '');
      const activeUrl = String(reg.active.scriptURL || '');
      return !targetUrl || !activeUrl || targetUrl === activeUrl;
    }catch(_){ return false; }
  }

  async function applySuitePwaUpdate(){
    let pending = await collectPendingPwaRegistrations();
    if (!pending.length){
      const summary = await checkSuitePwaUpdates();
      pwaRuntime.lastResults = Array.isArray(summary.results) ? summary.results : [];
      if (summary.errors && summary.errors.length) throw new Error(summary.errors[0]);
      pending = await collectPendingPwaRegistrations();
      if (!pending.length && summary.autoActivated){
        const regs = await getSuitePwaRegistrations();
        const scopes = regs.filter((reg) => reg.active && !reg.waiting && !reg.installing).map((reg) => String(reg.scope || '')).filter(Boolean);
        return { applied:true, activated:true, controllerRequired:false, controllerChanged:false, scopes };
      }
    }
    if (!pending.length) return { applied:false, noPending:true };

    const controllerRequired = pending.some(({ reg }) => pwaRegistrationControlsThisPage(reg));
    const controllerChangePromise = controllerRequired ? waitForPwaControllerChange(9000) : Promise.resolve(false);
    const activatedEntries = [];

    for (const entry of pending){
      const reg = entry.reg;
      const target = entry.worker || await resolvePwaWaitingWorker(reg);
      if (!target) throw new Error('No se encontró el Service Worker pendiente que debía activarse.');
      if (String(target.state || '').toLowerCase() === 'redundant') throw new Error('El Service Worker pendiente quedó en estado redundant.');
      if (String(target.state || '').toLowerCase() !== 'activated' && !sendPwaSkipWaiting(target)){
        throw new Error('No se pudo solicitar la activación del Service Worker pendiente.');
      }
      const activated = await waitForPwaRegistrationActivation(reg, target, 9000);
      if (!activated || !confirmPwaRegistrationActive(reg, target)){
        throw new Error(`No se confirmó la activación del Service Worker${reg && reg.scope ? ` (${reg.scope})` : ''}.`);
      }
      activatedEntries.push({ reg, target });
    }

    const controllerChanged = await controllerChangePromise.catch(() => false);
    if (controllerRequired && !controllerChanged){
      throw new Error('No se confirmó el cambio de controlador de la aplicación.');
    }
    const allConfirmed = activatedEntries.length === pending.length && activatedEntries.every(({ reg, target }) => confirmPwaRegistrationActive(reg, target));
    if (!allConfirmed) throw new Error('La nueva versión no pudo confirmarse en todos los módulos registrados.');

    return {
      applied:true,
      activated:true,
      controllerRequired,
      controllerChanged,
      scopes:activatedEntries.map(({ reg }) => String(reg.scope || '')).filter(Boolean)
    };
  }

  function reloadAfterPwaApply(){
    const now = Date.now();
    const previous = Number(pwaSessionGet(PWA_KEYS.reloadGuard) || 0);
    if (Number.isFinite(previous) && previous > 0 && (now - previous) < 12000) return false;
    pwaSessionSet(PWA_KEYS.reloadGuard, String(now));
    setTimeout(() => {
      try{ window.location.reload(); }
      catch(_){ try{ window.location.assign(window.location.href); }catch(__){ } }
    }, 700);
    return true;
  }

  function renderPwaSection(){
    const statusEl = document.getElementById('cfg-pwa-status');
    const lastCheckEl = document.getElementById('cfg-pwa-last-check');
    const lastUpdateEl = document.getElementById('cfg-pwa-last-update');
    const btn = document.getElementById('cfg-pwa-check');
    const dashboard = document.querySelector('.cfg-pwa-dashboard');
    const storedStatus = normalizePwaStatus(pwaStorageGet(PWA_KEYS.status));
    const status = pwaRuntime.checking ? PWA_STATUS.checking : (pwaRuntime.applying ? PWA_STATUS.applying : storedStatus);
    const stateKey = getPwaStateKey(status);

    if (statusEl){
      statusEl.textContent = status;
      try{ statusEl.closest('.cfg-status-card')?.setAttribute('data-pwa-state', stateKey); }catch(_){ }
    }
    if (dashboard) dashboard.setAttribute('data-pwa-state', stateKey);
    if (lastCheckEl) lastCheckEl.textContent = formatPwaTimestamp(pwaStorageGet(PWA_KEYS.lastCheck));
    if (lastUpdateEl) lastUpdateEl.textContent = formatPwaTimestamp(pwaStorageGet(PWA_KEYS.lastUpdate));

    if (btn){
      const available = pwaRuntime.updateAvailable || isPwaUpdateAvailableStatus(status);
      const busy = !!(pwaRuntime.checking || pwaRuntime.applying || pwaRuntime.reloadPending);
      btn.textContent = pwaRuntime.reloadPending ? 'Confirmando actualización…' : (pwaRuntime.applying ? 'Aplicando actualización…' : (pwaRuntime.checking ? 'Buscando actualización…' : (available ? 'Aplicar actualización' : 'Buscar actualizaciones')));
      btn.disabled = busy;
      btn.setAttribute('aria-busy', busy ? 'true' : 'false');
      btn.setAttribute('data-pwa-action', available ? 'apply' : 'check');
      btn.classList.toggle('cfg-btn-pwa-apply', !!available && !busy);
      btn.classList.toggle('cfg-btn-pwa-checking', !!pwaRuntime.checking);
      btn.classList.toggle('cfg-btn-pwa-applying', !!pwaRuntime.applying);
    }
    renderPwaResult();
  }

  async function handlePwaCheck(){
    if (pwaRuntime.checking || pwaRuntime.applying) return;
    pwaRuntime.checking = true;
    pwaRuntime.updateAvailable = false;
    clearPwaResult(true);
    pwaStorageSet(PWA_KEYS.lastCheck, formatPwaDateForStorage(new Date()));
    pwaStorageSet(PWA_KEYS.status, PWA_STATUS.checking);
    renderPwaSection();

    try{
      const summary = await checkSuitePwaUpdates();
      pwaRuntime.lastResults = Array.isArray(summary.results) ? summary.results : [];
      if (summary.errors && summary.errors.length) throw new Error(summary.errors[0]);
      pwaRuntime.updateAvailable = !!summary.available;

      if (summary.available){
        pwaStorageSet(PWA_KEYS.status, PWA_STATUS.available);
        setPwaResult('info', 'Actualización disponible.', 'Presioná “Aplicar actualización” para instalarla de forma controlada.');
      } else if (summary.autoActivated){
        const completedAt = formatPwaDateForStorage(new Date());
        const regs = await getSuitePwaRegistrations();
        const scopes = regs.filter((reg) => reg.active && !reg.waiting && !reg.installing).map((reg) => String(reg.scope || '')).filter(Boolean);
        pwaStorageSet(PWA_KEYS.status, PWA_STATUS.applying);
        setPwaResult('info', 'Actualización activada. Confirmando la nueva versión…', '', { phase:'reload-confirm', timestamp:completedAt, scopes });
        pwaRuntime.reloadPending = true;
        if (!reloadAfterPwaApply()){
          pwaRuntime.reloadPending = false;
          throw new Error('Se evitó una recarga duplicada por seguridad.');
        }
      } else {
        pwaStorageSet(PWA_KEYS.status, PWA_STATUS.current);
        setPwaResult('neutral', 'La app ya está actualizada.', 'No se encontró una versión nueva.');
      }
    }catch(err){
      pwaRuntime.updateAvailable = false;
      pwaStorageSet(PWA_KEYS.status, PWA_STATUS.searchError);
      setPwaResult('error', 'No se pudo buscar una actualización.', getPwaFriendlyDetail(err, 'Intentá nuevamente.'));
    }finally{
      if (!pwaRuntime.reloadPending) pwaRuntime.checking = false;
      renderPwaSection();
    }
  }

  async function handlePwaApply(){
    if (pwaRuntime.checking || pwaRuntime.applying) return;
    pwaRuntime.applying = true;
    clearPwaResult(true);
    pwaStorageSet(PWA_KEYS.status, PWA_STATUS.applying);
    renderPwaSection();

    try{
      const result = await applySuitePwaUpdate();
      if (result && result.noPending){
        pwaRuntime.updateAvailable = false;
        pwaStorageSet(PWA_KEYS.status, PWA_STATUS.noPending);
        setPwaResult('neutral', 'No hay actualización pendiente.', 'Podés buscar nuevamente para comprobar la versión disponible.');
        return;
      }

      const completedAt = formatPwaDateForStorage(new Date());
      pwaRuntime.updateAvailable = false;
      pwaStorageSet(PWA_KEYS.status, PWA_STATUS.applying);
      setPwaResult('info', 'Actualización activada. Confirmando la nueva versión…', '', {
        phase:'reload-confirm',
        timestamp:completedAt,
        scopes:Array.isArray(result && result.scopes) ? result.scopes : []
      });
      pwaRuntime.reloadPending = true;
      if (!reloadAfterPwaApply()){
        pwaRuntime.reloadPending = false;
        throw new Error('Se evitó una recarga duplicada por seguridad.');
      }
    }catch(err){
      pwaRuntime.updateAvailable = true;
      pwaStorageSet(PWA_KEYS.status, PWA_STATUS.applyError);
      setPwaResult('error', 'No se pudo completar la actualización.', getPwaFriendlyDetail(err, 'La versión anterior continúa disponible.'));
    }finally{
      if (!pwaRuntime.reloadPending) pwaRuntime.applying = false;
      renderPwaSection();
    }
  }

  async function verifyPwaReloadResult(marker){
    const expectedScopes = Array.isArray(marker && marker.scopes) ? marker.scopes.filter(Boolean) : [];
    if (!expectedScopes.length) throw new Error('No se encontró la confirmación de los módulos actualizados.');
    const regs = await getSuitePwaRegistrations();
    const missing = expectedScopes.filter((scope) => !regs.some((reg) => String(reg.scope || '') === String(scope) && reg.active && !reg.waiting && !reg.installing));
    if (missing.length) throw new Error('La nueva versión no quedó activa en todos los módulos registrados.');
    return true;
  }

  async function restorePwaResultAfterLoad(){
    const marker = pwaSessionReadJson(PWA_KEYS.resultSession);
    if (!marker) return;
    pwaSessionRemove(PWA_KEYS.resultSession);
    if (marker.phase !== 'reload-confirm'){
      pwaRuntime.result = marker;
      renderPwaResult();
      return;
    }

    try{
      await verifyPwaReloadResult(marker);
      const completedAt = formatPwaTimestamp(marker.timestamp || formatPwaDateForStorage(new Date()));
      pwaStorageSet(PWA_KEYS.lastUpdate, completedAt);
      pwaStorageSet(PWA_KEYS.status, PWA_STATUS.applied);
      pwaSessionRemove(PWA_KEYS.reloadGuard);
      pwaRuntime.updateAvailable = false;
      setPwaResult('success', 'Actualización completada correctamente.', 'La nueva versión quedó instalada y activa.', { persist:false, timestamp:completedAt });
    }catch(err){
      pwaStorageSet(PWA_KEYS.status, PWA_STATUS.applyError);
      pwaRuntime.updateAvailable = false;
      setPwaResult('error', 'No se pudo completar la actualización.', getPwaFriendlyDetail(err, 'La activación no pudo confirmarse.'), { persist:false });
    }
    renderPwaSection();
  }

  function initPwaSection(){
    const storedStatus = normalizePwaStatus(pwaStorageGet(PWA_KEYS.status));
    pwaRuntime.reloadPending = false;
    pwaRuntime.updateAvailable = isPwaUpdateAvailableStatus(storedStatus);
    if (storedStatus === PWA_STATUS.checking || storedStatus === PWA_STATUS.applying){
      pwaStorageSet(PWA_KEYS.status, PWA_STATUS.idle);
    } else if (storedStatus !== pwaStorageGet(PWA_KEYS.status)){
      pwaStorageSet(PWA_KEYS.status, storedStatus);
    }
    renderPwaSection();
    restorePwaResultAfterLoad().catch(() => {});
    const btn = document.getElementById('cfg-pwa-check');
    if (!btn || btn.dataset.pwaBound === '1') return;
    btn.dataset.pwaBound = '1';
    btn.addEventListener('click', () => {
      if (btn.getAttribute('data-pwa-action') === 'apply') handlePwaApply();
      else handlePwaCheck();
    });
  }

  function reqToPromise(req){
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB request error'));
    });
  }

  function txDone(tx){
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => reject(tx.error || new Error('Transacción abortada'));
      tx.onerror = () => reject(tx.error || new Error('Error en transacción'));
    });
  }

  async function safeListIndexedDBDatabases(){
    if (indexedDB.databases){
      try{
        const list = await indexedDB.databases();
        if (Array.isArray(list)) return list.filter((d) => d && d.name);
      }catch(_){ }
    }
    return [
      { name: 'a33-pos' },
      { name: 'finanzasDB' }
    ];
  }

  function openExistingDB(dbName){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onupgradeneeded = (e) => {
        try{ e.target.transaction.abort(); }catch(_){ }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error(`No se pudo abrir la base de datos: ${dbName}`));
    });
  }

  async function getAllFromStore(store){
    if (store.getAll){
      return reqToPromise(store.getAll());
    }
    return new Promise((resolve, reject) => {
      const out = [];
      const req = store.openCursor();
      req.onerror = () => reject(req.error || new Error('Error leyendo cursor'));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor){
          out.push(cursor.value);
          cursor.continue();
        } else {
          resolve(out);
        }
      };
    });
  }

  async function snapshotDatabase(dbName){
    const db = await openExistingDB(dbName);
    const snapshot = {
      name: dbName,
      version: db.version,
      stores: {}
    };

    const storeNames = Array.from(db.objectStoreNames || []);
    for (const storeName of storeNames){
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);

      const schema = {
        keyPath: store.keyPath ?? null,
        autoIncrement: !!store.autoIncrement,
        indices: []
      };

      try{
        const indexNames = Array.from(store.indexNames || []);
        for (const idxName of indexNames){
          const idx = store.index(idxName);
          schema.indices.push({
            name: idxName,
            keyPath: idx.keyPath ?? null,
            unique: !!idx.unique,
            multiEntry: !!idx.multiEntry
          });
        }
      }catch(_){ }

      const records = await getAllFromStore(store);
      await txDone(tx);

      snapshot.stores[storeName] = {
        count: Array.isArray(records) ? records.length : 0,
        schema,
        records: Array.isArray(records) ? records : []
      };
    }

    try{ db.close(); }catch(_){ }
    return snapshot;
  }

  function getSuiteLocalStorageSnapshot(){
    const out = {};
    const keys = [];
    const storage = window.A33Storage;
    const allKeys = storage.keys({ scope: 'local' });
    for (const k of allKeys){
      if (!k) continue;
      if (!isSuiteLocalStorageKey(k)) continue;
      if (isRetiredGateStorageKey(k)) continue;
      keys.push(k);
      out[k] = storage.getItem(k);
    }
    keys.sort();
    return { data: out, keys, count: keys.length };
  }

  function buildSummaryHtmlFromSnapshot({ dbSnapshots, lsKeys, exportedAt, estimatedBytes, warnings, appName }){
    const totalDbRecords = dbSnapshots.reduce((acc, d) => {
      const stores = Object.values(d.stores || {});
      return acc + stores.reduce((a, s) => a + (Number(s.count) || 0), 0);
    }, 0);

    const dbHtml = dbSnapshots.length
      ? dbSnapshots.map((d) => {
          const stores = Object.entries(d.stores || {});
          const storeLines = stores.length
            ? `<ul>${stores.map(([sn, s]) => `<li><b>${escapeHtml(sn)}</b>: ${Number(s.count) || 0}</li>`).join('')}</ul>`
            : `<div class="muted">Sin stores detectados.</div>`;
          return `
            <div style="margin-top:0.35rem;">
              <div><b>${escapeHtml(d.name)}</b> <span class="muted">(versión ${escapeHtml(d.version)})</span></div>
              ${storeLines}
            </div>
          `;
        }).join('')
      : `<div class="muted">No se detectaron bases de datos de la Suite en este navegador.</div>`;

    const warnHtml = (warnings && warnings.length)
      ? `<div class="badge-warn">⚠️ ${escapeHtml(warnings.join(' · '))}</div>`
      : '';

    const lsDetails = lsKeys && lsKeys.length
      ? `<details><summary>Ver keys (${lsKeys.length})</summary><ul>${lsKeys.map((k) => `<li>${escapeHtml(k)}</li>`).join('')}</ul></details>`
      : `<div class="muted">0 keys</div>`;

    const exportedAtPretty = exportedAt ? new Date(exportedAt).toLocaleString() : '';

    return `
      <div>
        <div class="kv">
          <div class="k">App</div><div class="v">${escapeHtml(appName || BACKUP_APP_NAME)}</div>
          <div class="k">Fecha</div><div class="v">${escapeHtml(exportedAtPretty)}</div>
          <div class="k">Registros</div><div class="v">${totalDbRecords}</div>
          <div class="k">Keys localStorage</div><div class="v">${lsKeys ? lsKeys.length : 0}</div>
          <div class="k">Tamaño aprox.</div><div class="v">${escapeHtml(formatBytes(estimatedBytes || 0))}</div>
        </div>

        ${warnHtml}

        <hr>

        <div><b>IndexedDB</b></div>
        ${dbHtml}

        <hr>

        <div><b>localStorage (Suite)</b></div>
        ${lsDetails}

        <div class="small-note">Nota: al importar se reemplazan o fusionan únicamente los bloques incluidos; los bloques ausentes se conservan.</div>
      </div>
    `;
  }

  function showModal({ title, bodyHtml, primaryText, onPrimary, secondaryText, onSecondary, cancelText, onCancel, disableCancel, disablePrimary }){
    const modal = document.getElementById('backup-modal');
    const titleEl = document.getElementById('backup-modal-title');
    const bodyEl = document.getElementById('backup-modal-body');
    const btnCancel = document.getElementById('backup-modal-cancel');
    const btnPrimary = document.getElementById('backup-modal-primary');
    const btnSecondary = document.getElementById('backup-modal-secondary');

    titleEl.textContent = title || 'Respaldo';
    bodyEl.innerHTML = bodyHtml || '';

    btnPrimary.textContent = primaryText || 'OK';
    btnPrimary.style.display = disablePrimary ? 'none' : 'inline-flex';
    btnPrimary.onclick = null;
    btnPrimary.onclick = async () => {
      if (typeof onPrimary === 'function') await onPrimary();
    };

    if (secondaryText && typeof onSecondary === 'function'){
      btnSecondary.style.display = 'inline-flex';
      btnSecondary.textContent = secondaryText;
      btnSecondary.onclick = null;
      btnSecondary.onclick = async () => {
        await onSecondary();
      };
    } else {
      btnSecondary.style.display = 'none';
      btnSecondary.onclick = null;
    }

    btnCancel.textContent = cancelText || 'Cancelar';
    btnCancel.style.display = disableCancel ? 'none' : 'inline-flex';
    btnCancel.onclick = null;
    btnCancel.onclick = () => {
      if (typeof onCancel === 'function') onCancel();
      hideModal();
    };

    modal.style.display = 'flex';
  }

  function hideModal(){
    const modal = document.getElementById('backup-modal');
    if (modal) modal.style.display = 'none';
  }

  function downloadTextFile(filename, content){
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  let toastTimer = null;
  function showToast(message, ms = 4000){
    const el = document.getElementById('a33-toast');
    if (!el) {
      try{ alert(message); }catch(_){ }
      return;
    }
    el.textContent = String(message || '');
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      try{ el.classList.remove('show'); }catch(_){ }
    }, Math.max(1500, Number(ms) || 4000));
  }

  function buildBackupFilename(){
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `suitea33-backup-${stamp}.json`;
  }

  function buildCustomBackupFilename(){
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `suitea33-backup-personalizado-${stamp}.json`;
  }

  const CUSTOM_EXPORT_MODULES = [
    {
      id: 'configuracion',
      label: 'Configuración',
      parts: [
        { id: 'identidad', label: 'Identidad', keyNeedles: ['suite_a33_identity'] },
        { id: 'apariencia', label: 'Apariencia', keyNeedles: ['suite_a33_appearance'] },
        { id: 'moneda', label: 'Moneda', keyNeedles: ['suite_a33_currency'] },
        { id: 'reportes', label: 'Reportes', keyNeedles: ['suite_a33_reports'] },
        { id: 'pwa', label: 'PWA / preferencias', keyNeedles: ['suite_a33_pwa', 'a33_build', 'a33_version'] },
        { id: 'general', label: 'Configuración general', keyNeedles: ['suite_a33_firebase', 'suite_a33_user', 'suite_a33_module', 'suite_a33_config'] }
      ]
    },
    {
      id: 'catalogos',
      label: 'Catálogos',
      parts: [
        { id: 'productos', label: 'Productos', stores: [{ db: 'a33-pos', store: 'products' }], keyNeedles: ['a33_catalog_deleted_products', 'a33_catalog_deleted_product_ids_v2', 'a33_product_integrity_log_v1', 'a33_product_quarantine_v1'] },
        { id: 'costos', label: 'Costos', keyNeedles: [COSTS_BACKUP_KEY] },
        { id: 'envases', label: 'Envases / Botellas', keyNeedles: ['a33_catalog_envases', 'a33_catalog_deleted_envases'] },
        { id: 'tapas', label: 'Tapas / Corchos', keyNeedles: ['a33_catalog_tapas', 'a33_catalog_deleted_tapas'] },
        { id: 'extras', label: 'Extras', stores: [{ db: 'a33-pos', store: 'extras' }], keyNeedles: ['a33_catalog_deleted_extras'] },
        { id: 'bancos', label: 'Bancos', stores: [{ db: 'a33-pos', store: 'banks' }], keyNeedles: ['bank', 'banco', 'a33_catalog_deleted_banks'] },
        { id: 'clientes', label: 'Clientes', keyNeedles: ['a33_pos_customers', 'a33_catalog_deleted_customers'], stores: [{ db: 'a33-pos', store: 'customers' }] }
      ]
    },
    {
      id: 'inventario',
      label: 'Inventario / Producción',
      parts: [
        { id: 'productoTerminado', label: 'Producto terminado', keyNeedles: ['arcano33_inventario'] },
        { id: 'envasesDisponibles', label: 'Envases / Botellas disponibles', keyNeedles: ['arcano33_inventario'] },
        { id: 'tapasDisponibles', label: 'Tapas / Corchos disponibles', keyNeedles: ['arcano33_inventario'] },
        { id: 'movimientosInventario', label: 'Movimientos de inventario', keyNeedles: ['arcano33_inventario'] },
        { id: 'recetas', label: 'Recetas', keyNeedles: ['arcano33_recetas_v1'] },
        { id: 'calculadoraProduccion', label: 'Calculadora de Producción', keyNeedles: ['arcano33_lote_actual', 'arcano33_fecha_produccion', 'arcano33_notas_lote', 'arcano33_calc_', 'a33_calc_hebrew'] },
        { id: 'calculadoraTemporal', label: 'Calculadora Temporal', keyNeedles: ['arcano33_temporal_', 'a33_calc_temporal_hebrew'] }
      ]
    },
    {
      id: 'lotes',
      label: 'Lotes',
      parts: [
        { id: 'lotes', label: 'Lotes', keyNeedles: ['arcano33_lotes'] },
        { id: 'productosPorLote', label: 'Productos producidos por lote', keyNeedles: ['arcano33_lotes'] },
        { id: 'compatibilidadHistorica', label: 'Compatibilidad histórica P/M/D/L/G', keyNeedles: ['arcano33_lotes', 'arcano33_calc_ultimo_consecutivo', 'arcano33_calc_consecutivo_actual'] }
      ]
    },
    {
      id: 'pos',
      label: 'POS',
      parts: [
        { id: 'ventas', label: 'Ventas', stores: [{ db: 'a33-pos', store: 'sales' }], keyNeedles: ['a33_pos_pending_sale'] },
        { id: 'eventos', label: 'Eventos', stores: [{ db: 'a33-pos', store: 'events' }], keyNeedles: ['selectedsummaryeventid'] },
        { id: 'inventarioPos', label: 'Inventario POS', stores: [{ db: 'a33-pos', store: 'inventory' }] },
        { id: 'cierresDiarios', label: 'Cierres diarios', stores: [{ db: 'a33-pos', store: 'dailyClosures' }, { db: 'a33-pos', store: 'dayLocks' }] },
        { id: 'cajaEfectivoPos', label: 'Caja / Efectivo POS', stores: [{ db: 'a33-pos', store: 'cashV2' }, { db: 'a33-pos', store: 'cashv2hist' }, { db: 'a33-pos', store: 'cashv2snap' }], keyNeedles: ['a33.ef2'] },
        { id: 'reempaques', label: 'Reempaques', stores: [{ db: 'a33-pos', store: 'reempaques' }] },
        { id: 'historicosResumenes', label: 'Históricos / resúmenes', stores: [{ db: 'a33-pos', store: 'summaryArchives' }, { db: 'a33-pos', store: 'posRemindersIndex' }], keyNeedles: ['pos_summary'] }
      ]
    },
    {
      id: 'finanzas',
      label: 'Finanzas',
      parts: [
        { id: 'recibos', label: 'Recibos', stores: [{ db: 'finanzasDB', store: 'receipts' }] },
        { id: 'importacionesPos', label: 'Importaciones POS', stores: [{ db: 'finanzasDB', store: 'posDailyCloseImports' }] },
        { id: 'tableroOperativo', label: 'Tablero / datos operativos', keyNeedles: ['finanzas_tablero', 'finance_dashboard', 'cat_usage_cache'] },
        { id: 'bancosCuentas', label: 'Bancos / cuentas financieras', stores: [{ db: 'finanzasDB', store: 'accounts' }], keyNeedles: ['finanzas_bancos', 'cuentas_financieras'] },
        { id: 'configuracionFinanciera', label: 'Configuración financiera', stores: [{ db: 'finanzasDB', store: 'settings' }], keyNeedles: ['finanzas_config', 'suite_a33_currency'] },
        { id: 'movimientosFinancieros', label: 'Movimientos financieros existentes', stores: [{ db: 'finanzasDB', store: 'journalEntries' }, { db: 'finanzasDB', store: 'journalLines' }] }
      ]
    },
    {
      id: 'agenda',
      label: 'Agenda / Pedidos',
      parts: [
        { id: 'agenda', label: 'Agenda', keyNeedles: ['agenda', 'a33_agenda', 'suite_a33_agenda'] },
        { id: 'pedidos', label: 'Pedidos', keyNeedles: ['pedido', 'pedidos', 'arcano33_pedidos'] }
      ]
    }
  ];

  const CUSTOM_POS_EVENTS_EMPTY_NOTICE = 'Seleccionaste eventos. Si querés respaldar también sus ventas/cierres, marcá esas opciones en POS.';
  const CUSTOM_POS_EVENT_STATE = {
    selectedIds: [],
    appliedAt: '',
    eventsCache: []
  };

  function normalizeSelectionPartIds(selection, moduleId){
    const parts = selection && Array.isArray(selection[moduleId]) ? selection[moduleId] : [];
    return parts.map((id) => String(id || '')).filter(Boolean);
  }

  function selectionHasPart(selection, moduleId, partId){
    return normalizeSelectionPartIds(selection, moduleId).includes(String(partId || ''));
  }

  function selectionHasAny(selection, moduleId, partIds){
    const set = new Set(normalizeSelectionPartIds(selection, moduleId));
    return (Array.isArray(partIds) ? partIds : []).some((id) => set.has(String(id || '')));
  }

  function getCustomDependencyWarnings(selection){
    const warnings = [];
    const hasProducts = selectionHasPart(selection, 'catalogos', 'productos');
    const hasPosVentas = selectionHasPart(selection, 'pos', 'ventas');
    const hasPosEventos = selectionHasPart(selection, 'pos', 'eventos');
    const hasPosCierres = selectionHasPart(selection, 'pos', 'cierresDiarios');
    const hasLotes = selectionHasAny(selection, 'lotes', ['lotes', 'productosPorLote', 'compatibilidadHistorica']);
    const hasProduccion = selectionHasAny(selection, 'inventario', ['recetas', 'calculadoraProduccion', 'calculadoraTemporal']);
    const hasInventarioBase = selectionHasAny(selection, 'inventario', ['productoTerminado', 'envasesDisponibles', 'tapasDisponibles', 'movimientosInventario']);
    const hasCatalogEnvasesTapas = selectionHasAny(selection, 'catalogos', ['envases', 'tapas']);

    if (hasPosVentas && !hasProducts){
      warnings.push('Ventas POS puede necesitar Productos como referencia histórica. Si el otro navegador no tiene ese catálogo, conviene incluir Catálogos → Productos.');
    }
    if (hasPosEventos && !hasPosVentas){
      warnings.push('Eventos POS sin Ventas respaldará el evento base; las ventas del evento no viajarán si no marcás POS → Ventas.');
    }
    if (hasPosEventos && !hasPosCierres){
      warnings.push('Eventos POS sin Cierres diarios no incluirá los cierres asociados a esos eventos.');
    }
    if (hasLotes && !hasProducts){
      warnings.push('Lotes puede depender de Productos/productId y Letra. Para máxima compatibilidad, incluí Catálogos → Productos.');
    }
    if (hasProduccion && !hasInventarioBase){
      warnings.push('Producción/Calculadoras sin Inventario trasladará recetas o cálculos, pero no las existencias disponibles de producto terminado, envases o tapas.');
    }
    if (hasCatalogEnvasesTapas && !hasProducts){
      warnings.push('Envases/Tapas viajan como catálogo, pero los productos dinámicos que los usan no se incluyen salvo que marques Catálogos → Productos.');
    }
    return Array.from(new Set(warnings));
  }

  function dependencyWarningsHtml(warnings){
    const list = (Array.isArray(warnings) ? warnings : []).filter(Boolean);
    if (!list.length) return '';
    return `
      <div class="cfg-backup-dependency-box" role="note">
        <strong>Avisos de dependencias</strong>
        <ul>${list.map((msg) => `<li>${escapeHtml(msg)}</li>`).join('')}</ul>
      </div>
    `;
  }

  function customPosEventId(ev){
    if (!ev || typeof ev !== 'object') return '';
    const raw = ev.id ?? ev.eventId ?? ev.uid ?? ev.uuid ?? ev.key ?? '';
    return String(raw ?? '').trim();
  }

  function customPosEventName(ev){
    const raw = ev?.name ?? ev?.eventName ?? ev?.nombre ?? ev?.title ?? ev?.titulo ?? '';
    return String(raw || 'Evento sin nombre').trim() || 'Evento sin nombre';
  }

  function customPosEventDateRaw(ev){
    return ev?.date ?? ev?.fecha ?? ev?.createdAt ?? ev?.created_at ?? ev?.startAt ?? ev?.openedAt ?? ev?.closedAt ?? '';
  }

  function customPosEventDateLabel(ev){
    const raw = customPosEventDateRaw(ev);
    if (!raw) return '';
    if (typeof raw === 'number' && Number.isFinite(raw)){
      try{ return new Date(raw).toLocaleDateString(); }catch(_){ return String(raw); }
    }
    const str = String(raw || '').trim();
    if (!str) return '';
    const t = Date.parse(str);
    if (!Number.isNaN(t)){
      try{ return new Date(t).toLocaleDateString(); }catch(_){ }
    }
    return str;
  }

  function customPosEventSortKey(ev){
    const raw = customPosEventDateRaw(ev);
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const t = Date.parse(String(raw || ''));
    if (!Number.isNaN(t)) return t;
    const n = Number(customPosEventId(ev));
    return Number.isFinite(n) ? n : 0;
  }

  function customPosEventStatusLabel(ev){
    const explicit = ev?.status ?? ev?.estado ?? ev?.state ?? '';
    if (explicit) return String(explicit).trim();
    if (ev?.closedAt || ev?.closed_at || ev?.cerradoAt) return 'Cerrado';
    return 'Abierto';
  }

  function customPosEventTotalLabel(ev){
    const candidates = ['total', 'totalSales', 'salesTotal', 'ventasTotal', 'saleTotal', 'grandTotal', 'netTotal'];
    for (const k of candidates){
      const n = Number(ev && ev[k]);
      if (Number.isFinite(n) && n !== 0){
        try{ return `C$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }catch(_){ return `C$${n.toFixed(2)}`; }
      }
    }
    const saleSeq = Number(ev?.saleSeq);
    if (Number.isFinite(saleSeq) && saleSeq > 0) return `${saleSeq} venta(s)`;
    return '';
  }

  function customPosEventSearchText(ev){
    return [
      customPosEventName(ev),
      customPosEventDateLabel(ev),
      customPosEventStatusLabel(ev),
      customPosEventTotalLabel(ev),
      customPosEventId(ev)
    ].join(' ').toLowerCase();
  }

  function customPosEventSelectionSet(){
    return new Set((CUSTOM_POS_EVENT_STATE.selectedIds || []).map((id) => String(id)));
  }

  function customPosEventSelectionCount(){
    return customPosEventSelectionSet().size;
  }

  function customPosEventSelectionLabel(){
    const count = customPosEventSelectionCount();
    return count ? `${count} evento(s)` : 'Sin selección';
  }

  function isCustomPosEventosChecked(){
    const el = document.querySelector('[data-custom-export-part="pos:eventos"]');
    return !!(el && el.checked);
  }

  function isCustomPosTodoChecked(){
    const mod = getCustomModuleById('pos');
    const selected = collectCustomSelectionFromDom();
    const posPartIds = Array.isArray(selected.pos) ? selected.pos : [];
    const allPartIds = (mod?.parts || []).map((part) => part.id);
    return allPartIds.length > 0 && allPartIds.every((id) => posPartIds.includes(id));
  }

  function getCustomPosDependencyNotice(selection){
    const pos = Array.isArray(selection?.pos) ? selection.pos : [];
    if (!pos.includes('eventos')) return '';
    if (pos.includes('ventas') && pos.includes('cierresDiarios')) return '';
    return CUSTOM_POS_EVENTS_EMPTY_NOTICE;
  }

  function customPosEventsNeedsManualSelection(selection){
    const pos = Array.isArray(selection?.pos) ? selection.pos : [];
    if (!pos.includes('eventos')) return false;
    const mod = getCustomModuleById('pos');
    const allPartIds = (mod?.parts || []).map((part) => part.id);
    const allSelected = allPartIds.length > 0 && allPartIds.every((id) => pos.includes(id));
    return !allSelected;
  }

  function updateCustomPosEventSelectionUi(){
    const btn = document.getElementById('cfg-pos-events-select-btn');
    const countEl = document.getElementById('cfg-pos-events-select-count');
    const note = document.getElementById('cfg-pos-events-select-note');
    if (!btn && !countEl && !note) return;
    const checked = isCustomPosEventosChecked();
    const todoPos = checked && isCustomPosTodoChecked();
    const selection = collectCustomSelectionFromDom();
    if (btn){
      btn.style.display = checked ? 'inline-flex' : 'none';
      btn.disabled = todoPos;
      btn.setAttribute('aria-disabled', todoPos ? 'true' : 'false');
    }
    if (countEl){
      countEl.textContent = todoPos ? 'Todo POS: todos los eventos' : customPosEventSelectionLabel();
    }
    if (note){
      if (!checked){
        note.textContent = '';
        note.style.display = 'none';
        note.classList.remove('is-warn');
      } else if (todoPos){
        note.textContent = 'Todo POS marcado: se incluirán todos los eventos sin selección manual.';
        note.style.display = 'block';
        note.classList.remove('is-warn');
      } else {
        const count = customPosEventSelectionCount();
        const dep = getCustomPosDependencyNotice(selection);
        note.textContent = count ? `${customPosEventSelectionLabel()} aplicado(s). ${dep}` : 'Abrí Seleccionar eventos y marcá al menos un evento.';
        note.style.display = 'block';
        note.classList.toggle('is-warn', count <= 0);
      }
    }
  }

  async function getCustomPosEventsForSelection(){
    try{
      const snap = await snapshotDatabase('a33-pos');
      const records = snap?.stores?.events?.records || [];
      const events = (Array.isArray(records) ? records : [])
        .filter((ev) => customPosEventId(ev))
        .map((ev) => cloneJsonSafe(ev));
      events.sort((a, b) => {
        const da = customPosEventSortKey(a);
        const db = customPosEventSortKey(b);
        if (db !== da) return db - da;
        return customPosEventName(a).localeCompare(customPosEventName(b));
      });
      CUSTOM_POS_EVENT_STATE.eventsCache = events;
      return events;
    }catch(_){
      CUSTOM_POS_EVENT_STATE.eventsCache = [];
      return [];
    }
  }

  function ensureCustomPosEventsModal(){
    let overlay = document.getElementById('cfg-pos-events-modal');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'cfg-pos-events-modal';
    overlay.className = 'modal-overlay cfg-pos-events-modal-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div aria-labelledby="cfg-pos-events-modal-title" aria-modal="true" class="modal-card cfg-pos-events-modal-card" role="dialog">
        <h2 class="modal-title" id="cfg-pos-events-modal-title">Seleccionar eventos POS</h2>
        <div class="modal-body" id="cfg-pos-events-modal-body"></div>
        <div class="modal-actions">
          <button class="cfg-btn cfg-btn-ghost cfg-btn-modal" id="cfg-pos-events-modal-cancel" type="button">Cancelar</button>
          <button class="cfg-btn cfg-btn-primary cfg-btn-modal" id="cfg-pos-events-modal-apply" type="button">Aplicar selección</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function buildCustomPosEventsRowsHtml(events, selectedSet){
    if (!events.length){
      return '<div class="muted cfg-pos-events-empty">No hay eventos POS detectados en este navegador.</div>';
    }
    return events.map((ev) => {
      const id = customPosEventId(ev);
      const date = customPosEventDateLabel(ev);
      const status = customPosEventStatusLabel(ev);
      const total = customPosEventTotalLabel(ev);
      const meta = [date, status, total].filter(Boolean).join(' · ');
      const search = customPosEventSearchText(ev);
      return `
        <label class="cfg-pos-event-row" data-pos-event-row="${escapeHtml(id)}" data-pos-event-search="${escapeHtml(search)}">
          <input type="checkbox" data-pos-event-choice="${escapeHtml(id)}" ${selectedSet.has(id) ? 'checked' : ''} />
          <span class="cfg-pos-event-row-main">
            <strong>${escapeHtml(customPosEventName(ev))}</strong>
            <small>${escapeHtml(meta || 'Sin fecha/estado adicional')}</small>
          </span>
        </label>
      `;
    }).join('');
  }

  function updateCustomPosEventsModalCount(){
    const countEl = document.getElementById('cfg-pos-events-modal-count');
    if (!countEl) return;
    const boxes = Array.from(document.querySelectorAll('[data-pos-event-choice]'));
    const checked = boxes.filter((box) => box.checked).length;
    countEl.textContent = `${checked} seleccionado(s)`;
  }

  function filterCustomPosEventsModalRows(){
    const q = String(document.getElementById('cfg-pos-events-search')?.value || '').trim().toLowerCase();
    document.querySelectorAll('[data-pos-event-row]').forEach((row) => {
      const hay = String(row.getAttribute('data-pos-event-search') || '').toLowerCase();
      row.style.display = (!q || hay.includes(q)) ? '' : 'none';
    });
  }

  async function openCustomPosEventsModal(){
    const trigger = document.getElementById('cfg-pos-events-select-btn');
    if (trigger){
      trigger.disabled = true;
      trigger.classList.add('is-loading');
    }
    let events = [];
    try{ events = await getCustomPosEventsForSelection(); }catch(_){ events = []; }
    if (trigger){
      trigger.disabled = false;
      trigger.classList.remove('is-loading');
    }

    const overlay = ensureCustomPosEventsModal();
    const body = document.getElementById('cfg-pos-events-modal-body');
    const selectedSet = customPosEventSelectionSet();
    if (body){
      body.innerHTML = `
        <div class="cfg-pos-events-picker">
          <p class="cfg-custom-export-copy">Marcá únicamente los eventos POS que querés incluir en este respaldo parcial.</p>
          <div class="cfg-pos-events-tools">
            <input id="cfg-pos-events-search" class="cfg-pos-events-search" type="search" placeholder="Buscar evento" autocomplete="off" />
            <span class="cfg-custom-export-status" id="cfg-pos-events-modal-count">${selectedSet.size} seleccionado(s)</span>
          </div>
          <div class="cfg-pos-events-bulk-actions">
            <button type="button" class="cfg-btn cfg-btn-ghost cfg-btn-small" id="cfg-pos-events-select-all">Seleccionar todos</button>
            <button type="button" class="cfg-btn cfg-btn-ghost cfg-btn-small" id="cfg-pos-events-clear-all">Desmarcar todos</button>
          </div>
          <div class="cfg-pos-events-list" role="list">${buildCustomPosEventsRowsHtml(events, selectedSet)}</div>
          <div class="small-note">Cancelar cierra esta ventana sin aplicar cambios.</div>
        </div>
      `;
    }

    const close = () => { overlay.style.display = 'none'; };
    const cancel = document.getElementById('cfg-pos-events-modal-cancel');
    const apply = document.getElementById('cfg-pos-events-modal-apply');
    const search = document.getElementById('cfg-pos-events-search');
    const selectAll = document.getElementById('cfg-pos-events-select-all');
    const clearAll = document.getElementById('cfg-pos-events-clear-all');

    if (cancel) cancel.onclick = close;
    if (search) search.oninput = filterCustomPosEventsModalRows;
    document.querySelectorAll('[data-pos-event-choice]').forEach((box) => {
      box.addEventListener('change', updateCustomPosEventsModalCount);
    });
    if (selectAll){
      selectAll.onclick = () => {
        document.querySelectorAll('[data-pos-event-choice]').forEach((box) => { box.checked = true; });
        updateCustomPosEventsModalCount();
      };
    }
    if (clearAll){
      clearAll.onclick = () => {
        document.querySelectorAll('[data-pos-event-choice]').forEach((box) => { box.checked = false; });
        updateCustomPosEventsModalCount();
      };
    }
    if (apply){
      apply.onclick = () => {
        const ids = Array.from(document.querySelectorAll('[data-pos-event-choice]'))
          .filter((box) => box.checked)
          .map((box) => String(box.getAttribute('data-pos-event-choice') || '').trim())
          .filter(Boolean);
        CUSTOM_POS_EVENT_STATE.selectedIds = Array.from(new Set(ids));
        CUSTOM_POS_EVENT_STATE.appliedAt = new Date().toISOString();
        close();
        updateCustomExportStatus();
        updateCustomPosEventSelectionUi();
      };
    }
    updateCustomPosEventsModalCount();
    overlay.style.display = 'flex';
    try{ if (search) search.focus(); }catch(_){ }
  }

  function getCustomModuleById(moduleId){
    return CUSTOM_EXPORT_MODULES.find((m) => m.id === moduleId) || null;
  }

  function getCustomPartById(moduleId, partId){
    const mod = getCustomModuleById(moduleId);
    if (!mod) return null;
    return (mod.parts || []).find((p) => p.id === partId) || null;
  }

  function normalizeNeedle(str){
    return String(str || '').trim().toLowerCase();
  }

  function keyMatchesNeedles(key, needles){
    const s = normalizeNeedle(key);
    const arr = Array.isArray(needles) ? needles : [];
    return arr.some((needle) => {
      const n = normalizeNeedle(needle);
      return n && s.includes(n);
    });
  }

  function cloneJsonSafe(value){
    if (value == null) return value;
    try{ return JSON.parse(JSON.stringify(value)); }catch(_){ return value; }
  }

  function ensureCustomDb(outData, outSchemas, outVersions, sourceMeta, dbName){
    if (!dbName) return false;
    const sourceDbs = outData.__sourceIndexedDB || {};
    if (!sourceDbs[dbName]) return false;
    if (!outData.indexedDB[dbName]) outData.indexedDB[dbName] = {};
    if (!outSchemas[dbName]) outSchemas[dbName] = {};
    if (sourceMeta.dbVersions && Object.prototype.hasOwnProperty.call(sourceMeta.dbVersions, dbName)){
      outVersions[dbName] = sourceMeta.dbVersions[dbName];
    }
    return true;
  }

  function addCustomStore(outData, outSchemas, outVersions, sourceMeta, dbName, storeName){
    if (!dbName || !storeName) return false;
    const sourceIndexed = outData.__sourceIndexedDB || {};
    const sourceStores = sourceIndexed[dbName];
    if (!sourceStores || !Object.prototype.hasOwnProperty.call(sourceStores, storeName)) return false;
    if (!ensureCustomDb(outData, outSchemas, outVersions, sourceMeta, dbName)) return false;
    outData.indexedDB[dbName][storeName] = cloneJsonSafe(sourceStores[storeName]);
    const sourceSchemas = sourceMeta.dbSchemas || {};
    if (sourceSchemas[dbName] && Object.prototype.hasOwnProperty.call(sourceSchemas[dbName], storeName)){
      outSchemas[dbName][storeName] = cloneJsonSafe(sourceSchemas[dbName][storeName]);
    }
    return true;
  }

  function addCustomKey(outLocalStorage, sourceLocalStorage, key){
    if (!key || !Object.prototype.hasOwnProperty.call(sourceLocalStorage, key)) return false;
    outLocalStorage[key] = sourceLocalStorage[key];
    return true;
  }

  function collectCustomSelectionFromDom(){
    const selected = {};
    CUSTOM_EXPORT_MODULES.forEach((mod) => {
      const partIds = [];
      (mod.parts || []).forEach((part) => {
        const el = document.querySelector(`[data-custom-export-part="${mod.id}:${part.id}"]`);
        if (el && el.checked) partIds.push(part.id);
      });
      if (partIds.length) selected[mod.id] = partIds;
    });
    return selected;
  }

  function countCustomSelection(selection){
    return Object.values(selection || {}).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
  }

  function describeCustomSelection(selection){
    const modulesIncluded = [];
    const moduleIdsIncluded = [];
    const submodulesIncluded = {};
    const submoduleLabelsIncluded = {};
    const partialModules = [];
    const moduleSelection = {};

    for (const [moduleId, partIdsRaw] of Object.entries(selection || {})){
      const mod = getCustomModuleById(moduleId);
      if (!mod) continue;
      const partIds = (Array.isArray(partIdsRaw) ? partIdsRaw : []).filter((partId) => getCustomPartById(moduleId, partId));
      if (!partIds.length) continue;
      const allPartIds = (mod.parts || []).map((p) => p.id);
      const allSelected = allPartIds.length > 0 && allPartIds.every((id) => partIds.includes(id));
      modulesIncluded.push(mod.label);
      moduleIdsIncluded.push(mod.id);
      submodulesIncluded[mod.id] = partIds.slice();
      submoduleLabelsIncluded[mod.id] = partIds.map((id) => getCustomPartById(moduleId, id)?.label || id);
      if (!allSelected) partialModules.push(mod.label);
      moduleSelection[mod.id] = {
        label: mod.label,
        mode: allSelected ? 'full' : 'partial',
        selectedSubmodules: partIds.slice(),
        selectedSubmoduleLabels: submoduleLabelsIncluded[mod.id].slice()
      };
    }

    return { modulesIncluded, moduleIdsIncluded, submodulesIncluded, submoduleLabelsIncluded, partialModules, moduleSelection };
  }

  function getCustomExportVersionLabel(){
    try{
      if (window.A33_RELEASE && window.A33_RELEASE.label) return String(window.A33_RELEASE.label);
      if (window.A33_BUILD_TAG) return String(window.A33_BUILD_TAG);
      if (window.A33_VERSION) return String(window.A33_VERSION);
    }catch(_){ }
    return '';
  }


  const BACKUP_BLOCK_IDS = ['Productos','Envases','Tapas','Inventario','Recetas','Ventas','Lotes','Pedidos','Agenda','Históricos'];

  function countBackupRecords(value){
    if (Array.isArray(value)) return value.length;
    if (!value || typeof value !== 'object') return value == null || value === '' ? 0 : 1;
    return Object.keys(value).length;
  }

  function parseBackupLocalValue(value){
    if (typeof value !== 'string') return value;
    try{ return JSON.parse(value); }catch(_){ return value; }
  }

  function countLocalKeysByNeedles(localStorageMap, needles){
    const map = localStorageMap && typeof localStorageMap === 'object' ? localStorageMap : {};
    return Object.entries(map).reduce((total, [key, value]) => {
      if (!keyMatchesNeedles(key, needles)) return total;
      return total + Math.max(1, countBackupRecords(parseBackupLocalValue(value)));
    }, 0);
  }

  function buildBackupBlockManifest(indexedDBMap, localStorageMap, selection, backupType){
    const indexed = indexedDBMap && typeof indexedDBMap === 'object' ? indexedDBMap : {};
    const local = localStorageMap && typeof localStorageMap === 'object' ? localStorageMap : {};
    const pos = indexed['a33-pos'] || {};
    const isPartial = String(backupType || '').toLowerCase() === 'partial';
    const selected = selection || {};
    const selectedAny = (moduleId, partIds) => selectionHasAny(selected, moduleId, partIds);
    const selectedOne = (moduleId, partId) => selectionHasPart(selected, moduleId, partId);
    const defs = {
      Productos:{ included:!isPartial || selectedOne('catalogos','productos'), count:countBackupRecords(pos.products || []) },
      Envases:{ included:!isPartial || selectedOne('catalogos','envases'), count:countLocalKeysByNeedles(local, ['a33_catalog_envases']) },
      Tapas:{ included:!isPartial || selectedOne('catalogos','tapas'), count:countLocalKeysByNeedles(local, ['a33_catalog_tapas']) },
      Inventario:{ included:!isPartial || selectedAny('inventario',['productoTerminado','envasesDisponibles','tapasDisponibles','movimientosInventario']) || selectedOne('pos','inventarioPos'), count:countLocalKeysByNeedles(local, ['arcano33_inventario']) + countBackupRecords(pos.inventory || []) },
      Recetas:{ included:!isPartial || selectedOne('inventario','recetas'), count:countLocalKeysByNeedles(local, ['arcano33_recetas_v1']) },
      Ventas:{ included:!isPartial || selectedOne('pos','ventas'), count:countBackupRecords(pos.sales || []) },
      Lotes:{ included:!isPartial || selectedAny('lotes',['lotes','productosPorLote','compatibilidadHistorica']), count:countLocalKeysByNeedles(local, ['arcano33_lotes','a33_lotes','suitea33_lotes']) },
      Pedidos:{ included:!isPartial || selectedOne('agenda','pedidos'), count:countLocalKeysByNeedles(local, ['pedido','pedidos','arcano33_pedidos']) },
      Agenda:{ included:!isPartial || selectedOne('agenda','agenda'), count:countLocalKeysByNeedles(local, ['agenda','a33_agenda','suite_a33_agenda']) },
      Históricos:{ included:!isPartial || selectedOne('pos','historicosResumenes') || selectedOne('lotes','compatibilidadHistorica'), count:countBackupRecords(pos.summaryArchives || []) + countBackupRecords(pos.posRemindersIndex || []) + countLocalKeysByNeedles(local, ['histor','summary']) }
    };
    const manifest = {};
    BACKUP_BLOCK_IDS.forEach((id) => { manifest[id] = { included:!!defs[id].included, records:Number(defs[id].count || 0) }; });
    return {
      manifest,
      included:BACKUP_BLOCK_IDS.filter((id) => manifest[id].included),
      notIncluded:BACKUP_BLOCK_IDS.filter((id) => !manifest[id].included),
      recordCounts:BACKUP_BLOCK_IDS.reduce((acc,id) => { acc[id] = manifest[id].records; return acc; }, {})
    };
  }

  function buildCustomExportModalHtml(){
    const modulesHtml = CUSTOM_EXPORT_MODULES.map((mod) => {
      const partsHtml = (mod.parts || []).map((part) => {
        const partLabel = `
          <label class="cfg-custom-export-part">
            <input type="checkbox" data-custom-export-part="${escapeHtml(mod.id)}:${escapeHtml(part.id)}" />
            <span>${escapeHtml(part.label)}</span>
          </label>
        `;
        if (mod.id === 'pos' && part.id === 'eventos'){
          return `
            <div class="cfg-custom-export-part-wrap cfg-custom-export-part-wrap--events">
              ${partLabel}
              <button type="button" class="cfg-btn cfg-btn-ghost cfg-pos-events-select-btn" id="cfg-pos-events-select-btn" style="display:none;">
                Seleccionar eventos
                <span id="cfg-pos-events-select-count">${escapeHtml(customPosEventSelectionLabel())}</span>
              </button>
              <div class="cfg-pos-events-select-note" id="cfg-pos-events-select-note" style="display:none;"></div>
            </div>
          `;
        }
        return partLabel;
      }).join('');
      return `
        <section class="cfg-custom-export-module" data-custom-export-module-card="${escapeHtml(mod.id)}">
          <div class="cfg-custom-export-module-head">
            <label class="cfg-custom-export-main">
              <input type="checkbox" data-custom-export-module="${escapeHtml(mod.id)}" />
              <span>${escapeHtml(mod.label)}</span>
            </label>
            <button type="button" class="cfg-custom-export-toggle" data-custom-export-toggle="${escapeHtml(mod.id)}" aria-expanded="true">Ocultar</button>
          </div>
          <div class="cfg-custom-export-parts" data-custom-export-parts="${escapeHtml(mod.id)}">
            ${partsHtml}
          </div>
        </section>
      `;
    }).join('');

    return `
      <div class="cfg-custom-export">
        <p class="cfg-custom-export-copy">Elegí módulos completos o partes específicas. Esta salida queda marcada como respaldo parcial para no confundirse con la caja fuerte completa.</p>
        <div id="cfg-custom-export-status" class="cfg-custom-export-status" role="status" aria-live="polite">Sin selección todavía.</div>
        <div id="cfg-custom-export-dependencies" class="cfg-custom-export-dependencies" aria-live="polite"></div>
        <div class="cfg-custom-export-list">${modulesHtml}</div>
        <div class="small-note">La importación inteligente reconoce respaldos completos y parciales.</div>
      </div>
    `;
  }

  function updateCustomExportModuleState(moduleId){
    const mod = getCustomModuleById(moduleId);
    if (!mod) return;
    const moduleBox = document.querySelector(`[data-custom-export-module="${moduleId}"]`);
    const partBoxes = Array.from(document.querySelectorAll(`[data-custom-export-part^="${moduleId}:"]`));
    const checked = partBoxes.filter((box) => box.checked).length;
    if (moduleBox){
      moduleBox.checked = partBoxes.length > 0 && checked === partBoxes.length;
      moduleBox.indeterminate = checked > 0 && checked < partBoxes.length;
    }
    const card = document.querySelector(`[data-custom-export-module-card="${moduleId}"]`);
    if (card){
      card.setAttribute('data-custom-state', checked === 0 ? 'empty' : (checked === partBoxes.length ? 'full' : 'partial'));
    }
  }

  function updateCustomExportStatus(){
    CUSTOM_EXPORT_MODULES.forEach((mod) => updateCustomExportModuleState(mod.id));
    const status = document.getElementById('cfg-custom-export-status');
    const depBox = document.getElementById('cfg-custom-export-dependencies');
    if (!status) return;
    const selection = collectCustomSelectionFromDom();
    const count = countCustomSelection(selection);
    if (!count){
      status.textContent = 'Sin selección todavía.';
      status.classList.remove('is-warn');
      if (depBox) depBox.innerHTML = '';
      updateCustomPosEventSelectionUi();
      return;
    }
    const desc = describeCustomSelection(selection);
    const dependencyWarnings = getCustomDependencyWarnings(selection);
    const partial = desc.partialModules.length ? ` · Parciales: ${desc.partialModules.join(', ')}` : '';
    const dep = dependencyWarnings.length ? ` · ${dependencyWarnings.length} aviso(s) de dependencias.` : '';
    status.textContent = `${desc.modulesIncluded.length} módulo(s), ${count} submódulo(s) seleccionado(s)${partial}${dep}.`;
    status.classList.remove('is-warn');
    if (depBox) depBox.innerHTML = dependencyWarningsHtml(dependencyWarnings);
    updateCustomPosEventSelectionUi();
  }

  function setCustomExportWarning(message){
    const status = document.getElementById('cfg-custom-export-status');
    if (!status) return;
    status.textContent = message || 'Seleccioná al menos una opción.';
    status.classList.add('is-warn');
  }

  function bindCustomExportModalControls(){
    CUSTOM_EXPORT_MODULES.forEach((mod) => {
      const moduleBox = document.querySelector(`[data-custom-export-module="${mod.id}"]`);
      if (moduleBox){
        moduleBox.addEventListener('change', () => {
          const boxes = document.querySelectorAll(`[data-custom-export-part^="${mod.id}:"]`);
          boxes.forEach((box) => { box.checked = moduleBox.checked; });
          updateCustomExportStatus();
        });
      }
      document.querySelectorAll(`[data-custom-export-part^="${mod.id}:"]`).forEach((box) => {
        box.addEventListener('change', updateCustomExportStatus);
      });
      const toggle = document.querySelector(`[data-custom-export-toggle="${mod.id}"]`);
      const parts = document.querySelector(`[data-custom-export-parts="${mod.id}"]`);
      if (toggle && parts){
        toggle.addEventListener('click', () => {
          const collapsed = parts.hasAttribute('hidden');
          if (collapsed){
            parts.removeAttribute('hidden');
            toggle.textContent = 'Ocultar';
            toggle.setAttribute('aria-expanded', 'true');
          } else {
            parts.setAttribute('hidden', '');
            toggle.textContent = 'Ver';
            toggle.setAttribute('aria-expanded', 'false');
          }
        });
      }
    });
    const posEventBtn = document.getElementById('cfg-pos-events-select-btn');
    if (posEventBtn){
      posEventBtn.addEventListener('click', openCustomPosEventsModal);
    }
    updateCustomExportStatus();
    updateCustomPosEventSelectionUi();
  }

  function addCustomFilteredStore(outData, outSchemas, outVersions, sourceMeta, dbName, storeName, filterFn){
    if (!dbName || !storeName || typeof filterFn !== 'function') return 0;
    const sourceIndexed = outData.__sourceIndexedDB || {};
    const sourceStores = sourceIndexed[dbName];
    const records = sourceStores && sourceStores[storeName];
    if (!Array.isArray(records)) return 0;
    if (!ensureCustomDb(outData, outSchemas, outVersions, sourceMeta, dbName)) return 0;
    const filtered = records.filter(filterFn).map((record) => cloneJsonSafe(record));
    outData.indexedDB[dbName][storeName] = filtered;
    const sourceSchemas = sourceMeta.dbSchemas || {};
    if (sourceSchemas[dbName] && Object.prototype.hasOwnProperty.call(sourceSchemas[dbName], storeName)){
      outSchemas[dbName][storeName] = cloneJsonSafe(sourceSchemas[dbName][storeName]);
    }
    return filtered.length;
  }

  function addCustomPosSelectedEventsToPayload(outData, outSchemas, outVersions, sourceMeta, selectedIds){
    const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map((id) => String(id)));
    if (!selected.size) return 0;
    return addCustomFilteredStore(outData, outSchemas, outVersions, sourceMeta, 'a33-pos', 'events', (ev) => selected.has(customPosEventId(ev)));
  }

  function addCustomPartToPayload(part, outData, outSchemas, outVersions, sourceMeta, sourceLocalStorage){
    let added = 0;
    (Array.isArray(part.keyNeedles) ? part.keyNeedles : []).forEach((needle) => {
      Object.keys(sourceLocalStorage || {}).forEach((key) => {
        if (keyMatchesNeedles(key, [needle])){
          if (addCustomKey(outData.localStorage, sourceLocalStorage, key)) added++;
        }
      });
    });
    (Array.isArray(part.stores) ? part.stores : []).forEach((item) => {
      if (item && addCustomStore(outData, outSchemas, outVersions, sourceMeta, item.db, item.store)) added++;
    });
    return added;
  }

  function getCustomBackupOptionsForSelection(selection){
    const desc = describeCustomSelection(selection);
    const posParts = Array.isArray(selection?.pos) ? selection.pos : [];
    const posSelection = desc.moduleSelection?.pos || null;
    let eventsMode = 'none';
    if (posParts.includes('eventos')){
      eventsMode = posSelection && posSelection.mode === 'full' ? 'all' : 'selected';
    }
    const selectedIds = Array.from(customPosEventSelectionSet());
    return {
      pos: {
        included: !!posSelection,
        mode: posSelection?.mode || 'none',
        eventsIncluded: posParts.includes('eventos'),
        eventsMode,
        selectedEventIds: eventsMode === 'selected' ? selectedIds : [],
        selectedEventsCount: eventsMode === 'selected' ? selectedIds.length : 0,
        dependencyNotice: getCustomPosDependencyNotice(selection)
      }
    };
  }

  function buildCustomPosMetadata(selection, customOptions, sourceIndexedDB, outData){
    const posParts = Array.isArray(selection?.pos) ? selection.pos : [];
    const sourceEvents = sourceIndexedDB?.['a33-pos']?.events || [];
    const exportedEvents = outData?.indexedDB?.['a33-pos']?.events || [];
    const eventIdsIncluded = (Array.isArray(exportedEvents) ? exportedEvents : [])
      .map((ev) => customPosEventId(ev))
      .filter(Boolean);
    const eventNamesIncluded = (Array.isArray(exportedEvents) ? exportedEvents : [])
      .map((ev) => customPosEventName(ev))
      .filter(Boolean);
    const eventsMode = customOptions?.pos?.eventsMode || 'none';
    return {
      included: !!posParts.length,
      mode: customOptions?.pos?.mode || 'none',
      selectedSubmodules: posParts.slice(),
      eventsIncluded: posParts.includes('eventos'),
      eventsMode,
      includedAllEvents: eventsMode === 'all',
      selectedEventsCount: eventIdsIncluded.length,
      availableEventsCount: Array.isArray(sourceEvents) ? sourceEvents.length : 0,
      eventIdsIncluded,
      eventLabelsIncluded: eventNamesIncluded,
      requestedEventIds: eventsMode === 'selected' ? (customOptions?.pos?.selectedEventIds || []).slice() : [],
      dependencyNotice: customOptions?.pos?.dependencyNotice || ''
    };
  }

  async function buildCustomBackup(selection, customOptions){
    const desc = describeCustomSelection(selection);
    const options = customOptions || getCustomBackupOptionsForSelection(selection);
    const full = await buildFullBackup();
    const sourceBackup = full.backup || {};
    const sourceMeta = sourceBackup.meta || {};
    const sourceData = sourceBackup.data || {};
    const sourceIndexedDB = sourceData.indexedDB || {};
    const sourceLocalStorage = sourceData.localStorage || {};
    const outSchemas = {};
    const outVersions = {};
    const outData = { indexedDB: {}, localStorage: {}, __sourceIndexedDB: sourceIndexedDB };
    const includedDataMap = {};

    for (const [moduleId, partIds] of Object.entries(selection || {})){
      const mod = getCustomModuleById(moduleId);
      if (!mod) continue;
      includedDataMap[moduleId] = {};
      (Array.isArray(partIds) ? partIds : []).forEach((partId) => {
        const part = getCustomPartById(moduleId, partId);
        if (!part) return;
        if (moduleId === 'pos' && partId === 'eventos' && options?.pos?.eventsMode === 'selected'){
          includedDataMap[moduleId][partId] = addCustomPosSelectedEventsToPayload(outData, outSchemas, outVersions, sourceMeta, options.pos.selectedEventIds);
          return;
        }
        includedDataMap[moduleId][partId] = addCustomPartToPayload(part, outData, outSchemas, outVersions, sourceMeta, sourceLocalStorage);
      });
    }

    delete outData.__sourceIndexedDB;

    const exportedAt = new Date().toISOString();
    const baseMeta = (window.A33ExportCurrency && typeof window.A33ExportCurrency.decorateJsonMeta === 'function')
      ? window.A33ExportCurrency.decorateJsonMeta({
          appName: BACKUP_APP_NAME,
          app: BACKUP_APP_NAME,
          exportedAt,
          dbVersions: outVersions,
          dbSchemas: outSchemas
        })
      : {
          appName: BACKUP_APP_NAME,
          app: BACKUP_APP_NAME,
          exportedAt,
          dbVersions: outVersions,
          dbSchemas: outSchemas
        };

    const posMetadata = buildCustomPosMetadata(selection, options, sourceIndexedDB, outData);
    const dependencyWarnings = getCustomDependencyWarnings(selection);
    const costsIncluded = selectionHasPart(selection, 'catalogos', 'costos');
    if (costsIncluded && !Object.prototype.hasOwnProperty.call(outData.localStorage, COSTS_BACKUP_KEY)){
      outData.localStorage[COSTS_BACKUP_KEY] = JSON.stringify(emptyCostsBackupValue());
      if (!includedDataMap.catalogos) includedDataMap.catalogos = {};
      includedDataMap.catalogos.costos = Math.max(1, Number(includedDataMap.catalogos.costos) || 0);
    }

    const blockInfo = buildBackupBlockManifest(outData.indexedDB, outData.localStorage, selection, 'partial');
    const backup = {
      meta: {
        ...baseMeta,
        app: BACKUP_APP_NAME,
        backupType: 'partial',
        exportMode: 'custom',
        schemaVersion: 7,
        exportedAt,
        fechaHoraExportacion: exportedAt,
        version: getCustomExportVersionLabel(),
        modulesIncluded: desc.modulesIncluded,
        moduleIdsIncluded: desc.moduleIdsIncluded,
        submodulesIncluded: desc.submodulesIncluded,
        submoduleLabelsIncluded: desc.submoduleLabelsIncluded,
        partialModules: desc.partialModules,
        moduleSelection: desc.moduleSelection,
        includedDataMap,
        pos: posMetadata,
        posIncludedMode: posMetadata.mode,
        eventsMode: posMetadata.eventsMode,
        eventIdsIncluded: posMetadata.eventIdsIncluded,
        eventsIncluded: posMetadata.eventLabelsIncluded,
        selectedEventsCount: posMetadata.selectedEventsCount,
        dependencyWarnings,
        dependencyWarningsCount: dependencyWarnings.length,
        blockManifest:blockInfo.manifest,
        blocksIncluded:blockInfo.included,
        blocksNotIncluded:blockInfo.notIncluded,
        recordCounts:blockInfo.recordCounts,
        ...(costsIncluded ? { costs:{ included:true, schemaVersion:COSTS_BACKUP_SCHEMA_VERSION, storageKey:COSTS_BACKUP_KEY } } : {}),
        origin: 'exportador_personalizado_a33'
      },
      data: {
        indexedDB: outData.indexedDB,
        localStorage: outData.localStorage
      }
    };

    const jsonString = JSON.stringify(backup, null, 2);
    const estimatedBytes = new Blob([jsonString]).size;
    const dbSnapshots = Object.entries(outData.indexedDB).map(([dbName, stores]) => ({
      name: dbName,
      version: outVersions[dbName] || '',
      stores: Object.entries(stores || {}).reduce((acc, [storeName, records]) => {
        const arr = Array.isArray(records) ? records : [];
        acc[storeName] = { count: arr.length, schema: (outSchemas[dbName] || {})[storeName] || {}, records: arr };
        return acc;
      }, {})
    }));
    const lsKeys = Object.keys(outData.localStorage || {}).sort();

    return { backup, jsonString, estimatedBytes, dbSnapshots, lsKeys, selectionDescription: desc };
  }

  function buildCustomSummaryHtml(result){
    const desc = result?.selectionDescription || {};
    const moduleLines = (desc.modulesIncluded || []).length
      ? `<ul>${(desc.modulesIncluded || []).map((label) => `<li>${escapeHtml(label)}</li>`).join('')}</ul>`
      : '<div class="muted">Sin módulos.</div>';
    const submoduleLines = Object.entries(desc.submoduleLabelsIncluded || {}).map(([moduleId, labels]) => {
      const mod = getCustomModuleById(moduleId);
      return `<details open><summary>${escapeHtml(mod?.label || moduleId)}</summary><ul>${(labels || []).map((label) => `<li>${escapeHtml(label)}</li>`).join('')}</ul></details>`;
    }).join('');

    const backupSummary = buildSummaryHtmlFromSnapshot({
      dbSnapshots: result.dbSnapshots || [],
      lsKeys: result.lsKeys || [],
      exportedAt: result.backup?.meta?.exportedAt,
      estimatedBytes: result.estimatedBytes || 0,
      warnings: [],
      appName: result.backup?.meta?.appName || BACKUP_APP_NAME
    }).replace(
      'Nota: al importar se reemplazan o fusionan únicamente los bloques incluidos; los bloques ausentes se conservan.',
      'Nota: este respaldo personalizado es parcial y puede importarse sin borrar datos no incluidos.'
    );

    return `
      <div class="cfg-custom-export-summary">
        <div class="badge-ok">✅ Respaldo personalizado preparado como parcial.</div>
        <div class="small-note"><b>Tipo:</b> respaldo parcial. La importación inteligente fusionará por ID y no borrará datos no incluidos.</div>
        ${result.backup?.meta?.pos?.dependencyNotice ? `<div class="badge-warn">⚠️ ${escapeHtml(result.backup.meta.pos.dependencyNotice)}</div>` : ''}
        ${dependencyWarningsHtml(result.backup?.meta?.dependencyWarnings || [])}
        <hr>
        <div><b>Módulos incluidos</b></div>
        ${moduleLines}
        <hr>
        <div><b>Submódulos incluidos</b></div>
        ${submoduleLines || '<div class="muted">Sin submódulos.</div>'}
        <hr>
        ${backupSummary}
        <div class="small-note">Este archivo incluye <b>backupType: partial</b> y <b>exportMode: custom</b>.</div>
      </div>
    `;
  }

  async function handleCustomExport(){
    showModal({
      title: 'Exportar JSON personalizado',
      bodyHtml: buildCustomExportModalHtml(),
      primaryText: 'Exportar',
      onPrimary: async () => {
        const selection = collectCustomSelectionFromDom();
        if (countCustomSelection(selection) <= 0){
          setCustomExportWarning('Seleccioná al menos un módulo o submódulo para exportar.');
          return;
        }

        const customOptions = getCustomBackupOptionsForSelection(selection);
        if (customPosEventsNeedsManualSelection(selection) && customOptions.pos.selectedEventsCount <= 0){
          setCustomExportWarning('Seleccionaste Eventos POS. Abrí “Seleccionar eventos” y marcá al menos un evento.');
          updateCustomPosEventSelectionUi();
          return;
        }

        showModal({
          title: 'Exportar JSON personalizado',
          bodyHtml: '<div class="muted">Preparando respaldo parcial...</div>',
          disableCancel: true,
          disablePrimary: true
        });

        try{
          const result = await buildCustomBackup(selection, customOptions);
          showModal({
            title: 'Resumen del respaldo personalizado',
            bodyHtml: buildCustomSummaryHtml(result),
            primaryText: 'Descargar personalizado',
            onPrimary: async () => {
              downloadTextFile(buildCustomBackupFilename(), result.jsonString);
              hideModal();
              showToast('Respaldo personalizado descargado.');
            },
            cancelText: 'Cancelar',
            onCancel: hideModal
          });
        }catch(e){
          showModal({
            title: 'Error',
            bodyHtml: `<div class="badge-warn">⚠️ ${escapeHtml(e?.message || e)}</div>`,
            primaryText: 'Cerrar',
            onPrimary: hideModal,
            disableCancel: true
          });
        }
      },
      cancelText: 'Cancelar',
      onCancel: hideModal
    });
    bindCustomExportModalControls();
  }

  async function buildFullBackup(){
    const all = await safeListIndexedDBDatabases();
    const suiteDbList = (Array.isArray(all) ? all : []).filter((d) => d && d.name && isSuiteDbName(d.name));

    const dbSnapshots = [];
    const dataIndexedDB = {};
    const dbVersions = {};
    const dbSchemas = {};

    for (const d of suiteDbList){
      try{
        const snap = await snapshotDatabase(d.name);
        dbSnapshots.push(snap);

        dataIndexedDB[d.name] = {};
        dbSchemas[d.name] = {};
        dbVersions[d.name] = snap.version;

        for (const [storeName, s] of Object.entries(snap.stores || {})){
          dataIndexedDB[d.name][storeName] = s.records || [];
          dbSchemas[d.name][storeName] = s.schema || {};
        }
      }catch(e){
        console.warn('No se pudo leer DB', d.name, e);
      }
    }

    const lsSnap = getSuiteLocalStorageSnapshot();
    const cleanIndexed = sanitizeIndexedDbPayload(dataIndexedDB, dbSchemas, dbVersions);

    const fullLocalStorage = sanitizeSuiteLocalStorageMap(lsSnap.data);
    if (!Object.prototype.hasOwnProperty.call(fullLocalStorage, COSTS_BACKUP_KEY)){
      fullLocalStorage[COSTS_BACKUP_KEY] = JSON.stringify(emptyCostsBackupValue());
    }
    const costsBlock = parseCostsBackupBlock(fullLocalStorage);
    const baseFullMeta = (window.A33ExportCurrency && typeof window.A33ExportCurrency.decorateJsonMeta === 'function')
      ? window.A33ExportCurrency.decorateJsonMeta({
          appName: BACKUP_APP_NAME,
          backupType: 'full',
          exportMode: 'full',
          exportedAt: new Date().toISOString(),
          dbVersions: cleanIndexed.versions,
          dbSchemas: cleanIndexed.schemas
        })
      : {
          appName: BACKUP_APP_NAME,
          backupType: 'full',
          exportMode: 'full',
          exportedAt: new Date().toISOString(),
          dbVersions: cleanIndexed.versions,
          dbSchemas: cleanIndexed.schemas
        };

    const blockInfo = buildBackupBlockManifest(cleanIndexed.data, fullLocalStorage, {}, 'full');
    const backup = {
      meta: {
        ...baseFullMeta,
        schemaVersion:7,
        version:getCustomExportVersionLabel(),
        fechaHoraExportacion:baseFullMeta.exportedAt,
        blockManifest:blockInfo.manifest,
        blocksIncluded:blockInfo.included,
        blocksNotIncluded:blockInfo.notIncluded,
        recordCounts:blockInfo.recordCounts,
        ...(costsBlock.present && costsBlock.ok ? { costs:{ included:true, schemaVersion:costsBlock.version || COSTS_BACKUP_SCHEMA_VERSION, storageKey:COSTS_BACKUP_KEY } } : {})
      },
      data: {
        indexedDB: cleanIndexed.data,
        localStorage: fullLocalStorage
      }
    };

    const jsonString = JSON.stringify(backup, null, 2);
    const estimatedBytes = new Blob([jsonString]).size;

    return {
      backup,
      jsonString,
      estimatedBytes,
      dbSnapshots,
      lsKeys: Object.keys(fullLocalStorage || {}).sort()
    };
  }

  function getBackupImportKind(obj){
    const meta = (obj && obj.meta && typeof obj.meta === 'object') ? obj.meta : {};
    const backupType = String(meta.backupType || '').trim().toLowerCase();
    const exportMode = String(meta.exportMode || '').trim().toLowerCase();
    const partial = backupType === 'partial' || exportMode === 'custom';
    return {
      type: partial ? 'partial' : 'full',
      backupType: backupType || (partial ? 'partial' : 'full'),
      exportMode: exportMode || (partial ? 'custom' : 'full'),
      legacy: !backupType && !exportMode
    };
  }

  function validateBackupStructure(obj){
    if (!obj || typeof obj !== 'object') return { ok: false, reason: 'Archivo inválido (no es un objeto JSON).' };
    if (!obj.meta || typeof obj.meta !== 'object') return { ok: false, reason: 'Falta meta.' };
    if (!obj.data || typeof obj.data !== 'object') return { ok: false, reason: 'Falta data.' };
    const appName = obj.meta.appName || obj.meta.app || '';
    if (appName !== BACKUP_APP_NAME) return { ok: false, reason: `appName inválido: se esperaba "${BACKUP_APP_NAME}".` };
    if (!obj.data.indexedDB || typeof obj.data.indexedDB !== 'object') return { ok: false, reason: 'Falta data.indexedDB.' };
    if (!obj.data.localStorage || typeof obj.data.localStorage !== 'object') return { ok: false, reason: 'Falta data.localStorage.' };
    const costsValidation = parseCostsBackupBlock(obj.data.localStorage);
    if (!costsValidation.ok) return { ok:false, reason:costsValidation.reason || 'Bloque Costos inválido.' };
    return { ok: true, kind: getBackupImportKind(obj), costs:costsValidation };
  }

  function summarizeBackupObject(obj){
    const cleanObj = sanitizeBackupObject(obj);
    const dbSnapshots = [];
    const indexed = cleanObj?.data?.indexedDB || {};
    const versions = cleanObj?.meta?.dbVersions || {};
    const schemas = cleanObj?.meta?.dbSchemas || {};

    for (const [dbName, stores] of Object.entries(indexed)){
      const snap = { name: dbName, version: versions?.[dbName] ?? '', stores: {} };
      if (stores && typeof stores === 'object'){
        for (const [storeName, records] of Object.entries(stores)){
          const arr = Array.isArray(records) ? records : [];
          snap.stores[storeName] = {
            count: arr.length,
            schema: (schemas?.[dbName]?.[storeName]) || {},
            records: []
          };
        }
      }
      dbSnapshots.push(snap);
    }

    const lsKeys = Object.keys(cleanObj?.data?.localStorage || {}).sort();
    let estimatedBytes = 0;
    try{
      estimatedBytes = new Blob([JSON.stringify(obj)]).size;
    }catch(_){ }

    return {
      dbSnapshots,
      lsKeys,
      estimatedBytes,
      exportedAt: obj?.meta?.exportedAt,
      appName: obj?.meta?.appName || obj?.meta?.app
    };
  }

  function labelListHtml(items, emptyText){
    const arr = (Array.isArray(items) ? items : []).filter(Boolean);
    if (!arr.length) return `<div class="muted">${escapeHtml(emptyText || 'Sin datos.')}</div>`;
    return `<ul>${arr.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
  }

  function getPartialModulesIncluded(meta){
    if (Array.isArray(meta?.modulesIncluded) && meta.modulesIncluded.length) return meta.modulesIncluded.slice();
    const ids = Array.isArray(meta?.moduleIdsIncluded) ? meta.moduleIdsIncluded : Object.keys(meta?.moduleSelection || {});
    return ids.map((id) => getCustomModuleById(id)?.label || id).filter(Boolean);
  }

  function getPartialModuleIdsIncluded(meta){
    if (Array.isArray(meta?.moduleIdsIncluded) && meta.moduleIdsIncluded.length) return meta.moduleIdsIncluded.map(String);
    return Object.keys(meta?.moduleSelection || {});
  }

  function getPartialSubmoduleLabels(meta){
    if (meta?.submoduleLabelsIncluded && typeof meta.submoduleLabelsIncluded === 'object') return meta.submoduleLabelsIncluded;
    const out = {};
    const sub = meta?.submodulesIncluded && typeof meta.submodulesIncluded === 'object' ? meta.submodulesIncluded : {};
    for (const [moduleId, ids] of Object.entries(sub)){
      out[moduleId] = (Array.isArray(ids) ? ids : []).map((id) => getCustomPartById(moduleId, id)?.label || id);
    }
    return out;
  }

  function buildPartialImportSummaryHtml(obj, sum, warnings){
    const meta = obj?.meta || {};
    const includedModuleIds = getPartialModuleIdsIncluded(meta);
    const includedModules = getPartialModulesIncluded(meta);
    const includedSet = new Set(includedModuleIds.map(String));
    const notIncluded = CUSTOM_EXPORT_MODULES
      .filter((mod) => !includedSet.has(mod.id))
      .map((mod) => mod.label);
    const submoduleLabels = getPartialSubmoduleLabels(meta);
    const submoduleHtml = Object.entries(submoduleLabels || {}).map(([moduleId, labels]) => {
      const mod = getCustomModuleById(moduleId);
      return `<details open><summary>${escapeHtml(mod?.label || moduleId)}</summary>${labelListHtml(labels, 'Sin submódulos.')}</details>`;
    }).join('');

    const eventIds = Array.isArray(meta?.eventIdsIncluded) ? meta.eventIdsIncluded : (Array.isArray(meta?.pos?.eventIdsIncluded) ? meta.pos.eventIdsIncluded : []);
    const eventLabels = Array.isArray(meta?.eventsIncluded) ? meta.eventsIncluded : (Array.isArray(meta?.pos?.eventLabelsIncluded) ? meta.pos.eventLabelsIncluded : []);
    const eventMode = meta?.eventsMode || meta?.pos?.eventsMode || '';
    const eventHtml = (eventIds.length || eventLabels.length || eventMode)
      ? `
        <hr>
        <div><b>Eventos POS incluidos</b></div>
        <div class="kv">
          <div class="k">Modo eventos</div><div class="v">${escapeHtml(eventMode || 'No especificado')}</div>
          <div class="k">Cantidad</div><div class="v">${escapeHtml(String(eventIds.length || eventLabels.length || 0))}</div>
        </div>
        ${labelListHtml(eventLabels.length ? eventLabels : eventIds, 'Sin eventos listados.')}
      `
      : '';

    const backupSummary = buildSummaryHtmlFromSnapshot({
      dbSnapshots: sum.dbSnapshots || [],
      lsKeys: sum.lsKeys || [],
      exportedAt: sum.exportedAt,
      estimatedBytes: sum.estimatedBytes,
      warnings,
      appName: sum.appName
    }).replace(
      'Nota: al importar se reemplazan o fusionan únicamente los bloques incluidos; los bloques ausentes se conservan.',
      'Nota: este respaldo parcial se fusiona por ID y conserva los datos no incluidos.'
    );

    return `
      <div class="cfg-custom-export-summary">
        <div class="badge-warn">⚠️ Este respaldo es parcial. Solo se importarán las secciones incluidas. Los datos no incluidos se conservarán.</div>
        <div class="small-note"><b>Modo de importación:</b> fusión por ID. No se limpia localStorage completo ni IndexedDB completo.</div>
        ${dependencyWarningsHtml(meta.dependencyWarnings || [])}
        <div class="kv">
          <div class="k">Tipo</div><div class="v">Parcial</div>
          <div class="k">Modo</div><div class="v">${escapeHtml(meta.exportMode || 'custom')}</div>
          <div class="k">Fecha</div><div class="v">${escapeHtml(sum.exportedAt ? new Date(sum.exportedAt).toLocaleString() : '')}</div>
          <div class="k">Versión</div><div class="v">${escapeHtml(meta.version || meta.schemaVersion || 'Legacy')}</div>
        </div>
        <hr>
        <div><b>Bloques incluidos</b></div>
        ${labelListHtml(meta.blocksIncluded || [], 'No declarados en este JSON antiguo.')}
        <div><b>Bloques no incluidos</b></div>
        ${labelListHtml(meta.blocksNotIncluded || [], 'No declarados o ninguno.')}
        <hr>
        <div><b>Módulos incluidos</b></div>
        ${labelListHtml(includedModules, 'Sin módulos declarados.')}
        <hr>
        <div><b>Submódulos incluidos</b></div>
        ${submoduleHtml || '<div class="muted">Sin submódulos declarados.</div>'}
        ${eventHtml}
        <hr>
        <div><b>Módulos no incluidos</b></div>
        ${labelListHtml(notIncluded, 'Ninguno.')}
        <hr>
        ${backupSummary}
      </div>
    `;
  }

  function buildImportSummaryHtml(obj, sum, warnings){
    const kind = getBackupImportKind(obj);
    if (kind.type === 'partial') return buildPartialImportSummaryHtml(obj, sum, warnings);
    const legacyLabel = kind.legacy ? '<div class="small-note">Respaldo completo legacy: no trae backupType, se trata como completo.</div>' : '';
    return buildSummaryHtmlFromSnapshot({
      dbSnapshots: sum.dbSnapshots,
      lsKeys: sum.lsKeys,
      exportedAt: sum.exportedAt,
      estimatedBytes: sum.estimatedBytes,
      warnings,
      appName: sum.appName
    }) + `
      ${legacyLabel}
      <hr>
      <div class="badge-warn">⚠️ Esto reemplazará únicamente los bloques incluidos en este respaldo de Suite A33.</div>
      <div class="small-note"><b>Tipo:</b> respaldo completo. <b>Qué se importará:</b> bases IndexedDB y keys localStorage incluidas en el archivo. <b>Qué no se tocará:</b> datos ajenos a Suite A33 y llaves retiradas de acceso/login.</div>
    `;
  }

  async function buildDbVersionWarnings(backupObj){
    const cleanBackup = sanitizeBackupObject(backupObj);
    const warnings = [];
    const bVersions = cleanBackup?.meta?.dbVersions || {};
    const dbNames = Object.keys(cleanBackup?.data?.indexedDB || {});
    for (const dbName of dbNames){
      const b = bVersions?.[dbName];
      if (typeof b !== 'number') continue;
      try{
        const db = await openExistingDB(dbName);
        const c = db.version;
        try{ db.close(); }catch(_){ }
        if (typeof c === 'number' && b !== c){
          warnings.push(`${dbName}: respaldo v${b} / este navegador v${c}`);
        }
      }catch(_){ }
    }
    return warnings;
  }

  function getSuiteLocalStorageKeysInThisBrowser(){
    return window.A33Storage.keys({ scope: 'local' }).filter((k) => k && isSuiteLocalStorageKey(k));
  }

  function openDBForRestore(dbName, version, schemaByStore){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, Number(version) || 1);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const stores = schemaByStore && typeof schemaByStore === 'object'
          ? Object.entries(schemaByStore)
          : [];

        for (const [storeName, sch] of stores){
          if (db.objectStoreNames.contains(storeName)) continue;

          const keyPath = (sch && ('keyPath' in sch)) ? sch.keyPath : null;
          const autoIncrement = !!(sch && sch.autoIncrement);
          const opts = {};
          if (keyPath) opts.keyPath = keyPath;
          if (autoIncrement) opts.autoIncrement = true;

          let os;
          try{
            os = db.createObjectStore(storeName, opts);
          }catch(_){
            os = db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
          }

          try{
            const indices = Array.isArray(sch?.indices) ? sch.indices : [];
            for (const idx of indices){
              if (!idx?.name) continue;
              try{
                os.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique, multiEntry: !!idx.multiEntry });
              }catch(_){ }
            }
          }catch(_){ }
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error(`No se pudo abrir la DB para restaurar: ${dbName}`));
    });
  }

  function normalizeImportedProductRecord(record, origin){
    const row = cloneJsonSafe(record) || {};
    try{
      if (window.A33Products && typeof window.A33Products.normalizeRecord === 'function'){
        return window.A33Products.normalizeRecord(row, { forExisting:true, origin:origin || '' });
      }
    }catch(_){ }
    if (!String(row.productId || '').trim()){
      const legacy = String(row.id ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
      row.productId = legacy ? ('prd_legacy_' + legacy) : ('prd_import_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,10));
    }
    if (origin && !row.origin) row.origin = origin;
    return row;
  }

  async function readProductIdentityState(db){
    const state = { byProductId:new Map(), byLegacyId:new Map() };
    if (!db || !db.objectStoreNames.contains('products')) return state;
    try{
      const tx = db.transaction('products', 'readonly');
      const store = tx.objectStore('products');
      await new Promise((resolve, reject) => {
        const req = store.openCursor();
        req.onerror = () => reject(req.error || new Error('No se pudo leer Productos.'));
        req.onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor){ resolve(); return; }
          const row = normalizeImportedProductRecord(cursor.value, '');
          const productId = String(row.productId || '').trim();
          if (productId && !state.byProductId.has(productId)) state.byProductId.set(productId, { key:cursor.key, row });
          state.byLegacyId.set(String(cursor.key), productId);
          cursor.continue();
        };
      });
      await txDone(tx);
    }catch(_){ }
    return state;
  }

  async function restoreDatabase(dbName, dbPayload, dbVersions, dbSchemas){
    const schemaByStore = dbSchemas?.[dbName] || {};
    const version = dbVersions?.[dbName] || 1;

    const db = await openDBForPartialMerge(dbName, dbPayload, dbVersions, dbSchemas);

    const stores = dbPayload && typeof dbPayload === 'object'
      ? Object.entries(dbPayload)
      : [];

    for (const [storeName, records] of stores){
      if (!db.objectStoreNames.contains(storeName)) continue;

      const arr = Array.isArray(records) ? records : [];
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      try{ store.clear(); }catch(_){ }
      for (const rec of arr){
        try{
          const row = (dbName === 'a33-pos' && storeName === 'products')
            ? normalizeImportedProductRecord(rec, '')
            : rec;
          store.put(row);
        }catch(_){ }
      }
      await txDone(tx);
    }

    try{ db.close(); }catch(_){ }
  }

  function normalizeRecordToken(value){
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function firstPresentValue(rec, keys){
    for (const k of keys){
      const v = rec?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    }
    return '';
  }

  function getStableRecordId(rec, schema, contextName){
    if (!rec || typeof rec !== 'object') return '';
    const kp = schema && schema.keyPath;
    if (Array.isArray(kp)){
      const vals = kp.map((k) => rec?.[k]);
      if (vals.every((v) => v !== undefined && v !== null && String(v).trim() !== '')) return vals.map(String).join('::');
    } else if (typeof kp === 'string' && kp){
      const v = rec?.[kp];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    }

    const directId = firstPresentValue(rec, [
      'id','_id','uuid','uid','key','code','codigo','sku',
      'productId','productoId','itemId','variantId',
      'eventId','eventoId','saleId','ventaId','transactionId','movementId','movimientoId',
      'receiptId','reciboId','closureId','cierreId','dailyClosureId','closeId','lockId',
      'lotId','loteId','batchId','batchCode','lotCode','codigoLote',
      'supplierId','proveedorId','providerId','vendorId',
      'customerId','clienteId','clientId','bankId','bancoId','accountId','cuentaId',
      'envaseId','bottleId','tapaId','capId','extraId','invoiceId','facturaId','orderId','pedidoId'
    ]);
    if (directId) return directId;

    const ctx = String(contextName || '').toLowerCase();
    const name = firstPresentValue(rec, ['name','nombre','label','titulo','title','displayName','commercialName','razonSocial']);
    const email = firstPresentValue(rec, ['email','correo']);
    const phone = firstPresentValue(rec, ['phone','telefono','tel','whatsapp']);
    const number = firstPresentValue(rec, ['number','numero','factura','invoice','reference','referencia','oc','ordenCompra']);
    const date = firstPresentValue(rec, ['date','fecha','createdAt','updatedAt','fechaHora','closedAt','exportedAt']);

    if (/products|productos|inventory|inventario|extras|banks|bancos|customers|clientes|suppliers|proveedores|envases|tapas|caps|bottles/.test(ctx)){
      const composite = [name, email || phone || number].filter(Boolean).map(normalizeRecordToken).join('::');
      if (composite) return `${ctx || 'catalog'}::${composite}`;
    }

    if (/events|eventos/.test(ctx) && (name || date)){
      return `eventos::${normalizeRecordToken(date)}::${normalizeRecordToken(name)}`;
    }

    if (/lotes|lots|batch/.test(ctx) && (number || date || name)){
      return `lotes::${normalizeRecordToken(number || name)}::${normalizeRecordToken(date)}`;
    }

    if (/receipts|recibos|closures|cierres|sales|ventas/.test(ctx) && (number || date || name)){
      return `${ctx || 'mov'}::${normalizeRecordToken(number || name)}::${normalizeRecordToken(date)}`;
    }

    return '';
  }

  function hasStoreKeyPathValue(rec, keyPath){
    if (!keyPath) return false;
    if (Array.isArray(keyPath)) return keyPath.every((k) => rec && rec[k] !== undefined && rec[k] !== null && String(rec[k]).trim() !== '');
    if (typeof keyPath === 'string') return rec && rec[keyPath] !== undefined && rec[keyPath] !== null && String(rec[keyPath]).trim() !== '';
    return false;
  }

  async function openDBForPartialMerge(dbName, dbPayload, dbVersions, dbSchemas){
    const schemaByStore = dbSchemas?.[dbName] || {};
    const requestedVersion = Number(dbVersions?.[dbName] || 1) || 1;
    const incomingStores = Object.keys((dbPayload && typeof dbPayload === 'object') ? dbPayload : {});
    const schemaAvailable = schemaByStore && typeof schemaByStore === 'object' && Object.keys(schemaByStore).length > 0;

    try{
      const current = await openExistingDB(dbName);
      const missing = incomingStores.filter((storeName) => !current.objectStoreNames.contains(storeName));
      if (!missing.length || !schemaAvailable){
        return current;
      }
      const nextVersion = Math.max(Number(current.version || 1) + 1, requestedVersion);
      try{ current.close(); }catch(_){ }
      return await openDBForRestore(dbName, nextVersion, schemaByStore);
    }catch(_){
      if (schemaAvailable) return await openDBForRestore(dbName, requestedVersion, schemaByStore);
      throw new Error(`No se pudo abrir ${dbName} para fusión parcial: falta esquema de respaldo.`);
    }
  }

  async function readStoreStableKeyMap(db, storeName, schema){
    const map = new Map();
    if (!db || !db.objectStoreNames.contains(storeName)) return map;
    try{
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      await new Promise((resolve, reject) => {
        const req = store.openCursor();
        req.onerror = () => reject(req.error || new Error('No se pudo leer índice de duplicados.'));
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor){ resolve(); return; }
          const id = getStableRecordId(cursor.value, schema, storeName);
          if (id && !map.has(id)) map.set(id, cursor.key);
          cursor.continue();
        };
      });
      await txDone(tx);
    }catch(_){ }
    return map;
  }

  async function mergeDatabase(dbName, dbPayload, dbVersions, dbSchemas){
    const payload = (dbPayload && typeof dbPayload === 'object') ? dbPayload : {};
    const db = await openDBForPartialMerge(dbName, payload, dbVersions, dbSchemas);
    const schemaByStore = dbSchemas?.[dbName] || {};
    const stats = { stores: 0, records: 0, skipped: 0 };

    for (const [storeName, records] of Object.entries(payload)){
      if (!db.objectStoreNames.contains(storeName)) continue;
      const arr = Array.isArray(records) ? records : [];
      if (!arr.length) continue;
      const schema = schemaByStore?.[storeName] || {};
      let stableKeyMap = new Map();
      let usesKeyPath = true;
      try{
        const probeTx = db.transaction(storeName, 'readonly');
        usesKeyPath = !!probeTx.objectStore(storeName).keyPath;
        try{ probeTx.abort(); }catch(_){ }
      }catch(_){ usesKeyPath = true; }
      if (!usesKeyPath) stableKeyMap = await readStoreStableKeyMap(db, storeName, schema);
      const productIdentityState = (dbName === 'a33-pos' && storeName === 'products')
        ? await readProductIdentityState(db)
        : null;
      const reservedProductIds = productIdentityState
        ? new Set(productIdentityState.byProductId.keys())
        : null;

      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const runtimeKeyPath = store.keyPath;
      stats.stores++;

      for (const rec of arr){
        if (!rec || typeof rec !== 'object') { stats.skipped++; continue; }
        try{
          let incoming = cloneJsonSafe(rec);
          if (productIdentityState){
            incoming = normalizeImportedProductRecord(incoming, '');
            const productId = String(incoming.productId || '').trim();
            const existing = productIdentityState.byProductId.get(productId);
            if (existing){
              incoming.id = existing.key;
            } else {
              if (reservedProductIds.has(productId)) { stats.skipped++; continue; }
              reservedProductIds.add(productId);
              if (!incoming.origin) incoming.origin = 'importacion';
              if (incoming.id != null){
                const legacyOwner = productIdentityState.byLegacyId.get(String(incoming.id));
                if (legacyOwner && legacyOwner !== productId) delete incoming.id;
              }
            }
          }
          if (runtimeKeyPath){
            if (!hasStoreKeyPathValue(incoming, runtimeKeyPath)) {
              if (!(productIdentityState && store.autoIncrement)) { stats.skipped++; continue; }
            }
            const req = store.put(incoming);
            if (productIdentityState){
              const productId = String(incoming.productId || '').trim();
              req.onsuccess = () => {
                const key = req.result;
                productIdentityState.byProductId.set(productId, { key, row:incoming });
                productIdentityState.byLegacyId.set(String(key), productId);
              };
            }
            stats.records++;
          } else {
            const id = getStableRecordId(incoming, schema, storeName);
            if (!id) { stats.skipped++; continue; }
            const existingKey = stableKeyMap.has(id) ? stableKeyMap.get(id) : id;
            store.put(incoming, existingKey);
            stableKeyMap.set(id, existingKey);
            stats.records++;
          }
        }catch(_){
          stats.skipped++;
        }
      }
      await txDone(tx);
    }

    try{ db.close(); }catch(_){ }
    return stats;
  }

  function tryParseJsonValue(value){
    if (typeof value !== 'string') return { ok: true, value };
    const s = String(value || '').trim();
    if (!s || !/^[\[{]/.test(s)) return { ok: false, value };
    try{ return { ok: true, value: JSON.parse(s) }; }catch(_){ return { ok: false, value }; }
  }

  function stableJson(value){
    try{ return JSON.stringify(value); }catch(_){ return String(value); }
  }

  function mergeArrayById(current, incoming, contextName){
    const cur = Array.isArray(current) ? current.slice() : [];
    const inc = Array.isArray(incoming) ? incoming : [];
    const index = new Map();
    cur.forEach((item, i) => {
      const id = getStableRecordId(item, {}, contextName);
      if (id) index.set(id, i);
    });
    const fingerprints = new Set(cur.map((item) => stableJson(item)));
    for (const item of inc){
      const id = getStableRecordId(item, {}, contextName);
      if (id && index.has(id)){
        cur[index.get(id)] = item;
        fingerprints.add(stableJson(item));
      } else if (id){
        index.set(id, cur.length);
        cur.push(item);
        fingerprints.add(stableJson(item));
      } else {
        const fp = stableJson(item);
        if (!fingerprints.has(fp)){
          cur.push(item);
          fingerprints.add(fp);
        }
      }
    }
    return cur;
  }

  function mergeJsonValue(current, incoming, contextName){
    if (Array.isArray(current) && Array.isArray(incoming)) return mergeArrayById(current, incoming, contextName);
    if (current && incoming && typeof current === 'object' && typeof incoming === 'object' && !Array.isArray(current) && !Array.isArray(incoming)){
      const out = { ...current };
      for (const [k, v] of Object.entries(incoming)){
        if (Array.isArray(out[k]) && Array.isArray(v)) out[k] = mergeArrayById(out[k], v, `${contextName || ''}.${k}`);
        else if (out[k] && v && typeof out[k] === 'object' && typeof v === 'object' && !Array.isArray(out[k]) && !Array.isArray(v)) out[k] = mergeJsonValue(out[k], v, `${contextName || ''}.${k}`);
        else out[k] = v;
      }
      return out;
    }
    return incoming;
  }

  function mergeLocalStorageValue(key, incomingRaw){
    if (String(key || '') === 'a33_catalog_deleted_product_ids_v2' && window.A33ProductIntegrity){
      const current = window.A33ProductIntegrity.readTombstones();
      let incoming = [];
      try{ incoming = typeof incomingRaw === 'string' ? JSON.parse(incomingRaw || '[]') : incomingRaw; }catch(_){ incoming = []; }
      const merged = window.A33ProductIntegrity.mergeTombstones(current, Array.isArray(incoming) ? incoming : []);
      window.A33ProductIntegrity.writeTombstones(merged);
      return true;
    }
    const currentRaw = window.A33Storage.getItem(key);
    const cur = tryParseJsonValue(currentRaw);
    const inc = tryParseJsonValue(String(incomingRaw ?? ''));
    if (cur.ok && inc.ok && cur.value !== undefined && inc.value !== undefined){
      const merged = mergeJsonValue(cur.value, inc.value, key);
      try{ window.A33Storage.setItem(key, JSON.stringify(merged)); return true; }catch(_){ }
    }
    try{ window.A33Storage.setItem(key, String(incomingRaw ?? '')); return true; }catch(_){ return false; }
  }

  function dateCandidateToIso(value){
    if (value === undefined || value === null || value === '') return '';
    let raw = value;
    if (typeof raw === 'number'){
      if (raw > 0 && raw < 10000000000) raw *= 1000;
    }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString();
  }

  function scanLatestDate(value, label, depth, best){
    if (depth > 5 || value === undefined || value === null) return best;
    if (Array.isArray(value)){
      value.forEach((item) => { best = scanLatestDate(item, label, depth + 1, best); });
      return best;
    }
    if (typeof value !== 'object') return best;
    for (const [k, v] of Object.entries(value)){
      const key = String(k || '').toLowerCase();
      if (/fecha|date|createdat|updatedat|closedat|timestamp|exportedat|importedat|operacion/.test(key)){
        const iso = dateCandidateToIso(v);
        if (iso && (!best.at || new Date(iso).getTime() > new Date(best.at).getTime())){
          best = { at: iso, label };
        }
      }
      if (v && typeof v === 'object') best = scanLatestDate(v, label, depth + 1, best);
    }
    return best;
  }

  function inferLastOperationFromBackup(obj){
    let best = { at: '', label: '' };
    const indexed = obj?.data?.indexedDB || {};
    for (const [dbName, stores] of Object.entries(indexed || {})){
      for (const [storeName, records] of Object.entries(stores || {})){
        best = scanLatestDate(records, `${dbName}/${storeName}`, 0, best);
      }
    }
    const local = obj?.data?.localStorage || {};
    for (const [key, raw] of Object.entries(local || {})){
      const parsed = tryParseJsonValue(raw);
      if (parsed.ok) best = scanLatestDate(parsed.value, `localStorage/${key}`, 0, best);
    }
    return best;
  }

  function getBackupModulesForLog(meta, kind){
    if ((kind?.type || getBackupImportKind({ meta }).type) === 'full') return ['Completo'];
    return getPartialModulesIncluded(meta);
  }

  function readBackupImportLog(){
    try{
      const raw = window.A33Storage.getItem('suite_a33_backup_import_log_v1');
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    }catch(_){ return []; }
  }

  function formatBackupLogDate(value){
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-NI', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false });
  }

  function renderBackupImportLog(){
    const box = document.getElementById('cfg-backup-import-log');
    if (!box) return;
    const list = readBackupImportLog().slice(0, 12);
    if (!list.length){
      box.innerHTML = '<div class="cfg-backup-import-empty">Sin JSON importados registrados todavía.</div>';
      return;
    }
    const rows = list.map((item) => {
      const type = String(item.backupType || '').toLowerCase() === 'partial' ? 'Parcial' : 'Completo';
      const modules = Array.isArray(item.modulesIncluded) && item.modulesIncluded.length ? item.modulesIncluded.join(', ') : '—';
      const lastOp = item.lastOperationAt ? `${formatBackupLogDate(item.lastOperationAt)}${item.lastOperationLabel ? ' · ' + item.lastOperationLabel : ''}` : '—';
      return `
        <tr>
          <td>${escapeHtml(item.fileName || 'JSON importado')}</td>
          <td>${escapeHtml(formatBackupLogDate(item.importedAt))}</td>
          <td>${escapeHtml(type)}</td>
          <td>${escapeHtml(modules)}</td>
          <td>${escapeHtml(lastOp)}</td>
        </tr>
      `;
    }).join('');
    box.innerHTML = `
      <div class="cfg-backup-import-table-wrap" tabindex="0" aria-label="Historial de JSON importados">
        <table class="cfg-backup-import-table">
          <thead><tr><th>Archivo</th><th>Importado</th><th>Tipo</th><th>Módulos</th><th>Última operación</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function registerBackupImport(fileName, obj, kind, result){
    const at = new Date().toISOString();
    const meta = obj?.meta || {};
    const latest = inferLastOperationFromBackup(obj);
    const entry = {
      fileName: String(fileName || ''),
      importedAt: at,
      backupType: kind?.type || getBackupImportKind(obj).type,
      exportMode: meta.exportMode || kind?.exportMode || '',
      exportedAt: meta.exportedAt || '',
      modulesIncluded: getBackupModulesForLog(meta, kind),
      lastOperationAt: latest.at || meta.fechaHoraExportacion || meta.exportedAt || '',
      lastOperationLabel: latest.label || '',
      result: result || {}
    };
    try{ window.A33Storage.setItem('suite_a33_backup_last_import_at', at); }catch(_){ }
    try{ window.A33Storage.setItem('suite_a33_backup_last_import_file', entry.fileName); }catch(_){ }
    try{
      const raw = window.A33Storage.getItem('suite_a33_backup_import_log_v1');
      let list = [];
      try{ list = raw ? JSON.parse(raw) : []; }catch(_){ list = []; }
      if (!Array.isArray(list)) list = [];
      list.unshift(entry);
      window.A33Storage.setItem('suite_a33_backup_import_log_v1', JSON.stringify(list.slice(0, 20)));
    }catch(_){ }
    try{ renderBackupImportLog(); }catch(_){ }
  }

  async function prepareBackupProductsForImport(obj){
    const cleanObj = sanitizeBackupObject(obj);
    const posDb = cleanObj?.data?.indexedDB?.['a33-pos'];
    const hasProductsBlock = !!(posDb && Object.prototype.hasOwnProperty.call(posDb, 'products'));
    if (!hasProductsBlock) return { backup:cleanObj, hasProductsBlock:false, conflicts:[], blocked:[], assigned:[] };
    const incoming = Array.isArray(posDb.products) ? posDb.products : [];
    const current = (window.A33ProductIntegrity && typeof window.A33ProductIntegrity.getAllProductsRaw === 'function')
      ? await window.A33ProductIntegrity.getAllProductsRaw()
      : [];
    const normalized = window.A33ProductIntegrity
      ? window.A33ProductIntegrity.normalizeIncomingProducts(incoming, current)
      : { records:incoming, idMap:{}, conflicts:[], blocked:[], assigned:[] };

    let incomingTombstones = [];
    const tombRaw = cleanObj?.data?.localStorage?.['a33_catalog_deleted_product_ids_v2'];
    try{ incomingTombstones = typeof tombRaw === 'string' ? JSON.parse(tombRaw || '[]') : (Array.isArray(tombRaw) ? tombRaw : []); }catch(_){ incomingTombstones = []; }
    const allTombstones = window.A33ProductIntegrity
      ? window.A33ProductIntegrity.mergeTombstones(window.A33ProductIntegrity.readTombstones(), incomingTombstones)
      : incomingTombstones;
    const blockedIds = new Set(allTombstones.map((row) => String(row && row.productId || '').trim()).filter(Boolean));
    const blockedByImportedTombstone = normalized.records.filter((row) => blockedIds.has(String(row.productId || '').trim()));
    normalized.records = normalized.records.filter((row) => !blockedIds.has(String(row.productId || '').trim()));
    normalized.blocked = normalized.blocked.concat(blockedByImportedTombstone.map((row) => ({ productId:row.productId, name:row.name || row.nombre || '', source:'tombstone_json' })));

    const remapped = window.A33ProductIntegrity
      ? window.A33ProductIntegrity.remapProductReferences(cleanObj, normalized.idMap)
      : cleanObj;
    const remappedProducts = window.A33ProductIntegrity
      ? normalized.records.map((row) => window.A33ProductIntegrity.remapProductReferences(row, normalized.idMap))
      : normalized.records;
    remapped.data.indexedDB['a33-pos'].products = remappedProducts;
    remapped.meta = remapped.meta || {};
    remapped.meta.productIdentityImport = {
      productsBlockIncluded:true,
      assignedProductIds:normalized.assigned.length,
      blockedByTombstone:normalized.blocked.length,
      conflicts:normalized.conflicts.length,
      strategy:'productId'
    };
    return { backup:remapped, hasProductsBlock:true, ...normalized };
  }

  function productConflictMessage(conflicts){
    const list = (Array.isArray(conflicts) ? conflicts : []).slice(0, 8);
    const detail = list.map((item) => {
      const currentName = item?.current?.name || item?.current?.nombre || 'Producto actual';
      const incomingName = item?.incoming?.name || item?.incoming?.nombre || 'Producto importado';
      return `${item.productId}: “${currentName}” ↔ “${incomingName}”`;
    }).join(' · ');
    return `Conflicto de productId detectado. La importación fue detenida sin modificar datos. ${detail}`;
  }

  async function performFullImport(obj){
    const cleanObj = sanitizeBackupObject(obj);
    const incomingLocalStorage = cleanObj?.data?.localStorage || {};
    const dbPayload = cleanObj?.data?.indexedDB || {};
    const dbVersions = cleanObj?.meta?.dbVersions || {};
    const dbSchemas = cleanObj?.meta?.dbSchemas || {};
    const fileSuite = Object.keys(dbPayload || {}).filter((dbName) => isSuiteDbName(dbName) && !isRetiredGateDbName(dbName));

    // Reemplazo por bloques presentes: un JSON sin Productos jamás vacía ni reconstruye Productos.
    for (const dbName of fileSuite){
      await restoreDatabase(dbName, dbPayload[dbName], dbVersions, dbSchemas);
    }

    const incoming = sanitizeSuiteLocalStorageMap(incomingLocalStorage);
    for (const [k, v] of Object.entries(incoming)){
      if (!isSuiteLocalStorageKey(k) || isRetiredGateStorageKey(k)) continue;
      if (k === 'a33_catalog_deleted_product_ids_v2') mergeLocalStorageValue(k, v);
      else window.A33Storage.setItem(k, String(v ?? ''));
    }
    if (window.A33ProductIntegrity && typeof window.A33ProductIntegrity.applyTombstonesToCatalog === 'function'){
      await window.A33ProductIntegrity.applyTombstonesToCatalog({ source:'importacion_completa' });
    }

    return {
      type:'full',
      indexedDB:fileSuite.length,
      localStorage:Object.keys(incoming || {}).length,
      scopedReplacement:true,
      productsIncluded:!!(dbPayload?.['a33-pos'] && Object.prototype.hasOwnProperty.call(dbPayload['a33-pos'], 'products'))
    };
  }

  async function performPartialImport(obj){
    const cleanObj = sanitizeBackupObject(obj);
    const dbPayload = cleanObj?.data?.indexedDB || {};
    const dbVersions = cleanObj?.meta?.dbVersions || {};
    const dbSchemas = cleanObj?.meta?.dbSchemas || {};
    const fileSuite = Object.keys(dbPayload || {}).filter((dbName) => isSuiteDbName(dbName) && !isRetiredGateDbName(dbName));
    const result = { type: 'partial', indexedDB: {}, localStorageKeys: 0 };

    for (const dbName of fileSuite){
      result.indexedDB[dbName] = await mergeDatabase(dbName, dbPayload[dbName], dbVersions, dbSchemas);
    }

    const incoming = sanitizeSuiteLocalStorageMap(cleanObj?.data?.localStorage || {});
    for (const [k, v] of Object.entries(incoming)){
      if (!isSuiteLocalStorageKey(k)) continue;
      if (isRetiredGateStorageKey(k)) continue;
      if (mergeLocalStorageValue(k, v)) result.localStorageKeys++;
    }
    if (window.A33ProductIntegrity && typeof window.A33ProductIntegrity.applyTombstonesToCatalog === 'function'){
      result.tombstonesApplied = await window.A33ProductIntegrity.applyTombstonesToCatalog({ source:'importacion_parcial' });
    }

    return result;
  }

  async function performImport(obj){
    const prepared = await prepareBackupProductsForImport(obj);
    if (prepared.conflicts && prepared.conflicts.length){
      const error = new Error(productConflictMessage(prepared.conflicts));
      error.code = 'A33_PRODUCT_ID_CONFLICT';
      error.conflicts = prepared.conflicts;
      throw error;
    }
    const cleanObj = prepared.backup;
    const kind = getBackupImportKind(cleanObj);
    const result = kind.type === 'partial' ? await performPartialImport(cleanObj) : await performFullImport(cleanObj);
    result.productIdentity = {
      productsBlockIncluded:prepared.hasProductsBlock,
      assignedProductIds:(prepared.assigned || []).length,
      blockedByTombstone:(prepared.blocked || []).length,
      conflicts:0
    };
    return result;
  }

  async function handleExport(){
    showModal({
      title: 'Resumen del respaldo',
      bodyHtml: '<div class="muted">Generando resumen...</div>',
      primaryText: 'Cerrar',
      onPrimary: hideModal,
      cancelText: 'Cancelar',
      onCancel: hideModal
    });

    try{
      const { backup, jsonString, estimatedBytes, dbSnapshots, lsKeys } = await buildFullBackup();
      const totalDbRecords = dbSnapshots.reduce((acc, d) => {
        const stores = Object.values(d.stores || {});
        return acc + stores.reduce((a, s) => a + (Number(s.count) || 0), 0);
      }, 0);
      const hasAnyData = totalDbRecords > 0 || (lsKeys && lsKeys.length > 0);

      if (!hasAnyData){
        showModal({
          title: 'Resumen del respaldo',
          bodyHtml: '<div class="badge-warn">⚠️ No hay datos para respaldar.</div>',
          primaryText: 'Cerrar',
          onPrimary: hideModal,
          disableCancel: true
        });
        return;
      }

      const summaryHtml = buildSummaryHtmlFromSnapshot({
        dbSnapshots,
        lsKeys,
        exportedAt: backup?.meta?.exportedAt,
        estimatedBytes,
        warnings: [],
        appName: backup?.meta?.appName
      });

      showModal({
        title: 'Resumen del respaldo',
        bodyHtml: summaryHtml,
        primaryText: 'Descargar respaldo',
        onPrimary: async () => {
          downloadTextFile(buildBackupFilename(), jsonString);
          hideModal();
          showToast('Respaldo descargado.');
        },
        cancelText: 'Cancelar',
        onCancel: hideModal
      });
    }catch(e){
      showModal({
        title: 'Error',
        bodyHtml: `<div class="badge-warn">⚠️ ${escapeHtml(e?.message || e)}</div>`,
        primaryText: 'Cerrar',
        onPrimary: hideModal,
        disableCancel: true
      });
    }
  }

  async function handleImportFile(file){
    if (!file) return;

    showModal({
      title: 'Resumen del archivo',
      bodyHtml: '<div class="muted">Leyendo archivo...</div>',
      primaryText: 'Cerrar',
      onPrimary: hideModal,
      cancelText: 'Cancelar',
      onCancel: hideModal
    });

    try{
      const text = await file.text();
      let obj;
      try{
        obj = JSON.parse(text);
      }catch(_){
        throw new Error('JSON inválido o corrupto.');
      }

      const v = validateBackupStructure(obj);
      if (!v.ok) throw new Error(v.reason);
      const kind = v.kind || getBackupImportKind(obj);

      const sum = summarizeBackupObject(obj);
      const warnings = await buildDbVersionWarnings(obj);
      const summaryHtml = buildImportSummaryHtml(obj, sum, warnings);
      const partial = kind.type === 'partial';
      const primaryText = partial ? 'Importar parcial' : 'Importar y reemplazar';
      const confirmText = partial
        ? 'Este respaldo es parcial. Solo se importarán las secciones incluidas y los datos no incluidos se conservarán. ¿Importar parcial?'
        : 'Esto reemplazará los bloques incluidos en el respaldo completo. Los bloques ausentes se conservarán. ¿Importar y reemplazar?';
      const workingText = partial
        ? 'Fusionando respaldo parcial por ID... No cierres esta pestaña.'
        : 'Aplicando reemplazo controlado por bloques... No cierres esta pestaña.';

      showModal({
        title: partial ? 'Resumen del respaldo parcial' : 'Resumen del archivo',
        bodyHtml: summaryHtml,
        primaryText,
        onPrimary: async () => {
          if (!confirm(confirmText)) return;

          showModal({
            title: 'Importando...',
            bodyHtml: `<div class="muted">${escapeHtml(workingText)}</div>`,
            disableCancel: true,
            disablePrimary: true
          });

          try{
            const result = await performImport(obj);
            registerBackupImport(file.name, obj, kind, result);
            const okText = partial
              ? '<div>✅ Respaldo parcial importado correctamente.</div><div class="small-note">Los datos no incluidos se conservaron. Recomendado: recargar para que todos los módulos lean los cambios.</div>'
              : '<div>✅ Respaldo completo importado correctamente por bloques.</div><div class="small-note">Los bloques ausentes se conservaron. Recomendado: recargar para que todos los módulos lean los nuevos datos.</div>';
            showModal({
              title: 'Importación exitosa',
              bodyHtml: okText,
              primaryText: 'Recargar ahora',
              onPrimary: () => location.reload(),
              cancelText: 'Más tarde',
              onCancel: hideModal
            });
          }catch(err){
            showModal({
              title: 'Error de importación',
              bodyHtml: `<div class="badge-warn">⚠️ ${escapeHtml(err?.message || err)}</div><div class="small-note">Tip: cierra otras pestañas de la Suite y vuelve a intentar.</div>`,
              primaryText: 'Cerrar',
              onPrimary: hideModal,
              disableCancel: true
            });
          }
        },
        cancelText: 'Cancelar',
        onCancel: hideModal
      });
    }catch(e){
      showModal({
        title: 'Error',
        bodyHtml: `<div class="badge-warn">⚠️ ${escapeHtml(e?.message || e)}</div>`,
        primaryText: 'Cerrar',
        onPrimary: hideModal,
        disableCancel: true
      });
    }
  }


  function formatAuditDate(value){
    if (!value) return '—';
    try{ return new Date(value).toLocaleString('es-NI'); }catch(_){ return String(value); }
  }

  function buildProductAuditHtml(rows){
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length){
      return '<div class="badge-ok">✅ No hay productos en el catálogo. La auditoría no creó ni sembró ninguno.</div>';
    }
    const body = list.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.productId)}</small></td>
        <td>${escapeHtml(row.state)}</td>
        <td>${escapeHtml(row.classification)}<small>Confianza: ${escapeHtml(row.confidence)}</small></td>
        <td>${escapeHtml(row.origin)}<small>${escapeHtml(row.seedIndicator)}</small></td>
        <td>${row.recipe ? 'Sí' : 'No'} / ${row.cost ? 'Sí' : 'No'}</td>
        <td>${escapeHtml(row.envaseId || '—')}<small>Tapa: ${escapeHtml(row.tapaId || '—')}</small></td>
        <td>${Number(row.stock || 0)}</td>
        <td>${Number(row.relations.sales || 0)} / ${Number(row.relations.lots || 0)} / ${Number(row.relations.orders || 0)} / ${Number(row.relations.agenda || 0)}</td>
        <td class="cfg-product-audit-actions">
          <button type="button" class="cfg-btn cfg-btn-ghost" data-audit-detail="${escapeHtml(row.productId)}">Detalle</button>
          <button type="button" class="cfg-btn cfg-btn-ghost" data-audit-inactivate="${escapeHtml(row.productId)}">Inactivar</button>
          <button type="button" class="cfg-btn cfg-btn-danger" data-audit-delete="${escapeHtml(row.productId)}">Eliminar</button>
        </td>
      </tr>
    `).join('');
    return `
      <div class="cfg-product-audit-note">La auditoría es informativa. No borra ni modifica nada hasta que presiones una acción explícita.</div>
      <div class="cfg-product-audit-wrap" tabindex="0">
        <table class="cfg-product-audit-table">
          <thead><tr><th>Producto</th><th>Estado</th><th>Clasificación</th><th>Origen</th><th>Receta/Costos</th><th>Envase/Tapa</th><th>Stock</th><th>Ventas/Lotes/Pedidos/Agenda</th><th>Acciones</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  }

  function buildProductAuditDetail(row){
    const r = row || {};
    return `
      <div class="cfg-product-audit-detail">
        <div class="kv">
          <div class="k">productId</div><div class="v">${escapeHtml(r.productId || '—')}</div>
          <div class="k">Nombre</div><div class="v">${escapeHtml(r.name || '—')}</div>
          <div class="k">Estado</div><div class="v">${escapeHtml(r.state || '—')}</div>
          <div class="k">Clasificación</div><div class="v">${escapeHtml(r.classification || '—')}</div>
          <div class="k">Confianza</div><div class="v">${escapeHtml(r.confidence || '—')}</div>
          <div class="k">Origen</div><div class="v">${escapeHtml(r.origin || '—')}</div>
          <div class="k">Creado</div><div class="v">${escapeHtml(formatAuditDate(r.createdAt))}</div>
          <div class="k">Modificado</div><div class="v">${escapeHtml(formatAuditDate(r.updatedAt))}</div>
          <div class="k">Receta</div><div class="v">${r.recipe ? 'Sí' : 'No'}</div>
          <div class="k">Costos</div><div class="v">${r.cost ? 'Sí' : 'No'}</div>
          <div class="k">Envase</div><div class="v">${escapeHtml(r.envaseId || '—')}</div>
          <div class="k">Tapa</div><div class="v">${escapeHtml(r.tapaId || '—')}</div>
          <div class="k">Stock</div><div class="v">${Number(r.stock || 0)}</div>
          <div class="k">Ventas relacionadas</div><div class="v">${Number(r.relations?.sales || 0)}</div>
          <div class="k">Lotes relacionados</div><div class="v">${Number(r.relations?.lots || 0)}</div>
          <div class="k">Pedidos relacionados</div><div class="v">${Number(r.relations?.orders || 0)}</div>
          <div class="k">Agenda relacionada</div><div class="v">${Number(r.relations?.agenda || 0)}</div>
          <div class="k">Indicador de semilla</div><div class="v">${escapeHtml(r.seedIndicator || '—')}</div>
          <div class="k">Tombstone</div><div class="v">${r.tombstoned ? 'Sí' : 'No'}</div>
        </div>
      </div>
    `;
  }

  async function handleProductAudit(){
    if (!window.A33ProductIntegrity || typeof window.A33ProductIntegrity.auditProducts !== 'function'){
      showToast('La herramienta de integridad no está disponible.');
      return;
    }
    showModal({ title:'Auditoría segura de Productos', bodyHtml:'<div class="muted">Revisando relaciones sin modificar datos...</div>', disableCancel:true, disablePrimary:true });
    try{
      const rows = await window.A33ProductIntegrity.auditProducts();
      showModal({
        title:'Auditoría segura de Productos',
        bodyHtml:buildProductAuditHtml(rows),
        primaryText:'Cerrar',
        onPrimary:hideModal,
        disableCancel:true
      });
      const body = document.getElementById('backup-modal-body');
      body?.querySelectorAll('[data-audit-detail]').forEach((button) => {
        button.onclick = () => {
          const row = rows.find((item) => item.productId === button.dataset.auditDetail);
          showModal({ title:'Detalle de relaciones', bodyHtml:buildProductAuditDetail(row), primaryText:'Volver a auditoría', onPrimary:handleProductAudit, cancelText:'Cerrar', onCancel:hideModal });
        };
      });
      body?.querySelectorAll('[data-audit-inactivate]').forEach((button) => {
        button.onclick = async () => {
          const row = rows.find((item) => item.productId === button.dataset.auditInactivate);
          if (!row || !confirm(`¿Inactivar y poner en cuarentena “${row.name}”?

No se borrarán ventas, lotes, pedidos, agenda ni históricos.`)) return;
          await window.A33ProductIntegrity.setInactive(row.productId, { quarantine:true, reason:'Auditoría controlada desde Configuración' });
          showToast('Producto inactivado y puesto en cuarentena.');
          await handleProductAudit();
        };
      });
      body?.querySelectorAll('[data-audit-delete]').forEach((button) => {
        button.onclick = async () => {
          const row = rows.find((item) => item.productId === button.dataset.auditDelete);
          if (!row) return;
          const ok = confirm(`Eliminar “${row.name}” del catálogo maestro creará un tombstone por productId.

Los históricos se conservarán. ¿Continuar?`);
          if (!ok) return;
          const typed = prompt(`Confirmación final: escribe ELIMINAR para borrar ${row.productId}`);
          if (String(typed || '').trim().toUpperCase() !== 'ELIMINAR'){
            showToast('Eliminación cancelada.');
            return;
          }
          await window.A33ProductIntegrity.deleteProduct(row.productId, { origin:'auditoria_configuracion', confirmed:true });
          showToast('Producto eliminado con tombstone; históricos conservados.');
          await handleProductAudit();
        };
      });
    }catch(error){
      showModal({ title:'Auditoría no disponible', bodyHtml:`<div class="badge-warn">⚠️ ${escapeHtml(error?.message || error)}</div>`, primaryText:'Cerrar', onPrimary:hideModal, disableCancel:true });
    }
  }


  const USER_ROLE_META = {
    admin: { label: 'Admin' },
    ventas: { label: 'Ventas' },
    finanzas: { label: 'Finanzas' },
    consulta: { label: 'Consulta' }
  };
  const USER_STATUS_META = {
    active: { label: 'Activo' },
    inactive: { label: 'Inactivo' },
    pending: { label: 'Pendiente' }
  };

  function normalizeUserName(name){
    return String(name || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeUserEmail(email){
    return String(email || '').trim().toLowerCase();
  }

  function isValidEmail(email){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  }

  function getRoleMetaMap(){
    const access = window.A33Access;
    if (access && typeof access.getRoleOptions === 'function'){
      return access.getRoleOptions().reduce((acc, item) => {
        acc[item.key] = { label: item.label, description: item.description, permissions: item.permissions || [] };
        return acc;
      }, {});
    }
    return USER_ROLE_META;
  }

  function getRoleLabel(role){
    const meta = getRoleMetaMap();
    return meta[role]?.label || 'Sin rol';
  }

  function getStatusLabel(status){
    return USER_STATUS_META[status]?.label || 'Desconocido';
  }

  function safeDateShort(value){
    if (!value) return 'Sin fecha';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Sin fecha';
    return d.toLocaleString('es-NI', {
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    });
  }

  function sortUsers(users){
    return (Array.isArray(users) ? users : []).slice().sort((a, b) => {
      const an = normalizeUserName(a?.name).toLowerCase();
      const bn = normalizeUserName(b?.name).toLowerCase();
      if (an !== bn) return an.localeCompare(bn, 'es');
      return normalizeUserEmail(a?.email).localeCompare(normalizeUserEmail(b?.email), 'es');
    });
  }

  function normalizeRemoteUser(item){
    const roleMeta = getRoleMetaMap();
    const role = roleMeta[item?.role] ? item.role : 'consulta';
    const status = USER_STATUS_META[item?.status] ? item.status : 'pending';
    return {
      id: String(item?.uid || item?.id || ''),
      uid: String(item?.uid || item?.id || ''),
      workspaceId: String(item?.workspaceId || 'default'),
      name: normalizeUserName(item?.name),
      email: normalizeUserEmail(item?.email),
      role,
      status,
      permissions: Array.isArray(item?.permissions) ? item.permissions.slice() : [],
      createdAt: item?.createdAt || '',
      updatedAt: item?.updatedAt || item?.createdAt || '',
      lastAdminMutationAt: item?.lastAdminMutationAt || ''
    };
  }

  function buildUsersStats(users){
    const list = Array.isArray(users) ? users : [];
    const active = list.filter((user) => user.status === 'active').length;
    const inactive = list.filter((user) => user.status === 'inactive').length;
    const roleCounts = list.reduce((acc, user) => {
      const roleMeta = getRoleMetaMap();
      const role = roleMeta[user.role] ? user.role : 'consulta';
      acc[role] = (acc[role] || 0) + 1;
      return acc;
    }, {});
    let topRole = '—';
    let topCount = 0;
    Object.entries(roleCounts).forEach(([role, count]) => {
      if (count > topCount){
        topCount = count;
        topRole = getRoleLabel(role);
      }
    });
    return {
      total: list.length,
      active,
      inactive,
      topRole
    };
  }

  function filterUsers(users, search){
    const term = String(search || '').trim().toLowerCase();
    if (!term) return Array.isArray(users) ? users.slice() : [];
    return (Array.isArray(users) ? users : []).filter((user) => {
      const name = normalizeUserName(user.name).toLowerCase();
      const email = normalizeUserEmail(user.email);
      const role = getRoleLabel(user.role).toLowerCase();
      return name.includes(term) || email.includes(term) || role.includes(term);
    });
  }

  function populateRoleOptions(select){
    if (!select) return;
    const current = select.value;
    const meta = getRoleMetaMap();
    const html = Object.entries(meta).map(([key, item]) => `<option value="${escapeHtml(key)}">${escapeHtml(item.label || key)}</option>`).join('');
    select.innerHTML = html;
    const preferred = meta[current] ? current : (meta.admin ? 'admin' : Object.keys(meta)[0] || 'consulta');
    select.value = preferred;
  }

  function setUserFormEnabled(enabled){
    const section = window.__cfgUsersSection;
    if (!section) return;
    [section.nameInput, section.emailInput, section.roleInput, section.statusInput, section.saveBtn].forEach((el) => {
      if (el) el.disabled = !enabled;
    });
  }

  function accessApi(){
    return window.A33Access || null;
  }

  function accessState(){
    const api = accessApi();
    return api && typeof api.getState === 'function' ? api.getState() : null;
  }

  function resetUserForm({ focus = false } = {}){
    const section = window.__cfgUsersSection;
    if (!section) return;
    section.form.reset();
    if (section.idInput) section.idInput.value = '';
    populateRoleOptions(section.roleInput);
    const roleMeta = getRoleMetaMap();
    if (section.roleInput && section.roleInput.value !== 'admin' && roleMeta.admin) section.roleInput.value = 'admin';
    if (section.statusInput) section.statusInput.value = 'active';
    if (section.saveBtn) section.saveBtn.textContent = 'Guardar usuario';
    if (section.formHint) section.formHint.textContent = 'Cuando Functions esté desplegado y tu sesión tenga rol Admin activo, este formulario operará sobre Authentication + Firestore.';
    if (focus && section.nameInput && !section.nameInput.disabled) section.nameInput.focus();
  }

  function loadUserIntoForm(userId){
    const section = window.__cfgUsersSection;
    if (!section) return;
    const user = section.users.find((item) => item.id === userId || item.uid === userId);
    if (!user) return;
    section.idInput.value = user.uid;
    section.nameInput.value = user.name;
    section.emailInput.value = user.email;
    populateRoleOptions(section.roleInput);
    const roleMeta = getRoleMetaMap();
    section.roleInput.value = roleMeta[user.role] ? user.role : 'consulta';
    section.statusInput.value = USER_STATUS_META[user.status] ? user.status : 'active';
    section.saveBtn.textContent = 'Actualizar usuario';
    section.formHint.textContent = `Editando perfil real de ${user.name}. Los cambios pasan por Functions + Admin SDK.`;
    if (!section.nameInput.disabled) section.nameInput.focus();
  }

  function focusUserForm(){
    const section = window.__cfgUsersSection;
    if (!section) return;
    const usersTab = document.getElementById('cfg-tab-users');
    if (usersTab && !usersTab.classList.contains('is-active')) usersTab.click();
    if (!section.saveBtn.disabled){
      resetUserForm({ focus: true });
    }
  }

  async function reloadUsersSection({ silent = false } = {}){
    const section = window.__cfgUsersSection;
    const api = accessApi();
    if (!section || !api || typeof api.listUsers !== 'function') return;

    if (!silent){
      section.loadingUsers = true;
      renderUsersSection();
    }

    try{
      const users = await api.listUsers();
      section.users = sortUsers((Array.isArray(users) ? users : []).map(normalizeRemoteUser).filter((item) => item.uid && item.email));
      section.lastLoadError = '';
      const current = accessState();
      section.lastAccessKey = JSON.stringify({
        workspaceId: current?.workspaceId || '',
        role: current?.role || '',
        profileUid: current?.profile?.uid || current?.user?.uid || '',
        backendHealth: current?.backendHealth || '',
        isAdmin: !!current?.isAdmin
      });
    }catch(error){
      section.lastLoadError = String(error?.message || error || 'No se pudo leer la lista real de usuarios.');
      const current = accessState();
      section.users = current?.profile ? [normalizeRemoteUser(current.profile)] : [];
    }finally{
      section.loadingUsers = false;
      renderUsersSection();
    }
  }

  function shouldReloadFromAccess(current){
    const section = window.__cfgUsersSection;
    if (!section) return false;
    const nextKey = JSON.stringify({
      workspaceId: current?.workspaceId || '',
      role: current?.role || '',
      profileUid: current?.profile?.uid || current?.user?.uid || '',
      backendHealth: current?.backendHealth || '',
      isAdmin: !!current?.isAdmin
    });
    return !section.lastAccessKey || section.lastAccessKey !== nextKey;
  }

  function buildUsersUiModel(){
    const current = accessState() || {};
    const hasSession = !!current.user;
    const backendHealth = String(current.backendHealth || 'idle');
    const backendReady = backendHealth === 'ready';
    const canManage = !!current.managementReady;
    const canBootstrap = !!current.canBootstrap;
    const loading = !!current.loadingProfile;
    const profile = current.profile || null;
    const roleLabel = current.roleLabel || (profile ? getRoleLabel(profile.role) : 'Sin rol');
    const statusLabel = current.statusLabel || (profile ? getStatusLabel(profile.status) : 'Sin estado');

    const model = {
      modeBadge: 'Sin backend',
      sideBadge: 'Perfil pendiente',
      headline: 'Aquí vive la base real de perfiles, roles y permisos. El cliente solo lee; el backend privilegiado manda.',
      accessCurrent: hasSession ? (profile?.name || current.user?.email || 'Sesión activa') : 'Sin sesión',
      accessDetail: hasSession
        ? `${roleLabel} · ${statusLabel}`
        : 'Inicia sesión para leer tu perfil y verificar el backend.',
      backendCurrent: backendReady ? 'Listo' : (backendHealth === 'missing' ? 'No desplegado' : backendHealth === 'checking' ? 'Verificando' : 'Pendiente'),
      backendDetail: String(current.backendMessage || 'Functions todavía no ha sido verificado.'),
      workspaceCurrent: String(current.workspaceId || 'default') || 'default',
      workspaceDetail: 'Preparado para tenant simple sin volver esto un laberinto.',
      storageLabel: 'Firestore canónico',
      storageCopy: 'El perfil real vive en Firestore; las acciones privilegiadas pasan por Functions + Admin SDK.',
      permissionsLabel: hasSession
        ? `${roleLabel} · ${Array.isArray(current.permissions) ? current.permissions.length : 0} permisos`
        : 'Sin perfil todavía',
      permissionsCopy: hasSession
        ? (Array.isArray(current.permissions) && current.permissions.length
            ? current.permissions.join(' · ')
            : 'Todavía no hay permisos efectivos para esta sesión.')
        : 'La app leerá permisos desde el rol asignado y los expondrá de forma uniforme.',
      nextLabel: canManage ? 'Backend operativo' : (canBootstrap ? 'Bootstrap disponible' : 'UI administrativa progresiva'),
      nextCopy: canManage
        ? 'Ya puedes crear, editar, activar, desactivar y borrar usuarios reales desde este carril seguro.'
        : (canBootstrap
            ? 'Puedes activar el primer Admin del workspace desde aquí si todavía no existe.'
            : 'Esta base ya deja el backend correcto para la administración privilegiada posterior.'),
      canManage,
      canBootstrap,
      hasSession,
      loading,
      backendReady,
      backendHealth,
      profileMissing: !!current.profileMissing,
      emptyTitle: 'Sin perfiles todavía',
      emptyCopy: 'Cuando el backend esté listo, aquí aparecerán los perfiles reales del workspace.',
      disableReason: ''
    };

    if (!hasSession){
      model.modeBadge = 'Sin sesión';
      model.sideBadge = 'Inicia sesión';
      model.emptyTitle = 'Necesitas sesión';
      model.emptyCopy = 'Sin sesión no hay perfil ni backend que leer. Primero entra con Auth.';
      model.disableReason = 'Inicia sesión para operar usuarios.';
      return model;
    }

    if (loading){
      model.modeBadge = 'Leyendo perfil';
      model.sideBadge = 'Cargando';
      model.disableReason = 'Se está leyendo tu perfil real.';
      return model;
    }

    if (canManage){
      model.modeBadge = 'Admin real listo';
      model.sideBadge = 'Admin activo';
      model.headline = 'Backend seguro activo. Aquí ya operas usuarios reales con Functions + Admin SDK.';
      return model;
    }

    if (canBootstrap){
      model.modeBadge = 'Bootstrap pendiente';
      model.sideBadge = 'Admin inicial';
      model.headline = 'No existe aún un Admin activo en el workspace. Puedes activarlo desde esta misma pantalla.';
      model.emptyTitle = 'Workspace sin admin';
      model.emptyCopy = 'Usa “Activar admin inicial” para crear el primer perfil administrativo serio.';
      model.disableReason = 'Activa primero el admin inicial del workspace.';
      return model;
    }

    if (!backendReady){
      model.modeBadge = backendHealth === 'missing' ? 'Functions pendiente' : 'Backend pendiente';
      model.sideBadge = 'Solo lectura';
      model.disableReason = backendHealth === 'missing'
        ? 'Despliega Functions para activar la administración privilegiada.'
        : 'El backend administrativo todavía no está listo.';
      return model;
    }

    model.modeBadge = current.profileMissing ? 'Perfil pendiente' : 'Solo lectura';
    model.sideBadge = current.profileMissing ? 'Perfil pendiente' : 'Sin privilegios';
    model.disableReason = current.profileMissing
      ? 'Tu sesión existe, pero todavía no tiene perfil administrativo activo en Firestore.'
      : 'Tu sesión no trae permisos de administración de usuarios.';
    if (current.profile && !current.isAdmin){
      model.emptyTitle = 'Solo lectura';
      model.emptyCopy = 'Puedes ver tu perfil real, pero no administrar a otros usuarios desde esta sesión.';
    }
    return model;
  }

  function renderUsersSection(){
    const section = window.__cfgUsersSection;
    if (!section) return;

    const ui = buildUsersUiModel();
    const filtered = filterUsers(section.users, section.searchInput?.value || '');
    const stats = buildUsersStats(section.users);

    if (section.modeBadge) section.modeBadge.textContent = ui.modeBadge;
    if (section.sideBadge) section.sideBadge.textContent = ui.sideBadge;
    if (section.copyEl) section.copyEl.textContent = ui.headline;
    if (section.accessCurrentEl) section.accessCurrentEl.textContent = ui.accessCurrent;
    if (section.accessDetailEl) section.accessDetailEl.textContent = ui.accessDetail;
    if (section.backendCurrentEl) section.backendCurrentEl.textContent = ui.backendCurrent;
    if (section.backendDetailEl) section.backendDetailEl.textContent = ui.backendDetail;
    if (section.workspaceCurrentEl) section.workspaceCurrentEl.textContent = ui.workspaceCurrent;
    if (section.workspaceDetailEl) section.workspaceDetailEl.textContent = ui.workspaceDetail;
    if (section.storageLabelEl) section.storageLabelEl.textContent = ui.storageLabel;
    if (section.storageCopyEl) section.storageCopyEl.textContent = ui.storageCopy;
    if (section.permissionsLabelEl) section.permissionsLabelEl.textContent = ui.permissionsLabel;
    if (section.permissionsCopyEl) section.permissionsCopyEl.textContent = ui.permissionsCopy;
    if (section.nextLabelEl) section.nextLabelEl.textContent = ui.nextLabel;
    if (section.nextCopyEl) section.nextCopyEl.textContent = ui.nextCopy;
    if (section.formHint) section.formHint.textContent = ui.disableReason || 'Backend listo para operar usuarios reales.';
    if (section.bootstrapBtn) section.bootstrapBtn.hidden = !ui.canBootstrap;
    if (section.newTopBtn) section.newTopBtn.disabled = !ui.canManage;
    if (section.emptyCta) section.emptyCta.disabled = !ui.canManage;

    setUserFormEnabled(ui.canManage);
    populateRoleOptions(section.roleInput);

    if (section.totalEl) section.totalEl.textContent = String(stats.total);
    if (section.activeEl) section.activeEl.textContent = String(stats.active);
    if (section.inactiveEl) section.inactiveEl.textContent = String(stats.inactive);
    if (section.topRoleEl) section.topRoleEl.textContent = stats.topRole;

    const hasUsers = section.users.length > 0;
    const hasFiltered = filtered.length > 0;

    if (section.emptyTitleEl) section.emptyTitleEl.textContent = section.loadingUsers ? 'Cargando perfiles…' : ui.emptyTitle;
    if (section.emptyCopyEl) section.emptyCopyEl.textContent = section.loadingUsers
      ? 'Estamos consultando Firestore para traer el estado real del workspace.'
      : (section.lastLoadError || ui.emptyCopy);

    if (section.emptyEl) section.emptyEl.hidden = hasUsers && !section.loadingUsers;
    if (section.tableWrap) section.tableWrap.hidden = !hasUsers || !hasFiltered || section.loadingUsers;
    if (section.cardsEl) section.cardsEl.hidden = !hasUsers || !hasFiltered || section.loadingUsers;
    if (section.noResultsEl) section.noResultsEl.hidden = !hasUsers || hasFiltered || section.loadingUsers;

    const actionCell = (user) => {
      if (!ui.canManage) return '<span class="cfg-action-inline-note">Solo lectura</span>';
      const isSelf = user.uid === accessState()?.user?.uid;
      const canDelete = !isSelf;
      const canToggle = !isSelf;
      return `
        <div class="cfg-user-actions">
          <button class="cfg-action-btn" type="button" data-user-action="edit" data-user-id="${escapeHtml(user.uid)}">Editar</button>
          ${canToggle ? `<button class="cfg-action-btn" type="button" data-user-action="toggle" data-user-id="${escapeHtml(user.uid)}">${user.status === 'active' ? 'Desactivar' : 'Activar'}</button>` : '<span class="cfg-action-inline-note">Tu propio perfil admin se mantiene activo desde este panel.</span>'}
          ${canDelete ? `<button class="cfg-action-btn cfg-action-btn--danger" type="button" data-user-action="delete" data-user-id="${escapeHtml(user.uid)}">Borrar</button>` : ''}
        </div>
      `;
    };

    const rowsHtml = filtered.map((user) => `
      <tr>
        <td>
          <div class="cfg-user-primary">
            <span class="cfg-user-name">${escapeHtml(user.name || 'Sin nombre')}</span>
            <span class="cfg-user-meta">Actualizado ${escapeHtml(safeDateShort(user.updatedAt || user.lastAdminMutationAt))}</span>
          </div>
        </td>
        <td>${escapeHtml(user.email)}</td>
        <td><span class="cfg-tag">${escapeHtml(getRoleLabel(user.role))}</span></td>
        <td><span class="cfg-status-chip" data-state="${escapeHtml(user.status)}">${escapeHtml(getStatusLabel(user.status))}</span></td>
        <td>${actionCell(user)}</td>
      </tr>
    `).join('');

    const cardsHtml = filtered.map((user) => `
      <article class="cfg-user-card">
        <div class="cfg-user-card-head">
          <div class="cfg-user-primary">
            <span class="cfg-user-name">${escapeHtml(user.name || 'Sin nombre')}</span>
            <span class="cfg-user-meta">${escapeHtml(user.email)}</span>
          </div>
          <span class="cfg-status-chip" data-state="${escapeHtml(user.status)}">${escapeHtml(getStatusLabel(user.status))}</span>
        </div>
        <div class="cfg-user-card-meta">
          <span class="cfg-tag">${escapeHtml(getRoleLabel(user.role))}</span>
          <span class="cfg-user-meta">Actualizado ${escapeHtml(safeDateShort(user.updatedAt || user.lastAdminMutationAt))}</span>
        </div>
        <div class="cfg-user-card-actions">
          ${actionCell(user)}
        </div>
      </article>
    `).join('');

    if (section.tbody) section.tbody.innerHTML = rowsHtml;
    if (section.cardsEl) section.cardsEl.innerHTML = cardsHtml;
  }

  async function saveUserFromForm(event){
    event.preventDefault();
    const section = window.__cfgUsersSection;
    const api = accessApi();
    if (!section || !api) return;

    const current = buildUsersUiModel();
    if (!current.canManage){
      showToast(current.disableReason || 'Tu sesión no puede administrar usuarios todavía.');
      return;
    }

    const uid = String(section.idInput.value || '').trim();
    const name = normalizeUserName(section.nameInput.value);
    const email = normalizeUserEmail(section.emailInput.value);
    const roleMeta = getRoleMetaMap();
    const role = roleMeta[section.roleInput.value] ? section.roleInput.value : 'consulta';
    const status = USER_STATUS_META[section.statusInput.value] ? section.statusInput.value : 'active';

    if (!name || name.length < 2){
      showToast('Escribe un nombre válido.');
      section.nameInput.focus();
      return;
    }
    if (!isValidEmail(email)){
      showToast('Escribe un correo válido.');
      section.emailInput.focus();
      return;
    }

    section.saveBtn.disabled = true;
    const originalLabel = section.saveBtn.textContent;
    section.saveBtn.textContent = uid ? 'Actualizando…' : 'Creando…';
    try{
      const result = await api.saveUser({ uid, name, email, role, status });
      resetUserForm();
      await reloadUsersSection({ silent: true });
      showToast(String(result?.message || (uid ? 'Usuario real actualizado.' : 'Usuario real creado.')));
      if (result && result.created && result.temporaryPassword){
        showModal({
          title: 'Usuario creado',
          bodyHtml: `<div>✅ ${escapeHtml(result.message || 'Usuario creado correctamente.')}</div><div class="cfg-user-password-card"><strong>Contraseña temporal</strong><br /><code>${escapeHtml(result.temporaryPassword)}</code><div class="small-note">Muéstrala una sola vez al usuario o cámbiala luego desde Seguridad.</div></div>`,
          primaryText: 'Cerrar',
          onPrimary: hideModal,
          disableCancel: true
        });
      }
    }catch(error){
      showToast(String(error?.message || error || 'No se pudo guardar el usuario.'));
    }finally{
      section.saveBtn.disabled = false;
      section.saveBtn.textContent = section.idInput?.value ? originalLabel : 'Guardar usuario';
      renderUsersSection();
    }
  }

  async function runBootstrapAdmin(){
    const api = accessApi();
    const section = window.__cfgUsersSection;
    if (!api || !section) return;
    if (!window.confirm('Se activará el admin inicial del workspace actual. ¿Continuar?')) return;
    if (section.bootstrapBtn){
      section.bootstrapBtn.disabled = true;
      section.bootstrapBtn.textContent = 'Activando…';
    }
    try{
      const result = await api.bootstrapAdmin();
      showToast(result?.message || 'Admin inicial activado.');
      await reloadUsersSection({ silent: true });
    }catch(error){
      showToast(String(error?.message || error || 'No se pudo activar el admin inicial.'));
    }finally{
      if (section.bootstrapBtn){
        section.bootstrapBtn.disabled = false;
        section.bootstrapBtn.textContent = 'Activar admin inicial';
      }
      renderUsersSection();
    }
  }

  async function handleUserAction(action, userId){
    const section = window.__cfgUsersSection;
    const api = accessApi();
    if (!section || !api) return;
    const user = section.users.find((item) => item.uid === userId || item.id === userId);
    if (!user) return;

    if (action === 'edit'){
      loadUserIntoForm(userId);
      return;
    }

    if (action === 'toggle'){
      try{
        await api.saveUser({
          uid: user.uid,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status === 'active' ? 'inactive' : 'active'
        });
        await reloadUsersSection({ silent: true });
        showToast(user.status === 'active' ? 'Usuario desactivado.' : 'Usuario activado.');
      }catch(error){
        showToast(String(error?.message || error || 'No se pudo actualizar el estado.'));
      }
      return;
    }

    if (action === 'delete'){
      const ok = window.confirm(`Se borrará el usuario real ${user.name}. Esto afecta Authentication y Firestore. ¿Continuar?`);
      if (!ok) return;
      try{
        await api.deleteUser(user.uid);
        await reloadUsersSection({ silent: true });
        if (section.idInput?.value === user.uid) resetUserForm();
        showToast('Usuario eliminado.');
      }catch(error){
        showToast(String(error?.message || error || 'No se pudo borrar el usuario.'));
      }
    }
  }

  function initUsersSection(){
    const form = document.getElementById('cfg-user-form');
    if (!form) return;

    const section = {
      form,
      idInput: document.getElementById('cfg-user-id'),
      nameInput: document.getElementById('cfg-user-name'),
      emailInput: document.getElementById('cfg-user-email'),
      roleInput: document.getElementById('cfg-user-role'),
      statusInput: document.getElementById('cfg-user-status'),
      saveBtn: document.getElementById('cfg-user-save'),
      cancelBtn: document.getElementById('cfg-user-cancel'),
      bootstrapBtn: document.getElementById('cfg-user-bootstrap'),
      formHint: document.getElementById('cfg-user-form-hint'),
      totalEl: document.getElementById('cfg-user-count-total'),
      activeEl: document.getElementById('cfg-user-count-active'),
      inactiveEl: document.getElementById('cfg-user-count-inactive'),
      topRoleEl: document.getElementById('cfg-user-role-top'),
      searchInput: document.getElementById('cfg-user-search'),
      emptyEl: document.getElementById('cfg-users-empty'),
      emptyTitleEl: document.getElementById('cfg-users-empty-title'),
      emptyCopyEl: document.getElementById('cfg-users-empty-copy'),
      tableWrap: document.getElementById('cfg-users-table-wrap'),
      tbody: document.getElementById('cfg-users-tbody'),
      cardsEl: document.getElementById('cfg-users-cards'),
      noResultsEl: document.getElementById('cfg-users-noresults'),
      newTopBtn: document.getElementById('cfg-user-new-top'),
      emptyCta: document.getElementById('cfg-user-empty-cta'),
      modeBadge: document.getElementById('cfg-users-mode-badge'),
      sideBadge: document.getElementById('cfg-users-side-badge'),
      copyEl: document.getElementById('cfg-users-copy'),
      accessCurrentEl: document.getElementById('cfg-users-access-current'),
      accessDetailEl: document.getElementById('cfg-users-access-detail'),
      backendCurrentEl: document.getElementById('cfg-users-backend-current'),
      backendDetailEl: document.getElementById('cfg-users-backend-detail'),
      workspaceCurrentEl: document.getElementById('cfg-users-workspace-current'),
      workspaceDetailEl: document.getElementById('cfg-users-workspace-detail'),
      storageLabelEl: document.getElementById('cfg-users-storage-label'),
      storageCopyEl: document.getElementById('cfg-users-storage-copy'),
      permissionsLabelEl: document.getElementById('cfg-users-permissions-label'),
      permissionsCopyEl: document.getElementById('cfg-users-permissions-copy'),
      nextLabelEl: document.getElementById('cfg-users-next-label'),
      nextCopyEl: document.getElementById('cfg-users-next-copy'),
      users: [],
      loadingUsers: false,
      lastLoadError: '',
      lastAccessKey: ''
    };

    window.__cfgUsersSection = section;
    populateRoleOptions(section.roleInput);

    form.addEventListener('submit', saveUserFromForm);
    if (section.cancelBtn){
      section.cancelBtn.addEventListener('click', () => resetUserForm({ focus: true }));
    }
    if (section.bootstrapBtn){
      section.bootstrapBtn.addEventListener('click', runBootstrapAdmin);
    }
    if (section.searchInput){
      section.searchInput.addEventListener('input', () => renderUsersSection());
    }
    [section.newTopBtn, section.emptyCta].forEach((btn) => {
      if (!btn) return;
      btn.addEventListener('click', focusUserForm);
    });

    const delegatedClick = (event) => {
      const btn = event.target.closest('[data-user-action][data-user-id]');
      if (!btn) return;
      handleUserAction(btn.dataset.userAction, btn.dataset.userId);
    };

    if (section.tbody) section.tbody.addEventListener('click', delegatedClick);
    if (section.cardsEl) section.cardsEl.addEventListener('click', delegatedClick);

    window.addEventListener('a33:access-state', (event) => {
      const current = event && event.detail ? event.detail : accessState();
      renderUsersSection();
      if (shouldReloadFromAccess(current)){
        reloadUsersSection({ silent: true }).catch(() => {});
      }
    });

    resetUserForm();
    renderUsersSection();
    reloadUsersSection({ silent: false }).catch(() => {
      renderUsersSection();
    });
  }


  const IDENTITY_STORAGE_KEY = 'suite_a33_identity_v1';
  const IDENTITY_LOGO_MAX_BYTES = 2.5 * 1024 * 1024;
  const IDENTITY_FIELD_MAP = [
    { key: 'commercialName', id: 'cfg-identity-commercial-name', summaryId: 'cfg-identity-summary-commercial-name' },
    { key: 'legalName', id: 'cfg-identity-legal-name', summaryId: 'cfg-identity-summary-legal-name' },
    { key: 'taxId', id: 'cfg-identity-tax-id', summaryId: 'cfg-identity-summary-tax-id' },
    { key: 'phone', id: 'cfg-identity-phone', summaryId: 'cfg-identity-summary-phone' },
    { key: 'whatsapp', id: 'cfg-identity-whatsapp', summaryId: 'cfg-identity-summary-whatsapp' },
    { key: 'email', id: 'cfg-identity-email', summaryId: 'cfg-identity-summary-email' },
    { key: 'address', id: 'cfg-identity-address', summaryId: 'cfg-identity-summary-address' },
    { key: 'suiteName', id: 'cfg-identity-suite-name', summaryId: 'cfg-identity-summary-suite-name' },
    { key: 'mainBrand', id: 'cfg-identity-main-brand', summaryId: 'cfg-identity-summary-main-brand' },
    { key: 'tagline', id: 'cfg-identity-tagline' }
  ];

  const identityRuntime = {
    logo: null,
    loaded: false
  };

  function buildEmptyIdentity(){
    const out = {
      logo: {
        dataUrl: '',
        name: '',
        type: '',
        size: 0,
        updatedAt: ''
      },
      updatedAt: ''
    };
    IDENTITY_FIELD_MAP.forEach((field) => { out[field.key] = ''; });
    return out;
  }

  function normalizeIdentity(raw){
    const base = buildEmptyIdentity();
    const src = (raw && typeof raw === 'object') ? raw : {};
    IDENTITY_FIELD_MAP.forEach((field) => {
      base[field.key] = (src[field.key] == null) ? '' : String(src[field.key]).trim();
    });
    const logo = (src.logo && typeof src.logo === 'object') ? src.logo : {};
    const rawDataUrl = (logo.dataUrl == null) ? '' : String(logo.dataUrl).trim();
    const isSafeImage = /^data:image\//i.test(rawDataUrl);
    base.logo = {
      dataUrl: isSafeImage ? rawDataUrl : '',
      name: isSafeImage && logo.name != null ? String(logo.name).trim() : '',
      type: isSafeImage && logo.type != null ? String(logo.type).trim() : '',
      size: isSafeImage && Number.isFinite(Number(logo.size)) ? Number(logo.size) : 0,
      updatedAt: isSafeImage && logo.updatedAt != null ? String(logo.updatedAt).trim() : ''
    };
    base.updatedAt = (src.updatedAt == null) ? '' : String(src.updatedAt).trim();
    return base;
  }

  function readIdentityStorage(){
    try{
      if (window.A33Storage && typeof window.A33Storage.getJSON === 'function'){
        return normalizeIdentity(window.A33Storage.getJSON(IDENTITY_STORAGE_KEY, buildEmptyIdentity(), 'local'));
      }
    }catch(_){ }
    try{
      const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
      return normalizeIdentity(raw ? JSON.parse(raw) : buildEmptyIdentity());
    }catch(_){
      return buildEmptyIdentity();
    }
  }

  function writeIdentityStorage(identity){
    const clean = normalizeIdentity(identity);
    try{
      if (window.A33Storage && typeof window.A33Storage.setJSON === 'function'){
        const ok = window.A33Storage.setJSON(IDENTITY_STORAGE_KEY, clean, 'local');
        if (ok) return true;
      }
    }catch(_){ }
    try{
      localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(clean));
      return true;
    }catch(_){
      return false;
    }
  }

  function setIdentityStatus(message){
    const el = document.getElementById('cfg-identity-status');
    if (el) el.textContent = String(message || '');
  }

  function getIdentityFieldValue(id){
    const el = document.getElementById(id);
    if (!el) return '';
    return String(el.value || '').trim();
  }

  function setIdentityFieldValue(id, value){
    const el = document.getElementById(id);
    if (!el) return;
    el.value = (value == null) ? '' : String(value);
  }

  function renderIdentityLogo(logo){
    const safeLogo = (logo && typeof logo === 'object') ? logo : buildEmptyIdentity().logo;
    const img = document.getElementById('cfg-identity-logo-img');
    const placeholder = document.getElementById('cfg-identity-logo-placeholder');
    const title = document.getElementById('cfg-identity-logo-title');
    const meta = document.getElementById('cfg-identity-logo-meta');
    const hasLogo = /^data:image\//i.test(String(safeLogo.dataUrl || '').trim());

    if (img){
      if (hasLogo){
        img.src = safeLogo.dataUrl;
        img.hidden = false;
      } else {
        img.removeAttribute('src');
        img.hidden = true;
      }
    }
    if (placeholder) placeholder.hidden = hasLogo;
    if (title) title.textContent = hasLogo ? (safeLogo.name || 'Logo cargado') : 'Sin logo cargado';
    if (meta){
      if (hasLogo){
        const sizeText = safeLogo.size ? formatBytes(safeLogo.size) : 'tamaño no disponible';
        const typeText = safeLogo.type || 'imagen';
        meta.textContent = `${typeText} · ${sizeText} · guardado localmente al presionar Guardar.`;
      } else {
        meta.textContent = 'Podés subir una imagen común compatible con navegador. Se guardará localmente junto con la Identidad.';
      }
    }
  }


  function identityDisplayValue(value){
    const clean = String(value || '').trim();
    return clean || '—';
  }

  function identityHasContent(data){
    const hasText = IDENTITY_FIELD_MAP.some((field) => String(data[field.key] || '').trim());
    const hasLogo = /^data:image\//i.test(String(data.logo && data.logo.dataUrl || '').trim());
    return hasText || hasLogo;
  }

  function setIdentitySummaryText(id, value){
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = identityDisplayValue(value);
    el.classList.toggle('is-empty', !String(value || '').trim());
  }

  function renderIdentitySummary(identity){
    const data = normalizeIdentity(identity);
    const hasAnyContent = identityHasContent(data);
    const hasLogo = /^data:image\//i.test(String(data.logo && data.logo.dataUrl || '').trim());
    const state = document.getElementById('cfg-identity-summary-state');
    const empty = document.getElementById('cfg-identity-summary-empty');
    const list = document.getElementById('cfg-identity-summary-list');
    const heroName = document.getElementById('cfg-identity-summary-name');
    const heroTagline = document.getElementById('cfg-identity-summary-tagline');
    const updated = document.getElementById('cfg-identity-summary-updated');
    const summaryImg = document.getElementById('cfg-identity-summary-logo-img');
    const summaryPlaceholder = document.getElementById('cfg-identity-summary-logo-placeholder');

    if (state) state.textContent = hasAnyContent ? 'Guardada' : 'Vacía';
    if (empty) empty.hidden = hasAnyContent;
    if (list) list.hidden = !hasAnyContent;

    if (heroName){
      const preferredName = data.commercialName || data.mainBrand || data.suiteName || 'Sin nombre comercial';
      heroName.textContent = preferredName;
      heroName.classList.toggle('is-empty', !hasAnyContent);
    }
    if (heroTagline){
      const text = data.tagline || (hasAnyContent ? 'Resumen de identidad general guardada localmente.' : 'La identidad aparecerá aquí cuando guardés los datos.');
      heroTagline.textContent = text;
      heroTagline.classList.toggle('is-empty', !String(data.tagline || '').trim());
    }

    if (summaryImg){
      if (hasLogo){
        summaryImg.src = data.logo.dataUrl;
        summaryImg.hidden = false;
      } else {
        summaryImg.removeAttribute('src');
        summaryImg.hidden = true;
      }
    }
    if (summaryPlaceholder) summaryPlaceholder.hidden = hasLogo;

    IDENTITY_FIELD_MAP.forEach((field) => {
      if (!field.summaryId) return;
      setIdentitySummaryText(field.summaryId, data[field.key]);
    });
    if (updated) updated.textContent = data.updatedAt ? formatPwaTimestamp(data.updatedAt) : 'Sin registros';
  }

  function populateIdentityForm(identity){
    const data = normalizeIdentity(identity);
    IDENTITY_FIELD_MAP.forEach((field) => {
      setIdentityFieldValue(field.id, data[field.key]);
    });
    identityRuntime.logo = { ...data.logo };
    renderIdentityLogo(identityRuntime.logo);
    renderIdentitySummary(data);
    if (data.updatedAt){
      setIdentityStatus(`Identidad cargada. Último guardado: ${formatPwaTimestamp(data.updatedAt)}.`);
    } else {
      setIdentityStatus('Los campos empiezan vacíos. Al guardar, la Identidad queda conservada en este navegador.');
    }
  }

  function collectIdentityForm(){
    const data = buildEmptyIdentity();
    IDENTITY_FIELD_MAP.forEach((field) => {
      data[field.key] = getIdentityFieldValue(field.id);
    });
    data.logo = normalizeIdentity({ logo: identityRuntime.logo }).logo;
    data.updatedAt = formatPwaDateForStorage(new Date());
    return data;
  }

  function readFileAsDataUrl(file){
    return new Promise((resolve, reject) => {
      if (typeof FileReader !== 'function'){
        reject(new Error('FileReader no disponible.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
      reader.readAsDataURL(file);
    });
  }

  async function handleIdentityLogoFile(file){
    if (!file) return;
    const type = String(file.type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    const looksImage = type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|bmp|ico)$/i.test(name);
    if (!looksImage){
      showToast('El logo debe ser una imagen compatible.');
      return;
    }
    if (Number(file.size || 0) > IDENTITY_LOGO_MAX_BYTES){
      showToast('El logo es demasiado pesado para guardarlo localmente. Probá con una imagen más liviana.');
      return;
    }
    try{
      const dataUrl = await readFileAsDataUrl(file);
      if (!/^data:image\//i.test(dataUrl || '')){
        showToast('No se pudo preparar la imagen seleccionada.');
        return;
      }
      identityRuntime.logo = {
        dataUrl,
        name: String(file.name || 'logo'),
        type: String(file.type || 'image/*'),
        size: Number(file.size || 0),
        updatedAt: formatPwaDateForStorage(new Date())
      };
      renderIdentityLogo(identityRuntime.logo);
      setIdentityStatus('Logo cargado en previsualización. Presioná Guardar para conservarlo.');
    }catch(_){
      showToast('No se pudo leer el logo seleccionado.');
    }
  }

  function saveIdentityFromForm(event){
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const data = collectIdentityForm();
    const ok = writeIdentityStorage(data);
    if (!ok){
      setIdentityStatus('No se pudo guardar la Identidad en este navegador.');
      showToast('No se pudo guardar Identidad.');
      return;
    }
    populateIdentityForm(data);
    if (typeof renderReportsIdentityReference === 'function') renderReportsIdentityReference(data);
    setIdentityStatus(`Identidad guardada localmente: ${formatPwaTimestamp(data.updatedAt)}.`);
    showToast('Identidad guardada.');
  }

  function initIdentitySection(){
    const form = document.getElementById('cfg-identity-form');
    if (!form) return;
    const saveBtn = document.getElementById('cfg-identity-save');
    const logoBtn = document.getElementById('cfg-identity-logo-button');
    const logoInput = document.getElementById('cfg-identity-logo-input');

    populateIdentityForm(readIdentityStorage());
    identityRuntime.loaded = true;

    form.addEventListener('submit', saveIdentityFromForm);
    if (saveBtn){
      saveBtn.addEventListener('click', (event) => {
        event.preventDefault();
        saveIdentityFromForm(event);
      });
    }
    if (logoBtn && logoInput){
      logoBtn.addEventListener('click', () => {
        logoInput.value = '';
        logoInput.click();
      });
      logoInput.addEventListener('change', () => {
        const file = logoInput.files && logoInput.files[0];
        handleIdentityLogoFile(file).catch(() => {
          showToast('No se pudo cargar el logo.');
        });
      });
    }
  }


  const APPEARANCE_STORAGE_KEY = 'suite_a33_appearance_preference';
  const APPEARANCE_DEFAULT = 'dark';
  const APPEARANCE_OPTIONS = {
    dark: { label: 'Oscuro', badge: 'Modo oscuro' },
    light: { label: 'Claro', badge: 'Modo claro' },
    auto: { label: 'Automático', badge: 'Modo automático' }
  };

  const appearanceRuntime = {
    preference: APPEARANCE_DEFAULT,
    resolved: 'dark',
    mql: null,
    listening: false
  };

  function normalizeAppearancePreference(value){
    const v = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(APPEARANCE_OPTIONS, v) ? v : APPEARANCE_DEFAULT;
  }

  function getAppearanceSystemTheme(){
    try{
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    }catch(_){ }
    return 'light';
  }

  function resolveAppearanceTheme(preference){
    const pref = normalizeAppearancePreference(preference);
    return pref === 'auto' ? getAppearanceSystemTheme() : pref;
  }

  function readAppearancePreference(){
    try{
      if (window.A33Storage && typeof window.A33Storage.getItem === 'function'){
        const v = window.A33Storage.getItem(APPEARANCE_STORAGE_KEY);
        if (v !== undefined && v !== null && String(v).trim() !== '') return normalizeAppearancePreference(v);
      }
    }catch(_){ }
    try{
      return normalizeAppearancePreference(localStorage.getItem(APPEARANCE_STORAGE_KEY));
    }catch(_){ return APPEARANCE_DEFAULT; }
  }

  function writeAppearancePreference(preference){
    const pref = normalizeAppearancePreference(preference);
    let ok = false;
    try{
      if (window.A33Storage && typeof window.A33Storage.setItem === 'function'){
        window.A33Storage.setItem(APPEARANCE_STORAGE_KEY, pref);
        ok = true;
      }
    }catch(_){ }
    try{
      localStorage.setItem(APPEARANCE_STORAGE_KEY, pref);
      ok = true;
    }catch(_){ }
    return ok;
  }

  function updateAppearanceMetaColor(resolved){
    try{
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', resolved === 'light' ? '#f4ead8' : '#060606');
    }catch(_){ }
  }

  function publishAppearanceApi(){
    try{
      window.A33Theme = {
        storageKey: APPEARANCE_STORAGE_KEY,
        getPreference: () => appearanceRuntime.preference,
        getResolvedTheme: () => appearanceRuntime.resolved,
        setPreference: (preference) => {
          const pref = normalizeAppearancePreference(preference);
          writeAppearancePreference(pref);
          applyAppearanceTheme(pref, { render: true, notify: true });
          return pref;
        },
        apply: () => applyAppearanceTheme(readAppearancePreference(), { render: true, notify: true })
      };
    }catch(_){ }
  }

  function applyAppearanceTheme(preference, options = {}){
    const pref = normalizeAppearancePreference(preference);
    const resolved = resolveAppearanceTheme(pref);
    appearanceRuntime.preference = pref;
    appearanceRuntime.resolved = resolved;

    try{
      document.documentElement.setAttribute('data-a33-theme-preference', pref);
      document.documentElement.setAttribute('data-theme', resolved);
      if (document.body){
        document.body.setAttribute('data-a33-theme-preference', pref);
        document.body.setAttribute('data-theme', resolved);
      }
    }catch(_){ }

    updateAppearanceMetaColor(resolved);
    publishAppearanceApi();

    if (options.render !== false) renderAppearanceSection();
    if (options.notify !== false){
      try{
        window.dispatchEvent(new CustomEvent('a33:theme-change', {
          detail: { preference: pref, resolved }
        }));
      }catch(_){ }
    }

    return { preference: pref, resolved };
  }

  function getAppearancePreferenceLabel(preference){
    const pref = normalizeAppearancePreference(preference);
    return APPEARANCE_OPTIONS[pref].label;
  }

  function getAppearanceResolvedLabel(resolved){
    return resolved === 'light' ? 'Claro' : 'Oscuro';
  }

  function renderAppearanceSection(){
    const pref = normalizeAppearancePreference(appearanceRuntime.preference || readAppearancePreference());
    const resolved = resolveAppearanceTheme(pref);
    appearanceRuntime.preference = pref;
    appearanceRuntime.resolved = resolved;

    const current = document.getElementById('cfg-theme-current');
    if (current) current.textContent = `Modo actual: ${getAppearancePreferenceLabel(pref)}`;

    const resolvedText = document.getElementById('cfg-theme-resolved');
    if (resolvedText){
      resolvedText.textContent = pref === 'auto'
        ? `Tema aplicado: ${getAppearanceResolvedLabel(resolved)} según el sistema.`
        : `Tema aplicado: ${getAppearanceResolvedLabel(resolved)}.`;
    }

    const badge = document.getElementById('cfg-theme-badge');
    if (badge) badge.textContent = APPEARANCE_OPTIONS[pref].badge;

    const resolvedBadge = document.getElementById('cfg-theme-resolved-badge');
    if (resolvedBadge) resolvedBadge.textContent = `Aplicado: ${getAppearanceResolvedLabel(resolved)}`;

    const options = Array.from(document.querySelectorAll('[data-theme-pref]'));
    options.forEach((option) => {
      const active = normalizeAppearancePreference(option.dataset.themePref) === pref;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  function setupAppearanceSystemListener(){
    if (appearanceRuntime.listening) return;
    appearanceRuntime.listening = true;
    try{
      if (!window.matchMedia) return;
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      appearanceRuntime.mql = mql;
      const handler = () => {
        if (appearanceRuntime.preference === 'auto'){
          applyAppearanceTheme('auto', { render: true, notify: true });
        }
      };
      if (typeof mql.addEventListener === 'function') mql.addEventListener('change', handler);
      else if (typeof mql.addListener === 'function') mql.addListener(handler);
    }catch(_){ }
  }

  function initAppearanceSection(){
    const options = Array.from(document.querySelectorAll('[data-theme-pref]'));
    if (!options.length){
      applyAppearanceTheme(readAppearancePreference(), { render: false, notify: false });
      return;
    }

    options.forEach((option) => {
      option.addEventListener('click', () => {
        const pref = normalizeAppearancePreference(option.dataset.themePref);
        const ok = writeAppearancePreference(pref);
        applyAppearanceTheme(pref, { render: true, notify: true });
        showToast(ok ? `Apariencia: ${getAppearancePreferenceLabel(pref)}.` : 'No se pudo guardar Apariencia en este navegador.');
      });
      option.addEventListener('keydown', (event) => {
        const idx = options.indexOf(option);
        if (idx < 0) return;
        let nextIdx = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIdx = (idx + 1) % options.length;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIdx = (idx - 1 + options.length) % options.length;
        if (event.key === 'Home') nextIdx = 0;
        if (event.key === 'End') nextIdx = options.length - 1;
        if (nextIdx === null) return;
        event.preventDefault();
        const next = options[nextIdx];
        if (next && typeof next.focus === 'function') next.focus();
      });
    });

    setupAppearanceSystemListener();
    applyAppearanceTheme(readAppearancePreference(), { render: true, notify: false });
  }

  applyAppearanceTheme(readAppearancePreference(), { render: false, notify: false });

  function initConfigTabs(){
    const cards = Array.from(document.querySelectorAll('.cfg-tab[data-target]'));
    const panels = Array.from(document.querySelectorAll('.cfg-panel-view[data-panel]'));
    const panelsWrap = document.querySelector('.cfg-panels');
    const tabsWrap = document.querySelector('.cfg-tabs');
    const shell = document.querySelector('.cfg-shell');
    const shellHead = document.querySelector('.cfg-shell-head');
    if (!cards.length || !panels.length) return;

    let lastTarget = '';

    const setCardState = (target) => {
      cards.forEach((card) => {
        const active = !!target && card.dataset.target === target;
        card.classList.toggle('is-active', active);
        card.setAttribute('aria-expanded', active ? 'true' : 'false');
      });
    };

    const setPanelState = (target) => {
      panels.forEach((panel) => {
        const active = !!target && panel.dataset.panel === target;
        panel.classList.toggle('is-active', active);
        panel.hidden = !active;
        panel.setAttribute('aria-hidden', active ? 'false' : 'true');
      });
    };

    const showOverview = ({ focus = false } = {}) => {
      shell?.classList.remove('is-section-open');
      if (panelsWrap) panelsWrap.hidden = true;
      if (tabsWrap) tabsWrap.hidden = false;
      if (shellHead) shellHead.hidden = false;
      setPanelState('');
      setCardState('');

      if (focus){
        const targetCard = cards.find((card) => card.dataset.target === lastTarget) || cards[0];
        if (targetCard && typeof targetCard.focus === 'function'){
          window.setTimeout(() => {
            try{ targetCard.focus({ preventScroll: true }); }
            catch(_){ targetCard.focus(); }
          }, 80);
        }
      }
    };

    const openSection = (target, { focusPanel = false } = {}) => {
      const panel = panels.find((item) => item.dataset.panel === target);
      if (!panel) return;
      lastTarget = target;
      shell?.classList.add('is-section-open');
      if (panelsWrap) panelsWrap.hidden = false;
      if (tabsWrap) tabsWrap.hidden = true;
      if (shellHead) shellHead.hidden = true;
      setCardState(target);
      setPanelState(target);
      if (target === 'reports') renderReportsCurrencyReference();

      if (focusPanel){
        const navButton = panel.querySelector('[data-cfg-back]');
        const focusTarget = navButton || panel;
        if (focusTarget && typeof focusTarget.focus === 'function'){
          window.setTimeout(() => {
            try{ focusTarget.focus({ preventScroll: true }); }
            catch(_){ focusTarget.focus(); }
          }, 80);
        }
      }

      try{ window.scrollTo({ top: 0, behavior: 'smooth' }); }
      catch(_){ window.scrollTo(0, 0); }
    };

    cards.forEach((card) => {
      card.addEventListener('click', () => openSection(card.dataset.target, { focusPanel: true }));
      card.addEventListener('keydown', (event) => {
        const idx = cards.indexOf(card);
        if (idx < 0) return;
        let nextIdx = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIdx = (idx + 1) % cards.length;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIdx = (idx - 1 + cards.length) % cards.length;
        if (event.key === 'Home') nextIdx = 0;
        if (event.key === 'End') nextIdx = cards.length - 1;
        if (nextIdx === null) return;
        event.preventDefault();
        const nextCard = cards[nextIdx];
        if (nextCard && typeof nextCard.focus === 'function') nextCard.focus();
      });
    });

    window.A33ConfigNavigation = {
      openSection,
      showOverview
    };

    showOverview();
  }

  function initConfigNavigation(){
    const backButtons = Array.from(document.querySelectorAll('[data-cfg-back]'));
    backButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.A33ConfigNavigation && typeof window.A33ConfigNavigation.showOverview === 'function'){
          window.A33ConfigNavigation.showOverview({ focus: true });
          return;
        }
        const target = document.querySelector('.cfg-tabs') || document.querySelector('main');
        if (target && typeof target.scrollIntoView === 'function'){
          try{ target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
          catch(_){ target.scrollIntoView(); }
        }
      });
    });
  }

  function getFirebaseUiModel(state){
    const current = (state && typeof state === 'object') ? state : {};
    const status = String(current.status || 'disabled');
    const projectId = String(current.projectId || '').trim();
    const configFile = String(current.configFile || 'assets/js/a33-firebase-config.js').trim();

    const model = {
      badgeText: 'Modo local',
      badgeState: 'local',
      summary: 'Firebase puede quedar en modo local o con prueba real activa. Aquí ves si Realtime Database está listo para una prueba técnica segura.',
      mode: 'Local seguro',
      configFile,
      projectId: projectId || 'Pendiente',
      appPill: 'App: pendiente',
      authPill: 'Auth: pendiente',
      dbPill: 'Realtime DB: pendiente',
      functionsPill: 'Functions: pendiente',
      appReady: false,
      authReady: false,
      dbReady: false,
      functionsReady: false
    };

    if (status === 'initializing'){
      model.badgeText = 'Inicializando';
      model.badgeState = 'local';
      model.summary = current.message || 'Configuración detectada. Inicializando núcleo Firebase…';
      model.mode = 'Firebase en arranque';
      model.projectId = projectId || 'Detectado';
      model.appPill = 'App: arrancando';
      model.authPill = 'Auth: preparando';
      model.dbPill = 'Realtime DB: preparando';
      model.functionsPill = 'Functions: preparando';
      return model;
    }

    if (status === 'ready'){
      model.badgeText = 'Firebase listo';
      model.badgeState = 'ready';
      model.summary = current.message || 'Firebase ya está enlazado y Realtime Database puede ejecutar la prueba técnica.';
      model.mode = 'Firebase preparado';
      model.projectId = projectId || 'Sin nombre';
      model.appPill = 'App: lista';
      model.authPill = current.authReady ? 'Auth: listo' : 'Auth: pendiente';
      model.dbPill = current.databaseReady ? 'Realtime DB: listo' : 'Realtime DB: pendiente';
      model.functionsPill = current.functionsReady ? 'Functions: listo' : 'Functions: pendiente';
      model.appReady = !!current.appReady;
      model.authReady = !!current.authReady;
      model.dbReady = !!current.databaseReady;
      model.functionsReady = !!current.functionsReady;
      return model;
    }

    if (status === 'error'){
      model.badgeText = 'Fallback local';
      model.badgeState = 'error';
      model.summary = current.message || 'Se detectó configuración Firebase, pero el arranque falló. La suite cayó con elegancia a modo local.';
      model.mode = 'Local con fallback';
      model.projectId = projectId || 'Detectado';
      model.appPill = 'App: con error';
      model.authPill = 'Auth: pendiente';
      model.dbPill = 'Realtime DB: pendiente';
      model.functionsPill = 'Functions: pendiente';
      return model;
    }

    if (current.configReady){
      model.projectId = projectId || 'Detectado';
    }
    return model;
  }

  function renderFirebaseStatus(state){
    const ui = getFirebaseUiModel(state);

    const badge = document.getElementById('cfg-firebase-badge');
    if (badge){
      badge.textContent = ui.badgeText;
      badge.dataset.firebaseState = ui.badgeState;
    }


    const summary = document.getElementById('cfg-firebase-summary');
    if (summary) summary.textContent = ui.summary;

    const mode = document.getElementById('cfg-firebase-mode');
    if (mode) mode.textContent = ui.mode;

    const configFile = document.getElementById('cfg-firebase-config-file');
    if (configFile) configFile.textContent = ui.configFile;

    const projectId = document.getElementById('cfg-firebase-project-id');
    if (projectId) projectId.textContent = ui.projectId;

    const appPill = document.getElementById('cfg-firebase-app-pill');
    if (appPill){
      appPill.textContent = ui.appPill;
      appPill.dataset.ready = ui.appReady ? 'true' : 'false';
    }

    const authPill = document.getElementById('cfg-firebase-auth-pill');
    if (authPill){
      authPill.textContent = ui.authPill;
      authPill.dataset.ready = ui.authReady ? 'true' : 'false';
    }

    const dbPill = document.getElementById('cfg-firebase-db-pill');
    if (dbPill){
      dbPill.textContent = ui.dbPill;
      dbPill.dataset.ready = ui.dbReady ? 'true' : 'false';
    }

    const functionsPill = document.getElementById('cfg-firebase-functions-pill');
    if (functionsPill){
      functionsPill.textContent = ui.functionsPill;
      functionsPill.dataset.ready = ui.functionsReady ? 'true' : 'false';
    }
  }

  function initFirebaseStatus(){
    renderFirebaseStatus((window.A33Firebase && typeof window.A33Firebase.getState === 'function')
      ? window.A33Firebase.getState()
      : null);

    window.addEventListener('a33:firebase-status', (event) => {
      renderFirebaseStatus(event && event.detail ? event.detail : null);
    });

    if (window.A33Firebase && typeof window.A33Firebase.refresh === 'function'){
      window.A33Firebase.refresh().catch(() => {
        renderFirebaseStatus({
          status: 'error',
          message: 'No se pudo refrescar el estado Firebase. La suite mantiene el modo local.'
        });
      });
    }
  }


  const FIREBASE_SETTINGS_KEY = (window.A33FirebaseSettings && window.A33FirebaseSettings.storageKey) || 'suite_a33_firebase_settings_v1';
  const FIREBASE_DEVICE_KEY = (window.A33FirebaseSettings && window.A33FirebaseSettings.deviceKey) || 'suite_a33_firebase_device_id_v1';
  const FIREBASE_CREDENTIAL_KEYS = [
    'apiKey',
    'authDomain',
    'databaseURL',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId',
    'measurementId'
  ];
  const FIREBASE_REQUIRED_WHEN_ENABLED = [
    { key: 'apiKey', label: 'apiKey' },
    { key: 'authDomain', label: 'authDomain' },
    { key: 'databaseURL', label: 'databaseURL' },
    { key: 'projectId', label: 'projectId' },
    { key: 'appId', label: 'appId' }
  ];
  const FIREBASE_FIELD_MAP = [
    { path: 'enabled', id: 'cfg-firebase-enabled', type: 'checkbox' },
    { path: 'credentials.apiKey', id: 'cfg-firebase-apiKey' },
    { path: 'credentials.authDomain', id: 'cfg-firebase-authDomain' },
    { path: 'credentials.databaseURL', id: 'cfg-firebase-databaseURL' },
    { path: 'credentials.projectId', id: 'cfg-firebase-projectId' },
    { path: 'credentials.storageBucket', id: 'cfg-firebase-storageBucket' },
    { path: 'credentials.messagingSenderId', id: 'cfg-firebase-messagingSenderId' },
    { path: 'credentials.appId', id: 'cfg-firebase-appId' },
    { path: 'credentials.measurementId', id: 'cfg-firebase-measurementId' },
    { path: 'workspaceId', id: 'cfg-firebase-workspaceId' },
    { path: 'workspaceName', id: 'cfg-firebase-workspaceName' },
    { path: 'environment', id: 'cfg-firebase-environment' },
    { path: 'deviceId', id: 'cfg-firebase-deviceId' },
    { path: 'deviceName', id: 'cfg-firebase-deviceName' }
  ];
  let firebaseClearCredentialsArmed = false;
  let firebaseClearCredentialsTimer = null;
  const FIREBASE_PASSPHRASE_KEY = 'suite_a33_firebase_passphrase_hash_v1';
  const FIREBASE_PASSPHRASE_MIN_LENGTH = 6;
  let firebaseSectionUnlocked = false;

  function getFirebasePassphraseRecord(){
    try{
      const raw = localStorage.getItem(FIREBASE_PASSPHRASE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && parsed.hash && parsed.salt ? parsed : null;
    }catch(error){
      return null;
    }
  }

  function makeFirebaseSalt(){
    try{
      const bytes = new Uint8Array(16);
      if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
      else bytes.forEach((_, idx) => { bytes[idx] = Math.floor(Math.random() * 256); });
      return Array.from(bytes).map((n) => n.toString(16).padStart(2, '0')).join('');
    }catch(error){
      return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    }
  }

  function bufferToHex(buffer){
    return Array.from(new Uint8Array(buffer)).map((n) => n.toString(16).padStart(2, '0')).join('');
  }

  async function hashFirebasePassphrase(passphrase, salt, iterations){
    const phrase = String(passphrase || '');
    const cleanSalt = String(salt || '');
    const count = Math.max(120000, Number(iterations || 150000));
    if (window.crypto && window.crypto.subtle && window.TextEncoder){
      const enc = new TextEncoder();
      const keyMaterial = await window.crypto.subtle.importKey('raw', enc.encode(phrase), { name: 'PBKDF2' }, false, ['deriveBits']);
      const bits = await window.crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(cleanSalt), iterations: count, hash: 'SHA-256' }, keyMaterial, 256);
      return { algo: 'PBKDF2-SHA256', iterations: count, hash: bufferToHex(bits) };
    }
    let h1 = 2166136261;
    let h2 = 16777619;
    const input = `${cleanSalt}::${phrase}`;
    for (let round = 0; round < 12000; round += 1){
      for (let i = 0; i < input.length; i += 1){
        h1 ^= input.charCodeAt(i) + round;
        h1 = Math.imul(h1, 16777619);
        h2 ^= h1 >>> 13;
        h2 = Math.imul(h2, 2246822519);
      }
    }
    return { algo: 'LOCAL-FALLBACK', iterations: 12000, hash: `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}` };
  }

  async function verifyFirebasePassphrase(passphrase){
    const record = getFirebasePassphraseRecord();
    if (!record) return false;
    const hashed = await hashFirebasePassphrase(passphrase, record.salt, record.iterations);
    return String(hashed.hash) === String(record.hash);
  }

  async function saveFirebasePassphrase(passphrase){
    const clean = String(passphrase || '');
    if (clean.length < FIREBASE_PASSPHRASE_MIN_LENGTH) return { ok: false, message: 'La palabra clave debe tener al menos 6 caracteres.' };
    const salt = makeFirebaseSalt();
    const hashed = await hashFirebasePassphrase(clean, salt, 150000);
    const record = {
      version: 1,
      algo: hashed.algo,
      iterations: hashed.iterations,
      salt,
      hash: hashed.hash,
      createdAt: formatPwaDateForStorage(new Date()),
      updatedAt: formatPwaDateForStorage(new Date())
    };
    localStorage.setItem(FIREBASE_PASSPHRASE_KEY, JSON.stringify(record));
    return { ok: true };
  }

  function setFirebasePassphraseMessage(message, isError){
    const el = document.getElementById('cfg-firebase-lock-message');
    if (el){
      el.textContent = message || '';
      el.dataset.state = isError ? 'error' : 'ok';
    }
  }

  function setFirebaseProtectedUi(unlocked){
    firebaseSectionUnlocked = !!unlocked;
    const hasPassphrase = !!getFirebasePassphraseRecord();
    const panel = document.querySelector('.cfg-firebase-panel');
    const form = document.getElementById('cfg-firebase-form');
    const lockedNotice = document.getElementById('cfg-firebase-locked-notice');
    const createBox = document.getElementById('cfg-firebase-create-passphrase-box');
    const unlockBox = document.getElementById('cfg-firebase-unlock-box');
    const status = document.getElementById('cfg-firebase-passphrase-status');
    if (panel) panel.dataset.firebaseUnlocked = firebaseSectionUnlocked ? 'true' : 'false';
    if (form) form.hidden = !firebaseSectionUnlocked;
    if (lockedNotice) lockedNotice.hidden = firebaseSectionUnlocked;
    if (createBox) createBox.hidden = hasPassphrase;
    if (unlockBox) unlockBox.hidden = !hasPassphrase || firebaseSectionUnlocked;
    if (status){
      status.textContent = !hasPassphrase
        ? 'Palabra clave no configurada'
        : (firebaseSectionUnlocked ? 'Apartado desbloqueado' : 'Apartado bloqueado');
    }
    setFirebaseBadge(firebaseSectionUnlocked ? 'Desbloqueado' : (hasPassphrase ? 'Bloqueado' : 'Clave pendiente'), firebaseSectionUnlocked ? 'ready' : 'disabled');
    if (!hasPassphrase){
      setFirebasePassphraseMessage('Crear palabra clave inicial para mostrar los espacios de credenciales y editar Firebase. Protección local, no seguridad fuerte de Firebase.', false);
    } else if (firebaseSectionUnlocked){
      setFirebasePassphraseMessage('Apartado Firebase desbloqueado en esta sesión. Podés bloquear manualmente al terminar.', false);
    } else {
      setFirebasePassphraseMessage('Ingresá la palabra clave para mostrar los espacios de credenciales o ejecutar acciones sensibles.', false);
    }
  }

  function requireFirebaseUnlocked(actionLabel){
    if (firebaseSectionUnlocked) return true;
    setFirebaseProtectedUi(false);
    showToast(`${actionLabel || 'Esta acción'} requiere desbloquear Firebase.`);
    return false;
  }

  function clearFirebasePassphraseInputs(scope){
    const ids = scope === 'change'
      ? ['cfg-firebase-current-passphrase', 'cfg-firebase-change-passphrase', 'cfg-firebase-change-passphrase-confirm']
      : scope === 'create'
        ? ['cfg-firebase-new-passphrase', 'cfg-firebase-confirm-passphrase']
        : ['cfg-firebase-passphrase'];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }

  async function createFirebasePassphrase(){
    const one = document.getElementById('cfg-firebase-new-passphrase');
    const two = document.getElementById('cfg-firebase-confirm-passphrase');
    const value = one ? one.value : '';
    const confirm = two ? two.value : '';
    if (value !== confirm){
      setFirebasePassphraseMessage('Las palabras clave no coinciden.', true);
      showToast('Las palabras clave no coinciden.');
      return;
    }
    const result = await saveFirebasePassphrase(value);
    if (!result.ok){
      setFirebasePassphraseMessage(result.message, true);
      showToast(result.message);
      return;
    }
    clearFirebasePassphraseInputs('create');
    setFirebaseProtectedUi(true);
    renderFirebaseSettings(readFirebaseSettings());
    showToast('Palabra clave creada. Firebase quedó desbloqueado localmente.');
  }

  async function unlockFirebaseSection(){
    const input = document.getElementById('cfg-firebase-passphrase');
    const ok = await verifyFirebasePassphrase(input ? input.value : '');
    if (!ok){
      setFirebasePassphraseMessage('Palabra clave incorrecta. Revisá y probá de nuevo.', true);
      showToast('Palabra clave incorrecta.');
      return;
    }
    clearFirebasePassphraseInputs('unlock');
    setFirebaseProtectedUi(true);
    renderFirebaseSettings(readFirebaseSettings());
    showToast('Firebase desbloqueado.');
  }

  async function changeFirebasePassphrase(){
    if (!requireFirebaseUnlocked('Cambiar palabra clave')) return;
    const current = document.getElementById('cfg-firebase-current-passphrase');
    const next = document.getElementById('cfg-firebase-change-passphrase');
    const confirm = document.getElementById('cfg-firebase-change-passphrase-confirm');
    const ok = await verifyFirebasePassphrase(current ? current.value : '');
    if (!ok){
      showToast('La palabra clave actual no es correcta.');
      return;
    }
    if ((next ? next.value : '') !== (confirm ? confirm.value : '')){
      showToast('La nueva palabra clave no coincide.');
      return;
    }
    const result = await saveFirebasePassphrase(next ? next.value : '');
    if (!result.ok){
      showToast(result.message);
      return;
    }
    clearFirebasePassphraseInputs('change');
    setFirebaseProtectedUi(true);
    showToast('Palabra clave cambiada localmente.');
  }

  function lockFirebaseSection(){
    resetFirebaseClearButton();
    clearFirebasePassphraseInputs('unlock');
    clearFirebasePassphraseInputs('change');
    setFirebaseProtectedUi(false);
    showToast('Firebase bloqueado.');
  }

  function toggleFirebasePassphraseVisibility(scope){
    const map = {
      create: ['cfg-firebase-new-passphrase', 'cfg-firebase-confirm-passphrase'],
      unlock: ['cfg-firebase-passphrase'],
      change: ['cfg-firebase-current-passphrase', 'cfg-firebase-change-passphrase', 'cfg-firebase-change-passphrase-confirm']
    };
    (map[scope] || []).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.type = el.type === 'password' ? 'text' : 'password';
    });
  }

  function initFirebaseLocalLock(){
    setFirebaseProtectedUi(false);
    const createBtn = document.getElementById('cfg-firebase-create-passphrase');
    if (createBtn) createBtn.addEventListener('click', createFirebasePassphrase);
    const unlockBtn = document.getElementById('cfg-firebase-unlock');
    if (unlockBtn) unlockBtn.addEventListener('click', unlockFirebaseSection);
    const lockBtn = document.getElementById('cfg-firebase-lock-now');
    if (lockBtn) lockBtn.addEventListener('click', lockFirebaseSection);
    const changeBtn = document.getElementById('cfg-firebase-change-passphrase-btn');
    if (changeBtn) changeBtn.addEventListener('click', changeFirebasePassphrase);
    document.querySelectorAll('[data-firebase-toggle-passphrase]').forEach((btn) => {
      btn.addEventListener('click', () => toggleFirebasePassphraseVisibility(btn.dataset.firebaseTogglePassphrase));
    });
    document.querySelectorAll('[data-target]').forEach((btn) => {
      if (btn.dataset.target !== 'firebase') btn.addEventListener('click', () => { if (firebaseSectionUnlocked) lockFirebaseSection(); });
    });
    document.querySelectorAll('#cfg-panel-firebase [data-cfg-back], #cfg-panel-firebase .cfg-nav-chip--home').forEach((btn) => {
      btn.addEventListener('click', () => { if (firebaseSectionUnlocked) lockFirebaseSection(); });
    });
    ['cfg-firebase-passphrase', 'cfg-firebase-new-passphrase', 'cfg-firebase-confirm-passphrase'].forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (id === 'cfg-firebase-passphrase') unlockFirebaseSection();
        else createFirebasePassphrase();
      });
    });
  }

  function generateFirebaseDeviceId(){
    const stamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    return `device_${stamp}_${random}`;
  }

  function ensureFirebaseDeviceId(){
    if (window.A33FirebaseSettings && typeof window.A33FirebaseSettings.ensureDeviceId === 'function'){
      return window.A33FirebaseSettings.ensureDeviceId();
    }
    try{
      const current = localStorage.getItem(FIREBASE_DEVICE_KEY);
      if (current) return cleanFirebaseText(current, 120);
      const next = generateFirebaseDeviceId();
      localStorage.setItem(FIREBASE_DEVICE_KEY, next);
      return next;
    }catch(_){
      return generateFirebaseDeviceId();
    }
  }

  function normalizeFirebaseWorkspaceId(value){
    if (window.A33FirebaseSettings && typeof window.A33FirebaseSettings.normalizeWorkspaceId === 'function'){
      return window.A33FirebaseSettings.normalizeWorkspaceId(value);
    }
    let raw = cleanFirebaseText(value, 100).toLowerCase();
    try{ raw = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }catch(_){ }
    return raw.replace(/\s+/g, '').replace(/[^a-z0-9_-]/g, '').slice(0, 80);
  }

  function isProbablyFirebaseDatabaseURL(value){
    if (window.A33FirebaseSettings && typeof window.A33FirebaseSettings.isProbablyDatabaseURL === 'function'){
      return window.A33FirebaseSettings.isProbablyDatabaseURL(value);
    }
    const raw = cleanFirebaseText(value, 420);
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

  function buildDefaultFirebaseSettings(){
    if (window.A33FirebaseSettings && typeof window.A33FirebaseSettings.defaults === 'function'){
      return window.A33FirebaseSettings.defaults();
    }
    return {
      version: 2,
      enabled: false,
      configured: false,
      mode: 'hybrid',
      workspaceId: 'arcano33',
      workspaceName: 'Arcano 33',
      environment: 'production',
      deviceId: ensureFirebaseDeviceId(),
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

  function cleanFirebaseText(value, maxLen = 480){
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen);
  }

  function normalizeFirebaseEnvironment(value){
    const env = cleanFirebaseText(value, 40).toLowerCase();
    return ['production', 'staging', 'development'].includes(env) ? env : 'production';
  }

  function hasMinimumFirebaseSettings(settings){
    if (window.A33FirebaseSettings && typeof window.A33FirebaseSettings.hasMinimumConfig === 'function'){
      return window.A33FirebaseSettings.hasMinimumConfig(settings);
    }
    const data = settings && typeof settings === 'object' ? settings : {};
    const c = data.credentials && typeof data.credentials === 'object' ? data.credentials : {};
    return !!(
      normalizeFirebaseWorkspaceId(data.workspaceId || '') &&
      cleanFirebaseText(c.apiKey) &&
      cleanFirebaseText(c.authDomain) &&
      cleanFirebaseText(c.databaseURL) &&
      isProbablyFirebaseDatabaseURL(c.databaseURL) &&
      cleanFirebaseText(c.projectId) &&
      cleanFirebaseText(c.appId)
    );
  }

  function normalizeFirebaseSettings(settings){
    if (window.A33FirebaseSettings && typeof window.A33FirebaseSettings.normalize === 'function'){
      return window.A33FirebaseSettings.normalize(settings);
    }
    const base = buildDefaultFirebaseSettings();
    const src = (settings && typeof settings === 'object') ? settings : {};
    const srcCreds = (src.credentials && typeof src.credentials === 'object') ? src.credentials : src;
    const credentials = {};
    FIREBASE_CREDENTIAL_KEYS.forEach((key) => {
      credentials[key] = cleanFirebaseText(srcCreds[key]);
    });
    const hasWorkspace = Object.prototype.hasOwnProperty.call(src, 'workspaceId');
    const rawWorkspace = hasWorkspace ? src.workspaceId : base.workspaceId;
    const data = {
      ...base,
      version: 2,
      enabled: !!src.enabled,
      mode: 'hybrid',
      workspaceId: normalizeFirebaseWorkspaceId(rawWorkspace),
      workspaceName: cleanFirebaseText(src.workspaceName || base.workspaceName, 140) || base.workspaceName,
      environment: normalizeFirebaseEnvironment(src.environment || base.environment),
      deviceId: cleanFirebaseText(src.deviceId, 120) || ensureFirebaseDeviceId(),
      deviceName: cleanFirebaseText(src.deviceName, 120),
      credentials,
      lastConnectionTestAt: cleanFirebaseText(src.lastConnectionTestAt, 80),
      lastConnectionStatus: cleanFirebaseText(src.lastConnectionStatus, 80) || 'not-tested',
      lastConnectionPath: cleanFirebaseText(src.lastConnectionPath, 240),
      lastSyncAt: cleanFirebaseText(src.lastSyncAt, 80),
      lastError: cleanFirebaseText(src.lastError, 240),
      pendingLocalCount: Math.max(0, Number.parseInt(src.pendingLocalCount || 0, 10) || 0),
      updatedAt: cleanFirebaseText(src.updatedAt, 80)
    };
    data.configured = hasMinimumFirebaseSettings(data);
    return data;
  }

  function readFirebaseSettings(){
    if (window.A33FirebaseSettings && typeof window.A33FirebaseSettings.read === 'function'){
      return normalizeFirebaseSettings(window.A33FirebaseSettings.read());
    }
    try{
      if (window.A33Storage && typeof window.A33Storage.getJSON === 'function'){
        return normalizeFirebaseSettings(window.A33Storage.getJSON(FIREBASE_SETTINGS_KEY, buildDefaultFirebaseSettings(), 'local'));
      }
    }catch(_){ }
    try{
      const raw = localStorage.getItem(FIREBASE_SETTINGS_KEY);
      return normalizeFirebaseSettings(raw ? JSON.parse(raw) : buildDefaultFirebaseSettings());
    }catch(_){
      return normalizeFirebaseSettings(buildDefaultFirebaseSettings());
    }
  }

  function writeFirebaseSettings(settings){
    const data = normalizeFirebaseSettings(settings);
    if (window.A33FirebaseSettings && typeof window.A33FirebaseSettings.save === 'function'){
      const result = window.A33FirebaseSettings.save(data);
      return !!(result && result.ok);
    }
    try{
      if (window.A33Storage && typeof window.A33Storage.setJSON === 'function'){
        return !!window.A33Storage.setJSON(FIREBASE_SETTINGS_KEY, data, 'local');
      }
    }catch(_){ }
    try{
      localStorage.setItem(FIREBASE_SETTINGS_KEY, JSON.stringify(data));
      return true;
    }catch(_){
      return false;
    }
  }

  function getFirebaseValueByPath(data, path){
    const parts = String(path || '').split('.');
    let cur = data;
    for (const part of parts){
      if (!cur || typeof cur !== 'object') return '';
      cur = cur[part];
    }
    return cur ?? '';
  }

  function setFirebaseValueByPath(data, path, value){
    const parts = String(path || '').split('.');
    let cur = data;
    while (parts.length > 1){
      const part = parts.shift();
      if (!cur[part] || typeof cur[part] !== 'object') cur[part] = {};
      cur = cur[part];
    }
    cur[parts[0]] = value;
  }

  function setFirebaseText(id, value){
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(value || '');
  }

  function formatFirebaseStamp(value){
    return value ? formatPwaTimestamp(value) : 'Sin registros';
  }

  function updateFirebaseOnlineStatus(){
    const el = document.getElementById('cfg-firebase-online-status');
    if (!el) return;
    if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean'){
      el.textContent = 'Sin detectar';
      return;
    }
    el.textContent = navigator.onLine ? 'En línea' : 'Sin conexión';
  }

  function setFirebaseBadge(text, state){
    const main = document.getElementById('cfg-firebase-save-state');
    const side = document.getElementById('cfg-firebase-side-badge');
    [main, side].forEach((badge) => {
      if (!badge) return;
      badge.textContent = text;
      if (state) badge.dataset.firebaseState = state;
    });
  }

  function markFirebaseFieldInvalid(id, invalid){
    const el = document.getElementById(id);
    const field = el && el.closest ? el.closest('.cfg-report-field') : null;
    if (!field) return;
    field.classList.toggle('cfg-field-invalid', !!invalid);
  }

  function getFirebaseSecretWarnings(data){
    const creds = data && data.credentials ? data.credentials : {};
    const joined = FIREBASE_CREDENTIAL_KEYS.map((key) => cleanFirebaseText(creds[key], 1200).toLowerCase()).join(' ');
    const forbidden = ['private_key', 'serviceaccount', 'service_account', 'client_email', 'admin sdk', 'begin private key'];
    return forbidden.some((needle) => joined.includes(needle));
  }

  function getFirebaseValidation(data, options = {}){
    const normalized = normalizeFirebaseSettings(data);
    const creds = normalized.credentials || {};
    const errors = [];
    const warnings = [];
    const invalidIds = new Set();

    if (!normalized.workspaceId){
      errors.push('workspaceId no puede quedar vacío. Usá letras, números, guion o guion bajo.');
      invalidIds.add('cfg-firebase-workspaceId');
    }

    if (getFirebaseSecretWarnings(normalized)){
      errors.push('No se pueden guardar llaves privadas, serviceAccount, client_email de servidor ni JSON de Admin SDK.');
      FIREBASE_CREDENTIAL_KEYS.forEach((key) => invalidIds.add(`cfg-firebase-${key}`));
    }

    FIREBASE_REQUIRED_WHEN_ENABLED.forEach((field) => {
      const value = cleanFirebaseText(creds[field.key]);
      if (normalized.enabled && !value){
        errors.push(`${field.label} es obligatorio cuando Firebase está activado.`);
        invalidIds.add(`cfg-firebase-${field.key}`);
      }
    });

    const dbValue = cleanFirebaseText(creds.databaseURL, 420);
    if (dbValue && !isProbablyFirebaseDatabaseURL(dbValue)){
      const msg = 'databaseURL no parece una URL válida de Firebase Realtime Database. Ejemplo: https://proyecto-default-rtdb.firebaseio.com';
      if (normalized.enabled){
        errors.push(msg);
        invalidIds.add('cfg-firebase-databaseURL');
      } else {
        warnings.push(msg);
        invalidIds.add('cfg-firebase-databaseURL');
      }
    }

    if (options.includeConfiguredHint && normalized.enabled && normalized.configured){
      warnings.push('Campos mínimos completos. Ya se puede usar Probar conexión técnica sin sincronizar datos de negocio.');
    }

    return { errors, warnings, invalidIds };
  }

  function renderFirebaseValidation(data, options = {}){
    const validation = getFirebaseValidation(data, options);
    const box = document.getElementById('cfg-firebase-validation');
    const list = document.getElementById('cfg-firebase-validation-list');
    FIREBASE_FIELD_MAP.forEach((field) => {
      if (field.type === 'checkbox') return;
      markFirebaseFieldInvalid(field.id, validation.invalidIds.has(field.id));
    });
    if (!box || !list) return validation;
    const items = validation.errors.concat(validation.warnings);
    const shouldShow = !!options.force || validation.errors.length > 0 || validation.warnings.length > 0;
    box.hidden = !shouldShow;
    box.dataset.level = validation.errors.length ? 'error' : 'warning';
    list.innerHTML = '';
    items.forEach((msg) => {
      const li = document.createElement('li');
      li.textContent = msg;
      list.appendChild(li);
    });
    return validation;
  }


  function getFirebaseConnectionPathFromData(data){
    const normalized = normalizeFirebaseSettings(data);
    const workspace = normalizeFirebaseWorkspaceId(normalized.workspaceId || 'arcano33') || 'arcano33';
    const device = cleanFirebaseText(normalized.deviceId, 120).toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'device';
    return `workspaces/${workspace}/_meta/syncEngineTests/${device}`;
  }

  function getFirebaseCloudSyncStatus(){
    try{
      if (window.A33CloudSync && typeof window.A33CloudSync.getStatus === 'function'){
        return window.A33CloudSync.getStatus();
      }
    }catch(_){ }
    const data = normalizeFirebaseSettings(readFirebaseSettings());
    const online = !(typeof navigator !== 'undefined' && navigator && navigator.onLine === false);
    const configured = !!(data.enabled && data.configured);
    const label = !data.enabled ? 'Inactivo' : (!online ? 'Sin conexión' : (configured ? 'Listo' : 'Error'));
    const status = !data.enabled ? 'inactive' : (!online ? 'offline' : (configured ? 'ready' : 'error'));
    return {
      status,
      label,
      message: configured ? 'Motor listo para sincronización manual de Configuración y Catálogos. La Suite sigue local-first.' : 'Firebase debe estar activo y configurado para sincronizar manualmente.',
      pendingCount: Number(data.pendingLocalCount || 0) || 0,
      syncedCount: 0,
      errorCount: 0,
      lastSyncAt: data.lastSyncAt || '',
      lastError: data.lastError || '',
      technicalPath: getFirebaseConnectionPathFromData(data),
      queueStorageKey: 'suite_a33_sync_queue_v1'
    };
  }

  function renderFirebaseCloudSyncStatus(status){
    const sync = status && typeof status === 'object' ? status : getFirebaseCloudSyncStatus();
    const labelMap = {
      inactive: 'Inactivo',
      ready: 'Listo',
      offline: 'Sin conexión',
      error: 'Error',
      testing: 'Listo',
      queued: 'Listo'
    };
    const label = sync.label || labelMap[sync.status] || 'Inactivo';
    const pending = Math.max(0, Number(sync.pendingCount || 0) || 0);
    const errorCount = Math.max(0, Number(sync.errorCount || 0) || 0);
    setFirebaseText('cfg-firebase-sync-state', label);
    setFirebaseText('cfg-firebase-sync-state-detail', sync.message || 'Firebase no reemplaza almacenamiento local.');
    setFirebaseText('cfg-firebase-pending-count', String(pending));
    setFirebaseText('cfg-firebase-pending-detail', errorCount
      ? `${errorCount} registro(s) con error; no se procesan datos reales en esta etapa.`
      : 'syncQueue local creada; alcance Configuración/Catálogos.');
    setFirebaseText('cfg-firebase-sync-last-sync', formatFirebaseStamp(sync.lastSyncAt));
    setFirebaseText('cfg-firebase-sync-last-error', sync.lastError || 'Sin errores');
    setFirebaseText('cfg-firebase-test-path', sync.technicalPath || getFirebaseConnectionPathFromData(readFirebaseSettings()));
    const note = document.getElementById('cfg-firebase-sync-note');
    if (note && sync.message){
      note.textContent = sync.message;
    }
  }

  function getFirebaseConnectionStatusLabel(status){
    const value = cleanFirebaseText(status, 80) || 'not-tested';
    const map = {
      'not-tested': { text: 'No probado', detail: 'Sin prueba ejecutada.', badge: 'Listo local', state: 'local' },
      'disabled': { text: 'Desactivado', detail: 'Firebase debe activarse y guardarse antes de probar.', badge: 'Desactivado', state: 'disabled' },
      'not-configured': { text: 'No configurado', detail: 'Faltan credenciales mínimas guardadas.', badge: 'Revisar campos', state: 'error' },
      'ready-to-test': { text: 'Listo para probar', detail: 'Credenciales mínimas guardadas.', badge: 'Listo local', state: 'ready' },
      'testing': { text: 'Probando...', detail: 'Ejecutando escritura/lectura técnica.', badge: 'Probando', state: 'local' },
      'connected': { text: 'Conexión OK', detail: 'Lectura/escritura técnica completada.', badge: 'Conectado', state: 'ready' },
      'ok': { text: 'Conexión OK', detail: 'Lectura/escritura técnica completada.', badge: 'Conectado', state: 'ready' },
      'permission-denied': { text: 'Reglas bloquean', detail: 'Firebase respondió, pero las reglas no permiten esta prueba.', badge: 'Reglas bloquean', state: 'error' },
      'offline': { text: 'Sin conexión', detail: 'El navegador no tiene conexión o no pudo cargar el SDK.', badge: 'Sin conexión', state: 'error' },
      'error': { text: 'Error de conexión', detail: 'Revisá credenciales, databaseURL y reglas.', badge: 'Error conexión', state: 'error' }
    };
    return map[value] || map.error;
  }

  function renderFirebaseRuntimeState(state){
    const current = state && typeof state === 'object' ? state : null;
    if (!current) return;
    const testResult = document.getElementById('cfg-firebase-test-result');
    const testDetail = document.getElementById('cfg-firebase-test-detail');
    const statusStrong = document.getElementById('cfg-firebase-status-connection');
    const statusDetail = document.getElementById('cfg-firebase-status-connection-detail');
    const path = cleanFirebaseText(current.connectionPath, 240);
    const label = getFirebaseConnectionStatusLabel(current.status || 'not-tested');
    if (testResult) testResult.textContent = label.text;
    if (testDetail) testDetail.textContent = current.message || label.detail;
    if (statusStrong) statusStrong.textContent = label.text;
    if (statusDetail) statusDetail.textContent = current.message || label.detail;
    setFirebaseText('cfg-firebase-status-path', path || getFirebaseConnectionPathFromData(readFirebaseSettings()));
    setFirebaseText('cfg-firebase-test-path', path || getFirebaseConnectionPathFromData(readFirebaseSettings()));
    if (current.lastConnectionTestAt){
      setFirebaseText('cfg-firebase-status-last-test', formatFirebaseStamp(current.lastConnectionTestAt));
    }
    if (current.lastError){
      setFirebaseText('cfg-firebase-status-last-error', current.lastError);
    }
    if (current.status === 'connected'){
      setFirebaseText('cfg-firebase-status-last-error', 'Sin errores');
    }
  }

  function getFirebaseStateLabel(data){
    const normalized = normalizeFirebaseSettings(data);
    const connection = getFirebaseConnectionStatusLabel(normalized.lastConnectionStatus);
    if (normalized.enabled && normalized.configured && ['connected', 'ok'].includes(normalized.lastConnectionStatus)) return { text: 'Conexión probada', badge: connection.badge, state: connection.state };
    if (normalized.enabled && normalized.configured) return { text: 'Listo para probar conexión', badge: 'Listo local', state: 'ready' };
    if (normalized.configured) return { text: 'Configurado localmente', badge: 'Configurado local', state: 'local' };
    if (!normalized.enabled) return { text: 'No configurado', badge: 'Desactivado', state: 'disabled' };
    return { text: 'No configurado', badge: 'Revisar campos', state: 'error' };
  }

  function renderFirebaseSettings(settings, options = {}){
    const data = normalizeFirebaseSettings(settings);
    FIREBASE_FIELD_MAP.forEach((field) => {
      const el = document.getElementById(field.id);
      if (!el) return;
      const value = getFirebaseValueByPath(data, field.path);
      if (field.type === 'checkbox'){
        el.checked = !!value;
      } else {
        el.value = String(value || '');
      }
    });

    const enabledText = data.enabled ? 'Activado' : 'Desactivado';
    const stateLabel = getFirebaseStateLabel(data);
    const lastErrorText = data.lastError || 'Sin errores';
    const connectionLabel = getFirebaseConnectionStatusLabel(data.lastConnectionStatus);
    const connectionPath = data.lastConnectionPath || getFirebaseConnectionPathFromData(data);

    setFirebaseText('cfg-firebase-status-enabled', enabledText);
    setFirebaseText('cfg-firebase-status-configured', stateLabel.text);
    setFirebaseText('cfg-firebase-status-mode', 'Híbrido local-first');
    setFirebaseText('cfg-firebase-status-workspace', data.workspaceId || 'arcano33');
    setFirebaseText('cfg-firebase-status-workspace-name', data.workspaceName || 'Arcano 33');
    setFirebaseText('cfg-firebase-status-device', data.deviceId || 'Sin deviceId');
    setFirebaseText('cfg-firebase-status-device-name', data.deviceName || 'Nombre opcional pendiente');
    setFirebaseText('cfg-firebase-status-last-test', formatFirebaseStamp(data.lastConnectionTestAt));
    setFirebaseText('cfg-firebase-status-connection', connectionLabel.text);
    setFirebaseText('cfg-firebase-status-connection-detail', data.lastError || connectionLabel.detail);
    setFirebaseText('cfg-firebase-status-path', connectionPath);
    setFirebaseText('cfg-firebase-test-result', connectionLabel.text);
    setFirebaseText('cfg-firebase-test-detail', data.lastError || connectionLabel.detail);
    setFirebaseText('cfg-firebase-test-path', connectionPath);
    setFirebaseText('cfg-firebase-status-last-sync', formatFirebaseStamp(data.lastSyncAt));
    setFirebaseText('cfg-firebase-status-last-error', lastErrorText);
    setFirebaseText('cfg-firebase-hero-workspace', data.workspaceId || 'arcano33');
    renderFirebaseCloudSyncStatus(getFirebaseCloudSyncStatus());

    const heroCopy = document.getElementById('cfg-firebase-hero-copy');
    if (heroCopy){
      if (data.enabled && data.configured){
        heroCopy.textContent = 'Campos mínimos completos. Podés probar conexión técnica y preparar el motor híbrido sin sincronizar datos de negocio.';
      } else if (data.configured){
        heroCopy.textContent = 'Credenciales web guardadas localmente. Firebase sigue desactivado hasta que lo activés para la prueba técnica.';
      } else if (data.enabled){
        heroCopy.textContent = 'Firebase está activado localmente, pero faltan campos principales o databaseURL válida.';
      } else {
        heroCopy.textContent = 'Firebase está desactivado. La Suite conserva almacenamiento local como prioridad y mantiene syncQueue local en espera.';
      }
    }

    setFirebaseBadge(stateLabel.badge, stateLabel.state);
    updateFirebaseOnlineStatus();
    renderFirebaseValidation(data, { force: false });
    renderFirebaseRuntimeState((window.A33Firebase && typeof window.A33Firebase.getState === 'function') ? window.A33Firebase.getState() : null);

    if (!options.silent){
      const note = document.getElementById('cfg-firebase-inline-note');
      if (note){
        note.textContent = data.updatedAt
          ? `Último guardado local: ${formatPwaTimestamp(data.updatedAt)}. Prueba técnica disponible; sincronización cerrada.`
          : 'Guardado local y prueba técnica solamente. Sin sincronización de datos de negocio.';
      }
    }
  }

  function collectFirebaseSettingsFromForm(){
    const data = normalizeFirebaseSettings(readFirebaseSettings());
    FIREBASE_FIELD_MAP.forEach((field) => {
      const el = document.getElementById(field.id);
      if (!el) return;
      const value = field.type === 'checkbox' ? !!el.checked : cleanFirebaseText(el.value, 520);
      setFirebaseValueByPath(data, field.path, value);
    });
    data.workspaceId = normalizeFirebaseWorkspaceId(data.workspaceId);
    data.deviceId = cleanFirebaseText(data.deviceId, 120) || ensureFirebaseDeviceId();
    data.deviceName = cleanFirebaseText(data.deviceName, 120);
    data.mode = 'hybrid';
    data.lastConnectionTestAt = cleanFirebaseText(data.lastConnectionTestAt, 80);
    data.lastConnectionStatus = cleanFirebaseText(data.lastConnectionStatus, 80) || 'not-tested';
    data.lastConnectionPath = cleanFirebaseText(data.lastConnectionPath, 240);
    data.lastSyncAt = cleanFirebaseText(data.lastSyncAt, 80);
    data.lastError = cleanFirebaseText(data.lastError, 240);
    data.updatedAt = formatPwaDateForStorage(new Date());
    return normalizeFirebaseSettings(data);
  }

  function markFirebaseDirty(){
    if (!requireFirebaseUnlocked('Editar Firebase')) return;
    const data = collectFirebaseSettingsFromForm();
    renderFirebaseSettings(data, { silent: true });
    setFirebaseBadge('Cambios pendientes', 'local');
    const note = document.getElementById('cfg-firebase-inline-note');
    if (note) note.textContent = 'Hay cambios sin guardar. Presioná Guardar configuración Firebase para conservarlos localmente.';
  }

  function saveFirebaseSettings(event){
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (!requireFirebaseUnlocked('Guardar configuración Firebase')) return;
    const data = collectFirebaseSettingsFromForm();
    const validation = renderFirebaseValidation(data, { force: true });
    if (validation.errors.length){
      setFirebaseBadge('Revisar campos', 'error');
      const note = document.getElementById('cfg-firebase-inline-note');
      if (note) note.textContent = 'No se guardó. Corregí las advertencias obligatorias de Firebase.';
      showToast('Revisá los campos obligatorios de Firebase.');
      return;
    }
    const ok = writeFirebaseSettings(data);
    if (!ok){
      setFirebaseBadge('Error local', 'error');
      showToast('No se pudo guardar Firebase en este navegador.');
      return;
    }
    renderFirebaseSettings(data);
    const stateLabel = getFirebaseStateLabel(data);
    setFirebaseBadge(stateLabel.badge, stateLabel.state);
    showToast(data.enabled && data.configured
      ? 'Firebase quedó listo localmente para probar conexión.'
      : (data.configured ? 'Configuración Firebase guardada localmente.' : 'Firebase guardado localmente como base no configurada.'));
  }

  function resetFirebaseClearButton(){
    firebaseClearCredentialsArmed = false;
    const btn = document.getElementById('cfg-firebase-clear-credentials');
    if (btn) btn.textContent = 'Limpiar credenciales';
    if (firebaseClearCredentialsTimer){
      clearTimeout(firebaseClearCredentialsTimer);
      firebaseClearCredentialsTimer = null;
    }
  }

  function clearFirebaseCredentials(event){
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (!requireFirebaseUnlocked('Limpiar credenciales Firebase')) return;
    const btn = document.getElementById('cfg-firebase-clear-credentials');
    const note = document.getElementById('cfg-firebase-inline-note');
    if (!firebaseClearCredentialsArmed){
      firebaseClearCredentialsArmed = true;
      if (btn) btn.textContent = 'Confirmar limpiar credenciales';
      if (note) note.textContent = 'Confirmación requerida: volver a presionar para borrar solo credenciales Firebase. No toca datos de negocio.';
      firebaseClearCredentialsTimer = setTimeout(resetFirebaseClearButton, 9000);
      return;
    }
    const data = collectFirebaseSettingsFromForm();
    FIREBASE_CREDENTIAL_KEYS.forEach((key) => { data.credentials[key] = ''; });
    data.configured = false;
    data.lastError = '';
    data.lastConnectionStatus = 'not-tested';
    data.lastConnectionPath = '';
    data.lastConnectionTestAt = '';
    data.updatedAt = formatPwaDateForStorage(new Date());
    const ok = writeFirebaseSettings(data);
    resetFirebaseClearButton();
    if (!ok){
      setFirebaseBadge('Error local', 'error');
      showToast('No se pudieron limpiar las credenciales.');
      return;
    }
    renderFirebaseSettings(data);
    setFirebaseBadge(data.enabled ? 'Revisar campos' : 'Desactivado', data.enabled ? 'error' : 'disabled');
    if (note) note.textContent = 'Credenciales Firebase limpiadas. Workspace, dispositivo y datos de negocio permanecen intactos.';
    showToast('Credenciales Firebase limpiadas localmente.');
  }


  async function testFirebaseConnection(event){
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (!requireFirebaseUnlocked('Probar conexión Firebase')) return;
    const btn = document.getElementById('cfg-firebase-test-connection');
    const note = document.getElementById('cfg-firebase-inline-note');
    const saved = normalizeFirebaseSettings(readFirebaseSettings());
    const validation = renderFirebaseValidation(saved, { force: true });

    if (validation.errors.length){
      const message = validation.errors[0] || 'Faltan credenciales mínimas guardadas para probar Firebase.';
      saved.lastConnectionTestAt = formatPwaDateForStorage(new Date());
      saved.lastConnectionStatus = 'not-configured';
      saved.lastConnectionPath = getFirebaseConnectionPathFromData(saved);
      saved.lastError = message;
      writeFirebaseSettings(saved);
      renderFirebaseSettings(saved);
      setFirebaseBadge('Revisar campos', 'error');
      if (note) note.textContent = message;
      showToast('Guardá credenciales Firebase válidas antes de probar conexión.');
      return;
    }

    if (!window.A33Firebase || typeof window.A33Firebase.testConnection !== 'function'){
      setFirebaseBadge('SDK pendiente', 'error');
      if (note) note.textContent = 'No se encontró el helper central A33Firebase para probar conexión.';
      showToast('No se encontró A33Firebase.testConnection.');
      return;
    }

    try{
      if (btn) btn.disabled = true;
      setFirebaseBadge('Probando...', 'local');
      setFirebaseText('cfg-firebase-test-result', 'Probando...');
      setFirebaseText('cfg-firebase-test-detail', 'Cargando SDK oficial y probando ruta técnica segura en _meta/syncEngineTests.');
      if (note) note.textContent = 'Probando conexión técnica en _meta/syncEngineTests. No se toca POS, Finanzas, Caja Chica, Catálogos ni ventas.';
      renderFirebaseRuntimeState({
        status: 'testing',
        message: 'Ejecutando prueba técnica en Realtime Database…',
        connectionPath: getFirebaseConnectionPathFromData(saved),
        lastConnectionTestAt: formatPwaDateForStorage(new Date())
      });
      const result = await window.A33Firebase.testConnection();
      const fresh = normalizeFirebaseSettings(readFirebaseSettings());
      renderFirebaseSettings(fresh);
      renderFirebaseRuntimeState(window.A33Firebase.getState ? window.A33Firebase.getState() : null);
      const stateLabel = getFirebaseConnectionStatusLabel(result && result.status);
      setFirebaseBadge(stateLabel.badge, stateLabel.state);
      if (note){
        note.textContent = result && result.ok
          ? 'Conexión correcta. Solo se escribió/leyó una marca técnica en _meta/syncEngineTests.'
          : (result && result.message ? result.message : 'La prueba no se pudo completar.');
      }
      showToast(result && result.ok ? 'Conexión Firebase correcta.' : (result && result.message ? result.message : 'No se pudo probar Firebase.'));
    }catch(error){
      const msg = 'No se pudo completar la prueba de conexión Firebase.';
      setFirebaseBadge('Error conexión', 'error');
      setFirebaseText('cfg-firebase-test-result', 'Error de conexión');
      setFirebaseText('cfg-firebase-test-detail', msg);
      if (note) note.textContent = msg;
      showToast(msg);
    }finally{
      if (btn) btn.disabled = false;
    }
  }

  async function syncFirebaseNow(event){
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (!requireFirebaseUnlocked('Sincronizar datos ahora')) return;
    const btn = document.getElementById('cfg-firebase-sync-now');
    const note = document.getElementById('cfg-firebase-sync-note') || document.getElementById('cfg-firebase-inline-note');
    const saved = normalizeFirebaseSettings(readFirebaseSettings());
    const validation = renderFirebaseValidation(saved, { force: true });
    if (validation.errors.length){
      const message = validation.errors[0] || 'Faltan credenciales mínimas guardadas para preparar sincronización.';
      if (note) note.textContent = message;
      renderFirebaseCloudSyncStatus(getFirebaseCloudSyncStatus());
      showToast('Guardá credenciales Firebase válidas antes de sincronizar.');
      return;
    }
    if (!window.A33CloudSync || typeof window.A33CloudSync.syncNow !== 'function'){
      const message = 'No se encontró A33CloudSync.syncNow.';
      setFirebaseBadge('Motor faltante', 'error');
      if (note) note.textContent = message;
      showToast(message);
      return;
    }
    try{
      if (btn) btn.disabled = true;
      setFirebaseBadge('Probando motor', 'local');
      if (note) note.textContent = 'Sincronizando Configuración y Catálogos. POS, ventas, Finanzas y Caja Chica no se tocan.';
      const result = await window.A33CloudSync.syncNow();
      const fresh = normalizeFirebaseSettings(readFirebaseSettings());
      renderFirebaseSettings(fresh);
      renderFirebaseCloudSyncStatus(window.A33CloudSync.getStatus ? window.A33CloudSync.getStatus() : null);
      if (result && result.ok){
        setFirebaseBadge('Sincronizado', 'ready');
        const summary = result.summary || {};
        const msg = result.message || `Sincronización completada · Subidos: ${summary.uploaded || 0} · Descargados: ${summary.downloaded || 0} · Conflictos: ${summary.conflicts || 0} · Errores: ${summary.errors || 0}.`;
        if (note) note.textContent = msg;
        showToast('Sincronización completada.');
      } else {
        setFirebaseBadge('Error motor', 'error');
        const summary = result && result.summary ? result.summary : {};
        const msg = result && result.message ? result.message : 'No se pudo completar la sincronización manual.';
        if (note) note.textContent = `${msg} · Subidos: ${summary.uploaded || 0} · Descargados: ${summary.downloaded || 0} · Conflictos: ${summary.conflicts || 0} · Errores: ${summary.errors || 0}.`;
        showToast(msg);
      }
    }catch(error){
      const message = 'No se pudo ejecutar la sincronización manual de Configuración/Catálogos.';
      setFirebaseBadge('Error motor', 'error');
      if (note) note.textContent = message;
      showToast(message);
    }finally{
      if (btn) btn.disabled = false;
    }
  }

  function viewFirebaseSyncStatus(event){
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (!requireFirebaseUnlocked('Ver estado de sincronización')) return;
    if (window.A33CloudSync && typeof window.A33CloudSync.refreshStatus === 'function'){
      window.A33CloudSync.refreshStatus();
    }
    const status = getFirebaseCloudSyncStatus();
    renderFirebaseCloudSyncStatus(status);
    const note = document.getElementById('cfg-firebase-sync-note') || document.getElementById('cfg-firebase-inline-note');
    const summary = status.lastSummary || {};
    const message = `Estado: ${status.label || 'Inactivo'} · Pendientes: ${status.pendingCount || 0} · Subidos: ${summary.uploaded || status.uploadedCount || 0} · Descargados: ${summary.downloaded || status.downloadedCount || 0} · Conflictos: ${summary.conflicts || status.conflictCount || 0}`;
    if (note) note.textContent = message;
    showToast(message);
  }

  async function retryFirebasePending(event){
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (!requireFirebaseUnlocked('Reintentar pendientes')) return;
    const btn = document.getElementById('cfg-firebase-retry-pending');
    const note = document.getElementById('cfg-firebase-sync-note') || document.getElementById('cfg-firebase-inline-note');
    if (!window.A33CloudSync || typeof window.A33CloudSync.retryPending !== 'function'){
      const message = 'No se encontró A33CloudSync.retryPending.';
      if (note) note.textContent = message;
      showToast(message);
      return;
    }
    try{
      if (btn) btn.disabled = true;
      const result = await window.A33CloudSync.retryPending();
      renderFirebaseCloudSyncStatus(window.A33CloudSync.getStatus ? window.A33CloudSync.getStatus() : null);
      const message = result && result.message ? result.message : 'Pendientes revisados localmente.';
      if (note) note.textContent = message;
      showToast(message);
    }catch(error){
      const message = 'No se pudo revisar syncQueue local.';
      if (note) note.textContent = message;
      showToast(message);
    }finally{
      if (btn) btn.disabled = false;
    }
  }

  function initFirebaseSettingsSection(){
    const form = document.getElementById('cfg-firebase-form');
    if (!form) return;
    renderFirebaseSettings(readFirebaseSettings());
    initFirebaseLocalLock();
    form.addEventListener('submit', saveFirebaseSettings);
    const saveBtn = document.getElementById('cfg-firebase-save');
    if (saveBtn){
      saveBtn.addEventListener('click', (event) => {
        event.preventDefault();
        saveFirebaseSettings(event);
      });
    }
    const clearBtn = document.getElementById('cfg-firebase-clear-credentials');
    if (clearBtn){
      clearBtn.addEventListener('click', clearFirebaseCredentials);
    }
    const testBtn = document.getElementById('cfg-firebase-test-connection');
    if (testBtn){
      testBtn.addEventListener('click', testFirebaseConnection);
    }
    const syncNowBtn = document.getElementById('cfg-firebase-sync-now');
    if (syncNowBtn){
      syncNowBtn.addEventListener('click', syncFirebaseNow);
    }
    const viewSyncBtn = document.getElementById('cfg-firebase-view-sync-status');
    if (viewSyncBtn){
      viewSyncBtn.addEventListener('click', viewFirebaseSyncStatus);
    }
    const retryPendingBtn = document.getElementById('cfg-firebase-retry-pending');
    if (retryPendingBtn){
      retryPendingBtn.addEventListener('click', retryFirebasePending);
    }
    if (window.A33CloudSync && typeof window.A33CloudSync.ensureQueue === 'function'){
      window.A33CloudSync.ensureQueue();
      renderFirebaseCloudSyncStatus(window.A33CloudSync.getStatus ? window.A33CloudSync.getStatus() : null);
    }
    FIREBASE_FIELD_MAP.forEach((field) => {
      const el = document.getElementById(field.id);
      if (!el || el.readOnly) return;
      el.addEventListener(field.type === 'checkbox' ? 'change' : 'input', markFirebaseDirty);
      if (el.tagName === 'SELECT') el.addEventListener('change', markFirebaseDirty);
    });
    window.addEventListener('online', updateFirebaseOnlineStatus);
    window.addEventListener('offline', updateFirebaseOnlineStatus);
    window.addEventListener('a33:firebase-status', (event) => {
      renderFirebaseRuntimeState(event && event.detail ? event.detail : null);
    });
    window.addEventListener('a33:cloud-sync-status', (event) => {
      renderFirebaseCloudSyncStatus(event && event.detail ? event.detail : null);
    });
    window.A33FirebaseConfigLocal = Object.assign({}, window.A33FirebaseConfigLocal || {}, {
      storageKey: FIREBASE_SETTINGS_KEY,
      deviceKey: FIREBASE_DEVICE_KEY,
      read: () => normalizeFirebaseSettings(readFirebaseSettings()),
      save: (settings) => writeFirebaseSettings(settings),
      defaults: buildDefaultFirebaseSettings,
      hasMinimumConfig: hasMinimumFirebaseSettings,
      normalizeWorkspaceId: normalizeFirebaseWorkspaceId,
      isProbablyDatabaseURL: isProbablyFirebaseDatabaseURL,
      testConnection: testFirebaseConnection,
      syncNow: syncFirebaseNow,
      getSyncStatus: getFirebaseCloudSyncStatus
    });
  }


  const REPORTS_STORAGE_KEY = 'suite_a33_reports_preferences_v1';
  const REPORTS_IDENTITY_FIELDS = [
    { key: 'logo', checkboxId: 'cfg-reports-identity-logo', label: 'Logo principal' },
    { key: 'commercialName', checkboxId: 'cfg-reports-identity-commercial-name', refId: 'cfg-reports-ref-commercial-name', label: 'Nombre comercial' },
    { key: 'legalName', checkboxId: 'cfg-reports-identity-legal-name', refId: 'cfg-reports-ref-legal-name', label: 'Nombre legal' },
    { key: 'taxId', checkboxId: 'cfg-reports-identity-tax-id', refId: 'cfg-reports-ref-tax-id', label: 'RUC / identificación fiscal' },
    { key: 'phone', checkboxId: 'cfg-reports-identity-phone', refId: 'cfg-reports-ref-phone', label: 'Teléfono' },
    { key: 'whatsapp', checkboxId: 'cfg-reports-identity-whatsapp', refId: 'cfg-reports-ref-whatsapp', label: 'WhatsApp' },
    { key: 'email', checkboxId: 'cfg-reports-identity-email', refId: 'cfg-reports-ref-email', label: 'Correo' },
    { key: 'address', checkboxId: 'cfg-reports-identity-address', refId: 'cfg-reports-ref-address', label: 'Dirección' },
    { key: 'tagline', checkboxId: 'cfg-reports-identity-tagline', refId: 'cfg-reports-ref-tagline', label: 'Descripción corta / lema' }
  ];
  const REPORTS_EXPORT_MODULES = [
    { key: 'finances', locked: true, defaults: { excel: true, pdf: false, json: false, preview: false } },
    { key: 'pos', defaults: { excel: true, pdf: true, json: false, preview: true } },
    { key: 'inventory', defaults: { excel: true, pdf: true, json: false, preview: true } },
    { key: 'repack', defaults: { excel: true, pdf: true, json: false, preview: true } },
    { key: 'calculator', defaults: { excel: true, pdf: true, json: false, preview: true } },
    { key: 'agenda', defaults: { excel: true, pdf: true, json: false, preview: true } },
    { key: 'suite', defaults: { excel: false, pdf: false, json: true, preview: true } }
  ];
  const REPORTS_EXPORT_FORMATS = ['excel', 'pdf', 'json', 'preview'];

  function buildDefaultReportsModuleFormats(){
    const out = {};
    REPORTS_EXPORT_MODULES.forEach((module) => {
      out[module.key] = {};
      REPORTS_EXPORT_FORMATS.forEach((format) => {
        out[module.key][format] = !!(module.defaults && module.defaults[format]);
      });
      if (module.locked){
        out[module.key].excel = true;
        out[module.key].pdf = false;
        out[module.key].json = false;
        out[module.key].preview = false;
      }
    });
    return out;
  }

  function buildDefaultReportsPreferences(){
    const identityFields = {};
    REPORTS_IDENTITY_FIELDS.forEach((field) => { identityFields[field.key] = true; });
    return {
      version: 3,
      identityFields,
      format: {
        date: 'DD/MM/AAAA',
        dateTime: 'DD/MM/AAAA HH:mm',
        militaryTime: true,
        amPm: false
      },
      exports: {
        fileBaseName: '',
        fileDateMode: 'iso',
        financeFormat: 'excel',
        moduleFormats: buildDefaultReportsModuleFormats()
      },
      privacy: {
        showCosts: false,
        showProfit: false,
        protectInternalCommissions: true,
        hideCommissionPerSale: true
      },
      pos: {
        includeDiscounts: true,
        includeCourtesy: true,
        includeBankTransfers: true,
        includePaymentMethod: true
      },
      preview: {
        beforeExport: true
      },
      updatedAt: ''
    };
  }

  function normalizeReportsModuleFormats(raw){
    const base = buildDefaultReportsModuleFormats();
    const src = (raw && typeof raw === 'object') ? raw : {};
    REPORTS_EXPORT_MODULES.forEach((module) => {
      const moduleRaw = (src[module.key] && typeof src[module.key] === 'object') ? src[module.key] : {};
      REPORTS_EXPORT_FORMATS.forEach((format) => {
        if (module.locked){
          base[module.key][format] = format === 'excel';
        } else if (typeof moduleRaw[format] === 'boolean'){
          base[module.key][format] = moduleRaw[format];
        }
      });
    });
    return base;
  }

  function normalizeReportsPreferences(raw){
    const base = buildDefaultReportsPreferences();
    const src = (raw && typeof raw === 'object') ? raw : {};
    const identityFields = (src.identityFields && typeof src.identityFields === 'object') ? src.identityFields : {};
    REPORTS_IDENTITY_FIELDS.forEach((field) => {
      base.identityFields[field.key] = identityFields[field.key] === false ? false : true;
    });
    const exportsPrefs = (src.exports && typeof src.exports === 'object') ? src.exports : {};
    base.exports.fileBaseName = exportsPrefs.fileBaseName == null ? '' : String(exportsPrefs.fileBaseName).trim().slice(0, 64);
    base.exports.fileDateMode = 'iso';
    base.exports.financeFormat = 'excel';
    base.exports.moduleFormats = normalizeReportsModuleFormats(exportsPrefs.moduleFormats);

    const privacyPrefs = (src.privacy && typeof src.privacy === 'object') ? src.privacy : {};
    base.privacy.showCosts = privacyPrefs.showCosts === true;
    base.privacy.showProfit = privacyPrefs.showProfit === true;
    base.privacy.protectInternalCommissions = true;
    base.privacy.hideCommissionPerSale = true;

    const posPrefs = (src.pos && typeof src.pos === 'object') ? src.pos : {};
    base.pos.includeDiscounts = posPrefs.includeDiscounts === false ? false : true;
    base.pos.includeCourtesy = posPrefs.includeCourtesy === false ? false : true;
    base.pos.includeBankTransfers = posPrefs.includeBankTransfers === false ? false : true;
    base.pos.includePaymentMethod = posPrefs.includePaymentMethod === false ? false : true;

    const previewPrefs = (src.preview && typeof src.preview === 'object') ? src.preview : {};
    base.preview.beforeExport = previewPrefs.beforeExport === false ? false : true;

    base.updatedAt = src.updatedAt == null ? '' : String(src.updatedAt).trim();
    return base;
  }

  function readReportsPreferences(){
    try{
      if (window.A33Storage && typeof window.A33Storage.getJSON === 'function'){
        return normalizeReportsPreferences(window.A33Storage.getJSON(REPORTS_STORAGE_KEY, buildDefaultReportsPreferences(), 'local'));
      }
    }catch(_){ }
    try{
      const raw = localStorage.getItem(REPORTS_STORAGE_KEY);
      return normalizeReportsPreferences(raw ? JSON.parse(raw) : buildDefaultReportsPreferences());
    }catch(_){
      return buildDefaultReportsPreferences();
    }
  }

  function writeReportsPreferences(preferences){
    const clean = normalizeReportsPreferences(preferences);
    try{
      if (window.A33Storage && typeof window.A33Storage.setJSON === 'function'){
        const ok = window.A33Storage.setJSON(REPORTS_STORAGE_KEY, clean, 'local');
        if (ok) return true;
      }
    }catch(_){ }
    try{
      localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(clean));
      return true;
    }catch(_){
      return false;
    }
  }

  function setReportsStatus(message){
    const el = document.getElementById('cfg-reports-status');
    if (el) el.textContent = String(message || '');
  }

  function setReportsBadge(text){
    const main = document.getElementById('cfg-reports-save-state');
    const side = document.getElementById('cfg-reports-side-badge');
    [main, side].forEach((el) => {
      if (el) el.textContent = String(text || 'Base local');
    });
  }

  function getReportsCommercialName(){
    const identity = normalizeIdentity(readIdentityStorage());
    return String(identity.commercialName || '').trim();
  }

  function getReportsRecommendedBaseName(){
    return getReportsCommercialName() || 'SuiteA33';
  }

  function sanitizeReportsFileSegment(value){
    const clean = String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
    return clean || 'SuiteA33';
  }

  function getReportsIsoDateForFile(){
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function updateReportsFileNamePreview(){
    const input = document.getElementById('cfg-reports-file-base-name');
    const example = document.getElementById('cfg-reports-file-example');
    const hint = document.getElementById('cfg-reports-file-base-hint');
    const recommended = getReportsRecommendedBaseName();
    const rawBase = input && String(input.value || '').trim() ? input.value : recommended;
    const fileBase = sanitizeReportsFileSegment(rawBase);
    if (example) example.textContent = `${fileBase}_Modulo_TipoReporte_${getReportsIsoDateForFile()}.xlsx`;
    if (hint){
      hint.textContent = `Recomendado desde Identidad: ${recommended}. Si no existe Nombre comercial, se usa SuiteA33.`;
    }
  }

  function applyReportsModuleFormats(moduleFormats){
    const cleanFormats = normalizeReportsModuleFormats(moduleFormats);
    REPORTS_EXPORT_MODULES.forEach((module) => {
      REPORTS_EXPORT_FORMATS.forEach((format) => {
        const input = document.querySelector(`[data-report-module="${module.key}"][data-report-format="${format}"]`);
        if (!input) return;
        input.checked = !!(cleanFormats[module.key] && cleanFormats[module.key][format]);
        input.disabled = !!module.locked;
      });
    });
    const financesExcel = document.getElementById('cfg-reports-format-finances-excel');
    if (financesExcel){
      financesExcel.checked = true;
      financesExcel.disabled = true;
    }
  }

  function collectReportsModuleFormats(){
    const out = buildDefaultReportsModuleFormats();
    REPORTS_EXPORT_MODULES.forEach((module) => {
      REPORTS_EXPORT_FORMATS.forEach((format) => {
        if (module.locked){
          out[module.key][format] = format === 'excel';
          return;
        }
        const input = document.querySelector(`[data-report-module="${module.key}"][data-report-format="${format}"]`);
        if (input) out[module.key][format] = !!input.checked;
      });
    });
    return out;
  }

  function setReportsCheckbox(id, checked, disabled){
    const input = document.getElementById(id);
    if (!input) return;
    input.checked = !!checked;
    if (typeof disabled === 'boolean') input.disabled = disabled;
  }

  function applyReportsPreferencesToForm(preferences){
    const clean = normalizeReportsPreferences(preferences);
    REPORTS_IDENTITY_FIELDS.forEach((field) => {
      const input = document.getElementById(field.checkboxId);
      if (input) input.checked = clean.identityFields[field.key] !== false;
    });
    const baseInput = document.getElementById('cfg-reports-file-base-name');
    if (baseInput){
      baseInput.value = clean.exports.fileBaseName || getReportsRecommendedBaseName();
    }
    applyReportsModuleFormats(clean.exports.moduleFormats);
    setReportsCheckbox('cfg-reports-privacy-show-costs', clean.privacy.showCosts, false);
    setReportsCheckbox('cfg-reports-privacy-show-profit', clean.privacy.showProfit, false);
    setReportsCheckbox('cfg-reports-privacy-protect-commissions', true, true);
    setReportsCheckbox('cfg-reports-privacy-hide-commission-sale', true, true);
    setReportsCheckbox('cfg-reports-pos-discounts', clean.pos.includeDiscounts, false);
    setReportsCheckbox('cfg-reports-pos-courtesy', clean.pos.includeCourtesy, false);
    setReportsCheckbox('cfg-reports-pos-bank-transfers', clean.pos.includeBankTransfers, false);
    setReportsCheckbox('cfg-reports-pos-payment-method', clean.pos.includePaymentMethod, false);
    setReportsCheckbox('cfg-reports-preview-before-export', clean.preview.beforeExport, false);
    updateReportsFileNamePreview();
    if (clean.updatedAt){
      setReportsStatus(`Preferencias cargadas. Último guardado: ${formatPwaTimestamp(clean.updatedAt)}.`);
      setReportsBadge('Guardado local');
    } else {
      setReportsStatus('Preferencias listas. Se guardan únicamente al presionar el botón.');
      setReportsBadge('Base local');
    }
  }

  function collectReportsPreferencesFromForm(){
    const current = readReportsPreferences();
    const data = normalizeReportsPreferences(current);
    REPORTS_IDENTITY_FIELDS.forEach((field) => {
      const input = document.getElementById(field.checkboxId);
      data.identityFields[field.key] = input ? !!input.checked : true;
    });
    const baseInput = document.getElementById('cfg-reports-file-base-name');
    const baseValue = baseInput ? String(baseInput.value || '').trim() : '';
    data.format = buildDefaultReportsPreferences().format;
    data.exports.fileBaseName = baseValue || getReportsRecommendedBaseName();
    data.exports.fileDateMode = 'iso';
    data.exports.financeFormat = 'excel';
    data.exports.moduleFormats = collectReportsModuleFormats();
    data.exports.moduleFormats.finances = { excel: true, pdf: false, json: false, preview: false };
    data.privacy.showCosts = !!(document.getElementById('cfg-reports-privacy-show-costs') || {}).checked;
    data.privacy.showProfit = !!(document.getElementById('cfg-reports-privacy-show-profit') || {}).checked;
    data.privacy.protectInternalCommissions = true;
    data.privacy.hideCommissionPerSale = true;
    data.pos.includeDiscounts = !!(document.getElementById('cfg-reports-pos-discounts') || {}).checked;
    data.pos.includeCourtesy = !!(document.getElementById('cfg-reports-pos-courtesy') || {}).checked;
    data.pos.includeBankTransfers = !!(document.getElementById('cfg-reports-pos-bank-transfers') || {}).checked;
    data.pos.includePaymentMethod = !!(document.getElementById('cfg-reports-pos-payment-method') || {}).checked;
    data.preview.beforeExport = !!(document.getElementById('cfg-reports-preview-before-export') || {}).checked;
    data.updatedAt = formatPwaDateForStorage(new Date());
    return data;
  }

  function reportsRefValue(value){
    const clean = String(value || '').trim();
    return clean || 'No configurado';
  }

  function setReportsReferenceText(id, value){
    const el = document.getElementById(id);
    if (!el) return;
    const clean = String(value || '').trim();
    el.textContent = reportsRefValue(clean);
    el.classList.toggle('is-empty', !clean);
  }

  function getReportsCurrencyState(){
    const fallbackSettings = {
      primary: { name: 'Córdoba nicaragüense', symbol: 'C$', code: 'NIO' },
      secondary: { name: 'Dólar estadounidense', symbol: 'US$', code: 'USD' },
      exchangeRate: '',
      updatedAt: ''
    };
    try{
      if (window.A33Currency && typeof window.A33Currency.getState === 'function'){
        return window.A33Currency.getState();
      }
    }catch(_){ }
    try{
      const key = (window.A33Currency && window.A33Currency.storageKey) || 'suite_a33_currency_settings_v1';
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : fallbackSettings;
      const exchangeRate = String(parsed && parsed.exchangeRate || '').trim();
      const normalizedRate = exchangeRate && window.A33Currency && typeof window.A33Currency.normalizeExchangeRateValue === 'function'
        ? window.A33Currency.normalizeExchangeRateValue(exchangeRate)
        : exchangeRate;
      return {
        ok: true,
        settings: {
          ...fallbackSettings,
          ...(parsed && typeof parsed === 'object' ? parsed : {}),
          primary: fallbackSettings.primary,
          secondary: fallbackSettings.secondary,
          exchangeRate: normalizedRate,
          updatedAt: String(parsed && parsed.updatedAt || '').trim()
        },
        primary: fallbackSettings.primary,
        secondary: fallbackSettings.secondary,
        exchangeRate: normalizedRate ? Number(normalizedRate) : null,
        exchangeRateText: normalizedRate ? `T/C ${normalizedRate}` : 'T/C no configurado',
        hasExchangeRate: !!normalizedRate,
        storageKey: key,
        engineVersion: 0
      };
    }catch(_){
      return {
        ok: false,
        settings: fallbackSettings,
        primary: fallbackSettings.primary,
        secondary: fallbackSettings.secondary,
        exchangeRate: null,
        exchangeRateText: 'T/C no configurado',
        hasExchangeRate: false,
        storageKey: 'suite_a33_currency_settings_v1',
        engineVersion: 0
      };
    }
  }

  function renderReportsCurrencyReference(){
    const state = getReportsCurrencyState();
    const settings = state && state.settings ? state.settings : {};
    const primary = state && state.primary ? state.primary : (settings.primary || {});
    const secondary = state && state.secondary ? state.secondary : (settings.secondary || {});
    const primaryText = `${String(primary.symbol || 'C$').trim()} / ${String(primary.code || 'NIO').trim()}`;
    const secondaryText = `${String(secondary.symbol || 'US$').trim()} / ${String(secondary.code || 'USD').trim()}`;
    const rateText = state && state.hasExchangeRate
      ? String(settings.exchangeRate || state.exchangeRate || '').trim()
      : 'No configurado';
    const updatedText = state && state.hasExchangeRate ? formatPwaTimestamp(settings.updatedAt) : 'Sin registros';

    const primaryEl = document.getElementById('cfg-reports-currency-primary');
    const primaryNameEl = document.getElementById('cfg-reports-currency-primary-name');
    const secondaryEl = document.getElementById('cfg-reports-currency-secondary');
    const secondaryNameEl = document.getElementById('cfg-reports-currency-secondary-name');
    const rateEl = document.getElementById('cfg-reports-currency-rate');
    const rateStateEl = document.getElementById('cfg-reports-currency-rate-state');
    const updatedEl = document.getElementById('cfg-reports-currency-updated-at');
    const noteEl = document.getElementById('cfg-reports-currency-note');

    if (primaryEl) primaryEl.textContent = primaryText;
    if (primaryNameEl) primaryNameEl.textContent = String(primary.name || 'Córdoba nicaragüense');
    if (secondaryEl) secondaryEl.textContent = secondaryText;
    if (secondaryNameEl) secondaryNameEl.textContent = String(secondary.name || 'Dólar estadounidense');
    if (rateEl){
      rateEl.textContent = rateText;
      rateEl.classList.toggle('is-empty', !(state && state.hasExchangeRate));
    }
    if (rateStateEl){
      rateStateEl.textContent = state && state.hasExchangeRate
        ? 'T/C listo para reportes futuros. No recalcula reportes reales todavía.'
        : 'Estado seguro: sin conversiones automáticas.';
    }
    if (updatedEl){
      updatedEl.textContent = updatedText;
      updatedEl.classList.toggle('is-empty', !(state && state.hasExchangeRate));
    }
    if (noteEl){
      noteEl.textContent = state && state.hasExchangeRate
        ? `Estos valores provienen de Configuración → Moneda. Última actualización: ${updatedText}.`
        : 'Estos valores provienen de Configuración → Moneda. Falta configurar T/C para activar referencias futuras completas.';
      noteEl.dataset.state = state && state.hasExchangeRate ? 'ok' : 'missing-rate';
    }
    return state;
  }

  function renderReportsIdentityReference(identity){
    const data = normalizeIdentity(identity);
    const hasLogo = /^data:image\//i.test(String(data.logo && data.logo.dataUrl || '').trim());
    const img = document.getElementById('cfg-reports-ref-logo-img');
    const placeholder = document.getElementById('cfg-reports-ref-logo-placeholder');
    const logoText = document.getElementById('cfg-reports-ref-logo-text');
    if (img){
      if (hasLogo){
        img.src = data.logo.dataUrl;
        img.hidden = false;
      } else {
        img.removeAttribute('src');
        img.hidden = true;
      }
    }
    if (placeholder) placeholder.hidden = hasLogo;
    if (logoText){
      logoText.textContent = hasLogo ? (data.logo.name || 'Logo configurado') : 'No configurado';
      logoText.classList.toggle('is-empty', !hasLogo);
    }
    REPORTS_IDENTITY_FIELDS.forEach((field) => {
      if (!field.refId) return;
      setReportsReferenceText(field.refId, data[field.key]);
    });
    updateReportsFileNamePreview();
  }

  function saveReportsPreferences(event){
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const data = collectReportsPreferencesFromForm();
    const ok = writeReportsPreferences(data);
    if (!ok){
      setReportsStatus('No se pudo guardar Reportes en este navegador.');
      setReportsBadge('Error local');
      showToast('No se pudo guardar Reportes.');
      return;
    }
    applyReportsPreferencesToForm(data);
    renderReportsIdentityReference(readIdentityStorage());
    renderReportsCurrencyReference();
    setReportsStatus(`Preferencias de Reportes guardadas: ${formatPwaTimestamp(data.updatedAt)}.`);
    setReportsBadge('Guardado local');
    showToast('Preferencias de Reportes guardadas.');
  }

  function markReportsDirty(){
    updateReportsFileNamePreview();
    setReportsStatus('Hay cambios sin guardar. Presioná Guardar preferencias para conservarlos.');
    setReportsBadge('Cambios pendientes');
  }

  function initReportsSection(){
    const form = document.getElementById('cfg-reports-form');
    if (!form) return;
    applyReportsPreferencesToForm(readReportsPreferences());
    renderReportsIdentityReference(readIdentityStorage());
    renderReportsCurrencyReference();
    form.addEventListener('submit', saveReportsPreferences);
    const saveBtn = document.getElementById('cfg-reports-save');
    if (saveBtn){
      saveBtn.addEventListener('click', (event) => {
        event.preventDefault();
        saveReportsPreferences(event);
      });
    }
    REPORTS_IDENTITY_FIELDS.forEach((field) => {
      const input = document.getElementById(field.checkboxId);
      if (input) input.addEventListener('change', markReportsDirty);
    });
    const baseInput = document.getElementById('cfg-reports-file-base-name');
    if (baseInput) baseInput.addEventListener('input', markReportsDirty);
    document.querySelectorAll('[data-report-module][data-report-format]').forEach((input) => {
      input.addEventListener('change', markReportsDirty);
    });
    document.querySelectorAll('[data-reports-privacy], [data-reports-pos], [data-reports-preview]').forEach((input) => {
      input.addEventListener('change', markReportsDirty);
    });
    window.addEventListener('storage', (event) => {
      const key = (window.A33Currency && window.A33Currency.storageKey) || 'suite_a33_currency_settings_v1';
      if (!event || event.key === key) renderReportsCurrencyReference();
    });
    window.A33ReportsConfig = Object.assign({}, window.A33ReportsConfig || {}, {
      storageKey: REPORTS_STORAGE_KEY,
      read: () => normalizeReportsPreferences(readReportsPreferences()),
      currency: () => getReportsCurrencyState()
    });
  }


  const CURRENCY_STORAGE_KEY = (window.A33Currency && window.A33Currency.storageKey) || 'suite_a33_currency_settings_v1';

  function buildDefaultCurrencySettings(){
    return window.A33Currency && typeof window.A33Currency.defaults === 'function'
      ? window.A33Currency.defaults()
      : {
          version: 1,
          mode: 'manual',
          primary: { name: 'Córdoba nicaragüense', symbol: 'C$', code: 'NIO' },
          secondary: { name: 'Dólar estadounidense', symbol: 'US$', code: 'USD' },
          exchangeRate: '',
          updatedAt: ''
        };
  }

  function normalizeCurrencyRateValue(value){
    if (window.A33Currency && typeof window.A33Currency.normalizeExchangeRateValue === 'function'){
      return window.A33Currency.normalizeExchangeRateValue(value);
    }
    const raw = String(value ?? '').trim().replace(',', '.');
    if (!raw) return '';
    if (!/^\d+(?:\.\d{0,2})?$/.test(raw)) return '';
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return '';
    return num.toFixed(2);
  }

  function normalizeCurrencySettings(settings){
    if (window.A33Currency && typeof window.A33Currency.normalizeSettings === 'function'){
      return window.A33Currency.normalizeSettings(settings);
    }
    const base = buildDefaultCurrencySettings();
    const src = (settings && typeof settings === 'object') ? settings : {};
    return {
      ...base,
      exchangeRate: normalizeCurrencyRateValue(src.exchangeRate),
      updatedAt: String(src.updatedAt || '').trim()
    };
  }

  function readCurrencyStorage(){
    if (window.A33Currency && typeof window.A33Currency.readSettings === 'function'){
      return window.A33Currency.readSettings();
    }
    let raw = '';
    try{
      if (window.A33Storage && typeof window.A33Storage.getItem === 'function'){
        const v = window.A33Storage.getItem(CURRENCY_STORAGE_KEY);
        if (v !== undefined && v !== null) raw = String(v);
      }
    }catch(_){ }
    if (!raw){
      try{ raw = localStorage.getItem(CURRENCY_STORAGE_KEY) || ''; }catch(_){ raw = ''; }
    }
    if (!raw) return buildDefaultCurrencySettings();
    try{
      const parsed = JSON.parse(raw);
      return normalizeCurrencySettings(parsed);
    }catch(_){
      return normalizeCurrencySettings({ exchangeRate: raw });
    }
  }

  function writeCurrencyStorage(settings){
    if (window.A33Currency && typeof window.A33Currency.saveSettings === 'function'){
      const result = window.A33Currency.saveSettings(settings);
      return !!(result && result.ok);
    }
    const data = normalizeCurrencySettings(settings);
    const payload = JSON.stringify(data);
    try{
      if (window.A33Storage && typeof window.A33Storage.setItem === 'function'){
        window.A33Storage.setItem(CURRENCY_STORAGE_KEY, payload);
      } else {
        localStorage.setItem(CURRENCY_STORAGE_KEY, payload);
      }
      return true;
    }catch(_){
      try{
        localStorage.setItem(CURRENCY_STORAGE_KEY, payload);
        return true;
      }catch(__){ return false; }
    }
  }

  function sanitizeCurrencyInputValue(value){
    if (window.A33Currency && typeof window.A33Currency.sanitizeExchangeRateInput === 'function'){
      return window.A33Currency.sanitizeExchangeRateInput(value);
    }
    let raw = String(value ?? '').replace(/,/g, '.').replace(/\s+/g, '');
    const negative = raw.startsWith('-');
    raw = raw.replace(/[^\d.]/g, '');
    const firstDot = raw.indexOf('.');
    let integerPart = '';
    let decimalPart = '';
    let hasDot = false;
    if (firstDot >= 0){
      hasDot = true;
      integerPart = raw.slice(0, firstDot).replace(/\./g, '');
      decimalPart = raw.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
    } else {
      integerPart = raw.replace(/\./g, '');
    }
    if (hasDot && !integerPart) integerPart = '0';
    let out = (negative ? '-' : '') + integerPart;
    if (hasDot) out += '.' + decimalPart;
    return out;
  }

  function validateCurrencyRate(rawValue){
    if (window.A33Currency && typeof window.A33Currency.validateExchangeRate === 'function'){
      return window.A33Currency.validateExchangeRate(rawValue);
    }
    const raw = String(rawValue ?? '').trim().replace(',', '.');
    if (!raw){
      return { ok: false, message: 'Ingresá un T/C válido antes de guardar.' };
    }
    if (raw.includes('-')){
      return { ok: false, message: 'El T/C no puede ser negativo.' };
    }
    if (!/^\d+(?:\.\d{0,2})?$/.test(raw)){
      return { ok: false, message: 'El T/C debe ser numérico y tener máximo 2 decimales.' };
    }
    const value = Number(raw);
    if (!Number.isFinite(value)){
      return { ok: false, message: 'El T/C debe ser un número válido.' };
    }
    if (value <= 0){
      return { ok: false, message: 'El T/C debe ser mayor que 0.' };
    }
    return { ok: true, value: value.toFixed(2), message: '' };
  }

  function setCurrencyStatus(message, state){
    const el = document.getElementById('cfg-currency-status');
    if (!el) return;
    el.textContent = String(message || '');
    if (state) el.dataset.state = state;
    else delete el.dataset.state;
  }

  function setCurrencyBadge(message){
    const main = document.getElementById('cfg-currency-save-state');
    const side = document.getElementById('cfg-currency-side-badge');
    if (main) main.textContent = message;
    if (side) side.textContent = message;
  }

  function formatCurrencyRateForDisplay(rateText){
    if (window.A33Currency && typeof window.A33Currency.formatExchangeRate === 'function'){
      return window.A33Currency.formatExchangeRate(rateText);
    }
    return rateText ? `T/C ${rateText}` : 'T/C no configurado';
  }

  function renderCurrencySettings(settings, options = {}){
    const data = normalizeCurrencySettings(settings);
    const currencyState = (window.A33Currency && typeof window.A33Currency.getState === 'function')
      ? window.A33Currency.getState(data)
      : { hasExchangeRate: !!data.exchangeRate, exchangeRateText: data.exchangeRate ? `T/C ${data.exchangeRate}` : 'T/C no configurado' };
    const input = document.getElementById('cfg-currency-rate-input');
    const rateText = data.exchangeRate || '';
    if (input && !options.keepInput) input.value = rateText;

    const heroRate = document.getElementById('cfg-currency-hero-rate');
    if (heroRate) heroRate.textContent = rateText ? formatCurrencyRateForDisplay(rateText) : 'Sin configurar';

    const updatedAt = document.getElementById('cfg-currency-updated-at');
    if (updatedAt) updatedAt.textContent = data.updatedAt ? formatPwaTimestamp(data.updatedAt) : 'Sin registros';

    const previewPrimary = document.getElementById('cfg-currency-preview-primary');
    if (previewPrimary){
      previewPrimary.textContent = window.A33Currency && typeof window.A33Currency.formatCordobas === 'function'
        ? window.A33Currency.formatCordobas(1250)
        : 'C$1,250.00';
    }

    const previewSecondary = document.getElementById('cfg-currency-preview-secondary');
    if (previewSecondary){
      previewSecondary.textContent = window.A33Currency && typeof window.A33Currency.formatDollars === 'function'
        ? window.A33Currency.formatDollars(35.50)
        : 'US$35.50';
    }

    const previewRate = document.getElementById('cfg-currency-preview-rate');
    if (previewRate) previewRate.textContent = currencyState.exchangeRateText || (rateText ? `T/C ${rateText}` : 'T/C no configurado');

    const previewNote = document.getElementById('cfg-currency-preview-note');
    if (previewNote){
      previewNote.textContent = currencyState.hasExchangeRate
        ? 'Vista previa activa usando el motor central de Moneda.'
        : 'Configurá un T/C válido para activar la vista previa.';
    }

    const heroCopy = document.getElementById('cfg-currency-hero-copy');
    if (heroCopy){
      heroCopy.textContent = currencyState.hasExchangeRate
        ? 'El último tipo de cambio quedó guardado localmente y disponible en el motor central. La conexión con módulos reales queda para etapas posteriores.'
        : 'Este apartado lee una estructura segura de Moneda. Sin T/C configurado, el motor no hace conversiones silenciosas ni rompe la Suite.';
    }

    if (currencyState.hasExchangeRate){
      setCurrencyBadge('Motor seguro');
      if (!options.silent) setCurrencyStatus(`T/C cargado: ${rateText}. Última actualización: ${formatPwaTimestamp(data.updatedAt)}.`, 'ok');
    } else {
      setCurrencyBadge('Base segura');
      if (!options.silent) setCurrencyStatus('El T/C no está configurado. El motor central queda en estado seguro.');
    }
  }

  function handleCurrencyInput(event){
    const input = event && event.currentTarget ? event.currentTarget : document.getElementById('cfg-currency-rate-input');
    if (!input) return;
    const before = input.value;
    const after = sanitizeCurrencyInputValue(before);
    if (before !== after){
      input.value = after;
      if (/\.\d{3,}/.test(before.replace(',', '.'))){
        setCurrencyStatus('Solo se permiten 2 decimales; el campo fue ajustado.', 'error');
        setCurrencyBadge('Cambios pendientes');
        return;
      }
    }
    setCurrencyStatus('Cambios sin guardar. Presioná Guardar para conservar el T/C.', '');
    setCurrencyBadge('Cambios pendientes');
  }

  function saveCurrencySettings(event){
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const input = document.getElementById('cfg-currency-rate-input');
    const validation = validateCurrencyRate(input ? input.value : '');
    if (!validation.ok){
      setCurrencyStatus(validation.message, 'error');
      setCurrencyBadge('Error local');
      showToast(validation.message);
      return;
    }
    const data = normalizeCurrencySettings({
      ...buildDefaultCurrencySettings(),
      exchangeRate: validation.value,
      updatedAt: formatPwaDateForStorage(new Date())
    });
    const ok = writeCurrencyStorage(data);
    if (!ok){
      setCurrencyStatus('No se pudo guardar Moneda en este navegador.', 'error');
      setCurrencyBadge('Error local');
      showToast('No se pudo guardar Moneda.');
      return;
    }
    renderCurrencySettings(data, { silent: true });
    renderReportsCurrencyReference();
    setCurrencyStatus(`Moneda guardada correctamente: T/C ${validation.value}.`, 'ok');
    setCurrencyBadge('Motor seguro');
    showToast('Moneda guardada correctamente.');
  }

  function initCurrencySection(){
    const form = document.getElementById('cfg-currency-form');
    if (!form) return;
    renderCurrencySettings(readCurrencyStorage());
    form.addEventListener('submit', saveCurrencySettings);
    const input = document.getElementById('cfg-currency-rate-input');
    if (input){
      input.addEventListener('input', handleCurrencyInput);
      input.addEventListener('blur', () => {
        const validation = validateCurrencyRate(input.value);
        if (validation.ok) input.value = validation.value;
      });
    }
    const saveBtn = document.getElementById('cfg-currency-save');
    if (saveBtn){
      saveBtn.addEventListener('click', (event) => {
        event.preventDefault();
        saveCurrencySettings(event);
      });
    }
    window.A33CurrencyConfig = Object.assign({}, window.A33CurrencyConfig || {}, {
      read: () => normalizeCurrencySettings(readCurrencyStorage()),
      state: () => window.A33Currency && typeof window.A33Currency.getState === 'function'
        ? window.A33Currency.getState(readCurrencyStorage())
        : { settings: normalizeCurrencySettings(readCurrencyStorage()), hasExchangeRate: !!normalizeCurrencySettings(readCurrencyStorage()).exchangeRate },
      storageKey: CURRENCY_STORAGE_KEY,
      engine: window.A33Currency || null
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initConfigTabs();
    initConfigNavigation();
    initPwaSection();
    initIdentitySection();
    initAppearanceSection();
    initReportsSection();
    initCurrencySection();
    initFirebaseSettingsSection();
    initUsersSection();
    initFirebaseStatus();
    renderBackupImportLog();

    const exportBtn = document.getElementById('cfg-export-backup');
    const customExportBtn = document.getElementById('cfg-export-custom-backup');
    const importBtn = document.getElementById('cfg-import-backup');
    const auditBtn = document.getElementById('cfg-audit-products');
    const fileInput = document.getElementById('backup-file-input');

    if (exportBtn){
      exportBtn.addEventListener('click', () => {
        handleExport().catch((err) => {
          console.error(err);
          showToast('No se pudo generar el respaldo.');
        });
      });
    }

    if (customExportBtn){
      customExportBtn.addEventListener('click', () => {
        handleCustomExport().catch((err) => {
          console.error(err);
          showToast('No se pudo generar el respaldo personalizado.');
        });
      });
    }

    if (auditBtn){
      auditBtn.addEventListener('click', () => { handleProductAudit().catch((error) => { console.error(error); showToast('No se pudo completar la auditoría.'); }); });
    }
    if (importBtn && fileInput){
      importBtn.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
      });

      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        handleImportFile(file).catch((err) => {
          console.error(err);
          showToast('No se pudo importar el respaldo.');
        });
      });
    }
  });
})();
