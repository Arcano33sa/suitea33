'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');
let playwright;
try { playwright=require('playwright'); }
catch (_) { playwright=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'finanzas/script.js'),'utf8');
const readers=source.slice(source.indexOf('async function finReadPosOperationalSourcesSafe()'),source.indexOf('const FIN_OPERATIONAL_CLASS_STAGE'));
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/__e44.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>E4.4 aislada</title>');return;}
  const file=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'}[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(error?'':data);});
});
let browser;
(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  browser=await playwright.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({serviceWorkers:'block'});
  const origin='http://127.0.0.1:'+server.address().port;
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/__e44.html');
  await page.addScriptTag({content:`const POS_DB_NAME='a33-pos';const FIN_POS_OPERATIONAL_STORES=['sales','events','banks','dailyClosures','cashV2','reempaques'];\n${readers}`});
  const absent=await page.evaluate(async()=>{
    const snapshot=await finReadPosOperationalSourcesSafe();
    return {ok:snapshot.ok,absent:snapshot.databaseAbsent,databases:(await indexedDB.databases()).map(db=>db.name)};
  });
  assert.strictEqual(absent.ok,true);assert.strictEqual(absent.absent,true);assert.ok(!absent.databases.includes('a33-pos'));
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const req=indexedDB.open('a33-pos',1);req.onerror=()=>reject(req.error);req.onsuccess=()=>{req.result.close();resolve();};
  }));
  const uninitialized=await page.evaluate(()=>finReadPosOperationalSourcesSafe());
  assert.strictEqual(uninitialized.ok,true);assert.strictEqual(uninitialized.databaseUninitialized,true);
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const req=indexedDB.open('a33-pos',2);
    req.onupgradeneeded=()=>{for(const name of ['sales','events','products'])req.result.createObjectStore(name,{keyPath:'id'});};
    req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const db=req.result;const tx=db.transaction(['sales','events','products'],'readwrite');
      tx.objectStore('sales').put({id:1,date:'2026-10-03',eventId:1,eventName:'Evento E4.4',productId:'p1',productName:'Producto',qty:1,unitPrice:100,total:100,lineCost:20,payment:'efectivo'});
      tx.objectStore('events').put({id:1,name:'Evento E4.4'});
      tx.objectStore('products').put({id:'p1',productId:'p1',name:'Producto',price:100});
      tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
    };
  }));
  await page.goto(origin+'/finanzas/index.html');
  await page.waitForFunction(()=>typeof finCachedData!=='undefined'&&!!finCachedData);
  await page.evaluate(async()=>{document.getElementById('tab-mes').value='10';document.getElementById('tab-anio').value='2026';await refreshAllFin();});
  assert.strictEqual(await page.locator('#tab-read-status').isVisible(),false);
  assert.match(await page.locator('#tab-alerts').textContent(),/Almacenes ausentes/);
  assert.match(await page.locator('#tab-venta-neta').textContent(),/100/);
  await page.evaluate(()=>{
    window.e44OriginalGetAll=IDBObjectStore.prototype.getAll;
    window.e44Failure={db:'a33-pos',store:'sales',mode:'throw'};
    IDBObjectStore.prototype.getAll=function(...args){
      const fault=window.e44Failure;
      if(fault&&this.transaction.db.name===fault.db&&this.name===fault.store){
        if(fault.mode==='throw')throw Object.assign(new Error('Fallo aislado E4.4 '+fault.db+'.'+fault.store),{name:'UnknownError'});
        const request=window.e44OriginalGetAll.apply(this,args);
        request.addEventListener('success',()=>this.transaction.abort());return request;
      }
      return window.e44OriginalGetAll.apply(this,args);
    };
  });
  async function refresh(){await page.evaluate(()=>refreshAllFin());}
  await refresh();
  assert.strictEqual(await page.locator('#tab-read-status').isVisible(),true);
  assert.match(await page.locator('#tab-read-status').textContent(),/a33-pos.sales/);
  assert.match(await page.locator('#tab-read-status').textContent(),/parciales/);
  assert.ok(!(await page.locator('#tab-alerts').textContent()).includes('No hay datos operativos'));
  await page.evaluate(()=>{window.e44Failure.mode='abort';});await refresh();
  assert.match(await page.locator('#tab-read-status').textContent(),/Transacción abortada/);
  assert.strictEqual(await page.evaluate(()=>finCachedData.posSales.length),0);
  await page.evaluate(()=>{window.e44Failure={db:'finanzasDB',store:'receipts',mode:'throw'};});await refresh();
  assert.match(await page.locator('#tab-read-status').textContent(),/finanzasDB.receipts/);
  assert.match(await page.locator('#tab-venta-neta').textContent(),/100/);
  await page.evaluate(()=>{window.e44Failure={db:'finanzasDB',store:'journalEntries',mode:'throw'};});
  const primary=await page.evaluate(async()=>{try{await refreshAllFin();return '';}catch(error){return error.message;}});
  assert.match(primary,/journalEntries/);assert.match(await page.locator('#tab-read-status').textContent(),/no fueron actualizados/);
  await page.evaluate(()=>{window.e44Failure=null;});await refresh();
  assert.strictEqual(await page.locator('#tab-read-status').isVisible(),false);
  assert.match(await page.locator('#tab-venta-neta').textContent(),/100/);
  assert.strictEqual(await page.evaluate(async()=>{
    const db=await finOpenPosDashboardReadonly();const rows=await finReadDashboardRows(db,'sales');db.close();return rows[0].total;
  }),100);
  assert.deepStrictEqual(errors,[], 'Errores de página: '+JSON.stringify(errors));
  console.log('APROBADA E4.4 Chrome: base ausente no creada, esquema anterior compatible, fallos POS/recibos, aborto tras getAll, fallo principal, aviso visible y recuperación; datos intactos.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
