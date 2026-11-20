'use strict';
// Contexto desechable y localhost aleatorio: no utiliza datos del usuario.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = path.resolve(__dirname, '..');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, data) => {
    res.writeHead(error ? 404 : 200, { 'Content-Type':types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' });
    res.end(error ? '' : data);
  });
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await playwright.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900},timezoneId:'America/Managua'});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/gastos/');
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('a33-pos',1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      for(const store of ['sales','events','products','reempaques'])db.createObjectStore(store,{keyPath:'id'});
    };
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result;const tx=db.transaction(['sales','events','products','reempaques'],'readwrite');
      tx.objectStore('sales').put({id:1,date:'2026-11-10',eventId:1,eventName:'Feria A',productId:'p',productName:'Producto',qty:1,unitPrice:10000,total:10000,lineCost:4000,payment:'tarjeta',commissionAmountSnapshot:150,commissionLabelSnapshot:'Comisión histórica'});
      tx.objectStore('sales').put({id:2,date:'2026-11-10',eventId:1,productId:'p',productName:'Producto',qty:1,unitPrice:500,total:0,lineCost:200,courtesy:true});
      tx.objectStore('events').put({id:1,name:'Feria A',groupName:'Ferias'});
      tx.objectStore('events').put({id:2,name:'Feria B',groupName:'Otros'});
      tx.objectStore('products').put({id:'p',productId:'p',name:'Producto',active:true});
      tx.objectStore('reempaques').put({id:'m',date:'2026-11-10',eventId:1,tipo:'REEMPAQUE_MERMA_FINAL_EVENTO',mermaFinalMl:100,costoMermaFinal:50,costReliable:true});
      tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
    };
  }));
  await page.evaluate(()=>{
    localStorage.setItem('a33_catalogos_gastos_v1',JSON.stringify({version:1,categories:[{id:'h',name:'Higiene',active:true}],items:[{id:'g',name:'Guantes',categoryId:'h',presentation:'box',boxPrice:500,unitsPerBox:100,active:true}]}));
  });
  await page.reload();
  await page.locator('#purchase-date').fill('2026-11-10');await page.locator('[data-field=itemId]').selectOption('g');await page.locator('[data-field=quantity]').fill('3');await page.locator('#save-purchase').click();
  await page.waitForFunction(()=>document.getElementById('purchase-status').textContent.includes('Compra guardada'));
  const expenses=page;const analytics=await context.newPage();analytics.on('pageerror',error=>errors.push(error.message));
  await analytics.goto(origin+'/analitica/');
  await analytics.locator('#period-select').selectOption('custom');
  await analytics.locator('#date-from').fill('2026-11-01');await analytics.locator('#date-from').dispatchEvent('change');
  await analytics.locator('#date-to').fill('2026-11-30');await analytics.locator('#date-to').dispatchEvent('change');
  await analytics.waitForFunction(()=>document.getElementById('kpi-total-ventas').textContent.includes('10,000'));
  assert.match(await analytics.locator('#kpi-utilidad-despues-merma').textContent(),/5,600/);
  assert.match(await analytics.locator('#kpi-gastos-generales').textContent(),/1,500/);
  assert.match(await analytics.locator('#kpi-utilidad-neta').textContent(),/4,100/);
  assert.strictEqual(await analytics.locator('#analytics-general-expenses-card').isVisible(),true);
  assert.strictEqual(await analytics.locator('#analytics-net-profit-card').isVisible(),true);
  assert.strictEqual(await analytics.locator('#analytics-general-expenses-card .kpi-sub').count(),0);
  assert.strictEqual(await analytics.locator('#analytics-general-expenses-card p').count(),2);
  // Un evento, un grupo o una selección vacía no absorben compras generales.
  const picker=analytics.locator('#analytics-event-picker');
  await picker.locator('summary').click();await picker.locator('[data-clear]').click();
  await picker.locator('input[value="1"]').check();
  assert.strictEqual(await analytics.locator('#analytics-general-expenses-card').isVisible(),false);
  assert.strictEqual(await analytics.locator('#analytics-net-profit-card').isVisible(),false);
  assert.match(await analytics.locator('#kpi-utilidad-despues-merma').textContent(),/5,600/);
  await picker.locator('input[value="1"]').uncheck();
  assert.strictEqual(await analytics.locator('#analytics-net-profit-card').isVisible(),false);
  await picker.locator('[data-group]').selectOption('group:Ferias');
  assert.strictEqual(await analytics.locator('#analytics-general-expenses-card').isVisible(),false);
  await picker.locator('[data-group]').selectOption('all');
  assert.strictEqual(await analytics.locator('#analytics-net-profit-card').isVisible(),true);
  // Una compra nueva actualiza el resumen abierto mediante storage.
  await expenses.locator('#purchase-date').fill('2026-11-20');await expenses.locator('[data-field=itemId]').selectOption('g');await expenses.locator('#save-purchase').click();
  await analytics.waitForFunction(()=>document.getElementById('kpi-gastos-generales').textContent.includes('2,000'));
  assert.match(await analytics.locator('#kpi-utilidad-neta').textContent(),/3,600/);
  // Límite inclusivo de fecha; compras sin ventas generan una pérdida.
  await analytics.locator('#date-from').fill('2026-11-20');await analytics.locator('#date-from').dispatchEvent('change');
  await analytics.locator('#date-to').fill('2026-11-20');await analytics.locator('#date-to').dispatchEvent('change');
  assert.match(await analytics.locator('#kpi-gastos-generales').textContent(),/500/);
  assert.match(await analytics.locator('#kpi-utilidad-neta').textContent(),/-500/);
  await analytics.locator('#date-from').fill('2026-11-01');await analytics.locator('#date-from').dispatchEvent('change');
  await analytics.locator('#date-to').fill('2026-11-30');await analytics.locator('#date-to').dispatchEvent('change');
  const original=await analytics.evaluate(()=>localStorage.getItem('a33_gastos_v1'));
  await expenses.evaluate(()=>localStorage.setItem('a33_gastos_v1','{"version":99}'));
  await analytics.waitForFunction(()=>document.getElementById('kpi-utilidad-neta').textContent==='No disponible');
  assert.strictEqual(await analytics.locator('#analytics-expenses-status').isVisible(),true);
  assert.match(await analytics.locator('#kpi-utilidad-despues-merma').textContent(),/5,600/);
  await expenses.evaluate(raw=>localStorage.setItem('a33_gastos_v1',raw),original);
  await analytics.waitForFunction(()=>document.getElementById('kpi-utilidad-neta').textContent.includes('3,600'));
  assert.strictEqual(await analytics.locator('#analytics-expenses-status').isVisible(),false);
  assert.strictEqual(await analytics.evaluate(()=>localStorage.getItem('a33_gastos_v1')),original);
  await analytics.setViewportSize({width:390,height:844});await analytics.evaluate(()=>window.scrollTo(0,0));
  assert.strictEqual(await analytics.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await analytics.screenshot({path:'/tmp/a33-analitica-e4-mobile.png',fullPage:true});
  await analytics.setViewportSize({width:1280,height:900});await analytics.evaluate(()=>window.scrollTo(0,0));
  await analytics.screenshot({path:'/tmp/a33-analitica-e4-desktop.png',fullPage:true});
  assert.deepStrictEqual(errors,[]);
  console.log('PASS E4: compras reales, utilidad previa/neta, gastos por período, evento/grupo/selección vacía, actualización entre pestañas, pérdida, fallo y recuperación, historial intacto, móvil.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
