'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const app = read('centro-mando/app.js');
const index = read('centro-mando/index.html');
const style = read('centro-mando/style.css');
const sw = read('centro-mando/sw.js');
const manifest = JSON.parse(read('centro-mando/manifest.webmanifest'));

assert(app.includes('function closePickerAfterSelection()'), 'Falta cierre táctil del selector');
assert(app.includes('display.textContent = visualName()'), 'La selección no sincroniza el valor visible');
assert(app.includes('display.blur()'), 'La selección no libera el foco');
assert(app.includes('function pickerEvents()'), 'Falta listado directo de eventos');
assert(!app.includes("addEventListener('input'"), 'El selector todavía obliga a escribir o filtrar');
assert(app.includes('summaryRenderToken'), 'Falta blindaje contra resultados asíncronos obsoletos');
assert(app.includes('pickerSelectionToken'), 'Falta blindaje contra selección duplicada');
assert(index.includes('<button id="eventSearch"'), 'El selector todavía es un campo de escritura');
assert(!index.includes('placeholder="Buscar evento'), 'Sigue apareciendo búsqueda obligatoria');
assert(index.includes('app.js?v=4.20.95&r=21'), 'Cache-bust del selector no actualizado');
assert(index.includes('style.css?v=4.20.95&r=17'), 'Cache-bust de estilos no actualizado');
assert(index.includes('manifest.webmanifest?v=4.20.95&r=4'), 'Manifest no actualizado');
assert(style.includes('position:static;') && style.includes('grid-column:1 / -1;'), 'La lista puede quedar tapada por el bloque siguiente');
assert(sw.includes("const MODULE_CACHE_REV = '4'"), 'Service Worker no incrementó caché');
assert(sw.includes("'./app.js?v=4.20.95&r=21'"), 'Service Worker no precachea la corrección');
assert(sw.includes("'./style.css?v=4.20.95&r=17'"), 'Service Worker no precachea el estilo corregido');
assert.strictEqual(manifest.start_url, './index.html?v=4.20.95&r=21', 'PWA no apunta a la revisión corregida');

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
    const classes = new Set();
    this.classList = {
      add:(name)=>classes.add(name),
      remove:(name)=>classes.delete(name),
      contains:(name)=>classes.has(name),
    };
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
  querySelector(selector){
    if (selector === '.cmd-picker-item') return this.children.find((child)=>String(child.className).includes('cmd-picker-item')) || null;
    return null;
  }
  closest(){ return null; }
}

const elements = new Map();
const getElement = (id)=>{
  if (!elements.has(id)) elements.set(id, new MockElement(id));
  return elements.get(id);
};
const picker = getElement('eventPicker');
const display = getElement('eventSearch');
const button = getElement('eventPickerBtn');
const list = getElement('eventList');
picker.append(display, button, list);
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

const hooks = `\nwindow.__A33_SELECTOR_TEST = { state:()=>state, selectVisualEvent, selectGlobalView, renderEventList, renderVisualHeader, showEventList, hideEventList };`;
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
state.db = null;

(async()=>{
  state.visualMode = 'EVENTO';
  state.visualEventId = 1;
  state.visualEvent = state.eventsById.get(1);
  api.renderVisualHeader();
  assert.strictEqual(display.textContent, 'Julio 2026', 'Valor inicial incorrecto');

  api.renderEventList();
  assert.strictEqual(list.children.length, 3, 'La lista no muestra GLOBAL y todos los eventos');
  assert(list.children[1].innerHTML.includes('Julio 2026'), 'Julio 2026 no aparece directamente');
  assert(list.children[2].innerHTML.includes('Agosto 2026'), 'Agosto 2026 no aparece directamente');

  api.showEventList();
  assert.strictEqual(list.hidden, false, 'La lista no abre');
  assert.strictEqual(display.getAttribute('aria-expanded'), 'true', 'Estado accesible incorrecto al abrir');

  display.focus();
  await api.selectGlobalView();
  assert.strictEqual(state.visualMode, 'GLOBAL', 'No cambió a GLOBAL');
  assert.strictEqual(display.textContent, 'GLOBAL (Activos)', 'GLOBAL no quedó visible');
  assert.strictEqual(list.hidden, true, 'Lista no cerró al elegir GLOBAL');
  assert.strictEqual(document.activeElement, null, 'El foco no se liberó en GLOBAL');

  for (let cycle = 0; cycle < 5; cycle += 1){
    display.focus();
    const id = cycle % 2 ? 2 : 1;
    await api.selectVisualEvent(id);
    assert.strictEqual(state.visualMode, 'EVENTO', `Ciclo ${cycle + 1}: no cambió a evento`);
    assert.strictEqual(state.visualEventId, id, `Ciclo ${cycle + 1}: evento incorrecto`);
    assert.strictEqual(display.textContent, state.eventsById.get(id).name, `Ciclo ${cycle + 1}: texto visible incorrecto`);
    assert.strictEqual(list.hidden, true, `Ciclo ${cycle + 1}: lista abierta`);
    assert.strictEqual(document.activeElement, null, `Ciclo ${cycle + 1}: foco atrapado`);
    assert.strictEqual(state.posActiveEventId, 1, `Ciclo ${cycle + 1}: cambió evento activo POS`);

    display.focus();
    await api.selectGlobalView();
    assert.strictEqual(display.textContent, 'GLOBAL (Activos)', `Ciclo ${cycle + 1}: regreso GLOBAL incorrecto`);
    assert.strictEqual(document.activeElement, null, `Ciclo ${cycle + 1}: foco quedó abierto al volver GLOBAL`);
  }

  await api.selectVisualEvent(1);
  await api.selectVisualEvent(2);
  assert.strictEqual(display.textContent, 'Agosto 2026', 'Evento → otro evento falló');
  assert.strictEqual(state.posActiveEventId, 1, 'Visualizar evento alteró POS');
  assert(display.blurCount >= 12, 'No se ejecutó blur táctil en las selecciones');

  console.log('SELECTOR GLOBAL/EVENTO LISTA DIRECTA SMOKE OK');
  console.log('- Selector sin escritura ni teclado');
  console.log('- GLOBAL y todos los eventos visibles al abrir');
  console.log('- GLOBAL → evento repetido 5 veces');
  console.log('- Evento → GLOBAL → evento y evento → evento');
  console.log('- Separación del evento activo del POS verificada');
  console.log('- Revisión PWA y caché del Service Worker verificada');
})().catch((error)=>{
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
