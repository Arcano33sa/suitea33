'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const posHtml = fs.readFileSync(path.join(root, 'pos/index.html'), 'utf8');
const posJs = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');
const posCss = fs.readFileSync(path.join(root, 'pos/styles.css'), 'utf8');
const posSw = fs.readFileSync(path.join(root, 'pos/sw.js'), 'utf8');
const posManifest = JSON.parse(fs.readFileSync(path.join(root, 'pos/manifest.webmanifest'), 'utf8'));
const catHtml = fs.readFileSync(path.join(root, 'catalogos/index.html'), 'utf8');
const catJs = fs.readFileSync(path.join(root, 'catalogos/script.js'), 'utf8');
const catCss = fs.readFileSync(path.join(root, 'catalogos/style.css'), 'utf8');
const catSw = fs.readFileSync(path.join(root, 'catalogos/sw.js'), 'utf8');
const catManifest = JSON.parse(fs.readFileSync(path.join(root, 'catalogos/manifest.webmanifest'), 'utf8'));
const release = fs.readFileSync(path.join(root, 'assets/js/a33-release.js'), 'utf8');

const check = (condition, message) => assert.ok(condition, message);

// Contrato visual y alcance cerrado.
check(posHtml.includes('id="btn-new-customer"') && posHtml.includes('>Nuevo</button>'), 'Falta Nuevo');
check(posHtml.includes('id="customer-quick-modal"') && posHtml.includes('aria-hidden="true" inert'), 'Modal no inicia realmente inerte');
check(posHtml.includes('id="customer-quick-name"') && posHtml.includes('required'), 'Nombre no es obligatorio');
check(posHtml.includes('id="customer-quick-cell"') && posHtml.includes('type="tel"'), 'Celular opcional no usa entrada estable');
check(posHtml.includes('customer-quick-create') && posHtml.includes('customer-quick-cancel'), 'Faltan Crear/Cancelar');
for (const forbidden of ['customer-quick-email','customer-quick-address','customer-quick-ruc','customer-quick-state']){
  check(!posHtml.includes(forbidden), `Se agregó campo fuera de alcance: ${forbidden}`);
}

// Hardening de ciclo de vida, doble toque y concurrencia.
check(posJs.includes('let customerQuickLifecyclePOS = 0;'), 'Falta token de ciclo de vida');
check(posJs.includes('let customerQuickSubmitSeqPOS = 0;'), 'Falta secuencia anti ejecución tardía');
check(posJs.includes('let customerQuickSubmitLockedPOS = false;'), 'Falta lock de envío');
check(posJs.includes('window.__A33_POS_CUSTOMER_QUICK_SUBMITTING__'), 'Falta lock global de la página');
check(posJs.includes('if (customerQuickBusyPOS) return false;'), 'Falta guardia anti doble Crear');
check(posJs.includes('if (!modal || isCustomerQuickOpenPOS()) return false;'), 'Falta guardia anti doble Nuevo');
check(posJs.includes("modal.setAttribute('inert', '')"), 'Cierre no deja overlay inerte');
check(posJs.includes("modal.removeAttribute('inert')"), 'Apertura no reactiva el modal');
check(posJs.includes("document.body.classList.add('customer-quick-modal-open')"), 'Falta bloqueo de fondo');
check(posJs.includes("document.body.classList.remove('customer-quick-modal-open')"), 'Falta liberación del fondo');
check(posJs.includes("closeCustomerQuickPOS({ returnFocus:true, force:true })"), 'Éxito no cierra de forma atómica');
check(posJs.includes("window.addEventListener('pagehide'"), 'Falta limpieza al salir/navegar');
check(posJs.includes("window.addEventListener('pageshow'"), 'Falta recuperación segura de bfcache');
check(posJs.includes("event.key === 'Enter' && event.repeat"), 'Enter repetido no está bloqueado');
check(posJs.includes("modal.dataset.bound === '1'"), 'Modal puede duplicar listeners');
check(posJs.includes("newBtn.dataset.bound !== '1'"), 'Nuevo puede duplicar listeners');
check(posJs.includes('lifecycleAtStart !== customerQuickLifecyclePOS'), 'Falta rechazo de resultado obsoleto');

