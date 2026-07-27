'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'centro-mando', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'centro-mando', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'centro-mando', 'style.css'), 'utf8');

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const firstBlocks = ['operationalHeader', 'todaySummaryBlock', 'attentionBlock'];
let lastIndex = -1;
for (const id of firstBlocks){
  const index = html.indexOf(`id="${id}"`);
  check(index >= 0, `Falta ${id}`);
  check(index > lastIndex, `Orden incorrecto de ${id}`);
  lastIndex = index;
}

for (const id of ['operationalDate','visualModeState','posActiveEventName','eventSearch','btnUseInPOS','salesToday','salesTodayCount','cashTodayState','exchangeRateToday','attentionCount','attentionList','attentionEmpty']){
  check(html.includes(`id="${id}"`), `Falta control ${id}`);
}

check(/a33-currency\.js/.test(html), 'No se carga la fuente oficial de Moneda');
check(/\.cmd-block\s*\{[^}]*width\s*:\s*100%/s.test(css), 'Los bloques no ocupan el ancho disponible');
check(/overflow-x\s*:\s*hidden/.test(css), 'Falta blindaje explícito contra scroll horizontal general');
check(/grid-template-columns\s*:\s*repeat\(4,minmax\(0,1fr\)\)/.test(css), 'Resumen de escritorio no usa cuatro métricas internas');
check(/@media \(max-width:820px\)[\s\S]*\.cmd-metrics-grid\s*\{\s*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(css), 'Resumen no adapta a iPad');
check(/@media \(max-width:560px\)[\s\S]*\.cmd-operational-status,\.cmd-metrics-grid/.test(css), 'Resumen no adapta a móvil');

for (const status of ['ABIERTO','CERRADO','OFF','SIN ACTIVIDAD']) check(js.includes(`'${status}'`), `Falta estado de Efectivo ${status}`);
check(/!isCourtesySale\(row\)/.test(js), 'Ventas de hoy no excluye cortesías');
check(/NO CONFIGURADO/.test(js), 'Falta estado claro cuando no existe T/C');
check(/Todo bajo control ✅/.test(html), 'Falta mensaje Todo bajo control');

const priorities = [
  "key:'missing-fx'",
  "key:'cash-open'",
  "key:'orders-overdue'",
  "key:'orders-delivery-today'",
  "key:'orders-manufacture-today'",
  "key:'agenda-overdue'",
  "key:'agenda-today'",
  "key:'inventory-critical'"
];
let priorityLast = -1;
for (const token of priorities){
  const index = js.indexOf(token);
  check(index >= 0, `Falta alerta ${token}`);
  check(index > priorityLast, `Prioridad incorrecta para ${token}`);
  priorityLast = index;
}
check(/const used = new Set\(\)/.test(js) && /used\.has\(signal\.key\)/.test(js), 'Falta deduplicación de alertas');
check(/setText\('attentionCount', signals\.length\)/.test(js), 'Contador no corresponde a alertas visibles');
check(!/kind:'ok'|kind:'green'/.test(js), 'Hay alertas verdes dentro de Atención requerida');

const currentEventWrites = js.match(/setMetaValue\(\s*['"]currentEventId['"]/g) || [];
check(currentEventWrites.length === 1, `Escrituras currentEventId encontradas: ${currentEventWrites.length}`);
check(/async function activateVisualizedEventInPos\(\)[\s\S]*setMetaValue\(\s*['"]currentEventId['"]/.test(js), 'Usar en POS no concentra la única escritura');
for (const fn of ['selectVisualEvent','selectGlobalView']){
  const body = (js.match(new RegExp(`async function ${fn}\\([^)]*\\)\\{([\\s\\S]*?)\\n\\}`)) || [,''])[1];
  check(!/setMetaValue|currentEventId/.test(body), `${fn} cambia el POS`);
}

const forbidden = [/checklist/i,/recordatorio/i,/recomendaci/i,/top productos/i,/mini radar/i,/posRemindersIndex/i,/a33_analytics_recos_v1/i];
for (const pattern of forbidden) check(!pattern.test(html + '\n' + js), `Referencia excluida todavía presente: ${pattern}`);

if (failures.length){
  console.error('ETAPA 2 STATIC SMOKE FAIL');
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
    this.attributes = new Map();
    this.listeners = new Map();
    this._innerHTML = '';
  }
  set innerHTML(value){ this._innerHTML = String(value); if (value === '') this.children = []; }
  get innerHTML(){ return this._innerHTML; }
  addEventListener(name, handler){ this.listeners.set(name, handler); }
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
getElement('attentionEmpty').textContent = 'Todo bajo control ✅';
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

const dbData = {
  events:[
    { id:1, name:'Evento Uno', cashV2Active:true },
    { id:2, name:'Evento Dos', cashV2Active:false },
    { id:3, name:'Evento Cerrado', closedAt:'2026-01-01T00:00:00Z' }
  ],
  sales:[
    { id:'s1', eventId:1, date:today, total:100, paymentMethod:'Efectivo' },
    { id:'s2', eventId:1, date:today, total:50, paymentMethod:'Transferencia' },
    { id:'s3', eventId:1, date:today, total:999, paymentMethod:'Cortesía' },
    { id:'s4', eventId:2, date:today, total:25, paymentMethod:'Efectivo' },
    { id:'s5', eventId:3, date:today, total:500, paymentMethod:'Efectivo' }
  ],
  meta:new Map([['currentEventId',{ id:'currentEventId', value:1 }]]),
  cashV2:new Map([[`cash:v2:1:${today}`, { id:`cash:v2:1:${today}`, status:'OPEN' }]])
};

function asyncRequest(result){
  const request = {};
  setTimeout(()=>{ request.result = result; if (typeof request.onsuccess === 'function') request.onsuccess(); },0);
  return request;
}

function makeStore(name, tx){
  const data = dbData[name];
  const api = {
    indexNames:{ contains:(indexName)=>name === 'sales' && indexName === 'by_date' },
    get:(key)=>{
      if (data instanceof Map) return asyncRequest(data.get(key));
      return asyncRequest(Array.isArray(data) ? data.find((row)=>row.id === key) : undefined);
    },
    getAll:()=>asyncRequest(Array.isArray(data) ? data.slice() : Array.from(data.values())),
    index:(indexName)=>({
      getAll:(range)=>asyncRequest(indexName === 'by_date' ? dbData.sales.filter((row)=>row.date === range.value) : [])
    }),
    put:(value)=>{
      if (data instanceof Map) data.set(value.id, value);
      else {
        const index = data.findIndex((row)=>row.id === value.id);
        if (index >= 0) data[index] = value; else data.push(value);
      }
      setTimeout(()=>{ if (typeof tx.oncomplete === 'function') tx.oncomplete(); },0);
    }
  };
  return api;
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
storage.set('suite_a33_currency_settings_v1', JSON.stringify({ exchangeRate:36.8, updatedAt:'2026-07-27T09:00:00-06:00' }));
storage.set('arcano33_pedidos', JSON.stringify([
  { id:'p1', estado:'pendiente', fechaEntrega:yesterday, fechaCreacion:yesterday, cliente:'Vencido' },
  { id:'p2', estado:'pendiente', fechaEntrega:today, fechaCreacion:yesterday, cliente:'Entrega hoy' },
  { id:'p3', estado:'pendiente', fechaEntrega:'2099-01-01', fechaCreacion:today, cliente:'Fabricar hoy' },
  { id:'p4', estado:'entregado', fechaEntrega:yesterday, fechaCreacion:today, cliente:'Obsoleto cerrado' }
]));
storage.set('a33_agenda_records_v1', JSON.stringify([
  { id:'a1', type:'reunion', date:yesterday, status:'pendiente', title:'Vencida' },
  { id:'a2', type:'tarea', date:today, status:'pendiente', title:'Hoy' },
  { id:'a3', type:'compra', date:yesterday, status:'hecho', title:'Cerrada' }
]));
storage.set('arcano33_inventario', JSON.stringify({
  liquids:{ wine:{ stock:10, max:100 } },
  bottles:{ bottle:{ stock:80, max:100 } }
}));

const consoleMessages = { error:[], warn:[] };
const mockConsole = {
  log(){},
  error:(...args)=>consoleMessages.error.push(args.join(' ')),
  warn:(...args)=>consoleMessages.warn.push(args.join(' '))
};
const window = {
  document,
  localStorage,
  indexedDB,
  A33Storage:null,
  location:{ href:'http://localhost/centro-mando/index.html' },
  addEventListener(){},
  __A33_CDM_STAGE2:null
};
const context = vm.createContext({
  window, document, localStorage, indexedDB,
  IDBKeyRange:{ only:(value)=>({ value }) },
  console:mockConsole,
  Intl, Date, Number, String, Object, Array, Map, Set, Math, JSON, RegExp, Promise,
  setTimeout, clearTimeout
});

const testHooks = `\nwindow.__A33_CDM_TEST = {\n  selectVisualEvent, selectGlobalView, openUsePosModal, activateVisualizedEventInPos, refreshEventSummary, refreshOperationalSignals,\n  state:()=>state\n};`;
vm.runInContext(js + testHooks, context, { filename:'centro-mando/app.js' });

const wait = (ms=30)=>new Promise((resolve)=>setTimeout(resolve,ms));
const assert = (condition,message)=>{ if (!condition) throw new Error(message); };

(async()=>{
  assert(typeof domReadyHandler === 'function','DOMContentLoaded handler missing');
  await domReadyHandler();
  await wait(50);

  assert(consoleMessages.error.length === 0,'Console errors: ' + consoleMessages.error.join(' | '));
  assert(window.__A33_CDM_STAGE2,'Diagnostic API missing');
  assert(getElement('visualModeState').textContent === 'GLOBAL','Estado visual GLOBAL incorrecto');
  assert(getElement('salesTodayCount').textContent === '3','Cantidad GLOBAL incorrecta o incluye cortesías/cerrados');
  assert(window.__A33_CDM_STAGE2.summary().sales.total === 175,'Venta GLOBAL incorrecta o incluye cortesías/cerrados');
  assert(getElement('cashTodayState').textContent === 'ABIERTO','Estado GLOBAL de Efectivo incorrecto');
  assert(getElement('exchangeRateToday').textContent === 'T/C 36.80','T/C vigente incorrecto');
  assert(window.__A33_CDM_STAGE2.attentionCount() === 7,'Cantidad inicial de alertas reales incorrecta');
  assert(dbData.meta.get('currentEventId').value === 1,'Abrir GLOBAL cambió el evento activo de POS');

  await window.__A33_CDM_TEST.selectVisualEvent(2);
  await wait(30);
  assert(dbData.meta.get('currentEventId').value === 1,'Visualizar evento cambió el POS');
  assert(getElement('visualModeState').textContent === 'EVENTO','Estado EVENTO incorrecto');
  assert(getElement('salesTodayCount').textContent === '1','Cantidad de ventas del evento incorrecta');
  assert(window.__A33_CDM_STAGE2.summary().sales.total === 25,'Venta del evento incorrecta');
  assert(getElement('cashTodayState').textContent === 'OFF','Efectivo OFF incorrecto');
  assert(getElement('btnUseInPOS').disabled === false && getElement('usePosArea').hidden === false,'Usar en POS no aparece cuando corresponde');

  window.__A33_CDM_TEST.openUsePosModal();
  await window.__A33_CDM_TEST.activateVisualizedEventInPos();
  await wait(30);
  assert(dbData.meta.get('currentEventId').value === 2,'Usar en POS no cambió el evento tras confirmación');
  assert(window.__A33_CDM_STAGE2.posActiveEventId() === 2,'Evento activo POS no se recargó');

  dbData.cashV2.clear();
  dbData.events[0].cashV2Active = false;
  storage.set('arcano33_pedidos','[]');
  storage.set('a33_agenda_records_v1','[]');
  storage.set('arcano33_inventario',JSON.stringify({ liquids:{ wine:{ stock:90,max:100 } } }));
  await window.__A33_CDM_TEST.selectGlobalView();
  window.__A33_CDM_TEST.refreshOperationalSignals();
  await window.__A33_CDM_TEST.refreshEventSummary();
  await wait(20);
  assert(window.__A33_CDM_STAGE2.attentionCount() === 0,'Alertas obsoletas o duplicadas permanecen');
  assert(getElement('attentionEmpty').hidden === false,'No aparece Todo bajo control cuando corresponde');
  assert(getElement('attentionEmpty').textContent === 'Todo bajo control ✅','Texto Todo bajo control incorrecto');

  console.log('ETAPA 2 SMOKE OK');
  console.log('- Orden y ancho completo verificados');
  console.log('- Ventas/cantidad sin cortesías y solo eventos activos verificadas');
  console.log('- Efectivo ABIERTO/OFF y T/C vigente verificados');
  console.log('- 7 alertas reales priorizadas, sin duplicados, verificadas');
  console.log('- Todo bajo control verificado');
  console.log('- Visualizar no cambia POS; Usar en POS sí cambia tras confirmación');
  console.log('- Sin errores de consola en runtime simulado');
})().catch((error)=>{
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
