'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const js = read('pos/app.js');
const html = read('pos/index.html');
const sw = read('pos/sw.js');
const release = read('assets/js/a33-release.js');
const build = read('assets/js/a33-build.js');
const manifest = JSON.parse(read('pos/manifest.webmanifest'));
const ok = (value, message) => assert.ok(value, message);

for (const token of [
  'function getLotesCargadosEventoReadEntriesPOS(eventId)',
  'function collectModernLotesReadGroupsPOS(allInventory, matcher)',
  'function collectHistoricalLotesReadGroupsPOS(lotes, matcher)',
  'function dedupeLotesReadGroupsPOS(groups, productIndex)',
  'function normalizeLotesReadEventIdPOS(value)',
  'function resolveInventoryProductIdentityPOS(ref, productsOrIndex, options={})',
  'readAllLotesFromSharedPOS()',
  "getAll('inventory').catch(()=>[])",
  "getAll('events').catch(()=>[])",
  '_lotesReadEvidence:true'
]) ok(js.includes(token), `Falta puente histórico: ${token}`);

ok(js.includes('const readResult = eventId != null'), 'Render no usa lectura consolidada');
ok(!js.includes("const entries = Number.isFinite(validEventId) && validEventId > 0\n    ? await getInventoryEntries(validEventId)"), 'Render todavía depende solo de Inventario moderno');
ok(js.includes(".normalize('NFC')"), 'Nombre de evento no usa comparación exacta normalizada');
ok(js.includes("return 'N:' + String(n);"), 'eventId numérico/texto no se normaliza');
ok(js.includes("source:'lote_historico_lectura'"), 'Histórico no queda identificado como lectura');
ok(js.includes("label:String(def.name || '').trim() || ('?' + (index + 1))"), 'Huérfano no muestra nombre histórico recuperable');
ok(js.includes("G:CANON_GALON_LABEL"), 'Galón legacy no usa etiqueta canónica');
ok(!js.includes('localStorage.clear('), 'Se agregó borrado global de localStorage');
ok(!js.includes('indexedDB.deleteDatabase('), 'Se agregó borrado de IndexedDB');

const start = js.indexOf('// Puente de lectura legacy para “Lotes cargados”.');
const end = js.indexOf('function buildLotesEventoModelPOS(entries, products){', start);
ok(start >= 0 && end > start, 'No se pudo aislar el puente de lectura');
const bridge = js.slice(start, end);
for (const forbidden of ['put(', 'addRestock(', 'writeLotesLS_POS(', 'sharedSet(', 'setItem(', 'delete(']){
  ok(!bridge.includes(forbidden), `El puente de lectura contiene escritura: ${forbidden}`);
}

const noop = ()=>{};
const document = {
  readyState:'loading',
  addEventListener:noop,
  querySelector:()=>null,
  querySelectorAll:()=>[],
  getElementById:()=>null,
  documentElement:{ dataset:{} },
  body:{ classList:{ add:noop, remove:noop, toggle:noop }, addEventListener:noop }
};
let setCalls = 0;
let storedLots = [];
const localStorage = {
  getItem:(key)=> key === 'arcano33_lotes' ? JSON.stringify(storedLots) : null,
  setItem:()=>{ setCalls += 1; },
  removeItem:()=>{ setCalls += 1; }
};
const windowObj = {
  addEventListener:noop,
  removeEventListener:noop,
  document,
  location:{ pathname:'/pos/', href:'http://suite.local/pos/' },
  navigator:{},
  A33Storage:null
};
windowObj.window = windowObj;
windowObj.self = windowObj;
const context = {
  console,
  window:windowObj,
  self:windowObj,
  globalThis:windowObj,
  document,
  navigator:windowObj.navigator,
  location:windowObj.location,
  localStorage,
  indexedDB:{ open:()=>{ throw new Error('IDB no se abre durante este smoke'); } },
  alert:noop,
  confirm:()=>true,
  prompt:()=>'',
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  performance:{ now:()=>Date.now() },
  Blob,
  URL,
  TextEncoder,
  TextDecoder,
  crypto:require('crypto').webcrypto,
  fetch:async()=>({ ok:false })
};
Object.assign(windowObj, context);
vm.createContext(context);
vm.runInContext(js, context, { timeout:10000 });

