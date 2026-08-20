/* Suite A33 — diagnóstico preventivo del bloque crítico (E7.1, solo lectura). */
(function(g){
  'use strict';

  const SDK_VERSION = '10.12.5';
  const SCRIPT_ID = 'a33-firebase-sdk-firestore-compat';
  const SCRIPT_URL = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/firebase-firestore-compat.js';
  const RESULT_KEY = 'suite_a33_firebase_analyze_e7_v1';
  const RECORD_LIMIT = 900000;
  const AREAS = Object.freeze(['pos', 'finanzas', 'caja_chica']);
  const EXCLUDED = Object.freeze(['seguridad']);
  const STABLE_FIELDS = Object.freeze([
    'id', 'uid', 'code', 'codigo', 'saleId', 'ventaId', 'receiptId', 'recordId',
    'entryId', 'movementId', 'paymentId', 'chargeId', 'accountId', '_sourceKey'
  ]);

  function clean(value, maxLen){
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen || 320);
  }

  function clone(value){
    try{ return JSON.parse(JSON.stringify(value == null ? null : value)); }catch(_){ return null; }
  }

  function byteLength(value){
    const text = typeof value === 'string' ? value : JSON.stringify(value == null ? null : value);
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    return unescape(encodeURIComponent(text)).length;
  }

  function checksum(text){
    let hash = 2166136261;
    const value = String(text || '');
    for (let index = 0; index < value.length; index += 1){
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function parseStored(value){
    if (typeof value !== 'string') return clone(value);
    try{ return JSON.parse(value); }catch(_){ return value; }
  }

  function asRecords(value){
    const parsed = parseStored(value);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object'){
      if (Array.isArray(parsed.records)) return parsed.records;
      if (Array.isArray(parsed.items)) return parsed.items;
      return Object.keys(parsed).sort().map(function(key){
        const item = parsed[key];
        return item && typeof item === 'object'
          ? Object.assign({ _sourceKey:key }, clone(item))
          : { _sourceKey:key, value:item };
      });
    }
    return parsed == null || parsed === '' ? [] : [{ value:parsed }];
  }

  function normalizeLocalStorage(value){
    if (!value) return {};
    if (!Array.isArray(value)) return value && typeof value === 'object' ? value : {};
    return value.reduce(function(out, item){
      if (!item || typeof item !== 'object') return out;
      const key = clean(item.key || item.name, 240);
      if (key) out[key] = Object.prototype.hasOwnProperty.call(item, 'value') ? item.value : item.data;
      return out;
    }, {});
  }

  function normalizeIndexedDB(value){
    const out = {};
    if (!value) return out;
    const databases = Array.isArray(value)
      ? value
      : Object.keys(value).map(function(name){ return { name:name, stores:value[name] }; });
    databases.forEach(function(database){
      if (!database || typeof database !== 'object') return;
      const name = clean(database.name || database.dbName || database.database || '', 180).toLowerCase();
      if (!name) return;
      const rawStores = database.stores || database.objectStores || database.data || {};
      const stores = {};
      if (Array.isArray(rawStores)){
        rawStores.forEach(function(store){
          if (!store || typeof store !== 'object') return;
          const storeName = clean(store.name || store.storeName || '', 180).toLowerCase();
          if (storeName) stores[storeName] = Object.prototype.hasOwnProperty.call(store, 'records') ? store.records : store.data;
        });
      }else if (rawStores && typeof rawStores === 'object'){
        Object.keys(rawStores).forEach(function(storeName){ stores[storeName.toLowerCase()] = rawStores[storeName]; });
      }
      out[name] = stores;
    });
    return out;
  }

  function stableValue(record){
    const source = record && typeof record === 'object' ? record : {};
    for (let index = 0; index < STABLE_FIELDS.length; index += 1){
      const value = source[STABLE_FIELDS[index]];
      if (value !== undefined && value !== null && clean(value, 240)) return clean(value, 240);
    }
    return '';
  }

  function emptyArea(){
    return { records:0, sources:0, bytes:0, maxRecordBytes:0, missingStableIds:0, duplicateStableIds:0, oversizedRecords:0, sourceDetails:[] };
  }

  function addSource(report, areaId, sourceId, value){
    const area = report.areas[areaId];
    const rows = asRecords(value);
    if (!rows.length) return;
    const seen = Object.create(null);
    const detail = { source:sourceId, records:rows.length, bytes:0, missingStableIds:0, duplicateStableIds:0, oversizedRecords:0 };
    rows.forEach(function(record){
      const bytes = byteLength(record);
      const stable = stableValue(record);
      detail.bytes += bytes;
      area.maxRecordBytes = Math.max(area.maxRecordBytes, bytes);
      if (!stable){ detail.missingStableIds += 1; }
      else if (seen[stable]){ detail.duplicateStableIds += 1; }
      else seen[stable] = true;
      if (bytes > RECORD_LIMIT) detail.oversizedRecords += 1;
    });
    area.records += detail.records;
    area.sources += 1;
    area.bytes += detail.bytes;
    area.missingStableIds += detail.missingStableIds;
    area.duplicateStableIds += detail.duplicateStableIds;
    area.oversizedRecords += detail.oversizedRecords;
    area.sourceDetails.push(detail);
  }

  function analyzeBackup(backup, sourceInfo){
    if (!backup || !backup.data || typeof backup.data !== 'object') throw new Error('La carga E4 no tiene una sección data válida.');
    const local = normalizeLocalStorage(backup.data.localStorage);
    const databases = normalizeIndexedDB(backup.data.indexedDB);
    const report = {
      schemaVersion:1,
      stage:'E7.1',
      status:'ready',
      workspaceId:clean(sourceInfo && sourceInfo.workspaceId, 80) || 'arcano33',
      importId:clean(sourceInfo && sourceInfo.importId, 180),
      sourceChecksum:clean(sourceInfo && sourceInfo.sourceChecksum, 80),
      analyzedAt:new Date().toISOString(),
      scope:AREAS.slice(),
      excluded:EXCLUDED.slice(),
      recordLimitBytes:RECORD_LIMIT,
      recordCount:0,
      sourceCount:0,
      totals:{ records:0, sources:0, bytes:0, missingStableIds:0, duplicateStableIds:0, oversizedRecords:0 },
      areas:{ pos:emptyArea(), finanzas:emptyArea(), caja_chica:emptyArea() },
      warnings:[],
      readyForE72:true
    };

    Object.keys(databases).sort().forEach(function(databaseName){
      const stores = databases[databaseName] || {};
      Object.keys(stores).sort().forEach(function(storeName){
        const sourceId = 'indexedDB/' + databaseName + '/' + storeName;
        const isPos = databaseName.includes('a33-pos') || databaseName === 'pos' || storeName === 'sales' || storeName === 'ventas' || storeName.startsWith('cash');
        const isCaja = storeName.includes('caja_chica') || storeName === 'cajachica';
        const isFinance = databaseName.includes('finanzas') || databaseName.includes('finance') || [
          'accounts', 'journalentries', 'journallines', 'receipts', 'purchases', 'posdailycloseimports',
          'settings', 'cobrar', 'pagar', 'cuentas', 'asientos', 'recibos', 'compras'
        ].includes(storeName);
        if (isCaja) addSource(report, 'caja_chica', sourceId, stores[storeName]);
        else if (isPos) addSource(report, 'pos', sourceId, stores[storeName]);
        else if (isFinance) addSource(report, 'finanzas', sourceId, stores[storeName]);
      });
    });

    Object.keys(local).sort().forEach(function(key){
      const lowered = key.toLowerCase();
      const sourceId = 'localStorage/' + key;
      if (lowered.includes('seguridad') || lowered.includes('security') || lowered.includes('firebase')) return;
      if (lowered.includes('caja_chica') || lowered.includes('cajachica')) addSource(report, 'caja_chica', sourceId, local[key]);
      else if (lowered.includes('a33.ef2') || lowered.includes('pos_') || lowered.includes('_pos') || lowered.includes('venta')) addSource(report, 'pos', sourceId, local[key]);
      else if (lowered.includes('finanzas') || lowered.includes('finance_dashboard') || lowered.includes('cuentas_financieras') || lowered.includes('cat_usage_cache')) addSource(report, 'finanzas', sourceId, local[key]);
    });

    AREAS.forEach(function(areaId){
      const area = report.areas[areaId];
      report.totals.records += area.records;
      report.totals.sources += area.sources;
      report.totals.bytes += area.bytes;
      report.totals.missingStableIds += area.missingStableIds;
      report.totals.duplicateStableIds += area.duplicateStableIds;
      report.totals.oversizedRecords += area.oversizedRecords;
      if (!area.records) report.warnings.push('No se detectaron registros para ' + areaId + '.');
      if (area.missingStableIds) report.warnings.push(areaId + ': ' + area.missingStableIds + ' registro(s) requerirán identificador estable en E7.2.');
      if (area.duplicateStableIds) report.warnings.push(areaId + ': ' + area.duplicateStableIds + ' identificador(es) duplicados requieren revisión.');
      if (area.oversizedRecords) report.warnings.push(areaId + ': ' + area.oversizedRecords + ' registro(s) exceden el límite seguro de 900 KB.');
    });
    if (report.totals.oversizedRecords || report.totals.duplicateStableIds){
      report.status = 'review';
      report.readyForE72 = false;
    }else if (report.warnings.length){
      report.status = 'ready_with_warnings';
    }
    report.recordCount = report.totals.records;
    report.sourceCount = report.totals.sources;
    return report;
  }

  function loadScript(){
    if (g.firebase && typeof g.firebase.firestore === 'function') return Promise.resolve();
    return new Promise(function(resolve, reject){
      const current = typeof document !== 'undefined' ? document.getElementById(SCRIPT_ID) : null;
      if (current){
        current.addEventListener('load', resolve, { once:true });
        current.addEventListener('error', function(){ reject(new Error('No se pudo cargar Firestore.')); }, { once:true });
        return;
      }
      if (typeof document === 'undefined') return reject(new Error('No se pudo cargar Firestore.'));
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = resolve;
      script.onerror = function(){ reject(new Error('No se pudo cargar Firestore.')); };
      document.head.appendChild(script);
    });
  }

  function requireAdmin(){
    const auth = g.A33FirebaseAuth && g.A33FirebaseAuth.getState ? g.A33FirebaseAuth.getState() : null;
    const access = g.A33Access && g.A33Access.getState ? g.A33Access.getState() : null;
    if (!auth || !auth.authenticated || !auth.user || !auth.user.uid) throw new Error('Iniciá sesión con el usuario maestro.');
    if (!access || !access.isAdmin || !access.profile || access.profile.status !== 'active') throw new Error('E7.1 requiere un perfil Admin activo.');
    return { user:auth.user, access:access };
  }

  async function readStaged(db, workspaceId, last){
    if (!last || !last.importId) throw new Error('No hay una carga E4 preparada en este navegador.');
    const root = db.collection('workspaces').doc(workspaceId).collection('imports').doc(clean(last.importId, 180));
    const manifestSnapshot = await root.get();
    if (!manifestSnapshot || !manifestSnapshot.exists) throw new Error('No se encontró la carga E4 en Firestore.');
    const manifest = manifestSnapshot.data();
    if (!manifest || manifest.status !== 'staged' || manifest.applied !== false || manifest.sanitized !== true) throw new Error('La carga E4 no está en estado staged seguro.');
    if (manifest.workspaceId !== workspaceId || manifest.importId !== last.importId) throw new Error('La carga E4 pertenece a otro workspace.');
    const e5Snapshot = await root.collection('applications').doc('e5').get();
    const e6Snapshot = await root.collection('applications').doc('e6').get();
    const e5 = e5Snapshot && e5Snapshot.exists ? e5Snapshot.data() : null;
    const e6 = e6Snapshot && e6Snapshot.exists ? e6Snapshot.data() : null;
    if (!e5 || e5.status !== 'completed' || e5.sourceChecksum !== manifest.checksum) throw new Error('E5 no está confirmada para esta carga E4.');
    if (!e6 || e6.status !== 'completed' || e6.sourceChecksum !== manifest.checksum) throw new Error('Primero debe completarse E6 para esta misma carga E4.');
    const chunksSnapshot = await root.collection('chunks').orderBy('index', 'asc').get();
    const chunks = [];
    chunksSnapshot.forEach(function(doc){ chunks.push(doc.data()); });
    if (chunks.length !== manifest.chunkCount) throw new Error('La carga E4 está incompleta: faltan bloques.');
    chunks.forEach(function(chunk, index){
      if (chunk.index !== index || chunk.total !== chunks.length || chunk.checksum !== checksum(chunk.content) || chunk.bytes !== byteLength(chunk.content)){
        throw new Error('Falló la verificación del bloque E4 #' + (index + 1) + '.');
      }
    });
    const json = chunks.map(function(chunk){ return chunk.content; }).join('');
    if (byteLength(json) !== manifest.bytes || checksum(json + ':' + manifest.bytes) !== manifest.checksum) throw new Error('Falló la verificación integral de la carga E4.');
    let backup;
    try{ backup = JSON.parse(json); }catch(_){ throw new Error('La carga E4 no contiene JSON válido.'); }
    return { manifest:manifest, backup:backup };
  }

  async function analyze(){
    const settings = g.A33FirebaseSettings && g.A33FirebaseSettings.read ? g.A33FirebaseSettings.read() : null;
    if (!settings || !settings.enabled || !settings.configured) throw new Error('Firebase debe estar activado y configurado.');
    const session = requireAdmin();
    if (!g.A33Firebase || typeof g.A33Firebase.initFirebaseApp !== 'function') throw new Error('No está disponible el motor Firebase.');
    if (!g.A33FirebaseImport || typeof g.A33FirebaseImport.readLast !== 'function') throw new Error('No está disponible la carga E4.');
    const app = await g.A33Firebase.initFirebaseApp(settings);
    await loadScript();
    const db = g.firebase.firestore(app);
    const workspaceId = clean(settings.workspaceId || session.access.workspaceId, 80) || 'arcano33';
    const staged = await readStaged(db, workspaceId, g.A33FirebaseImport.readLast());
    const report = analyzeBackup(staged.backup, {
      workspaceId:workspaceId,
      importId:staged.manifest.importId,
      sourceChecksum:staged.manifest.checksum
    });
    try{ localStorage.setItem(RESULT_KEY, JSON.stringify(report)); }catch(_){ }
    return report;
  }

  function readLast(){
    try{ const raw = localStorage.getItem(RESULT_KEY); return raw ? JSON.parse(raw) : null; }catch(_){ return null; }
  }

  g.A33FirebaseAnalyzeE7 = Object.freeze({
    areas:AREAS,
    excluded:EXCLUDED,
    analyzeBackup:analyzeBackup,
    analyze:analyze,
    readLast:readLast,
    checksum:checksum
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
