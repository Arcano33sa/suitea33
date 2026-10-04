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


  await page.evaluate(()=>localStorage.setItem('arcano33_lotes',JSON.stringify([
    {loteId:'l-e63',id:'historical-e63',codigo:'A33-2025-12-01-01',fecha:'2025-12-01',estado:'CERRADO',productosProducidos:[{productId:'p-e56',cantidad:20}]},
    {codigo:'A33-2024-01-01-01',fecha:'2024-01-01',notas:'Sin id histórico'},
    {id:'ambiguous-a',codigo:'DUPLICADO'},{id:'ambiguous-b',codigo:'DUPLICADO'},
    {notas:'Sin identidad'}
  ])));
  const snapshot=()=>page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('a33-pos');q.onsuccess=()=>r(q.result)});const out={};for(const name of ['inventory','sales','events','products','rawMaterials','reempaques'])out[name]=await new Promise(r=>{const q=db.transaction(name).objectStore(name).getAll();q.onsuccess=()=>r(q.result)});db.close();return out;});
  const untouched=await snapshot();
  await page.goto(origin+'/pedidos/index.html');await page.waitForFunction(()=>pedFormDraftState.ready);
  await page.evaluate(async()=>{await refreshPedidosProductCatalog(true);renderCustomerSelect('');setCustomerSelection({id:'c-e56',name:'Cliente E56'});$('fechaCreacion').value='2026-10-03';$('fechaEntrega').value='2026-10-15';$('lotesRelacionados').value=' A33-TEXTO-ANTIGUO, nota manual ';$('envio').value='0';$('descuento').value='0';$('pagoAnticipado').value='0';const p=PRESENTACIONES.find(p=>p.productId==='p-e56');if(!p)throw Error('Producto fixture');$(p.qtyId).value='2';$('pedido-form').requestSubmit();});
  await page.waitForFunction(()=>loadPedidos().length===1);const orderId=await page.evaluate(()=>loadPedidos()[0].id);

  await page.evaluate(()=>{setPedidoModePED('rapido');ensureQuickHistoricalCustomerPED({customerId:'c-e56',customerName:'Cliente E56'});quickOrderItemsDraft=[{productId:'p-e56',productNameSnapshot:'Producto E56',cantidad:2}];renderQuickProductLinesPED();$('quick-delivery-date').value='2026-10-15';$('quick-order-form').requestSubmit();});
  await page.waitForFunction(()=>loadQuickOrdersPED().length===1);
  const quickId=await page.evaluate(()=>loadQuickOrdersPED()[0].id);

  const record=mode=>page.evaluate(mode=>(mode==='rapido'?loadQuickOrdersPED():loadPedidos())[0],mode);
  const originalFull=await record('completo');
  const open=async(mode)=>{await page.evaluate(mode=>setPedidoModePED(mode),mode);await page.getByRole('button',{name:'Vincular lotes',exact:true}).first().click();await page.locator('#pedido-lotes-modal').waitFor({state:'visible'});};
  let lotRaw=await page.evaluate(()=>localStorage.getItem('arcano33_lotes'));
  for(const [mode,id] of [['completo',orderId],['rapido',quickId]]){
    await open(mode);assert.equal(await page.locator('#pedido-lotes-select option').count(),3,'Solo dos lotes inequívocos');
    assert.equal((await record(mode)).lotesVinculados,undefined,'Abrir no migra el texto histórico');
    await page.locator('#pedido-lotes-select').selectOption({label:'A33-2025-12-01-01 · 2025-12-01'});await page.locator('#pedido-lotes-add').click();assert.equal(await page.locator('#pedido-lotes-list li').count(),1);assert.equal(await page.locator('#pedido-lotes-select option').count(),2,'No ofrece duplicar vínculo');
    await page.locator('#pedido-lotes-select').selectOption({label:'A33-2024-01-01-01 · 2024-01-01'});await page.locator('#pedido-lotes-add').click();
    await page.locator('#pedido-lotes-save').click();await page.waitForFunction(()=>document.getElementById('pedido-lotes-notice').textContent.includes('guardados'));
    let saved=await record(mode);assert.equal(saved.lotesVinculados.lotes.length,2);assert.equal(saved.estado,'pendiente');assert.equal(saved.entregasAcumuladas,undefined);assert.equal(await page.evaluate(()=>localStorage.getItem('arcano33_lotes')),lotRaw);
    if(mode==='completo'){assert.equal(saved.lotesRelacionados,originalFull.lotesRelacionados);assert.match(await page.locator('#pedido-lotes-legacy').innerText(),/A33-TEXTO-ANTIGUO/);}
    if(mode==='completo')await page.screenshot({path:path.join(os.tmpdir(),'a33-e63-lotes.png')});
    await page.locator('#pedido-lotes-close').click();
    // Edición ordinaria conserva vínculos y texto original.
    if(mode==='completo'){await page.evaluate(id=>editPedido(id),id);await page.locator('#clienteReferencia').fill('Referencia E63');await page.evaluate(()=>$('pedido-form').requestSubmit());await page.waitForFunction(()=>loadPedidos()[0].clienteReferencia==='Referencia E63');}
    else{await page.evaluate(id=>editQuickOrderPED(id),id);await page.locator('#quick-priority').selectOption('alta');await page.evaluate(()=>$('quick-order-form').requestSubmit());await page.waitForFunction(()=>loadQuickOrdersPED()[0].prioridad==='alta');}
    assert.equal((await record(mode)).lotesVinculados.lotes.length,2);
    await page.reload();await page.waitForFunction(()=>pedFormDraftState.ready);await open(mode);assert.equal(await page.locator('#pedido-lotes-list li').count(),2);
    await page.locator('#pedido-lotes-list button').first().click();
    // Rechazar descarte conserva selección pendiente.
    page.removeAllListeners('dialog');page.once('dialog',d=>d.dismiss());await page.locator('#pedido-lotes-close').click();assert.equal(await page.locator('#pedido-lotes-modal').isVisible(),true);assert.equal(await page.locator('#pedido-lotes-list li').count(),1);page.on('dialog',d=>d.accept());
    const key=mode==='rapido'?'arcano33_pedidos_rapidos_v1':'arcano33_pedidos';
    const external=await context.newPage();await external.goto(origin+'/agenda/offline.html');await external.evaluate(key=>{const rows=JSON.parse(localStorage.getItem(key));rows[0].notaExterna='Otra pestaña E63';localStorage.setItem(key,JSON.stringify(rows));},key);
    const before=await page.evaluate(key=>localStorage.getItem(key),key);await page.locator('#pedido-lotes-save').click();assert.match(await page.locator('#pedido-lotes-notice').innerText(),/cambió/);assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),before);assert.equal(await page.locator('#pedido-lotes-list li').count(),1);await external.close();await page.locator('#pedido-lotes-close').click();
    await open(mode);await page.locator('#pedido-lotes-list button').first().click();await page.evaluate(()=>{window.__e63Set=A33Storage.sharedSet;A33Storage.sharedSet=()=>({ok:false,message:'Escritura rechazada E63'});});await page.locator('#pedido-lotes-save').click();assert.match(await page.locator('#pedido-lotes-notice').innerText(),/confirmar|rechazada/);assert.equal((await record(mode)).lotesVinculados.lotes.length,2);assert.equal(await page.locator('#pedido-lotes-list li').count(),1);await page.evaluate(()=>{A33Storage.sharedSet=window.__e63Set;});await page.locator('#pedido-lotes-close').click();
  }
  // Cambios del catálogo simulados exclusivamente en almacenamiento temporal.
  await page.evaluate(()=>{const rows=JSON.parse(localStorage.getItem('arcano33_lotes'));rows[0].codigo='CODIGO-ACTUAL';rows[1].id='backfilled-historic';localStorage.setItem('arcano33_lotes',JSON.stringify(rows));});
  lotRaw=await page.evaluate(()=>localStorage.getItem('arcano33_lotes'));await open('completo');assert.match(await page.locator('#pedido-lotes-list').innerText(),/Código actual: CODIGO-ACTUAL/);assert.equal(await page.locator('#pedido-lotes-list li').filter({hasText:'Localizado'}).count(),2);await page.locator('#pedido-lotes-close').click();
  await page.evaluate(()=>{const rows=JSON.parse(localStorage.getItem('arcano33_lotes'));localStorage.setItem('arcano33_lotes',JSON.stringify(rows.filter(row=>row.loteId!=='l-e63')));});lotRaw=await page.evaluate(()=>localStorage.getItem('arcano33_lotes'));await open('rapido');assert.match(await page.locator('#pedido-lotes-list').innerText(),/A33-2025-12-01-01.*No localizado/);await page.locator('#pedido-lotes-save').click();assert.equal((await record('rapido')).lotesVinculados.lotes.length,2,'No borra referencias no localizadas');await page.locator('#pedido-lotes-close').click();
  const sheets=await page.evaluate(async()=>{const original=XLSX.writeFile;let result;XLSX.writeFile=wb=>{result=Object.fromEntries(wb.SheetNames.map(name=>[name,XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1})]));};try{await exportToCSV();return result;}finally{XLSX.writeFile=original;}});
  assert.equal(sheets['Lotes vinculados'].length,5);assert.equal(sheets['Lotes vinculados'].filter(row=>row[7]==='No localizado').length,2);assert.ok(sheets['Lotes vinculados'].some(row=>row[8]===originalFull.lotesRelacionados));
  // Fuente ilegible bloquea editor y conserva referencias visibles.
  await page.evaluate(()=>localStorage.setItem('arcano33_lotes','{inválido'));await open('completo');assert.match(await page.locator('#pedido-lotes-notice').innerText(),/No se pudieron leer/);assert.equal(await page.locator('#pedido-lotes-save').isDisabled(),true);assert.equal(await page.locator('#pedido-lotes-list li').count(),2);await page.locator('#pedido-lotes-close').click();assert.equal(await page.evaluate(()=>localStorage.getItem('arcano33_lotes')),'{inválido');
  const final=await record('completo');for(const key of ['totalPagar','pagoAnticipado','saldoPendiente','priceSnapshot','lotesRelacionados'])assert.deepEqual(final[key],originalFull[key]);const withoutCapture=value=>JSON.parse(JSON.stringify(value,(key,val)=>key==='capturedAt'?undefined:val));
  // La edición ordinaria recaptura la fecha de la fotografía; su contenido comercial permanece intacto.
  assert.deepEqual(withoutCapture(final.items),withoutCapture(originalFull.items));assert.deepEqual(await snapshot(),untouched);
  assert.deepEqual(errors,[]);console.log('PASS Chrome E6.3: selector informativo, persistencia, conflictos y fallos, identidades históricas, fuentes ilegibles, Excel y datos operacionales intactos');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
