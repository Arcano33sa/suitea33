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
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));

  const url=`http://127.0.0.1:${server.address().port}/finanzas/index.html`;
  browser=await playwright.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:1000}});
  const page=await context.newPage();page.setDefaultTimeout(10000); const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(url);await page.waitForFunction(()=>document.getElementById('recibos-editor')?.dataset.pendingBound==='1' && finDB && finCachedData);
  await page.evaluate(()=>document.querySelector('[data-view="recibos"]').click());
  await page.evaluate(async()=>{
    // Cuenta de cobro aislada y posteable para recorrer el formulario sin alterar el catálogo real.
    await finPut('accounts',{code:'1199',nombre:'Cuenta prueba E55',isPostable:true,accountMode:'postable',isActive:true,tipo:'activo'});
    await finPut('financialAccounts',{id:'test-e55-nio',nombreVisible:'Caja prueba E55',moneda:'NIO',type:'caja',cuentaContableCodigo:'1199',activa:true});
    finCachedData=await getAllFinData();rcNewDraft();
  });
  await page.locator('#rec-client').fill('Cliente E55');
  await page.locator('#rec-financial-account').selectOption('test-e55-nio');
  await page.locator('#rec-lines-tbody input[data-f="itemName"]').fill('Detalle pendiente');
  await page.locator('#rec-lines-tbody input[data-f="unitPrice"]').fill('100');
  await page.locator('#rec-lines-tbody input[data-f="qty"]').fill('');
  const original=await page.evaluate(()=>({key:rcDraftKey,raw:JSON.parse(localStorage.getItem(rcDraftKey))}));assert.equal(original.raw.rawLines[0].qty,'');
  await page.locator('#rec-cancel').click();assert.equal(await page.evaluate(()=>finGetAll('receipts').then(r=>r.length)),0);
  await page.reload();await page.waitForFunction(()=>document.getElementById('recibos-editor')?.dataset.pendingBound==='1' && finCachedData);
  assert.equal(await page.locator('#recibos-editor').isVisible(),false);
  await page.locator('[data-view="recibos"]').click();
  await page.locator('#rec-pending-panel summary').click();
  await page.locator('#rec-pending-list').getByRole('button',{name:'Recuperar',exact:true}).click();
  assert.equal(await page.locator('#rec-lines-tbody input[data-f="qty"]').inputValue(),'');
  assert.equal(await page.evaluate(()=>finGetAll('receipts').then(r=>r.length)),0);
  assert.equal(await page.evaluate(key=>!!localStorage.getItem(key),original.key),true);
  await page.locator('#rec-lines-tbody input[data-f="qty"]').fill('2');
  assert.equal(await page.evaluate(()=>rcSaveCurrent()),true);
  const saved=await page.evaluate(()=>finGetAll('receipts'));assert.equal(saved.length,1);assert.equal(saved[0].status,'DRAFT');assert.equal(saved[0].totals.total,200);
  await page.evaluate(id=>rcOpenReceiptById(id,'edit'),saved[0].receiptId);
  const second=await context.newPage();second.on('dialog',d=>d.accept());await second.goto(url);await second.waitForFunction(()=>document.getElementById('recibos-editor')?.dataset.pendingBound==='1' && finCachedData);
  await second.evaluate(async id=>{document.querySelector('[data-view="recibos"]').click();await rcLoadAll();rcOpenReceiptById(id,'edit');},saved[0].receiptId);
  await second.locator('#rec-client').fill('Versión atrasada');
  assert.equal(await page.evaluate(()=>rcIssueCurrent()),true);
  assert.equal(await second.evaluate(()=>rcSaveCurrent()),false);
  assert.match(await second.locator('#rec-alert').innerText(),/cambió/);
  assert.equal(await second.evaluate(()=>rcCurrent.status),'DRAFT');
  const issued=await page.evaluate(id=>finGet('receipts',id),saved[0].receiptId);assert.equal(issued.status,'ISSUED');assert.equal(issued.clientName,'Cliente E55');assert.equal(issued.number,'0001');
  // La comparación y el consecutivo se ejecutan bajo el bloqueo real de IndexedDB.
  const numbers=await page.evaluate(async()=>Promise.all(['concurrent-a','concurrent-b'].map(receiptId=>rcCommitReceipt({receiptId,status:'ISSUED'},null,'issue').then(r=>r.number))));assert.deepEqual(numbers,['0002','0003']);
  // Copia local fallida: mantiene formulario y última copia; cancelar puede rechazarse.
  await second.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith(RC_PENDING_PREFIX))throw Error('quota test');return window.originalSet.call(this,key,value);};});
  await second.locator('#rec-client').fill('Último cambio sin copia');assert.equal(await second.locator('#rec-pending-warning').isVisible(),true);
  second.removeAllListeners('dialog');second.on('dialog',d=>d.dismiss());await second.locator('#rec-cancel').click();assert.equal(await second.locator('#recibos-editor').isVisible(),true);
  await second.evaluate(()=>{Storage.prototype.setItem=window.originalSet;rcPersistPending();});
  page.removeAllListeners('dialog');page.on('dialog',d=>d.type()==='prompt'?d.accept('Motivo E55'):d.accept());
  await page.evaluate(async id=>{await rcLoadAll();await rcVoidReceiptById(id);},saved[0].receiptId);
  const voided=await page.evaluate(id=>finGet('receipts',id),saved[0].receiptId);assert.equal(voided.status,'VOID');assert.equal(voided.number,'0001');assert.equal(voided.voidReason,'Motivo E55');
  await page.evaluate(id=>rcReemitReceiptById(id),saved[0].receiptId);
  assert.equal(await page.evaluate(()=>rcCurrent.status),'DRAFT');assert.equal(await page.evaluate(()=>rcCurrent.number),null);
  assert.equal(await page.evaluate(()=>finGetAll('receipts').then(rows=>rows.length)),3,'Reemitir prepara el formulario sin registrar');
  assert.deepEqual(errors,[]);
  console.log('PASS Chrome E5.5: recuperación explícita, valores incompletos, guardado, emisión, pestaña atrasada, consecutivos concurrentes y fallo local conservador');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
