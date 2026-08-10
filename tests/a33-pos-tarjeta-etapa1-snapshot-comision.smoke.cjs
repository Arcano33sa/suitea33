'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'pos/index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'pos/sw.js'), 'utf8');
const backup = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
const cloud = fs.readFileSync(path.join(root, 'assets/js/a33-cloud-sync.js'), 'utf8');

function between(source, startToken, endToken){
  const start = source.indexOf(startToken);
  assert.ok(start >= 0, `No se encontró ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(end > start, `No se encontró cierre para ${startToken}`);
  return source.slice(start, end);
}

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const moneyEquals = (a,b) => Math.abs(Number(a) - Number(b)) <= 0.001;
const getSaleLineCostSnapshotPOS = sale => Number(sale.lineCost || sale.costTotal || 0);

const bankBlock = between(app, 'function normalizePaymentMethodPOS(payment)', 'function isBankForPaymentPOS(bank, payment)');
const sandbox = { round2, moneyEquals, getSaleLineCostSnapshotPOS, Number, String, Object, Math };
vm.createContext(sandbox);
vm.runInContext(`${bankBlock}\nthis.api={normalizePaymentMethodPOS,normalizeBankTypePOS,getBankTypePOS,normalizeBankCommissionPOS,getBankCommissionPctPOS,formatBankCommissionPctLabelPOS,buildSaleCardCommissionSnapshotPOS,applySaleCardCommissionSnapshotPOS,validateSaleCardCommissionSnapshotPOS};`, sandbox);
const api = sandbox.api;

// 1) Banco Tarjeta 7% + snapshot económico.
const bank7 = { id: 101, name: 'LAFISE', type: 'tarjeta', commissionPct: 7, isActive: true };
let economic = { ventaNeta:100, lineCost:20, costTotal:20, utilidad:80, utility:80, lineProfit:80, profit:80 };
const snap7 = api.buildSaleCardCommissionSnapshotPOS({ payment:'tarjeta', bank:bank7, ventaNeta:economic.ventaNeta, utilidadAntesComision:economic.utilidad, courtesy:false });
assert.deepStrictEqual(JSON.parse(JSON.stringify(snap7)), {
  bankId:101,
  bankName:'LAFISE',
  bankType:'tarjeta',
  commissionPctSnapshot:7,
  commissionAmountSnapshot:7,
  commissionLabelSnapshot:'Comisión LAFISE 7%',
  utilidadAntesComision:80,
  utilidadDespuesComision:73
});
api.applySaleCardCommissionSnapshotPOS(economic, snap7);
assert.strictEqual(economic.costTotal, 20, 'La comisión alteró el costo del producto');
assert.strictEqual(economic.utilidad, 73, 'La utilidad económica final no descuenta comisión');

const sale7 = { payment:'tarjeta', total:100, lineCost:20, courtesy:false, ...economic };
assert.strictEqual(api.validateSaleCardCommissionSnapshotPOS(sale7).ok, true, 'Snapshot Tarjeta 7% no valida');

// 2) Cambiar catálogo a 8% no reescribe la venta anterior.
const archived7 = JSON.parse(JSON.stringify(sale7));
const bank8 = { ...bank7, commissionPct:8 };
let economic8 = { ventaNeta:100, lineCost:20, costTotal:20, utilidad:80, utility:80, lineProfit:80, profit:80 };
const snap8 = api.buildSaleCardCommissionSnapshotPOS({ payment:'tarjeta', bank:bank8, ventaNeta:100, utilidadAntesComision:80, courtesy:false });
api.applySaleCardCommissionSnapshotPOS(economic8, snap8);
assert.strictEqual(archived7.commissionPctSnapshot, 7, 'Venta anterior fue recalculada al cambiar catálogo');
assert.strictEqual(archived7.commissionAmountSnapshot, 7, 'Monto histórico 7% cambió');
assert.strictEqual(snap8.commissionPctSnapshot, 8, 'Nueva venta no toma 8%');
assert.strictEqual(snap8.commissionAmountSnapshot, 8, 'Nueva comisión 8% incorrecta');
assert.strictEqual(economic8.utilidad, 72, 'Nueva utilidad 8% incorrecta');

// 3) Porcentaje decimal y etiqueta dinámica.
const bank65 = { id:102, name:'BANPRO', type:'tarjeta', commissionPct:6.5 };
const snap65 = api.buildSaleCardCommissionSnapshotPOS({ payment:'tarjeta', bank:bank65, ventaNeta:200, utilidadAntesComision:150, courtesy:false });
assert.strictEqual(snap65.commissionLabelSnapshot, 'Comisión BANPRO 6.5%');
assert.strictEqual(snap65.commissionAmountSnapshot, 13);

// 4) Cortesía: conserva snapshot bancario pero comisión monetaria = 0.
let courtesyEconomic = { ventaNeta:0, lineCost:20, costTotal:20, utilidad:-20, utility:-20, lineProfit:-20, profit:-20 };
const courtesySnap = api.buildSaleCardCommissionSnapshotPOS({ payment:'tarjeta', bank:bank7, ventaNeta:0, utilidadAntesComision:-20, courtesy:true });
api.applySaleCardCommissionSnapshotPOS(courtesyEconomic, courtesySnap);
assert.strictEqual(courtesySnap.commissionAmountSnapshot, 0, 'Cortesía generó comisión');
assert.strictEqual(courtesyEconomic.utilidad, -20, 'Cortesía alteró utilidad por comisión');
assert.strictEqual(api.validateSaleCardCommissionSnapshotPOS({payment:'tarjeta',total:0,lineCost:20,courtesy:true,...courtesyEconomic}).ok, true);

// 5) Reverso/devolución económica: neto y costo negativos revierten también comisión embebida.
let returnEconomic = { ventaNeta:-100, lineCost:-20, costTotal:-20, utilidad:-80, utility:-80, lineProfit:-80, profit:-80 };
const returnSnap = api.buildSaleCardCommissionSnapshotPOS({ payment:'tarjeta', bank:bank7, ventaNeta:-100, utilidadAntesComision:-80, courtesy:false });
api.applySaleCardCommissionSnapshotPOS(returnEconomic, returnSnap);
assert.strictEqual(returnSnap.commissionAmountSnapshot, -7, 'Devolución no revierte comisión económica');
assert.strictEqual(returnEconomic.utilidad, -73, 'Devolución no conserva coherencia económica');

// 6) Métodos no Tarjeta no reciben comisión ni cambian economía.
for (const payment of ['efectivo','transferencia','credito']){
  assert.strictEqual(api.buildSaleCardCommissionSnapshotPOS({ payment, bank:bank7, ventaNeta:100, utilidadAntesComision:80, courtesy:false }), null, `${payment} recibió comisión Tarjeta`);
}

// 7) Integración en ambos flujos de venta y validación bloqueante.
assert.strictEqual((app.match(/const cardCommissionSnapshot = buildSaleCardCommissionSnapshotPOS\(\{/g) || []).length, 2, 'Snapshot no está aplicado a venta normal + extra exactamente');
assert.strictEqual((app.match(/validateSaleCardCommissionSnapshotPOS\(saleRecord\)/g) || []).length, 2, 'Validación Tarjeta no está aplicada a ambos flujos');
assert.ok(app.includes('selectedBankForSale = found;'), 'No se congela el banco seleccionado');
for (const field of ['commissionPctSnapshot','commissionAmountSnapshot','commissionLabelSnapshot','utilidadAntesComision','utilidadDespuesComision']){
  assert.ok(app.includes(field), `Falta campo ${field}`);
}

// 8) JSON conserva el mismo registro íntegro; sin colección/movimiento paralelo de comisión.
const jsonRoundtrip = JSON.parse(JSON.stringify({ sales:[archived7] }));
assert.strictEqual(jsonRoundtrip.sales[0].commissionPctSnapshot, 7);
assert.strictEqual(jsonRoundtrip.sales[0].commissionLabelSnapshot, 'Comisión LAFISE 7%');
assert.ok(backup.includes('async function buildFullBackup()'), 'Respaldo JSON completo ausente');
assert.ok(backup.includes('indexedDB: cleanIndexed.data'), 'JSON no conserva IndexedDB completo');
assert.ok(!/put\(['\"](?:commissions|comisiones)['\"]|add\(['\"](?:commissions|comisiones)['\"]/.test(app), 'Se creó store/movimiento independiente de comisión');
assert.ok(app.includes("await del('sales', id)"), 'Reverso/borrado dejó de eliminar el registro completo de venta');

// Firebase conserva alcance actual local-first para ventas: no se crea colección paralela ni duplicación.
assert.ok(cloud.includes('Ventas, Finanzas y Caja Chica permanecen locales.'), 'Se alteró alcance Firebase de ventas');
assert.ok(!/collection[^\n]*(commission|comision)|commission[^\n]*collection/i.test(cloud), 'Se creó colección Firebase paralela de comisión');

// 9) Cache POS actualizado porque app.js cambió.
assert.ok(html.includes("-pos-r'+rev+'-m53"), 'HTML no expone cache POS m53');
assert.ok(html.includes('app.js?v=4.20.97&r=49'), 'HTML no carga app.js revisado');
assert.ok(sw.includes("const MODULE_CACHE_REV = '53';"), 'SW no incrementó cache POS');
assert.ok(sw.includes("'./app.js?v=4.20.97&r=49'"), 'SW no precachea app.js revisado');

// 10) Regresión estructural crítica.
for (const token of [
  'async function addSale()',
  'async function addExtraSale(extraId)',
  'async function ensurePhysicalCupConsumptionForSalePOS',
  'async function reempaqueSaveRecordPOS',
  'async function createJournalEntryForSalePOS',
  'async function renderSummary',
  'async function exportEventExcel'
]) assert.ok(app.includes(token), `Regresión: falta ${token}`);

console.log('SMOKE OK — Suite A33 — POS Tarjeta — Etapa 1/5 — snapshot comisión y utilidad económica');
