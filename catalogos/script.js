(function(){
  'use strict';

  const DB_NAME = 'a33-pos';
  const DB_VER = 34;
  const DEFAULT_GALON_PRICE = 900;
  const LEGACY_GALON_PRICE = 800;
  const CANON_GALON_LABEL = 'Galón 3720 ml';
  const SEED = [
    { name:'Vaso', price:100, manageStock:true, active:true, capacityMl:null, receta:false, letra:'', pos:true, envaseId:'', tapaId:'' },
    { name:'Pulso 250ml', price:120, manageStock:true, active:true, receta:true, letra:'P', pos:true, envaseId:'envase_pulso', tapaId:'tapa_pulso_litro' },
    { name:'Media 375ml', price:150, manageStock:true, active:true, receta:true, letra:'M', pos:true, envaseId:'envase_media', tapaId:'tapa_djeba_media' },
    { name:'Djeba 750ml', price:300, manageStock:true, active:true, receta:true, letra:'D', pos:true, envaseId:'envase_djeba', tapaId:'tapa_djeba_media' },
    { name:'Litro 1000ml', price:330, manageStock:true, active:true, receta:true, letra:'L', pos:true, envaseId:'envase_litro', tapaId:'tapa_pulso_litro' },
    { name:CANON_GALON_LABEL, price:DEFAULT_GALON_PRICE, manageStock:true, active:true, receta:true, letra:'G', pos:true, envaseId:'envase_galon', tapaId:'tapa_galon' }
  ];

  let db = null;
  let currentEditId = null;
  let currentExtraEditId = null;
  let currentBankEditId = null;
  let currentEnvaseEditId = null;
  let currentTapaEditId = null;
  let currentCustomerEditId = null;

  const CUSTOMER_CATALOG_KEY = 'a33_pos_customersCatalog';
  const CUSTOMER_DISABLED_KEY = 'a33_pos_customersDisabled';
  const CUSTOMER_SCHEMA_VERSION = 1;
  const COSTS_CATALOG_KEY = 'a33_catalog_costos_v1';
  const COSTS_SCHEMA_VERSION = 2;
  const COSTS_LIQUIDS = [
    { key:'vino', label:'Vino' },
    { key:'vodka', label:'Vodka' },
    { key:'jugo', label:'Jugo' },
    { key:'sirope', label:'Sirope' },
    { key:'aguaPura', label:'Agua pura' }
  ];
  const COSTS_CONSUMABLES = [
    { key:'botella', label:'Botella' },
    { key:'calcomania', label:'Calcomanía' }
  ];
  const COSTS_RECIPES_KEY = 'arcano33_recetas_v1';
  const COSTS_RECIPE_ALIASES = {
    vino:['vino', 'vino tinto', 'vinotinto', 'wine'],
    vodka:['vodka'],
    jugo:['jugo', 'zumo', 'jugo natural'],
    sirope:['sirope', 'jarabe', 'syrup'],
    aguaPura:['agua', 'agua pura', 'aguapura', 'pure water']
  };
  let currentCostsProducts = [];
  let costsRefreshTimer = null;
  let costsRenderToken = 0;
  const CATALOG_DELETED_KEYS = {
    products:'a33_catalog_deleted_products_v1',
    extras:'a33_catalog_deleted_extras_v1',
    banks:'a33_catalog_deleted_banks_v1',
    envases:'a33_catalog_deleted_envases_v1',
    tapas:'a33_catalog_deleted_tapas_v1',
    customers:'a33_catalog_deleted_customers_v1'
  };

  const ENVASES_CATALOG_KEY = 'a33_catalog_envases_v1';
  const ENVASES_SCHEMA_VERSION = 1;
  const ENVASES_SEED = [
    { id:'envase_pulso', name:'Botella Pulso', capacityMl:250, active:true },
    { id:'envase_media', name:'Botella Media', capacityMl:375, active:true },
    { id:'envase_djeba', name:'Botella Djeba', capacityMl:750, active:true },
    { id:'envase_litro', name:'Botella Litro', capacityMl:1000, active:true },
    { id:'envase_galon', name:'Botella Galón', capacityMl:3720, active:true },
    { id:'envase_catrina', name:'Botella Catrina', capacityMl:null, active:true },
    { id:'envase_catrina_jr', name:'Botella Catrina Jr.', capacityMl:null, active:true }
  ];


  const TAPAS_CATALOG_KEY = 'a33_catalog_tapas_v1';
  const TAPAS_SCHEMA_VERSION = 1;
  const TAPAS_SEED = [
    { id:'tapa_galon', name:'Tapa Galón', active:true },
    { id:'tapa_pulso_litro', name:'Tapa Pulso/Litro', active:true },
    { id:'tapa_djeba_media', name:'Tapa Djeba/Media', active:true },
    { id:'corcho_catrina', name:'Corcho Catrina', active:true }
  ];


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
    if (key === 'costos'){
      renderCostsProductColumns().catch((err) => {
        try{ console.warn('[Suite A33] No se pudieron actualizar las columnas dinámicas de Costos.', err); }catch(_){ }
      });
    }
  }

  function getInitialTabFromUrl(){
    const allowed = new Set(['productos','envases','tapas','extras','costos','bancos','clientes']);
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
      navigator.serviceWorker.register('./sw.js?v=4.20.84&r=24').then((reg)=>{
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
    if (n.includes('galon') || /(^|\s)gal($|\s)/.test(n)) return 'galon';
    return null;
  }

  function hasOwn(obj, key){
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function boolFromCatalog(value, fallback){
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    const raw = String(value ?? '').trim().toLowerCase();
    if (['true','1','si','sí','yes','y'].includes(raw)) return true;
    if (['false','0','no','n'].includes(raw)) return false;
    return !!fallback;
  }

  function normalizeProductLetter(value){
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 4);
  }

  function productDynamicDefaults(product){
    const p = product && typeof product === 'object' ? product : {};
    const name = String(p.name || p.nombre || '');
    const finishedId = mapProductNameToFinishedId(name);
    const byFinished = {
      pulso:{ receta:true, letra:'P', pos:true },
      media:{ receta:true, letra:'M', pos:true },
      djeba:{ receta:true, letra:'D', pos:true },
      litro:{ receta:true, letra:'L', pos:true },
      galon:{ receta:true, letra:'G', pos:true }
    };
    if (finishedId && byFinished[finishedId]) return { ...byFinished[finishedId] };
    if (normName(name).includes('vaso')) return { receta:false, letra:'', pos:true };
    // Compatibilidad defensiva: productos antiguos sin POS explícito no se publican automáticamente.
    // Solo los productos A33 claramente vendibles y Vaso reciben POS por defecto.
    return { receta:false, letra:'', pos:false };
  }

  function productHasRecipe(product){
    const p = product && typeof product === 'object' ? product : {};
    if (hasOwn(p, 'receta')) return boolFromCatalog(p.receta, false);
    if (hasOwn(p, 'recipe')) return boolFromCatalog(p.recipe, false);
    if (hasOwn(p, 'hasRecipe')) return boolFromCatalog(p.hasRecipe, false);
    return false;
  }

  function productPosEnabled(product){
    const p = product && typeof product === 'object' ? product : {};
    if (hasOwn(p, 'pos')) return boolFromCatalog(p.pos, false);
    if (hasOwn(p, 'showInPOS')) return boolFromCatalog(p.showInPOS, false);
    if (hasOwn(p, 'visiblePOS')) return boolFromCatalog(p.visiblePOS, false);
    return false;
  }

  function productLetter(product){
    const p = product && typeof product === 'object' ? product : {};
    return normalizeProductLetter(p.letra ?? p.letter ?? p.productionLetter ?? '');
  }

  function productEnvaseId(product){
    const p = product && typeof product === 'object' ? product : {};
    return String(p.envaseId ?? p.bottleId ?? p.packagingEnvaseId ?? '').trim();
  }

  function productTapaId(product){
    const p = product && typeof product === 'object' ? product : {};
    return String(p.tapaId ?? p.capId ?? p.corkId ?? p.packagingTapaId ?? '').trim();
  }

  function buildRecipeLetterUsage(products, currentId){
    const map = new Map();
    const cid = currentId == null ? '' : String(currentId).trim();
    for (const p of (Array.isArray(products) ? products : [])){
      if (!p || !productHasRecipe(p)) continue;
      const pid = p.id == null ? '' : String(p.id).trim();
      if (cid && pid === cid) continue;
      const letter = productLetter(p);
      if (!letter) continue;
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter).push(p);
    }
    return map;
  }

  function findDuplicateRecipeLetter(products, letter, currentId){
    const clean = normalizeProductLetter(letter);
    if (!clean) return null;
    const usage = buildRecipeLetterUsage(products, currentId);
    const list = usage.get(clean) || [];
    return list.length ? list[0] : null;
  }

  function getDuplicateRecipeLetters(products){
    const usage = buildRecipeLetterUsage(products, null);
    const duplicates = new Map();
    for (const [letter, rows] of usage.entries()){
      if ((rows || []).length > 1) duplicates.set(letter, rows);
    }
    return duplicates;
  }

  function productProductionIssues(product, envases, tapas, duplicateLetters){
    const issues = [];
    if (!productHasRecipe(product)) return issues;
    const letter = productLetter(product);
    const envaseId = productEnvaseId(product);
    const tapaId = productTapaId(product);
    if (!letter) issues.push('Falta Letra');
    if (letter && duplicateLetters && duplicateLetters.has(letter)) issues.push('Letra duplicada');
    if (!envaseId) issues.push('Falta Envase');
    else if (!catalogHasId(envases, envaseId)) issues.push('Envase no encontrado');
    if (!tapaId) issues.push('Falta Tapa');
    else if (!catalogHasId(tapas, tapaId)) issues.push('Tapa no encontrada');
    return issues;
  }

  function productDataContractSnapshot(product){
    const p = product && typeof product === 'object' ? product : {};
    return {
      id: p.id,
      nombre: p.name || p.nombre || '',
      activo: p.active !== false,
      precio: round2(p.price),
      manejarInventario: p.manageStock !== false,
      costoReferencial: getUnitCost(p),
      capacidadMl: getCapacity(p),
      Receta: productHasRecipe(p),
      Letra: productLetter(p),
      POS: productPosEnabled(p),
      envaseId: productEnvaseId(p),
      tapaId: productTapaId(p)
    };
  }

  function catalogNameById(list, id, missingLabel){
    const key = String(id || '').trim();
    if (!key) return '';
    const row = (Array.isArray(list) ? list : []).find(x => x && String(x.id || '').trim() === key);
    return row ? String(row.name || row.nombre || '').trim() : (missingLabel || 'Eliminado');
  }

  function findCatalogIdByName(list, names, activeFn){
    const arr = Array.isArray(list) ? list : [];
    const wanted = (Array.isArray(names) ? names : [names]).map(normalizeEnvaseTapaLookupKey).filter(Boolean);
    for (const key of wanted){
      const row = arr.find(x => x && (!activeFn || activeFn(x)) && normalizeEnvaseTapaLookupKey(x.name || x.nombre || '') === key);
      if (row && row.id) return String(row.id).trim();
    }
    for (const key of wanted){
      const row = arr.find(x => x && normalizeEnvaseTapaLookupKey(x.name || x.nombre || '') === key);
      if (row && row.id) return String(row.id).trim();
    }
    return '';
  }

  function normalizeEnvaseTapaLookupKey(value){
    return normName(value).replace(/[^a-z0-9]+/g, '');
  }

  function productPackagingSuggestion(product, envases, tapas){
    const name = String((product && (product.name || product.nombre)) || '');
    const n = normName(name);
    const finishedId = mapProductNameToFinishedId(name);
    const out = { envaseId:'', tapaId:'' };

    if (n.includes('catrina') && (n.includes('jr') || n.includes('junior'))){
      out.envaseId = findCatalogIdByName(envases, ['Botella Catrina Jr.', 'Botella Catrina Junior'], envaseActive);
      out.tapaId = findCatalogIdByName(tapas, ['Corcho Catrina Jr.', 'Corcho Catrina Junior', 'Tapa Catrina Jr.', 'Tapa Catrina Junior', 'Corcho Catrina'], tapaActive);
      return out;
    }
    if (n.includes('catrina')){
      out.envaseId = findCatalogIdByName(envases, ['Botella Catrina'], envaseActive);
      out.tapaId = findCatalogIdByName(tapas, ['Corcho Catrina', 'Tapa Catrina'], tapaActive);
      return out;
    }

    const map = {
      pulso: { envase:['Botella Pulso'], tapa:['Tapa Pulso/Litro'] },
      media: { envase:['Botella Media'], tapa:['Tapa Djeba/Media'] },
      djeba: { envase:['Botella Djeba'], tapa:['Tapa Djeba/Media'] },
      litro: { envase:['Botella Litro'], tapa:['Tapa Pulso/Litro'] },
      galon: { envase:['Botella Galón', 'Botella Galon'], tapa:['Tapa Galón', 'Tapa Galon'] }
    };
    const cfg = map[finishedId || ''];
    if (cfg){
      out.envaseId = findCatalogIdByName(envases, cfg.envase, envaseActive);
      out.tapaId = findCatalogIdByName(tapas, cfg.tapa, tapaActive);
    }
    return out;
  }

  function catalogHasId(list, id){
    const key = String(id || '').trim();
    if (!key) return false;
    return (Array.isArray(list) ? list : []).some(x => x && String(x.id || '').trim() === key);
  }

  function applyProductPackagingDefaults(product, envases, tapas){
    if (!product || typeof product !== 'object') return false;
    const suggestion = productPackagingSuggestion(product, envases, tapas);
    let changed = false;

    const currentEnvase = productEnvaseId(product);
    if (currentEnvase && product.envaseId !== currentEnvase){ product.envaseId = currentEnvase; changed = true; }
    if ((!currentEnvase || !catalogHasId(envases, currentEnvase)) && suggestion.envaseId){
      product.envaseId = suggestion.envaseId;
      changed = true;
    } else if (!hasOwn(product, 'envaseId')){
      product.envaseId = '';
      changed = true;
    }

    const currentTapa = productTapaId(product);
    if (currentTapa && product.tapaId !== currentTapa){ product.tapaId = currentTapa; changed = true; }
    if ((!currentTapa || !catalogHasId(tapas, currentTapa)) && suggestion.tapaId){
      product.tapaId = suggestion.tapaId;
      changed = true;
    } else if (!hasOwn(product, 'tapaId')){
      product.tapaId = '';
      changed = true;
    }

    return changed;
  }

  async function normalizeProductPackagingFields(){
    ensureEnvasesDefaults(false);
    ensureTapasDefaults(false);
    const envases = readEnvaseCatalog();
    const tapas = readTapaCatalog();
    const products = await getAll('products');
    let changed = 0;
    const now = new Date().toISOString();
    for (const product of (products || [])){
      if (!product || typeof product !== 'object') continue;
      if (applyProductPackagingDefaults(product, envases, tapas)){
        if (!product.createdAt) product.createdAt = now;
        product.updatedAt = product.updatedAt || now;
        product.updatedFrom = product.updatedFrom || 'catalogos_productos_envase_tapa_migracion';
        await put('products', product);
        changed += 1;
      }
    }
    return changed;
  }

  function buildCatalogOptionsHtml(list, activeFn, selectedId, emptyLabel){
    const selected = String(selectedId || '').trim();
    const arr = (Array.isArray(list) ? list : []).slice().sort(sortMasterByActiveName);
    const activeRows = arr.filter(x => x && (!activeFn || activeFn(x)));
    const selectedRow = selected ? arr.find(x => x && String(x.id || '').trim() === selected) : null;
    const rows = activeRows.slice();
    if (selectedRow && !rows.some(x => String(x.id || '') === selected)) rows.push(selectedRow);
    const opts = [`<option value="">${escapeHtml(emptyLabel || 'Sin asignar')}</option>`];
    if (selected && !selectedRow){
      opts.push(`<option value="${escapeHtml(selected)}" selected>Eliminado (${escapeHtml(selected)})</option>`);
    }
    for (const row of rows){
      const id = String(row.id || '').trim();
      if (!id) continue;
      const isActive = !activeFn || activeFn(row);
      const label = String(row.name || row.nombre || id).trim() + (isActive ? '' : ' (inactivo)');
      opts.push(`<option value="${escapeHtml(id)}"${id === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`);
    }
    return opts.join('');
  }

  function populateProductPackagingSelects(prefix, selectedEnvaseId, selectedTapaId){
    const envaseSelect = byId(prefix + '-envase');
    const tapaSelect = byId(prefix + '-tapa');
    const envaseValue = String(selectedEnvaseId ?? envaseSelect?.value ?? '').trim();
    const tapaValue = String(selectedTapaId ?? tapaSelect?.value ?? '').trim();
    if (envaseSelect){
      const envases = ensureEnvasesDefaults(false);
      envaseSelect.innerHTML = buildCatalogOptionsHtml(envases, envaseActive, envaseValue, 'Sin envase');
      envaseSelect.value = envaseValue && Array.from(envaseSelect.options).some(o => o.value === envaseValue) ? envaseValue : '';
    }
    if (tapaSelect){
      const tapas = ensureTapasDefaults(false);
      tapaSelect.innerHTML = buildCatalogOptionsHtml(tapas, tapaActive, tapaValue, 'Sin tapa');
      tapaSelect.value = tapaValue && Array.from(tapaSelect.options).some(o => o.value === tapaValue) ? tapaValue : '';
    }
  }

  function refreshProductPackagingSelects(){
    populateProductPackagingSelects('cat-new');
    if (currentEditId) populateProductPackagingSelects('cat-edit');
  }

  function applyProductDynamicDefaults(product){
    if (!product || typeof product !== 'object') return false;
    const defaults = productDynamicDefaults(product);
    let changed = false;

    const receta = hasOwn(product, 'receta') ? boolFromCatalog(product.receta, defaults.receta) : defaults.receta;
    if (product.receta !== receta){ product.receta = receta; changed = true; }

    const pos = hasOwn(product, 'pos') ? boolFromCatalog(product.pos, defaults.pos) : defaults.pos;
    if (product.pos !== pos){ product.pos = pos; changed = true; }

    const currentLetter = productLetter(product);
    const nextLetter = currentLetter || (receta ? defaults.letra : '');
    if (product.letra !== nextLetter){ product.letra = nextLetter; changed = true; }

    return changed;
  }

  async function normalizeProductDynamicFields(){
    const products = await getAll('products');
    let changed = 0;
    const now = new Date().toISOString();
    for (const product of (products || [])){
      if (!product || typeof product !== 'object') continue;
      if (applyProductDynamicDefaults(product)){
        if (!product.createdAt) product.createdAt = now;
        product.updatedAt = product.updatedAt || now;
        product.updatedFrom = product.updatedFrom || 'catalogos_productos_dinamicos_migracion';
        await put('products', product);
        changed += 1;
      }
    }
    return changed;
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

  function getDirectProductCapacity(product){
    const p = product && typeof product === 'object' ? product : {};
    const candidates = [p.capacityMl, p.capacidadMl, p.volumeMl, p.volumenMl, p.ml, p.mililitros, p.sizeMl, p.capacidad];
    for (const candidate of candidates){
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) return qty(value, 0);
    }
    return 0;
  }

  function costsProductDisplayName(product){
    const p = product && typeof product === 'object' ? product : {};
    const raw = String(p.name || p.nombre || 'Producto sin nombre').replace(/\s+/g, ' ').trim();
    const withoutTrailingMl = raw.replace(/\s*[-–—]?\s*\d+(?:[.,]\d+)?\s*ml\s*$/i, '').trim();
    return withoutTrailingMl || raw;
  }

  function resolveCostsProductVolume(product, envases){
    const p = product && typeof product === 'object' ? product : {};

    // Regla comercial vigente de Suite A33: la presentación Galón es de 3720 ml.
    if (mapProductNameToFinishedId(p.name || p.nombre || '') === 'galon') return 3720;

    const direct = getDirectProductCapacity(p);
    if (direct > 0) return direct;

    const envaseId = productEnvaseId(p);
    if (envaseId){
      const envase = findCatalogById(envases, envaseId);
      const linkedCapacity = envaseCapacity(envase);
      if (linkedCapacity > 0) return linkedCapacity;
    }

    // Compatibilidad con productos antiguos cuyo volumen solo estaba escrito en el nombre.
    return getCapacity(p);
  }

  function activeRecipeProductsForCosts(products){
    return (Array.isArray(products) ? products : [])
      .filter((product) => product && product.active !== false && productHasRecipe(product))
      .slice()
      .sort(sortProducts);
  }

  function costsNormalizeRecipeToken(value){
    return normName(value).replace(/[^a-z0-9]+/g, '');
  }

  function costsCalculatorPresentationId(product){
    const p = product && typeof product === 'object' ? product : {};
    const legacyId = mapProductNameToFinishedId(p.name || p.nombre || '');
    if (legacyId) return legacyId;
    const raw = p.id ?? p.productId ?? p.codigo ?? p.name ?? p.nombre ?? 'producto';
    const safe = normName(raw).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return 'prod_' + (safe || 'nuevo').slice(0, 48);
  }

  function costsReadStoredText(key){
    try{
      if (window.A33Storage && typeof window.A33Storage.getItem === 'function'){
        return window.A33Storage.getItem(key, 'local');
      }
    }catch(_){ }
    try{ return localStorage.getItem(key); }catch(_){ return null; }
  }

  function readCostsRecipesSnapshot(){
    const stored = costsReadStoredText(COSTS_RECIPES_KEY);
    if (!stored) return { ok:false, reason:'missing', raw:null, recipes:{}, products:[], costs:{} };

    let raw = null;
    try{
      const parsedStored = JSON.parse(stored);
      if (window.A33Storage && typeof window.A33Storage.sharedGet === 'function'){
        raw = window.A33Storage.sharedGet(COSTS_RECIPES_KEY, parsedStored, 'local');
      } else {
        raw = parsedStored;
      }
    }catch(err){
      try{ console.warn('[Suite A33] No se pudieron leer las recetas para Costos.', err); }catch(_){ }
      return { ok:false, reason:'invalid', raw:null, recipes:{}, products:[], costs:{} };
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)){
      return { ok:false, reason:'invalid', raw:null, recipes:{}, products:[], costs:{} };
    }

    const recipes = raw.recetas && typeof raw.recetas === 'object' && !Array.isArray(raw.recetas)
      ? raw.recetas
      : raw;
    const products = Array.isArray(raw.productos) ? raw.productos.filter(Boolean) : [];
    const costs = raw.costosPresentacion && typeof raw.costosPresentacion === 'object' && !Array.isArray(raw.costosPresentacion)
      ? raw.costosPresentacion
      : {};
    return { ok:true, reason:'', raw, recipes, products, costs };
  }

  function costsRecipeMetadataRows(snapshot){
    const rows = [];
    if (snapshot && Array.isArray(snapshot.products)) rows.push(...snapshot.products);
    if (snapshot && snapshot.costs && typeof snapshot.costs === 'object'){
      Object.keys(snapshot.costs).forEach((key) => {
        const row = snapshot.costs[key];
        if (!row || typeof row !== 'object') return;
        rows.push({ ...row, id:row.id ?? key });
      });
    }
    return rows;
  }

  function costsResolveRecipe(product, snapshot){
    const recipes = snapshot && snapshot.recipes && typeof snapshot.recipes === 'object' ? snapshot.recipes : {};
    const productId = String(product ? (product.id ?? product.productId ?? '') : '').trim();
    const productName = String(product && (product.name || product.nombre) || '').trim();
    const candidates = [];
    const pushCandidate = (value) => {
      const key = String(value ?? '').trim();
      if (key && !candidates.includes(key)) candidates.push(key);
    };

    const metadata = costsRecipeMetadataRows(snapshot);
    metadata.forEach((row) => {
      const rowProductId = String(row ? (row.productId ?? row.productoId ?? row.sourceProductId ?? '') : '').trim();
      if (productId && rowProductId === productId) pushCandidate(row && (row.id ?? row.recipeId ?? row.recetaId));
    });

    pushCandidate(costsCalculatorPresentationId(product));
    pushCandidate(mapProductNameToFinishedId(productName));
    pushCandidate(productId);

    metadata.forEach((row) => {
      const rowName = String(row && (row.nombre || row.name || row.productName) || '').trim();
      if (productName && rowName && normKey(rowName) === normKey(productName)) pushCandidate(row && (row.id ?? row.recipeId ?? row.recetaId));
    });

    for (const key of candidates){
      const recipe = recipes[key];
      if (recipe && typeof recipe === 'object' && !Array.isArray(recipe)){
        return { ok:true, key, recipe };
      }
    }

    return { ok:false, key:candidates[0] || '', recipe:null };
  }

  function costsRecipeIngredientMl(recipe, costKey){
    const source = recipe && typeof recipe === 'object' && !Array.isArray(recipe) ? recipe : null;
    if (!source) return { ok:false, found:false, value:0, sourceKey:'' };
    const aliases = (COSTS_RECIPE_ALIASES[costKey] || [costKey]).map(costsNormalizeRecipeToken);
    let matchKey = '';

    for (const key of Object.keys(source)){
      const normalized = costsNormalizeRecipeToken(key);
      if (aliases.includes(normalized)){
        matchKey = key;
        break;
      }
    }

    if (!matchKey) return { ok:true, found:false, value:0, sourceKey:'' };
    const raw = source[matchKey];
    if (raw === null || raw === undefined || raw === '') return { ok:true, found:true, value:0, sourceKey:matchKey };
    const value = Number(String(raw).trim().replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) return { ok:false, found:true, value:0, sourceKey:matchKey };
    return { ok:true, found:true, value, sourceKey:matchKey };
  }

  function costsDraftCatalogFromForm(){
    const catalog = emptyCostsCatalog();
    COSTS_LIQUIDS.forEach((item) => {
      const priceInput = qs(`[data-cost-key="${item.key}"][data-cost-field="price"]`);
      const mlInput = qs(`[data-cost-key="${item.key}"][data-cost-field="ml"]`);
      const priceRaw = String(priceInput && priceInput.value != null ? priceInput.value : '').trim().replace(',', '.');
      const mlRaw = String(mlInput && mlInput.value != null ? mlInput.value : '').trim().replace(',', '.');
      const price = priceRaw === '' ? null : Number(priceRaw);
      const ml = mlRaw === '' ? null : Number(mlRaw);
      catalog.liquids[item.key] = {
        price:Number.isFinite(price) && price >= 0 ? price : null,
        ml:Number.isFinite(ml) && ml >= 0 ? ml : null,
        invalidPrice:priceRaw !== '' && (!Number.isFinite(price) || price < 0),
        invalidMl:mlRaw !== '' && (!Number.isFinite(ml) || ml < 0 || (priceRaw !== '' && ml === 0))
      };
    });
    qsa('[data-cost-consumable]').forEach((input) => {
      const productId = String(input.dataset.productId || '').trim();
      const key = String(input.dataset.consumableKey || '').trim();
      if (!productId || !COSTS_CONSUMABLES.some((item) => item.key === key)) return;
      const raw = String(input.value == null ? '' : input.value).trim().replace(',', '.');
      const value = raw === '' ? null : Number(raw);
      if (!catalog.consumables[productId]) catalog.consumables[productId] = {};
      catalog.consumables[productId][key] = Number.isFinite(value) && value >= 0 ? value : null;
      catalog.consumables[productId]['invalid' + key.charAt(0).toUpperCase() + key.slice(1)] = raw !== '' && (!Number.isFinite(value) || value < 0);
    });
    return catalog;
  }

  function formatCostsMoney(value){
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return '';
    const safe = Object.is(number, -0) ? 0 : number;
    try{
      return 'C$' + safe.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
    }catch(_){ return 'C$' + safe.toFixed(2); }
  }

  function formatCostsNumber(value, decimals){
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return number.toLocaleString('en-US', { minimumFractionDigits:decimals, maximumFractionDigits:decimals });
  }

  function setCostsRecipeStatus(message, kind){
    const el = byId('cat-costs-recipe-status');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-costs-recipe-status' + (kind ? (' ' + kind) : '');
  }

  function renderCostsCellState(cell, state, text, title){
    if (!cell) return;
    const safeText = text || '—';
    const safeTitle = title || safeText;
    cell.classList.toggle('is-pending', state === 'pending');
    cell.classList.toggle('is-warning', state === 'warning');
    cell.classList.toggle('is-calculated', state === 'calculated');
    cell.title = safeTitle;
    cell.setAttribute('aria-label', safeTitle);
    cell.innerHTML = `<span class="cat-costs-cell-value ${state ? ('is-' + state) : ''}">${escapeHtml(safeText)}</span>`;
  }

  function costsConsumableInput(productId, key){
    const targetId = String(productId || '').trim();
    const targetKey = String(key || '').trim();
    return qsa('[data-cost-consumable]').find((input) =>
      String(input.dataset.productId || '').trim() === targetId &&
      String(input.dataset.consumableKey || '').trim() === targetKey
    ) || null;
  }

  function costsConsumableState(catalog, productId, key){
    const row = catalog && catalog.consumables && catalog.consumables[productId] ? catalog.consumables[productId] : {};
    const invalidKey = 'invalid' + key.charAt(0).toUpperCase() + key.slice(1);
    const value = row[key];
    if (row[invalidKey]) return { ok:false, complete:false, value:0, state:'warning' };
    if (value === null || value === undefined || value === '') return { ok:true, complete:false, value:0, state:'pending' };
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return { ok:false, complete:false, value:0, state:'warning' };
    return { ok:true, complete:true, value:number, state:'calculated' };
  }

  function setCostsConsumableInputState(input, state, label){
    if (!input) return;
    const warning = state === 'warning';
    input.classList.toggle('is-invalid', warning);
    input.setAttribute('aria-invalid', warning ? 'true' : 'false');
    input.title = warning ? `${label} debe ser un número válido y no negativo.` : `${label} por producto.`;
  }

  function updateCostsSummary(totalProducts, completeProducts){
    const total = Math.max(0, Number(totalProducts) || 0);
    const complete = Math.max(0, Math.min(total, Number(completeProducts) || 0));
    const pending = Math.max(0, total - complete);
    const totalEl = byId('cat-costs-summary-products');
    const completeEl = byId('cat-costs-summary-complete');
    const pendingEl = byId('cat-costs-summary-pending');
    if (totalEl) totalEl.textContent = String(total);
    if (completeEl) completeEl.textContent = String(complete);
    if (pendingEl) pendingEl.textContent = String(pending);
  }

  function recalculateCostsCells(){
    const table = byId('cat-costs-table');
    if (!table) return;
    const catalog = costsDraftCatalogFromForm();
    const snapshot = readCostsRecipesSnapshot();
    let missingRecipes = 0;
    let invalidRecipes = 0;
    let calculatedCells = 0;
    let completeProducts = 0;

    for (const product of currentCostsProducts){
      const productId = String(product ? (product.id ?? '') : '').trim();
      if (!productId) continue;
      const resolved = snapshot.ok ? costsResolveRecipe(product, snapshot) : { ok:false, key:'', recipe:null };
      if (!resolved.ok) missingRecipes += 1;
      let productTotal = 0;
      let productComplete = true;

      for (const item of COSTS_LIQUIDS){
        const costRow = qs(`tbody tr[data-cost-row="${item.key}"]`, table);
        const cell = costRow ? qsa('td[data-product-id]', costRow).find((node) => String(node.dataset.productId || '') === productId) : null;
        if (!cell) continue;
        const row = catalog.liquids[item.key] || {};
        const priceInput = qs(`[data-cost-key="${item.key}"][data-cost-field="price"]`);
        const mlInput = qs(`[data-cost-key="${item.key}"][data-cost-field="ml"]`);
        if (priceInput){
          priceInput.classList.toggle('is-invalid', !!row.invalidPrice);
          priceInput.setAttribute('aria-invalid', row.invalidPrice ? 'true' : 'false');
        }
        if (mlInput){
          mlInput.classList.toggle('is-invalid', !!row.invalidMl);
          mlInput.setAttribute('aria-invalid', row.invalidMl ? 'true' : 'false');
        }

        if (row.invalidPrice || row.invalidMl){
          const reason = row.invalidMl ? `ML de ${item.label} debe ser mayor que cero cuando existe Precio.` : `Precio de ${item.label} no es válido.`;
          renderCostsCellState(cell, 'warning', 'Revisar', reason);
          productComplete = false;
          continue;
        }
        if (row.price === null || row.ml === null || row.ml <= 0){
          const missing = row.price === null && (row.ml === null || row.ml <= 0) ? 'Precio y ML pendientes' : (row.price === null ? 'Precio pendiente' : 'ML pendiente');
          renderCostsCellState(cell, 'pending', 'Pendiente', `${item.label}: ${missing}.`);
          productComplete = false;
          continue;
        }
        if (!snapshot.ok || !resolved.ok){
          renderCostsCellState(cell, 'warning', 'Sin receta', `No se pudo leer la receta vigente de ${costsProductDisplayName(product)}.`);
          productComplete = false;
          continue;
        }

        const ingredient = costsRecipeIngredientMl(resolved.recipe, item.key);
        if (!ingredient.ok){
          invalidRecipes += 1;
          renderCostsCellState(cell, 'warning', 'Revisar receta', `${item.label}: el valor guardado en la receta de ${costsProductDisplayName(product)} no es válido.`);
          productComplete = false;
          continue;
        }

        const costPerMl = row.price / row.ml;
        const result = costPerMl * ingredient.value;
        if (!Number.isFinite(costPerMl) || !Number.isFinite(result) || result < 0){
          renderCostsCellState(cell, 'warning', 'Revisar', `${item.label}: no se pudo calcular un valor válido.`);
          productComplete = false;
          continue;
        }
        const visible = formatCostsMoney(result);
        const detail = `${item.label} · Precio de compra: ${formatCostsMoney(row.price)} · ML comprados: ${formatCostsNumber(row.ml, 2)} ml · Costo por ml: C$${formatCostsNumber(costPerMl, 6)} · ML usados en la receta: ${formatCostsNumber(ingredient.value, 2)} ml · Resultado: ${visible}`;
        renderCostsCellState(cell, 'calculated', visible, detail);
        productTotal += result;
        calculatedCells += 1;
      }

      for (const item of COSTS_CONSUMABLES){
        const input = costsConsumableInput(productId, item.key);
        const state = costsConsumableState(catalog, productId, item.key);
        setCostsConsumableInputState(input, state.state, item.label);
        if (!state.ok || !state.complete) productComplete = false;
        else productTotal += state.value;
      }

      const totalRow = qs('tbody tr[data-cost-row="total"]', table);
      const totalCell = totalRow ? qsa('td[data-product-id]', totalRow).find((node) => String(node.dataset.productId || '') === productId) : null;
      if (totalCell){
        if (productComplete && Number.isFinite(productTotal) && productTotal >= 0){
          const visible = formatCostsMoney(productTotal);
          renderCostsCellState(totalCell, 'calculated', visible, `Total de ${costsProductDisplayName(product)}: ${visible}. Incluye líquidos, Botella y Calcomanía.`);
          completeProducts += 1;
        } else {
          const subtotal = Number.isFinite(productTotal) && productTotal > 0 ? formatCostsMoney(productTotal) : '';
          renderCostsCellState(totalCell, 'pending', 'Pendiente', subtotal ? `Falta información. Subtotal disponible: ${subtotal}.` : 'Falta información para calcular el Total completo.');
        }
      }
    }

    updateCostsSummary(currentCostsProducts.length, completeProducts);
    if (!currentCostsProducts.length){
      setCostsRecipeStatus('No hay productos activos con Receta disponibles para calcular.', 'muted');
    } else if (!snapshot.ok){
      setCostsRecipeStatus('Recetas no disponibles. Guarda primero las recetas en Calculadora de Producción.', 'warn');
    } else if (missingRecipes || invalidRecipes){
      const parts = [];
      if (missingRecipes) parts.push(`${missingRecipes} producto(s) sin receta legible`);
      if (invalidRecipes) parts.push(`${invalidRecipes} valor(es) de receta por revisar`);
      setCostsRecipeStatus(`${parts.join(' · ')}. La tabla continúa operativa.`, 'warn');
    } else {
      setCostsRecipeStatus(`Recetas vigentes leídas correctamente · ${calculatedCells} costo(s) líquido(s) actualizado(s).`, 'ok');
    }
  }

  function scheduleCostsRefresh(options){
    const opts = options || {};
    clearTimeout(costsRefreshTimer);
    costsRefreshTimer = setTimeout(() => {
      const panel = byId('panel-costos');
      if (panel && panel.hidden && !opts.force) return;
      const task = opts.rebuild ? renderCostsProductColumns() : Promise.resolve(recalculateCostsCells());
      Promise.resolve(task).catch((err) => {
        try{ console.warn('[Suite A33] No se pudieron refrescar los cálculos de Costos.', err); }catch(_){ }
        setCostsRecipeStatus('No se pudieron actualizar los cálculos. La tabla permanece disponible.', 'warn');
      });
    }, opts.immediate ? 0 : 120);
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
      if (normName(name).includes('3720')) score += 40;
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
      let result = [];
      let settled = false;
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      const fail = (error)=>{
        if (settled) return;
        settled = true;
        reject(error || req.error || tx.error || new Error('No se pudo cargar el catálogo.'));
      };
      req.onsuccess = ()=>{ result = Array.isArray(req.result) ? req.result : []; };
      req.onerror = ()=>fail(req.error);
      tx.oncomplete = ()=>{
        if (settled) return;
        settled = true;
        resolve(result);
      };
      tx.onerror = ()=>fail(tx.error);
      tx.onabort = ()=>fail(tx.error || new Error('La lectura del catálogo fue cancelada.'));
    });
  }

  async function put(store, value){
    if (!db) await openDB();
    if (!db.objectStoreNames.contains(store)) throw new Error(`No existe el almacén ${store}.`);
    return new Promise((resolve, reject)=>{
      let result;
      let settled = false;
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(value);
      const fail = (error)=>{
        if (settled) return;
        settled = true;
        reject(error || req.error || tx.error || new Error('No se pudo guardar el registro.'));
      };
      req.onsuccess = ()=>{ result = req.result; };
      req.onerror = ()=>fail(req.error);
      tx.oncomplete = ()=>{
        if (settled) return;
        settled = true;
        resolve(result);
      };
      tx.onerror = ()=>fail(tx.error);
      tx.onabort = ()=>fail(tx.error || new Error('La escritura del catálogo fue cancelada.'));
    });
  }

  async function deleteRecord(store, key){
    if (!db) await openDB();
    if (!db.objectStoreNames.contains(store)) return false;
    return new Promise((resolve, reject)=>{
      let settled = false;
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(key);
      const fail = (error)=>{
        if (settled) return;
        settled = true;
        reject(error || req.error || tx.error || new Error('No se pudo borrar el registro.'));
      };
      req.onerror = ()=>fail(req.error);
      tx.oncomplete = ()=>{
        if (settled) return;
        settled = true;
        resolve(true);
      };
      tx.onerror = ()=>fail(tx.error);
      tx.onabort = ()=>fail(tx.error || new Error('El borrado del catálogo fue cancelado.'));
    });
  }

  function readCatalogDeletedKeys(kind){
    const storageKey = CATALOG_DELETED_KEYS[kind];
    if (!storageKey) return new Set();
    try{
      const raw = localStorage.getItem(storageKey);
      const arr = JSON.parse(raw || '[]');
      return new Set((Array.isArray(arr) ? arr : []).map(v => String(v || '').trim()).filter(Boolean));
    }catch(_){ return new Set(); }
  }

  function writeCatalogDeletedKeys(kind, keys){
    const storageKey = CATALOG_DELETED_KEYS[kind];
    if (!storageKey) return false;
    try{
      const arr = Array.from(keys || []).map(v => String(v || '').trim()).filter(Boolean).sort();
      localStorage.setItem(storageKey, JSON.stringify(arr));
      return true;
    }catch(_){ return false; }
  }

  function catalogDeletedKey(kind, row){
    const r = row && typeof row === 'object' ? row : {};
    if (kind === 'banks') return `${normBankName(r.name || '')}::${normalizeBankType(r.type || r.bankType || 'transferencia')}`;
    return normKey(r.name || r.nombre || '');
  }

  function rememberCatalogDeleted(kind, row){
    const keys = readCatalogDeletedKeys(kind);
    const main = catalogDeletedKey(kind, row);
    if (main) keys.add(main);
    if (kind === 'products' && mapProductNameToFinishedId(row && row.name) === 'galon') keys.add(normKey(CANON_GALON_LABEL));
    writeCatalogDeletedKeys(kind, keys);
  }

  function clearCatalogDeleted(kind){
    const storageKey = CATALOG_DELETED_KEYS[kind];
    if (!storageKey) return;
    try{ localStorage.removeItem(storageKey); }catch(_){ }
  }

  function findCatalogById(list, id){
    const target = String(id ?? '').trim();
    return (Array.isArray(list) ? list : []).find(row => row && String(row.id ?? '').trim() === target) || null;
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

  function emptyCostsCatalog(){
    const liquids = {};
    COSTS_LIQUIDS.forEach((item) => { liquids[item.key] = { price:null, ml:null }; });
    return { schemaVersion:COSTS_SCHEMA_VERSION, updatedAt:null, liquids, consumables:{} };
  }

  function optionalStoredCostNumber(value, allowZero){
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    if (!allowZero && number === 0) return null;
    return number;
  }

  function normalizeStoredConsumables(raw){
    const out = {};
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    Object.keys(source).forEach((rawId) => {
      const productId = String(rawId || '').trim();
      const row = source[rawId];
      if (!productId || !row || typeof row !== 'object' || Array.isArray(row)) return;
      out[productId] = {
        botella:optionalStoredCostNumber(row.botella ?? row.bottle, true),
        calcomania:optionalStoredCostNumber(row.calcomania ?? row.calcomanía ?? row.label ?? row.sticker, true)
      };
    });
    return out;
  }

  function readCostsCatalog(){
    const fallback = emptyCostsCatalog();
    let raw = null;
    try{
      if (window.A33Storage && typeof window.A33Storage.getJSON === 'function'){
        raw = window.A33Storage.getJSON(COSTS_CATALOG_KEY, null, 'local');
      } else {
        const saved = localStorage.getItem(COSTS_CATALOG_KEY);
        raw = saved ? JSON.parse(saved) : null;
      }
    }catch(err){
      try{ console.warn('[Suite A33] No se pudo leer Catálogos → Costos.', err); }catch(_){ }
      return fallback;
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
    const source = (raw.liquids && typeof raw.liquids === 'object' && !Array.isArray(raw.liquids)) ? raw.liquids : raw;
    const out = emptyCostsCatalog();
    out.updatedAt = raw.updatedAt ? String(raw.updatedAt) : null;
    COSTS_LIQUIDS.forEach((item) => {
      const row = source[item.key] && typeof source[item.key] === 'object' ? source[item.key] : {};
      out.liquids[item.key] = {
        price:optionalStoredCostNumber(row.price ?? row.precio, true),
        ml:optionalStoredCostNumber(row.ml ?? row.mililitros, true)
      };
    });
    out.consumables = normalizeStoredConsumables(raw.consumables || raw.consumibles || raw.productCosts || raw.costosProductos);
    return out;
  }

  function writeCostsCatalog(data){
    try{
      if (window.A33Storage && typeof window.A33Storage.setJSON === 'function'){
        const ok = window.A33Storage.setJSON(COSTS_CATALOG_KEY, data, 'local');
        if (ok) return true;
      }
      localStorage.setItem(COSTS_CATALOG_KEY, JSON.stringify(data));
      return true;
    }catch(err){
      try{ console.error('[Suite A33] No se pudo guardar Catálogos → Costos.', err); }catch(_){ }
      return false;
    }
  }

  function setCostsStatus(message, kind){
    const el = byId('cat-costs-status');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-status cat-costs-status' + (kind ? (' ' + kind) : '');
  }

  function formatCostsSavedAt(value){
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    try{
      return new Intl.DateTimeFormat('es-NI', {
        day:'2-digit', month:'2-digit', year:'numeric',
        hour:'2-digit', minute:'2-digit', hour12:false
      }).format(date).replace(',', '');
    }catch(_){
      return date.toLocaleString();
    }
  }

  function fillCostsForm(data){
    const catalog = data && typeof data === 'object' ? data : emptyCostsCatalog();
    COSTS_LIQUIDS.forEach((item) => {
      const row = catalog.liquids && catalog.liquids[item.key] ? catalog.liquids[item.key] : {};
      const price = qs(`[data-cost-key="${item.key}"][data-cost-field="price"]`);
      const ml = qs(`[data-cost-key="${item.key}"][data-cost-field="ml"]`);
      if (price) price.value = row.price === null || row.price === undefined ? '' : String(row.price);
      if (ml) ml.value = row.ml === null || row.ml === undefined ? '' : String(row.ml);
    });
    qsa('[data-cost-consumable]').forEach((input) => {
      const productId = String(input.dataset.productId || '').trim();
      const key = String(input.dataset.consumableKey || '').trim();
      const row = catalog.consumables && catalog.consumables[productId] ? catalog.consumables[productId] : {};
      const value = row[key];
      input.value = value === null || value === undefined ? '' : String(value);
    });
  }

  function readOptionalCostInput(input, label, field, options){
    const opts = options || {};
    const raw = String(input && input.value != null ? input.value : '').trim().replace(',', '.');
    if (!raw) return { ok:true, value:null };
    const value = Number(raw);
    if (!Number.isFinite(value)) return { ok:false, message:`${field} de ${label} debe ser un número válido.` };
    if (value < 0) return { ok:false, message:`${field} de ${label} no puede ser negativo.` };
    if (opts.disallowZero && value === 0) return { ok:false, message:`${field} de ${label} debe ser mayor que cero.` };
    return { ok:true, value };
  }

  function collectCostsForm(){
    const existing = readCostsCatalog();
    const catalog = emptyCostsCatalog();
    catalog.consumables = normalizeStoredConsumables(existing.consumables);
    for (const item of COSTS_LIQUIDS){
      const priceInput = qs(`[data-cost-key="${item.key}"][data-cost-field="price"]`);
      const mlInput = qs(`[data-cost-key="${item.key}"][data-cost-field="ml"]`);
      const price = readOptionalCostInput(priceInput, item.label, 'Precio');
      if (!price.ok) return { ok:false, message:price.message, input:priceInput };
      const ml = readOptionalCostInput(mlInput, item.label, 'ML');
      if (!ml.ok) return { ok:false, message:ml.message, input:mlInput };
      if (price.value !== null && ml.value === 0){
        return { ok:false, message:`ML de ${item.label} debe ser mayor que cero cuando existe Precio.`, input:mlInput };
      }
      catalog.liquids[item.key] = { price:price.value, ml:ml.value };
    }
    for (const product of currentCostsProducts){
      const productId = String(product && product.id != null ? product.id : '').trim();
      if (!productId) continue;
      const row = catalog.consumables[productId] && typeof catalog.consumables[productId] === 'object' ? { ...catalog.consumables[productId] } : {};
      for (const item of COSTS_CONSUMABLES){
        const input = costsConsumableInput(productId, item.key);
        const value = readOptionalCostInput(input, `${item.label} de ${costsProductDisplayName(product)}`, 'Costo');
        if (!value.ok) return { ok:false, message:value.message, input };
        row[item.key] = value.value;
      }
      catalog.consumables[productId] = row;
    }
    catalog.updatedAt = new Date().toISOString();
    return { ok:true, catalog };
  }

  async function renderCostsProductColumns(products){
    const table = byId('cat-costs-table');
    const headRow = byId('cat-costs-head-row');
    if (!table || !headRow) return [];

    const renderToken = ++costsRenderToken;
    const source = Array.isArray(products) ? products : await getAll('products');
    if (renderToken !== costsRenderToken) return currentCostsProducts.slice();

    qsa('[data-cost-product-column]', table).forEach((node) => node.remove());

    const envases = ensureEnvasesDefaults(false);
    const list = activeRecipeProductsForCosts(source);
    currentCostsProducts = list.slice();
    const rows = qsa('tbody tr[data-cost-row]', table);
    const catalog = readCostsCatalog();

    for (const product of list){
      const productId = String(product.id ?? '').trim();
      if (!productId) continue;

      const volume = resolveCostsProductVolume(product, envases);
      const displayName = costsProductDisplayName(product);
      const volumeText = volume > 0 ? displayMl(volume) : 'ML no definido';

      const th = document.createElement('th');
      th.scope = 'col';
      th.className = 'cat-costs-product-head';
      th.dataset.costProductColumn = '1';
      th.dataset.productId = productId;
      th.innerHTML = `
        <span class="cat-costs-product-name">${escapeHtml(displayName)}</span>
        <small class="cat-costs-product-volume${volume > 0 ? '' : ' is-missing'}">${escapeHtml(volumeText)}</small>
      `;
      headRow.appendChild(th);

      for (const row of rows){
        const td = document.createElement('td');
        const rowKey = String(row.dataset.costRow || '');
        td.className = 'cat-costs-product-cell';
        td.dataset.costProductColumn = '1';
        td.dataset.productId = productId;
        if (COSTS_LIQUIDS.some((item) => item.key === rowKey)){
          td.innerHTML = '<span class="cat-costs-cell-value is-pending">Pendiente</span>';
        } else if (COSTS_CONSUMABLES.some((item) => item.key === rowKey)){
          const item = COSTS_CONSUMABLES.find((entry) => entry.key === rowKey);
          const savedRow = catalog.consumables && catalog.consumables[productId] ? catalog.consumables[productId] : {};
          const savedValue = savedRow[rowKey];
          td.classList.add('is-consumable');
          td.innerHTML = `<input class="cat-costs-consumable-input" data-cost-consumable="1" data-product-id="${escapeHtml(productId)}" data-consumable-key="${escapeHtml(rowKey)}" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Vacío" value="${savedValue === null || savedValue === undefined ? '' : escapeHtml(String(savedValue))}" aria-label="Costo de ${escapeHtml(item.label)} para ${escapeHtml(displayName)}">`;
        } else if (rowKey === 'total'){
          td.classList.add('is-total');
          td.innerHTML = '<span class="cat-costs-cell-value is-pending">Pendiente</span>';
        } else {
          td.innerHTML = '<span class="cat-costs-na">—</span>';
        }
        row.appendChild(td);
      }
    }

    const renderedCount = qsa('thead [data-cost-product-column]', table).length;
    table.dataset.dynamicProductCount = String(renderedCount);
    table.style.setProperty('--cat-costs-dynamic-count', String(renderedCount));

    const status = byId('cat-costs-columns-status');
    if (status){
      status.textContent = renderedCount
        ? `${renderedCount} producto(s) activo(s) con Receta mostrados como columnas.`
        : 'No hay productos activos con Receta disponibles para calcular.';
      status.classList.toggle('is-empty', renderedCount === 0);
    }
    const empty = byId('cat-costs-empty');
    const wrap = byId('cat-costs-table-wrap');
    if (empty) empty.hidden = renderedCount !== 0;
    if (wrap) wrap.hidden = renderedCount === 0;

    recalculateCostsCells();
    return list;
  }

  async function initCosts(){
    const catalog = readCostsCatalog();
    fillCostsForm(catalog);
    await renderCostsProductColumns();
    const savedAt = formatCostsSavedAt(catalog.updatedAt);
    setCostsStatus(savedAt ? `Configuración cargada. Última actualización: ${savedAt}.` : 'Configuración inicial lista. Los campos pueden quedar vacíos.', 'ok');
  }

  function bindCostsUi(){
    qsa('[data-cost-field]').forEach((input) => {
      input.addEventListener('input', () => recalculateCostsCells());
      input.addEventListener('change', () => recalculateCostsCells());
      input.addEventListener('focus', () => { try{ input.select(); }catch(_){ } });
    });

    const table = byId('cat-costs-table');
    if (table){
      table.addEventListener('input', (event) => {
        if (event.target && event.target.matches('[data-cost-consumable]')) recalculateCostsCells();
      });
      table.addEventListener('change', (event) => {
        if (event.target && event.target.matches('[data-cost-consumable]')) recalculateCostsCells();
      });
      table.addEventListener('focusin', (event) => {
        const input = event.target && event.target.matches('input[type="number"]') ? event.target : null;
        if (!input) return;
        setTimeout(() => { try{ input.select(); }catch(_){ } }, 0);
      });
    }

    byId('cat-save-costs')?.addEventListener('click', () => {
      const result = collectCostsForm();
      if (!result.ok){
        setCostsStatus(`Hay campos inválidos. ${result.message}`, 'warn');
        recalculateCostsCells();
        try{ result.input?.focus({ preventScroll:false }); result.input?.select(); }catch(_){ }
        return;
      }
      if (!writeCostsCatalog(result.catalog)){
        setCostsStatus('No se pudo guardar. Revisa el almacenamiento disponible e intenta de nuevo.', 'warn');
        return;
      }
      fillCostsForm(result.catalog);
      recalculateCostsCells();
      const savedAt = formatCostsSavedAt(result.catalog.updatedAt);
      setCostsStatus(`Guardado correcto${savedAt ? `. Última actualización: ${savedAt}.` : '.'}`, 'ok');
      toast('Costos guardados correctamente');
    });

    window.addEventListener('storage', (event) => {
      const key = String(event && event.key || '');
      if (!key || key === COSTS_RECIPES_KEY || key.startsWith(COSTS_RECIPES_KEY + '__') || key === COSTS_CATALOG_KEY || key === ENVASES_CATALOG_KEY){
        if (key === COSTS_CATALOG_KEY) fillCostsForm(readCostsCatalog());
        scheduleCostsRefresh({ rebuild:key !== COSTS_CATALOG_KEY });
      }
    });
    window.addEventListener('focus', () => scheduleCostsRefresh({ rebuild:true }));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleCostsRefresh({ rebuild:true });
    });
  }

  function warnCatalogDeleteError(context, err){
    try{ console.warn('[Suite A33] No se pudo completar borrado en Catálogos:', context, err); }catch(_){ }
    toast('No se pudo borrar. Actualiza e intenta de nuevo.');
  }

  function setEditMsg(message, kind){
    const el = byId('cat-edit-msg');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-muted cat-edit-msg' + (kind ? (' ' + kind) : '');
  }

  async function seedMissingDefaults(force){
    // Defensa crítica: los productos base solo pueden restaurarse por una acción explícita del usuario.
    if (force !== true) return { added:0, skipped:SEED.length };

    const list = await getAll('products');
    const now = new Date().toISOString();
    let added = 0;
    let skipped = 0;

    for (const seed of SEED){
      const seedKey = normKey(seed.name);
      const seedGroup = mapProductNameToFinishedId(seed.name || '');
      const existing = (list || []).find((product) => {
        if (!product) return false;
        if (normKey(product.name || '') === seedKey) return true;
        const existingGroup = mapProductNameToFinishedId(product.name || '');
        return !!(seedGroup && existingGroup && seedGroup === existingGroup);
      });
      if (existing){
        skipped += 1;
        continue;
      }
      await put('products', {
        ...seed,
        createdAt:now,
        updatedAt:now,
        updatedFrom:'catalogos_productos_restauracion_manual'
      });
      list.push({ ...seed });
      added += 1;
    }

    return { added, skipped };
  }

  async function normalizeLegacyGallon(){
    const products = await getAll('products');
    const galons = (products || []).filter(p => p && mapProductNameToFinishedId(p.name || '') === 'galon');
    if (!galons.length) return;
    let canon = canonicalProductsForSale(galons)[0] || galons[0];
    if (!canon) return;
    // Cierre Parte 1: conservar nombre y precio existentes si son válidos.
    let preservedPrice = isValidPrice(canon.price) ? Number(canon.price) : DEFAULT_GALON_PRICE;

    let changedCanon = false;
    if (!isValidPrice(canon.price)){ canon.price = preservedPrice; changedCanon = true; }
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
    try{
      const keys = ['arcano33_lotes','a33_lotes','suitea33_lotes'];
      for (const key of keys){
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) continue;
        if (arr.some(l => {
          if (!l) return false;
          const vals = [l.productId, l.productoId, l.skuProductId, l.sourceProductId];
          if (id && vals.some(v => String(v ?? '').trim() === id)) return true;
          const names = [l.productName, l.productoNombre, l.producto, l.name, l.nombre];
          return nk && names.some(v => normKey(v) === nk);
        })) return true;
      }
    }catch(_){ }
    return false;
  }

  async function renderProducts(){
    try{
      const all = await getAll('products');
      const list = (all || []).slice().sort(sortProducts);
      await renderCostsProductColumns(all || []);
      const activePosProducts = (all || []).filter(p => p && p.active !== false && productPosEnabled(p));
      const envases = ensureEnvasesDefaults(false);
      const tapas = ensureTapasDefaults(false);
      const duplicateLetters = getDuplicateRecipeLetters(all || []);
      const wrap = byId('cat-products-list');
      if (!wrap) return;
      wrap.innerHTML = '';
      if (!list.length){
        setStatus('Catálogo vacío. Agrega productos manualmente o usa “Restaurar base A33” de forma explícita. No se crearán productos automáticamente.', 'ok');
        return;
      }
      const incompleteCount = (list || []).filter(p => productProductionIssues(p, envases, tapas, duplicateLetters).length > 0).length;
      const statusMsg = `${list.length} producto(s) en catálogo · ${activePosProducts.length} producto(s) activos marcados para POS` + (incompleteCount ? ` · ${incompleteCount} incompleto(s) para producción futura` : ' · contratos listos');
      setStatus(statusMsg + '.', incompleteCount ? 'warn' : 'ok');

      for (const p of list){
        const active = p.active !== false;
        const receta = productHasRecipe(p);
        const letra = productLetter(p);
        const pos = productPosEnabled(p);
        const cap = getCapacity(p);
        const cost = getUnitCost(p);
        const envaseName = catalogNameById(envases, productEnvaseId(p));
        const tapaName = catalogNameById(tapas, productTapaId(p));
        const issues = productProductionIssues(p, envases, tapas, duplicateLetters);
        const contract = productDataContractSnapshot(p);
        const card = document.createElement('div');
        card.className = 'cat-product-card' + (active ? '' : ' is-inactive') + (pos ? ' is-canonical' : '') + (issues.length ? ' is-incomplete' : '');
        card.innerHTML = `
          <div class="cat-product-main">
            <div class="cat-product-title-row">
              <strong>${escapeHtml(p.name || 'Producto sin nombre')}</strong>
              <span class="cat-pill ${active ? 'ok' : 'muted'}">${active ? 'Activo' : 'Inactivo'}</span>
              <span class="cat-pill ${receta ? 'gold' : 'muted'}">Receta: ${receta ? 'Sí' : 'No'}</span>
              <span class="cat-pill ${pos ? 'gold' : 'muted'}">POS: ${pos ? 'Sí' : 'No'}</span>
              ${issues.length ? `<span class="cat-pill warn">Incompleto</span>` : `<span class="cat-pill ok">Listo</span>`}
            </div>
            ${issues.length ? `<div class="cat-product-warning">Producción futura: ${escapeHtml(issues.join(' · '))}</div>` : ''}
            <div class="cat-product-meta cat-product-meta-dynamic" data-contract="${escapeHtml(JSON.stringify(contract))}">
              <div><small>Precio</small><b>${escapeHtml(displayMoney(p.price))}</b></div>
              <div><small>Activo</small><b>${active ? 'Sí' : 'No'}</b></div>
              <div><small>Receta</small><b>${receta ? 'Sí' : 'No'}</b></div>
              <div><small>Letra</small><b>${escapeHtml(letra || '—')}</b></div>
              <div><small>POS</small><b>${pos ? 'Sí' : 'No'}</b></div>
              <div><small>Envase</small><b>${escapeHtml(envaseName || '—')}</b></div>
              <div><small>Tapa</small><b>${escapeHtml(tapaName || '—')}</b></div>
              <div><small>ml/unidad</small><b>${escapeHtml(displayMl(cap))}</b></div>
              <div><small>Costo ref.</small><b>${escapeHtml(displayMoney(cost))}</b></div>
              <div><small>Inventario</small><b>${p.manageStock === false ? 'No' : 'Sí'}</b></div>
            </div>
          </div>
          <div class="cat-product-actions">
            <button class="cat-btn cat-btn-ok cat-edit-product" data-id="${escapeHtml(String(p.id))}" type="button">Editar</button>
            <button class="cat-btn ${active ? 'cat-btn-warn' : 'cat-btn-secondary'} cat-toggle-product" data-id="${escapeHtml(String(p.id))}" type="button">${active ? 'Inactivar' : 'Activar'}</button>
            <button class="cat-btn cat-btn-danger cat-delete-product" data-id="${escapeHtml(String(p.id))}" type="button">Borrar</button>
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
    const receta = !!byId(prefix + '-receta')?.checked;
    const letra = normalizeProductLetter(byId(prefix + '-letra')?.value || '');
    const pos = !!byId(prefix + '-pos')?.checked;
    const envaseId = String(byId(prefix + '-envase')?.value || '').trim();
    const tapaId = String(byId(prefix + '-tapa')?.value || '').trim();
    const letterEl = byId(prefix + '-letra');
    if (letterEl && letterEl.value !== letra) letterEl.value = letra;
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
    if (receta && !letra) return { ok:false, msg:'Letra es obligatoria cuando Receta está marcada.' };
    // Si una asociación histórica fue borrada del catálogo maestro, se conserva el ID para no romper productos ni snapshots.
    // El listado lo mostrará como Eliminado/No encontrado hasta que el usuario asigne otra opción vigente.
    if (envaseId && !catalogHasId(readEnvaseCatalog(), envaseId)) {
      /* asociación histórica eliminada: permitida */
    }
    if (tapaId && !catalogHasId(readTapaCatalog(), tapaId)) {
      /* asociación histórica eliminada: permitida */
    }
    const incompleteProduction = !!(receta && (!letra || !envaseId || !tapaId));
    return { ok:true, name, price:round2(price), capacity: capRaw ? qty(capacity) : 0, unitCost:round2(unitCost), active, manage, receta, letra, pos, envaseId, tapaId, incompleteProduction };
  }

  async function ensureNoDuplicateName(name, currentId){
    const all = await getAll('products');
    const newKey = normKey(name);
    const newGroup = mapProductNameToFinishedId(name);
    const isNew = !currentId;
    const dup = (all || []).find(p => {
      if (!p) return false;
      if (currentId != null && String(p.id) === String(currentId)) return false;
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
    const all = await getAll('products');
    const dupLetter = data.receta ? findDuplicateRecipeLetter(all || [], data.letra, null) : null;
    if (dupLetter){ alert(`La Letra ${data.letra} ya está asignada a ${dupLetter.name || 'otro producto'} con Receta. Corrige antes de guardar.`); return; }
    if (data.receta && (!data.envaseId || !data.tapaId)){
      const ok = confirm('Este producto tiene Receta, pero todavía no tiene Envase y/o Tapa. Se guardará como incompleto para producción futura. ¿Continuar?');
      if (!ok) return;
    }
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
      receta:data.receta,
      letra:data.letra,
      pos:data.pos,
      envaseId:data.envaseId,
      tapaId:data.tapaId,
      productionIncomplete: data.incompleteProduction,
      createdAt:now,
      updatedAt:now,
      updatedFrom:'catalogos_productos'
    };
    try{
      await put('products', product);
      ['name','price','capacity','unit-cost','letra'].forEach(k => { const el = byId('cat-new-' + k); if (el) el.value = ''; });
      const active = byId('cat-new-active'); if (active) active.checked = true;
      const manage = byId('cat-new-manage'); if (manage) manage.checked = true;
      const receta = byId('cat-new-receta'); if (receta) receta.checked = false;
      const pos = byId('cat-new-pos'); if (pos) pos.checked = true;
      populateProductPackagingSelects('cat-new', '', '');
      await renderProducts();
      setStatus('Guardado correcto.', 'ok');
      toast('Guardado correcto');
    }catch(err){
      console.error(err);
      setStatus('No se pudo guardar el producto.', 'warn');
      alert('No se pudo guardar el producto. Revisa si el nombre ya existe o si el almacenamiento está disponible.');
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
    const product = findCatalogById(all || [], id);
    if (!product){ toast('Producto no encontrado'); return; }
    currentEditId = product.id;
    const current = byId('cat-product-current');
    if (current) current.textContent = 'Producto actual: ' + (product.name || '—');
    const fields = {
      'cat-edit-name': product.name || '',
      'cat-edit-price': String(round2(product.price)),
      'cat-edit-capacity': getCapacity(product) > 0 ? String(getCapacity(product)) : '',
      'cat-edit-unit-cost': getUnitCost(product) > 0 ? String(getUnitCost(product)) : '',
      'cat-edit-letra': productLetter(product)
    };
    Object.keys(fields).forEach(id => { const el = byId(id); if (el) el.value = fields[id]; });
    populateProductPackagingSelects('cat-edit', productEnvaseId(product), productTapaId(product));
    const active = byId('cat-edit-active'); if (active) active.checked = product.active !== false;
    const manage = byId('cat-edit-manage'); if (manage) manage.checked = product.manageStock !== false;
    const receta = byId('cat-edit-receta'); if (receta) receta.checked = productHasRecipe(product);
    const pos = byId('cat-edit-pos'); if (pos) pos.checked = productPosEnabled(product);
    const note = byId('cat-product-history-note');
    if (note){
      note.hidden = true;
      productHasMovements(product).then(has => {
        note.hidden = !has;
        if (has) note.textContent = 'Este producto tiene ventas, inventario, lotes o reempaques asociados. La Letra queda protegida para no alterar históricos ni códigos de lote existentes.';
      }).catch(()=>{});
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
    if (currentEditId == null || String(currentEditId).trim() === ''){ setEditMsg('Producto inválido.', 'warn'); return; }
    const all = await getAll('products');
    const product = findCatalogById(all || [], currentEditId);
    if (!product){ setEditMsg('El producto ya no existe.', 'warn'); return; }
    const data = readProductForm('cat-edit');
    if (!data.ok){ setEditMsg(data.msg, 'warn'); return; }
    const dup = await ensureNoDuplicateName(data.name, currentEditId);
    if (dup){ setEditMsg('Ya existe un producto equivalente. No se duplicó nada.', 'warn'); return; }
    const dupLetter = data.receta ? findDuplicateRecipeLetter(all || [], data.letra, currentEditId) : null;
    if (dupLetter){ setEditMsg(`La Letra ${data.letra} ya está asignada a ${dupLetter.name || 'otro producto'} con Receta. Corrige antes de guardar.`, 'warn'); return; }
    const oldLetter = productLetter(product);
    const nextLetter = normalizeProductLetter(data.letra);
    const letterChanged = oldLetter !== nextLetter;
    if (letterChanged && oldLetter){
      const hasHistory = await productHasMovements(product);
      if (hasHistory){
        setEditMsg('Letra protegida: este producto ya tiene ventas, inventario, lotes o reempaques asociados. No se cambia para proteger históricos y códigos de lote.', 'warn');
        const letterEl = byId('cat-edit-letra');
        if (letterEl) letterEl.value = oldLetter;
        return;
      }
      const ok = confirm(`Cambiar la Letra de ${oldLetter || '—'} a ${nextLetter || '—'} puede afectar conexiones futuras con Lotes. ¿Confirmas el cambio?`);
      if (!ok) return;
    }
    if (data.receta && (!data.envaseId || !data.tapaId)){
      const ok = confirm('Este producto tiene Receta, pero todavía no tiene Envase y/o Tapa. Quedará marcado como incompleto para producción futura. ¿Continuar?');
      if (!ok) return;
    }
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
    product.receta = data.receta;
    product.letra = data.letra;
    product.pos = data.pos;
    product.envaseId = data.envaseId;
    product.tapaId = data.tapaId;
    product.productionIncomplete = data.incompleteProduction;
    product.updatedAt = new Date().toISOString();
    product.updatedFrom = 'catalogos_productos';
    try{
      await put('products', product);
      closeProductModal();
      await renderProducts();
      setStatus('Guardado correcto.', 'ok');
      toast('Guardado correcto');
    }catch(err){
      console.error(err);
      setEditMsg('No se pudo guardar el producto. Revisa si el nombre ya existe o si el almacenamiento está disponible.', 'warn');
    }
  }

  async function toggleProduct(id){
    const all = await getAll('products');
    const product = findCatalogById(all || [], id);
    if (!product) return;
    product.active = product.active === false;
    product.updatedAt = new Date().toISOString();
    product.updatedFrom = 'catalogos_productos_toggle';
    await put('products', product);
    await renderProducts();
    toast(product.active === false ? 'Producto inactivado' : 'Producto activado');
  }

  async function deleteProductMaster(id){
    try{
      const all = await getAll('products');
      const product = findCatalogById(all || [], id);
      if (!product){ toast('Producto no encontrado'); return; }
      const name = product.name || 'Producto sin nombre';
      const ok = confirm(`¿Borrar el producto "${name}"?\n\nSolo se borrará del catálogo maestro. No se borrarán ventas, inventario, lotes ni snapshots históricos.`);
      if (!ok) return;
      rememberCatalogDeleted('products', product);
      await deleteRecord('products', product.id);
      if (currentEditId != null && String(currentEditId) === String(product.id)) closeProductModal();
      await renderProducts();
      toast('Producto borrado');
    }catch(err){
      warnCatalogDeleteError('productos', err);
    }
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
    const deletedExtraKeys = readCatalogDeletedKeys('extras');
    const existing = await getAll('extras');
    const keys = new Set((existing || []).map(x => normKey(x && x.name)).filter(Boolean));
    const events = await getAll('events');
    const now = new Date().toISOString();
    let created = 0;
    for (const ev of (events || [])){
      const extras = sanitizeEventExtrasForMasters(ev && ev.extras);
      for (const x of extras){
        const key = normKey(x.name);
        if (!key || keys.has(key) || deletedExtraKeys.has(key)) continue;
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

  function setExtraEditMsg(message, kind){
    const el = byId('cat-edit-extra-msg');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-muted cat-edit-msg' + (kind ? (' ' + kind) : '');
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

  function readExtraEditForm(){
    const name = String(byId('cat-edit-extra-name')?.value || '').trim();
    const priceRaw = String(byId('cat-edit-extra-price')?.value || '').trim();
    const costRaw = String(byId('cat-edit-extra-cost')?.value || '').trim();
    const lowRaw = String(byId('cat-edit-extra-low')?.value || '').trim();
    const active = !!byId('cat-edit-extra-active')?.checked;
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

  function resetExtraEditForm(){
    ['cat-edit-extra-name','cat-edit-extra-price','cat-edit-extra-cost','cat-edit-extra-low'].forEach(id => { const el = byId(id); if (el) el.value = ''; });
    const active = byId('cat-edit-extra-active'); if (active) active.checked = true;
    const current = byId('cat-extra-current'); if (current) current.textContent = 'Extra actual: —';
    setExtraEditMsg('', '');
  }

  async function openExtraModalCAT(id){
    const all = await getAll('extras');
    const x = (all || []).find(e => Number(e && e.id) === Number(id));
    if (!x){ toast('Extra no encontrado'); return; }
    currentExtraEditId = Number(x.id);
    const current = byId('cat-extra-current'); if (current) current.textContent = 'Extra actual: ' + (x.name || '—');
    const name = byId('cat-edit-extra-name'); if (name) name.value = x.name || '';
    const price = byId('cat-edit-extra-price'); if (price) price.value = String(getExtraPrice(x));
    const cost = byId('cat-edit-extra-cost'); if (cost) cost.value = getExtraUnitCost(x) > 0 ? String(getExtraUnitCost(x)) : '';
    const low = byId('cat-edit-extra-low'); if (low) low.value = String(x.lowStockAlert ?? 5);
    const active = byId('cat-edit-extra-active'); if (active) active.checked = activeBool(x.active);
    setExtraEditMsg('', '');
    openModalCAT('cat-extra-modal');
    try{ name?.focus({ preventScroll:true }); name?.select(); }catch(_){ }
  }

  function closeExtraModalCAT(){
    currentExtraEditId = null;
    resetExtraEditForm();
    closeModalCAT('cat-extra-modal');
  }

  async function saveExtraEditMaster(){
    if (!currentExtraEditId){ setExtraEditMsg('No hay extra seleccionado.', 'warn'); return; }
    const data = readExtraEditForm();
    if (!data.ok){ setExtraEditMsg(data.msg, 'warn'); return; }
    const dup = await ensureNoDuplicateExtraName(data.name, currentExtraEditId);
    if (dup){ setExtraEditMsg('Ya existe un extra con ese nombre. Edita o activa el existente para evitar duplicados.', 'warn'); return; }
    const all = await getAll('extras');
    const row = (all || []).find(x => Number(x && x.id) === Number(currentExtraEditId));
    if (!row){ setExtraEditMsg('El extra ya no existe.', 'warn'); closeExtraModalCAT(); await renderExtras(); return; }
    row.name = data.name;
    row.basePrice = data.basePrice;
    row.price = data.basePrice;
    row.unitPrice = data.basePrice;
    row.unitCost = data.unitCost;
    row.costoUnitario = data.unitCost;
    row.lowStockAlert = data.lowStockAlert || 5;
    row.active = data.active;
    row.updatedAt = new Date().toISOString();
    row.updatedFrom = 'catalogos_extras_modal';
    await put('extras', row);
    closeExtraModalCAT();
    await renderExtras();
    toast('Extra guardado');
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
            <button class="cat-btn cat-btn-danger cat-delete-extra" data-id="${escapeHtml(String(x.id))}" type="button">Borrar</button>
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
    await openExtraModalCAT(id);
  }

  async function toggleExtraMaster(id){
    const all = await getAll('extras');
    const x = findCatalogById(all || [], id);
    if (!x) return;
    x.active = !activeBool(x.active);
    x.updatedAt = new Date().toISOString();
    x.updatedFrom = 'catalogos_extras_toggle';
    await put('extras', x);
    await renderExtras();
    toast(x.active === false ? 'Extra inactivado' : 'Extra activado');
  }

  async function deleteExtraMaster(id){
    try{
      const all = await getAll('extras');
      const x = findCatalogById(all || [], id);
      if (!x){ toast('Extra no encontrado'); return; }
      const name = x.name || 'Extra sin nombre';
      const ok = confirm(`¿Borrar el extra "${name}"?\n\nSolo se borrará del catálogo maestro. No se borrarán ventas ni snapshots históricos.`);
      if (!ok) return;
      rememberCatalogDeleted('extras', x);
      await deleteRecord('extras', x.id);
      if (currentExtraEditId != null && String(currentExtraEditId) === String(x.id)) closeExtraModalCAT();
      await renderExtras();
      toast('Extra borrado');
    }catch(err){
      warnCatalogDeleteError('extras', err);
    }
  }

  async function ensureBanksDefaultsCatalog(force){
    if (force) clearCatalogDeleted('banks');
    const banks = await getAll('banks');
    const defaults = ['BAC','BANPRO','LAFISE','BDF'].map(name => ({ name, isActive:true, active:true, type:'transferencia', currency:'NIO', accountReference:'', commissionPct:0 }));
    if ((banks || []).length && !force) return;
    const existingKeys = new Set((banks || []).map(b => catalogDeletedKey('banks', b)).filter(Boolean));
    const deletedBankKeys = readCatalogDeletedKeys('banks');
    const now = new Date().toISOString();
    for (const row of defaults){
      const key = catalogDeletedKey('banks', row);
      if (existingKeys.has(key)) continue;
      if (!force && deletedBankKeys.has(key)) continue;
      await put('banks', { ...row, bankType:row.type, paymentType:row.type, reference:'', createdAt:now, updatedAt:now, updatedFrom:'catalogos_bancos_seed' });
      existingKeys.add(key);
    }
  }

  async function ensureNoDuplicateBank(name, type, currentId){
    const all = await getAll('banks');
    const key = normBankName(name);
    const t = normalizeBankType(type);
    return (all || []).find(b => b && (!currentId || Number(b.id) !== Number(currentId)) && normBankName(b.name || '') === key && normalizeBankType(b.type || b.bankType) === t) || null;
  }

  function setBankEditMsg(message, kind){
    const el = byId('cat-edit-bank-msg');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-muted cat-edit-msg' + (kind ? (' ' + kind) : '');
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

  function readBankEditForm(){
    const name = String(byId('cat-edit-bank-name')?.value || '').trim();
    const type = normalizeBankType(byId('cat-edit-bank-type')?.value || 'transferencia');
    const currency = normalizeBankCurrency(byId('cat-edit-bank-currency')?.value || 'NIO');
    const accountReference = String(byId('cat-edit-bank-ref')?.value || '').trim();
    const commissionRaw = String(byId('cat-edit-bank-commission')?.value || '').trim();
    const active = !!byId('cat-edit-bank-active')?.checked;
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

  function resetBankEditForm(){
    ['cat-edit-bank-name','cat-edit-bank-ref','cat-edit-bank-commission'].forEach(id => { const el = byId(id); if (el) el.value = ''; });
    const type = byId('cat-edit-bank-type'); if (type) type.value = 'transferencia';
    const cur = byId('cat-edit-bank-currency'); if (cur) cur.value = 'NIO';
    const active = byId('cat-edit-bank-active'); if (active) active.checked = true;
    const current = byId('cat-bank-current'); if (current) current.textContent = 'Banco actual: —';
    setBankEditMsg('', '');
  }

  async function openBankModalCAT(id){
    const all = await getAll('banks');
    const b = (all || []).find(x => Number(x && x.id) === Number(id));
    if (!b){ toast('Banco no encontrado'); return; }
    currentBankEditId = Number(b.id);
    const current = byId('cat-bank-current'); if (current) current.textContent = 'Banco actual: ' + (b.name || '—');
    const name = byId('cat-edit-bank-name'); if (name) name.value = b.name || '';
    const type = byId('cat-edit-bank-type'); if (type) type.value = normalizeBankType(b.type || b.bankType);
    const cur = byId('cat-edit-bank-currency'); if (cur) cur.value = normalizeBankCurrency(b.currency);
    const ref = byId('cat-edit-bank-ref'); if (ref) ref.value = b.accountReference || b.reference || '';
    const commission = byId('cat-edit-bank-commission'); if (commission) commission.value = String(round2(b.commissionPct ?? b.commission ?? b.feePct ?? 0));
    const active = byId('cat-edit-bank-active'); if (active) active.checked = bankActive(b);
    setBankEditMsg('', '');
    openModalCAT('cat-bank-modal');
    try{ name?.focus({ preventScroll:true }); name?.select(); }catch(_){ }
  }

  function closeBankModalCAT(){
    currentBankEditId = null;
    resetBankEditForm();
    closeModalCAT('cat-bank-modal');
  }

  async function saveBankEditMaster(){
    if (!currentBankEditId){ setBankEditMsg('No hay banco seleccionado.', 'warn'); return; }
    const data = readBankEditForm();
    if (!data.ok){ setBankEditMsg(data.msg, 'warn'); return; }
    const dup = await ensureNoDuplicateBank(data.name, data.type, currentBankEditId);
    if (dup){ setBankEditMsg('Ya existe un banco con ese nombre y tipo. Edita o activa el existente.', 'warn'); return; }
    const all = await getAll('banks');
    const row = (all || []).find(x => Number(x && x.id) === Number(currentBankEditId));
    if (!row){ setBankEditMsg('El banco ya no existe.', 'warn'); closeBankModalCAT(); await renderBanks(); return; }
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
    row.updatedAt = new Date().toISOString();
    row.updatedFrom = 'catalogos_bancos_modal';
    await put('banks', row);
    closeBankModalCAT();
    await renderBanks();
    toast('Banco guardado');
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
            <button class="cat-btn cat-btn-danger cat-delete-bank" data-id="${escapeHtml(String(b.id))}" type="button">Borrar</button>
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
    await openBankModalCAT(id);
  }

  async function toggleBankMaster(id){
    const all = await getAll('banks');
    const b = findCatalogById(all || [], id);
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

  async function deleteBankMaster(id){
    try{
      const all = await getAll('banks');
      const b = findCatalogById(all || [], id);
      if (!b){ toast('Banco no encontrado'); return; }
      const name = b.name || 'Banco sin nombre';
      const typeLabel = bankTypeLabel(normalizeBankType(b.type || b.bankType));
      const ok = confirm(`¿Borrar el banco "${name}" (${typeLabel})?\n\nSolo se borrará del catálogo maestro. No se borrarán pagos, cobros, ventas ni movimientos históricos.`);
      if (!ok) return;
      rememberCatalogDeleted('banks', b);
      await deleteRecord('banks', b.id);
      if (currentBankEditId != null && String(currentBankEditId) === String(b.id)) closeBankModalCAT();
      await renderBanks();
      toast('Banco borrado');
    }catch(err){
      warnCatalogDeleteError('bancos', err);
    }
  }


  // Etapa 2/5 — Envases / Botellas dinámicas (Catálogos)
  function sanitizeEnvaseName(value){
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeEnvaseKey(value){
    return normKey(sanitizeEnvaseName(value));
  }

  function envaseActive(envase){
    return envase && envase.active === false ? false : true;
  }

  function envaseCapacity(envase){
    const e = envase && typeof envase === 'object' ? envase : {};
    const candidates = [e.capacityMl, e.capacidadMl, e.ml, e.volumeMl, e.capacidad];
    for (const value of candidates){
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return qty(n, 0);
    }
    return 0;
  }

  function readEnvasesRaw(){
    try{
      if (window.A33Storage && typeof window.A33Storage.getJSON === 'function'){
        return window.A33Storage.getJSON(ENVASES_CATALOG_KEY, [], 'local');
      }
    }catch(_){ }
    try{
      const raw = window.localStorage ? localStorage.getItem(ENVASES_CATALOG_KEY) : null;
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return parsed == null ? [] : parsed;
    }catch(_){ return []; }
  }

  function writeEnvasesRaw(list){
    const safe = Array.isArray(list) ? list : [];
    try{
      if (window.A33Storage && typeof window.A33Storage.setJSON === 'function'){
        return !!window.A33Storage.setJSON(ENVASES_CATALOG_KEY, safe, 'local');
      }
    }catch(_){ }
    try{
      if (!window.localStorage) return false;
      localStorage.setItem(ENVASES_CATALOG_KEY, JSON.stringify(safe));
      return true;
    }catch(_){ return false; }
  }

  function normalizeEnvaseRecord(raw, index){
    const src = raw && typeof raw === 'object' ? raw : { name:String(raw || '') };
    const name = sanitizeEnvaseName(src.name || src.nombre || '');
    if (!name) return null;
    const key = normalizeEnvaseKey(name);
    const now = new Date().toISOString();
    const id = String(src.id || src.envaseId || ('envase_' + hash36CAT(key || ('row_' + index)))).trim();
    const capacity = envaseCapacity(src);
    return {
      ...src,
      id,
      name,
      nombre:name,
      capacityMl: capacity > 0 ? capacity : null,
      capacidadMl: capacity > 0 ? capacity : null,
      note: String(src.note || src.nota || src.observacion || '').trim().slice(0, 160),
      active: src.active === false ? false : true,
      schemaVersion: Number(src.schemaVersion) || ENVASES_SCHEMA_VERSION,
      createdAt: src.createdAt || now,
      updatedAt: src.updatedAt || now,
      updatedFrom: src.updatedFrom || 'catalogos_envases_normalizado'
    };
  }

  function readEnvaseCatalog(){
    const raw = readEnvasesRaw();
    const arr = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const out = [];
    for (let i = 0; i < arr.length; i++){
      const row = normalizeEnvaseRecord(arr[i], i);
      if (!row) continue;
      const key = normalizeEnvaseKey(row.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out.sort(sortMasterByActiveName);
  }

  function saveEnvaseCatalog(list){
    return writeEnvasesRaw((Array.isArray(list) ? list : []).map((x, i) => normalizeEnvaseRecord(x, i)).filter(Boolean));
  }

  function ensureEnvasesDefaults(force){
    if (force) clearCatalogDeleted('envases');
    const deleted = readCatalogDeletedKeys('envases');
    const list = readEnvaseCatalog();
    const byName = new Map(list.map(x => [normalizeEnvaseKey(x.name), x]));
    const byId = new Set(list.map(x => String(x.id || '')));
    const now = new Date().toISOString();
    let changed = false;

    for (const seed of ENVASES_SEED){
      const key = normalizeEnvaseKey(seed.name);
      if (!force && deleted.has(key)) continue;
      const existing = byName.get(key);
      if (existing){
        let ch = false;
        if (!existing.id){ existing.id = seed.id; ch = true; }
        if (!existing.nombre){ existing.nombre = existing.name; ch = true; }
        const seedCap = Number(seed.capacityMl);
        if (Number.isFinite(seedCap) && seedCap > 0 && !envaseCapacity(existing)){
          existing.capacityMl = seedCap;
          existing.capacidadMl = seedCap;
          ch = true;
        }
        if (force && existing.active !== true){ existing.active = true; ch = true; }
        if (ch){ existing.updatedAt = now; existing.updatedFrom = 'catalogos_envases_seed'; changed = true; }
        continue;
      }
      let id = seed.id;
      if (byId.has(id)) id = id + '_' + hash36CAT(key + '_' + now);
      byId.add(id);
      list.push({
        id,
        name:seed.name,
        nombre:seed.name,
        capacityMl:Number.isFinite(Number(seed.capacityMl)) && Number(seed.capacityMl) > 0 ? Number(seed.capacityMl) : null,
        capacidadMl:Number.isFinite(Number(seed.capacityMl)) && Number(seed.capacityMl) > 0 ? Number(seed.capacityMl) : null,
        note:'',
        active:seed.active !== false,
        schemaVersion:ENVASES_SCHEMA_VERSION,
        createdAt:now,
        updatedAt:now,
        updatedFrom:'catalogos_envases_seed'
      });
      changed = true;
    }

    if (changed || force || !Array.isArray(readEnvasesRaw())) saveEnvaseCatalog(list);
    return list.sort(sortMasterByActiveName);
  }

  function setEnvaseMsg(message, kind){
    const el = byId('cat-envase-msg');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-muted cat-edit-msg' + (kind ? (' ' + kind) : '');
  }

  function setEnvaseEditMsg(message, kind){
    const el = byId('cat-edit-envase-msg');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-muted cat-edit-msg' + (kind ? (' ' + kind) : '');
  }

  function readEnvaseForm(){
    const name = sanitizeEnvaseName(byId('cat-envase-name')?.value || '');
    const capRaw = String(byId('cat-envase-capacity')?.value || '').trim();
    const note = String(byId('cat-envase-note')?.value || '').trim().slice(0, 160);
    const active = !!byId('cat-envase-active')?.checked;
    if (!name) return { ok:false, msg:'Nombre obligatorio.' };
    let capacityMl = null;
    if (capRaw){
      const n = Number(capRaw);
      if (!Number.isFinite(n) || n <= 0) return { ok:false, msg:'Capacidad ml inválida.' };
      capacityMl = qty(n, 0);
    }
    return { ok:true, name, capacityMl, note, active };
  }

  function readEnvaseEditForm(){
    const name = sanitizeEnvaseName(byId('cat-edit-envase-name')?.value || '');
    const capRaw = String(byId('cat-edit-envase-capacity')?.value || '').trim();
    const note = String(byId('cat-edit-envase-note')?.value || '').trim().slice(0, 160);
    const active = !!byId('cat-edit-envase-active')?.checked;
    if (!name) return { ok:false, msg:'Nombre obligatorio.' };
    let capacityMl = null;
    if (capRaw){
      const n = Number(capRaw);
      if (!Number.isFinite(n) || n <= 0) return { ok:false, msg:'Capacidad ml inválida.' };
      capacityMl = qty(n, 0);
    }
    return { ok:true, name, capacityMl, note, active };
  }

  function resetEnvaseForm(){
    currentEnvaseEditId = null;
    ['cat-envase-name','cat-envase-capacity','cat-envase-note'].forEach(id => { const el = byId(id); if (el) el.value = ''; });
    const active = byId('cat-envase-active'); if (active) active.checked = true;
    const save = byId('cat-save-envase'); if (save) save.textContent = '+ Agregar envase';
    const cancel = byId('cat-cancel-envase'); if (cancel) cancel.hidden = true;
    setEnvaseMsg('', '');
  }

  function ensureNoDuplicateEnvaseName(name, currentId){
    const key = normalizeEnvaseKey(name);
    return readEnvaseCatalog().find(x => x && String(x.id) !== String(currentId || '') && normalizeEnvaseKey(x.name) === key) || null;
  }

  function resetEnvaseEditForm(){
    ['cat-edit-envase-name','cat-edit-envase-capacity','cat-edit-envase-note'].forEach(id => { const el = byId(id); if (el) el.value = ''; });
    const active = byId('cat-edit-envase-active'); if (active) active.checked = true;
    const current = byId('cat-envase-current'); if (current) current.textContent = 'Envase actual: —';
    setEnvaseEditMsg('', '');
  }

  async function openEnvaseModalCAT(id){
    const row = readEnvaseCatalog().find(x => x && String(x.id) === String(id));
    if (!row){ toast('Envase no encontrado'); return; }
    currentEnvaseEditId = String(row.id);
    const current = byId('cat-envase-current'); if (current) current.textContent = 'Envase actual: ' + (row.name || row.nombre || '—');
    const name = byId('cat-edit-envase-name'); if (name) name.value = row.name || row.nombre || '';
    const cap = byId('cat-edit-envase-capacity'); if (cap) cap.value = envaseCapacity(row) > 0 ? String(envaseCapacity(row)) : '';
    const note = byId('cat-edit-envase-note'); if (note) note.value = String(row.note || row.nota || '');
    const active = byId('cat-edit-envase-active'); if (active) active.checked = envaseActive(row);
    setEnvaseEditMsg('', '');
    openModalCAT('cat-envase-modal');
    try{ name?.focus({ preventScroll:true }); name?.select(); }catch(_){ }
  }

  function closeEnvaseModalCAT(){
    currentEnvaseEditId = null;
    resetEnvaseEditForm();
    closeModalCAT('cat-envase-modal');
  }

  async function saveEnvaseEditMaster(){
    if (!currentEnvaseEditId){ setEnvaseEditMsg('No hay envase seleccionado.', 'warn'); return; }
    const data = readEnvaseEditForm();
    if (!data.ok){ setEnvaseEditMsg(data.msg, 'warn'); return; }
    const duplicate = ensureNoDuplicateEnvaseName(data.name, currentEnvaseEditId);
    if (duplicate){ setEnvaseEditMsg('Ya existe un envase con ese nombre. Edita o activa el existente para evitar duplicados.', 'warn'); return; }

    const list = readEnvaseCatalog();
    const row = list.find(x => x && String(x.id) === String(currentEnvaseEditId));
    if (!row){ setEnvaseEditMsg('El envase ya no existe. Actualiza e intenta de nuevo.', 'warn'); closeEnvaseModalCAT(); await renderEnvases(); return; }

    row.name = data.name;
    row.nombre = data.name;
    row.capacityMl = data.capacityMl;
    row.capacidadMl = data.capacityMl;
    row.note = data.note;
    row.nota = data.note;
    row.active = data.active;
    row.updatedAt = new Date().toISOString();
    row.updatedFrom = 'catalogos_envases_modal';

    if (!saveEnvaseCatalog(list)){ setEnvaseEditMsg('No se pudo guardar. Revisa almacenamiento local.', 'warn'); return; }
    closeEnvaseModalCAT();
    await renderEnvases();
    await normalizeProductPackagingFields();
    refreshProductPackagingSelects();
    await renderProducts();
    toast('Envase guardado');
  }

  async function renderEnvases(){
    try{
      const list = ensureEnvasesDefaults(false);
      const wrap = byId('cat-envases-list');
      if (!wrap) return;
      wrap.innerHTML = '';
      if (!list.length){
        setStatusById('cat-envases-status', 'No hay envases maestros todavía. Puedes crear uno o restaurar la base inicial.', 'warn');
        return;
      }
      const activeCount = list.filter(envaseActive).length;
      setStatusById('cat-envases-status', `${list.length} envase(s) maestro(s) · ${activeCount} activo(s).`, 'ok');
      for (const x of list){
        const active = envaseActive(x);
        const cap = envaseCapacity(x);
        const note = String(x.note || x.nota || '').trim();
        const card = document.createElement('div');
        card.className = 'cat-product-card cat-envase-card' + (active ? '' : ' is-inactive');
        card.innerHTML = `
          <div class="cat-product-main">
            <div class="cat-product-title-row">
              <strong>${escapeHtml(x.name || 'Envase sin nombre')}</strong>
              <span class="cat-pill ${active ? 'ok' : 'muted'}">${active ? 'Activo' : 'Inactivo'}</span>
              <span class="cat-pill gold">Envase</span>
            </div>
            <div class="cat-product-meta">
              <div><small>ID</small><b>${escapeHtml(String(x.id || '—'))}</b></div>
              <div><small>Capacidad</small><b>${escapeHtml(displayMl(cap))}</b></div>
              <div><small>Estado</small><b>${active ? 'Activo' : 'Inactivo'}</b></div>
              <div><small>Nota</small><b><span class="cat-envase-note">${escapeHtml(note || '—')}</span></b></div>
            </div>
          </div>
          <div class="cat-product-actions">
            <button class="cat-btn cat-btn-ok cat-edit-envase" data-id="${escapeHtml(String(x.id))}" type="button">Editar</button>
            <button class="cat-btn ${active ? 'cat-btn-warn' : 'cat-btn-secondary'} cat-toggle-envase" data-id="${escapeHtml(String(x.id))}" type="button">${active ? 'Inactivar' : 'Activar'}</button>
            <button class="cat-btn cat-btn-danger cat-delete-envase" data-id="${escapeHtml(String(x.id))}" type="button">Borrar</button>
          </div>
        `;
        wrap.appendChild(card);
      }
    }catch(err){
      console.error(err);
      setStatusById('cat-envases-status', 'No se pudieron cargar los envases maestros.', 'warn');
    }
  }

  async function saveEnvaseMaster(){
    const data = readEnvaseForm();
    if (!data.ok){ setEnvaseMsg(data.msg, 'warn'); return; }
    const duplicate = ensureNoDuplicateEnvaseName(data.name, currentEnvaseEditId);
    if (duplicate){ setEnvaseMsg('Ya existe un envase con ese nombre. Edita o activa el existente para evitar duplicados.', 'warn'); return; }

    const list = readEnvaseCatalog();
    const now = new Date().toISOString();
    const wasEdit = !!currentEnvaseEditId;
    let row = null;
    if (wasEdit){
      row = list.find(x => x && String(x.id) === String(currentEnvaseEditId));
      if (!row){ setEnvaseMsg('El envase ya no existe. Actualiza e intenta de nuevo.', 'warn'); resetEnvaseForm(); await renderEnvases(); return; }
    } else {
      const key = normalizeEnvaseKey(data.name);
      let id = 'envase_' + hash36CAT(key + '_' + Date.now());
      const ids = new Set(list.map(x => String(x.id || '')));
      while (ids.has(id)) id = 'envase_' + hash36CAT(key + '_' + Date.now() + '_' + Math.random());
      row = { id, createdAt:now, schemaVersion:ENVASES_SCHEMA_VERSION };
      list.push(row);
    }

    row.name = data.name;
    row.nombre = data.name;
    row.capacityMl = data.capacityMl;
    row.capacidadMl = data.capacityMl;
    row.note = data.note;
    row.nota = data.note;
    row.active = data.active;
    row.updatedAt = now;
    row.updatedFrom = 'catalogos_envases';

    if (!saveEnvaseCatalog(list)){ setEnvaseMsg('No se pudo guardar. Revisa almacenamiento local.', 'warn'); return; }
    resetEnvaseForm();
    await renderEnvases();
    await normalizeProductPackagingFields();
    refreshProductPackagingSelects();
    await renderProducts();
    toast(wasEdit ? 'Envase guardado' : 'Envase agregado');
  }

  async function editEnvaseMaster(id){
    await openEnvaseModalCAT(id);
  }

  async function toggleEnvaseMaster(id){
    const list = readEnvaseCatalog();
    const row = list.find(x => x && String(x.id) === String(id));
    if (!row) return;
    row.active = !envaseActive(row);
    row.updatedAt = new Date().toISOString();
    row.updatedFrom = 'catalogos_envases_toggle';
    if (!saveEnvaseCatalog(list)){ toast('No se pudo guardar'); return; }
    await renderEnvases();
    refreshProductPackagingSelects();
    await renderProducts();
    toast(row.active === false ? 'Envase inactivado' : 'Envase activado');
  }

  async function deleteEnvaseMaster(id){
    const target = String(id || '').trim();
    if (!target) return;
    const list = readEnvaseCatalog();
    const row = list.find(x => x && String(x.id) === target);
    if (!row){ toast('Envase no encontrado'); return; }
    const name = row.name || row.nombre || 'Envase sin nombre';
    const ok = confirm(`¿Borrar el envase "${name}"?

Solo se quitará del catálogo maestro. No se borrarán productos asociados, producción, inventario, lotes ni históricos.`);
    if (!ok) return;
    rememberCatalogDeleted('envases', row);
    const next = list.filter(x => !(x && String(x.id) === target));
    if (!saveEnvaseCatalog(next)){ toast('No se pudo borrar'); return; }
    if (currentEnvaseEditId && String(currentEnvaseEditId) === target) closeEnvaseModalCAT();
    resetEnvaseForm();
    await renderEnvases();
    refreshProductPackagingSelects();
    await renderProducts();
    toast('Envase borrado');
  }

  function bindEnvaseUi(){
    const list = byId('cat-envases-list');
    if (list){
      list.addEventListener('click', async (e)=>{
        const edit = e.target.closest('.cat-edit-envase');
        const toggle = e.target.closest('.cat-toggle-envase');
        const del = e.target.closest('.cat-delete-envase');
        if (edit){ await editEnvaseMaster(edit.dataset.id); return; }
        if (toggle){ await toggleEnvaseMaster(toggle.dataset.id); return; }
        if (del){ await deleteEnvaseMaster(del.dataset.id); return; }
      });
    }
    byId('cat-save-envase')?.addEventListener('click', ()=>saveEnvaseMaster().catch(err=>{ console.error(err); setEnvaseMsg('No se pudo guardar el envase.', 'warn'); }));
    byId('cat-edit-envase-save')?.addEventListener('click', ()=>saveEnvaseEditMaster().catch(err=>{ console.error(err); setEnvaseEditMsg('No se pudo guardar el envase.', 'warn'); }));
    byId('cat-cancel-envase')?.addEventListener('click', resetEnvaseForm);
    byId('cat-refresh-envases')?.addEventListener('click', async ()=>{ await renderEnvases(); toast('Envases actualizados'); });
    byId('cat-restore-envases')?.addEventListener('click', async ()=>{ ensureEnvasesDefaults(true); resetEnvaseForm(); await normalizeProductPackagingFields(); refreshProductPackagingSelects(); await renderEnvases(); await renderProducts(); toast('Envases base revisados'); });
  }

  async function initEnvases(){
    ensureEnvasesDefaults(false);
    await renderEnvases();
  }


  // Etapa 3/5 — Tapas / Corchos dinámicos (Catálogos)
  function sanitizeTapaName(value){
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeTapaKey(value){
    return normKey(sanitizeTapaName(value));
  }

  function tapaActive(tapa){
    return tapa && tapa.active === false ? false : true;
  }

  function readTapasRaw(){
    try{
      if (window.A33Storage && typeof window.A33Storage.getJSON === 'function'){
        return window.A33Storage.getJSON(TAPAS_CATALOG_KEY, [], 'local');
      }
    }catch(_){ }
    try{
      const raw = window.localStorage ? localStorage.getItem(TAPAS_CATALOG_KEY) : null;
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return parsed == null ? [] : parsed;
    }catch(_){ return []; }
  }

  function writeTapasRaw(list){
    const safe = Array.isArray(list) ? list : [];
    try{
      if (window.A33Storage && typeof window.A33Storage.setJSON === 'function'){
        return !!window.A33Storage.setJSON(TAPAS_CATALOG_KEY, safe, 'local');
      }
    }catch(_){ }
    try{
      if (!window.localStorage) return false;
      localStorage.setItem(TAPAS_CATALOG_KEY, JSON.stringify(safe));
      return true;
    }catch(_){ return false; }
  }

  function normalizeTapaRecord(src, index){
    const raw = src && typeof src === 'object' ? src : {};
    const name = sanitizeTapaName(raw.name || raw.nombre || raw.label || raw.tapa || raw.descripcion || '');
    const key = normalizeTapaKey(name);
    if (!key) return null;
    const id = String(raw.id || raw.tapaId || ('tapa_' + hash36CAT(key || ('row_' + index)))).trim();
    const note = String(raw.note || raw.nota || raw.observacion || raw.observation || '').trim().slice(0, 160);
    const active = raw.active === false || raw.isActive === false || raw.activo === false ? false : true;
    return {
      ...raw,
      id,
      name,
      nombre:name,
      note,
      nota:note,
      active,
      schemaVersion: Number(raw.schemaVersion) || TAPAS_SCHEMA_VERSION,
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
      updatedFrom: raw.updatedFrom || 'catalogos_tapas_normalizado'
    };
  }

  function readTapaCatalog(){
    const raw = readTapasRaw();
    const list = (Array.isArray(raw) ? raw : []).map((x, i) => normalizeTapaRecord(x, i)).filter(Boolean);
    const seen = new Set();
    const deduped = [];
    for (const x of list){
      const k = normalizeTapaKey(x.name);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      deduped.push(x);
    }
    return deduped.sort(sortMasterByActiveName);
  }

  function saveTapaCatalog(list){
    return writeTapasRaw((Array.isArray(list) ? list : []).map((x, i) => normalizeTapaRecord(x, i)).filter(Boolean));
  }

  function ensureTapasDefaults(force){
    if (force) clearCatalogDeleted('tapas');
    const deleted = readCatalogDeletedKeys('tapas');
    const list = readTapaCatalog();
    const byName = new Map(list.map(x => [normalizeTapaKey(x.name), x]));
    const byId = new Set(list.map(x => String(x.id || '')));
    const now = new Date().toISOString();
    let changed = false;

    for (const seed of TAPAS_SEED){
      const key = normalizeTapaKey(seed.name);
      if (!force && deleted.has(key)) continue;
      const existing = byName.get(key);
      if (existing){
        let ch = false;
        if (!existing.id){ existing.id = seed.id; ch = true; }
        if (!existing.nombre){ existing.nombre = existing.name; ch = true; }
        if (force && existing.active !== true){ existing.active = true; ch = true; }
        if (ch){ existing.updatedAt = now; existing.updatedFrom = 'catalogos_tapas_seed'; changed = true; }
        continue;
      }
      let id = seed.id;
      if (byId.has(id)) id = id + '_' + hash36CAT(key + '_' + now);
      byId.add(id);
      list.push({
        id,
        name:seed.name,
        nombre:seed.name,
        note:'',
        nota:'',
        active:seed.active !== false,
        schemaVersion:TAPAS_SCHEMA_VERSION,
        createdAt:now,
        updatedAt:now,
        updatedFrom:'catalogos_tapas_seed'
      });
      changed = true;
    }

    if (changed || force || !Array.isArray(readTapasRaw())) saveTapaCatalog(list);
    return list.sort(sortMasterByActiveName);
  }

  function setTapaMsg(message, kind){
    const el = byId('cat-tapa-msg');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-muted cat-edit-msg' + (kind ? (' ' + kind) : '');
  }

  function setTapaEditMsg(message, kind){
    const el = byId('cat-edit-tapa-msg');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-muted cat-edit-msg' + (kind ? (' ' + kind) : '');
  }

  function readTapaForm(){
    const name = sanitizeTapaName(byId('cat-tapa-name')?.value || '');
    const note = String(byId('cat-tapa-note')?.value || '').trim().slice(0, 160);
    const active = !!byId('cat-tapa-active')?.checked;
    if (!name) return { ok:false, msg:'Nombre obligatorio.' };
    return { ok:true, name, note, active };
  }

  function readTapaEditForm(){
    const name = sanitizeTapaName(byId('cat-edit-tapa-name')?.value || '');
    const note = String(byId('cat-edit-tapa-note')?.value || '').trim().slice(0, 160);
    const active = !!byId('cat-edit-tapa-active')?.checked;
    if (!name) return { ok:false, msg:'Nombre obligatorio.' };
    return { ok:true, name, note, active };
  }

  function resetTapaForm(){
    currentTapaEditId = null;
    ['cat-tapa-name','cat-tapa-note'].forEach(id => { const el = byId(id); if (el) el.value = ''; });
    const active = byId('cat-tapa-active'); if (active) active.checked = true;
    const save = byId('cat-save-tapa'); if (save) save.textContent = '+ Agregar tapa';
    const cancel = byId('cat-cancel-tapa'); if (cancel) cancel.hidden = true;
    setTapaMsg('', '');
  }

  function ensureNoDuplicateTapaName(name, currentId){
    const key = normalizeTapaKey(name);
    return readTapaCatalog().find(x => x && String(x.id) !== String(currentId || '') && normalizeTapaKey(x.name) === key) || null;
  }

  function resetTapaEditForm(){
    ['cat-edit-tapa-name','cat-edit-tapa-note'].forEach(id => { const el = byId(id); if (el) el.value = ''; });
    const active = byId('cat-edit-tapa-active'); if (active) active.checked = true;
    const current = byId('cat-tapa-current'); if (current) current.textContent = 'Tapa actual: —';
    setTapaEditMsg('', '');
  }

  async function openTapaModalCAT(id){
    const row = readTapaCatalog().find(x => x && String(x.id) === String(id));
    if (!row){ toast('Tapa no encontrada'); return; }
    currentTapaEditId = String(row.id);
    const current = byId('cat-tapa-current'); if (current) current.textContent = 'Tapa actual: ' + (row.name || row.nombre || '—');
    const name = byId('cat-edit-tapa-name'); if (name) name.value = row.name || row.nombre || '';
    const note = byId('cat-edit-tapa-note'); if (note) note.value = String(row.note || row.nota || '');
    const active = byId('cat-edit-tapa-active'); if (active) active.checked = tapaActive(row);
    setTapaEditMsg('', '');
    openModalCAT('cat-tapa-modal');
    try{ name?.focus({ preventScroll:true }); name?.select(); }catch(_){ }
  }

  function closeTapaModalCAT(){
    currentTapaEditId = null;
    resetTapaEditForm();
    closeModalCAT('cat-tapa-modal');
  }

  async function saveTapaEditMaster(){
    if (!currentTapaEditId){ setTapaEditMsg('No hay tapa seleccionada.', 'warn'); return; }
    const data = readTapaEditForm();
    if (!data.ok){ setTapaEditMsg(data.msg, 'warn'); return; }
    const duplicate = ensureNoDuplicateTapaName(data.name, currentTapaEditId);
    if (duplicate){ setTapaEditMsg('Ya existe una tapa/corcho con ese nombre. Edita o activa el existente para evitar duplicados.', 'warn'); return; }

    const list = readTapaCatalog();
    const row = list.find(x => x && String(x.id) === String(currentTapaEditId));
    if (!row){ setTapaEditMsg('La tapa ya no existe. Actualiza e intenta de nuevo.', 'warn'); closeTapaModalCAT(); await renderTapas(); return; }

    row.name = data.name;
    row.nombre = data.name;
    row.note = data.note;
    row.nota = data.note;
    row.active = data.active;
    row.updatedAt = new Date().toISOString();
    row.updatedFrom = 'catalogos_tapas_modal';

    if (!saveTapaCatalog(list)){ setTapaEditMsg('No se pudo guardar. Revisa almacenamiento local.', 'warn'); return; }
    closeTapaModalCAT();
    await renderTapas();
    await normalizeProductPackagingFields();
    refreshProductPackagingSelects();
    await renderProducts();
    toast('Tapa guardada');
  }

  async function renderTapas(){
    try{
      const list = ensureTapasDefaults(false);
      const wrap = byId('cat-tapas-list');
      if (!wrap) return;
      wrap.innerHTML = '';
      if (!list.length){
        setStatusById('cat-tapas-status', 'No hay tapas maestras todavía. Puedes crear una o restaurar la base inicial.', 'warn');
        return;
      }
      const activeCount = list.filter(tapaActive).length;
      setStatusById('cat-tapas-status', `${list.length} tapa(s) / corcho(s) maestro(s) · ${activeCount} activo(s).`, 'ok');
      for (const x of list){
        const active = tapaActive(x);
        const note = String(x.note || x.nota || '').trim();
        const card = document.createElement('div');
        card.className = 'cat-product-card cat-tapa-card' + (active ? '' : ' is-inactive');
        card.innerHTML = `
          <div class="cat-product-main">
            <div class="cat-product-title-row">
              <strong>${escapeHtml(x.name || 'Tapa sin nombre')}</strong>
              <span class="cat-pill ${active ? 'ok' : 'muted'}">${active ? 'Activo' : 'Inactivo'}</span>
              <span class="cat-pill gold">Tapa</span>
            </div>
            <div class="cat-product-meta">
              <div><small>ID</small><b>${escapeHtml(String(x.id || '—'))}</b></div>
              <div><small>Tipo</small><b>Tapa / Corcho</b></div>
              <div><small>Estado</small><b>${active ? 'Activo' : 'Inactivo'}</b></div>
              <div><small>Nota</small><b><span class="cat-tapa-note">${escapeHtml(note || '—')}</span></b></div>
            </div>
          </div>
          <div class="cat-product-actions">
            <button class="cat-btn cat-btn-ok cat-edit-tapa" data-id="${escapeHtml(String(x.id))}" type="button">Editar</button>
            <button class="cat-btn ${active ? 'cat-btn-warn' : 'cat-btn-secondary'} cat-toggle-tapa" data-id="${escapeHtml(String(x.id))}" type="button">${active ? 'Inactivar' : 'Activar'}</button>
            <button class="cat-btn cat-btn-danger cat-delete-tapa" data-id="${escapeHtml(String(x.id))}" type="button">Borrar</button>
          </div>
        `;
        wrap.appendChild(card);
      }
    }catch(err){
      console.error(err);
      setStatusById('cat-tapas-status', 'No se pudieron cargar las tapas maestras.', 'warn');
    }
  }

  async function saveTapaMaster(){
    const data = readTapaForm();
    if (!data.ok){ setTapaMsg(data.msg, 'warn'); return; }
    const duplicate = ensureNoDuplicateTapaName(data.name, currentTapaEditId);
    if (duplicate){ setTapaMsg('Ya existe una tapa/corcho con ese nombre. Edita o activa el existente para evitar duplicados.', 'warn'); return; }

    const list = readTapaCatalog();
    const now = new Date().toISOString();
    const wasEdit = !!currentTapaEditId;
    let row = null;
    if (wasEdit){
      row = list.find(x => x && String(x.id) === String(currentTapaEditId));
      if (!row){ setTapaMsg('La tapa ya no existe. Actualiza e intenta de nuevo.', 'warn'); resetTapaForm(); await renderTapas(); return; }
    } else {
      const key = normalizeTapaKey(data.name);
      let id = 'tapa_' + hash36CAT(key + '_' + Date.now());
      const ids = new Set(list.map(x => String(x.id || '')));
      while (ids.has(id)) id = 'tapa_' + hash36CAT(key + '_' + Date.now() + '_' + Math.random());
      row = { id, createdAt:now, schemaVersion:TAPAS_SCHEMA_VERSION };
      list.push(row);
    }

    row.name = data.name;
    row.nombre = data.name;
    row.note = data.note;
    row.nota = data.note;
    row.active = data.active;
    row.updatedAt = now;
    row.updatedFrom = 'catalogos_tapas';

    if (!saveTapaCatalog(list)){ setTapaMsg('No se pudo guardar. Revisa almacenamiento local.', 'warn'); return; }
    resetTapaForm();
    await renderTapas();
    await normalizeProductPackagingFields();
    refreshProductPackagingSelects();
    await renderProducts();
    toast(wasEdit ? 'Tapa guardada' : 'Tapa agregada');
  }

  async function editTapaMaster(id){
    await openTapaModalCAT(id);
  }

  async function toggleTapaMaster(id){
    const list = readTapaCatalog();
    const row = list.find(x => x && String(x.id) === String(id));
    if (!row) return;
    row.active = !tapaActive(row);
    row.updatedAt = new Date().toISOString();
    row.updatedFrom = 'catalogos_tapas_toggle';
    if (!saveTapaCatalog(list)){ toast('No se pudo guardar'); return; }
    await renderTapas();
    refreshProductPackagingSelects();
    await renderProducts();
    toast(row.active === false ? 'Tapa inactivada' : 'Tapa activada');
  }

  async function deleteTapaMaster(id){
    const target = String(id || '').trim();
    if (!target) return;
    const list = readTapaCatalog();
    const row = list.find(x => x && String(x.id) === target);
    if (!row){ toast('Tapa no encontrada'); return; }
    const name = row.name || row.nombre || 'Tapa sin nombre';
    const ok = confirm(`¿Borrar la tapa/corcho "${name}"?

Solo se quitará del catálogo maestro. No se borrarán productos asociados, producción, inventario, lotes ni históricos.`);
    if (!ok) return;
    rememberCatalogDeleted('tapas', row);
    const next = list.filter(x => !(x && String(x.id) === target));
    if (!saveTapaCatalog(next)){ toast('No se pudo borrar'); return; }
    if (currentTapaEditId && String(currentTapaEditId) === target) closeTapaModalCAT();
    resetTapaForm();
    await renderTapas();
    refreshProductPackagingSelects();
    await renderProducts();
    toast('Tapa borrada');
  }

  function bindTapaUi(){
    const list = byId('cat-tapas-list');
    if (list){
      list.addEventListener('click', async (e)=>{
        const edit = e.target.closest('.cat-edit-tapa');
        const toggle = e.target.closest('.cat-toggle-tapa');
        const del = e.target.closest('.cat-delete-tapa');
        if (edit){ await editTapaMaster(edit.dataset.id); return; }
        if (toggle){ await toggleTapaMaster(toggle.dataset.id); return; }
        if (del){ await deleteTapaMaster(del.dataset.id); return; }
      });
    }
    byId('cat-save-tapa')?.addEventListener('click', ()=>saveTapaMaster().catch(err=>{ console.error(err); setTapaMsg('No se pudo guardar la tapa.', 'warn'); }));
    byId('cat-edit-tapa-save')?.addEventListener('click', ()=>saveTapaEditMaster().catch(err=>{ console.error(err); setTapaEditMsg('No se pudo guardar la tapa.', 'warn'); }));
    byId('cat-cancel-tapa')?.addEventListener('click', resetTapaForm);
    byId('cat-refresh-tapas')?.addEventListener('click', async ()=>{ await renderTapas(); toast('Tapas actualizadas'); });
    byId('cat-restore-tapas')?.addEventListener('click', async ()=>{ ensureTapasDefaults(true); resetTapaForm(); await normalizeProductPackagingFields(); refreshProductPackagingSelects(); await renderTapas(); await renderProducts(); toast('Tapas base revisadas'); });
  }

  async function initTapas(){
    ensureTapasDefaults(false);
    await renderTapas();
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

  function replaceCustomerCatalogCAT(list){
    const safe = normalizeCustomersCatalogCAT(Array.isArray(list) ? list : []);
    let ok = false;
    try{
      if (window.A33Storage && typeof A33Storage.sharedRead === 'function' && typeof A33Storage.sharedSet === 'function'){
        const r0 = A33Storage.sharedRead(CUSTOMER_CATALOG_KEY, [], 'local');
        const baseRev = (r0 && r0.meta && typeof r0.meta.rev === 'number') ? r0.meta.rev : null;
        const r = A33Storage.sharedSet(CUSTOMER_CATALOG_KEY, safe, { source:'catalogos_clientes_delete', baseRev });
        ok = !!(r && r.ok);
      } else if (window.A33Storage && typeof A33Storage.sharedSet === 'function'){
        const r = A33Storage.sharedSet(CUSTOMER_CATALOG_KEY, safe, { source:'catalogos_clientes_delete' });
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
            <button class="cat-btn cat-btn-danger cat-delete-customer" data-id="${escapeHtml(String(c.id))}" type="button">Borrar</button>
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

  async function deleteCustomerMaster(id){
    const cid = id != null ? String(id).trim() : '';
    if (!cid) return;
    const list = readCustomerCatalogCAT();
    const row = list.find(c => c && String(c.id) === cid);
    if (!row){ toast('Cliente no encontrado'); return; }
    const name = row.name || row.nombre || 'Cliente sin nombre';
    const ok = confirm(`¿Borrar el cliente "${name}"?

Solo se quitará del catálogo maestro/lista seleccionable. No se borrarán ventas, POS, agenda, pedidos ni históricos.`);
    if (!ok) return;
    rememberCatalogDeleted('customers', row);
    const next = list.filter(c => !(c && String(c.id) === cid));
    if (!replaceCustomerCatalogCAT(next)){ toast('No se pudo borrar'); return; }
    if (currentCustomerEditId && String(currentCustomerEditId) === cid) closeCustomerModalCAT();
    resetCustomerFormCAT();
    await renderCustomers();
    toast('Cliente borrado');
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
        const del = e.target.closest('.cat-delete-customer');
        if (edit && !edit.disabled){ editCustomerMaster(edit.dataset.id); return; }
        if (toggle && !toggle.disabled){ await toggleCustomerMaster(toggle.dataset.id); return; }
        if (del){ await deleteCustomerMaster(del.dataset.id); return; }
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





  function bindExtraBankUi(){
    const extrasList = byId('cat-extras-list');
    if (extrasList){
      extrasList.addEventListener('click', async (e)=>{
        const edit = e.target.closest('.cat-edit-extra');
        const toggle = e.target.closest('.cat-toggle-extra');
        const del = e.target.closest('.cat-delete-extra');
        if (edit){ await editExtraMaster(edit.dataset.id); return; }
        if (toggle){ await toggleExtraMaster(toggle.dataset.id); return; }
        if (del){ await deleteExtraMaster(del.dataset.id); return; }
      });
    }
    const banksList = byId('cat-banks-list');
    if (banksList){
      banksList.addEventListener('click', async (e)=>{
        const edit = e.target.closest('.cat-edit-bank');
        const toggle = e.target.closest('.cat-toggle-bank');
        const del = e.target.closest('.cat-delete-bank');
        if (edit){ await editBankMaster(edit.dataset.id); return; }
        if (toggle){ await toggleBankMaster(toggle.dataset.id); return; }
        if (del){ await deleteBankMaster(del.dataset.id); return; }
      });
    }
    byId('cat-save-extra')?.addEventListener('click', ()=>saveExtraMaster().catch(err=>{ console.error(err); alert('No se pudo guardar el extra.'); }));
    byId('cat-edit-extra-save')?.addEventListener('click', ()=>saveExtraEditMaster().catch(err=>{ console.error(err); setExtraEditMsg('No se pudo guardar el extra.', 'warn'); }));
    byId('cat-cancel-extra')?.addEventListener('click', resetExtraForm);
    byId('cat-refresh-extras')?.addEventListener('click', async ()=>{ await seedExtrasFromEventSnapshots(); await renderExtras(); toast('Extras actualizados'); });
    byId('cat-save-bank')?.addEventListener('click', ()=>saveBankMaster().catch(err=>{ console.error(err); alert('No se pudo guardar el banco.'); }));
    byId('cat-edit-bank-save')?.addEventListener('click', ()=>saveBankEditMaster().catch(err=>{ console.error(err); setBankEditMsg('No se pudo guardar el banco.', 'warn'); }));
    byId('cat-cancel-bank')?.addEventListener('click', resetBankForm);
    byId('cat-refresh-banks')?.addEventListener('click', async ()=>{ await renderBanks(); toast('Bancos actualizados'); });
    byId('cat-restore-banks')?.addEventListener('click', async ()=>{ await ensureBanksDefaultsCatalog(true); await renderBanks(); toast('Bancos base revisados'); });
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
        const del = e.target.closest('.cat-delete-product');
        if (edit){ await openProductModal(edit.dataset.id); return; }
        if (toggle){ await toggleProduct(toggle.dataset.id); return; }
        if (del){ await deleteProductMaster(del.dataset.id); return; }
      });
    }
    ['cat-new-letra','cat-edit-letra'].forEach((id)=>{
      byId(id)?.addEventListener('input', (event)=>{
        const el = event.target;
        const next = normalizeProductLetter(el && el.value);
        if (el && el.value !== next) el.value = next;
      });
    });
    ['cat-new-receta','cat-edit-receta'].forEach((id)=>{
      byId(id)?.addEventListener('change', (event)=>{
        const isEdit = id.indexOf('edit') >= 0;
        const prefix = isEdit ? 'cat-edit' : 'cat-new';
        const checked = !!(event.target && event.target.checked);
        const msg = checked ? 'Receta activa: Letra obligatoria; Envase y Tapa recomendados para producción futura.' : '';
        if (isEdit) setEditMsg(msg, checked ? 'warn' : '');
        else setStatus(msg || 'Productos actualizados.', checked ? 'warn' : 'ok');
        if (checked){
          const letraEl = byId(prefix + '-letra');
          try{ letraEl?.focus({ preventScroll:true }); }catch(_){ }
        }
      });
    });
    byId('cat-add-product')?.addEventListener('click', ()=>addProduct().catch(err=>{ console.error(err); alert('No se pudo agregar el producto.'); }));
    byId('cat-refresh-products')?.addEventListener('click', ()=>initProducts().catch(err=>{ console.error(err); setStatus('No se pudo actualizar.', 'warn'); }));
    byId('cat-restore-seed')?.addEventListener('click', async ()=>{
      const ok = confirm('¿Restaurar los productos base A33 que no existan?\n\nEsta acción es manual, evita duplicados y no sobrescribe productos personalizados.');
      if (!ok) return;
      setStatus('Restaurando productos base…');
      try{
        const result = await seedMissingDefaults(true);
        refreshProductPackagingSelects();
        await renderProducts();
        const added = Number(result && result.added) || 0;
        setStatus(added ? `Guardado correcto. ${added} producto(s) base restaurado(s).` : 'No había productos base pendientes de restaurar.', added ? 'ok' : '');
        toast(added ? 'Productos base restaurados' : 'Sin cambios');
      }catch(err){
        console.error(err);
        setStatus('No se pudo guardar el producto.', 'warn');
        toast('No se pudo restaurar');
      }
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

  async function initProducts(){
    setStatus('Cargando productos…');
    await openDB();
    // No sembrar productos aquí. Un catálogo nuevo o vacío debe permanecer vacío.
    ensureEnvasesDefaults(false);
    ensureTapasDefaults(false);
    // Catálogos es la fuente canónica: al abrir solo se lee y renderiza, sin migrar ni reescribir productos.
    refreshProductPackagingSelects();
    await renderProducts();
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindTabs();
    bindProductUi();
    bindEnvaseUi();
    bindTapaUi();
    bindExtraBankUi();
    bindCostsUi();
    bindMasterEditModalChromeCAT();
    bindCustomerUi();
    activateTabFromUrl();
    if (!qs('.cat-panel.is-active')) activateTab('productos');
    try{ if (window.A33_applyReleaseLabel) window.A33_applyReleaseLabel(); }catch(_){ }
    initProducts().catch(err=>{
      console.error(err);
      setStatus('No se pudo abrir Catálogos → Productos. Cierra otras pestañas de Suite A33 y vuelve a intentar.', 'warn');
    });
    initEnvases().catch(err=>{
      console.error(err);
      setStatusById('cat-envases-status', 'No se pudo abrir Catálogos → Envases.', 'warn');
    });
    initTapas().catch(err=>{
      console.error(err);
      setStatusById('cat-tapas-status', 'No se pudo abrir Catálogos → Tapas.', 'warn');
    });
    initCosts().catch(err=>{
      console.error(err);
      setCostsStatus('No se pudo abrir Catálogos → Costos.', 'warn');
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
    window.addEventListener('hashchange', activateTabFromUrl);
    registerServiceWorker();
  });
})();
