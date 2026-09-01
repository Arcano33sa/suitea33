'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const contractSource = fs.readFileSync(path.join(root, 'assets/js/a33-firestore-data.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-apply-e6.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

const storage = Object.create(null);
const context = {
  console, Date, Math, JSON, Object, Array, Map, Number, String, RegExp, parseInt, TextEncoder,
  localStorage:{ getItem(key){ return storage[key] || null; }, setItem(key, value){ storage[key] = String(value); } }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(contractSource, context, { filename:'a33-firestore-data.js' });
vm.runInContext(source, context, { filename:'a33-firebase-apply-e6.js' });

const backup = {
  meta:{ appName:'Suite A33', backupType:'full' },
  data:{
    localStorage:{
      arcano33_inventario:JSON.stringify({
        liquids:{ tea:{ stock:10, max:20 } },
        bottles:{ b750:{ stock:5 } },
        finished:{ kombucha:{ stock:4 } },
        finishedByProductId:{ product1:{ stock:3 } },
        caps:{ corcho:{ stock:12 } },
        varios:[{ id:'var-1', stock:2 }],
        movimientos:[{ id:'mov-1', type:'entrada', quantity:5 }]
      }),
      arcano33_recetas_v1:JSON.stringify({ recetas:{ product1:{ tea:1 } } }),
      arcano33_fecha_produccion:'2026-08-17',
      arcano33_pedidos:JSON.stringify([{ id:'order-1', total:100 }]),
      arcano33_pedidos_rapidos_v1:JSON.stringify([{ id:'quick-1', total:50 }]),
      arcano33_pedidos_archived:JSON.stringify([{ id:'old-1', total:75 }]),
      a33_pedidos_draft_v1:JSON.stringify({ id:'draft-no-debe-aplicarse' }),
      a33_agenda_records_v1:JSON.stringify({ records:[
        { id:'meet-1', type:'reunion', subject:'Visita' },
        { id:'task-1', type:'tarea', subject:'Llamar' },
        { id:'buy-1', type:'compra', subject:'Comprar té' }
      ] }),
      a33_pos_pending_sale:JSON.stringify({ id:'sale-no-debe-aplicarse' })
    },
    indexedDB:{ 'a33-pos':{ sales:[{ id:'sale-1' }] }, finanzasdb:{ cobrar:[{ id:'cobro-1' }] } }
  }
};

const options = { workspaceId:'arcano33', uid:'admin-1', deviceId:'mac' };
const plan = context.A33FirebaseApplyE6.buildPlan(backup, options);
assert(plan.length >= 11, 'E6 no construyó los registros operativos esperados.');
assert(plan.every((item) => ['inventario','pedidos','agenda'].includes(item.moduleId)), 'E6 incluyó un módulo fuera de alcance.');
assert(!plan.some((item) => ['pos','finanzas','seguridad'].includes(item.moduleId)), 'E6 tocó un módulo crítico pendiente.');
assert(plan.some((item) => item.entityId === 'existencias'), 'No se mapearon existencias.');
assert(plan.some((item) => item.entityId === 'movimientos' && item.recordId === 'mov-1'), 'No se mapearon movimientos.');
assert(plan.some((item) => item.entityId === 'recetas'), 'No se mapearon recetas.');
assert(plan.some((item) => item.entityId === 'calculadora_produccion'), 'No se mapearon datos de producción.');
assert(plan.some((item) => item.entityId === 'pedidos' && item.recordId === 'order-1'), 'No se mapearon pedidos activos.');
assert(plan.some((item) => item.entityId === 'pedidos_rapidos' && item.recordId === 'quick-1'), 'No se mapearon pedidos rápidos.');
assert(plan.some((item) => item.entityId === 'historico' && item.recordId === 'old-1'), 'No se mapeó el histórico de pedidos.');
assert(plan.some((item) => item.entityId === 'reuniones'), 'No se mapearon reuniones.');
assert(plan.some((item) => item.entityId === 'tareas'), 'No se mapearon tareas.');
assert(plan.some((item) => item.entityId === 'compras'), 'No se mapearon compras.');
assert(!plan.some((item) => item.recordId.includes('draft-no')), 'E6 incluyó un borrador temporal.');
assert(plan.every((item) => context.A33FirestoreData.validateDocument(item).ok), 'E6 produjo un documento no válido.');

const repeated = context.A33FirebaseApplyE6.buildPlan(backup, options);
assert.deepStrictEqual(Array.from(repeated.map((item) => item.path)), Array.from(plan.map((item) => item.path)), 'E6 no conserva IDs estables al repetirse.');

assert(html.includes('id="cfg-apply-e6-run"'), 'Falta el botón de E6.');
assert(html.includes('a33-firebase-apply-e6.js?v=4.20.98&amp;r=1'), 'Falta cargar el motor E6.');
assert(html.includes('script.js?v=4.20.98&amp;r=53'), 'No se actualizó la revisión del script de Configuración.');
assert(configSource.includes('function applyStageE6()'), 'Configuración no integra la aplicación E6.');
assert(source.includes("doc('e5')"), 'E6 no exige la finalización previa de E5.');
assert(source.includes('e5.sourceChecksum !== manifest.checksum'), 'E6 no vincula E5 con la misma carga E4.');
assert(rules.includes('validStage6Record'), 'Faltan validaciones Firestore de E6.');
assert(rules.includes('match /applications/e6'), 'E6 no deja constancia separada de aplicación.');

console.log('OK E6 Firebase intermediate application smoke');
