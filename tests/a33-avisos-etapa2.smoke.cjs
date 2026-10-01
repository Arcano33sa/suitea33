'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const bridge=read('assets/js/a33-notify-bridge.js');
const notices=[],dismissed=[];
const host={A33Notify:{show(message,type,options){notices.push({message,type,options});return 'notice-'+notices.length;},dismiss(id){dismissed.push(id);}}};
const ctx=vm.createContext({window:host,Date,Object,String});vm.runInContext(bridge,ctx);
for(const [msg,kind,type] of [
 ['Guardando compra…',undefined,'process'],['Cargando productos…',undefined,'process'],
 ['No se pudo guardar el producto.','warn','error'],['Producción guardada.',undefined,'success'],
 ['Hay cambios sin guardar.',undefined,'pending'],['No hay pedidos para exportar.',undefined,'pending'],
 ['Una validación de campo',undefined,'pending'],['Error importando cierres POS.',undefined,'error'],
 ['Compra guardada parcialmente.','pending','pending'],['Calendario exportado.',undefined,'success']]){
 assert.equal(host.A33Notice.resolve(msg,kind),type,msg);
}
host.A33Notice.show('Guardando…');host.A33Notice.show('Guardado.');
assert.equal(notices.at(-2).type,'process');assert.equal(notices.at(-1).type,'success');
assert(dismissed.includes('suite-process'),'El resultado no sustituyó el proceso');
host.A33Notice.show('No se pudo guardar.');host.A33Notice.show('No se pudo guardar.');
assert.equal(notices.at(-1).options.id,'notice-'+(notices.length-1),'Aviso duplicado no reutilizó su ID');
host.A33Notice.alert('Validación sin clasificación');assert.equal(notices.at(-1).type,'pending');
const modules=['pos','agenda','inventario','lotes','pedidos','catalogos','finanzas','configuracion','analitica','centro-mando','calculadora','calculadora_temporal'];
const assets=['/assets/js/a33-notify.js?v=4.20.98&r=1','/assets/js/a33-notify-bridge.js?v=4.20.98&r=2','/assets/css/a33-notify.css?v=4.20.98&r=1'];
for(const m of [...modules,'.']){
 const html=read(m+'/index.html');for(const asset of assets)assert(html.includes(asset),m+' no carga '+asset);
 assert(html.indexOf('a33-notify.js')<html.indexOf('a33-notify-bridge.js'));
 if(fs.existsSync(path.join(root,m,'sw.js'))){
  const sw=read(m+'/sw.js');for(const asset of assets)assert(sw.includes(asset),m+' no precachea '+asset);
  for(const match of html.matchAll(/src="(?:\.\/)?((?:script|app|purchases)\.js\?[^\"]+)"/g))assert(sw.includes(match[1].replace(/&amp;/g,'&')),m+' tiene versión JS incoherente');
 }
}
// Caja Chica: el éxito depende del resultado real de sus dos persistencias.
const fin=read('finanzas/script.js');
const cc=fin.slice(fin.indexOf('async function ccSaveSnapshot()'),fin.indexOf('function ccResetCountsOnly()'));
async function caja(primaryOk,backupOk){
 const calls=[];
 const context={ccSnapshot:{currencies:{NIO:{},USD:{}}},CC_STORAGE_KEY:'test',
  ccComputeCurrencyTotal:()=>0,ccGetFxRateForSave:()=>36,ccBuildEmptyConsolidated:()=>({}),ccUpdateCentralCurrencyReference(){},
  ccRound2:x=>x,ccBuildConsolidatedFromCurrent:()=>({}),fmtDDMMYYYYHHMM:()=>'',ccUpdateConsolidatedSummary(){},
  async finPut(){calls.push('primary');if(!primaryOk)throw Error('quota');},
  localStorage:{setItem(){calls.push('backup');if(!backupOk)throw Error('quota');}},document:{getElementById:()=>null},Date,
  window:{A33Notice:{show:(msg,type)=>calls.push(type)}},ccSetMsg:(msg,type)=>calls.push(type||'success'),showToast:()=>calls.push('success')};
 vm.createContext(context);vm.runInContext(cc,context);await context.ccSaveSnapshot();
 assert(calls.indexOf('primary')<calls.indexOf('backup'));
 const expected=primaryOk&&backupOk?'success':primaryOk||backupOk?'pending':'error';
 assert.equal(calls.at(-1),expected);if(expected!=='success')assert(!calls.includes('success'),'Mostró éxito sin guardado completo');
}
(async()=>{await caja(true,true);await caja(true,false);await caja(false,true);await caja(false,false);
 console.log('PASS E2: clasificación, deduplicación, proceso→resultado, recursos/cachés y guardado completo/parcial/fallido de Caja Chica');
})().catch(e=>{console.error(e);process.exitCode=1;});
