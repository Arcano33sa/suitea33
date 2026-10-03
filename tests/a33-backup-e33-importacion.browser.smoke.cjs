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
 await page.evaluate(async()=>{await put('rawMaterials',{id:9303,name:'Materia prima E3.3',unit:'kg'});await put('products',{id:9303,productId:'e33-preservar',name:'Producto E3.3',price:100,isActive:true});localStorage.setItem('a33_e33_preservar','intacto');});
 await page.goto(origin+'/configuracion/index.html');await page.locator('#cfg-tab-backup').click();
 const base={meta:{appName:'Suite A33',backupType:'full'},data:{indexedDB:{'a33-pos':{events:[{id:9303,name:'Evento histórico importado',date:'2026-10-02'}]}},localStorage:{}}};
 const upload=async obj=>page.locator('#backup-file-input').setInputFiles({name:'e33.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(obj))});
 const bad=JSON.parse(JSON.stringify(base));bad.data.indexedDB['a33-pos'].events={};await upload(bad);
 await page.waitForFunction(()=>document.getElementById('backup-modal-title').textContent==='Error');
 assert.match(await page.locator('#backup-modal-body').textContent(),/a33-pos.*events.*lista/);await page.locator('#backup-modal-primary').click();
 page.on('dialog',dialog=>dialog.accept());await upload(base);
 await page.getByRole('button',{name:'Importar y reemplazar',exact:true}).waitFor();await page.getByRole('button',{name:'Importar y reemplazar',exact:true}).click();
 await page.getByRole('button',{name:'Descargar respaldo previo',exact:true}).click();
 await page.getByRole('button',{name:'Continuar importación',exact:true}).click();
 await page.waitForFunction(()=>/Importación|Importado|Importado correctamente/i.test(document.getElementById('backup-modal-title').textContent)&&document.getElementById('backup-modal-title').textContent!=='Importando...');
 const result=await page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('a33-pos');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  const read=store=>new Promise((resolve,reject)=>{const req=db.transaction(store,'readonly').objectStore(store).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  const data={materials:await read('rawMaterials'),products:await read('products'),events:await read('events'),local:localStorage.getItem('a33_e33_preservar')};db.close();return data;
 });
 assert(result.materials.some(row=>row.id===9303));assert(result.products.some(row=>row.productId==='e33-preservar'));assert(result.events.some(row=>row.id===9303));assert.equal(result.local,'intacto');assert.deepEqual(errors,[]);
 console.log('PASS browser E3.3: archivo malformado bloqueado; importación histórica real conserva Materia Prima, Productos y claves ausentes.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
