/* Suite A33 — aplicación crítica reanudable (E7.2D, creación exclusiva). */
(function(g){
  'use strict';

  const RESULT_KEY = 'suite_a33_firebase_apply_e72d_v1';
  const BATCH_LIMIT = 200;
  const MODULE_IDS = Object.freeze(['pos', 'finanzas']);

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

  function requireAdmin(){
    const auth = g.A33FirebaseAuth && g.A33FirebaseAuth.getState ? g.A33FirebaseAuth.getState() : null;
    const access = g.A33Access && g.A33Access.getState ? g.A33Access.getState() : null;
    if (!auth || !auth.authenticated || !auth.user || !auth.user.uid) throw new Error('Iniciá sesión con el usuario maestro.');
    if (!access || !access.isAdmin || !access.profile || access.profile.status !== 'active') throw new Error('E7.2D requiere un perfil Admin activo.');
    return { user:auth.user, access:access };
  }

  function buildPlan(plan, validation, simulation, backup, options){
    const analyzer = g.A33FirebaseAnalyzeE7;
    const contract = g.A33FirestoreData;
    const simulator = g.A33FirebaseSimulateE72C;
    if (!analyzer || typeof analyzer.listCriticalSources !== 'function') throw new Error('No está disponible el diagnóstico E7.1 compatible.');
    if (!contract || typeof contract.createDocument !== 'function') throw new Error('No está disponible el contrato canónico de Firestore.');
    if (!simulator || typeof simulator.payloadFor !== 'function') throw new Error('No está disponible la simulación E7.2C compatible.');
    if (!plan || plan.stage !== 'E7.2A' || plan.status !== 'planned') throw new Error('No existe un plan E7.2A válido.');
    if (!validation || validation.stage !== 'E7.2B.2' || validation.readyForE72C !== true || validation.planChecksum !== plan.planChecksum) throw new Error('E7.2B.2 no corresponde al plan actual.');
    if (!simulation || simulation.stage !== 'E7.2C' || simulation.readyForE72D !== true || simulation.planChecksum !== plan.planChecksum || simulation.validationChecksum !== validation.validationChecksum) throw new Error('E7.2C no está confirmada para este plan.');
    const context = Object.assign({ workspaceId:'arcano33', uid:'', deviceId:'device' }, options || {});
    const sourceMap = Object.create(null);
    analyzer.listCriticalSources(backup).forEach(function(source){ sourceMap[source.sourceId] = source; });
    const outcomes = Array.isArray(simulation.outcomes) ? simulation.outcomes : [];
    const documents = [];
    (Array.isArray(plan.operations) ? plan.operations : []).forEach(function(operation, index){
      const outcome = outcomes[index];
      if (!outcome || outcome.order !== index || outcome.path !== contract.recordPath(plan.workspaceId, operation.moduleId, operation.entityId, operation.recordId)) throw new Error('La simulación E7.2C no coincide con la operación ' + (index + 1) + '.');
      if (outcome.status === 'identical') return;
      if (outcome.status !== 'new') throw new Error('La operación ' + (index + 1) + ' ya no está clasificada como nueva.');
      const source = sourceMap[operation.sourceId];
      const record = source && Array.isArray(source.records) ? source.records[operation.sourceIndex] : undefined;
      if (record === undefined) throw new Error('No se encontró el origen de la operación ' + (index + 1) + '.');
      const document = contract.createDocument({
        workspaceId:context.workspaceId,
        moduleId:operation.moduleId,
        entityId:operation.entityId,
        recordId:operation.recordId,
        sourceId:operation.sourceId + ':' + operation.sourceIndex,
        updatedBy:context.uid,
        deviceId:context.deviceId,
        payload:simulator.payloadFor(record)
      });
      const checked = contract.validateDocument(document);
      if (!checked.ok) throw new Error(operation.moduleId + '/' + operation.entityId + ': ' + checked.errors.join(', '));
      documents.push({ order:index, document:document, payloadChecksum:operation.payloadChecksum });
    });
    const batches = [];
    for (let start = 0; start < documents.length; start += BATCH_LIMIT){
      const items = documents.slice(start, start + BATCH_LIMIT);
      batches.push({
        index:batches.length,
        items:items,
        checksum:checksum(JSON.stringify(items.map(function(item){ return { order:item.order, path:item.document.path, payloadChecksum:item.payloadChecksum }; })))
      });
    }
    return {
      schemaVersion:1,
      stage:'E7.2D',
      strategy:'create-only',
      workspaceId:context.workspaceId,
      importId:plan.importId,
      sourceChecksum:plan.sourceChecksum,
      planChecksum:plan.planChecksum,
      validationChecksum:validation.validationChecksum,
      simulationChecksum:simulation.simulationChecksum,
      recordCount:documents.length,
      skippedIdenticalCount:(Array.isArray(plan.operations) ? plan.operations.length : 0) - documents.length,
      batchCount:batches.length,
      batches:batches
    };
  }

  function validateCheckpoint(checkpoint, execution){
    if (!checkpoint) return { completedBatches:0, appliedCount:0, status:'pending' };
    if (checkpoint.stage !== 'E7.2D' || checkpoint.workspaceId !== execution.workspaceId || checkpoint.importId !== execution.importId || checkpoint.sourceChecksum !== execution.sourceChecksum || checkpoint.planChecksum !== execution.planChecksum || checkpoint.validationChecksum !== execution.validationChecksum || checkpoint.simulationChecksum !== execution.simulationChecksum || checkpoint.totalBatches !== execution.batchCount || checkpoint.recordCount !== execution.recordCount) throw new Error('El checkpoint remoto E7.2D pertenece a otra ejecución.');
    const completedBatches = Math.max(0, Number(checkpoint.completedBatches || 0) || 0);
    const appliedCount = Math.max(0, Number(checkpoint.appliedCount || 0) || 0);
    if (completedBatches > execution.batchCount || appliedCount > execution.recordCount) throw new Error('El checkpoint remoto E7.2D es inválido.');
    return { completedBatches:completedBatches, appliedCount:appliedCount, status:checkpoint.status };
  }

  async function writePlan(db, applicationRef, execution, context){
    const checkpointSnapshot = await applicationRef.get();
    const checkpoint = validateCheckpoint(checkpointSnapshot && checkpointSnapshot.exists ? checkpointSnapshot.data() : null, execution);
    if (checkpoint.status === 'completed') return checkpointSnapshot.data();
    for (let index = checkpoint.completedBatches; index < execution.batches.length; index += 1){
      const current = execution.batches[index];
      const batch = db.batch();
      current.items.forEach(function(item){ batch.set(db.doc(item.document.path), item.document); });
      const appliedCount = execution.batches.slice(0, index + 1).reduce(function(total, item){ return total + item.items.length; }, 0);
      const completed = index + 1 === execution.batches.length;
      const result = {
        schemaVersion:1,
        stage:'E7.2D',
        strategy:'create-only',
        workspaceId:execution.workspaceId,
        importId:execution.importId,
        sourceChecksum:execution.sourceChecksum,
        planChecksum:execution.planChecksum,
        validationChecksum:execution.validationChecksum,
        simulationChecksum:execution.simulationChecksum,
        status:completed ? 'completed' : 'running',
        totalBatches:execution.batchCount,
        completedBatches:index + 1,
        recordCount:execution.recordCount,
        appliedCount:appliedCount,
        skippedIdenticalCount:execution.skippedIdenticalCount,
        lastBatchChecksum:current.checksum,
        completedAt:completed ? new Date().toISOString() : '',
        updatedAt:new Date().toISOString(),
        completedBy:context.uid
      };
      batch.set(applicationRef, result, { merge:true });
      await batch.commit();
      try{
        if (g.dispatchEvent && typeof g.CustomEvent === 'function') g.dispatchEvent(new CustomEvent('a33:e72d-progress', { detail:{ processed:appliedCount, total:execution.recordCount } }));
      }catch(_){ }
      if (completed){
        try{ localStorage.setItem(RESULT_KEY, JSON.stringify(result)); }catch(_){ }
        return result;
      }
    }
    throw new Error('E7.2D no encontró lotes pendientes ni un resultado completo.');
  }

  async function apply(){
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
    const execution = buildPlan(plan, validation, simulation, staged.backup, { workspaceId:workspaceId, uid:session.user.uid, deviceId:clean(settings.deviceId, 180) || 'device' });
    if (!execution.recordCount || !execution.batchCount) throw new Error('E7.2D no encontró destinos nuevos para crear.');
    const applicationRef = db.collection('workspaces').doc(workspaceId).collection('imports').doc(clean(last.importId, 180)).collection('applications').doc('e72d');
    return writePlan(db, applicationRef, execution, { uid:session.user.uid });
  }

  function readLast(){
    try{ const raw = localStorage.getItem(RESULT_KEY); return raw ? JSON.parse(raw) : null; }catch(_){ return null; }
  }

  g.A33FirebaseApplyE72D = Object.freeze({ batchLimit:BATCH_LIMIT, modules:MODULE_IDS, buildPlan:buildPlan, validateCheckpoint:validateCheckpoint, writePlan:writePlan, apply:apply, readLast:readLast });
})(typeof globalThis !== 'undefined' ? globalThis : window);
