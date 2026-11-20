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
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}});
 const expenses=await context.newPage();const catalog=await context.newPage();const errors=[];
 for(const page of [expenses,catalog])page.on('pageerror',error=>errors.push(error.message));
 const supplierKey='a33_catalogos_proveedores_v1';
 await expenses.goto(origin+'/gastos/');
 assert.equal(await expenses.locator('#purchase-supplier').evaluate(el=>el.tagName),'SELECT');
 assert.equal(await expenses.locator('#purchase-supplier option').count(),1);
 assert.match(await expenses.locator('#supplier-status').textContent(),/No hay proveedores activos/);
 await expenses.evaluate(()=>localStorage.setItem('a33_catalogos_gastos_v1',JSON.stringify({version:1,categories:[{id:'h',name:'Higiene',active:true}],items:[{id:'g',name:'Guantes',categoryId:'h',presentation:'unit',unitPrice:10,active:true}]})));
 await expenses.reload();
 await catalog.goto(origin+'/catalogos/index.html#proveedores');
 await catalog.locator('#cat-supplier-name').fill('Proveedor Original');await catalog.locator('#cat-supplier-contact').fill('María');await catalog.locator('#cat-supplier-form button[type=submit]').click();
 const id=await catalog.evaluate(key=>JSON.parse(localStorage.getItem(key)).suppliers[0].id,supplierKey);
 await expenses.waitForFunction(()=>document.querySelectorAll('#purchase-supplier option').length===2);
 await expenses.locator('#purchase-supplier').selectOption(id);await expenses.locator('[data-field=itemId]').selectOption('g');
 await expenses.locator('#save-purchase').click();await expenses.waitForFunction(()=>document.getElementById('purchase-status').textContent.includes('Compra guardada'));
 const original=await expenses.evaluate(()=>JSON.parse(localStorage.getItem('a33_gastos_v1')).purchases[0]);
 assert.equal(original.supplierId,id);assert.equal(original.supplier,'Proveedor Original');
 // Un registro antiguo solo con nombre sigue legible sin asociación automática.
 await expenses.evaluate(()=>{const state=JSON.parse(localStorage.getItem('a33_gastos_v1'));const old={...state.purchases[0],id:'legacy',supplier:'Proveedor histórico libre'};delete old.supplierId;state.purchases.push(old);localStorage.setItem('a33_gastos_v1',JSON.stringify(state));});
 await expenses.locator('#clear-filters').click();assert.match(await expenses.locator('#purchase-history').innerText(),/Proveedor histórico libre/);
 await catalog.locator('[data-supplier-action=edit]').click();await catalog.locator('#cat-supplier-name').fill('Proveedor Renombrado');await catalog.locator('#cat-supplier-form button[type=submit]').click();
 await expenses.waitForFunction(()=>document.querySelector('#purchase-supplier').textContent.includes('Proveedor Renombrado'));
 assert.deepEqual(await expenses.evaluate(()=>JSON.parse(localStorage.getItem('a33_gastos_v1')).purchases[0]),original);
 await expenses.locator('#purchase-supplier').selectOption(id);await expenses.locator('[data-field=itemId]').selectOption('g');
 await catalog.locator('[data-supplier-action=toggle]').click();
 await expenses.waitForFunction(()=>document.getElementById('supplier-status').textContent.includes('ya no está activo'));
 await expenses.locator('#save-purchase').click();await expenses.waitForFunction(()=>document.getElementById('purchase-status').textContent.includes('no está activo'));
 assert.equal(await expenses.evaluate(()=>JSON.parse(localStorage.getItem('a33_gastos_v1')).purchases.length),2);
 await expenses.locator('#purchase-supplier').selectOption('');assert.equal(await expenses.locator('#purchase-supplier option').count(),1);
 await expenses.locator('#save-purchase').click();await expenses.waitForFunction(()=>JSON.parse(localStorage.getItem('a33_gastos_v1')).purchases.length===3);
 const noSupplier=await expenses.evaluate(()=>JSON.parse(localStorage.getItem('a33_gastos_v1')).purchases[2]);assert.equal(noSupplier.supplier,'');assert.equal(noSupplier.supplierId,null);
 await catalog.locator('[data-supplier-action=toggle]').click();await expenses.waitForFunction(()=>document.querySelectorAll('#purchase-supplier option').length===2);
 await expenses.locator('#purchase-supplier').selectOption(id);await expenses.locator('[data-field=itemId]').selectOption('g');
 const stored=await expenses.evaluate(()=>localStorage.getItem('a33_gastos_v1'));
 await catalog.evaluate(key=>localStorage.setItem(key,'{"version":99}'),supplierKey);
 await expenses.waitForFunction(()=>document.getElementById('supplier-status').textContent.includes('No se pudo leer'));
 await expenses.locator('#save-purchase').click();await expenses.waitForFunction(()=>document.getElementById('purchase-status').textContent.includes('formato incompatible'));
 assert.equal(await expenses.evaluate(()=>localStorage.getItem('a33_gastos_v1')),stored);
 await expenses.setViewportSize({width:390,height:844});assert(await expenses.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await expenses.locator('a[href="../catalogos/index.html#proveedores"]').click();await expenses.waitForURL('**/catalogos/index.html#proveedores');assert(await expenses.locator('#panel-proveedores').isVisible());
 assert.deepEqual(errors,[]);
 console.log('PASS E2: selector alimentado desde Catálogos, activos, actualización entre pestañas, snapshots e históricos libres, desactivación durante compra, opcional, fallos y botón de administración.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
