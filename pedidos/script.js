const STORAGE_KEY_PEDIDOS = "arcano33_pedidos";
const STORAGE_KEY_PEDIDOS_ARCHIVED = "arcano33_pedidos_archived";
let viewingArchivedId = null;
let editingId = null;
let editingBaseUpdatedAt = null;

// --- Identidad estable del pedido (anti-duplicados por reintentos) ---
const PEDIDOS_DRAFT_KEY = 'a33_pedidos_draft_v1';
let draftPedidoId = null;

function _nowMs(){ return Date.now(); }

function _readDraftPedido(){
  try{
    const raw = (window.A33Storage && typeof A33Storage.getItem === 'function')
      ? A33Storage.getItem(PEDIDOS_DRAFT_KEY, 'local')
      : (window.localStorage ? window.localStorage.getItem(PEDIDOS_DRAFT_KEY) : null);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    const id = String(obj.id || '').trim();
    const createdAt = Number(obj.createdAt || 0);
    if (!id || !createdAt || !isFinite(createdAt)) return null;
    // Expira para evitar estados pegajosos si la pestaña queda abierta días
    const age = _nowMs() - createdAt;
    if (age > 1000*60*60*6) {
      clearDraftPedido();
      return null;
    }
    return { id, createdAt };
  }catch(_){
    return null;
  }
}

function _writeDraftPedido(d){
  try{
    const payload = JSON.stringify(d || {});
    if (window.A33Storage && typeof A33Storage.setItem === 'function') {
      A33Storage.setItem(PEDIDOS_DRAFT_KEY, payload, 'local');
      return;
    }
    if (!window.localStorage) return;
    window.localStorage.setItem(PEDIDOS_DRAFT_KEY, payload);
  }catch(_){ }
}

function clearDraftPedido(){
  draftPedidoId = null;
  try{
    if (window.A33Storage && typeof A33Storage.removeItem === 'function') {
      A33Storage.removeItem(PEDIDOS_DRAFT_KEY, 'local');
      return;
    }
    if (window.localStorage) window.localStorage.removeItem(PEDIDOS_DRAFT_KEY);
  }catch(_){ }
}

function ensureDraftPedidoId(forceNew){
  if (!forceNew && draftPedidoId) return draftPedidoId;
  if (!forceNew){
    const d = _readDraftPedido();
    if (d && d.id){
      draftPedidoId = d.id;
      return draftPedidoId;
    }
  }
  const id = 'p_' + _nowMs().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  draftPedidoId = id;
  _writeDraftPedido({ id, createdAt: _nowMs() });
  return id;
}

function normalizeCodigoKey(code){
  return String(code || '').trim().toLowerCase().replace(/\s+/g,'');
}


// --- Guardado robusto (UI lock + confirmación) ---
let A33Saving = {
  active: false,
  btnStates: new Map(),
  saveBtnText: '',
};

function _setAllButtonsDisabled(disabled){
  const btns = document.querySelectorAll('button');
  btns.forEach((b) => {
    if (!b) return;
    if (disabled) {
      A33Saving.btnStates.set(b, !!b.disabled);
      b.disabled = true;
    } else {
      const was = A33Saving.btnStates.get(b);
      b.disabled = (typeof was === 'boolean') ? was : false;
    }
  });
  if (!disabled) A33Saving.btnStates.clear();
}

function setSavingState(on, label){
  const sb = $('save-btn');
  if (on) {
    if (A33Saving.active) return;
    A33Saving.active = true;
    A33Saving.saveBtnText = sb ? (sb.textContent || '') : '';
    _setAllButtonsDisabled(true);
    if (sb) sb.textContent = label || 'Guardando…';
    showArchivedNotice(label || 'Guardando…');
  } else {
    if (!A33Saving.active) return;
    if (sb && A33Saving.saveBtnText) sb.textContent = A33Saving.saveBtnText;
    _setAllButtonsDisabled(false);
    A33Saving.active = false;
  }
}

async function withSavingLock(label, fn){
  if (A33Saving.active) {
    return { ok:false, message:'Hay un guardado en curso. Esperá un momento e intentá de nuevo.' };
  }
  setSavingState(true, label);
  try{
    const r = await fn();
    return r || { ok:true };
  }catch(e){
    console.error('Error en operación de guardado', e);
    return { ok:false, message:'Ocurrió un error al guardar. No se hicieron cambios.' };
  }finally{
    setSavingState(false);
  }
}

// --- Validaciones mínimas ---
function isValidDateKey(s){
  if (!s) return false;
  const str = String(s).slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str + 'T00:00:00');
  return !Number.isNaN(d.getTime());
}

function readFiniteNumber(id, label, opts){
  const el = $(id);
  const raw = el ? String(el.value ?? '').trim() : '';
  const n = Number(String(raw).replace(',', '.'));
  if (!isFinite(n)) return { ok:false, message: `${label}: número inválido.` };
  if (opts && typeof opts.min === 'number' && n < opts.min) return { ok:false, message: `${label}: no puede ser menor que ${opts.min}.` };
  if (opts && opts.integer && Math.floor(n) !== n) return { ok:false, message: `${label}: debe ser entero.` };
  return { ok:true, value: n };
}

function validatePedidoBeforeSave(payload){
  const errors = [];
  if (!payload) return { ok:false, message:'Datos inválidos.' };

  if (!payload.customer || !payload.customer.name) errors.push('Cliente obligatorio.');
  if (!isValidDateKey(payload.fechaCreacion)) errors.push('Fecha de fabricación inválida (YYYY-MM-DD).');
  if (!isValidDateKey(payload.fechaEntrega)) errors.push('Fecha de entrega inválida (YYYY-MM-DD).');
  if (!payload.codigo) errors.push('Código de pedido obligatorio.');

  // Cantidades (no negativas, al menos una > 0)
  const qty = payload.qty || {};
  const keys = Object.keys(qty || {});
  let sumQty = 0;
  keys.forEach((k) => {
    const v = Number(qty[k]);
    if (!isFinite(v)) errors.push(`Cantidad ${k}: inválida.`);
    else if (v < 0) errors.push(`Cantidad ${k}: no puede ser negativa.`);
    else sumQty += v;
  });

  if (sumQty <= 0 && Array.isArray(payload.productosPedido)) {
    payload.productosPedido.forEach((item) => {
      const v = Number(item && (item.cantidad ?? item.qty ?? 0));
      if (isFinite(v) && v > 0) sumQty += v;
    });
  }

  if (sumQty <= 0) errors.push('Agregá al menos un producto (cantidad > 0).');

  // Totales
  const t = payload.totales || {};
  ['subtotal','envio','descuento','totalPagar','pagoAnticipado','saldoPendiente'].forEach((k) => {
    const v = t[k];
    if (!isFinite(v)) errors.push(`Total ${k}: inválido.`);
  });
  if (isFinite(t.totalPagar) && t.totalPagar < 0) errors.push('Total a pagar no puede ser negativo.');
  if (isFinite(t.descuento) && isFinite(t.subtotal) && isFinite(t.envio) && (t.subtotal - t.descuento + t.envio) < -0.001) {
    errors.push('Descuento demasiado alto: el total queda negativo.');
  }
  if (isFinite(t.pagoAnticipado) && t.pagoAnticipado < 0) errors.push('Pago anticipado no puede ser negativo.');
  if (isFinite(t.pagoAnticipado) && isFinite(t.totalPagar) && (t.pagoAnticipado - t.totalPagar) > 0.001) {
    // Permitimos adelanto por error? mejor bloquear para evitar saldos negativos raros.
    errors.push('Pago anticipado no puede ser mayor que el total a pagar.');
  }

  if (errors.length) {
    return { ok:false, message: 'No se puede guardar:\n- ' + errors.join('\n- ') };
  }
  return { ok:true };
}

// --- Compatibilidad data vieja (defaults sin romper + tolerar extras) ---
function djb2Hash(str){
  let h = 5381;
  const s = String(str || '');
  for (let i=0;i<s.length;i++){
    h = ((h << 5) + h) + s.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16).padStart(8,'0');
}

function getFallbackPedidoId(p){
  const code = (p && p.codigo) ? String(p.codigo) : '';
  const fc = (p && (p.fechaCreacion || p.fecha || p.createdAt)) ? String(p.fechaCreacion || p.fecha || p.createdAt).slice(0,10) : '';
  const fe = (p && p.fechaEntrega) ? String(p.fechaEntrega).slice(0,10) : '';
  const cn = (p && (p.customerName || p.clienteNombre)) ? normalizeCustomerKey(p.customerName || p.clienteNombre) : '';
  const base = ['legacy', code, fc, fe, cn].join('|');
  return 'legacy-' + djb2Hash(base);
}

function coercePedidoForRead(p){
  if (!p || typeof p !== 'object') return null;
  const out = { ...p };

  // Fechas
  out.fechaCreacion = out.fechaCreacion || out.fecha || out.createdAt || out.fechaFabricacion || '';
  out.fechaEntrega = out.fechaEntrega || out.fechaEntregaPedido || out.deliveryDate || out.fechaEnt || '';

  // Cliente compat
  out.customerId = out.customerId || out.clienteId || '';
  out.customerName = out.customerName || out.clienteNombre || out.cliente || '';

  // Prioridad / estado
  out.prioridad = out.prioridad || 'normal';
  const estado = out.estado || (out.entregado ? 'entregado' : 'pendiente');
  out.estado = (String(estado).toLowerCase() === 'entregado') ? 'entregado' : 'pendiente';

  // ID estable para legacy
  if (out.id == null || out.id === '') out.id = getFallbackPedidoId(out);

  // Numéricos (tolerar strings/NaN)
  const numFields = [
    'pulsoCant','mediaCant','djebaCant','litroCant','galonCant',
    'envio','subtotal','descuento','descuentoFijo','descuentoTotal',
    'totalPagar','pagoAnticipado','montoPagado','saldoPendiente',
    'pulsoPrecio','mediaPrecio','djebaPrecio','litroPrecio','galonPrecio',
    'createdAt', 'updatedAt'];
  numFields.forEach((k) => {
    if (out[k] == null || out[k] === '') return;
    const n = Number(String(out[k]).replace(',', '.'));
    if (!isFinite(n)) out[k] = 0;
    else out[k] = n;
  });

  return out;
}

function normalizePedidosList(list){
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((p) => {
    const coerced = coercePedidoForRead(p);
    if (coerced) out.push(coerced);
  });
  return out;
}

function saveArchivedPedidosSafe(list){
  try{
    A33Storage.setItem(STORAGE_KEY_PEDIDOS_ARCHIVED, JSON.stringify(Array.isArray(list) ? list : []));
    return true;
  }catch(e){
    console.error('Error guardando pedidos archivados', e);
    showArchivedNotice('No se pudo archivar (error de almacenamiento).');
    return false;
  }
}

function confirmPedidosPersisted(expectId){
  try{
    const after = loadPedidos();
    return Array.isArray(after) && after.some((p) => String(p.id) === String(expectId));
  }catch(_){
    return false;
  }
}

function confirmArchivedPersisted(expectId){
  try{
    const after = loadArchivedPedidos();
    return Array.isArray(after) && after.some((p) => String(p.id) === String(expectId));
  }catch(_){
    return false;
  }
}

// --- POS: clientes (catálogo compartido con POS) ---
const POS_CUSTOMERS_KEY = 'a33_pos_customersCatalog';
let customersCache = {
  type: 'string',
  raw: [],
  list: [], // [{id,name,isActive}]
  byId: new Map(),
  byNorm: new Map(), // normName -> {id,name,isActive}
};
let currentCustomer = { id: '', name: '' };

// --- POS (fuente única de precios) ---
const POS_DB_NAME = 'a33-pos';
const CANON_GALON_LABEL_PED = 'Galón 3720 ml';
const LEGACY_GALON_PRICE_PED = 800;
const DEFAULT_GALON_PRICE_PED = 900;
let posDB = null;
let posPricesCache = null;
let posPricesLoadedAt = 0;

// Snapshot de precios (del pedido en edición) para fallback si POS no está disponible.
let currentPriceSnapshot = null;

const LEGACY_PRESENTACIONES = [
  { key: 'pulso', label: 'Pulso 250 ml', qtyId: 'pulsoCant', legacyPrice: 'pulsoPrecio', legacyDesc: 'pulsoDesc' },
  { key: 'media', label: 'Media 375 ml', qtyId: 'mediaCant', legacyPrice: 'mediaPrecio', legacyDesc: 'mediaDesc' },
  { key: 'djeba', label: 'Djeba 750 ml', qtyId: 'djebaCant', legacyPrice: 'djebaPrecio', legacyDesc: 'djebaDesc' },
  { key: 'litro', label: 'Litro 1000 ml', qtyId: 'litroCant', legacyPrice: 'litroPrecio', legacyDesc: 'litroDesc' },
  { key: 'galon', label: 'Galón 3720 ml', qtyId: 'galonCant', legacyPrice: 'galonPrecio', legacyDesc: 'galonDesc' },
];
const LEGACY_PRESENTACIONES_BY_KEY = LEGACY_PRESENTACIONES.reduce((acc, p) => { acc[p.key] = p; return acc; }, {});
const CATALOG_DELETED_PRODUCTS_KEY_PED = 'a33_catalog_deleted_products_v1';
let PRESENTACIONES = [];
let pedidosCatalogProductsLoaded = false;
let currentHistoricalPedidoItemsPED = [];

function $(id) {
  return document.getElementById(id);
}


// --- Moneda central A33 (lectura/formato seguro) ---
function getA33PedidosCurrencyState(){
  try{
    if (window.A33Currency && typeof window.A33Currency.getState === 'function'){
      return window.A33Currency.getState();
    }
  }catch(_){ }

  try{
    const key = (window.A33Currency && window.A33Currency.storageKey) || 'suite_a33_currency_settings_v1';
    let raw = '';
    if (window.A33Storage && typeof A33Storage.getItem === 'function') raw = A33Storage.getItem(key, 'local') || '';
    if (!raw && window.localStorage) raw = window.localStorage.getItem(key) || '';
    const parsed = raw ? JSON.parse(raw) : {};
    const rateRaw = String((parsed && parsed.exchangeRate) || '').trim().replace(',', '.');
    const rateNum = (/^\d+(?:\.\d{1,2})?$/.test(rateRaw) && Number(rateRaw) > 0) ? Number(rateRaw) : null;
    return {
      primary: { symbol:'C$', code:'NIO', name:'Córdoba nicaragüense' },
      secondary: { symbol:'US$', code:'USD', name:'Dólar estadounidense' },
      exchangeRate: rateNum,
      hasExchangeRate: !!rateNum,
      exchangeRateText: rateNum ? ('T/C ' + rateNum.toFixed(2)) : 'T/C no configurado'
    };
  }catch(_){
    return {
      primary: { symbol:'C$', code:'NIO', name:'Córdoba nicaragüense' },
      secondary: { symbol:'US$', code:'USD', name:'Dólar estadounidense' },
      exchangeRate: null,
      hasExchangeRate: false,
      exchangeRateText: 'T/C no configurado'
    };
  }
}

