/* Suite A33 — aplicación inicial segura: Configuración, Catálogos y Lotes (E5). */
(function(g){
  'use strict';

  const SDK_VERSION = '10.12.5';
  const SCRIPT_ID = 'a33-firebase-sdk-firestore-compat';
  const SCRIPT_URL = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/firebase-firestore-compat.js';
  const RESULT_KEY = 'suite_a33_firebase_apply_e5_v1';
  const BATCH_LIMIT = 200;
  const CONFIG_CHUNK_MAX_BYTES = 250000;
  const MODULE_IDS = Object.freeze(['configuracion', 'catalogos', 'lotes']);
  const CONFIG_KEYS = Object.freeze({
    identidad:['suite_a33_identity_v1'],
    apariencia:['suite_a33_appearance_preference'],
    reportes:['suite_a33_reports_preferences_v1'],
    moneda:['suite_a33_currency_settings_v1'],
    pwa:['suite_a33_pwa', 'a33_build', 'a33_version']
  });
  const CATALOG_STORES = Object.freeze({
    productos:'products',
    materia_prima:'rawMaterials',
    extras:'extras',
    bancos:'banks',
    clientes:'customers'
  });
  const CATALOG_KEYS = Object.freeze({
    envases:['a33_catalog_envases'],
    tapas:['a33_catalog_tapas'],
    clientes:['a33_pos_customers']
  });

  function clean(value, maxLen){
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen || 320);
  }

  function clone(value){
    try{ return JSON.parse(JSON.stringify(value == null ? null : value)); }catch(_){ return null; }
  }

  function byteLength(value){
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(String(value || '')).length;
    return unescape(encodeURIComponent(String(value || ''))).length;
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
    if (!access || !access.isAdmin || !access.profile || access.profile.status !== 'active') throw new Error('E5 requiere un perfil Admin activo.');
    return { user:auth.user, access:access };
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
      return Object.keys(parsed).map(function(key){
        const item = parsed[key];
        return item && typeof item === 'object' ? Object.assign({ _sourceKey:key }, item) : { _sourceKey:key, value:item };
      });
    }
    return parsed == null || parsed === '' ? [] : [{ value:parsed }];
  }

  function findLocal(local, needles){
    const source = local && typeof local === 'object' ? local : {};
    const lowered = (needles || []).map(function(item){ return clean(item, 180).toLowerCase(); });
    return Object.keys(source).filter(function(key){
      const current = key.toLowerCase();
      return lowered.some(function(needle){ return current.includes(needle); });
    }).sort().map(function(key){ return { key:key, value:parseStored(source[key]) }; });
  }

  function stableId(value, prefix, index){
    const source = value && typeof value === 'object' ? value : {};
    const candidate = source.id || source.uid || source.code || source.codigo || source.productId || source.materialId ||
      source.customerId || source.clientId || source.loteId || source.batchId || source._sourceKey;
    if (candidate) return clean(candidate, 180);
    return (prefix || 'registro') + '_' + checksum(JSON.stringify(value) + ':' + String(index));
  }

  function createRecord(engine, context, moduleId, entityId, recordId, payload, sourceId){
    const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? clone(payload) : { value:clone(payload) };
    return engine.createDocument({
      workspaceId:context.workspaceId,
      moduleId:moduleId,
      entityId:entityId,
      recordId:recordId,
      sourceId:sourceId || recordId,
      updatedBy:context.uid,
      deviceId:context.deviceId,
      payload:body
    });
  }

  function validateRecord(engine, document, label){
    const validation = engine.validateDocument(document);
    if (!validation.ok) throw new Error(label + ': ' + validation.errors.join(', '));
    return document;
  }

  function makeRecord(engine, context, moduleId, entityId, recordId, payload, sourceId){
    return validateRecord(engine, createRecord(engine, context, moduleId, entityId, recordId, payload, sourceId), moduleId + '/' + entityId);
  }

  function splitUtf8(text, maxBytes){
    const source = String(text || '');
    const limit = Math.max(1024, Number(maxBytes) || CONFIG_CHUNK_MAX_BYTES);
    const chunks = [];
    let offset = 0;
    while (offset < source.length){
      let low = offset + 1;
      let high = source.length;
      let end = low;
      while (low <= high){
        const middle = Math.floor((low + high) / 2);
        if (byteLength(source.slice(offset, middle)) <= limit){
          end = middle;
          low = middle + 1;
        }else{
          high = middle - 1;
        }
      }
      if (end < source.length && end > offset && /[\uD800-\uDBFF]/.test(source.charAt(end - 1))) end -= 1;
      if (end <= offset) end = offset + 1;
      chunks.push(source.slice(offset, end));
      offset = end;
    }
    return chunks;
  }

  function makeConfigRecords(engine, context, entityId, recordId, payload, sourceId){
    const regular = createRecord(engine, context, 'configuracion', entityId, recordId, payload, sourceId);
    const regularValidation = engine.validateDocument(regular);
    if (regularValidation.ok) return [regular];
    const onlyOversized = regularValidation.errors.length === 1 && regularValidation.errors[0] === 'Documento excede el límite seguro de 900 KB';
    if (!onlyOversized) throw new Error('configuracion/' + entityId + ': ' + regularValidation.errors.join(', '));

    const serialized = JSON.stringify(regular.payload);
    const chunks = splitUtf8(serialized, CONFIG_CHUNK_MAX_BYTES);
    const fullChecksum = checksum(serialized);
    const manifest = {
      chunked:true,
      chunkSchemaVersion:1,
      encoding:'json-utf8',
      checksum:fullChecksum,
      bytes:byteLength(serialized),
      chunkCount:chunks.length,
      recordPrefix:recordId + '_chunk_'
    };
    const records = [makeRecord(engine, context, 'configuracion', entityId, recordId, manifest, sourceId)];
    chunks.forEach(function(content, index){
      const chunkId = recordId + '_chunk_' + String(index + 1).padStart(4, '0');
      records.push(makeRecord(engine, context, 'configuracion', entityId, chunkId, {
        chunkedPart:true,
        parentRecordId:recordId,
        index:index,
        total:chunks.length,
        encoding:'json-utf8',
        checksum:fullChecksum,
        bytes:byteLength(content),
        content:content
      }, sourceId + ':' + chunkId));
    });
    return records;
  }

  function addConfig(plan, engine, context, local){
    Object.keys(CONFIG_KEYS).forEach(function(entityId){
      const matches = findLocal(local, CONFIG_KEYS[entityId]);
      if (!matches.length) return;
      const payload = matches.length === 1
        ? { storageKey:matches[0].key, value:matches[0].value }
        : { values:matches.reduce(function(out, item){ out[item.key] = item.value; return out; }, {}) };
      const sourceId = matches.map(function(item){ return item.key; }).join(',');
      makeConfigRecords(engine, context, entityId, 'actual', payload, sourceId).forEach(function(document){ plan.push(document); });
    });
  }

  function addCatalogs(plan, engine, context, backup){
    const indexed = backup.data.indexedDB && backup.data.indexedDB['a33-pos'];
    const db = indexed && typeof indexed === 'object' ? indexed : {};
    Object.keys(CATALOG_STORES).forEach(function(entityId){
      const store = CATALOG_STORES[entityId];
      asRecords(db[store]).forEach(function(item, index){
        const id = stableId(item, entityId, index);
        plan.push(makeRecord(engine, context, 'catalogos', entityId, id, item, store + ':' + id));
      });
    });
    Object.keys(CATALOG_KEYS).forEach(function(entityId){
      if (entityId === 'clientes' && asRecords(db.customers).length) return;
      findLocal(backup.data.localStorage, CATALOG_KEYS[entityId]).forEach(function(match){
        asRecords(match.value).forEach(function(item, index){
          const id = stableId(item, entityId, index);
          plan.push(makeRecord(engine, context, 'catalogos', entityId, id, item, match.key + ':' + id));
        });
      });
    });
  }

  function addLots(plan, engine, context, local){
    const lotMatches = findLocal(local, ['arcano33_lotes']);
    lotMatches.forEach(function(match){
      asRecords(match.value).forEach(function(lot, index){
        const lotId = stableId(lot, 'lote', index);
        plan.push(makeRecord(engine, context, 'lotes', 'lotes', lotId, lot, match.key + ':' + lotId));
        const products = lot && (lot.productos || lot.products || lot.productosProducidos || lot.producedProducts);
        asRecords(products).forEach(function(product, productIndex){
          const productId = lotId + '_' + stableId(product, 'producto', productIndex);
          plan.push(makeRecord(engine, context, 'lotes', 'productos_lote', productId, {
            loteId:lotId,
            producto:product
          }, match.key + ':' + productId));
        });
      });
    });
    const compatibility = findLocal(local, ['arcano33_calc_ultimo_consecutivo', 'arcano33_calc_consecutivo_actual']);
    if (compatibility.length){
      const values = compatibility.reduce(function(out, item){ out[item.key] = item.value; return out; }, {});
      plan.push(makeRecord(engine, context, 'lotes', 'historico', 'compatibilidad', { values:values }, 'compatibilidad-historica'));
    }
  }

  function buildPlan(backup, options){
    if (!backup || !backup.data || typeof backup.data !== 'object') throw new Error('El respaldo preparado no tiene una sección data válida.');
    if (!backup.data.localStorage || !backup.data.indexedDB) throw new Error('El respaldo preparado está incompleto.');
    const engine = g.A33FirestoreData;
    if (!engine || typeof engine.createDocument !== 'function') throw new Error('No está disponible el contrato Firestore.');
    const context = Object.assign({ workspaceId:'arcano33', uid:'', deviceId:'device' }, options || {});
    const plan = [];
    addConfig(plan, engine, context, backup.data.localStorage);
    addCatalogs(plan, engine, context, backup);
    addLots(plan, engine, context, backup.data.localStorage);
    return plan;
  }

  async function readStaged(db, workspaceId, last){
    if (!last || !last.importId) throw new Error('No hay una carga E4 preparada en este navegador.');
    const root = db.collection('workspaces').doc(workspaceId).collection('imports').doc(clean(last.importId, 180));
    const manifestSnapshot = await root.get();
    if (!manifestSnapshot || !manifestSnapshot.exists) throw new Error('No se encontró la carga E4 en Firestore.');
    const manifest = manifestSnapshot.data();
    if (!manifest || manifest.status !== 'staged' || manifest.applied !== false || manifest.sanitized !== true) throw new Error('La carga E4 no está en estado staged seguro.');
    if (manifest.workspaceId !== workspaceId || manifest.importId !== last.importId) throw new Error('La carga E4 pertenece a otro workspace.');
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
    return { root:root, manifest:manifest, backup:backup };
  }

  function moduleCounts(plan){
    return MODULE_IDS.reduce(function(out, moduleId){
      out[moduleId] = plan.filter(function(item){ return item.moduleId === moduleId; }).length;
      return out;
    }, {});
  }

  async function writePlan(db, staged, plan, context){
    for (let offset = 0; offset < plan.length; offset += BATCH_LIMIT){
      const current = plan.slice(offset, offset + BATCH_LIMIT);
      const batch = db.batch();
      current.forEach(function(document){ batch.set(db.doc(document.path), document, { merge:true }); });
      await batch.commit();
      try{
        if (g.dispatchEvent && typeof g.CustomEvent === 'function') g.dispatchEvent(new CustomEvent('a33:e5-progress', {
          detail:{ processed:Math.min(offset + BATCH_LIMIT, plan.length), total:plan.length }
        }));
      }catch(_){ }
    }
    const counts = moduleCounts(plan);
    const now = new Date().toISOString();
    const result = {
      schemaVersion:1,
      stage:'E5',
      workspaceId:context.workspaceId,
      importId:staged.manifest.importId,
      sourceChecksum:staged.manifest.checksum,
      status:'completed',
      modules:MODULE_IDS.slice(),
      counts:counts,
      recordCount:plan.length,
      completedAt:now,
      completedBy:context.uid
    };
    await staged.root.collection('applications').doc('e5').set(result, { merge:true });
    try{ localStorage.setItem(RESULT_KEY, JSON.stringify(result)); }catch(_){ }
    return result;
  }

  async function apply(){
    const settings = g.A33FirebaseSettings && g.A33FirebaseSettings.read ? g.A33FirebaseSettings.read() : null;
    if (!settings || !settings.enabled || !settings.configured) throw new Error('Firebase debe estar activado y configurado.');
    const session = requireAdmin();
    if (!g.A33Firebase || typeof g.A33Firebase.initFirebaseApp !== 'function') throw new Error('No está disponible el motor Firebase.');
    if (!g.A33FirebaseImport || typeof g.A33FirebaseImport.readLast !== 'function') throw new Error('No está disponible la carga E4.');
    const app = await g.A33Firebase.initFirebaseApp(settings);
    await loadScript();
    const db = g.firebase.firestore(app);
    const workspaceId = clean(settings.workspaceId || session.access.workspaceId, 80) || 'arcano33';
    const deviceId = clean(settings.deviceId, 180) || 'device';
    const staged = await readStaged(db, workspaceId, g.A33FirebaseImport.readLast());
    const plan = buildPlan(staged.backup, { workspaceId:workspaceId, uid:session.user.uid, deviceId:deviceId });
    if (!plan.length) throw new Error('El respaldo E4 no contiene datos aplicables en Configuración, Catálogos o Lotes.');
    return writePlan(db, staged, plan, { workspaceId:workspaceId, uid:session.user.uid });
  }

  function readLast(){
    try{ const raw = localStorage.getItem(RESULT_KEY); return raw ? JSON.parse(raw) : null; }catch(_){ return null; }
  }

  g.A33FirebaseApplyE5 = Object.freeze({
    modules:MODULE_IDS,
    buildPlan:buildPlan,
    apply:apply,
    readLast:readLast,
    checksum:checksum,
    splitUtf8:splitUtf8
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
