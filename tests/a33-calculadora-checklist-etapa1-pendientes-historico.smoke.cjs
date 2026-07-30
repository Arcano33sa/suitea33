'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'calculadora/index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'calculadora/sw.js'), 'utf8');

const pendingPos = html.indexOf('<h3>Pendientes</h3>');
const historyPos = html.indexOf('<h3>Histórico</h3>');
const selectedPos = html.indexOf('id="a33-checklist-seleccion"');
assert(pendingPos >= 0 && historyPos > pendingPos && selectedPos > historyPos, 'Orden visual Checklist incorrecto');
assert(html.includes('id="a33-checklist-pendientes"'), 'Falta host Pendientes');
assert(html.includes('id="a33-checklist-historico"'), 'Falta host Histórico');
assert(html.includes('function a33ChecklistIsClosed(lote)'), 'Falta clasificación explícita de cierre');
assert(html.includes('const pendingLots = A33ChecklistLots.filter((lote) => !a33ChecklistIsClosed(lote));'), 'Pendientes no filtra por cierre explícito');
assert(html.includes('const historyLots = A33ChecklistLots.filter((lote) => a33ChecklistIsClosed(lote));'), 'Histórico no filtra por cierre explícito');
assert(html.includes('const actionLabel = isHistory ? "Ver" : "Usar";'), 'Acciones Usar/Ver no están separadas');
assert(!html.includes('button.textContent = "Hecho"'), 'Etapa 1 no debe implementar botón Hecho');
assert(html.includes('.a33-checklist-history-table th,') && html.includes('text-align: center;'), 'Falta centrado de tabla');
assert(html.includes('.a33-checklist-lot') && html.includes('overflow-wrap: anywhere;'), 'Lotes largos no están blindados');
assert(html.includes('@media (max-width: 760px)'), 'Falta responsive iPad/móvil');
assert(html.includes('navigator.serviceWorker.register("./sw.js?v=4.20.97&r=10")'), 'Registro SW del módulo no fue actualizado');
assert(sw.includes("const MODULE_CACHE_REV = '10';"), 'Cache de Calculadora no fue incrementado');
assert(sw.includes("'./index.html?v=4.20.97&r=19'"), 'Precache no apunta al HTML nuevo');

class MockClassList {
  constructor(owner){ this.owner = owner; this.values = new Set(); }
  add(...names){ names.forEach((n)=>this.values.add(n)); }
  remove(...names){ names.forEach((n)=>this.values.delete(n)); }
  toggle(name, force){
    const shouldAdd = force === undefined ? !this.values.has(name) : !!force;
    if (shouldAdd) this.values.add(name); else this.values.delete(name);
    return shouldAdd;
  }
  contains(name){ return this.values.has(name); }
}

