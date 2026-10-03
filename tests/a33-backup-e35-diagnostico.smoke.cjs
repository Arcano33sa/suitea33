'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../configuracion/script.js'),'utf8');
const instrumented=source.replace(/\}\)\(\);\s*$/,`window.__backupTest={diagnoseStorage,diagnoseStorageDatabase,storageDiagnosticHtml,buildFullBackup,buildCustomBackup,validateBackupStructure,safeListIndexedDBDatabases,getSuiteLocalStorageSnapshot,snapshotDatabase,handleExport,
setDiagnoseDB:fn=>{diagnoseStorageDatabase=fn;},setSnapshot:fn=>{snapshotDatabase=fn;},setOpen:fn=>{openExistingDB=fn;},setModal:fn=>{showModal=fn;}};})();`);
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
 const f=fixture();let reads=0;f.window.navigator={storage:{estimate:async()=>({usage:100,quota:1000}),persisted:async()=>false,persist(){throw Error('No autorizado');}}};
 f.api.setDiagnoseDB(async name=>{reads++;return {name,version:10,stores:[{name:'records',status:'ok',count:2}]};});
 const before=JSON.stringify([...f.values]);const report=await f.api.diagnoseStorage();assert.equal(report.localStorage.status,'ok');assert.equal(report.localStorage.keys,2);assert.equal(report.indexedDB.status,'ok');assert.equal(reads,2);assert.equal(report.capacity.quota,1000);assert.equal(report.persistence.persisted,false);assert.equal(JSON.stringify([...f.values]),before);assert(!JSON.stringify(report).includes('A330xX119TEV5786'));
 assert.match(f.api.storageDiagnosticHtml(report),/sitio completo/);
 f.api.setDiagnoseDB(async name=>{if(name==='a33-pos')throw Error('bloqueada');return {name,stores:[{name:'records',status:'error',message:'fallo count'}]};});const bad=await f.api.diagnoseStorage();assert.equal(bad.indexedDB.status,'error');assert.equal(bad.indexedDB.databases.length,2);
 f.indexedDB.databases=async()=>[];assert.equal((await f.api.diagnoseStorage()).indexedDB.databases.length,0);
 delete f.indexedDB.databases;delete f.window.navigator.storage.estimate;delete f.window.navigator.storage.persisted;const unsupported=await f.api.diagnoseStorage();assert.equal(unsupported.indexedDB.status,'unavailable');assert.equal(unsupported.capacity.status,'unavailable');assert.equal(unsupported.persistence.status,'unavailable');
 f.window.navigator.storage.estimate=async()=>({usage:-1,quota:100});f.window.navigator.storage.persisted=async()=>{throw Error('permiso denegado');};const invalid=await f.api.diagnoseStorage();assert.equal(invalid.capacity.status,'error');assert.equal(invalid.persistence.status,'error');
 f.storage.getItem=()=>{throw Error('SecurityError');};assert.equal((await f.api.diagnoseStorage()).localStorage.status,'error');
 // Native read-only count path; no upgrade, put, clear, deleteDatabase or persist call.
 const native=fixture();let closed=0;const modes=[];
 native.indexedDB.open=()=>{const req={};setTimeout(()=>{req.result={version:3,objectStoreNames:['rows'],transaction(name,mode){modes.push(mode);const tx={objectStore:()=>({count(){const count={};setTimeout(()=>{count.result=3;count.onsuccess();tx.oncomplete();},0);return count;}})};return tx;},close(){closed++;}};req.onsuccess();},0);return req;};
 const count=await native.api.diagnoseStorageDatabase('a33-pos');assert.equal(count.stores[0].count,3);assert.deepEqual(modes,['readonly']);assert.equal(closed,1);
 console.log('PASS E3.5: diagnóstico solo lectura, conteos nativos, disponibilidad/error/no comprobable, filtros de Suite y ausencia de valores privados.');
})().catch(e=>{console.error(e);process.exitCode=1;});
