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
  const url=`http://127.0.0.1:${server.address().port}/pos/index.html`;
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser=await playwright.chromium.launch({headless:true,...(fs.existsSync(chrome)?{executablePath:chrome}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(()=>document.getElementById('purchase-modal')?.dataset.bound==='1');
  const result=await page.evaluate(async()=>{
    // El HTML vigente no monta el Checklist heredado. Fixture DOM temporal
    // para ejercitar su render sin añadir una pantalla a la aplicación.
    const fixture=document.createElement('section');fixture.id='tab-checklist';
    fixture.innerHTML='<div id="checklist-empty"></div><select id="checklist-event"></select><div id="checklist-grid"><div id="chk-pre"></div><div id="chk-evento"></div><div id="chk-cierre"></div></div>';
    document.body.appendChild(fixture);
    const id=9521;
    await put('events',{id,name:'Checklist E52',checklistTemplate:{pre:[{id:'e52',text:'Original'}],evento:[],cierre:[]},days:{},other:'preservar'});
    await setMeta('currentEventId',id);await renderChecklistTab();
    const d=_getChecklistDraftStorePOS();
    const real=saveChecklistTextBatchPOS;
    saveChecklistTextBatchPOS=async()=>{throw new Error('Fallo simulado E52');};
    queueChecklistTextSavePOS('pre','e52','Texto pendiente',{force:true});
    const failed=await flushChecklistTextQueuePOS();
    await renderChecklistTab();
    const visible=document.querySelector('#chk-pre .chk-text').value;
    const pending=Object.keys(d.q).length;
    const unchanged=(await getEventByIdPOS(id)).checklistTemplate.pre[0].text;
    saveChecklistTextBatchPOS=real;
    const retried=await flushChecklistTextQueuePOS();
    const saved=await getEventByIdPOS(id);
    await renderChecklistTab();
    return {failed,visible,pending,unchanged,retried,text:saved.checklistTemplate.pre[0].text,other:saved.other,remaining:Object.keys(d.q).length,
      finalVisible:document.querySelector('#chk-pre .chk-text').value};
  });
  assert.equal(result.failed,false);assert.equal(result.pending,1);assert.equal(result.unchanged,'Original');
  assert.equal(result.visible,'Texto pendiente');assert.equal(result.retried,true);assert.equal(result.remaining,0);
  assert.equal(result.text,'Texto pendiente');assert.equal(result.finalVisible,'Texto pendiente');assert.equal(result.other,'preservar');
  assert.deepEqual(errors,[]);
  console.log('PASS E5.2 Chrome: fallo, render pendiente y reintento con IndexedDB real en origen temporal');
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
