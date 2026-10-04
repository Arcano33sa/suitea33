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
  const url=`http://127.0.0.1:${server.address().port}/pedidos/index.html`;
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser=await playwright.chromium.launch({headless:true,...(fs.existsSync(chrome)?{executablePath:chrome}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(()=>pedFormDraftState.ready);
  page.on('dialog',dialog=>dialog.accept());
  await page.evaluate(async()=>{
    const open=await new Promise((resolve,reject)=>{const r=indexedDB.open('a33-pos',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('products'))r.result.createObjectStore('products',{keyPath:'id'});};});
    await new Promise((resolve,reject)=>{const tr=open.transaction('products','readwrite');tr.objectStore('products').put({id:9531,productId:'9531',name:'Producto E53',price:120,pos:true,isActive:true});tr.oncomplete=resolve;tr.onerror=()=>reject(tr.error);});open.close();
    A33Storage.sharedSet('a33_pos_customersCatalog',[{id:'c53',name:'Cliente E53',isActive:true}],{source:'test'});
    await refreshPedidosProductCatalog(true);renderCustomerSelect('');renderQuickCustomerSelectPED('','');
    setCustomerSelection({id:'c53',name:'Cliente E53'});
    $('clienteReferencia').value='Texto incompleto recuperable';$('clienteReferencia').dispatchEvent(new Event('input',{bubbles:true}));
    const p=PRESENTACIONES.find(p=>String(p.productId)==='9531');if(!p)throw Error('Producto fixture no encontrado');
    $(p.qtyId).value='3';$(p.qtyId).dispatchEvent(new Event('input',{bubbles:true}));
    ensureQuickHistoricalCustomerPED({customerId:'c53',customerName:'Cliente E53'});
    quickOrderItemsDraft=[{productId:'9531',productNameSnapshot:'Producto E53',cantidad:2,productSnapshot:{id:9531,name:'Producto E53',price:120}}];renderQuickProductLinesPED();
    $('quick-delivery-date').value='2026-10-12';$('quick-delivery-date').dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#quick-product-lines input').value='5';document.querySelector('#quick-product-lines input').dispatchEvent(new Event('input',{bubbles:true}));
  });
  const initial=await page.evaluate(()=>({records:localStorage.getItem('arcano33_pedidos'),quick:localStorage.getItem('arcano33_pedidos_rapidos_v1'),drafts:Object.keys(localStorage).filter(k=>k.startsWith(PED_FORM_DRAFT_PREFIX)).map(k=>({key:k,raw:localStorage.getItem(k)}))}));
  assert.equal(initial.drafts.length,2);
  const mainRecord=JSON.parse(initial.drafts.find(d=>JSON.parse(d.raw).mode==='completo').raw);
  await page.reload();await page.waitForFunction(()=>pedFormDraftState.ready);
  for(const source of initial.drafts)source.raw=await page.evaluate(k=>localStorage.getItem(k),source.key);
  assert.equal(await page.locator('#clienteReferencia').inputValue(),'');
  assert.equal(await page.locator('#pedido-draft-list button').count(),4);
  // Product price changed: recovery keeps the original price as a historical line.
  await page.evaluate(()=>{PRESENTACIONES.find(p=>String(p.productId)==='9531').price=999;A33Storage.sharedSet('a33_pos_customersCatalog',[],{source:'test'});renderCustomerSelect('');});
  await page.locator('#pedido-draft-list .form-actions').filter({hasText:'Pedido completo'}).getByRole('button',{name:'Recuperar',exact:true}).click();
  const recovered=await page.evaluate(()=>{
    return {ok:pedFormDraftState.completo.recovered,id:draftPedidoId,qty:currentHistoricalPedidoItemsPED[0]?.qty,price:currentHistoricalPedidoItemsPED[0]?.unitPriceSnapshot,
      text:$('clienteReferencia').value,orders:localStorage.getItem('arcano33_pedidos'),quick:localStorage.getItem('arcano33_pedidos_rapidos_v1')};
  });
  assert.equal(recovered.ok,true);assert.equal(recovered.id,mainRecord.draftId);assert.equal(recovered.qty,3);assert.equal(recovered.price,120);
  assert.equal(recovered.text,'Texto incompleto recuperable');assert.equal(recovered.orders,initial.records);assert.equal(recovered.quick,initial.quick);
  const quickRecord=JSON.parse(initial.drafts.find(d=>JSON.parse(d.raw).mode==='rapido').raw);
  await page.locator('#pedido-draft-list .form-actions').filter({hasText:'Pedido rápido'}).getByRole('button',{name:'Recuperar',exact:true}).click();
  const quick=await page.evaluate(()=>({id:quickOrderDraftIdPED,qty:document.querySelector('#quick-product-lines input').value,date:$('quick-delivery-date').value}));
  assert.equal(quick.id,quickRecord.draftId);assert.equal(quick.qty,'5');assert.equal(quick.date,'2026-10-12');
  // Same browser, another tab: independent draft keys, source copies untouched.
  const other=await context.newPage();await other.goto(url);await other.waitForFunction(()=>pedFormDraftState.ready);
  const keys=await Promise.all([page.evaluate(()=>pedidoDraftKeyPED('completo')),other.evaluate(()=>pedidoDraftKeyPED('completo'))]);assert.notEqual(keys[0],keys[1]);
  for(const source of initial.drafts)assert.equal(await other.evaluate(k=>localStorage.getItem(k),source.key),source.raw);
  await page.evaluate(()=>{
    $('quick-order-form').requestSubmit();
  });
  await page.waitForFunction(()=>loadQuickOrdersPED().length===1);
  assert.equal(await page.evaluate(()=>loadQuickOrdersPED()[0].id),quickRecord.draftId);
  assert.equal(await page.evaluate(()=>loadQuickOrdersPED()[0].items[0].cantidad),5);
  await page.evaluate(()=>{$('pedido-form').requestSubmit();});
  await page.waitForFunction(()=>loadPedidos().length===1);
  const saved=await page.evaluate(()=>loadPedidos()[0]);
  assert.equal(saved.customerId,'c53');assert.equal(saved.id,mainRecord.draftId);assert.equal(saved.items[0].unitPriceSnapshot,120);assert.equal(saved.items[0].qty,3);
  const beforeConflict=await other.evaluate(()=>localStorage.getItem('arcano33_pedidos'));
  const conflict=await other.evaluate(record=>{restorePedidoFormDraftPED(record);$('pedido-form').requestSubmit();return recoveredPedidoConflictPED('completo');},mainRecord);
  assert.match(conflict,/ya registrado/);
  assert.equal(await other.evaluate(()=>localStorage.getItem('arcano33_pedidos')),beforeConflict);
  const failed=await other.evaluate(()=>{
    const real=A33Storage.setItem;
    A33Storage.setItem=(key,value,scope)=>key.startsWith(PED_FORM_DRAFT_PREFIX)?false:real.call(A33Storage,key,value,scope);
    $('clienteReferencia').value='Pendiente tras fallo';$('clienteReferencia').dispatchEvent(new Event('input',{bubbles:true}));
    const result={text:$('clienteReferencia').value,status:$('pedido-draft-status').textContent};
    A33Storage.setItem=real;return result;
  });
  assert.equal(failed.text,'Pendiente tras fallo');assert.match(failed.status,/No se pudo guardar/);
  assert.deepEqual(errors,[]);
  console.log('PASS E5.3 Chrome: recuperación explícita de ambas modalidades, identidad, precio histórico, cantidades crudas, separación entre pestañas, guardado posterior, bloqueo de duplicados y fallo conservador');
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
