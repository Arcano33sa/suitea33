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

  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await playwright.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:1000}});
  const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(origin+'/agenda/offline.html');
  await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('a33-pos',37);r.onupgradeneeded=()=>{
      const materials=r.result.createObjectStore('rawMaterials',{keyPath:'id',autoIncrement:true});
      for(const [index,key] of [['by_name_normalized','nameNormalized'],['by_active','active'],['by_updated_at','updatedAt']])materials.createIndex(index,key);
      r.result.createObjectStore('products',{keyPath:'id'});r.result.createObjectStore('inventory',{keyPath:'id'});
      for(const name of ['events','sales','reempaques','extras','banks','meta'])r.result.createObjectStore(name,{keyPath:'id'});
    };r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction(['rawMaterials','products','inventory'],'readwrite');
      tx.objectStore('rawMaterials').put({id:1,materialId:'mat-a',name:'Jugo E56',category:'Insumos',unit:'Litros',price:20,active:true});
      tx.objectStore('rawMaterials').put({id:2,materialId:'mat-b',name:'Envases E56',category:'Envases',unit:'Cajas',price:30,active:true});
      tx.objectStore('products').put({id:1,productId:'p-e56',name:'Producto E56',price:100,isActive:true,pos:true,receta:true,Letra:'X',capacidadMl:100});
      tx.objectStore('inventory').put({id:1,qty:55,unitCost:7});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
    });db.close();
    localStorage.setItem('a33_agenda_records_v1',JSON.stringify({schemaVersion:9,records:[{id:'legacy-task',type:'tarea',subject:'Histórica E56',date:'2026-10-03',status:'pendiente',priority:'media',createdAt:'2026-01-01',updatedAt:'2026-01-01',client:'Cliente histórico',clientId:'old-c',pedido:{enabled:true,product:'Producto antiguo',productNameSnapshot:'Producto antiguo',price:9,quantity:2,total:18,delivery:'2026-01-01'}}]}));
    localStorage.setItem('a33_pos_customersCatalog',JSON.stringify([{id:'c-e56',name:'Cliente E56',isActive:true}]));
  });

  const inventoryBefore=await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('a33-pos');q.onsuccess=()=>r(q.result)});const data=await new Promise(r=>{const q=db.transaction('inventory').objectStore('inventory').getAll();q.onsuccess=()=>r(q.result)});db.close();return data});
  await page.goto(origin+'/pedidos/index.html');await page.waitForFunction(()=>pedFormDraftState.ready);
  await page.evaluate(async()=>{await refreshPedidosProductCatalog(true);renderCustomerSelect('');setCustomerSelection({id:'c-e56',name:'Cliente E56'});$('fechaCreacion').value='2026-10-03';$('fechaEntrega').value='2026-10-15';$('envio').value='0';$('descuento').value='0';$('pagoAnticipado').value='0';const p=PRESENTACIONES.find(p=>p.productId==='p-e56');if(!p)throw Error('Producto fixture');$(p.qtyId).value='2';$('pedido-form').requestSubmit();});
  await page.waitForFunction(()=>loadPedidos().length===1);const orderId=await page.evaluate(()=>loadPedidos()[0].id);

  await page.evaluate(()=>{setPedidoModePED('rapido');ensureQuickHistoricalCustomerPED({customerId:'c-e56',customerName:'Cliente E56'});quickOrderItemsDraft=[{productId:'p-e56',productNameSnapshot:'Producto E56',cantidad:2}];renderQuickProductLinesPED();$('quick-delivery-date').value='2026-10-15';$('quick-order-form').requestSubmit();});
  await page.waitForFunction(()=>loadQuickOrdersPED().length===1);
  const quickId=await page.evaluate(()=>loadQuickOrdersPED()[0].id);
  const states=['en_preparacion','listo','entregado','cancelado','pendiente'];
  for(const state of states){
    await page.evaluate(id=>{setPedidoModePED('completo');editPedido(id)},orderId);
    await page.locator('#estado').selectOption(state);await page.evaluate(()=>$('pedido-form').requestSubmit());
    await page.waitForFunction(({id,state})=>loadPedidos().find(r=>r.id===id)?.estado===state,{id:orderId,state});
    await page.evaluate(id=>{setPedidoModePED('rapido');editQuickOrderPED(id)},quickId);
    await page.locator('#quick-status').selectOption(state);await page.evaluate(()=>$('quick-order-form').requestSubmit());
    await page.waitForFunction(({id,state})=>loadQuickOrdersPED().find(r=>r.id===id)?.estado===state,{id:quickId,state});
    const sheets=await page.evaluate(async()=>{const original=XLSX.writeFile;let result;XLSX.writeFile=(wb)=>{result=Object.fromEntries(wb.SheetNames.map(name=>[name,XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1})]));};try{await exportToCSV();return result;}finally{XLSX.writeFile=original;}});
    const label={pendiente:'Pendiente',en_preparacion:'En preparación',listo:'Listo',entregado:'Entregado',cancelado:'Cancelado'}[state];
    assert.ok(sheets,'La exportación debe generar el libro');
    const full=Object.values(sheets).find(rows=>rows[0]?.includes('Estado')&&rows[0]?.includes('Entregado')&&rows[0]?.includes('Fecha fabricación'));
    assert.equal(full[1][full[0].indexOf('Estado')],label);
    assert.equal(full[1][full[0].indexOf('Entregado')],state==='entregado'?'Sí':'No');
    assert.equal(sheets['Pedidos rápidos'][1][6],label);
    assert.equal(sheets['Detalle rápidos'][1][4],label);
    await page.reload();await page.waitForFunction(()=>pedFormDraftState.ready);
    assert.equal(await page.evaluate(id=>getPedidoEstado(loadPedidos().find(r=>r.id===id)),orderId),state);
    assert.equal(await page.evaluate(id=>getPedidoEstado(loadQuickOrdersPED().find(r=>r.id===id)),quickId),state);
  }
  const inventoryAfter=await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('a33-pos');q.onsuccess=()=>r(q.result)});const data=await new Promise(r=>{const q=db.transaction('inventory').objectStore('inventory').getAll();q.onsuccess=()=>r(q.result)});db.close();return data});
  assert.deepEqual(inventoryAfter,inventoryBefore);
  assert.deepEqual(errors,[]);
  console.log('PASS Chrome E6.1: guardado real, recarga de los cinco estados en ambas modalidades e inventario intacto');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
