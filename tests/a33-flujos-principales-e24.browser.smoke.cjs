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
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  browser=await playwright.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  const origin='http://127.0.0.1:'+server.address().port;
  const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  // Navegación real por ocho apartados y recuperación con Atrás.
  await page.goto(origin+'/catalogos/index.html');
  await page.locator('.cat-tab[data-target="productos"]').waitFor();
  for(const section of ['productos','costos','materia-prima','envases','tapas','extras','bancos','clientes']){
    await page.locator('.cat-tab[data-target="'+section+'"]').click();
    await page.locator('.cat-panel[data-panel="'+section+'"]').waitFor({state:'visible'});
    assert.equal(await page.locator('.cat-panel:visible').count(),1);
    await page.goBack();
    await page.locator('.cat-tabs').waitFor({state:'visible'});
    assert.equal(await page.locator('.cat-panel:visible').count(),0);
  }
  // Datos de Checklist aislados, con un pendiente y un histórico.
  await page.evaluate(()=>{
    A33Storage.sharedSet('arcano33_lotes',[
      {id:'browser-p',codigo:'A33AV5786-0xx1',fecha:'2026-07-17',volVino:100,volVodka:100,volJugo:100,volSirope:100,volAgua:100},
      {id:'browser-h',codigo:'A330XX119TEV5786',fecha:'2025-12-19',volVino:100,checklistProduccion:{schema:1,cerrado:true,estadoCierre:'CERRADO',items:{vino:true}}}
    ],{source:'test-e24'});
  });
  await page.goto(origin+'/calculadora/index.html');
  await page.locator('#btn-checklist').click();
  await page.locator('#a33-checklist-pendientes button').getByText('Usar',{exact:true}).click();
  const content=page.locator('#a33-checklist-contenido');
  assert.equal(await content.locator('input[type="checkbox"]').count(),5);
  await content.locator('#a33-checklist-hecho').click();
  assert.match(await page.locator('#a33-checklist-estado').textContent(),/Marca todos/);
  assert.equal(await page.evaluate(()=>A33Storage.sharedGet('arcano33_lotes',[]).find(r=>r.id==='browser-p').checklistProduccion?.cerrado===true),false);
  for(const checkbox of await content.locator('input[type="checkbox"]').all())await checkbox.check();
  await content.locator('#a33-checklist-hecho').click();
  await page.waitForFunction(()=>A33Storage.sharedGet('arcano33_lotes',[]).find(r=>r.id==='browser-p').checklistProduccion?.cerrado===true);
  await page.reload();await page.locator('#btn-checklist').click();
  assert.equal(await page.locator('#a33-checklist-pendientes button').count(),0);
  await page.locator('.a33-checklist-history-disclosure summary').click();
  await page.locator('#a33-checklist-historico button').first().click();
  assert.equal(await content.locator('input[type="checkbox"]:not(:disabled)').count(),0);
  assert.equal(await content.locator('#a33-checklist-hecho').count(),0);
  // Clientes compartidos y creación de un pedido rápido sin producción ni stock.
  await page.evaluate(()=>A33Storage.sharedSet('a33_pos_customersCatalog',[{id:'browser-c',name:'Cliente E24',isActive:true}],{source:'test-e24'}));
  await page.goto(origin+'/pos/index.html');
  await page.waitForFunction(()=>typeof put==='function');
  await page.evaluate(()=>put('products',{id:9201,productId:'browser-product',name:'Producto E24',price:100,unitCost:20,pos:true,isActive:true,active:true,manageStock:true,volumenMl:1000,Letra:'Z'}));
  await page.goto(origin+'/pedidos/index.html?view=rapido');
  await page.locator('#quick-customer-select').selectOption('id:browser-c');
  await page.locator('#quick-delivery-date').fill('2026-10-03');
  const product=await page.locator('#quick-product-select option').evaluateAll(rows=>rows.find(r=>r.value)?.value);
  assert(product,'El catálogo no ofrece productos para el escenario');
  await page.locator('#quick-product-select').selectOption(product);
  await page.locator('#quick-product-quantity').fill('2');
  await page.locator('#quick-product-add').click();
  const beforeLots=await page.evaluate(()=>JSON.stringify(A33Storage.sharedGet('arcano33_lotes',[])));
  await page.locator('#quick-save-btn').click();
  await page.waitForFunction(()=>A33Storage.sharedGet('arcano33_pedidos_rapidos_v1',[]).length===1);
  const order=await page.evaluate(()=>A33Storage.sharedGet('arcano33_pedidos_rapidos_v1',[])[0]);
  assert.equal(order.customerId,'browser-c');assert.equal(order.items[0].cantidad,2);assert.equal(order.estado,'pendiente');
  assert.equal(await page.evaluate(()=>JSON.stringify(A33Storage.sharedGet('arcano33_lotes',[]))),beforeLots);
  await page.reload();
  assert.equal(await page.locator('#quick-pending-count').textContent(),'1');
  for(const [width,height] of [[768,1024],[390,844]]){
    await page.setViewportSize({width,height});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS browser E2.4: Catálogos ocho apartados/Atrás, Checklist cierre/recarga/consulta histórica, cliente compartido y pedido rápido persistido sin cambiar lotes, tablet/móvil; sin errores JS.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
