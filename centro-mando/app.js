/*
  Suite A33 · Centro de Mando · Etapa 5/5
  Regla principal: el evento visualizado es independiente del evento activo del POS.
  Centro de Mando solo escribe currentEventId mediante la confirmación explícita de “Usar en POS”.
*/

'use strict';

const POS_DB_NAME = 'a33-pos';
const FOCUS_EVENT_KEY = 'a33_cmd_focusEventId';
const FOCUS_MODE_KEY = 'a33_cmd_focusMode';
const MODE_EVENT = 'EVENTO';
const MODE_GLOBAL = 'GLOBAL';
const GLOBAL_VALUE = '__GLOBAL_ACTIVOS__';
const GLOBAL_LABEL = 'GLOBAL (Activos)';
const ORDERS_KEY = 'arcano33_pedidos';
const AGENDA_KEY = 'a33_agenda_records_v1';
const INVENTORY_KEY = 'arcano33_inventario';
const CURRENCY_KEY = 'suite_a33_currency_settings_v1';
const ENVASES_CATALOG_KEY = 'a33_catalog_envases_v1';
const TAPAS_CATALOG_KEY = 'a33_catalog_tapas_v1';
const MAX_SAFE_ROWS = 4000;
const LIQUID_NAMES = Object.freeze({ vino:'Vino', vodka:'Vodka', jugo:'Jugo', sirope:'Sirope', agua:'Agua pura', wine:'Vino' });
const LEGACY_ENVASE_NAMES = Object.freeze({ pulso:'Pulso 250 ml', media:'Media 375 ml', djeba:'Djeba 750 ml', litro:'Litro 1000 ml', galon:'Galón 3720 ml' });
const LEGACY_TAPA_NAMES = Object.freeze({ gallon:'Tapa Galón', pulsoLitro:'Tapa Pulso/Litro', djebaMedia:'Tapa Djeba/Media', vasos12oz:'Vasos 12oz' });
const LEGACY_FINISHED_NAMES = Object.freeze({ pulso:'Pulso 250 ml', media:'Media 375 ml', djeba:'Djeba 750 ml', litro:'Litro 1000 ml', galon:'Galón 3720 ml' });

const ROUTES = Object.freeze({
  pos: '../pos/index.html',
  cash: '../pos/index.html?tab=efectivo',
  summary: '../pos/index.html?tab=resumen',
  agenda: '../agenda/index.html',
  orders: '../pedidos/index.html',
  inventory: '../inventario/index.html',
  currency: '../configuracion/index.html'
});

const state = {
  db: null,
  events: [],
  eventsById: new Map(),
  products: [],
  productsById: new Map(),
  visualMode: MODE_EVENT,
  visualEventId: null,
  visualEvent: null,
  posActiveEventId: null,
  posActiveEvent: null,
  today: todayYmd(),
  orderSignals: null,
  agendaSignals: null,
  inventorySignals: null,
  fxSignal: null,
  summarySignals: null,
  summaryRenderToken: 0,
  globalEventSignals: new Map(),
  globalRenderToken: 0,
  pickerSelectionToken: 0,
  pendingUsePosId: null,
  refreshBusy: false,
  listenersBound: false
};

function $(id){ return document.getElementById(id); }
function text(value){ return value == null ? '' : String(value).trim(); }
function num(value){ const n = Number(value); return Number.isFinite(n) ? n : 0; }
function setText(id, value){ const el = $(id); if (el) el.textContent = value == null || value === '' ? '—' : String(value); }
function setHidden(id, hidden){ const el = $(id); if (el) el.hidden = !!hidden; }
function setDisabled(id, disabled){ const el = $(id); if (el) el.disabled = !!disabled; }

