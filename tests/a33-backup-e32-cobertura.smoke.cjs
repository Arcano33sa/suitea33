'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../configuracion/script.js'),'utf8');
const instrumented=source.replace(/\}\)\(\);\s*$/,`window.__backupTest={CUSTOM_EXPORT_MODULES,getCustomDependencyWarnings,buildFullBackup,buildCustomBackup,validateBackupStructure,safeListIndexedDBDatabases,getSuiteLocalStorageSnapshot,snapshotDatabase,handleExport,
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
 const f=fixture();
 const finSource=fs.readFileSync(path.join(__dirname,'../finanzas/script.js'),'utf8');
 const stores=[...finSource.matchAll(/createObjectStore\('([^']+)'/g)].map(m=>m[1]);
 const finStores=[...new Set(stores)];
 f.api.setSnapshot(async name=>({name,version:10,stores:Object.fromEntries((name==='finanzasDB'?finStores:['meta','events','products']).map(store=>[store,{count:1,records:[{id:1,marker:store}],schema:{keyPath:'id',indices:[]}}]))}));
 for(const key of ['arcano33_produccion_checklists','arcano33_temporal_produccion_checklists_v1','a33_fin_accounts_usage_cache_v1','a33_pedidos_draft_v1','arcano33_inventario'])f.values.set(key,JSON.stringify({marker:key}));
 const before=JSON.stringify([...f.values]);
 const fin=f.api.CUSTOM_EXPORT_MODULES.find(m=>m.id==='finanzas');
 const all=await f.api.buildCustomBackup({finanzas:Array.from(fin.parts,p=>p.id)});
 assert.deepEqual(Object.keys(all.backup.data.indexedDB.finanzasDB).sort(),finStores.sort());
 assert.equal(all.backup.meta.schemaVersion,7);assert.equal(all.backup.meta.backupType,'partial');assert.equal(f.api.validateBackupStructure(all.backup).ok,true);
 assert.equal(all.backup.data.localStorage.a33_fin_accounts_usage_cache_v1,f.values.get('a33_fin_accounts_usage_cache_v1'));
 const selected=await f.api.buildCustomBackup({finanzas:['cuentasPorPagar'],inventario:['calculadoraProduccion'],agenda:['pedidos','agenda']});
 assert.deepEqual(Object.keys(selected.backup.data.indexedDB.finanzasDB),['payableItems']);
 assert.equal(selected.backup.data.localStorage.arcano33_produccion_checklists,f.values.get('arcano33_produccion_checklists'));
 assert.equal(selected.backup.data.localStorage.a33_pedidos_draft_v1,f.values.get('a33_pedidos_draft_v1'));
 assert(!('arcano33_lotes' in selected.backup.data.localStorage));assert(!('arcano33_inventario' in selected.backup.data.localStorage));
 const warnings=Array.from(selected.backup.meta.dependencyWarnings).join(' ');assert.match(warnings,/Materia Prima/);assert.match(warnings,/Proveedores/);assert.match(warnings,/cuentas contables/);assert.match(warnings,/listas históricas/);
 assert(!f.api.getCustomDependencyWarnings({agenda:['agenda'],catalogos:['materiaPrima']}).some(w=>w.includes('Materia Prima')));
 assert(!f.api.getCustomDependencyWarnings({finanzas:['cuentasPorPagar','proveedores','bancosCuentas']}).some(w=>w.includes('Conviene incluir')));
 const banks=await f.api.buildCustomBackup({finanzas:['bancosCuentas']});assert.deepEqual(Object.keys(banks.backup.data.indexedDB.finanzasDB).sort(),['accounts','financialAccounts']);
 const movements=await f.api.buildCustomBackup({finanzas:['movimientosFinancieros']});assert.deepEqual(Object.keys(movements.backup.data.indexedDB.finanzasDB).sort(),['internalTransfers','journalEntries','journalLines']);
 const pos=await f.api.buildCustomBackup({pos:['preferenciasPos']});assert.deepEqual(Object.keys(pos.backup.data.indexedDB['a33-pos']),['meta']);
 const temp=await f.api.buildCustomBackup({inventario:['calculadoraTemporal']});assert.equal(temp.backup.data.localStorage.arcano33_temporal_produccion_checklists_v1,f.values.get('arcano33_temporal_produccion_checklists_v1'));
 const inv=await f.api.buildCustomBackup({inventario:['envasesDisponibles']});assert.equal(inv.backup.data.localStorage.arcano33_inventario,f.values.get('arcano33_inventario'));assert(inv.backup.meta.dependencyWarnings.some(w=>w.includes('único registro')));
 const lots=await f.api.buildCustomBackup({lotes:['lotes']});assert.equal(lots.backup.data.localStorage.arcano33_lotes,f.values.get('arcano33_lotes'));
 assert.equal(JSON.stringify([...f.values]),before);
 console.log('PASS E3.2: todos los stores vigentes de Finanzas, selección parcial estricta, listas, borrador, preferencias, avisos y formato histórico sin escrituras.');
})().catch(e=>{console.error(e);process.exitCode=1;});
