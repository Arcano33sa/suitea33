'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');
let playwright;
try { playwright=require('playwright'); }
catch (_) { playwright=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'finanzas/script.js'),'utf8');
const readers=source.slice(source.indexOf('async function finReadPosOperationalSourcesSafe()'),source.indexOf('const FIN_OPERATIONAL_CLASS_STAGE'));
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/__e44.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>E4.4 aislada</title>');return;}
  const file=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'}[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(error?'':data);});
});
let browser;
(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  browser=await playwright.chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({serviceWorkers:'block',timezoneId:'America/Managua',viewport:{width:1280,height:900}});
  const origin='http://127.0.0.1:'+server.address().port;
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/finanzas/index.html#tab=tablero');
  await page.waitForFunction(()=>typeof finCachedData!=='undefined'&&!!finCachedData);
  await page.evaluate(()=>{
    window.e3Fixture={posSales:[
      {id:1,date:'2026-11-10',eventId:1,qty:1,unitPrice:10000,total:10000,lineCost:4000,payment:'tarjeta',commissionAmountSnapshot:150,commissionLabelSnapshot:'Comisión prueba',commissionSnapshotStatus:'determinada'},
      {id:2,date:'2026-11-10',eventId:1,qty:1,unitPrice:500,total:0,lineCost:200,payment:'efectivo',courtesy:true}
    ],posReempaques:[{id:1,date:'2026-11-10',eventId:1,tipo:'REEMPAQUE_MERMA_FINAL_EVENTO',costoMermaFinal:50,mermaFinalMl:100}],
    entries:[{id:1,source:'manual_financial_account',fecha:'2026-11-10',operationalClass:'ADDITIONAL_INCOME',baseAmountNio:300,paymentMethod:'bank',posEventId:1,eventScope:'POS'}],
    posCashV2:[{eventId:1,dayKey:'2026-11-10',movements:[{id:'op1',kind:'OUT',amount:100,currency:'NIO'}]}]};
    window.e3Filter={desde:'2026-11-01',hasta:'2026-11-30',evento:'ALL'};
    window.e3Before=calcTableroClasificadoForFilter(e3Fixture,e3Filter);
    document.getElementById('tab-periodo').value='mes';document.getElementById('tab-mes').value='11';document.getElementById('tab-anio').value='2026';
    finCachedData=e3Fixture;renderTablero(finCachedData);
    localStorage.setItem('a33_catalogos_gastos_v1',JSON.stringify({version:1,categories:[{id:'h',name:'Higiene',active:true},{id:'l',name:'Limpieza',active:true}],items:[{id:'g',name:'Guantes',categoryId:'h',presentation:'box',boxPrice:500,unitsPerBox:100,active:true},{id:'j',name:'Jabón',categoryId:'l',presentation:'unit',unitPrice:500,active:true}]}));
  });
  const baseResult=await page.evaluate(()=>({previa:e3Before.utilidadPrevia,neta:e3Before.utilidadNeta,gastos:e3Before.gastos,income:e3Before.ingresosAdicionales}));
  assert.deepStrictEqual(baseResult,{previa:5600,neta:5800,gastos:100,income:300});
  const expenses=await context.newPage();await expenses.goto(origin+'/gastos/');
  await expenses.locator('#purchase-date').fill('2026-11-10');
  await expenses.locator('[data-field=itemId]').selectOption('g');await expenses.locator('[data-field=quantity]').fill('2');
  await expenses.locator('#add-line').click();await expenses.locator('[data-field=itemId]').nth(1).selectOption('j');
  await expenses.locator('#save-purchase').click();
  await expenses.waitForFunction(()=>document.getElementById('purchase-status').textContent.includes('Compra guardada'));
  // Evento storage debe actualizar el tablero abierto sin recarga.
  await page.waitForFunction(()=>document.getElementById('tab-gastos').textContent.includes('1,500')||document.getElementById('tab-gastos').textContent.includes('1.500'));
  const values=await page.evaluate(()=>{
    const current=calcTableroClasificadoForFilter(e3Fixture,e3Filter);
    return {previa:current.utilidadPrevia,neta:current.utilidadNeta,general:current.gastosGenerales,op:current.gastos,income:current.ingresosAdicionales,liquiditySame:JSON.stringify(current.liquidityPeriod)===JSON.stringify(e3Before.liquidityPeriod),cashSame:current.flujoCaja===e3Before.flujoCaja};
  });
  assert.deepStrictEqual(values,{previa:5600,neta:4300,general:1500,op:100,income:300,liquiditySame:true,cashSame:true});
  assert.match(await page.locator('#tab-utilidad-previa').textContent(),/5[,.]600/);
  assert.match(await page.locator('#tab-utilidad-neta').textContent(),/4[,.]300/);
  assert.match(await page.locator('#tab-gastos-operativos').textContent(),/100/);
  assert.strictEqual(await page.locator('#tab-gastos small').count(),0);
  // Cada filtro suma compras completas una sola vez, aunque tengan varias categorías.
  const filters=await page.evaluate(()=>{
    const read=f=>finReadGeneralExpensesForFilter(f);
    return {edge:read({desde:'2026-11-10',hasta:'2026-11-10'}).total,before:read({hasta:'2026-11-09'}).total,after:read({desde:'2026-11-11'}).total,year:read({desde:'2026-01-01',hasta:'2026-12-31'}).total,event:calcTableroClasificadoForFilter(e3Fixture,{...e3Filter,evento:'POS:1'})};
  });
  assert.strictEqual(filters.edge,1500);assert.strictEqual(filters.before,0);assert.strictEqual(filters.after,0);assert.strictEqual(filters.year,1500);assert.strictEqual(filters.event.gastosGenerales,0);assert.strictEqual(filters.event.utilidadNeta,5800);
  const preserved=await page.evaluate(()=>localStorage.getItem('a33_gastos_v1'));
  await page.evaluate(()=>{const state=JSON.parse(localStorage.getItem('a33_gastos_v1'));state.purchases[0].totalCents=999;localStorage.setItem('a33_gastos_v1',JSON.stringify(state));renderTablero(finCachedData);});
  assert.strictEqual(await page.locator('#tab-utilidad-neta').textContent(),'No disponible');
  assert.strictEqual(await page.locator('#tab-gastos').textContent(),'No disponible');
  assert.strictEqual(await page.locator('#tab-margen-neto').textContent(),'No disponible');
  assert.strictEqual(await page.locator('#tab-read-status').isVisible(),true);
  assert.match(await page.locator('#tab-read-status').textContent(),/a33_gastos_v1/);
  assert.strictEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('a33_gastos_v1')).purchases[0].totalCents),999);
  // Recuperación sin reescrituras de Finanzas.
  await page.evaluate(raw=>{localStorage.setItem('a33_gastos_v1',raw);renderTablero(finCachedData);},preserved);
  assert.strictEqual(await page.locator('#tab-read-status').isVisible(),false);
  assert.strictEqual(await page.evaluate(()=>localStorage.getItem('a33_gastos_v1')),preserved);
  // Un gasto puede dejar pérdida: no se limita a cero.
  assert.strictEqual(await page.evaluate(()=>calcTableroClasificadoForFilter({},e3Filter).utilidadNeta),-1500);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));
  assert.strictEqual(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/tmp/a33-finanzas-e3-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'/tmp/a33-finanzas-e3-desktop.png',fullPage:true});
  assert.deepStrictEqual(errors,[]);
  console.log('PASS E3: Gastos reales → Finanzas, fórmula con ingresos/gastos operativos, períodos y límites, sin reparto por evento, sin cambios de dinero/historial, pérdida, errores y recuperación, móvil.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
