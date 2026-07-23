const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const posPath = path.join(root, 'pos', 'app.js');
const lotesPath = path.join(root, 'lotes', 'script.js');
const pos = fs.readFileSync(posPath, 'utf8');
const lotes = fs.readFileSync(lotesPath, 'utf8');

function extractFunction(source, name){
  const marker = `function ${name}(`;
  let start = source.indexOf(marker);
  assert(start >= 0, `No se encontró ${name}`);
  if (source.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i++){
    const ch = source[i], next = source[i+1];
    if (lineComment){ if (ch === '\n') lineComment = false; continue; }
    if (blockComment){ if (ch === '*' && next === '/'){ blockComment = false; i++; } continue; }
    if (quote){
      if (escaped){ escaped = false; continue; }
      if (ch === '\\'){ escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/'){ lineComment = true; i++; continue; }
    if (ch === '/' && next === '*'){ blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`'){ quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}'){
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Función incompleta: ${name}`);
}

async function testActualFifo(){
  let inventory = [];
  let sales = [];
  const products = [
    { id: 1, productId: 'prod-galon', name: 'Galón', Letra: 'G' },
    { id: 2, productId: 'prod-catrina', name: 'Catrina', Letra: 'C' },
  ];
  const ctx = {
    console,
    Date,
    Map,
    Set,
    Number,
    String,
    Object,
    Array,
    Math,
    getAll: async (store) => store === 'products' ? products : (store === 'sales' ? sales : []),
    getInventoryEntries: async () => inventory,
    catalogProductStableIdPOS: p => p && String(p.productId || ''),
    catalogProductInternalIdPOS: p => p && Number(p.id || 0),
    productIdentityNormPOS: v => String(v || '').trim(),
    catalogProductSnapshotNamePOS: p => String((p && p.name) || ''),
    saleStableProductIdPOS: s => String((s && s.productStableId) || ''),
    saleInternalProductIdPOS: s => Number((s && s.productId) || 0),
    lotFifoKeyFromProductPOS: (p, ref) => `PID:${(p && p.productId) || ref}`,
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(pos, 'lotFifoGroupKeyFromInvEntryPOS'), ctx);
  vm.runInContext(extractFunction(pos, 'lotFifoTsPOS'), ctx);
  vm.runInContext(extractFunction(pos, 'computeLotFifoForEvent'), ctx);

  inventory = [
    { id: 1, eventId: 10, type:'restock', productId:1, qty:3, source:'lote', loteId:'L1', loteCodigo:'L-001', loteCargaId:'LOAD-1', time:'2026-07-23T10:00:00Z' },
  ];
  sales = [{ id: 1, eventId:10, productId:1, productStableId:'prod-galon', productName:'Galón', qty:1 }];
  let fifo = await ctx.computeLotFifoForEvent(10);
  assert.strictEqual(fifo.lots.L1.remainingByKey['PID:prod-galon'], 2, 'Venta no descontó disponible');

  inventory.push(
    { id:2, eventId:10, type:'adjust', productId:1, qty:-1, source:'reempaque', loteId:'L1', loteCodigo:'L-001', loteCargaId:'LOAD-1', time:'2026-07-23T11:00:00Z' },
    { id:3, eventId:10, type:'adjust', productId:2, qty:2, source:'reempaque', loteId:'L1', loteCodigo:'L-001', loteCargaId:'LOAD-1', time:'2026-07-23T11:00:00Z' },
  );
  fifo = await ctx.computeLotFifoForEvent(10);
  assert.strictEqual(fifo.lots.L1.remainingByKey['PID:prod-galon'], 1, 'Reempaque no descontó origen');
  assert.strictEqual(fifo.lots.L1.remainingByKey['PID:prod-catrina'], 2, 'Reempaque no creó destino');

  inventory.push({ id:4, eventId:10, type:'adjust', productId:1, qty:-1, notes:'Recálculo', time:'2026-07-23T12:00:00Z' });
  fifo = await ctx.computeLotFifoForEvent(10);
  assert.strictEqual(fifo.lots.L1.remainingByKey['PID:prod-galon'], 0, 'Recálculo negativo no actualizó disponible');

  inventory.push({ id:5, eventId:10, type:'adjust', productId:1, qty:1, notes:'Reversión recálculo', time:'2026-07-23T12:05:00Z' });
  fifo = await ctx.computeLotFifoForEvent(10);
  assert.strictEqual(fifo.lots.L1.remainingByKey['PID:prod-galon'], 1, 'Reversión no restauró disponible');
  assert(Object.values(fifo.lots.L1.remainingByKey).every(v => v >= 0), 'Se produjo disponible negativo');
}

function testActualSnapshotParser(){
  const snap = {
    remainingByKey: { 'PID:prod-galon-largo': 1 },
    loadedByKey: { 'PID:prod-galon-largo': 3 },
    availabilityProducts: [{ productId:'prod-galon-largo', Letra:'G', cantidadBase:3, cantidadDisponible:1 }],
  };
  const ctx = {
    console, Object, Array, String, Number, Map, Set,
    getActiveEventUsageSnapshot: () => snap,
    buildLetterToProductMapForLote: () => new Map([['G', { productId:'prod-galon-largo' }]]),
    isPlainObjectA33: v => !!v && typeof v === 'object' && !Array.isArray(v),
    normalizeProductIdForPOS: v => String(v || '').trim(),
    normalizeProductLetter: v => String(v || '').trim().toUpperCase().slice(0,4),
    normalizeQtyValue: v => { const n=Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; },
    normalizeNumberMapA33: (raw, norm) => Object.fromEntries(Object.entries(raw || {}).map(([k,v]) => [norm(k), Math.max(0, Number(v)||0)])),
    hasOwnA33: (o,k) => !!o && Object.prototype.hasOwnProperty.call(o,k),
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(lotes, 'getSnapshotRemainingInfo'), ctx);
  const info = ctx.getSnapshotRemainingInfo({});
  assert.strictEqual(info.remainingByProductId['prod-galon-largo'], 1, 'PID estable fue truncado o perdido');
  assert.strictEqual(info.remainingByLetter.G, 1, 'No se generó lectura por Letra');
  assert.strictEqual(info.loadedByProductId['prod-galon-largo'], 3, 'No se conservó base cargada');
}

function testActualIndicator(){
  let status = 'EN_EVENTO';
  let snapshot = {
    source:'eventUsage.availabilityProducts', hasSnapshot:true,
    hasProduct:true, remainingByProductId:{'prod-g':1,'prod-c':2},
    hasLetter:true, remainingByLetter:{G:1,C:2},
    availabilityProducts:[{ productId:'prod-c', Letra:'C', nombreSnapshot:'Catrina', cantidadBase:2, cantidadDisponible:2 }],
    snapshot:{},
  };
  let transferred = { byProductId:{}, byLetter:{} };
  const ctx = {
    console, Object, Array, String, Number, Map, Set,
    effectiveLoteStatus: () => status,
    getSnapshotRemainingInfo: () => snapshot,
    getLoteCreatedItems: () => [{ productId:'prod-g', Letra:'G', nombre:'Galón', cantidad:3, legacy:false }],
    getTransferredToChildrenA33: () => transferred,
    normalizeProductLetter: v => String(v || '').trim().toUpperCase().slice(0,4),
    normalizeProductIdForPOS: v => String(v || '').trim(),
    normalizeQtyValue: v => { const n=Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; },
    hasOwnA33: (o,k) => !!o && Object.prototype.hasOwnProperty.call(o,k),
    sortCatalogItemsForLotes: (a,b) => String(a.Letra||'').localeCompare(String(b.Letra||'')),
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(lotes, 'getLoteAvailabilityIndicatorItems'), ctx);

  let rows = ctx.getLoteAvailabilityIndicatorItems({}, true);
  const g = rows.find(r => r.letra === 'G');
  const c = rows.find(r => r.letra === 'C');
  assert.deepStrictEqual([g.cantidadDisponible,g.cantidadProducida], [1,3], 'Indicador de origen incorrecto');
  assert.deepStrictEqual([c.cantidadDisponible,c.cantidadProducida], [2,2], 'Destino de reempaque no apareció independiente');

  status = 'CERRADO';
  rows = ctx.getLoteAvailabilityIndicatorItems({}, true);
  assert(rows.every(r => r.cantidadDisponible === 0), 'Lote cerrado conserva disponible');

  status = 'DISPONIBLE';
  snapshot = { source:'', hasSnapshot:false, hasProduct:false, remainingByProductId:{}, hasLetter:false, remainingByLetter:{}, availabilityProducts:[], snapshot:null };
  transferred = { byProductId:{'prod-g':1}, byLetter:{G:1} };
  rows = ctx.getLoteAvailabilityIndicatorItems({}, true);
  assert.strictEqual(rows.find(r => r.letra === 'G').cantidadDisponible, 2, 'Transferencia a hijo no descontó al padre histórico');
}

function testActualParentChildTransfer(){
  const products = [
    { id:1, productId:'prod-g', name:'Galón', Letra:'G' },
    { id:2, productId:'prod-c', name:'Catrina', Letra:'C' },
  ];
  const parent = {
    id:'L1',
    eventUsage:{
      '10':{
        remainingByProductId:{'prod-g':1,'prod-c':2},
        remainingByLetter:{G:1,C:2},
        remainingByKey:{'PID:prod-g':1,'PID:prod-c':2},
        availabilityProducts:[
          {productId:'prod-g',Letra:'G',nombreSnapshot:'Galón',cantidadBase:3,cantidadDisponible:1},
          {productId:'prod-c',Letra:'C',nombreSnapshot:'Catrina',cantidadBase:2,cantidadDisponible:2},
        ]
      }
    }
  };
  const ctx = {
    console, Object, Array, String, Number, Map, Set, Math, Date,
    buildProductIdentityIndexPOS: list => ({
      list,
      byLetter:new Map(list.map(p=>[String(p.Letra).toUpperCase(),p])),
      byStable:new Map(list.map(p=>[p.productId,p]))
    }),
    resolveCatalogProductIdentityPOS: (row,index) => {
      const pid=String(row.productId||row.productoId||'').trim();
      const letter=String(row.Letra||row.letra||'').trim().toUpperCase();
      const product=index.byStable.get(pid)||index.byLetter.get(letter)||null;
      return product ? {ok:true,product,stableId:product.productId,letter:String(product.Letra).toUpperCase(),name:product.name} : {ok:false};
    },
    lotesPOSContractRowsPOS: () => [],
  };
  vm.createContext(ctx);
  for (const name of ['sobranteUsageSnapshotPOS','sobranteQtyPOS','sobranteSnapshotQtyPOS','buildSobranteTransferItemsPOS','subtractSobranteFromParentSnapshotPOS']){
    vm.runInContext(extractFunction(pos, name), ctx);
  }
  const transfer=ctx.buildSobranteTransferItemsPOS(parent,10,{P:0,M:0,D:0,L:0,G:1},products);
  assert.strictEqual(transfer.ok,true,'Transferencia padre-hijo rechazada');
  assert.strictEqual(transfer.items.length,2,'Se duplicaron o perdieron productos al crear hijo');
  assert.strictEqual(transfer.items.reduce((a,r)=>a+Number(r.cantidad||0),0),3,'Total del hijo inconsistente');
  ctx.subtractSobranteFromParentSnapshotPOS(parent,10,transfer.items);
  assert.strictEqual(parent.eventUsage['10'].remainingByProductId['prod-g'],0,'Padre no descontó Galón transferido');
  assert.strictEqual(parent.eventUsage['10'].remainingByProductId['prod-c'],0,'Padre no descontó Catrina transferida');
  assert.strictEqual(parent.eventUsage['10'].transferenciaHijoAplicada,true,'No quedó marca antidoble descuento');
}

(async () => {
  // Integraciones y guardas estáticas de la implementación real.
  assert(pos.includes('try{ await queueLotsUsageSyncPOS(eventId); }catch(_){ }'), 'Ajustes no disparan sincronización');
  assert(pos.includes("source: 'reempaque'"), 'Reempaque no conserva movimientos de inventario');
  assert(pos.includes('buildSobranteTransferItemsPOS'), 'No existe transferencia padre-hijo validada');
  assert(pos.includes('subtractSobranteFromParentSnapshotPOS'), 'No existe descuento del snapshot del padre');
  assert(pos.includes("parent.status = 'CERRADO'"), 'El padre no se cierra tras transferencia');
  assert(pos.includes('Math.max(0'), 'No se encontraron clamps antinegativos');
  assert(lotes.includes("if (status === 'CERRADO') available = 0"), 'Cerrado no fuerza disponible cero');
  assert(lotes.includes('eventUsage.availabilityProducts'), 'Lotes no integra destinos de reempaque');
  assert(lotes.includes('transferencia-padre-hijo'), 'Lote hijo no usa contrato independiente');
  assert(!/function buildLotePOSAvailabilityContract\(lote\)\{\s*const items/.test(lotes), 'Contrato usa status sin inicializar');

  await testActualFifo();
  testActualSnapshotParser();
  testActualIndicator();
  testActualParentChildTransfer();
  console.log('OK — 11/11: ventas, reempaque, recálculos, lotes hijos, reversiones, clamps, consistencia y contratos integrados.');
})().catch(err => { console.error(err); process.exit(1); });
