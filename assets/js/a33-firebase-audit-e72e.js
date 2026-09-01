/* Suite A33 — auditoría posterior del bloque crítico (E7.2E, solo lectura). */
(function(g){
  'use strict';

  const RESULT_KEY = 'suite_a33_firebase_audit_e72e_v1';
  const READ_GROUP_SIZE = 20;

  function clean(value, maxLen){
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen || 320);
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

  function stableValue(value){
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object'){
      return Object.keys(value).sort().reduce(function(out, key){ out[key] = stableValue(value[key]); return out; }, {});
    }
    return value;
  }

  function errorCode(error){
    const raw = String(error && (error.code || error.name) || 'lectura_remota_fallida').toLowerCase();
    return raw.replace(/^firestore\//, '').replace(/[^a-z0-9_-]/g, '_').slice(0, 80) || 'lectura_remota_fallida';
  }

  function requireAdmin(){
    const auth = g.A33FirebaseAuth && g.A33FirebaseAuth.getState ? g.A33FirebaseAuth.getState() : null;
    const access = g.A33Access && g.A33Access.getState ? g.A33Access.getState() : null;
    if (!auth || !auth.authenticated || !auth.user || !auth.user.uid) throw new Error('Iniciá sesión con el usuario maestro.');
    if (!access || !access.isAdmin || !access.profile || access.profile.status !== 'active') throw new Error('E7.2E requiere un perfil Admin activo.');
    return { user:auth.user, access:access };
  }

  function validateCheckpoint(checkpoint, plan, validation, simulation){
    if (!checkpoint || checkpoint.stage !== 'E7.2D' || checkpoint.status !== 'completed') throw new Error('No existe un checkpoint E7.2D completo.');
    if (checkpoint.workspaceId !== plan.workspaceId || checkpoint.importId !== plan.importId || checkpoint.sourceChecksum !== plan.sourceChecksum || checkpoint.planChecksum !== plan.planChecksum || checkpoint.validationChecksum !== validation.validationChecksum || checkpoint.simulationChecksum !== simulation.simulationChecksum) throw new Error('El checkpoint E7.2D no corresponde al plan aprobado.');
    if (checkpoint.completedBatches !== checkpoint.totalBatches || checkpoint.appliedCount !== checkpoint.recordCount) throw new Error('El checkpoint E7.2D no confirma todos los lotes.');
    return checkpoint;
  }

  async function auditPlan(checkpoint, plan, validation, simulation, backup, readDocument){
    const analyzer = g.A33FirebaseAnalyzeE7;
    const contract = g.A33FirestoreData;
    const simulator = g.A33FirebaseSimulateE72C;
    if (!analyzer || typeof analyzer.listCriticalSources !== 'function') throw new Error('No está disponible el diagnóstico E7.1 compatible.');
    if (!contract || typeof contract.recordPath !== 'function') throw new Error('No está disponible el contrato canónico de Firestore.');
    if (!simulator || typeof simulator.payloadFor !== 'function') throw new Error('No está disponible la simulación E7.2C compatible.');
    if (typeof readDocument !== 'function') throw new Error('No está disponible el lector remoto de Firestore.');
    validateCheckpoint(checkpoint, plan, validation, simulation);

    const sourceMap = Object.create(null);
    analyzer.listCriticalSources(backup).forEach(function(source){ sourceMap[source.sourceId] = source; });
    const operations = Array.isArray(plan.operations) ? plan.operations : [];
    const outcomes = Array.isArray(simulation.outcomes) ? simulation.outcomes : [];
    const expected = [];
    operations.forEach(function(operation, index){
      const outcome = outcomes[index];
      if (!outcome || outcome.order !== index) throw new Error('E7.2C no coincide con la operación ' + (index + 1) + '.');
      if (outcome.status === 'identical') return;
      if (outcome.status !== 'new') throw new Error('E7.2C contiene una operación no aprobada.');
      const source = sourceMap[operation.sourceId];
      const record = source && Array.isArray(source.records) ? source.records[operation.sourceIndex] : undefined;
      if (record === undefined) throw new Error('No se encontró el origen de la operación ' + (index + 1) + '.');
      expected.push({
        order:index,
        moduleId:operation.moduleId,
        entityId:operation.entityId,
        recordId:operation.recordId,
        path:contract.recordPath(plan.workspaceId, operation.moduleId, operation.entityId, operation.recordId),
        expectedChecksum:checksum(JSON.stringify(stableValue(simulator.payloadFor(record))))
      });
    });
    if (expected.length !== checkpoint.recordCount) throw new Error('El checkpoint E7.2D no coincide con la cantidad esperada.');

    const inspected = new Array(expected.length);
    async function inspect(item, index){
      try{
        const remote = await readDocument(item.path);
        if (!remote || remote.exists !== true) return Object.assign({}, item, { status:'missing' });
        const data = remote.data && typeof remote.data === 'object' ? remote.data : {};
        const contractOk = data.contractVersion === 1 && data.schemaVersion === 1 && data.workspaceId === plan.workspaceId && data.moduleId === item.moduleId && data.entityId === item.entityId && data.recordId === item.recordId && data.deleted === false && data.rev === 1;
        const remoteChecksum = checksum(JSON.stringify(stableValue(data.payload && typeof data.payload === 'object' ? data.payload : {})));
        return Object.assign({}, item, {
          status:contractOk && remoteChecksum === item.expectedChecksum ? 'verified' : (contractOk ? 'different' : 'invalid_contract'),
          remoteChecksum:remoteChecksum
        });
      }catch(error){
        return Object.assign({}, item, { status:'error', error:errorCode(error) });
      }
    }
    for (let start = 0; start < expected.length; start += READ_GROUP_SIZE){
      const group = expected.slice(start, start + READ_GROUP_SIZE);
      const results = await Promise.all(group.map(function(item, offset){ return inspect(item, start + offset); }));
      results.forEach(function(item, offset){ inspected[start + offset] = item; });
    }
    const count = function(status){ return inspected.filter(function(item){ return item && item.status === status; }).length; };
    const verifiedCount = count('verified');
    const missingCount = count('missing');
    const differentCount = count('different');
    const invalidContractCount = count('invalid_contract');
    const errorCount = count('error');
    const ready = verifiedCount === expected.length && !missingCount && !differentCount && !invalidContractCount && !errorCount;
    const result = {
      schemaVersion:1,
      stage:'E7.2E',
      status:ready ? 'verified' : 'blocked',
      readOnly:true,
      workspaceId:plan.workspaceId,
      importId:plan.importId,
      sourceChecksum:plan.sourceChecksum,
      planChecksum:plan.planChecksum,
      validationChecksum:validation.validationChecksum,
      simulationChecksum:simulation.simulationChecksum,
      checkpointBatches:checkpoint.completedBatches,
      checkpointCount:checkpoint.appliedCount,
      expectedCount:expected.length,
      readCount:inspected.length,
      verifiedCount:verifiedCount,
      missingCount:missingCount,
      differentCount:differentCount,
      invalidContractCount:invalidContractCount,
      errorCount:errorCount,
      readyForE72F:ready,
      auditedAt:new Date().toISOString(),
      outcomes:inspected
    };
    result.auditChecksum = checksum(JSON.stringify({ checkpoint:checkpoint.lastBatchChecksum, plan:result.planChecksum, outcomes:inspected.map(function(item){ return { path:item.path, status:item.status, expectedChecksum:item.expectedChecksum, remoteChecksum:item.remoteChecksum || '' }; }) }));
    return result;
  }

  async function audit(){
    const settings = g.A33FirebaseSettings && g.A33FirebaseSettings.read ? g.A33FirebaseSettings.read() : null;
    if (!settings || !settings.enabled || !settings.configured) throw new Error('Firebase debe estar activado y configurado.');
    const session = requireAdmin();
    const planner = g.A33FirebasePlanE72A;
    const validator = g.A33FirebaseValidateE72B;
    const simulator = g.A33FirebaseSimulateE72C;
    const analyzer = g.A33FirebaseAnalyzeE7;
    const plan = planner && planner.readLast ? planner.readLast() : null;
    const validation = validator && validator.readLast ? validator.readLast() : null;
    const simulation = simulator && simulator.readLast ? simulator.readLast() : null;
    if (!plan || !validation || !simulation) throw new Error('Faltan E7.2A, E7.2B.2 o E7.2C confirmadas.');
    if (!g.A33Firebase || typeof g.A33Firebase.initFirebaseApp !== 'function') throw new Error('No está disponible el motor Firebase.');
    if (!g.A33FirebaseImport || typeof g.A33FirebaseImport.readLast !== 'function') throw new Error('No está disponible la carga E4.');
    const last = g.A33FirebaseImport.readLast();
    if (!last || last.importId !== plan.importId || last.checksum !== plan.sourceChecksum) throw new Error('El plan E7.2A no corresponde a la carga E4 actual.');
    const app = await g.A33Firebase.initFirebaseApp(settings);
    if (typeof analyzer.ensureFirestore === 'function') await analyzer.ensureFirestore();
    const db = g.firebase.firestore(app);
    const workspaceId = clean(settings.workspaceId || session.access.workspaceId, 80) || 'arcano33';
    const staged = await analyzer.readStaged(db, workspaceId, last);
    const applicationRef = db.collection('workspaces').doc(workspaceId).collection('imports').doc(clean(last.importId, 180)).collection('applications').doc('e72d');
    const checkpointSnapshot = await applicationRef.get();
    const checkpoint = checkpointSnapshot && checkpointSnapshot.exists ? checkpointSnapshot.data() : null;
    const result = await auditPlan(checkpoint, plan, validation, simulation, staged.backup, async function(path){
      const snapshot = await db.doc(path).get();
      return { exists:snapshot.exists === true, data:snapshot.exists ? snapshot.data() : null };
    });
    try{ localStorage.setItem(RESULT_KEY, JSON.stringify(result)); }catch(_){ throw new Error('No se pudo guardar la auditoría local E7.2E.'); }
    return result;
  }

  function readLast(){
    try{ const raw = localStorage.getItem(RESULT_KEY); return raw ? JSON.parse(raw) : null; }catch(_){ return null; }
  }

  g.A33FirebaseAuditE72E = Object.freeze({ readGroupSize:READ_GROUP_SIZE, validateCheckpoint:validateCheckpoint, auditPlan:auditPlan, audit:audit, readLast:readLast });
})(typeof globalThis !== 'undefined' ? globalThis : window);
