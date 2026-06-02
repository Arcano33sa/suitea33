(function(){
  'use strict';

  const DB_NAME = 'a33-pos';
  const DB_VER = 34;
  const DEFAULT_GALON_PRICE = 900;
  const LEGACY_GALON_PRICE = 800;
  const CANON_GALON_LABEL = 'Galón 3750 ml';
  const SEED = [
    { name:'Vaso', price:100, manageStock:true, active:true, capacityMl:null },
    { name:'Pulso 250ml', price:120, manageStock:true, active:true },
    { name:'Media 375ml', price:150, manageStock:true, active:true },
    { name:'Djeba 750ml', price:300, manageStock:true, active:true },
    { name:'Litro 1000ml', price:330, manageStock:true, active:true },
    { name:CANON_GALON_LABEL, price:DEFAULT_GALON_PRICE, manageStock:true, active:true }
  ];

  let db = null;
  let currentEditId = null;
  let currentExtraEditId = null;
  let currentBankEditId = null;
  let currentCustomerEditId = null;
  let finDbCAT = null;
  let currentSupplierEditIdCAT = null;
  let currentSupplierProductsIdCAT = null;
  let currentSupplierProductEditIdCAT = null;

  const CUSTOMER_CATALOG_KEY = 'a33_pos_customersCatalog';
  const CUSTOMER_DISABLED_KEY = 'a33_pos_customersDisabled';
  const CUSTOMER_SCHEMA_VERSION = 1;
  const FIN_DB_NAME_CAT = 'finanzasDB';
  const FIN_DB_VERSION_CAT = 6;

  function qs(selector, root){ return (root || document).querySelector(selector); }
  function qsa(selector, root){ return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function byId(id){ return document.getElementById(id); }

  function activateTab(target){
    const key = String(target || '').trim();
    if (!key) return;
    qsa('.cat-tab').forEach((tab) => {
      const active = tab.getAttribute('data-target') === key;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    qsa('.cat-panel').forEach((panel) => {
      const active = panel.getAttribute('data-panel') === key;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });
  }

  function getInitialTabFromUrl(){
    const allowed = new Set(['productos','extras','bancos','clientes','proveedores']);
    let key = '';
    try{
      key = String(new URLSearchParams(window.location.search || '').get('tab') || '').trim().toLowerCase();
    }catch(_){ key = ''; }
    if (!key) {
      key = String((window.location.hash || '').replace(/^#/, '')).trim().toLowerCase();
    }
    return allowed.has(key) ? key : '';
  }

  function activateTabFromUrl(){
    const key = getInitialTabFromUrl();
    if (key) activateTab(key);
  }

  function bindTabs(){
    qsa('.cat-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-target');
        activateTab(target);
        try { window.history.replaceState(null, '', '#' + target); } catch(_){ }
      });
    });
  }

  function registerServiceWorker(){
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=4.20.80&r=8').then((reg)=>{
        try{ reg.update(); }catch(_){ }
      }).catch(() => {});
    }, { once:true });
  }

  function escapeHtml(str){
    return String(str || '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#039;');
  }

  function normName(value){
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  }

  function normKey(value){ return normName(value).replace(/\s+/g,''); }

  function mapProductNameToFinishedId(name){
    const n = normName(name);
    if (n.includes('pulso')) return 'pulso';
    if (n.includes('media')) return 'media';
    if (n.includes('djeba')) return 'djeba';
    if (n.includes('litro')) return 'litro';
    if (n.includes('galon') || n.includes('galón') || n.includes('gal')) return 'galon';
    return null;
  }

  function isValidPrice(value){
    const n = Number(value);
    return Number.isFinite(n) && n > 0;
  }

  function round2(value){
    let n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    return Math.round((Math.max(0, n) + Number.EPSILON) * 100) / 100;
  }

  function qty(value, fallback=0){
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.round((n + Number.EPSILON) * 10000) / 10000);
  }

  function fmt(value){
    const n = Number(value);
    return (Number.isFinite(n) ? n : 0).toLocaleString('es-NI', { minimumFractionDigits:2, maximumFractionDigits:2 });
  }

  function displayMoney(value){ return 'C$ ' + fmt(value); }

  function displayMl(value){
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '—';
    const fixed = Math.round((n + Number.EPSILON) * 100) / 100;
    return String(fixed).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1') + ' ml';
  }


  function statusText(active){ return active === false ? 'Inactivo' : 'Activo'; }
  function activeBool(value){ return value === false ? false : true; }
  function normBankName(value){ return normName(value).replace(/\s+/g,' '); }
  function normalizeBankType(value){
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'tarjeta' ? 'tarjeta' : 'transferencia';
  }
  function normalizeBankCurrency(value){
    const raw = String(value || '').trim().toUpperCase();
    if (raw === 'USD') return 'USD';
    if (raw === 'MIXED' || raw === 'MIXTA' || raw === 'AMBAS') return 'MIXED';
    return 'NIO';
  }
  function bankTypeLabel(value){ return normalizeBankType(value) === 'tarjeta' ? 'Tarjeta' : 'Transferencia'; }
  function bankCurrencyLabel(value){
    const c = normalizeBankCurrency(value);
    if (c === 'USD') return 'US$ / USD';
    if (c === 'MIXED') return 'Mixta';
    return 'C$ / NIO';
  }
  function bankActive(bank){ return bank && bank.isActive === false ? false : true; }
  function getExtraPrice(extra){
    const e = extra && typeof extra === 'object' ? extra : {};
    const candidates = [e.basePrice, e.price, e.unitPrice, e.precioBase, e.precio, e.precioUnitario];
    for (const c of candidates){
      const n = Number(c);
      if (Number.isFinite(n) && n >= 0) return round2(n);
    }
    return 0;
  }
  function getExtraUnitCost(extra){
    const e = extra && typeof extra === 'object' ? extra : {};
    const candidates = [e.unitCost, e.costoUnitario, e.costPerUnit, e.costo];
    for (const c of candidates){
      const n = Number(c);
      if (Number.isFinite(n) && n >= 0) return round2(n);
    }
    return 0;
  }
  function sortMasterByActiveName(a,b){
    const aa = activeBool(a && a.active) ? 0 : 1;
    const bb = activeBool(b && b.active) ? 0 : 1;
    if (aa !== bb) return aa - bb;
    return String((a && a.name) || '').localeCompare(String((b && b.name) || ''), 'es-NI', { sensitivity:'base' });
  }
  function sortBanks(a,b){
    const aa = bankActive(a) ? 0 : 1;
    const bb = bankActive(b) ? 0 : 1;
    if (aa !== bb) return aa - bb;
    const ta = normalizeBankType(a && a.type);
    const tb = normalizeBankType(b && b.type);
    if (ta !== tb) return ta.localeCompare(tb, 'es-NI');
    return String((a && a.name) || '').localeCompare(String((b && b.name) || ''), 'es-NI', { sensitivity:'base' });
  }

  function getCapacity(product){
    const p = product && typeof product === 'object' ? product : {};
    const candidates = [p.capacityMl, p.capacidadMl, p.volumeMl, p.volumenMl, p.ml, p.mililitros, p.sizeMl, p.capacidad];
    for (const c of candidates){
      const n = Number(c);
      if (Number.isFinite(n) && n > 0) return qty(n, 0);
    }
    const text = String(p.name || p.nombre || '');
    const m = text.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
    if (m){
      const n = Number(String(m[1]).replace(',','.'));
      if (Number.isFinite(n) && n > 0) return qty(n, 0);
    }
    return 0;
  }

  function getUnitCost(product){
    const p = product && typeof product === 'object' ? product : {};
    const candidates = [p.unitCost, p.costoUnitario, p.costPerUnit, p.costo, p.referenceUnitCost, p.costoUnitarioReferencia];
    for (const c of candidates){
      const n = Number(c);
      if (Number.isFinite(n) && n >= 0) return round2(n);
    }
    return 0;
  }

  function canonicalGroupKey(product){
    const name = String((product && (product.name || product.nombre)) || '');
    const fid = mapProductNameToFinishedId(name);
    return fid ? ('sku:' + fid) : ('name:' + normKey(name));
  }

  function scoreCanonicalProduct(product){
    if (!product) return -9999;
    const name = String(product.name || product.nombre || '');
    const nk = normKey(name);
    const fid = mapProductNameToFinishedId(name);
    let score = 0;
    if (product.active !== false) score += 1000;
    if (isValidPrice(product.price)) score += 100;
    if (product.manageStock !== false) score += 15;
    if (fid) score += 20;
    if (fid === 'galon'){
      if (nk === normKey(CANON_GALON_LABEL)) score += 80;
      if (normName(name).includes('3750')) score += 40;
      if (Number(product.price) === LEGACY_GALON_PRICE) score -= 60;
      if (Number(product.price) === DEFAULT_GALON_PRICE) score += 12;
    }
    if (product.updatedAt){
      const t = Date.parse(product.updatedAt);
      if (Number.isFinite(t)) score += Math.min(10, t / 1e15);
    }
    const id = Number(product.id);
    if (Number.isFinite(id)) score -= Math.min(1, id / 1000000);
    return score;
  }

  function canonicalProductsForSale(products){
    const groups = new Map();
    for (const p of (Array.isArray(products) ? products : [])){
      if (!p) continue;
      const key = canonicalGroupKey(p);
      if (!key || key === 'name:') continue;
      const cur = groups.get(key);
      if (!cur || scoreCanonicalProduct(p) > scoreCanonicalProduct(cur)) groups.set(key, p);
    }
    return Array.from(groups.values());
  }

  function sortProducts(a,b){
    const aa = (a && a.active === false) ? 1 : 0;
    const bb = (b && b.active === false) ? 1 : 0;
    if (aa !== bb) return aa - bb;
    const order = { pulso:1, media:2, djeba:3, litro:4, galon:5 };
    const oa = order[mapProductNameToFinishedId(a && a.name) || ''] || 99;
    const ob = order[mapProductNameToFinishedId(b && b.name) || ''] || 99;
    if (oa !== ob) return oa - ob;
    return String((a && a.name) || '').localeCompare(String((b && b.name) || ''), 'es-NI', { sensitivity:'base' });
  }

  function openDB(){
    if (db) return Promise.resolve(db);
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (event)=>{
        const d = event.target.result;
        if (!d.objectStoreNames.contains('products')){
          const os = d.createObjectStore('products', { keyPath:'id', autoIncrement:true });
          try{ os.createIndex('by_name','name',{ unique:true }); }catch(_){ }
        }
        if (!d.objectStoreNames.contains('events')){
          try{
            const ev = d.createObjectStore('events', { keyPath:'id', autoIncrement:true });
            ev.createIndex('by_name','name',{ unique:true });
          }catch(_){ }
        }
        if (!d.objectStoreNames.contains('sales')){
          try{
            const sales = d.createObjectStore('sales', { keyPath:'id', autoIncrement:true });
            sales.createIndex('by_date','date',{ unique:false });
            sales.createIndex('by_event','eventId',{ unique:false });
          }catch(_){ }
        }
        if (!d.objectStoreNames.contains('inventory')){
          try{
            const inv = d.createObjectStore('inventory', { keyPath:'id', autoIncrement:true });
            inv.createIndex('by_event','eventId',{ unique:false });
          }catch(_){ }
        }
        if (!d.objectStoreNames.contains('reempaques')){
          try{
            const rp = d.createObjectStore('reempaques', { keyPath:'id' });
            rp.createIndex('by_event','eventId',{ unique:false });
            rp.createIndex('by_createdAt','createdAt',{ unique:false });
          }catch(_){ }
        }
        if (!d.objectStoreNames.contains('extras')){
          try{
            const ex = d.createObjectStore('extras', { keyPath:'id', autoIncrement:true });
            ex.createIndex('by_name','name',{ unique:false });
            ex.createIndex('by_active','active',{ unique:false });
          }catch(_){ }
        } else {
          try{ event.target.transaction.objectStore('extras').createIndex('by_name','name',{ unique:false }); }catch(_){ }
          try{ event.target.transaction.objectStore('extras').createIndex('by_active','active',{ unique:false }); }catch(_){ }
        }
        if (!d.objectStoreNames.contains('banks')){
          try{
            const b = d.createObjectStore('banks', { keyPath:'id', autoIncrement:true });
            b.createIndex('by_name','name',{ unique:false });
            b.createIndex('by_active','isActive',{ unique:false });
            b.createIndex('by_type','type',{ unique:false });
          }catch(_){ }
        } else {
          try{ event.target.transaction.objectStore('banks').createIndex('by_name','name',{ unique:false }); }catch(_){ }
          try{ event.target.transaction.objectStore('banks').createIndex('by_active','isActive',{ unique:false }); }catch(_){ }
          try{ event.target.transaction.objectStore('banks').createIndex('by_type','type',{ unique:false }); }catch(_){ }
        }
        if (!d.objectStoreNames.contains('meta')){
          try{ d.createObjectStore('meta', { keyPath:'id' }); }catch(_){ }
        }
      };
      req.onsuccess = ()=>{
        db = req.result;
        try{ db.onversionchange = ()=>{ try{ db.close(); }catch(_){ } db = null; }; }catch(_){ }
        resolve(db);
      };
      req.onerror = ()=>reject(req.error || new Error('No se pudo abrir IndexedDB'));
      req.onblocked = ()=>reject(new Error('IndexedDB bloqueado por otra pestaña. Cierra otras pestañas de Suite A33 e intenta de nuevo.'));
    });
  }

  async function getAll(store){
    if (!db) await openDB();
    if (!db.objectStoreNames.contains(store)) return [];
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = ()=>resolve(req.result || []);
      req.onerror = ()=>reject(req.error);
    });
  }

  async function put(store, value){
    if (!db) await openDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(value);
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error || tx.error);
      tx.onerror = ()=>reject(tx.error || req.error);
    });
  }

  function setStatus(message, kind){
    const el = byId('cat-products-status');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-status' + (kind ? (' ' + kind) : '');
  }

  function toast(message){
    const el = byId('cat-toast');
    if (!el) return;
    el.textContent = message || 'Hecho';
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(()=>el.classList.remove('show'), 2200);
  }

  function setEditMsg(message, kind){
    const el = byId('cat-edit-msg');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-muted cat-edit-msg' + (kind ? (' ' + kind) : '');
  }

  async function seedMissingDefaults(force){
    const list = await getAll('products');
    const keys = new Set((list || []).map(p => normKey(p && p.name)));
    if (keys.has(normKey('Galón 3800ml')) || keys.has(normKey('Galón 3800 ml'))) keys.add(normKey(CANON_GALON_LABEL));

    for (const seed of SEED){
      const k = normKey(seed.name);
      let existing = (list || []).find(p => normKey(p && p.name) === k);
      if (!existing && k === normKey(CANON_GALON_LABEL)){
        existing = (list || []).find(p => p && mapProductNameToFinishedId(p.name || '') === 'galon');
      }
      if (existing){
        let changed = false;
        if (force && existing.active !== true){ existing.active = true; changed = true; }
        if (typeof existing.active === 'undefined'){ existing.active = true; changed = true; }
        if (typeof existing.manageStock === 'undefined'){ existing.manageStock = seed.manageStock; changed = true; }
        if (k === normKey(CANON_GALON_LABEL) && existing.name !== seed.name && !(list || []).some(p => p && p.id !== existing.id && normKey(p.name) === k)){
          existing.name = seed.name;
          changed = true;
        }
        if (k === normKey(CANON_GALON_LABEL) && Number(existing.price) === LEGACY_GALON_PRICE){ existing.price = seed.price; changed = true; }
        else if (!isValidPrice(existing.price)){ existing.price = seed.price; changed = true; }
        if (!existing.updatedAt && changed) existing.updatedAt = new Date().toISOString();
        if (changed) await put('products', existing);
      } else {
        await put('products', { ...seed, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
      }
    }
  }

  async function normalizeLegacyGallon(){
    const products = await getAll('products');
    const galons = (products || []).filter(p => p && mapProductNameToFinishedId(p.name || '') === 'galon');
    if (!galons.length) return;
    let canon = canonicalProductsForSale(galons)[0] || galons[0];
    if (!canon) return;
    const canonicalKey = normKey(CANON_GALON_LABEL);
    let preservedPrice = isValidPrice(canon.price) ? Number(canon.price) : DEFAULT_GALON_PRICE;
    const validNonLegacy = galons.find(p => p && isValidPrice(p.price) && Number(p.price) !== LEGACY_GALON_PRICE && p.active !== false);
    if (Number(preservedPrice) === LEGACY_GALON_PRICE) preservedPrice = validNonLegacy ? Number(validNonLegacy.price) : DEFAULT_GALON_PRICE;

    let changedCanon = false;
    if (canon.name !== CANON_GALON_LABEL && !(products || []).some(p => p && p.id !== canon.id && normKey(p.name) === canonicalKey)){
      canon.name = CANON_GALON_LABEL;
      changedCanon = true;
    }
    if (!isValidPrice(canon.price) || Number(canon.price) === LEGACY_GALON_PRICE){ canon.price = preservedPrice; changedCanon = true; }
    if (typeof canon.active === 'undefined'){ canon.active = true; changedCanon = true; }
    if (typeof canon.manageStock === 'undefined'){ canon.manageStock = true; changedCanon = true; }
    if (changedCanon){ canon.updatedAt = new Date().toISOString(); await put('products', canon); }

    for (const p of galons){
      if (!p || p.id === canon.id) continue;
      let ch = false;
      if (!isValidPrice(p.price)){ p.price = preservedPrice; ch = true; }
      if (p.active !== false){ p.active = false; ch = true; }
      if (typeof p.manageStock === 'undefined'){ p.manageStock = true; ch = true; }
      if (ch){ p.updatedAt = new Date().toISOString(); await put('products', p); }
    }
  }

  async function productHasMovements(product){
    if (!product) return false;
    const id = String(product.id ?? '').trim();
    const nk = normKey(product.name || '');
    try{
      const sales = await getAll('sales');
      if ((sales || []).some(s => s && ((id && String(s.productId ?? '').trim() === id) || (nk && normKey(s.productName || s.name || '') === nk)))) return true;
    }catch(_){ }
    try{
      const inv = await getAll('inventory');
      if ((inv || []).some(i => i && id && String(i.productId ?? '').trim() === id)) return true;
    }catch(_){ }
    try{
      const reps = await getAll('reempaques');
      if ((reps || []).some(r => {
        if (!r) return false;
        const vals = [r.sourceProductId, r.productoOrigenId, r.targetProductId, r.productoDestinoId, r.productId, r.productoId];
        if (id && vals.some(v => String(v ?? '').trim() === id)) return true;
        const names = [r.sourceProductName, r.productoOrigenNombre, r.productoOrigen, r.targetProductName, r.productoDestinoNombre, r.productoDestino];
        return nk && names.some(v => normKey(v) === nk);
      })) return true;
    }catch(_){ }
    return false;
  }

  async function renderProducts(){
    try{
      const all = await getAll('products');
      const list = (all || []).slice().sort(sortProducts);
      const activeCanonical = canonicalProductsForSale((all || []).filter(p => p && p.active !== false));
      const wrap = byId('cat-products-list');
      if (!wrap) return;
      wrap.innerHTML = '';
      if (!list.length){
        setStatus('No hay productos. Usa “Restaurar base A33” para crear los productos iniciales.', 'warn');
        return;
      }
      setStatus(`${list.length} producto(s) en catálogo · ${activeCanonical.length} producto(s) activos para venta POS.`, 'ok');

      const canonicalIds = new Set(activeCanonical.map(p => Number(p.id)));
      for (const p of list){
        const active = p.active !== false;
        const isCanon = active && canonicalIds.has(Number(p.id));
        const cap = getCapacity(p);
        const cost = getUnitCost(p);
        const card = document.createElement('div');
        card.className = 'cat-product-card' + (active ? '' : ' is-inactive') + (isCanon ? ' is-canonical' : '');
        card.innerHTML = `
          <div class="cat-product-main">
            <div class="cat-product-title-row">
              <strong>${escapeHtml(p.name || 'Producto sin nombre')}</strong>
              <span class="cat-pill ${active ? 'ok' : 'muted'}">${active ? 'Activo' : 'Inactivo'}</span>
              ${isCanon ? '<span class="cat-pill gold">POS</span>' : ''}
            </div>
            <div class="cat-product-meta">
              <div><small>Precio</small><b>${escapeHtml(displayMoney(p.price))}</b></div>
              <div><small>ml/unidad</small><b>${escapeHtml(displayMl(cap))}</b></div>
              <div><small>Costo ref.</small><b>${escapeHtml(displayMoney(cost))}</b></div>
              <div><small>Inventario</small><b>${p.manageStock === false ? 'No' : 'Sí'}</b></div>
            </div>
          </div>
          <div class="cat-product-actions">
            <button class="cat-btn cat-btn-ok cat-edit-product" data-id="${escapeHtml(String(p.id))}" type="button">Editar</button>
            <button class="cat-btn ${active ? 'cat-btn-warn' : 'cat-btn-secondary'} cat-toggle-product" data-id="${escapeHtml(String(p.id))}" type="button">${active ? 'Inactivar' : 'Activar'}</button>
          </div>
        `;
        wrap.appendChild(card);
      }
    }catch(err){
      console.error(err);
      setStatus('No se pudieron cargar los productos. Revisa que no haya otra pestaña bloqueando la base local.', 'warn');
    }
  }

  function readProductForm(prefix){
    const name = String(byId(prefix + '-name')?.value || '').trim();
    const priceRaw = String(byId(prefix + '-price')?.value || '').trim();
    const capRaw = String(byId(prefix + '-capacity')?.value || '').trim();
    const costRaw = String(byId(prefix + '-unit-cost')?.value || '').trim();
    const active = !!byId(prefix + '-active')?.checked;
    const manage = !!byId(prefix + '-manage')?.checked;
    if (!name) return { ok:false, msg:'Nombre obligatorio.' };
    const price = Number(priceRaw);
    if (!priceRaw || !Number.isFinite(price) || price < 0) return { ok:false, msg:'Precio de venta inválido.' };
    let capacity = 0;
    if (capRaw){
      capacity = Number(capRaw);
      if (!Number.isFinite(capacity) || capacity <= 0) return { ok:false, msg:'ml por unidad debe ser mayor que 0.' };
    }
    let unitCost = 0;
    if (costRaw){
      unitCost = Number(costRaw);
      if (!Number.isFinite(unitCost) || unitCost < 0) return { ok:false, msg:'Costo unitario inválido.' };
    }
    return { ok:true, name, price:round2(price), capacity: capRaw ? qty(capacity) : 0, unitCost:round2(unitCost), active, manage };
  }

  async function ensureNoDuplicateName(name, currentId){
    const all = await getAll('products');
    const newKey = normKey(name);
    const newGroup = mapProductNameToFinishedId(name);
    const isNew = !currentId;
    const dup = (all || []).find(p => {
      if (!p) return false;
      if (currentId && Number(p.id) === Number(currentId)) return false;
      if (normKey(p.name || '') === newKey) return true;
      const g = mapProductNameToFinishedId(p.name || '');
      // Producto nuevo: no crear otro Pulso/Media/Djeba/Litro/Galón aunque el viejo esté inactivo.
      // Edición: permitir convivir con duplicados legacy inactivos; bloquear si el duplicado equivalente está activo.
      if (newGroup && g && newGroup === g) return isNew ? true : (p.active !== false);
      return false;
    });
    return dup || null;
  }

  async function addProduct(){
    const data = readProductForm('cat-new');
    if (!data.ok){ alert(data.msg); return; }
    const dup = await ensureNoDuplicateName(data.name, null);
    if (dup){ alert('Ya existe un producto equivalente. Edita o activa el existente para evitar duplicados.'); return; }
    const now = new Date().toISOString();
    const product = {
      name:data.name,
      price:data.price,
      active:data.active,
      manageStock:data.manage,
      capacityMl:data.capacity,
      capacidadMl:data.capacity,
      volumeMl:data.capacity,
      volumenMl:data.capacity,
      unitCost:data.unitCost,
      costoUnitario:data.unitCost,
      costPerUnit:data.unitCost,
      createdAt:now,
      updatedAt:now,
      updatedFrom:'catalogos_productos'
    };
    try{
      await put('products', product);
      ['name','price','capacity','unit-cost'].forEach(k => { const el = byId('cat-new-' + k); if (el) el.value = ''; });
      const active = byId('cat-new-active'); if (active) active.checked = true;
      const manage = byId('cat-new-manage'); if (manage) manage.checked = true;
      await renderProducts();
      toast('Producto agregado');
    }catch(err){
      console.error(err);
      alert('No se pudo agregar el producto. Revisa si el nombre ya existe.');
    }
  }

  function closeProductModal(){
    const modal = byId('cat-product-modal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden','true');
    currentEditId = null;
    setEditMsg('');
  }

  async function openProductModal(id){
    const all = await getAll('products');
    const product = (all || []).find(p => Number(p && p.id) === Number(id));
    if (!product){ toast('Producto no encontrado'); return; }
    currentEditId = Number(product.id);
    const current = byId('cat-product-current');
    if (current) current.textContent = 'Producto actual: ' + (product.name || '—');
    const fields = {
      'cat-edit-name': product.name || '',
      'cat-edit-price': String(round2(product.price)),
      'cat-edit-capacity': getCapacity(product) > 0 ? String(getCapacity(product)) : '',
      'cat-edit-unit-cost': getUnitCost(product) > 0 ? String(getUnitCost(product)) : ''
    };
    Object.keys(fields).forEach(id => { const el = byId(id); if (el) el.value = fields[id]; });
    const active = byId('cat-edit-active'); if (active) active.checked = product.active !== false;
    const manage = byId('cat-edit-manage'); if (manage) manage.checked = product.manageStock !== false;
    const note = byId('cat-product-history-note');
    if (note){
      note.hidden = true;
      productHasMovements(product).then(has => { note.hidden = !has; }).catch(()=>{});
    }
    setEditMsg('');
    const modal = byId('cat-product-modal');
    if (modal){
      modal.classList.add('show');
      modal.setAttribute('aria-hidden','false');
    }
    setTimeout(()=>{ try{ byId('cat-edit-name')?.focus({ preventScroll:true }); byId('cat-edit-name')?.select(); }catch(_){ } }, 60);
  }

  async function saveProduct(){
    if (!currentEditId){ setEditMsg('Producto inválido.', 'warn'); return; }
    const all = await getAll('products');
    const product = (all || []).find(p => Number(p && p.id) === Number(currentEditId));
    if (!product){ setEditMsg('El producto ya no existe.', 'warn'); return; }
    const data = readProductForm('cat-edit');
    if (!data.ok){ setEditMsg(data.msg, 'warn'); return; }
    const dup = await ensureNoDuplicateName(data.name, currentEditId);
    if (dup){ setEditMsg('Ya existe un producto equivalente. No se duplicó nada.', 'warn'); return; }
    product.name = data.name;
    product.price = data.price;
    product.active = data.active;
    product.manageStock = data.manage;
    product.capacityMl = data.capacity;
    product.capacidadMl = data.capacity;
    product.volumeMl = data.capacity;
    product.volumenMl = data.capacity;
    product.unitCost = data.unitCost;
    product.costoUnitario = data.unitCost;
    product.costPerUnit = data.unitCost;
    product.updatedAt = new Date().toISOString();
    product.updatedFrom = 'catalogos_productos';
    try{
      await put('products', product);
      closeProductModal();
      await normalizeLegacyGallon();
      await renderProducts();
      toast('Producto guardado');
    }catch(err){
      console.error(err);
      setEditMsg('No se pudo guardar. Revisa si el nombre ya existe.', 'warn');
    }
  }

  async function toggleProduct(id){
    const all = await getAll('products');
    const product = (all || []).find(p => Number(p && p.id) === Number(id));
    if (!product) return;
    product.active = product.active === false;
    product.updatedAt = new Date().toISOString();
    product.updatedFrom = 'catalogos_productos_toggle';
    await put('products', product);
    await renderProducts();
    toast(product.active === false ? 'Producto inactivado' : 'Producto activado');
  }

  function setStatusById(id, message, kind){
    const el = byId(id);
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-status' + (kind ? (' ' + kind) : '');
  }

  function sanitizeEventExtrasForMasters(raw){
    const arr = Array.isArray(raw) ? raw : [];
    const clean = [];
    for (const x of arr){
      if (!x) continue;
      const name = String(x.name || '').trim();
      if (!name) continue;
      const unitPrice = Number(x.unitPrice ?? x.price ?? x.basePrice ?? 0);
      const unitCost = Number(x.unitCost ?? x.costoUnitario ?? 0);
      const lowStockAlert = Number(x.lowStockAlert ?? 5);
      clean.push({
        name,
        basePrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? round2(unitPrice) : 0,
        unitCost: Number.isFinite(unitCost) && unitCost >= 0 ? round2(unitCost) : 0,
        lowStockAlert: Number.isFinite(lowStockAlert) && lowStockAlert > 0 ? Math.round(lowStockAlert) : 5,
        active: x.active === false ? false : true,
        source: 'pos_event_extra'
      });
    }
    return clean;
  }

  async function seedExtrasFromEventSnapshots(){
    const existing = await getAll('extras');
    const keys = new Set((existing || []).map(x => normKey(x && x.name)).filter(Boolean));
    const events = await getAll('events');
    const now = new Date().toISOString();
    let created = 0;
    for (const ev of (events || [])){
      const extras = sanitizeEventExtrasForMasters(ev && ev.extras);
      for (const x of extras){
        const key = normKey(x.name);
        if (!key || keys.has(key)) continue;
        await put('extras', {
          name:x.name,
          basePrice:x.basePrice,
          price:x.basePrice,
          unitPrice:x.basePrice,
          unitCost:x.unitCost,
          costoUnitario:x.unitCost,
          lowStockAlert:x.lowStockAlert,
          active:true,
          source:'migrado_desde_extra_evento',
          createdAt:now,
          updatedAt:now,
          updatedFrom:'catalogos_extras_seed'
        });
        keys.add(key);
        created += 1;
      }
    }
    return created;
  }

  async function ensureNoDuplicateExtraName(name, currentId){
    const all = await getAll('extras');
    const key = normKey(name);
    return (all || []).find(x => x && (!currentId || Number(x.id) !== Number(currentId)) && normKey(x.name || '') === key) || null;
  }

  function readExtraForm(){
    const name = String(byId('cat-extra-name')?.value || '').trim();
    const priceRaw = String(byId('cat-extra-price')?.value || '').trim();
    const costRaw = String(byId('cat-extra-cost')?.value || '').trim();
    const lowRaw = String(byId('cat-extra-low')?.value || '').trim();
    const active = !!byId('cat-extra-active')?.checked;
    if (!name) return { ok:false, msg:'Nombre obligatorio.' };
    const price = Number(priceRaw);
    if (!priceRaw || !Number.isFinite(price) || price < 0) return { ok:false, msg:'Precio base inválido.' };
    let unitCost = 0;
    if (costRaw){
      unitCost = Number(costRaw);
      if (!Number.isFinite(unitCost) || unitCost < 0) return { ok:false, msg:'Costo unitario inválido.' };
    }
    let lowStockAlert = 5;
    if (lowRaw){
      lowStockAlert = Number(lowRaw);
      if (!Number.isFinite(lowStockAlert) || lowStockAlert < 0) return { ok:false, msg:'Alerta de stock bajo inválida.' };
    }
    return { ok:true, name, basePrice:round2(price), unitCost:round2(unitCost), lowStockAlert:Math.max(0, Math.round(lowStockAlert)), active };
  }

  function resetExtraForm(){
    currentExtraEditId = null;
    ['cat-extra-name','cat-extra-price','cat-extra-cost','cat-extra-low'].forEach(id => { const el = byId(id); if (el) el.value = ''; });
    const active = byId('cat-extra-active'); if (active) active.checked = true;
    const save = byId('cat-save-extra'); if (save) save.textContent = '+ Agregar extra';
    const cancel = byId('cat-cancel-extra'); if (cancel) cancel.hidden = true;
  }

  async function renderExtras(){
    try{
      const list = (await getAll('extras')).slice().sort(sortMasterByActiveName);
      const wrap = byId('cat-extras-list');
      if (!wrap) return;
      wrap.innerHTML = '';
      if (!list.length){
        setStatusById('cat-extras-status', 'No hay extras maestros. Puedes crear uno o abrir POS para importar extras existentes por evento.', 'warn');
        return;
      }
      const activeCount = list.filter(x => activeBool(x && x.active)).length;
      setStatusById('cat-extras-status', `${list.length} extra(s) maestro(s) · ${activeCount} activo(s).`, 'ok');
      for (const x of list){
        const active = activeBool(x && x.active);
        const card = document.createElement('div');
        card.className = 'cat-product-card' + (active ? '' : ' is-inactive');
        card.innerHTML = `
          <div class="cat-product-main">
            <div class="cat-product-title-row">
              <strong>${escapeHtml(x.name || 'Extra sin nombre')}</strong>
              <span class="cat-pill ${active ? 'ok' : 'muted'}">${active ? 'Activo' : 'Inactivo'}</span>
              <span class="cat-pill gold">Maestro</span>
            </div>
            <div class="cat-product-meta">
              <div><small>Precio base</small><b>${escapeHtml(displayMoney(getExtraPrice(x)))}</b></div>
              <div><small>Costo ref.</small><b>${escapeHtml(displayMoney(getExtraUnitCost(x)))}</b></div>
              <div><small>Stock bajo ref.</small><b>${escapeHtml(String(x.lowStockAlert ?? 5))}</b></div>
              <div><small>Histórico</small><b>No recalcula</b></div>
            </div>
          </div>
          <div class="cat-product-actions">
            <button class="cat-btn cat-btn-ok cat-edit-extra" data-id="${escapeHtml(String(x.id))}" type="button">Editar</button>
            <button class="cat-btn ${active ? 'cat-btn-warn' : 'cat-btn-secondary'} cat-toggle-extra" data-id="${escapeHtml(String(x.id))}" type="button">${active ? 'Inactivar' : 'Activar'}</button>
          </div>
        `;
        wrap.appendChild(card);
      }
    }catch(err){
      console.error(err);
      setStatusById('cat-extras-status', 'No se pudieron cargar los extras maestros.', 'warn');
    }
  }

  async function saveExtraMaster(){
    const data = readExtraForm();
    if (!data.ok){ alert(data.msg); return; }
    const wasEdit = !!currentExtraEditId;
    const dup = await ensureNoDuplicateExtraName(data.name, currentExtraEditId);
    if (dup){ alert('Ya existe un extra con ese nombre. Edita o activa el existente para evitar duplicados.'); return; }
    const now = new Date().toISOString();
    let row = null;
    if (currentExtraEditId){
      const all = await getAll('extras');
      row = (all || []).find(x => Number(x && x.id) === Number(currentExtraEditId));
      if (!row){ alert('El extra ya no existe.'); resetExtraForm(); await renderExtras(); return; }
    } else {
      row = { createdAt:now };
    }
    row.name = data.name;
    row.basePrice = data.basePrice;
    row.price = data.basePrice;
    row.unitPrice = data.basePrice;
    row.unitCost = data.unitCost;
    row.costoUnitario = data.unitCost;
    row.lowStockAlert = data.lowStockAlert || 5;
    row.active = data.active;
    row.updatedAt = now;
    row.updatedFrom = 'catalogos_extras';
    await put('extras', row);
    resetExtraForm();
    await renderExtras();
    toast(wasEdit ? 'Extra guardado' : 'Extra agregado');
  }

  async function editExtraMaster(id){
    const all = await getAll('extras');
    const x = (all || []).find(e => Number(e && e.id) === Number(id));
    if (!x){ toast('Extra no encontrado'); return; }
    currentExtraEditId = Number(x.id);
    const name = byId('cat-extra-name'); if (name) name.value = x.name || '';
    const price = byId('cat-extra-price'); if (price) price.value = String(getExtraPrice(x));
    const cost = byId('cat-extra-cost'); if (cost) cost.value = getExtraUnitCost(x) > 0 ? String(getExtraUnitCost(x)) : '';
    const low = byId('cat-extra-low'); if (low) low.value = String(x.lowStockAlert ?? 5);
    const active = byId('cat-extra-active'); if (active) active.checked = activeBool(x.active);
    const save = byId('cat-save-extra'); if (save) save.textContent = 'Guardar cambios';
    const cancel = byId('cat-cancel-extra'); if (cancel) cancel.hidden = false;
    try{ name?.focus({ preventScroll:true }); name?.select(); }catch(_){ }
  }

  async function toggleExtraMaster(id){
    const all = await getAll('extras');
    const x = (all || []).find(e => Number(e && e.id) === Number(id));
    if (!x) return;
    x.active = !activeBool(x.active);
    x.updatedAt = new Date().toISOString();
    x.updatedFrom = 'catalogos_extras_toggle';
    await put('extras', x);
    await renderExtras();
    toast(x.active === false ? 'Extra inactivado' : 'Extra activado');
  }

  async function ensureBanksDefaultsCatalog(){
    const banks = await getAll('banks');
    if ((banks || []).length) return;
    const now = new Date().toISOString();
    for (const name of ['BAC','BANPRO','LAFISE','BDF']){
      await put('banks', { name, isActive:true, active:true, type:'transferencia', currency:'NIO', accountReference:'', commissionPct:0, createdAt:now, updatedAt:now, updatedFrom:'catalogos_bancos_seed' });
    }
  }

  async function ensureNoDuplicateBank(name, type, currentId){
    const all = await getAll('banks');
    const key = normBankName(name);
    const t = normalizeBankType(type);
    return (all || []).find(b => b && (!currentId || Number(b.id) !== Number(currentId)) && normBankName(b.name || '') === key && normalizeBankType(b.type || b.bankType) === t) || null;
  }

  function readBankForm(){
    const name = String(byId('cat-bank-name')?.value || '').trim();
    const type = normalizeBankType(byId('cat-bank-type')?.value || 'transferencia');
    const currency = normalizeBankCurrency(byId('cat-bank-currency')?.value || 'NIO');
    const accountReference = String(byId('cat-bank-ref')?.value || '').trim();
    const commissionRaw = String(byId('cat-bank-commission')?.value || '').trim();
    const active = !!byId('cat-bank-active')?.checked;
    if (!name) return { ok:false, msg:'Nombre del banco obligatorio.' };
    let commissionPct = 0;
    if (commissionRaw){
      commissionPct = Number(commissionRaw);
      if (!Number.isFinite(commissionPct) || commissionPct < 0) return { ok:false, msg:'Comisión inválida.' };
    }
    if (type !== 'tarjeta') commissionPct = 0;
    return { ok:true, name, type, currency, accountReference, commissionPct:round2(commissionPct), active };
  }

  function resetBankForm(){
    currentBankEditId = null;
    ['cat-bank-name','cat-bank-ref','cat-bank-commission'].forEach(id => { const el = byId(id); if (el) el.value = ''; });
    const type = byId('cat-bank-type'); if (type) type.value = 'transferencia';
    const cur = byId('cat-bank-currency'); if (cur) cur.value = 'NIO';
    const active = byId('cat-bank-active'); if (active) active.checked = true;
    const save = byId('cat-save-bank'); if (save) save.textContent = '+ Agregar banco';
    const cancel = byId('cat-cancel-bank'); if (cancel) cancel.hidden = true;
  }

  async function renderBanks(){
    try{
      const banks = (await getAll('banks')).slice().sort(sortBanks);
      const wrap = byId('cat-banks-list');
      if (!wrap) return;
      wrap.innerHTML = '';
      if (!banks.length){
        setStatusById('cat-banks-status', 'No hay bancos maestros. Puedes crear uno o restaurar la base inicial.', 'warn');
        return;
      }
      const activeCount = banks.filter(bankActive).length;
      setStatusById('cat-banks-status', `${banks.length} banco(s) maestro(s) · ${activeCount} activo(s).`, 'ok');
      for (const b of banks){
        const active = bankActive(b);
        const type = normalizeBankType(b && (b.type || b.bankType));
        const commission = type === 'tarjeta' ? round2(b.commissionPct ?? b.commission ?? b.feePct ?? 0) : 0;
        const card = document.createElement('div');
        card.className = 'cat-product-card' + (active ? '' : ' is-inactive');
        card.innerHTML = `
          <div class="cat-product-main">
            <div class="cat-product-title-row">
              <strong>${escapeHtml(b.name || 'Banco sin nombre')}</strong>
              <span class="cat-pill ${active ? 'ok' : 'muted'}">${active ? 'Activo' : 'Inactivo'}</span>
              <span class="cat-pill gold">${escapeHtml(bankTypeLabel(type))}</span>
            </div>
            <div class="cat-product-meta">
              <div><small>Moneda</small><b>${escapeHtml(bankCurrencyLabel(b.currency))}</b></div>
              <div><small>Cuenta/ref.</small><b>${escapeHtml(b.accountReference || b.reference || '—')}</b></div>
              <div><small>Comisión</small><b>${escapeHtml(type === 'tarjeta' ? (fmt(commission) + '%') : '—')}</b></div>
              <div><small>Uso</small><b>${escapeHtml(bankTypeLabel(type))}</b></div>
            </div>
          </div>
          <div class="cat-product-actions">
            <button class="cat-btn cat-btn-ok cat-edit-bank" data-id="${escapeHtml(String(b.id))}" type="button">Editar</button>
            <button class="cat-btn ${active ? 'cat-btn-warn' : 'cat-btn-secondary'} cat-toggle-bank" data-id="${escapeHtml(String(b.id))}" type="button">${active ? 'Inactivar' : 'Activar'}</button>
          </div>
        `;
        wrap.appendChild(card);
      }
    }catch(err){
      console.error(err);
      setStatusById('cat-banks-status', 'No se pudieron cargar los bancos maestros.', 'warn');
    }
  }

  async function saveBankMaster(){
    const data = readBankForm();
    if (!data.ok){ alert(data.msg); return; }
    const wasEdit = !!currentBankEditId;
    const dup = await ensureNoDuplicateBank(data.name, data.type, currentBankEditId);
    if (dup){ alert('Ya existe un banco con ese nombre y tipo. Edita o activa el existente.'); return; }
    const now = new Date().toISOString();
    let row = null;
    if (currentBankEditId){
      const all = await getAll('banks');
      row = (all || []).find(b => Number(b && b.id) === Number(currentBankEditId));
      if (!row){ alert('El banco ya no existe.'); resetBankForm(); await renderBanks(); return; }
    } else {
      row = { createdAt:now };
    }
    row.name = data.name;
    row.type = data.type;
    row.bankType = data.type;
    row.paymentType = data.type;
    row.currency = data.currency;
    row.accountReference = data.accountReference;
    row.reference = data.accountReference;
    row.commissionPct = data.commissionPct;
    row.isActive = data.active;
    row.active = data.active;
    row.updatedAt = now;
    row.updatedFrom = 'catalogos_bancos';
    await put('banks', row);
    resetBankForm();
    await renderBanks();
    toast(wasEdit ? 'Banco guardado' : 'Banco agregado');
  }

  async function editBankMaster(id){
    const all = await getAll('banks');
    const b = (all || []).find(x => Number(x && x.id) === Number(id));
    if (!b){ toast('Banco no encontrado'); return; }
    currentBankEditId = Number(b.id);
    const name = byId('cat-bank-name'); if (name) name.value = b.name || '';
    const type = byId('cat-bank-type'); if (type) type.value = normalizeBankType(b.type || b.bankType);
    const cur = byId('cat-bank-currency'); if (cur) cur.value = normalizeBankCurrency(b.currency);
    const ref = byId('cat-bank-ref'); if (ref) ref.value = b.accountReference || b.reference || '';
    const commission = byId('cat-bank-commission'); if (commission) commission.value = String(round2(b.commissionPct ?? b.commission ?? b.feePct ?? 0));
    const active = byId('cat-bank-active'); if (active) active.checked = bankActive(b);
    const save = byId('cat-save-bank'); if (save) save.textContent = 'Guardar cambios';
    const cancel = byId('cat-cancel-bank'); if (cancel) cancel.hidden = false;
    try{ name?.focus({ preventScroll:true }); name?.select(); }catch(_){ }
  }

  async function toggleBankMaster(id){
    const all = await getAll('banks');
    const b = (all || []).find(x => Number(x && x.id) === Number(id));
    if (!b) return;
    const next = !bankActive(b);
    b.isActive = next;
    b.active = next;
    b.updatedAt = new Date().toISOString();
    b.updatedFrom = 'catalogos_bancos_toggle';
    await put('banks', b);
    await renderBanks();
    toast(next ? 'Banco activado' : 'Banco inactivado');
  }


  // --- Etapa 1/3 — Clientes maestros dentro de Catálogos (misma fuente local de Catálogos/POS)
  function sanitizeCustomerName(value){
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeCustomerKeyCAT(value){
    let s = String(value || '');
    try{ if (s.normalize) s = s.normalize('NFD'); }catch(_){ }
    return s.replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  }

  function hash36CAT(value){
    let h = 2166136261;
    const s = String(value || '');
    for (let i = 0; i < s.length; i++){
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }

  function readJSONLocalCAT(key, fallback){
    try{
      if (window.A33Storage && typeof A33Storage.getJSON === 'function') return A33Storage.getJSON(key, fallback, 'local');
    }catch(_){ }
    try{
      const raw = window.localStorage ? localStorage.getItem(key) : null;
      if (raw == null) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    }catch(_){ return fallback; }
  }

  function writeJSONLocalCAT(key, value){
    try{
      if (window.A33Storage && typeof A33Storage.setJSON === 'function') return !!A33Storage.setJSON(key, value, 'local');
    }catch(_){ }
    try{
      if (!window.localStorage) return false;
      localStorage.setItem(key, JSON.stringify(value == null ? null : value));
      return true;
    }catch(_){ return false; }
  }

  function readCustomerDisabledSetCAT(){
    const raw = readJSONLocalCAT(CUSTOMER_DISABLED_KEY, []);
    const set = new Set();
    if (Array.isArray(raw)){
      raw.forEach(v => { const k = normalizeCustomerKeyCAT(v); if (k) set.add(k); });
    } else if (raw && typeof raw === 'object'){
      Object.keys(raw).forEach(k => { if (raw[k]){ const kk = normalizeCustomerKeyCAT(k); if (kk) set.add(kk); } });
    }
    return set;
  }

  function syncCustomerDisabledLegacyCAT(list){
    const arr = [];
    for (const c of (Array.isArray(list) ? list : [])){
      const nk = normalizeCustomerKeyCAT(c && (c.normalizedName || c.name));
      if (nk && customerActiveCAT(c) === false) arr.push(nk);
    }
    writeJSONLocalCAT(CUSTOMER_DISABLED_KEY, Array.from(new Set(arr)).sort());
  }

  function nextCustomerIdCAT(existingIds, normalizedName){
    const used = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
    const base = 'c_' + hash36CAT(normalizedName || Date.now());
    if (!used.has(base)) return base;
    for (let i = 1; i < 9999; i++){
      const id = base + '_' + i;
      if (!used.has(id)) return id;
    }
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function toMsCAT(value, fallback){
    if (value == null || value === '') return fallback;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
    const t = Date.parse(String(value));
    if (Number.isFinite(t)) return t;
    return fallback;
  }

  function customerActiveCAT(c){
    if (!c) return true;
    if (typeof c.isActive === 'boolean') return c.isActive;
    if (typeof c.active === 'boolean') return c.active;
    return true;
  }

  function getCustomerCellularCAT(c){
    if (!c) return '';
    return sanitizeCustomerName(c.celular || c.cellular || c.mobile || c.movil || c.whatsapp || c.wa || c.whatsApp || c.telefono || c.phone || c.telefonoCliente || '');
  }

  function normalizeCustomerObjectCAT(raw, disabledSet, existingIds){
    const now = Date.now();
    if (typeof raw === 'string'){
      const name = sanitizeCustomerName(raw);
      const normalizedName = normalizeCustomerKeyCAT(name);
      if (!name || !normalizedName) return null;
      const id = nextCustomerIdCAT(existingIds, normalizedName);
      existingIds.add(String(id));
      const isActive = !disabledSet.has(normalizedName);
      return {
        id:String(id),
        name,
        nombre:name,
        celular:'',
        telefono:'',
        whatsapp:'',
        correo:'',
        direccion:'',
        notas:'',
        isActive,
        active:isActive,
        createdAt:now,
        updatedAt:null,
        normalizedName,
        schemaVersion:CUSTOMER_SCHEMA_VERSION,
        aliases:[],
        nameHistory:[],
        mergedIntoId:null,
        mergedAt:null,
        mergeReason:'',
        mergeHistory:[],
        updatedFrom:'catalogos_clientes_migration'
      };
    }

    if (!raw || typeof raw !== 'object') return null;
    const name = sanitizeCustomerName(raw.name || raw.nombre || raw.customerName || raw.customer || '');
    const normalizedName = normalizeCustomerKeyCAT(raw.normalizedName || name);
    if (!name || !normalizedName) return null;

    let id = raw.id != null && String(raw.id).trim() ? String(raw.id).trim() : nextCustomerIdCAT(existingIds, normalizedName);
    if (existingIds.has(String(id))) id = nextCustomerIdCAT(existingIds, normalizedName);
    existingIds.add(String(id));

    let isActive;
    if (typeof raw.isActive === 'boolean') isActive = raw.isActive;
    else if (typeof raw.active === 'boolean') isActive = raw.active;
    else isActive = !disabledSet.has(normalizedName);

    const obj = { ...raw };
    obj.id = String(id);
    obj.name = name;
    obj.nombre = sanitizeCustomerName(raw.nombre || name);
    obj.celular = getCustomerCellularCAT(raw);
    obj.telefono = obj.celular;
    obj.whatsapp = ''; // Compat legacy: la UI ya no separa WhatsApp de Teléfono.
    obj.correo = sanitizeCustomerName(raw.correo || raw.email || raw.mail || '');
    obj.direccion = sanitizeCustomerName(raw.direccion || raw.address || '');
    obj.notas = String(raw.notas || raw.notes || '').trim();
    obj.isActive = !!isActive;
    obj.active = !!isActive;
    obj.createdAt = toMsCAT(raw.createdAt, now);
    obj.updatedAt = toMsCAT(raw.updatedAt, null);
    obj.normalizedName = normalizedName;
    obj.schemaVersion = Number(raw.schemaVersion) > 0 ? Number(raw.schemaVersion) : CUSTOMER_SCHEMA_VERSION;
    obj.aliases = Array.isArray(raw.aliases) ? raw.aliases.map(sanitizeCustomerName).filter(Boolean) : [];
    obj.nameHistory = Array.isArray(raw.nameHistory) ? raw.nameHistory : [];
    obj.mergedIntoId = (raw.mergedIntoId != null && String(raw.mergedIntoId).trim()) ? String(raw.mergedIntoId).trim() : null;
    obj.mergedAt = toMsCAT(raw.mergedAt, null);
    obj.mergeReason = sanitizeCustomerName(raw.mergeReason || '');
    obj.mergeHistory = Array.isArray(raw.mergeHistory) ? raw.mergeHistory : [];
    return obj;
  }

  function sortCustomersCAT(list){
    return (Array.isArray(list) ? list : []).slice().sort((a,b)=>{
      const aa = customerActiveCAT(a) ? 0 : 1;
      const bb = customerActiveCAT(b) ? 0 : 1;
      if (aa !== bb) return aa - bb;
      return normalizeCustomerKeyCAT(a && a.name).localeCompare(normalizeCustomerKeyCAT(b && b.name), 'es-NI', { sensitivity:'base' });
    });
  }

  function normalizeCustomersCatalogCAT(raw){
    const disabled = readCustomerDisabledSetCAT();
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    const existingIds = new Set();
    for (const item of arr){
      const obj = normalizeCustomerObjectCAT(item, disabled, existingIds);
      if (!obj) continue;
      out.push(obj);
    }
    return sortCustomersCAT(out);
  }

  function readCustomerCatalogCAT(){
    let raw = [];
    try{
      if (window.A33Storage && typeof A33Storage.sharedGet === 'function') raw = A33Storage.sharedGet(CUSTOMER_CATALOG_KEY, [], 'local');
      else raw = readJSONLocalCAT(CUSTOMER_CATALOG_KEY, []);
    }catch(_){ raw = readJSONLocalCAT(CUSTOMER_CATALOG_KEY, []); }
    return normalizeCustomersCatalogCAT(raw);
  }

  function mergeCustomersByIdCAT(current, next){
    const map = new Map();
    const order = [];
    const add = (item)=>{
      if (!item || item.id == null) return;
      const id = String(item.id).trim();
      if (!id) return;
      if (!map.has(id)) order.push(id);
      map.set(id, item);
    };
    (Array.isArray(current) ? current : []).forEach(add);
    (Array.isArray(next) ? next : []).forEach(add);
    return sortCustomersCAT(order.map(id => map.get(id)).filter(Boolean));
  }

  function saveCustomerCatalogCAT(list){
    const safe = normalizeCustomersCatalogCAT(Array.isArray(list) ? list : []);
    let ok = false;
    try{
      if (window.A33Storage && typeof A33Storage.sharedRead === 'function' && typeof A33Storage.sharedSet === 'function'){
        const r0 = A33Storage.sharedRead(CUSTOMER_CATALOG_KEY, [], 'local');
        const cur = normalizeCustomersCatalogCAT(r0 && Array.isArray(r0.data) ? r0.data : []);
        const baseRev = (r0 && r0.meta && typeof r0.meta.rev === 'number') ? r0.meta.rev : null;
        const merged = mergeCustomersByIdCAT(cur, safe);
        const r = A33Storage.sharedSet(CUSTOMER_CATALOG_KEY, merged, { source:'catalogos_clientes', baseRev });
        ok = !!(r && r.ok);
      } else if (window.A33Storage && typeof A33Storage.sharedSet === 'function'){
        const r = A33Storage.sharedSet(CUSTOMER_CATALOG_KEY, safe, { source:'catalogos_clientes' });
        ok = !!(r && r.ok);
      } else {
        ok = writeJSONLocalCAT(CUSTOMER_CATALOG_KEY, safe);
      }
    }catch(_){ ok = writeJSONLocalCAT(CUSTOMER_CATALOG_KEY, safe); }
    if (ok) syncCustomerDisabledLegacyCAT(safe);
    return ok;
  }

  function customerSearchTextCAT(c){
    if (!c) return '';
    const parts = [c.name, c.nombre, getCustomerCellularCAT(c), c.correo, c.direccion, c.notas];
    if (Array.isArray(c.aliases)) parts.push(...c.aliases);
    return normalizeCustomerKeyCAT(parts.filter(Boolean).join(' '));
  }

  function getCustomerCountsCAT(list){
    const arr = Array.isArray(list) ? list : [];
    const active = arr.filter(c => customerActiveCAT(c)).length;
    return { total:arr.length, active, inactive:arr.length - active };
  }

  function setCustomerMsgCAT(message, kind){
    const el = byId('cat-customer-msg');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-muted cat-edit-msg' + (kind ? (' ' + kind) : '');
  }

  function resetCustomerFormCAT(){
    currentCustomerEditId = null;
    ['cat-customer-name','cat-customer-cell','cat-customer-email','cat-customer-address','cat-customer-notes'].forEach(id => {
      const el = byId(id);
      if (el) el.value = '';
    });
    const active = byId('cat-customer-active'); if (active) active.checked = true;
    const save = byId('cat-save-customer'); if (save) save.textContent = '+ Agregar cliente';
    setCustomerMsgCAT('');
  }

  function fillCustomerFormCAT(customer){
    if (!customer) return;
    currentCustomerEditId = String(customer.id || '');
    const fields = {
      'cat-edit-customer-name': customer.name || '',
      'cat-edit-customer-cell': getCustomerCellularCAT(customer),
      'cat-edit-customer-email': customer.correo || customer.email || '',
      'cat-edit-customer-address': customer.direccion || customer.address || '',
      'cat-edit-customer-notes': customer.notas || customer.notes || ''
    };
    Object.keys(fields).forEach(id => { const el = byId(id); if (el) el.value = fields[id]; });
    const active = byId('cat-edit-customer-active'); if (active) active.checked = customerActiveCAT(customer);
    const current = byId('cat-customer-current'); if (current) current.textContent = 'Cliente actual: ' + (customer.name || '—');
    setEditCustomerMsgCAT('', '');
    openCustomerModalCAT();
    setTimeout(()=>{ try{ byId('cat-edit-customer-name')?.focus({ preventScroll:true }); byId('cat-edit-customer-name')?.select(); }catch(_){ } }, 60);
  }

  function readCustomerFieldsCAT(prefix){
    const modal = prefix === 'edit';
    const name = sanitizeCustomerName(byId(modal ? 'cat-edit-customer-name' : 'cat-customer-name')?.value || '');
    const celular = sanitizeCustomerName(byId(modal ? 'cat-edit-customer-cell' : 'cat-customer-cell')?.value || '');
    const correo = sanitizeCustomerName(byId(modal ? 'cat-edit-customer-email' : 'cat-customer-email')?.value || '');
    const direccion = sanitizeCustomerName(byId(modal ? 'cat-edit-customer-address' : 'cat-customer-address')?.value || '');
    const notas = String(byId(modal ? 'cat-edit-customer-notes' : 'cat-customer-notes')?.value || '').trim();
    const active = !!byId(modal ? 'cat-edit-customer-active' : 'cat-customer-active')?.checked;
    if (!name) return { ok:false, msg:'Nombre obligatorio.' };
    const normalizedName = normalizeCustomerKeyCAT(name);
    if (!normalizedName) return { ok:false, msg:'Nombre inválido.' };
    return { ok:true, name, celular, correo, direccion, notas, active, normalizedName };
  }

  function readCustomerFormCAT(){
    return readCustomerFieldsCAT(currentCustomerEditId ? 'edit' : 'add');
  }

  function findCustomerDuplicateCAT(list, normalizedName, currentId){
    const cid = currentId != null ? String(currentId).trim() : '';
    return (Array.isArray(list) ? list : []).find(c => {
      if (!c) return false;
      if (cid && String(c.id) === cid) return false;
      if (normalizeCustomerKeyCAT(c.name || c.nombre || '') === normalizedName) return true;
      if (Array.isArray(c.aliases) && c.aliases.some(a => normalizeCustomerKeyCAT(a) === normalizedName)) return true;
      if (Array.isArray(c.nameHistory) && c.nameHistory.some(h => h && (normalizeCustomerKeyCAT(h.from) === normalizedName || normalizeCustomerKeyCAT(h.to) === normalizedName))) return true;
      return false;
    }) || null;
  }

  async function renderCustomers(){
    try{
      let list = readCustomerCatalogCAT();
      const q = normalizeCustomerKeyCAT(byId('cat-customer-search')?.value || '');
      if (q) list = list.filter(c => customerSearchTextCAT(c).includes(q));
      const wrap = byId('cat-customers-list');
      if (!wrap) return;
      wrap.innerHTML = '';
      const all = readCustomerCatalogCAT();
      const counts = getCustomerCountsCAT(all);
      const shown = list.length;
      const status = counts.total
        ? `${counts.total} cliente(s) maestro(s) · ${counts.active} activo(s) · ${counts.inactive} inactivo(s)${q ? ' · ' + shown + ' resultado(s)' : ''}.`
        : 'No hay clientes maestros todavía. Puedes crear el primero aquí o conservar los que POS genere.';
      setStatusById('cat-customers-status', status, counts.total ? 'ok' : 'warn');
      if (!list.length){
        const empty = document.createElement('div');
        empty.className = 'cat-customer-empty';
        empty.textContent = q ? 'Sin resultados para la búsqueda.' : 'Sin clientes registrados.';
        wrap.appendChild(empty);
        return;
      }
      for (const c of list){
        const active = customerActiveCAT(c);
        const isMerged = !!(c && c.mergedIntoId);
        const card = document.createElement('div');
        card.className = 'cat-product-card' + (active ? '' : ' is-inactive');
        const celular = getCustomerCellularCAT(c) || '—';
        const email = c.correo || c.email || '—';
        const address = c.direccion || c.address || '—';
        card.innerHTML = `
          <div class="cat-product-main">
            <div class="cat-product-title-row">
              <strong>${escapeHtml(c.name || 'Cliente sin nombre')}</strong>
              <span class="cat-pill ${active ? 'ok' : 'muted'}">${active ? 'Activo' : 'Inactivo'}</span>
              <span class="cat-pill gold">Maestro</span>
              ${isMerged ? '<span class="cat-pill muted">Fusionado</span>' : ''}
            </div>
            <div class="cat-product-meta">
              <div><small>Celular</small><b>${escapeHtml(celular)}</b></div>
              <div><small>Correo</small><b>${escapeHtml(email)}</b></div>
              <div><small>Dirección</small><b>${escapeHtml(address)}</b></div>
            </div>
          </div>
          <div class="cat-product-actions">
            <button class="cat-btn cat-btn-ok cat-edit-customer" data-id="${escapeHtml(String(c.id))}" type="button" ${isMerged ? 'disabled' : ''}>Editar</button>
            <button class="cat-btn ${active ? 'cat-btn-warn' : 'cat-btn-secondary'} cat-toggle-customer" data-id="${escapeHtml(String(c.id))}" type="button" ${isMerged ? 'disabled' : ''}>${active ? 'Inactivar' : 'Activar'}</button>
          </div>
        `;
        wrap.appendChild(card);
      }
    }catch(err){
      console.error(err);
      setStatusById('cat-customers-status', 'No se pudieron cargar los clientes maestros.', 'warn');
    }
  }

  async function saveCustomerMaster(){
    const data = readCustomerFormCAT();
    if (!data.ok){ setCurrentCustomerMsgCAT(data.msg, 'warn'); return; }
    const list = readCustomerCatalogCAT();
    const duplicate = findCustomerDuplicateCAT(list, data.normalizedName, currentCustomerEditId);
    if (duplicate){ setCurrentCustomerMsgCAT('Ya existe un cliente con ese nombre. No se duplicó nada.', 'warn'); return; }

    const now = Date.now();
    let row = null;
    const isEdit = !!currentCustomerEditId;
    if (isEdit){
      row = list.find(c => c && String(c.id) === String(currentCustomerEditId));
      if (!row){ setCurrentCustomerMsgCAT('El cliente ya no existe. Actualiza e intenta de nuevo.', 'warn'); resetCustomerFormCAT(); await renderCustomers(); return; }
      if (row.mergedIntoId){ setCurrentCustomerMsgCAT('Este cliente está fusionado. Administra el destino final.', 'warn'); return; }
      const oldName = sanitizeCustomerName(row.name || '');
      if (oldName && normalizeCustomerKeyCAT(oldName) !== data.normalizedName){
        if (!Array.isArray(row.nameHistory)) row.nameHistory = [];
        row.nameHistory.push({ from:oldName, to:data.name, at:now, reason:'catalogos_clientes' });
        if (!Array.isArray(row.aliases)) row.aliases = [];
        const oldKey = normalizeCustomerKeyCAT(oldName);
        if (oldKey && !row.aliases.some(a => normalizeCustomerKeyCAT(a) === oldKey)) row.aliases.push(oldName);
      }
    } else {
      const existingIds = new Set(list.map(c => c && c.id).filter(Boolean).map(String));
      row = {
        id: nextCustomerIdCAT(existingIds, data.normalizedName),
        createdAt: now,
        aliases: [],
        nameHistory: [],
        mergedIntoId: null,
        mergedAt: null,
        mergeReason: '',
        mergeHistory: []
      };
      list.push(row);
    }

    row.name = data.name;
    row.nombre = data.name;
    row.celular = data.celular;
    row.telefono = data.celular; // Compat legacy: antes existía Teléfono.
    row.whatsapp = ''; // WhatsApp separado eliminado de la UI.
    row.correo = data.correo;
    row.direccion = data.direccion;
    row.notas = data.notas;
    row.isActive = data.active;
    row.active = data.active;
    row.updatedAt = now;
    row.normalizedName = data.normalizedName;
    row.schemaVersion = CUSTOMER_SCHEMA_VERSION;
    row.updatedFrom = 'catalogos_clientes';

    const ok = saveCustomerCatalogCAT(list);
    if (!ok){ setCurrentCustomerMsgCAT('No se pudo guardar. Revisa almacenamiento local.', 'warn'); return; }
    resetCustomerFormCAT();
    if (isEdit) closeCustomerModalCAT();
    await renderCustomers();
    toast(isEdit ? 'Cliente guardado' : 'Cliente agregado');
  }

  async function toggleCustomerMaster(id){
    const cid = id != null ? String(id).trim() : '';
    if (!cid) return;
    const list = readCustomerCatalogCAT();
    const row = list.find(c => c && String(c.id) === cid);
    if (!row){ toast('Cliente no encontrado'); return; }
    if (row.mergedIntoId){ toast('Cliente fusionado: no se modifica desde aquí.'); return; }
    const next = !customerActiveCAT(row);
    row.isActive = next;
    row.active = next;
    row.updatedAt = Date.now();
    row.updatedFrom = 'catalogos_clientes_toggle';
    const ok = saveCustomerCatalogCAT(list);
    if (!ok){ toast('No se pudo guardar'); return; }
    await renderCustomers();
    toast(next ? 'Cliente activado' : 'Cliente inactivado');
  }

  function setEditCustomerMsgCAT(message, kind){
    const el = byId('cat-edit-customer-msg');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-muted cat-edit-msg' + (kind ? (' ' + kind) : '');
  }

  function setCurrentCustomerMsgCAT(message, kind){
    if (currentCustomerEditId) setEditCustomerMsgCAT(message, kind);
    else setCustomerMsgCAT(message, kind);
  }

  function openCustomerModalCAT(){
    const modal = byId('cat-customer-modal');
    if (!modal) return;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    try{ document.body.classList.add('cat-modal-open'); }catch(_){ }
  }

  function closeCustomerModalCAT(){
    const modal = byId('cat-customer-modal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    currentCustomerEditId = null;
    setEditCustomerMsgCAT('', '');
    try{ document.body.classList.remove('cat-modal-open'); }catch(_){ }
  }

  function editCustomerMaster(id){
    const cid = id != null ? String(id).trim() : '';
    const list = readCustomerCatalogCAT();
    const row = list.find(c => c && String(c.id) === cid);
    if (!row){ toast('Cliente no encontrado'); return; }
    if (row.mergedIntoId){ toast('Cliente fusionado: edita el destino.'); return; }
    fillCustomerFormCAT(row);
  }

  function bindCustomerUi(){
    const list = byId('cat-customers-list');
    if (list){
      list.addEventListener('click', async (e)=>{
        const edit = e.target.closest('.cat-edit-customer');
        const toggle = e.target.closest('.cat-toggle-customer');
        if (edit && !edit.disabled){ editCustomerMaster(edit.dataset.id); return; }
        if (toggle && !toggle.disabled){ await toggleCustomerMaster(toggle.dataset.id); return; }
      });
    }
    byId('cat-save-customer')?.addEventListener('click', ()=>saveCustomerMaster().catch(err=>{ console.error(err); setCustomerMsgCAT('No se pudo guardar el cliente.', 'warn'); }));
    byId('cat-edit-customer-save')?.addEventListener('click', ()=>saveCustomerMaster().catch(err=>{ console.error(err); setEditCustomerMsgCAT('No se pudo guardar el cliente.', 'warn'); }));
    byId('cat-edit-customer-cancel')?.addEventListener('click', closeCustomerModalCAT);
    byId('cat-customer-close')?.addEventListener('click', closeCustomerModalCAT);
    const customerModal = byId('cat-customer-modal');
    if (customerModal){
      customerModal.addEventListener('click', (e)=>{ if (e.target === customerModal) closeCustomerModalCAT(); });
    }
    document.addEventListener('keydown', (e)=>{
      if (e && e.key === 'Escape'){
        const modal = byId('cat-customer-modal');
        if (modal && modal.classList.contains('show')) closeCustomerModalCAT();
      }
    });
    byId('cat-refresh-customers')?.addEventListener('click', async ()=>{ resetCustomerFormCAT(); await renderCustomers(); toast('Clientes actualizados'); });
    byId('cat-customer-search')?.addEventListener('input', ()=>renderCustomers().catch(err=>console.error(err)));
  }

  async function initCustomers(){
    const list = readCustomerCatalogCAT();
    // Migración local suave: si venía como strings u objetos incompletos, queda objeto estable para POS.
    saveCustomerCatalogCAT(list);
    await renderCustomers();
  }



  // --- Etapa 1/3 — Proveedores maestros dentro de Catálogos (misma fuente local de Finanzas)
  function catEnsureFinanceSchema(d, event){
    if (!d.objectStoreNames.contains('accounts')) d.createObjectStore('accounts', { keyPath:'code' });
    if (!d.objectStoreNames.contains('journalEntries')) d.createObjectStore('journalEntries', { keyPath:'id', autoIncrement:true });
    if (!d.objectStoreNames.contains('journalLines')) d.createObjectStore('journalLines', { keyPath:'id', autoIncrement:true });
    if (!d.objectStoreNames.contains('suppliers')) d.createObjectStore('suppliers', { keyPath:'id', autoIncrement:true });
    if (!d.objectStoreNames.contains('receipts')){
      const st = d.createObjectStore('receipts', { keyPath:'receiptId' });
      try{ st.createIndex('dateISO','dateISO',{ unique:false }); }catch(_){ }
      try{ st.createIndex('status','status',{ unique:false }); }catch(_){ }
      try{ st.createIndex('updatedAt','updatedAt',{ unique:false }); }catch(_){ }
    } else {
      try{
        const st = event && event.target && event.target.transaction ? event.target.transaction.objectStore('receipts') : null;
        if (st && !st.indexNames.contains('dateISO')) st.createIndex('dateISO','dateISO',{ unique:false });
        if (st && !st.indexNames.contains('status')) st.createIndex('status','status',{ unique:false });
        if (st && !st.indexNames.contains('updatedAt')) st.createIndex('updatedAt','updatedAt',{ unique:false });
      }catch(_){ }
    }
    if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath:'id' });
    if (!d.objectStoreNames.contains('posDailyCloseImports')){
      const st = d.createObjectStore('posDailyCloseImports', { keyPath:'closureId' });
      try{ st.createIndex('eventDateKey','eventDateKey',{ unique:false }); }catch(_){ }
    } else {
      try{
        const st = event && event.target && event.target.transaction ? event.target.transaction.objectStore('posDailyCloseImports') : null;
        if (st && !st.indexNames.contains('eventDateKey')) st.createIndex('eventDateKey','eventDateKey',{ unique:false });
      }catch(_){ }
    }
  }

  function openFinanceDBCAT(){
    if (finDbCAT) return Promise.resolve(finDbCAT);
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(FIN_DB_NAME_CAT, FIN_DB_VERSION_CAT);
      req.onupgradeneeded = (event)=>{
        catEnsureFinanceSchema(event.target.result, event);
      };
      req.onsuccess = ()=>{
        finDbCAT = req.result;
        try{ finDbCAT.onversionchange = ()=>{ try{ finDbCAT.close(); }catch(_){ } finDbCAT = null; }; }catch(_){ }
        resolve(finDbCAT);
      };
      req.onerror = ()=>{
        const err = req.error;
        if (err && err.name === 'VersionError'){
          const req2 = indexedDB.open(FIN_DB_NAME_CAT);
          req2.onsuccess = ()=>{
            finDbCAT = req2.result;
            try{ finDbCAT.onversionchange = ()=>{ try{ finDbCAT.close(); }catch(_){ } finDbCAT = null; }; }catch(_){ }
            if (!finDbCAT.objectStoreNames.contains('suppliers')){
              reject(new Error('La base de Finanzas existe pero no tiene store suppliers.'));
              return;
            }
            resolve(finDbCAT);
          };
          req2.onerror = ()=>reject(req2.error || err);
          return;
        }
        reject(err);
      };
      req.onblocked = ()=>reject(new Error('IndexedDB de Finanzas bloqueado por otra pestaña.'));
    });
  }

  async function finGetAllCAT(storeName){
    if (!finDbCAT) await openFinanceDBCAT();
    if (!finDbCAT.objectStoreNames.contains(storeName)) throw new Error('Store no disponible: ' + storeName);
    return new Promise((resolve, reject)=>{
      const tx = finDbCAT.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = ()=>resolve(req.result || []);
      req.onerror = ()=>reject(req.error || tx.error);
      tx.onerror = ()=>reject(tx.error || req.error);
    });
  }

  async function finGetCAT(storeName, key){
    if (!finDbCAT) await openFinanceDBCAT();
    if (!finDbCAT.objectStoreNames.contains(storeName)) throw new Error('Store no disponible: ' + storeName);
    return new Promise((resolve, reject)=>{
      const tx = finDbCAT.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = ()=>resolve(req.result || null);
      req.onerror = ()=>reject(req.error || tx.error);
      tx.onerror = ()=>reject(tx.error || req.error);
    });
  }

  async function finAddCAT(storeName, value){
    if (!finDbCAT) await openFinanceDBCAT();
    if (!finDbCAT.objectStoreNames.contains(storeName)) throw new Error('Store no disponible: ' + storeName);
    return new Promise((resolve, reject)=>{
      const tx = finDbCAT.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).add(value);
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error || tx.error);
      tx.onerror = ()=>reject(tx.error || req.error);
    });
  }

  async function finPutCAT(storeName, value){
    if (!finDbCAT) await openFinanceDBCAT();
    if (!finDbCAT.objectStoreNames.contains(storeName)) throw new Error('Store no disponible: ' + storeName);
    return new Promise((resolve, reject)=>{
      const tx = finDbCAT.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(value);
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error || tx.error);
      tx.onerror = ()=>reject(tx.error || req.error);
    });
  }

  async function finDeleteCAT(storeName, key){
    if (!finDbCAT) await openFinanceDBCAT();
    if (!finDbCAT.objectStoreNames.contains(storeName)) throw new Error('Store no disponible: ' + storeName);
    return new Promise((resolve, reject)=>{
      const tx = finDbCAT.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = ()=>resolve(true);
      req.onerror = ()=>reject(req.error || tx.error);
      tx.onerror = ()=>reject(tx.error || req.error);
    });
  }

  function catNormNumNonNeg(v){
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
    return (Number.isFinite(n) && n >= 0) ? n : 0;
  }

  function catParseNonNegInput(value){
    const raw = String(value ?? '').trim();
    if (!raw) return { ok:true, empty:true, value:0 };
    const n = parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return { ok:false, empty:false, value:0 };
    return { ok:true, empty:false, value:n };
  }

  function catNormStrKeep(v, maxLen){
    const s = (v == null) ? '' : String(v);
    const out = s.trim();
    const ml = Number(maxLen || 120);
    return (Number.isFinite(ml) && ml > 0 && out.length > ml) ? out.slice(0, ml) : out;
  }

  function catNormBool(v){
    if (v === true) return true;
    if (v === false || v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'si' || s === 'sí' || s === 'yes';
  }

  function normalizeSupplierProductTypeCAT(v){
    const t = catNormStrKeep(v, 24).toUpperCase();
    return (t === 'CAJAS' || t === 'UNIDADES') ? t : '—';
  }

  function normalizeSupplierProductCAT(raw){
    const obj = (raw && typeof raw === 'object') ? raw : {};
    const precioRaw = obj.precio;
    const precioStr = (precioRaw == null) ? '' : String(precioRaw).trim();
    const hasFlag = Object.prototype.hasOwnProperty.call(obj, 'precioSet');
    const precioSet = hasFlag ? catNormBool(obj.precioSet) : ((precioStr !== '') && (catNormNumNonNeg(precioRaw) !== 0));
    return {
      ...obj,
      id: catNormStrKeep(obj.id, 80),
      nombre: catNormStrKeep(obj.nombre, 120),
      tipo: normalizeSupplierProductTypeCAT(obj.tipo),
      precio: catNormNumNonNeg(obj.precio),
      precioSet,
      unidadesPorCaja: catNormNumNonNeg(obj.unidadesPorCaja)
    };
  }

  function normalizeSupplierCAT(raw){
    const obj = (raw && typeof raw === 'object') ? raw : {};
    const productos = Array.isArray(obj.productos) ? obj.productos.map(normalizeSupplierProductCAT) : [];
    return {
      ...obj,
      id: obj.id,
      nombre: catNormStrKeep(obj.nombre, 120),
      telefono: catNormStrKeep(obj.telefono, 80),
      nota: catNormStrKeep(obj.nota, 220),
      productos
    };
  }

  function supplierSearchTextCAT(supplier){
    const s = normalizeSupplierCAT(supplier);
    const parts = [s.nombre, s.telefono, s.nota];
    for (const p of (Array.isArray(s.productos) ? s.productos : [])) parts.push(p.nombre, p.tipo);
    return normName(parts.filter(Boolean).join(' '));
  }

  function sortSuppliersCAT(a,b){
    const ida = Number(a && a.id || 0);
    const idb = Number(b && b.id || 0);
    if (idb !== ida) return idb - ida;
    return String((a && a.nombre) || '').localeCompare(String((b && b.nombre) || ''), 'es-NI', { sensitivity:'base' });
  }

  function setSupplierMsgCAT(message, kind){
    const el = byId('cat-supplier-msg');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-muted cat-edit-msg' + (kind ? (' ' + kind) : '');
  }

  function setEditSupplierMsgCAT(message, kind){
    const el = byId('cat-edit-supplier-msg');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-muted cat-edit-msg' + (kind ? (' ' + kind) : '');
  }

  function setCurrentSupplierMsgCAT(message, kind){
    if (currentSupplierEditIdCAT) setEditSupplierMsgCAT(message, kind);
    else setSupplierMsgCAT(message, kind);
  }

  function setSupplierProductMsgCAT(message, kind){
    const el = byId('cat-supplier-product-msg');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-muted cat-edit-msg' + (kind ? (' ' + kind) : '');
  }

  function updateModalBodyStateCAT(){
    const any = qsa('.cat-modal.show').length > 0;
    try{ document.body.classList.toggle('cat-modal-open', any); }catch(_){ }
  }

  function openModalCAT(id){
    const modal = byId(id);
    if (!modal) return;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
    updateModalBodyStateCAT();
  }

  function closeModalCAT(id){
    const modal = byId(id);
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden','true');
    updateModalBodyStateCAT();
  }

  function resetSupplierFormCAT(){
    currentSupplierEditIdCAT = null;
    ['cat-supplier-name','cat-supplier-phone','cat-supplier-note'].forEach(id => { const el = byId(id); if (el) el.value = ''; });
    setSupplierMsgCAT('');
  }

  function readSupplierFieldsCAT(mode){
    const edit = mode === 'edit';
    const nombre = catNormStrKeep(byId(edit ? 'cat-edit-supplier-name' : 'cat-supplier-name')?.value || '', 120);
    const telefono = catNormStrKeep(byId(edit ? 'cat-edit-supplier-phone' : 'cat-supplier-phone')?.value || '', 80);
    const nota = catNormStrKeep(byId(edit ? 'cat-edit-supplier-note' : 'cat-supplier-note')?.value || '', 220);
    if (!nombre) return { ok:false, msg:'El nombre del proveedor es obligatorio.' };
    return { ok:true, nombre, telefono, nota };
  }

  async function getSupplierByIdCAT(id){
    const sid = Number(id || 0);
    if (!Number.isFinite(sid) || sid <= 0) return null;
    const raw = await finGetCAT('suppliers', sid);
    return raw ? normalizeSupplierCAT(raw) : null;
  }

  async function renderSuppliersCAT(){
    try{
      await openFinanceDBCAT();
      let list = (await finGetAllCAT('suppliers')).map(normalizeSupplierCAT).sort(sortSuppliersCAT);
      const q = normName(byId('cat-supplier-search')?.value || '');
      const all = list;
      if (q) list = list.filter(s => supplierSearchTextCAT(s).includes(q));
      const wrap = byId('cat-suppliers-list');
      if (!wrap) return;
      wrap.innerHTML = '';
      const totalProducts = all.reduce((acc, s)=>acc + (Array.isArray(s.productos) ? s.productos.length : 0), 0);
      const status = all.length
        ? `${all.length} proveedor(es) maestro(s) · ${totalProducts} producto(s) asociado(s)${q ? ' · ' + list.length + ' resultado(s)' : ''}.`
        : 'No hay proveedores registrados todavía. Puedes crear el primero aquí o conservar los que Finanzas genere.';
      setStatusById('cat-suppliers-status', status, all.length ? 'ok' : 'warn');
      if (!list.length){
        const empty = document.createElement('div');
        empty.className = 'cat-supplier-empty';
        empty.textContent = q ? 'Sin resultados para la búsqueda.' : 'Sin proveedores registrados.';
        wrap.appendChild(empty);
        return;
      }
      for (const s of list){
        const count = Array.isArray(s.productos) ? s.productos.length : 0;
        const tel = s.telefono || '—';
        const nota = s.nota || '—';
        const card = document.createElement('div');
        card.className = 'cat-product-card cat-supplier-card';
        card.innerHTML = `
          <div class="cat-product-main">
            <div class="cat-product-title-row">
              <strong>${escapeHtml(s.nombre || 'Proveedor sin nombre')}</strong>
              <span class="cat-pill gold">Maestro</span>
              <span class="cat-pill muted">${escapeHtml(String(count))} producto(s)</span>
            </div>
            <div class="cat-product-meta">
              <div><small>Teléfono</small><b>${escapeHtml(tel)}</b></div>
              <div><small>Nota</small><b>${escapeHtml(nota)}</b></div>
              <div><small>Productos</small><b>${escapeHtml(String(count))}</b></div>
              <div><small>Histórico</small><b>No recalcula</b></div>
            </div>
          </div>
          <div class="cat-product-actions">
            <button class="cat-btn cat-btn-secondary cat-supplier-products" data-id="${escapeHtml(String(s.id))}" type="button">Productos</button>
            <button class="cat-btn cat-btn-ok cat-edit-supplier" data-id="${escapeHtml(String(s.id))}" type="button">Editar</button>
            <button class="cat-btn cat-btn-warn cat-delete-supplier" data-id="${escapeHtml(String(s.id))}" type="button">Eliminar</button>
          </div>
        `;
        wrap.appendChild(card);
      }
    }catch(err){
      console.error(err);
      setStatusById('cat-suppliers-status', 'No se pudieron cargar los proveedores maestros. Cierra otras pestañas de Finanzas y vuelve a intentar.', 'warn');
    }
  }

  async function saveSupplierNewCAT(){
    const data = readSupplierFieldsCAT('add');
    if (!data.ok){ setSupplierMsgCAT(data.msg, 'warn'); return; }
    const now = new Date().toISOString();
    const row = {
      nombre:data.nombre,
      telefono:data.telefono,
      nota:data.nota,
      productos:[],
      createdAt:now,
      updatedAt:now,
      updatedFrom:'catalogos_proveedores'
    };
    await finAddCAT('suppliers', row);
    resetSupplierFormCAT();
    await renderSuppliersCAT();
    toast('Proveedor agregado');
  }

  async function openSupplierModalCAT(id){
    const s = await getSupplierByIdCAT(id);
    if (!s){ toast('Proveedor no encontrado'); return; }
    currentSupplierEditIdCAT = Number(s.id);
    const current = byId('cat-supplier-current'); if (current) current.textContent = 'Proveedor actual: ' + (s.nombre || '—');
    const fields = {
      'cat-edit-supplier-name': s.nombre || '',
      'cat-edit-supplier-phone': s.telefono || '',
      'cat-edit-supplier-note': s.nota || ''
    };
    Object.keys(fields).forEach(id => { const el = byId(id); if (el) el.value = fields[id]; });
    setEditSupplierMsgCAT('');
    openModalCAT('cat-supplier-modal');
    setTimeout(()=>{ try{ byId('cat-edit-supplier-name')?.focus({ preventScroll:true }); byId('cat-edit-supplier-name')?.select(); }catch(_){ } }, 60);
  }

  function closeSupplierModalCAT(){
    closeModalCAT('cat-supplier-modal');
    currentSupplierEditIdCAT = null;
    setEditSupplierMsgCAT('');
  }

  async function saveSupplierEditCAT(){
    if (!currentSupplierEditIdCAT){ setEditSupplierMsgCAT('Proveedor inválido.', 'warn'); return; }
    const data = readSupplierFieldsCAT('edit');
    if (!data.ok){ setEditSupplierMsgCAT(data.msg, 'warn'); return; }
    const existing = await finGetCAT('suppliers', Number(currentSupplierEditIdCAT));
    if (!existing){ setEditSupplierMsgCAT('El proveedor ya no existe. Actualiza la lista.', 'warn'); return; }
    const productos = Array.isArray(existing.productos) ? existing.productos : [];
    await finPutCAT('suppliers', {
      ...existing,
      nombre:data.nombre,
      telefono:data.telefono,
      nota:data.nota,
      productos,
      updatedAt:new Date().toISOString(),
      updatedFrom:'catalogos_proveedores'
    });
    closeSupplierModalCAT();
    await renderSuppliersCAT();
    toast('Proveedor guardado');
  }

  async function deleteSupplierCAT(id){
    const sid = Number(id || 0);
    if (!Number.isFinite(sid) || sid <= 0) return;
    const ok = confirm('¿Eliminar este proveedor? Las compras históricas se mantienen.');
    if (!ok) return;
    await finDeleteCAT('suppliers', sid);
    if (currentSupplierProductsIdCAT && Number(currentSupplierProductsIdCAT) === sid) closeSupplierProductsModalCAT();
    if (currentSupplierEditIdCAT && Number(currentSupplierEditIdCAT) === sid) closeSupplierModalCAT();
    await renderSuppliersCAT();
    toast('Proveedor eliminado');
  }

  function supplierProductTypeLabelCAT(tipo){
    const t = normalizeSupplierProductTypeCAT(tipo);
    return (t === 'CAJAS' || t === 'UNIDADES') ? t : '—';
  }

  async function openSupplierProductsModalCAT(id){
    const s = await getSupplierByIdCAT(id);
    if (!s){ toast('Proveedor no encontrado'); return; }
    currentSupplierProductsIdCAT = Number(s.id);
    const title = byId('cat-supplier-products-title'); if (title) title.textContent = 'Productos de ' + (s.nombre || 'Proveedor');
    const sub = byId('cat-supplier-products-sub');
    if (sub){
      const parts = [];
      if (s.telefono) parts.push('Tel: ' + s.telefono);
      if (s.nota) parts.push(s.nota);
      sub.textContent = parts.length ? parts.join(' · ') : 'Proveedor: ' + (s.nombre || '—');
    }
    openModalCAT('cat-supplier-products-modal');
    await renderSupplierProductsModalCAT();
  }

  function closeSupplierProductsModalCAT(){
    closeSupplierProductModalCAT();
    closeModalCAT('cat-supplier-products-modal');
    currentSupplierProductsIdCAT = null;
    setStatusById('cat-supplier-products-status', 'Cargando productos…');
    const list = byId('cat-supplier-products-list'); if (list) list.innerHTML = '';
  }

  async function renderSupplierProductsModalCAT(){
    const list = byId('cat-supplier-products-list');
    if (!list) return;
    list.innerHTML = '';
    const sid = Number(currentSupplierProductsIdCAT || 0);
    if (!Number.isFinite(sid) || sid <= 0){
      setStatusById('cat-supplier-products-status', 'Proveedor inválido.', 'warn');
      return;
    }
    const supplier = await getSupplierByIdCAT(sid);
    if (!supplier){
      setStatusById('cat-supplier-products-status', 'El proveedor ya no existe.', 'warn');
      return;
    }
    const productos = Array.isArray(supplier.productos) ? supplier.productos.map(normalizeSupplierProductCAT).sort((a,b)=>String(a.nombre||'').localeCompare(String(b.nombre||''),'es-NI',{sensitivity:'base'})) : [];
    setStatusById('cat-supplier-products-status', productos.length ? `${productos.length} producto(s) registrado(s).` : 'Sin productos registrados para este proveedor.', productos.length ? 'ok' : 'warn');
    if (!productos.length){
      const empty = document.createElement('div');
      empty.className = 'cat-supplier-empty';
      empty.textContent = 'Sin productos. Puedes agregar el primero desde el botón superior.';
      list.appendChild(empty);
      return;
    }
    for (const p of productos){
      const tipo = supplierProductTypeLabelCAT(p.tipo);
      const unidades = tipo === 'CAJAS' ? catNormNumNonNeg(p.unidadesPorCaja) : 0;
      const card = document.createElement('div');
      card.className = 'cat-product-card cat-supplier-product-card';
      card.innerHTML = `
        <div class="cat-product-main">
          <div class="cat-product-title-row">
            <strong>${escapeHtml(p.nombre || 'Producto sin nombre')}</strong>
            <span class="cat-pill gold">${escapeHtml(tipo)}</span>
          </div>
          <div class="cat-product-meta">
            <div><small>Tipo</small><b>${escapeHtml(tipo)}</b></div>
            <div><small>Precio ref. C$</small><b>${escapeHtml(p.precioSet ? displayMoney(p.precio) : '—')}</b></div>
            <div><small>Unidades por caja</small><b>${escapeHtml(String(unidades))}</b></div>
            <div><small>Histórico</small><b>No recalcula</b></div>
          </div>
        </div>
        <div class="cat-product-actions">
          <button class="cat-btn cat-btn-ok cat-edit-supplier-product" data-pid="${escapeHtml(String(p.id))}" type="button">Editar</button>
          <button class="cat-btn cat-btn-warn cat-delete-supplier-product" data-pid="${escapeHtml(String(p.id))}" type="button">Borrar</button>
        </div>
      `;
      list.appendChild(card);
    }
  }

  function updateSupplierProductUnitsStateCAT(){
    const typeEl = byId('cat-supplier-product-type');
    const unitsEl = byId('cat-supplier-product-units');
    if (!typeEl || !unitsEl) return;
    const t = String(typeEl.value || '').toUpperCase();
    if (t === 'CAJAS'){
      unitsEl.disabled = false;
      const last = unitsEl.dataset && typeof unitsEl.dataset.a33LastUnits === 'string' ? unitsEl.dataset.a33LastUnits : '';
      if (!String(unitsEl.value || '').trim() && last) unitsEl.value = last;
    } else {
      const cur = String(unitsEl.value || '').trim();
      if (cur){ try{ unitsEl.dataset.a33LastUnits = cur; }catch(_){ } }
      unitsEl.value = '';
      unitsEl.disabled = true;
    }
  }

  async function openSupplierProductModalCAT(productId){
    const sid = Number(currentSupplierProductsIdCAT || 0);
    if (!Number.isFinite(sid) || sid <= 0){ toast('Primero selecciona un proveedor'); return; }
    const supplier = await getSupplierByIdCAT(sid);
    if (!supplier){ toast('Proveedor no encontrado'); return; }
    const pid = String(productId || '').trim();
    const product = pid ? (supplier.productos || []).map(normalizeSupplierProductCAT).find(p => String(p.id || '') === pid) : null;
    if (pid && !product){ toast('Producto no encontrado'); return; }
    currentSupplierProductEditIdCAT = product ? String(product.id || '') : null;
    const title = byId('cat-supplier-product-title'); if (title) title.textContent = product ? 'Editar producto' : 'Agregar producto';
    const current = byId('cat-supplier-product-current'); if (current) current.textContent = 'Producto actual: ' + (product && product.nombre ? product.nombre : 'Nuevo producto');
    const name = byId('cat-supplier-product-name'); if (name) name.value = product ? (product.nombre || '') : '';
    const type = byId('cat-supplier-product-type'); if (type) type.value = product && (product.tipo === 'CAJAS' || product.tipo === 'UNIDADES') ? product.tipo : '';
    const price = byId('cat-supplier-product-price'); if (price) price.value = product && product.precioSet ? String(catNormNumNonNeg(product.precio)) : '';
    const units = byId('cat-supplier-product-units');
    if (units){
      const val = product && product.tipo === 'CAJAS' && product.unidadesPorCaja != null ? String(catNormNumNonNeg(product.unidadesPorCaja)) : '';
      units.value = val;
      try{ units.dataset.a33LastUnits = val; }catch(_){ }
    }
    setSupplierProductMsgCAT('');
    updateSupplierProductUnitsStateCAT();
    openModalCAT('cat-supplier-product-modal');
    setTimeout(()=>{ try{ name?.focus({ preventScroll:true }); name?.select(); }catch(_){ } }, 60);
  }

  function closeSupplierProductModalCAT(){
    closeModalCAT('cat-supplier-product-modal');
    currentSupplierProductEditIdCAT = null;
    setSupplierProductMsgCAT('');
  }

  function genSupplierProductIdCAT(){
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  async function saveSupplierProductCAT(){
    const sid = Number(currentSupplierProductsIdCAT || 0);
    if (!Number.isFinite(sid) || sid <= 0){ setSupplierProductMsgCAT('Proveedor inválido.', 'warn'); return; }
    const supplierRaw = await finGetCAT('suppliers', sid);
    if (!supplierRaw){ setSupplierProductMsgCAT('El proveedor ya no existe.', 'warn'); return; }
    const nombre = catNormStrKeep(byId('cat-supplier-product-name')?.value || '', 120);
    const tipo = String(byId('cat-supplier-product-type')?.value || '').trim().toUpperCase();
    const priceParsed = catParseNonNegInput(byId('cat-supplier-product-price')?.value || '');
    const unitsParsed = catParseNonNegInput(byId('cat-supplier-product-units')?.value || '');
    if (!nombre){ setSupplierProductMsgCAT('El nombre del producto es obligatorio.', 'warn'); return; }
    if (!(tipo === 'CAJAS' || tipo === 'UNIDADES')){ setSupplierProductMsgCAT('Selecciona CAJAS o UNIDADES.', 'warn'); return; }
    if (!priceParsed.ok){ setSupplierProductMsgCAT('Precio ref. C$ inválido.', 'warn'); return; }
    if (tipo === 'CAJAS' && !unitsParsed.ok){ setSupplierProductMsgCAT('Unidades por caja inválidas.', 'warn'); return; }
    const editId = currentSupplierProductEditIdCAT ? String(currentSupplierProductEditIdCAT) : '';
    const productId = editId || genSupplierProductIdCAT();
    const payload = {
      id: productId,
      nombre,
      tipo,
      precio: round2(priceParsed.value),
      precioSet: !priceParsed.empty,
      unidadesPorCaja: tipo === 'CAJAS' ? catNormNumNonNeg(unitsParsed.value) : 0
    };
    const arr = Array.isArray(supplierRaw.productos) ? supplierRaw.productos : [];
    let found = false;
    const updated = arr.map(p => {
      const pid = String((p && p.id) || '');
      if (pid && pid === productId){
        found = true;
        return { ...p, ...payload };
      }
      return p;
    });
    if (!found) updated.push(payload);
    await finPutCAT('suppliers', { ...supplierRaw, productos:updated, updatedAt:new Date().toISOString(), updatedFrom:'catalogos_proveedores_productos' });
    closeSupplierProductModalCAT();
    await renderSupplierProductsModalCAT();
    await renderSuppliersCAT();
    toast(editId ? 'Producto actualizado' : 'Producto agregado');
  }

  async function deleteSupplierProductCAT(productId){
    const sid = Number(currentSupplierProductsIdCAT || 0);
    const pid = String(productId || '').trim();
    if (!Number.isFinite(sid) || sid <= 0 || !pid) return;
    const ok = confirm('¿Borrar este producto del proveedor? Las compras históricas se mantienen.');
    if (!ok) return;
    const supplierRaw = await finGetCAT('suppliers', sid);
    if (!supplierRaw){ toast('Proveedor no encontrado'); return; }
    const arr = Array.isArray(supplierRaw.productos) ? supplierRaw.productos : [];
    const updated = arr.filter(p => String((p && p.id) || '') !== pid);
    await finPutCAT('suppliers', { ...supplierRaw, productos:updated, updatedAt:new Date().toISOString(), updatedFrom:'catalogos_proveedores_productos_borrar' });
    if (currentSupplierProductEditIdCAT && String(currentSupplierProductEditIdCAT) === pid) closeSupplierProductModalCAT();
    await renderSupplierProductsModalCAT();
    await renderSuppliersCAT();
    toast('Producto borrado');
  }

  function bindSupplierUi(){
    const suppliersList = byId('cat-suppliers-list');
    if (suppliersList){
      suppliersList.addEventListener('click', async (e)=>{
        const products = e.target.closest('.cat-supplier-products');
        const edit = e.target.closest('.cat-edit-supplier');
        const del = e.target.closest('.cat-delete-supplier');
        if (products){ await openSupplierProductsModalCAT(products.dataset.id); return; }
        if (edit){ await openSupplierModalCAT(edit.dataset.id); return; }
        if (del){ await deleteSupplierCAT(del.dataset.id); return; }
      });
    }
    byId('cat-save-supplier')?.addEventListener('click', ()=>saveSupplierNewCAT().catch(err=>{ console.error(err); setSupplierMsgCAT('No se pudo guardar el proveedor.', 'warn'); }));
    byId('cat-refresh-suppliers')?.addEventListener('click', async ()=>{ await renderSuppliersCAT(); toast('Proveedores actualizados'); });
    byId('cat-supplier-search')?.addEventListener('input', ()=>renderSuppliersCAT().catch(err=>console.error(err)));

    byId('cat-edit-supplier-save')?.addEventListener('click', ()=>saveSupplierEditCAT().catch(err=>{ console.error(err); setEditSupplierMsgCAT('No se pudo guardar el proveedor.', 'warn'); }));
    byId('cat-edit-supplier-cancel')?.addEventListener('click', closeSupplierModalCAT);
    byId('cat-supplier-close')?.addEventListener('click', closeSupplierModalCAT);
    const supplierModal = byId('cat-supplier-modal');
    if (supplierModal) supplierModal.addEventListener('click', (e)=>{ if (e.target === supplierModal) closeSupplierModalCAT(); });

    byId('cat-supplier-products-close')?.addEventListener('click', closeSupplierProductsModalCAT);
    byId('cat-add-supplier-product')?.addEventListener('click', ()=>openSupplierProductModalCAT(null).catch(err=>{ console.error(err); toast('No se pudo abrir el producto'); }));
    const productsModal = byId('cat-supplier-products-modal');
    if (productsModal) productsModal.addEventListener('click', (e)=>{ if (e.target === productsModal) closeSupplierProductsModalCAT(); });
    const productsList = byId('cat-supplier-products-list');
    if (productsList){
      productsList.addEventListener('click', async (e)=>{
        const edit = e.target.closest('.cat-edit-supplier-product');
        const del = e.target.closest('.cat-delete-supplier-product');
        if (edit){ await openSupplierProductModalCAT(edit.dataset.pid); return; }
        if (del){ await deleteSupplierProductCAT(del.dataset.pid); return; }
      });
    }

    byId('cat-supplier-product-close')?.addEventListener('click', closeSupplierProductModalCAT);
    byId('cat-supplier-product-cancel')?.addEventListener('click', closeSupplierProductModalCAT);
    byId('cat-supplier-product-save')?.addEventListener('click', ()=>saveSupplierProductCAT().catch(err=>{ console.error(err); setSupplierProductMsgCAT('No se pudo guardar el producto.', 'warn'); }));
    byId('cat-supplier-product-type')?.addEventListener('change', updateSupplierProductUnitsStateCAT);
    const productModal = byId('cat-supplier-product-modal');
    if (productModal) productModal.addEventListener('click', (e)=>{ if (e.target === productModal) closeSupplierProductModalCAT(); });

    document.addEventListener('keydown', (e)=>{
      if (!e || e.key !== 'Escape') return;
      const product = byId('cat-supplier-product-modal');
      const products = byId('cat-supplier-products-modal');
      const supplier = byId('cat-supplier-modal');
      if (product && product.classList.contains('show')){ closeSupplierProductModalCAT(); return; }
      if (products && products.classList.contains('show')){ closeSupplierProductsModalCAT(); return; }
      if (supplier && supplier.classList.contains('show')) closeSupplierModalCAT();
    });
  }

  async function initSuppliers(){
    await openFinanceDBCAT();
    await renderSuppliersCAT();
  }

  function bindExtraBankUi(){
    const extrasList = byId('cat-extras-list');
    if (extrasList){
      extrasList.addEventListener('click', async (e)=>{
        const edit = e.target.closest('.cat-edit-extra');
        const toggle = e.target.closest('.cat-toggle-extra');
        if (edit){ await editExtraMaster(edit.dataset.id); return; }
        if (toggle){ await toggleExtraMaster(toggle.dataset.id); return; }
      });
    }
    const banksList = byId('cat-banks-list');
    if (banksList){
      banksList.addEventListener('click', async (e)=>{
        const edit = e.target.closest('.cat-edit-bank');
        const toggle = e.target.closest('.cat-toggle-bank');
        if (edit){ await editBankMaster(edit.dataset.id); return; }
        if (toggle){ await toggleBankMaster(toggle.dataset.id); return; }
      });
    }
    byId('cat-save-extra')?.addEventListener('click', ()=>saveExtraMaster().catch(err=>{ console.error(err); alert('No se pudo guardar el extra.'); }));
    byId('cat-cancel-extra')?.addEventListener('click', resetExtraForm);
    byId('cat-refresh-extras')?.addEventListener('click', async ()=>{ await seedExtrasFromEventSnapshots(); await renderExtras(); toast('Extras actualizados'); });
    byId('cat-save-bank')?.addEventListener('click', ()=>saveBankMaster().catch(err=>{ console.error(err); alert('No se pudo guardar el banco.'); }));
    byId('cat-cancel-bank')?.addEventListener('click', resetBankForm);
    byId('cat-refresh-banks')?.addEventListener('click', async ()=>{ await renderBanks(); toast('Bancos actualizados'); });
    byId('cat-restore-banks')?.addEventListener('click', async ()=>{ await ensureBanksDefaultsCatalog(); await renderBanks(); toast('Bancos base revisados'); });
  }

  async function initMasterCatalogs(){
    await openDB();
    await seedExtrasFromEventSnapshots();
    await ensureBanksDefaultsCatalog();
    await renderExtras();
    await renderBanks();
  }

  function bindProductUi(){
    const list = byId('cat-products-list');
    if (list){
      list.addEventListener('click', async (e)=>{
        const edit = e.target.closest('.cat-edit-product');
        const toggle = e.target.closest('.cat-toggle-product');
        if (edit){ await openProductModal(edit.dataset.id); return; }
        if (toggle){ await toggleProduct(toggle.dataset.id); }
      });
    }
    byId('cat-add-product')?.addEventListener('click', ()=>addProduct().catch(err=>{ console.error(err); alert('No se pudo agregar el producto.'); }));
    byId('cat-refresh-products')?.addEventListener('click', ()=>initProducts({ skipSeed:true }).catch(err=>{ console.error(err); setStatus('No se pudo actualizar.', 'warn'); }));
    byId('cat-restore-seed')?.addEventListener('click', async ()=>{
      await seedMissingDefaults(true);
      await normalizeLegacyGallon();
      await renderProducts();
      toast('Productos base restaurados');
    });
    byId('cat-product-close')?.addEventListener('click', closeProductModal);
    byId('cat-edit-cancel')?.addEventListener('click', closeProductModal);
    byId('cat-edit-save')?.addEventListener('click', ()=>saveProduct().catch(err=>{ console.error(err); setEditMsg('No se pudo guardar.', 'warn'); }));
    const modal = byId('cat-product-modal');
    if (modal){
      modal.addEventListener('click', (e)=>{ if (e.target === modal) closeProductModal(); });
      modal.addEventListener('keydown', (e)=>{
        if (e.key === 'Escape') closeProductModal();
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter'){
          e.preventDefault();
          saveProduct().catch(err=>console.error(err));
        }
      });
    }
  }

  async function initProducts(options){
    const opts = options || {};
    setStatus('Cargando productos…');
    await openDB();
    if (!opts.skipSeed) await seedMissingDefaults(false);
    await normalizeLegacyGallon();
    await renderProducts();
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindTabs();
    bindProductUi();
    bindExtraBankUi();
    bindCustomerUi();
    bindSupplierUi();
    activateTabFromUrl();
    if (!qs('.cat-panel.is-active')) activateTab('productos');
    try{ if (window.A33_applyReleaseLabel) window.A33_applyReleaseLabel(); }catch(_){ }
    initProducts().catch(err=>{
      console.error(err);
      setStatus('No se pudo abrir Catálogos → Productos. Cierra otras pestañas de Suite A33 y vuelve a intentar.', 'warn');
    });
    initMasterCatalogs().catch(err=>{
      console.error(err);
      setStatusById('cat-extras-status', 'No se pudo abrir Catálogos → Extras.', 'warn');
      setStatusById('cat-banks-status', 'No se pudo abrir Catálogos → Bancos.', 'warn');
    });
    initCustomers().catch(err=>{
      console.error(err);
      setStatusById('cat-customers-status', 'No se pudo abrir Catálogos → Clientes.', 'warn');
    });
    initSuppliers().catch(err=>{
      console.error(err);
      setStatusById('cat-suppliers-status', 'No se pudo abrir Catálogos → Proveedores.', 'warn');
    });
    window.addEventListener('hashchange', activateTabFromUrl);
    registerServiceWorker();
  });
})();
