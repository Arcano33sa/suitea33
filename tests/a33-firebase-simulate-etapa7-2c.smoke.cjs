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
    'assets/js/a33-firebase-simulate-e72c.js'
  ];
  const sources = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8'));
  const simulatorSource = sources[4];
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

  const backup = {
    data: {
      indexedDB: [
        { name:'a33-pos', stores:{ sales:[{ id:'sale-1', total:100 }, { id:'sale-2', total:200 }, { id:'sale-3', total:300 }, { id:'sale-4', total:400 }] } }
      ],
      localStorage: {}
    }
  };
  const planner = context.A33FirebasePlanE72A;
  const validator = context.A33FirebaseValidateE72B;
  const simulator = context.A33FirebaseSimulateE72C;
  const contract = context.A33FirestoreData;
  const plan = planner.planBackup(backup, { workspaceId:'arcano33', importId:'import-1', sourceChecksum:'abc123' });
  const validation = validator.validatePlan(plan, backup);
  assert.equal(validation.readyForE72C, true);

  const records = backup.data.indexedDB[0].stores.sales;
  const remoteByPath = new Map();
  const pathFor = (operation) => contract.recordPath(plan.workspaceId, operation.moduleId, operation.entityId, operation.recordId);
  remoteByPath.set(pathFor(plan.operations[1]), { exists:true, data:{ payload:records[1] } });
  remoteByPath.set(pathFor(plan.operations[2]), { exists:true, data:{ payload:{ id:'sale-3', total:999 } } });
  const failedPath = pathFor(plan.operations[3]);

  const blocked = await simulator.simulatePlan(plan, validation, backup, async function(remotePath){
    if (remotePath === failedPath){ const error = new Error('read_failed'); error.code = 'permission-denied'; throw error; }
    return remoteByPath.get(remotePath) || { exists:false, data:null };
  });
  assert.equal(blocked.stage, 'E7.2C');
  assert.equal(blocked.schemaVersion, 1);
  assert.equal(blocked.readOnly, true);
  assert.equal(blocked.operationCount, 4);
  assert.equal(blocked.readCount, 4);
  assert.equal(blocked.newCount, 1);
  assert.equal(blocked.identicalCount, 1);
  assert.equal(blocked.differentCount, 1);
  assert.equal(blocked.errorCount, 1);
  assert.equal(blocked.firstErrorCode, 'permission-denied');
  assert.equal(blocked.errorCodes['permission-denied'], 1);
  assert.equal(blocked.readyForE72D, false);
  assert(blocked.outcomes.every((item) => !Object.prototype.hasOwnProperty.call(item, 'payload')), 'La simulación retuvo datos operativos.');

  const ready = await simulator.simulatePlan(plan, validation, backup, async function(remotePath){
    const operation = plan.operations.find((item) => pathFor(item) === remotePath);
    return operation && operation.order === 1 ? { exists:true, data:{ payload:records[1] } } : { exists:false, data:null };
  });
  assert.equal(ready.newCount, 3);
  assert.equal(ready.identicalCount, 1);
  assert.equal(ready.differentCount, 0);
  assert.equal(ready.errorCount, 0);
  assert.equal(ready.readyForE72D, true);

  [
    /\.set\s*\(/, /\.add\s*\(/, /\.update\s*\(/, /\.delete\s*\(/,
    /writeBatch\s*\(/, /runTransaction\s*\(/, /batch\.commit\s*\(/
  ].forEach((pattern) => assert(!pattern.test(simulatorSource), `E7.2C contiene una operación remota no permitida: ${pattern}`));

  assert(html.includes('id="cfg-simulate-e72c-run"'), 'No existe el botón E7.2C.');
  assert(html.includes('a33-firebase-simulate-e72c.js?v=4.20.98&amp;r=2'), 'No se cargó el simulador E7.2C.');
  assert(html.includes('script.js?v=4.20.98&amp;r=55'), 'No se actualizó la revisión de Configuración.');
  assert(html.indexOf('cfg-validate-e72b-title') < html.indexOf('cfg-simulate-e72c-title'), 'E7.2C no quedó después de E7.2B.2.');
  assert(html.indexOf('cfg-simulate-e72c-title') < html.indexOf('cfg-firebase-sync-title'), 'E7.2C no quedó antes de la sincronización general.');
  assert(configScript.includes('function initSimulateE72C()'), 'No se inicializa E7.2C.');
  assert(configScript.includes('No creará, modificará ni eliminará documentos.'), 'Falta la advertencia explícita de solo lectura.');
  assert(rules.includes('function validStage7ReadModule'), 'Falta el alcance de lectura E7 en las reglas.');
  assert(rules.includes('function validStage7ReadEntity'), 'Faltan las entidades legibles de E7.');
  assert(rules.includes('requesterAdmin(workspaceId)\n            && validStage7ReadModule(moduleId)'), 'La lectura E7 no quedó restringida a Admin.');
  assert(!/allow create, update:[\s\S]{0,180}validStage7Read/.test(rules), 'Las reglas E7 habilitaron escrituras por error.');
  assert(!/allow list:[\s\S]{0,180}validStage7Read/.test(rules), 'Las reglas E7 habilitaron consultas list por error.');

  console.log('OK a33-firebase-simulate-etapa7-2c.smoke');
})().catch(function(error){ console.error(error); process.exitCode = 1; });