class MockElement {
  constructor(tag='div', id=''){
    this.tagName = String(tag).toUpperCase();
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = new Map();
    this.className = '';
    this.classList = new MockClassList(this);
    this.textContent = '';
    this.disabled = false;
    this.checked = false;
    this.type = '';
    this.hidden = false;
    this.listeners = new Map();
    this._innerHTML = '';
  }
  set innerHTML(value){ this._innerHTML = String(value); this.children = []; }
  get innerHTML(){ return this._innerHTML; }
  appendChild(child){ child.parentNode = this; this.children.push(child); return child; }
  append(...children){ children.forEach((child)=>this.appendChild(child)); }
  setAttribute(name, value){ this.attributes.set(name, String(value)); }
  removeAttribute(name){ this.attributes.delete(name); }
  addEventListener(name, fn){ this.listeners.set(name, fn); }
  focus(){}
  closest(selector){
    if (selector === '[data-checklist-identity]' && this.dataset.checklistIdentity) return this;
    return this.parentNode ? this.parentNode.closest(selector) : null;
  }
  descendants(){ return this.children.flatMap((child)=>[child, ...child.descendants()]); }
  querySelectorAll(selector){
    const all = this.descendants();
    if (selector === 'input[type="checkbox"]') return all.filter((el)=>el.tagName === 'INPUT' && el.type === 'checkbox');
    if (selector === '.a33-checklist-history-row') return all.filter((el)=>String(el.className).split(/\s+/).includes('a33-checklist-history-row'));
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
  body: new MockElement('body', 'body'),
  getElementById(id){ return elements.get(id) || null; },
  createElement(tag){ return new MockElement(tag); },
  querySelectorAll(selector){
    const out = [];
    for (const el of elements.values()) out.push(...el.querySelectorAll(selector));
    return out;
  }
};

document.body.classList = new MockClassList(document.body);

const lots = [
  {
    id:'P-1', codigo:'A33JUL2026-0001', fecha:'2026-07-30', volTotal:3720,
    volVino:2000, volVodka:300, volJugo:700, volSirope:300, volAgua:420
  },
  {
    id:'P-2', codigo:'A33JUL2026-0002', fecha:'2026-07-29', volTotal:1000,
    volVino:500, checklistProduccion:{schema:1,items:{vino:true,vodka:true,jugo:true,sirope:true,agua:true}}
  },
  {
    id:'H-1', codigo:'A33JUL2026-0003', fecha:'2026-07-28', volTotal:750,
    volVino:500, checklistProduccion:{schema:1,cerrado:true,items:{vino:true,vodka:false,jugo:false,sirope:false,agua:false}}
  }
];
const localStorage = {
  getItem(key){ return key === 'arcano33_lotes' ? JSON.stringify(lots) : null; },
  setItem(){ throw new Error('El smoke test de estructura no debe escribir datos'); }
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
assert(start >= 0 && end > start, 'No se pudo aislar el bloque Checklist');
const checklistCode = html.slice(start, end) + `\n;globalThis.__checklistApi={
  render:a33RenderChecklistHistory,
  renderSelected:a33RenderSelectedChecklist,
  isClosed:a33ChecklistIsClosed,
  findIndex:a33ChecklistFindIndex,
  getLots:()=>A33ChecklistLots
};`;
vm.runInContext(checklistCode, context, {filename:'calculadora-checklist.js'});
const api = context.__checklistApi;
api.render({preserveSelection:false});

const buttonsIn = (id)=>elements.get(id).descendants().filter((el)=>el.tagName === 'BUTTON').map((el)=>el.textContent);
assert.deepStrictEqual(buttonsIn('a33-checklist-pendientes'), ['Usar','Usar'], 'Pendientes debe contener únicamente Usar');
assert.deepStrictEqual(buttonsIn('a33-checklist-historico'), ['Ver'], 'Histórico debe contener únicamente Ver');
assert.strictEqual(api.isClosed(lots[1]), false, 'Marcar todos los checkbox no debe cerrar automáticamente');
assert.strictEqual(api.isClosed(lots[2]), true, 'La marca explícita de cierre no fue reconocida');

const loaded = api.getLots();
const closedIndex = api.findIndex(loaded, 'H-1');
api.renderSelected(closedIndex);
let checks = elements.get('a33-checklist-contenido').querySelectorAll('input[type="checkbox"]');
assert(checks.length > 0 && checks.every((input)=>input.disabled), 'Ver histórico debe ser solo consulta');
assert.strictEqual(elements.get('a33-checklist-estado').textContent, 'Checklist cerrado: vista de consulta.', 'Estado histórico incorrecto');

const pendingIndex = api.findIndex(loaded, 'P-1');
api.renderSelected(pendingIndex);
checks = elements.get('a33-checklist-contenido').querySelectorAll('input[type="checkbox"]');
assert(checks.length > 0 && checks.every((input)=>!input.disabled), 'Usar pendiente debe conservar checkbox editables');

console.log('PASS a33-calculadora-checklist-etapa1: 27/27 controles cubiertos');
