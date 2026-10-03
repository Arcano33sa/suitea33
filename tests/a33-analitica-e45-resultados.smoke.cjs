'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const XLSX = require(path.join(root, 'pos/vendor/xlsx.full.min.js'));
const source = fs.readFileSync(path.join(root, 'analitica/script.js'), 'utf8');
const sales = [
  { date:'2026-10-02', eventId:1, productId:'p1', productName:'Producto', qty:2, unitPrice:100, total:180, lineCost:60, loteCodigo:'001-A' },
  { date:'2026-10-02', eventId:1, productId:'p1', productName:'Producto', qty:1, unitPrice:100, total:0, lineCost:30, courtesy:true, loteCodigo:'001-A' },
  { date:'2026-10-02', eventId:1, productId:'p1', productName:'Producto', qty:-1, unitPrice:100, total:-100, lineCost:-30, isReturn:true, loteCodigo:'001-A' }
];
const original = JSON.stringify(sales);
const handlers = new Map();
const downloads = [];
const alerts = [];
const notices = [];
const ids = ['btn-export-resumen', 'btn-export-eventos', 'btn-export-presentaciones'];
const sandbox = {
  console,
  MutationObserver: class { observe(){} },
  document: {
    addEventListener(){},
    getElementById(id){
      return ids.includes(id) ? { addEventListener(event, handler){
        assert.strictEqual(event, 'click'); handlers.set(id, handler);
      }} : null;
    }
  },
  window: { addEventListener(){}, A33Notice: {
    alert(message){ alerts.push(message); },
    show(message, type){ notices.push({message, type}); }
  }},
  XLSX: { ...XLSX, writeFile(workbook, filename){
    // Serialize and read the real XLSX binary in memory; no user files or storage.
    const bytes = XLSX.write(workbook, { type:'buffer', bookType:'xlsx' });
    downloads.push({ filename, workbook:XLSX.read(bytes, { type:'buffer' }) });
  }},
  fixtureSales:sales
};
vm.createContext(sandbox);
const hook = `
  this.seedExports = function(rows){
    products = [];
    lastFilteredSales = rows;
    lastEventStats = buildEventStats(rows, [{id:1,name:'Evento de prueba'}]);
    lastPresStats = buildPresentationStats(rows);
  };
  this.api = {buildEconomicResults, computeLineMetrics, buildEventStats, buildPresentationStats, saleInRange, analyticsResultStatus};
  setupExportButtons();
`;
assert.ok(source.trimEnd().endsWith('})();'));
vm.runInContext(source.replace(/\}\)\(\);\s*$/, hook + '\n})();'), sandbox);
const api = sandbox.api;
const known = [
  {id:1,date:'2026-10-10',eventId:1,productId:'p1',productName:'Producto',qty:2,unitPrice:100,total:180,discount:20,lineCost:60,payment:'tarjeta',commissionAmountSnapshot:9,commissionLabelSnapshot:'Banco histórico 5%'},
  {id:2,date:'2026-10-20',eventId:1,productId:'p1',productName:'Producto',qty:-1,unitPrice:100,total:-100,lineCost:-30,payment:'card',commissionAmountSnapshot:-5,commissionLabelSnapshot:'Banco histórico 5%',isReturn:true},
  {id:3,date:'2026-10-20',eventId:1,productId:'p1',productName:'Producto',qty:1,unitPrice:100,total:0,lineCost:30,courtesy:true,payment:'tarjeta'},
  {id:4,date:'2026-10-20',eventId:2,productId:'p2',productName:'Otro',qty:1,unitPrice:50,total:50,lineCost:10,payment:'efectivo',commissionAmountSnapshot:99},
  {id:5,date:'2026-10-20',eventId:2,productId:'p2',productName:'Otro',qty:1,unitPrice:50,total:50,lineCost:10,payment:'tarjeta',commissionAmountSnapshot:0,commissionLabelSnapshot:'Exenta'}
];
const before = JSON.stringify(known);
const result = api.buildEconomicResults(known);
assert.strictEqual(result.revenue,180);
assert.strictEqual(result.paidCost,50);
assert.strictEqual(result.courtesyCost,30);
assert.strictEqual(result.grossProfit,130);
assert.strictEqual(result.profitAfterCourtesy,100);
assert.strictEqual(result.commissionTotal,4);
assert.strictEqual(result.profitAfterCommission,96);
assert.strictEqual(result.commissionUndeterminedCount,0);
assert.strictEqual(result.extraDecimalsCount,0);
// Execute the current POS collector, rather than duplicating its expectations.
const pos = fs.readFileSync(path.join(root,'pos/app.js'),'utf8');
const collector = pos.slice(pos.indexOf('function collectSaleCardCommissionsPOS('), pos.indexOf('function resolveLegacyCardBankPOS('));
const posContext = vm.createContext({Map,Number,String,Math,round2:n=>Math.round((n+Number.EPSILON)*100)/100,
 isCourtesySalePOS:s=>!!(s.courtesy||s.isCourtesy),
 readFiniteSaleSnapshotNumberPOS:(s,k)=>s[k]==null||s[k]===''||!Number.isFinite(Number(s[k]))?null:Number(s[k]),
 CARD_COMMISSION_SNAPSHOT_STATUS_UNDETERMINED_POS:'no_determinada'});
