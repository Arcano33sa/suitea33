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
const demand={rows:[{identity:'product:p1',productId:'p1',label:'Uno',registrado:3,estimado:4,total:7},{identity:'product:p1',productId:'p1',label:'Uno',registrado:0,estimado:2,total:2},{identity:'historical:x',productId:'',label:'Uno',registrado:0,estimado:5,total:5}]};
const inventory={stocks:{p1:{stock:8,productId:'p1'}},error:''};const original=JSON.stringify([demand,inventory]);
let rows=context.buildPedidoDisponibilidadPED(demand,inventory);assert.equal(rows.length,2);assert.equal(rows[0].total,9);assert.equal(rows[0].stock,8);assert.equal(rows[0].difference,-1);assert.equal(rows[1].stock,null);assert.equal(JSON.stringify([demand,inventory]),original);
for(const stock of [null,'',true,'bad',{},Infinity])assert.equal(context.buildPedidoDisponibilidadPED(demand,{stocks:{p1:{stock}},error:''})[0].stock,null);
for(const stock of [0,-3,'2.5'])assert.equal(context.buildPedidoDisponibilidadPED(demand,{stocks:{p1:{stock}},error:''})[0].stock,Number(stock));
assert.equal(context.buildPedidoDisponibilidadPED(demand,{stocks:{p1:{stock:8,productId:'other'}},error:''})[0].stock,null);
assert.equal(context.buildPedidoDisponibilidadPED({...demand,error:'bad'},inventory).length,0);
assert.ok(context.readPedidoDisponibilidadPED().error);
localStorage.setItem('arcano33_inventario',JSON.stringify({finishedByProductId:{p1:{stock:8}}}));const before=Array.from(values.entries());assert.equal(context.readPedidoDisponibilidadPED().stocks.p1.stock,8);assert.deepEqual(Array.from(values.entries()),before);
for(const raw of ['null','[]','{}','{broken']){localStorage.setItem('arcano33_inventario',raw);assert.ok(context.readPedidoDisponibilidadPED().error);}
localStorage.getItem=()=>{throw Error('denied')};assert.ok(context.readPedidoDisponibilidadPED().error);
console.log('PASS E6.5: saldo único por producto, estimaciones, déficit, cero y negativos, históricos, lecturas inválidas sin escrituras');
