'use strict';
// Isolated browser profile/origin; never opens the user's application data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root = path.resolve(__dirname, '..');
const origin = 'http://a33-cdm-cobrar-e2.test';
const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
(async()=>{
  const browser = await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try {
    const context = await browser.newContext({serviceWorkers:'block',timezoneId:'America/Managua'});
    await context.route('**/*', async route=>{
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/seed') return route.fulfill({body:'<!doctype html><title>Isolated fixture</title>',contentType:'text/html'});
      const file = path.resolve(root,'.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));
      if (!file.startsWith(root+path.sep) || !fs.existsSync(file)) return route.fulfill({status:404,body:''});
      return route.fulfill({body:fs.readFileSync(file),contentType:mime[path.extname(file)] || 'application/octet-stream'});
    });
    const page = await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/seed');
    await page.evaluate(async()=>{
      localStorage.setItem('a33_cmd_focusMode','EVENTO');localStorage.setItem('a33_cmd_focusEventId','1');
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('a33-pos',1);r.onupgradeneeded=()=>{for(const name of ['sales','cashV2','events','products','meta'])r.result.createObjectStore(name,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      await new Promise((resolve,reject)=>{const tx=db.transaction(['sales','events','meta'],'readwrite');
        for(const e of [{id:1,name:'Activo prueba'},{id:2,name:'Cerrado prueba',closed:true}])tx.objectStore('events').put(e);
        tx.objectStore('meta').put({id:'currentEventId',value:1});
        for(const s of [
          {id:1,eventId:1,payment:'credito',customerName:'Ana prueba',total:100,date:'2026-11-19'},
          {id:2,eventId:2,payment:'credito',customerName:'Ana prueba',total:200,creditPaidAmount:50,date:'2025-01-01'},
          {id:3,eventId:2,payment:'credito',customerName:'Beto prueba',total:80,date:'2025-02-01'},
          {id:4,eventId:2,payment:'credito',customerName:'Pagada',total:30,creditPaidAmount:30},
          {id:5,eventId:2,payment:'credito',customerName:'Anulada',total:50,status:'ANULADA'}
        ])tx.objectStore('sales').put(s);
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
      });db.close();
    });
    await page.goto(origin+'/centro-mando/');
    await page.waitForFunction(()=>window.__A33_CDM_CREDIT_STAGE3?.credits()?.totalBalance===330);
    await page.locator('[data-credit-toggle="1"]').click();
    assert.match(await page.locator('#creditPendingDetail').innerText(),/Cerrado prueba/);
    assert.equal(await page.locator('.cmd-credit-customer').count(),2);
    assert.equal(await page.locator('.cmd-credit-row').count(),3);
    assert.match(await page.locator('.cmd-credit-scope').innerText(),/no cambia con el selector/);
    await page.evaluate(()=>selectGlobalView());
    assert.equal(await page.evaluate(()=>window.__A33_CDM_CREDIT_STAGE3.credits().totalBalance),330);
    await page.evaluate(()=>selectVisualEvent(2));
    assert.equal(await page.evaluate(()=>window.__A33_CDM_CREDIT_STAGE3.credits().totalBalance),330);
    assert.equal(await page.evaluate(async()=>{const row=await getMetaValue('currentEventId');return row;}),1);
    await page.setViewportSize({width:390,height:844});
    assert(await page.locator('.cmd-credit-customer-title').first().isVisible());
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Mobile page must not overflow horizontally');
    await page.screenshot({path:path.join(os.tmpdir(),'a33-cdm-cobrar-e2-mobile.png'),fullPage:true});
    await page.evaluate(async()=>{
      await new Promise((resolve,reject)=>{const tx=state.db.transaction('sales','readwrite');const store=tx.objectStore('sales');const r=store.get(2);r.onsuccess=()=>store.put({...r.result,creditPaidAmount:200});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
      await window.__A33_CDM_CREDIT_STAGE3.refreshCredits();
    });
    assert.equal(await page.evaluate(()=>window.__A33_CDM_CREDIT_STAGE3.credits().totalBalance),180);
    assert.equal(await page.locator('.cmd-credit-row').count(),2);
    assert.deepEqual(errors,[]);
    console.log('PASS browser: all events, customer grouping, closed-event detail, invariant EVENTO/GLOBAL total, unchanged active POS event, mobile layout and payment refresh.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
