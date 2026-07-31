'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const config = read('configuracion/script.js');
const app = read('pos/app.js');
const index = read('pos/index.html');
const sw = read('pos/sw.js');
const manifest = JSON.parse(read('pos/manifest.webmanifest'));
const release = read('assets/js/a33-release.js');

function has(text, needle, label){ assert.ok(text.includes(needle), label || `Falta: ${needle}`); }
function lacks(text, needle, label){ assert.ok(!text.includes(needle), label || `No debe existir: ${needle}`); }

has(config, 'validateDatabaseRestoreReadback', 'Falta readback reutilizable de IndexedDB.');
has(config, "writeDb.transaction(storeNames, 'readwrite')", 'La restauración debe ser transaccional para todos los stores incluidos.');
has(config, 'await validateDatabaseRestoreReadback(dbName, payload, dbSchemas)', 'Falta reapertura y lectura posterior.');
has(config, 'A33_IMPORT_RESTORE_FAILED', 'Falta error técnico de restauración.');
has(config, 'A33_IMPORT_LOCALSTORAGE_READBACK_FAILED', 'Falta readback de localStorage.');
has(config, "'loteCargaId','loteGroupKey','loteProductId','loteLetra'", 'Falta protección de campos de Inventario.');
has(config, 'readback:{ restore:restoreReadback, final:finalReadback, localStorage:localStorageReadback }', 'Falta evidencia de readback final.');
lacks(config, 'try{ store.put(row); }catch(_){ }', 'La escritura no debe silenciar errores.');
lacks(config, 'try { store.put(row); } catch (_) {}', 'La escritura no debe silenciar errores legacy.');

has(app, 'readPosStoresFreshPOS', 'Falta lectura fresca de POS.');
has(app, 'isRecoverablePosIdbReadErrorPOS', 'Falta clasificación de conexión inválida.');
has(app, 'return readPosStoresFreshPOS(names, true)', 'Falta reintento único.');
has(app, "readLotesStorageKeyPOS('arcano33_lotes_archived')", 'Falta lectura archivada.');
has(app, 'readAllHistoricalLotesSourcesPOS', 'Falta consolidación activa + archivada.');
has(app, "loteId:row.loteId ?? row.originalId ?? row.id", 'Falta originalId archivado.');
has(app, "wordEl.textContent = 'sin lectura'", 'Una falla no debe presentarse como cero.');
has(app, '[POS][Lotes cargados] No se pudo leer el histórico.', 'Falta error visible/registrable de lectura.');
const bridge = app.slice(app.indexOf('async function getLotesCargadosEventoReadEntriesPOS'), app.indexOf('function buildLotesEventoModelPOS'));
lacks(bridge, ".catch(()=>[])", 'El puente no debe convertir errores de IndexedDB en arreglos vacíos.');
has(bridge, "['inventory','products','events','meta']", 'Faltan stores del readback fresco.');
has(bridge, 'dedupeLotesReadGroupsPOS(modern.concat(historical)', 'Falta deduplicación moderna/histórica.');

has(release, "const suiteVersion = '4.20.98';");
has(release, 'const rev = 1;');
has(index, 'import-readback-historico-r1-m49');
has(index, 'app.js?v=4.20.98&r=45');
has(sw, "const MODULE_CACHE_REV = '49';");
has(sw, 'a33-v${SW_VERSION}-${MODULE}-r${SW_REV}-m${MODULE_CACHE_REV}');
assert.ok(String(manifest.start_url).includes('v=4.20.98') && String(manifest.start_url).includes('r=33'), 'Manifest POS no fue versionado.');

console.log('OK a33-pos-importacion-readback-historico-fix.smoke');
