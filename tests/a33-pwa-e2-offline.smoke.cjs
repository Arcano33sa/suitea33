'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const modules = ['pos','inventario','lotes','pedidos','catalogos','calculadora','agenda','centro-mando','calculadora_temporal'];
function contract(module) {
 const source=read(module+'/sw.js'), base='http://localhost/'+module+'/';
 const entries=[...source.match(/const PRECACHE(?:_URLS)?\s*=\s*\[([\s\S]*?)\];/)[1].matchAll(/['"]([^'"]+)['"]/g)].map(m=>new URL(m[1],base));
 const html=read(module+'/index.html');
 const assets=[...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1].replaceAll('&amp;','&')).filter(u=>!/^https?:/.test(u)&&/\.(js|css|webmanifest)(\?|$)/.test(u)).map(u=>new URL(u,base));
 for(const u of assets) assert(entries.some(e=>e.href===u.href),`${module}: falta ${u.href}`);
 for(const u of entries) assert(fs.existsSync(path.join(root,u.pathname)),`${module}: ruta inexistente ${u.pathname}`);
 const context=vm.createContext({self:{A33_RELEASE:{suiteVersion:'4.20.98',rev:5},addEventListener(){}},importScripts(){}});
 vm.runInContext(source+'\n;globalThis.cacheId=typeof CACHE_NAME!=="undefined"?CACHE_NAME:CACHE;',context);
 return {entries,assets,cacheId:context.cacheId};
}
async function main(){
 const contracts=Object.fromEntries(modules.map(m=>[m,contract(m)]));
 const metadata=vm.createContext({window:{A33_RELEASE:{suiteVersion:'4.20.98',rev:5}}});
 vm.runInContext(read('assets/js/a33-build.js'),metadata);
 for(const m of modules) assert.equal(metadata.window.A33_CACHE_NAME(m.replace('_','-')),contracts[m].cacheId);
 const listeners={},deleted=[];
 const calc=vm.createContext({self:{A33_RELEASE:{suiteVersion:'4.20.98',rev:5},addEventListener:(t,f)=>listeners[t]=f,clients:{async claim(){}}},importScripts(){},caches:{async keys(){return [contracts.calculadora.cacheId,contracts.calculadora_temporal.cacheId,'a33-v4.20.98-calculadora-r4-m16'];},async delete(k){deleted.push(k);return true;}}});
 vm.runInContext(read('calculadora/sw.js'),calc); let task; listeners.activate({waitUntil(p){task=p;}});await task;
 assert.deepEqual(deleted,['a33-v4.20.98-calculadora-r4-m16']);
 console.log('PASS: referencias/precache de nueve módulos, metadatos y aislamiento entre calculadoras.');
 const playwright=require(process.env.A33_PLAYWRIGHT_PATH || '/Users/juanguadamuz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
 const activationTest=process.argv.includes('--activation');
 const updated=new Set();
 const failedWorkers=new Set();
 const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png'};
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.endsWith('/__pwa_test.html')){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>PWA test</title>');return;}
  let file=path.join(root,decodeURIComponent(url.pathname)); if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');let body=fs.readFileSync(file);
  const module=url.pathname.split('/')[1];
  if(url.pathname.endsWith('/sw.js')&&failedWorkers.has(module)){res.writeHead(503);res.end();return;}
  if(url.pathname.endsWith('/sw.js')&&updated.has(module)){
   body=Buffer.from(body.toString().replace(/(MODULE_CACHE_REV = ')(\d+)/,(_,prefix,rev)=>prefix+(Number(rev)+1)).replace('-m8`','-m9`')+'\n// actualización de prueba E3\n');
  }
  res.end(body);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 let browser;
 try{
  browser=await playwright.chromium.launch({headless:true,channel:'chrome'});
  const origin='http://127.0.0.1:'+server.address().port;
  if(process.argv.includes('--config-report')){
   const context=await browser.newContext({viewport:{width:390,height:844}});
   try{
    const page=await context.newPage();await page.goto(origin+'/configuracion/index.html');
    await page.locator('#cfg-tab-pwa').click();
    await page.locator('#cfg-pwa-check').click();
    await page.waitForFunction(()=>document.getElementById('cfg-pwa-status').textContent==='Revisión completa: sin actualizaciones pendientes');
    assert.equal(await page.locator('#cfg-pwa-report li').count(),11);
    assert.equal(await page.evaluate(async()=> (await navigator.serviceWorker.getRegistrations()).length),11);
    assert.equal(await page.locator('#cfg-pwa-apply').isDisabled(),true);
    assert.equal(await page.locator('#cfg-pwa-delivery').textContent(),'4.20.98 · PWA-E3');
    await page.reload();assert.equal(await page.locator('#cfg-pwa-report li').count(),11);
    if(!await page.locator('#cfg-pwa-check').isVisible()) await page.locator('#cfg-tab-pwa').click();
    await page.evaluate(async()=>{window.testReg=await navigator.serviceWorker.register('/pos/sw.js',{scope:'/pos/'});});
    await page.waitForFunction(()=>window.testReg.active && window.testReg.active.state==='activated');
    await page.locator('#cfg-pwa-check').click();
    await page.waitForFunction(()=>document.getElementById('cfg-pwa-status').textContent==='Revisión completa: sin actualizaciones pendientes');
    assert((await page.locator('#cfg-pwa-report').textContent()).includes('POS: Sin actualización pendiente'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    console.log('PASS navegador: Configuración prepara once módulos, conserva el reporte, separa botones y respeta el ancho móvil.');
    const modulePage=await context.newPage();
    await modulePage.goto(origin+'/pos/__pwa_test.html');
    await modulePage.evaluate(()=>localStorage.setItem('a33_test_draft','conservar'));
    updated.add('pos');
    await page.locator('#cfg-pwa-check').click();
    await page.waitForFunction(()=>document.getElementById('cfg-pwa-status').textContent==='Actualización disponible');
    assert.equal(await page.locator('#cfg-pwa-check').textContent(),'Buscar actualizaciones');
    assert.equal(await page.locator('#cfg-pwa-apply').isDisabled(),false);
    if(process.argv.includes('--reopen-report')){
     await page.evaluate(async()=>{window.beforeAutomatic=(await navigator.serviceWorker.getRegistration(new URL('../pos/',location.href).href)).active;});
     await modulePage.close();
     await page.waitForFunction(async()=>{const reg=await navigator.serviceWorker.getRegistration(new URL('../pos/',location.href).href);return !reg.waiting&&reg.active!==window.beforeAutomatic&&reg.active.state==='activated';});
     // Mantener Configuración viva hasta que reciba el evento observado.
     await page.waitForFunction(()=>!!localStorage.getItem('suite_a33_pwa_automatic_activation_v1'));
     const unconfirmed=process.argv.includes('--unconfirmed-evidence');
     if(unconfirmed){
      // Simular un reporte histórico sin prueba de activación, solo en este perfil temporal.
      await page.evaluate(()=>{
       localStorage.removeItem('suite_a33_pwa_automatic_activation_v1');localStorage.removeItem('suite_a33_pwa_activation_notice_v1');
       const report=JSON.parse(localStorage.getItem('suite_a33_pwa_report_v1'));report.results.find(row=>row.id==='pos').status='available';
       localStorage.setItem('suite_a33_pwa_report_v1',JSON.stringify(report));localStorage.setItem('suite_a33_pwa_update_status','Actualización disponible');localStorage.setItem('suite_a33_pwa_last_update_at','01/01/2020 00:00');
      });
     }
     await page.close();
     const reopened=await context.newPage();await reopened.goto(origin+'/configuracion/index.html');
     await reopened.locator('#cfg-tab-pwa').click();
     const expectedStatus=unconfirmed?'No hay actualización pendiente':'Activación automática confirmada';
     try{await reopened.waitForFunction(expected=>document.getElementById('cfg-pwa-status').textContent===expected,expectedStatus,{timeout:10000});}catch(error){console.error(await reopened.evaluate(()=>({status:document.getElementById('cfg-pwa-status').textContent,automatic:localStorage.getItem('suite_a33_pwa_automatic_activation_v1'),notice:localStorage.getItem('suite_a33_pwa_activation_notice_v1'),report:localStorage.getItem('suite_a33_pwa_report_v1')})));throw error;}
     const actual={status:await reopened.locator('#cfg-pwa-status').textContent(),applyEnabled:await reopened.locator('#cfg-pwa-apply').isEnabled(),lastUpdate:await reopened.locator('#cfg-pwa-last-update').textContent()};
     console.log('REAPERTURA '+(unconfirmed?'sin evidencia guardada':'tras activación observada')+': '+JSON.stringify(actual));
     assert.equal(actual.applyEnabled,false,'Al reabrir no debe ofrecer aplicar una actualización que ya está activa');
     assert.equal(actual.status,expectedStatus);assert.notEqual(actual.lastUpdate,'Sin registros');if(unconfirmed)assert.equal(actual.lastUpdate,'01/01/2020 00:00');assert.equal(await reopened.locator('#cfg-pwa-activation-notice').isVisible(),true);await reopened.reload();await reopened.locator('#cfg-tab-pwa').click();await reopened.waitForFunction(expected=>document.getElementById('cfg-pwa-status').textContent===expected,expectedStatus);assert.equal(await reopened.locator('#cfg-pwa-last-update').textContent(),actual.lastUpdate);
     return;
    }
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('#cfg-pwa-apply').click();
    await page.waitForFunction(()=>document.getElementById('cfg-pwa-status').textContent==='Activación confirmada');
    assert.equal(await page.locator('#cfg-pwa-report li').count(),11);
    assert.notEqual(await page.locator('#cfg-pwa-last-update').textContent(),'Sin registros');
    assert.equal(await modulePage.evaluate(()=>localStorage.getItem('a33_test_draft')),'conservar');
    const lastUpdate=await page.locator('#cfg-pwa-last-update').textContent();
    failedWorkers.add('analitica');
    await page.locator('#cfg-pwa-check').click();
    await page.waitForFunction(()=>document.getElementById('cfg-pwa-status').textContent==='No se pudo verificar toda la Suite');
    assert.equal(await page.locator('#cfg-pwa-last-update').textContent(),lastUpdate);
    assert.equal(await page.locator('#cfg-pwa-apply').isDisabled(),true);
    failedWorkers.delete('analitica');
    await page.locator('#cfg-pwa-check').click();
    await page.waitForFunction(()=>document.getElementById('cfg-pwa-status').textContent==='Revisión completa: sin actualizaciones pendientes');
    const lastCheck=await page.locator('#cfg-pwa-last-check').textContent();
    await context.setOffline(true);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(()=>document.getElementById('cfg-pwa-status').textContent==='Revisión completa: sin actualizaciones pendientes');
    assert.equal(await page.locator('#cfg-pwa-check').isEnabled(),true);
    assert.equal(await page.locator('#cfg-pwa-apply').isDisabled(),true);
    assert.equal(await page.locator('#cfg-pwa-last-update').textContent(),lastUpdate);
    assert.equal(await page.locator('#cfg-pwa-last-check').textContent(),lastCheck);
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(()=>document.getElementById('cfg-pwa-check').disabled===false);
    await page.setViewportSize({width:834,height:1194});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    console.log('PASS navegador: búsqueda no activa el POS abierto; botón único confirma activación; conserva datos; fallo de red queda incompleto; ancho de iPad.');
   }finally{await context.close();}
   return;
  }
  for(const m of modules){
   const context=await browser.newContext();
   try{
    const page=await context.newPage();await page.goto(origin+'/'+m+'/__pwa_test.html');
    await page.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});await navigator.serviceWorker.ready; if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});
    if(activationTest){
     await page.evaluate(()=>{window.initialController=navigator.serviceWorker.controller;window.changes=0;navigator.serviceWorker.addEventListener('controllerchange',()=>window.changes++);document.body.innerHTML='<input id="draft" value="trabajo pendiente">';localStorage.setItem('a33_test_draft','conservar');});
     updated.add(m);
     await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();window.testRegistration=reg;await reg.update();});
     await page.waitForFunction(()=>!!(window.testRegistration.waiting && window.testRegistration.waiting.state==='installed'),{},{timeout:15000});
     const waiting=await page.evaluate(async()=>({same:navigator.serviceWorker.controller===window.initialController,changes:window.changes,draft:document.getElementById('draft').value,saved:localStorage.getItem('a33_test_draft'),keys:await caches.keys()}));
     assert.equal(waiting.same,true);assert.equal(waiting.changes,0);assert.equal(waiting.draft,'trabajo pendiente');assert.equal(waiting.saved,'conservar');assert(waiting.keys.includes(contracts[m].cacheId));
     await page.evaluate(async()=>{const reg=window.testRegistration;reg.waiting.postMessage({type:'SKIP_WAITING'});});
     await page.waitForFunction(()=>window.changes===1,{},{timeout:15000});
     assert.equal(await page.evaluate(()=>localStorage.getItem('a33_test_draft')),'conservar');
     console.log(`PASS actualización: ${m}, espera con pestaña abierta, conserva trabajo y activa solo tras mensaje.`);
    }
    await context.setOffline(true);
    const urls=contracts[m].assets.map(u=>u.pathname+u.search);
    const result=await page.evaluate(async urls=>{const out=[];for(const url of urls){try{const r=await fetch(url);out.push({url,status:r.status,length:(await r.text()).length});}catch(e){out.push({url,error:String(e)});}}return out;},urls);
    assert(result.every(r=>r.status===200&&r.length>0),`${m}: recursos offline ${JSON.stringify(result.filter(r=>r.status!==200||!r.length))}`);
    const navigation=await page.goto(origin+'/'+m+'/index.html',{waitUntil:'domcontentloaded'});assert.equal(navigation.status(),200);
    assert((await page.content()).includes('<html'),`${m}: HTML offline ausente`);
    console.log(`PASS navegador: ${m}, ${urls.length} recursos offline y navegación sin conexión tras precache.`);
   }finally{await context.close();}
  }
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
