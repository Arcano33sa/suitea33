// Coherencia de versiones y precache: a33-publicacion-coherencia.smoke.cjs.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (rel)=>fs.readFileSync(path.join(root, rel), 'utf8');
const app = read('centro-mando/app.js');
const css = read('centro-mando/style.css');
const index = read('centro-mando/index.html');
const sw = read('centro-mando/sw.js');
const pos = read('pos/app.js');
const posSw = read('pos/sw.js');
const release = read('assets/js/a33-release.js');

assert(app.includes('function readPendingCreditSales(eventIds)'), 'Falta lectura normalizada de créditos');
assert(app.includes("readCreditRowsCDM('sales')"), 'CDM no consume sales');
assert(app.includes("readCreditRowsCDM('cashV2')"), 'CDM no consume cashV2');
assert(app.includes("title:'Ventas al crédito pendientes'"), 'Indicador no integrado en Atención requerida');
assert(app.includes('createCreditAttentionItem'), 'Falta detalle compacto de créditos');
assert(app.includes('state.visualMode === MODE_GLOBAL'), 'Falta alcance GLOBAL');
assert(app.includes('bindCreditUpdateSignalsCDM'), 'Falta actualización automática');
assert(app.includes('BroadcastChannel'), 'Falta canal de actualización entre módulos');
assert(app.includes('setInterval'), 'Falta refresco defensivo para cambios externos/reversiones');
assert(pos.includes('notifyCreditStateChangedPOS'), 'POS no notifica cambios de crédito');
assert(pos.includes("reason:'collection'"), 'Cobros no notifican al Centro de Mando');
assert(pos.includes("reason:'sale'"), 'Ventas al crédito no notifican al Centro de Mando');
assert(pos.includes("reason:'sale-deleted'"), 'Borrado seguro no notifica al Centro de Mando');
assert(css.includes('.cmd-credit-grid'), 'Falta layout del detalle');
assert(css.includes('@media (max-width:470px)'), 'Falta responsive móvil del detalle');
assert(css.includes('white-space:nowrap'), 'Montos/valores no están blindados a una línea');

class MockElement {
  constructor(id=''){
    this.id=id; this.hidden=false; this.disabled=false; this.textContent=''; this.value='';
    this.className=''; this.dataset={}; this.children=[]; this.attributes=new Map(); this.listeners=new Map();
    this.classList={ add(){}, remove(){}, contains(){ return false; } };
  }
  set innerHTML(v){ this._innerHTML=String(v); if(v==='') this.children=[]; }
  get innerHTML(){ return this._innerHTML||''; }
  appendChild(child){ this.children.push(child); return child; }
  append(...children){ children.forEach((c)=>this.appendChild(c)); }
  addEventListener(name,fn){ this.listeners.set(name,fn); }
  setAttribute(name,value){ this.attributes.set(name,String(value)); }
  getAttribute(name){ return this.attributes.get(name)||null; }
  querySelector(){ return null; }
  closest(){ return null; }
  contains(node){ return node===this || this.children.includes(node); }
  focus(){}
  blur(){}
}
const elements = new Map();
const getEl=(id)=>{ if(!elements.has(id)) elements.set(id,new MockElement(id)); return elements.get(id); };
['attentionList','attentionEmpty','attentionCount'].forEach(getEl);
const document = {
  readyState:'loading', visibilityState:'visible', activeElement:null,
  getElementById:getEl,
  createElement:()=>new MockElement(),
  addEventListener(){},
  querySelector(){ return null; },
  querySelectorAll(){ return []; }
};
const localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };
const windowObj = {
  addEventListener(){}, dispatchEvent(){}, setInterval(){ return 1; }, clearInterval(){},
  location:{ href:'' }, A33Theme:null, A33Storage:null, A33Currency:null
};
const navigator = { serviceWorker:null };

