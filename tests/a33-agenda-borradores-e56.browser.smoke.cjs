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
    };r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction(['rawMaterials','products','inventory'],'readwrite');
      tx.objectStore('rawMaterials').put({id:1,materialId:'mat-a',name:'Jugo E56',category:'Insumos',unit:'Litros',price:20,active:true});
      tx.objectStore('rawMaterials').put({id:2,materialId:'mat-b',name:'Envases E56',category:'Envases',unit:'Cajas',price:30,active:true});
      tx.objectStore('products').put({id:1,productId:'p-e56',name:'Producto E56',price:100,isActive:true,pos:true});
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
  await page.getByRole('button',{name:'Abrir Reunión',exact:true}).click();
  await page.locator('#agendaSubject').fill('Reunión pendiente E56');
  await page.locator('#agendaClientSelect').selectOption('__new__');await page.locator('#agendaClientNew').fill('Cliente nuevo E56');
  await page.locator('#agendaDate').fill('2026-10-10');await page.locator('#agendaTime').fill('15:30');await page.locator('#agendaModality').selectOption('videollamada');
  await page.locator('#agendaNotes').fill('Nota cruda E56');await page.locator('#agendaPedidoToggle').click();
  await page.locator('#agendaPedidoProduct').selectOption('p-e56');await page.locator('#agendaPedidoQuantity').fill('');await page.locator('#agendaPedidoDelivery').fill('2026-10-11');
  const meeting=(await copies(page,'a33_agenda_form_draft_v1_'))[0];assert.equal(meeting.record.fields.agendaPedidoQuantity,'');
  await page.locator('.a33-context-back').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('a33_agenda_records_v1')),baseline.records);
  await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('a33-pos');r.onsuccess=()=>resolve(r.result);});await new Promise(resolve=>{const tx=db.transaction('products','readwrite');tx.objectStore('products').put({id:1,productId:'p-e56',name:'Producto renombrado E56',price:200,isActive:true,pos:true});tx.oncomplete=resolve;});db.close();});
  await page.reload();await waitReady(page);assert.equal(await page.locator('#agendaHomeView').isVisible(),true);
  await recover(page,'agendaPendingPanel',meeting.key);await page.locator('#agendaSubject').waitFor({state:'visible'});
  assert.equal(await page.locator('#agendaClientNew').inputValue(),'Cliente nuevo E56');assert.equal(await page.locator('#agendaModality').inputValue(),'videollamada');assert.equal(await page.locator('#agendaTime').inputValue(),'15:30');assert.equal(await page.locator('#agendaPedidoQuantity').inputValue(),'');assert.equal(await page.locator('#agendaPedidoPrice').inputValue(),'100');
  assert.deepEqual(await page.evaluate(()=>({records:localStorage.getItem('a33_agenda_records_v1'),customers:localStorage.getItem('a33_pos_customersCatalog')})),baseline,'Recuperar no registra ni crea clientes');
  await page.locator('#agendaPedidoQuantity').fill('2');await page.locator('#agendaSaveBtn').click();
  let persisted=await records(page);assert.equal(persisted.length,2);const savedMeeting=persisted.find(r=>r.subject==='Reunión pendiente E56');assert.equal(savedMeeting.id,meeting.record.meta.id);assert.equal(savedMeeting.pedido.total,200);
  assert.equal(await page.evaluate(k=>!!localStorage.getItem(k),meeting.key),true,'Origen conservado');
  await page.locator('[data-pending-key="'+meeting.key+'"]').getByRole('button',{name:'Recuperar',exact:true}).click();assert.match(await page.locator('#agendaPendingPanel [data-pending-warning]').innerText(),/ya fue registrado/);
  // Nuevo intento: un fallo de la escritura del registro conserva identidad y campos para reintentar.
  await page.locator('.a33-context-back').click();await page.getByRole('button',{name:'Abrir Tarea',exact:true}).click();await page.locator('#agendaSubject').fill('Tarea reintento E56');
  const task=(await copies(page,'a33_agenda_form_draft_v1_')).find(r=>r.record.fields.agendaSubject==='Tarea reintento E56');
  await page.evaluate(()=>{window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='a33_agenda_records_v1')throw Error('fallo de registro aislado');return window.realSet.call(this,k,v);};});
  await page.locator('#agendaSaveBtn').click();assert.equal((await records(page)).length,2);assert.equal(await page.locator('#agendaSubject').inputValue(),'Tarea reintento E56');
  await page.evaluate(()=>{Storage.prototype.setItem=window.realSet;});await page.locator('#agendaSaveBtn').click();persisted=await records(page);assert.equal(persisted.length,3);assert.equal(persisted.find(r=>r.subject==='Tarea reintento E56').id,task.record.meta.id);
  // La tarea histórica conserva datos ocultos al actualizar tras una recuperación.
  await page.locator('#agendaList article').filter({hasText:'Histórica E56'}).click();await page.locator('#agendaNotes').fill('Edición histórica E56');
  const historical=(await copies(page,'a33_agenda_form_draft_v1_')).find(r=>r.record.meta.id==='legacy-task');
  await page.locator('.a33-context-back').click();await page.reload();await waitReady(page);await recover(page,'agendaPendingPanel',historical.key);await page.locator('#agendaSaveBtn').click();
  const legacy=(await records(page)).find(r=>r.id==='legacy-task');assert.equal(legacy.client,'Cliente histórico');assert.equal(legacy.pedido.price,9);assert.equal(legacy.pedido.quantity,2);
  await page.locator('.a33-context-back').click();await page.getByRole('button',{name:'Abrir Compras',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('purchaseMaterial').disabled && !document.getElementById('purchaseForm').hidden && !document.getElementById('purchaseForm').inert);
  await page.locator('#purchaseMaterial').selectOption('mat-a');await page.locator('#purchaseQuantity').fill('2');await page.locator('#purchaseAddBtn').click();
  await page.locator('#purchaseMaterial').selectOption('mat-b');await page.locator('#purchaseQuantity').fill('');
  await page.locator('#purchaseDate').fill('2026-10-12');await page.locator('#purchaseNotes').fill('Compra pendiente E56');
  await page.getByRole('button',{name:'Editar cantidad de Jugo E56',exact:true}).click();await page.locator('[data-draft-quantity]').fill('');
  const purchase=(await copies(page,'a33_agenda_purchase_draft_v1_')).find(r=>r.record.fields.purchaseNotes==='Compra pendiente E56');assert.equal(purchase.record.data.editingQuantity,'');assert.equal(purchase.record.data.items[0].priceUsed,20);
  const beforePurchaseRecovery=await records(page);
  await page.locator('.a33-context-back').click();await page.reload();await waitReady(page);
  await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('a33-pos');r.onsuccess=()=>resolve(r.result);});await new Promise(resolve=>{const tx=db.transaction('rawMaterials','readwrite');tx.objectStore('rawMaterials').put({id:1,materialId:'mat-a',name:'Jugo nuevo',category:'Insumos',unit:'Litros',price:99,active:false});tx.objectStore('rawMaterials').put({id:2,materialId:'mat-b',name:'Envases E56',category:'Envases',unit:'Cajas',price:60,active:true});tx.oncomplete=resolve;});db.close();});
  await recover(page,'purchasePendingPanel',purchase.key);await page.locator('#purchaseNotes').waitFor({state:'visible'});await page.waitForFunction(()=>document.getElementById('purchaseNotes').value==='Compra pendiente E56');
  assert.equal(await page.locator('[data-draft-quantity]').inputValue(),'');assert.equal(await page.locator('#purchaseQuantity').inputValue(),'');assert.match(await page.locator('#purchasePrice').inputValue(),/30/);
  const restored=await page.evaluate(()=>A33AgendaPurchases.getState());assert.equal(restored.draftItems[0].name,'Jugo E56');assert.equal(restored.draftItems[0].priceUsed,20);assert.deepEqual(await records(page),beforePurchaseRecovery);
  assert.equal(await page.evaluate(()=>A33AgendaPurchases.save()),false,'Cantidad incompleta no se guarda');
  await page.locator('[data-draft-quantity]').fill('3');await page.locator('#purchaseQuantity').fill('1');
  await page.evaluate(()=>{window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='a33_agenda_records_v1')throw Error('fallo compra aislado');return window.realSet.call(this,k,v);};});
  await page.locator('#purchaseSaveBtn').click();assert.deepEqual(await records(page),beforePurchaseRecovery);assert.equal((await page.evaluate(()=>A33AgendaPurchases.getState())).draftItems.length,2);
  await page.waitForFunction(()=>!document.getElementById('purchaseSaveBtn').disabled);await page.evaluate(()=>{Storage.prototype.setItem=window.realSet;});await page.locator('#purchaseSaveBtn').click();
  persisted=await records(page);const savedPurchase=persisted.find(r=>r.id===purchase.record.meta.id);assert(savedPurchase);assert.equal(savedPurchase.purchaseGroup.items.length,2);assert.equal(savedPurchase.purchaseGroup.totalGeneral,90);assert.deepEqual(savedPurchase.purchaseGroup.items.map(r=>r.priceUsed),[20,30]);assert.equal(await page.evaluate(k=>!!localStorage.getItem(k),purchase.key),true);
  // Dos páginas generan copias distintas sin sustituir la de origen.
  const second=await context.newPage();second.setDefaultTimeout(10000);second.on('dialog',d=>d.accept());await second.goto(url);await waitReady(second);await second.getByRole('button',{name:'Abrir Compras',exact:true}).click();await second.waitForFunction(()=>!document.getElementById('purchaseForm').inert);await second.locator('#purchaseNotes').fill('Segunda pestaña E56');
  const other=(await copies(second,'a33_agenda_purchase_draft_v1_')).find(r=>r.record.fields.purchaseNotes==='Segunda pestaña E56');assert(other);assert.notEqual(other.key,purchase.key);
  // Recuperación de una edición cuyo registro cambia después: comprobar antes de guardar.
  await page.waitForFunction(()=>!document.getElementById('purchaseSaveBtn').disabled);
  await page.locator('.a33-context-back').click();await page.getByRole('button',{name:'Abrir Reunión',exact:true}).click();await page.locator('#agendaList article').filter({hasText:'Reunión pendiente E56'}).click();await page.locator('#agendaNotes').fill('Edición pendiente E56');
  const edit=(await copies(page,'a33_agenda_form_draft_v1_')).find(r=>r.record.meta.id===savedMeeting.id&&r.record.meta.mode==='edit');assert(edit);
  await page.locator('.a33-context-back').click();await page.reload();await waitReady(page);await recover(page,'agendaPendingPanel',edit.key);await page.locator('#agendaSubject').waitFor({state:'visible'});
  await second.evaluate(id=>{const store=JSON.parse(localStorage.getItem('a33_agenda_records_v1'));store.records.find(r=>r.id===id).notes='Cambio externo con misma fecha';localStorage.setItem('a33_agenda_records_v1',JSON.stringify(store));},savedMeeting.id);
  await page.locator('#agendaSaveBtn').click();assert.match(await page.locator('#agendaPendingPanel [data-pending-warning]').innerText(),/cambió/);assert.equal((await records(page)).find(r=>r.id===savedMeeting.id).notes,'Cambio externo con misma fecha');
  const beforeFail=await copies(page,'a33_agenda_form_draft_v1_');
  await page.evaluate(()=>{window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('a33_agenda_form_draft_v1_'))throw Error('quota aislada');return window.realSet.call(this,k,v);};});
  await page.locator('#agendaNotes').fill('Última edición en memoria E56');assert.equal(await page.locator('#agendaPendingPanel [data-pending-warning]').isVisible(),true);
  page.removeAllListeners('dialog');page.on('dialog',d=>d.dismiss());await page.locator('.a33-context-back').click();assert.equal(await page.locator('#agendaOperationalView').isVisible(),true);assert.deepEqual(await copies(page,'a33_agenda_form_draft_v1_'),beforeFail);
  await page.evaluate(()=>{Storage.prototype.setItem=window.realSet;document.getElementById('agendaNotes').dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal((await copies(page,'a33_agenda_form_draft_v1_')).some(r=>r.record.fields.agendaNotes==='Última edición en memoria E56'),true);
  const inventory=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('a33-pos');r.onsuccess=()=>resolve(r.result);});const rows=await new Promise(resolve=>{const r=db.transaction('inventory','readonly').objectStore('inventory').getAll();r.onsuccess=()=>resolve(r.result);});db.close();return rows;});assert.deepEqual(inventory,[{id:1,qty:55,unitCost:7}]);
  assert.deepEqual(errors,[]);
  console.log('PASS Chrome E5.6: reunión/tarea/compra, recuperación explícita, campos y cantidades incompletas, historial/precios preservados, reintento sin duplicados, pestañas independientes, copia fallida y registros/inventario intactos al recuperar');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
