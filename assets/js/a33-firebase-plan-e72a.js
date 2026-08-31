/* Suite A33 — plan local del bloque crítico (E7.2A, sin escrituras remotas). */
(function(g){
  'use strict';

  const RESULT_KEY = 'suite_a33_firebase_plan_e72a_v1';
  const BATCH_LIMIT = 200;
  const AREAS = Object.freeze(['pos', 'finanzas', 'caja_chica']);

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

  function stableCandidate(record){
    const source = record && typeof record === 'object' ? record : {};
    const fields = ['id', 'uid', 'code', 'codigo', 'saleId', 'ventaId', 'receiptId', 'recordId', 'entryId', 'movementId', 'paymentId', 'chargeId', 'accountId', '_sourceKey'];
    for (let index = 0; index < fields.length; index += 1){
      const candidate = clean(source[fields[index]], 180);
      if (candidate) return candidate;
    }
    return '';
  }

  function safeId(value, fallback){
    let raw = clean(value || fallback || '', 180).toLowerCase();
    try{ raw = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }catch(_){ }
    return raw.replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || fallback || 'registro';
  }

  function entityFor(areaId, sourceId){
    const source = String(sourceId || '').toLowerCase();
    if (areaId === 'caja_chica') return { moduleId:'finanzas', entityId:'caja_chica' };
    if (areaId === 'pos'){
      if (source.includes('cash') || source.includes('cierre')) return { moduleId:'pos', entityId:'cierres_diarios' };
      if (source.includes('efectivo') || source.includes('a33.ef2')) return { moduleId:'pos', entityId:'efectivo' };
      return { moduleId:'pos', entityId:'ventas' };
    }
    if (source.includes('journalentries') || source.includes('/asientos')) return { moduleId:'finanzas', entityId:'asientos' };
    if (source.includes('journallines')) return { moduleId:'finanzas', entityId:'lineas_asiento' };
    if (source.includes('receipt') || source.includes('/recibos')) return { moduleId:'finanzas', entityId:'recibos' };
    if (source.includes('purchase') || source.includes('/compras')) return { moduleId:'finanzas', entityId:'compras' };
    if (source.includes('cobrar')) return { moduleId:'finanzas', entityId:'cobrar' };
    if (source.includes('pagar')) return { moduleId:'finanzas', entityId:'pagar' };
    return { moduleId:'finanzas', entityId:'cuentas' };
  }

  function planBackup(backup, options){
    const analyzer = g.A33FirebaseAnalyzeE7;
    if (!analyzer || typeof analyzer.listCriticalSources !== 'function' || typeof analyzer.analyzeBackup !== 'function') throw new Error('No está disponible el diagnóstico E7.1 compatible.');
    const context = Object.assign({ workspaceId:'arcano33', importId:'', sourceChecksum:'' }, options || {});
    const report = analyzer.analyzeBackup(backup, context);
    if (!report.readyForE72) throw new Error('E7.1 detectó riesgos que deben resolverse antes de planificar E7.2.');
    const operations = [];
    const areaTotals = { pos:0, finanzas:0, caja_chica:0 };
    analyzer.listCriticalSources(backup).forEach(function(source){
      const target = entityFor(source.areaId, source.sourceId);
      source.records.forEach(function(record, index){
        const serialized = JSON.stringify(record == null ? null : record);
        const candidate = stableCandidate(record);
        const recordId = safeId(candidate || ('registro_' + checksum(source.sourceId + ':' + index + ':' + serialized)), 'registro');
        operations.push({
          order:operations.length,
          areaId:source.areaId,
          sourceId:source.sourceId,
          sourceIndex:index,
          moduleId:target.moduleId,
          entityId:target.entityId,
          recordId:recordId,
          generatedId:!candidate,
          payloadChecksum:checksum(serialized),
          strategy:'merge'
        });
        areaTotals[source.areaId] += 1;
      });
    });
    const batches = [];
    for (let start = 0; start < operations.length; start += BATCH_LIMIT){
      const slice = operations.slice(start, start + BATCH_LIMIT);
      batches.push({ index:batches.length, from:start, to:start + slice.length - 1, operations:slice.length, checksum:checksum(JSON.stringify(slice)) });
    }
    const plan = {
      schemaVersion:1,
      stage:'E7.2A',
      status:'planned',
      readOnly:true,
      workspaceId:clean(context.workspaceId, 80) || 'arcano33',
      importId:clean(context.importId, 180),
      sourceChecksum:clean(context.sourceChecksum, 80),
      plannedAt:new Date().toISOString(),
      scope:AREAS.slice(),
      excluded:['seguridad'],
      strategy:'merge',
      batchLimit:BATCH_LIMIT,
      operationCount:operations.length,
      batchCount:batches.length,
      generatedIdCount:operations.filter(function(item){ return item.generatedId; }).length,
      areaTotals:areaTotals,
      batches:batches,
      operations:operations
    };
    plan.planChecksum = checksum(JSON.stringify(operations));
    return plan;
  }

  async function plan(){
    const analyzer = g.A33FirebaseAnalyzeE7;
    const report = analyzer && analyzer.readLast ? analyzer.readLast() : null;
    if (!report || report.stage !== 'E7.1' || !report.readyForE72) throw new Error('Primero debe existir un diagnóstico E7.1 confirmado y apto.');
    const settings = g.A33FirebaseSettings && g.A33FirebaseSettings.read ? g.A33FirebaseSettings.read() : null;
    if (!settings || !settings.enabled || !settings.configured) throw new Error('Firebase debe estar activado y configurado.');
    if (!g.A33Firebase || typeof g.A33Firebase.initFirebaseApp !== 'function') throw new Error('No está disponible el motor Firebase.');
    if (!g.A33FirebaseImport || typeof g.A33FirebaseImport.readLast !== 'function') throw new Error('No está disponible la carga E4.');
    const last = g.A33FirebaseImport.readLast();
    if (!last || last.importId !== report.importId || last.checksum !== report.sourceChecksum) throw new Error('El diagnóstico E7.1 no corresponde a la carga E4 actual.');
    const app = await g.A33Firebase.initFirebaseApp(settings);
    if (typeof analyzer.ensureFirestore === 'function') await analyzer.ensureFirestore();
    const db = g.firebase.firestore(app);
    const staged = await analyzer.readStaged(db, report.workspaceId, last);
    const result = planBackup(staged.backup, { workspaceId:report.workspaceId, importId:report.importId, sourceChecksum:report.sourceChecksum });
    try{ localStorage.setItem(RESULT_KEY, JSON.stringify(result)); }catch(_){ throw new Error('No se pudo guardar el plan local E7.2A.'); }
    return result;
  }

  function readLast(){
    try{ const raw = localStorage.getItem(RESULT_KEY); return raw ? JSON.parse(raw) : null; }catch(_){ return null; }
  }

  g.A33FirebasePlanE72A = Object.freeze({ batchLimit:BATCH_LIMIT, entityFor:entityFor, planBackup:planBackup, plan:plan, readLast:readLast });
})(typeof globalThis !== 'undefined' ? globalThis : window);
