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
    this.inputMode = '';
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
  setAttribute(name,value){
    this.attributes[name]=String(value);
    if(name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);
  }
  getAttribute(name){ return this.attributes[name] ?? null; }
  focus(){ this.focused = true; }
  select(){ this.selected = true; }
  reportValidity(){ this.reported = true; }
  setCustomValidity(message){ this.validationMessage = String(message || ''); }
  click(){ this.dispatchEvent({type:'click', preventDefault(){}, stopPropagation(){}}); }
  querySelector(selector){
    const match = (node)=>{
      if (selector === '[data-draft-quantity]') return Object.prototype.hasOwnProperty.call(node.dataset,'draftQuantity');
      const exact = selector.match(/^\[data-draft-quantity="([^"]+)"\]$/);
      if (exact) return node.dataset.draftQuantity === exact[1];
      return false;
    };
    const stack = [...this.children];
    while(stack.length){
      const node = stack.shift();
      if(match(node)) return node;
      stack.unshift(...node.children);
    }
    return null;
  }
}

const ids = [
  'purchaseForm','purchaseMaterial','purchaseMaterialHelp','purchaseCategory','purchaseUnit','purchasePrice','purchaseQuantity','purchaseSubtotal','purchaseDate','purchasePriority','purchaseStatus','purchaseNotes','purchaseAddBtn','purchaseDraftPanel','purchaseDraftList','purchaseDraftEmpty','purchaseDraftCount','purchaseDraftTotal','purchaseFormTitle','purchaseFormBadge','purchaseFormStatus','purchaseMetaId','purchaseMetaCreated','purchaseMetaUpdated','purchaseNewBtn','purchaseDeleteBtn','purchaseSaveBtn','purchaseMaterialsEmpty','purchaseList','purchaseEmptyState','purchaseEmptyTitle','purchaseEmptyText','purchaseListBadge','purchaseToolbarTitle','purchaseToolbarText','purchasePendingBudget','purchaseBoughtTotal','purchasePendingCount','purchaseDoneCount','purchaseCalendarDate','purchaseExportDateBtn','purchaseExportAllBtn','purchaseCalendarBadge','purchaseCalendarStatus'
];
const selectIds = new Set(['purchaseMaterial','purchasePriority','purchaseStatus','purchaseCalendarDate']);
const inputIds = new Set(['purchaseCategory','purchaseUnit','purchasePrice','purchaseQuantity','purchaseSubtotal','purchaseDate']);
const buttonIds = new Set(['purchaseAddBtn','purchaseNewBtn','purchaseDeleteBtn','purchaseSaveBtn','purchaseExportDateBtn','purchaseExportAllBtn']);
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
  schemaVersion:9,
  records:[
    { id:'meeting-1', subject:'Reunión intacta', type:'reunion', date:'2026-07-24', status:'pendiente', priority:'media', createdAt:'2026-07-18T10:00:00.000Z', updatedAt:'2026-07-18T10:00:00.000Z', pedido:{enabled:false} },
    { id:'legacy-1', subject:'Azúcar', type:'compra', date:'2026-07-23', status:'hecho', priority:'baja', notes:'histórica', createdAt:'2026-07-17T10:00:00.000Z', updatedAt:'2026-07-17T10:00:00.000Z', purchase:{materialId:'mat-azucar',name:'Azúcar',category:'Insumos',unit:'Cajas',priceUsed:500,quantity:1,subtotal:500,snapshot:{materialId:'mat-azucar',name:'Azúcar',category:'Insumos',unit:'Cajas',priceUsed:500,capturedAt:'2026-07-17T10:00:00.000Z'}} }
  ]
}));
const localStorage = {
  getItem(key){ return storage.has(key) ? storage.get(key) : null; },
  setItem(key,value){ storage.set(key,String(value)); },
  removeItem(key){ storage.delete(key); }
};

