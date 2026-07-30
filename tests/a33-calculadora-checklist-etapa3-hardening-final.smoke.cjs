'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'calculadora/index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'calculadora/sw.js'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'calculadora/manifest.webmanifest'), 'utf8');
const release = fs.readFileSync(path.join(root, 'assets/js/a33-release.js'), 'utf8');
const build = fs.readFileSync(path.join(root, 'assets/js/a33-build.js'), 'utf8');

function check(condition, message) { assert.ok(condition, message); }

check(html.includes('doneButton.textContent = "Hecho";'), 'Falta botón Hecho');
check(html.includes('function a33CompleteSelectedChecklist(button)'), 'Falta controlador de cierre');
check(html.includes('Marca todos los checkbox antes de pulsar Hecho.'), 'Falta aviso de validación');
check(html.includes('a33WriteChecklistState(identity, state, { close:true })'), 'Cierre no usa persistencia del checklist');
check(html.includes('payload.cerrado = true;'), 'Falta marca persistente de cierre');
check(html.includes('payload.estadoCierre = "CERRADO";'), 'Falta estado CERRADO');
check(html.includes('Checklist cerrado · Solo consulta'), 'Falta indicador de consulta');
check(html.includes('checkbox.disabled = isClosed;'), 'Histórico no bloquea checkbox');
check(html.includes('const actionLabel = isHistory ? "Ver" : "Usar";'), 'Acciones Usar/Ver incorrectas');
check(html.includes('let A33ChecklistClosing = false;'), 'Falta guardia anti doble cierre');
check(html.includes('if (A33ChecklistClosing) return false;'), 'Guardia anti doble cierre no se aplica');
check(html.includes('navigator.serviceWorker.register("./sw.js?v=4.20.97&r=10")'), 'Registro SW no actualizado');
check(sw.includes("const MODULE_CACHE_REV = '10';"), 'Cache SW no incrementado');
check(sw.includes("'./index.html?v=4.20.97&r=19'"), 'Precache no actualizado');
check(html.includes('manifest.webmanifest?v=4.20.97&r=12'), 'Manifest no fue versionado');
check(manifest.includes('"start_url": "./index.html?v=4.20.97&r=14"'), 'Start URL PWA no fue versionada');
check(sw.includes("'./manifest.webmanifest?v=4.20.97&r=12'"), 'Manifest no está coherente en precache');
check(sw.includes("a33-release.js?v=4.20.97&r=55"), 'Release no está coherente en SW');
check(html.includes('a33-release.js?v=4.20.97&r=55'), 'Release no está coherente en HTML');
check(release.includes("const rev = 2;"), 'Release global no avanzó a r2');
check(release.includes("const lastResort = '4.20.97 r2';"), 'Fallback visible no avanzó a r2');
check(build.includes("const REV = '2';"), 'Build global no avanzó a r2');
check(build.includes("calculadora:'10'"), 'Build de Calculadora no avanzó a m10');
check(html.includes('let A33ChecklistSelecting = false;'), 'Falta guardia anti doble selección');
check(html.includes('button.dataset.checklistBusy === "1"'), 'Falta guardia anti doble toque Usar/Ver');
check(html.includes('button[data-checklist-identity]'), 'La selección no está limitada a botones operativos');
check(html.includes('dataset.checklistBound !== "1"'), 'Falta blindaje de listeners duplicados');
check(html.includes('window.__A33ChecklistStorageBound'), 'Falta blindaje del listener storage');
check(html.includes('window.__A33ChecklistKeydownBound'), 'Falta blindaje del listener de teclado');
check(html.includes('{ changedKey:key, changedValue:!!checked }'), 'Cambio de checkbox no usa merge concurrente');
check(html.includes('const freshLots = a33ReadChecklistLots();'), 'Hecho no revalida almacenamiento vigente');
check(html.includes('...previous,'), 'Persistencia no conserva metadatos históricos');
check(html.includes('overscroll-behavior: contain;'), 'Falta hardening responsive del modal');
check(html.includes('@media (max-height: 520px) and (orientation: landscape)'), 'Falta hardening de orientación horizontal');
check(html.includes(':focus-visible'), 'Falta foco accesible');
check(!html.includes('localStorage.clear('), 'Calculadora borra localStorage');
check(!html.includes('indexedDB.deleteDatabase('), 'Calculadora borra IndexedDB');

