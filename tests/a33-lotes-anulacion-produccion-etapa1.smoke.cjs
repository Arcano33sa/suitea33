'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/a33-production.js'), 'utf8');
const invKey = 'arcano33_inventario', lotKey = 'arcano33_lotes';
function setup() {
  const lote = { id:'lot1', loteId:'lot1', codigo:'TEST', operationId:'op1', status:'DISPONIBLE' };
  const inv = { liquids:{vino:{stock:17}}, bottles:{b:{stock:25}}, caps:{c:{stock:29}},
    finishedByProductId:{p:{stock:8}}, productionOperations:{op1:{status:'committed', loteId:'lot1'}},
    movimientos:[
      {id:'m1', operationId:'op1', tipoItem:'liquido', itemId:'vino', delta:-5, tipoMovimiento:'consumo_produccion'},
      {id:'m2', operationId:'op1', tipoItem:'envase', itemId:'b', delta:-3, tipoMovimiento:'consumo_produccion'},
      {id:'m3', operationId:'op1', tipoItem:'tapa', itemId:'c', delta:-3, tipoMovimiento:'consumo_produccion'},
      {id:'m4', operationId:'op1', tipoItem:'producto_terminado', itemId:'p', delta:3, tipoMovimiento:'alta_produccion'}] };
  const data = new Map([[invKey, JSON.stringify(inv)], [lotKey, JSON.stringify([lote])]]);
  const localStorage = { getItem:k=>data.get(k) ?? null, setItem:(k,v)=>data.set(k,v), removeItem:k=>data.delete(k) };
  let failLot = false, failRollback = false;
  const context = vm.createContext({ console, localStorage, A33Storage:{sharedReplaceExact(k,v,opts){
    if ((k === lotKey && failLot) || (opts.source === 'anulacion-rollback' && failRollback)) return {ok:false};
    data.set(k,JSON.stringify(v)); return {ok:true};
  }} });
  vm.runInContext(source, context);
  return { lote, data, read:k=>JSON.parse(data.get(k)), cancel:(l=lote)=>context.A33Production.cancelOfficialProduction(l),
    fail:(lot, rollback=false)=>{failLot=lot;failRollback=rollback;} };
}
{
  const t=setup(); assert.equal(t.cancel().ok,true);
  const inv=t.read(invKey);
  assert.equal(inv.liquids.vino.stock,22); assert.equal(inv.bottles.b.stock,28);
  assert.equal(inv.caps.c.stock,32); assert.equal(inv.finishedByProductId.p.stock,5);
  assert.equal(inv.movimientos.length,8); assert.equal(inv.productionOperations.op1.status,'cancelled');
  assert.equal(inv.productionOperations.op1.cancelledLote.id,'lot1'); assert.equal(t.read(lotKey).length,0);
  assert.equal(t.cancel().ok,false); assert.equal(t.read(invKey).liquids.vino.stock,22);
}
for(const patch of [{assignedEventId:'ev1'}, {assignmentHistory:[{id:'ev1'}]}, {operationId:'legacy'}]) {
  const t=setup(); Object.assign(t.lote,patch); t.data.set(lotKey,JSON.stringify([t.lote]));
  const before=t.data.get(invKey); assert.equal(t.cancel().ok,false); assert.equal(t.data.get(invKey),before);
}
{
  const t=setup(); const before=t.data.get(invKey); t.fail(true);
  assert.equal(t.cancel().ok,false); assert.equal(t.data.get(invKey),before); assert.equal(t.read(lotKey).length,1);
  t.fail(false); assert.equal(t.cancel().ok,true); assert.equal(t.read(invKey).liquids.vino.stock,22);
}
{
  const t=setup(); t.fail(true,true); assert.equal(t.cancel().ok,false);
  assert.equal(t.read(invKey).liquids.vino.stock,22);
  t.fail(false); assert.equal(t.cancel().ok,true); assert.equal(t.read(invKey).liquids.vino.stock,22);
  assert.equal(t.read(invKey).movimientos.length,8);
}
{
  const t=setup(); const inv=t.read(invKey); inv.finishedByProductId.p.stock=1;
  t.data.set(invKey,JSON.stringify(inv)); const before=t.data.get(invKey);
  assert.equal(t.cancel().ok,false); assert.equal(t.data.get(invKey),before);
}
{
  const t=setup(); const normalized={...t.lote, volTotal:''};
  // The UI normalizes legacy fields without writing them to storage.
  const ctx=vm.createContext({localStorage:{getItem:k=>t.data.get(k)??null,setItem:(k,v)=>t.data.set(k,v),removeItem:k=>t.data.delete(k)}});
  vm.runInContext(source,ctx);
  assert.equal(ctx.A33Production.cancelOfficialProduction(normalized, row=>({...row,volTotal:''})).ok,true);
}
const ui=fs.readFileSync(path.join(__dirname,'../lotes/script.js'),'utf8');
assert.equal((ui.match(/cancelOfficialProduction\(lote, normalizeLoteRecord\)/g)||[]).length,2,'Tabla y tarjetas usan la misma anulación');
// Smoke de los dos manejadores reales de la interfaz (tabla y tarjetas).
const branch = "        if (effectiveLoteStatus(lote) === 'DISPONIBLE') {";
let offset=0;
for (let index=0; index<2; index++) {
  const start=ui.indexOf(branch,offset);
  const end=ui.indexOf("        const code =",start);
  const t=setup(); let rendered=0, archived=0, notices=[];
  const ctx=vm.createContext({
    lote:t.lote, effectiveLoteStatus:()=> 'DISPONIBLE', confirm:()=>true,
    window:{A33Production:{cancelOfficialProduction:()=>t.cancel()}, A33Notice:{alert:m=>notices.push(m)}},
    normalizeLoteRecord:x=>x, archiveLote:()=>archived++, editingId:null,
    renderTable:()=>rendered++, isHistoryModalOpen:()=>false, console
  });
  vm.runInContext('(function(){'+ui.slice(start,end)+'})()',ctx);
  assert.equal(rendered,1); assert.equal(archived,1); assert.equal(notices.length,1);
  assert.equal(t.read(invKey).bottles.b.stock,28); assert.equal(t.read(lotKey).length,0);
  offset=end;
}
console.log('OK: devolución exacta, movimientos posteriores, doble anulación, evento, legacy, normalización, fallos y reintento; tabla y tarjetas.');
