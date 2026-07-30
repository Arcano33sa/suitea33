'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const posJs = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');
const posHtml = fs.readFileSync(path.join(root, 'pos/index.html'), 'utf8');
const posSw = fs.readFileSync(path.join(root, 'pos/sw.js'), 'utf8');
const catJs = fs.readFileSync(path.join(root, 'catalogos/script.js'), 'utf8');
const catHtml = fs.readFileSync(path.join(root, 'catalogos/index.html'), 'utf8');
const catSw = fs.readFileSync(path.join(root, 'catalogos/sw.js'), 'utf8');
const catCss = fs.readFileSync(path.join(root, 'catalogos/style.css'), 'utf8');
const check = (condition, message) => assert.ok(condition, message);

function takeFunction(source, name){
  const start = source.indexOf(`function ${name}(`);
  check(start >= 0, `No se encontró ${name}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (; i < source.length; i++){
    const ch = source[i];
    if (quote){
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`'){ quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}'){
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Función incompleta: ${name}`);
}

// Una sola fuente oficial compartida.
check(posJs.includes("const CUSTOMER_CATALOG_KEY = 'a33_pos_customersCatalog';"), 'POS no usa la clave oficial');
check(catJs.includes("const CUSTOMER_CATALOG_KEY = 'a33_pos_customersCatalog';"), 'Catálogos no usa la clave oficial');
check(posJs.includes('A33Storage.sharedSet(CUSTOMER_CATALOG_KEY'), 'POS no persiste mediante contrato compartido');
check(catJs.includes('A33Storage.sharedSet(CUSTOMER_CATALOG_KEY'), 'Catálogos no persiste mediante contrato compartido');
check(!posJs.includes('a33_pos_quickCustomers'), 'Existe catálogo paralelo de clientes rápidos');
check(!catJs.includes('a33_catalogos_customersCatalog'), 'Existe copia paralela en Catálogos');

// Integración del flujo rápido.
check(posJs.includes('function createQuickCustomerPOS(name, cellular)'), 'Falta creación rápida');
check(posJs.includes("updatedFrom:'pos_cliente_rapido'"), 'Cliente rápido no deja trazabilidad de origen');
check(posJs.includes('setCustomerSelectionUI_POS(result.customer)'), 'Cliente creado no queda seleccionado');
check(posJs.includes('persistCustomerLastPOS(result.customer.name || name)'), 'Cliente creado no queda disponible en POS');
check(posJs.includes('const persisted = loadCustomerCatalogPOS().find'), 'No confirma persistencia real');

// Catálogo alfabético, edición conservadora y celular opcional.
check(catJs.includes('customerGroupLetterCAT(customer && customer.name)'), 'Agrupación no usa Nombre');
check(catJs.includes("normalizeCustomerKeyCAT(a && a.name).localeCompare"), 'Orden interno no es alfabético');
check(catJs.includes("customerExpandedGroupsCAT.add(customerGroupLetterCAT(data.name))"), 'Edición/alta no actualiza la letra visual');
check(catJs.includes("row = list.find(c => c && String(c.id) === String(currentCustomerEditId))"), 'Edición no reutiliza el mismo ID');
const saveMaster = takeFunction(catJs, 'saveCustomerMaster');
check(!/row\.id\s*=/.test(saveMaster), 'Edición cambia el identificador del cliente');
check(saveMaster.includes('row.nameHistory.push'), 'Cambio de nombre no conserva trazabilidad');
check(catJs.includes("<td>${escapeHtml(getCustomerCellularCAT(c) || '')}</td>"), 'Celular vacío muestra texto o guion extraño');

// Actualización al abrir, volver a la pestaña o recibir cambios de otra pestaña.
check(catJs.includes("if (key === 'clientes') scheduleCustomerLiveRefreshCAT"), 'Abrir Clientes no refresca la fuente compartida');
check(catJs.includes('if (key === CUSTOMER_CATALOG_KEY || key === CUSTOMER_DISABLED_KEY)'), 'Catálogo no escucha cambios externos de clientes');
check(catJs.includes("window.addEventListener('pageshow'"), 'Catálogo no refresca al volver por navegación');
check(catJs.includes("window.addEventListener('focus'"), 'Catálogo no refresca al recuperar foco');
check(catJs.includes('clearTimeout(customerLiveRefreshTimerCAT)'), 'Falta debounce anti render doble');
check(catJs.includes('const renderToken = ++customerRenderTokenCAT'), 'Falta protección contra renders cruzados');
check(posJs.includes('window.__A33_POS_CUSTOMERS_LIVE_BOUND__'), 'POS no blinda listeners duplicados');
check(posJs.includes("ev.key === CUSTOMER_CATALOG_KEY"), 'POS no escucha cambios del Catálogo');

// Responsive y temas existentes no se rompen.
check(catCss.includes('html,body{margin:0;padding:0;overflow-x:hidden;}'), 'Falta blindaje contra scroll horizontal general');
check(catCss.includes('.cat-customer-table-scroll{') && catCss.includes('overflow-x:auto;'), 'Falta scroll interno del catálogo');
check(catCss.includes('@media(max-width:680px)'), 'Falta adaptación móvil/iPad vertical');
check(catCss.includes('html[data-theme="light"] .cat-customer-table th'), 'Falta contraste del catálogo en modo claro');
check(catCss.includes('.cat-customer-name-cell > span:first-child'), 'Nombres largos no tienen contención visual');

// Pruebas funcionales de clasificación y duplicados.
const catFns = ['sanitizeCustomerName','normalizeCustomerKeyCAT','findCustomerDuplicateCAT','customerGroupLetterCAT','sortCustomerGroupLettersCAT'];
const catContext = vm.createContext({ console, String, Array, Set, Map, Number, Date, Math });
vm.runInContext(catFns.map(n => takeFunction(catJs, n)).join('\n') + '\n;globalThis.__cat={sanitizeCustomerName,normalizeCustomerKeyCAT,findCustomerDuplicateCAT,customerGroupLetterCAT,sortCustomerGroupLettersCAT};', catContext);
const cat = catContext.__cat;
check(cat.customerGroupLetterCAT(' Carlos López') === 'C', 'Carlos no se agrupa en C');
check(cat.customerGroupLetterCAT('María José') === 'M', 'María no se agrupa en M');
check(cat.customerGroupLetterCAT('Álvaro Ruiz') === 'A', 'Álvaro no se agrupa en A');
check(cat.customerGroupLetterCAT('33 Eventos') === '3', 'Nombre numérico no usa lógica actual');
check(cat.customerGroupLetterCAT('  @Proveedor') === '#', 'Símbolo no cae en grupo #');
check(cat.normalizeCustomerKeyCAT('  CARLOS   Pérez ') === 'carlos perez', 'Normalización compartida incorrecta');
const duplicateList = [{id:'c1',name:'Carlos Pérez',aliases:[],nameHistory:[]}];
check(cat.findCustomerDuplicateCAT(duplicateList, cat.normalizeCustomerKeyCAT(' carlos   pérez '), '')?.id === 'c1', 'Catálogo no detecta duplicado trivial');
check(cat.findCustomerDuplicateCAT(duplicateList, cat.normalizeCustomerKeyCAT('Carlos Pérez'), 'c1') === null, 'Edición del mismo cliente se bloquea como duplicado');

const posFns = [
  'normalizeCustomerKeyPOS','sanitizeCustomerDisplayPOS','sortCustomerObjectsAZ_POS',
  'generateCustomerIdPOS','resolveFinalCustomerIdPOS','collectCustomerAllNamesPOS',
  'buildCustomerResolverPOS','createQuickCustomerPOS'
];
let stored = [];
let writes = 0;
const posContext = vm.createContext({
  console, String, Array, Set, Map, Number, Date, Math, Object, JSON,
  loadCustomerCatalogPOS:()=>stored.map(c=>({...c})),
  saveCustomerCatalogPOS:(list)=>{ stored=list.map(c=>({...c})); writes++; return true; },
  syncDisabledLegacyFromCatalogPOS:()=>{}
});
vm.runInContext(posFns.map(n => takeFunction(posJs, n)).join('\n') + '\n;globalThis.__create=createQuickCustomerPOS;', posContext);
const create = posContext.__create;
for (const [name, cell] of [
  ['Ana',''],['Carlos','8888 1111'],['María',''],['Carmen',''],['Álvaro Ruiz',''],['  Cecilia  ','']
]){
  const r = create(name, cell);
  check(r.ok, `No creó ${name}`);
}
check(stored.find(c=>c.name==='Carlos')?.celular === '8888 1111', 'No conserva Celular');
check(stored.find(c=>c.name==='María')?.celular === '', 'Celular opcional no queda vacío');
const cNames = stored.filter(c=>/^c/i.test(c.name)).map(c=>c.name);
check(JSON.stringify(cNames) === JSON.stringify(['Carlos','Carmen','Cecilia']), 'Orden alfabético de la letra C incorrecto');
const duplicate = create('  cArLoS  ', '9999');
check(!duplicate.ok && duplicate.reason === 'exists', 'POS no reutiliza duplicado normalizado');
check(stored.filter(c=>c.name==='Carlos').length === 1, 'POS creó cliente duplicado');
check(writes === 6, 'Duplicado ejecutó guardado adicional');

// PWA/cache de ambos módulos.
check(posHtml.includes('app.js?v=4.20.97&r=40'), 'POS HTML no apunta al JS nuevo');
check(posSw.includes("const MODULE_CACHE_REV = '44';"), 'POS SW no incrementó cache');
check(posSw.includes("'./app.js?v=4.20.97&r=40'"), 'POS SW no precachea JS nuevo');
check(catHtml.includes('script.js?v=4.20.97&r=35'), 'Catálogos HTML no apunta al JS nuevo');
check(catSw.includes("const MODULE_CACHE_REV = '39';"), 'Catálogos SW no incrementó cache');
check(catSw.includes("'./script.js?v=4.20.97&r=35'"), 'Catálogos SW no precachea JS nuevo');
check(catJs.includes("serviceWorker.register('./sw.js?v=4.20.97&r=7')"), 'Catálogos no registra el SW actualizado');

// Alcance blindado.
for (const forbidden of ['localStorage.clear(', 'indexedDB.deleteDatabase(', 'firebase.firestore', 'deleteApp(']){
  const quick = posJs.slice(posJs.indexOf('function createQuickCustomerPOS'), posJs.indexOf('function handleCustomerQuickSubmitPOS'));
  check(!quick.includes(forbidden), `Cliente rápido contiene operación prohibida: ${forbidden}`);
}

console.log('SMOKE OK — Suite A33 POS Cliente Rápido Etapa 2/3');
