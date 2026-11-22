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
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await playwright.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1365,height:1000}});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/exportaciones/');
  await page.waitForFunction(()=>!document.getElementById('export-retry').hidden);
  await page.evaluate(async()=>{
    await openDB();
    await put('events',{id:1,name:'Evento A',groupName:'Grupo A'});
    await put('events',{id:2,name:'Evento B',groupName:'Grupo B'});
    await put('products',{id:1,productId:'prod-1',name:'Producto prueba',active:true,pos:true,receta:true,letra:'P',letter:'P',capacityMl:250,price:100});
    // Producto histórico incompleto: entrar al centro no debe asignarle identidad ni migrarlo.
    await put('products',{id:2,name:'Producto histórico',price:40});
    await put('sales',{id:1,eventId:1,eventName:'Evento A',date:'2026-11-19',productId:'prod-1',productName:'Producto prueba',qty:2,unitPrice:100,total:200,lineCost:60,customerId:'c1',customerName:'Cliente real',payment:'efectivo',loteCodigo:'001-A'});
    await put('sales',{id:2,eventId:2,eventName:'Evento B',date:'2026-11-18',productId:'prod-1',productName:'Producto prueba',qty:1,unitPrice:100,total:100,lineCost:30,payment:'efectivo',loteCodigo:'002-B'});
    localStorage.setItem('a33_pos_customersCatalog',JSON.stringify([{id:'c1',name:'Cliente real',cellular:'88889999',active:true}]));
    localStorage.setItem('arcano33_lotes',JSON.stringify([{id:'live',codigo:'001-A',createdAt:'2026-11-19T12:00:00Z',fecha:'2026-11-19',caducidad:'2026-12-19',notas:'Lote vigente',productosProducidos:[{productId:'prod-1',Letra:'P',cantidad:6}]}]));
    localStorage.setItem('arcano33_lotes_archived',JSON.stringify([{originalId:'old',codigo:'0005',createdAt:'2026-11-18T12:00:00Z',deletedAt:'2026-11-18T13:00:00Z',djeba:'4',notas:'Lote archivado'}]));
    localStorage.setItem('arcano33_pedidos',JSON.stringify([{id:'order-1',codigo:'P1',cliente:'Cliente real',fechaEntrega:'2026-11-25',estado:'pendiente',items:[{productId:'prod-1',productNameSnapshot:'Producto prueba',qty:3,unitPriceSnapshot:100}]}]));
    localStorage.setItem('arcano33_pedidos_rapidos_v1',JSON.stringify([{id:'quick-1',codigo:'R1',customerName:'Cliente rápido',fechaEntrega:'2026-11-25',estado:'pendiente',items:[{productId:'prod-1',productNameSnapshot:'Producto prueba',cantidad:2}]}]));
    localStorage.setItem('arcano33_inventario',JSON.stringify({finishedByProductId:{'prod-1':{qty:20}}}));
    localStorage.setItem('arcano33_recetas_v1',JSON.stringify({costosPresentacion:{}}));
    localStorage.setItem('a33_e3_marker','conservar');
    await (await caches.open('a33-e3-other-module')).put('/marker',new Response('conservar'));
  });
  const snapshot=()=>page.evaluate(async()=>{
    const request=indexedDB.open('a33-pos');
    const database=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const rows={};
    for(const name of Array.from(database.objectStoreNames)) rows[name]=await new Promise((resolve,reject)=>{const tx=database.transaction(name,'readonly'),r=tx.objectStore(name).getAll();tx.oncomplete=()=>resolve(r.result);tx.onabort=()=>reject(tx.error);});
    database.close();return {db:JSON.stringify(rows),storage:JSON.stringify(Object.entries(localStorage).sort())};
  });
  const before=await snapshot();
  const captures={};
  async function open(module){
    await page.goto(origin+`/exportaciones/${module}.html`);
    await page.waitForFunction(()=>!document.getElementById('module-export-fields').disabled || !document.getElementById('module-export-retry').hidden);
    assert.equal(await page.getAttribute('#module-export-status','data-error'),'false',await page.textContent('#module-export-status'));
    assert.equal(await page.locator('.export-modules a').count(),6);
    await page.evaluate(()=>{
      window.downloads=[];window.realWriteFile=XLSX.writeFile;
      XLSX.writeFile=(book,filename)=>{const parsed=XLSX.read(XLSX.write(book,{type:'array',bookType:'xlsx'}),{type:'array'});downloads.push({filename,sheets:parsed.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(parsed.Sheets[name],{header:1,defval:''})}))});};
    });
  }
  async function download(action){
    const previous=await page.evaluate(()=>downloads.length);await action();
    await page.waitForFunction(count=>downloads.length>count || document.getElementById('module-export-status').dataset.error==='true',previous);
    assert.equal(await page.getAttribute('#module-export-status','data-error'),'false',await page.textContent('#module-export-status'));
    return page.evaluate(()=>downloads.at(-1));
  }
  await open('analitica');
  await page.selectOption('#period-select','all');
  const events=await download(()=>page.click('#btn-export-eventos'));assert.equal(events.filename,'analitica_eventos.xlsx');assert.equal(events.sheets[0].rows.length,3);
  const products=await download(()=>page.click('#btn-export-presentaciones'));assert.equal(products.filename,'analitica_productos.xlsx');
  await page.click('#btn-export-consolidado');
  const form=page.locator('#analytics-export-form');await form.locator('[name="section"][value="Clientes"]').check();await form.locator('[name="customerNames"]').check();
  const consolidated=await download(()=>form.locator('[type="submit"]').click());assert.equal(consolidated.filename,'analitica_consolidada.xlsx');assert.ok(consolidated.sheets.some(sheet=>sheet.name==='Clientes por producto'));
  // Grupo y evento: mismo selector del módulo original, sin mezclar eventos homónimos ni grupos.
  await page.selectOption('#analytics-event-picker-group','group:Grupo A');
  const oneEvent=await download(()=>page.click('#btn-export-eventos'));assert.equal(oneEvent.sheets[0].rows.length,2);assert.match(JSON.stringify(oneEvent),/Evento A/);assert.ok(!JSON.stringify(oneEvent.sheets[0]).includes('Evento B'));
  await page.click('#btn-export-consolidado');await form.locator('[name="section"]').evaluateAll(inputs=>inputs.forEach(input=>{input.checked=false;}));await form.locator('[type="submit"]').click();assert.match(await page.textContent('#analytics-export-error'),/al menos una sección/);await page.click('#btn-cancel-export');
  captures.analitica=consolidated;
  await open('pedidos');
  const orders=await download(()=>page.locator('#module-export-form [type="submit"]').click());assert.ok(orders.sheets.some(sheet=>sheet.name==='Pedidos rápidos'));assert.ok(orders.sheets.some(sheet=>sheet.name==='Entregas'));assert.ok(orders.sheets.some(sheet=>sheet.name==='Lotes vinculados'));
  await page.selectOption('#module-export-report','demand');await page.fill('#pedido-demanda-desde','2026-11-01');await page.fill('#pedido-demanda-hasta','2026-11-30');
  const demand=await download(()=>page.locator('#module-export-form [type="submit"]').click());assert.equal(demand.filename,'demanda_pedidos.xlsx');assert.ok(demand.sheets.some(sheet=>sheet.name==='Disponibilidad'));assert.equal(demand.sheets.find(sheet=>sheet.name==='Demanda').rows[1][5],5);
  await page.fill('#pedido-demanda-desde','2026-12-01');await page.locator('#module-export-form [type="submit"]').click();await page.waitForFunction(()=>document.getElementById('module-export-status').dataset.error==='true');assert.match(await page.textContent('#module-export-status'),/Desde/);
  captures.pedidos=demand;
  await open('lotes');
  const lots=await download(()=>page.locator('#module-export-form [type="submit"]').click());assert.equal(lots.sheets[0].name,'Lotes');assert.equal(lots.sheets[0].rows.length,3);assert.match(JSON.stringify(lots),/Eliminado/);assert.match(JSON.stringify(lots),/0005/);captures.lotes=lots;
  // Descarga real desde el nuevo centro.
  await page.evaluate(()=>{XLSX.writeFile=realWriteFile;});const actual=page.waitForEvent('download');await page.locator('#module-export-form [type="submit"]').click();assert.match((await actual).suggestedFilename(),/arcano33_lotes_.*\.xlsx/);
  await open('catalogos');
  const customers=await download(()=>page.locator('#module-export-form [type="submit"]').click());assert.equal(customers.filename,'A33_Clientes.xlsx');assert.match(JSON.stringify(customers),/Cliente real/);
  await page.selectOption('#module-export-report','share');assert.equal(await page.locator('#module-export-form [type="submit"]').isDisabled(),true);
  await page.check('#includePhone');
  const shared=await download(()=>page.locator('#module-export-form [type="submit"]').click());assert.equal(shared.filename,'A33_Clientes_Compartir.xlsx');assert.ok(!JSON.stringify(shared).includes('Cliente real'));
  await page.check('#includeHistory');const sharedHistory=await download(()=>page.locator('#module-export-form [type="submit"]').click());assert.ok(sharedHistory.sheets[0].rows[0].length>1);captures.catalogos=sharedHistory;
  assert.deepEqual(await snapshot(),before,'Las cuatro pantallas no migran productos ni modifican datos/históricos/preferencias');
  await page.evaluate(async()=>{
    const db = await A33Exports.openExisting('a33-pos');
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('products','readwrite');
      tx.objectStore('products').put({id:3,productId:'new-dynamic',name:'Dinámico 100 ml',capacityMl:100,active:true,receta:true});
      tx.objectStore('products').put({id:4,productId:'inactive',name:'Inactivo',active:false,receta:true});
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
    });
    localStorage.setItem('arcano33_recetas_v1',JSON.stringify({recetas:{'prod-1':{vino:70,vodka:15,jugo:25,sirope:20,agua:20},'new-dynamic':{vino:10}}}));
    localStorage.setItem('a33_catalogos_costos_v1',JSON.stringify({liquids:Object.fromEntries(['vino','vodka','jugo','sirope','agua_pura'].map(key=>[key,{price:100,ml:1000}])),consumablesByProduct:{'prod-1':{botella:14,calcomania:3.5},'new-dynamic':{botella:2,calcomania:1}}}));
  });
  const costsBefore=await snapshot();
  await page.selectOption('#module-export-report','costs');
  const costs=await download(()=>page.locator('#module-export-form [type="submit"]').click());
  assert.equal(costs.filename,'A33_Costos.xlsx');
  const rows=costs.sheets[0].rows;
  assert.deepEqual(rows[0],['Referencia','Precio (C$)','Contenido (ml)','Dinámico\n100 ml','Producto prueba\n250 ml']);
  assert.equal(rows[1][3],1);assert.equal(rows[1][4],7);
  assert.equal(rows.at(-1)[3],4);assert.equal(rows.at(-1)[4],33);
  assert.deepEqual(await snapshot(),costsBefore,'Exportar costos solo lee datos');
  await page.evaluate(()=>{const state=JSON.parse(localStorage.getItem('a33_catalogos_costos_v1'));state.liquids.vino.price=null;localStorage.setItem('a33_catalogos_costos_v1',JSON.stringify(state));});
  const pending=await download(()=>page.locator('#module-export-form [type="submit"]').click());
  assert.equal(pending.sheets[0].rows[1][3],'Pendiente');assert.match(pending.sheets[0].rows.at(-1)[3],/Pendiente/);
  await page.evaluate(()=>{XLSX.writeFile=realWriteFile;});
  const actualCosts=page.waitForEvent('download');await page.locator('#module-export-form [type="submit"]').click();assert.equal((await actualCosts).suggestedFilename(),'A33_Costos.xlsx');
  assert.deepEqual(errors,[]);
  console.log('PASS: Costos dinámicos, orden, desglose, redondeo, pendientes, descarga XLSX real, lectura sin cambios y regresión de Clientes y otros módulos.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
