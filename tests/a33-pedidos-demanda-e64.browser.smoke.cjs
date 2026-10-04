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


  await page.evaluate(()=>{
    const full=(id,qty,extra={})=>({id,codigo:'C-'+id,fechaEntrega:'2026-10-15',estado:'pendiente',items:[{productId:'p-e56',productName:'Producto E56',qty,unitPriceSnapshot:100}],...extra});
    const tracked=(order,n)=>({...order,entregasAcumuladas:{schemaVersion:1,productos:[{key:'product:p-e56',cantidad:n}]}});
    localStorage.setItem('arcano33_pedidos',JSON.stringify([tracked(full('f1',5),2),full('f2',4,{estado:'listo',entregasAcumuladas:{schemaVersion:1,productos:[]}}),full('closed',99,{estado:'entregado'}),full('cancel',88,{estado:'cancelado'}),full('h1',2,{items:[{productName:'Histórico sin ID',qty:2}]}),full('h2',3,{items:[{productName:'Histórico sin ID',qty:3}]}),full('bad-date',1,{fechaEntrega:'2026-02-31'}),full('dup',1),full('dup',2),full('bad-line',1,{items:[{productId:'p-e56',qty:1},{productId:'broken',qty:'inválida'}]})]));
    localStorage.setItem('arcano33_pedidos_rapidos_v1',JSON.stringify([tracked({id:'q1',codigo:'PR-1',customerName:'Cliente E56',fechaEntrega:'2026-10-15',estado:'en_preparacion',items:[{productId:'p-e56',productNameSnapshot:'Producto anterior',cantidad:3}]},1),{id:'q2',codigo:'PR-2',customerName:'Cliente E56',fechaEntrega:'2026-10-16',estado:'pendiente',items:[{productId:'p-e56',productNameSnapshot:'Producto E56',cantidad:2}]}]));
    localStorage.setItem('arcano33_pedidos_archived',JSON.stringify([full('archived',1000)]));localStorage.setItem('arcano33_lotes',JSON.stringify([{id:'lot-e64',codigo:'LOTE',estado:'DISPONIBLE'}]));
  });
  const keys=['arcano33_pedidos','arcano33_pedidos_rapidos_v1','arcano33_pedidos_archived','arcano33_lotes'];
  const readKeys=()=>page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),keys);
  const initial=await readKeys();
  const snapshot=()=>page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('a33-pos');q.onsuccess=()=>r(q.result)});const out={};for(const name of ['inventory','sales','events','products','rawMaterials','reempaques'])out[name]=await new Promise(r=>{const q=db.transaction(name).objectStore(name).getAll();q.onsuccess=()=>r(q.result)});db.close();return out;});
  const operational=await snapshot();
  await page.goto(origin+'/pedidos/index.html');await page.waitForFunction(()=>pedFormDraftState.ready).catch(error=>{console.error('Errores de arranque temporal:',errors);throw error;});
  await page.locator('#pedido-demanda-panel summary').click();await page.waitForFunction(()=>document.getElementById('pedido-demanda-status').textContent.includes('Total informativo: 16'));
  assert.match(await page.locator('#pedido-demanda-status').innerText(),/Pendiente con registro: 5.*Estimado sin registro: 11.*4 pedidos para revisión/);
  assert.equal(await page.locator('#pedido-demanda-body tr').count(),4);assert.equal(await page.locator('#pedido-demanda-body tr').filter({hasText:'Histórico sin vínculo al catálogo'}).count(),2);
  assert.match(await page.locator('#pedido-demanda-sources').innerText(),/Estimado: sin registro de entregas/);
  assert.equal(await page.locator('#pedido-demanda-review li').count(),4);assert.ok(!(await page.locator('#pedido-demanda-sources').innerText()).includes('archived'));
  await page.locator('#pedido-demanda-hasta').fill('2026-10-15');await page.locator('#pedido-demanda-hasta').dispatchEvent('change');await page.locator('#pedido-demanda-desde').fill('2026-10-15');await page.locator('#pedido-demanda-desde').dispatchEvent('change');
  assert.match(await page.locator('#pedido-demanda-status').innerText(),/Total informativo: 14.*registro: 5.*registro: 9/);
  await page.locator('#pedido-demanda-panel').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(os.tmpdir(),'a33-e64-demanda.png')});
  await page.evaluate(()=>{window.__demandBooks=[];window.__demandWriteFile=XLSX.writeFile;XLSX.writeFile=wb=>{window.__demandBooks.push(Object.fromEntries(wb.SheetNames.map(name=>[name,XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1})])));};});
  await page.locator('#pedido-demanda-export').click();
  const sheets=await page.evaluate(()=>window.__demandBooks[0]);assert.equal(sheets.Demanda.length,4);assert.equal(sheets.Demanda.slice(1).reduce((sum,row)=>sum+row[5],0),14);assert.equal(sheets['Pedidos considerados'].length,6);assert.equal(sheets['Revisión'].length,5);assert.deepEqual(sheets['Período'][1].slice(0,2),['2026-10-15','2026-10-15']);
  assert.deepEqual(await readKeys(),initial,'Consultar, filtrar y exportar no escribe pedidos, históricos o lotes');
  await page.locator('#pedido-demanda-desde').fill('2026-10-16');await page.locator('#pedido-demanda-desde').dispatchEvent('change');assert.match(await page.locator('#pedido-demanda-status').innerText(),/Desde no puede/);assert.equal(await page.locator('#pedido-demanda-export').isDisabled(),true);
  await page.locator('#pedido-demanda-hasta').fill('2026-10-16');await page.locator('#pedido-demanda-hasta').dispatchEvent('change');assert.match(await page.locator('#pedido-demanda-status').innerText(),/Total informativo: 2/);
  await page.locator('#pedido-demanda-desde').fill('2026-10-15');await page.locator('#pedido-demanda-desde').dispatchEvent('change');await page.locator('#pedido-demanda-hasta').fill('2026-10-15');await page.locator('#pedido-demanda-hasta').dispatchEvent('change');
  // Evento de otra pestaña actualiza el panel abierto.
  const external=await context.newPage();await external.goto(origin+'/agenda/offline.html');await external.evaluate(()=>{const rows=JSON.parse(localStorage.getItem('arcano33_pedidos'));rows.find(row=>row.id==='f2').entregasAcumuladas={schemaVersion:1,productos:[{key:'product:p-e56',cantidad:2}]};localStorage.setItem('arcano33_pedidos',JSON.stringify(rows));});
  await page.waitForFunction(()=>document.getElementById('pedido-demanda-status').textContent.includes('Total informativo: 12'));await external.close();
  // La colección con IDs duplicados se usa solo para lectura; E5 bloquea escrituras sobre ella.
  // Ajuste explícito del fixture aislado antes de probar un guardado ordinario válido.
  await page.evaluate(()=>{const rows=JSON.parse(localStorage.getItem('arcano33_pedidos'));let i=0;for(const row of rows)if(row.id==='dup'){row.id='dup-fixture-'+i++;row.estado='cancelado';}localStorage.setItem('arcano33_pedidos',JSON.stringify(rows));});
  await page.locator('#pedido-demanda-refresh').click();assert.match(await page.locator('#pedido-demanda-status').innerText(),/Total informativo: 12/);
  // El guardado real de una entrega acumulada también refresca la demanda en la misma página.
  await page.evaluate(()=>openPedidoEntregasPED('f1','completo'));await page.locator('#pedido-entregas-lines input').fill('3');await page.locator('#pedido-entregas-save').click();await page.waitForFunction(()=>document.getElementById('pedido-entregas-notice').textContent.includes('guardadas'));await page.locator('#pedido-entregas-close').click();assert.match(await page.locator('#pedido-demanda-status').innerText(),/Total informativo: 11/);
  const current=await readKeys();assert.equal(current.arcano33_lotes,initial.arcano33_lotes);assert.equal(current.arcano33_pedidos_archived,initial.arcano33_pedidos_archived);assert.equal(current.arcano33_pedidos_rapidos_v1,initial.arcano33_pedidos_rapidos_v1);
  // Colección ilegible: ninguna demanda parcial ni archivo con apariencia de completo.
  await page.evaluate(()=>localStorage.setItem('arcano33_pedidos_rapidos_v1','{corrupto'));await page.locator('#pedido-demanda-refresh').click();assert.match(await page.locator('#pedido-demanda-status').innerText(),/No se pudo leer Pedidos rápidos/);assert.equal(await page.locator('#pedido-demanda-body tr').count(),0);assert.equal(await page.locator('#pedido-demanda-export').isDisabled(),true);await page.evaluate(()=>exportPedidoDemandaPED());assert.equal(await page.evaluate(()=>window.__demandBooks.length),1);assert.equal(await page.evaluate(()=>localStorage.getItem('arcano33_pedidos_rapidos_v1')),'{corrupto');
  assert.deepEqual(await snapshot(),operational);assert.deepEqual(errors,[]);console.log('PASS Chrome E6.4: demanda por período, estimaciones y revisión, Excel coherente, actualización entre pestañas y por entrega, fuentes ilegibles y consulta sin escrituras');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
