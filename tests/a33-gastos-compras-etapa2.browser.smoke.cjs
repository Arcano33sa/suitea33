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
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context = await browser.newContext({viewport:{width:1280,height:900},timezoneId:'America/Managua'});
  const page = await context.newPage();
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  const key='a33_gastos_v1', catalogKey='a33_catalogos_gastos_v1';
  await page.goto(origin+'/gastos/');
  assert.match(await page.locator('#catalog-status').innerText(),/No hay artículos/);
  await page.evaluate(catalogKey=>{
    localStorage.setItem('a33_test_existing_finance','sin cambios');
    localStorage.setItem(catalogKey,JSON.stringify({version:1,categories:[{id:'h',name:'Higiene',active:true},{id:'x',name:'Inactiva',active:false}],items:[
      {id:'g',name:'Guantes',categoryId:'h',active:true,presentation:'both',unitPrice:3.5,boxPrice:300,unitsPerBox:100},
      {id:'c',name:'Gorros',categoryId:'h',active:true,presentation:'unit',unitPrice:2},
      {id:'off',name:'Artículo inactivo',categoryId:'h',active:false,presentation:'unit',unitPrice:5},
      {id:'offcat',name:'Categoría inactiva',categoryId:'x',active:true,presentation:'unit',unitPrice:5}
    ]}));
  },catalogKey);
  await page.reload();
  assert.equal(await page.locator('[data-field=itemId] option').count(),3);
  await page.locator('#purchase-date').fill('2026-11-10');
  await page.locator('#purchase-supplier').fill('Proveedor de prueba');
  await page.locator('#purchase-reference').fill('Factura 001');
  await page.locator('#purchase-note').fill('Compra general');
  await page.locator('[data-field=itemId]').selectOption('g');
  await page.locator('[data-field=presentation]').selectOption('box');
  assert.equal(await page.locator('[data-field=price]').inputValue(),'300');
  await page.locator('[data-field=quantity]').fill('2');
  await page.locator('[data-field=price]').fill('280.25');
  await page.locator('#add-line').click();
  await page.locator('[data-field=itemId]').nth(1).selectOption('c');
  await page.locator('[data-field=quantity]').nth(1).fill('20');
  assert.match(await page.locator('#draft-total').innerText(),/600[.,]50/);
  await page.locator('#save-purchase').click();
  await page.waitForFunction(()=>document.getElementById('purchase-status').textContent.includes('Compra guardada'));
  const read=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
  const first=(await read()).purchases[0];
  assert.equal(first.totalCents,60050);
  assert.equal(first.lines[0].unitPriceCents,28025);
  assert.equal(first.lines[0].unitsPerBox,100);
  assert.equal(first.lines[1].categoryName,'Higiene');
  assert.equal(first.supplier,'Proveedor de prueba');
  await page.locator('#clear-filters').click();
  assert.equal(await page.locator('.purchase').count(),1);
  await page.locator('.purchase summary').click();
  assert.match(await page.locator('.purchase').innerText(),/Guantes/);
  // Modificar precios, nombres y estados en el catálogo real: el historial queda intacto.
  await page.evaluate(catalogKey=>{const catalog=JSON.parse(localStorage.getItem(catalogKey));catalog.items[0].name='Guantes nuevo nombre';catalog.items[0].boxPrice=999;catalog.items[0].unitsPerBox=200;catalog.categories[0].name='Protección';localStorage.setItem(catalogKey,JSON.stringify(catalog));},catalogKey);
  await page.reload();
  assert.deepEqual((await read()).purchases[0],first);
  await page.locator('#clear-filters').click();
  await page.locator('.purchase summary').click();
  assert.match(await page.locator('.purchase').innerText(),/Higiene/);
  assert.doesNotMatch(await page.locator('.purchase').innerText(),/nuevo nombre/);
  // Dos pestañas guardan sin perder compras: la escritura relee bajo un lock.
  const other=await context.newPage();
  await other.goto(origin+'/gastos/');
  for(const [tab,date] of [[page,'2026-10-01'],[other,'2026-11-20']]){
    await tab.locator('#purchase-date').fill(date);
    await tab.locator('[data-field=itemId]').selectOption('c');
    await tab.locator('[data-field=quantity]').fill('3');
  }
  await Promise.all([page.locator('#save-purchase').click(),other.locator('#save-purchase').click()]);
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).purchases.length===3,key);
  assert.equal(new Set((await read()).purchases.map(row=>row.id)).size,3);
  await page.locator('#filter-from').fill('2026-11-01');
  await page.locator('#filter-to').fill('2026-11-30');
  await page.locator('#filters button[type=submit]').click();
  assert.equal(await page.locator('.purchase').count(),2);
  assert.match(await page.locator('#history-total').innerText(),/606[.,]50/);
  await page.locator('#filter-search').fill('higiéne');
  await page.locator('#filters button[type=submit]').click();
  assert.equal(await page.locator('.purchase').count(),1);
  await page.locator('#filter-from').fill('2026-12-01');
  await page.locator('#filters button[type=submit]').click();
  assert.match(await page.locator('#history-status').innerText(),/rango de fechas/);
  // Guardado fallido no vacía formulario ni altera compras.
  await page.locator('[data-field=itemId]').selectOption('g');
  await page.locator('[data-field=quantity]').fill('1.5');
  await page.locator('#purchase-form').dispatchEvent('submit');
  assert.match(await page.locator('#purchase-status').innerText(),/entero mayor/);
  await page.locator('[data-field=quantity]').fill('1');
  await page.locator('[data-field=price]').fill('-1');
  await page.locator('#purchase-form').dispatchEvent('submit');
  assert.match(await page.locator('#purchase-status').innerText(),/precios válidos/);
  await page.locator('[data-field=price]').fill('5');
  const beforeFailure=await read();
  await page.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='a33_gastos_v1')throw new Error('Almacenamiento lleno');return window.originalSet.call(this,key,value);};});
  await page.locator('#save-purchase').click();
  await page.waitForFunction(()=>document.getElementById('purchase-status').textContent.includes('Almacenamiento lleno'));
  assert.deepEqual(await read(),beforeFailure);
  assert.equal(await page.locator('[data-field=itemId]').inputValue(),'g');
  await page.evaluate(()=>{Storage.prototype.setItem=window.originalSet;});
  await page.locator('#clear-filters').click();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'/tmp/a33-gastos-e2-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'/tmp/a33-gastos-e2-desktop.png',fullPage:true});
  // Una compra con totales alterados se preserva y bloquea escrituras.
  const corrupted = structuredClone(beforeFailure);
  corrupted.purchases[0].lines[0].totalCents++;
  await page.evaluate(({key,state})=>localStorage.setItem(key,JSON.stringify(state)),{key,state:corrupted});
  await page.locator('#save-purchase').click();
  await page.waitForFunction(()=>document.getElementById('purchase-status').textContent.includes('formato incompatible'));
  assert.deepEqual(await read(),corrupted);
  // Historial incompatible no puede sobrescribirse al guardar una compra.
  await page.evaluate(key=>localStorage.setItem(key,'{"version":99}'),key);
  await page.locator('#save-purchase').click();
  await page.waitForFunction(()=>document.getElementById('purchase-status').textContent.includes('formato incompatible'));
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),'{"version":99}');
  assert.equal(await page.evaluate(()=>localStorage.getItem('a33_test_existing_finance')),'sin cambios');
  await page.goto(origin+'/');
  const links=await page.locator('[aria-labelledby="menu-group-2"] article').evaluateAll(nodes=>nodes.map(node=>node.dataset.link));
  assert.deepEqual(links,['finanzas/index.html#tab=tablero','gastos/index.html','analitica/index.html','finanzas/index.html#tab=cajachica','exportaciones/index.html','catalogos/index.html']);
  await page.locator('a[aria-label="Abrir Gastos"]').click();
  await page.waitForURL('**/gastos/index.html');
  assert.deepEqual(errors,[]);
  console.log('PASS E2: compra multiartículo, importes exactos, historial, snapshots, filtros, concurrencia, errores de guardado, móvil, acceso y orden en Inicio.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
