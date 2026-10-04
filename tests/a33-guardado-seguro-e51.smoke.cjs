'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const quiet = {warn(){}, info(){}, error(){}, log(){}};
const key = 'arcano33_pedidos';
let checks = 0;
function host(failKey){
  const data = new Map();
  const store = {getItem:k=>data.get(k) ?? null, setItem(k,v){if(k===failKey) throw Error('quota');data.set(k,String(v));}, removeItem:k=>data.delete(k), key:i=>[...data.keys()][i] ?? null, get length(){return data.size;}};
  const window = {localStorage:store, sessionStorage:store, __A33_LEGACY_ACCESS_PURGE_PROMISE:Promise.resolve()};
  const ctx = vm.createContext({window, console:quiet, Date, localStorage:store, sessionStorage:store});
  vm.runInContext(read('assets/js/a33-storage.js'),ctx);
  return {api:window.A33Storage,data};
}
for(const method of ['sharedSet','sharedReplaceExact']){
  for(const failure of ['none','data','meta']){
    const {api,data} = host(failure==='data'?key:failure==='meta'?key+'__meta':null);
    api.sharedRead(key,[]);
    const result = api[method](key,[{id:'e51',codigo:'historico'}],{source:'test',baseRev:0});
    assert.equal(result.ok,failure==='none');
    assert.equal(data.has(key),failure!=='data');
    assert.equal(data.has(key+'__meta'),failure==='none');
    if(failure==='meta'){
      assert.equal(result.dataWritten,true);
      assert.equal(result.revisionWritten,false);
      assert.match(result.message,/Guardado incompleto/);
      assert.equal(api._sharedState[key],undefined);
      assert.equal(JSON.parse(data.get(key))[0].codigo,'historico');
    }
    if(failure==='none') assert.equal(result.meta.rev,1);
    checks++;
  }
}
// Existing revision and merge behavior remains available.
{
  const {api,data}=host(null);
  api.sharedSet(key,[{id:'a',codigo:'A'}],{baseRev:0});
  assert.equal(api.sharedSet(key,[{id:'b',codigo:'B'}],{baseRev:0,conflictPolicy:'block'}).ok,false);
  assert.equal(api.sharedSet(key,[{id:'a',codigo:'A'},{id:'b',codigo:'B'}],{baseRev:0}).ok,true);
  assert.equal(JSON.parse(data.get(key)).length,2);
  checks++;
}
const pedidos=read('pedidos/script.js');
const saveSource=pedidos.slice(pedidos.indexOf('function savePedidos('),pedidos.indexOf('function loadArchivedPedidos()'));
for(const mode of ['success','false','throw','partial','sharedThrow']){
  let writes=0;const notices=[];
  const api={setItem(){writes++;if(mode==='throw')throw Error('quota');return mode!=='false';}};
  if(mode==='partial')api.sharedSet=()=>({ok:false,dataWritten:true,message:'Guardado incompleto'});
  if(mode==='sharedThrow')api.sharedSet=()=>{throw Error('unexpected');};
  const ctx=vm.createContext({window:{A33Storage:api},A33Storage:api,STORAGE_KEY_PEDIDOS:key,console:quiet,showArchivedNotice:msg=>notices.push(msg)});
  vm.runInContext(saveSource,ctx);
  assert.equal(ctx.savePedidos([{id:'p'}]),mode==='success');
  assert.equal(writes,['partial','sharedThrow'].includes(mode)?0:1);
  assert.equal(notices.length,mode==='success'?0:1);
  checks++;
}
const inv=read('inventario/script.js');
const metaSource=inv.slice(inv.indexOf('function writeInventarioMetaRaw('),inv.indexOf('function trackInventarioBase('));
const commitSource=inv.slice(inv.indexOf('function sharedCommitInventarioConservative('),inv.indexOf('function toFiniteNumber('));
for(const mode of ['success','false','throw']){
  let tracked=0;const writes=[];const api={_sharedState:{inv:{rev:0}},setItem(k,v){writes.push(k);if(k.endsWith('__meta')&&mode==='throw')throw Error('quota');return !k.endsWith('__meta')||mode==='success';}};
  const ctx=vm.createContext({window:{A33Storage:api},A33Storage:api,STORAGE_KEY_INVENTARIO:'inv',INV_BASE_SNAPSHOT:{qty:1},INV_BASE_REV:0,
    readInventarioShared:()=>({data:{qty:1},meta:{rev:0}}),normalizeInventarioInPlace(){},collectEdits:()=>[{qty:2}],
    applyEditsToCurrent:()=>({qty:2}),validateBeforeSave:()=>({ok:true}),readInventarioMetaRaw:()=>({rev:0}),trackInventarioBase(){tracked++;}});
  vm.runInContext(metaSource+commitSource,ctx);
  const result=ctx.sharedCommitInventarioConservative({qty:2});
  assert.equal(result.ok,mode==='success');assert.equal(tracked,mode==='success'?1:0);
  assert.deepEqual(writes,['inv','inv__meta']);
  if(mode==='success') assert.equal(api._sharedState.inv.rev,1);
  if(mode!=='success'){assert.equal(result.dataWritten,true);assert.equal(api._sharedState.inv,undefined);assert.match(result.message,/Guardado incompleto/);}
  checks++;
}
console.log(`PASS E5.1: ${checks} escenarios aislados de escritura, revisión, conflicto y guardado parcial`);
