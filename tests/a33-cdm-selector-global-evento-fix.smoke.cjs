'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const app = read('centro-mando/app.js');
const index = read('centro-mando/index.html');
const sw = read('centro-mando/sw.js');
const manifest = JSON.parse(read('centro-mando/manifest.webmanifest'));

assert(app.includes('function closePickerAfterSelection()'), 'Falta cierre táctil del selector');
assert(app.includes('input.value = visualName()'), 'La selección no sincroniza el valor visible');
assert(app.includes('input.blur()'), 'La selección no cierra el teclado');
assert(app.includes('summaryRenderToken'), 'Falta blindaje contra resultados asíncronos obsoletos');
assert(app.includes('pickerSelectionToken'), 'Falta blindaje contra selección duplicada');
assert(index.includes('app.js?v=4.20.95&r=20'), 'Cache-bust del selector no actualizado');
assert(index.includes('manifest.webmanifest?v=4.20.95&r=3'), 'Manifest no actualizado');
assert(sw.includes("const MODULE_CACHE_REV = '3'"), 'Service Worker no incrementó caché');
assert(sw.includes("'./app.js?v=4.20.95&r=20'"), 'Service Worker no precachea la corrección');
assert.strictEqual(manifest.start_url, './index.html?v=4.20.95&r=20', 'PWA no apunta a la revisión corregida');

class MockElement {
  constructor(id=''){
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.value = '';
    this.className = '';
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.parentNode = null;
    this.blurCount = 0;
  }
  set innerHTML(value){ this._innerHTML = String(value); if (value === '') this.children = []; }
  get innerHTML(){ return this._innerHTML || ''; }
  addEventListener(name, handler){ this.listeners.set(name, handler); }
  appendChild(child){ child.parentNode = this; this.children.push(child); return child; }
  append(...children){ children.forEach((child)=>this.appendChild(child)); }
  setAttribute(name, value){ this.attributes.set(name, String(value)); }
  getAttribute(name){ return this.attributes.get(name) || null; }
  focus(){ document.activeElement = this; }
  select(){ this.selected = true; }
  blur(){ this.blurCount += 1; if (document.activeElement === this) document.activeElement = null; }
  contains(node){
    if (node === this) return true;
    return this.children.some((child)=>child === node || (typeof child.contains === 'function' && child.contains(node)));
  }
  closest(){ return null; }
}

const elements = new Map();
const getElement = (id)=>{
  if (!elements.has(id)) elements.set(id, new MockElement(id));
  return elements.get(id);
};
const picker = getElement('eventPicker');
const input = getElement('eventSearch');
const button = getElement('eventPickerBtn');
const list = getElement('eventList');
picker.append(input, button, list);
list.hidden = true;

const documentListeners = new Map();
const document = {
  activeElement: null,
  body: getElement('body'),
  visibilityState: 'visible',
  getElementById: getElement,
  createElement: (tag)=>new MockElement(tag),
  addEventListener: (name, handler)=>documentListeners.set(name, handler),
};

const storage = new Map();
const localStorage = {
  getItem:(key)=>storage.has(key) ? storage.get(key) : null,
  setItem:(key,value)=>storage.set(key,String(value)),
  removeItem:(key)=>storage.delete(key),
};

const window = {
  document,
  localStorage,
  location:{ href:'http://localhost/centro-mando/index.html' },
  addEventListener(){},
  A33Storage:null,
};

const context = vm.createContext({
  window, document, localStorage,
  console, Intl, Date, Number, String, Object, Array, Map, Set, Math, JSON, RegExp, Promise,
  setTimeout, clearTimeout,
  requestAnimationFrame:(callback)=>callback(),
});

const hooks = `\nwindow.__A33_SELECTOR_TEST = { state:()=>state, selectVisualEvent, selectGlobalView, renderEventList, renderVisualHeader };`;
vm.runInContext(app + hooks, context, { filename:'centro-mando/app.js' });

const api = window.__A33_SELECTOR_TEST;
const state = api.state();
state.events = [
  { id:1, name:'Julio 2026', groupName:'Eventos' },
  { id:2, name:'Agosto 2026', groupName:'Eventos' },
];
state.eventsById = new Map(state.events.map((event)=>[event.id,event]));
state.posActiveEventId = 1;
state.posActiveEvent = state.events[0];

// Aislar el smoke del acceso IndexedDB: sin base, los resúmenes terminan en estados vacíos controlados.
state.db = null;

(async()=>{
  state.visualMode = 'EVENTO';
  state.visualEventId = 1;
  state.visualEvent = state.eventsById.get(1);
  api.renderVisualHeader();
  assert.strictEqual(input.value, 'Julio 2026', 'Valor inicial incorrecto');

  // Safari/iPad: el input conserva foco mientras se toca una opción.
  input.focus();
  input.value = 'GLOBAL (Activos)';
  await api.selectGlobalView();
  assert.strictEqual(state.visualMode, 'GLOBAL', 'No cambió a GLOBAL');
  assert.strictEqual(input.value, 'GLOBAL (Activos)', 'GLOBAL no quedó visible');
  assert.strictEqual(list.hidden, true, 'Lista no cerró al elegir GLOBAL');
  assert.strictEqual(document.activeElement, null, 'El teclado/foco no cerró en GLOBAL');

  for (let cycle = 0; cycle < 5; cycle += 1){
    input.focus();
    input.value = cycle % 2 ? 'Agosto' : 'Julio';
    const id = cycle % 2 ? 2 : 1;
    await api.selectVisualEvent(id);
    assert.strictEqual(state.visualMode, 'EVENTO', `Ciclo ${cycle + 1}: no cambió a evento`);
    assert.strictEqual(state.visualEventId, id, `Ciclo ${cycle + 1}: evento incorrecto`);
    assert.strictEqual(input.value, state.eventsById.get(id).name, `Ciclo ${cycle + 1}: texto visible incorrecto`);
    assert.strictEqual(list.hidden, true, `Ciclo ${cycle + 1}: lista abierta`);
    assert.strictEqual(document.activeElement, null, `Ciclo ${cycle + 1}: foco atrapado`);
    assert.strictEqual(state.posActiveEventId, 1, `Ciclo ${cycle + 1}: cambió evento activo POS`);

    input.focus();
    await api.selectGlobalView();
    assert.strictEqual(input.value, 'GLOBAL (Activos)', `Ciclo ${cycle + 1}: regreso GLOBAL incorrecto`);
    assert.strictEqual(document.activeElement, null, `Ciclo ${cycle + 1}: teclado quedó abierto al volver GLOBAL`);
  }

  await api.selectVisualEvent(1);
  await api.selectVisualEvent(2);
  assert.strictEqual(input.value, 'Agosto 2026', 'Evento → otro evento falló');
  assert.strictEqual(state.posActiveEventId, 1, 'Visualizar evento alteró POS');
  assert(input.blurCount >= 12, 'No se ejecutó blur táctil en las selecciones');

  console.log('SELECTOR GLOBAL/EVENTO SMOKE OK');
  console.log('- GLOBAL → evento repetido 5 veces');
  console.log('- Evento → GLOBAL → evento y evento → evento');
  console.log('- Valor visible, lista, foco/teclado y separación POS verificados');
  console.log('- Revisión PWA y caché del Service Worker verificada');
})().catch((error)=>{
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
