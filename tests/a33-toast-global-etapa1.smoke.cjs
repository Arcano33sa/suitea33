'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/a33-toast.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/css/a33-toast.css'), 'utf8');
const pages = [
  'index.html',
  'agenda/index.html',
  'analitica/index.html',
  'inventario/index.html',
  'pos/index.html',
  'catalogos/index.html',
  'lotes/index.html',
  'configuracion/index.html',
  'finanzas/index.html',
  'calculadora/index.html',
  'pedidos/index.html',
  'centro-mando/index.html',
  'calculadora_temporal/index.html'
];
const serviceWorkers = [
  'agenda/sw.js',
  'calculadora/sw.js',
  'calculadora_temporal/sw.js',
  'catalogos/sw.js',
  'centro-mando/sw.js',
  'inventario/sw.js',
  'lotes/sw.js',
  'pedidos/sw.js',
  'pos/sw.js'
];
const compatibilityBridges = [
  'index.html',
  'catalogos/script.js',
  'centro-mando/app.js',
  'configuracion/script.js',
  'finanzas/script.js',
  'pos/app.js'
];

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  assert(html.includes('/assets/css/a33-toast.css?v=4.20.98&r=1'), `Falta CSS global en ${page}`);
  assert(html.includes('/assets/js/a33-toast.js?v=4.20.98&r=1'), `Falta JS global en ${page}`);
}
for (const serviceWorker of serviceWorkers) {
  const sw = fs.readFileSync(path.join(root, serviceWorker), 'utf8');
  assert(sw.includes('/assets/css/a33-toast.css?v=4.20.98&r=1'), `Falta CSS offline en ${serviceWorker}`);
  assert(sw.includes('/assets/js/a33-toast.js?v=4.20.98&r=1'), `Falta JS offline en ${serviceWorker}`);
}
for (const bridge of compatibilityBridges) {
  const contents = fs.readFileSync(path.join(root, bridge), 'utf8');
  assert(contents.includes('window.A33Toast'), `Falta puente de compatibilidad en ${bridge}`);
}

for (const token of ['is-process', 'is-success', 'is-warning', 'is-error']) {
  assert(css.includes(`.a33-global-toast.${token}`), `Falta estilo ${token}`);
}
assert(css.includes('@media (prefers-reduced-motion: reduce)'), 'Falta soporte de movimiento reducido');
assert(source.includes('const MAX_VISIBLE = 6'), 'El límite de avisos visibles no es seis');
assert(source.includes('const DEDUPE_MS = 900'), 'Falta protección contra avisos duplicados');

class FakeClassList {
  constructor(){ this.values = new Set(); }
  add(...items){ items.forEach((item) => this.values.add(item)); }
  remove(...items){ items.forEach((item) => this.values.delete(item)); }
  contains(item){ return this.values.has(item); }
}

class FakeElement {
  constructor(tagName){
    this.tagName = String(tagName || 'div').toUpperCase();
    this.id = '';
    this.className = '';
    this.classList = new FakeClassList();
    this.dataset = Object.create(null);
    this.attributes = Object.create(null);
    this.children = [];
    this.parentNode = null;
    this.style = { setProperty(){} };
    this.textContent = '';
  }
  setAttribute(name, value){ this.attributes[name] = String(value); }
  hasAttribute(name){ return Object.prototype.hasOwnProperty.call(this.attributes, name); }
  append(...nodes){ nodes.forEach((node) => this.appendChild(node)); }
  appendChild(node){ node.parentNode = this; this.children.push(node); return node; }
  replaceChildren(){ this.children = []; }
  addEventListener(){}
  remove(){
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
}

const body = new FakeElement('body');
const documentStub = {
  body,
  createElement(tagName){ return new FakeElement(tagName); },
  getElementById(id){
    const visit = (node) => node.id === id ? node : node.children.map(visit).find(Boolean);
    return visit(body) || null;
  },
  querySelectorAll(){ return []; }
};

const timers = new Map();
let timerSequence = 0;
const sandbox = {
  document: documentStub,
  Date,
  Object,
  Array,
  Map,
  Number,
  String,
  Math,
  RegExp,
  setTimeout(handler, duration){ timerSequence += 1; timers.set(timerSequence, { handler, duration }); return timerSequence; },
  clearTimeout(id){ timers.delete(id); },
  requestAnimationFrame(handler){ handler(); },
  addEventListener(){},
  getComputedStyle(){ return { position:'static' }; }
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename:'a33-toast.js' });

assert(sandbox.A33Toast, 'No se publicó window.A33Toast');
const processId = sandbox.A33Toast.process('Actualizando datos…');
let region = documentStub.getElementById('a33ToastRegion');
assert(region, 'No se creó la región global de avisos');
assert.strictEqual(region.children.length, 1, 'El aviso de proceso no apareció');
assert.strictEqual(region.children[0].dataset.toastType, 'process', 'El aviso azul no es de proceso');
assert(!Array.from(timers.values()).some((timer) => timer.duration === 0), 'El proceso no debe autocerrarse');

sandbox.A33Toast.replace(processId, 'Datos actualizados', 'success');
assert.strictEqual(region.children[0].dataset.toastType, 'success', 'El proceso no cambió a confirmado');
assert(Array.from(timers.values()).some((timer) => timer.duration === 3000), 'Confirmado no usa tres segundos');

sandbox.A33Toast.warning('Sin conexión');
sandbox.A33Toast.error('No se pudo guardar');
assert(region.children.some((node) => node.dataset.toastType === 'warning'), 'No apareció advertencia');
assert(region.children.some((node) => node.dataset.toastType === 'error'), 'No apareció error');
assert(Array.from(timers.values()).some((timer) => timer.duration === 4000), 'Advertencia no usa cuatro segundos');
assert(Array.from(timers.values()).some((timer) => timer.duration === 5000), 'Error no usa cinco segundos');

const beforeDuplicate = region.children.length;
sandbox.A33Toast.error('No se pudo guardar');
assert.strictEqual(region.children.length, beforeDuplicate, 'Se creó un duplicado inmediato');

sandbox.A33Toast.clear();
assert.strictEqual(region.children.length, 0, 'clear() no retiró los avisos');
for (let index = 1; index <= 7; index += 1) sandbox.A33Toast.process(`Proceso ${index}`);
assert.strictEqual(region.children.length, 6, 'Se excedió el máximo de seis avisos visibles');
sandbox.A33Toast.clear();

console.log('SMOKE OK');
console.log('- Toast global presente en 13 pantallas');
console.log('- Recursos offline presentes en 9 Service Workers');
console.log('- Proceso, confirmado, advertencia y error verificados');
console.log('- Reemplazo, duración, deduplicación y limpieza verificados');
