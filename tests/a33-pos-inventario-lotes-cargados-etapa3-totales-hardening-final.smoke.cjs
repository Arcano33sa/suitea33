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

const history = between(
  html,
  '<div id="lotes-evento-block" class="lotes-block">',
  '<div id="reempaque-block" class="reempaque-block">'
);
const totalsLogic = between(
  app,
  'function renderLotesCargadosTotalsPOS(table, letters)',
  '// Lotes cargados en este evento (solo informativo)'
);
const renderLogic = between(
  app,
  'async function renderLotesCargadosEvento(eventId)',
  '// ==============================\n// Sobrantes → Lote hijo'
);

// Estructura: fila superior antes del encabezado dinámico y Código+Fecha combinados.
const totalsPos = history.indexOf('id="lotes-evento-totals-row"');
const headerPos = history.indexOf('id="lotes-evento-head-row"');
assert.ok(totalsPos >= 0 && headerPos > totalsPos, 'La fila TOTALES no está encima de los encabezados');
assert.ok(history.includes('class="lotes-totals-row"'), 'Falta clase visual de totales');
assert.ok(history.includes('<th scope="row" colspan="2">TOTALES</th>'), 'TOTALES no combina Código+Fecha');

// Fuente única: las cifras se leen únicamente desde tbody ya renderizado.
assert.ok(totalsLogic.includes("table.querySelectorAll('tbody tr')"), 'Los totales no usan las filas renderizadas');
assert.ok(totalsLogic.includes('renderedRow.children'), 'Los totales no leen las celdas renderizadas');
assert.ok(!totalsLogic.includes('getInventoryEntries'), 'Los totales consultan Inventario');
assert.ok(!totalsLogic.includes('buildLotesCargadosHistoryModelPOS'), 'Los totales recalculan el modelo histórico');
assert.ok(!totalsLogic.includes('localStorage'), 'Los totales persisten datos');
assert.ok(!totalsLogic.includes("put('inventory'"), 'Los totales modifican Inventario');
assert.ok(!totalsLogic.includes('addRestock('), 'Los totales modifican stock');
assert.ok(totalsLogic.includes('!Number.isFinite(value) || value < 0'), 'Falta ignorar NaN/indefinidos/negativos');
assert.ok(renderLogic.includes('renderLotesCargadosTotalsPOS(table, letters);'), 'El render no actualiza los totales');

// Ejecutar la función real con DOM mínimo y valores problemáticos.
class FakeElement {
  constructor(tagName){
    this.tagName = String(tagName || '').toUpperCase();
    this.children = [];
    this._textContent = '';
    this.scope = '';
    this.colSpan = 1;
  }
  appendChild(child){ this.children.push(child); return child; }
  set textContent(value){
    this._textContent = String(value == null ? '' : value);
    if (this._textContent === '') this.children = [];
  }
  get textContent(){
    return this.children.length
      ? this.children.map(child => child.textContent).join('')
      : this._textContent;
  }
}
function row(values){
  const tr = new FakeElement('tr');
  tr.children = values.map(value => {
    const td = new FakeElement('td');
    td.textContent = value;
    return td;
  });
  return tr;
}
function tableFixture(rows){
  const totalsRow = new FakeElement('tr');
  return {
    totalsRow,
    table: {
      querySelector(selector){ return selector === '#lotes-evento-totals-row' ? totalsRow : null; },
      querySelectorAll(selector){ return selector === 'tbody tr' ? rows : []; }
    }
  };
}

const start = app.indexOf('function renderLotesCargadosTotalsPOS(table, letters)');
const end = app.indexOf('// Lotes cargados en este evento (solo informativo)', start);
assert.ok(start >= 0 && end > start, 'No se pudo aislar la función de totales');
const functionSource = app.slice(start, end);
const sandbox = {
  Array,
  Number,
  String,
  document:{ createElement(tagName){ return new FakeElement(tagName); } }
};
vm.createContext(sandbox);
vm.runInContext(`${functionSource}\nthis.renderTotals = renderLotesCargadosTotalsPOS;`, sandbox);

const fixture = tableFixture([
  row(['A33-001', '01/08/2026', '2', '3', '0']),
  row(['A33-002', '02/08/2026', '4', '-9', 'NaN']),
  row(['A33-003', '03/08/2026', 'null', 'undefined', '5']),
  row(['mensaje sin columnas'])
]);
sandbox.renderTotals(fixture.table, ['G', 'D', 'X']);
assert.strictEqual(fixture.totalsRow.children.length, 4, 'Cantidad de celdas de totales incorrecta');
assert.strictEqual(fixture.totalsRow.children[0].textContent, 'TOTALES', 'Etiqueta superior incorrecta');
assert.strictEqual(fixture.totalsRow.children[0].colSpan, 2, 'Código+Fecha no están combinados');
assert.deepStrictEqual(
  fixture.totalsRow.children.slice(1).map(cell => cell.textContent),
  ['6', '3', '5'],
  'Totales incorrectos o no se ignoraron valores inválidos/negativos'
);

