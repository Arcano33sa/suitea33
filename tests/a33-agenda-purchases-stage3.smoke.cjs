const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'agenda', 'purchases.js'), 'utf8');

class FakeClassList {
  constructor(){ this.set = new Set(); }
  add(...items){ items.forEach(x=>this.set.add(x)); }
  remove(...items){ items.forEach(x=>this.set.delete(x)); }
  toggle(item, force){
    if (force === true){ this.set.add(item); return true; }
    if (force === false){ this.set.delete(item); return false; }
    if (this.set.has(item)){ this.set.delete(item); return false; }
    this.set.add(item); return true;
  }
  contains(item){ return this.set.has(item); }
}
class FakeElement {
  constructor(tag='div', id=''){
    this.tagName = String(tag).toUpperCase();
    this.id = id;
    this.value = '';
    this.textContent = '';
    this._innerHTML = '';
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.classList = new FakeClassList();
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.title = '';
    this.type = '';
    this.download = '';
    this.href = '';
    this.step = '';
    this.min = '';
  }
  set innerHTML(value){ this._innerHTML = String(value); this.children = []; }
  get innerHTML(){ return this._innerHTML; }
  get options(){ return this.tagName === 'SELECT' ? this.children : undefined; }
  appendChild(child){ child.parentNode = this; this.children.push(child); return child; }
  append(...items){ items.forEach(item=>this.appendChild(item)); }
  remove(){ if(this.parentNode) this.parentNode.children = this.parentNode.children.filter(x=>x!==this); }
  addEventListener(type, handler){ (this.listeners[type] ||= []).push(handler); }
  dispatchEvent(event){
    event = event || { type:'' };
    if (!event.type) throw new Error('event.type required');
    if (!event.preventDefault) event.preventDefault = ()=>{ event.defaultPrevented = true; };
    if (!event.stopPropagation) event.stopPropagation = ()=>{};
    (this.listeners[event.type] || []).forEach(fn=>fn.call(this,event));
    return !event.defaultPrevented;
  }
  setAttribute(name,value){ this.attributes[name]=String(value); if(name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value); }
  getAttribute(name){ return this.attributes[name] ?? null; }
  focus(){}
  reportValidity(){ this.reported = true; }
  setCustomValidity(message){ this.validationMessage = String(message || ''); }
  click(){ this.dispatchEvent({type:'click', preventDefault(){}, stopPropagation(){}}); }
  querySelector(){ return null; }
}

const ids = [
  'purchaseForm','purchaseMaterial','purchaseMaterialHelp','purchaseCategory','purchaseUnit','purchasePrice','purchaseQuantity','purchaseSubtotal','purchaseDate','purchasePriority','purchaseStatus','purchaseNotes','purchaseFormTitle','purchaseFormBadge','purchaseFormStatus','purchaseMetaId','purchaseMetaCreated','purchaseMetaUpdated','purchaseNewBtn','purchaseDeleteBtn','purchaseSaveBtn','purchaseMaterialsEmpty','purchaseList','purchaseEmptyState','purchaseEmptyTitle','purchaseEmptyText','purchaseListBadge','purchaseToolbarTitle','purchaseToolbarText','purchasePendingBudget','purchaseBoughtTotal','purchasePendingCount','purchaseDoneCount','purchaseCalendarDate','purchaseExportDateBtn','purchaseExportAllBtn','purchaseCalendarBadge','purchaseCalendarStatus'
];
const selectIds = new Set(['purchaseMaterial','purchasePriority','purchaseStatus','purchaseCalendarDate']);
const inputIds = new Set(['purchaseCategory','purchaseUnit','purchasePrice','purchaseQuantity','purchaseSubtotal','purchaseDate']);
const buttonIds = new Set(['purchaseNewBtn','purchaseDeleteBtn','purchaseSaveBtn','purchaseExportDateBtn','purchaseExportAllBtn']);
const elements = {};
for (const id of ids){
  let tag='div';
  if (id === 'purchaseForm') tag='form';
  else if (selectIds.has(id)) tag='select';
  else if (inputIds.has(id)) tag='input';
  else if (id === 'purchaseNotes') tag='textarea';
  else if (buttonIds.has(id)) tag='button';
  elements[id]=new FakeElement(tag,id);
}
const filterButtons = ['pendiente','hecho','cancelado','todos'].map(value=>{
  const el = new FakeElement('button');
  el.dataset.purchaseFilter = value;
  return el;
});

