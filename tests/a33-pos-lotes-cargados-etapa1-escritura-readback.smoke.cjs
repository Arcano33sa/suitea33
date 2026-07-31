'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('pos/app.js');
const html = read('pos/index.html');
const sw = read('pos/sw.js');
const release = read('assets/js/a33-release.js');
const build = read('assets/js/a33-build.js');
const manifest = JSON.parse(read('pos/manifest.webmanifest'));
const browserReport = JSON.parse(read('tests/results/a33-pos-lotes-etapa1-browser.json'));

function extractFunction(source, name){
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `No se encontró ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = bodyStart; i < source.length; i++){
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment){ if (ch === '\n') lineComment = false; continue; }
    if (blockComment){ if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote){
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

const writer = extractFunction(app, 'writeInventoryMovementsAtomicPOS');
const readback = extractFunction(app, 'readbackNewLoteInventoryPOS');
const importer = extractFunction(app, 'importFromLoteToInventory');
const freshRead = extractFunction(app, 'readPosStoresFreshPOS');
const resetFreshRead = extractFunction(app, 'resetPosFreshReadDBPOS');
const renderer = extractFunction(app, 'renderInventario');

// Escritura única y confirmación real de la transacción.
assert.ok(writer.includes("conn.transaction(['inventory'], 'readwrite')"), 'La carga no usa una única transacción readwrite de Inventory.');
assert.strictEqual((writer.match(/conn\.transaction\(/g) || []).length, 1, 'La escritura atómica abre más de una transacción.');
assert.ok(writer.includes('transaction.oncomplete'), 'La operación no espera transaction.oncomplete.');
assert.ok(writer.includes('transaction.abort()'), 'La operación no aborta ante errores.');
assert.ok(writer.includes('store.put(row)'), 'La operación no escribe todos los movimientos dentro del mismo store.');

// Readback completo y tolerancia de eventId texto/número.
for (const token of ['eventId','loteCargaId','loteGroupKey','loteId','loteCodigo','productId','loteProductId','loteLetra','qty','source','type','time']){
  assert.ok(readback.includes(token), `El readback no valida ${token}.`);
}
assert.ok(readback.includes('samePosIdentityValuePOS'), 'El readback no normaliza eventId texto/número.');
assert.ok(readback.includes('rows.length !== expectedRows.length'), 'El readback no valida cantidad exacta de movimientos.');

// Orden crítico: escribir → oncomplete → readback → asignar → renderizar → éxito.
const order = [
  importer.indexOf('writeInventoryMovementsAtomicPOS(movements)'),
  importer.indexOf('transaction.oncomplete confirmado'),
  importer.indexOf('readbackNewLoteInventoryPOS({'),
  importer.indexOf('assignLoteAfterInventoryReadbackPOS({'),
  importer.indexOf('const renderResult = await renderInventario()'),
  importer.indexOf("showToast('Lote aplicado:")
];
assert.ok(order.every((value) => value >= 0), 'Falta un paso obligatorio del flujo.');
for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], 'El orden transaccional obligatorio fue alterado.');
assert.ok(!importer.includes('await addRestock('), 'La carga sigue abriendo una transacción por producto.');
assert.ok(importer.includes('rollbackNewLoteAssignmentPOS'), 'Falta rollback exclusivo de la asignación nueva.');
assert.ok(importer.includes('deleteInventoryMovementIdsAtomicPOS'), 'Falta rollback de movimientos confirmados si falla el paso final.');
assert.ok(importer.includes('No se asignó el lote ni quedaron movimientos parciales.'), 'Falta mensaje claro de carga fallida.');
assert.ok(!importer.includes('localStorage.clear(') && !importer.includes('indexedDB.deleteDatabase('), 'El flujo borra datos productivos.');
assert.ok(!importer.toLowerCase().includes('reempaque'), 'El flujo nuevo interfiere con Reempaque.');

// Lectura fresca separada, promesa compartida y reintento único.
assert.ok(app.includes('let posFreshReadOpenPromisePOS = null;'), 'Falta promesa compartida de apertura de lectura.');
assert.ok(app.includes('let posActiveWriteTransactionsPOS = 0;'), 'Falta control de escrituras activas.');
assert.ok(resetFreshRead.includes('await waitForPosWritesIdlePOS()'), 'La reapertura no espera escrituras activas.');
assert.ok(freshRead.includes('return readPosStoresFreshPOS(names, true)'), 'La lectura fresca no tiene reintento único.');
assert.ok(!freshRead.includes('db.close()'), 'La lectura fresca cierra la conexión global de escritura.');
assert.ok(app.includes("wordEl.textContent = 'sin lectura'"), 'Una falla de lectura todavía podría mostrarse como cero.');

// Render único con modelo verificable.
assert.ok(renderer.includes('const lotesModel = await renderLotesCargadosEvento(evId)'), 'Inventario no conserva el modelo leído.');
assert.ok(renderer.includes('return { ok:true, eventId:evId, lotesModel }'), 'Inventario no devuelve evidencia para verificar el render.');
assert.ok(app.includes('tr.dataset.loteGroupKey = String(row.groupKey || \'\')'), 'La fila no queda identificable para verificación inmediata.');

// Evidencia de navegador real con IndexedDB, persistencia, offline, aborto y responsive.
assert.strictEqual(browserReport.ok, true, 'El smoke real de navegador no terminó correctamente.');
const steps = new Map(browserReport.steps.map((step) => [step.step, step]));
for (const name of [
  'ui_success_transaction_readback','leave_and_return','reload_persistence','close_open_persistence',
  'offline_persistence','controlled_write_failure_abort','reempaque_adjust_excluded','responsive_themes_no_global_overflow'
]) assert.strictEqual(steps.get(name)?.ok, true, `Falló el paso real ${name}.`);
const success = steps.get('ui_success_transaction_readback').detail;
assert.strictEqual(success.inventoryCount, 2, 'La carga real no escribió todos los productos.');
assert.strictEqual(success.assignmentHistory, 1, 'La asignación real no quedó registrada una sola vez.');
assert.strictEqual(success.modelRows, 1, 'El lote real no apareció inmediatamente.');
const failure = steps.get('controlled_write_failure_abort').detail;
assert.strictEqual(failure.failRows, 0, 'La falla controlada dejó movimientos parciales.');
assert.strictEqual(failure.assignmentHistory, 0, 'La falla controlada agregó assignmentHistory.');
assert.strictEqual(failure.beforeCount, failure.afterCount, 'La falla controlada alteró Inventory.');
assert.strictEqual(steps.get('offline_persistence').detail.count, '1', 'El lote no persistió offline.');

// PWA/versionado de esta etapa.
assert.ok(release.includes("const suiteVersion = '4.20.99';"), 'Release general incorrecto.');
assert.ok(release.includes('const rev = 2;'), 'Revisión general incorrecta.');
assert.ok(build.includes(": '4.20.99';"), 'Build general incorrecto.');
assert.ok(build.includes("pos:'51'"), 'Build POS no avanzó.');
assert.ok(html.includes('lotes-historico-pwa-hardening-final-r2-m51'), 'Shell POS de la etapa incorrecto.');
assert.ok(html.includes('app.js?v=4.20.99&r=47'), 'Referencia de app.js incorrecta.');
assert.ok(html.includes('manifest.webmanifest?v=4.20.99&r=28'), 'Referencia de manifest incorrecta.');
assert.ok(html.includes('a33-release.js?v=4.20.99&r=61'), 'Referencia de release incorrecta.');
assert.ok(sw.includes("const MODULE_CACHE_REV = '51';"), 'Service Worker POS no avanzó.');
assert.strictEqual(manifest.start_url, './index.html?v=4.20.99&r=35', 'start_url del manifest incorrecto.');

console.log('SMOKE OK — Suite A33 POS Inventario Lotes cargados Etapa 1/2 Escritura + Readback');
