/* Suite A33 — Materia Prima: contrato central para Agenda → Compras */
(function(g){
  'use strict';

  const DB_NAME = 'a33-pos';
  const DB_VERSION = 37;
  const STORE_NAME = 'rawMaterials';
  const UNITS = Object.freeze(['Unidad', 'Cajas', 'Litros', 'Galones']);
  let db = null;

  function clean(value, max){
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max || 300);
  }

  function clone(value){
    try{ return JSON.parse(JSON.stringify(value)); }catch(_){ return null; }
  }

  function normalizeName(value){
    return clean(value, 120).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function normalizeUnit(value){
    const raw = clean(value, 24);
    return UNITS.includes(raw) ? raw : '';
  }

  function normalizePrice(value){
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round((n + Number.EPSILON) * 100) / 100 : null;
  }

  function ensureStore(database, transaction){
    if (!database.objectStoreNames.contains(STORE_NAME)){
      const store = database.createObjectStore(STORE_NAME, { keyPath:'id', autoIncrement:true });
      try{ store.createIndex('by_name_normalized', 'nameNormalized', { unique:false }); }catch(_){ }
      try{ store.createIndex('by_active', 'active', { unique:false }); }catch(_){ }
      try{ store.createIndex('by_updated_at', 'updatedAt', { unique:false }); }catch(_){ }
      return;
    }
    try{
      const store = transaction.objectStore(STORE_NAME);
      if (!store.indexNames.contains('by_name_normalized')) store.createIndex('by_name_normalized', 'nameNormalized', { unique:false });
      if (!store.indexNames.contains('by_active')) store.createIndex('by_active', 'active', { unique:false });
      if (!store.indexNames.contains('by_updated_at')) store.createIndex('by_updated_at', 'updatedAt', { unique:false });
    }catch(_){ }
  }

  function schemaNeedsUpgrade(database){
    if (!database.objectStoreNames.contains(STORE_NAME)) return true;
    try{
      const tx = database.transaction(STORE_NAME, 'readonly');
      const indexes = tx.objectStore(STORE_NAME).indexNames;
      return !indexes.contains('by_name_normalized') || !indexes.contains('by_active') || !indexes.contains('by_updated_at');
    }catch(_){ return true; }
  }

  function adoptDb(database, resolve){
    db = database;
    try{ db.onversionchange = function(){ try{ db.close(); }catch(_){ } db = null; }; }catch(_){ }
    resolve(db);
  }

  function openDb(){
    if (db) return Promise.resolve(db);
    return new Promise(function(resolve, reject){
      if (!g.indexedDB){ reject(new Error('indexeddb_unavailable')); return; }
      const fail = function(error){ reject(error || new Error('raw_materials_db_open_failed')); };
      const first = g.indexedDB.open(DB_NAME);
      first.onupgradeneeded = function(event){ ensureStore(event.target.result, event.target.transaction); };
      first.onsuccess = function(){
        const current = first.result;
        if (!schemaNeedsUpgrade(current)){
          adoptDb(current, resolve);
          return;
        }
        const nextVersion = Number(current.version || 1) + 1;
        try{ current.close(); }catch(_){ }
        if (nextVersion > DB_VERSION){
          fail(new Error('raw_materials_schema_requires_suite_update'));
          return;
        }
        const upgrade = g.indexedDB.open(DB_NAME, nextVersion);
        upgrade.onupgradeneeded = function(event){ ensureStore(event.target.result, event.target.transaction); };
        upgrade.onsuccess = function(){ adoptDb(upgrade.result, resolve); };
        upgrade.onerror = function(){ fail(upgrade.error); };
        upgrade.onblocked = function(){ fail(new Error('raw_materials_db_blocked')); };
      };
      first.onerror = function(){ fail(first.error); };
      first.onblocked = function(){ fail(new Error('raw_materials_db_blocked')); };
    });
  }

  async function listAll(){
    const database = await openDb();
    if (!database.objectStoreNames.contains(STORE_NAME)) return [];
    return new Promise(function(resolve, reject){
      const tx = database.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = function(){ resolve((request.result || []).map(function(row){ return clone(row) || {}; })); };
      request.onerror = function(){ reject(request.error || tx.error); };
      tx.onerror = function(){ reject(tx.error || request.error); };
    });
  }

  async function listActive(){
    const rows = await listAll();
    return rows
      .filter(function(row){ return row && row.active !== false; })
      .sort(function(a, b){ return String(a.name || '').localeCompare(String(b.name || ''), 'es-NI', { sensitivity:'base' }); })
      .map(function(row){
        return {
          id: row.materialId || String(row.id == null ? '' : row.id),
          localId: row.id == null ? null : row.id,
          materialId: row.materialId || '',
          name: clean(row.name, 120),
          category: clean(row.category, 80),
          unit: normalizeUnit(row.unit),
          price: normalizePrice(row.price),
          active: true,
          updatedAt: clean(row.updatedAt, 80)
        };
      });
  }

  async function getById(identifier){
    const target = clean(identifier, 160);
    if (!target) return null;
    const rows = await listAll();
    const row = rows.find(function(item){
      return String(item && item.id) === target || clean(item && item.materialId, 160) === target;
    });
    return row ? clone(row) : null;
  }

  function purchaseSnapshot(material, priceUsed){
    const row = material && typeof material === 'object' ? material : {};
    const price = priceUsed == null ? normalizePrice(row.price) : normalizePrice(priceUsed);
    return {
      materialId: clean(row.materialId || row.id, 160),
      name: clean(row.name, 120),
      category: clean(row.category, 80),
      unit: normalizeUnit(row.unit),
      priceUsed: price == null ? 0 : price
    };
  }

  g.A33Materials = Object.freeze({
    version: 1,
    dbName: DB_NAME,
    dbVersion: DB_VERSION,
    storeName: STORE_NAME,
    units: UNITS,
    normalizeName: normalizeName,
    normalizeUnit: normalizeUnit,
    normalizePrice: normalizePrice,
    listAll: listAll,
    listActive: listActive,
    getById: getById,
    purchaseSnapshot: purchaseSnapshot
  });
})(window);