function makeDb(sales,cash){
  const data = { sales, cashV2:cash, events:[], products:[], meta:[] };
  return {
    objectStoreNames:{ contains:(name)=>Object.prototype.hasOwnProperty.call(data,name) },
    transaction(name){
      const tx = { objectStore(){ return {
        getAll(){ const req={}; queueMicrotask(()=>{ req.result=structuredClone(data[name]||[]); req.onsuccess&&req.onsuccess(); queueMicrotask(()=>tx.oncomplete&&tx.oncomplete()); }); return req; },
        get(){ const req={}; queueMicrotask(()=>{ req.result=null; req.onsuccess&&req.onsuccess(); }); return req; },
        indexNames:{ contains(){ return false; } }
      }; } };
      return tx;
    }
  };
}

const context = vm.createContext({
  console, Date, Math, Number, String, Object, Array, Set, Map, Promise, Error, RegExp, Intl,
  structuredClone, queueMicrotask, setTimeout, clearTimeout, requestAnimationFrame:(fn)=>fn(),
  document, localStorage, navigator, window:windowObj, globalThis:null, CustomEvent:function(){}, BroadcastChannel:undefined,
  IDBKeyRange:{ only:(v)=>v }
});
context.globalThis=context;
vm.runInContext(app + '\n;globalThis.__creditTest={state,readPendingCreditSales,renderAttention,refreshEventSummary};', context, {filename:'centro-mando-app.js'});
const api = context.__creditTest;
api.state.events = [
  {id:1,name:'Expo Julio'}, {id:2,name:'Feria Agosto'}, {id:3,name:'Cerrado',closed:true}
];
api.state.eventsById = new Map(api.state.events.map((e)=>[e.id,e]));
api.state.productsById = new Map();

const sales = [
  {id:1,eventId:1,eventName:'Expo Julio',payment:'credito',total:300,customerName:'Carlos',productNameSnapshot:'Djeba',date:'2026-07-27',seqId:1},
  {id:1,eventId:1,eventName:'Expo Julio',payment:'credito',total:300,customerName:'Carlos',productNameSnapshot:'Djeba',date:'2026-07-27',seqId:1},
  {id:2,eventId:1,eventName:'Expo Julio',payment:'credito',total:400,creditPaidAmount:100,customerName:'Ana',productNameSnapshot:'Catrina',date:'2026-07-26',seqId:2,creditPayments:[{creditPaymentId:'P-2',amount:100}]},
  {id:3,eventId:2,eventName:'Feria Agosto',payment:'credito',total:200,customerName:'Luis',productNameSnapshot:'Vaso',date:'2026-07-25',seqId:3},
  {id:4,eventId:2,eventName:'Feria Agosto',payment:'efectivo',total:100,customerName:'Marta',productNameSnapshot:'Pulso',date:'2026-07-25'},
  {id:5,eventId:2,eventName:'Feria Agosto',payment:'credito',total:150,customerName:'Sofía',productNameSnapshot:'Media',date:'2026-07-24',seqId:5},
  {id:6,eventId:3,eventName:'Cerrado',payment:'credito',total:999,customerName:'Fuera',date:'2026-07-23'}
];
const cash = [{ key:'cash:v2:1:2026-07-27', movements:[
  {id:'DUP-P2',movementType:'CREDIT_COLLECTION',creditSaleId:2,creditPaymentId:'P-2',amount:100},
  {id:'P3',movementType:'CREDIT_COLLECTION',creditSaleId:3,creditPaymentId:'P-3',amount:200},
  {id:'REV5',movementType:'CREDIT_COLLECTION',creditSaleId:5,creditPaymentId:'P-5',amount:50,status:'REVERSED'}
]}];
api.state.db = makeDb(sales,cash);