function formatA33Cordobas(value){
  try{
    if (window.A33Currency && typeof window.A33Currency.formatCordobas === 'function'){
      return window.A33Currency.formatCordobas(value);
    }
  }catch(_){ }
  const n = Number(String(value ?? 0).replace(',', '.'));
  const safe = Number.isFinite(n) ? n : 0;
  const sign = safe < 0 ? '-' : '';
  const fixed = Math.abs(safe).toFixed(2);
  const parts = fixed.split('.');
  const entero = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return 'C$' + sign + entero + '.' + (parts[1] || '00');
}

function getA33CurrencyNoteText(){
  const st = getA33PedidosCurrencyState();
  const primary = st && st.primary ? st.primary : { symbol:'C$', code:'NIO' };
  const base = 'Moneda: ' + (primary.symbol || 'C$') + ' / ' + (primary.code || 'NIO');
  return st && st.hasExchangeRate
    ? base + ' · ' + (st.exchangeRateText || ('T/C ' + Number(st.exchangeRate || 0).toFixed(2)))
    : base + ' · T/C no configurado en Moneda';
}

function renderPedidosCurrencyReference(){
  const el = $('pedidos-currency-note');
  if (!el) return;
  el.textContent = getA33CurrencyNoteText();
}

// --- Tabla (UX iPad + rendimiento) ---
const A33_TABLE_PAGE_SIZE = 60;
let activeLimit = A33_TABLE_PAGE_SIZE;
let archivedLimit = A33_TABLE_PAGE_SIZE;

function debounce(fn, wait){
  let t = null;
  return function(...args){
    try{ if (t) clearTimeout(t); }catch(_){ }
    t = setTimeout(() => {
      try{ fn.apply(this, args); }catch(_){ }
    }, Math.max(0, Number(wait || 0)));
  };
}

function buildPedidoSearchHaystack(p){
  try{
    const estado = getPedidoEstado(p);
    const cliente = (p && (p.customerName || p.clienteNombre)) ? (p.customerName || p.clienteNombre) : '';
    const codigo = (p && p.codigo) ? p.codigo : '';
    const fechas = [p && p.fechaEntrega, p && p.fechaCreacion, p && p.archivedAt].map(formatDate).join(' ');
    const productText = getPedidoDetailProductLinesPED(p, getPriceSnapshotFromPedido(p))
      .map((item) => [item.label, item.qty].join(' '))
      .join(' ');
    const extra = [p && p.clienteTelefono, p && p.clienteTipo, productText, p && p.lotesRelacionados].filter(Boolean).join(' ');
    return normalizeCustomerKey([cliente, codigo, estado, fechas, extra].join(' '));
  }catch(_){
    return '';
  }
}

