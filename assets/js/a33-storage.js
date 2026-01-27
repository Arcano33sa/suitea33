/*
  Suite A33 — A33Storage (core)
  Servicio único para acceso a Storage (local/session).

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
  const INV_LIQUID_IDS = ['vino','vodka','jugo','sirope','agua'];
  const INV_BOTTLE_IDS = ['pulso','media','djeba','litro','galon'];
  const INV_FINISHED_IDS = ['pulso','media','djeba','litro','galon'];
  const INV_CAPS_IDS = ['gallon','pulsoLitro','djebaMedia'];

  function stableItemId(prefix, key, src){
    try{
      const s = src && (src.itemId || src.sku || src.id);
      const v = (s != null) ? String(s).trim() : '';
      if (v) return v;
    }catch(_){ }
    const k = (key != null) ? String(key).trim() : '';
    return String(prefix || '') + k;
  }

  function normalizeInventario(raw){
    const d = isPlainObject(raw) ? raw : {};
    const liquidsIn = isPlainObject(d.liquids) ? d.liquids : {};
    const bottlesIn = isPlainObject(d.bottles) ? d.bottles : {};
    const finishedIn = isPlainObject(d.finished) ? d.finished : {};
    const capsIn = isPlainObject(d.caps) ? d.caps : {};

    const liquids = {};
    const bottles = {};
    const finished = {};
    const caps = {};

    // Known IDs (defaults)
    for (const id of INV_LIQUID_IDS){
      const src = isPlainObject(liquidsIn[id]) ? liquidsIn[id] : {};
      liquids[id] = {
        ...src,
        itemId: stableItemId('liq:', id, src),
        sku: (src.sku != null && String(src.sku).trim()) ? String(src.sku).trim() : stableItemId('liq:', id, src),
        stock: coerceNumber(src.stock, 0, 'arcano33_inventario.liquids.' + id + '.stock'),
        max:   coerceNumber(src.max,   0, 'arcano33_inventario.liquids.' + id + '.max'),
      };
    }
    for (const id of INV_BOTTLE_IDS){
      const src = isPlainObject(bottlesIn[id]) ? bottlesIn[id] : {};
      bottles[id] = {
        ...src,
        itemId: stableItemId('bot:', id, src),
        sku: (src.sku != null && String(src.sku).trim()) ? String(src.sku).trim() : stableItemId('bot:', id, src),
        stock: coerceNumber(src.stock, 0, 'arcano33_inventario.bottles.' + id + '.stock'),
      };
    }
    for (const id of INV_FINISHED_IDS){
      const src = isPlainObject(finishedIn[id]) ? finishedIn[id] : {};
      finished[id] = {
        ...src,
        itemId: stableItemId('fin:', id, src),
        sku: (src.sku != null && String(src.sku).trim()) ? String(src.sku).trim() : stableItemId('fin:', id, src),
        stock: coerceNumber(src.stock, 0, 'arcano33_inventario.finished.' + id + '.stock'),
      };
    }
    // Tapas (Auto): entero (stock puede ir negativo), min >= 0
    for (const id of INV_CAPS_IDS){
      const src = isPlainObject(capsIn[id]) ? capsIn[id] : {};
      caps[id] = {
        ...src,
        stock: coerceInt(src.stock, 0, 'arcano33_inventario.caps.' + id + '.stock'),
        min: Math.max(0, coerceInt(src.min, 0, 'arcano33_inventario.caps.' + id + '.min')),
      };
    }

    // Unknown IDs (tolerancia)
    for (const k of Object.keys(liquidsIn)){
      if (liquids[k]) continue;
      const src = isPlainObject(liquidsIn[k]) ? liquidsIn[k] : {};
      liquids[k] = {
        ...src,
        itemId: stableItemId('liq:', k, src),
        sku: (src.sku != null && String(src.sku).trim()) ? String(src.sku).trim() : stableItemId('liq:', k, src),
        stock: coerceNumber(src.stock, 0, 'arcano33_inventario.liquids.' + k + '.stock'),
        max:   coerceNumber(src.max,   0, 'arcano33_inventario.liquids.' + k + '.max'),
      };
    }
    for (const k of Object.keys(bottlesIn)){
      if (bottles[k]) continue;
      const src = isPlainObject(bottlesIn[k]) ? bottlesIn[k] : {};
      bottles[k] = {
        ...src,
        itemId: stableItemId('bot:', k, src),
        sku: (src.sku != null && String(src.sku).trim()) ? String(src.sku).trim() : stableItemId('bot:', k, src),
        stock: coerceNumber(src.stock, 0, 'arcano33_inventario.bottles.' + k + '.stock'),
      };
    }
    for (const k of Object.keys(finishedIn)){
      if (finished[k]) continue;
      const src = isPlainObject(finishedIn[k]) ? finishedIn[k] : {};
      finished[k] = {
        ...src,
        itemId: stableItemId('fin:', k, src),
        sku: (src.sku != null && String(src.sku).trim()) ? String(src.sku).trim() : stableItemId('fin:', k, src),
        stock: coerceNumber(src.stock, 0, 'arcano33_inventario.finished.' + k + '.stock'),
      };
    }
    for (const k of Object.keys(capsIn)){
      if (caps[k]) continue;
      const src = isPlainObject(capsIn[k]) ? capsIn[k] : {};
      caps[k] = {
        ...src,
        stock: coerceInt(src.stock, 0, 'arcano33_inventario.caps.' + k + '.stock'),
        min: Math.max(0, coerceInt(src.min, 0, 'arcano33_inventario.caps.' + k + '.min')),
      };
    }

    return { ...d, liquids, bottles, finished, caps };
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
    out.caps = mergeSection(a.caps, b.caps);
    // Varios (manual): si next trae array, se respeta; si no, preservar el actual
    if (Array.isArray(b.varios)) out.varios = b.varios.slice();
    return out;
  }

  const RECETA_PRESENT_IDS = ['pulso','media','djeba','litro','galon'];
  const RECETA_ING_IDS = ['vino','vodka','jugo','sirope','agua'];

  function normalizeRecetas(raw){
    const d = isPlainObject(raw) ? raw : {};
    const recetas = isPlainObject(d.recetas) ? d.recetas : (isPlainObject(raw) ? raw : {});
    const costos = isPlainObject(d.costosPresentacion) ? d.costosPresentacion : null;

    const outRecetas = {};
    for (const pid of RECETA_PRESENT_IDS){
      const r0 = isPlainObject(recetas[pid]) ? recetas[pid] : {};
      const r = {};
      for (const ing of RECETA_ING_IDS){
        r[ing] = coerceNumber(r0[ing], 0, 'arcano33_recetas_v1.recetas.' + pid + '.' + ing);
      }
      outRecetas[pid] = { ...r0, ...r };
    }

    // Tolerancia: mantener recetas adicionales desconocidas
    for (const k of Object.keys(recetas)){
      if (outRecetas[k]) continue;
      const r0 = isPlainObject(recetas[k]) ? recetas[k] : null;
      if (!r0) continue;
      const r = { ...r0 };
      for (const ing of Object.keys(r0)){
        if (isLikelyDateKey(ing)) auditDateMaybe('arcano33_recetas_v1.recetas.' + k + '.' + ing, r0[ing]);
      }
      outRecetas[k] = r;
    }

    const outCostos = {};
    if (costos && isPlainObject(costos)){
      for (const pid of Object.keys(costos)){
        const c0 = isPlainObject(costos[pid]) ? costos[pid] : {};
        outCostos[pid] = {
          ...c0,
          id: (c0.id != null) ? String(c0.id) : pid,
          nombre: (c0.nombre != null) ? String(c0.nombre) : pid,
          costoUnidad: coerceNumber(c0.costoUnidad, 0, 'arcano33_recetas_v1.costos.' + pid + '.costoUnidad')
        };
      }
    } else {
      // Defaults mínimos (sin forzar escritura)
      for (const pid of RECETA_PRESENT_IDS){
        outCostos[pid] = { id: pid, nombre: pid, costoUnidad: 0 };
      }
    }

    const out = { ...d };
    out.version = coerceInt(d.version, 1);
    out.recetas = outRecetas;
    out.costosPresentacion = outCostos;
    return out;
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
        try{ out[k] = store.getItem(k); }catch(_){ }
      });
      return out;
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

  // Global
  window.A33Storage = A33Storage;
})();
