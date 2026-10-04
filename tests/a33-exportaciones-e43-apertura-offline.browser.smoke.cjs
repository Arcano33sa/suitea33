'use strict';
// Origen y contexto temporales; sin acceder al almacenamiento del usuario.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = path.resolve(__dirname, '..');
const XLSX = require(path.join(root, 'pos/vendor/xlsx.full.min.js'));
assert.strictEqual(XLSX.version, '0.18.5');
const posHtml = fs.readFileSync(path.join(root, 'pos/index.html'), 'utf8');
const posSrc = posHtml.match(/src="(\.\/vendor\/xlsx\.full\.min\.js[^"\n]*)"/)[1];
for (const module of ['finanzas', 'analitica']) {
  const html = fs.readFileSync(path.join(root, module, 'index.html'), 'utf8');
  assert.ok(html.includes('src="' + posSrc.replace('./vendor/', '../pos/vendor/') + '"'));
  assert.ok(!/src="https?:[^"\n]*xlsx/i.test(html));
}
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png'};
const updatedModules = new Set();
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/__e43_seed.html') { res.end('<!doctype html><title>Datos aislados E4.3</title>'); return; }
  const file = path.resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, data) => {
    if (!error && [...updatedModules].some(module => pathname === '/' + module + '/sw.js')) {
      data = Buffer.from(data.toString().replace(/-m(\d+)`/, (_, revision) => '-m' + (Number(revision) + 1) + '`'));
    }
    res.writeHead(error ? 404 : 200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store'});
    res.end(error ? '' : data);
  });
});
let browser;
(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser = await playwright.chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context = await browser.newContext({serviceWorkers:'allow'});
  const origin = 'http://127.0.0.1:' + server.address().port;
  const external = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/__e43_seed.html');
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('a33-pos', 1);
    request.onupgradeneeded = () => {
      for (const store of ['sales','events','products','banks','dailyClosures','cashV2','reempaques']) request.result.createObjectStore(store, {keyPath:'id'});
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['sales','events','products'], 'readwrite');
      tx.objectStore('sales').put({id:1,date:'2026-10-02',eventId:1,eventName:'Evento E4.3',productId:'p1',productName:'Producto E4.3',qty:2,unitPrice:100,total:180,lineCost:60,loteCodigo:'001-A'});
      tx.objectStore('events').put({id:1,name:'Evento E4.3'});
      tx.objectStore('products').put({id:'p1',productId:'p1',name:'Producto E4.3',price:100});
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  async function download(action, filename, sheet) {
    const pending = page.waitForEvent('download');
    await action();
    const file = await pending;
    assert.strictEqual(file.suggestedFilename(), filename);
    const stream = await file.createReadStream();
    const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const workbook = XLSX.read(Buffer.concat(chunks), {type:'buffer'});
    assert.ok(workbook.SheetNames.includes(sheet));
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheet], {header:1});
  }
  await page.goto(origin + '/analitica/index.html');
  await page.selectOption('#period-select', 'all');
  await page.waitForFunction(() => document.getElementById('kpi-total-ventas').textContent.includes('180'));
  assert.strictEqual(await page.evaluate(() => XLSX.version), '0.18.5');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(async () => {
    const cache = await caches.open('a33-e43-otro-modulo');
    await cache.put('/e43-sentinel', new Response('conservar'));
  });
  await context.setOffline(true);
  await page.reload();
  await page.selectOption('#period-select', 'all');
  await page.waitForFunction(() => document.getElementById('kpi-total-ventas').textContent.includes('180'));
  const summary = await download(() => page.locator('#btn-export-resumen').click(), 'analitica_resumen.xlsx', 'Resumen');
  assert.strictEqual(Number(summary.find(row => row[1] === 'Ventas totales')[2]), 180);
  assert.strictEqual(Number(summary.find(row => row[1] === 'Costo total')[2]), 60);
  await page.locator('[data-tab="eventos"]').click();
  const events = await download(() => page.locator('#btn-export-eventos').click(), 'analitica_eventos.xlsx', 'Eventos');
  assert.strictEqual(events[1][1], '001-A'); assert.strictEqual(Number(events[1][3]), 180);
  await page.locator('[data-tab="presentaciones"]').click();
  const products = await download(() => page.locator('#btn-export-presentaciones').click(), 'analitica_productos.xlsx', 'Productos');
  assert.strictEqual(products[1][1], '001-A'); assert.strictEqual(Number(products[1][9]), 180);
  await context.setOffline(false);
  await page.goto(origin + '/finanzas/index.html');
  await page.waitForFunction(() => typeof finExportReportWorkbook === 'function' && typeof XLSX !== 'undefined');
  assert.strictEqual(await page.evaluate(() => XLSX.version), '0.18.5');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.waitForFunction(() => typeof finDB !== 'undefined' && !!finDB && !!finCachedData);
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const tx = finDB.transaction('settings','readwrite');
      tx.objectStore('settings').put({id:'a33_e43_sentinel',data:'conservar'});
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
    });
  });
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => typeof finDB !== 'undefined' && !!finDB && !!finCachedData);
  const finance = await download(() => page.evaluate(() => finExportReportWorkbook('Prueba', [['Concepto','Importe'],['Venta aislada',180]], 'finanzas_e43.xlsx', 'Prueba E4.3')), 'finanzas_e43.xlsx', 'Prueba');
  assert.strictEqual(finance[1][1], 180);
  assert.deepStrictEqual(external.filter(url => !url.startsWith('https://fonts.googleapis.com/')), [], 'Peticiones externas inesperadas: ' + JSON.stringify(external));
  assert.strictEqual(await page.evaluate(async () => {
    const cache = await caches.open('a33-e43-otro-modulo');
    return (await cache.match('/e43-sentinel')).text();
  }), 'conservar');
  assert.strictEqual(await page.evaluate(() => new Promise((resolve, reject) => {
    const req=finDB.transaction('settings','readonly').objectStore('settings').get('a33_e43_sentinel');
    req.onsuccess=()=>resolve(req.result.data);req.onerror=()=>reject(req.error);
  })), 'conservar');
  const second = await context.newPage();
  second.on('pageerror', error => errors.push(error.message));
  await second.goto(origin + '/analitica/');
  await second.selectOption('#period-select','all');
  await second.waitForFunction(() => document.getElementById('kpi-total-ventas').textContent.includes('180'));
  assert.strictEqual(await second.evaluate(() => XLSX.version), '0.18.5');
  await second.goto(origin + '/finanzas/index.html?e43=offline#tab=tablero');
  await second.waitForFunction(() => typeof finCachedData !== 'undefined' && !!finCachedData);
  assert.strictEqual(await second.evaluate(() => XLSX.version), '0.18.5');
  assert.strictEqual(await second.evaluate(async () => {
    const db = await new Promise((resolve,reject)=>{const req=indexedDB.open('a33-pos');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    const sales=await new Promise((resolve,reject)=>{const req=db.transaction('sales','readonly').objectStore('sales').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    db.close();return sales[0].total;
  }),180);
  await second.goto(origin + '/analitica/index.html');
  await second.waitForFunction(() => !!navigator.serviceWorker.controller);
  const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(reg => new URL(reg.scope).pathname).sort());
  assert.deepStrictEqual(registrations, ['/analitica/','/finanzas/']);
  await context.setOffline(false);
  await page.evaluate(() => {
    window.e43Controller = navigator.serviceWorker.controller;
    window.e43ControllerChanges = 0;
    navigator.serviceWorker.addEventListener('controllerchange', () => window.e43ControllerChanges++);
  });
  updatedModules.add('finanzas'); updatedModules.add('analitica');
  await page.evaluate(async () => {
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.update();
  });
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).every(reg => reg.waiting && reg.waiting.state === 'installed'));
  assert.strictEqual(await page.evaluate(() => navigator.serviceWorker.controller === window.e43Controller && window.e43ControllerChanges === 0), true);
  // Mantener clientes de ambos módulos: sin clientes el navegador puede activar naturalmente.
  const config = await context.newPage();
  config.on('pageerror', error => errors.push(error.message));
  await config.goto(origin + '/configuracion/index.html');
  await config.locator('#cfg-tab-pwa').click();
  await config.waitForFunction(() => document.getElementById('cfg-pwa-check').hasAttribute('data-pwa-action'));
  await config.locator('#cfg-pwa-check').click();
  try {
    await config.waitForFunction(() => document.getElementById('cfg-pwa-report').textContent.includes('Finanzas: Actualización lista para aplicar') && document.getElementById('cfg-pwa-report').textContent.includes('Analítica: Actualización lista para aplicar'));
  } catch (error) {
    console.error(await config.locator('#cfg-pwa-report').textContent());
    console.error(await config.locator('#cfg-pwa-status').textContent());
    throw error;
  }
  assert.strictEqual(await config.locator('#cfg-pwa-report li').count(), 11);
  assert.strictEqual(await config.locator('#cfg-pwa-check').textContent(), 'Buscar actualizaciones');
  assert.strictEqual(await config.locator('#cfg-pwa-apply').textContent(), 'Actualizar Suite');
  assert.strictEqual(await config.locator('#cfg-pwa-apply').isEnabled(), true);
  assert.deepStrictEqual(errors, [], 'Errores de página: ' + JSON.stringify(errors));
  console.log('APROBADA E4.3 Chrome: apertura y recarga offline, nueva pestaña, exportaciones, datos y caché ajena intactos; actualizaciones esperan y aparecen en Configuración.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); server.close(); });
