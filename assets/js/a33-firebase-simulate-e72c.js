/* Suite A33 — simulación remota del bloque crítico (E7.2C, solo lectura). */
(function(g){
  'use strict';

  const RESULT_KEY = 'suite_a33_firebase_simulate_e72c_v1';
  const READ_GROUP_SIZE = 20;

  function checksum(text){
    let hash = 2166136261;
    const value = String(text || '');
    for (let index = 0; index < value.length; index += 1){
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function stableValue(value){
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object'){
      return Object.keys(value).sort().reduce(function(out, key){ out[key] = stableValue(value[key]); return out; }, {});
    }
    return value;
  }

  function payloadFor(record){
    const cloned = JSON.parse(JSON.stringify(record == null ? null : record));
    return cloned && typeof cloned === 'object' && !Array.isArray(cloned) ? cloned : { value:cloned };
  }

  function errorCode(error){
    const raw = String(error && (error.code || error.name) || 'lectura_remota_fallida').toLowerCase();
    return raw.replace(/^firestore\//, '').replace(/[^a-z0-9_-]/g, '_').slice(0, 80) || 'lectura_remota_fallida';
  }

  async function simulatePlan(plan, validation, backup, readDocument){
    const analyzer = g.A33FirebaseAnalyzeE7;
    const contract = g.A33FirestoreData;
    if (!analyzer || typeof analyzer.listCriticalSources !== 'function') throw new Error('No está disponible el diagnóstico E7.1 compatible.');
    if (!contract || typeof contract.recordPath !== 'function') throw new Error('No está disponible el contrato canónico de Firestore.');
    if (!plan || plan.stage !== 'E7.2A' || plan.status !== 'planned') throw new Error('No existe un plan E7.2A válido.');
    if (!validation || validation.stage !== 'E7.2B.2' || validation.readyForE72C !== true || validation.planChecksum !== plan.planChecksum) throw new Error('E7.2B.2 no está confirmada para este plan.');
    if (typeof readDocument !== 'function') throw new Error('No está disponible el lector remoto de Firestore.');

    const sourceMap = Object.create(null);
    analyzer.listCriticalSources(backup).forEach(function(source){ sourceMap[source.sourceId] = source; });
    const operations = Array.isArray(plan.operations) ? plan.operations : [];
    const outcomes = new Array(operations.length);

    async function inspect(operation, index){
      const source = sourceMap[operation.sourceId];
      const record = source && Array.isArray(source.records) ? source.records[operation.sourceIndex] : undefined;
      const path = contract.recordPath(plan.workspaceId, operation.moduleId, operation.entityId, operation.recordId);
      if (record === undefined) return { order:index, path:path, status:'error', error:'origen_no_disponible' };
      const expectedChecksum = checksum(JSON.stringify(stableValue(payloadFor(record))));
      try{
        const remote = await readDocument(path);
        if (!remote || remote.exists !== true) return { order:index, path:path, status:'new', expectedChecksum:expectedChecksum };
        const data = remote.data && typeof remote.data === 'object' ? remote.data : {};
        const remoteChecksum = checksum(JSON.stringify(stableValue(data.payload && typeof data.payload === 'object' ? data.payload : {})));
        return {
          order:index,
          path:path,
          status:remoteChecksum === expectedChecksum ? 'identical' : 'different',
          expectedChecksum:expectedChecksum,
          remoteChecksum:remoteChecksum
        };
      }catch(error){
        return { order:index, path:path, status:'error', expectedChecksum:expectedChecksum, error:errorCode(error) };
      }
    }

    for (let start = 0; start < operations.length; start += READ_GROUP_SIZE){
      const group = operations.slice(start, start + READ_GROUP_SIZE);
      const inspected = await Promise.all(group.map(function(operation, offset){ return inspect(operation, start + offset); }));
      inspected.forEach(function(outcome){ outcomes[outcome.order] = outcome; });
    }

    const count = function(status){ return outcomes.filter(function(item){ return item && item.status === status; }).length; };
    const newCount = count('new');
    const identicalCount = count('identical');
    const differentCount = count('different');
    const errorCount = count('error');
    const errorCodes = outcomes.filter(function(item){ return item && item.status === 'error'; }).reduce(function(out, item){
      const code = item.error || 'lectura_remota_fallida';
      out[code] = (out[code] || 0) + 1;
      return out;
    }, {});
    const result = {
      schemaVersion:1,
      stage:'E7.2C',
      status:differentCount || errorCount ? 'blocked' : 'ready',
      readOnly:true,
      workspaceId:plan.workspaceId,
      importId:plan.importId,
      sourceChecksum:plan.sourceChecksum,
      planChecksum:plan.planChecksum,
      validationChecksum:validation.validationChecksum,
      simulatedAt:new Date().toISOString(),
      operationCount:operations.length,
      readCount:outcomes.length,
      newCount:newCount,
      identicalCount:identicalCount,
      differentCount:differentCount,
      errorCount:errorCount,
      errorCodes:errorCodes,
      firstErrorCode:Object.keys(errorCodes).sort()[0] || '',
      readyForE72D:differentCount === 0 && errorCount === 0,
      outcomes:outcomes
    };
    result.simulationChecksum = checksum(JSON.stringify({ plan:result.planChecksum, validation:result.validationChecksum, outcomes:outcomes }));
    return result;
  }

  async function simulate(){
    const planner = g.A33FirebasePlanE72A;
    const validator = g.A33FirebaseValidateE72B;
    const analyzer = g.A33FirebaseAnalyzeE7;
    const plan = planner && planner.readLast ? planner.readLast() : null;
    const validation = validator && validator.readLast ? validator.readLast() : null;
    if (!plan || !validation) throw new Error('Primero deben existir E7.2A y E7.2B.2 confirmadas.');
    const settings = g.A33FirebaseSettings && g.A33FirebaseSettings.read ? g.A33FirebaseSettings.read() : null;
    if (!settings || !settings.enabled || !settings.configured) throw new Error('Firebase debe estar activado y configurado.');
    if (!g.A33Firebase || typeof g.A33Firebase.initFirebaseApp !== 'function') throw new Error('No está disponible el motor Firebase.');
    if (!g.A33FirebaseImport || typeof g.A33FirebaseImport.readLast !== 'function') throw new Error('No está disponible la carga E4.');
    const last = g.A33FirebaseImport.readLast();
    if (!last || last.importId !== plan.importId || last.checksum !== plan.sourceChecksum) throw new Error('El plan E7.2A no corresponde a la carga E4 actual.');
    const app = await g.A33Firebase.initFirebaseApp(settings);
    if (typeof analyzer.ensureFirestore === 'function') await analyzer.ensureFirestore();
    const db = g.firebase.firestore(app);
    const staged = await analyzer.readStaged(db, plan.workspaceId, last);
    const result = await simulatePlan(plan, validation, staged.backup, async function(path){
      const snapshot = await db.doc(path).get();
      return { exists:snapshot.exists === true, data:snapshot.exists ? snapshot.data() : null };
    });
    try{ localStorage.setItem(RESULT_KEY, JSON.stringify(result)); }catch(_){ throw new Error('No se pudo guardar la simulación local E7.2C.'); }
    return result;
  }

  function readLast(){
    try{ const raw = localStorage.getItem(RESULT_KEY); return raw ? JSON.parse(raw) : null; }catch(_){ return null; }
  }

  g.A33FirebaseSimulateE72C = Object.freeze({ readGroupSize:READ_GROUP_SIZE, payloadFor:payloadFor, simulatePlan:simulatePlan, simulate:simulate, readLast:readLast });
})(typeof globalThis !== 'undefined' ? globalThis : window);
