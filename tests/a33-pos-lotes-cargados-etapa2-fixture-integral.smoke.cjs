'use strict';
const fs=require('fs'); const path=require('path'); const vm=require('vm'); const assert=require('assert');
const root=path.resolve(__dirname,'..');
const fixturePath=process.env.A33_FIXTURE || process.argv[2];
if(!fixturePath || !fs.existsSync(fixturePath)) throw new Error('Indica A33_FIXTURE con el JSON integral de prueba.');
const backup=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
const js=fs.readFileSync(path.join(root,'pos/app.js'),'utf8');
const pos=backup?.data?.indexedDB?.['a33-pos']||{}; const ls=backup?.data?.localStorage||{};
assert.strictEqual((pos.inventory||[]).length,10,'Fixture: inventory debe ser 10');
assert.strictEqual((pos.events||[]).length,1,'Fixture: events debe ser 1');
assert.strictEqual((pos.products||[]).length,7,'Fixture: products debe ser 7');
assert.strictEqual(String((pos.meta||[]).find(x=>String(x?.id)==='currentEventId')?.value),'2','Fixture: currentEventId debe ser 2');
const noop=()=>{};
const document={readyState:'loading',addEventListener:noop,querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,documentElement:{dataset:{}},body:{classList:{add:noop,remove:noop,toggle:noop},addEventListener:noop}};
let writes=0;
const localStorage={getItem:(k)=>Object.prototype.hasOwnProperty.call(ls,k)?String(ls[k]):null,setItem:()=>writes++,removeItem:()=>writes++};
const windowObj={addEventListener:noop,removeEventListener:noop,document,location:{pathname:'/pos/',href:'https://suite.local/pos/'},navigator:{},A33Storage:null}; windowObj.window=windowObj; windowObj.self=windowObj;
const context={console,window:windowObj,self:windowObj,globalThis:windowObj,document,navigator:windowObj.navigator,location:windowObj.location,localStorage,indexedDB:{open:()=>{throw new Error('No se abre IDB en este smoke de consolidación');}},alert:noop,confirm:()=>true,prompt:()=>'',setTimeout,clearTimeout,setInterval,clearInterval,performance:{now:()=>Date.now()},Blob,URL,TextEncoder,TextDecoder,crypto:require('crypto').webcrypto,fetch:async()=>({ok:false})}; Object.assign(windowObj,context);
vm.createContext(context); vm.runInContext(js,context,{timeout:15000});
context.__stores={inventory:pos.inventory,products:pos.products,events:pos.events,meta:pos.meta};
vm.runInContext(`readPosStoresFreshPOS=async function(names){const out={};for(const name of names)out[name]=(__stores[name]||[]).map(row=>({...row}));return out;};`,context);
(async()=>{
 const before=JSON.stringify(pos.inventory);
 const result=await context.getLotesCargadosEventoReadEntriesPOS('2');
 const model=context.buildLotesEventoModelPOS(result.entries,result.products);
 const expected={
  'A330XX128TAM5786':{C:8,T:2},
  'A330X8915OFF2026':{C:3,D:3},
  'A330X9017OFF2026':{G:2},
  'A33AV5786-0x91':{D:1,G:2},
  'A33AV5786-0x92':{C:1,D:1,G:2}
 };
 assert.strictEqual(result.modernGroups,5,'Debe detectar cinco grupos modernos');
 assert.ok(result.historicalGroups>=1,'Debe leer fuentes localStorage activas/archivadas');
 assert.strictEqual(result.uniqueGroups,5,'Debe deduplicar a cinco grupos');
 assert.strictEqual(model.rows.length,5,'El modelo debe mostrar cinco filas');
 const labels=Object.fromEntries(model.columns.map(c=>[c.key,c.label]));
 const rows=Object.fromEntries(model.rows.map(r=>[r.loteCodigo,Object.fromEntries(Object.entries(r.quantities).map(([k,v])=>[labels[k]||k,v]))]));
 for(const [code,qtys] of Object.entries(expected)){
  assert.ok(rows[code],`Falta ${code}`);
  for(const [letter,qty] of Object.entries(qtys)) assert.strictEqual(Number(rows[code][letter]||0),qty,`${code} ${letter}`);
 }
 for(const letter of ['C','D','G','T']) assert.ok(model.columns.some(c=>c.label===letter),`Falta columna ${letter}`);
 assert.strictEqual(JSON.stringify(pos.inventory),before,'La lectura modificó inventory');
 assert.strictEqual(writes,0,'La consolidación escribió localStorage');
 assert.ok(!(result.entries||[]).some(x=>String(x.source||'').toLowerCase().includes('reempaque')),'Reempaque contaminó Lotes cargados');
 console.log(JSON.stringify({ok:true,inventory:(pos.inventory||[]).length,events:(pos.events||[]).length,products:(pos.products||[]).length,currentEventId:2,modernGroups:result.modernGroups,historicalGroups:result.historicalGroups,uniqueGroups:result.uniqueGroups,codes:Object.keys(rows),columns:model.columns.map(c=>c.label),writes},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
