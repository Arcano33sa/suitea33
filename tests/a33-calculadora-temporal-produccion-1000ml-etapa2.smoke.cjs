'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'calculadora_temporal/index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'calculadora_temporal/sw.js'), 'utf8');

assert.ok(html.includes('id="btn-produccion"'), 'Falta botón Producción temporal');
assert.ok(html.includes('id="btn-checklist"'), 'Falta acceso al Checklist temporal');
assert.ok(html.includes('id="a33-modal-produccion"'), 'Falta modal Producción temporal');
assert.ok(html.includes('id="a33-produccion-cancelar"'), 'Falta Cancelar');
assert.ok(html.includes('id="a33-produccion-guardar"'), 'Falta Guardar');
assert.ok(!html.includes('Guardar en Checklist'), 'El botón debe llamarse solamente Guardar');
assert.ok(html.includes('id="a33-temporal-checklist"'), 'Falta vista de Checklist temporal');
assert.ok(html.includes('const STORAGE_PRODUCTION_CHECKLIST_KEY = "arcano33_temporal_produccion_checklists_v1";'), 'Falta almacenamiento temporal independiente');
assert.ok(html.includes('origenChecklist:"temporal-produccion-1000ml"'), 'Falta identidad temporal');
assert.ok(html.includes('record.closed = true;'), 'Falta cierre del checklist');
assert.ok(html.includes('Marca todos los checkbox antes de pulsar Hecho.'), 'Falta validación de cierre');

const productionStart = html.indexOf('    const A33_TEMPORAL_PRODUCTION_BASE_ML = 1000;');
const productionEnd = html.indexOf('    function capturarPlanTemporal()', productionStart);
assert.ok(productionStart >= 0 && productionEnd > productionStart, 'No se pudo aislar Producción temporal');
const productionBlock = html.slice(productionStart, productionEnd);
assert.ok(!productionBlock.includes('commitOfficialProduction'), 'Producción temporal no debe confirmar producción oficial');
assert.ok(!productionBlock.includes('arcano33_lotes'), 'Producción temporal no debe tocar lotes oficiales');
assert.ok(productionBlock.includes('writeTemporalData(STORAGE_PRODUCTION_CHECKLIST_KEY'), 'Guardar debe usar almacenamiento temporal');

const calculationStart = productionBlock.indexOf('    function a33TemporalProductionCalculation(totalMl)');
const calculationEnd = productionBlock.indexOf('    function a33TemporalProductionNumber(value)', calculationStart);
assert.ok(calculationStart >= 0 && calculationEnd > calculationStart, 'No se pudo aislar la fórmula temporal');
const calculationCode = `
const INGREDIENTES = ["vino", "vodka", "jugo", "sirope", "agua"];
const A33_TEMPORAL_PRODUCTION_BASE_ML = 1000;
const A33_TEMPORAL_PRODUCTION_FORMULA = Object.freeze({ vino:450, vodka:100, jugo:150, sirope:150, agua:150 });
${productionBlock.slice(calculationStart, calculationEnd)}
globalThis.__calculate = a33TemporalProductionCalculation;
`;
const context = vm.createContext({ Number, Object });
vm.runInContext(calculationCode, context, { filename:'calculadora-temporal-produccion-1000ml.js' });
const result = context.__calculate(1500);
assert.strictEqual(result.totalMl, 1500);
assert.strictEqual(result.ingredients.vino, 675);
assert.strictEqual(result.ingredients.vodka, 150);
assert.strictEqual(result.ingredients.jugo, 225);
assert.strictEqual(result.ingredients.sirope, 225);
assert.strictEqual(result.ingredients.agua, 225);
assert.strictEqual(context.__calculate(0), null);

assert.ok(html.includes('navigator.serviceWorker.register("./sw.js?v=4.20.98&r=4")'), 'Registro SW temporal no actualizado');
assert.ok(sw.includes("const MODULE_CACHE_REV = '5';"), 'Cache temporal no incrementado');
assert.ok(sw.includes("'./index.html?v=4.20.98&r=11'"), 'Precache temporal no apunta al HTML nuevo');

console.log('PASS a33-calculadora-temporal-produccion-1000ml-etapa2: fórmula, checklist, aislamiento y caché cubiertos');