class MockClassList {
  constructor(){ this.values = new Set(); }
  add(...names){ names.forEach((name)=>this.values.add(name)); }
  remove(...names){ names.forEach((name)=>this.values.delete(name)); }
  toggle(name, force){
    const add = force === undefined ? !this.values.has(name) : !!force;
    if (add) this.values.add(name); else this.values.delete(name);
    return add;
  }
  contains(name){ return this.values.has(name); }
}

class MockElement {
  constructor(tag='div', id='') {
    this.tagName = String(tag).toUpperCase();
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = new Map();
    this.className = '';
    this.classList = new MockClassList();
    this.textContent = '';
    this.disabled = false;
    this.checked = false;
    this.type = '';
    this.hidden = false;
    this.listeners = new Map();
    this._innerHTML = '';
    this.isConnected = true;
  }
  set innerHTML(value){ this._innerHTML = String(value); this.children.forEach((child)=>{ child.isConnected = false; }); this.children = []; }
  get innerHTML(){ return this._innerHTML; }
  appendChild(child){ child.parentNode = this; child.isConnected = true; this.children.push(child); return child; }
  append(...children){ children.forEach((child)=>this.appendChild(child)); }
  setAttribute(name, value){ this.attributes.set(name, String(value)); }
  removeAttribute(name){ this.attributes.delete(name); }
  addEventListener(name, fn){ this.listeners.set(name, fn); }
  focus(){}
  closest(selector){
    if (selector === '[data-checklist-identity]' && this.dataset.checklistIdentity) return this;
    if (selector === '.a33-checklist-item-row' && String(this.className).split(/\s+/).includes('a33-checklist-item-row')) return this;
    return this.parentNode ? this.parentNode.closest(selector) : null;
  }
  descendants(){ return this.children.flatMap((child)=>[child, ...child.descendants()]); }
  querySelectorAll(selector){
    const all = this.descendants();
    if (selector === 'input[type="checkbox"]') return all.filter((el)=>el.tagName === 'INPUT' && el.type === 'checkbox');
    if (selector === '.a33-checklist-history-row') return all.filter((el)=>String(el.className).split(/\s+/).includes('a33-checklist-history-row'));
    if (selector === 'button') return all.filter((el)=>el.tagName === 'BUTTON');
    return [];
  }
  querySelector(selector){
    if (selector === 'input[type="checkbox"]:not(:disabled)') return this.querySelectorAll('input[type="checkbox"]').find((el)=>!el.disabled) || null;
    if (selector === 'input[type="checkbox"]') return this.querySelectorAll(selector)[0] || null;
    return null;
  }
}

const ids = [
  'a33-checklist-pendientes', 'a33-checklist-historico', 'a33-checklist-seleccion',
  'a33-checklist-contenido', 'a33-checklist-estado', 'a33-checklist-view',
  'btn-cerrar-checklist', 'btn-checklist'
];
const elements = new Map(ids.map((id)=>[id, new MockElement('div', id)]));
const document = {
  body:new MockElement('body', 'body'),
  getElementById(id){
    if (elements.has(id)) return elements.get(id);
    for (const rootEl of elements.values()) {
      const found = rootEl.descendants().find((el)=>el.id === id);
      if (found) return found;
    }
    return null;
  },
  createElement(tag){ return new MockElement(tag); },
  querySelectorAll(selector){
    const out = [];
    for (const el of elements.values()) out.push(...el.querySelectorAll(selector));
    return out;
  }
};
document.body.classList = new MockClassList();

