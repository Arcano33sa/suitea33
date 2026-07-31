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
const release = fs.readFileSync(path.join(root, 'assets/js/a33-release.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'pos/manifest.webmanifest'), 'utf8'));
const check = (condition, message) => assert.ok(condition, message);

function takeFunction(source, name){
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
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

// Contrato visual dinámico: no quedan inputs fijos P/M/D/L/G.
check(html.includes('id="sobrante-grid" class="sobrante-grid dynamic-product-grid"'), 'Sobrantes no usa rejilla dinámica');
check(html.includes('id="reverso-grid" class="reverso-grid dynamic-product-grid"'), 'Reverso no usa rejilla dinámica');
for (const id of ['sobrante-p','sobrante-m','sobrante-d','sobrante-l','sobrante-g','reverso-p','reverso-m','reverso-d','reverso-l','reverso-g']){
  check(!html.includes(`id="${id}"`), `Permanece control fijo ${id}`);
}
check(css.includes('.dynamic-product-grid{'), 'Falta layout dinámico compartido');
check(css.includes('white-space:normal; overflow-wrap:anywhere'), 'Nombre largo no queda visible/completo');
check(css.includes('html[data-theme="light"] .sobrante-panel') && css.includes('html[data-theme="light"] .reverso-panel'), 'Paneles dinámicos no respetan modo claro');
check(css.includes('grid-template-columns:repeat(auto-fit, minmax(128px, 1fr))'), 'La rejilla dinámica no responde al ancho');
check(css.includes('@media (max-width:560px)') && css.includes('@media (max-width:380px)'), 'Faltan cortes responsive de Sobrantes/Reverso');
check(css.includes('overflow-x:auto') && css.includes('body{overflow-x:hidden}'), 'Se perdió el blindaje de scroll interno/general');

// Un solo puente legacy y un solo resolutor de Inventario.
check((js.match(/Object\.freeze\(\['P','M','D','L','G'\]\)/g) || []).length === 1, 'P/M/D/L/G se duplicó como lista fija');
check(js.includes('function resolveInventoryProductIdentityPOS('), 'Falta resolutor único de Inventario');
check(js.includes('const identity = resolveInventoryProductIdentityPOS(row, products, { allowLegacyName:true });'), 'El resolutor antiguo no delega al central');
check(!js.includes("const map = [\n      { field: 'pulso'"), 'Carga de lote conserva mapa fijo duplicado');
check(js.includes("G:CANON_GALON_LABEL"), 'Galón legacy no apunta a 3720 ml');
check(js.includes("matchedBy:'name_legacy_catalog'"), 'Falta compatibilidad controlada por nombre legacy');
check(js.includes('productId manda; Letra/nombre solo respaldan históricos'), 'No está documentada la prioridad de identidad');

// Airbags de doble ejecución y no mutación durante render/modelado.
for (const token of [
  'sobranteCreateBusyPOS', 'reversoActionBusyPOS', "showToast('Guardado en curso…'",
  "showToast('Reverso en curso…'", "toggle.dataset.bound === '1'",
  'lotesEventoToggleLockUntilPOS = now + 450', 'bindInventoryActionOnce',
  'if (el.dataset[key] === \'1\') return;', 'const rowIdentity = resolveInventoryProductIdentityPOS(row, index'
]) check(js.includes(token), `Falta airbag: ${token}`);
check(!js.includes('localStorage.clear('), 'Se agregó borrado global de localStorage');
check(!js.includes('indexedDB.deleteDatabase('), 'Se agregó borrado de IndexedDB');

const functionNames = [
  'normName','hasOwnPOS','boolCatalogFlagPOS','productRecipeEnabledForProductionPOS',
  'catalogProductStableIdPOS','catalogProductInternalIdPOS','productIdentityNormPOS',
  'productIdentityNameKeyPOS','buildProductIdentityIndexPOS','collectProductIdentityCandidatesPOS',
  'catalogProductSnapshotNamePOS','resolveCatalogProductIdentityPOS','legacyProductLetterFromNamePOS',
  'legacyQuantityShapePOS','normalizeLotesLetterPOS','inventoryStoredLetterPOS','inventorySnapshotNamePOS',
  'resolveInventoryProductIdentityPOS','inventoryIdentityKeyPOS','inventoryIdentityIdCandidatesPOS',
  'lotesPOSContractRowsPOS','lotesPOSQtyFromContractRowPOS','sobranteUsageSnapshotPOS','sobranteQtyPOS',
  'sobranteSnapshotQtyPOS','lotLegacyRowsPOS','sobranteSourceRowsPOS','buildSobranteInputModelPOS',
  'buildSobranteTransferItemsPOS','legacyQuantitiesFromTransferPOS','subtractSobranteFromParentSnapshotPOS',
  'lotesEntryStoredLetterPOS','lotesEntrySnapshotNamePOS','lotesCatalogProductKeyPOS',
  'lotesEntryReferenceKeyPOS','lotesHistoricalLetterSortPOS','lotesReadTimestampPOS','buildLotesEventoModelPOS',
  'summarizeRestockGroupPOS'
];
const prelude = `
const CANON_GALON_LABEL='Galón 3720 ml';
const LEGACY_PRODUCT_LETTERS_POS=Object.freeze(['P','M','D','L','G']);
const LEGACY_PRODUCT_FIELD_BY_LETTER_POS=Object.freeze({P:'pulso',M:'media',D:'djeba',L:'litro',G:'galon'});
const LEGACY_PRODUCT_NAME_BY_LETTER_POS=Object.freeze({P:'Pulso 250ml',M:'Media 375ml',D:'Djeba 750ml',L:'Litro 1000ml',G:CANON_GALON_LABEL});
`;
const context = vm.createContext({
  console, Date, Math, Number, String, Object, Array, Set, Map, JSON,
  window:{},
  uiProductNamePOS:(name)=> /gal[oó]n/i.test(String(name || '')) ? 'Galón 3720 ml' : String(name || '')
});
vm.runInContext(prelude + functionNames.map((name)=>takeFunction(js, name)).join('\n') + `
globalThis.__api={
  buildProductIdentityIndexPOS,resolveInventoryProductIdentityPOS,buildSobranteInputModelPOS,
  buildSobranteTransferItemsPOS,legacyQuantitiesFromTransferPOS,subtractSobranteFromParentSnapshotPOS,
  buildLotesEventoModelPOS,summarizeRestockGroupPOS
};`, context);
const api = context.__api;

const products = [
  { id:1, productId:'prod-p', name:'Pulso 250 ml', receta:false }, // legacy antiguo sin Letra/Receta explícita
  { id:2, productId:'prod-m', name:'Media 375 ml', receta:true, letra:'M' },
  { id:3, productId:'prod-d', name:'Djeba 750 ml', receta:true, letra:'D' },
  { id:4, productId:'prod-l', name:'Litro 1000 ml', receta:true, letra:'L' },
  { id:5, productId:'prod-g', name:'Galón 3720 ml', receta:true, letra:'G' },
  { id:6, productId:'prod-c', name:'Catrina Especial', receta:true, letra:'C' },
  { id:7, productId:'prod-z', name:'Edición Áurea de Nombre Muy Largo', receta:true, letra:'Z' },
  { id:8, productId:'prod-x', name:'Vaso sin receta', receta:false, letra:'X' },
  { id:9, productId:'prod-h', name:'Histórico Desactivado', receta:true, letra:'H', active:false }
];
const index = api.buildProductIdentityIndexPOS(products);

// Prioridad: productId > Letra guardada > nombre legacy.
let identity = api.resolveInventoryProductIdentityPOS({ productId:'prod-c', Letra:'Z', nombreSnapshot:'Litro 1000 ml' }, index, { allowLegacyName:true });
check(identity.ok && identity.stableId === 'prod-c' && identity.letter === 'C', 'productId no tuvo prioridad');
identity = api.resolveInventoryProductIdentityPOS({ Letra:'Z' }, index, { allowLegacyName:true });
check(identity.ok && identity.stableId === 'prod-z' && identity.letter === 'Z', 'Letra real no resolvió');
identity = api.resolveInventoryProductIdentityPOS({ nombreSnapshot:'Galón 3800 ml' }, index, { allowLegacyName:true });
check(identity.ok && identity.stableId === 'prod-g' && identity.letter === 'G' && identity.name === 'Galón 3720 ml', 'Galón legacy no resolvió/canonizó');
identity = api.resolveInventoryProductIdentityPOS({ nombreSnapshot:'Pulso 250 ml' }, index, { allowLegacyName:true });
check(identity.ok && identity.stableId === 'prod-p' && identity.letter === 'P', 'Producto legacy sin Letra no resolvió por nombre');
check(!api.resolveInventoryProductIdentityPOS({}, index, { allowLegacyName:true }).ok, 'Campos ausentes inventaron una identidad');

// Lotes cargados conserva P/M/D/L/G antiguos sin Receta, pero excluye productos nuevos sin Receta.
const loadedModel = api.buildLotesEventoModelPOS([
  { type:'restock', source:'lote', loteCodigo:'OLD', loteCargaId:'old', time:'2026-07-30T10:00:00Z', productId:1, qty:2 },
  { type:'restock', source:'lote', loteCodigo:'OLD', loteCargaId:'old', time:'2026-07-30T10:00:00Z', productId:8, qty:7 },
  { type:'restock', source:'lote', loteCodigo:'NEW', loteCargaId:'new', time:'2026-07-30T11:00:00Z', loteProductId:'prod-c', qty:3 }
], products);
const loadedLabels = Array.from(loadedModel.columns, column=>column.label);
check(loadedLabels.includes('P') && loadedLabels.includes('C'), 'Lotes cargados perdió Producto legacy/dinámico');
check(!loadedLabels.includes('X'), 'Lotes cargados publicó Producto nuevo sin Receta');
check(loadedModel.rows.find(row=>row.groupKey==='old').quantities['LET:P'] === 2, 'Lote legacy P perdió cantidad');
check(loadedModel.rows.find(row=>row.groupKey==='new').quantities['LET:C'] === 3, 'Lote dinámico C perdió cantidad');

// Sobrantes dinámicos, sin mezclar ni inventar cantidades.
const parent = {
  id:'lot-1', codigo:'LOT-1', status:'EN_EVENTO', assignedEventId:44,
  eventUsage:{
    '44':{
      availabilityProducts:[
        { productId:'prod-c', Letra:'Z', nombreSnapshot:'Nombre viejo', cantidadDisponible:4 },
        { Letra:'Z', nombreSnapshot:'Edición Áurea de Nombre Muy Largo', cantidadDisponible:3 },
        { nombreSnapshot:'Pulso 250 ml', cantidadDisponible:2 },
        { productId:'prod-x', Letra:'X', nombreSnapshot:'Vaso sin receta', cantidadDisponible:9 },
        { productId:'prod-h', Letra:'H', nombreSnapshot:'Histórico Desactivado', cantidadDisponible:1 }
      ],
      remainingByProductId:{ 'prod-c':4, 'prod-z':3, 'prod-p':2, 'prod-x':9, 'prod-h':1 },
      remainingByLetter:{ C:4, Z:3, P:2, X:9, H:1 }
    }
  }
};
const beforeParent = JSON.stringify(parent);
const beforeProducts = JSON.stringify(products);
const model = api.buildSobranteInputModelPOS(parent, 44, products);
const modelLetters = Array.from(model.items, item=>item.letter).sort();
check(JSON.stringify(modelLetters) === JSON.stringify(['C','H','P','Z']), 'Sobrantes no respetó productos dinámicos/Receta');
check(!modelLetters.includes('X'), 'Producto sin Receta apareció en Sobrantes');
check(model.items.find(item=>item.letter==='C').available === 4, 'C se mezcló con Z por snapshot incorrecto');
check(model.items.find(item=>item.letter==='Z').available === 3, 'Z perdió cantidad');
check(JSON.stringify(parent) === beforeParent && JSON.stringify(products) === beforeProducts, 'El modelado de Sobrantes mutó datos históricos');

const request = { byKey:{} };
for (const item of model.items) request.byKey[item.key] = item.letter === 'C' ? 2 : (item.letter === 'Z' ? 1 : 0);
const transfer = api.buildSobranteTransferItemsPOS(parent, 44, request, products);
check(transfer.ok && transfer.total === 3 && transfer.items.length === 2, 'Transferencia dinámica de Sobrantes incorrecta');
check(transfer.items.find(item=>item.Letra==='C').productId === 'prod-c', 'Sobrante C perdió productId');
check(transfer.items.find(item=>item.Letra==='Z').productId === 'prod-z', 'Sobrante Z perdió productId');
check(JSON.stringify(parent) === beforeParent, 'Preparar transferencia reescribió el lote padre');
const legacyShape = api.legacyQuantitiesFromTransferPOS(transfer.items);
check(Object.values(legacyShape).every(value=>value === 0), 'Producto nuevo contaminó campos legacy');

const parentForSubtract = JSON.parse(JSON.stringify(parent));
api.subtractSobranteFromParentSnapshotPOS(parentForSubtract, 44, transfer.items, products);
check(parentForSubtract.eventUsage['44'].remainingByProductId['prod-c'] === 2, 'No restó C una sola vez');
check(parentForSubtract.eventUsage['44'].remainingByProductId['prod-z'] === 2, 'No restó Z una sola vez');
check(parentForSubtract.eventUsage['44'].remainingByProductId['prod-p'] === 2, 'Alteró un producto no transferido');

// Compatibilidad de lote puramente legacy, sin migrarlo.
const legacyParent = { id:'legacy', pulso:'2', media:'1', djeba:'3', litro:'4', galon:'5' };
const legacyBefore = JSON.stringify(legacyParent);
const legacyModel = api.buildSobranteInputModelPOS(legacyParent, 44, products);
check(JSON.stringify(Array.from(legacyModel.items, item=>item.letter).sort()) === JSON.stringify(['D','G','L','M','P']), 'P/M/D/L/G legacy no se leyó');
check(legacyModel.items.find(item=>item.letter==='G').name === 'Galón 3720 ml', 'Galón legacy visible no es 3720 ml');
check(JSON.stringify(legacyParent) === legacyBefore, 'La lectura legacy migró el lote');

// Snapshot intermedio con mapas por productId y Letra no debe duplicar cantidades.
const mapOnlyParent = {
  id:'maps',
  eventUsage:{ '44':{
    remainingByProductId:{ 'prod-c':4, '7':3 },
    remainingByLetter:{ C:4, Z:3, D:2 },
    remainingByKey:{ 'PID:prod-c':4, 'IID:7':3, 'LET:D':2 }
  } }
};
const mapOnlyModel = api.buildSobranteInputModelPOS(mapOnlyParent, 44, products);
check(mapOnlyModel.items.find(item=>item.letter==='C').available === 4, 'Mapa productId/Letra duplicó C');
check(mapOnlyModel.items.find(item=>item.letter==='Z').available === 3, 'Mapa con id interno perdió Z');
check(mapOnlyModel.items.find(item=>item.letter==='D').available === 2, 'Mapa por Letra perdió cantidad histórica');
check(mapOnlyModel.items.reduce((sum,item)=>sum+item.available,0) === 9, 'Mapas intermedios inflaron el total');

(async()=>{
  // Reverso dinámico: identidad interna por producto y compatibilidad legacy.
  const group = { items:[
    { qty:2, loteProductId:'prod-c', loteLetra:'Z', loteNombreSnapshot:'incorrecto' },
    { qty:3, loteLetra:'Z', loteNombreSnapshot:'Edición Áurea de Nombre Muy Largo' },
    { qty:1, loteNombreSnapshot:'Galón 3750 ml' }
  ]};
  const beforeGroup = JSON.stringify(group);
  const summary = await api.summarizeRestockGroupPOS(group, products);
  check(summary.unresolved.length === 0, 'Reverso no resolvió productos válidos');
  check(summary.sumsByPid.get(6) === 2 && summary.sumsByPid.get(7) === 3 && summary.sumsByPid.get(5) === 1, 'Reverso mezcló cantidades/productos');
  check(summary.items.find(item=>item.letter==='G').name === 'Galón 3720 ml', 'Reverso mostró Galón antiguo');
  check(summary.hasGallon === true, 'Reverso no detectó Galón');
  check(JSON.stringify(group) === beforeGroup, 'Resumen de Reverso mutó movimientos históricos');

  const unresolved = await api.summarizeRestockGroupPOS({ items:[{ qty:7, productId:'prod-x', loteLetra:'X' }, { qty:2 }] }, products);
  check(unresolved.unresolved.length === 2 && unresolved.sumsByPid.size === 0, 'Reverso inventó identidad para registros no válidos');

  // Dos productos con la misma Letra no se fusionan cuando su productId es válido.
  const dupProducts = products.concat([
    { id:10, productId:'q-one', name:'Q Uno', receta:true, letra:'Q' },
    { id:11, productId:'q-two', name:'Q Dos', receta:true, letra:'Q' }
  ]);
  const dup = await api.summarizeRestockGroupPOS({ items:[
    { qty:2, loteProductId:'q-one', loteLetra:'Q' },
    { qty:5, loteProductId:'q-two', loteLetra:'Q' }
  ]}, dupProducts);
  check(dup.sumsByPid.get(10) === 2 && dup.sumsByPid.get(11) === 5, 'Productos con Letra repetida se fusionaron');
  check(dup.items.length === 2, 'Reverso perdió un producto con Letra repetida');

  // PWA y release.
  check(release.includes("const rev = 2;"), 'Release general no avanzó a r2');
  check(release.includes("const lastResort = '4.20.99 r2';"), 'Fallback de versión no avanzó');
  check(html.includes('styles.css?v=4.20.99&r=22'), 'POS no carga CSS final');
  check(html.includes('app.js?v=4.20.99&r=47'), 'POS no carga JS final');
  check(html.includes('manifest.webmanifest?v=4.20.99&r=28'), 'POS no carga manifest final');
  check(html.includes('a33-release.js?v=4.20.99&r=61'), 'POS no carga release final');
  check(sw.includes("const MODULE_CACHE_REV = '51';"), 'Caché POS no avanzó');
  check(sw.includes("'./index.html?v=4.20.99&r=35'"), 'SW no precachea HTML final');
  check(sw.includes("'./styles.css?v=4.20.99&r=22'"), 'SW no precachea CSS final');
  check(sw.includes("'./app.js?v=4.20.99&r=47'"), 'SW no precachea JS final');
  check(sw.includes("'./manifest.webmanifest?v=4.20.99&r=28'"), 'SW no precachea manifest final');
  check(sw.includes("'/assets/js/a33-release.js?v=4.20.99&r=61'"), 'SW no precachea release final');
  check(manifest.start_url === './index.html?v=4.20.99&r=35', 'Manifest no abre HTML final');
  check(sw.includes("return p.endsWith('/index.html') || p.endsWith('/app.js') || p.endsWith('/styles.css') || p.endsWith('/manifest.webmanifest');"), 'Se perdió estrategia PWA de assets críticos');

  console.log('SMOKE OK — Suite A33 POS Inventario Lotes Dinámicos Etapa 2/2 Hardening Final');
})().catch((error)=>{
  console.error(error);
  process.exitCode = 1;
});
