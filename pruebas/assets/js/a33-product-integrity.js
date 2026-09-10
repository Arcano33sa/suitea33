/* Suite A33 — Integridad de Productos (Etapa 7/8)
   Tombstones por productId, auditoría segura y utilidades de importación/sincronización.
*/
(function(g){
  'use strict';

  const DB_NAME = 'a33-pos';
  const STORE_NAME = 'products';
  const TOMBSTONE_KEY = 'a33_catalog_deleted_product_ids_v2';
  const AUDIT_LOG_KEY = 'a33_product_integrity_log_v1';
  const QUARANTINE_KEY = 'a33_product_quarantine_v1';
  const PRODUCT_ID_FIELDS = new Set([
    'productId','productoId','catalogProductId','skuProductId','idProducto',
    'sourceProductId','targetProductId','productoOrigenId','productoDestinoId'
  ]);
  const PRODUCT_KEYED_MAPS = new Set(['recetas','costos','consumablesByProduct','consumiblesPorProducto','finishedByProductId']);

  function clone(value){
    try{ return JSON.parse(JSON.stringify(value)); }
    catch(_){ return value && typeof value === 'object' ? { ...value } : value; }
  }
  function str(value){ return String(value == null ? '' : value).trim(); }
  function nowIso(){ try{ return new Date().toISOString(); }catch(_){ return ''; } }
  function parseTime(value){ const t = Date.parse(str(value)); return Number.isFinite(t) ? t : 0; }
  function norm(value){
    let out = str(value).toLowerCase();
    try{ out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }catch(_){ }
    return out.replace(/\s+/g, ' ');
  }
  function getProductId(record){
    const row = record && typeof record === 'object' ? record : {};
    return str(row.productId ?? row.productoId ?? row.catalogProductId ?? '');
  }
  function generateProductId(){
    try{
      if (g.crypto && typeof g.crypto.randomUUID === 'function') return 'prd_' + g.crypto.randomUUID().replace(/-/g, '');
    }catch(_){ }
    return 'prd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,12);
  }
  function readRaw(key){
    try{
      if (g.A33Storage && typeof g.A33Storage.getItem === 'function'){
        const value = g.A33Storage.getItem(key, 'local');
        if (value != null) return value;
      }
    }catch(_){ }
    try{ return g.localStorage ? g.localStorage.getItem(key) : null; }catch(_){ return null; }
  }
  function writeRaw(key, value){
    try{
      if (g.A33Storage && typeof g.A33Storage.setItem === 'function'){
        const ok = g.A33Storage.setItem(key, String(value == null ? '' : value), 'local');
        if (ok !== false) return true;
      }
    }catch(_){ }
    try{ g.localStorage.setItem(key, String(value == null ? '' : value)); return true; }catch(_){ return false; }
  }
  function readJson(key, fallback){
    try{ const raw = readRaw(key); return raw ? JSON.parse(raw) : fallback; }
    catch(_){ return fallback; }
  }
  function writeJson(key, value){ return writeRaw(key, JSON.stringify(value)); }

  function normalizeTombstone(value){
    const row = value && typeof value === 'object' ? value : {};
    const productId = getProductId(row) || str(row.productId);
    if (!productId) return null;
    const deletedAt = str(row.deletedAt || row.updatedAt || row.syncedAt) || nowIso();
    const rev = Number(row.rev ?? row.revision ?? 0);
    return {
      productId,
      legacyId: str(row.legacyId || row.id),
      nombreSnapshot: str(row.nombreSnapshot || row.nameSnapshot || row.name || row.nombre),
      deletedAt,
      origin: str(row.origin || row.origen || 'eliminacion_controlada'),
      rev: Number.isFinite(rev) ? rev : 0,
      syncedAt: str(row.syncedAt || ''),
      deviceId: str(row.deviceId || '')
    };
  }
  function tombstoneIsNewer(a, b){
    const ar = Number(a && a.rev || 0), br = Number(b && b.rev || 0);
    if (ar !== br) return ar > br;
    return parseTime(a && a.deletedAt) >= parseTime(b && b.deletedAt);
  }
  function mergeTombstones(current, incoming){
    const map = new Map();
    [].concat(Array.isArray(current) ? current : [], Array.isArray(incoming) ? incoming : []).forEach((item) => {
      const normalized = normalizeTombstone(item);
      if (!normalized) return;
      const existing = map.get(normalized.productId);
      if (!existing || tombstoneIsNewer(normalized, existing)) map.set(normalized.productId, normalized);
    });
    return Array.from(map.values()).sort((a,b) => parseTime(b.deletedAt) - parseTime(a.deletedAt));
  }
  function readTombstones(){ return mergeTombstones([], readJson(TOMBSTONE_KEY, [])); }
  function writeTombstones(list){ return writeJson(TOMBSTONE_KEY, mergeTombstones([], list)); }
  function rememberDeleted(record, meta){
    const row = record && typeof record === 'object' ? record : {};
    const extra = meta && typeof meta === 'object' ? meta : {};
    const productId = getProductId(row) || str(extra.productId);
    if (!productId) return false;
    const previous = readTombstones().find((item) => item.productId === productId);
    const tombstone = normalizeTombstone({
      productId,
      legacyId: row.id ?? extra.legacyId,
      nombreSnapshot: row.name ?? row.nombre ?? extra.nombreSnapshot,
      deletedAt: extra.deletedAt || nowIso(),
      origin: extra.origin || extra.origen || 'eliminacion_controlada',
      rev: Math.max(Number(previous && previous.rev || 0) + 1, Number(extra.rev || 0)),
      syncedAt: extra.syncedAt || '',
      deviceId: extra.deviceId || ''
    });
    return writeTombstones(mergeTombstones(readTombstones(), [tombstone]));
  }
  function isTombstoned(productId){
    const target = str(productId);
    return !!target && readTombstones().some((row) => row.productId === target);
  }

  function clearlyDistinct(a, b){
    const left = a && typeof a === 'object' ? a : {};
    const right = b && typeof b === 'object' ? b : {};
    const nameA = norm(left.name ?? left.nombre), nameB = norm(right.name ?? right.nombre);
    const capA = Number(left.capacityMl ?? left.capacidadMl ?? left.volumeMl ?? left.volumenMl);
    const capB = Number(right.capacityMl ?? right.capacidadMl ?? right.volumeMl ?? right.volumenMl);
    const letterA = norm(left.letra ?? left.Letra), letterB = norm(right.letra ?? right.Letra);
    const nameDifferent = !!nameA && !!nameB && nameA !== nameB;
    const capacityDifferent = Number.isFinite(capA) && Number.isFinite(capB) && Math.abs(capA - capB) > 1;
    const letterDifferent = !!letterA && !!letterB && letterA !== letterB;
    return nameDifferent && (capacityDifferent || letterDifferent);
  }

  function mergeSameProduct(current, incoming){
    const a = current && typeof current === 'object' ? current : {};
    const b = incoming && typeof incoming === 'object' ? incoming : {};
    const at = parseTime(a.updatedAt || a.modifiedAt || a.createdAt);
    const bt = parseTime(b.updatedAt || b.modifiedAt || b.createdAt);
    const newer = bt >= at ? b : a;
    const older = newer === b ? a : b;
    return { ...clone(older), ...clone(newer), productId:getProductId(a) || getProductId(b) };
  }

  function normalizeIncomingProducts(records, existingRecords){
    const existing = Array.isArray(existingRecords) ? existingRecords : [];
    const existingById = new Map(existing.map((row) => [getProductId(row), row]).filter(([id]) => !!id));
    const incomingById = new Map();
    const prepared = [];
    const idMap = {};
    const conflicts = [];
    const blocked = [];
    const assigned = [];

    (Array.isArray(records) ? records : []).forEach((raw, index) => {
      if (!raw || typeof raw !== 'object') return;
      const row = clone(raw) || {};
      const oldProductId = getProductId(row);
      const legacyToken = oldProductId || str(row.id ?? row.legacyId ?? '');
      let productId = oldProductId;
      if (!productId){
        productId = generateProductId();
        if (legacyToken) idMap[legacyToken] = productId;
        assigned.push({ index, legacyToken, productId });
      }
      row.productId = productId;
      if (Object.prototype.hasOwnProperty.call(row, 'productoId')) delete row.productoId;
      if (!row.origin) row.origin = 'importacion';
      row.importedAt = row.importedAt || nowIso();
      row.importOrigin = row.importOrigin || 'json';

      if (isTombstoned(productId)){
        blocked.push({ index, productId, name:str(row.name || row.nombre) });
        return;
      }
      const previousIncoming = incomingById.get(productId);
      if (previousIncoming){
        if (clearlyDistinct(previousIncoming, row)){
          conflicts.push({ productId, current:previousIncoming, incoming:row, source:'json_interno' });
          return;
        }
        const merged = mergeSameProduct(previousIncoming, row);
        incomingById.set(productId, merged);
        const pos = prepared.findIndex((item) => getProductId(item) === productId);
        if (pos >= 0) prepared[pos] = merged;
        return;
      }
      const current = existingById.get(productId);
      if (current && clearlyDistinct(current, row)){
        conflicts.push({ productId, current, incoming:row, source:'catalogo_actual' });
        return;
      }
      incomingById.set(productId, row);
      prepared.push(row);
    });
    return { records:prepared, idMap, conflicts, blocked, assigned };
  }

  function remapProductReferences(value, idMap, parentKey){
    const map = idMap && typeof idMap === 'object' ? idMap : {};
    if (!value || !Object.keys(map).length) return clone(value);
    if (typeof value === 'string'){
      const text = value.trim();
      if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))){
        try{
          const parsed = JSON.parse(value);
          const remapped = remapProductReferences(parsed, map, parentKey);
          return JSON.stringify(remapped);
        }catch(_){ }
      }
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => remapProductReferences(item, map, parentKey));
    if (typeof value !== 'object') return value;
    const out = {};
    for (const [key, raw] of Object.entries(value)){
      if (PRODUCT_ID_FIELDS.has(key) && map[str(raw)]){
        out[key] = map[str(raw)];
        continue;
      }
      if (PRODUCT_KEYED_MAPS.has(key) && raw && typeof raw === 'object' && !Array.isArray(raw)){
        const remapped = {};
        for (const [childKey, childValue] of Object.entries(raw)){
          remapped[map[str(childKey)] || childKey] = remapProductReferences(childValue, map, key);
        }
        out[key] = remapped;
        continue;
      }
      out[key] = remapProductReferences(raw, map, key);
    }
    return out;
  }

  function openDb(){
    return new Promise((resolve, reject) => {
      try{
        const req = g.indexedDB.open(DB_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('No se pudo abrir Productos.'));
        req.onblocked = () => reject(new Error('Productos está bloqueado por otra pestaña.'));
      }catch(error){ reject(error); }
    });
  }
  function txDone(tx){
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Error de IndexedDB.'));
      tx.onabort = () => reject(tx.error || new Error('Operación abortada.'));
    });
  }
  async function getAllStore(storeName){
    const db = await openDb();
    try{
      if (!db.objectStoreNames.contains(storeName)) return [];
      const tx = db.transaction(storeName, 'readonly');
      const done = txDone(tx);
      const req = tx.objectStore(storeName).getAll();
      const result = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => reject(req.error || tx.error);
      });
      await done;
      return result;
    } finally { try{ db.close(); }catch(_){ } }
  }
  async function getAllProductsRaw(){ return getAllStore(STORE_NAME); }
  async function getProductRaw(productId){
    const target = str(productId);
    const rows = await getAllProductsRaw();
    return rows.find((row) => getProductId(row) === target) || null;
  }
  async function putProduct(record){
    const db = await openDb();
    try{
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const done = txDone(tx);
      const req = tx.objectStore(STORE_NAME).put(record);
      const key = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error || tx.error); });
      await done;
      return key;
    } finally { try{ db.close(); }catch(_){ } }
  }
  async function applyTombstonesToCatalog(options){
    const opts = options && typeof options === 'object' ? options : {};
    const tombstones = readTombstones();
    const ids = new Set(tombstones.map((row) => str(row && row.productId)).filter(Boolean));
    if (!ids.size) return { removed:0, productIds:[] };
    const db = await openDb();
    const removedIds = [];
    try{
      if (!db.objectStoreNames.contains(STORE_NAME)) return { removed:0, productIds:[] };
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const done = txDone(tx);
      const store = tx.objectStore(STORE_NAME);
      await new Promise((resolve, reject) => {
        const req = store.openCursor();
        req.onerror = () => reject(req.error || tx.error || new Error('No se pudieron aplicar tombstones.'));
        req.onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor){ resolve(); return; }
          const productId = getProductId(cursor.value);
          if (productId && ids.has(productId)){
            cursor.delete();
            removedIds.push(productId);
          }
          cursor.continue();
        };
      });
      await done;
    } finally { try{ db.close(); }catch(_){ } }
    if (removedIds.length){
      logOperation('aplicar_tombstones', { productId:removedIds.join(','), name:`${removedIds.length} producto(s)` }, { source:opts.source || 'integridad', count:removedIds.length });
    }
    return { removed:removedIds.length, productIds:removedIds };
  }

  async function deleteProductRecord(productId, meta){
    const product = await getProductRaw(productId);
    if (!product) return { ok:false, reason:'not_found' };
    rememberDeleted(product, { ...(meta || {}), origin:(meta && meta.origin) || 'auditoria_productos' });
    const db = await openDb();
    try{
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const done = txDone(tx);
      tx.objectStore(STORE_NAME).delete(product.id);
      await done;
    } finally { try{ db.close(); }catch(_){ } }
    logOperation('eliminar', product, meta);
    return { ok:true, productId:getProductId(product) };
  }
  async function setInactive(productId, options){
    const product = await getProductRaw(productId);
    if (!product) return { ok:false, reason:'not_found' };
    const opts = options && typeof options === 'object' ? options : {};
    const next = {
      ...clone(product),
      active:false,
      quarantined:opts.quarantine !== false,
      quarantinedAt:opts.quarantine === false ? product.quarantinedAt : nowIso(),
      quarantineReason:str(opts.reason || 'Revisión controlada de integridad'),
      updatedAt:nowIso(),
      updatedFrom:'auditoria_productos'
    };
    await putProduct(next);
    if (next.quarantined){
      const list = readJson(QUARANTINE_KEY, []);
      const filtered = (Array.isArray(list) ? list : []).filter((item) => str(item && item.productId) !== getProductId(next));
      filtered.push({ productId:getProductId(next), name:str(next.name || next.nombre), at:next.quarantinedAt, reason:next.quarantineReason });
      writeJson(QUARANTINE_KEY, filtered);
    }
    logOperation(next.quarantined ? 'cuarentena' : 'inactivar', next, opts);
    return { ok:true, product:next };
  }
  function logOperation(action, product, meta){
    const current = readJson(AUDIT_LOG_KEY, []);
    const list = Array.isArray(current) ? current : [];
    list.unshift({
      id:'op_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8),
      action:str(action), productId:getProductId(product), nombreSnapshot:str(product && (product.name || product.nombre)),
      at:nowIso(), meta:clone(meta || {})
    });
    writeJson(AUDIT_LOG_KEY, list.slice(0,250));
  }

  function parseJsonStorage(key, fallback){
    const raw = readRaw(key);
    if (!raw) return fallback;
    try{ return JSON.parse(raw); }catch(_){ return fallback; }
  }
  function containsProductId(value, productId, depth){
    if (depth > 8 || value == null) return false;
    if (Array.isArray(value)) return value.some((item) => containsProductId(item, productId, depth + 1));
    if (typeof value !== 'object') return false;
    for (const [key, child] of Object.entries(value)){
      if (PRODUCT_ID_FIELDS.has(key) && str(child) === productId) return true;
      if (PRODUCT_KEYED_MAPS.has(key) && child && typeof child === 'object' && Object.prototype.hasOwnProperty.call(child, productId)) return true;
      if (child && typeof child === 'object' && containsProductId(child, productId, depth + 1)) return true;
    }
    return false;
  }
  function countRefs(list, productId){ return (Array.isArray(list) ? list : []).filter((row) => containsProductId(row, productId, 0)).length; }
  function storageKeys(){
    const out = [];
    try{ for (let i=0; i<g.localStorage.length; i++) out.push(g.localStorage.key(i)); }catch(_){ }
    return out.filter(Boolean);
  }
  function getStock(productId){
    const inv = parseJsonStorage('arcano33_inventario', {});
    const byId = inv && inv.finishedByProductId && inv.finishedByProductId[productId];
    if (byId && Number.isFinite(Number(byId.stock))) return Number(byId.stock);
    const finished = inv && Array.isArray(inv.finished) ? inv.finished : [];
    const row = finished.find((item) => str(item && (item.productId || item.productoId)) === productId);
    return row && Number.isFinite(Number(row.stock ?? row.cantidad)) ? Number(row.stock ?? row.cantidad) : 0;
  }
  function seedSignals(product){
    const row = product && typeof product === 'object' ? product : {};
    const text = [row.origin,row.origen,row.updatedFrom,row.createdFrom,row.source,row.importOrigin,row.migrationSource].map(str).join(' ').toLowerCase();
    const explicit = row.seed === true || row.isSeed === true || row.defaultProduct === true || row.autoCreated === true;
    const marker = /(^|[\s_-])(seed|semilla|default|restore|restaur|base_a33|automatic|autocreat|ensuredefault)([\s_-]|$)/.test(text);
    return { explicit, marker, text, known:explicit || marker };
  }
  function classify(product, relations){
    const signals = seedSignals(product);
    const historical = relations.sales + relations.lots + relations.orders + relations.agenda > 0;
    const originText = norm(product.origin || product.origen);
    const editText = norm([product.updatedFrom, product.createdFrom, product.source].map(str).join(' '));
    const userModified = /catalogos_productos|usuario|manual/.test(originText + ' ' + editText);
    if (historical) return { classification:'Producto usado históricamente', confidence:'Alta', seed:signals };
    if (userModified) return { classification:'Producto modificado por el usuario', confidence:'Alta', seed:signals };
    if (signals.known) return { classification:'Candidato automático', confidence:signals.explicit ? 'Alta' : 'Media', seed:signals };
    if (getProductId(product) && (product.createdAt || product.updatedAt || product.origin)) return { classification:'Producto legítimo confirmado', confidence:'Media', seed:signals };
    return { classification:'Origen indeterminado', confidence:'Baja', seed:signals };
  }
  async function auditProducts(){
    const products = await getAllProductsRaw();
    let sales = [], inventory = [];
    try{ sales = await getAllStore('sales'); }catch(_){ }
    try{ inventory = await getAllStore('inventory'); }catch(_){ }
    const localDocs = {};
    storageKeys().filter((key) => /lote|pedido|agenda|receta|costo|inventario/i.test(key)).forEach((key) => { localDocs[key] = parseJsonStorage(key, null); });
    return products.map((product) => {
      const productId = getProductId(product);
      const recipesDoc = localDocs.arcano33_recetas_v1 || {};
      const recipe = !!(recipesDoc && ((recipesDoc.recetas && recipesDoc.recetas[productId]) || recipesDoc[productId]));
      const costsDoc = localDocs.a33_catalogos_costos_v1 || {};
      const cost = !!(costsDoc && costsDoc.consumablesByProduct && costsDoc.consumablesByProduct[productId]);
      const lots = Object.entries(localDocs).filter(([key]) => /lote/i.test(key)).reduce((n,[,value]) => n + countRefs(Array.isArray(value) ? value : (value && value.items), productId), 0);
      const orders = Object.entries(localDocs).filter(([key]) => /pedido/i.test(key)).reduce((n,[,value]) => n + countRefs(Array.isArray(value) ? value : (value && value.items), productId), 0);
      const agenda = Object.entries(localDocs).filter(([key]) => /agenda/i.test(key)).reduce((n,[,value]) => n + countRefs(Array.isArray(value) ? value : (value && value.items), productId), 0);
      const relations = {
        sales:countRefs(sales, productId),
        inventory:countRefs(inventory, productId),
        lots, orders, agenda
      };
      const cls = classify(product, relations);
      return {
        productId,
        legacyId:product.id,
        name:str(product.name || product.nombre || 'Producto sin nombre'),
        state:product.deleted === true ? 'Borrado lógico' : (product.active === false ? (product.quarantined ? 'Cuarentena' : 'Inactivo') : 'Activo'),
        origin:str(product.origin || product.origen || 'Sin dato'),
        createdAt:str(product.createdAt || ''),
        updatedAt:str(product.updatedAt || product.modifiedAt || ''),
        recipe, cost,
        envaseId:str(product.envaseId || ''), tapaId:str(product.tapaId || ''),
        stock:getStock(productId), relations,
        seedIndicator:cls.seed.known ? (cls.seed.explicit ? 'Marcador explícito' : 'Marcador técnico') : 'Sin indicador técnico',
        classification:cls.classification, confidence:cls.confidence,
        tombstoned:isTombstoned(productId), raw:clone(product)
      };
    });
  }

  g.A33ProductIntegrity = Object.assign({}, g.A33ProductIntegrity || {}, {
    version:1,
    dbName:DB_NAME,
    storeName:STORE_NAME,
    tombstoneKey:TOMBSTONE_KEY,
    auditLogKey:AUDIT_LOG_KEY,
    quarantineKey:QUARANTINE_KEY,
    productIdFields:Array.from(PRODUCT_ID_FIELDS),
    getProductId,
    generateProductId,
    normalizeTombstone,
    mergeTombstones,
    readTombstones,
    writeTombstones,
    rememberDeleted,
    isTombstoned,
    clearlyDistinct,
    mergeSameProduct,
    normalizeIncomingProducts,
    remapProductReferences,
    getAllProductsRaw,
    getProductRaw,
    applyTombstonesToCatalog,
    setInactive,
    deleteProduct:deleteProductRecord,
    auditProducts,
    logOperation
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
