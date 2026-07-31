'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'pos/index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pos/styles.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'pos/sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'pos/manifest.webmanifest'), 'utf8'));
const check = (condition, message) => assert.ok(condition, message);

function takeFunction(source, name){
  const start = source.indexOf(`function ${name}(`);
  check(start >= 0, `No se encontró ${name}`);
  const openParen = source.indexOf('(', start);
  let i = openParen, parenDepth = 0, quote = '', escaped = false;
  for (; i < source.length; i++){
    const ch = source[i];
    if (quote){
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`'){ quote = ch; continue; }
    if (ch === '(') parenDepth++;
    else if (ch === ')' && --parenDepth === 0){ i++; break; }
  }
  const bodyStart = source.indexOf('{', i);
  let depth = 0; quote = ''; escaped = false;
  for (i = bodyStart; i < source.length; i++){
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

// Contrato visual: cerrado por defecto, encabezado completo clicable y tabla con encabezado dinámico.
check(html.includes('id="lotes-evento-block" class="lotes-block is-collapsed"'), 'Lotes cargados no inicia cerrado');
check(html.includes('id="lotes-evento-toggle" class="lotes-block-toggle"'), 'Falta encabezado táctil');
check(html.includes('aria-expanded="false" aria-controls="lotes-evento-content"'), 'Falta semántica expanded/collapsed');
check(html.includes('id="lotes-evento-content" class="lotes-block-content" hidden'), 'Contenido no inicia oculto');
check(html.includes('<span class="lotes-block-title">Lotes cargados</span>'), 'Título visible incorrecto');
check(html.includes('id="lotes-count-word">registros</span>'), 'Falta contador con texto');
check(html.includes('id="tbl-lotes-evento-head"'), 'Falta cabecera dinámica');
check(!html.includes('<th>P</th>\n              <th>M</th>\n              <th>D</th>'), 'La tabla conserva columnas fijas');
check(html.includes('id="sobrante-panel"') && html.includes('id="reverso-panel"'), 'Sobrantes/Reverso fueron retirados');

// Responsive, temas y accesibilidad.
check(css.includes('.lotes-table-scroll{') && css.includes('overflow-x:auto;'), 'Falta scroll horizontal interno');
check(css.includes('overscroll-behavior-x:contain;'), 'El scroll interno puede propagarse a la app');
check(css.includes('#tbl-lotes-evento{width:max-content;min-width:100%'), 'Tabla dinámica no puede crecer internamente');
check(css.includes('body{overflow-x:hidden}'), 'Se perdió blindaje contra scroll general');
check(css.includes('touch-action:manipulation;'), 'Encabezado no está endurecido para toque');
check(css.includes('html[data-theme="light"] .lotes-block'), 'Falta contraste en modo claro');
check(css.includes('@media (max-width:560px)'), 'Falta adaptación móvil/iPad vertical');
check(css.includes('@media (prefers-reduced-motion:reduce)'), 'Falta respeto a movimiento reducido');

// Airbags de lógica y alcance.
for (const token of [
  'buildLotesEventoModelPOS', 'resolveInventoryProductIdentityPOS(identityRef, productIndex, { allowLegacyName:true })',
  'productRecipeEnabledForProductionPOS(identity.product)', 'lotesEntryStoredLetterPOS(entry)',
  'legacyProductLetterFromNamePOS(snapshotName)', 'catalogColumns.concat(historical, orphan)',
  "wordEl.textContent = n === 1 ? 'registro' : 'registros'", "toggle.dataset.bound === '1'",
  'lotesEventoToggleLockUntilPOS = now + 450', "previousTabPOS !== 'inventario'"
]) check(js.includes(token), `Falta contrato: ${token}`);
check(!js.includes('localStorage.clear('), 'Se agregó borrado global de localStorage');
check(!js.includes('indexedDB.deleteDatabase('), 'Se agregó borrado de IndexedDB');

// Ejecutar el modelo puro con productos dinámicos, legacy y datos irresolubles.
const functionNames = [
  'normName','hasOwnPOS','boolCatalogFlagPOS','productRecipeEnabledForProductionPOS',
  'catalogProductStableIdPOS','catalogProductInternalIdPOS','productIdentityNormPOS',
  'productIdentityNameKeyPOS','buildProductIdentityIndexPOS','collectProductIdentityCandidatesPOS',
  'catalogProductSnapshotNamePOS','resolveCatalogProductIdentityPOS','normalizeLotesLetterPOS',
  'legacyProductLetterFromNamePOS','inventoryStoredLetterPOS','inventorySnapshotNamePOS',
  'resolveInventoryProductIdentityPOS','lotesEntryStoredLetterPOS','lotesEntrySnapshotNamePOS','lotesLegacyLetterFromNamePOS',
  'lotesCatalogProductKeyPOS','lotesEntryReferenceKeyPOS','lotesHistoricalLetterSortPOS',
  'buildLotesEventoModelPOS'
];
const context = vm.createContext({
  console, Date, Math, Number, String, Object, Array, Set, Map, JSON,
  window:{},
  uiProductNamePOS:(name)=> /gal[oó]n/i.test(String(name || '')) ? 'Galón 3720 ml' : String(name || '')
});
vm.runInContext("const LEGACY_PRODUCT_LETTERS_POS=['P','M','D','L','G'];\n" + functionNames.map((name)=>takeFunction(js, name)).join('\n') + '\n;globalThis.__build=buildLotesEventoModelPOS;', context);
const build = context.__build;

const products = [
  { id:1, productId:'prod-p', name:'Pulso 250 ml', receta:true, letra:'P' },
  { id:2, productId:'prod-c', name:'Catrina 500 ml', receta:true, letra:'C' },
  { id:3, productId:'prod-x', name:'Vaso', receta:false, letra:'X' },
  { id:4, productId:'prod-m', name:'Media 375 ml', receta:true, letra:'M' },
  { id:5, productId:'prod-g', name:'Galón 3750 ml', receta:true, letra:'G' }
];
const entries = [
  { type:'restock', source:'lote', loteCodigo:'A-1', loteCargaId:'g1', time:'2026-07-30T12:00:00.000Z', productId:1, qty:2 },
  { type:'restock', source:'lote', loteCodigo:'A-1', loteCargaId:'g1', time:'2026-07-30T12:00:00.000Z', productId:2, qty:4 },
  { type:'restock', source:'lote', loteCodigo:'A-1', loteCargaId:'g1', time:'2026-07-30T12:00:00.000Z', productId:3, qty:9 },
  { type:'restock', source:'lote', loteCodigo:'A-1', loteCargaId:'g1', time:'2026-07-30T12:00:00.000Z', qty:9 },
  { type:'restock', source:'lote', loteCodigo:'A-1', loteCargaId:'g1', time:'2026-07-30T12:00:00.000Z', loteLetra:'D', qty:3 },
  { type:'adjust', source:'lote_reverso', loteGroupKey:'g1', time:'2026-07-30T13:00:00.000Z', qty:-1 },
  { type:'restock', source:'lote', loteCodigo:'B-2', loteCargaId:'g2', time:'2026-07-29T12:00:00.000Z', loteNombreSnapshot:'Litro 1000 ml', qty:5 },
  { type:'restock', source:'lote', loteCodigo:'B-2', loteCargaId:'g2', time:'2026-07-29T12:00:00.000Z', loteProductId:'prod-c', qty:1 }
];
const beforeProducts = JSON.stringify(products);
const beforeEntries = JSON.stringify(entries);
const model = build(entries, products);
const labels = Array.from(model.columns, c=>c.label);
check(JSON.stringify(labels.slice(0,4)) === JSON.stringify(['P','C','M','G']), 'No respetó el orden del Catálogo');
check(labels.includes('D') && labels.includes('L'), 'No agregó Letras históricas');
check(!labels.includes('X'), 'Producto sin Receta creó columna');
check(labels.filter(x=>x==='P').length === 1, 'Duplicó Letras');
check(labels.some(x=>/^\?\d+$/.test(x)), 'No preservó cantidad irresoluble');
check(model.columns.find(c=>c.label==='G').title.includes('Galón 3720 ml'), 'Galón no se canonizó a 3720 ml');
check(model.rows.length === 2, 'El contador/modelo no agrupa una fila por carga');
const row1 = model.rows.find(r=>r.groupKey==='g1');
const row2 = model.rows.find(r=>r.groupKey==='g2');
check(row1 && row1.reversedAt, 'No marcó reverso histórico');
check(row1.quantities['LET:P'] === 2 && row1.quantities['LET:C'] === 4 && row1.quantities['LET:D'] === 3, 'Cantidades dinámicas incorrectas');
check(row2.quantities['LET:C'] === 1 && row2.quantities['LET:L'] === 5, 'Fallback productId/legacy incorrecto');
check(JSON.stringify(products) === beforeProducts && JSON.stringify(entries) === beforeEntries, 'El render/modelo reescribió históricos');
check(JSON.stringify(build(entries, products).columns.map(c=>c.label)) === JSON.stringify(labels), 'Orden inestable entre renders');

// Letra duplicada corrupta: no fusionar dos productos distintos.
const duplicateModel = build([
  { type:'restock', source:'lote', loteCodigo:'DUP', loteCargaId:'dup', time:'2026-07-30T10:00:00Z', productId:11, qty:2 },
  { type:'restock', source:'lote', loteCodigo:'DUP', loteCargaId:'dup', time:'2026-07-30T10:00:00Z', productId:12, qty:7 }
], [
  { id:11, productId:'one', name:'Uno', receta:true, letra:'Q' },
  { id:12, productId:'two', name:'Dos', receta:true, letra:'Q' }
]);
check(duplicateModel.columns.filter(c=>c.label==='Q').length === 1, 'Letra corrupta duplicó columna');
check(duplicateModel.columns.some(c=>/^\?\d+$/.test(c.label)), 'Productos distintos con misma Letra fueron fusionados');

// Ciclo del acordeón: bind único y doble toque sin doble cambio.
const listeners = [];
class FakeClassList {
  constructor(){ this.values = new Set(); }
  toggle(name, force){ if (force) this.values.add(name); else this.values.delete(name); }
}
const block = { classList:new FakeClassList() };
const content = { hidden:true };
const toggle = {
  dataset:{}, attrs:{ 'aria-expanded':'false' },
  addEventListener(type, fn){ if (type === 'click') listeners.push(fn); },
  getAttribute(name){ return this.attrs[name]; },
  setAttribute(name, value){ this.attrs[name] = value; }
};
let now = 100;
const toggleContext = vm.createContext({
  console,
  performance:{ now:()=>now },
  window:{ addEventListener:()=>{} },
  document:{ documentElement:{ dataset:{} } },
  ensureLotesEventoShellPOS:()=>block,
  $:(selector)=> ({ '#lotes-evento-block':block, '#lotes-evento-toggle':toggle, '#lotes-evento-content':content }[selector] || null)
});
vm.runInContext('let lotesEventoPendingModelPOS=null; let lotesEventoToggleLockUntilPOS=0;\n' + [
  'setLotesEventoExpandedPOS','resetLotesEventoCollapsePOS','bindLotesEventoToggleOncePOS'
].map((name)=>takeFunction(js, name)).join('\n') + '\n;globalThis.__bind=bindLotesEventoToggleOncePOS;', toggleContext);
toggleContext.__bind();
toggleContext.__bind();
check(listeners.length === 1, 'Se duplicaron listeners');
listeners[0]({ preventDefault(){} });
check(toggle.attrs['aria-expanded'] === 'true' && content.hidden === false, 'Primer toque no abrió');
now = 150;
listeners[0]({ preventDefault(){} });
check(toggle.attrs['aria-expanded'] === 'true', 'Doble toque cambió dos veces');
now = 700;
listeners[0]({ preventDefault(){} });
check(toggle.attrs['aria-expanded'] === 'false' && content.hidden === true, 'Toque posterior no cerró');

// PWA local del POS.
check(html.includes('styles.css?v=4.20.97&r=22'), 'POS no carga CSS nuevo');
check(html.includes('app.js?v=4.20.97&r=43'), 'POS no carga JS nuevo');
check(html.includes('manifest.webmanifest?v=4.20.97&r=25'), 'POS no carga manifest nuevo');
check(sw.includes("const MODULE_CACHE_REV = '47';"), 'No se incrementó caché POS');
check(sw.includes("'./index.html?v=4.20.97&r=31'"), 'SW no precachea HTML nuevo');
check(sw.includes("'./styles.css?v=4.20.97&r=22'"), 'SW no precachea CSS nuevo');
check(sw.includes("'./app.js?v=4.20.97&r=43'"), 'SW no precachea JS nuevo');
check(manifest.start_url === './index.html?v=4.20.97&r=31', 'Manifest no abre HTML nuevo');

console.log('SMOKE OK — Suite A33 POS Inventario Lotes Dinámicos Etapa 1/2');
