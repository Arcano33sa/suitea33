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
  const context = await browser.newContext({serviceWorkers:'allow', viewport:{width:1365,height:1000}});
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/exportaciones/finanzas.html');
  await page.waitForFunction(() => !document.getElementById('finance-export-retry').hidden);
  assert.match(await page.textContent('#finance-exports-status'), /base de Finanzas/);
  // Solo fixtures en un contexto y origen desechables. Nunca usar un perfil del usuario.
  await page.evaluate(async () => {
    await openFinDB();
    const accounts = [
      {code:'1100',nombre:'Caja prueba',tipo:'activo'},
      {code:'4000',nombre:'Ingresos prueba',tipo:'ingreso'},
      {code:'5100',nombre:'Costo prueba',tipo:'costo'},
      {code:'6000',nombre:'Gastos prueba',tipo:'gasto'}
    ];
    for (const account of accounts) await finPut('accounts',{...account,isActive:true,isPostable:true,accountMode:'postable'});
    await finPut('financialAccounts',{id:'caja-nio',nombreVisible:'Caja prueba',moneda:'NIO',type:'caja',cuentaContableCodigo:'1100',activa:true});
    await finPut('suppliers',{id:1,nombre:'Proveedor histórico',activo:true});
    const entries = [
      {id:1,fecha:'2026-11-19',descripcion:'Venta prueba',tipoMovimiento:'ingreso',origen:'Manual',evento:'Feria',posEventId:17,totalDebe:100,totalHaber:100,financialAccountId:'caja-nio'},
      {id:2,fecha:'2026-11-19',descripcion:'Costo prueba',tipoMovimiento:'egreso',origen:'Compra',supplierId:1,supplierName:'Proveedor histórico',totalDebe:30,totalHaber:30},
      {id:3,fecha:'2026-10-19',descripcion:'Otro mes',tipoMovimiento:'ingreso',origen:'Manual',totalDebe:200,totalHaber:200}
    ];
    for (const row of entries) await finPut('journalEntries',row);
    for (const row of [
      {id:1,idEntry:1,accountCode:'1100',debe:100,haber:0,originalCurrency:'NIO',originalAmount:100,financialAccountId:'caja-nio'},
      {id:2,idEntry:1,accountCode:'4000',debe:0,haber:100},
      {id:3,idEntry:2,accountCode:'5100',debe:30,haber:0},
      {id:4,idEntry:2,accountCode:'1100',debe:0,haber:30},
      {id:5,idEntry:3,accountCode:'1100',debe:200,haber:0},
      {id:6,idEntry:3,accountCode:'4000',debe:0,haber:200}
    ]) await finPut('journalLines',row);
    const sections = {proveedores:[{id:'line-1',supplierId:1,supplierName:'Proveedor histórico',product:'Materia prueba',unit:'unidad',quantity:2,price:15}],varias:[]};
    await finPut('settings',{id:PC_CURRENT_KEY,data:{notes:'Actual conservada',sections,updatedAtISO:'2026-11-19T10:00:00Z',updatedAtDisplay:'19/11/2026 10:00'}});
    await finPut('settings',{id:PC_HISTORY_KEY,data:{version:1,history:[{id:'hist-1',notes:'Histórico conservado',sections,createdAtISO:'2026-10-19T10:00:00Z',createdAtDisplay:'19/10/2026 10:00'},{notes:'Sin identificador histórico',sections,createdAtISO:'2026-09-19T10:00:00Z',createdAtDisplay:'19/09/2026 10:00'}]}});
    const receipt = {receiptId:'receipt-1',number:'0001',status:'ISSUED',dateISO:'2026-11-19',clientName:'Cliente <seguro>',paymentType:'CASH',originalCurrency:'NIO',totals:{subtotal:100,total:100,discountTotal:0},lines:[{itemName:'Producto recibo',qty:1,unitPrice:100,lineTotal:100,discountPerUnit:0}]};
    await finPut('receipts',receipt);
    await finPut('receipts',{...receipt,receiptId:'receipt-2',number:'0002',status:'VOID',clientName:'Anulado'});
    await finPut('receipts',{...receipt,receiptId:'draft-1',number:null,status:'DRAFT'});
    await new Promise((resolve,reject) => {
      const request = indexedDB.open('a33-pos',37);
      request.onupgradeneeded = () => {for(const name of ['sales','events','banks','dailyClosures','cashV2','reempaques']) request.result.createObjectStore(name,{keyPath:'id'});};
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {const database=request.result,tx=database.transaction('events','readwrite');tx.objectStore('events').put({id:17,name:'Feria',closedAt:'2026-11-19'});tx.oncomplete=()=>{database.close();resolve();};};
    });
    localStorage.setItem('suite_a33_identity_v1',JSON.stringify({commercialName:'Identidad E2',taxId:'PRIVADO'}));
    localStorage.setItem('suite_a33_reports_preferences_v1',JSON.stringify({identityFields:{taxId:false},privacy:{showCosts:false,showProfit:false}}));
    localStorage.setItem('a33_preserve_marker','conservar');
    await (await caches.open('a33-e2-preserve-cache')).put('/marker',new Response('conservar'));
  });
  await page.reload(); await page.waitForFunction(() => !document.getElementById('finance-exports-fields').disabled);
  const snapshot = () => page.evaluate(async () => {
    const result = {};
    for (const name of Array.from(finDB.objectStoreNames)) result[name] = await finGetAll(name);
    // El Excel de catálogo conserva su caché original de conteos; no es dato operativo.
    return {data:JSON.stringify(result),storage:JSON.stringify(Object.entries(localStorage).filter(([key])=>key!==CAT_USAGE_CACHE_KEY).sort())};
  });
  const before = await snapshot();
  assert.equal(await page.locator('#finance-export-report option').count(),14);
  assert.equal(await page.locator('#finance-export-receipt option').count(),3,'Se excluyen borradores');
  await page.evaluate(() => {
    window.downloads=[];window.originalWriteFile=XLSX.writeFile;
    XLSX.writeFile=(book,filename)=>{const roundtrip=XLSX.read(XLSX.write(book,{type:'array',bookType:'xlsx'}),{type:'array'});downloads.push({filename,sheets:roundtrip.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(roundtrip.Sheets[name],{header:1,defval:''})}))});};
  });
  async function run(report, setup = async () => {}) {
    await page.selectOption('#finance-export-report',report);await setup();
    const count=await page.evaluate(()=>downloads.length);
    await page.click('#finance-export-download');
    await page.waitForFunction(previous=>downloads.length>previous || document.getElementById('finance-exports-status').dataset.error==='true',count);
    assert.equal(await page.getAttribute('#finance-exports-status','data-error'),'false',await page.textContent('#finance-exports-status'));
    await page.waitForFunction(()=>!document.getElementById('finance-exports-fields').disabled);
    return page.evaluate(()=>downloads.at(-1));
  }
  const diary=await run('diary',async()=>{await page.fill('#diario-desde','2026-11-01');await page.fill('#diario-hasta','2026-11-30');});
  assert.match(JSON.stringify(diary),/Venta prueba/);assert.ok(!JSON.stringify(diary).includes('Otro mes'));assert.ok(diary.sheets.some(sheet=>sheet.name==='Moneda'));
  // Una descarga real además de inspeccionar los libros serializados.
  await page.evaluate(()=>{window.captureWriteFile=XLSX.writeFile;XLSX.writeFile=originalWriteFile;});
  const actualDownload=page.waitForEvent('download');await page.click('#finance-export-download');assert.match((await actualDownload).suggestedFilename(),/\.xlsx$/);
  await page.waitForFunction(()=>!document.getElementById('finance-exports-fields').disabled);await page.evaluate(()=>{XLSX.writeFile=captureWriteFile;});
  const current=await run('current');assert.match(JSON.stringify(current),/Actual conservada/);
  const history=await run('history',()=>page.selectOption('#finance-export-history','hist-1'));assert.match(JSON.stringify(history),/Histórico conservado/);
  const legacyId=await page.locator('#finance-export-history option').filter({hasText:'Sin identificador histórico'}).getAttribute('value');
  const legacy=await run('history',()=>page.selectOption('#finance-export-history',legacyId));assert.match(JSON.stringify(legacy),/Sin identificador histórico/);
  const catalog=await run('catalog');assert.ok(catalog.sheets.some(sheet=>sheet.name==='Cuentas'));
  const er=await run('er',async()=>{await page.selectOption('#er-modo','rango');await page.fill('#er-desde','2026-11-01');await page.fill('#er-hasta','2026-11-30');await page.selectOption('#er-evento','ALL');});
  assert.deepEqual(er.sheets[0].rows.find(row=>String(row[0]).startsWith('Ingresos')),['Ingresos (4xxx)',100]);
  const shared=await run('share');assert.match(JSON.stringify(shared),/Identidad E2/);assert.ok(!JSON.stringify(shared).includes('PRIVADO'));assert.ok(!JSON.stringify(shared.sheets[0].rows).includes('Utilidad neta'));
  const balance=await run('balance',()=>page.fill('#bg-fecha','2026-11-30'));assert.equal(balance.sheets[0].name,'BalanceGeneral');
  const flow=await run('flow');assert.equal(flow.sheets[0].name,'FlujoCaja');assert.equal(await page.locator('[data-fin-field="er-evento"]').isVisible(),false);
  const mayor=await run('mayor',()=>page.selectOption('#rep-mayor-cuenta','1100'));assert.equal(mayor.sheets[0].name,'Mayor');
  const account=await run('account',()=>page.selectOption('#rep-estado-fa','caja-nio'));assert.equal(account.sheets[0].name,'EstadoCuenta');
  const balanza=await run('balanza');assert.equal(balanza.sheets[0].name,'Balanza');
  const book=await run('book');assert.equal(book.sheets[0].name,'LibroDiario');
  const currency=await run('currency');assert.equal(currency.sheets[0].name,'ResumenMoneda');
  assert.deepEqual(await snapshot(),before,'Sin cambios en asientos, cuentas, recibos, settings ni preferencias persistidas');
  // Un pulso de otra pestaña no inicia conciliaciones operativas desde el centro.
  await page.evaluate(()=>{window.autoRefresh=0;window.originalRefreshAllFin=refreshAllFin;refreshAllFin=async()=>{autoRefresh++;};dispatchEvent(new StorageEvent('storage',{key:'a33_pos_credit_finance_pulse'}));});
  assert.equal(await page.evaluate(()=>autoRefresh),0);await page.evaluate(()=>{refreshAllFin=originalRefreshAllFin;});
  // Paridad con las funciones que usaban los botones originales.
  await page.evaluate(async()=>{await exportDiarioExcel();await exportEstadoResultadosExcel();await exportEstadoResultadosExcel({share:true});});
  const direct=await page.evaluate(()=>downloads.slice(-3));
  assert.deepEqual(direct,[diary,er,shared]);
  await page.selectOption('#finance-export-report','receipt');await page.selectOption('#finance-export-receipt','receipt-1');
  await page.evaluate(()=>{window.printed=0;window.print=()=>{printed++;window.receiptMarkup=document.getElementById('rc-print-root').innerHTML;};});
  await page.click('#finance-export-download');await page.waitForFunction(()=>printed===1);
  assert.equal(await page.locator('.rc-receipt-copy').count(),2);
  assert.equal(await page.locator('.rc-print-meta img').count(),0);
  assert.match(await page.evaluate(()=>receiptMarkup),/Cliente &lt;seguro&gt;/);
  await page.waitForFunction(()=>document.querySelector('.rc-print-logo').naturalWidth>0);
  await page.emulateMedia({media:'print'});
  assert.equal(await page.locator('main').isVisible(),false,'Solo se imprime el recibo');
  await page.screenshot({path:'/tmp/a33-exportaciones-e2-recibo.png',fullPage:true});
  await page.emulateMedia({media:'screen'});await page.evaluate(()=>dispatchEvent(new Event('afterprint')));
  await page.selectOption('#finance-export-receipt','receipt-2');await page.click('#finance-export-download');await page.waitForFunction(()=>printed===2);await page.evaluate(()=>dispatchEvent(new Event('afterprint')));
  assert.deepEqual(await snapshot(),before,'Imprimir no cambia recibos ni consecutivos');
  // Registro retirado en otra pestaña: informa el problema en lugar de imprimir datos antiguos.
  await page.evaluate(()=>finDelete('receipts','receipt-2'));await page.click('#finance-export-download');
  await page.waitForFunction(()=>document.getElementById('finance-exports-status').dataset.error==='true');assert.match(await page.textContent('#finance-exports-status'),/ya no está disponible/);
  await page.selectOption('#finance-export-report','diary');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{A33Theme.apply('light');document.querySelectorAll('.a33-notice').forEach(item=>item.remove());scrollTo(0,0);});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await page.evaluate(()=>document.querySelector('main').getBoundingClientRect().top>=document.querySelector('.a33-header').getBoundingClientRect().bottom),'El encabezado no tapa el contenido');
  await page.screenshot({path:'/tmp/a33-exportaciones-e2-mobile.png',fullPage:true});
  await page.setViewportSize({width:1365,height:1000});await page.evaluate(()=>{A33Theme.apply('dark');scrollTo(0,0);});await page.screenshot({path:'/tmp/a33-exportaciones-e2-desktop.png',fullPage:true});
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);await page.reload();await page.waitForFunction(()=>!document.getElementById('finance-exports-fields').disabled);
  assert.equal(await page.locator('#finance-export-report option').count(),14);
  assert.equal(await page.evaluate(()=>caches.has('a33-e2-preserve-cache')),true);
  await context.setOffline(false);
  await page.goto(origin+'/finanzas/');await page.waitForFunction(()=>!!finCachedData && document.getElementById('recibos-editor')?.dataset.pendingBound==='1');
  assert.equal(await page.locator('#btn-import-pos-closures').count(),1);
  assert.equal(await page.locator('button').filter({hasText:/Exportar.*Excel|Compartir Excel|Imprimir\/PDF/}).count(),0);
  await page.click('[data-view="recibos"]');assert.equal(await page.locator('[data-act="print"]').count(),0);assert.ok(await page.locator('[data-act="view"]').count());
  await page.evaluate(()=>setActiveFinView('comprasplan'));
  assert.equal(await page.locator('#pc-history-tbody button').filter({hasText:/^Excel$/}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS E2: 13 Excel serializados, descarga real, filtros existentes, identidad/privacidad, moneda, paridad, recibos emitidos/anulados, dos copias y logo, histórico eliminado, datos intactos, móvil, offline y Finanzas operativo.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
