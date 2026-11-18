'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../lotes/script.js'), 'utf8');
const old = { archiveId: 'old', originalId: 'legacy', codigo: 'ANTERIOR' };
const data = new Map();
const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
const ctx = vm.createContext({ console, setTimeout, clearTimeout, localStorage: storage, A33Storage: storage,
  document: { addEventListener(){}, getElementById(){ return null; }, querySelectorAll(){ return []; } },
  window: {}, navigator: {}, matchMedia: () => ({ matches: false }) });
ctx.window.matchMedia = ctx.matchMedia;
vm.runInContext(source, ctx);
// Usar la clave real y almacenamiento aislado: no accede a datos de la aplicación.
const archiveKey = vm.runInContext('ARCHIVE_KEY', ctx);
data.clear(); data.set(archiveKey, JSON.stringify([old]));
ctx.input = { id: 'lote_1700000000000', codigo: '001', createdAt: '2026-11-01T12:30:00.000Z',
  fecha: '2026-10-31', caducidad: '2026-12-31', notas: 'Primera línea\nSegunda línea: ñ',
  status: 'EN_EVENTO', assignedEventId: 'e1', assignedEventName: 'Feria',
  productosProducidos: [{ productId: 'djeba', Letra: 'D', cantidad: 6 }] };
const before = JSON.stringify(ctx.input);
vm.runInContext("archiveLote(input, '2026-11-18T12:00:00.000Z')", ctx);
const archived = JSON.parse(data.get(archiveKey));
assert.deepEqual(archived.find(row => row.archiveId === 'old'), old, 'El histórico previo permanece intacto');
const saved = archived.find(row => row.originalId === ctx.input.id);
for (const field of ['fecha', 'caducidad', 'notas', 'createdAt', 'assignedEventId', 'assignedEventName']) {
  assert.equal(saved[field], ctx.input[field], `Conserva ${field} tras guardar y leer JSON`);
}
assert.deepEqual(saved.productosProducidos, ctx.input.productosProducidos);
assert.equal(JSON.stringify(ctx.input), before, 'No modifica el lote original');
ctx.input = { id: 'legacy', codigo: 'OLD', status: 'DISPONIBLE' };
vm.runInContext("archiveLote(input, '2026-11-18T12:00:00.000Z')", ctx);
const legacy = JSON.parse(data.get(archiveKey)).find(row => row.originalId === 'legacy' && row.archiveId !== 'old');
for (const field of ['fecha', 'caducidad', 'notas']) assert.equal(legacy[field], '', 'No inventa datos ausentes');
assert.deepEqual(JSON.parse(data.get(archiveKey)).find(row => row.archiveId === 'old'), old);
assert.equal(data.size, 1, 'Solo escribe el histórico simulado');
console.log('OK: persistencia de fechas y notas, productos D6, evento, datos ausentes, histórico previo y lote original intactos.');
