(function(){
  'use strict';

  const AGENDA_BOOT = Object.freeze({
    module: 'Agenda',
    storageNamespace: 'a33_agenda_',
    storageKey: 'a33_agenda_records_v1',
    isolated: true,
    schemaVersion: 9
  });

  const TYPE_LABELS = Object.freeze({
    reunion: 'Reunión',
    tarea: 'Tarea',
    compra: 'Compra'
  });

  const SECTION_COPY = Object.freeze({
    reunion: {
      title: 'Reunión',
      plural: 'Reuniones',
      lead: 'Organiza reuniones, clientes, horarios y modalidades.',
      eyebrow: 'Flujo de Reunión',
      subjectLabel: 'Asunto',
      helper: 'Reunión conserva Cliente, Modalidad y Pedido relacionado cuando corresponda.'
    },
    tarea: {
      title: 'Tarea',
      plural: 'Tareas',
      lead: 'Registra actividades, pendientes, fechas y prioridades.',
      eyebrow: 'Flujo de Tarea',
      subjectLabel: 'Título o descripción',
      helper: 'Tarea funciona de forma independiente, sin Cliente y sin bloque Pedido.'
    },
    compra: {
      title: 'Compras',
      plural: 'Compras',
      lead: 'Planifica los materiales y artículos que necesitas adquirir.'
    }
  });

  const STATUS_LABELS = Object.freeze({
    pendiente: 'Pendiente',
    hecho: 'Hecho',
    cancelado: 'Cancelado'
  });

  const FILTER_LABELS = Object.freeze({
    pendiente: 'Pendientes',
    hecho: 'Hechos',
    cancelado: 'Cancelados',
    todos: 'Todos'
  });

  const PRIORITY_LABELS = Object.freeze({
    baja: 'Baja',
    media: 'Media',
    alta: 'Alta'
  });

  const MODALITY_LABELS = Object.freeze({
    presencial: 'Presencial',
    llamada: 'Llamada',
    videollamada: 'Videollamada'
  });

  const LEGACY_STATUS_MAP = Object.freeze({
    en_curso: 'pendiente',
    cerrado: 'hecho'
  });

  const EMPTY_MODE = 'Sin registros';

  const POS_PRODUCT_DB = Object.freeze({
    name: 'a33-pos',
    store: 'products'
  });

  const POS_CUSTOMER_CATALOG_KEY = 'a33_pos_customersCatalog';
  const CLIENT_SELECT_NEW_VALUE = '__new__';

  const state = {
    records: [],
    currentId: null,
    activeSection: 'home',
    activeFilter: 'pendiente',
    productCatalog: [],
    productCatalogSource: 'empty',
    clientCatalog: [],
    clientCatalogSource: 'pos'
  };

  const refs = {};

  function getStorage(){
    return window.localStorage;
  }

  function safeParse(json){
    try {
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function createId(){
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return 'agd_' + window.crypto.randomUUID().replace(/-/g, '').slice(0, 18);
    }
    return 'agd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function todayIso(){
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  function normalizeDate(value){
    const raw = String(value || '').trim();
    if (!raw) return '';
    const short = raw.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(short) ? short : '';
  }

  function normalizeTime(value){
    const raw = String(value || '').trim();
    if (!raw) return '';
    const short = raw.slice(0, 5);
    return /^\d{2}:\d{2}$/.test(short) ? short : '';
  }

  function normalizeStatus(value){
    const raw = String(value || '').trim().toLowerCase();
    const mapped = LEGACY_STATUS_MAP[raw] || raw;
    return STATUS_LABELS[mapped] ? mapped : 'pendiente';
  }

  function normalizeType(value){
    const raw = String(value || '').trim().toLowerCase();
    return TYPE_LABELS[raw] ? raw : 'tarea';
  }

  function getActiveRecordType(){
    return state.activeSection === 'tarea' ? 'tarea' : 'reunion';
  }

  function isOperationalSection(value){
    return value === 'reunion' || value === 'tarea';
  }

  function normalizePriority(value){
    const raw = String(value || '').trim().toLowerCase();
    return PRIORITY_LABELS[raw] ? raw : 'media';
  }

  function normalizeModality(value){
    const raw = String(value || '').trim().toLowerCase();
    return MODALITY_LABELS[raw] ? raw : 'presencial';
  }

  function round2(value){
    return Math.round(Number(value) * 100) / 100;
  }

  function parseNumber(value){
    if (value === '' || value == null) return null;
    const normalized = String(value).trim().replace(/,/g, '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;
    return round2(parsed);
  }

  function normalizeNumberInput(value){
    const parsed = parseNumber(value);
    return parsed == null || parsed < 0 ? null : parsed;
  }

  function formatMoney(value, fallback){
    if (value == null || !Number.isFinite(Number(value))) return fallback || '—';
    try {
      return new Intl.NumberFormat('es-NI', {
        style: 'currency',
        currency: 'NIO',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(Number(value));
    } catch (_) {
      return 'C$' + Number(value).toFixed(2);
    }
  }

  function formatNumberPlain(value, fallback){
    if (value == null || !Number.isFinite(Number(value))) return fallback || '';
    const normalized = round2(value);
    return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(2);
  }

  function normalizeProductKey(value){
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function agendaProductId(item){
    const source = item && typeof item === 'object' ? item : {};
    try{
      if (window.A33Products && typeof window.A33Products.getProductId === 'function'){
        return String(window.A33Products.getProductId(source) || '').trim();
      }
    }catch(_){ }
    return String(source.productId ?? source.productoId ?? source.catalogProductId ?? '').trim();
  }

  function sanitizeProductCatalogItem(item){
    const source = item && typeof item === 'object' ? item : {};
    const productId = agendaProductId(source);
    const name = String(source.name || source.nombre || '').replace(/\s+/g, ' ').trim();
    const price = normalizeNumberInput(source.price ?? source.precio ?? source.unitPrice ?? source.precioVenta);
    const active = source.active !== false && source.deleted !== true;
    const internalId = Number(source.id);

    if (!productId || !name || !active) return null;

    return {
      id: productId,
      productId,
      internalId: Number.isFinite(internalId) && internalId > 0 ? internalId : null,
      name,
      price: price == null ? 0 : price,
      active,
      manageStock: source.manageStock !== false,
      createdAt: source.createdAt || '',
      updatedAt: source.updatedAt || ''
    };
  }

  function normalizeProductCatalog(list){
    const items = Array.isArray(list) ? list : [];
    const byProductId = new Map();

    items.forEach(function(raw){
      const item = sanitizeProductCatalogItem(raw);
      if (!item || byProductId.has(item.productId)) return;
      byProductId.set(item.productId, item);
    });

    const normalized = Array.from(byProductId.values());
    const counts = new Map();
    normalized.forEach(function(item){
      const key = normalizeProductKey(item.name);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    normalized.forEach(function(item){
      const key = normalizeProductKey(item.name);
      item.displayName = (counts.get(key) || 0) > 1
        ? item.name + ' · ' + item.productId.slice(-6)
        : item.name;
    });
    return normalized.sort(function(a, b){
      const byName = a.name.localeCompare(b.name, 'es', { sensitivity:'base' });
      return byName || a.productId.localeCompare(b.productId);
    });
  }

  function openPosProductDbReadOnly(){
    return new Promise(function(resolve, reject){
      if (!window.indexedDB || typeof window.indexedDB.open !== 'function') {
        reject(new Error('indexeddb_unavailable'));
        return;
      }

      let request;
      let abortedByUpgrade = false;

      try {
        request = window.indexedDB.open(POS_PRODUCT_DB.name);
      } catch (error) {
        reject(error);
        return;
      }

      request.onupgradeneeded = function(){
        abortedByUpgrade = true;
        try {
          request.transaction.abort();
        } catch (_) {}
      };

      request.onerror = function(){
        reject(request.error || new Error('pos_catalog_open_failed'));
      };

      request.onsuccess = function(){
        const db = request.result;
        if (abortedByUpgrade || !db.objectStoreNames.contains(POS_PRODUCT_DB.store)) {
          try { db.close(); } catch (_) {}
          reject(new Error('products_store_missing'));
          return;
        }
        resolve(db);
      };
    });
  }

  function readProductCatalogFromPOS(){
    try{
      if (window.A33Products && typeof window.A33Products.getAll === 'function'){
        return window.A33Products.getAll().then(normalizeProductCatalog);
      }
    }catch(_){ }
    return openPosProductDbReadOnly().then(function(db){
      return new Promise(function(resolve, reject){
        let settled = false;

        function finish(handler, value){
          if (settled) return;
          settled = true;
          try { db.close(); } catch (_) {}
          handler(value);
        }

        let tx;
        let request;

        try {
          tx = db.transaction(POS_PRODUCT_DB.store, 'readonly');
          request = tx.objectStore(POS_PRODUCT_DB.store).getAll();
        } catch (error) {
          finish(reject, error);
          return;
        }

        request.onsuccess = function(){
          finish(resolve, normalizeProductCatalog(request.result));
        };

        request.onerror = function(){
          finish(reject, request.error || new Error('products_read_failed'));
        };

        tx.onabort = function(){
          finish(reject, tx.error || new Error('products_tx_aborted'));
        };
      });
    });
  }

  function sanitizeCustomerDisplay(value){
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeCustomerKey(value){
    let s = sanitizeCustomerDisplay(value);
    try { if (s.normalize) s = s.normalize('NFD'); } catch (_) {}
    return s.replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function sortCustomerObjectsAZ(list){
    return (Array.isArray(list) ? list : [])
      .slice()
      .sort(function(a, b){
        return normalizeCustomerKey(a && a.name).localeCompare(normalizeCustomerKey(b && b.name), 'es');
      });
  }

  function generateCustomerId(existingIds){
    const used = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
    let id = '';
    for (let i = 0; i < 6; i += 1) {
      id = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
      if (!used.has(id)) break;
    }
    return id || ('c_' + Date.now().toString(36));
  }

  function coerceCustomerCatalogItem(item, existingIds){
    if (typeof item === 'string') {
      const name = sanitizeCustomerDisplay(item);
      if (!name) return null;
      const normalizedName = normalizeCustomerKey(name);
      if (!normalizedName) return null;
      const id = generateCustomerId(existingIds);
      existingIds.add(id);
      return {
        id,
        name,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: null,
        normalizedName,
        celular: '',
        telefono: '',
        whatsapp: '',
        correo: '',
        direccion: '',
        notas: '',
        aliases: [],
        nameHistory: [],
        mergedIntoId: null,
        mergedAt: null,
        mergeReason: '',
        mergeHistory: []
      };
    }

    if (!item || typeof item !== 'object') return null;

    const name = sanitizeCustomerDisplay(item.name || item.customerName || item.customer || '');
    if (!name) return null;

    const normalizedName = normalizeCustomerKey(item.normalizedName || name);
    if (!normalizedName) return null;

    let id = item.id != null ? String(item.id).trim() : '';
    if (!id || existingIds.has(id)) {
      id = generateCustomerId(existingIds);
    }
    existingIds.add(id);

    const aliases = Array.isArray(item.aliases)
      ? item.aliases.map(sanitizeCustomerDisplay).filter(Boolean)
      : [];

    const nameHistory = Array.isArray(item.nameHistory)
      ? item.nameHistory.map(function(entry){
          if (!entry || typeof entry !== 'object') return null;
          const from = sanitizeCustomerDisplay(entry.from || '');
          const to = sanitizeCustomerDisplay(entry.to || '');
          const at = Number(entry.at);
          const reason = sanitizeCustomerDisplay(entry.reason || '');
          if (!from && !to) return null;
          return {
            from,
            to,
            at: Number.isFinite(at) && at > 0 ? at : null,
            reason
          };
        }).filter(Boolean)
      : [];

    const mergeHistory = Array.isArray(item.mergeHistory)
      ? item.mergeHistory.map(function(entry){
          if (!entry || typeof entry !== 'object') return null;
          const fromId = entry.fromId != null ? String(entry.fromId).trim() : '';
          const fromName = sanitizeCustomerDisplay(entry.fromName || '');
          const at = Number(entry.at);
          const reason = sanitizeCustomerDisplay(entry.reason || '');
          if (!fromId && !fromName) return null;
          return {
            fromId,
            fromName,
            at: Number.isFinite(at) && at > 0 ? at : null,
            reason
          };
        }).filter(Boolean)
      : [];

    const createdAt = Number(item.createdAt);
    const updatedAt = Number(item.updatedAt);
    const mergedAt = Number(item.mergedAt);

    const celular = sanitizeCustomerDisplay(item.celular || item.cellular || item.mobile || item.movil || item.whatsapp || item.wa || item.whatsApp || item.telefono || item.phone || item.telefonoCliente || '');

    return {
      ...item,
      id,
      name,
      nombre: sanitizeCustomerDisplay(item.nombre || name),
      celular,
      telefono: celular,
      whatsapp: '',
      correo: sanitizeCustomerDisplay(item.correo || item.email || item.mail || ''),
      direccion: sanitizeCustomerDisplay(item.direccion || item.address || ''),
      notas: String(item.notas || item.notes || '').trim(),
      isActive: item.isActive !== false && item.active !== false,
      active: item.isActive !== false && item.active !== false,
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : null,
      normalizedName,
      aliases,
      nameHistory,
      mergedIntoId: item.mergedIntoId != null && String(item.mergedIntoId).trim() ? String(item.mergedIntoId).trim() : null,
      mergedAt: Number.isFinite(mergedAt) && mergedAt > 0 ? mergedAt : null,
      mergeReason: sanitizeCustomerDisplay(item.mergeReason || ''),
      mergeHistory
    };
  }

  function normalizeCustomerCatalog(list){
    const items = Array.isArray(list) ? list : [];
    const existingIds = new Set();
    return sortCustomerObjectsAZ(items.map(function(item){
      return coerceCustomerCatalogItem(item, existingIds);
    }).filter(Boolean));
  }

  function collectCustomerAllNames(customer){
    const output = [];
    if (!customer) return output;
    if (customer.name) output.push(String(customer.name));
    if (Array.isArray(customer.aliases)) output.push.apply(output, customer.aliases);
    if (Array.isArray(customer.nameHistory)) {
      customer.nameHistory.forEach(function(entry){
        if (!entry || typeof entry !== 'object') return;
        if (entry.from) output.push(String(entry.from));
        if (entry.to) output.push(String(entry.to));
      });
    }
    return output.map(sanitizeCustomerDisplay).filter(Boolean);
  }

  function resolveFinalCustomerId(id, byId){
    let current = id != null ? String(id).trim() : '';
    const seen = new Set();
    while (current) {
      if (seen.has(current)) break;
      seen.add(current);
      const customer = byId.get(current);
      if (!customer) break;
      const next = customer.mergedIntoId != null ? String(customer.mergedIntoId).trim() : '';
      if (!next) break;
      current = next;
    }
    return current;
  }

  function buildCustomerResolver(catalog){
    const list = Array.isArray(catalog) ? catalog : [];
    const byId = new Map();
    list.forEach(function(customer){
      if (!customer || customer.id == null) return;
      const id = String(customer.id).trim();
      if (!id) return;
      byId.set(id, customer);
    });

    const keyToFinalId = new Map();
    const ambiguous = new Set();

    function addKey(key, finalId){
      if (!key) return;
      if (ambiguous.has(key)) return;
      const previous = keyToFinalId.get(key);
      if (previous && previous !== finalId) {
        keyToFinalId.delete(key);
        ambiguous.add(key);
        return;
      }
      keyToFinalId.set(key, finalId);
    }

    list.forEach(function(customer){
      if (!customer || customer.id == null) return;
      const finalId = resolveFinalCustomerId(customer.id, byId);
      collectCustomerAllNames(customer).forEach(function(name){
        addKey(normalizeCustomerKey(name), finalId);
      });
    });

    return {
      byId,
      resolveFinalId: function(id){
        return resolveFinalCustomerId(id, byId);
      },
      matchNameToFinalId: function(name){
        const key = normalizeCustomerKey(name);
        return key ? keyToFinalId.get(key) || '' : '';
      },
      getDisplayName: function(id){
        const customer = byId.get(String(id || '').trim());
        return customer ? sanitizeCustomerDisplay(customer.name) : '';
      },
      keyToFinalId,
      ambiguous
    };
  }

  function readCustomerCatalogFromStorage(){
    let raw = [];
    try {
      if (window.A33Storage && typeof window.A33Storage.sharedGet === 'function') {
        raw = window.A33Storage.sharedGet(POS_CUSTOMER_CATALOG_KEY, [], 'local');
      } else if (window.A33Storage && typeof window.A33Storage.getJSON === 'function') {
        raw = window.A33Storage.getJSON(POS_CUSTOMER_CATALOG_KEY, [], 'local');
      } else {
        raw = safeParse(getStorage().getItem(POS_CUSTOMER_CATALOG_KEY)) || [];
      }
    } catch (_) {
      raw = [];
    }
    return normalizeCustomerCatalog(raw);
  }

  function mergeCustomerCatalogByIdKeep(currentList, nextList){
    const map = new Map();
    const order = [];

    function add(item){
      if (!item || item.id == null) return;
      const id = String(item.id).trim();
      if (!id) return;
      if (!map.has(id)) order.push(id);
      map.set(id, item);
    }

    (Array.isArray(currentList) ? currentList : []).forEach(add);
    (Array.isArray(nextList) ? nextList : []).forEach(add);

    return order.map(function(id){
      return map.get(id);
    }).filter(Boolean);
  }

  function saveCustomerCatalogToStorage(list){
    const safe = normalizeCustomerCatalog(list);

    try {
      if (window.A33Storage && typeof window.A33Storage.sharedRead === 'function' && typeof window.A33Storage.sharedSet === 'function') {
        const current = window.A33Storage.sharedRead(POS_CUSTOMER_CATALOG_KEY, [], 'local');
        const currentData = normalizeCustomerCatalog(current && current.data);
        const baseRev = current && current.meta && typeof current.meta.rev === 'number' ? current.meta.rev : null;
        const merged = sortCustomerObjectsAZ(mergeCustomerCatalogByIdKeep(currentData, safe));
        const result = window.A33Storage.sharedSet(POS_CUSTOMER_CATALOG_KEY, merged, {
          source: 'agenda',
          baseRev: baseRev
        });
        return !!(result && result.ok);
      }

      if (window.A33Storage && typeof window.A33Storage.sharedSet === 'function') {
        const result = window.A33Storage.sharedSet(POS_CUSTOMER_CATALOG_KEY, safe, { source: 'agenda' });
        return !!(result && result.ok);
      }

      if (window.A33Storage && typeof window.A33Storage.setJSON === 'function') {
        return window.A33Storage.setJSON(POS_CUSTOMER_CATALOG_KEY, safe, 'local');
      }

      getStorage().setItem(POS_CUSTOMER_CATALOG_KEY, JSON.stringify(safe));
      return true;
    } catch (_) {
      return false;
    }
  }

  function getSelectableClientCatalog(catalog){
    const fullCatalog = Array.isArray(catalog) ? catalog : [];
    const resolver = buildCustomerResolver(fullCatalog);
    const finalIds = new Set();
    const output = [];

    const seenNames = new Set();
    fullCatalog.forEach(function(customer){
      if (!customer || customer.isActive === false) return;
      const ownId = String(customer.id || '').trim();
      if (!ownId) return;
      const finalId = resolver.resolveFinalId(ownId);
      if (!finalId || finalId !== ownId) return;
      if (finalIds.has(finalId)) return;
      const displayName = resolver.getDisplayName(finalId) || customer.name;
      const nameKey = normalizeCustomerKey(displayName);
      if (nameKey && seenNames.has(nameKey)) return;
      finalIds.add(finalId);
      if (nameKey) seenNames.add(nameKey);
      output.push({
        ...customer,
        id: finalId,
        name: displayName
      });
    });

    return sortCustomerObjectsAZ(output);
  }

  function loadClientCatalog(){
    const rawCatalog = readCustomerCatalogFromStorage();
    state.clientCatalog = getSelectableClientCatalog(rawCatalog);
    state.clientCatalogSource = rawCatalog.length ? 'pos' : 'empty';
    renderClientOptions();
  }

  function getSelectedClientOption(){
    if (!refs.clientSelect) return null;
    if (refs.clientSelect.selectedOptions && refs.clientSelect.selectedOptions.length) {
      return refs.clientSelect.selectedOptions[0];
    }
    const index = refs.clientSelect.selectedIndex;
    return index >= 0 ? refs.clientSelect.options[index] : null;
  }

  function getSelectedClientData(){
    const option = getSelectedClientOption();
    if (!option || !option.value || option.value === CLIENT_SELECT_NEW_VALUE) return null;
    const rawValue = String(option.value || '').trim();
    const isLegacy = rawValue.indexOf('legacy:') === 0;
    return {
      id: isLegacy ? '' : rawValue,
      name: sanitizeCustomerDisplay(option.dataset.clientName || option.textContent || ''),
      isLegacy
    };
  }

  function setClientValue(name, clientId){
    if (!refs.client) return;
    refs.client.value = sanitizeCustomerDisplay(name);
    if (!refs.client.dataset) return;
    if (clientId) {
      refs.client.dataset.clientId = String(clientId).trim();
    } else {
      delete refs.client.dataset.clientId;
    }
  }

  function getClientIdHint(){
    if (!refs.client || !refs.client.dataset) return '';
    return String(refs.client.dataset.clientId || '').trim();
  }

  function setClientCreationMode(enabled, options){
    const settings = options || {};
    const isOn = enabled === true;
    if (refs.clientNewWrap) refs.clientNewWrap.hidden = !isOn;
    if (refs.clientNew) refs.clientNew.disabled = !isOn;
    if (!isOn && refs.clientNew && settings.preserveValue !== true) {
      refs.clientNew.value = '';
    }
  }

  function renderClientOptions(options){
    if (!refs.clientSelect) return;
    const settings = options || {};
    const selectedId = settings.selectedId != null ? String(settings.selectedId).trim() : getClientIdHint();
    const selectedName = sanitizeCustomerDisplay(settings.selectedName || refs.client.value || '');
    const creatingNew = settings.creatingNew === true;
    const selectedNameKey = normalizeCustomerKey(selectedName);

    refs.clientSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.clientCatalog.length ? 'Selecciona un cliente' : 'No hay clientes todavía';
    refs.clientSelect.appendChild(placeholder);

    let matchedValue = '';

    state.clientCatalog.forEach(function(customer){
      const option = document.createElement('option');
      option.value = String(customer.id);
      option.textContent = customer.name;
      option.dataset.clientName = customer.name;
      refs.clientSelect.appendChild(option);

      if (!matchedValue && selectedId && option.value === selectedId) {
        matchedValue = option.value;
      }

      if (!matchedValue && selectedNameKey && normalizeCustomerKey(customer.name) === selectedNameKey) {
        matchedValue = option.value;
      }
    });

    if (!matchedValue && selectedName && !creatingNew) {
      const legacyOption = document.createElement('option');
      legacyOption.value = selectedId || ('legacy:' + selectedNameKey);
      legacyOption.textContent = selectedName + ' · Guardado';
      legacyOption.dataset.clientName = selectedName;
      refs.clientSelect.appendChild(legacyOption);
      matchedValue = legacyOption.value;
    }

    const newOption = document.createElement('option');
    newOption.value = CLIENT_SELECT_NEW_VALUE;
    newOption.textContent = '+ Agregar nuevo cliente…';
    refs.clientSelect.appendChild(newOption);

    refs.clientSelect.value = creatingNew ? CLIENT_SELECT_NEW_VALUE : (matchedValue || '');
  }

  function syncClientValueFromUI(options){
    const settings = options || {};
    const creatingNew = refs.clientSelect && refs.clientSelect.value === CLIENT_SELECT_NEW_VALUE;
    setClientCreationMode(creatingNew, { preserveValue: settings.preserveNewValue === true });

    if (creatingNew) {
      setClientValue(refs.clientNew ? refs.clientNew.value : '', '');
      return;
    }

    const selected = getSelectedClientData();
    if (selected) {
      setClientValue(selected.name, selected.id);
      return;
    }

    setClientValue('', '');
  }

  function applyClientSnapshot(snapshot){
    const clientId = snapshot && snapshot.clientId != null ? String(snapshot.clientId).trim() : '';
    const clientName = sanitizeCustomerDisplay(snapshot && snapshot.client ? snapshot.client : '');
    renderClientOptions({
      selectedId: clientId,
      selectedName: clientName
    });
    setClientCreationMode(false);
    syncClientValueFromUI();
  }

  function ensureCustomerInCatalog(name, preferredId){
    const typedName = sanitizeCustomerDisplay(name);
    if (!typedName) return { ok: false, reason: 'empty', id: '', displayName: '' };

    const catalog = readCustomerCatalogFromStorage();
    const resolver = buildCustomerResolver(catalog);
    const matchFinalId = resolver.matchNameToFinalId(typedName);

    if (matchFinalId) {
      const existing = resolver.byId.get(String(matchFinalId));
      if (!existing) {
        return { ok: true, id: String(matchFinalId), displayName: typedName };
      }

      let changed = false;

      if (existing.isActive === false) {
        existing.isActive = true;
        existing.updatedAt = Date.now();
        changed = true;
      }

      const typedKey = normalizeCustomerKey(typedName);
      const mainKey = normalizeCustomerKey(existing.name);
      if (typedKey && mainKey && typedKey !== mainKey) {
        if (!Array.isArray(existing.aliases)) existing.aliases = [];
        const hasAlias = existing.aliases.some(function(alias){
          return normalizeCustomerKey(alias) === typedKey;
        });
        if (!hasAlias) {
          existing.aliases.push(typedName);
          existing.updatedAt = Date.now();
          changed = true;
        }
      }

      if (changed && !saveCustomerCatalogToStorage(catalog)) {
        return { ok: false, reason: 'save_failed', id: '', displayName: '' };
      }

      return {
        ok: true,
        id: String(existing.id),
        displayName: sanitizeCustomerDisplay(existing.name),
        isNew: false
      };
    }

    const existingIds = new Set(catalog.map(function(customer){
      return customer && customer.id ? String(customer.id) : '';
    }).filter(Boolean));

    let clientId = preferredId != null ? String(preferredId).trim() : '';
    if (!clientId || existingIds.has(clientId)) {
      clientId = generateCustomerId(existingIds);
    }

    catalog.push({
      id: clientId,
      name: typedName,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: null,
      normalizedName: normalizeCustomerKey(typedName),
      celular: '',
      telefono: '',
      whatsapp: '',
      correo: '',
      direccion: '',
      notas: '',
      aliases: [],
      nameHistory: [],
      mergedIntoId: null,
      mergedAt: null,
      mergeReason: '',
      mergeHistory: []
    });

    if (!saveCustomerCatalogToStorage(catalog)) {
      return { ok: false, reason: 'save_failed', id: '', displayName: '' };
    }

    return {
      ok: true,
      id: clientId,
      displayName: typedName,
      isNew: true
    };
  }

  function finalizeClientSelection(){
    syncClientValueFromUI({ preserveNewValue: true });

    if (refs.clientSelect && refs.clientSelect.value === CLIENT_SELECT_NEW_VALUE) {
      const newName = sanitizeCustomerDisplay(refs.clientNew ? refs.clientNew.value : '');
      if (!newName) return { ok: false, reason: 'missing_new', control: refs.clientNew };

      const ensured = ensureCustomerInCatalog(newName);
      if (!ensured.ok) return { ok: false, reason: ensured.reason || 'save_failed', control: refs.clientNew };

      loadClientCatalog();
      applyClientSnapshot({ clientId: ensured.id, client: ensured.displayName });
      return { ok: true, id: ensured.id, displayName: ensured.displayName };
    }

    const selected = getSelectedClientData();
    if (selected) {
      setClientValue(selected.name, selected.id);
      return { ok: true, id: selected.id, displayName: selected.name };
    }

    const legacyName = sanitizeCustomerDisplay(refs.client ? refs.client.value : '');
    const legacyId = getClientIdHint();
    if (legacyName) {
      return { ok: true, id: legacyId, displayName: legacyName };
    }

    return { ok: false, reason: 'missing', control: refs.clientSelect };
  }

  function getSelectedPedidoProductOption(){
    if (!refs.pedidoProduct) return null;
    if (refs.pedidoProduct.selectedOptions && refs.pedidoProduct.selectedOptions.length) {
      return refs.pedidoProduct.selectedOptions[0];
    }
    const index = refs.pedidoProduct.selectedIndex;
    return index >= 0 ? refs.pedidoProduct.options[index] : null;
  }

  function getSelectedPedidoProductData(){
    const option = getSelectedPedidoProductOption();
    if (!option || !option.value) return null;

    return {
      id: String(option.dataset.productId || '').trim(),
      name: String(option.dataset.productName || option.textContent || '').trim(),
      price: normalizeNumberInput(option.dataset.productPrice),
      internalId: normalizeNumberInput(option.dataset.internalId),
      historicalOnly: option.dataset.historical === '1'
    };
  }

  function renderPedidoProductOptions(options){
    const settings = options || {};
    const selectedId = settings.selectedId != null ? String(settings.selectedId).trim() : String(refs.pedidoProduct.value || '').trim();
    const selectedName = String(settings.selectedName || '').replace(/\s+/g, ' ').trim();
    const selectedPrice = normalizeNumberInput(settings.selectedPrice);
    const preserveHistorical = settings.preserveHistorical === true;

    refs.pedidoProduct.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.productCatalog.length
      ? 'Selecciona un producto'
      : 'No hay productos activos. Créelos en Catálogos → Productos';
    refs.pedidoProduct.appendChild(placeholder);

    let matchedValue = '';
    const current = selectedId ? state.productCatalog.find(function(item){ return item.productId === selectedId; }) : null;
    const snapshotDiffers = !!(current && preserveHistorical && selectedName && (
      normalizeProductKey(current.name) !== normalizeProductKey(selectedName)
      || (selectedPrice != null && Math.abs(Number(current.price || 0) - selectedPrice) > 0.000001)
    ));

    state.productCatalog.forEach(function(item){
      const option = document.createElement('option');
      option.value = String(item.productId);
      option.textContent = (item.displayName || item.name) + ' · ' + formatMoney(item.price);
      option.dataset.productId = item.productId;
      option.dataset.internalId = item.internalId == null ? '' : String(item.internalId);
      option.dataset.productName = item.name;
      option.dataset.productPrice = formatNumberPlain(item.price);
      refs.pedidoProduct.appendChild(option);

      if (!snapshotDiffers && !matchedValue && selectedId && option.value === selectedId) matchedValue = option.value;
    });

    if (preserveHistorical && selectedName && (!current || snapshotDiffers)) {
      const legacyOption = document.createElement('option');
      legacyOption.value = 'historical:' + (selectedId || normalizeProductKey(selectedName));
      legacyOption.textContent = selectedName + ' · Guardado';
      legacyOption.dataset.productId = selectedId;
      legacyOption.dataset.productName = selectedName;
      legacyOption.dataset.historical = '1';
      if (selectedPrice != null) legacyOption.dataset.productPrice = formatNumberPlain(selectedPrice);
      refs.pedidoProduct.appendChild(legacyOption);
      matchedValue = legacyOption.value;
    }

    refs.pedidoProduct.value = matchedValue || '';
    const status = document.getElementById('agendaPedidoProductStatus');
    if (status) status.textContent = state.productCatalog.length
      ? state.productCatalog.length + ' producto(s) activo(s) disponible(s).'
      : 'No hay productos activos. Cree productos desde Catálogos → Productos.';
  }

  function syncPedidoPriceFromSelection(){
    const selected = getSelectedPedidoProductData();
    const price = selected ? normalizeNumberInput(selected.price) : null;
    refs.pedidoPrice.value = price != null ? formatNumberPlain(price) : '';
    syncPedidoTotal();
  }

  function applyPedidoSnapshot(pedido){
    const snapshot = pedido && typeof pedido === 'object' ? pedido : getEmptyPedido();
    renderPedidoProductOptions({
      selectedId: snapshot.productId,
      selectedName: snapshot.productNameSnapshot || snapshot.product,
      selectedPrice: snapshot.priceSnapshot != null ? snapshot.priceSnapshot : snapshot.price,
      preserveHistorical: true
    });
    refs.pedidoPrice.value = snapshot.price != null ? formatNumberPlain(snapshot.price) : '';
  }

  function loadProductCatalog(){
    refs.pedidoProduct.innerHTML = '<option value="">Cargando catálogo…</option>';

    return readProductCatalogFromPOS().then(function(products){
      state.productCatalog = Array.isArray(products) ? products : [];
      state.productCatalogSource = state.productCatalog.length ? 'catalogos' : 'empty';
      renderPedidoProductOptions();
    }).catch(function(){
      state.productCatalog = [];
      state.productCatalogSource = 'empty';
      renderPedidoProductOptions();
    });
  }

  function getEmptyPedido(){
    return {
      enabled: false,
      productId: '',
      product: '',
      productNameSnapshot: '',
      price: null,
      priceSnapshot: null,
      productSnapshot: null,
      historicalOnly: false,
      quantity: null,
      total: null,
      delivery: ''
    };
  }

  function normalizePedido(value){
    const source = value && typeof value === 'object' ? value : {};
    const legacyDraft = source.draft && typeof source.draft === 'object' ? source.draft : null;
    const merged = legacyDraft ? { ...legacyDraft, ...source } : source;
    const enabled = merged.enabled === true;

    if (!enabled) return getEmptyPedido();

    const price = normalizeNumberInput(merged.price);
    const quantity = normalizeNumberInput(merged.quantity);
    const total = price != null && quantity != null ? round2(price * quantity) : null;

    const productNameSnapshot = String(merged.productNameSnapshot || merged.product || '').replace(/\s+/g, ' ').trim();
    const productId = String(merged.productId || '').trim();
    const priceSnapshot = normalizeNumberInput(merged.priceSnapshot != null ? merged.priceSnapshot : merged.price);
    return {
      enabled: true,
      productId,
      product: productNameSnapshot,
      productNameSnapshot,
      price: priceSnapshot,
      priceSnapshot,
      quantity,
      total: priceSnapshot != null && quantity != null ? round2(priceSnapshot * quantity) : total,
      delivery: normalizeDate(merged.delivery),
      productSnapshot: merged.productSnapshot && typeof merged.productSnapshot === 'object' ? { ...merged.productSnapshot } : null,
      historicalOnly: merged.historicalOnly === true || (!productId && !!productNameSnapshot)
    };
  }

  function normalizePurchase(value, recordSource){
    const source = value && typeof value === 'object' ? value : {};
    const record = recordSource && typeof recordSource === 'object' ? recordSource : {};
    const snapshot = source.snapshot && typeof source.snapshot === 'object' ? source.snapshot : {};
    const materialId = String(source.materialId || snapshot.materialId || '').trim();
    const name = String(source.name || source.materialName || snapshot.name || record.subject || '').replace(/\s+/g, ' ').trim();
    const category = String(source.category || snapshot.category || '').replace(/\s+/g, ' ').trim();
    const unitRaw = String(source.unit || snapshot.unit || '').trim();
    const unit = ['Unidad','Cajas','Litros','Galones'].includes(unitRaw) ? unitRaw : '';
    const priceUsed = normalizeNumberInput(source.priceUsed != null ? source.priceUsed : (source.price != null ? source.price : snapshot.priceUsed));
    const quantity = normalizeNumberInput(source.quantity);
    const subtotalRaw = normalizeNumberInput(source.subtotal);
    const subtotal = priceUsed != null && quantity != null ? round2(priceUsed * quantity) : (subtotalRaw == null ? 0 : subtotalRaw);
    return {
      materialId,
      name,
      category,
      unit,
      priceUsed: priceUsed == null ? 0 : priceUsed,
      quantity,
      subtotal,
      snapshot: {
        materialId,
        name,
        category,
        unit,
        priceUsed: priceUsed == null ? 0 : priceUsed,
        capturedAt: String(snapshot.capturedAt || source.capturedAt || record.createdAt || '').trim()
      }
    };
  }

  function normalizeRecord(input){
    const source = input && typeof input === 'object' ? input : {};
    const type = normalizeType(source.type);
    const id = String(source.id || createId());
    const createdAt = String(source.createdAt || new Date().toISOString());
    const updatedAt = String(source.updatedAt || createdAt);

    return {
      id,
      subject: String(source.subject || '').trim(),
      type,
      client: sanitizeCustomerDisplay(source.client || ''),
      clientId: String(source.clientId || '').trim(),
      modality: type === 'reunion' ? normalizeModality(source.modality) : '',
      date: normalizeDate(source.date),
      time: normalizeTime(source.time),
      status: normalizeStatus(source.status),
      priority: normalizePriority(source.priority),
      notes: String(source.notes || '').trim(),
      createdAt,
      updatedAt,
      pedido: normalizePedido(source.pedido),
      purchase: type === 'compra' ? normalizePurchase(source.purchase || source.compra, source) : normalizePurchase(null, {})
    };
  }

  function normalizeStore(payload){
    if (Array.isArray(payload)) return payload.map(normalizeRecord);
    if (payload && typeof payload === 'object' && Array.isArray(payload.records)) {
      return payload.records.map(normalizeRecord);
    }
    return [];
  }

  function sortRecords(records){
    return records.slice().sort(function(a, b){
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }

  function loadRecords(){
    let raw = null;
    try {
      raw = getStorage().getItem(AGENDA_BOOT.storageKey);
    } catch (_) {
      raw = null;
    }

    const parsed = raw ? safeParse(raw) : null;
    state.records = sortRecords(normalizeStore(parsed));
  }

  function saveRecords(){
    const payload = {
      schemaVersion: AGENDA_BOOT.schemaVersion,
      updatedAt: new Date().toISOString(),
      records: state.records.map(normalizeRecord)
    };

    getStorage().setItem(AGENDA_BOOT.storageKey, JSON.stringify(payload));
  }

  function priorityRank(value){
    const priority = normalizePriority(value);
    if (priority === 'alta') return 0;
    if (priority === 'media') return 1;
    return 2;
  }

  function statusRank(value){
    const status = normalizeStatus(value);
    if (status === 'pendiente') return 0;
    if (status === 'hecho') return 1;
    return 2;
  }

  function dueStamp(record){
    if (!record || !record.date) return Number.MAX_SAFE_INTEGER;
    const time = record.time || '23:59';
    const stamp = new Date(record.date + 'T' + time + ':00').getTime();
    return Number.isNaN(stamp) ? Number.MAX_SAFE_INTEGER : stamp;
  }

  function comparePendingRecords(a, b){
    const dueDiff = dueStamp(a) - dueStamp(b);
    if (dueDiff !== 0) return dueDiff;

    const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
    if (priorityDiff !== 0) return priorityDiff;

    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  }

  function compareAllRecords(a, b){
    const statusDiff = statusRank(a.status) - statusRank(b.status);
    if (statusDiff !== 0) return statusDiff;

    if (a.status === 'pendiente' && b.status === 'pendiente') {
      return comparePendingRecords(a, b);
    }

    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  }

  function getCounts(){
    const activeType = getActiveRecordType();
    return state.records.reduce(function(acc, record){
      if (record.type !== activeType) return acc;
      acc.total += 1;
      acc[record.status] += 1;
      return acc;
    }, {
      total: 0,
      pendiente: 0,
      hecho: 0,
      cancelado: 0
    });
  }

  function getVisibleRecords(){
    const activeType = getActiveRecordType();
    const records = state.records.filter(function(record){
      return record.type === activeType;
    });

    if (state.activeFilter === 'todos') {
      return records.sort(compareAllRecords);
    }

    const filtered = records.filter(function(record){
      return record.status === state.activeFilter;
    });

    if (state.activeFilter === 'pendiente') {
      return filtered.sort(comparePendingRecords);
    }

    return filtered.sort(function(a, b){
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }

  function getPendingTiming(record){
    if (!record || normalizeStatus(record.status) !== 'pendiente') return '';
    const recordDate = normalizeDate(record.date);
    const today = todayIso();
    if (!recordDate) return 'sin_fecha';
    if (recordDate < today) return 'atrasado';
    if (recordDate === today) return 'hoy';
    return 'proximo';
  }

  function getPendingPulseCounts(){
    const activeType = getActiveRecordType();
    return state.records.reduce(function(acc, record){
      if (record.type !== activeType || normalizeStatus(record.status) !== 'pendiente') return acc;
      acc.total += 1;
      const timing = getPendingTiming(record);
      if (timing === 'atrasado') acc.atrasado += 1;
      else if (timing === 'hoy') acc.hoy += 1;
      else if (timing === 'proximo') acc.proximo += 1;
      else acc.sinFecha += 1;
      return acc;
    }, { total: 0, atrasado: 0, hoy: 0, proximo: 0, sinFecha: 0 });
  }

  function updatePendingPulse(){
    if (!refs.pendingPulse) return;
    const counts = getPendingPulseCounts();
    const hasPending = counts.total > 0;

    refs.pendingPulseTotal.textContent = hasPending
      ? counts.total + ' pendiente' + (counts.total === 1 ? '' : 's')
      : 'Sin pendientes';
    refs.pendingPulseOverdue.textContent = 'Atrasados: ' + counts.atrasado;
    refs.pendingPulseToday.textContent = 'Hoy: ' + counts.hoy;
    refs.pendingPulseUpcoming.textContent = 'Próximos: ' + counts.proximo;

    refs.pendingPulse.classList.toggle('is-calm', !hasPending);
    refs.pendingPulseOverdue.classList.toggle('is-alert', counts.atrasado > 0);
    refs.pendingPulseToday.classList.toggle('is-today', counts.hoy > 0);
    refs.pendingPulseUpcoming.classList.toggle('is-upcoming', counts.proximo > 0);
  }

  function formatDate(dateString, fallback){
    if (!dateString) return fallback || '—';
    const date = new Date(dateString + 'T12:00:00');
    if (Number.isNaN(date.getTime())) return fallback || '—';
    try {
      return new Intl.DateTimeFormat('es-NI', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }).format(date);
    } catch (_) {
      return date.toLocaleDateString('es-NI');
    }
  }

  function formatTime(timeString, fallback){
    if (!timeString) return fallback || 'Sin hora';
    const parts = String(timeString).split(':');
    if (parts.length < 2) return fallback || 'Sin hora';
    return parts[0] + ':' + parts[1];
  }

  function formatDateTime(dateString){
    if (!dateString) return '—';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '—';
    try {
      return new Intl.DateTimeFormat('es-NI', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    } catch (_) {
      return date.toLocaleString('es-NI');
    }
  }


  function formatMoneyForCalendar(value){
    if (value == null || !Number.isFinite(Number(value))) return '';
    return 'C$ ' + Number(value).toFixed(2);
  }

  function slugifyFilePart(value, fallback){
    const base = String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');
    return base || String(fallback || 'item');
  }

  function icsEscape(value){
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/\r?\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  function foldIcsLine(line){
    const source = String(line || '');
    if (source.length <= 74) return source;
    const chunks = [];
    for (let index = 0; index < source.length; index += 74) {
      chunks.push((index ? ' ' : '') + source.slice(index, index + 74));
    }
    return chunks.join('\r\n');
  }

  function formatIcsDate(date){
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return '' + yyyy + mm + dd;
  }

  function formatIcsLocalDateTime(date){
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return formatIcsDate(date) + 'T' + hh + mm + ss;
  }

  function formatIcsUtcStamp(date){
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mi = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    return '' + yyyy + mm + dd + 'T' + hh + mi + ss + 'Z';
  }

  function buildAgendaCalendarDescription(record){
    const lines = [];
    lines.push('Tipo: ' + TYPE_LABELS[record.type]);
    if (record.type === 'reunion' && record.client) lines.push('Cliente: ' + record.client);
    lines.push('Estado: ' + STATUS_LABELS[record.status]);
    if (record.type === 'reunion') {
      lines.push('Modalidad: ' + MODALITY_LABELS[normalizeModality(record.modality)]);
    }
    lines.push('Fecha de Agenda: ' + formatDate(record.date, record.date || '—'));
    if (record.time) lines.push('Hora: ' + formatTime(record.time, record.time));
    if (record.notes) lines.push('Notas: ' + record.notes.replace(/\r?\n/g, ' '));

    if (record.type === 'reunion' && record.pedido && record.pedido.enabled) {
      lines.push('');
      lines.push('Pedido activo: Sí');
      if (record.pedido.product) lines.push('Producto: ' + record.pedido.product);
      if (record.pedido.price != null) lines.push('Precio: ' + formatMoneyForCalendar(record.pedido.price));
      if (record.pedido.quantity != null) lines.push('Cantidad: ' + formatNumberPlain(record.pedido.quantity));
      if (record.pedido.total != null) lines.push('Total: ' + formatMoneyForCalendar(record.pedido.total));
      if (record.pedido.delivery) lines.push('Fecha de entrega: ' + formatDate(record.pedido.delivery, record.pedido.delivery));
    }

    return lines.join('\n');
  }

  function buildCalendarActionLabel(record){
    const safeRecord = record && typeof record === 'object' ? record : {};
    const subject = String(safeRecord.subject || '').trim();
    const typeLabel = TYPE_LABELS[normalizeType(safeRecord.type)] || 'Registro';
    return 'Añadir ' + (subject ? '"' + subject + '"' : typeLabel) + ' al calendario';
  }

  function buildAgendaCalendarEvent(record){
    const date = normalizeDate(record && record.date);
    if (!date) return null;

    const hasTime = Boolean(normalizeTime(record.time));
    let startValue = '';
    let endValue = '';
    let startProp = '';
    let endProp = '';

    if (hasTime) {
      const start = new Date(date + 'T' + normalizeTime(record.time) + ':00');
      if (Number.isNaN(start.getTime())) return null;
      const end = new Date(start.getTime() + (60 * 60 * 1000));
      startProp = 'DTSTART';
      endProp = 'DTEND';
      startValue = formatIcsLocalDateTime(start);
      endValue = formatIcsLocalDateTime(end);
    } else {
      const start = new Date(date + 'T12:00:00');
      if (Number.isNaN(start.getTime())) return null;
      const end = new Date(start.getTime());
      end.setDate(end.getDate() + 1);
      startProp = 'DTSTART;VALUE=DATE';
      endProp = 'DTEND;VALUE=DATE';
      startValue = formatIcsDate(start);
      endValue = formatIcsDate(end);
    }

    const summary = 'Agenda A33 — ' + TYPE_LABELS[record.type] + ' — ' + (record.subject || 'Sin asunto');
    const description = buildAgendaCalendarDescription(record);
    const now = new Date();
    const uid = String(record.id || ('agenda-' + startValue)) + '@arcano33';

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Arcano 33//Agenda//ES',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:' + icsEscape(uid),
      'DTSTAMP:' + formatIcsUtcStamp(now),
      'SUMMARY:' + icsEscape(summary),
      'DESCRIPTION:' + icsEscape(description),
      startProp + ':' + startValue,
      endProp + ':' + endValue,
      'END:VEVENT',
      'END:VCALENDAR'
    ];

    return lines.map(foldIcsLine).join('\r\n');
  }

  function exportRecordToCalendar(record){
    if (!record) return;

    const ics = buildAgendaCalendarEvent(record);
    if (!ics) {
      window.alert('No se pudo generar el evento de calendario. Revisá que el registro tenga una fecha válida.');
      return;
    }

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeType = slugifyFilePart(TYPE_LABELS[normalizeType(record.type)] || 'agenda', 'agenda');
    const safeSubject = slugifyFilePart(record.subject, 'registro');
    const safeDate = normalizeDate(record.date) || todayIso();

    link.href = url;
    link.download = 'agenda_' + safeType + '_' + safeSubject + '_' + safeDate + '.ics';

    document.body.appendChild(link);
    link.click();
    setTimeout(function(){
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 0);
  }

  function truncateText(value, max){
    const text = String(value || '').trim();
    if (!text || text.length <= max) return text;
    return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
  }

  function escapeHtml(value){
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setRefs(){
    refs.homeView = document.getElementById('agendaHomeView');
    refs.operationalView = document.getElementById('agendaOperationalView');
    refs.purchasesView = document.getElementById('agendaPurchasesView');
    refs.entryButtons = Array.from(document.querySelectorAll('[data-agenda-section]'));
    refs.backButtons = Array.from(document.querySelectorAll('[data-agenda-back]'));
    refs.sectionKicker = document.getElementById('agendaSectionKicker');
    refs.sectionTitle = document.getElementById('agenda-title');
    refs.sectionLead = document.getElementById('agendaSectionLead');
    refs.formEyebrow = document.getElementById('agendaFormEyebrow');
    refs.subjectLabel = document.getElementById('agendaSubjectLabel');
    refs.formHelper = document.getElementById('agendaFormHelper');
    refs.listTitle = document.getElementById('agendaListTitle');
    refs.form = document.getElementById('agendaForm');
    refs.formTitle = document.getElementById('agendaFormTitle');
    refs.subject = document.getElementById('agendaSubject');
    refs.client = document.getElementById('agendaClient');
    refs.clientSelect = document.getElementById('agendaClientSelect');
    refs.clientNewWrap = document.getElementById('agendaClientNewWrap');
    refs.clientNew = document.getElementById('agendaClientNew');
    refs.clientNote = document.getElementById('agendaClientNote');
    refs.clientField = document.getElementById('agendaClientField');
    refs.meetingModalityField = document.getElementById('agendaMeetingModalityField');
    refs.modality = document.getElementById('agendaModality');
    refs.date = document.getElementById('agendaDate');
    refs.time = document.getElementById('agendaTime');
    refs.status = document.getElementById('agendaStatus');
    refs.priority = document.getElementById('agendaPriority');
    refs.notes = document.getElementById('agendaNotes');
    refs.typeInputs = Array.from(document.querySelectorAll('input[name="type"]'));
    refs.pedidoToggleWrap = document.getElementById('agendaPedidoToggleWrap');
    refs.pedidoToggle = document.getElementById('agendaPedidoToggle');
    refs.pedidoTogglePill = document.getElementById('agendaPedidoTogglePill');
    refs.pedidoPanel = document.getElementById('agendaPedidoPanel');
    refs.pedidoBadge = document.getElementById('agendaPedidoBadge');
    refs.pedidoProduct = document.getElementById('agendaPedidoProduct');
    refs.pedidoDelivery = document.getElementById('agendaPedidoDelivery');
    refs.pedidoPrice = document.getElementById('agendaPedidoPrice');
    refs.pedidoQuantity = document.getElementById('agendaPedidoQuantity');
    refs.pedidoTotal = document.getElementById('agendaPedidoTotal');
    refs.newBtn = document.getElementById('agendaNewBtn');
    refs.deleteBtn = document.getElementById('agendaDeleteBtn');
    refs.list = document.getElementById('agendaList');
    refs.empty = document.getElementById('agendaEmptyState');
    refs.emptyTitle = document.getElementById('agendaEmptyTitle');
    refs.emptyText = document.getElementById('agendaEmptyText');
    refs.listBadge = document.getElementById('agendaListBadge');
    refs.countLabel = document.getElementById('agendaCountLabel');
    refs.modeLabel = document.getElementById('agendaModeLabel');
    refs.lastUpdate = document.getElementById('agendaLastUpdate');
    refs.metaId = document.getElementById('agendaMetaId');
    refs.metaCreated = document.getElementById('agendaMetaCreated');
    refs.metaUpdated = document.getElementById('agendaMetaUpdated');
    refs.toolbarTitle = document.getElementById('agendaToolbarTitle');
    refs.toolbarText = document.getElementById('agendaToolbarText');
    refs.saveBtn = document.getElementById('agendaSaveBtn');
    refs.filterButtons = Array.from(document.querySelectorAll('[data-filter]'));
    refs.pendingPulse = document.getElementById('agendaPendingPulse');
    refs.pendingPulseTotal = document.getElementById('agendaPendingPulseTotal');
    refs.pendingPulseOverdue = document.getElementById('agendaPendingPulseOverdue');
    refs.pendingPulseToday = document.getElementById('agendaPendingPulseToday');
    refs.pendingPulseUpcoming = document.getElementById('agendaPendingPulseUpcoming');
  }

  function setAgendaView(target){
    if (refs.homeView) refs.homeView.hidden = target !== 'home';
    if (refs.operationalView) refs.operationalView.hidden = target !== 'operational';
    if (refs.purchasesView) refs.purchasesView.hidden = target !== 'compra';
  }

  function updateSectionCopy(){
    const type = getActiveRecordType();
    const copy = SECTION_COPY[type] || SECTION_COPY.reunion;
    if (refs.sectionKicker) refs.sectionKicker.textContent = 'Agenda operativa';
    if (refs.sectionTitle) refs.sectionTitle.textContent = copy.title;
    if (refs.sectionLead) refs.sectionLead.textContent = copy.lead;
    if (refs.formEyebrow) refs.formEyebrow.textContent = copy.eyebrow;
    if (refs.subjectLabel) refs.subjectLabel.textContent = copy.subjectLabel;
    if (refs.formHelper) refs.formHelper.textContent = copy.helper;
    if (refs.listTitle) refs.listTitle.textContent = copy.plural;
  }

  function openAgendaHome(options){
    const settings = options || {};
    state.activeSection = 'home';
    state.currentId = null;
    setAgendaView('home');
    if (settings.focus !== false && refs.entryButtons && refs.entryButtons[0]) {
      refs.entryButtons[0].focus();
    }
  }

  function openAgendaSection(section, options){
    const settings = options || {};
    const target = normalizeType(section);

    if (target === 'compra') {
      loadRecords();
      state.activeSection = 'compra';
      state.currentId = null;
      setAgendaView('compra');
      try{
        if (window.A33AgendaPurchases && typeof window.A33AgendaPurchases.open === 'function') {
          window.A33AgendaPurchases.open(settings.recordId || '');
        }
      }catch(_){ }
      return;
    }

    loadRecords();
    state.activeSection = isOperationalSection(target) ? target : 'reunion';
    state.activeFilter = settings.keepFilter === true ? state.activeFilter : 'pendiente';
    setAgendaView('operational');
    setTypeValue(state.activeSection);
    updateSectionCopy();

    if (settings.reset !== false) {
      resetForm({ focus: settings.focus === true, type: state.activeSection });
      renderList();
    } else {
      applyTypeUI();
      renderList();
    }
  }

  function clearFieldError(input){
    if (!input || typeof input.setCustomValidity !== 'function') return;
    input.setCustomValidity('');
  }

  function bindFieldErrorReset(input){
    if (!input) return;
    const reset = function(){
      clearFieldError(input);
    };
    input.addEventListener('input', reset, { once: true });
    input.addEventListener('change', reset, { once: true });
  }

  function invalidateField(input, message){
    if (!input || typeof input.reportValidity !== 'function') return false;
    input.setCustomValidity(message);
    input.reportValidity();
    bindFieldErrorReset(input);
    return false;
  }

  function getTypeValue(){
    const active = refs.typeInputs.find(function(input){
      return input.checked;
    });
    return normalizeType(active ? active.value : 'tarea');
  }

  function setTypeValue(value){
    const target = normalizeType(value);
    refs.typeInputs.forEach(function(input){
      input.checked = input.value === target;
    });
  }

  function getCurrentRecord(){
    return state.records.find(function(record){
      return record.id === state.currentId;
    }) || null;
  }

  function getFormTitleBase(){
    const currentType = getTypeValue();
    const label = TYPE_LABELS[currentType];
    return state.currentId ? 'Editar ' + label : 'Nueva ' + label;
  }

  function syncFormTitle(){
    refs.formTitle.textContent = getFormTitleBase();
  }

  function updateFilterButtons(){
    const counts = getCounts();
    refs.filterButtons.forEach(function(button){
      const filter = button.getAttribute('data-filter');
      const base = FILTER_LABELS[filter] || filter;
      const count = filter === 'todos' ? counts.total : counts[filter];
      button.textContent = base + ' (' + count + ')';
      const active = filter === state.activeFilter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function setModeLabels(){
    const counts = getCounts();
    const total = counts.total;
    const visible = getVisibleRecords().length;
    const current = getCurrentRecord();
    const type = getActiveRecordType();
    const copy = SECTION_COPY[type] || SECTION_COPY.reunion;
    const singularLower = copy.title.toLowerCase();

    refs.countLabel.textContent = String(total);

    if (!total) {
      refs.listBadge.textContent = '0 elementos';
      refs.modeLabel.textContent = EMPTY_MODE;
      refs.toolbarTitle.textContent = 'Pendientes primero';
      refs.toolbarText.textContent = 'Aún no hay registros guardados en esta sección.';
      refs.saveBtn.textContent = 'Guardar ' + copy.title;
      return;
    }

    if (state.activeFilter === 'todos') {
      refs.listBadge.textContent = visible + ' visibles';
    } else {
      refs.listBadge.textContent = visible + ' ' + FILTER_LABELS[state.activeFilter].toLowerCase() + ' · ' + total + ' total';
    }

    if (current) {
      refs.modeLabel.textContent = 'Editando ' + singularLower;
      refs.saveBtn.textContent = 'Actualizar ' + copy.title;
    } else {
      refs.saveBtn.textContent = 'Guardar ' + copy.title;
      if (state.activeFilter === 'pendiente') refs.modeLabel.textContent = counts.pendiente ? 'Pendientes primero' : 'Sin pendientes';
      if (state.activeFilter === 'hecho') refs.modeLabel.textContent = 'Vista: Hechos';
      if (state.activeFilter === 'cancelado') refs.modeLabel.textContent = 'Vista: Cancelados';
      if (state.activeFilter === 'todos') refs.modeLabel.textContent = 'Vista: Todos';
    }

    if (state.activeFilter === 'pendiente') {
      refs.toolbarTitle.textContent = counts.pendiente ? 'Pendientes al frente' : 'No hay pendientes';
      refs.toolbarText.textContent = counts.pendiente
        ? 'Mostrando ' + counts.pendiente + ' registro' + (counts.pendiente === 1 ? '' : 's') + ' pendiente' + (counts.pendiente === 1 ? '' : 's') + ', sin mezclar otros tipos de Agenda.'
        : 'Esta sección tiene registros, pero ninguno quedó en Pendiente.';
      return;
    }

    if (state.activeFilter === 'hecho') {
      refs.toolbarTitle.textContent = 'Trabajo cerrado';
      refs.toolbarText.textContent = visible
        ? 'Aquí ves únicamente registros terminados de esta sección.'
        : 'No hay registros marcados como Hecho en esta sección.';
      return;
    }

    if (state.activeFilter === 'cancelado') {
      refs.toolbarTitle.textContent = 'Cancelados visibles';
      refs.toolbarText.textContent = visible
        ? 'Los registros cancelados de esta sección siguen disponibles para revisión.'
        : 'No hay registros cancelados en esta sección.';
      return;
    }

    refs.toolbarTitle.textContent = 'Visión completa';
    refs.toolbarText.textContent = 'Todos los estados de esta sección, sin mezclar registros de otras áreas.';
  }

  function setLastUpdateLabel(){
    const activeType = getActiveRecordType();
    const latest = state.records
      .filter(function(record){ return record.type === activeType; })
      .sort(function(a, b){ return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(); })[0];
    refs.lastUpdate.textContent = latest ? formatDateTime(latest.updatedAt) : '—';
  }

  function scrollActiveRecordIntoView(){
    if (!state.currentId || !refs.list || typeof refs.list.querySelector !== 'function') return;
    const card = refs.list.querySelector('[data-record-id="' + state.currentId + '"]');
    if (!card || typeof card.scrollIntoView !== 'function') return;
    try {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (_) {
      card.scrollIntoView();
    }
  }

  function setFormMeta(record){
    refs.metaId.textContent = record ? record.id : 'Nuevo';
    refs.metaCreated.textContent = record ? formatDateTime(record.createdAt) : '—';
    refs.metaUpdated.textContent = record ? formatDateTime(record.updatedAt) : '—';
  }

  function isPedidoEnabled(){
    return refs.pedidoToggle.getAttribute('aria-pressed') === 'true';
  }

  function clearPedidoForm(){
    renderPedidoProductOptions();
    refs.pedidoProduct.value = '';
    refs.pedidoDelivery.value = '';
    refs.pedidoPrice.value = '';
    refs.pedidoQuantity.value = '';
    refs.pedidoTotal.value = '';
    clearFieldError(refs.pedidoProduct);
    clearFieldError(refs.pedidoDelivery);
    clearFieldError(refs.pedidoPrice);
    clearFieldError(refs.pedidoQuantity);
  }

  function syncPedidoTotal(){
    const price = normalizeNumberInput(refs.pedidoPrice.value);
    const quantity = normalizeNumberInput(refs.pedidoQuantity.value);

    if (price == null || quantity == null) {
      refs.pedidoTotal.value = '';
      return;
    }

    refs.pedidoTotal.value = formatMoney(round2(price * quantity));
  }

  function setPedidoEnabled(enabled, options){
    const settings = options || {};
    const isOn = enabled === true;
    refs.pedidoToggle.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    refs.pedidoToggle.classList.toggle('is-active', isOn);
    refs.pedidoPanel.hidden = !isOn;
    refs.pedidoBadge.textContent = isOn ? 'Activo' : 'Apagado';
    refs.pedidoTogglePill.textContent = isOn ? 'Encendido' : 'Apagado';

    refs.pedidoProduct.disabled = !isOn;
    refs.pedidoDelivery.disabled = !isOn;
    refs.pedidoPrice.disabled = !isOn;
    refs.pedidoQuantity.disabled = !isOn;
    refs.pedidoTotal.disabled = !isOn;

    if (!isOn && settings.preserveValues !== true) {
      clearPedidoForm();
    }
  }

  function applyTypeUI(){
    const type = getTypeValue();
    const isReunion = type === 'reunion';

    if (refs.clientField) refs.clientField.hidden = !isReunion;
    refs.clientSelect.disabled = !isReunion;
    refs.clientSelect.required = isReunion;
    refs.client.required = isReunion;
    if (!isReunion) setClientCreationMode(false);

    refs.meetingModalityField.hidden = !isReunion;
    refs.modality.disabled = !isReunion;
    refs.modality.required = isReunion;

    if (refs.pedidoToggleWrap) refs.pedidoToggleWrap.hidden = !isReunion;
    if (!isReunion) setPedidoEnabled(false, { preserveValues: true });

    refs.subject.placeholder = isReunion
      ? 'Ej. Seguimiento con cliente / Reunión de propuesta'
      : 'Ej. Preparar materiales / Confirmar entrega / Revisar pendientes';

    refs.notes.placeholder = isReunion
      ? 'Notas breves de la reunión.'
      : 'Notas simples de la tarea.';

    updateSectionCopy();
    syncFormTitle();
  }

  function resetForm(options){
    const settings = options || {};
    const shouldFocus = settings.focus !== false;
    const formType = isOperationalSection(settings.type) ? settings.type : getActiveRecordType();
    state.currentId = null;
    refs.form.reset();
    setTypeValue(formType);
    refs.modality.value = 'presencial';
    refs.status.value = 'pendiente';
    refs.priority.value = 'media';
    refs.date.value = todayIso();
    refs.time.value = '';
    refs.deleteBtn.hidden = true;
    applyClientSnapshot(null);
    clearFieldError(refs.subject);
    clearFieldError(refs.clientSelect);
    clearFieldError(refs.clientNew);
    clearFieldError(refs.client);
    clearFieldError(refs.date);
    clearFieldError(refs.modality);
    setPedidoEnabled(false);
    setFormMeta(null);
    applyTypeUI();
    syncPedidoTotal();
    setModeLabels();
    if (shouldFocus && !refs.operationalView.hidden) refs.subject.focus();
  }

  function fillForm(record, options){
    const settings = options || {};
    state.currentId = record.id;
    setTypeValue(record.type);
    refs.subject.value = record.subject;

    if (record.type === 'reunion') {
      applyClientSnapshot(record);
    } else {
      applyClientSnapshot(null);
    }

    refs.modality.value = record.type === 'reunion' ? (record.modality || 'presencial') : 'presencial';
    refs.date.value = record.date;
    refs.time.value = record.time;
    refs.status.value = record.status;
    refs.priority.value = record.priority;
    refs.notes.value = record.notes;

    if (record.type === 'reunion') {
      setPedidoEnabled(Boolean(record.pedido && record.pedido.enabled), { preserveValues: true });
      applyPedidoSnapshot(record.pedido);
      refs.pedidoDelivery.value = record.pedido && record.pedido.delivery ? record.pedido.delivery : '';
      refs.pedidoQuantity.value = record.pedido && record.pedido.quantity != null ? formatNumberPlain(record.pedido.quantity) : '';
      syncPedidoTotal();
    } else {
      setPedidoEnabled(false);
    }

    refs.deleteBtn.hidden = false;
    clearFieldError(refs.subject);
    clearFieldError(refs.clientSelect);
    clearFieldError(refs.clientNew);
    clearFieldError(refs.client);
    clearFieldError(refs.date);
    clearFieldError(refs.modality);
    setFormMeta(record);
    applyTypeUI();
    setModeLabels();
    if (settings.focus !== false) refs.subject.focus();
  }

  function buildDatePillText(record){
    if (!record.date) return 'Sin fecha';
    return formatDate(record.date) + (record.time ? ' · ' + formatTime(record.time) : '');
  }

  function pedidoSummary(record){
    if (!record || !record.pedido || !record.pedido.enabled) return '';
    const product = record.pedido.product || 'Producto pendiente';
    const total = record.pedido.total != null ? formatMoney(record.pedido.total) : 'Total pendiente';
    const delivery = record.pedido.delivery ? formatDate(record.pedido.delivery) : 'Entrega pendiente';
    return 'Pedido: ' + product + ' · ' + total + ' · Entrega ' + delivery + '.';
  }

  function recordToPreview(record){
    if (record.type === 'reunion' && record.pedido && record.pedido.enabled) {
      const pedidoText = pedidoSummary(record);
      if (record.notes) {
        return truncateText(pedidoText + ' ' + record.notes, 180);
      }
      return truncateText(pedidoText, 180);
    }

    if (record.notes) return truncateText(record.notes, 180);

    if (record.type === 'reunion') {
      return 'Cliente: ' + (record.client || '—') + ' · Modalidad: ' + MODALITY_LABELS[normalizeModality(record.modality)];
    }

    return 'Tarea programada para ' + buildDatePillText(record) + '.';
  }

  function createChip(className, text){
    const chip = document.createElement('span');
    chip.className = className;
    chip.textContent = text;
    return chip;
  }

  function updateRecordStatus(id, status){
    const targetStatus = normalizeStatus(status);
    const existing = state.records.find(function(record){
      return record.id === id;
    });
    if (!existing || existing.status === targetStatus) return;

    const updated = normalizeRecord({
      ...existing,
      status: targetStatus,
      updatedAt: new Date().toISOString()
    });

    state.records = state.records.map(function(record){
      return record.id === id ? updated : record;
    });
    state.records = sortRecords(state.records);
    saveRecords();

    if (state.currentId === id) {
      fillForm(updated, { focus: false });
    } else {
      setModeLabels();
    }

    renderList();
  }

  function createActionButton(label, className, handler, options){
    const settings = options || {};
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    if (settings.title) button.title = settings.title;
    if (settings.ariaLabel) button.setAttribute('aria-label', settings.ariaLabel);
    button.addEventListener('click', function(event){
      event.stopPropagation();
      handler();
    });
    return button;
  }

  function createRecordCard(record){
    const isActive = record.id === state.currentId;
    const article = document.createElement('article');
    article.className = 'agenda-record' + (isActive ? ' is-active' : '');
    article.setAttribute('data-record-id', record.id);
    article.tabIndex = 0;

    const top = document.createElement('div');
    top.className = 'agenda-record-top';

    const copy = document.createElement('div');
    copy.className = 'agenda-record-copy';

    const title = document.createElement('h3');
    title.textContent = record.subject || '(Sin asunto)';

    const meta = document.createElement('div');
    meta.className = 'agenda-record-meta';
    const metaItems = [
      createChip('agenda-chip agenda-chip--type', TYPE_LABELS[record.type]),
      createChip('agenda-status agenda-status--' + record.status, STATUS_LABELS[record.status]),
      createChip('agenda-chip agenda-chip--priority agenda-chip--priority-' + record.priority, PRIORITY_LABELS[record.priority]),
      createChip('agenda-date-pill', buildDatePillText(record))
    ];

    if (record.type === 'reunion') {
      metaItems.push(createChip('agenda-chip agenda-chip--client', 'Cliente: ' + (record.client || '—')));
    }

    const pendingTiming = getPendingTiming(record);
    if (pendingTiming === 'atrasado') {
      metaItems.splice(2, 0, createChip('agenda-chip agenda-chip--timing agenda-chip--timing-overdue', 'Atrasado'));
    } else if (pendingTiming === 'hoy') {
      metaItems.splice(2, 0, createChip('agenda-chip agenda-chip--timing agenda-chip--timing-today', 'Hoy'));
    } else if (pendingTiming === 'proximo') {
      metaItems.splice(2, 0, createChip('agenda-chip agenda-chip--timing agenda-chip--timing-upcoming', 'Próximo'));
    }

    if (record.type === 'reunion') {
      metaItems.splice(1, 0, createChip('agenda-chip', MODALITY_LABELS[normalizeModality(record.modality)]));
    }

    if (record.type === 'reunion' && record.pedido && record.pedido.enabled) {
      metaItems.push(createChip('agenda-chip agenda-chip--pedido', 'Pedido: ' + (record.pedido.product || 'Activo')));
      if (record.pedido.total != null) {
        metaItems.push(createChip('agenda-chip agenda-chip--pedido-total', formatMoney(record.pedido.total)));
      }
    }

    meta.append.apply(meta, metaItems);

    copy.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'agenda-record-actions';

    const flowActions = document.createElement('div');
    flowActions.className = 'agenda-record-actions-group';
    flowActions.append(
      createActionButton('Abrir', 'agenda-inline-btn', function(){
        fillForm(record);
        renderList();
      }),
      createActionButton('📅', 'agenda-inline-btn agenda-inline-btn--calendar', function(){
        exportRecordToCalendar(record);
      }, {
        title: buildCalendarActionLabel(record),
        ariaLabel: buildCalendarActionLabel(record)
      })
    );

    if (record.status === 'pendiente') {
      flowActions.append(
        createActionButton('Hecho', 'agenda-inline-btn agenda-inline-btn--done', function(){
          updateRecordStatus(record.id, 'hecho');
        }),
        createActionButton('Cancelar', 'agenda-inline-btn agenda-inline-btn--cancel', function(){
          updateRecordStatus(record.id, 'cancelado');
        })
      );
    } else {
      flowActions.append(
        createActionButton('Pendiente', 'agenda-inline-btn agenda-inline-btn--status', function(){
          updateRecordStatus(record.id, 'pendiente');
        })
      );
    }

    const destroyActions = document.createElement('div');
    destroyActions.className = 'agenda-record-actions-group';
    destroyActions.append(
      createActionButton('Borrar', 'agenda-inline-btn agenda-inline-btn--danger', function(){
        removeRecord(record.id);
      })
    );

    actions.append(flowActions, destroyActions);
    top.append(copy, actions);

    const preview = document.createElement('p');
    preview.className = 'agenda-record-preview';
    preview.textContent = recordToPreview(record);

    const foot = document.createElement('div');
    foot.className = 'agenda-record-foot';
    foot.innerHTML = '<span>Creado: ' + escapeHtml(formatDateTime(record.createdAt)) + '</span><span>Actualizado: ' + escapeHtml(formatDateTime(record.updatedAt)) + '</span>';

    article.append(top, preview, foot);

    article.addEventListener('click', function(){
      fillForm(record);
      renderList();
    });

    article.addEventListener('keydown', function(event){
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fillForm(record);
        renderList();
      }
    });

    return article;
  }

  function updateEmptyState(visibleCount){
    const counts = getCounts();
    const copy = SECTION_COPY[getActiveRecordType()] || SECTION_COPY.reunion;

    if (!counts.total) {
      refs.emptyTitle.textContent = 'Aún no hay ' + copy.plural.toLowerCase();
      refs.emptyText.textContent = 'Guarda el primer registro para empezar a trabajar esta sección.';
      return;
    }

    if (state.activeFilter === 'pendiente') {
      refs.emptyTitle.textContent = 'No hay pendientes';
      refs.emptyText.textContent = 'Hay registros guardados en esta sección, pero ninguno está Pendiente.';
      return;
    }

    if (state.activeFilter === 'hecho') {
      refs.emptyTitle.textContent = 'Todavía no hay hechos';
      refs.emptyText.textContent = 'Aún no has marcado ningún registro de esta sección como Hecho.';
      return;
    }

    if (state.activeFilter === 'cancelado') {
      refs.emptyTitle.textContent = 'Todavía no hay cancelados';
      refs.emptyText.textContent = 'No hay registros cancelados en esta sección.';
      return;
    }

    refs.emptyTitle.textContent = visibleCount ? 'Sección cargada' : 'Nada por mostrar';
    refs.emptyText.textContent = visibleCount ? 'Todo está visible en esta vista.' : 'No se encontraron registros en la vista actual.';
  }

  function renderList(){
    const visibleRecords = getVisibleRecords();
    refs.list.innerHTML = '';
    updateFilterButtons();
    updatePendingPulse();

    if (!visibleRecords.length) {
      refs.empty.hidden = false;
      updateEmptyState(0);
      setModeLabels();
      setLastUpdateLabel();
      return;
    }

    refs.empty.hidden = true;
    visibleRecords.forEach(function(record){
      refs.list.appendChild(createRecordCard(record));
    });

    setModeLabels();
    setLastUpdateLabel();
    scrollActiveRecordIntoView();
  }

  function collectPedidoData(){
    if (!isPedidoEnabled()) return getEmptyPedido();

    const price = normalizeNumberInput(refs.pedidoPrice.value);
    const quantity = normalizeNumberInput(refs.pedidoQuantity.value);

    const selectedProduct = getSelectedPedidoProductData();

    const productId = selectedProduct ? selectedProduct.id : '';
    const productNameSnapshot = selectedProduct ? selectedProduct.name : '';
    const priceSnapshot = price;
    return {
      enabled: true,
      productId,
      product: productNameSnapshot,
      productNameSnapshot,
      price: priceSnapshot,
      priceSnapshot,
      quantity,
      total: priceSnapshot != null && quantity != null ? round2(priceSnapshot * quantity) : null,
      delivery: normalizeDate(refs.pedidoDelivery.value),
      historicalOnly: !!(selectedProduct && selectedProduct.historicalOnly),
      productSnapshot: selectedProduct ? {
        productId,
        internalId: selectedProduct.internalId == null ? null : selectedProduct.internalId,
        name: productNameSnapshot,
        nombre: productNameSnapshot,
        price: priceSnapshot,
        precio: priceSnapshot,
        capturedAt: new Date().toISOString(),
        historicalOnly: !!selectedProduct.historicalOnly
      } : null
    };
  }

  function collectFormData(){
    const type = getTypeValue();
    const isReunion = type === 'reunion';
    return {
      subject: refs.subject.value.trim(),
      type,
      client: isReunion ? sanitizeCustomerDisplay(refs.client.value) : '',
      clientId: isReunion ? getClientIdHint() : '',
      modality: isReunion ? normalizeModality(refs.modality.value) : '',
      date: normalizeDate(refs.date.value),
      time: normalizeTime(refs.time.value),
      status: normalizeStatus(refs.status.value),
      priority: normalizePriority(refs.priority.value),
      notes: refs.notes.value.trim(),
      pedido: isReunion ? collectPedidoData() : getEmptyPedido()
    };
  }

  function validateForm(data){
    clearFieldError(refs.subject);
    clearFieldError(refs.clientSelect);
    clearFieldError(refs.clientNew);
    clearFieldError(refs.client);
    clearFieldError(refs.date);
    clearFieldError(refs.modality);
    clearFieldError(refs.pedidoProduct);
    clearFieldError(refs.pedidoDelivery);
    clearFieldError(refs.pedidoPrice);
    clearFieldError(refs.pedidoQuantity);

    if (!data.subject) {
      return invalidateField(refs.subject, 'Escribe el asunto del ítem.');
    }

    if (data.type === 'reunion' && !data.client) {
      if (refs.clientSelect && refs.clientSelect.value === CLIENT_SELECT_NEW_VALUE) {
        return invalidateField(refs.clientNew, 'Escribe el nombre del cliente nuevo.');
      }
      return invalidateField(refs.clientSelect, 'Selecciona un cliente o crea uno nuevo.');
    }

    if (!data.date) {
      return invalidateField(refs.date, 'La fecha es obligatoria para trabajar Agenda con orden.');
    }

    if (data.type === 'reunion' && !data.modality) {
      return invalidateField(refs.modality, 'Selecciona la modalidad de la reunión.');
    }

    if (data.type !== 'reunion' || !data.pedido || !data.pedido.enabled) {
      return true;
    }

    if (!data.pedido.product) {
      return invalidateField(refs.pedidoProduct, 'Indica el producto del pedido.');
    }

    if (!data.pedido.historicalOnly && !data.pedido.productId) {
      return invalidateField(refs.pedidoProduct, 'Selecciona un producto activo real desde Catálogos.');
    }

    if (data.pedido.price == null || data.pedido.price <= 0) {
      return invalidateField(refs.pedidoPrice, 'El precio debe ser mayor que cero.');
    }

    if (data.pedido.quantity == null || data.pedido.quantity <= 0) {
      return invalidateField(refs.pedidoQuantity, 'La cantidad debe ser mayor que cero.');
    }

    if (!data.pedido.delivery) {
      return invalidateField(refs.pedidoDelivery, 'Selecciona la fecha de entrega del pedido.');
    }

    return true;
  }

  function upsertRecord(data){
    const now = new Date().toISOString();
    const existing = getCurrentRecord();

    if (existing) {
      const updateData = data.type === 'tarea'
        ? {
            ...data,
            client: existing.client || '',
            clientId: existing.clientId || '',
            pedido: existing.pedido || getEmptyPedido()
          }
        : data;
      const updated = normalizeRecord({
        ...existing,
        ...updateData,
        updatedAt: now
      });

      state.records = state.records.map(function(record){
        return record.id === updated.id ? updated : record;
      });
      state.records = sortRecords(state.records);
      saveRecords();
      fillForm(updated, { focus: false });
      renderList();
      return;
    }

    const created = normalizeRecord({
      id: createId(),
      ...data,
      createdAt: now,
      updatedAt: now
    });

    state.records = sortRecords([created].concat(state.records));
    saveRecords();
    fillForm(created, { focus: false });
    renderList();
  }

  function removeRecord(id){
    const record = state.records.find(function(item){
      return item.id === id;
    });
    if (!record) return;

    const ok = window.confirm('¿Eliminar este ítem de Agenda? Esta acción no se puede deshacer.');
    if (!ok) return;

    state.records = state.records.filter(function(item){
      return item.id !== id;
    });
    saveRecords();

    if (state.currentId === id) {
      resetForm({ focus: false });
    } else {
      setModeLabels();
    }

    renderList();
  }

  function setFilter(filter){
    const target = FILTER_LABELS[filter] ? filter : 'pendiente';
    state.activeFilter = target;
    renderList();
  }

  function bindEvents(){
    refs.entryButtons.forEach(function(button){
      button.addEventListener('click', function(){
        openAgendaSection(button.getAttribute('data-agenda-section'), { focus: false });
      });
    });

    refs.backButtons.forEach(function(button){
      button.addEventListener('click', function(){
        openAgendaHome();
      });
    });

    refs.form.addEventListener('submit', function(event){
      event.preventDefault();

      const type = getTypeValue();
      let clientSelection = { ok: true, id: '', displayName: '' };

      if (type === 'reunion') {
        clientSelection = finalizeClientSelection();
        if (!clientSelection.ok) {
          if (clientSelection.reason === 'missing_new') {
            invalidateField(refs.clientNew, 'Escribe el nombre del cliente nuevo.');
            return;
          }
          if (clientSelection.reason === 'save_failed') {
            invalidateField(refs.clientNew, 'No se pudo guardar el cliente nuevo en el catálogo compartido.');
            return;
          }
          invalidateField(refs.clientSelect, 'Selecciona un cliente o crea uno nuevo.');
          return;
        }
      }

      const data = collectFormData();
      if (type === 'reunion') {
        data.client = clientSelection.displayName;
        data.clientId = clientSelection.id;
      }

      if (!validateForm(data)) return;
      upsertRecord(data);
    });

    refs.newBtn.addEventListener('click', function(){
      resetForm({ type: getActiveRecordType() });
    });

    refs.deleteBtn.addEventListener('click', function(){
      if (!state.currentId) return;
      removeRecord(state.currentId);
    });

    refs.typeInputs.forEach(function(input){
      input.addEventListener('change', function(){
        applyTypeUI();
      });
    });

    refs.clientSelect.addEventListener('change', function(){
      syncClientValueFromUI({ preserveNewValue: true });
    });

    refs.clientNew.addEventListener('input', function(){
      syncClientValueFromUI({ preserveNewValue: true });
    });

    refs.clientNew.addEventListener('change', function(){
      syncClientValueFromUI({ preserveNewValue: true });
    });

    refs.pedidoToggle.addEventListener('click', function(){
      if (getTypeValue() !== 'reunion') return;
      setPedidoEnabled(!isPedidoEnabled());
    });

    refs.pedidoProduct.addEventListener('change', syncPedidoPriceFromSelection);

    [refs.pedidoQuantity].forEach(function(input){
      input.addEventListener('input', syncPedidoTotal);
      input.addEventListener('change', syncPedidoTotal);
    });

    refs.filterButtons.forEach(function(button){
      button.addEventListener('click', function(){
        setFilter(button.getAttribute('data-filter'));
      });
    });

    window.addEventListener('a33:agenda-records-changed', function(){
      loadRecords();
      if (isOperationalSection(state.activeSection)) renderList();
    });
  }

  function markReady(){
    document.documentElement.setAttribute('data-agenda-ready', '1');
    window.A33Agenda = {
      ...AGENDA_BOOT,
      getState: function(){
        return {
          currentId: state.currentId,
          activeSection: state.activeSection,
          activeFilter: state.activeFilter,
          clientCatalogSource: state.clientCatalogSource,
          records: state.records.slice()
        };
      },
      normalizeRecord: normalizeRecord
    };
  }

  function getRequestedRecordId(){
    try {
      const params = new URLSearchParams(window.location.search || '');
      return String(params.get('record') || '').trim();
    } catch (_) {
      return '';
    }
  }

  function openRequestedRecord(){
    const requestedId = getRequestedRecordId();
    if (!requestedId) return false;
    const record = state.records.find(function(item){ return item.id === requestedId; });
    if (!record) return false;

    if (record.type === 'compra') {
      openAgendaSection('compra', { focus: false, recordId: record.id });
      return true;
    }

    openAgendaSection(record.type, { focus: false, reset: true });
    state.activeFilter = record.status === 'pendiente' ? 'pendiente' : 'todos';
    fillForm(record, { focus: false });
    renderList();
    return true;
  }

  function bootstrap(){
    setRefs();
    loadRecords();
    loadClientCatalog();
    bindEvents();

    const openedRequested = openRequestedRecord();
    if (!openedRequested) openAgendaHome({ focus: false });

    loadProductCatalog().finally(function(){
      const current = getCurrentRecord();
      if (current && current.type === 'reunion' && current.pedido && current.pedido.enabled) {
        applyPedidoSnapshot(current.pedido);
        syncPedidoTotal();
      }
      markReady();
    });
  }

  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
})();
