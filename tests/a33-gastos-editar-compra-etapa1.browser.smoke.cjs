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
    localStorage.setItem('a33_catalogos_proveedores_v1',JSON.stringify({version:1,suppliers:[{id:'provider-test',name:'Proveedor de prueba',contact:'',phone:'',note:'',active:true}]}));
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
  await page.locator('#purchase-supplier').selectOption('provider-test');
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
  // Editar compra completa: cancelar, quitar, agregar y mantener identidad.
  await page.locator('[data-edit]').click();
  assert.equal(await page.locator('#new-title').innerText(),'Editar compra');
  await page.locator('[data-remove]').nth(1).click();
  await page.locator('#cancel-edit').click();
  assert.deepEqual((await read()).purchases[0],first);
  // Catálogo y proveedor inactivos: conservar snapshots históricos.
  await page.evaluate(()=>{
    const c=JSON.parse(localStorage.getItem('a33_catalogos_gastos_v1'));
    c.items[0].active=false;c.items[0].name='Otro nombre';c.items[0].unitsPerBox=200;
    localStorage.setItem('a33_catalogos_gastos_v1',JSON.stringify(c));
    const p=JSON.parse(localStorage.getItem('a33_catalogos_proveedores_v1'));p.suppliers[0].active=false;
    localStorage.setItem('a33_catalogos_proveedores_v1',JSON.stringify(p));
  });
  await page.locator('[data-edit]').click();
  assert.equal(await page.locator('[data-field=price]').first().inputValue(),'280.25');
  await page.locator('[data-remove]').nth(1).click();
  await page.locator('[data-field=quantity]').fill('1');
  await page.locator('#purchase-date').fill('2026-11-11');
  await page.locator('#purchase-reference').fill('Corregida');
  await page.locator('#add-line').click();
  await page.locator('[data-field=itemId]').nth(1).selectOption('c');
  await page.locator('#save-purchase').click();
  await page.waitForFunction(()=>document.getElementById('purchase-status').textContent.includes('actualizada'));
  let edited=(await read()).purchases[0];
  assert.equal((await read()).purchases.length,1);
  assert.equal(edited.id,first.id);assert.equal(edited.createdAt,first.createdAt);
  assert.equal(edited.lines[0].articleName,'Guantes');assert.equal(edited.lines[0].unitsPerBox,100);
  assert.equal(edited.supplier,first.supplier);assert.equal(edited.totalCents,28225);
  assert.equal(edited.reference,'Corregida');assert.equal(edited.date,'2026-11-11');
  // No guardar compra vacía.
  await page.locator('.purchase summary').click();
  await page.locator('[data-edit]').click();
  await page.locator('[data-remove]').first().click();await page.locator('[data-remove]').first().click();
  await page.locator('#save-purchase').click();
  assert.match(await page.locator('#purchase-status').innerText(),/al menos un artículo/);
  assert.deepEqual((await read()).purchases[0],edited);
  await page.locator('#cancel-edit').click();
  // Conflicto entre pestañas y fallo de almacenamiento preservan datos y formulario.
  await page.locator('[data-edit]').click();
  const other=await context.newPage();await other.goto(origin+'/gastos/');
  await other.evaluate(key=>{const s=JSON.parse(localStorage.getItem(key));s.purchases[0].note='Cambio externo';localStorage.setItem(key,JSON.stringify(s));},key);
  await page.locator('#save-purchase').click();
  await page.waitForFunction(()=>document.getElementById('purchase-status').textContent.includes('otra pestaña'));
  assert.equal((await read()).purchases[0].note,'Cambio externo');
  await page.locator('#cancel-edit').click();
  await page.locator('.purchase summary').click();await page.locator('[data-edit]').click();
  await page.locator('#purchase-note').fill('Corrección');
  await page.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='a33_gastos_v1')throw new Error('Almacenamiento lleno');return window.originalSet.call(this,k,v);};});
  await page.locator('#save-purchase').click();
  await page.waitForFunction(()=>document.getElementById('purchase-status').textContent.includes('Almacenamiento lleno'));
  assert.equal(await page.locator('#purchase-note').inputValue(),'Corrección');
  assert.equal((await read()).purchases[0].note,'Cambio externo');
  await page.evaluate(()=>Storage.prototype.setItem=window.originalSet);
  await page.locator('#save-purchase').click();
  await page.waitForFunction(()=>document.getElementById('purchase-status').textContent.includes('actualizada'));
  await page.setViewportSize({width:390,height:844});
  await page.locator('.purchase summary').click();await page.locator('[data-edit]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/tmp/a33-gastos-editar-e1-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS E1: editar compra completa, cancelar, quitar/agregar, snapshots inactivos, identidad, vacío, conflicto, fallo y móvil.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
