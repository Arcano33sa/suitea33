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
const full=(id,qty,options={})=>({id,codigo:'C-'+id,fechaEntrega:'2026-10-15',estado:'pendiente',items:[{productId:'p1',productName:'Uno',qty,unitPriceSnapshot:20}],...options});
const quick=(id,qty,options={})=>({id,codigo:'Q-'+id,fechaEntrega:'2026-10-15',estado:'en_preparacion',items:[{productId:'p1',productNameSnapshot:'Uno antiguo',cantidad:qty}],...options});
const tracked=(order,qty)=>({...order,entregasAcumuladas:{schemaVersion:1,productos:[{key:'product:p1',cantidad:qty}]}});
const source={completo:[tracked(full('f1',5),2),full('f2',4,{estado:'listo'}),full('closed',99,{estado:'entregado'}),full('cancel',88,{estado:'cancelado'})],rapido:[tracked(quick('q1',3),1),quick('q2',2,{fechaEntrega:'2026-10-16'})]};
const original=JSON.stringify(source);const result=context.buildPedidoDemandaPED(source);
assert.equal(result.totalRegistrado,5);assert.equal(result.totalEstimado,6);assert.equal(result.total,11);assert.equal(result.rows.length,2);assert.equal(result.rows[0].pedidos,3);assert.equal(result.excluded,2);assert.equal(result.review.length,0);assert.equal(JSON.stringify(source),original);
assert.equal(context.buildPedidoDemandaPED(source,{desde:'2026-10-15',hasta:'2026-10-15'}).total,9);
assert.equal(context.buildPedidoDemandaPED(source,{desde:'2026-10-16'}).total,2);
assert.ok(context.buildPedidoDemandaPED(source,{desde:'2026-10-17',hasta:'2026-10-15'}).error);
assert.ok(context.buildPedidoDemandaPED(source,{desde:'2026-02-31'}).error);
assert.equal(context.buildPedidoDemandaPED({completo:[tracked(full('complete',2),2)],rapido:[]}).total,0);
const missingLine=context.buildPedidoDemandaPED({completo:[full('without-line',5,{entregasAcumuladas:{schemaVersion:1,productos:[]}})],rapido:[]});assert.equal(missingLine.totalEstimado,5);assert.equal(missingLine.totalRegistrado,0);
const bad={completo:[full('bad-date',2,{fechaEntrega:'2026-02-31'}),tracked(full('over',2),3),full('empty',2,{items:[]}),full('duplicate',2),full('duplicate',3)],rapido:[]};
const review=context.buildPedidoDemandaPED(bad);assert.equal(review.total,0);assert.equal(review.review.length,5);
const legacy={completo:[full('historic-1',2,{items:[{productName:'Histórico',qty:2}]}),full('historic-2',3,{items:[{productName:'Histórico',qty:3}]})],rapido:[]};
const historic=context.buildPedidoDemandaPED(legacy);assert.equal(historic.rows.length,2);assert.equal(historic.totalEstimado,5);assert.ok(historic.rows.every(row=>row.historico));
localStorage.setItem('arcano33_pedidos',JSON.stringify(source.completo));localStorage.setItem('arcano33_pedidos_rapidos_v1',JSON.stringify(source.rapido));
localStorage.setItem('arcano33_pedidos_archived',JSON.stringify([full('archived',1000)]));
const snapshot=Array.from(values.entries());const read=context.readPedidoDemandaSourcePED();assert.equal(context.buildPedidoDemandaPED(read).total,11);assert.deepEqual(Array.from(values.entries()),snapshot);
localStorage.setItem('arcano33_pedidos',JSON.stringify([full('bad-line',2,{items:[{productId:'p1',qty:2},null]}),full('comma',2,{items:[{productId:'p1',qty:'1,5',productName:'Uno'}]})]));
const partial=context.buildPedidoDemandaPED(context.readPedidoDemandaSourcePED());assert.equal(partial.review.length,1);assert.equal(partial.total,5.5,'No pierde cantidades históricas con coma');
localStorage.setItem('arcano33_pedidos_rapidos_v1','{corrupto');const failed=context.buildPedidoDemandaPED(context.readPedidoDemandaSourcePED());assert.ok(failed.error.includes('rápidos'));assert.equal(failed.rows.length,0);assert.equal(failed.sources.length,0);
const get=localStorage.getItem;localStorage.getItem=()=>{throw Error('Lectura rechazada')};assert.ok(context.readPedidoDemandaSourcePED().error.includes('completos'));localStorage.getItem=get;
console.log('PASS E6.4: demanda registrada/estimada, estados y períodos, saldos, revisión conservadora, identidad histórica y lectura sin escritura');