elements.purchaseForm.reset = function(){
  ['purchaseMaterial','purchaseCategory','purchaseUnit','purchasePrice','purchaseQuantity','purchaseSubtotal','purchaseDate','purchasePriority','purchaseStatus','purchaseNotes'].forEach(id=>{ elements[id].value=''; });
};

const body = new FakeElement('body','body');
const domReady = [];
const document = {
  body,
  getElementById(id){ return elements[id] || null; },
  querySelectorAll(selector){ return selector === '[data-purchase-filter]' ? filterButtons : []; },
  createElement(tag){ return new FakeElement(tag); },
  addEventListener(type, handler){ if(type === 'DOMContentLoaded') domReady.push(handler); }
};

const storage = new Map();
storage.set('a33_agenda_records_v1', JSON.stringify({
  schemaVersion:8,
  records:[{ id:'meeting-1', subject:'Reunión intacta', type:'reunion', client:'Cliente', clientId:'c1', modality:'presencial', date:'2026-07-24', time:'10:00', status:'pendiente', priority:'media', notes:'', createdAt:'2026-07-18T10:00:00.000Z', updatedAt:'2026-07-18T10:00:00.000Z', pedido:{enabled:false} }]
}));
const localStorage = {
  getItem(key){ return storage.has(key) ? storage.get(key) : null; },
  setItem(key,value){ storage.set(key,String(value)); },
  removeItem(key){ storage.delete(key); }
};

let materials = [
  { id:'mat-jugo', name:'Jugo', category:'Bebidas', unit:'Galones', price:220, active:true },
  { id:'mat-botellas', name:'Botellas', category:'Envases', unit:'Cajas', price:800, active:true }
];
let lastBlob = null;
class FakeBlob { constructor(parts, options){ this.parts=parts; this.options=options; this.text=parts.join(''); } }
const fakeURL = { createObjectURL(blob){ lastBlob=blob; return 'blob:test'; }, revokeObjectURL(){} };
const windowListeners = {};
const windowObj = {
  document,
  localStorage,
  crypto:{ randomUUID(){ return '12345678-1234-1234-1234-' + Math.random().toString(16).slice(2).padEnd(12,'0').slice(0,12); } },
  A33Materials:{ listActive: async()=>materials.map(x=>({...x})) },
  addEventListener(type,handler){ (windowListeners[type] ||= []).push(handler); },
  dispatchEvent(event){ (windowListeners[event.type] || []).forEach(fn=>fn(event)); },
  setTimeout,
  clearTimeout,
  confirm(){ return true; },
  URLSearchParams,
  location:{ search:'' },
  navigator:{ serviceWorker:{ register: async()=>({}) } }
};

const context = {
  window:windowObj,
  document,
  localStorage,
  navigator:windowObj.navigator,
  console,
  Intl,
  Date,
  Math,
  Number,
  String,
  Array,
  Map,
  Set,
  Blob:FakeBlob,
  URL:fakeURL,
  URLSearchParams,
  CustomEvent:class { constructor(type,init){ this.type=type; this.detail=init && init.detail; } },
  setTimeout,
  clearTimeout
};
windowObj.window = windowObj;
windowObj.Blob = FakeBlob;
windowObj.URL = fakeURL;
windowObj.CustomEvent = context.CustomEvent;

vm.runInNewContext(source, context, { filename:'purchases.js' });
assert.strictEqual(domReady.length,1,'bootstrap listener');
domReady[0]();

