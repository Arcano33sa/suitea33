'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../configuracion/script.js'),'utf8');
const instrumented=source.replace(/\}\)\(\);\s*$/,`window.__backupTest={LAST_EXPORT_KEY,backupExportAge,downloadBackup,renderLastBackupExport,sanitizeBackupObject,buildFullBackup,buildCustomBackup,validateBackupStructure,safeListIndexedDBDatabases,getSuiteLocalStorageSnapshot,snapshotDatabase,handleExport,
setDownload:fn=>{downloadTextFile=fn;},setSnapshot:fn=>{snapshotDatabase=fn;},setOpen:fn=>{openExistingDB=fn;},setModal:fn=>{showModal=fn;}};})();`);
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
 const f=fixture(),node={innerHTML:'',textContent:''};f.window.document.getElementById=()=>node;
 f.window.A33Storage={setItem:(k,v)=>{f.values.set(k,v);return true;}};
 f.api.renderLastBackupExport();assert.match(node.textContent,/Sin descargas registradas/);
 const now=Date.now();assert.match(f.api.backupExportAge(new Date(now-2*86400000).toISOString(),now),/2 día/);assert.match(f.api.backupExportAge(new Date(now+60000).toISOString(),now),/Fecha futura/);assert.equal(f.api.backupExportAge('bad',now),'No disponible');
 const before=JSON.stringify([...f.values]);await f.api.buildFullBackup();assert.equal(JSON.stringify([...f.values]),before);
 let downloads=0;f.api.setDownload(()=>{downloads++;});const prepared='2026-09-30T12:00:00.000Z';
 for(const type of ['full','partial','recovery']){f.api.downloadBackup('copia.json','{}',type,prepared);const record=JSON.parse(f.values.get(f.api.LAST_EXPORT_KEY));assert.equal(record.type,type);assert.equal(record.preparedAt,prepared);assert.equal(record.filename,'copia.json');assert.match(node.innerHTML,/Solicitud de descarga/);}
 assert.equal(downloads,3);const record=f.values.get(f.api.LAST_EXPORT_KEY);
 f.api.setDownload(()=>{throw Error('no se solicitó descarga');});assert.throws(()=>f.api.downloadBackup('otra','{}','full',prepared));assert.equal(f.values.get(f.api.LAST_EXPORT_KEY),record);
 const exported=(await f.api.buildFullBackup()).backup;assert(!Object.hasOwn(exported.data.localStorage,f.api.LAST_EXPORT_KEY));
 exported.data.localStorage[f.api.LAST_EXPORT_KEY]=record;assert(!Object.hasOwn(f.api.sanitizeBackupObject(exported).data.localStorage,f.api.LAST_EXPORT_KEY));
 f.api.setDownload(()=>{});f.window.A33Storage.setItem=()=>false;f.api.downloadBackup('sesion.json','{}','partial',prepared);assert.match(node.innerHTML,/Solo estará disponible durante esta sesión/);assert.equal(f.values.get(f.api.LAST_EXPORT_KEY),record);
 const corrupt=fixture();corrupt.window.document.getElementById=()=>node;corrupt.values.set(corrupt.api.LAST_EXPORT_KEY,'{');corrupt.api.renderLastBackupExport();assert.match(node.textContent,/no comprobable/);
 console.log('PASS E3.6: fecha y tipo solo tras descarga, edad del contenido, cancelación/preparación sin registro, error persistencia, formatos full/partial/recovery y seguimiento no transferible.');
})().catch(e=>{console.error(e);process.exitCode=1;});
