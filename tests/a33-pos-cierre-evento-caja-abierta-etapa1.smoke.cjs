'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');

function between(source, startToken, endToken){
  const start = source.indexOf(startToken);
  assert.ok(start >= 0, `No se encontró ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(end > start, `No se encontró cierre para ${startToken}`);
  return source.slice(start, end);
}

const helperBlock = between(
  app,
  'async function getOpenCashDaysForEventPOS(eventId)',
  '// --- Close / Reopen / Activate / Delete ---'
);

let cashRows = [];
const sandbox = {
  CASH_V2_STORE: 'cashV2',
  async getAll(store){
    assert.strictEqual(store, 'cashV2');
    return cashRows;
  },
  cashV2NormStatus(value){
    return String(value || 'OPEN').trim().toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN';
  },
  safeYMD(value){
    const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : '';
  },
  Array, Error, Set, String
};
vm.createContext(sandbox);
vm.runInContext(`${helperBlock}\nthis.getOpenCashDaysForEventPOS=getOpenCashDaysForEventPOS;`, sandbox);

(async()=>{
  cashRows = [];
  assert.deepStrictEqual(
    Array.from(await sandbox.getOpenCashDaysForEventPOS(10)),
    [],
    'Un evento sin registros de caja debe poder cerrar'
  );

  cashRows = [
    {eventId:10, dayKey:'2026-09-28', status:'CLOSED'},
    {eventId:'10', dayKey:'2026-09-29', status:'CLOSED'},
    {eventId:11, dayKey:'2026-09-30', status:'OPEN'}
  ];
  assert.deepStrictEqual(
    Array.from(await sandbox.getOpenCashDaysForEventPOS(10)),
    [],
    'Un evento cuyas cajas están cerradas debe poder cerrar'
  );

  cashRows = [
    {eventId:10, dayKey:'2026-09-30', status:'OPEN'},
    {eventId:'10', dayKey:'2026-09-28', status:'OPEN'},
    {eventId:10, dayKey:'2026-09-30', status:'OPEN'},
    {eventId:10, dayKey:'2026-09-29', status:'CLOSED'},
    {eventId:11, dayKey:'2026-09-27', status:'OPEN'}
  ];
  assert.deepStrictEqual(
    Array.from(await sandbox.getOpenCashDaysForEventPOS(10)),
    ['2026-09-28', '2026-09-30'],
    'Debe detectar, deduplicar y ordenar todas las cajas abiertas del evento'
  );

  const closeBlock = between(app, 'async function closeEvent(eventId)', 'async function reopenEvent(eventId)');
  const guardPos = closeBlock.indexOf('await getOpenCashDaysForEventPOS(eventId)');
  const confirmPos = closeBlock.indexOf('showConfirmClosePOS');
  const mermaPos = closeBlock.indexOf('reempaqueFinalizeMermaForEventPOS');
  const exportPos = closeBlock.indexOf('await generateCorteCSV(eventId, { closedAtIso })');
  assert.ok(guardPos >= 0, 'El cierre no consulta cajas abiertas');
  assert.ok(guardPos < confirmPos, 'La validación debe ocurrir antes de confirmar el cierre');
  assert.ok(guardPos < mermaPos, 'La validación debe ocurrir antes de finalizar merma');
  assert.ok(guardPos < exportPos, 'La validación debe ocurrir antes de exportar');
  assert.ok(closeBlock.includes('No se pudo verificar el estado de la caja. El evento permanece abierto.'), 'Un error de lectura no bloquea el cierre de forma segura');

  const alerts = [];
  let confirmCalls = 0;
  const closeSandbox = {
    CASH_V2_STORE: 'cashV2',
    async getAll(store){
      if (store === 'events') return [{id:10, name:'Evento de prueba'}];
      if (store === 'cashV2') return [{eventId:10, dayKey:'2026-09-30', status:'OPEN'}];
      return [];
    },
    cashV2NormStatus: sandbox.cashV2NormStatus,
    safeYMD: sandbox.safeYMD,
    alert(message){ alerts.push(String(message)); },
    async showConfirmClosePOS(){ confirmCalls += 1; return true; },
    console, Array, Error, Set, String
  };
  vm.createContext(closeSandbox);
  vm.runInContext(`${helperBlock}\n${closeBlock}\nthis.closeEvent=closeEvent;`, closeSandbox);
  await closeSandbox.closeEvent(10);
  assert.strictEqual(confirmCalls, 0, 'Una caja abierta alcanzó la confirmación del cierre');
  assert.strictEqual(alerts.length, 1, 'No se mostró exactamente un aviso de bloqueo');
  assert.ok(alerts[0].includes('2026-09-30'), 'El aviso no identifica la fecha de caja abierta');

  console.log('SMOKE OK — Suite A33 — POS cierre de evento — bloqueo por caja abierta Etapa 1');
})().catch(err=>{
  console.error(err);
  process.exitCode = 1;
});
