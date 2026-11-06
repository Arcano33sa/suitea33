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
function harness(regs, failMissing=false){
 const registered=[];
 const data=new Map(),items=[],modals=[];const button={textContent:'',setAttribute(){},addEventListener(){},classList:{toggle(){}}};
 const applyButton={...button};
 const document={addEventListener(){},getElementById(id){if(id==='cfg-pwa-report')return {replaceChildren(){items.length=0;},appendChild(item){items.push(item.textContent);}};if(id==='cfg-pwa-check')return button;if(id==='cfg-pwa-apply')return applyButton;return null;},querySelector(){return null;},createElement(){return {textContent:''};}};
 const window={addEventListener(){},location:{href:'https://suite.test/configuracion/index.html',origin:'https://suite.test'},confirm(){return true;},A33Notice:{show(){}}};
 const context=vm.createContext({window,document,navigator:{serviceWorker:{async getRegistrations(){return regs;},async register(url,options){registered.push({url,options});if(failMissing)throw new Error('sin conexión');const id=new URL(options.scope).pathname.split('/').filter(Boolean).pop();const reg=registration(id);regs.push(reg);return reg;}}},localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},sessionStorage:{getItem(){},setItem(){}},URL,Date,JSON,Set,Promise,escapeHtml:String,hideModal(){},showModal(result){modals.push(result);},showToast(){},setTimeout:(f,ms)=>setTimeout(f,Math.min(ms,20)),clearTimeout,setInterval:f=>setInterval(f,1),clearInterval});
 vm.runInContext(region+'\n;globalThis.api={checkSuitePwaUpdates,applySuitePwaUpdate,handlePwaCheck,handlePwaApply,waitForPwaRegistrationActivation,inspectPwaRegistration,initPwaSection,renderPwaSection,pwaRuntime,PWA_STATUS,PWA_KEYS,getSuitePwaRegistrations,reconcilePwaState,observePwaActivation};',context);
 return {api:context.api,data,items,button,applyButton,registered,modals};
}
(async()=>{
 let h=harness([]);
 await h.api.handlePwaCheck();
 assert.equal(h.data.get(h.api.PWA_KEYS.status),h.api.PWA_STATUS.noRegistered);
 assert.equal(h.registered.length,0);
 assert.equal(h.items.length,11);
 assert.equal(h.applyButton.disabled,true);

 const pos=registration('pos',worker());
 let searches=0;
 pos.update=async()=>{searches++;};
 h=harness([pos,registration('centro_mando')]);
 await h.api.initPwaSection();
 assert.equal(h.applyButton.disabled,true);
 await h.api.handlePwaApply();
 assert.equal(pos.waiting.state,'installed');
 await h.api.handlePwaCheck();
 assert.equal(searches,1);
 assert.equal(h.registered.length,0);
 assert.equal(pos.waiting.state,'installed');
 assert.equal(h.button.textContent,'Buscar actualización');
 assert.equal(h.applyButton.textContent,'Instalar actualización');
 assert.equal(h.applyButton.disabled,false);
 await h.api.handlePwaApply();
 assert.equal(searches,1);
 assert.equal(h.modals.at(-1).title,'Actualización instalada correctamente');
 assert.equal(h.data.get(h.api.PWA_KEYS.status),h.api.PWA_STATUS.applied);
 assert(h.data.has(h.api.PWA_KEYS.lastUpdate));
 assert.equal(h.applyButton.disabled,true);

 const broken=registration('pedidos',worker('installed','redundant'));
 h=harness([registration('pos',worker()),broken]);
 h.data.set(h.api.PWA_KEYS.lastUpdate,'histórico');
 await h.api.handlePwaCheck();
 await h.api.handlePwaApply();
 assert.equal(h.data.get(h.api.PWA_KEYS.status),h.api.PWA_STATUS.partialApply);
 assert.equal(h.data.get(h.api.PWA_KEYS.lastUpdate),'histórico');
 assert.match(h.modals.at(-1).bodyHtml,/Pedidos/);

 const stale=registration('pos',worker());
 h=harness([stale]);
 await h.api.handlePwaCheck();
 stale.waiting=worker();
 await h.api.handlePwaApply();
 assert.equal(stale.waiting.state,'installed');
 assert.equal(h.modals.at(-1).title,'Actualización incompleta');

 const automatic=registration('pos',worker());
 h=harness([automatic]);
 await h.api.handlePwaCheck();
 const activated=automatic.waiting;
 automatic.active=activated;
 automatic.waiting=null;
 activated.postMessage();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(JSON.parse(h.data.get(h.api.PWA_KEYS.automatic)).id,'pos');
 h=harness([automatic,registration('pedidos',worker())]);
 h.data.set(h.api.PWA_KEYS.automatic,JSON.stringify({id:'pos',at:'2026-11-06T18:00:00Z',recorded:true}));
 h.data.set(h.api.PWA_KEYS.notice,JSON.stringify({kind:'automatic',at:'2026-11-06T18:00:00Z'}));
 await h.api.handlePwaCheck();
 assert.match(h.modals.at(-1).bodyHtml,/activó una actualización automáticamente en POS/);
 assert.match(h.modals.at(-1).bodyHtml,/Hay actualizaciones listas/);
 assert.equal(h.applyButton.disabled,false);

 h=harness([registration('pos')]);
 h.data.set(h.api.PWA_KEYS.lastUpdate,'histórico');
 h.api.pwaRuntime.lastResults=[{id:'pos',label:'POS',status:'available',error:''}];
 await h.api.handlePwaCheck();
 assert.match(h.modals.at(-1).bodyHtml,/No se pudo confirmar su activación/);
 assert.equal(h.data.get(h.api.PWA_KEYS.lastUpdate),'histórico');

 const offline=registration('pos');
 offline.update=async()=>{throw new Error('sin conexión');};
 h=harness([offline]);
 await h.api.handlePwaCheck();
 assert.equal(h.data.get(h.api.PWA_KEYS.status),h.api.PWA_STATUS.partialSearch);
 assert.equal(h.applyButton.disabled,true);
 assert(h.items.some(row=>row.includes('sin conexión')));
 console.log('PASS: búsqueda local, instalación del candidato encontrado y avisos de activación.');
})().catch(error=>{console.error(error);process.exitCode=1;});
