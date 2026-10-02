'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catalog = [{id:'active',name:'Botella activa',active:true},{id:'inactive',name:'Envase inactivo',active:false}];
const storage = {getItem:key=>key==='a33_catalog_envases_v1'?JSON.stringify(catalog):null,
  setItem(){throw Error('La consulta no debe escribir datos');}};
const ctx = {window:{localStorage:storage},document:{addEventListener(){}},localStorage:storage,console,setTimeout,clearTimeout};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../inventario/script.js'),'utf8'),ctx);
const inv={bottles:{active:{stock:5},inactive:{stock:2},removed:{stock:200},empty:{stock:0},unknown:{stock:1},named:{stock:3,nombre:'Nombre guardado'}},movimientos:[
 {itemId:'removed',tipoItem:'envase',nombreSnapshot:'Vaso'},
 {itemId:'empty',tipoItem:'envase',nombreSnapshot:'Botella Catrinita'},
 {itemId:'removed',tipoItem:'producto',nombreSnapshot:'Nombre de otro tipo'},
 {itemId:'named',tipoItem:'envase',nombreSnapshot:'Nombre anterior'}]};
ctx.inv=inv; const before=JSON.stringify(inv);
const defs=vm.runInContext('buildBottleDefs(inv)',ctx);
assert.equal(defs.find(d=>d.id==='removed').nombre,'Vaso');
assert.equal(defs.find(d=>d.id==='empty').nombre,'Botella Catrinita');
assert.equal(defs.find(d=>d.id==='unknown').nombre,'unknown');
assert.equal(defs.find(d=>d.id==='named').nombre,'Nombre guardado');
assert.equal(defs.filter(d=>d.operational).length,1);
assert.equal(defs.find(d=>d.id==='inactive').operational,false);
assert.equal(JSON.stringify(inv),before);
console.log('OK nombres históricos, prioridad del nombre guardado, filtro por tipo, referencia desconocida, activo/inactivo, stock cero con historial y datos intactos.');
