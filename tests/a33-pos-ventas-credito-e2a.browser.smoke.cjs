'use strict';
// Perfil y origen temporales. Todos los pagos y eliminaciones usan datos de prueba.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = path.resolve(__dirname,'..');
const origin = 'http://a33-credit-e2a.test';
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
    await openDB();
    const today = cashV2DayKeyFromTsLocal(Date.now());
    const events = [
      {id:701,name:'Sin Efectivo',groupName:'Prueba',cashV2Active:false,extras:[{id:1,name:'Extra prueba',stock:3,active:true}]},
      {id:702,name:'Cerrado sin Efectivo',groupName:'Prueba',cashV2Active:false,closedAt:today},
      {id:703,name:'Con Efectivo',groupName:'Prueba',cashV2Active:true},
      {id:704,name:'Caja cerrada',groupName:'Prueba',cashV2Active:true}
    ];
    const base = {eventId:701,date:today,productName:'Producto prueba',qty:10,unitPrice:100,payment:'credito',customerName:'Ana',manageStock:false};
    const sales = [
      {id:801,total:1000},
      {id:802,eventId:702,total:900,creditPaidAmount:300,customerName:'Histórico'},
      {id:803,total:500,creditPaidAmount:500},
      {id:804,total:100,voided:true},
      {id:805,total:200,payment:'',paymentMethod:'credito'},
      {id:806,total:1000,creditPaidAmount:300,creditPayments:[{id:'old-payment',creditPaymentId:'old-payment',amount:300,date:today,source:'POS_EFECTIVO'}]},
      {id:810,total:100,purchaseUid:'purchase-test',uid:'purchase-test:0',purchaseLineIndex:0,purchaseLineCount:2,purchaseTotal:300},
      {id:811,total:200,purchaseUid:'purchase-test',uid:'purchase-test:1',purchaseLineIndex:1,purchaseLineCount:2,purchaseTotal:300},
      {id:812,total:40,isExtra:true,extraId:1,qty:2},
      {id:813,total:20,payment:'efectivo',paidAmount:20},
      {id:814,total:100},
      {id:815,total:1000},
      {id:816,total:100,eventId:703},
      {id:817,total:100,eventId:704},
      {id:818,total:100,eventId:703}
    ].map(sale=>({...base,...sale}));
    await new Promise((resolve,reject)=>{
      const tr = db.transaction(['sales','events','cashV2'],'readwrite');
      for (const event of events) tr.objectStore('events').put(event);
      for (const sale of sales) tr.objectStore('sales').put(sale);
      tr.objectStore('cashV2').put({key:cashV2Key('701',today),eventId:'701',dayKey:today,status:'CLOSED',movements:[{id:'old-movement',creditPaymentId:'old-payment',creditSaleId:806,movementType:'CREDIT_COLLECTION',kind:'IN',currency:'NIO',amount:300,date:today}],audit:[]});
      for (const id of [703,704]) tr.objectStore('cashV2').put({key:cashV2Key(String(id),today),eventId:String(id),dayKey:today,status:id === 703 ? 'OPEN' : 'CLOSED',movements:[],audit:[],initial:{totalC:0,totalUSD:0}});
      tr.oncomplete = resolve; tr.onerror = ()=>reject(tr.error);
    });
    await refreshEventUI(); await renderCreditSalesPOS();
  });
  await page.locator('#credit-sales-panel summary').click();
  const collect = id=>page.locator(`[data-credit-action="collect"][data-sale-id="${id}"]`);
  const remove = id=>page.locator(`[data-credit-action="delete"][data-sale-id="${id}"]`);
  await collect(801).click();
  await page.locator('#credit-collection-fields:not(:disabled)').waitFor();
  await page.fill('#credit-collection-amount','400');
  await page.selectOption('#credit-collection-method','transferencia');
  await page.fill('#credit-collection-account','Banco de prueba');
  await page.fill('#credit-collection-reference','Comprobante 001');
  await page.locator('#credit-collection-form button[type="submit"]').click();
  await page.waitForFunction(()=>!document.querySelector('#credit-collection-dialog').open);
  let sale = await page.evaluate(()=>getOne('sales',801));
  assert.equal(sale.creditPaidAmount,400); assert.equal(sale.creditBalance,600); assert.equal(sale.creditStatus,'ABONADA');
  assert.equal(sale.total,1000); assert.equal(sale.qty,10); assert.equal(sale.unitPrice,100);
  assert.equal(sale.creditPayments[0].account,'Banco de prueba');
  assert.equal(sale.creditPayments[0].reference,'Comprobante 001');
  assert.equal(sale.creditPayments[0].affectsInventory,false);
  assert(await remove(801).isDisabled());
  await collect(801).click();
  await page.locator('#tbl-credit-payments tbody tr').waitFor();
  assert((await page.locator('#tbl-credit-payments tbody').textContent()).includes('Comprobante 001'));
  await page.locator('#credit-collection-form button[type="submit"]').click();
  await page.waitForFunction(()=>!document.querySelector('#credit-collection-dialog').open);
  sale = await page.evaluate(()=>getOne('sales',801));
  assert.equal(sale.creditBalance,0); assert.equal(sale.creditStatus,'PAGADA'); assert.equal(sale.creditPayments.length,2);
  assert.equal(await page.evaluate(async()=>((await getAll('cashV2')).find(row=>row.eventId === '701').movements.length)),1,'Cobrar sin Efectivo creó movimientos de caja');
  await page.selectOption('#credit-sales-filter','paid');
  await collect(801).click();
  await page.locator('#credit-collection-form').waitFor({state:'hidden'});
  assert.equal(await page.locator('#tbl-credit-payments tbody tr').count(),2);
  await page.click('#credit-collection-close');
  await page.selectOption('#credit-sales-filter','all');

  const results = await page.evaluate(async()=>{
    const today = cashV2DayKeyFromTsLocal(Date.now());
    const request = (saleId,amount,requestId,extra={})=>({saleId,amount,requestId,date:today,method:'transferencia',account:'',reference:'',...extra});
    const reject = async (promise,pattern)=>{
      try { await promise; throw new Error('Se esperaba rechazo'); }
      catch(error){ if (!pattern.test(error.message)) throw error; }
    };
    const closed = await registerCreditPaymentPOS(request(802,100,'closed-event',{method:'efectivo'}));
    if (closed.sale.creditBalance !== 500) throw new Error('Saldo histórico incorrecto');
    const retryRequest = request(805,20,'retry');
    await registerCreditPaymentPOS(retryRequest);
    const duplicate = await registerCreditPaymentPOS(retryRequest);
    if (!duplicate.duplicate || duplicate.sale.creditPayments.length !== 1) throw new Error('Reintento duplicado');
    await reject(registerCreditPaymentPOS({...retryRequest,amount:21}),/otros datos/);
    await registerCreditPaymentPOS(request(806,100,'mixed-history'));
    const mixed = await getOne('sales',806);
    const history = creditPaymentHistoryPOS(mixed,await getAll('cashV2'));
    if (mixed.creditPaidAmount !== 400 || history.length !== 2) throw new Error('Cobros históricos duplicados');
    for (const amount of [0,-1,NaN,Infinity]) await reject(registerCreditPaymentPOS(request(805,amount,'bad-amount')),/monto/);
    await reject(registerCreditPaymentPOS(request(805,9999,'overpayment')),/supera/);
    await reject(registerCreditPaymentPOS(request(805,1,'bad-date',{date:'2026-02-30'})),/fecha/);
    await reject(registerCreditPaymentPOS(request(805,1,'bad-method',{method:'credito'})),/medio/);
    await reject(registerCreditPaymentPOS(request(804,1,'void')),/admite/);
    await reject(registerCreditPaymentPOS(request(801,1,'paid')),/pagada/);
    await reject(del('sales',801),/cobros vinculados/);
    const concurrent = await Promise.allSettled([
      registerCreditPaymentPOS(request(815,600,'concurrent-1')),
      registerCreditPaymentPOS(request(815,600,'concurrent-2'))
    ]);
    if (concurrent.filter(result=>result.status === 'fulfilled').length !== 1) throw new Error('Sobrepago concurrente');
    const cash = await registerCreditPaymentPOS(request(816,30,'cash',{method:'efectivo'}));
    if (!cash.cashDay || cash.cashDay.movements.length !== 1) throw new Error('Falta movimiento de caja');
    if (cashV2CreditSaleSnapshot(cash.sale,await getAll('cashV2')).paid !== 30) throw new Error('Cobro de caja duplicado');
    if (creditPaymentHistoryPOS(cash.sale,await getAll('cashV2')).length !== 1) throw new Error('Historial de caja duplicado');
    await reject(registerCreditPaymentPOS(request(817,10,'closed-cash',{method:'efectivo'})),/Abre la caja/);
    const yesterday = cashV2DayKeyFromTsLocal(Date.now() - 86400000);
    await reject(registerCreditPaymentPOS(request(816,10,'past-cash',{method:'efectivo',date:yesterday})),/día real/);
    // Una falla al escribir la venta debe revertir también el movimiento de caja.
    const realDb = db;
    db = {transaction(...args){
      const tr = realDb.transaction(...args);
      const nativeStore = tr.objectStore.bind(tr);
      tr.objectStore = name=>{
        const store = nativeStore(name);
        if (name === 'sales') store.put = ()=>{ throw new Error('Fallo simulado de persistencia'); };
        return store;
      };
      return tr;
    }};
    try { await reject(registerCreditPaymentPOS(request(818,10,'rollback',{method:'efectivo'})),/simulado/); }
    finally { db = realDb; }
    if ((await getOne('sales',818)).creditPaidAmount) throw new Error('Venta escrita tras fallo');
    if ((await getOne('cashV2',cashV2Key('703',today))).movements.length !== 1) throw new Error('Caja escrita tras fallo');
    // El cobro que entra después de la revisión inicial debe impedir el borrado final.
    const originalEnqueue = enqueuePhysicalCupRestoreForSalePOS;
    let racingPayment;
    enqueuePhysicalCupRestoreForSalePOS = (record,reason)=>{
      if (record.id === 814) racingPayment = registerCreditPaymentPOS(request(814,10,'delete-race'));
      return originalEnqueue(record,reason);
    };
    try { await reject(del('sales',814),/cambió|cobros vinculados/); await racingPayment; }
    finally { enqueuePhysicalCupRestoreForSalePOS = originalEnqueue; }
    if ((await getOne('sales',814)).creditPaidAmount !== 10) throw new Error('Se perdió el cobro concurrente');
    // El guardado de pagos de crédito no impide borrar una venta ordinaria pagada.
    await del('sales',813);
    if (await getOne('sales',813)) throw new Error('Regresión en venta ordinaria');
    return {concurrentPaid:(await getOne('sales',815)).creditPaidAmount,historyRows:history.length};
  });
  assert.equal(results.concurrentPaid,600); assert.equal(results.historyRows,2);
  await page.evaluate(()=>renderCreditSalesPOS());
  await page.evaluate(()=>{
    const originalDelete = deleteCreditSalePOS;
    deleteCreditSalePOS = (...args)=>{
      window.__creditDeletion = originalDelete(...args);
      return window.__creditDeletion;
    };
  });
  page.on('dialog',dialog=>dialog.accept());
  await remove(810).click();
  await page.evaluate(()=>window.__creditDeletion);
  assert.equal(await page.evaluate(()=>getOne('sales',810)),null);
  // La eliminación desde créditos también revierte la compra completa.
  assert.equal(await page.evaluate(()=>getOne('sales',811)),null);
  await remove(812).click();
  await page.evaluate(()=>window.__creditDeletion);
  assert.equal(await page.evaluate(()=>getOne('sales',812)),null);
  assert.equal(await page.evaluate(async()=>(await getOne('events',701)).extras[0].stock),5);
  await collect(802).click();
  await page.locator('#tbl-credit-payments tbody tr').first().waitFor();
  assert((await page.locator('#tbl-credit-payments tbody').textContent()).includes('Cobros anteriores sin detalle'));
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.querySelector('#credit-collection-dialog').getBoundingClientRect().width <= innerWidth),true);
  assert.equal(await page.evaluate(()=>{
    const rect = document.querySelector('#credit-collection-dialog').getBoundingClientRect();
    return Math.abs(rect.left - (innerWidth - rect.right)) <= 1;
  }),true,'El modal debe quedar centrado en móvil');
  assert.deepEqual(errors,[]);
  console.log('PASS E2A: pagos parciales y completos, eventos sin Efectivo y cerrados, historial compatible, reintentos, sobrepagos, concurrencia, rollback, caja, eliminación protegida, compra multiproducto, stock de Extras y modal móvil.');
})().catch(error=>{ console.error(error); process.exitCode = 1; }).finally(async()=>{ if (browser) await browser.close(); });