(async()=>{
  const eventOne = await api.readPendingCreditSales([1]);
  assert.strictEqual(eventOne.count,2,'Vista por evento mezcló o duplicó ventas');
  assert.strictEqual(eventOne.totalBalance,600,'Saldo por evento incorrecto');
  assert.strictEqual(eventOne.items.find((x)=>x.id===2).status,'ABONADA','Estado de abono incorrecto');
  assert.strictEqual(eventOne.items.find((x)=>x.id===2).paid,100,'Duplicó pago entre venta y movimiento');

  const global = await api.readPendingCreditSales([1,2]);
  assert.strictEqual(global.count,3,'GLOBAL no consolidó correctamente');
  assert.strictEqual(global.totalBalance,750,'Saldo GLOBAL incorrecto');
  assert(!global.items.some((x)=>x.id===3),'Venta pagada apareció en pendientes');
  assert(global.items.some((x)=>x.id===5 && x.balance===150),'Movimiento revertido no restauró saldo');
  assert(global.items.every((x)=>[1,2].includes(x.eventId)),'GLOBAL mezcló evento fuera de alcance');

  const all = await api.readPendingCreditSales();
  assert.strictEqual(all.totalBalance,1749,'Total completo debe incluir eventos cerrados');
  assert.strictEqual(all.count,4);
  assert(all.items.some(item=>item.eventId===3));
  api.state.visualMode='EVENTO'; api.state.visualEventId=1; api.state.visualEvent=api.state.events[0];
  await api.refreshEventSummary();
  assert.strictEqual(api.state.creditSignal.totalBalance,1749,'Selector por evento no debe recortar las deudas');
  api.state.visualEvent=null;api.state.visualEventId=null;
  await api.refreshEventSummary();
  assert.strictEqual(api.state.creditSignal.totalBalance,1749,'Sin selección deben conservarse todas las deudas');

  api.state.creditSignal=all;
  api.state.fxSignal={hasRate:true};
  api.state.summarySignals={cash:{openCount:0},credits:global};
  api.state.orderSignals=null; api.state.agendaSignals=null; api.state.inventorySignals=null;
  api.renderAttention();
  assert.strictEqual(Number(getEl('attentionCount').textContent),1,'Indicador de crédito no cuenta como alerta única');
  assert.strictEqual(getEl('attentionList').children.length,1,'Indicador no quedó dentro de Atención requerida');
  assert(String(getEl('attentionList').children[0].className).includes('cmd-credit-attention'),'No se renderizó el indicador especializado');

  const treeText = node => String(node.textContent) + (node.children || []).map(treeText).join(' ');
  assert(treeText(getEl('attentionList')).includes('Todos los eventos, incluidos cerrados'));
  assert(treeText(getEl('attentionList')).includes('Carlos · 1 venta'));
  assert(treeText(getEl('attentionList')).includes('Cerrado'));

  const cashPaid = structuredClone(cash);
  cashPaid[0].movements.push({id:'P1-FINAL',movementType:'CREDIT_COLLECTION',creditSaleId:1,creditPaymentId:'P-1F',amount:300});
  api.state.db=makeDb(sales,cashPaid);
  const afterFinal=await api.readPendingCreditSales([1]);
  assert.strictEqual(afterFinal.count,1,'Pago final no retiró la venta de pendientes');
  assert.strictEqual(afterFinal.totalBalance,300,'Saldo después del pago final incorrecto');

  api.state.db={objectStoreNames:{contains:()=>true}, transaction(){throw Error('Read failure');}};
  const unavailable=await api.readPendingCreditSales();
  assert.strictEqual(unavailable.ok,false,'Error de lectura no debe parecer cero deudas');
  api.state.creditSignal=unavailable;api.renderAttention();
  assert(treeText(getEl('attentionList')).includes('Créditos pendientes no disponibles'));
  api.state.db=makeDb([{id:22,eventId:999,payment:'credito',total:10,customer:'Sin evento'}],[]);
  const orphan=await api.readPendingCreditSales();assert.strictEqual(orphan.totalBalance,10);
  api.state.db=makeDb([],[]);const empty=await api.readPendingCreditSales();
  assert.strictEqual(empty.ok,true);assert.strictEqual(empty.count,0);
  console.log('PASS: créditos filtrados y completos, eventos cerrados/ausentes, abonos, reversiones, pago final, selección vacía, agrupación por cliente, errores y lista vacía.');
})().catch((error)=>{ console.error(error.stack||error); process.exitCode=1; });
