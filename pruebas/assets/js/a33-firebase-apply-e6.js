/* Suite A33 — aplicación intermedia segura: Inventario, Pedidos y Agenda (E6). */
(function(g){
  'use strict';

  const SDK_VERSION = '10.12.5';
  const SCRIPT_ID = 'a33-firebase-sdk-firestore-compat';
  const SCRIPT_URL = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/firebase-firestore-compat.js';
  const RESULT_KEY = 'suite_a33_firebase_apply_e6_v1';
  const BATCH_LIMIT = 200;
  const MODULE_IDS = Object.freeze(['inventario', 'pedidos', 'agenda']);

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
    if (!access || !access.isAdmin || !access.profile || access.profile.status !== 'active') throw new Error('E6 requiere un perfil Admin activo.');
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

  function exactLocal(local, key){
    const source = local && typeof local === 'object' ? local : {};
    return Object.prototype.hasOwnProperty.call(source, key) ? parseStored(source[key]) : null;
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
    const candidate = source.id || source.uid || source.code || source.codigo || source.orderId || source.recordId ||
      source.productId || source.materialId || source.clientId || source.customerId || source._sourceKey;
    if (candidate) return clean(candidate, 180);
    return (prefix || 'registro') + '_' + checksum(JSON.stringify(value) + ':' + String(index));
  }

  function makeRecord(engine, context, moduleId, entityId, recordId, payload, sourceId){
    const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? clone(payload) : { value:clone(payload) };
    const document = engine.createDocument({
      workspaceId:context.workspaceId,
      moduleId:moduleId,
      entityId:entityId,
      recordId:recordId,
      sourceId:sourceId || recordId,
      updatedBy:context.uid,
      deviceId:context.deviceId,
      payload:body
    });
    const validation = engine.validateDocument(document);
    if (!validation.ok) throw new Error(moduleId + '/' + entityId + ': ' + validation.errors.join(', '));
    return document;
  }

  function addInventory(plan, engine, context, local){
    const inventory = exactLocal(local, 'arcano33_inventario');
    if (inventory && typeof inventory === 'object'){
      ['liquids', 'bottles', 'finished', 'finishedByProductId', 'caps'].forEach(function(section){
        const rows = inventory[section] && typeof inventory[section] === 'object' ? inventory[section] : {};
        Object.keys(rows).sort().forEach(function(key, index){
          const item = rows[key];
          const id = section + '_' + stableId(Object.assign({ _sourceKey:key }, item && typeof item === 'object' ? item : { value:item }), 'existencia', index);
          plan.push(makeRecord(engine, context, 'inventario', 'existencias', id, { section:section, key:key, item:item }, 'arcano33_inventario:' + section + ':' + key));
        });
      });
      asRecords(inventory.varios).forEach(function(item, index){
        const id = 'varios_' + stableId(item, 'existencia', index);
        plan.push(makeRecord(engine, context, 'inventario', 'existencias', id, { section:'varios', item:item }, 'arcano33_inventario:varios:' + id));
      });
      asRecords(inventory.movimientos).forEach(function(item, index){
        const id = stableId(item, 'movimiento', index);
        plan.push(makeRecord(engine, context, 'inventario', 'movimientos', id, item, 'arcano33_inventario:movimientos:' + id));
      });
    }
    const recipes = exactLocal(local, 'arcano33_recetas_v1');
    if (recipes != null){
      plan.push(makeRecord(engine, context, 'inventario', 'recetas', 'actual', { storageKey:'arcano33_recetas_v1', value:recipes }, 'arcano33_recetas_v1'));
    }
    const production = findLocal(local, ['arcano33_lote_actual', 'arcano33_fecha_produccion', 'arcano33_notas_lote', 'arcano33_calc_', 'a33_calc_hebrew']);
    if (production.length){
      const values = production.reduce(function(out, item){ out[item.key] = item.value; return out; }, {});
      plan.push(makeRecord(engine, context, 'inventario', 'calculadora_produccion', 'actual', { values:values }, production.map(function(item){ return item.key; }).join(',')));
    }
  }

  function addOrders(plan, engine, context, local){
    [
      { key:'arcano33_pedidos', entity:'pedidos', prefix:'pedido' },
      { key:'arcano33_pedidos_rapidos_v1', entity:'pedidos_rapidos', prefix:'pedido_rapido' },
      { key:'arcano33_pedidos_archived', entity:'historico', prefix:'pedido_historico' }
    ].forEach(function(spec){
      asRecords(exactLocal(local, spec.key)).forEach(function(item, index){
        const id = stableId(item, spec.prefix, index);
        plan.push(makeRecord(engine, context, 'pedidos', spec.entity, id, item, spec.key + ':' + id));
      });
    });
  }

  function addAgenda(plan, engine, context, local){
    const agenda = exactLocal(local, 'a33_agenda_records_v1');
    asRecords(agenda).forEach(function(item, index){
      const type = clean(item && item.type, 30).toLowerCase();
      const entity = type === 'reunion' ? 'reuniones' : (type === 'compra' ? 'compras' : 'tareas');
      const id = stableId(item, type || 'agenda', index);
      plan.push(makeRecord(engine, context, 'agenda', entity, id, item, 'a33_agenda_records_v1:' + id));
    });
  }

  function buildPlan(backup, options){
    if (!backup || !backup.data || typeof backup.data !== 'object') throw new Error('El respaldo preparado no tiene una sección data válida.');
    if (!backup.data.localStorage || !backup.data.indexedDB) throw new Error('El respaldo preparado está incompleto.');
    const engine = g.A33FirestoreData;
    if (!engine || typeof engine.createDocument !== 'function') throw new Error('No está disponible el contrato Firestore.');
    const context = Object.assign({ workspaceId:'arcano33', uid:'', deviceId:'device' }, options || {});
    const plan = [];
    addInventory(plan, engine, context, backup.data.localStorage);
    addOrders(plan, engine, context, backup.data.localStorage);
    addAgenda(plan, engine, context, backup.data.localStorage);
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
    const e5Snapshot = await root.collection('applications').doc('e5').get();
    const e5 = e5Snapshot && e5Snapshot.exists ? e5Snapshot.data() : null;
    if (!e5 || e5.status !== 'completed' || e5.sourceChecksum !== manifest.checksum) throw new Error('Primero debe completarse E5 para esta misma carga E4.');
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
        if (g.dispatchEvent && typeof g.CustomEvent === 'function') g.dispatchEvent(new CustomEvent('a33:e6-progress', {
          detail:{ processed:Math.min(offset + BATCH_LIMIT, plan.length), total:plan.length }
        }));
      }catch(_){ }
    }
    const result = {
      schemaVersion:1,
      stage:'E6',
      workspaceId:context.workspaceId,
      importId:staged.manifest.importId,
      sourceChecksum:staged.manifest.checksum,
      status:'completed',
      modules:MODULE_IDS.slice(),
      counts:moduleCounts(plan),
      recordCount:plan.length,
      completedAt:new Date().toISOString(),
      completedBy:context.uid
    };
    await staged.root.collection('applications').doc('e6').set(result, { merge:true });
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
    if (!plan.length) throw new Error('El respaldo E4 no contiene datos aplicables en Inventario, Pedidos o Agenda.');
    return writePlan(db, staged, plan, { workspaceId:workspaceId, uid:session.user.uid });
  }

  function readLast(){
    try{ const raw = localStorage.getItem(RESULT_KEY); return raw ? JSON.parse(raw) : null; }catch(_){ return null; }
  }

  g.A33FirebaseApplyE6 = Object.freeze({
    modules:MODULE_IDS,
    buildPlan:buildPlan,
    apply:apply,
    readLast:readLast,
    checksum:checksum
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
