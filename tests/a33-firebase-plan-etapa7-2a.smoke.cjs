const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const analyzerPath = path.join(root, 'assets/js/a33-firebase-analyze-e7.js');
const plannerPath = path.join(root, 'assets/js/a33-firebase-plan-e72a.js');
const analyzerSource = fs.readFileSync(analyzerPath, 'utf8');
const plannerSource = fs.readFileSync(plannerPath, 'utf8');
const html = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const configScript = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');

const storage = new Map();
const context = {
  console, TextEncoder, Date, Math, JSON, Object, Array,
  localStorage: {
    getItem(key){ return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value){ storage.set(key, String(value)); },
    removeItem(key){ storage.delete(key); }
  }
};
context.globalThis = context;
context.window = context;
vm.createContext(context);
vm.runInContext(analyzerSource, context, { filename:analyzerPath });
vm.runInContext(plannerSource, context, { filename:plannerPath });

const planner = context.A33FirebasePlanE72A;
assert(planner && typeof planner.planBackup === 'function', 'No se publicó el planificador E7.2A.');

const backup = {
  data: {
    indexedDB: [
      { name:'a33-pos', stores:{ sales:[{ id:'sale-1', total:100 }], cashV2:[{ id:'close-1', amount:100 }] } },
      { name:'finanzasDB', stores:{
        receipts:[{ id:'receipt-1', amount:100 }],
        cobrar:[{ id:'charge-1', amount:20 }],
        pagar:[{ id:'payment-1', amount:10 }],
        caja_chica:[{ id:'petty-1', amount:5 }]
      } }
    ],
    localStorage: { 'a33.ef2':JSON.stringify([{ id:'ef-1', total:50 }]) }
  }
};

const first = planner.planBackup(backup, { workspaceId:'arcano33', importId:'import-1', sourceChecksum:'abc123' });
const second = planner.planBackup(backup, { workspaceId:'arcano33', importId:'import-1', sourceChecksum:'abc123' });
assert.equal(first.stage, 'E7.2A');
assert.equal(first.status, 'planned');
assert.equal(first.readOnly, true);
assert.equal(first.operationCount, 7);
assert.equal(first.batchCount, 1);
assert.equal(first.planChecksum, second.planChecksum, 'El plan E7.2A no es determinista.');
assert.deepEqual(Array.from(first.scope), ['pos', 'finanzas', 'caja_chica']);
assert.deepEqual(Array.from(first.excluded), ['seguridad']);
assert(first.operations.every((item) => item.strategy === 'merge'), 'El plan contiene una estrategia destructiva.');
assert(first.operations.every((item) => !Object.prototype.hasOwnProperty.call(item, 'payload')), 'El plan local retuvo datos operativos completos.');
assert(first.operations.some((item) => item.moduleId === 'finanzas' && item.entityId === 'caja_chica'), 'Caja Chica no recibió destino canónico.');

[
  /\.set\s*\(/,
  /\.add\s*\(/,
  /\.update\s*\(/,
  /\.delete\s*\(/,
  /writeBatch\s*\(/,
  /runTransaction\s*\(/,
  /batch\.commit\s*\(/
].forEach((pattern) => assert(!pattern.test(plannerSource), `E7.2A contiene una operación remota no permitida: ${pattern}`));

assert(html.includes('id="cfg-plan-e72a-run"'), 'No existe el botón E7.2A.');
assert(html.includes('a33-firebase-plan-e72a.js?v=4.20.98&amp;r=1'), 'No se cargó el planificador E7.2A.');
assert(html.includes('script.js?v=4.20.98&amp;r=45'), 'No se actualizó la revisión de Configuración.');
assert(html.indexOf('cfg-analyze-e7-title') < html.indexOf('cfg-plan-e72a-title'), 'E7.2A no quedó después de E7.1.');
assert(html.indexOf('cfg-plan-e72a-title') < html.indexOf('cfg-firebase-sync-title'), 'E7.2A no quedó antes de la sincronización general.');
assert(configScript.includes('function initPlanE72A()'), 'No se inicializa la interfaz E7.2A.');
assert(configScript.includes('No escribirá, modificará ni eliminará documentos en Firestore.'), 'Falta la advertencia explícita de no escritura.');

console.log('OK a33-firebase-plan-etapa7-2a.smoke');
