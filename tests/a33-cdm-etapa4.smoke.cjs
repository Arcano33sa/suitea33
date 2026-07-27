'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'centro-mando', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'centro-mando', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'centro-mando', 'style.css'), 'utf8');
const failures = [];
const check = (condition, message)=>{ if (!condition) failures.push(message); };

const inventoryIndex = html.indexOf('id="inventoryBlock"');
const eventsIndex = html.indexOf('id="globalActivesBlock"');
check(inventoryIndex >= 0 && eventsIndex > inventoryIndex, 'Inventario/Eventos no respetan el orden 6/7');
for (const id of ['inventoryLow','inventoryNear','inventoryRiskList','inventoryAllClear','inventoryReviewed','btnGoInventory','globalActivesList']){
  check(html.includes(`id="${id}"`), `Falta control ${id}`);
}
check(/Inventario: Todo en orden ✅/.test(html), 'Falta estado Todo en orden de Inventario');
check(/Revisado:/.test(html) && !/id="inventoryReviewed"[^>]*>Actualizado:/.test(html), 'La hora de cálculo no usa Revisado');
check(/\.cmd-global-list\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s.test(css), 'Eventos no usa columnas en computadora');
check(/@media \(min-width:821px\) and \(max-width:1180px\)[\s\S]*\.cmd-global-list\s*\{\s*grid-template-columns:1fr/s.test(css), 'Eventos no se apila en iPad');
check(/@media \(max-width:820px\)[\s\S]*\.cmd-global-list\s*\{\s*grid-template-columns:1fr/s.test(css), 'Eventos no se apila en móvil');
check(/overflow-x\s*:\s*hidden/.test(css), 'Falta blindaje contra scroll horizontal');
check(/risks:allRisks\.slice\(0,3\)/.test(js), 'Inventario no limita los riesgos principales a 3');
check(/ratio <= \.20/.test(js) && /ratio <= \.35/.test(js), 'Líquidos no respetan umbrales porcentuales');
check(/row\.configuredMin > 0 \? row\.configuredMin : 10/.test(js), 'Falta mínimo configurado con respaldo existente');
check(/state\.visualMode !== MODE_GLOBAL/.test(js), 'Eventos activos no está blindado a GLOBAL');
check(/new Set\(\)/.test(js) && /seen\.has\(id\)/.test(js), 'Falta deduplicación de eventos');
check(/!isCourtesySale\(row\)/.test(js), 'Ventas por evento incluyen cortesías');
check(/window\.__A33_CDM_STAGE4/.test(js), 'Falta diagnóstico de Etapa 4');
for (const forbidden of [/checklist/i,/recomendaci/i,/top productos/i,/mini radar/i,/último lote/i]){
  check(!forbidden.test(html + '\n' + js), `Contenido excluido todavía presente: ${forbidden}`);
}
if (failures.length){
  console.error('ETAPA 4 STATIC SMOKE FAIL');
  failures.forEach((failure)=>console.error('- ' + failure));
  process.exit(1);
}

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
    this._innerHTML = '';
  }
  set innerHTML(value){ this._innerHTML = String(value); if (value === '') this.children = []; }
  get innerHTML(){ return this._innerHTML; }
  addEventListener(name,handler){ this.listeners.set(name,handler); }
  appendChild(child){ this.children.push(child); return child; }
  append(...children){ this.children.push(...children); }
  setAttribute(name,value){ this.attributes.set(name,String(value)); }
  getAttribute(name){ return this.attributes.get(name) || null; }
  focus(){}
  select(){}
  contains(){ return false; }
  closest(){ return null; }
}
const elements = new Map();
const getElement = (id)=>{
  if (!elements.has(id)) elements.set(id,new MockElement(id));
  return elements.get(id);
};
let domReadyHandler = null;
const document = {
  activeElement:null,
  visibilityState:'visible',
  getElementById:getElement,
  createElement:(tag)=>new MockElement(tag),
  addEventListener:(name,handler)=>{ if (name === 'DOMContentLoaded') domReadyHandler = handler; }
};