const materials = [
  { id:'mat-jugo', name:'Jugo', category:'Bebidas', unit:'Galones', price:220, active:true },
  { id:'mat-botellas', name:'Botellas', category:'Envases', unit:'Cajas', price:800, active:true },
  { id:'mat-inactivo', name:'Inactivo', category:'Otro', unit:'Unidad', price:10, active:false }
];
let confirmResult = true;
let lastBlob = null;
const errors = [];
class FakeBlob { constructor(parts, options){ this.parts=parts; this.options=options; this.text=parts.join(''); } }
const fakeURL = { createObjectURL(blob){ lastBlob=blob; return 'blob:test'; }, revokeObjectURL(){} };
const windowListeners = {};
let uuidCounter = 0;
const windowObj = {
  document,
  localStorage,
  crypto:{ randomUUID(){ uuidCounter += 1; return uuidCounter.toString(16).padStart(8,'0') + '-1234-1234-1234-123456789abc'; } },
  A33Materials:{ listActive: async()=>materials.map(x=>({...x})) },
  addEventListener(type,handler){ (windowListeners[type] ||= []).push(handler); },
  dispatchEvent(event){ (windowListeners[event.type] || []).forEach(fn=>fn(event)); },
  setTimeout,
  clearTimeout,
  confirm(){ return confirmResult; },
  URLSearchParams,
  location:{ search:'' },
  navigator:{ serviceWorker:{ register: async()=>({}) } }
};

const context = {
  window:windowObj,
  document,
  localStorage,
  navigator:windowObj.navigator,
  console:{ log:console.log, warn:console.warn, error:(...args)=>errors.push(args) },
  Intl, Date, Math, Number, String, Array, Map, Set,
  Blob:FakeBlob, URL:fakeURL, URLSearchParams,
  CustomEvent:class { constructor(type,init){ this.type=type; this.detail=init && init.detail; } },
  setTimeout, clearTimeout
};
windowObj.window = windowObj;
windowObj.Blob = FakeBlob;
windowObj.URL = fakeURL;
windowObj.CustomEvent = context.CustomEvent;

vm.runInNewContext(source, context, { filename:'purchases.js' });
assert.strictEqual(domReady.length,1,'bootstrap listener');
domReady[0]();

const wait = ms=>new Promise(resolve=>setTimeout(resolve,ms));
function choose(materialId, quantity){
  elements.purchaseMaterial.value=materialId;
  elements.purchaseMaterial.dispatchEvent({type:'change'});
  elements.purchaseQuantity.value=String(quantity);
  elements.purchaseQuantity.dispatchEvent({type:'input'});
}
function findDraftRow(draftId){ return elements.purchaseDraftList.children.find(row=>row.dataset.draftId===draftId); }

