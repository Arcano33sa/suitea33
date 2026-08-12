'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'pedidos/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pedidos/style.css'), 'utf8');
const storageSource = fs.readFileSync(path.join(root, 'assets/js/a33-storage.js'), 'utf8');
const pedidosSource = fs.readFileSync(path.join(root, 'pedidos/script.js'), 'utf8');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

for (const id of [
  'pedido-mode-completo','pedido-mode-rapido','quick-order-form','quick-customer-search','quick-customer-select',
  'quick-delivery-date','quick-priority','quick-status','quick-product-select','quick-product-quantity','quick-product-add',
  'quick-product-lines','quick-pending-list','quick-history','quick-history-list','quick-pending-more','quick-history-more','quick-export-btn'
]) check(html.includes(`id="${id}"`), `Falta control ${id}.`);

check((html.match(/class="[^"]*pedido-completo-view/g) || []).length === 3, 'Pedido completo no conserva sus tres bloques aislados.');
check(/<details[^>]+id="quick-history"[^>]+hidden/.test(html), 'Histórico rápido no inicia cerrado y oculto.');
check(/option value="normal">Normal/.test(html) && /option value="alta">Alta/.test(html), 'Prioridades rápidas incorrectas.');
check(/option value="pendiente">Pendiente/.test(html) && /option value="entregado">Entregado/.test(html), 'Estados rápidos incorrectos.');
check(/min="1"[^>]+step="1"/.test(html), 'Cantidad rápida no exige entero mínimo 1.');
check(/const QUICK_ORDER_PAGE_SIZE = 30/.test(pedidosSource), 'Paginación rápida no usa 30 registros.');
check(/element\.style\.display = rapid \? 'none' : ''/.test(pedidosSource), 'Cambio de vista no blinda el ocultamiento del Pedido completo.');
check(/XLSX\.utils\.book_append_sheet\(wb, quickSheet, 'Pedidos rápidos'\)/.test(pedidosSource), 'Excel no agrega hoja Pedidos rápidos.');
check(/XLSX\.utils\.book_append_sheet\(wb, quickDetailSheet, 'Detalle rápidos'\)/.test(pedidosSource), 'Excel no agrega hoja Detalle rápidos.');
check(/createQuickOrderICSPED/.test(pedidosSource) && /PRODID:-\/\/Arcano 33\/\/Pedidos Rapidos\/\/ES/.test(pedidosSource), 'Falta exportación ICS rápida.');
check(/\.quick-order-card/.test(css) && /\.quick-history/.test(css), 'Faltan estilos compactos o de Histórico rápido.');

const values = new Map();
const localStorage = {
  get length(){ return values.size; }, key(index){ return Array.from(values.keys())[index] ?? null; },
  getItem(key){ return values.has(key) ? values.get(key) : null; },
  setItem(key,value){ values.set(String(key),String(value)); }, removeItem(key){ values.delete(String(key)); }
};
const document = {
  body:{ classList:{ add(){}, remove(){} }, appendChild(){} },
  getElementById(){ return null; }, querySelectorAll(){ return []; }, addEventListener(){}, createElement(){ return {}; }
};
const window = { localStorage, sessionStorage:localStorage, document, addEventListener(){}, location:{ origin:'https://example.test' } };
const context = vm.createContext({ window, document, localStorage, sessionStorage:localStorage, navigator:{}, console, URL, Blob, Date, Math, JSON, setTimeout, clearTimeout });
vm.runInContext(storageSource, context, { filename:'a33-storage.js' });
context.A33Storage = window.A33Storage;
vm.runInContext(pedidosSource, context, { filename:'pedidos-script.js' });

const ics = vm.runInContext(`createQuickOrderICSPED({
  id:'pr_ics', codigo:'PR-20260820-001', customerName:'Carlos Pérez', fechaEntrega:'2026-08-20', prioridad:'alta',
  items:[{ productId:'djeba', productNameSnapshot:'Djeba', cantidad:2 }, { productId:'media', productNameSnapshot:'Media', cantidad:3 }]
})`, context);
check(/DTSTART;VALUE=DATE:20260820/.test(ics), 'ICS no conserva fecha de entrega.');
check(/Cliente: Carlos Pérez/.test(ics.replace(/\\,/g, ',')), 'ICS no incluye cliente.');
check(/Prioridad: Alta/.test(ics), 'ICS no incluye prioridad.');
check(/2 Djeba/.test(ics) && /3 Media/.test(ics), 'ICS no incluye productos y cantidades.');
check(/UID:pr_ics@arcano33/.test(ics), 'ICS no usa ID estable como UID.');

check(!/arcano33_pedidos_rapidos_v1/.test(fs.readFileSync(path.join(root, 'centro-mando/app.js'), 'utf8')), 'Etapa 2 modificó integración de CdM anticipadamente.');

if (failures.length){
  console.error('PEDIDOS RÁPIDOS ETAPA 2 SMOKE FAIL');
  failures.forEach((failure) => console.error('- ' + failure));
  process.exit(1);
}
console.log('PEDIDOS RÁPIDOS ETAPA 2 SMOKE OK');