const storage = new Map();
const localStorage = {
  getItem:(key)=>storage.has(key) ? storage.get(key) : null,
  setItem:(key,value)=>storage.set(key,String(value)),
  removeItem:(key)=>storage.delete(key)
};
const localYmd = (date)=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
const today = localYmd(new Date());
const yesterdayDate = new Date(); yesterdayDate.setDate(yesterdayDate.getDate()-1);
const yesterday = localYmd(yesterdayDate);
const futureDate = new Date(); futureDate.setDate(futureDate.getDate()+5);
const future = localYmd(futureDate);

const dbData = {
  events:[
    { id:1, name:'Expo A33', groupName:'Ferias', cashV2Active:true },
    { id:1, name:'Expo A33 duplicado', groupName:'Ferias', cashV2Active:true },
    { id:2, name:'Boda A33', groupName:'Eventos', cashV2Active:false },
    { id:3, name:'Cerrado', closedAt:'2026-01-01T00:00:00Z' }
  ],
  products:[
    { id:11, productId:'p1', name:'Galón 3720 ml', active:true },
    { id:12, productId:'p2', name:'Producto OK', active:true }
  ],
  sales:[
    { id:'s1', eventId:1, date:today, total:100, paymentMethod:'Efectivo' },
    { id:'s2', eventId:1, date:today, total:500, paymentMethod:'Cortesía' },
    { id:'s3', eventId:2, date:today, total:75, paymentMethod:'Transferencia' },
    { id:'s4', eventId:3, date:today, total:900, paymentMethod:'Efectivo' }
  ],
  meta:new Map([['currentEventId',{ id:'currentEventId', value:1 }]]),
  cashV2:new Map([[`cash:v2:1:${today}`,{ id:`cash:v2:1:${today}`, status:'OPEN' }]])
};
function asyncRequest(result){
  const request = {};
  setTimeout(()=>{ request.result = result; if (typeof request.onsuccess === 'function') request.onsuccess(); },0);
  return request;
}
function makeStore(name,tx){
  const data = dbData[name];
  return {
    indexNames:{ contains:(indexName)=>name === 'sales' && indexName === 'by_date' },
    get:(key)=>{
      if (data instanceof Map) return asyncRequest(data.get(key));
      return asyncRequest(Array.isArray(data) ? data.find((row)=>row.id === key) : undefined);
    },
    getAll:()=>asyncRequest(Array.isArray(data) ? data.slice() : Array.from(data.values())),
    index:(indexName)=>({ getAll:(range)=>asyncRequest(indexName === 'by_date' ? dbData.sales.filter((row)=>row.date === range.value) : []) }),
    put:(value)=>{
      if (data instanceof Map) data.set(value.id,value);
      setTimeout(()=>{ if (typeof tx.oncomplete === 'function') tx.oncomplete(); },0);
    }
  };
}
const fakeDb = {
  objectStoreNames:{ contains:(name)=>Object.prototype.hasOwnProperty.call(dbData,name) },
  close(){},
  transaction(name){
    const tx = { oncomplete:null, onerror:null, onabort:null, objectStore:()=>makeStore(name,tx) };
    return tx;
  }
};
const indexedDB = {
  open(){
    const request = {};
    setTimeout(()=>{ request.result = fakeDb; if (typeof request.onsuccess === 'function') request.onsuccess(); },0);
    return request;
  }
};

