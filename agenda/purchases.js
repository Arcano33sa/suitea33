(function(){
  'use strict';

  const STORAGE_KEY = 'a33_agenda_records_v1';
  const SCHEMA_VERSION = 9;
  const STATUS_LABELS = Object.freeze({ pendiente:'Pendiente', hecho:'Hecho', cancelado:'Cancelado' });
  const PRIORITY_LABELS = Object.freeze({ baja:'Baja', media:'Media', alta:'Alta' });
  const FILTERS = new Set(['pendiente','hecho','cancelado','todos']);
  const UNIT_SET = new Set(['Unidad','Cajas','Litros','Galones']);
  const state = {
    allRecords: [],
    materials: [],
    currentId: '',
    filter: 'pendiente',
    saving: false,
    ready: false
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
  function createId(){
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return 'agd_' + window.crypto.randomUUID().replace(/-/g, '').slice(0, 18);
    }
    return 'agd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
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
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
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

  function normalizePurchaseData(source){
    const record = source && typeof source === 'object' ? source : {};
    const raw = record.purchase && typeof record.purchase === 'object'
      ? record.purchase
      : (record.compra && typeof record.compra === 'object' ? record.compra : {});
    const snapshot = raw.snapshot && typeof raw.snapshot === 'object' ? raw.snapshot : {};
    const materialId = clean(raw.materialId || snapshot.materialId || raw.id, 160);
    const name = clean(raw.name || raw.materialName || snapshot.name || record.subject, 120);
    const category = clean(raw.category || snapshot.category, 80);
    const unit = normalizeUnit(raw.unit || snapshot.unit);
    const priceUsed = numberOrNull(raw.priceUsed != null ? raw.priceUsed : (raw.price != null ? raw.price : snapshot.priceUsed));
    const quantity = numberOrNull(raw.quantity);
    const calculated = priceUsed != null && quantity != null ? round2(priceUsed * quantity) : null;
    const subtotal = numberOrNull(raw.subtotal != null ? raw.subtotal : calculated);
    return {
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
        capturedAt: clean(snapshot.capturedAt || raw.capturedAt || record.createdAt || '', 80)
      }
    };
  }

  function normalizePurchaseRecord(source){
    const record = source && typeof source === 'object' ? source : {};
    const purchase = normalizePurchaseData(record);
    return {
      ...record,
      id: clean(record.id, 180) || createId(),
      subject: purchase.name || clean(record.subject, 120),
      type: 'compra',
      client: '',
      clientId: '',
      modality: '',
      date: normalizeDate(record.date || record.neededDate || record.fechaNecesaria),
      time: '',
      status: normalizeStatus(record.status),
      priority: normalizePriority(record.priority),
      notes: clean(record.notes, 1200),
      createdAt: clean(record.createdAt, 80) || new Date().toISOString(),
      updatedAt: clean(record.updatedAt || record.createdAt, 80) || new Date().toISOString(),
      pedido: record.pedido && typeof record.pedido === 'object' ? record.pedido : {
        enabled:false, productId:'', product:'', productNameSnapshot:'', price:null, priceSnapshot:null,
        quantity:null, total:null, delivery:'', productSnapshot:null, historicalOnly:false
      },
      purchase
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
        return item && clean(item.id || item.materialId,160) && clean(item.name,120) && normalizeUnit(item.unit) && numberOrNull(item.price) != null;
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
      if (!state.materials.length) {
        refs.material.disabled = true;
        refs.saveBtn.disabled = true;
        refs.formStatus.textContent = 'Agrega artículos activos en Catálogos → Materia Prima antes de registrar Compras.';
      } else if (!state.currentId) {
        refs.material.disabled = false;
        refs.saveBtn.disabled = false;
      }
    }catch(error){
      console.error('Agenda Compras · Materia Prima', error);
      state.materials = [];
      renderMaterialOptions();
      refs.materialsEmpty.hidden = false;
      refs.material.disabled = true;
      refs.saveBtn.disabled = true;
      refs.formStatus.textContent = 'No se pudo cargar Materia Prima. Revisa Catálogos y vuelve a abrir Compras.';
    }
  }

  function renderMaterialOptions(snapshot){
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
    if (snapshot && snapshot.materialId && !materialById(snapshot.materialId)) {
      const historical = document.createElement('option');
      historical.value = snapshot.materialId;
      historical.textContent = (snapshot.name || 'Artículo histórico') + ' · histórico';
      historical.dataset.historical = '1';
      refs.material.appendChild(historical);
    }
    const desired = snapshot && snapshot.materialId ? snapshot.materialId : current;
    if (desired && Array.from(refs.material.options).some(function(opt){ return opt.value === desired; })) refs.material.value = desired;
  }

  function selectedSnapshot(){
    if (state.currentId) {
      const record = getRecord(state.currentId);
      return record ? record.purchase : null;
    }
    const material = materialById(refs.material.value);
    if (!material) return null;
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
        capturedAt: new Date().toISOString()
      }
    };
  }

  function applyMaterial(snapshot){
    const data = snapshot || selectedSnapshot();
    refs.category.value = data ? data.category : '';
    refs.unit.value = data ? data.unit : '';
    refs.price.value = data ? formatMoney(data.priceUsed) : '';
    refs.quantity.step = data && (data.unit === 'Unidad' || data.unit === 'Cajas') ? '1' : '0.01';
    refs.quantity.min = data && (data.unit === 'Unidad' || data.unit === 'Cajas') ? '1' : '0.01';
    syncSubtotal();
  }

  function syncSubtotal(){
    const snapshot = selectedSnapshot();
    const quantity = numberOrNull(refs.quantity.value);
    const subtotal = snapshot && quantity != null ? round2(snapshot.priceUsed * quantity) : null;
    refs.subtotal.value = subtotal == null ? '' : formatMoney(subtotal);
    return subtotal;
  }

  function resetForm(options){
    const settings = options || {};
    state.currentId = '';
    refs.form.reset();
    refs.date.value = todayIso();
    refs.priority.value = 'media';
    refs.status.value = 'pendiente';
    refs.material.disabled = !state.materials.length;
    refs.saveBtn.disabled = !state.materials.length;
    refs.deleteBtn.hidden = true;
    refs.formTitle.textContent = 'Nueva Compra';
    refs.formBadge.textContent = 'Nuevo';
    refs.saveBtn.textContent = 'Guardar Compra';
    refs.metaId.textContent = 'Nuevo';
    refs.metaCreated.textContent = '—';
    refs.metaUpdated.textContent = '—';
    refs.formStatus.textContent = state.materials.length
      ? 'El artículo, categoría, unidad y precio se guardan como fotografía histórica.'
      : 'Agrega artículos activos en Catálogos → Materia Prima antes de registrar Compras.';
    renderMaterialOptions();
    applyMaterial(null);
    if (settings.focus !== false && !refs.material.disabled) refs.material.focus();
    render();
  }

  function fillForm(record, options){
    if (!record) return;
    const settings = options || {};
    state.currentId = record.id;
    renderMaterialOptions(record.purchase);
    refs.material.value = record.purchase.materialId;
    refs.material.disabled = true;
    refs.quantity.value = record.purchase.quantity == null ? '' : formatNumber(record.purchase.quantity);
    refs.date.value = record.date;
    refs.priority.value = record.priority;
    refs.status.value = record.status;
    refs.notes.value = record.notes || '';
    refs.deleteBtn.hidden = false;
    refs.saveBtn.disabled = false;
    refs.formTitle.textContent = 'Editar Compra';
    refs.formBadge.textContent = 'Histórico protegido';
    refs.saveBtn.textContent = 'Actualizar Compra';
    refs.metaId.textContent = record.id;
    refs.metaCreated.textContent = formatDateTime(record.createdAt);
    refs.metaUpdated.textContent = formatDateTime(record.updatedAt);
    refs.materialHelp.textContent = 'Artículo, categoría, unidad y precio histórico bloqueados. Solo edita cantidad y datos operativos.';
    applyMaterial(record.purchase);
    refs.formStatus.textContent = 'Editando sin alterar la fotografía histórica del artículo.';
    render();
    if (settings.focus !== false) refs.quantity.focus();
  }

  function validateForm(){
    [refs.material, refs.quantity, refs.date].forEach(function(el){ if (el && el.setCustomValidity) el.setCustomValidity(''); });
    const snapshot = selectedSnapshot();
    if (!snapshot || !snapshot.materialId || !snapshot.name) {
      refs.material.setCustomValidity('Selecciona un artículo activo de Materia Prima.');
      refs.material.reportValidity();
      return null;
    }
    const quantity = numberOrNull(refs.quantity.value);
    if (quantity == null || quantity <= 0) {
      refs.quantity.setCustomValidity('La cantidad debe ser mayor que cero.');
      refs.quantity.reportValidity();
      return null;
    }
    if ((snapshot.unit === 'Unidad' || snapshot.unit === 'Cajas') && !Number.isInteger(quantity)) {
      refs.quantity.setCustomValidity('Para Unidad o Cajas usa una cantidad entera.');
      refs.quantity.reportValidity();
      return null;
    }
    const date = normalizeDate(refs.date.value);
    if (!date) {
      refs.date.setCustomValidity('Selecciona la Fecha necesaria.');
      refs.date.reportValidity();
      return null;
    }
    const subtotal = round2(snapshot.priceUsed * quantity);
    return { snapshot, quantity, subtotal, date };
  }

  function upsertPurchase(){
    const validated = validateForm();
    if (!validated || state.saving) return false;
    state.saving = true;
    refs.saveBtn.disabled = true;
    const now = new Date().toISOString();
    const store = readStore();
    const records = store.records.slice();
    const index = state.currentId ? records.findIndex(function(item){ return clean(item && item.id,180) === state.currentId; }) : -1;
    const existing = index >= 0 ? normalizePurchaseRecord(records[index]) : null;
    const snapshot = existing ? existing.purchase : validated.snapshot;
    const purchase = {
      materialId: snapshot.materialId,
      name: snapshot.name,
      category: snapshot.category,
      unit: snapshot.unit,
      priceUsed: snapshot.priceUsed,
      quantity: validated.quantity,
      subtotal: round2(snapshot.priceUsed * validated.quantity),
      snapshot: {
        materialId: snapshot.materialId,
        name: snapshot.name,
        category: snapshot.category,
        unit: snapshot.unit,
        priceUsed: snapshot.priceUsed,
        capturedAt: existing && existing.purchase.snapshot.capturedAt ? existing.purchase.snapshot.capturedAt : now
      }
    };
    const record = normalizePurchaseRecord({
      ...(existing || {}),
      id: existing ? existing.id : createId(),
      subject: purchase.name,
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
      purchase
    });
    if (index >= 0) records[index] = record;
    else records.unshift(record);
    saveAllRecords(records);
    state.currentId = record.id;
    refs.formStatus.textContent = existing ? 'Compra actualizada correctamente.' : 'Compra guardada correctamente.';
    fillForm(record, { focus:false });
    window.setTimeout(function(){ state.saving = false; refs.saveBtn.disabled = false; }, 450);
    return true;
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
    if (state.currentId === id) resetForm({ focus:false });
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

  function purchaseCard(record){
    const article = document.createElement('article');
    article.className = 'agenda-record purchase-record' + (record.id === state.currentId ? ' is-active' : '');
    article.dataset.recordId = record.id;
    article.tabIndex = 0;
    const top = document.createElement('div');
    top.className = 'agenda-record-top';
    const copy = document.createElement('div');
    copy.className = 'agenda-record-copy';
    const title = document.createElement('h3');
    title.textContent = record.purchase.name || '(Artículo histórico)';
    const meta = document.createElement('div');
    meta.className = 'agenda-record-meta';
    meta.innerHTML = [
      '<span class="agenda-status agenda-status--' + record.status + '">' + escapeHtml(STATUS_LABELS[record.status]) + '</span>',
      '<span class="agenda-chip agenda-chip--priority-' + record.priority + '">' + escapeHtml(PRIORITY_LABELS[record.priority]) + '</span>',
      '<span class="agenda-date-pill">' + escapeHtml(formatDate(record.date)) + '</span>',
      '<span class="agenda-chip">' + escapeHtml(formatNumber(record.purchase.quantity) + ' ' + record.purchase.unit) + '</span>',
      '<span class="agenda-chip purchase-money-chip">' + escapeHtml(formatMoney(record.purchase.subtotal)) + '</span>'
    ].join('');
    copy.append(title, meta);
    const actions = document.createElement('div');
    actions.className = 'agenda-record-actions';
    const main = document.createElement('div');
    main.className = 'agenda-record-actions-group';
    main.appendChild(button('Editar', 'agenda-inline-btn', 'Editar compra', function(){ fillForm(record); }));
    if (record.status === 'pendiente') {
      main.appendChild(button('Hecho', 'agenda-inline-btn agenda-inline-btn--done', 'Marcar compra como Hecho', function(){ updateStatus(record.id,'hecho'); }));
      main.appendChild(button('Cancelar', 'agenda-inline-btn agenda-inline-btn--cancel', 'Cancelar compra', function(){ updateStatus(record.id,'cancelado'); }));
    } else {
      main.appendChild(button('Pendiente', 'agenda-inline-btn agenda-inline-btn--status', 'Reactivar como Pendiente', function(){ updateStatus(record.id,'pendiente'); }));
    }
    const destructive = document.createElement('div');
    destructive.className = 'agenda-record-actions-group';
    destructive.appendChild(button('Borrar', 'agenda-inline-btn agenda-inline-btn--danger', 'Borrar compra', function(){ removePurchase(record.id); }));
    actions.append(main, destructive);
    top.append(copy, actions);

    const details = document.createElement('div');
    details.className = 'purchase-record-details';
    details.innerHTML = [
      '<span><b>Categoría:</b> ' + escapeHtml(record.purchase.category || '—') + '</span>',
      '<span><b>Precio:</b> ' + escapeHtml(formatMoney(record.purchase.priceUsed)) + '</span>',
      '<span><b>Subtotal:</b> ' + escapeHtml(formatMoney(record.purchase.subtotal)) + '</span>',
      '<span><b>Fecha necesaria:</b> ' + escapeHtml(formatDate(record.date)) + '</span>'
    ].join('');
    if (record.notes) {
      const notes = document.createElement('p');
      notes.className = 'agenda-record-preview';
      notes.textContent = record.notes;
      details.appendChild(notes);
    }
    const foot = document.createElement('div');
    foot.className = 'agenda-record-foot';
    foot.innerHTML = '<span>Creado: ' + escapeHtml(formatDateTime(record.createdAt)) + '</span><span>Actualizado: ' + escapeHtml(formatDateTime(record.updatedAt)) + '</span>';
    article.append(top, details, foot);
    article.addEventListener('click', function(){ fillForm(record); });
    article.addEventListener('keydown', function(event){ if (event.key === 'Enter' || event.key === ' '){ event.preventDefault(); fillForm(record); } });
    return article;
  }

  function updateBudget(records){
    const rows = Array.isArray(records) ? records : currentPurchases();
    const pending = rows.filter(function(item){ return item.status === 'pendiente'; });
    const done = rows.filter(function(item){ return item.status === 'hecho'; });
    refs.pendingBudget.textContent = formatMoney(pending.reduce(function(sum,item){ return sum + Number(item.purchase.subtotal || 0); },0));
    refs.boughtTotal.textContent = formatMoney(done.reduce(function(sum,item){ return sum + Number(item.purchase.subtotal || 0); },0));
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
    unique.forEach(function(item){
      let line = '- ' + item.purchase.name + ': ' + formatNumber(item.purchase.quantity) + ' ' + item.purchase.unit + ' × ' + formatMoney(item.purchase.priceUsed) + ' = ' + formatMoney(item.purchase.subtotal);
      if (item.notes) line += ' | Nota: ' + clean(item.notes,260);
      lines.push(line);
    });
    const total = unique.reduce(function(sum,item){ return sum + Number(item.purchase.subtotal || 0); },0);
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
    refs.material.addEventListener('change', function(){ applyMaterial(null); });
    refs.quantity.addEventListener('input', syncSubtotal);
    refs.quantity.addEventListener('change', syncSubtotal);
    refs.newBtn.addEventListener('click', function(){ resetForm(); });
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
      navigator.serviceWorker.register('./sw.js?v=4.20.95&r=1').catch(function(error){
        console.warn('Agenda SW no disponible', error);
      });
    }
    window.A33AgendaPurchases = Object.freeze({
      open: openPurchase,
      reload: function(){ return loadMaterials().then(function(){ render(); }); },
      exportDate: exportDate,
      exportAll: exportAll,
      getState: function(){ return { currentId:state.currentId, filter:state.filter, materials:state.materials.slice(), purchases:currentPurchases() }; },
      normalizePurchaseRecord: normalizePurchaseRecord
    });
  }

  document.addEventListener('DOMContentLoaded', bootstrap, { once:true });
})();
