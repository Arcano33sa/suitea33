/* Suite A33 — Costos maestros de Catálogos. Lectura sin modificar datos históricos. */
(function(window){
  'use strict';
  const COSTS_STORAGE_KEY = 'a33_catalogos_costos_v1';
  const COSTS_RECIPES_STORAGE_KEY = 'arcano33_recetas_v1';
  const COSTS_SCHEMA_VERSION = 2;
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

  function positiveNumberOrNull(value){
    const n = Number(String(value ?? '').trim().replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function readCostsRecipesPayload(payloadOverride){
    let raw = null;
    try{
      raw = arguments.length ? JSON.stringify(payloadOverride) : window.A33Storage && typeof A33Storage.getItem === 'function'
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
      total:Number.isFinite(total) && total >= 0 ? (missing.length ? total : Math.ceil(total)) : 0,
      liquidCosts,
      consumables,
      missing
    };
  }

  function readForProducts(products, recipePayload){
    const state = readCostsState();
    const recipes = arguments.length > 1 ? readCostsRecipesPayload(recipePayload) : readCostsRecipesPayload();
    const result = new Map();
    (Array.isArray(products) ? products : []).forEach((product) => {
      const productId = costsProductId(product);
      const resolution = resolveCostsProductRecipe(product, recipes);
      resolution.productId = productId;
      result.set(productId, calculateCostsForProduct(resolution, state));
    });
    return result;
  }

  function refreshInputs(products){
    const values = readForProducts(products);
    (Array.isArray(products) ? products : []).forEach((product) => {
      const calculation = values.get(costsProductId(product));
      const input = document.getElementById('costo-unit-' + product.id);
      if (!input) return;
      input.readOnly = true;
      input.setAttribute('aria-readonly', 'true');
      input.value = calculation.status === 'complete' ? String(calculation.total) : '';
      input.placeholder = 'Pendiente';
      input.dataset.catalogCostStatus = calculation.status;
      input.title = calculation.status === 'complete'
        ? 'Costo obligatorio de Catálogos → Costos. Se redondea hacia arriba.'
        : 'Costo pendiente en Catálogos → Costos: ' + calculation.missing.join(', ') + '.';
    });
    return values;
  }

  function validatePlan(products, values, quantity){
    const pending = (Array.isArray(products) ? products : []).filter((product) =>
      quantity(product) > 0 && (!values.get(costsProductId(product)) || values.get(costsProductId(product)).status !== 'complete')
    );
    return pending.map((product) => String(product.nombre || product.name || costsProductId(product)));
  }

  function watch(products, onChange){
    let previous = '';
    const refresh = () => {
      const values = refreshInputs(products);
      const signature = JSON.stringify(Array.from(values, ([id, value]) => [id, value.status, value.total]));
      if (previous && previous !== signature && typeof onChange === 'function') onChange();
      previous = signature;
    };
    window.addEventListener('storage', (event) => {
      if (!event || event.key === null || event.key === COSTS_STORAGE_KEY || event.key === COSTS_RECIPES_STORAGE_KEY) refresh();
    });
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    refresh();
  }

  window.A33CatalogCosts = Object.freeze({
    calculate:calculateCostsForProduct,
    readForProducts,
    refreshInputs,
    validatePlan,
    watch
  });
})(window);
