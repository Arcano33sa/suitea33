'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../finanzas/script.js'), 'utf8');
const readers = source.slice(source.indexOf('async function finReadPosOperationalSourcesSafe()'), source.indexOf('const FIN_OPERATIONAL_CLASS_STAGE'));
const calculations = source.slice(source.indexOf('function finDashboardDate(record)'), source.indexOf('function renderTableroAlerts(result)'));
const stores = ['sales','events','banks','dailyClosures','cashV2','reempaques'];
const sale = {id:1,date:'2026-10-03',eventId:1,qty:1,unitPrice:100,total:100,lineCost:20,payment:'efectivo'};
function harness({missing=[],failure='',abort='',invalid='',openError='',absent=false,empty=false,uninitialized=false,manualRows=[]}={}) {
  const transactions = []; let closed=0, upgradeAborted=0;
  const db = {
    objectStoreNames:{length:uninitialized?0:stores.length-missing.length,contains:name=>!missing.includes(name)},
    close(){closed++;},
    transaction(name,mode){
      transactions.push({name,mode});
      const tx={objectStore(){return {getAll(){
        const req={};queueMicrotask(()=>{
          if(name===failure){req.error=new Error('getAll fallido');req.onerror();return;}
          req.result=name===invalid?null:(!empty&&name==='sales'?[sale]:[]);
          req.onsuccess();
          if(name===abort){tx.error=new Error('aborto tardío');tx.onabort();}else tx.oncomplete();
        });return req;
      }}}};return tx;
    }
  };
  const banner={hidden:true,textContent:'',classList:{toggle(){}}};
  const context=vm.createContext({console,Array,Date,Promise,Set,Map,Number,String,Math,POS_DB_NAME:'a33-pos',FIN_POS_OPERATIONAL_STORES:stores,
    indexedDB:{open(){
      if(openError==='sync')throw new Error('apertura denegada');
      const req={};queueMicrotask(()=>{
        if(absent){req.transaction={abort(){upgradeAborted++;}};req.onupgradeneeded();req.error=new Error('AbortError');req.onerror();}
        else if(openError==='blocked')req.onblocked();
        else if(openError){req.error=new Error('apertura fallida');req.onerror();}
        else {req.result=db;req.onsuccess();}
      });return req;
    }},document:{getElementById(){return banner;}},
    n2:value=>Math.round((Number(value)||0)*100)/100,n0:value=>Number(value)||0,
    normStr:value=>String(value||'').toLowerCase(),getPosEventNameLiveById(){return '';},
    FIN_OPERATIONAL_DASHBOARD_STAGE:'test',finDashboardSafePct:(a,b)=>b?a/b*100:0,
    finBuildOperationalManualTotals(){return {rows:manualRows,sourceCounts:{receipts:manualRows.length},ingresosAdicionales:0,gastos:0};},
    finFormatCordobas:String
  });
  vm.runInContext(readers + '\n' + calculations + '\nthis.api={finReadPosOperationalSourcesSafe,finDashboardReadIntegrity,finRenderDashboardReadStatus,calcTableroClasificadoForFilter};',context);
  return {api:context.api,banner,transactions,get closed(){return closed;},get upgradeAborted(){return upgradeAborted;}};
}
(async()=>{
  const before=JSON.stringify(sale);
  let h=harness();let snapshot=await h.api.finReadPosOperationalSourcesSafe();
  assert.strictEqual(snapshot.ok,true);assert.strictEqual(snapshot.readStatus.sales,'read');assert.strictEqual(snapshot.readStatus.events,'empty');assert.strictEqual(h.closed,1);
  assert.ok(h.transactions.every(tx=>tx.mode==='readonly'));
  let result=h.api.calcTableroClasificadoForFilter({posSources:snapshot,posSales:snapshot.sales},{desde:'2026-10-01',hasta:'2026-10-31'});
  assert.strictEqual(result.ventaNeta,100);assert.strictEqual(result.utilidadNeta,80);assert.strictEqual(result.readIntegrity.incomplete,false);
  for(const failure of stores){
    h=harness({failure});snapshot=await h.api.finReadPosOperationalSourcesSafe();
    assert.strictEqual(snapshot.ok,false);assert.strictEqual(snapshot.readStatus[failure],'error');assert.ok(snapshot.warnings[0].includes('a33-pos.'+failure));
    result=h.api.calcTableroClasificadoForFilter({posSources:snapshot,posSales:snapshot.sales},{});
    assert.strictEqual(result.readIntegrity.incomplete,true);assert.ok(!result.alerts.some(a=>a.text.startsWith('No hay datos operativos')));
    h.api.finRenderDashboardReadStatus(result.readIntegrity);assert.strictEqual(h.banner.hidden,false);assert.ok(h.banner.textContent.includes('parciales'));
  }
  h=harness({abort:'sales'});snapshot=await h.api.finReadPosOperationalSourcesSafe();assert.strictEqual(snapshot.ok,false);assert.strictEqual(snapshot.sales.length,0);assert.ok(snapshot.warnings[0].includes('aborto tardío'));
  h=harness({invalid:'sales'});assert.strictEqual((await h.api.finReadPosOperationalSourcesSafe()).ok,false);
  for(const openError of ['sync','async','blocked']){h=harness({openError});snapshot=await h.api.finReadPosOperationalSourcesSafe();assert.strictEqual(snapshot.ok,false);assert.ok(snapshot.warnings[0].includes('abrir a33-pos'));}
  h=harness({missing:stores.slice(2),empty:true});snapshot=await h.api.finReadPosOperationalSourcesSafe();assert.strictEqual(snapshot.ok,true);assert.strictEqual(snapshot.missingStores.length,4);assert.strictEqual(snapshot.readStatus.sales,'empty');
  result=h.api.calcTableroClasificadoForFilter({posSources:snapshot},{});assert.strictEqual(result.readIntegrity.incomplete,false);assert.ok(result.alerts.some(a=>a.text.startsWith('No hay datos operativos')));
  h=harness({missing:['sales']});assert.strictEqual((await h.api.finReadPosOperationalSourcesSafe()).ok,false);
  h=harness({absent:true});snapshot=await h.api.finReadPosOperationalSourcesSafe();assert.strictEqual(snapshot.ok,true);assert.strictEqual(snapshot.databaseAbsent,true);assert.strictEqual(h.upgradeAborted,1);assert.strictEqual(h.transactions.length,0);
  h=harness({uninitialized:true});snapshot=await h.api.finReadPosOperationalSourcesSafe();assert.strictEqual(snapshot.ok,true);assert.strictEqual(snapshot.databaseUninitialized,true);assert.strictEqual(h.transactions.length,0);
  h=harness({empty:true,manualRows:[{source:'receipts'}]});result=h.api.calcTableroClasificadoForFilter({},{});assert.ok(!result.alerts.some(a=>a.text.startsWith('No hay datos operativos')));
  const integrity=h.api.finDashboardReadIntegrity({dashboardReadIssues:['finanzasDB.receipts falló']});assert.strictEqual(integrity.incomplete,true);
  h.api.finRenderDashboardReadStatus(integrity);assert.strictEqual(h.banner.hidden,false);h.api.finRenderDashboardReadStatus({incomplete:false});assert.strictEqual(h.banner.hidden,true);assert.strictEqual(h.banner.textContent,'');
  assert.strictEqual(JSON.stringify(sale),before);
  console.log('APROBADA E4.4 VM: vacío, legacy, fuente ausente, fallos por almacén/apertura, aborto tardío, resultado inválido, aviso y recuperación; solo lectura.');
})().catch(error=>{console.error(error);process.exitCode=1;});
