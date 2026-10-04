'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const code=fs.readFileSync('assets/js/a33-storage.js','utf8');
const keys=['arcano33_pedidos','arcano33_pedidos_rapidos_v1','arcano33_lotes','a33_pos_customersCatalog'];let checks=0;
function hosts(){const rows=new Map(),writes=[];const store={getItem:k=>rows.get(k)??null,setItem(k,v){writes.push(k);rows.set(k,String(v));},removeItem:k=>rows.delete(k),key:i=>[...rows.keys()][i]??null,get length(){return rows.size;}};const make=()=>{const window={localStorage:store,sessionStorage:store,__A33_LEGACY_ACCESS_PURGE_PROMISE:Promise.resolve()};vm.runInNewContext(code,{window,Date,console:{warn(){},info(){}},localStorage:store,sessionStorage:store});return window.A33Storage;};return {a:make(),b:make(),rows,writes,store};}
const clone=v=>JSON.parse(JSON.stringify(v));
for(const key of keys){
 const {a,b,rows,writes}=hosts();const seed=[{id:'a',name:'Uno',codigo:'HIST-A',notas:'original',updatedAt:7},{id:'b',name:'Dos',codigo:'HIST-B',notas:'original',updatedAt:7}];rows.set(key,JSON.stringify(seed));
 const base=clone(a.sharedGet(key,[]));let other=clone(b.sharedGet(key,[]));other[0].notas='externa';assert.equal(b.sharedSet(key,other).ok,true);
 const attempt=clone(base);attempt[0].notas='local';const raw=rows.get(key),count=writes.length;const result=a.sharedSet(key,attempt);assert.equal(result.ok,false,key);assert.equal(result.conflict,true);assert.equal(rows.get(key),raw);assert.equal(writes.length,count);assert.equal(a.sharedSet(key,attempt).ok,false,'El reintento conserva su base');checks++;
 const independent=clone(base);independent[1].notas='independiente';assert.equal(a.sharedSet(key,independent).ok,true);let live=JSON.parse(rows.get(key));assert.equal(live.find(r=>r.id==='a').notas,'externa');assert.equal(live.find(r=>r.id==='b').notas,'independiente');checks++;
 // Cambios sin incremento de fecha/revisión (incluido guardado parcial de E5.1).
 const old=clone(a.sharedGet(key,[]));live=JSON.parse(rows.get(key));live[0].notas='sin revisión';rows.set(key,JSON.stringify(live));const patch=clone(old);patch[0].notas='otra local';assert.equal(a.sharedSet(key,patch).ok,false);checks++;
 // Altas independientes y una baja local: no perder la fila nueva.
 const deletion=clone(a.sharedGet(key,[]));other=clone(b.sharedGet(key,[]));other.push({id:'c',name:'Tres',codigo:'HIST-C',notas:'externa'});assert.equal(b.sharedSet(key,other).ok,true);assert.equal(a.sharedSet(key,deletion.filter(r=>r.id!=='b')).ok,true);live=JSON.parse(rows.get(key));assert(live.some(r=>r.id==='c'));assert(!live.some(r=>r.id==='b'));checks++;
 // Baja externa: ni actualizar ni recrear la fila desde una copia anterior.
 const stale=clone(a.sharedGet(key,[]));other=clone(b.sharedGet(key,[]));assert.equal(b.sharedSet(key,other.filter(r=>r.id!=='a')).ok,true);stale.find(r=>r.id==='a').notas='revivir';assert.equal(a.sharedSet(key,stale).ok,false);checks++;
 rows.set(key,JSON.stringify([{id:'dup',name:'Uno'},{id:'dup',name:'Dos'}]));const duplicateRaw=rows.get(key);assert.equal(a.sharedSet(key,[]).ok,false);assert.equal(rows.get(key),duplicateRaw);checks++;
 // Una lectura fallida o un formato ilegible no autoriza reemplazar la lista.
 for(const invalid of ['{','null','{}']){rows.set(key,invalid);const n=writes.length;assert.equal(a.sharedSet(key,[]).ok,false);assert.equal(rows.get(key),invalid);assert.equal(writes.length,n);checks++;}
}
// La intención de un editor no transforma filas históricas independientes.
{
 const {a,b,rows}=hosts();const key='arcano33_pedidos';rows.set(key,JSON.stringify([{id:'one',codigo:'HIST-1',nota:'original'},{id:'two',codigo:'HIST-2',nota:'original',unknown:{keep:true}}]));
 const base=clone(a.sharedGet(key,[]));const next=clone(base);next[0].nota='local';next[1].campoNormalizado='valor por defecto';const other=clone(b.sharedGet(key,[]));other[1].nota='externa';assert(b.sharedSet(key,other).ok);
 assert(a.sharedSet(key,next,{recordIds:['one']}).ok);const live=JSON.parse(rows.get(key));assert.equal(live[1].nota,'externa');assert(!Object.hasOwn(live[1],'campoNormalizado'));assert.deepEqual(live[1].unknown,{keep:true});checks++;
}
// Se conserva una fila sin id mientras se aplica una migración histórica explícita.
{
 const {a,rows}=hosts();const key='arcano33_pedidos';rows.set(key,JSON.stringify([{codigo:'OLD',fecha:'2020-01-01',cliente:'Histórico'}]));const base=a.sharedGet(key,[]);
 assert(a.sharedSet(key,[{...clone(base[0]),id:'legacy-stable',nota:'editada'}],{recordIds:['legacy-stable']}).ok);const live=JSON.parse(rows.get(key));assert.equal(live.length,1);assert.equal(live[0].codigo,'OLD');checks++;
}
// Clientes POS: la relectura interna no debe convertir una edición obsoleta en válida.
{
 const {a,b,rows}=hosts();const key='a33_pos_customersCatalog';rows.set(key,JSON.stringify([{id:'c',name:'Histórico',notas:'original'}]));const old=clone(a.sharedGet(key,[]));const other=clone(b.sharedGet(key,[]));other[0].notas='externa';assert(b.sharedSet(key,other).ok);old[0].notas='local';
 const pos=fs.readFileSync('pos/app.js','utf8');const start=pos.indexOf('function mergeCustomerCatalogByIdKeepPOS('),end=pos.indexOf('function syncDisabledLegacyFromCatalogPOS(',start);const ctx={window:{A33Storage:a},A33Storage:a,CUSTOMER_CATALOG_KEY:key,sortCustomerObjectsAZ_POS:x=>x,showToast(){}};vm.runInNewContext(pos.slice(start,end),ctx);const raw=rows.get(key);assert.equal(ctx.saveCustomerCatalogPOS(old),false);assert.equal(rows.get(key),raw);checks++;
}
// Guards use full records, not only updatedAt, and stable property order.
{
 const {a}=hosts();assert.equal(a.recordFingerprint({x:1,n:{b:2,a:3}}),a.recordFingerprint({n:{a:3,b:2},x:1}));checks++;
}
const pedidos=fs.readFileSync('pedidos/script.js','utf8');const guard=pedidos.slice(pedidos.indexOf('function pedidoEditorConflictPED('),pedidos.indexOf('// --- Identidad estable'));
for(const mode of ['completo','rapido']){
 const {a}=hosts();const context={window:{A33Storage:a},A33Storage:a,editingId:'old',quickOrderEditingId:'old',editingBaseRecordPED:{id:'old',nota:'vista'},quickOrderBaseRecordPED:{id:'old',nota:'vista'}};vm.runInNewContext(guard,context);
 assert.equal(context.pedidoEditorConflictPED(mode,[{nota:'vista',id:'old'}]),'');assert.match(context.pedidoEditorConflictPED(mode,[{id:'old',nota:'externa'}]),/cambió/);assert.match(context.pedidoEditorConflictPED(mode,[]),/eliminado/);checks++;
}
const agenda=fs.readFileSync('agenda/purchases.js','utf8').split('\n})();')[0]+'\n})();';let raw=JSON.stringify({records:[{id:'a',notes:'externa',updatedAt:7}]});const window={dispatchEvent(){}};vm.runInNewContext(agenda,{window,CustomEvent:function(){}});let saved=0;const storage={getItem:()=>raw,setItem:(k,v)=>{raw=v;saved++;}};
assert.throws(()=>window.A33AgendaRecords.write(storage,{kind:'update',id:'a',expected:{id:'a',notes:'original',updatedAt:7},record:{id:'a',notes:'local'}},'agenda'),/Conflicto/);assert.equal(saved,0);checks++;
console.log(`PASS E5.8: ${checks} escenarios de conflictos, cambios independientes, bajas, identidad histórica, comparación completa y lecturas inválidas`);
