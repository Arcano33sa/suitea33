'use strict';
// Perfil y origen temporales. Todos los cobros e integraciones usan datos de prueba.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = path.resolve(__dirname,'..');
const origin = 'http://a33-credit-e3.test';
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
  await page.evaluate(()=>{
    const general = {id:'general',cajaKey:'caja_general'};
    const events = {id:'events',cajaKey:'caja_eventos'};
    if (A33CreditFinance.suggest([general],{method:'efectivo',source:'POS_EFECTIVO'}) !== null) throw new Error('Asignó Caja general a un cobro de Caja eventos sin confirmación');
    if (A33CreditFinance.suggest([events],{method:'efectivo',source:'POS_VENTAS_CREDITO'}) !== null) throw new Error('Asignó Caja eventos a un cobro de Caja general sin confirmación');
  });
  const financePage = await context.newPage();
  financePage.on('pageerror',error=>errors.push(error.message));
  await financePage.goto(origin + '/finanzas/');
  await financePage.waitForFunction(()=>typeof finCachedData !== 'undefined' && finCachedData);
  await financePage.evaluate(async()=>{
    for (const account of await finGetAll('financialAccounts')) await finPut('financialAccounts',{...account,activa:false});
    for (const account of [
      {code:'1111',nombre:'Caja general prueba C$',tipo:'activo',rootType:'ACTIVO',isPostable:true,accountMode:'postable',currency:'NIO',isCash:true},
      {code:'1121',nombre:'Caja eventos prueba C$',tipo:'activo',rootType:'ACTIVO',isPostable:true,accountMode:'postable',currency:'NIO',isCash:true},
      {code:'1211',nombre:'Banco prueba C$',tipo:'activo',rootType:'ACTIVO',isPostable:true,accountMode:'postable',currency:'NIO',isBank:true},
      {code:'1221',nombre:'Otro banco prueba C$',tipo:'activo',rootType:'ACTIVO',isPostable:true,accountMode:'postable',currency:'NIO',isBank:true},
      {code:'1232',nombre:'Banco prueba US$',tipo:'activo',rootType:'ACTIVO',isPostable:true,accountMode:'postable',currency:'USD',isBank:true},
      {code:'1311',nombre:'Clientes por ventas al crédito C$',tipo:'activo',rootType:'ACTIVO',isPostable:true,accountMode:'postable',currency:'NIO'}
    ]) await finPut('accounts',account);
    for (const account of [
      {id:'test-general',nombreVisible:'Caja general prueba',type:'caja',cajaKey:'caja_general',cuentaContableCodigo:'1111'},
      {id:'test-events',nombreVisible:'Caja eventos prueba',type:'caja',cajaKey:'caja_eventos',cuentaContableCodigo:'1121'},
      {id:'test-bank',nombreVisible:'Banco prueba',type:'banco',cuentaContableCodigo:'1211'},
      {id:'invalid-currency-bank',nombreVisible:'Mapeo incompatible',type:'banco',cuentaContableCodigo:'1232'}
    ]) await finPut('financialAccounts',{...account,moneda:'NIO',activa:true});
  });
  await page.evaluate(async()=>{
    const date = cashV2DayKeyFromTsLocal(Date.now());
    await put('events',{id:701,name:'Evento sin Efectivo',groupName:'Prueba',cashV2Active:false});
    await put('events',{id:703,name:'Evento Efectivo',groupName:'Prueba',cashV2Active:true});
    const base = {eventId:701,eventName:'Evento sin Efectivo',date,payment:'credito',customerName:'Cliente prueba',productName:'Producto prueba',qty:1,unitPrice:500,total:500,manageStock:false};
    for (const sale of [
      {id:801,creditPaidAmount:100,creditPayments:[{id:'old-cash',creditPaymentId:'old-cash',source:'POS_EFECTIVO',amount:100,currency:'NIO',date}]},
      {id:802,creditPaidAmount:80,creditPayments:[{id:'old-bank',amount:80,currency:'C$',date,method:'transferencia',account:'Banco prueba'}]},
      {id:803,creditPaidAmount:30},
      {id:804,creditPaidAmount:50},
      {id:805},{id:806,eventId:703,eventName:'Evento Efectivo'},{id:807},
      {id:808,creditPaidAmount:20,creditPayments:[{id:'missing-date',amount:20,currency:'NIO',method:'efectivo'}]},
      {id:809},{id:810},{id:811},{id:812}
    ]) await put('sales',{...base,...sale});
    await put('cashV2',{key:cashV2Key('701',date),eventId:'701',dayKey:date,status:'CLOSED',movements:[
      {id:'old-cash-movement',creditSaleId:801,creditPaymentId:'old-cash',movementType:'CREDIT_COLLECTION',amount:100,currency:'NIO',kind:'IN'},
      {id:'cash-only',creditSaleId:803,movementType:'CREDIT_COLLECTION',amount:30,currency:'NIO',kind:'IN'}
    ]});
    await put('cashV2',{key:cashV2Key('703',date),eventId:'703',dayKey:date,status:'OPEN',movements:[],audit:[],initial:{totalC:0,totalUSD:0}});
  });
  // La apertura de POS integra también los pagos históricos con detalle.
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#credit-collection-dialog').dataset.bound === '1');
  let books = await financePage.evaluate(async()=>{
    const entries = (await finGetAll('journalEntries')).filter(entry=>entry.source === 'POS_CREDIT_COLLECTION');
    const lines = await finGetAll('journalLines');
    return {entries,lines};
  });
  assert.equal(books.entries.length,3);
  assert.equal(books.lines.filter(line=>books.entries.some(entry=>String(entry.id) === String(line.entryId))).length,6);
  assert.equal(books.entries.find(entry=>entry.creditSaleId === 801).financialAccountId,'test-events');
  assert.equal(books.entries.find(entry=>entry.creditSaleId === 802).financialAccountId,'test-bank');
  assert.equal(await page.evaluate(async()=>cashV2CreditSaleSnapshot(await getOne('sales',803),await getAll('cashV2')).paid),30);
  assert.equal(await page.evaluate(async()=>(await getOne('sales',804)).creditPayments),undefined,'Inventó detalle para un saldo histórico agregado');
  assert.equal(await page.evaluate(async()=>(await getOne('sales',808)).creditPayments[0].financeErrorCode),'DATE_REQUIRED');
  await page.evaluate(async()=>{
    const date = cashV2DayKeyFromTsLocal(Date.now());
    const request = (saleId,amount,method,id)=>({saleId,amount,method,date,account:'',reference:'Referencia prueba',requestId:id});
    await registerCreditPaymentPOS(request(805,200,'efectivo','new-cash'));
    await cashV2RegisterCreditCollectionAtomic({eventId:703,dayKey:date,saleId:806,amount:40,desc:'Cobro caja',requestId:'cash-ui'});
    await registerCreditPaymentPOS(request(807,75,'transferencia','new-bank'));
    await syncCreditFinancePOS(); await syncCreditFinancePOS();
  });
  const financial = await financePage.evaluate(async()=>{
    const data = await getAllFinData();
    const collections = data.entries.filter(entry=>entry.source === 'POS_CREDIT_COLLECTION');
    const operational = finBuildOperationalManualTotals(data);
    const date = new Date().toLocaleDateString('en-CA');
    const dashboard = calcTableroClasificadoForFilter(data,{desde:date.slice(0,7) + '-01',hasta:date,evento:'ALL'});
    const liquidity = calcCajaBancoMultimonedaUntilDate(data,'2099-12-31');
    const debit = data.lines.filter(line=>line.accountCode === '1311').reduce((sum,line)=>sum + Number(line.debe || 0),0);
    const credit = data.lines.filter(line=>line.accountCode === '1311').reduce((sum,line)=>sum + Number(line.haber || 0),0);
    return {count:collections.length,operational,dashboard,liquidity,cxc:debit-credit,
      badLines:data.lines.filter(line=>collections.some(entry=>entry.id === line.entryId) && !['1111','1121','1211','1311'].includes(line.accountCode)),
      labels:collections.map(entry=>finEntryOriginLabelForHistory(entry)),
      legacyFilter:collections.some(entry=>finEntryOriginMatchesFilter(entry,'POS_LEGACY'))};
  });
  assert.equal(financial.count,6); assert.equal(financial.cxc,-525); assert.equal(financial.badLines.length,0);
  assert.equal(financial.operational.entradasRealesDinero,525);
  assert.equal(financial.operational.movimientoCajaPeriodo,370);
  assert.equal(financial.operational.movimientoBancosPeriodo,155);
  assert.equal(financial.operational.ingresosAdicionales,0); assert.equal(financial.operational.gastos,0);
  assert.equal(financial.dashboard.cajaPeriodo,370); assert.equal(financial.dashboard.bancosPeriodo,155);
  assert.equal(financial.dashboard.ventaTotal,6000);
  assert.equal(financial.liquidity.totals.cashNio,370); assert.equal(financial.liquidity.totals.bankNio,155);
  assert.equal(financial.legacyFilter,false); assert(financial.labels.every(label=>label === 'POS — Cobro de crédito'));

  // Si la cuenta de destino no está activa, el pago se conserva y se recupera después.
  await financePage.evaluate(async()=>{const bank=(await finGetAll('financialAccounts')).find(row=>row.id==='test-bank');await finPut('financialAccounts',{...bank,activa:false});});
  await page.evaluate(async()=>{
    const result = await registerCreditPaymentPOS({saleId:812,amount:15,date:cashV2DayKeyFromTsLocal(Date.now()),method:'tarjeta',account:'',reference:'',requestId:'pending-bank'});
    if (!result.finance.pending || result.sale.creditPaidAmount !== 15) throw new Error('No conservó el pago pendiente de integrar');
  });
  await financePage.evaluate(async()=>{const bank=(await finGetAll('financialAccounts')).find(row=>row.id==='test-bank');await finPut('financialAccounts',{...bank,activa:true});});
  await page.evaluate(()=>syncCreditFinancePOS());
  assert.equal(await page.evaluate(async()=>(await getOne('sales',812)).creditPayments[0].financeStatus),'POSTED');

  // Una falla al insertar las líneas revierte también el encabezado del asiento.
  await page.evaluate(async()=>{
    await ensureFinanzasDB();
    const original = finDb;
    finDb = {objectStoreNames:original.objectStoreNames,transaction(...args){
      const transaction = original.transaction(...args);
      const objectStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = name=>{
        const store = objectStore(name);
        if (name === 'journalLines' && args[1] === 'readwrite') store.add = ()=>{throw new Error('Fallo simulado de líneas');};
        return store;
      };
      return transaction;
    }};
    try{
      const result = await registerCreditPaymentPOS({saleId:810,amount:25,date:cashV2DayKeyFromTsLocal(Date.now()),method:'transferencia',account:'',reference:'',requestId:'rollback-lines'});
      if (!result.finance.pending || result.sale.creditPaidAmount !== 25) throw new Error('Se perdió el pago tras el fallo de Finanzas');
    }finally{finDb=original;}
  });
  assert.equal(await financePage.evaluate(async()=>(await finGetAll('journalEntries')).filter(entry=>entry.creditSaleId===810).length),0);
  await page.evaluate(()=>syncCreditFinancePOS({saleId:810}));
  assert.equal(await financePage.evaluate(async()=>(await finGetAll('journalEntries')).filter(entry=>entry.creditSaleId===810).length),1);

  // Fallar la confirmación en POS después de contabilizar no duplica el asiento al reintentar.
  await page.evaluate(async()=>{
    const original = db;
    db = {objectStoreNames:original.objectStoreNames,transaction(...args){
      const transaction = original.transaction(...args);
      const objectStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = name=>{
        const store = objectStore(name);
        if (name === 'sales' && args[1] === 'readwrite'){
          const put = store.put.bind(store);
          store.put = value=>{
            if (value.id === 811 && value.creditPayments?.some(payment=>payment.financeStatus === 'POSTED')) throw new Error('Fallo simulado de confirmación POS');
            return put(value);
          };
        }
        return store;
      };
      return transaction;
    }};
    try{await registerCreditPaymentPOS({saleId:811,amount:35,date:cashV2DayKeyFromTsLocal(Date.now()),method:'transferencia',account:'',reference:'',requestId:'ack-fail'});}
    finally{db=original;}
    await syncCreditFinancePOS({saleId:811});
  });
  assert.equal(await financePage.evaluate(async()=>(await finGetAll('journalEntries')).filter(entry=>entry.creditSaleId===811).length),1);
  assert.equal(await page.evaluate(async()=>(await getOne('sales',811)).creditPayments[0].financeStatus),'POSTED');

  // Cuenta bancaria ambigua: asignación desde el historial, sin registrar otro pago.
  await financePage.evaluate(()=>finPut('financialAccounts',{id:'test-bank-2',nombreVisible:'Segundo banco prueba',type:'banco',cuentaContableCodigo:'1221',moneda:'C$',activa:true}));
  await page.evaluate(async()=>{
    await registerCreditPaymentPOS({saleId:809,amount:45,date:cashV2DayKeyFromTsLocal(Date.now()),method:'transferencia',account:'',reference:'',requestId:'choose-bank'});
    await renderCreditSalesPOS();
  });
  await page.locator('#credit-sales-panel summary').click();
  await page.locator('[data-credit-action="collect"][data-sale-id="809"]').click();
  await page.locator('#tbl-credit-payments button[data-finance-payment-key]').click();
  await page.locator('#credit-finance-fields:not(:disabled)').waitFor();
  await page.selectOption('#credit-finance-account','test-bank-2');
  await page.locator('#credit-finance-form button[type="submit"]').click();
  await page.waitForFunction(()=>!document.querySelector('#credit-finance-dialog').open);
  assert.equal(await page.evaluate(async()=>(await getOne('sales',809)).creditPayments.length),1);
  assert.equal(await page.evaluate(async()=>(await getOne('sales',809)).creditPayments[0].financialAccountId),'test-bank-2');
  assert((await page.locator('#tbl-credit-payments tbody').textContent()).includes('Integrado'));
  await page.click('#credit-collection-close');
  // Una coincidencia con un asiento manual exige revisar antes de crear otro.
  await financePage.evaluate(async()=>{
    await new Promise((resolve,reject)=>{
      const transaction = finDB.transaction(['journalEntries','journalLines'],'readwrite');
      const date = todayStr();
      const request = transaction.objectStore('journalEntries').add({fecha:date,source:'manual_financial_account',
        descripcion:'Cobro manual anterior',operationalClass:'CASH_IN',tipoMovimiento:'entrada',paymentMethod:'bank',
        financialAccountId:'test-bank',originalAmount:12,originalCurrency:'NIO',totalDebe:12,totalHaber:12});
      request.onsuccess = ()=>{
        transaction.objectStore('journalLines').add({entryId:request.result,accountCode:'1211',debe:12,haber:0});
        transaction.objectStore('journalLines').add({entryId:request.result,accountCode:'1311',debe:0,haber:12});
      };
      transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error);
    });
  });
  await page.evaluate(async()=>{
    const date = cashV2DayKeyFromTsLocal(Date.now());
    await put('sales',{id:815,eventId:701,date,payment:'credito',customerName:'Cliente coincidencia',productName:'Prueba',qty:1,unitPrice:500,total:500,manageStock:false});
    await registerCreditPaymentPOS({saleId:815,amount:12,date,method:'transferencia',account:'Banco prueba',reference:'',requestId:'manual-match'});
    if ((await getOne('sales',815)).creditPayments[0].financeErrorCode !== 'POSSIBLE_DUPLICATE') throw new Error('No detectó una posible contabilización manual previa');
    await renderCreditSalesPOS();
  });
  assert.equal(await financePage.evaluate(async()=>(await finGetAll('journalEntries')).filter(entry=>entry.creditSaleId===815).length),0);
  await page.locator('[data-credit-action="collect"][data-sale-id="815"]').click();
  await page.locator('#tbl-credit-payments button[data-finance-payment-key]').click();
  await page.locator('#credit-finance-fields:not(:disabled)').waitFor();
  await page.selectOption('#credit-finance-account','test-bank');
  page.on('dialog',dialog=>dialog.accept());
  await page.locator('#credit-finance-form button[type="submit"]').click();
  await page.waitForFunction(()=>!document.querySelector('#credit-finance-dialog').open);
  assert.equal(await financePage.evaluate(async()=>(await finGetAll('journalEntries')).filter(entry=>entry.creditSaleId===815).length),1);
  await page.click('#credit-collection-close');
  // IDs de pagos legacy repetidos en ventas distintas conservan su identidad por venta.
  await page.evaluate(async()=>{
    const date = cashV2DayKeyFromTsLocal(Date.now());
    for (const id of [816,817]){
      await put('sales',{id,eventId:701,date,payment:'credito',customerName:'Cliente legacy',productName:'Prueba',qty:1,unitPrice:100,total:100,manageStock:false,
        creditPaidAmount:7,creditPayments:[{id:'local-payment-id',creditPaymentId:'local-payment-id',amount:7,date,currency:'NIO',source:'POS_EFECTIVO'}]});
    }
    const cash = await getOne('cashV2',cashV2Key('701',date));
    for (const id of [816,817]) cash.movements.push({id:'legacy-movement-'+id,creditSaleId:id,creditPaymentId:'local-payment-id',movementType:'CREDIT_COLLECTION',amount:7,currency:'NIO',kind:'IN'});
    await put('cashV2',cash);
    const legacy = A33CreditFinance.candidates([{id:999,creditPayments:[{id:'receipt-id',movementId:'movement-id',amount:8,date}]}],
      [{dayKey:date,movements:[{id:'movement-id',creditSaleId:999,movementType:'CREDIT_COLLECTION',amount:8}]}]);
    if (legacy.length !== 1) throw new Error('Duplicó un cobro histórico enlazado por movementId');
  });
  await Promise.all([page.evaluate(()=>syncCreditFinancePOS()),financePage.evaluate(()=>finSyncPosCreditPayments())]);
  const finalTotals = await financePage.evaluate(async()=>{
    const data = await getAllFinData();
    return {collections:data.entries.filter(entry=>entry.source==='POS_CREDIT_COLLECTION'),operational:finBuildOperationalManualTotals(data)};
  });
  assert.equal(finalTotals.collections.filter(entry=>[816,817].includes(entry.creditSaleId)).length,2);
  assert.equal(finalTotals.operational.entradasRealesDinero,finalTotals.collections.reduce((sum,entry)=>sum+entry.originalAmount,0)+12);
  await page.evaluate(()=>renderCreditSalesPOS());
  await page.locator('[data-credit-action="collect"][data-sale-id="809"]').click();
  await page.locator('#tbl-credit-payments tbody tr').waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.querySelector('#credit-collection-dialog').getBoundingClientRect().width <= innerWidth),true);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#credit-collection-dialog').dataset.bound === '1');
  assert.equal(await financePage.evaluate(async()=>(await finGetAll('journalEntries')).filter(entry=>entry.source==='POS_CREDIT_COLLECTION').length),13);
  assert.deepEqual(errors,[]);
  console.log('PASS E3: históricos automáticos, cuentas financieras, asientos equilibrados, CxC, deduplicación con caja, tablero, cuentas ambiguas, rollback, confirmación recuperable, historial y recarga.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
