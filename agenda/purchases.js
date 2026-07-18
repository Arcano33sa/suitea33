(function(){
  'use strict';

  const STORAGE_KEY = 'a33_agenda_records_v1';
  const SCHEMA_VERSION = 9;
  const GROUP_VERSION = 1;
  const STATUS_LABELS = Object.freeze({ pendiente:'Pendiente', hecho:'Hecho', cancelado:'Cancelado' });
  const PRIORITY_LABELS = Object.freeze({ baja:'Baja', media:'Media', alta:'Alta' });
  const FILTERS = new Set(['pendiente','hecho','cancelado','todos']);
  const UNIT_SET = new Set(['Unidad','Cajas','Litros','Galones']);
  const INTEGER_UNITS = new Set(['Unidad','Cajas']);
  const state = {
    allRecords: [],
    materials: [],
    currentId: '',
    draftItems: [],
    editingDraftId: '',
    filter: 'pendiente',
    saving: false,
    adding: false,
    ready: false,
    expandedId: ''
  };
  const refs = {};

  function byId(id){ return document.getElementById(id); }
  function clean(value, max){
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 500);
  }
  function safeParse(raw){ try{ return JSON.parse(String(raw || '')); }catch(_){ return null; } }
  function round2(value){ return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
  function numberOrNull(value){
    if (value === '' || value == null) return null;
    const parsed = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(parsed) ? round2(parsed) : null;
  }
  function normalizeDate(value){
    const raw = clean(value, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
  }
  function normalizeStatus(value){
    const raw = clean(value, 20).toLowerCase();
    return STATUS_LABELS[raw] ? raw : 'pendiente';
  }
  function normalizePriority(value){
    const raw = clean(value, 20).toLowerCase();
    return PRIORITY_LABELS[raw] ? raw : 'media';
  }
  function normalizeUnit(value){
    const raw = clean(value, 24);
    return UNIT_SET.has(raw) ? raw : '';
  }
  function createId(prefix){
    const safePrefix = clean(prefix || 'agd', 20) || 'agd';
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return safePrefix + '_' + window.crypto.randomUUID().replace(/-/g, '').slice(0, 18);
    }
    return safePrefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function todayIso(){
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');
  }
  function formatMoney(value){
    const n = Number(value || 0);
    try{
      return new Intl.NumberFormat('es-NI', { style:'currency', currency:'NIO', minimumFractionDigits:2, maximumFractionDigits:2 }).format(Number.isFinite(n) ? n : 0);
    }catch(_){ return 'C$' + (Number.isFinite(n) ? n : 0).toFixed(2); }
  }
  function formatNumber(value){
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
  }
  function formatDate(value){
    const iso = normalizeDate(value);
    if (!iso) return '—';
    const p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  function formatDateTime(value){
    const d = new Date(String(value || ''));
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('es-NI', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).format(d);
  }
  function escapeHtml(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];
    });
  }
  function cloneItem(item){
    return normalizePurchaseItem(JSON.parse(JSON.stringify(item || {})), {});
  }

  function normalizePurchaseItem(source, recordSource){
    const raw = source && typeof source === 'object' ? source : {};
    const record = recordSource && typeof recordSource === 'object' ? recordSource : {};
    const snapshot = raw.snapshot && typeof raw.snapshot === 'object' ? raw.snapshot : {};
    const materialId = clean(raw.materialId || snapshot.materialId || raw.id, 160);
    const name = clean(raw.name || raw.materialName || snapshot.name || record.subject, 120);
    const category = clean(raw.category || snapshot.category, 80);
    const unit = normalizeUnit(raw.unit || snapshot.unit);
    const priceUsed = numberOrNull(raw.priceUsed != null ? raw.priceUsed : (raw.price != null ? raw.price : snapshot.priceUsed));
    const quantity = numberOrNull(raw.quantity);
    const calculated = priceUsed != null && quantity != null ? round2(priceUsed * quantity) : null;
    const subtotalStored = numberOrNull(raw.subtotal);
    const subtotal = calculated != null ? calculated : subtotalStored;
    const capturedAt = clean(snapshot.capturedAt || raw.capturedAt || record.createdAt || '', 80);
    return {
      draftId: clean(raw.draftId || raw.lineId, 180) || createId('itm'),
      materialId,
      name,
      category,
      unit,
      priceUsed: priceUsed == null ? 0 : priceUsed,
      quantity,
      subtotal: subtotal == null ? 0 : subtotal,
      snapshot: {
        materialId,
        name,
        category,
        unit,
        priceUsed: priceUsed == null ? 0 : priceUsed,
        capturedAt
      }
    };
  }

  function itemIdentity(item){
    const row = item && typeof item === 'object' ? item : {};
    const id = clean(row.materialId,160);
    if (id) return 'id:' + id;
    const name = clean(row.name,120).toLocaleLowerCase('es-NI');
    const unit = normalizeUnit(row.unit);
    return name ? ('legacy:' + name + '|' + unit) : '';
  }

  function validPurchaseItem(item){
    return !!(item && itemIdentity(item) && item.name && item.unit && Number.isFinite(Number(item.priceUsed)) && Number(item.quantity) > 0);
  }

  function extractGroupItems(record){
    const source = record && typeof record === 'object' ? record : {};
    const group = source.purchaseGroup && typeof source.purchaseGroup === 'object' ? source.purchaseGroup : {};
    const candidates = Array.isArray(group.items)
      ? group.items
      : (Array.isArray(source.purchaseItems)
        ? source.purchaseItems
        : (source.purchase && Array.isArray(source.purchase.items) ? source.purchase.items : null));
    if (Array.isArray(candidates) && candidates.length) {
      return candidates.map(function(item){ return normalizePurchaseItem(item, source); }).filter(validPurchaseItem);
    }
    const legacyRaw = source.purchase && typeof source.purchase === 'object'
      ? source.purchase
      : (source.compra && typeof source.compra === 'object' ? source.compra : {});
    const legacy = normalizePurchaseItem(legacyRaw, source);
    return validPurchaseItem(legacy) ? [legacy] : [];
  }

  function groupTotal(items){
    return round2((Array.isArray(items) ? items : []).reduce(function(sum,item){ return sum + Number(item && item.subtotal || 0); }, 0));
  }

  function aggregatePurchase(items, recordSource){
    const rows = Array.isArray(items) ? items.filter(validPurchaseItem) : [];
    if (rows.length === 1) return cloneItem(rows[0]);
    const total = groupTotal(rows);
    const record = recordSource && typeof recordSource === 'object' ? recordSource : {};
    const capturedAt = clean(record.createdAt || '', 80) || (rows[0] && rows[0].snapshot ? rows[0].snapshot.capturedAt : '');
    return {
      materialId: '',
      name: rows.length ? ('Compra agrupada (' + rows.length + ' artículos)') : clean(record.subject,120),
      category: rows.length ? 'Varios' : '',
      unit: 'Unidad',
      priceUsed: total,
      quantity: rows.length ? 1 : null,
      subtotal: total,
      snapshot: {
        materialId: '',
        name: rows.length ? ('Compra agrupada (' + rows.length + ' artículos)') : clean(record.subject,120),
        category: rows.length ? 'Varios' : '',
        unit: 'Unidad',
        priceUsed: total,
        capturedAt
      }
    };
  }

  function normalizePurchaseRecord(source){
    const record = source && typeof source === 'object' ? source : {};
    const items = extractGroupItems(record);
    const totalGeneral = groupTotal(items);
    const createdAt = clean(record.createdAt, 80) || new Date().toISOString();
    const updatedAt = clean(record.updatedAt || record.createdAt, 80) || createdAt;
    const purchase = aggregatePurchase(items, { ...record, createdAt:createdAt });
    const subject = items.length === 1 ? items[0].name : (items.length ? ('Compra agrupada · ' + items.length + ' artículos') : clean(record.subject,120));
    return {
      ...record,
      id: clean(record.id, 180) || createId('agd'),
      subject,
      type: 'compra',
      client: '',
      clientId: '',
      modality: '',
      date: normalizeDate(record.date || record.neededDate || record.fechaNecesaria),
      time: '',
      status: normalizeStatus(record.status),
      priority: normalizePriority(record.priority),
      notes: clean(record.notes, 1200),
      createdAt,
      updatedAt,
      pedido: record.pedido && typeof record.pedido === 'object' ? record.pedido : {
        enabled:false, productId:'', product:'', productNameSnapshot:'', price:null, priceSnapshot:null,
        quantity:null, total:null, delivery:'', productSnapshot:null, historicalOnly:false
      },
      purchase,
      purchaseGroup: {
        version: GROUP_VERSION,
        itemCount: items.length,
        totalGeneral,
        items: items.map(cloneItem)
      }
    };
  }

  function readStore(){
    let raw = '';
    try{ raw = localStorage.getItem(STORAGE_KEY) || ''; }catch(_){ raw = ''; }
    const parsed = safeParse(raw);
    const records = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.records) ? parsed.records : []);
    return {
      schemaVersion: parsed && Number(parsed.schemaVersion) || SCHEMA_VERSION,
      records: records.filter(function(item){ return item && typeof item === 'object'; })
    };
  }

  function reloadRecords(){
    const payload = readStore();
    state.allRecords = payload.records.slice();
    return state.allRecords.filter(function(item){ return clean(item && item.type, 20).toLowerCase() === 'compra'; }).map(normalizePurchaseRecord);
  }

  function saveAllRecords(records){
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      records: Array.isArray(records) ? records : []
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    try{ window.dispatchEvent(new CustomEvent('a33:agenda-records-changed', { detail:{ source:'compras', storageKey:STORAGE_KEY } })); }catch(_){ }
  }

  function currentPurchases(){ return reloadRecords(); }
  function getRecord(id){
    return currentPurchases().find(function(item){ return item.id === id; }) || null;
  }
  function materialById(id){
    const target = clean(id,160);
    return state.materials.find(function(item){ return clean(item.id || item.materialId,160) === target; }) || null;
  }

  function setRefs(){
    refs.form = byId('purchaseForm');
    refs.material = byId('purchaseMaterial');
    refs.materialHelp = byId('purchaseMaterialHelp');
    refs.category = byId('purchaseCategory');
    refs.unit = byId('purchaseUnit');
    refs.price = byId('purchasePrice');
    refs.quantity = byId('purchaseQuantity');
    refs.subtotal = byId('purchaseSubtotal');
    refs.date = byId('purchaseDate');
    refs.priority = byId('purchasePriority');
    refs.status = byId('purchaseStatus');
    refs.notes = byId('purchaseNotes');
    refs.addBtn = byId('purchaseAddBtn');
    refs.draftPanel = byId('purchaseDraftPanel');
    refs.draftList = byId('purchaseDraftList');
    refs.draftEmpty = byId('purchaseDraftEmpty');
    refs.draftCount = byId('purchaseDraftCount');
    refs.draftTotal = byId('purchaseDraftTotal');
    refs.formTitle = byId('purchaseFormTitle');
    refs.formBadge = byId('purchaseFormBadge');
    refs.formStatus = byId('purchaseFormStatus');
    refs.metaId = byId('purchaseMetaId');
    refs.metaCreated = byId('purchaseMetaCreated');
    refs.metaUpdated = byId('purchaseMetaUpdated');
    refs.newBtn = byId('purchaseNewBtn');
    refs.deleteBtn = byId('purchaseDeleteBtn');
    refs.saveBtn = byId('purchaseSaveBtn');
    refs.materialsEmpty = byId('purchaseMaterialsEmpty');
    refs.list = byId('purchaseList');
    refs.empty = byId('purchaseEmptyState');
    refs.emptyTitle = byId('purchaseEmptyTitle');
    refs.emptyText = byId('purchaseEmptyText');
    refs.listBadge = byId('purchaseListBadge');
    refs.toolbarTitle = byId('purchaseToolbarTitle');
    refs.toolbarText = byId('purchaseToolbarText');
    refs.filterButtons = Array.from(document.querySelectorAll('[data-purchase-filter]'));
    refs.pendingBudget = byId('purchasePendingBudget');
    refs.boughtTotal = byId('purchaseBoughtTotal');
    refs.pendingCount = byId('purchasePendingCount');
    refs.doneCount = byId('purchaseDoneCount');
    refs.calendarDate = byId('purchaseCalendarDate');
    refs.exportDateBtn = byId('purchaseExportDateBtn');
    refs.exportAllBtn = byId('purchaseExportAllBtn');
    refs.calendarBadge = byId('purchaseCalendarBadge');
    refs.calendarStatus = byId('purchaseCalendarStatus');
  }

  async function loadMaterials(){
    try{
      if (!window.A33Materials || typeof window.A33Materials.listActive !== 'function') throw new Error('materials_contract_missing');
      const rows = await window.A33Materials.listActive();
      state.materials = (Array.isArray(rows) ? rows : []).filter(function(item){
        return item && item.active !== false && clean(item.id || item.materialId,160) && clean(item.name,120) && normalizeUnit(item.unit) && numberOrNull(item.price) != null;
      }).map(function(item){
        return {
          id: clean(item.id || item.materialId,160),
          localId: item.localId == null ? null : item.localId,
          name: clean(item.name,120),
          category: clean(item.category,80),
          unit: normalizeUnit(item.unit),
          price: numberOrNull(item.price) || 0,
          active: true
        };
      }).sort(function(a,b){ return a.name.localeCompare(b.name,'es-NI',{sensitivity:'base'}); });
      renderMaterialOptions();
      refs.materialsEmpty.hidden = state.materials.length > 0;
      refs.form.hidden = false;
      refs.material.disabled = !state.materials.length;
      refs.addBtn.disabled = !state.materials.length;
      refs.saveBtn.disabled = !state.materials.length;
      if (!state.materials.length) {
        refs.formStatus.textContent = 'Agrega artículos activos en Catálogos → Materia Prima antes de registrar Compras.';
      }
    }catch(error){
      console.error('Agenda Compras · Materia Prima', error);
      state.materials = [];
      renderMaterialOptions();
      refs.materialsEmpty.hidden = false;
      refs.material.disabled = true;
      refs.addBtn.disabled = true;
      refs.saveBtn.disabled = true;
      refs.formStatus.textContent = 'No se pudo cargar Materia Prima. Revisa Catálogos y vuelve a abrir Compras.';
    }
  }

  function renderMaterialOptions(){
    if (!refs.material) return;
    const current = clean(refs.material.value,160);
    refs.material.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = state.materials.length ? 'Selecciona un artículo activo' : 'No hay artículos activos';
    refs.material.appendChild(first);
    state.materials.forEach(function(item){
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name + ' · ' + item.unit + ' · ' + formatMoney(item.price);
      refs.material.appendChild(option);
    });
    if (current && materialById(current)) refs.material.value = current;
  }

  function selectedSnapshot(){
    const material = materialById(refs.material.value);
    if (!material) return null;
    const now = new Date().toISOString();
    return {
      materialId: material.id,
      name: material.name,
      category: material.category,
      unit: material.unit,
      priceUsed: material.price,
      snapshot: {
        materialId: material.id,
        name: material.name,
        category: material.category,
        unit: material.unit,
        priceUsed: material.price,
        capturedAt: now
      }
    };
  }

  function applyMaterial(){
    const data = selectedSnapshot();
    refs.category.value = data ? data.category : '';
    refs.unit.value = data ? data.unit : '';
    refs.price.value = data ? formatMoney(data.priceUsed) : '';
    refs.quantity.step = data && INTEGER_UNITS.has(data.unit) ? '1' : '0.01';
    refs.quantity.min = data && INTEGER_UNITS.has(data.unit) ? '1' : '0.01';
    syncSubtotal();
  }

  function syncSubtotal(){
    const snapshot = selectedSnapshot();
    const quantity = numberOrNull(refs.quantity.value);
    const subtotal = snapshot && quantity != null ? round2(snapshot.priceUsed * quantity) : null;
    refs.subtotal.value = subtotal == null ? '' : formatMoney(subtotal);
    return subtotal;
  }

  function clearArticleInputs(focus){
    refs.material.value = '';
    refs.quantity.value = '';
    refs.category.value = '';
    refs.unit.value = '';
    refs.price.value = '';
    refs.subtotal.value = '';
    refs.material.setCustomValidity('');
    refs.quantity.setCustomValidity('');
    if (focus !== false && !refs.material.disabled) refs.material.focus();
  }

  function resetForm(options){
    const settings = options || {};
    state.currentId = '';
    state.draftItems = [];
    state.editingDraftId = '';
    refs.form.reset();
    refs.date.value = todayIso();
    refs.priority.value = 'media';
    refs.status.value = 'pendiente';
    refs.material.disabled = !state.materials.length;
    refs.addBtn.disabled = !state.materials.length;
    refs.saveBtn.disabled = !state.materials.length;
    refs.deleteBtn.hidden = true;
    refs.formTitle.textContent = 'Nueva Compra';
    refs.formBadge.textContent = 'Nuevo';
    refs.saveBtn.textContent = 'Guardar compra';
    refs.metaId.textContent = 'Nuevo';
    refs.metaCreated.textContent = '—';
    refs.metaUpdated.textContent = '—';
    refs.materialHelp.textContent = 'Solo se muestran artículos activos de Catálogos → Materia Prima.';
    refs.formStatus.textContent = settings.statusMessage || (state.materials.length
      ? 'Agrega artículos; Fecha necesaria, Prioridad, Estado y Notas se mantienen hasta guardar.'
      : 'Agrega artículos activos en Catálogos → Materia Prima antes de registrar Compras.');
    renderMaterialOptions();
    clearArticleInputs(false);
    renderDraftItems();
    if (settings.focus !== false && !refs.material.disabled) refs.material.focus();
    render();
  }

  function requestNew(){
    if (state.draftItems.length && !window.confirm('Hay artículos agregados sin guardar. ¿Deseas descartarlos y comenzar una compra nueva?')) return false;
    resetForm();
    return true;
  }

  function fillForm(record, options){
    if (!record) return;
    const settings = options || {};
    state.currentId = record.id;
    state.draftItems = record.purchaseGroup.items.map(cloneItem);
    state.editingDraftId = '';
    refs.date.value = record.date;
    refs.priority.value = record.priority;
    refs.status.value = record.status;
    refs.notes.value = record.notes || '';
    refs.deleteBtn.hidden = false;
    refs.material.disabled = !state.materials.length;
    refs.addBtn.disabled = !state.materials.length;
    refs.saveBtn.disabled = false;
    refs.formTitle.textContent = 'Editar Compra';
    refs.formBadge.textContent = record.purchaseGroup.items.length > 1 ? 'Compra agrupada' : 'Histórico protegido';
    refs.saveBtn.textContent = 'Actualizar compra';
    refs.metaId.textContent = record.id;
    refs.metaCreated.textContent = formatDateTime(record.createdAt);
    refs.metaUpdated.textContent = formatDateTime(record.updatedAt);
    refs.materialHelp.textContent = 'Puedes agregar artículos activos. Los ya guardados conservan nombre, categoría, unidad y precio histórico.';
    clearArticleInputs(false);
    refs.formStatus.textContent = 'Edita cantidades o agrega artículos sin alterar sus precios históricos.';
    renderDraftItems();
    render();
    if (settings.focus !== false && !refs.material.disabled) refs.material.focus();
  }

  function clearArticleValidity(){
    [refs.material, refs.quantity].forEach(function(el){ if (el && el.setCustomValidity) el.setCustomValidity(''); });
  }

  function validateArticle(options){
    const settings = options || {};
    clearArticleValidity();
    const snapshot = selectedSnapshot();
    if (!snapshot || !snapshot.materialId || !snapshot.name) {
      refs.material.setCustomValidity('Selecciona un artículo activo de Materia Prima.');
      if (settings.report !== false) refs.material.reportValidity();
      return null;
    }
    const quantity = numberOrNull(refs.quantity.value);
    if (quantity == null || quantity <= 0) {
      refs.quantity.setCustomValidity('La cantidad debe ser numérica y mayor que cero.');
      if (settings.report !== false) refs.quantity.reportValidity();
      return null;
    }
    if (INTEGER_UNITS.has(snapshot.unit) && !Number.isInteger(quantity)) {
      refs.quantity.setCustomValidity('Para Unidad o Cajas usa una cantidad entera.');
      if (settings.report !== false) refs.quantity.reportValidity();
      return null;
    }
    return { snapshot, quantity, subtotal:round2(snapshot.priceUsed * quantity) };
  }

  function addDraftItem(options){
    const settings = options || {};
    if (state.adding) return false;
    const validated = validateArticle({ report:settings.report !== false });
    if (!validated) return false;
    state.adding = true;
    refs.addBtn.disabled = true;
    const incomingIdentity = itemIdentity(validated.snapshot);
    const existing = state.draftItems.find(function(item){
      return itemIdentity(item) === incomingIdentity || (item.materialId && item.materialId === validated.snapshot.materialId);
    });
    if (existing) {
      existing.quantity = round2(Number(existing.quantity || 0) + validated.quantity);
      existing.subtotal = round2(Number(existing.priceUsed || 0) * existing.quantity);
      refs.formStatus.textContent = existing.name + ' se actualizó a ' + formatNumber(existing.quantity) + ' ' + existing.unit + '.';
    } else {
      const item = normalizePurchaseItem({
        draftId: createId('itm'),
        materialId: validated.snapshot.materialId,
        name: validated.snapshot.name,
        category: validated.snapshot.category,
        unit: validated.snapshot.unit,
        priceUsed: validated.snapshot.priceUsed,
        quantity: validated.quantity,
        subtotal: validated.subtotal,
        snapshot: validated.snapshot.snapshot
      }, {});
      state.draftItems.push(item);
      refs.formStatus.textContent = item.name + ' fue agregado a la compra.';
    }
    state.editingDraftId = '';
    clearArticleInputs(settings.focus !== false);
    renderDraftItems();
    window.setTimeout(function(){
      state.adding = false;
      refs.addBtn.disabled = !state.materials.length;
    }, 350);
    return true;
  }

  function startDraftEdit(id){
    state.editingDraftId = clean(id,180);
    renderDraftItems();
    const input = refs.draftList.querySelector('[data-draft-quantity="' + state.editingDraftId + '"]');
    if (input) { input.focus(); if (typeof input.select === 'function') input.select(); }
  }

  function cancelDraftEdit(){
    state.editingDraftId = '';
    renderDraftItems();
  }

  function saveDraftEdit(id, input){
    const item = state.draftItems.find(function(row){ return row.draftId === id; });
    if (!item || !input) return false;
    input.setCustomValidity('');
    const quantity = numberOrNull(input.value);
    if (quantity == null || quantity <= 0) {
      input.setCustomValidity('La cantidad debe ser mayor que cero.');
      input.reportValidity();
      return false;
    }
    if (INTEGER_UNITS.has(item.unit) && !Number.isInteger(quantity)) {
      input.setCustomValidity('Para Unidad o Cajas usa una cantidad entera.');
      input.reportValidity();
      return false;
    }
    item.quantity = quantity;
    item.subtotal = round2(item.priceUsed * quantity);
    state.editingDraftId = '';
    refs.formStatus.textContent = 'Cantidad de ' + item.name + ' actualizada.';
    renderDraftItems();
    return true;
  }

  function removeDraftItem(id){
    const item = state.draftItems.find(function(row){ return row.draftId === id; });
    state.draftItems = state.draftItems.filter(function(row){ return row.draftId !== id; });
    if (state.editingDraftId === id) state.editingDraftId = '';
    refs.formStatus.textContent = item ? (item.name + ' fue quitado de la compra.') : 'Artículo quitado.';
    renderDraftItems();
  }

  function iconButton(symbol, className, title, handler){
    const el = document.createElement('button');
    el.type = 'button';
    el.className = className;
    el.textContent = symbol;
    el.title = title;
    el.setAttribute('aria-label', title);
    el.addEventListener('click', function(event){ event.preventDefault(); event.stopPropagation(); handler(); });
    return el;
  }

  function draftRow(item){
    const row = document.createElement('article');
    row.className = 'purchase-draft-row' + (state.editingDraftId === item.draftId ? ' is-editing' : '');
    row.dataset.draftId = item.draftId;

    const name = document.createElement('div');
    name.className = 'purchase-draft-name';
    const strong = document.createElement('strong');
    strong.textContent = item.name;
    const small = document.createElement('small');
    small.textContent = item.category || 'Sin categoría';
    name.append(strong, small);

    const quantity = document.createElement('div');
    quantity.className = 'purchase-draft-cell purchase-draft-quantity';
    quantity.setAttribute('data-label','Cantidad');
    if (state.editingDraftId === item.draftId) {
      const input = document.createElement('input');
      input.type = 'number';
      input.inputMode = 'decimal';
      input.min = INTEGER_UNITS.has(item.unit) ? '1' : '0.01';
      input.step = INTEGER_UNITS.has(item.unit) ? '1' : '0.01';
      input.value = formatNumber(item.quantity);
      input.dataset.draftQuantity = item.draftId;
      input.setAttribute('aria-label','Nueva cantidad de ' + item.name);
      input.addEventListener('keydown', function(event){
        if (event.key === 'Enter') { event.preventDefault(); saveDraftEdit(item.draftId,input); }
        if (event.key === 'Escape') { event.preventDefault(); cancelDraftEdit(); }
      });
      quantity.appendChild(input);
    } else {
      quantity.textContent = formatNumber(item.quantity);
    }

    const unit = document.createElement('div');
    unit.className = 'purchase-draft-cell purchase-draft-unit';
    unit.setAttribute('data-label','Unidad');
    unit.textContent = item.unit;

    const price = document.createElement('div');
    price.className = 'purchase-draft-cell purchase-draft-money purchase-draft-price';
    price.setAttribute('data-label','Precio unitario');
    price.textContent = formatMoney(item.priceUsed);

    const subtotal = document.createElement('div');
    subtotal.className = 'purchase-draft-cell purchase-draft-money purchase-draft-subtotal';
    subtotal.setAttribute('data-label','Subtotal');
    subtotal.textContent = formatMoney(item.subtotal);

    const actions = document.createElement('div');
    actions.className = 'purchase-draft-actions';
    actions.setAttribute('data-label','Acciones');
    if (state.editingDraftId === item.draftId) {
      actions.append(
        iconButton('✓','purchase-draft-action purchase-draft-action--save','Guardar cantidad',function(){
          const input = row.querySelector('[data-draft-quantity]');
          saveDraftEdit(item.draftId,input);
        }),
        iconButton('×','purchase-draft-action','Cancelar edición',cancelDraftEdit)
      );
    } else {
      actions.append(
        iconButton('✎','purchase-draft-action','Editar cantidad de ' + item.name,function(){ startDraftEdit(item.draftId); }),
        iconButton('🗑','purchase-draft-action purchase-draft-action--danger','Quitar ' + item.name,function(){ removeDraftItem(item.draftId); })
      );
    }

    row.append(name, quantity, unit, price, subtotal, actions);
    return row;
  }

  function renderDraftItems(){
    if (!refs.draftList) return;
    refs.draftList.innerHTML = '';
    state.draftItems.forEach(function(item){ refs.draftList.appendChild(draftRow(item)); });
    refs.draftEmpty.hidden = state.draftItems.length > 0;
    refs.draftCount.textContent = state.draftItems.length + ' artículo' + (state.draftItems.length === 1 ? '' : 's');
    refs.draftTotal.textContent = formatMoney(groupTotal(state.draftItems));
    refs.draftPanel.classList.toggle('has-items', state.draftItems.length > 0);
  }

  function validateGeneral(){
    refs.date.setCustomValidity('');
    const date = normalizeDate(refs.date.value);
    if (!date) {
      refs.date.setCustomValidity('Selecciona la Fecha necesaria.');
      refs.date.reportValidity();
      return null;
    }
    if (!state.draftItems.length) {
      refs.formStatus.textContent = 'Agrega al menos un artículo antes de guardar la compra.';
      if (!refs.material.disabled) refs.material.focus();
      return null;
    }
    return { date:date };
  }

  function pendingArticleInputs(){
    return !!clean(refs.material.value,160) || clean(refs.quantity.value,80) !== '';
  }

  function buildStoredGroup(items){
    const rows = (Array.isArray(items) ? items : []).map(function(item){
      const normalized = cloneItem(item);
      normalized.subtotal = round2(normalized.priceUsed * normalized.quantity);
      normalized.snapshot = {
        materialId: normalized.materialId,
        name: normalized.name,
        category: normalized.category,
        unit: normalized.unit,
        priceUsed: normalized.priceUsed,
        capturedAt: normalized.snapshot.capturedAt || new Date().toISOString()
      };
      return normalized;
    });
    return { version:GROUP_VERSION, itemCount:rows.length, totalGeneral:groupTotal(rows), items:rows };
  }

  function upsertPurchase(){
    if (state.saving) return false;
    if (pendingArticleInputs() && !addDraftItem({ focus:false, report:true })) {
      refs.formStatus.textContent = 'Completa correctamente el último artículo antes de guardar.';
      return false;
    }
    const validated = validateGeneral();
    if (!validated) return false;
    state.saving = true;
    refs.saveBtn.disabled = true;
    refs.addBtn.disabled = true;
    const now = new Date().toISOString();
    try{
      const store = readStore();
      const records = store.records.slice();
      const index = state.currentId ? records.findIndex(function(item){ return clean(item && item.id,180) === state.currentId; }) : -1;
      const existing = index >= 0 ? normalizePurchaseRecord(records[index]) : null;
      const purchaseGroup = buildStoredGroup(state.draftItems);
      const purchase = aggregatePurchase(purchaseGroup.items, { createdAt:existing ? existing.createdAt : now });
      const record = normalizePurchaseRecord({
        ...(existing || {}),
        id: existing ? existing.id : createId('agd'),
        subject: purchaseGroup.items.length === 1 ? purchaseGroup.items[0].name : ('Compra agrupada · ' + purchaseGroup.items.length + ' artículos'),
        type: 'compra',
        client: '',
        clientId: '',
        modality: '',
        date: validated.date,
        time: '',
        status: normalizeStatus(refs.status.value),
        priority: normalizePriority(refs.priority.value),
        notes: clean(refs.notes.value,1200),
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
        purchase,
        purchaseGroup
      });
      if (index >= 0) records[index] = record;
      else records.unshift(record);
      saveAllRecords(records);
      const message = existing ? 'Compra agrupada actualizada correctamente.' : 'Compra agrupada guardada correctamente.';
      resetForm({ focus:false, statusMessage:message });
      return true;
    }catch(error){
      console.error('Agenda Compras · Guardar', error);
      refs.formStatus.textContent = 'No se pudo guardar la compra. La preparación se conserva para intentarlo nuevamente.';
      return false;
    }finally{
      window.setTimeout(function(){
        state.saving = false;
        refs.addBtn.disabled = !state.materials.length;
        refs.saveBtn.disabled = !state.materials.length;
      }, 450);
    }
  }

  function updateStatus(id, status){
    const target = normalizeStatus(status);
    const store = readStore();
    const index = store.records.findIndex(function(item){ return clean(item && item.id,180) === id; });
    if (index < 0) return;
    const existing = normalizePurchaseRecord(store.records[index]);
    if (existing.status === target) return;
    const updated = normalizePurchaseRecord({ ...existing, status:target, updatedAt:new Date().toISOString() });
    store.records[index] = updated;
    saveAllRecords(store.records);
    if (state.currentId === id) fillForm(updated, { focus:false });
    else render();
  }

  function removePurchase(id){
    const record = getRecord(id);
    if (!record) return;
    if (!window.confirm('¿Eliminar esta compra planificada? Esta acción no se puede deshacer.')) return;
    const store = readStore();
    const next = store.records.filter(function(item){ return clean(item && item.id,180) !== id; });
    saveAllRecords(next);
    if (state.expandedId === id) state.expandedId = '';
    if (state.currentId === id) resetForm({ focus:false, statusMessage:'Compra eliminada.' });
    else render();
  }

  function priorityRank(value){ return value === 'alta' ? 0 : (value === 'media' ? 1 : 2); }
  function visiblePurchases(){
    let rows = currentPurchases();
    if (state.filter !== 'todos') rows = rows.filter(function(item){ return item.status === state.filter; });
    return rows.sort(function(a,b){
      if (a.status !== b.status) return ['pendiente','hecho','cancelado'].indexOf(a.status) - ['pendiente','hecho','cancelado'].indexOf(b.status);
      if (a.status === 'pendiente') {
        const dateDiff = String(a.date || '9999').localeCompare(String(b.date || '9999'));
        if (dateDiff) return dateDiff;
        const prio = priorityRank(a.priority) - priorityRank(b.priority);
        if (prio) return prio;
      }
      return Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || '');
    });
  }

  function button(label, className, title, handler){
    const el = document.createElement('button');
    el.type = 'button';
    el.className = className;
    el.textContent = label;
    el.title = title;
    el.setAttribute('aria-label', title);
    el.addEventListener('click', function(event){ event.stopPropagation(); handler(); });
    return el;
  }

  function togglePurchaseDetails(id){
    const target = clean(id,180);
    state.expandedId = state.expandedId === target ? '' : target;
    render();
    if (state.expandedId) {
      const card = refs.list.querySelector('[data-record-id="' + state.expandedId + '"]');
      if (card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block:'nearest', behavior:'smooth' });
    }
  }

  function purchaseItemDetailRow(item){
    const row = document.createElement('div');
    row.className = 'purchase-detail-row';

    const name = document.createElement('div');
    name.className = 'purchase-detail-name';
    const strong = document.createElement('strong');
    strong.textContent = item.name || 'Artículo histórico';
    const small = document.createElement('small');
    small.textContent = item.category || 'Sin categoría';
    name.append(strong, small);

    const quantity = document.createElement('div');
    quantity.className = 'purchase-detail-cell purchase-detail-nowrap';
    quantity.setAttribute('data-label','Cantidad');
    quantity.textContent = formatNumber(item.quantity) + ' ' + item.unit;

    const price = document.createElement('div');
    price.className = 'purchase-detail-cell purchase-detail-nowrap';
    price.setAttribute('data-label','Precio histórico');
    price.textContent = formatMoney(item.priceUsed);

    const subtotal = document.createElement('div');
    subtotal.className = 'purchase-detail-cell purchase-detail-nowrap purchase-detail-subtotal';
    subtotal.setAttribute('data-label','Subtotal');
    subtotal.textContent = formatMoney(item.subtotal);

    row.append(name, quantity, price, subtotal);
    return row;
  }

  function purchaseCard(record){
    const article = document.createElement('article');
    const expanded = state.expandedId === record.id;
    article.className = 'agenda-record purchase-record' + (record.id === state.currentId ? ' is-active' : '') + (expanded ? ' is-expanded' : '');
    article.dataset.recordId = record.id;
    article.tabIndex = 0;
    article.setAttribute('aria-expanded', expanded ? 'true' : 'false');

    const top = document.createElement('div');
    top.className = 'agenda-record-top';
    const copy = document.createElement('div');
    copy.className = 'agenda-record-copy';
    const title = document.createElement('h3');
    const itemCount = record.purchaseGroup.items.length;
    title.textContent = 'Compra del ' + formatDate(record.date);
    const meta = document.createElement('div');
    meta.className = 'agenda-record-meta';
    meta.innerHTML = [
      '<span class="agenda-chip">' + escapeHtml(itemCount + ' artículo' + (itemCount === 1 ? '' : 's')) + '</span>',
      '<span class="agenda-chip purchase-money-chip">' + escapeHtml(formatMoney(record.purchaseGroup.totalGeneral)) + '</span>',
      '<span class="agenda-chip agenda-chip--priority-' + record.priority + '">' + escapeHtml(PRIORITY_LABELS[record.priority]) + '</span>',
      '<span class="agenda-status agenda-status--' + record.status + '">' + escapeHtml(STATUS_LABELS[record.status]) + '</span>'
    ].join('');
    copy.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'agenda-record-actions';
    const main = document.createElement('div');
    main.className = 'agenda-record-actions-group';
    main.appendChild(button(expanded ? 'Ocultar' : 'Ver', 'agenda-inline-btn', expanded ? 'Ocultar detalle de compra' : 'Ver compra completa', function(){ togglePurchaseDetails(record.id); }));
    main.appendChild(button('Editar', 'agenda-inline-btn', 'Editar compra completa', function(){ fillForm(record); }));
    if (record.status === 'pendiente') {
      main.appendChild(button('Hecho', 'agenda-inline-btn agenda-inline-btn--done', 'Marcar toda la compra como Hecho', function(){ updateStatus(record.id,'hecho'); }));
      main.appendChild(button('Cancelar', 'agenda-inline-btn agenda-inline-btn--cancel', 'Cancelar toda la compra', function(){ updateStatus(record.id,'cancelado'); }));
    } else {
      main.appendChild(button('Pendiente', 'agenda-inline-btn agenda-inline-btn--status', 'Reactivar toda la compra como Pendiente', function(){ updateStatus(record.id,'pendiente'); }));
    }
    const destructive = document.createElement('div');
    destructive.className = 'agenda-record-actions-group';
    destructive.appendChild(button('Borrar', 'agenda-inline-btn agenda-inline-btn--danger', 'Borrar compra completa', function(){ removePurchase(record.id); }));
    actions.append(main, destructive);
    top.append(copy, actions);

    const summary = document.createElement('div');
    summary.className = 'purchase-record-details';
    summary.innerHTML = [
      '<span><b>Fecha necesaria:</b> ' + escapeHtml(formatDate(record.date)) + '</span>',
      '<span><b>Total general:</b> ' + escapeHtml(formatMoney(record.purchaseGroup.totalGeneral)) + '</span>',
      '<span><b>Artículos:</b> ' + escapeHtml(String(itemCount)) + '</span>',
      '<span><b>Resumen:</b> ' + escapeHtml(record.purchaseGroup.items.slice(0,3).map(function(item){ return item.name; }).join(', ') + (itemCount > 3 ? '…' : '')) + '</span>'
    ].join('');

    const detail = document.createElement('section');
    detail.className = 'purchase-full-detail';
    detail.hidden = !expanded;
    detail.setAttribute('aria-label','Detalle completo de la compra');
    const detailHead = document.createElement('div');
    detailHead.className = 'purchase-full-detail-head';
    detailHead.innerHTML = '<strong>Detalle de la compra</strong><span>' + escapeHtml(itemCount + ' artículo' + (itemCount === 1 ? '' : 's') + ' · ' + formatMoney(record.purchaseGroup.totalGeneral)) + '</span>';
    const detailList = document.createElement('div');
    detailList.className = 'purchase-detail-list';
    record.purchaseGroup.items.forEach(function(item){ detailList.appendChild(purchaseItemDetailRow(item)); });
    detail.append(detailHead, detailList);
    if (record.notes) {
      const notes = document.createElement('div');
      notes.className = 'purchase-detail-notes';
      const label = document.createElement('strong');
      label.textContent = 'Notas generales';
      const text = document.createElement('p');
      text.textContent = record.notes;
      notes.append(label, text);
      detail.appendChild(notes);
    }

    const foot = document.createElement('div');
    foot.className = 'agenda-record-foot';
    foot.innerHTML = '<span>Creado: ' + escapeHtml(formatDateTime(record.createdAt)) + '</span><span>Actualizado: ' + escapeHtml(formatDateTime(record.updatedAt)) + '</span>';
    article.append(top, summary, detail, foot);
    article.addEventListener('click', function(event){
      if (event.target && event.target.closest && event.target.closest('button,input,select,textarea,a')) return;
      togglePurchaseDetails(record.id);
    });
    article.addEventListener('keydown', function(event){
      if (event.key === 'Enter' || event.key === ' '){ event.preventDefault(); togglePurchaseDetails(record.id); }
    });
    return article;
  }

  function purchaseTotal(record){
    return record && record.purchaseGroup ? Number(record.purchaseGroup.totalGeneral || 0) : Number(record && record.purchase && record.purchase.subtotal || 0);
  }

  function updateBudget(records){
    const rows = Array.isArray(records) ? records : currentPurchases();
    const pending = rows.filter(function(item){ return item.status === 'pendiente'; });
    const done = rows.filter(function(item){ return item.status === 'hecho'; });
    refs.pendingBudget.textContent = formatMoney(pending.reduce(function(sum,item){ return sum + purchaseTotal(item); },0));
    refs.boughtTotal.textContent = formatMoney(done.reduce(function(sum,item){ return sum + purchaseTotal(item); },0));
    refs.pendingCount.textContent = String(pending.length);
    refs.doneCount.textContent = String(done.length);
  }

  function updateToolbar(all, visible){
    refs.filterButtons.forEach(function(btn){
      const active = btn.dataset.purchaseFilter === state.filter;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    refs.listBadge.textContent = visible.length + ' visibles · ' + all.length + ' total';
    if (!all.length) refs.listBadge.textContent = '0 elementos';
    if (state.filter === 'pendiente') {
      refs.toolbarTitle.textContent = 'Pendientes al frente';
      refs.toolbarText.textContent = 'Solo compras pendientes; son las que suman al Presupuesto y pueden exportarse.';
    } else if (state.filter === 'hecho') {
      refs.toolbarTitle.textContent = 'Compras realizadas';
      refs.toolbarText.textContent = 'Solo registros Hechos; suman al Total comprado.';
    } else if (state.filter === 'cancelado') {
      refs.toolbarTitle.textContent = 'Compras canceladas';
      refs.toolbarText.textContent = 'No suman al Presupuesto ni al Total comprado.';
    } else {
      refs.toolbarTitle.textContent = 'Histórico completo';
      refs.toolbarText.textContent = 'Todos los estados de Compras, sin mezclar Reuniones ni Tareas.';
    }
  }

  function updateEmpty(all, visible){
    refs.empty.hidden = visible.length > 0;
    if (all.length === 0) {
      refs.emptyTitle.textContent = state.materials.length ? 'Aún no hay compras' : 'Primero configura Materia Prima';
      refs.emptyText.textContent = state.materials.length
        ? 'Guarda la primera compra planificada para empezar.'
        : 'Agrega artículos activos en Catálogos → Materia Prima.';
    } else {
      refs.emptyTitle.textContent = 'No hay registros en este estado';
      refs.emptyText.textContent = 'Cambia el filtro para consultar el resto del histórico.';
    }
  }

  function pendingGroups(records){
    const groups = new Map();
    (Array.isArray(records) ? records : currentPurchases()).filter(function(item){ return item.status === 'pendiente' && item.date; }).forEach(function(item){
      if (!groups.has(item.date)) groups.set(item.date, []);
      const list = groups.get(item.date);
      if (!list.some(function(existing){ return existing.id === item.id; })) list.push(item);
    });
    return new Map(Array.from(groups.entries()).sort(function(a,b){ return a[0].localeCompare(b[0]); }));
  }

  function updateCalendar(records){
    const groups = pendingGroups(records);
    const previous = refs.calendarDate.value;
    refs.calendarDate.innerHTML = '';
    if (!groups.size) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No hay fechas pendientes';
      refs.calendarDate.appendChild(option);
    } else {
      groups.forEach(function(items,date){
        const option = document.createElement('option');
        option.value = date;
        option.textContent = formatDate(date) + ' · ' + items.length + ' compra' + (items.length === 1 ? '' : 's');
        refs.calendarDate.appendChild(option);
      });
      if (previous && groups.has(previous)) refs.calendarDate.value = previous;
    }
    refs.calendarBadge.textContent = groups.size + ' fecha' + (groups.size === 1 ? '' : 's');
    refs.exportDateBtn.disabled = !groups.size;
    refs.exportAllBtn.disabled = !groups.size;
  }

  function render(){
    const all = currentPurchases();
    const visible = visiblePurchases();
    refs.list.innerHTML = '';
    visible.forEach(function(record){ refs.list.appendChild(purchaseCard(record)); });
    updateBudget(all);
    updateToolbar(all,visible);
    updateEmpty(all,visible);
    updateCalendar(all);
  }

  function icsEscape(value){
    return String(value == null ? '' : value).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
  }
  function foldLine(line){
    const text = String(line || '');
    const chunks = [];
    let remaining = text;
    while (remaining.length > 72) { chunks.push(remaining.slice(0,72)); remaining = ' ' + remaining.slice(72); }
    chunks.push(remaining);
    return chunks.join('\r\n');
  }
  function icsDate(value){ return normalizeDate(value).replace(/-/g,''); }
  function nextDate(value){
    const d = new Date(normalizeDate(value) + 'T12:00:00');
    d.setDate(d.getDate()+1);
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('');
  }
  function utcStamp(){
    const d = new Date();
    return d.getUTCFullYear() + String(d.getUTCMonth()+1).padStart(2,'0') + String(d.getUTCDate()).padStart(2,'0') + 'T' + String(d.getUTCHours()).padStart(2,'0') + String(d.getUTCMinutes()).padStart(2,'0') + String(d.getUTCSeconds()).padStart(2,'0') + 'Z';
  }
  function calendarDescription(date, records){
    const unique = [];
    (records || []).forEach(function(item){ if (!unique.some(function(x){ return x.id === item.id; })) unique.push(item); });
    const lines = ['Compras Arcano 33', 'Fecha: ' + formatDate(date), ''];
    unique.forEach(function(record){
      const items = record.purchaseGroup && Array.isArray(record.purchaseGroup.items) ? record.purchaseGroup.items : [record.purchase];
      items.forEach(function(item){
        lines.push('- ' + item.name + ': ' + formatNumber(item.quantity) + ' ' + item.unit + ' × ' + formatMoney(item.priceUsed) + ' = ' + formatMoney(item.subtotal));
      });
      if (record.notes) lines.push('  Nota: ' + clean(record.notes,260));
    });
    const total = unique.reduce(function(sum,item){ return sum + purchaseTotal(item); },0);
    lines.push('', 'Presupuesto estimado: ' + formatMoney(total));
    return lines.join('\n');
  }
  function buildEvent(date, records){
    const stableIds = (records || []).map(function(item){ return item.id; }).sort().join('-');
    const uid = 'a33-compras-' + icsDate(date) + '-' + stableIds.length + '@arcano33';
    const lines = [
      'BEGIN:VEVENT',
      'UID:' + icsEscape(uid),
      'DTSTAMP:' + utcStamp(),
      'DTSTART;VALUE=DATE:' + icsDate(date),
      'DTEND;VALUE=DATE:' + nextDate(date),
      'SUMMARY:' + icsEscape('Compras Arcano 33'),
      'DESCRIPTION:' + icsEscape(calendarDescription(date, records)),
      'CATEGORIES:' + icsEscape('Compras,Arcano 33'),
      'STATUS:CONFIRMED',
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    ];
    return lines.map(foldLine).join('\r\n');
  }
  function buildCalendar(groups){
    const events = [];
    groups.forEach(function(records,date){ events.push(buildEvent(date,records)); });
    return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Arcano 33//Agenda Compras//ES','CALSCALE:GREGORIAN','METHOD:PUBLISH'].join('\r\n') + '\r\n' + events.join('\r\n') + '\r\nEND:VCALENDAR\r\n';
  }
  function downloadText(content, filename){
    const blob = new Blob([content], { type:'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function(){ URL.revokeObjectURL(url); }, 1200);
  }
  function exportDate(date){
    const groups = pendingGroups();
    if (!date || !groups.has(date)) {
      refs.calendarStatus.textContent = 'Selecciona una Fecha necesaria con compras pendientes.';
      return false;
    }
    const single = new Map([[date,groups.get(date)]]);
    downloadText(buildCalendar(single), 'Compras_Arcano_33_' + date.split('-').reverse().join('-') + '.ics');
    refs.calendarStatus.textContent = 'Calendario exportado: ' + formatDate(date) + ' · ' + groups.get(date).length + ' compra(s).';
    return true;
  }
  function exportAll(){
    const groups = pendingGroups();
    if (!groups.size) {
      refs.calendarStatus.textContent = 'No hay compras pendientes con Fecha necesaria para exportar.';
      return false;
    }
    downloadText(buildCalendar(groups), 'Compras_Arcano_33_Todas.ics');
    refs.calendarStatus.textContent = 'Calendario exportado con ' + groups.size + ' evento(s), uno por Fecha necesaria.';
    return true;
  }

  function openPurchase(recordId){
    if (!state.ready) return;
    loadMaterials().finally(function(){
      const id = clean(recordId,180);
      const record = id ? getRecord(id) : null;
      if (record) fillForm(record,{focus:false});
      else resetForm({focus:false});
      render();
    });
  }

  function bind(){
    refs.form.addEventListener('submit', function(event){ event.preventDefault(); upsertPurchase(); });
    refs.material.addEventListener('change', applyMaterial);
    refs.quantity.addEventListener('input', syncSubtotal);
    refs.quantity.addEventListener('change', syncSubtotal);
    refs.addBtn.addEventListener('click', function(){ addDraftItem(); });
    refs.newBtn.addEventListener('click', requestNew);
    refs.deleteBtn.addEventListener('click', function(){ if (state.currentId) removePurchase(state.currentId); });
    refs.filterButtons.forEach(function(btn){
      btn.addEventListener('click', function(){ const next = btn.dataset.purchaseFilter; state.filter = FILTERS.has(next) ? next : 'pendiente'; render(); });
    });
    refs.exportDateBtn.addEventListener('click', function(){ exportDate(refs.calendarDate.value); });
    refs.exportAllBtn.addEventListener('click', exportAll);
    [refs.material,refs.quantity,refs.date].forEach(function(el){
      el.addEventListener('input', function(){ if (el.setCustomValidity) el.setCustomValidity(''); });
      el.addEventListener('change', function(){ if (el.setCustomValidity) el.setCustomValidity(''); });
    });
    window.addEventListener('storage', function(event){ if (!event || event.key === STORAGE_KEY) render(); });
    window.addEventListener('a33:agenda-records-changed', function(event){
      if (event && event.detail && event.detail.source === 'compras') return;
      render();
    });
  }

  function bootstrap(){
    setRefs();
    if (!refs.form) return;
    bind();
    state.ready = true;
    loadMaterials().finally(function(){
      resetForm({focus:false});
      const params = new URLSearchParams(window.location.search || '');
      const requested = clean(params.get('record'),180);
      const record = requested ? getRecord(requested) : null;
      if (record) fillForm(record,{focus:false});
      render();
    });
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js?v=4.20.95&r=3').catch(function(error){
        console.warn('Agenda SW no disponible', error);
      });
    }
    window.A33AgendaPurchases = Object.freeze({
      open: openPurchase,
      reload: function(){ return loadMaterials().then(function(){ render(); }); },
      exportDate: exportDate,
      exportAll: exportAll,
      addCurrentArticle: addDraftItem,
      save: upsertPurchase,
      getState: function(){
        return {
          currentId:state.currentId,
          expandedId:state.expandedId,
          filter:state.filter,
          materials:state.materials.slice(),
          draftItems:state.draftItems.map(cloneItem),
          draftTotal:groupTotal(state.draftItems),
          purchases:currentPurchases()
        };
      },
      normalizePurchaseRecord: normalizePurchaseRecord
    });
  }

  document.addEventListener('DOMContentLoaded', bootstrap, { once:true });
})();
