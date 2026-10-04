'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const storageSource = fs.readFileSync(path.join(root, 'assets/js/a33-storage.js'), 'utf8');
const pedidosSource = fs.readFileSync(path.join(root, 'pedidos/script.js'), 'utf8');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const values = new Map();
const localStorage = {
  get length(){ return values.size; },
  key(index){ return Array.from(values.keys())[index] ?? null; },
  getItem(key){ return values.has(key) ? values.get(key) : null; },
  setItem(key, value){ values.set(String(key), String(value)); },
  removeItem(key){ values.delete(String(key)); }
};

const document = {
  getElementById(){ return null; },
  querySelectorAll(){ return []; },
  addEventListener(){}
};
const window = {
  localStorage,
  sessionStorage:localStorage,
  document,
  addEventListener(){},
  location:{ origin:'https://example.test' }
};
const context = vm.createContext({
  window,
  document,
  localStorage,
  sessionStorage:localStorage,
  navigator:{},
  console,
  URL,
  Date,
  Math,
  JSON,
  setTimeout,
  clearTimeout
});

vm.runInContext(storageSource, context, { filename:'a33-storage.js' });
context.A33Storage = window.A33Storage;
vm.runInContext(pedidosSource, context, { filename:'pedidos-script.js' });



const assert=require('assert');
const lot={loteId:'l1',id:'historical-1',codigo:'A33-2025-12-01-01',fecha:'2025-12-01',estado:'CERRADO'};
const legacy={codigo:'A33-2024-01-01-01',nota:'histórico'};
const ref=context.pedidoLoteReferenciaPED(lot),old=context.pedidoLoteReferenciaPED(legacy);
assert.equal(ref.key,'id:l1');assert.equal(old.key,'code:A33-2024-01-01-01');
assert.equal(context.pedidoLotesResolverPED(ref,[lot]).status,'Localizado');
assert.equal(context.pedidoLotesResolverPED(ref,[{...lot,codigo:'NUEVO'}]).status,'Localizado','Un cambio de código no pierde ID');
assert.equal(context.pedidoLotesResolverPED(old,[{...legacy,id:'backfilled',batchCode:'CANONICO'}]).status,'Localizado','Backfill histórico conserva referencia por código');
assert.equal(context.pedidoLotesResolverPED(ref,[]).status,'No localizado');
assert.equal(context.pedidoLotesResolverPED(ref,[lot,{...lot,loteId:'different',id:'different'}]).status,'Identidad ambigua');
assert.equal(context.pedidoLoteReferenciaPED({nota:'sin identidad'}),null);
const order={id:'o',codigo:'P-1',lotesRelacionados:' Texto histórico, SIN CONVERTIR ',estado:'listo',lotesVinculados:{schemaVersion:1,lotes:[ref,old],updatedAt:10},items:[{productId:'p1',productNameSnapshot:'Uno',cantidad:2}]};
assert.equal(context.pedidoLotesRegistroValidoPED(order),true);
for(const bad of [null,{schemaVersion:8,lotes:[]},{schemaVersion:1,lotes:[ref,ref]},{schemaVersion:1,lotes:[{...ref,identidades:[ref.key,ref.key]}]},{schemaVersion:1,lotes:[{...ref,key:'otro'}]}])assert.equal(context.pedidoLotesRegistroValidoPED({...order,lotesVinculados:bad}),false);
for(const key of ['arcano33_pedidos','arcano33_pedidos_rapidos_v1']){
 const raw=JSON.stringify([order]);localStorage.setItem(key,raw);
 const read=window.A33Storage.sharedGet(key,[],'local')[0];assert.deepEqual(JSON.parse(JSON.stringify(read.lotesVinculados)),JSON.parse(JSON.stringify(order.lotesVinculados)));assert.equal(read.lotesRelacionados,order.lotesRelacionados);assert.equal(localStorage.getItem(key),raw);
}
const rawLots=JSON.stringify([lot,legacy]);localStorage.setItem('arcano33_lotes',rawLots);
assert.equal(context.readPedidoLotesCatalogPED().rows.length,2);assert.equal(localStorage.getItem('arcano33_lotes'),rawLots,'Leer no escribe lotes');
localStorage.setItem('arcano33_lotes','{"bad":true}');assert.ok(context.readPedidoLotesCatalogPED().error);assert.equal(localStorage.getItem('arcano33_lotes'),' {"bad":true}'.trim());
localStorage.setItem('arcano33_lotes','[null]');assert.ok(context.readPedidoLotesCatalogPED().error);
const configFixture=fs.readFileSync(path.join(__dirname,'a33-pedidos-rapidos-etapa4-json-pwa.smoke.cjs'),'utf8');
const fixtureContext={require,__dirname,console,URL,URLSearchParams,Blob,setTimeout,clearTimeout,setInterval,clearInterval,globalThis};
vm.runInNewContext(configFixture.slice(0,configFixture.indexOf('const normalized ='))+'\nthis.contractOut=contract;',fixtureContext);
const backed={...order,customerName:'Cliente',fechaEntrega:'2026-10-15'};
const imported=fixtureContext.contractOut.normalizeRaw(JSON.stringify([backed]))[0];assert.deepEqual(JSON.parse(JSON.stringify(imported.lotesVinculados)),JSON.parse(JSON.stringify(order.lotesVinculados)));assert.equal(imported.lotesRelacionados,order.lotesRelacionados);
context.order=backed;assert.ok(vm.runInContext('createQuickOrderICSPED(order)',context).includes(ref.codigoSnapshot));
console.log('PASS E6.3: identidades y códigos históricos, ambigüedad, referencias no localizadas, lectura sin escritura y respaldo compatible');