storage.set('a33_cmd_focusMode','GLOBAL');
storage.set('suite_a33_currency_settings_v1',JSON.stringify({ exchangeRate:36.8, updatedAt:'2026-07-27T09:00:00-06:00' }));
storage.set('a33_catalog_envases_v1',JSON.stringify([
  { id:'env1', name:'Envase crítico', active:true },
  { id:'env2', name:'Envase cerca', active:true },
  { id:'env3', name:'Envase OK', active:true }
]));
storage.set('a33_catalog_tapas_v1',JSON.stringify([
  { id:'cap1', name:'Tapa crítica', active:true },
  { id:'cap2', name:'Tapa cerca', active:true },
  { id:'cap3', name:'Tapa OK', active:true }
]));
storage.set('arcano33_inventario',JSON.stringify({
  liquids:{
    wine:{ stock:10, max:100, eventId:1 },
    vodka:{ stock:30, max:100, eventId:2 },
    jugo:{ stock:80, max:100 },
    sirope:{ stock:0, max:0 }
  },
  finishedByProductId:{
    p1:{ productId:'p1', stock:0, eventId:1 },
    p2:{ productId:'p2', stock:40 }
  },
  bottles:{
    env1:{ stock:8, eventId:1 },
    env2:{ stock:15 },
    env3:{ stock:40 }
  },
  caps:{
    cap1:{ stock:4, min:5, eventId:1 },
    cap2:{ stock:8, min:5 },
    cap3:{ stock:20, min:5 }
  }
}));
storage.set('arcano33_pedidos',JSON.stringify([
  { id:'p-o', eventId:1, estado:'pendiente', fechaEntrega:yesterday, fechaCreacion:future, cliente:'Vencido' },
  { id:'p-d', eventId:1, estado:'pendiente', fechaEntrega:today, fechaCreacion:future, cliente:'Entrega' },
  { id:'p-m', eventId:1, estado:'pendiente', fechaEntrega:future, fechaCreacion:today, cliente:'Fabrica' },
  { id:'p-2', eventId:2, estado:'pendiente', fechaEntrega:today, fechaCreacion:future, cliente:'Evento 2' },
  { id:'p-x', eventId:1, estado:'entregado', fechaEntrega:yesterday, fechaCreacion:today, cliente:'Cerrado' }
]));
storage.set('a33_agenda_records_v1',JSON.stringify({ records:[
  { id:'a-o', eventId:1, type:'reunion', date:yesterday, status:'pendiente', title:'Agenda vencida' },
  { id:'a-t', eventId:1, type:'tarea', date:today, status:'pendiente', title:'Agenda hoy' },
  { id:'a-x', eventId:1, type:'tarea', date:today, status:'hecho', title:'Cerrada' }
]}));

const consoleMessages = { error:[], warn:[] };
const mockConsole = { log(){}, error:(...args)=>consoleMessages.error.push(args.join(' ')), warn:(...args)=>consoleMessages.warn.push(args.join(' ')) };
const window = {
  document, localStorage, indexedDB, A33Storage:null,
  location:{ href:'http://localhost/centro-mando/index.html' },
  addEventListener(){},
  __A33_CDM_STAGE4:null
};
const context = vm.createContext({
  window, document, localStorage, indexedDB,
  IDBKeyRange:{ only:(value)=>({ value }) },
  console:mockConsole,
  Intl, Date, Number, String, Object, Array, Map, Set, Math, JSON, RegExp, Promise,
  encodeURIComponent, setTimeout, clearTimeout
});
const hooks = `\nwindow.__A33_CDM_TEST4 = { readInventorySignals, renderInventory, resolveActiveEvents, refreshGlobalEventSignals, renderGlobalEvents, selectVisualEvent, selectGlobalView, state:()=>state };`;
vm.runInContext(js + hooks,context,{ filename:'centro-mando/app.js' });
const wait = (ms=40)=>new Promise((resolve)=>setTimeout(resolve,ms));
const assert = (condition,message)=>{ if (!condition) throw new Error(message); };

