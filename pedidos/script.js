function getPedidoEstado(p){
  const raw = String(p && (p.estado || (p.entregado ? 'entregado' : 'pendiente')) || 'pendiente').trim().toLowerCase();
  return ['pendiente','en_preparacion','listo','entregado','cancelado'].includes(raw) ? raw : 'pendiente';
}

function pedidoEstadoLabelPED(value){
  return {pendiente:'Pendiente',en_preparacion:'En preparación',listo:'Listo',entregado:'Entregado',cancelado:'Cancelado'}[value] || 'Pendiente';
}

const STORAGE_KEY_PEDIDOS = "arcano33_pedidos";
const STORAGE_KEY_PEDIDOS_ARCHIVED = "arcano33_pedidos_archived";
const STORAGE_KEY_PEDIDOS_RAPIDOS = "arcano33_pedidos_rapidos_v1";
const PEDIDO_RAPIDO_SCHEMA_VERSION = 1;
let viewingArchivedId = null;
let editingId = null;
let editingBaseUpdatedAt = null;
let editingBaseRecordPED = null;

// E5.8: la versión pertenece al formulario abierto, no a una lectura posterior de la tabla.
function pedidoEditorConflictPED(mode,records){
  const id=mode==='rapido'?quickOrderEditingId:editingId;
  if (id==null || id==='') return '';
  const base=mode==='rapido'?quickOrderBaseRecordPED:editingBaseRecordPED;
  const current=records.find(row=>String(row.id)===String(id));
  const fp=window.A33Storage && A33Storage.recordFingerprint;
  if (!base || !current || !fp || fp(base)!==fp(current)) return 'Este pedido cambió o fue eliminado. Los cambios pendientes se conservan; abre el pedido vigente para revisarlo.';
  return '';
}

// --- Identidad estable del pedido (anti-duplicados por reintentos) ---
const PEDIDOS_DRAFT_KEY = 'a33_pedidos_draft_v1';
let draftPedidoId = null;

function _nowMs(){ return Date.now(); }

