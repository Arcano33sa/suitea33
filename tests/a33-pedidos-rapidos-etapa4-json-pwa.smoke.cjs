'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const configJs = fs.readFileSync(path.join(root, 'configuracion', 'script.js'), 'utf8');
const configHtml = fs.readFileSync(path.join(root, 'configuracion', 'index.html'), 'utf8');
const pedidosHtml = fs.readFileSync(path.join(root, 'pedidos', 'index.html'), 'utf8');
const pedidosSw = fs.readFileSync(path.join(root, 'pedidos', 'sw.js'), 'utf8');
const cdmHtml = fs.readFileSync(path.join(root, 'centro-mando', 'index.html'), 'utf8');
const cdmSw = fs.readFileSync(path.join(root, 'centro-mando', 'sw.js'), 'utf8');
const pedidosManifest = JSON.parse(fs.readFileSync(path.join(root, 'pedidos', 'manifest.webmanifest'), 'utf8'));
const cdmManifest = JSON.parse(fs.readFileSync(path.join(root, 'centro-mando', 'manifest.webmanifest'), 'utf8'));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(/const QUICK_ORDERS_BACKUP_KEY = 'arcano33_pedidos_rapidos_v1'/.test(configJs), 'Configuración no declara el bloque rápido.');
check(/label: 'Pedidos completos y rápidos'/.test(configJs), 'Respaldo personalizado no identifica Pedidos rápidos.');
check(/schemaVersion:8/.test(configJs), 'Respaldo completo no elevó su esquema.');
check(/quickOrders:\{ included:[^\n]+mergePolicy:'id_updatedAt'/.test(configJs), 'Metadata JSON no documenta la política rápida.');
check(/else if \(k === QUICK_ORDERS_BACKUP_KEY\)[\s\S]*normalizeQuickOrdersBackupValue\(v\)/.test(configJs), 'Importación completa no normaliza/deduplica rápidos.');
check(/String\(key \|\| ''\) === QUICK_ORDERS_BACKUP_KEY[\s\S]*mergeQuickOrdersBackupValues/.test(configJs), 'Importación parcial no usa fusión rápida especializada.');
check(!/removeItem\(QUICK_ORDERS_BACKUP_KEY/.test(configJs), 'Un respaldo antiguo podría borrar rápidos locales.');

const values = new Map();
const localStorage = {
  get length(){ return values.size; }, key(index){ return Array.from(values.keys())[index] ?? null; },
  getItem(key){ return values.has(key) ? values.get(key) : null; },
  setItem(key,value){ values.set(String(key),String(value)); }, removeItem(key){ values.delete(String(key)); }
};
const document = {
  readyState:'loading', body:{ classList:{ add(){}, remove(){}, toggle(){} }, appendChild(){} },
  documentElement:{ style:{ setProperty(){} } },
  getElementById(){ return null; }, querySelector(){ return null; }, querySelectorAll(){ return []; },
  addEventListener(){}, createElement(){ return { style:{}, classList:{ add(){}, remove(){}, toggle(){} }, dataset:{}, append(){}, appendChild(){}, addEventListener(){}, setAttribute(){}, remove(){}, click(){} }; }
};
const window = {
  document, localStorage, addEventListener(){}, dispatchEvent(){}, matchMedia(){ return { matches:false, addEventListener(){} }; },
  location:{ href:'', search:'', origin:'https://example.test', pathname:'/configuracion/' },
  A33Storage:{ getItem:key => localStorage.getItem(key), setItem:(key,value) => { localStorage.setItem(key,value); return true; } }
};
const context = vm.createContext({
  window, document, localStorage, navigator:{ onLine:true }, console, Date, Math, JSON, URL, URLSearchParams, Blob,
  setTimeout, clearTimeout, setInterval, clearInterval, confirm(){ return false; }, alert(){}, CustomEvent:function(){}, Event:function(){},
  FileReader:function(){}, indexedDB:{}, crypto:globalThis.crypto
});
context.globalThis = context;
vm.runInContext(configJs, context, { filename:'configuracion-script.js' });

const contract = window.A33QuickOrdersBackupContract;
check(!!contract, 'No se expuso el contrato JSON de rápidos.');
check(contract && contract.storageKey === 'arcano33_pedidos_rapidos_v1', 'Clave del contrato JSON incorrecta.');

const normalized = contract.normalizeRaw(JSON.stringify([
  { id:'pr_1', codigo:'pr-20260820-001', customerName:'Cliente viejo', fechaEntrega:'2026-08-20', updatedAt:100, items:[{ productId:'p1', productNameSnapshot:'Djeba', cantidad:1 }] },
  { id:'pr_1', codigo:'PR-20260820-001', customerName:'Cliente nuevo', fechaEntrega:'2026-08-20', updatedAt:200, items:[{ productId:'p1', productNameSnapshot:'Djeba', cantidad:2 },{ productId:'p1', productNameSnapshot:'Djeba', cantidad:99 }] },
  { codigo:'PR-20260821-001', clienteNombre:'Histórico', deliveryDate:'2026-08-21', updatedAt:50, productosPedido:[{ nombre:'Producto inactivo', qty:3 }] }
]));
check(normalized.length === 2, 'Normalización no deduplicó IDs repetidos.');
check(normalized.find(row => row.id === 'pr_1').customerName === 'Cliente nuevo', 'Normalización no conservó el registro más reciente.');
check(normalized.find(row => row.id === 'pr_1').items.length === 1, 'Normalización no deduplicó productos internos.');
check(/^pr_legacy_/.test(normalized.find(row => row.id !== 'pr_1').id), 'Registro legacy no recibió ID determinista.');
check(normalized.find(row => row.id !== 'pr_1').items[0].productId.startsWith('prd_legacy_'), 'Producto legacy no conserva identidad importable.');

const merged = contract.mergeRaw(
  JSON.stringify([{ id:'same', codigo:'PR-20260820-001', customerName:'Local nuevo', fechaEntrega:'2026-08-20', updatedAt:300, items:[{ productId:'p1', productNameSnapshot:'Djeba', cantidad:1 }] }]),
  JSON.stringify([
    { id:'same', codigo:'PR-20260820-001', customerName:'Respaldo viejo', fechaEntrega:'2026-08-20', updatedAt:200, items:[{ productId:'p1', productNameSnapshot:'Djeba', cantidad:8 }] },
    { id:'new', codigo:'PR-20260822-001', customerName:'Nuevo', fechaEntrega:'2026-08-22', updatedAt:400, items:[{ productId:'p2', productNameSnapshot:'Media', cantidad:2 }] }
  ])
);
check(merged.length === 2, 'Fusión parcial produjo duplicados.');
check(merged.find(row => row.id === 'same').customerName === 'Local nuevo', 'Fusión parcial sobrescribió datos locales más recientes.');
check(merged.some(row => row.id === 'new'), 'Fusión parcial no agregó un ID nuevo.');

check(pedidosHtml.includes('style.css?v=4.20.98&r=9'), 'Pedidos HTML no apunta al CSS vigente.');
check(pedidosHtml.includes('script.js?v=4.20.98&r=17'), 'Pedidos HTML no apunta al JS vigente.');
check(pedidosHtml.includes('a33-storage.js?v=4.20.98&r=21'), 'Pedidos HTML no apunta al almacenamiento vigente.');
check(pedidosHtml.includes('manifest.webmanifest?v=4.20.98&r=9'), 'Pedidos HTML no apunta al manifest vigente.');
check(pedidosManifest.start_url === './index.html?v=4.20.98&r=14', 'Pedidos manifest no abre el index vigente.');
for (const token of ["MODULE_CACHE_REV = '20'","index.html?v=4.20.98&r=14","style.css?v=4.20.98&r=9","script.js?v=4.20.98&r=17","manifest.webmanifest?v=4.20.98&r=9","a33-storage.js?v=4.20.98&r=21","'./offline.html'"]){
  check(pedidosSw.includes(token), `Pedidos SW no contiene ${token}.`);
}
check(cdmHtml.includes('style.css?v=4.20.98&r=19'), 'CdM HTML no apunta al CSS vigente.');
check(cdmHtml.includes('app.js?v=4.20.98&r=23'), 'CdM HTML no apunta al JS vigente.');
check(cdmHtml.includes('a33-storage.js?v=4.20.98&r=21'), 'CdM HTML no apunta al almacenamiento vigente.');
check(cdmHtml.includes('manifest.webmanifest?v=4.20.98&r=6'), 'CdM HTML no apunta al manifest vigente.');
check(cdmManifest.start_url === './index.html?v=4.20.98&r=23', 'CdM manifest no abre el index vigente.');
for (const token of ["MODULE_CACHE_REV = '6'","index.html?v=4.20.98&r=23","style.css?v=4.20.98&r=19","app.js?v=4.20.98&r=23","manifest.webmanifest?v=4.20.98&r=6","a33-storage.js?v=4.20.98&r=21","'./offline.html'"]){
  check(cdmSw.includes(token), `CdM SW no contiene ${token}.`);
}
check(configHtml.includes('a33-storage.js?v=4.20.98&amp;r=21'), 'Configuración no apunta al almacenamiento vigente.');
check(configHtml.includes('script.js?v=4.20.98&amp;r=35'), 'Configuración no apunta al JS vigente.');

async function exerciseOfflineNavigation(source,modulePath){
  const base = `https://example.test/${modulePath}/`;
  const stores = new Map();
  const cacheApi = (name) => {
    if (!stores.has(name)) stores.set(name,new Map());
    const records = stores.get(name);
    const resolve = (value) => new URL(typeof value === 'string' ? value : value.url,base).href;
    return {
      async addAll(urls){
        for (const url of urls) records.set(resolve(url),new Response(`PRECACHE:${resolve(url)}`,{ status:200 }));
      },
      async match(value,options){
        const exact = records.get(resolve(value));
        if (exact) return exact.clone();
        if (options && options.ignoreSearch){
          const target = new URL(resolve(value));
          for (const [key,response] of records){
            const candidate = new URL(key);
            if (candidate.origin === target.origin && candidate.pathname === target.pathname) return response.clone();
          }
        }
        return undefined;
      },
      async put(value,response){ records.set(resolve(value),response.clone()); }
    };
  };
  const listeners = new Map();
  const caches = {
    async open(name){ return cacheApi(name); },
    async keys(){ return Array.from(stores.keys()); },
    async delete(name){ return stores.delete(name); }
  };
  const self = {
    A33_RELEASE:{ suiteVersion:'4.20.98',rev:5 },
    location:{ origin:'https://example.test' },
    registration:{ scope:base },
    clients:{ async claim(){} },
    async skipWaiting(){},
    addEventListener(name,handler){ listeners.set(name,handler); }
  };
  const swContext = vm.createContext({ self, caches, URL, Response, console, importScripts(){}, fetch:async() => { throw new Error('offline'); } });
  vm.runInContext(source,swContext,{ filename:`${modulePath}-sw.js` });
  let installPromise = Promise.resolve();
  listeners.get('install')({ waitUntil(value){ installPromise = Promise.resolve(value); } });
  await installPromise;
  let responsePromise;
  listeners.get('fetch')({
    request:{ method:'GET',url:base,mode:'navigate',destination:'document' },
    respondWith(value){ responsePromise = Promise.resolve(value); }
  });
  const response = await responsePromise;
  return !!response && response.status === 200 && (await response.text()).startsWith('PRECACHE:');
}

(async()=>{
  check(await exerciseOfflineNavigation(pedidosSw,'pedidos'), 'Pedidos SW no resuelve navegación offline desde precaché.');
  check(await exerciseOfflineNavigation(cdmSw,'centro-mando'), 'CdM SW no resuelve navegación offline desde precaché.');
  if (failures.length){
    console.error('PEDIDOS RÁPIDOS ETAPA 4 JSON/PWA SMOKE FAIL');
    failures.forEach(failure => console.error('- ' + failure));
    process.exit(1);
  }
  console.log('PEDIDOS RÁPIDOS ETAPA 4 JSON/PWA SMOKE OK');
})().catch((error)=>{
  console.error('PEDIDOS RÁPIDOS ETAPA 4 JSON/PWA SMOKE ERROR');
  console.error(error);
  process.exit(1);
});
