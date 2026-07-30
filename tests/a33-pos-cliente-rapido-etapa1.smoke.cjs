'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'pos/index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pos/styles.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'pos/sw.js'), 'utf8');

const check = (condition, message) => assert.ok(condition, message);

// UI exacta y alcance.
check(html.includes('id="btn-new-customer"') && html.includes('>Nuevo</button>'), 'Falta botón Nuevo');
check(html.includes('id="customer-quick-modal"'), 'Falta modal de cliente rápido');
check(html.includes('id="customer-quick-name"'), 'Falta campo Nombre');
check(html.includes('id="customer-quick-cell"'), 'Falta campo Celular');
check(html.includes('id="customer-quick-create"') && html.includes('>Crear</button>'), 'Falta botón Crear');
check(html.includes('id="customer-quick-cancel"') && html.includes('>Cancelar</button>'), 'Falta botón Cancelar');
check(!html.includes('customer-quick-email'), 'Cliente rápido agregó correo fuera de alcance');
check(!html.includes('customer-quick-address'), 'Cliente rápido agregó dirección fuera de alcance');
check(!html.includes('customer-quick-ruc'), 'Cliente rápido agregó RUC fuera de alcance');

// Colores específicos en claro y oscuro.
check(css.includes('.customer-quick-create{') && css.includes('background:#1db954;'), 'Crear no está definido en verde');
check(css.includes('.customer-quick-cancel{') && css.includes('background:#b3261e;'), 'Cancelar no está definido en rojo');
check(css.includes('html[data-theme="light"] .customer-quick-create'), 'Falta contraste de Crear en modo claro');
check(css.includes('html[data-theme="light"] .customer-quick-cancel'), 'Falta contraste de Cancelar en modo claro');
check(css.includes('overscroll-behavior:contain'), 'Falta hardening del modal en iPad');
check(css.includes('@media (max-height:520px) and (orientation:landscape)'), 'Falta hardening horizontal iPad');
check(css.includes(':focus-visible'), 'Falta foco accesible');

// Integración con fuente oficial y guardias anti doble toque.
check(js.includes("const CUSTOMER_CATALOG_KEY = 'a33_pos_customersCatalog';"), 'No usa catálogo oficial de clientes');
check(js.includes('function createQuickCustomerPOS(name, cellular)'), 'Falta creación rápida');
check(js.includes('const list = loadCustomerCatalogPOS();'), 'No relee la fuente oficial antes de guardar');
check(js.includes('if (!saveCustomerCatalogPOS(sorted))'), 'No usa persistencia oficial');
check(js.includes('const persisted = loadCustomerCatalogPOS().find'), 'No confirma persistencia');
check(js.includes('if (customerQuickBusyPOS) return false;'), 'Falta guardia anti doble Crear');
check(js.includes("modal.dataset.bound === '1'"), 'Falta blindaje de listeners del modal');
check(js.includes("newBtn.dataset.bound !== '1'"), 'Falta blindaje del botón Nuevo');
check(js.includes("if (!modal || isCustomerQuickOpenPOS()) return false;"), 'Falta guardia anti doble apertura');
check(js.includes("event.key === 'Escape'"), 'Falta cierre seguro con Escape');
check(js.includes("event.key !== 'Tab'"), 'Falta trampa de foco');
check(js.includes("document.getElementById('customer-quick-name')?.focus"), 'Falta foco inicial en Nombre');
check(js.includes("persistCustomerLastPOS(result.customer.name || name)"), 'Falta selección/persistencia del cliente creado');
check(js.includes("setCustomerSelectionUI_POS(result.customer)"), 'Falta selección automática');
check(js.includes('El cliente ya existía. Se seleccionó el registro existente.'), 'Falta manejo claro de duplicados');
check(js.includes("celular:cleanCell") && js.includes("telefono:cleanCell"), 'Celular no se conserva en esquema compatible');

// El flujo rápido no debe tocar los campos operativos de la venta.
const quickStart = js.indexOf('let customerQuickBusyPOS = false;');
const quickEnd = js.indexOf('function isCustomerPickerOpenPOS()', quickStart);
check(quickStart >= 0 && quickEnd > quickStart, 'No se pudo aislar el bloque Cliente rápido');
const quickBlock = js.slice(quickStart, quickEnd);
for (const forbiddenId of [
  'sale-product','sale-qty','sale-discount','sale-payment','sale-bank','sale-courtesy',
  'sale-courtesy-to','sale-notes','sale-date','sale-event','sale-total'
]){
  check(!quickBlock.includes(forbiddenId), `Cliente rápido toca ${forbiddenId}`);
}
check(!quickBlock.includes('localStorage.clear('), 'Cliente rápido borra localStorage');
check(!quickBlock.includes('indexedDB.deleteDatabase('), 'Cliente rápido borra IndexedDB');
check(!quickBlock.includes('window.prompt'), 'Cliente rápido usa window.prompt');

