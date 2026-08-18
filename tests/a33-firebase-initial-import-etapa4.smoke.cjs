const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-import.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const writes = [];
const commits = [];

function ref(value){
  return {
    path:value,
    collection(name){ return ref(`${value}/${name}`); },
    doc(id){ return ref(`${value}/${id}`); }
  };
}

const db = {
  collection(name){ return ref(name); },
  batch(){
    const pending = [];
    return {
      set(target, value){ pending.push({ path:target.path, value }); },
      async commit(){ commits.push(pending.length); writes.push(...pending); }
    };
  }
};

const context = {
  console,
  TextEncoder,
  Date,
  localStorage:{ setItem(){}, getItem(){ return null; } },
  firebase:{ firestore(){ return db; } },
  A33FirebaseSettings:{ read(){ return { enabled:true, configured:true, workspaceId:'arcano33' }; } },
  A33FirebaseAuth:{ getState(){ return { authenticated:true, user:{ uid:'admin-1' } }; } },
  A33Access:{ getState(){ return { isAdmin:true, workspaceId:'arcano33', profile:{ status:'active' } }; } },
  A33Firebase:{ async initFirebaseApp(){ return {}; } },
  dispatchEvent(){},
  CustomEvent:function(type, init){ this.type=type; this.detail=init.detail; }
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename:'a33-firebase-import.js' });

assert(html.includes('id="cfg-initial-import-file"'), 'Falta selector JSON de E4.');
assert(html.includes('a33-firebase-import.js?v=4.20.98&amp;r=1'), 'Falta cargar el motor E4.');
assert(html.includes('style.css?v=4.20.98&amp;r=28'), 'No se actualizó la revisión CSS.');
assert(html.includes('script.js?v=4.20.98&amp;r=40'), 'No se actualizó la revisión JS.');
assert(rules.includes('match /imports/{importId}'), 'Faltan reglas para importaciones preparadas.');
assert(rules.includes('requesterAdmin(workspaceId) && validInitialImport'), 'La carga E4 no quedó limitada a Admin.');

const backup = {
  meta:{ appName:'Suite A33', backupType:'full', schemaVersion:8 },
  data:{
    localStorage:{ a33_blob:'😀'.repeat(2100000), a33_auth_token:'NO-DEBE-SUBIR' },
    indexedDB:{
      'a33-main':{ records:[{ id:1, passwordHash:'NO-DEBE-SUBIR', value:'ok' }] },
      foreignDb:{ records:[{ id:2 }] }
    }
  }
};

(async () => {
  const prepared = context.A33FirebaseImport.prepareObject(backup, { name:'respaldo.json', size:9000000 });
  assert(prepared.chunkCount > 20, 'La prueba debe cubrir más de un lote.');
  await context.A33FirebaseImport.upload();

  const manifest = writes[writes.length - 1];
  const chunks = writes
    .filter((item) => item.path.includes('/chunks/'))
    .sort((a, b) => a.value.index - b.value.index);
  assert(!manifest.path.includes('/chunks/'), 'El manifiesto debe escribirse al final.');
  assert(commits.length >= 3 && commits.at(-1) === 1, 'La carga no quedó dividida en lotes seguros.');
  assert(chunks.every((item) => new TextEncoder().encode(item.value.content).length <= 400000), 'Un bloque excede 400000 bytes.');

  const rebuilt = JSON.parse(chunks.map((item) => item.value.content).join(''));
  assert(!Object.prototype.hasOwnProperty.call(rebuilt.data.localStorage, 'a33_auth_token'), 'Se conservó una credencial local.');
  assert(!Object.prototype.hasOwnProperty.call(rebuilt.data.indexedDB, 'foreignDb'), 'Se conservó una base ajena.');
  assert(!Object.prototype.hasOwnProperty.call(rebuilt.data.indexedDB['a33-main'].records[0], 'passwordHash'), 'Se conservó una propiedad sensible.');

  assert.throws(() => context.A33FirebaseImport.prepareObject({
    meta:{ appName:'Suite A33', backupType:'partial' },
    data:{ localStorage:{}, indexedDB:{} }
  }, {}), /respaldo completo/, 'Se aceptó un respaldo parcial.');

  console.log('OK E4 Firebase initial import smoke');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
