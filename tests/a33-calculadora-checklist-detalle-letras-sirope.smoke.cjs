'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'calculadora/index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'calculadora/sw.js'), 'utf8');

function bodyBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `No se pudo aislar ${startMarker}`);
  return html.slice(start, end);
}

const helpers = bodyBetween('    function a33ChecklistNumber(value)', '    function a33ChecklistEmptyState()');
const context = vm.createContext({
  Number, String, Object, Array, Map, Math, Intl,
  PRESENTACIONES:[
    {productId:'prod-g', letra:'G'},
    {productId:'prod-j', letra:'J'}
  ],
  a33NormalizeLetter:(value)=>String(value || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 4)
});
vm.runInContext(helpers + `\n;globalThis.__api={
  detail:a33ChecklistProductionDetail,
  formula:a33ChecklistSyrupFormula
};`, context, {filename:'calculadora-checklist-detalle.js'});

const api = context.__api;
assert.strictEqual(api.detail({productosProducidos:[
  {productId:'prod-g', cantidad:2, Letra:'G'},
  {productId:'prod-d', cantidad:3, snapshotProduccion:{letra:'D'}},
  {productId:'prod-j', cantidad:5},
  {productId:'prod-x', cantidad:0, Letra:'X'}
]}), '2G, 3D, 5J', 'El detalle no usa cantidades y Letras dinámicas');
assert.strictEqual(api.detail({productosProducidos:[
  {productId:'prod-g', cantidad:1, Letra:'Q'}
]}), '1Q', 'La Letra histórica debe prevalecer sobre Catálogos');
assert.strictEqual(api.detail({productosProducidos:[
  {productId:'prod-g', cantidad:2},
  {productId:'prod-g', cantidad:3}
]}), '5G', 'El fallback por productId no consolidó el producto dinámico');

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(api.formula(200))),
  {waterMl:175, sugarT:1},
  'La fórmula de 200 ml es incorrecta'
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(api.formula(2000))),
  {waterMl:1750, sugarT:10},
  'La fórmula de 2000 ml es incorrecta'
);
assert.strictEqual(api.formula(0), null, 'No debe mostrarse fórmula sin sirope');

assert.ok(html.includes('const syrupIngredient = ingredients.find((ingredient) => ingredient.key === "sirope");'), 'La fórmula no usa el sirope real del checklist');
assert.ok(html.includes('productionLine.textContent = "Producción: " + productionDetail;'), 'Falta presentación del detalle por Letras');
assert.ok(html.includes('waterLine.textContent = "Agua: "'), 'Falta presentación de Agua');
assert.ok(html.includes('sugarLine.textContent = "Azúcar: "'), 'Falta presentación de Azúcar');
assert.ok(!helpers.includes('setItem('), 'Los datos informativos no deben persistirse');
assert.ok(!helpers.includes('commitOfficialProduction'), 'Los datos informativos no deben crear movimientos');
assert.ok(html.includes('navigator.serviceWorker.register("./sw.js?v=4.20.98&r=12")'), 'Registro SW no actualizado');
assert.ok(sw.includes("const MODULE_CACHE_REV = '12';"), 'Cache del módulo no actualizado');
assert.ok(sw.includes("'./index.html?v=4.20.98&r=21'"), 'HTML precacheado no actualizado');

console.log('OK: Checklist muestra Letras dinámicas y fórmula escalada del sirope sin persistencia adicional.');
