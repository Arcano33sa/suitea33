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
const full={id:'full-e62',estado:'pendiente',codigo:'HIST',items:[{productId:'p1',productName:'Uno',qty:5,unitPriceSnapshot:20},{productId:'p2',productName:'Dos',qty:3,unitPriceSnapshot:10}],totalPagar:130,pagoAnticipado:30,saldoPendiente:100};
const quick={id:'quick-e62',estado:'listo',items:[{productId:'p1',productNameSnapshot:'Uno',cantidad:5},{productId:'p2',productNameSnapshot:'Dos',cantidad:3}]};
function run(order,mode,expression){context.order=order;context.mode=mode;return vm.runInContext(expression,context);}
for(const [order,mode] of [[full,'completo'],[quick,'rapido']]){
 const original=JSON.stringify(order);
 assert.equal(run(order,mode,'pedidoEntregasResumenPED(order,mode)'),'Sin registro de cantidades');
 assert.equal(JSON.stringify(order),original,'La lectura no escribe cantidades históricas');
 const tracked={...order,entregasAcumuladas:{schemaVersion:1,productos:[{key:'product:p1',cantidad:2},{key:'product:p2',cantidad:1}]}};
 assert.equal(run(tracked,mode,'validarEntregasPedidoPED(order,mode)'),'');
 assert.match(run(tracked,mode,'pedidoEntregasResumenPED(order,mode)'),/Entregado 3 de 8.*Pendiente 5/);
 assert.deepEqual(Array.from(run(tracked,mode,'pedidoEntregasLineasPED(order,mode)'),line=>line.delivered),[2,1]);
 const all={...tracked,entregasAcumuladas:{schemaVersion:1,productos:[{key:'product:p1',cantidad:5},{key:'product:p2',cantidad:3}]}};
 assert.match(run(all,mode,'pedidoEntregasResumenPED(order,mode)'),/Pendiente 0/);assert.equal(all.estado,order.estado);
 for(const value of [-1,NaN,Infinity,6,'2']){
  const invalid={...tracked,entregasAcumuladas:{schemaVersion:1,productos:[{key:'product:p1',cantidad:value}]}};
  assert.ok(run(invalid,mode,'validarEntregasPedidoPED(order,mode)'),'Cantidad inválida '+value);
 }
 const orphan={...tracked,items:tracked.items.slice(1)};
 assert.match(run(orphan,mode,'validarEntregasPedidoPED(order,mode)'),/quitar/);
 const duplicate={...tracked,entregasAcumuladas:{schemaVersion:1,productos:[{key:'product:p1',cantidad:1},{key:'product:p1',cantidad:1}]}};
 assert.match(run(duplicate,mode,'validarEntregasPedidoPED(order,mode)'),/no es válido/);
 const key=mode==='rapido'?'arcano33_pedidos_rapidos_v1':'arcano33_pedidos';
 localStorage.setItem(key,JSON.stringify([tracked]));
 const read=window.A33Storage.sharedGet(key,[],'local')[0];
 assert.deepEqual(JSON.parse(JSON.stringify(read.entregasAcumuladas)),tracked.entregasAcumuladas);
 assert.equal(run(read,mode,'validarEntregasPedidoPED(order,mode)'),'');
}
const legacy={id:7,pulsoCant:3,pulsoPrecio:10,estado:'entregado'};
const legacyLines=run(legacy,'completo','pedidoEntregasLineasPED(order,mode)');assert.equal(legacyLines.length,1);assert.equal(legacyLines[0].registered,false);
const sameName={id:8,items:[{productName:'Histórico',qty:2},{productName:'Histórico',qty:3}]};
const sameLines=run(sameName,'completo','pedidoEntregasLineasPED(order,mode)');assert.equal(sameLines.length,2);assert.notEqual(sameLines[0].key,sameLines[1].key);
assert.equal(run({...full,entregasAcumuladas:null},'completo','pedidoEntregasRegistroValidoPED(order)'),false);
const configFixture=fs.readFileSync(path.join(__dirname,'a33-pedidos-rapidos-etapa4-json-pwa.smoke.cjs'),'utf8');
const fixtureContext={require,__dirname,console,URL,URLSearchParams,Blob,setTimeout,clearTimeout,setInterval,clearInterval,globalThis};
vm.runInNewContext(configFixture.slice(0,configFixture.indexOf('const normalized ='))+'\nthis.contractOut=contract;',fixtureContext);
const backed={...quick,codigo:'PR-20261015-001',customerName:'Cliente',fechaEntrega:'2026-10-15',entregasAcumuladas:{schemaVersion:1,productos:[{key:'product:p1',cantidad:2}]}};
assert.deepEqual(JSON.parse(JSON.stringify(fixtureContext.contractOut.normalizeRaw(JSON.stringify([backed]))[0].entregasAcumuladas)),backed.entregasAcumuladas);
console.log('PASS E6.2: cantidades acumuladas, saldos, límites, identidades históricas, estados manuales y contrato de respaldo');