function loadPedidos() {
  try {
    if (window.A33Storage && typeof A33Storage.sharedGet === 'function') {
      const list = A33Storage.sharedGet(STORAGE_KEY_PEDIDOS, [], 'local');
      return normalizePedidosList(list);
    }
  } catch (e) {
    console.warn('Error leyendo pedidos (sharedGet)', e);
  }

  try {
    const raw = A33Storage.getItem(STORAGE_KEY_PEDIDOS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizePedidosList(parsed);
  } catch (e) {
    console.error('Error leyendo pedidos', e);
    return [];
  }
}

function savePedidos(list) {
  const arr = Array.isArray(list) ? list : [];

  try {
    if (window.A33Storage && typeof A33Storage.sharedSet === 'function') {
      const r = A33Storage.sharedSet(STORAGE_KEY_PEDIDOS, arr, { source: 'pedidos' });
      if (!r || !r.ok) {
        console.warn('No se pudo guardar pedidos', r);
        showArchivedNotice((r && r.message) ? r.message : 'No se pudo guardar (conflicto). Recarga e intenta de nuevo.');
        return false;
      }
      return true;
    }
  } catch (e) {
    console.warn('Error guardando pedidos (sharedSet)', e);
  }

  try {
    A33Storage.setItem(STORAGE_KEY_PEDIDOS, JSON.stringify(arr));
    return true;
  } catch (e) {
    console.error('Error guardando pedidos', e);
    showArchivedNotice('No se pudo guardar pedidos en este navegador.');
    return false;
  }
}

function loadArchivedPedidos() {
  try {
    const raw = A33Storage.getItem(STORAGE_KEY_PEDIDOS_ARCHIVED);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizePedidosList(parsed);
  } catch (e) {
    console.error("Error leyendo pedidos archivados", e);
    return [];
  }
}

function saveArchivedPedidos(list) {
  return saveArchivedPedidosSafe(list);
}

function showArchivedNotice(msg) {
  const el = $("archived-notice");
  if (!el) return;
  el.textContent = msg || "";
  if (!msg) return;
  clearTimeout(showArchivedNotice._t);
  showArchivedNotice._t = setTimeout(() => {
    try { el.textContent = ""; } catch(_){}
  }, 2400);
}

function showArchivedModeBanner(msg) {
  const el = $("archived-mode-banner");
  if (!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
}


function formatDate(d) {
  if (!d) return "";
  try {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return d;
    return date.toISOString().slice(0, 10);
  } catch {
    return d;
  }
}

function generateCodigo(fechaStr) {
  const base = fechaStr && fechaStr.length >= 10 ? fechaStr.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const fechaCompact = base.replace(/-/g, "");
  const pedidos = loadPedidos().filter(p => p.codigo && p.codigo.includes(fechaCompact));
  const next = (pedidos.length + 1).toString().padStart(3, "0");
  return `P-${fechaCompact}-${next}`;
}

function parseNumber(value) {
  const n = parseFloat(String(value).replace(",", "."));
  return Number.isNaN(n) ? 0 : n;
}

// --- Normalización / mapeo de presentaciones ---
function normName(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    // quitar tildes/diacríticos (compat iOS)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // compactar
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mapProductNameToPresKey(name) {
  const n = normName(name);
  if (!n) return null;
  if (n.includes('pulso')) return 'pulso';
  if (n.includes('media')) return 'media';
  if (n.includes('djeba')) return 'djeba';
  if (n.includes('litro')) return 'litro';
  if (n.includes('galon')) return 'galon';
  return null;
}

function compactProductKeyPED(value){
  return normName(value).replace(/\s+/g, '');
}

function isValidCatalogPricePED(value){
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function scoreCatalogProductPED(product){
  if (!product) return -9999;
  const name = String(product.name || product.nombre || '');
  const key = mapProductNameToPresKey(name);
  const compact = compactProductKeyPED(name);
  let score = 0;
  if (product.active !== false) score += 1000;
  if (isValidCatalogPricePED(product.price)) score += 100;
  if (product.manageStock !== false) score += 15;
  if (key) score += 20;
  if (key === 'galon'){
    if (compact === compactProductKeyPED(CANON_GALON_LABEL_PED)) score += 80;
    if (normName(name).includes('3750')) score += 40;
    if (Number(product.price) === LEGACY_GALON_PRICE_PED) score -= 60;
    if (Number(product.price) === DEFAULT_GALON_PRICE_PED) score += 12;
  }
  try{
    const t = Date.parse(product.updatedAt || product.createdAt || '');
    if (Number.isFinite(t)) score += Math.min(10, t / 1e15);
  }catch(_){ }
  const id = Number(product.id);
  if (Number.isFinite(id)) score -= Math.min(1, id / 1000000);
  return score;
}

function hasOwnPED(obj, key){
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function boolFromCatalogPED(value, fallback){
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const raw = String(value ?? '').trim().toLowerCase();
  if (['true','1','si','sí','yes','y'].includes(raw)) return true;
  if (['false','0','no','n'].includes(raw)) return false;
  return !!fallback;
}

function deletedCatalogProductKeyPED(value){
  return normName(value).replace(/\s+/g, '');
}

function readDeletedProductKeysPED(){
  try{
    const raw = window.localStorage ? localStorage.getItem(CATALOG_DELETED_PRODUCTS_KEY_PED) : null;
    const arr = JSON.parse(raw || '[]');
    return new Set((Array.isArray(arr) ? arr : []).map(v => String(v || '').trim()).filter(Boolean));
  }catch(_){ return new Set(); }
}

function isCatalogProductExactlyDeletedPED(product){
  const deleted = readDeletedProductKeysPED();
  if (!deleted.size) return false;
  const name = String((product && (product.name || product.nombre || product.nombreSnapshot)) || '').trim();
  const key = deletedCatalogProductKeyPED(name);
  return !!(key && deleted.has(key));
}

function productActivePED(product){
  const p = product && typeof product === 'object' ? product : {};
  if (hasOwnPED(p, 'active')) return boolFromCatalogPED(p.active, true);
  if (hasOwnPED(p, 'activo')) return boolFromCatalogPED(p.activo, true);
  if (hasOwnPED(p, 'isActive')) return boolFromCatalogPED(p.isActive, true);
  return true;
}

function productPedidosEnabledPED(product){
  const p = product && typeof product === 'object' ? product : {};
  const pedidoFlags = ['pedido','pedidos','showInPedidos','visiblePedidos','vendiblePedidos','sellInPedidos'];
  for (const key of pedidoFlags){
    if (hasOwnPED(p, key)) return boolFromCatalogPED(p[key], false);
  }

  // Planificación de Pedidos usa productos activos de Catálogos.
  // No depende del checkbox POS/vendible: un producto puede planificarse aunque no se venda directo en POS.
  return true;
}

function productPricePED(product){
  const p = product && typeof product === 'object' ? product : {};
  const n = Number(String(p.price ?? p.precio ?? p.unitPrice ?? p.precioVenta ?? 0).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function productLetterPED(product){
  const p = product && typeof product === 'object' ? product : {};
  const raw = p.letra ?? p.letter ?? p.codigoCorto ?? p.shortCode ?? '';
  return String(raw || '').trim().toUpperCase();
}

function buildProductSnapshotPED(product, fallback){
  const p = product && typeof product === 'object' ? product : {};
  const fb = fallback && typeof fallback === 'object' ? fallback : {};
  const id = String(p.id ?? p.productId ?? p.productoId ?? fb.productId ?? fb.id ?? '').trim();
  const nombre = String(p.name ?? p.nombre ?? p.productName ?? p.nombreSnapshot ?? fb.productName ?? fb.nombre ?? fb.name ?? '').replace(/\s+/g, ' ').trim();
  const precioRaw = p.price ?? p.precio ?? p.unitPrice ?? p.precioVenta ?? fb.unitPriceSnapshot ?? fb.unitPrice ?? fb.precio ?? 0;
  const precio = Number(String(precioRaw ?? 0).replace(',', '.'));
  const activo = productActivePED(p);
  const letra = productLetterPED({ ...fb, ...p });
  const snap = {
    id,
    nombre,
    precio: Number.isFinite(precio) && precio >= 0 ? precio : 0,
    activo
  };
  if (letra) snap.letra = letra;
  return snap;
}

function productStableIdPED(product){
  const p = product && typeof product === 'object' ? product : {};
  const raw = p.id ?? p.productId ?? p.productoId ?? p.key ?? '';
  const name = String(p.name || p.nombre || '').trim();
  const id = String(raw || name || '').trim();
  return id || ('producto-' + deletedCatalogProductKeyPED(name || Math.random()));
}

function domSafeProductIdPED(value){
  return String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'producto';
}

function productToPedidoItemPED(product){
  const p = product && typeof product === 'object' ? product : {};
  const name = String(p.name || p.nombre || '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  if (!productActivePED(p)) return null;
  if (boolFromCatalogPED(p.deleted ?? p.borrado ?? p.isDeleted, false)) return null;
  if (!productPedidosEnabledPED(p)) return null;
  if (isCatalogProductExactlyDeletedPED(p)) return null;

  const productId = productStableIdPED(p);
  const productKey = 'product:' + productId;
  const domId = domSafeProductIdPED(productId);
  const legacyKey = mapProductNameToPresKey(name) || '';
  const legacy = legacyKey ? LEGACY_PRESENTACIONES_BY_KEY[legacyKey] : null;

  return {
    key: productKey,
    productId,
    label: name,
    price: productPricePED(p),
    letter: productLetterPED(p),
    qtyId: 'pedidoProductQty_' + domId,
    subtotalId: 'pedidoProductSubtotal_' + domId,
    legacyKey,
    legacyPrice: legacy ? legacy.legacyPrice : '',
    legacyDesc: legacy ? legacy.legacyDesc : '',
    source: 'catalog',
    rawProduct: p
  };
}

function sortPedidoProductItemsPED(a, b){
  const legacyOrder = { pulso:1, media:2, djeba:3, litro:4, galon:5 };
  const oa = legacyOrder[a && a.legacyKey] || 99;
  const ob = legacyOrder[b && b.legacyKey] || 99;
  if (oa !== ob) return oa - ob;
  return String((a && a.label) || '').localeCompare(String((b && b.label) || ''), 'es-NI', { sensitivity:'base' });
}

async function getPedidosCatalogProductsSafe(){
  const rows = await getAllPosProductsSafe();
  const candidates = [];
  for (const p of (Array.isArray(rows) ? rows : [])){
    const item = productToPedidoItemPED(p);
    if (!item) continue;
    item.__score = scoreCatalogProductPED(item.rawProduct);
    candidates.push(item);
  }

  candidates.sort((a, b) => (Number(b.__score || 0) - Number(a.__score || 0)));

  const usedIds = new Set();
  const usedNames = new Set();
  const usedLetters = new Set();
  const out = [];

  candidates.forEach((item) => {
    const idKey = String(item.productId || item.key || '').trim();
    const nameKey = compactProductKeyPED(item.label || '');
    const letterKey = String(item.letter || '').trim().toUpperCase();

    if (idKey && usedIds.has(idKey)) return;
    if (nameKey && usedNames.has(nameKey)) return;
    if (letterKey && usedLetters.has(letterKey)) return;

    if (idKey) usedIds.add(idKey);
    if (nameKey) usedNames.add(nameKey);
    if (letterKey) usedLetters.add(letterKey);
    out.push(item);
  });

  return out.sort(sortPedidoProductItemsPED).map((item) => {
    try{ delete item.__score; }catch(_){ }
    return item;
  });
}

function setPedidosProductsStatus(message, kind){
  const el = $('pedidos-products-status');
  if (!el) return;
  el.textContent = message || '';
  el.className = 'hint hint-small' + (kind ? (' ' + kind) : '');
}

function updateLineSubtotalPED(pres, unit){
  const out = pres && pres.subtotalId ? $(pres.subtotalId) : null;
  if (!out) return;
  const qty = parseNumber($(pres.qtyId)?.value || 0);
  out.textContent = formatA33Cordobas((qty || 0) * (Number(unit || pres.price || 0) || 0));
}

function getHistoricalPedidoItemIdPED(item){
  const it = item && typeof item === 'object' ? item : {};
  const raw = it.productId ?? it.productoId ?? it.id ?? it.productKey ?? it.key ?? it.productName ?? it.nombreSnapshot ?? it.nombre ?? it.name ?? '';
  return String(raw || '').trim();
}

function getPedidoItemQtyPED(item){
  return parseNumber(item && (item.qty ?? item.cantidad ?? item.quantity ?? item.unidades ?? 0));
}

function getPedidoItemUnitPricePED(item){
  const raw = item && (item.unitPriceSnapshot ?? item.unitPrice ?? item.precioUnitario ?? item.price ?? item.precio ?? 0);
  const n = parseNumber(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function getPedidoItemNamePED(item){
  const it = item && typeof item === 'object' ? item : {};
  return String(it.productName ?? it.nombreSnapshot ?? it.nombre ?? it.name ?? (it.productSnapshot && (it.productSnapshot.nombre || it.productSnapshot.name)) ?? 'Producto').replace(/\s+/g, ' ').trim() || 'Producto';
}

function normalizePedidoItemForStoragePED(item, fallback){
  const it = item && typeof item === 'object' ? item : {};
  const fb = fallback && typeof fallback === 'object' ? fallback : {};
  const productId = String(it.productId ?? it.productoId ?? fb.productId ?? fb.id ?? '').trim();
  const productKey = String(it.productKey ?? it.key ?? (productId ? ('product:' + productId) : '')).trim();
  const productName = getPedidoItemNamePED({ ...fb, ...it });
  const qty = getPedidoItemQtyPED(it);
  const unitPriceSnapshot = getPedidoItemUnitPricePED({ ...fb, ...it });
  const productSnapshot = buildProductSnapshotPED((it.productSnapshot && typeof it.productSnapshot === 'object') ? it.productSnapshot : {}, {
    productId,
    productName,
    unitPriceSnapshot,
    letra: it.letra ?? it.letter ?? fb.letra ?? fb.letter ?? ''
  });
  const subtotal = qty * unitPriceSnapshot;
  const legacyKey = String(it.legacyKey ?? it.legacyId ?? fb.legacyKey ?? '').trim();
  return {
    productId,
    productKey,
    productName,
    qty,
    unitPriceSnapshot,
    subtotal,
    productSnapshot,

    // Compatibilidad interna/exportaciones anteriores
    nombreSnapshot: productName,
    cantidad: qty,
    unitPrice: unitPriceSnapshot,
    precioUnitario: unitPriceSnapshot,
    legacyKey,
    source: it.source || fb.source || 'catalog'
  };
}

function renderHistoricalPedidoRowsPED(tbody){
  const rows = Array.isArray(currentHistoricalPedidoItemsPED) ? currentHistoricalPedidoItemsPED : [];
  rows.forEach((raw, idx) => {
    const item = normalizePedidoItemForStoragePED(raw);
    const qty = getPedidoItemQtyPED(item);
    if (!(qty > 0)) return;

    const tr = document.createElement('tr');
    tr.className = 'pedido-product-historical-row';
    tr.dataset.historical = '1';

    const nameTd = document.createElement('td');
    nameTd.className = 'product-name-cell';
    nameTd.textContent = getPedidoItemNamePED(item) + ' · Conservado';
    tr.appendChild(nameTd);

    const priceTd = document.createElement('td');
    priceTd.textContent = formatA33Cordobas(getPedidoItemUnitPricePED(item));
    tr.appendChild(priceTd);

    const qtyTd = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.value = String(qty || 0);
    input.className = 'a33-num pedido-product-qty';
    input.inputMode = 'numeric';
    input.readOnly = true;
    input.setAttribute('aria-label', 'Cantidad conservada');
    input.dataset.historicalIndex = String(idx);
    qtyTd.appendChild(input);
    tr.appendChild(qtyTd);

    const subTd = document.createElement('td');
    const subSpan = document.createElement('span');
    subSpan.className = 'line-subtotal';
    subSpan.textContent = formatA33Cordobas(qty * getPedidoItemUnitPricePED(item));
    subTd.appendChild(subSpan);
    tr.appendChild(subTd);

    tbody.appendChild(tr);
  });
}

function renderPedidosProductRows(items){
  const tbody = $('presentaciones-body') || (document.querySelector('#presentaciones-table tbody'));
  if (!tbody) return;
  tbody.innerHTML = '';

  const list = Array.isArray(items) ? items : [];
  const historicalCount = (Array.isArray(currentHistoricalPedidoItemsPED) ? currentHistoricalPedidoItemsPED : []).filter(it => getPedidoItemQtyPED(it) > 0).length;
  if (!list.length && !historicalCount){
    const tr = document.createElement('tr');
    tr.className = 'pedidos-products-empty';
    const td = document.createElement('td');
    td.colSpan = 4;
    td.textContent = 'No hay productos activos disponibles en Catálogos.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    setPedidosProductsStatus('Agregá o activá productos vendibles en Catálogos para crear pedidos.', 'warn');
    return;
  }

  if (list.length){
    setPedidosProductsStatus(list.length + ' producto' + (list.length === 1 ? '' : 's') + ' activo' + (list.length === 1 ? '' : 's') + ' disponible' + (list.length === 1 ? '' : 's') + '.', '');
  } else {
    setPedidosProductsStatus('Este pedido conserva productos anteriores. Agregá productos activos en Catálogos para nuevos pedidos.', 'warn');
  }

  list.forEach((pres) => {
    const tr = document.createElement('tr');
    tr.dataset.productKey = pres.key;
    tr.dataset.productId = pres.productId || '';

    const nameTd = document.createElement('td');
    nameTd.className = 'product-name-cell';
    nameTd.textContent = pres.label || 'Producto';
    tr.appendChild(nameTd);

    const priceTd = document.createElement('td');
    priceTd.textContent = formatA33Cordobas(pres.price || 0);
    tr.appendChild(priceTd);

    const qtyTd = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.id = pres.qtyId;
    input.min = '0';
    input.step = '1';
    input.value = '0';
    input.className = 'a33-num pedido-product-qty';
    input.dataset.a33Default = '0';
    input.dataset.productKey = pres.key;
    input.inputMode = 'numeric';
    input.addEventListener('focus', () => {
      try{ setTimeout(() => input.select(), 0); }catch(_){ }
    });
    input.addEventListener('input', () => {
      calcularTotalesDesdeFormulario().catch(() => {
        updateLineSubtotalPED(pres, pres.price);
      });
    });
    input.addEventListener('change', () => {
      calcularTotalesDesdeFormulario().catch(() => {});
    });
    qtyTd.appendChild(input);
    tr.appendChild(qtyTd);

    const subTd = document.createElement('td');
    const subSpan = document.createElement('span');
    subSpan.id = pres.subtotalId;
    subSpan.className = 'line-subtotal';
    subSpan.textContent = formatA33Cordobas(0);
    subTd.appendChild(subSpan);
    tr.appendChild(subTd);

    tbody.appendChild(tr);
  });

  renderHistoricalPedidoRowsPED(tbody);
}

async function refreshPedidosProductCatalog(force){
  if (pedidosCatalogProductsLoaded && !force) return PRESENTACIONES;
  try{
    const items = await getPedidosCatalogProductsSafe();
    PRESENTACIONES = Array.isArray(items) ? items : [];
    pedidosCatalogProductsLoaded = true;
    renderPedidosProductRows(PRESENTACIONES);
  }catch(e){
    console.warn('Pedidos: no se pudieron leer productos de Catálogos', e);
    PRESENTACIONES = [];
    pedidosCatalogProductsLoaded = true;
    renderPedidosProductRows([]);
  }
  return PRESENTACIONES;
}

function getPedidoProductItemsArray(pedido){
  const p = pedido && typeof pedido === 'object' ? pedido : {};
  const candidates = [p.items, p.productosPedido, p.pedidoItems, p.itemsPedido, p.productos];
  let firstEmpty = null;
  for (const raw of candidates){
    if (!Array.isArray(raw)) continue;
    if (raw.length) return raw;
    if (!firstEmpty) firstEmpty = raw;
  }
  return firstEmpty || [];
}

function itemMatchesPresentationPED(item, pres){
  if (!item || !pres) return false;
  const pid = String(item.productId ?? item.productoId ?? item.id ?? '').trim();
  const pkey = String(item.productKey ?? item.key ?? '').trim();
  const legacy = String(item.legacyKey ?? item.legacyId ?? '').trim();
  return (!!pid && pid === String(pres.productId || '').trim())
    || (!!pkey && pkey === pres.key)
    || (!!legacy && !!pres.legacyKey && legacy === pres.legacyKey);
}

function getPedidoQuantityForPresentation(pedido, pres){
  const items = getPedidoProductItemsArray(pedido);
  for (const item of items){
    if (!itemMatchesPresentationPED(item, pres)) continue;
    const qty = getPedidoItemQtyPED(item);
    if (qty > 0) return qty;
  }
  if (pres && pres.legacyKey){
    const legacy = LEGACY_PRESENTACIONES_BY_KEY[pres.legacyKey];
    if (legacy && pedido && pedido[legacy.qtyId] != null) return parseNumber(pedido[legacy.qtyId]);
  }
  if (pres && pedido && pedido[pres.qtyId] != null) return parseNumber(pedido[pres.qtyId]);
  return 0;
}

function pushHistoricalPedidoItemPED(out, seen, item){
  const normalized = normalizePedidoItemForStoragePED(item, item && item.productSnapshot);
  const qty = getPedidoItemQtyPED(normalized);
  if (!(qty > 0)) return;
  const idKey = String(normalized.productId || normalized.productKey || '').trim();
  const nameKey = compactProductKeyPED(normalized.productName || normalized.nombreSnapshot || '');
  const uniq = idKey || nameKey;
  if (uniq && seen.has(uniq)) return;
  if (uniq) seen.add(uniq);
  out.push(normalized);
}

function getHistoricalItemsForPedidoFormPED(pedido){
  const items = getPedidoProductItemsArray(pedido);
  const out = [];
  const seen = new Set();
  for (const item of items){
    const qty = getPedidoItemQtyPED(item);
    if (!(qty > 0)) continue;
    const matchesActive = (Array.isArray(PRESENTACIONES) ? PRESENTACIONES : []).some((pres) => itemMatchesPresentationPED(item, pres));
    if (matchesActive) continue;
    pushHistoricalPedidoItemPED(out, seen, item);
  }

  LEGACY_PRESENTACIONES.forEach((pres) => {
    const qty = parseNumber(pedido && pedido[pres.qtyId] != null ? pedido[pres.qtyId] : 0);
    if (!(qty > 0)) return;
    const activeMatch = (Array.isArray(PRESENTACIONES) ? PRESENTACIONES : []).some((p) => p && p.legacyKey === pres.key);
    if (activeMatch) return;
    const unit = parseNumber((pedido && pedido[pres.legacyPrice] != null) ? pedido[pres.legacyPrice] : 0);
    pushHistoricalPedidoItemPED(out, seen, {
      productId: '',
      productKey: 'legacy:' + pres.key,
      productName: pres.label,
      qty,
      unitPriceSnapshot: unit,
      subtotal: qty * unit,
      productSnapshot: { id:'', nombre: pres.label, precio: unit, activo: false },
      legacyKey: pres.key,
      source: 'legacy'
    });
  });

  return out;
}

function setPedidoProductQuantitiesFromPedido(pedido){
  PRESENTACIONES.forEach((pres) => {
    const el = $(pres.qtyId);
    if (!el) return;
    el.value = String(getPedidoQuantityForPresentation(pedido || {}, pres) || 0);
    updateLineSubtotalPED(pres, pres.price);
  });
}

function resetPedidoProductQuantities(){
  currentHistoricalPedidoItemsPED = [];
  renderPedidosProductRows(PRESENTACIONES);
  PRESENTACIONES.forEach((pres) => {
    const el = $(pres.qtyId);
    if (el) el.value = '0';
    updateLineSubtotalPED(pres, pres.price);
  });
}

function readPedidoProductsFromForm(){
  if ((!Array.isArray(PRESENTACIONES) || !PRESENTACIONES.length) && (!Array.isArray(currentHistoricalPedidoItemsPED) || !currentHistoricalPedidoItemsPED.length)){
    return { ok:false, message:'No hay productos activos disponibles para crear el pedido.' };
  }
  const qtyByKey = {};
  const legacyQty = { pulso:0, media:0, djeba:0, litro:0, galon:0 };
  const items = [];

  for (const pres of PRESENTACIONES){
    const q = readFiniteNumber(pres.qtyId, pres.label || 'Producto', { min:0, integer:true });
    if (!q.ok) return q;
    qtyByKey[pres.key] = q.value;
    if (pres.legacyKey && hasOwnPED(legacyQty, pres.legacyKey)) legacyQty[pres.legacyKey] += q.value;
    if (q.value > 0){
      const unitPriceSnapshot = Number(pres.price || 0) || 0;
      const item = normalizePedidoItemForStoragePED({
        productId: pres.productId || '',
        productKey: pres.key,
        productName: pres.label || '',
        qty: q.value,
        unitPriceSnapshot,
        subtotal: q.value * unitPriceSnapshot,
        productSnapshot: buildProductSnapshotPED(pres.rawProduct || {}, {
          productId: pres.productId || '',
          productName: pres.label || '',
          unitPriceSnapshot,
          letra: pres.letter || ''
        }),
        legacyKey: pres.legacyKey || '',
        source: 'catalog'
      });
      items.push(item);
    }
  }

  (Array.isArray(currentHistoricalPedidoItemsPED) ? currentHistoricalPedidoItemsPED : []).forEach((raw) => {
    const item = normalizePedidoItemForStoragePED(raw, raw && raw.productSnapshot);
    const qty = getPedidoItemQtyPED(item);
    if (!(qty > 0)) return;
    items.push({ ...item, source: item.source || 'snapshot' });
    if (item.legacyKey && hasOwnPED(legacyQty, item.legacyKey)) legacyQty[item.legacyKey] += qty;
  });

  const seen = new Set();
  const deduped = [];
  items.forEach((item) => {
    const key = String(item.productId || item.productKey || '').trim() || compactProductKeyPED(item.productName || item.nombreSnapshot || '');
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    deduped.push(item);
  });

  return { ok:true, qtyByKey, legacyQty, items: deduped };
}

function buildLegacyUnitPricesFromSelectionPED(selection, unitPricesUsed){
  const out = { pulso:0, media:0, djeba:0, litro:0, galon:0 };
  for (const pres of PRESENTACIONES){
    if (!pres.legacyKey || !hasOwnPED(out, pres.legacyKey)) continue;
    const qty = selection && selection.qtyByKey ? Number(selection.qtyByKey[pres.key] || 0) : 0;
    if (qty <= 0 && out[pres.legacyKey] > 0) continue;
    const unit = Number((unitPricesUsed && unitPricesUsed[pres.key]) ?? pres.price ?? 0);
    out[pres.legacyKey] = Number.isFinite(unit) ? unit : 0;
  }

  // Si el pedido conserva productos históricos/legacy no visibles como opción nueva,
  // mantener también su precio snapshot en los campos legacy de compatibilidad.
  const items = selection && Array.isArray(selection.items) ? selection.items : [];
  items.forEach((item) => {
    const legacyKey = String(item && (item.legacyKey || item.legacyId) || '').trim();
    if (!legacyKey || !hasOwnPED(out, legacyKey)) return;
    const qty = getPedidoItemQtyPED(item);
    if (!(qty > 0)) return;
    const unit = getPedidoItemUnitPricePED(item);
    if (Number.isFinite(unit) && unit >= 0 && (!out[legacyKey] || out[legacyKey] <= 0)) out[legacyKey] = unit;
  });
  return out;
}

function enrichPedidoItemsWithCalculatedPricesPED(items, unitPricesUsed){
  return (Array.isArray(items) ? items : []).map((item) => {
    const key = item.productKey || item.key || '';
    const unit = Number((unitPricesUsed && unitPricesUsed[key]) ?? item.unitPriceSnapshot ?? item.unitPrice ?? 0) || 0;
    const qty = Number(item.qty ?? item.cantidad ?? 0) || 0;
    return normalizePedidoItemForStoragePED({ ...item, unitPriceSnapshot: unit, unitPrice: unit, subtotal: qty * unit });
  });
}

function getPedidoDetailProductLinesPED(p, snap){
  const out = [];
  const seen = new Set();
  const priceSnap = (snap && typeof snap === 'object') ? snap : getPriceSnapshotFromPedido(p);

  function pushLine(raw, fallback){
    const item = normalizePedidoItemForStoragePED(raw, fallback || (raw && raw.productSnapshot));
    const qty = getPedidoItemQtyPED(item);
    if (!(qty > 0)) return;

    const key = String(item.productKey || item.key || '').trim();
    const pid = String(item.productId || item.productoId || '').trim();
    const legacyKey = String(item.legacyKey || item.legacyId || '').trim();
    const name = getPedidoItemNamePED(item);
    const uniq = key || (pid ? ('product:' + pid) : '') || (legacyKey ? ('legacy:' + legacyKey) : '') || compactProductKeyPED(name);
    if (uniq && seen.has(uniq)) return;
    if (uniq) seen.add(uniq);

    let unit = null;
    if (key && priceSnap && typeof priceSnap[key] === 'number') unit = priceSnap[key];
    if ((unit == null || !isFinite(unit)) && pid && priceSnap && typeof priceSnap['product:' + pid] === 'number') unit = priceSnap['product:' + pid];
    if ((unit == null || !isFinite(unit)) && legacyKey && priceSnap && typeof priceSnap[legacyKey] === 'number') unit = priceSnap[legacyKey];
    if (unit == null || !isFinite(unit)) unit = getPedidoItemUnitPricePED(item);
    unit = Number.isFinite(Number(unit)) ? Number(unit) : 0;

    out.push({
      label: name,
      qty,
      unit,
      subtotal: qty * unit,
      source: item.source || (legacyKey ? 'legacy' : 'snapshot'),
      legacyKey
    });
  }

  const items = getPedidoProductItemsArray(p);
  if (items.length){
    items.forEach((item) => pushLine(item, item && item.productSnapshot));
  }

  // Compatibilidad: si no hubo items útiles, leer campos legacy fijos.
  if (!out.length){
    LEGACY_PRESENTACIONES.forEach((pres) => {
      const cant = parseNumber(p && p[pres.qtyId] != null ? p[pres.qtyId] : 0);
      if (!(cant > 0)) return;
      let unit = priceSnap && typeof priceSnap[pres.key] === 'number' ? priceSnap[pres.key] : null;
      if ((unit == null || !isFinite(unit)) && p && p[pres.legacyPrice] != null) unit = parseNumber(p[pres.legacyPrice]);
      pushLine({
        productId: '',
        productKey: 'legacy:' + pres.key,
        productName: pres.label,
        qty: cant,
        unitPriceSnapshot: Number.isFinite(Number(unit)) ? Number(unit) : 0,
        productSnapshot: { id:'', nombre: pres.label, precio: Number.isFinite(Number(unit)) ? Number(unit) : 0, activo:false },
        legacyKey: pres.key,
        source: 'legacy'
      });
    });
  }

  return out;
}

function getPedidoSubtotalFromLinesPED(lines){
  return (Array.isArray(lines) ? lines : []).reduce((sum, item) => {
    const sub = Number(item && item.subtotal);
    if (Number.isFinite(sub)) return sum + sub;
    const qty = Number(item && item.qty) || 0;
    const unit = Number(item && item.unit) || 0;
    return sum + (qty * unit);
  }, 0);
}

function getPedidoTotalsForDisplayPED(p){
  const lines = getPedidoDetailProductLinesPED(p, getPriceSnapshotFromPedido(p));
  const subtotalLines = getPedidoSubtotalFromLinesPED(lines);
  const subtotal = (p && typeof p.subtotal === 'number') ? p.subtotal
    : ((p && typeof p.subtotalPresentaciones === 'number') ? p.subtotalPresentaciones : subtotalLines);
  const descuento = (p && p.descuento != null) ? p.descuento
    : ((p && p.descuentoFijo != null) ? p.descuentoFijo
    : (p && p.descuentoTotal != null ? p.descuentoTotal : 0));
  const envio = (p && typeof p.envio === 'number') ? p.envio : parseNumber(p && p.envio);
  const total = (p && typeof p.totalPagar === 'number') ? p.totalPagar : (subtotal - parseNumber(descuento) + (envio || 0));
  const pagoAnt = (p && p.pagoAnticipado != null) ? p.pagoAnticipado : (p && p.montoPagado != null ? p.montoPagado : 0);
  const saldo = (p && typeof p.saldoPendiente === 'number') ? p.saldoPendiente : (total - parseNumber(pagoAnt));
  return { lines, subtotal, descuento: parseNumber(descuento), envio: envio || 0, total, pagoAnt: parseNumber(pagoAnt), saldo };
}

function buildPedidoProductsExportTextPED(p){
  const t = getPedidoTotalsForDisplayPED(p);
  if (!t.lines.length) return '';
  return t.lines.map((item) => {
    const qty = Number(item.qty || 0);
    const unit = Number(item.unit || 0);
    const subtotal = Number(item.subtotal != null ? item.subtotal : (qty * unit));
    return `${item.label}: ${qty} x ${unit.toFixed(2)} = ${subtotal.toFixed(2)}`;
  }).join(' | ');
}

function setTextPED(id, value){
  const el = $(id);
  if (el) el.textContent = value == null ? '' : String(value);
}

function renderPedidoDetailModalProductRowsPED(lines){
  const tbody = $('pedido-detail-products-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!Array.isArray(lines) || !lines.length){
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.textContent = 'Sin productos registrados.';
    td.className = 'pedidos-products-empty-cell';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  lines.forEach((item) => {
    const qty = Number(item.qty || 0);
    const unit = Number(item.unit || 0);
    const subtotal = Number(item.subtotal != null ? item.subtotal : (qty * unit));
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.textContent = item.label || 'Producto';
    tr.appendChild(nameTd);

    const qtyTd = document.createElement('td');
    qtyTd.className = 'num-cell';
    qtyTd.textContent = String(qty || 0);
    tr.appendChild(qtyTd);

    const unitTd = document.createElement('td');
    unitTd.className = 'num-cell';
    unitTd.textContent = formatA33Cordobas(unit);
    tr.appendChild(unitTd);

    const subTd = document.createElement('td');
    subTd.className = 'num-cell';
    subTd.textContent = formatA33Cordobas(subtotal);
    tr.appendChild(subTd);

    tbody.appendChild(tr);
  });
}

function closePedidoDetailModalPED(){
  const modal = $('pedido-detail-modal');
  if (!modal) return;
  modal.hidden = true;
  try{ document.body.classList.remove('a33-modal-open'); }catch(_){ }
}

function openPedidoDetailModalPED(p, source){
  const modal = $('pedido-detail-modal');
  if (!modal) return false;
  const t = getPedidoTotalsForDisplayPED(p);
  const clienteLabel = (p && (p.customerName || p.clienteNombre)) ? (p.customerName || p.clienteNombre) : '';
  const estado = getPedidoEstado(p);

  setTextPED('pedido-detail-title', (source === 'archived' ? 'Pedido histórico' : 'Detalle de pedido'));
  setTextPED('pedido-detail-code', p && p.codigo ? p.codigo : '');
  setTextPED('pedido-detail-client', clienteLabel || '');
  setTextPED('pedido-detail-created', formatDate(p && p.fechaCreacion));
  setTextPED('pedido-detail-delivery', formatDate(p && p.fechaEntrega));
  setTextPED('pedido-detail-priority', p && p.prioridad ? p.prioridad : 'normal');
  setTextPED('pedido-detail-phone', p && p.clienteTelefono ? p.clienteTelefono : '');
  setTextPED('pedido-detail-type', p && p.clienteTipo ? p.clienteTipo : '');
  setTextPED('pedido-detail-ref', p && p.clienteReferencia ? p.clienteReferencia : '');
  setTextPED('pedido-detail-lots', p && p.lotesRelacionados ? p.lotesRelacionados : '');
  setTextPED('pedido-detail-subtotal', formatA33Cordobas(t.subtotal));
  setTextPED('pedido-detail-discount', formatA33Cordobas(t.descuento));
  setTextPED('pedido-detail-shipping', formatA33Cordobas(t.envio));
  setTextPED('pedido-detail-total', formatA33Cordobas(t.total));
  setTextPED('pedido-detail-method', p && p.metodoPago ? p.metodoPago : '');
  setTextPED('pedido-detail-paid', formatA33Cordobas(t.pagoAnt));
  setTextPED('pedido-detail-balance', formatA33Cordobas(t.saldo));
  setTextPED('pedido-detail-status', estado === 'entregado' ? 'Entregado' : 'Pendiente');

  renderPedidoDetailModalProductRowsPED(t.lines);

  const closeBtn = $('pedido-detail-close');
  if (closeBtn) closeBtn.onclick = closePedidoDetailModalPED;
  const okBtn = $('pedido-detail-ok');
  if (okBtn) okBtn.onclick = closePedidoDetailModalPED;
  modal.onclick = (event) => {
    if (event && event.target === modal) closePedidoDetailModalPED();
  };
  modal.hidden = false;
  try{ document.body.classList.add('a33-modal-open'); }catch(_){ }
  try{ if (closeBtn) closeBtn.focus({ preventScroll:true }); }catch(_){ }
  return true;
}

// --- Clientes (desde POS) ---
// --- Clientes (desde POS) ---
function sanitizeCustomerName(name){
  return String(name || '').replace(/\s+/g,' ').trim();
}

function normalizeCustomerKey(name){
  let s = sanitizeCustomerName(name);
  try{ if (s.normalize) s = s.normalize('NFD'); }catch(_){ }
  return s
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/\s+/g,' ')
    .trim();
}

function readPosCustomersRaw(){
  try{
    if (window.A33Storage && typeof A33Storage.sharedGet === 'function'){
      const raw = A33Storage.sharedGet(POS_CUSTOMERS_KEY, [], 'local');
      return Array.isArray(raw) ? raw : [];
    }
  }catch(_){ }

  try{
    if (window.A33Storage && typeof A33Storage.getJSON === 'function'){
      const raw = A33Storage.getJSON(POS_CUSTOMERS_KEY, [], 'local');
      return Array.isArray(raw) ? raw : [];
    }
  }catch(_){ }

  try{
    const raw2 = JSON.parse(localStorage.getItem(POS_CUSTOMERS_KEY) || '[]');
    return Array.isArray(raw2) ? raw2 : [];
  }catch(_){
    return [];
  }
}

function writePosCustomersRaw(arr){
  const safe = Array.isArray(arr) ? arr : [];

  try{
    if (window.A33Storage && typeof A33Storage.sharedSet === 'function'){
      const r = A33Storage.sharedSet(POS_CUSTOMERS_KEY, safe, { source: 'pedidos' });
      if (!r || !r.ok){
        console.warn('No se pudo guardar clientes (sharedSet)', r);
        try { showArchivedNotice((r && r.message) ? r.message : 'Conflicto al guardar clientes. Recarga la pagina e intenta de nuevo.'); } catch(_){}
        return false;
      }
      return true;
    }
  }catch(_){ }

  try{
    if (window.A33Storage && typeof A33Storage.setJSON === 'function'){
      A33Storage.setJSON(POS_CUSTOMERS_KEY, safe, 'local');
      return true;
    }
  }catch(_){ }

  try{ localStorage.setItem(POS_CUSTOMERS_KEY, JSON.stringify(safe)); return true; }catch(_){ return false; }
}

function detectCustomerCatalogType(arr){
  if (!Array.isArray(arr) || arr.length === 0) return 'string';
  const hasStr = arr.some(x => typeof x === 'string');
  const hasObj = arr.some(x => x && typeof x === 'object');
  if (hasObj && !hasStr) return 'object';
  if (hasStr && !hasObj) return 'string';
  // mixto: preferir objetos (POS actual migra a objetos)
  return hasObj ? 'object' : 'string';
}

function rebuildCustomersCache(){
  const raw = readPosCustomersRaw();
  const type = detectCustomerCatalogType(raw);
  const list = [];
  const byId = new Map();
  const byNorm = new Map();

  for (const item of raw){
    let id = '';
    let name = '';
    let isActive = true;

    if (typeof item === 'string'){
      name = sanitizeCustomerName(item);
    } else if (item && typeof item === 'object'){
      name = sanitizeCustomerName(item.name || item.nombre || item.label || '');
      id = (item.id != null) ? String(item.id).trim() : '';
      if (item.isActive === false) isActive = false;
    }

    if (!name) continue;
    const k = normalizeCustomerKey(name);
    if (!k) continue;

    // Guardar referencia para detectar duplicados (incluye inactivos)
    if (!byNorm.has(k)){
      byNorm.set(k, { id, name, isActive });
    }

    // Para selector: solo activos (a menos que sea el cliente del pedido en edición)
    if (isActive === false) continue;

    if (id) byId.set(id, { id, name, isActive });

    // Dedupe por nombre normalizado
    if (!list.some(x => normalizeCustomerKey(x.name) === k)){
      list.push({ id, name, isActive });
    }
  }

  list.sort((a,b)=> normalizeCustomerKey(a.name).localeCompare(normalizeCustomerKey(b.name)));

  customersCache = { type, raw, list, byId, byNorm };
  return customersCache;
}

function ensureLegacyCustomerOption(selectEl, name){
  const nm = sanitizeCustomerName(name);
  if (!selectEl || !nm) return null;
  const legacyValue = `legacy:${normalizeCustomerKey(nm)}`;

  // Si ya existe opción legacy, actualízala
  let opt = Array.from(selectEl.options).find(o => o.value === legacyValue);
  if (!opt){
    opt = document.createElement('option');
    opt.value = legacyValue;
    // Inserta justo después del placeholder si existe
    if (selectEl.options && selectEl.options.length > 1) selectEl.insertBefore(opt, selectEl.options[1]);
    else selectEl.appendChild(opt);
  }
  opt.textContent = `${nm} (guardado)`;
  opt.dataset.id = '';
  opt.dataset.name = nm;
  return opt;
}

function renderCustomerSelect(filterText = ''){
  const selectEl = $('clienteSelect');
  if (!selectEl) return;

  const prevValue = selectEl.value;
  const filter = normalizeCustomerKey(filterText);

  rebuildCustomersCache();

  selectEl.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Seleccionar cliente…';
  selectEl.appendChild(placeholder);

  const list = customersCache.list || [];
  for (const c of list){
    if (!c || !c.name) continue;
    const k = normalizeCustomerKey(c.name);
    if (filter && !k.includes(filter)) continue;

    const opt = document.createElement('option');
    opt.value = c.id ? `id:${c.id}` : `nm:${k}`;
    opt.textContent = c.name;
    opt.dataset.id = c.id || '';
    opt.dataset.name = c.name;
    selectEl.appendChild(opt);
  }

  // Restaurar selección previa si aplica
  if (prevValue){
    const exists = Array.from(selectEl.options).some(o => o.value === prevValue);
    if (exists) selectEl.value = prevValue;
  }
}

function setCustomerSelection({ id = '', name = '' } = {}){
  const selectEl = $('clienteSelect');
  const hiddenName = $('clienteNombre');
  const hiddenId = $('clienteId');
  const status = $('clienteSelectedStatus');

  currentCustomer = { id: id || '', name: sanitizeCustomerName(name) };
  if (hiddenName) hiddenName.value = currentCustomer.name;
  if (hiddenId) hiddenId.value = currentCustomer.id;

  if (status){
    status.textContent = currentCustomer.name
      ? `Seleccionado: ${currentCustomer.name}${currentCustomer.id ? '' : ''}`
      : 'Sin cliente seleccionado.';
  }

  if (!selectEl) return;

  if (currentCustomer.id){
    const wanted = `id:${currentCustomer.id}`;
    const exists = Array.from(selectEl.options).some(o => o.value === wanted);
    if (exists) selectEl.value = wanted;
    else {
      // Puede pasar si el cliente está inactivo en POS: inyectamos opción legacy
      ensureLegacyCustomerOption(selectEl, currentCustomer.name);
      selectEl.value = `legacy:${normalizeCustomerKey(currentCustomer.name)}`;
    }
  } else if (currentCustomer.name){
    // Buscar por nombre entre opciones visibles
    const k = normalizeCustomerKey(currentCustomer.name);
    const opt = Array.from(selectEl.options).find(o => (o.dataset && normalizeCustomerKey(o.dataset.name) === k));
    if (opt) selectEl.value = opt.value;
    else {
      ensureLegacyCustomerOption(selectEl, currentCustomer.name);
      selectEl.value = `legacy:${k}`;
    }
  } else {
    selectEl.value = '';
  }
}

function getCustomerFromUI(){
  const selectEl = $('clienteSelect');
  const hiddenName = $('clienteNombre');
  const hiddenId = $('clienteId');

  if (selectEl && selectEl.value){
    const opt = selectEl.options[selectEl.selectedIndex];
    const id = (opt && opt.dataset) ? (opt.dataset.id || '') : '';
    const name = (opt && opt.dataset) ? (opt.dataset.name || '') : '';
    const out = { id: String(id || '').trim(), name: sanitizeCustomerName(name) };
    if (hiddenName) hiddenName.value = out.name;
    if (hiddenId) hiddenId.value = out.id;
    return out;
  }

  const out2 = { id: (hiddenId ? hiddenId.value : ''), name: sanitizeCustomerName(hiddenName ? hiddenName.value : '') };
  return out2;
}

function toggleNewCustomerBox(show){
  const box = $('clienteNewBox');
  if (!box) return;
  box.hidden = !show;
  if (show){
    setTimeout(()=>{ try{ const el = $('clienteNewName'); if (el) el.focus(); }catch(_){ } }, 0);
  } else {
    const input = $('clienteNewName');
    if (input) input.value = '';
  }
}

function addNewCustomerToPosCatalog(name){
  const display = sanitizeCustomerName(name);
  const k = normalizeCustomerKey(display);
  if (!display || !k) return { ok:false, reason:'empty' };

  const raw = readPosCustomersRaw();
  const type = detectCustomerCatalogType(raw);

  // Dedupe (incluye inactivos)
  const existing = rebuildCustomersCache().byNorm.get(k);
  if (existing){
    return { ok:true, existed:true, id: existing.id || '', name: existing.name || display, isActive: existing.isActive !== false };
  }

  if (type === 'object'){
    const id = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,9);
    raw.push({ id, name: display, nombre: display, celular: '', telefono: '', whatsapp: '', correo: '', direccion: '', notas: '', isActive: true, active: true, createdAt: Date.now(), updatedAt: null, normalizedName: k, aliases: [], nameHistory: [], mergedIntoId: null, mergedAt: null, mergeReason: '', mergeHistory: [] });
    writePosCustomersRaw(raw);
    return { ok:true, existed:false, id, name: display, isActive:true };
  }

  // default: strings
  raw.push(display);
  writePosCustomersRaw(raw);
  return { ok:true, existed:false, id:'', name: display, isActive:true };
}

// --- IndexedDB POS (solo lectura, robusto) ---
function openPosDB() {
  return new Promise((resolve) => {
    if (posDB) return resolve(posDB);
    if (!('indexedDB' in window)) return resolve(null);
    let req;
    try {
      // Sin versión: usa la versión existente (evita VersionError si el POS migró).
      req = indexedDB.open(POS_DB_NAME);
    } catch (err) {
      console.warn('Pedidos: no se pudo abrir a33-pos', err);
      return resolve(null);
    }
    req.onsuccess = () => {
      posDB = req.result;
      try{
        posDB.onversionchange = () => { try{ posDB.close(); }catch(_){ } posDB = null; };
      }catch(_){ }
      resolve(posDB);
    };
    req.onerror = () => {
      console.warn('Pedidos: error al abrir a33-pos', req.error);
      resolve(null);
    };
  });
}

function getAllPosProductsSafe() {
  return new Promise(async (resolve) => {
    const db = await openPosDB();
    if (!db) return resolve([]);
    let store;
    try {
      store = db.transaction('products', 'readonly').objectStore('products');
    } catch (err) {
      console.warn('Pedidos: store products no encontrada en a33-pos', err);
      return resolve([]);
    }
    if (store.getAll) {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => {
        console.warn('Pedidos: no se pudieron leer products del POS', req.error);
        resolve([]);
      };
    } else {
      // Fallback (browsers antiguos): cursor
      const out = [];
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { out.push(cur.value); cur.continue(); }
        else resolve(out);
      };
      req.onerror = () => {
        console.warn('Pedidos: no se pudieron leer products del POS', req.error);
        resolve([]);
      };
    }
  });
}

async function getPosPricesMapSafe({ force = false } = {}) {
  // Cache simple (evita leer IndexedDB en cada click)
  if (!force && posPricesCache && (Date.now() - posPricesLoadedAt) < 120000) {
    return posPricesCache;
  }

  const list = await getAllPosProductsSafe();
  const best = { pulso: null, media: null, djeba: null, litro: null, galon: null };

  for (const p of (Array.isArray(list) ? list : [])) {
    if (!p || p.active === false) continue;
    const key = mapProductNameToPresKey(p.name || p.nombre);
    if (!key) continue;
    const price = typeof p.price === 'number' ? p.price : parseNumber(p.price);
    if (!isValidCatalogPricePED(price)) continue;

    // Catálogos manda: elegir el producto activo y canónico, no el último id legacy.
    // Esto evita que un Galón viejo de C$800 pise el Galón actual configurado en Catálogos.
    const candidate = { id: p.id, price, __score: scoreCatalogProductPED(p) };
    const prev = best[key];
    if (!prev || candidate.__score > prev.__score) {
      best[key] = candidate;
    }
  }

  const map = {
    pulso: best.pulso ? best.pulso.price : null,
    media: best.media ? best.media.price : null,
    djeba: best.djeba ? best.djeba.price : null,
    litro: best.litro ? best.litro.price : null,
    galon: best.galon ? best.galon.price : null,
  };

  posPricesCache = map;
  posPricesLoadedAt = Date.now();
  return map;
}

function getPriceSnapshotFromPedido(p) {
  const snap = {};
  const obj = (p && typeof p.priceSnapshot === 'object' && p.priceSnapshot) ? p.priceSnapshot : null;

  if (obj){
    Object.keys(obj).forEach((key) => {
      const val = parseNumber(obj[key]);
      if (typeof val === 'number' && isFinite(val) && val >= 0) snap[key] = val;
    });
  }

  getPedidoProductItemsArray(p).forEach((item) => {
    const key = String(item.productKey || item.key || '').trim();
    const legacyKey = String(item.legacyKey || item.legacyId || '').trim();
    const val = getPedidoItemUnitPricePED(item);
    if (key && isFinite(val) && val >= 0) snap[key] = val;
    if (legacyKey && isFinite(val) && val >= 0) snap[legacyKey] = val;
  });

  LEGACY_PRESENTACIONES.forEach((pres) => {
    let val = null;
    if (obj && obj[pres.key] != null) val = parseNumber(obj[pres.key]);
    if ((val == null || !isFinite(val)) && p && p[pres.legacyPrice] != null) val = parseNumber(p[pres.legacyPrice]);
    if (typeof val === 'number' && isFinite(val) && val >= 0) snap[pres.key] = val;
  });

  return snap;
}

async function calcularTotalesDesdeFormulario() {
  if (!pedidosCatalogProductsLoaded) await refreshPedidosProductCatalog(false);

  const qty = {};
  PRESENTACIONES.forEach((pres) => {
    const el = $(pres.qtyId);
    qty[pres.key] = el ? parseNumber(el.value) : 0;
  });

  const fallback = (currentPriceSnapshot && typeof currentPriceSnapshot === 'object') ? currentPriceSnapshot : {};

  let subtotal = 0;
  const unitUsed = {};

  PRESENTACIONES.forEach((pres) => {
    let unit = (typeof pres.price === 'number' && isFinite(pres.price)) ? pres.price : null;
    if (unit == null) {
      const f = fallback[pres.key] ?? (pres.legacyKey ? fallback[pres.legacyKey] : null);
      unit = (typeof f === 'number' && isFinite(f)) ? f : 0;
    }
    unitUsed[pres.key] = unit;
    if (pres.legacyKey) unitUsed[pres.legacyKey] = unit;
    const lineSubtotal = (qty[pres.key] || 0) * unit;
    subtotal += lineSubtotal;
    updateLineSubtotalPED(pres, unit);
  });

  (Array.isArray(currentHistoricalPedidoItemsPED) ? currentHistoricalPedidoItemsPED : []).forEach((item) => {
    const qtyHist = getPedidoItemQtyPED(item);
    if (!(qtyHist > 0)) return;
    const unitHist = getPedidoItemUnitPricePED(item);
    const key = String(item.productKey || item.key || '').trim();
    const pid = String(item.productId || item.productoId || '').trim();
    const legacyKey = String(item.legacyKey || item.legacyId || '').trim();
    if (key) unitUsed[key] = unitHist;
    if (pid) unitUsed['product:' + pid] = unitHist;
    if (legacyKey) unitUsed[legacyKey] = unitHist;
    subtotal += qtyHist * unitHist;
  });

  const envio = parseNumber($('envio')?.value || 0);
  const descuento = parseNumber($('descuento')?.value || 0);
  const totalPagar = subtotal - descuento + envio;
  const pagoAnticipado = parseNumber($('pagoAnticipado')?.value || 0);
  const saldoPendiente = totalPagar - pagoAnticipado;

  if ($('subtotal')) $('subtotal').value = subtotal.toFixed(2);
  if ($('totalPagar')) $('totalPagar').value = totalPagar.toFixed(2);
  if ($('saldoPendiente')) $('saldoPendiente').value = saldoPendiente.toFixed(2);

  return {
    subtotal,
    envio,
    descuento,
    totalPagar,
    pagoAnticipado,
    saldoPendiente,
    unitPricesUsed: unitUsed,
  };
}

function clearForm() {
  $("pedido-form").reset();

  // restaurar valores por defecto numéricos
  const defaults = {
    envio: "0",
    descuento: "0",
    pagoAnticipado: "0",
  };

  Object.entries(defaults).forEach(([id, val]) => {
    const el = $(id);
    if (el) el.value = val;
  });
  resetPedidoProductQuantities();

  $("subtotal").value = "";
  $("totalPagar").value = "";
  $("saldoPendiente").value = "";
  editingId = null;
  editingBaseUpdatedAt = null;
  try{ ensureDraftPedidoId(true); }catch(_){ }
  currentPriceSnapshot = {};

  // fecha de fabricación por defecto hoy
  const hoy = new Date().toISOString().slice(0, 10);
  $("fechaCreacion").value = hoy;
  if (!$("fechaEntrega").value) $("fechaEntrega").value = hoy;
  $("codigoPedido").value = generateCodigo(hoy);
  $("save-btn").textContent = "Guardar pedido";

  // Cliente (desde POS)
  try{
    const search = $('clienteBuscar');
    if (search) search.value = '';
    renderCustomerSelect('');
    toggleNewCustomerBox(false);
    setCustomerSelection({ id:'', name:'' });
  }catch(_){ }

  viewingArchivedId = null;
  showArchivedModeBanner("");
}

function populateForm(pedido) {
  $("fechaCreacion").value = formatDate(pedido.fechaCreacion);
  $("fechaEntrega").value = formatDate(pedido.fechaEntrega);
  $("codigoPedido").value = pedido.codigo || "";
  $("prioridad").value = pedido.prioridad || "normal";

  // Cliente: compat (pedidos viejos pueden tener solo texto en clienteNombre)
  const custName = (pedido && (pedido.customerName || pedido.clienteNombre)) ? (pedido.customerName || pedido.clienteNombre) : '';
  const custId = (pedido && (pedido.customerId || pedido.clienteId)) ? (pedido.customerId || pedido.clienteId) : '';
  try{
    renderCustomerSelect(($('clienteBuscar') && $('clienteBuscar').value) ? $('clienteBuscar').value : '');
    toggleNewCustomerBox(false);
  }catch(_){ }
  setCustomerSelection({ id: custId, name: custName });
  $("clienteTipo").value = pedido.clienteTipo || "individual";
  $("clienteTelefono").value = pedido.clienteTelefono || "";
  $("clienteDireccion").value = pedido.clienteDireccion || "";
  $("clienteReferencia").value = pedido.clienteReferencia || "";

  currentHistoricalPedidoItemsPED = getHistoricalItemsForPedidoFormPED(pedido);
  renderPedidosProductRows(PRESENTACIONES);
  setPedidoProductQuantitiesFromPedido(pedido);

  const descuento = (pedido.descuento != null) ? pedido.descuento
    : ((pedido.descuentoFijo != null) ? pedido.descuentoFijo
    : (pedido.descuentoTotal != null ? pedido.descuentoTotal : 0));
  const pagoAnt = (pedido.pagoAnticipado != null) ? pedido.pagoAnticipado
    : (pedido.montoPagado != null ? pedido.montoPagado : 0);

  $("envio").value = pedido.envio ?? "0";
  $("descuento").value = parseNumber(descuento).toString();
  $("pagoAnticipado").value = parseNumber(pagoAnt).toString();
  $("subtotal").value = typeof pedido.subtotal === "number" ? pedido.subtotal.toFixed(2) : "";
  $("totalPagar").value = typeof pedido.totalPagar === "number" ? pedido.totalPagar.toFixed(2) : "";
  $("saldoPendiente").value = typeof pedido.saldoPendiente === "number" ? pedido.saldoPendiente.toFixed(2) : "";
  $("metodoPago").value = pedido.metodoPago || "efectivo";

  const estado = pedido.estado || (pedido.entregado ? 'entregado' : 'pendiente');
  if ($('estado')) $('estado').value = (estado === 'entregado') ? 'entregado' : 'pendiente';

  currentPriceSnapshot = getPriceSnapshotFromPedido(pedido);

  $("lotesRelacionados").value = pedido.lotesRelacionados || "";

  editingId = pedido.id;
  $("save-btn").textContent = "Actualizar pedido";
  editingBaseUpdatedAt = (pedido && typeof pedido.updatedAt === 'number') ? pedido.updatedAt : null;
  try{ clearDraftPedido(); }catch(_){ }
}

function renderTable() {
  const table = $("pedidos-table");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  const qEl = $("active-search");
  const q = qEl ? qEl.value.trim() : "";
  const qNorm = q ? normalizeCustomerKey(q) : "";

  let pedidos = loadPedidos();
  pedidos.sort((a, b) => {
    if (!a.fechaCreacion || !b.fechaCreacion) return 0;
    return a.fechaCreacion.localeCompare(b.fechaCreacion);
  });

  if (qNorm) {
    pedidos = pedidos.filter((p) => buildPedidoSearchHaystack(p).includes(qNorm));
  }

  const total = pedidos.length;
  const shown = pedidos.slice(0, Math.max(0, Number(activeLimit || A33_TABLE_PAGE_SIZE)));

  const pager = $("active-pager");
  const countEl = $("active-count");
  const moreBtn = $("active-load-more");
  if (countEl) countEl.textContent = total ? `Mostrando ${shown.length} de ${total}` : "";
  if (pager) pager.hidden = !(total > A33_TABLE_PAGE_SIZE || qNorm);
  if (moreBtn) {
    const needsMore = total > shown.length;
    moreBtn.hidden = !needsMore;
    moreBtn.disabled = !needsMore;
  }

  if (total === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.textContent = qNorm ? "Sin resultados en pedidos registrados." : "No hay pedidos registrados.";
    td.style.textAlign = "center";
    td.style.color = "#c0c0c0";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  shown.forEach((p) => {
    const tr = document.createElement("tr");

    const fechaTd = document.createElement("td");
    fechaTd.className = "col-date col-hide-ipad";
    fechaTd.textContent = formatDate(p.fechaCreacion);
    tr.appendChild(fechaTd);

    const codigoTd = document.createElement("td");
    codigoTd.className = "col-code";
    codigoTd.textContent = p.codigo || "";
    tr.appendChild(codigoTd);

    const clienteTd = document.createElement("td");
    const cSpan = document.createElement('span');
    cSpan.className = 'cell-clamp';
    cSpan.textContent = (p.customerName || p.clienteNombre || "");
    clienteTd.appendChild(cSpan);
    tr.appendChild(clienteTd);

    const entregaTd = document.createElement("td");
    entregaTd.className = "col-date";
    entregaTd.textContent = formatDate(p.fechaEntrega);
    tr.appendChild(entregaTd);

    const totalTd = document.createElement("td");
    totalTd.className = "col-money";
    const total = getPedidoTotalsForDisplayPED(p).total;
    totalTd.textContent = formatA33Cordobas(total);
    tr.appendChild(totalTd);

    const entregadoTd = document.createElement("td");
    entregadoTd.className = "col-status";
    const delivered = (p && (p.estado === 'entregado')) || !!p.entregado;
    entregadoTd.textContent = delivered ? "Sí" : "No";
    tr.appendChild(entregadoTd);

    const accionesTd = document.createElement("td");
    accionesTd.className = "actions-cell";

    const verBtn = document.createElement("button");
    verBtn.textContent = "👁";
    verBtn.className = "btn-secondary a33-icon-btn";
    verBtn.type = "button";
    verBtn.title = "Ver";
    verBtn.setAttribute("aria-label", "Ver");
    verBtn.addEventListener("click", () => verPedido(p.id));

    const calBtn = document.createElement("button");
    calBtn.textContent = "📅";
    calBtn.className = "btn-secondary a33-icon-btn";
    calBtn.type = "button";
    calBtn.title = "Calendario";
    calBtn.setAttribute("aria-label", "Calendario");
    calBtn.addEventListener("click", () => exportPedidoToCalendar(p.id));

    const editarBtn = document.createElement("button");
    editarBtn.textContent = "✏️";
    editarBtn.className = "btn-primary a33-icon-btn";
    editarBtn.type = "button";
    editarBtn.title = "Editar";
    editarBtn.setAttribute("aria-label", "Editar");
    editarBtn.addEventListener("click", () => editPedido(p.id));

    const borrarBtn = document.createElement("button");
    borrarBtn.textContent = "🗑";
    borrarBtn.className = "btn-danger a33-icon-btn";
    borrarBtn.type = "button";
    borrarBtn.title = "Borrar";
    borrarBtn.setAttribute("aria-label", "Borrar");
    borrarBtn.addEventListener("click", () => deletePedido(p.id));

    accionesTd.appendChild(verBtn);
    accionesTd.appendChild(calBtn);
    accionesTd.appendChild(editarBtn);
    accionesTd.appendChild(borrarBtn);
    tr.appendChild(accionesTd);

    tbody.appendChild(tr);
  });
}

function getPedidoEstado(p){
  const e = (p && (p.estado || (p.entregado ? 'entregado' : 'pendiente'))) || 'pendiente';
  return (String(e).toLowerCase() === 'entregado') ? 'entregado' : 'pendiente';
}

function renderArchivedTable() {
  const table = $("archived-table");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  const qEl = $("archived-search");
  const q = qEl ? qEl.value.trim() : "";
  const qNorm = q ? normalizeCustomerKey(q) : "";

  let archived = loadArchivedPedidos();
  archived.sort((a, b) => {
    const aa = (a && (a.archivedAt || a.fechaCreacion || a.fechaEntrega)) || "";
    const bb = (b && (b.archivedAt || b.fechaCreacion || b.fechaEntrega)) || "";
    return String(bb).localeCompare(String(aa));
  });

  if (qNorm) {
    archived = archived.filter((p) => buildPedidoSearchHaystack(p).includes(qNorm));
  }

  const total = archived.length;
  const shown = archived.slice(0, Math.max(0, Number(archivedLimit || A33_TABLE_PAGE_SIZE)));

  const countEl = $("archived-count");
  if (countEl) countEl.textContent = String(total);

  const pager = $("archived-pager");
  const shownEl = $("archived-shown");
  const moreBtn = $("archived-load-more");
  if (shownEl) shownEl.textContent = total ? `Mostrando ${shown.length} de ${total}` : "";
  if (pager) pager.hidden = !(total > A33_TABLE_PAGE_SIZE || qNorm);
  if (moreBtn) {
    const needsMore = total > shown.length;
    moreBtn.hidden = !needsMore;
    moreBtn.disabled = !needsMore;
  }

  if (total === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.textContent = qNorm ? "Sin resultados en Histórico." : "No hay pedidos archivados.";
    td.style.textAlign = "center";
    td.style.color = "#c0c0c0";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  shown.forEach((p) => {
    const tr = document.createElement("tr");

    const archTd = document.createElement("td");
    archTd.className = "col-date col-hide-ipad";
    archTd.textContent = formatDate(p.archivedAt || "");
    tr.appendChild(archTd);

    const codigoTd = document.createElement("td");
    codigoTd.className = "col-code";
    codigoTd.textContent = p.codigo || "";
    tr.appendChild(codigoTd);

    const clienteTd = document.createElement("td");
    const cSpan = document.createElement('span');
    cSpan.className = 'cell-clamp';
    cSpan.textContent = (p.customerName || p.clienteNombre || "");
    clienteTd.appendChild(cSpan);
    tr.appendChild(clienteTd);

    const entregaTd = document.createElement("td");
    entregaTd.className = "col-date";
    entregaTd.textContent = formatDate(p.fechaEntrega);
    tr.appendChild(entregaTd);

    const estadoTd = document.createElement("td");
    estadoTd.className = "col-status";
    const estado = getPedidoEstado(p);
    const pill = document.createElement("span");
    pill.className = "badge " + (estado === "entregado" ? "ok" : "warn");
    pill.textContent = (estado === "entregado") ? "Entregado" : "Pendiente";
    estadoTd.appendChild(pill);
    tr.appendChild(estadoTd);

    const totalTd = document.createElement("td");
    totalTd.className = "col-money";
    const tot = getPedidoTotalsForDisplayPED(p).total;
    totalTd.textContent = formatA33Cordobas(tot || 0);
    tr.appendChild(totalTd);

    const accionesTd = document.createElement("td");
    accionesTd.className = "actions-cell";

    const verBtn = document.createElement("button");
    verBtn.textContent = "👁";
    verBtn.className = "btn-secondary a33-icon-btn";
    verBtn.type = "button";
    verBtn.title = "Ver detalle";
    verBtn.setAttribute("aria-label", "Ver detalle");
    verBtn.addEventListener("click", () => verPedido(p.id, 'archived'));

    const cargarBtn = document.createElement("button");
    cargarBtn.textContent = "↩";
    cargarBtn.className = "btn-primary a33-icon-btn";
    cargarBtn.type = "button";
    cargarBtn.title = "Cargar como nuevo";
    cargarBtn.setAttribute("aria-label", "Cargar como nuevo");
    cargarBtn.addEventListener("click", () => {
      try{
        viewingArchivedId = p.id;
        populateForm(p);
        // Guardar desde un archivado debe crear uno nuevo (no editar)
        editingId = null;
        editingBaseUpdatedAt = null;
        try{ ensureDraftPedidoId(true); }catch(_){ }
        const sb = $("save-btn");
        if (sb) sb.textContent = "Guardar como nuevo";
        showArchivedModeBanner("Viendo pedido archivado (Histórico). Guardar creará un pedido activo nuevo.");
        showArchivedNotice("Cargado al formulario ✓");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }catch(_){}
    });

    const borrarBtn = document.createElement("button");
    borrarBtn.textContent = "🗑";
    borrarBtn.className = "btn-danger a33-icon-btn";
    borrarBtn.type = "button";
    borrarBtn.title = "Borrar (definitivo)";
    borrarBtn.setAttribute("aria-label", "Borrar (definitivo)");
    borrarBtn.addEventListener("click", () => deleteArchivedPedido(p.id));

    accionesTd.appendChild(verBtn);
    accionesTd.appendChild(cargarBtn);
    accionesTd.appendChild(borrarBtn);
    tr.appendChild(accionesTd);

    tbody.appendChild(tr);
  });
}


function verPedido(id, source) {
  const lista = (source === 'archived') ? loadArchivedPedidos() : loadPedidos();
  const p = lista.find((x) => String(x && x.id) === String(id));
  if (!p) return;

  if (openPedidoDetailModalPED(p, source)) return;

  // Fallback por si el modal no existe en una base antigua.
  const lines = [];
  const t = getPedidoTotalsForDisplayPED(p);
  const estado = getPedidoEstado(p);

  lines.push(`Código: ${p.codigo || ""}`);
  lines.push(`Fecha fabricación: ${formatDate(p.fechaCreacion)}`);
  lines.push(`Fecha entrega: ${formatDate(p.fechaEntrega)}`);
  lines.push(`Prioridad: ${p.prioridad || "normal"}`);
  lines.push("");
  lines.push("Cliente:");
  const clienteLabel = (p.customerName || p.clienteNombre || "");
  lines.push(`  Nombre / negocio: ${clienteLabel}`);
  lines.push(`  Tipo: ${p.clienteTipo || ""}`);
  lines.push(`  Teléfono: ${p.clienteTelefono || ""}`);
  if (p.clienteReferencia) lines.push(`  Referencia: ${p.clienteReferencia}`);
  lines.push("");
  lines.push("Productos:");
  if (t.lines.length){
    t.lines.forEach((item) => {
      const sub = Number(item.subtotal != null ? item.subtotal : (Number(item.qty || 0) * Number(item.unit || 0)));
      lines.push(`  ${item.label}: cant ${item.qty || 0}, unit ${formatA33Cordobas(item.unit || 0)}, subtotal ${formatA33Cordobas(sub || 0)}`);
    });
  } else {
    lines.push('  Sin productos registrados.');
  }
  lines.push("");
  lines.push(`Subtotal: ${formatA33Cordobas(t.subtotal)}`);
  lines.push(`Descuento: ${formatA33Cordobas(t.descuento)}`);
  lines.push(`Envío: ${formatA33Cordobas(t.envio)}`);
  lines.push(`Total a pagar: ${formatA33Cordobas(t.total)}`);
  lines.push("");
  lines.push("Pago / Estado:");
  lines.push(`  Método: ${p.metodoPago || ""}`);
  lines.push(`  Pago anticipado: ${formatA33Cordobas(t.pagoAnt)}`);
  lines.push(`  Saldo pendiente: ${formatA33Cordobas(t.saldo)}`);
  lines.push(`  Estado: ${estado === 'entregado' ? 'Entregado' : 'Pendiente'}`);
  if (p.lotesRelacionados) lines.push(`Lotes relacionados: ${p.lotesRelacionados}`);

  alert(lines.join("\n"));
}

function editPedido(id) {
  const pedidos = loadPedidos();
  const p = pedidos.find((x) => String(x && x.id) === String(id));
  if (!p) return;
  
  viewingArchivedId = null;
  showArchivedModeBanner("");
  populateForm(p);
}

async function deletePedido(id) {
  const pedidos = loadPedidos();
  const idx = pedidos.findIndex((p) => String(p.id) === String(id));
  if (idx < 0) return;

  if (!confirm("¿Archivar este pedido? Se moverá al Histórico.")) return;

  const res = await withSavingLock('Archivando…', async () => {
    const snap = { ...(pedidos[idx] || {}) };
    snap.archivedAt = new Date().toISOString();

    const archived = loadArchivedPedidos();
    const aIdx = archived.findIndex((p) => String(p.id) === String(snap.id));
    const newArchived = Array.isArray(archived) ? [...archived] : [];
    if (aIdx >= 0) newArchived[aIdx] = snap;
    else newArchived.push(snap);

    // Guardar en histórico primero; luego remover de activos (con rollback básico si falla)
    const okArch = saveArchivedPedidos(newArchived);
    if (!okArch) {
      return { ok:false, message:'No se pudo archivar (falló el guardado del Histórico). No se hicieron cambios.' };
    }
    if (!confirmArchivedPersisted(snap.id)) {
      return { ok:false, message:'Archivado no confirmado. No se hicieron cambios.' };
    }

    const newPedidos = Array.isArray(pedidos) ? [...pedidos] : [];
    newPedidos.splice(idx, 1);

    const okAct = savePedidos(newPedidos);
    if (!okAct) {
      // intentar rollback del histórico
      try { saveArchivedPedidos(archived); } catch(_){ }
      return { ok:false, message:'No se pudo completar el archivado (falló el guardado de pedidos activos). No se hicieron cambios.' };
    }

    // confirmar remoción (si queda duplicado, avisamos)
    const stillThere = confirmPedidosPersisted(id);
    if (stillThere) {
      return { ok:false, message:'Archivado parcial: quedó también en la lista activa. Recargá y revisá.' };
    }

    return { ok:true };
  });

  if (!res || !res.ok){
    const msg = (res && res.message) ? res.message : 'No se pudo archivar el pedido.';
    showArchivedNotice(msg);
    alert(msg);
    return;
  }

  renderTable();
  renderArchivedTable();
  if (String(editingId) === String(id)) clearForm();
  showArchivedNotice("Archivado ✓");
}

async function deleteArchivedPedido(id){
  const archived = loadArchivedPedidos();
  const idx = archived.findIndex((p) => String(p && p.id) === String(id));
  if (idx < 0) return;

  const p = archived[idx] || {};
  const codigo = String(p.codigo || '').trim();
  const cliente = String(p.customerName || p.clienteNombre || '').trim();
  const entrega = formatDate(p.fechaEntrega);

  const msgLines = [
    '¿Borrar definitivamente este pedido del Histórico?',
    '',
    (codigo ? `Código: ${codigo}` : null),
    (cliente ? `Cliente: ${cliente}` : null),
    (entrega ? `Entrega: ${entrega}` : null),
    '',
    'Esto no se puede deshacer.'
  ].filter(Boolean);

  if (!confirm(msgLines.join('\n'))) return;

  const res = await withSavingLock('Borrando…', async () => {
    // Releer antes de guardar (multi-tab / reintentos)
    const latest = loadArchivedPedidos();
    const i2 = latest.findIndex((x) => String(x && x.id) === String(id));
    if (i2 < 0) return { ok:false, message:'Ya no existe en Histórico.' };

    const next = latest.filter((_, i) => i !== i2);
    const ok = saveArchivedPedidos(next);
    if (!ok) return { ok:false, message:'No se pudo borrar (error de almacenamiento).' };

    // Si estábamos “viendo” este archivado, limpiar modo
    if (viewingArchivedId != null && String(viewingArchivedId) === String(id)){
      viewingArchivedId = null;
      try{ showArchivedModeBanner(''); }catch(_){ }
      try{
        const sb = $('save-btn');
        if (sb) sb.textContent = 'Guardar pedido';
      }catch(_){ }
    }

    return { ok:true, message:'Borrado ✓' };
  });

  if (!res || !res.ok){
    const msg = (res && res.message) ? res.message : 'No se pudo borrar del Histórico.';
    showArchivedNotice(msg);
    alert(msg);
    return;
  }

  renderArchivedTable();
  showArchivedNotice('Borrado ✓');
}

function createICSEventFromPedido(p) {
  const fechaEntrega = p.fechaEntrega || p.fechaCreacion;
  if (!fechaEntrega) return null;
  const parts = String(fechaEntrega).slice(0, 10).split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  const startDate = y + m.padStart(2, "0") + d.padStart(2, "0");

  const dateObj = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10) + 1));
  const endY = dateObj.getUTCFullYear();
  const endM = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const endD = String(dateObj.getUTCDate()).padStart(2, "0");
  const endDate = `${endY}${endM}${endD}`;

  const nowIso = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const summaryBase = `Entrega pedido Arcano 33`;
  const clienteLabel2 = (p.customerName || p.clienteNombre || "");
  const summary = (clienteLabel2 ? `${summaryBase} - ${clienteLabel2}` : summaryBase).substring(0, 120);

  const location = (p.clienteReferencia || p.clienteDireccion || "")
    .replace(/\r?\n/g, ", ")
    .substring(0, 200);

  const descLines = [];
  descLines.push(`Código: ${p.codigo || ""}`);
  descLines.push(`Cliente: ${clienteLabel2 || ""}`);
  if (p.clienteTelefono) descLines.push(`Teléfono: ${p.clienteTelefono}`);
  if (p.clienteTipo) descLines.push(`Tipo: ${p.clienteTipo}`);
  if (p.clienteReferencia) descLines.push(`Referencia: ${p.clienteReferencia.replace(/\r?\n/g, " ")}`);
  if (p.clienteDireccion) descLines.push(`Dirección (legacy): ${p.clienteDireccion.replace(/\r?\n/g, " ")}`);

  const detail = getPedidoTotalsForDisplayPED(p);
  if (detail.lines.length){
    descLines.push('Productos:');
    detail.lines.forEach((item) => {
      const qty = Number(item.qty || 0);
      const unit = Number(item.unit || 0);
      const sub = Number(item.subtotal != null ? item.subtotal : (qty * unit));
      descLines.push(`- ${item.label}: ${qty} x ${formatA33Cordobas(unit)} = ${formatA33Cordobas(sub)}`);
    });
  }

  if (p.lotesRelacionados) descLines.push(`Lotes: ${p.lotesRelacionados.replace(/\r?\n/g, " ")}`);
  descLines.push(`Total a cobrar: ${formatA33Cordobas(detail.total)}`);
  const descRaw = descLines.join("\n");

  function icsEscape(str) {
    return String(str || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  const description = icsEscape(descRaw);
  const uid = `${p.id || ("pedido-" + startDate)}@arcano33`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Arcano 33//Pedidos//ES",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${nowIso}`,
    `SUMMARY:${icsEscape(summary)}`,
  ];
  if (location) {
    lines.push(`LOCATION:${icsEscape(location)}`);
  }
  lines.push(
    `DESCRIPTION:${description}`,
    `DTSTART;VALUE=DATE:${startDate}`,
    `DTEND;VALUE=DATE:${endDate}`,
    "END:VEVENT",
    "END:VCALENDAR"
  );
  return lines.join("\r\n");
}

function exportPedidoToCalendar(id) {
  const pedidos = loadPedidos();
  const p = pedidos.find((x) => String(x && x.id) === String(id));
  if (!p) return;

  const ics = createICSEventFromPedido(p);
  if (!ics) {
    alert("No se pudo generar el evento de calendario. Revisá que el pedido tenga fecha de entrega.");
    return;
  }

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  const fecha = (p.fechaEntrega || p.fechaCreacion || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const safeCodigo = String(p.codigo || "pedido")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_");
  a.href = url;
  a.download = `pedido_${safeCodigo}_${fecha}.ics`;

  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

async function exportToCSV() {
  const btn = $("export-btn");
  const statusEl = $("export-status");
  const setStatus = (t) => { if (statusEl) statusEl.textContent = String(t || ""); };

  try{
    if (btn && btn.dataset && btn.dataset.busy === '1') return;
    if (btn && btn.dataset) btn.dataset.busy = '1';
  }catch(_){ }

  const pedidos = loadPedidos();
  if (pedidos.length === 0) {
    setStatus('');
    alert("No hay pedidos para exportar.");
    try{ if (btn && btn.dataset) btn.dataset.busy = '0'; }catch(_){ }
    return;
  }

  if (typeof XLSX === "undefined") {
    setStatus('Falló');
    alert("No se pudo generar el archivo de Excel (librería XLSX no cargada).");
    try{ if (btn && btn.dataset) btn.dataset.busy = '0'; }catch(_){ }
    return;
  }

  const prevText = btn ? (btn.textContent || 'Exportar a Excel') : '';
  if (btn){
    btn.disabled = true;
    btn.textContent = 'Exportando…';
  }
  setStatus('Exportando…');
  await new Promise((r) => setTimeout(r, 0));

  try{
    const headers = [
      "Fecha fabricación",
      "Fecha entrega",
      "Código",
      "Cliente",
      "Tipo cliente",
      "Teléfono",
      "Dirección",
      "Referencia",
      "Productos detalle",
      "Total unidades",
      "Subtotal productos",
      "Pulso - Cantidad",
      "Pulso - Precio",
      "Pulso - Descuento",
      "Media - Cantidad",
      "Media - Precio",
      "Media - Descuento",
      "Djeba - Cantidad",
      "Djeba - Precio",
      "Djeba - Descuento",
      "Litro - Cantidad",
      "Litro - Precio",
      "Litro - Descuento",
      "Galón - Cantidad",
      "Galón - Precio",
      "Galón - Descuento",
      "Subtotal presentaciones",
      "Descuento total",
      "Envío",
      "Total a pagar",
      "Método pago",
      "Estado pago",
      "Monto pagado",
      "Saldo pendiente",
      "Lotes relacionados",
      "Entregado",
    ];

    const numOrEmpty = (v) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(2)) : "");

    const rows = pedidos.map((p) => {
      const delivered = (p && (p.estado === 'entregado')) || !!p.entregado;
      const detail = getPedidoTotalsForDisplayPED(p);
      const subPres = (typeof p.subtotalPresentaciones === 'number') ? p.subtotalPresentaciones
        : (typeof p.subtotal === 'number' ? p.subtotal : detail.subtotal);
      const totalUnits = detail.lines.reduce((sum, item) => sum + (Number(item.qty || 0) || 0), 0);
      return [
        formatDate(p.fechaCreacion),
        formatDate(p.fechaEntrega),
        p.codigo || "",
        (p.customerName || p.clienteNombre || ""),
        p.clienteTipo || "",
        p.clienteTelefono || "",
        p.clienteDireccion || "",
        (p.clienteReferencia || "").replace(/\r?\n/g, " "),
        buildPedidoProductsExportTextPED(p),
        totalUnits,
        numOrEmpty(getPedidoSubtotalFromLinesPED(detail.lines)),
        p.pulsoCant ?? 0,
        p.pulsoPrecio ?? 0,
        p.pulsoDesc ?? 0,
        p.mediaCant ?? 0,
        p.mediaPrecio ?? 0,
        p.mediaDesc ?? 0,
        p.djebaCant ?? 0,
        p.djebaPrecio ?? 0,
        p.djebaDesc ?? 0,
        p.litroCant ?? 0,
        p.litroPrecio ?? 0,
        p.litroDesc ?? 0,
        p.galonCant ?? 0,
        p.galonPrecio ?? 0,
        p.galonDesc ?? 0,
        numOrEmpty(subPres),
        numOrEmpty(detail.descuento),
        numOrEmpty(detail.envio),
        numOrEmpty(detail.total),
        p.metodoPago || "",
        p.estadoPago || "",
        numOrEmpty(detail.pagoAnt),
        numOrEmpty(detail.saldo),
        (p.lotesRelacionados || "").replace(/\r?\n/g, " "),
        delivered ? "Sí" : "No",
      ];
    });

    const detailHeaders = [
      "Código",
      "Cliente",
      "Fecha fabricación",
      "Fecha entrega",
      "Producto",
      "Cantidad",
      "Precio snapshot",
      "Subtotal",
      "Origen"
    ];
    const detailRows = [];
    pedidos.forEach((p) => {
      const cliente = (p.customerName || p.clienteNombre || "");
      const detail = getPedidoTotalsForDisplayPED(p);
      detail.lines.forEach((item) => {
        const qty = Number(item.qty || 0) || 0;
        const unit = Number(item.unit || 0) || 0;
        const sub = Number(item.subtotal != null ? item.subtotal : (qty * unit));
        detailRows.push([
          p.codigo || "",
          cliente,
          formatDate(p.fechaCreacion),
          formatDate(p.fechaEntrega),
          item.label || "Producto",
          qty,
          numOrEmpty(unit),
          numOrEmpty(sub),
          item.source === 'legacy' ? 'Histórico' : 'Snapshot'
        ]);
      });
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((h) => ({ wch: Math.min(42, Math.max(12, String(h).length + 2)) }));
    XLSX.utils.book_append_sheet(wb, ws, "Pedidos");

    const wsDetail = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailRows]);
    wsDetail['!cols'] = [14, 26, 14, 14, 28, 10, 15, 14, 12].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, wsDetail, "Detalle productos");

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `arcano33_pedidos_${timestamp}.xlsx`;

    XLSX.writeFile(wb, filename);
    setStatus('Listo ✓');
  }catch(e){
    console.error('Export falló', e);
    setStatus('Falló');
    alert('No se pudo exportar. Probá de nuevo o recargá la página.');
  }finally{
    if (btn){
      btn.disabled = false;
      btn.textContent = prevText;
    }
    try{ if (btn && btn.dataset) btn.dataset.busy = '0'; }catch(_){ }
  }
}


window.addEventListener('storage', (event) => {
  try{
    const key = (window.A33Currency && window.A33Currency.storageKey) || 'suite_a33_currency_settings_v1';
    if (!event || event.key === key) renderPedidosCurrencyReference();
  }catch(_){ }
});


document.addEventListener("DOMContentLoaded", async () => {
  document.addEventListener('keydown', (event) => {
    try{
      if (event && event.key === 'Escape') closePedidoDetailModalPED();
    }catch(_){ }
  });
  await refreshPedidosProductCatalog(true);
  clearForm();
  renderPedidosCurrencyReference();

  // --- Cliente (desde POS) ---
  try{
    renderCustomerSelect('');
    setCustomerSelection({ id:'', name:'' });
  }catch(_){ }

  const clienteBuscar = $('clienteBuscar');
  if (clienteBuscar){
    clienteBuscar.addEventListener('input', () => {
      try{ renderCustomerSelect(clienteBuscar.value); }catch(_){ }
      // Mantener selección visible
      try{ setCustomerSelection(getCustomerFromUI()); }catch(_){ }
    });
  }

  const clienteSelect = $('clienteSelect');
  if (clienteSelect){
    clienteSelect.addEventListener('change', () => {
      try{ setCustomerSelection(getCustomerFromUI()); }catch(_){ }
    });
  }

  const newToggle = $('clienteNewToggle');
  if (newToggle){
    newToggle.addEventListener('click', () => {
      const box = $('clienteNewBox');
      const showing = box ? !box.hidden : false;
      toggleNewCustomerBox(!showing);
    });
  }

  const newCancel = $('clienteNewCancel');
  if (newCancel){
    newCancel.addEventListener('click', () => toggleNewCustomerBox(false));
  }

  const newSave = $('clienteNewSave');
  if (newSave){
    newSave.addEventListener('click', () => {
      const input = $('clienteNewName');
      const name = input ? input.value : '';
      const res = addNewCustomerToPosCatalog(name);
      if (!res || !res.ok){
        alert('Escribí un nombre válido para crear el cliente.');
        return;
      }

      // Refrescar lista y seleccionar
      try{ renderCustomerSelect(($('clienteBuscar') && $('clienteBuscar').value) ? $('clienteBuscar').value : ''); }catch(_){ }
      setCustomerSelection({ id: res.id || '', name: res.name || name });
      toggleNewCustomerBox(false);

      if (res.existed && res.isActive === false){
        alert('Ese cliente ya existía, pero está inactivo en POS. Se usará igual en este pedido.');
      }
    });
  }

  const newName = $('clienteNewName');
  if (newName){
    newName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter'){
        e.preventDefault();
        try{ newSave && newSave.click(); }catch(_){ }
      }
    });
  }

    $("pedido-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const res = await withSavingLock('Guardando…', async () => {
      // Cliente seleccionado/creado (viene del catálogo POS)
      const customer = getCustomerFromUI();
      if (!customer || !customer.name){
        return { ok:false, message:'Seleccioná un cliente del POS o creá uno nuevo.' };
      }

      // Validar números crudos (evitar NaN/valores raros)
      if (!pedidosCatalogProductsLoaded) await refreshPedidosProductCatalog(false);
      const productSelection = readPedidoProductsFromForm();
      if (!productSelection.ok) return productSelection;

      const nEnvio = readFiniteNumber('envio', 'Envío (C$)', { min: 0 });
      if (!nEnvio.ok) return nEnvio;
      const nDescuento = readFiniteNumber('descuento', 'Descuento (C$)', { min: 0 });
      if (!nDescuento.ok) return nDescuento;
      const nPagoAnt = readFiniteNumber('pagoAnticipado', 'Pago anticipado (C$)', { min: 0 });
      if (!nPagoAnt.ok) return nPagoAnt;

      const fechaCreacion = $("fechaCreacion").value || new Date().toISOString().slice(0, 10);
      const fechaEntrega = $("fechaEntrega").value || fechaCreacion;
      const codigo = $("codigoPedido").value || generateCodigo(fechaCreacion);

      // calcular totales antes de guardar (usa precios de Catálogos + fallback snapshot)
      const totales = await calcularTotalesDesdeFormulario();

      // Normalizar/recalcular con inputs validados (evita saldos negativos raros)
      totales.envio = nEnvio.value;
      totales.descuento = nDescuento.value;
      totales.pagoAnticipado = nPagoAnt.value;
      totales.totalPagar = (totales.subtotal || 0) - (totales.descuento || 0) + (totales.envio || 0);
      totales.saldoPendiente = (totales.totalPagar || 0) - (totales.pagoAnticipado || 0);
      try{
        $("totalPagar").value = Number(totales.totalPagar || 0).toFixed(2);
        $("saldoPendiente").value = Number(totales.saldoPendiente || 0).toFixed(2);
      }catch(_){}

      const legacyQty = productSelection.legacyQty || { pulso:0, media:0, djeba:0, litro:0, galon:0 };
      const items = enrichPedidoItemsWithCalculatedPricesPED(productSelection.items, totales.unitPricesUsed);
      const legacyPrices = buildLegacyUnitPricesFromSelectionPED(productSelection, totales.unitPricesUsed);

      const payload = {
        customer,
        fechaCreacion,
        fechaEntrega,
        codigo,
        qty: productSelection.qtyByKey || {},
        legacyQty,
        items,
        productosPedido: items,
        totales,
      };

      const v = validatePedidoBeforeSave(payload);
      if (!v.ok) return v;

      // ID estable: para pedidos nuevos usamos un draftId (idempotente en reintentos/recargas)
      let id = (editingId != null && editingId !== '') ? editingId : ensureDraftPedidoId(false);

      // Dedupe por código (reintentos): si ya existe un pedido con este código, no crear duplicado
      const pedidosNow = loadPedidos();
      const codigoKey = normalizeCodigoKey(codigo);
      const existingByCodigo = (codigoKey ? pedidosNow.find(p => normalizeCodigoKey(p && p.codigo) === codigoKey) : null);

      if ((editingId == null || editingId === '') && existingByCodigo){
        const exName = (existingByCodigo.customerName || existingByCodigo.clienteNombre || '');
        const sameCustomer = normalizeCustomerKey(exName) === normalizeCustomerKey(customer.name);
        const sameCre = formatDate(existingByCodigo.fechaCreacion) === formatDate(fechaCreacion);
        const sameEnt = formatDate(existingByCodigo.fechaEntrega) === formatDate(fechaEntrega);
        if (sameCustomer && sameCre && sameEnt){
          // reintento “sano”: actualizar el existente
          id = existingByCodigo.id;
          editingId = id;
        } else {
          return { ok:false, message:('El código ' + codigo + ' ya existe en otro pedido. Abrí ese pedido para editar o cambia el código.') };
        }
      }

      // Conflicto conservador: si se está editando y el pedido cambió en otra pestaña, bloquear
      if ((editingId != null && editingId !== '') && editingBaseUpdatedAt != null){
        const cur = pedidosNow.find(p => String(p && p.id) === String(editingId));
        const curUp = (cur && typeof cur.updatedAt === 'number') ? cur.updatedAt : null;
        if (curUp != null && curUp !== editingBaseUpdatedAt){
          return { ok:false, message:'Este pedido fue modificado en otra pestaña/dispositivo. Recargá y volvé a intentar.' };
        }
      }

      const estado = $("estado") ? $("estado").value : 'pendiente';
      const entregado = (estado === 'entregado');

      // Legacy: aproximar estado de pago a partir del anticipo
      const pagoAnt = Number(totales.pagoAnticipado || 0);
      let estadoPago = 'contraentrega';
      if (pagoAnt >= (totales.totalPagar - 0.001)) estadoPago = 'pagado';
      else if (pagoAnt > 0) estadoPago = 'adelanto';

      const nowMs = _nowMs();
      let createdAt = nowMs;
      try{
        const existingById = (Array.isArray(pedidosNow) ? pedidosNow : []).find(p => String(p && p.id) === String(id));
        const exCreated = existingById ? Number(existingById.createdAt || 0) : 0;
        if (exCreated && isFinite(exCreated)) createdAt = exCreated;
      }catch(_){ }

      const pedido = {
        id,
        createdAt,
        updatedAt: nowMs,
        fechaCreacion,
        fechaEntrega,
        codigo,
        prioridad: $("prioridad").value,

        // Nuevos campos (Pedidos v2)
        customerId: customer.id || '',
        customerName: customer.name,

        // Compat (UI existente / tabla / export): seguimos guardando clienteNombre
        clienteId: customer.id || '',
        clienteNombre: customer.name,
        clienteTipo: $("clienteTipo").value,
        clienteTelefono: $("clienteTelefono").value.trim(),
        // Dirección removida de UI: se mantiene hidden para compatibilidad
        clienteDireccion: $("clienteDireccion") ? $("clienteDireccion").value.trim() : '',
        clienteReferencia: $("clienteReferencia").value.trim(),

        // Cantidades legacy + productos dinámicos
        pulsoCant: legacyQty.pulso || 0,
        mediaCant: legacyQty.media || 0,
        djebaCant: legacyQty.djeba || 0,
        litroCant: legacyQty.litro || 0,
        galonCant: legacyQty.galon || 0,
        items,
        productosPedido: items,
        pedidoItems: items,

        // Snapshot de precios unitarios (aunque no se muestre en UI)
        priceSnapshot: totales.unitPricesUsed,

        // Legacy: mantener campos de precio/desc por línea para no romper pedidos viejos/export
        pulsoPrecio: legacyPrices.pulso || 0,
        pulsoDesc: 0,
        mediaPrecio: legacyPrices.media || 0,
        mediaDesc: 0,
        djebaPrecio: legacyPrices.djeba || 0,
        djebaDesc: 0,
        litroPrecio: legacyPrices.litro || 0,
        litroDesc: 0,
        galonPrecio: legacyPrices.galon || 0,
        galonDesc: 0,

        // Totales/Pagos (nuevo esquema)
        envio: totales.envio,
        subtotal: totales.subtotal,
        subtotalPresentaciones: totales.subtotal,
        descuento: totales.descuento,
        descuentoFijo: totales.descuento,
        descuentoTotal: totales.descuento,
        totalPagar: totales.totalPagar,
        pagoAnticipado: totales.pagoAnticipado,
        montoPagado: totales.pagoAnticipado,
        saldoPendiente: totales.saldoPendiente,
        metodoPago: $("metodoPago").value,
        estado,
        estadoPago,
        entregado,

        lotesRelacionados: $("lotesRelacionados").value.trim(),
      };

      // Mantener snapshot actual en memoria (fallback si POS no está disponible)
      currentPriceSnapshot = { ...(totales.unitPricesUsed || {}) };

      const pedidos = loadPedidos();
      const idx = pedidos.findIndex((p) => String(p.id) === String(pedido.id));
      const updated = Array.isArray(pedidos) ? [...pedidos] : [];
      if (idx >= 0) updated[idx] = pedido;
      else updated.push(pedido);

      const ok = savePedidos(updated);
      if (!ok) {
        return { ok:false, message:'No se pudo guardar. No se limpió el formulario.' };
      }
      if (!confirmPedidosPersisted(pedido.id)) {
        return { ok:false, message:'Guardado no confirmado. No se limpió el formulario. Recargá e intentá de nuevo.' };
      }

      return { ok:true };
    });

    if (!res || !res.ok){
      const msg = (res && res.message) ? res.message : 'No se pudo guardar el pedido.';
      showArchivedNotice(msg);
      alert(msg);
      return;
    }

    renderTable();
    clearForm();
    alert("Pedido guardado correctamente.");
  });

  $("reset-btn").addEventListener("click", () => clearForm());
  $("export-btn").addEventListener("click", () => { try{ exportToCSV(); }catch(_){ } });
    $("clear-all-btn").addEventListener("click", async () => {
    if (!confirm("¿Borrar todos los pedidos registrados?")) return;

    const res = await withSavingLock('Borrando…', async () => {
      try{
        A33Storage.removeItem(STORAGE_KEY_PEDIDOS);
      }catch(e){
        console.error('Error borrando pedidos', e);
        return { ok:false, message:'No se pudo borrar (error de almacenamiento).' };
      }

      const after = loadPedidos();
      if (Array.isArray(after) && after.length === 0) {
        return { ok:true };
      }
      return { ok:false, message:'Borrado no confirmado. Recargá e intentá de nuevo.' };
    });

    if (!res || !res.ok){
      const msg = (res && res.message) ? res.message : 'No se pudo borrar.';
      showArchivedNotice(msg);
      alert(msg);
      return;
    }

    renderTable();
    clearForm();
    showArchivedNotice("Borrado ✓");
  });
  $("calc-totals-btn").addEventListener("click", async () => {
    try { await calcularTotalesDesdeFormulario(); } catch {}
  });

  // Auto-actualizar totales al cambiar envío/descuento/anticipo.
  // Las cantidades dinámicas se enlazan al renderizar productos desde Catálogos.
  [
    'envio','descuento','pagoAnticipado'
  ].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('change', () => {
      calcularTotalesDesdeFormulario().catch(() => {});
    });
  });
  renderTable();
  renderArchivedTable();

  // --- Búsqueda (debounced) + paginación ---
  const activeSearch = $("active-search");
  if (activeSearch){
    const onActiveSearch = debounce(() => {
      activeLimit = A33_TABLE_PAGE_SIZE;
      try{ renderTable(); }catch(_){ }
    }, 140);
    activeSearch.addEventListener("input", onActiveSearch);
  }

  const archSearch = $("archived-search");
  if (archSearch){
    const onArchSearch = debounce(() => {
      archivedLimit = A33_TABLE_PAGE_SIZE;
      try{ renderArchivedTable(); }catch(_){ }
    }, 140);
    archSearch.addEventListener("input", onArchSearch);
  }

  const moreActive = $("active-load-more");
  if (moreActive){
    moreActive.addEventListener('click', () => {
      activeLimit = Math.max(A33_TABLE_PAGE_SIZE, Number(activeLimit || 0)) + A33_TABLE_PAGE_SIZE;
      try{ renderTable(); }catch(_){ }
    });
  }

  const moreArch = $("archived-load-more");
  if (moreArch){
    moreArch.addEventListener('click', () => {
      archivedLimit = Math.max(A33_TABLE_PAGE_SIZE, Number(archivedLimit || 0)) + A33_TABLE_PAGE_SIZE;
      try{ renderArchivedTable(); }catch(_){ }
    });
  }

  // --- Detalles (toggle de columnas opcionales en iPad) ---
  function setDetailsMode(on){
    try{ document.body.classList.toggle('a33-show-details', !!on); }catch(_){ }
    const b1 = $("details-toggle");
    const b2 = $("archived-details-toggle");
    [b1,b2].forEach((b) => {
      if (!b) return;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = on ? 'Detalles ✓' : 'Detalles';
    });
  }
  function toggleDetails(){
    const on = document.body && document.body.classList ? document.body.classList.contains('a33-show-details') : false;
    setDetailsMode(!on);
  }
  const detBtn = $("details-toggle");
  if (detBtn) detBtn.addEventListener('click', toggleDetails);
  const detBtn2 = $("archived-details-toggle");
  if (detBtn2) detBtn2.addEventListener('click', toggleDetails);
  setDetailsMode(false);

  registerServiceWorker();
});

// --- Service worker (opcional) ---
function registerServiceWorker() {
  try {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js?v=4.20.84&r=18').catch((err) => {
      console.warn('Pedidos: no se pudo registrar el Service Worker', err);
    });
  } catch (err) {
    console.warn('Pedidos: error al registrar Service Worker', err);
  }
}
