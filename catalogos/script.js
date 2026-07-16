(function(){
  'use strict';

  const DB_NAME = 'a33-pos';
  const DB_VER = 35;
  const DEFAULT_GALON_PRICE = 900;
  const LEGACY_GALON_PRICE = 800;
  const CANON_GALON_LABEL = 'Galón 3720 ml';
  // Productos no se siembran: Catálogos → Productos es la única fuente oficial.


  let db = null;
  let currentEditId = null;
  let currentExtraEditId = null;
  let currentBankEditId = null;
  let currentEnvaseEditId = null;
  let currentTapaEditId = null;
  let currentCustomerEditId = null;
  let currentCustomerViewId = null;
  let customerRenderTokenCAT = 0;
  let customerSearchTimerCAT = null;
  let customerLastPurchaseLoadPromiseCAT = null;
  let customerLastPurchaseCacheCAT = { loaded:false, loadedAt:0, byId:new Map(), sourceSales:0, sourceArchives:0 };
  const customerExpandedGroupsCAT = new Set();

  const COSTS_STORAGE_KEY = 'a33_catalogos_costos_v1';
  const COSTS_RECIPES_STORAGE_KEY = 'arcano33_recetas_v1';
  const COSTS_SCHEMA_VERSION = 2;
  const CATALOG_ACTIVE_TAB_KEY = 'a33_catalogos_active_tab_v1';
  const CATALOG_ALLOWED_TABS = new Set(['productos','costos','envases','tapas','extras','bancos','clientes']);
  const COST_LIQUIDS = [
    { key:'vino', label:'Vino' },
    { key:'vodka', label:'Vodka' },
    { key:'jugo', label:'Jugo' },
    { key:'sirope', label:'Sirope' },
    { key:'agua_pura', label:'Agua pura', inputKey:'agua-pura' }
  ];
  const COST_RECIPE_INGREDIENT_KEYS = {
    vino:['vino','vino_tinto','vinotinto'],
    vodka:['vodka'],
    jugo:['jugo','jugo_fruta','jugofruta','juice'],
    sirope:['sirope','jarabe','syrup'],
    agua_pura:['agua','agua_pura','aguapura','water']
  };

  const CUSTOMER_CATALOG_KEY = 'a33_pos_customersCatalog';
  const CUSTOMER_DISABLED_KEY = 'a33_pos_customersDisabled';
  const CUSTOMER_SCHEMA_VERSION = 1;
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
    const key = String(target || '').trim().toLowerCase();
    if (!CATALOG_ALLOWED_TABS.has(key)) return;
    qsa('.cat-tab').forEach((tab) => {
      const active = tab.getAttribute('data-target') === key;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.setAttribute('tabindex', active ? '0' : '-1');
    });
    qsa('.cat-panel').forEach((panel) => {
      const active = panel.getAttribute('data-panel') === key;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });
    try{ localStorage.setItem(CATALOG_ACTIVE_TAB_KEY, key); }catch(_){ }
    if (key === 'costos' && db) scheduleCostsProductsRefresh();
  }

  function getInitialTabFromUrl(){
    let key = '';
    try{
      key = String(new URLSearchParams(window.location.search || '').get('tab') || '').trim().toLowerCase();
    }catch(_){ key = ''; }
    if (!key) {
      key = String((window.location.hash || '').replace(/^#/, '')).trim().toLowerCase();
    }
    if (!key){
      try{ key = String(localStorage.getItem(CATALOG_ACTIVE_TAB_KEY) || '').trim().toLowerCase(); }catch(_){ key = ''; }
    }
    return CATALOG_ALLOWED_TABS.has(key) ? key : '';
  }

  function activateTabFromUrl(){
    const key = getInitialTabFromUrl();
    if (key) activateTab(key);
  }

  function bindTabs(){
    const tabs = qsa('.cat-tab');
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-target');
        activateTab(target);
        try { window.history.replaceState(null, '', '#' + target); } catch(_){ }
      });
      tab.addEventListener('keydown', (event) => {
        if (!event || !['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = tabs.length - 1;
        const next = tabs[nextIndex];
        const target = next && next.getAttribute('data-target');
        if (!target) return;
        activateTab(target);
        try { window.history.replaceState(null, '', '#' + target); } catch(_){ }
        try { next.focus({ preventScroll:true }); } catch(_){ try{ next.focus(); }catch(__){ } }
      });
    });
  }


  function setCostsStatus(message, kind){
    const el = byId('cat-costs-status');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-status' + (kind ? (' ' + kind) : '');
  }

  function emptyCostsState(){
    const liquids = {};
    COST_LIQUIDS.forEach((row) => { liquids[row.key] = { price:null, ml:null }; });
    return {
      schemaVersion:COSTS_SCHEMA_VERSION,
      liquids,
      consumablesByProduct:{},
      updatedAt:null
    };
  }

  function finiteNonNegativeOrNull(value){
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const n = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function normalizeCostsState(raw){
    const base = emptyCostsState();
    const src = raw && typeof raw === 'object' ? raw : {};
    const liquids = src.liquids && typeof src.liquids === 'object' ? src.liquids : src;
    COST_LIQUIDS.forEach((row) => {
      const item = liquids && liquids[row.key] && typeof liquids[row.key] === 'object' ? liquids[row.key] : {};
      base.liquids[row.key] = {
        price: finiteNonNegativeOrNull(item.price),
        ml: finiteNonNegativeOrNull(item.ml)
      };
    });

    const consumables = (
      src.consumablesByProduct && typeof src.consumablesByProduct === 'object' ? src.consumablesByProduct :
      src.consumiblesPorProducto && typeof src.consumiblesPorProducto === 'object' ? src.consumiblesPorProducto :
      {}
    );
    Object.entries(consumables).forEach(([rawProductId, rawItem]) => {
      const productId = costsStringId(rawProductId);
      if (!productId || !rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return;
      const bottle = finiteNonNegativeOrNull(rawItem.botella ?? rawItem.bottle);
      const label = finiteNonNegativeOrNull(rawItem.calcomania ?? rawItem.calcomanía ?? rawItem.label ?? rawItem.sticker);
      if (bottle === null && label === null) return;
      base.consumablesByProduct[productId] = { botella:bottle, calcomania:label };
    });

    base.updatedAt = typeof src.updatedAt === 'string' ? src.updatedAt : null;
    return base;
  }

  function readCostsState(){
    try{
      const raw = localStorage.getItem(COSTS_STORAGE_KEY);
      if (!raw) return emptyCostsState();
      return normalizeCostsState(JSON.parse(raw));
    }catch(err){
      try{ console.warn('[Suite A33] Costos: configuración local inválida.', err); }catch(_){ }
      return emptyCostsState();
    }
  }

  function writeCostsState(state){
    const clean = normalizeCostsState(state);
    clean.schemaVersion = COSTS_SCHEMA_VERSION;
    clean.updatedAt = new Date().toISOString();
    localStorage.setItem(COSTS_STORAGE_KEY, JSON.stringify(clean));
    return clean;
  }

  function costsInputId(row, field){
    return 'cat-cost-' + String(row.inputKey || row.key).replace(/_/g, '-') + '-' + field;
  }

  function renderCostsState(state){
    const clean = normalizeCostsState(state);
    COST_LIQUIDS.forEach((row) => {
      ['price','ml'].forEach((field) => {
        const input = byId(costsInputId(row, field));
        if (!input) return;
        const value = clean.liquids[row.key][field];
        input.value = value === null ? '' : String(value);
        input.setAttribute('aria-invalid', 'false');
      });
    });
  }

  function readCostsForm(){
    const state = normalizeCostsState(readCostsState());
    let firstInvalid = null;
    let message = '';

    const markInvalid = (input, text) => {
      if (input) input.setAttribute('aria-invalid', 'true');
      if (!firstInvalid){
        firstInvalid = input;
        message = text;
      }
    };

    qsa('.cat-cost-input, .cat-cost-consumable-input').forEach((input) => input.setAttribute('aria-invalid', 'false'));

    COST_LIQUIDS.forEach((row) => {
      const priceInput = byId(costsInputId(row, 'price'));
      const mlInput = byId(costsInputId(row, 'ml'));
      const priceRaw = String((priceInput && priceInput.value) || '').trim().replace(',', '.');
      const mlRaw = String((mlInput && mlInput.value) || '').trim().replace(',', '.');
      const price = priceRaw === '' ? null : Number(priceRaw);
      const ml = mlRaw === '' ? null : Number(mlRaw);

      if (price !== null && (!Number.isFinite(price) || price < 0)) markInvalid(priceInput, `Precio inválido en ${row.label}.`);
      if (ml !== null && (!Number.isFinite(ml) || ml < 0)) markInvalid(mlInput, `ML inválido en ${row.label}.`);
      if (price !== null && Number.isFinite(price) && price >= 0 && (ml === null || !(ml > 0))){
        markInvalid(mlInput, `Ingresa ML mayor que cero para ${row.label} cuando exista Precio.`);
      }

      state.liquids[row.key] = {
        price:price !== null && Number.isFinite(price) && price >= 0 ? price : null,
        ml:ml !== null && Number.isFinite(ml) && ml >= 0 ? ml : null
      };
    });

    qsa('.cat-cost-consumable-input').forEach((input) => {
      const productId = costsStringId(input.dataset.productId);
      const field = String(input.dataset.costConsumable || '').trim();
      if (!productId || !['botella','calcomania'].includes(field)) return;
      const raw = String(input.value || '').trim().replace(',', '.');
      const value = raw === '' ? null : Number(raw);
      const label = field === 'botella' ? 'Botella' : 'Calcomanía';
      const productName = String(input.dataset.productName || 'el producto');
      if (value !== null && (!Number.isFinite(value) || value < 0)){
        markInvalid(input, `${label} inválida en ${productName}.`);
      }
      const item = state.consumablesByProduct[productId] || { botella:null, calcomania:null };
      item[field] = value !== null && Number.isFinite(value) && value >= 0 ? value : null;
      if (item.botella === null && item.calcomania === null) delete state.consumablesByProduct[productId];
      else state.consumablesByProduct[productId] = item;
    });

    return { ok:!firstInvalid, state, message, firstInvalid };
  }

  function saveCosts(){
    const checked = readCostsForm();
    if (!checked.ok){
      setCostsStatus(checked.message, 'warn');
      try{ checked.firstInvalid.focus({ preventScroll:false }); }catch(_){ try{ checked.firstInvalid.focus(); }catch(__){ } }
      return;
    }
    try{
      const saved = writeCostsState(checked.state);
      renderCostsState(saved);
      scheduleCostsProductsRefresh();
      setCostsStatus('Costos guardados correctamente.', 'ok');
      toast('Costos guardados correctamente');
    }catch(err){
      try{ console.error('[Suite A33] Costos: no se pudo guardar.', err); }catch(_){ }
      setCostsStatus('No se pudieron guardar los costos en este dispositivo.', 'warn');
    }
  }

  function bindCostsUi(){
    byId('cat-save-costs')?.addEventListener('click', saveCosts);
    qsa('.cat-cost-input').forEach((input) => {
      input.addEventListener('input', () => {
        input.setAttribute('aria-invalid', 'false');
        if (byId('cat-costs-status')?.classList.contains('warn')) setCostsStatus('Cambios sin guardar.');
        updateCostsComputedFromForm();
      });
      input.addEventListener('focus', () => {
        try{ input.select(); }catch(_){ }
      });
      input.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter'){
          event.preventDefault();
          saveCosts();
        }
      });
    });

    const body = byId('cat-costs-body');
    body?.addEventListener('input', (event) => {
      const input = event.target && event.target.closest ? event.target.closest('.cat-cost-consumable-input') : null;
      if (!input) return;
      input.setAttribute('aria-invalid', 'false');
      setCostsStatus('Cambios sin guardar.');
      updateCostsComputedFromForm();
    });
    body?.addEventListener('focusin', (event) => {
      const input = event.target && event.target.closest ? event.target.closest('.cat-cost-consumable-input') : null;
      if (!input) return;
      setTimeout(() => { try{ input.select(); }catch(_){ } }, 0);
    });
    body?.addEventListener('keydown', (event) => {
      const input = event.target && event.target.closest ? event.target.closest('.cat-cost-consumable-input') : null;
      if (!input) return;
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter'){
        event.preventDefault();
        saveCosts();
      }
    });
  }

  function initCosts(){
    const state = readCostsState();
    renderCostsState(state);
    setCostsStatus(state.updatedAt ? 'Configuración de costos cargada.' : 'Configura los líquidos y presiona Guardar.', state.updatedAt ? 'ok' : '');
  }

  function setCostsRecipeStatus(message, kind){
    const el = byId('cat-costs-recipe-status');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'cat-status cat-costs-recipe-status' + (kind ? (' ' + kind) : '');
  }

  function costsPlainObject(value){
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function costsLookupKey(value){
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function costsStringId(value){
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function costsRecipeNumber(value){
    if (value === null || value === undefined || String(value).trim() === '') return 0;
    const n = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function costsRecipeLooksLike(value){
    if (!costsPlainObject(value)) return false;
    const keys = Object.keys(value).map(costsLookupKey);
    const known = new Set(Object.values(COST_RECIPE_INGREDIENT_KEYS).flat().map(costsLookupKey));
    if (keys.some(key => known.has(key))) return true;
    const nestedKeys = new Set(['ingredientes','ingredients','liquidos','liquids','receta','recipe']);
    return Object.entries(value).some(([key, nested]) => nestedKeys.has(costsLookupKey(key)) && (costsPlainObject(nested) || Array.isArray(nested)));
  }

  function readCostsRecipesPayload(){
    let raw = null;
    try{
      raw = window.A33Storage && typeof A33Storage.getItem === 'function'
        ? A33Storage.getItem(COSTS_RECIPES_STORAGE_KEY)
        : localStorage.getItem(COSTS_RECIPES_STORAGE_KEY);
    }catch(_){ raw = null; }

    if (raw === null || raw === undefined || String(raw).trim() === ''){
      return { state:'empty', payload:null, recipes:{}, metadata:[], message:'No hay recetas guardadas en Calculadora de Producción.' };
    }

    let payload = null;
    try{ payload = JSON.parse(raw); }
    catch(err){
      try{ console.warn('[Suite A33] Costos: arcano33_recetas_v1 contiene JSON inválido.', err); }catch(_){ }
      return { state:'damaged', payload:null, recipes:{}, metadata:[], message:'Las recetas guardadas no se pudieron leer. Costos sigue operativo y no se borró información.' };
    }

    if (!costsPlainObject(payload)){
      return { state:'damaged', payload:null, recipes:{}, metadata:[], message:'El formato de recetas no es válido. Costos sigue operativo y no se borró información.' };
    }

    let recipes = {};
    if (costsPlainObject(payload.recetas)){
      recipes = payload.recetas;
    }else{
      Object.entries(payload).forEach(([key, value]) => {
        if (['version','productos','costospresentacion'].includes(costsLookupKey(key))) return;
        if (costsRecipeLooksLike(value)) recipes[key] = value;
      });
    }

    const cleanRecipes = {};
    Object.entries(recipes).forEach(([key, value]) => {
      if (!costsPlainObject(value)) return;
      cleanRecipes[costsStringId(key)] = value;
    });

    const metadata = [];
    const addMetadata = (value, fallbackId, source) => {
      if (!costsPlainObject(value)) return;
      const internalId = costsStringId(value.id ?? value.presentationId ?? value.presentacionId ?? value.recipeId ?? fallbackId);
      const productId = costsStringId(value.productId ?? value.productoId ?? value.catalogProductId ?? value.idProducto);
      const name = String(value.nombre ?? value.name ?? value.nombreSnapshot ?? value.productName ?? '').replace(/\s+/g, ' ').trim();
      const letter = String(value.letra ?? value.Letra ?? value.letter ?? value.productionLetter ?? '').trim().toUpperCase();
      const capacity = positiveNumberOrNull(value.capacidadMl ?? value.capacityMl ?? value.volumenMl ?? value.volumeMl ?? value.ml);
      if (!internalId && !productId && !name && !letter && !capacity) return;
      metadata.push({ internalId:internalId || costsStringId(fallbackId), productId, name, letter, capacity, source });
    };

    if (Array.isArray(payload.productos)){
      payload.productos.forEach(value => addMetadata(value, '', 'productos'));
    }else if (costsPlainObject(payload.productos)){
      Object.entries(payload.productos).forEach(([key, value]) => addMetadata(value, key, 'productos'));
    }
    if (costsPlainObject(payload.costosPresentacion)){
      Object.entries(payload.costosPresentacion).forEach(([key, value]) => addMetadata(value, key, 'costosPresentacion'));
    }
    Object.entries(cleanRecipes).forEach(([key, value]) => addMetadata(value, key, 'receta'));

    const recipeCount = Object.keys(cleanRecipes).length;
    return {
      state:recipeCount ? 'ok' : 'empty',
      payload,
      recipes:cleanRecipes,
      metadata,
      message:recipeCount ? '' : 'No hay recetas guardadas en Calculadora de Producción.'
    };
  }

  function costsProductId(product){
    const row = product && typeof product === 'object' ? product : {};
    try{
      if (window.A33Products && typeof window.A33Products.getProductId === 'function'){
        return costsStringId(window.A33Products.getProductId(row));
      }
    }catch(_){ }
    return costsStringId(row.productId ?? row.productoId ?? row.catalogProductId);
  }

  function resolveCostsProductRecipe(product, recipeData){
    const recipes = recipeData && costsPlainObject(recipeData.recipes) ? recipeData.recipes : {};
    const metadata = recipeData && Array.isArray(recipeData.metadata) ? recipeData.metadata : [];
    const productId = costsProductId(product);
    if (!productId) return { status:'no_recipe', productId:'', reason:'missing_productId' };

    // Relación estricta: solo la clave exacta productId o metadata con el mismo productId.
    if (costsPlainObject(recipes[productId])){
      return { status:'ok', id:productId, recipe:recipes[productId], reason:'productId', productId };
    }

    const exactIds = [];
    metadata.forEach((meta) => {
      if (costsStringId(meta && meta.productId) !== productId) return;
      const internalId = costsStringId(meta && meta.internalId);
      if (internalId && costsPlainObject(recipes[internalId])) exactIds.push(internalId);
    });
    const uniqueIds = Array.from(new Set(exactIds));
    if (uniqueIds.length === 1){
      return { status:'ok', id:uniqueIds[0], recipe:recipes[uniqueIds[0]], reason:'metadata_productId', productId };
    }
    if (uniqueIds.length > 1) return { status:'unresolved', productId, candidates:uniqueIds };
    return { status:'no_recipe', productId, reason:'no_exact_productId_recipe' };
  }

  function costsIngredientValueFromObject(container, aliases){
    if (!costsPlainObject(container)) return { found:false, value:0 };
    const aliasKeys = aliases.map(costsLookupKey);
    for (const alias of aliases){
      if (Object.prototype.hasOwnProperty.call(container, alias)){
        const value = costsRecipeNumber(container[alias]);
        return { found:true, value, invalid:value === null };
      }
    }
    for (const [key, raw] of Object.entries(container)){
      if (!aliasKeys.includes(costsLookupKey(key))) continue;
      const value = costsRecipeNumber(raw);
      return { found:true, value, invalid:value === null };
    }
    return { found:false, value:0 };
  }

  function costsIngredientMl(recipe, liquidKey){
    const aliases = COST_RECIPE_INGREDIENT_KEYS[liquidKey] || [liquidKey];
    const direct = costsIngredientValueFromObject(recipe, aliases);
    if (direct.found) return direct;

    const nestedKeys = new Set(['ingredientes','ingredients','liquidos','liquids','receta','recipe']);
    for (const [nestedKey, nested] of Object.entries(costsPlainObject(recipe) ? recipe : {})){
      if (!nestedKeys.has(costsLookupKey(nestedKey))) continue;
      const nestedObject = costsIngredientValueFromObject(nested, aliases);
      if (nestedObject.found) return nestedObject;
      if (Array.isArray(nested)){
        for (const row of nested){
          if (!costsPlainObject(row)) continue;
          const rowId = costsLookupKey(row.id ?? row.key ?? row.codigo ?? row.ingrediente ?? row.name ?? row.nombre ?? row.tipo);
          if (!aliases.map(costsLookupKey).includes(rowId)) continue;
          const value = costsRecipeNumber(row.ml ?? row.cantidad ?? row.quantity ?? row.value ?? row.amount ?? row.volumenMl);
          return { found:true, value, invalid:value === null };
        }
      }
    }
    return { found:false, value:0, invalid:false };
  }

  const COSTS_MONEY_FORMATTER = new Intl.NumberFormat('es-NI', {
    minimumFractionDigits:2,
    maximumFractionDigits:2
  });

  function costsMoney(value){
    const n = Number(value);
    return 'C$' + COSTS_MONEY_FORMATTER.format(Number.isFinite(n) && n >= 0 ? n : 0);
  }

  function costsConsumableItem(state, productId){
    const clean = state && state.consumablesByProduct && typeof state.consumablesByProduct === 'object'
      ? state.consumablesByProduct[costsStringId(productId)]
      : null;
    return clean && typeof clean === 'object'
      ? { botella:finiteNonNegativeOrNull(clean.botella), calcomania:finiteNonNegativeOrNull(clean.calcomania) }
      : { botella:null, calcomania:null };
  }

  function calculateCostsForProduct(resolution, costsState){
    if (!resolution || resolution.status === 'no_recipe'){
      return { status:'no_recipe', total:0, liquidCosts:{}, missing:['receta'] };
    }
    if (resolution.status === 'unresolved'){
      return { status:'unresolved', total:0, liquidCosts:{}, missing:['relación de receta'] };
    }

    const liquidCosts = {};
    const missing = [];
    let total = 0;
    COST_LIQUIDS.forEach((row) => {
      const ingredient = costsIngredientMl(resolution.recipe, row.key);
      if (ingredient.invalid){
        liquidCosts[row.key] = { status:'invalid_recipe', cost:null, usedMl:null };
        missing.push(`receta ${row.label}`);
        return;
      }
      const liquid = costsState && costsState.liquids ? costsState.liquids[row.key] : null;
      const price = liquid ? finiteNonNegativeOrNull(liquid.price) : null;
      const purchasedMl = liquid ? finiteNonNegativeOrNull(liquid.ml) : null;
      if (price === null || purchasedMl === null || !(purchasedMl > 0)){
        liquidCosts[row.key] = { status:'pending', cost:null, usedMl:ingredient.value || 0 };
        missing.push(row.label);
        return;
      }
      const usedMl = ingredient.value || 0;
      const costPerMl = price / purchasedMl;
      const cost = costPerMl * usedMl;
      if (!Number.isFinite(cost) || cost < 0){
        liquidCosts[row.key] = { status:'invalid', cost:null, usedMl };
        missing.push(row.label);
        return;
      }
      liquidCosts[row.key] = { status:'ok', cost, usedMl, price, purchasedMl, costPerMl };
      total += cost;
    });

    const consumables = costsConsumableItem(costsState, resolution.productId);
    if (consumables.botella === null) missing.push('Botella');
    else total += consumables.botella;
    if (consumables.calcomania === null) missing.push('Calcomanía');
    else total += consumables.calcomania;

    return {
      status:missing.length ? 'pending' : 'complete',
      total:Number.isFinite(total) && total >= 0 ? total : 0,
      liquidCosts,
      consumables,
      missing
    };
  }

  function renderCostsLiquidCell(td, rowKey, productName, calculation){
    if (!td) return;
    td.replaceChildren();
    const span = document.createElement('span');
    span.className = 'cat-cost-cell-value';
    if (!calculation || calculation.status === 'no_recipe'){
      span.textContent = 'Sin receta';
      span.classList.add('is-muted');
      span.title = `No existe una receta guardada para ${productName}.`;
      td.appendChild(span);
      return;
    }
    if (calculation.status === 'unresolved'){
      span.textContent = 'Sin relación';
      span.classList.add('is-warning');
      span.title = `La receta de ${productName} no pudo relacionarse de forma segura con su productId.`;
      td.appendChild(span);
      return;
    }

    const item = calculation.liquidCosts && calculation.liquidCosts[rowKey];
    if (!item || item.status === 'pending'){
      span.textContent = 'Pendiente';
      span.classList.add('is-muted');
      span.title = `Completa Precio y ML de ${rowKey.replace('_', ' ')} para calcular ${productName}.`;
      td.appendChild(span);
      return;
    }
    if (item.status === 'invalid_recipe'){
      span.textContent = 'Revisar receta';
      span.classList.add('is-warning');
      span.title = `La cantidad de ${rowKey.replace('_', ' ')} en la receta de ${productName} no es válida.`;
      td.appendChild(span);
      return;
    }
    if (item.status !== 'ok'){
      span.textContent = 'Costo incompleto';
      span.classList.add('is-error');
      td.appendChild(span);
      return;
    }

    span.textContent = costsMoney(item.cost);
    span.classList.add('is-calculated');
    span.title = [
      `${productName} · ${rowKey.replace('_', ' ')}`,
      `Precio de compra: ${costsMoney(item.price)}`,
      `ML comprados: ${item.purchasedMl}`,
      `Costo por ml: ${item.costPerMl.toFixed(6)}`,
      `ML utilizados: ${item.usedMl}`,
      `Costo calculado: ${costsMoney(item.cost)}`
    ].join('\n');
    span.setAttribute('aria-label', `${rowKey.replace('_', ' ')} para ${productName}: ${costsMoney(item.cost)}`);
    td.appendChild(span);
  }

  function renderCostsConsumableCell(td, field, productId, productName, costsState){
    if (!td) return;
    td.replaceChildren();
    const item = costsConsumableItem(costsState, productId);
    const input = document.createElement('input');
    input.className = 'cat-cost-input cat-cost-consumable-input a33-num';
    input.type = 'number';
    input.inputMode = 'decimal';
    input.step = '0.01';
    input.min = '0';
    input.placeholder = 'Vacío';
    input.dataset.a33Num = '1';
    input.dataset.a33Default = '';
    input.dataset.productId = costsStringId(productId);
    input.dataset.productName = productName;
    input.dataset.costConsumable = field;
    input.setAttribute('aria-invalid', 'false');
    const label = field === 'botella' ? 'Botella' : 'Calcomanía';
    input.setAttribute('aria-label', `${label} para ${productName}`);
    const value = item[field];
    input.value = value === null ? '' : String(value);
    td.appendChild(input);
  }

  function renderCostsTotalCell(td, productName, calculation){
    if (!td) return;
    td.replaceChildren();
    const wrap = document.createElement('span');
    wrap.className = 'cat-cost-total-value';
    if (!calculation || calculation.status === 'no_recipe'){
      wrap.textContent = 'Sin receta';
      wrap.classList.add('is-muted');
    }else if (calculation.status === 'unresolved'){
      wrap.textContent = 'Costo incompleto';
      wrap.classList.add('is-warning');
      wrap.title = 'La receta no pudo relacionarse de forma segura con el producto.';
    }else if (calculation.status === 'complete'){
      wrap.textContent = costsMoney(calculation.total);
      wrap.classList.add('is-complete');
      wrap.setAttribute('aria-label', `Costo total de ${productName}: ${costsMoney(calculation.total)}`);
    }else{
      wrap.classList.add('is-pending');
      wrap.innerHTML = `<strong>${costsMoney(calculation.total)}</strong><small>Pendiente</small>`;
      wrap.title = `Falta configurar: ${(calculation.missing || []).join(', ') || 'información de costos'}.`;
      wrap.setAttribute('aria-label', `Costo parcial de ${productName}: ${costsMoney(calculation.total)}. Pendiente.`);
    }
    td.appendChild(wrap);
  }

  function findCostsProductCell(rowKey, productId){
    const body = byId('cat-costs-body');
    const row = qsa('tr[data-cost-row]', body).find((node) => String(node.dataset.costRow || '') === String(rowKey || ''));
    if (!row) return null;
    return qsa('td[data-product-id]', row).find((node) => String(node.dataset.productId || '') === String(productId || '')) || null;
  }

  let costsProductContexts = [];

  function renderCostsSummary(contexts, costsState){
    const list = Array.isArray(contexts) ? contexts : [];
    let complete = 0;
    let pending = 0;
    let noRecipe = 0;
    list.forEach((ctx) => {
      const calculation = calculateCostsForProduct(ctx.resolution, costsState);
      if (calculation.status === 'complete') complete += 1;
      else if (calculation.status === 'no_recipe' || calculation.status === 'unresolved') noRecipe += 1;
      else pending += 1;
    });
    const values = {
      'cat-costs-summary-visible':list.length,
      'cat-costs-summary-complete':complete,
      'cat-costs-summary-pending':pending,
      'cat-costs-summary-no-recipe':noRecipe
    };
    Object.entries(values).forEach(([id, value]) => {
      const el = byId(id);
      if (el) el.textContent = String(value);
    });
  }

  function updateCostsComputedFromForm(){
    const checked = readCostsForm();
    const state = checked.state || readCostsState();
    costsProductContexts.forEach((ctx) => {
      const calculation = calculateCostsForProduct(ctx.resolution, state);
      COST_LIQUIDS.forEach((row) => renderCostsLiquidCell(findCostsProductCell(row.key, ctx.productId), row.key, ctx.name, calculation));
      renderCostsTotalCell(findCostsProductCell('total', ctx.productId), ctx.name, calculation);
    });
    renderCostsSummary(costsProductContexts, state);
  }

  let costsProductsRefreshTimer = null;
  let costsProductsRenderToken = 0;

  function positiveNumberOrNull(value){
    const n = Number(String(value ?? '').trim().replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function costsProductOrderValue(product){
    const p = product && typeof product === 'object' ? product : {};
    const candidates = [p.order, p.orden, p.position, p.posicion, p.sortOrder, p.displayOrder, p.orderIndex];
    for (const value of candidates){
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  function costsProductsInOperationalOrder(products){
    const decorated = (Array.isArray(products) ? products : []).map((product, index) => ({
      product,
      index,
      order:costsProductOrderValue(product)
    }));
    if (!decorated.some(item => item.order !== null)) return decorated.map(item => item.product);
    decorated.sort((a, b) => {
      if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
      if (a.order !== null && b.order === null) return -1;
      if (a.order === null && b.order !== null) return 1;
      return a.index - b.index;
    });
    return decorated.map(item => item.product);
  }

  function costsCapacityFromName(name){
    const text = String(name || '');
    const match = text.match(/(\d+(?:[.,]\d+)?)\s*(ml|mililitros?|l|lt|litros?)\b/i);
    if (!match) return null;
    const value = positiveNumberOrNull(match[1]);
    if (!value) return null;
    const unit = String(match[2] || '').toLowerCase();
    return unit.startsWith('l') && value < 100 ? Math.round(value * 1000) : Math.round(value);
  }

  function costsProductCapacityMl(product, envases){
    const p = product && typeof product === 'object' ? product : {};
    const finishedId = mapProductNameToFinishedId(p.name || p.nombre || '');
    if (finishedId === 'galon') return 3720;

    const directCandidates = [p.capacityMl, p.capacidadMl, p.capacity, p.capacidad, p.volumeMl, p.volumenMl, p.ml, p.mililitros, p.sizeMl];
    for (const value of directCandidates){
      const n = positiveNumberOrNull(value);
      if (n) return Math.round(n);
    }

    const envaseId = productEnvaseId(p);
    if (envaseId){
      const envase = (Array.isArray(envases) ? envases : []).find(row => row && String(row.id || '').trim() === envaseId);
      const envaseMl = envaseCapacity(envase);
      if (envaseMl > 0) return envaseMl;
    }

    const fromName = costsCapacityFromName(p.name || p.nombre || '');
    if (fromName) return fromName;

    const legacy = { pulso:250, media:375, djeba:750, litro:1000, galon:3720 };
    return legacy[finishedId || ''] || 0;
  }

  function costsProductHeaderName(product){
    const p = product && typeof product === 'object' ? product : {};
    const raw = String(p.name || p.nombre || 'Producto').replace(/\s+/g, ' ').trim() || 'Producto';
    if (mapProductNameToFinishedId(raw) === 'galon') return 'Galón';
    const withoutTrailingCapacity = raw.replace(/\s*[-–—·,/]*\s*\(?\d+(?:[.,]\d+)?\s*(?:ml|mililitros?|l|lt|litros?)\)?\s*$/i, '').trim();
    return withoutTrailingCapacity || raw;
  }

  function clearCostsProductColumns(){
    qsa('[data-cost-product-column="1"]').forEach((node) => node.remove());
  }

  function setCostsEmptyState(show, message){
    const empty = byId('cat-costs-empty');
    if (!empty) return;
    empty.textContent = message || 'No hay productos activos con Receta disponibles para calcular.';
    empty.hidden = !show;
  }

  async function renderCostsProductColumns(){
    const table = qs('.cat-costs-table');
    const colgroup = byId('cat-costs-colgroup');
    const headRow = byId('cat-costs-head-row');
    const body = byId('cat-costs-body');
    if (!table || !colgroup || !headRow || !body) return;

    const token = ++costsProductsRenderToken;
    try{
      await openDB();
      const all = (window.A33Products && typeof window.A33Products.getAll === 'function')
        ? await window.A33Products.getAll()
        : await getAll('products');
      if (token !== costsProductsRenderToken) return;

      const activeProducts = costsProductsInOperationalOrder(all).filter((product) => product && product.active !== false && product.deleted !== true && !!costsProductId(product));
      const products = activeProducts.filter((product) => {
        if (!product || product.active === false || product.deleted === true || !productHasRecipe(product)) return false;
        return !!costsProductId(product);
      });
      const duplicateHeaderCounts = new Map();
      products.forEach((product) => {
        const key = costsLookupKey(costsProductHeaderName(product));
        if (key) duplicateHeaderCounts.set(key, (duplicateHeaderCounts.get(key) || 0) + 1);
      });
      const envases = readEnvaseCatalog();
      const recipeData = readCostsRecipesPayload();
      const costsState = readCostsState();
      let linkedCount = 0;
      let missingCount = 0;
      let unresolvedCount = 0;

      clearCostsProductColumns();
      costsProductContexts = [];
      table.dataset.productColumns = String(products.length);

      products.forEach((product) => {
        const productId = costsProductId(product);
        const rawName = costsProductHeaderName(product);
        const duplicateKey = costsLookupKey(rawName);
        const name = (duplicateHeaderCounts.get(duplicateKey) || 0) > 1
          ? `${rawName} · ${productId.slice(-6)}`
          : rawName;
        const capacityMl = costsProductCapacityMl(product, envases);
        const recipeResolution = resolveCostsProductRecipe(product, recipeData);
        recipeResolution.productId = productId;
        if (recipeResolution.status === 'ok') linkedCount += 1;
        else if (recipeResolution.status === 'unresolved') unresolvedCount += 1;
        else missingCount += 1;

        const context = { productId, name, capacityMl, resolution:recipeResolution };
        costsProductContexts.push(context);
        const calculation = calculateCostsForProduct(recipeResolution, costsState);

        const col = document.createElement('col');
        col.className = 'cat-cost-col-product';
        col.dataset.costProductColumn = '1';
        col.dataset.productId = productId;
        colgroup.appendChild(col);

        const th = document.createElement('th');
        th.scope = 'col';
        th.className = 'cat-cost-product-head';
        th.dataset.costProductColumn = '1';
        th.dataset.productId = productId;
        th.innerHTML = `<span class="cat-cost-product-name">${escapeHtml(name)}</span><small>${capacityMl > 0 ? `${escapeHtml(String(capacityMl))} ml` : 'ML no definido'}</small>`;
        headRow.appendChild(th);

        qsa('tr[data-cost-row]', body).forEach((row) => {
          const td = document.createElement('td');
          td.className = 'cat-cost-product-cell';
          td.dataset.costProductColumn = '1';
          td.dataset.productId = productId;
          const rowKey = String(row.dataset.costRow || '').trim();
          if (COST_LIQUIDS.some((liquid) => liquid.key === rowKey)){
            renderCostsLiquidCell(td, rowKey, name, calculation);
          }else if (rowKey === 'botella' || rowKey === 'calcomania'){
            renderCostsConsumableCell(td, rowKey, productId, name, costsState);
          }else if (rowKey === 'total'){
            renderCostsTotalCell(td, name, calculation);
          }else{
            td.textContent = '—';
          }
          row.appendChild(td);
        });
      });

      setCostsEmptyState(!products.length, activeProducts.length
        ? 'No hay productos activos con Receta. Active Receta desde Catálogos → Productos.'
        : 'No hay productos activos. Cree productos desde Catálogos → Productos.');
      renderCostsSummary(costsProductContexts, costsState);
      if (recipeData.state === 'damaged'){
        setCostsRecipeStatus(recipeData.message, 'warn');
      }else if (recipeData.state === 'empty'){
        setCostsRecipeStatus(products.length ? recipeData.message : 'No hay productos activos con Receta para mostrar.', products.length ? 'warn' : '');
      }else if (unresolvedCount){
        setCostsRecipeStatus(`${linkedCount} producto(s) conectado(s). ${unresolvedCount} producto(s) requieren revisar su relación con la receta.`, 'warn');
      }else if (missingCount){
        setCostsRecipeStatus(`${linkedCount} producto(s) conectado(s). ${missingCount} producto(s) todavía no tiene receta guardada.`, '');
      }else{
        setCostsRecipeStatus(`${linkedCount} producto(s) conectado(s) con sus recetas reales.`, 'ok');
      }
    }catch(err){
      try{ console.warn('[Suite A33] Costos: no se pudieron reconstruir las columnas de productos.', err); }catch(_){ }
      clearCostsProductColumns();
      costsProductContexts = [];
      table.dataset.productColumns = '0';
      setCostsEmptyState(true, 'No hay productos activos con Receta disponibles para calcular.');
      renderCostsSummary([], readCostsState());
      setCostsRecipeStatus('No se pudieron leer las recetas o productos. La información existente no fue modificada.', 'warn');
    }
  }

  function scheduleCostsProductsRefresh(){
    clearTimeout(costsProductsRefreshTimer);
    costsProductsRefreshTimer = setTimeout(() => {
      renderCostsProductColumns().catch(() => {});
    }, 0);
  }

  function registerServiceWorker(){
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=4.20.93&r=2').then((reg)=>{
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


  function productStableId(product){
    const p = product && typeof product === 'object' ? product : {};
    try{
      if (window.A33Products && typeof window.A33Products.getProductId === 'function'){
        const id = window.A33Products.getProductId(p);
        if (id) return String(id).trim();
      }
    }catch(_){ }
    return String(p.productId ?? p.productoId ?? '').trim();
  }

  function findProductByProductId(list, productId){
    const target = String(productId ?? '').trim();
    if (!target) return null;
    return (Array.isArray(list) ? list : []).find((row) => row && productStableId(row) === target) || null;
  }

  function prepareNewCatalogProduct(record, origin){
    if (window.A33Products && typeof window.A33Products.prepareNew === 'function'){
      return window.A33Products.prepareNew(record, { origin:origin || 'usuario' });
    }
    return { ...record, productId:'prd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,10), origin:origin || 'usuario' };
  }

  function prepareExistingCatalogProduct(current, patch){
    if (window.A33Products && typeof window.A33Products.prepareExisting === 'function'){
      return window.A33Products.prepareExisting(current, patch);
    }
    return { ...current, ...patch, productId:productStableId(current) };
  }

  function buildRecipeLetterUsage(products, currentProductId){
    const map = new Map();
    const cid = currentProductId == null ? '' : String(currentProductId).trim();
    for (const p of (Array.isArray(products) ? products : [])){
      if (!p || !productHasRecipe(p)) continue;
      const pid = productStableId(p);
      if (cid && pid === cid) continue;
      const letter = productLetter(p);
      if (!letter) continue;
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter).push(p);
    }
    return map;
  }

  function findDuplicateRecipeLetter(products, letter, currentProductId){
    const clean = normalizeProductLetter(letter);
    if (!clean) return null;
    const usage = buildRecipeLetterUsage(products, currentProductId);
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
      productId: productStableId(p),
      legacyId: p.id,
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

  function catalogHasId(list, id){
    const key = String(id || '').trim();
    if (!key) return false;
    return (Array.isArray(list) ? list : []).some(x => x && String(x.id || '').trim() === key);
  }

  function applyProductPackagingDefaults(product, envases, tapas){
    if (!product || typeof product !== 'object') return false;
    let changed = false;

    // Solo se normalizan relaciones que ya fueron configuradas explícitamente.
    // Nunca se asigna Envase/Tapa por nombre, Letra, capacidad o presentación legacy.
    const currentEnvase = productEnvaseId(product);
    if (currentEnvase && product.envaseId !== currentEnvase){ product.envaseId = currentEnvase; changed = true; }
    if (!hasOwn(product, 'envaseId')){ product.envaseId = ''; changed = true; }

    const currentTapa = productTapaId(product);
    if (currentTapa && product.tapaId !== currentTapa){ product.tapaId = currentTapa; changed = true; }
    if (!hasOwn(product, 'tapaId')){ product.tapaId = ''; changed = true; }

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
          try{ os.createIndex('by_name','name',{ unique:false }); }catch(_){ }
        }
        else {
          // productId es la identidad operativa; nombres iguales no se fusionan ni se bloquean.
          try{
            const productsStore = event.target.transaction.objectStore('products');
            if (productsStore.indexNames.contains('by_name')) productsStore.deleteIndex('by_name');
            productsStore.createIndex('by_name','name',{ unique:false });
          }catch(_){ }
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

  async function deleteRecord(store, key){
    if (!db) await openDB();
    if (!db.objectStoreNames.contains(store)) return false;
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(key);
      req.onsuccess = ()=>resolve(true);
      req.onerror = ()=>reject(req.error || tx.error);
      tx.onerror = ()=>reject(tx.error || req.error);
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
    if (kind === 'products'){
      try{ window.A33Products?.rememberDeleted?.(row); }catch(_){ }
    }
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


  async function normalizeLegacyGallon(){
    const products = await getAll('products');
    const galons = (products || []).filter((p) => p && mapProductNameToFinishedId(p.name || '') === 'galon');
    if (!galons.length) return;
    const explicitCanonical = galons.find((p) => normKey(p.name || '') === normKey(CANON_GALON_LABEL)) || null;
    // Con varios registros legacy no se elige por nombre/familia: evitar fusionar o renombrar productos distintos.
    const canonicalOwner = explicitCanonical || (galons.length === 1 ? galons[0] : null);
    const legacyNames = new Set([
      normKey('Galón 3750 ml'), normKey('Galón 3750ml'),
      normKey('Galón 3800 ml'), normKey('Galón 3800ml')
    ]);

    for (const product of galons){
      const patch = {};
      const currentNameKey = normKey(product.name || '');
      const canClaimCanonicalName = !canonicalOwner || productStableId(canonicalOwner) === productStableId(product);
      if (legacyNames.has(currentNameKey) && canClaimCanonicalName) patch.name = CANON_GALON_LABEL;
      const currentCapacity = getCapacity(product);
      if ((currentCapacity === 3750 || currentCapacity === 3800) && canClaimCanonicalName){
        patch.capacityMl = 3720;
        patch.capacidadMl = 3720;
        patch.volumeMl = 3720;
        patch.volumenMl = 3720;
      }
      if (!isValidPrice(product.price)) patch.price = DEFAULT_GALON_PRICE;
      if (typeof product.active === 'undefined') patch.active = true;
      if (typeof product.manageStock === 'undefined') patch.manageStock = true;
      if (!Object.keys(patch).length) continue;
      patch.updatedAt = new Date().toISOString();
      patch.updatedFrom = 'catalogos_galon_3720_compat';
      await put('products', prepareExistingCatalogProduct(product, patch));
    }
  }

  async function productHasMovements(product){
    if (!product) return false;
    const productId = productStableId(product);
    const legacyId = String(product.id ?? '').trim();
    const matchesProductReference = (value) => {
      const key = String(value ?? '').trim();
      return !!key && ((productId && key === productId) || (legacyId && key === legacyId));
    };
    const nk = normKey(product.name || '');
    try{
      const sales = await getAll('sales');
      if ((sales || []).some(s => s && ((matchesProductReference(s.productId ?? s.productoId)) || (nk && normKey(s.productName || s.name || '') === nk)))) return true;
    }catch(_){ }
    try{
      const inv = await getAll('inventory');
      if ((inv || []).some(i => i && matchesProductReference(i.productId ?? i.productoId))) return true;
    }catch(_){ }
    try{
      const reps = await getAll('reempaques');
      if ((reps || []).some(r => {
        if (!r) return false;
        const vals = [r.sourceProductId, r.productoOrigenId, r.targetProductId, r.productoDestinoId, r.productId, r.productoId];
        if (vals.some(matchesProductReference)) return true;
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
          if (vals.some(matchesProductReference)) return true;
          const names = [l.productName, l.productoNombre, l.producto, l.name, l.nombre];
          return nk && names.some(v => normKey(v) === nk);
        })) return true;
      }
    }catch(_){ }
    return false;
  }

  async function renderProducts(){
    try{
      const allRaw = await getAll('products');
      const all = (allRaw || []).filter((p) => {
        const productId = productStableId(p);
        try{ return !(window.A33ProductIntegrity && productId && window.A33ProductIntegrity.isTombstoned(productId)); }catch(_){ return true; }
      });
      const list = all.slice().sort(sortProducts);
      const activePosProducts = all.filter(p => p && p.active !== false && productPosEnabled(p));
      const envases = ensureEnvasesDefaults(false);
      const tapas = ensureTapasDefaults(false);
      const duplicateLetters = getDuplicateRecipeLetters(all || []);
      const wrap = byId('cat-products-list');
      if (!wrap) return;
      wrap.innerHTML = '';
      if (!list.length){
        setStatus('No hay productos. Crea el primer producto desde Catálogos → Productos.', 'warn');
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
            <button class="cat-btn cat-btn-ok cat-edit-product" data-product-id="${escapeHtml(productStableId(p))}" type="button">Editar</button>
            <button class="cat-btn ${active ? 'cat-btn-warn' : 'cat-btn-secondary'} cat-toggle-product" data-product-id="${escapeHtml(productStableId(p))}" type="button">${active ? 'Inactivar' : 'Activar'}</button>
            <button class="cat-btn cat-btn-danger cat-delete-product" data-product-id="${escapeHtml(productStableId(p))}" type="button">Borrar</button>
          </div>
        `;
        wrap.appendChild(card);
      }
      await renderCostsProductColumns();
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

  async function addProduct(){
    const data = readProductForm('cat-new');
    if (!data.ok){ alert(data.msg); return; }
    const all = await getAll('products');
    const dupLetter = data.receta ? findDuplicateRecipeLetter(all || [], data.letra, null) : null;
    if (dupLetter){ alert(`La Letra ${data.letra} ya está asignada a ${dupLetter.name || 'otro producto'} con Receta. Corrige antes de guardar.`); return; }
    if (data.receta && (!data.envaseId || !data.tapaId)){
      const ok = confirm('Este producto tiene Receta, pero todavía no tiene Envase y/o Tapa. Se guardará como incompleto para producción futura. ¿Continuar?');
      if (!ok) return;
    }
    const now = new Date().toISOString();
    const product = prepareNewCatalogProduct({
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
    }, 'usuario');
    try{
      const legacyId = await put('products', product);
      if (product.id == null) product.id = legacyId;
      ['name','price','capacity','unit-cost','letra'].forEach(k => { const el = byId('cat-new-' + k); if (el) el.value = ''; });
      const active = byId('cat-new-active'); if (active) active.checked = true;
      const manage = byId('cat-new-manage'); if (manage) manage.checked = true;
      const receta = byId('cat-new-receta'); if (receta) receta.checked = false;
      const pos = byId('cat-new-pos'); if (pos) pos.checked = true;
      populateProductPackagingSelects('cat-new', '', '');
      await renderProducts();
      toast('Producto agregado');
    }catch(err){
      console.error(err);
      alert('No se pudo agregar el producto. Revisa los datos e intenta nuevamente.');
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

  async function openProductModal(productId){
    const all = await getAll('products');
    const product = findProductByProductId(all || [], productId);
    if (!product){ toast('Producto no encontrado'); return; }
    currentEditId = productStableId(product);
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
    if (!currentEditId){ setEditMsg('Producto inválido.', 'warn'); return; }
    const all = await getAll('products');
    const product = findProductByProductId(all || [], currentEditId);
    if (!product){ setEditMsg('El producto ya no existe.', 'warn'); return; }
    const data = readProductForm('cat-edit');
    if (!data.ok){ setEditMsg(data.msg, 'warn'); return; }
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
    const updatedProduct = prepareExistingCatalogProduct(product, {
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
      productionIncomplete:data.incompleteProduction,
      updatedAt:new Date().toISOString(),
      updatedFrom:'catalogos_productos'
    });
    try{
      await put('products', updatedProduct);
      closeProductModal();
      await normalizeLegacyGallon();
      await renderProducts();
      toast('Producto guardado');
    }catch(err){
      console.error(err);
      setEditMsg('No se pudo guardar el producto. Revisa los datos e intenta nuevamente.', 'warn');
    }
  }

  async function toggleProduct(productId){
    const all = await getAll('products');
    const product = findProductByProductId(all || [], productId);
    if (!product) return;
    const updatedProduct = prepareExistingCatalogProduct(product, {
      active:product.active === false,
      updatedAt:new Date().toISOString(),
      updatedFrom:'catalogos_productos_toggle'
    });
    await put('products', updatedProduct);
    await renderProducts();
    toast(updatedProduct.active === false ? 'Producto inactivado' : 'Producto activado');
  }

  async function deleteProductMaster(productId){
    try{
      const all = await getAll('products');
      const product = findProductByProductId(all || [], productId);
      if (!product){ toast('Producto no encontrado'); return; }
      const name = product.name || 'Producto sin nombre';
      const ok = confirm(`¿Borrar el producto "${name}"?\n\nSolo se borrará del catálogo maestro. No se borrarán ventas, inventario, lotes ni snapshots históricos.`);
      if (!ok) return;
      rememberCatalogDeleted('products', product);
      await deleteRecord('products', product.id);
      if (currentEditId != null && String(currentEditId) === productStableId(product)) closeProductModal();
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

  function catalogStorageKeyExists(key){
    try{
      return !!window.localStorage && window.localStorage.getItem(String(key || '')) !== null;
    }catch(_){ return false; }
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
    const explicitRestore = force === true;
    const existedBefore = catalogStorageKeyExists(ENVASES_CATALOG_KEY);
    const list = readEnvaseCatalog();

    // Compatibilidad controlada: semilla automática solo en la primera existencia real de la clave.
    // Una lista vacía guardada por el usuario se respeta y nunca se repuebla sola.
    if (!explicitRestore && existedBefore) return list;

    if (explicitRestore) clearCatalogDeleted('envases');
    const deleted = readCatalogDeletedKeys('envases');
    const byName = new Map(list.map(x => [normalizeEnvaseKey(x.name), x]));
    const byId = new Set(list.map(x => String(x.id || '')));
    const now = new Date().toISOString();
    let changed = false;

    for (const seed of ENVASES_SEED){
      const key = normalizeEnvaseKey(seed.name);
      if (!explicitRestore && deleted.has(key)) continue;
      const existing = byName.get(key);
      if (existing){
        let ch = false;
        if (!existing.id){ existing.id = seed.id; ch = true; }
        if (!existing.nombre){ existing.nombre = existing.name; ch = true; }
        if (explicitRestore && existing.active !== true){ existing.active = true; ch = true; }
        if (ch){
          existing.updatedAt = now;
          existing.updatedFrom = 'catalogos_envases_restauracion_explicita';
          changed = true;
        }
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
        origin: explicitRestore ? 'restauracion_explicita' : 'semilla_inicial',
        autoCreated:true,
        schemaVersion:ENVASES_SCHEMA_VERSION,
        createdAt:now,
        updatedAt:now,
        updatedFrom: explicitRestore ? 'catalogos_envases_restauracion_explicita' : 'catalogos_envases_semilla_inicial'
      });
      changed = true;
    }

    // También escribe [] en el primer inicio si la semilla estuviera vacía: la clave queda marcada como inicializada.
    if (changed || explicitRestore || !existedBefore) saveEnvaseCatalog(list);
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
    const explicitRestore = force === true;
    const existedBefore = catalogStorageKeyExists(TAPAS_CATALOG_KEY);
    const list = readTapaCatalog();

    // Igual que Envases: una clave existente, incluso con [], expresa decisión del usuario.
    if (!explicitRestore && existedBefore) return list;

    if (explicitRestore) clearCatalogDeleted('tapas');
    const deleted = readCatalogDeletedKeys('tapas');
    const byName = new Map(list.map(x => [normalizeTapaKey(x.name), x]));
    const byId = new Set(list.map(x => String(x.id || '')));
    const now = new Date().toISOString();
    let changed = false;

    for (const seed of TAPAS_SEED){
      const key = normalizeTapaKey(seed.name);
      if (!explicitRestore && deleted.has(key)) continue;
      const existing = byName.get(key);
      if (existing){
        let ch = false;
        if (!existing.id){ existing.id = seed.id; ch = true; }
        if (!existing.nombre){ existing.nombre = existing.name; ch = true; }
        if (explicitRestore && existing.active !== true){ existing.active = true; ch = true; }
        if (ch){
          existing.updatedAt = now;
          existing.updatedFrom = 'catalogos_tapas_restauracion_explicita';
          changed = true;
        }
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
        origin: explicitRestore ? 'restauracion_explicita' : 'semilla_inicial',
        autoCreated:true,
        schemaVersion:TAPAS_SCHEMA_VERSION,
        createdAt:now,
        updatedAt:now,
        updatedFrom: explicitRestore ? 'catalogos_tapas_restauracion_explicita' : 'catalogos_tapas_semilla_inicial'
      });
      changed = true;
    }

    if (changed || explicitRestore || !existedBefore) saveTapaCatalog(list);
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

  function customerGroupLetterCAT(value){
    let s = sanitizeCustomerName(value || '');
    try{ if (s.normalize) s = s.normalize('NFD'); }catch(_){ }
    s = s.replace(/[\u0300-\u036f]/g, '').trim();
    const first = s ? s.charAt(0).toUpperCase() : '#';
    return /^[A-Z0-9]$/.test(first) ? first : '#';
  }

  function sortCustomerGroupLettersCAT(a, b){
    if (a === '#') return 1;
    if (b === '#') return -1;
    const ad = /^\d$/.test(a);
    const bd = /^\d$/.test(b);
    if (ad !== bd) return ad ? 1 : -1;
    return String(a).localeCompare(String(b), 'es-NI', { sensitivity:'base', numeric:true });
  }

  function saleDateKeyCAT(sale){
    if (!sale || typeof sale !== 'object') return '';
    const direct = String(sale.date || sale.fecha || sale.saleDate || sale.fechaVenta || '').trim();
    const match = direct.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    const candidates = [sale.createdAt, sale.timestamp, sale.ts, sale.created_at, sale.updatedAt];
    for (const raw of candidates){
      if (raw == null || raw === '') continue;
      let d = null;
      if (typeof raw === 'number' && Number.isFinite(raw)) d = new Date(raw);
      else {
        const parsed = Date.parse(String(raw));
        if (Number.isFinite(parsed)) d = new Date(parsed);
      }
      if (!d || Number.isNaN(d.getTime())) continue;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    return '';
  }

  function formatDateKeyCAT(dateKey){
    const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Sin compras';
  }

  function saleCustomerNameCAT(sale){
    if (!sale || typeof sale !== 'object') return '';
    return sanitizeCustomerName(sale.customerName || sale.customer || sale.clienteNombre || sale.nombreCliente || sale.cliente || sale.clientName || '');
  }

  function saleCustomerIdCAT(sale){
    if (!sale || typeof sale !== 'object') return '';
    const raw = sale.customerId ?? sale.clienteId ?? sale.clientId ?? null;
    return raw == null ? '' : String(raw).trim();
  }

  function isPurchaseSaleCAT(sale){
    if (!sale || typeof sale !== 'object') return false;
    if (sale.deletedAt || sale.isDeleted || sale.cancelled || sale.canceled || sale.anulado || sale.voided) return false;
    if (sale.isReturn || sale.devolucion || sale.courtesy || sale.isCourtesy) return false;
    const qty = Number(sale.qty ?? sale.quantity ?? sale.cantidad ?? 1);
    if (Number.isFinite(qty) && qty <= 0) return false;
    const total = Number(sale.total ?? sale.netTotal ?? sale.totalVenta ?? 0);
    if (Number.isFinite(total) && total <= 0) return false;
    return !!saleDateKeyCAT(sale);
  }

  function addResolverTargetCAT(map, key, id){
    const cleanKey = String(key || '').trim();
    const cleanId = String(id || '').trim();
    if (!cleanKey || !cleanId) return;
    if (!map.has(cleanKey)) map.set(cleanKey, new Set());
    map.get(cleanKey).add(cleanId);
  }

  function buildCustomerPurchaseResolverCAT(customers){
    const idTargets = new Map();
    const nameTargets = new Map();
    const byId = new Map();
    for (const c of (Array.isArray(customers) ? customers : [])){
      if (!c || c.id == null) continue;
      byId.set(String(c.id), c);
    }
    for (const c of (Array.isArray(customers) ? customers : [])){
      if (!c || c.id == null) continue;
      const ownId = String(c.id);
      const finalId = c.mergedIntoId && byId.has(String(c.mergedIntoId)) ? String(c.mergedIntoId) : ownId;
      addResolverTargetCAT(idTargets, ownId, ownId);
      if (finalId !== ownId) addResolverTargetCAT(idTargets, ownId, finalId);
      const names = [c.name, c.nombre];
      if (Array.isArray(c.aliases)) names.push(...c.aliases);
      if (Array.isArray(c.nameHistory)){
        c.nameHistory.forEach(h => {
          if (!h) return;
          names.push(h.from, h.to);
        });
      }
      for (const name of names){
        const key = normalizeCustomerKeyCAT(name);
        if (!key) continue;
        // Sin customerId, un nombre solo se resuelve si es inequívoco.
        // En clientes fusionados, el nombre histórico apunta al destino final.
        addResolverTargetCAT(nameTargets, key, finalId);
      }
    }
    return { idTargets, nameTargets };
  }

  function archivedSalesFromSnapshotCAT(archive){
    const rows = [];
    if (!archive || typeof archive !== 'object') return rows;
    const snap = archive.snapshot && typeof archive.snapshot === 'object' ? archive.snapshot : archive;
    const directArrays = [snap.sales, snap.ventas, snap.salesDetail, snap.ventasDetalle, archive.sales, archive.ventas];
    for (const arr of directArrays){
      if (Array.isArray(arr)) rows.push(...arr.filter(Boolean));
    }
    const sheets = Array.isArray(snap.sheets) ? snap.sheets : [];
    for (const sheet of sheets){
      const name = normalizeCustomerKeyCAT(sheet && sheet.name || '').replace(/\s+/g, '');
      if (!/(ventasdetalle|ventadetalle|salesdetail|ventas|sales)/.test(name)) continue;
      const data = sheet && Array.isArray(sheet.rows) ? sheet.rows : [];
      if (data.length < 2 || !Array.isArray(data[0])) continue;
      const header = data[0].map(v => normalizeCustomerKeyCAT(v).replace(/[^a-z0-9]/g, ''));
      const findIndex = (aliases) => header.findIndex(h => aliases.includes(h));
      const dateIdx = findIndex(['fecha','date','fechaventa','saledate']);
      const customerIdx = findIndex(['cliente','customer','customername','nombrecliente','clientename']);
      const customerIdIdx = findIndex(['customerid','clienteid','clientid']);
      const returnIdx = findIndex(['devolucion','isreturn','return']);
      const qtyIdx = findIndex(['cantidad','qty','quantity']);
      if (dateIdx < 0 || (customerIdx < 0 && customerIdIdx < 0)) continue;
      for (const row of data.slice(1)){
        if (!Array.isArray(row)) continue;
        rows.push({
          date: row[dateIdx] || '',
          customerName: customerIdx >= 0 ? row[customerIdx] : '',
          customerId: customerIdIdx >= 0 ? row[customerIdIdx] : null,
          isReturn: returnIdx >= 0 ? !!Number(row[returnIdx]) : false,
          qty: qtyIdx >= 0 ? row[qtyIdx] : 1,
          archivedSnapshot: true
        });
      }
    }
    return rows;
  }

  function updateLastPurchaseForTargetCAT(byId, targetId, dateKey){
    const id = String(targetId || '').trim();
    if (!id || !dateKey) return;
    const current = String(byId.get(id) || '');
    if (!current || dateKey > current) byId.set(id, dateKey);
  }

  async function loadCustomerLastPurchaseIndexCAT(customers, options){
    const opts = options || {};
    if (!opts.force && customerLastPurchaseCacheCAT.loaded) return customerLastPurchaseCacheCAT;
    if (!opts.force && customerLastPurchaseLoadPromiseCAT) return customerLastPurchaseLoadPromiseCAT;

    const task = (async()=>{
      await openDB();
      const [sales, archives] = await Promise.all([
        getAll('sales').catch(()=>[]),
        getAll('summaryArchives').catch(()=>[])
      ]);
      const resolver = buildCustomerPurchaseResolverCAT(customers);
      const byId = new Map();
      const allSales = Array.isArray(sales) ? sales.slice() : [];
      for (const archive of (Array.isArray(archives) ? archives : [])){
        allSales.push(...archivedSalesFromSnapshotCAT(archive));
      }
      for (const sale of allSales){
        if (!isPurchaseSaleCAT(sale)) continue;
        const dateKey = saleDateKeyCAT(sale);
        const sid = saleCustomerIdCAT(sale);
        let targets = sid ? resolver.idTargets.get(sid) : null;
        if (!targets || !targets.size){
          const nameKey = normalizeCustomerKeyCAT(saleCustomerNameCAT(sale));
          targets = nameKey ? resolver.nameTargets.get(nameKey) : null;
          if (targets && targets.size !== 1) targets = null;
        }
        if (!targets || !targets.size) continue;
        targets.forEach(id => updateLastPurchaseForTargetCAT(byId, id, dateKey));
      }
      customerLastPurchaseCacheCAT = {
        loaded:true,
        loadedAt:Date.now(),
        byId,
        sourceSales:Array.isArray(sales) ? sales.length : 0,
        sourceArchives:Array.isArray(archives) ? archives.length : 0
      };
      return customerLastPurchaseCacheCAT;
    })();

    customerLastPurchaseLoadPromiseCAT = task;
    try{ return await task; }
    finally{ if (customerLastPurchaseLoadPromiseCAT === task) customerLastPurchaseLoadPromiseCAT = null; }
  }

  function invalidateCustomerLastPurchaseCAT(){
    customerLastPurchaseCacheCAT = { loaded:false, loadedAt:0, byId:new Map(), sourceSales:0, sourceArchives:0 };
  }

  function lastPurchaseForCustomerCAT(customer){
    const id = customer && customer.id != null ? String(customer.id) : '';
    const key = id && customerLastPurchaseCacheCAT.byId ? customerLastPurchaseCacheCAT.byId.get(id) : '';
    return formatDateKeyCAT(key || '');
  }

  function setCustomerViewValueCAT(id, value){
    const el = byId(id);
    if (el) el.textContent = value == null || value === '' ? '—' : String(value);
  }

  function openCustomerViewCAT(id){
    const cid = id != null ? String(id).trim() : '';
    const row = readCustomerCatalogCAT().find(c => c && String(c.id) === cid);
    if (!row){ toast('Cliente no encontrado'); return; }
    currentCustomerViewId = cid;
    setCustomerViewValueCAT('cat-view-customer-name', row.name || row.nombre || 'Cliente sin nombre');
    setCustomerViewValueCAT('cat-view-customer-status', customerActiveCAT(row) ? 'Activo' : 'Inactivo');
    setCustomerViewValueCAT('cat-view-customer-cell', getCustomerCellularCAT(row) || '—');
    setCustomerViewValueCAT('cat-view-customer-email', row.correo || row.email || '—');
    setCustomerViewValueCAT('cat-view-customer-address', row.direccion || row.address || '—');
    setCustomerViewValueCAT('cat-view-customer-last-purchase', lastPurchaseForCustomerCAT(row));
    setCustomerViewValueCAT('cat-view-customer-notes', row.notas || row.notes || '—');
    const merged = byId('cat-view-customer-merged');
    if (merged){
      merged.hidden = !row.mergedIntoId;
      merged.textContent = row.mergedIntoId ? `Cliente fusionado con ID ${String(row.mergedIntoId)}.` : '';
    }
    const modal = byId('cat-customer-view-modal');
    if (!modal) return;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    try{ document.body.classList.add('cat-modal-open'); }catch(_){ }
  }

  function closeCustomerViewCAT(){
    const modal = byId('cat-customer-view-modal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    currentCustomerViewId = null;
    try{
      if (!byId('cat-customer-modal')?.classList.contains('show')) document.body.classList.remove('cat-modal-open');
    }catch(_){ }
  }

  async function renderCustomers(options){
    const opts = options || {};
    const renderToken = ++customerRenderTokenCAT;
    try{
      const all = readCustomerCatalogCAT();
      await loadCustomerLastPurchaseIndexCAT(all, { force:!!opts.forceLastPurchase });
      if (renderToken !== customerRenderTokenCAT) return;
      const q = normalizeCustomerKeyCAT(byId('cat-customer-search')?.value || '');
      const list = q ? all.filter(c => customerSearchTextCAT(c).includes(q)) : all;
      const wrap = byId('cat-customers-list');
      if (!wrap) return;
      wrap.innerHTML = '';
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

      const groups = new Map();
      for (const customer of list){
        const letter = customerGroupLetterCAT(customer && customer.name);
        if (!groups.has(letter)) groups.set(letter, []);
        groups.get(letter).push(customer);
      }
      const letters = Array.from(groups.keys()).sort(sortCustomerGroupLettersCAT);
      for (const letter of letters){
        const customers = groups.get(letter).slice().sort((a,b)=>
          normalizeCustomerKeyCAT(a && a.name).localeCompare(normalizeCustomerKeyCAT(b && b.name), 'es-NI', { sensitivity:'base', numeric:true })
        );
        const details = document.createElement('details');
        details.className = 'cat-customer-group';
        details.dataset.customerGroup = letter;
        details.open = q ? true : customerExpandedGroupsCAT.has(letter);
        details.addEventListener('toggle', ()=>{
          if (normalizeCustomerKeyCAT(byId('cat-customer-search')?.value || '')) return;
          if (details.open) customerExpandedGroupsCAT.add(letter);
          else customerExpandedGroupsCAT.delete(letter);
        });

        const summary = document.createElement('summary');
        summary.className = 'cat-customer-group-summary';
        summary.innerHTML = `
          <span class="cat-customer-group-letter">${escapeHtml(letter)}</span>
          <strong>${customers.length} cliente${customers.length === 1 ? '' : 's'}</strong>
          <span class="cat-customer-group-chevron" aria-hidden="true">⌄</span>
        `;
        details.appendChild(summary);

        const scroll = document.createElement('div');
        scroll.className = 'cat-customer-table-scroll';
        scroll.setAttribute('tabindex', '0');
        scroll.setAttribute('aria-label', `Clientes con letra ${letter}`);
        const table = document.createElement('table');
        table.className = 'cat-customer-table';
        table.innerHTML = `
          <thead><tr>
            <th scope="col">Nombre</th>
            <th scope="col">Estado</th>
            <th scope="col">Celular</th>
            <th scope="col">Última compra</th>
            <th scope="col" class="cat-customer-actions-head">Acciones</th>
          </tr></thead>
          <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');
        for (const c of customers){
          const active = customerActiveCAT(c);
          const isMerged = !!(c && c.mergedIntoId);
          const tr = document.createElement('tr');
          tr.className = active ? '' : 'is-inactive';
          tr.dataset.customerId = String(c.id || '');
          const nameBadges = isMerged ? '<span class="cat-mini-badge">Fusionado</span>' : '';
          tr.innerHTML = `
            <td class="cat-customer-name-cell"><span>${escapeHtml(c.name || 'Cliente sin nombre')}</span>${nameBadges}</td>
            <td><span class="cat-pill ${active ? 'ok' : 'muted'}">${active ? 'Activo' : 'Inactivo'}</span></td>
            <td>${escapeHtml(getCustomerCellularCAT(c) || '—')}</td>
            <td class="cat-customer-date-cell">${escapeHtml(lastPurchaseForCustomerCAT(c))}</td>
            <td class="cat-customer-actions-cell">
              <div class="cat-icon-actions">
                <button class="cat-icon-btn cat-view-customer" data-id="${escapeHtml(String(c.id))}" type="button" title="Ver" aria-label="Ver ${escapeHtml(c.name || 'cliente')}">◉</button>
                <button class="cat-icon-btn cat-icon-edit cat-edit-customer" data-id="${escapeHtml(String(c.id))}" type="button" title="Editar" aria-label="Editar ${escapeHtml(c.name || 'cliente')}" ${isMerged ? 'disabled' : ''}>✎</button>
                <button class="cat-icon-btn ${active ? 'cat-icon-warn' : 'cat-icon-ok'} cat-toggle-customer" data-id="${escapeHtml(String(c.id))}" type="button" title="${active ? 'Inactivar' : 'Activar'}" aria-label="${active ? 'Inactivar' : 'Activar'} ${escapeHtml(c.name || 'cliente')}" ${isMerged ? 'disabled' : ''}>⏻</button>
                <button class="cat-icon-btn cat-icon-danger cat-delete-customer" data-id="${escapeHtml(String(c.id))}" type="button" title="Borrar" aria-label="Borrar ${escapeHtml(c.name || 'cliente')}">⌫</button>
              </div>
            </td>
          `;
          tbody.appendChild(tr);
        }
        scroll.appendChild(table);
        details.appendChild(scroll);
        wrap.appendChild(details);
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
    let previousName = '';
    const isEdit = !!currentCustomerEditId;
    if (isEdit){
      row = list.find(c => c && String(c.id) === String(currentCustomerEditId));
      if (!row){ setCurrentCustomerMsgCAT('El cliente ya no existe. Actualiza e intenta de nuevo.', 'warn'); resetCustomerFormCAT(); await renderCustomers(); return; }
      if (row.mergedIntoId){ setCurrentCustomerMsgCAT('Este cliente está fusionado. Administra el destino final.', 'warn'); return; }
      const oldName = sanitizeCustomerName(row.name || '');
      previousName = oldName;
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
    customerExpandedGroupsCAT.add(customerGroupLetterCAT(data.name));
    const nameChanged = !isEdit || normalizeCustomerKeyCAT(previousName) !== data.normalizedName;
    if (nameChanged) invalidateCustomerLastPurchaseCAT();
    resetCustomerFormCAT();
    if (isEdit) closeCustomerModalCAT();
    await renderCustomers({ forceLastPurchase:nameChanged });
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
        const view = e.target.closest('.cat-view-customer');
        const edit = e.target.closest('.cat-edit-customer');
        const toggle = e.target.closest('.cat-toggle-customer');
        const del = e.target.closest('.cat-delete-customer');
        if (view){ openCustomerViewCAT(view.dataset.id); return; }
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
        const viewModal = byId('cat-customer-view-modal');
        if (viewModal && viewModal.classList.contains('show')) closeCustomerViewCAT();
        else if (modal && modal.classList.contains('show')) closeCustomerModalCAT();
      }
    });
    byId('cat-customer-view-close')?.addEventListener('click', closeCustomerViewCAT);
    byId('cat-customer-view-ok')?.addEventListener('click', closeCustomerViewCAT);
    const customerViewModal = byId('cat-customer-view-modal');
    if (customerViewModal){
      customerViewModal.addEventListener('click', (e)=>{ if (e.target === customerViewModal) closeCustomerViewCAT(); });
    }
    byId('cat-refresh-customers')?.addEventListener('click', async ()=>{
      resetCustomerFormCAT();
      invalidateCustomerLastPurchaseCAT();
      await renderCustomers({ forceLastPurchase:true });
      toast('Clientes actualizados');
    });
    byId('cat-customer-search')?.addEventListener('input', ()=>{
      clearTimeout(customerSearchTimerCAT);
      customerSearchTimerCAT = setTimeout(()=>renderCustomers().catch(err=>console.error(err)), 80);
    });
  }

  async function initCustomers(){
    const list = readCustomerCatalogCAT();
    // Migración local suave: si venía como strings u objetos incompletos, queda objeto estable para POS.
    saveCustomerCatalogCAT(list);
    await loadCustomerLastPurchaseIndexCAT(list, { force:true });
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
        if (edit){ await openProductModal(edit.dataset.productId); return; }
        if (toggle){ await toggleProduct(toggle.dataset.productId); return; }
        if (del){ await deleteProductMaster(del.dataset.productId); return; }
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
    byId('cat-refresh-products')?.addEventListener('click', ()=>initProducts({ skipSeed:true }).catch(err=>{ console.error(err); setStatus('No se pudo actualizar.', 'warn'); }));
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
    if (window.A33Products && typeof window.A33Products.ensureIdentities === 'function'){
      await window.A33Products.ensureIdentities();
    }
    // Los productos dependen exclusivamente del catálogo real. La base A33 solo se restaura por acción explícita.
    ensureEnvasesDefaults(false);
    ensureTapasDefaults(false);
    await normalizeLegacyGallon();
    await normalizeProductDynamicFields();
    await normalizeProductPackagingFields();
    refreshProductPackagingSelects();
    await renderProducts();
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindTabs();
    bindProductUi();
    bindCostsUi();
    bindEnvaseUi();
    bindTapaUi();
    bindExtraBankUi();
    bindCustomerUi();
    activateTabFromUrl();
    initCosts();
    if (!qs('.cat-panel.is-active')) activateTab('productos');
    try{ if (window.A33_applyReleaseLabel) window.A33_applyReleaseLabel(); }catch(_){ }
    initProducts().catch(err=>{
      console.error(err);
      setStatus('No se pudo abrir Catálogos → Productos. Cierra otras pestañas de Suite A33 y vuelve a intentar.', 'warn');
      scheduleCostsProductsRefresh();
    });
    window.addEventListener('pageshow', () => { if (db) scheduleCostsProductsRefresh(); });
    window.addEventListener('storage', (event) => {
      const key = event && event.key ? String(event.key) : '';
      if ([COSTS_RECIPES_STORAGE_KEY, COSTS_STORAGE_KEY, ENVASES_CATALOG_KEY].includes(key)){
        if (key === COSTS_STORAGE_KEY) renderCostsState(readCostsState());
        scheduleCostsProductsRefresh();
      }
      if (key === 'a33_pos_consol_sales_rev_map_v1'){
        invalidateCustomerLastPurchaseCAT();
        const panel = byId('panel-clientes');
        if (panel && !panel.hidden) renderCustomers({ forceLastPurchase:true }).catch(()=>{});
      }
    });
    window.addEventListener('focus', () => {
      const panel = byId('panel-costos');
      if (panel && !panel.hidden) scheduleCostsProductsRefresh();
    });
    document.addEventListener('visibilitychange', () => {
      const panel = byId('panel-costos');
      if (!document.hidden && panel && !panel.hidden) scheduleCostsProductsRefresh();
    });
    initEnvases().catch(err=>{
      console.error(err);
      setStatusById('cat-envases-status', 'No se pudo abrir Catálogos → Envases.', 'warn');
    });
    initTapas().catch(err=>{
      console.error(err);
      setStatusById('cat-tapas-status', 'No se pudo abrir Catálogos → Tapas.', 'warn');
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
