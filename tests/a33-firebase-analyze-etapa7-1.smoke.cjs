const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'assets/js/a33-firebase-analyze-e7.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const html = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const configScript = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');

const storage = new Map();
const context = {
  console,
  TextEncoder,
  Date,
  Math,
  JSON,
  Object,
  Array,
  localStorage: {
    getItem(key){ return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value){ storage.set(key, String(value)); },
    removeItem(key){ storage.delete(key); }
  }
};
context.globalThis = context;
context.window = context;
context.self = context;
vm.createContext(context);
vm.runInContext(source, context, { filename:sourcePath });

const engine = context.A33FirebaseAnalyzeE7;
assert(engine && typeof engine.analyzeBackup === 'function', 'No se publicó el analizador E7.1.');

const safeBackup = {
  data: {
    indexedDB: [
      { name:'a33-pos', stores:{ sales:[{ id:'sale-1', total:100 }], cashV2:[{ id:'cash-1', amount:100 }] } },
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

const report = engine.analyzeBackup(safeBackup, { workspaceId:'arcano33', importId:'import-1', sourceChecksum:'abc123' });
assert.deepEqual(Array.from(report.scope), ['pos', 'finanzas', 'caja_chica']);
assert.deepEqual(Array.from(report.excluded), ['seguridad']);
assert.equal(report.readyForE72, true, 'Un respaldo seguro no quedó listo para E7.2.');
assert.equal(report.status, 'ready', 'El diagnóstico seguro reportó advertencias inesperadas.');
assert.equal(report.recordCount, 7, 'El total del bloque crítico no coincide.');
assert.equal(report.sourceCount, 7, 'El total de fuentes críticas no coincide.');
assert.equal(report.areas.caja_chica.records, 1, 'Caja Chica no fue clasificada correctamente.');

const riskyBackup = {
  data: {
    indexedDB: [{ name:'a33-pos', stores:{ sales:[
      { id:'duplicate', total:1 },
      { id:'duplicate', total:2 },
      { id:'large', payload:'x'.repeat(900010) }
    ] } }],
    localStorage: {}
  }
};
const risky = engine.analyzeBackup(riskyBackup, { workspaceId:'arcano33', importId:'import-2', sourceChecksum:'def456' });
assert.equal(risky.readyForE72, false, 'Un respaldo riesgoso habilitó E7.2.');
assert.equal(risky.status, 'review', 'El respaldo riesgoso no quedó en revisión.');
assert.equal(risky.totals.duplicateStableIds, 1, 'No se detectó el identificador duplicado.');
assert.equal(risky.totals.oversizedRecords, 1, 'No se detectó el registro sobredimensionado.');

assert(source.includes('.get()'), 'E7.1 no contiene lecturas verificables de Firestore.');
[
  /\.set\s*\(/,
  /\.add\s*\(/,
  /\.update\s*\(/,
  /\.delete\s*\(/,
  /writeBatch\s*\(/,
  /runTransaction\s*\(/
].forEach((pattern) => assert(!pattern.test(source), `E7.1 contiene una operación remota no permitida: ${pattern}`));

assert(html.includes('id="cfg-analyze-e7-run"'), 'No existe el botón de diagnóstico E7.1.');
assert(html.includes('a33-firebase-analyze-e7.js?v=4.20.98&amp;r=1'), 'No se cargó el motor E7.1.');
assert(html.includes('script.js?v=4.20.98&amp;r=44'), 'No se actualizó la revisión de Configuración.');
assert(html.indexOf('cfg-analyze-e7-title') < html.indexOf('cfg-firebase-sync-title'), 'E7.1 no quedó antes de la sincronización general.');
assert(configScript.includes('function initAnalyzeE7()'), 'No se inicializa la interfaz E7.1.');
assert(configScript.includes('No copiará, modificará ni eliminará datos en Firestore.'), 'Falta la advertencia explícita de solo lectura.');
assert(configScript.includes('Seguridad queda excluida.'), 'No se excluyó Seguridad de E7.1.');

console.log('OK a33-firebase-analyze-etapa7-1.smoke');
