'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'pos/index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'pos/sw.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pos/styles.css'), 'utf8');
const backup = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
const cloud = fs.readFileSync(path.join(root, 'assets/js/a33-cloud-sync.js'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'assets/js/a33-storage.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'pos/manifest.webmanifest'), 'utf8'));

function between(source, startToken, endToken){
  const start = source.indexOf(startToken);
  assert.ok(start >= 0, `No se encontró ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(end > start, `No se encontró cierre para ${startToken}`);
  return source.slice(start, end);
}

function clone(value){ return JSON.parse(JSON.stringify(value)); }

// 1) Clasificación moderna/legacy aislada.
const classificationBlock = between(
  app,
  'function saleVasoClassSnapshotPOS(sale)',
  'async function getEventByIdPOS(eventId)'
);
const classSandbox = {
  saleStableProductIdPOS(sale){
    const raw = sale && (sale.productId ?? sale.productoId ?? (sale.productSnapshot && sale.productSnapshot.productId));
    return String(raw == null ? '' : raw).trim();
  },
  salePhysicalCupInventoryIdPOS(sale){
    const snap = sale && sale.productSnapshot && typeof sale.productSnapshot === 'object' ? sale.productSnapshot : {};
    return String(sale && (sale.physicalCupInventoryIdSnapshot ?? sale.vasoFisicoId ?? snap.vasoFisicoId ?? snap.physicalCupInventoryId) || '').trim();
  },
  saleProductIdForInventoryPOS(sale){
    const raw = sale && (sale.productId ?? sale.productoId ?? (sale.productSnapshot && sale.productSnapshot.productId));
    const value = String(raw == null ? '' : raw).trim();
    return value || null;
  },
  Array, String, Object
};
vm.createContext(classSandbox);
vm.runInContext(`${classificationBlock}\nthis.api={saleVasoClassSnapshotPOS,isModernVasoSalePOS,isLegacyCupSaleRecordPOS,isVasoCategorySalePOS,isCupSaleRecord,isLegacyCupCostFallbackSalePOS};`, classSandbox);
const cls = classSandbox.api;

const modern = {id:1, productId:'prd_moderno_1', productName:'Nombre arbitrario', physicalCupInventoryIdSnapshot:'varios-cup-1', qty:2};
assert.strictEqual(cls.isModernVasoSalePOS(modern), true, 'Vaso moderno no reconocido por contrato estable');
assert.strictEqual(cls.isLegacyCupSaleRecordPOS(modern), false, 'Vaso moderno activó legacy');
assert.strictEqual(cls.isVasoCategorySalePOS(modern), true, 'Vaso moderno no entra en categoría Vasos');

const hybrid = {...modern, vaso:true, fifoBreakdown:[{batchId:'old', cupsTaken:2}]};
assert.strictEqual(cls.isModernVasoSalePOS(hybrid), true, 'Registro híbrido perdió ruta moderna');
assert.strictEqual(cls.isLegacyCupSaleRecordPOS(hybrid), false, 'Registro híbrido activa moderno y legacy');
assert.strictEqual(cls.isCupSaleRecord(hybrid), false, 'Alias legacy permite doble reverso');

const legacy = {id:2, vaso:true, fifoBreakdown:[{batchId:'legacy', cupsTaken:1}], qty:1};
assert.strictEqual(cls.isModernVasoSalePOS(legacy), false, 'Histórico legacy fue convertido a moderno');
assert.strictEqual(cls.isLegacyCupSaleRecordPOS(legacy), true, 'Histórico legacy dejó de reconocerse');
assert.strictEqual(cls.isVasoCategorySalePOS(legacy), true, 'Histórico legacy no aparece en categoría Vasos');

const nameOnly = {id:3, productId:'prd_otro', productName:'Vaso por nombre solamente', productSnapshot:{}, qty:1};
assert.strictEqual(cls.isModernVasoSalePOS(nameOnly), false, 'Clasificación moderna depende solo del nombre');
assert.strictEqual(cls.isVasoCategorySalePOS(nameOnly), false, 'Producto sin contrato fue convertido a Vaso');

// 2) Snapshot estable en ventas nuevas.
const snapshotBlock = between(app, 'function buildSaleProductSnapshotPOS(product, selectedUnitPrice)', 'function getSaleProductNameSnapshotPOS(sale)');
const snapshotSandbox = {
  catalogProductStableIdPOS:p=>String(p.productId || ''),
  catalogProductSnapshotNamePOS:p=>String(p.name || ''),
  catalogProductSnapshotPricePOS:(p, selected)=>Number.isFinite(Number(selected)) ? Number(selected) : Number(p.price || 0),
  getProductStoredUnitCostPOS:p=>Number(p.unitCost || 0),
  catalogProductInternalIdPOS:p=>Number(p.id || 0) || null,
  productPhysicalCupInventoryIdPOS:p=>String(p.vasoFisicoId || ''),
  productManageStockForSalePOS:()=>true,
  productActiveForSalePOS:()=>true,
  productPosEnabledForSalePOS:()=>true,
  boolCatalogFlagPOS:v=>!!v,
  presKeyFromProductNamePOS:()=>'',
  round2:n=>Math.round(Number(n || 0) * 100) / 100,
  Date, Number, String
};
vm.createContext(snapshotSandbox);
vm.runInContext(`${snapshotBlock}\nthis.buildSaleProductSnapshotPOS=buildSaleProductSnapshotPOS;`, snapshotSandbox);
const snapModern = snapshotSandbox.buildSaleProductSnapshotPOS({id:7, productId:'prd_7', name:'Cualquier nombre', price:120, unitCost:11, vasoFisicoId:'vf-7'}, 120);
assert.strictEqual(snapModern.productClassSnapshot, 'vaso');
assert.strictEqual(snapModern.productSnapshot.productClass, 'vaso');
assert.strictEqual(snapModern.productSnapshot.presentationClass, 'vaso');
assert.strictEqual(snapModern.productSnapshot.vasoFisicoId, 'vf-7');
const snapNoAssociation = snapshotSandbox.buildSaleProductSnapshotPOS({id:8, productId:'prd_8', name:'Vaso', price:120, unitCost:11}, 120);
assert.strictEqual(snapNoAssociation.productClassSnapshot, '', 'Nombre Vaso creó clasificación sin asociación');

assert.ok(app.includes('productClassSnapshot: productSnap.productClassSnapshot'), 'La venta no congela la clase moderna');
assert.ok(app.includes('if (isVasoCategorySalePOS(s)) {\n      cortesiasVasosU'), 'Cortesías modernas no se clasifican como Vasos');

// 3) Finanzas usa identidad estable para Vaso, no texto solamente.
const financeBlock = between(app, 'function posFinProductKeyPOS(productRef)', 'function posFinResolveCourtesyExpenseAccountPOS(accounts)');
const financeSandbox = {
  isVasoCategorySalePOS:s=>cls.isVasoCategorySalePOS(s),
  getSaleProductNameSnapshotPOS:s=>String(s.productNameSnapshot || s.productName || ''),
  posFinNormText:value=>String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),
  posFinResolvePostableAccountPOS:()=>'',
  String, Object
};
vm.createContext(financeSandbox);
vm.runInContext(`${financeBlock}\nthis.posFinProductKeyPOS=posFinProductKeyPOS;`, financeSandbox);
assert.strictEqual(financeSandbox.posFinProductKeyPOS(modern), 'vaso', 'Finanzas no reconoce Vaso moderno estable');
assert.strictEqual(financeSandbox.posFinProductKeyPOS(legacy), 'vaso', 'Finanzas perdió Vaso legacy');
assert.strictEqual(financeSandbox.posFinProductKeyPOS(nameOnly), '', 'Finanzas clasifica Vaso moderno solo por nombre');
assert.strictEqual(financeSandbox.posFinProductKeyPOS({productId:'prd_p', productName:'Pulso 250 ml'}), 'pulso', 'Se rompió clasificación histórica de presentaciones');

// 4) Consumo/restauración física exactos e idempotentes.
const physicalBlock = between(
  app,
  "const POS_PHYSICAL_CUP_EFFECT_PREFIX = 'pos-vaso-fisico';",
  '// VASOS (Etapa 2/3): Auto-descuento de consumible "Vasos 12oz"'
);
let inventory = {
  liquids:{}, bottles:{}, finished:{}, finishedByProductId:{},
  varios:[{id:'vf-1', producto:'Vaso físico', stock:20, minimo:5}],
  movimientos:[]
};
let rev = 1;
const sales = new Map();
const a33Storage = {
  sharedRead(){ return {data:clone(inventory), meta:{rev}}; },
  sharedSet(_key, value, opts){
    if (opts && opts.baseRev != null && Number(opts.baseRev) !== rev) return {ok:false, conflict:true};
    inventory = clone(value); rev += 1; return {ok:true, rev};
  },
  sharedGet(){ return clone(inventory); },
  getItem(){ return JSON.stringify(inventory); },
  setItem(_key, raw){ inventory = JSON.parse(raw); rev += 1; return true; }
};
const physicalSandbox = {
  window:{A33Storage:a33Storage, addEventListener(){}, A33_POS_PHYSICAL_CUPS:null},
  A33Storage:a33Storage,
  STORAGE_KEY_INVENTARIO:'arcano33_inventario',
  invCentralDefaultPOS(){ return {liquids:{},bottles:{},finished:{},finishedByProductId:{},varios:[],movimientos:[]}; },
  invCentralLoadPOS(){ return clone(inventory); },
  db:{},
  async openDB(){ physicalSandbox.db = {}; },
  async getAll(name){ return name === 'sales' ? Array.from(sales.values()).map(clone) : []; },
  async getOne(name, id){ return name === 'sales' && sales.has(id) ? clone(sales.get(id)) : null; },
  async getSaleByUidPOS(uid){ return Array.from(sales.values()).find(s=>s.uid===uid) || null; },
  async put(name, value){ if (name === 'sales') sales.set(value.id, clone(value)); return value.id; },
  console, Date, Math, Number, String, Object, Array, JSON, Promise, setTimeout, clearTimeout
};
vm.createContext(physicalSandbox);
vm.runInContext(`${physicalBlock}\nthis.api={ensurePhysicalCupConsumptionForSalePOS,restorePhysicalCupInventoryFromSalePOS,reconcilePendingPhysicalCupConsumptionsPOS,physicalCupEffectTraceFromSalePOS};`, physicalSandbox);

(async()=>{
  const physical = physicalSandbox.api;
  const sale = {id:10,uid:'sale-modern-10',eventId:3,productId:'prd_moderno',productName:'Sin depender del nombre',physicalCupInventoryIdSnapshot:'vf-1',productClassSnapshot:'vaso',qty:3,courtesy:false,isReturn:false,vaso:true,fifoBreakdown:[{batchId:'legacy',cupsTaken:3}]};
  sales.set(sale.id, clone(sale));
  let r = await physical.ensurePhysicalCupConsumptionForSalePOS(sale);
  assert.strictEqual(r.reason, 'applied');
  assert.strictEqual(inventory.varios[0].stock, 17, 'Venta múltiple no descontó exacto');
  assert.strictEqual(inventory.movimientos.filter(m=>m.state==='APPLIED').length, 1, 'Movimiento aplicado duplicado');
  r = await physical.ensurePhysicalCupConsumptionForSalePOS(sale);
  assert.strictEqual(r.reason, 'already_applied');
  assert.strictEqual(inventory.varios[0].stock, 17, 'Reintento descontó doble');
  r = physical.restorePhysicalCupInventoryFromSalePOS(sale);
  assert.strictEqual(r.reason, 'restored');
  assert.strictEqual(inventory.varios[0].stock, 20, 'Reverso no restauró exacto');
  r = physical.restorePhysicalCupInventoryFromSalePOS(sale);
  assert.strictEqual(r.reason, 'already_restored');
  assert.strictEqual(inventory.varios[0].stock, 20, 'Reverso duplicado restauró dos veces');

  const courtesy = {id:11,uid:'courtesy-11',eventId:3,productId:'prd_moderno',physicalCupInventoryIdSnapshot:'vf-1',productClassSnapshot:'vaso',qty:2,courtesy:true,isReturn:false};
  sales.set(courtesy.id, clone(courtesy));
  r = await physical.ensurePhysicalCupConsumptionForSalePOS(courtesy);
  assert.strictEqual(inventory.varios[0].stock, 18, 'Cortesía no descontó físico');
  const courtesyMove = inventory.movimientos.find(m=>m.sourceId && m.sourceId.includes('courtesy-11'));
  assert.strictEqual(courtesyMove.tipoMovimiento, 'salida_cortesia_pos');
  r = physical.restorePhysicalCupInventoryFromSalePOS(courtesy);
  assert.strictEqual(inventory.varios[0].stock, 20, 'Reverso de cortesía no restauró');

  const noAssociation = {id:12,uid:'name-only',eventId:3,productId:'prd_otro',productName:'Vaso',qty:4,courtesy:false,isReturn:false};
  r = await physical.ensurePhysicalCupConsumptionForSalePOS(noAssociation);
  assert.strictEqual(r.reason, 'no_association');
  assert.strictEqual(inventory.varios[0].stock, 20, 'Producto sin asociación consumió físico');

  // JSON roundtrip conserva asociación, trazabilidad y no repite movimientos.
  const roundtrip = JSON.parse(JSON.stringify({inventory, sales:Array.from(sales.values())}));
  assert.ok(roundtrip.sales.some(s=>s.productClassSnapshot==='vaso'));
  assert.ok(roundtrip.sales.some(s=>s.invEffects && s.invEffects.physicalCup));
  const beforeReconcile = inventory.movimientos.length;
  const rec = await physical.reconcilePendingPhysicalCupConsumptionsPOS();
  assert.strictEqual(rec.ok, true);
  await physical.reconcilePendingPhysicalCupConsumptionsPOS();
  assert.strictEqual(inventory.movimientos.length, beforeReconcile, 'Recarga/sync repitió consumo o reverso');

  // 5) Costos: Reempaque es fuente principal frente al costo de catálogo; jamás se suman.
  const costBlock = between(app, 'async function resolveSaleUnitCostPOS(', 'function reempaqueMovementErrorPOS(msg)');
  const pReempaque = costBlock.indexOf("source: 'reempaque'");
  const pProduct = costBlock.indexOf("source: 'producto_catalogo'");
  assert.ok(pReempaque >= 0 && pProduct > pReempaque, 'Prioridad Reempaque → catálogo cambió');
  assert.ok(costBlock.includes('if (fromReempaque > 0) return'), 'Reempaque dejó de ser retorno exclusivo');
  assert.ok(costBlock.includes('if (fromProduct > 0) return'), 'Costo unitario de catálogo dejó de ser respaldo');
  assert.ok(!/fromReempaque\s*\+\s*fromProduct|fromProduct\s*\+\s*fromReempaque/.test(costBlock), 'Se están sumando ambos costos');
  assert.ok(!physicalBlock.includes('unitCost') && !physicalBlock.includes('costoAdicional') && !physicalBlock.includes('createJournalEntry'), 'Vaso físico creó costo/asiento separado');
  const reempaqueBlock = between(app, 'function reempaqueMovementErrorPOS(msg)', 'async function renderReempaqueHistoryPOS(eventId)');
  assert.ok(!reempaqueBlock.includes('ensurePhysicalCupConsumptionForSalePOS'), 'Reempaque consume Vaso físico');
  assert.ok(!reempaqueBlock.includes('adjustPhysicalCupInventoryFromSalePOS'), 'Reempaque altera Inventario Varios físico');

  // 6) Legacy aislado y sin migración destructiva.
  assert.ok(app.includes('const batches = sanitizeFractionBatches(ev.fractionBatches);'), 'Se eliminó lectura histórica fractionBatches');
  assert.ok(app.includes('Array.isArray(sale.fifoBreakdown)'), 'Se eliminó compatibilidad fifoBreakdown');
  assert.ok(app.includes("const CAP_ITEM_VASOS12OZ_ID = 'vasos12oz';"), 'Se borró compatibilidad Vasos 12oz');
  assert.ok(app.includes('if (sale && isCupSaleRecord(sale))'), 'Reverso legacy perdió su guardia exclusiva');
  assert.ok(app.includes('if (!sale || !isCupSaleRecord(sale)) return;'), 'FIFO legacy puede ejecutarse en venta moderna');

  // 7) JSON/Firebase: bloques completos, IDs y asociación intactos; ventas/inventario no se sincronizan por Firebase.
  assert.ok(backup.includes('async function buildFullBackup()'), 'Falta respaldo completo');
  assert.ok(backup.includes('indexedDB: cleanIndexed.data') && backup.includes('localStorage: fullLocalStorage'), 'El respaldo no conserva IndexedDB + localStorage completos');
  assert.ok(backup.includes('remapProductReferences'), 'Importación no protege referencias productId');
  assert.ok(backup.includes('Los datos no incluidos se conservaron'), 'Importación parcial no declara conservación');
  assert.ok(storage.includes('const out = productClone(src) || {};'), 'Normalización de Productos no preserva campos íntegros');
  assert.ok(!/delete out\.vasoFisicoId/.test(storage), 'Normalización elimina asociación vasoFisicoId');
  assert.ok(cloud.includes("{ id: 'productos', store: 'products'"), 'Firebase no sincroniza Productos');
  assert.ok(cloud.includes("excluded: ['ventas', 'eventos', 'caja_chica', 'cierres', 'finanzas', 'asientos', 'recibos', 'inventario_evento', 'reempaques_historicos', 'pedidos_historicos', 'saldos']"), 'Firebase cambió alcance local-first y puede repetir movimientos');

  // 8) PWA/offline y responsive.
  assert.ok(html.includes('app.js?v=4.20.97&r=48'), 'HTML no carga app Etapa 4');
  assert.ok(html.includes("-pos-r'+rev+'-m52"), 'HTML no expone cache POS m52');
  assert.ok(sw.includes("const MODULE_CACHE_REV = '52';"), 'SW no incrementó cache POS');
  assert.ok(sw.includes("'./app.js?v=4.20.97&r=48'"), 'SW no precachea JS vigente');
  assert.strictEqual(manifest.start_url, './index.html?v=4.20.97&r=33');
  assert.ok(/body\s*\{[^}]*overflow-x\s*:\s*hidden/i.test(css), 'Puede aparecer scroll horizontal general');
  assert.ok(css.includes('@media (max-width: 820px)') || css.includes('@media (max-width:820px)'), 'Falta adaptación iPad');
  assert.ok(css.includes('@media (max-width: 520px)') || css.includes('@media (max-width:520px)'), 'Falta adaptación móvil');

  const urlsMatch = sw.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  assert.ok(urlsMatch, 'No se encontró PRECACHE_URLS');
  const urls = Array.from(urlsMatch[1].matchAll(/'([^']+)'/g), m=>m[1]);
  for (const url of urls){
    const clean = url.split('?')[0];
    let target = null;
    if (clean === './') target = path.join(root, 'pos');
    else if (clean.startsWith('./')) target = path.join(root, 'pos', clean.slice(2));
    else if (clean.startsWith('/assets/')) target = path.join(root, clean.slice(1));
    if (target) assert.ok(fs.existsSync(target), `Asset PWA inexistente: ${url}`);
  }
  const navStart = sw.indexOf('async function handleNavigate(request)');
  const navEnd = sw.indexOf('async function handleAsset(request)', navStart);
  const cachedIndex = {kind:'cached-index-etapa4'};
  const swSandbox = {
    CACHE_NAME:'a33-v4.20.97-pos-r5-m52',
    fetch:async()=>{ throw new Error('offline'); },
    caches:{open:async()=>({
      match:async key=>String(key)==='./index.html?v=4.20.97&r=33' ? cachedIndex : null,
      put:async()=>true
    })},
    Response:class Response { constructor(body, init){ this.body=body; this.status=init && init.status; this.headers=init && init.headers; } }
  };
  vm.createContext(swSandbox);
  vm.runInContext(`${sw.slice(navStart, navEnd)}\nthis.handleNavigate=handleNavigate;`, swSandbox);
  const offline = await swSandbox.handleNavigate({url:'https://suitea33.test/pos/ventas'});
  assert.strictEqual(offline, cachedIndex, 'Offline no recupera índice vigente');

  // 9) Regresión estructural crítica.
  for (const token of [
    'async function renderInventario',
    'async function reverseAssignSelectedLotePOS',
    'async function createSobranteLotPOS',
    'async function reempaqueSaveRecordPOS',
    'async function normalizeVasoProductForReempaquePOS',
    'async function createJournalEntryForSalePOS',
    'async function saveSaleAndEventAtomicPOS',
    'async function exportEventExcel',
    'async function renderSummary'
  ]) assert.ok(app.includes(token), `Regresión: falta ${token}`);

  console.log('SMOKE OK — Suite A33 — POS Vasos — Etapa 4/4 — clasificación, históricos y hardening final');
})().catch((error)=>{
  console.error(error);
  process.exitCode = 1;
});