const products = [
  { id:1, productId:'prod-p', name:'Pulso 250 ml', letra:'P', receta:true, active:true },
  { id:2, productId:'prod-c', name:'Catrina 400 ml', letra:'C', receta:true, active:true },
  { id:3, productId:'prod-g', name:'Galón 3720 ml', letra:'G', receta:true, active:false }
];
const events = [
  { id:3, name:'Evento Ñ' },
  { id:4, name:'Evento N' }
];
const inventory = [
  { id:10, eventId:3, productId:1, type:'restock', qty:5, source:'lote', loteCodigo:'LT-001', loteId:'lot-1', loteCargaId:'load-1', loteLetra:'P', time:'2026-07-01T10:00:00Z' },
  { id:11, eventId:'3', productId:2, type:'restock', qty:2, source:'lote', loteCodigo:'LT-001', loteId:'lot-1', loteCargaId:'load-1', loteLetra:'C', time:'2026-07-01T10:00:00Z' },
  { id:12, eventId:3, productId:1, type:'restock', qty:1, source:'lote', loteCodigo:'MISMO', loteCargaId:'load-a', time:'2026-07-02T10:00:00Z' },
  { id:13, eventId:3, productId:1, type:'restock', qty:2, source:'lote', loteCodigo:'MISMO', loteCargaId:'load-b', time:'2026-07-03T10:00:00Z' },
  { id:14, eventId:4, productId:1, type:'restock', qty:99, source:'lote', loteCodigo:'OTRO-EVENTO', time:'2026-07-01T10:00:00Z' },
  { id:15, eventId:3, productId:1, type:'restock', qty:8, source:'manual', notes:'Reposición normal', time:'2026-07-04T10:00:00Z' },
  { id:16, eventId:'3', productId:1, type:'adjust', qty:-5, source:'lote_reverso', loteId:'lot-old', time:'2025-02-01T12:00:00Z' }
];
storedLots = [
  {
    id:'lot-1', codigo:'LT-001', assignedEventId:'3', assignedEventName:'Evento Ñ', assignedAt:'2026-07-01T10:00:00Z', assignedCargaId:'load-1',
    assignmentHistory:[{ type:'ASSIGN', eventId:'3', eventName:'Evento Ñ', at:'2026-07-01T10:00:00Z', loteCargaId:'load-1' }],
    productosProducidos:[
      { productId:'prod-p', Letra:'P', nombreSnapshot:'Pulso 250 ml', cantidadProducida:5 },
      { productId:'prod-c', Letra:'C', nombreSnapshot:'Catrina 400 ml', cantidadProducida:2 }
    ]
  },
  {
    id:'lot-old', codigo:'LT-OLD', assignmentHistory:[
      { type:'ASSIGN', eventId:3, eventName:'Evento Ñ', at:'2025-01-01T09:00:00Z' },
      { type:'REVERSE_ASSIGN', eventId:'3', eventName:'Evento Ñ', at:'2025-02-01T12:00:00Z' }
    ],
    pulso:3, galon:1
  },
  {
    id:'lot-name', codigo:'LT-NAME', assignmentHistory:[{ type:'ASIGNADO', eventName:'Evento Ñ', at:'2024-01-01' }],
    productos:[{ nombreSnapshot:'Edición Histórica Fuera de Catálogo', cantidadProducida:7 }]
  },
  {
    id:'lot-wrong-name', codigo:'NO-DEBE', assignedEventName:'Evento N', pulso:9
  }
];

context.__testData = { inventory, products, events };
vm.runInContext(`
  getAll = async function(store){
    if (store === 'inventory') return __testData.inventory.map(row=>({...row}));
    if (store === 'products') return __testData.products.map(row=>({...row}));
    if (store === 'events') return __testData.events.map(row=>({...row}));
    return [];
  };
`, context);

(async()=>{
  const result = await context.getLotesCargadosEventoReadEntriesPOS('3');
  const model = context.buildLotesEventoModelPOS(result.entries, result.products);
  const codes = Array.from(model.rows, row=>row.loteCodigo);

  assert.strictEqual(result.modernGroups, 3, 'No detectó los 3 grupos modernos válidos');
  assert.strictEqual(result.historicalGroups, 3, 'No detectó los 3 históricos válidos');
  assert.strictEqual(result.uniqueGroups, 5, 'Deduplicación moderna/histórica incorrecta');
  assert.strictEqual(model.rows.length, 5, 'Contador/modelo no refleja históricos únicos');
  assert.strictEqual(codes.filter(code=>code === 'LT-001').length, 1, 'Lote presente en dos fuentes se duplicó');
  assert.strictEqual(codes.filter(code=>code === 'MISMO').length, 2, 'Dos cargas con IDs fuertes distintos fueron fusionadas');
  ok(codes.includes('LT-OLD'), 'No recuperó lote P/M/D/L/G histórico');
  ok(codes.includes('LT-NAME'), 'No recuperó lote por nombre exacto de evento');
  ok(!codes.includes('OTRO-EVENTO') && !codes.includes('NO-DEBE'), 'Se mezcló otro evento');
  ok(model.columns.some(column=>column.label === 'C'), 'No conservó Producto dinámico Letra C');
  ok(model.columns.some(column=>column.label === 'G'), 'No conservó compatibilidad Galón/G');
  ok(model.columns.some(column=>String(column.label).includes('Edición Histórica')), 'No mostró nombre del producto huérfano');
  const old = model.rows.find(row=>row.loteCodigo === 'LT-OLD');
  ok(old && old.reversedAt, 'No conservó marca visual de reverso histórico');
  assert.strictEqual(old.quantities['LET:P'], 3, 'Cantidad histórica P cambió');
  assert.strictEqual(old.quantities['LET:G'], 1, 'Cantidad histórica G cambió');
  assert.strictEqual(setCalls, 0, 'La lectura histórica escribió localStorage');

  ok(release.includes('const rev = 6;'), 'Release general no avanzó a r6');
  ok(build.includes("pos:'48'"), 'Build POS no avanzó a m48');
  ok(html.includes('app.js?v=4.20.97&r=44'), 'HTML no carga app reparada');
  ok(html.includes('a33-release.js?v=4.20.97&r=58'), 'HTML no carga release actualizado');
  ok(html.includes('a33-build.js?v=4.20.97&r=16'), 'HTML no carga build actualizado');
  ok(html.includes('&m=48'), 'Registro SW no usa m48');
  ok(sw.includes("const MODULE_CACHE_REV = '48';"), 'SW POS no usa m48');
  ok(sw.includes("'./index.html?v=4.20.97&r=32'"), 'SW no precachea shell r32');
  ok(sw.includes("'./app.js?v=4.20.97&r=44'"), 'SW no precachea app r44');
  assert.strictEqual(manifest.start_url, './index.html?v=4.20.97&r=32', 'Manifest no apunta al shell nuevo');

  console.log('SMOKE OK — POS Inventario recuperación histórica r6 m48');
})().catch((error)=>{
  console.error(error);
  process.exitCode = 1;
});
