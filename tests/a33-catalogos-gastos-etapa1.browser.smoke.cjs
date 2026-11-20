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
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error=>errors.push(error.message));
  const key = 'a33_catalogos_gastos_v1';
  const read = () => page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
  const message = () => page.locator('#cat-expense-status').innerText();
  await page.goto(origin+'/catalogos/');
  await page.locator('#tab-gastos').click();
  await page.locator('#cat-expense-category-name').fill('Higiene');
  await page.locator('#cat-expense-category-form button[type=submit]').click();
  const categoryId = (await read()).categories[0].id;
  await page.locator('#cat-expense-category-name').fill(' HIGIENE ');
  await page.locator('#cat-expense-category-form button[type=submit]').click();
  assert.match(await message(), /Ya existe/);
  assert.equal((await read()).categories.length,1);
  await page.locator('#cat-expense-name').fill('Guantes');
  await page.locator('#cat-expense-category').selectOption(categoryId);
  await page.locator('#cat-expense-presentation').selectOption('both');
  await page.locator('#cat-expense-unit-price').fill('3.50');
  await page.locator('#cat-expense-box-price').fill('300');
  await page.locator('#cat-expense-units').fill('100');
  await page.locator('#cat-expense-item-form button[type=submit]').click();
  let state = await read();
  assert.equal(state.items.length,1);
  const itemId = state.items[0].id;
  assert.equal(state.items[0].unitPrice,3.5);
  assert.equal(state.items[0].boxPrice,300);
  assert.equal(state.items[0].unitsPerBox,100);
  assert.equal(state.items[0].categoryId,categoryId);
  await page.locator('[data-expense-action=edit-item]').click();
  await page.locator('#cat-expense-box-price').fill('320');
  await page.locator('#cat-expense-item-form button[type=submit]').click();
  assert.equal((await read()).items[0].id,itemId);
  assert.equal((await read()).items[0].boxPrice,320);
  await page.locator('[data-expense-action=edit-category]').click();
  await page.locator('#cat-expense-category-name').fill('Protección');
  await page.locator('#cat-expense-category-form button[type=submit]').click();
  assert.equal((await read()).categories[0].id,categoryId);
  assert.match(await page.locator('#cat-expense-items').innerText(),/Protección/);
  await page.locator('[data-expense-action=toggle-category]').click();
  assert.equal((await read()).categories[0].active,false);
  assert.equal(await page.locator('#cat-expense-category option').count(),1);
  // Un artículo existente conserva su categoría inactiva al editarse.
  await page.locator('[data-expense-action=edit-item]').click();
  assert.equal(await page.locator('#cat-expense-category').inputValue(),categoryId);
  await page.locator('#cat-expense-item-cancel').click();
  await page.locator('[data-expense-action=toggle-item]').click();
  assert.equal((await read()).items[0].active,false);
  await page.locator('[data-expense-action=toggle-category]').click();
  await page.locator('[data-expense-action=toggle-item]').click();
  // Crear por unidad y por caja; no exigir precios de una presentación oculta.
  for (const presentation of ['unit','box']) {
    await page.locator('#cat-expense-name').fill(presentation==='unit' ? 'Gorro' : 'Mascarillas');
    await page.locator('#cat-expense-category').selectOption(categoryId);
    await page.locator('#cat-expense-presentation').selectOption(presentation);
    if (presentation==='unit') await page.locator('#cat-expense-unit-price').fill('2');
    else {
      await page.locator('#cat-expense-box-price').fill('150');
      await page.locator('#cat-expense-units').fill('50');
    }
    await page.locator('#cat-expense-item-form button[type=submit]').click();
  }
  state = await read();
  assert.equal(state.items.length,3);
  assert.equal(state.items.find(row=>row.name==='Gorro').boxPrice,null);
  assert.equal(state.items.find(row=>row.name==='Mascarillas').unitPrice,null);
  await page.locator('#cat-expense-name').fill('guántes');
  await page.locator('#cat-expense-category').selectOption(categoryId);
  await page.locator('#cat-expense-unit-price').fill('4');
  await page.locator('#cat-expense-item-form button[type=submit]').click();
  assert.match(await message(),/Ya existe/);
  assert.equal((await read()).items.length,3);
  // Validación interna incluso si se omite la validación nativa del formulario.
  await page.locator('#cat-expense-name').fill('Artículo inválido');
  await page.locator('#cat-expense-presentation').selectOption('box');
  await page.locator('#cat-expense-box-price').fill('20');
  await page.locator('#cat-expense-units').fill('1.5');
  await page.locator('#cat-expense-item-form').dispatchEvent('submit');
  assert.match(await message(),/cantidad entera/);
  assert.equal((await read()).items.length,3);
  await page.locator('#cat-expense-units').fill('10');
  await page.locator('#cat-expense-box-price').fill('-1');
  await page.locator('#cat-expense-item-form').dispatchEvent('submit');
  assert.match(await message(),/precios válidos/);
  assert.equal((await read()).items.length,3);
  // Si falla la escritura, conservar datos y formulario para reintentar.
  const beforeFailure = await read();
  await page.evaluate(()=>{ window.expenseOriginalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key,value){ if(key==='a33_catalogos_gastos_v1') throw new Error('Almacenamiento lleno'); return window.expenseOriginalSetItem.call(this,key,value); }; });
  await page.locator('#cat-expense-box-price').fill('20');
  await page.locator('#cat-expense-item-form').dispatchEvent('submit');
  assert.match(await message(),/Almacenamiento lleno/);
  assert.deepEqual(await read(),beforeFailure);
  assert.equal(await page.locator('#cat-expense-name').inputValue(),'Artículo inválido');
  await page.evaluate(()=>{ Storage.prototype.setItem=window.expenseOriginalSetItem; });
  await page.reload();
  await page.waitForSelector('#panel-gastos:not([hidden])');
  assert.equal((await read()).items.length,3);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),true);
  await page.waitForTimeout(5000);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'/tmp/a33-gastos-e1-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'/tmp/a33-gastos-e1-desktop.png',fullPage:true});
  assert.equal(await page.locator('#cat-expense-categories thead th').count(),3);
  assert.equal(await page.locator('#cat-expense-items thead th').count(),7);
  assert.equal(await page.locator('#cat-expense-items tbody tr').count(),3);
  await page.locator('#cat-expense-categories .cat-expense-table-scroll').screenshot({path:'/tmp/a33-categorias-compactas.png'});
  await page.locator('#cat-expense-items .cat-expense-table-scroll').screenshot({path:'/tmp/a33-articulos-compactos.png'});
  const rowHeights=await page.locator('#cat-expense-items tbody tr').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height));
  assert(rowHeights.every(height=>height<=80),'Los artículos deben ocupar una fila compacta');
  assert(await page.locator('#cat-expense-categories tbody tr').evaluate(row=>row.getBoundingClientRect().height<=80));
  assert.equal(await page.locator('#cat-expense-items tbody tr').filter({hasText:'Gorro'}).locator('td').nth(2).innerText(),'—');
  const storedBeforeLayout=await read();
  await page.setViewportSize({width:390,height:844});
  assert(await page.locator('#cat-expense-items .cat-expense-table-scroll').evaluate(el=>el.scrollWidth>el.clientWidth));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(await read(),storedBeforeLayout);

  // Datos incompatibles no se reemplazan por un catálogo vacío.
  await page.evaluate(key=>localStorage.setItem(key,'{"version":99}'),key);
  await page.reload();
  assert.match(await message(),/formato compatible/);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),'{"version":99}');
  assert.deepEqual(errors,[]);
  console.log('PASS: categorías, artículos, unidad/caja, duplicados, edición, estados, persistencia, formato incompatible, navegación y móvil.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
