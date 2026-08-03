'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'catalogos/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'catalogos/style.css'), 'utf8');
const script = fs.readFileSync(path.join(root, 'catalogos/script.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'catalogos/sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'catalogos/manifest.webmanifest'), 'utf8'));
const storage = fs.readFileSync(path.join(root, 'assets/js/a33-storage.js'), 'utf8');
const backup = fs.readFileSync(path.join(root, 'inline_0.js'), 'utf8');
const inventoryScript = fs.readFileSync(path.join(root, 'inventario/script.js'), 'utf8');
const posScript = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');

function between(source, startToken, endToken){
  const start = source.indexOf(startToken);
  assert.ok(start >= 0, `No se encontró ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(end > start, `No se encontró cierre para ${startToken}`);
  return source.slice(start, end);
}

// Interfaz compacta y opcional en Crear/Editar.
for (const id of ['cat-new-vaso-fisico', 'cat-edit-vaso-fisico']){
  assert.ok(html.includes(`id="${id}"`), `Falta selector ${id}`);
}
assert.ok(html.includes('Vaso físico asociado'), 'Falta etiqueta funcional');
assert.ok(html.includes('Sin asociación'), 'Falta opción vacía');
assert.ok(css.includes('.cat-physical-cup-field small'), 'Falta estilo compacto/auxiliar');
assert.ok(css.includes('@media(max-width:700px)') || css.includes('@media(max-width:760px)') || css.includes('@media(max-width:560px)'), 'Falta responsive de Catálogos');

// Contrato por ID estable y sin inferencia por nombre.
assert.ok(script.includes("const INVENTORY_STORAGE_KEY = 'arcano33_inventario';"), 'Falta fuente oficial de Inventario Varios');
assert.ok(script.includes('function productVasoFisicoId(product)'), 'Falta lector del contrato');
assert.ok(script.includes('vasoFisicoId:data.vasoFisicoId'), 'Crear/Editar no persiste vasoFisicoId');
assert.ok(script.includes("byId(prefix + '-vaso-fisico')"), 'Formulario no lee la asociación');
assert.ok(script.includes('Asociación no encontrada'), 'No se conserva una asociación cuyo insumo fue eliminado');
assert.ok(script.includes('inventoryVariosNameById(inventoryVarios, vasoFisicoId)'), 'Listado no resuelve el nombre por ID');
assert.ok(script.includes('refreshProductPackagingSelects();\n    refreshProductPhysicalCupSelects();'), 'El selector no se carga al iniciar Catálogos');
assert.ok(script.includes('vasoFisicoId: productVasoFisicoId(p)'), 'Snapshot del contrato no incluye el ID');

const contractBlock = between(script, 'function productVasoFisicoId(product)', 'function productStableId(product)');
assert.ok(contractBlock.includes('String(row.id'), 'Inventario Varios no usa el ID estable');
assert.ok(!contractBlock.includes("includes('vaso')"), 'La asociación depende del nombre Vaso');
assert.ok(!contractBlock.includes('normalizeInvKey'), 'La asociación depende de normalización de nombre');
assert.ok(!contractBlock.includes('setItem('), 'El contrato escribe localStorage de Inventario');
assert.ok(!contractBlock.includes('sharedWrite'), 'El contrato escribe Inventario compartido');
assert.ok(!contractBlock.includes('sharedSet'), 'El contrato escribe Inventario compartido');
assert.ok(!contractBlock.includes('.stock =') && !contractBlock.includes('.stock +=') && !contractBlock.includes('.stock -='), 'El contrato modifica stock');

// Runtime de lectura: IDs distintos sobreviven aunque los nombres sean iguales o tengan variantes.
const helperSource = `
const INVENTORY_STORAGE_KEY = 'arcano33_inventario';
${contractBlock}
this.api = { productVasoFisicoId, readInventoryDocumentForCatalog, inventoryVariosRowsForProducts, inventoryVariosStatusLabel, inventoryVariosNameById };
`;
const invPayload = {
  varios:[
    { id:'v_A33_001', producto:'Vasos 12 oz', stock:25, minimo:10, createdAt:1 },
    { id:'v_A33_002', producto:'vasos 12oz', stock:3, minimo:5, createdAt:2 },
    { id:'v_A33_003', producto:'Vásos 12 oz', stock:0, minimo:5, active:false, createdAt:3 },
    { id:'', producto:'Sin ID', stock:9, minimo:1 },
    { id:'v_A33_004', producto:'', stock:9, minimo:1 }
  ]
};
const localStorageStub = {
  getItem(key){ return key === 'arcano33_inventario' ? JSON.stringify(invPayload) : null; }
};
const sandbox = {
  window:{ localStorage:localStorageStub },
  localStorage:localStorageStub,
  JSON, String, Number, Math, Array, Set, Map
};
vm.createContext(sandbox);
vm.runInContext(helperSource, sandbox);
const rows = sandbox.api.inventoryVariosRowsForProducts();
assert.deepStrictEqual(Array.from(rows, row => row.id), ['v_A33_001','v_A33_002'], 'No conserva IDs reales o no filtra líneas inactivas/vacías');
assert.strictEqual(sandbox.api.inventoryVariosNameById(rows, 'v_A33_001'), 'Vasos 12 oz', 'No resuelve por ID exacto');
assert.strictEqual(sandbox.api.inventoryVariosStatusLabel(rows.find(row => row.id === 'v_A33_002')), 'Bajo', 'Estado auxiliar incorrecto');
assert.strictEqual(sandbox.api.productVasoFisicoId({}), '', 'Producto antiguo sin campo no es compatible');
assert.strictEqual(sandbox.api.productVasoFisicoId({ vasoFisicoId:'v_A33_001' }), 'v_A33_001', 'No lee el ID persistente');
assert.strictEqual(JSON.parse(JSON.stringify({ vasoFisicoId:'v_A33_001' })).vasoFisicoId, 'v_A33_001', 'Roundtrip JSON perdió el contrato');

// El contrato central de Productos preserva campos desconocidos y el respaldo guarda registros completos.
assert.ok(storage.includes('const out = productClone(src) || {};'), 'Normalización de Productos ya no preserva el registro completo');
assert.ok(storage.includes('const merged = { ...productClone(base), ...productClone(changes) };'), 'Edición ya no preserva campos existentes');
assert.ok(backup.includes('dataIndexedDB[d.name][storeName] = s.records || [];'), 'Respaldo completo no exporta registros íntegros');
assert.ok(backup.includes('safeStores[storeName] = Array.isArray(records) ? records : [];'), 'Importación/saneamiento recorta campos del registro');

// Esta etapa no toca las operaciones que descontarán más adelante.
assert.ok(!script.includes('vasoFisicoId:data.vasoFisicoId,\n      stock'), 'Producto intenta descontar stock');
assert.ok(inventoryScript.includes('Inventario Varios: CRUD líneas + semáforo'), 'Inventario Varios desapareció');
assert.ok(posScript.includes('async function renderInventario'), 'POS/Inventario quedó incompleto');
assert.ok(posScript.includes('async function reverseAssignSelectedLotePOS'), 'Reversar asignación desapareció');
assert.ok(posScript.includes('async function createSobranteLotPOS'), 'Crear lote sobrante desapareció');

// PWA coordinada únicamente en Catálogos.
assert.ok(html.includes('style.css?v=4.20.97&r=24'), 'HTML no carga CSS vigente');
assert.ok(html.includes('script.js?v=4.20.97&r=36'), 'HTML no carga JS vigente');
assert.ok(html.includes('manifest.webmanifest?v=4.20.97&r=13'), 'HTML no carga manifest vigente');
assert.ok(script.includes("serviceWorker.register('./sw.js?v=4.20.97&r=8')"), 'Registro SW no fue actualizado');
assert.ok(sw.includes("const MODULE_CACHE_REV = '40';"), 'Cache de Catálogos no fue incrementada');
assert.ok(sw.includes("'./index.html?v=4.20.97&r=33'"), 'SW no precachea HTML vigente');
assert.ok(sw.includes("'./style.css?v=4.20.97&r=24'"), 'SW no precachea CSS vigente');
assert.ok(sw.includes("'./script.js?v=4.20.97&r=36'"), 'SW no precachea JS vigente');
assert.ok(sw.includes("'./manifest.webmanifest?v=4.20.97&r=13'"), 'SW no precachea manifest vigente');
assert.strictEqual(manifest.start_url, './index.html?v=4.20.97&r=33', 'Manifest no abre el HTML vigente');

// No se agregaron operaciones destructivas globales.
assert.ok(!script.includes('localStorage.clear('), 'Se agregó borrado global de localStorage');
assert.ok(!script.includes('indexedDB.deleteDatabase('), 'Se agregó borrado de IndexedDB');

for (const dir of ['pos','inventario','lotes','calculadora','calculadora_temporal','finanzas','firebase']){
  assert.ok(fs.existsSync(path.join(root, dir)), `Falta módulo ${dir}`);
}

console.log('SMOKE OK — Suite A33 — POS Vasos — Etapa 1/4 — Contrato seguro por ID');