const wait = ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  await wait(10);
  const api = windowObj.A33AgendaPurchases;
  assert.ok(api,'API exposed');
  assert.strictEqual(api.getState().materials.length,2,'active materials loaded');

  elements.purchaseMaterial.value='mat-jugo';
  elements.purchaseMaterial.dispatchEvent({type:'change'});
  elements.purchaseQuantity.value='2';
  elements.purchaseQuantity.dispatchEvent({type:'input'});
  elements.purchaseDate.value='2026-07-25';
  elements.purchasePriority.value='alta';
  elements.purchaseStatus.value='pendiente';
  elements.purchaseNotes.value='primera pendiente';
  elements.purchaseForm.dispatchEvent({type:'submit',preventDefault(){}});
  elements.purchaseForm.dispatchEvent({type:'submit',preventDefault(){}}); // double-touch guard
  await wait(20);

  let payload = JSON.parse(storage.get('a33_agenda_records_v1'));
  assert.strictEqual(payload.schemaVersion,9);
  assert.strictEqual(payload.records.filter(x=>x.type==='compra').length,1,'double submit did not duplicate');
  assert.ok(payload.records.some(x=>x.id==='meeting-1'),'meeting preserved');
  let purchase = payload.records.find(x=>x.type==='compra');
  assert.strictEqual(purchase.purchase.priceUsed,220);
  assert.strictEqual(purchase.purchase.quantity,2);
  assert.strictEqual(purchase.purchase.subtotal,440);
  assert.match(elements.purchasePendingBudget.textContent,/440/);

  materials = materials.map(x=>x.id==='mat-jugo'?{...x,price:300}:x);
  await api.reload();
  await wait(500);
  elements.purchaseQuantity.value='3';
  elements.purchaseStatus.value='hecho';
  elements.purchaseNotes.value='done-only';
  elements.purchaseForm.dispatchEvent({type:'submit',preventDefault(){}});
  await wait(20);
  payload = JSON.parse(storage.get('a33_agenda_records_v1'));
  purchase = payload.records.find(x=>x.type==='compra');
  assert.strictEqual(purchase.purchase.priceUsed,220,'historical price frozen');
  assert.strictEqual(purchase.purchase.subtotal,660,'subtotal uses frozen price');
  assert.match(elements.purchaseBoughtTotal.textContent,/660/);
  assert.match(elements.purchasePendingBudget.textContent,/0/);

  await wait(500);
  elements.purchaseNewBtn.click();
  elements.purchaseMaterial.value='mat-botellas';
  elements.purchaseMaterial.dispatchEvent({type:'change'});
  elements.purchaseQuantity.value='2';
  elements.purchaseDate.value='2026-07-25';
  elements.purchaseStatus.value='pendiente';
  elements.purchasePriority.value='media';
  elements.purchaseNotes.value='cajas pendientes';
  elements.purchaseForm.dispatchEvent({type:'submit',preventDefault(){}});
  await wait(500);

  elements.purchaseNewBtn.click();
  elements.purchaseMaterial.value='mat-jugo';
  elements.purchaseMaterial.dispatchEvent({type:'change'});
  elements.purchaseQuantity.value='1.5';
  elements.purchaseDate.value='2026-07-26';
  elements.purchaseStatus.value='pendiente';
  elements.purchasePriority.value='baja';
  elements.purchaseNotes.value='galones pendientes';
  elements.purchaseForm.dispatchEvent({type:'submit',preventDefault(){}});
  await wait(30);

  payload = JSON.parse(storage.get('a33_agenda_records_v1'));
  const compras = payload.records.filter(x=>x.type==='compra');
  assert.strictEqual(compras.length,3);
  assert.strictEqual(compras.filter(x=>x.status==='pendiente').length,2);
  assert.strictEqual(compras.find(x=>x.notes==='galones pendientes').purchase.priceUsed,300,'new purchase uses new catalog price');

  assert.strictEqual(api.exportAll(),true);
  assert.ok(lastBlob && lastBlob.text.includes('BEGIN:VCALENDAR'));
  assert.strictEqual((lastBlob.text.match(/BEGIN:VEVENT/g)||[]).length,2,'one event per pending date');
  assert.ok(lastBlob.text.includes('Compras Arcano 33'));
  const unfoldedAll = lastBlob.text.replace(/\r\n /g,'');
  assert.ok(unfoldedAll.includes('Presupuesto estimado'));
  assert.ok(!unfoldedAll.includes('done-only'),'done purchase excluded');
  assert.ok(unfoldedAll.includes('Botellas'));
  assert.ok(unfoldedAll.includes('Jugo'));

  assert.strictEqual(api.exportDate('2026-07-25'),true);
  assert.strictEqual((lastBlob.text.match(/BEGIN:VEVENT/g)||[]).length,1,'single-date export has one event');
  const unfoldedDate = lastBlob.text.replace(/\r\n /g,'');
  assert.ok(unfoldedDate.includes('Botellas'));
  assert.ok(!unfoldedDate.includes('galones pendientes'));

  console.log('Agenda Compras Etapa 3 smoke: OK');
})().catch(err=>{ console.error(err); process.exitCode=1; });
