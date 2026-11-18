'use strict';
// Servidor local y perfil temporal. Los datos financieros son fixtures aislados.
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = path.resolve(__dirname,'..');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const server = http.createServer((request,response)=>{
  const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  const file = path.resolve(root,'.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
  if (!file.startsWith(root + path.sep)){response.writeHead(403);response.end();return;}
  fs.readFile(file,(error,data)=>{
    response.writeHead(error ? 404 : 200,{'Content-Type':mime[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
    response.end(error ? '' : data);
  });
});
let browser;
(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await playwright.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context = await browser.newContext({serviceWorkers:'allow',timezoneId:'America/Managua'});
  await context.route('**/*',route=>route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const pos = await context.newPage();
  const errors = [];
  pos.on('pageerror',error=>errors.push(error.message));
  await pos.goto(origin + '/pos/');
  await pos.waitForFunction(()=>document.querySelector('#credit-collection-dialog').dataset.bound === '1');
  await pos.evaluate(()=>navigator.serviceWorker.ready);
  await pos.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const finance = await context.newPage();
  finance.on('pageerror',error=>errors.push(error.message));
  await finance.goto(origin + '/finanzas/');
  await finance.waitForFunction(()=>typeof finCachedData !== 'undefined' && finCachedData);
  await finance.evaluate(()=>navigator.serviceWorker.ready);
  await finance.waitForFunction(()=>!!navigator.serviceWorker.controller);
  for (const [page,module] of [[pos,'pos'],[finance,'finanzas']]){
    assert.equal(await page.evaluate(async module=>{
      const names = (await caches.keys()).filter(name=>name.includes('-' + module + '-'));
      for (const name of names){
        const cache = await caches.open(name);
        if (await cache.match('/assets/js/a33-credit-finance.js?v=4.20.98&r=1')) return true;
      }
      return false;
    },module),true,'Falta la integración en la caché de ' + module);
  }
  await finance.evaluate(async()=>{
    for (const account of await finGetAll('financialAccounts')) await finPut('financialAccounts',{...account,activa:false});
    await finPut('accounts',{code:'1111',nombre:'Caja offline C$',tipo:'activo',rootType:'ACTIVO',isPostable:true,accountMode:'postable',currency:'NIO',isCash:true});
    await finPut('accounts',{code:'1311',nombre:'Clientes por cobrar C$',tipo:'activo',rootType:'ACTIVO',isPostable:true,accountMode:'postable',currency:'NIO'});
    await finPut('financialAccounts',{id:'offline-cash',nombreVisible:'Caja offline',type:'caja',cajaKey:'caja_general',moneda:'NIO',cuentaContableCodigo:'1111',activa:true});
  });
  await pos.evaluate(async()=>{
    const date = cashV2DayKeyFromTsLocal(Date.now());
    await put('events',{id:9000,name:'Prueba offline',groupName:'Prueba',cashV2Active:false});
    await put('sales',{id:9000,eventId:9000,date,payment:'credito',customerName:'Cliente offline',productName:'Producto',qty:1,unitPrice:100,total:100,manageStock:false});
  });
  await context.setOffline(true);
  await pos.reload();
  await pos.waitForFunction(()=>document.querySelector('#credit-collection-dialog').dataset.bound === '1');
  assert.equal(await pos.evaluate(()=>A33CreditFinance.SOURCE),'POS_CREDIT_COLLECTION');
  const result = await pos.evaluate(async()=>{
    const result = await registerCreditPaymentPOS({saleId:9000,amount:20,date:cashV2DayKeyFromTsLocal(Date.now()),method:'efectivo',account:'',reference:'Offline',requestId:'offline-payment'});
    return {pending:result.finance.pending,balance:result.sale.creditBalance,status:result.sale.creditPayments[0].financeStatus};
  });
  assert.deepEqual(result,{pending:0,balance:80,status:'POSTED'});
  await finance.reload();
  await finance.waitForFunction(()=>typeof finCachedData !== 'undefined' && finCachedData);
  assert.equal(await finance.evaluate(()=>A33CreditFinance.SOURCE),'POS_CREDIT_COLLECTION');
  assert.equal(await finance.evaluate(async()=>(await finGetAll('journalEntries')).filter(entry=>entry.source === 'POS_CREDIT_COLLECTION').length),1);
  // Una carga incompleta de la integración conserva el flujo de cobro y su recuperación.
  const partial = await context.newPage();
  partial.on('pageerror',error=>errors.push(error.message));
  await partial.addInitScript(()=>Object.defineProperty(window,'A33CreditFinance',{configurable:true,get(){return undefined;},set(){}}));
  await partial.goto(origin + '/pos/');
  await partial.waitForFunction(()=>document.querySelector('#credit-collection-dialog').dataset.bound === '1');
  const pending = await partial.evaluate(async()=>{
    const result = await registerCreditPaymentPOS({saleId:9000,amount:10,date:cashV2DayKeyFromTsLocal(Date.now()),method:'efectivo',account:'',reference:'Carga incompleta',requestId:'partial-integration'});
    await openCreditCollectionPOS(9000);
    return {pending:result.finance.pending,balance:result.sale.creditBalance};
  });
  assert.deepEqual(pending,{pending:1,balance:70});
  assert.equal(await partial.locator('#credit-collection-form').isVisible(),true);
  await partial.close();
  await pos.reload();
  await pos.waitForFunction(()=>document.querySelector('#credit-collection-dialog').dataset.bound === '1');
  assert.equal(await finance.evaluate(async()=>(await finGetAll('journalEntries')).filter(entry=>entry.source === 'POS_CREDIT_COLLECTION').length),2);
  assert.deepEqual(errors,[]);
  console.log('PASS E3 offline: apertura y caché de POS/Finanzas, pago sin red, asiento contable y recarga sin duplicados.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
});
