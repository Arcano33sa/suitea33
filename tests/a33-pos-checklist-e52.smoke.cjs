'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../pos/app.js'),'utf8');
const block=src.slice(src.indexOf('function _getChecklistDraftStorePOS('),src.indexOf('function bindChecklistLifecycleFlushPOS('));
function fixture(){
 const records=new Map([1,2].map(id=>[id,{id,name:'Evento '+id,checklistTemplate:{pre:[{id:'a',text:'Inicial'}],evento:[],cierre:[]},other:'conservar'}]));
 const transactions=[],notices=[],timers=new Map();let timer=0;
 const db={transaction(names,mode){assert.equal(mode,'readwrite');assert.equal(names[0],'events');
  const tr={objectStore(){return {get(id){tr.id=id;return tr.req={};},put(ev){tr.pending=structuredClone(ev);return {};}};},abort(){tr.onabort();}};
  transactions.push(tr);return tr;}};
 const ctx=vm.createContext({window:{},db,console:{error(){}},setTimeout(fn){timers.set(++timer,fn);return timer;},clearTimeout(id){timers.delete(id);},
  showToast:(...args)=>notices.push(args),safeYMD:x=>x,getSaleDayKeyPOS:()=> '2026-10-03',normalizeChecklistTemplatePOS:template=>template});
 vm.runInContext(block,ctx);
 function queue(event,raw){ctx._getChecklistDraftStorePOS().eventId=event;ctx.queueChecklistTextSavePOS('pre','a',raw,{force:true});}
 function read(tr){tr.req.result=structuredClone(records.get(tr.id));tr.req.onsuccess();}
 function complete(tr){if(tr.pending)records.set(tr.id,tr.pending);tr.oncomplete();}
 return {ctx,records,transactions,notices,timers,queue,read,complete,d:ctx._getChecklistDraftStorePOS()};
}
(async()=>{
 let count=0;
 // A successful request is not enough: abort keeps both text and lastSaved intact.
 {
  const f=fixture();f.queue(1,'Pendiente');let settled=false;
  const p=f.ctx.flushChecklistTextQueuePOS().then(r=>{settled=true;return r;});
  const tr=f.transactions[0];f.read(tr);await Promise.resolve();assert.equal(settled,false);assert.equal(Object.keys(f.d.q).length,1);
  tr.onabort();assert.equal(await p,false);assert.equal(Object.keys(f.d.q).length,1);assert.equal(Object.keys(f.d.lastSaved).length,0);
  assert.equal(f.records.get(1).checklistTemplate.pre[0].text,'Inicial');assert.match(f.notices[0][0],/siguen pendientes/);
  const retry=f.ctx.flushChecklistTextQueuePOS();const tr2=f.transactions[1];f.read(tr2);f.complete(tr2);
  assert.equal(await retry,true);assert.equal(Object.keys(f.d.q).length,0);assert.equal(f.d.lastSaved['1|pre::a'],'Pendiente');count++;
 }
 // Edits typed while saving are not acknowledged as the older snapshot.
 {
  const f=fixture();f.queue(1,'Primero');const p=f.ctx.flushChecklistTextQueuePOS();const tr=f.transactions[0];f.read(tr);
  f.queue(1,'Segundo');assert.equal(await f.ctx.flushChecklistTextQueuePOS(),false);assert.equal(f.transactions.length,1);
  f.complete(tr);assert.equal(await p,false);assert.equal(f.d.q['1|pre::a'].raw,'Segundo');
  const p2=f.ctx.flushChecklistTextQueuePOS();const tr2=f.transactions[1];f.read(tr2);f.complete(tr2);assert.equal(await p2,true);
  assert.equal(f.records.get(1).checklistTemplate.pre[0].text,'Segundo');count++;
 }
 // Switching events cannot transfer a failed queue to the new event.
 {
  const f=fixture();f.queue(1,'Uno');let p=f.ctx.flushChecklistTextQueuePOS();f.read(f.transactions[0]);f.transactions[0].onerror();await p;
  f.queue(2,'Dos');p=f.ctx.flushChecklistTextQueuePOS();f.records.get(1).other='Cambio reciente';f.read(f.transactions[1]);f.complete(f.transactions[1]);
  await Promise.resolve();f.read(f.transactions[2]);f.complete(f.transactions[2]);assert.equal(await p,true);
  assert.equal(f.records.get(1).checklistTemplate.pre[0].text,'Uno');assert.equal(f.records.get(2).checklistTemplate.pre[0].text,'Dos');
  assert.equal(f.records.get(1).other,'Cambio reciente');count++;
 }
 for(const mode of ['missingEvent','missingItem','noEvent','openError','readError']){
  const f=fixture();f.queue(mode==='noEvent'?null:1,'Conservar');
  if(mode==='openError')f.ctx.db.transaction=()=>{throw Error('blocked');};
  if(mode==='missingEvent')f.records.delete(1);
  if(mode==='missingItem')f.records.get(1).checklistTemplate.pre=[];
  const p=f.ctx.flushChecklistTextQueuePOS();
  if(mode==='missingEvent'||mode==='missingItem')f.read(f.transactions[0]);
  if(mode==='readError')f.transactions[0].onerror();
  assert.equal(await p,false);assert.equal(Object.keys(f.d.q).length,1);assert.equal(Object.keys(f.d.lastSaved).length,0);count++;
 }
 // Existing normalization and no-op writes also wait for transaction completion.
 for(const raw of ['Inicial','  Nuevo  ','']){
  const f=fixture();f.queue(1,raw);const p=f.ctx.flushChecklistTextQueuePOS();const tr=f.transactions[0];f.read(tr);f.complete(tr);
  assert.equal(await p,true);assert.equal(f.records.get(1).checklistTemplate.pre[0].text,raw.trim()||'Inicial');count++;
 }
 assert(src.includes('text:pending.raw'),'El render debe conservar el texto pendiente');
 console.log(`PASS E5.2: ${count} escenarios de transacción, fallo, reintento, edición durante guardado y asociación por evento`);
})().catch(err=>{console.error(err);process.exitCode=1;});
