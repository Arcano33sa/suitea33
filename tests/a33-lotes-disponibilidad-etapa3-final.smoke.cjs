const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const lotes = fs.readFileSync(path.join(root, 'lotes', 'script.js'), 'utf8');
const pos = fs.readFileSync(path.join(root, 'pos', 'app.js'), 'utf8');
const lotesIndex = fs.readFileSync(path.join(root, 'lotes', 'index.html'), 'utf8');
const lotesSw = fs.readFileSync(path.join(root, 'lotes', 'sw.js'), 'utf8');
const posIndex = fs.readFileSync(path.join(root, 'pos', 'index.html'), 'utf8');
const posSw = fs.readFileSync(path.join(root, 'pos', 'sw.js'), 'utf8');

function extractFunction(source, name){
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert(start >= 0, `No se encontró ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
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
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

function buildLotesCtx(items, fallback = {}){
  const ctx = {
    console, Object, Array, String, Number, Map, Set, Math,
    effectiveLoteStatus: () => 'EN_EVENTO',
    getLoteAvailabilityIndicatorItems: () => items,
    normalizeQtyValue: value => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; },
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(lotes, 'getLoteSemaforoState'), ctx);
  vm.runInContext(extractFunction(lotes, 'getLoteDisplayStatus'), ctx);
  return { ctx, lote: { assignedEventId: 10, ...fallback } };
}

{
  const { ctx, lote } = buildLotesCtx([
    { cantidadProducida: 3, cantidadDisponible: 1 },
    { cantidadProducida: 2, cantidadDisponible: 0 },
  ], { eventUsage:{10:{remainingTotal:0}} });
  assert.strictEqual(ctx.getLoteSemaforoState(lote), 'PARCIAL', 'Un remainingTotal obsoleto marcó VENDIDO con unidades disponibles');
  assert.strictEqual(ctx.getLoteDisplayStatus(lote), 'EN_EVENTO', 'El lote parcial no conservó EN EVENTO');
}

{
  const { ctx, lote } = buildLotesCtx([
    { cantidadProducida: 3, cantidadDisponible: 0 },
    { cantidadProducida: 2, cantidadDisponible: 0 },
  ], { eventUsage:{10:{remainingTotal:99}} });
  assert.strictEqual(ctx.getLoteSemaforoState(lote), 'VENDIDO', 'Todas las presentaciones 0/x no pasaron a VENDIDO');
  assert.strictEqual(ctx.getLoteDisplayStatus(lote), 'VENDIDO', 'El estado visible no pasó a VENDIDO');
}

{
  const ctx = {
    console, Object, Array, String, Number, Math, Date,
    safeNumPOS: value => { const n = Number(value); return Number.isFinite(n) ? n : 0; },
    isPlainObjPOS: value => !!value && typeof value === 'object' && !Array.isArray(value),
    effectiveLoteStatusPOS: lote => String(lote.status || 'EN_EVENTO'),
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(pos, 'deriveLotAvailabilityStatePOS'), ctx);
  vm.runInContext(extractFunction(pos, 'setLotAvailabilityStatePOS'), ctx);
  const lote = { status:'EN_EVENTO' };
  ctx.setLotAvailabilityStatePOS(lote, { availabilityProducts:[{cantidadBase:3,cantidadDisponible:0}] }, '2026-07-23T14:00:00Z');
  assert.strictEqual(lote.availabilityState, 'VENDIDO', 'POS no persistió el estado VENDIDO para JSON/Firebase');
  assert.strictEqual(lote.availabilityUpdatedAt, '2026-07-23T14:00:00.000Z', 'POS no persistió timestamp válido');
  ctx.setLotAvailabilityStatePOS(lote, { availabilityProducts:[{cantidadBase:3,cantidadDisponible:1}] }, '2026-07-23T14:05:00Z');
  assert.strictEqual(lote.availabilityState, 'PARCIAL', 'Una reversión/ajuste positivo no restauró PARCIAL');
}

assert(lotes.includes("displaySt === \"VENDIDO\""), 'Tabla no pinta VENDIDO como estado principal');
assert(lotes.includes("displaySt === 'VENDIDO' ? 'chip--sold'"), 'Tarjeta responsive no pinta VENDIDO en verde');
assert(lotes.includes("if (st === \"EN_EVENTO\" && sem !== \"VENDIDO\")"), 'Tabla conserva estado duplicado EN EVENTO + VENDIDO');
assert(lotes.includes("if (st === 'EN_EVENTO' && sem !== 'VENDIDO')"), 'Tarjeta conserva estado duplicado EN EVENTO + VENDIDO');
assert(lotes.includes('estadoDisponibilidad'), 'Contrato Lotes/POS no expone estado automático compatible');
assert(!extractFunction(lotes, 'getTransferredToChildrenA33').includes('loadLotes()'), 'Lectura padre/hijo conserva recursión durante normalización');
assert(pos.includes("availabilityState: 'PARCIAL'"), 'Asignación inicial no prepara estado PARCIAL');
assert(pos.includes("parent.availabilityState = 'CERRADO'"), 'Padre transferido a hijo no conserva CERRADO');
assert(pos.includes("availabilityState: 'DISPONIBLE'"), 'Reverso/hijo no restauran DISPONIBLE');
assert(lotesIndex.includes('script.js?v=4.20.95&r=21'), 'Lotes index no tiene cache-bust del script final');
assert(lotesSw.includes("MODULE_CACHE_REV = '24'"), 'Service Worker de Lotes no fue incrementado');
assert(lotesSw.includes("'./script.js?v=4.20.95&r=21'"), 'Service Worker no precachea el script final');
assert(posIndex.includes('app.js?v=4.20.95&r=34'), 'POS index no tiene cache-bust de la persistencia automática');
assert(posSw.includes("MODULE_CACHE_REV = '38'"), 'Service Worker POS no fue incrementado');
assert(posSw.includes("'./app.js?v=4.20.95&r=34'"), 'Service Worker POS no precachea la persistencia automática');

console.log('OK — 19/19: estados automáticos, verde VENDIDO, consistencia, persistencia JSON/Firebase, responsive y PWA.');
