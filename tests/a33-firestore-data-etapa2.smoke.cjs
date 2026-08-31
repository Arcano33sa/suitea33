'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/a33-firestore-data.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'configuracion/style.css'), 'utf8');

const storage = Object.create(null);
const events = [];
const toastCalls = [];
const localStorage = {
  getItem(key){ return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
  setItem(key, value){ storage[key] = String(value); }
};
function CustomEvent(type, options){ this.type = type; this.detail = options && options.detail; }

const sandbox = {
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  Map,
  Number,
  String,
  RegExp,
  parseInt,
  localStorage,
  CustomEvent,
  dispatchEvent(event){ events.push(event); },
  A33Toast: {
    process(message, options){ toastCalls.push({ action:'process', message, options }); return options && options.id; },
    replace(id, message, type){ toastCalls.push({ action:'replace', id, message, type }); return id; }
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename:'a33-firestore-data.js' });

const api = sandbox.A33FirestoreData;
assert(api, 'No se publicó A33FirestoreData');
assert.strictEqual(api.contract.contractVersion, 1, 'Versión de contrato inesperada');
assert.strictEqual(api.contract.schemaVersion, 1, 'Versión de esquema inesperada');
assert.strictEqual(api.modules.length, 9, 'El contrato debe contener nueve módulos');
assert.strictEqual(api.isRemoteEnabled(), false, 'La escritura remota debe permanecer bloqueada en E2');
assert.strictEqual(api.contract.remoteWritesEnabled, false, 'El contrato no debe habilitar escrituras remotas');

const moduleIds = api.modules.map((module) => module.id);
assert.deepStrictEqual(Array.from(moduleIds), ['configuracion','catalogos','inventario','lotes','pos','pedidos','agenda','finanzas','seguridad']);
const finance = api.getModule('finanzas');
assert(finance.entities.includes('cobrar'), 'Finanzas no contempla Cobrar');
assert(finance.entities.includes('pagar'), 'Finanzas no contempla Pagar');

const expectedPath = 'workspaces/arcano33/modules/finanzas/entities/cobrar/records/cuenta_001';
assert.strictEqual(api.recordPath('arcano33', 'finanzas', 'cobrar', 'Cuenta 001'), expectedPath, 'Ruta Firestore incorrecta');
const document = api.createDocument({
  workspaceId:'arcano33',
  moduleId:'finanzas',
  entityId:'cobrar',
  recordId:'Cuenta 001',
  sourceId:'cliente-mario',
  deviceId:'ipad-admin',
  payload:{ cliente:'Mario', monto:500 }
});
assert.strictEqual(document.path, expectedPath, 'El documento no conserva la ruta calculada');
assert.strictEqual(document.payload.cliente, 'Mario', 'El payload no se conservó');
assert.strictEqual(api.validateDocument(document).ok, true, 'Documento válido rechazado');
assert.strictEqual(api.validateDocument({}).ok, false, 'Documento vacío aceptado');
assert.throws(() => api.recordPath('arcano33', 'desconocido', 'datos', '1'), /firestore_module_not_allowed/);

let progress = api.readProgress();
assert.strictEqual(progress.status, 'idle', 'El progreso inicial no está inactivo');
assert(progress.modules.every((module) => module.status === 'pending'), 'Los módulos iniciales no están pendientes');
api.startProgress({ message:'Preparando carga de prueba…' });
for (const module of api.modules) api.setModuleProgress(module.id, 'success', 'Módulo cargado.', { processed:1, total:1 });
const finished = api.finishProgress();
progress = finished.state;
const summary = api.progressSummary(progress);
assert.strictEqual(progress.status, 'success', 'La ejecución completa no terminó en éxito');
assert.strictEqual(summary.loaded, 9, 'No se marcaron nueve módulos cargados');
assert.strictEqual(summary.percent, 100, 'La barra no llegó a 100%');
assert(events.some((event) => event.type === 'a33:firestore-progress'), 'No se emite el evento de progreso');
assert(toastCalls.some((call) => call.action === 'process'), 'No se inicia el Toast azul');
assert(toastCalls.some((call) => call.action === 'replace' && call.type === 'success'), 'No se confirma el resultado con Toast verde');

api.resetProgress();
assert(api.readProgress().modules.every((module) => module.status === 'pending'), 'El reinicio local no vuelve a Pendiente');

assert(html.includes('id="cfg-firestore-progress-track"'), 'Falta barra de progreso en Configuración');
assert(html.includes('id="cfg-firestore-module-grid"'), 'Falta cuadrícula de nueve módulos');
assert(html.includes('a33-firestore-data.js?v=4.20.98&amp;r=1'), 'Configuración no carga la capa Firestore');
assert(html.indexOf('a33-firestore-data.js') < html.indexOf('script.js?v=4.20.98&amp;r=49'), 'La capa Firestore carga después de Configuración');
assert(configSource.includes("window.addEventListener('a33:firestore-progress'"), 'Configuración no escucha el progreso Firestore');
assert(configSource.includes('function renderFirestoreProgress(state)'), 'Falta render del panel Firestore');
for (const status of ['process','success','warning','error']) {
  assert(css.includes(`.cfg-firestore-module[data-status="${status}"]`), `Falta estilo de estado ${status}`);
}
assert(css.includes('@media (max-width: 560px)'), 'Falta adaptación móvil');

console.log('SMOKE OK');
console.log('- Contrato Firestore local con nueve módulos verificado');
console.log('- Rutas, documento, validación y bloqueo remoto verificados');
console.log('- Progreso 0/9 a 9/9 y Toast de proceso/resultado verificados');
console.log('- Panel de Configuración y estados responsivos verificados');