const originalLots = [
  {
    id:'P-1', codigo:'A33JUL2026-0001', fecha:'2026-07-30', volTotal:3720,
    volVino:2000, volVodka:300, volJugo:700, volSirope:300, volAgua:420,
    productosProducidos:[{productoId:'ARC-1',cantidad:1}]
  },
  {
    id:'P-2', codigo:'A33JUL2026-0002', fecha:'2026-07-29', volTotal:1000,
    volVino:500, volVodka:100, volJugo:200, volSirope:100, volAgua:100,
    checklistProduccion:{schema:1,items:{vino:true,vodka:true,jugo:true,sirope:true,agua:true}}
  },
  {
    id:'H-1', codigo:'A33JUL2026-0003', fecha:'2026-07-28', volTotal:750,
    volVino:500, checklistProduccion:{schema:1,cerrado:true,estadoCierre:'CERRADO',items:{vino:true,vodka:false,jugo:false,sirope:false,agua:false}}
  }
];
let storedLots = JSON.parse(JSON.stringify(originalLots));
let writeCount = 0;
const localStorage = {
  getItem(key){ return key === 'arcano33_lotes' ? JSON.stringify(storedLots) : null; },
  setItem(key, value){
    if (key !== 'arcano33_lotes') return;
    storedLots = JSON.parse(value);
    writeCount += 1;
  }
};
const windowObj = { localStorage, A33Storage:null, A33LotCode:null };
const context = vm.createContext({
  console, Date, Math, Number, String, Object, Array, Set, Map, JSON, Intl,
  document, window:windowObj, localStorage,
  normalizarCodigoLote:(value)=>String(value || '').trim(),
  formatearFechaBonita:(date)=>date.toISOString().slice(0,10),
  formatLitros:(ml)=>`${(Number(ml || 0)/1000).toFixed(2)} L`,
  formatMl:(ml)=>`${Number(ml || 0)} ml`
});

const start = html.indexOf('    const A33_CHECKLIST_STORAGE_KEY = "arcano33_lotes";');
const end = html.indexOf('function registerCalculadoraServiceWorker()', start);
check(start >= 0 && end > start, 'No se pudo aislar el bloque Checklist');
const code = html.slice(start, end) + `\n;globalThis.__api={
  render:a33RenderChecklistHistory,
  renderSelected:a33RenderSelectedChecklist,
  findIndex:a33ChecklistFindIndex,
  getLots:()=>A33ChecklistLots,
  state:a33ChecklistState,
  allComplete:a33ChecklistAllComplete,
  write:a33WriteChecklistState,
  complete:a33CompleteSelectedChecklist,
  persist:a33PersistChecklistChange,
  payload:a33ChecklistPayload,
  isClosed:a33ChecklistIsClosed
};`;
vm.runInContext(code, context, {filename:'calculadora-checklist-etapa2.js'});
const api = context.__api;
const buttons = (id)=>elements.get(id).descendants().filter((el)=>el.tagName === 'BUTTON');
const buttonTexts = (id)=>buttons(id).map((el)=>el.textContent);

api.render({preserveSelection:false});
assert.deepStrictEqual(buttonTexts('a33-checklist-pendientes'), ['Usar','Usar'], 'Pendientes iniciales incorrectos');
assert.deepStrictEqual(buttonTexts('a33-checklist-historico'), ['Ver'], 'Histórico inicial incorrecto');

let index = api.findIndex(api.getLots(), 'P-1');
api.renderSelected(index);
let contentButtons = buttons('a33-checklist-contenido');
let done = contentButtons.find((el)=>el.textContent === 'Hecho');
check(done, 'Pendiente no muestra Hecho');
let checks = elements.get('a33-checklist-contenido').querySelectorAll('input[type="checkbox"]');
check(checks.length === 5 && checks.every((input)=>!input.disabled), 'Pendiente no mantiene checkbox editables');
const writesBeforeInvalid = writeCount;
assert.strictEqual(api.complete(done), false, 'Hecho permitió cierre incompleto');
assert.strictEqual(writeCount, writesBeforeInvalid, 'Cierre incompleto escribió datos');
assert.strictEqual(elements.get('a33-checklist-estado').textContent, 'Marca todos los checkbox antes de pulsar Hecho.', 'Aviso incompleto incorrecto');
check(!api.isClosed(storedLots.find((row)=>row.id === 'P-1')), 'Cierre incompleto alteró estado');

