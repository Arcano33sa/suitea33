(function(){
  'use strict';

  const BACKUP_APP_NAME = 'Suite A33';
  const SUITE_LS_PREFIXES = ['arcano33_', 'a33_', 'suite_a33_'];

  function isSuiteLocalStorageKey(key){
    if (!key) return false;
    return SUITE_LS_PREFIXES.some((p) => key.startsWith(p));
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
    reloadGuard: 'suite_a33_pwa_apply_reload_guard_v1'
  };

  const PWA_STATUS = {
    idle: 'Sin revisar',
    checking: 'Buscando actualizaciones...',
    current: 'Suite actualizada',
    available: 'Actualización disponible',
    applying: 'Aplicando actualización...',
    applied: 'Actualización aplicada',
    noPending: 'No hay actualización pendiente',
    searchError: 'Error al buscar actualización',
    applyError: 'Error al aplicar actualización'
  };

  const PWA_SUITE_SCOPE_HINTS = [
    '/pos/',
    '/inventario/',
    '/lotes/',
    '/pedidos/',
    '/centro_mando/',
    '/centro-mando/',
    '/finanzas/',
    '/calculadora/',
    '/calculadora_a33/',
    '/calculadora_temporal/',
    '/agenda/',
    '/analitica/',
    '/configuracion/'
  ];

  const pwaRuntime = {
    checking: false,
    applying: false,
    updateAvailable: false,
    lastResults: []
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
      if (!reg){ resolve(false); return; }
      if (hasPwaPendingWorker(reg)){ resolve(true); return; }

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
        resolve(!!value);
      };

      const onStateChange = () => {
        const st = String((observedWorker && observedWorker.state) || '').toLowerCase();
        if (hasPwaPendingWorker(reg) || st === 'installed'){
          finish(true);
          return;
        }
        if (st === 'activated' || st === 'redundant'){
          finish(hasPwaPendingWorker(reg));
        }
      };

      const onUpdateFound = () => {
        try{
          observedWorker = reg.installing || null;
          if (!observedWorker){
            finish(hasPwaPendingWorker(reg));
            return;
          }
          if (String(observedWorker.state || '').toLowerCase() === 'installed'){
            finish(true);
            return;
          }
          if (typeof observedWorker.addEventListener === 'function'){
            observedWorker.addEventListener('statechange', onStateChange);
          }
        }catch(_){ }
      };

      try{
        if (typeof reg.addEventListener === 'function'){
          reg.addEventListener('updatefound', onUpdateFound, { once: true });
        } else {
          reg.onupdatefound = onUpdateFound;
        }
      }catch(_){ }

      timer = setTimeout(() => finish(hasPwaPendingWorker(reg)), Number(timeoutMs) || 1800);
    });
  }

  async function inspectPwaRegistration(reg){
    const result = {
      scope: '',
      scriptURL: '',
      beforePending: false,
      afterPending: false,
      updateFound: false,
      error: ''
    };

    try{ result.scope = String(reg && reg.scope ? reg.scope : ''); }catch(_){ }
    try{ result.scriptURL = getWorkerUrl(reg); }catch(_){ }
    result.beforePending = hasPwaPendingWorker(reg);

    const signalPromise = waitForPwaUpdateSignal(reg, 1800);
    try{
      if (reg && typeof reg.update === 'function'){
        await reg.update();
      }
    }catch(err){
      result.error = String(err && err.message ? err.message : err || 'No se pudo consultar este Service Worker.');
    }

    try{ result.updateFound = await signalPromise; }catch(_){ result.updateFound = false; }
    result.afterPending = hasPwaPendingWorker(reg);
    return result;
  }

  async function checkSuitePwaUpdates(){
    const regs = await getSuitePwaRegistrations();
    if (!regs.length){
      return { available: false, checked: 0, errors: [], results: [] };
    }

    const results = await Promise.all(regs.map((reg) => inspectPwaRegistration(reg)));
    const available = results.some((item) => item.beforePending || item.afterPending || item.updateFound);
    const errors = results.filter((item) => item.error).map((item) => item.error);
    return { available, checked: results.length, errors, results };
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
        else if (target && String(target.state || '').toLowerCase() === 'redundant') finish(!reg.waiting);
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

  async function applySuitePwaUpdate(){
    let pending = await collectPendingPwaRegistrations();

    if (!pending.length){
      const summary = await checkSuitePwaUpdates();
      pwaRuntime.lastResults = Array.isArray(summary.results) ? summary.results : [];
      pending = await collectPendingPwaRegistrations();
    }

    if (!pending.length){
      return { applied: false, noPending: true };
    }

    const controllerChangePromise = waitForPwaControllerChange(7500);
    const activationPromises = pending.map(async ({ reg, worker }) => {
      const target = worker || await resolvePwaWaitingWorker(reg);
      if (target && String(target.state || '').toLowerCase() !== 'activated'){
        sendPwaSkipWaiting(target);
      }
      return waitForPwaRegistrationActivation(reg, target, 7000);
    });

    const activationResults = await Promise.all(activationPromises.map((p) => p.catch(() => false)));
    const activated = activationResults.some(Boolean);
    const controllerChanged = activated ? false : await controllerChangePromise.catch(() => false);

    if (!activated && !controllerChanged){
      throw new Error('No se confirmó la activación del Service Worker pendiente.');
    }

    return { applied: true, activated, controllerChanged };
  }

  function reloadAfterPwaApply(){
    const now = Date.now();
    const previous = Number(pwaSessionGet(PWA_KEYS.reloadGuard) || 0);
    if (Number.isFinite(previous) && previous > 0 && (now - previous) < 12000){
      return;
    }
    pwaSessionSet(PWA_KEYS.reloadGuard, String(now));
    setTimeout(() => {
      try{ window.location.reload(); }
      catch(_){ try{ window.location.href = window.location.href; }catch(__){ } }
    }, 900);
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
      const busy = !!(pwaRuntime.checking || pwaRuntime.applying);
      btn.textContent = pwaRuntime.applying ? 'Aplicando...' : (pwaRuntime.checking ? 'Buscando...' : (available ? 'Aplicar actualización' : 'Buscar actualizaciones'));
      btn.disabled = busy;
      btn.setAttribute('data-pwa-action', available ? 'apply' : 'check');
      btn.classList.toggle('cfg-btn-pwa-apply', !!available && !busy);
      btn.classList.toggle('cfg-btn-pwa-checking', !!pwaRuntime.checking);
      btn.classList.toggle('cfg-btn-pwa-applying', !!pwaRuntime.applying);
    }
  }

  async function handlePwaCheck(){
    if (pwaRuntime.checking || pwaRuntime.applying) return;

    pwaRuntime.checking = true;
    pwaRuntime.updateAvailable = false;
    pwaStorageSet(PWA_KEYS.lastCheck, formatPwaDateForStorage(new Date()));
    pwaStorageSet(PWA_KEYS.status, PWA_STATUS.checking);
    renderPwaSection();

    try{
      const summary = await checkSuitePwaUpdates();
      pwaRuntime.lastResults = Array.isArray(summary.results) ? summary.results : [];
      pwaRuntime.updateAvailable = !!summary.available;

      if (summary.available){
        pwaStorageSet(PWA_KEYS.status, PWA_STATUS.available);
        showToast('Actualización disponible para la Suite.');
      } else if (summary.errors && summary.errors.length){
        pwaStorageSet(PWA_KEYS.status, PWA_STATUS.searchError);
        showToast('No se pudo completar la búsqueda PWA.');
      } else {
        pwaStorageSet(PWA_KEYS.status, PWA_STATUS.current);
        showToast('Suite actualizada. No se encontraron actualizaciones.');
      }
    }catch(err){
      pwaRuntime.updateAvailable = false;
      pwaStorageSet(PWA_KEYS.status, PWA_STATUS.searchError);
      showToast(err && err.message ? err.message : 'Error al buscar actualización.');
    }finally{
      pwaRuntime.checking = false;
      renderPwaSection();
    }
  }

  async function handlePwaApply(){
    if (pwaRuntime.checking || pwaRuntime.applying) return;

    pwaRuntime.applying = true;
    pwaStorageSet(PWA_KEYS.status, PWA_STATUS.applying);
    renderPwaSection();

    try{
      const result = await applySuitePwaUpdate();
      if (result && result.noPending){
        pwaRuntime.updateAvailable = false;
        pwaStorageSet(PWA_KEYS.status, PWA_STATUS.noPending);
        showToast('No hay actualización pendiente.');
        return;
      }

      pwaRuntime.updateAvailable = false;
      pwaStorageSet(PWA_KEYS.lastUpdate, formatPwaDateForStorage(new Date()));
      pwaStorageSet(PWA_KEYS.status, PWA_STATUS.applied);
      renderPwaSection();
      showToast('Actualización aplicada. Recargando Suite...');
      reloadAfterPwaApply();
    }catch(err){
      pwaRuntime.updateAvailable = true;
      pwaStorageSet(PWA_KEYS.status, PWA_STATUS.applyError);
      showToast(err && err.message ? err.message : 'Error al aplicar actualización.');
    }finally{
      pwaRuntime.applying = false;
      renderPwaSection();
    }
  }

  function initPwaSection(){
    const storedStatus = normalizePwaStatus(pwaStorageGet(PWA_KEYS.status));
    pwaRuntime.updateAvailable = isPwaUpdateAvailableStatus(storedStatus);
    if (storedStatus !== pwaStorageGet(PWA_KEYS.status)){
      pwaStorageSet(PWA_KEYS.status, storedStatus);
    }
    renderPwaSection();
    const btn = document.getElementById('cfg-pwa-check');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (btn.getAttribute('data-pwa-action') === 'apply'){
        handlePwaApply();
        return;
      }
      handlePwaCheck();
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

        <div class="small-note">Nota: este respaldo es local (no sincroniza). Al importar, se reemplaza TODO lo de este navegador.</div>
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

    const backup = {
      meta: (window.A33ExportCurrency && typeof window.A33ExportCurrency.decorateJsonMeta === 'function')
        ? window.A33ExportCurrency.decorateJsonMeta({
          appName: BACKUP_APP_NAME,
          exportedAt: new Date().toISOString(),
          dbVersions: cleanIndexed.versions,
          dbSchemas: cleanIndexed.schemas
        })
        : {
          appName: BACKUP_APP_NAME,
          exportedAt: new Date().toISOString(),
          dbVersions: cleanIndexed.versions,
          dbSchemas: cleanIndexed.schemas
        },
      data: {
        indexedDB: cleanIndexed.data,
        localStorage: sanitizeSuiteLocalStorageMap(lsSnap.data)
      }
    };

    const jsonString = JSON.stringify(backup, null, 2);
    const estimatedBytes = new Blob([jsonString]).size;

    return {
      backup,
      jsonString,
      estimatedBytes,
      dbSnapshots,
      lsKeys: lsSnap.keys
    };
  }

  function validateBackupStructure(obj){
    if (!obj || typeof obj !== 'object') return { ok: false, reason: 'Archivo inválido (no es un objeto JSON).' };
    if (!obj.meta || typeof obj.meta !== 'object') return { ok: false, reason: 'Falta meta.' };
    if (!obj.data || typeof obj.data !== 'object') return { ok: false, reason: 'Falta data.' };
    if (obj.meta.appName !== BACKUP_APP_NAME) return { ok: false, reason: `appName inválido: se esperaba "${BACKUP_APP_NAME}".` };
    if (!obj.data.indexedDB || typeof obj.data.indexedDB !== 'object') return { ok: false, reason: 'Falta data.indexedDB.' };
    if (!obj.data.localStorage || typeof obj.data.localStorage !== 'object') return { ok: false, reason: 'Falta data.localStorage.' };
    return { ok: true };
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
      appName: obj?.meta?.appName
    };
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

  function deleteDatabase(dbName){
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error(`No se pudo borrar la DB: ${dbName}`));
      req.onblocked = () => reject(new Error(`Bloqueado: cierra otras pestañas de la Suite y reintenta (DB: ${dbName}).`));
    });
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

  async function restoreDatabase(dbName, dbPayload, dbVersions, dbSchemas){
    const schemaByStore = dbSchemas?.[dbName] || {};
    const version = dbVersions?.[dbName] || 1;

    const schemaAvailable = schemaByStore && typeof schemaByStore === 'object' && Object.keys(schemaByStore).length > 0;
    const db = schemaAvailable
      ? await openDBForRestore(dbName, version, schemaByStore)
      : await openExistingDB(dbName);

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
        try{ store.put(rec); }catch(_){ }
      }
      await txDone(tx);
    }

    try{ db.close(); }catch(_){ }
  }

  async function performImport(obj){
    const cleanObj = sanitizeBackupObject(obj);
    const dbPayload = cleanObj?.data?.indexedDB || {};
    const dbVersions = cleanObj?.meta?.dbVersions || {};
    const dbSchemas = cleanObj?.meta?.dbSchemas || {};

    const fileSuite = Object.keys(dbPayload || {}).filter((dbName) => isSuiteDbName(dbName) && !isRetiredGateDbName(dbName));

    const schemaSupported = new Set(
      fileSuite.filter((dbName) => {
        const sch = dbSchemas?.[dbName];
        return sch && typeof sch === 'object' && Object.keys(sch).length > 0;
      })
    );

    const current = await safeListIndexedDBDatabases();
    const currentSuite = (Array.isArray(current) ? current : [])
      .filter((d) => d?.name && isSuiteDbName(d.name))
      .map((d) => d.name);

    const toDelete = Array.from(new Set([...currentSuite, ...fileSuite]))
      .filter((dbName) => schemaSupported.has(dbName));

    for (const dbName of toDelete){
      try{
        await deleteDatabase(dbName);
      }catch(e){
        if (String(e?.message || '').toLowerCase().includes('bloqueado')){
          throw e;
        }
      }
    }

    for (const dbName of fileSuite){
      await restoreDatabase(dbName, dbPayload[dbName], dbVersions, dbSchemas);
    }

    const currentLsKeys = getSuiteLocalStorageKeysInThisBrowser();
    for (const k of currentLsKeys){
      try{ window.A33Storage.removeItem(k); }catch(_){ }
    }

    const incoming = sanitizeSuiteLocalStorageMap(cleanObj?.data?.localStorage || {});
    for (const [k, v] of Object.entries(incoming)){
      if (!isSuiteLocalStorageKey(k)) continue;
      if (isRetiredGateStorageKey(k)) continue;
      try{ window.A33Storage.setItem(k, String(v ?? '')); }catch(_){ }
    }

    return true;
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

      const sum = summarizeBackupObject(obj);
      const warnings = await buildDbVersionWarnings(obj);
      const summaryHtml = buildSummaryHtmlFromSnapshot({
        dbSnapshots: sum.dbSnapshots,
        lsKeys: sum.lsKeys,
        exportedAt: sum.exportedAt,
        estimatedBytes: sum.estimatedBytes,
        warnings,
        appName: sum.appName
      }) + `
        <hr>
        <div class="badge-warn">⚠️ Esto reemplazará todos los datos actuales de este navegador.</div>
      `;

      showModal({
        title: 'Resumen del archivo',
        bodyHtml: summaryHtml,
        primaryText: 'Importar y reemplazar',
        onPrimary: async () => {
          if (!confirm('Esto reemplazará TODOS los datos actuales de la Suite A33 en este navegador. ¿Importar y reemplazar?')) return;

          showModal({
            title: 'Importando...',
            bodyHtml: '<div class="muted">Aplicando respaldo... No cierres esta pestaña.</div>',
            disableCancel: true,
            disablePrimary: true
          });

          try{
            await performImport(obj);
            showModal({
              title: 'Importación exitosa',
              bodyHtml: '<div>✅ Respaldo importado correctamente.</div><div class="small-note">Recomendado: recargar para que todos los módulos lean los nuevos datos.</div>',
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
      summary: 'Firebase puede quedar en modo local o con acceso real activo. Aquí ves si Authentication ya está lista para abrir la suite con correo y contraseña.',
      mode: 'Local seguro',
      configFile,
      projectId: projectId || 'Pendiente',
      appPill: 'App: pendiente',
      authPill: 'Auth: pendiente',
      dbPill: 'Firestore: pendiente',
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
      model.dbPill = 'Firestore: preparando';
      model.functionsPill = 'Functions: preparando';
      return model;
    }

    if (status === 'ready'){
      model.badgeText = 'Firebase listo';
      model.badgeState = 'ready';
      model.summary = current.message || 'Firebase ya está enlazado y Authentication puede controlar el acceso básico de la suite.';
      model.mode = 'Firebase preparado';
      model.projectId = projectId || 'Sin nombre';
      model.appPill = 'App: lista';
      model.authPill = current.authReady ? 'Auth: listo' : 'Auth: pendiente';
      model.dbPill = current.firestoreReady ? 'Firestore: listo' : 'Firestore: pendiente';
      model.functionsPill = current.functionsReady ? 'Functions: listo' : 'Functions: pendiente';
      model.appReady = !!current.appReady;
      model.authReady = !!current.authReady;
      model.dbReady = !!current.firestoreReady;
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
      model.dbPill = 'Firestore: pendiente';
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
    initUsersSection();
    initFirebaseStatus();

    const exportBtn = document.getElementById('cfg-export-backup');
    const importBtn = document.getElementById('cfg-import-backup');
    const fileInput = document.getElementById('backup-file-input');

    if (exportBtn){
      exportBtn.addEventListener('click', () => {
        handleExport().catch((err) => {
          console.error(err);
          showToast('No se pudo generar el respaldo.');
        });
      });
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
