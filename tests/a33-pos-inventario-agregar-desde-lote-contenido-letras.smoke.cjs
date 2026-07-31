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
  const plain = source.indexOf(`function ${name}(`);
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = [plain, asyncStart].filter(i => i >= 0).sort((a,b)=>a-b)[0];
  assert.ok(Number.isInteger(start) && start >= 0, `No se encontró ${name}`);
  let i = source.indexOf('{', start), depth = 0, quote = '', escaped = false;
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

const products = [
  { id:1, productId:'prod-g', name:'Galón 3750 ml', letra:'G' },
  { id:2, productId:'prod-d', name:'Djeba 750 ml', letra:'D' },
  { id:3, productId:'prod-p', name:'Pulso 250 ml', letra:'P' },
  { id:4, productId:'prod-t', name:'Producto dinámico', letra:'T' }
];

const originalNote = 'Nota exclusiva del módulo Lotes';
let storedLotes = [{
  id:'lot-1',
  codigo:'A33XXXX',
  createdAt:'2026-07-30T20:00:00.000Z',
  status:'DISPONIBLE',
  notas:originalNote,
  disponibilidadPOS:[
    { productId:'prod-g', Letra:'G', cantidadDisponible:2, cantidadProducida:2 },
    { productId:'prod-d', Letra:'D', cantidadDisponible:3, cantidadProducida:3 },
    { productId:'prod-p', Letra:'P', cantidadDisponible:0, cantidadProducida:9 },
    { productId:'prod-d', Letra:'D', cantidadDisponible:99, cantidadProducida:99 },
    { productId:'prod-t', Letra:'T', cantidadDisponible:2, cantidadProducida:2 }
  ]
}];

const identity = (ref, list) => {
  const rows = Array.isArray(list) ? list : [];
  let product = null;
  if (ref && rows.includes(ref)) product = ref;
  if (!product && ref && typeof ref === 'object'){
    const pid = String(ref.productId ?? ref.productoId ?? '');
    const iid = Number(ref.id ?? ref.productInternalId);
    const letter = String(ref.Letra ?? ref.letra ?? '').toUpperCase();
    product = rows.find(p => (pid && String(p.productId) === pid)
      || (Number.isFinite(iid) && Number(p.id) === iid)
      || (letter && String(p.letra).toUpperCase() === letter)) || null;
  }
  return product ? {
    ok:true, product,
    stableId:String(product.productId || ''),
    internalId:Number(product.id),
    letter:String(product.letra || '').toUpperCase(),
    name:String(product.name || '')
  } : { ok:false, product:null, stableId:'', internalId:null, letter:'', name:'' };
};