function normalizeQuickOrderTextPED(value){
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function isExactQuickOrderDatePED(value){
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function quickOrderStableHashPED(value){
  let hash = 2166136261;
  const raw = String(value || '');
  for (let i=0;i<raw.length;i++){
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

function createQuickOrderIdPED(now){
  const stamp = Number(now || Date.now());
  return 'pr_' + stamp.toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

function generateQuickOrderCodePED(fechaEntrega, records){
  const date = String(fechaEntrega || '').slice(0, 10);
  if (!isExactQuickOrderDatePED(date)) return '';
  const compact = date.replace(/-/g, '');
  const prefix = 'PR-' + compact + '-';
  let max = 0;
  (Array.isArray(records) ? records : []).forEach((record) => {
    const code = String(record && record.codigo || '').trim().toUpperCase();
    if (!code.startsWith(prefix)) return;
    const suffix = code.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) return;
    max = Math.max(max, Number(suffix));
  });
  return prefix + String(max + 1).padStart(3, '0');
}

function normalizeQuickOrderItemPED(raw){
  if (!raw || typeof raw !== 'object') return null;
  const snapshot = (raw.productSnapshot && typeof raw.productSnapshot === 'object')
    ? { ...raw.productSnapshot }
    : {};
  const productId = String(raw.productId ?? raw.productoId ?? raw.catalogProductId ?? '').trim();
  const productNameSnapshot = normalizeQuickOrderTextPED(
    raw.productNameSnapshot ?? raw.productName ?? raw.nombreSnapshot ?? raw.nombre ?? raw.name ??
    snapshot.nombre ?? snapshot.name ?? ''
  );
  const cantidad = Number(raw.cantidad ?? raw.qty ?? raw.quantity ?? raw.unidades ?? 0);
  const cleanSnapshot = { ...snapshot };
  if (productId && !cleanSnapshot.productId) cleanSnapshot.productId = productId;
  if (productNameSnapshot && !cleanSnapshot.nombre && !cleanSnapshot.name) cleanSnapshot.nombre = productNameSnapshot;
  return { productId, productNameSnapshot, cantidad, productSnapshot:cleanSnapshot };
}

function normalizeQuickOrderPED(raw){
  if (!raw || typeof raw !== 'object') return null;
  const source = { ...raw };
  const customer = (source.customer && typeof source.customer === 'object') ? source.customer : {};
  const arrays = [source.items, source.productosPedido, source.pedidoItems, source.productos];
  const rawItems = arrays.find(Array.isArray) || [];
  const items = rawItems.map(normalizeQuickOrderItemPED).filter(Boolean);
  const fechaEntrega = String(source.fechaEntrega ?? source.deliveryDate ?? source.fechaEntregaPedido ?? '').slice(0, 10);
  const customerId = String(source.customerId ?? source.clienteId ?? customer.id ?? '').trim();
  const customerName = normalizeQuickOrderTextPED(source.customerName ?? source.clienteNombre ?? source.cliente ?? customer.name ?? customer.nombre ?? '');
  const rawState = String(source.estado || '').trim().toLowerCase();
  const estado = ['en_preparacion','listo','cancelado'].includes(rawState) ? rawState : (rawState === 'entregado' || source.entregado === true ? 'entregado' : 'pendiente');
  const createdAt = Number(source.createdAt || 0);
  const updatedAt = Number(source.updatedAt || createdAt || 0);
  const identity = [source.codigo || '', fechaEntrega, customerId, customerName, JSON.stringify(items)].join('|');
  return {
    ...source,
    id:String(source.id || '').trim() || ('pr_legacy_' + quickOrderStableHashPED(identity)),
    tipoPedido:'rapido',
    schemaVersion:Math.max(PEDIDO_RAPIDO_SCHEMA_VERSION, Number(source.schemaVersion || 1) || 1),
    codigo:String(source.codigo || '').trim().toUpperCase(),
    customerId,
    customerName,
    fechaEntrega,
    prioridad:String(source.prioridad || '').toLowerCase() === 'alta' ? 'alta' : 'normal',
    estado,
    entregado:estado === 'entregado',
    createdAt:Number.isFinite(createdAt) ? createdAt : 0,
    updatedAt:Number.isFinite(updatedAt) ? updatedAt : 0,
    deliveredAt:estado === 'entregado' ? String(source.deliveredAt || source.entregadoAt || '') : '',
    items
  };
}

function validateQuickOrderPED(raw){
  const order = normalizeQuickOrderPED(raw);
  const errors = [];
  if (!order) return { ok:false, errors:['Datos inválidos.'], message:'Datos inválidos.' };
  const rawPriority = String(raw && raw.prioridad || '').toLowerCase();
  const rawState = String(raw && raw.estado || '').toLowerCase();
  if (!order.id) errors.push('ID obligatorio.');
  if (!/^PR-\d{8}-\d{3,}$/.test(order.codigo)) errors.push('Código rápido inválido.');
  if (!order.customerName) errors.push('Cliente obligatorio.');
  if (!isExactQuickOrderDatePED(order.fechaEntrega)) errors.push('Fecha de entrega inválida.');
  if (!['normal','alta'].includes(rawPriority)) errors.push('Prioridad inválida.');
  if (!['pendiente','en_preparacion','listo','entregado','cancelado'].includes(rawState)) errors.push('Estado inválido.');
  if (!order.items.length) errors.push('Agregá al menos un producto.');

  const seen = new Set();
  order.items.forEach((item, index) => {
    if (!item.productId) errors.push('Producto ' + (index + 1) + ': productId obligatorio.');
    if (!item.productNameSnapshot) errors.push('Producto ' + (index + 1) + ': nombre obligatorio.');
    if (!Number.isInteger(item.cantidad) || item.cantidad < 1) errors.push('Producto ' + (index + 1) + ': cantidad debe ser un entero mínimo de 1.');
    if (item.productId){
      if (seen.has(item.productId)) errors.push('Producto ' + (index + 1) + ': no puede repetirse en el mismo pedido.');
      seen.add(item.productId);
    }
  });
  return { ok:errors.length === 0, errors, message:errors.length ? 'No se puede guardar:\n- ' + errors.join('\n- ') : '', data:order };
}

function loadQuickOrdersPED(){
  try{
    if (window.A33Storage && typeof A33Storage.sharedGet === 'function'){
      const rows = A33Storage.sharedGet(STORAGE_KEY_PEDIDOS_RAPIDOS, [], 'local');
      return (Array.isArray(rows) ? rows : []).map(normalizeQuickOrderPED).filter(Boolean);
    }
  }catch(error){
    console.warn('Pedidos rápidos: no se pudo leer el contrato compartido', error);
  }
  return [];
}

function saveQuickOrdersPED(records,recordIds){
  const rows = (Array.isArray(records) ? records : []).map(normalizeQuickOrderPED).filter(Boolean);
  if (!(window.A33Storage && typeof A33Storage.sharedSet === 'function')) return { ok:false, data:rows, message:'A33Storage no disponible.' };
  return A33Storage.sharedSet(STORAGE_KEY_PEDIDOS_RAPIDOS, rows, { source:'pedidos-rapidos', recordIds });
}

window.A33PedidosRapidosModel = Object.freeze({
  storageKey:STORAGE_KEY_PEDIDOS_RAPIDOS,
  schemaVersion:PEDIDO_RAPIDO_SCHEMA_VERSION,
  createId:createQuickOrderIdPED,
  generateCode:generateQuickOrderCodePED,
  normalizeItem:normalizeQuickOrderItemPED,
  normalize:normalizeQuickOrderPED,
  validate:validateQuickOrderPED,
  load:loadQuickOrdersPED,
  save:saveQuickOrdersPED
});

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
    window.A33Notice.show(label || 'Guardando…', 'process');
  } else {
    if (!A33Saving.active) return;
    if (sb && A33Saving.saveBtnText) sb.textContent = A33Saving.saveBtnText;
    _setAllButtonsDisabled(false);
    A33Saving.active = false;
    window.A33Notice.finish();
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
  out.estado = getPedidoEstado(out);
  out.entregado = out.estado === 'entregado';

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
    const extra = [p && p.clienteTelefono, p && p.clienteTipo, productText, p && p.lotesRelacionados, pedidoLotesResumenPED(p)].filter(Boolean).join(' ');
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

function savePedidos(list,recordIds) {
  const arr = Array.isArray(list) ? list : [];

  try {
    if (window.A33Storage && typeof A33Storage.sharedSet === 'function') {
      const r = A33Storage.sharedSet(STORAGE_KEY_PEDIDOS, arr, { source: 'pedidos', recordIds });
      if (!r || !r.ok) {
        console.warn('No se pudo guardar pedidos', r);
        showArchivedNotice((r && r.message) ? r.message : 'No se pudo guardar (conflicto). Recarga e intenta de nuevo.');
        return false;
      }
      return true;
    }
  } catch (e) {
    console.warn('Error guardando pedidos (sharedSet)', e);
    showArchivedNotice('No se pudo confirmar el guardado de pedidos. Comprobá los datos antes de reintentar.');
    return false;
  }

  try {
    if (!A33Storage.setItem(STORAGE_KEY_PEDIDOS, JSON.stringify(arr))){
      showArchivedNotice('No se pudo guardar pedidos en este navegador.');
      return false;
    }
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

function productStableIdPED(product){
  const p = product && typeof product === 'object' ? product : {};
  try{
    if (window.A33Products && typeof window.A33Products.getProductId === 'function'){
      return String(window.A33Products.getProductId(p) || '').trim();
    }
  }catch(_){ }
  return String(p.productId ?? p.productoId ?? p.catalogProductId ?? '').trim();
}

function buildProductSnapshotPED(product, fallback){
  const p = product && typeof product === 'object' ? product : {};
  const fb = fallback && typeof fallback === 'object' ? fallback : {};
  const productId = productStableIdPED(p) || String(fb.productId ?? '').trim();
  const internalIdRaw = p.id ?? fb.internalId ?? fb.catalogInternalId ?? null;
  const internalId = Number(internalIdRaw);
  const nombre = String(p.name ?? p.nombre ?? p.productName ?? p.nombreSnapshot ?? fb.productName ?? fb.nombre ?? fb.name ?? '').replace(/\s+/g, ' ').trim();
  const precioRaw = p.price ?? p.precio ?? p.unitPrice ?? p.precioVenta ?? fb.unitPriceSnapshot ?? fb.unitPrice ?? fb.precio ?? 0;
  const precio = Number(String(precioRaw ?? 0).replace(',', '.'));
  const activo = productActivePED(p);
  const letra = productLetterPED({ ...fb, ...p });
  const snap = {
    id: productId,
    productId,
    internalId: Number.isFinite(internalId) && internalId > 0 ? internalId : null,
    nombre,
    name: nombre,
    precio: Number.isFinite(precio) && precio >= 0 ? precio : 0,
    price: Number.isFinite(precio) && precio >= 0 ? precio : 0,
    activo,
    capturedAt: new Date().toISOString()
  };
  if (letra) snap.letra = letra;
  return snap;
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

  const productId = productStableIdPED(p);
  if (!productId) return null;
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

function productDisplayCapacityPED(product){
  const p = product && typeof product === 'object' ? product : {};
  for (const value of [p.capacityMl,p.capacidadMl,p.capacity,p.capacidad,p.volumeMl,p.volumenMl,p.ml,p.mililitros,p.sizeMl]){
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  try{
    const rows = JSON.parse(localStorage.getItem('a33_catalog_envases_v1') || '[]');
    const id = String(p.envaseId ?? p.envase_id ?? p.bottleId ?? '').trim();
    const envase = id && Array.isArray(rows) ? rows.find(row => row && String(row.id || '').trim() === id) : null;
    if (envase){
      for (const value of [envase.capacityMl,envase.capacidadMl,envase.ml,envase.volumeMl,envase.capacidad]){
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  }catch(_){ }
  const match = String(p.name || p.nombre || p.label || p.productNameSnapshot || '').match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
  const capacity = match ? Number(match[1].replace(',','.')) : 0;
  return capacity > 0 ? capacity : Infinity;
}

function compareProductDisplayPED(a,b){
  const source = (item) => {
    const current = PRESENTACIONES.find(p => p.productId && p.productId === (item && item.productId));
    return { ...(current && current.rawProduct || {}), ...(item && item.productSnapshot || {}), ...(item || {}) };
  };
  const ca = productDisplayCapacityPED(source(a)), cb = productDisplayCapacityPED(source(b));
  if (ca !== cb) return ca < cb ? -1 : 1;
  return String(a && (a.name || a.nombre || a.label || a.productNameSnapshot) || '').localeCompare(String(b && (b.name || b.nombre || b.label || b.productNameSnapshot) || ''),'es-NI',{sensitivity:'base'});
}

function sortPedidoProductItemsPED(a, b){
  const capacityOrder = compareProductDisplayPED({ ...(a && a.rawProduct || {}), name:a && a.label }, { ...(b && b.rawProduct || {}), name:b && b.label });
  if (capacityOrder) return capacityOrder;
  const byName = String((a && a.label) || '').localeCompare(String((b && b.label) || ''), 'es-NI', { sensitivity:'base' });
  if (byName) return byName;
  return String((a && a.productId) || '').localeCompare(String((b && b.productId) || ''));
}

async function getPedidosCatalogProductsSafe(){
  const rows = await getAllPosProductsSafe();
  const usedIds = new Set();
  const out = [];
  for (const product of (Array.isArray(rows) ? rows : [])){
    const item = productToPedidoItemPED(product);
    if (!item || !item.productId || usedIds.has(item.productId)) continue;
    usedIds.add(item.productId);
    out.push(item);
  }
  const counts = new Map();
  out.forEach((item) => {
    const key = compactProductKeyPED(item.label);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  out.forEach((item) => {
    const key = compactProductKeyPED(item.label);
    item.displayLabel = (counts.get(key) || 0) > 1
      ? `${item.label} · ${String(item.productId).slice(-6)}`
      : item.label;
  });
  return out.sort(sortPedidoProductItemsPED);
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
    productNameSnapshot: productName,
    qty,
    unitPriceSnapshot,
    priceSnapshot: unitPriceSnapshot,
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
    setPedidosProductsStatus('Cree o active productos desde Catálogos → Productos para crear pedidos.', 'warn');
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
    nameTd.textContent = pres.displayLabel || pres.label || 'Producto';
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
  const pid = String(item.productId ?? item.productoId ?? '').trim();
  const pkey = String(item.productKey ?? item.key ?? '').trim();
  return (!!pid && pid === String(pres.productId || '').trim())
    || (!!pkey && pkey === pres.key && pkey === ('product:' + String(pres.productId || '').trim()));
}

function itemMustRemainHistoricalPED(item, pres){
  if (!itemMatchesPresentationPED(item, pres)) return true;
  const savedName = getPedidoItemNamePED(item);
  const currentName = String(pres && pres.label || '').replace(/\s+/g, ' ').trim();
  const savedPrice = getPedidoItemUnitPricePED(item);
  const currentPrice = Number(pres && pres.price) || 0;
  return compactProductKeyPED(savedName) !== compactProductKeyPED(currentName)
    || Math.abs(savedPrice - currentPrice) > 0.000001;
}

function getPedidoQuantityForPresentation(pedido, pres){
  const items = getPedidoProductItemsArray(pedido);
  for (const item of items){
    if (!itemMatchesPresentationPED(item, pres) || itemMustRemainHistoricalPED(item, pres)) continue;
    const qty = getPedidoItemQtyPED(item);
    if (qty > 0) return qty;
  }
  // Los campos legacy se muestran como históricos; jamás rellenan un producto activo por nombre/familia.
  return 0;
}

function pushHistoricalPedidoItemPED(out, seen, item){
  const normalized = normalizePedidoItemForStoragePED(item, item && item.productSnapshot);
  const qty = getPedidoItemQtyPED(normalized);
  if (!(qty > 0)) return;
  // Solo una identidad persistida puede deduplicar. Un nombre histórico nunca es identidad.
  const uniq = String(normalized.productId || normalized.productKey || '').trim();
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
    const active = (Array.isArray(PRESENTACIONES) ? PRESENTACIONES : []).find((pres) => itemMatchesPresentationPED(item, pres));
    if (active && !itemMustRemainHistoricalPED(item, active)) continue;
    pushHistoricalPedidoItemPED(out, seen, item);
  }

  LEGACY_PRESENTACIONES.forEach((pres) => {
    const qty = parseNumber(pedido && pedido[pres.qtyId] != null ? pedido[pres.qtyId] : 0);
    if (!(qty > 0)) return;
    // Los campos legacy permanecen históricos aunque exista hoy un producto con nombre parecido.
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
    const stable = String(item.productId || '').trim();
    const key = stable
      ? [stable, getPedidoItemNamePED(item), getPedidoItemUnitPricePED(item), item.source || ''].join('|')
      : String(item.productKey || '').trim();
    // Registros antiguos sin ID/clave se conservan uno por uno; no se fusionan por texto.
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
    // Sin ID/clave, cada línea histórica permanece independiente; jamás se fusiona por nombre.
    const uniq = key || (pid ? ('product:' + pid) : '') || (legacyKey ? ('legacy:' + legacyKey) : '');
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
      productId: pid,
      productKey: key,
      identityKey: pid ? ('product:' + pid) : (key || (legacyKey ? ('legacy:' + legacyKey) : '')),
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
  setTextPED('pedido-detail-status', pedidoEstadoLabelPED(estado));
  setTextPED('pedido-detail-entregas', pedidoEntregasResumenPED(p, 'completo'));
  setTextPED('pedido-detail-linked-lots', pedidoLotesResumenPED(p));

  renderPedidoDetailModalProductRowsPED(t.lines.slice().sort(compareProductDisplayPED));

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
  }catch(_){ return false; }

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

async function getAllPosProductsSafe() {
  try{
    if (window.A33Products && typeof window.A33Products.getAll === 'function'){
      const rows = await window.A33Products.getAll();
      return Array.isArray(rows) ? rows : [];
    }
  }catch(err){
    console.warn('Pedidos: no se pudo leer el contrato central de Productos', err);
    return [];
  }
  // Compatibilidad técnica de lectura; nunca crea ni completa Productos.
  return new Promise(async (resolve) => {
    const db = await openPosDB();
    if (!db) return resolve([]);
    try {
      const store = db.transaction('products', 'readonly').objectStore('products');
      const req = store.getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch (_) {
      resolve([]);
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

function clearForm(options = {}) {
  if(!discardCurrentPedidoDraftPED('completo', options.discard === true))return false;
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
  editingBaseRecordPED = null;
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
  if(!discardCurrentPedidoDraftPED('completo',false))return false;
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

  if ($('estado')) $('estado').value = getPedidoEstado(pedido);

  currentPriceSnapshot = getPriceSnapshotFromPedido(pedido);

  $("lotesRelacionados").value = pedido.lotesRelacionados || "";

  editingId = pedido.id;
  editingBaseRecordPED=JSON.parse(JSON.stringify(pedido));
  $("save-btn").textContent = "Actualizar pedido";
  editingBaseUpdatedAt = (pedido && typeof pedido.updatedAt === 'number') ? pedido.updatedAt : null;
  try{ clearDraftPedido(); }catch(_){ }
}

function renderTable() {
  refreshPedidoDemandaIfOpenPED();
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
    entregadoTd.textContent = pedidoEstadoLabelPED(getPedidoEstado(p)) + ' · ' + pedidoEntregasResumenPED(p, 'completo');
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
    accionesTd.appendChild(createPedidoEntregasButtonPED(p.id, 'completo'));
    accionesTd.appendChild(createPedidoLotesButtonPED(p.id, 'completo'));
    accionesTd.appendChild(borrarBtn);
    tr.appendChild(accionesTd);

    tbody.appendChild(tr);
  });
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
    pill.textContent = pedidoEstadoLabelPED(estado);
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
        if(populateForm(p) === false)return;
        viewingArchivedId = p.id;
        // Guardar desde un archivado debe crear uno nuevo (no editar)
        editingId = null;
        editingBaseRecordPED = null;
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
  lines.push(`  Estado: ${pedidoEstadoLabelPED(estado)}`);
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

    const okAct = savePedidos(newPedidos,[id]);
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
    window.A33Notice.alert(msg);
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
    window.A33Notice.alert(msg);
    return;
  }

  renderArchivedTable();
  showArchivedNotice('Borrado ✓');
}

// --- Pedido rápido: vista operativa aislada del Pedido completo ---
const QUICK_ORDER_PAGE_SIZE = 30;
let quickOrderItemsDraft = [];
let quickOrderEditingId = null;
let quickOrderEditingUpdatedAt = null;
let quickOrderBaseRecordPED = null;
let quickPendingLimit = QUICK_ORDER_PAGE_SIZE;
let quickHistoryLimit = QUICK_ORDER_PAGE_SIZE;

function setQuickOrderNoticePED(message, kind){
    window.A33Notice.show(message, kind);
  const el = $('quick-form-notice');
  if (!el) return;
  el.textContent = String(message || '');
  el.className = 'inline-notice' + (kind ? (' ' + kind) : '');
}

function quickOrderProductSummaryPED(order){
  return (order && Array.isArray(order.items) ? order.items : [])
    .filter((item) => Number(item && item.cantidad) > 0)
    .map((item) => `${Number(item.cantidad)} ${item.productNameSnapshot || 'Producto'}`)
    .join(' · ');
}

function quickOrderSearchTextPED(order){
  return normalizeCustomerKey([
    order && order.codigo,
    order && order.customerName,
    order && order.fechaEntrega,
    order && order.prioridad,
    pedidoEstadoLabelPED(getPedidoEstado(order)),
    pedidoLotesResumenPED(order),
    quickOrderProductSummaryPED(order)
  ].filter(Boolean).join(' '));
}

function renderQuickCustomerSelectPED(filterText, selected){
  const select = $('quick-customer-select');
  if (!select) return;
  const previous = selected || select.value;
  const filter = normalizeCustomerKey(filterText || '');
  rebuildCustomersCache();
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Seleccionar cliente…';
  select.appendChild(placeholder);
  (customersCache.list || []).forEach((customer) => {
    if (filter && !normalizeCustomerKey(customer.name).includes(filter)) return;
    const option = document.createElement('option');
    option.value = customer.id ? ('id:' + customer.id) : ('name:' + normalizeCustomerKey(customer.name));
    option.textContent = customer.name;
    option.dataset.id = customer.id || '';
    option.dataset.name = customer.name;
    select.appendChild(option);
  });
  if (previous && Array.from(select.options).some((option) => option.value === previous)) select.value = previous;
  const status = $('quick-customer-status');
  if (status) status.textContent = select.value ? 'Cliente seleccionado del catálogo compartido.' : 'Seleccioná un cliente del catálogo de la Suite.';
}

function getQuickCustomerPED(){
  const select = $('quick-customer-select');
  const option = select && select.selectedOptions ? select.selectedOptions[0] : null;
  return {
    id:option && option.dataset ? String(option.dataset.id || '') : '',
    name:option && option.dataset ? normalizeQuickOrderTextPED(option.dataset.name || '') : ''
  };
}

function ensureQuickHistoricalCustomerPED(order){
  const select = $('quick-customer-select');
  if (!select || !order || !order.customerName) return '';
  const expected = order.customerId ? ('id:' + order.customerId) : ('name:' + normalizeCustomerKey(order.customerName));
  if (!Array.from(select.options).some((option) => option.value === expected)){
    const option = document.createElement('option');
    option.value = expected;
    option.textContent = order.customerName + ' (guardado)';
    option.dataset.id = order.customerId || '';
    option.dataset.name = order.customerName;
    select.appendChild(option);
  }
  select.value = expected;
  return expected;
}

function renderQuickProductSelectPED(){
  const select = $('quick-product-select');
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = PRESENTACIONES.length ? 'Seleccionar producto activo…' : 'No hay productos activos';
  select.appendChild(placeholder);
  PRESENTACIONES.forEach((product) => {
    if (quickOrderItemsDraft.some((item) => item.productId === product.productId)) return;
    const option = document.createElement('option');
    option.value = product.productId;
    option.textContent = product.displayLabel || product.label;
    select.appendChild(option);
  });
  if (previous && Array.from(select.options).some((option) => option.value === previous)) select.value = previous;
}

function renderQuickProductLinesPED(){
  const host = $('quick-product-lines');
  if (!host) return;
  host.innerHTML = '';
  if (!quickOrderItemsDraft.length){
    const empty = document.createElement('div');
    empty.className = 'quick-order-empty';
    empty.textContent = 'Todavía no agregaste productos.';
    host.appendChild(empty);
    renderQuickProductSelectPED();
    return;
  }
  quickOrderItemsDraft.map((item,index) => ({item,index})).sort((a,b) => compareProductDisplayPED(
    { ...(a.item.productSnapshot || {}), name:a.item.productNameSnapshot },
    { ...(b.item.productSnapshot || {}), name:b.item.productNameSnapshot }
  )).forEach(({item,index}) => {
    const row = document.createElement('div');
    row.className = 'quick-product-line';
    const name = document.createElement('strong');
    name.textContent = item.productNameSnapshot || 'Producto';
    const quantity = document.createElement('input');
    quantity.type = 'number';
    quantity.min = '1';
    quantity.step = '1';
    quantity.value = String(item.cantidad || 1);
    quantity.dataset.draftIndex = String(index);
    quantity.setAttribute('aria-label', 'Cantidad de ' + (item.productNameSnapshot || 'producto'));
    quantity.addEventListener('change', () => {
      const value = Number(quantity.value);
      if (!Number.isInteger(value) || value < 1){
        quantity.value = String(item.cantidad || 1);
        setQuickOrderNoticePED('La cantidad mínima es 1 y debe ser entera.', 'warn');
        return;
      }
      quickOrderItemsDraft[index].cantidad = value;
      setQuickOrderNoticePED('');
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-danger a33-icon-btn';
    remove.textContent = '×';
    remove.title = 'Quitar producto';
    remove.setAttribute('aria-label', 'Quitar ' + (item.productNameSnapshot || 'producto'));
    remove.addEventListener('click', () => {
      quickOrderItemsDraft.splice(index, 1);
      renderQuickProductLinesPED();
    });
    row.append(name, quantity, remove);
    host.appendChild(row);
  });
  renderQuickProductSelectPED();
}

function updateQuickCodePreviewPED(){
  const el = $('quick-order-code-preview');
  if (!el) return;
  const date = $('quick-delivery-date') ? $('quick-delivery-date').value : '';
  if (quickOrderEditingId){
    const current = loadQuickOrdersPED().find((order) => String(order.id) === String(quickOrderEditingId));
    el.textContent = current && current.codigo ? current.codigo : 'Código guardado';
  } else {
    el.textContent = generateQuickOrderCodePED(date, loadQuickOrdersPED()) || 'Código pendiente';
  }
}

function resetQuickOrderFormPED(options = {}){
  if(!discardCurrentPedidoDraftPED('rapido',options.discard === true))return false;
  quickOrderDraftIdPED = null;
  quickOrderItemsDraft = [];
  quickOrderEditingId = null;
  quickOrderEditingUpdatedAt = null;
  quickOrderBaseRecordPED = null;
  const form = $('quick-order-form');
  if (form) form.reset();
  const today = new Date().toISOString().slice(0, 10);
  if ($('quick-delivery-date')) $('quick-delivery-date').value = today;
  if ($('quick-priority')) $('quick-priority').value = 'normal';
  if ($('quick-status')) $('quick-status').value = 'pendiente';
  if ($('quick-customer-search')) $('quick-customer-search').value = '';
  if ($('quick-product-quantity')) $('quick-product-quantity').value = '1';
  renderQuickCustomerSelectPED('', '');
  renderQuickProductLinesPED();
  updateQuickCodePreviewPED();
  setQuickOrderNoticePED('');
  if ($('quick-order-form-title')) $('quick-order-form-title').textContent = 'Nuevo Pedido rápido';
  if ($('quick-save-btn')) $('quick-save-btn').textContent = 'Guardar Pedido rápido';
}

function editQuickOrderPED(id){
  if(!discardCurrentPedidoDraftPED('rapido',false))return false;
  const order = loadQuickOrdersPED().find((item) => String(item.id) === String(id));
  if (!order) return;
  quickOrderEditingId = order.id;
  quickOrderBaseRecordPED=JSON.parse(JSON.stringify(order));
  quickOrderEditingUpdatedAt = Number(order.updatedAt || 0);
  quickOrderItemsDraft = order.items.map((item) => ({ ...item, productSnapshot:{ ...(item.productSnapshot || {}) } }));
  renderQuickCustomerSelectPED('', '');
  ensureQuickHistoricalCustomerPED(order);
  if ($('quick-delivery-date')) $('quick-delivery-date').value = order.fechaEntrega;
  if ($('quick-priority')) $('quick-priority').value = order.prioridad;
  if ($('quick-status')) $('quick-status').value = order.estado;
  renderQuickProductLinesPED();
  updateQuickCodePreviewPED();
  if ($('quick-order-form-title')) $('quick-order-form-title').textContent = 'Editar Pedido rápido';
  if ($('quick-save-btn')) $('quick-save-btn').textContent = 'Actualizar Pedido rápido';
  setQuickOrderNoticePED('Editando ' + order.codigo + '.');
  window.scrollTo({ top:0, behavior:'smooth' });
}

function mutateQuickOrderPED(id, updater){
  const records = loadQuickOrdersPED();
  const index = records.findIndex((order) => String(order.id) === String(id));
  if (index < 0) return { ok:false, message:'Pedido rápido no encontrado.' };
  const updated = updater({ ...records[index], items:records[index].items.map((item) => ({ ...item })) });
  if (!updated) return { ok:false, message:'Operación cancelada.' };
  records[index] = updated;
  return saveQuickOrdersPED(records,[id]);
}

function setQuickOrderDeliveredPED(id, delivered){
  const label = delivered ? '¿Marcar este Pedido rápido como Entregado?' : '¿Reabrir este Pedido rápido como Pendiente?';
  if (!confirm(label)) return;
  const now = Date.now();
  const result = mutateQuickOrderPED(id, (order) => ({
    ...order,
    estado:delivered ? 'entregado' : 'pendiente',
    entregado:!!delivered,
    deliveredAt:delivered ? new Date(now).toISOString() : '',
    updatedAt:now
  }));
  if (!result || !result.ok){
    window.A33Notice.alert((result && result.message) || 'No se pudo actualizar el Pedido rápido.');
    return;
  }
  if (String(quickOrderEditingId) === String(id)) resetQuickOrderFormPED();
  renderQuickOrdersPED();
}

function deleteQuickOrderPED(id){
  const records = loadQuickOrdersPED();
  const order = records.find((item) => String(item.id) === String(id));
  if (!order) return;
  if (!confirm(`¿Borrar definitivamente ${order.codigo || 'este Pedido rápido'}?\n\nEsta acción no se puede deshacer.`)) return;
  const result = saveQuickOrdersPED(records.filter((item) => String(item.id) !== String(id)),[id]);
  if (!result || !result.ok){
    window.A33Notice.alert((result && result.message) || 'No se pudo borrar el Pedido rápido.');
    return;
  }
  if (String(quickOrderEditingId) === String(id)) resetQuickOrderFormPED();
  renderQuickOrdersPED();
}

function icsEscapePED(value){
  return String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function createQuickOrderICSPED(order){
  const date = String(order && order.fechaEntrega || '').slice(0, 10);
  if (!isExactQuickOrderDatePED(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const end = new Date(Date.UTC(year, month - 1, day + 1));
  const startDate = date.replace(/-/g, '');
  const endDate = [end.getUTCFullYear(), String(end.getUTCMonth() + 1).padStart(2, '0'), String(end.getUTCDate()).padStart(2, '0')].join('');
  const description = [
    `Código: ${order.codigo || ''}`,
    `Cliente: ${order.customerName || ''}`,
    `Estado: ${pedidoEstadoLabelPED(getPedidoEstado(order))}`,
    pedidoLotesResumenPED(order),
    `Fecha de entrega: ${formatDate(date)}`,
    `Prioridad: ${order.prioridad === 'alta' ? 'Alta' : 'Normal'}`,
    'Productos:',
    ...(order.items || []).map((item) => `- ${item.cantidad} ${item.productNameSnapshot || 'Producto'}`)
  ].join('\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Arcano 33//Pedidos Rapidos//ES', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${icsEscapePED(order.id || order.codigo)}@arcano33`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
    `SUMMARY:${icsEscapePED('Entrega ' + (order.customerName || 'Pedido rápido') + ' - ' + (order.prioridad === 'alta' ? 'Alta' : 'Normal'))}`,
    `DESCRIPTION:${icsEscapePED(description)}`, `DTSTART;VALUE=DATE:${startDate}`, `DTEND;VALUE=DATE:${endDate}`,
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
}

function exportQuickOrderCalendarPED(id){
  const order = loadQuickOrdersPED().find((item) => String(item.id) === String(id));
  if (!order) return;
  const content = createQuickOrderICSPED(order);
  if (!content){ window.A33Notice.alert('No se pudo generar el calendario. Revisá la fecha de entrega.'); return; }
  const blob = new Blob([content], { type:'text/calendar;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pedido_rapido_${String(order.codigo || 'pedido').toLowerCase()}_${order.fechaEntrega}.ics`;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 0);
}

function createQuickOrderCardPED(order, historical){
  const card = document.createElement('article');
  card.className = 'quick-order-card' + (order.prioridad === 'alta' ? ' is-high' : '');
  const main = document.createElement('div');
  main.className = 'quick-order-main';
  const title = document.createElement('h3');
  title.className = 'quick-order-title';
  title.textContent = `${order.customerName} · ${formatDate(order.fechaEntrega)} · ${order.prioridad === 'alta' ? 'Alta' : 'Normal'}`;
  const status = document.createElement('span');
  status.className = 'badge ' + (order.estado === 'entregado' ? 'ok' : 'warn');
  status.textContent = pedidoEstadoLabelPED(getPedidoEstado(order));
  main.append(title, status);
  const products = document.createElement('p');
  products.className = 'quick-order-products';
  products.textContent = quickOrderProductSummaryPED({ ...order, items:(order.items || []).slice().sort((a,b) => compareProductDisplayPED({ ...(a.productSnapshot || {}), name:a.productNameSnapshot }, { ...(b.productSnapshot || {}), name:b.productNameSnapshot })) }) || 'Sin productos';
  const meta = document.createElement('div');
  meta.className = 'quick-order-meta';
  meta.textContent = (order.codigo || '') + ' · ' + pedidoEntregasResumenPED(order, 'rapido') + ' · ' + pedidoLotesResumenPED(order);
  const actions = document.createElement('div');
  actions.className = 'quick-order-actions';
  const calendar = document.createElement('button');
  calendar.type = 'button'; calendar.className = 'btn-secondary'; calendar.textContent = '📅 Calendario';
  calendar.addEventListener('click', () => exportQuickOrderCalendarPED(order.id));
  actions.appendChild(calendar);
  actions.appendChild(createPedidoEntregasButtonPED(order.id, 'rapido'));
  actions.appendChild(createPedidoLotesButtonPED(order.id, 'rapido'));
  if (historical){
    const reopen = document.createElement('button');
    reopen.type = 'button'; reopen.className = 'btn-primary'; reopen.textContent = 'Reabrir';
    reopen.addEventListener('click', () => setQuickOrderDeliveredPED(order.id, false));
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'btn-danger'; remove.textContent = 'Borrar';
    remove.addEventListener('click', () => deleteQuickOrderPED(order.id));
    actions.append(reopen, remove);
  } else {
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'btn-secondary'; edit.textContent = 'Editar';
    edit.addEventListener('click', () => editQuickOrderPED(order.id));
    const delivered = document.createElement('button');
    delivered.type = 'button'; delivered.className = 'btn-primary'; delivered.textContent = 'Entregado';
    delivered.addEventListener('click', () => setQuickOrderDeliveredPED(order.id, true));
    actions.append(edit, delivered);
  }
  card.append(main, products, meta, actions);
  return card;
}

function renderQuickOrderCollectionPED(records, historical){
  const host = $(historical ? 'quick-history-list' : 'quick-pending-list');
  if (!host) return;
  host.innerHTML = '';
  const search = $(historical ? 'quick-history-search' : 'quick-pending-search');
  const query = normalizeCustomerKey(search ? search.value : '');
  const filtered = records.filter((order) => !query || quickOrderSearchTextPED(order).includes(query));
  const limit = historical ? quickHistoryLimit : quickPendingLimit;
  const shown = filtered.slice(0, limit);
  if (!shown.length){
    const empty = document.createElement('div');
    empty.className = 'quick-order-empty';
    empty.textContent = query ? 'No hay resultados.' : (historical ? 'No hay Pedidos rápidos entregados o cancelados.' : 'No hay Pedidos rápidos pendientes.');
    host.appendChild(empty);
  } else shown.forEach((order) => host.appendChild(createQuickOrderCardPED(order, historical)));
  const pager = $(historical ? 'quick-history-pager' : 'quick-pending-pager');
  const count = $(historical ? 'quick-history-shown' : 'quick-pending-shown');
  const more = $(historical ? 'quick-history-more' : 'quick-pending-more');
  if (count) count.textContent = filtered.length ? `Mostrando ${shown.length} de ${filtered.length}` : '';
  if (pager) pager.hidden = filtered.length <= QUICK_ORDER_PAGE_SIZE && !query;
  if (more) more.hidden = shown.length >= filtered.length;
}

function renderQuickOrdersPED(){
  refreshPedidoDemandaIfOpenPED();
  const records = loadQuickOrdersPED();
  const pending = records.filter((order) => ['pendiente','en_preparacion','listo'].includes(order.estado)).sort((a,b) => String(a.fechaEntrega).localeCompare(String(b.fechaEntrega)));
  const historical = records.filter((order) => ['entregado','cancelado'].includes(order.estado)).sort((a,b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  if ($('quick-pending-count')) $('quick-pending-count').textContent = String(pending.length);
  if ($('quick-history-count')) $('quick-history-count').textContent = String(historical.length);
  renderQuickOrderCollectionPED(pending, false);
  renderQuickOrderCollectionPED(historical, true);
}

function setPedidoModePED(mode){
  const rapid = mode === 'rapido';
  document.querySelectorAll('.pedido-completo-view').forEach((element) => {
    element.hidden = rapid;
    element.style.display = rapid ? 'none' : '';
  });
  document.querySelectorAll('.pedido-rapido-view').forEach((element) => {
    element.hidden = !rapid;
    element.style.display = rapid ? '' : 'none';
  });
  const fullButton = $('pedido-mode-completo');
  const quickButton = $('pedido-mode-rapido');
  if (fullButton){ fullButton.className = rapid ? 'btn-secondary' : 'btn-primary'; fullButton.setAttribute('aria-pressed', rapid ? 'false' : 'true'); }
  if (quickButton){ quickButton.className = rapid ? 'btn-primary' : 'btn-secondary'; quickButton.setAttribute('aria-pressed', rapid ? 'true' : 'false'); }
  if (rapid) renderQuickOrdersPED();
}

function initQuickOrdersUI_PED(){
  if (!$('quick-order-form')) return;
  resetQuickOrderFormPED();
  renderQuickOrdersPED();
  $('pedido-mode-completo')?.addEventListener('click', () => setPedidoModePED('completo'));
  $('pedido-mode-rapido')?.addEventListener('click', () => setPedidoModePED('rapido'));
  $('quick-customer-search')?.addEventListener('input', (event) => renderQuickCustomerSelectPED(event.target.value, ''));
  $('quick-customer-select')?.addEventListener('change', () => {
    const status = $('quick-customer-status');
    if (status) status.textContent = getQuickCustomerPED().name ? 'Cliente seleccionado del catálogo compartido.' : 'Seleccioná un cliente del catálogo de la Suite.';
  });
  $('quick-delivery-date')?.addEventListener('change', updateQuickCodePreviewPED);
  $('quick-product-add')?.addEventListener('click', () => {
    const productId = $('quick-product-select') ? $('quick-product-select').value : '';
    const quantity = Number($('quick-product-quantity') ? $('quick-product-quantity').value : 0);
    const product = PRESENTACIONES.find((item) => item.productId === productId);
    if (!product){ setQuickOrderNoticePED('Seleccioná un producto activo.', 'warn'); return; }
    if (!Number.isInteger(quantity) || quantity < 1){ setQuickOrderNoticePED('La cantidad mínima es 1 y debe ser entera.', 'warn'); return; }
    if (quickOrderItemsDraft.some((item) => item.productId === productId)){ setQuickOrderNoticePED('Ese producto ya está incluido.', 'warn'); return; }
    quickOrderItemsDraft.push({
      productId:product.productId,
      productNameSnapshot:product.label,
      cantidad:quantity,
      productSnapshot:buildProductSnapshotPED(product.rawProduct, product.rawProduct)
    });
    if ($('quick-product-quantity')) $('quick-product-quantity').value = '1';
    setQuickOrderNoticePED('');
    renderQuickProductLinesPED();
  });
  $('quick-reset-btn')?.addEventListener('click', resetQuickOrderFormPED);
  $('quick-export-btn')?.addEventListener('click', () => { try{ exportToCSV(); }catch(_){ } });
  $('quick-order-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const conflict = recoveredPedidoConflictPED('rapido');
    if(conflict){setQuickOrderNoticePED(conflict,'warn');return;}
    // Recuperar texto escrito antes de change también debe conservar su cantidad al guardar.
    const lineInputs=Array.from(document.querySelectorAll('#quick-product-lines input[data-draft-index]'));
    if(lineInputs.some(el=>!String(el.value).trim() || !Number.isInteger(Number(el.value)) || Number(el.value)<1)){
      setQuickOrderNoticePED('Cada cantidad debe ser un entero mayor o igual a 1.','warn');return;
    }
    for(const el of lineInputs){const item=quickOrderItemsDraft[Number(el.dataset.draftIndex)];if(item)item.cantidad=Number(el.value);}
    const records = loadQuickOrdersPED();
    const editorConflict=pedidoEditorConflictPED('rapido',records);
    if (editorConflict){persistPedidoFormDraftPED('rapido');setQuickOrderNoticePED(editorConflict,'warn');return;}
    const customer = getQuickCustomerPED();
    const existing = quickOrderEditingId ? records.find((order) => String(order.id) === String(quickOrderEditingId)) : null;
    if (existing && Number(existing.updatedAt || 0) !== Number(quickOrderEditingUpdatedAt || 0)){
      setQuickOrderNoticePED('Este Pedido rápido cambió en otra pestaña. Recargá antes de guardar.', 'warn');
      return;
    }
    const now = Date.now();
    const stateValue = $('quick-status') ? $('quick-status').value : 'pendiente';
    const candidate = {
      ...(existing || {}),
      id:existing ? existing.id : (quickOrderDraftIdPED || (quickOrderDraftIdPED=createQuickOrderIdPED(now))),
      codigo:existing ? existing.codigo : generateQuickOrderCodePED($('quick-delivery-date').value, records),
      createdAt:existing ? existing.createdAt : now,
      updatedAt:now,
      customerId:customer.id,
      customerName:customer.name,
      fechaEntrega:$('quick-delivery-date').value,
      prioridad:$('quick-priority').value,
      estado:stateValue,
      entregado:stateValue === 'entregado',
      deliveredAt:stateValue === 'entregado' ? (existing && existing.deliveredAt || new Date(now).toISOString()) : '',
      items:quickOrderItemsDraft.map((item) => ({ ...item, productSnapshot:{ ...(item.productSnapshot || {}) } }))
    };
    const deliveryError = validarEntregasPedidoPED(candidate, 'rapido');
    if (deliveryError){ setQuickOrderNoticePED(deliveryError, 'warn'); return; }
    if (!pedidoLotesRegistroValidoPED(candidate)){ setQuickOrderNoticePED('El registro de vínculos con lotes no es válido. Se conservó el pedido.', 'warn'); return; }
    const validation = validateQuickOrderPED(candidate);
    if (!validation.ok){ setQuickOrderNoticePED(validation.message, 'warn'); return; }
    const index = records.findIndex((order) => String(order.id) === String(validation.data.id));
    if (index >= 0) records[index] = validation.data; else records.push(validation.data);
    const result = saveQuickOrdersPED(records,[validation.data.id]);
    if (!result || !result.ok){ setQuickOrderNoticePED((result && result.message) || 'No se pudo guardar.', 'warn'); return; }
    resetQuickOrderFormPED({discard:true});
    renderQuickOrdersPED();
    setQuickOrderNoticePED('Pedido rápido guardado ✓', 'ok');
  });
  const pendingSearch = debounce(() => { quickPendingLimit = QUICK_ORDER_PAGE_SIZE; renderQuickOrdersPED(); }, 140);
  const historySearch = debounce(() => { quickHistoryLimit = QUICK_ORDER_PAGE_SIZE; renderQuickOrdersPED(); }, 140);
  $('quick-pending-search')?.addEventListener('input', pendingSearch);
  $('quick-history-search')?.addEventListener('input', historySearch);
  $('quick-pending-more')?.addEventListener('click', () => { quickPendingLimit += QUICK_ORDER_PAGE_SIZE; renderQuickOrdersPED(); });
  $('quick-history-more')?.addEventListener('click', () => { quickHistoryLimit += QUICK_ORDER_PAGE_SIZE; renderQuickOrdersPED(); });
  let initialMode = 'completo';
  try{ if (new URLSearchParams(window.location.search).get('view') === 'rapido') initialMode = 'rapido'; }catch(_){ }
  setPedidoModePED(initialMode);
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
  descLines.push(`Estado: ${pedidoEstadoLabelPED(getPedidoEstado(p))}`);
  descLines.push(pedidoLotesResumenPED(p));
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
    window.A33Notice.alert("No se pudo generar el evento de calendario. Revisá que el pedido tenga fecha de entrega.");
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
  const setStatus = (t) => { window.A33Notice.show(t); if (statusEl) statusEl.textContent = String(t || ""); };

  try{
    if (btn && btn.dataset && btn.dataset.busy === '1') return;
    if (btn && btn.dataset) btn.dataset.busy = '1';
  }catch(_){ }

  const pedidos = loadPedidos();
  const pedidosRapidos = loadQuickOrdersPED();
  if (pedidos.length === 0 && pedidosRapidos.length === 0) {
    setStatus('');
    window.A33Notice.alert("No hay pedidos para exportar.");
    try{ if (btn && btn.dataset) btn.dataset.busy = '0'; }catch(_){ }
    return;
  }

  if (typeof XLSX === "undefined") {
    setStatus('Falló');
    window.A33Notice.alert("No se pudo generar el archivo de Excel (librería XLSX no cargada).");
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
    const baseHeaders = [
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
      "Subtotal productos"
    ];
    const tailHeaders = [
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
      "Estado"
    ];

    const numOrEmpty = (v) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(2)) : "");
    const detailsByPedido = new Map();
    const productColumns = new Map();

    pedidos.forEach((p, pedidoIndex) => {
      const detail = getPedidoTotalsForDisplayPED(p);
      detailsByPedido.set(String(p.id ?? pedidoIndex), detail);
      detail.lines.forEach((item, lineIndex) => {
        const productId = String(item.productId || '').trim();
        const explicitKey = String(item.identityKey || item.productKey || '').trim();
        // Sin productId ni clave histórica explícita, la identidad permanece aislada por pedido/línea.
        const identityKey = productId ? ('product:' + productId) : (explicitKey || `historical-row:${p.id ?? pedidoIndex}:${lineIndex}`);
        if (!productColumns.has(identityKey)) productColumns.set(identityKey, { key:identityKey, productId, label:String(item.label || 'Producto histórico') });
      });
    });

    const dynamicHeaders = [];
    productColumns.forEach((col) => {
      const identityTag = col.productId ? col.productId : String(col.key || 'Histórico').replace(/^legacy:/, 'Histórico:');
      const headerLabel = `${col.label} [${identityTag}]`;
      dynamicHeaders.push(`${headerLabel} - Cantidad`, `${headerLabel} - Precio`, `${headerLabel} - Subtotal`);
    });
    const headers = [...baseHeaders, ...dynamicHeaders, ...tailHeaders];

    const rows = pedidos.map((p, pedidoIndex) => {
      const delivered = getPedidoEstado(p) === 'entregado';
      const detail = detailsByPedido.get(String(p.id ?? pedidoIndex)) || getPedidoTotalsForDisplayPED(p);
      const subPres = (typeof p.subtotalPresentaciones === 'number') ? p.subtotalPresentaciones
        : (typeof p.subtotal === 'number' ? p.subtotal : detail.subtotal);
      const totalUnits = detail.lines.reduce((sum, item) => sum + (Number(item.qty || 0) || 0), 0);
      const lineByIdentity = new Map();
      detail.lines.forEach((item, lineIndex) => {
        const productId = String(item.productId || '').trim();
        const explicitKey = String(item.identityKey || item.productKey || '').trim();
        const identityKey = productId ? ('product:' + productId) : (explicitKey || `historical-row:${p.id ?? pedidoIndex}:${lineIndex}`);
        const current = lineByIdentity.get(identityKey) || { qty:0, subtotal:0 };
        const qty = Number(item.qty || 0) || 0;
        const subtotal = Number(item.subtotal != null ? item.subtotal : qty * (Number(item.unit || 0) || 0)) || 0;
        current.qty += qty;
        current.subtotal += subtotal;
        lineByIdentity.set(identityKey, current);
      });
      const dynamicValues = [];
      productColumns.forEach((col) => {
        const line = lineByIdentity.get(col.key);
        if (!line){ dynamicValues.push('', '', ''); return; }
        const unit = line.qty ? line.subtotal / line.qty : 0;
        dynamicValues.push(line.qty, numOrEmpty(unit), numOrEmpty(line.subtotal));
      });
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
        ...dynamicValues,
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
        pedidoEstadoLabelPED(getPedidoEstado(p))
      ];
    });

    const detailHeaders = [
      "Código",
      "Cliente",
      "Fecha fabricación",
      "Fecha entrega",
      "Producto",
      "productId / clave histórica",
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
          item.productId || item.identityKey || item.productKey || item.legacyKey || 'Histórico sin productId',
          qty,
          numOrEmpty(unit),
          numOrEmpty(sub),
          item.productId ? 'Producto identificado' : 'Histórico'
        ]);
      });
    });

    const wb = XLSX.utils.book_new();
    const deliveryRows = [];
    [['Completo', pedidos, 'completo'], ['Rápido', pedidosRapidos, 'rapido']].forEach(([tipo, records, mode]) => {
      records.forEach(order => pedidoEntregasLineasPED(order, mode).forEach(line => {
        deliveryRows.push([tipo, order.codigo || '', order.id || '', pedidoEstadoLabelPED(getPedidoEstado(order)), line.key, line.label, line.qty,
          line.registered && line.valid ? line.delivered : '', line.registered && line.valid ? line.qty - line.delivered : '',
          line.valid ? (line.registered ? 'Registrado' : 'Sin registro de cantidades') : 'Revisar registro']);
      }));
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Tipo', 'Código', 'ID pedido', 'Estado', 'Identidad producto', 'Producto', 'Pedido', 'Entregado acumulado', 'Pendiente', 'Registro'], ...deliveryRows]), 'Entregas');

    const lotCatalog = readPedidoLotesCatalogPED();
    const linkedRows = [];
    [['Completo', pedidos], ['Rápido', pedidosRapidos]].forEach(([tipo, records]) => records.forEach(order => {
      if (!pedidoLotesRegistroValidoPED(order)){
        linkedRows.push([tipo, order.codigo || '', order.id || '', '', '', '', '', 'Revisar registro', String(order.lotesRelacionados || '')]);return;
      }
      (order.lotesVinculados?.lotes || []).forEach(ref => {
        const match = pedidoLotesResolverPED(ref, lotCatalog.rows);
        linkedRows.push([tipo, order.codigo || '', order.id || '', ref.key, ref.codigoSnapshot, match.row ? pedidoLoteCodigoPED(match.row) : '', ref.fechaSnapshot || '', lotCatalog.error ? 'Lectura no disponible' : match.status, String(order.lotesRelacionados || '')]);
      });
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Tipo', 'Código pedido', 'ID pedido', 'Identidad lote', 'Código al vincular', 'Código actual', 'Fecha al vincular', 'Referencia', 'Texto histórico'], ...linkedRows]), 'Lotes vinculados');
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((h) => ({ wch: Math.min(42, Math.max(12, String(h).length + 2)) }));
    XLSX.utils.book_append_sheet(wb, ws, "Pedidos");

    const wsDetail = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailRows]);
    wsDetail['!cols'] = [14, 26, 14, 14, 28, 30, 10, 15, 14, 18].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, wsDetail, "Detalle productos");

    const quickHeaders = ['ID', 'Código', 'Cliente', 'customerId', 'Fecha entrega', 'Prioridad', 'Estado', 'Productos', 'Total unidades', 'Creado', 'Actualizado', 'Entregado'];
    const quickRows = pedidosRapidos.map((order) => [
      order.id || '',
      order.codigo || '',
      order.customerName || '',
      order.customerId || '',
      formatDate(order.fechaEntrega),
      order.prioridad === 'alta' ? 'Alta' : 'Normal',
      pedidoEstadoLabelPED(getPedidoEstado(order)),
      quickOrderProductSummaryPED(order),
      (order.items || []).reduce((sum, item) => sum + (Number(item.cantidad || 0) || 0), 0),
      order.createdAt ? new Date(order.createdAt).toISOString() : '',
      order.updatedAt ? new Date(order.updatedAt).toISOString() : '',
      order.deliveredAt || ''
    ]);
    const quickSheet = XLSX.utils.aoa_to_sheet([quickHeaders, ...quickRows]);
    quickSheet['!cols'] = [24,18,28,22,14,12,12,48,14,24,24,24].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, quickSheet, 'Pedidos rápidos');

    const quickDetailHeaders = ['ID pedido', 'Código', 'Cliente', 'Fecha entrega', 'Estado', 'productId', 'Producto snapshot', 'Cantidad'];
    const quickDetailRows = [];
    pedidosRapidos.forEach((order) => {
      (order.items || []).forEach((item) => {
        quickDetailRows.push([
          order.id || '', order.codigo || '', order.customerName || '', formatDate(order.fechaEntrega),
          pedidoEstadoLabelPED(getPedidoEstado(order)), item.productId || '',
          item.productNameSnapshot || '', Number(item.cantidad || 0) || 0
        ]);
      });
    });
    const quickDetailSheet = XLSX.utils.aoa_to_sheet([quickDetailHeaders, ...quickDetailRows]);
    quickDetailSheet['!cols'] = [24,18,28,14,12,28,32,10].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, quickDetailSheet, 'Detalle rápidos');

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `arcano33_pedidos_${timestamp}.xlsx`;

    XLSX.writeFile(wb, filename);
    setStatus('Listo ✓');
  }catch(e){
    console.error('Export falló', e);
    setStatus('Falló');
    window.A33Notice.alert('No se pudo exportar. Probá de nuevo o recargá la página.');
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
      if (event && event.key === 'Escape'){
        if (pedidoLotesEditorPED) closePedidoLotesPED();
        else if (pedidoEntregasEditorPED) closePedidoEntregasPED();
        else closePedidoDetailModalPED();
      }
    }catch(_){ }
  });
  await refreshPedidosProductCatalog(true);
  clearForm();
  renderPedidosCurrencyReference();
  initQuickOrdersUI_PED();
  initPedidoDemandaPED();

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
        window.A33Notice.alert('Escribí un nombre válido para crear el cliente.');
        return;
      }

      // Refrescar lista y seleccionar
      try{ renderCustomerSelect(($('clienteBuscar') && $('clienteBuscar').value) ? $('clienteBuscar').value : ''); }catch(_){ }
      setCustomerSelection({ id: res.id || '', name: res.name || name });
      toggleNewCustomerBox(false);

      if (res.existed && res.isActive === false){
        window.A33Notice.alert('Ese cliente ya existía, pero está inactivo en POS. Se usará igual en este pedido.');
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

    const conflict = recoveredPedidoConflictPED('completo');
    if(conflict){showArchivedNotice(conflict);return;}
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

      const recoveryConflict = recoveredPedidoConflictPED('completo');
      if(recoveryConflict)return {ok:false,message:recoveryConflict};

      // ID estable: para pedidos nuevos usamos un draftId (idempotente en reintentos/recargas)
      let id = (editingId != null && editingId !== '') ? editingId : ensureDraftPedidoId(false);

      // Dedupe por código (reintentos): si ya existe un pedido con este código, no crear duplicado
      const pedidosNow = loadPedidos();
      const editorConflict=pedidoEditorConflictPED('completo',pedidosNow);
      if (editorConflict) return {ok:false,message:editorConflict};
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
      if (!['pendiente','en_preparacion','listo','entregado','cancelado'].includes(estado)) return {ok:false,message:'Estado de pedido inválido. Revisá el formulario.'};
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

      const deliveryBase = pedidosNow.find(p => String(p.id) === String(id));
      const pedido = {
        ...(deliveryBase && Object.prototype.hasOwnProperty.call(deliveryBase, 'entregasAcumuladas') ? {entregasAcumuladas:deliveryBase.entregasAcumuladas} : {}),
        ...(deliveryBase && Object.prototype.hasOwnProperty.call(deliveryBase, 'lotesVinculados') ? {lotesVinculados:deliveryBase.lotesVinculados} : {}),
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

      const deliveryError = validarEntregasPedidoPED(pedido, 'completo');
      if (deliveryError) return {ok:false,message:deliveryError};
      if (!pedidoLotesRegistroValidoPED(pedido)) return {ok:false,message:'El registro de vínculos con lotes no es válido. Se conservó el pedido.'};

      // Mantener snapshot actual en memoria (fallback si POS no está disponible)
      currentPriceSnapshot = { ...(totales.unitPricesUsed || {}) };

      const pedidos = loadPedidos();
      const idx = pedidos.findIndex((p) => String(p.id) === String(pedido.id));
      const updated = Array.isArray(pedidos) ? [...pedidos] : [];
      if (idx >= 0) updated[idx] = pedido;
      else updated.push(pedido);

      const ok = savePedidos(updated,[pedido.id]);
      if (!ok) {
        return { ok:false, message:'No se pudo guardar. No se limpió el formulario.' };
      }
      if (!confirmPedidosPersisted(pedido.id)) {
        return { ok:false, message:'Guardado no confirmado. No se limpió el formulario. Recargá e intentá de nuevo.' };
      }

      return { ok:true };
    });

    if (!res || !res.ok){
      persistPedidoFormDraftPED('completo');
      const msg = (res && res.message) ? res.message : 'No se pudo guardar el pedido.';
      showArchivedNotice(msg);
      window.A33Notice.alert(msg);
      return;
    }

    renderTable();
    clearForm({discard:true});
    window.A33Notice.alert("Pedido guardado correctamente.");
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
      window.A33Notice.alert(msg);
      return;
    }

    renderTable();
    clearForm();
    showArchivedNotice("Borrado ✓");
  });
  $("calc-totals-btn").addEventListener("click", async () => {
    try { await calcularTotalesDesdeFormulario(); pedFormDraftState.completo.dirty=true;persistPedidoFormDraftPED('completo'); } catch {}
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

  initPedidoFormDraftsPED();
  registerServiceWorker();
});

// --- Service worker (opcional) ---
function registerServiceWorker() {
  try {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js?v=4.20.98&r=3').catch((err) => {
      console.warn('Pedidos: no se pudo registrar el Service Worker', err);
    });
  } catch (err) {
    console.warn('Pedidos: error al registrar Service Worker', err);
  }
}

// E6.2: seguimiento acumulado independiente del estado, los precios y el inventario.
let pedidoEntregasEditorPED = null;
function pedidoEntregasProductosPED(order, mode){
  return mode === 'rapido'
    ? (order.items || []).map((item,index) => ({key:item.productId ? 'product:' + item.productId : 'historical:' + index + ':' + djb2Hash(item.productNameSnapshot || ''), label:item.productNameSnapshot || 'Producto', qty:Number(item.cantidad)}))
    : getPedidoDetailProductLinesPED(order, getPriceSnapshotFromPedido(order)).map((item,index) => ({key:item.identityKey || 'historical:' + index + ':' + djb2Hash(item.label), label:item.label, qty:Number(item.qty)}));
}
function pedidoEntregasRegistroValidoPED(order){
  if (!Object.prototype.hasOwnProperty.call(order, 'entregasAcumuladas')) return true;
  const record = order.entregasAcumuladas;
  if (!record || record.schemaVersion !== 1 || !Array.isArray(record.productos)) return false;
  const seen = new Set();
  return record.productos.every(row => {
    if (!row || typeof row.key !== 'string' || !row.key || seen.has(row.key) || typeof row.cantidad !== 'number' || !Number.isFinite(row.cantidad) || row.cantidad < 0) return false;
    seen.add(row.key); return true;
  });
}
function pedidoEntregasLineasPED(order, mode){
  const valid = pedidoEntregasRegistroValidoPED(order);
  const registered = Object.prototype.hasOwnProperty.call(order, 'entregasAcumuladas');
  const quantities = new Map(valid && registered ? order.entregasAcumuladas.productos.map(row => [row.key,row.cantidad]) : []);
  return pedidoEntregasProductosPED(order, mode).map(line => ({...line, registered, delivered:quantities.get(line.key) ?? 0, valid:valid && (quantities.get(line.key) ?? 0) <= line.qty}));
}
function validarEntregasPedidoPED(order, mode){
  if (!pedidoEntregasRegistroValidoPED(order)) return 'El registro de cantidades entregadas no es válido. Conservá el pedido y revisá sus datos antes de guardar.';
  const lines = pedidoEntregasLineasPED(order, mode);
  if (lines.some(line => !line.valid)) return 'No se puede pedir menos de lo ya entregado. Revisá las cantidades acumuladas antes de guardar.';
  const keys = new Set(lines.map(line => line.key));
  if ((order.entregasAcumuladas?.productos || []).some(row => row.cantidad > 0 && !keys.has(row.key))) return 'No se puede quitar o cambiar la identidad de un producto con cantidades entregadas. Revisá primero su entrega acumulada.';
  return '';
}
function pedidoEntregasResumenPED(order, mode){
  const error = validarEntregasPedidoPED(order, mode);
  if (error) return 'Revisar cantidades entregadas';
  if (!Object.prototype.hasOwnProperty.call(order, 'entregasAcumuladas')) return 'Sin registro de cantidades';
  const lines = pedidoEntregasLineasPED(order, mode);
  const qty = lines.reduce((sum,line) => sum + line.qty,0);
  const delivered = lines.reduce((sum,line) => sum + line.delivered,0);
  return `Entregado ${delivered} de ${qty} · Pendiente ${qty - delivered}`;
}
function createPedidoEntregasButtonPED(id, mode){
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'btn-secondary'; button.textContent = 'Cantidades entregadas';
  button.addEventListener('click', () => openPedidoEntregasPED(id, mode));
  return button;
}
function closePedidoEntregasPED(){
  if (pedidoEntregasEditorPED?.dirty && !confirm('Hay cantidades sin guardar. ¿Cerrar y descartar estos cambios?')) return;
  $('pedido-entregas-modal').hidden = true;
  pedidoEntregasEditorPED = null;
  document.body.classList.remove('a33-modal-open');
}
function openPedidoEntregasPED(id, mode){
  if (pedidoEntregasEditorPED?.dirty){ if (!confirm('Hay cantidades sin guardar. ¿Descartar estos cambios y abrir otro pedido?')) return; }
  const order = (mode === 'rapido' ? loadQuickOrdersPED() : loadPedidos()).find(row => String(row.id) === String(id));
  if (!order) return;
  const lines = pedidoEntregasLineasPED(order, mode);
  pedidoEntregasEditorPED = {id, mode, base:JSON.parse(JSON.stringify(order)), dirty:false};
  const host = $('pedido-entregas-lines'); host.replaceChildren();
  $('pedido-entregas-title').textContent = 'Cantidades entregadas · ' + (order.codigo || 'Pedido');
  lines.forEach(line => {
    const row = document.createElement('label'); row.className = 'form-group';
    const name = document.createElement('span'); name.textContent = `${line.label} · Pedido: ${line.qty}`;
    const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = String(line.qty); input.step = mode === 'rapido' ? '1' : 'any';
    input.value = line.valid ? String(line.delivered) : ''; input.dataset.deliveryKey = line.key; input.setAttribute('aria-label','Entregado acumulado de ' + line.label);
    const pending = document.createElement('span'); pending.dataset.deliveryPending = line.key;
    const refresh = () => {const raw=input.value;const number=Number(raw);pending.textContent=raw.trim() && Number.isFinite(number) && number>=0 && number<=line.qty ? `Pendiente: ${line.qty-number}` : 'Revisá la cantidad';};
    input.addEventListener('input', () => {pedidoEntregasEditorPED.dirty = true;refresh();}); refresh();
    row.append(name,input,pending);host.appendChild(row);
  });
  const error = validarEntregasPedidoPED(order, mode);
  $('pedido-entregas-notice').textContent = error || (order.entregasAcumuladas ? pedidoEntregasResumenPED(order, mode) : 'Sin cantidades registradas. El estado del pedido no determina cuánto se entregó.');
  $('pedido-entregas-save').disabled = !!error || !lines.length;
  $('pedido-entregas-form').onsubmit = savePedidoEntregasPED;
  $('pedido-entregas-close').onclick = closePedidoEntregasPED;
  $('pedido-entregas-modal').hidden = false;document.body.classList.add('a33-modal-open');
  host.querySelector('input')?.focus();
}
function savePedidoEntregasPED(event){
  event?.preventDefault();
  const editor = pedidoEntregasEditorPED;
  if (!editor) return;
  const notice = $('pedido-entregas-notice');
  const records = editor.mode === 'rapido' ? loadQuickOrdersPED() : loadPedidos();
  const index = records.findIndex(row => String(row.id) === String(editor.id));
  const fingerprint = window.A33Storage && A33Storage.recordFingerprint;
  if (index < 0 || !fingerprint || fingerprint(records[index]) !== fingerprint(editor.base)){
    notice.textContent = 'Este pedido cambió o fue eliminado. Las cantidades pendientes se conservan; cerrá y abrí el pedido vigente para revisarlo.';return;
  }
  const lines = pedidoEntregasProductosPED(editor.base, editor.mode);
  const inputs = Array.from($('pedido-entregas-lines').querySelectorAll('input[data-delivery-key]'));
  const cantidades = inputs.map(input => ({key:input.dataset.deliveryKey,cantidad:Number(input.value)}));
  if (inputs.length !== lines.length || inputs.some((input,i) => !input.value.trim() || input.dataset.deliveryKey !== lines[i].key || !Number.isFinite(cantidades[i].cantidad) || cantidades[i].cantidad<0 || cantidades[i].cantidad>lines[i].qty || (editor.mode === 'rapido' && !Number.isInteger(cantidades[i].cantidad)))){
    notice.textContent = 'Cada cantidad entregada debe estar entre cero y lo pedido, sin campos vacíos. En Pedido rápido debe ser entera.';return;
  }
  const updated = {...records[index], entregasAcumuladas:{schemaVersion:1,productos:cantidades,updatedAt:Date.now()}, updatedAt:Date.now()};
  const error = validarEntregasPedidoPED(updated, editor.mode);
  if (error){notice.textContent=error;return;}
  records[index] = updated;
  const result = editor.mode === 'rapido' ? saveQuickOrdersPED(records,[editor.id]) : {ok:savePedidos(records,[editor.id])};
  if (!result || !result.ok){notice.textContent=result?.message || 'No se pudo confirmar el guardado. Las cantidades pendientes se conservan.';return;}
  const persisted = (editor.mode === 'rapido' ? loadQuickOrdersPED() : loadPedidos()).find(row => String(row.id) === String(editor.id));
  if (!persisted || fingerprint(persisted.entregasAcumuladas) !== fingerprint(updated.entregasAcumuladas)){
    notice.textContent='No se pudo comprobar el guardado. Las cantidades pendientes se conservan.';return;
  }
  pedidoEntregasEditorPED = {...editor,base:JSON.parse(JSON.stringify(persisted)),dirty:false};
  notice.textContent='Cantidades guardadas ✓ · ' + pedidoEntregasResumenPED(persisted, editor.mode);
  renderTable();renderQuickOrdersPED();
}
window.addEventListener('beforeunload', event => {
  if (!pedidoEntregasEditorPED?.dirty) return;
  event.preventDefault();event.returnValue='';
});



// E6.3: referencias informativas a lotes completos, sin conversión del texto histórico.
let pedidoLotesEditorPED = null;
function pedidoLoteCodigoPED(row){ return String(row?.codigo || row?.batchCode || row?.code || '').trim(); }
function pedidoLoteIdentidadesPED(row){
  const ids = [row?.loteId,row?.id,row?.operationId,row?.productionOperationId,row?.batchId].map(value => String(value ?? '').trim()).filter(Boolean);
  const codes = [row?.codigo,row?.batchCode,row?.code].map(value => String(value ?? '').trim()).filter(Boolean);
  return Array.from(new Set([...ids.map(id => 'id:' + id), ...codes.map(code => 'code:' + code)]));
}
function readPedidoLotesCatalogPED(){
  try{
    const raw = localStorage.getItem('arcano33_lotes');
    const rows = raw == null ? [] : JSON.parse(raw);
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Colección de lotes incompleta');
    return {rows,error:''};
  }catch(_){return {rows:[],error:'No se pudieron leer los lotes. Los vínculos existentes se conservan; cerrá y volvé a abrir para reintentar.'};}
}
function pedidoLotesRegistroValidoPED(order){
  if (!Object.prototype.hasOwnProperty.call(order, 'lotesVinculados')) return true;
  const record = order.lotesVinculados;
  if (!record || record.schemaVersion !== 1 || !Array.isArray(record.lotes)) return false;
  const seen = new Set();
  return record.lotes.every(ref => {
    if (!ref || typeof ref.key !== 'string' || !ref.key || !Array.isArray(ref.identidades) || !ref.identidades.length || new Set(ref.identidades).size !== ref.identidades.length || !ref.identidades.includes(ref.key) || typeof ref.codigoSnapshot !== 'string' || ref.identidades.some(id => typeof id !== 'string' || !id || seen.has(id))) return false;
    for (const id of ref.identidades) seen.add(id);
    return true;
  });
}
function pedidoLotesResolverPED(ref, rows){
  const candidates = rows.filter(row => pedidoLoteIdentidadesPED(row).some(id => ref.identidades.includes(id)));
  return candidates.length === 1 ? {row:candidates[0],status:'Localizado'} : {row:null,status:candidates.length ? 'Identidad ambigua' : 'No localizado'};
}
function pedidoLoteReferenciaPED(row){
  const identidades = pedidoLoteIdentidadesPED(row);
  return identidades.length ? {key:identidades[0],identidades,codigoSnapshot:pedidoLoteCodigoPED(row),fechaSnapshot:String(row.fecha || row.fechaProduccion || row.fechaCreacion || '')} : null;
}
function pedidoLotesResumenPED(order){
  if (!pedidoLotesRegistroValidoPED(order)) return 'Lotes vinculados: revisar registro';
  const refs = order.lotesVinculados?.lotes || [];
  return refs.length ? 'Lotes vinculados: ' + refs.map(ref => ref.codigoSnapshot || ref.key).join(', ') : 'Sin lotes vinculados';
}
function createPedidoLotesButtonPED(id, mode){
  const button = document.createElement('button');button.type='button';button.className='btn-secondary';button.textContent='Vincular lotes';
  button.addEventListener('click', () => openPedidoLotesPED(id, mode));return button;
}
function renderPedidoLotesEditorPED(){
  const editor = pedidoLotesEditorPED;if (!editor) return;
  const host = $('pedido-lotes-list');host.replaceChildren();
  editor.refs.forEach((ref,index) => {
    const result = pedidoLotesResolverPED(ref, editor.catalog.rows);
    const row = document.createElement('li');
    const text = document.createElement('span');
    const current = result.row ? pedidoLoteCodigoPED(result.row) : '';
    text.textContent = (ref.codigoSnapshot || ref.key) + (current && current !== ref.codigoSnapshot ? ' · Código actual: ' + current : '') + ' · ' + (editor.catalog.error ? 'Lectura no disponible' : result.status);
    const remove = document.createElement('button');remove.type='button';remove.className='btn-secondary';remove.textContent='Quitar vínculo';remove.disabled=!!editor.error;
    remove.addEventListener('click', () => {editor.refs.splice(index,1);editor.dirty=true;renderPedidoLotesEditorPED();});row.append(text,remove);host.appendChild(row);
  });
  const select = $('pedido-lotes-select');select.replaceChildren();
  const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Seleccionar lote…';select.appendChild(placeholder);
  editor.options=[];
  editor.catalog.rows.forEach(row => {
    const ref=pedidoLoteReferenciaPED(row);
    if (!ref || pedidoLotesResolverPED(ref,editor.catalog.rows).status !== 'Localizado' || editor.refs.some(old => old.identidades.some(id => ref.identidades.includes(id)))) return;
    const option=document.createElement('option');option.value=String(editor.options.length);option.textContent=(ref.codigoSnapshot || ref.key) + (ref.fechaSnapshot ? ' · ' + ref.fechaSnapshot : '');editor.options.push(ref);select.appendChild(option);
  });
  select.disabled=!!editor.error;$('pedido-lotes-add').disabled=!!editor.error || !editor.options.length;
  $('pedido-lotes-save').disabled=!!editor.error;
}
function openPedidoLotesPED(id, mode){
  if (pedidoLotesEditorPED?.dirty && !confirm('Hay vínculos sin guardar. ¿Descartar esos cambios?')) return;
  const order=(mode==='rapido'?loadQuickOrdersPED():loadPedidos()).find(row => String(row.id)===String(id));if (!order) return;
  const catalog=readPedidoLotesCatalogPED();
  const invalid=!pedidoLotesRegistroValidoPED(order);
  const error=invalid ? 'El registro de vínculos no es válido. Se conserva sin modificar; revisá los datos antes de continuar.' : catalog.error;
  pedidoLotesEditorPED={id,mode,base:JSON.parse(JSON.stringify(order)),refs:invalid?[]:JSON.parse(JSON.stringify(order.lotesVinculados?.lotes || [])),catalog,error,dirty:false};
  $('pedido-lotes-title').textContent='Lotes vinculados · ' + (order.codigo || 'Pedido');
  $('pedido-lotes-legacy').textContent=order.lotesRelacionados ? 'Texto histórico conservado: ' + order.lotesRelacionados : 'Sin texto histórico de lotes.';
  $('pedido-lotes-notice').textContent=error || 'Solo se ofrecen lotes con identidad única. Los vínculos anteriores no se eliminan si falta el lote.';
  $('pedido-lotes-add').onclick=()=>{
    const value=$('pedido-lotes-select').value;if(value==='')return;
    const ref=pedidoLotesEditorPED.options[Number(value)];if(!ref)return;
    pedidoLotesEditorPED.refs.push(JSON.parse(JSON.stringify(ref)));pedidoLotesEditorPED.dirty=true;renderPedidoLotesEditorPED();
  };
  $('pedido-lotes-save').onclick=savePedidoLotesPED;$('pedido-lotes-close').onclick=closePedidoLotesPED;
  renderPedidoLotesEditorPED();$('pedido-lotes-modal').hidden=false;document.body.classList.add('a33-modal-open');$('pedido-lotes-select').focus();
}
function closePedidoLotesPED(){
  if(pedidoLotesEditorPED?.dirty && !confirm('Hay vínculos sin guardar. ¿Cerrar y descartar esos cambios?'))return;
  $('pedido-lotes-modal').hidden=true;pedidoLotesEditorPED=null;document.body.classList.remove('a33-modal-open');
}
function savePedidoLotesPED(){
  const editor=pedidoLotesEditorPED;if(!editor || editor.error)return;
  const notice=$('pedido-lotes-notice');
  const records=editor.mode==='rapido'?loadQuickOrdersPED():loadPedidos();
  const index=records.findIndex(row => String(row.id)===String(editor.id));const fingerprint=window.A33Storage && A33Storage.recordFingerprint;
  if(index<0 || !fingerprint || fingerprint(records[index])!==fingerprint(editor.base)){notice.textContent='Este pedido cambió o fue eliminado. Los vínculos pendientes se conservan; cerrá y abrí el pedido vigente para revisarlo.';return;}
  const catalog=readPedidoLotesCatalogPED();if(catalog.error){notice.textContent=catalog.error;return;}
  const previous=editor.base.lotesVinculados?.lotes || [];
  if(editor.refs.some(ref => !previous.some(old => old.key===ref.key) && pedidoLotesResolverPED(ref,catalog.rows).status!=='Localizado')){
    notice.textContent='Un lote seleccionado dejó de localizarse de forma única. Se conservan los vínculos pendientes; cerrá y revisá el catálogo vigente.';return;
  }
  const now=Date.now();const updated={...records[index],lotesVinculados:{schemaVersion:1,lotes:JSON.parse(JSON.stringify(editor.refs)),updatedAt:now},updatedAt:now};
  if(!pedidoLotesRegistroValidoPED(updated)){notice.textContent='Los vínculos no tienen identidades válidas y únicas. No se guardaron cambios.';return;}
  records[index]=updated;
  const result=editor.mode==='rapido'?saveQuickOrdersPED(records,[editor.id]):{ok:savePedidos(records,[editor.id])};
  if(!result || !result.ok){notice.textContent=result?.message || 'No se pudo confirmar el guardado. Los vínculos pendientes se conservan.';return;}
  const persisted=(editor.mode==='rapido'?loadQuickOrdersPED():loadPedidos()).find(row => String(row.id)===String(editor.id));
  if(!persisted || fingerprint(persisted.lotesVinculados)!==fingerprint(updated.lotesVinculados)){notice.textContent='No se pudo comprobar el guardado. Los vínculos pendientes se conservan.';return;}
  pedidoLotesEditorPED={...editor,base:JSON.parse(JSON.stringify(persisted)),catalog,dirty:false};renderPedidoLotesEditorPED();notice.textContent='Vínculos guardados ✓';renderTable();renderQuickOrdersPED();
}
window.addEventListener('beforeunload', event => {if(pedidoLotesEditorPED?.dirty){event.preventDefault();event.returnValue='';}});


// E6.4: demanda de solo lectura; distingue saldo registrado y estimación sin acumulado.
function pedidoDemandaCantidadOriginalPED(item,mode){
  const value=mode==='rapido' ? (item.cantidad ?? item.qty ?? item.quantity ?? item.unidades) : (item.qty ?? item.cantidad ?? item.quantity ?? item.unidades ?? 0);
  return Number(mode==='completo' ? String(value).replace(',', '.') : value);
}
function readPedidoDemandaSourcePED(){
  const result={completo:[],rapido:[],issues:{completo:[],rapido:[]},error:''};
  for(const [mode,key,label] of [['completo',STORAGE_KEY_PEDIDOS,'Pedidos completos'],['rapido',STORAGE_KEY_PEDIDOS_RAPIDOS,'Pedidos rápidos']]){
    try{
      const raw=localStorage.getItem(key);const parsed=raw==null?[]:JSON.parse(raw);
      if(!Array.isArray(parsed) || parsed.some(row=>!row || typeof row!=='object' || Array.isArray(row)))throw new Error('Colección incompleta');
      result.issues[mode]=parsed.map(order=>{
        const items=mode==='rapido'?([order.items,order.productosPedido,order.pedidoItems,order.productos].find(Array.isArray) || []):getPedidoProductItemsArray(order);
        if(items.some(item=>!item || typeof item!=='object' || Array.isArray(item) || !Number.isFinite(pedidoDemandaCantidadOriginalPED(item,mode)) || pedidoDemandaCantidadOriginalPED(item,mode)<=0))return 'Productos o cantidades incompletos en el registro original.';
        if(mode==='completo' && !items.length && LEGACY_PRESENTACIONES.some(pres=>{const value=order[pres.qtyId];return value!=null && value!=='' && (!Number.isFinite(Number(String(value).replace(',', '.'))) || Number(String(value).replace(',', '.'))<0);}))return 'Cantidad histórica inválida en el registro original.';
        return '';
      });
      result[mode]=mode==='rapido'?parsed.map(normalizeQuickOrderPED):normalizePedidosList(parsed);
    }catch(_){result.error='No se pudo leer '+label+'. No se puede calcular una demanda completa.';return result;}
  }
  return result;
}
function buildPedidoDemandaPED(source,filter={}){
  const result={rows:[],sources:[],review:[],excluded:0,totalRegistrado:0,totalEstimado:0,total:0,error:source.error || ''};
  if(result.error)return result;
  const desde=String(filter.desde || ''),hasta=String(filter.hasta || '');
  if((desde && !isExactQuickOrderDatePED(desde)) || (hasta && !isExactQuickOrderDatePED(hasta)) || (desde && hasta && desde>hasta)){
    result.error='Revisá el período: las fechas deben ser válidas y Desde no puede ser posterior a Hasta.';return result;
  }
  const groups=new Map();
  for(const mode of ['completo','rapido']){
    const records=source[mode] || [];const counts=new Map();
    records.forEach(order=>{const id=String(order.id);counts.set(id,(counts.get(id)||0)+1);});
    records.forEach((order,index)=>{
      if(!['pendiente','en_preparacion','listo'].includes(getPedidoEstado(order))){result.excluded++;return;}
      const date=String(order.fechaEntrega || '').slice(0,10);
      const code=String(order.codigo || order.id || 'Pedido');
      const type=mode==='rapido'?'Rápido':'Completo';
      const review=reason=>result.review.push({tipo:type,codigo:code,id:String(order.id),fecha:date,motivo:reason});
      if(!isExactQuickOrderDatePED(date)){review('Fecha de entrega ausente o inválida; no incluida en el total.');return;}
      if((desde && date<desde) || (hasta && date>hasta))return;
      if(counts.get(String(order.id))>1){review('Identidad de pedido duplicada; no incluida en el total.');return;}
      if(source.issues?.[mode]?.[index]){review(source.issues[mode][index]+' No incluido en el total.');return;}
      const error=validarEntregasPedidoPED(order,mode);
      if(error){review(error+' No incluido en el total.');return;}
      const lines=pedidoEntregasLineasPED(order,mode);
      if(!lines.length || lines.some(line=>!Number.isFinite(line.qty) || line.qty<=0 || (mode==='rapido' && !Number.isInteger(line.qty)))){
        review('Productos o cantidades incompletos; no incluidos en el total.');return;
      }
      const products=mode==='rapido'?order.items:getPedidoDetailProductLinesPED(order,getPriceSnapshotFromPedido(order));
      lines.forEach((line,lineIndex)=>{
        const productId=String(products[lineIndex]?.productId || '').trim();
        // Sin productId no se fusionan familias, nombres ni fotografías de pedidos diferentes.
        const identity=productId?'product:'+productId:'historical:'+mode+':'+index+':'+line.key;
        const key=JSON.stringify([date,identity]);
        const registered=line.registered && order.entregasAcumuladas.productos.some(ref=>ref.key===line.key);
        const pending=line.qty-(registered?line.delivered:0);
        let group=groups.get(key);
        if(!group){group={fecha:date,productId,identity,label:line.label,labels:new Set(),registrado:0,estimado:0,total:0,pedidos:new Set(),historico:!productId};groups.set(key,group);}
        group.labels.add(line.label);group.pedidos.add(mode+':'+index);
        if(registered)group.registrado+=pending;else group.estimado+=pending;
        group.total+=pending;
        result.sources.push({tipo:type,codigo:code,id:String(order.id),fecha:date,estado:pedidoEstadoLabelPED(getPedidoEstado(order)),productId,identity,label:line.label,pedido:line.qty,entregado:registered?line.delivered:null,pendiente:pending,registro:registered?'Con registro de entregas':'Estimado: sin registro de entregas',historico:!productId});
      });
    });
  }
  result.rows=Array.from(groups.values()).map(group=>({...group,label:Array.from(group.labels).join(' / '),labels:undefined,pedidos:group.pedidos.size})).sort((a,b)=>a.fecha.localeCompare(b.fecha)||a.label.localeCompare(b.label)||a.identity.localeCompare(b.identity));
  result.rows.forEach(row=>{result.totalRegistrado+=row.registrado;result.totalEstimado+=row.estimado;});result.total=result.totalRegistrado+result.totalEstimado;
  return result;
}
function getPedidoDemandaPED(){
  return buildPedidoDemandaPED(readPedidoDemandaSourcePED(),{desde:$('pedido-demanda-desde')?.value || '',hasta:$('pedido-demanda-hasta')?.value || ''});
}
// E6.5: saldo central informativo; no suma snapshots de Lotes ni saldos POS.
function readPedidoDisponibilidadPED(){
  try{
    const raw=localStorage.getItem('arcano33_inventario');
    if(raw===null)return {stocks:null,error:'Inventario central ausente.'};
    const data=JSON.parse(raw);
    if(!data || typeof data!=='object' || Array.isArray(data) || !data.finishedByProductId || typeof data.finishedByProductId!=='object' || Array.isArray(data.finishedByProductId))return {stocks:null,error:'Inventario sin saldos identificados verificables.'};
    return {stocks:data.finishedByProductId,error:''};
  }catch(_){return {stocks:null,error:'No se pudo leer el Inventario central.'};}
}
function buildPedidoDisponibilidadPED(demand,inventory){
  if(demand.error)return [];
  const groups=new Map();
  for(const row of demand.rows){
    let group=groups.get(row.identity);
    if(!group){group={productId:row.productId,identity:row.identity,label:row.label,registrado:0,estimado:0,total:0};groups.set(row.identity,group);}
    group.registrado+=row.registrado;group.estimado+=row.estimado;group.total+=row.total;
  }
  return Array.from(groups.values()).map(row=>{
    const entry=row.productId && inventory.stocks && Object.prototype.hasOwnProperty.call(inventory.stocks,row.productId)?inventory.stocks[row.productId]:null;
    const raw=entry && typeof entry==='object' && !Array.isArray(entry)?entry.stock:null;
    const stock=typeof raw==='number'?raw:(typeof raw==='string' && raw.trim()?Number(raw):NaN);
    const valid=Number.isFinite(stock) && (!entry.productId || String(entry.productId)===row.productId);
    const reason=!row.productId?'Producto histórico sin identidad verificable.':inventory.error || (!valid?'Saldo ausente o inválido para este producto.':'Saldo central actual; comparación informativa.');
    return {...row,stock:valid?stock:null,difference:valid?stock-row.total:null,reason};
  });
}
function renderPedidoDisponibilidadPED(demand){
  const host=$('pedido-disponibilidad-body');if(!host)return;
  host.replaceChildren();
  if(demand.error)return;
  const rows=buildPedidoDisponibilidadPED(demand,readPedidoDisponibilidadPED());
  for(const row of rows){
    const tr=document.createElement('tr');
    for(const value of [row.label,row.registrado,row.estimado,row.total,row.stock===null?'Sin confirmar':row.stock,row.difference===null?'Sin confirmar':row.difference,row.reason]){
      const td=document.createElement('td');td.textContent=String(value);tr.appendChild(td);
    }
    host.appendChild(tr);
  }
  if(!rows.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=7;td.textContent='No hay demanda calculable para comparar.';tr.appendChild(td);host.appendChild(tr);}
}
function renderPedidoDemandaPED(){
  const host=$('pedido-demanda-body');if(!host)return;
  const data=getPedidoDemandaPED();renderPedidoDisponibilidadPED(data);host.replaceChildren();$('pedido-demanda-sources').replaceChildren();$('pedido-demanda-review').replaceChildren();
  $('pedido-demanda-export').disabled=!!data.error;
  if(data.error){$('pedido-demanda-status').textContent=data.error;return;}
  $('pedido-demanda-status').textContent=`Total informativo: ${data.total} · Pendiente con registro: ${data.totalRegistrado} · Estimado sin registro: ${data.totalEstimado}. ${data.review.length} pedidos para revisión no incluidos en el total. Todas las fechas si no se indica un período.`;
  data.rows.forEach(row=>{
    const tr=document.createElement('tr');
    [formatDate(row.fecha),row.label+(row.historico?' · Histórico sin vínculo al catálogo':''),row.registrado,row.estimado,row.total,row.pedidos].forEach(value=>{const td=document.createElement('td');td.textContent=String(value);tr.appendChild(td);});host.appendChild(tr);
  });
  if(!data.rows.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=6;td.textContent='No hay demanda calculable en este período.';tr.appendChild(td);host.appendChild(tr);}
  for(const [id,rows,describe] of [['pedido-demanda-sources',data.sources,row=>`${row.tipo} ${row.codigo} · ${formatDate(row.fecha)} · ${row.label}: pendiente ${row.pendiente} · ${row.registro}`],['pedido-demanda-review',data.review,row=>`${row.tipo} ${row.codigo} · ${row.motivo}`]]){
    const list=$(id);rows.forEach(row=>{const li=document.createElement('li');li.textContent=describe(row);list.appendChild(li);});
    if(!rows.length){const li=document.createElement('li');li.textContent=id==='pedido-demanda-sources'?'Sin pedidos considerados.':'Sin incidencias de revisión.';list.appendChild(li);}
  }
}
function refreshPedidoDemandaIfOpenPED(){if($('pedido-demanda-panel')?.open)renderPedidoDemandaPED();}
function exportPedidoDemandaPED(){
  const data=getPedidoDemandaPED();const status=$('pedido-demanda-status');
  if(data.error){renderPedidoDemandaPED();return;}
  if(typeof XLSX==='undefined'){status.textContent='No se pudo generar Excel: librería XLSX no disponible.';return;}
  try{
    const wb=XLSX.utils.book_new();
    const add=(name,rows)=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);
    add('Demanda',[['Fecha entrega','Producto','productId / identidad histórica','Pendiente con registro','Estimado sin registro','Total informativo','Pedidos','Identidad'],...data.rows.map(row=>[row.fecha,row.label,row.productId || row.identity,row.registrado,row.estimado,row.total,row.pedidos,row.historico?'Histórico sin productId':'Producto identificado'])]);
    add('Pedidos considerados',[['Tipo','Código pedido','ID pedido','Fecha entrega','Estado','Producto','Identidad','Cantidad pedida','Entregado acumulado','Pendiente','Origen del cálculo'],...data.sources.map(row=>[row.tipo,row.codigo,row.id,row.fecha,row.estado,row.label,row.productId || row.identity,row.pedido,row.entregado===null?'':row.entregado,row.pendiente,row.registro])]);
    add('Revisión',[['Tipo','Código pedido','ID pedido','Fecha entrega','Motivo'],...data.review.map(row=>[row.tipo,row.codigo,row.id,row.fecha,row.motivo])]);
    add('Período',[['Desde','Hasta','Regla'],[$('pedido-demanda-desde')?.value || 'Todas',$('pedido-demanda-hasta')?.value || 'Todas','Activos Pendiente / En preparación / Listo. Sin registro: estimación completa. Sin reservas.']]);
    const availability=buildPedidoDisponibilidadPED(data,readPedidoDisponibilidadPED());
    add('Disponibilidad',[['Producto','productId / identidad histórica','Pendiente con registro','Estimado sin registro','Demanda del período','Saldo actual Inventario','Diferencia saldo menos demanda','Verificación','Fuente / observación'],...availability.map(row=>[row.label,row.productId || row.identity,row.registrado,row.estimado,row.total,row.stock===null?'':row.stock,row.difference===null?'':row.difference,row.stock===null?'Sin confirmar':'Saldo identificado',row.reason])]);
    add('Contexto disponibilidad',[['Consulta solicitada','Fuente','Regla','Límite'],[new Date().toISOString(),'Inventario central: productos terminados por identidad','Saldo actual una vez por producto para todo el período. Incluye estimaciones. No suma Lotes/POS. No reserva ni descuenta.','No garantiza disponibilidad futura. Pedidos para revisión excluidos; lecturas no atómicas entre pestañas.']]);
    XLSX.writeFile(wb,'demanda_pedidos.xlsx');status.textContent='Exportación de demanda solicitada. '+data.review.length+' pedidos para revisión no incluidos en el total.';
  }catch(_){status.textContent='No se pudo generar la exportación de demanda. No se modificaron los pedidos.';}
}
function initPedidoDemandaPED(){
  const panel=$('pedido-demanda-panel');if(!panel)return;
  panel.addEventListener('toggle',()=>{if(panel.open)renderPedidoDemandaPED();});
  $('pedido-demanda-refresh').addEventListener('click',renderPedidoDemandaPED);
  for(const id of ['pedido-demanda-desde','pedido-demanda-hasta'])$(id).addEventListener('change',renderPedidoDemandaPED);
  $('pedido-demanda-export').addEventListener('click',exportPedidoDemandaPED);
}
window.addEventListener('storage',event=>{if(event.key===null || [STORAGE_KEY_PEDIDOS,STORAGE_KEY_PEDIDOS_RAPIDOS,'arcano33_inventario'].includes(event.key))refreshPedidoDemandaIfOpenPED();});

// E5.3: borradores de formularios, separados de los pedidos registrados.
const PED_FORM_DRAFT_PREFIX = 'a33_pedidos_form_draft_v1_';
const PED_FORM_FIELDS = {
  completo:['fechaCreacion','fechaEntrega','codigoPedido','prioridad','clienteBuscar','clienteNombre','clienteId','clienteTipo','clienteTelefono','clienteDireccion','clienteReferencia','clienteNewName','envio','descuento','pagoAnticipado','subtotal','totalPagar','saldoPendiente','metodoPago','estado','lotesRelacionados'],
  rapido:['quick-customer-search','quick-delivery-date','quick-priority','quick-status','quick-product-select','quick-product-quantity']
};
const pedFormDraftState = { ready:false, restoring:false, instance:Date.now().toString(36)+'_'+Math.random().toString(36).slice(2), completo:{dirty:false}, rapido:{dirty:false} };
let quickOrderDraftIdPED = null;
function pedidoDraftKeyPED(mode){ return PED_FORM_DRAFT_PREFIX+pedFormDraftState.instance+'_'+mode; }
function pedidoDraftStatusPED(message){ const el=$('pedido-draft-status');if(el)el.textContent=message; }
function capturePedidoFormDraftPED(mode){
  const fields={};for(const id of PED_FORM_FIELDS[mode]){if($(id))fields[id]=String($(id).value || '');}
  const common={schemaVersion:1,mode,updatedAt:Date.now(),fields};
  if(mode==='rapido'){
    if(!quickOrderDraftIdPED)quickOrderDraftIdPED=createQuickOrderIdPED(Date.now());
    return {...common,editingId:quickOrderEditingId,baseRecord:typeof quickOrderBaseRecordPED!=='undefined'?quickOrderBaseRecordPED:null,baseUpdatedAt:quickOrderEditingUpdatedAt,draftId:quickOrderDraftIdPED,customer:getQuickCustomerPED(),items:quickOrderItemsDraft,lineQuantities:Array.from(document.querySelectorAll('#quick-product-lines input[data-draft-index]')).map(el=>({index:Number(el.dataset.draftIndex),raw:el.value}))};
  }
  return {...common,editingId,baseRecord:typeof editingBaseRecordPED!=='undefined'?editingBaseRecordPED:null,archivedSourceId:viewingArchivedId,baseUpdatedAt:editingBaseUpdatedAt,draftId:ensureDraftPedidoId(false),customer:getCustomerFromUI(),priceSnapshot:currentPriceSnapshot,
    historical:currentHistoricalPedidoItemsPED,products:PRESENTACIONES.map(p=>({productId:p.productId,key:p.key,label:p.label,price:p.price,legacyKey:p.legacyKey || '',rawProduct:p.rawProduct || {},rawQty:String($(p.qtyId)?.value || '')}))};
}
function persistPedidoFormDraftPED(mode){
  if(!pedFormDraftState.ready || pedFormDraftState.restoring || !pedFormDraftState[mode].dirty)return true;
  try{
    const payload=JSON.stringify(capturePedidoFormDraftPED(mode));
    if(!A33Storage.setItem(pedidoDraftKeyPED(mode),payload,'local'))throw new Error('Storage bloqueado o lleno');
    pedFormDraftState[mode].failed=false;
    pedidoDraftStatusPED(pedFormDraftState.completo.failed || pedFormDraftState.rapido.failed
      ? 'Una modalidad tiene cambios cuyo borrador no se pudo guardar. Conservá esta pestaña abierta y reintentá.'
      : 'Borrador local actualizado. El pedido todavía no está guardado.');return true;
  }catch(err){
    pedFormDraftState[mode].failed=true;
    pedidoDraftStatusPED('No se pudo guardar el borrador. Conservá esta pestaña abierta y volvé a editar para reintentar.');return false;
  }
}
function discardCurrentPedidoDraftPED(mode, approved){
  const state=pedFormDraftState[mode];
  if(pedFormDraftState.ready && state.dirty && !approved && !confirm('¿Descartar los cambios pendientes de este formulario?'))return false;
  if(pedFormDraftState.ready){
    try{if(!A33Storage.removeItem(pedidoDraftKeyPED(mode),'local'))throw new Error('No se pudo quitar el borrador');}
    catch(_){pedidoDraftStatusPED('El formulario se limpió, pero su copia local no se pudo quitar. Sigue disponible en los borradores.');}
  }
  state.dirty=false;state.failed=false;state.recovered=false;state.editingId=null;state.baseUpdatedAt=null;state.draftId=null;
  return true;
}
function validatePedidoFormDraftPED(value){
  if(!value || value.schemaVersion!==1 || !PED_FORM_FIELDS[value.mode] || !value.fields || Array.isArray(value.fields))return false;
  if(!Number.isFinite(value.updatedAt) || typeof value.draftId!=='string' || !value.draftId)return false;
  if(!Object.values(value.fields).every(v=>typeof v==='string'))return false;
  if(value.editingId!=null && !['string','number'].includes(typeof value.editingId))return false;
  if(value.baseRecord!=null && (typeof value.baseRecord!=='object' || Array.isArray(value.baseRecord) || String(value.baseRecord.id)!==String(value.editingId)))return false;
  if(value.baseUpdatedAt!=null && !Number.isFinite(value.baseUpdatedAt))return false;
  if(!value.customer || typeof value.customer.name!=='string')return false;
  if(value.mode==='rapido')return Array.isArray(value.items) && value.items.every(i=>i && typeof i.productId==='string' && Number.isInteger(i.cantidad) && i.cantidad>0) && Array.isArray(value.lineQuantities) && value.lineQuantities.every(q=>q && Number.isInteger(q.index) && q.index>=0 && q.index<value.items.length && typeof q.raw==='string');
  return Array.isArray(value.historical) && value.historical.every(i=>i && typeof i==='object') && value.priceSnapshot && typeof value.priceSnapshot==='object'
    && Array.isArray(value.products) && value.products.every(p=>p && typeof p.rawQty==='string' && typeof p.key==='string' && typeof p.label==='string' && Number.isFinite(p.price));
}
function recoveredPedidoConflictPED(mode){
  const state=pedFormDraftState[mode];if(!state.recovered)return '';
  const records=mode==='rapido'?loadQuickOrdersPED():loadPedidos();
  if(state.editingId!=null){
    const record=records.find(p=>String(p.id)===String(state.editingId));
    const version=record && (mode==='rapido'?Number(record.updatedAt || 0):(typeof record.updatedAt==='number'?record.updatedAt:null));
    if(!record || version!==state.baseUpdatedAt)return 'El pedido original cambió o ya no está disponible. Los cambios recuperados se conservan; revisá el pedido vigente antes de guardar.';
  }else if(records.some(p=>String(p.id)===String(state.draftId))){
    return 'Este borrador corresponde a un pedido ya registrado. Revisá ese pedido antes de guardar para evitar duplicados.';
  }
  return '';
}
function restorePedidoFormDraftPED(record){
  if(!validatePedidoFormDraftPED(record)){pedidoDraftStatusPED('Borrador incompatible o incompleto. Se conserva sin aplicar.');return false;}
  const mode=record.mode;
  // Un producto desaparecido con cantidad inválida no puede convertirse en una línea histórica.
  if(mode==='completo' && record.products.some(p=>p.rawQty && !PRESENTACIONES.some(c=>c.key===p.key && c.label===p.label && c.price===p.price) && (!Number.isInteger(Number(p.rawQty)) || Number(p.rawQty)<0))){
    pedidoDraftStatusPED('Hay una cantidad inválida de un producto que cambió. El borrador se conserva sin aplicar.');return false;
  }
  if(!discardCurrentPedidoDraftPED(mode,false))return false;
  pedFormDraftState.restoring=true;
  try{
    if(mode==='completo'){
      currentHistoricalPedidoItemsPED=JSON.parse(JSON.stringify(record.historical));
      for(const p of record.products){
        if(!PRESENTACIONES.some(c=>c.key===p.key && c.label===p.label && c.price===p.price) && Number(p.rawQty)>0){
          currentHistoricalPedidoItemsPED.push(normalizePedidoItemForStoragePED({productId:p.productId,productKey:p.key,productName:p.label,qty:Number(p.rawQty),unitPriceSnapshot:p.price,productSnapshot:p.rawProduct,legacyKey:p.legacyKey,source:'snapshot'}));
        }
      }
      renderPedidosProductRows(PRESENTACIONES);
      for(const p of PRESENTACIONES){const saved=record.products.find(c=>c.key===p.key && c.label===p.label && c.price===p.price);if($(p.qtyId))$(p.qtyId).value=saved?saved.rawQty:'0';}
      currentPriceSnapshot={...record.priceSnapshot};editingId=record.editingId;editingBaseRecordPED=record.baseRecord?JSON.parse(JSON.stringify(record.baseRecord)):null;editingBaseUpdatedAt=record.baseUpdatedAt;draftPedidoId=record.draftId;
      renderCustomerSelect('');setCustomerSelection(record.customer);
      if(record.customer.id && !Array.from($('clienteSelect').options).some(o=>o.value==='id:'+record.customer.id)){
        const option=document.createElement('option');option.value='id:'+record.customer.id;
        option.dataset.id=record.customer.id;option.dataset.name=record.customer.name;option.textContent=record.customer.name+' (recuperado)';
        $('clienteSelect').appendChild(option);$('clienteSelect').value=option.value;
      }
      viewingArchivedId=record.archivedSourceId || null;
      showArchivedModeBanner(viewingArchivedId?'Viendo pedido archivado (Histórico). Guardar creará un pedido activo nuevo.':'');
      $('save-btn').textContent=editingId!=null?'Actualizar pedido':'Guardar pedido';
    }else{
      quickOrderItemsDraft=JSON.parse(JSON.stringify(record.items));quickOrderEditingId=record.editingId;quickOrderBaseRecordPED=record.baseRecord?JSON.parse(JSON.stringify(record.baseRecord)):null;quickOrderEditingUpdatedAt=record.baseUpdatedAt;quickOrderDraftIdPED=record.draftId;
      renderQuickCustomerSelectPED('','');ensureQuickHistoricalCustomerPED({customerId:record.customer.id,customerName:record.customer.name});renderQuickProductLinesPED();
      for(const q of record.lineQuantities){const el=document.querySelector('#quick-product-lines input[data-draft-index="'+q.index+'"]');if(el)el.value=q.raw;
        if(Number.isInteger(Number(q.raw)) && Number(q.raw)>=1)quickOrderItemsDraft[q.index].cantidad=Number(q.raw);}
      $('quick-save-btn').textContent=quickOrderEditingId!=null?'Actualizar Pedido rápido':'Guardar Pedido rápido';
    }
    for(const id of PED_FORM_FIELDS[mode]){if($(id) && hasOwnPED(record.fields,id))$(id).value=record.fields[id];}
    const state=pedFormDraftState[mode];Object.assign(state,{dirty:true,recovered:true,editingId:record.editingId,baseUpdatedAt:record.baseUpdatedAt,draftId:record.draftId});
    if(mode==='completo')toggleNewCustomerBox(!!record.fields.clienteNewName);
    setPedidoModePED(mode);
  }finally{pedFormDraftState.restoring=false;}
  const ok=persistPedidoFormDraftPED(mode);
  const conflict=recoveredPedidoConflictPED(mode);
  if(ok)pedidoDraftStatusPED(conflict || 'Formulario recuperado. Revisá los datos antes de guardar. La copia de origen se conserva hasta que elijas Descartar.');
  return true;
}
function renderPedidoFormDraftsPED(){
  const list=$('pedido-draft-list');if(!list)return;list.replaceChildren();
  try{
    const keys=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key && key.startsWith(PED_FORM_DRAFT_PREFIX))keys.push(key);}
    for(const key of keys.sort()){
      const raw=localStorage.getItem(key);let record;try{record=JSON.parse(raw);}catch(_){}
      const row=document.createElement('div');row.className='form-actions';
      const label=document.createElement('span');const valid=validatePedidoFormDraftPED(record);
      label.textContent=valid?`${record.mode==='rapido'?'Pedido rápido':'Pedido completo'} · ${record.customer.name || 'Sin cliente'} · ${new Date(record.updatedAt).toLocaleString('es-NI')}`:'Borrador incompatible: se conserva';
      const recover=document.createElement('button');recover.type='button';recover.className='btn-secondary';recover.textContent='Recuperar';recover.disabled=!valid;
      recover.addEventListener('click',()=>{try{const latest=JSON.parse(localStorage.getItem(key));restorePedidoFormDraftPED(latest);}catch(_){pedidoDraftStatusPED('No se pudo leer el borrador. Se conserva sin aplicar.');}});
      const discard=document.createElement('button');discard.type='button';discard.className='btn-secondary';discard.textContent='Descartar';
      discard.addEventListener('click',()=>{
        if(!confirm('¿Descartar únicamente esta copia del borrador? El formulario abierto y los pedidos registrados se conservan.'))return;
        if(!A33Storage.removeItem(key,'local')){pedidoDraftStatusPED('No se pudo descartar el borrador.');return;}
        renderPedidoFormDraftsPED();
      });row.append(label,recover,discard);list.appendChild(row);
    }
    if(!keys.length)list.textContent='No hay copias pendientes para recuperar.';
  }catch(_){pedidoDraftStatusPED('No se pudieron leer los borradores. No se ha eliminado ninguna copia.');}
}
function initPedidoFormDraftsPED(){
  pedFormDraftState.ready=true;
  for(const [mode,id] of [['completo','pedido-form'],['rapido','quick-order-form']]){
    const form=$(id);if(!form)continue;
    const changed=()=>{pedFormDraftState[mode].dirty=true;persistPedidoFormDraftPED(mode);};
    form.addEventListener('input',changed);form.addEventListener('change',changed);
    // Incluir selección/creación de cliente y cambios de líneas mediante botones.
    form.addEventListener('click',e=>{const button=e.target.closest('button');if(!button || button.type==='submit' || ['reset-btn','quick-reset-btn','calc-totals-btn'].includes(button.id))return;queueMicrotask(changed);});
  }
  $('pedido-draft-refresh')?.addEventListener('click',renderPedidoFormDraftsPED);
  window.addEventListener('beforeunload',e=>{
    if(!pedFormDraftState.completo.dirty && !pedFormDraftState.rapido.dirty)return;
    persistPedidoFormDraftPED('completo');persistPedidoFormDraftPED('rapido');e.preventDefault();e.returnValue='';
  });
  window.addEventListener('pagehide',()=>{persistPedidoFormDraftPED('completo');persistPedidoFormDraftPED('rapido');});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){persistPedidoFormDraftPED('completo');persistPedidoFormDraftPED('rapido');}});
  renderPedidoFormDraftsPED();
}
