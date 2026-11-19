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
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/__e46_seed.html') { res.end('<!doctype html><title>Datos aislados E4.6</title>'); return; }
  const file = path.resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, data) => {
    res.writeHead(error ? 404 : 200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store'});
    res.end(error ? '' : data);
  });
});
let browser;
(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser = await playwright.chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context = await browser.newContext({serviceWorkers:'block'});
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
  await page.goto(origin + '/__e46_seed.html');
  await page.evaluate(() => localStorage.setItem('a33_pos_customersCatalog', JSON.stringify([
    {id:'active', name:'Cliente privado de prueba'},
    {id:'merged', name:'Nombre anterior de prueba', mergedIntoId:'active'},
    {id:'catalog-only', name:'Cliente solo catálogo de prueba', celular:'55500000'},
    {id:'inactive', name:'Cliente de ficha inactiva', isActive:false}
  ])));
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('finanzasDB', 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const entries = request.result.createObjectStore('journalEntries', {keyPath:'id'});
      const receipts = request.result.createObjectStore('receipts', {keyPath:'receiptId'});
      const entry = {source:'manual_financial_account', tipoMovimiento:'egreso', posEventId:'1', fecha:'2026-10-20', totalDebe:210};
      entries.put({...entry, id:1});
      entries.put({...entry, id:2, fecha:'2026-10-10', totalDebe:20});
      entries.put({...entry, id:3, source:'POS', totalDebe:999});
      entries.put({...entry, id:4, posEventId:3, totalDebe:15});
      receipts.put({receiptId:'a', status:'ISSUED', operationalClass:'EXPENSE', posEventId:1, dateISO:'2026-10-20', total:5});
      receipts.put({receiptId:'b', status:'VOID', operationalClass:'EXPENSE', posEventId:1, dateISO:'2026-10-20', total:999});
    };
    request.onsuccess = () => { request.result.close(); resolve(); };
  }));
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('a33-pos', 1);
    request.onupgradeneeded = () => {
      for (const store of ['sales','events','products','banks','dailyClosures','cashV2','reempaques']) request.result.createObjectStore(store, {keyPath:'id'});
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['sales','events','products','reempaques','cashV2'], 'readwrite');
      const base={date:'2026-10-10',eventId:1,eventName:'Evento E4.6',productId:'p1',productName:'Producto E4.6',customerName:'Cliente privado de prueba',time:'13:15',unitPrice:100,loteCodigo:'001-A'};
      const rows=[
        {...base,id:1,customerId:'merged',customerName:'',qty:2,total:180,discount:20,lineCost:60,payment:'tarjeta',commissionAmountSnapshot:9,commissionLabelSnapshot:'Banco histórico 5%'},
        {...base,id:2,date:'2026-10-20',qty:-1,total:-100,lineCost:-30,isReturn:true,payment:'tarjeta',commissionAmountSnapshot:-5,commissionLabelSnapshot:'Banco histórico 5%'},
        {...base,id:3,date:'2026-10-20',qty:1,total:0,lineCost:30,courtesy:true},
        {...base,id:4,date:'2026-10-21',qty:1,total:100,lineCost:30,payment:'tarjeta',commissionSnapshotStatus:'no_determinada'},
        {...base,id:5,date:'2026-10-09',qty:1,total:900,lineCost:30},
        {...base,id:6,date:'2026-08-01',customerName:'Cliente dormido de prueba',qty:1,total:50,lineCost:30},
        {...base,id:7,date:'2026-08-01',customerName:'Cliente sin compras de prueba',qty:1,total:0,lineCost:30,courtesy:true}
      ];
      for(const row of rows)tx.objectStore('sales').put(row);
      const merma={tipo:'REEMPAQUE_MERMA_FINAL_EVENTO',date:'2026-10-20',eventId:1,mermaFinalMl:100,costoMermaFinal:5,costReliable:true};
      for(const row of [
        {...merma,id:'m1'}, {...merma,id:'m2',eventId:2,costoMermaFinal:2},
        {...merma,id:'provisional',provisionalClose:true,costoMermaFinal:99},
        {...merma,id:'anulada',anulado:true,costoMermaFinal:99},
        {...merma,id:'normal',tipo:'REEMPAQUE_NORMAL',costoMermaFinal:99},
        {...merma,id:'otro-periodo',date:'2026-11-01',eventId:2,costoMermaFinal:8},
        {...merma,id:'incierta',date:'2026-10-21',costReliable:false,costoMermaFinal:1}
      ])tx.objectStore('reempaques').put(row);
      tx.objectStore('events').put({id:2,name:'Evento solo merma'});

      // Evento 1 conservado únicamente en ventas históricas.
      tx.objectStore('events').put({id:3,name:'Evento solo gastos'});
      tx.objectStore('cashV2').put({id:'cash',eventId:1,dayKey:'2026-10-21',fx:36.6,movements:[
        {id:'expense',kind:'OUT',currency:'USD',amount:1},
        {id:'withdrawal',kind:'OUT',operationalClass:'CASH_OUT',amount:999}
      ]});
      tx.objectStore('products').put({id:'p1',productId:'p1',name:'Producto E4.6',price:100});
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  const books=[];
  async function download(action, filename, sheet) {
    const pending = page.waitForEvent('download');
    await action();
    const file = await pending;
    assert.strictEqual(file.suggestedFilename(), filename);
    const stream = await file.createReadStream();
    const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const workbook = XLSX.read(Buffer.concat(chunks), {type:'buffer'});
    assert.ok(workbook.SheetNames.includes(sheet));
    if (filename !== 'analitica_consolidada.xlsx') assert.ok(workbook.SheetNames.includes('Merma final'));
    books.push(workbook);
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheet], {header:1});
  }
  await page.goto(origin + '/analitica/index.html');
  await page.waitForFunction(() => document.querySelector('#analytics-event-select option[value="1"]'));
  assert.ok((await page.locator('#analytics-event-select').textContent()).includes('ID 1'));
  await page.selectOption('#period-select', 'custom');
  await page.fill('#date-from', '2026-10-10');
  await page.fill('#date-to', '2026-10-20');
  await page.locator('#date-to').dispatchEvent('change');
  await page.selectOption('#analytics-event-select', '1');
  assert.ok((await page.textContent('#kpi-total-ventas')).includes('80.00'));
  assert.ok((await page.textContent('#kpi-merma-final')).includes('5.00'));
  assert.equal(await page.locator('#horas-event-select').isDisabled(), true);
  assert.equal(await page.locator('#cortesias-event-select').isDisabled(), true);
  assert.ok((await page.textContent('#analytics-period-range')).includes('ID 1'));
  await page.click('#btn-export-consolidado');
  const modal = page.locator('#analytics-export-dialog');
  assert.equal(await modal.locator('[name="eventFilter"]').inputValue(), '1');
  await modal.locator('[name="eventFilter"]').selectOption('2');
  assert.equal(await page.inputValue('#analytics-event-select'), '1');
  assert.ok((await modal.locator('#analytics-export-period-range').textContent()).includes('ID 2'));
  await modal.locator('[name="previous"]').check();
  for (const section of ['Clientes', 'Cortesías', 'Avanzado']) await modal.locator(`[value="${section}"]`).check();
  const exported = await download(() => modal.getByRole('button', {name:'Descargar Excel'}).click(), 'analitica_consolidada.xlsx', 'Eventos');
  assert.equal(exported.length, 2, 'Solo el evento 2, sin gastos de otros eventos');
  const idColumn = exported[0].indexOf('ID del evento POS');
  assert.equal(exported[1][idColumn], '2');
  assert.equal(exported[1][exported[0].indexOf('Merma final (C$)')], 2);
  const book = books.at(-1);
  const rows = name => XLSX.utils.sheet_to_json(book.Sheets[name], {header:1});
  assert.ok(rows('Alcance').some(row => row[0] === 'Evento seleccionado' && row[1].includes('ID 2')));
  assert.equal(rows('Clientes').length, 1, 'No incluir clientes de otros eventos ni fichas sin movimientos');
  assert.equal(rows('Productos').length, 1);
  assert.equal(rows('Cortesías').length, 1);
  assert.equal(rows('Eventos anterior').length, 1, 'Mantener evento también en período anterior');
  await page.click('#btn-export-consolidado');
  assert.equal(await modal.locator('[name="eventFilter"]').inputValue(), '1');
  const clients = await download(() => modal.getByRole('button', {name:'Descargar Excel'}).click(), 'analitica_consolidada.xlsx', 'Clientes');
  const netColumn = clients[0].indexOf('Ventas netas en período (C$)');
  assert.ok(clients.slice(1).some(row => row[netColumn] === 80), 'Clientes conserva importes del evento y período');
  await page.selectOption('#analytics-event-select', '2');
  assert.ok((await page.textContent('#kpi-merma-final')).includes('2.00'));
  await page.selectOption('#analytics-event-select', 'sin-evento');
  assert.ok((await page.textContent('#kpi-total-ventas')).includes('0.00'));
  assert.ok((await page.textContent('#kpi-merma-final')).includes('0.00'));
  await page.selectOption('#analytics-event-select', 'all');
  assert.equal(await page.locator('#horas-event-select').isDisabled(), false);
  assert.ok((await page.textContent('#kpi-merma-final')).includes('7.00'));
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.locator('#analytics-event-select').isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepStrictEqual(errors, []);
  console.log('APROBADA E2 Chrome: evento histórico, período combinado, filtros internos, merma sin ventas, modal independiente, XLSX con gastos/clientes y período anterior, General y móvil.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); server.close(); });
