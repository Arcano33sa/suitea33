'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');
const posHtml = fs.readFileSync(path.join(root, 'pos/index.html'), 'utf8');
const posSw = fs.readFileSync(path.join(root, 'pos/sw.js'), 'utf8');
const fin = fs.readFileSync(path.join(root, 'finanzas/script.js'), 'utf8');
const finHtml = fs.readFileSync(path.join(root, 'finanzas/index.html'), 'utf8');
const backup = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');

function between(source, startToken, endToken){
  const start = source.indexOf(startToken);
  assert.ok(start >= 0, `No se encontró ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(end > start, `No se encontró cierre para ${startToken}`);
  return source.slice(start, end);
}

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const moneyEquals = (a,b) => Math.abs(Number(a) - Number(b)) <= 0.001;
const getSaleLineCostSnapshotPOS = sale => Number(sale && (sale.lineCost ?? sale.costTotal) || 0);
const isCourtesySalePOS = sale => !!(sale && (sale.courtesy || sale.isCourtesy));

let dbSales = [];
let dbBanks = [];
let puts = [];
const sandbox = {
  round2, moneyEquals, getSaleLineCostSnapshotPOS, isCourtesySalePOS,
  Number, String, Object, Math, Map, Array, Date,
  getAll: async store => store === 'sales' ? dbSales : (store === 'banks' ? dbBanks : []),
  getAllBanksSafe: async () => dbBanks,
  put: async (store, rec) => { assert.strictEqual(store, 'sales'); puts.push(JSON.parse(JSON.stringify(rec))); }
};
vm.createContext(sandbox);
const cardBlock = between(app, 'function normalizePaymentMethodPOS(payment)', 'function isBankForPaymentPOS(bank, payment)');
vm.runInContext(`${cardBlock}\nthis.api={buildSaleCardCommissionSnapshotPOS,collectSaleCardCommissionsPOS,getSaleUtilityBeforeCommissionPOS,getSaleUtilityAfterCommissionPOS,backfillLegacyCardCommissionSnapshotsPOS};`, sandbox);
const api = sandbox.api;

// 1) Referencia conocida EXPOBODA 2026: 3,190 x 7% = 223.30, sin hardcode en producción.
const expoboda = api.buildSaleCardCommissionSnapshotPOS({
  payment:'tarjeta',
  bank:{id:7,name:'LAFISE',type:'tarjeta',commissionPct:7},
  ventaNeta:3190,
  utilidadAntesComision:2000,
  courtesy:false
});
assert.strictEqual(expoboda.commissionAmountSnapshot, 223.30);
assert.strictEqual(expoboda.commissionLabelSnapshot, 'Comisión LAFISE 7%');
assert.strictEqual(expoboda.utilidadDespuesComision, 1776.70);
assert.ok(!/EXPOBODA|3190|223\.30/.test(cardBlock), 'Se hardcodeó el caso de prueba en producción');

// 2) Multibanco: agrupación exacta por snapshot de etiqueta/tasa; no se fusiona.
const multi = api.collectSaleCardCommissionsPOS([
  {payment:'tarjeta', total:3190, commissionAmountSnapshot:223.30, commissionLabelSnapshot:'Comisión LAFISE 7%', utilidadAntesComision:2000, utilidadDespuesComision:1776.70},
  {payment:'tarjeta', total:900, commissionAmountSnapshot:45, commissionLabelSnapshot:'Comisión BAC 5%', utilidadAntesComision:600, utilidadDespuesComision:555},
  {payment:'efectivo', total:1000, commissionAmountSnapshot:999, commissionLabelSnapshot:'Comisión falsa 99%'},
  {payment:'transferencia', total:1000, commissionAmountSnapshot:999, commissionLabelSnapshot:'Comisión falsa 99%'},
  {payment:'credito', total:1000, commissionAmountSnapshot:999, commissionLabelSnapshot:'Comisión falsa 99%'},
  {payment:'tarjeta', total:500, commissionAmountSnapshot:null, commissionLabelSnapshot:'Comisión no determinada', commissionSnapshotStatus:'no_determinada'}
]);
assert.strictEqual(multi.total, 268.30);
assert.deepStrictEqual(JSON.parse(JSON.stringify(multi.byLabel)), [
  {label:'Comisión BAC 5%',total:45,count:1},
  {label:'Comisión LAFISE 7%',total:223.30,count:1}
]);
assert.strictEqual(multi.undeterminedCount, 1);
for (const payment of ['efectivo','transferencia','credito']) {
  assert.strictEqual(api.buildSaleCardCommissionSnapshotPOS({payment,bank:{id:7,name:'LAFISE',type:'tarjeta',commissionPct:7},ventaNeta:100,utilidadAntesComision:80,courtesy:false}), null, `${payment} recibió comisión Tarjeta`);
}

// 3) La utilidad baja por comisión, Venta Neta/costo no se recalculan.
const modern = {payment:'tarjeta',total:3190,lineCost:1000,commissionAmountSnapshot:223.30,commissionLabelSnapshot:'Comisión LAFISE 7%',utilidadAntesComision:2190,utilidadDespuesComision:1966.70};
assert.strictEqual(api.getSaleUtilityBeforeCommissionPOS(modern), 2190);
assert.strictEqual(api.getSaleUtilityAfterCommissionPOS(modern), 1966.70);
assert.strictEqual(modern.total, 3190);
assert.strictEqual(modern.lineCost, 1000);

// 4) Backfill legacy confiable, una sola vez, congelado aunque cambie la tasa luego.
const legacyOriginal = {
  id:44, uid:'sale-44', date:'2026-05-10', payment:'tarjeta', bankId:1, bankName:'LAFISE',
  productId:9, productName:'Catrina', total:100, lineCost:20, lineProfit:80
};
dbSales = [JSON.parse(JSON.stringify(legacyOriginal))];
dbBanks = [{id:1,name:'LAFISE',type:'tarjeta',commissionPct:7,isActive:true}];
puts = [];
let backfill = null;
(async()=>{
  backfill = await api.backfillLegacyCardCommissionSnapshotsPOS();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(backfill)), {updated:1,undetermined:0});
  assert.strictEqual(puts.length, 1);
  const filled = puts[0];
  for (const key of ['id','uid','date','productId','productName','total','lineCost','lineProfit','bankId','bankName']) {
    assert.deepStrictEqual(filled[key], legacyOriginal[key], `Backfill alteró ${key}`);
  }
  assert.strictEqual(filled.commissionPctSnapshot, 7);
  assert.strictEqual(filled.commissionAmountSnapshot, 7);
  assert.strictEqual(filled.commissionLabelSnapshot, 'Comisión LAFISE 7%');
  assert.strictEqual(filled.utilidadAntesComision, 80);
  assert.strictEqual(filled.utilidadDespuesComision, 73);
  assert.strictEqual(filled.commissionSnapshotStatus, 'determinada');

  dbSales = [filled];
  dbBanks = [{id:1,name:'LAFISE',type:'tarjeta',commissionPct:9,isActive:true}];
  puts = [];
  const repeat = await api.backfillLegacyCardCommissionSnapshotsPOS();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(repeat)), {updated:0,undetermined:0});
  assert.strictEqual(puts.length, 0, 'Backfill no es idempotente o recalculó tasa congelada');

  // 5) Legacy no confiable: no inventar banco/tasa; conservar venta y marcar no determinada.
  const unknown = {id:45,uid:'sale-45',date:'2026-05-10',payment:'tarjeta',productName:'Media',total:200,lineCost:50};
  dbSales = [JSON.parse(JSON.stringify(unknown))];
  dbBanks = [{id:1,name:'LAFISE',type:'tarjeta',commissionPct:7,isActive:true}];
  puts = [];
  const unknownResult = await api.backfillLegacyCardCommissionSnapshotsPOS();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(unknownResult)), {updated:1,undetermined:1});
  assert.strictEqual(puts[0].commissionSnapshotStatus, 'no_determinada');
  assert.strictEqual(puts[0].commissionPctSnapshot, null);
  assert.strictEqual(puts[0].commissionAmountSnapshot, null);
  assert.strictEqual(puts[0].commissionLabelSnapshot, 'Comisión no determinada');
  assert.strictEqual(puts[0].id, unknown.id);
  assert.strictEqual(puts[0].total, unknown.total);

  // 6) Finanzas consume snapshot como deducción separada; no lo mete a costo/gasto/caja.
  const n0 = v => { const n=Number(v); return Number.isFinite(n)?n:0; };
  const n2 = v => Math.round((n0(v)+Number.EPSILON)*100)/100;
  const normStr = v => String(v == null ? '' : v).trim().toLowerCase();
  const finSandbox = { Number, String, Object, Math, normStr, n0, n2 };
  vm.createContext(finSandbox);
  const finBlock = between(fin, 'function finDashboardIsCardPayment(value)', 'function finDashboardApplyPosSale(totals, sale)');
  vm.runInContext(`${finBlock}\nthis.api={finDashboardIsCardPayment,finDashboardApplyCardCommissionSnapshot};`, finSandbox);
  const fapi = finSandbox.api;
  const totals = {comisionesTarjeta:0,comisionesTarjetaDetalle:{},comisionTarjetaNoDeterminada:0,costosVentas:1000,gastos:50,cajaPeriodo:700,bancosPeriodo:3190};
  fapi.finDashboardApplyCardCommissionSnapshot(totals, modern);
  assert.strictEqual(totals.comisionesTarjeta, 223.30);
  assert.strictEqual(totals.comisionesTarjetaDetalle['Comisión LAFISE 7%'].total, 223.30);
  assert.strictEqual(totals.costosVentas, 1000);
  assert.strictEqual(totals.gastos, 50);
  assert.strictEqual(totals.cajaPeriodo, 700);
  assert.strictEqual(totals.bancosPeriodo, 3190);
  for (const payment of ['efectivo','transferencia','credito']) assert.strictEqual(fapi.finDashboardIsCardPayment(payment), false);

  // 7) Integración estructural: Resumen, cierre, Finanzas, reportes/Excel, JSON/histórico.
  for (const field of ['commissionPctSnapshot','commissionAmountSnapshot','commissionLabelSnapshot','utilidadAntesComision','utilidadDespuesComision']) {
    assert.ok(app.includes(field), `POS/reportes no conservan ${field}`);
  }
  for (const token of [
    'const comisionTarjetaTotal = round2(cardCommissions.total);',
    'comisionesTarjeta: cardCommissions.byLabel',
    'utilidadDespuesComision',
    "r.push(['Comisiones Tarjeta', m.cardCommissionTotal || 0])",
    "sheets.push({ name: 'ComisionesTarjeta', rows: commissionRows })",
    "readFiniteSaleSnapshotNumberPOS(s,'commissionPctSnapshot')",
    "readFiniteSaleSnapshotNumberPOS(s,'commissionAmountSnapshot')",
    "s.commissionLabelSnapshot || ''"
  ]) assert.ok(app.includes(token), `Falta integración POS/reportes: ${token}`);
  assert.ok(!app.includes('Comisión archivada'), 'Se inventa/mezcla una etiqueta genérica de comisión');
  assert.ok(app.includes('grand-card-commission'), 'Resumen no muestra comisión Tarjeta');
  assert.ok(posHtml.includes('Comisiones Tarjeta'), 'KPI de comisión ausente');

  for (const token of [
    'totals.comisionesTarjeta = n2(totals.comisionesTarjeta + value)',
    'totals.utilidadBruta - totals.costoCortesias - totals.comisionesTarjeta + totals.ingresosAdicionales - totals.gastos',
    'comisionTarjetaTotal',
    'comisionesTarjetaDetalle',
    'tab-comisiones-tarjeta-detalle'
  ]) assert.ok(fin.includes(token) || finHtml.includes(token), `Falta integración Finanzas: ${token}`);
  assert.ok(!/comisionesTarjeta\s*[^\n]{0,80}(?:cajaPeriodo|bancosPeriodo)/.test(fin), 'Comisión mezclada con movimiento físico de Caja/Banco');

  // Respaldo JSON sigue exportando IndexedDB completo; no colección paralela.
  assert.ok(backup.includes('async function buildFullBackup()'));
  assert.ok(backup.includes('indexedDB: cleanIndexed.data'));
  assert.ok(!/put\(['"](?:commissions|comisiones)['"]|add\(['"](?:commissions|comisiones)['"]/.test(app), 'Se creó store paralelo de comisión');

  // 8) PWA/cache corresponde a app.js modificada.
  assert.ok(posHtml.includes("-pos-r'+rev+'-m54"));
  assert.ok(posHtml.includes('app.js?v=4.20.97&r=50'));
  assert.ok(posSw.includes("const MODULE_CACHE_REV = '54';"));
  assert.ok(posSw.includes("'./app.js?v=4.20.97&r=50'"));
  assert.ok(finHtml.includes('script.js?v=4.20.97&r=4'));

  console.log('SMOKE OK — Suite A33 — POS Tarjeta — Etapa 2/5 — Resumen, Finanzas, cierre, reportes, Excel, JSON y backfill');
})().catch(err=>{ console.error(err); process.exit(1); });
