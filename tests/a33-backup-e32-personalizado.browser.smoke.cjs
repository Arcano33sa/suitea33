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

 await page.goto(origin+'/configuracion/index.html');
 await page.evaluate(async()=>{
  localStorage.setItem('arcano33_produccion_checklists',JSON.stringify({literal:'A330xX119TEV5786'}));
  await new Promise((resolve,reject)=>{const req=indexedDB.open('finanzasDB',10);req.onupgradeneeded=()=>{for(const name of ['accounts','financialAccounts','payableItems'])req.result.createObjectStore(name,{keyPath:'id'});};req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result;const tx=db.transaction(['accounts','financialAccounts','payableItems'],'readwrite');for(const name of ['accounts','financialAccounts','payableItems'])tx.objectStore(name).put({id:1,marker:name});tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});
 });
 await page.locator('#cfg-tab-backup').click();await page.locator('#cfg-export-custom-backup').click();
 for(const part of ['finanzas:bancosCuentas','inventario:calculadoraProduccion','agenda:agenda'])await page.locator('[data-custom-export-part="'+part+'"]').check();
 assert.match(await page.locator('#cfg-custom-export-dependencies').textContent(),/Materia Prima/);
 await page.getByRole('button',{name:'Exportar',exact:true}).click();
 await page.getByRole('button',{name:'Descargar personalizado',exact:true}).waitFor();
 assert.match(await page.locator('#backup-modal-body').textContent(),/listas históricas/);
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar personalizado',exact:true}).click();
 const download=await downloading;const stream=await download.createReadStream();let text='';for await(const chunk of stream)text+=chunk.toString();
 const backup=JSON.parse(text);assert.equal(backup.meta.schemaVersion,7);assert.equal(backup.meta.backupType,'partial');
 assert.deepEqual(Object.keys(backup.data.indexedDB.finanzasDB).sort(),['accounts','financialAccounts']);
 assert.equal(JSON.parse(backup.data.localStorage.arcano33_produccion_checklists).literal,'A330xX119TEV5786');
 assert(!backup.data.indexedDB.finanzasDB.payableItems);assert(!backup.data.localStorage.arcano33_lotes);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('arcano33_produccion_checklists')).literal),'A330xX119TEV5786');
 assert.deepEqual(errors,[]);console.log('PASS browser E3.2: selección UI, avisos y JSON parcial real, sin inclusión automática ni cambios en datos temporales.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
