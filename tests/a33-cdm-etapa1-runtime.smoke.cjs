'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

class MockClassList {
  add(){}
  remove(){}
  contains(){ return false; }
}

class MockElement {
  constructor(id=''){
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.className = '';
    this.dataset = {};
    this.children = [];
    this.classList = new MockClassList();
    this.attributes = new Map();
  }
  addEventListener(){}
  appendChild(child){ this.children.push(child); return child; }
  append(...children){ this.children.push(...children); }
  setAttribute(name, value){ this.attributes.set(name, String(value)); }
  getAttribute(name){ return this.attributes.get(name) || null; }
  focus(){}
  select(){}
  contains(){ return false; }
  closest(){ return null; }
  querySelector(){ return null; }
}

const elements = new Map();
const getElement = (id)=>{
  if (!elements.has(id)) elements.set(id, new MockElement(id));
  return elements.get(id);
};

let domReadyHandler = null;
const document = {
  activeElement: null,
  visibilityState: 'visible',
  getElementById: getElement,
  createElement: (tag)=>new MockElement(tag),
  addEventListener: (name, handler)=>{ if (name === 'DOMContentLoaded') domReadyHandler = handler; },
};

const storage = new Map();
const localStorage = {
  getItem: (key)=>storage.has(key) ? storage.get(key) : null,
  setItem: (key,value)=>storage.set(key,String(value)),
  removeItem: (key)=>storage.delete(key)
};

const fakeDb = {
  objectStoreNames: { contains: ()=>false },
  close(){},
  transaction(){ throw new Error('No stores expected in empty runtime smoke'); }
};

const indexedDB = {
  open(){
    const request = {};
    setTimeout(()=>{
      request.result = fakeDb;
      if (typeof request.onsuccess === 'function') request.onsuccess();
    }, 0);
    return request;
  }
};

const consoleMessages = { error:[], warn:[] };
const mockConsole = {
  log(){},
  error(...args){ consoleMessages.error.push(args.join(' ')); },
  warn(...args){ consoleMessages.warn.push(args.join(' ')); }
};

const window = {
  document,
  localStorage,
  indexedDB,
  A33Storage: null,
  location: { href:'http://localhost/centro-mando/index.html' },
  addEventListener(){},
  __A33_CDM_STAGE1: null
};

const context = vm.createContext({
  window,
  document,
  localStorage,
  indexedDB,
  IDBKeyRange: { only:(value)=>value },
  console: mockConsole,
  Intl,
  Date,
  Number,
  String,
  Object,
  Array,
  Map,
  Set,
  Math,
  JSON,
  RegExp,
  Promise,
  setTimeout,
  clearTimeout
});

const source = fs.readFileSync(path.resolve(__dirname, '..', 'centro-mando', 'app.js'), 'utf8');
vm.runInContext(source, context, { filename:'centro-mando/app.js' });

(async()=>{
  if (typeof domReadyHandler !== 'function') throw new Error('DOMContentLoaded handler missing');
  await domReadyHandler();
  await new Promise((resolve)=>setTimeout(resolve, 30));

  if (consoleMessages.error.length) throw new Error('Console errors: ' + consoleMessages.error.join(' | '));
  if (!window.__A33_CDM_STAGE1) throw new Error('Diagnostic API missing');
  if (typeof window.__A33_CDM_STAGE1.refresh !== 'function') throw new Error('Refresh API missing');
  if (getElement('emptyState').hidden !== false) throw new Error('Empty state should be visible with an empty POS DB');
  if (getElement('btnUseInPOS').disabled !== true) throw new Error('Use in POS should be disabled without a visualized event');

  console.log('RUNTIME SMOKE OK');
  console.log('- Arranque sin errores de consola en base vacía simulada');
  console.log('- Estado vacío y blindaje de Usar en POS verificados');
})().catch((error)=>{
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
