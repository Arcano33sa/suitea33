'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const modules = ['pos','inventario','lotes','pedidos','catalogos','calculadora','agenda','centro-mando','calculadora_temporal'];
function storage(entries) {
  const data = new Map(entries);
  return { get length(){ return data.size; }, key:i=>[...data.keys()][i] ?? null,
    getItem:k=>data.get(k) ?? null, setItem:(k,v)=>data.set(k,String(v)), removeItem:k=>data.delete(k), data };
}
async function cleanupSmoke() {
  const origin = 'https://suite.test';
  const preserved = modules.map(m=>`a33-v4.20.98-${m.replace('_','-')}-r5-m1`).concat(['a33-futuro-r1','arcano33-desconocido','otro-login-cache','a33-v4.20.98-centro-mando-r5-login']);
  const cacheNames = preserved.concat(['a33-auth-v1']);
  const deleted = [], unregistered = [];
  const regs = [...modules.map(m=>`/pruebas/${m}/sw.js`),'/pruebas/futuro/sw.js','/suitea33/desconocido/sw.js','/a33_auth_v1/sw.js'].map(script=>({
    scope:origin+script.replace(/sw\.js$/, ''), active:{scriptURL:origin+script},
    async unregister(){ unregistered.push(script); return true; }
  }));
  const localStorage = storage([['arcano33_ventas_v1','[{"id":"historico"}]'],['a33_backup_v1','respaldo'],['a33_draft_v1','pendiente']]);
  const sessionStorage = storage([['a33_operacion_v1','abierta']]);
  const before = [...localStorage.data], sessionBefore = [...sessionStorage.data];
  let dbDeletes = 0;
  const window = { location:{origin}, localStorage, sessionStorage,
    caches:{async keys(){return cacheNames;},async delete(k){deleted.push(k);return true;}},
    indexedDB:{async databases(){return [{name:'a33-pos'},{name:'a33-inventario'}];},deleteDatabase(){dbDeletes++;throw new Error('No debe borrar BD operacional');}},
    navigator:{serviceWorker:{async getRegistrations(){return regs;}}},addEventListener(){} };
  const context = vm.createContext({window,navigator:window.navigator,URL,console,Date,Map,Set,Promise,setTimeout,clearTimeout});
  vm.runInContext(read('assets/js/a33-storage.js'),context);
  await window.__A33_LEGACY_ACCESS_PURGE_PROMISE;
  assert.deepEqual(deleted,['a33-auth-v1']);
  assert.deepEqual(unregistered,['/a33_auth_v1/sw.js']);
  assert.deepEqual([...localStorage.data],before);
  assert.deepEqual([...sessionStorage.data],sessionBefore);
  assert.equal(dbDeletes,0);
  assert.ok(window.A33Storage);
  console.log('PASS: limpieza automática conserva módulos, desconocidos, datos, respaldo, borrador y BD operacionales.');
}
async function activationSmoke(module) {
  const listeners = {}, deleted = [];
  const self = {location:{origin:'https://suite.test'},registration:{scope:`https://suite.test/${module}/`,active:{}},
    A33_RELEASE:{suiteVersion:'4.20.98',rev:5},addEventListener:(type,fn)=>listeners[type]=fn,
    clients:{async claim(){}},async skipWaiting(){}};
  const context = vm.createContext({self,URL,Response,importScripts(){},caches:{
    async keys(){return [`a33-v4.20.98-${module}-r5-m${read(module+'/sw.js').match(/MODULE_CACHE_REV = '([^']+)'/)[1]}`,
      `a33-v4.20.98-${module}-r1-m0`,'a33-v4.20.98-centro-mando-r5-m9','a33-v4.20.98-agenda-r5-m7',
      'a33-futuro-r1','otro-cache','a33-v4-centro_mando-r1','a33-v4-calculadora_a33-r1'];},
    async delete(k){deleted.push(k);return true;}
  }});
  vm.runInContext(read(module+'/sw.js'),context);
  let task; listeners.activate({waitUntil(p){task=p;}}); await task;
  assert.deepEqual(deleted,[`a33-v4.20.98-${module}-r1-m0`,'a33-v4-centro_mando-r1','a33-v4-calculadora_a33-r1']);
  console.log(`PASS: activación ${module} conserva Centro de Mando, Agenda, desconocidos y caché actual.`);
}
(async()=>{ await cleanupSmoke(); for(const module of ['pos','inventario','lotes','pedidos','catalogos']) await activationSmoke(module); })().catch(err=>{console.error(err);process.exitCode=1;});
