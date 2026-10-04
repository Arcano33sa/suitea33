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
  const baseline=await page.evaluate(()=>({records:localStorage.getItem('a33_agenda_records_v1'),customers:localStorage.getItem('a33_pos_customersCatalog')}));
  const url=origin+'/agenda/index.html';
  const waitReady=async p=>p.waitForFunction(()=>document.documentElement.dataset.agendaReady==='1' && document.getElementById('purchaseForm')?.dataset.pendingReady==='1');
  const copies=async(p,prefix)=>p.evaluate(prefix=>Object.keys(localStorage).filter(k=>k.startsWith(prefix)).map(key=>({key,record:JSON.parse(localStorage.getItem(key))})),prefix);
  const records=async p=>p.evaluate(()=>JSON.parse(localStorage.getItem('a33_agenda_records_v1')).records);
  const recover=async(p,panel,key)=>{
    await p.locator('#'+panel+' summary').click();
    await p.locator('#'+panel+' [data-pending-refresh]').click();
    await p.locator('[data-pending-key="'+key+'"]').getByRole('button',{name:'Recuperar',exact:true}).click();
  };
  await page.goto(url);await waitReady(page);
  const external=await context.newPage();await external.goto(origin+'/agenda/offline.html');
  const mutate=async(key,id,patch)=>external.evaluate(({key,id,patch})=>{const payload=JSON.parse(localStorage.getItem(key));const rows=Array.isArray(payload)?payload:payload.records;const row=rows.find(r=>String(r.id)===String(id));Object.assign(row,patch);localStorage.setItem(key,JSON.stringify(payload));},{key,id,patch});
  const stored=async(key)=>page.evaluate(k=>localStorage.getItem(k),key);
  const equalStored=async(key,before)=>assert.equal(await stored(key),before,'El conflicto no escribe '+key);
  // Agenda: edición ordinaria con updatedAt histórico sin cambiar.
  await page.getByRole('button',{name:'Abrir Tarea',exact:true}).click();await page.locator('#agendaList article').filter({hasText:'Histórica E56'}).click();
  await page.locator('#agendaNotes').fill('Edición local E58');await mutate('a33_agenda_records_v1','legacy-task',{subject:'Cambio externo E58'});
  let before=await stored('a33_agenda_records_v1');await page.locator('#agendaSaveBtn').click();await equalStored('a33_agenda_records_v1',before);assert.equal(await page.locator('#agendaNotes').inputValue(),'Edición local E58');assert.match(await page.locator('#agendaPendingPanel [data-pending-warning]').innerText(),/cambió/);
  // Compra agrupada: el segundo guardado no modifica la copia actual del primer escritor.
  await page.locator('.a33-context-back').click();await page.getByRole('button',{name:'Abrir Compras',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('purchaseForm').inert && !document.getElementById('purchaseMaterial').disabled);
  await page.locator('#purchaseMaterial').selectOption('mat-a');await page.locator('#purchaseQuantity').fill('2');await page.locator('#purchaseDate').fill('2026-10-15');await page.locator('#purchaseSaveBtn').click();await page.waitForFunction(()=>!document.getElementById('purchaseSaveBtn').disabled);
  const purchaseId=(await records(page)).find(r=>r.type==='compra').id;await page.getByRole('button',{name:'Editar compra completa',exact:true}).click();await page.locator('#purchaseNotes').fill('Compra local E58');await mutate('a33_agenda_records_v1',purchaseId,{notes:'Compra externa E58'});
  before=await stored('a33_agenda_records_v1');await page.locator('#purchaseSaveBtn').click();await equalStored('a33_agenda_records_v1',before);assert.equal(await page.locator('#purchaseNotes').inputValue(),'Compra local E58');assert.match(await page.locator('#purchasePendingPanel [data-pending-warning]').innerText(),/cambió/);
  console.log('PASS Chrome E5.8 Agenda: tarea histórica y compra agrupada con conflicto, formulario y copia conservados');
  // Pedidos: primero guardado normal mediante formularios reales, luego edición concurrente.
  await page.goto(origin+'/pedidos/index.html');await page.waitForFunction(()=>pedFormDraftState.ready);
  await page.evaluate(async()=>{await refreshPedidosProductCatalog(true);renderCustomerSelect('');setCustomerSelection({id:'c-e56',name:'Cliente E56'});$('fechaCreacion').value='2026-10-03';$('fechaEntrega').value='2026-10-15';$('envio').value='0';$('descuento').value='0';$('pagoAnticipado').value='0';const p=PRESENTACIONES.find(p=>p.productId==='p-e56');if(!p)throw Error('Producto fixture');$(p.qtyId).value='2';$('pedido-form').requestSubmit();});
  await page.waitForFunction(()=>loadPedidos().length===1);const orderId=await page.evaluate(()=>loadPedidos()[0].id);
  await page.evaluate(id=>editPedido(id),orderId);await page.locator('#clienteReferencia').fill('Referencia local E58');await mutate('arcano33_pedidos',orderId,{clienteTelefono:'8888-1111'});
  before=await stored('arcano33_pedidos');await page.evaluate(()=>$('pedido-form').requestSubmit());await page.waitForFunction(()=>$('archived-notice').textContent.includes('cambió'));await equalStored('arcano33_pedidos',before);assert.equal(await page.locator('#clienteReferencia').inputValue(),'Referencia local E58');
  // Reabrir la fila vigente permite guardar; otra fila cambia durante la edición.
  await page.evaluate(id=>{editPedido(id);$('clienteReferencia').value='Referencia revisada E58';},orderId);
  await external.evaluate(()=>{const k='arcano33_pedidos';const rows=JSON.parse(localStorage.getItem(k));rows.push({id:'order-other',codigo:'HIST-E58',nota:'independiente'});localStorage.setItem(k,JSON.stringify(rows));});
  await page.evaluate(()=>$('pedido-form').requestSubmit());await page.waitForFunction(()=>loadPedidos().some(r=>r.clienteReferencia==='Referencia revisada E58'));assert.equal(await page.evaluate(()=>loadPedidos().find(r=>r.id==='order-other').nota),'independiente');
  await page.evaluate(()=>{setPedidoModePED('rapido');ensureQuickHistoricalCustomerPED({customerId:'c-e56',customerName:'Cliente E56'});quickOrderItemsDraft=[{productId:'p-e56',productNameSnapshot:'Producto E56',cantidad:2,productSnapshot:{productId:'p-e56',name:'Producto E56'}}];renderQuickProductLinesPED();$('quick-delivery-date').value='2026-10-15';$('quick-order-form').requestSubmit();});
  await page.waitForFunction(()=>loadQuickOrdersPED().length===1);const quickId=await page.evaluate(()=>loadQuickOrdersPED()[0].id);await page.evaluate(id=>editQuickOrderPED(id),quickId);await page.locator('#quick-delivery-date').fill('2026-10-18');await mutate('arcano33_pedidos_rapidos_v1',quickId,{customerName:'Cliente externo E58'});
  before=await stored('arcano33_pedidos_rapidos_v1');await page.evaluate(()=>$('quick-order-form').requestSubmit());await equalStored('arcano33_pedidos_rapidos_v1',before);assert.equal(await page.locator('#quick-delivery-date').inputValue(),'2026-10-18');assert.match(await page.locator('#quick-form-notice').innerText(),/cambió/);
  // Los nuevos borradores preservan también la versión completa para una recuperación posterior.
  const pending=await page.evaluate(()=>capturePedidoFormDraftPED('rapido'));assert(pending.baseRecord);assert.equal(pending.baseRecord.customerName,'Cliente E56');
  console.log('PASS Chrome E5.8 Pedidos: completo y rápido, conflicto con misma fecha/revisión, reapertura explícita y fila independiente conservada');
  // Lote existente: no se ejecuta una producción ni se modifica Inventario.
  await external.evaluate(()=>localStorage.setItem('arcano33_lotes',JSON.stringify([{id:'lot-e58',loteId:'lot-e58',codigo:'A33AV5786-0xx1',fecha:'2026-10-03',caducidad:'2027-10-03',notas:'original',productosProducidos:[{productId:'p-e56',nombreSnapshot:'Producto E56',Letra:'X',cantidad:2,cantidadDisponible:2}],status:'DISPONIBLE'}])));
  await page.goto(origin+'/lotes/index.html');await page.waitForFunction(()=>loteProductCatalog.items.some(r=>r.productId==='p-e56'));
  await page.evaluate(()=>populateForm(loadLotes().find(r=>r.id==='lot-e58')));await page.locator('#notas').fill('Lote local E58');await mutate('arcano33_lotes','lot-e58',{notas:'Lote externo E58'});
  before=await stored('arcano33_lotes');await page.locator('#save-btn').click();await page.waitForFunction(()=>!isSavingLote);await equalStored('arcano33_lotes',before);assert.equal(await page.locator('#notas').inputValue(),'Lote local E58');
  await page.evaluate(()=>populateForm(loadLotes().find(r=>r.id==='lot-e58')));await page.locator('#notas').fill('Lote revisado E58');await page.locator('#save-btn').click();await page.waitForFunction(()=>loadLotes().find(r=>r.id==='lot-e58').notas==='Lote revisado E58');
  console.log('PASS Chrome E5.8 Lotes: edición bloqueada, cantidades e identidad intactas y guardado tras reapertura');
  // Clientes: el modal conserva el contenido aunque la lista se recargue.
  await page.goto(origin+'/catalogos/index.html');await page.locator('#tab-clientes').click();await page.locator('#panel-clientes').waitFor({state:'visible'});await page.locator('.cat-customer-group[data-customer-group="C"] summary').click();await page.locator('.cat-edit-customer[data-id="c-e56"]').click();
  await page.locator('#cat-edit-customer-notes').fill('Cliente local E58');await mutate('a33_pos_customersCatalog','c-e56',{correo:'externo@example.test'});
  before=await stored('a33_pos_customersCatalog');await page.locator('#cat-edit-customer-save').click();await equalStored('a33_pos_customersCatalog',before);assert.equal(await page.locator('#cat-edit-customer-notes').inputValue(),'Cliente local E58');assert.match(await page.locator('#cat-edit-customer-msg').innerText(),/cambió/);
  await page.locator('#cat-edit-customer-cancel').click();await page.locator('.cat-edit-customer[data-id="c-e56"]').click();await page.locator('#cat-edit-customer-notes').fill('Cliente revisado E58');await page.locator('#cat-edit-customer-save').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('a33_pos_customersCatalog')).find(r=>r.id==='c-e56').notas==='Cliente revisado E58');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('a33_pos_customersCatalog')).find(r=>r.id==='c-e56').correo),'externo@example.test');
  assert.deepEqual(errors,[]);console.log('PASS Chrome E5.8 clientes: modal conservado, conflicto por contenido y versión vigente editable');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
