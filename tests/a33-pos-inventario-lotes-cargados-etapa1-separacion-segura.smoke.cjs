// Coherencia de versiones y precache: a33-publicacion-coherencia.smoke.cjs.
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'pos/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pos/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'pos/sw.js'), 'utf8');

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

for (const id of ['btn-reverse-assign', 'btn-create-sobrante', 'reverso-panel', 'sobrante-panel']){
  assert.ok(operations.includes(`id="${id}"`), `${id} no quedó en el bloque operativo`);
  assert.ok(!history.includes(`id="${id}"`), `${id} sigue dentro de Lotes cargados`);
}

assert.ok(history.includes('class="lotes-block-head"'), 'Falta encabezado plegable');
assert.ok(history.includes('id="lotes-count"'), 'Falta contador real');
assert.ok(history.includes('id="tbl-lotes-evento"'), 'Falta tabla histórica');
assert.ok(history.includes('id="lotes-evento-content" class="lotes-evento-content" hidden'), 'El histórico no inicia cerrado');
assert.ok(history.includes('aria-expanded="false"'), 'El encabezado no inicia cerrado');
assert.ok(history.includes('aria-controls="lotes-evento-content"'), 'Falta vínculo accesible al contenido');
assert.ok(history.includes('class="lotes-toggle-indicator"'), 'Falta indicador visual');

const headers = Array.from(history.matchAll(/<th>([^<]+)<\/th>/g), m => m[1]);
assert.deepStrictEqual(headers, ['Código','Fecha'], 'Las columnas fijas del histórico no son Código y Fecha');
assert.ok(history.includes('id="lotes-evento-head-row"'), 'Falta anclaje para Letras dinámicas');

assert.ok(app.includes('function setupLotesCargadosDisclosurePOS()'), 'Falta configuración del desplegable');
assert.ok(app.includes("event.target.closest('.lotes-block-head')"), 'La detección no usa closest');
assert.ok(app.includes("if (name==='inventario') { setLotesCargadosExpandedPOS(false); renderInventario(); }"), 'Inventario no reinicia cerrado al volver');
assert.ok(!/(^|[^\w.])e\.target\.id/.test(app), 'Persiste dependencia directa de e.target.id');
assert.ok(!/(^|[^\w.])event\.target\.id/.test(app), 'Persiste dependencia directa de event.target.id');

assert.ok(css.includes('#lotes-evento-content[hidden]{display:none!important}'), 'El estado cerrado no está blindado');
assert.ok(css.includes('.lotes-block-head[aria-expanded="true"] .lotes-toggle-indicator'), 'El indicador no refleja apertura');
assert.ok(css.includes('.lotes-operativos-block'), 'Falta estilo del bloque operativo separado');


assert.ok(!app.includes('localStorage.clear('), 'Se agregó borrado global de localStorage');
assert.ok(!app.includes('indexedDB.deleteDatabase('), 'Se agregó borrado de IndexedDB');

console.log('SMOKE OK — POS Inventario — Lotes cargados Etapa 1 — Separación segura');
