'use strict';
// Navegador con contexto temporal y origen localhost aleatorio: nunca usa datos reales.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');
let playwright;
try{ playwright = require('playwright'); }
catch(_){ playwright = require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = path.resolve(__dirname,'..');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end();}else{res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}});
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/pos/index.html`;
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser=await playwright.chromium.launch({headless:true,...(fs.existsSync(chrome)?{executablePath:chrome}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(()=>document.getElementById('purchase-modal')?.dataset.bound==='1');
  await page.evaluate(async()=>{
    await put('products',{id:9101,productId:'test-a',name:'Prueba A',price:100,unitCost:20,pos:true,isActive:true,manageStock:true});
    await put('products',{id:9102,productId:'test-b',name:'Prueba B',price:50,unitCost:10,pos:true,isActive:true,manageStock:true});
    await put('products',{id:9103,productId:'test-off',name:'No disponible',price:30,pos:false,isActive:true});
    await put('events',{id:9100,name:'Evento Prueba',groupName:'Grupo Prueba',saleSeq:0,extras:[{id:1,name:'Extra Prueba',stock:10,unitCost:5,unitPrice:20,active:true}]});
    await put('inventory',{id:9101,eventId:9100,productId:9101,qty:10,type:'restock',date:'2026-10-01',unitCost:20});
    await put('inventory',{id:9102,eventId:9100,productId:9102,qty:10,type:'restock',date:'2026-10-01',unitCost:10});
    await put('banks',{id:9101,name:'Banco Prueba',type:'tarjeta',commissionPct:7,isActive:true});
    await put('banks',{id:9102,name:'Transferencia Prueba',type:'transferencia',commissionPct:0,isActive:true});
    A33Storage.sharedSet('a33_pos_customersCatalog',[{id:'test-c',name:'Cliente Prueba',isActive:true,createdAt:'2026-10-01'}],{source:'test'});
    A33Storage.sharedSet('suite_a33_currency_settings_v1',{exchangeRate:'36.80'},{source:'test'});
    await setMeta('currentEventId',9100);
    document.getElementById('sale-date').value='2026-10-01';
    await refreshEventUI(); await renderDay();
  });
  const sell=page.getByRole('button',{name:'VENDER',exact:true});
  const modal=page.locator('#purchase-modal');
  const add=async name=>page.getByRole('button',{name:'Agregar '+name,exact:true}).click();
  const pick=async()=>{await page.locator('#btn-pick-customer').click();await page.getByRole('button',{name:'Cliente Prueba',exact:true}).click();};
  const sales=()=>page.evaluate(()=>getAll('sales'));
  const open=async()=>{await sell.click();await modal.waitFor({state:'visible'});};
  const save=async()=>{await page.locator('#purchase-save').click();await modal.waitFor({state:'hidden'});};
  // Botón verde, catálogo habilitado, búsqueda y cancelación sin ventas ni stock.
  assert.equal(await sell.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(29, 185, 84)');
  await open();assert.equal(await page.locator('#purchase-save').isDisabled(),true);
  assert.equal(await page.locator('#purchase-title').evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.left+4,r.top+4)===el;}),true);
  assert.equal(await page.getByRole('button',{name:'Agregar No disponible',exact:true}).count(),0);
  await page.locator('#purchase-search').fill('Prueba A');assert.equal(await page.locator('.purchase-product').count(),1);
  await add('Prueba A');await page.locator('#purchase-search').fill('');await add('Prueba B');
  await pick();await page.locator('#purchase-cancel').click();assert.equal((await sales()).length,0);
  assert.equal(await page.evaluate(()=>document.getElementById('sale-customer').value),'');
  assert.equal(await page.evaluate(async()=>computeStock(9100,(await getAll('products')).find(p=>p.productId==='test-a'))),10);
  // Compra normal: varios productos + extra, descuento por unidad y cliente común.
  await open();await add('Prueba A');await add('Prueba B');await add('Extra Prueba');
  assert.equal(await page.locator('#purchase-discountPerUnit-0').inputValue(),'');
  for (const [field,value] of [['qty','2'],['unitPrice','100'],['discountPerUnit','5']]){
    const input=page.locator('#purchase-'+field+'-0');
    await input.fill(value);await input.click();await page.keyboard.type('3');
    assert.equal(await input.inputValue(),'3');
    await input.click();await page.keyboard.type(value);
    assert.equal(await input.inputValue(),value);
  }
  await page.locator('#purchase-qty-0').fill('2');await page.locator('#purchase-discountPerUnit-0').fill('5');
  assert.equal(await page.locator('#purchase-total-display').textContent(),'260.00');
  await pick();await page.locator('#purchase-more-options summary').click();await page.locator('#sale-notes').fill('Compra de prueba');
  await page.locator('.a33-notice').first().waitFor({state:'hidden'});
  await page.locator('.purchase-panel').evaluate(el=>{el.scrollTop=0;});
  await page.screenshot({path:path.join(os.tmpdir(),'a33-pos-compra-e2-desktop.png'),fullPage:true});
  for(const [width,height,label] of [[768,1024,'tablet'],[390,844,'mobile']]){
    await page.setViewportSize({width,height});
    assert.equal(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    assert.equal(await page.locator('.purchase-panel').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await page.locator('.purchase-panel').evaluate(el=>{el.scrollTop=0;});
    await page.screenshot({path:path.join(os.tmpdir(),`a33-pos-compra-e2-${label}.png`),fullPage:true});
  }
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>Promise.all([submitPurchaseModalPOS(),submitPurchaseModalPOS()]));
  await modal.waitFor({state:'hidden'});
  let rows=await sales();assert.equal(rows.length,3);assert.equal(new Set(rows.map(s=>s.purchaseUid)).size,1);
  assert.equal(rows.reduce((sum,s)=>sum+s.total,0),260);assert.equal(rows[0].discount,10);
  assert(rows.every(s=>s.customerId==='test-c'&&s.notes==='Compra de prueba'));
  assert.equal(await page.evaluate(async()=>(await getEventByIdPOS(9100)).extras[0].stock),9);
  assert.equal(await page.locator('#tbl-day button.del-sale:disabled').count(),3);
  // USD con vuelto sobre toda la compra y cortesía por producto.
  await open();await add('Prueba A');await add('Prueba B');await pick();
  await page.locator('#purchase-more-options summary').click();await page.getByLabel('Cortesía: Prueba B',{exact:true}).check();
  assert.equal(await page.locator('#purchase-total-display').textContent(),'100.00');
  await page.locator('#sale-cash-mode').selectOption('usd_change_nio');await page.locator('#sale-cash-usd-received').fill('10');
  assert.equal(await page.locator('#sale-cash-change').inputValue(),'268.00');
  await save();rows=await sales();const usd=rows.slice(3);
  assert.equal(usd.reduce((sum,s)=>sum+s.cashExpectedDelta.USD,0),10);
  assert.equal(usd.reduce((sum,s)=>sum+s.cashExpectedDelta.NIO,0),-268);
  assert.equal(usd.filter(s=>s.purchaseTenderOwner).length,1);assert.equal(usd[1].courtesy,true);
  // Tarjeta: banco requerido y comisión congelada por producto.
  await open();await add('Prueba A');await add('Prueba B');await pick();
  await page.locator('#sale-payment').selectOption('tarjeta');
  await page.locator('#sale-cash-tender-card').waitFor({state:'hidden'});
  await page.locator('#purchase-save').click();await page.locator('#purchase-error').waitFor({state:'visible'});
  assert.equal((await sales()).length,5);
  await page.locator('#sale-bank').selectOption('9101');await save();rows=await sales();
  assert.equal(rows.length,7);assert.equal(rows.slice(5).reduce((sum,s)=>sum+s.commissionAmountSnapshot,0),10.5);
  // Devolución separada: cantidades negativas, cortesías desactivadas y extra restituido.
  await open();await add('Prueba A');await add('Extra Prueba');await pick();
  await page.locator('#purchase-more-options summary').click();await page.locator('#sale-return').check();
  assert.equal(await page.getByLabel('Cortesía: Prueba A',{exact:true}).isDisabled(),true);
  assert.equal(await page.locator('#purchase-title').textContent(),'Nueva devolución');
  assert.equal(await page.locator('#purchase-total-display').textContent(),'-120.00');await save();
  rows=await sales();assert.equal(rows.length,9);assert(rows.slice(7).every(s=>s.isReturn&&s.qty===-1));
  assert.equal(await page.evaluate(async()=>(await getEventByIdPOS(9100)).extras[0].stock),10);
  // Crédito sin cliente y stock insuficiente de extra no guardan ninguna línea.
  await open();await add('Prueba A');await page.locator('#sale-payment').selectOption('credito');
  await page.locator('#purchase-save').click();await page.locator('#purchase-error').waitFor({state:'visible'});
  assert.match(await page.locator('#purchase-error').textContent(),/cliente.*crédito/);await page.locator('#purchase-cancel').click();
  await open();await add('Prueba A');await add('Extra Prueba');await pick();await page.locator('#purchase-qty-1').fill('11');
  await page.locator('#purchase-save').click();await page.locator('#purchase-error').waitFor({state:'visible'});
  assert.match(await page.locator('#purchase-error').textContent(),/Stock insuficiente/);assert.equal((await sales()).length,9);
  await page.locator('#purchase-cancel').click();
  // Descuentos inválidos deshabilitan Guardar; Escape del picker conserva la compra.
  await open();await add('Prueba A');await page.locator('#purchase-discountPerUnit-0').fill('101');
  assert.equal(await page.locator('#purchase-save').isDisabled(),true);
  await page.locator('#btn-new-customer').click();await page.locator('#customer-quick-modal').waitFor({state:'visible'});
  await page.keyboard.press('Escape');assert.equal(await modal.isVisible(),true);assert.equal(await modal.evaluate(el=>el.inert),false);
  await page.locator('#btn-pick-customer').click();await page.keyboard.press('Escape');assert.equal(await modal.isVisible(),true);
  await page.keyboard.press('Escape');assert.equal(await modal.isVisible(),false);
  assert.equal((await sales()).length,9);
  await open();await add('Prueba B');await pick();await page.locator('#sale-payment').selectOption('transferencia');
  await page.locator('#sale-bank').selectOption('9102');await save();
  rows=await sales();assert.equal(rows.length,10);assert.equal(rows[9].payment,'transferencia');assert.equal(rows[9].bankType,'transferencia');
  await open();await add('Prueba B');await pick();await page.locator('#sale-payment').selectOption('credito');await save();
  rows=await sales();assert.equal(rows.length,11);assert.equal(rows[10].payment,'credito');assert.equal(rows[10].customerId,'test-c');
  await page.evaluate(async()=>{await upsertDayLockPOS(9100,'2026-10-01',{isClosed:true});await updateSellEnabled();await openPurchaseModalPOS();});
  assert.equal(await sell.isDisabled(),true);assert.equal(await modal.isVisible(),false);
  assert.equal((await sales()).length,11);assert.deepEqual(errors,[]);
  console.log('PASS browser E2: modal, cancelar, NIO, USD, cortesías, tarjeta, devolución, extras, crédito, stock, foco y tamaños desktop/tablet/mobile.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