// Sin registros: cada Letra debe mostrar 0.
const empty = tableFixture([]);
sandbox.renderTotals(empty.table, ['G', 'D']);
assert.deepStrictEqual(empty.totalsRow.children.slice(1).map(cell => cell.textContent), ['0', '0'], 'Las Letras vacías no muestran 0');

// Muchas Letras y muchos registros.
const manyLetters = Array.from({length:40}, (_, index)=>`L${index + 1}`);
const manyRows = Array.from({length:120}, (_, rowIndex)=>
  row(['LOT-' + rowIndex, '02/08/2026', ...manyLetters.map((_, letterIndex)=>String((rowIndex + letterIndex) % 3))])
);
const many = tableFixture(manyRows);
sandbox.renderTotals(many.table, manyLetters);
assert.strictEqual(many.totalsRow.children.length, 41, 'Muchas Letras fueron recortadas en totales');
for (let letterIndex = 0; letterIndex < manyLetters.length; letterIndex += 1){
  const expected = manyRows.reduce((sum, renderedRow)=>sum + Number(renderedRow.children[letterIndex + 2].textContent), 0);
  assert.strictEqual(Number(many.totalsRow.children[letterIndex + 1].textContent), expected, `Total incorrecto en ${manyLetters[letterIndex]}`);
}

// Diseño premium, claro/oscuro y scroll contenido.
assert.ok(css.includes('#tbl-lotes-evento .lotes-totals-row th'), 'Falta estilo de la fila superior');
assert.ok(css.includes('text-align:center'), 'Los números de totales no están centrados');
assert.ok(css.includes('font-variant-numeric:tabular-nums'), 'Falta alineación numérica estable');
assert.ok(css.includes('#tbl-lotes-evento .lotes-totals-row th:nth-child(n+2)') && css.includes('min-width:64px'), 'Los totales por Letra no conservan el ancho de sus columnas');
assert.ok(css.includes('html[data-theme="light"] #tbl-lotes-evento .lotes-totals-row th'), 'Falta estilo claro');
assert.ok(css.includes('#lotes-evento-content .table-scroll') && css.includes('overscroll-behavior-x:contain'), 'El scroll no queda contenido');
assert.ok(css.includes('body{overflow-x:hidden}'), 'Se perdió el blindaje contra scroll horizontal general');
assert.ok(css.includes('@media (max-width:560px)'), 'Falta responsive móvil');

// Regresión: operaciones y módulos críticos siguen presentes.
for (const token of [
  'id="btn-inv-from-lote"',
  'id="btn-reverse-assign"',
  'id="btn-create-sobrante"',
  'id="reverso-panel"',
  'id="sobrante-panel"',
  'id="reempaque-block"'
]) assert.ok(html.includes(token), `Regresión estructural: falta ${token}`);
for (const token of [
  'async function reverseAssignSelectedLotePOS',
  'async function createSobranteLotPOS',
  'async function renderInventario',
  'async function renderLotesCargadosEvento'
]) assert.ok(app.includes(token), `Regresión lógica: falta ${token}`);
for (const dir of ['calculadora', 'calculadora_temporal', 'lotes', 'inventario', 'firebase']){
  assert.ok(fs.existsSync(path.join(root, dir)), `Falta módulo ${dir}`);
}

// PWA coordinada solo para POS.
assert.ok(sw.includes("const MODULE_CACHE_REV = '49';"), 'Caché POS no actualizado');
assert.ok(sw.includes("'./index.html?v=4.20.97&r=32'"), 'Precache HTML no coordinado');
assert.ok(sw.includes("'./styles.css?v=4.20.97&r=24'"), 'Precache CSS no coordinado');
assert.ok(sw.includes("'./app.js?v=4.20.97&r=45'"), 'Precache JS no coordinado');
assert.ok(sw.includes("'./manifest.webmanifest?v=4.20.97&r=25'"), 'Precache manifest no coordinado');
assert.ok(html.includes('styles.css?v=4.20.97&r=24'), 'HTML no apunta al CSS nuevo');
assert.ok(html.includes('app.js?v=4.20.97&r=45'), 'HTML no apunta al JS nuevo');
assert.ok(html.includes('manifest.webmanifest?v=4.20.97&r=25'), 'HTML no apunta al manifest nuevo');
assert.ok(html.includes("pos-r'+rev+'-m49"), 'Diagnóstico de caché no coordinado');
assert.strictEqual(manifest.start_url, './index.html?v=4.20.97&r=32', 'start_url PWA no coordinado');
assert.ok(!app.includes('localStorage.clear('), 'Se agregó borrado global de localStorage');
assert.ok(!app.includes('indexedDB.deleteDatabase('), 'Se agregó borrado de IndexedDB');

console.log('SMOKE OK — POS Inventario — Lotes cargados Etapa 3 — Totales superiores y hardening final');
