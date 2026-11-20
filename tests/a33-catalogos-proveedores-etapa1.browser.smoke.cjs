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
 const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const key='a33_catalogos_proveedores_v1';
 const read=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
 await page.goto(origin+'/catalogos/');await page.locator('#tab-proveedores').click();
 assert.match(await page.locator('#cat-suppliers-list').innerText(),/No hay proveedores/);
 await page.locator('#cat-supplier-name').fill('Distribuidora Ejemplo');
 await page.locator('#cat-supplier-contact').fill('María López');
 await page.locator('#cat-supplier-phone').fill('+505 8888-8888');
 await page.locator('#cat-supplier-note').fill('Atiende por WhatsApp');
 await page.locator('#cat-supplier-form button[type=submit]').click();
 const original=(await read()).suppliers[0];
 assert.equal(original.contact,'María López');assert.equal(original.phone,'+505 8888-8888');assert.equal(original.active,true);
 await page.locator('#cat-supplier-name').fill(' distribuidóra ejemplo ');
 await page.locator('#cat-supplier-form button[type=submit]').click();
 assert.match(await page.locator('#cat-supplier-status').innerText(),/Ya existe/);assert.equal((await read()).suppliers.length,1);
 await page.locator('[data-supplier-action=edit]').click();
 await page.locator('#cat-supplier-name').fill('Distribuidora Actualizada');
 await page.locator('#cat-supplier-form button[type=submit]').click();
 assert.equal((await read()).suppliers[0].id,original.id);
 assert.equal((await read()).suppliers[0].createdAt,original.createdAt);
 await page.locator('[data-supplier-action=toggle]').click();assert.equal((await read()).suppliers[0].active,false);
 await page.locator('[data-supplier-action=toggle]').click();assert.equal((await read()).suppliers[0].active,true);
 await page.locator('[data-supplier-action=edit]').click();await page.locator('#cat-supplier-name').fill('No guardar');await page.locator('#cat-supplier-cancel').click();
 assert.equal((await read()).suppliers[0].name,'Distribuidora Actualizada');
 await page.locator('#cat-supplier-name').fill('Solo nombre');await page.locator('#cat-supplier-form button[type=submit]').click();
 assert.equal((await read()).suppliers[1].contact,'');
 assert.equal(await page.locator('#cat-suppliers-list thead th').count(),6);
 assert(await page.locator('#cat-suppliers-list tbody tr').evaluateAll(rows=>rows.every(row=>row.getBoundingClientRect().height<=85)));
 const before=await read();await page.reload();await page.waitForSelector('#panel-proveedores:not([hidden])');assert.deepEqual(await read(),before);
 // Error de escritura: no vaciar el editor ni perder proveedores existentes.
 await page.locator('#cat-supplier-name').fill('Pendiente de guardar');
 await page.evaluate(()=>{window.originalSupplierSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='a33_catalogos_proveedores_v1')throw new Error('Almacenamiento lleno');return window.originalSupplierSet.call(this,key,value);};});
 await page.locator('#cat-supplier-form button[type=submit]').click();
 assert.match(await page.locator('#cat-supplier-status').innerText(),/Almacenamiento lleno/);assert.deepEqual(await read(),before);
 assert.equal(await page.locator('#cat-supplier-name').inputValue(),'Pendiente de guardar');
 await page.evaluate(()=>{Storage.prototype.setItem=window.originalSupplierSet;});
 await page.locator('#cat-suppliers-list .cat-expense-table-scroll').screenshot({path:'/tmp/a33-proveedores-lista.png'});
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const captions=await page.locator('.cat-supplier-caption').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));assert(captions.every(height=>height<30));
 }
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'/tmp/a33-proveedores-mobile.png'});
 await page.evaluate(key=>localStorage.setItem(key,'{"version":99}'),key);await page.reload();
 assert.match(await page.locator('#cat-supplier-status').innerText(),/formato incompatible/);
 await page.locator('#cat-supplier-name').fill('No sobrescribir');await page.locator('#cat-supplier-form button[type=submit]').click();
 assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),'{"version":99}');
 assert.deepEqual(errors,[]);
 console.log('PASS: Proveedores, opcionales, duplicados, edición con ID estable, estados, cancelación, persistencia, fallos sin sobrescritura, columnas compactas y móvil.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
