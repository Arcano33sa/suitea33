'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = path.resolve(__dirname, '..');
// Simula una instalación anterior y su actualización en un origen aislado.
const oldWorker = fs.readFileSync(path.join(root,'exportaciones/sw.js'),'utf8').replace('a33-exportaciones-e3-r4','a33-exportaciones-e3-r3').replace('style.css?v=4.20.98&r=4','style.css?v=4.20.98&r=3');
const css = fs.readFileSync(path.join(root,'exportaciones/style.css'),'utf8');
let current = false;
const server = http.createServer((req,res)=>{
  const url = new URL(req.url,'http://localhost');
  const file = path.resolve(root,'.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{
    if(!error && !current){
      if(url.pathname==='/exportaciones/sw.js') data=oldWorker;
      else if(url.pathname==='/exportaciones/style.css') data=css.replace(/^\.section-heading > a.*\n/gm,'');
      else if(url.pathname.startsWith('/exportaciones/') && file.endsWith('.html')) data=data.toString().replace('href="style.css?v=4.20.98&r=4"','href="style.css?v=4.20.98&r=3"');
    }
    res.writeHead(error?404:200,{'Cache-Control':'no-store','Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream'});
    res.end(error?'':data);
  });
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await playwright.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({serviceWorkers:'allow'});
  const page=await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(origin+'/exportaciones/catalogos.html');
  await page.evaluate(()=>Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('SW no listo')),15000))]));
  await page.waitForFunction(()=>navigator.serviceWorker.controller);
  await page.reload();
  assert.equal(await page.locator('.section-heading > a').evaluate(el=>getComputedStyle(el).textDecorationLine),'underline');
  await page.evaluate(async()=>{
    localStorage.setItem('a33_update_marker','conservar');
    await(await caches.open('a33-other-module-test')).put('/marker',new Response('conservar'));
    await new Promise((resolve,reject)=>{const r=indexedDB.open('a33-update-test',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>{const db=r.result,tx=db.transaction('data','readwrite');tx.objectStore('data').put('conservar','marker');tx.oncomplete=()=>{db.close();resolve();};};r.onerror=()=>reject(r.error);});
  });
  current=true;
  await page.evaluate(async()=>{const reg=await navigator.serviceWorker.ready;await reg.update();});
  await page.waitForFunction(async()=> (await caches.keys()).includes('a33-exportaciones-e3-r4'));
  await page.waitForFunction(async()=>{const reg=await navigator.serviceWorker.ready;return !reg.installing && !reg.waiting;});
  await page.reload();
  for(const offline of [false,true]){
    await context.setOffline(offline);
    for(const module of ['index','finanzas','analitica','pedidos','lotes','catalogos']){
      await page.goto(origin+'/exportaciones/'+module+'.html',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('.section-heading > a')).borderTopStyle==='solid');
      const style=await page.locator('.section-heading > a').evaluate(el=>{const s=getComputedStyle(el);return [s.textDecorationLine,s.backgroundColor,s.borderTopStyle];});
      assert.deepEqual(style,['none','rgb(21, 21, 21)','solid'],module+' offline='+offline);
    }
  }
  assert.equal(await page.evaluate(()=>localStorage.getItem('a33_update_marker')),'conservar');
  assert.equal(await page.evaluate(async()=>await(await(await caches.open('a33-other-module-test')).match('/marker')).text()),'conservar');
  assert.equal(await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('a33-update-test');r.onsuccess=()=>{const db=r.result,q=db.transaction('data').objectStore('data').get('marker');q.onsuccess=()=>{db.close();resolve(q.result);};};})),'conservar');
  console.log('PASS: actualización r3 → r4; seis pantallas online/offline; localStorage, IndexedDB y caché ajena conservados.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