const restocks = [];
const toasts = [];
const sharedSets = [];
const context = vm.createContext({
  console, Date, Math, Number, String, Object, Array, Set, Map, JSON,
  window:{},
  productIdentityNormPOS:(v)=>String(v == null ? '' : v).trim(),
  resolveCatalogProductIdentityPOS:identity,
  catalogProductInternalIdPOS:(p)=>Number(p && p.id) || null,
  catalogProductStableIdPOS:(p)=>String(p && p.productId || ''),
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
  getAll:async(store)=> store === 'products' ? products.map(p=>({...p})) : [],
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
  'lotesPOSContractRowsPOS','lotesPOSQtyFromContractRowPOS','resolveProductFromLoteContractRowPOS',
  'normalizeLoteContentLetterPOS','formatLoteContentQtyPOS','buildLoteAvailableLoadPlanPOS',
  'renderInvLoteSelectorTablePOS','importFromLoteToInventory'
];
vm.runInContext(fnNames.map(name=>takeFunction(app,name)).join('\n')
  + '\n;globalThis.__plan=buildLoteAvailableLoadPlanPOS;globalThis.__render=renderInvLoteSelectorTablePOS;globalThis.__import=importFromLoteToInventory;', context);

(async()=>{
  const plan = context.__plan(storedLotes[0], products);
  assert.strictEqual(plan.summary, '2G 3D 2T', 'Resumen por Letras incorrecto');
  assert.strictEqual(plan.total, 7, 'Total disponible incorrecto');
  assert.deepStrictEqual(Array.from(plan.items, x=>Number(x.qty)), [2,3,2], 'Incluyó cero o duplicó producto');
  assert.strictEqual(context.lotesPOSQtyFromContractRowPOS({cantidadDisponible:0,cantidadProducida:9}), 0, 'Cero disponible cayó a producción original');
  assert.strictEqual(context.lotesPOSQtyFromContractRowPOS({cantidadDisponible:-2,cantidadProducida:9}), 0, 'Cantidad negativa cayó a producción original');

  await context.__render(7, {fresh:true});
  assert.strictEqual(selectorTbody.children.length, 1, 'Selector no renderizó el lote');
  const renderedCells = selectorTbody.children[0].children;
  assert.strictEqual(renderedCells.length, 5, 'Selector no conserva cinco columnas');
  assert.strictEqual(renderedCells[2].children[0].textContent, '2G 3D 2T', 'Contenido no se renderizó desde el plan real');
  assert.ok(!renderedCells.some(cell=>String(cell.textContent || '').includes(originalNote)), 'La Nota apareció en el selector');
  assert.strictEqual(renderedCells[4].children[0].disabled, false, 'Usar quedó bloqueado con contenido legítimo');

  const result = await context.__import({evId:7,loteId:'lot-1',loteCodigo:'A33XXXX'});
  assert.strictEqual(result.ok, true, 'La carga válida falló');
  assert.strictEqual(result.contentSummary, '2G 3D 2T', 'Confirmación no reutilizó el resumen');
  assert.strictEqual(result.total, 7, 'Resultado de carga no conserva total');
  assert.strictEqual(restocks.length, 3, 'Se duplicaron o perdieron movimientos');
  assert.deepStrictEqual(restocks.map(r=>r.qty), [2,3,2], 'Inventario no recibió cantidades legítimas');
  assert.ok(restocks.every(r=>r.meta && r.meta.source === 'lote'), 'Movimientos perdieron trazabilidad de lote');
  assert.strictEqual(storedLotes[0].notas, originalNote, 'La Nota original fue modificada');
  assert.strictEqual(storedLotes[0].status, 'EN_EVENTO', 'Lote no quedó asignado');
  const assignedPlan = context.__plan(storedLotes[0], products);
  assert.strictEqual(assignedPlan.summary, '', 'Un lote ya aplicado todavía se muestra como disponible');
  assert.strictEqual(assignedPlan.total, 0, 'Un lote ya aplicado conserva unidades cargables');
  assert.strictEqual(sharedSets.length, 1, 'Persistencia de lote ejecutada más de una vez');
  assert.strictEqual(toasts.at(-1).message, 'Lote aplicado: “A33XXXX” · 2G 3D 2T · 7 unidades', 'Mensaje posterior incorrecto');

  const before = restocks.length;
  const second = await context.__import({evId:7,loteId:'lot-1',loteCodigo:'A33XXXX'});
  assert.strictEqual(second.ok, false, 'Permitió aplicar el mismo lote dos veces');
  assert.strictEqual(second.reason, 'NOT_AVAILABLE', 'Segundo intento no fue bloqueado por disponibilidad');
  assert.strictEqual(restocks.length, before, 'Segundo intento duplicó movimientos');

  storedLotes.push({
    id:'lot-2', codigo:'A33UNO', createdAt:'2026-07-30T21:00:00.000Z', status:'DISPONIBLE', notas:'Nota singular',
    disponibilidadPOS:[{productId:'prod-t',Letra:'T',cantidadDisponible:1,cantidadProducida:1}]
  });
  const singular = await context.__import({evId:7,loteId:'lot-2',loteCodigo:'A33UNO'});
  assert.strictEqual(singular.ok, true, 'La carga singular falló');
  assert.strictEqual(singular.contentSummary, '1T', 'Resumen singular incorrecto');
  assert.strictEqual(toasts.at(-1).message, 'Lote aplicado: “A33UNO” · 1T · 1 unidad', 'Singular unidad incorrecto');

  assert.ok(html.includes('<th>Contenido</th>') && !html.includes('<th>Nota</th>'), 'Encabezado del selector incorrecto');
  assert.ok(html.includes('placeholder="Buscar por código…"'), 'El selector todavía expone búsqueda por Nota');
  assert.ok(css.includes('@media (max-width:820px)') && css.includes('content:"Contenido: ";'), 'Falta responsive iPad vertical/móvil');
  assert.ok(css.includes('.inv-lote-content-summary') && css.includes('word-break:keep-all') && css.includes('overflow-x:auto'), 'Contenido responsive puede partir valores o escapar del contenedor');
  assert.ok(release.includes('const rev = 4;'), 'Release general no fue coordinado');
  assert.ok(sw.includes("const MODULE_CACHE_REV = '45';"), 'Caché POS no fue incrementado');
  assert.ok(sw.includes("'./app.js?v=4.20.97&r=41'") && sw.includes("'./styles.css?v=4.20.97&r=21'"), 'Precache POS mezclado');
  assert.strictEqual(manifest.start_url, './index.html?v=4.20.97&r=29', 'Manifest no fue actualizado');
  assert.ok(!app.includes('localStorage.clear('), 'Se agregó borrado global de localStorage');
  assert.ok(!app.includes('indexedDB.deleteDatabase('), 'Se agregó borrado de IndexedDB');

  console.log('SMOKE OK — POS Inventario Agregar desde lote — Contenido por Letras');
})().catch(err=>{ console.error(err); process.exit(1); });
