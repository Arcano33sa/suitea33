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
    'assets/js/a33-firebase-apply-e72d.js'
  ];
  const sources = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8'));
  const engineSource = sources[5];
  const html = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
  const configScript = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const storage = new Map();
  const context = {
    console, TextEncoder, Date, Math, JSON, Object, Array, Map, Promise,
    localStorage: {
      getItem(key){ return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value){ storage.set(key, String(value)); },
      removeItem(key){ storage.delete(key); }
    }
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  sources.forEach((source, index) => vm.runInContext(source, context, { filename:files[index] }));

  const sales = Array.from({ length:201 }, (_, index) => ({ id:'sale-' + String(index + 1), total:index + 1 }));
  const backup = { data:{ indexedDB:[{ name:'a33-pos', stores:{ sales:sales } }], localStorage:{} } };
  const plan = context.A33FirebasePlanE72A.planBackup(backup, { workspaceId:'arcano33', importId:'import-1', sourceChecksum:'abc12345' });
  const validation = context.A33FirebaseValidateE72B.validatePlan(plan, backup);
  const simulation = await context.A33FirebaseSimulateE72C.simulatePlan(plan, validation, backup, async () => ({ exists:false, data:null }));
  const engine = context.A33FirebaseApplyE72D;
  const execution = engine.buildPlan(plan, validation, simulation, backup, { workspaceId:'arcano33', uid:'admin-1', deviceId:'device-1' });
  assert.equal(execution.stage, 'E7.2D');
  assert.equal(execution.strategy, 'create-only');
  assert.equal(execution.recordCount, 201);
  assert.equal(execution.batchCount, 2);
  assert.equal(execution.batches[0].items.length, 200);
  assert.equal(execution.batches[1].items.length, 1);
  assert(execution.batches.every((batch) => batch.items.every((item) => item.document.payload && !item.document.deleted)), 'El plan contiene documentos inválidos.');

  let checkpoint = null;
  let commits = 0;
  let failSecond = true;
  const applicationRef = {
    async get(){ return checkpoint ? { exists:true, data(){ return checkpoint; } } : { exists:false, data(){ return null; } }; }
  };
  const db = {
    doc(remotePath){ return { path:remotePath }; },
    batch(){
      const writes = [];
      return {
        set(ref, value){ writes.push({ ref, value }); },
        async commit(){
          commits += 1;
          if (failSecond && commits === 2) throw new Error('network_interruption');
          const marker = writes.find((write) => write.ref === applicationRef);
          if (marker) checkpoint = JSON.parse(JSON.stringify(marker.value));
        }
      };
    }
  };
  await assert.rejects(() => engine.writePlan(db, applicationRef, execution, { uid:'admin-1' }), /network_interruption/);
  assert.equal(checkpoint.completedBatches, 1, 'El primer lote no dejó checkpoint atómico.');
  assert.equal(checkpoint.appliedCount, 200);
  failSecond = false;
  const resumed = await engine.writePlan(db, applicationRef, execution, { uid:'admin-1' });
  assert.equal(commits, 3, 'La reanudación repitió un lote ya confirmado.');
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.completedBatches, 2);
  assert.equal(resumed.appliedCount, 201);

  const foreignCheckpoint = Object.assign({}, resumed, { planChecksum:'ffffffff' });
  assert.throws(() => engine.validateCheckpoint(foreignCheckpoint, execution), /otra ejecución/);
  assert(!/\.update\s*\(|\.delete\s*\(/.test(engineSource), 'E7.2D contiene actualización o eliminación directa.');
  assert(html.includes('id="cfg-apply-e72d-run"'), 'No existe el botón E7.2D.');
  assert(html.includes('a33-firebase-apply-e72d.js?v=4.20.98&amp;r=1'), 'No se cargó el motor E7.2D.');
  assert(html.includes('script.js?v=4.20.98&amp;r=53'), 'No se actualizó la revisión de Configuración.');
  assert(html.indexOf('cfg-simulate-e72c-title') < html.indexOf('cfg-apply-e72d-title'), 'E7.2D no quedó después de E7.2C.');
  assert(configScript.includes('const E72D_RULES_DEPLOYED = true;'), 'La compuerta E7.2D.2 no habilita la aplicación después del despliegue.');
  assert(rules.includes('function validStage7CreateRecord'), 'Faltan reglas locales de creación E7.');
  assert(rules.includes('match /applications/e72d'), 'Falta el checkpoint remoto E7.2D.');
  assert(rules.includes('allow create: if requesterAdmin(workspaceId)'), 'La creación E7 no quedó limitada a Admin.');
  assert(rules.includes("resource.data.status != 'completed'"), 'Un checkpoint E7.2D completado todavía puede modificarse.');
  assert(rules.includes('request.resource.data.completedBatches == resource.data.completedBatches + 1'), 'El checkpoint E7.2D puede saltar lotes.');
  assert(rules.includes('request.resource.data.appliedCount - resource.data.appliedCount <= 200'), 'El checkpoint E7.2D permite confirmar más de 200 registros por lote.');
  assert(!/allow update:[\s\S]{0,180}validStage7CreateRecord/.test(rules), 'Las reglas permiten actualizar registros E7.');
  assert(!/allow delete:[\s\S]{0,180}validStage7CreateRecord/.test(rules), 'Las reglas permiten eliminar registros E7.');

  console.log('OK a33-firebase-apply-etapa7-2d.smoke');
})().catch(function(error){ console.error(error); process.exitCode = 1; });