function todayYmd(){
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

function ymdToDisplay(value){
  const raw = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '—';
  const [y,m,d] = raw.split('-');
  return `${d}/${m}/${y}`;
}

function formatMoney(value){
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  try{
    return new Intl.NumberFormat('es-NI', { style:'currency', currency:'NIO', minimumFractionDigits:2, maximumFractionDigits:2 }).format(n);
  }catch(_){
    return `C$${n.toFixed(2)}`;
  }
}

function showToast(message, kind){
  const el = $('cmdToast');
  if (!el) return;
  el.textContent = text(message) || 'Listo';
  el.className = 'cmd-toast' + (kind === 'ok' ? ' is-ok' : kind === 'error' ? ' is-error' : '');
  el.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(()=>{ el.hidden = true; }, kind === 'error' ? 5000 : 3200);
}

function safeJsonParse(raw, fallback){
  try{
    const parsed = JSON.parse(String(raw || ''));
    return parsed == null ? fallback : parsed;
  }catch(_){
    return fallback;
  }
}

function readSharedValue(key){
  try{
    if (window.A33Storage && typeof window.A33Storage.sharedGet === 'function'){
      const shared = window.A33Storage.sharedGet(key, null, 'local');
      if (shared != null) return shared;
    }
  }catch(_){ }
  try{
    if (window.A33Storage && typeof window.A33Storage.getItem === 'function'){
      const wrapped = window.A33Storage.getItem(key);
      if (wrapped != null) return typeof wrapped === 'string' ? safeJsonParse(wrapped, wrapped) : wrapped;
    }
  }catch(_){ }
  try{
    const raw = localStorage.getItem(key);
    return raw == null ? null : safeJsonParse(raw, raw);
  }catch(_){
    return null;
  }
}

function boolValue(value, fallback){
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const raw = text(value).toLowerCase();
  if (['true','1','si','sí','yes','activo','activa'].includes(raw)) return true;
  if (['false','0','no','inactivo','inactiva'].includes(raw)) return false;
  return !!fallback;
}

function catalogMap(key){
  const source = readSharedValue(key);
  const rows = Array.isArray(source) ? source : [];
  const map = new Map();
  rows.forEach((row)=>{
    if (!row || typeof row !== 'object') return;
    const id = text(row.id ?? row.envaseId ?? row.tapaId);
    if (!id || map.has(id)) return;
    map.set(id, {
      id,
      name:text(row.name ?? row.nombre ?? row.label ?? row.descripcion) || id,
      active:boolValue(row.active ?? row.activo ?? row.isActive, true)
    });
  });
  return map;
}

function normalizedEventRefs(row){
  const source = row && typeof row === 'object' ? row : {};
  const ids = [];
  const pushId = (value)=>{
    const id = Number(value);
    if (Number.isFinite(id) && id > 0 && !ids.includes(id)) ids.push(id);
  };
  pushId(source.eventId ?? source.eventoId ?? source.idEvento ?? source.posEventId);
  const arrays = [source.eventIds, source.eventosIds, source.events];
  arrays.forEach((list)=>Array.isArray(list) && list.forEach((value)=>pushId(value && typeof value === 'object' ? (value.id ?? value.eventId) : value)));
  return {
    ids,
    name:text(source.eventName ?? source.eventoNombre ?? source.nombreEvento),
    group:text(source.groupName ?? source.grupo ?? source.nombreGrupo),
    linked:ids.length > 0 || !!text(source.eventName ?? source.eventoNombre ?? source.nombreEvento ?? source.groupName ?? source.grupo ?? source.nombreGrupo)
  };
}

function eventMatchesRefs(event, refs){
  if (!event || !refs || !refs.linked) return false;
  const eventId = Number(event.id);
  if (refs.ids.includes(eventId)) return true;
  const eventName = text(event.name).toLowerCase();
  const groupName = text(event.groupName).toLowerCase();
  if (refs.name && eventName && refs.name.toLowerCase() === eventName) return true;
  if (refs.group && groupName && refs.group.toLowerCase() === groupName) return true;
  return false;
}

function persistVisualState(){
  try{ localStorage.setItem(FOCUS_MODE_KEY, state.visualMode); }catch(_){ }
  if (state.visualMode === MODE_EVENT && state.visualEventId){
    try{ localStorage.setItem(FOCUS_EVENT_KEY, String(state.visualEventId)); }catch(_){ }
  }
}

function loadVisualMode(){
  try{
    return String(localStorage.getItem(FOCUS_MODE_KEY) || '').toUpperCase() === MODE_GLOBAL ? MODE_GLOBAL : MODE_EVENT;
  }catch(_){
    return MODE_EVENT;
  }
}

function loadSavedVisualEventId(){
  try{
    const id = Number(localStorage.getItem(FOCUS_EVENT_KEY));
    return Number.isFinite(id) && id > 0 ? id : null;
  }catch(_){
    return null;
  }
}

async function openPosDb(timeoutMs){
  return new Promise((resolve, reject)=>{
    let settled = false;
    const timeout = setTimeout(()=>{
      if (settled) return;
      settled = true;
      reject(new Error('Tiempo de espera agotado al abrir IndexedDB'));
    }, Number(timeoutMs) || 3500);

    let request;
    try{ request = indexedDB.open(POS_DB_NAME); }
    catch(error){ clearTimeout(timeout); reject(error); return; }

    request.onblocked = ()=>console.warn('Centro de Mando: IndexedDB del POS está bloqueada por otra pestaña.');
    request.onerror = ()=>{
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(request.error || new Error('No se pudo abrir IndexedDB'));
    };
    request.onsuccess = ()=>{
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const db = request.result;
      try{ db.onversionchange = ()=>db.close(); }catch(_){ }
      resolve(db);
    };
  });
}

function hasStore(db, storeName){
  try{ return !!(db && db.objectStoreNames && db.objectStoreNames.contains(storeName)); }
  catch(_){ return false; }
}

function store(db, storeName, mode){
  return db.transaction(storeName, mode || 'readonly').objectStore(storeName);
}

async function idbGet(db, storeName, key){
  if (!hasStore(db, storeName)) return null;
  return new Promise((resolve)=>{
    try{
      const request = store(db, storeName).get(key);
      request.onsuccess = ()=>resolve(request.result ?? null);
      request.onerror = ()=>resolve(null);
    }catch(_){ resolve(null); }
  });
}

async function idbGetAll(db, storeName){
  if (!hasStore(db, storeName)) return [];
  return new Promise((resolve)=>{
    try{
      const request = store(db, storeName).getAll();
      request.onsuccess = ()=>resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = ()=>resolve([]);
    }catch(_){ resolve([]); }
  });
}

async function idbGetAllByIndex(db, storeName, indexName, key){
  if (!hasStore(db, storeName)) return null;
  return new Promise((resolve)=>{
    try{
      const objectStore = store(db, storeName);
      if (!objectStore.indexNames.contains(indexName)) return resolve(null);
      const request = objectStore.index(indexName).getAll(IDBKeyRange.only(key));
      request.onsuccess = ()=>resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = ()=>resolve(null);
    }catch(_){ resolve(null); }
  });
}

async function idbPut(db, storeName, value){
  if (!hasStore(db, storeName)) return false;
  return new Promise((resolve)=>{
    try{
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.oncomplete = ()=>resolve(true);
      transaction.onerror = ()=>resolve(false);
      transaction.onabort = ()=>resolve(false);
      transaction.objectStore(storeName).put(value);
    }catch(_){ resolve(false); }
  });
}

async function getMetaValue(key){
  const row = await idbGet(state.db, 'meta', key);
  return row && Object.prototype.hasOwnProperty.call(row, 'value') ? row.value : null;
}

async function setMetaValue(key, value){
  return idbPut(state.db, 'meta', { id:key, value });
}

function eventSortValue(event){
  const updated = Number(event && event.updatedAt);
  if (Number.isFinite(updated) && updated > 0) return updated;
  const created = Date.parse(text(event && event.createdAt));
  if (Number.isFinite(created)) return created;
  return num(event && event.id);
}

function isEventActive(event){
  if (!event || event.id == null) return false;
  if (event.closedAt || event.closed_at || event.closed === true || event.isClosed === true) return false;
  return true;
}

async function reloadEvents(){
  const rows = await idbGetAll(state.db, 'events');
  state.events = rows.filter((event)=>event && Number(event.id) > 0).sort((a,b)=>eventSortValue(b) - eventSortValue(a));
  state.eventsById = new Map(state.events.map((event)=>[Number(event.id), event]));
}

async function reloadProducts(){
  const rows = state.db && hasStore(state.db, 'products') ? await idbGetAll(state.db, 'products') : [];
  state.products = (Array.isArray(rows) ? rows : []).filter((row)=>row && typeof row === 'object');
  state.productsById = new Map();
  state.products.forEach((row)=>{
    const productId = text(row.productId ?? row.productoId ?? row.catalogProductId ?? row.id);
    if (productId && !state.productsById.has(productId)) state.productsById.set(productId, row);
  });
}

async function reloadPosActiveEvent(){
  const id = Number(await getMetaValue('currentEventId'));
  state.posActiveEventId = Number.isFinite(id) && id > 0 ? id : null;
  state.posActiveEvent = state.posActiveEventId ? (state.eventsById.get(state.posActiveEventId) || null) : null;
  setText('posActiveEventName', state.posActiveEvent ? (text(state.posActiveEvent.name) || `Evento ${state.posActiveEventId}`) : 'Sin evento activo');
  renderGlobalEvents();
}

function visualName(){
  if (state.visualMode === MODE_GLOBAL) return GLOBAL_LABEL;
  return state.visualEvent ? (text(state.visualEvent.name) || `Evento ${state.visualEventId}`) : '—';
}

function renderVisualHeader(){
  const input = $('eventSearch');
  const list = $('eventList');
  if (input && (document.activeElement !== input || !list || list.hidden)) input.value = visualName();

  setText('operationalDate', ymdToDisplay(state.today));
  setText('visualModeState', state.visualMode === MODE_GLOBAL ? 'GLOBAL' : 'EVENTO');

  const usePosArea = $('usePosArea');
  const usePosButton = $('btnUseInPOS');
  if (state.visualMode === MODE_GLOBAL){
    setText('focusHint', 'Vista GLOBAL de eventos abiertos. Consultar no cambia el POS.');
    setDisabled('btnUseInPOS', true);
    if (usePosArea) usePosArea.hidden = true;
    setText('todaySummaryHint', 'Consolidado de eventos abiertos para la fecha actual.');
    setHidden('globalActivesBlock', false);
  }else if (state.visualEvent){
    const same = Number(state.visualEventId) === Number(state.posActiveEventId);
    const group = text(state.visualEvent.groupName);
    setText('focusHint', `${same ? 'También está activo en POS' : 'Solo visualizado'}${group ? ` · Grupo: ${group}` : ''}`);
    setDisabled('btnUseInPOS', same);
    if (usePosArea) usePosArea.hidden = same;
    if (usePosButton) usePosButton.textContent = same ? 'Activo en POS' : 'Usar en POS';
    setText('usePosHint', 'Solo esta acción puede cambiar el evento activo del POS.');
    setText('todaySummaryHint', `Información de ${visualName()} para ${ymdToDisplay(state.today)}.`);
    setHidden('globalActivesBlock', true);
  }else{
    setText('focusHint', 'Selecciona un evento para consultar su información.');
    setDisabled('btnUseInPOS', true);
    if (usePosArea) usePosArea.hidden = true;
    setText('todaySummaryHint', 'Sin evento visualizado.');
    setHidden('globalActivesBlock', true);
  }
}

function filterEvents(query){
  const q = text(query).toLowerCase();
  if (!q || q === GLOBAL_LABEL.toLowerCase()) return state.events.slice(0, 50);
  return state.events.filter((event)=>{
    return text(event.name).toLowerCase().includes(q) || text(event.groupName).toLowerCase().includes(q);
  }).slice(0, 50);
}

function renderEventList(query){
  const host = $('eventList');
  if (!host) return;
  host.innerHTML = '';

  const globalButton = document.createElement('button');
  globalButton.type = 'button';
  globalButton.className = 'cmd-picker-item' + (state.visualMode === MODE_GLOBAL ? ' is-selected' : '');
  globalButton.dataset.value = GLOBAL_VALUE;
  globalButton.innerHTML = `<strong>${GLOBAL_LABEL}</strong><small>Consulta conjunta de eventos activos</small>`;
  globalButton.addEventListener('click', ()=>selectGlobalView());
  host.appendChild(globalButton);

  const rows = filterEvents(query);
  if (!rows.length){
    const empty = document.createElement('div');
    empty.className = 'cmd-picker-item';
    empty.innerHTML = '<strong>Sin resultados</strong><small>Prueba con otro nombre o grupo.</small>';
    host.appendChild(empty);
    return;
  }

  rows.forEach((event)=>{
    const id = Number(event.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cmd-picker-item' + (state.visualMode === MODE_EVENT && Number(state.visualEventId) === id ? ' is-selected' : '');
    button.innerHTML = `<strong>${escapeHtml(text(event.name) || `Evento ${id}`)}</strong><small>${escapeHtml(text(event.groupName) ? `Grupo: ${text(event.groupName)}` : 'Sin grupo')}</small>`;
    button.addEventListener('click', ()=>selectVisualEvent(id));
    host.appendChild(button);
  });
}

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>'"]/g, (char)=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

function showEventList(){
  const list = $('eventList');
  const button = $('eventPickerBtn');
  if (list) list.hidden = false;
  if (button) button.setAttribute('aria-expanded', 'true');
}

function hideEventList(){
  const list = $('eventList');
  const button = $('eventPickerBtn');
  if (list) list.hidden = true;
  if (button) button.setAttribute('aria-expanded', 'false');
}

function closePickerAfterSelection(){
  const input = $('eventSearch');
  hideEventList();
  if (input){
    input.value = visualName();
    try{ input.blur(); }catch(_){ }
  }
  try{
    const active = document.activeElement;
    const picker = $('eventPicker');
    if (active && active !== document.body && picker && picker.contains(active) && typeof active.blur === 'function') active.blur();
  }catch(_){ }
  try{
    requestAnimationFrame(()=>{
      const currentInput = $('eventSearch');
      if (!currentInput) return;
      currentInput.value = visualName();
      try{ currentInput.blur(); }catch(_){ }
    });
  }catch(_){ }
}

async function selectVisualEvent(eventId){
  const id = Number(eventId);
  if (!Number.isFinite(id) || id <= 0 || !state.eventsById.has(id)) return;
  const selectionToken = ++state.pickerSelectionToken;
  const changed = state.visualMode !== MODE_EVENT || Number(state.visualEventId) !== id;
  state.visualMode = MODE_EVENT;
  state.visualEventId = id;
  state.visualEvent = state.eventsById.get(id) || null;
  if (changed) persistVisualState();
  closePickerAfterSelection();
  renderVisualHeader();
  renderEventList('');
  if (!changed || selectionToken !== state.pickerSelectionToken) return;
  await refreshEventSummary();
}

async function selectGlobalView(){
  const selectionToken = ++state.pickerSelectionToken;
  const changed = state.visualMode !== MODE_GLOBAL;
  state.visualMode = MODE_GLOBAL;
  state.visualEventId = null;
  state.visualEvent = null;
  if (changed) persistVisualState();
  closePickerAfterSelection();
  renderVisualHeader();
  renderEventList('');
  renderGlobalEvents();
  if (!changed || selectionToken !== state.pickerSelectionToken) return;
  await refreshEventSummary();
}

function resolveDefaultVisualEvent(){
  const saved = loadSavedVisualEventId();
  if (saved && state.eventsById.has(saved)) return saved;
  if (state.posActiveEventId && state.eventsById.has(state.posActiveEventId)) return state.posActiveEventId;
  return state.events.length ? Number(state.events[0].id) : null;
}

function openUsePosModal(){
  if (state.visualMode !== MODE_EVENT || !state.visualEventId || !state.visualEvent) return;
  if (Number(state.visualEventId) === Number(state.posActiveEventId)){
    showToast('Ese evento ya está activo en POS.', 'ok');
    return;
  }
  state.pendingUsePosId = Number(state.visualEventId);
  setText('usePosTargetName', visualName());
  setText('usePosCurrentName', `Actualmente: ${state.posActiveEvent ? (text(state.posActiveEvent.name) || `Evento ${state.posActiveEventId}`) : 'Sin evento activo'}`);
  setHidden('usePosModal', false);
  try{ $('btnConfirmUsePos').focus(); }catch(_){ }
}

function closeUsePosModal(){
  state.pendingUsePosId = null;
  setHidden('usePosModal', true);
}

async function activateVisualizedEventInPos(){
  const id = Number(state.pendingUsePosId);
  if (!Number.isFinite(id) || id <= 0 || !state.eventsById.has(id)){
    closeUsePosModal();
    showToast('No se pudo identificar el evento seleccionado.', 'error');
    return;
  }

  const button = $('btnConfirmUsePos');
  if (button) button.disabled = true;
  const written = await setMetaValue('currentEventId', id);
  const verified = written ? Number(await getMetaValue('currentEventId')) === id : false;
  if (button) button.disabled = false;

  if (!verified){
    showToast('No se pudo confirmar el cambio en POS.', 'error');
    return;
  }

  closeUsePosModal();
  await reloadPosActiveEvent();
  renderVisualHeader();
  showToast(`Evento activo en POS: ${visualName()}`, 'ok');
}

function isCourtesySale(row){
  if (!row || typeof row !== 'object') return false;
  if (row.isCourtesy === true || row.courtesy === true || row.cortesia === true) return true;
  const payment = text(row.paymentMethod ?? row.method ?? row.metodoPago ?? row.payment).toLowerCase();
  return payment.includes('cortes');
}

function normalizeEventIds(eventIds){
  const input = Array.isArray(eventIds) ? eventIds : [eventIds];
  return Array.from(new Set(input.map((value)=>Number(value)).filter((value)=>Number.isFinite(value) && value > 0)));
}

function visualScopeEvents(){
  if (state.visualMode === MODE_GLOBAL) return resolveActiveEvents();
  return state.visualEvent ? [state.visualEvent] : [];
}

async function readSalesToday(eventIds){
  const ids = normalizeEventIds(eventIds);
  if (!ids.length) return { ok:true, total:0, count:0 };
  if (!state.db || !hasStore(state.db, 'sales')) return { ok:false, total:null, count:null };
  let rows = await idbGetAllByIndex(state.db, 'sales', 'by_date', state.today);
  if (rows === null) rows = await idbGetAll(state.db, 'sales');
  if (!Array.isArray(rows) || rows.length > MAX_SAFE_ROWS) return { ok:false, total:null, count:null };
  const idSet = new Set(ids.map(String));
  const filtered = rows.filter((row)=>row && idSet.has(String(row.eventId)) && text(row.date).slice(0,10) === state.today && !isCourtesySale(row));
  const total = filtered.reduce((sum,row)=>sum + num(row.total ?? row.amount ?? row.monto), 0);
  return { ok:true, total, count:filtered.length };
}

function eventCashEnabled(event){
  const raw = event && (event.cashV2Active ?? event.cashActive ?? event.efectivoActivo ?? event.pettyEnabled);
  if (raw === false || raw === 0 || String(raw).toLowerCase() === 'false') return false;
  return true;
}

async function readCashStateForEvent(event){
  if (!event) return { ok:false, eventId:null, state:'—', isOpen:false };
  const eventId = Number(event.id);
  if (!eventCashEnabled(event)) return { ok:true, eventId, state:'OFF', isOpen:false };
  if (!state.db || !hasStore(state.db, 'cashV2')) return { ok:false, eventId, state:'—', isOpen:false };
  const key = `cash:v2:${eventId}:${state.today}`;
  const row = await idbGet(state.db, 'cashV2', key);
  if (!row) return { ok:true, eventId, state:'SIN ACTIVIDAD', isOpen:false };
  const status = text(row.status).toUpperCase();
  if (status === 'CLOSED') return { ok:true, eventId, state:'CERRADO', isOpen:false };
  return { ok:true, eventId, state:'ABIERTO', isOpen:true };
}

function cashSummaryHint(counts, totalEvents){
  if (totalEvents <= 1) return ymdToDisplay(state.today);
  const parts = [];
  if (counts.open) parts.push(`${counts.open} abierto${counts.open === 1 ? '' : 's'}`);
  if (counts.closed) parts.push(`${counts.closed} cerrado${counts.closed === 1 ? '' : 's'}`);
  if (counts.noActivity) parts.push(`${counts.noActivity} sin actividad`);
  if (counts.off) parts.push(`${counts.off} OFF`);
  return parts.join(' · ') || `${totalEvents} eventos`;
}

async function readCashToday(events){
  const rows = Array.isArray(events) ? events.filter(Boolean) : [];
  if (!rows.length){
    return { ok:true, state:'SIN ACTIVIDAD', hint:'No hay eventos abiertos en la vista GLOBAL.', openCount:0, counts:{ open:0, closed:0, noActivity:0, off:0 } };
  }
  const results = await Promise.all(rows.map(readCashStateForEvent));
  const counts = { open:0, closed:0, noActivity:0, off:0 };
  let unavailable = 0;
  results.forEach((result)=>{
    if (!result.ok){ unavailable += 1; return; }
    if (result.state === 'ABIERTO') counts.open += 1;
    else if (result.state === 'CERRADO') counts.closed += 1;
    else if (result.state === 'SIN ACTIVIDAD') counts.noActivity += 1;
    else if (result.state === 'OFF') counts.off += 1;
  });
  let cashState = '—';
  if (counts.open > 0) cashState = 'ABIERTO';
  else if (counts.closed > 0) cashState = 'CERRADO';
  else if (counts.noActivity > 0) cashState = 'SIN ACTIVIDAD';
  else if (counts.off === rows.length) cashState = 'OFF';
  const hint = unavailable > 0
    ? `${cashSummaryHint(counts, rows.length)}${counts.open + counts.closed + counts.noActivity + counts.off ? ' · ' : ''}${unavailable} no disponible${unavailable === 1 ? '' : 's'}`
    : cashSummaryHint(counts, rows.length);
  return { ok:unavailable < rows.length, state:cashState, hint, openCount:counts.open, counts };
}

function readCurrencySignal(){
  try{
    if (window.A33Currency && typeof window.A33Currency.getState === 'function'){
      const value = window.A33Currency.getState();
      const rate = Number(value && value.exchangeRate);
      return {
        available:true,
        hasRate:Number.isFinite(rate) && rate > 0,
        rate:Number.isFinite(rate) && rate > 0 ? rate : null,
        updatedAt:text(value && value.settings && value.settings.updatedAt)
      };
    }
  }catch(_){ }
  const source = readSharedValue(CURRENCY_KEY);
  const rate = Number(source && source.exchangeRate);
  return {
    available:source != null,
    hasRate:Number.isFinite(rate) && rate > 0,
    rate:Number.isFinite(rate) && rate > 0 ? rate : null,
    updatedAt:text(source && source.updatedAt)
  };
}

function formatDateTime(value){
  const raw = text(value);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  try{
    return new Intl.DateTimeFormat('es-NI', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).format(date);
  }catch(_){ return date.toLocaleString(); }
}

function renderCurrencySummary(signal){
  const fx = signal || readCurrencySignal();
  state.fxSignal = fx;
  setText('exchangeRateToday', fx.hasRate ? `T/C ${fx.rate.toFixed(2)}` : 'NO CONFIGURADO');
  const updated = formatDateTime(fx.updatedAt);
  setText('exchangeRateHint', fx.hasRate ? (updated ? `Actualizado: ${updated}` : 'Configuración → Moneda') : 'Configura el T/C en Moneda.');
}

function clearEventSummary(reason){
  state.summarySignals = null;
  setText('salesToday', '—');
  setText('salesTodayHint', reason || 'No disponible');
  setText('salesTodayCount', '—');
  setText('salesCountHint', reason || 'No disponible');
  setText('cashTodayState', '—');
  setText('cashTodayHint', reason || 'No disponible');
  renderCurrencySummary(readCurrencySignal());
  renderAttention();
}

async function refreshEventSummary(){
  const token = ++state.summaryRenderToken;
  const requestedMode = state.visualMode;
  const requestedEventId = state.visualEventId == null ? null : Number(state.visualEventId);
  const events = visualScopeEvents();
  if (state.visualMode === MODE_EVENT && !state.visualEvent){
    clearEventSummary('Selecciona un evento concreto.');
    return;
  }
  const ids = events.map((event)=>Number(event.id));
  const fx = readCurrencySignal();
  const [sales, cash] = await Promise.all([
    readSalesToday(ids),
    readCashToday(events)
  ]);
  const currentEventId = state.visualEventId == null ? null : Number(state.visualEventId);
  if (token !== state.summaryRenderToken || requestedMode !== state.visualMode || requestedEventId !== currentEventId) return;
  state.fxSignal = fx;
  state.summarySignals = { sales, cash, eventIds:ids, mode:state.visualMode };
  setText('salesToday', sales.ok ? formatMoney(sales.total) : '—');
  setText('salesTodayHint', sales.ok ? `Excluye cortesías · ${ymdToDisplay(state.today)}` : 'No disponible');
  setText('salesTodayCount', sales.ok ? sales.count : '—');
  setText('salesCountHint', sales.ok ? `${sales.count === 1 ? 'Venta registrada' : 'Ventas registradas'} · sin cortesías` : 'No disponible');
  setText('cashTodayState', cash.state);
  setText('cashTodayHint', cash.hint);
  renderCurrencySummary(fx);
  renderAttention();
  if (state.visualMode === MODE_GLOBAL) await refreshGlobalEventSignals();
  else{
    state.globalRenderToken += 1;
    state.globalEventSignals = new Map();
  }
}

function validYmd(value){
  return /^\d{4}-\d{2}-\d{2}$/.test(text(value).slice(0,10));
}

function normalizeOrderStatus(row){
  const status = text(row && (row.estado ?? row.status)).toLowerCase();
  if (row && (row.entregado === true || row.completed === true || row.done === true || row.cancelled === true || row.canceled === true)) return 'closed';
  if (['entregado','cerrado','completado','completed','done','hecho','cancelado','cancelled','canceled'].includes(status)) return 'closed';
  return 'pending';
}

function orderProductLines(row){
  const source = row && typeof row === 'object' ? row : {};
  const arrays = [source.productosPedido, source.items, source.pedidoItems, source.itemsPedido, source.productos];
  const raw = arrays.find(Array.isArray) || [];
  const lines = [];
  raw.forEach((item)=>{
    if (!item || typeof item !== 'object') return;
    const snapshot = item.productSnapshot && typeof item.productSnapshot === 'object' ? item.productSnapshot : {};
    const name = text(item.productNameSnapshot ?? item.productName ?? item.nombre ?? item.name ?? item.label ?? snapshot.nombre ?? snapshot.name);
    const quantity = num(item.cantidad ?? item.qty ?? item.quantity);
    if (name && quantity > 0) lines.push({ name, quantity });
  });
  if (!lines.length){
    [
      ['pulsoCant','Pulso'],
      ['mediaCant','Media'],
      ['djebaCant','Djeba'],
      ['litroCant','Litro'],
      ['galonCant','Galón 3720 ml']
    ].forEach(([key,label])=>{
      const quantity = num(source[key]);
      if (quantity > 0) lines.push({ name:label, quantity });
    });
  }
  return lines;
}

function orderProductSummary(row){
  const lines = orderProductLines(row);
  if (lines.length){
    const shown = lines.slice(0,3).map((item)=>`${item.quantity}× ${item.name}`);
    return shown.join(' · ') + (lines.length > 3 ? ` · +${lines.length - 3}` : '');
  }
  return text(row && (row.producto ?? row.product ?? row.resumen ?? row.descripcion)) || 'Sin detalle de producto';
}

function orderTemporalState(row){
  if (validYmd(row.delivery) && row.delivery < state.today) return { key:'overdue', label:'Vencido', kind:'danger' };
  if (row.delivery === state.today) return { key:'delivery-today', label:'Entregar hoy', kind:'warning' };
  if (row.production === state.today) return { key:'manufacture-today', label:'Fabricar hoy', kind:'warning' };
  if (validYmd(row.production) && row.production < state.today) return { key:'manufacture-pending', label:'Fabricación pendiente', kind:'neutral' };
  return { key:'scheduled', label:'Programado', kind:'neutral' };
}

function orderUrgencySort(a,b){
  const ranks = { overdue:0, 'delivery-today':1, 'manufacture-today':2, 'manufacture-pending':3, scheduled:4 };
  const ar = ranks[a.temporal.key] ?? 9;
  const br = ranks[b.temporal.key] ?? 9;
  if (ar !== br) return ar - br;
  const ad = a.delivery || a.production || '9999-99-99';
  const bd = b.delivery || b.production || '9999-99-99';
  if (ad !== bd) return ad.localeCompare(bd);
  return a.customer.localeCompare(b.customer, 'es');
}

function readOrdersSignals(){
  const source = readSharedValue(ORDERS_KEY);
  const rows = Array.isArray(source) ? source.slice(0, MAX_SAFE_ROWS) : [];
  const normalized = rows.filter((row)=>row && typeof row === 'object' && normalizeOrderStatus(row) === 'pending').map((row,index)=>{
    const normalizedRow = {
      id:text(row.id) || `pedido-${index}`,
      customer:text(row.customerName ?? row.clienteNombre ?? row.cliente ?? row.customer) || 'Sin cliente',
      delivery:text(row.fechaEntrega ?? row.deliveryDate ?? row.fechaEntregaPedido ?? row.fechaEnt).slice(0,10),
      production:text(row.fechaCreacion ?? row.fechaFabricacion ?? row.productionDate ?? row.fecha).slice(0,10),
      productSummary:orderProductSummary(row),
      eventRefs:normalizedEventRefs(row)
    };
    normalizedRow.temporal = orderTemporalState(normalizedRow);
    return normalizedRow;
  });
  const unique = [];
  const seen = new Set();
  normalized.slice().sort(orderUrgencySort).forEach((row)=>{
    if (seen.has(row.id)) return;
    seen.add(row.id);
    unique.push(row);
  });
  return {
    available:Array.isArray(source),
    pending:normalized.length,
    overdue:normalized.filter((row)=>validYmd(row.delivery) && row.delivery < state.today).length,
    today:normalized.filter((row)=>row.delivery === state.today).length,
    manufactureToday:normalized.filter((row)=>row.production === state.today).length,
    urgent:unique.slice(0,3),
    rows:unique.slice(0,3),
    allRows:unique
  };
}

function normalizeAgendaCollection(source){
  if (Array.isArray(source)) return source;
  if (source && typeof source === 'object'){
    for (const key of ['records','items','data']) if (Array.isArray(source[key])) return source[key];
  }
  return [];
}

function normalizeAgendaStatus(value, row){
  if (row && (row.completed === true || row.done === true || row.isDone === true || row.cancelled === true || row.canceled === true)) return 'closed';
  const status = text(value).toLowerCase();
  if (['hecho','cerrado','cancelado','done','completed','entregado','cancelled','canceled'].includes(status)) return 'closed';
  return 'pending';
}

function normalizeAgendaType(value){
  const type = text(value).toLowerCase();
  if (['reunion','reunión','meeting'].includes(type)) return 'meeting';
  if (['compra','purchase'].includes(type)) return 'purchase';
  return 'task';
}

function normalizeAgendaPriority(value){
  const priority = text(value).toLowerCase();
  return ['alta','media','baja'].includes(priority) ? priority : 'media';
}

function agendaPriorityLabel(value){
  return value === 'alta' ? 'Alta' : value === 'baja' ? 'Baja' : 'Media';
}

function agendaPriorityRank(value){
  return value === 'alta' ? 0 : value === 'media' ? 1 : 2;
}

function agendaDateFor(row, type){
  if (type === 'purchase'){
    return text(row.date ?? row.neededDate ?? row.fechaNecesaria ?? row.purchaseDate ?? row.fechaCompraProgramada ?? row.fechaCompra).slice(0,10);
  }
  return text(row.date ?? row.fecha ?? row.scheduledDate ?? row.fechaProgramada).slice(0,10);
}

function agendaPurchaseItems(row){
  const group = row && row.purchaseGroup && typeof row.purchaseGroup === 'object' ? row.purchaseGroup : {};
  const groupItems = Array.isArray(group.items) ? group.items : [];
  const legacy = row && row.purchase && typeof row.purchase === 'object' ? [row.purchase] : [];
  return (groupItems.length ? groupItems : legacy).map((item)=>text(item && (item.name ?? item.nombre ?? item.materialName))).filter(Boolean);
}

function agendaPurchaseTotal(row){
  const group = row && row.purchaseGroup && typeof row.purchaseGroup === 'object' ? row.purchaseGroup : {};
  const grouped = Number(group.totalGeneral);
  if (Number.isFinite(grouped)) return grouped;
  const purchase = row && row.purchase && typeof row.purchase === 'object' ? row.purchase : {};
  const legacy = Number(purchase.subtotal ?? purchase.total ?? row.presupuestoTotal ?? row.budget);
  return Number.isFinite(legacy) ? legacy : 0;
}

function agendaUrgencySort(a,b){
  const ad = validYmd(a.date) ? a.date : '9999-99-99';
  const bd = validYmd(b.date) ? b.date : '9999-99-99';
  if (ad !== bd) return ad.localeCompare(bd);
  const priority = agendaPriorityRank(a.priority) - agendaPriorityRank(b.priority);
  if (priority !== 0) return priority;
  const at = a.time || '99:99';
  const bt = b.time || '99:99';
  if (at !== bt) return at.localeCompare(bt);
  return a.title.localeCompare(b.title, 'es');
}

function buildAgendaCategory(rows, type){
  const categoryRows = rows.filter((row)=>row.type === type).sort(agendaUrgencySort);
  return {
    total:categoryRows.length,
    overdue:categoryRows.filter((row)=>validYmd(row.date) && row.date < state.today).length,
    today:categoryRows.filter((row)=>row.date === state.today).length,
    rows:categoryRows.slice(0,3)
  };
}

function readAgendaSignals(){
  const source = readSharedValue(AGENDA_KEY);
  const rows = normalizeAgendaCollection(source).slice(0, MAX_SAFE_ROWS);
  const pending = rows.filter((row)=>row && normalizeAgendaStatus(row.status ?? row.estado, row) === 'pending').map((row,index)=>{
    const type = normalizeAgendaType(row.type ?? row.tipo);
    const purchaseItems = type === 'purchase' ? agendaPurchaseItems(row) : [];
    return {
      id:text(row.id) || `agenda-${index}`,
      type,
      date:agendaDateFor(row,type),
      time:text(row.time ?? row.hora).slice(0,5),
      title:text(row.subject ?? row.title ?? row.titulo) || (type === 'purchase' ? 'Compra programada' : 'Sin título'),
      context:text(row.client ?? row.cliente ?? row.context ?? row.contexto ?? row.location ?? row.lugar),
      priority:normalizeAgendaPriority(row.priority ?? row.prioridad),
      purchaseItems,
      purchaseCount:type === 'purchase' ? (Math.max(purchaseItems.length, num(row.purchaseGroup && row.purchaseGroup.itemCount)) || 1) : 0,
      purchaseTotal:type === 'purchase' ? agendaPurchaseTotal(row) : 0,
      eventRefs:normalizedEventRefs(row)
    };
  });
  const meeting = buildAgendaCategory(pending,'meeting');
  const task = buildAgendaCategory(pending,'task');
  const purchase = buildAgendaCategory(pending,'purchase');
  return {
    available:source != null,
    meetings:meeting.total,
    tasks:task.total,
    purchases:purchase.total,
    overdue:meeting.overdue + task.overdue + purchase.overdue,
    today:meeting.today + task.today + purchase.today,
    categories:{ meeting, task, purchase },
    rows:pending.slice().sort(agendaUrgencySort).slice(0,3),
    allRows:pending.slice().sort(agendaUrgencySort)
  };
}

function inventoryRowName(section, id, row, catalogs){
  const explicit = text(row && (row.name ?? row.nombre ?? row.productName ?? row.nombreSnapshot ?? row.label));
  if (explicit) return explicit;
  if (section === 'liquid') return LIQUID_NAMES[id] || id;
  if (section === 'container') return (catalogs.envases.get(id) && catalogs.envases.get(id).name) || LEGACY_ENVASE_NAMES[id] || id;
  if (section === 'cap') return (catalogs.tapas.get(id) && catalogs.tapas.get(id).name) || LEGACY_TAPA_NAMES[id] || id;
  if (section === 'product'){
    const product = state.productsById.get(id);
    return text(product && (product.name ?? product.nombre)) || LEGACY_FINISHED_NAMES[id] || id;
  }
  return id;
}

function inventoryRowOperational(section, id, row, catalogs){
  if (!row || typeof row !== 'object') return false;
  if (row.operational === false || row.active === false || row.activo === false || row.historical === true) return false;
  if (section === 'container' && catalogs.envases.size){
    const catalog = catalogs.envases.get(id);
    return !!(catalog && catalog.active !== false);
  }
  if (section === 'cap' && catalogs.tapas.size){
    const catalog = catalogs.tapas.get(id);
    return !!(catalog && catalog.active !== false);
  }
  if (section === 'product' && state.productsById.size){
    const product = state.productsById.get(id);
    return !!(product && product.active !== false && product.deleted !== true);
  }
  return true;
}

function inventoryRows(source){
  const rows = [];
  if (!source || typeof source !== 'object') return rows;
  const catalogs = { envases:catalogMap(ENVASES_CATALOG_KEY), tapas:catalogMap(TAPAS_CATALOG_KEY) };
  const seen = new Set();
  const add = (section, id, row)=>{
    const key = `${section}:${id}`;
    if (!id || seen.has(key) || !inventoryRowOperational(section,id,row,catalogs)) return;
    seen.add(key);
    const stock = num(row.stock);
    const max = num(row.max);
    const configuredMin = num(row.min ?? row.minimo ?? row.minimum ?? row.minStock);
    rows.push({
      id:key,
      sourceId:id,
      type:section,
      typeLabel:section === 'liquid' ? 'Líquido' : section === 'product' ? 'Producto terminado' : section === 'container' ? 'Envase' : 'Tapa',
      name:inventoryRowName(section,id,row,catalogs),
      stock,
      max,
      configuredMin,
      eventRefs:normalizedEventRefs(row)
    });
  };

  Object.entries(source.liquids && typeof source.liquids === 'object' ? source.liquids : {}).forEach(([id,row])=>add('liquid',id,row));
  Object.entries(source.finishedByProductId && typeof source.finishedByProductId === 'object' ? source.finishedByProductId : {}).forEach(([id,row])=>add('product',text(row && row.productId) || id,row));
  Object.entries(source.finished && typeof source.finished === 'object' ? source.finished : {}).forEach(([id,row])=>{
    const productId = text(row && (row.productId ?? row.productoId)) || id;
    if (!seen.has(`product:${productId}`)) add('product',productId,row);
  });
  Object.entries(source.bottles && typeof source.bottles === 'object' ? source.bottles : {}).forEach(([id,row])=>add('container',id,row));
  Object.entries(source.caps && typeof source.caps === 'object' ? source.caps : {}).forEach(([id,row])=>add('cap',id,row));
  return rows;
}

function inventoryRiskFor(row){
  if (!row) return null;
  if (row.type === 'liquid'){
    if (!(row.max > 0)) return null;
    const ratio = row.stock / row.max;
    const percent = Math.max(0, ratio * 100);
    if (row.stock <= 0 || ratio <= .20){
      return { ...row, level:'critical', kind:'danger', status:'CRÍTICO', reference:row.max * .20, referenceLabel:`20% de ${row.max.toFixed(0)} ml`, stockLabel:`${row.stock.toFixed(0)} ml (${percent.toFixed(1)}%)`, rank:ratio };
    }
    if (ratio <= .35){
      return { ...row, level:'near', kind:'warning', status:'CERCA DEL MÍNIMO', reference:row.max * .35, referenceLabel:`35% de ${row.max.toFixed(0)} ml`, stockLabel:`${row.stock.toFixed(0)} ml (${percent.toFixed(1)}%)`, rank:ratio };
    }
    return null;
  }

  const minimum = row.configuredMin > 0 ? row.configuredMin : 10;
  const nearLimit = Math.max(minimum * 2, minimum + 1);
  const unit = row.type === 'product' || row.type === 'container' || row.type === 'cap' ? 'unid.' : '';
  if (row.stock <= minimum){
    return { ...row, level:'critical', kind:'danger', status:'CRÍTICO', reference:minimum, referenceLabel:`Mínimo: ${minimum.toFixed(0)} ${unit}`, stockLabel:`${row.stock.toFixed(0)} ${unit}`, rank:row.stock / Math.max(1,minimum) };
  }
  if (row.stock <= nearLimit){
    return { ...row, level:'near', kind:'warning', status:'CERCA DEL MÍNIMO', reference:minimum, referenceLabel:`Mínimo: ${minimum.toFixed(0)} ${unit}`, stockLabel:`${row.stock.toFixed(0)} ${unit}`, rank:row.stock / Math.max(1,nearLimit) };
  }
  return null;
}

function inventoryRiskSort(a,b){
  const levelRank = { critical:0, near:1 };
  const ar = levelRank[a.level] ?? 9;
  const br = levelRank[b.level] ?? 9;
  if (ar !== br) return ar - br;
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.name.localeCompare(b.name, 'es');
}

function readInventorySignals(){
  const source = readSharedValue(INVENTORY_KEY);
  const rows = inventoryRows(source);
  const allRisks = rows.map(inventoryRiskFor).filter(Boolean).sort(inventoryRiskSort);
  const criticalRows = allRisks.filter((row)=>row.level === 'critical');
  const nearRows = allRisks.filter((row)=>row.level === 'near');
  return {
    available:source != null,
    low:criticalRows.length,
    critical:criticalRows.length,
    near:nearRows.length,
    tracked:rows.length,
    risks:allRisks.slice(0,3),
    allRisks,
    rows,
    reviewedAt:new Date().toISOString()
  };
}

function createListItem(title, subtitle, actionLabel, action){
  const row = document.createElement('div');
  row.className = 'cmd-list-item';
  const main = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const small = document.createElement('small');
  small.textContent = subtitle;
  main.append(strong, small);
  row.appendChild(main);
  if (actionLabel && typeof action === 'function'){
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cmd-pill-btn';
    button.textContent = actionLabel;
    button.addEventListener('click', action);
    row.appendChild(button);
  }
  return row;
}

function createOperationalItem(title, details, status, action){
  const row = document.createElement('div');
  row.className = 'cmd-operational-item';
  const main = document.createElement('div');
  main.className = 'cmd-operational-item-main';
  const strong = document.createElement('strong');
  strong.textContent = title;
  main.appendChild(strong);
  (Array.isArray(details) ? details : []).filter(Boolean).forEach((detail)=>{
    const small = document.createElement('small');
    small.textContent = detail;
    main.appendChild(small);
  });
  row.appendChild(main);
  if (status && status.label){
    const badge = document.createElement('span');
    badge.className = `cmd-temporal-state is-${status.kind || 'neutral'}`;
    badge.textContent = status.label;
    row.appendChild(badge);
  }
  if (typeof action === 'function'){
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cmd-icon-action';
    button.textContent = 'Ver';
    button.setAttribute('aria-label', `Ver ${title}`);
    button.addEventListener('click', action);
    row.appendChild(button);
  }
  return row;
}

function emptyOperationalLine(message){
  const row = document.createElement('div');
  row.className = 'cmd-empty-line cmd-compact-empty';
  row.textContent = message;
  return row;
}

function renderOrders(){
  const data = state.orderSignals;
  const host = $('ordersUrgentList');
  if (!host) return;
  host.innerHTML = '';
  if (!data || !data.available){
    setText('ordersSummary', 'Pedidos no disponibles.');
    setText('ordersOverdue', '—');
    setText('ordersManufactureToday', '—');
    setText('ordersDeliveryToday', '—');
    host.appendChild(emptyOperationalLine('Abre Pedidos para inicializar su información.'));
    return;
  }
  setText('ordersSummary', `${data.pending} pedido${data.pending === 1 ? '' : 's'} pendiente${data.pending === 1 ? '' : 's'}.`);
  setText('ordersOverdue', data.overdue);
  setText('ordersManufactureToday', data.manufactureToday);
  setText('ordersDeliveryToday', data.today);
  if (!data.urgent.length){
    host.appendChild(emptyOperationalLine('No hay pedidos pendientes.'));
    return;
  }
  data.urgent.forEach((row)=>{
    const dates = [
      row.production ? `Fabricación: ${ymdToDisplay(row.production)}` : 'Fabricación: sin fecha',
      row.delivery ? `Entrega: ${ymdToDisplay(row.delivery)}` : 'Entrega: sin fecha'
    ];
    host.appendChild(createOperationalItem(`${row.customer} · ${row.productSummary}`, dates, row.temporal, ()=>navigate(ROUTES.orders)));
  });
}

function agendaRecordRoute(row){
  return row && row.id ? `${ROUTES.agenda}?record=${encodeURIComponent(row.id)}` : ROUTES.agenda;
}

function renderAgendaCategory(type, data){
  const config = {
    meeting:{ overdue:'agendaMeetingsOverdue', today:'agendaMeetingsToday', list:'agendaMeetingsList', empty:'No hay reuniones pendientes.' },
    task:{ overdue:'agendaTasksOverdue', today:'agendaTasksToday', list:'agendaTasksList', empty:'No hay tareas pendientes.' },
    purchase:{ overdue:'agendaPurchasesOverdue', today:'agendaPurchasesToday', list:'agendaPurchasesList', empty:'No hay compras pendientes.' }
  }[type];
  if (!config) return;
  setText(config.overdue, data ? data.overdue : '—');
  setText(config.today, data ? data.today : '—');
  const host = $(config.list);
  if (!host) return;
  host.innerHTML = '';
  if (!data){
    host.appendChild(emptyOperationalLine('Agenda no disponible.'));
    return;
  }
  if (!data.rows.length){
    host.appendChild(emptyOperationalLine(config.empty));
    return;
  }
  data.rows.forEach((row)=>{
    const priority = `Prioridad: ${agendaPriorityLabel(row.priority)}`;
    if (type === 'purchase'){
      const names = row.purchaseItems.slice(0,3).join(', ') || row.title;
      const extra = row.purchaseItems.length > 3 ? ` +${row.purchaseItems.length - 3}` : '';
      const detail = `${row.purchaseCount} artículo${row.purchaseCount === 1 ? '' : 's'} · ${names}${extra}`;
      const date = row.date ? `Fecha necesaria: ${ymdToDisplay(row.date)}` : 'Fecha necesaria: sin definir';
      host.appendChild(createOperationalItem(detail, [date, `Presupuesto: ${formatMoney(row.purchaseTotal)} · ${priority}`], null, ()=>navigate(agendaRecordRoute(row))));
      return;
    }
    const dateParts = [row.date ? ymdToDisplay(row.date) : 'Sin fecha', row.time || ''].filter(Boolean).join(' · ');
    const context = row.context ? `Contexto: ${row.context}` : '';
    host.appendChild(createOperationalItem(row.title, [dateParts, context, priority], null, ()=>navigate(agendaRecordRoute(row))));
  });
}

function renderAgenda(){
  const data = state.agendaSignals;
  if (!data || !data.available){
    renderAgendaCategory('meeting', null);
    renderAgendaCategory('task', null);
    renderAgendaCategory('purchase', null);
    return;
  }
  renderAgendaCategory('meeting', data.categories.meeting);
  renderAgendaCategory('task', data.categories.task);
  renderAgendaCategory('purchase', data.categories.purchase);
}

function createInventoryRiskItem(risk){
  const row = document.createElement('article');
  row.className = `cmd-inventory-risk is-${risk.kind}`;
  const main = document.createElement('div');
  main.className = 'cmd-inventory-risk-main';
  const strong = document.createElement('strong');
  strong.textContent = risk.name;
  const small = document.createElement('small');
  small.textContent = `${risk.typeLabel} · Existencia: ${risk.stockLabel} · ${risk.referenceLabel}`;
  main.append(strong, small);
  const chip = document.createElement('span');
  chip.className = 'cmd-risk-chip';
  chip.textContent = risk.status;
  row.append(main, chip);
  return row;
}

function renderInventory(){
  const data = state.inventorySignals;
  const host = $('inventoryRiskList');
  const clear = $('inventoryAllClear');
  if (host) host.innerHTML = '';
  if (!data || !data.available){
    setText('inventorySummary', 'Inventario no disponible.');
    setText('inventoryLow', '—');
    setText('inventoryNear', '—');
    if (clear) clear.hidden = true;
    setText('inventoryReviewed', 'Revisado: —');
    if (host) host.appendChild(emptyOperationalLine('Abre Inventario para inicializar su información.'));
    return;
  }
  setText('inventorySummary', 'Riesgos operativos de líquidos, productos terminados, envases y tapas.');
  setText('inventoryLow', data.critical);
  setText('inventoryNear', data.near);
  const reviewed = formatDateTime(data.reviewedAt);
  setText('inventoryReviewed', reviewed ? `Revisado: ${reviewed}` : 'Revisado: —');
  const hasRisk = data.critical + data.near > 0;
  if (clear) clear.hidden = hasRisk;
  if (!host) return;
  if (!hasRisk) return;
  data.risks.forEach((risk)=>host.appendChild(createInventoryRiskItem(risk)));
}

function createAttentionItem(signal){
  const row = document.createElement('div');
  row.className = `cmd-attention-item is-${signal.kind}`;
  const main = document.createElement('div');
  main.className = 'cmd-attention-main';
  const meta = document.createElement('div');
  meta.className = 'cmd-attention-meta';
  const level = document.createElement('span');
  level.className = 'cmd-attention-level';
  level.textContent = signal.kind === 'danger' ? 'ALTA' : 'MEDIA';
  meta.appendChild(level);
  const title = document.createElement('strong');
  title.textContent = signal.title;
  const description = document.createElement('small');
  description.textContent = signal.subtitle;
  main.append(meta, title, description);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cmd-pill-btn';
  button.textContent = signal.actionLabel || 'Abrir';
  button.addEventListener('click', ()=>navigate(signal.route));
  row.append(main, button);
  return row;
}

function renderAttention(){
  const host = $('attentionList');
  const empty = $('attentionEmpty');
  if (!host || !empty) return;
  host.innerHTML = '';
  const signals = [];
  const used = new Set();
  const add = (signal)=>{
    if (!signal || !signal.key || used.has(signal.key)) return;
    used.add(signal.key);
    signals.push(signal);
  };
  const orders = state.orderSignals;
  const agenda = state.agendaSignals;
  const inventory = state.inventorySignals;
  const fx = state.fxSignal || readCurrencySignal();
  const cash = state.summarySignals && state.summarySignals.cash;

  if (!fx.hasRate) add({ key:'missing-fx', kind:'danger', title:'Falta tipo de cambio', subtitle:'Configura el T/C vigente antes de operar conversiones.', route:ROUTES.currency, actionLabel:'Configurar' });
  if (cash && cash.openCount > 0) add({ key:'cash-open', kind:'danger', title:cash.openCount === 1 ? 'Efectivo abierto pendiente de cierre' : `Efectivo abierto en ${cash.openCount} eventos`, subtitle:'Revisa y cierra el efectivo operativo cuando corresponda.', route:ROUTES.cash, actionLabel:'Ir a Efectivo' });
  if (orders && orders.overdue > 0) add({ key:'orders-overdue', kind:'danger', title:`Pedidos vencidos: ${orders.overdue}`, subtitle:'Hay entregas pendientes con fecha anterior a hoy.', route:ROUTES.orders, actionLabel:'Ver Pedidos' });
  if (orders && orders.today > 0) add({ key:'orders-delivery-today', kind:'warning', title:`Pedidos para entregar hoy: ${orders.today}`, subtitle:'Revisa las entregas programadas para la fecha actual.', route:ROUTES.orders, actionLabel:'Ver Pedidos' });
  if (orders && orders.manufactureToday > 0) add({ key:'orders-manufacture-today', kind:'warning', title:`Pedidos para fabricar hoy: ${orders.manufactureToday}`, subtitle:'Hay pedidos pendientes cuya fabricación corresponde a hoy.', route:ROUTES.orders, actionLabel:'Ver Pedidos' });
  if (agenda && agenda.overdue > 0) add({ key:'agenda-overdue', kind:'danger', title:`Agenda vencida: ${agenda.overdue}`, subtitle:'Hay reuniones, tareas o compras pendientes con fecha anterior a hoy.', route:ROUTES.agenda, actionLabel:'Abrir Agenda' });
  if (agenda && agenda.today > 0) add({ key:'agenda-today', kind:'warning', title:`Agenda para hoy: ${agenda.today}`, subtitle:'Hay asuntos pendientes programados para la fecha actual.', route:ROUTES.agenda, actionLabel:'Abrir Agenda' });
  if (inventory && inventory.low > 0) add({ key:'inventory-critical', kind:'danger', title:`Inventario crítico: ${inventory.low}`, subtitle:'Hay existencias dentro del nivel crítico calculado.', route:ROUTES.inventory, actionLabel:'Abrir Inventario' });

  setText('attentionCount', signals.length);
  empty.hidden = signals.length > 0;
  signals.forEach((signal)=>host.appendChild(createAttentionItem(signal)));
}

function resolveActiveEvents(){
  const rows = [];
  const seen = new Set();
  state.events.forEach((event)=>{
    if (!isEventActive(event)) return;
    const id = Number(event.id);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) return;
    seen.add(id);
    rows.push(event);
  });
  return rows.slice(0,50);
}

function eventLinkedRows(rows, event){
  return (Array.isArray(rows) ? rows : []).filter((row)=>eventMatchesRefs(event, row && row.eventRefs));
}

function buildEventAlerts(event, cash){
  const alerts = [];
  const used = new Set();
  const add = (alert)=>{
    if (!alert || !alert.key || used.has(alert.key)) return;
    used.add(alert.key);
    alerts.push(alert);
  };
  const fx = state.fxSignal || readCurrencySignal();
  if (!fx.hasRate) add({ key:'missing-fx', kind:'danger', title:'Falta T/C', detail:'Configura el tipo de cambio vigente.', route:ROUTES.currency, actionLabel:'Configurar' });
  if (cash && cash.isOpen) add({ key:'cash-open', kind:'danger', title:'Efectivo abierto', detail:'El efectivo de hoy está pendiente de cierre.', route:ROUTES.cash, actionLabel:'Efectivo' });

  const orders = eventLinkedRows(state.orderSignals && state.orderSignals.allRows, event);
  const ordersOverdue = orders.filter((row)=>validYmd(row.delivery) && row.delivery < state.today).length;
  const ordersDelivery = orders.filter((row)=>row.delivery === state.today).length;
  const ordersManufacture = orders.filter((row)=>row.production === state.today).length;
  if (ordersOverdue > 0) add({ key:'orders-overdue', kind:'danger', title:`Pedidos vencidos: ${ordersOverdue}`, detail:'Entregas del evento con fecha anterior a hoy.', route:ROUTES.orders, actionLabel:'Pedidos' });
  if (ordersDelivery > 0) add({ key:'orders-delivery-today', kind:'warning', title:`Entregas de hoy: ${ordersDelivery}`, detail:'Pedidos del evento programados para entregar hoy.', route:ROUTES.orders, actionLabel:'Pedidos' });
  if (ordersManufacture > 0) add({ key:'orders-manufacture-today', kind:'warning', title:`Fabricación de hoy: ${ordersManufacture}`, detail:'Pedidos del evento que deben fabricarse hoy.', route:ROUTES.orders, actionLabel:'Pedidos' });

  const agenda = eventLinkedRows(state.agendaSignals && state.agendaSignals.allRows, event);
  const agendaOverdue = agenda.filter((row)=>validYmd(row.date) && row.date < state.today).length;
  const agendaToday = agenda.filter((row)=>row.date === state.today).length;
  if (agendaOverdue > 0) add({ key:'agenda-overdue', kind:'danger', title:`Agenda vencida: ${agendaOverdue}`, detail:'Asuntos del evento pendientes con fecha anterior a hoy.', route:ROUTES.agenda, actionLabel:'Agenda' });
  if (agendaToday > 0) add({ key:'agenda-today', kind:'warning', title:`Agenda para hoy: ${agendaToday}`, detail:'Asuntos del evento programados para hoy.', route:ROUTES.agenda, actionLabel:'Agenda' });

  const inventory = eventLinkedRows(state.inventorySignals && state.inventorySignals.allRisks, event);
  const criticalInventory = inventory.filter((row)=>row.level === 'critical').length;
  if (criticalInventory > 0) add({ key:'inventory-critical', kind:'danger', title:`Inventario crítico: ${criticalInventory}`, detail:'Existencias críticas relacionadas con este evento.', route:ROUTES.inventory, actionLabel:'Inventario' });
  return alerts;
}

async function refreshGlobalEventSignals(){
  const token = ++state.globalRenderToken;
  if (state.visualMode !== MODE_GLOBAL){
    state.globalEventSignals = new Map();
    return;
  }
  const rows = resolveActiveEvents();
  const results = await Promise.all(rows.map(async(event)=>{
    const id = Number(event.id);
    const [sales,cash] = await Promise.all([readSalesToday([id]), readCashStateForEvent(event)]);
    return { eventId:id, sales, cash, alerts:buildEventAlerts(event,cash) };
  }));
  if (token !== state.globalRenderToken || state.visualMode !== MODE_GLOBAL) return;
  state.globalEventSignals = new Map(results.map((signal)=>[signal.eventId,signal]));
  renderGlobalEvents();
}

function createEventMetric(label, value, danger){
  const metric = document.createElement('div');
  metric.className = 'cmd-event-metric' + (danger ? ' is-danger' : '');
  const span = document.createElement('span');
  span.textContent = label;
  const strong = document.createElement('strong');
  strong.textContent = value;
  metric.append(span,strong);
  return metric;
}

function createEventAlertItem(alert){
  const row = document.createElement('div');
  row.className = `cmd-event-alert is-${alert.kind}`;
  const main = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = alert.title;
  const small = document.createElement('small');
  small.textContent = alert.detail;
  main.append(strong,small);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cmd-icon-action';
  button.textContent = alert.actionLabel || 'Abrir';
  button.addEventListener('click',()=>navigate(alert.route));
  row.append(main,button);
  return row;
}

function toggleEventDetail(detail,button){
  if (!detail || !button) return;
  const willOpen = detail.hidden;
  detail.hidden = !willOpen;
  button.textContent = willOpen ? 'Ocultar alertas' : 'Ver alertas';
  button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}

function renderGlobalEvents(){
  const host = $('globalActivesList');
  if (!host) return;
  host.innerHTML = '';
  if (state.visualMode !== MODE_GLOBAL) return;
  const rows = resolveActiveEvents();
  if (!rows.length){
    host.appendChild(createListItem('Sin eventos activos detectados', 'La vista global no encontró eventos abiertos.'));
    return;
  }
  rows.forEach((event)=>{
    const id = Number(event.id);
    const signal = state.globalEventSignals.get(id) || null;
    const alerts = signal ? signal.alerts : [];
    const row = document.createElement('article');
    row.className = 'cmd-global-card' + (id === Number(state.posActiveEventId) ? ' is-pos-active' : '');

    const head = document.createElement('div');
    head.className = 'cmd-global-card-head';
    const titleRow = document.createElement('div');
    titleRow.className = 'cmd-global-card-title';
    const main = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = text(event.name) || `Evento ${id}`;
    const small = document.createElement('small');
    small.textContent = text(event.groupName) ? `Grupo: ${text(event.groupName)}` : 'Sin grupo';
    main.append(strong,small);
    titleRow.appendChild(main);
    if (id === Number(state.posActiveEventId)){
      const badge = document.createElement('span');
      badge.className = 'cmd-pos-badge';
      badge.textContent = 'Activo en POS';
      titleRow.appendChild(badge);
    }

    const metrics = document.createElement('div');
    metrics.className = 'cmd-event-metrics';
    const salesValue = signal && signal.sales && signal.sales.ok ? formatMoney(signal.sales.total) : '—';
    const salesLabel = signal && signal.sales && signal.sales.ok ? `Ventas de hoy · ${signal.sales.count}` : 'Ventas de hoy';
    const cashValue = signal && signal.cash && signal.cash.ok ? signal.cash.state : '—';
    metrics.append(
      createEventMetric(salesLabel,salesValue,false),
      createEventMetric('Estado de Efectivo',cashValue,cashValue === 'ABIERTO'),
      createEventMetric('Alertas urgentes',signal ? alerts.length : '—',signal ? alerts.length > 0 : false)
    );
    head.append(titleRow,metrics);

    const actions = document.createElement('div');
    actions.className = 'cmd-event-card-actions';
    const visualize = document.createElement('button');
    visualize.type = 'button';
    visualize.className = 'cmd-pill-btn';
    visualize.textContent = 'Visualizar evento';
    visualize.addEventListener('click',()=>selectVisualEvent(id));
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'cmd-pill-btn';
    expand.textContent = 'Ver alertas';
    expand.setAttribute('aria-expanded','false');
    actions.append(visualize,expand);

    const detail = document.createElement('div');
    detail.className = 'cmd-event-detail';
    detail.hidden = true;
    const list = document.createElement('div');
    list.className = 'cmd-event-alert-list';
    if (!signal){
      list.appendChild(emptyOperationalLine('Calculando información del evento…'));
    }else if (!alerts.length){
      list.appendChild(emptyOperationalLine('Sin alertas urgentes para este evento.'));
    }else{
      alerts.forEach((alert)=>list.appendChild(createEventAlertItem(alert)));
    }
    detail.appendChild(list);
    expand.addEventListener('click',()=>toggleEventDetail(detail,expand));
    row.append(head,actions,detail);
    host.appendChild(row);
  });
}

function refreshOperationalSignals(){
  state.orderSignals = readOrdersSignals();
  state.agendaSignals = readAgendaSignals();
  state.inventorySignals = readInventorySignals();
  state.fxSignal = readCurrencySignal();
  renderOrders();
  renderAgenda();
  renderInventory();
  renderAttention();
}

function navigate(route){
  try{ window.location.href = route; }catch(_){ }
}

async function refreshFromSources(){
  if (state.refreshBusy) return;
  state.refreshBusy = true;
  try{
    const nextToday = todayYmd();
    if (nextToday !== state.today){
      state.today = nextToday;
      setText('cmdToday', ymdToDisplay(state.today));
      setText('operationalDate', ymdToDisplay(state.today));
    }
    if (state.db){
      await reloadEvents();
      await reloadProducts();
      await reloadPosActiveEvent();
      if (state.visualMode === MODE_EVENT && state.visualEventId){
        state.visualEvent = state.eventsById.get(Number(state.visualEventId)) || null;
        if (!state.visualEvent){
          const fallback = resolveDefaultVisualEvent();
          if (fallback){
            state.visualEventId = fallback;
            state.visualEvent = state.eventsById.get(fallback) || null;
          }
        }
      }
      renderVisualHeader();
      renderEventList('');
      await refreshEventSummary();
    }
    refreshOperationalSignals();
  }catch(error){
    console.warn('Centro de Mando: actualización parcial no disponible.', error);
  }finally{
    state.refreshBusy = false;
  }
}

function bindUi(){
  const input = $('eventSearch');
  const pickerButton = $('eventPickerBtn');
  const list = $('eventList');

  if (input){
    input.addEventListener('focus', ()=>{ renderEventList(''); showEventList(); try{ input.select(); }catch(_){ } });
    input.addEventListener('input', ()=>{ renderEventList(input.value); showEventList(); });
    input.addEventListener('keydown', (event)=>{ if (event.key === 'Escape') hideEventList(); });
  }
  if (pickerButton){
    pickerButton.addEventListener('click', ()=>{
      if (list && list.hidden){ renderEventList(''); showEventList(); try{ input.focus(); input.select(); }catch(_){ } }
      else hideEventList();
    });
  }
  document.addEventListener('click', (event)=>{
    const picker = $('eventPicker');
    if (picker && !picker.contains(event.target)) hideEventList();
  });

  $('btnUseInPOS')?.addEventListener('click', openUsePosModal);
  $('btnConfirmUsePos')?.addEventListener('click', activateVisualizedEventInPos);
  $('btnCancelUsePos')?.addEventListener('click', closeUsePosModal);
  $('usePosModal')?.addEventListener('click', (event)=>{
    const target = event.target;
    if (target && target.closest && target.closest('[data-close-use-pos="1"]')) closeUsePosModal();
  });
  document.addEventListener('keydown', (event)=>{
    if (event.key === 'Escape' && $('usePosModal') && !$('usePosModal').hidden) closeUsePosModal();
  });

  $('btnOpenAgenda')?.addEventListener('click', ()=>navigate(ROUTES.agenda));
  $('btnOpenAgendaMeetings')?.addEventListener('click', ()=>navigate(ROUTES.agenda));
  $('btnOpenAgendaTasks')?.addEventListener('click', ()=>navigate(ROUTES.agenda));
  $('btnOpenAgendaPurchases')?.addEventListener('click', ()=>navigate(ROUTES.agenda));
  $('btnGoOrders')?.addEventListener('click', ()=>navigate(ROUTES.orders));
  $('btnGoInventory')?.addEventListener('click', ()=>navigate(ROUTES.inventory));

  if (!state.listenersBound){
    state.listenersBound = true;
    window.addEventListener('focus', refreshAppearance);
    window.addEventListener('pageshow', refreshAppearance);
    window.addEventListener('storage', refreshAppearance);
    window.addEventListener('a33:appearance-changed', refreshAppearance);
    window.addEventListener('focus', refreshFromSources);
    window.addEventListener('pageshow', refreshFromSources);
    window.addEventListener('storage', refreshFromSources);
    document.addEventListener('visibilitychange', ()=>{ if (document.visibilityState === 'visible') refreshFromSources(); });
    ['a33:data-updated','a33:storage-changed','a33:json-imported','a33:sync-complete','a33:cloud-sync-complete'].forEach((eventName)=>window.addEventListener(eventName, refreshFromSources));
  }
}



function refreshAppearance(){
  try{
    const theme = window.A33Theme;
    if (!theme || typeof theme.apply !== 'function') return;
    const preference = typeof theme.read === 'function' ? theme.read() : undefined;
    theme.apply(preference);
  }catch(_){ }
}

function registerCentroMandoServiceWorker(){
  try{
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    const swUrl = './sw.js?v=4.20.95&r=3';
    navigator.serviceWorker.register(swUrl, { scope:'./', updateViaCache:'none' })
      .then((registration)=>{
        try{ registration.update(); }catch(_){ }
      })
      .catch((error)=>{
        console.warn('Centro de Mando: no se pudo registrar el Service Worker.', error);
      });
  }catch(error){
    console.warn('Centro de Mando: error al registrar el Service Worker.', error);
  }
}

async function init(){
  refreshAppearance();
  registerCentroMandoServiceWorker();
  bindUi();
  setText('cmdToday', ymdToDisplay(state.today));
  setText('operationalDate', ymdToDisplay(state.today));
  refreshOperationalSignals();

  try{
    state.db = await openPosDb(3500);
  }catch(error){
    console.warn('Centro de Mando: no se pudo abrir la base del POS.', error);
    setHidden('emptyState', false);
    renderVisualHeader();
    clearEventSummary('No disponible');
    return;
  }

  await reloadEvents();
  await reloadProducts();
  await reloadPosActiveEvent();
  refreshOperationalSignals();
  setHidden('emptyState', state.events.length > 0);

  if (!state.events.length){
    renderVisualHeader();
    clearEventSummary('No hay eventos disponibles.');
    return;
  }

  state.visualMode = loadVisualMode();
  if (state.visualMode === MODE_GLOBAL){
    state.visualEventId = null;
    state.visualEvent = null;
  }else{
    state.visualEventId = resolveDefaultVisualEvent();
    state.visualEvent = state.visualEventId ? (state.eventsById.get(state.visualEventId) || null) : null;
  }

  renderVisualHeader();
  renderEventList('');
  hideEventList();
  if (state.visualMode === MODE_GLOBAL) renderGlobalEvents();
  await refreshEventSummary();
}

const cdmDiagnosticApi = Object.freeze({
  mode:()=>state.visualMode,
  visualEventId:()=>state.visualEventId,
  posActiveEventId:()=>state.posActiveEventId,
  refresh:refreshFromSources,
  attentionCount:()=>Number(($('attentionCount') && $('attentionCount').textContent) || 0),
  summary:()=>state.summarySignals
});
window.__A33_CDM_STAGE1 = cdmDiagnosticApi;
window.__A33_CDM_STAGE2 = cdmDiagnosticApi;
window.__A33_CDM_STAGE3 = Object.freeze({
  ...cdmDiagnosticApi,
  orders:()=>state.orderSignals,
  agenda:()=>state.agendaSignals
});
window.__A33_CDM_STAGE4 = Object.freeze({
  ...cdmDiagnosticApi,
  inventory:()=>state.inventorySignals,
  globalEvents:()=>Array.from(state.globalEventSignals.values()),
  refreshGlobalEvents:refreshGlobalEventSignals
});
window.__A33_CDM_STAGE5 = Object.freeze({
  ...window.__A33_CDM_STAGE4,
  pwaSupported:()=>typeof navigator !== 'undefined' && !!navigator.serviceWorker
});

document.addEventListener('DOMContentLoaded', init);