vm.runInContext(pos.slice(pos.indexOf('function normalizePaymentMethodPOS('),pos.indexOf('function normalizeBankTypePOS('))+collector,posContext);
assert.strictEqual(posContext.collectSaleCardCommissionsPOS(known).total,result.commissionTotal);
const finance = fs.readFileSync(path.join(root,'finanzas/script.js'),'utf8');
const calculations = finance.slice(finance.indexOf('function finDashboardDate(record)'),finance.indexOf('function renderTableroAlerts(result)'));
const fc = vm.createContext({console,Array,Date,Set,Map,Number,String,Math,
 n2:n=>Math.round((Number(n)||0)*100)/100,n0:n=>Number(n)||0,normStr:n=>String(n||'').toLowerCase(),
 finDashboardReadIntegrity:()=>({incomplete:false,missingStores:[],issues:[]}),getPosEventNameLiveById:()=>'',FIN_OPERATIONAL_DASHBOARD_STAGE:'test',finDashboardSafePct:(a,b)=>b?a/b*100:0,
 finBuildOperationalManualTotals:()=>({rows:[],sourceCounts:{},ingresosAdicionales:0,gastos:0})});
vm.runInContext(calculations,fc);
const fr=fc.calcTableroClasificadoForFilter({posSources:{sales:known,events:[],banks:[],dailyClosures:[],cashV2:[],reempaques:[]},posSales:known},{desde:'2026-10-10',hasta:'2026-10-20'});
assert.strictEqual(fr.ventaNeta,result.revenue);
assert.strictEqual(fr.utilidadBruta,result.grossProfit);
assert.strictEqual(fr.comisionesTarjeta,result.commissionTotal);
assert.strictEqual(fr.utilidadNeta,result.profitAfterCommission);
// An incomplete historical discount is a source difference, not permission to rewrite rules.
const incomplete={...known[0]};delete incomplete.discount;
const different=fc.calcTableroClasificadoForFilter({posSales:[incomplete]},{});
assert.strictEqual(different.ventaNeta,200);assert.strictEqual(api.buildEconomicResults([incomplete]).revenue,180);
assert.strictEqual(api.buildEconomicResults([{...known[0],payment:' Tárjeta_ '}]).commissionTotal,9);
for(const rows of [api.buildEventStats(known,[]).rows,api.buildPresentationStats(known).rows]){
 assert.strictEqual(rows.reduce((s,r)=>s+r.economicResults.commissionTotal,0),4);
 assert.strictEqual(rows.reduce((s,r)=>s+r.economicResults.profitAfterCommission,0),96);
}
const range={from:new Date(2026,9,10),to:new Date(2026,9,20,23,59,59)};
for(const [date,expected] of [['2026-10-09',false],['2026-10-10',true],['2026-10-20',true],['2026-10-21',false]]) assert.strictEqual(api.saleInRange({date},range),expected);
const unknowns=[undefined,null,'',NaN,Infinity].map(value=>({...known[0],commissionAmountSnapshot:value}));
unknowns.push({...known[0],commissionLabelSnapshot:''},{...known[0],commissionSnapshotStatus:'no_determinada'});
assert.strictEqual(api.buildEconomicResults(unknowns).commissionUndeterminedCount,7);
assert.ok(api.analyticsResultStatus(api.buildEconomicResults(unknowns)).startsWith('Parcial'));
const legacy={...known[0],lineCost:60.123};
assert.strictEqual(api.buildEconomicResults([legacy]).extraDecimalsCount,1);
assert.strictEqual(api.buildEconomicResults([legacy]).profitAfterCourtesy,api.computeLineMetrics(legacy).lineProfit);
sandbox.seedExports(known);
for(const id of ids)handlers.get(id)();
assert.strictEqual(downloads.length,3);
for(const download of downloads){
 assert.ok(download.workbook.SheetNames.includes('Alcance'));
 const scope=XLSX.utils.sheet_to_json(download.workbook.Sheets.Alcance,{header:1});
 assert.strictEqual(scope.find(r=>r[0]==='Comisiones no determinadas')[1],0);
 assert.ok(scope.find(r=>r[0]==='Alcance')[1].includes('merma'));
}
let summary=XLSX.utils.sheet_to_json(downloads[0].workbook.Sheets.Resumen,{header:1});
for(const [label,value] of [['Utilidad bruta',130],['Comisiones determinadas',4],['Utilidad después de comisión',96]])assert.strictEqual(Number(summary.find(r=>r[1]===label)[2]),value);
for(const [i,sheet] of [[1,'Eventos'],[2,'Productos']]){
 const rows=XLSX.utils.sheet_to_json(downloads[i].workbook.Sheets[sheet],{header:1});
 const col=rows[0].indexOf('Comisiones determinadas (C$)');assert.ok(col>=0);
 assert.strictEqual(rows.slice(1).reduce((s,r)=>s+Number(r[col]),0),4);
}
sandbox.seedExports([unknowns[0]]);handlers.get(ids[0])();
summary=XLSX.utils.sheet_to_json(downloads[3].workbook.Sheets.Resumen,{header:1});
assert.ok(summary.some(r=>r.some(c=>String(c).startsWith('Parcial'))));
assert.strictEqual(JSON.stringify(known),before);
console.log('APROBADA E4.5 VM: resultados conciliados con Finanzas y comisión POS; devoluciones, cortesías, exención, desconocidas, rangos, agrupaciones, XLSX y compatibilidad decimal; datos intactos.');
