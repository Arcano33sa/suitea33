'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../lotes/script.js'), 'utf8');
const product = (letter, qty) => ({ productId: `product-${letter}`, Letra: letter, cantidad: qty });
const snapshot = (quantities) => ({ remainingByLetter: quantities,
  remainingByProductId: Object.fromEntries(Object.entries(quantities).map(([k,v]) => [`product-${k}`,v])) });
function totals(lots, visible = lots){
  const stored = JSON.stringify(lots);
  const storage = { getItem: key => key === 'arcano33_lotes' ? stored : null,
    setItem(){ throw new Error('El resumen no debe escribir datos'); } };
  const ctx = { console, setTimeout, clearTimeout, localStorage: storage, A33Storage: storage,
    document: { addEventListener(){}, getElementById(){ return null; }, querySelectorAll(){ return []; } },
    window: {}, navigator: {}, matchMedia: () => ({ matches: false }), input: visible, allLots: lots };
  ctx.window.matchMedia = ctx.matchMedia;
  vm.createContext(ctx); vm.runInContext(source, ctx);
  const before = JSON.stringify(visible);
  const result = vm.runInContext('listView.allSorted = allLots; computeRemainingTotals(input)', ctx);
  assert.equal(JSON.stringify(visible), before, 'Conserva los registros originales');
  return result;
}
const child = (id, parent, rows, remaining) => ({ id, parentLotId: parent, loteType: 'SOBRANTE',
  status: 'EN_EVENTO', assignedEventId: 6, galon: String(rows.find(x => x.Letra === 'G')?.cantidad || 0),
  productosProducidos: rows, transferenciaLote: { productos: rows }, eventUsage: { 6: snapshot(remaining) } });
const parent = { id: 'parent', status: 'CERRADO', assignedEventId: 5,
  productosProducidos: [product('G',4)], eventUsage: { 5: snapshot({ G:4 }) } };
const sold = child('sold', 'parent', [product('G',4)], { G:0 });
const partial = child('partial', 'other-parent', [product('C',1),product('G',2)], { C:1,G:0 });
let count = 0;
function test(name, run){ run(); count++; console.log(`OK ${name}`); }
test('Caso vendido con padre cerrado y campos históricos: 1C y 0G', () => {
  const t = totals([parent,sold,partial]); assert.equal(t.C,1); assert.equal(t.G,0);
});
test('Filtro de un sobrante parcialmente vendido', () => {
  const t = totals([parent,sold,partial], [partial]); assert.equal(t.C,1); assert.equal(t.G,0);
});
test('Lote cerrado con snapshot pendiente aporta cero', () => assert.equal(totals([parent]).G,0));
test('Lote histórico disponible sin snapshot conserva existencias', () => {
  assert.equal(totals([{ id:'legacy', status:'DISPONIBLE', galon:'3' }]).G,3);
});
test('Transferencia a hijo no duplica existencia del padre', () => {
  const p = { id:'p', status:'DISPONIBLE', productosProducidos:[product('G',5)] };
  const c = child('c','p',[product('G',2)],{G:2});
  assert.equal(totals([p,c]).G,5);
});
test('Snapshot activo sin producto disponible aporta cero', () => {
  const lot = { id:'consumed',status:'EN_EVENTO',assignedEventId:6,
    productosProducidos:[product('G',4)],eventUsage:{6:snapshot({C:0})} };
  assert.equal(totals([lot]).G,0);
});
test('Presentación creada por reempaque se incluye', () => {
  const lot = { id:'repack',status:'EN_EVENTO',assignedEventId:6,productosProducidos:[product('G',1)],
    eventUsage:{6:{...snapshot({G:0,C:3}),availabilityProducts:[{productId:'product-C',Letra:'C',cantidadBase:9,cantidadDisponible:3}]}} };
  const t=totals([lot]); assert.equal(t.G,0); assert.equal(t.C,3);
});
test('Filtro vacío conserva valores en cero', () => {
  const t=totals([parent,sold,partial],[]); assert(Object.values(t).every(v=>v===0));
});
console.log(`${count}/${count} pruebas aprobadas`);
