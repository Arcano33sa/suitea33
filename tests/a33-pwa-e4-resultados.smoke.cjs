'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../configuracion/script.js'),'utf8');
const region=source.slice(source.indexOf('  const PWA_KEYS'),source.indexOf('  function reqToPromise'));
function worker(state='installed',outcome='activated'){
 const events=new Map();return {state,scriptURL:'https://suite.test/pos/sw.js',addEventListener(t,f){events.set(t,f);},removeEventListener(t){events.delete(t);},postMessage(){this.state=outcome;events.get('statechange')?.();}};
}
function registration(id,w=null){
 if(w)w.scriptURL=`https://suite.test/${id}/sw.js`;
 return {scope:`https://suite.test/${id}/`,waiting:w,active:Object.assign(worker('activated'),{scriptURL:`https://suite.test/${id}/sw.js`}),installing:null,async update(){},addEventListener(){},removeEventListener(){}};
}
function harness(regs){
 const data=new Map(),items=[];const button={textContent:'',setAttribute(){},addEventListener(){},classList:{toggle(){}}};
 const applyButton={...button};
 const document={getElementById(id){if(id==='cfg-pwa-report')return {replaceChildren(){items.length=0;},appendChild(item){items.push(item.textContent);}};if(id==='cfg-pwa-check')return button;if(id==='cfg-pwa-apply')return applyButton;return null;},querySelector(){return null;},createElement(){return {textContent:''};}};
 const window={location:{href:'https://suite.test/configuracion/index.html',origin:'https://suite.test'},confirm(){return true;},A33Notice:{show(){}}};
 const context=vm.createContext({window,document,navigator:{serviceWorker:{async getRegistrations(){return regs;}}},localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},sessionStorage:{getItem(){},setItem(){}},URL,Date,JSON,Set,Promise,showToast(){},setTimeout:(f,ms)=>setTimeout(f,Math.min(ms,20)),clearTimeout,setInterval:f=>setInterval(f,1),clearInterval});
 vm.runInContext(region+'\n;globalThis.api={checkSuitePwaUpdates,applySuitePwaUpdate,handlePwaCheck,handlePwaApply,waitForPwaRegistrationActivation,inspectPwaRegistration,initPwaSection,renderPwaSection,pwaRuntime,PWA_STATUS,PWA_KEYS,getSuitePwaRegistrations};',context);
 return {api:context.api,data,items,button,applyButton};
}
(async()=>{
 let h=harness([]);await h.api.handlePwaCheck();assert.equal(h.data.get(h.api.PWA_KEYS.status),h.api.PWA_STATUS.noRegistered);assert.equal(h.items.length,11);assert.equal(h.applyButton.disabled,true);
 const unknown=registration('desconocido');h=harness([registration('pos'),unknown,registration('centro_mando')]);assert.equal((await h.api.getSuitePwaRegistrations()).length,1);await h.api.handlePwaCheck();assert.equal(h.data.get(h.api.PWA_KEYS.status),h.api.PWA_STATUS.partialSearch);assert(h.items.some(x=>x.startsWith('POS: Sin actualización')));
 const ids=['pos','inventario','lotes','pedidos','catalogos','calculadora','agenda','centro-mando','calculadora_temporal','finanzas','analitica'];
 h=harness(ids.map(id=>registration(id)));await h.api.handlePwaCheck();assert.equal(h.data.get(h.api.PWA_KEYS.status),h.api.PWA_STATUS.current);assert.equal(h.applyButton.disabled,true);
 const broken=registration('pos');broken.update=async()=>{throw new Error('sin conexión');};h=harness([broken,registration('pedidos',worker())]);await h.api.handlePwaCheck();assert.equal(h.data.get(h.api.PWA_KEYS.status),h.api.PWA_STATUS.partialSearch);assert.equal(h.button.textContent,'Buscar actualizaciones');assert.equal(h.applyButton.textContent,'Actualizar Suite');assert.equal(h.applyButton.disabled,false);assert(h.items.some(x=>x.includes('sin conexión')));h.api.pwaRuntime.updateAvailable=false;h.api.initPwaSection();assert.equal(h.button.textContent,'Buscar actualizaciones');assert.equal(h.applyButton.textContent,'Actualizar Suite');assert.equal(h.applyButton.disabled,false);
 const installing=registration('pos');installing.installing=worker('installing');h=harness([installing]);const summary=await h.api.checkSuitePwaUpdates();assert.equal(summary.available,false);assert.equal(summary.results[0].status,'installing');
 installing.installing.state='redundant';assert.equal((await h.api.inspectPwaRegistration(installing)).status,'error');
 h=harness([registration('pos',worker()),registration('pedidos',worker('installed','redundant'))]);h.data.set(h.api.PWA_KEYS.lastUpdate,'histórico');await h.api.handlePwaApply();assert.equal(h.data.get(h.api.PWA_KEYS.status),h.api.PWA_STATUS.partialApply);assert.equal(h.data.get(h.api.PWA_KEYS.lastUpdate),'histórico');assert(h.items.some(x=>x.startsWith('POS: Activación confirmada')));assert(h.items.some(x=>x.startsWith('Pedidos: No se pudo completar')));
 h=harness([registration('pos',worker('installed','redundant'))]);await h.api.handlePwaApply();assert.equal(h.data.get(h.api.PWA_KEYS.status),h.api.PWA_STATUS.applyError);assert.equal(h.data.has(h.api.PWA_KEYS.lastUpdate),false);
 h=harness([registration('pos',worker()),registration('pedidos',worker())]);await h.api.handlePwaApply();assert.equal(h.data.get(h.api.PWA_KEYS.status),h.api.PWA_STATUS.applied);assert(h.data.has(h.api.PWA_KEYS.lastUpdate));assert.equal(h.applyButton.disabled,true);assert.equal(h.button.disabled,false);assert(h.items.every(x=>x.includes('abre el módulo')));
 // Same script URL is insufficient: the old active worker cannot confirm the new target.
 const target=worker('redundant'),reg=registration('pos');reg.active.scriptURL=target.scriptURL;assert.equal(await h.api.waitForPwaRegistrationActivation(reg,target,1),false);
 h=harness([]);await h.api.handlePwaApply();assert.equal(h.data.get(h.api.PWA_KEYS.status),h.api.PWA_STATUS.partialSearch);
 console.log('PASS: cero registros, inventario explícito, búsqueda completa/parcial, errores, instalación en curso/fallida, activación parcial/fallida/completa, identidad del worker y fechas históricas.');
})().catch(e=>{console.error(e);process.exitCode=1;});
