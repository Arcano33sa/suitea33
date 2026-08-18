'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const contractSource = fs.readFileSync(path.join(root, 'assets/js/a33-firestore-data.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-apply-e5.js'), 'utf8');
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
vm.runInContext(source, context, { filename:'a33-firebase-apply-e5.js' });

const backup = {
  meta:{ appName:'Suite A33', backupType:'full' },
  data:{
    localStorage:{
      suite_a33_identity_v1:JSON.stringify({ brand:'Arcano 33' }),
      suite_a33_currency_settings_v1:JSON.stringify({ code:'NIO' }),
      a33_catalog_envases:JSON.stringify([{ id:'env-1', name:'Botella 750 ml' }]),
      a33_catalog_tapas:JSON.stringify([{ id:'tap-1', name:'Corcho' }]),
      arcano33_lotes:JSON.stringify([{ id:'lot-1', codigo:'A33-001', productos:[{ id:'prod-lot-1', quantity:12 }] }]),
      arcano33_calc_ultimo_consecutivo:'18',
      a33_pos_pending_sale:JSON.stringify({ id:'sale-no-debe-aplicarse' })
    },
    indexedDB:{
      'a33-pos':{
        products:[{ id:'product-1', name:'Kombucha' }],
        rawMaterials:[{ id:'raw-1', name:'Té' }],
        customers:[{ id:'customer-1', name:'Mario' }],
        sales:[{ id:'sale-1', total:100 }]
      },
      finanzasdb:{ cobrar:[{ id:'cobro-1', amount:500 }] }
    }
  }
};

const plan = context.A33FirebaseApplyE5.buildPlan(backup, { workspaceId:'arcano33', uid:'admin-1', deviceId:'mac' });
assert(plan.length >= 9, 'E5 no construyó los registros base esperados.');
assert(plan.every((item) => ['configuracion','catalogos','lotes'].includes(item.moduleId)), 'E5 incluyó un módulo fuera de alcance.');
assert(!plan.some((item) => item.moduleId === 'pos' || item.moduleId === 'finanzas'), 'E5 tocó un módulo crítico.');
assert(plan.some((item) => item.path.endsWith('/modules/configuracion/entities/identidad/records/actual')), 'No se mapeó Identidad.');
assert(plan.some((item) => item.path.endsWith('/modules/catalogos/entities/productos/records/product-1')), 'No se mapearon Productos.');
assert(plan.some((item) => item.path.endsWith('/modules/lotes/entities/lotes/records/lot-1')), 'No se mapearon Lotes.');
assert(plan.some((item) => item.entityId === 'productos_lote'), 'No se separaron productos por lote.');
assert(plan.every((item) => context.A33FirestoreData.validateDocument(item).ok), 'E5 produjo un documento no válido.');

const repeated = context.A33FirebaseApplyE5.buildPlan(backup, { workspaceId:'arcano33', uid:'admin-1', deviceId:'mac' });
assert.deepStrictEqual(Array.from(repeated.map((item) => item.path)), Array.from(plan.map((item) => item.path)), 'E5 no conserva IDs estables al repetirse.');

assert(html.includes('id="cfg-apply-e5-run"'), 'Falta el botón de E5.');
assert(html.includes('a33-firebase-apply-e5.js?v=4.20.98&amp;r=1'), 'Falta cargar el motor E5.');
assert(html.includes('script.js?v=4.20.98&amp;r=41'), 'No se actualizó la revisión del script de Configuración.');
assert(configSource.includes('function applyStageE5()'), 'Configuración no integra la aplicación E5.');
assert(configSource.includes('storedResult.sourceChecksum === staged.checksum'), 'La interfaz podría confundir una E5 anterior con la carga E4 vigente.');
assert(rules.includes('validStage5Record'), 'Faltan validaciones Firestore de E5.');
assert(rules.includes('allow delete: if false;'), 'E5 no bloquea borrados remotos.');
assert(rules.includes('match /applications/e5'), 'E5 no deja constancia separada de aplicación.');

console.log('OK E5 Firebase safe base application smoke');
