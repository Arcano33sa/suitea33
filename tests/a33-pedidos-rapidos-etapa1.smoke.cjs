'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const storageSource = fs.readFileSync(path.join(root, 'assets/js/a33-storage.js'), 'utf8');
const pedidosSource = fs.readFileSync(path.join(root, 'pedidos/script.js'), 'utf8');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const values = new Map();
const localStorage = {
  get length(){ return values.size; },
  key(index){ return Array.from(values.keys())[index] ?? null; },
  getItem(key){ return values.has(key) ? values.get(key) : null; },
  setItem(key, value){ values.set(String(key), String(value)); },
  removeItem(key){ values.delete(String(key)); }
};

const document = {
  getElementById(){ return null; },
  querySelectorAll(){ return []; },
  addEventListener(){}
};
const window = {
  localStorage,
  sessionStorage:localStorage,
  document,
  addEventListener(){},
  location:{ origin:'https://example.test' }
};
const context = vm.createContext({
  window,
  document,
  localStorage,
  sessionStorage:localStorage,
  navigator:{},
  console,
  URL,
  Date,
  Math,
  JSON,
  setTimeout,
  clearTimeout
});

vm.runInContext(storageSource, context, { filename:'a33-storage.js' });
context.A33Storage = window.A33Storage;
vm.runInContext(pedidosSource, context, { filename:'pedidos-script.js' });

const model = window.A33PedidosRapidosModel;
check(!!model, 'No se expuso A33PedidosRapidosModel.');
check(model && model.storageKey === 'arcano33_pedidos_rapidos_v1', 'Clave de almacenamiento incorrecta.');
check(model && model.schemaVersion === 1, 'Versión de esquema incorrecta.');

const firstCode = model.generateCode('2026-08-20', []);
const nextCode = model.generateCode('2026-08-20', [{ codigo:firstCode }, { codigo:'PR-20260820-009' }]);
check(firstCode === 'PR-20260820-001', 'Primer código rápido incorrecto.');
check(nextCode === 'PR-20260820-010', 'Consecutivo rápido incorrecto.');
check(model.generateCode('2026-02-31', []) === '', 'Se aceptó una fecha imposible para generar código.');

const valid = model.validate({
  id:'pr_test_1',
  codigo:firstCode,
  customerId:'c1',
  customerName:'  Carlos   Pérez ',
  fechaEntrega:'2026-08-20',
  prioridad:'Alta',
  estado:'pendiente',
  items:[
    { productId:'prd_djeba', productNameSnapshot:'Djeba', cantidad:2 },
    { productId:'prd_media', productNameSnapshot:'Media', cantidad:3 },
    { productId:'prd_vaso', productNameSnapshot:'Vaso', cantidad:10 }
  ]
});
check(valid.ok, 'Un Pedido rápido válido fue rechazado: ' + valid.message);
check(valid.data.customerName === 'Carlos Pérez', 'No se normalizó el nombre del cliente.');
check(valid.data.prioridad === 'alta', 'No se normalizó prioridad Alta.');
check(valid.data.items.length === 3, 'Los productos no permanecen dentro de un solo pedido.');

const invalid = model.validate({
  id:'pr_test_2',
  codigo:'PR-20260820-002',
  customerName:'Carlos Pérez',
  fechaEntrega:'2026-08-20',
  prioridad:'normal',
  estado:'pendiente',
  items:[
    { productId:'prd_djeba', productNameSnapshot:'Djeba', cantidad:0 },
    { productId:'prd_djeba', productNameSnapshot:'Djeba', cantidad:2 }
  ]
});
check(!invalid.ok, 'Se aceptaron cantidad cero o producto duplicado.');

const invalidEnums = model.validate({
  id:'pr_test_3',
  codigo:'PR-20260820-003',
  customerName:'Carlos Pérez',
  fechaEntrega:'2026-08-20',
  prioridad:'urgente',
  estado:'cerrado',
  items:[{ productId:'prd_media', productNameSnapshot:'Media', cantidad:1 }]
});
check(!invalidEnums.ok, 'Se aceptaron prioridad o estado fuera del contrato rápido.');

const legacy = model.normalize({
  clienteId:'c_old',
  clienteNombre:'Cliente Histórico',
  deliveryDate:'2026-09-01',
  prioridad:'desconocida',
  entregado:true,
  productosPedido:[{ productoId:'prd_old', nombre:'Producto inactivo', qty:'4' }]
});
check(/^pr_legacy_/.test(legacy.id), 'No se creó ID determinista para registro legacy.');
check(legacy.estado === 'entregado' && legacy.prioridad === 'normal', 'Compatibilidad de estado/prioridad incorrecta.');
check(legacy.items[0].productNameSnapshot === 'Producto inactivo', 'No se conservó snapshot histórico del producto.');

const saved = model.save([valid.data, legacy]);
check(saved && saved.ok, 'No se guardó la colección mediante el contrato compartido.');
const loaded = model.load();
check(loaded.length === 2, 'La colección guardada no se recuperó completa.');
check(loaded[0].tipoPedido === 'rapido', 'El discriminador tipoPedido no se preservó.');
check(loaded[1].id === legacy.id, 'El ID legacy cambió al persistir.');
check(!values.has('arcano33_pedidos'), 'La persistencia rápida contaminó Pedido completo.');
check(!values.has('arcano33_pedidos_archived'), 'La persistencia rápida contaminó el Histórico completo.');

if (failures.length){
  console.error('PEDIDOS RÁPIDOS ETAPA 1 SMOKE FAIL');
  failures.forEach((failure)=>console.error('- ' + failure));
  process.exit(1);
}

console.log('PEDIDOS RÁPIDOS ETAPA 1 SMOKE OK');
