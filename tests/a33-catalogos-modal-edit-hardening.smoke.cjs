'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const scriptPath = path.join(ROOT, 'catalogos', 'script.js');
const htmlPath = path.join(ROOT, 'catalogos', 'index.html');
const swPath = path.join(ROOT, 'catalogos', 'sw.js');
const manifestPath = path.join(ROOT, 'catalogos', 'manifest.webmanifest');

const source = fs.readFileSync(scriptPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
const sw = fs.readFileSync(swPath, 'utf8');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

assert(source.includes('function openModalCAT(id)'), 'Falta openModalCAT');
assert(source.includes('function closeModalCAT(id)'), 'Falta closeModalCAT');
assert(source.includes('function bindDismissibleModalCAT('), 'Falta el enlace compartido de cierre');

const requiredBindings = [
  "bindDismissibleModalCAT('cat-envase-modal', ['cat-envase-close','cat-edit-envase-cancel'], closeEnvaseModalCAT)",
  "bindDismissibleModalCAT('cat-tapa-modal', ['cat-tapa-close','cat-edit-tapa-cancel'], closeTapaModalCAT)",
  "bindDismissibleModalCAT('cat-extra-modal', ['cat-extra-close','cat-edit-extra-cancel'], closeExtraModalCAT)",
  "bindDismissibleModalCAT('cat-bank-modal', ['cat-bank-close','cat-edit-bank-cancel'], closeBankModalCAT)"
];
requiredBindings.forEach((binding) => assert(source.includes(binding), `Falta binding: ${binding}`));

['envase','tapa','extra','bank'].forEach((name) => {
  assert(html.includes(`id="cat-${name}-modal"`), `Falta modal ${name}`);
  assert(html.includes(`id="cat-${name}-close"`), `Falta botón cerrar ${name}`);
  assert(html.includes(`id="cat-edit-${name}-cancel"`), `Falta botón cancelar ${name}`);
  assert(html.includes(`id="cat-edit-${name}-save"`), `Falta botón guardar ${name}`);
});

assert(!html.includes('class="cat-hero cat-card"'), 'El bloque introductorio todavía existe');
assert(!html.includes('Administración maestra de Productos'), 'El texto introductorio todavía existe');
assert(!html.includes('Datos maestros</span>'), 'La franja Datos maestros todavía existe');
assert(html.includes('script.js?v=4.20.95&r=32'), 'Index no apunta al script actualizado');
assert(source.includes("serviceWorker.register('./sw.js?v=4.20.95&r=5')"), 'Registro SW no fue actualizado');
assert(sw.includes("const MODULE_CACHE_REV = '36';"), 'Cache de Catálogos no fue incrementada');
assert(sw.includes("'./index.html?v=4.20.95&r=30'"), 'SW no precachea el index actualizado');
assert(sw.includes("'./script.js?v=4.20.95&r=32'"), 'SW no precachea el script actualizado');
assert(manifest.start_url === './index.html?v=4.20.95&r=25', 'Manifest no apunta al index actualizado');

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
  constructor(id){
    this.id = id;
    this.classList = new FakeClassList();
    this.attrs = Object.create(null);
    this.listeners = Object.create(null);
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.textContent = '';
    this.scrollTop = 7;
  }
  setAttribute(name, value){ this.attrs[name] = String(value); }
  getAttribute(name){ return this.attrs[name] ?? null; }
  addEventListener(type, handler){
    (this.listeners[type] ||= []).push(handler);
  }
  querySelector(selector){
    if (selector === '.cat-modal-panel') return this.panel || null;
    return null;
  }
  click(){ this.dispatchEvent({ type:'click', target:this, preventDefault(){} }); }
  dispatchEvent(event){
    const evt = event || {};
    evt.type ||= 'click';
    evt.target ||= this;
    evt.preventDefault ||= function(){};
    (this.listeners[evt.type] || []).forEach((handler) => handler(evt));
    return true;
  }
}

const elements = new Map();
const add = (id) => {
  const el = new FakeElement(id);
  elements.set(id, el);
  return el;
};

const modalSpecs = [
  ['envase','cat-edit-envase-cancel'],
  ['tapa','cat-edit-tapa-cancel'],
  ['extra','cat-edit-extra-cancel'],
  ['bank','cat-edit-bank-cancel']
];
modalSpecs.forEach(([name, cancelId]) => {
  const modal = add(`cat-${name}-modal`);
  modal.setAttribute('aria-hidden', 'true');
  modal.panel = new FakeElement(`cat-${name}-panel`);
  add(`cat-${name}-close`);
  add(cancelId);
});

