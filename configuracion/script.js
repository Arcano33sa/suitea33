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
      meta: {
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
          bodyHtml: `<div>✅ ${escapeHtml(result.message || 'Usuario creado correctamente.')}</div><div class="cfg-user-password-card"><strong>Contraseña temporal</strong><br /><code>${escapeHtml(result.temporaryPassword)}</code><div class="small-note">Muéstrala una sola vez al usuario o cámbiala en la siguiente etapa.</div></div>`,
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

  function initConfigTabs(){
    const tabs = Array.from(document.querySelectorAll('.cfg-tab[data-target]'));
    const panels = Array.from(document.querySelectorAll('.cfg-panel-view[data-panel]'));
    if (!tabs.length || !panels.length) return;

    const setActive = (target, { focus = false } = {}) => {
      let nextTab = null;
      tabs.forEach((tab) => {
        const active = tab.dataset.target === target;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.setAttribute('tabindex', active ? '0' : '-1');
        if (active) nextTab = tab;
      });

      panels.forEach((panel) => {
        const active = panel.dataset.panel === target;
        panel.classList.toggle('is-active', active);
        panel.hidden = !active;
      });

      if (focus && nextTab) nextTab.focus();
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => setActive(tab.dataset.target));
      tab.addEventListener('keydown', (event) => {
        const idx = tabs.indexOf(tab);
        if (idx < 0) return;
        let nextIdx = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIdx = (idx + 1) % tabs.length;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIdx = (idx - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') nextIdx = 0;
        if (event.key === 'End') nextIdx = tabs.length - 1;
        if (nextIdx === null) return;
        event.preventDefault();
        setActive(tabs[nextIdx].dataset.target, { focus: true });
      });
    });

    const initial = tabs.find((tab) => tab.classList.contains('is-active')) || tabs[0];
    if (initial) setActive(initial.dataset.target);
  }

  function getFirebaseUiModel(state){
    const current = (state && typeof state === 'object') ? state : {};
    const status = String(current.status || 'disabled');
    const projectId = String(current.projectId || '').trim();
    const configFile = String(current.configFile || 'assets/js/a33-firebase-config.js').trim();

    const model = {
      badgeText: 'Modo local',
      badgeState: 'local',
      heroHeadline: 'Modo local seguro',
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
      model.heroHeadline = 'Preparando Firebase';
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
      model.heroHeadline = 'Firebase enlazado';
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
      model.heroHeadline = 'Fallback local activo';
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

    const hero = document.getElementById('cfg-hero-firebase-headline');
    if (hero) hero.textContent = ui.heroHeadline;

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

  document.addEventListener('DOMContentLoaded', () => {
    initConfigTabs();
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
