const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async function(){
  const root = path.resolve(__dirname, '..');
  const files = [
    'assets/js/a33-firestore-data.js',
    'assets/js/a33-firebase-analyze-e7.js',
    'assets/js/a33-firebase-plan-e72a.js',
    'assets/js/a33-firebase-validate-e72b.js',
    'assets/js/a33-firebase-simulate-e72c.js',
    'assets/js/a33-firebase-apply-e72d.js',
    'assets/js/a33-firebase-audit-e72e.js'
  ];
  const sources = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8'));
  const auditSource = sources[6];
  const html = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
  const configScript = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
  const context = { console, TextEncoder, Date, Math, JSON, Object, Array, Map, Promise, localStorage:{ getItem(){ return null; }, setItem(){} } };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  sources.forEach((source, index) => vm.runInContext(source, context, { filename:files[index] }));

  const sales = Array.from({ length:201 }, (_, index) => ({ id:'sale-' + String(index + 1), total:index + 1 }));
  const backup = { data:{ indexedDB:[{ name:'a33-pos', stores:{ sales:sales } }], localStorage:{} } };
  const plan = context.A33FirebasePlanE72A.planBackup(backup, { workspaceId:'arcano33', importId:'import-1', sourceChecksum:'abc12345' });
  const validation = context.A33FirebaseValidateE72B.validatePlan(plan, backup);
  const simulation = await context.A33FirebaseSimulateE72C.simulatePlan(plan, validation, backup, async () => ({ exists:false, data:null }));
  const execution = context.A33FirebaseApplyE72D.buildPlan(plan, validation, simulation, backup, { workspaceId:'arcano33', uid:'admin-1', deviceId:'device-1' });
  const checkpoint = {
    stage:'E7.2D', status:'completed', workspaceId:'arcano33', importId:'import-1', sourceChecksum:plan.sourceChecksum,
    planChecksum:plan.planChecksum, validationChecksum:validation.validationChecksum, simulationChecksum:simulation.simulationChecksum,
    totalBatches:execution.batchCount, completedBatches:execution.batchCount, recordCount:execution.recordCount,
    appliedCount:execution.recordCount, lastBatchChecksum:execution.batches[execution.batches.length - 1].checksum
  };
  const remote = new Map();
  execution.batches.forEach((batch) => batch.items.forEach((item) => remote.set(item.document.path, JSON.parse(JSON.stringify(item.document)))));
  const auditor = context.A33FirebaseAuditE72E;
  const result = await auditor.auditPlan(checkpoint, plan, validation, simulation, backup, async (remotePath) => ({ exists:remote.has(remotePath), data:remote.get(remotePath) }));
  assert.equal(result.stage, 'E7.2E');
  assert.equal(result.readOnly, true);
  assert.equal(result.status, 'verified');
  assert.equal(result.expectedCount, 201);
  assert.equal(result.verifiedCount, 201);
  assert.equal(result.missingCount, 0);
  assert.equal(result.differentCount, 0);
  assert.equal(result.invalidContractCount, 0);
  assert.equal(result.errorCount, 0);
  assert.equal(result.readyForE72F, true);

  const missingPath = execution.batches[0].items[0].document.path;
  const missing = await auditor.auditPlan(checkpoint, plan, validation, simulation, backup, async (remotePath) => ({ exists:remotePath !== missingPath && remote.has(remotePath), data:remote.get(remotePath) }));
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.missingCount, 1);
  assert.equal(missing.readyForE72F, false);
  const foreign = Object.assign({}, checkpoint, { simulationChecksum:'ffffffff' });
  assert.throws(() => auditor.validateCheckpoint(foreign, plan, validation, simulation), /no corresponde/);
  assert(!/\.set\s*\(|\.add\s*\(|\.update\s*\(|\.delete\s*\(|\.commit\s*\(/.test(auditSource), 'E7.2E contiene escrituras remotas.');
  assert(auditSource.includes("readOnly:true"), 'E7.2E no declara el modo de solo lectura.');
  assert(html.includes('id="cfg-audit-e72e-run"'), 'No existe el botón E7.2E.');
  assert(html.includes('a33-firebase-audit-e72e.js?v=4.20.98&amp;r=1'), 'No se cargó el auditor E7.2E.');
  assert(html.includes('script.js?v=4.20.98&amp;r=55'), 'No se actualizó la revisión de Configuración.');
  assert(html.indexOf('cfg-apply-e72d-title') < html.indexOf('cfg-audit-e72e-title'), 'E7.2E no quedó después de E7.2D.');
  assert(configScript.includes('const E72E_EXECUTION_ENABLED = true;'), 'E7.2F no habilita la auditoría remota de solo lectura.');
  assert(configScript.includes('function initAuditE72E()'), 'No se inicializa la interfaz E7.2E.');

  console.log('OK a33-firebase-audit-etapa7-2e.smoke');
})().catch(function(error){ console.error(error); process.exitCode = 1; });
