'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../configuracion/script.js'),'utf8');
const instrumented=source.replace(/\}\)\(\);\s*$/,`window.__backupTest={performImport,performFullImport,performPartialImport,QUICK_ORDERS_BACKUP_KEY,buildFullBackup,buildCustomBackup,validateBackupStructure,safeListIndexedDBDatabases,getSuiteLocalStorageSnapshot,snapshotDatabase,handleExport,
setRestore:fn=>{restoreDatabase=fn;},setMerge:fn=>{mergeDatabase=fn;},setSnapshot:fn=>{snapshotDatabase=fn;},setOpen:fn=>{openExistingDB=fn;},setModal:fn=>{showModal=fn;}};})();`);
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
 const f=fixture(),writes=[],restores=[],merges=[];
 f.window.A33Storage={setItem:(k,v)=>{writes.push(k);f.values.set(k,v);return true;},getItem:k=>f.values.get(k)??null};
 f.api.setRestore(async(name,stores)=>restores.push([name,Object.keys(stores)]));f.api.setMerge(async(name,stores)=>{merges.push([name,Object.keys(stores)]);return {};});
 const valid=()=>({meta:{app:'Suite A33',backupType:'full'},data:{indexedDB:{'a33-pos':{events:[{id:1,name:'histórico'}]}},localStorage:{arcano33_lotes:'[{"codigo":"A330xX119TEV5786"}]'}}});
 // Use actual exported app identification, avoiding guessed historical app spelling.
 const exported=await f.api.buildFullBackup();const make=()=>{const obj=valid();obj.meta.app=exported.backup.meta.appName;return obj;};
 const mutations=[o=>o.data.indexedDB=[],o=>o.data.localStorage=[],o=>o.meta=[],o=>o.data.indexedDB['a33-pos']=[],o=>o.data.indexedDB['a33-pos'].events={},o=>o.data.indexedDB['a33-pos'].events=[null],o=>o.data.indexedDB['a33-pos'].events=[[]],o=>o.meta.dbVersions={'a33-pos':0},o=>o.meta.dbVersions={'a33-pos':true},o=>o.meta.dbSchemas={'a33-pos':{events:[]}},o=>o.meta.dbSchemas={'a33-pos':{events:{indices:{}}}},o=>o.data.localStorage.arcano33_lotes=null,o=>o.data.localStorage[f.api.QUICK_ORDERS_BACKUP_KEY]='{bad json',o=>o.data.localStorage[f.api.QUICK_ORDERS_BACKUP_KEY]='[null]'];
 for(const mutate of mutations){const obj=make();mutate(obj);assert.equal(f.api.validateBackupStructure(obj).ok,false);for(const method of ['performImport','performFullImport','performPartialImport'])await assert.rejects(f.api[method](obj));}
 assert.equal(writes.length,0);assert.equal(restores.length,0);assert.equal(merges.length,0);
 // A historical full file without schemas, versions, products or rawMaterials is valid.
 const historical=make();assert.equal(f.api.validateBackupStructure(historical).ok,true);
 let opened=0;f.api.setOpen(async()=>{opened++;throw Error('no debe abrir Materia Prima');});
 const prior=f.values.get('a33_test');const result=await f.api.performFullImport(historical);
 assert.equal(result.rawMaterialsDefaulted,false);assert.equal(opened,0);assert.deepEqual(restores,[['a33-pos',['events']]]);assert.equal(f.values.get('a33_test'),prior);assert.equal(f.values.get('arcano33_lotes'),historical.data.localStorage.arcano33_lotes);
 const empty=make();empty.data.indexedDB['a33-pos']={rawMaterials:[]};empty.data.localStorage={};await f.api.performFullImport(empty);assert.deepEqual(restores.at(-1),['a33-pos',['rawMaterials']]);
 const partial=make();partial.meta.backupType='partial';partial.data.localStorage={};await f.api.performPartialImport(partial);assert.deepEqual(merges.at(-1),['a33-pos',['events']]);
 assert.equal(opened,0);console.log('PASS E3.3: estructuras malformadas bloqueadas antes de escrituras; históricos sin esquema, bloques ausentes y vacíos explícitos diferenciados; Materia Prima ausente conservada.');
})().catch(e=>{console.error(e);process.exitCode=1;});
