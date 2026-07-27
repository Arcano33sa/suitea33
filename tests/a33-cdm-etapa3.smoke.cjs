const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'centro-mando', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'centro-mando', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'centro-mando', 'style.css'), 'utf8');

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const ordered = ['attentionBlock', 'ordersBlock', 'agendaBlock', 'inventoryBlock'];
let previous = -1;
for (const id of ordered){
  const index = html.indexOf(`id="${id}"`);
  check(index >= 0, `Falta ${id}`);
  check(index > previous, `Orden incorrecto de ${id}`);
  previous = index;
}

for (const id of [
  'ordersOverdue','ordersManufactureToday','ordersDeliveryToday','ordersUrgentList','btnGoOrders',
  'agendaMeetingsOverdue','agendaMeetingsToday','agendaMeetingsList','btnOpenAgendaMeetings',
  'agendaTasksOverdue','agendaTasksToday','agendaTasksList','btnOpenAgendaTasks',
  'agendaPurchasesOverdue','agendaPurchasesToday','agendaPurchasesList','btnOpenAgendaPurchases'
]) check(html.includes(`id="${id}"`), `Falta control ${id}`);

check(/id="btnGoOrders"[^>]*>Abrir Pedidos</.test(html), 'El botón de Pedidos no dice Abrir Pedidos');
check((html.match(/Abrir Agenda/g) || []).length >= 4, 'Cada categoría de Agenda no tiene acceso propio');
check(/\.cmd-block\s*\{[^}]*width\s*:\s*100%/s.test(css), 'Los bloques no cubren todo el ancho');
check(/\.cmd-agenda-categories\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/s.test(css), 'Agenda no usa columnas en computadora');
check(/@media \(min-width:821px\) and \(max-width:1180px\)[\s\S]*\.cmd-agenda-categories\s*\{\s*grid-template-columns:1fr/s.test(css), 'Agenda no se apila en iPad');
check(/@media \(max-width:820px\)[\s\S]*\.cmd-agenda-categories\s*\{\s*grid-template-columns:1fr/s.test(css), 'Agenda no se apila en móvil');
check(/overflow-x\s*:\s*hidden/.test(css), 'Falta blindaje contra scroll horizontal general');
check(/urgent:unique\.slice\(0,3\)/.test(js), 'Pedidos urgentes no están limitados a 3');
check(/rows:categoryRows\.slice\(0,3\)/.test(js), 'Categorías de Agenda no están limitadas a 3');
check(!/Pedidos mañana|ordersTomorrow|tomorrowOrders/i.test(html + js), 'Se agregó un bloque separado de mañana');
check(/fechaCreacion \?\? row\.fechaFabricacion \?\? row\.productionDate/.test(js), 'Fabricación no usa fechaCreacion/fechaFabricacion');
check(/fechaEntrega \?\? row\.deliveryDate/.test(js), 'Entrega no usa fechaEntrega/deliveryDate');
check(/row\.date \?\? row\.neededDate \?\? row\.fechaNecesaria/.test(js), 'Compras no usan fecha necesaria/programada');
check(/hecho.*cancelado/.test(js), 'Hecho y Cancelado no están excluidos');
check(/window\.__A33_CDM_STAGE3/.test(js), 'Falta diagnóstico de Etapa 3');
check(/btnOpenAgendaMeetings/.test(js) && /btnOpenAgendaTasks/.test(js) && /btnOpenAgendaPurchases/.test(js), 'Faltan enlaces funcionales de Agenda');
check(!/sharedSet\(ORDERS_KEY|sharedSet\(AGENDA_KEY|setItem\(ORDERS_KEY|setItem\(AGENDA_KEY/.test(js), 'Centro de Mando escribe datos de Pedidos o Agenda');

if (failures.length){
  console.error('ETAPA 3 STATIC SMOKE FAIL');
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
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this._innerHTML = '';
  }
  set innerHTML(value){ this._innerHTML = String(value); if (value === '') this.children = []; }
  get innerHTML(){ return this._innerHTML; }
  addEventListener(name, handler){ this.listeners.set(name, handler); }
  appendChild(child){ this.children.push(child); return child; }
  append(...children){ this.children.push(...children); }
  setAttribute(name, value){ this.attributes.set(name, String(value)); }
  contains(){ return false; }
  closest(){ return null; }
  focus(){}
  select(){}
}

const elements = new Map();
const getElement = (id)=>{
  if (!elements.has(id)) elements.set(id, new MockElement(id));
  return elements.get(id);
};
const document = {
  visibilityState:'visible',
  getElementById:getElement,
  createElement:(tag)=>new MockElement(tag),
  addEventListener(){}
};
const storage = new Map();
const localStorage = {
  getItem:(key)=>storage.has(key) ? storage.get(key) : null,
  setItem:(key,value)=>storage.set(key,String(value)),
  removeItem:(key)=>storage.delete(key)
};
const window = {
  document,
  localStorage,
  A33Storage:null,
  location:{ href:'http://localhost/centro-mando/index.html' },
  addEventListener(){}
};
const context = vm.createContext({
  window, document, localStorage,
  console, Intl, Date, Number, String, Object, Array, Map, Set, Math, JSON, RegExp, Promise,
  encodeURIComponent, setTimeout, clearTimeout
});

const hooks = `\nwindow.__A33_CDM_TEST3 = { readOrdersSignals, readAgendaSignals, renderOrders, renderAgenda, state:()=>state };`;
vm.runInContext(js + hooks, context, { filename:'centro-mando/app.js' });

const localYmd = (date)=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
const today = localYmd(new Date());
const yesterdayDate = new Date(); yesterdayDate.setDate(yesterdayDate.getDate()-1);
const yesterday = localYmd(yesterdayDate);
const tomorrowDate = new Date(); tomorrowDate.setDate(tomorrowDate.getDate()+1);
const tomorrow = localYmd(tomorrowDate);

storage.set('arcano33_pedidos', JSON.stringify([
  { id:'p1', estado:'pendiente', fechaCreacion:yesterday, fechaEntrega:yesterday, clienteNombre:'Cliente vencido', productosPedido:[{productName:'Galón 3720 ml',qty:1}] },
  { id:'p2', estado:'pendiente', fechaCreacion:yesterday, fechaEntrega:today, clienteNombre:'Cliente entrega', productosPedido:[{productName:'Botella',qty:2}] },
  { id:'p3', estado:'pendiente', fechaCreacion:today, fechaEntrega:tomorrow, clienteNombre:'Cliente fabrica', productosPedido:[{productName:'Pulso',qty:3}] },
  { id:'p4', estado:'pendiente', fechaCreacion:today, fechaEntrega:today, clienteNombre:'Cliente doble', productosPedido:[{productName:'Media',qty:1}] },
  { id:'p5', estado:'entregado', fechaCreacion:today, fechaEntrega:yesterday, clienteNombre:'Entregado' },
  { id:'p6', estado:'cancelado', fechaCreacion:today, fechaEntrega:yesterday, clienteNombre:'Cancelado' }
]));

storage.set('a33_agenda_records_v1', JSON.stringify({ records:[
  { id:'m1', type:'reunion', date:yesterday, time:'09:00', status:'pendiente', subject:'Reunión vencida', client:'Cliente A', priority:'alta' },
  { id:'m2', type:'reunion', date:today, time:'11:00', status:'pendiente', subject:'Reunión hoy', client:'Cliente B', priority:'media' },
  { id:'m3', type:'reunion', date:today, status:'cancelado', subject:'Reunión cancelada' },
  { id:'t1', type:'tarea', date:yesterday, status:'pendiente', subject:'Tarea vencida', context:'Bodega', priority:'alta' },
  { id:'t2', type:'tarea', date:today, status:'pendiente', subject:'Tarea hoy', priority:'baja' },
  { id:'t3', type:'tarea', date:today, status:'hecho', subject:'Tarea hecha' },
  { id:'c1', type:'compra', fechaNecesaria:yesterday, status:'pendiente', priority:'alta', purchaseGroup:{ itemCount:4, totalGeneral:450, items:[{name:'Vino'},{name:'Vodka'},{name:'Jugo'},{name:'Sirope'}] } },
  { id:'c2', type:'compra', date:today, status:'pendiente', priority:'media', purchaseGroup:{ itemCount:2, totalGeneral:200, items:[{name:'Botellas'},{name:'Tapas'}] } },
  { id:'c3', type:'compra', date:today, status:'cancelado', purchaseGroup:{ itemCount:1, totalGeneral:50, items:[{name:'Cancelada'}] } }
]}));

const api = window.__A33_CDM_TEST3;
const orders = api.readOrdersSignals();
if (orders.overdue !== 1) throw new Error('Pedidos vencidos incorrectos');
if (orders.manufactureToday !== 2) throw new Error('Fabricar hoy incorrecto');
if (orders.today !== 2) throw new Error('Entregar hoy incorrecto');
if (orders.pending !== 4) throw new Error('Entregados/cancelados no fueron excluidos');
if (orders.urgent.length !== 3) throw new Error('No se limita a 3 pedidos urgentes');
if (new Set(orders.urgent.map((row)=>row.id)).size !== orders.urgent.length) throw new Error('Pedidos urgentes duplicados');
if (!orders.urgent[0].productSummary.includes('Galón 3720 ml')) throw new Error('Resumen de producto no visible');

const agenda = api.readAgendaSignals();
if (agenda.categories.meeting.overdue !== 1 || agenda.categories.meeting.today !== 1) throw new Error('Conteo de Reuniones incorrecto');
if (agenda.categories.task.overdue !== 1 || agenda.categories.task.today !== 1) throw new Error('Conteo de Tareas incorrecto');
if (agenda.categories.purchase.overdue !== 1 || agenda.categories.purchase.today !== 1) throw new Error('Conteo de Compras incorrecto');
if (agenda.categories.meeting.total !== 2 || agenda.categories.task.total !== 2 || agenda.categories.purchase.total !== 2) throw new Error('Hecho/Cancelado entró en Agenda');
if (agenda.categories.purchase.rows[0].date !== yesterday) throw new Error('Compras no respetan fechaNecesaria');
if (agenda.categories.purchase.rows[0].purchaseCount !== 4) throw new Error('Cantidad de artículos incorrecta');
if (agenda.categories.purchase.rows[0].purchaseItems.slice(0,3).join(',') !== 'Vino,Vodka,Jugo') throw new Error('Nombres de artículos incorrectos');
if (agenda.categories.purchase.rows[0].purchaseTotal !== 450) throw new Error('Presupuesto total incorrecto');

api.state().orderSignals = orders;
api.state().agendaSignals = agenda;
api.renderOrders();
api.renderAgenda();
if (getElement('ordersOverdue').textContent !== '1') throw new Error('Render de Pedidos vencidos incorrecto');
if (getElement('ordersManufactureToday').textContent !== '2') throw new Error('Render Fabricar hoy incorrecto');
if (getElement('ordersDeliveryToday').textContent !== '2') throw new Error('Render Entregar hoy incorrecto');
if (getElement('ordersUrgentList').children.length !== 3) throw new Error('Render muestra más o menos de 3 pedidos urgentes');
if (getElement('agendaMeetingsList').children.length > 3 || getElement('agendaTasksList').children.length > 3 || getElement('agendaPurchasesList').children.length > 3) throw new Error('Agenda muestra más de 3 filas por categoría');
if (getElement('agendaPurchasesOverdue').textContent !== '1' || getElement('agendaPurchasesToday').textContent !== '1') throw new Error('Render de Compras incorrecto');

console.log('ETAPA 3 SMOKE OK');
console.log('- Pedidos vencidos, fabricar hoy y entregar hoy verificados');
console.log('- Máximo 3 pedidos urgentes, sin duplicados, verificado');
console.log('- Reuniones, Tareas y Compras separadas con vencidas/para hoy verificadas');
console.log('- Hecho, Entregado y Cancelado excluidos');
console.log('- Compras usan fecha necesaria, artículos y presupuesto correctos');
console.log('- Bloques full-width, responsive y sin scroll horizontal verificados');
console.log('- Navegación y compatibilidad de solo lectura verificadas');
