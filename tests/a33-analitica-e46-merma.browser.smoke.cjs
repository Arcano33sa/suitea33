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
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('a33-pos', 1);
    request.onupgradeneeded = () => {
      for (const store of ['sales','events','products','banks','dailyClosures','cashV2','reempaques']) request.result.createObjectStore(store, {keyPath:'id'});
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['sales','events','products','reempaques'], 'readwrite');
      const base={date:'2026-10-10',eventId:1,eventName:'Evento E4.6',productId:'p1',productName:'Producto E4.6',unitPrice:100,loteCodigo:'001-A'};
      const rows=[
        {...base,id:1,qty:2,total:180,discount:20,lineCost:60,payment:'tarjeta',commissionAmountSnapshot:9,commissionLabelSnapshot:'Banco histórico 5%'},
        {...base,id:2,date:'2026-10-20',qty:-1,total:-100,lineCost:-30,isReturn:true,payment:'tarjeta',commissionAmountSnapshot:-5,commissionLabelSnapshot:'Banco histórico 5%'},
        {...base,id:3,date:'2026-10-20',qty:1,total:0,lineCost:30,courtesy:true},
        {...base,id:4,date:'2026-10-21',qty:1,total:100,lineCost:30,payment:'tarjeta',commissionSnapshotStatus:'no_determinada'},
        {...base,id:5,date:'2026-10-09',qty:1,total:900,lineCost:30}
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

      tx.objectStore('events').put({id:1,name:'Evento E4.6'});
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
    assert.ok(workbook.SheetNames.includes('Merma final'));books.push(workbook);
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheet], {header:1});
  }
  await page.goto(origin + '/analitica/index.html');
  await page.selectOption('#period-select', 'custom');
  await page.fill('#date-from','2026-10-10');
  await page.fill('#date-to','2026-10-20');
  await page.locator('#date-to').dispatchEvent('change');
  await page.waitForFunction(() => document.getElementById('kpi-total-ventas').textContent.includes('80'));
  assert.strictEqual(await page.evaluate(() => XLSX.version), '0.18.5');
  assert.ok((await page.locator('#kpi-utilidad-bruta').textContent()).includes('50.00'));
  assert.ok((await page.locator('#kpi-utilidad-despues-comision').textContent()).includes('16.00'));
  assert.ok((await page.locator('#kpi-comisiones-detalle').textContent()).includes('Banco histórico 5%'));
  assert.ok((await page.locator('#kpi-merma-final').textContent()).includes('7.00'));
  assert.ok((await page.locator('#kpi-utilidad-despues-merma').textContent()).includes('9.00'));
  await context.setOffline(true);
  const summary = await download(() => page.locator('#btn-export-resumen').click(), 'analitica_resumen.xlsx', 'Resumen');
  assert.strictEqual(Number(summary.find(row => row[1] === 'Ventas totales')[2]), 80);
  assert.strictEqual(Number(summary.find(row=>row[1]==='Utilidad bruta')[2]),50);
  assert.strictEqual(Number(summary.find(row=>row[1]==='Comisiones determinadas')[2]),4);
  assert.strictEqual(Number(summary.find(row=>row[1]==='Utilidad después de comisión')[2]),16);
  assert.strictEqual(Number(summary.find(row => row[1] === 'Costo total')[2]), 60);
  await page.locator('[data-tab="eventos"]').click();
  const events = await download(() => page.locator('#btn-export-eventos').click(), 'analitica_eventos.xlsx', 'Eventos');
  const mermaColumn=events[0].indexOf('Merma final (C$)');
  assert.strictEqual(events.slice(1).reduce((sum,row)=>sum+Number(row[mermaColumn]),0),7);
  assert.ok(events.some(row=>row[0]==='Evento solo merma'));
  assert.strictEqual(events[1][1], '001-A'); assert.strictEqual(Number(events[1][3]), 80);
  await page.locator('[data-tab="presentaciones"]').click();
  const products = await download(() => page.locator('#btn-export-presentaciones').click(), 'analitica_productos.xlsx', 'Productos');
  assert.strictEqual(products[1][1], '001-A'); assert.strictEqual(Number(products[1][9]), 80);
  for(const [tab,body] of [['resumen','tbody-resumen-mensual'],['eventos','tbody-eventos'],['presentaciones','tbody-presentaciones']]){
    await page.locator('[data-tab="'+tab+'"]').click();
    assert.ok(await page.locator('#'+body+' tr').count());
    assert.ok(await page.evaluate(id=>{
      const body=document.getElementById(id);const count=body.parentElement.querySelectorAll('thead th').length;
      return [...body.rows].every(row=>row.cells.length===count);
    },body),'Cabeceras alineadas: '+tab);
    for(const width of [1280,390]){
      await page.setViewportSize({width,height:850});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Desbordamiento: '+tab+' '+width);
    }
  }
  await page.locator('[data-tab="resumen"]').click();
  await page.fill('#date-from','2026-10-21');await page.fill('#date-to','2026-10-21');await page.locator('#date-to').dispatchEvent('change');
  await page.waitForFunction(()=>document.getElementById('kpi-utilidad-despues-comision').textContent.includes('parcial'));
  assert.ok((await page.locator('#kpi-comisiones-estado').textContent()).includes('1'));
  const unknown=await download(()=>page.locator('#btn-export-resumen').click(),'analitica_resumen.xlsx','Resumen');
  assert.ok(unknown.some(row=>row.some(cell=>String(cell).startsWith('Parcial'))));
  assert.ok((await page.locator('#kpi-utilidad-despues-merma').textContent()).includes('parcial'));
  assert.ok((await page.locator('#kpi-merma-estado').textContent()).includes('1'));
  for(const book of books.slice(0,3)){
    const merma=XLSX.utils.sheet_to_json(book.Sheets['Merma final'],{header:1});
    assert.strictEqual(merma[1][0],'m1');assert.strictEqual(merma[2][0],'m2');
    assert.ok(!merma.some(row=>['provisional','anulada','normal','otro-periodo'].includes(row[0])));
  }
  await page.fill('#date-from','2026-11-01');await page.fill('#date-to','2026-11-01');await page.locator('#date-to').dispatchEvent('change');
  await page.waitForFunction(()=>document.getElementById('kpi-utilidad-despues-merma').textContent.includes('-8.00'));
  assert.strictEqual(await page.locator('#tbody-resumen-mensual tr').count(),1);
  const only=await download(()=>page.locator('#btn-export-resumen').click(),'analitica_resumen.xlsx','Resumen');
  assert.strictEqual(Number(only.find(row=>row[1]==='Utilidad después de comisión y merma')[2]),-8);
  await page.locator('[data-tab="eventos"]').click();
  const onlyEvent=await download(()=>page.locator('#btn-export-eventos').click(),'analitica_eventos.xlsx','Eventos');
  assert.strictEqual(onlyEvent[1][0],'Evento solo merma');
  // Real read failure: a new isolated page injects getAll failure for this store only.
  await context.setOffline(false);
  const fault=await context.newPage();fault.on('pageerror',error=>errors.push(error.message));
  await fault.addInitScript(()=>{const original=IDBObjectStore.prototype.getAll;IDBObjectStore.prototype.getAll=function(...args){if(this.name==='reempaques')throw new Error('Fallo simulado E4.6');return original.apply(this,args);};});
  await fault.goto(origin+'/analitica/index.html');await fault.selectOption('#period-select','all');
  await fault.waitForFunction(()=>document.getElementById('kpi-merma-estado').textContent.includes('Lectura de merma fallida'));
  assert.ok((await fault.locator('#kpi-utilidad-despues-merma').textContent()).includes('parcial'));
  assert.strictEqual(await fault.locator('#kpi-merma-final').textContent(),'No disponible');
  await fault.close();

  const intact=await page.evaluate(()=>new Promise((resolve,reject)=>{
    const req=indexedDB.open('a33-pos');req.onsuccess=()=>{const db=req.result;const read=db.transaction('sales').objectStore('sales').getAll();read.onsuccess=()=>{resolve(read.result);db.close();};read.onerror=()=>reject(read.error);};
  }));
  const waste=await page.evaluate(()=>new Promise(resolve=>{const req=indexedDB.open('a33-pos');req.onsuccess=()=>{const db=req.result;const read=db.transaction('reempaques').objectStore('reempaques').getAll();read.onsuccess=()=>{resolve(read.result);db.close();};};}));
  assert.strictEqual(waste.length,7);assert.strictEqual(waste.find(row=>row.id==='provisional').provisionalClose,true);
  assert.strictEqual(waste.find(row=>row.id==='m1').costoMermaFinal,5);
  assert.strictEqual(intact.length,5);assert.strictEqual(intact[0].commissionAmountSnapshot,9);assert.strictEqual(intact[1].total,-100);
  assert.deepStrictEqual(external.filter(url => !url.startsWith('https://fonts.googleapis.com/')), [], 'Peticiones externas inesperadas: ' + JSON.stringify(external));
  assert.deepStrictEqual(errors, [], 'Errores de página: ' + JSON.stringify(errors));
  console.log('APROBADA E4.6 Chrome: merma confirmada, eventos y meses sin ventas, costo no fiable y lectura fallida parciales, exclusiones y fechas, tres XLSX offline, tablas escritorio/móvil y datos aislados intactos.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); server.close(); });
