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
  await wait(30);
  const api = windowObj.A33AgendaPurchases;
  const checks = [];
  function check(name, condition){ assert.ok(condition, name); checks.push(name); }
  function countEvents(text){ return (String(text || '').match(/BEGIN:VEVENT/g) || []).length; }
  function item(materialId,name,category,unit,priceUsed,quantity){
    return { draftId:'itm_'+materialId,materialId,name,category,unit,priceUsed,quantity,subtotal:priceUsed*quantity,snapshot:{materialId,name,category,unit,priceUsed,capturedAt:'2026-07-18T10:00:00.000Z'} };
  }
  function grouped(id,date,status,priority,notes,items){
    const total = items.reduce((sum,row)=>sum+row.subtotal,0);
    return { id,subject:'Compra agrupada · '+items.length+' artículos',type:'compra',client:'',clientId:'',modality:'',date,time:'',status,priority,notes,createdAt:'2026-07-18T10:00:00.000Z',updatedAt:'2026-07-18T11:00:00.000Z',pedido:{enabled:false},purchase:{materialId:'',name:'Compra agrupada ('+items.length+' artículos)',category:'Varios',unit:'Unidad',priceUsed:total,quantity:1,subtotal:total},purchaseGroup:{version:1,itemCount:items.length,totalGeneral:total,items} };
  }

  const sourcePayload = JSON.parse(storage.get('a33_agenda_records_v1'));
  sourcePayload.records.push(
    { id:'task-1',subject:'Tarea intacta',type:'tarea',client:'',clientId:'',modality:'',date:'2026-07-25',time:'',status:'pendiente',priority:'media',notes:'',createdAt:'2026-07-18T09:00:00.000Z',updatedAt:'2026-07-18T09:00:00.000Z',pedido:{enabled:false} },
    { id:'legacy-pending',subject:'Compra antigua pendiente',type:'compra',date:'2026-07-27',status:'pendiente',priority:'media',notes:'Legado',createdAt:'2026-07-16T10:00:00.000Z',updatedAt:'2026-07-16T10:00:00.000Z',purchase:{materialId:'mat-legacy',name:'Compra antigua pendiente',category:'Insumos',unit:'Unidad',priceUsed:50,quantity:2,subtotal:100,snapshot:{materialId:'mat-legacy',name:'Compra antigua pendiente',category:'Insumos',unit:'Unidad',priceUsed:50,capturedAt:'2026-07-16T10:00:00.000Z'}} },
    grouped('buy-1','2026-07-25','pendiente','alta','Comprar temprano.',[
      item('mat-botellas','Botellas','Envases','Cajas',800,2),
      item('mat-jugo','Jugo','Bebidas','Galones',220,3)
    ]),
    grouped('buy-2','2026-07-25','pendiente','media','',[item('mat-azucar','Azúcar','Insumos','Unidad',40,5)]),
    grouped('buy-3','2026-07-26','pendiente','baja','Otra fecha',[item('mat-hielo','Hielo','Insumos','Cajas',150,1)]),
    grouped('buy-done','2026-07-25','hecho','media','NO EXPORTAR HECHO',[item('mat-done','Artículo hecho','Prueba','Unidad',99,1)]),
    grouped('buy-cancel','2026-07-25','cancelado','media','NO EXPORTAR CANCELADO',[item('mat-cancel','Artículo cancelado','Prueba','Unidad',88,1)])
  );
  storage.set('a33_agenda_records_v1',JSON.stringify(sourcePayload));
  await api.reload();
  await wait(20);
  const stateNow = api.getState();
  const p1 = stateNow.purchases.find(row=>row.id==='buy-1');

  check('1. Compras abre correctamente', !!api);
  check('2. Materia Prima activa carga sin artículos inactivos', stateNow.materials.length === 2);
  check('3. Compra antigua de un artículo se normaliza', stateNow.purchases.find(row=>row.id==='legacy-1').purchaseGroup.itemCount === 1);
  check('4. Compras agrupadas se leen como registros únicos', stateNow.purchases.filter(row=>row.id==='buy-1').length === 1);
  check('5. Reuniones permanecen intactas', sourcePayload.records.some(row=>row.id==='meeting-1' && row.type==='reunion'));
  check('6. Tareas permanecen intactas', sourcePayload.records.some(row=>row.id==='task-1' && row.type==='tarea'));
  check('7. El grupo no se descompone en registros por artículo', !stateNow.purchases.some(row=>row.id==='itm_mat-botellas'));
  check('8. El detalle conserva todos los artículos', p1.purchaseGroup.items.length === 2);
  check('9. El total general histórico es correcto', p1.purchaseGroup.totalGeneral === 2260);
  check('10. Estado general se conserva', p1.status === 'pendiente');
  check('11. Prioridad general se conserva', p1.priority === 'alta');
  check('12. Notas generales se conservan', p1.notes === 'Comprar temprano.');
  check('13. Fecha necesaria se conserva', p1.date === '2026-07-25');
  check('14. Agregado compatible conserva el total', p1.purchase.subtotal === 2260);
  check('15. Calendario ofrece solo fechas pendientes', elements.purchaseCalendarDate.options.length === 3);

  const beforeStatuses = stateNow.purchases.map(row=>[row.id,row.status]).sort().join('|');
  check('16. Exportar todas funciona', api.exportAll() === true);
  const allIcs = lastBlob.text;
  const allText = allIcs.replace(/\r\n /g,'').replace(/\\,/g,',');
  check('17. Exportar todas crea un evento por fecha pendiente', countEvents(allIcs) === 3);
  check('18. Varias compras de la misma fecha comparten un evento', (allIcs.match(/DTSTART;VALUE=DATE:20260725/g)||[]).length === 1);
  check('19. No crea un evento por artículo', countEvents(allIcs) < 6);
  check('20. Usa el título exacto Compras Arcano 33', allText.includes('SUMMARY:Compras Arcano 33'));
  check('21. La descripción identifica Compra 1', allText.includes('Compra 1:'));
  check('22. La descripción identifica Compra 2', allText.includes('Compra 2:'));
  check('23. Incluye Botellas', allText.includes('Botellas'));
  check('24. Incluye Jugo', allText.includes('Jugo'));
  check('25. Incluye Azúcar', allText.includes('Azúcar'));
  check('26. Conserva precio histórico de Botellas', allText.includes('C$800.00'));
  check('27. Conserva precio histórico de Jugo', allText.includes('C$220.00'));
  check('28. Conserva subtotal histórico de Botellas', allText.includes('C$1,600.00'));
  check('29. Conserva subtotal histórico de Jugo', allText.includes('C$660.00'));
  check('30. Suma el presupuesto total de la fecha', allText.includes('C$2,460.00'));
  check('31. Hechos no se exportan', !allText.includes('Artículo hecho') && !allText.includes('NO EXPORTAR HECHO'));
  check('32. Cancelados no se exportan', !allText.includes('Artículo cancelado') && !allText.includes('NO EXPORTAR CANCELADO'));
  const afterStatuses = api.getState().purchases.map(row=>[row.id,row.status]).sort().join('|');
  check('33. Exportar no cambia estados', beforeStatuses === afterStatuses);
  check('34. Exportar por fecha funciona', api.exportDate('2026-07-25') === true);
  const dateIcs = lastBlob.text;
  const dateText = dateIcs.replace(/\r\n /g,'').replace(/\\,/g,',');
  check('35. Exportar por fecha genera un solo evento', countEvents(dateIcs) === 1);
  check('36. Exportar por fecha excluye otras fechas', dateText.includes('20260725') && !dateText.includes('DTSTART;VALUE=DATE:20260726'));
  check('37. UID usa identidad estable y no el simple número de registros', /UID:a33-compras-20260725-[a-z0-9]+@arcano33/.test(dateIcs) && !dateIcs.includes('20260725-2@arcano33'));

  const cloud = api.serializeForFirebase(p1,{workspaceId:'ws-a33',createdBy:'user-1',updatedBy:'user-1'});
  check('38. Firebase serializa workspace e ID estable', cloud.workspaceId==='ws-a33' && cloud.id==='buy-1');
  check('39. Firebase serializa la lista de artículos', Array.isArray(cloud.purchaseGroup.items) && cloud.purchaseGroup.items.length===2);
  check('40. Firebase conserva precios históricos', cloud.purchaseGroup.items.find(row=>row.materialId==='mat-jugo').priceUsed===220);
  check('41. Firebase produce datos JSON seguros', JSON.parse(JSON.stringify(cloud)).purchaseGroup.itemCount===2 && cloud.createdAtMs>0);

  const configSource = fs.readFileSync(path.join(root,'configuracion','script.js'),'utf8');
  const configListeners=[];
  const configWindow={A33Storage:{getItem(){return null;},setItem(){}}};
  const configDocument={addEventListener(type,fn){configListeners.push([type,fn]);},getElementById(){return null;},querySelectorAll(){return [];},documentElement:{dataset:{},style:{}}};
  const configContext={window:configWindow,document:configDocument,console,Blob:FakeBlob,JSON,Date,Math,Number,String,Array,Object,Map,Set,RegExp,Intl,URLSearchParams,setTimeout,clearTimeout,indexedDB:{},localStorage:{length:0,key(){return null;},getItem(){return null;},setItem(){}}};
  configWindow.window=configWindow; configWindow.document=configDocument;
  vm.runInNewContext(configSource,configContext,{filename:'configuracion/script.js'});
  const contract=configWindow.A33AgendaBackupContract;
  const legacyRaw={schemaVersion:7,records:[{type:'compra',date:'2026-07-27',status:'pendiente',priority:'media',notes:'antigua',createdAt:'2026-07-17T10:00:00.000Z',updatedAt:'2026-07-17T10:00:00.000Z',purchase:{materialId:'old-1',name:'Compra antigua',category:'Insumos',unit:'Unidad',priceUsed:50,quantity:2,subtotal:100}}]};
  const normalized=contract.normalizeRaw(JSON.stringify(legacyRaw));
  check('42. JSON acepta y normaliza compras antiguas', normalized.records[0].purchaseGroup.itemCount===1 && normalized.records[0].purchaseGroup.totalGeneral===100);
  const mergedOnce=contract.mergeRaw(JSON.stringify({schemaVersion:9,records:[]}),JSON.stringify(legacyRaw));
  const mergedTwice=contract.mergeRaw(JSON.stringify(mergedOnce),JSON.stringify(legacyRaw));
  check('43. Importar el mismo JSON no duplica compras', mergedTwice.records.length===1);
  const rulesRoot=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
  const rulesFirebase=fs.readFileSync(path.join(root,'firebase','firestore.rules'),'utf8');
  check('44. Las dos reglas Firestore aceptan purchaseGroup compatible', [rulesRoot,rulesFirebase].every(text=>text.includes('validAgendaPurchaseGroup') && text.includes('validAgendaPurchaseDocument')));
  const sw=fs.readFileSync(path.join(root,'agenda','sw.js'),'utf8');
  const agendaHtml=fs.readFileSync(path.join(root,'agenda','index.html'),'utf8');
  const configHtml=fs.readFileSync(path.join(root,'configuracion','index.html'),'utf8');
  const center=fs.readFileSync(path.join(root,'centro-mando','app.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'agenda','style.css'),'utf8');
  check('45. PWA, responsive, Centro de Mando y versionado final quedan consistentes', sw.includes('-m4') && sw.includes('purchases.js?v=4.20.95&r=4') && agendaHtml.includes('purchases.js?v=4.20.95&r=4') && configHtml.includes('script.js?v=4.20.95&amp;r=34') && center.includes('purchaseGroup') && center.includes("type === 'compra'") && css.includes('@media (max-width:740px)'));

  assert.strictEqual(errors.length,0,'sin errores de consola en la prueba dinámica');
  assert.strictEqual(checks.length,45,'45 verificaciones obligatorias');
  console.log(`Agenda Compras Agrupadas Etapa 3 final smoke: OK (${checks.length}/45)`);
})().catch(err=>{ console.error(err); process.exitCode=1; });
