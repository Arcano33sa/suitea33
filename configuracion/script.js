(function(){
  'use strict';

  const BACKUP_APP_NAME = 'Suite A33';
  const LAST_EXPORT_KEY = 'suite_a33_backup_last_export_v1';
  let lastExportSession = null;
  let lastExportWriteFailed = false;
  const SUITE_LS_PREFIXES = ['arcano33_', 'a33_', 'suite_a33_', 'a33.'];
  const COSTS_BACKUP_KEY = 'a33_catalogos_costos_v1';
  const COSTS_BACKUP_SCHEMA_VERSION = 2;
  const AGENDA_BACKUP_KEY = 'a33_agenda_records_v1';
  const AGENDA_BACKUP_SCHEMA_VERSION = 9;
  const QUICK_ORDERS_BACKUP_KEY = 'arcano33_pedidos_rapidos_v1';
  const QUICK_ORDERS_BACKUP_SCHEMA_VERSION = 1;
  const AGENDA_PURCHASE_GROUP_VERSION = 1;
  const AGENDA_UNITS = new Set(['Unidad','Cajas','Litros','Galones']);

  function agendaClean(value, max){
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().slice(0,max || 500);
  }

  function agendaRound2(value){
    const number = Number(value);
    return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
  }

  function agendaNumber(value, fallback){
    if (value === '' || value == null) return fallback == null ? null : fallback;
    const parsed = Number(String(value).trim().replace(',','.'));
    return Number.isFinite(parsed) ? agendaRound2(parsed) : (fallback == null ? null : fallback);
  }

  function agendaDate(value){
    const raw = agendaClean(value,10);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
  }

  function agendaStatus(value){
    const raw = agendaClean(value,20).toLowerCase();
    return ['pendiente','hecho','cancelado'].includes(raw) ? raw : 'pendiente';
  }

  function agendaPriority(value){
    const raw = agendaClean(value,20).toLowerCase();
    return ['baja','media','alta'].includes(raw) ? raw : 'media';
  }

  function agendaUnit(value){
    const raw = agendaClean(value,24);
    return AGENDA_UNITS.has(raw) ? raw : '';
  }

  function agendaHash(value){
    const text = String(value == null ? '' : value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1){
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash,16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function quickOrderBackupClean(value, max){
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().slice(0,max || 500);
  }

  function quickOrderBackupTimestamp(value){
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeQuickOrderBackupItem(value){
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = { ...value };
    const snapshot = source.productSnapshot && typeof source.productSnapshot === 'object' && !Array.isArray(source.productSnapshot)
      ? { ...source.productSnapshot }
      : {};
    const name = quickOrderBackupClean(source.productNameSnapshot ?? source.productName ?? source.nombreSnapshot ?? source.nombre ?? source.name ?? snapshot.nombre ?? snapshot.name,160);
    const productId = quickOrderBackupClean(source.productId ?? source.productoId ?? source.catalogProductId,180)
      || (name ? ('prd_legacy_' + agendaHash(name.toLowerCase())) : '');
    const quantity = Number(source.cantidad ?? source.qty ?? source.quantity ?? source.unidades);
    if (!productId || !name || !Number.isInteger(quantity) || quantity < 1) return null;
    if (!snapshot.productId) snapshot.productId = productId;
    if (!snapshot.nombre && !snapshot.name) snapshot.nombre = name;
    return { ...source, productId, productNameSnapshot:name, cantidad:quantity, productSnapshot:snapshot };
  }

  function normalizeQuickOrderBackupRecord(value){
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = { ...value };
    const customer = source.customer && typeof source.customer === 'object' && !Array.isArray(source.customer) ? source.customer : {};
    const rawItems = [source.items,source.productosPedido,source.pedidoItems,source.productos].find(Array.isArray) || [];
    const items = [];
    const itemIds = new Set();
    rawItems.forEach((rawItem) => {
      const item = normalizeQuickOrderBackupItem(rawItem);
      if (!item || itemIds.has(item.productId)) return;
      itemIds.add(item.productId);
      items.push(item);
    });
    const customerId = quickOrderBackupClean(source.customerId ?? source.clienteId ?? customer.id,180);
    const customerName = quickOrderBackupClean(source.customerName ?? source.clienteNombre ?? source.cliente ?? customer.name ?? customer.nombre,180);
    const deliveryDate = quickOrderBackupClean(source.fechaEntrega ?? source.deliveryDate ?? source.fechaEntregaPedido,10);
    const code = quickOrderBackupClean(source.codigo,40).toUpperCase();
    const identity = [code,deliveryDate,customerId,customerName,items.map((item) => item.productId + ':' + item.cantidad).join('|')].join('|');
    const id = quickOrderBackupClean(source.id,200) || ('pr_legacy_' + agendaHash(identity));
    const state = quickOrderBackupClean(source.estado,30).toLowerCase();
    const status = ['en_preparacion','listo','cancelado'].includes(state) ? state : (state === 'entregado' || source.entregado === true ? 'entregado' : 'pendiente');
    const createdAt = quickOrderBackupTimestamp(source.createdAt);
    const updatedAt = quickOrderBackupTimestamp(source.updatedAt) || createdAt;
    return {
      ...source,
      id,
      tipoPedido:'rapido',
      schemaVersion:Math.max(QUICK_ORDERS_BACKUP_SCHEMA_VERSION,Number(source.schemaVersion || 1) || 1),
      codigo:code,
      customerId,
      customerName,
      fechaEntrega:deliveryDate,
      prioridad:quickOrderBackupClean(source.prioridad,20).toLowerCase() === 'alta' ? 'alta' : 'normal',
      estado:status,
      entregado:status === 'entregado',
      createdAt,
      updatedAt,
      deliveredAt:status === 'entregado' ? quickOrderBackupClean(source.deliveredAt ?? source.entregadoAt,100) : '',
      items
    };
  }

  function normalizeQuickOrdersBackupValue(value){
    let source = value;
    if (typeof source === 'string'){
      try{ source = JSON.parse(source || '[]'); }catch(_){ source = []; }
    }
    const rows = Array.isArray(source) ? source : [];
    const byId = new Map();
    rows.forEach((raw) => {
      const record = normalizeQuickOrderBackupRecord(raw);
      if (!record) return;
      const previous = byId.get(record.id);
      if (!previous || record.updatedAt >= previous.updatedAt) byId.set(record.id,record);
    });
    return Array.from(byId.values());
  }

  function mergeQuickOrdersBackupValues(currentRaw,incomingRaw){
    const merged = normalizeQuickOrdersBackupValue(currentRaw);
    const index = new Map();
    merged.forEach((record,position) => index.set(record.id,position));
    normalizeQuickOrdersBackupValue(incomingRaw).forEach((record) => {
      if (!index.has(record.id)){
        index.set(record.id,merged.length);
        merged.push(record);
        return;
      }
      const position = index.get(record.id);
      if (record.updatedAt >= merged[position].updatedAt) merged[position] = record;
    });
    return merged;
  }

  function agendaSafeObject(value){
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function agendaClone(value){
    try{ return JSON.parse(JSON.stringify(value)); }catch(_){ return value; }
  }

  function agendaNormalizePurchaseItem(source, record, index){
    const raw = agendaSafeObject(source);
    const parent = agendaSafeObject(record);
    const snapshot = agendaSafeObject(raw.snapshot);
    const materialId = agendaClean(raw.materialId || snapshot.materialId || raw.id || parent.materialId,160);
    const name = agendaClean(raw.name || raw.materialName || snapshot.name || parent.materialName || parent.subject,120);
    const category = agendaClean(raw.category || snapshot.category || parent.category,80);
    const unit = agendaUnit(raw.unit || snapshot.unit || parent.unit);
    const priceUsed = agendaNumber(raw.priceUsed ?? raw.price ?? snapshot.priceUsed ?? parent.priceUsed ?? parent.price,0);
    const quantity = agendaNumber(raw.quantity ?? parent.quantity,null);
    const storedSubtotal = agendaNumber(raw.subtotal ?? parent.subtotal,null);
    const subtotal = storedSubtotal == null && quantity != null ? agendaRound2(priceUsed * quantity) : agendaRound2(storedSubtotal || 0);
    const capturedAt = agendaClean(snapshot.capturedAt || raw.capturedAt || parent.createdAt || '',80);
    const identity = [materialId,name,category,unit,priceUsed,quantity,subtotal,index || 0].join('|');
    return {
      draftId:agendaClean(raw.draftId || raw.lineId,180) || ('itm_legacy_' + agendaHash(identity)),
      materialId,
      name,
      category,
      unit,
      priceUsed,
      quantity,
      subtotal,
      snapshot:{ materialId,name,category,unit,priceUsed,capturedAt }
    };
  }

  function agendaExtractPurchaseItems(record){
    const source = agendaSafeObject(record);
    const group = agendaSafeObject(source.purchaseGroup);
    const purchase = agendaSafeObject(source.purchase);
    let candidates = null;
    if (Array.isArray(group.items)) candidates = group.items;
    else if (Array.isArray(source.purchaseItems)) candidates = source.purchaseItems;
    else if (Array.isArray(purchase.items)) candidates = purchase.items;
    else {
      const legacy = Object.keys(purchase).length ? purchase : (Object.keys(agendaSafeObject(source.compra)).length ? source.compra : source);
      candidates = [legacy];
    }
    return candidates.map((item,index) => agendaNormalizePurchaseItem(item,source,index)).filter((item) => {
      return !!item.name && !!item.unit && item.quantity != null && item.quantity > 0 && Number.isFinite(item.priceUsed) && item.priceUsed >= 0 && Number.isFinite(item.subtotal) && item.subtotal >= 0;
    });
  }

  function agendaPurchaseFingerprint(record, items){
    const source = agendaSafeObject(record);
    return [
      agendaDate(source.date || source.neededDate || source.fechaNecesaria),
      agendaStatus(source.status),
      agendaPriority(source.priority),
      agendaClean(source.notes,1200),
      (items || []).map((item) => [item.materialId,item.name,item.category,item.unit,item.priceUsed,item.quantity,item.subtotal].join('|')).join('||'),
      agendaClean(source.createdAt,80)
    ].join('::');
  }

  function agendaAggregatePurchase(items, createdAt){
    const rows = Array.isArray(items) ? items : [];
    if (rows.length === 1) return agendaClone(rows[0]);
    const total = agendaRound2(rows.reduce((sum,item) => sum + Number(item.subtotal || 0),0));
    const name = rows.length ? `Compra agrupada (${rows.length} artículos)` : 'Compra';
    return {
      materialId:'', name, category:'Varios', unit:'Unidad', priceUsed:total, quantity:rows.length ? 1 : null, subtotal:total,
      snapshot:{ materialId:'',name,category:'Varios',unit:'Unidad',priceUsed:total,capturedAt:createdAt || '' }
    };
  }

  function agendaNormalizeRecord(source){
    const record = agendaSafeObject(source);
    if (agendaClean(record.type,20).toLowerCase() !== 'compra') return agendaClone(record);
    const items = agendaExtractPurchaseItems(record);
    if (!items.length) throw new Error('Compra de Agenda sin artículos válidos.');
    const createdAt = agendaClean(record.createdAt,80) || new Date(0).toISOString();
    const updatedAt = agendaClean(record.updatedAt || record.createdAt,80) || createdAt;
    const totalGeneral = agendaRound2(items.reduce((sum,item) => sum + Number(item.subtotal || 0),0));
    const id = agendaClean(record.id,180) || ('agd_legacy_' + agendaHash(agendaPurchaseFingerprint(record,items)));
    return {
      ...agendaClone(record),
      id,
      subject:items.length === 1 ? items[0].name : `Compra agrupada · ${items.length} artículos`,
      type:'compra',
      client:'',
      clientId:'',
      modality:'',
      date:agendaDate(record.date || record.neededDate || record.fechaNecesaria),
      time:'',
      status:agendaStatus(record.status),
      priority:agendaPriority(record.priority),
      notes:agendaClean(record.notes,1200),
      createdAt,
      updatedAt,
      purchase:agendaAggregatePurchase(items,createdAt),
      purchaseGroup:{ version:AGENDA_PURCHASE_GROUP_VERSION,itemCount:items.length,totalGeneral,items }
    };
  }

  function agendaNormalizePayloadValue(value){
    const parsed = typeof value === 'string' ? JSON.parse(value) : agendaClone(value);
    const records = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.records) ? parsed.records : null);
    if (!records) throw new Error('El bloque Agenda no contiene una lista de registros válida.');
    const normalized = records.map((record) => agendaNormalizeRecord(record));
    const deduped = [];
    const positions = new Map();
    normalized.forEach((record) => {
      const key = agendaRecordMergeKey(record);
      if (!positions.has(key)){
        positions.set(key,deduped.length);
        deduped.push(record);
        return;
      }
      const position = positions.get(key);
      if (agendaRecordTimestamp(record) >= agendaRecordTimestamp(deduped[position])) deduped[position] = record;
    });
    return {
      schemaVersion:AGENDA_BACKUP_SCHEMA_VERSION,
      updatedAt:agendaClean(parsed && parsed.updatedAt,80) || new Date().toISOString(),
      records:deduped
    };
  }

  function parseAgendaBackupBlock(localStorageMap){
    const map = localStorageMap && typeof localStorageMap === 'object' ? localStorageMap : {};
    if (!Object.prototype.hasOwnProperty.call(map,AGENDA_BACKUP_KEY)) return { ok:true,present:false,value:null,summary:null };
    try{
      const value = agendaNormalizePayloadValue(map[AGENDA_BACKUP_KEY]);
      return { ok:true,present:true,value,summary:agendaBackupSummaryFromValue(value) };
    }catch(error){
      return { ok:false,present:true,reason:`Bloque Agenda inválido: ${error?.message || error}` };
    }
  }

  function agendaBackupSummaryFromValue(value){
    const records = value && Array.isArray(value.records) ? value.records : [];
    const purchases = records.filter((record) => agendaClean(record?.type,20).toLowerCase() === 'compra');
    return {
      schemaVersion:Number(value?.schemaVersion) || AGENDA_BACKUP_SCHEMA_VERSION,
      records:records.length,
      meetings:records.filter((record) => agendaClean(record?.type,20).toLowerCase() === 'reunion').length,
      tasks:records.filter((record) => agendaClean(record?.type,20).toLowerCase() === 'tarea').length,
      purchases:purchases.length,
      groupedPurchases:purchases.filter((record) => Number(record?.purchaseGroup?.itemCount || 0) > 1).length,
      purchaseItems:purchases.reduce((sum,record) => sum + Number(record?.purchaseGroup?.itemCount || 0),0),
      pending:purchases.filter((record) => record.status === 'pendiente').length,
      done:purchases.filter((record) => record.status === 'hecho').length,
      cancelled:purchases.filter((record) => record.status === 'cancelado').length
    };
  }

  function agendaBackupSummary(localStorageMap){
    const parsed = parseAgendaBackupBlock(localStorageMap);
    return parsed.ok && parsed.present ? { included:true,storageKey:AGENDA_BACKUP_KEY,...parsed.summary } : { included:false,storageKey:AGENDA_BACKUP_KEY };
  }

  function agendaRecordMergeKey(record){
    const source = agendaSafeObject(record);
    const id = agendaClean(source.id,180);
    if (id) return `id:${id}`;
    if (agendaClean(source.type,20).toLowerCase() === 'compra') return `purchase:${agendaHash(agendaPurchaseFingerprint(source,agendaExtractPurchaseItems(source)))}`;
    return `legacy:${agendaHash(JSON.stringify(source))}`;
  }

  function agendaRecordTimestamp(record){
    const value = new Date(agendaClean(record?.updatedAt || record?.createdAt,80)).getTime();
    return Number.isFinite(value) ? value : 0;
  }

  function mergeAgendaBackupValues(currentRaw, incomingRaw){
    const current = agendaNormalizePayloadValue(currentRaw || { records:[] });
    const incoming = agendaNormalizePayloadValue(incomingRaw || { records:[] });
    const merged = current.records.slice();
    const index = new Map();
    merged.forEach((record,position) => index.set(agendaRecordMergeKey(record),position));
    incoming.records.forEach((record) => {
      const key = agendaRecordMergeKey(record);
      if (index.has(key)){
        const position = index.get(key);
        if (agendaRecordTimestamp(record) >= agendaRecordTimestamp(merged[position])) merged[position] = record;
      } else {
        index.set(key,merged.length);
        merged.push(record);
      }
    });
    return {
      schemaVersion:AGENDA_BACKUP_SCHEMA_VERSION,
      updatedAt:new Date().toISOString(),
      records:merged
    };
  }

  function isSuiteLocalStorageKey(key){
    if (!key) return false;
    const s = String(key || '').toLowerCase();
    return SUITE_LS_PREFIXES.some((p) => s.startsWith(String(p || '').toLowerCase()));
  }

  function isSuiteDbName(name){
    if (!name) return false;
    if (name === 'finanzasDB') return true;
    const n = String(name).toLowerCase();
    return n.includes('a33') || n.includes('arcano') || n.includes('finanzas');
  }

  function isRetiredGateStorageKey(key){
    try{
      if (window.A33Storage && typeof window.A33Storage.isRetiredGateKey === 'function'){
        return !!window.A33Storage.isRetiredGateKey(key);
      }
    }catch(_){ }
    const s = String(key || '').toLowerCase().trim();
    if (!s) return false;
    const retiredTags = [
      ['au','th'],
      ['log','in'],
      ['un','lock'],
      ['ses','sion'],
      ['pro','file'],
      ['per','fil'],
      ['last','url'],
      ['p','in'],
      ['ac','ceso'],
      ['ac','cess']
    ].map((parts) => parts.join(''));
    const exact = new Set([
      ['suite_a33_', ['au','th'].join(''), '_v1'].join(''),
      ['suite_a33_', ['pro','file'].join(''), '_v1'].join(''),
      ['suite_a33_', ['ses','sion'].join(''), '_v1'].join(''),
      ['suite_a33_', ['p','in'].join('')].join(''),
      ['suite_a33_exec_', ['un','lock'].join(''), '_v1'].join(''),
      ['suite_a33_last_url_v1'].join('')
    ]);
    if (exact.has(s)) return true;
    const prefixed = SUITE_LS_PREFIXES.some((p) => s.startsWith(String(p || '').toLowerCase()));
    if (!prefixed) return false;
    return retiredTags.some((tag) => {
      if (!tag) return false;
      if (tag === 'lasturl') return /(?:^|[_-])last[_-]?url(?:[_-]|$)/.test(s);
      const rx = new RegExp('(?:^|[_-])' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[_-]|$)');
      return rx.test(s);
    });
  }

  function isRetiredGateDbName(name){
    try{
      if (window.A33Storage && typeof window.A33Storage.isRetiredGateDbName === 'function'){
        return !!window.A33Storage.isRetiredGateDbName(name);
      }
    }catch(_){ }
    const s = String(name || '').toLowerCase().trim();
    if (!s) return false;
    const looksSuite = s.includes('a33') || s.includes('arcano') || s.includes('suite');
    if (!looksSuite) return false;
    const retiredTags = [
      ['au','th'],
      ['log','in'],
      ['un','lock'],
      ['ses','sion'],
      ['pro','file'],
      ['p','in'],
      ['ac','ceso'],
      ['ac','cess']
    ].map((parts) => parts.join(''));
    return retiredTags.some((tag) => {
      const rx = new RegExp('(?:^|[_-])' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[_-]|$)');
      return rx.test(s);
    });
  }

  function isRetiredGateStoreName(name){
    const s = String(name || '').toLowerCase().trim();
    if (!s) return false;
    const retiredTags = [
      ['au','th'],
      ['log','in'],
      ['un','lock'],
      ['ses','sion'],
      ['pro','file'],
      ['p','in'],
      ['ac','ceso'],
      ['ac','cess']
    ].map((parts) => parts.join(''));
    return retiredTags.some((tag) => {
      const rx = new RegExp('(?:^|[_-])' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[_-]|$)');
      return rx.test(s);
    });
  }

  function sanitizeSuiteLocalStorageMap(mapLike){
    const src = (mapLike && typeof mapLike === 'object') ? mapLike : {};
    const out = {};
    for (const [k, v] of Object.entries(src)){
      if (!isSuiteLocalStorageKey(k)) continue;
      if (k === LAST_EXPORT_KEY) continue; // Seguimiento propio de este navegador, no transferible.
      if (isRetiredGateStorageKey(k)) continue;
      if (k === AGENDA_BACKUP_KEY){
        const agenda = parseAgendaBackupBlock({ [AGENDA_BACKUP_KEY]:v });
        out[k] = agenda.ok && agenda.present ? JSON.stringify(agenda.value) : v;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function sanitizeIndexedDbPayload(indexedMap, dbSchemas, dbVersions){
    const src = (indexedMap && typeof indexedMap === 'object') ? indexedMap : {};
    const cleanData = {};
    const cleanSchemas = {};
    const cleanVersions = {};
    for (const [dbName, stores] of Object.entries(src)){
      if (!isSuiteDbName(dbName)) continue;
      if (isRetiredGateDbName(dbName)) continue;

      const safeStores = {};
      const storeEntries = (stores && typeof stores === 'object') ? Object.entries(stores) : [];
      for (const [storeName, records] of storeEntries){
        if (isRetiredGateStoreName(storeName)) continue;
        safeStores[storeName] = Array.isArray(records) ? records : [];
      }
      cleanData[dbName] = safeStores;

      const srcSchemaDb = (dbSchemas && typeof dbSchemas === 'object' && dbSchemas[dbName] && typeof dbSchemas[dbName] === 'object')
        ? dbSchemas[dbName]
        : {};
      const safeSchemaDb = {};
      for (const [storeName, schema] of Object.entries(srcSchemaDb)){
        if (isRetiredGateStoreName(storeName)) continue;
        safeSchemaDb[storeName] = schema;
      }
      cleanSchemas[dbName] = safeSchemaDb;

      if (dbVersions && Object.prototype.hasOwnProperty.call(dbVersions, dbName)){
        cleanVersions[dbName] = dbVersions[dbName];
      }
    }
    return { data: cleanData, schemas: cleanSchemas, versions: cleanVersions };
  }

  function sanitizeBackupObject(obj){
    const src = (obj && typeof obj === 'object') ? obj : {};
    const meta = (src.meta && typeof src.meta === 'object') ? src.meta : {};
    const data = (src.data && typeof src.data === 'object') ? src.data : {};
    const cleanIndexed = sanitizeIndexedDbPayload(data.indexedDB || {}, meta.dbSchemas || {}, meta.dbVersions || {});
    return {
      meta: {
        ...meta,
        dbSchemas: cleanIndexed.schemas,
        dbVersions: cleanIndexed.versions
      },
      data: {
        indexedDB: cleanIndexed.data,
        localStorage: sanitizeSuiteLocalStorageMap(data.localStorage || {})
      }
    };
  }

  function emptyCostsBackupValue(){
    return {
      schemaVersion:COSTS_BACKUP_SCHEMA_VERSION,
      liquids:{
        vino:{ price:null, ml:null },
        vodka:{ price:null, ml:null },
        jugo:{ price:null, ml:null },
        sirope:{ price:null, ml:null },
        agua_pura:{ price:null, ml:null }
      },
      consumablesByProduct:{},
      updatedAt:null
    };
  }

  function parseCostsBackupBlock(localStorageMap){
    const map = localStorageMap && typeof localStorageMap === 'object' ? localStorageMap : {};
    if (!Object.prototype.hasOwnProperty.call(map, COSTS_BACKUP_KEY)) return { ok:true, present:false, version:null, value:null };
    const raw = map[COSTS_BACKUP_KEY];
    let value = raw;
    if (typeof raw === 'string'){
      try{ value = JSON.parse(raw); }
      catch(_){ return { ok:false, present:true, reason:'El bloque Costos contiene JSON inválido.' }; }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok:false, present:true, reason:'El bloque Costos no tiene una estructura válida.' };
    const versionRaw = value.schemaVersion ?? value.version ?? 1;
    const version = Number(versionRaw);
    if (!Number.isInteger(version) || version < 1 || version > COSTS_BACKUP_SCHEMA_VERSION){
      return { ok:false, present:true, reason:`Versión de Costos no compatible: ${String(versionRaw)}.` };
    }
    const liquids = value.liquids && typeof value.liquids === 'object' && !Array.isArray(value.liquids) ? value.liquids : {};
    for (const [key, item] of Object.entries(liquids)){
      if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok:false, present:true, reason:`Líquido inválido en Costos: ${key}.` };
      for (const field of ['price','ml']){
        const v = item[field];
        if (v === null || v === undefined || v === '') continue;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return { ok:false, present:true, reason:`Valor inválido en Costos: ${key}.${field}.` };
      }
    }
    const consumables = value.consumablesByProduct || value.consumiblesPorProducto || {};
    if (!consumables || typeof consumables !== 'object' || Array.isArray(consumables)) return { ok:false, present:true, reason:'Consumibles de Costos inválidos.' };
    for (const [productId, item] of Object.entries(consumables)){
      if (!String(productId || '').trim() || !item || typeof item !== 'object' || Array.isArray(item)) return { ok:false, present:true, reason:'Consumible por productId inválido.' };
      for (const field of ['botella','calcomania']){
        const v = item[field];
        if (v === null || v === undefined || v === '') continue;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return { ok:false, present:true, reason:`Valor inválido en Costos para productId ${productId}.` };
      }
    }
    return { ok:true, present:true, version, value };
  }

  function escapeHtml(str){
    return String(str ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#039;');
  }

  function formatBytes(bytes){
    const b = Number(bytes || 0);
    if (!Number.isFinite(b) || b <= 0) return '0 B';
    const units = ['B','KB','MB','GB'];
    let v = b;
    let i = 0;
    while (v >= 1024 && i < units.length - 1){
      v /= 1024;
      i++;
    }
    return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  const PWA_KEYS = {
    lastCheck: 'suite_a33_pwa_last_check_at',
    lastUpdate: 'suite_a33_pwa_last_update_at',
    status: 'suite_a33_pwa_update_status',
    reloadGuard: 'suite_a33_pwa_apply_reload_guard_v1',
    report: 'suite_a33_pwa_report_v1',
    automatic: 'suite_a33_pwa_automatic_activation_v1',
    notice: 'suite_a33_pwa_activation_notice_v1'
  };

  const PWA_STATUS = {
    idle: 'Sin revisar',
    checking: 'Buscando actualizaciones...',
    current: 'Revisión completa: sin actualizaciones pendientes',
    noRegistered: 'No se pudo verificar la Suite; vuelve a buscar con conexión',
    partialSearch: 'No se pudo verificar toda la Suite',
    partialApply: 'Actualización parcial',
    available: 'Actualización disponible',
    applying: 'Aplicando actualización...',
    applied: 'Activación confirmada',
    noPending: 'No hay actualización pendiente',
    automatic: 'Activación automática confirmada',
    reconciling: 'Comprobando estado en este dispositivo...',
    searchError: 'Error al buscar actualización',
    applyError: 'Error al aplicar actualización'
  };

  const PWA_MODULES = [
    ['pos', 'POS'], ['inventario', 'Inventario'], ['lotes', 'Lotes'],
    ['pedidos', 'Pedidos'], ['catalogos', 'Catálogos'], ['calculadora', 'Calculadora'],
    ['agenda', 'Agenda'], ['centro-mando', 'Centro de Mando'],
    ['calculadora_temporal', 'Calculadora Temporal'],
    ['finanzas', 'Finanzas'], ['analitica', 'Analítica']
  ];

  function getPwaModule(reg){
    try{
      const base = new URL('../', window.location.href);
      const scope = new URL(reg.scope);
      const script = new URL(getWorkerUrl(reg));
      return PWA_MODULES.find(([id]) => {
        const expected = new URL(id + '/', base);
        return scope.href === expected.href && script.origin === expected.origin && script.pathname === expected.pathname + 'sw.js';
      }) || null;
    }catch(_){ return null; }
  }

  function savePwaReport(kind, results){
    pwaRuntime.lastResults = results;
    pwaStorageSet(PWA_KEYS.report, JSON.stringify({ kind, results }));
  }

  const pwaRuntime = {
    checking: false,
    applying: false,
    reconciling: false,
    needsReconcile: false,
    observedWorkers: new Set(),
    updateAvailable: false,
    lastResults: []
  };

  function pwaStorageGet(key){
    try{
      if (window.A33Storage && typeof window.A33Storage.getItem === 'function'){
        const v = window.A33Storage.getItem(key);
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
      }
    }catch(_){ }
    try{
      const v = localStorage.getItem(key);
      return (v && String(v).trim()) ? String(v) : '';
    }catch(_){ return ''; }
  }

  function pwaStorageSet(key, value){
    try{
      if (window.A33Storage && typeof window.A33Storage.setItem === 'function'){
        window.A33Storage.setItem(key, String(value));
        return;
      }
    }catch(_){ }
    try{ localStorage.setItem(key, String(value)); }catch(_){ }
  }

  function pwaSessionGet(key){
    try{ return sessionStorage.getItem(key) || ''; }catch(_){ return ''; }
  }

  function pwaSessionSet(key, value){
    try{ sessionStorage.setItem(key, String(value)); }catch(_){ }
  }

  function pwaPad2(value){
    return String(value).padStart(2, '0');
  }

  function formatPwaDateForStorage(date){
    const d = (date instanceof Date) ? date : new Date();
    return `${pwaPad2(d.getDate())}/${pwaPad2(d.getMonth() + 1)}/${d.getFullYear()} ${pwaPad2(d.getHours())}:${pwaPad2(d.getMinutes())}`;
  }

  function formatPwaTimestamp(value){
    const raw = String(value || '').trim();
    if (!raw) return 'Sin registros';
    if (/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}$/.test(raw)) return raw;
    let date = null;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) date = new Date(n);
    if (!date || Number.isNaN(date.getTime())) date = new Date(raw);
    if (!date || Number.isNaN(date.getTime())) return raw;
    return formatPwaDateForStorage(date);
  }

  function normalizePwaStatus(status){
    const s = String(status || '').trim();
    if (!s) return PWA_STATUS.idle;
    if (s === 'Actualización aplicada') return PWA_STATUS.applied;
    if (s === 'Suite actualizada' || s === 'Suite actualizada / No se encontraron actualizaciones') return PWA_STATUS.current;
    if (s === 'Error al buscar actualizaciones') return PWA_STATUS.searchError;
    if (s === 'Búsqueda registrada') return PWA_STATUS.idle;
    if (s === 'Sin actualizaciones en los módulos revisados') return PWA_STATUS.current;
    if (s === 'No hay módulos PWA registrados') return PWA_STATUS.noRegistered;
    if (s === 'No se pudo verificar: abre los módulos con conexión') return PWA_STATUS.noRegistered;
    if (s === 'Búsqueda incompleta') return PWA_STATUS.partialSearch;
    return s;
  }

  function getPwaStateKey(status){
    const s = normalizePwaStatus(status);
    if (s === PWA_STATUS.checking) return 'checking';
    if (s === PWA_STATUS.available) return 'available';
    if (s === PWA_STATUS.applying) return 'applying';
    if (s === PWA_STATUS.applied || s === PWA_STATUS.automatic) return 'applied';
    if (s === PWA_STATUS.noPending) return 'nopending';
    if (s === PWA_STATUS.partialSearch || s === PWA_STATUS.partialApply) return 'error';
    if (s === PWA_STATUS.searchError || s === PWA_STATUS.applyError) return 'error';
    if (s === PWA_STATUS.current) return 'current';
    return 'idle';
  }

  function isPwaUpdateAvailableStatus(status){
    return getPwaStateKey(status) === 'available';
  }

  function getWorkerUrl(reg){
    try{
      const worker = reg && (reg.waiting || reg.installing || reg.active);
      return worker && worker.scriptURL ? String(worker.scriptURL) : '';
    }catch(_){ return ''; }
  }

  function isSuiteServiceWorkerRegistration(reg){
    return !!getPwaModule(reg);
  }

  function hasPwaPendingWorker(reg){
    try{ return !!(reg && (reg.waiting || reg.installing)); }catch(_){ return false; }
  }

  async function getSuitePwaRegistrations(){
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker || typeof navigator.serviceWorker.getRegistrations !== 'function'){
      throw new Error('Este navegador no permite consultar Service Workers.');
    }
    const rawRegs = await navigator.serviceWorker.getRegistrations();
    return (Array.isArray(rawRegs) ? rawRegs : []).filter(isSuiteServiceWorkerRegistration);
  }

  function withPwaTimeout(task, timeoutMs){
    let timer;
    return Promise.race([
      task,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('La revisión tardó demasiado. Vuelve a buscar con conexión.')), timeoutMs);
      })
    ]).finally(() => clearTimeout(timer));
  }

  function readPwaRecord(key){
    try{ return JSON.parse(pwaStorageGet(key) || 'null'); }catch(_){ return null; }
  }

  function observePwaActivation(reg, worker){
    if (!worker || !['installing', 'installed', 'activating'].includes(worker.state) || !reg.active || worker === reg.active || pwaRuntime.observedWorkers.has(worker)) return;
    const module = getPwaModule(reg);
    if (!module) return;
    pwaRuntime.observedWorkers.add(worker);
    const onState = () => {
      if (!['activated', 'redundant'].includes(worker.state)) return;
      worker.removeEventListener('statechange', onState);
      pwaRuntime.observedWorkers.delete(worker);
      // La misma URL no demuestra identidad: debe ser el worker observado.
      if (worker.state === 'activated' && !pwaRuntime.applying){
        const record = { id:module[0], at:new Date().toISOString(), recorded:false };
        pwaStorageSet(PWA_KEYS.automatic, JSON.stringify(record));
        pwaStorageSet(PWA_KEYS.notice, JSON.stringify({ kind:'automatic', at:record.at }));
      }
      reconcilePwaState();
    };
    worker.addEventListener('statechange', onState);
    onState();
  }

  async function reconcilePwaState(){
    if (pwaRuntime.checking || pwaRuntime.applying || pwaRuntime.reconciling){
      pwaRuntime.needsReconcile = true;
      return;
    }
    pwaRuntime.reconciling = true;
    pwaRuntime.needsReconcile = false;
    pwaRuntime.updateAvailable = false;
    renderPwaSection();
    try{
      // Consulta local: no registra módulos, descarga, aplica ni recarga páginas.
      let regs = await withPwaTimeout(getSuitePwaRegistrations(), 12000);
      const activating = regs.filter(reg => reg.active?.state === 'activating');
      if (activating.length){
        await Promise.all(activating.map(reg => waitForWorkerState(reg.active, ['activated', 'redundant'], 6500)));
        regs = await withPwaTimeout(getSuitePwaRegistrations(), 12000);
      }
      let disappeared = false;
      const results = PWA_MODULES.map(([id, label]) => {
        const previous = pwaRuntime.lastResults.find(row => row.id === id);
        const reg = regs.find(candidate => getPwaModule(candidate)?.[0] === id);
        if (!reg) return { id, label, status:'missing', error:'' };
        observePwaActivation(reg, reg.waiting || reg.installing);
        if (previous?.status === 'error') return previous;
        if (reg.waiting?.state === 'installed') return { id, label, status:'available', error:'' };
        if (reg.installing || !reg.active || reg.active.state !== 'activated') return { id, label, status:'installing', error:'', wasPending:previous?.status === 'available' || !!previous?.wasPending };
        if (previous?.status === 'available' || previous?.wasPending) disappeared = true;
        return { id, label, status:previous?.status === 'activated' ? 'activated' : 'current', error:'' };
      });
      const incomplete = results.some(row => !['current', 'activated', 'available'].includes(row.status));
      const automatic = readPwaRecord(PWA_KEYS.automatic);
      const confirmed = automatic && PWA_MODULES.some(([id]) => id === automatic.id) && Number.isFinite(Date.parse(automatic.at));
      if (disappeared && (!confirmed || automatic.recorded)){
        pwaStorageSet(PWA_KEYS.notice, JSON.stringify({ kind:'unconfirmed' }));
      }
      if (confirmed){
        if (!automatic.recorded && !incomplete && !results.some(row => row.status === 'available')){
          pwaStorageSet(PWA_KEYS.lastUpdate, formatPwaTimestamp(automatic.at));
          pwaStorageSet(PWA_KEYS.automatic, JSON.stringify({ ...automatic, recorded:true }));
        }
      }
      const confirmedNotice = confirmed && readPwaRecord(PWA_KEYS.notice)?.kind === 'automatic';
      const priorStatus = normalizePwaStatus(pwaStorageGet(PWA_KEYS.status));
      const incompleteStatus = [PWA_STATUS.partialApply, PWA_STATUS.applyError].includes(priorStatus) ? priorStatus : PWA_STATUS.partialSearch;
      pwaRuntime.updateAvailable = results.some(row => row.status === 'available');
      savePwaReport('reconcile', results);
      let status = PWA_STATUS.noPending;
      if (incomplete) status = incompleteStatus;
      else if (pwaRuntime.updateAvailable) status = PWA_STATUS.available;
      else if (priorStatus === PWA_STATUS.applied) status = PWA_STATUS.applied;
      else if (confirmedNotice) status = PWA_STATUS.automatic;
      else if (priorStatus === PWA_STATUS.current) status = PWA_STATUS.current;
      pwaStorageSet(PWA_KEYS.status, status);
    }catch(_){
      pwaRuntime.updateAvailable = false;
      pwaStorageSet(PWA_KEYS.status, PWA_STATUS.partialSearch);
    }finally{
      pwaRuntime.reconciling = false;
      renderPwaSection();
      if (pwaRuntime.needsReconcile) reconcilePwaState();
    }
  }

  async function inspectPwaRegistration(reg, fresh = false){
    const [id, label] = getPwaModule(reg);
    const result = { id, label, status: 'current', error: '' };
    let observed = reg.installing || reg.waiting;
    const onFound = () => { observed = reg.installing || observed; observePwaActivation(reg, observed); };
    observePwaActivation(reg, observed);
    try{
      reg.addEventListener('updatefound', onFound);
      if (!fresh) await withPwaTimeout(reg.update(), 12000);
      const worker = reg.installing || reg.waiting || observed;
      if (worker && worker.state === 'installing') await waitForWorkerState(worker, ['installed', 'activated', 'redundant'], 6500);
      if (fresh && worker && worker.state === 'installed' && !reg.active) await waitForWorkerState(worker, ['activated', 'redundant'], 6500);
      if (worker && worker.state === 'redundant') throw new Error('La instalación de la actualización falló.');
      if (reg.waiting && reg.waiting.state === 'installed') result.status = 'available';
      else if (reg.installing) result.status = 'installing';
      else if (!reg.active || reg.active.state !== 'activated') result.status = 'installing';
    }catch(err){
      result.status = 'error';
      result.error = String(err && err.message || err);
    }finally{
      try{ reg.removeEventListener('updatefound', onFound); }catch(_){ }
    }
    return result;
  }

  async function checkSuitePwaUpdates(){
    const regs = await withPwaTimeout(getSuitePwaRegistrations(), 12000);
    const base = new URL('../', window.location.href);
    const results = await Promise.all(PWA_MODULES.map(async ([id, label]) => {
      let reg = regs.find(candidate => getPwaModule(candidate)?.[0] === id);
      const fresh = !reg;
      if (!reg){
        try{
          const scope = new URL(id + '/', base);
          // Solo prepara registros faltantes. Conserva la URL de los existentes.
          reg = await withPwaTimeout(navigator.serviceWorker.register(new URL('sw.js', scope).href, { scope:scope.href, updateViaCache:'none' }), 12000);
        }catch(err){
          return { id, label, status:'error', error:String(err && err.message || err) };
        }
      }
      return inspectPwaRegistration(reg, fresh);
    }));
    return {
      available: results.some(row => row.status === 'available'),
      checked: results.filter(row => row.status !== 'error').length,
      incomplete: results.some(row => ['missing', 'error', 'installing'].includes(row.status)),
      errors: results.filter(row => row.error).map(row => row.error), results
    };
  }

  function waitForWorkerState(worker, states, timeoutMs){
    return new Promise((resolve) => {
      const wanted = new Set((Array.isArray(states) ? states : [states]).map((s) => String(s || '').toLowerCase()));
      if (!worker){ resolve(''); return; }
      const current = String(worker.state || '').toLowerCase();
      if (wanted.has(current)){ resolve(current); return; }

      let done = false;
      let timer = null;
      const finish = (value) => {
        if (done) return;
        done = true;
        try{ if (timer) clearTimeout(timer); }catch(_){ }
        try{ worker.removeEventListener('statechange', onStateChange); }catch(_){ }
        resolve(value || String(worker.state || '').toLowerCase());
      };
      const onStateChange = () => {
        const st = String(worker.state || '').toLowerCase();
        if (wanted.has(st) || st === 'redundant') finish(st);
      };
      try{ worker.addEventListener('statechange', onStateChange); }catch(_){ }
      timer = setTimeout(() => finish(String(worker.state || '').toLowerCase()), Number(timeoutMs) || 3000);
    });
  }

  async function resolvePwaWaitingWorker(reg){
    try{
      if (reg && reg.waiting) return reg.waiting;
      const installing = reg && reg.installing;
      if (!installing) return null;
      const state = String(installing.state || '').toLowerCase();
      if (state === 'installed' && reg.waiting) return reg.waiting;
      await waitForWorkerState(installing, ['installed', 'activated', 'redundant'], 3500);
      return reg.waiting || (String(installing.state || '').toLowerCase() === 'activated' ? installing : null);
    }catch(_){ return null; }
  }

  function sendPwaSkipWaiting(worker){
    try{
      if (worker && typeof worker.postMessage === 'function'){
        worker.postMessage({ type: 'SKIP_WAITING' });
        return true;
      }
    }catch(_){ }
    return false;
  }

  function waitForPwaRegistrationActivation(reg, worker, timeoutMs){
    return new Promise((resolve) => {
      if (!reg){ resolve(false); return; }
      const target = worker || reg.waiting || reg.installing;
      let done = false;
      let timer = null;
      let interval = null;

      const isActivated = () => {
        try{
          if (target && String(target.state || '').toLowerCase() === 'activated') return true;
          if (target && reg.active === target && reg.active.state === 'activated') return true;
        }catch(_){ }
        return false;
      };

      const finish = (value) => {
        if (done) return;
        done = true;
        try{ if (timer) clearTimeout(timer); }catch(_){ }
        try{ if (interval) clearInterval(interval); }catch(_){ }
        try{ if (target && typeof target.removeEventListener === 'function') target.removeEventListener('statechange', onStateChange); }catch(_){ }
        resolve(!!value);
      };

      const onStateChange = () => {
        if (isActivated()) finish(true);
        else if (target && String(target.state || '').toLowerCase() === 'redundant') finish(false);
      };

      if (isActivated()){
        finish(true);
        return;
      }

      try{ if (target && typeof target.addEventListener === 'function') target.addEventListener('statechange', onStateChange); }catch(_){ }
      interval = setInterval(() => {
        if (isActivated()) finish(true);
      }, 180);
      timer = setTimeout(() => finish(isActivated()), Number(timeoutMs) || 6500);
    });
  }

  async function collectPendingPwaRegistrations(){
    const regs = await withPwaTimeout(getSuitePwaRegistrations(), 12000);
    const pending = [];
    for (const reg of regs){
      if (!hasPwaPendingWorker(reg)) continue;
      const observed = reg.waiting || reg.installing;
      const worker = await resolvePwaWaitingWorker(reg);
      pending.push({ reg, worker: worker || reg.waiting || reg.installing || observed });
    }
    return pending;
  }

  async function applySuitePwaUpdate(){
    // Revisa el conjunto completo también cuando hay workers pendientes.
    let summary = await checkSuitePwaUpdates();
    const pending = (await collectPendingPwaRegistrations()).filter(({ reg }) => {
      return summary.results.find(row => row.id === getPwaModule(reg)?.[0])?.status !== 'error';
    });

    if (!pending.length){
      // El navegador pudo activar el worker entre la búsqueda y este paso.
      if (summary.available) summary = await checkSuitePwaUpdates();
      const incomplete = summary.incomplete || summary.available;
      return { applied:false, noPending:!incomplete, searchIncomplete:incomplete, results:summary.results };
    }

    const results = await Promise.all(pending.map(async ({ reg, worker }) => {
      const [id, label] = getPwaModule(reg);
      const row = { id, label, status: 'error', error: '' };
      try{
        const target = worker || await resolvePwaWaitingWorker(reg);
        if (!target || !['installed', 'activated'].includes(target.state)) throw new Error('La actualización no está lista para aplicar.');
        if (target.state !== 'activated' && !sendPwaSkipWaiting(target)) throw new Error('No se pudo solicitar la activación.');
        if (!await waitForPwaRegistrationActivation(reg, target, 7000)) throw new Error('No se confirmó la activación de esta actualización.');
        row.status = 'activated';
      }catch(err){ row.error = String(err && err.message || err); }
      return row;
    }));
    const allResults = summary.results.map(row => results.find(applied => applied.id === row.id) || row);
    const incomplete = allResults.some(row => !['current', 'activated'].includes(row.status));
    const activated = results.some(row => row.status === 'activated');
    return { applied:activated && !incomplete, partial:activated && incomplete, results:allResults };
  }

  function renderPwaSection(){
    const statusEl = document.getElementById('cfg-pwa-status');
    const lastCheckEl = document.getElementById('cfg-pwa-last-check');
    const lastUpdateEl = document.getElementById('cfg-pwa-last-update');
    const btn = document.getElementById('cfg-pwa-check');
    const dashboard = document.querySelector('.cfg-pwa-dashboard');
    const storedStatus = normalizePwaStatus(pwaStorageGet(PWA_KEYS.status));
    const status = pwaRuntime.checking ? PWA_STATUS.checking : (pwaRuntime.applying ? PWA_STATUS.applying : (pwaRuntime.reconciling ? PWA_STATUS.reconciling : storedStatus));
    const stateKey = getPwaStateKey(status);

    if (statusEl){
      statusEl.textContent = status;
      try{ statusEl.closest('.cfg-status-card')?.setAttribute('data-pwa-state', stateKey); }catch(_){ }
    }
    if (dashboard) dashboard.setAttribute('data-pwa-state', stateKey);
    if (lastCheckEl) lastCheckEl.textContent = formatPwaTimestamp(pwaStorageGet(PWA_KEYS.lastCheck));
    if (lastUpdateEl) lastUpdateEl.textContent = formatPwaTimestamp(pwaStorageGet(PWA_KEYS.lastUpdate));
    const noticeEl = document.getElementById('cfg-pwa-activation-notice');
    if (noticeEl){
      const notice = readPwaRecord(PWA_KEYS.notice);
      noticeEl.textContent = notice?.kind === 'automatic' ? 'Se confirmó una activación automática el ' + formatPwaTimestamp(notice.at) + '. Abre los módulos para cargar el código activo.' : (notice?.kind === 'unconfirmed' ? 'La actualización pendiente ya no aparece. No se pudo confirmar su activación; se conserva la fecha histórica.' : '');
      noticeEl.hidden = !noticeEl.textContent;
    }

    const reportEl = document.getElementById('cfg-pwa-report');
    if (reportEl){
      const labels = { current:'Sin actualización pendiente', available:'Actualización lista para aplicar', installing:'Instalación todavía en curso', missing:'No registrado; no se revisó', error:'No se pudo completar', activated:'Activación confirmada; abre el módulo para cargar su código' };
      reportEl.replaceChildren();
      for (const row of pwaRuntime.lastResults){
        const item = document.createElement('li');
        item.textContent = row.label + ': ' + (labels[row.status] || 'Sin verificar') + (row.error ? ' — ' + row.error : '');
        reportEl.appendChild(item);
      }
    }

    const available = pwaRuntime.updateAvailable || isPwaUpdateAvailableStatus(status);
    const busy = !!(pwaRuntime.checking || pwaRuntime.applying || pwaRuntime.reconciling);
    if (btn){
      btn.textContent = pwaRuntime.checking ? 'Buscando...' : 'Buscar actualizaciones';
      btn.disabled = busy;
      btn.setAttribute('data-pwa-action', 'check');
      btn.classList.toggle('cfg-btn-pwa-checking', !!pwaRuntime.checking);
    }
    const applyBtn = document.getElementById('cfg-pwa-apply');
    if (applyBtn){
      applyBtn.textContent = pwaRuntime.applying ? 'Actualizando...' : 'Actualizar Suite';
      applyBtn.disabled = busy || !available;
      applyBtn.classList.toggle('cfg-btn-pwa-apply', available && !busy);
      applyBtn.classList.toggle('cfg-btn-pwa-applying', !!pwaRuntime.applying);
    }
  }

  async function handlePwaCheck(){
    if (pwaRuntime.checking || pwaRuntime.applying || pwaRuntime.reconciling) return;

    pwaRuntime.checking = true;
    showToast('Buscando actualización…');
    pwaRuntime.updateAvailable = false;
    pwaStorageSet(PWA_KEYS.lastCheck, formatPwaDateForStorage(new Date()));
    pwaStorageSet(PWA_KEYS.status, PWA_STATUS.checking);
    renderPwaSection();

    try{
      const summary = await checkSuitePwaUpdates();
      savePwaReport('check', summary.results);
      pwaRuntime.updateAvailable = !!summary.available;

      if (!summary.checked){
        pwaStorageSet(PWA_KEYS.status, PWA_STATUS.noRegistered);
        showToast('No se pudo revisar la Suite. Vuelve a buscar con conexión.');
      } else if (summary.incomplete){
        pwaStorageSet(PWA_KEYS.status, PWA_STATUS.partialSearch);
        showToast(summary.available ? 'Hay una actualización disponible, pero la revisión de la Suite quedó incompleta.' : 'No se pudo verificar toda la Suite. Vuelve a buscar con conexión.');
      } else if (summary.available){
        pwaStorageSet(PWA_KEYS.status, PWA_STATUS.available);
        showToast('Hay actualizaciones listas para aplicar.');
      } else {
        pwaStorageSet(PWA_KEYS.status, PWA_STATUS.current);
        showToast('Sin actualizaciones pendientes en los módulos revisados.');
      }
    }catch(err){
      pwaRuntime.updateAvailable = false;
      pwaStorageSet(PWA_KEYS.status, PWA_STATUS.searchError);
      window.A33Notice.show(err && err.message ? err.message : 'Error al buscar actualización.', 'error');
    }finally{
      pwaRuntime.checking = false;
      renderPwaSection();
      if (pwaRuntime.needsReconcile) await reconcilePwaState();
    }
  }

  async function handlePwaApply(){
    if (pwaRuntime.checking || pwaRuntime.applying || pwaRuntime.reconciling) return;

    const ready = window.confirm('Antes de actualizar, guarda el trabajo pendiente y cierra las demás pestañas y ventanas de Suite A33.\n\nLa aplicación no comprueba automáticamente si hay trabajo abierto. Una caja o evento guardado puede continuar después.\n\n¿Ya guardaste el trabajo y cerraste las demás pestañas y ventanas?');
    if (!ready) return;

    pwaRuntime.applying = true;
    showToast('Aplicando actualización…');
    pwaStorageSet(PWA_KEYS.status, PWA_STATUS.applying);
    renderPwaSection();

    try{
      const result = await applySuitePwaUpdate();
      if (result.results) savePwaReport(result.searchIncomplete ? 'check' : 'apply', result.results);
      if (result.searchIncomplete){
        pwaRuntime.updateAvailable = false;
        pwaStorageSet(PWA_KEYS.status, PWA_STATUS.partialSearch);
        showToast('No se pudo confirmar una actualización lista para aplicar.');
        return;
      }
      if (result.noPending){
        pwaRuntime.updateAvailable = false;
        pwaStorageSet(PWA_KEYS.status, PWA_STATUS.noPending);
        showToast('No hay actualización pendiente en los módulos registrados.');
        return;
      }
      pwaRuntime.updateAvailable = !!result.results?.some(row => row.status === 'available');
      if (!result.applied){
        pwaStorageSet(PWA_KEYS.status, result.partial ? PWA_STATUS.partialApply : PWA_STATUS.applyError);
        showToast('La actualización no se completó. Vuelve a buscar para revisar lo pendiente.');
        return;
      }
      pwaStorageSet(PWA_KEYS.lastUpdate, formatPwaDateForStorage(new Date()));
      const automatic = readPwaRecord(PWA_KEYS.automatic);
      if (automatic) pwaStorageSet(PWA_KEYS.automatic, JSON.stringify({ ...automatic, recorded:true }));
      pwaStorageSet(PWA_KEYS.status, PWA_STATUS.applied);
      showToast('Activación confirmada. Abre los módulos para cargar el código actualizado.');
    }catch(err){
      pwaRuntime.updateAvailable = true;
      pwaStorageSet(PWA_KEYS.status, PWA_STATUS.applyError);
      window.A33Notice.show(err && err.message ? err.message : 'Error al aplicar actualización.', 'error');
    }finally{
      pwaRuntime.applying = false;
      renderPwaSection();
      if (pwaRuntime.needsReconcile) await reconcilePwaState();
    }
  }

  async function initPwaSection(){
    try{
      const report = JSON.parse(pwaStorageGet(PWA_KEYS.report) || 'null');
      if (report && Array.isArray(report.results)) pwaRuntime.lastResults = report.results.filter(row => row && typeof row === 'object' && PWA_MODULES.some(([id]) => id === row.id));
    }catch(_){ }
    const storedStatus = normalizePwaStatus(pwaStorageGet(PWA_KEYS.status));
    pwaRuntime.updateAvailable = isPwaUpdateAvailableStatus(storedStatus) || pwaRuntime.lastResults.some(row => row.status === 'available');
    if (storedStatus !== pwaStorageGet(PWA_KEYS.status)){
      pwaStorageSet(PWA_KEYS.status, storedStatus);
    }
    renderPwaSection();
    const btn = document.getElementById('cfg-pwa-check');
    if (btn) btn.addEventListener('click', handlePwaCheck);
    const applyBtn = document.getElementById('cfg-pwa-apply');
    if (applyBtn) applyBtn.addEventListener('click', handlePwaApply);
    window.addEventListener('pageshow', reconcilePwaState);
    window.addEventListener('focus', reconcilePwaState);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reconcilePwaState();
    });
    await reconcilePwaState();
  }

  function reqToPromise(req){
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB request error'));
    });
  }

  function txDone(tx){
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => reject(tx.error || new Error('Transacción abortada'));
      tx.onerror = () => reject(tx.error || new Error('Error en transacción'));
    });
  }

  async function storageDiagnosticWait(promise){
    let timer;
    try{
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('La consulta no respondió en 10 segundos.')), 10000);
      })]);
    }finally{ clearTimeout(timer); }
  }

  async function diagnoseStorageDatabase(name){
    const db = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled){ if (value) value.close(); return; }
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => finish(new Error('La apertura no respondió en 10 segundos.')), 10000);
      let request;
      try{ request = indexedDB.open(name); }
      catch(error){ finish(error); return; }
      request.onupgradeneeded = () => { try{ request.transaction.abort(); }catch(_){ } };
      request.onblocked = () => finish(new Error('Apertura bloqueada por otra conexión.'));
      request.onerror = () => finish(request.error || new Error('No se pudo abrir la base.'));
      request.onsuccess = () => finish(null, request.result);
    });
    const report = { name, version:db.version, stores:[] };
    try{
      for (const name of Array.from(db.objectStoreNames)){
        let tx;
        try{
          tx = db.transaction(name, 'readonly');
          const completed = txDone(tx);
          completed.catch(() => {});
          const [count] = await storageDiagnosticWait(Promise.all([reqToPromise(tx.objectStore(name).count()), completed]));
          report.stores.push({ name, status:'ok', count });
        }catch(error){ try{ tx?.abort(); }catch(_){ } report.stores.push({ name, status:'error', message:String(error?.message || error) }); }
      }
    }finally{ db.close(); }
    return report;
  }

  async function diagnoseStorage(){
    const report = { checkedAt:new Date().toISOString(), localStorage:{}, indexedDB:{}, capacity:{}, persistence:{} };
    try{
      const snapshot = getSuiteLocalStorageSnapshot();
      // Aproximación UTF-16; no equivale al uso de cuota calculado por el navegador.
      const bytes = Object.entries(snapshot.data).reduce((total, [key, value]) => total + 2 * (key.length + value.length), 0);
      report.localStorage = { status:'ok', keys:snapshot.keys.length, estimatedBytes:bytes };
    }catch(error){ report.localStorage = { status:'error', message:String(error?.message || error) }; }
    try{
      const listed = await storageDiagnosticWait(safeListIndexedDBDatabases());
      const names = Array.from(new Set(listed.map(item => item.name).filter(name => isSuiteDbName(name) && !isRetiredGateDbName(name))));
      const databases = [];
      for (const name of names){
        try{ databases.push(await diagnoseStorageDatabase(name)); }
        catch(error){ databases.push({ name, status:'error', message:String(error?.message || error), stores:[] }); }
      }
      report.indexedDB = { status:databases.some(db => db.status === 'error' || db.stores.some(store => store.status === 'error')) ? 'error' : 'ok', databases };
    }catch(error){ report.indexedDB = { status:typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function' ? 'unavailable' : 'error', message:String(error?.message || error), databases:[] }; }
    const storage = window.navigator && window.navigator.storage;
    for (const [field, method] of [['capacity','estimate'], ['persistence','persisted']]){
      if (!storage || typeof storage[method] !== 'function'){
        report[field] = { status:'unavailable', message:'El navegador no ofrece esta comprobación.' };
        continue;
      }
      try{
        const value = await storageDiagnosticWait(storage[method]());
        if (field === 'capacity'){
          if (!value || !Number.isFinite(value.usage) || !Number.isFinite(value.quota) || value.usage < 0 || value.quota <= 0) throw new Error('Estimación no disponible o inválida.');
          report[field] = { status:'ok', usage:value.usage, quota:value.quota };
        } else {
          if (typeof value !== 'boolean') throw new Error('Respuesta de persistencia inválida.');
          report[field] = { status:'ok', persisted:value };
        }
      }catch(error){ report[field] = { status:'error', message:String(error?.message || error) }; }
    }
    return report;
  }

  function storageDiagnosticHtml(report){
    const label = (item) => item.status === 'ok' ? 'Lectura disponible' : item.status === 'unavailable' ? 'No comprobable' : 'Error de lectura';
    const ls = report.localStorage;
    const idb = report.indexedDB;
    const capacity = report.capacity;
    const persistence = report.persistence;
    const databases = idb.databases.map(db => `<li><b>${escapeHtml(db.name)}</b> ${db.status === 'error' ? escapeHtml(db.message) : `(versión ${escapeHtml(db.version)})`}<ul>${db.stores.map(store => `<li>${escapeHtml(store.name)}: ${store.status === 'ok' ? `${store.count} registros` : escapeHtml(store.message)}</li>`).join('')}</ul></li>`).join('');
    return `<div><b>Comprobado:</b> ${escapeHtml(new Date(report.checkedAt).toLocaleString())}</div>
      <p><b>localStorage:</b> ${label(ls)}. ${ls.status === 'ok' ? `${ls.keys} claves de la Suite; tamaño aproximado ${escapeHtml(formatBytes(ls.estimatedBytes))}.` : escapeHtml(ls.message)}</p>
      <p><b>IndexedDB:</b> ${label(idb)}. ${idb.message ? escapeHtml(idb.message) : `${idb.databases.length} bases de la Suite detectadas.`}</p><ul>${databases}</ul>
      <p><b>Cuota del sitio:</b> ${capacity.status === 'ok' ? `${escapeHtml(formatBytes(capacity.usage))} usados de ${escapeHtml(formatBytes(capacity.quota))} estimados.` : `${label(capacity)}. ${escapeHtml(capacity.message)}`}</p>
      <p><b>Persistencia:</b> ${persistence.status === 'ok' ? persistence.persisted ? 'Concedida por el navegador.' : 'No concedida; el navegador puede liberar almacenamiento bajo presión.' : `${label(persistence)}. ${escapeHtml(persistence.message)}`}</p>
      <div class="small-note">Consulta de solo lectura. La cuota corresponde al sitio completo, no solo a la Suite. No verifica escrituras, integridad funcional ni disponibilidad de un respaldo. Conservá copias descargadas.</div>`;
  }

  async function handleStorageDiagnostic(){
    showModal({ title:'Diagnóstico de almacenamiento', bodyHtml:'<div>Consultando almacenamiento…</div>', disablePrimary:true, disableCancel:true });
    try{
      const report = await diagnoseStorage();
      showModal({ title:'Diagnóstico de almacenamiento', bodyHtml:storageDiagnosticHtml(report), primaryText:'Cerrar', onPrimary:hideModal, disableCancel:true });
    }catch(error){
      showModal({ title:'Diagnóstico no completado', bodyHtml:escapeHtml(error?.message || error), primaryText:'Cerrar', onPrimary:hideModal, disableCancel:true });
    }
  }

  async function safeListIndexedDBDatabases(){
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function'){
      throw new Error('IndexedDB: este navegador no permite enumerar las bases de datos; no se puede verificar un respaldo completo.');
    }
    try{
      const list = await indexedDB.databases();
      if (!Array.isArray(list)) throw new Error('La lista recibida no es válida.');
      return list.filter((d) => d && d.name);
    }catch(error){
      throw new Error('IndexedDB: no se pudo consultar la lista de bases de datos. ' + String(error?.message || error));
    }
  }

  function openExistingDB(dbName){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onupgradeneeded = (e) => {
        try{ e.target.transaction.abort(); }catch(_){ }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error(`No se pudo abrir la base de datos: ${dbName}`));
    });
  }

  async function getAllFromStore(store){
    if (store.getAll){
      return reqToPromise(store.getAll());
    }
    return new Promise((resolve, reject) => {
      const out = [];
      const req = store.openCursor();
      req.onerror = () => reject(req.error || new Error('Error leyendo cursor'));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor){
          out.push(cursor.value);
          cursor.continue();
        } else {
          resolve(out);
        }
      };
    });
  }

  async function snapshotDatabase(dbName){
    const db = await openExistingDB(dbName);
    try{
      const snapshot = {
        name: dbName,
        version: db.version,
        stores: {}
      };

      const storeNames = Array.from(db.objectStoreNames || []);
      for (const storeName of storeNames){
        const tx = db.transaction(storeName, 'readonly');
        const completed = txDone(tx);
        // La lectura puede fallar antes de esperar el cierre de la transacción.
        completed.catch(() => {});
        const store = tx.objectStore(storeName);

        const schema = {
          keyPath: store.keyPath ?? null,
          autoIncrement: !!store.autoIncrement,
          indices: []
        };

        try{
          const indexNames = Array.from(store.indexNames || []);
          for (const idxName of indexNames){
            const idx = store.index(idxName);
            schema.indices.push({
              name: idxName,
              keyPath: idx.keyPath ?? null,
              unique: !!idx.unique,
              multiEntry: !!idx.multiEntry
            });
          }
        }catch(error){
          throw new Error(`${dbName} / ${storeName}: no se pudo leer el esquema. ${String(error?.message || error)}`);
        }

        let records;
        try{
          records = await getAllFromStore(store);
          await completed;
        }catch(error){
          throw new Error(`${dbName} / ${storeName}: no se pudo completar la lectura. ${String(error?.message || error)}`);
        }

        snapshot.stores[storeName] = {
          count: Array.isArray(records) ? records.length : 0,
          schema,
          records: Array.isArray(records) ? records : []
        };
      }

      return snapshot;
    }finally{
      try{ db.close(); }catch(_){ }
    }
  }

  function getSuiteLocalStorageSnapshot(){
    const out = {};
    const keys = [];
    // Lectura directa: A33Storage devuelve null/lista vacía cuando falla el acceso.
    let storage, length;
    try{ storage = window.localStorage; length = storage.length; }
    catch(error){ throw new Error('localStorage: no se pudo consultar el almacenamiento. ' + String(error?.message || error)); }
    for (let index = 0; index < length; index++){
      let k;
      try{ k = storage.key(index); }
      catch(error){ throw new Error(`localStorage: no se pudo leer la clave ${index + 1}. ${String(error?.message || error)}`); }
      if (k === null) throw new Error('localStorage: la lista de claves cambió o no se pudo leer; vuelve a preparar el respaldo.');
      if (!isSuiteLocalStorageKey(k)) continue;
      if (isRetiredGateStorageKey(k)) continue;
      let value;
      try{ value = storage.getItem(k); }
      catch(error){ throw new Error(`localStorage / ${k}: no se pudo leer. ${String(error?.message || error)}`); }
      if (value === null) throw new Error(`localStorage / ${k}: la clave dejó de estar disponible; vuelve a preparar el respaldo.`);
      keys.push(k);
      out[k] = value;
    }
    keys.sort();
    return { data: out, keys, count: keys.length };
  }

  function buildSummaryHtmlFromSnapshot({ dbSnapshots, lsKeys, exportedAt, estimatedBytes, warnings, appName, agenda }){
    const totalDbRecords = dbSnapshots.reduce((acc, d) => {
      const stores = Object.values(d.stores || {});
      return acc + stores.reduce((a, s) => a + (Number(s.count) || 0), 0);
    }, 0);

    const dbHtml = dbSnapshots.length
      ? dbSnapshots.map((d) => {
          const stores = Object.entries(d.stores || {});
          const storeLines = stores.length
            ? `<ul>${stores.map(([sn, s]) => `<li><b>${escapeHtml(sn)}</b>: ${Number(s.count) || 0}</li>`).join('')}</ul>`
            : `<div class="muted">Sin stores detectados.</div>`;
          return `
            <div style="margin-top:0.35rem;">
              <div><b>${escapeHtml(d.name)}</b> <span class="muted">(versión ${escapeHtml(d.version)})</span></div>
              ${storeLines}
            </div>
          `;
        }).join('')
      : `<div class="muted">No se detectaron bases de datos de la Suite en este navegador.</div>`;

    const warnHtml = (warnings && warnings.length)
      ? `<div class="badge-warn">⚠️ ${escapeHtml(warnings.join(' · '))}</div>`
      : '';

    const lsDetails = lsKeys && lsKeys.length
      ? `<details><summary>Ver keys (${lsKeys.length})</summary><ul>${lsKeys.map((k) => `<li>${escapeHtml(k)}</li>`).join('')}</ul></details>`
      : `<div class="muted">0 keys</div>`;

    const exportedAtPretty = exportedAt ? new Date(exportedAt).toLocaleString() : '';
    const agendaHtml = agenda && agenda.included ? `
      <hr>
      <div><b>Agenda</b></div>
      <div class="kv">
        <div class="k">Registros</div><div class="v">${escapeHtml(String(agenda.records || 0))}</div>
        <div class="k">Reuniones</div><div class="v">${escapeHtml(String(agenda.meetings || 0))}</div>
        <div class="k">Tareas</div><div class="v">${escapeHtml(String(agenda.tasks || 0))}</div>
        <div class="k">Compras</div><div class="v">${escapeHtml(String(agenda.purchases || 0))}</div>
        <div class="k">Artículos de compras</div><div class="v">${escapeHtml(String(agenda.purchaseItems || 0))}</div>
      </div>
    ` : '';

    return `
      <div>
        <div class="kv">
          <div class="k">App</div><div class="v">${escapeHtml(appName || BACKUP_APP_NAME)}</div>
          <div class="k">Fecha</div><div class="v">${escapeHtml(exportedAtPretty)}</div>
          <div class="k">Registros</div><div class="v">${totalDbRecords}</div>
          <div class="k">Keys localStorage</div><div class="v">${lsKeys ? lsKeys.length : 0}</div>
          <div class="k">Tamaño aprox.</div><div class="v">${escapeHtml(formatBytes(estimatedBytes || 0))}</div>
        </div>

        ${warnHtml}

        <hr>

        <div><b>IndexedDB</b></div>
        ${dbHtml}

        <hr>

        <div><b>localStorage (Suite)</b></div>
        ${lsDetails}
        ${agendaHtml}

        <div class="small-note">Nota: al importar se reemplazan o fusionan únicamente los bloques incluidos; los bloques ausentes se conservan.</div>
      </div>
    `;
  }

  function showModal({ title, bodyHtml, primaryText, onPrimary, secondaryText, onSecondary, cancelText, onCancel, disableCancel, disablePrimary }){
    const resultType = /error/i.test(title || '') ? 'error' : (/exitosa|correctamente/i.test(title || '') ? 'success' : (/importando|exportando|preparando/i.test(title || '') ? 'process' : ''));
    if (!resultType) window.A33Notice.finish();
    if (resultType){
      const summary = document.createElement('div');
      summary.innerHTML = bodyHtml || '';
      window.A33Notice.show((title || '') + ': ' + (summary.textContent || ''), resultType);
    }
    const modal = document.getElementById('backup-modal');
    const titleEl = document.getElementById('backup-modal-title');
    const bodyEl = document.getElementById('backup-modal-body');
    const btnCancel = document.getElementById('backup-modal-cancel');
    const btnPrimary = document.getElementById('backup-modal-primary');
    const btnSecondary = document.getElementById('backup-modal-secondary');

    titleEl.textContent = title || 'Respaldo';
    bodyEl.innerHTML = bodyHtml || '';

    btnPrimary.textContent = primaryText || 'OK';
    btnPrimary.style.display = disablePrimary ? 'none' : 'inline-flex';
    btnPrimary.onclick = null;
    btnPrimary.onclick = async () => {
      if (typeof onPrimary === 'function') await onPrimary();
    };

    if (secondaryText && typeof onSecondary === 'function'){
      btnSecondary.style.display = 'inline-flex';
      btnSecondary.textContent = secondaryText;
      btnSecondary.onclick = null;
      btnSecondary.onclick = async () => {
        await onSecondary();
      };
    } else {
      btnSecondary.style.display = 'none';
      btnSecondary.onclick = null;
    }

    btnCancel.textContent = cancelText || 'Cancelar';
    btnCancel.style.display = disableCancel ? 'none' : 'inline-flex';
    btnCancel.onclick = null;
    btnCancel.onclick = () => {
      if (typeof onCancel === 'function') onCancel();
      hideModal();
    };

    modal.style.display = 'flex';
  }

  function hideModal(){
    const modal = document.getElementById('backup-modal');
    if (modal) modal.style.display = 'none';
  }

  function backupExportAge(preparedAt, now = Date.now()){
    const elapsed = now - new Date(preparedAt).getTime();
    if (!Number.isFinite(elapsed)) return 'No disponible';
    if (elapsed < 0) return 'Fecha futura; revisá el reloj del dispositivo';
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return 'Menos de un minuto';
    if (minutes < 60) return `${minutes} minuto(s)`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} hora(s)`;
    return `${Math.floor(minutes / 1440)} día(s)`;
  }

  function renderLastBackupExport(){
    const node = document.getElementById('cfg-backup-last-export');
    if (!node) return;
    let record = lastExportSession;
    try{
      if (!record){
        const raw = window.localStorage.getItem(LAST_EXPORT_KEY);
        if (!raw){ node.textContent = 'Sin descargas registradas en este navegador. Los respaldos anteriores a este registro no tienen fecha comprobable.'; return; }
        record = JSON.parse(raw);
      }
      if (!record || record.schemaVersion !== 1 || !['full','partial','recovery'].includes(record.type) || typeof record.preparedAt !== 'string' || typeof record.requestedAt !== 'string' || !Number.isFinite(new Date(record.preparedAt).getTime()) || !Number.isFinite(new Date(record.requestedAt).getTime()) || typeof record.filename !== 'string') throw new Error('Registro inválido');
      const type = { full:'Completo', partial:'Personalizado parcial', recovery:'Completo previo a importación' }[record.type];
      node.innerHTML = `<div><b>Tipo:</b> ${type}</div><div><b>Contenido preparado:</b> ${escapeHtml(new Date(record.preparedAt).toLocaleString())}</div><div><b>Antigüedad del contenido:</b> ${escapeHtml(backupExportAge(record.preparedAt))}</div><div><b>Descarga solicitada:</b> ${escapeHtml(new Date(record.requestedAt).toLocaleString())}</div><div><b>Archivo:</b> ${escapeHtml(record.filename)}</div><p class="small-note">Solicitud de descarga; verificá que el archivo esté guardado. Un respaldo parcial cubre solo lo seleccionado.</p>${lastExportWriteFailed ? '<p class="badge-warn">No se pudo guardar este registro. Solo estará disponible durante esta sesión.</p>' : ''}`;
    }catch(_){ node.textContent = 'Registro no comprobable: no se pudo leer o validar la información de la última descarga.'; }
  }

  function downloadBackup(filename, content, type, preparedAt){
    // Registrar después de solicitar la descarga: preparar o cancelar no cambia la fecha.
    downloadTextFile(filename, content);
    const record = { schemaVersion:1, type, preparedAt, requestedAt:new Date().toISOString(), filename };
    lastExportSession = record;
    try{
      writeImportStorage(LAST_EXPORT_KEY, JSON.stringify(record));
      lastExportWriteFailed = false;
    }catch(_){ lastExportWriteFailed = true; }
    renderLastBackupExport();
  }

  function downloadTextFile(filename, content){
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showToast(message, ms = 4000){
    return window.A33Notice.show(message);
  }

  function buildBackupFilename(){
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `suitea33-backup-${stamp}.json`;
  }

  function buildCustomBackupFilename(){
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `suitea33-backup-personalizado-${stamp}.json`;
  }

  const CUSTOM_EXPORT_MODULES = [
    {
      id: 'configuracion',
      label: 'Configuración',
      parts: [
        { id: 'identidad', label: 'Identidad', keyNeedles: ['suite_a33_identity'] },
        { id: 'apariencia', label: 'Apariencia', keyNeedles: ['suite_a33_appearance'] },
        { id: 'moneda', label: 'Moneda', keyNeedles: ['suite_a33_currency'] },
        { id: 'reportes', label: 'Reportes', keyNeedles: ['suite_a33_reports'] },
        { id: 'pwa', label: 'PWA / preferencias', keyNeedles: ['suite_a33_pwa', 'a33_build', 'a33_version'] },
        { id: 'general', label: 'Configuración general', keyNeedles: ['suite_a33_user', 'suite_a33_module', 'suite_a33_config'] }
      ]
    },
    {
      id: 'catalogos',
      label: 'Catálogos',
      parts: [
        { id: 'productos', label: 'Productos', stores: [{ db: 'a33-pos', store: 'products' }], keyNeedles: ['a33_catalog_deleted_products', 'a33_catalog_deleted_product_ids_v2', 'a33_product_integrity_log_v1', 'a33_product_quarantine_v1'] },
        { id: 'costos', label: 'Costos', keyNeedles: [COSTS_BACKUP_KEY] },
        { id: 'materiaPrima', label: 'Materia Prima', stores: [{ db: 'a33-pos', store: 'rawMaterials' }] },
        { id: 'envases', label: 'Envases / Botellas', keyNeedles: ['a33_catalog_envases', 'a33_catalog_deleted_envases'] },
        { id: 'tapas', label: 'Tapas / Corchos', keyNeedles: ['a33_catalog_tapas', 'a33_catalog_deleted_tapas'] },
        { id: 'extras', label: 'Extras', stores: [{ db: 'a33-pos', store: 'extras' }], keyNeedles: ['a33_catalog_deleted_extras'] },
        { id: 'bancos', label: 'Bancos', stores: [{ db: 'a33-pos', store: 'banks' }], keyNeedles: ['bank', 'banco', 'a33_catalog_deleted_banks'] },
        { id: 'clientes', label: 'Clientes', keyNeedles: ['a33_pos_customers', 'a33_catalog_deleted_customers'], stores: [{ db: 'a33-pos', store: 'customers' }] }
      ]
    },
    {
      id: 'inventario',
      label: 'Inventario / Producción',
      parts: [
        { id: 'productoTerminado', label: 'Producto terminado', keyNeedles: ['arcano33_inventario'] },
        { id: 'envasesDisponibles', label: 'Envases / Botellas disponibles', keyNeedles: ['arcano33_inventario'] },
        { id: 'tapasDisponibles', label: 'Tapas / Corchos disponibles', keyNeedles: ['arcano33_inventario'] },
        { id: 'movimientosInventario', label: 'Movimientos de inventario', keyNeedles: ['arcano33_inventario'] },
        { id: 'recetas', label: 'Recetas', keyNeedles: ['arcano33_recetas_v1'] },
        { id: 'calculadoraProduccion', label: 'Calculadora de Producción', keyNeedles: ['arcano33_lote_actual', 'arcano33_fecha_produccion', 'arcano33_notas_lote', 'arcano33_produccion_checklists', 'arcano33_calc_', 'a33_calc_hebrew'] },
        { id: 'calculadoraTemporal', label: 'Calculadora Temporal', keyNeedles: ['arcano33_temporal_', 'a33_calc_temporal_hebrew'] }
      ]
    },
    {
      id: 'lotes',
      label: 'Lotes',
      parts: [
        { id: 'lotes', label: 'Lotes', keyNeedles: ['arcano33_lotes'] },
        { id: 'productosPorLote', label: 'Productos producidos por lote', keyNeedles: ['arcano33_lotes'] },
        { id: 'compatibilidadHistorica', label: 'Compatibilidad histórica P/M/D/L/G', keyNeedles: ['arcano33_lotes', 'arcano33_calc_ultimo_consecutivo', 'arcano33_calc_consecutivo_actual'] }
      ]
    },
    {
      id: 'pos',
      label: 'POS',
      parts: [
        { id: 'ventas', label: 'Ventas', stores: [{ db: 'a33-pos', store: 'sales' }], keyNeedles: ['a33_pos_pending_sale'] },
        { id: 'eventos', label: 'Eventos', stores: [{ db: 'a33-pos', store: 'events' }], keyNeedles: ['selectedsummaryeventid'] },
        { id: 'inventarioPos', label: 'Inventario POS', stores: [{ db: 'a33-pos', store: 'inventory' }] },
        { id: 'cierresDiarios', label: 'Cierres diarios', stores: [{ db: 'a33-pos', store: 'dailyClosures' }, { db: 'a33-pos', store: 'dayLocks' }] },
        { id: 'cajaEfectivoPos', label: 'Caja / Efectivo POS', stores: [{ db: 'a33-pos', store: 'cashV2' }, { db: 'a33-pos', store: 'cashv2hist' }, { db: 'a33-pos', store: 'cashv2snap' }], keyNeedles: ['a33.ef2'] },
        { id: 'reempaques', label: 'Reempaques', stores: [{ db: 'a33-pos', store: 'reempaques' }] },
        { id: 'preferenciasPos', label: 'Preferencias POS / secuencia de históricos', stores: [{ db: 'a33-pos', store: 'meta' }] },
        { id: 'historicosResumenes', label: 'Históricos / resúmenes', stores: [{ db: 'a33-pos', store: 'summaryArchives' }, { db: 'a33-pos', store: 'posRemindersIndex' }], keyNeedles: ['pos_summary'] }
      ]
    },
    {
      id: 'finanzas',
      label: 'Finanzas',
      parts: [
        { id: 'recibos', label: 'Recibos', stores: [{ db: 'finanzasDB', store: 'receipts' }] },
        { id: 'importacionesPos', label: 'Importaciones POS', stores: [{ db: 'finanzasDB', store: 'posDailyCloseImports' }] },
        { id: 'tableroOperativo', label: 'Tablero / datos operativos', keyNeedles: ['finanzas_tablero', 'finance_dashboard', 'cat_usage_cache', 'a33_fin_accounts_usage_cache_v1'] },
        { id: 'bancosCuentas', label: 'Bancos / cuentas financieras', stores: [{ db: 'finanzasDB', store: 'accounts' }, { db: 'finanzasDB', store: 'financialAccounts' }], keyNeedles: ['finanzas_bancos', 'cuentas_financieras'] },
        { id: 'configuracionFinanciera', label: 'Configuración financiera', stores: [{ db: 'finanzasDB', store: 'settings' }], keyNeedles: ['finanzas_config', 'suite_a33_currency'] },
        { id: 'proveedores', label: 'Proveedores', stores: [{ db: 'finanzasDB', store: 'suppliers' }] },
        { id: 'cuentasPorCobrar', label: 'Cuentas por cobrar', stores: [{ db: 'finanzasDB', store: 'receivableItems' }] },
        { id: 'cuentasPorPagar', label: 'Cuentas por pagar', stores: [{ db: 'finanzasDB', store: 'payableItems' }] },
        { id: 'movimientosFinancieros', label: 'Movimientos financieros existentes', stores: [{ db: 'finanzasDB', store: 'journalEntries' }, { db: 'finanzasDB', store: 'journalLines' }, { db: 'finanzasDB', store: 'internalTransfers' }] }
      ]
    },
    {
      id: 'agenda',
      label: 'Agenda / Compras / Pedidos',
      parts: [
        { id: 'agenda', label: 'Agenda (Reuniones, Tareas y Compras)', keyNeedles: ['agenda', 'a33_agenda', 'suite_a33_agenda'] },
        { id: 'pedidos', label: 'Pedidos completos y rápidos', keyNeedles: ['arcano33_pedidos', 'arcano33_pedidos_archived', QUICK_ORDERS_BACKUP_KEY, 'a33_pedidos_draft_v1'] }
      ]
    }
  ];

  const CUSTOM_POS_EVENTS_EMPTY_NOTICE = 'Seleccionaste eventos. Si querés respaldar también sus ventas/cierres, marcá esas opciones en POS.';
  const CUSTOM_POS_EVENT_STATE = {
    selectedIds: [],
    appliedAt: '',
    eventsCache: []
  };

  function normalizeSelectionPartIds(selection, moduleId){
    const parts = selection && Array.isArray(selection[moduleId]) ? selection[moduleId] : [];
    return parts.map((id) => String(id || '')).filter(Boolean);
  }

  function selectionHasPart(selection, moduleId, partId){
    return normalizeSelectionPartIds(selection, moduleId).includes(String(partId || ''));
  }

  function selectionHasAny(selection, moduleId, partIds){
    const set = new Set(normalizeSelectionPartIds(selection, moduleId));
    return (Array.isArray(partIds) ? partIds : []).some((id) => set.has(String(id || '')));
  }

  function getCustomDependencyWarnings(selection){
    const warnings = [];
    const hasProducts = selectionHasPart(selection, 'catalogos', 'productos');
    const hasPosVentas = selectionHasPart(selection, 'pos', 'ventas');
    const hasPosEventos = selectionHasPart(selection, 'pos', 'eventos');
    const hasPosCierres = selectionHasPart(selection, 'pos', 'cierresDiarios');
    const hasLotes = selectionHasAny(selection, 'lotes', ['lotes', 'productosPorLote', 'compatibilidadHistorica']);
    const hasProduccion = selectionHasAny(selection, 'inventario', ['recetas', 'calculadoraProduccion', 'calculadoraTemporal']);
    const hasInventarioBase = selectionHasAny(selection, 'inventario', ['productoTerminado', 'envasesDisponibles', 'tapasDisponibles', 'movimientosInventario']);
    const hasCatalogEnvasesTapas = selectionHasAny(selection, 'catalogos', ['envases', 'tapas']);
    const hasAgenda = selectionHasPart(selection, 'agenda', 'agenda');
    const hasMateriaPrima = selectionHasPart(selection, 'catalogos', 'materiaPrima');

    if (hasPosVentas && !hasProducts){
      warnings.push('Ventas POS puede necesitar Productos como referencia histórica. Si el otro navegador no tiene ese catálogo, conviene incluir Catálogos → Productos.');
    }
    if (hasPosEventos && !hasPosVentas){
      warnings.push('Eventos POS sin Ventas respaldará el evento base; las ventas del evento no viajarán si no marcás POS → Ventas.');
    }
    if (hasPosEventos && !hasPosCierres){
      warnings.push('Eventos POS sin Cierres diarios no incluirá los cierres asociados a esos eventos.');
    }
    if (hasLotes && !hasProducts){
      warnings.push('Lotes puede depender de Productos/productId y Letra. Para máxima compatibilidad, incluí Catálogos → Productos.');
    }
    if (hasProduccion && !hasInventarioBase){
      warnings.push('Producción/Calculadoras sin Inventario trasladará recetas o cálculos, pero no las existencias disponibles de producto terminado, envases o tapas.');
    }
    if (hasCatalogEnvasesTapas && !hasProducts){
      warnings.push('Envases/Tapas viajan como catálogo, pero los productos dinámicos que los usan no se incluyen salvo que marques Catálogos → Productos.');
    }
    if (hasAgenda && !hasMateriaPrima){
      warnings.push('Agenda incluye Compras con su precio histórico, pero para crear compras nuevas en el otro dispositivo conviene incluir Catálogos → Materia Prima.');
    }
    if (hasInventarioBase){
      warnings.push('Las opciones de Inventario comparten un único registro: cualquiera incluye todas las existencias y movimientos guardados en Inventario.');
    }
    if (selectionHasPart(selection, 'inventario', 'calculadoraProduccion') && !hasLotes){
      warnings.push('Calculadora de Producción incluye sus listas de seguimiento, pero los lotes y sus listas históricas requieren seleccionar Lotes.');
    }
    if (selectionHasPart(selection, 'pos', 'eventos')){
      warnings.push('Eventos no incluye las preferencias compartidas de POS. Para trasladar el evento activo y la secuencia de históricos, seleccioná Preferencias POS / secuencia de históricos.');
    }
    const hasFinanceMovements = selectionHasAny(selection, 'finanzas', ['recibos', 'importacionesPos', 'movimientosFinancieros', 'cuentasPorCobrar', 'cuentasPorPagar']);
    if (hasFinanceMovements && !selectionHasPart(selection, 'finanzas', 'bancosCuentas')){
      warnings.push('Los movimientos de Finanzas pueden referenciar cuentas contables y financieras. Conviene incluir Finanzas → Bancos / cuentas financieras.');
    }
    if (selectionHasAny(selection, 'finanzas', ['recibos', 'cuentasPorPagar']) && !selectionHasPart(selection, 'finanzas', 'proveedores')){
      warnings.push('Recibos y cuentas por pagar pueden referenciar proveedores. Conviene incluir Finanzas → Proveedores.');
    }
    if (selectionHasPart(selection, 'finanzas', 'importacionesPos') && !selectionHasPart(selection, 'finanzas', 'movimientosFinancieros')){
      warnings.push('Importaciones POS contiene el seguimiento de cierres importados; sus asientos requieren Finanzas → Movimientos financieros existentes.');
    }
    return Array.from(new Set(warnings));
  }

  function dependencyWarningsHtml(warnings){
    const list = (Array.isArray(warnings) ? warnings : []).filter(Boolean);
    if (!list.length) return '';
    return `
      <div class="cfg-backup-dependency-box" role="note">
        <strong>Avisos de dependencias</strong>
        <ul>${list.map((msg) => `<li>${escapeHtml(msg)}</li>`).join('')}</ul>
      </div>
    `;
  }

  function customPosEventId(ev){
    if (!ev || typeof ev !== 'object') return '';
    const raw = ev.id ?? ev.eventId ?? ev.uid ?? ev.uuid ?? ev.key ?? '';
    return String(raw ?? '').trim();
  }

  function customPosEventName(ev){
    const raw = ev?.name ?? ev?.eventName ?? ev?.nombre ?? ev?.title ?? ev?.titulo ?? '';
    return String(raw || 'Evento sin nombre').trim() || 'Evento sin nombre';
  }

  function customPosEventDateRaw(ev){
    return ev?.date ?? ev?.fecha ?? ev?.createdAt ?? ev?.created_at ?? ev?.startAt ?? ev?.openedAt ?? ev?.closedAt ?? '';
  }

  function customPosEventDateLabel(ev){
    const raw = customPosEventDateRaw(ev);
    if (!raw) return '';
    if (typeof raw === 'number' && Number.isFinite(raw)){
      try{ return new Date(raw).toLocaleDateString(); }catch(_){ return String(raw); }
    }
    const str = String(raw || '').trim();
    if (!str) return '';
    const t = Date.parse(str);
    if (!Number.isNaN(t)){
      try{ return new Date(t).toLocaleDateString(); }catch(_){ }
    }
    return str;
  }

  function customPosEventSortKey(ev){
    const raw = customPosEventDateRaw(ev);
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const t = Date.parse(String(raw || ''));
    if (!Number.isNaN(t)) return t;
    const n = Number(customPosEventId(ev));
    return Number.isFinite(n) ? n : 0;
  }

  function customPosEventStatusLabel(ev){
    const explicit = ev?.status ?? ev?.estado ?? ev?.state ?? '';
    if (explicit) return String(explicit).trim();
    if (ev?.closedAt || ev?.closed_at || ev?.cerradoAt) return 'Cerrado';
    return 'Abierto';
  }

  function customPosEventTotalLabel(ev){
    const candidates = ['total', 'totalSales', 'salesTotal', 'ventasTotal', 'saleTotal', 'grandTotal', 'netTotal'];
    for (const k of candidates){
      const n = Number(ev && ev[k]);
      if (Number.isFinite(n) && n !== 0){
        try{ return `C$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }catch(_){ return `C$${n.toFixed(2)}`; }
      }
    }
    const saleSeq = Number(ev?.saleSeq);
    if (Number.isFinite(saleSeq) && saleSeq > 0) return `${saleSeq} venta(s)`;
    return '';
  }

  function customPosEventSearchText(ev){
    return [
      customPosEventName(ev),
      customPosEventDateLabel(ev),
      customPosEventStatusLabel(ev),
      customPosEventTotalLabel(ev),
      customPosEventId(ev)
    ].join(' ').toLowerCase();
  }

  function customPosEventSelectionSet(){
    return new Set((CUSTOM_POS_EVENT_STATE.selectedIds || []).map((id) => String(id)));
  }

  function customPosEventSelectionCount(){
    return customPosEventSelectionSet().size;
  }

  function customPosEventSelectionLabel(){
    const count = customPosEventSelectionCount();
    return count ? `${count} evento(s)` : 'Sin selección';
  }

  function isCustomPosEventosChecked(){
    const el = document.querySelector('[data-custom-export-part="pos:eventos"]');
    return !!(el && el.checked);
  }

  function isCustomPosTodoChecked(){
    const mod = getCustomModuleById('pos');
    const selected = collectCustomSelectionFromDom();
    const posPartIds = Array.isArray(selected.pos) ? selected.pos : [];
    const allPartIds = (mod?.parts || []).map((part) => part.id);
    return allPartIds.length > 0 && allPartIds.every((id) => posPartIds.includes(id));
  }

  function getCustomPosDependencyNotice(selection){
    const pos = Array.isArray(selection?.pos) ? selection.pos : [];
    if (!pos.includes('eventos')) return '';
    if (pos.includes('ventas') && pos.includes('cierresDiarios')) return '';
    return CUSTOM_POS_EVENTS_EMPTY_NOTICE;
  }

  function customPosEventsNeedsManualSelection(selection){
    const pos = Array.isArray(selection?.pos) ? selection.pos : [];
    if (!pos.includes('eventos')) return false;
    const mod = getCustomModuleById('pos');
    const allPartIds = (mod?.parts || []).map((part) => part.id);
    const allSelected = allPartIds.length > 0 && allPartIds.every((id) => pos.includes(id));
    return !allSelected;
  }

  function updateCustomPosEventSelectionUi(){
    const btn = document.getElementById('cfg-pos-events-select-btn');
    const countEl = document.getElementById('cfg-pos-events-select-count');
    const note = document.getElementById('cfg-pos-events-select-note');
    if (!btn && !countEl && !note) return;
    const checked = isCustomPosEventosChecked();
    const todoPos = checked && isCustomPosTodoChecked();
    const selection = collectCustomSelectionFromDom();
    if (btn){
      btn.style.display = checked ? 'inline-flex' : 'none';
      btn.disabled = todoPos;
      btn.setAttribute('aria-disabled', todoPos ? 'true' : 'false');
    }
    if (countEl){
      countEl.textContent = todoPos ? 'Todo POS: todos los eventos' : customPosEventSelectionLabel();
    }
    if (note){
      if (!checked){
        note.textContent = '';
        note.style.display = 'none';
        note.classList.remove('is-warn');
      } else if (todoPos){
        note.textContent = 'Todo POS marcado: se incluirán todos los eventos sin selección manual.';
        note.style.display = 'block';
        note.classList.remove('is-warn');
      } else {
        const count = customPosEventSelectionCount();
        const dep = getCustomPosDependencyNotice(selection);
        note.textContent = count ? `${customPosEventSelectionLabel()} aplicado(s). ${dep}` : 'Abrí Seleccionar eventos y marcá al menos un evento.';
        note.style.display = 'block';
        note.classList.toggle('is-warn', count <= 0);
      }
    }
  }

  async function getCustomPosEventsForSelection(){
    try{
      const snap = await snapshotDatabase('a33-pos');
      const records = snap?.stores?.events?.records || [];
      const events = (Array.isArray(records) ? records : [])
        .filter((ev) => customPosEventId(ev))
        .map((ev) => cloneJsonSafe(ev));
      events.sort((a, b) => {
        const da = customPosEventSortKey(a);
        const db = customPosEventSortKey(b);
        if (db !== da) return db - da;
        return customPosEventName(a).localeCompare(customPosEventName(b));
      });
      CUSTOM_POS_EVENT_STATE.eventsCache = events;
      return events;
    }catch(_){
      CUSTOM_POS_EVENT_STATE.eventsCache = [];
      return [];
    }
  }

  function ensureCustomPosEventsModal(){
    let overlay = document.getElementById('cfg-pos-events-modal');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'cfg-pos-events-modal';
    overlay.className = 'modal-overlay cfg-pos-events-modal-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div aria-labelledby="cfg-pos-events-modal-title" aria-modal="true" class="modal-card cfg-pos-events-modal-card" role="dialog">
        <h2 class="modal-title" id="cfg-pos-events-modal-title">Seleccionar eventos POS</h2>
        <div class="modal-body" id="cfg-pos-events-modal-body"></div>
        <div class="modal-actions">
          <button class="cfg-btn cfg-btn-ghost cfg-btn-modal" id="cfg-pos-events-modal-cancel" type="button">Cancelar</button>
          <button class="cfg-btn cfg-btn-primary cfg-btn-modal" id="cfg-pos-events-modal-apply" type="button">Aplicar selección</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function buildCustomPosEventsRowsHtml(events, selectedSet){
    if (!events.length){
      return '<div class="muted cfg-pos-events-empty">No hay eventos POS detectados en este navegador.</div>';
    }
    return events.map((ev) => {
      const id = customPosEventId(ev);
      const date = customPosEventDateLabel(ev);
      const status = customPosEventStatusLabel(ev);
      const total = customPosEventTotalLabel(ev);
      const meta = [date, status, total].filter(Boolean).join(' · ');
      const search = customPosEventSearchText(ev);
      return `
        <label class="cfg-pos-event-row" data-pos-event-row="${escapeHtml(id)}" data-pos-event-search="${escapeHtml(search)}">
          <input type="checkbox" data-pos-event-choice="${escapeHtml(id)}" ${selectedSet.has(id) ? 'checked' : ''} />
          <span class="cfg-pos-event-row-main">
            <strong>${escapeHtml(customPosEventName(ev))}</strong>
            <small>${escapeHtml(meta || 'Sin fecha/estado adicional')}</small>
          </span>
        </label>
      `;
    }).join('');
  }

  function updateCustomPosEventsModalCount(){
    const countEl = document.getElementById('cfg-pos-events-modal-count');
    if (!countEl) return;
    const boxes = Array.from(document.querySelectorAll('[data-pos-event-choice]'));
    const checked = boxes.filter((box) => box.checked).length;
    countEl.textContent = `${checked} seleccionado(s)`;
  }

  function filterCustomPosEventsModalRows(){
    const q = String(document.getElementById('cfg-pos-events-search')?.value || '').trim().toLowerCase();
    document.querySelectorAll('[data-pos-event-row]').forEach((row) => {
      const hay = String(row.getAttribute('data-pos-event-search') || '').toLowerCase();
      row.style.display = (!q || hay.includes(q)) ? '' : 'none';
    });
  }

  async function openCustomPosEventsModal(){
    const trigger = document.getElementById('cfg-pos-events-select-btn');
    if (trigger){
      trigger.disabled = true;
      trigger.classList.add('is-loading');
    }
    let events = [];
    try{ events = await getCustomPosEventsForSelection(); }catch(_){ events = []; }
    if (trigger){
      trigger.disabled = false;
      trigger.classList.remove('is-loading');
    }

    const overlay = ensureCustomPosEventsModal();
    const body = document.getElementById('cfg-pos-events-modal-body');
    const selectedSet = customPosEventSelectionSet();
    if (body){
      body.innerHTML = `
        <div class="cfg-pos-events-picker">
          <p class="cfg-custom-export-copy">Marcá únicamente los eventos POS que querés incluir en este respaldo parcial.</p>
          <div class="cfg-pos-events-tools">
            <input id="cfg-pos-events-search" class="cfg-pos-events-search" type="search" placeholder="Buscar evento" autocomplete="off" />
            <span class="cfg-custom-export-status" id="cfg-pos-events-modal-count">${selectedSet.size} seleccionado(s)</span>
          </div>
          <div class="cfg-pos-events-bulk-actions">
            <button type="button" class="cfg-btn cfg-btn-ghost cfg-btn-small" id="cfg-pos-events-select-all">Seleccionar todos</button>
            <button type="button" class="cfg-btn cfg-btn-ghost cfg-btn-small" id="cfg-pos-events-clear-all">Desmarcar todos</button>
          </div>
          <div class="cfg-pos-events-list" role="list">${buildCustomPosEventsRowsHtml(events, selectedSet)}</div>
          <div class="small-note">Cancelar cierra esta ventana sin aplicar cambios.</div>
        </div>
      `;
    }

    const close = () => { overlay.style.display = 'none'; };
    const cancel = document.getElementById('cfg-pos-events-modal-cancel');
    const apply = document.getElementById('cfg-pos-events-modal-apply');
    const search = document.getElementById('cfg-pos-events-search');
    const selectAll = document.getElementById('cfg-pos-events-select-all');
    const clearAll = document.getElementById('cfg-pos-events-clear-all');

    if (cancel) cancel.onclick = close;
    if (search) search.oninput = filterCustomPosEventsModalRows;
    document.querySelectorAll('[data-pos-event-choice]').forEach((box) => {
      box.addEventListener('change', updateCustomPosEventsModalCount);
    });
    if (selectAll){
      selectAll.onclick = () => {
        document.querySelectorAll('[data-pos-event-choice]').forEach((box) => { box.checked = true; });
        updateCustomPosEventsModalCount();
      };
    }
    if (clearAll){
      clearAll.onclick = () => {
        document.querySelectorAll('[data-pos-event-choice]').forEach((box) => { box.checked = false; });
        updateCustomPosEventsModalCount();
      };
    }
    if (apply){
      apply.onclick = () => {
        const ids = Array.from(document.querySelectorAll('[data-pos-event-choice]'))
          .filter((box) => box.checked)
          .map((box) => String(box.getAttribute('data-pos-event-choice') || '').trim())
          .filter(Boolean);
        CUSTOM_POS_EVENT_STATE.selectedIds = Array.from(new Set(ids));
        CUSTOM_POS_EVENT_STATE.appliedAt = new Date().toISOString();
        close();
        updateCustomExportStatus();
        updateCustomPosEventSelectionUi();
      };
    }
    updateCustomPosEventsModalCount();
    overlay.style.display = 'flex';
    try{ if (search) search.focus(); }catch(_){ }
  }

  function getCustomModuleById(moduleId){
    return CUSTOM_EXPORT_MODULES.find((m) => m.id === moduleId) || null;
  }

  function getCustomPartById(moduleId, partId){
    const mod = getCustomModuleById(moduleId);
    if (!mod) return null;
    return (mod.parts || []).find((p) => p.id === partId) || null;
  }

  function normalizeNeedle(str){
    return String(str || '').trim().toLowerCase();
  }

  function keyMatchesNeedles(key, needles){
    const s = normalizeNeedle(key);
    const arr = Array.isArray(needles) ? needles : [];
    return arr.some((needle) => {
      const n = normalizeNeedle(needle);
      return n && s.includes(n);
    });
  }

  function cloneJsonSafe(value){
    if (value == null) return value;
    try{ return JSON.parse(JSON.stringify(value)); }catch(_){ return value; }
  }

  function ensureCustomDb(outData, outSchemas, outVersions, sourceMeta, dbName){
    if (!dbName) return false;
    const sourceDbs = outData.__sourceIndexedDB || {};
    if (!sourceDbs[dbName]) return false;
    if (!outData.indexedDB[dbName]) outData.indexedDB[dbName] = {};
    if (!outSchemas[dbName]) outSchemas[dbName] = {};
    if (sourceMeta.dbVersions && Object.prototype.hasOwnProperty.call(sourceMeta.dbVersions, dbName)){
      outVersions[dbName] = sourceMeta.dbVersions[dbName];
    }
    return true;
  }

  function addCustomStore(outData, outSchemas, outVersions, sourceMeta, dbName, storeName){
    if (!dbName || !storeName) return false;
    const sourceIndexed = outData.__sourceIndexedDB || {};
    const sourceStores = sourceIndexed[dbName];
    if (!sourceStores || !Object.prototype.hasOwnProperty.call(sourceStores, storeName)) return false;
    if (!ensureCustomDb(outData, outSchemas, outVersions, sourceMeta, dbName)) return false;
    outData.indexedDB[dbName][storeName] = cloneJsonSafe(sourceStores[storeName]);
    const sourceSchemas = sourceMeta.dbSchemas || {};
    if (sourceSchemas[dbName] && Object.prototype.hasOwnProperty.call(sourceSchemas[dbName], storeName)){
      outSchemas[dbName][storeName] = cloneJsonSafe(sourceSchemas[dbName][storeName]);
    }
    return true;
  }

  function addCustomKey(outLocalStorage, sourceLocalStorage, key){
    if (!key || !Object.prototype.hasOwnProperty.call(sourceLocalStorage, key)) return false;
    outLocalStorage[key] = sourceLocalStorage[key];
    return true;
  }

  function collectCustomSelectionFromDom(){
    const selected = {};
    CUSTOM_EXPORT_MODULES.forEach((mod) => {
      const partIds = [];
      (mod.parts || []).forEach((part) => {
        const el = document.querySelector(`[data-custom-export-part="${mod.id}:${part.id}"]`);
        if (el && el.checked) partIds.push(part.id);
      });
      if (partIds.length) selected[mod.id] = partIds;
    });
    return selected;
  }

  function countCustomSelection(selection){
    return Object.values(selection || {}).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
  }

  function describeCustomSelection(selection){
    const modulesIncluded = [];
    const moduleIdsIncluded = [];
    const submodulesIncluded = {};
    const submoduleLabelsIncluded = {};
    const partialModules = [];
    const moduleSelection = {};

    for (const [moduleId, partIdsRaw] of Object.entries(selection || {})){
      const mod = getCustomModuleById(moduleId);
      if (!mod) continue;
      const partIds = (Array.isArray(partIdsRaw) ? partIdsRaw : []).filter((partId) => getCustomPartById(moduleId, partId));
      if (!partIds.length) continue;
      const allPartIds = (mod.parts || []).map((p) => p.id);
      const allSelected = allPartIds.length > 0 && allPartIds.every((id) => partIds.includes(id));
      modulesIncluded.push(mod.label);
      moduleIdsIncluded.push(mod.id);
      submodulesIncluded[mod.id] = partIds.slice();
      submoduleLabelsIncluded[mod.id] = partIds.map((id) => getCustomPartById(moduleId, id)?.label || id);
      if (!allSelected) partialModules.push(mod.label);
      moduleSelection[mod.id] = {
        label: mod.label,
        mode: allSelected ? 'full' : 'partial',
        selectedSubmodules: partIds.slice(),
        selectedSubmoduleLabels: submoduleLabelsIncluded[mod.id].slice()
      };
    }

    return { modulesIncluded, moduleIdsIncluded, submodulesIncluded, submoduleLabelsIncluded, partialModules, moduleSelection };
  }

  function getCustomExportVersionLabel(){
    try{
      if (window.A33_RELEASE && window.A33_RELEASE.label) return String(window.A33_RELEASE.label);
      if (window.A33_BUILD_TAG) return String(window.A33_BUILD_TAG);
      if (window.A33_VERSION) return String(window.A33_VERSION);
    }catch(_){ }
    return '';
  }


  const BACKUP_BLOCK_IDS = ['Productos','Envases','Tapas','Inventario','Recetas','Ventas','Lotes','Pedidos','Agenda','Históricos'];

  function countBackupRecords(value){
    if (Array.isArray(value)) return value.length;
    if (!value || typeof value !== 'object') return value == null || value === '' ? 0 : 1;
    return Object.keys(value).length;
  }

  function parseBackupLocalValue(value){
    if (typeof value !== 'string') return value;
    try{ return JSON.parse(value); }catch(_){ return value; }
  }

  function countLocalKeysByNeedles(localStorageMap, needles){
    const map = localStorageMap && typeof localStorageMap === 'object' ? localStorageMap : {};
    return Object.entries(map).reduce((total, [key, value]) => {
      if (!keyMatchesNeedles(key, needles)) return total;
      return total + Math.max(1, countBackupRecords(parseBackupLocalValue(value)));
    }, 0);
  }

  function buildBackupBlockManifest(indexedDBMap, localStorageMap, selection, backupType){
    const indexed = indexedDBMap && typeof indexedDBMap === 'object' ? indexedDBMap : {};
    const local = localStorageMap && typeof localStorageMap === 'object' ? localStorageMap : {};
    const pos = indexed['a33-pos'] || {};
    const isPartial = String(backupType || '').toLowerCase() === 'partial';
    const selected = selection || {};
    const selectedAny = (moduleId, partIds) => selectionHasAny(selected, moduleId, partIds);
    const selectedOne = (moduleId, partId) => selectionHasPart(selected, moduleId, partId);
    const defs = {
      Productos:{ included:!isPartial || selectedOne('catalogos','productos'), count:countBackupRecords(pos.products || []) },
      Envases:{ included:!isPartial || selectedOne('catalogos','envases'), count:countLocalKeysByNeedles(local, ['a33_catalog_envases']) },
      Tapas:{ included:!isPartial || selectedOne('catalogos','tapas'), count:countLocalKeysByNeedles(local, ['a33_catalog_tapas']) },
      Inventario:{ included:!isPartial || selectedAny('inventario',['productoTerminado','envasesDisponibles','tapasDisponibles','movimientosInventario']) || selectedOne('pos','inventarioPos'), count:countLocalKeysByNeedles(local, ['arcano33_inventario']) + countBackupRecords(pos.inventory || []) },
      Recetas:{ included:!isPartial || selectedOne('inventario','recetas'), count:countLocalKeysByNeedles(local, ['arcano33_recetas_v1']) },
      Ventas:{ included:!isPartial || selectedOne('pos','ventas'), count:countBackupRecords(pos.sales || []) },
      Lotes:{ included:!isPartial || selectedAny('lotes',['lotes','productosPorLote','compatibilidadHistorica']), count:countLocalKeysByNeedles(local, ['arcano33_lotes','a33_lotes','suitea33_lotes']) },
      Pedidos:{ included:!isPartial || selectedOne('agenda','pedidos'), count:countLocalKeysByNeedles(local, ['arcano33_pedidos','arcano33_pedidos_archived',QUICK_ORDERS_BACKUP_KEY]) },
      Agenda:{ included:!isPartial || selectedOne('agenda','agenda'), count:countLocalKeysByNeedles(local, ['agenda','a33_agenda','suite_a33_agenda']) },
      Históricos:{ included:!isPartial || selectedOne('pos','historicosResumenes') || selectedOne('lotes','compatibilidadHistorica'), count:countBackupRecords(pos.summaryArchives || []) + countBackupRecords(pos.posRemindersIndex || []) + countLocalKeysByNeedles(local, ['histor','summary']) }
    };
    const manifest = {};
    BACKUP_BLOCK_IDS.forEach((id) => { manifest[id] = { included:!!defs[id].included, records:Number(defs[id].count || 0) }; });
    return {
      manifest,
      included:BACKUP_BLOCK_IDS.filter((id) => manifest[id].included),
      notIncluded:BACKUP_BLOCK_IDS.filter((id) => !manifest[id].included),
      recordCounts:BACKUP_BLOCK_IDS.reduce((acc,id) => { acc[id] = manifest[id].records; return acc; }, {})
    };
  }

  function buildCustomExportModalHtml(){
    const modulesHtml = CUSTOM_EXPORT_MODULES.map((mod) => {
      const partsHtml = (mod.parts || []).map((part) => {
        const partLabel = `
          <label class="cfg-custom-export-part">
            <input type="checkbox" data-custom-export-part="${escapeHtml(mod.id)}:${escapeHtml(part.id)}" />
            <span>${escapeHtml(part.label)}</span>
          </label>
        `;
        if (mod.id === 'pos' && part.id === 'eventos'){
          return `
            <div class="cfg-custom-export-part-wrap cfg-custom-export-part-wrap--events">
              ${partLabel}
              <button type="button" class="cfg-btn cfg-btn-ghost cfg-pos-events-select-btn" id="cfg-pos-events-select-btn" style="display:none;">
                Seleccionar eventos
                <span id="cfg-pos-events-select-count">${escapeHtml(customPosEventSelectionLabel())}</span>
              </button>
              <div class="cfg-pos-events-select-note" id="cfg-pos-events-select-note" style="display:none;"></div>
            </div>
          `;
        }
        return partLabel;
      }).join('');
      return `
        <section class="cfg-custom-export-module" data-custom-export-module-card="${escapeHtml(mod.id)}">
          <div class="cfg-custom-export-module-head">
            <label class="cfg-custom-export-main">
              <input type="checkbox" data-custom-export-module="${escapeHtml(mod.id)}" />
              <span>${escapeHtml(mod.label)}</span>
            </label>
            <button type="button" class="cfg-custom-export-toggle" data-custom-export-toggle="${escapeHtml(mod.id)}" aria-expanded="true">Ocultar</button>
          </div>
          <div class="cfg-custom-export-parts" data-custom-export-parts="${escapeHtml(mod.id)}">
            ${partsHtml}
          </div>
        </section>
      `;
    }).join('');

    return `
      <div class="cfg-custom-export">
        <p class="cfg-custom-export-copy">Elegí módulos completos o partes específicas. Esta salida queda marcada como respaldo parcial para no confundirse con la caja fuerte completa.</p>
        <div id="cfg-custom-export-status" class="cfg-custom-export-status" role="status" aria-live="polite">Sin selección todavía.</div>
        <div id="cfg-custom-export-dependencies" class="cfg-custom-export-dependencies" aria-live="polite"></div>
        <div class="cfg-custom-export-list">${modulesHtml}</div>
        <div class="small-note">La importación inteligente reconoce respaldos completos y parciales.</div>
      </div>
    `;
  }

  function updateCustomExportModuleState(moduleId){
    const mod = getCustomModuleById(moduleId);
    if (!mod) return;
    const moduleBox = document.querySelector(`[data-custom-export-module="${moduleId}"]`);
    const partBoxes = Array.from(document.querySelectorAll(`[data-custom-export-part^="${moduleId}:"]`));
    const checked = partBoxes.filter((box) => box.checked).length;
    if (moduleBox){
      moduleBox.checked = partBoxes.length > 0 && checked === partBoxes.length;
      moduleBox.indeterminate = checked > 0 && checked < partBoxes.length;
    }
    const card = document.querySelector(`[data-custom-export-module-card="${moduleId}"]`);
    if (card){
      card.setAttribute('data-custom-state', checked === 0 ? 'empty' : (checked === partBoxes.length ? 'full' : 'partial'));
    }
  }

  function updateCustomExportStatus(){
    CUSTOM_EXPORT_MODULES.forEach((mod) => updateCustomExportModuleState(mod.id));
    const status = document.getElementById('cfg-custom-export-status');
    const depBox = document.getElementById('cfg-custom-export-dependencies');
    if (!status) return;
    const selection = collectCustomSelectionFromDom();
    const count = countCustomSelection(selection);
    if (!count){
      status.textContent = 'Sin selección todavía.';
      status.classList.remove('is-warn');
      if (depBox) depBox.innerHTML = '';
      updateCustomPosEventSelectionUi();
      return;
    }
    const desc = describeCustomSelection(selection);
    const dependencyWarnings = getCustomDependencyWarnings(selection);
    const partial = desc.partialModules.length ? ` · Parciales: ${desc.partialModules.join(', ')}` : '';
    const dep = dependencyWarnings.length ? ` · ${dependencyWarnings.length} aviso(s) de dependencias.` : '';
    status.textContent = `${desc.modulesIncluded.length} módulo(s), ${count} submódulo(s) seleccionado(s)${partial}${dep}.`;
    status.classList.remove('is-warn');
    if (depBox) depBox.innerHTML = dependencyWarningsHtml(dependencyWarnings);
    updateCustomPosEventSelectionUi();
  }

  function setCustomExportWarning(message){
    const status = document.getElementById('cfg-custom-export-status');
    if (!status) return;
    status.textContent = message || 'Seleccioná al menos una opción.';
    status.classList.add('is-warn');
  }

  function bindCustomExportModalControls(){
    CUSTOM_EXPORT_MODULES.forEach((mod) => {
      const moduleBox = document.querySelector(`[data-custom-export-module="${mod.id}"]`);
      if (moduleBox){
        moduleBox.addEventListener('change', () => {
          const boxes = document.querySelectorAll(`[data-custom-export-part^="${mod.id}:"]`);
          boxes.forEach((box) => { box.checked = moduleBox.checked; });
          updateCustomExportStatus();
        });
      }
      document.querySelectorAll(`[data-custom-export-part^="${mod.id}:"]`).forEach((box) => {
        box.addEventListener('change', updateCustomExportStatus);
      });
      const toggle = document.querySelector(`[data-custom-export-toggle="${mod.id}"]`);
      const parts = document.querySelector(`[data-custom-export-parts="${mod.id}"]`);
      if (toggle && parts){
        toggle.addEventListener('click', () => {
          const collapsed = parts.hasAttribute('hidden');
          if (collapsed){
            parts.removeAttribute('hidden');
            toggle.textContent = 'Ocultar';
            toggle.setAttribute('aria-expanded', 'true');
          } else {
            parts.setAttribute('hidden', '');
            toggle.textContent = 'Ver';
            toggle.setAttribute('aria-expanded', 'false');
          }
        });
      }
    });
    const posEventBtn = document.getElementById('cfg-pos-events-select-btn');
    if (posEventBtn){
      posEventBtn.addEventListener('click', openCustomPosEventsModal);
    }
    updateCustomExportStatus();
    updateCustomPosEventSelectionUi();
  }

  function addCustomFilteredStore(outData, outSchemas, outVersions, sourceMeta, dbName, storeName, filterFn){
    if (!dbName || !storeName || typeof filterFn !== 'function') return 0;
    const sourceIndexed = outData.__sourceIndexedDB || {};
    const sourceStores = sourceIndexed[dbName];
    const records = sourceStores && sourceStores[storeName];
    if (!Array.isArray(records)) return 0;
    if (!ensureCustomDb(outData, outSchemas, outVersions, sourceMeta, dbName)) return 0;
    const filtered = records.filter(filterFn).map((record) => cloneJsonSafe(record));
    outData.indexedDB[dbName][storeName] = filtered;
    const sourceSchemas = sourceMeta.dbSchemas || {};
    if (sourceSchemas[dbName] && Object.prototype.hasOwnProperty.call(sourceSchemas[dbName], storeName)){
      outSchemas[dbName][storeName] = cloneJsonSafe(sourceSchemas[dbName][storeName]);
    }
    return filtered.length;
  }

  function addCustomPosSelectedEventsToPayload(outData, outSchemas, outVersions, sourceMeta, selectedIds){
    const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map((id) => String(id)));
    if (!selected.size) return 0;
    return addCustomFilteredStore(outData, outSchemas, outVersions, sourceMeta, 'a33-pos', 'events', (ev) => selected.has(customPosEventId(ev)));
  }

  function addCustomPartToPayload(part, outData, outSchemas, outVersions, sourceMeta, sourceLocalStorage){
    let added = 0;
    (Array.isArray(part.keyNeedles) ? part.keyNeedles : []).forEach((needle) => {
      Object.keys(sourceLocalStorage || {}).forEach((key) => {
        if (keyMatchesNeedles(key, [needle])){
          if (addCustomKey(outData.localStorage, sourceLocalStorage, key)) added++;
        }
      });
    });
    (Array.isArray(part.stores) ? part.stores : []).forEach((item) => {
      if (item && addCustomStore(outData, outSchemas, outVersions, sourceMeta, item.db, item.store)) added++;
    });
    return added;
  }

  function getCustomBackupOptionsForSelection(selection){
    const desc = describeCustomSelection(selection);
    const posParts = Array.isArray(selection?.pos) ? selection.pos : [];
    const posSelection = desc.moduleSelection?.pos || null;
    let eventsMode = 'none';
    if (posParts.includes('eventos')){
      eventsMode = posSelection && posSelection.mode === 'full' ? 'all' : 'selected';
    }
    const selectedIds = Array.from(customPosEventSelectionSet());
    return {
      pos: {
        included: !!posSelection,
        mode: posSelection?.mode || 'none',
        eventsIncluded: posParts.includes('eventos'),
        eventsMode,
        selectedEventIds: eventsMode === 'selected' ? selectedIds : [],
        selectedEventsCount: eventsMode === 'selected' ? selectedIds.length : 0,
        dependencyNotice: getCustomPosDependencyNotice(selection)
      }
    };
  }

  function buildCustomPosMetadata(selection, customOptions, sourceIndexedDB, outData){
    const posParts = Array.isArray(selection?.pos) ? selection.pos : [];
    const sourceEvents = sourceIndexedDB?.['a33-pos']?.events || [];
    const exportedEvents = outData?.indexedDB?.['a33-pos']?.events || [];
    const eventIdsIncluded = (Array.isArray(exportedEvents) ? exportedEvents : [])
      .map((ev) => customPosEventId(ev))
      .filter(Boolean);
    const eventNamesIncluded = (Array.isArray(exportedEvents) ? exportedEvents : [])
      .map((ev) => customPosEventName(ev))
      .filter(Boolean);
    const eventsMode = customOptions?.pos?.eventsMode || 'none';
    return {
      included: !!posParts.length,
      mode: customOptions?.pos?.mode || 'none',
      selectedSubmodules: posParts.slice(),
      eventsIncluded: posParts.includes('eventos'),
      eventsMode,
      includedAllEvents: eventsMode === 'all',
      selectedEventsCount: eventIdsIncluded.length,
      availableEventsCount: Array.isArray(sourceEvents) ? sourceEvents.length : 0,
      eventIdsIncluded,
      eventLabelsIncluded: eventNamesIncluded,
      requestedEventIds: eventsMode === 'selected' ? (customOptions?.pos?.selectedEventIds || []).slice() : [],
      dependencyNotice: customOptions?.pos?.dependencyNotice || ''
    };
  }

  async function buildCustomBackup(selection, customOptions){
    const desc = describeCustomSelection(selection);
    const options = customOptions || getCustomBackupOptionsForSelection(selection);
    const full = await buildFullBackup();
    const sourceBackup = full.backup || {};
    const sourceMeta = sourceBackup.meta || {};
    const sourceData = sourceBackup.data || {};
    const sourceIndexedDB = sourceData.indexedDB || {};
    const sourceLocalStorage = sourceData.localStorage || {};
    const outSchemas = {};
    const outVersions = {};
    const outData = { indexedDB: {}, localStorage: {}, __sourceIndexedDB: sourceIndexedDB };
    const includedDataMap = {};

    for (const [moduleId, partIds] of Object.entries(selection || {})){
      const mod = getCustomModuleById(moduleId);
      if (!mod) continue;
      includedDataMap[moduleId] = {};
      (Array.isArray(partIds) ? partIds : []).forEach((partId) => {
        const part = getCustomPartById(moduleId, partId);
        if (!part) return;
        if (moduleId === 'pos' && partId === 'eventos' && options?.pos?.eventsMode === 'selected'){
          includedDataMap[moduleId][partId] = addCustomPosSelectedEventsToPayload(outData, outSchemas, outVersions, sourceMeta, options.pos.selectedEventIds);
          return;
        }
        includedDataMap[moduleId][partId] = addCustomPartToPayload(part, outData, outSchemas, outVersions, sourceMeta, sourceLocalStorage);
      });
    }

    delete outData.__sourceIndexedDB;

    const exportedAt = new Date().toISOString();
    const baseMeta = (window.A33ExportCurrency && typeof window.A33ExportCurrency.decorateJsonMeta === 'function')
      ? window.A33ExportCurrency.decorateJsonMeta({
          appName: BACKUP_APP_NAME,
          app: BACKUP_APP_NAME,
          exportedAt,
          dbVersions: outVersions,
          dbSchemas: outSchemas
        })
      : {
          appName: BACKUP_APP_NAME,
          app: BACKUP_APP_NAME,
          exportedAt,
          dbVersions: outVersions,
          dbSchemas: outSchemas
        };

    const posMetadata = buildCustomPosMetadata(selection, options, sourceIndexedDB, outData);
    const dependencyWarnings = getCustomDependencyWarnings(selection);
    const costsIncluded = selectionHasPart(selection, 'catalogos', 'costos');
    if (costsIncluded && !Object.prototype.hasOwnProperty.call(outData.localStorage, COSTS_BACKUP_KEY)){
      outData.localStorage[COSTS_BACKUP_KEY] = JSON.stringify(emptyCostsBackupValue());
      if (!includedDataMap.catalogos) includedDataMap.catalogos = {};
      includedDataMap.catalogos.costos = Math.max(1, Number(includedDataMap.catalogos.costos) || 0);
    }

    const blockInfo = buildBackupBlockManifest(outData.indexedDB, outData.localStorage, selection, 'partial');
    const backup = {
      meta: {
        ...baseMeta,
        app: BACKUP_APP_NAME,
        backupType: 'partial',
        exportMode: 'custom',
        schemaVersion: 7,
        lotCodeContract: { preserveLiteral:true, accepts:['historical','A33_HEBREW_MONTH_YEAR_COMPRESSED_V1'], compressedMarker:'x', numericConsecutiveSeparate:true },
        exportedAt,
        fechaHoraExportacion: exportedAt,
        version: getCustomExportVersionLabel(),
        modulesIncluded: desc.modulesIncluded,
        moduleIdsIncluded: desc.moduleIdsIncluded,
        submodulesIncluded: desc.submodulesIncluded,
        submoduleLabelsIncluded: desc.submoduleLabelsIncluded,
        partialModules: desc.partialModules,
        moduleSelection: desc.moduleSelection,
        includedDataMap,
        pos: posMetadata,
        posIncludedMode: posMetadata.mode,
        eventsMode: posMetadata.eventsMode,
        eventIdsIncluded: posMetadata.eventIdsIncluded,
        eventsIncluded: posMetadata.eventLabelsIncluded,
        selectedEventsCount: posMetadata.selectedEventsCount,
        dependencyWarnings,
        dependencyWarningsCount: dependencyWarnings.length,
        blockManifest:blockInfo.manifest,
        blocksIncluded:blockInfo.included,
        blocksNotIncluded:blockInfo.notIncluded,
        recordCounts:blockInfo.recordCounts,
        ...(costsIncluded ? { costs:{ included:true, schemaVersion:COSTS_BACKUP_SCHEMA_VERSION, storageKey:COSTS_BACKUP_KEY } } : {}),
        agenda:agendaBackupSummary(outData.localStorage),
        origin: 'exportador_personalizado_a33'
      },
      data: {
        indexedDB: outData.indexedDB,
        localStorage: outData.localStorage
      }
    };

    const jsonString = JSON.stringify(backup, null, 2);
    const estimatedBytes = new Blob([jsonString]).size;
    const dbSnapshots = Object.entries(outData.indexedDB).map(([dbName, stores]) => ({
      name: dbName,
      version: outVersions[dbName] || '',
      stores: Object.entries(stores || {}).reduce((acc, [storeName, records]) => {
        const arr = Array.isArray(records) ? records : [];
        acc[storeName] = { count: arr.length, schema: (outSchemas[dbName] || {})[storeName] || {}, records: arr };
        return acc;
      }, {})
    }));
    const lsKeys = Object.keys(outData.localStorage || {}).sort();

    return { backup, jsonString, estimatedBytes, dbSnapshots, lsKeys, selectionDescription: desc };
  }

  function buildCustomSummaryHtml(result){
    const desc = result?.selectionDescription || {};
    const moduleLines = (desc.modulesIncluded || []).length
      ? `<ul>${(desc.modulesIncluded || []).map((label) => `<li>${escapeHtml(label)}</li>`).join('')}</ul>`
      : '<div class="muted">Sin módulos.</div>';
    const submoduleLines = Object.entries(desc.submoduleLabelsIncluded || {}).map(([moduleId, labels]) => {
      const mod = getCustomModuleById(moduleId);
      return `<details open><summary>${escapeHtml(mod?.label || moduleId)}</summary><ul>${(labels || []).map((label) => `<li>${escapeHtml(label)}</li>`).join('')}</ul></details>`;
    }).join('');

    const backupSummary = buildSummaryHtmlFromSnapshot({
      dbSnapshots: result.dbSnapshots || [],
      lsKeys: result.lsKeys || [],
      exportedAt: result.backup?.meta?.exportedAt,
      estimatedBytes: result.estimatedBytes || 0,
      warnings: [],
      appName: result.backup?.meta?.appName || BACKUP_APP_NAME,
      agenda:result.backup?.meta?.agenda
    }).replace(
      'Nota: al importar se reemplazan o fusionan únicamente los bloques incluidos; los bloques ausentes se conservan.',
      'Nota: este respaldo personalizado es parcial y puede importarse sin borrar datos no incluidos.'
    );

    return `
      <div class="cfg-custom-export-summary">
        <div class="badge-ok">✅ Respaldo personalizado preparado como parcial.</div>
        <div class="small-note"><b>Tipo:</b> respaldo parcial. La importación inteligente fusionará por ID y no borrará datos no incluidos.</div>
        ${result.backup?.meta?.pos?.dependencyNotice ? `<div class="badge-warn">⚠️ ${escapeHtml(result.backup.meta.pos.dependencyNotice)}</div>` : ''}
        ${dependencyWarningsHtml(result.backup?.meta?.dependencyWarnings || [])}
        <hr>
        <div><b>Módulos incluidos</b></div>
        ${moduleLines}
        <hr>
        <div><b>Submódulos incluidos</b></div>
        ${submoduleLines || '<div class="muted">Sin submódulos.</div>'}
        <hr>
        ${backupSummary}
        <div class="small-note">Este archivo incluye <b>backupType: partial</b> y <b>exportMode: custom</b>.</div>
      </div>
    `;
  }

  async function handleCustomExport(){
    window.A33Notice.show('Preparando respaldo…', 'process');
    showModal({
      title: 'Exportar JSON personalizado',
      bodyHtml: buildCustomExportModalHtml(),
      primaryText: 'Exportar',
      onPrimary: async () => {
        const selection = collectCustomSelectionFromDom();
        if (countCustomSelection(selection) <= 0){
          setCustomExportWarning('Seleccioná al menos un módulo o submódulo para exportar.');
          return;
        }

        const customOptions = getCustomBackupOptionsForSelection(selection);
        if (customPosEventsNeedsManualSelection(selection) && customOptions.pos.selectedEventsCount <= 0){
          setCustomExportWarning('Seleccionaste Eventos POS. Abrí “Seleccionar eventos” y marcá al menos un evento.');
          updateCustomPosEventSelectionUi();
          return;
        }

        showModal({
          title: 'Exportar JSON personalizado',
          bodyHtml: '<div class="muted">Preparando respaldo parcial...</div>',
          disableCancel: true,
          disablePrimary: true
        });

        try{
          const result = await buildCustomBackup(selection, customOptions);
          showModal({
            title: 'Resumen del respaldo personalizado',
            bodyHtml: buildCustomSummaryHtml(result),
            primaryText: 'Descargar personalizado',
            onPrimary: async () => {
              downloadBackup(buildCustomBackupFilename(), result.jsonString, 'partial', result.backup.meta.exportedAt);
              hideModal();
              showToast('Descarga de respaldo personalizado solicitada. Verificá que el archivo esté guardado.');
            },
            cancelText: 'Cancelar',
            onCancel: hideModal
          });
        }catch(e){
          showModal({
            title: 'Error',
            bodyHtml: `<div class="badge-warn">⚠️ ${escapeHtml(e?.message || e)}</div>`,
            primaryText: 'Cerrar',
            onPrimary: hideModal,
            disableCancel: true
          });
        }
      },
      cancelText: 'Cancelar',
      onCancel: hideModal
    });
    bindCustomExportModalControls();
  }

  async function buildFullBackup(){
    const all = await safeListIndexedDBDatabases();
    const suiteDbList = (Array.isArray(all) ? all : []).filter((d) => d && d.name && isSuiteDbName(d.name));

    const dbSnapshots = [];
    const dataIndexedDB = {};
    const dbVersions = {};
    const dbSchemas = {};
    const readFailures = [];

    for (const d of suiteDbList){
      try{
        const snap = await snapshotDatabase(d.name);
        dbSnapshots.push(snap);

        dataIndexedDB[d.name] = {};
        dbSchemas[d.name] = {};
        dbVersions[d.name] = snap.version;

        for (const [storeName, s] of Object.entries(snap.stores || {})){
          dataIndexedDB[d.name][storeName] = s.records || [];
          dbSchemas[d.name][storeName] = s.schema || {};
        }
      }catch(e){
        readFailures.push(`${d.name}: ${String(e?.message || e)}`);
      }
    }

    let lsSnap;
    try{ lsSnap = getSuiteLocalStorageSnapshot(); }
    catch(error){ readFailures.push(String(error?.message || error)); }
    if (readFailures.length){
      const error = new Error('No se generó el respaldo: hay lecturas incompletas. ' + readFailures.join(' · '));
      error.code = 'A33_BACKUP_READ_INCOMPLETE';
      error.readFailures = readFailures;
      throw error;
    }
    const cleanIndexed = sanitizeIndexedDbPayload(dataIndexedDB, dbSchemas, dbVersions);

    const fullLocalStorage = sanitizeSuiteLocalStorageMap(lsSnap.data);
    if (!Object.prototype.hasOwnProperty.call(fullLocalStorage, COSTS_BACKUP_KEY)){
      fullLocalStorage[COSTS_BACKUP_KEY] = JSON.stringify(emptyCostsBackupValue());
    }
    const costsBlock = parseCostsBackupBlock(fullLocalStorage);
    const baseFullMeta = (window.A33ExportCurrency && typeof window.A33ExportCurrency.decorateJsonMeta === 'function')
      ? window.A33ExportCurrency.decorateJsonMeta({
          appName: BACKUP_APP_NAME,
          backupType: 'full',
          exportMode: 'full',
          exportedAt: new Date().toISOString(),
          dbVersions: cleanIndexed.versions,
          dbSchemas: cleanIndexed.schemas
        })
      : {
          appName: BACKUP_APP_NAME,
          backupType: 'full',
          exportMode: 'full',
          exportedAt: new Date().toISOString(),
          dbVersions: cleanIndexed.versions,
          dbSchemas: cleanIndexed.schemas
        };

    const blockInfo = buildBackupBlockManifest(cleanIndexed.data, fullLocalStorage, {}, 'full');
    const backup = {
      meta: {
        ...baseFullMeta,
        schemaVersion:8,
        quickOrders:{ included:Object.prototype.hasOwnProperty.call(fullLocalStorage,QUICK_ORDERS_BACKUP_KEY), storageKey:QUICK_ORDERS_BACKUP_KEY, schemaVersion:QUICK_ORDERS_BACKUP_SCHEMA_VERSION, mergePolicy:'id_updatedAt' },
        lotCodeContract: { preserveLiteral:true, accepts:['historical','A33_HEBREW_MONTH_YEAR_COMPRESSED_V1'], compressedMarker:'x', numericConsecutiveSeparate:true },
        version:getCustomExportVersionLabel(),
        fechaHoraExportacion:baseFullMeta.exportedAt,
        blockManifest:blockInfo.manifest,
        blocksIncluded:blockInfo.included,
        blocksNotIncluded:blockInfo.notIncluded,
        recordCounts:blockInfo.recordCounts,
        ...(costsBlock.present && costsBlock.ok ? { costs:{ included:true, schemaVersion:costsBlock.version || COSTS_BACKUP_SCHEMA_VERSION, storageKey:COSTS_BACKUP_KEY } } : {}),
        agenda:agendaBackupSummary(fullLocalStorage)
      },
      data: {
        indexedDB: cleanIndexed.data,
        localStorage: fullLocalStorage
      }
    };

    const jsonString = JSON.stringify(backup, null, 2);
    const estimatedBytes = new Blob([jsonString]).size;

    return {
      backup,
      jsonString,
      estimatedBytes,
      dbSnapshots,
      lsKeys: Object.keys(fullLocalStorage || {}).sort()
    };
  }

  function getBackupImportKind(obj){
    const meta = (obj && obj.meta && typeof obj.meta === 'object') ? obj.meta : {};
    const backupType = String(meta.backupType || '').trim().toLowerCase();
    const exportMode = String(meta.exportMode || '').trim().toLowerCase();
    const partial = backupType === 'partial' || exportMode === 'custom';
    return {
      type: partial ? 'partial' : 'full',
      backupType: backupType || (partial ? 'partial' : 'full'),
      exportMode: exportMode || (partial ? 'custom' : 'full'),
      legacy: !backupType && !exportMode
    };
  }

  function validateBackupStructure(obj){
    const isMap = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
    const invalid = (path, expected) => ({ ok:false, reason:`${path}: se esperaba ${expected}.` });
    if (!isMap(obj)) return invalid('Archivo', 'un objeto JSON');
    if (!isMap(obj.meta)) return invalid('meta', 'un objeto');
    if (!isMap(obj.data)) return invalid('data', 'un objeto');
    const appName = obj.meta.appName || obj.meta.app || '';
    if (appName !== BACKUP_APP_NAME) return { ok:false, reason:`appName inválido: se esperaba "${BACKUP_APP_NAME}".` };
    if (!isMap(obj.data.indexedDB)) return invalid('data.indexedDB', 'un objeto');
    if (!isMap(obj.data.localStorage)) return invalid('data.localStorage', 'un objeto');
    for (const [dbName, stores] of Object.entries(obj.data.indexedDB)){
      if (!isSuiteDbName(dbName) || isRetiredGateDbName(dbName)) continue;
      if (!isMap(stores)) return invalid(`indexedDB / ${dbName}`, 'un objeto de almacenes');
      for (const [storeName, records] of Object.entries(stores)){
        if (isRetiredGateStoreName(storeName)) continue;
        const location = `indexedDB / ${dbName} / ${storeName}`;
        if (!Array.isArray(records)) return invalid(location, 'una lista de registros');
        for (let i = 0; i < records.length; i++){
          if (!isMap(records[i])) return invalid(`${location} / registro ${i + 1}`, 'un objeto');
        }
      }
    }
    // Los metadatos de esquema son opcionales en archivos históricos.
    for (const field of ['dbVersions', 'dbSchemas']){
      const map = obj.meta[field];
      if (map === undefined) continue;
      if (!isMap(map)) return invalid(`meta.${field}`, 'un objeto');
      for (const [dbName, value] of Object.entries(map)){
        if (!isSuiteDbName(dbName) || isRetiredGateDbName(dbName)) continue;
        if (field === 'dbVersions'){
          if (!['number', 'string'].includes(typeof value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) return invalid(`meta.dbVersions / ${dbName}`, 'una versión entera positiva');
          continue;
        }
        if (!isMap(value)) return invalid(`meta.dbSchemas / ${dbName}`, 'un objeto de esquemas');
        for (const [storeName, schema] of Object.entries(value)){
          if (isRetiredGateStoreName(storeName)) continue;
          const location = `meta.dbSchemas / ${dbName} / ${storeName}`;
          if (!isMap(schema)) return invalid(location, 'un objeto');
          if (schema.indices !== undefined && (!Array.isArray(schema.indices) || schema.indices.some(index => !isMap(index)))) return invalid(`${location} / indices`, 'una lista de objetos');
          if (schema.keyPath !== undefined && schema.keyPath !== null && typeof schema.keyPath !== 'string' && !(Array.isArray(schema.keyPath) && schema.keyPath.every(key => typeof key === 'string'))) return invalid(`${location} / keyPath`, 'texto, lista de textos o null');
        }
      }
    }
    for (const [key, value] of Object.entries(obj.data.localStorage)){
      if (!isSuiteLocalStorageKey(key) || isRetiredGateStorageKey(key)) continue;
      if ([COSTS_BACKUP_KEY, AGENDA_BACKUP_KEY, QUICK_ORDERS_BACKUP_KEY].includes(key)) continue;
      if (typeof value !== 'string') return invalid(`localStorage / ${key}`, 'texto serializado');
    }
    if (Object.prototype.hasOwnProperty.call(obj.data.localStorage, QUICK_ORDERS_BACKUP_KEY)){
      let rows = obj.data.localStorage[QUICK_ORDERS_BACKUP_KEY];
      if (typeof rows === 'string'){
        try{ rows = JSON.parse(rows); }
        catch(_){ return invalid(`localStorage / ${QUICK_ORDERS_BACKUP_KEY}`, 'JSON válido'); }
      }
      if (!Array.isArray(rows)) return invalid(`localStorage / ${QUICK_ORDERS_BACKUP_KEY}`, 'una lista de pedidos');
      for (let i = 0; i < rows.length; i++){
        if (!isMap(rows[i]) || !normalizeQuickOrderBackupRecord(rows[i])) return invalid(`localStorage / ${QUICK_ORDERS_BACKUP_KEY} / registro ${i + 1}`, 'un pedido válido');
      }
    }
    const costsValidation = parseCostsBackupBlock(obj.data.localStorage);
    if (!costsValidation.ok) return { ok:false, reason:costsValidation.reason || 'Bloque Costos inválido.' };
    const agendaValidation = parseAgendaBackupBlock(obj.data.localStorage);
    if (!agendaValidation.ok) return { ok:false, reason:agendaValidation.reason || 'Bloque Agenda inválido.' };
    // El código de lote es dato literal: la validación estructural nunca lo recalcula
    // ni rechaza AV, formatos históricos o la marca comprimida x/X.
    return { ok: true, kind: getBackupImportKind(obj), costs:costsValidation, agenda:agendaValidation, lotCodeLiteral:true };
  }

  function summarizeBackupObject(obj){
    const cleanObj = sanitizeBackupObject(obj);
    const dbSnapshots = [];
    const indexed = cleanObj?.data?.indexedDB || {};
    const versions = cleanObj?.meta?.dbVersions || {};
    const schemas = cleanObj?.meta?.dbSchemas || {};

    for (const [dbName, stores] of Object.entries(indexed)){
      const snap = { name: dbName, version: versions?.[dbName] ?? '', stores: {} };
      if (stores && typeof stores === 'object'){
        for (const [storeName, records] of Object.entries(stores)){
          const arr = Array.isArray(records) ? records : [];
          snap.stores[storeName] = {
            count: arr.length,
            schema: (schemas?.[dbName]?.[storeName]) || {},
            records: []
          };
        }
      }
      dbSnapshots.push(snap);
    }

    const lsKeys = Object.keys(cleanObj?.data?.localStorage || {}).sort();
    let estimatedBytes = 0;
    try{
      estimatedBytes = new Blob([JSON.stringify(obj)]).size;
    }catch(_){ }

    return {
      dbSnapshots,
      lsKeys,
      estimatedBytes,
      exportedAt: obj?.meta?.exportedAt,
      appName: obj?.meta?.appName || obj?.meta?.app,
      agenda:agendaBackupSummary(cleanObj?.data?.localStorage || {})
    };
  }

  function labelListHtml(items, emptyText){
    const arr = (Array.isArray(items) ? items : []).filter(Boolean);
    if (!arr.length) return `<div class="muted">${escapeHtml(emptyText || 'Sin datos.')}</div>`;
    return `<ul>${arr.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
  }

  function getPartialModulesIncluded(meta){
    if (Array.isArray(meta?.modulesIncluded) && meta.modulesIncluded.length) return meta.modulesIncluded.slice();
    const ids = Array.isArray(meta?.moduleIdsIncluded) ? meta.moduleIdsIncluded : Object.keys(meta?.moduleSelection || {});
    return ids.map((id) => getCustomModuleById(id)?.label || id).filter(Boolean);
  }

  function getPartialModuleIdsIncluded(meta){
    if (Array.isArray(meta?.moduleIdsIncluded) && meta.moduleIdsIncluded.length) return meta.moduleIdsIncluded.map(String);
    return Object.keys(meta?.moduleSelection || {});
  }

  function getPartialSubmoduleLabels(meta){
    if (meta?.submoduleLabelsIncluded && typeof meta.submoduleLabelsIncluded === 'object') return meta.submoduleLabelsIncluded;
    const out = {};
    const sub = meta?.submodulesIncluded && typeof meta.submodulesIncluded === 'object' ? meta.submodulesIncluded : {};
    for (const [moduleId, ids] of Object.entries(sub)){
      out[moduleId] = (Array.isArray(ids) ? ids : []).map((id) => getCustomPartById(moduleId, id)?.label || id);
    }
    return out;
  }

  function buildPartialImportSummaryHtml(obj, sum, warnings){
    const meta = obj?.meta || {};
    const includedModuleIds = getPartialModuleIdsIncluded(meta);
    const includedModules = getPartialModulesIncluded(meta);
    const includedSet = new Set(includedModuleIds.map(String));
    const notIncluded = CUSTOM_EXPORT_MODULES
      .filter((mod) => !includedSet.has(mod.id))
      .map((mod) => mod.label);
    const submoduleLabels = getPartialSubmoduleLabels(meta);
    const submoduleHtml = Object.entries(submoduleLabels || {}).map(([moduleId, labels]) => {
      const mod = getCustomModuleById(moduleId);
      return `<details open><summary>${escapeHtml(mod?.label || moduleId)}</summary>${labelListHtml(labels, 'Sin submódulos.')}</details>`;
    }).join('');

    const eventIds = Array.isArray(meta?.eventIdsIncluded) ? meta.eventIdsIncluded : (Array.isArray(meta?.pos?.eventIdsIncluded) ? meta.pos.eventIdsIncluded : []);
    const eventLabels = Array.isArray(meta?.eventsIncluded) ? meta.eventsIncluded : (Array.isArray(meta?.pos?.eventLabelsIncluded) ? meta.pos.eventLabelsIncluded : []);
    const eventMode = meta?.eventsMode || meta?.pos?.eventsMode || '';
    const eventHtml = (eventIds.length || eventLabels.length || eventMode)
      ? `
        <hr>
        <div><b>Eventos POS incluidos</b></div>
        <div class="kv">
          <div class="k">Modo eventos</div><div class="v">${escapeHtml(eventMode || 'No especificado')}</div>
          <div class="k">Cantidad</div><div class="v">${escapeHtml(String(eventIds.length || eventLabels.length || 0))}</div>
        </div>
        ${labelListHtml(eventLabels.length ? eventLabels : eventIds, 'Sin eventos listados.')}
      `
      : '';

    const backupSummary = buildSummaryHtmlFromSnapshot({
      dbSnapshots: sum.dbSnapshots || [],
      lsKeys: sum.lsKeys || [],
      exportedAt: sum.exportedAt,
      estimatedBytes: sum.estimatedBytes,
      warnings,
      appName: sum.appName,
      agenda:sum.agenda
    }).replace(
      'Nota: al importar se reemplazan o fusionan únicamente los bloques incluidos; los bloques ausentes se conservan.',
      'Nota: este respaldo parcial se fusiona por ID y conserva los datos no incluidos.'
    );

    return `
      <div class="cfg-custom-export-summary">
        <div class="badge-warn">⚠️ Este respaldo es parcial. Solo se importarán las secciones incluidas. Los datos no incluidos se conservarán.</div>
        <div class="small-note"><b>Modo de importación:</b> fusión por ID. No se limpia localStorage completo ni IndexedDB completo.</div>
        ${dependencyWarningsHtml(meta.dependencyWarnings || [])}
        <div class="kv">
          <div class="k">Tipo</div><div class="v">Parcial</div>
          <div class="k">Modo</div><div class="v">${escapeHtml(meta.exportMode || 'custom')}</div>
          <div class="k">Fecha</div><div class="v">${escapeHtml(sum.exportedAt ? new Date(sum.exportedAt).toLocaleString() : '')}</div>
          <div class="k">Versión</div><div class="v">${escapeHtml(meta.version || meta.schemaVersion || 'Legacy')}</div>
        </div>
        <hr>
        <div><b>Bloques incluidos</b></div>
        ${labelListHtml(meta.blocksIncluded || [], 'No declarados en este JSON antiguo.')}
        <div><b>Bloques no incluidos</b></div>
        ${labelListHtml(meta.blocksNotIncluded || [], 'No declarados o ninguno.')}
        <hr>
        <div><b>Módulos incluidos</b></div>
        ${labelListHtml(includedModules, 'Sin módulos declarados.')}
        <hr>
        <div><b>Submódulos incluidos</b></div>
        ${submoduleHtml || '<div class="muted">Sin submódulos declarados.</div>'}
        ${eventHtml}
        <hr>
        <div><b>Módulos no incluidos</b></div>
        ${labelListHtml(notIncluded, 'Ninguno.')}
        <hr>
        ${backupSummary}
      </div>
    `;
  }

  function buildImportSummaryHtml(obj, sum, warnings){
    const kind = getBackupImportKind(obj);
    if (kind.type === 'partial') return buildPartialImportSummaryHtml(obj, sum, warnings);
    const legacyLabel = kind.legacy ? '<div class="small-note">Respaldo completo legacy: no trae backupType, se trata como completo.</div>' : '';
    return buildSummaryHtmlFromSnapshot({
      dbSnapshots: sum.dbSnapshots,
      lsKeys: sum.lsKeys,
      exportedAt: sum.exportedAt,
      estimatedBytes: sum.estimatedBytes,
      warnings,
      appName: sum.appName,
      agenda:sum.agenda
    }) + `
      ${legacyLabel}
      <hr>
      <div class="badge-warn">⚠️ Esto reemplazará únicamente los bloques incluidos en este respaldo de Suite A33.</div>
      <div class="small-note"><b>Tipo:</b> respaldo completo. <b>Qué se importará:</b> bases IndexedDB y keys localStorage incluidas en el archivo. <b>Qué no se tocará:</b> datos ajenos a Suite A33 y llaves retiradas de acceso/login.</div>
    `;
  }

  async function buildDbVersionWarnings(backupObj){
    const cleanBackup = sanitizeBackupObject(backupObj);
    const warnings = [];
    const bVersions = cleanBackup?.meta?.dbVersions || {};
    const dbNames = Object.keys(cleanBackup?.data?.indexedDB || {});
    for (const dbName of dbNames){
      const b = bVersions?.[dbName];
      if (typeof b !== 'number') continue;
      try{
        const db = await openExistingDB(dbName);
        const c = db.version;
        try{ db.close(); }catch(_){ }
        if (typeof c === 'number' && b !== c){
          warnings.push(`${dbName}: respaldo v${b} / este navegador v${c}`);
        }
      }catch(_){ }
    }
    return warnings;
  }

  function getSuiteLocalStorageKeysInThisBrowser(){
    return window.A33Storage.keys({ scope: 'local' }).filter((k) => k && isSuiteLocalStorageKey(k));
  }

  function openDBForRestore(dbName, version, schemaByStore){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, Number(version) || 1);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const stores = schemaByStore && typeof schemaByStore === 'object'
          ? Object.entries(schemaByStore)
          : [];

        for (const [storeName, sch] of stores){
          if (db.objectStoreNames.contains(storeName)) continue;

          const keyPath = (sch && ('keyPath' in sch)) ? sch.keyPath : null;
          const autoIncrement = !!(sch && sch.autoIncrement);
          const opts = {};
          if (keyPath) opts.keyPath = keyPath;
          if (autoIncrement) opts.autoIncrement = true;

          let os;
          try{
            os = db.createObjectStore(storeName, opts);
          }catch(_){
            os = db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
          }

          try{
            const indices = Array.isArray(sch?.indices) ? sch.indices : [];
            for (const idx of indices){
              if (!idx?.name) continue;
              try{
                os.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique, multiEntry: !!idx.multiEntry });
              }catch(_){ }
            }
          }catch(_){ }
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error(`No se pudo abrir la DB para restaurar: ${dbName}`));
    });
  }

  function normalizeImportedProductRecord(record, origin){
    const row = cloneJsonSafe(record) || {};
    try{
      if (window.A33Products && typeof window.A33Products.normalizeRecord === 'function'){
        return window.A33Products.normalizeRecord(row, { forExisting:true, origin:origin || '' });
      }
    }catch(_){ }
    if (!String(row.productId || '').trim()){
      const legacy = String(row.id ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
      row.productId = legacy ? ('prd_legacy_' + legacy) : ('prd_import_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,10));
    }
    if (origin && !row.origin) row.origin = origin;
    return row;
  }

  async function readProductIdentityState(db){
    const state = { byProductId:new Map(), byLegacyId:new Map() };
    if (!db || !db.objectStoreNames.contains('products')) return state;
    try{
      const tx = db.transaction('products', 'readonly');
      const completed = txDone(tx);
      completed.catch(() => {});
      const store = tx.objectStore('products');
      await new Promise((resolve, reject) => {
        const req = store.openCursor();
        req.onerror = () => reject(req.error || new Error('No se pudo leer Productos.'));
        req.onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor){ resolve(); return; }
          const row = normalizeImportedProductRecord(cursor.value, '');
          const productId = String(row.productId || '').trim();
          if (productId && !state.byProductId.has(productId)) state.byProductId.set(productId, { key:cursor.key, row });
          state.byLegacyId.set(String(cursor.key), productId);
          cursor.continue();
        };
      });
      await completed;
    }catch(error){ throw new Error(`Lectura previa a fusión: ${error?.message || error}`); }
    return state;
  }

  async function restoreDatabase(dbName, dbPayload, dbVersions, dbSchemas){
    const db = await openDBForPartialMerge(dbName, dbPayload, dbVersions, dbSchemas);
    try{
      for (const [storeName, records] of Object.entries(dbPayload)){
        if (!db.objectStoreNames.contains(storeName)) throw new Error(`${dbName} / ${storeName}: almacén no disponible.`);
        const tx = db.transaction(storeName, 'readwrite');
        const completed = txDone(tx);
        completed.catch(() => {});
        try{
          const store = tx.objectStore(storeName);
          store.clear();
          for (const rec of records){
            store.put(dbName === 'a33-pos' && storeName === 'products' ? normalizeImportedProductRecord(rec, '') : rec);
          }
          await completed;
        }catch(error){
          try{ tx.abort(); }catch(_){ }
          throw new Error(`${dbName} / ${storeName}: ${error?.message || error}`);
        }
      }
    }finally{
      try{ db.close(); }catch(_){ }
    }
  }

  function normalizeRecordToken(value){
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function firstPresentValue(rec, keys){
    for (const k of keys){
      const v = rec?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    }
    return '';
  }

  function backupLotCodeLiteral(rec){
    if (!rec || typeof rec !== 'object') return '';
    return firstPresentValue(rec, ['codigoLote','loteCodigo','batchCode','lotCode','codigo','code']);
  }

  function backupLotIdentityKey(value){
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    try{
      if (window.A33LotCode && typeof window.A33LotCode.identityKey === 'function') return window.A33LotCode.identityKey(raw);
      if (window.A33LotCode && typeof window.A33LotCode.recognize === 'function'){
        const parsed = window.A33LotCode.recognize(raw);
        if (parsed && parsed.ok) return String(parsed.code || raw).replace(/\s+/g, '').toLowerCase();
      }
    }catch(_){ }
    return raw.replace(/\s+/g, '').toLowerCase();
  }

  function getStableRecordId(rec, schema, contextName){
    if (!rec || typeof rec !== 'object') return '';
    const lotContext = /lotes|lots|batch/i.test(String(contextName || '')) || !!backupLotCodeLiteral(rec);
    if (lotContext){
      const internalLotId = firstPresentValue(rec, ['loteId','lotId','batchId','operationId','productionOperationId','id','_id','uuid','uid']);
      if (internalLotId) return `lote-id::${internalLotId}`;
      const lotCodeKey = backupLotIdentityKey(backupLotCodeLiteral(rec));
      if (lotCodeKey) return `lote-code::${lotCodeKey}`;
    }
    const kp = schema && schema.keyPath;
    if (Array.isArray(kp)){
      const vals = kp.map((k) => rec?.[k]);
      if (vals.every((v) => v !== undefined && v !== null && String(v).trim() !== '')) return vals.map(String).join('::');
    } else if (typeof kp === 'string' && kp){
      const v = rec?.[kp];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    }

    const directId = firstPresentValue(rec, [
      'id','_id','uuid','uid','key','code','codigo','sku',
      'productId','productoId','itemId','variantId',
      'eventId','eventoId','saleId','ventaId','transactionId','movementId','movimientoId',
      'receiptId','reciboId','closureId','cierreId','dailyClosureId','closeId','lockId',
      'lotId','loteId','batchId','batchCode','lotCode','codigoLote',
      'supplierId','proveedorId','providerId','vendorId',
      'customerId','clienteId','clientId','bankId','bancoId','accountId','cuentaId',
      'envaseId','bottleId','tapaId','capId','extraId','invoiceId','facturaId','orderId','pedidoId'
    ]);
    if (directId) return directId;

    const ctx = String(contextName || '').toLowerCase();
    const name = firstPresentValue(rec, ['name','nombre','label','titulo','title','displayName','commercialName','razonSocial']);
    const email = firstPresentValue(rec, ['email','correo']);
    const phone = firstPresentValue(rec, ['phone','telefono','tel','whatsapp']);
    const number = firstPresentValue(rec, ['number','numero','factura','invoice','reference','referencia','oc','ordenCompra']);
    const date = firstPresentValue(rec, ['date','fecha','createdAt','updatedAt','fechaHora','closedAt','exportedAt']);

    if (/products|productos|inventory|inventario|extras|banks|bancos|customers|clientes|suppliers|proveedores|envases|tapas|caps|bottles/.test(ctx)){
      const composite = [name, email || phone || number].filter(Boolean).map(normalizeRecordToken).join('::');
      if (composite) return `${ctx || 'catalog'}::${composite}`;
    }

    if (/events|eventos/.test(ctx) && (name || date)){
      return `eventos::${normalizeRecordToken(date)}::${normalizeRecordToken(name)}`;
    }

    if (/lotes|lots|batch/.test(ctx) && (number || date || name)){
      return `lotes::${normalizeRecordToken(number || name)}::${normalizeRecordToken(date)}`;
    }

    if (/receipts|recibos|closures|cierres|sales|ventas/.test(ctx) && (number || date || name)){
      return `${ctx || 'mov'}::${normalizeRecordToken(number || name)}::${normalizeRecordToken(date)}`;
    }

    return '';
  }

  function hasStoreKeyPathValue(rec, keyPath){
    if (!keyPath) return false;
    if (Array.isArray(keyPath)) return keyPath.every((k) => rec && rec[k] !== undefined && rec[k] !== null && String(rec[k]).trim() !== '');
    if (typeof keyPath === 'string') return rec && rec[keyPath] !== undefined && rec[keyPath] !== null && String(rec[keyPath]).trim() !== '';
    return false;
  }

  async function openDBForPartialMerge(dbName, dbPayload, dbVersions, dbSchemas){
    const schemaByStore = dbSchemas?.[dbName] || {};
    const requestedVersion = Number(dbVersions?.[dbName] || 1) || 1;
    const incomingStores = Object.keys((dbPayload && typeof dbPayload === 'object') ? dbPayload : {});
    const schemaAvailable = schemaByStore && typeof schemaByStore === 'object' && Object.keys(schemaByStore).length > 0;

    try{
      const current = await openExistingDB(dbName);
      const missing = incomingStores.filter((storeName) => !current.objectStoreNames.contains(storeName));
      if (!missing.length || !schemaAvailable){
        return current;
      }
      const nextVersion = Math.max(Number(current.version || 1) + 1, requestedVersion);
      try{ current.close(); }catch(_){ }
      return await openDBForRestore(dbName, nextVersion, schemaByStore);
    }catch(_){
      if (schemaAvailable) return await openDBForRestore(dbName, requestedVersion, schemaByStore);
      throw new Error(`No se pudo abrir ${dbName} para fusión parcial: falta esquema de respaldo.`);
    }
  }

  async function readStoreStableKeyMap(db, storeName, schema){
    const map = new Map();
    if (!db || !db.objectStoreNames.contains(storeName)) return map;
    try{
      const tx = db.transaction(storeName, 'readonly');
      const completed = txDone(tx);
      completed.catch(() => {});
      const store = tx.objectStore(storeName);
      await new Promise((resolve, reject) => {
        const req = store.openCursor();
        req.onerror = () => reject(req.error || new Error('No se pudo leer índice de duplicados.'));
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor){ resolve(); return; }
          const id = getStableRecordId(cursor.value, schema, storeName);
          if (id && !map.has(id)) map.set(id, cursor.key);
          cursor.continue();
        };
      });
      await completed;
    }catch(error){ throw new Error(`Lectura previa a fusión: ${error?.message || error}`); }
    return map;
  }

  async function mergeDatabase(dbName, dbPayload, dbVersions, dbSchemas){
    const payload = (dbPayload && typeof dbPayload === 'object') ? dbPayload : {};
    const db = await openDBForPartialMerge(dbName, payload, dbVersions, dbSchemas);
    const schemaByStore = dbSchemas?.[dbName] || {};
    const stats = { stores: 0, records: 0, skipped: 0 };

    try{
      for (const [storeName, records] of Object.entries(payload)){
        if (!db.objectStoreNames.contains(storeName)) throw new Error(`${dbName} / ${storeName}: almacén no disponible.`);
        const arr = Array.isArray(records) ? records : [];
        if (!arr.length) continue;
        const schema = schemaByStore?.[storeName] || {};
        let stableKeyMap = new Map();
        let usesKeyPath = true;
        try{
          const probeTx = db.transaction(storeName, 'readonly');
          usesKeyPath = !!probeTx.objectStore(storeName).keyPath;
          try{ probeTx.abort(); }catch(_){ }
        }catch(_){ usesKeyPath = true; }
        if (!usesKeyPath) stableKeyMap = await readStoreStableKeyMap(db, storeName, schema);
        const productIdentityState = (dbName === 'a33-pos' && storeName === 'products')
          ? await readProductIdentityState(db)
          : null;
        const reservedProductIds = productIdentityState
          ? new Set(productIdentityState.byProductId.keys())
          : null;

        const tx = db.transaction(storeName, 'readwrite');
        const completed = txDone(tx);
        completed.catch(() => {});
        try{
          const store = tx.objectStore(storeName);
          const runtimeKeyPath = store.keyPath;
          stats.stores++;

          for (const rec of arr){
            if (!rec || typeof rec !== 'object') { throw new Error('Registro sin identidad válida para fusión.'); }
            try{
              let incoming = cloneJsonSafe(rec);
              if (productIdentityState){
                incoming = normalizeImportedProductRecord(incoming, '');
                const productId = String(incoming.productId || '').trim();
                const existing = productIdentityState.byProductId.get(productId);
                if (existing){
                  incoming.id = existing.key;
                } else {
                  if (reservedProductIds.has(productId)) { stats.skipped++; continue; }
                  reservedProductIds.add(productId);
                  if (!incoming.origin) incoming.origin = 'importacion';
                  if (incoming.id != null){
                    const legacyOwner = productIdentityState.byLegacyId.get(String(incoming.id));
                    if (legacyOwner && legacyOwner !== productId) delete incoming.id;
                  }
                }
              }
              if (runtimeKeyPath){
                if (!hasStoreKeyPathValue(incoming, runtimeKeyPath)) {
                  if (!(productIdentityState && store.autoIncrement)) { throw new Error('Registro sin identidad válida para fusión.'); }
                }
                const req = store.put(incoming);
                if (productIdentityState){
                  const productId = String(incoming.productId || '').trim();
                  req.onsuccess = () => {
                    const key = req.result;
                    productIdentityState.byProductId.set(productId, { key, row:incoming });
                    productIdentityState.byLegacyId.set(String(key), productId);
                  };
                }
                stats.records++;
              } else {
                const id = getStableRecordId(incoming, schema, storeName);
                if (!id) { throw new Error('Registro sin identidad válida para fusión.'); }
                const existingKey = stableKeyMap.has(id) ? stableKeyMap.get(id) : id;
                store.put(incoming, existingKey);
                stableKeyMap.set(id, existingKey);
                stats.records++;
              }
            }catch(error){ throw new Error(`${dbName} / ${storeName}: ${error?.message || error}`); }
          }
          await completed;
        }catch(error){
          try{ tx.abort(); }catch(_){ }
          throw new Error(`${dbName} / ${storeName}: ${error?.message || error}`);
        }
      }

      return stats;
    }finally{ try{ db.close(); }catch(_){ } }
  }

  function tryParseJsonValue(value){
    if (typeof value !== 'string') return { ok: true, value };
    const s = String(value || '').trim();
    if (!s || !/^[\[{]/.test(s)) return { ok: false, value };
    try{ return { ok: true, value: JSON.parse(s) }; }catch(_){ return { ok: false, value }; }
  }

  function stableJson(value){
    try{ return JSON.stringify(value); }catch(_){ return String(value); }
  }

  function mergeArrayById(current, incoming, contextName){
    const cur = Array.isArray(current) ? current.slice() : [];
    const inc = Array.isArray(incoming) ? incoming : [];
    const index = new Map();
    cur.forEach((item, i) => {
      const id = getStableRecordId(item, {}, contextName);
      if (id) index.set(id, i);
    });
    const fingerprints = new Set(cur.map((item) => stableJson(item)));
    for (const item of inc){
      const id = getStableRecordId(item, {}, contextName);
      if (id && index.has(id)){
        cur[index.get(id)] = item;
        fingerprints.add(stableJson(item));
      } else if (id){
        index.set(id, cur.length);
        cur.push(item);
        fingerprints.add(stableJson(item));
      } else {
        const fp = stableJson(item);
        if (!fingerprints.has(fp)){
          cur.push(item);
          fingerprints.add(fp);
        }
      }
    }
    return cur;
  }

  function mergeJsonValue(current, incoming, contextName){
    if (Array.isArray(current) && Array.isArray(incoming)) return mergeArrayById(current, incoming, contextName);
    if (current && incoming && typeof current === 'object' && typeof incoming === 'object' && !Array.isArray(current) && !Array.isArray(incoming)){
      const out = { ...current };
      for (const [k, v] of Object.entries(incoming)){
        if (Array.isArray(out[k]) && Array.isArray(v)) out[k] = mergeArrayById(out[k], v, `${contextName || ''}.${k}`);
        else if (out[k] && v && typeof out[k] === 'object' && typeof v === 'object' && !Array.isArray(out[k]) && !Array.isArray(v)) out[k] = mergeJsonValue(out[k], v, `${contextName || ''}.${k}`);
        else out[k] = v;
      }
      return out;
    }
    return incoming;
  }

  function readImportStorage(key){
    try{ return window.localStorage.getItem(key); }
    catch(error){ throw new Error(`localStorage / ${key}: ${error?.message || error}`); }
  }

  function writeImportStorage(key, value){
    try{
      const text = String(value ?? '');
      if (window.A33Storage.setItem(key, text) === false) throw new Error('Escritura rechazada (espacio o acceso al almacenamiento).');
      if (window.localStorage.getItem(key) !== text) throw new Error('La lectura de verificación no coincide con lo escrito.');
    }catch(error){ throw new Error(`localStorage / ${key}: ${error?.message || error}`); }
  }

  function mergeLocalStorageValue(key, incomingRaw){
    if (String(key || '') === QUICK_ORDERS_BACKUP_KEY){
      try{
        const currentRaw = readImportStorage(key) || '[]';
        const merged = mergeQuickOrdersBackupValues(currentRaw,incomingRaw);
        writeImportStorage(key,JSON.stringify(merged));
        return true;
      }catch(error){
        console.warn('Pedidos rápidos no pudieron fusionarse durante la importación.',error);
        return false;
      }
    }
    if (String(key || '') === AGENDA_BACKUP_KEY){
      try{
        const currentRaw = readImportStorage(key) || JSON.stringify({ schemaVersion:AGENDA_BACKUP_SCHEMA_VERSION,records:[] });
        const merged = mergeAgendaBackupValues(currentRaw,incomingRaw);
        writeImportStorage(key,JSON.stringify(merged));
        return true;
      }catch(error){
        console.warn('Agenda no pudo fusionarse durante la importación.',error);
        return false;
      }
    }
    if (String(key || '') === 'a33_catalog_deleted_product_ids_v2' && window.A33ProductIntegrity){
      const current = window.A33ProductIntegrity.readTombstones();
      let incoming = [];
      try{ incoming = typeof incomingRaw === 'string' ? JSON.parse(incomingRaw || '[]') : incomingRaw; }catch(_){ incoming = []; }
      const merged = window.A33ProductIntegrity.mergeTombstones(current, Array.isArray(incoming) ? incoming : []);
      writeImportStorage(key, JSON.stringify(merged));
      return true;
    }
    const currentRaw = readImportStorage(key);
    const cur = tryParseJsonValue(currentRaw);
    const inc = tryParseJsonValue(String(incomingRaw ?? ''));
    if (cur.ok && inc.ok && cur.value !== undefined && inc.value !== undefined){
      const merged = mergeJsonValue(cur.value, inc.value, key);
      writeImportStorage(key, JSON.stringify(merged)); return true;
    }
    try{ writeImportStorage(key, String(incomingRaw ?? '')); return true; }catch(_){ return false; }
  }

  function dateCandidateToIso(value){
    if (value === undefined || value === null || value === '') return '';
    let raw = value;
    if (typeof raw === 'number'){
      if (raw > 0 && raw < 10000000000) raw *= 1000;
    }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString();
  }

  function scanLatestDate(value, label, depth, best){
    if (depth > 5 || value === undefined || value === null) return best;
    if (Array.isArray(value)){
      value.forEach((item) => { best = scanLatestDate(item, label, depth + 1, best); });
      return best;
    }
    if (typeof value !== 'object') return best;
    for (const [k, v] of Object.entries(value)){
      const key = String(k || '').toLowerCase();
      if (/fecha|date|createdat|updatedat|closedat|timestamp|exportedat|importedat|operacion/.test(key)){
        const iso = dateCandidateToIso(v);
        if (iso && (!best.at || new Date(iso).getTime() > new Date(best.at).getTime())){
          best = { at: iso, label };
        }
      }
      if (v && typeof v === 'object') best = scanLatestDate(v, label, depth + 1, best);
    }
    return best;
  }

  function inferLastOperationFromBackup(obj){
    let best = { at: '', label: '' };
    const indexed = obj?.data?.indexedDB || {};
    for (const [dbName, stores] of Object.entries(indexed || {})){
      for (const [storeName, records] of Object.entries(stores || {})){
        best = scanLatestDate(records, `${dbName}/${storeName}`, 0, best);
      }
    }
    const local = obj?.data?.localStorage || {};
    for (const [key, raw] of Object.entries(local || {})){
      const parsed = tryParseJsonValue(raw);
      if (parsed.ok) best = scanLatestDate(parsed.value, `localStorage/${key}`, 0, best);
    }
    return best;
  }

  function getBackupModulesForLog(meta, kind){
    if ((kind?.type || getBackupImportKind({ meta }).type) === 'full') return ['Completo'];
    return getPartialModulesIncluded(meta);
  }

  function readBackupImportLog(){
    try{
      const raw = window.A33Storage.getItem('suite_a33_backup_import_log_v1');
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    }catch(_){ return []; }
  }

  function formatBackupLogDate(value){
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-NI', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false });
  }

  function renderBackupImportLog(){
    const box = document.getElementById('cfg-backup-import-log');
    if (!box) return;
    const list = readBackupImportLog().slice(0, 12);
    if (!list.length){
      box.innerHTML = '<div class="cfg-backup-import-empty">Sin JSON importados registrados todavía.</div>';
      return;
    }
    const rows = list.map((item) => {
      const type = String(item.backupType || '').toLowerCase() === 'partial' ? 'Parcial' : 'Completo';
      const modules = Array.isArray(item.modulesIncluded) && item.modulesIncluded.length ? item.modulesIncluded.join(', ') : '—';
      const lastOp = item.lastOperationAt ? `${formatBackupLogDate(item.lastOperationAt)}${item.lastOperationLabel ? ' · ' + item.lastOperationLabel : ''}` : '—';
      return `
        <tr>
          <td>${escapeHtml(item.fileName || 'JSON importado')}</td>
          <td>${escapeHtml(formatBackupLogDate(item.importedAt))}</td>
          <td>${escapeHtml(type)}</td>
          <td>${escapeHtml(modules)}</td>
          <td>${escapeHtml(lastOp)}</td>
        </tr>
      `;
    }).join('');
    box.innerHTML = `
      <div class="cfg-backup-import-table-wrap" tabindex="0" aria-label="Historial de JSON importados">
        <table class="cfg-backup-import-table">
          <thead><tr><th>Archivo</th><th>Importado</th><th>Tipo</th><th>Módulos</th><th>Última operación</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function registerBackupImport(fileName, obj, kind, result){
    const at = new Date().toISOString();
    const meta = obj?.meta || {};
    const latest = inferLastOperationFromBackup(obj);
    const entry = {
      fileName: String(fileName || ''),
      importedAt: at,
      backupType: kind?.type || getBackupImportKind(obj).type,
      exportMode: meta.exportMode || kind?.exportMode || '',
      exportedAt: meta.exportedAt || '',
      modulesIncluded: getBackupModulesForLog(meta, kind),
      lastOperationAt: latest.at || meta.fechaHoraExportacion || meta.exportedAt || '',
      lastOperationLabel: latest.label || '',
      result: result || {}
    };
    try{ window.A33Storage.setItem('suite_a33_backup_last_import_at', at); }catch(_){ }
    try{ window.A33Storage.setItem('suite_a33_backup_last_import_file', entry.fileName); }catch(_){ }
    try{
      const raw = window.A33Storage.getItem('suite_a33_backup_import_log_v1');
      let list = [];
      try{ list = raw ? JSON.parse(raw) : []; }catch(_){ list = []; }
      if (!Array.isArray(list)) list = [];
      list.unshift(entry);
      window.A33Storage.setItem('suite_a33_backup_import_log_v1', JSON.stringify(list.slice(0, 20)));
    }catch(_){ }
    try{ renderBackupImportLog(); }catch(_){ }
  }

  async function prepareBackupProductsForImport(obj){
    const cleanObj = sanitizeBackupObject(obj);
    const posDb = cleanObj?.data?.indexedDB?.['a33-pos'];
    const hasProductsBlock = !!(posDb && Object.prototype.hasOwnProperty.call(posDb, 'products'));
    if (!hasProductsBlock) return { backup:cleanObj, hasProductsBlock:false, conflicts:[], blocked:[], assigned:[] };
    const incoming = Array.isArray(posDb.products) ? posDb.products : [];
    const current = (window.A33ProductIntegrity && typeof window.A33ProductIntegrity.getAllProductsRaw === 'function')
      ? await window.A33ProductIntegrity.getAllProductsRaw()
      : [];
    const normalized = window.A33ProductIntegrity
      ? window.A33ProductIntegrity.normalizeIncomingProducts(incoming, current)
      : { records:incoming, idMap:{}, conflicts:[], blocked:[], assigned:[] };

    let incomingTombstones = [];
    const tombRaw = cleanObj?.data?.localStorage?.['a33_catalog_deleted_product_ids_v2'];
    try{ incomingTombstones = typeof tombRaw === 'string' ? JSON.parse(tombRaw || '[]') : (Array.isArray(tombRaw) ? tombRaw : []); }catch(_){ incomingTombstones = []; }
    const allTombstones = window.A33ProductIntegrity
      ? window.A33ProductIntegrity.mergeTombstones(window.A33ProductIntegrity.readTombstones(), incomingTombstones)
      : incomingTombstones;
    const blockedIds = new Set(allTombstones.map((row) => String(row && row.productId || '').trim()).filter(Boolean));
    const blockedByImportedTombstone = normalized.records.filter((row) => blockedIds.has(String(row.productId || '').trim()));
    normalized.records = normalized.records.filter((row) => !blockedIds.has(String(row.productId || '').trim()));
    normalized.blocked = normalized.blocked.concat(blockedByImportedTombstone.map((row) => ({ productId:row.productId, name:row.name || row.nombre || '', source:'tombstone_json' })));

    const remapped = window.A33ProductIntegrity
      ? window.A33ProductIntegrity.remapProductReferences(cleanObj, normalized.idMap)
      : cleanObj;
    const remappedProducts = window.A33ProductIntegrity
      ? normalized.records.map((row) => window.A33ProductIntegrity.remapProductReferences(row, normalized.idMap))
      : normalized.records;
    remapped.data.indexedDB['a33-pos'].products = remappedProducts;
    remapped.meta = remapped.meta || {};
    remapped.meta.productIdentityImport = {
      productsBlockIncluded:true,
      assignedProductIds:normalized.assigned.length,
      blockedByTombstone:normalized.blocked.length,
      conflicts:normalized.conflicts.length,
      strategy:'productId'
    };
    return { backup:remapped, hasProductsBlock:true, ...normalized };
  }

  function productConflictMessage(conflicts){
    const list = (Array.isArray(conflicts) ? conflicts : []).slice(0, 8);
    const detail = list.map((item) => {
      const currentName = item?.current?.name || item?.current?.nombre || 'Producto actual';
      const incomingName = item?.incoming?.name || item?.incoming?.nombre || 'Producto importado';
      return `${item.productId}: “${currentName}” ↔ “${incomingName}”`;
    }).join(' · ');
    return `Conflicto de productId detectado. La importación fue detenida sin modificar datos. ${detail}`;
  }

  async function performFullImport(obj){
    const validation = validateBackupStructure(obj);
    if (!validation.ok) throw new Error(validation.reason);
    const cleanObj = sanitizeBackupObject(obj);
    const incomingLocalStorage = cleanObj?.data?.localStorage || {};
    const dbPayload = cleanObj?.data?.indexedDB || {};
    const dbVersions = cleanObj?.meta?.dbVersions || {};
    const dbSchemas = cleanObj?.meta?.dbSchemas || {};
    const fileSuite = Object.keys(dbPayload || {}).filter((dbName) => isSuiteDbName(dbName) && !isRetiredGateDbName(dbName));

    // Reemplazo por bloques presentes: un JSON sin Productos jamás vacía ni reconstruye Productos.
    for (const dbName of fileSuite){
      await restoreDatabase(dbName, dbPayload[dbName], dbVersions, dbSchemas);
    }
    // Materia Prima ausente se conserva, también en respaldos históricos.
    const rawMaterialsDefaulted = false;

    const incoming = sanitizeSuiteLocalStorageMap(incomingLocalStorage);
    for (const [k, v] of Object.entries(incoming)){
      if (!isSuiteLocalStorageKey(k) || isRetiredGateStorageKey(k)) continue;
      if (k === 'a33_catalog_deleted_product_ids_v2'){
        if (!mergeLocalStorageValue(k, v)) throw new Error(`localStorage / ${k}: no se pudo fusionar.`);
      }
      else if (k === QUICK_ORDERS_BACKUP_KEY){
        writeImportStorage(k,JSON.stringify(normalizeQuickOrdersBackupValue(v)));
      }
      else if (k === AGENDA_BACKUP_KEY){
        const normalizedAgenda = agendaNormalizePayloadValue(v);
        writeImportStorage(k,JSON.stringify(normalizedAgenda));
      } else writeImportStorage(k, String(v ?? ''));
    }
    if (window.A33ProductIntegrity && typeof window.A33ProductIntegrity.applyTombstonesToCatalog === 'function'){
      await window.A33ProductIntegrity.applyTombstonesToCatalog({ source:'importacion_completa' });
    }

    return {
      type:'full',
      indexedDB:fileSuite.length,
      localStorage:Object.keys(incoming || {}).length,
      scopedReplacement:true,
      rawMaterialsDefaulted,
      productsIncluded:!!(dbPayload?.['a33-pos'] && Object.prototype.hasOwnProperty.call(dbPayload['a33-pos'], 'products'))
    };
  }

  async function performPartialImport(obj){
    const validation = validateBackupStructure(obj);
    if (!validation.ok) throw new Error(validation.reason);
    const cleanObj = sanitizeBackupObject(obj);
    const dbPayload = cleanObj?.data?.indexedDB || {};
    const dbVersions = cleanObj?.meta?.dbVersions || {};
    const dbSchemas = cleanObj?.meta?.dbSchemas || {};
    const fileSuite = Object.keys(dbPayload || {}).filter((dbName) => isSuiteDbName(dbName) && !isRetiredGateDbName(dbName));
    const result = { type: 'partial', indexedDB: {}, localStorageKeys: 0 };

    for (const dbName of fileSuite){
      result.indexedDB[dbName] = await mergeDatabase(dbName, dbPayload[dbName], dbVersions, dbSchemas);
    }

    const incoming = sanitizeSuiteLocalStorageMap(cleanObj?.data?.localStorage || {});
    for (const [k, v] of Object.entries(incoming)){
      if (!isSuiteLocalStorageKey(k)) continue;
      if (isRetiredGateStorageKey(k)) continue;
      if (!mergeLocalStorageValue(k, v)) throw new Error(`localStorage / ${k}: no se pudo fusionar.`);
      result.localStorageKeys++;
    }
    if (window.A33ProductIntegrity && typeof window.A33ProductIntegrity.applyTombstonesToCatalog === 'function'){
      result.tombstonesApplied = await window.A33ProductIntegrity.applyTombstonesToCatalog({ source:'importacion_parcial' });
    }

    return result;
  }

  async function performImport(obj){
    const validation = validateBackupStructure(obj);
    if (!validation.ok) throw new Error(validation.reason);
    const prepared = await prepareBackupProductsForImport(obj);
    if (prepared.conflicts && prepared.conflicts.length){
      const error = new Error(productConflictMessage(prepared.conflicts));
      error.code = 'A33_PRODUCT_ID_CONFLICT';
      error.conflicts = prepared.conflicts;
      throw error;
    }
    const cleanObj = prepared.backup;
    const kind = getBackupImportKind(cleanObj);
    const result = kind.type === 'partial' ? await performPartialImport(cleanObj) : await performFullImport(cleanObj);
    result.productIdentity = {
      productsBlockIncluded:prepared.hasProductsBlock,
      assignedProductIds:(prepared.assigned || []).length,
      blockedByTombstone:(prepared.blocked || []).length,
      conflicts:0
    };
    return result;
  }

  async function handleExport(){
    window.A33Notice.show('Preparando respaldo…', 'process');
    showModal({
      title: 'Resumen del respaldo',
      bodyHtml: '<div class="muted">Generando resumen...</div>',
      primaryText: 'Cerrar',
      onPrimary: hideModal,
      cancelText: 'Cancelar',
      onCancel: hideModal
    });

    try{
      const { backup, jsonString, estimatedBytes, dbSnapshots, lsKeys } = await buildFullBackup();
      const totalDbRecords = dbSnapshots.reduce((acc, d) => {
        const stores = Object.values(d.stores || {});
        return acc + stores.reduce((a, s) => a + (Number(s.count) || 0), 0);
      }, 0);
      const hasAnyData = totalDbRecords > 0 || (lsKeys && lsKeys.length > 0);

      if (!hasAnyData){
        showModal({
          title: 'Resumen del respaldo',
          bodyHtml: '<div class="badge-warn">⚠️ No hay datos para respaldar.</div>',
          primaryText: 'Cerrar',
          onPrimary: hideModal,
          disableCancel: true
        });
        return;
      }

      const summaryHtml = buildSummaryHtmlFromSnapshot({
        dbSnapshots,
        lsKeys,
        exportedAt: backup?.meta?.exportedAt,
        estimatedBytes,
        warnings: [],
        appName: backup?.meta?.appName,
        agenda:backup?.meta?.agenda
      });

      showModal({
        title: 'Resumen del respaldo',
        bodyHtml: summaryHtml,
        primaryText: 'Descargar respaldo',
        onPrimary: async () => {
          downloadBackup(buildBackupFilename(), jsonString, 'full', backup.meta.exportedAt);
          hideModal();
          showToast('Descarga de respaldo solicitada. Verificá que el archivo esté guardado.');
        },
        cancelText: 'Cancelar',
        onCancel: hideModal
      });
    }catch(e){
      showModal({
        title: 'Error',
        bodyHtml: `<div class="badge-warn">⚠️ ${escapeHtml(e?.message || e)}</div>`,
        primaryText: 'Cerrar',
        onPrimary: hideModal,
        disableCancel: true
      });
    }
  }

  async function handleImportFile(file){
    if (!file) return;

    showModal({
      title: 'Resumen del archivo',
      bodyHtml: '<div class="muted">Leyendo archivo...</div>',
      primaryText: 'Cerrar',
      onPrimary: hideModal,
      cancelText: 'Cancelar',
      onCancel: hideModal
    });

    try{
      const text = await file.text();
      let obj;
      try{
        obj = JSON.parse(text);
      }catch(_){
        throw new Error('JSON inválido o corrupto.');
      }

      const v = validateBackupStructure(obj);
      if (!v.ok) throw new Error(v.reason);
      const kind = v.kind || getBackupImportKind(obj);

      const sum = summarizeBackupObject(obj);
      const warnings = await buildDbVersionWarnings(obj);
      const summaryHtml = buildImportSummaryHtml(obj, sum, warnings);
      const partial = kind.type === 'partial';
      const primaryText = partial ? 'Importar parcial' : 'Importar y reemplazar';
      const confirmText = partial
        ? 'Este respaldo es parcial. Solo se importarán las secciones incluidas y los datos no incluidos se conservarán. ¿Importar parcial?'
        : 'Esto reemplazará los bloques incluidos en el respaldo completo. Los bloques ausentes se conservarán. ¿Importar y reemplazar?';
      const workingText = partial
        ? 'Fusionando respaldo parcial por ID... No cierres esta pestaña.'
        : 'Aplicando reemplazo controlado por bloques... No cierres esta pestaña.';

      showModal({
        title: partial ? 'Resumen del respaldo parcial' : 'Resumen del archivo',
        bodyHtml: summaryHtml,
        primaryText,
        onPrimary: async () => {
          if (!confirm(confirmText)) return;

          showModal({
            title: 'Importando...',
            bodyHtml: `<div class="muted">${escapeHtml(workingText)}</div>`,
            disableCancel: true,
            disablePrimary: true
          });

          const applyImport = async (recovery) => {
            try{
              const result = await performImport(obj);
              registerBackupImport(file.name, obj, kind, result);
              const okText = partial
                ? '<div>✅ Respaldo parcial importado correctamente.</div><div class="small-note">Los datos no incluidos se conservaron. Recomendado: recargar para que todos los módulos lean los cambios.</div>'
                : '<div>✅ Respaldo completo importado correctamente por bloques.</div><div class="small-note">Los bloques ausentes se conservaron. Recomendado: recargar para que todos los módulos lean los nuevos datos.</div>';
              showModal({
                title: 'Importación exitosa',
                bodyHtml: okText,
                primaryText: 'Recargar ahora',
                onPrimary: () => location.reload(),
                cancelText: 'Más tarde',
                onCancel: hideModal
              });
            }catch(err){
              showModal({
                title: 'Error de importación',
                bodyHtml: `<div class="badge-warn">⚠️ ${escapeHtml(err?.message || err)}</div><div class="small-note">La importación puede haber aplicado bloques anteriores al fallo. Conservá el respaldo previo y cerrá otras pestañas antes de revisar la recuperación. No se restauraron datos automáticamente.</div>`,
                primaryText: 'Descargar respaldo previo',
                onPrimary: () => downloadBackup(recovery.filename, recovery.jsonString, 'recovery', recovery.preparedAt),
                cancelText: 'Cerrar',
                onCancel: hideModal
              });
            }
          };
          try{
            const snapshot = await buildFullBackup();
            const recovery = { jsonString:snapshot.jsonString, preparedAt:snapshot.backup.meta.exportedAt, filename:'suitea33-previo-importacion-' + Date.now() + '.json' };
            showModal({
              title:'Respaldo previo a importación',
              bodyHtml:'<div>Antes de importar, descargá una copia completa del estado actual.</div><div class="small-note">Comprobá que el archivo se guardó. Esta aplicación confirma la solicitud de descarga, pero no puede comprobar el guardado final en disco.</div>',
              primaryText:'Descargar respaldo previo',
              onPrimary:() => {
                downloadBackup(recovery.filename, recovery.jsonString, 'recovery', recovery.preparedAt);
                showModal({
                  title:'Confirmar respaldo previo',
                  bodyHtml:'<div>Verificá que el respaldo previo está guardado y cerrá las demás pestañas de Suite A33 antes de continuar.</div>',
                  primaryText:'Continuar importación',
                  onPrimary:async() => {
                    showModal({ title:'Importando...', bodyHtml:`<div>${escapeHtml(workingText)}</div>`, disableCancel:true, disablePrimary:true });
                    await applyImport(recovery);
                  },
                  cancelText:'Cancelar', onCancel:hideModal
                });
              },
              cancelText:'Cancelar', onCancel:hideModal
            });
          }catch(error){
            showModal({title:'Importación bloqueada',bodyHtml:`<div class="badge-warn">No se pudo preparar el respaldo previo. No se inició la importación. ${escapeHtml(error?.message || error)}</div>`,primaryText:'Cerrar',onPrimary:hideModal,disableCancel:true});
          }

        },
        cancelText: 'Cancelar',
        onCancel: hideModal
      });
    }catch(e){
      showModal({
        title: 'Error',
        bodyHtml: `<div class="badge-warn">⚠️ ${escapeHtml(e?.message || e)}</div>`,
        primaryText: 'Cerrar',
        onPrimary: hideModal,
        disableCancel: true
      });
    }
  }


  function formatAuditDate(value){
    if (!value) return '—';
    try{ return new Date(value).toLocaleString('es-NI'); }catch(_){ return String(value); }
  }

  function buildProductAuditHtml(rows){
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length){
      return '<div class="badge-ok">✅ No hay productos en el catálogo. La auditoría no creó ni sembró ninguno.</div>';
    }
    const body = list.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.productId)}</small></td>
        <td>${escapeHtml(row.state)}</td>
        <td>${escapeHtml(row.classification)}<small>Confianza: ${escapeHtml(row.confidence)}</small></td>
        <td>${escapeHtml(row.origin)}<small>${escapeHtml(row.seedIndicator)}</small></td>
        <td>${row.recipe ? 'Sí' : 'No'} / ${row.cost ? 'Sí' : 'No'}</td>
        <td>${escapeHtml(row.envaseId || '—')}<small>Tapa: ${escapeHtml(row.tapaId || '—')}</small></td>
        <td>${Number(row.stock || 0)}</td>
        <td>${Number(row.relations.sales || 0)} / ${Number(row.relations.lots || 0)} / ${Number(row.relations.orders || 0)} / ${Number(row.relations.agenda || 0)}</td>
        <td class="cfg-product-audit-actions">
          <button type="button" class="cfg-btn cfg-btn-ghost" data-audit-detail="${escapeHtml(row.productId)}">Detalle</button>
          <button type="button" class="cfg-btn cfg-btn-ghost" data-audit-inactivate="${escapeHtml(row.productId)}">Inactivar</button>
          <button type="button" class="cfg-btn cfg-btn-danger" data-audit-delete="${escapeHtml(row.productId)}">Eliminar</button>
        </td>
      </tr>
    `).join('');
    return `
      <div class="cfg-product-audit-note">La auditoría es informativa. No borra ni modifica nada hasta que presiones una acción explícita.</div>
      <div class="cfg-product-audit-wrap" tabindex="0">
        <table class="cfg-product-audit-table">
          <thead><tr><th>Producto</th><th>Estado</th><th>Clasificación</th><th>Origen</th><th>Receta/Costos</th><th>Envase/Tapa</th><th>Stock</th><th>Ventas/Lotes/Pedidos/Agenda</th><th>Acciones</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  }

  function buildProductAuditDetail(row){
    const r = row || {};
    return `
      <div class="cfg-product-audit-detail">
        <div class="kv">
          <div class="k">productId</div><div class="v">${escapeHtml(r.productId || '—')}</div>
          <div class="k">Nombre</div><div class="v">${escapeHtml(r.name || '—')}</div>
          <div class="k">Estado</div><div class="v">${escapeHtml(r.state || '—')}</div>
          <div class="k">Clasificación</div><div class="v">${escapeHtml(r.classification || '—')}</div>
          <div class="k">Confianza</div><div class="v">${escapeHtml(r.confidence || '—')}</div>
          <div class="k">Origen</div><div class="v">${escapeHtml(r.origin || '—')}</div>
          <div class="k">Creado</div><div class="v">${escapeHtml(formatAuditDate(r.createdAt))}</div>
          <div class="k">Modificado</div><div class="v">${escapeHtml(formatAuditDate(r.updatedAt))}</div>
          <div class="k">Receta</div><div class="v">${r.recipe ? 'Sí' : 'No'}</div>
          <div class="k">Costos</div><div class="v">${r.cost ? 'Sí' : 'No'}</div>
          <div class="k">Envase</div><div class="v">${escapeHtml(r.envaseId || '—')}</div>
          <div class="k">Tapa</div><div class="v">${escapeHtml(r.tapaId || '—')}</div>
          <div class="k">Stock</div><div class="v">${Number(r.stock || 0)}</div>
          <div class="k">Ventas relacionadas</div><div class="v">${Number(r.relations?.sales || 0)}</div>
          <div class="k">Lotes relacionados</div><div class="v">${Number(r.relations?.lots || 0)}</div>
          <div class="k">Pedidos relacionados</div><div class="v">${Number(r.relations?.orders || 0)}</div>
          <div class="k">Agenda relacionada</div><div class="v">${Number(r.relations?.agenda || 0)}</div>
          <div class="k">Indicador de semilla</div><div class="v">${escapeHtml(r.seedIndicator || '—')}</div>
          <div class="k">Tombstone</div><div class="v">${r.tombstoned ? 'Sí' : 'No'}</div>
        </div>
      </div>
    `;
  }

  async function handleProductAudit(){
    if (!window.A33ProductIntegrity || typeof window.A33ProductIntegrity.auditProducts !== 'function'){
      showToast('La herramienta de integridad no está disponible.');
      return;
    }
    showModal({ title:'Auditoría segura de Productos', bodyHtml:'<div class="muted">Revisando relaciones sin modificar datos...</div>', disableCancel:true, disablePrimary:true });
    try{
      const rows = await window.A33ProductIntegrity.auditProducts();
      showModal({
        title:'Auditoría segura de Productos',
        bodyHtml:buildProductAuditHtml(rows),
        primaryText:'Cerrar',
        onPrimary:hideModal,
        disableCancel:true
      });
      const body = document.getElementById('backup-modal-body');
      body?.querySelectorAll('[data-audit-detail]').forEach((button) => {
        button.onclick = () => {
          const row = rows.find((item) => item.productId === button.dataset.auditDetail);
          showModal({ title:'Detalle de relaciones', bodyHtml:buildProductAuditDetail(row), primaryText:'Volver a auditoría', onPrimary:handleProductAudit, cancelText:'Cerrar', onCancel:hideModal });
        };
      });
      body?.querySelectorAll('[data-audit-inactivate]').forEach((button) => {
        button.onclick = async () => {
          const row = rows.find((item) => item.productId === button.dataset.auditInactivate);
          if (!row || !confirm(`¿Inactivar y poner en cuarentena “${row.name}”?

No se borrarán ventas, lotes, pedidos, agenda ni históricos.`)) return;
          await window.A33ProductIntegrity.setInactive(row.productId, { quarantine:true, reason:'Auditoría controlada desde Configuración' });
          showToast('Producto inactivado y puesto en cuarentena.');
          await handleProductAudit();
        };
      });
      body?.querySelectorAll('[data-audit-delete]').forEach((button) => {
        button.onclick = async () => {
          const row = rows.find((item) => item.productId === button.dataset.auditDelete);
          if (!row) return;
          const ok = confirm(`Eliminar “${row.name}” del catálogo maestro creará un tombstone por productId.

Los históricos se conservarán. ¿Continuar?`);
          if (!ok) return;
          const typed = prompt(`Confirmación final: escribe ELIMINAR para borrar ${row.productId}`);
          if (String(typed || '').trim().toUpperCase() !== 'ELIMINAR'){
            showToast('Eliminación cancelada.');
            return;
          }
          await window.A33ProductIntegrity.deleteProduct(row.productId, { origin:'auditoria_configuracion', confirmed:true });
          showToast('Producto eliminado con tombstone; históricos conservados.');
          await handleProductAudit();
        };
      });
    }catch(error){
      showModal({ title:'Auditoría no disponible', bodyHtml:`<div class="badge-warn">⚠️ ${escapeHtml(error?.message || error)}</div>`, primaryText:'Cerrar', onPrimary:hideModal, disableCancel:true });
    }
  }


  const USER_ROLE_META = {
    admin: { label: 'Admin' },
    ventas: { label: 'Ventas' },
    finanzas: { label: 'Finanzas' },
    consulta: { label: 'Consulta' }
  };
  const USER_STATUS_META = {
    active: { label: 'Activo' },
    inactive: { label: 'Inactivo' },
    pending: { label: 'Pendiente' }
  };

  function normalizeUserName(name){
    return String(name || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeUserEmail(email){
    return String(email || '').trim().toLowerCase();
  }

  function isValidEmail(email){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  }

  function getRoleMetaMap(){
    const access = window.A33Access;
    if (access && typeof access.getRoleOptions === 'function'){
      return access.getRoleOptions().reduce((acc, item) => {
        acc[item.key] = { label: item.label, description: item.description, permissions: item.permissions || [] };
        return acc;
      }, {});
    }
    return USER_ROLE_META;
  }

  function getRoleLabel(role){
    const meta = getRoleMetaMap();
    return meta[role]?.label || 'Sin rol';
  }

  const IDENTITY_STORAGE_KEY = 'suite_a33_identity_v1';
  const IDENTITY_LOGO_MAX_BYTES = 2.5 * 1024 * 1024;
  const IDENTITY_FIELD_MAP = [
    { key: 'commercialName', id: 'cfg-identity-commercial-name', summaryId: 'cfg-identity-summary-commercial-name' },
    { key: 'legalName', id: 'cfg-identity-legal-name', summaryId: 'cfg-identity-summary-legal-name' },
    { key: 'taxId', id: 'cfg-identity-tax-id', summaryId: 'cfg-identity-summary-tax-id' },
    { key: 'phone', id: 'cfg-identity-phone', summaryId: 'cfg-identity-summary-phone' },
    { key: 'whatsapp', id: 'cfg-identity-whatsapp', summaryId: 'cfg-identity-summary-whatsapp' },
    { key: 'email', id: 'cfg-identity-email', summaryId: 'cfg-identity-summary-email' },
    { key: 'address', id: 'cfg-identity-address', summaryId: 'cfg-identity-summary-address' },
    { key: 'suiteName', id: 'cfg-identity-suite-name', summaryId: 'cfg-identity-summary-suite-name' },
    { key: 'mainBrand', id: 'cfg-identity-main-brand', summaryId: 'cfg-identity-summary-main-brand' },
    { key: 'tagline', id: 'cfg-identity-tagline' }
  ];

  const identityRuntime = {
    logo: null,
    loaded: false
  };

  function buildEmptyIdentity(){
    const out = {
      logo: {
        dataUrl: '',
        name: '',
        type: '',
        size: 0,
        updatedAt: ''
      },
      updatedAt: ''
    };
    IDENTITY_FIELD_MAP.forEach((field) => { out[field.key] = ''; });
    return out;
  }

  function normalizeIdentity(raw){
    const base = buildEmptyIdentity();
    const src = (raw && typeof raw === 'object') ? raw : {};
    IDENTITY_FIELD_MAP.forEach((field) => {
      base[field.key] = (src[field.key] == null) ? '' : String(src[field.key]).trim();
    });
    const logo = (src.logo && typeof src.logo === 'object') ? src.logo : {};
    const rawDataUrl = (logo.dataUrl == null) ? '' : String(logo.dataUrl).trim();
    const isSafeImage = /^data:image\//i.test(rawDataUrl);
    base.logo = {
      dataUrl: isSafeImage ? rawDataUrl : '',
      name: isSafeImage && logo.name != null ? String(logo.name).trim() : '',
      type: isSafeImage && logo.type != null ? String(logo.type).trim() : '',
      size: isSafeImage && Number.isFinite(Number(logo.size)) ? Number(logo.size) : 0,
      updatedAt: isSafeImage && logo.updatedAt != null ? String(logo.updatedAt).trim() : ''
    };
    base.updatedAt = (src.updatedAt == null) ? '' : String(src.updatedAt).trim();
    return base;
  }

  function readIdentityStorage(){
    try{
      if (window.A33Storage && typeof window.A33Storage.getJSON === 'function'){
        return normalizeIdentity(window.A33Storage.getJSON(IDENTITY_STORAGE_KEY, buildEmptyIdentity(), 'local'));
      }
    }catch(_){ }
    try{
      const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
      return normalizeIdentity(raw ? JSON.parse(raw) : buildEmptyIdentity());
    }catch(_){
      return buildEmptyIdentity();
    }
  }

  function writeIdentityStorage(identity){
    const clean = normalizeIdentity(identity);
    try{
      if (window.A33Storage && typeof window.A33Storage.setJSON === 'function'){
        const ok = window.A33Storage.setJSON(IDENTITY_STORAGE_KEY, clean, 'local');
        if (ok) return true;
      }
    }catch(_){ }
    try{
      localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(clean));
      return true;
    }catch(_){
      return false;
    }
  }

  function setIdentityStatus(message){
    if (message && !/cargad[oa]|empiezan vacíos|preferencias listas|no está configurado/i.test(message)) window.A33Notice.show(message);
    const el = document.getElementById('cfg-identity-status');
    if (el) el.textContent = String(message || '');
  }

  function getIdentityFieldValue(id){
    const el = document.getElementById(id);
    if (!el) return '';
    return String(el.value || '').trim();
  }

  function setIdentityFieldValue(id, value){
    const el = document.getElementById(id);
    if (!el) return;
    el.value = (value == null) ? '' : String(value);
  }

  function renderIdentityLogo(logo){
    const safeLogo = (logo && typeof logo === 'object') ? logo : buildEmptyIdentity().logo;
    const img = document.getElementById('cfg-identity-logo-img');
    const placeholder = document.getElementById('cfg-identity-logo-placeholder');
    const title = document.getElementById('cfg-identity-logo-title');
    const meta = document.getElementById('cfg-identity-logo-meta');
    const hasLogo = /^data:image\//i.test(String(safeLogo.dataUrl || '').trim());

    if (img){
      if (hasLogo){
        img.src = safeLogo.dataUrl;
        img.hidden = false;
      } else {
        img.removeAttribute('src');
        img.hidden = true;
      }
    }
    if (placeholder) placeholder.hidden = hasLogo;
    if (title) title.textContent = hasLogo ? (safeLogo.name || 'Logo cargado') : 'Sin logo cargado';
    if (meta){
      if (hasLogo){
        const sizeText = safeLogo.size ? formatBytes(safeLogo.size) : 'tamaño no disponible';
        const typeText = safeLogo.type || 'imagen';
        meta.textContent = `${typeText} · ${sizeText} · guardado localmente al presionar Guardar.`;
      } else {
        meta.textContent = 'Podés subir una imagen común compatible con navegador. Se guardará localmente junto con la Identidad.';
      }
    }
  }


  function identityDisplayValue(value){
    const clean = String(value || '').trim();
    return clean || '—';
  }

  function identityHasContent(data){
    const hasText = IDENTITY_FIELD_MAP.some((field) => String(data[field.key] || '').trim());
    const hasLogo = /^data:image\//i.test(String(data.logo && data.logo.dataUrl || '').trim());
    return hasText || hasLogo;
  }

  function setIdentitySummaryText(id, value){
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = identityDisplayValue(value);
    el.classList.toggle('is-empty', !String(value || '').trim());
  }

  function renderIdentitySummary(identity){
    const data = normalizeIdentity(identity);
    const hasAnyContent = identityHasContent(data);
    const hasLogo = /^data:image\//i.test(String(data.logo && data.logo.dataUrl || '').trim());
    const state = document.getElementById('cfg-identity-summary-state');
    const empty = document.getElementById('cfg-identity-summary-empty');
    const list = document.getElementById('cfg-identity-summary-list');
    const heroName = document.getElementById('cfg-identity-summary-name');
    const heroTagline = document.getElementById('cfg-identity-summary-tagline');
    const updated = document.getElementById('cfg-identity-summary-updated');
    const summaryImg = document.getElementById('cfg-identity-summary-logo-img');
    const summaryPlaceholder = document.getElementById('cfg-identity-summary-logo-placeholder');

    if (state) state.textContent = hasAnyContent ? 'Guardada' : 'Vacía';
    if (empty) empty.hidden = hasAnyContent;
    if (list) list.hidden = !hasAnyContent;

    if (heroName){
      const preferredName = data.commercialName || data.mainBrand || data.suiteName || 'Sin nombre comercial';
      heroName.textContent = preferredName;
      heroName.classList.toggle('is-empty', !hasAnyContent);
    }
    if (heroTagline){
      const text = data.tagline || (hasAnyContent ? 'Resumen de identidad general guardada localmente.' : 'La identidad aparecerá aquí cuando guardés los datos.');
      heroTagline.textContent = text;
      heroTagline.classList.toggle('is-empty', !String(data.tagline || '').trim());
    }

    if (summaryImg){
      if (hasLogo){
        summaryImg.src = data.logo.dataUrl;
        summaryImg.hidden = false;
      } else {
        summaryImg.removeAttribute('src');
        summaryImg.hidden = true;
      }
    }
    if (summaryPlaceholder) summaryPlaceholder.hidden = hasLogo;

    IDENTITY_FIELD_MAP.forEach((field) => {
      if (!field.summaryId) return;
      setIdentitySummaryText(field.summaryId, data[field.key]);
    });
    if (updated) updated.textContent = data.updatedAt ? formatPwaTimestamp(data.updatedAt) : 'Sin registros';
  }

  function populateIdentityForm(identity){
    const data = normalizeIdentity(identity);
    IDENTITY_FIELD_MAP.forEach((field) => {
      setIdentityFieldValue(field.id, data[field.key]);
    });
    identityRuntime.logo = { ...data.logo };
    renderIdentityLogo(identityRuntime.logo);
    renderIdentitySummary(data);
    if (data.updatedAt){
      setIdentityStatus(`Identidad cargada. Último guardado: ${formatPwaTimestamp(data.updatedAt)}.`);
    } else {
      setIdentityStatus('Los campos empiezan vacíos. Al guardar, la Identidad queda conservada en este navegador.');
    }
  }

  function collectIdentityForm(){
    const data = buildEmptyIdentity();
    IDENTITY_FIELD_MAP.forEach((field) => {
      data[field.key] = getIdentityFieldValue(field.id);
    });
    data.logo = normalizeIdentity({ logo: identityRuntime.logo }).logo;
    data.updatedAt = formatPwaDateForStorage(new Date());
    return data;
  }

  function readFileAsDataUrl(file){
    return new Promise((resolve, reject) => {
      if (typeof FileReader !== 'function'){
        reject(new Error('FileReader no disponible.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
      reader.readAsDataURL(file);
    });
  }

  async function handleIdentityLogoFile(file){
    if (!file) return;
    const type = String(file.type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    const looksImage = type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|bmp|ico)$/i.test(name);
    if (!looksImage){
      showToast('El logo debe ser una imagen compatible.');
      return;
    }
    if (Number(file.size || 0) > IDENTITY_LOGO_MAX_BYTES){
      showToast('El logo es demasiado pesado para guardarlo localmente. Probá con una imagen más liviana.');
      return;
    }
    try{
      const dataUrl = await readFileAsDataUrl(file);
      if (!/^data:image\//i.test(dataUrl || '')){
        showToast('No se pudo preparar la imagen seleccionada.');
        return;
      }
      identityRuntime.logo = {
        dataUrl,
        name: String(file.name || 'logo'),
        type: String(file.type || 'image/*'),
        size: Number(file.size || 0),
        updatedAt: formatPwaDateForStorage(new Date())
      };
      renderIdentityLogo(identityRuntime.logo);
      setIdentityStatus('Logo cargado en previsualización. Presioná Guardar para conservarlo.');
    }catch(_){
      showToast('No se pudo leer el logo seleccionado.');
    }
  }

  function saveIdentityFromForm(event){
    window.A33Notice.show('Guardando configuración…', 'process');
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const data = collectIdentityForm();
    const ok = writeIdentityStorage(data);
    if (!ok){
      setIdentityStatus('No se pudo guardar la Identidad en este navegador.');
      return;
    }
    populateIdentityForm(data);
    if (typeof renderReportsIdentityReference === 'function') renderReportsIdentityReference(data);
    setIdentityStatus(`Identidad guardada localmente: ${formatPwaTimestamp(data.updatedAt)}.`);
  }

  function initIdentitySection(){
    const form = document.getElementById('cfg-identity-form');
    if (!form) return;
    const saveBtn = document.getElementById('cfg-identity-save');
    const logoBtn = document.getElementById('cfg-identity-logo-button');
    const logoInput = document.getElementById('cfg-identity-logo-input');

    populateIdentityForm(readIdentityStorage());
    identityRuntime.loaded = true;

    form.addEventListener('submit', saveIdentityFromForm);
    if (saveBtn){
      saveBtn.addEventListener('click', (event) => {
        event.preventDefault();
        saveIdentityFromForm(event);
      });
    }
    if (logoBtn && logoInput){
      logoBtn.addEventListener('click', () => {
        logoInput.value = '';
        logoInput.click();
      });
      logoInput.addEventListener('change', () => {
        const file = logoInput.files && logoInput.files[0];
        handleIdentityLogoFile(file).catch(() => {
          showToast('No se pudo cargar el logo.');
        });
      });
    }
  }


  const APPEARANCE_STORAGE_KEY = 'suite_a33_appearance_preference';
  const APPEARANCE_DEFAULT = 'dark';
  const APPEARANCE_OPTIONS = {
    dark: { label: 'Oscuro', badge: 'Modo oscuro' },
    light: { label: 'Claro', badge: 'Modo claro' },
    auto: { label: 'Automático', badge: 'Modo automático' }
  };

  const appearanceRuntime = {
    preference: APPEARANCE_DEFAULT,
    resolved: 'dark',
    mql: null,
    listening: false
  };

  function normalizeAppearancePreference(value){
    const v = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(APPEARANCE_OPTIONS, v) ? v : APPEARANCE_DEFAULT;
  }

  function getAppearanceSystemTheme(){
    try{
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    }catch(_){ }
    return 'light';
  }

  function resolveAppearanceTheme(preference){
    const pref = normalizeAppearancePreference(preference);
    return pref === 'auto' ? getAppearanceSystemTheme() : pref;
  }

  function readAppearancePreference(){
    try{
      if (window.A33Storage && typeof window.A33Storage.getItem === 'function'){
        const v = window.A33Storage.getItem(APPEARANCE_STORAGE_KEY);
        if (v !== undefined && v !== null && String(v).trim() !== '') return normalizeAppearancePreference(v);
      }
    }catch(_){ }
    try{
      return normalizeAppearancePreference(localStorage.getItem(APPEARANCE_STORAGE_KEY));
    }catch(_){ return APPEARANCE_DEFAULT; }
  }

  function writeAppearancePreference(preference){
    const pref = normalizeAppearancePreference(preference);
    let ok = false;
    try{
      if (window.A33Storage && typeof window.A33Storage.setItem === 'function'){
        window.A33Storage.setItem(APPEARANCE_STORAGE_KEY, pref);
        ok = true;
      }
    }catch(_){ }
    try{
      localStorage.setItem(APPEARANCE_STORAGE_KEY, pref);
      ok = true;
    }catch(_){ }
    return ok;
  }

  function updateAppearanceMetaColor(resolved){
    try{
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', resolved === 'light' ? '#f4ead8' : '#060606');
    }catch(_){ }
  }

  function publishAppearanceApi(){
    try{
      window.A33Theme = {
        storageKey: APPEARANCE_STORAGE_KEY,
        getPreference: () => appearanceRuntime.preference,
        getResolvedTheme: () => appearanceRuntime.resolved,
        setPreference: (preference) => {
          const pref = normalizeAppearancePreference(preference);
          writeAppearancePreference(pref);
          applyAppearanceTheme(pref, { render: true, notify: true });
          return pref;
        },
        apply: () => applyAppearanceTheme(readAppearancePreference(), { render: true, notify: true })
      };
    }catch(_){ }
  }

  function applyAppearanceTheme(preference, options = {}){
    const pref = normalizeAppearancePreference(preference);
    const resolved = resolveAppearanceTheme(pref);
    appearanceRuntime.preference = pref;
    appearanceRuntime.resolved = resolved;

    try{
      document.documentElement.setAttribute('data-a33-theme-preference', pref);
      document.documentElement.setAttribute('data-theme', resolved);
      if (document.body){
        document.body.setAttribute('data-a33-theme-preference', pref);
        document.body.setAttribute('data-theme', resolved);
      }
    }catch(_){ }

    updateAppearanceMetaColor(resolved);
    publishAppearanceApi();

    if (options.render !== false) renderAppearanceSection();
    if (options.notify !== false){
      try{
        window.dispatchEvent(new CustomEvent('a33:theme-change', {
          detail: { preference: pref, resolved }
        }));
      }catch(_){ }
    }

    return { preference: pref, resolved };
  }

  function getAppearancePreferenceLabel(preference){
    const pref = normalizeAppearancePreference(preference);
    return APPEARANCE_OPTIONS[pref].label;
  }

  function getAppearanceResolvedLabel(resolved){
    return resolved === 'light' ? 'Claro' : 'Oscuro';
  }

  function renderAppearanceSection(){
    const pref = normalizeAppearancePreference(appearanceRuntime.preference || readAppearancePreference());
    const resolved = resolveAppearanceTheme(pref);
    appearanceRuntime.preference = pref;
    appearanceRuntime.resolved = resolved;

    const current = document.getElementById('cfg-theme-current');
    if (current) current.textContent = `Modo actual: ${getAppearancePreferenceLabel(pref)}`;

    const resolvedText = document.getElementById('cfg-theme-resolved');
    if (resolvedText){
      resolvedText.textContent = pref === 'auto'
        ? `Tema aplicado: ${getAppearanceResolvedLabel(resolved)} según el sistema.`
        : `Tema aplicado: ${getAppearanceResolvedLabel(resolved)}.`;
    }

    const badge = document.getElementById('cfg-theme-badge');
    if (badge) badge.textContent = APPEARANCE_OPTIONS[pref].badge;

    const resolvedBadge = document.getElementById('cfg-theme-resolved-badge');
    if (resolvedBadge) resolvedBadge.textContent = `Aplicado: ${getAppearanceResolvedLabel(resolved)}`;

    const options = Array.from(document.querySelectorAll('[data-theme-pref]'));
    options.forEach((option) => {
      const active = normalizeAppearancePreference(option.dataset.themePref) === pref;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  function setupAppearanceSystemListener(){
    if (appearanceRuntime.listening) return;
    appearanceRuntime.listening = true;
    try{
      if (!window.matchMedia) return;
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      appearanceRuntime.mql = mql;
      const handler = () => {
        if (appearanceRuntime.preference === 'auto'){
          applyAppearanceTheme('auto', { render: true, notify: true });
        }
      };
      if (typeof mql.addEventListener === 'function') mql.addEventListener('change', handler);
      else if (typeof mql.addListener === 'function') mql.addListener(handler);
    }catch(_){ }
  }

  function initAppearanceSection(){
    const options = Array.from(document.querySelectorAll('[data-theme-pref]'));
    if (!options.length){
      applyAppearanceTheme(readAppearancePreference(), { render: false, notify: false });
      return;
    }

    options.forEach((option) => {
      option.addEventListener('click', () => {
        const pref = normalizeAppearancePreference(option.dataset.themePref);
        const ok = writeAppearancePreference(pref);
        applyAppearanceTheme(pref, { render: true, notify: true });
        window.A33Notice.show(ok ? `Apariencia guardada: ${getAppearancePreferenceLabel(pref)}.` : 'No se pudo guardar Apariencia en este navegador.', ok ? 'success' : 'error');
      });
      option.addEventListener('keydown', (event) => {
        const idx = options.indexOf(option);
        if (idx < 0) return;
        let nextIdx = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIdx = (idx + 1) % options.length;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIdx = (idx - 1 + options.length) % options.length;
        if (event.key === 'Home') nextIdx = 0;
        if (event.key === 'End') nextIdx = options.length - 1;
        if (nextIdx === null) return;
        event.preventDefault();
        const next = options[nextIdx];
        if (next && typeof next.focus === 'function') next.focus();
      });
    });

    setupAppearanceSystemListener();
    applyAppearanceTheme(readAppearancePreference(), { render: true, notify: false });
  }

  applyAppearanceTheme(readAppearancePreference(), { render: false, notify: false });

  function initConfigTabs(){
    const cards = Array.from(document.querySelectorAll('.cfg-tab[data-target]'));
    const panels = Array.from(document.querySelectorAll('.cfg-panel-view[data-panel]'));
    const panelsWrap = document.querySelector('.cfg-panels');
    const tabsWrap = document.querySelector('.cfg-tabs');
    const shell = document.querySelector('.cfg-shell');
    const shellHead = document.querySelector('.cfg-shell-head');
    if (!cards.length || !panels.length) return;

    let lastTarget = '';

    const setCardState = (target) => {
      cards.forEach((card) => {
        const active = !!target && card.dataset.target === target;
        card.classList.toggle('is-active', active);
        card.setAttribute('aria-expanded', active ? 'true' : 'false');
      });
    };

    const setPanelState = (target) => {
      panels.forEach((panel) => {
        const active = !!target && panel.dataset.panel === target;
        panel.classList.toggle('is-active', active);
        panel.hidden = !active;
        panel.setAttribute('aria-hidden', active ? 'false' : 'true');
      });
    };

    const showOverview = ({ focus = false } = {}) => {
      shell?.classList.remove('is-section-open');
      if (panelsWrap) panelsWrap.hidden = true;
      if (tabsWrap) tabsWrap.hidden = false;
      if (shellHead) shellHead.hidden = false;
      setPanelState('');
      setCardState('');

      if (focus){
        const targetCard = cards.find((card) => card.dataset.target === lastTarget) || cards[0];
        if (targetCard && typeof targetCard.focus === 'function'){
          window.setTimeout(() => {
            try{ targetCard.focus({ preventScroll: true }); }
            catch(_){ targetCard.focus(); }
          }, 80);
        }
      }
    };

    const openSection = (target, { focusPanel = false } = {}) => {
      const panel = panels.find((item) => item.dataset.panel === target);
      if (!panel) return;
      lastTarget = target;
      shell?.classList.add('is-section-open');
      if (panelsWrap) panelsWrap.hidden = false;
      if (tabsWrap) tabsWrap.hidden = true;
      if (shellHead) shellHead.hidden = true;
      setCardState(target);
      setPanelState(target);
      if (target === 'reports') renderReportsCurrencyReference();

      if (focusPanel){
        const navButton = panel.querySelector('[data-cfg-back]');
        const focusTarget = navButton || panel;
        if (focusTarget && typeof focusTarget.focus === 'function'){
          window.setTimeout(() => {
            try{ focusTarget.focus({ preventScroll: true }); }
            catch(_){ focusTarget.focus(); }
          }, 80);
        }
      }

      try{ window.scrollTo({ top: 0, behavior: 'smooth' }); }
      catch(_){ window.scrollTo(0, 0); }
    };

    cards.forEach((card) => {
      card.addEventListener('click', () => openSection(card.dataset.target, { focusPanel: true }));
      card.addEventListener('keydown', (event) => {
        const idx = cards.indexOf(card);
        if (idx < 0) return;
        let nextIdx = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIdx = (idx + 1) % cards.length;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIdx = (idx - 1 + cards.length) % cards.length;
        if (event.key === 'Home') nextIdx = 0;
        if (event.key === 'End') nextIdx = cards.length - 1;
        if (nextIdx === null) return;
        event.preventDefault();
        const nextCard = cards[nextIdx];
        if (nextCard && typeof nextCard.focus === 'function') nextCard.focus();
      });
    });

    window.A33ConfigNavigation = {
      openSection,
      showOverview
    };

    showOverview();
  }

  function initConfigNavigation(){
    const backButtons = Array.from(document.querySelectorAll('[data-cfg-back]'));
    backButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.A33ConfigNavigation && typeof window.A33ConfigNavigation.showOverview === 'function'){
          window.A33ConfigNavigation.showOverview({ focus: true });
          return;
        }
        const target = document.querySelector('.cfg-tabs') || document.querySelector('main');
        if (target && typeof target.scrollIntoView === 'function'){
          try{ target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
          catch(_){ target.scrollIntoView(); }
        }
      });
    });
  }

  const REPORTS_STORAGE_KEY = 'suite_a33_reports_preferences_v1';
  const REPORTS_IDENTITY_FIELDS = [
    { key: 'logo', checkboxId: 'cfg-reports-identity-logo', label: 'Logo principal' },
    { key: 'commercialName', checkboxId: 'cfg-reports-identity-commercial-name', refId: 'cfg-reports-ref-commercial-name', label: 'Nombre comercial' },
    { key: 'legalName', checkboxId: 'cfg-reports-identity-legal-name', refId: 'cfg-reports-ref-legal-name', label: 'Nombre legal' },
    { key: 'taxId', checkboxId: 'cfg-reports-identity-tax-id', refId: 'cfg-reports-ref-tax-id', label: 'RUC / identificación fiscal' },
    { key: 'phone', checkboxId: 'cfg-reports-identity-phone', refId: 'cfg-reports-ref-phone', label: 'Teléfono' },
    { key: 'whatsapp', checkboxId: 'cfg-reports-identity-whatsapp', refId: 'cfg-reports-ref-whatsapp', label: 'WhatsApp' },
    { key: 'email', checkboxId: 'cfg-reports-identity-email', refId: 'cfg-reports-ref-email', label: 'Correo' },
    { key: 'address', checkboxId: 'cfg-reports-identity-address', refId: 'cfg-reports-ref-address', label: 'Dirección' },
    { key: 'tagline', checkboxId: 'cfg-reports-identity-tagline', refId: 'cfg-reports-ref-tagline', label: 'Descripción corta / lema' }
  ];
  const REPORTS_EXPORT_MODULES = [
    { key: 'finances', locked: true, defaults: { excel: true, pdf: false, json: false, preview: false } },
    { key: 'pos', defaults: { excel: true, pdf: true, json: false, preview: true } },
    { key: 'inventory', defaults: { excel: true, pdf: true, json: false, preview: true } },
    { key: 'repack', defaults: { excel: true, pdf: true, json: false, preview: true } },
    { key: 'calculator', defaults: { excel: true, pdf: true, json: false, preview: true } },
    { key: 'agenda', defaults: { excel: true, pdf: true, json: false, preview: true } },
    { key: 'suite', defaults: { excel: false, pdf: false, json: true, preview: true } }
  ];
  const REPORTS_EXPORT_FORMATS = ['excel', 'pdf', 'json', 'preview'];

  function buildDefaultReportsModuleFormats(){
    const out = {};
    REPORTS_EXPORT_MODULES.forEach((module) => {
      out[module.key] = {};
      REPORTS_EXPORT_FORMATS.forEach((format) => {
        out[module.key][format] = !!(module.defaults && module.defaults[format]);
      });
      if (module.locked){
        out[module.key].excel = true;
        out[module.key].pdf = false;
        out[module.key].json = false;
        out[module.key].preview = false;
      }
    });
    return out;
  }

  function buildDefaultReportsPreferences(){
    const identityFields = {};
    REPORTS_IDENTITY_FIELDS.forEach((field) => { identityFields[field.key] = true; });
    return {
      version: 3,
      identityFields,
      format: {
        date: 'DD/MM/AAAA',
        dateTime: 'DD/MM/AAAA HH:mm',
        militaryTime: true,
        amPm: false
      },
      exports: {
        fileBaseName: '',
        fileDateMode: 'iso',
        financeFormat: 'excel',
        moduleFormats: buildDefaultReportsModuleFormats()
      },
      privacy: {
        showCosts: false,
        showProfit: false,
        protectInternalCommissions: true,
        hideCommissionPerSale: true
      },
      pos: {
        includeDiscounts: true,
        includeCourtesy: true,
        includeBankTransfers: true,
        includePaymentMethod: true
      },
      preview: {
        beforeExport: true
      },
      updatedAt: ''
    };
  }

  function normalizeReportsModuleFormats(raw){
    const base = buildDefaultReportsModuleFormats();
    const src = (raw && typeof raw === 'object') ? raw : {};
    REPORTS_EXPORT_MODULES.forEach((module) => {
      const moduleRaw = (src[module.key] && typeof src[module.key] === 'object') ? src[module.key] : {};
      REPORTS_EXPORT_FORMATS.forEach((format) => {
        if (module.locked){
          base[module.key][format] = format === 'excel';
        } else if (typeof moduleRaw[format] === 'boolean'){
          base[module.key][format] = moduleRaw[format];
        }
      });
    });
    return base;
  }

  function normalizeReportsPreferences(raw){
    const base = buildDefaultReportsPreferences();
    const src = (raw && typeof raw === 'object') ? raw : {};
    const identityFields = (src.identityFields && typeof src.identityFields === 'object') ? src.identityFields : {};
    REPORTS_IDENTITY_FIELDS.forEach((field) => {
      base.identityFields[field.key] = identityFields[field.key] === false ? false : true;
    });
    const exportsPrefs = (src.exports && typeof src.exports === 'object') ? src.exports : {};
    base.exports.fileBaseName = exportsPrefs.fileBaseName == null ? '' : String(exportsPrefs.fileBaseName).trim().slice(0, 64);
    base.exports.fileDateMode = 'iso';
    base.exports.financeFormat = 'excel';
    base.exports.moduleFormats = normalizeReportsModuleFormats(exportsPrefs.moduleFormats);

    const privacyPrefs = (src.privacy && typeof src.privacy === 'object') ? src.privacy : {};
    base.privacy.showCosts = privacyPrefs.showCosts === true;
    base.privacy.showProfit = privacyPrefs.showProfit === true;
    base.privacy.protectInternalCommissions = true;
    base.privacy.hideCommissionPerSale = true;

    const posPrefs = (src.pos && typeof src.pos === 'object') ? src.pos : {};
    base.pos.includeDiscounts = posPrefs.includeDiscounts === false ? false : true;
    base.pos.includeCourtesy = posPrefs.includeCourtesy === false ? false : true;
    base.pos.includeBankTransfers = posPrefs.includeBankTransfers === false ? false : true;
    base.pos.includePaymentMethod = posPrefs.includePaymentMethod === false ? false : true;

    const previewPrefs = (src.preview && typeof src.preview === 'object') ? src.preview : {};
    base.preview.beforeExport = previewPrefs.beforeExport === false ? false : true;

    base.updatedAt = src.updatedAt == null ? '' : String(src.updatedAt).trim();
    return base;
  }

  function readReportsPreferences(){
    try{
      if (window.A33Storage && typeof window.A33Storage.getJSON === 'function'){
        return normalizeReportsPreferences(window.A33Storage.getJSON(REPORTS_STORAGE_KEY, buildDefaultReportsPreferences(), 'local'));
      }
    }catch(_){ }
    try{
      const raw = localStorage.getItem(REPORTS_STORAGE_KEY);
      return normalizeReportsPreferences(raw ? JSON.parse(raw) : buildDefaultReportsPreferences());
    }catch(_){
      return buildDefaultReportsPreferences();
    }
  }

  function writeReportsPreferences(preferences){
    const clean = normalizeReportsPreferences(preferences);
    try{
      if (window.A33Storage && typeof window.A33Storage.setJSON === 'function'){
        const ok = window.A33Storage.setJSON(REPORTS_STORAGE_KEY, clean, 'local');
        if (ok) return true;
      }
    }catch(_){ }
    try{
      localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(clean));
      return true;
    }catch(_){
      return false;
    }
  }

  function setReportsStatus(message){
    if (message && !/cargad[oa]|empiezan vacíos|preferencias listas|no está configurado/i.test(message)) window.A33Notice.show(message);
    const el = document.getElementById('cfg-reports-status');
    if (el) el.textContent = String(message || '');
  }

  function setReportsBadge(text){
    const main = document.getElementById('cfg-reports-save-state');
    const side = document.getElementById('cfg-reports-side-badge');
    [main, side].forEach((el) => {
      if (el) el.textContent = String(text || 'Base local');
    });
  }

  function getReportsCommercialName(){
    const identity = normalizeIdentity(readIdentityStorage());
    return String(identity.commercialName || '').trim();
  }

  function getReportsRecommendedBaseName(){
    return getReportsCommercialName() || 'SuiteA33';
  }

  function sanitizeReportsFileSegment(value){
    const clean = String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
    return clean || 'SuiteA33';
  }

  function getReportsIsoDateForFile(){
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function updateReportsFileNamePreview(){
    const input = document.getElementById('cfg-reports-file-base-name');
    const example = document.getElementById('cfg-reports-file-example');
    const hint = document.getElementById('cfg-reports-file-base-hint');
    const recommended = getReportsRecommendedBaseName();
    const rawBase = input && String(input.value || '').trim() ? input.value : recommended;
    const fileBase = sanitizeReportsFileSegment(rawBase);
    if (example) example.textContent = `${fileBase}_Modulo_TipoReporte_${getReportsIsoDateForFile()}.xlsx`;
    if (hint){
      hint.textContent = `Recomendado desde Identidad: ${recommended}. Si no existe Nombre comercial, se usa SuiteA33.`;
    }
  }

  function applyReportsModuleFormats(moduleFormats){
    const cleanFormats = normalizeReportsModuleFormats(moduleFormats);
    REPORTS_EXPORT_MODULES.forEach((module) => {
      REPORTS_EXPORT_FORMATS.forEach((format) => {
        const input = document.querySelector(`[data-report-module="${module.key}"][data-report-format="${format}"]`);
        if (!input) return;
        input.checked = !!(cleanFormats[module.key] && cleanFormats[module.key][format]);
        input.disabled = !!module.locked;
      });
    });
    const financesExcel = document.getElementById('cfg-reports-format-finances-excel');
    if (financesExcel){
      financesExcel.checked = true;
      financesExcel.disabled = true;
    }
  }

  function collectReportsModuleFormats(){
    const out = buildDefaultReportsModuleFormats();
    REPORTS_EXPORT_MODULES.forEach((module) => {
      REPORTS_EXPORT_FORMATS.forEach((format) => {
        if (module.locked){
          out[module.key][format] = format === 'excel';
          return;
        }
        const input = document.querySelector(`[data-report-module="${module.key}"][data-report-format="${format}"]`);
        if (input) out[module.key][format] = !!input.checked;
      });
    });
    return out;
  }

  function setReportsCheckbox(id, checked, disabled){
    const input = document.getElementById(id);
    if (!input) return;
    input.checked = !!checked;
    if (typeof disabled === 'boolean') input.disabled = disabled;
  }

  function applyReportsPreferencesToForm(preferences){
    const clean = normalizeReportsPreferences(preferences);
    REPORTS_IDENTITY_FIELDS.forEach((field) => {
      const input = document.getElementById(field.checkboxId);
      if (input) input.checked = clean.identityFields[field.key] !== false;
    });
    const baseInput = document.getElementById('cfg-reports-file-base-name');
    if (baseInput){
      baseInput.value = clean.exports.fileBaseName || getReportsRecommendedBaseName();
    }
    applyReportsModuleFormats(clean.exports.moduleFormats);
    setReportsCheckbox('cfg-reports-privacy-show-costs', clean.privacy.showCosts, false);
    setReportsCheckbox('cfg-reports-privacy-show-profit', clean.privacy.showProfit, false);
    setReportsCheckbox('cfg-reports-privacy-protect-commissions', true, true);
    setReportsCheckbox('cfg-reports-privacy-hide-commission-sale', true, true);
    setReportsCheckbox('cfg-reports-pos-discounts', clean.pos.includeDiscounts, false);
    setReportsCheckbox('cfg-reports-pos-courtesy', clean.pos.includeCourtesy, false);
    setReportsCheckbox('cfg-reports-pos-bank-transfers', clean.pos.includeBankTransfers, false);
    setReportsCheckbox('cfg-reports-pos-payment-method', clean.pos.includePaymentMethod, false);
    setReportsCheckbox('cfg-reports-preview-before-export', clean.preview.beforeExport, false);
    updateReportsFileNamePreview();
    if (clean.updatedAt){
      setReportsStatus(`Preferencias cargadas. Último guardado: ${formatPwaTimestamp(clean.updatedAt)}.`);
      setReportsBadge('Guardado local');
    } else {
      setReportsStatus('Preferencias listas. Se guardan únicamente al presionar el botón.');
      setReportsBadge('Base local');
    }
  }

  function collectReportsPreferencesFromForm(){
    const current = readReportsPreferences();
    const data = normalizeReportsPreferences(current);
    REPORTS_IDENTITY_FIELDS.forEach((field) => {
      const input = document.getElementById(field.checkboxId);
      data.identityFields[field.key] = input ? !!input.checked : true;
    });
    const baseInput = document.getElementById('cfg-reports-file-base-name');
    const baseValue = baseInput ? String(baseInput.value || '').trim() : '';
    data.format = buildDefaultReportsPreferences().format;
    data.exports.fileBaseName = baseValue || getReportsRecommendedBaseName();
    data.exports.fileDateMode = 'iso';
    data.exports.financeFormat = 'excel';
    data.exports.moduleFormats = collectReportsModuleFormats();
    data.exports.moduleFormats.finances = { excel: true, pdf: false, json: false, preview: false };
    data.privacy.showCosts = !!(document.getElementById('cfg-reports-privacy-show-costs') || {}).checked;
    data.privacy.showProfit = !!(document.getElementById('cfg-reports-privacy-show-profit') || {}).checked;
    data.privacy.protectInternalCommissions = true;
    data.privacy.hideCommissionPerSale = true;
    data.pos.includeDiscounts = !!(document.getElementById('cfg-reports-pos-discounts') || {}).checked;
    data.pos.includeCourtesy = !!(document.getElementById('cfg-reports-pos-courtesy') || {}).checked;
    data.pos.includeBankTransfers = !!(document.getElementById('cfg-reports-pos-bank-transfers') || {}).checked;
    data.pos.includePaymentMethod = !!(document.getElementById('cfg-reports-pos-payment-method') || {}).checked;
    data.preview.beforeExport = !!(document.getElementById('cfg-reports-preview-before-export') || {}).checked;
    data.updatedAt = formatPwaDateForStorage(new Date());
    return data;
  }

  function reportsRefValue(value){
    const clean = String(value || '').trim();
    return clean || 'No configurado';
  }

  function setReportsReferenceText(id, value){
    const el = document.getElementById(id);
    if (!el) return;
    const clean = String(value || '').trim();
    el.textContent = reportsRefValue(clean);
    el.classList.toggle('is-empty', !clean);
  }

  function getReportsCurrencyState(){
    const fallbackSettings = {
      primary: { name: 'Córdoba nicaragüense', symbol: 'C$', code: 'NIO' },
      secondary: { name: 'Dólar estadounidense', symbol: 'US$', code: 'USD' },
      exchangeRate: '',
      updatedAt: ''
    };
    try{
      if (window.A33Currency && typeof window.A33Currency.getState === 'function'){
        return window.A33Currency.getState();
      }
    }catch(_){ }
    try{
      const key = (window.A33Currency && window.A33Currency.storageKey) || 'suite_a33_currency_settings_v1';
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : fallbackSettings;
      const exchangeRate = String(parsed && parsed.exchangeRate || '').trim();
      const normalizedRate = exchangeRate && window.A33Currency && typeof window.A33Currency.normalizeExchangeRateValue === 'function'
        ? window.A33Currency.normalizeExchangeRateValue(exchangeRate)
        : exchangeRate;
      return {
        ok: true,
        settings: {
          ...fallbackSettings,
          ...(parsed && typeof parsed === 'object' ? parsed : {}),
          primary: fallbackSettings.primary,
          secondary: fallbackSettings.secondary,
          exchangeRate: normalizedRate,
          updatedAt: String(parsed && parsed.updatedAt || '').trim()
        },
        primary: fallbackSettings.primary,
        secondary: fallbackSettings.secondary,
        exchangeRate: normalizedRate ? Number(normalizedRate) : null,
        exchangeRateText: normalizedRate ? `T/C ${normalizedRate}` : 'T/C no configurado',
        hasExchangeRate: !!normalizedRate,
        storageKey: key,
        engineVersion: 0
      };
    }catch(_){
      return {
        ok: false,
        settings: fallbackSettings,
        primary: fallbackSettings.primary,
        secondary: fallbackSettings.secondary,
        exchangeRate: null,
        exchangeRateText: 'T/C no configurado',
        hasExchangeRate: false,
        storageKey: 'suite_a33_currency_settings_v1',
        engineVersion: 0
      };
    }
  }

  function renderReportsCurrencyReference(){
    const state = getReportsCurrencyState();
    const settings = state && state.settings ? state.settings : {};
    const primary = state && state.primary ? state.primary : (settings.primary || {});
    const secondary = state && state.secondary ? state.secondary : (settings.secondary || {});
    const primaryText = `${String(primary.symbol || 'C$').trim()} / ${String(primary.code || 'NIO').trim()}`;
    const secondaryText = `${String(secondary.symbol || 'US$').trim()} / ${String(secondary.code || 'USD').trim()}`;
    const rateText = state && state.hasExchangeRate
      ? String(settings.exchangeRate || state.exchangeRate || '').trim()
      : 'No configurado';
    const updatedText = state && state.hasExchangeRate ? formatPwaTimestamp(settings.updatedAt) : 'Sin registros';

    const primaryEl = document.getElementById('cfg-reports-currency-primary');
    const primaryNameEl = document.getElementById('cfg-reports-currency-primary-name');
    const secondaryEl = document.getElementById('cfg-reports-currency-secondary');
    const secondaryNameEl = document.getElementById('cfg-reports-currency-secondary-name');
    const rateEl = document.getElementById('cfg-reports-currency-rate');
    const rateStateEl = document.getElementById('cfg-reports-currency-rate-state');
    const updatedEl = document.getElementById('cfg-reports-currency-updated-at');
    const noteEl = document.getElementById('cfg-reports-currency-note');

    if (primaryEl) primaryEl.textContent = primaryText;
    if (primaryNameEl) primaryNameEl.textContent = String(primary.name || 'Córdoba nicaragüense');
    if (secondaryEl) secondaryEl.textContent = secondaryText;
    if (secondaryNameEl) secondaryNameEl.textContent = String(secondary.name || 'Dólar estadounidense');
    if (rateEl){
      rateEl.textContent = rateText;
      rateEl.classList.toggle('is-empty', !(state && state.hasExchangeRate));
    }
    if (rateStateEl){
      rateStateEl.textContent = state && state.hasExchangeRate
        ? 'T/C listo para reportes futuros. No recalcula reportes reales todavía.'
        : 'Estado seguro: sin conversiones automáticas.';
    }
    if (updatedEl){
      updatedEl.textContent = updatedText;
      updatedEl.classList.toggle('is-empty', !(state && state.hasExchangeRate));
    }
    if (noteEl){
      noteEl.textContent = state && state.hasExchangeRate
        ? `Estos valores provienen de Configuración → Moneda. Última actualización: ${updatedText}.`
        : 'Estos valores provienen de Configuración → Moneda. Falta configurar T/C para activar referencias futuras completas.';
      noteEl.dataset.state = state && state.hasExchangeRate ? 'ok' : 'missing-rate';
    }
    return state;
  }

  function renderReportsIdentityReference(identity){
    const data = normalizeIdentity(identity);
    const hasLogo = /^data:image\//i.test(String(data.logo && data.logo.dataUrl || '').trim());
    const img = document.getElementById('cfg-reports-ref-logo-img');
    const placeholder = document.getElementById('cfg-reports-ref-logo-placeholder');
    const logoText = document.getElementById('cfg-reports-ref-logo-text');
    if (img){
      if (hasLogo){
        img.src = data.logo.dataUrl;
        img.hidden = false;
      } else {
        img.removeAttribute('src');
        img.hidden = true;
      }
    }
    if (placeholder) placeholder.hidden = hasLogo;
    if (logoText){
      logoText.textContent = hasLogo ? (data.logo.name || 'Logo configurado') : 'No configurado';
      logoText.classList.toggle('is-empty', !hasLogo);
    }
    REPORTS_IDENTITY_FIELDS.forEach((field) => {
      if (!field.refId) return;
      setReportsReferenceText(field.refId, data[field.key]);
    });
    updateReportsFileNamePreview();
  }

  function saveReportsPreferences(event){
    window.A33Notice.show('Guardando configuración…', 'process');
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const data = collectReportsPreferencesFromForm();
    const ok = writeReportsPreferences(data);
    if (!ok){
      setReportsStatus('No se pudo guardar Reportes en este navegador.');
      setReportsBadge('Error local');
      return;
    }
    applyReportsPreferencesToForm(data);
    renderReportsIdentityReference(readIdentityStorage());
    renderReportsCurrencyReference();
    setReportsStatus(`Preferencias de Reportes guardadas: ${formatPwaTimestamp(data.updatedAt)}.`);
    setReportsBadge('Guardado local');
  }

  function markReportsDirty(){
    updateReportsFileNamePreview();
    setReportsStatus('Hay cambios sin guardar. Presioná Guardar preferencias para conservarlos.');
    setReportsBadge('Cambios pendientes');
  }

  function initReportsSection(){
    const form = document.getElementById('cfg-reports-form');
    if (!form) return;
    applyReportsPreferencesToForm(readReportsPreferences());
    renderReportsIdentityReference(readIdentityStorage());
    renderReportsCurrencyReference();
    form.addEventListener('submit', saveReportsPreferences);
    const saveBtn = document.getElementById('cfg-reports-save');
    if (saveBtn){
      saveBtn.addEventListener('click', (event) => {
        event.preventDefault();
        saveReportsPreferences(event);
      });
    }
    REPORTS_IDENTITY_FIELDS.forEach((field) => {
      const input = document.getElementById(field.checkboxId);
      if (input) input.addEventListener('change', markReportsDirty);
    });
    const baseInput = document.getElementById('cfg-reports-file-base-name');
    if (baseInput) baseInput.addEventListener('input', markReportsDirty);
    document.querySelectorAll('[data-report-module][data-report-format]').forEach((input) => {
      input.addEventListener('change', markReportsDirty);
    });
    document.querySelectorAll('[data-reports-privacy], [data-reports-pos], [data-reports-preview]').forEach((input) => {
      input.addEventListener('change', markReportsDirty);
    });
    window.addEventListener('storage', (event) => {
      const key = (window.A33Currency && window.A33Currency.storageKey) || 'suite_a33_currency_settings_v1';
      if (!event || event.key === key) renderReportsCurrencyReference();
    });
    window.A33ReportsConfig = Object.assign({}, window.A33ReportsConfig || {}, {
      storageKey: REPORTS_STORAGE_KEY,
      read: () => normalizeReportsPreferences(readReportsPreferences()),
      currency: () => getReportsCurrencyState()
    });
  }


  const CURRENCY_STORAGE_KEY = (window.A33Currency && window.A33Currency.storageKey) || 'suite_a33_currency_settings_v1';

  function buildDefaultCurrencySettings(){
    return window.A33Currency && typeof window.A33Currency.defaults === 'function'
      ? window.A33Currency.defaults()
      : {
          version: 1,
          mode: 'manual',
          primary: { name: 'Córdoba nicaragüense', symbol: 'C$', code: 'NIO' },
          secondary: { name: 'Dólar estadounidense', symbol: 'US$', code: 'USD' },
          exchangeRate: '',
          updatedAt: ''
        };
  }

  function normalizeCurrencyRateValue(value){
    if (window.A33Currency && typeof window.A33Currency.normalizeExchangeRateValue === 'function'){
      return window.A33Currency.normalizeExchangeRateValue(value);
    }
    const raw = String(value ?? '').trim().replace(',', '.');
    if (!raw) return '';
    if (!/^\d+(?:\.\d{0,2})?$/.test(raw)) return '';
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return '';
    return num.toFixed(2);
  }

  function normalizeCurrencySettings(settings){
    if (window.A33Currency && typeof window.A33Currency.normalizeSettings === 'function'){
      return window.A33Currency.normalizeSettings(settings);
    }
    const base = buildDefaultCurrencySettings();
    const src = (settings && typeof settings === 'object') ? settings : {};
    return {
      ...base,
      exchangeRate: normalizeCurrencyRateValue(src.exchangeRate),
      updatedAt: String(src.updatedAt || '').trim()
    };
  }

  function readCurrencyStorage(){
    if (window.A33Currency && typeof window.A33Currency.readSettings === 'function'){
      return window.A33Currency.readSettings();
    }
    let raw = '';
    try{
      if (window.A33Storage && typeof window.A33Storage.getItem === 'function'){
        const v = window.A33Storage.getItem(CURRENCY_STORAGE_KEY);
        if (v !== undefined && v !== null) raw = String(v);
      }
    }catch(_){ }
    if (!raw){
      try{ raw = localStorage.getItem(CURRENCY_STORAGE_KEY) || ''; }catch(_){ raw = ''; }
    }
    if (!raw) return buildDefaultCurrencySettings();
    try{
      const parsed = JSON.parse(raw);
      return normalizeCurrencySettings(parsed);
    }catch(_){
      return normalizeCurrencySettings({ exchangeRate: raw });
    }
  }

  function writeCurrencyStorage(settings){
    if (window.A33Currency && typeof window.A33Currency.saveSettings === 'function'){
      const result = window.A33Currency.saveSettings(settings);
      return !!(result && result.ok);
    }
    const data = normalizeCurrencySettings(settings);
    const payload = JSON.stringify(data);
    try{
      if (window.A33Storage && typeof window.A33Storage.setItem === 'function'){
        window.A33Storage.setItem(CURRENCY_STORAGE_KEY, payload);
      } else {
        localStorage.setItem(CURRENCY_STORAGE_KEY, payload);
      }
      return true;
    }catch(_){
      try{
        localStorage.setItem(CURRENCY_STORAGE_KEY, payload);
        return true;
      }catch(__){ return false; }
    }
  }

  function sanitizeCurrencyInputValue(value){
    if (window.A33Currency && typeof window.A33Currency.sanitizeExchangeRateInput === 'function'){
      return window.A33Currency.sanitizeExchangeRateInput(value);
    }
    let raw = String(value ?? '').replace(/,/g, '.').replace(/\s+/g, '');
    const negative = raw.startsWith('-');
    raw = raw.replace(/[^\d.]/g, '');
    const firstDot = raw.indexOf('.');
    let integerPart = '';
    let decimalPart = '';
    let hasDot = false;
    if (firstDot >= 0){
      hasDot = true;
      integerPart = raw.slice(0, firstDot).replace(/\./g, '');
      decimalPart = raw.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
    } else {
      integerPart = raw.replace(/\./g, '');
    }
    if (hasDot && !integerPart) integerPart = '0';
    let out = (negative ? '-' : '') + integerPart;
    if (hasDot) out += '.' + decimalPart;
    return out;
  }

  function validateCurrencyRate(rawValue){
    if (window.A33Currency && typeof window.A33Currency.validateExchangeRate === 'function'){
      return window.A33Currency.validateExchangeRate(rawValue);
    }
    const raw = String(rawValue ?? '').trim().replace(',', '.');
    if (!raw){
      return { ok: false, message: 'Ingresá un T/C válido antes de guardar.' };
    }
    if (raw.includes('-')){
      return { ok: false, message: 'El T/C no puede ser negativo.' };
    }
    if (!/^\d+(?:\.\d{0,2})?$/.test(raw)){
      return { ok: false, message: 'El T/C debe ser numérico y tener máximo 2 decimales.' };
    }
    const value = Number(raw);
    if (!Number.isFinite(value)){
      return { ok: false, message: 'El T/C debe ser un número válido.' };
    }
    if (value <= 0){
      return { ok: false, message: 'El T/C debe ser mayor que 0.' };
    }
    return { ok: true, value: value.toFixed(2), message: '' };
  }

  function setCurrencyStatus(message, state){
    if (message && !/cargad[oa]|empiezan vacíos|preferencias listas|no está configurado/i.test(message)) window.A33Notice.show(message, state);
    const el = document.getElementById('cfg-currency-status');
    if (!el) return;
    el.textContent = String(message || '');
    if (state) el.dataset.state = state;
    else delete el.dataset.state;
  }

  function setCurrencyBadge(message){
    const main = document.getElementById('cfg-currency-save-state');
    const side = document.getElementById('cfg-currency-side-badge');
    if (main) main.textContent = message;
    if (side) side.textContent = message;
  }

  function formatCurrencyRateForDisplay(rateText){
    if (window.A33Currency && typeof window.A33Currency.formatExchangeRate === 'function'){
      return window.A33Currency.formatExchangeRate(rateText);
    }
    return rateText ? `T/C ${rateText}` : 'T/C no configurado';
  }

  function renderCurrencySettings(settings, options = {}){
    const data = normalizeCurrencySettings(settings);
    const currencyState = (window.A33Currency && typeof window.A33Currency.getState === 'function')
      ? window.A33Currency.getState(data)
      : { hasExchangeRate: !!data.exchangeRate, exchangeRateText: data.exchangeRate ? `T/C ${data.exchangeRate}` : 'T/C no configurado' };
    const input = document.getElementById('cfg-currency-rate-input');
    const rateText = data.exchangeRate || '';
    if (input && !options.keepInput) input.value = rateText;

    const heroRate = document.getElementById('cfg-currency-hero-rate');
    if (heroRate) heroRate.textContent = rateText ? formatCurrencyRateForDisplay(rateText) : 'Sin configurar';

    const updatedAt = document.getElementById('cfg-currency-updated-at');
    if (updatedAt) updatedAt.textContent = data.updatedAt ? formatPwaTimestamp(data.updatedAt) : 'Sin registros';

    const previewPrimary = document.getElementById('cfg-currency-preview-primary');
    if (previewPrimary){
      previewPrimary.textContent = window.A33Currency && typeof window.A33Currency.formatCordobas === 'function'
        ? window.A33Currency.formatCordobas(1250)
        : 'C$1,250.00';
    }

    const previewSecondary = document.getElementById('cfg-currency-preview-secondary');
    if (previewSecondary){
      previewSecondary.textContent = window.A33Currency && typeof window.A33Currency.formatDollars === 'function'
        ? window.A33Currency.formatDollars(35.50)
        : 'US$35.50';
    }

    const previewRate = document.getElementById('cfg-currency-preview-rate');
    if (previewRate) previewRate.textContent = currencyState.exchangeRateText || (rateText ? `T/C ${rateText}` : 'T/C no configurado');

    const previewNote = document.getElementById('cfg-currency-preview-note');
    if (previewNote){
      previewNote.textContent = currencyState.hasExchangeRate
        ? 'Vista previa con el tipo de cambio guardado.'
        : 'Configurá un T/C válido para activar la vista previa.';
    }

    const heroCopy = document.getElementById('cfg-currency-hero-copy');
    if (heroCopy){
      heroCopy.textContent = currencyState.hasExchangeRate
        ? 'Tipo de cambio guardado en este navegador. Aún no se aplica a las operaciones de otros módulos.'
        : 'No hay tipo de cambio guardado. Ingresa un valor para activar la vista previa.';
    }

    if (currencyState.hasExchangeRate){
      setCurrencyBadge('Guardado');
      if (!options.silent) setCurrencyStatus(`T/C cargado: ${rateText}. Última actualización: ${formatPwaTimestamp(data.updatedAt)}.`, 'ok');
    } else {
      setCurrencyBadge('Sin configurar');
      if (!options.silent) setCurrencyStatus('El T/C no está configurado. El motor central queda en estado seguro.');
    }
  }

  function handleCurrencyInput(event){
    const input = event && event.currentTarget ? event.currentTarget : document.getElementById('cfg-currency-rate-input');
    if (!input) return;
    const before = input.value;
    const after = sanitizeCurrencyInputValue(before);
    if (before !== after){
      input.value = after;
      if (/\.\d{3,}/.test(before.replace(',', '.'))){
        setCurrencyStatus('Solo se permiten 2 decimales; el campo fue ajustado.', 'error');
        setCurrencyBadge('Cambios pendientes');
        return;
      }
    }
    setCurrencyStatus('Cambios sin guardar. Presioná Guardar para conservar el T/C.', '');
    setCurrencyBadge('Cambios pendientes');
  }

  function saveCurrencySettings(event){
    window.A33Notice.show('Guardando configuración…', 'process');
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const input = document.getElementById('cfg-currency-rate-input');
    const validation = validateCurrencyRate(input ? input.value : '');
    if (!validation.ok){
      setCurrencyStatus(validation.message, 'error');
      setCurrencyBadge('Error local');
      return;
    }
    const data = normalizeCurrencySettings({
      ...buildDefaultCurrencySettings(),
      exchangeRate: validation.value,
      updatedAt: formatPwaDateForStorage(new Date())
    });
    const ok = writeCurrencyStorage(data);
    if (!ok){
      setCurrencyStatus('No se pudo guardar Moneda en este navegador.', 'error');
      setCurrencyBadge('Error local');
      return;
    }
    renderCurrencySettings(data, { silent: true });
    renderReportsCurrencyReference();
    setCurrencyStatus(`Moneda guardada correctamente: T/C ${validation.value}.`, 'ok');
    setCurrencyBadge('Motor seguro');
  }

  function initCurrencySection(){
    const form = document.getElementById('cfg-currency-form');
    if (!form) return;
    renderCurrencySettings(readCurrencyStorage());
    form.addEventListener('submit', saveCurrencySettings);
    const input = document.getElementById('cfg-currency-rate-input');
    if (input){
      input.addEventListener('input', handleCurrencyInput);
      input.addEventListener('blur', () => {
        const validation = validateCurrencyRate(input.value);
        if (validation.ok) input.value = validation.value;
      });
    }
    const saveBtn = document.getElementById('cfg-currency-save');
    if (saveBtn){
      saveBtn.addEventListener('click', (event) => {
        event.preventDefault();
        saveCurrencySettings(event);
      });
    }
    window.A33CurrencyConfig = Object.assign({}, window.A33CurrencyConfig || {}, {
      read: () => normalizeCurrencySettings(readCurrencyStorage()),
      state: () => window.A33Currency && typeof window.A33Currency.getState === 'function'
        ? window.A33Currency.getState(readCurrencyStorage())
        : { settings: normalizeCurrencySettings(readCurrencyStorage()), hasExchangeRate: !!normalizeCurrencySettings(readCurrencyStorage()).exchangeRate },
      storageKey: CURRENCY_STORAGE_KEY,
      engine: window.A33Currency || null
    });
  }

  window.A33AgendaBackupContract = Object.freeze({
    storageKey:AGENDA_BACKUP_KEY,
    schemaVersion:AGENDA_BACKUP_SCHEMA_VERSION,
    normalizeRaw:function(raw){ return agendaNormalizePayloadValue(raw); },
    validateMap:function(map){ return parseAgendaBackupBlock(map); },
    mergeRaw:function(currentRaw,incomingRaw){ return mergeAgendaBackupValues(currentRaw,incomingRaw); },
    summarizeMap:function(map){ return agendaBackupSummary(map); }
  });

  window.A33QuickOrdersBackupContract = Object.freeze({
    storageKey:QUICK_ORDERS_BACKUP_KEY,
    schemaVersion:QUICK_ORDERS_BACKUP_SCHEMA_VERSION,
    normalizeRaw:function(raw){ return normalizeQuickOrdersBackupValue(raw); },
    mergeRaw:function(currentRaw,incomingRaw){ return mergeQuickOrdersBackupValues(currentRaw,incomingRaw); }
  });

  document.addEventListener('DOMContentLoaded', () => {
    initConfigTabs();
    initConfigNavigation();
    initPwaSection();
    initIdentitySection();
    initAppearanceSection();
    initReportsSection();
    initCurrencySection();
    renderBackupImportLog();
    renderLastBackupExport();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) renderLastBackupExport(); });
    window.addEventListener('storage', event => { if (event.key === LAST_EXPORT_KEY || event.key === null){ lastExportSession = null; lastExportWriteFailed = false; renderLastBackupExport(); } });

    const backupTab = document.getElementById('cfg-tab-backup');
    if (backupTab) backupTab.addEventListener('click', renderLastBackupExport);
    const exportBtn = document.getElementById('cfg-export-backup');
    const customExportBtn = document.getElementById('cfg-export-custom-backup');
    const importBtn = document.getElementById('cfg-import-backup');
    const diagnosticBtn = document.getElementById('cfg-storage-diagnostic');
    if (diagnosticBtn) diagnosticBtn.addEventListener('click', handleStorageDiagnostic);
    const auditBtn = document.getElementById('cfg-audit-products');
    const fileInput = document.getElementById('backup-file-input');

    if (exportBtn){
      exportBtn.addEventListener('click', () => {
        handleExport().catch((err) => {
          console.error(err);
          showToast('No se pudo generar el respaldo.');
        });
      });
    }

    if (customExportBtn){
      customExportBtn.addEventListener('click', () => {
        handleCustomExport().catch((err) => {
          console.error(err);
          showToast('No se pudo generar el respaldo personalizado.');
        });
      });
    }

    if (auditBtn){
      auditBtn.addEventListener('click', () => { handleProductAudit().catch((error) => { console.error(error); showToast('No se pudo completar la auditoría.'); }); });
    }
    if (importBtn && fileInput){
      importBtn.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
      });

      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        handleImportFile(file).catch((err) => {
          console.error(err);
          showToast('No se pudo importar el respaldo.');
        });
      });
    }
  });
})();
