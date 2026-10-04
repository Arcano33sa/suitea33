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
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await playwright.chromium.launch({ headless:true, ...(fs.existsSync(chrome) ? { executablePath:chrome } : {}) });
  const context = await browser.newContext({ viewport:{ width:1280, height:900 }, timezoneId:'America/Managua' });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const catalog = await context.newPage();
  const prepareCatalogEdit = async () => {
    await catalog.bringToFront();
    await catalog.evaluate(() => new Promise(resolve => {
      const observer = new MutationObserver(() => { observer.disconnect(); resolve(); });
      observer.observe(document.getElementById('cat-costs-head-row'), { childList:true });
      window.dispatchEvent(new Event('focus'));
    }));
  };
  await catalog.goto(origin + '/catalogos/');
  await catalog.waitForFunction(() => !!window.A33CatalogCosts && !!window.A33Products);
  await catalog.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('a33-pos');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = database.transaction('products', 'readwrite');
      tx.objectStore('products').put({ id:9101, productId:'cost-small', name:'Producto menor', active:true, receta:true, capacityMl:500, letra:'A', envaseId:'bottle', tapaId:'cap', unitCost:99 });
      tx.objectStore('products').put({ id:9102, productId:'cost-large', name:'Producto mayor', active:true, receta:true, capacityMl:1000, letra:'B', envaseId:'bottle', tapaId:'cap', unitCost:88, order:-1 });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    database.close();
    const put = (key, value) => localStorage.setItem(key, JSON.stringify(value));
    put('a33_catalog_envases_v1', [{ id:'bottle', name:'Botella', capacityMl:500, active:true }]);
    put('a33_catalog_tapas_v1', [{ id:'cap', name:'Tapa', active:true }]);
    put('arcano33_recetas_v1', { version:3, recetas:{ 'cost-small':{ vino:379.78 }, 'cost-large':{ vino:500 } }, costosPresentacion:{ 'cost-small':{ productId:'cost-small', costoUnidad:17.5 } } });
    put('a33_catalogos_costos_v1', { schemaVersion:2, liquids:Object.fromEntries(['vino','vodka','jugo','sirope','agua_pura'].map(key => [key, { price:1, ml:1 }])), consumablesByProduct:{ 'cost-small':{ botella:0, calcomania:0 }, 'cost-large':{ botella:0, calcomania:0 } }, updatedAt:new Date().toISOString() });
    put('arcano33_inventario', { liquids:Object.fromEntries(['vino','vodka','jugo','sirope','agua'].map(key => [key, { stock:10000 }])), bottles:{ bottle:{ stock:100 } }, caps:{ cap:{ stock:100 } }, finished:{}, finishedByProductId:{}, varios:[], movimientos:[], productionOperations:{} });
    put('arcano33_lotes', [{ id:'history', loteId:'history', codigo:'HISTORICO', productosProducidos:[{ productId:'cost-small', cantidad:1, costoUnitario:12.25, costoTotal:12.25 }] }]);
  });
  await catalog.reload();
  await catalog.locator('#tab-costos').click();
  await catalog.waitForFunction(() => document.querySelectorAll('.cat-cost-product-head').length === 2);
  assert.deepEqual(await catalog.locator('.cat-cost-product-head').evaluateAll(nodes => nodes.map(node => node.dataset.productId)), ['cost-small','cost-large']);
  assert.match(await catalog.locator('tr[data-cost-row="total"] td[data-product-id="cost-small"]').innerText(), /380[.,]00/);

  const production = await context.newPage();
  const temporal = await context.newPage();
  for (const [page, module] of [[production,'calculadora'], [temporal,'calculadora_temporal']]) {
    await page.goto(origin + '/' + module + '/');
    await page.waitForFunction(() => document.getElementById('costo-unit-cost-small')?.value === '380');
    assert.equal(await page.locator('#costo-unit-cost-small').getAttribute('aria-readonly'), 'true');
    assert.equal(await page.locator('#costo-unit-cost-small').evaluate(el => el.readOnly), true);
    await page.locator('#plan-cost-small').fill('2');
    await page.evaluate(() => { document.getElementById('costo-unit-cost-small').value = '1'; calcularTotales(); });
    assert.equal(await page.locator('#costo-unit-cost-small').inputValue(), '380');
    const data = await page.evaluate(() => calcularDatosLote());
    assert.equal(data.unidadesPorPresentacion[0].costoUnitario, 380);
    assert.match(await page.locator('#resumen-costos').innerText(), /760[.,]00/);
  }

  // Un cambio no guardado no modifica el costo obligatorio de las calculadoras.
  await prepareCatalogEdit();
  await catalog.locator('#cat-cost-vino-price').fill('2');
  await production.evaluate(() => A33CatalogCosts.refreshInputs(PRESENTACIONES));
  assert.equal(await production.locator('#costo-unit-cost-small').inputValue(), '380');
  await catalog.locator('#cat-save-costs').click();
  await production.waitForFunction(() => document.getElementById('costo-unit-cost-small').value === '760');
  await temporal.waitForFunction(() => document.getElementById('costo-unit-cost-small').value === '760');
  await production.evaluate(() => calcularTotales());
  const originalHistory = await production.evaluate(() => JSON.stringify(A33Storage.sharedGet('arcano33_lotes', [])[0]));
  await production.evaluate(() => guardarCalculoComoLote());
  await production.waitForFunction(() => A33Storage.sharedGet('arcano33_lotes', []).length === 2);
  const saved = await production.evaluate(() => {
    const lotes = A33Storage.sharedGet('arcano33_lotes', []);
    const lot = lotes.find(item => item.id !== 'history');
    return { item:lot.productosProducidos[0], history:JSON.stringify(lotes.find(item => item.id === 'history')), stock:A33Storage.sharedGet('arcano33_inventario', {}).finishedByProductId['cost-small'] };
  });
  assert.equal(saved.item.costoUnitario, 760);
  assert.equal(saved.item.costoTotal, 1520);
  assert.equal(saved.stock.ultimoCostoUnitario, 760);
  assert.equal(saved.history, originalHistory);

  await temporal.evaluate(() => calcularTotales());
  await temporal.evaluate(() => guardarCalculoComoLote());
  await temporal.waitForFunction(() => readTemporalRecordsWithMeta().data.length === 1);
  const temporalId = await temporal.evaluate(() => {
    const record = readTemporalRecordsWithMeta().data[0];
    if (record.resultados.unidadesPorPresentacion[0].costoUnitario !== 760) throw Error('Costo temporal incorrecto');
    return record.id;
  });
  const historicalTemporal = await temporal.evaluate(() => localStorage.getItem(STORAGE_REGISTROS_KEY));
  await prepareCatalogEdit();
  await catalog.locator('#cat-cost-vino-price').fill('3');
  await catalog.locator('#cat-save-costs').click();
  await temporal.waitForFunction(() => document.getElementById('costo-unit-cost-small').value === '1140');
  await temporal.evaluate(id => cargarRegistroTemporal(id), temporalId);
  assert.match(await temporal.locator('#resumen-costos').innerText(), /1520[.,]00/);
  assert.equal(await temporal.locator('#costo-unit-cost-small').inputValue(), '1140');
  assert.equal(await temporal.evaluate(() => localStorage.getItem(STORAGE_REGISTROS_KEY)), historicalTemporal);

  // Pendiente no se sustituye por costo manual/referencial ni se guarda producción.
  await prepareCatalogEdit();
  await catalog.locator('.cat-cost-consumable-input[data-product-id="cost-small"][data-cost-consumable="botella"]').fill('');
  await catalog.locator('#cat-save-costs').click();
  for (const page of [production, temporal]) {
    await page.waitForFunction(() => document.getElementById('costo-unit-cost-small').dataset.catalogCostStatus === 'pending');
    await page.locator('#plan-cost-small').fill('1');
    await page.evaluate(() => calcularTotales());
    assert.match(await page.locator('.a33-notify-region').innerText(), /Completa y guarda el costo en Catálogos → Costos/);
    const data = await page.evaluate(() => calcularDatosLote());
    assert.deepEqual(data.costosPendientes, ['Producto menor']);
    assert.equal(data.unidadesPorPresentacion[0].costoUnitario, undefined);
    assert.equal(data.unidadesPorPresentacion[0].costoReferencial, undefined);
  }
  const recordsBefore = await production.evaluate(() => localStorage.getItem('arcano33_lotes'));
  await production.evaluate(() => guardarCalculoComoLote());
  assert.equal(await production.evaluate(() => localStorage.getItem('arcano33_lotes')), recordsBefore);
  const oldRecipeCost = await production.evaluate(() => A33Storage.sharedGet('arcano33_recetas_v1', {}).costosPresentacion['cost-small'].costoUnidad);
  await production.locator('#btn-guardar-receta').click();
  assert.equal(await production.evaluate(() => A33Storage.sharedGet('arcano33_recetas_v1', {}).costosPresentacion['cost-small'].costoUnidad), oldRecipeCost);

  // La receta con id legado se relaciona solo mediante productId explícito.
  const identity = await production.evaluate(() => {
    const payload = { recetas:{ legacy:{ vino:10 } }, productos:[{ id:'legacy', productId:'cost-large' }] };
    const linked = A33CatalogCosts.readForProducts(PRESENTACIONES, payload).get('cost-large');
    const missing = A33CatalogCosts.readForProducts([{ id:'other', productId:'other', nombre:'Producto menor' }], payload).get('other');
    return { linked:linked.status, total:linked.total, missing:missing.status };
  });
  assert.deepEqual(identity, { linked:'complete', total:30, missing:'no_recipe' });

  // El nuevo motor queda disponible en el precache de los tres módulos.
  for (const page of [catalog, production, temporal]) {
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cached = await page.evaluate(async () => !!(await caches.match('/assets/js/a33-catalog-costs.js?v=4.20.98&r=1')));
    assert.equal(cached, true);
  }
  await context.setOffline(true);
  for (const page of [production, temporal]) {
    await page.reload();
    await page.waitForFunction(() => document.getElementById('costo-unit-cost-small')?.dataset.catalogCostStatus === 'pending');
    assert.equal(await page.locator('#costo-unit-cost-small').evaluate(el => el.readOnly), true);
  }
  assert.deepEqual(errors, []);
  console.log('PASS Costos E2: Catálogo, solo lectura, guardado, actualización, producción/lote/inventario, Temporal, históricos, pendientes, identidad y offline.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
