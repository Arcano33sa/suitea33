'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const modules=['pos','inventario','lotes','pedidos','catalogos','calculadora','agenda','centro-mando','calculadora_temporal'];
async function install(module,active,fail=false){
 const handlers={};let skipped=0;
 const context=vm.createContext({importScripts(){},self:{A33_RELEASE:{suiteVersion:'4.20.98',rev:5},registration:{active:active?{}:null},addEventListener:(t,f)=>handlers[t]=f,async skipWaiting(){skipped++;}},caches:{async open(){return {async addAll(){if(fail)throw new Error('precache fallido');}};}}});
 vm.runInContext(fs.readFileSync(path.join(root,module,'sw.js'),'utf8'),context);let task;
 handlers.install({waitUntil(p){task=p;}});
 if(fail)await assert.rejects(task,/precache fallido/);else await task;
 assert.equal(skipped,!active&&!fail?1:0,`${module}: política de instalación`);
 if(!fail){handlers.message({data:{type:'NO_APLICAR'},waitUntil(p){task=p;}});assert.equal(skipped,active?0:1);handlers.message({data:{type:'SKIP_WAITING'},waitUntil(p){task=p;}});await task;assert.equal(skipped,active?1:2);}
}
const source=fs.readFileSync(path.join(root,'configuracion/script.js'),'utf8');
const apply=source.slice(source.indexOf('  async function handlePwaApply(){'),source.indexOf('  function initPwaSection(){'));
const check=source.slice(source.indexOf('  async function handlePwaCheck(){'),source.indexOf('  async function handlePwaApply(){'));
async function configSmoke(){
 let confirmed=false,asked=0,applied=0,checked=0,reloaded=0;const writes=[];
 const context=vm.createContext({window:{confirm(text){asked++;assert.match(text,/guarda el trabajo/);assert.match(text,/no comprueba automáticamente/);return confirmed;},A33Notice:{show(){}}},pwaRuntime:{checking:false,applying:false},PWA_KEYS:{},PWA_STATUS:{},savePwaReport(){},showToast(){},pwaStorageSet:(...a)=>writes.push(a),renderPwaSection(){},formatPwaDateForStorage(){return 'fecha';},Date,async checkSuitePwaUpdates(){checked++;return {available:true,checked:9,incomplete:false,results:[]};},async applySuitePwaUpdate(){applied++;return {applied:true};},reloadAfterPwaApply(){reloaded++;}});
 vm.runInContext(check+apply,context);
 await context.handlePwaCheck();assert.equal(checked,1);assert.equal(applied,0);assert.equal(asked,0);assert.equal(reloaded,0);
 writes.length=0;await context.handlePwaApply();assert.equal(asked,1);assert.equal(applied,0);assert.equal(reloaded,0);assert.equal(writes.length,0);assert.equal(context.pwaRuntime.applying,false);
 confirmed=true;await context.handlePwaApply();assert.equal(applied,1);assert.equal(reloaded,0);
 context.pwaRuntime.applying=true;await context.handlePwaApply();assert.equal(applied,1);assert.equal(asked,2);
 console.log('PASS: buscar no aplica; cancelar no altera estado ni recarga; confirmar aplica; doble ejecución bloqueada.');
}
(async()=>{for(const m of modules){await install(m,false);await install(m,true);await install(m,true,true);console.log('PASS: '+m+', primera instalación, espera, fallo de precache y activación explícita.');}await configSmoke();})().catch(e=>{console.error(e);process.exitCode=1;});
