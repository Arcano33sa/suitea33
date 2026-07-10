// Simple storage using localStorage
const STORAGE_KEY = "arcano33_lotes";
const ARCHIVE_KEY = "arcano33_lotes_archived"; // Histórico (Etapa 5)

let editingId = null;
let isSavingLote = false;
let editingCtx = null; // { id, metaRev, metaUpdatedAt, fingerprint }

// Lectura dinámica de productos producibles (Catálogos → Lotes)
const A33_PRODUCTOS_DB_NAME = "a33-pos";
const A33_PRODUCTOS_STORE = "products";
const ENVASES_CATALOG_KEY = "a33_catalog_envases_v1";
const TAPAS_CATALOG_KEY = "a33_catalog_tapas_v1";
const CATALOG_DELETED_PRODUCTS_KEY = "a33_catalog_deleted_products_v1";

const LEGACY_PRESENTATIONS = [
  { legacyId: "pulso", field: "pulso", letra: "P", nombre: "Pulso 250 ml", capacidadMl: 250 },
  { legacyId: "media", field: "media", letra: "M", nombre: "Media 375 ml", capacidadMl: 375 },
  { legacyId: "djeba", field: "djeba", letra: "D", nombre: "Djeba 750 ml", capacidadMl: 750 },
  { legacyId: "litro", field: "litro", letra: "L", nombre: "Litro 1000 ml", capacidadMl: 1000 },
  { legacyId: "galon", field: "galon", letra: "G", nombre: "Galón 3720 ml", capacidadMl: 3720 },
];
const LEGACY_BY_ID = Object.fromEntries(LEGACY_PRESENTATIONS.map((p) => [p.legacyId, p]));
const LEGACY_BY_LETTER = Object.fromEntries(LEGACY_PRESENTATIONS.map((p) => [p.letra, p]));
const LEGACY_LETTERS = new Set(LEGACY_PRESENTATIONS.map((p) => p.letra));
const LEGACY_TOTAL_KEYS = LEGACY_PRESENTATIONS.map((p) => p.letra);

// Compat: se mantiene el nombre TOTAL_KEYS para no romper código viejo, pero la UI ya puede sumar claves dinámicas.
const TOTAL_KEYS = LEGACY_TOTAL_KEYS;

const LOTES_POS_CONTRACT_SCHEMA = 1;
const LOTES_POS_CONTRACT_FIELDS = [
  'productId',
  'nombreSnapshot',
  'Letra',
  'cantidadProducida',
  'cantidadDisponible',
  'loteId',
  'loteCodigo',
  'fecha',
  'costoUnitario',
  'costoTotal',
];


let loteProductCatalog = {
  loaded: false,
  status: "legacy",
  items: LEGACY_PRESENTATIONS.map((p) => ({
    productId: p.legacyId,
    legacyId: p.legacyId,
    nombre: p.nombre,
    Letra: p.letra,
    letra: p.letra,
    receta: true,
    activo: true,
    envaseId: "",
    tapaId: "",
    capacidadMl: p.capacidadMl,
    costo: null,
    legacy: true,
  })),
  byLetter: new Map(),
  byProductId: new Map(),
};

function normalizeTextA33(value){
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function deletedCatalogProductKeyA33(value){
  return normalizeTextA33(value).replace(/\s+/g, '');
}

function readDeletedProductKeysForLotes(){
  try{
    const raw = window.localStorage ? localStorage.getItem(CATALOG_DELETED_PRODUCTS_KEY) : null;
    const arr = JSON.parse(raw || '[]');
    return new Set((Array.isArray(arr) ? arr : []).map(v => String(v || '').trim()).filter(Boolean));
  }catch(_){ return new Set(); }
}

function deletedProductKeyCandidatesForLotes(product){
  const p = product && typeof product === 'object' ? product : {};
  const candidates = [];
  const add = (value) => {
    const key = deletedCatalogProductKeyA33(value);
    if (key && !candidates.includes(key)) candidates.push(key);
  };
  add(p.name || p.nombre || p.nombreSnapshot || '');
  add(p.legacyName || '');
  const legacyId = String(p.legacyId || legacyIdFromProductName(p.name || p.nombre || p.nombreSnapshot || '') || '').trim();
  const legacy = legacyId ? LEGACY_BY_ID[legacyId] : null;
  if (legacy){
    add(legacy.nombre);
    if (legacyId === 'galon'){
      add('Galón 3750 ml');
      add('Galón 3750ml');
      add('Galón 3800 ml');
      add('Galón 3800ml');
    }
  }
  return candidates;
}

function catalogProductExactDeletedKeyCandidatesForLotes(product){
  const p = product && typeof product === 'object' ? product : {};
  const candidates = [];
  const add = (value) => {
    const key = deletedCatalogProductKeyA33(value);
    if (key && !candidates.includes(key)) candidates.push(key);
  };
  // Para productos reales de Catálogos solo se respeta el borrado del nombre exacto.
  // La Letra y la familia legacy (ej. Galón/G) no deben bloquear productos nuevos.
  add(p.name || p.nombre || p.nombreSnapshot || '');
  return candidates;
}

function isCatalogProductExactlyDeletedForLotes(product){
  const deleted = readDeletedProductKeysForLotes();
  if (!deleted.size) return false;
  return catalogProductExactDeletedKeyCandidatesForLotes(product).some(key => deleted.has(key));
}

function isProductDeletedForLotes(product){
  const deleted = readDeletedProductKeysForLotes();
  if (!deleted.size) return false;
  return deletedProductKeyCandidatesForLotes(product).some(key => deleted.has(key));
}

function isLegacyPresentationDeletedForLotes(legacy){
  return !!(legacy && isProductDeletedForLotes({
    name: legacy.nombre,
    nombre: legacy.nombre,
    legacyId: legacy.legacyId
  }));
}

function isLegacyLetterDeletedForLotes(letter){
  const legacy = LEGACY_BY_LETTER[normalizeProductLetter(letter)];
  return isLegacyPresentationDeletedForLotes(legacy);
}

function normalizeProductLetter(value){
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 4);
}

function boolFromCatalog(value, fallback){
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const raw = String(value ?? '').trim().toLowerCase();
  if (['true','1','si','sí','yes','y'].includes(raw)) return true;
  if (['false','0','no','n'].includes(raw)) return false;
  return !!fallback;
}

function productHasRecipe(product){
  const p = product && typeof product === 'object' ? product : {};
  if (Object.prototype.hasOwnProperty.call(p, 'receta')) return boolFromCatalog(p.receta, false);
  if (Object.prototype.hasOwnProperty.call(p, 'recipe')) return boolFromCatalog(p.recipe, false);
  if (Object.prototype.hasOwnProperty.call(p, 'hasRecipe')) return boolFromCatalog(p.hasRecipe, false);
  return false;
}

function productActive(product){
  const p = product && typeof product === 'object' ? product : {};
  if (Object.prototype.hasOwnProperty.call(p, 'active')) return boolFromCatalog(p.active, true);
  if (Object.prototype.hasOwnProperty.call(p, 'activo')) return boolFromCatalog(p.activo, true);
  if (Object.prototype.hasOwnProperty.call(p, 'isActive')) return boolFromCatalog(p.isActive, true);
  return true;
}

function productLetter(product){
  const p = product && typeof product === 'object' ? product : {};
  return normalizeProductLetter(p.letra ?? p.Letra ?? p.letter ?? p.productionLetter ?? '');
}

function productEnvaseId(product){
  const p = product && typeof product === 'object' ? product : {};
  return String(p.envaseId ?? p.bottleId ?? p.packagingEnvaseId ?? '').trim();
}

function productTapaId(product){
  const p = product && typeof product === 'object' ? product : {};
  return String(p.tapaId ?? p.capId ?? p.corkId ?? p.packagingTapaId ?? '').trim();
}

function productCost(product){
  const p = product && typeof product === 'object' ? product : {};
  const n = Number(p.unitCost ?? p.costoUnitario ?? p.costPerUnit ?? p.cost ?? p.costo ?? p.referenceCost ?? p.costoReferencial);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function legacyIdFromProductName(name){
  const n = normalizeTextA33(name);
  if (n.includes('pulso')) return 'pulso';
  if (n.includes('media')) return 'media';
  if (n.includes('djeba')) return 'djeba';
  if (n.includes('litro')) return 'litro';
  if (n.includes('galon') || n.includes('gal')) return 'galon';
  return '';
}

function readJSONLocalA33(key, fallback){
  try{
    if (window.A33Storage && typeof A33Storage.getJSON === 'function'){
      const v = A33Storage.getJSON(key, fallback, 'local');
      return v == null ? fallback : v;
    }
  }catch(_){ }
  try{
    const raw = window.localStorage ? localStorage.getItem(key) : null;
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  }catch(_){ return fallback; }
}

function normalizeCatalogArray(raw){
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object'){
    if (Array.isArray(raw.items)) return raw.items;
    if (Array.isArray(raw.list)) return raw.list;
    if (Array.isArray(raw.data)) return raw.data;
    if (Array.isArray(raw.rows)) return raw.rows;
  }
  return [];
}

function readEnvaseCatalog(){
  return normalizeCatalogArray(readJSONLocalA33(ENVASES_CATALOG_KEY, []));
}

function readTapaCatalog(){
  return normalizeCatalogArray(readJSONLocalA33(TAPAS_CATALOG_KEY, []));
}

function numberOrNull(value){
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function capacityFromName(name){
  const s = String(name || '').toLowerCase();
  const m = s.match(/(\d+(?:[\.,]\d+)?)\s*(ml|mililitros?|l|lt|litros?)/i);
  if (!m) return null;
  const n = numberOrNull(m[1]);
  if (!n) return null;
  const unit = String(m[2] || '').toLowerCase();
  return unit.startsWith('l') && n < 100 ? Math.round(n * 1000) : Math.round(n);
}

function capacityFromEnvase(envases, envaseId){
  const id = String(envaseId || '').trim();
  if (!id) return null;
  const row = (Array.isArray(envases) ? envases : []).find((x) => x && String(x.id || '').trim() === id);
  if (!row) return null;
  return numberOrNull(row.capacityMl ?? row.capacidadMl ?? row.capacity ?? row.ml ?? row.volumenMl);
}

function productCapacityMl(product, envases, legacyMeta){
  const p = product && typeof product === 'object' ? product : {};
  return numberOrNull(p.capacityMl ?? p.capacidadMl ?? p.capacity ?? p.capacidad ?? p.volumenMl ?? p.ml)
    || capacityFromEnvase(envases, productEnvaseId(p))
    || capacityFromName(p.name || p.nombre || '')
    || (legacyMeta ? legacyMeta.capacidadMl : null)
    || 0;
}

function productScoreForCatalog(item){
  if (!item) return 0;
  return (item.activo ? 8 : 0)
    + (item.receta ? 8 : 0)
    + (item.Letra ? 4 : 0)
    + (item.envaseId ? 2 : 0)
    + (item.tapaId ? 2 : 0)
    + (item.capacidadMl ? 1 : 0)
    + (item.costo != null ? 1 : 0);
}

function productToLoteCatalogItem(product, envases){
  const p = product && typeof product === 'object' ? product : {};
  const nombre = String(p.name || p.nombre || '').trim();
  if (isCatalogProductExactlyDeletedForLotes({ ...p, nombre })) return null;
  const letter = productLetter(p);
  const recipe = productHasRecipe(p);
  const active = productActive(p);

  // Regla central: sin Receta y sin Letra válida, no entra a Lotes. No inventar letras por nombre.
  if (!active || !recipe || !letter) return null;

  const legacyId = legacyIdFromProductName(nombre);
  const legacyMeta = legacyId ? LEGACY_BY_ID[legacyId] : null;
  const rawId = p.id ?? p.productId ?? p.productoId ?? '';
  const productId = String(rawId || (legacyId || nombre || letter)).trim();
  const envaseId = productEnvaseId(p);
  const tapaId = productTapaId(p);
  const costo = productCost(p);

  return {
    productId,
    legacyId,
    nombre: nombre || (legacyMeta ? legacyMeta.nombre : productId),
    Letra: letter,
    letra: letter,
    receta: true,
    activo: true,
    envaseId,
    tapaId,
    capacidadMl: productCapacityMl(p, envases, legacyMeta),
    costo,
    legacy: !!legacyId,
    catalogSource: true,
    fallbackLegacy: false,
  };
}

async function readCatalogProductsForLotes(){
  if (!window.indexedDB) return null;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    try{
      const req = indexedDB.open(A33_PRODUCTOS_DB_NAME);
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
      req.onsuccess = () => {
        const db = req.result;
        try{
          if (!db || !db.objectStoreNames || !db.objectStoreNames.contains(A33_PRODUCTOS_STORE)){
            try{ if (db) db.close(); }catch(_){ }
            finish([]);
            return;
          }
          const tx = db.transaction(A33_PRODUCTOS_STORE, 'readonly');
          const getReq = tx.objectStore(A33_PRODUCTOS_STORE).getAll();
          getReq.onsuccess = () => {
            const rows = Array.isArray(getReq.result) ? getReq.result : [];
            try{ db.close(); }catch(_){ }
            finish(rows);
          };
          getReq.onerror = () => {
            try{ db.close(); }catch(_){ }
            finish(null);
          };
        }catch(_){
          try{ if (db) db.close(); }catch(_e){ }
          finish(null);
        }
      };
    }catch(_){ finish(null); }
  });
}

function sortCatalogItemsForLotes(a,b){
  const legacyOrder = { P:1, M:2, D:3, L:4, G:5 };
  const oa = legacyOrder[a && a.Letra] || 99;
  const ob = legacyOrder[b && b.Letra] || 99;
  if (oa !== ob) return oa - ob;
  return String((a && a.nombre) || '').localeCompare(String((b && b.nombre) || ''), 'es-NI', { sensitivity:'base' });
}

function isRealCatalogProductItemForLotes(item){
  const p = item && typeof item === 'object' ? item : {};
  if (p.catalogSource === true || p.source === 'catalog') return true;
  const productId = String(p.productId ?? p.productoId ?? p.id ?? '').trim();
  const legacyId = String(p.legacyId || '').trim();
  return !!(productId && (!legacyId || productId !== legacyId));
}

function catalogProductOverridesLegacyLetterForLotes(item){
  const letter = normalizeProductLetter(item && (item.Letra || item.letra));
  if (!letter || !LEGACY_LETTERS.has(letter)) return false;
  if (!isRealCatalogProductItemForLotes(item)) return false;
  if (item && (item.activo === false || item.receta === false)) return false;
  return true;
}

function shouldRenderDynamicProductInputForLotes(item){
  const letter = normalizeProductLetter(item && (item.Letra || item.letra));
  if (!letter) return false;
  if (!LEGACY_LETTERS.has(letter)) return true;
  // Regla madre: si Catálogos trae un producto real activo con P/M/D/L/G,
  // ese producto manda sobre el campo legacy fijo. Esto cubre productos nuevos
  // y también productos editados (ej. Galón 3750 ml -> Galón 3720 ml).
  return catalogProductOverridesLegacyLetterForLotes(item);
}

function getLegacyFallbackCatalogItemsForLotes(){
  return LEGACY_PRESENTATIONS
    .filter((p) => !isLegacyPresentationDeletedForLotes(p))
    .map((p) => ({
      productId: p.legacyId,
      legacyId: p.legacyId,
      nombre: p.nombre,
      Letra: p.letra,
      letra: p.letra,
      receta: true,
      activo: true,
      envaseId: '',
      tapaId: '',
      capacidadMl: p.capacidadMl,
      costo: null,
      legacy: true,
      catalogSource: false,
      fallbackLegacy: true,
    }));
}

