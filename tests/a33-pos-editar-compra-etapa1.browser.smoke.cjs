'use strict';
// Origen interceptado y contexto temporal: no accede a los datos del usuario ni a servicios externos.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = path.resolve(__dirname,'..'), origin = 'http://a33-purchase-edit.test';
const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
let browser;
(async()=>{
  browser = await playwright.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context = await browser.newContext({serviceWorkers:'block',timezoneId:'America/Managua'});
  await context.route('**/*',async route=>{
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const pathname = decodeURIComponent(url.pathname), file = path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
    if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({status:404,body:''});
    await route.fulfill({body:fs.readFileSync(file),contentType:mime[path.extname(file)] || 'application/octet-stream'});
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(origin+'/pos/');
  await page.waitForFunction(()=>document.querySelector('#purchase-modal').dataset.bound === '1');
  await page.evaluate(async()=>{
    const date = cashV2DayKeyFromTsLocal(Date.now());
    const products = [
      {id:9101,productId:'edit-a',name:'Producto A',price:100,unitCost:20,pos:true,isActive:true,manageStock:true},
      {id:9102,productId:'edit-b',name:'Producto B',price:50,unitCost:10,pos:true,isActive:true,manageStock:true},
      {id:9103,productId:'edit-c',name:'Producto C',price:30,unitCost:5,pos:true,isActive:true,manageStock:true}
    ];
    for (const product of products) await put('products',product);
    await put('events',{id:9100,name:'Evento edición',saleSeq:2,extras:[{id:1,name:'Extra edición',stock:8,unitPrice:20,unitCost:5,active:true}]});
    for (const product of products) await put('inventory',{eventId:9100,productId:product.id,qty:10,type:'restock',date});
    await put('banks',{id:9101,name:'Transferencia prueba',type:'transferencia',isActive:true});
    await put('banks',{id:9102,name:'Tarjeta prueba',type:'tarjeta',commissionPct:7,isActive:true});
    A33Storage.sharedSet('a33_pos_customersCatalog',[{id:'edit-customer',name:'Cliente edición',isActive:true},{id:'edit-other',name:'Otro cliente',isActive:true}],{source:'test'});
    A33Storage.sharedSet('suite_a33_currency_settings_v1',{exchangeRate:'36.80'},{source:'test'});
    await setMeta('currentEventId',9100);
    document.getElementById('sale-date').value = date;
    setCustomerSelectionUI_POS({name:'Cliente edición',id:'edit-customer'});
    await refreshEventUI();
    const result = await savePurchasePOS({purchaseUid:'initial-edit-purchase',eventId:9100,date,
      customerId:'edit-customer',customerName:'Cliente edición',payment:'efectivo',notes:'Inicial',items:[
        {productId:'edit-a',qty:2,unitPrice:100,discountPerUnit:5},
        {extraId:1,qty:2,unitPrice:20,discountPerUnit:0}]});
    window.testOriginalIds = result.records.map(sale=>sale.id);
    window.testInitialInventory = invCentralLoadPOS();
    await renderDay();
  });
  const modal = page.locator('#purchase-modal');
  assert.equal(await page.locator('#tbl-day .edit-purchase').count(),2);
  assert.equal(await page.locator('#tbl-day .del-sale:disabled').count(),0);
  await page.locator('#tbl-day .edit-purchase').first().click();
  await modal.waitFor({state:'visible'});
  assert.equal(await page.locator('#purchase-items .purchase-item').count(),2);
  assert.match(await page.locator('#purchase-title').textContent(),/Editar compra completa/);
  // The reported case: cash -> transfer, preserving all products, inventory and identities.
  await page.locator('#sale-payment').selectOption('transferencia');
  await page.locator('#sale-bank option[value="9101"]').waitFor({state:'attached'});
  await page.locator('#sale-bank').selectOption('9101');
  await page.locator('#purchase-save').click();
  await modal.waitFor({state:'hidden'});
  let saved = await page.evaluate(async()=>({sales:await getAll('sales'),inv:invCentralLoadPOS(),original:testInitialInventory,
    cash:(await getAll('sales')).map(getSaleCashExpectedDeltaPOS),meta:(await getAll('meta')).filter(row=>row.id.startsWith(PURCHASE_EDIT_QUEUE_PREFIX_POS))}));
  assert.deepEqual(saved.sales.map(sale=>sale.id),await page.evaluate(()=>testOriginalIds));
  assert(saved.sales.every(sale=>sale.payment==='transferencia' && sale.bankId===9101));
  assert.deepEqual(saved.inv,saved.original);
  assert(saved.cash.every(delta=>delta.NIO===0 && delta.USD===0));
  assert(saved.meta.every(row=>row.value.status==='DONE'));
  // Edit quantities, discounts, prices, client, notes; replace a product and remove an Extra.
  await page.locator('#tbl-day .edit-purchase').first().click(); await modal.waitFor({state:'visible'});
  await page.locator('.purchase-edit-product').first().selectOption('product:edit-b');
  await page.locator('#purchase-qty-0').fill('3');
  await page.locator('#purchase-unitPrice-0').fill('60');
  await page.locator('#purchase-discountPerUnit-0').fill('2');
  await page.getByRole('button',{name:'Quitar Extra edición',exact:true}).click();
  await page.getByRole('button',{name:'Agregar Producto C',exact:true}).click();
  await page.locator('#purchase-more-options').evaluate(el=>el.open=true);
  await page.locator('#sale-notes').fill('Compra corregida');
  await page.locator('#btn-pick-customer').click();
  await page.locator('#customer-picker-search').fill('Otro cliente');
  await page.getByRole('button',{name:'Otro cliente',exact:true}).click();
  await page.locator('#purchase-save').click(); await modal.waitFor({state:'hidden'});
  saved = await page.evaluate(async()=>({sales:await getAll('sales'),event:await getEventByIdPOS(9100),inv:invCentralLoadPOS()}));
  assert.equal(saved.sales.length,2);
  assert(saved.sales.every(sale=>sale.customerId==='edit-other' && sale.notes==='Compra corregida' && sale.purchaseTotal===204));
  assert.equal(saved.sales.find(sale=>sale.productId==='edit-b').total,174);
  assert.equal(saved.event.extras[0].stock,8);
  assert.equal(saved.inv.finishedByProductId['edit-a'].stock,0);
  assert.equal(saved.inv.finishedByProductId['edit-b'].stock,-3);
  assert.equal(saved.inv.finishedByProductId['edit-c'].stock,-1);
  assert.equal(new Set(saved.sales.map(sale=>sale.seqId)).size,2);
  // Cancellation is read-only, and editor content never appears as a new purchase recovery draft.
  const beforeCancel = await page.evaluate(async()=>JSON.stringify({sales:await getAll('sales'),event:await getEventByIdPOS(9100),inv:invCentralLoadPOS()}));
  await page.locator('#tbl-day .edit-purchase').first().click(); await modal.waitFor({state:'visible'});
  await page.locator('#purchase-qty-0').fill('8');
  for (const width of [390,1280]){
    await page.setViewportSize({width,height:900});
    assert.equal(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await page.screenshot({path:'/tmp/a33-pos-editar-compra-'+width+'.png'});
    assert.equal(await page.locator('#tbl-day .sale-actions').first().evaluate(el=>el.getBoundingClientRect().width<100),true);
  }
  await page.locator('#purchase-cancel').click(); await modal.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(async()=>JSON.stringify({sales:await getAll('sales'),event:await getEventByIdPOS(9100),inv:invCentralLoadPOS()})),beforeCancel);
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith(PURCHASE_DRAFT_PREFIX_POS)).length),0);
  // Credit payments survive edits; total cannot fall below paid and payment cannot change.
  const credit = await page.evaluate(async()=>{
    const date = document.getElementById('sale-date').value;
    const result = await savePurchasePOS({purchaseUid:'credit-edit-purchase',eventId:9100,date,
      customerId:'edit-customer',customerName:'Cliente edición',payment:'credito',notes:'Crédito',items:[
        {productId:'edit-a',qty:2,unitPrice:100},{productId:'edit-b',qty:1,unitPrice:50}]});
    const first = result.records[0];
    await put('sales',{...first,creditPaidAmount:100,creditPayments:[{id:'test-payment',creditPaymentId:'test-payment',amount:100,method:'transferencia',date}]});
    await renderDay(); return first.id;
  });
  await page.locator(`#tbl-day .edit-purchase[data-id="${credit}"]`).click(); await modal.waitFor({state:'visible'});
  assert.equal(await page.locator('#sale-payment').isDisabled(),true);
  await page.locator('#purchase-qty-0').fill('1');
  await page.locator('#purchase-unitPrice-0').fill('10');
  await page.locator('#purchase-save').click();
  await page.waitForFunction(()=>document.getElementById('purchase-error').textContent.includes('ya cobrados'));
  assert.equal(await modal.isVisible(),true);
  await page.locator('#purchase-unitPrice-0').fill('80'); // 80 + 50 >= 100, first line itself below paid.
  await page.locator('#purchase-save').click(); await modal.waitFor({state:'hidden'});
  const creditState = await page.evaluate(async id=>{
    const all = await getAll('sales'), original = all.find(sale=>sale.id===id), lines = purchaseEditLinesPOS(all,original), cash = await getAll(CASH_V2_STORE);
    return {original,lines,credits:lines.map(sale=>cashV2CreditSaleSnapshot(sale,cash))};
  },credit);
  assert.equal(creditState.original.creditPayments[0].id,'test-payment');
  assert.equal(creditState.credits.reduce((sum,row)=>sum+row.original,0),130);
  assert.equal(creditState.credits.reduce((sum,row)=>sum+row.paid,0),100);
  assert.equal(creditState.credits.reduce((sum,row)=>sum+row.balance,0),30);
  const advanced = await page.evaluate(async()=>{
    const check = (value,message)=>{if(!value)throw new Error(message);};
    const date = document.getElementById('sale-date').value;
    const make = async(id,changes={})=>{
      const ctx = await readCreditEditContextPOS(id), lines = purchaseEditLinesPOS(ctx.data.sales,ctx.sale);
      return {saleId:id,operationId:cashV2NewRequestId('TEST'),expectedLines:JSON.stringify(lines),
        customerId:ctx.sale.customerId,customerName:ctx.sale.customerName,payment:ctx.sale.payment,bankId:ctx.sale.bankId,notes:ctx.sale.notes,
        items:lines.map((sale,index)=>({saleId:sale.id,key:sale.isExtra?'extra:'+sale.extraId:'product:'+sale.productId,
          productId:sale.productId,extraId:sale.extraId,isExtra:!!sale.isExtra,qty:Math.abs(sale.qty),unitPrice:sale.unitPrice,
          discountPerUnit:sale.discountPerUnit || 0,courtesy:!!sale.courtesy,...(index===0?changes:{})}))};
    };
    const inv = invCentralLoadPOS(); inv.varios = [{id:'edit-cup',producto:'Vaso físico prueba',stock:20}];
    A33Storage.sharedSet(STORAGE_KEY_INVENTARIO,inv,{source:'test'});
    await put('products',{id:9104,productId:'edit-cup-product',name:'Vaso edición',price:30,unitCost:8,pos:true,isActive:true,manageStock:false,receta:false,vasoFisicoId:'edit-cup'});
    const cupPurchase = await savePurchasePOS({purchaseUid:'cup-purchase',eventId:9100,date,customerId:'edit-customer',customerName:'Cliente edición',payment:'efectivo',items:[{productId:'edit-cup-product',qty:2,unitPrice:30}]});
    const cupId = cupPurchase.records[0].id;
    check(invCentralLoadPOS().varios[0].stock===18,'Consumo inicial del Vaso físico');
    const cupDraft = await make(cupId,{qty:4});
    await savePurchaseEditPOS(cupDraft);
    check(invCentralLoadPOS().varios[0].stock===16,'Edición del Vaso físico');
    check((await savePurchaseEditPOS(cupDraft)).duplicate,'Dedupe de edición');
    await reconcilePendingPhysicalCupConsumptionsPOS();
    check(invCentralLoadPOS().varios[0].stock===16,'Reconciliación duplicó Vasos físicos');
    await savePurchaseEditPOS(await make(cupId,{qty:3}));
    check(invCentralLoadPOS().varios[0].stock===17,'Segunda edición del Vaso físico');
    // Legacy sale without a catalog entry remains editable and keeps its consumption ledger.
    await put('events',{id:9104,name:'Históricos',fractionBatches:[{batchId:'edit-batch',timestamp:date,gallons:1,yieldCupsPerGallon:10,cupsCreated:10,cupsRemaining:7,mlPerCup:375}]});
    const legacy = {id:9900,eventId:9104,eventName:'Históricos',date,uid:'legacy-edit',productId:null,productName:'Vaso histórico',
      qty:3,unitPrice:20,total:60,costPerUnit:4,vaso:true,fifoBreakdown:[{batchId:'edit-batch',cupsTaken:3,mlPerCup:375}],payment:'efectivo',customerId:'edit-customer',customerName:'Cliente edición'};
    await put('sales',legacy);
    const capInv = invCentralLoadPOS(); ensureCapsShapePOS(capInv);
    capInv.caps.vasos12oz = {stock:97,min:0,effects:{[getVasos12ozSourceIdFromSalePOS(legacy)]:{qty:3,state:'APPLIED'}}};
    A33Storage.sharedSet(STORAGE_KEY_INVENTARIO,capInv,{source:'test'});
    await savePurchaseEditPOS(await make(9900,{qty:5}));
    check(invCentralLoadPOS().caps.vasos12oz.stock===95,'Consumible histórico');
    check((await getEventByIdPOS(9104)).fractionBatches[0].cupsRemaining===5,'Fraccionamiento histórico');
    await savePurchaseEditPOS(await make(9900,{unitPrice:22}));
    check(invCentralLoadPOS().caps.vasos12oz.stock===95,'Edición de precio duplicó consumible');
    await savePurchaseEditPOS(await make(9900,{qty:4}));
    check(invCentralLoadPOS().caps.vasos12oz.stock===96,'Segunda edición de consumible');
    // A complete lot can be edited using its original allocation as available stock.
    await put('events',{id:9105,name:'Lotes edición'});
    await put('products',{id:9105,productId:'edit-lot',name:'Producto lote',price:40,unitCost:10,pos:true,isActive:true,manageStock:true,receta:true});
    await put('inventory',{eventId:9105,productId:9105,type:'restock',qty:10,date,unitCost:10,source:'lote',loteId:'edit-lot-id',loteCodigo:'EDIT-LOTE',loteCargaId:'edit-load'});
    A33Storage.sharedSet(LOTES_LS_KEY,[{id:'edit-lot-id',codigo:'EDIT-LOTE',assignedEventId:9105}],{source:'test'});
    await setMeta('currentEventId',9105);
    const lotPurchase = await savePurchasePOS({purchaseUid:'lot-purchase',eventId:9105,date,customerId:'edit-customer',customerName:'Cliente edición',payment:'efectivo',items:[{productId:'edit-lot',qty:10,unitPrice:40}]});
    const lotId = lotPurchase.records[0].id;
    const lot = await savePurchaseEditPOS(await make(lotId,{qty:8}));
    check(lot.records[0].loteAllocations.reduce((sum,row)=>sum+row.qty,0)===8,'Lotes no excluyeron la compra original');
    check(lot.records[0].costTotal===80,'Costo de lotes');
    // Crash-safe stock recovery, followed by a second run with no duplicate effect.
    const stockBefore = invCentralLoadPOS().finishedByProductId['edit-lot'].stock;
    const originalSet = A33Storage.sharedSet;
    A33Storage.sharedSet = function(key,value,options){
      if(options?.source==='pos/edicion-compra')return {ok:false,message:'Fallo simulado de inventario'};
      return originalSet.call(this,key,value,options);
    };
    let pending;
    try{pending = await savePurchaseEditPOS(await make(lotId,{qty:9}));}finally{A33Storage.sharedSet=originalSet;}
    check(pending.warnings.length===1,'No se informó la recuperación pendiente');
    check((await getOne('sales',lotId)).qty===9,'No conservó la edición recuperable');
    check(invCentralLoadPOS().finishedByProductId['edit-lot'].stock===stockBefore,'Inventario cambió pese al fallo simulado');
    await processPendingCreditEditsPOS(); await processPendingCreditEditsPOS();
    check(invCentralLoadPOS().finishedByProductId['edit-lot'].stock===stockBefore-1,'Recuperación duplicó inventario');
    const rollback = await make(lotId,{qty:10}), beforeRollback = JSON.stringify({sales:await getAll('sales'),events:await getAll('events'),inv:invCentralLoadPOS()});
    const originalDb = db;
    db = {transaction(...args){
      const tx = originalDb.transaction(...args), objectStore = tx.objectStore.bind(tx);
      tx.objectStore = name=>{const store=objectStore(name);if(name==='meta' && args[1]==='readwrite')store.put=()=>{throw new Error('Fallo simulado de transacción');};return store;};
      return tx;
    }};
    let rejected = false;
    try{await savePurchaseEditPOS(rollback);}catch(error){rejected=/simulado/.test(error.message);}finally{db=originalDb;}
    check(rejected,'No rechazó transacción fallida');
    check(JSON.stringify({sales:await getAll('sales'),events:await getAll('events'),inv:invCentralLoadPOS()})===beforeRollback,'Rollback incompleto');
    // Replacing a bank payment recomputes card commission for every line.
    const card = await make(lotId); card.payment='tarjeta'; card.bankId=9102;
    const cardResult = await savePurchaseEditPOS(card);
    check(cardResult.records[0].commissionAmountSnapshot===25.2,'Comisión de tarjeta incorrecta');
    const transfer = await make(lotId); transfer.payment='transferencia'; transfer.bankId=9101;
    const transferResult = await savePurchaseEditPOS(transfer);
    check(transferResult.records[0].commissionAmountSnapshot==null,'Conservó comisión de tarjeta al pasar a transferencia');
    // Return edits retain their sign and restore only the changed quantity.
    await setMeta('currentEventId',9100);
    const returned = await savePurchasePOS({purchaseUid:'return-edit',eventId:9100,date,customerId:'edit-customer',customerName:'Cliente edición',payment:'efectivo',isReturn:true,items:[{productId:'edit-a',qty:1,unitPrice:100}]});
    const returnEdit = await savePurchaseEditPOS(await make(returned.records[0].id,{qty:2}));
    check(returnEdit.records[0].qty===-2 && returnEdit.records[0].total===-200,'Edición perdió signo de devolución');
    // A newly added line must never inherit legacy paid fields or the edit history of its neighbor.
    const creditLine = (await getAll('sales')).find(sale=>sale.purchaseUid==='credit-edit-purchase');
    await put('sales',{...creditLine,montoCreditoPagado:100,paidAmount:100,creditEditHistory:[{id:'historical-edit'}]});
    const creditAddition = await make(creditLine.id);
    creditAddition.items.push({key:'product:edit-c',productId:'edit-c',qty:1,unitPrice:30,discountPerUnit:0});
    const addedCredit = await savePurchaseEditPOS(creditAddition);
    const newCreditLine = addedCredit.records.find(sale=>sale.productId==='edit-c');
    check(cashV2CreditSaleSnapshot(newCreditLine,[]).paid===0,'Nuevo producto heredó abonos históricos');
    check(!newCreditLine.creditEditHistory,'Nuevo producto heredó historial ajeno');
    check(addedCredit.records.map(sale=>cashV2CreditSaleSnapshot(sale,[])).reduce((sum,row)=>sum+row.balance,0)===60,'Saldo de compra tras agregar producto');
    return {cup:true,legacy:true,lots:true,recovery:true,rollback:true,card:true,returns:true};
  });
  assert(Object.values(advanced).every(Boolean));
  await page.evaluate(async()=>{
    const check = (value,message)=>{if(!value)throw new Error(message);};
    const date = document.getElementById('sale-date').value;
    await ensureFinanzasDB();
    await new Promise((resolve,reject)=>{
      const tx = finDb.transaction('accounts','readwrite');
      for (const account of [
        {code:'1121',nombre:'Caja eventos prueba',tipo:'activo'},
        {code:'1211',nombre:'Banco prueba',tipo:'activo'},
        {code:'1311',nombre:'Clientes prueba',tipo:'activo'},
        {code:'1501',nombre:'Inventario productos prueba',tipo:'activo'},
        {code:'4211',nombre:'Ventas POS prueba',tipo:'ingreso'},
        {code:'5101',nombre:'Costo ventas prueba',tipo:'costo'},
        {code:'6113',nombre:'Cortesías prueba',tipo:'gasto'}
      ])tx.objectStore('accounts').put({...account,currency:'NIO',isActive:true,isPostable:true});
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};
    });
    localStorage.setItem('a33_finanzas_per_sale','1');
    const purchase = await savePurchasePOS({purchaseUid:'finance-edit',eventId:9100,date,customerId:'edit-customer',customerName:'Cliente edición',payment:'efectivo',items:[{productId:'edit-a',qty:1,unitPrice:100},{productId:'edit-b',qty:1,unitPrice:50}]});
    const [first,second] = purchase.records;
    const lines = (await getAll('sales')).filter(sale=>sale.purchaseUid==='finance-edit');
    const draft = {saleId:first.id,operationId:cashV2NewRequestId('FIN'),expectedLines:JSON.stringify(lines),payment:'transferencia',bankId:9101,customerId:'edit-customer',customerName:'Cliente edición',notes:'Corrección contable',
      items:[{saleId:first.id,key:'product:edit-a',productId:'edit-a',qty:2,unitPrice:100,discountPerUnit:0}]};
    const result = await savePurchaseEditPOS(draft);
    check(!result.warnings.length,'Finanzas quedó pendiente: '+JSON.stringify(result.warnings));
    const books = await new Promise((resolve,reject)=>{
      const tx=finDb.transaction(['journalEntries','journalLines'],'readonly'),data={};
      for(const name of ['journalEntries','journalLines']){const req=tx.objectStore(name).getAll();req.onsuccess=()=>data[name]=req.result;}
      tx.oncomplete=()=>resolve(data);tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};
    });
    const entry=books.journalEntries.find(row=>row.origen==='POS' && row.origenId===first.id);
    check(entry,'Perdió el asiento al editar');
    check(!books.journalEntries.some(row=>row.origen==='POS' && row.origenId===second.id),'Conservó asiento del producto retirado');
    const entryLines=books.journalLines.filter(row=>row.entryId===entry.id || row.idEntry===entry.id);
    check(entryLines.some(row=>row.accountCode==='1211' && row.debe===200),'No movió el cobro de Caja a Banco');
    check(!entryLines.some(row=>row.accountCode==='1121'),'Conservó el cobro en efectivo');
    check(entryLines.reduce((sum,row)=>sum+row.debe-row.haber,0)===0,'Asiento descuadrado');
    localStorage.setItem('a33_finanzas_per_sale','0');
  });
  // An existing USD receipt keeps its historical exchange rate when central settings change.
  await page.evaluate(async()=>{
    await setMeta('currentEventId',9100);
    const date=document.getElementById('sale-date').value;
    document.getElementById('sale-cash-mode').value='usd_change_nio';
    document.getElementById('sale-cash-usd-received').value='10';
    const purchase=await savePurchasePOS({purchaseUid:'usd-edit',eventId:9100,date,customerId:'edit-customer',customerName:'Cliente edición',payment:'efectivo',items:[{productId:'edit-a',qty:1,unitPrice:100},{productId:'edit-b',qty:1,unitPrice:50}]});
    window.testUsdId=purchase.records[0].id;
    A33Storage.sharedSet('suite_a33_currency_settings_v1',{exchangeRate:'40.00'},{source:'test'});
    resetSaleCashTenderPOS();await renderDay();
  });
  const usdId = await page.evaluate(()=>testUsdId);
  await page.locator(`#tbl-day .edit-purchase[data-id="${usdId}"]`).click();await modal.waitFor({state:'visible'});
  assert.equal(await page.locator('#sale-cash-fx-used').inputValue(),'36.80');
  assert.equal(await page.locator('#sale-cash-usd-fields').isVisible(),true);
  await page.locator('#purchase-save').click();await modal.waitFor({state:'hidden'});
  const usd = await page.evaluate(async()=>{
    const lines=(await getAll('sales')).filter(sale=>sale.purchaseUid==='usd-edit');
    return {fx:lines.find(sale=>sale.purchaseTenderOwner).fxUsed,usd:lines.reduce((sum,sale)=>sum+getSaleCashExpectedDeltaPOS(sale).USD,0),nio:lines.reduce((sum,sale)=>sum+getSaleCashExpectedDeltaPOS(sale).NIO,0)};
  });
  assert.deepEqual(usd,{fx:36.8,usd:10,nio:-218});
  // Optimistic concurrency and closed day/event reject without partial stock writes.
  const guardResults = await page.evaluate(async id=>{
    const make = async()=>{
      const ctx = await readCreditEditContextPOS(id), lines = purchaseEditLinesPOS(ctx.data.sales,ctx.sale);
      return {saleId:id,operationId:cashV2NewRequestId('TEST'),expectedLines:JSON.stringify(lines),
        customerId:ctx.sale.customerId,customerName:ctx.sale.customerName,payment:'credito',notes:ctx.sale.notes,
        items:lines.map(sale=>({saleId:sale.id,key:'product:'+sale.productId,productId:sale.productId,qty:Math.abs(sale.qty),unitPrice:sale.unitPrice,discountPerUnit:sale.discountPerUnit}))};
    };
    const errors = [], stale = await make();
    const current = await getOne('sales',id); await put('sales',{...current,notes:'Concurrente'});
    try { await savePurchaseEditPOS(stale); } catch(error) { errors.push(error.message); }
    const event = await getEventByIdPOS(9100); await put('events',{...event,closedAt:Date.now()});
    try { await savePurchaseEditPOS(await make()); } catch(error) { errors.push(error.message); }
    await put('events',event);
    await put('dayLocks',{key:makeDayLockKeyPOS(9100,current.date),eventId:9100,dayKey:current.date,isClosed:true});
    try { await savePurchaseEditPOS(await make()); } catch(error) { errors.push(error.message); }
    return errors;
  },credit);
  assert.equal(guardResults.length,3); assert.match(guardResults[0],/compra cambió/); assert.match(guardResults[1],/Reabre el evento/); assert.match(guardResults[2],/Reabre el día/);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'/tmp/a33-pos-editar-compra-etapa1.png',fullPage:true});
  console.log('PASS edición de compra: pago, productos, cliente, descuentos, inventario, vasos, consumibles, lotes, abonos históricos, Finanzas, USD, devoluciones, rollback, recuperación, cierres y móvil.');
  await browser.close();
})().catch(async error=>{console.error(error);if(browser)await browser.close();process.exitCode=1;});
