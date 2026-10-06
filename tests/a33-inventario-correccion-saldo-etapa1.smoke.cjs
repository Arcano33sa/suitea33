'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = {window:{},document:{addEventListener(){}},console,setTimeout,clearTimeout};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../inventario/script.js'),'utf8'),ctx);
const def={id:'galon-id',productId:'galon-id',nombre:'Galón',stockSection:'finishedByProductId',stockKey:'galon-id'};
const fixture=()=>({finished:{legacy:{stock:7}},finishedByProductId:{'galon-id':{stock:3},other:{stock:12}},movimientos:[{id:'historia'}],bottles:{envase:{stock:8}}});
for(const [qty,reason,expected] of [[4,'motivo',3],[0,'motivo',3],[-1,'motivo',3],[1.5,'motivo',3],[3,' ',3],[3,'motivo',9]]){
 const inv=fixture(),before=JSON.stringify(inv);
 assert.equal(ctx.corregirSaldoProductoTerminado(inv,def,qty,reason,expected).ok,false);
 assert.equal(JSON.stringify(inv),before);
}
const inv=fixture();
assert.equal(ctx.corregirSaldoProductoTerminado(inv,def,3,'Corrección por lote borrado A33TIS5787-01xx',3).ok,true);
assert.equal(inv.finishedByProductId['galon-id'].stock,0);
assert.equal(inv.finishedByProductId.other.stock,12);
assert.equal(inv.finished.legacy.stock,7);
assert.equal(inv.bottles.envase.stock,8);
assert.equal(inv.movimientos.length,2);
assert.equal(inv.movimientos[0].id,'historia');
assert.equal(inv.movimientos[1].delta,-3);
assert.equal(inv.movimientos[1].stockAnterior,3);
assert.equal(inv.movimientos[1].stockNuevo,0);
assert.match(inv.movimientos[1].nota,/A33TIS5787-01xx/);
assert.equal(ctx.corregirSaldoProductoTerminado(inv,def,3,'repetir',3).ok,false);
const partial=fixture();assert.equal(ctx.corregirSaldoProductoTerminado(partial,def,1,'conteo',3).ok,true);assert.equal(partial.finishedByProductId['galon-id'].stock,2);
const legacyDef={id:'legacy:legacy',nombre:'Histórico',stockSection:'finished',stockKey:'legacy'};
assert.equal(ctx.corregirSaldoProductoTerminado(partial,legacyDef,2,'conteo histórico',7).ok,true);assert.equal(partial.finished.legacy.stock,5);assert.equal(partial.movimientos.at(-1).itemId,'legacy');
console.log('OK: corrección total/parcial, historial, aislamiento, validaciones, saldo cambiado y doble aplicación bloqueada.');

// Smoke del flujo de interfaz: cancelación, motivo obligatorio, confirmación y guardado.
(async()=>{
 let handler, saves=0, alerts=0;
 const ui=fixture();
 ctx.ui=ui;ctx.def=def;
 ctx.document.getElementById=id=>id==='inv-productos-body'?{addEventListener:(name,fn)=>{handler=fn;}}:null;
 vm.runInContext("INV_FINISHED_DEFS = [def]; setStatus = ()=>{}; saveInventario = ()=>{ saves++; return true; }; updateFinishedRow = ()=>{}; applyView = ()=>{};",ctx);
 ctx.saves=0;
 ctx.safeAlert=()=>{alerts++;};
 ctx.window.confirm=()=>true;
 ctx.window.prompt=()=> 'Corrección por lote borrado A33TIS5787-01xx';
 ctx.openCantidadModal=async()=>null;
 ctx.attachListeners(ui);
 const event={target:{closest:()=>({dataset:{finishedCorrection:'galon-id'}})}};
 await handler(event);assert.equal(ui.finishedByProductId['galon-id'].stock,3);
 ctx.openCantidadModal=async()=> '3';ctx.window.prompt=()=> ' ';
 await handler(event);assert.equal(alerts,1);assert.equal(ui.movimientos.length,1);
 ctx.window.prompt=()=> 'Corrección por lote borrado A33TIS5787-01xx';ctx.window.confirm=()=>false;
 await handler(event);assert.equal(ui.finishedByProductId['galon-id'].stock,3);
 ctx.window.confirm=()=>true;
 await handler(event);assert.equal(ui.finishedByProductId['galon-id'].stock,0);assert.equal(ctx.saves,1);
 assert.equal(ui.movimientos.length,2);
 console.log('OK smoke interfaz: cancelar, motivo vacío, rechazar confirmación y confirmar 3 → 0.');
})().catch(error=>{console.error(error);process.exitCode=1;});