function setLoteProductCatalog(items, status, allowLegacyFallback){
  const clean = Array.isArray(items) && items.length
    ? items.filter((item) => isRealCatalogProductItemForLotes(item) ? !isCatalogProductExactlyDeletedForLotes(item) : !isProductDeletedForLotes(item))
    : (allowLegacyFallback === false ? [] : getLegacyFallbackCatalogItemsForLotes());
  const byLetter = new Map();
  const byProductId = new Map();

  for (const raw of clean){
    if (!raw) continue;
    const letter = normalizeProductLetter(raw.Letra || raw.letra);
    if (!letter) continue;
    const item = { ...raw, Letra: letter, letra: letter };
    const prev = byLetter.get(letter);
    if (!prev || productScoreForCatalog(item) >= productScoreForCatalog(prev)) byLetter.set(letter, item);
    const pid = String(item.productId ?? item.id ?? '').trim();
    if (pid) byProductId.set(pid, item);
    if (item.legacyId) byProductId.set(String(item.legacyId), item);
  }

  // Mantener fallback P/M/D/L/G únicamente cuando Catálogos todavía no entregó esos productos y no fueron borrados.
  for (const legacy of LEGACY_PRESENTATIONS){
    if (isLegacyPresentationDeletedForLotes(legacy)) continue;
    if (!byLetter.has(legacy.letra)){
      const item = {
        productId: legacy.legacyId,
        legacyId: legacy.legacyId,
        nombre: legacy.nombre,
        Letra: legacy.letra,
        letra: legacy.letra,
        receta: true,
        activo: true,
        envaseId: '',
        tapaId: '',
        capacidadMl: legacy.capacidadMl,
        costo: null,
        legacy: true,
        catalogSource: false,
        fallbackLegacy: true,
      };
      byLetter.set(legacy.letra, item);
      byProductId.set(legacy.legacyId, item);
    }
  }

  loteProductCatalog = {
    loaded: true,
    status: status || 'catalog',
    items: Array.from(byLetter.values()).sort(sortCatalogItemsForLotes),
    byLetter,
    byProductId,
  };
}

async function refreshLoteProductCatalog(force){
  if (loteProductCatalog.loaded && !force) return loteProductCatalog;
  try{
    const rows = await readCatalogProductsForLotes();
    const hasDeletedMarks = readDeletedProductKeysForLotes().size > 0;
    if (Array.isArray(rows)){
      const envases = readEnvaseCatalog();
      const items = [];
      for (const p of rows){
        const item = productToLoteCatalogItem(p, envases);
        if (item) items.push(item);
      }
      const allowLegacyFallback = rows.length === 0 && !hasDeletedMarks;
      setLoteProductCatalog(items, items.length ? 'catalog' : (allowLegacyFallback ? 'legacy' : 'catalog-empty'), allowLegacyFallback);
    } else {
      setLoteProductCatalog([], hasDeletedMarks ? 'catalog-empty' : 'legacy', !hasDeletedMarks);
    }
  }catch(e){
    console.warn('No se pudieron leer productos dinámicos para Lotes:', e);
    const hasDeletedMarks = readDeletedProductKeysForLotes().size > 0;
    setLoteProductCatalog([], hasDeletedMarks ? 'catalog-empty' : 'legacy', !hasDeletedMarks);
  }
  updateLoteProductCatalogUI();
  return loteProductCatalog;
}

function getCatalogProductByLetter(letter){
  const key = normalizeProductLetter(letter);
  return (key && loteProductCatalog.byLetter && loteProductCatalog.byLetter.get(key)) || null;
}

function getCatalogProductById(id){
  const key = String(id ?? '').trim();
  return (key && loteProductCatalog.byProductId && loteProductCatalog.byProductId.get(key)) || null;
}

function hasRealCatalogProductForLetterInLotes(letter){
  const product = getCatalogProductByLetter(letter);
  return !!(product && product.activo !== false && product.receta !== false && isRealCatalogProductItemForLotes(product));
}

function getLoteDisplayKeys(){
  const keys = [];
  const add = (k) => {
    const key = normalizeProductLetter(k);
    if (key && !keys.includes(key)) keys.push(key);
  };
  for (const item of (loteProductCatalog.items || [])) add(item.Letra || item.letra);
  for (const k of LEGACY_TOTAL_KEYS){
    if (!isLegacyLetterDeletedForLotes(k)) add(k);
  }
  return keys;
}

