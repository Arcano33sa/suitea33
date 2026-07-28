'use strict';

process.env.TZ = 'America/Managua';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const html = read('pos/index.html');
const app = read('pos/app.js');
const css = read('pos/styles.css');
const sw = read('pos/sw.js');
const manifest = JSON.parse(read('pos/manifest.webmanifest'));

function selectBody(id){
  const re = new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`);
  const match = html.match(re);
  assert(match, `No se encontró ${id}`);
  return match[1];
}
function optionValues(body){
  return [...body.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map((m)=>({ value:m[1], text:m[2].trim() }));
}

const expectedOptions = [
  { value:'CASH_IN', text:'Entrada' },
  { value:'EXPENSE', text:'Salida' },
  { value:'CREDIT_COLLECTION', text:'Cobros' },
];
assert.deepStrictEqual(optionValues(selectBody('cashv2-move-kind-inline')), expectedOptions);
assert.deepStrictEqual(optionValues(selectBody('cashv2-move-kind')), expectedOptions);

// UI, trazabilidad y PWA.
for (const token of [
  'cashv2-credit-sale-select', 'cashv2-credit-sale-details',
  'Total original', 'Total cobrado', 'Saldo pendiente', 'Estado',
  'cashv2-sum-collections-nio', 'cashv2-sum-collections-usd'
]) assert(html.includes(token) || app.includes(token), `Falta ${token}`);
assert(css.includes('.cashv2-move-trace'), 'Faltan estilos de trazabilidad del cobro');
assert(app.includes("db.transaction([CASH_V2_STORE, 'sales'], 'readwrite')"), 'Cobro no atómico');
assert(app.includes("db.transaction([CASH_V2_STORE], 'readwrite')"), 'Entrada/Salida no atómica');
assert(app.includes('cashV2IsSaleCollectiblePOS(sale)'), 'No bloquea ventas anuladas/revertidas');
assert(app.includes('clientRequestId'), 'Falta identidad idempotente de solicitud');
assert(app.includes('__cashV2CreditCollectionLocks.has(lockKey)'), 'Falta bloqueo concurrente de cobros');
assert(app.includes('__cashV2MovementSubmitLocks.has(submitLockKey)'), 'Falta bloqueo de doble toque/listener');
assert(app.includes('creditBalanceBefore'), 'Falta saldo anterior');
assert(app.includes('creditBalanceAfter'), 'Falta saldo posterior');
assert(app.includes('creditPaymentId'), 'Falta identificador de pago');
assert(app.includes('creditSaleUid'), 'Falta UID estable de venta');
assert(app.includes('collectedAt'), 'Falta fecha/hora real de cobro');
assert(app.includes("if (dk !== actualDayKey) throw new Error('El cobro debe registrarse en la caja del día real"), 'Cobro no exige fecha real');
assert(app.includes('Esta venta tiene cobros vinculados'), 'Borrado de venta no está protegido');
assert(app.includes('iN + sN.entries + sN.collections - sN.out + salesC'), 'Fórmula C$ incorrecta');
assert(app.includes('iU + sU.entries + sU.collections - sU.out + salesUSD'), 'Fórmula USD incorrecta');
assert(app.includes('affectsIncome: false'), 'Entrada/Cobro puede inflar ingreso');
assert(app.includes('affectsInventory: false'), 'Cobro puede volver a descontar inventario');
assert(app.includes('affectsUtility: isExpense'), 'Salida no afecta utilidad como gasto');
assert(app.includes('cashV2IsReversedMovement(movement)'), 'Historial no omite reversos en cálculos');
assert(html.includes('app.js?v=4.20.97&r=37'));
assert(html.includes('styles.css?v=4.20.97&r=18'));
assert(html.includes('manifest.webmanifest?v=4.20.97&r=21'));
assert(sw.includes("const MODULE_CACHE_REV = '41'"));
assert(sw.includes("'./app.js?v=4.20.97&r=37'"));
assert.strictEqual(manifest.start_url, './index.html?v=4.20.97&r=21');

function sourceRange(source, startNeedle, endNeedle){
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert(start >= 0 && end > start, `Rango no encontrado: ${startNeedle}`);
  return source.slice(start, end);
}

const core = sourceRange(app, 'function cashV2NormAmountInt(', '\nfunction cashV2NetForCurrency(');
const sumFn = sourceRange(app, 'function cashV2SumMovementsByCurrency(', '\nfunction cashV2ComputeCloseNumbers(');

const runtimeSource = `
let db = null;
const CASH_V2_STORE = 'cashV2';
function round2(n){ const x=Number(n); return Number.isFinite(x) ? Math.round((x+Number.EPSILON)*100)/100 : 0; }
function cashV2Round2Money(n){ return round2(n); }
function cashV2FmtMoney(n){ return round2(n).toFixed(2); }
function cashV2AssertEventId(v){ const s=String(v??'').trim(); if(!s) throw new Error('eventId'); return s; }
function safeYMD(v){ return String(v||'').slice(0,10); }
function cashV2AssertDayKeyCanon(v){ if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(v)) throw new Error('dayKey'); return v; }
function cashV2Key(eid,dk){ return 'cashv2:'+eid+':'+dk; }
function cashV2NormStatus(v){ return String(v||'OPEN').toUpperCase()==='CLOSED'?'CLOSED':'OPEN'; }
function normalizePaymentMethodPOS(v){ const s=String(v||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,''); return s.includes('credito')?'credito':s; }
function cashV2DayKeyFromTsLocal(ts){ const d=new Date(ts); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return y+'-'+m+'-'+day; }
async function openDB(){ return db; }
async function cashV2ComputeCashSalesPhysicalPOS(){ return {NIO:300,USD:0,grossNIO:300,changeNIO:0}; }
${core}
${sumFn}
globalThis.__api = {
  setDb(value){ db=value; },
  cashV2CreditSaleSnapshot,
  cashV2RegisterCreditCollectionAtomic,
  cashV2RegisterManualMovementAtomic,
  cashV2SumMovementsByCurrency
};
`;

function clone(value){ return value == null ? value : structuredClone(value); }
function createFakeDb(initial){
  const stores = {
    cashV2: new Map((initial.cashV2 || []).map((row)=>[row.key, clone(row)])),
    sales: new Map((initial.sales || []).map((row)=>[row.id, clone(row)])),
  };
  return {
    stores,
    transaction(storeNames){
      const tx = {
        aborted:false, pending:0, completeScheduled:false, error:null,
        oncomplete:null, onabort:null, onerror:null,
        abort(){
          if (this.aborted) return;
          this.aborted = true;
          queueMicrotask(()=>{ if (typeof this.onabort === 'function') this.onabort(); });
        },
        objectStore(name){
          assert(storeNames.includes(name), `Store inesperado ${name}`);
          const map = stores[name];
          const request = (operation)=>{
            tx.pending += 1;
            const req = { result:undefined, error:null, onsuccess:null, onerror:null };
            queueMicrotask(()=>{
              if (tx.aborted){ tx.pending -= 1; return; }
              try{
                req.result = operation();
                if (typeof req.onsuccess === 'function') req.onsuccess();
              }catch(error){
                req.error = error; tx.error = error;
                if (typeof req.onerror === 'function') req.onerror();
                tx.abort();
              }finally{
                tx.pending -= 1;
                scheduleComplete();
              }
            });
            return req;
          };
          return {
            get(key){ return request(()=>clone(map.get(key) || null)); },
            getAll(){ return request(()=>[...map.values()].map(clone)); },
            put(value){ return request(()=>{ const key=name==='cashV2'?value.key:value.id; map.set(key,clone(value)); return key; }); },
          };
        },
      };
      function scheduleComplete(){
        if (tx.aborted || tx.pending !== 0 || tx.completeScheduled) return;
        tx.completeScheduled = true;
        queueMicrotask(()=>{
          tx.completeScheduled = false;
          if (!tx.aborted && tx.pending === 0 && typeof tx.oncomplete === 'function') tx.oncomplete();
        });
      }
      return tx;
    },
  };
}

const context = vm.createContext({
  console, Date, Math, Number, String, Object, Array, Set, Map, Promise, Error, RegExp,
  structuredClone, queueMicrotask, setTimeout, clearTimeout
});
vm.runInContext(runtimeSource, context, { filename:'pos-efectivo-etapa2-runtime.js' });
const api = context.__api;

function localDay(ts=Date.now()){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
async function expectReject(promise, re){
  let error = null;
  try{ await promise; }catch(e){ error=e; }
  assert(error, 'Se esperaba rechazo');
  assert(re.test(String(error.message || error)), `Mensaje inesperado: ${error.message}`);
}

(async()=>{
  const today = localDay();
  const yesterday = localDay(Date.now() - 86400000);
  const key = `cashv2:1:${today}`;
  const fakeDb = createFakeDb({
    cashV2:[{
      version:2, key, eventId:'1', dayKey:today, status:'OPEN',
      initial:{ totalC:1000, totalUSD:0 }, cashSalesC:300, cashSalesUSD:0,
      movements:[], audit:[], meta:{}
    }],
    sales:[
      { id:1, uid:'sale-1', eventId:1, payment:'credito', total:300, customerName:'Carlos', productName:'Djeba', date:yesterday, seqId:7, inventoryApplied:true },
      { id:2, uid:'sale-2', eventId:1, payment:'credito', total:100, customerName:'Ana', productName:'Catrina', date:yesterday, status:'ANULADA' },
      { id:3, uid:'sale-3', eventId:1, payment:'credito', total:100, customerName:'Luis', productName:'Vaso', date:yesterday },
      { id:4, uid:'sale-4', eventId:2, payment:'credito', total:100, customerName:'Otro', productName:'Vaso', date:yesterday },
    ],
  });
  api.setDb(fakeDb);

  const entry = await api.cashV2RegisterManualMovementAtomic({ eventId:1, dayKey:today, operationalClass:'CASH_IN', currency:'NIO', amount:500, desc:'Fondo adicional', requestId:'MOV-ENTRY' });
  assert.strictEqual(entry.movement.kind, 'IN');
  assert.strictEqual(entry.movement.affectsUtility, false);
  assert.strictEqual(entry.movement.affectsIncome, false);

  const expense = await api.cashV2RegisterManualMovementAtomic({ eventId:1, dayKey:today, operationalClass:'EXPENSE', currency:'NIO', amount:120, desc:'Gasto del evento', requestId:'MOV-EXPENSE' });
  assert.strictEqual(expense.movement.kind, 'OUT');
  assert.strictEqual(expense.movement.affectsUtility, true);
  await expectReject(api.cashV2RegisterManualMovementAtomic({ eventId:1, dayKey:today, operationalClass:'EXPENSE', currency:'NIO', amount:120, desc:'Duplicado', requestId:'MOV-EXPENSE' }), /ya fue registrado/i);
  await expectReject(api.cashV2RegisterManualMovementAtomic({ eventId:1, dayKey:yesterday, operationalClass:'CASH_IN', currency:'NIO', amount:1, desc:'Atrasado' }), /día real/i);

  const firstPromise = api.cashV2RegisterCreditCollectionAtomic({ eventId:1, dayKey:today, saleId:1, amount:100, desc:'Primer abono', requestId:'COL-1' });
  await expectReject(api.cashV2RegisterCreditCollectionAtomic({ eventId:1, dayKey:today, saleId:1, amount:100, desc:'Doble toque', requestId:'COL-2' }), /ya se está guardando/i);
  const first = await firstPromise;
  assert.strictEqual(first.movement.creditSaleId, 1);
  assert.strictEqual(first.movement.creditCustomer, 'Carlos');
  assert.strictEqual(first.movement.creditReference, 'Venta #7');
  assert.strictEqual(first.movement.creditBalanceBefore, 300);
  assert.strictEqual(first.movement.creditBalanceAfter, 200);
  assert.strictEqual(first.movement.creditStatusAfter, 'ABONADA');
  assert.strictEqual(first.movement.affectsIncome, false);
  assert.strictEqual(first.movement.affectsUtility, false);
  assert.strictEqual(first.movement.affectsInventory, false);
  assert.strictEqual(first.sale.date, yesterday, 'La venta cambió de fecha');
  assert.strictEqual(fakeDb.stores.sales.size, 4, 'Se generó otra venta');

  const final = await api.cashV2RegisterCreditCollectionAtomic({ eventId:1, dayKey:today, saleId:1, amount:200, desc:'Pago final', requestId:'COL-3' });
  assert.strictEqual(final.sale.creditPaidAmount, 300);
  assert.strictEqual(final.sale.creditBalance, 0);
  assert.strictEqual(final.sale.creditStatus, 'PAGADA');
  assert.strictEqual(final.sale.creditPayments.length, 2);
  await expectReject(api.cashV2RegisterCreditCollectionAtomic({ eventId:1, dayKey:today, saleId:1, amount:1, desc:'Cobro extra' }), /ya está pagada/i);
  await expectReject(api.cashV2RegisterCreditCollectionAtomic({ eventId:1, dayKey:today, saleId:3, amount:101, desc:'Sobrepago' }), /supera el saldo/i);
  await expectReject(api.cashV2RegisterCreditCollectionAtomic({ eventId:1, dayKey:today, saleId:2, amount:10, desc:'Anulada' }), /anulada|revertida/i);
  await expectReject(api.cashV2RegisterCreditCollectionAtomic({ eventId:1, dayKey:today, saleId:4, amount:10, desc:'Otro evento' }), /otro evento/i);
  await expectReject(api.cashV2RegisterCreditCollectionAtomic({ eventId:1, dayKey:yesterday, saleId:3, amount:10, desc:'Fecha incorrecta' }), /día real/i);

  const third = await api.cashV2RegisterCreditCollectionAtomic({ eventId:1, dayKey:today, saleId:3, amount:10, desc:'Abono Luis', requestId:'COL-IDEMPOTENT' });
  assert.strictEqual(third.sale.creditBalance, 90);
  const countBeforeRetry = fakeDb.stores.cashV2.get(key).movements.length;
  await expectReject(api.cashV2RegisterCreditCollectionAtomic({ eventId:1, dayKey:today, saleId:3, amount:10, desc:'Reintento', requestId:'COL-IDEMPOTENT' }), /ya fue registrado/i);
  assert.strictEqual(fakeDb.stores.cashV2.get(key).movements.length, countBeforeRetry);

  const rec = fakeDb.stores.cashV2.get(key);
  rec.movements.push({ id:'REV-1', movementType:'CREDIT_COLLECTION', creditSaleId:3, creditPaymentId:'REV-P', kind:'IN', currency:'NIO', amount:999, status:'REVERSED' });
  rec.movements.push({ id:'DUP-TRACE', movementType:'CREDIT_COLLECTION', creditSaleId:3, creditPaymentId:third.movement.creditPaymentId, kind:'IN', currency:'NIO', amount:10 });
  fakeDb.stores.cashV2.set(key, rec);
  const sums = api.cashV2SumMovementsByCurrency(rec.movements, 'NIO');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sums)), { in:810, entries:500, collections:310, out:120, adjust:0 });
  const expectedCash = round(1000 + sums.entries + sums.collections - sums.out + 300, 2);
  assert.strictEqual(expectedCash, 1990, 'Efectivo esperado incorrecto');
  function round(n,p){ const f=10**p; return Math.round((n+Number.EPSILON)*f)/f; }

  const snapshot = api.cashV2CreditSaleSnapshot(fakeDb.stores.sales.get(3), [...fakeDb.stores.cashV2.values()]);
  assert.strictEqual(snapshot.original, 100);
  assert.strictEqual(snapshot.paid, 10, 'Duplicó el pago por traza repetida');
  assert.strictEqual(snapshot.balance, 90);
  assert.strictEqual(snapshot.status, 'ABONADA');

  const closed = clone(fakeDb.stores.cashV2.get(key));
  closed.status = 'CLOSED';
  fakeDb.stores.cashV2.set(key, closed);
  await expectReject(api.cashV2RegisterManualMovementAtomic({ eventId:1, dayKey:today, operationalClass:'CASH_IN', currency:'NIO', amount:5, desc:'Cerrado' }), /cerrado/i);

  console.log('PASS a33-pos-efectivo-etapa2-blindaje: 25/25 controles cubiertos');
})().catch((error)=>{
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
