'use strict';
// Datos ficticios en un origen interceptado y perfil temporal; sin acceso a producción.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
let playwright;
try{playwright=require('playwright');}
catch(_){playwright=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const root=path.resolve(__dirname,'..'),origin='http://a33-purchase-delete.test';
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
let browser;
(async()=>{
  browser=await playwright.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({serviceWorkers:'block',timezoneId:'America/Managua'});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort();
    const pathname=decodeURIComponent(url.pathname),file=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
    return route.fulfill({body:fs.readFileSync(file),contentType:mime[path.extname(file)]||'application/octet-stream'});
  });
  const page=await context.newPage(),errors=[],confirmations=[];
  let approve=false;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',async dialog=>{
    if(dialog.type()==='confirm'){confirmations.push(dialog.message());if(approve)await dialog.accept();else await dialog.dismiss();}
    else await dialog.accept();
  });
  await page.goto(origin+'/pos/');
  await page.waitForFunction(()=>document.getElementById('purchase-modal')?.dataset.bound==='1');
  await page.evaluate(async()=>{
    const date=cashV2DayKeyFromTsLocal(Date.now());
    window.e2Date=date;
    for(const product of [
      {id:9001,productId:'e2-a',name:'Producto A',price:100,unitCost:20,manageStock:true},
      {id:9002,productId:'e2-b',name:'Producto B',price:50,unitCost:10,manageStock:true},
      {id:9003,productId:'e2-cup',name:'Vaso moderno',price:30,unitCost:8,manageStock:false,vasoFisicoId:'e2-physical'},
      {id:9004,productId:'e2-lot',name:'Producto lote',price:40,unitCost:10,manageStock:true,receta:true}
    ])await put('products',{...product,pos:true,isActive:true,receta:!!product.receta});
    await put('events',{id:9001,name:'Evento principal',saleSeq:0,cashV2Active:true,extras:[{id:1,name:'Extra prueba',stock:20,unitPrice:20,unitCost:5,active:true}]});
    await put('events',{id:9002,name:'Otro evento',saleSeq:0,cashV2Active:false});
    for(const eventId of [9001,9002])for(const productId of [9001,9002,9003])await put('inventory',{eventId,productId,qty:100,type:'restock',date});
    await put('cashV2',{key:cashV2Key('9001',date),eventId:'9001',dayKey:date,status:'OPEN',initial:{totalC:100,totalUSD:0},audit:[],movements:[{id:'manual-independent',kind:'IN',amount:40,currency:'NIO',desc:'Entrada independiente'}]});
    await put('banks',{id:9001,name:'Banco transferencia',type:'transferencia',isActive:true});
    await put('banks',{id:9002,name:'Banco tarjeta',type:'tarjeta',commissionPct:7,isActive:true});
    A33Storage.sharedSet('a33_pos_customersCatalog',[{id:'e2-customer',name:'Cliente E2',isActive:true}],{source:'test'});
    A33Storage.sharedSet('suite_a33_currency_settings_v1',{exchangeRate:'36.80'},{source:'test'});
    A33Storage.sharedSet(STORAGE_KEY_INVENTARIO,{finishedByProductId:{'e2-a':{stock:100},'e2-b':{stock:100},'e2-lot':{stock:30}},varios:[{id:'e2-physical',producto:'Vaso físico',stock:20}],movimientos:[]},{source:'test'});
    await ensureFinanzasDB();
    await new Promise((resolve,reject)=>{
      const tx=finDb.transaction('accounts','readwrite');
      for(const account of [
        {code:'1121',nombre:'Caja eventos',tipo:'activo'},{code:'1211',nombre:'Banco',tipo:'activo'},
        {code:'1311',nombre:'Clientes',tipo:'activo'},{code:'1501',nombre:'Inventario productos',tipo:'activo'},
        {code:'4211',nombre:'Ventas POS',tipo:'ingreso'},{code:'5101',nombre:'Costo ventas',tipo:'costo'},
        {code:'6113',nombre:'Cortesías',tipo:'gasto'}
      ])tx.objectStore('accounts').put({...account,currency:'NIO',isActive:true,isPostable:true});
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};
    });
    localStorage.setItem('a33_finanzas_per_sale','1');
    window.e2Create=async(uid,items,options={})=>{
      const eventId=options.eventId || 9001;
      await setMeta('currentEventId',eventId);
      document.getElementById('sale-date').value=date;
      if(!options.usd)resetSaleCashTenderPOS();
      return savePurchasePOS({purchaseUid:uid,eventId,date,payment:'efectivo',customerId:'e2-customer',customerName:'Cliente E2',notes:'Prueba E2',...options,items});
    };
    window.e2Draft=async saleId=>{
      const ctx=await readCreditEditContextPOS(saleId);
      return {saleId,operationId:cashV2NewRequestId('TEST-DELETE'),expectedLines:JSON.stringify(purchaseEditLinesPOS(ctx.data.sales,ctx.sale))};
    };
    window.e2Snapshot=async()=>JSON.stringify({sales:await getAll('sales'),events:await getAll('events'),inv:invCentralLoadPOS(),cash:await getAll(CASH_V2_STORE),meta:await getAll('meta')});
    window.e2Books=async()=>new Promise((resolve,reject)=>{
      const tx=finDb.transaction(['journalEntries','journalLines'],'readonly'),data={};
      for(const name of ['journalEntries','journalLines']){const req=tx.objectStore(name).getAll();req.onsuccess=()=>data[name]=req.result;}
      tx.oncomplete=()=>resolve(data);tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};
    });
    const main=await e2Create('delete-main',[{productId:'e2-a',qty:2,unitPrice:100,discountPerUnit:5},{productId:'e2-b',qty:1,unitPrice:50},{extraId:1,qty:2,unitPrice:20}]);
    window.e2Main=main.records[0].id;window.e2MainIds=main.records.map(sale=>sale.id);
    await e2Create('keep-unrelated',[{productId:'e2-a',qty:1,unitPrice:100},{extraId:1,qty:1,unitPrice:20}]);
    await e2Create('keep-other-event',[{productId:'e2-b',qty:1,unitPrice:50}],{eventId:9002});
    await setMeta('currentEventId',9001);await refreshEventUI();await renderDay();
    const originalRequest=requestPurchaseDeletionPOS;
    window.e2DeletionCount=0;
    requestPurchaseDeletionPOS=(...args)=>{window.e2DeletionCount++;window.e2DeletionPromise=originalRequest(...args);return window.e2DeletionPromise;};
  });
  // The trash icon is enabled and confirmation names all products, not only the clicked row.
  const mainId=await page.evaluate(()=>e2Main),cancelBefore=await page.evaluate(()=>e2Snapshot());
  assert.equal(await page.locator(`#tbl-day .del-sale[data-id="${mainId}"]`).isEnabled(),true);
  await page.locator(`#tbl-day .del-sale[data-id="${mainId}"]`).click();
  await page.evaluate(()=>e2DeletionPromise);
  assert.match(confirmations.at(-1),/compra completa/);
  for(const name of ['Producto A','Producto B','Extra prueba','280'])assert(confirmations.at(-1).includes(name));
  assert.equal(await page.evaluate(()=>e2Snapshot()),cancelBefore,'Cancelar modificó información');
  assert.equal(await page.locator(`#tbl-day .del-sale[data-id="${mainId}"]`).isEnabled(),true);
  const cashBefore=await page.evaluate(()=>getAll(CASH_V2_STORE));
  approve=true;
  await page.locator(`#tbl-day .del-sale[data-id="${mainId}"]`).click();
  await page.evaluate(()=>e2DeletionPromise);
  const removed=await page.evaluate(async()=>({sales:await getAll('sales'),inv:invCentralLoadPOS(),event:await getEventByIdPOS(9001),cash:await getAll(CASH_V2_STORE),physical:await cashV2ComputeCashSalesPhysicalPOS(9001,e2Date),books:await e2Books(),ids:e2MainIds}));
  assert(!removed.sales.some(sale=>sale.purchaseUid==='delete-main'));
  assert.equal(removed.sales.filter(sale=>sale.purchaseUid==='keep-unrelated').length,2);
  assert.equal(removed.sales.filter(sale=>sale.purchaseUid==='keep-other-event').length,1);
  assert.equal(removed.inv.finishedByProductId['e2-a'].stock,99);
  assert.equal(removed.inv.finishedByProductId['e2-b'].stock,99);
  assert.equal(removed.event.extras[0].stock,19);
  assert.deepEqual(removed.cash,cashBefore,'Modificó movimientos o saldo inicial independientes');
  assert.equal(removed.physical.NIO,120);
  assert(!removed.books.journalEntries.some(entry=>entry.origen==='POS'&&removed.ids.includes(entry.origenId)));
  assert(removed.books.journalEntries.some(entry=>entry.origen==='POS'));
  const entryIds=new Set(removed.books.journalEntries.map(entry=>entry.id));
  assert(removed.books.journalLines.every(line=>entryIds.has(line.entryId ?? line.idEntry)),'Dejó líneas contables huérfanas');
  // Direct execution, retry safety, grouped credit guards, closure guards and atomic rollback.
  const guards=await page.evaluate(async()=>{
    const check=(value,message)=>{if(!value)throw new Error(message);};
    const reject=async(promise,pattern)=>{try{await promise;}catch(error){check(pattern.test(error.message),'Error inesperado: '+error.message);return;}throw new Error('Aceptó una operación que debía rechazar');};
    const make=async(uid,options={})=>e2Create(uid,[{productId:'e2-a',qty:1,unitPrice:100},{extraId:1,qty:1,unitPrice:20}],options);
    const once=await make('delete-once'),draft=await e2Draft(once.records[1].id);
    const before=invCentralLoadPOS().finishedByProductId['e2-a'].stock;
    const result=await deletePurchaseAtomicPOS(draft);
    check(result.deletedCount===2&&!result.warnings.length,'No borró todas las líneas');
    const after=invCentralLoadPOS();check(after.finishedByProductId['e2-a'].stock===before+1,'No restauró stock');
    check((await deletePurchaseAtomicPOS(draft)).duplicate,'Reintento no idempotente');
    check(JSON.stringify(invCentralLoadPOS())===JSON.stringify(after),'Duplicó inventario al reintentar');
    await reject(deletePurchaseAtomicPOS({...draft,expectedLines:'[]'}),/otros datos/);
    const credit=await make('credit-with-payment',{payment:'credito'}),first=credit.records[0],second=credit.records[1];
    await put('sales',{...second,creditPaidAmount:5,creditPayments:[{id:'kept-payment',creditPaymentId:'kept-payment',amount:5,method:'transferencia',date:e2Date}]});
    let snapshot=await e2Snapshot();
    await reject(deletePurchaseAtomicPOS(await e2Draft(first.id)),/abonos|cobros/);
    check(await e2Snapshot()===snapshot,'Alteró compra con abonos en otra línea');
    const onlyCash=await make('credit-cash-only',{payment:'credito'});
    const cash=await getOne(CASH_V2_STORE,cashV2Key('9001',e2Date));
    const cashWithPayment={...cash,movements:[...cash.movements,{id:'cash-credit-linked',creditSaleId:onlyCash.records[1].id,creditPaymentId:'cash-only',movementType:'CREDIT_COLLECTION',amount:10,currency:'NIO',kind:'IN'}]};
    await put(CASH_V2_STORE,cashWithPayment);snapshot=await e2Snapshot();
    await reject(deletePurchaseAtomicPOS(await e2Draft(onlyCash.records[0].id)),/abonos|cobros/);
    check(await e2Snapshot()===snapshot,'Alteró cobro existente solamente en caja');
    const noPayments=await make('credit-no-payments',{payment:'credito'});
    await deletePurchaseAtomicPOS(await e2Draft(noPayments.records[0].id));
    check(!(await getAll('sales')).some(sale=>sale.purchaseUid==='credit-no-payments'),'No eliminó crédito sin cobros');
    const locked=await make('closed-guard'),lockedDraft=await e2Draft(locked.records[0].id),event=await getEventByIdPOS(9001);
    await put('events',{...event,closedAt:Date.now()});snapshot=await e2Snapshot();
    await reject(deletePurchaseAtomicPOS(lockedDraft),/Reabre el evento/);check(await e2Snapshot()===snapshot,'Alteró evento cerrado');
    await put('events',event);
    const lockKey=makeDayLockKeyPOS(9001,e2Date);await put('dayLocks',{key:lockKey,eventId:9001,dayKey:e2Date,isClosed:true});snapshot=await e2Snapshot();
    await reject(deletePurchaseAtomicPOS(lockedDraft),/Reabre el día/);check(await e2Snapshot()===snapshot,'Alteró día cerrado');
    await put('dayLocks',{key:lockKey,eventId:9001,dayKey:e2Date,isClosed:false});
    const openCash=await getOne(CASH_V2_STORE,cashV2Key('9001',e2Date));await put(CASH_V2_STORE,{...openCash,status:'CLOSED'});snapshot=await e2Snapshot();
    await reject(deletePurchaseAtomicPOS(lockedDraft),/Reabre la caja/);check(await e2Snapshot()===snapshot,'Alteró caja cerrada');
    await put(CASH_V2_STORE,openCash);
    const changed=await make('stale-delete'),stale=await e2Draft(changed.records[0].id);
    await put('sales',{...changed.records[1],notes:'Cambio concurrente'});snapshot=await e2Snapshot();
    await reject(deletePurchaseAtomicPOS(stale),/compra cambió/);check(await e2Snapshot()===snapshot,'Eliminó una compra modificada desde la confirmación');
    // Failure after sales.delete has been queued rolls back sales, event stock and the durable ticket together.
    const rollback=await make('rollback-delete'),rollbackDraft=await e2Draft(rollback.records[0].id);snapshot=await e2Snapshot();
    const originalDb=db;
    db={transaction(...args){const tx=originalDb.transaction(...args),get=tx.objectStore.bind(tx);tx.objectStore=name=>{const store=get(name);if(name==='meta'&&args[1]==='readwrite')store.put=()=>{throw new Error('Fallo simulado de transacción');};return store;};return tx;}};
    try{await reject(deletePurchaseAtomicPOS(rollbackDraft),/simulado/);}finally{db=originalDb;}
    check(await e2Snapshot()===snapshot,'Rollback incompleto tras fallo de escritura');
    // A payment inserted while deletion is being prepared must win over a stale deletion snapshot.
    const during=await make('payment-during-delete',{payment:'credito'}),duringDraft=await e2Draft(during.records[0].id);
    const invBefore=JSON.stringify(invCentralLoadPOS()),prepare=purchaseEditInventoryPOS;
    purchaseEditInventoryPOS=function(operation,inventory){
      const result=prepare(operation,inventory);
      if(operation.kind==='DELETE_PURCHASE'){
        const tx=db.transaction(CASH_V2_STORE,'readwrite');tx.objectStore(CASH_V2_STORE).put({...openCash,movements:[...openCash.movements,{id:'during-delete',creditSaleId:during.records[1].id,movementType:'CREDIT_COLLECTION',amount:1,currency:'NIO',kind:'IN'}]});
      }
      return result;
    };
    try{await reject(deletePurchaseAtomicPOS(duringDraft),/datos cambiaron/);}finally{purchaseEditInventoryPOS=prepare;}
    check((await getAll('sales')).filter(sale=>sale.purchaseUid==='payment-during-delete').length===2,'Eliminó compra con cobro concurrente');
    check(JSON.stringify(invCentralLoadPOS())===invBefore,'Cambió inventario con cobro concurrente');
    check((await getOne(CASH_V2_STORE,openCash.key)).movements.some(move=>move.id==='during-delete'),'Perdió cobro concurrente');
    const concurrent=await make('double-delete'),concurrentDraft=await e2Draft(concurrent.records[0].id);
    const stock=invCentralLoadPOS().finishedByProductId['e2-a'].stock;
    const results=await Promise.allSettled([deletePurchaseAtomicPOS(concurrentDraft),deletePurchaseAtomicPOS({...concurrentDraft,operationId:cashV2NewRequestId('ANOTHER-DELETE')})]);
    check(results.filter(result=>result.status==='fulfilled').length===1,'Aceptó dos eliminaciones concurrentes');
    check(invCentralLoadPOS().finishedByProductId['e2-a'].stock===stock+1,'Restauró dos veces por concurrencia');
    return true;
  });
  assert(guards);
  const inventory=await page.evaluate(async()=>{
    const check=(value,message)=>{if(!value)throw new Error(message);};
    const cup=await e2Create('cup-delete',[{productId:'e2-cup',qty:2,unitPrice:30},{productId:'e2-b',qty:1,unitPrice:50}]);
    check(invCentralLoadPOS().varios[0].stock===18,'Consumo inicial de Vasos');
    const lines=purchaseEditLinesPOS(await getAll('sales'),cup.records[0]);
    const edit={saleId:cup.records[0].id,operationId:cashV2NewRequestId('EDIT'),expectedLines:JSON.stringify(lines),payment:'efectivo',customerId:'e2-customer',customerName:'Cliente E2',notes:'Antes de eliminar',items:lines.map(sale=>({saleId:sale.id,key:'product:'+sale.productId,productId:sale.productId,qty:sale.productId==='e2-cup'?4:1,unitPrice:sale.unitPrice,discountPerUnit:0}))};
    await savePurchaseEditPOS(edit);check(invCentralLoadPOS().varios[0].stock===16,'Edición previa de Vasos');
    await deletePurchaseAtomicPOS(await e2Draft(cup.records[1].id));
    await processPendingCreditEditsPOS();await reconcilePendingPhysicalCupConsumptionsPOS();
    check(invCentralLoadPOS().varios[0].stock===20,'No restauró los Vasos vigentes exactamente una vez');
    await put('events',{id:9003,name:'Histórico',fractionBatches:[{batchId:'e2-batch',timestamp:e2Date,gallons:1,yieldCupsPerGallon:10,cupsCreated:10,cupsRemaining:7,mlPerCup:375}]});
    const legacy={eventId:9003,date:e2Date,uid:'e2-old',purchaseUid:'legacy-delete',purchaseLineCount:2,purchaseLineIndex:0,productId:null,productName:'Vaso histórico',qty:3,unitPrice:20,total:60,costPerUnit:4,vaso:true,fifoBreakdown:[{batchId:'e2-batch',cupsTaken:3,mlPerCup:375}],payment:'efectivo',customerId:'e2-customer',customerName:'Cliente E2'};
    legacy.id=await put('sales',legacy);
    await put('sales',{eventId:9003,date:e2Date,uid:'e2-old-other',purchaseUid:'legacy-delete',purchaseLineCount:2,purchaseLineIndex:1,productId:'historical-id',productName:'Producto retirado de Catálogos',qty:1,unitPrice:10,total:10,manageStock:false,payment:'efectivo'});
    const inv=invCentralLoadPOS();ensureCapsShapePOS(inv);inv.caps.vasos12oz={stock:97,min:0,effects:{[getVasos12ozSourceIdFromSalePOS(legacy)]:{qty:3,state:'APPLIED'}}};
    A33Storage.sharedSet(STORAGE_KEY_INVENTARIO,inv,{source:'test'});
    const legacyDraft=await e2Draft(legacy.id);await deletePurchaseAtomicPOS(legacyDraft);await deletePurchaseAtomicPOS(legacyDraft);
    check(invCentralLoadPOS().caps.vasos12oz.stock===100,'No revirtió consumible histórico una sola vez');
    check((await getEventByIdPOS(9003)).fractionBatches[0].cupsRemaining===10,'No restauró fraccionamiento histórico');
    check(!(await getAll('sales')).some(sale=>sale.purchaseUid==='legacy-delete'),'No eliminó línea histórica sin producto de catálogo');
    await put('events',{id:9010,name:'Lotes E2'});
    await put('inventory',{eventId:9010,productId:9004,type:'restock',qty:10,date:e2Date,unitCost:10,source:'lote',loteId:'e2-lot-id',loteCodigo:'E2-LOTE',loteCargaId:'e2-load'});
    A33Storage.sharedSet(LOTES_LS_KEY,[{id:'e2-lot-id',codigo:'E2-LOTE',assignedEventId:9010}],{source:'test'});
    const lot=await e2Create('lot-delete',[{productId:'e2-lot',qty:10,unitPrice:40}],{eventId:9010});
    check(invCentralLoadPOS().finishedByProductId['e2-lot'].stock===20,'Consumo inicial del lote');
    await deletePurchaseAtomicPOS(await e2Draft(lot.records[0].id));
    const available=await getAvailableLotsForProductPOS(9010,'e2-lot','Producto lote',await getAll('products'));
    check(available.reduce((sum,row)=>sum+row.remaining,0)===10,'No liberó disponibilidad de lotes');
    check(invCentralLoadPOS().finishedByProductId['e2-lot'].stock===30,'No restauró inventario central de lotes');
    const courtesyBefore=invCentralLoadPOS().finishedByProductId['e2-b'].stock;
    const courtesy=await e2Create('courtesy-delete',[{productId:'e2-b',qty:2,unitPrice:50,courtesy:true}]);
    await deletePurchaseAtomicPOS(await e2Draft(courtesy.records[0].id));
    check(invCentralLoadPOS().finishedByProductId['e2-b'].stock===courtesyBefore,'No revirtió cortesía');
    const returnBefore=invCentralLoadPOS().finishedByProductId['e2-a'].stock;
    const returned=await e2Create('return-delete',[{productId:'e2-a',qty:2,unitPrice:100}],{isReturn:true});
    check(invCentralLoadPOS().finishedByProductId['e2-a'].stock===returnBefore+2,'Devolución inicial');
    await deletePurchaseAtomicPOS(await e2Draft(returned.records[0].id));
    check(invCentralLoadPOS().finishedByProductId['e2-a'].stock===returnBefore,'Eliminar devolución agregó stock incorrecto');
    const cashBefore=await cashV2ComputeCashSalesPhysicalPOS(9001,e2Date);
    document.getElementById('sale-cash-mode').value='usd_change_nio';document.getElementById('sale-cash-usd-received').value='10';
    const usd=await e2Create('usd-delete',[{productId:'e2-a',qty:1,unitPrice:100},{productId:'e2-b',qty:1,unitPrice:50}],{usd:true});
    const cashUsd=await cashV2ComputeCashSalesPhysicalPOS(9001,e2Date);
    check(cashUsd.USD===cashBefore.USD+10&&cashUsd.NIO===cashBefore.NIO-218,'Cobro compartido USD inicial');
    await deletePurchaseAtomicPOS(await e2Draft(usd.records[1].id));
    const cashAfter=await cashV2ComputeCashSalesPhysicalPOS(9001,e2Date);
    check(cashAfter.USD===cashBefore.USD&&cashAfter.NIO===cashBefore.NIO,'Duplicó reverso de cobro USD');resetSaleCashTenderPOS();
    // Old per-sale journals still get removed if the individual-sale bridge was subsequently disabled.
    const oldJournal=await e2Create('journal-bridge-off',[{productId:'e2-b',qty:1,unitPrice:50}],{payment:'transferencia',bankId:9001});
    check((await e2Books()).journalEntries.some(entry=>entry.origenId===oldJournal.records[0].id),'Falta asiento inicial');
    localStorage.setItem('a33_finanzas_per_sale','0');
    await deletePurchaseAtomicPOS(await e2Draft(oldJournal.records[0].id));
    check(!(await e2Books()).journalEntries.some(entry=>entry.origenId===oldJournal.records[0].id),'Conservó asiento histórico con integración desactivada');
    localStorage.setItem('a33_finanzas_per_sale','1');
    // Durable recovery after an inventory failure, followed by a finance failure after stock is already restored.
    const recovering=await e2Create('recover-delete',[{productId:'e2-a',qty:2,unitPrice:100},{extraId:1,qty:2,unitPrice:20}]);
    const draft=await e2Draft(recovering.records[0].id),beforeRecovery=invCentralLoadPOS().finishedByProductId['e2-a'].stock,originalSet=A33Storage.sharedSet;
    A33Storage.sharedSet=function(key,value,options){if(options?.source==='pos/eliminacion-compra')return {ok:false,message:'Fallo simulado de inventario'};return originalSet.call(this,key,value,options);};
    let result;try{result=await deletePurchaseAtomicPOS(draft);}finally{A33Storage.sharedSet=originalSet;}
    check(result.warnings.length===1,'No informó reverso pendiente de inventario');
    check(!(await getAll('sales')).some(sale=>sale.purchaseUid==='recover-delete'),'No conservó eliminación recuperable');
    check(invCentralLoadPOS().finishedByProductId['e2-a'].stock===beforeRecovery,'Aplicó stock pese al fallo simulado');
    const booksBeforeFailure=JSON.stringify(await e2Books()),originalFinDb=finDb;
    let removedLines=0;
    finDb={transaction(...args){
      const tx=originalFinDb.transaction(...args),get=tx.objectStore.bind(tx);
      tx.objectStore=name=>{
        const store=get(name);
        if(name==='journalLines'&&args[1]==='readwrite'){
          const remove=store.delete.bind(store);
          store.delete=key=>{if(++removedLines===2)throw new Error('Fallo simulado de Finanzas');return remove(key);};
        }
        return store;
      };
      return tx;
    }};
    let blocked=false;try{await processPendingCreditEditsPOS();}catch(error){blocked=/Finanzas/.test(error.message);}finally{finDb=originalFinDb;}
    check(blocked,'No dejó Finanzas pendiente');
    check(JSON.stringify(await e2Books())===booksBeforeFailure,'Falló la atomicidad entre asiento y líneas contables');
    check(invCentralLoadPOS().finishedByProductId['e2-a'].stock===beforeRecovery+2,'No restauró inventario antes de Finanzas');
    await processPendingCreditEditsPOS();await processPendingCreditEditsPOS();
    check(invCentralLoadPOS().finishedByProductId['e2-a'].stock===beforeRecovery+2,'Recuperación financiera duplicó stock');
    check((await getOne('meta',PURCHASE_EDIT_QUEUE_PREFIX_POS+draft.operationId)).value.status==='DONE','No completó recuperación');
    check((await deletePurchaseAtomicPOS(draft)).duplicate,'Reintento después de recuperar no es idempotente');
    return true;
  });
  assert(inventory);
  // Undo uses the same full-purchase confirmation and cannot remove only one line.
  const undoIds=await page.evaluate(async()=>{
    const result=await e2Create('undo-full-purchase',[{productId:'e2-a',qty:1,unitPrice:100},{productId:'e2-b',qty:1,unitPrice:50}]);
    await refreshEventUI();await renderDay();return result.records.map(sale=>sale.id);
  });
  const deletionCount=await page.evaluate(()=>e2DeletionCount);
  await page.locator('#btn-undo').click();
  await page.waitForFunction(count=>e2DeletionCount>count,deletionCount);
  await page.evaluate(()=>e2DeletionPromise);
  assert.match(confirmations.at(-1),/compra completa/);
  assert.equal(await page.evaluate(async ids=>(await getAll('sales')).filter(sale=>ids.includes(sale.id)).length,undoIds),0);
  // The credit list must apply group-wide payment protection, not a row-only guard.
  const creditUi=await page.evaluate(async()=>{
    const saved=await e2Create('credit-ui-delete',[{productId:'e2-a',qty:1,unitPrice:100},{productId:'e2-b',qty:1,unitPrice:50}],{payment:'credito'});
    const result=await deleteCreditSalePOS(saved.records[1].id);return {count:result.deletedCount,remaining:(await getAll('sales')).some(sale=>sale.purchaseUid==='credit-ui-delete')};
  });
  assert.deepEqual(creditUi,{count:2,remaining:false});
  // Reload recovers the stored reversal even though the original sales are already gone.
  const recovery=await page.evaluate(async()=>{
    const saved=await e2Create('startup-delete',[{productId:'e2-a',qty:2,unitPrice:100}]);
    const draft=await e2Draft(saved.records[0].id),expected=invCentralLoadPOS().finishedByProductId['e2-a'].stock+2,original=A33Storage.sharedSet;
    A33Storage.sharedSet=function(key,value,options){if(options?.source==='pos/eliminacion-compra')return {ok:false,message:'Fallo para recarga'};return original.call(this,key,value,options);};
    try{const result=await deletePurchaseAtomicPOS(draft);if(result.warnings.length!==1)throw new Error('No creó recuperación al iniciar');}finally{A33Storage.sharedSet=original;}
    return {key:PURCHASE_EDIT_QUEUE_PREFIX_POS+draft.operationId,expected};
  });
  await page.reload();await page.waitForFunction(()=>document.getElementById('purchase-modal')?.dataset.bound==='1');
  await page.waitForFunction(async key=>(await getOne('meta',key))?.value.status==='DONE',recovery.key);
  assert.equal(await page.evaluate(()=>invCentralLoadPOS().finishedByProductId['e2-a'].stock),recovery.expected);
  assert.equal(await page.evaluate(async()=>(await getAll('sales')).some(sale=>sale.purchaseUid==='startup-delete')),false);
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.locator('#tbl-day .sale-actions').first().evaluate(el=>el.getBoundingClientRect().width<100),true);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS E2 eliminación completa: confirmación/cancelación, inventario, Extras, Vasos, consumibles históricos, lotes, cortesías, devolución, caja NIO/USD, Finanzas, crédito/abonos, cierres, concurrencia, rollback, reintentos, recarga y Deshacer.');
  await browser.close();
})().catch(async error=>{console.error(error);if(browser)await browser.close();process.exitCode=1;});
