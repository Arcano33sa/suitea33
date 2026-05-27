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

  function bindTabs(){
    qsa('.cat-tab').forEach((tab) => {
      tab.addEventListener('click', () => activateTab(tab.getAttribute('data-target')));
    });
  }

  function registerServiceWorker(){
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=4.20.77&r=2').then((reg)=>{
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
    registerServiceWorker();
  });
})();
