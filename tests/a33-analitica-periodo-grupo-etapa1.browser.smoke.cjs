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
  await page.clock.setFixedTime(new Date('2026-11-15T12:00:00'));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/__e46_seed.html');
  await page.evaluate(()=>localStorage.setItem('a33_pos_groupCatalog_v1', JSON.stringify(['2026','Otro','Vacío'])));
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
      for (const [id,eventId,total] of [[8,2,200],[9,3,300],[10,4,400],[11,5,500],[12,6,600],[13,7,700],[14,8,800],[15,null,900]]) rows.push({...base,id,eventId,eventName:'Evento ' + eventId,qty:1,total,lineCost:30});
      rows.push({...base,id:16,date:'2026-01-15',eventId:1,qty:1,total:120,lineCost:30});
      rows.push({...base,id:17,date:'2026-11-15',eventId:2,qty:1,total:150,lineCost:30});
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
      for (let id=1;id<=7;id++) tx.objectStore('events').put({id,name:'Evento ' + id,groupName:id<=5?'2026':id===6?'Otro':'',closedAt:id===1?'2026-10-31T12:00:00':null});

      // Evento 1 conservado únicamente en ventas históricas.

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
  const main = page.locator('#analytics-event-picker');
  await page.waitForFunction(()=>document.querySelector('#analytics-event-picker [data-group] option[value="group:2026"]'));
  assert.equal(await page.locator('#period-select option[value="group"]').textContent(),'Grupo');
  await main.locator('[data-group]').selectOption('group:2026');
  assert.ok((await page.textContent('#kpi-total-ventas')).includes('150.00'),'Mes actual solo noviembre');
  await page.selectOption('#period-select','group');
  assert.ok((await page.textContent('#kpi-total-ventas')).includes('2,800.00'),'Grupo incluye enero, agosto, octubre y noviembre');
  assert.ok((await page.textContent('#analytics-period-range')).includes('Sin límite de fechas'));
  await main.locator('summary').click(); await main.locator('[data-clear]').click();
  await main.locator('input[value="1"]').check();
  assert.ok((await page.textContent('#kpi-total-ventas')).includes('1,250.00'),'Evento cerrado incluido');
  await main.locator('input[value="2"]').check(); await main.locator('summary').click();
  assert.ok((await page.textContent('#kpi-total-ventas')).includes('1,600.00'));
  await page.click('#btn-export-consolidado');
  const modal=page.locator('#analytics-export-dialog');
  assert.equal(await modal.locator('[name="period"]').inputValue(),'group');
  assert.equal(await modal.locator('[name="previous"]').isDisabled(),true);
  assert.ok((await modal.locator('#analytics-export-period-range').textContent()).includes('Sin límite de fechas'));
  const summary=await download(()=>modal.getByRole('button',{name:'Descargar Excel'}).click(),'analitica_consolidada.xlsx','Resumen');
  assert.equal(summary.find(row=>row[1]==='Ventas totales')[2],1600);
  const book=books.at(-1);
  const scope=XLSX.utils.sheet_to_json(book.Sheets.Alcance,{header:1});
  assert.ok(scope.some(row=>row[0]==='Período seleccionado'&&row[1]==='Grupo'));
  const eventRows=XLSX.utils.sheet_to_json(book.Sheets.Eventos,{header:1});
  assert.equal(eventRows.length,3);
  assert.ok(eventRows.some(row=>row.includes('Cerrado')));
  await page.selectOption('#period-select','mtd');
  assert.ok((await page.textContent('#kpi-total-ventas')).includes('150.00'),'Volver a mes actual reaplica fechas');
  await page.click('#btn-export-consolidado');
  await modal.locator('[name="period"]').selectOption('group');
  assert.equal(await page.inputValue('#period-select'),'mtd','Modal independiente');
  await modal.getByRole('button',{name:'Cancelar'}).click();
  assert.deepStrictEqual(errors,[]);
  console.log('APROBADA período Grupo: nombre exacto, sin fechas, eventos cerrados/abiertos de varios meses, subconjunto, modal/Excel y retorno a Mes actual.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
