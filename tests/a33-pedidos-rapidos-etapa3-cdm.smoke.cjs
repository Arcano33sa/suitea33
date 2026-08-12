'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'centro-mando', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'centro-mando', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'centro-mando', 'style.css'), 'utf8');
const pedidosJs = fs.readFileSync(path.join(root, 'pedidos', 'script.js'), 'utf8');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(js.includes("const QUICK_ORDERS_KEY = 'arcano33_pedidos_rapidos_v1'"), 'CdM no lee la colección rápida.');
check(/addCalendarDaysYmd\(state\.today,15\)/.test(js), 'Falta ventana inclusiva de 15 días.');
check(/row\.delivery <= quickLimit/.test(js), 'El día 15 no está incluido.');
check(/sourceType:'rapido'[\s\S]*production:''/.test(js), 'Pedido rápido genera fecha de fabricación.');
check(/label:'Entrega próxima'/.test(js), 'Falta estado de mañana Entrega próxima.');
check(/label:'Entregar hoy'/.test(js), 'Falta estado Entrega hoy.');
check(/`Entrega \$\{ymdToDisplay\(row\.delivery\)\} — \$\{row\.customer\} — \$\{row\.priority\}`/.test(js), 'Formato compacto rápido en CdM incorrecto.');
check(/label:'Vencido'/.test(js), 'Falta estado Vencido.');
check(/label:'Pedido próximo'/.test(js), 'Falta estado Pedido próximo.');
check(/urgent:unique\.slice\(0,3\)/.test(js), 'La lista urgente no está limitada a tres.');
check(html.includes('id="btnOrdersMore"') && html.includes('id="ordersMoreWrap"'), 'Falta control Ver más.');
check(/btnOrdersMore[^\n]+view=rapido/.test(js), 'Ver más no abre la vista rápida.');
check(/\.cmd-list-more\[hidden\]/.test(css), 'Falta ocultamiento del control Ver más.');
check(/URLSearchParams\(window\.location\.search\)[\s\S]*view.*rapido/.test(pedidosJs), 'Pedidos no abre la vista rápida desde CdM.');

const storage = new Map();
const localStorage = {
  getItem:key => storage.has(key) ? storage.get(key) : null,
  setItem:(key,value) => storage.set(key,String(value)),
  removeItem:key => storage.delete(key)
};
const document = { getElementById(){ return null; }, addEventListener(){}, createElement(){ return { classList:{ add(){} }, append(){}, appendChild(){}, addEventListener(){}, setAttribute(){}, style:{} }; } };
const window = { localStorage, addEventListener(){}, location:{ href:'', search:'' } };
const context = vm.createContext({ window, document, localStorage, console, Date, Math, JSON, setTimeout, clearTimeout, navigator:{ onLine:true } });

// El archivo registra funciones al cargar, pero DOMContentLoaded no se dispara en esta prueba.
vm.runInContext(js, context, { filename:'centro-mando-app.js' });
vm.runInContext("state.today='2026-08-12'", context);

storage.set('arcano33_pedidos', JSON.stringify([
  { id:'full-future', estado:'pendiente', fechaEntrega:'2026-12-01', fechaCreacion:'2026-11-30', customerName:'Completo lejano' }
]));
storage.set('arcano33_pedidos_rapidos_v1', JSON.stringify([
  { id:'q-overdue', estado:'pendiente', fechaEntrega:'2026-08-11', customerName:'Vencido', prioridad:'alta', items:[{ productNameSnapshot:'Djeba', cantidad:2 }] },
  { id:'q-today', estado:'pendiente', fechaEntrega:'2026-08-12', customerName:'Hoy', prioridad:'normal', items:[{ productNameSnapshot:'Media', cantidad:3 }] },
  { id:'q-tomorrow', estado:'pendiente', fechaEntrega:'2026-08-13', customerName:'Mañana', prioridad:'alta', items:[{ productNameSnapshot:'Vaso', cantidad:10 }] },
  { id:'q-day15', estado:'pendiente', fechaEntrega:'2026-08-27', customerName:'Día quince', prioridad:'normal', items:[{ productNameSnapshot:'Litro', cantidad:1 }] },
  { id:'q-day16', estado:'pendiente', fechaEntrega:'2026-08-28', customerName:'Día dieciséis', prioridad:'normal', items:[{ productNameSnapshot:'Galón', cantidad:1 }] },
  { id:'q-closed', estado:'entregado', fechaEntrega:'2026-08-12', customerName:'Entregado', prioridad:'alta', items:[{ productNameSnapshot:'Djeba', cantidad:1 }] }
]));

const signal = vm.runInContext('readOrdersSignals()', context);
const quickRows = signal.allRows.filter(row => row.sourceType === 'rapido');
check(signal.completePending === 1, 'Pedido completo futuro dejó de conservarse.');
check(signal.quickPending === 4, `Se esperaban 4 rápidos visibles y resultaron ${signal.quickPending}.`);
check(quickRows.some(row => row.id === 'rapido:q-day15'), 'No se incluyó el día 15 exacto.');
check(!quickRows.some(row => row.id === 'rapido:q-day16'), 'Se incluyó indebidamente el día 16.');
check(!quickRows.some(row => row.id === 'rapido:q-closed'), 'CdM incluyó un rápido Entregado.');
check(quickRows.find(row => row.id === 'rapido:q-overdue').temporal.label === 'Vencido', 'Clasificación vencida incorrecta.');
check(quickRows.find(row => row.id === 'rapido:q-today').temporal.label === 'Entregar hoy', 'Clasificación de hoy incorrecta.');
check(quickRows.find(row => row.id === 'rapido:q-tomorrow').temporal.label === 'Entrega próxima', 'Clasificación de mañana incorrecta.');
check(quickRows.find(row => row.id === 'rapido:q-day15').temporal.label === 'Pedido próximo', 'Clasificación próxima incorrecta.');
check(signal.urgent.length === 3, 'CdM no limita a tres más urgentes.');
check(quickRows.every(row => row.production === ''), 'Un rápido tiene fabricación.');
check(quickRows.find(row => row.id === 'rapido:q-tomorrow').productSummary.includes('10× Vaso'), 'Resumen compacto perdió cantidad/producto.');

if (failures.length){
  console.error('PEDIDOS RÁPIDOS ETAPA 3 CDM SMOKE FAIL');
  failures.forEach(failure => console.error('- ' + failure));
  process.exit(1);
}
console.log('PEDIDOS RÁPIDOS ETAPA 3 CDM SMOKE OK');
