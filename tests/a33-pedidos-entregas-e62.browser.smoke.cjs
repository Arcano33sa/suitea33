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


  const snapshot=()=>page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('a33-pos');q.onsuccess=()=>r(q.result)});const stores=['inventory','sales','events','products','rawMaterials','reempaques'];const out={};for(const name of stores)out[name]=await new Promise(r=>{const q=db.transaction(name).objectStore(name).getAll();q.onsuccess=()=>r(q.result)});db.close();return out;});
  const untouched=await snapshot();
  await page.goto(origin+'/pedidos/index.html');await page.waitForFunction(()=>pedFormDraftState.ready);
  await page.evaluate(async()=>{await refreshPedidosProductCatalog(true);renderCustomerSelect('');setCustomerSelection({id:'c-e56',name:'Cliente E56'});$('fechaCreacion').value='2026-10-03';$('fechaEntrega').value='2026-10-15';$('envio').value='0';$('descuento').value='0';$('pagoAnticipado').value='0';const p=PRESENTACIONES.find(p=>p.productId==='p-e56');if(!p)throw Error('Producto fixture');$(p.qtyId).value='2';$('pedido-form').requestSubmit();});
  await page.waitForFunction(()=>loadPedidos().length===1);const orderId=await page.evaluate(()=>loadPedidos()[0].id);

  await page.evaluate(()=>{setPedidoModePED('rapido');ensureQuickHistoricalCustomerPED({customerId:'c-e56',customerName:'Cliente E56'});quickOrderItemsDraft=[{productId:'p-e56',productNameSnapshot:'Producto E56',cantidad:2}];renderQuickProductLinesPED();$('quick-delivery-date').value='2026-10-15';$('quick-order-form').requestSubmit();});
  await page.waitForFunction(()=>loadQuickOrdersPED().length===1);
  const quickId=await page.evaluate(()=>loadQuickOrdersPED()[0].id);

  const record=mode=>page.evaluate(mode=>(mode==='rapido'?loadQuickOrdersPED():loadPedidos())[0],mode);
  const initial={completo:await record('completo'),rapido:await record('rapido')};
  const open=async(mode,id)=>{await page.evaluate(mode=>setPedidoModePED(mode),mode);await page.getByRole('button',{name:'Cantidades entregadas',exact:true}).first().click();await page.locator('#pedido-entregas-modal').waitFor({state:'visible'});};
  for(const [mode,id] of [['completo',orderId],['rapido',quickId]]){
    await open(mode,id);
    assert.match(await page.locator('#pedido-entregas-notice').innerText(),/Sin cantidades registradas/);
    const input=page.locator('#pedido-entregas-lines input');
    await input.fill('1');assert.match(await page.locator('[data-delivery-pending]').innerText(),/Pendiente: 1/);
    await page.locator('#pedido-entregas-save').click();await page.waitForFunction(()=>document.getElementById('pedido-entregas-notice').textContent.includes('guardadas'));
    let saved=await record(mode);assert.equal(saved.entregasAcumuladas.productos[0].cantidad,1);assert.equal(saved.estado,'pendiente');
    if(mode==='completo')await page.screenshot({path:path.join(os.tmpdir(),'a33-e62-entregas.png')});
    await input.fill('3');await page.evaluate(()=>document.getElementById('pedido-entregas-form').dispatchEvent(new Event('submit',{cancelable:true})));
    assert.match(await page.locator('#pedido-entregas-notice').innerText(),/entre cero y lo pedido/);assert.equal((await record(mode)).entregasAcumuladas.productos[0].cantidad,1);
    // Cerrar con cambios exige confirmación; al rechazar conserva el valor.
    page.removeAllListeners('dialog');page.once('dialog',d=>d.dismiss());await page.locator('#pedido-entregas-close').click();assert.equal(await input.inputValue(),'3');assert.equal(await page.locator('#pedido-entregas-modal').isVisible(),true);page.on('dialog',d=>d.accept());
    await input.fill('2');await page.locator('#pedido-entregas-save').click();await page.waitForFunction(()=>document.getElementById('pedido-entregas-notice').textContent.includes('guardadas'));
    saved=await record(mode);assert.equal(saved.estado,'pendiente','Completar cantidades no cambia el estado');assert.equal(saved.entregasAcumuladas.productos[0].cantidad,2);
    await page.locator('#pedido-entregas-close').click();
    // Guardado ordinario conserva las cantidades; reducir lo contratado por debajo de lo entregado se bloquea.
    if(mode==='completo'){
      await page.evaluate(id=>editPedido(id),id);await page.locator('#clienteReferencia').fill('Referencia E62');await page.evaluate(()=>$('pedido-form').requestSubmit());await page.waitForFunction(()=>loadPedidos()[0].clienteReferencia==='Referencia E62');
      await page.evaluate(id=>editPedido(id),id);await page.evaluate(()=>{const p=PRESENTACIONES.find(p=>p.productId==='p-e56');$(p.qtyId).value='1';$('pedido-form').requestSubmit();});await page.waitForFunction(()=>$('archived-notice').textContent.includes('menos de lo ya entregado'));
      assert.equal((await record(mode)).items[0].qty,2);
      await page.evaluate(()=>clearForm());
    }else{
      await page.evaluate(id=>editQuickOrderPED(id),id);await page.locator('#quick-priority').selectOption('alta');await page.evaluate(()=>$('quick-order-form').requestSubmit());await page.waitForFunction(()=>loadQuickOrdersPED()[0].prioridad==='alta');
      await page.evaluate(id=>editQuickOrderPED(id),id);await page.locator('#quick-product-lines input[data-draft-index]').fill('1');await page.evaluate(()=>$('quick-order-form').requestSubmit());assert.match(await page.locator('#quick-form-notice').innerText(),/menos de lo ya entregado/);assert.equal((await record(mode)).items[0].cantidad,2);await page.evaluate(()=>resetQuickOrderFormPED({discard:true}));
    }
    assert.equal((await record(mode)).entregasAcumuladas.productos[0].cantidad,2);
    await page.reload();await page.waitForFunction(()=>pedFormDraftState.ready);await open(mode,id);assert.equal(await page.locator('#pedido-entregas-lines input').inputValue(),'2');
    // Conflicto por contenido aunque updatedAt no cambie: no pierde la edición local.
    await page.locator('#pedido-entregas-lines input').fill('1');
    const key=mode==='rapido'?'arcano33_pedidos_rapidos_v1':'arcano33_pedidos';
    const external=await context.newPage();await external.goto(origin+'/agenda/offline.html');await external.evaluate(key=>{const rows=JSON.parse(localStorage.getItem(key));rows[0].notaExterna='Otra pestaña E62';localStorage.setItem(key,JSON.stringify(rows));},key);
    const before=await page.evaluate(key=>localStorage.getItem(key),key);await page.locator('#pedido-entregas-save').click();assert.match(await page.locator('#pedido-entregas-notice').innerText(),/cambió/);assert.equal(await page.locator('#pedido-entregas-lines input').inputValue(),'1');assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),before);await external.close();await page.locator('#pedido-entregas-close').click();
    // Error de escritura conserva campos y registro anterior.
    await open(mode,id);await page.locator('#pedido-entregas-lines input').fill('1');await page.evaluate(()=>{window.__e62Set=A33Storage.sharedSet;A33Storage.sharedSet=()=>({ok:false,message:'Escritura rechazada E62'});});await page.locator('#pedido-entregas-save').click();assert.match(await page.locator('#pedido-entregas-notice').innerText(),/confirmar|rechazada/);assert.equal(await page.locator('#pedido-entregas-lines input').inputValue(),'1');assert.equal((await record(mode)).entregasAcumuladas.productos[0].cantidad,2);await page.evaluate(()=>{A33Storage.sharedSet=window.__e62Set;});await page.locator('#pedido-entregas-close').click();
  }
  const sheets=await page.evaluate(async()=>{const original=XLSX.writeFile;let result;XLSX.writeFile=wb=>{result=Object.fromEntries(wb.SheetNames.map(name=>[name,XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1})]));};try{await exportToCSV();return result;}finally{XLSX.writeFile=original;}});
  assert.equal(sheets.Entregas.length,3);for(const row of sheets.Entregas.slice(1)){assert.equal(row[7],2);assert.equal(row[8],0);assert.equal(row[3],'Pendiente');}
  const final=await record('completo');for(const key of ['totalPagar','pagoAnticipado','saldoPendiente','priceSnapshot'])assert.deepEqual(final[key],initial.completo[key]);
  assert.deepEqual(await snapshot(),untouched,'Entregas no modifican stock, ventas, eventos, productos, insumos ni reempaques');
  assert.deepEqual(errors,[]);console.log('PASS Chrome E6.2: entregas parciales, límites, guardado ordinario, recarga, conflictos y fallos, Excel y datos operacionales intactos');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
