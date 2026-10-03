'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../configuracion/script.js'),'utf8');
const instrumented=source.replace(/\}\)\(\);\s*$/,`window.__backupTest={restoreDatabase,mergeDatabase,mergeLocalStorageValue,performFullImport,performPartialImport,buildFullBackup,buildCustomBackup,validateBackupStructure,safeListIndexedDBDatabases,getSuiteLocalStorageSnapshot,snapshotDatabase,handleExport,
setMergeOpen:fn=>{openDBForPartialMerge=fn;},setSnapshot:fn=>{snapshotDatabase=fn;},setOpen:fn=>{openExistingDB=fn;},setModal:fn=>{showModal=fn;}};})();`);
assert.notEqual(instrumented,source);
function fixture(){
 const values=new Map([['arcano33_lotes',JSON.stringify([{id:'historical',codigo:'A330xX119TEV5786'}])],['a33_test','texto original'],['unrelated','privado'],['','clave ajena válida']]);
 const storage={get length(){return values.size;},key:i=>Array.from(values.keys())[i]??null,getItem:k=>values.get(k)??null};
 const document={addEventListener(){}};
 const window={localStorage:storage,document,A33Notice:{show(){},finish(){}}};
 const indexedDB={databases:async()=>[{name:'a33-pos'},{name:'finanzasDB'},{name:'foreign'}]};
 const context=vm.createContext({window,document,indexedDB,console,Blob,URL,URLSearchParams,setTimeout,clearTimeout});
 vm.runInContext(instrumented,context);const api=window.__backupTest;
 const snap={name:'a33-pos',version:7,stores:{sales:{count:1,records:[{id:1,total:100}],schema:{keyPath:'id',autoIncrement:true,indices:[]}}}};
 api.setSnapshot(async name=>({...snap,name}));
 return {api,window,indexedDB,storage,values};
}
(async()=>{
 const f=fixture();f.window.A33Storage={setItem:()=>false};
 assert.equal(f.api.mergeLocalStorageValue('a33_test','nuevo'),false);
 const obj=(await f.api.buildFullBackup()).backup;obj.data.indexedDB={};obj.data.localStorage={a33_test:'nuevo'};
 await assert.rejects(f.api.performFullImport(obj),/localStorage.*a33_test/);await assert.rejects(f.api.performPartialImport(obj),/localStorage.*a33_test/);
 f.window.A33Storage.setItem=()=>true;assert.equal(f.api.mergeLocalStorageValue('a33_test','nuevo'),false); // falsely claimed write, readback differs.
 let written=0;f.window.A33Storage.setItem=(k,v)=>{written++;f.values.set(k,v);return true;};
 assert.equal(f.api.mergeLocalStorageValue('a33_test','nuevo'),true);assert.equal(written,1);
 f.storage.getItem=()=>{throw Error('lectura fallida');};assert.throws(()=>f.api.mergeLocalStorageValue('a33_test','otro'),/localStorage.*a33_test/);assert.equal(written,1);
 for(const method of ['restoreDatabase','mergeDatabase'])for(const failure of [false,'put','clear','async','missing','identity']){
  if(method==='mergeDatabase'&&failure==='clear')continue;
  const fixtureData=fixture();let closed=0,aborted=0;
  const store={keyPath:'id',autoIncrement:false,clear(){if(failure==='clear')throw Error('clear falló');},put(){if(failure==='put')throw Error('put falló');return {};}};
  const db={objectStoreNames:{contains:()=>failure!=='missing'},transaction(name,mode){let txAborted=false;const tx={objectStore:()=>store,abort(){txAborted=true;if(mode==='readwrite')aborted++;tx.onabort?.();}};if(mode==='readwrite')setTimeout(()=>{if(failure==='async'){tx.error=Error('fallo asíncrono');tx.onabort();}else if(!txAborted)tx.oncomplete?.();},0);return tx;},close(){closed++;}};
  fixtureData.api.setMergeOpen(async()=>db);
  const payload={events:[failure==='identity'?{name:'sin id'}:{id:1}]};
  const fails=failure&&!(method==='restoreDatabase'&&failure==='identity');
  if(fails)await assert.rejects(fixtureData.api[method]('a33-pos',payload,{},{}),/events/);else await fixtureData.api[method]('a33-pos',payload,{},{});
  assert.equal(closed,1);if(failure==='put'||failure==='clear'||failure==='identity'&&method==='mergeDatabase')assert.equal(aborted,1);
 }
 console.log('PASS E3.4: escrituras rechazadas y falsas, lectura fallida, clear/put síncronos, abort asíncrono, stores ausentes e identidad inválida detenidos; conexiones cerradas.');
})().catch(e=>{console.error(e);process.exitCode=1;});
