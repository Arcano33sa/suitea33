const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const files = [
  'assets/js/a33-firestore-data.js',
  'assets/js/a33-firebase-analyze-e7.js',
  'assets/js/a33-firebase-plan-e72a.js',
  'assets/js/a33-firebase-validate-e72b.js'
];
const sources = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8'));
const validatorSource = sources[3];
const html = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const configScript = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
const storage = new Map();
const context = {
  console, TextEncoder, Date, Math, JSON, Object, Array, Map,
  localStorage: {
    getItem(key){ return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value){ storage.set(key, String(value)); },
    removeItem(key){ storage.delete(key); }
  }
};
context.globalThis = context;
context.window = context;
vm.createContext(context);
sources.slice(0, 3).forEach((source, index) => vm.runInContext(source, context, { filename:files[index] }));
vm.runInContext(validatorSource, context, { filename:files[3] });

const backup = {
  data: {
    indexedDB: [
      { name:'a33-pos', stores:{ sales:[{ id:'sale-1', total:100 }], cashV2:[{ id:'close-1', amount:100 }] } },
      { name:'finanzasDB', stores:{ receipts:[{ id:'receipt-1', amount:100 }], cobrar:[{ id:'charge-1', amount:20 }], pagar:[{ id:'payment-1', amount:10 }], caja_chica:[{ id:'petty-1', amount:5 }] } }
    ],
    localStorage: { 'a33.ef2':JSON.stringify([{ id:'ef-1', total:50 }]) }
  }
};
const plan = context.A33FirebasePlanE72A.planBackup(backup, { workspaceId:'arcano33', importId:'import-1', sourceChecksum:'abc123' });
const result = context.A33FirebaseValidateE72B.validatePlan(plan, backup);
assert.equal(result.stage, 'E7.2B.2');
assert.equal(result.schemaVersion, 3);
assert.equal(result.status, 'ready');
assert.equal(result.readOnly, true);
assert.equal(result.readyForE72C, true);
assert.equal(result.operationCount, 7);
assert.equal(result.checkedTargets, 7);
assert.equal(result.errors.length, 0);

const identicalBackup = {
  data: {
    indexedDB: [
      { name:'finanzasDB', stores:{ receipts:[{ id:'same-receipt', amount:100 }] } },
      { name:'financeArchive', stores:{ receipts:[{ id:'same-receipt', amount:100 }] } }
    ],
    localStorage: {}
  }
};
const identicalPlan = context.A33FirebasePlanE72A.planBackup(identicalBackup, { workspaceId:'arcano33', importId:'import-identical', sourceChecksum:'same123' });
const identical = context.A33FirebaseValidateE72B.validatePlan(identicalPlan, identicalBackup);
assert.equal(identical.readyForE72C, true, 'Las copias idénticas bloquearon indebidamente E7.2C.');
assert.equal(identical.identicalDuplicateGroupCount, 1, 'No se clasificó la copia idéntica.');
assert.equal(identical.conflictingDuplicateGroupCount, 0, 'Una copia idéntica fue marcada como conflicto.');

const altered = JSON.parse(JSON.stringify(plan));
altered.operations[0].recordId = altered.operations[1].recordId;
altered.operations[0].moduleId = altered.operations[1].moduleId;
altered.operations[0].entityId = altered.operations[1].entityId;
altered.planChecksum = context.A33FirebaseAnalyzeE7.checksum(JSON.stringify(altered.operations));
altered.batches[0].checksum = context.A33FirebaseAnalyzeE7.checksum(JSON.stringify(altered.operations));
const conflict = context.A33FirebaseValidateE72B.validatePlan(altered, backup);
assert.equal(conflict.readyForE72C, false, 'Un destino duplicado no bloqueó E7.2C.');
assert(conflict.duplicateTargetCount > 0, 'No se informó el destino duplicado.');

[
  /\.set\s*\(/, /\.add\s*\(/, /\.update\s*\(/, /\.delete\s*\(/,
  /writeBatch\s*\(/, /runTransaction\s*\(/, /batch\.commit\s*\(/
].forEach((pattern) => assert(!pattern.test(validatorSource), `E7.2B contiene una operación remota no permitida: ${pattern}`));

assert(html.includes('id="cfg-validate-e72b-run"'), 'No existe el botón E7.2B.');
assert(html.includes('a33-firebase-validate-e72b.js?v=4.20.98&amp;r=3'), 'No se cargó el prevalidador E7.2B.2.');
assert(html.includes('script.js?v=4.20.98&amp;r=55'), 'No se actualizó la revisión de Configuración.');
assert(html.indexOf('cfg-plan-e72a-title') < html.indexOf('cfg-validate-e72b-title'), 'E7.2B no quedó después de E7.2A.');
assert(html.indexOf('cfg-validate-e72b-title') < html.indexOf('cfg-firebase-sync-title'), 'E7.2B no quedó antes de la sincronización general.');
assert(configScript.includes('function initValidateE72B()'), 'No se inicializa E7.2B.');
assert(configScript.includes('no escribirá ni eliminará documentos en Firestore'), 'Falta la advertencia explícita de solo lectura.');
assert(configScript.includes('cfg-validate-e72b-conflicts'), 'La interfaz no muestra los conflictos reales.');

console.log('OK a33-firebase-validate-etapa7-2b.smoke');
