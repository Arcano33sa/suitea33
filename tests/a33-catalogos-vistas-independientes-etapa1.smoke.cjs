'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const htmlPath = path.join(ROOT, 'catalogos', 'index.html');
const cssPath = path.join(ROOT, 'catalogos', 'style.css');
const scriptPath = path.join(ROOT, 'catalogos', 'script.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const source = fs.readFileSync(scriptPath, 'utf8');

const targets = ['productos','costos','materia-prima','envases','tapas','extras','bancos','clientes'];

assert(html.includes('<div class="cat-tabs" aria-label="Tarjetas de Catálogos">'), 'Falta portada de tarjetas');
assert(html.includes('<div class="cat-panels" hidden aria-hidden="true">'), 'Los paneles no inician ocultos');
assert(html.includes('data-cat-back'), 'Falta botón interno para volver a Catálogos');
assert(html.includes('⌂ Menú principal'), 'Falta acceso interno al Menú principal');
assert(!html.includes('class="cat-tab is-active"'), 'Quedó una tarjeta activa al entrar');
assert(!html.includes('class="cat-panel is-active"'), 'Quedó un panel activo al entrar');
assert(!source.includes('activateTabFromUrl'), 'Quedó la navegación antigua por pestañas');
assert(!source.includes('function bindTabs('), 'Quedó el binding antiguo de pestañas');
assert(!source.includes('window.open('), 'No se permiten pestañas nuevas');
assert(source.includes("const CATALOG_HISTORY_MARKER = 'a33-catalogos-vistas-v1'"), 'Falta marcador de historial');
assert(source.includes("window.addEventListener('popstate', syncCatalogNavigationFromHistory)"), 'Falta blindaje de Atrás');
assert(source.includes("window.history.pushState(getCatalogHistoryState('section', key)"), 'Falta entrada de historial por apartado');
assert(source.includes('if (catalogNavigationBound) return;'), 'Falta blindaje de listeners duplicados');
assert(css.includes('.cat-tabs[hidden]'), 'Falta ocultamiento fuerte de tarjetas');
assert(css.includes('.cat-panels[hidden]'), 'Falta ocultamiento fuerte de paneles');
assert(css.includes('.cat-section-nav'), 'Falta estilo de navegación interna');
assert(css.includes('overflow-x:hidden'), 'Falta blindaje contra scroll horizontal general');

targets.forEach((target) => {
  assert(html.includes(`data-target="${target}"`), `Falta tarjeta ${target}`);
  const panelNeedle = `data-panel="${target}" aria-hidden="true" tabindex="-1" hidden`;
  assert(html.includes(panelNeedle), `El panel ${target} no inicia oculto/estable`);
});

class FakeClassList {
  constructor(){ this.values = new Set(); }
  add(...items){ items.forEach((item) => this.values.add(item)); }
  remove(...items){ items.forEach((item) => this.values.delete(item)); }
  contains(item){ return this.values.has(item); }
  toggle(item, force){
    if (force === true){ this.add(item); return true; }
    if (force === false){ this.remove(item); return false; }
    if (this.contains(item)){ this.remove(item); return false; }
    this.add(item); return true;
  }
}

class FakeElement {
  constructor({ id='', classes=[], attrs={} } = {}){
    this.id = id;
    this.classList = new FakeClassList();
    classes.forEach((name) => this.classList.add(name));
    this.attrs = Object.assign(Object.create(null), attrs);
    this.hidden = false;
    this.listeners = Object.create(null);
    this.focused = false;
  }
  getAttribute(name){ return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  setAttribute(name, value){ this.attrs[name] = String(value); }
  addEventListener(type, handler){ (this.listeners[type] ||= []).push(handler); }
  dispatchEvent(event){
    const evt = event || {};
    evt.type ||= 'click';
    evt.target ||= this;
    evt.preventDefault ||= function(){};
    (this.listeners[evt.type] || []).forEach((handler) => handler(evt));
  }
  click(){ this.dispatchEvent({ type:'click', target:this, preventDefault(){} }); }
  focus(){ this.focused = true; }
}

const cardsWrap = new FakeElement({ classes:['cat-tabs'] });
const panelsWrap = new FakeElement({ classes:['cat-panels'], attrs:{ 'aria-hidden':'true' } });
panelsWrap.hidden = true;
const shell = new FakeElement({ classes:['cat-shell'] });
const backButton = new FakeElement({ attrs:{ 'data-cat-back':'' } });
const body = new FakeElement();
const cards = targets.map((target) => new FakeElement({
  id:`tab-${target}`,
  classes:['cat-tab'],
  attrs:{ 'data-target':target, 'aria-expanded':'false' }
}));
const panels = targets.map((target) => {
  const panel = new FakeElement({
    id:`panel-${target}`,
    classes:['cat-panel'],
    attrs:{ 'data-panel':target, 'aria-hidden':'true' }
  });
  panel.hidden = true;
  return panel;
});

function queryAll(selector){
  if (selector === '.cat-tab[data-target]') return cards;
  if (selector === '.cat-panel[data-panel]') return panels;
  if (selector === '[data-cat-back]') return [backButton];
  return [];
}
function queryOne(selector){
  if (selector === '.cat-tabs') return cardsWrap;
  if (selector === '.cat-panels') return panelsWrap;
  if (selector === '.cat-shell') return shell;
  if (selector === '[data-cat-back]') return backButton;
  const cardMatch = selector.match(/^\.cat-tab\[data-target="(.+)"\]$/);
  if (cardMatch) return cards.find((item) => item.getAttribute('data-target') === cardMatch[1]) || null;
  const panelMatch = selector.match(/^\.cat-panel\[data-panel="(.+)"\]$/);
  if (panelMatch) return panels.find((item) => item.getAttribute('data-panel') === panelMatch[1]) || null;
  return null;
}

const documentListeners = Object.create(null);
const documentStub = {
  body,
  readyState:'loading',
  getElementById(id){
    if (id === 'cat-back-to-overview') return null;
    return cards.concat(panels).find((item) => item.id === id) || null;
  },
  querySelector:queryOne,
  querySelectorAll:queryAll,
  addEventListener(type, handler){ (documentListeners[type] ||= []).push(handler); }
};

const windowListeners = Object.create(null);
const locationStub = {
  href:'https://a33.test/catalogos/index.html',
  pathname:'/catalogos/index.html',
  search:'',
  hash:'',
  protocol:'https:'
};
const historyEntries = [];
const historyStub = {
  state:null,
  pushCount:0,
  replaceState(state, _title, url){
    this.state = state;
    historyEntries[historyEntries.length - 1] = { state, url };
    const hashIndex = String(url || '').indexOf('#');
    locationStub.hash = hashIndex >= 0 ? String(url).slice(hashIndex) : '';
  },
  pushState(state, _title, url){
    this.state = state;
    this.pushCount += 1;
    historyEntries.push({ state, url });
    const hashIndex = String(url || '').indexOf('#');
    locationStub.hash = hashIndex >= 0 ? String(url).slice(hashIndex) : '';
  },
  back(){
    this.state = { a33Navigation:'a33-catalogos-vistas-v1', view:'overview', section:'' };
    locationStub.hash = '';
    (windowListeners.popstate || []).forEach((handler) => handler({ state:this.state }));
  }
};

const localStorageStub = {
  data:Object.create(null),
  getItem(key){ return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null; },
  setItem(key, value){ this.data[key] = String(value); }
};

const windowStub = {
  document:documentStub,
  location:locationStub,
  history:historyStub,
  localStorage:localStorageStub,
  navigator:{},
  addEventListener(type, handler){ (windowListeners[type] ||= []).push(handler); },
  scrollTo(){},
  setTimeout,
  clearTimeout
};
windowStub.window = windowStub;
windowStub.globalThis = windowStub;

const instrumented = source.replace(/\}\)\(\);\s*$/, `
  globalThis.__CAT_NAV_TEST__ = {
    bindCatalogNavigation,
    openCatalogSection,
    showCatalogOverview,
    syncCatalogNavigationFromHistory,
    currentSection: () => catalogCurrentSection
  };
})();`);
assert.notStrictEqual(instrumented, source, 'No se pudo instrumentar la navegación');

