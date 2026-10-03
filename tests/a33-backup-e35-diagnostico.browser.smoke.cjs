'use strict';
// Navegador con contexto temporal y origen localhost aleatorio: nunca usa datos reales.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');
let playwright;
try{ playwright = require('playwright'); }
catch(_){ playwright = require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = path.resolve(__dirname,'..');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end();}else{res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}});
});
let browser;
(async()=>{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 browser=await playwright.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context=await browser.newContext({serviceWorkers:'block'});
 const origin='http://127.0.0.1:'+server.address().port;
 const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));

 await page.goto(origin+'/pos/index.html');await page.waitForFunction(()=>typeof put==='function' && typeof db!=='undefined' && !!db);await page.evaluate(async()=>{await put('products',{id:9351,productId:'e35',name:'Producto diagnóstico',price:10,isActive:true});localStorage.setItem('a33_e35_privado','NO MOSTRAR ESTE VALOR');});
 await page.goto(origin+'/configuracion/index.html');await page.locator('#cfg-tab-backup').click();
 // Compare complete read-only snapshots of values and schemas in isolated origin.
 const snapshot=async()=>page.evaluate(async()=>{const ls=Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]));const dbs={};for(const info of await indexedDB.databases()){const db=await new Promise(resolve=>{const r=indexedDB.open(info.name);r.onsuccess=()=>resolve(r.result);});const stores={};for(const name of db.objectStoreNames){stores[name]=await new Promise(resolve=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);});}dbs[info.name]={version:db.version,stores};db.close();}return {ls,dbs};});
 const before=await snapshot();await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('ESCRITURA NO AUTORIZADA');};Storage.prototype.removeItem=()=>{throw Error('BORRADO NO AUTORIZADO');};IDBObjectStore.prototype.put=()=>{throw Error('PUT NO AUTORIZADO');};IDBObjectStore.prototype.clear=()=>{throw Error('CLEAR NO AUTORIZADO');};});
 await page.locator('#cfg-storage-diagnostic').click();await page.getByRole('button',{name:'Cerrar',exact:true}).waitFor();
 const text=await page.locator('#backup-modal-body').textContent();assert.match(text,/localStorage:.*Lectura disponible/);assert.match(text,/products:.*registros/);assert.match(text,/Cuota del sitio/);assert(!text.includes('NO MOSTRAR ESTE VALOR'));assert.deepEqual(await snapshot(),before);
 await page.locator('#backup-modal-primary').click();await page.evaluate(()=>{IDBObjectStore.prototype.count=function(){throw Error('count e35 falló');};});await page.locator('#cfg-storage-diagnostic').click();await page.getByRole('button',{name:'Cerrar',exact:true}).waitFor();assert.match(await page.locator('#backup-modal-body').textContent(),/IndexedDB:.*Error de lectura/);assert.match(await page.locator('#backup-modal-body').textContent(),/count e35/);
 assert.deepEqual(await snapshot(),before);assert.deepEqual(errors,[]);console.log('PASS browser E3.5: reporte real y fallo count visibles; almacenamiento completo idéntico antes/después con escrituras prohibidas.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
