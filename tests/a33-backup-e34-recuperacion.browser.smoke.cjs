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

 await page.goto(origin+'/pos/index.html');await page.waitForFunction(()=>typeof put==='function' && typeof db!=='undefined' && !!db);
 await page.evaluate(async()=>{await put('events',{id:9340,name:'Evento previo'});localStorage.setItem('a33_e34_original','anterior');});
 await page.goto(origin+'/configuracion/index.html');await page.locator('#cfg-tab-backup').click();page.on('dialog',d=>d.accept());
 const file={meta:{appName:'Suite A33',backupType:'full'},data:{indexedDB:{'a33-pos':{events:[{id:934999,name:'nuevo'}]}},localStorage:{a33_e34_original:'nuevo'}}};
 const upload=()=>page.locator('#backup-file-input').setInputFiles({name:'e34.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});
 const jsonDownload=async(button)=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:button,exact:true}).click();const stream=await(await pending).createReadStream();let text='';for await(const chunk of stream)text+=chunk.toString();return JSON.parse(text);};
 // Mandatory gate: failure preparing recovery blocks import before mutation.
 await page.evaluate(()=>{window.__originalDatabases=indexedDB.databases.bind(indexedDB);indexedDB.databases=async()=>{throw Error('respaldo previo bloqueado');};});
 await upload();await page.getByRole('button',{name:'Importar y reemplazar',exact:true}).click();await page.waitForFunction(()=>document.getElementById('backup-modal-title').textContent==='Importación bloqueada');assert.equal(await page.evaluate(()=>localStorage.getItem('a33_e34_original')),'anterior');await page.locator('#backup-modal-primary').click();
 await page.evaluate(()=>{indexedDB.databases=window.__originalDatabases;});
 await upload();await page.getByRole('button',{name:'Importar y reemplazar',exact:true}).click();const recovery=await jsonDownload('Descargar respaldo previo');
 assert.equal(recovery.meta.backupType,'full');assert.equal(recovery.data.localStorage.a33_e34_original,'anterior');assert(recovery.data.indexedDB['a33-pos'].events.some(row=>row.id===9340));
 assert.equal(await page.evaluate(()=>localStorage.getItem('a33_e34_original')),'anterior');
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='events')throw Error('put e34 falló');return put.apply(this,args);};});
 await page.getByRole('button',{name:'Continuar importación',exact:true}).click();await page.waitForFunction(()=>document.getElementById('backup-modal-title').textContent==='Error de importación');assert.match(await page.locator('#backup-modal-body').textContent(),/a33-pos.*events/);
 const second=await jsonDownload('Descargar respaldo previo');assert.deepEqual(second,recovery);
 const events=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('a33-pos');r.onsuccess=()=>resolve(r.result);});const rows=await new Promise(resolve=>{const r=db.transaction('events').objectStore('events').getAll();r.onsuccess=()=>resolve(r.result);});db.close();return rows;});assert(events.some(row=>row.id===9340));assert(!events.some(row=>row.id===934999));
 assert.equal(await page.evaluate(()=>localStorage.getItem('a33_e34_original')),'anterior');assert.equal(await page.evaluate(()=>localStorage.getItem('suite_a33_backup_last_import_file')),null);

 // Partial import: a later localStorage failure must not report success after an earlier store committed.
 await page.reload();await page.locator('#cfg-tab-backup').click();file.meta.backupType='partial';await upload();
 await page.getByRole('button',{name:'Importar parcial',exact:true}).click();const partialRecovery=await jsonDownload('Descargar respaldo previo');assert.equal(partialRecovery.data.localStorage.a33_e34_original,'anterior');
 await page.evaluate(()=>{const set=A33Storage.setItem.bind(A33Storage);A33Storage.setItem=(key,value,...rest)=>key==='a33_e34_original'?false:set(key,value,...rest);});
 await page.getByRole('button',{name:'Continuar importación',exact:true}).click();await page.waitForFunction(()=>document.getElementById('backup-modal-title').textContent==='Error de importación');
 assert.match(await page.locator('#backup-modal-body').textContent(),/localStorage.*a33_e34_original/);assert.match(await page.locator('#backup-modal-body').textContent(),/bloques anteriores/);assert.equal(await page.evaluate(()=>localStorage.getItem('a33_e34_original')),'anterior');
 assert.deepEqual(await jsonDownload('Descargar respaldo previo'),partialRecovery);
 assert.deepEqual(errors,[]);console.log('PASS browser E3.4: lectura previa fallida bloquea importación; descarga previa precede escrituras; put fallido aborta reemplazo, muestra error y permite recuperar el mismo respaldo.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
