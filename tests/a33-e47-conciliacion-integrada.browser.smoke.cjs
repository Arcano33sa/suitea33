'use strict';
// Same temporary origin and persisted fixtures for real module pages and POS report functions.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = path.resolve(__dirname, '..');
const XLSX = require(path.join(root, 'pos/vendor/xlsx.full.min.js'));
const posSource = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');
function between(start, end) {
  const a = posSource.indexOf(start), b = posSource.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'POS block missing: ' + start);
  return posSource.slice(a, b);
}
// All arithmetic and snapshot readers are actual current POS code; only getAll is an IDB adapter.
const posFunctions = [
  posSource.match(/const CARD_COMMISSION_SNAPSHOT_STATUS_UNDETERMINED_POS[^\n]+/)[0],
  between('function round2(n)', 'function moneyEquals('),
  between('function getSaleUnitPriceSnapshotPOS(', 'function applyProductSaleCatalogDefaultsPOS('),
  between('function getSaleDiscountTotalPOS(', 'function isLikelyAutoIdPOS('),
  between('function isCourtesySalePOS(', 'function getSaleLineCostPOS('),
  between('function normalizePaymentMethodPOS(', 'function normalizeBankTypePOS('),
  between('function readFiniteSaleSnapshotNumberPOS(', 'function isCompleteSaleCardCommissionSnapshotPOS('),
  between('function collectSaleCardCommissionsPOS(', 'function resolveLegacyCardBankPOS('),
  between('function resolveSaleCostSnapshotPOS(', 'function buildSaleEconomicSnapshotPOS('),
  between('function buildCorteSummaryRows(', 'function cashV2EventExportSnapshotFromRecordPOS('),
  between('function reempaqueNumPOS(', 'function reempaquePositivePOS('),
  between('function reempaqueRound4POS(', 'function reempaqueFloorUnitsPOS('),
  between('function reempaqueIsFinalEventMermaRecordPOS(', 'function reempaqueIsLegacySanitationRecordPOS('),
  between('function reempaqueEventIdFromRecordPOS(', 'async function reempaqueLoadFinalMermaForEventPOS('),
  between('async function reempaqueGetFinalMermaForSummaryPOS(', 'function reempaqueLotIdentityForMermaPOS(')
].join('\n');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__e47.html') { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><title>E4.7 isolated</title>'); return; }
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : ''));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, data) => { res.writeHead(error ? 404 : 200, {'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'}[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'}); res.end(error ? '' : data); });
});
let browser;
(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser = await playwright.chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context = await browser.newContext({serviceWorkers:'block'});
  const origin = 'http://127.0.0.1:' + server.address().port;
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const seed = await context.newPage();
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await seed.goto(origin + '/__e47.html');
  await seed.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('a33-pos', 1);
    req.onupgradeneeded = () => { for (const name of ['sales','events','products','banks','dailyClosures','cashV2','reempaques']) req.result.createObjectStore(name,{keyPath:'id'}); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction([...db.objectStoreNames], 'readwrite');
      const base = {eventId:1,eventName:'Evento 1',productId:'p1',productName:'Producto histórico',unitPrice:100,loteCodigo:'001-A',date:'2026-10-10'};
      const card = {payment:'tarjeta',commissionLabelSnapshot:'Banco histórico 5%',commissionSnapshotStatus:'determinada'};
      for (const row of [
        {...base,...card,id:1,qty:2,total:180,discount:20,lineCost:60,commissionAmountSnapshot:9},
        {...base,...card,id:2,date:'2026-10-31',qty:-1,total:-100,lineCost:-30,isReturn:true,commissionAmountSnapshot:-5},
        {...base,id:3,date:'2026-10-01',qty:1,total:0,lineCost:30,courtesy:true},
        {...base,id:4,qty:1,unitPrice:50,total:50,lineCost:10,payment:'efectivo'},
        {...base,...card,id:5,qty:1,unitPrice:50,total:50,lineCost:10,commissionAmountSnapshot:0,commissionLabelSnapshot:'Exenta'},
        {...base,id:6,eventId:2,eventName:'Evento 2',productId:'p2',productName:'Otro',qty:1,unitPrice:120,total:120,lineCost:40,payment:'transferencia'},
        {...base,id:7,date:'2026-09-30',qty:1,unitPrice:999,total:999,lineCost:99,payment:'efectivo'},
        {...base,id:8,date:'2026-11-01',qty:1,unitPrice:999,total:999,lineCost:99,payment:'efectivo'},
        {...base,id:9,eventId:3,eventName:'Comisión desconocida',date:'2026-11-02',qty:1,total:100,lineCost:30,payment:'tarjeta',commissionSnapshotStatus:'no_determinada'}
      ]) tx.objectStore('sales').put(row);
      for (const id of [1,2,3,4]) tx.objectStore('events').put({id,name:'Evento '+id});
      tx.objectStore('products').put({id:'p1',productId:'p1',name:'Nombre actual cambiado',price:999,unitCost:999});
      tx.objectStore('products').put({id:'p2',productId:'p2',name:'Otro actual',price:999,unitCost:999});
      tx.objectStore('banks').put({id:1,name:'Banco actual cambiado',commissionPct:99});
      tx.objectStore('dailyClosures').put({id:1,eventId:1,date:'2026-10-10',totals:{ventaNeta:9999,costoVentasTotal:999}});
      const waste = {tipo:'REEMPAQUE_MERMA_FINAL_EVENTO',date:'2026-10-31',eventId:1,mermaFinalMl:100,costoMermaFinal:5,costReliable:true};
      for (const row of [{...waste,id:'m1'}, {...waste,id:'m2',eventId:2,costoMermaFinal:2}, {...waste,id:'cancel',anulado:true,costoMermaFinal:99}, {...waste,id:'pending',provisionalClose:true,costoMermaFinal:99}, {...waste,id:'later',date:'2026-11-03',eventId:4,costoMermaFinal:8}]) tx.objectStore('reempaques').put(row);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }));
  await seed.addScriptTag({content:`const db=true; const REEMPAQUE_STORE_POS='reempaques'; const REEMPAQUE_MERMA_FINAL_TYPE_POS='REEMPAQUE_MERMA_FINAL_EVENTO';
    async function getAll(name){return new Promise((resolve,reject)=>{const r=indexedDB.open('a33-pos');r.onsuccess=()=>{const d=r.result;const q=d.transaction(name,'readonly').objectStore(name).getAll();q.onsuccess=()=>{d.close();resolve(q.result);};q.onerror=()=>reject(q.error);};r.onerror=()=>reject(r.error);});}
    ${posFunctions}`});
  async function snapshot(){ return seed.evaluate(async()=>{const names=['sales','events','products','banks','dailyClosures','cashV2','reempaques'];const out={};for(const name of names)out[name]=await getAll(name);return out;}); }
  const before = await snapshot();
  const pos = await seed.evaluate(async()=>{
    const sales=(await getAll('sales')).filter(row=>row.date>='2026-10-01'&&row.date<='2026-10-31');
    const merma=await reempaqueGetFinalMermaForSummaryPOS(null,'2026-10');
    return buildCorteSummaryRows('Octubre',sales,merma.cost);
  });
  const finance = await context.newPage(); finance.setDefaultTimeout(15000);
  await finance.goto(origin + '/finanzas/index.html');
  await finance.waitForFunction(()=>typeof finCachedData!=='undefined'&&!!finCachedData);
  await finance.evaluate(async()=>{document.getElementById('tab-mes').value='10';document.getElementById('tab-anio').value='2026';await refreshAllFin();});
  const fin = await finance.evaluate(()=>calcTableroClasificadoForFilter(finCachedData,{desde:'2026-10-01',hasta:'2026-10-31'}));
  assert.strictEqual(fin.readIntegrity.incomplete,false);assert.strictEqual(fin.stats.closureFallback,0,'No duplicate closure when raw sales exist');
  assert.strictEqual(fin.ingresosAdicionales,0);assert.strictEqual(fin.gastos,0);
  const analytics = await context.newPage(); analytics.setDefaultTimeout(15000);
  await analytics.goto(origin + '/analitica/index.html');
  async function range(from,to){await analytics.selectOption('#period-select','custom');await analytics.fill('#date-from',from);await analytics.fill('#date-to',to);await analytics.locator('#date-to').dispatchEvent('change');}
  await range('2026-10-01','2026-10-31');
  await analytics.waitForFunction(()=>document.getElementById('kpi-total-ventas').textContent.includes('300.00'));
  const expected = {revenue:300,paidCost:90,courtesyCost:30,gross:210,afterCourtesy:180,commission:4,afterCommission:176,merma:7,final:169};
  for(const [key,p,f] of [['revenue','ventaNeta','ventaNeta'],['paidCost','costoVentas','costosVentas'],['courtesyCost','costoCortesias','costoCortesias'],['gross','utilidadBruta','utilidadBruta'],['commission','comisionTarjetaTotal','comisionesTarjeta'],['merma','mermaFinalCosto','mermaFinal'],['final','utilidadDespuesMerma','utilidadNeta']]){
    assert.strictEqual(pos[p],expected[key],'POS '+key);assert.strictEqual(fin[f],expected[key],'Finance '+key);
  }
  assert.strictEqual(pos.utilidadDespuesCortesias,180);assert.strictEqual(pos.utilidadDespuesComision,176);
  assert.ok((await finance.locator('#tab-venta-neta').textContent()).includes('300.00'));
  assert.ok((await finance.locator('#tab-utilidad-neta').textContent()).includes('169.00'));
  for(const [id,value] of [['kpi-costos-ventas',90],['kpi-utilidad-bruta',210],['kpi-total-utilidad',180],['kpi-comisiones',4],['kpi-utilidad-despues-comision',176],['kpi-merma-final',7],['kpi-utilidad-despues-merma',169]])assert.ok((await analytics.locator('#'+id).textContent()).includes(value.toFixed(2)),id);
  async function workbook(page,action){const pending=page.waitForEvent('download');await action();const file=await pending;const stream=await file.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);return XLSX.read(Buffer.concat(chunks),{type:'buffer'});}
  await context.setOffline(true);
  const summaryBook=await workbook(analytics,()=>analytics.locator('#btn-export-resumen').click());
  const summary=XLSX.utils.sheet_to_json(summaryBook.Sheets.Resumen,{header:1});
  for(const [label,value] of [['Ventas totales',300],['Costo total',120],['Utilidad total',180],['Utilidad bruta',210],['Comisiones determinadas',4],['Merma final (C$)',7],['Utilidad después de comisión y merma',169]])assert.strictEqual(Number(summary.find(row=>row[1]===label)[2]),value,label);
  const scope=XLSX.utils.sheet_to_json(summaryBook.Sheets.Alcance,{header:1});assert.ok(scope.find(row=>row[0]==='Período')[1].includes('2026-10-31'));
  await analytics.locator('[data-tab="eventos"]').click();
  const eventsBook=await workbook(analytics,()=>analytics.locator('#btn-export-eventos').click());
  const eventRows=XLSX.utils.sheet_to_json(eventsBook.Sheets.Eventos,{header:1});
  const finalCol=eventRows[0].indexOf('Utilidad después de comisión y merma (C$)');
  assert.strictEqual(eventRows.slice(1).reduce((sum,row)=>sum+Number(row[finalCol]),0),169);
  await analytics.locator('[data-tab="presentaciones"]').click();
  const productsBook=await workbook(analytics,()=>analytics.locator('#btn-export-presentaciones').click());
  const productRows=XLSX.utils.sheet_to_json(productsBook.Sheets.Productos,{header:1});
  const preMermaCol=productRows[0].indexOf('Utilidad después de comisión (C$)');assert.strictEqual(productRows.slice(1).reduce((sum,row)=>sum+Number(row[preMermaCol]),0),176);
  for(const book of [summaryBook,eventsBook,productsBook])assert.ok(book.SheetNames.includes('Merma final'));
  // Explicit source differences, computed with the current Finance classifier, without writing records.
  const additional=await finance.evaluate(()=>calcTableroClasificadoForFilter({...finCachedData,
    receipts:[{id:'income',status:'ISSUED',dateISO:'2026-10-05',total:10,currency:'NIO',operationalClass:'ADDITIONAL_INCOME'}],
    entries:[...finCachedData.entries,{id:987,source:'manual_financial_account',fecha:'2026-10-05',baseAmountNio:4,operationalClass:'EXPENSE'}]
  },{desde:'2026-10-01',hasta:'2026-10-31'}));
  assert.strictEqual(additional.ingresosAdicionales,10);assert.strictEqual(additional.gastos,4);assert.strictEqual(additional.utilidadNeta,175,'Additional sources explain the difference');
  const fallback=await finance.evaluate(()=>calcTableroClasificadoForFilter({...finCachedData,posDailyClosures:[...finCachedData.posDailyClosures,{id:99,eventId:4,date:'2026-10-15',totals:{ventaNeta:20,costoVentasTotal:2}}]},{desde:'2026-10-01',hasta:'2026-10-31'}));
  assert.strictEqual(fallback.stats.closureFallback,1);assert.strictEqual(fallback.utilidadNeta,187,'Only a closure without individual sales is a fallback');
  // Actual Finance report export, not a synthetic workbook generator call.
  await finance.evaluate(()=>new Promise((resolve,reject)=>{
    const req=indexedDB.open('finanzasDB');req.onsuccess=()=>{const d=req.result;const tx=d.transaction(['journalEntries','journalLines'],'readwrite');
      tx.objectStore('journalEntries').put({id:91001,fecha:'2026-10-01',source:'pos',descripcion:'Asiento de prueba',totalDebe:300,totalHaber:300});
      tx.objectStore('journalLines').put({id:91001,idEntry:91001,accountCode:'1100',debe:300,haber:0});
      tx.objectStore('journalLines').put({id:91002,idEntry:91001,accountCode:'4100',debe:0,haber:300});
      tx.oncomplete=()=>{d.close();resolve();};tx.onerror=()=>reject(tx.error);
    };req.onerror=()=>reject(req.error);
  }));
  await finance.evaluate(async()=>{await refreshAllFin();document.getElementById('rep-balanza-desde').value='2026-10-01';document.getElementById('rep-balanza-hasta').value='2026-10-31';});
  const balanzaBook=await workbook(finance,()=>finance.evaluate(()=>exportBalanzaReportExcel()));
  const balance=XLSX.utils.sheet_to_json(balanzaBook.Sheets.Balanza,{header:1});
  assert.strictEqual(balance.find(row=>row[0]==='Total DEBE')[1],300);assert.strictEqual(balance.find(row=>row[0]==='Total HABER')[1],300);assert.strictEqual(balance.find(row=>row[0]==='Diferencia')[1],0);
  await analytics.locator('[data-tab="resumen"]').click();await range('2026-11-02','2026-11-02');
  await analytics.waitForFunction(()=>document.getElementById('kpi-utilidad-despues-merma').textContent.includes('parcial'));
  const missingPOS=await seed.evaluate(async()=>buildCorteSummaryRows('Unknown',(await getAll('sales')).filter(row=>row.date==='2026-11-02'),0));
  const missingFIN=await finance.evaluate(()=>calcTableroClasificadoForFilter(finCachedData,{desde:'2026-11-02',hasta:'2026-11-02',evento:'POS:3'}));
  assert.strictEqual(missingPOS.commissionUndeterminedCount,1);assert.strictEqual(missingFIN.comisionTarjetaNoDeterminada,1);assert.strictEqual(missingFIN.utilidadNeta,70);
  assert.ok((await analytics.locator('#kpi-utilidad-despues-merma').textContent()).includes('70.00'));
  await range('2026-11-03','2026-11-03');await analytics.waitForFunction(()=>document.getElementById('kpi-utilidad-despues-merma').textContent.includes('-8.00'));
  const onlyWasteFIN=await finance.evaluate(()=>calcTableroClasificadoForFilter(finCachedData,{desde:'2026-11-03',hasta:'2026-11-03',evento:'POS:4'}));assert.strictEqual(onlyWasteFIN.utilidadNeta,-8);
  assert.deepStrictEqual(await snapshot(),before,'All POS stores must remain intact');
  assert.deepStrictEqual(errors,[],'Page errors');
  console.log('APROBADA E4.7 Chrome: POS report functions + real Finance/Analytics pages on identical persisted fixtures; sales/costs/courtesy/commission/merma reconciled, source differences explained, 3 Analytics XLSX and actual Finance Balanza offline, unknown commission and waste-only period; all POS stores intact.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