function isPlainObjectA33(value){
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeQtyValue(value){
  const n = Number(String(value ?? '0').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function getRawProducedItemsFromLote(lote){
  if (!isPlainObjectA33(lote)) return [];
  const candidates = [
    lote.productosProducidos,
    lote.productosDinamicos,
    lote.productos,
    lote.itemsProducidos,
  ];
  for (const raw of candidates){
    if (Array.isArray(raw)) return raw;
  }
  return [];
}

function addProducedItemToMap(map, item, cantidadValue, source){
  if (!map || !item) return;
  const letter = normalizeProductLetter(item.Letra || item.letra || item.letter);
  if (!letter) return;
  const cantidad = normalizeQtyValue(cantidadValue ?? item.cantidad ?? item.unidades ?? item.qty ?? item.quantity ?? 0);
  if (!(cantidad > 0)) return;

  // La Letra guardada en el lote manda. El catálogo solo completa datos faltantes, nunca recalcula el snapshot histórico.
  const catalogById = getCatalogProductById(item.productId ?? item.id ?? item.productoId);
  const catalogByLetter = getCatalogProductByLetter(letter);
  const catalog = catalogById || catalogByLetter || {};
  const legacy = LEGACY_BY_LETTER[letter] || null;

  const prev = map.get(letter) || {
    productId: String(item.productId ?? item.productoId ?? item.id ?? catalog.productId ?? (legacy ? legacy.legacyId : '') ?? '').trim(),
    nombre: String(item.nombreSnapshot || item.nombre || item.name || catalog.nombre || (legacy ? legacy.nombre : letter)).trim(),
    Letra: letter,
    letra: letter,
    receta: item.receta !== false,
    activo: item.activo !== false,
    envaseId: String(item.envaseId || catalog.envaseId || '').trim(),
    tapaId: String(item.tapaId || catalog.tapaId || '').trim(),
    capacidadMl: Number(item.capacidadMl ?? item.volumenMl ?? catalog.capacidadMl ?? (legacy ? legacy.capacidadMl : 0)) || 0,
    costo: item.costoUnitario ?? item.costoReferencial ?? catalog.costo ?? null,
    cantidad: 0,
    legacy: !!(item.legacy || (legacy && (source === 'legacy' || item.legacy !== false))),
    fuenteLectura: source || 'dynamic',
  };

  prev.cantidad += cantidad;
  if (!prev.productId) prev.productId = String(catalog.productId || (legacy ? legacy.legacyId : '') || '').trim();
  if (!prev.nombre || prev.nombre === letter) prev.nombre = String(catalog.nombre || (legacy ? legacy.nombre : letter)).trim();
  if (!prev.envaseId && catalog.envaseId) prev.envaseId = String(catalog.envaseId).trim();
  if (!prev.tapaId && catalog.tapaId) prev.tapaId = String(catalog.tapaId).trim();
  if (!prev.capacidadMl) prev.capacidadMl = Number(catalog.capacidadMl ?? (legacy ? legacy.capacidadMl : 0)) || 0;
  if (legacy){
    prev.legacy = true;
    prev.legacyId = legacy.legacyId;
    prev.legacyField = legacy.field;
  }
  map.set(letter, prev);
}

function addMissingLegacyFieldsToMap(map, lote){
  if (!map || !isPlainObjectA33(lote)) return;
  for (const legacy of LEGACY_PRESENTATIONS){
    // Si la estructura dinámica ya trae P/M/D/L/G, esa fuente manda para evitar duplicar o sumar dos veces.
    if (map.has(legacy.letra)) continue;
    const qty = normalizeQtyValue(lote[legacy.field]);
    if (!(qty > 0)) continue;
    const catalog = getCatalogProductByLetter(legacy.letra) || {};
    addProducedItemToMap(map, {
      productId: catalog.productId || legacy.legacyId,
      nombre: catalog.nombre || legacy.nombre,
      nombreSnapshot: legacy.nombre,
      Letra: legacy.letra,
      letra: legacy.letra,
      envaseId: catalog.envaseId || '',
      tapaId: catalog.tapaId || '',
      capacidadMl: catalog.capacidadMl || legacy.capacidadMl,
      legacy: true,
      legacyId: legacy.legacyId,
      legacyField: legacy.field,
    }, qty, 'legacy');
  }
}

function getCanonicalRemainingByKey(lote){
  if (!isPlainObjectA33(lote)) return null;
  const eid = (lote.assignedEventId != null) ? String(lote.assignedEventId).trim() : '';
  const eu = isPlainObjectA33(lote.eventUsage) ? lote.eventUsage : null;
  const snap = (eu && eid && isPlainObjectA33(eu[eid])) ? eu[eid] : null;
  const source = snap && isPlainObjectA33(snap.remainingByKey) ? snap.remainingByKey : null;
  if (!source) return null;

  const out = {};
  for (const key of Object.keys(source)){
    const letter = normalizeProductLetter(key);
    if (!letter) continue;
    const qty = normalizeQtyValue(source[key]);
    out[letter] = qty;
  }
  return Object.keys(out).length ? out : null;
}

function getCanonicalLoteItems(lote, options){
  const opts = options && typeof options === 'object' ? options : {};
  const useRemaining = opts.useRemaining === true;
  const map = new Map();

  // 1) Estructura dinámica válida, si existe.
  const produced = getRawProducedItemsFromLote(lote);
  for (const item of produced){
    addProducedItemToMap(map, item, item?.cantidad ?? item?.unidades ?? item?.qty ?? item?.quantity, 'dynamic');
  }

  // 2) Campos legacy solo cuando esa letra no vino ya en dinámico. Así se permite mixto sin duplicar.
  addMissingLegacyFieldsToMap(map, lote);

  // 3) Remanente por evento: snapshot de consumo manda solo para visualización de restantes.
  if (useRemaining){
    const rbk = getCanonicalRemainingByKey(lote);
    if (rbk){
      Object.keys(rbk).forEach((k) => {
        const letter = normalizeProductLetter(k);
        if (!letter) return;
        const n = normalizeQtyValue(rbk[k]);
        const base = map.get(letter) || {
          Letra: letter,
          letra: letter,
          cantidad: 0,
          nombre: (getCatalogProductByLetter(letter)?.nombre || (LEGACY_BY_LETTER[letter]?.nombre) || letter),
          productId: (getCatalogProductByLetter(letter)?.productId || (LEGACY_BY_LETTER[letter]?.legacyId) || letter),
          legacy: !!LEGACY_BY_LETTER[letter],
          fuenteLectura: 'remaining',
        };
        base.cantidad = n;
        map.set(letter, base);
      });
    }
  }

  return Array.from(map.values()).sort((a,b) => sortCatalogItemsForLotes(a,b));
}

function getLoteProducedItems(lote, options){
  const opts = options && typeof options === 'object' ? options : {};
  return getCanonicalLoteItems(lote, { useRemaining: opts.useRemaining !== false });
}

function getLoteCreatedItems(lote){
  return getCanonicalLoteItems(lote, { useRemaining: false });
}

function getLoteCreatedQuantitiesByLetter(lote){
  const out = {};
  for (const item of getLoteCreatedItems(lote)){
    const letter = normalizeProductLetter(item.Letra || item.letra);
    if (!letter) continue;
    const n = normalizeQtyValue(item.cantidad ?? item.unidades ?? 0);
    if (n > 0) out[letter] = (out[letter] || 0) + n;
  }
  return out;
}

function getLoteQuantitiesByLetter(lote){
  const out = {};
  for (const item of getLoteProducedItems(lote, { useRemaining:true })){
    const letter = normalizeProductLetter(item.Letra || item.letra);
    if (!letter) continue;
    const n = Number(item.cantidad);
    out[letter] = (out[letter] || 0) + (Number.isFinite(n) && n >= 0 ? n : 0);
  }
  return out;
}

function computeRemainingTotals(visibleLotes){
  const totals = {};
  getLoteDisplayKeys().forEach((k) => { totals[k] = 0; });
  if (!Array.isArray(visibleLotes) || !visibleLotes.length) return totals;

  for (const lote of visibleLotes){
    const byLetter = getLoteQuantitiesByLetter(lote);
    Object.keys(byLetter).forEach((k) => {
      const key = normalizeProductLetter(k);
      if (!key) return;
      if (totals[key] == null) totals[key] = 0;
      totals[key] += byLetter[k] || 0;
    });
  }
  return totals;
}

function createTotalChip(key, value, title){
  const chip = document.createElement('div');
  chip.className = 'totals-chip';
  chip.setAttribute('aria-label', title || ('Total ' + key));

  const k = document.createElement('div');
  k.className = 'totals-chip-key';
  k.textContent = key;

  const v = document.createElement('div');
  v.className = 'totals-chip-val';
  v.dataset.totalKey = key;
  const n = Number(value);
  const num = Number.isFinite(n) ? n : 0;
  v.textContent = String(num);
  v.classList.toggle('is-zero', num === 0);

  chip.appendChild(k);
  chip.appendChild(v);
  return chip;
}

function updateTotalsBarUI(totals){
  const bar = $("totals-bar");
  if (!bar) return;
  const chips = bar.querySelector('.totals-chips');
  if (!chips) return;
  const data = totals && typeof totals === 'object' ? totals : {};
  const keys = getLoteDisplayKeys();
  Object.keys(data).forEach((k) => { if (!keys.includes(normalizeProductLetter(k))) keys.push(normalizeProductLetter(k)); });

  chips.innerHTML = '';
  keys.forEach((k) => {
    if (!k) return;
    const product = getCatalogProductByLetter(k);
    const title = product ? `${product.nombre || k} · Letra ${k}` : `Letra ${k}`;
    chips.appendChild(createTotalChip(k, data[k] || 0, title));
  });
}

function loteHasLetterQuantity(lote, letter){
  const key = normalizeProductLetter(letter);
  if (!key || !lote) return false;
  const created = getLoteCreatedQuantitiesByLetter(lote);
  if (normalizeQtyValue(created[key]) > 0) return true;
  const remaining = getLoteQuantitiesByLetter(lote);
  return normalizeQtyValue(remaining[key]) > 0;
}

function shouldShowLegacyLetterForRows(letter, lotes){
  const key = normalizeProductLetter(letter);
  if (!key) return false;
  if (hasRealCatalogProductForLetterInLotes(key)) return true;
  if (!isLegacyLetterDeletedForLotes(key)) return true;
  return (Array.isArray(lotes) ? lotes : []).some((lote) => loteHasLetterQuantity(lote, key));
}

function updateLegacyProductFieldsUI(lote){
  const source = lote || null;
  for (const legacy of LEGACY_PRESENTATIONS){
    const input = $(legacy.field);
    if (!input) continue;
    const field = input.closest ? input.closest('.field') : null;
    const catalogProduct = getCatalogProductByLetter(legacy.letra);
    const overriddenByCatalog = catalogProductOverridesLegacyLetterForLotes(catalogProduct);
    const deleted = isLegacyPresentationDeletedForLotes(legacy);
    const keepHistoricalValue = source && loteHasLetterQuantity(source, legacy.letra);
    const hideLegacyField = overriddenByCatalog || (deleted && !keepHistoricalValue);

    // Si Catálogos tiene un producto real para esta Letra, el campo dinámico es
    // la fuente de captura. Se limpia el legacy oculto para no duplicar unidades
    // ni dejar la G amarrada al Galón viejo.
    if (hideLegacyField){
      input.value = '';
    }
    input.dataset.loteCatalogDeleted = deleted ? '1' : '0';
    input.dataset.loteCatalogOverride = overriddenByCatalog ? '1' : '0';
    if (field){
      field.style.display = hideLegacyField ? 'none' : '';
      field.setAttribute('aria-hidden', hideLegacyField ? 'true' : 'false');
    }
  }
}

function updateLegacyTableColumnVisibility(visibleLotes){
  const table = $('lotes-table');
  if (!table) return;
  const columnIndexes = { P:3, M:4, D:5, L:6, G:7 };
  Object.keys(columnIndexes).forEach((letter) => {
    const visible = shouldShowLegacyLetterForRows(letter, visibleLotes);
    const idx = columnIndexes[letter];
    Array.from(table.querySelectorAll('tr')).forEach((row) => {
      const cell = row.children && row.children[idx] ? row.children[idx] : null;
      if (cell) cell.style.display = visible ? '' : 'none';
    });
  });
}

function legacyLettersForLoteCard(lote){
  return LEGACY_TOTAL_KEYS.filter((letter) => {
    if (hasRealCatalogProductForLetterInLotes(letter)) return true;
    if (!isLegacyLetterDeletedForLotes(letter)) return true;
    return loteHasLetterQuantity(lote, letter);
  });
}

function updateLoteProductCatalogUI(){
  const bar = $("lote-products-catalog-bar");
  const chips = $("lote-products-catalog-chips");
  const status = $("lote-products-catalog-status");
  if (!bar || !chips || !status) return;

  const currentLote = editingId ? loadLotes().find((l) => String(l?.id) === String(editingId)) : null;
  updateLegacyProductFieldsUI(currentLote || null);

  const items = (loteProductCatalog.items || []).filter((p) => p && p.receta !== false && p.activo !== false && normalizeProductLetter(p.Letra || p.letra));
  chips.innerHTML = '';

  if (!items.length){
    status.textContent = 'Sin productos activos con Receta y Letra disponibles para Lotes.';
    bar.classList.add('is-warn');
    return;
  }

  bar.classList.remove('is-warn');
  for (const item of items){
    const chip = document.createElement('span');
    chip.className = 'catalog-product-chip';
    const letter = normalizeProductLetter(item.Letra || item.letra);
    const name = String(item.nombre || letter).trim();
    chip.textContent = `${letter} · ${name}`;
    chip.title = [
      `Producto: ${name}`,
      `Letra: ${letter}`,
      item.envaseId ? `Envase: ${item.envaseId}` : '',
      item.tapaId ? `Tapa: ${item.tapaId}` : '',
      item.capacidadMl ? `Capacidad: ${item.capacidadMl} ml` : ''
    ].filter(Boolean).join(' · ');
    chips.appendChild(chip);
  }

  const source = loteProductCatalog.status === 'catalog' ? 'Catálogos' : 'compatibilidad legacy';
  status.textContent = `${items.length} producto(s) producible(s) leídos desde ${source}.`;

  renderDynamicProductInputs(currentLote || null);
}

function formatDynamicProductSummary(lote, includeLegacy){
  return formatLoteProductSummary(lote, { includeLegacy: !!includeLegacy, useRemaining: true });
}

function appendDynamicProductChips(parent, lote, includeLegacy){
  if (!parent) return;
  const items = getLoteProducedItems(lote, { useRemaining:true }).filter((item) => {
    const letter = normalizeProductLetter(item.Letra || item.letra);
    const n = Number(item.cantidad);
    if (!letter || !Number.isFinite(n) || n <= 0) return false;
    return includeLegacy ? true : !LEGACY_LETTERS.has(letter);
  });
  for (const item of items){
    const letter = normalizeProductLetter(item.Letra || item.letra);
    const chip = document.createElement('span');
    chip.className = 'chip chip--product-dynamic';
    chip.textContent = `${letter}: ${formatQtyForDisplay(item.cantidad)}`;
    chip.title = String(item.nombre || letter);
    parent.appendChild(chip);
  }
}


function formatQtyForDisplay(value){
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(n % 1 === 0 ? Math.trunc(n) : n);
}

function hasOwnA33(obj, key){
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function displayQtyFromMap(map, letter, fallback){
  const key = normalizeProductLetter(letter);
  if (hasOwnA33(map, key)) return formatQtyForDisplay(map[key]);
  return String(fallback ?? '');
}

function formatLoteProductSummary(lote, options){
  const opts = options && typeof options === 'object' ? options : {};
  const includeLegacy = opts.includeLegacy !== false;
  const useRemaining = opts.useRemaining === true;
  const items = getCanonicalLoteItems(lote, { useRemaining }).filter((item) => {
    const letter = normalizeProductLetter(item.Letra || item.letra);
    if (!letter) return false;
    if (!includeLegacy && LEGACY_LETTERS.has(letter)) return false;
    const n = Number(item.cantidad);
    return Number.isFinite(n) && n > 0;
  });
  return items.map((item) => `${normalizeProductLetter(item.Letra || item.letra)}: ${formatQtyForDisplay(item.cantidad)}`).join(' · ');
}

function parseLoteQuantityInput(value, label){
  const raw = String(value ?? '').trim();
  if (!raw) return { ok: true, value: 0, empty: true };
  const normalized = raw.replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)){
    return { ok: false, value: 0, message: `Cantidad inválida en ${label || 'producto'}. Usa un número entero mayor o igual a 0.` };
  }
  return { ok: true, value: n, empty: false };
}

function getLegacyFieldByLetter(letter){
  const legacy = LEGACY_BY_LETTER[normalizeProductLetter(letter)];
  return legacy ? legacy.field : '';
}

function getProductSnapshotForLote(product, cantidad, fechaIso, codigoLote, source){
  const p = product && typeof product === 'object' ? product : {};
  const letter = normalizeProductLetter(p.Letra || p.letra || p.letter);
  const qty = Number(cantidad);
  if (!letter || !Number.isFinite(qty) || qty <= 0) return null;

  const legacy = LEGACY_BY_LETTER[letter] || null;
  const productId = String(p.productId ?? p.productoId ?? p.id ?? (legacy ? legacy.legacyId : '') ?? '').trim();
  const nombre = String(p.nombre || p.nombreSnapshot || p.name || (legacy ? legacy.nombre : letter)).trim();
  const costoUnitario = Number(p.costoUnitario ?? p.costoReferencial ?? p.costo ?? p.cost ?? NaN);
  const item = {
    productId: productId || letter,
    nombre,
    nombreSnapshot: nombre,
    Letra: letter,
    letra: letter,
    cantidad: qty,
    unidades: qty,
    fecha: fechaIso || '',
    codigo: codigoLote || '',
    lote: codigoLote || '',
    batchCode: codigoLote || '',
    origenProduccion: source || 'lotes-manual',
    envaseId: String(p.envaseId || '').trim(),
    tapaId: String(p.tapaId || '').trim(),
  };
  if (legacy){
    item.legacy = true;
    item.legacyId = legacy.legacyId;
    item.legacyField = legacy.field;
  }
  if (p.capacidadMl != null) item.capacidadMl = Number(p.capacidadMl) || 0;
  if (Number.isFinite(costoUnitario) && costoUnitario >= 0){
    item.costoUnitario = costoUnitario;
    item.costoTotal = +(costoUnitario * qty).toFixed(4);
  }
  return item;
}

function normalizeDynamicLoteItems(rawItems){
  const out = [];
  const source = Array.isArray(rawItems) ? rawItems : [];
  for (const raw of source){
    if (!raw || typeof raw !== 'object') continue;
    const letter = normalizeProductLetter(raw.Letra || raw.letra || raw.letter);
    const qty = Number(raw.cantidad ?? raw.unidades ?? raw.qty ?? 0);
    if (!letter || !Number.isFinite(qty) || qty <= 0) continue;
    const catalog = getCatalogProductByLetter(letter) || getCatalogProductById(raw.productId ?? raw.productoId ?? raw.id) || {};
    const legacy = LEGACY_BY_LETTER[letter] || null;
    const productId = String(raw.productId ?? raw.productoId ?? raw.id ?? catalog.productId ?? (legacy ? legacy.legacyId : letter)).trim();
    const nombre = String(raw.nombreSnapshot || raw.nombre || raw.name || catalog.nombre || (legacy ? legacy.nombre : letter)).trim();
    const item = {
      ...raw,
      productId: productId || letter,
      nombre,
      nombreSnapshot: nombre,
      Letra: letter,
      letra: letter,
      cantidad: qty,
      unidades: qty,
      envaseId: String(raw.envaseId || catalog.envaseId || '').trim(),
      tapaId: String(raw.tapaId || catalog.tapaId || '').trim(),
    };
    if (legacy){
      item.legacy = raw.legacy !== false;
      item.legacyId = raw.legacyId || legacy.legacyId;
      item.legacyField = raw.legacyField || legacy.field;
    }
    const costoUnitario = Number(raw.costoUnitario ?? raw.costoReferencial ?? raw.costo ?? catalog.costo ?? NaN);
    if (Number.isFinite(costoUnitario) && costoUnitario >= 0){
      item.costoUnitario = costoUnitario;
      if (item.costoTotal == null) item.costoTotal = +(costoUnitario * qty).toFixed(4);
    }
    out.push(item);
  }
  return out.sort((a,b) => sortCatalogItemsForLotes(a,b));
}

function getProducedQuantityMap(lote, useRemaining){
  const map = new Map();
  for (const item of getLoteProducedItems(lote, { useRemaining: !!useRemaining })){
    const letter = normalizeProductLetter(item.Letra || item.letra);
    if (!letter) continue;
    const n = Number(item.cantidad ?? item.unidades ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    map.set(letter, (map.get(letter) || 0) + n);
  }
  return map;
}

function buildProducedItemsFromForm(baseData){
  const fechaIso = formatDate(baseData && baseData.fecha ? baseData.fecha : ($('fecha') ? $('fecha').value : ''));
  const codigoLote = canonicalBatchCode(baseData && baseData.codigo ? baseData.codigo : ($('codigo') ? $('codigo').value : '')) || String(baseData?.codigo || '').trim();
  const items = [];
  const editingLoteSource = editingId ? (loadLotes().find((l) => String(l?.id) === String(editingId)) || null) : null;
  const editingCreatedByLetter = editingLoteSource ? getLoteCreatedQuantitiesByLetter(editingLoteSource) : {};

  for (const legacy of LEGACY_PRESENTATIONS){
    const catalogProduct = getCatalogProductByLetter(legacy.letra);
    const overriddenByCatalog = catalogProductOverridesLegacyLetterForLotes(catalogProduct);

    // Cuando un producto real activo de Catálogos usa una Letra legacy, esa Letra
    // se captura en el campo dinámico. El campo legacy fijo se ignora para evitar
    // duplicados y para no bloquear ediciones como Galón 3720 ml / G.
    if (overriddenByCatalog) continue;

    const input = $(legacy.field);
    const parsed = parseLoteQuantityInput(input ? input.value : (baseData ? baseData[legacy.field] : 0), legacy.nombre);
    if (!parsed.ok){ alert(parsed.message); return null; }
    let qtyValue = parsed.value;
    const deleted = isLegacyPresentationDeletedForLotes(legacy);
    const historicalQty = normalizeQtyValue(editingCreatedByLetter[legacy.letra]);
    if (deleted && editingId && historicalQty > 0 && !(qtyValue > 0)){
      qtyValue = historicalQty;
    }
    if (qtyValue > 0){
      if (deleted && !(editingId && historicalQty > 0)){
        alert('Ese producto ya no está disponible en Catálogos.');
        return null;
      }
      const catalog = getCatalogProductByLetter(legacy.letra) || (deleted ? null : legacy);
      if (!catalog && !deleted) continue;
      const product = { ...legacy, ...(catalog || {}), Letra: legacy.letra, letra: legacy.letra, legacy: true };
      const item = getProductSnapshotForLote(product, qtyValue, fechaIso, codigoLote, 'lotes-manual');
      if (item) items.push(item);
    }
  }

  const dynamicInputs = Array.from(document.querySelectorAll('[data-lote-product-id][data-lote-letter]'));
  for (const input of dynamicInputs){
    const letter = normalizeProductLetter(input.dataset.loteLetter || '');
    const allowLegacyLetter = input.dataset.loteAllowLegacyLetter === '1';
    if (!letter || (LEGACY_LETTERS.has(letter) && !allowLegacyLetter)) continue;
    const catalog = getCatalogProductByLetter(letter) || getCatalogProductById(input.dataset.loteProductId || '') || null;
    const label = catalog ? `${catalog.nombre || letter} (${letter})` : `producto ${letter}`;
    const parsed = parseLoteQuantityInput(input.value, label);
    if (!parsed.ok){ alert(parsed.message); return null; }
    if (parsed.value > 0){
      const item = getProductSnapshotForLote(catalog || { productId: input.dataset.loteProductId || letter, nombre: label, Letra: letter, letra: letter }, parsed.value, fechaIso, codigoLote, 'lotes-manual');
      if (item) items.push(item);
    }
  }

  return normalizeDynamicLoteItems(items);
}

function renderDynamicProductInputs(lote){
  const grid = $('dynamic-products-grid');
  const status = $('dynamic-products-status');
  if (!grid || !status) return;

  updateLegacyProductFieldsUI(lote || null);
  const qtyMap = lote ? getProducedQuantityMap(lote, false) : new Map();
  const byLetter = new Map();
  const addDynamicInputItem = (item) => {
    if (!item || item.receta === false || item.activo === false) return;
    const letter = normalizeProductLetter(item.Letra || item.letra);
    if (!letter || !shouldRenderDynamicProductInputForLotes({ ...item, Letra: letter, letra: letter })) return;
    if (!byLetter.has(letter)) byLetter.set(letter, { ...item, Letra: letter, letra: letter });
  };

  (loteProductCatalog.items || []).forEach(addDynamicInputItem);
  if (lote){
    getLoteProducedItems(lote, { useRemaining:false }).forEach(addDynamicInputItem);
  }
  const items = Array.from(byLetter.values()).sort((a,b) => sortCatalogItemsForLotes(a,b));

  grid.innerHTML = '';
  if (!items.length){
    status.textContent = 'Sin productos dinámicos adicionales disponibles.';
    grid.style.display = 'none';
    return;
  }

  grid.style.display = '';
  const frag = document.createDocumentFragment();
  for (const item of items){
    const wrap = document.createElement('div');
    wrap.className = 'dynamic-product-field';

    const label = document.createElement('label');
    const inputId = `dyn-prod-${String(item.productId || item.Letra).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    label.setAttribute('for', inputId);
    const strong = document.createElement('strong');
    strong.textContent = item.Letra;
    label.appendChild(strong);
    label.appendChild(document.createTextNode(` · ${item.nombre || item.Letra}`));

    const input = document.createElement('input');
    input.type = 'number';
    input.id = inputId;
    input.min = '0';
    input.step = '1';
    input.inputMode = 'numeric';
    input.className = 'a33-num dynamic-product-input';
    input.dataset.loteProductId = String(item.productId || '');
    input.dataset.loteLetter = item.Letra;
    input.dataset.loteAllowLegacyLetter = LEGACY_LETTERS.has(item.Letra) ? '1' : '0';
    input.dataset.a33Default = '0';
    input.value = qtyMap.has(item.Letra) ? formatQtyForDisplay(qtyMap.get(item.Letra)) : '';
    input.placeholder = '0';
    input.title = `${item.nombre || item.Letra} · Letra ${item.Letra}`;

    wrap.appendChild(label);
    wrap.appendChild(input);
    frag.appendChild(wrap);
  }
  grid.appendChild(frag);
  status.textContent = `${items.length} producto(s) dinámico(s) adicional(es). Vacío o 0 no se guarda.`;
}

function abbrProducto(nombre) {
  if (!nombre) return "";
  const legacy = legacyIdFromProductName(nombre);
  if (legacy && LEGACY_BY_ID[legacy]) return LEGACY_BY_ID[legacy].letra;
  return "";
}
function $(id) {
  return document.getElementById(id);
}

function canonicalBatchCode(value){
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function deriveStableLoteId(lote){
  const obj = lote && typeof lote === 'object' ? lote : {};
  const batch = canonicalBatchCode(obj.batchCode || obj.codigo || obj.code || '');
  if (batch) return `batch_${batch}`;
  const id = String(obj.loteId || obj.id || '').trim();
  return id || `lote_${Date.now()}`;
}

function backfillLoteIdentityInPlace(lote){
  if (!lote || typeof lote !== 'object') return lote;
  const batch = canonicalBatchCode(lote.batchCode || lote.codigo || lote.code || '');
  if (batch && !lote.batchCode) lote.batchCode = batch;
  if (!lote.loteId) lote.loteId = batch ? `batch_${batch}` : deriveStableLoteId(lote);
  return lote;
}

// ================================
// Etapa 3: iPad-first + rendimiento
// - búsqueda con debounce
// - paginación simple (cargar más)
// - menos listeners (delegación)
// ================================

const LIST_PAGE_SIZE = 60;

let listView = {
  query: '',
  pageSize: LIST_PAGE_SIZE,
  wanted: LIST_PAGE_SIZE,
  rendered: 0,
  metaRev: null,
  allSorted: [],
  filtered: [],
  byId: new Map(),
  searchIndex: new Map(),
  totals: { P: 0, M: 0, D: 0, L: 0, G: 0 },
};

let isExporting = false;

function debounce(fn, delayMs){
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), delayMs);
  };
}

function setExportHint(msg, isError){
  const el = $("export-hint");
  if (!el) return;
  el.textContent = msg ? String(msg) : "";
  el.classList.toggle('is-error', !!isError);
}


function isCardMode(){
  try{
    return window.matchMedia && window.matchMedia('(max-width: 1024px)').matches;
  }catch(_){
    return false;
  }
}

// ================================
// Etapa 2: Compatibilidad total + lectura robusta
// - tolera data vieja / variantes de otros módulos
// - normaliza fechas (YYYY-MM-DD) y números
// ================================

function normStr(v){
  if (v == null) return '';
  return String(v);
}

function isBlank(v){
  return v == null || (typeof v === 'string' && v.trim() === '');
}

function normalizeDateYMD(value){
  if (!value) return '';
  // Si ya es YYYY-MM-DD, respetar
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try{
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0,10);
  }catch(_){
    return '';
  }
}

function coerceNonNegIntString(value, fallback='0'){
  if (value == null) return fallback;
  const n = parseInt(String(value).replace(/[^0-9-]/g,''), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return String(n);
}

function coerceFiniteNumberString(value, fallback=''){
  if (value == null) return fallback;
  const s = String(value).trim();
  if (!s) return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  // Mantener entero sin .0, pero no forzar decimales.
  return String(n % 1 === 0 ? Math.trunc(n) : n);
}

function normalizeLoteRecord(lote){
  if (!lote || typeof lote !== 'object') return null;
  const out = { ...lote };

  // Variantes comunes de otros módulos
  if (isBlank(out.codigo) && !isBlank(out.batchCode)) out.codigo = normStr(out.batchCode).trim();
  if (isBlank(out.codigo) && !isBlank(out.code)) out.codigo = normStr(out.code).trim();

  // Identidad estable (Etapa 1)
  try{ backfillLoteIdentityInPlace(out); }catch(_){ }

  // Fechas
  const fecha = normalizeDateYMD(out.fecha || out.fechaProd || out.fechaProduccion || out.createdAt);
  if (fecha) out.fecha = fecha;
  const cad = normalizeDateYMD(out.caducidad || out.exp || out.expiryDate);
  if (cad) out.caducidad = cad;
  if (!out.caducidad && out.fecha){
    out.caducidad = calculateCaducidad(out.fecha) || '';
  }

  // Números (conservador: no inventar, solo sanear)
  out.pulso = coerceNonNegIntString(out.pulso, '0');
  out.media = coerceNonNegIntString(out.media, '0');
  out.djeba = coerceNonNegIntString(out.djeba, '0');
  out.litro = coerceNonNegIntString(out.litro, '0');
  // tolerar 'galón' legacy
  if (out.galon == null && out['galón'] != null) out.galon = out['galón'];
  out.galon = coerceNonNegIntString(out.galon, '0');

  out.volTotal = coerceFiniteNumberString(out.volTotal, out.volTotal == null ? '' : '');
  out.volVino = coerceFiniteNumberString(out.volVino, out.volVino == null ? '' : '');
  out.volVodka = coerceFiniteNumberString(out.volVodka, out.volVodka == null ? '' : '');
  out.volJugo = coerceFiniteNumberString(out.volJugo, out.volJugo == null ? '' : '');
  out.volSirope = coerceFiniteNumberString(out.volSirope, out.volSirope == null ? '' : '');
  out.volAgua = coerceFiniteNumberString(out.volAgua, out.volAgua == null ? '' : '');

  // Aceptar totalVolumenFinalMl (Calculadora/inventario) como volTotal si faltaba
  if (isBlank(out.volTotal) && out.totalVolumenFinalMl != null){
    const n = Number(out.totalVolumenFinalMl);
    if (Number.isFinite(n) && n >= 0) out.volTotal = String(Math.round(n));
  }

  // Estructura dinámica de productos producidos (coexiste con campos legacy)
  out.productosProducidos = normalizeDynamicLoteItems(out.productosProducidos);
  if (out.productosProducidos.length){
    out.productosProducidosSchema = out.productosProducidosSchema || 1;
    if (!out.contratoLotesDinamicos || typeof out.contratoLotesDinamicos !== 'object'){
      out.contratoLotesDinamicos = {
        schema: 1,
        fuente: 'lotes',
        campos: ['productId','nombreSnapshot','Letra','cantidad','cantidadDisponible','loteId','loteCodigo','envaseId','tapaId','fecha','codigo','costoUnitario','costoTotal'],
        legacyFields: ['pulso','media','djeba','litro','galon']
      };
    }
  }

  // Salida/contrato preparado para POS e Inventario por productId (sin tocar venta POS).
  attachPOSAvailabilityContract(out);

  // Notas
  if (out.notas != null) out.notas = String(out.notas);

  return out;
}

function normalizeLotesArray(arr){
  const safe = Array.isArray(arr) ? arr : [];
  const out = [];
  for (const it of safe){
    const n = normalizeLoteRecord(it);
    if (n) out.push(n);
  }
  return out;
}

function readLotesAndMetaFresh(){
  try{
    if (window.A33Storage && typeof A33Storage.sharedRead === 'function'){
      const r = A33Storage.sharedRead(STORAGE_KEY, [], 'local');
      const data = normalizeLotesArray(r && r.data);
      return { lotes: data, meta: r && r.meta ? r.meta : A33Storage.sharedGetMeta(STORAGE_KEY, 'local') };
    }
  }catch(_){ }
  // Fallback
  let lotes = [];
  try{
    const raw = A33Storage.getItem(STORAGE_KEY);
    if (raw) lotes = JSON.parse(raw) || [];
  }catch(_){ lotes = []; }
  return { lotes: normalizeLotesArray(lotes), meta: { rev: 0, updatedAt: null, writer: '' } };
}

function nonEditableFingerprint(lote){
  if (!lote || typeof lote !== 'object') return '';
  // Solo campos que NO vienen del formulario (para detectar pisadas reales)
  const pick = {
    loteId: lote.loteId || null,
    status: lote.status || null,
    assignedEventId: lote.assignedEventId ?? null,
    assignedEventName: lote.assignedEventName || null,
    assignedAt: lote.assignedAt || null,
    assignedCargaId: lote.assignedCargaId || null,
    assignmentHistory: lote.assignmentHistory || null,
    eventUsage: lote.eventUsage || null,
    closedAt: lote.closedAt || null,
    reversedAt: lote.reversedAt || null,
    reversedReason: lote.reversedReason || null,
    parentLotId: lote.parentLotId || null,
    loteType: lote.loteType || null,
    sourceEventId: lote.sourceEventId || null,
    sourceEventName: lote.sourceEventName || null,
    recetaId: lote.recetaId || lote.recipeId || null,
    recetaNombre: lote.recetaNombre || lote.recipeName || null,
    inventarioRef: lote.inventarioRef || null,
    extraRefs: lote.refs || null,
  };
  try{ return stableHash32(JSON.stringify(pick)); }catch(_){ return ''; }
}

function loadLotes() {
  try {
    // Lectura robusta (Etapa 2): normaliza sin romper data vieja.
    return readLotesAndMetaFresh().lotes;
  } catch (e) {
    console.error("Error leyendo localStorage", e);
    return [];
  }
}

function loadArchivedLotes(){
  try {
    const raw = A33Storage.getItem(ARCHIVE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (e) {
    console.error("Error leyendo histórico", e);
    return [];
  }
}

function saveArchivedLotes(data){
  A33Storage.setItem(ARCHIVE_KEY, JSON.stringify(data));
}

function saveLotes(data) {
  try {
    if (window.A33Storage && typeof A33Storage.sharedSet === 'function') {
      const r = A33Storage.sharedSet(STORAGE_KEY, data, { source: 'lotes' });
      if (r && r.ok === false) {
        if (r.message) alert(r.message);
        return false;
      }
      return true;
    }
  } catch (e) {
    console.warn('saveLotes (shared) falló, usando fallback:', e);
  }
  try {
    const ok = A33Storage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (!ok) {
      alert('No se pudo guardar el lote. Revisa espacio disponible o permisos del navegador.');
      return false;
    }
    return true;
  } catch (e) {
    console.error('Error guardando lotes (fallback)', e);
    alert('No se pudo guardar el lote.');
    return false;
  }
}

function formatDate(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toISOString().slice(0, 10);
  } catch {
    return value;
  }
}

function calculateCaducidad(fechaStr) {
  if (!fechaStr) return "";
  const d = new Date(fechaStr);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();

  const cad = new Date(year, month + 2, day);
  return cad.toISOString().slice(0, 10);
}

// Helpers para ordenar (más reciente arriba)
function toTimestamp(value) {
  if (!value) return NaN;
  const d = new Date(value);
  const t = d.getTime();
  return Number.isFinite(t) ? t : NaN;
}

function getCreatedTimestamp(lote) {
  // Preferir createdAt si existe
  const tCreated = toTimestamp(lote?.createdAt);
  if (Number.isFinite(tCreated)) return tCreated;

  // Fallback: id con timestamp (lote_1734567890123)
  if (typeof lote?.id === "string" && lote.id.startsWith("lote_")) {
    const n = Number(lote.id.slice(5));
    if (Number.isFinite(n)) return n;
  }

  // Fallback final: fecha de elaboración
  const tFecha = toTimestamp(lote?.fecha);
  if (Number.isFinite(tFecha)) return tFecha;

  return 0;
}

function formatDateTime(value){
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('es-NI');
  } catch {
    return String(value);
  }
}

function buildArchiveSnapshot(lote, deletedAtIso){
  const deletedAt = deletedAtIso || new Date().toISOString();
  const createdAt = lote?.createdAt || (() => {
    const t = getCreatedTimestamp(lote);
    try { return new Date(t || Date.now()).toISOString(); } catch { return ""; }
  })();

  const st = effectiveLoteStatus(lote);
  const sem = st === "EN_EVENTO" ? getLoteSemaforoState(lote) : "";
  const assignedEventId = lote?.assignedEventId != null ? String(lote.assignedEventId).trim() : "";
  const assignedEventName = (lote?.assignedEventName || "").toString().trim();

  // Guardar SOLO el snapshot del evento asignado si existe; si no, no inventar.
  let eventUsageSnap = null;
  if (assignedEventId && lote && typeof lote.eventUsage === 'object' && !Array.isArray(lote.eventUsage)){
    const snap = lote.eventUsage[assignedEventId];
    if (snap && typeof snap === 'object'){
      eventUsageSnap = { [assignedEventId]: snap };
    }
  }

  const salidaPOS = buildLotePOSAvailabilityContract(lote);
  const disponibilidadPOS = salidaPOS.productos.length ? salidaPOS.productos.map((item) => ({ ...item })) : (Array.isArray(lote?.disponibilidadPOS) ? lote.disponibilidadPOS.map((item) => ({ ...item })) : []);
  const contratoPOS = salidaPOS.productos.length
    ? { schema: LOTES_POS_CONTRACT_SCHEMA, fuente: 'lotes', stockKey: 'productId', campos: LOTES_POS_CONTRACT_FIELDS.slice(), legacyFields: ['pulso','media','djeba','litro','galon'], compatibilidadLegacy: true }
    : (lote?.contratoPOS && typeof lote.contratoPOS === 'object' ? { ...lote.contratoPOS } : undefined);

  return {
    archiveId: `arch_${Date.now()}_${String(lote?.id || '')}`,
    originalId: lote?.id,
    codigo: (lote?.codigo || "").toString(),
    createdAt,
    deletedAt,
    statusAtDelete: st,
    semaforoAtDelete: sem,
    // "producto/presentación" => aquí guardamos presentaciones (unidades) + volTotal como resumen
    volTotal: lote?.volTotal ?? "",
    pulso: lote?.pulso ?? "0",
    media: lote?.media ?? "0",
    djeba: lote?.djeba ?? "0",
    litro: lote?.litro ?? "0",
    galon: lote?.galon ?? "0",
    productosProducidos: Array.isArray(lote?.productosProducidos) ? lote.productosProducidos.map((item) => ({ ...item })) : [],
    productosProducidosSchema: lote?.productosProducidosSchema || (Array.isArray(lote?.productosProducidos) ? 1 : undefined),
    contratoLotesDinamicos: lote?.contratoLotesDinamicos && typeof lote.contratoLotesDinamicos === "object"
      ? { ...lote.contratoLotesDinamicos }
      : undefined,
    contratoPOS,
    disponibilidadPOS,
    salidaPOS: salidaPOS.productos.length ? salidaPOS : (lote?.salidaPOS && typeof lote.salidaPOS === 'object' ? { ...lote.salidaPOS } : undefined),
    assignedEventId: assignedEventId || null,
    assignedEventName: assignedEventName || "",
    eventUsage: eventUsageSnap,
  };
}

function archiveLote(lote, deletedAtIso){
  const snapshot = buildArchiveSnapshot(lote, deletedAtIso);
  const hist = loadArchivedLotes();
  hist.unshift(snapshot);
  saveArchivedLotes(hist);
  return snapshot;
}


// --- Estado/asignaci�n de lotes (compat: lotes viejos = DISPONIBLE)
function normLoteStatus(status){
  const s = (status || "").toString().trim().toUpperCase();
  if (!s) return "";
  if (s === "EN EVENTO") return "EN_EVENTO";
  if (s === "EN_EVENTO") return "EN_EVENTO";
  if (s === "DISPONIBLE") return "DISPONIBLE";
  if (s === "CERRADO") return "CERRADO";
  return s;
}

function effectiveLoteStatus(lote){
  const st = normLoteStatus(lote?.status);
  const assigned = lote?.assignedEventId != null && String(lote.assignedEventId).trim() !== "";
  if (st === "CERRADO") return "CERRADO";
  if (assigned) return "EN_EVENTO";
  if (st === "EN_EVENTO") return "EN_EVENTO";
  return "DISPONIBLE";
}

// Semáforo PARCIAL / VENDIDO (solo EN EVENTO)
// Fuente canónica: lote.eventUsage[eventId].remainingTotal
function getLoteSemaforoState(lote){
  // Conservador: si falta data, PARCIAL.
  const eid = (lote?.assignedEventId != null) ? String(lote.assignedEventId).trim() : "";
  if (!eid) return "PARCIAL";
  const eu = (lote && typeof lote.eventUsage === 'object' && !Array.isArray(lote.eventUsage)) ? lote.eventUsage : null;
  if (!eu) return "PARCIAL";
  const snap = eu[eid];
  if (!snap || typeof snap !== 'object') return "PARCIAL";
  const remainingTotal = Number(snap.remainingTotal);
  if (Number.isFinite(remainingTotal) && remainingTotal === 0) return "VENDIDO";
  return "PARCIAL";
}


function normalizeProductIdForPOS(value){
  return String(value ?? '').trim();
}

function round4A33(value){
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

function normalizeOptionalCost(value){
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? round4A33(n) : null;
}

function stableLoteIdForPOS(lote){
  return String(lote?.id || lote?.loteId || lote?.batchId || lote?.batchCode || lote?.codigo || '').trim();
}

function stableLoteCodeForPOS(lote){
  return String(lote?.codigo || lote?.batchCode || lote?.code || stableLoteIdForPOS(lote) || '').trim();
}

function normalizeNumberMapA33(raw, keyNormalizer){
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const normalizeKey = typeof keyNormalizer === 'function' ? keyNormalizer : (k) => String(k || '').trim();
  Object.keys(raw).forEach((k) => {
    const key = normalizeKey(k);
    if (!key) return;
    const n = normalizeQtyValue(raw[k]);
    out[key] = (out[key] || 0) + n;
  });
  return out;
}

function getActiveEventUsageSnapshot(lote){
  const eid = (lote?.assignedEventId != null) ? String(lote.assignedEventId).trim() : '';
  const eu = isPlainObjectA33(lote?.eventUsage) ? lote.eventUsage : null;
  if (!eid || !eu || !isPlainObjectA33(eu[eid])) return null;
  return eu[eid];
}

function buildLetterToProductMapForLote(lote){
  const map = new Map();
  for (const item of getLoteCreatedItems(lote)){
    const letter = normalizeProductLetter(item.Letra || item.letra || item.letter);
    if (!letter) continue;
    const legacy = LEGACY_BY_LETTER[letter] || null;
    const productId = normalizeProductIdForPOS(item.productId ?? item.productoId ?? item.id ?? (legacy ? legacy.legacyId : '') ?? letter);
    map.set(letter, {
      productId: productId || letter,
      nombreSnapshot: String(item.nombreSnapshot || item.nombre || item.name || (legacy ? legacy.nombre : letter)).trim(),
      Letra: letter,
      legacy: !!(item.legacy || legacy),
      legacyId: item.legacyId || (legacy ? legacy.legacyId : ''),
      legacyField: item.legacyField || (legacy ? legacy.field : ''),
    });
  }
  return map;
}

function getSnapshotRemainingInfo(lote){
  const snap = getActiveEventUsageSnapshot(lote);
  const letterMap = buildLetterToProductMapForLote(lote);
  const remainingByLetter = {};
  const remainingByProductId = {};
  let source = '';

  if (snap && isPlainObjectA33(snap.remainingByKey)){
    source = 'eventUsage.remainingByKey';
    const byKey = normalizeNumberMapA33(snap.remainingByKey, (k) => normalizeProductLetter(k));
    Object.keys(byKey).forEach((letter) => {
      if (!letter) return;
      const qty = byKey[letter];
      remainingByLetter[letter] = (remainingByLetter[letter] || 0) + qty;
      const mapped = letterMap.get(letter);
      const pid = normalizeProductIdForPOS(mapped?.productId || (LEGACY_BY_LETTER[letter] ? LEGACY_BY_LETTER[letter].legacyId : '') || letter);
      if (pid) remainingByProductId[pid] = (remainingByProductId[pid] || 0) + qty;
    });
  }

  const productMapSource = snap && (isPlainObjectA33(snap.remainingByProductId) ? snap.remainingByProductId : (isPlainObjectA33(snap.remainingByProduct) ? snap.remainingByProduct : null));
  if (productMapSource){
    source = source || (snap.remainingByProductId ? 'eventUsage.remainingByProductId' : 'eventUsage.remainingByProduct');
    const byProduct = normalizeNumberMapA33(productMapSource, normalizeProductIdForPOS);
    Object.keys(byProduct).forEach((pid) => {
      if (!pid) return;
      remainingByProductId[pid] = (remainingByProductId[pid] || 0) + byProduct[pid];
    });
    for (const [letter, mapped] of letterMap.entries()){
      const pid = normalizeProductIdForPOS(mapped?.productId);
      if (pid && Object.prototype.hasOwnProperty.call(byProduct, pid)){
        remainingByLetter[letter] = (remainingByLetter[letter] || 0) + byProduct[pid];
      }
    }
  }

  return {
    source,
    remainingByLetter,
    remainingByProductId,
    hasLetter: Object.keys(remainingByLetter).length > 0,
    hasProduct: Object.keys(remainingByProductId).length > 0,
  };
}


function buildStoredCostSnapshotMap(lote){
  const map = new Map();
  for (const raw of getRawProducedItemsFromLote(lote)){
    if (!raw || typeof raw !== 'object') continue;
    const letter = normalizeProductLetter(raw.Letra || raw.letra || raw.letter);
    const pid = normalizeProductIdForPOS(raw.productId ?? raw.productoId ?? raw.id);
    const costoUnitario = normalizeOptionalCost(raw.costoUnitario ?? raw.costoReferencial);
    const costoTotal = normalizeOptionalCost(raw.costoTotal);
    if (costoUnitario == null && costoTotal == null) continue;
    const value = { costoUnitario, costoTotal };
    if (pid) map.set(`PID:${pid}`, value);
    if (letter) map.set(`LET:${letter}`, value);
  }
  return map;
}

function buildLotePOSAvailabilityContract(lote){
  const items = getLoteCreatedItems(lote);
  const loteId = stableLoteIdForPOS(lote);
  const loteCodigo = stableLoteCodeForPOS(lote);
  const fecha = normalizeDateYMD(lote?.fecha || lote?.fechaProd || lote?.createdAt) || String(lote?.fecha || '').trim();
  const status = effectiveLoteStatus(lote);
  const remaining = getSnapshotRemainingInfo(lote);
  const storedCostMap = buildStoredCostSnapshotMap(lote);
  const productos = [];
  const producidosPorProductId = {};
  const producidosPorLetra = {};
  const disponiblesPorProductId = {};
  const disponiblesPorLetra = {};

  for (const item of items){
    const letter = normalizeProductLetter(item.Letra || item.letra || item.letter);
    const legacy = LEGACY_BY_LETTER[letter] || null;
    const productId = normalizeProductIdForPOS(item.productId ?? item.productoId ?? item.id ?? (legacy ? legacy.legacyId : '') ?? letter);
    if (!productId || !letter) continue;

    const produced = normalizeQtyValue(item.cantidad ?? item.unidades ?? item.qty ?? item.quantity ?? 0);
    if (!(produced > 0)) continue;

    let available = null;
    let source = 'sin_snapshot';
    if (remaining.hasProduct && Object.prototype.hasOwnProperty.call(remaining.remainingByProductId, productId)){
      available = normalizeQtyValue(remaining.remainingByProductId[productId]);
      source = remaining.source || 'eventUsage.remainingByProductId';
    } else if (remaining.hasLetter && Object.prototype.hasOwnProperty.call(remaining.remainingByLetter, letter)){
      available = normalizeQtyValue(remaining.remainingByLetter[letter]);
      source = remaining.source || 'eventUsage.remainingByKey';
    } else if (status === 'DISPONIBLE'){
      available = produced;
      source = 'lote.disponible';
    } else if (status === 'CERRADO'){
      available = 0;
      source = 'lote.cerrado';
    }

    const storedCost = storedCostMap.get(`PID:${productId}`) || storedCostMap.get(`LET:${letter}`) || null;
    const costoUnitario = storedCost ? storedCost.costoUnitario : null;
    const costoTotalRaw = storedCost ? storedCost.costoTotal : null;
    const costoTotal = costoTotalRaw != null ? costoTotalRaw : (costoUnitario != null ? round4A33(costoUnitario * produced) : null);
    const nombreSnapshot = String(item.nombreSnapshot || item.nombre || item.name || (legacy ? legacy.nombre : productId)).trim();

    const row = {
      schema: LOTES_POS_CONTRACT_SCHEMA,
      productId,
      nombreSnapshot,
      Letra: letter,
      cantidadProducida: produced,
      cantidadDisponible: available,
      cantidadDisponibleExiste: available != null,
      disponibilidadFuente: source,
      loteId,
      loteCodigo,
      loteOrigen: loteCodigo || loteId,
      fecha,
      costoUnitario,
      costoTotal,
      legacy: !!(item.legacy || legacy),
      legacyId: item.legacyId || (legacy ? legacy.legacyId : ''),
      legacyField: item.legacyField || (legacy ? legacy.field : ''),
    };
    productos.push(row);

    producidosPorProductId[productId] = (producidosPorProductId[productId] || 0) + produced;
    producidosPorLetra[letter] = (producidosPorLetra[letter] || 0) + produced;
    if (available != null){
      disponiblesPorProductId[productId] = (disponiblesPorProductId[productId] || 0) + available;
      disponiblesPorLetra[letter] = (disponiblesPorLetra[letter] || 0) + available;
    }
  }

  return {
    schema: LOTES_POS_CONTRACT_SCHEMA,
    fuente: 'lotes',
    stockKey: 'productId',
    loteId,
    loteCodigo,
    batchCode: loteCodigo,
    fecha,
    status,
    assignedEventId: lote?.assignedEventId != null ? String(lote.assignedEventId).trim() : '',
    assignedEventName: String(lote?.assignedEventName || '').trim(),
    campos: LOTES_POS_CONTRACT_FIELDS.slice(),
    legacyFields: ['pulso','media','djeba','litro','galon'],
    compatibilidadLegacy: true,
    productos,
    producidosPorProductId,
    producidosPorLetra,
    disponiblesPorProductId,
    disponiblesPorLetra,
  };
}

function attachPOSAvailabilityContract(out){
  if (!out || typeof out !== 'object') return out;
  const contract = buildLotePOSAvailabilityContract(out);
  if (!contract.productos.length) return out;
  out.contratoPOS = {
    schema: LOTES_POS_CONTRACT_SCHEMA,
    fuente: 'lotes',
    stockKey: 'productId',
    campos: LOTES_POS_CONTRACT_FIELDS.slice(),
    legacyFields: ['pulso','media','djeba','litro','galon'],
    compatibilidadLegacy: true,
  };
  out.disponibilidadPOS = contract.productos.map((item) => ({ ...item }));
  out.salidaPOS = contract;
  return out;
}

function formatPOSAvailabilitySummary(lote){
  const contract = buildLotePOSAvailabilityContract(lote);
  return contract.productos.map((item) => {
    const qty = item.cantidadDisponibleExiste ? item.cantidadDisponible : 'pendiente';
    return `${item.nombreSnapshot || item.productId} [${item.productId}] disp:${qty} prod:${item.cantidadProducida}`;
  }).join(' | ');
}

function buildAllLotesPOSAvailabilityContract(lotes){
  const rows = [];
  const producidosPorProductId = {};
  const disponiblesPorProductId = {};
  const source = Array.isArray(lotes) ? lotes : [];
  for (const lote of source){
    const contract = buildLotePOSAvailabilityContract(lote);
    for (const item of contract.productos){
      rows.push({ ...item });
      producidosPorProductId[item.productId] = (producidosPorProductId[item.productId] || 0) + normalizeQtyValue(item.cantidadProducida);
      if (item.cantidadDisponibleExiste){
        disponiblesPorProductId[item.productId] = (disponiblesPorProductId[item.productId] || 0) + normalizeQtyValue(item.cantidadDisponible);
      }
    }
  }
  return {
    schema: LOTES_POS_CONTRACT_SCHEMA,
    fuente: 'lotes',
    stockKey: 'productId',
    campos: LOTES_POS_CONTRACT_FIELDS.slice(),
    legacyFields: ['pulso','media','djeba','litro','galon'],
    compatibilidadLegacy: true,
    productos: rows,
    producidosPorProductId,
    disponiblesPorProductId,
  };
}

function showLoteDetails(lote) {
  const lines = [];
  const st = effectiveLoteStatus(lote);
  lines.push(`Lote: ${lote.codigo || ""}`);
  lines.push(`Estado: ${st}`);

  const evName = (lote.assignedEventName || "").toString().trim();
  if (evName) lines.push(`Evento asignado: ${evName}`);

  if (lote.closedAt) {
    try {
      const d = new Date(lote.closedAt);
      lines.push(`Cerrado: ${Number.isNaN(d.getTime()) ? lote.closedAt : d.toLocaleString('es-NI')}`);
    } catch {
      lines.push(`Cerrado: ${lote.closedAt}`);
    }
  }

  // Reverso de asignación (airbag anti-errores)
  if (lote.reversedAt) {
    try {
      const d = new Date(lote.reversedAt);
      lines.push(`Reversado: ${Number.isNaN(d.getTime()) ? lote.reversedAt : d.toLocaleString('es-NI')}`);
    } catch {
      lines.push(`Reversado: ${lote.reversedAt}`);
    }
    const rr = (lote.reversedReason || '').toString().trim();
    if (rr) lines.push(`Motivo: ${rr}`);
  }

  // Trazabilidad (lote hijo / sobrante)
  const parentId = (lote.parentLotId || "").toString().trim();
  if (parentId) {
    const all = loadLotes();
    const parent = all.find(l => l && String(l.id) === parentId) || null;
    const pcode = parent ? (parent.codigo || parent.name || parent.nombre || parentId) : parentId;
    lines.push(`Sobrante de: ${pcode}`);
  }
  const srcEv = (lote.sourceEventName || lote.sourceEventId || "").toString().trim();
  if (srcEv) lines.push(`Evento origen: ${srcEv}`);

  lines.push("");
  lines.push(`Fecha de elaboración: ${formatDate(lote.fecha)}`);
  lines.push(`Fecha de caducidad: ${formatDate(lote.caducidad)}`);
  lines.push("");
  lines.push("Volúmenes (ml):");
  lines.push(`  Total: ${lote.volTotal || "0"}`);
  lines.push(`  Vino: ${lote.volVino || "0"}`);
  lines.push(`  Vodka: ${lote.volVodka || "0"}`);
  lines.push(`  Jugo: ${lote.volJugo || "0"}`);
  lines.push(`  Sirope: ${lote.volSirope || "0"}`);
  lines.push(`  Agua: ${lote.volAgua || "0"}`);
  lines.push("");
  lines.push("Productos del lote:");
  const productosCreados = formatLoteProductSummary(lote, { includeLegacy: true, useRemaining: false });
  lines.push(`  ${productosCreados || 'Sin unidades registradas'}`);
  const productosRestantes = formatLoteProductSummary(lote, { includeLegacy: true, useRemaining: true });
  if (productosRestantes && productosRestantes !== productosCreados) {
    lines.push(`  Restante: ${productosRestantes}`);
  }
  const salidaPOSResumen = formatPOSAvailabilitySummary(lote);
  if (salidaPOSResumen) {
    lines.push('');
    lines.push('Salida POS preparada:');
    lines.push(`  ${salidaPOSResumen}`);
  }
  if (lote.notas) {
    lines.push("");
    lines.push("Notas:");
    lines.push(lote.notas);
  }
  alert(lines.join("\n"));
}

function clearForm() {
  const form = $("lote-form");
  form.reset();
  // Restaurar valores por defecto numéricos
  ["pulso", "media", "djeba", "litro", "galon"].forEach((id) => {
    const el = $(id);
    if (el) el.value = "0";
  });
  const today = new Date().toISOString().slice(0, 10);
  $("fecha").value = today;
  $("caducidad").value = calculateCaducidad(today);
  editingId = null;
  editingCtx = null;
  renderDynamicProductInputs(null);
  $("save-btn").textContent = "Guardar lote";
}

function readFormData() {
  const fecha = $("fecha").value;
  const codigo = $("codigo").value.trim();
  const batchCode = canonicalBatchCode(codigo);

  if (!fecha || !codigo) {
    alert("Fecha y código de lote son obligatorios.");
    return null;
  }

  const data = {
    id: editingId || `lote_${Date.now()}`,
    // Identidad estable (nuevo) + canónico para dedupe
    loteId: editingId ? undefined : (batchCode ? `batch_${batchCode}` : undefined),
    batchCode: batchCode || undefined,
    fecha: formatDate(fecha),
    codigo,
    caducidad: $("caducidad").value || calculateCaducidad(fecha),

    volTotal: $("volTotal").value || "",
    volVino: $("volVino").value || "",
    volVodka: $("volVodka").value || "",
    volJugo: $("volJugo").value || "",
    volSirope: $("volSirope").value || "",
    volAgua: $("volAgua").value || "",

    pulso: $("pulso").value || "0",
    media: $("media").value || "0",
    djeba: $("djeba").value || "0",
    litro: $("litro").value || "0",
    galon: $("galon").value || "0",

    notas: $("notas").value.trim(),
  };

  const productosProducidos = buildProducedItemsFromForm(data);
  if (productosProducidos === null) return null;
  data.productosProducidos = productosProducidos;
  if (productosProducidos.length){
    data.productosProducidosSchema = 1;
    data.contratoLotesDinamicos = {
      schema: 1,
      fuente: 'lotes-manual',
      campos: ['productId','nombreSnapshot','Letra','cantidad','cantidadDisponible','loteId','loteCodigo','envaseId','tapaId','fecha','codigo','costoUnitario','costoTotal'],
      legacyFields: ['pulso','media','djeba','litro','galon']
    };
  }

  // Estado inicial (compatibilidad). Solo para lotes nuevos.
  if (!editingId){
    data.status = "DISPONIBLE";
    data.assignedEventId = null;
    data.assignedEventName = "";
    data.assignedAt = null;
  }

  // Mantener createdAt estable (no borrarlo al editar). Agregamos updatedAt opcional.
  if (!editingId) {
    data.createdAt = new Date().toISOString();
  } else {
    data.updatedAt = new Date().toISOString();
  }

  return data;
}

function populateForm(lote) {
  $("fecha").value = formatDate(lote.fecha);
  $("codigo").value = lote.codigo || "";
  $("caducidad").value = formatDate(lote.caducidad);

  $("volTotal").value = lote.volTotal || "";
  $("volVino").value = lote.volVino || "";
  $("volVodka").value = lote.volVodka || "";
  $("volJugo").value = lote.volJugo || "";
  $("volSirope").value = lote.volSirope || "";
  $("volAgua").value = lote.volAgua || "";

  $("pulso").value = lote.pulso ?? "0";
  $("media").value = lote.media ?? "0";
  $("djeba").value = lote.djeba ?? "0";
  $("litro").value = lote.litro ?? "0";
  $("galon").value = lote.galon ?? "0";

  $("notas").value = lote.notas || "";

  editingId = lote.id;
  renderDynamicProductInputs(lote);

  // Contexto de edición (Etapa 2): detectar cambios externos del MISMO lote
  try {
    const { meta } = readLotesAndMetaFresh();
    editingCtx = {
      id: String(lote.id),
      metaRev: meta && typeof meta.rev === 'number' ? meta.rev : 0,
      metaUpdatedAt: meta && meta.updatedAt ? String(meta.updatedAt) : null,
      fingerprint: nonEditableFingerprint(lote)
    };
  } catch (_){
    editingCtx = { id: String(lote.id), metaRev: 0, metaUpdatedAt: null, fingerprint: nonEditableFingerprint(lote) };
  }
  $("save-btn").textContent = "Actualizar lote";
}

function buildLoteRow(lote){
  const tr = document.createElement("tr");

  // Estado y snapshot canónico por evento (para doble línea: Creado + Parcial/restante)
  const st = effectiveLoteStatus(lote);
  const eid = (lote?.assignedEventId != null) ? String(lote.assignedEventId).trim() : "";
  const sem = st === "EN_EVENTO" ? getLoteSemaforoState(lote) : "";
  const eu = (lote && typeof lote.eventUsage === "object" && !Array.isArray(lote.eventUsage)) ? lote.eventUsage : null;
  const snap = (eu && eid) ? eu[eid] : null;
  const remainingByKey = (snap && typeof snap === "object" && snap.remainingByKey && typeof snap.remainingByKey === "object") ? snap.remainingByKey : null;
  const showRemainingLine = (st === "EN_EVENTO" && sem === "PARCIAL" && !!remainingByKey);
  const createdByLetter = getLoteCreatedQuantitiesByLetter(lote);

  const labels = ["Fecha","Código","Vol. ML","P","M","D","L","G","Caducidad"];

  const fields = [
    formatDate(lote.fecha),
    lote.codigo || "",
    lote.volTotal || "",
    displayQtyFromMap(createdByLetter, "P", lote.pulso ?? ""),
    displayQtyFromMap(createdByLetter, "M", lote.media ?? ""),
    displayQtyFromMap(createdByLetter, "D", lote.djeba ?? ""),
    displayQtyFromMap(createdByLetter, "L", lote.litro ?? ""),
    displayQtyFromMap(createdByLetter, "G", lote.galon ?? ""),
    formatDate(lote.caducidad),
  ];

  fields.forEach((value, idx) => {
    const td = document.createElement("td");
    td.setAttribute('data-label', labels[idx] || '');

    // idx: 0 Fecha, 1 Código, 2 VolTotal, 3 Pulso, 4 Media, 5 Djeba, 6 Litro, 7 Galón, 8 Caducidad
    if (idx === 1) {
      td.classList.add("lote-codecell");

      const codeText = document.createElement("div");
      codeText.className = "lote-code-text";
      codeText.textContent = value;
      td.appendChild(codeText);

      const line = document.createElement("div");
      line.className = "lote-status-line";

      const stChip = document.createElement("span");
      stChip.className =
        "chip " +
        (st === "DISPONIBLE"
          ? "chip--available"
          : st === "EN_EVENTO"
          ? "chip--in-event"
          : "chip--closed");
      stChip.textContent = st === "EN_EVENTO" ? "EN EVENTO" : st;
      line.appendChild(stChip);

      // Semáforo de consumo por evento: PARCIAL / VENDIDO
      if (st === "EN_EVENTO") {
        if (showRemainingLine) {
          const br = document.createElement("span");
          br.className = "chip-break";
          br.setAttribute("aria-hidden", "true");
          line.appendChild(br);
        }

        const semChip = document.createElement("span");
        semChip.className = "chip " + (sem === "VENDIDO" ? "chip--sold" : "chip--partial");
        semChip.textContent = sem;
        line.appendChild(semChip);
      }

      // Lote hijo / SOBRANTE (trazabilidad)
      const isChild = !!lote.parentLotId || String(lote.loteType || '').trim().toUpperCase() === 'SOBRANTE';
      if (isChild){
        const childChip = document.createElement('span');
        childChip.className = 'chip chip--child';
        childChip.textContent = String(lote.loteType || '').trim().toUpperCase() === 'SOBRANTE' ? 'SOBRANTE' : 'HIJO';
        line.appendChild(childChip);

        const pid = (lote.parentLotId || '').toString().trim();
        if (pid){
          const p = listView.byId.get(pid) || null;
          const pcode = p ? (p.codigo || p.name || p.nombre || pid).toString() : pid;
          const parentChip = document.createElement('span');
          parentChip.className = 'chip chip--parent';
          parentChip.textContent = 'De: ' + pcode;
          parentChip.title = 'De: ' + pcode;
          line.appendChild(parentChip);
        }
      }

      if (st === "EN_EVENTO" || st === "CERRADO") {
        const evName = (lote.assignedEventName || "").toString().trim();
        if (evName) {
          const evChip = document.createElement("span");
          evChip.className = "chip chip--event";
          evChip.textContent = "Evento: " + evName;
          evChip.title = evName;
          line.appendChild(evChip);
        }
      }

      appendDynamicProductChips(line, lote, false);

      td.appendChild(line);
      tr.appendChild(td);
      return;
    }

    // Columnas de presentaciones: doble línea cuando el lote está PARCIAL y existe snapshot
    if (idx >= 3 && idx <= 7 && showRemainingLine) {
      const k = ["P", "M", "D", "L", "G"][idx - 3];
      const createdSpan = document.createElement("span");
      createdSpan.textContent = String(value ?? "");

      const remVal = hasOwnA33(remainingByKey, k) ? remainingByKey[k] : 0;
      const remainingSpan = document.createElement("span");
      remainingSpan.className = "qty-remaining";
      remainingSpan.textContent = String(remVal ?? "0");

      const stack = document.createElement("div");
      stack.className = "qty-stack";
      stack.appendChild(createdSpan);
      stack.appendChild(remainingSpan);

      td.appendChild(stack);
    } else if (idx === 8) {
      // caducidad: mostrar fecha + badge si vencido
      const dateStr = String(value ?? '');
      const dateSpan = document.createElement('span');
      dateSpan.textContent = dateStr;
      td.appendChild(dateSpan);

      if (dateStr) {
        const today = new Date().toISOString().slice(0, 10);
        if (dateStr < today) {
          const b = document.createElement('span');
          b.className = 'badge';
          b.style.marginLeft = '6px';
          b.textContent = 'Vencido';
          td.appendChild(b);
        }
      }
    } else {
      td.textContent = value;
    }

    if (idx >= 3 && idx <= 7) td.classList.add("col-producto-abbr");

    tr.appendChild(td);
  });

  const actionsTd = document.createElement("td");
  actionsTd.className = "actions-cell";
  actionsTd.setAttribute('data-label', 'Acciones');

  const actionsWrap = document.createElement("div");
  actionsWrap.className = "acciones";

  const viewBtn = document.createElement("button");
  viewBtn.type = "button";
  viewBtn.textContent = "👁";
  viewBtn.title = "Ver";
  viewBtn.setAttribute("aria-label", "Ver");
  viewBtn.className = "btn icon";
  viewBtn.dataset.action = 'view';
  viewBtn.dataset.id = String(lote.id);

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.textContent = "✎";
  editBtn.title = "Editar";
  editBtn.setAttribute("aria-label", "Editar");
  editBtn.className = "btn secondary icon";
  editBtn.dataset.action = 'edit';
  editBtn.dataset.id = String(lote.id);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.textContent = "🗑";
  deleteBtn.title = "Borrar";
  deleteBtn.setAttribute("aria-label", "Borrar");
  deleteBtn.className = "btn danger icon";
  deleteBtn.dataset.action = 'delete';
  deleteBtn.dataset.id = String(lote.id);

  actionsWrap.appendChild(viewBtn);
  actionsWrap.appendChild(editBtn);
  actionsWrap.appendChild(deleteBtn);

  actionsTd.appendChild(actionsWrap);
  tr.appendChild(actionsTd);

  return tr;
}

function buildLoteCard(lote){
  const card = document.createElement('div');
  card.className = 'lote-card';
  card.setAttribute('role','listitem');

  const st = effectiveLoteStatus(lote);
  const eid = (lote?.assignedEventId != null) ? String(lote.assignedEventId).trim() : '';
  const sem = st === 'EN_EVENTO' ? getLoteSemaforoState(lote) : '';
  const eu = (lote && typeof lote.eventUsage === 'object' && !Array.isArray(lote.eventUsage)) ? lote.eventUsage : null;
  const snap = (eu && eid) ? eu[eid] : null;
  const remainingByKey = (snap && typeof snap === 'object' && snap.remainingByKey && typeof snap.remainingByKey === 'object') ? snap.remainingByKey : null;
  const showRemainingLine = (st === 'EN_EVENTO' && sem === 'PARCIAL' && !!remainingByKey);
  const createdByLetter = getLoteCreatedQuantitiesByLetter(lote);

  const head = document.createElement('div');
  head.className = 'lote-card-head';

  const dateEl = document.createElement('div');
  dateEl.className = 'lote-card-date';
  dateEl.textContent = formatDate(lote.fecha);

  const codeEl = document.createElement('div');
  codeEl.className = 'lote-card-code';
  codeEl.textContent = (lote.codigo || '').toString();
  codeEl.title = codeEl.textContent;

  head.appendChild(dateEl);
  head.appendChild(codeEl);
  card.appendChild(head);

  // Chips de estado/evento
  const line = document.createElement('div');
  line.className = 'lote-status-line';

  const stChip = document.createElement('span');
  stChip.className = 'chip ' + (st === 'DISPONIBLE' ? 'chip--available' : st === 'EN_EVENTO' ? 'chip--in-event' : 'chip--closed');
  stChip.textContent = st === 'EN_EVENTO' ? 'EN EVENTO' : st;
  line.appendChild(stChip);

  if (st === 'EN_EVENTO'){
    if (showRemainingLine){
      const br = document.createElement('span');
      br.className = 'chip-break';
      br.setAttribute('aria-hidden','true');
      line.appendChild(br);
    }
    const semChip = document.createElement('span');
    semChip.className = 'chip ' + (sem === 'VENDIDO' ? 'chip--sold' : 'chip--partial');
    semChip.textContent = sem;
    line.appendChild(semChip);
  }

  // Lote hijo / SOBRANTE
  const isChild = !!lote.parentLotId || String(lote.loteType || '').trim().toUpperCase() === 'SOBRANTE';
  if (isChild){
    const childChip = document.createElement('span');
    childChip.className = 'chip chip--child';
    childChip.textContent = String(lote.loteType || '').trim().toUpperCase() === 'SOBRANTE' ? 'SOBRANTE' : 'HIJO';
    line.appendChild(childChip);

    const pid = (lote.parentLotId || '').toString().trim();
    if (pid){
      const p = listView.byId.get(pid) || null;
      const pcode = p ? (p.codigo || p.name || p.nombre || pid).toString() : pid;
      const parentChip = document.createElement('span');
      parentChip.className = 'chip chip--parent';
      parentChip.textContent = 'De: ' + pcode;
      parentChip.title = 'De: ' + pcode;
      line.appendChild(parentChip);
    }
  }

  if (st === 'EN_EVENTO' || st === 'CERRADO'){
    const evName = (lote.assignedEventName || '').toString().trim();
    if (evName){
      const evChip = document.createElement('span');
      evChip.className = 'chip chip--event';
      evChip.textContent = 'Evento: ' + evName;
      evChip.title = evName;
      line.appendChild(evChip);
    }
  }

  appendDynamicProductChips(line, lote, false);
  card.appendChild(line);

  // Mini grid
  const grid = document.createElement('div');
  grid.className = 'lote-card-grid';

  const mk = (key, valNodeOrText) => {
    const box = document.createElement('div');
    box.className = 'mini-kpi';
    const k = document.createElement('div');
    k.className = 'mini-kpi-key';
    k.textContent = String(key);
    const v = document.createElement('div');
    v.className = 'mini-kpi-val';
    if (valNodeOrText && typeof valNodeOrText === 'object' && valNodeOrText.nodeType){
      v.appendChild(valNodeOrText);
    } else {
      v.textContent = String(valNodeOrText ?? '');
    }
    box.appendChild(k);
    box.appendChild(v);
    return box;
  };

  const qtyStack = (created, remaining) => {
    const stack = document.createElement('div');
    stack.className = 'qty-stack';
    const a = document.createElement('span');
    a.textContent = String(created ?? '');
    stack.appendChild(a);
    if (remaining != null){
      const b = document.createElement('span');
      b.className = 'qty-remaining';
      b.textContent = String(remaining ?? '0');
      stack.appendChild(b);
    }
    return stack;
  };

  grid.appendChild(mk('Vol', String(lote.volTotal || '')));

  const keys = legacyLettersForLoteCard(lote);
  const fallbackVals = { P: lote.pulso, M: lote.media, D: lote.djeba, L: lote.litro, G: lote.galon };
  for (const key of keys){
    const createdVal = displayQtyFromMap(createdByLetter, key, fallbackVals[key] ?? '');
    if (showRemainingLine){
      const rem = hasOwnA33(remainingByKey, key) ? remainingByKey[key] : 0;
      grid.appendChild(mk(key, qtyStack(createdVal, formatQtyForDisplay(rem))));
    } else {
      grid.appendChild(mk(key, createdVal));
    }
  }

  const extraItems = getLoteProducedItems(lote, { useRemaining: true }).filter((item) => item && item.letra && !LEGACY_LETTERS.has(item.letra));
  for (const item of extraItems) {
    const val = Number(item.cantidad ?? item.unidades);
    if (Number.isFinite(val) && val > 0) grid.appendChild(mk(item.letra, formatQtyForDisplay(val)));
  }

  const cadStr = formatDate(lote.caducidad);
  const cadWrap = document.createElement('div');
  cadWrap.style.display = 'inline-flex';
  cadWrap.style.alignItems = 'center';
  cadWrap.style.gap = '6px';
  const cadTxt = document.createElement('span');
  cadTxt.textContent = cadStr;
  cadWrap.appendChild(cadTxt);
  if (cadStr){
    const today = new Date().toISOString().slice(0,10);
    if (cadStr < today){
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = 'Vencido';
      cadWrap.appendChild(b);
    }
  }
  grid.appendChild(mk('Cad', cadWrap));

  card.appendChild(grid);

  // Acciones
  const actions = document.createElement('div');
  actions.className = 'lote-card-actions';

  const mkBtn = (txt, title, cls, action) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = txt;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.className = cls;
    b.dataset.action = action;
    b.dataset.id = String(lote.id);
    return b;
  };

  actions.appendChild(mkBtn('👁','Ver','btn icon','view'));
  actions.appendChild(mkBtn('✎','Editar','btn secondary icon','edit'));
  actions.appendChild(mkBtn('🗑','Borrar','btn danger icon','delete'));

  card.appendChild(actions);

  return card;
}

function refreshListCacheIfNeeded(force){
  let fresh;
  try{
    fresh = readLotesAndMetaFresh();
  }catch(_){
    fresh = { lotes: [], meta: { rev: 0 } };
  }
  const meta = fresh && fresh.meta ? fresh.meta : {};
  const rev = (meta && typeof meta.rev === 'number') ? meta.rev : 0;

  if (!force && listView.metaRev === rev && Array.isArray(listView.allSorted) && listView.allSorted.length){
    return;
  }

  const lotes = Array.isArray(fresh.lotes) ? fresh.lotes : [];

  const sorted = [...lotes].sort((a, b) => {
    const ta = getCreatedTimestamp(a);
    const tb = getCreatedTimestamp(b);
    if (ta !== tb) return tb - ta;

    const fa = toTimestamp(a?.fecha);
    const fb = toTimestamp(b?.fecha);
    if (Number.isFinite(fa) && Number.isFinite(fb) && fa !== fb) return fb - fa;
    return (a.codigo || "").localeCompare(b.codigo || "");
  });

  listView.metaRev = rev;
  listView.allSorted = sorted;
  listView.byId = new Map(sorted.map((l) => [String(l?.id), l]));

  // Índice de búsqueda simple (lowercase) para filtrar rápido
  const idx = new Map();
  for (const l of sorted){
    const id = String(l?.id ?? '');
    const dynamicSearch = getLoteProducedItems(l, { useRemaining: false })
      .map((item) => `${item.letra || ''} ${item.nombre || ''} ${item.productId || ''}`.trim())
      .filter(Boolean)
      .join(' ');
    const s = [
      l?.codigo, l?.batchCode, l?.fecha, l?.caducidad,
      l?.assignedEventName, l?.status, l?.loteType, l?.parentLotId,
      dynamicSearch
    ].filter(Boolean).join(' ').toLowerCase();
    idx.set(id, s);
  }
  listView.searchIndex = idx;
}

function applyListFilter(){
  const q = (listView.query || '').toString().trim().toLowerCase();
  if (!q){
    listView.filtered = listView.allSorted;
  } else {
    const out = [];
    for (const l of listView.allSorted){
      const id = String(l?.id ?? '');
      const s = listView.searchIndex.get(id) || '';
      if (s.includes(q)) out.push(l);
    }
    listView.filtered = out;
  }

  // Totales sobre el conjunto filtrado (no solo la página)
  listView.totals = computeRemainingTotals(listView.filtered);
  updateTotalsBarUI(listView.totals);
}

function setListMetaUI(){
  const metaEl = $("list-meta");
  if (!metaEl) return;
  const total = Array.isArray(listView.filtered) ? listView.filtered.length : 0;
  const shown = Math.min(listView.rendered, total);
  const q = (listView.query || '').toString().trim();
  metaEl.textContent = q ? `Mostrando ${shown} de ${total} · filtro: \"${q}\"` : `Mostrando ${shown} de ${total}`;
}

function updateLoadMoreUI(){
  const btn = $("load-more-btn");
  if (!btn) return;
  const total = Array.isArray(listView.filtered) ? listView.filtered.length : 0;
  const remaining = Math.max(0, total - listView.rendered);
  const canMore = remaining > 0;

  btn.style.display = canMore ? 'inline-flex' : 'none';
  btn.disabled = !canMore;
  if (canMore){
    const step = Math.min(listView.pageSize, remaining);
    btn.textContent = `Cargar ${step} más`;
  }
}

function renderTable(opts){
  const options = opts && typeof opts === 'object' ? opts : {};
  const reset = options.reset !== false && !options.append;
  const append = !!options.append;
  const forceRefresh = !!options.forceRefresh;

  const table = $("lotes-table");
  const cards = $("lotes-cards");
  const useCards = !!(cards && isCardMode());

  const tbody = table ? table.querySelector('tbody') : null;

  refreshListCacheIfNeeded(forceRefresh);

  const clearContainers = () => {
    if (tbody) tbody.innerHTML = '';
    if (cards) cards.innerHTML = '';
  };

  const renderMessage = (msg) => {
    if (useCards && cards){
      cards.innerHTML = '';
      const div = document.createElement('div');
      div.textContent = msg;
      div.style.textAlign = 'center';
      div.style.padding = '0.8rem';
      div.style.color = 'var(--color-text-muted)';
      cards.appendChild(div);
      return;
    }
    if (!tbody) return;
    tbody.innerHTML = '';
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 10;
    cell.textContent = msg;
    cell.style.textAlign = 'center';
    cell.style.padding = '0.8rem';
    row.appendChild(cell);
    tbody.appendChild(row);
  };

  // No hay data
  if (!listView.allSorted.length){
    listView.filtered = [];
    listView.wanted = listView.pageSize;
    listView.rendered = 0;
    updateTotalsBarUI(computeRemainingTotals([]));
    clearContainers();
    renderMessage('No hay lotes registrados todavía.');
    updateLegacyTableColumnVisibility([]);
    setListMetaUI();
    updateLoadMoreUI();
    return;
  }

  if (reset){
    listView.wanted = listView.pageSize;
    listView.rendered = 0;
    applyListFilter();
    clearContainers();
  }

  if (append){
    listView.wanted = Math.min(listView.filtered.length, listView.wanted + listView.pageSize);
  }

  // Filtrado vacío
  if (!listView.filtered.length){
    updateTotalsBarUI(computeRemainingTotals([]));
    clearContainers();
    renderMessage('No hay lotes que coincidan con la búsqueda.');
    updateLegacyTableColumnVisibility([]);
    listView.rendered = 0;
    setListMetaUI();
    updateLoadMoreUI();
    return;
  }

  const target = Math.min(listView.filtered.length, listView.wanted);

  const frag = document.createDocumentFragment();
  for (let i = listView.rendered; i < target; i++){
    const item = listView.filtered[i];
    frag.appendChild(useCards ? buildLoteCard(item) : buildLoteRow(item));
  }

  if (useCards && cards){
    cards.appendChild(frag);
  } else if (tbody){
    tbody.appendChild(frag);
  }

  listView.rendered = target;
  updateLegacyTableColumnVisibility(listView.filtered.slice(0, target));
  setListMetaUI();
  updateLoadMoreUI();
}

function exportToCSV() {
  if (isExporting) return;

  const lotes = loadLotes();
  if (!lotes.length) {
    alert("No hay lotes para exportar.");
    return;
  }

  const btn = $("export-btn");
  const prevLabel = btn ? btn.textContent : "";

  isExporting = true;
  setExportHint("Exportando…", false);
  if (btn){
    btn.disabled = true;
    btn.textContent = "Exportando…";
    btn.setAttribute('aria-busy','true');
  }

  try {
    if (typeof XLSX === "undefined") {
      alert("No se pudo exportar: la librería XLSX no está disponible en esta instalación.");
      setExportHint("Error al exportar (XLSX no disponible).", true);
      return;
    }

    const headers = [
      "Fecha",
      "Código",
      "Volumen total",
      "Volumen vino",
      "Volumen vodka",
      "Volumen jugo",
      "Volumen sirope",
      "Volumen agua",
      "Pulso 250 ml",
      "Media 375 ml",
      "Djeba 750 ml",
      "Litro 1000 ml",
      "Galón 3750 ml",
      "Productos dinámicos",
      "Salida POS por productId",
      "Fecha caducidad",
      "Notas",
      "Estado",
      "Evento",
    ];

    const sorted = [...lotes].sort((a, b) => {
      const ta = getCreatedTimestamp(a);
      const tb = getCreatedTimestamp(b);
      if (ta !== tb) return tb - ta;

      const fa = toTimestamp(a?.fecha);
      const fb = toTimestamp(b?.fecha);
      if (Number.isFinite(fa) && Number.isFinite(fb) && fa !== fb) return fb - fa;
      return (a.codigo || "").localeCompare(b.codigo || "");
    });

    const rows = sorted.map((l) => {
      const createdByLetter = getLoteCreatedQuantitiesByLetter(l);
      return [
        formatDate(l.fecha),
        l.codigo || "",
        l.volTotal || "",
        l.volVino || "",
        l.volVodka || "",
        l.volJugo || "",
        l.volSirope || "",
        l.volAgua || "",
        displayQtyFromMap(createdByLetter, "P", l.pulso ?? ""),
        displayQtyFromMap(createdByLetter, "M", l.media ?? ""),
        displayQtyFromMap(createdByLetter, "D", l.djeba ?? ""),
        displayQtyFromMap(createdByLetter, "L", l.litro ?? ""),
        displayQtyFromMap(createdByLetter, "G", l.galon ?? ""),
        formatDynamicProductSummary(l, false),
        formatPOSAvailabilitySummary(l),
        formatDate(l.caducidad),
        (l.notas || "").replace(/\r?\n/g, " "),
        effectiveLoteStatus(l),
        (l.assignedEventName || "").toString().trim(),
      ];
    });

    const aoa = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Lotes");

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `arcano33_lotes_${timestamp}.xlsx`;

    XLSX.writeFile(wb, filename);

    setExportHint("Export listo ✅", false);
    if (btn) btn.textContent = "Export listo ✅";
    setTimeout(() => {
      if (btn && !isExporting){
        btn.textContent = prevLabel || "Exportar a Excel";
      }
      setExportHint("", false);
    }, 1200);
  } catch (err) {
    console.error('Export error', err);
    alert("Error al exportar. Intenta de nuevo.");
    setExportHint("Error al exportar.", true);
  } finally {
    isExporting = false;
    if (btn){
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      if (btn.textContent === "Exportando…") btn.textContent = prevLabel || "Exportar a Excel";
    }
  }
}

// ================================
// Histórico (Etapa 5)
// ================================

function isHistoryModalOpen(){
  const m = $("history-modal");
  return !!(m && m.classList.contains('is-open'));
}

function openHistoryModal(){
  const modal = $("history-modal");
  if (!modal) return;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  renderHistoryModal();

  const inp = $("history-search");
  if (inp) {
    setTimeout(() => inp.focus(), 0);
  }
}

function closeHistoryModal(){
  const modal = $("history-modal");
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
}

function archiveSortTs(a){
  const td = toTimestamp(a?.deletedAt);
  if (Number.isFinite(td)) return td;
  const tc = toTimestamp(a?.createdAt);
  if (Number.isFinite(tc)) return tc;
  // Fallback a ids/otros
  const id = (a?.archiveId || a?.originalId || "").toString();
  const m = id.match(/(\d{10,})/);
  return m ? Number(m[1]) : 0;
}

function makeChip(text, cls){
  const s = document.createElement('span');
  s.className = 'chip ' + (cls || '');
  s.textContent = text;
  return s;
}

function showArchivedDetails(arch){
  if (!arch) return;
  const lines = [];
  lines.push(`Código: ${(arch.codigo || '').toString()}`);
  if (arch.originalId) lines.push(`Lote ID: ${arch.originalId}`);
  if (arch.statusAtDelete) lines.push(`Estado al borrar: ${arch.statusAtDelete}${arch.semaforoAtDelete ? ' · ' + arch.semaforoAtDelete : ''}`);
  if (arch.assignedEventName) lines.push(`Evento: ${arch.assignedEventName}`);
  lines.push(`Creado: ${formatDate(arch.createdAt)}${arch.createdAt ? ' (' + formatDateTime(arch.createdAt) + ')' : ''}`);
  lines.push(`Archivado: ${formatDate(arch.deletedAt)}${arch.deletedAt ? ' (' + formatDateTime(arch.deletedAt) + ')' : ''}`);
  lines.push('');
  lines.push('Productos del lote:');
  const productosArchivados = formatLoteProductSummary(arch, { includeLegacy: true, useRemaining: false });
  lines.push(`  ${productosArchivados || 'Sin unidades registradas'}`);
  if (arch.volTotal != null && String(arch.volTotal).trim() !== '') {
    lines.push(`\nVolumen total (ml): ${arch.volTotal}`);
  }

  // eventUsage (si existe)
  const eu = arch.eventUsage && typeof arch.eventUsage === 'object' && !Array.isArray(arch.eventUsage) ? arch.eventUsage : null;
  const keys = eu ? Object.keys(eu) : [];
  if (keys.length){
    const k = keys[0];
    const snap = eu[k];
    if (snap && typeof snap === 'object'){
      lines.push('');
      lines.push('Uso por evento (snapshot):');
      if (snap.remainingTotal != null) lines.push(`  RemainingTotal: ${snap.remainingTotal}`);
      if (snap.remainingByProduct) {
        try {
          lines.push(`  RemainingByProduct: ${JSON.stringify(snap.remainingByProduct)}`);
        } catch {}
      }
    }
  }

  alert(lines.join('\n'));
}

function renderHistoryModal(){
  const listEl = $("history-list");
  const metaEl = $("history-meta");
  const inp = $("history-search");
  if (!listEl || !metaEl) return;

  const all = loadArchivedLotes();
  const q = (inp ? inp.value : '').toString().trim().toLowerCase();

  const sorted = [...all].sort((a,b) => archiveSortTs(b) - archiveSortTs(a));
  const filtered = q ? sorted.filter((r) => {
    const haystack = [
      r.codigo, r.batchCode, r.fecha, r.caducidad, r.assignedEventName,
      r.statusAtDelete, r.semaforoAtDelete,
      formatLoteProductSummary(r, { includeLegacy: true, useRemaining: false })
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
  }) : sorted;

  metaEl.textContent = q
    ? `Mostrando ${filtered.length} de ${sorted.length} (filtro: "${(inp.value || '').toString().trim()}")`
    : `Total archivados: ${sorted.length}`;

  listEl.innerHTML = '';
  if (!filtered.length){
    const empty = document.createElement('div');
    empty.style.padding = '0.6rem 0.2rem';
    empty.style.color = 'var(--color-text-muted)';
    empty.style.fontSize = '0.82rem';
    empty.textContent = q ? 'Sin resultados.' : 'Aún no hay lotes archivados.';
    listEl.appendChild(empty);
    return;
  }

  for (const arch of filtered){
    const item = document.createElement('div');
    item.className = 'history-item';

    const main = document.createElement('div');
    main.className = 'history-main';

    const code = document.createElement('div');
    code.className = 'history-code';
    code.textContent = (arch.codigo || '').toString();

    const meta = document.createElement('div');
    meta.className = 'history-meta-line';

    // Estado / semáforo
    const st = (arch.statusAtDelete || '').toString().trim().toUpperCase();
    if (st){
      const cls = st === 'DISPONIBLE' ? 'chip--available' : st === 'EN_EVENTO' ? 'chip--in-event' : 'chip--closed';
      meta.appendChild(makeChip(st === 'EN_EVENTO' ? 'EN EVENTO' : st, cls));
    }
    const sem = (arch.semaforoAtDelete || '').toString().trim().toUpperCase();
    if (sem && st === 'EN_EVENTO'){
      meta.appendChild(makeChip(sem, sem === 'VENDIDO' ? 'chip--sold' : 'chip--partial'));
    }

    // Presentaciones/productos compactos desde la lectura canónica (legacy + dinámica sin duplicar)
    const archItems = getLoteCreatedItems(arch).filter((prod) => normalizeQtyValue(prod && prod.cantidad) > 0);
    for (const prod of archItems){
      const letter = normalizeProductLetter(prod.Letra || prod.letra);
      if (!letter) continue;
      meta.appendChild(makeChip(`${letter}: ${formatQtyForDisplay(prod.cantidad)}`, ''));
    }

    // Fechas
    const dates = document.createElement('span');
    dates.textContent = `Creado ${formatDate(arch.createdAt)} · Archivado ${formatDate(arch.deletedAt)}`;
    meta.appendChild(dates);

    // Evento (si existe)
    const ev = (arch.assignedEventName || '').toString().trim();
    if (ev){
      const evSpan = document.createElement('span');
      evSpan.textContent = `Evento: ${ev}`;
      meta.appendChild(evSpan);
    }

    main.appendChild(code);
    main.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'history-actions';

    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'btn secondary icon';
    viewBtn.title = 'Ver';
    viewBtn.setAttribute('aria-label', 'Ver');
    viewBtn.textContent = '👁';
    viewBtn.addEventListener('click', () => showArchivedDetails(arch));

    actions.appendChild(viewBtn);

    item.appendChild(main);
    item.appendChild(actions);

    listEl.appendChild(item);
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js?v=4.20.84&r=12")
      .catch((err) => console.error("SW error", err));
  }
}


try {
  window.A33LotesPOSContract = Object.freeze({
    schema: LOTES_POS_CONTRACT_SCHEMA,
    fields: LOTES_POS_CONTRACT_FIELDS.slice(),
    buildLote: buildLotePOSAvailabilityContract,
    buildAll: buildAllLotesPOSAvailabilityContract,
    getLotes(){ return loadLotes(); },
    getDisponiblePorProductId(){ return buildAllLotesPOSAvailabilityContract(loadLotes()).disponiblesPorProductId; },
  });
} catch(_){ }

document.addEventListener("DOMContentLoaded", () => {
  // Inicializar fecha y caducidad
  const fechaInput = $("fecha");
  const cadInput = $("caducidad");

  const today = new Date().toISOString().slice(0, 10);
  fechaInput.value = today;
  cadInput.value = calculateCaducidad(today);

  fechaInput.addEventListener("change", () => {
    cadInput.value = calculateCaducidad(fechaInput.value);
  });

  $("lote-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (isSavingLote) return; // anti doble-acción

    const saveBtn = $("save-btn");
    const prevLabel = saveBtn ? saveBtn.textContent : "";
    isSavingLote = true;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Guardando...";
    }

    let savedOk = false;
    try {
      const formData = readFormData();
      if (!formData) return;

      // Etapa 2: siempre re-leer la data antes de guardar (evita pisadas Calculadora/POS)
      const fresh = readLotesAndMetaFresh();
      const lotes = Array.isArray(fresh.lotes) ? fresh.lotes : [];

      // Normalizar el patch (tolerar números raros/fechas)
      const data = normalizeLoteRecord(formData) || formData;

      const index = lotes.findIndex((l) => String(l?.id) === String(data.id));
      const cur = index >= 0 ? lotes[index] : null;

      // Resolver identidad estable (sin cambiar id del lote existente)
      const resolvedLoteId = (cur?.loteId || cur?.id)
        ? String(cur.loteId || cur.id)
        : String(data.loteId || data.id || deriveStableLoteId(data));
      data.loteId = resolvedLoteId;
      data.batchCode = canonicalBatchCode(data.codigo) || data.batchCode || undefined;

      // Conflicto obvio: el mismo lote fue modificado en otro módulo/pestaña
      if (index >= 0 && editingCtx && String(editingCtx.id) === String(data.id)) {
        const nowFp = nonEditableFingerprint(cur);
        if (editingCtx.fingerprint && nowFp && editingCtx.fingerprint !== nowFp) {
          alert('Conflicto: este lote cambió desde otro módulo/pestaña. Recarga la página y vuelve a intentar (para evitar pisar cambios).');
          return;
        }
      }

      // Dedupe conservador (NO sobreescribir silenciosamente)
      const newId = String(data.loteId || data.id || "");
      const newBC = String(data.batchCode || "");
      const dup = lotes.find((l, i) => {
        if (index >= 0 && i === index) return false;
        const lid = String(l?.loteId || l?.id || "");
        const bc = String(l?.batchCode || canonicalBatchCode(l?.codigo) || "");
        return (newId && lid && lid === newId) || (newBC && bc && bc === newBC);
      });
      if (dup) {
        const shown = (dup?.codigo || dup?.batchCode || '').toString();
        alert(`Duplicado bloqueado: ya existe un lote con el mismo código/identidad (${shown}).`);
        return;
      }

      if (index >= 0) {
        // Merge conservador: solo campos editables; preservar refs/eventUsage/status/etc.
        const merged = { ...(cur || {}) };
        const editableKeys = [
          'fecha','codigo','caducidad',
          'volTotal','volVino','volVodka','volJugo','volSirope','volAgua',
          'pulso','media','djeba','litro','galon',
          'productosProducidos','productosProducidosSchema','contratoLotesDinamicos','contratoPOS','disponibilidadPOS','salidaPOS',
          'notas','batchCode','loteId'
        ];
        for (const k of editableKeys) {
          if (data[k] !== undefined) merged[k] = data[k];
        }
        // Nunca cambiar el id visible (compat con POS)
        merged.id = cur.id;
        if (!merged.createdAt && data.createdAt) merged.createdAt = data.createdAt;
        merged.updatedAt = new Date().toISOString();
        lotes[index] = normalizeLoteRecord(merged) || merged;
      } else {
        const createdAt = data.createdAt || new Date().toISOString();
        const nuevo = normalizeLoteRecord({ ...data, createdAt }) || { ...data, createdAt };
        lotes.push(nuevo);
      }

      const ok = saveLotes(lotes);
      if (!ok) return;

      renderTable({ reset: true, forceRefresh: true });
      clearForm();
      savedOk = true;
    } finally {
      isSavingLote = false;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = savedOk ? "Guardar lote" : (prevLabel || (editingId ? "Actualizar lote" : "Guardar lote"));
      }
    }
  });

  $("reset-btn").addEventListener("click", () => clearForm());

  // Etapa 3: búsqueda (debounce) + paginación
  const listSearch = $("list-search");
  const clearSearch = $("clear-search-btn");
  const loadMore = $("load-more-btn");

  const applySearch = debounce(() => {
    listView.query = (listSearch ? listSearch.value : '').toString();
    renderTable({ reset: true });
  }, 160);

  if (listSearch) listSearch.addEventListener('input', applySearch);
  if (clearSearch) clearSearch.addEventListener('click', () => {
    if (listSearch) listSearch.value = '';
    listView.query = '';
    renderTable({ reset: true });
    if (listSearch) listSearch.focus();
  });
  if (loadMore) loadMore.addEventListener('click', () => renderTable({ append: true, reset: false }));

  // Etapa 3: delegación de eventos para acciones (menos listeners con data grande)
  const lotesTable = $("lotes-table");
  if (lotesTable) {
    lotesTable.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
      if (!btn) return;

      const action = (btn.dataset.action || '').toString();
      const id = (btn.dataset.id || '').toString();
      if (!action || !id) return;

      const lote = listView.byId.get(id) || null;
      if (!lote) return;

      if (action === 'view') {
        showLoteDetails(lote);
        return;
      }

      if (action === 'edit') {
        populateForm(lote);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      if (action === 'delete') {
        const code = (lote.codigo || '').toString().trim();
        const _stForDelete = effectiveLoteStatus(lote);
        const _semForDelete = _stForDelete === 'EN_EVENTO' ? getLoteSemaforoState(lote) : '';

        if (_semForDelete === 'PARCIAL') {
          const ok = confirm(
            `Este lote aún tiene remanente. No se recomienda borrar.\n\n` +
            `Si estás seguro, toca Aceptar para continuar.`
          );
          if (!ok) return;

          const typed = prompt(
            `Confirmación fuerte: escribe el CÓDIGO del lote para borrar:\n\n${code}`
          );
          if ((typed || '').toString().trim() !== code) {
            alert('Borrado cancelado: el código no coincide.');
            return;
          }
        } else {
          if (!confirm(`¿Borrar el lote ${code}?`)) return;
        }

        // Etapa 5: archivar snapshot antes de removerlo de activos
        const deletedAtIso = new Date().toISOString();
        try { archiveLote(lote, deletedAtIso); } catch (e){ console.warn('No se pudo archivar lote', e); }

        const current = loadLotes().filter((l) => String(l.id) !== String(lote.id));
        saveLotes(current);
        if (editingId === lote.id) clearForm();
        renderTable({ reset: true, forceRefresh: true });

        if (isHistoryModalOpen()) renderHistoryModal();
      }
    });
  }

  // Etapa 3: acciones también en vista tipo tarjeta (iPad-first)
  const lotesCards = $("lotes-cards");
  if (lotesCards) {
    lotesCards.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
      if (!btn) return;

      const action = (btn.dataset.action || '').toString();
      const id = (btn.dataset.id || '').toString();
      if (!action || !id) return;

      const lote = listView.byId.get(id) || null;
      if (!lote) return;

      if (action === 'view') {
        showLoteDetails(lote);
        return;
      }

      if (action === 'edit') {
        populateForm(lote);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      if (action === 'delete') {
        const code = (lote.codigo || '').toString().trim();
        const _stForDelete = effectiveLoteStatus(lote);
        const _semForDelete = _stForDelete === 'EN_EVENTO' ? getLoteSemaforoState(lote) : '';

        if (_semForDelete === 'PARCIAL') {
          const ok = confirm(
            `Este lote aún tiene remanente. No se recomienda borrar.

` +
            `Si estás seguro, toca Aceptar para continuar.`
          );
          if (!ok) return;

          const typed = prompt(
            `Confirmación fuerte: escribe el CÓDIGO del lote para borrar:

${code}`
          );
          if ((typed || '').toString().trim() !== code) {
            alert('Borrado cancelado: el código no coincide.');
            return;
          }
        } else {
          if (!confirm(`¿Borrar el lote ${code}?`)) return;
        }

        const deletedAtIso = new Date().toISOString();
        try { archiveLote(lote, deletedAtIso); } catch (e){ console.warn('No se pudo archivar lote', e); }

        const current = loadLotes().filter((l) => String(l.id) !== String(lote.id));
        saveLotes(current);
        if (editingId === lote.id) clearForm();
        renderTable({ reset: true, forceRefresh: true });

        if (isHistoryModalOpen()) renderHistoryModal();
      }
    });
  }

  // Si cambia el layout (rotación / resize), re-render sin perder filtros.
  try{
    const mq = window.matchMedia('(max-width: 1024px)');
    mq.addEventListener('change', () => renderTable({ reset: true }));
  }catch(_){ }

  $("export-btn").addEventListener("click", () => exportToCSV());

  // Histórico (Etapa 5)
  const histBtn = $("history-btn");
  if (histBtn) histBtn.addEventListener('click', () => openHistoryModal());

  const histClose = $("history-close-btn");
  if (histClose) histClose.addEventListener('click', () => closeHistoryModal());

  const histModal = $("history-modal");
  if (histModal) {
    histModal.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-modal-close') === '1') {
        closeHistoryModal();
      }
    });
  }

  const histSearch = $("history-search");
  if (histSearch) {
    histSearch.addEventListener('input', () => renderHistoryModal());
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isHistoryModalOpen()) {
      closeHistoryModal();
    }
  });

  $("clear-all-btn").addEventListener("click", () => {
    if (!confirm("¿Borrar todos los lotes registrados?")) return;
    A33Storage.removeItem(STORAGE_KEY);
    clearForm();
    renderTable({ reset: true, forceRefresh: true });
  });

  refreshLoteProductCatalog(true)
    .then(() => renderTable({ reset: true, forceRefresh: true }))
    .catch((err) => {
      console.warn('No se pudo refrescar productos dinámicos para Lotes', err);
      updateLoteProductCatalogUI();
      renderTable({ reset: true, forceRefresh: true });
    });
  registerServiceWorker();
});
