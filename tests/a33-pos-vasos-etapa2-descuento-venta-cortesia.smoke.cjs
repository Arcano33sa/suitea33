'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'pos/index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'pos/sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'pos/manifest.webmanifest'), 'utf8'));

function between(source, startToken, endToken){
  const start = source.indexOf(startToken);
  assert.ok(start >= 0, `No se encontró ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(end > start, `No se encontró cierre para ${startToken}`);
  return source.slice(start, end);
}

const physicalBlock = between(
  app,
  "const POS_PHYSICAL_CUP_EFFECT_PREFIX = 'pos-vaso-fisico';",
  '// VASOS (Etapa 2/3): Auto-descuento de consumible "Vasos 12oz"'
);

// Contrato exacto por ID; no nombres, no Reempaque, no inventario paralelo.
assert.ok(app.includes('function productPhysicalCupInventoryIdPOS(product)'), 'Falta lector de vasoFisicoId en Producto');
assert.ok(app.includes('function salePhysicalCupInventoryIdPOS(sale)'), 'Falta snapshot del ID asociado en venta');
assert.ok(app.includes('vasoFisicoId: productSnap.vasoFisicoId'), 'La venta no guarda vasoFisicoId');
assert.ok(app.includes('physicalCupInventoryIdSnapshot: productSnap.physicalCupInventoryIdSnapshot'), 'Falta snapshot explícito del insumo');
assert.ok(app.includes('const cupResult = await ensurePhysicalCupConsumptionForSalePOS(saleRecord);'), 'La venta confirmada no aplica el consumo físico');
assert.ok(app.includes("await runStep('reconcilePhysicalCupConsumptions', reconcilePendingPhysicalCupConsumptionsPOS);"), 'Falta reconciliación al iniciar');
assert.ok(app.includes("window.addEventListener('online', run)"), 'Falta reconciliación tras reconexión');
assert.ok(app.includes("window.addEventListener('focus', run)"), 'Falta reconciliación tras recarga/foco');
assert.ok(app.includes("window.addEventListener('a33:cloud-sync-status', run)"), 'Falta reconciliación tras sync Firebase');
assert.ok(app.includes("window.addEventListener('a33:firebase-status', run)"), 'Falta reconciliación tras cambio Firebase');
assert.ok(!physicalBlock.includes('normName('), 'La identificación depende del nombre');
assert.ok(!physicalBlock.includes("includes('vaso')"), 'La identificación infiere Vaso por nombre');
assert.ok(!physicalBlock.includes('CAP_ITEM_VASOS12OZ_ID'), 'La lógica nueva usa Tapas Auto legacy');
assert.ok(!physicalBlock.includes('adjustVasos12ozStockFromPOS'), 'La lógica nueva llama el descuento legacy');
assert.ok(!physicalBlock.includes('reempaqueSaveRecordPOS') && !physicalBlock.includes('reempaqueApplyMovementPOS'), 'Reempaque quedó conectado al descuento físico');
assert.ok(physicalBlock.includes("item.stock = after;"), 'No descuenta Inventario Varios');
assert.ok(physicalBlock.includes("tipoItem: 'varios'"), 'La trazabilidad no usa el mecanismo de movimientos de Inventario Central');
assert.ok(physicalBlock.includes("state: 'APPLIED'"), 'Falta marca idempotente aplicada');
assert.ok(physicalBlock.includes("conflictPolicy:'block'"), 'Falta control de conflicto en almacenamiento compartido');
assert.ok(physicalBlock.includes("const after = before - qty"), 'No conserva política actual de stock negativo');
assert.ok(physicalBlock.includes('if (!sale || typeof sale !== \'object\' || sale.isExtra || sale.isReturn) return 0;'), 'Extras/devoluciones no están excluidos');

// El costo y la utilidad siguen usando el snapshot económico existente.
const saleCommit = between(app, 'async function addSale(){', 'async function addExtraSale(extraId)');
assert.ok(saleCommit.indexOf('saveSaleAndEventAtomicPOS') < saleCommit.indexOf('ensurePhysicalCupConsumptionForSalePOS(saleRecord)'), 'El vaso físico se descuenta antes del guardado principal');
assert.ok(saleCommit.includes('buildSaleEconomicSnapshotPOS({'), 'Se perdió el snapshot económico');
assert.ok(saleCommit.includes('createJournalEntryForSalePOS(saleRecord)'), 'Se perdió el flujo contable existente');
assert.ok(!physicalBlock.includes('unitCost') && !physicalBlock.includes('utilidad') && !physicalBlock.includes('costoAdicional'), 'El descuento físico altera costos/utilidad');

// Runtime aislado del motor idempotente.
let inventory = {
  liquids:{}, bottles:{}, finished:{}, finishedByProductId:{},
  varios:[
    { id:'vf-1', producto:'Vaso físico 12 oz', stock:10, minimo:4, createdAt:1 },
    { id:'vf-2', producto:'Otro insumo', stock:1, minimo:1, createdAt:2 }
  ],
  movimientos:[]
};
let rev = 1;
let conflictOnce = false;
const sales = new Map();

function clone(v){ return JSON.parse(JSON.stringify(v)); }
const storage = {
  sharedRead(){ return { data:clone(inventory), meta:{rev} }; },
  sharedSet(_key, value, opts){
    if (conflictOnce){ conflictOnce = false; return {ok:false, conflict:true}; }
    if (opts && opts.baseRev != null && Number(opts.baseRev) !== rev) return {ok:false, conflict:true};
    inventory = clone(value); rev += 1; return {ok:true, rev};
  },
  sharedGet(){ return clone(inventory); },
  getItem(){ return JSON.stringify(inventory); },
  setItem(_key, raw){ inventory = JSON.parse(raw); rev += 1; }
};

const sandbox = {
  window:{ A33Storage:storage, addEventListener(){}, A33_POS_PHYSICAL_CUPS:null },
  A33Storage:storage,
  STORAGE_KEY_INVENTARIO:'arcano33_inventario',
  invCentralDefaultPOS(){ return {liquids:{},bottles:{},finished:{},finishedByProductId:{},varios:[],movimientos:[]}; },
  invCentralLoadPOS(){ return clone(inventory); },
  db:{},
  async openDB(){ sandbox.db = {}; },
  async getAll(name){ return name === 'sales' ? Array.from(sales.values()).map(clone) : []; },
  async getOne(name, id){ return name === 'sales' && sales.has(id) ? clone(sales.get(id)) : null; },
  async getSaleByUidPOS(uid){ return Array.from(sales.values()).find(s => s.uid === uid) || null; },
  async put(name, value){ if (name === 'sales'){ sales.set(value.id, clone(value)); return value.id; } return value.id; },
  console,
  Date,
  Math,
  Number,
  String,
  Object,
  Array,
  JSON,
  Promise,
  setTimeout,
  clearTimeout
};
vm.createContext(sandbox);
vm.runInContext(physicalBlock + `\nthis.api={
  productPhysicalCupInventoryIdPOS,
  salePhysicalCupInventoryIdPOS,
  physicalCupQtyFromSalePOS,
  adjustPhysicalCupInventoryFromSalePOS,
  ensurePhysicalCupConsumptionForSalePOS,
  reconcilePendingPhysicalCupConsumptionsPOS
};`, sandbox);

(async()=>{
  const api = sandbox.api;

  // Venta de 1.
  const sale1 = {id:1, uid:'sale-1', eventId:7, qty:1, courtesy:false, isReturn:false, productName:'Nombre irrelevante', productSnapshot:{vasoFisicoId:'vf-1'}};
  sales.set(1, clone(sale1));
  let r = await api.ensurePhysicalCupConsumptionForSalePOS(sale1);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'applied');
  assert.strictEqual(inventory.varios.find(x=>x.id==='vf-1').stock, 9, 'Venta de 1 no descontó 1');
  assert.strictEqual(inventory.movimientos.length, 1, 'No registró movimiento mínimo');
  assert.strictEqual(sales.get(1).invEffects.physicalCup.itemId, 'vf-1', 'No guardó trazabilidad en venta');

  // Doble toque/reintento: no descuenta de nuevo.
  r = await api.ensurePhysicalCupConsumptionForSalePOS(sale1);
  assert.strictEqual(r.reason, 'already_applied');
  assert.strictEqual(inventory.varios.find(x=>x.id==='vf-1').stock, 9, 'Doble toque descontó dos veces');
  assert.strictEqual(inventory.movimientos.length, 1, 'Doble toque duplicó movimiento');

  // Venta de varias unidades con conflicto/reintento.
  conflictOnce = true;
  const sale2 = {id:2, uid:'sale-2', eventId:7, qty:5, courtesy:false, isReturn:false, physicalCupInventoryIdSnapshot:'vf-1'};
  sales.set(2, clone(sale2));
  r = await api.ensurePhysicalCupConsumptionForSalePOS(sale2);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(inventory.varios.find(x=>x.id==='vf-1').stock, 4, 'Venta de 5 no descontó 5');

  // Cortesía de varias unidades, ingreso/costos no forman parte del movimiento físico.
  const courtesy = {id:3, uid:'sale-3', eventId:7, qty:2, courtesy:true, total:0, isReturn:false, productSnapshot:{vasoFisicoId:'vf-1'}, costPerUnit:33, utilidad:-66};
  sales.set(3, clone(courtesy));
  r = await api.ensurePhysicalCupConsumptionForSalePOS(courtesy);
  assert.strictEqual(inventory.varios.find(x=>x.id==='vf-1').stock, 2, 'Cortesía de 2 no descontó 2');
  const courtesyMov = inventory.movimientos.find(m=>m.sourceId && m.sourceId.includes('sale-3'));
  assert.strictEqual(courtesyMov.tipoMovimiento, 'salida_cortesia_pos');
  assert.ok(!Object.prototype.hasOwnProperty.call(courtesyMov, 'costPerUnit'), 'Movimiento físico copió costo');
  assert.ok(!Object.prototype.hasOwnProperty.call(courtesyMov, 'utilidad'), 'Movimiento físico copió utilidad');

  // Cortesía de 1 unidad.
  const courtesyOne = {id:30, uid:'sale-30', eventId:7, qty:1, courtesy:true, total:0, isReturn:false, productSnapshot:{vasoFisicoId:'vf-1'}};
  sales.set(30, clone(courtesyOne));
  r = await api.ensurePhysicalCupConsumptionForSalePOS(courtesyOne);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(inventory.varios.find(x=>x.id==='vf-1').stock, 1, 'Cortesía de 1 no descontó 1');

  // Otro producto/sin asociación: no aplica.
  const other = {id:4, uid:'sale-4', eventId:7, qty:3, courtesy:false, isReturn:false, productName:'Vaso por nombre solamente', productSnapshot:{}};
  r = await api.ensurePhysicalCupConsumptionForSalePOS(other);
  assert.strictEqual(r.reason, 'no_association');
  assert.strictEqual(inventory.varios.find(x=>x.id==='vf-1').stock, 1, 'Se aplicó por nombre sin asociación');

  // Asociación inexistente: no inventa línea ni asociación histórica.
  const missing = {id:5, uid:'sale-5', eventId:7, qty:1, courtesy:false, isReturn:false, productSnapshot:{vasoFisicoId:'vf-no-existe'}};
  r = await api.ensurePhysicalCupConsumptionForSalePOS(missing);
  assert.strictEqual(r.reason, 'item_missing');
  assert.strictEqual(inventory.varios.some(x=>x.id==='vf-no-existe'), false, 'Creó un insumo inexistente');

  // Stock insuficiente: conserva política actual y permite negativo.
  const low = {id:6, uid:'sale-6', eventId:7, qty:3, courtesy:false, isReturn:false, productSnapshot:{vasoFisicoId:'vf-2'}};
  sales.set(6, clone(low));
  r = await api.ensurePhysicalCupConsumptionForSalePOS(low);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(inventory.varios.find(x=>x.id==='vf-2').stock, -2, 'Cambió la política de stock insuficiente');

  // Devolución y Extra no consumen Vaso físico en Etapa 2.
  const beforeSkip = inventory.varios.find(x=>x.id==='vf-1').stock;
  r = await api.ensurePhysicalCupConsumptionForSalePOS({id:7,uid:'sale-7',qty:-1,isReturn:true,productSnapshot:{vasoFisicoId:'vf-1'}});
  assert.strictEqual(r.reason, 'not_consumable_sale');
  r = await api.ensurePhysicalCupConsumptionForSalePOS({id:8,uid:'sale-8',qty:1,isExtra:true,productSnapshot:{vasoFisicoId:'vf-1'}});
  assert.strictEqual(r.reason, 'not_consumable_sale');
  assert.strictEqual(inventory.varios.find(x=>x.id==='vf-1').stock, beforeSkip);

  // Recarga/JSON/Firebase: reconciliar registros con snapshot no duplica los ya aplicados.
  const pending = {id:9, uid:'sale-9', eventId:7, qty:1, courtesy:false, isReturn:false, productSnapshot:{vasoFisicoId:'vf-1'}};
  sales.set(9, clone(pending));
  const jsonRoundtrip = JSON.parse(JSON.stringify({inventory, sales:Array.from(sales.values())}));
  assert.ok(jsonRoundtrip.inventory.movimientos.some(m=>m.state==='APPLIED'), 'JSON perdió trazabilidad');
  const stockBeforeReconcile = inventory.varios.find(x=>x.id==='vf-1').stock;
  const rec = await api.reconcilePendingPhysicalCupConsumptionsPOS();
  assert.strictEqual(rec.ok, true);
  assert.strictEqual(inventory.varios.find(x=>x.id==='vf-1').stock, stockBeforeReconcile - 1, 'Reconciliación no aplicó pendiente exactamente una vez');
  const movCount = inventory.movimientos.length;
  await api.reconcilePendingPhysicalCupConsumptionsPOS();
  assert.strictEqual(inventory.movimientos.length, movCount, 'Recarga/Firebase duplicó movimientos');

  // PWA coordinada para el módulo POS.
  assert.ok(html.includes('app.js?v=4.20.97&r=46'), 'HTML no carga app.js Etapa 2');
  assert.ok(html.includes('manifest.webmanifest?v=4.20.97&r=26'), 'HTML no carga manifest vigente');
  assert.ok(html.includes("-pos-r'+rev+'-m50"), 'HTML no expone cache POS m50');
  assert.ok(sw.includes("const MODULE_CACHE_REV = '50';"), 'SW no incrementó cache POS');
  assert.ok(sw.includes("'./index.html?v=4.20.97&r=33'"), 'SW no precachea HTML vigente');
  assert.ok(sw.includes("'./app.js?v=4.20.97&r=46'"), 'SW no precachea JS vigente');
  assert.ok(sw.includes("'./manifest.webmanifest?v=4.20.97&r=26'"), 'SW no precachea manifest vigente');
  assert.strictEqual(manifest.start_url, './index.html?v=4.20.97&r=33');

  // Navegación offline: el SW vigente recupera el índice precacheado.
  const urlsMatch = sw.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  assert.ok(urlsMatch, 'No se encontró PRECACHE_URLS');
  const precacheUrls = Array.from(urlsMatch[1].matchAll(/'([^']+)'/g), match => match[1]);
  for (const url of precacheUrls){
    const clean = url.split('?')[0];
    let target = null;
    if (clean === './') target = path.join(root, 'pos');
    else if (clean.startsWith('./')) target = path.join(root, 'pos', clean.slice(2));
    else if (clean.startsWith('/assets/')) target = path.join(root, clean.slice(1));
    if (target) assert.ok(fs.existsSync(target), `Asset PWA inexistente: ${url}`);
  }
  const navStart = sw.indexOf('async function handleNavigate(request)');
  const navEnd = sw.indexOf('async function handleAsset(request)', navStart);
  assert.ok(navStart >= 0 && navEnd > navStart, 'No se pudo aislar handleNavigate');
  const cachedIndex = {kind:'cached-index-etapa2'};
  const swSandbox = {
    CACHE_NAME:'a33-v4.20.97-pos-r1-m50',
    fetch:async()=>{ throw new Error('offline'); },
    caches:{open:async()=>({
      match:async key => String(key) === './index.html?v=4.20.97&r=33' ? cachedIndex : null,
      put:async()=>true
    })},
    Response:class Response {
      constructor(body, init){ this.body=body; this.status=init && init.status; this.headers=init && init.headers; }
    }
  };
  vm.createContext(swSandbox);
  vm.runInContext(`${sw.slice(navStart, navEnd)}\nthis.handleNavigate = handleNavigate;`, swSandbox);
  const offlineResult = await swSandbox.handleNavigate({url:'https://suitea33.test/pos/ventas'});
  assert.strictEqual(offlineResult, cachedIndex, 'La navegación offline no recupera el índice vigente');

  // Regresión estructural crítica.
  for (const token of [
    'async function renderInventario',
    'async function reverseAssignSelectedLotePOS',
    'async function createSobranteLotPOS',
    'async function reempaqueSaveRecordPOS',
    'async function normalizeVasoProductForReempaquePOS',
    'async function createJournalEntryForSalePOS',
    'async function saveSaleAndEventAtomicPOS'
  ]) assert.ok(app.includes(token), `Regresión: falta ${token}`);

  console.log('SMOKE OK — Suite A33 — POS Vasos — Etapa 2/4 — descuento venta/cortesía idempotente');
})().catch((error)=>{
  console.error(error);
  process.exitCode = 1;
});
