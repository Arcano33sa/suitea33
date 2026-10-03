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

 await page.goto(origin+'/configuracion/index.html');await page.locator('#cfg-tab-backup').click();const label=page.locator('#cfg-backup-last-export');assert.match(await label.textContent(),/Sin descargas registradas/);
 await page.evaluate(()=>localStorage.setItem('suite_a33_identity_v1',JSON.stringify({name:'E36'})));
 await page.locator('#cfg-export-backup').click();await page.getByRole('button',{name:'Descargar respaldo',exact:true}).waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('suite_a33_backup_last_export_v1')),null);await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(await page.evaluate(()=>localStorage.getItem('suite_a33_backup_last_export_v1')),null);
 await page.locator('#cfg-export-backup').click();const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar respaldo',exact:true}).click();const download=await pending;assert.match(await label.textContent(),/Tipo: Completo/);let record=await page.evaluate(()=>JSON.parse(localStorage.getItem('suite_a33_backup_last_export_v1')));assert.equal(record.filename,download.suggestedFilename());assert.equal(record.type,'full');
 await page.reload();await page.locator('#cfg-tab-backup').click();assert.match(await label.textContent(),/Tipo: Completo/);
 await page.locator('#cfg-export-custom-backup').click();await page.locator('[data-custom-export-part="configuracion:identidad"]').check();await page.getByRole('button',{name:'Exportar',exact:true}).click();const partialPending=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar personalizado',exact:true}).click();await partialPending;assert.match(await label.textContent(),/Personalizado parcial/);record=await page.evaluate(()=>JSON.parse(localStorage.getItem('suite_a33_backup_last_export_v1')));assert.equal(record.type,'partial');
 // Another tab changes its local tracking: visible card refreshes without a reload.
 const other=await context.newPage();await other.goto(origin+'/configuracion/index.html');await other.evaluate(()=>{const r=JSON.parse(localStorage.getItem('suite_a33_backup_last_export_v1'));r.type='recovery';r.preparedAt='2026-01-01T00:00:00Z';localStorage.setItem('suite_a33_backup_last_export_v1',JSON.stringify(r));});await label.getByText('Completo previo a importación',{exact:false}).waitFor();assert.match(await label.textContent(),/día\(s\)/);
 await other.evaluate(()=>localStorage.setItem('suite_a33_backup_last_export_v1','{bad'));await page.waitForFunction(()=>document.getElementById('cfg-backup-last-export').textContent.includes('no comprobable'));
 assert.deepEqual(errors,[]);console.log('PASS browser E3.6: preparar/cancelar sin fecha; descarga completa/parcial actualiza y persiste; cambios de otra pestaña y registro inválido visibles.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
