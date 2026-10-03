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
 await page.evaluate(async()=>{await put('products',{id:9301,productId:'backup-e31',name:'Producto respaldo',price:100,isActive:true});A33Storage.sharedSet('arcano33_lotes',[{id:'e31',codigo:'A330xX119TEV5786'}],{source:'test'});});
 await page.goto(origin+'/configuracion/index.html');await page.locator('#cfg-tab-backup').click();
 await page.locator('#cfg-export-backup').click();
 await page.getByRole('button',{name:'Descargar respaldo',exact:true}).waitFor();
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar respaldo',exact:true}).click();
 const download=await downloading;assert.match(download.suggestedFilename(),/^suitea33-backup-.*\.json$/);
 const stream=await download.createReadStream();let text='';for await(const chunk of stream)text+=chunk.toString();
 const backup=JSON.parse(text);assert.equal(backup.meta.backupType,'full');assert.equal(backup.meta.schemaVersion,8);
 assert(backup.data.indexedDB['a33-pos'].products.some(p=>p.productId==='backup-e31'));
 assert.equal(JSON.parse(backup.data.localStorage.arcano33_lotes)[0].codigo,'A330xX119TEV5786');
 assert.equal(await page.evaluate(()=>A33Storage.sharedGet('arcano33_lotes',[])[0].codigo),'A330xX119TEV5786');
 let unexpectedDownloads=0;page.on('download',()=>unexpectedDownloads++);
 // Inyección de fallo de enumeración: no hay botón de descarga.
 await page.evaluate(()=>{indexedDB.databases=async()=>{throw new Error('enumeracion-e31');};});
 await page.locator('#cfg-export-backup').click();
 await page.waitForFunction(()=>document.getElementById('backup-modal-title').textContent==='Error');
 assert.match(await page.locator('#backup-modal-body').textContent(),/IndexedDB.*enumeracion-e31/);
 assert.equal(await page.getByRole('button',{name:'Descargar respaldo',exact:true}).count(),0);
 await page.locator('#backup-modal-primary').click();
 await page.reload();await page.locator('#cfg-tab-backup').click();
 // Fallo de lectura real del almacén sin afectar los registros.
 await page.evaluate(()=>{const getAll=IDBObjectStore.prototype.getAll;IDBObjectStore.prototype.getAll=function(...args){if(this.name==='products')throw new Error('products-e31');return getAll.apply(this,args);};});
 await page.locator('#cfg-export-backup').click();
 await page.waitForFunction(()=>document.getElementById('backup-modal-title').textContent==='Error');
 assert.match(await page.locator('#backup-modal-body').textContent(),/a33-pos.*products.*products-e31/);
 assert.equal(await page.getByRole('button',{name:'Descargar respaldo',exact:true}).count(),0);
 await page.locator('#backup-modal-primary').click();
 await page.reload();await page.locator('#cfg-tab-backup').click();
 await page.evaluate(()=>{localStorage.setItem('a33_e31_failed_read','dato aislado');const getItem=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key==='a33_e31_failed_read')throw Error('local-e31');return getItem.call(this,key);};});
 await page.locator('#cfg-export-backup').click();
 await page.waitForFunction(()=>document.getElementById('backup-modal-title').textContent==='Error');
 assert.match(await page.locator('#backup-modal-body').textContent(),/localStorage.*a33_e31_failed_read/);
 assert.equal(await page.getByRole('button',{name:'Descargar respaldo',exact:true}).count(),0);
 assert.equal(unexpectedDownloads,0);assert.deepEqual(errors,[]);
 console.log('PASS browser E3.1: respaldo completo descargable y compatible; listado, store y localStorage fallidos bloquean descarga e identifican origen; datos temporales intactos.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