const fullState = {vino:true,vodka:true,jugo:true,sirope:true,agua:true};
const writeStateResult = api.write('P-1', fullState);
check(writeStateResult.ok, 'No se pudo preparar el checklist completo');
api.render({selectIdentity:'P-1'});
index = api.findIndex(api.getLots(), 'P-1');
api.renderSelected(index);
done = buttons('a33-checklist-contenido').find((el)=>el.textContent === 'Hecho');
check(done, 'Hecho desapareció antes del cierre');
const writesBeforeClose = writeCount;
const snapshot = JSON.parse(JSON.stringify(storedLots.find((row)=>row.id === 'P-1')));
assert.strictEqual(api.complete(done), true, 'No cerró checklist completo');
assert.strictEqual(writeCount, writesBeforeClose + 1, 'Cierre realizó más de una escritura');

const closed = storedLots.find((row)=>row.id === 'P-1');
check(closed && closed.checklistProduccion.cerrado === true, 'Cierre no persistió cerrado=true');
assert.strictEqual(closed.checklistProduccion.estadoCierre, 'CERRADO', 'Estado de cierre incorrecto');
check(Boolean(closed.checklistProduccion.cerradoAt), 'Falta fecha persistente de cierre');
assert.deepStrictEqual(closed.checklistProduccion.items, fullState, 'Cierre no conservó marcas');
assert.strictEqual(closed.codigo, snapshot.codigo, 'Cierre cambió lote');
assert.strictEqual(closed.fecha, snapshot.fecha, 'Cierre cambió fecha');
assert.strictEqual(closed.volTotal, snapshot.volTotal, 'Cierre cambió volumen');
assert.strictEqual(closed.volVino, snapshot.volVino, 'Cierre cambió ingredientes');
assert.strictEqual(storedLots.length, originalLots.length, 'Cierre duplicó lotes');
assert.deepStrictEqual(buttonTexts('a33-checklist-pendientes'), ['Usar'], 'Cerrado no salió de Pendientes');
assert.deepStrictEqual(buttonTexts('a33-checklist-historico'), ['Ver','Ver'], 'Cerrado no apareció una sola vez en Histórico');

checks = elements.get('a33-checklist-contenido').querySelectorAll('input[type="checkbox"]');
check(checks.length === 5 && checks.every((input)=>input.disabled && input.checked), 'Consulta histórica no bloqueó/conservó checkbox');
contentButtons = buttons('a33-checklist-contenido');
check(!contentButtons.some((el)=>el.textContent === 'Hecho'), 'Consulta histórica muestra Hecho');
check(elements.get('a33-checklist-contenido').descendants().some((el)=>el.textContent === 'Checklist cerrado · Solo consulta'), 'Falta indicador de consulta');

const writesBeforeDouble = writeCount;
assert.strictEqual(api.complete(done), false, 'Doble toque reabrió o volvió a cerrar');
assert.strictEqual(writeCount, writesBeforeDouble, 'Doble toque generó escritura adicional');

api.render({preserveSelection:false});
assert.deepStrictEqual(buttonTexts('a33-checklist-pendientes'), ['Usar'], 'Recarga simulada reabrió checklist');
assert.deepStrictEqual(buttonTexts('a33-checklist-historico'), ['Ver','Ver'], 'Recarga simulada perdió histórico');
api.render({preserveSelection:false});
assert.deepStrictEqual(buttonTexts('a33-checklist-pendientes'), ['Usar'], 'Render repetido duplicó Pendientes');
assert.deepStrictEqual(buttonTexts('a33-checklist-historico'), ['Ver','Ver'], 'Render repetido duplicó Histórico');

