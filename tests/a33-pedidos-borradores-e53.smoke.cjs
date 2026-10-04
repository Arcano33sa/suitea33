'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../pedidos/script.js'),'utf8');
const block=src.slice(src.indexOf('// E5.3: borradores de formularios'));
const data=new Map(),notices=[];let allow=false,fail=false,removed=0;
const fields={'pedido-draft-status':{},fechaCreacion:{value:'2026-10-03'},clienteReferencia:{value:'Pendiente'}};
const c=vm.createContext({console,Date,Math,$:id=>fields[id],confirm:()=>allow,document:{querySelectorAll:()=>[]},
 A33Storage:{setItem(k,v){if(fail)return false;data.set(k,v);return true;},removeItem(k){removed++;data.delete(k);return true;}},
 viewingArchivedId:null,editingId:null,editingBaseUpdatedAt:null,quickOrderEditingId:null,quickOrderEditingUpdatedAt:null,currentHistoricalPedidoItemsPED:[],currentPriceSnapshot:{},PRESENTACIONES:[],quickOrderItemsDraft:[],
 ensureDraftPedidoId:()=> 'stable-main',createQuickOrderIdPED:()=> 'stable-quick',getCustomerFromUI:()=>({id:'c',name:'Cliente'}),getQuickCustomerPED:()=>({id:'c',name:'Cliente'}),
 loadPedidos:()=>[{id:'exists',updatedAt:4}],loadQuickOrdersPED:()=>[{id:'q',updatedAt:7}]});
vm.runInContext(block,c);vm.runInContext('pedFormDraftState.ready=true;pedFormDraftState.completo.dirty=true;',c);
assert.equal(c.persistPedidoFormDraftPED('completo'),true);const [key,raw]=[...data][0],record=JSON.parse(raw);
assert.equal(record.draftId,'stable-main');assert.equal(record.fields.clienteReferencia,'Pendiente');assert.equal(c.validatePedidoFormDraftPED(record),true);
for(const wrong of [{...record,schemaVersion:9},{...record,products:[{rawQty:2}]},{...record,fields:{bad:3}},{...record,mode:'unknown'}])assert.equal(c.validatePedidoFormDraftPED(wrong),false);
fail=true;fields.clienteReferencia.value='Texto nuevo';assert.equal(c.persistPedidoFormDraftPED('completo'),false);assert.equal(data.get(key),raw);assert.match(fields['pedido-draft-status'].textContent,/No se pudo/);
assert.equal(c.discardCurrentPedidoDraftPED('completo',false),false);assert.equal(removed,0);allow=true;assert.equal(c.discardCurrentPedidoDraftPED('completo',false),true);assert.equal(removed,1);
vm.runInContext("Object.assign(pedFormDraftState.completo,{recovered:true,editingId:'exists',baseUpdatedAt:3});",c);assert.match(c.recoveredPedidoConflictPED('completo'),/cambió/);
vm.runInContext('pedFormDraftState.completo.baseUpdatedAt=4;',c);assert.equal(c.recoveredPedidoConflictPED('completo'),'');
vm.runInContext("pedFormDraftState.completo.editingId='missing';",c);assert.match(c.recoveredPedidoConflictPED('completo'),/no está disponible/);
vm.runInContext("Object.assign(pedFormDraftState.completo,{editingId:null,draftId:'exists'});",c);assert.match(c.recoveredPedidoConflictPED('completo'),/ya registrado/);
vm.runInContext("Object.assign(pedFormDraftState.rapido,{recovered:true,editingId:'q',baseUpdatedAt:6});",c);assert.match(c.recoveredPedidoConflictPED('rapido'),/cambió/);
const quick=c.capturePedidoFormDraftPED('rapido');assert.equal(c.validatePedidoFormDraftPED(quick),true);assert.equal(quick.draftId,'stable-quick');
assert.notEqual(c.pedidoDraftKeyPED('completo'),c.pedidoDraftKeyPED('rapido'));
console.log('PASS E5.3: captura, validación, fallo conservador, descarte explícito, identidad y conflictos en ambas modalidades');
