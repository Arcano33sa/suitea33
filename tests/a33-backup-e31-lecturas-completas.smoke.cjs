'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../configuracion/script.js'),'utf8');
const instrumented=source.replace(/\}\)\(\);\s*$/,`window.__backupTest={buildFullBackup,buildCustomBackup,validateBackupStructure,safeListIndexedDBDatabases,getSuiteLocalStorageSnapshot,snapshotDatabase,handleExport,
setSnapshot:fn=>{snapshotDatabase=fn;},setOpen:fn=>{openExistingDB=fn;},setModal:fn=>{showModal=fn;}};})();`);
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
 const f=fixture(),before=JSON.stringify([...f.values]);
 const ok=await f.api.buildFullBackup();
 assert.equal(ok.backup.meta.backupType,'full');assert.equal(ok.backup.meta.schemaVersion,8);
 assert.equal(f.api.validateBackupStructure(ok.backup).ok,true);
 assert.equal(ok.backup.data.indexedDB['a33-pos'].sales[0].total,100);
 assert.equal(ok.backup.data.localStorage.arcano33_lotes,f.values.get('arcano33_lotes'));
 assert(!('unrelated' in ok.backup.data.localStorage));assert.equal(JSON.stringify([...f.values]),before);
 const partial=await f.api.buildCustomBackup({lotes:['lotes']});
 assert.equal(partial.backup.meta.backupType,'partial');assert.equal(f.api.validateBackupStructure(partial.backup).ok,true);
 assert.equal(partial.backup.data.localStorage.arcano33_lotes,f.values.get('arcano33_lotes'));
 assert.equal(JSON.stringify([...f.values]),before);
 f.api.setSnapshot(async name=>{throw Error('bloqueada '+name);});
 await assert.rejects(f.api.buildFullBackup(),e=>e.code==='A33_BACKUP_READ_INCOMPLETE'&&e.readFailures.length===2&&e.message.includes('finanzasDB'));
 const modals=[];f.api.setModal(o=>modals.push(o));await f.api.handleExport();
 assert.equal(modals.at(-1).title,'Error');assert(!modals.some(m=>m.primaryText==='Descargar respaldo'));
 await assert.rejects(f.api.buildCustomBackup({configuracion:['general']}),/lecturas incompletas/);
 const badList=fixture();badList.indexedDB.databases=async()=>{throw Error('SecurityError');};
 await assert.rejects(badList.api.buildFullBackup(),/lista de bases.*SecurityError/);
 badList.indexedDB.databases=async()=>({invalid:true});await assert.rejects(badList.api.buildFullBackup(),/lista recibida no es válida/);
 delete badList.indexedDB.databases;await assert.rejects(badList.api.buildFullBackup(),/no permite enumerar/);
 const empty=fixture();empty.indexedDB.databases=async()=>[];empty.values.clear();
 assert.equal(Object.keys((await empty.api.buildFullBackup()).backup.data.indexedDB).length,0);
 const badLocal=fixture();badLocal.storage.getItem=k=>{if(k==='a33_test')throw Error('lectura denegada');return badLocal.values.get(k)??null;};
 await assert.rejects(badLocal.api.buildFullBackup(),/localStorage \/ a33_test/);
 badLocal.storage.getItem=()=>null;assert.throws(()=>badLocal.api.getSuiteLocalStorageSnapshot(),/dejó de estar disponible/);
 const blocked=fixture();Object.defineProperty(blocked.window,'localStorage',{get(){throw Error('SecurityError');}});
 await assert.rejects(blocked.api.buildFullBackup(),/localStorage: no se pudo consultar/);
 // Lectura real de snapshot: transacción confirmada y conexión cerrada incluso con error.
 for(const failure of [false,'request','transaction']){
  const f=fixture();let closed=0;
  const store={keyPath:'id',autoIncrement:true,indexNames:[],getAll(){const req={};setTimeout(()=>{if(failure==='request'){req.error=Error('lectura fallida');req.onerror();tx.error=req.error;tx.onabort();}else{req.result=[{id:1}];req.onsuccess();if(failure==='transaction'){tx.error=Error('transacción abortada');tx.onabort();}else tx.oncomplete();}},0);return req;}};
  const tx={objectStore:()=>store};const db={version:1,objectStoreNames:['rows'],transaction:()=>tx,close(){closed++;}};
  f.api.setOpen(async()=>db);
  if(failure)await assert.rejects(f.api.snapshotDatabase('a33-test'),/a33-test \/ rows/);
  else assert.equal((await f.api.snapshotDatabase('a33-test')).stores.rows.count,1);
  assert.equal(closed,1);
 }
 const badSchema=fixture();let schemaClosed=0;
 badSchema.api.setOpen(async()=>({version:1,objectStoreNames:['rows'],transaction:()=>({objectStore:()=>({keyPath:'id',indexNames:['bad'],index(){throw Error('esquema inaccesible');}})}),close(){schemaClosed++;}}));
 await assert.rejects(badSchema.api.snapshotDatabase('a33-test'),/a33-test \/ rows: no se pudo leer el esquema/);assert.equal(schemaClosed,1);
 console.log('PASS E3.1: formato histórico, lecturas completas, ausencia real, fallos DB/listado/localStorage, bloqueo completo/personalizado, transacciones y cierre; sin escrituras de datos.');
})().catch(e=>{console.error(e);process.exitCode=1;});
