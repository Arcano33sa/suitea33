'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'pos/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pos/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'pos/sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'pos/manifest.webmanifest'), 'utf8'));

function between(source, startToken, endToken){
  const start = source.indexOf(startToken);
  assert.ok(start >= 0, `No se encontró: ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(end > start, `No se encontró cierre después de: ${startToken}`);
  return source.slice(start, end);
}

const operations = between(
  html,
  '<div id="lotes-operativos-block" class="lotes-operativos-block">',
  '<div id="lotes-evento-block" class="lotes-block">'
);
const history = between(
  html,
  '<div id="lotes-evento-block" class="lotes-block">',
  '<div id="reempaque-block" class="reempaque-block">'
);
const historyLogic = between(
  app,
  'function loteHistoryLetterSnapshotPOS(entry)',
  '// ==============================\n// Sobrantes → Lote hijo'
);

// Separación operativa intacta.
for (const id of ['btn-reverse-assign', 'btn-create-sobrante', 'reverso-panel', 'sobrante-panel']){
  assert.ok(operations.includes(`id="${id}"`), `${id} no quedó en el bloque operativo`);
  assert.ok(!history.includes(`id="${id}"`), `${id} entró en el histórico`);
}

// El HTML conserva solo columnas fijas; las Letras nacen del histórico real.
assert.ok(history.includes('id="lotes-evento-head-row"'), 'Falta fila de encabezado dinámico');
const staticHeaders = Array.from(history.matchAll(/<th>([^<]+)<\/th>/g), match => match[1]);
assert.deepStrictEqual(staticHeaders, ['Código', 'Fecha'], 'El HTML conserva Letras hardcodeadas');
for (const legacyLetter of ['P', 'M', 'D', 'L', 'G']){
  assert.ok(!history.includes(`<th>${legacyLetter}</th>`), `La Letra ${legacyLetter} sigue hardcodeada`);
}

// El histórico no consulta Catálogos ni deriva identidad desde nombres actuales.
assert.ok(historyLogic.includes('row.loteLetra'), 'No usa la Letra fotografiada al cargar');
assert.ok(historyLogic.includes('buildLotesCargadosHistoryModelPOS'), 'Falta modelo dinámico del histórico');
assert.ok(!historyLogic.includes("getAll('products')"), 'El histórico consulta Productos actuales');
assert.ok(!historyLogic.includes('presKeyFromProductNamePOS'), 'El histórico recalcula Letras por nombre');
assert.ok(!historyLogic.includes("mapProductNameToFinishedId"), 'El histórico convierte presentaciones legacy');
assert.ok(!historyLogic.includes("put('inventory'"), 'El render modifica registros históricos');
assert.ok(!historyLogic.includes("addRestock("), 'El render toca Inventario');
assert.ok(!historyLogic.includes('createSobranteFromAssignedLotPOS'), 'El histórico toca Crear lote sobrante');
assert.ok(!historyLogic.includes('reverseAssignedLotPOS'), 'El histórico toca Reversar asignación');

// Ejecutar el modelo puro con históricos, Letra nueva, reverso y un registro sin Letra.
const pureStart = app.indexOf('function loteHistoryLetterSnapshotPOS(entry)');
const pureEnd = app.indexOf('function renderLotesCargadosHeaderPOS(table, letters)', pureStart);
assert.ok(pureStart >= 0 && pureEnd > pureStart, 'No se pudo aislar el modelo puro');
const pureSource = app.slice(pureStart, pureEnd);
const sandbox = { Map, Set, Object, Array, Number, String };
vm.createContext(sandbox);
vm.runInContext(`
  function productIdentityNormPOS(value){ return String(value == null ? '' : value).trim(); }
  function normalizeLoteContentLetterPOS(value){ return productIdentityNormPOS(value).toUpperCase(); }
  ${pureSource}
  this.buildModel = buildLotesCargadosHistoryModelPOS;
`, sandbox);

const fixture = [
  { id:1, eventId:7, type:'restock', source:'lote', loteCodigo:'A33-001', loteCargaId:'c1', loteLetra:'G', qty:2, time:'2026-08-01T10:00:00.000Z', productId:10 },
  { id:2, eventId:7, type:'restock', source:'lote', loteCodigo:'A33-001', loteCargaId:'c1', loteLetra:'D', qty:3, time:'2026-08-01T10:00:00.000Z', productId:11 },
  { id:3, eventId:7, type:'restock', source:'lote', loteCodigo:'A33-002', loteCargaId:'c2', loteLetra:'X', qty:4, time:'2026-08-02T11:00:00.000Z', productId:99 },
  { id:4, eventId:7, type:'restock', source:'lote', loteCodigo:'A33-002', loteCargaId:'c2', loteLetra:'G', qty:1, time:'2026-08-02T11:00:00.000Z', productId:10 },
  { id:5, eventId:7, type:'restock', source:'lote', loteCodigo:'LEGACY-SIN-LETRA', loteCargaId:'c3', qty:8, time:'2026-07-30T08:00:00.000Z', productId:12 },
  { id:6, eventId:7, type:'adjust', source:'lote_reverso', loteGroupKey:'c1', qty:-5, time:'2026-08-02T12:00:00.000Z' }
];
const before = JSON.stringify(fixture);
const model = sandbox.buildModel(fixture);
assert.strictEqual(JSON.stringify(fixture), before, 'El modelo mutó los registros históricos');
assert.deepStrictEqual(Array.from(model.letters), ['G', 'D', 'X'], 'No conserva orden existente o no agrega la Letra nueva al final');
assert.strictEqual(model.groups.length, 3, 'Se perdió un registro histórico sin Letra');
assert.strictEqual(model.groups[0].loteCodigo, 'A33-002', 'El histórico no ordena cargas recientes primero');
assert.strictEqual(Number(model.groups[0].quantities.X), 4, 'Cantidad de Letra nueva incorrecta');
assert.strictEqual(Number(model.groups[0].quantities.G), 1, 'Cantidad dinámica incorrecta');
const reversed = model.groups.find(group => group.groupKey === 'c1');
assert.ok(reversed && reversed.reversedAt, 'El reverso dejó de marcarse visualmente');
assert.strictEqual(Number(reversed.quantities.G), 2, 'El reverso alteró la fotografía original');
assert.strictEqual(Number(reversed.quantities.D), 3, 'El reverso alteró cantidades originales');

// Muchas Letras: sin límite hardcodeado y orden estable.
const many = Array.from({ length:30 }, (_, index) => ({
  id:100 + index,
  type:'restock',
  source:'lote',
  loteCodigo:'MULTI',
  loteCargaId:'multi',
  loteLetra:`Z${String(index + 1).padStart(2, '0')}`,
  qty:index + 1,
  time:'2026-08-02T15:00:00.000Z'
}));
const manyModel = sandbox.buildModel(many);
assert.strictEqual(manyModel.letters.length, 30, 'Muchas Letras fueron recortadas');
assert.strictEqual(manyModel.letters[29], 'Z30', 'El orden dinámico de muchas Letras cambió');
assert.strictEqual(Number(manyModel.groups[0].quantities.Z30), 30, 'Cantidad de la última Letra incorrecta');

// Responsive: el scroll queda contenido en la tabla.
assert.ok(css.includes('#lotes-evento-content .table-scroll'), 'Falta contención específica del scroll');
assert.ok(css.includes('overscroll-behavior-x:contain'), 'El scroll horizontal no está contenido');
assert.ok(css.includes('#tbl-lotes-evento{') && css.includes('width:max-content') && css.includes('min-width:100%'), 'La tabla no crece dinámicamente');
assert.ok(css.includes('#tbl-lotes-evento th:nth-child(n+3)') && css.includes('min-width:64px'), 'Las Letras pueden comprimirse sin activar scroll interno');
assert.ok(css.includes('@media (max-width:560px)'), 'Falta ajuste móvil');
assert.ok(css.includes('body{overflow-x:hidden}'), 'Se perdió el blindaje contra scroll general');

// PWA coordinada.
assert.ok(sw.includes("const MODULE_CACHE_REV = '49';"), 'No se incrementó caché POS');
assert.ok(sw.includes("'./index.html?v=4.20.97&r=32'"), 'Precache HTML no coordinado');
assert.ok(sw.includes("'./styles.css?v=4.20.97&r=24'"), 'Precache CSS no coordinado');
assert.ok(sw.includes("'./app.js?v=4.20.97&r=45'"), 'Precache JS no coordinado');
assert.ok(sw.includes("'./manifest.webmanifest?v=4.20.97&r=25'"), 'Precache manifest no coordinado');
assert.ok(html.includes('styles.css?v=4.20.97&r=24'), 'HTML no apunta al CSS nuevo');
assert.ok(html.includes('app.js?v=4.20.97&r=45'), 'HTML no apunta al JS nuevo');
assert.ok(html.includes('manifest.webmanifest?v=4.20.97&r=25'), 'HTML no apunta al manifest nuevo');
assert.ok(html.includes("pos-r'+rev+'-m49"), 'Diagnóstico de caché no coordinado');
assert.strictEqual(manifest.start_url, './index.html?v=4.20.97&r=32', 'start_url PWA no coordinado');

// Sin borrados destructivos.
assert.ok(!app.includes('localStorage.clear('), 'Se agregó borrado global de localStorage');
assert.ok(!app.includes('indexedDB.deleteDatabase('), 'Se agregó borrado de IndexedDB');

console.log('SMOKE OK — POS Inventario — Lotes cargados Etapa 2 — Letras dinámicas únicamente para el histórico');
