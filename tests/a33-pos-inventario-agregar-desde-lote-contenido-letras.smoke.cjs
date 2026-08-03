'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'pos/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pos/styles.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'pos/sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'pos/manifest.webmanifest'), 'utf8'));
const release = fs.readFileSync(path.join(root, 'assets/js/a33-release.js'), 'utf8');

function takeFunction(source, name){
  const asyncStart = source.indexOf(`async function ${name}(`);
  const plainStart = source.indexOf(`function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : plainStart;
  assert.ok(Number.isInteger(start) && start >= 0, `No se encontró ${name}`);
  let i = source.indexOf('(', start), parenDepth = 0, quote = '', escaped = false;
  for (; i < source.length; i++){
    const ch = source[i];
    if (quote){
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`'){ quote = ch; continue; }
    if (ch === '(') parenDepth++;
    else if (ch === ')' && --parenDepth === 0){ i++; break; }
  }
  i = source.indexOf('{', i);
  let depth = 0; quote = ''; escaped = false;
  for (; i < source.length; i++){
    const ch = source[i];
    if (quote){
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`'){ quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

// Simula tres variantes reales de identidad de Producto observadas en Suite A33:
// id estable texto + internalId, id numérico, e id estable + productInternalId/catalogInternalId.
const products = [
  { id:'prod-g', internalId:1, name:'Galón 3720ml', letra:'G' },
  { id:2, productId:'prod-d', name:'Djeba 750ml', Letra:'D' },
  { id:'prod-p', productInternalId:3, productId:'prod-p', name:'Pulso 150ml', letra:'P' },
  { id:'prod-t', catalogInternalId:4, productId:'prod-t', name:'Torre 350ml', letra:'T' }
];

const originalNote = 'Nota exclusiva del módulo Lotes';
let storedLotes = [{
  id:'lot-1',
  codigo:'A33XXXX',
  createdAt:'2026-07-30T20:00:00.000Z',
  status:'DISPONIBLE',
  notas:originalNote,
  disponibilidadPOS:[
    // Estructura real: sin snapshot exacto, disponible null, producción válida.
    { productId:'prod-g', Letra:'G', cantidadDisponible:null, cantidadDisponibleExiste:false, disponibilidadFuente:'sin_snapshot', cantidadProducida:2 },
    // Otra variante real: cero placeholder + cantidadBase válida.
    { productId:'prod-d', Letra:'D', cantidadDisponible:0, cantidadDisponibleExiste:false, disponibilidadFuente:'sin_snapshot', cantidadBase:3 },
    // Cero exacto: no debe caer a producción original.
    { productId:'prod-p', Letra:'P', cantidadDisponible:0, cantidadDisponibleExiste:true, cantidadProducida:9 },
    // Referencia irresoluble en primera fuente: debe permitir otra fuente válida.
    { productId:'producto-inexistente', cantidadDisponible:null, cantidadDisponibleExiste:false, cantidadProducida:2 }
  ],
  productosProducidos:[
    { productId:'prod-g', Letra:'G', cantidad:2 },
    { productId:'prod-d', Letra:'D', cantidad:3 },
    { productId:'prod-d', Letra:'D', cantidad:99 }, // duplicado deliberado: no sumar dos veces
    { productId:'prod-t', Letra:'T', cantidad:2 }
  ]
}];

const restocks = [];
const toasts = [];
const sharedSets = [];
const context = vm.createContext({
  console, Date, Math, Number, String, Object, Array, Set, Map, JSON,
  window:{},
  catalogProductSnapshotNamePOS:(p)=>String(p && (p.name || p.nombre) || ''),
  saleCostFromFieldsPOS:()=>0,
  mapProductNameToFinishedId:(name)=>{
    const s=String(name||'').toLowerCase();
    if (s.includes('gal')) return 'galon';
    if (s.includes('djeba')) return 'djeba';
    if (s.includes('pulso')) return 'pulso';
    if (s.includes('media')) return 'media';
    if (s.includes('litro')) return 'litro';
    return '';
  },
  $:(sel)=> sel === '#inv-event' ? { value:'7' } : null,
  getEventByIdPOS:async()=>({ id:7, name:'Evento Smoke' }),
  db:null,
  getAll:async(store)=> store === 'products' ? products.map(p=>({...p})) : [],
  openDB:async()=>{},
  loteIsUsablePOS:(l)=>!!l && !l.assignedEventId && String(l.status||'DISPONIBLE').toUpperCase()==='DISPONIBLE',
  round2:(n)=>Math.round(Number(n||0)*100)/100,
  addRestock:async(eventId, productId, qty, meta)=>{ restocks.push({eventId,productId,qty,meta}); },
  renderInventario:async()=>{},
  refreshSaleStockLabel:async()=>{},
  showToast:(message,type)=>{ toasts.push({message,type}); },
  queueLotsUsageSyncPOS:()=>{},
  showPersistFailPOS:(scope,err)=>{ throw err; },
  openInvLoteSelectorModalPOS:()=>{},
  A33Storage:null
});
context.window.A33Storage = {
  sharedGet:(key)=> key === 'arcano33_lotes' ? storedLotes.map(l=>JSON.parse(JSON.stringify(l))) : [],
  sharedSet:(key,value)=>{
    assert.strictEqual(key, 'arcano33_lotes');
    storedLotes = value.map(l=>JSON.parse(JSON.stringify(l)));
    sharedSets.push(key);
    return {ok:true};
  }
};
context.A33Storage = context.window.A33Storage;

class FakeNode {
  constructor(tag='div'){
    this.tagName=String(tag).toUpperCase();
    this.children=[];
    this.textContent='';
    this.className='';
    this.disabled=false;
    this.title='';
    this.type='';
    this.listeners={};
    this._innerHTML='';
  }
  appendChild(node){ this.children.push(node); return node; }
  addEventListener(type, fn){ this.listeners[type]=fn; }
  set innerHTML(value){ this._innerHTML=String(value); this.children=[]; }
  get innerHTML(){ return this._innerHTML; }
}
const selectorTbody = new FakeNode('tbody');
const selectorMsg = new FakeNode('div');
context.document = {
  querySelector:(sel)=> sel === '#inv-lote-selector-table tbody' ? selectorTbody : null,
  getElementById:(id)=> id === 'inv-lote-selector-msg' ? selectorMsg : null,
  createElement:(tag)=>new FakeNode(tag)
};
context.readAllLotesFromSharedPOS = ()=>storedLotes.map(l=>JSON.parse(JSON.stringify(l)));
context.loteCreatedTsPOS = (l)=>Date.parse(l && l.createdAt || '') || 0;
context.formatLoteDatePOS = (v)=>String(v || '').slice(0,10);
context.computeLoteEstadoPOS_UI = ()=> 'Disponible';
context.handleUseLoteFromSelectorPOS = ()=>{};

const fnNames = [
  'catalogProductStableIdPOS','catalogProductInternalIdPOS','productIdentityNormPOS','productIdentityNameKeyPOS',
  'buildProductIdentityIndexPOS','collectProductIdentityCandidatesPOS','resolveCatalogProductIdentityPOS',
  'lotesPOSContractSourcesPOS','lotesPOSContractRowsPOS','parseLoteContractQtyPOS','parseLoteAvailabilityFlagPOS',
  'lotesPOSQtyInfoFromContractRowPOS','lotesPOSQtyFromContractRowPOS','resolveProductFromLoteContractRowPOS',
  'normalizeLoteContentLetterPOS','formatLoteContentQtyPOS','buildLoteAvailableLoadPlanPOS',
  'isRecoverableLoteProductsReadErrorPOS','readProductsForLotePlanPOS',
  'renderInvLoteSelectorTablePOS','importFromLoteToInventory'
];
vm.runInContext(fnNames.map(name=>takeFunction(app,name)).join('\n')
  + '\n;globalThis.__plan=buildLoteAvailableLoadPlanPOS;globalThis.__render=renderInvLoteSelectorTablePOS;globalThis.__import=importFromLoteToInventory;', context);

(async()=>{
  assert.strictEqual(context.catalogProductInternalIdPOS(products[0]), 1, 'No resolvió internalId con id estable texto');
  assert.strictEqual(context.catalogProductInternalIdPOS(products[1]), 2, 'No conservó id numérico');
  assert.strictEqual(context.catalogProductInternalIdPOS(products[2]), 3, 'No resolvió productInternalId');
  assert.strictEqual(context.catalogProductInternalIdPOS(products[3]), 4, 'No resolvió catalogInternalId');

  let readAttempts = 0, reopenCount = 0, closeCount = 0;
  context.db = { close:()=>{ closeCount++; } };
  context.getAll = async(store)=>{
    assert.strictEqual(store, 'products');
    readAttempts++;
    if (readAttempts === 1){ const e = new Error('transaction inactive'); e.name = 'InvalidStateError'; throw e; }
    return products.map(p=>({...p}));
  };
  context.openDB = async()=>{ reopenCount++; };
  const recoveredProducts = await context.readProductsForLotePlanPOS();
  assert.strictEqual(recoveredProducts.length, products.length, 'Reapertura no recuperó Productos');
  assert.strictEqual(readAttempts, 2, 'La lectura no reintentó exactamente una vez');
  assert.strictEqual(reopenCount, 1, 'La base no se reabrió exactamente una vez');
  assert.strictEqual(closeCount, 1, 'La conexión inválida no se cerró defensivamente');
  context.getAll = async(store)=> store === 'products' ? products.map(p=>({...p})) : [];

  const plan = context.__plan(storedLotes[0], products);
  assert.strictEqual(plan.summary, '2G 3D 2T', 'Resumen por Letras incorrecto para estructura real');
  assert.strictEqual(plan.total, 7, 'Total disponible incorrecto');
  assert.deepStrictEqual(Array.from(plan.items, x=>Number(x.qty)), [2,3,2], 'Incluyó cero o duplicó producto');
  assert.deepStrictEqual(Array.from(plan.items, x=>Number(x.productId)), [1,2,4], 'No utilizó IDs operativos reales');
  assert.ok(plan.unresolved.length >= 1, 'No registró referencia irresoluble para diagnóstico');

  assert.strictEqual(context.lotesPOSQtyFromContractRowPOS({cantidadDisponible:0,cantidadDisponibleExiste:true,cantidadProducida:9}), 0, 'Cero exacto cayó a producción original');
  assert.strictEqual(context.lotesPOSQtyFromContractRowPOS({cantidadDisponible:0,cantidadDisponibleExiste:false,cantidadBase:3}), 3, 'Cero placeholder bloqueó cantidadBase válida');
  assert.strictEqual(context.lotesPOSQtyFromContractRowPOS({cantidadDisponible:null,cantidadDisponibleExiste:false,cantidadProducida:8}), 8, 'Null sin snapshot bloqueó producción válida');
  assert.strictEqual(context.lotesPOSQtyFromContractRowPOS({cantidadDisponible:-2,cantidadDisponibleExiste:true,cantidadProducida:9}), 0, 'Cantidad exacta negativa cayó a producción original');

  const assignedVisible = context.__plan({...storedLotes[0], status:'EN_EVENTO', assignedEventId:7}, products);
  assert.strictEqual(assignedVisible.summary, '2G 3D 2T', 'El contenido quedó indebidamente acoplado al estado utilizable del lote');

  const exactZero = context.__plan({status:'DISPONIBLE', disponibilidadPOS:[
    {productId:'prod-g',Letra:'G',cantidadDisponible:0,cantidadDisponibleExiste:true,cantidadProducida:2}
  ], productosProducidos:[{productId:'prod-g',Letra:'G',cantidad:2}]}, products);
  assert.strictEqual(exactZero.summary, '', 'Disponibilidad exacta cero fue reemplazada por producción original');
  assert.strictEqual(exactZero.total, 0, 'Disponibilidad exacta cero produjo unidades');

  await context.__render(7, {fresh:true});
  assert.strictEqual(selectorTbody.children.length, 1, 'Selector no renderizó el lote');
  const renderedCells = selectorTbody.children[0].children;
  assert.strictEqual(renderedCells.length, 5, 'Selector no conserva cinco columnas');
  assert.strictEqual(renderedCells[2].children[0].textContent, '2G 3D 2T', 'Contenido no se renderizó desde datos reales');
  assert.ok(!renderedCells.some(cell=>String(cell.textContent || '').includes(originalNote)), 'La Nota apareció en el selector');
  assert.strictEqual(renderedCells[4].children[0].disabled, false, 'Usar quedó bloqueado con contenido legítimo');

  const result = await context.__import({evId:7,loteId:'lot-1',loteCodigo:'A33XXXX'});
  assert.strictEqual(result.ok, true, 'La carga válida falló');
  assert.strictEqual(result.contentSummary, '2G 3D 2T', 'Confirmación no reutilizó el resumen');
  assert.strictEqual(result.total, 7, 'Resultado de carga no conserva total');
  assert.strictEqual(restocks.length, 3, 'Se duplicaron o perdieron movimientos');
  assert.deepStrictEqual(restocks.map(r=>r.qty), [2,3,2], 'Inventario no recibió cantidades legítimas');
  assert.deepStrictEqual(restocks.map(r=>r.productId), [1,2,4], 'Inventario no recibió IDs internos legítimos');
  assert.ok(restocks.every(r=>r.meta && r.meta.source === 'lote'), 'Movimientos perdieron trazabilidad de lote');
  assert.strictEqual(storedLotes[0].notas, originalNote, 'La Nota original fue modificada');
  assert.strictEqual(storedLotes[0].status, 'EN_EVENTO', 'Lote no quedó asignado');
  assert.strictEqual(sharedSets.length, 1, 'Persistencia de lote ejecutada más de una vez');
  assert.strictEqual(toasts.at(-1).message, 'Lote aplicado: “A33XXXX” · 2G 3D 2T · 7 unidades', 'Mensaje posterior incorrecto');

  const before = restocks.length;
  const second = await context.__import({evId:7,loteId:'lot-1',loteCodigo:'A33XXXX'});
  assert.strictEqual(second.ok, false, 'Permitió aplicar el mismo lote dos veces');
  assert.strictEqual(second.reason, 'NOT_AVAILABLE', 'Segundo intento no fue bloqueado');
  assert.strictEqual(restocks.length, before, 'Segundo intento duplicó movimientos');

  storedLotes.push({
    id:'lot-2', codigo:'A33UNO', createdAt:'2026-07-30T21:00:00.000Z', status:'DISPONIBLE', notas:'Nota singular',
    disponibilidadPOS:[{productId:'prod-t',Letra:'T',cantidadDisponible:null,cantidadDisponibleExiste:false,cantidadProducida:1}]
  });
  const singular = await context.__import({evId:7,loteId:'lot-2',loteCodigo:'A33UNO'});
  assert.strictEqual(singular.ok, true, 'La carga singular falló');
  assert.strictEqual(singular.contentSummary, '1T', 'Resumen singular incorrecto');
  assert.strictEqual(toasts.at(-1).message, 'Lote aplicado: “A33UNO” · 1T · 1 unidad', 'Singular unidad incorrecto');

  assert.ok(html.includes('<th>Contenido</th>') && !html.includes('<th>Nota</th>'), 'Encabezado del selector incorrecto');
  assert.ok(html.includes('placeholder="Buscar por código…"'), 'El selector todavía expone búsqueda por Nota');
  assert.ok(css.includes('@media (max-width:820px)') && css.includes('content:"Contenido: ";'), 'Falta responsive iPad vertical/móvil');
  assert.ok(css.includes('.inv-lote-content-summary') && css.includes('word-break:keep-all') && css.includes('overflow-x:auto'), 'Contenido responsive puede partir valores o escapar del contenedor');
  assert.ok(release.includes('const rev = 5;'), 'Release general no fue coordinado');
  assert.ok(sw.includes("const MODULE_CACHE_REV = '49';"), 'Caché POS no fue incrementado');
  assert.ok(sw.includes("'./index.html?v=4.20.97&r=32'") && sw.includes("'./app.js?v=4.20.97&r=45'") && sw.includes("'./styles.css?v=4.20.97&r=24'"), 'Precache POS mezclado');
  assert.strictEqual(manifest.start_url, './index.html?v=4.20.97&r=32', 'Manifest no fue actualizado');
  assert.ok(!app.includes('localStorage.clear('), 'Se agregó borrado global de localStorage');
  assert.ok(!app.includes('indexedDB.deleteDatabase('), 'Se agregó borrado de IndexedDB');

  console.log('SMOKE OK — POS Inventario Agregar desde lote — Contenido real por Letras');
})().catch(err=>{ console.error(err); process.exit(1); });