(async()=>{
  await wait(20);
  const api = windowObj.A33AgendaPurchases;
  assert.ok(api,'API exposed');
  assert.strictEqual(api.getState().materials.length,2,'only active materials loaded');
  assert.strictEqual(api.getState().purchases.find(x=>x.id==='legacy-1').purchaseGroup.items.length,1,'legacy purchase normalized as one item');

  elements.purchaseDate.value='2026-07-30';
  elements.purchasePriority.value='alta';
  elements.purchaseStatus.value='pendiente';
  elements.purchaseNotes.value='comprar para producción';

  choose('mat-jugo',2);
  elements.purchaseAddBtn.click();
  await wait(380);
  let draft = api.getState();
  assert.strictEqual(draft.draftItems.length,1);
  assert.strictEqual(draft.draftTotal,440);
  assert.strictEqual(elements.purchaseMaterial.value,'','article cleared');
  assert.strictEqual(elements.purchaseQuantity.value,'','quantity cleared');
  assert.strictEqual(elements.purchaseDate.value,'2026-07-30','date retained');
  assert.strictEqual(elements.purchasePriority.value,'alta','priority retained');
  assert.strictEqual(elements.purchaseStatus.value,'pendiente','status retained');
  assert.strictEqual(elements.purchaseNotes.value,'comprar para producción','notes retained');

  choose('mat-jugo',1.5);
  elements.purchaseAddBtn.click();
  await wait(380);
  draft = api.getState();
  assert.strictEqual(draft.draftItems.length,1,'repeated item merged');
  assert.strictEqual(draft.draftItems[0].quantity,3.5);
  assert.strictEqual(draft.draftItems[0].priceUsed,220);
  assert.strictEqual(draft.draftTotal,770);

  choose('mat-botellas',2);
  elements.purchaseAddBtn.click();
  await wait(380);
  draft = api.getState();
  assert.strictEqual(draft.draftItems.length,2);
  assert.strictEqual(draft.draftTotal,2370);

  const jugo = draft.draftItems.find(x=>x.materialId==='mat-jugo');
  let row = findDraftRow(jugo.draftId);
  row.children[row.children.length-1].children[0].click();
  row = findDraftRow(jugo.draftId);
  const editInput = row.querySelector('[data-draft-quantity]');
  assert.ok(editInput,'inline quantity editor exists');
  editInput.value='4';
  row.children[row.children.length-1].children[0].click();
  draft = api.getState();
  assert.strictEqual(draft.draftItems.find(x=>x.materialId==='mat-jugo').subtotal,880,'edit recalculates subtotal');
  assert.strictEqual(draft.draftTotal,2480,'edit recalculates total');

  const bottles = draft.draftItems.find(x=>x.materialId==='mat-botellas');
  row = findDraftRow(bottles.draftId);
  row.children[row.children.length-1].children[1].click();
  draft = api.getState();
  assert.strictEqual(draft.draftItems.length,1,'remove item');
  assert.strictEqual(draft.draftTotal,880,'remove updates total');

  choose('mat-botellas',1); // intentionally not pressing Agregar
  elements.purchaseForm.dispatchEvent({type:'submit',preventDefault(){}});
  elements.purchaseForm.dispatchEvent({type:'submit',preventDefault(){}}); // double touch
  await wait(30);

  let payload = JSON.parse(storage.get('a33_agenda_records_v1'));
  const grouped = payload.records.find(x=>x.type==='compra' && x.id!=='legacy-1');
  assert.ok(grouped,'grouped purchase stored');
  assert.strictEqual(payload.records.filter(x=>x.type==='compra').length,2,'one new grouped record only');
  assert.ok(payload.records.some(x=>x.id==='meeting-1'),'other agenda records preserved');
  assert.strictEqual(grouped.purchaseGroup.itemCount,2);
  assert.strictEqual(grouped.purchaseGroup.items.length,2);
  assert.strictEqual(grouped.purchaseGroup.totalGeneral,1680);
  assert.strictEqual(grouped.purchase.subtotal,1680,'legacy-compatible aggregate total');
  assert.strictEqual(grouped.date,'2026-07-30');
  assert.strictEqual(grouped.priority,'alta');
  assert.strictEqual(grouped.status,'pendiente');
  assert.strictEqual(grouped.notes,'comprar para producción');
  assert.strictEqual(grouped.purchaseGroup.items.find(x=>x.materialId==='mat-jugo').priceUsed,220,'historical price frozen');
  assert.strictEqual(grouped.purchaseGroup.items.find(x=>x.materialId==='mat-botellas').quantity,1,'last valid unadded item included');

  assert.strictEqual(api.getState().draftItems.length,0,'draft cleared after save');
  assert.strictEqual(elements.purchasePriority.value,'media','priority reset after save');
  assert.strictEqual(elements.purchaseStatus.value,'pendiente','status reset after save');
  assert.strictEqual(elements.purchaseNotes.value,'','notes reset after save');

  await wait(500);
  choose('mat-jugo',1);
  elements.purchaseAddBtn.click();
  await wait(380);
  confirmResult=false;
  elements.purchaseNewBtn.click();
  assert.strictEqual(api.getState().draftItems.length,1,'New cancellation preserves draft');
  confirmResult=true;
  elements.purchaseNewBtn.click();
  assert.strictEqual(api.getState().draftItems.length,0,'New confirmation clears draft');

  assert.strictEqual(api.exportAll(),true,'calendar remains operational');
  assert.ok(lastBlob && lastBlob.text.includes('Jugo') && lastBlob.text.includes('Botellas'),'group items included in calendar compatibility output');
  assert.strictEqual(errors.length,0,'no console errors');

  const html = fs.readFileSync(path.join(root,'agenda','index.html'),'utf8');
  const css = fs.readFileSync(path.join(root,'agenda','style.css'),'utf8');
  const general = fs.readFileSync(path.join(root,'agenda','script.js'),'utf8');
  assert.ok(html.includes('id="purchaseAddBtn"') && html.includes('Artículos agregados'));
  assert.ok(css.includes('.purchase-status-add-row') && css.includes('@media (max-width:740px)'));
  assert.ok(general.includes('normalizePurchaseGroup') && general.includes('purchaseGroup:'),'general Agenda saves preserve grouped data');

  console.log('Agenda Compras Agrupadas Etapa 1 smoke: OK');
})().catch(err=>{ console.error(err); process.exitCode=1; });