// Responsive, tactilidad y accesibilidad.
check(posCss.includes('body.customer-quick-modal-open{overflow:hidden'), 'Falta bloqueo visual del fondo');
check(posCss.includes('max-height:calc(100dvh - 24px)'), 'Falta viewport dinámico iPad/iPhone');
check(posCss.includes('.customer-quick-fields input{width:100%;max-width:100%;min-width:0;font-size:16px}'), 'Campos pueden desbordar o provocar zoom iOS');
check(posCss.includes('touch-action:manipulation'), 'Botones no están endurecidos para toque');
check(posCss.includes('@media (max-width:560px)'), 'Falta adaptación móvil/vertical');
check(posCss.includes('@media (max-height:520px) and (orientation:landscape)'), 'Falta adaptación horizontal baja');
check(posCss.includes('@media (prefers-reduced-motion:reduce)'), 'Falta respeto a movimiento reducido');
check(posCss.includes('background:#1db954;') && posCss.includes('background:#b3261e;'), 'Crear/Cancelar perdieron verde/rojo');
check(posCss.includes('html[data-theme="light"] .customer-quick-create'), 'Falta contraste claro');
check(catCss.includes('.cat-customer-table-scroll{') && catCss.includes('overflow-x:auto;'), 'Catálogo no contiene scroll internamente');
check(catCss.includes('scrollbar-gutter:stable both-edges'), 'Catálogo no estabiliza ancho del listado');
check(catCss.includes('.cat-customer-group-summary{\n  touch-action:manipulation;'), 'Grupos por letra no son táctiles');
check(catCss.includes('.cat-icon-btn{') && catCss.includes('-webkit-tap-highlight-color:transparent;'), 'Acciones del catálogo no están endurecidas');

// La venta actual queda fuera del bloque rápido.
const quickStart = posJs.indexOf('let customerQuickBusyPOS = false;');
const quickEnd = posJs.indexOf('function isCustomerPickerOpenPOS()', quickStart);
check(quickStart >= 0 && quickEnd > quickStart, 'No se aisló Cliente rápido');
const quickBlock = posJs.slice(quickStart, quickEnd);
for (const forbiddenId of [
  'sale-product','sale-qty','sale-extras','sale-discount','sale-courtesy','sale-payment',
  'sale-bank','sale-notes','sale-event','sale-date','sale-total','localStorage.clear(',
  'indexedDB.deleteDatabase(','firebase','JSON.parse(A33Storage.getItem'
]){
  check(!quickBlock.includes(forbiddenId), `Cliente rápido altera alcance protegido: ${forbiddenId}`);
}

