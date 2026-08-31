/* Suite A33 — prevalidación local del bloque crítico (E7.2B, solo lectura). */
(function(g){
  'use strict';

  const RESULT_KEY = 'suite_a33_firebase_validate_e72b_v1';
  const MAX_RECORD_BYTES = 900000;
  const ALLOWED_AREAS = Object.freeze(['pos', 'finanzas', 'caja_chica']);

  function checksum(text){
    let hash = 2166136261;
    const value = String(text || '');
    for (let index = 0; index < value.length; index += 1){
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function byteLength(value){
    const text = typeof value === 'string' ? value : JSON.stringify(value == null ? null : value);
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    return unescape(encodeURIComponent(text)).length;
  }

  function validatePlan(plan, backup){
    const analyzer = g.A33FirebaseAnalyzeE7;
    const planner = g.A33FirebasePlanE72A;
    const contract = g.A33FirestoreData;
    if (!analyzer || typeof analyzer.listCriticalSources !== 'function') throw new Error('No está disponible el diagnóstico E7.1 compatible.');
    if (!planner || typeof planner.entityFor !== 'function') throw new Error('No está disponible el plan E7.2A compatible.');
    if (!contract || typeof contract.hasEntity !== 'function') throw new Error('No está disponible el contrato canónico de Firestore.');
    if (!plan || plan.stage !== 'E7.2A' || plan.status !== 'planned' || plan.readOnly !== true) throw new Error('No existe un plan E7.2A válido.');

    const errors = [];
    const warnings = [];
    const operations = Array.isArray(plan.operations) ? plan.operations : [];
    const batches = Array.isArray(plan.batches) ? plan.batches : [];
    const sourceMap = Object.create(null);
    analyzer.listCriticalSources(backup).forEach(function(source){ sourceMap[source.sourceId] = source; });

    if (plan.strategy !== 'merge') errors.push('El plan no usa estrategia merge.');
    if (plan.operationCount !== operations.length) errors.push('El total declarado de operaciones no coincide.');
    if (plan.planChecksum !== checksum(JSON.stringify(operations))) errors.push('El checksum integral del plan no coincide.');
    if (plan.batchCount !== batches.length) errors.push('El total declarado de lotes no coincide.');
    if (!plan.batchLimit || plan.batchLimit > 200) errors.push('El límite de operaciones por lote no es seguro.');

    let expectedFrom = 0;
    batches.forEach(function(batch, index){
      const size = Math.max(0, Number(batch.operations || 0));
      const slice = operations.slice(expectedFrom, expectedFrom + size);
      if (batch.index !== index || batch.from !== expectedFrom || batch.to !== expectedFrom + size - 1) errors.push('El lote ' + (index + 1) + ' no es contiguo.');
      if (!size || size > plan.batchLimit) errors.push('El lote ' + (index + 1) + ' excede el límite seguro.');
      if (batch.checksum !== checksum(JSON.stringify(slice))) errors.push('El checksum del lote ' + (index + 1) + ' no coincide.');
      expectedFrom += size;
    });
    if (expectedFrom !== operations.length) errors.push('Los lotes no cubren todas las operaciones.');

    const targets = Object.create(null);
    let oversizedRecords = 0;
    let missingRecords = 0;
    let invalidRoutes = 0;
    let generatedIds = 0;
    operations.forEach(function(operation, index){
      if (!operation || operation.order !== index || operation.strategy !== 'merge') errors.push('La operación ' + (index + 1) + ' no conserva el orden o la estrategia segura.');
      if (!ALLOWED_AREAS.includes(operation.areaId)) errors.push('La operación ' + (index + 1) + ' apunta fuera del bloque crítico permitido.');
      const source = sourceMap[operation.sourceId];
      const record = source && Array.isArray(source.records) ? source.records[operation.sourceIndex] : undefined;
      if (record === undefined){
        missingRecords += 1;
        return;
      }
      const serialized = JSON.stringify(record == null ? null : record);
      if (operation.payloadChecksum !== checksum(serialized)) errors.push('El registro de origen cambió para la operación ' + (index + 1) + '.');
      if (byteLength(serialized) > MAX_RECORD_BYTES) oversizedRecords += 1;
      const expectedTarget = planner.entityFor(operation.areaId, operation.sourceId);
      if (!expectedTarget || expectedTarget.excluded || expectedTarget.blocked || operation.moduleId !== expectedTarget.moduleId || operation.entityId !== expectedTarget.entityId || !contract.hasEntity(operation.moduleId, operation.entityId)) invalidRoutes += 1;
      const targetKey = operation.moduleId + '/' + operation.entityId + '/' + operation.recordId;
      if (!targets[targetKey]) targets[targetKey] = [];
      targets[targetKey].push({
        order:index,
        sourceId:operation.sourceId,
        sourceIndex:operation.sourceIndex,
        payloadChecksum:operation.payloadChecksum
      });
      if (operation.generatedId) generatedIds += 1;
    });
    const duplicateGroups = Object.keys(targets).filter(function(target){ return targets[target].length > 1; }).map(function(target){
      const copies = targets[target];
      const payloadChecksums = Array.from(new Set(copies.map(function(copy){ return copy.payloadChecksum; })));
      return {
        target:target,
        kind:payloadChecksums.length === 1 ? 'identical' : 'conflict',
        copies:copies.length,
        duplicateOperations:copies.length - 1,
        sources:Array.from(new Set(copies.map(function(copy){ return copy.sourceId; }))).sort(),
        payloadChecksums:payloadChecksums.sort(),
        operations:copies
      };
    }).sort(function(left, right){ return left.target.localeCompare(right.target); });
    const identicalGroups = duplicateGroups.filter(function(group){ return group.kind === 'identical'; });
    const conflictGroups = duplicateGroups.filter(function(group){ return group.kind === 'conflict'; });
    const duplicateTargets = duplicateGroups.reduce(function(total, group){ return total + group.duplicateOperations; }, 0);
    const identicalDuplicateOperations = identicalGroups.reduce(function(total, group){ return total + group.duplicateOperations; }, 0);
    const conflictingDuplicateOperations = conflictGroups.reduce(function(total, group){ return total + group.duplicateOperations; }, 0);
    if (missingRecords) errors.push(missingRecords + ' operación(es) no tienen registro de origen.');
    if (oversizedRecords) errors.push(oversizedRecords + ' registro(s) exceden el límite seguro de 900 KB.');
    if (invalidRoutes) errors.push(invalidRoutes + ' operación(es) tienen una ruta canónica inválida.');
    if (conflictGroups.length) errors.push(conflictGroups.length + ' destino(s) tienen contenido diferente y requieren una decisión antes de E7.2C.');
    if (identicalGroups.length) warnings.push(identicalGroups.length + ' destino(s) contienen copias idénticas que pueden consolidarse sin pérdida.');
    if (generatedIds) warnings.push(generatedIds + ' operación(es) usan identificadores deterministas generados.');

    const result = {
      schemaVersion:3,
      stage:'E7.2B.2',
      status:errors.length ? 'review' : (warnings.length ? 'ready_with_warnings' : 'ready'),
      readOnly:true,
      workspaceId:plan.workspaceId,
      importId:plan.importId,
      sourceChecksum:plan.sourceChecksum,
      planChecksum:plan.planChecksum,
      validatedAt:new Date().toISOString(),
      operationCount:operations.length,
      batchCount:batches.length,
      checkedTargets:Object.keys(targets).length,
      generatedIdCount:generatedIds,
      duplicateTargetCount:duplicateTargets,
      duplicateGroupCount:duplicateGroups.length,
      identicalDuplicateGroupCount:identicalGroups.length,
      identicalDuplicateOperationCount:identicalDuplicateOperations,
      conflictingDuplicateGroupCount:conflictGroups.length,
      conflictingDuplicateOperationCount:conflictingDuplicateOperations,
      duplicateGroups:duplicateGroups,
      oversizedRecordCount:oversizedRecords,
      invalidRouteCount:invalidRoutes,
      missingRecordCount:missingRecords,
      errors:errors,
      warnings:warnings,
      readyForE72C:errors.length === 0
    };
    result.validationChecksum = checksum(JSON.stringify({ plan:result.planChecksum, operations:result.operationCount, batches:result.batchCount, targets:result.checkedTargets, duplicates:duplicateGroups, errors:errors, warnings:warnings }));
    return result;
  }

  async function validate(){
    const analyzer = g.A33FirebaseAnalyzeE7;
    const planner = g.A33FirebasePlanE72A;
    const plan = planner && planner.readLast ? planner.readLast() : null;
    if (!plan) throw new Error('Primero debe existir un plan E7.2A local.');
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
    const result = validatePlan(plan, staged.backup);
    try{ localStorage.setItem(RESULT_KEY, JSON.stringify(result)); }catch(_){ throw new Error('No se pudo guardar la prevalidación local E7.2B.'); }
    return result;
  }

  function readLast(){
    try{ const raw = localStorage.getItem(RESULT_KEY); return raw ? JSON.parse(raw) : null; }catch(_){ return null; }
  }

  g.A33FirebaseValidateE72B = Object.freeze({ maxRecordBytes:MAX_RECORD_BYTES, validatePlan:validatePlan, validate:validate, readLast:readLast });
})(typeof globalThis !== 'undefined' ? globalThis : window);
