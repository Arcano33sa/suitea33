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
    const raw = (window.sessionStorage) ? window.sessionStorage.getItem(PEDIDOS_DRAFT_KEY) : null;
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    const id = String(obj.id || '').trim();
    const createdAt = Number(obj.createdAt || 0);
    if (!id || !createdAt || !isFinite(createdAt)) return null;
    // Expira para evitar estados pegajosos si la pestaña queda abierta días
    const age = _nowMs() - createdAt;
    if (age > 1000*60*60*6) return null; // 6 horas
    return { id, createdAt };
  }catch(_){
    return null;
  }
}

function _writeDraftPedido(d){
  try{
    if (!window.sessionStorage) return;
    window.sessionStorage.setItem(PEDIDOS_DRAFT_KEY, JSON.stringify(d || {}));
  }catch(_){ }
}

function clearDraftPedido(){
  draftPedidoId = null;
  try{ if (window.sessionStorage) window.sessionStorage.removeItem(PEDIDOS_DRAFT_KEY); }catch(_){ }
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
  const keys = ['pulso','media','djeba','litro','galon'];
  let sumQty = 0;
  keys.forEach((k) => {
    const v = qty[k];
    if (!isFinite(v)) errors.push(`Cantidad ${k}: inválida.`);
    else if (v < 0) errors.push(`Cantidad ${k}: no puede ser negativa.`);
    else sumQty += v;
  });
  if (sumQty <= 0) errors.push('Agregá al menos una presentación (cantidad > 0).');

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
    'pulsoPrecio','mediaPrecio','djebaPrecio','litroPrecio','galonPrecio',,
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
let posDB = null;
let posPricesCache = null;
let posPricesLoadedAt = 0;

// Snapshot de precios (del pedido en edición) para fallback si POS no está disponible.
let currentPriceSnapshot = null;

const PRESENTACIONES = [
  { key: 'pulso', label: 'Pulso 250 ml', qtyId: 'pulsoCant', legacyPrice: 'pulsoPrecio', legacyDesc: 'pulsoDesc' },
  { key: 'media', label: 'Media 375 ml', qtyId: 'mediaCant', legacyPrice: 'mediaPrecio', legacyDesc: 'mediaDesc' },
  { key: 'djeba', label: 'Djeba 750 ml', qtyId: 'djebaCant', legacyPrice: 'djebaPrecio', legacyDesc: 'djebaDesc' },
  { key: 'litro', label: 'Litro 1000 ml', qtyId: 'litroCant', legacyPrice: 'litroPrecio', legacyDesc: 'litroDesc' },
  { key: 'galon', label: 'Galón 3750 ml', qtyId: 'galonCant', legacyPrice: 'galonPrecio', legacyDesc: 'galonDesc' },
];

function $(id) {
  return document.getElementById(id);
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
    const extra = [p && p.clienteTelefono, p && p.clienteTipo].filter(Boolean).join(' ');
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
    raw.push({ id, name: display });
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
    const key = mapProductNameToPresKey(p.name);
    if (!key) continue;
    const price = typeof p.price === 'number' ? p.price : parseNumber(p.price);
    if (!(price >= 0)) continue;
    // Preferir el registro más reciente si hay duplicados (id autoIncrement).
    const prev = best[key];
    if (!prev || (typeof p.id === 'number' && typeof prev.id === 'number' && p.id > prev.id)) {
      best[key] = { id: p.id, price };
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
  PRESENTACIONES.forEach((pres) => {
    let val = null;
    if (obj && obj[pres.key] != null) val = parseNumber(obj[pres.key]);
    if (val == null || !isFinite(val)) {
      // legacy: pulsoPrecio, mediaPrecio, etc.
      if (p && p[pres.legacyPrice] != null) val = parseNumber(p[pres.legacyPrice]);
    }
    if (typeof val === 'number' && isFinite(val) && val >= 0) {
      snap[pres.key] = val;
    }
  });
  return snap;
}

async function calcularTotalesDesdeFormulario() {
  const qty = {};
  PRESENTACIONES.forEach((pres) => {
    const el = $(pres.qtyId);
    qty[pres.key] = el ? parseNumber(el.value) : 0;
  });

  const posPrices = await getPosPricesMapSafe();
  const fallback = (currentPriceSnapshot && typeof currentPriceSnapshot === 'object') ? currentPriceSnapshot : {};

  let subtotal = 0;
  const unitUsed = {};

  PRESENTACIONES.forEach((pres) => {
    const p = posPrices ? posPrices[pres.key] : null;
    let unit = (typeof p === 'number' && isFinite(p)) ? p : null;
    if (unit == null) {
      const f = fallback[pres.key];
      unit = (typeof f === 'number' && isFinite(f)) ? f : 0;
    }
    unitUsed[pres.key] = unit;
    subtotal += (qty[pres.key] || 0) * unit;
  });

  const envio = parseNumber($('envio').value);
  const descuento = parseNumber($('descuento').value);
  const totalPagar = subtotal - descuento + envio;
  const pagoAnticipado = parseNumber($('pagoAnticipado').value);
  const saldoPendiente = totalPagar - pagoAnticipado;

  $('subtotal').value = subtotal.toFixed(2);
  $('totalPagar').value = totalPagar.toFixed(2);
  $('saldoPendiente').value = saldoPendiente.toFixed(2);

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
    pulsoCant: "0",
    mediaCant: "0",
    djebaCant: "0",
    litroCant: "0",
    galonCant: "0",
    envio: "0",
    descuento: "0",
    pagoAnticipado: "0",
  };

  Object.entries(defaults).forEach(([id, val]) => {
    const el = $(id);
    if (el) el.value = val;
  });

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

  $("pulsoCant").value = pedido.pulsoCant ?? "0";
  $("mediaCant").value = pedido.mediaCant ?? "0";
  $("djebaCant").value = pedido.djebaCant ?? "0";
  $("litroCant").value = pedido.litroCant ?? "0";
  $("galonCant").value = pedido.galonCant ?? "0";

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
    const total = typeof p.totalPagar === "number" ? p.totalPagar : 0;
    totalTd.textContent = total.toFixed(2);
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
    const tot = (typeof p.totalPagar === "number") ? p.totalPagar
      : ((typeof p.total === "number") ? p.total : 0);
    totalTd.textContent = Number(tot || 0).toFixed(2);
    tr.appendChild(totalTd);

    const accionesTd = document.createElement("td");
    accionesTd.className = "actions-cell";

    const verBtn = document.createElement("button");
    verBtn.textContent = "👁";
    verBtn.className = "btn-secondary a33-icon-btn";
    verBtn.type = "button";
    verBtn.title = "Ver / cargar";
    verBtn.setAttribute("aria-label", "Ver / cargar");
    verBtn.addEventListener("click", () => {
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
    accionesTd.appendChild(borrarBtn);
    tr.appendChild(accionesTd);

    tbody.appendChild(tr);
  });
}


function verPedido(id) {
  const pedidos = loadPedidos();
  const p = pedidos.find((x) => x.id === id);
  if (!p) return;

  const lines = [];
  const snap = getPriceSnapshotFromPedido(p);

  const descuento = (p.descuento != null) ? p.descuento
    : ((p.descuentoFijo != null) ? p.descuentoFijo
    : (p.descuentoTotal != null ? p.descuentoTotal : 0));
  const pagoAnt = (p.pagoAnticipado != null) ? p.pagoAnticipado
    : (p.montoPagado != null ? p.montoPagado : 0);
  const estado = p.estado || (p.entregado ? 'entregado' : 'pendiente');

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
  if (p.clienteDireccion) lines.push(`  Dirección (legacy): ${p.clienteDireccion}`);
  if (p.clienteReferencia) lines.push(`  Referencia: ${p.clienteReferencia}`);
  lines.push("");
  lines.push("Presentaciones:");
  PRESENTACIONES.forEach((pres) => {
    const cant = parseNumber(p[pres.qtyId] ?? 0);
    const unit = (snap && typeof snap[pres.key] === 'number') ? snap[pres.key] : 0;
    lines.push(`  ${pres.label}: cant ${cant || 0}, unit C$ ${unit.toFixed(2)}`);
  });
  lines.push("");
  const subtotal = typeof p.subtotal === 'number' ? p.subtotal : 0;
  const envio = typeof p.envio === 'number' ? p.envio : parseNumber(p.envio);
  const total = typeof p.totalPagar === 'number' ? p.totalPagar : (subtotal - parseNumber(descuento) + (envio || 0));
  const saldo = typeof p.saldoPendiente === 'number' ? p.saldoPendiente : (total - parseNumber(pagoAnt));
  lines.push(`Subtotal: C$ ${subtotal.toFixed(2)}`);
  lines.push(`Descuento: C$ ${parseNumber(descuento).toFixed(2)}`);
  lines.push(`Envío: C$ ${(envio || 0).toFixed(2)}`);
  lines.push(`Total a pagar: C$ ${total.toFixed(2)}`);
  lines.push("");
  lines.push("Pago / Estado:");
  lines.push(`  Método: ${p.metodoPago || ""}`);
  lines.push(`  Pago anticipado: C$ ${parseNumber(pagoAnt).toFixed(2)}`);
  lines.push(`  Saldo pendiente: C$ ${saldo.toFixed(2)}`);
  lines.push(`  Estado: ${estado === 'entregado' ? 'Entregado' : 'Pendiente'}`);
  if (p.lotesRelacionados) lines.push(`Lotes relacionados: ${p.lotesRelacionados}`);

  alert(lines.join("\n"));
}

function editPedido(id) {
  const pedidos = loadPedidos();
  const p = pedidos.find((x) => x.id === id);
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
  if (p.lotesRelacionados) descLines.push(`Lotes: ${p.lotesRelacionados.replace(/\r?\n/g, " ")}`);
  const total = typeof p.totalPagar === "number" ? p.totalPagar.toFixed(2) : "";
  if (total) descLines.push(`Total a cobrar: C$ ${total}`);
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
  const p = pedidos.find((x) => x.id === id);
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

  const numOrEmpty = (v) => (typeof v === "number" ? Number(v.toFixed(2)) : "");

  const rows = pedidos.map((p) => {
    const delivered = (p && (p.estado === 'entregado')) || !!p.entregado;
    const subPres = (typeof p.subtotalPresentaciones === 'number') ? p.subtotalPresentaciones
      : (typeof p.subtotal === 'number' ? p.subtotal : null);
    return [
    formatDate(p.fechaCreacion),
    formatDate(p.fechaEntrega),
    p.codigo || "",
    (p.customerName || p.clienteNombre || ""),
    p.clienteTipo || "",
    p.clienteTelefono || "",
    p.clienteDireccion || "",
    (p.clienteReferencia || "").replace(/\r?\n/g, " "),
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
    numOrEmpty(p.descuentoTotal),
    numOrEmpty(p.envio),
    numOrEmpty(p.totalPagar),
    p.metodoPago || "",
    p.estadoPago || "",
    numOrEmpty(p.montoPagado),
    numOrEmpty(p.saldoPendiente),
    (p.lotesRelacionados || "").replace(/\r?\n/g, " "),
    delivered ? "Sí" : "No",
  ];
  });

  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pedidos");

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

document.addEventListener("DOMContentLoaded", () => {
  clearForm();
  // Precalentar cache de precios (si el POS está disponible)
  getPosPricesMapSafe().catch(() => {});

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
      const qPulso = readFiniteNumber('pulsoCant', 'Pulso 250 ml', { min: 0, integer: true });
      if (!qPulso.ok) return qPulso;
      const qMedia = readFiniteNumber('mediaCant', 'Media 375 ml', { min: 0, integer: true });
      if (!qMedia.ok) return qMedia;
      const qDjeba = readFiniteNumber('djebaCant', 'Djeba 750 ml', { min: 0, integer: true });
      if (!qDjeba.ok) return qDjeba;
      const qLitro = readFiniteNumber('litroCant', 'Litro 1000 ml', { min: 0, integer: true });
      if (!qLitro.ok) return qLitro;
      const qGalon = readFiniteNumber('galonCant', 'Galón 3750 ml', { min: 0, integer: true });
      if (!qGalon.ok) return qGalon;

      const nEnvio = readFiniteNumber('envio', 'Envío (C$)', { min: 0 });
      if (!nEnvio.ok) return nEnvio;
      const nDescuento = readFiniteNumber('descuento', 'Descuento (C$)', { min: 0 });
      if (!nDescuento.ok) return nDescuento;
      const nPagoAnt = readFiniteNumber('pagoAnticipado', 'Pago anticipado (C$)', { min: 0 });
      if (!nPagoAnt.ok) return nPagoAnt;

      const fechaCreacion = $("fechaCreacion").value || new Date().toISOString().slice(0, 10);
      const fechaEntrega = $("fechaEntrega").value || fechaCreacion;
      const codigo = $("codigoPedido").value || generateCodigo(fechaCreacion);

      // calcular totales antes de guardar (usa precios del POS + fallback snapshot)
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

      const payload = {
        customer,
        fechaCreacion,
        fechaEntrega,
        codigo,
        qty: {
          pulso: qPulso.value,
          media: qMedia.value,
          djeba: qDjeba.value,
          litro: qLitro.value,
          galon: qGalon.value,
        },
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

        // Cantidades
        pulsoCant: qPulso.value,
        mediaCant: qMedia.value,
        djebaCant: qDjeba.value,
        litroCant: qLitro.value,
        galonCant: qGalon.value,

        // Snapshot de precios unitarios (aunque no se muestre en UI)
        priceSnapshot: totales.unitPricesUsed,

        // Legacy: mantener campos de precio/desc por línea para no romper pedidos viejos/export
        pulsoPrecio: totales.unitPricesUsed.pulso,
        pulsoDesc: 0,
        mediaPrecio: totales.unitPricesUsed.media,
        mediaDesc: 0,
        djebaPrecio: totales.unitPricesUsed.djeba,
        djebaDesc: 0,
        litroPrecio: totales.unitPricesUsed.litro,
        litroDesc: 0,
        galonPrecio: totales.unitPricesUsed.galon,
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

  // Auto-actualizar totales al cambiar cantidades/envío/descuento/anticipo (manteniendo el botón)
  [
    'pulsoCant','mediaCant','djebaCant','litroCant','galonCant',
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
    navigator.serviceWorker.register('./sw.js?v=4.20.77&r=1').catch((err) => {
      console.warn('Pedidos: no se pudo registrar el Service Worker', err);
    });
  } catch (err) {
    console.warn('Pedidos: error al registrar Service Worker', err);
  }
}
