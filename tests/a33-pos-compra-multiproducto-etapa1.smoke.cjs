'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname,'../pos/app.js'),'utf8');
const block = source.slice(source.indexOf('// Compras multiproducto — Etapa 1.'),source.indexOf('// Guardar cierre diario + candado'));
const round2 = n => Math.round((n + Number.EPSILON)*100)/100;
// Transacciones simuladas con copia aislada, cola de requests y commit/rollback.
let stored, failAt, inserts, effects;
function reset(){ stored={ sales:[], events:[{id:1,saleSeq:0}], dayLocks:[] }; failAt=0; inserts=0; effects=[]; }
reset();
const db={ transaction(){
  const local=structuredClone(stored); const queue=[]; let aborted=false, scheduled=false, nextId=1;
  const tr={ error:null, abort(){ aborted=true; tr.error=new Error('fallo simulado'); } };
  function drain(){
    scheduled=false;
    if(aborted){ tr.onabort?.(); return; }
    const job=queue.shift();
    if(job){ job(); schedule(); }
    else { stored=local; tr.oncomplete?.(); }
  }
  function schedule(){ if(!scheduled){ scheduled=true; setImmediate(drain); } }
  function request(fn){ const req={}; queue.push(()=>{
    try{ req.result=fn(); req.onsuccess?.(); }catch(e){req.error=e; tr.error=e; req.onerror?.(); tr.onerror?.(); aborted=true;}
  }); schedule(); return req; }
  tr.objectStore=name=>({
    get:key=>request(()=>structuredClone(local[name].find(x=>(name==='dayLocks'?x.key:x.id)===key))),
    getAll:()=>request(()=>structuredClone(local[name])),
    add:value=>request(()=>{ if(++inserts===failAt) throw new Error('storage lleno'); const row=structuredClone(value); row.id=nextId++; local[name].push(row); return row.id; }),
    put:value=>request(()=>{const row=structuredClone(value);const i=local[name].findIndex(x=>x.id===row.id); if(i<0)local[name].push(row);else local[name][i]=row;return row.id;})
  }); return tr;
}};
const context={db, round2, console, Set, JSON, Error, structuredClone,
  parseNumPOS:(v,fallback=0)=>v==null||v===''?fallback:Number(v),
  getEventByIdPOS:async id=>structuredClone(stored.events.find(x=>x.id===id)),
  validateSaleMinimalPOS:s=>({ok:Number.isFinite(s.total) && s.qty!==0,msg:'inválida'}),
  validateSaleCardCommissionSnapshotPOS:()=>({ok:true}),
  normalizePaymentMethodPOS:s=>s,
  notifyCreditStateChangedPOS:()=>effects.push('credito'),
  makeDayLockKeyPOS:(eventId,date)=>`${eventId}|${date}`,
  reserveSaleSeqInMemoryPOS:(event,line)=>{const next=(event.saleSeq||0)+1;line.seqId=next;return {nextSeq:next,eventUpdated:{...event,saleSeq:next}};},
  applySaleCashTenderToRecordPOS:(record,tender)=>Object.assign(record,structuredClone(tender)),
  getAll:async name=>structuredClone(stored[name]),
  confirm:()=>false,
  validateSaleCashTenderPOS:({total})=>({ok:true,tender:{cashTenderMode:'NIO_ONLY',cashExpectedDelta:{NIO:total,USD:0},cashBreakdown:{totalNIO:total,receivedNIO:total}}}),
  addSale:async draft=>line(draft.productId,draft.unitPrice,{qty:draft.qty,discountPerUnit:draft.discountPerUnit,courtesy:draft.courtesy,isReturn:draft.isReturn}),
  periodKeyFromDatePOS:()=>'', bumpConsolSalesRevPOS:()=>{},clearConsolLiveCachePOS:()=>{},
  applyFinishedFromSalePOS:s=>effects.push(`stock:${s.id}`),
  ensurePhysicalCupConsumptionForSalePOS:async s=>{effects.push(`vaso:${s.id}`);return {ok:true};},
  createJournalEntryForSalePOS:async s=>effects.push(`finanzas:${s.id}`),
  saleTouchesLotsPOS:()=>false,
};
vm.createContext(context);vm.runInContext(block+'\nthis.api={savePurchasePOS,savePurchaseAndEventAtomicPOS,applyPurchaseTenderPOS};',context);
const {api}=context;
function line(productId,total,extra={}){return {eventId:1,date:'2026-10-01',productId,qty:1,unitPrice:total,total,discountPerUnit:0,courtesy:false,isReturn:false,customerId:8,customerName:'Cliente',payment:'efectivo',bankId:null,notes:'',...extra};}
function save(records,uid='purchase-1'){return api.savePurchaseAndEventAtomicPOS({records,purchaseUid:uid,expectedSalesSnapshot:JSON.stringify(stored.sales)});}
// Ejecuta también la preparación real de addSale; cualquier persistencia/UI sería un error.
const prepareContext={round2,console, Number,String,Date,Math,encodeURIComponent,
  getMeta:async()=>1, parseSelectedSellItemValue:v=>({kind:'product',productId:decodeURIComponent(v.slice(8))}),
  parseNumPOS:(v,fallback=0)=>v==null||v===''?fallback:Number(v), normalizePaymentMethodPOS:s=>s,
  resolveCustomerIdForSalePOS:()=>({id:8,displayName:'Cliente'}),
  posNotify:()=>{},isBankPaymentMethodPOS:()=>false,
  getAll:async name=>name==='events'?[{id:1,name:'Evento'}]:[{productId:'a',name:'Producto'}],
  guardSellDayOpenOrToastPOS:async()=>true,
  findCatalogProductByStableIdPOS:(products,id)=>id==='a'?products[0]:null,
  productSellableInPOS:()=>true,
  buildSaleProductSnapshotPOS:(product,price)=>({productId:'a',productName:'Producto',productNameSnapshot:'Producto',unitPrice:price,unitPriceSnapshot:price}),
  guardLotAvailabilityBeforeSalePOS:async()=>({ok:true}),productManageStockForSalePOS:()=>true,
  computeStock:async()=>20,
  resolveSaleLotAllocationPOS:async()=>({allocations:[]}), resolveReturnLotAllocationPOS:async()=>({allocations:[]}),
  resolveSaleUnitCostPOS:async()=>({unitCost:10,source:'test'}),
  buildSaleEconomicSnapshotPOS:({unitPrice,qty,discount,total,unitCost})=>({subtotal:round2(unitPrice*Math.abs(qty)),discountTotal:discount,ventaNeta:total,costPerUnit:unitCost,costTotal:qty*unitCost,lineCost:qty*unitCost,lineProfit:total-qty*unitCost,utilidad:total-qty*unitCost}),
  buildSaleCardCommissionSnapshotPOS:()=>null,applySaleCardCommissionSnapshotPOS:()=>{},
  applySaleCashTenderToRecordPOS:()=>{},
  validateSaleMinimalPOS:s=>({ok:Number.isFinite(s.unitPrice)&&s.unitPrice>=0}),
  validateSaleCardCommissionSnapshotPOS:()=>({ok:true}),
  $:()=>{throw new Error('La preparación no debe leer ni modificar el formulario');},
  saveSaleAndEventAtomicPOS:()=>{throw new Error('Persistencia antes de validar toda la compra');}
};
vm.createContext(prepareContext);
vm.runInContext(source.slice(source.indexOf('async function addSale(){'),source.indexOf('async function addExtraSale(extraId)'))+'\nthis.prepare=addSale;',prepareContext);
(async()=>{
  const item={__a33PurchaseDraft:true,eventId:1,date:'2026-10-01',productId:'a',qty:3,unitPrice:100,discountPerUnit:5,payment:'efectivo'};
  let prepared=await prepareContext.prepare(item);
  assert.equal(prepared.total,285);assert.equal(prepared.discount,15);assert.equal(prepared.qty,3);
  assert.equal(stored.sales.length,0);
  prepared=await prepareContext.prepare({...item,courtesy:true});assert.equal(prepared.total,0);assert.equal(prepared.discount,0);
  prepared=await prepareContext.prepare({...item,isReturn:true});assert.equal(prepared.total,-285);assert.equal(prepared.qty,-3);
  assert.equal(await prepareContext.prepare({...item,discountPerUnit:101}),undefined);
  await assert.rejects(prepareContext.prepare({...item,qty:-1}),/Cantidad inválida/);
  await assert.rejects(prepareContext.prepare({...item,unitPrice:'no-numero'}),/Precio inválido/);
  await assert.rejects(prepareContext.prepare({...item,unitPrice:-5}),/Precio inválido/);
  await assert.rejects(prepareContext.prepare({...item,eventId:2}),/evento activo cambió/);
  let result=await save([line('a',100),line('b',50)]);
  assert.equal(result.records.length,2); assert.equal(result.total,150);
  assert.equal(stored.events[0].saleSeq,2);assert.equal(stored.sales[1].seqId,2);
  assert.equal(stored.sales[0].purchaseUid,stored.sales[1].purchaseUid);
  const before=JSON.stringify(stored);
  result=await save([line('a',100),line('b',50)]);
  assert.equal(result.duplicate,true);assert.equal(JSON.stringify(stored),before);
  await assert.rejects(save([line('a',99),line('b',50)]),/otros datos/);
  assert.equal(JSON.stringify(stored),before);
  reset(); failAt=2;
  await assert.rejects(save([line('a',100),line('b',50)]));
  assert.equal(stored.sales.length,0);assert.equal(stored.events[0].saleSeq,0);
  reset();stored.events[0].extras=[{id:1,name:'Extra',stock:10,active:true}];failAt=2;
  await assert.rejects(save([line('a',100),line(null,20,{isExtra:true,extraId:1})]));
  assert.equal(stored.sales.length,0);assert.equal(stored.events[0].extras[0].stock,10);
  reset();stored.events[0].extras=[{id:1,name:'Extra',stock:10,active:true}];
  await save([line('a',100),line(null,20,{isExtra:true,extraId:1})]);
  assert.equal(stored.events[0].extras[0].stock,9);
  result=await save([line('a',100),line(null,20,{isExtra:true,extraId:1})]);
  assert.equal(result.duplicate,true);assert.equal(stored.events[0].extras[0].stock,9);
  reset();stored.events[0].extras=[{id:1,name:'Extra',stock:0,active:true}];
  await assert.rejects(save([line('a',100),line(null,20,{isExtra:true,extraId:1})]),/sin stock/);
  assert.equal(stored.sales.length,0);
  reset();stored.events[0].closedAt=123;
  await assert.rejects(save([line('a',10)]),/cerrado/);assert.equal(stored.sales.length,0);
  reset();stored.dayLocks.push({key:'1|2026-10-01',isClosed:true});
  await assert.rejects(save([line('a',10)]),/día está cerrado/);
  reset();
  await assert.rejects(api.savePurchaseAndEventAtomicPOS({records:[line('a',10)],purchaseUid:'x',expectedSalesSnapshot:'stale'}),/ventas cambiaron/);
  assert.equal(stored.sales.length,0);
  await assert.rejects(save([line('a',10),line('b',20,{customerId:9})]),/misma compra/);
  await assert.rejects(save([line('a',10),line('b',20,{isReturn:true})]),/misma compra/);
  await assert.rejects(save([line('a',NaN)]),/inválida/);
  reset();const records=[line('gift',0,{courtesy:true}),line('a',100),line('b',50)];
  api.applyPurchaseTenderPOS(records,{cashTenderMode:'USD_CHANGE_NIO',fxUsed:36,receivedUSD:5,usdReceived:5,equivalentNIO:180,changeNIO:30,cashExpectedDelta:{NIO:-30,USD:5},cashBreakdown:{totalNIO:150,receivedUSD:5,changeNIO:30}});
  assert.equal(records.reduce((sum,s)=>sum+s.cashExpectedDelta.USD,0),5);
  assert.equal(records.reduce((sum,s)=>sum+s.cashExpectedDelta.NIO,0),-30);
  assert.equal(records.filter(s=>s.purchaseTenderOwner).length,1);
  assert.equal(records[1].receivedUSD,5);assert.equal(records[2].receivedUSD,undefined);
  await save(records);
  reset();const nio=[line('a',100),line('b',50),line('gift',0,{courtesy:true})];
  api.applyPurchaseTenderPOS(nio,{cashTenderMode:'NIO_ONLY',cashBreakdown:{}});
  assert.equal(nio.reduce((sum,s)=>sum+s.cashExpectedDelta.NIO,0),150);
  const draft={eventId:1,date:'2026-10-01',purchaseUid:'batch',payment:'efectivo',items:[{productId:'a',unitPrice:100,qty:1},{productId:'b',unitPrice:50,qty:1}]};
  reset();failAt=2;await assert.rejects(api.savePurchasePOS(draft));assert.deepEqual(effects,[]);assert.equal(stored.sales.length,0);
  reset();result=await api.savePurchasePOS(draft);assert.equal(result.total,150);assert.equal(effects.length,6);
  result=await api.savePurchasePOS(draft);assert.equal(result.duplicate,true);assert.equal(effects.length,6);
  reset();context.createJournalEntryForSalePOS=async()=>{throw new Error('Finanzas bloqueado');};
  result=await api.savePurchasePOS(draft);assert.equal(stored.sales.length,2);assert.equal(result.warnings.length,2);
  await assert.rejects(api.savePurchasePOS({...draft,items:[draft.items[0],draft.items[0]]}),/sola línea/);
  reset();context.addSale=async draft=>line(draft.productId,draft.unitPrice,{customerId:null,courtesy:!!draft.courtesy,payment:draft.payment});
  await assert.rejects(api.savePurchasePOS({...draft,payment:'credito'}),/cliente.*crédito/);
  await assert.rejects(api.savePurchasePOS({...draft,items:[{...draft.items[0],courtesy:true}]}),/cliente.*cortesía/);
  result=await api.savePurchasePOS(draft);assert.equal(result.cancelled,true);assert.equal(stored.sales.length,0);
  console.log('PASS compra multiproducto: atomicidad, rollback, dedupe, cierres, concurrencia, cobro único, efectos post-commit y alertas.');
})().catch(error=>{console.error(error);process.exitCode=1;});