const legacyDirect = api.state({checklistProduccion:{vino:true,vodka:false,jugo:true,sirope:false,agua:true}});
assert.deepStrictEqual(JSON.parse(JSON.stringify(legacyDirect)), {vino:true,vodka:false,jugo:true,sirope:false,agua:true}, 'No lee estructura histórica directa');

storedLots.push({
  id:'C-1', codigo:'A33JUL2026-0099', fecha:'2026-07-26', volTotal:500,
  volVino:100, volVodka:100, volJugo:100, volSirope:100, volAgua:100,
  checklistProduccion:{schema:1,notaLegacy:'conservar',items:{vino:false,vodka:false,jugo:false,sirope:false,agua:false}}
});
api.render({selectIdentity:'C-1'});
index = api.findIndex(api.getLots(), 'C-1');
api.renderSelected(index);
const concurrent = storedLots.find((row)=>row.id === 'C-1');
concurrent.checklistProduccion.items.vodka = true;
const writesBeforeConcurrent = writeCount;
assert.strictEqual(api.persist('vino', true), true, 'No guardó cambio concurrente');
assert.strictEqual(writeCount, writesBeforeConcurrent + 1, 'Cambio concurrente escribió más de una vez');
const concurrentSaved = storedLots.find((row)=>row.id === 'C-1');
check(concurrentSaved.checklistProduccion.items.vino === true, 'No guardó checkbox activo');
check(concurrentSaved.checklistProduccion.items.vodka === true, 'Pisó checkbox actualizado por otra lectura');
assert.strictEqual(concurrentSaved.checklistProduccion.notaLegacy, 'conservar', 'Perdió metadato histórico');

const originalSetItem = localStorage.setItem;
const originalConsoleError = console.error;
localStorage.setItem = () => { throw new Error('storage-failure'); };
console.error = () => {};
const failedWrite = api.write('C-1', {vino:true,vodka:true,jugo:true,sirope:true,agua:true});
console.error = originalConsoleError;
localStorage.setItem = originalSetItem;
assert.strictEqual(failedWrite.ok, false, 'Excepción de almacenamiento escapó sin manejar');

let sharedLots = [{
  id:'S-1', codigo:'A33JUL2026-0004', fecha:'2026-07-27', volTotal:500,
  volVino:100, volVodka:100, volJugo:100, volSirope:100, volAgua:100,
  checklistProduccion:{schema:1,items:{vino:true,vodka:true,jugo:true,sirope:true,agua:true}}
}];
let sharedRev = 7;
let sharedWrites = 0;
let sharedSource = '';
const sharedStorage = {
  sharedGet(){ return JSON.parse(JSON.stringify(sharedLots)); },
  sharedRead(){ return {data:JSON.parse(JSON.stringify(sharedLots)),meta:{rev:sharedRev}}; },
  sharedReplaceExact(key, next, options){
    assert.strictEqual(key, 'arcano33_lotes');
    assert.strictEqual(options.baseRev, sharedRev, 'Cierre compartido perdió revisión base');
    sharedLots = JSON.parse(JSON.stringify(next));
    sharedRev += 1;
    sharedWrites += 1;
    sharedSource = options.source;
    return {ok:true,data:JSON.parse(JSON.stringify(sharedLots)),meta:{rev:sharedRev}};
  }
};
windowObj.A33Storage = sharedStorage;
context.A33Storage = sharedStorage;
api.render({selectIdentity:'S-1'});
const sharedDone = buttons('a33-checklist-contenido').find((el)=>el.textContent === 'Hecho');
check(sharedDone, 'Ruta A33Storage no muestra Hecho');
assert.strictEqual(api.complete(sharedDone), true, 'Ruta A33Storage no cerró');
assert.strictEqual(sharedWrites, 1, 'Ruta A33Storage escribió más de una vez');
assert.strictEqual(sharedSource, 'calculadora-checklist-cierre', 'Ruta A33Storage no identifica cierre');
check(sharedLots[0].checklistProduccion.cerrado === true, 'Ruta A33Storage no persistió cierre');

console.log('PASS a33-calculadora-checklist-etapa3: hardening final cubierto');
