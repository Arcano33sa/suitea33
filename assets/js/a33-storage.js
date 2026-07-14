/*
  Suite A33 — A33Storage (core)
  Servicio único para acceso a Storage local y temporal.

  - Centraliza get/set/remove/keys
  - Helpers JSON y updateJSON
  - Borrado por prefijos (solo Suite A33)

  GLOBAL — Contrato de persistencia compartida (Etapa 2)
  - Safe JSON I/O (parse/validate)
  - Compatibilidad no destructiva (defaults + tolerancia)
  - Anti-pisadas (rev + merge conservador)
  - Auditoría rápida (console)
*/

(function(){
  'use strict';

  const DEFAULT_PREFIXES = ['arcano33_', 'a33_', 'suite_a33_'];
  const META_SUFFIX = '__meta';
  const LOG_PREFIX = '[A33Storage]';

  const RETIRED_GATE_TAGS = [
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
  const RETIRED_GATE_KEY_EXACT = new Set([
    ['suite_a33_', ['au','th'].join(''), '_v1'].join(''),
    ['suite_a33_', ['pro','file'].join(''), '_v1'].join(''),
    ['suite_a33_', ['ses','sion'].join(''), '_v1'].join(''),
    ['suite_a33_', ['p','in'].join('')].join(''),
    ['suite_a33_exec_', ['un','lock'].join(''), '_v1'].join(''),
    ['suite_a33_last_url_v1'].join('')
  ]);
  const ACTIVE_A33_SW_PATHS = [
    '/calculadora/sw.js',
    '/catalogos/sw.js',
    '/pos/sw.js',
    '/inventario/sw.js',
    '/lotes/sw.js',
    '/pedidos/sw.js'
  ];
  const ACTIVE_A33_CACHE_HINTS = [
    '-calculadora-',
    '-catalogos-',
    '-pos-',
    '-inventario-',
    '-lotes-',
    '-pedidos-'
  ];

  function hasSuitePrefix(key){
    const s = String(key || '').toLowerCase();
    return DEFAULT_PREFIXES.some(p => s.startsWith(p));
  }

  function isRetiredGateHint(value){
    const s = String(value || '').toLowerCase().trim();
    if (!s) return false;
    if (RETIRED_GATE_KEY_EXACT.has(s)) return true;
    return (
      RETIRED_GATE_TAGS.some((tag) => {
        if (!tag) return false;
        if (tag === 'lasturl') return /(?:^|[_-])last[_-]?url(?:[_-]|$)/.test(s);
        const rx = new RegExp('(?:^|[_-])' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[_-]|$)');
        return rx.test(s);
      })
    );
  }

  function isRetiredGateStorageKey(key){
    const s = String(key || '').toLowerCase().trim();
    if (!s) return false;
    if (RETIRED_GATE_KEY_EXACT.has(s)) return true;
    if (!hasSuitePrefix(s)) return false;
    return isRetiredGateHint(s);
  }

  function retiredGateDbName(name){
    const s = String(name || '').toLowerCase().trim();
    if (!s) return false;
    const looksSuite = s.includes('a33') || s.includes('arcano') || s.includes('suite');
    return looksSuite && isRetiredGateHint(s);
  }

  function retiredGateStoreName(name){
    const s = String(name || '').toLowerCase().trim();
    if (!s) return false;
    return isRetiredGateHint(s);
  }

  function isKnownActiveA33CacheName(name){
    const s = String(name || '').toLowerCase().trim();
    if (!s) return false;
    return ACTIVE_A33_CACHE_HINTS.some(h => s.includes(h));
  }

  function isRetiredGateCacheName(name){
    const s = String(name || '').toLowerCase().trim();
    if (!s) return false;
    if (isRetiredGateHint(s)) return true;
    const isA33Cache = s.startsWith('a33-') || s.startsWith('arcano33-');
    if (!isA33Cache) return false;
    return !isKnownActiveA33CacheName(s);
  }

  function isKnownActiveA33ServiceWorker(reg){
    try{
      const active = reg && (reg.active || reg.waiting || reg.installing);
      const scriptUrl = active && active.scriptURL ? new URL(active.scriptURL, window.location.origin) : null;
      const scopeUrl = reg && reg.scope ? new URL(reg.scope, window.location.origin) : null;
      const scriptPath = scriptUrl ? String(scriptUrl.pathname || '').toLowerCase() : '';
      const scopePath = scopeUrl ? String(scopeUrl.pathname || '').toLowerCase() : '';
      return ACTIVE_A33_SW_PATHS.some(path => {
        const p = String(path || '').toLowerCase();
        const scopeNeedle = p.replace(/\/sw\.js$/, '/');
        return scriptPath.endsWith(p) || scopePath.includes(scopeNeedle)
      });
    }catch(_){
      return false;
    }
  }

  function isRetiredGateServiceWorkerRegistration(reg){
    try{
      const active = reg && (reg.active || reg.waiting || reg.installing);
      const scriptUrl = active && active.scriptURL ? new URL(active.scriptURL, window.location.origin) : null;
      const scopeUrl = reg && reg.scope ? new URL(reg.scope, window.location.origin) : null;
      const scriptPath = scriptUrl ? String(scriptUrl.pathname || '').toLowerCase() : '';
      const scopePath = scopeUrl ? String(scopeUrl.pathname || '').toLowerCase() : '';
      const joined = scriptPath + ' ' + scopePath;
      const suspicious = isRetiredGateHint(joined);
      if (suspicious) return true;
      if (isKnownActiveA33ServiceWorker(reg)) return false;
      const looksSuite = joined.includes('/pruebas/') || joined.includes('a33') || joined.includes('arcano') || joined.includes('suite');
      const isGenericSw = scriptPath.endsWith('/sw.js') || scopePath.endsWith('/');
      return looksSuite && isGenericSw;
    }catch(_){
      return false;
    }
  }

  function filterOutRetiredGateEntriesImpl(mapLike){
    const src = (mapLike && typeof mapLike === 'object') ? mapLike : {};
    const out = {};
    for (const [k, v] of Object.entries(src)){
      if (isRetiredGateStorageKey(k)) continue;
      out[k] = v;
    }
    return out;
  }

  function deleteIndexedDBByName(dbName){
    return new Promise((resolve) => {
      try{
        const req = window.indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        req.onblocked = () => resolve(false);
      }catch(_){
        resolve(false);
      }
    });
  }

  async function cleanupRetiredGateResidueImpl(){
    const summary = { local: [], session: [], indexedDB: [], caches: [], serviceWorkers: [] };

    try{
      ['local','session'].forEach((scope) => {
        const store = getStore(scope);
        const keys = [];
        try{
          for (let i = 0; i < store.length; i++){
            const k = store.key(i);
            if (k != null) keys.push(k);
          }
        }catch(_){ }
        keys.filter(isRetiredGateStorageKey).forEach((k) => {
          try{
            store.removeItem(k);
            summary[scope].push(k);
          }catch(_){ }
          try{
            store.removeItem(k + META_SUFFIX);
          }catch(_){ }
        });
      });
    }catch(_){ }

    try{
      if (window.indexedDB && typeof window.indexedDB.databases === 'function'){
        const list = await window.indexedDB.databases();
        const dbs = Array.isArray(list) ? list : [];
        for (const item of dbs){
          const dbName = item && item.name ? String(item.name) : '';
          if (!dbName || !retiredGateDbName(dbName)) continue;
          const ok = await deleteIndexedDBByName(dbName);
          if (ok) summary.indexedDB.push(dbName);
        }
      }
    }catch(_){ }

    try{
      if (window.caches && typeof window.caches.keys === 'function'){
        const cacheNames = await window.caches.keys();
        for (const cacheName of cacheNames){
          if (!isRetiredGateCacheName(cacheName)) continue;
          try{
            const ok = await window.caches.delete(cacheName);
            if (ok) summary.caches.push(cacheName);
          }catch(_){ }
        }
      }
    }catch(_){ }

    try{
      if (window.navigator && navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === 'function'){
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of Array.isArray(regs) ? regs : []){
          if (!isRetiredGateServiceWorkerRegistration(reg)) continue;
          try{
            const ok = await reg.unregister();
            if (ok){
              try{
                const active = reg.active || reg.waiting || reg.installing;
                summary.serviceWorkers.push(active && active.scriptURL ? String(active.scriptURL) : String(reg.scope || ''));
              }catch(_){
                summary.serviceWorkers.push(String(reg.scope || ''));
              }
            }
          }catch(_){ }
        }
      }
    }catch(_){ }

    return summary;
  }


  // ------------------------------
  // Utils
  // ------------------------------
  function isString(x){ return typeof x === 'string'; }
  function isPlainObject(x){
    return !!x && typeof x === 'object' && !Array.isArray(x);
  }

  const _loggedOnce = new Set();
  function logOnce(code, ...args){
    try{
      const k = String(code || '');
      if (!k) return;
      if (_loggedOnce.has(k)) return;
      _loggedOnce.add(k);
      // eslint-disable-next-line no-console
      console.warn(LOG_PREFIX, ...args);
    }catch(_){ }
  }

  function safeJsonParse(str, keyForLog){
    if (!isString(str) || str === '') return null;
    try{ return JSON.parse(str); }
    catch(err){
      logOnce('corrupt:' + String(keyForLog || ''), 'JSON corrupto detectado en', keyForLog || '(sin key)', err);
      return null;
    }
  }

  function validateExpected(val, expected){
    if (!expected) return true;
    if (expected === 'array') return Array.isArray(val);
    if (expected === 'object') return isPlainObject(val);
    return true;
  }

  function getStore(scope){
    return scope === 'session' ? window.sessionStorage : window.localStorage;
  }

  function nowIso(){
    try{ return new Date().toISOString(); }catch(_){ return '';
    }
  }

  function coerceNumber(v, fallback=0, auditCode){
    let n;
    if (typeof v === 'number') n = v;
    else if (typeof v === 'string'){
      const s = v.trim();
      if (!s) n = NaN;
      else n = parseFloat(s.replace(',', '.'));
    } else if (v == null) n = NaN;
    else n = Number(v);

    if (Number.isFinite(n)) return n;

    if (auditCode){
      // Solo loguear si había “algo” no vacío.
      const hasValue = !(v == null) && !(typeof v === 'string' && v.trim() === '');
      if (hasValue) logOnce('nan:' + auditCode, 'Valor NaN/∞ sanitizado', auditCode, v);
    }
    return fallback;
  }

  function coerceInt(v, fallback=0, auditCode){
    const n = coerceNumber(v, fallback, auditCode);
    const i = Math.trunc(n);
    return Number.isFinite(i) ? i : fallback;
  }

  function isLikelyDateKey(k){
    const s = String(k || '').toLowerCase();
    return s.includes('fecha') || s.includes('date') || s.includes('caduc');
  }

  function auditDateMaybe(keyPath, v){
    try{
      if (!v) return;
      const s = String(v);
      const d = new Date(s);
      if (!Number.isFinite(d.getTime())){
        logOnce('date:' + keyPath, 'Fecha inválida detectada', keyPath, v);
      }
    }catch(_){ }
  }

  function deepMergeKeep(base, patch){
    if (Array.isArray(patch)) return patch.slice();
    if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
    const out = { ...base };
    for (const k of Object.keys(patch)){
      const pv = patch[k];
      const bv = base[k];
      if (isPlainObject(pv) && isPlainObject(bv)) out[k] = deepMergeKeep(bv, pv);
      else out[k] = pv;
    }
    return out;
  }

  function mergeArrayById(cur, next, getId){
    const out = Array.isArray(cur) ? cur.slice() : [];
    const idx = new Map();
    for (let i = 0; i < out.length; i++){
      const id = getId(out[i]);
      if (id) idx.set(id, i);
    }
    const arr = Array.isArray(next) ? next : [];
    for (const it of arr){
      const id = getId(it);
      if (id && idx.has(id)){
        const i = idx.get(id);
        const prev = out[i];
        if (isPlainObject(prev) && isPlainObject(it)) out[i] = { ...prev, ...it };
        else out[i] = it;
      } else {
        out.push(it);
        if (id) idx.set(id, out.length - 1);
      }
    }
    return out;
  }

  function detectDeletionById(cur, next, getId){
    const curArr = Array.isArray(cur) ? cur : [];
    const nextArr = Array.isArray(next) ? next : [];
    const curIds = new Set();
    for (const it of curArr){
      const id = getId(it);
      if (id) curIds.add(id);
    }
    if (!curIds.size) return false;
    const nextIds = new Set();
    for (const it of nextArr){
      const id = getId(it);
      if (id) nextIds.add(id);
    }
    for (const id of curIds){
      if (!nextIds.has(id)) return true;
    }
    return false;
  }

  // ------------------------------
  // Shared key contracts
  // ------------------------------
  function stableItemId(prefix, key, src){
    try{
      const s = src && (src.itemId || src.sku || src.id);
      const v = (s != null) ? String(s).trim() : '';
      if (v) return v;
    }catch(_){ }
    const k = (key != null) ? String(key).trim() : '';
    return String(prefix || '') + k;
  }

  function normalizeInventorySection(rawSection, sectionName, options){
    const input = isPlainObject(rawSection) ? rawSection : {};
    const out = {};
    const opts = isPlainObject(options) ? options : {};
    for (const key of Object.keys(input)){
      const src = isPlainObject(input[key]) ? input[key] : {};
      const item = { ...src };
      if (opts.identityPrefix){
        item.itemId = stableItemId(opts.identityPrefix, key, src);
        item.sku = (src.sku != null && String(src.sku).trim())
          ? String(src.sku).trim()
          : item.itemId;
      }
      item.stock = opts.integer
        ? coerceInt(src.stock, 0, 'arcano33_inventario.' + sectionName + '.' + key + '.stock')
        : coerceNumber(src.stock, 0, 'arcano33_inventario.' + sectionName + '.' + key + '.stock');
      if (opts.hasMax){
        item.max = coerceNumber(src.max, 0, 'arcano33_inventario.' + sectionName + '.' + key + '.max');
      }
      if (opts.hasMin){
        item.min = Math.max(0, coerceInt(src.min, 0, 'arcano33_inventario.' + sectionName + '.' + key + '.min'));
      }
      out[key] = item;
    }
    return out;
  }

  function normalizeInventario(raw){
    const d = isPlainObject(raw) ? raw : {};
    const liquids = normalizeInventorySection(d.liquids, 'liquids', { identityPrefix:'liq:', hasMax:true });
    const bottles = normalizeInventorySection(d.bottles, 'bottles', { identityPrefix:'bot:' });
    const finished = normalizeInventorySection(d.finished, 'finished', { identityPrefix:'fin:' });
    const caps = normalizeInventorySection(d.caps, 'caps', { integer:true, hasMin:true });
    const finishedByProductId = {};
    const finishedByProductIn = isPlainObject(d.finishedByProductId) ? d.finishedByProductId : {};
    const movimientosIn = Array.isArray(d.movimientos) ? d.movimientos : [];
    const productionOperationsIn = isPlainObject(d.productionOperations) ? d.productionOperations : {};
    const productionOperations = {};
    for (const operationId of Object.keys(productionOperationsIn)){
      const src = isPlainObject(productionOperationsIn[operationId]) ? productionOperationsIn[operationId] : {};
      const id = String(src.operationId || operationId || '').trim();
      if (!id) continue;
      productionOperations[id] = { ...src, operationId:id };
    }

    // Fuente moderna: solo normaliza registros que ya existen. Nunca inventa productos.
    for (const key of Object.keys(finishedByProductIn)){
      const src = isPlainObject(finishedByProductIn[key]) ? finishedByProductIn[key] : {};
      const productId = (src.productId != null && String(src.productId).trim())
        ? String(src.productId).trim()
        : String(key).trim();
      if (!productId) continue;
      finishedByProductId[productId] = {
        ...src,
        productId,
        stock: coerceNumber(src.stock, 0, 'arcano33_inventario.finishedByProductId.' + productId + '.stock')
      };
    }

    return {
      ...d,
      liquids,
      bottles,
      finished,
      finishedByProductId,
      caps,
      varios: Array.isArray(d.varios) ? d.varios.slice() : [],
      movimientos: movimientosIn.slice(),
      productionOperations
    };
  }

  function mergeInventarioMovimientosStorage(curList, nextList){
    const out = Array.isArray(curList) ? curList.slice() : [];
    const seen = new Set(out.map((m)=> String((m && m.id) || '')).filter(Boolean));
    (Array.isArray(nextList) ? nextList : []).forEach((m)=>{
      const id = String((m && m.id) || '').trim();
      if (!id || seen.has(id)) return;
      out.push(m);
      seen.add(id);
    });
    return out;
  }

  function mergeInventario(cur, next){
    const a = normalizeInventario(cur);
    const b = normalizeInventario(next);
    // Merge por secciones/ID (no pisar todo si no hace falta)
    const out = { ...a };
    const mergeSection = (x, y)=>{
      const xo = isPlainObject(x) ? x : {};
      const yo = isPlainObject(y) ? y : {};
      const r = { ...xo };
      for (const k of Object.keys(yo)){
        const aIt = r[k];
        const bIt = yo[k];
        if (isPlainObject(aIt) && isPlainObject(bIt)) r[k] = { ...aIt, ...bIt };
        else r[k] = bIt;
      }
      return r;
    };
    out.liquids = mergeSection(a.liquids, b.liquids);
    out.bottles = mergeSection(a.bottles, b.bottles);
    out.finished = mergeSection(a.finished, b.finished);
    out.finishedByProductId = mergeSection(a.finishedByProductId, b.finishedByProductId);
    out.caps = mergeSection(a.caps, b.caps);
    out.productionOperations = mergeSection(a.productionOperations, b.productionOperations);
    // Varios (manual): si next trae array, se respeta; si no, preservar el actual
    if (Array.isArray(b.varios)) out.varios = b.varios.slice();
    // Movimientos: append por id para no perder trazabilidad si otro módulo guardó en paralelo.
    out.movimientos = mergeInventarioMovimientosStorage(a.movimientos, b.movimientos);
    return out;
  }

  const RECETA_ING_IDS = ['vino','vodka','jugo','sirope','agua'];

  function normalizeRecetas(raw){
    const d = isPlainObject(raw) ? raw : {};
    const recetas = isPlainObject(d.recetas) ? d.recetas : (isPlainObject(raw) ? raw : {});
    const costos = isPlainObject(d.costosPresentacion) ? d.costosPresentacion : {};
    const outRecetas = {};

    // Normaliza únicamente recetas existentes. No crea Pulso/Media/Djeba/Litro/Galón.
    for (const productId of Object.keys(recetas)){
      const source = isPlainObject(recetas[productId]) ? recetas[productId] : null;
      if (!source) continue;
      const normalized = { ...source };
      for (const ingredient of Object.keys(source)){
        if (RECETA_ING_IDS.includes(ingredient)){
          normalized[ingredient] = coerceNumber(source[ingredient], 0, 'arcano33_recetas_v1.recetas.' + productId + '.' + ingredient);
        } else if (isLikelyDateKey(ingredient)){
          auditDateMaybe('arcano33_recetas_v1.recetas.' + productId + '.' + ingredient, source[ingredient]);
        }
      }
      outRecetas[productId] = normalized;
    }

    const outCostos = {};
    for (const productId of Object.keys(costos)){
      const source = isPlainObject(costos[productId]) ? costos[productId] : {};
      outCostos[productId] = {
        ...source,
        id: (source.id != null) ? String(source.id) : productId,
        nombre: (source.nombre != null) ? String(source.nombre) : productId,
        costoUnidad: coerceNumber(source.costoUnidad, 0, 'arcano33_recetas_v1.costos.' + productId + '.costoUnidad')
      };
    }

    return {
      ...d,
      version: coerceInt(d.version, 1),
      recetas: outRecetas,
      costosPresentacion: outCostos
    };
  }

  function mergeRecetas(cur, next){
    const a = normalizeRecetas(cur);
    const b = normalizeRecetas(next);
    const out = { ...a };
    out.version = Math.max(coerceInt(a.version, 1), coerceInt(b.version, 1));
    out.recetas = deepMergeKeep(a.recetas || {}, b.recetas || {});
    out.costosPresentacion = deepMergeKeep(a.costosPresentacion || {}, b.costosPresentacion || {});
    // Mantener otros campos extra del next
    for (const k of Object.keys(b)){
      if (k === 'recetas' || k === 'costosPresentacion' || k === 'version') continue;
      out[k] = b[k];
    }
    return out;
  }

  function getIdGeneric(it){
    if (!it) return '';
    const id = (it.id != null) ? String(it.id).trim() : '';
    if (id) return id;
    const code = (it.codigo != null) ? String(it.codigo).trim() : '';
    if (code) return code;
    return '';
  }

  function normalizeArrayObjects(raw, keyName){
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (let i=0;i<arr.length;i++){
      const it = arr[i];
      if (!it || typeof it !== 'object') continue;
      const obj = { ...it };
      // Auditoría rápida de fechas sospechosas
      for (const k of Object.keys(obj)){
        if (isLikelyDateKey(k)) auditDateMaybe(keyName + '[' + i + '].' + k, obj[k]);
      }
      out.push(obj);
    }
    return out;
  }

  function normalizeProducedItems(raw, path){
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (let j=0;j<arr.length;j++){
      const it = arr[j];
      if (!isPlainObject(it)) continue;
      const item = { ...it };
      const rawProductId = item.productId ?? item.productoId ?? item.id;
      const productId = (rawProductId != null) ? String(rawProductId).trim() : '';
      const nombre = (item.nombreSnapshot != null ? item.nombreSnapshot : item.nombre);
      const letra = (item.Letra != null ? item.Letra : item.letra);
      const qty = coerceInt((item.cantidad != null ? item.cantidad : item.unidades), 0, (path || 'productosProducidos') + '[' + j + '].cantidad');
      if (productId) item.productId = productId;
      if (nombre != null && String(nombre).trim()) {
        item.nombreSnapshot = String(nombre).trim();
        if (item.nombre == null || !String(item.nombre).trim()) item.nombre = item.nombreSnapshot;
      }
      if (letra != null && String(letra).trim()) {
        item.Letra = String(letra).trim().toUpperCase();
        item.letra = item.Letra;
      }
      item.cantidad = qty;
      item.unidades = qty;
      if (item.envaseId != null) item.envaseId = String(item.envaseId).trim();
      if (item.tapaId != null) item.tapaId = String(item.tapaId).trim();
      if (item.costoUnitario != null) item.costoUnitario = coerceNumber(item.costoUnitario, 0, (path || 'productosProducidos') + '[' + j + '].costoUnitario');
      if (item.costoTotal != null) item.costoTotal = coerceNumber(item.costoTotal, 0, (path || 'productosProducidos') + '[' + j + '].costoTotal');
      out.push(item);
    }
    return out;
  }

  function normalizeLotes(raw){
    const out = normalizeArrayObjects(raw, 'arcano33_lotes');
    // Sanitizar algunos campos numéricos frecuentes (sin romper data vieja)
    const fields = ['pulso','media','djeba','litro','galon','galón'];
    for (let i=0;i<out.length;i++){
      const l = out[i];
      for (const f of fields){
        if (l[f] == null) continue;
        // En lotes se usa mucho string; lo dejamos como string pero sin NaN.
        const n = coerceInt(l[f], 0, 'arcano33_lotes[' + i + '].' + f);
        l[f] = String(n);
      }
      if (l.totalVolumenFinalMl != null){
        l.totalVolumenFinalMl = coerceNumber(l.totalVolumenFinalMl, 0, 'arcano33_lotes[' + i + '].totalVolumenFinalMl');
      }
      if (Array.isArray(l.productosProducidos)){
        l.productosProducidos = normalizeProducedItems(l.productosProducidos, 'arcano33_lotes[' + i + '].productosProducidos');
      }
    }
    return out;
  }

  function normalizePedidos(raw){
    const out = normalizeArrayObjects(raw, 'arcano33_pedidos');
    // Cantidades y totales típicos
    const numKeys = ['pulsoCant','mediaCant','djebaCant','litroCant','galonCant','subtotal','descuento','total','costo','precio','monto','paid','cambio'];
    for (let i=0;i<out.length;i++){
      const p = out[i];
      for (const k of numKeys){
        if (p[k] == null) continue;
        p[k] = coerceNumber(p[k], 0, 'arcano33_pedidos[' + i + '].' + k);
      }
    }
    return out;
  }

  function normalizeCustomersCatalog(raw){
    // Legacy can be a list of strings or objects. We normalize safely, but keep it stable.
    const hash36 = (str)=>{
      let h = 2166136261;
      const s = String(str || '');
      for (let i=0;i<s.length;i++){
        h ^= s.charCodeAt(i);
        h = (h + ((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24))) >>> 0;
      }
      return h.toString(36);
    };

    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    const seen = new Set();

    for (let i=0;i<arr.length;i++){
      const it = arr[i];

      if (typeof it === 'string'){
        const name = it.replace(/\s+/g,' ').trim();
        if (!name) continue;
        const normalizedName = name.toLowerCase();
        let id = 'c_legacy_' + hash36(normalizedName);
        if (seen.has(id)) id = id + '_' + i;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          name,
          isActive: true,
          createdAt: 0,
          updatedAt: null,
          normalizedName
        });
        continue;
      }

      if (!it || typeof it !== 'object') continue;

      const obj = { ...it };
      if (obj.name != null) obj.name = String(obj.name).replace(/\s+/g,' ').trim();
      if (!obj.name) continue;

      obj.normalizedName = (obj.normalizedName != null && String(obj.normalizedName).trim())
        ? String(obj.normalizedName).trim()
        : String(obj.name || '').toLowerCase();

      let id = (obj.id != null && String(obj.id).trim()) ? String(obj.id).trim() : ('c_' + hash36(obj.normalizedName));
      if (seen.has(id)) id = id + '_' + i;
      if (seen.has(id)) continue;
      seen.add(id);
      obj.id = id;

      if (typeof obj.isActive !== 'boolean') obj.isActive = (typeof obj.active === 'boolean') ? !!obj.active : true;
      obj.createdAt = coerceInt(obj.createdAt, 0, 'a33_pos_customersCatalog[' + i + '].createdAt');
      obj.updatedAt = (obj.updatedAt == null) ? null : coerceInt(obj.updatedAt, null, 'a33_pos_customersCatalog[' + i + '].updatedAt');

      out.push(obj);
    }

    return out;
  }

  const SHARED_CONTRACTS = {
    'arcano33_inventario': {
      expected: 'object',
      mode: 'merge', // no destructivo
      normalize: normalizeInventario,
      merge: mergeInventario,
      defaultValue(){ return normalizeInventario({}); }
    },
    'arcano33_recetas_v1': {
      expected: 'object',
      mode: 'merge', // no destructivo
      normalize: normalizeRecetas,
      merge: mergeRecetas,
      defaultValue(){ return normalizeRecetas({}); }
    },
    'arcano33_lotes': {
      expected: 'array',
      mode: 'replace',
      normalize: normalizeLotes,
      merge(cur,next){ return mergeArrayById(normalizeLotes(cur), normalizeLotes(next), getIdGeneric); },
      getId: getIdGeneric,
      defaultValue(){ return []; }
    },
    'arcano33_pedidos': {
      expected: 'array',
      mode: 'replace',
      normalize: normalizePedidos,
      merge(cur,next){ return mergeArrayById(normalizePedidos(cur), normalizePedidos(next), getIdGeneric); },
      getId: getIdGeneric,
      defaultValue(){ return []; }
    },
    'a33_pos_customersCatalog': {
      expected: 'array',
      mode: 'replace',
      normalize: normalizeCustomersCatalog,
      merge(cur,next){ return mergeArrayById(normalizeCustomersCatalog(cur), normalizeCustomersCatalog(next), getIdGeneric); },
      getId: getIdGeneric,
      defaultValue(){ return []; }
    }
  };

  function isSharedKey(key){
    return !!(key && SHARED_CONTRACTS[key]);
  }

  function metaKeyFor(key){
    return String(key || '') + META_SUFFIX;
  }

  function readMeta(key, scope){
    const mk = metaKeyFor(key);
    const raw = getStore(scope).getItem(mk);
    const m = safeJsonParse(raw, mk);
    if (!m || typeof m !== 'object') return { rev: 0, updatedAt: null, writer: '' };
    const rev = coerceInt(m.rev, 0);
    const updatedAt = isString(m.updatedAt) ? m.updatedAt : null;
    const writer = isString(m.writer) ? m.writer : '';
    return { rev, updatedAt, writer };
  }

  function writeMeta(key, meta, scope){
    const mk = metaKeyFor(key);
    const out = {
      rev: coerceInt(meta && meta.rev, 0),
      updatedAt: (meta && meta.updatedAt) ? String(meta.updatedAt) : nowIso(),
      writer: (meta && meta.writer) ? String(meta.writer) : ''
    };
    try{ getStore(scope).setItem(mk, JSON.stringify(out)); return out; }
    catch(_){ return out; }
  }

  // ------------------------------
  // Core API
  // ------------------------------
  function matchPrefixes(key, prefixes){
    const list = Array.isArray(prefixes) && prefixes.length ? prefixes : DEFAULT_PREFIXES;
    return list.some(p => key.startsWith(p));
  }


  // ------------------------------
  // Contrato central de Productos
  // Fuente oficial: IndexedDB a33-pos / products
  // ------------------------------
  const PRODUCTS_DB_NAME = 'a33-pos';
  const PRODUCTS_STORE_NAME = 'products';
  const PRODUCTS_DELETED_IDS_KEY = 'a33_catalog_deleted_product_ids_v2';
  const PRODUCT_ORIGINS = new Set(['usuario', 'importacion', 'sincronizacion', 'migracion_controlada']);
  let productsDb = null;

  function productString(value){
    return String(value == null ? '' : value).trim();
  }

  function productClone(value){
    try{ return JSON.parse(JSON.stringify(value)); }
    catch(_){ return isPlainObject(value) ? { ...value } : value; }
  }

  function productIdFromRecord(record){
    const row = isPlainObject(record) ? record : {};
    return productString(row.productId ?? row.productoId ?? row.catalogProductId ?? '');
  }

  function legacyProductKey(record){
    const row = isPlainObject(record) ? record : {};
    return productString(row.id ?? row.legacyId ?? '');
  }

  function sanitizeProductIdPart(value){
    const raw = productString(value).toLowerCase();
    const safe = raw.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
    return safe || 'record';
  }

  function generateProductId(prefix){
    const head = sanitizeProductIdPart(prefix || 'prd');
    try{
      if (window.crypto && typeof window.crypto.randomUUID === 'function'){
        return head + '_' + window.crypto.randomUUID().replace(/-/g, '');
      }
    }catch(_){ }
    const random = Math.random().toString(36).slice(2, 12);
    return head + '_' + Date.now().toString(36) + '_' + random;
  }

  function legacyStableProductId(record){
    const legacyId = legacyProductKey(record);
    return legacyId ? ('prd_legacy_' + sanitizeProductIdPart(legacyId)) : '';
  }

  function ensureProductIdValue(record, options){
    const row = isPlainObject(record) ? record : {};
    const existing = productIdFromRecord(row);
    if (existing) return existing;
    const opts = isPlainObject(options) ? options : {};
    if (opts.forExisting !== false){
      const legacy = legacyStableProductId(row);
      if (legacy) return legacy;
    }
    return generateProductId('prd');
  }

  function normalizeProductOrigin(value){
    const origin = productString(value).toLowerCase();
    return PRODUCT_ORIGINS.has(origin) ? origin : '';
  }

  function normalizeProductRecord(record, options){
    const src = isPlainObject(record) ? record : {};
    const opts = isPlainObject(options) ? options : {};
    const out = productClone(src) || {};
    const productId = ensureProductIdValue(src, { forExisting: opts.forExisting !== false });
    out.productId = productId;
    if (Object.prototype.hasOwnProperty.call(out, 'productoId')) delete out.productoId;
    if (out.envaseId != null) out.envaseId = productString(out.envaseId);
    if (out.tapaId != null) out.tapaId = productString(out.tapaId);
    if (out.letra != null) out.letra = productString(out.letra).toUpperCase();
    if (out.Letra != null && out.letra == null) out.letra = productString(out.Letra).toUpperCase();
    if (out.active == null) out.active = true;
    if (opts.origin){
      const origin = normalizeProductOrigin(opts.origin);
      if (origin) out.origin = origin;
    } else if (out.origin != null){
      const existingOrigin = normalizeProductOrigin(out.origin);
      if (existingOrigin) out.origin = existingOrigin;
      else delete out.origin;
    }
    return out;
  }

  function prepareNewProduct(record, options){
    const opts = isPlainObject(options) ? options : {};
    const out = normalizeProductRecord(record, { forExisting:false, origin:opts.origin || 'usuario' });
    out.productId = generateProductId('prd');
    if (!out.createdAt) out.createdAt = nowIso();
    if (!out.updatedAt) out.updatedAt = out.createdAt;
    return out;
  }

  function prepareExistingProduct(current, patch, options){
    const base = isPlainObject(current) ? current : {};
    const changes = isPlainObject(patch) ? patch : {};
    const opts = isPlainObject(options) ? options : {};
    const currentProductId = ensureProductIdValue(base, { forExisting:true });
    const merged = { ...productClone(base), ...productClone(changes) };
    merged.productId = currentProductId;
    if (base.id != null) merged.id = base.id;
    if (base.origin != null && !opts.origin) merged.origin = base.origin;
    return normalizeProductRecord(merged, { forExisting:true, origin:opts.origin || '' });
  }

  function openProductsDb(){
    if (productsDb) return Promise.resolve(productsDb);
    return new Promise((resolve, reject) => {
      try{
        if (!window.indexedDB) throw new Error('indexeddb_unavailable');
        const req = window.indexedDB.open(PRODUCTS_DB_NAME);
        req.onupgradeneeded = (event) => {
          const d = event.target.result;
          if (!d.objectStoreNames.contains(PRODUCTS_STORE_NAME)){
            const store = d.createObjectStore(PRODUCTS_STORE_NAME, { keyPath:'id', autoIncrement:true });
            try{ store.createIndex('by_name', 'name', { unique:false }); }catch(_){ }
          }
        };
        req.onsuccess = () => {
          productsDb = req.result;
          try{ productsDb.onversionchange = () => { try{ productsDb.close(); }catch(_){ } productsDb = null; }; }catch(_){ }
          resolve(productsDb);
        };
        req.onerror = () => reject(req.error || new Error('products_db_open_failed'));
        req.onblocked = () => reject(new Error('products_db_blocked'));
      }catch(error){ reject(error); }
    });
  }

  async function getAllProductsRaw(){
    const d = await openProductsDb();
    if (!d.objectStoreNames.contains(PRODUCTS_STORE_NAME)) return [];
    return new Promise((resolve, reject) => {
      const tx = d.transaction(PRODUCTS_STORE_NAME, 'readonly');
      const req = tx.objectStore(PRODUCTS_STORE_NAME).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error || tx.error);
      tx.onerror = () => reject(tx.error || req.error);
    });
  }

  async function putProductRaw(record){
    const d = await openProductsDb();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(PRODUCTS_STORE_NAME, 'readwrite');
      const req = tx.objectStore(PRODUCTS_STORE_NAME).put(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || tx.error);
      tx.onerror = () => reject(tx.error || req.error);
    });
  }

  async function ensureProductIdentities(){
    const rows = await getAllProductsRaw();
    const used = new Set();
    let updated = 0;
    const normalized = [];
    for (const row of rows){
      if (!isPlainObject(row)) continue;
      let productId = productIdFromRecord(row) || legacyStableProductId(row) || generateProductId('prd_migrated');
      if (used.has(productId)) productId = generateProductId('prd_rekey');
      used.add(productId);
      const next = normalizeProductRecord(row, { forExisting:true });
      next.productId = productId;
      const changed = productIdFromRecord(row) !== productId
        || productString(row.envaseId) !== productString(next.envaseId)
        || productString(row.tapaId) !== productString(next.tapaId);
      if (changed){
        next.identityUpdatedAt = nowIso();
        await putProductRaw(next);
        updated += 1;
      }
      normalized.push(next);
    }
    return { products: normalized, updated };
  }

  async function getAllProducts(){
    const result = await ensureProductIdentities();
    const deletedIds = new Set(readDeletedProductMarkers().map((row) => productString(row.productId)).filter(Boolean));
    return result.products.filter((row) => !deletedIds.has(productIdFromRecord(row))).map(productClone);
  }

  function isProductActive(product){
    return !!product && product.active !== false && product.deleted !== true;
  }

  function hasProductRecipe(product){
    const row = isPlainObject(product) ? product : {};
    if (Object.prototype.hasOwnProperty.call(row, 'receta')) return row.receta === true || row.receta === 1 || String(row.receta).toLowerCase() === 'true';
    if (Object.prototype.hasOwnProperty.call(row, 'hasRecipe')) return row.hasRecipe === true || row.hasRecipe === 1 || String(row.hasRecipe).toLowerCase() === 'true';
    if (Object.prototype.hasOwnProperty.call(row, 'recipe')) return row.recipe === true || isPlainObject(row.recipe);
    return false;
  }

  function isProductForPos(product){
    const row = isPlainObject(product) ? product : {};
    const keys = ['pos', 'POS', 'posEnabled', 'showInPOS', 'visiblePOS', 'vendible', 'sellable', 'saleEnabled'];
    for (const key of keys){
      if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
      const value = row[key];
      return value === true || value === 1 || String(value).toLowerCase() === 'true';
    }
    return false;
  }

  async function getProductByProductId(productId){
    const target = productString(productId);
    if (!target) return null;
    const rows = await getAllProducts();
    return rows.find((row) => productIdFromRecord(row) === target) || null;
  }

  async function productIdExists(productId){
    return !!(await getProductByProductId(productId));
  }

  function historicalSnapshot(source, product){
    const src = isPlainObject(source) ? source : {};
    const real = isPlainObject(product) ? product : {};
    const pid = productIdFromRecord(real) || productIdFromRecord(src);
    const name = productString(src.nombreSnapshot ?? src.productNameSnapshot ?? src.nameSnapshot ?? src.nombre ?? src.productName ?? src.name ?? real.name ?? real.nombre);
    const letter = productString(src.letraSnapshot ?? src.LetraSnapshot ?? src.letra ?? src.Letra ?? real.letra ?? real.Letra).toUpperCase();
    const volumeRaw = src.volumenSnapshot ?? src.volumeSnapshot ?? src.capacitySnapshot ?? src.capacityMl ?? src.capacidadMl ?? real.capacityMl ?? real.capacidadMl ?? null;
    const priceRaw = src.precioSnapshot ?? src.priceSnapshot ?? src.price ?? real.price ?? null;
    const volume = Number(volumeRaw);
    const price = Number(priceRaw);
    return {
      productId: pid || '',
      nombreSnapshot: name,
      letraSnapshot: letter,
      volumenSnapshot: Number.isFinite(volume) ? volume : null,
      precioSnapshot: Number.isFinite(price) ? price : null,
      historicalOnly: true,
      legacyReference: !pid
    };
  }

  function isHistoricalProductSnapshot(value){
    return isPlainObject(value) && value.historicalOnly === true;
  }

  function isRealProductReference(value){
    return isPlainObject(value) && !!productIdFromRecord(value) && value.historicalOnly !== true && value.legacyReference !== true;
  }

  function isLegacyProductReference(value){
    const row = isPlainObject(value) ? value : {};
    return !productIdFromRecord(row) && !!productString(row.name ?? row.nombre ?? row.productName ?? row.Letra ?? row.letra ?? row.capacityMl ?? row.capacidadMl);
  }

  function readDeletedProductMarkers(){
    try{
      if (window.A33ProductIntegrity && typeof window.A33ProductIntegrity.readTombstones === 'function'){
        return window.A33ProductIntegrity.readTombstones();
      }
    }catch(_){ }
    try{
      const raw = window.localStorage.getItem(PRODUCTS_DELETED_IDS_KEY);
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed.filter((row) => isPlainObject(row) && productString(row.productId)) : [];
    }catch(_){ return []; }
  }

  function rememberDeletedProduct(record){
    const productId = productIdFromRecord(record);
    if (!productId) return false;
    try{
      if (window.A33ProductIntegrity && typeof window.A33ProductIntegrity.rememberDeleted === 'function'){
        return window.A33ProductIntegrity.rememberDeleted(record, { origin:'catalogos_productos' });
      }
    }catch(_){ }
    const list = readDeletedProductMarkers();
    const previous = list.find((row) => productString(row.productId) === productId);
    const filtered = list.filter((row) => productString(row.productId) !== productId);
    filtered.push({
      productId,
      legacyId: legacyProductKey(record),
      nombreSnapshot: productString(record && (record.name ?? record.nombre)),
      deletedAt: nowIso(),
      origin:'catalogos_productos',
      rev: Math.max(1, Number(previous && previous.rev || 0) + 1)
    });
    try{
      window.localStorage.setItem(PRODUCTS_DELETED_IDS_KEY, JSON.stringify(filtered));
      return true;
    }catch(_){ return false; }
  }

  function isDeletedProductId(productId){
    const target = productString(productId);
    return !!target && readDeletedProductMarkers().some((row) => productString(row.productId) === target);
  }

  const A33Products = {
    dbName: PRODUCTS_DB_NAME,
    storeName: PRODUCTS_STORE_NAME,
    deletedIdsKey: PRODUCTS_DELETED_IDS_KEY,
    getProductId: productIdFromRecord,
    generateProductId,
    normalizeRecord: normalizeProductRecord,
    prepareNew: prepareNewProduct,
    prepareExisting: prepareExistingProduct,
    ensureIdentities: ensureProductIdentities,
    getAll: getAllProducts,
    async getActive(){ return (await getAllProducts()).filter(isProductActive); },
    async getActiveWithRecipe(){ return (await getAllProducts()).filter((row) => isProductActive(row) && hasProductRecipe(row)); },
    async getActiveForPOS(){ return (await getAllProducts()).filter((row) => isProductActive(row) && isProductForPos(row)); },
    getByProductId: getProductByProductId,
    exists: productIdExists,
    isRealProduct: isRealProductReference,
    isHistoricalSnapshot: isHistoricalProductSnapshot,
    isLegacyReference: isLegacyProductReference,
    historicalSnapshot,
    rememberDeleted: rememberDeletedProduct,
    isDeletedProductId,
    readDeletedMarkers: readDeletedProductMarkers
  };

  const A33Storage = {
    prefixes: DEFAULT_PREFIXES.slice(),

    // Internal shared state (por pestaña)
    _sharedState: {},

    // API estilo Storage (string)
    getItem(key, scope='local'){
      try{ return getStore(scope).getItem(key); }catch(_){ return null; }
    },
    setItem(key, value, scope='local'){
      try{ getStore(scope).setItem(key, String(value ?? '')); return true; }catch(_){ return false; }
    },
    removeItem(key, scope='local'){
      try{ getStore(scope).removeItem(key); return true; }catch(_){ return false; }
    },

    // Helpers raw
    getRaw(key, fallback=null, scope='local'){
      const v = this.getItem(key, scope);
      return (v == null) ? fallback : v;
    },
    setRaw(key, value, scope='local'){
      return this.setItem(key, value, scope);
    },

    // Helpers JSON (safe)
    getJSON(key, fallback=null, scope='local'){
      const raw = this.getItem(key, scope);
      if (raw == null) return fallback;
      const obj = safeJsonParse(raw, key);
      return (obj == null) ? fallback : obj;
    },
    setJSON(key, obj, scope='local'){
      try{ return this.setItem(key, JSON.stringify(obj ?? null), scope); }catch(_){ return false; }
    },

    // Update JSON sin “dedazos” (lee, aplica función, escribe)
    updateJSON(key, updater, { scope='local', defaultValue=null } = {}){
      const cur = this.getJSON(key, defaultValue, scope);
      const next = updater(cur);
      this.setJSON(key, next, scope);
      return next;
    },

    // keys('local'|'session') o keys({ scope: 'local'|'session' })
    keys(scopeOrOpts='local'){
      let scope = 'local';
      if (scopeOrOpts && typeof scopeOrOpts === 'object'){
        scope = scopeOrOpts.scope === 'session' ? 'session' : 'local';
      } else {
        scope = scopeOrOpts === 'session' ? 'session' : 'local';
      }
      const store = getStore(scope);
      const out = [];
      try{
        for (let i = 0; i < store.length; i++){
          const k = store.key(i);
          if (k != null) out.push(k);
        }
      }catch(_){ }
      return out;
    },

    // Solo borra claves A33 (por prefijos)
    clearA33({ scope='local', prefixes } = {}){
      const store = getStore(scope);
      const ks = this.keys(scope).filter(k => matchPrefixes(k, prefixes));
      ks.forEach(k => { try{ store.removeItem(k); }catch(_){ } });
      return ks.length;
    },

    // Snapshot para export (solo claves A33 por prefijos)
    snapshotA33({ scope='local', prefixes } = {}){
      const store = getStore(scope);
      const out = {};
      this.keys(scope).forEach(k => {
        if (!matchPrefixes(k, prefixes)) return;
        if (isRetiredGateStorageKey(k)) return;
        try{ out[k] = store.getItem(k); }catch(_){ }
      });
      return out;
    },

    isRetiredGateKey(key){
      return isRetiredGateStorageKey(key);
    },

    isRetiredGateDbName(name){
      return retiredGateDbName(name);
    },

    isRetiredGateStoreName(name){
      return retiredGateStoreName(name);
    },

    filterOutRetiredGateEntries(mapLike){
      return filterOutRetiredGateEntriesImpl(mapLike);
    },

    cleanupRetiredGateResidue(){
      return cleanupRetiredGateResidueImpl();
    },

    // ------------------------------
    // Contrato de persistencia compartida
    // ------------------------------
    sharedRead(key, fallback=null, scope='local'){
      const contract = SHARED_CONTRACTS[key];
      if (!contract){
        const data = this.getJSON(key, fallback, scope);
        return { data, meta: { rev: 0, updatedAt: null, writer: '' } };
      }

      const meta = readMeta(key, scope);
      const raw = this.getItem(key, scope);
      const parsed = safeJsonParse(raw, key);
      let data = parsed;

      if (data == null){
        data = (typeof contract.defaultValue === 'function') ? contract.defaultValue() : (fallback ?? null);
      }

      if (!validateExpected(data, contract.expected)){
        logOnce('type:' + key, 'Tipo inesperado en', key, '->', contract.expected, 'Se usará fallback/default.');
        data = (typeof contract.defaultValue === 'function') ? contract.defaultValue() : (fallback ?? null);
      }

      if (typeof contract.normalize === 'function'){
        try{ data = contract.normalize(data); }
        catch(err){
          logOnce('norm:' + key, 'Error normalizando', key, err);
        }
      }

      // Guardar rev “de lectura” para anti-pisadas en esta pestaña
      try{ this._sharedState[key] = { rev: meta.rev, updatedAt: meta.updatedAt, writer: meta.writer, readAt: Date.now() }; }
      catch(_){ }

      return { data, meta };
    },

    sharedGet(key, fallback=null, scope='local'){
      return this.sharedRead(key, fallback, scope).data;
    },

    sharedGetMeta(key, scope='local'){
      if (this._sharedState && this._sharedState[key]) return this._sharedState[key];
      try{ return readMeta(key, scope); }catch(_){ return { rev:0, updatedAt:null, writer:'' }; }
    },

    sharedReplaceExact(key, next, { scope='local', source='', baseRev=null } = {}){
      const contract = SHARED_CONTRACTS[key];
      const curMeta = readMeta(key, scope);
      const expectedBase = (typeof baseRev === 'number') ? baseRev : curMeta.rev;
      if (typeof expectedBase === 'number' && expectedBase !== curMeta.rev){
        const current = contract ? this.sharedRead(key, null, scope).data : this.getJSON(key, null, scope);
        return { ok:false, data:current, meta:curMeta, conflict:true, message:'Conflicto detectado: los datos cambiaron antes de completar la operación.' };
      }

      let normalized = next;
      if (contract){
        if (!validateExpected(normalized, contract.expected)){
          const current = this.sharedRead(key, null, scope).data;
          return { ok:false, data:current, meta:curMeta, conflict:false, message:'Formato inválido para guardar.' };
        }
        if (typeof contract.normalize === 'function'){
          try{ normalized = contract.normalize(normalized); }
          catch(err){
            logOnce('replace-norm:' + key, 'Error normalizando reemplazo exacto en', key, err);
            const current = this.sharedRead(key, null, scope).data;
            return { ok:false, data:current, meta:curMeta, conflict:false, message:'No se pudo normalizar la información para guardarla.' };
          }
        }
      }

      const metaNow = readMeta(key, scope);
      if (metaNow.rev !== curMeta.rev){
        const current = contract ? this.sharedRead(key, null, scope).data : this.getJSON(key, null, scope);
        return { ok:false, data:current, meta:metaNow, conflict:true, message:'Conflicto detectado: los datos cambiaron durante la operación.' };
      }

      let ok = false;
      try{ ok = this.setItem(key, JSON.stringify(normalized ?? null), scope); }
      catch(_){ ok = false; }
      if (!ok){
        const current = contract ? this.sharedRead(key, null, scope).data : this.getJSON(key, null, scope);
        return { ok:false, data:current, meta:metaNow, conflict:false, message:'No se pudo guardar (storage error).' };
      }

      const nextRev = coerceInt(metaNow.rev, 0) + 1;
      const metaWritten = writeMeta(key, { rev:nextRev, updatedAt:nowIso(), writer:source || '' }, scope);
      try{ this._sharedState[key] = { rev:metaWritten.rev, updatedAt:metaWritten.updatedAt, writer:metaWritten.writer, readAt:Date.now() }; }
      catch(_){ }
      return { ok:true, data:normalized, meta:metaWritten, conflict:false, message:'' };
    },

    sharedSet(key, next, { scope='local', source='', baseRev=null, conflictPolicy='merge' } = {}){
      const contract = SHARED_CONTRACTS[key];
      if (!contract){
        const ok = this.setJSON(key, next, scope);
        return { ok, data: next, meta: null, conflict: false, message: ok ? '' : 'No se pudo guardar.' };
      }

      const state = (this._sharedState && this._sharedState[key]) ? this._sharedState[key] : null;
      const curMeta = readMeta(key, scope);
      const expectedBase = (typeof baseRev === 'number') ? baseRev : (state && typeof state.rev === 'number' ? state.rev : curMeta.rev);
      const conflict = (typeof expectedBase === 'number' && expectedBase !== curMeta.rev);

      // Leer actual (normalizado)
      const cur = this.sharedRead(key, null, scope).data;

      // Normalizar next
      let nextNorm = next;
      if (!validateExpected(nextNorm, contract.expected)){
        logOnce('write-type:' + key, 'Intento de guardar tipo inválido en', key, '->', contract.expected);
        return { ok:false, data: cur, meta: curMeta, conflict:false, message:'Formato inválido para guardar.' };
      }
      if (typeof contract.normalize === 'function'){
        try{ nextNorm = contract.normalize(nextNorm); }
        catch(err){
          logOnce('write-norm:' + key, 'Error normalizando para guardar', key, err);
        }
      }

      // Releer meta justo antes de escribir (anti race)
      const metaNow = readMeta(key, scope);
      let hardConflict = conflict || (metaNow.rev !== curMeta.rev);

      if (hardConflict && conflictPolicy === 'block'){
        return { ok:false, data: cur, meta: metaNow, conflict: true, message: 'Conflicto detectado: datos cambiaron en otra pestaña/módulo. Recargá y reintentá.' };
      }

      // Decidir merge/bloqueo
      let finalData = nextNorm;
      let usedMerge = false;

      if (contract.mode === 'merge'){
        // Siempre merge para no pisar campos de otros módulos
        try{
          finalData = (typeof contract.merge === 'function') ? contract.merge(cur, nextNorm) : deepMergeKeep(cur, nextNorm);
          usedMerge = true;
        }catch(err){
          logOnce('merge-fail:' + key, 'Merge falló en', key, err);
          finalData = nextNorm;
        }
      } else {
        // replace: solo merge si hay conflicto y no detectamos eliminación
        if (hardConflict){
          const getId = (typeof contract.getId === 'function') ? contract.getId : getIdGeneric;
          const hasDeletion = detectDeletionById(cur, nextNorm, getId);
          if (hasDeletion){
            logOnce('rev-conflict-del:' + key, 'Conflicto rev + eliminación detectada en', key);
            return {
              ok:false,
              data: cur,
              meta: metaNow,
              conflict:true,
              message:'Conflicto: la data cambió en otra pestaña/módulo. Recarga la página y vuelve a intentar (para evitar corrupción).'
            };
          }
          try{
            finalData = (typeof contract.merge === 'function') ? contract.merge(cur, nextNorm) : mergeArrayById(cur, nextNorm, getId);
            usedMerge = true;
          }catch(err){
            logOnce('merge-fail2:' + key, 'Merge falló (conflicto) en', key, err);
            return {
              ok:false,
              data: cur,
              meta: metaNow,
              conflict:true,
              message:'Conflicto al guardar: no se pudo fusionar de forma segura. Recarga y vuelve a intentar.'
            };
          }
          logOnce('rev-conflict:' + key, 'Conflicto rev detectado en', key, 'Se aplicó merge conservador.');
        }
      }

      // Validación final
      if (!validateExpected(finalData, contract.expected)){
        return { ok:false, data: cur, meta: metaNow, conflict: hardConflict, message:'No se pudo guardar (tipo inválido post-merge).' };
      }

      // Escribir
      let ok = false;
      try{
        ok = this.setItem(key, JSON.stringify(finalData ?? null), scope);
      }catch(err){
        ok = false;
      }

      if (!ok){
        return { ok:false, data: cur, meta: metaNow, conflict: hardConflict, message:'No se pudo guardar (storage error).' };
      }

      const nextRev = coerceInt(metaNow.rev, 0) + 1;
      const metaWritten = writeMeta(key, { rev: nextRev, updatedAt: nowIso(), writer: source || '' }, scope);

      // Actualizar estado local
      try{ this._sharedState[key] = { rev: metaWritten.rev, updatedAt: metaWritten.updatedAt, writer: metaWritten.writer, readAt: Date.now() }; }
      catch(_){ }

      if (hardConflict && usedMerge){
        // eslint-disable-next-line no-console
        console.info(LOG_PREFIX, 'Guardado con merge por conflicto:', key);
      }

      return { ok:true, data: finalData, meta: metaWritten, conflict: hardConflict, message:'' };
    }
  };

  try{
    if (!window.__A33_LEGACY_ACCESS_PURGE_PROMISE){
      window.__A33_LEGACY_ACCESS_PURGE_PROMISE = Promise.resolve()
        .then(() => cleanupRetiredGateResidueImpl())
        .catch(() => ({ local:[], session:[], indexedDB:[], caches:[], serviceWorkers:[] }));
    }
  }catch(_){ }

  // Global
  window.A33Storage = A33Storage;
  window.A33Products = A33Products;
})();
