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
  // Un escritor añade una compra mientras el otro conserva una tarea en edición.
  await page.getByRole('button',{name:'Abrir Tarea',exact:true}).click();
  await page.locator('#agendaSubject').fill('Tarea independiente E57');
  const second=await context.newPage();await second.goto(url);await waitReady(second);
  await second.getByRole('button',{name:'Abrir Compras',exact:true}).click();
  await second.waitForFunction(()=>!document.getElementById('purchaseForm').inert && !document.getElementById('purchaseMaterial').disabled);
  await second.locator('#purchaseMaterial').selectOption('mat-a');await second.locator('#purchaseQuantity').fill('2');
  await second.locator('#purchaseDate').fill('2026-10-15');await second.locator('#purchaseNotes').fill('Compra independiente E57');
  await second.locator('#purchaseSaveBtn').click();
  await second.waitForFunction(()=>JSON.parse(localStorage.getItem('a33_agenda_records_v1')).records.some(r=>r.type==='compra'));
  assert.equal(await page.locator('#agendaSubject').inputValue(),'Tarea independiente E57','La actualización externa conserva el editor');
  await page.locator('#agendaSaveBtn').click();
  let rows=await records(page);assert.equal(rows.length,3);const purchase=rows.find(r=>r.type==='compra');const task=rows.find(r=>r.subject==='Tarea independiente E57');assert(purchase && task);
  assert.deepEqual(rows.find(r=>r.id==='legacy-task'),JSON.parse(baseline.records).records[0]);
  // Lista interna obsoleta: no se emite storage en la misma ventana.
  await page.locator('.a33-context-back').click();await page.getByRole('button',{name:'Abrir Tarea',exact:true}).click();await page.locator('#agendaSubject').fill('Lista obsoleta E57');
  await page.evaluate(()=>{const k='a33_agenda_records_v1';const p=JSON.parse(localStorage.getItem(k));p.extra='dato histórico';p.records=p.records.filter(r=>r.id!=='legacy-task');p.records.push({id:'external',type:'compra',historical:{price:123}});localStorage.setItem(k,JSON.stringify(p));});
  await page.locator('#agendaSaveBtn').click();rows=await records(page);assert(!rows.some(r=>r.id==='legacy-task'));assert.deepEqual(rows.find(r=>r.id==='external'),{id:'external',type:'compra',historical:{price:123}});assert(rows.some(r=>r.id===purchase.id));assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('a33_agenda_records_v1')).extra),'dato histórico');
  // El lector de compras recibe también las escrituras de reuniones/tareas en la misma página.
  const eventSources=await page.evaluate(()=>{const sources=[];const listener=e=>sources.push(e.detail.source);window.addEventListener('a33:agenda-records-changed',listener);A33AgendaRecords.write(localStorage,{kind:'update',id:'external',patch:{notes:'actualizada'}},'agenda');window.removeEventListener('a33:agenda-records-changed',listener);return sources;});assert.deepEqual(eventSources,['agenda']);
  // El registro que está abierto también puede haber sido eliminado en otra pestaña.
  const editingId=await page.evaluate(()=>A33Agenda.getState().currentId);
  await page.locator('#agendaNotes').fill('Edición que debe conservarse E57');
  await second.evaluate(id=>A33AgendaRecords.write(localStorage,{kind:'delete',id},'compras'),editingId);
  await page.waitForFunction(id=>!A33Agenda.getState().records.some(r=>r.id===id),editingId);
  await page.locator('#agendaSaveBtn').click();assert(!(await records(page)).some(r=>r.id===editingId));assert.equal(await page.locator('#agendaNotes').inputValue(),'Edición que debe conservarse E57');
  assert.deepEqual(errors,[]);console.log('PASS Chrome E5.7: ambos formularios, dos pestañas, editor intacto, lista obsoleta, registros eliminados sin resurrección e históricos preservados');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
