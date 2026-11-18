'use strict';
// Perfil y origen temporales. Todas las ediciones usan datos de prueba.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = path.resolve(__dirname,'..');
const origin = 'http://a33-credit-e2b.test';
const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
let browser;

(async()=>{
  browser = await playwright.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context = await browser.newContext({serviceWorkers:'block',timezoneId:'America/Managua'});
  await context.route('**/*',async route=>{
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const pathname = decodeURIComponent(url.pathname);
    const file = path.resolve(root,'.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({status:404,body:''});
    await route.fulfill({body:fs.readFileSync(file),contentType:mime[path.extname(file)] || 'application/octet-stream'});
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin + '/pos/');
  await page.waitForFunction(()=>document.querySelector('#credit-collection-dialog').dataset.bound === '1');
  await page.evaluate(async()=>{
    const today = cashV2DayKeyFromTsLocal(Date.now());
    const products = [
      {id:901,productId:'test-a',name:'Producto A',price:100,unitCost:20,pos:true,isActive:true,manageStock:true,receta:false},
      {id:902,productId:'test-b',name:'Producto B',price:50,unitCost:10,pos:true,isActive:true,manageStock:true,receta:false},
      {id:903,productId:'test-cup',name:'Vaso moderno',price:30,unitCost:8,pos:true,isActive:true,manageStock:false,vasoFisicoId:'vf-test',receta:false},
      {id:904,productId:'test-lot',name:'Producto con lote',price:40,unitCost:10,pos:true,isActive:true,manageStock:true,receta:true}
    ];
    for (const product of products) await put('products',product);
    for (const event of [
      {id:701,name:'Evento Prueba',groupName:'Prueba',cashV2Active:false,extras:[{id:1,name:'Extra Prueba',stock:8,unitCost:5,unitPrice:20,active:true}]},
      {id:702,name:'Cerrado',groupName:'Prueba',cashV2Active:false,closedAt:today},
      {id:703,name:'Vasos históricos',groupName:'Prueba',cashV2Active:false,fractionBatches:[{batchId:'batch-test',timestamp:today,gallons:1,yieldCupsPerGallon:10,cupsCreated:10,cupsRemaining:7,mlPerCup:375}]},
      {id:704,name:'Día cerrado',groupName:'Prueba',cashV2Active:false},
      {id:705,name:'Evento Lotes',groupName:'Prueba',cashV2Active:false},
      {id:706,name:'Evento para eliminar',groupName:'Prueba',cashV2Active:false}
    ]) await put('events',event);
    for (const product of products){
      await put('inventory',{id:product.id,eventId:701,productId:product.id,type:'restock',qty:100,date:today,unitCost:product.unitCost});
    }
    await put('inventory',{id:950,eventId:705,productId:904,type:'restock',qty:10,date:today,unitCost:10,source:'lote',loteId:'lot-test',loteCodigo:'LOTE-PRUEBA',loteCargaId:'load-test'});
    await put('dayLocks',{key:makeDayLockKeyPOS(704,today),eventId:704,dayKey:today,isClosed:true});
    const base = {eventId:701,date:today,payment:'credito',customerId:'customer-a',customerName:'Cliente A',customer:'Cliente A',notes:'Nota inicial',courtesy:false,isReturn:false};
    function normal(id,product,qty,price,extra={}){
      const economic = buildSaleEconomicSnapshotPOS({unitPrice:price,qty,discount:0,total:qty*price,unitCost:product.unitCost,costSource:'producto_catalogo',courtesy:false,isReturn:false});
      return {...base,...buildSaleProductSnapshotPOS(product,price),...economic,id,uid:'sale-' + id,seqId:id,qty,unitPrice:price,total:qty*price,discount:0,discountPerUnit:0,...extra};
    }
    const sales = [
      normal(801,products[0],2,100,{purchaseUid:'purchase-test',purchaseLineIndex:0,purchaseLineCount:2,purchaseTotal:300,creditPaidAmount:50,creditPayments:[{id:'payment-before',creditPaymentId:'payment-before',amount:50,method:'transferencia',date:today,source:'POS_VENTAS_CREDITO'}]}),
      normal(802,products[0],1,100,{purchaseUid:'purchase-test',purchaseLineIndex:1,purchaseLineCount:2,purchaseTotal:300}),
      normal(803,products[1],1,50,{creditPaidAmount:50}),
      normal(804,products[2],2,30),
      {...base,id:805,uid:'sale-805',isExtra:true,extraId:1,productId:null,productName:'Extra Prueba',productNameSnapshot:'Extra Prueba',qty:2,unitPrice:20,total:40,costPerUnit:5,discount:0},
      {...base,id:806,uid:'sale-806',eventId:703,productId:null,productName:'Vaso histórico',qty:3,unitPrice:20,total:60,costPerUnit:4,vaso:true,fifoBreakdown:[{batchId:'batch-test',cupsTaken:3,mlPerCup:375}],discount:0},
      normal(807,products[0],1,100),normal(808,products[0],1,100,{eventId:702}),
      normal(809,products[0],1,100,{eventId:704}),normal(810,products[0],1,100,{voided:true}),
      {...base,id:811,uid:'old-sale',productId:'removed-product',productName:'Producto histórico',qty:1,unitPrice:10,total:10,costPerUnit:2,manageStock:false},
      normal(812,products[0],1,100,{creditOriginalAmount:150,creditPaidAmount:120}),
      normal(813,products[0],1,100),normal(814,products[0],1,100),normal(815,products[0],1,100),
      normal(818,products[3],10,40,{eventId:705,loteId:'lot-test',loteCodigo:'LOTE-PRUEBA',loteCargaId:'load-test',loteAllocations:[{loteId:'lot-test',loteCodigo:'LOTE-PRUEBA',loteCargaId:'load-test',qty:10}]}),
      normal(819,products[0],2,100,{discountPerUnit:null,discount:20,total:180,notes:'  ' + 'Nota histórica extensa '.repeat(150) + '  '}),
      normal(820,products[0],1,100),normal(821,products[1],1,50,{eventId:706})
    ];
    for (const sale of sales) await put('sales',sale);
    A33Storage.sharedSet('a33_pos_customersCatalog',[
      {id:'customer-a',name:'Cliente A',isActive:true,createdAt:1},
      {id:'customer-b',name:'Cliente B',isActive:true,createdAt:1}
    ],{source:'test'});
    const legacySource = getVasos12ozSourceIdFromSalePOS(sales.find(sale=>sale.id === 806));
    A33Storage.sharedSet(STORAGE_KEY_INVENTARIO,{
      liquids:{},bottles:{},finished:{},finishedByProductId:{'test-a':{stock:80},'test-b':{stock:90},'test-lot':{stock:90}},
      varios:[{id:'vf-test',producto:'Vaso físico prueba',stock:20}],movimientos:[],
      caps:{vasos12oz:{stock:97,min:0,effects:{[legacySource]:{qty:3,state:'APPLIED',appliedAt:1}}}}
    },{source:'test'});
    A33Storage.sharedSet(LOTES_LS_KEY,[{id:'lot-test',codigo:'LOTE-PRUEBA',assignedEventId:705}],{source:'test'});
    await ensurePhysicalCupConsumptionForSalePOS(await getOne('sales',804));
    await refreshEventUI(); await renderCreditSalesPOS();
    const originalSave = saveCreditSaleEditPOS;
    saveCreditSaleEditPOS = draft=>{ window.__lastCreditEdit = originalSave(draft); return window.__lastCreditEdit; };
  });
  await page.locator('#credit-sales-panel summary').click();
  await page.locator('[data-credit-action="edit"][data-sale-id="801"]').click();
  await page.locator('#credit-edit-fields:not(:disabled)').waitFor();
  await page.selectOption('#credit-edit-customer','customer-b');
  await page.fill('#credit-edit-qty','3');
  await page.fill('#credit-edit-price','110');
  await page.fill('#credit-edit-notes','Nota corregida');
  await page.locator('#credit-edit-form button[type="submit"]').click();
  await page.evaluate(()=>window.__lastCreditEdit);
  await page.waitForFunction(()=>!document.querySelector('#credit-edit-dialog').open);
  const first = await page.evaluate(async()=>({sale:await getOne('sales',801),sibling:await getOne('sales',802),inventory:invCentralLoadPOS()}));
  assert.equal(first.sale.total,330); assert.equal(first.sale.creditBalance,280); assert.equal(first.sale.creditPaidAmount,50);
  assert.equal(first.sale.creditPayments.length,1); assert.equal(first.sale.creditPayments[0].id,'payment-before');
  assert.equal(first.sale.customerId,'customer-b'); assert.equal(first.sale.notes,'Nota corregida');
  assert.equal(first.sale.uid,'sale-801'); assert.equal(first.sale.seqId,801);
  assert.equal(first.sale.purchaseTotal,430); assert.equal(first.sibling.purchaseTotal,430);
  assert.equal(first.sibling.customerId,'customer-a'); assert.equal(first.sibling.qty,1); assert.equal(first.sibling.notes,'Nota inicial');
  assert.equal(first.inventory.finishedByProductId['test-a'].stock,79);
  assert.equal(first.sale.creditEditHistory.length,1);

  const results = await page.evaluate(async()=>{
    function check(value,message){ if (!value) throw new Error(message); }
    async function draft(id,extra={}){
      const sale = await getOne('sales',id);
      return {saleId:id,expectedSale:JSON.stringify(sale),operationId:cashV2NewRequestId('TEST-EDIT'),itemKey:'original',qty:sale.qty,unitPrice:sale.unitPrice,customerId:'original',notes:sale.notes || '',...extra};
    }
    async function reject(promise,pattern){
      let caught;
      try { await promise; } catch(error){ caught = error; }
      if (!caught || !pattern.test(caught.message)) throw new Error('Se esperaba rechazo ' + pattern + ': ' + (caught?.message || 'sin error'));
    }
    const beforePayments = JSON.stringify((await getOne('sales',801)).creditPayments);
    const switchDraft = await draft(801,{itemKey:'product:test-b',qty:2,unitPrice:50});
    const switched = await saveCreditSaleEditPOS(switchDraft);
    check(switched.sale.productId === 'test-b' && switched.sale.creditBalance === 50,'Cambio de producto/saldo incorrecto');
    check(JSON.stringify(switched.sale.creditPayments) === beforePayments,'Cambió el historial de pagos');
    check(invCentralLoadPOS().finishedByProductId['test-a'].stock === 82,'No restauró el producto anterior');
    check(invCentralLoadPOS().finishedByProductId['test-b'].stock === 88,'No consumió el producto nuevo');
    check((await saveCreditSaleEditPOS(switchDraft)).duplicate,'Reintento no idempotente');
    check(invCentralLoadPOS().finishedByProductId['test-b'].stock === 88,'Reintento duplicó inventario');
    await reject(saveCreditSaleEditPOS({...switchDraft,qty:3}),/otros datos/);
    await reject(saveCreditSaleEditPOS(await draft(801,{unitPrice:10})),/ya cobrados/);
    await reject(saveCreditSaleEditPOS(await draft(801,{qty:0})),/cantidad/);
    await reject(saveCreditSaleEditPOS(await draft(801,{unitPrice:-1})),/precio/);
    await reject(saveCreditSaleEditPOS(await draft(801,{customerId:'unknown'})),/cliente/);
    await reject(saveCreditSaleEditPOS(await draft(808,{qty:2})),/Reabre el evento/);
    await reject(saveCreditSaleEditPOS(await draft(809,{qty:2})),/Reabre el día/);
    await reject(saveCreditSaleEditPOS(await draft(810,{qty:2})),/admite/);
    const paid = await saveCreditSaleEditPOS(await draft(803,{unitPrice:60}));
    check(paid.sale.creditStatus === 'ABONADA' && paid.sale.creditBalance === 10,'No reabrió el saldo al aumentar una venta pagada');
    await saveCreditSaleEditPOS(await draft(804,{qty:4}));
    check(invCentralLoadPOS().varios[0].stock === 16,'Corrección de Vaso físico incorrecta');
    await saveCreditSaleEditPOS(await draft(804,{qty:3}));
    check(invCentralLoadPOS().varios[0].stock === 17,'Segunda corrección de Vaso físico incorrecta');
    await processPendingCreditEditsPOS(804); await reconcilePendingPhysicalCupConsumptionsPOS();
    check(invCentralLoadPOS().varios[0].stock === 17,'Reconciliación duplicó Vaso físico');
    await reject(saveCreditSaleEditPOS(await draft(804,{qty:1.5})),/entero/);
    await saveCreditSaleEditPOS(await draft(805,{qty:4}));
    check((await getOne('events',701)).extras[0].stock === 6,'No corrigió stock del Extra');
    await saveCreditSaleEditPOS(await draft(805,{itemKey:'product:test-b',qty:1,unitPrice:50}));
    check((await getOne('events',701)).extras[0].stock === 10,'No restauró el Extra al cambiar de producto');
    check((await getOne('sales',805)).economicSnapshot.kind === 'product','Snapshot económico conserva la clase anterior');
    await saveCreditSaleEditPOS(await draft(805,{itemKey:'extra:1',qty:2,unitPrice:20}));
    check((await getOne('events',701)).extras[0].stock === 8,'No consumió el Extra al cambiar de producto');
    check((await getOne('sales',805)).economicSnapshot.kind === 'extra','Snapshot económico no identifica el Extra');
    await saveCreditSaleEditPOS(await draft(806,{qty:5}));
    check((await getOne('events',703)).fractionBatches[0].cupsRemaining === 5,'Fraccionamiento histórico incorrecto');
    check(invCentralLoadPOS().caps.vasos12oz.stock === 95,'Consumible histórico incorrecto');
    await saveCreditSaleEditPOS(await draft(806,{qty:4}));
    check(invCentralLoadPOS().caps.vasos12oz.stock === 96,'Segunda corrección del consumible incorrecta');
    const unordered = {fractionBatches:[
      {batchId:'recent',timestamp:'2026-11-18',cupsCreated:10,cupsRemaining:5},
      {batchId:'oldest',timestamp:'2026-11-01',cupsCreated:10,cupsRemaining:5}
    ]};
    editLegacyCupBatchesPOS(unordered,{vaso:true,qty:2},{vaso:true,qty:1},'legacy-without-breakdown');
    check(unordered.fractionBatches.find(batch=>batch.batchId === 'oldest').cupsRemaining === 6,'No conservó FIFO histórico sin desglose');
    await saveCreditSaleEditPOS(await draft(811,{notes:'Histórico conservado'}));
    check((await getOne('sales',811)).productId === 'removed-product','Cambió identidad histórica');
    await saveCreditSaleEditPOS(await draft(812,{notes:'Solo notas'}));
    check((await getOne('sales',812)).creditOriginalAmount === 150 && (await getOne('sales',812)).creditBalance === 30,'La edición de notas cambió el principal histórico');
    const stale = await draft(807,{qty:2});
    await registerCreditPaymentPOS({saleId:807,amount:10,date:cashV2DayKeyFromTsLocal(Date.now()),method:'transferencia',account:'',reference:'',requestId:'payment-during-edit'});
    await reject(saveCreditSaleEditPOS(stale),/venta cambió/);
    check((await getOne('sales',807)).creditPaidAmount === 10,'Se perdió un pago concurrente');
    const concurrentBase = await draft(815);
    const concurrent = await Promise.allSettled([
      saveCreditSaleEditPOS({...concurrentBase,operationId:'concurrent-edit-1',qty:2}),
      saveCreditSaleEditPOS({...concurrentBase,operationId:'concurrent-edit-2',qty:3})
    ]);
    check(concurrent.filter(result=>result.status === 'fulfilled').length === 1,'Dos ediciones concurrentes sobrescribieron datos');
    // Un error al guardar meta revierte venta, evento y total de compra.
    const rollback = await draft(813,{qty:2});
    const originalDb = db;
    db = {transaction(...args){
      const tr = originalDb.transaction(...args);
      const store = tr.objectStore.bind(tr);
      tr.objectStore = name=>{
        const result = store(name);
        if (name === 'meta' && args[1] === 'readwrite') result.put = ()=>{throw new Error('Fallo simulado de transacción');};
        return result;
      };
      return tr;
    }};
    try { await reject(saveCreditSaleEditPOS(rollback),/simulado/); }
    finally { db = originalDb; }
    check((await getOne('sales',813)).qty === 1,'La transacción fallida modificó la venta');
    // La corrección guardada se recupera una sola vez si falla Inventario Central.
    const originalSet = A33Storage.sharedSet;
    const stockBeforeRecovery = invCentralLoadPOS().finishedByProductId['test-a'].stock;
    A33Storage.sharedSet = function(key,value,options){
      if (options?.source === 'pos/edicion-credito') return {ok:false,message:'Fallo simulado de inventario'};
      return originalSet.call(this,key,value,options);
    };
    let pending;
    try { pending = await saveCreditSaleEditPOS(await draft(814,{qty:2})); }
    finally { A33Storage.sharedSet = originalSet; }
    check(pending.warnings.length === 1 && (await getOne('sales',814)).qty === 2,'No conservó la edición recuperable');
    check(invCentralLoadPOS().finishedByProductId['test-a'].stock === stockBeforeRecovery,'Aplicó inventario pese al fallo');
    await processPendingCreditEditsPOS(814); await processPendingCreditEditsPOS(814);
    check(invCentralLoadPOS().finishedByProductId['test-a'].stock === stockBeforeRecovery - 1,'La recuperación no fue idempotente');
    const lotEdit = await saveCreditSaleEditPOS(await draft(818,{qty:8}));
    check(lotEdit.sale.loteAllocations.reduce((sum,item)=>sum + item.qty,0) === 8,'No reasignó lotes excluyendo la venta original');
    check(lotEdit.sale.costTotal === 80,'Costo de lote incorrecto');
    const oldNotes = (await getOne('sales',819)).notes;
    const discounted = await saveCreditSaleEditPOS(await draft(819,{qty:3}));
    check(discounted.sale.total === 270 && discounted.sale.discount === 30,'No conservó el descuento histórico por unidad');
    check(discounted.sale.notes === oldNotes,'Recortó o cambió las notas históricas');
    // Eliminar una venta corregida restaura su consumo vigente.
    await del('sales',804);
    check(invCentralLoadPOS().varios[0].stock === 20,'Eliminar tras editar no restauró los Vasos físicos');
    await del('sales',806);
    check(invCentralLoadPOS().caps.vasos12oz.stock === 100,'Eliminar tras editar no restauró los consumibles históricos');
    check((await getOne('events',703)).fractionBatches[0].cupsRemaining === 10,'Eliminar tras editar no restauró el fraccionamiento');
    await saveCreditSaleEditPOS(await draft(821,{unitPrice:55}));
    const originalConfirm = window.confirm;
    window.confirm = ()=>true;
    try { await deleteEvent(706); }
    finally { window.confirm = originalConfirm; }
    check(!(await getOne('events',706)) && !(await getOne('sales',821)),'No conservó la eliminación normal de un evento con ventas editadas');
    const stockBeforeStartup = invCentralLoadPOS().finishedByProductId['test-a'].stock;
    A33Storage.sharedSet = function(key,value,options){
      if (options?.source === 'pos/edicion-credito') return {ok:false,message:'Fallo para probar recuperación al iniciar'};
      return originalSet.call(this,key,value,options);
    };
    try{
      const waiting = await saveCreditSaleEditPOS(await draft(820,{qty:2}));
      check(waiting.warnings.length === 1,'No guardó el ajuste para recuperar al iniciar');
      window.confirm = ()=>true;
      try { await deleteEvent(701); }
      finally { window.confirm = originalConfirm; }
      check(!!(await getOne('events',701)) && !!(await getOne('sales',820)),'Eliminó el evento con una corrección pendiente');
    }finally{ A33Storage.sharedSet = originalSet; }
    await renderCreditSalesPOS();
    return {history:(await getOne('sales',801)).creditEditHistory.length,lotWarnings:lotEdit.warnings,stockBeforeStartup};
  });
  assert.equal(results.history,2); assert.deepEqual(results.lotWarnings,[]);
  await page.locator('[data-credit-action="edit"][data-sale-id="801"]').click();
  await page.locator('#credit-edit-fields:not(:disabled)').waitFor();
  await page.locator('#credit-edit-history summary').click();
  assert.equal(await page.locator('#credit-edit-history-list p').count(),2);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>{const r=document.querySelector('#credit-edit-dialog').getBoundingClientRect();return r.width <= innerWidth && Math.abs(r.left - (innerWidth-r.right)) <= 1;}),true);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#credit-collection-dialog').dataset.bound === '1');
  assert.equal(await page.evaluate(()=>invCentralLoadPOS().finishedByProductId['test-a'].stock),results.stockBeforeStartup - 1);
  assert.equal(await page.evaluate(async()=>(await getOne('meta',CREDIT_EDIT_QUEUE_PREFIX_POS + '820')).value.status),'DONE');
  assert.deepEqual(errors,[]);
  console.log('PASS E2B: editor por fila, cliente/notas, saldo con abonos, inventario, Extras, Vasos modernos e históricos, lotes, cierres, concurrencia, reintentos, rollback, recuperación y eliminación posterior.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
