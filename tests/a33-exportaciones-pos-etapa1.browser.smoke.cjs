'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/seed.html') { res.end('<!doctype html><title>Origen aislado</title>'); return; }
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : ''));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, body) => {
    res.writeHead(error ? 404 : 200, {'Cache-Control':'no-store', 'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'}[path.extname(file)] || 'application/octet-stream'});
    res.end(error ? '' : body);
  });
});
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context = await browser.newContext({serviceWorkers:'allow'});
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/exportaciones/');
  await page.waitForFunction(() => !document.getElementById('export-retry').hidden);
  assert.match(await page.textContent('#exports-status'), /base POS/);
  // Crear únicamente fixtures en el contexto de navegador aislado.
  await page.evaluate(async () => {
    await openDB();
    await put('events', {id:17, name:'Feria <prueba>', groupName:'2026', closedAt:'2026-11-19T18:00:00Z', saleSeq:1});
    await put('events', {id:18, name:'Sin grupo', groupName:''});
    await put('products', {id:1, name:'Producto', price:100});
    await put('sales', {id:1, seqId:1, eventId:17, eventName:'Feria <prueba>', productId:1, productName:'Producto', date:'2026-11-19', qty:1, unitPrice:100, unitPriceSnapshot:100, total:100, costTotal:30, lineCost:30, payment:'efectivo'});
    await put('meta', {id:'currentEventId', value:18});
    await put('summaryArchives', {id:'PA-test', seq:1, seqStr:'001', periodKey:'2026-10', periodLabel:'Octubre 2026', fileName:'001-Octubre2026.xlsx', snapshot:{sheets:[{name:'Guardado', rows:[['Histórico', 42]]}], metrics:{grand:42}}});
    await put('cashv2hist', {key:histDayKey('17','2026-11-19'), eventId:'17', dayKey:'2026-11-19', versions:[1], status:'CLOSED'});
    await put('cashv2snap', {key:snapKey('17','2026-11-19',1), eventId:'17', dayKey:'2026-11-19', v:1, snapshot:{eventId:'17', dayKey:'2026-11-19', status:'CLOSED', C:{}, USD:{}, meta:{}}});
    localStorage.setItem('suite_a33_identity_v1', JSON.stringify({commercialName:'Marca prueba'}));
    localStorage.setItem('suite_a33_reports_preferences_v1', JSON.stringify({preview:{beforeExport:false}}));
    await (await caches.open('a33-other-module-marker')).put('/keep', new Response('conservar'));
  });
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('exports-fields').disabled);
  const snapshot = () => page.evaluate(async () => {
    const rows = {};
    for (const name of Array.from(db.objectStoreNames)) rows[name] = await getAll(name);
    return JSON.stringify(rows);
  });
  const before = await snapshot();
  assert.equal(await page.locator('#export-event option').count(), 3);
  assert.equal(await page.locator('#export-event img').count(), 0);
  await page.evaluate(() => {
    window.downloads = [];
    window.originalWriteFile = XLSX.writeFile;
    XLSX.writeFile = (book, filename) => downloads.push({filename, sheets:book.SheetNames.map(name => ({name, rows:XLSX.utils.sheet_to_json(book.Sheets[name], {header:1, defval:''})}))});
  });
  async function run(report, setup = async () => {}) {
    await page.selectOption('#export-report', report);
    await setup();
    await page.waitForFunction(() => !document.getElementById('export-download').disabled);
    const count = await page.evaluate(() => downloads.length);
    await page.click('#export-download');
    await page.waitForFunction(previous => downloads.length > previous || document.getElementById('exports-status').dataset.error === 'true', count);
    assert.equal(await page.getAttribute('#exports-status','data-error'), 'false', await page.textContent('#exports-status'));
    await page.waitForFunction(() => !document.getElementById('exports-fields').disabled);
    return page.evaluate(() => downloads.at(-1));
  }
  const selectEvent = () => page.selectOption('#export-event','17');
  const list = await run('events'); assert.equal(list.filename,'eventos.xlsx');
  await page.evaluate(() => {window.captureWriteFile = XLSX.writeFile; XLSX.writeFile = originalWriteFile;});
  const actualDownload = page.waitForEvent('download'); await page.click('#export-download');
  assert.equal((await actualDownload).suggestedFilename(),'eventos.xlsx');
  await page.waitForFunction(() => !document.getElementById('exports-fields').disabled);
  await page.evaluate(() => {XLSX.writeFile = captureWriteFile;});
  const sales = await run('sales', selectEvent); assert.equal(sales.sheets[0].name,'Ventas'); assert.match(JSON.stringify(sales), /100/);
  const inventory = await run('inventory', selectEvent); assert.equal(inventory.sheets[0].name,'Inventario');
  const group = await run('group', () => page.selectOption('#filtro-grupo','2026')); assert.ok(group.sheets.some(sheet => sheet.name === 'Eventos'));
  const summary = await run('summary', async () => {await page.fill('#summary-period','2026-11'); await page.selectOption('#export-summary-event','17');}); assert.match(summary.filename, /Noviembre2026/);
  const archive = await run('archive', () => page.selectOption('#export-archive','PA-test')); assert.equal(archive.filename,'001-Octubre2026.xlsx'); assert.deepEqual(archive.sheets[0].rows,[['Histórico',42]]);
  const manager = await run('manager'); assert.ok(manager.sheets.some(sheet => sheet.name === 'ARCHIVADOS_INCLUIDOS'));
  const cash = await run('cash-event', selectEvent); assert.match(cash.filename,/EfectivoHistorico_evento_17/);
  const day = await run('cash-day', async () => {
    await selectEvent();
    await page.selectOption('#export-day','2026-11-19');
    await page.waitForFunction(() => document.querySelector('#export-version option[value="1"]'));
    await page.selectOption('#export-version','1');
  }); assert.match(day.filename,/_v01.xlsx/);
  const closure = await run('closure', selectEvent); assert.ok(closure.sheets.some(sheet => sheet.name === 'Ventas_Detalle'));
  assert.ok(closure.sheets.some(sheet => sheet.name === 'Identidad' && JSON.stringify(sheet.rows).includes('Marca prueba')));
  assert.equal(await snapshot(), before, 'Las exportaciones no alteran los datos operativos del fixture');
  // Comparación de contenido contra los generadores originales que usa el POS.
  await page.evaluate(async () => {await exportEventSalesCSV(17); await exportEventInventoryExcelPOS(17);});
  const direct = await page.evaluate(() => downloads.slice(-2));
  assert.deepEqual(direct[0],sales); assert.deepEqual(direct[1],inventory);
  // PDF real: sustituir solo la llamada nativa a imprimir en el iframe del reporte.
  await page.evaluate(() => {
    window.printed = 0;
    const append = document.body.appendChild.bind(document.body);
    document.body.appendChild = element => {
      if (element.id === 'pos-event-closure-print') element.addEventListener('load', () => {element.contentWindow.print = () => {window.printed++;};}, {once:true, capture:true});
      return append(element);
    };
  });
  await page.selectOption('#export-report','pdf'); await selectEvent(); await page.click('#export-download');
  await page.waitForFunction(() => printed === 1);
  assert.match(await page.locator('#pos-event-closure-print').getAttribute('srcdoc'), /Cierre de evento/);
  // Previsualización y cancelación conservadas.
  await page.evaluate(() => {window.originalPrefs = readPosReportPreferencesPOS; readPosReportPreferencesPOS = () => ({...originalPrefs(), preview:true});});
  await page.selectOption('#export-report','closure'); await page.click('#export-download');
  await page.waitForFunction(() => document.getElementById('pos-confirm-modal').style.display === 'flex');
  const count = await page.evaluate(() => downloads.length);
  await page.click('#pos-confirm-cancel');
  await page.waitForFunction(() => !document.getElementById('exports-fields').disabled);
  assert.equal(await page.evaluate(() => downloads.length), count);
  await page.evaluate(() => {readPosReportPreferencesPOS = originalPrefs;});
  await page.selectOption('#export-report','pdf');
  await page.evaluate(() => {readPosReportPreferencesPOS = () => ({...originalPrefs(), pdfEnabled:false});});
  await page.click('#export-download');
  await page.waitForFunction(() => document.getElementById('exports-status').dataset.error === 'true');
  assert.match(await page.textContent('#exports-status'), /Activá PDF/);
  await page.evaluate(() => {readPosReportPreferencesPOS = originalPrefs;});
  await page.selectOption('#export-report','closure');
  // Caja abierta: mismo bloqueo del generador original, sin archivo adicional.
  await page.evaluate(() => put('cashV2',{key:'17_open',eventId:'17',dayKey:'2026-11-20',status:'OPEN'}));
  await page.click('#export-download');
  await page.waitForFunction(() => document.getElementById('exports-status').dataset.error === 'true');
  assert.match(await page.textContent('#exports-status'), /caja abierta/);
  assert.equal(await page.evaluate(() => downloads.length), count);
  // Layout móvil, temas y navegación offline bajo el SW del nuevo módulo.
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(() => A33Theme.apply('light'));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.selectOption('#export-report','events');
  await page.evaluate(() => document.querySelectorAll('.a33-notice').forEach(notice => notice.remove()));
  await page.screenshot({path:'/tmp/a33-exportaciones-e1-mobile.png',fullPage:true});
  await page.setViewportSize({width:1365,height:900});
  await page.evaluate(() => A33Theme.apply('dark'));
  await page.screenshot({path:'/tmp/a33-exportaciones-e1-desktop.png',fullPage:true});
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true); await page.reload();
  await page.waitForFunction(() => !document.getElementById('exports-fields').disabled);
  assert.equal(await page.evaluate(() => caches.has('a33-other-module-marker')),true);
  await context.setOffline(false);
  await page.goto(origin + '/pos/');
  await page.waitForFunction(() => document.querySelector('#sale-event option[value="17"]') || document.querySelector('#tbl-eventos tbody tr'));
  assert.equal(await page.locator('button').filter({hasText:/Exportar Excel|Excel cierre|PDF cierre|CSV Ventas|Excel Inv|Re-exportar Excel/}).count(),1,'Solo permanece la exportación obligatoria del cierre');
  assert.equal(await page.locator('#summary-close-export').count(),1);
  assert.ok(await page.locator('#btn-add-event').count());
  await page.goto(origin + '/index.html');
  assert.equal(await page.locator('[aria-labelledby="menu-group-2"] a[href="exportaciones/index.html"]').count(),1);
  assert.deepEqual(errors,[]);
  console.log('PASS: 10 Excel, PDF, equivalencia de ventas/inventario, archivo histórico, selección de referencias, cancelación, caja abierta, conservación de datos, offline, móvil y arranque POS.');
})().catch(error => {console.error(error);process.exitCode=1;}).finally(async () => {if(browser) await browser.close();server.close();});