(async()=>{
  assert(typeof domReadyHandler === 'function','DOMContentLoaded handler missing');
  await domReadyHandler();
  await wait(100);
  assert(consoleMessages.error.length === 0,'Console errors: ' + consoleMessages.error.join(' | '));
  assert(window.__A33_CDM_STAGE4,'Diagnostic API missing');

  const inventory = window.__A33_CDM_STAGE4.inventory();
  assert(inventory.critical === 4,'Cantidad crítica incorrecta');
  assert(inventory.near === 3,'Cantidad cerca del mínimo incorrecta');
  assert(inventory.risks.length === 3,'Se muestran más de 3 riesgos principales');
  assert(inventory.allRisks.some((row)=>row.type === 'liquid' && row.level === 'critical'),'Líquido crítico no detectado');
  assert(inventory.allRisks.some((row)=>row.type === 'product' && row.level === 'critical'),'Producto crítico no detectado');
  assert(inventory.allRisks.some((row)=>row.type === 'container' && row.level === 'critical'),'Envase crítico no detectado');
  assert(inventory.allRisks.some((row)=>row.type === 'cap' && row.level === 'critical'),'Tapa crítica no detectada');
  assert(!inventory.allRisks.some((row)=>row.name.includes('OK')),'Inventario incluye elementos OK');
  assert(getElement('inventoryLow').textContent === '4','Render crítico incorrecto');
  assert(getElement('inventoryNear').textContent === '3','Render cerca incorrecto');
  assert(getElement('inventoryRiskList').children.length === 3,'Render no limita a 3 riesgos');
  assert(getElement('inventoryAllClear').hidden === true,'Todo en orden aparece con riesgos');
  assert(getElement('inventoryReviewed').textContent.startsWith('Revisado:'),'Hora de revisión incorrecta');

  const active = window.__A33_CDM_TEST4.resolveActiveEvents();
  assert(active.length === 2,'Eventos activos duplicados o cerrados incluidos');
  await window.__A33_CDM_TEST4.refreshGlobalEventSignals();
  await wait(40);
  const globalSignals = window.__A33_CDM_STAGE4.globalEvents();
  assert(globalSignals.length === 2,'Señales globales incompletas');
  const event1 = globalSignals.find((row)=>row.eventId === 1);
  const event2 = globalSignals.find((row)=>row.eventId === 2);
  assert(event1 && event1.sales.total === 100 && event1.sales.count === 1,'Ventas del evento 1 incorrectas o incluyen cortesía');
  assert(event2 && event2.sales.total === 75 && event2.sales.count === 1,'Ventas del evento 2 incorrectas');
  assert(event1.cash.state === 'ABIERTO','Efectivo evento 1 incorrecto');
  assert(event2.cash.state === 'OFF','Efectivo evento 2 incorrecto');
  assert(event1.alerts.length === 7,'Alertas urgentes del evento 1 incorrectas');
  assert(new Set(event1.alerts.map((row)=>row.key)).size === event1.alerts.length,'Alertas del evento duplicadas');
  assert(event2.alerts.length === 1 && event2.alerts[0].key === 'orders-delivery-today','Alertas del evento 2 incorrectas');
  assert(getElement('globalActivesBlock').hidden === false,'Eventos activos no aparece en GLOBAL');
  assert(getElement('globalActivesList').children.length === 2,'Tarjetas globales duplicadas o faltantes');

  const firstCard = getElement('globalActivesList').children.find((card)=>card.children[0].children[0].children[0].children[0].textContent === 'Expo A33');
  assert(firstCard,'No se encontró la tarjeta del evento 1');
  const actions = firstCard.children[1];
  const detail = firstCard.children[2];
  const expandButton = actions.children[1];
  assert(detail.hidden === true,'Detalle de alertas inicia abierto');
  expandButton.listeners.get('click')();
  assert(detail.hidden === false,'Detalle no expande');
  assert(detail.children[0].children.length === 7,'Detalle no muestra alertas concretas');
  assert(detail.children[0].children.every((row)=>row.children[1] && row.children[1].listeners.has('click')),'Faltan accesos directos en alertas');

  const currentBefore = dbData.meta.get('currentEventId').value;
  await window.__A33_CDM_TEST4.selectVisualEvent(2);
  await wait(40);
  assert(dbData.meta.get('currentEventId').value === currentBefore,'Visualizar evento cambió el activo de POS');
  assert(getElement('globalActivesBlock').hidden === true,'Eventos activos aparece fuera de GLOBAL');

  storage.set('arcano33_inventario',JSON.stringify({ liquids:{ wine:{ stock:90,max:100 } }, bottles:{ env3:{ stock:40 } }, caps:{ cap3:{ stock:20,min:5 } }, finishedByProductId:{ p2:{ productId:'p2',stock:40 } } }));
  const clearInventory = window.__A33_CDM_TEST4.readInventorySignals();
  window.__A33_CDM_TEST4.state().inventorySignals = clearInventory;
  window.__A33_CDM_TEST4.renderInventory();
  assert(clearInventory.critical === 0 && clearInventory.near === 0,'Inventario limpio conserva riesgos');
  assert(getElement('inventoryAllClear').hidden === false,'No aparece Inventario: Todo en orden');

  console.log('ETAPA 4 SMOKE OK');
  console.log('- Líquidos, productos, envases y tapas críticos verificados');
  console.log('- Cerca del mínimo, exclusión de OK y máximo 3 riesgos verificados');
  console.log('- Eventos activos solo GLOBAL, sin duplicados, verificados');
  console.log('- Ventas, Efectivo y alertas reales por evento verificados');
  console.log('- Expansión y accesos directos verificados');
  console.log('- Visualizar evento no cambia el evento activo de POS');
  console.log('- Sin errores de consola en runtime simulado');
})().catch((error)=>{
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
