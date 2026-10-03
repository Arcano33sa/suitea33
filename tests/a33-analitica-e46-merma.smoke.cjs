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
  this.setMerma = (rows,status="read") => {mermaRows=rows;mermaReadStatus=status;};
  this.setDB = value => {db=value;};
  this.api = {readFinalMermaAnalytics,selectedMermaAnalytics,mermaDateAnalytics,withFinalMermaAnalytics,profitAfterMermaTextAnalytics,mermaExportRowsAnalytics,buildEconomicResults, computeLineMetrics, buildEventStats, buildPresentationStats, saleInRange, analyticsResultStatus};
  setupExportButtons();
`;
assert.ok(source.trimEnd().endsWith('})();'));
vm.runInContext(source.replace(/\}\)\(\);\s*$/, hook + '\n})();'), sandbox);
const api=sandbox.api;
sandbox.console={...console,warn(){}};
const getElement=sandbox.document.getElementById;
sandbox.document.getElementById=id=>id==='period-select'?{value:'all'}:getElement(id);
const range={from:new Date(2026,9,1),to:new Date(2026,9,31,23,59,59)};
const fixture=[
 {id:'a',tipo:'REEMPAQUE_MERMA_FINAL_EVENTO',date:'2026-10-31',eventId:1,mermaFinalMl:100,costoMermaFinal:12.5},
 {id:'b',isFinalEventMerma:true,fecha:'2026-10-01',eventId:2,finalMermaMl:40,finalMermaCost:3},
 {id:'c',tipo:'REEMPAQUE_MERMA_FINAL_EVENTO',date:'2026-11-01',eventId:1,costoMermaFinal:99},
 ...[{provisionalClose:true},{anulado:true},{cancelled:true},{estado:'ANULADO'},{tipo:'REEMPAQUE_NORMAL',isFinalEventMerma:false}].map((extra,i)=>({id:'x'+i,tipo:'REEMPAQUE_MERMA_FINAL_EVENTO',date:'2026-10-02',eventId:1,costoMermaFinal:99,...extra}))
];
const before=JSON.stringify(fixture);
sandbox.setMerma(fixture);
const selected=api.selectedMermaAnalytics(range);
assert.strictEqual(selected.length,2);
const economic=api.buildEconomicResults(sales);
let result=api.withFinalMermaAnalytics(economic,selected);
assert.strictEqual(result.mermaCost,15.5);assert.strictEqual(result.mermaMl,140);assert.strictEqual(result.profitAfterMerma,4.5);assert.strictEqual(result.mermaPartial,false);
// Run Finance's current economic calculation with the same range and raw sources.
const finance=fs.readFileSync(path.join(root,'finanzas/script.js'),'utf8');
const calculations=finance.slice(finance.indexOf('function finDashboardDate(record)'),finance.indexOf('function renderTableroAlerts(result)'));
const fc=vm.createContext({console,Array,Date,Set,Map,Number,String,Math,
 n2:n=>Math.round((Number(n)||0)*100)/100,n0:n=>Number(n)||0,normStr:n=>String(n||'').toLowerCase(),
 finDashboardReadIntegrity:()=>({incomplete:false,missingStores:[],issues:[]}),getPosEventNameLiveById:()=>'',FIN_OPERATIONAL_DASHBOARD_STAGE:'test',finDashboardSafePct:(a,b)=>b?a/b*100:0,
 finBuildOperationalManualTotals:()=>({rows:[],sourceCounts:{},ingresosAdicionales:0,gastos:0})});
vm.runInContext(calculations,fc);
const comparable=sales.map(s=>({...s,discount:s.total===180?20:0}));
const fin=fc.calcTableroClasificadoForFilter({posSales:comparable,posReempaques:fixture},{desde:'2026-10-01',hasta:'2026-10-31'});
assert.strictEqual(fin.mermaFinal,result.mermaCost);assert.strictEqual(fin.mermaFinalMl,result.mermaMl);assert.strictEqual(fin.utilidadNeta,result.profitAfterMerma);
// No product allocation; a waste-only event remains visible.
sandbox.setMerma(selected);const events=api.buildEventStats(sales,[{id:1,name:'Ventas'},{id:2,name:'Solo merma'}]).rows;
assert.strictEqual(events.length,2);assert.strictEqual(events.find(r=>r.id===2).economicResults.profitAfterMerma,-3);
assert.strictEqual(events.reduce((sum,r)=>sum+r.economicResults.mermaCost,0),15.5);
assert.ok(api.buildPresentationStats(sales).rows.every(row=>row.economicResults.mermaCost===undefined));
// Historical mixed ID types must not duplicate a waste amount.
const mixed=api.buildEventStats([...sales,{...sales[0],eventId:'1'}],[]).rows;
assert.strictEqual(mixed.reduce((sum,row)=>sum+row.economicResults.mermaCost,0),15.5);
for(const extra of [{costReliable:false},{costoMermaFinal:null},{costoMermaFinal:'abc'}]){
 result=api.withFinalMermaAnalytics(economic,[{...selected[0],...extra}]);assert.strictEqual(result.mermaPartial,true);assert.ok(api.profitAfterMermaTextAnalytics(result).includes('parcial'));
}
sandbox.setMerma([], 'error');assert.ok(api.withFinalMermaAnalytics(economic,[]).mermaPartial);
sandbox.setMerma([], 'legacy');assert.strictEqual(api.withFinalMermaAnalytics(economic,[]).mermaPartial,false);
sandbox.setMerma(selected);sandbox.seedExports(sales);for(const id of ids)handlers.get(id)();
for(const file of downloads){assert.ok(file.workbook.SheetNames.includes('Merma final'));const rows=XLSX.utils.sheet_to_json(file.workbook.Sheets['Merma final'],{header:1});assert.strictEqual(rows[1][0],'a');assert.strictEqual(rows[2][0],'b');}
const summary=XLSX.utils.sheet_to_json(downloads[0].workbook.Sheets.Resumen,{header:1});assert.strictEqual(Number(summary.find(row=>row[1]==='Utilidad después de comisión y merma')[2]),4.5);
sandbox.seedExports([]);handlers.get(ids[0])();handlers.get(ids[1])();assert.strictEqual(downloads.length,5,'Resumen/eventos exportables sin ventas');
// Required read behavior: wait for transaction completion; late abort is not empty success.
(async()=>{
 for(const mode of ['read','abort','invalid','throw','legacy']){
  let closedMode=mode;
  sandbox.setDB({objectStoreNames:{contains:()=>mode!=='legacy'},transaction(name,access){
   assert.strictEqual(name,'reempaques');assert.strictEqual(access,'readonly');if(mode==='throw')throw new Error('Denied');
   const tx={objectStore(){return {getAll(){const req={};queueMicrotask(()=>{req.result=mode==='invalid'?null:selected;req.onsuccess();if(mode==='abort')tx.onabort();else tx.oncomplete();});return req;}}}};return tx;
  }});
  await api.readFinalMermaAnalytics();
  const rows=api.mermaExportRowsAnalytics();const status=rows.find(row=>row[0]==='Lectura')[1];
  assert.strictEqual(status,mode==='read'?'read':mode==='legacy'?'legacy':'error',closedMode);
  if(mode==='abort')assert.strictEqual(api.selectedMermaAnalytics(range).length,0);
 }
 assert.strictEqual(JSON.stringify(fixture),before);
 console.log('APROBADA E4.6 VM: merma confirmada conciliada con Finanzas, límites de fechas, exclusiones, merma sin ventas, IDs históricos, costos inciertos, lectura tardía fallida y XLSX; sin reparto a productos ni escrituras.');
})().catch(error=>{console.error(error);process.exitCode=1;});
