const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const sandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/a33-catalog-download.js'), 'utf8'), sandbox);
const api = sandbox.A33CatalogDownload;
(async () => {
  const writes = [];
  const result = await api.download({
    authorized: () => true,
    hasLocal: async s => s.entity === 'productos',
    read: async s => [{payload:{id:s.entity, name:'Prueba'}}],
    insertIfEmpty: async (s, rows) => { writes.push(s.entity); return rows.length; }
  });
  assert.equal(result.added, 6);
  assert(!writes.includes('productos'));
  assert.equal(api.records([{sourceId:'a33_pos_customersCatalog__meta:rev',payload:{value:1}}]).length, 0);
  assert.equal(api.records([{sourceId:'a33_pos_customerSticky:preferencia',payload:{value:true}}]).length, 0);
  assert.equal(api.records([{payload:{id:1,deleted:true}}]).length, 0);
  assert.throws(() => api.records([{payload:{name:'Sin ID'}}]));
  assert.throws(() => api.records([{payload:{id:{value:1}}}]));
  assert.throws(() => api.records([{payload:{id:1}},{payload:{id:'1'}}]));
  let written = 0;
  await assert.rejects(api.download({authorized:()=>true,hasLocal:async()=>false,
    read:async s=>{if(s.entity==='clientes')throw Error('permission-denied');return [{payload:{id:1}}];},
    insertIfEmpty:async()=>{written++;return 1;}}));
  assert.equal(written,0,'Una lectura fallida no debe incorporar parte de los catálogos');
  await assert.rejects(api.download({authorized:()=>false,hasLocal:async()=>false,
    read:async()=>[{payload:{id:1}}],insertIfEmpty:async()=>{written++;return 1;}}));
  assert.equal(written,0,'Una sesión cambiada no debe incorporar datos');
  let checks=0;
  const raced=await api.download({authorized:()=>true,hasLocal:async()=>++checks>7,
    read:async()=>[{payload:{id:1}}],insertIfEmpty:async()=>{written++;return 1;}});
  assert.equal(raced.added,0,'Conservar datos creados durante la descarga');
  console.log('OK descarga inicial: siete catálogos, preservación local, errores, metadatos y cambio de sesión.');
})().catch(error=>{console.error(error);process.exitCode=1;});
