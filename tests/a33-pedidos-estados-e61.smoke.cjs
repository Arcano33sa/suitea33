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
const states=['pendiente','en_preparacion','listo','entregado','cancelado'];
const labels=['Pendiente','En preparación','Listo','Entregado','Cancelado'];
const rows=states.map((estado,i)=>({id:'e61-'+i,codigo:'PR-20261015-00'+(i+1),customerName:'Histórico',prioridad:'normal',fechaEntrega:'2026-10-15',estado,entregado:false,updatedAt:123,extraHistorica:'conservar',items:[{productId:'p1',productNameSnapshot:'Producto',cantidad:2}]}));
for(const [i,row] of rows.entries()){
 context.row=row;
 assert.equal(vm.runInContext('getPedidoEstado(row)',context),row.estado);
 assert.equal(vm.runInContext('pedidoEstadoLabelPED(getPedidoEstado(row))',context),labels[i]);
 assert.equal(window.A33PedidosRapidosModel.validate(row).ok,true);
 assert.equal(window.A33PedidosRapidosModel.normalize(row).estado,row.estado);
 assert.equal(vm.runInContext('coercePedidoForRead(row).estado',context),row.estado);
 assert.ok(vm.runInContext('createQuickOrderICSPED(row)',context).includes(labels[i]));
}
assert.equal(vm.runInContext('getPedidoEstado({entregado:true})',context),'entregado');
assert.equal(vm.runInContext('getPedidoEstado({estado:"listo",entregado:true})',context),'listo');
assert.equal(vm.runInContext('getPedidoEstado({estado:"pendiente",entregado:true})',context),'pendiente','Compatibilidad del estado explícito completo');
assert.equal(window.A33PedidosRapidosModel.normalize({estado:'pendiente',entregado:true}).estado,'entregado','Compatibilidad de la marca rápida histórica');
const raw=JSON.stringify(rows);localStorage.setItem('arcano33_pedidos_rapidos_v1',raw);
assert.deepEqual(Array.from(window.A33Storage.sharedGet('arcano33_pedidos_rapidos_v1',[],'local'),r=>r.estado),states);
assert.equal(localStorage.getItem('arcano33_pedidos_rapidos_v1'),raw,'Leer no migra datos');
const configFixture=fs.readFileSync(path.join(__dirname,'a33-pedidos-rapidos-etapa4-json-pwa.smoke.cjs'),'utf8');
// Contrato real de importación, en contexto independiente de Pedidos.
const fixtureContext={require,__dirname,console,URL,URLSearchParams,Blob,setTimeout,clearTimeout,setInterval,clearInterval,globalThis};
vm.runInNewContext(configFixture.slice(0,configFixture.indexOf('const normalized ='))+'\nthis.contractOut=contract;',fixtureContext);
const normalized=fixtureContext.contractOut.normalizeRaw(raw);
assert.deepEqual(Array.from(normalized,r=>r.estado),states);
assert.ok(normalized.every(r=>r.extraHistorica==='conservar'));
const cdmFixture=fs.readFileSync(path.join(__dirname,'a33-pedidos-rapidos-etapa3-cdm.smoke.cjs'),'utf8');
const cdmContext={require,__dirname,console,setTimeout,clearTimeout};
vm.runInNewContext(cdmFixture.slice(0,cdmFixture.indexOf("storage.set('arcano33_pedidos'"))+`\nthis.run=(rows)=>{storage.set('arcano33_pedidos',JSON.stringify(rows));storage.set('arcano33_pedidos_rapidos_v1',JSON.stringify(rows));vm.runInContext("state.today='2026-10-15'",context);return vm.runInContext('readOrdersSignals()',context);};`,cdmContext);
const signal=cdmContext.run(rows);
assert.equal(signal.completePending,3);assert.equal(signal.quickPending,3);
console.log('PASS E6.1: cinco estados, lectores, calendario, respaldo, históricos y Centro de Mando');