const context = {
  window:windowStub,
  globalThis:windowStub,
  document:documentStub,
  navigator:windowStub.navigator,
  localStorage:localStorageStub,
  console,
  setTimeout,
  clearTimeout,
  URL,
  URLSearchParams,
  decodeURIComponent,
  encodeURIComponent,
  Date,
  Math,
  JSON,
  Promise,
  Map,
  Set,
  confirm(){ return true; },
  alert(){}
};
vm.createContext(context);
vm.runInContext(instrumented, context, { filename:'catalogos/script.js' });

const api = windowStub.__CAT_NAV_TEST__;
assert(api, 'No se expuso la navegación para smoke');
api.bindCatalogNavigation();

assert.strictEqual(cardsWrap.hidden, false, 'La portada no quedó visible al iniciar');
assert.strictEqual(panelsWrap.hidden, true, 'Los paneles no quedaron ocultos al iniciar');
assert.strictEqual(historyStub.state.view, 'overview', 'El historial inicial no quedó en portada');

cards[0].click();
assert.strictEqual(api.currentSection(), 'productos', 'Productos no abrió');
assert.strictEqual(cardsWrap.hidden, true, 'Las tarjetas no se ocultaron');
assert.strictEqual(panelsWrap.hidden, false, 'Los paneles no se mostraron');
assert.strictEqual(panels[0].hidden, false, 'Productos no quedó visible');
assert.strictEqual(panels.filter((panel) => !panel.hidden).length, 1, 'Se superpusieron paneles');
assert.strictEqual(historyStub.pushCount, 1, 'No se creó una sola entrada de historial');

cards[0].click();
assert.strictEqual(historyStub.pushCount, 1, 'Doble toque duplicó el historial');

backButton.click();
assert.strictEqual(api.currentSection(), '', 'Volver no regresó a portada');
assert.strictEqual(cardsWrap.hidden, false, 'Volver no mostró las tarjetas');
assert.strictEqual(panelsWrap.hidden, true, 'Volver dejó paneles visibles');

api.syncCatalogNavigationFromHistory({
  state:{ a33Navigation:'a33-catalogos-vistas-v1', view:'section', section:'clientes' }
});
assert.strictEqual(api.currentSection(), 'clientes', 'Popstate no abrió Clientes');
assert.strictEqual(panels[7].hidden, false, 'Clientes no quedó visible por historial');
assert.strictEqual(panels.filter((panel) => !panel.hidden).length, 1, 'Popstate superpuso paneles');

console.log('OK a33-catalogos-vistas-independientes-etapa1.smoke');