const body = new FakeElement('body');
const docListeners = Object.create(null);
const documentStub = {
  body,
  documentElement: new FakeElement('html'),
  readyState: 'loading',
  getElementById(id){ return elements.get(id) || null; },
  querySelector(selector){
    if (selector === '.cat-modal.show'){
      return Array.from(elements.values()).find((el) => el.id.endsWith('-modal') && el.classList.contains('show')) || null;
    }
    return null;
  },
  querySelectorAll(){ return []; },
  addEventListener(type, handler){ (docListeners[type] ||= []).push(handler); }
};

const localStorageStub = {
  store: Object.create(null),
  getItem(key){ return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null; },
  setItem(key, value){ this.store[key] = String(value); },
  removeItem(key){ delete this.store[key]; }
};

const windowStub = {
  document: documentStub,
  localStorage: localStorageStub,
  addEventListener(){},
  removeEventListener(){},
  history:{ replaceState(){} },
  location:{ search:'', hash:'', protocol:'https:' },
  navigator:{},
  matchMedia(){ return { matches:true, addEventListener(){}, removeEventListener(){} }; }
};
windowStub.window = windowStub;
windowStub.globalThis = windowStub;

const instrumented = source.replace(/\}\)\(\);\s*$/, `
  globalThis.__CAT_TEST__ = {
    openModalCAT,
    closeModalCAT,
    bindEnvaseUi,
    bindTapaUi,
    bindExtraBankUi
  };
})();`);
assert.notStrictEqual(instrumented, source, 'No se pudo instrumentar script.js para la simulación');

const context = {
  window: windowStub,
  globalThis: windowStub,
  document: documentStub,
  navigator: windowStub.navigator,
  localStorage: localStorageStub,
  console,
  setTimeout,
  clearTimeout,
  URLSearchParams,
  Date,
  Math,
  JSON,
  Promise,
  Map,
  Set,
  confirm(){ return true; },
  alert(){},
  indexedDB:{ open(){ throw new Error('IndexedDB no debe abrirse durante este smoke'); } }
};
vm.createContext(context);
vm.runInContext(instrumented, context, { filename:'catalogos/script.js' });
const api = windowStub.__CAT_TEST__;
assert(api, 'No se expusieron funciones para prueba');

api.bindEnvaseUi();
api.bindTapaUi();
api.bindExtraBankUi();

function assertOpen(modalId){
  const modal = elements.get(modalId);
  assert(api.openModalCAT(modalId), `No abrió ${modalId}`);
  assert(modal.classList.contains('show'), `${modalId} no quedó visible`);
  assert.strictEqual(modal.getAttribute('aria-hidden'), 'false', `${modalId} aria-hidden incorrecto`);
  assert(body.classList.contains('cat-modal-open'), 'Body no quedó bloqueado');
  assert.strictEqual(modal.panel.scrollTop, 0, 'El modal no reinició su scroll');
}
function assertClosed(modalId){
  const modal = elements.get(modalId);
  assert(!modal.classList.contains('show'), `${modalId} sigue visible`);
  assert.strictEqual(modal.getAttribute('aria-hidden'), 'true', `${modalId} aria-hidden no volvió a true`);
  assert(!body.classList.contains('cat-modal-open'), 'Body quedó bloqueado');
}

assertOpen('cat-envase-modal');
elements.get('cat-edit-envase-cancel').click();
assertClosed('cat-envase-modal');

assertOpen('cat-tapa-modal');
elements.get('cat-tapa-close').click();
assertClosed('cat-tapa-modal');

assertOpen('cat-extra-modal');
elements.get('cat-extra-modal').dispatchEvent({ type:'keydown', key:'Escape', target:elements.get('cat-extra-modal'), preventDefault(){} });
assertClosed('cat-extra-modal');

assertOpen('cat-bank-modal');
elements.get('cat-bank-modal').dispatchEvent({ type:'click', target:elements.get('cat-bank-modal'), preventDefault(){} });
assertClosed('cat-bank-modal');

console.log('OK — Catálogos: modales de edición, cierres, limpieza visual y caché PWA verificados.');
