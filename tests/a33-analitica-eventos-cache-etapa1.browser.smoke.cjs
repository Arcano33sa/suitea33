'use strict';
// Simula una instalación anterior y su actualización en un origen/contexto aislados.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');
const {execFileSync} = require('child_process');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = path.resolve(__dirname, '..');
const previous = file => execFileSync('git', ['show', '06f1c65:analitica/' + file], {cwd:root, encoding:'utf8'});
const old = {html:previous('index.html'), script:previous('script.js'), sw:previous('sw.js')};
const current = {html:fs.readFileSync(path.join(root,'analitica/index.html'),'utf8'), script:fs.readFileSync(path.join(root,'analitica/script.js'),'utf8'), sw:fs.readFileSync(path.join(root,'analitica/sw.js'),'utf8')};
const scriptRef = current.html.match(/src="(script.js\?[^" ]+)"/)[1];
assert.ok(current.sw.includes("'./" + scriptRef + "'"));
assert.ok(!old.html.includes(scriptRef));
let phase = 'old';
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server = http.createServer((req,res) => {
  const url = new URL(req.url,'http://localhost');
  const pathname = url.pathname;
  res.setHeader('Cache-Control','no-store');
  if (pathname === '/seed.html') {res.end('<!doctype html><title>Prueba aislada</title>');return;}
  const data = phase === 'old' ? old : current;
  if (pathname === '/analitica/' || pathname === '/analitica/index.html') {
    res.setHeader('Content-Type','text/html');res.end(phase === 'mixed' ? current.html.replace(scriptRef,'script.js?v=4.20.98&r=14').replace(/sw.js\?v=4.20.98&r=\d+/, 'sw.js?v=4.20.98&r=3') : data.html);return;
  }
  if (pathname === '/analitica/sw.js') {res.setHeader('Content-Type','text/javascript');res.end(phase === 'mixed' ? old.sw : data.sw);return;}
  if (pathname === '/analitica/script.js') {res.setHeader('Content-Type','text/javascript');res.end(data.script);return;}
  const file = path.resolve(root,'.' + pathname);
  if (!file.startsWith(root + path.sep)) {res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,body)=>{res.writeHead(error?404:200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream'});res.end(error?'':body);});
});
let browser;
(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await playwright.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context = await browser.newContext({serviceWorkers:'allow'});
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin + '/seed.html');
  await page.evaluate(async()=>{
    localStorage.setItem('a33_cache_test_marker','conservar');
    await (await caches.open('a33-test-other-module')).put('/marker',new Response('conservar'));
    await new Promise((resolve,reject)=>{
      const request=indexedDB.open('a33-pos',1);
      request.onupgradeneeded=()=>{for(const name of ['sales','events','products','reempaques','cashV2']) request.result.createObjectStore(name,{keyPath:'id'});};
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result,tx=db.transaction(['sales','events'],'readwrite');
        tx.objectStore('events').put({id:17,name:'Evento conservado'});
        tx.objectStore('sales').put({id:1,eventId:17,eventName:'Evento conservado',date:'2026-11-15',qty:1,total:100,lineCost:30,productId:'p1',productName:'Prueba'});
        tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
      };
    });
  });
  await page.goto(origin + '/analitica/');
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const oldCaches = await page.evaluate(()=>caches.keys());
  assert.ok(oldCaches.some(key=>key.endsWith('-m4')));
  // Reproduce el fallo: HTML nuevo, misma URL de script y SW anterior activo.
  phase='mixed';
  await page.reload();
  assert.equal(await page.locator('#analytics-event-picker').innerHTML(),'');
  // Nueva referencia: funciona incluso mientras el nuevo SW espera aprobación.
  phase='new';
  await page.reload();
  await page.waitForFunction(()=>!!document.querySelector('#analytics-event-picker input[value="17"]'));
  await page.selectOption('#period-select','all');
  await page.locator('#analytics-event-picker summary').click();
  await page.locator('#analytics-event-picker [data-clear]').click();
  await page.locator('#analytics-event-picker input[value="17"]').check();
  await page.locator('#analytics-event-picker summary').click();
  assert.ok((await page.textContent('#kpi-total-ventas')).includes('100.00'));
  await page.click('#btn-export-consolidado');
  assert.equal(await page.locator('#analytics-export-event-picker input:checked').inputValue(),'17');
  await page.click('#btn-cancel-export');
  await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
  // Simula la aprobación explícita en Configuración solo en este perfil de prueba.
  await page.evaluate(async()=>{(await navigator.serviceWorker.getRegistration()).waiting.postMessage({type:'SKIP_WAITING'});});
  await page.waitForFunction(()=>navigator.serviceWorker.controller?.scriptURL.includes('r=6'));
  await page.waitForFunction(async()=>!!(await caches.keys()).find(key=>key.endsWith('-m7')));
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(()=>!!document.querySelector('#analytics-event-picker input[value="17"]'));
  assert.equal(await page.locator('#analytics-event-picker [data-options] input').count(),2);
  assert.equal(await page.evaluate(()=>localStorage.getItem('a33_cache_test_marker')),'conservar');
  const after = await page.evaluate(()=>caches.keys());
  for(const key of oldCaches) assert.ok(after.includes(key),'Conservar caché: ' + key);
  assert.equal(await page.evaluate(async()=>await (await caches.match('/marker')).text()),'conservar');
  const stored=await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('a33-pos');r.onsuccess=()=>{const db=r.result,q=db.transaction('sales').objectStore('sales').getAll();q.onsuccess=()=>{resolve(q.result);db.close();};};}));
  assert.equal(stored.length,1);assert.equal(stored[0].total,100);
  assert.deepStrictEqual(errors,[]);
  console.log('APROBADA caché E1: fallo reproducido, actualización con SW activo/en espera, selector y modal, activación aprobada y apertura offline; datos y cachés previas intactos.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