// PWA: solo bump necesario para servir los assets modificados.
check(html.includes('styles.css?v=4.20.97&r=20'), 'HTML no versionó estilos modificados');
check(html.includes('app.js?v=4.20.97&r=40'), 'HTML no versionó JS modificado');
check(sw.includes("const MODULE_CACHE_REV = '44';"), 'SW no incrementó cache del POS');
check(sw.includes("'./styles.css?v=4.20.97&r=20'"), 'SW no precachea estilos nuevos');
check(sw.includes("'./app.js?v=4.20.97&r=40'"), 'SW no precachea JS nuevo');

// Prueba funcional aislada de normalización, celular, persistencia y duplicado.
function takeFunction(source, name){
  const start = source.indexOf(`function ${name}(`);
  check(start >= 0, `No se encontró ${name}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (; i < source.length; i++){
    const ch = source[i];
    if (quote){
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`'){ quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}'){
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Función incompleta: ${name}`);
}

const fnNames = [
  'normalizeCustomerKeyPOS','sanitizeCustomerDisplayPOS','sortCustomerObjectsAZ_POS',
  'generateCustomerIdPOS','resolveFinalCustomerIdPOS','collectCustomerAllNamesPOS',
  'buildCustomerResolverPOS','createQuickCustomerPOS'
];
const isolated = fnNames.map(name => takeFunction(js, name)).join('\n') + '\n;globalThis.__create=createQuickCustomerPOS;';
let catalog = [];
let saveCount = 0;
const context = vm.createContext({
  console, Date, Math, Number, String, Object, Array, Set, Map, JSON,
  loadCustomerCatalogPOS:()=>catalog.map(item=>({...item})),
  saveCustomerCatalogPOS:(list)=>{ catalog = list.map(item=>({...item})); saveCount += 1; return true; },
  syncDisabledLegacyFromCatalogPOS:()=>{}
});
vm.runInContext(isolated, context);
const create = context.__create;

let result = create('   ', '8888');
check(!result.ok && result.reason === 'empty', 'Nombre vacío no fue bloqueado');
check(saveCount === 0, 'Nombre vacío ejecutó guardado');

result = create('  Carlos   Pérez  ', ' 8888 1111 ');
check(result.ok, 'No creó cliente válido');
check(catalog.length === 1, 'No persistió exactamente un cliente');
check(catalog[0].name === 'Carlos Pérez', 'No limpió espacios del Nombre');
check(catalog[0].celular === '8888 1111', 'No conservó Celular');
check(catalog[0].telefono === '8888 1111', 'No mantuvo compatibilidad de teléfono');
check(saveCount === 1, 'Guardó más de una vez');

result = create('carlos pérez', '9999');
check(!result.ok && result.reason === 'exists', 'No detectó duplicado normalizado');
check(catalog.length === 1, 'Creó un duplicado');
check(saveCount === 1, 'Duplicado ejecutó otro guardado');

result = create('Ana López', '');
check(result.ok, 'No permitió Celular vacío');
check(catalog.find(c=>c.name === 'Ana López').celular === '', 'Celular vacío no quedó vacío');


// Prueba DOM simulada: apertura, foco, cancelación, validación, selección y doble toque.
class MockClassList {
  constructor(){ this.items = new Set(); }
  add(...names){ names.forEach(n=>this.items.add(n)); }
  remove(...names){ names.forEach(n=>this.items.delete(n)); }
  toggle(name, force){
    const on = force === undefined ? !this.items.has(name) : !!force;
    if (on) this.items.add(name); else this.items.delete(name);
    return on;
  }
  contains(name){ return this.items.has(name); }
}
class MockElement {
  constructor(id, tag='div'){
    this.id=id; this.tagName=tag.toUpperCase(); this.value=''; this.textContent='';
    this.disabled=false; this.dataset={}; this.style={display:'none'}; this.attributes=new Map();
    this.classList=new MockClassList(); this.listeners=new Map(); this.isConnected=true;
    this.offsetParent={}; this.type=''; this.checked=false;
  }
  setAttribute(k,v){ this.attributes.set(k,String(v)); }
  getAttribute(k){ return this.attributes.get(k) || null; }
  hasAttribute(k){ return this.attributes.has(k); }
  removeAttribute(k){ this.attributes.delete(k); }
  addEventListener(name,fn){ if(!this.listeners.has(name)) this.listeners.set(name,[]); this.listeners.get(name).push(fn); }
  dispatch(name,extra={}){
    const ev={ target:this, key:'', shiftKey:false, preventDefault(){ this.defaultPrevented=true; }, ...extra };
    for(const fn of (this.listeners.get(name)||[])) fn(ev);
    return ev;
  }
  click(){ return this.dispatch('click'); }
  focus(){ domDocument.activeElement=this; }
  reset(){
    for(const id of ['customer-quick-name','customer-quick-cell']) domElements.get(id).value='';
  }
  requestSubmit(){ return this.dispatch('submit'); }
  querySelectorAll(selector){
    if(this.id==='customer-quick-modal' && selector.startsWith('input, button')){
      return ['customer-quick-name','customer-quick-cell','customer-quick-create','customer-quick-cancel'].map(id=>domElements.get(id));
    }
    return [];
  }
}
const domElements = new Map();
for(const [id,tag] of [
  ['customer-quick-modal','div'],['customer-quick-form','form'],['customer-quick-name','input'],
  ['customer-quick-cell','input'],['customer-quick-msg','div'],['customer-quick-create','button'],
  ['customer-quick-cancel','button'],['btn-new-customer','button'],['sale-customer','input']
]) domElements.set(id,new MockElement(id,tag));
domElements.get('customer-quick-modal').style.display='none';
domElements.get('customer-quick-name').type='text';
domElements.get('customer-quick-cell').type='tel';
const domDocument={
  activeElement:domElements.get('btn-new-customer'),
  body:{ classList:new MockClassList() },
  getElementById:(id)=>domElements.get(id)||null
};
let domCatalog=[];
let domSaves=0;
let selectedCustomer=null;
let lastCustomer='';
let toastText='';
const domContext=vm.createContext({
  console, Date, Math, Number, String, Object, Array, Set, Map, JSON,
  document:domDocument, window:{},
  setTimeout:(fn)=>{ fn(); return 1; },
  clearTimeout:()=>{},
  isCustomerPickerOpenPOS:()=>false,
  closeCustomerPickerPOS:()=>{},
  loadCustomerCatalogPOS:()=>domCatalog.map(c=>({...c})),
  saveCustomerCatalogPOS:(list)=>{ domCatalog=list.map(c=>({...c})); domSaves++; return true; },
  syncDisabledLegacyFromCatalogPOS:()=>{},
  refreshCustomerUI_POS:()=>{},
  setCustomerSelectionUI_POS:(c)=>{ selectedCustomer={...c}; const inp=domElements.get('sale-customer'); inp.value=c.name; inp.dataset.customerId=String(c.id); },
  persistCustomerLastPOS:(n)=>{ lastCustomer=String(n||''); },
  showToast:(m)=>{ toastText=String(m||''); }
});
vm.runInContext(fnNames.slice(0,-1).map(name => takeFunction(js, name)).join('\n') + '\n' + quickBlock + '\n;globalThis.__ui={open:openCustomerQuickPOS,close:closeCustomerQuickPOS,setup:setupCustomerQuickModalPOS,submit:handleCustomerQuickSubmitPOS,isOpen:isCustomerQuickOpenPOS};', domContext);
const ui=domContext.__ui;
ui.setup();
check(ui.open() === true, 'Modal rápido no abre');
check(ui.open() === false, 'Doble apertura no fue bloqueada');
check(domElements.get('customer-quick-modal').style.display === 'flex', 'Modal no quedó visible');
check(domDocument.activeElement.id === 'customer-quick-name', 'Foco inicial no llegó a Nombre');

domElements.get('customer-quick-cancel').click();
check(domElements.get('customer-quick-modal').style.display === 'none', 'Cancelar no cerró');
check(domSaves === 0, 'Cancelar guardó datos');

ui.open();
domElements.get('customer-quick-form').requestSubmit();
check(domElements.get('customer-quick-msg').textContent.includes('nombre'), 'Nombre vacío no mostró aviso');
check(domSaves === 0, 'Nombre vacío guardó');

domElements.get('customer-quick-name').value='Cliente DOM';
domElements.get('customer-quick-cell').value='7777 0000';
domElements.get('customer-quick-form').requestSubmit();
check(domCatalog.length === 1 && domCatalog[0].celular === '7777 0000', 'Creación DOM no persistió celular');
check(selectedCustomer && selectedCustomer.name === 'Cliente DOM', 'Creación DOM no seleccionó cliente');
check(lastCustomer === 'Cliente DOM', 'Creación DOM no persistió último cliente');
check(domElements.get('customer-quick-modal').style.display === 'none', 'Modal no cerró tras crear');
check(toastText.includes('creado'), 'Falta confirmación de creación');

ui.open();
domElements.get('customer-quick-name').value='  cliente   dom  ';
domElements.get('customer-quick-form').requestSubmit();
check(domCatalog.length === 1, 'Duplicado DOM creó otro registro');
check(domSaves === 1, 'Duplicado DOM ejecutó guardado');
check(toastText.includes('ya existía'), 'Duplicado DOM no avisó');

console.log('SMOKE OK — Suite A33 POS Cliente Rápido Etapa 1/3');
