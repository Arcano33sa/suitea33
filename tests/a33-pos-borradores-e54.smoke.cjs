'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../pos/app.js'),'utf8');
const block=source.slice(source.indexOf('// E5.4: copias provisionales'));
const fields=Object.fromEntries(['purchase-draft-status','purchase-draft-warning','sale-payment','sale-bank','sale-notes','sale-cash-mode','sale-cash-usd-received','purchase-search','sale-return','sale-customer-sticky','purchase-more-options','sale-date'].map(id=>[id,{value:'',checked:false,hidden:true}]));
fields['sale-payment'].value='efectivo';fields['sale-cash-mode'].value='nio';fields['sale-date'].value='2026-10-03';
let fail=false,closed=false,event={id:1},sales=[];const stored=new Map();
const state={draftKey:'a33_pos_purchase_draft_v1_test',draftDirty:false,purchaseUid:'attempt',eventId:1,date:'2026-10-03',items:[{key:'product:a',productId:'a',name:'Producto',qty:'',unitPrice:'5',discountPerUnit:'',courtesy:false}]};
const c=vm.createContext({Date,Set,Number,String,console,document:{getElementById:id=>fields[id]},purchaseModalStatePOS:state,purchaseOpeningPOS:false,purchaseRecoveringPOS:false,
 A33Storage:{setItem(k,v){if(fail)return false;stored.set(k,v);return true;}},getCustomerNameFromUI_POS:()=> 'Cliente',getCustomerIdHintFromUI_POS:()=> 'c',posCurrencyCentralExchangeRatePOS:()=>36.8,
 getActiveEventPOS:async()=>event,guardSellDayOpenOrToastPOS:async()=>!closed,getAll:async()=>sales});
vm.runInContext(block,c);
assert.equal(c.persistPurchaseDraftPOS(),true);assert.equal(stored.size,0,'Abrir una compra vacía no crea copia');
assert.equal(c.persistPurchaseDraftPOS({changed:true}),true);const raw=stored.get(state.draftKey),record=JSON.parse(raw);
assert.equal(c.validatePurchaseDraftPOS(record),true);assert.equal(record.items[0].qty,'');assert.equal(record.purchaseUid,'attempt');
assert(!('priorCustomer' in record));assert(!('catalog' in record));assert(!('busy' in record));
for(const bad of [{...record,schemaVersion:2},{...record,eventId:null},{...record,items:[...record.items,...record.items]},{...record,fields:{}}])assert.equal(c.validatePurchaseDraftPOS(bad),false);
fail=true;state.items[0].qty='Nuevo';assert.equal(c.persistPurchaseDraftPOS({changed:true}),false);assert.equal(stored.get(state.draftKey),raw);assert.equal(fields['purchase-draft-warning'].hidden,false);
state.committed=true;assert.equal(c.persistPurchaseDraftPOS({changed:true}),true);assert.equal(stored.get(state.draftKey),raw);
const catalog=[{key:'product:a',unitPrice:99},{key:'extra:2',unitPrice:10}];
assert.equal(c.recoveredPurchaseCatalogProblemPOS(record.items,catalog),'','Precio manual de producto se conserva');
assert.match(c.recoveredPurchaseCatalogProblemPOS([{key:'product:gone',name:'Ausente'}],catalog),/no está disponible/);
assert.match(c.recoveredPurchaseCatalogProblemPOS([{key:'extra:2',isExtra:true,name:'Extra',unitPrice:'5'}],catalog),/precio.*cambió/);
// Si falla quitar la copia después de confirmar la venta, el modal igualmente se cierra.
fields['purchase-modal']={style:{},setAttribute(){}};
c.A33Storage.removeItem=()=>{throw Error('storage bloqueado');};
c.closeCustomerPickerPOS=()=>{};c.resetSaleCashTenderPOS=()=>{};c.purchaseBackgroundInertPOS=()=>{};
vm.runInContext(source.slice(source.indexOf('function closePurchaseModalPOS('),source.indexOf('function setPurchaseBusyPOS(')),c);
c.closePurchaseModalPOS({committed:true});assert.equal(c.purchaseModalStatePOS,null);
assert.match(fields['purchase-draft-status'].textContent,/Compra registrada/);assert.equal(stored.get(state.draftKey),raw);
(async()=>{
 assert.equal((await c.checkPurchaseRecoveryContextPOS(record)).id,1);
 event={id:2};await assert.rejects(c.checkPurchaseRecoveryContextPOS(record),/Seleccioná/);event={id:1};
 fields['sale-date'].value='2026-10-04';await assert.rejects(c.checkPurchaseRecoveryContextPOS(record),/Seleccioná/);fields['sale-date'].value=record.date;
 closed=true;await assert.rejects(c.checkPurchaseRecoveryContextPOS(record),/cerrado/);closed=false;
 sales=[{purchaseUid:'attempt'}];await assert.rejects(c.checkPurchaseRecoveryContextPOS(record),/ya fue registrada/);
 console.log('PASS E5.4: estructura, cantidades incompletas, identidad, fallo conservador, contexto cerrado/cambiado, intento registrado y catálogo vigente');
})().catch(err=>{console.error(err);process.exitCode=1;});