// Duplicados y persistencia: mismo nombre, mayúsculas y espacios no guardan de nuevo.
function takeFunction(source, name){
  const start = source.indexOf(`function ${name}(`);
  check(start >= 0, `No se encontró ${name}`);
  let i = source.indexOf('{', start), depth = 0, quote = '', escaped = false;
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
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Función incompleta: ${name}`);
}

const fns = [
  'normalizeCustomerKeyPOS','sanitizeCustomerDisplayPOS','sortCustomerObjectsAZ_POS',
  'generateCustomerIdPOS','resolveFinalCustomerIdPOS','collectCustomerAllNamesPOS',
  'buildCustomerResolverPOS','createQuickCustomerPOS'
];
let stored = [];
let writes = 0;
const context = vm.createContext({
  console, Date, Math, Number, String, Object, Array, Set, Map, JSON,
  loadCustomerCatalogPOS:()=>stored.map(c=>({...c})),
  saveCustomerCatalogPOS:(rows)=>{ stored=rows.map(c=>({...c})); writes++; return true; },
  syncDisabledLegacyFromCatalogPOS:()=>{}
});
vm.runInContext(fns.map(n=>takeFunction(posJs,n)).join('\n') + '\n;globalThis.__create=createQuickCustomerPOS;', context);
const create = context.__create;
check(create('  María   López  ', '').ok, 'No creó cliente sin Celular');
check(stored[0].name === 'María López' && stored[0].celular === '', 'No limpió Nombre o Celular vacío');
check(create('Carlos Pérez', '+505 8888 1111').ok, 'No creó cliente con prefijo');
check(stored.find(c=>c.name==='Carlos Pérez')?.celular === '+505 8888 1111', 'No conservó prefijo y espacios');
const before = writes;
const dup = create('  cArLoS    pérez ', '9999');
check(!dup.ok && dup.reason === 'exists', 'No detectó duplicado normalizado');
check(writes === before && stored.filter(c=>c.name==='Carlos Pérez').length === 1, 'Duplicado ejecutó guardado');

// Catálogo conserva agrupación alfabética y edición sin cambio de ID.
check(catJs.includes('customerGroupLetterCAT(customer && customer.name)'), 'Catálogo dejó de agrupar por Nombre');
check(catJs.includes("localeCompare(normalizeCustomerKeyCAT(b && b.name), 'es-NI'"), 'Orden alfabético cambió');
check(catJs.includes('customerExpandedGroupsCAT.add(customerGroupLetterCAT(data.name))'), 'Cambio de Nombre no mueve de letra');
check(catJs.includes("row = list.find(c => c && String(c.id) === String(currentCustomerEditId))"), 'Edición no conserva ID');
check(catJs.includes("<td>${escapeHtml(getCustomerCellularCAT(c) || '')}</td>"), 'Celular vacío rompe render');

// PWA/versionado coordinado.
check(release.includes("const suiteVersion = '4.20.97';") && release.includes('const rev = 3;'), 'Versión general no quedó en 4.20.97 r3');
check(posHtml.includes('styles.css?v=4.20.97&r=20'), 'POS no carga CSS final');
check(posHtml.includes('app.js?v=4.20.97&r=40'), 'POS no carga JS final');
check(posHtml.includes('manifest.webmanifest?v=4.20.97&r=22'), 'POS no carga manifest final');
check(posSw.includes("const MODULE_CACHE_REV = '44';"), 'POS no incrementó caché');
check(posSw.includes("'./index.html?v=4.20.97&r=28'"), 'POS no precachea HTML final');
check(posSw.includes("'./styles.css?v=4.20.97&r=20'"), 'POS no precachea CSS final');
check(posSw.includes("'./app.js?v=4.20.97&r=40'"), 'POS no precachea JS final');
check(posSw.includes("'./manifest.webmanifest?v=4.20.97&r=22'"), 'POS no precachea manifest final');
check(posManifest.start_url === './index.html?v=4.20.97&r=28', 'POS manifest no abre HTML final');
check(catHtml.includes('style.css?v=4.20.97&r=23'), 'Catálogos no carga CSS final');
check(catHtml.includes('script.js?v=4.20.97&r=35'), 'Catálogos no carga JS final');
check(catHtml.includes('manifest.webmanifest?v=4.20.97&r=12'), 'Catálogos no carga manifest final');
check(catJs.includes("serviceWorker.register('./sw.js?v=4.20.97&r=7')"), 'Catálogos no registra SW final');
check(catSw.includes("const MODULE_CACHE_REV = '39';"), 'Catálogos no incrementó caché');
check(catSw.includes("'./manifest.webmanifest?v=4.20.97&r=12'"), 'Catálogos no precachea manifest final');
check(catManifest.start_url === './index.html?v=4.20.97&r=32', 'Catálogos manifest no abre HTML final');
check(posSw.includes('a33-release.js?v=4.20.97&r=55') && catSw.includes('a33-release.js?v=4.20.97&r=55'), 'SW no usa release final');
check(!posJs.includes('localStorage.clear(') && !catJs.includes('localStorage.clear('), 'Se agregó borrado global de localStorage');
check(!posJs.includes('indexedDB.deleteDatabase(') && !catJs.includes('indexedDB.deleteDatabase('), 'Se agregó borrado de IndexedDB');

console.log('SMOKE OK — Suite A33 POS Cliente Rápido Etapa 3/3 Hardening Final');
