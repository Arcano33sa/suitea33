'use strict';
const assert=require('assert');const fs=require('fs');const vm=require('vm');
const source=fs.readFileSync('agenda/purchases.js','utf8').split('\n})();')[0]+'\n})();';
const events=[];const window={dispatchEvent:e=>events.push(e)};
vm.runInNewContext(source,{window,CustomEvent:function(type,options){this.type=type;this.detail=options.detail;}});
const writer=window.A33AgendaRecords;const key='a33_agenda_records_v1';let raw;let writes=0;
const storage={getItem:()=>raw===undefined?null:raw,setItem:(k,v)=>{assert.equal(k,key);raw=v;writes++;}};
const read=()=>JSON.parse(raw);const seed=value=>raw=JSON.stringify(value);
const historic={id:'historic',type:'compra',purchaseGroup:{version:1,items:[{priceUsed:17,unit:'Unidad histórica'}]},unknown:{a:[1,2]}};
seed({schemaVersion:9,extra:'conservar',records:[historic,{id:'task',type:'tarea',subject:'Original'}]});
writer.write(storage,{kind:'create',id:'meeting',record:{id:'meeting',type:'reunion'}},'agenda');
writer.write(storage,{kind:'create',id:'purchase',record:{id:'purchase',type:'compra'}},'compras');
writer.write(storage,{kind:'update',id:'task',record:{id:'task',subject:'Editada'}},'agenda');
assert.equal(read().records.length,4);assert.deepEqual(read().records.find(r=>r.id==='historic'),historic);assert.equal(read().extra,'conservar');
writer.write(storage,{kind:'delete',id:'meeting'},'agenda');
writer.write(storage,{kind:'update',id:'purchase',patch:{status:'hecho'}},'compras');
assert(!read().records.some(r=>r.id==='meeting'));assert.equal(read().records.length,3);
// Estado se aplica a la fila vigente y conserva campos modificados por otro escritor.
writer.write(storage,{kind:'update',id:'task',patch:{status:'hecho'}},'agenda');assert.equal(read().records.find(r=>r.id==='task').subject,'Editada');
for(const operation of [{kind:'create',id:'task',record:{id:'task'}},{kind:'update',id:'meeting',record:{id:'meeting'}},{kind:'delete',id:'absent'}]){const before=raw;assert.throws(()=>writer.write(storage,operation,'agenda'));assert.equal(raw,before);}
for(const invalid of ['{',JSON.stringify({records:null}),'null','']){raw=invalid;const count=writes;assert.throws(()=>writer.write(storage,{kind:'create',id:'new',record:{id:'new'}},'agenda'));assert.equal(writes,count);assert.equal(raw,invalid);}
seed([historic]);writer.write(storage,{kind:'create',id:'new',record:{id:'new'}},'agenda');assert.deepEqual(read().records.find(r=>r.id==='historic'),historic);
seed({records:[{id:'duplicate'},{id:'duplicate'}]});assert.throws(()=>writer.write(storage,{kind:'delete',id:'duplicate'},'agenda'));
const before=raw;const count=events.length;assert.throws(()=>writer.write({getItem:()=>{throw Error('read failed');},setItem:()=>assert.fail()}, {kind:'create',id:'new',record:{id:'new'}},'agenda'));
assert.throws(()=>writer.write({getItem:()=>before,setItem:()=>{throw Error('quota');}},{kind:'create',id:'new',record:{id:'new'}},'agenda'));assert.equal(events.length,count);assert.equal(raw,before);
const main=fs.readFileSync('agenda/script.js','utf8');assert(!main.includes('function saveRecords(){'));assert(main.includes("window.addEventListener('storage'"));
console.log('PASS E5.7: operaciones independientes, histórico y metadatos intactos, bajas sin resurrección, formatos anteriores, lecturas/escrituras fallidas sin confirmación');
