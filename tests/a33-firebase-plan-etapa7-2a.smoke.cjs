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
assert.equal(first.schemaVersion, 2);
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
assert.deepEqual(JSON.parse(JSON.stringify(planner.entityFor('pos', 'indexedDB/a33-pos/events'))), { moduleId:'pos', entityId:'eventos' });
assert.deepEqual(JSON.parse(JSON.stringify(planner.entityFor('pos', 'indexedDB/a33-pos/inventory'))), { moduleId:'pos', entityId:'inventario_evento' });
assert.deepEqual(JSON.parse(JSON.stringify(planner.entityFor('pos', 'indexedDB/a33-pos/journalEntries'))), { moduleId:'finanzas', entityId:'asientos' });
assert.equal(planner.entityFor('pos', 'indexedDB/a33-pos/banks').excluded, true, 'Bancos volvió a tratarse como venta.');
assert.deepEqual(
  JSON.parse(JSON.stringify(planner.entityFor('pos', 'localStorage/a33_pos_customerSticky'))),
  { excluded:true, reason:'preferencia_ui' },
  'La preferencia de cliente pegajoso volvió a tratarse como información operativa.'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(planner.entityFor('pos', 'localStorage/a33_pos_customersCatalog'))),
  { excluded:true, reason:'gestionado_en_e5' },
  'El catálogo de clientes volvió a tratarse como una venta.'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(planner.entityFor('pos', 'localStorage/a33_pos_customersCatalog__meta'))),
  { excluded:true, reason:'metadato_storage' },
  'El metadato del catálogo de clientes volvió a tratarse como información operativa.'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(planner.entityFor('pos', 'localStorage/a33.ef2__meta'))),
  { excluded:true, reason:'metadato_storage' },
  'El metadato de Efectivo volvió a tratarse como un movimiento.'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(planner.entityFor('pos', 'localStorage/arcano33_inventario'))),
  { excluded:true, reason:'gestionado_en_e6' },
  'El inventario central aplicado en E6 volvió a entrar en el bloque crítico.'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(planner.entityFor('pos', 'localStorage/a33_pos_groupCatalog_v1'))),
  { excluded:true, reason:'gestionado_en_e5' },
  'El catálogo de grupos volvió a tratarse como una venta.'
);
assert.equal(planner.entityFor('pos', 'localStorage/a33_pos_pending_sale_uid_v1').blocked, true, 'Una clave operativa pendiente fue excluida sin clasificación.');
assert.equal(planner.entityFor('pos', 'indexedDB/a33-pos/unknownStore').blocked, true, 'Una fuente POS desconocida no quedó bloqueada.');
assert.equal(planner.entityFor('pos', 'localStorage/a33_pos_unknownState').blocked, true, 'Una fuente local POS desconocida no quedó bloqueada.');

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
assert(html.includes('a33-firebase-plan-e72a.js?v=4.20.98&amp;r=6'), 'No se cargó el planificador E7.2A.');
assert(html.includes('script.js?v=4.20.98&amp;r=55'), 'No se actualizó la revisión de Configuración.');
assert(html.indexOf('cfg-analyze-e7-title') < html.indexOf('cfg-plan-e72a-title'), 'E7.2A no quedó después de E7.1.');
assert(html.indexOf('cfg-plan-e72a-title') < html.indexOf('cfg-firebase-sync-title'), 'E7.2A no quedó antes de la sincronización general.');
assert(configScript.includes('function initPlanE72A()'), 'No se inicializa la interfaz E7.2A.');
assert(/const plan = await engine\.plan\(\);[\s\S]{0,160}renderPlanE72AState\(\);[\s\S]{0,80}renderValidateE72BState\(\);/.test(configScript), 'E7.2A no habilita la interfaz E7.2B.2 al terminar.');
assert(/renderValidateE72BState\(\);[\s\S]{0,80}renderSimulateE72CState\(\);/.test(configScript), 'E7.2A no invalida visualmente una simulación E7.2C anterior.');
assert(configScript.includes('No escribirá, modificará ni eliminará documentos en Firestore.'), 'Falta la advertencia explícita de no escritura.');

console.log('OK a33-firebase-plan-etapa7-2a.smoke');
