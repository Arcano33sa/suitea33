// Suite A33 — Producción oficial dinámica por productId
(function (g) {
  'use strict';

  const INVENTORY_KEY = 'arcano33_inventario';
  const LOTES_KEY = 'arcano33_lotes';
  const TX_KEY = 'a33_production_transactions_v1';
  const COMMIT_LOCK_KEY = 'a33_production_commit_lock_v1';
  const COMMIT_LOCK_TTL_MS = 30000;
  const ENVASES_KEY = 'a33_catalog_envases_v1';
  const TAPAS_KEY = 'a33_catalog_tapas_v1';
  const RECIPES_KEY = 'arcano33_recetas_v1';
  const INGREDIENTS = ['vino', 'vodka', 'jugo', 'sirope', 'agua'];
  const INGREDIENT_LABELS = Object.freeze({
    vino: 'Vino',
    vodka: 'Vodka',
    jugo: 'Jugo',
    sirope: 'Sirope',
    agua: 'Agua'
  });
  const activeLocks = new Set();

  function clone(value) {
    if (value == null) return value;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
  }

  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function str(value) { return String(value == null ? '' : value).trim(); }
  function upper(value) { return str(value).toUpperCase().replace(/\s+/g, '').slice(0, 4); }
  function number(value) {
    const n = Number(String(value == null ? 0 : value).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  function qty(value) {
    const n = number(value);
    return Number.isFinite(n) && n > 0 && Number.isInteger(n) ? n : 0;
  }
  function nowIso() { return new Date().toISOString(); }
  function hasOwn(obj, key) { return !!obj && Object.prototype.hasOwnProperty.call(obj, key); }
  function formatQuantity(value) {
    const n = number(value);
    try {
      return new Intl.NumberFormat('es-NI', { maximumFractionDigits: 2 }).format(n);
    } catch (_) {
      return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
    }
  }
  function itemUnit(amount) { return number(amount) === 1 ? 'unidad' : 'unidades'; }
  function quotedProduct(name) { return '‘' + (str(name) || 'Producto') + '’'; }
  function bool(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    const raw = str(value).toLowerCase();
    if (['true', '1', 'si', 'sí', 'yes', 'y'].includes(raw)) return true;
    if (['false', '0', 'no', 'n'].includes(raw)) return false;
    return !!fallback;
  }

  function productIdOf(product) {
    try {
      if (g.A33Products && typeof g.A33Products.getProductId === 'function') {
        return str(g.A33Products.getProductId(product));
      }
    } catch (_) { }
    const p = isObject(product) ? product : {};
    return str(p.productId || p.productoId || '');
  }

  function productIsActive(product) {
    const p = isObject(product) ? product : {};
    if (p.deleted === true) return false;
    if (hasOwn(p, 'active')) return bool(p.active, true);
    if (hasOwn(p, 'activo')) return bool(p.activo, true);
    if (hasOwn(p, 'isActive')) return bool(p.isActive, true);
    return true;
  }

  function productHasExplicitRecipe(product) {
    const p = isObject(product) ? product : {};
    if (hasOwn(p, 'receta')) return p.receta === true || p.receta === 1 || str(p.receta).toLowerCase() === 'true';
    if (hasOwn(p, 'hasRecipe')) return p.hasRecipe === true || p.hasRecipe === 1 || str(p.hasRecipe).toLowerCase() === 'true';
    if (hasOwn(p, 'recipe')) return p.recipe === true || isObject(p.recipe);
    return false;
  }

  function productEnvaseId(product) {
    const p = isObject(product) ? product : {};
    return str(p.envaseId || p.bottleId || p.packagingEnvaseId || '');
  }

  function productTapaId(product) {
    const p = isObject(product) ? product : {};
    return str(p.tapaId || p.capId || p.corkId || p.packagingTapaId || '');
  }

  function productName(product, productId) {
    const p = isObject(product) ? product : {};
    return str(p.name || p.nombre || productId || 'Producto');
  }

  function productLetter(product) {
    const p = isObject(product) ? product : {};
    return upper(p.letra || p.Letra || p.letter || p.productionLetter || '');
  }

  function productCost(product) {
    const p = isObject(product) ? product : {};
    const n = number(p.unitCost ?? p.costoUnitario ?? p.costPerUnit ?? p.cost ?? p.costo ?? p.referenceCost ?? p.costoReferencial);
    return n >= 0 && Number.isFinite(n) ? n : null;
  }

  function normalizeRecipeSnapshot(raw) {
    const source = isObject(raw) ? raw : {};
    const out = {};
    INGREDIENTS.forEach((ingredient) => {
      const value = number(source[ingredient]);
      out[ingredient] = value > 0 ? value : 0;
    });
    return out;
  }

  function recipeHasAmounts(raw) {
    const recipe = normalizeRecipeSnapshot(raw);
    return INGREDIENTS.some((ingredient) => recipe[ingredient] > 0);
  }

  function readRecipeSnapshots() {
    const read = readRawJson(RECIPES_KEY, {});
    if (!read.ok) return { ok: false, data: {}, error: read.error };
    const payload = isObject(read.data) ? read.data : {};
    const rawMap = isObject(payload.recetas) ? payload.recetas : payload;
    const out = {};
    Object.keys(rawMap).forEach((productId) => {
      const id = str(productId);
      if (id && isObject(rawMap[productId])) out[id] = normalizeRecipeSnapshot(rawMap[productId]);
    });
    return { ok: true, data: out };
  }

  function calculateIngredientTotals(items) {
    const totals = Object.fromEntries(INGREDIENTS.map((ingredient) => [ingredient, 0]));
    (Array.isArray(items) ? items : []).forEach((item) => {
      const amount = qty(item && (item.cantidad ?? item.unidades));
      const recipe = normalizeRecipeSnapshot(item && (item.recipeSnapshot || item.recetaSnapshot));
      INGREDIENTS.forEach((ingredient) => { totals[ingredient] += amount * recipe[ingredient]; });
    });
    return totals;
  }

  function normalizeCatalogArray(raw) {
    if (Array.isArray(raw)) return raw.filter(isObject);
    if (isObject(raw)) {
      for (const key of ['items', 'list', 'data', 'rows']) {
        if (Array.isArray(raw[key])) return raw[key].filter(isObject);
      }
    }
    return [];
  }

  function readRawJson(key, fallback) {
    let raw = null;
    try {
      raw = g.A33Storage && typeof g.A33Storage.getItem === 'function'
        ? g.A33Storage.getItem(key)
        : (g.localStorage ? g.localStorage.getItem(key) : null);
    } catch (error) {
      return { ok: false, data: fallback, error: new Error('No se pudo leer ' + key + '.') };
    }
    if (raw == null || raw === '') return { ok: true, data: clone(fallback), empty: true };
    try { return { ok: true, data: JSON.parse(raw), empty: false }; }
    catch (error) { return { ok: false, data: fallback, error: new Error('Los datos de ' + key + ' no tienen un formato válido.') }; }
  }

  function writeRawJson(key, value) {
    try {
      if (g.A33Storage && typeof g.A33Storage.setItem === 'function') return g.A33Storage.setItem(key, JSON.stringify(value));
      if (g.localStorage) { g.localStorage.setItem(key, JSON.stringify(value)); return true; }
    } catch (_) { }
    return false;
  }

  function readCatalog(key) {
    const result = readRawJson(key, []);
    if (!result.ok) return result;
    return { ok: true, data: normalizeCatalogArray(result.data) };
  }

  function catalogRowActive(row) {
    if (!row || row.deleted === true) return false;
    if (hasOwn(row, 'active')) return bool(row.active, true);
    if (hasOwn(row, 'activo')) return bool(row.activo, true);
    if (hasOwn(row, 'isActive')) return bool(row.isActive, true);
    return true;
  }

  function catalogById(rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const id = str(row && row.id);
      if (id) map.set(id, row);
    });
    return map;
  }

  async function readProductsStrict() {
    if (!g.A33Products || typeof g.A33Products.getAll !== 'function') {
      return { ok: false, items: [], error: new Error('No está disponible el catálogo central de Productos.') };
    }
    try {
      const rows = await g.A33Products.getAll();
      return { ok: true, items: Array.isArray(rows) ? rows : [] };
    } catch (error) {
      return { ok: false, items: [], error: error instanceof Error ? error : new Error('No se pudieron leer los Productos.') };
    }
  }

  async function loadFabricableProducts() {
    const read = await readProductsStrict();
    if (!read.ok) return { ok: false, status: 'read-error', items: [], errors: [read.error.message], duplicateLetters: [] };

    const envasesRead = readCatalog(ENVASES_KEY);
    const tapasRead = readCatalog(TAPAS_KEY);
    const recipesRead = readRecipeSnapshots();
    if (!recipesRead.ok) {
      return { ok: false, status: 'read-error', items: [], errors: [recipesRead.error.message], duplicateLetters: [] };
    }
    const envases = envasesRead.ok ? envasesRead.data : [];
    const tapas = tapasRead.ok ? tapasRead.data : [];
    const recipes = recipesRead.data;
    const envasesMap = catalogById(envases);
    const tapasMap = catalogById(tapas);

    const items = [];
    const errors = [];
    const seenIds = new Set();
    for (const product of read.items) {
      if (!productIsActive(product) || !productHasExplicitRecipe(product)) continue;
      const productId = productIdOf(product);
      if (!productId) {
        errors.push('Hay un producto activo con Receta que no tiene productId válido.');
        continue;
      }
      if (seenIds.has(productId)) {
        errors.push('productId duplicado: ' + productId + '.');
        continue;
      }
      seenIds.add(productId);
      const envaseId = productEnvaseId(product);
      const tapaId = productTapaId(product);
      const letra = productLetter(product);
      const envase = envaseId ? envasesMap.get(envaseId) : null;
      const tapa = tapaId ? tapasMap.get(tapaId) : null;
      const capacityRaw = product.capacityMl ?? product.capacidadMl ?? product.capacity ?? product.capacidad ?? product.volumenMl ?? product.ml
        ?? (envase && (envase.capacityMl ?? envase.capacidadMl ?? envase.ml ?? envase.volumenMl));
      const capacity = number(capacityRaw);
      const recipeSnapshot = normalizeRecipeSnapshot(recipes[productId]);
      items.push({
        id: productId,
        productId,
        nombre: productName(product, productId),
        name: productName(product, productId),
        receta: true,
        activo: true,
        letra,
        Letra: letra,
        envaseId,
        tapaId,
        capacidadMl: capacity > 0 ? capacity : 0,
        volumenMl: capacity > 0 ? capacity : 0,
        costoReferencial: productCost(product),
        recipeSnapshot,
        recetaSnapshot: clone(recipeSnapshot),
        recetaConfigurada: recipeHasAmounts(recipeSnapshot),
        catalogProduct: clone(product),
        envaseSnapshot: envase ? clone(envase) : null,
        tapaSnapshot: tapa ? clone(tapa) : null,
        envaseValido: !!(envase && catalogRowActive(envase)),
        tapaValida: !!(tapa && catalogRowActive(tapa))
      });
    }

    const letterUse = new Map();
    items.forEach((item) => {
      if (!item.letra) return;
      if (!letterUse.has(item.letra)) letterUse.set(item.letra, []);
      letterUse.get(item.letra).push(item.productId);
    });
    const duplicateLetters = Array.from(letterUse.entries()).filter(([, ids]) => ids.length > 1).map(([letter, ids]) => ({ letter, productIds: ids }));

    items.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es-NI', { sensitivity: 'base' }));
    return {
      ok: true,
      status: items.length ? (duplicateLetters.length ? 'catalog-invalid' : 'catalog') : 'catalog-empty',
      items,
      allProducts: read.items.map(clone),
      errors,
      duplicateLetters,
      envases,
      tapas
    };
  }

  function defaultInventory() {
    return { liquids: {}, bottles: {}, caps: {}, finished: {}, finishedByProductId: {}, varios: [], movimientos: [], productionOperations: {} };
  }

  function ensureInventoryShape(raw) {
    const inv = isObject(raw) ? clone(raw) : defaultInventory();
    for (const section of ['liquids', 'bottles', 'caps', 'finished', 'finishedByProductId', 'productionOperations']) {
      if (!isObject(inv[section])) inv[section] = {};
    }
    if (!Array.isArray(inv.varios)) inv.varios = [];
    if (!Array.isArray(inv.movimientos)) inv.movimientos = [];
    return inv;
  }

  function readSharedStrict(key, fallback) {
    const raw = readRawJson(key, fallback);
    if (!raw.ok) return { ok: false, data: clone(fallback), meta: { rev: null }, error: raw.error };
    try {
      if (g.A33Storage && typeof g.A33Storage.sharedRead === 'function') {
        const shared = g.A33Storage.sharedRead(key, fallback);
        return { ok: true, data: shared.data, meta: shared.meta || { rev: null } };
      }
    } catch (error) {
      return { ok: false, data: clone(fallback), meta: { rev: null }, error };
    }
    return { ok: true, data: raw.data, meta: { rev: null } };
  }

  function sharedWrite(key, data, metaRev, source) {
    if (g.A33Storage && typeof g.A33Storage.sharedSet === 'function') {
      return g.A33Storage.sharedSet(key, data, {
        source: source || 'produccion',
        baseRev: typeof metaRev === 'number' ? metaRev : null,
        conflictPolicy: 'block'
      });
    }
    const ok = writeRawJson(key, data);
    return { ok, data, meta: null, conflict: false, message: ok ? '' : 'No se pudo guardar.' };
  }

  function sharedReplaceExact(key, data, metaRev, source) {
    if (g.A33Storage && typeof g.A33Storage.sharedReplaceExact === 'function') {
      return g.A33Storage.sharedReplaceExact(key, data, {
        source: source || 'produccion-atomica',
        baseRev: typeof metaRev === 'number' ? metaRev : null
      });
    }
    if (g.A33Storage && typeof g.A33Storage.sharedSet === 'function') {
      return g.A33Storage.sharedSet(key, data, {
        source: source || 'produccion-atomica',
        baseRev: typeof metaRev === 'number' ? metaRev : null,
        conflictPolicy: 'block'
      });
    }
    const ok = writeRawJson(key, data);
    return { ok, data, meta: null, conflict: false, message: ok ? '' : 'No se pudo guardar.' };
  }

  function acquireCommitLock(operationId) {
    const now = Date.now();
    const token = operationId + '::' + now + '::' + Math.random().toString(36).slice(2);
    const current = readRawJson(COMMIT_LOCK_KEY, null);
    const lock = current.ok && isObject(current.data) ? current.data : null;
    if (lock && number(lock.expiresAt) > now && str(lock.token)) {
      return { ok:false, message:'Hay una producción en proceso. Espera a que termine e inténtalo nuevamente.' };
    }
    const next = { operationId, token, createdAt:nowIso(), expiresAt:now + COMMIT_LOCK_TTL_MS };
    if (!writeRawJson(COMMIT_LOCK_KEY, next)) return { ok:false, message:'No se pudo bloquear la operación de producción de forma segura.' };
    const verify = readRawJson(COMMIT_LOCK_KEY, null);
    if (!verify.ok || !isObject(verify.data) || str(verify.data.token) !== token) {
      return { ok:false, message:'No se pudo confirmar el bloqueo exclusivo de la producción.' };
    }
    return { ok:true, token };
  }

  function releaseCommitLock(token) {
    if (!token) return;
    const current = readRawJson(COMMIT_LOCK_KEY, null);
    if (!current.ok || !isObject(current.data) || str(current.data.token) !== str(token)) return;
    try {
      if (g.A33Storage && typeof g.A33Storage.removeItem === 'function') g.A33Storage.removeItem(COMMIT_LOCK_KEY);
      else if (g.localStorage) g.localStorage.removeItem(COMMIT_LOCK_KEY);
    } catch (_) { }
  }

  function exactInventoryOperation(inv, operationId) {
    if (!operationId || !inv) return null;
    if (isObject(inv.productionOperations) && isObject(inv.productionOperations[operationId])) return inv.productionOperations[operationId];
    return null;
  }

  function exactLoteOperation(lotes, operationId, loteId) {
    const list = Array.isArray(lotes) ? lotes : [];
    return list.find((row) => str(row && (row.operationId || row.productionOperationId)) === operationId)
      || list.find((row) => loteId && str(row && (row.loteId || row.id)) === loteId && str(row && (row.operationId || row.productionOperationId)) === operationId)
      || null;
  }

  function rollbackAtomicState(context) {
    const ctx = isObject(context) ? context : {};
    const result = { ok:true, lotes:true, inventory:true, errors:[] };

    if (ctx.lotWritten) {
      const lotRollback = sharedReplaceExact(LOTES_KEY, clone(ctx.beforeLotes || []), ctx.lotWrittenRev, 'produccion-rollback-lotes');
      if (!lotRollback || lotRollback.ok === false) {
        result.ok = false;
        result.lotes = false;
        result.errors.push('No se pudo restaurar Control de Lotes: ' + ((lotRollback && lotRollback.message) || 'error de almacenamiento'));
      }
    }

    if (ctx.inventoryWritten) {
      const invRollback = sharedReplaceExact(INVENTORY_KEY, clone(ctx.beforeInventory || defaultInventory()), ctx.inventoryWrittenRev, 'produccion-rollback-inventario');
      if (!invRollback || invRollback.ok === false) {
        result.ok = false;
        result.inventory = false;
        result.errors.push('No se pudo restaurar Inventario: ' + ((invRollback && invRollback.message) || 'error de almacenamiento'));
      }
    }

    const invVerify = readSharedStrict(INVENTORY_KEY, defaultInventory());
    const lotVerify = readSharedStrict(LOTES_KEY, []);
    if (invVerify.ok && hasInventoryOperation(invVerify.data, str(ctx.operationId))) {
      result.ok = false;
      result.inventory = false;
      result.errors.push('La operación todavía aparece en Inventario después del rollback.');
    }
    if (lotVerify.ok && exactLoteOperation(lotVerify.data, str(ctx.operationId), str(ctx.loteId))) {
      result.ok = false;
      result.lotes = false;
      result.errors.push('El lote todavía aparece guardado después del rollback.');
    }
    return result;
  }

  function movementId(operationId, type, itemId, productId) {
    return [operationId, type, str(itemId), str(productId)].filter(Boolean).join('::');
  }

  function hasInventoryOperation(inv, operationId) {
    if (!operationId || !inv) return false;
    if (isObject(inv.productionOperations) && inv.productionOperations[operationId]) return true;
    return (Array.isArray(inv.movimientos) ? inv.movimientos : []).some((m) => str(m && m.operationId) === operationId);
  }

  function findLoteByOperation(lotes, operationId, loteId) {
    const list = Array.isArray(lotes) ? lotes : [];
    return list.find((lote) => str(lote && (lote.operationId || lote.productionOperationId)) === operationId)
      || list.find((lote) => loteId && str(lote && (lote.loteId || lote.id)) === loteId)
      || null;
  }

  function buildInventoryPlan(invRaw, itemsRaw, ingredientTotalsRaw, operationId, lote) {
    const inv = ensureInventoryShape(invRaw);
    const items = Array.isArray(itemsRaw) ? itemsRaw : [];
    const ingredientTotals = isObject(ingredientTotalsRaw) ? ingredientTotalsRaw : {};
    const configurationErrors = [];
    const ingredientShortages = [];
    const packagingShortages = [];
    const systemErrors = [];
    const envasesRead = readCatalog(ENVASES_KEY);
    const tapasRead = readCatalog(TAPAS_KEY);
    if (!envasesRead.ok) systemErrors.push(envasesRead.error.message);
    if (!tapasRead.ok) systemErrors.push(tapasRead.error.message);
    const envases = catalogById(envasesRead.ok ? envasesRead.data : []);
    const tapas = catalogById(tapasRead.ok ? tapasRead.data : []);

    const byProductId = new Map();
    const duplicateLetterMap = new Map();
    for (const raw of items) {
      const productId = str(raw && (raw.productId || raw.productoId || raw.id));
      const amount = qty(raw && (raw.cantidad ?? raw.unidades));
      const name = str(raw && (raw.nombreSnapshot || raw.nombre || raw.name || productId || 'Producto'));
      const letter = upper(raw && (raw.Letra || raw.letra));
      if (!productId) {
        configurationErrors.push('El producto ' + quotedProduct(name) + ' no tiene productId válido. Corrígelo en Catálogos → Productos.');
        continue;
      }
      if (!amount) {
        configurationErrors.push('El producto ' + quotedProduct(name) + ' tiene una cantidad producida inválida. Revisa la Calculadora de Producción.');
        continue;
      }
      if (byProductId.has(productId)) {
        configurationErrors.push('El producto ' + quotedProduct(name) + ' está repetido en la producción. Recalcula antes de confirmar.');
        continue;
      }
      if (!letter) configurationErrors.push('El producto ' + quotedProduct(name) + ' no tiene Letra de producción. Asígnala en Catálogos → Productos.');
      if (letter) {
        if (!duplicateLetterMap.has(letter)) duplicateLetterMap.set(letter, []);
        duplicateLetterMap.get(letter).push(productId);
      }
      const envaseId = str(raw && raw.envaseId);
      const tapaId = str(raw && raw.tapaId);
      if (!envaseId) {
        configurationErrors.push('El producto ' + quotedProduct(name) + ' no tiene un Envase activo asignado en Catálogos → Productos.');
      } else if (!envases.has(envaseId) || !catalogRowActive(envases.get(envaseId))) {
        configurationErrors.push('El producto ' + quotedProduct(name) + ' tiene un Envase inexistente o inactivo. Corrige la asignación en Catálogos → Productos.');
      }
      if (!tapaId) {
        configurationErrors.push('El producto ' + quotedProduct(name) + ' no tiene Tapa o Corcho activo asignado en Catálogos → Productos.');
      } else if (!tapas.has(tapaId) || !catalogRowActive(tapas.get(tapaId))) {
        configurationErrors.push('El producto ' + quotedProduct(name) + ' tiene una Tapa o Corcho inexistente o inactivo. Corrige la asignación en Catálogos → Productos.');
      }
      byProductId.set(productId, { ...raw, productId, cantidad: amount, unidades: amount, nombre: name, nombreSnapshot: name, letra: letter, Letra: letter, envaseId, tapaId });
    }
    duplicateLetterMap.forEach((ids, letter) => {
      if (ids.length > 1) configurationErrors.push('La Letra de producción ' + letter + ' está repetida. Corrígela en Catálogos → Productos.');
    });

    if (!byProductId.size) configurationErrors.push('No hay productos válidos para confirmar la producción. Revisa Catálogos → Productos.');

    const usage = { liquids: {}, bottles: {}, caps: {}, finished: {} };
    INGREDIENTS.forEach((ingredient) => {
      const used = Math.max(0, number(ingredientTotals[ingredient]));
      usage.liquids[ingredient] = used;
      const current = number(inv.liquids[ingredient] && inv.liquids[ingredient].stock);
      if (used > current) {
        ingredientShortages.push(
          (INGREDIENT_LABELS[ingredient] || ingredient) + ': disponible ' + formatQuantity(current) + ' ml / requerido ' + formatQuantity(used) + ' ml'
        );
      }
    });

    byProductId.forEach((item) => {
      usage.bottles[item.envaseId] = (usage.bottles[item.envaseId] || 0) + item.cantidad;
      usage.caps[item.tapaId] = (usage.caps[item.tapaId] || 0) + item.cantidad;
      usage.finished[item.productId] = (usage.finished[item.productId] || 0) + item.cantidad;
    });

    Object.entries(usage.bottles).forEach(([id, used]) => {
      const current = number(inv.bottles[id] && inv.bottles[id].stock);
      if (used > current) {
        const row = envases.get(id);
        const name = str(row && (row.name || row.nombre)) || id;
        packagingShortages.push('Envase ' + name + ': disponible ' + formatQuantity(current) + ' / requerido ' + formatQuantity(used) + ' ' + itemUnit(used));
      }
    });
    Object.entries(usage.caps).forEach(([id, used]) => {
      const current = number(inv.caps[id] && inv.caps[id].stock);
      if (used > current) {
        const row = tapas.get(id);
        const name = str(row && (row.name || row.nombre)) || id;
        packagingShortages.push('Tapa/Corcho ' + name + ': disponible ' + formatQuantity(current) + ' / requerido ' + formatQuantity(used) + ' ' + itemUnit(used));
      }
    });

    const errors = [...systemErrors, ...configurationErrors, ...ingredientShortages, ...packagingShortages];
    if (errors.length) {
      const sections = [];
      if (systemErrors.length) sections.push('No se puede confirmar la producción por un problema de lectura:\n\n' + systemErrors.join('\n'));
      if (configurationErrors.length) sections.push('No se puede confirmar la producción por configuración incompleta:\n\n' + configurationErrors.map((text) => '• ' + text).join('\n'));
      if (ingredientShortages.length) sections.push('No se puede confirmar la producción. Inventario insuficiente:\n\n' + ingredientShortages.join('\n'));
      if (packagingShortages.length) sections.push('No se puede confirmar la producción. Empaques insuficientes:\n\n' + packagingShortages.join('\n'));
      return {
        ok: false,
        validation: true,
        diagnosticCode: configurationErrors.length ? 'product-configuration' : (ingredientShortages.length ? 'ingredient-shortage' : (packagingShortages.length ? 'packaging-shortage' : 'inventory-read')),
        errors,
        message: sections.join('\n\n'),
        details: { systemErrors, configurationErrors, ingredientShortages, packagingShortages },
        usage,
        inventory: inv
      };
    }

    const after = ensureInventoryShape(inv);
    const timestamp = nowIso();
    const loteId = str(lote && (lote.loteId || lote.id));
    const loteCode = str(lote && (lote.codigo || lote.batchCode));
    const appendMovement = (movement) => {
      const id = movementId(operationId, movement.tipoItem, movement.itemId, movement.productId);
      if (after.movimientos.some((m) => str(m && m.id) === id)) return;
      after.movimientos.push({
        id,
        operationId,
        loteId,
        loteCodigo: loteCode,
        fecha: timestamp,
        fechaProduccion: str(lote && lote.fecha),
        origen: 'Producción',
        ...movement
      });
    };

    INGREDIENTS.forEach((ingredient) => {
      const used = usage.liquids[ingredient] || 0;
      if (!(used > 0)) return;
      if (!isObject(after.liquids[ingredient])) after.liquids[ingredient] = { stock: 0, max: 0 };
      const before = number(after.liquids[ingredient].stock);
      const next = before - used;
      after.liquids[ingredient].stock = next;
      appendMovement({
        tipoItem: 'liquido', itemId: ingredient, nombreSnapshot: ingredient,
        cantidad: used, delta: -used, stockAnterior: before, stockNuevo: next,
        tipoMovimiento: 'consumo_produccion'
      });
    });

    byProductId.forEach((item) => {
      if (!isObject(after.bottles[item.envaseId])) after.bottles[item.envaseId] = { stock: 0 };
      if (!isObject(after.caps[item.tapaId])) after.caps[item.tapaId] = { stock: 0, min: 0 };
      if (!isObject(after.finishedByProductId[item.productId])) after.finishedByProductId[item.productId] = { productId: item.productId, stock: 0 };

      const bottleBefore = number(after.bottles[item.envaseId].stock);
      const bottleAfter = bottleBefore - item.cantidad;
      after.bottles[item.envaseId].stock = bottleAfter;
      const envaseRow = envases.get(item.envaseId);
      appendMovement({
        tipoItem: 'envase', itemId: item.envaseId, productId: item.productId,
        nombreSnapshot: str(envaseRow && (envaseRow.name || envaseRow.nombre)) || item.envaseId,
        productNameSnapshot: item.nombreSnapshot, cantidad: item.cantidad, delta: -item.cantidad,
        stockAnterior: bottleBefore, stockNuevo: bottleAfter, tipoMovimiento: 'consumo_produccion'
      });

      const capBefore = number(after.caps[item.tapaId].stock);
      const capAfter = capBefore - item.cantidad;
      after.caps[item.tapaId].stock = capAfter;
      const tapaRow = tapas.get(item.tapaId);
      appendMovement({
        tipoItem: 'tapa', itemId: item.tapaId, productId: item.productId,
        nombreSnapshot: str(tapaRow && (tapaRow.name || tapaRow.nombre)) || item.tapaId,
        productNameSnapshot: item.nombreSnapshot, cantidad: item.cantidad, delta: -item.cantidad,
        stockAnterior: capBefore, stockNuevo: capAfter, tipoMovimiento: 'consumo_produccion'
      });

      const finishedBefore = number(after.finishedByProductId[item.productId].stock);
      const finishedAfter = finishedBefore + item.cantidad;
      after.finishedByProductId[item.productId] = {
        ...after.finishedByProductId[item.productId],
        productId: item.productId,
        nombre: item.nombreSnapshot,
        nombreSnapshot: item.nombreSnapshot,
        Letra: item.Letra,
        letra: item.letra,
        envaseId: item.envaseId,
        tapaId: item.tapaId,
        stock: finishedAfter,
        ultimaProduccion: str(lote && lote.fecha),
        lastOperationId: operationId
      };
      appendMovement({
        tipoItem: 'producto_terminado', itemId: item.productId, productId: item.productId,
        nombreSnapshot: item.nombreSnapshot, cantidad: item.cantidad, delta: item.cantidad,
        stockAnterior: finishedBefore, stockNuevo: finishedAfter, tipoMovimiento: 'alta_produccion'
      });
    });

    after.productionOperations[operationId] = {
      operationId,
      loteId,
      loteCodigo: loteCode,
      status: 'inventory-applied',
      fecha: timestamp,
      origen: 'Producción',
      productos: Array.from(byProductId.values()).map((item) => ({
        productId: item.productId,
        nombreSnapshot: item.nombreSnapshot,
        cantidad: item.cantidad,
        envaseId: item.envaseId,
        tapaId: item.tapaId,
        Letra: item.Letra
      }))
    };

    return { ok: true, inventory: inv, after, usage, items: Array.from(byProductId.values()) };
  }

  function readTransactions() {
    const read = readRawJson(TX_KEY, []);
    return read.ok && Array.isArray(read.data) ? read.data : [];
  }

  function saveTransactions(list) {
    const rows = (Array.isArray(list) ? list : []).slice(-80);
    return writeRawJson(TX_KEY, rows);
  }

  function upsertTransaction(record) {
    const list = readTransactions();
    const index = list.findIndex((row) => str(row && row.operationId) === str(record && record.operationId));
    if (index >= 0) list[index] = { ...list[index], ...clone(record), updatedAt: nowIso() };
    else list.push({ ...clone(record), createdAt: nowIso(), updatedAt: nowIso() });
    saveTransactions(list);
    return list.find((row) => str(row && row.operationId) === str(record && record.operationId));
  }

  function markTransaction(operationId, patch) {
    return upsertTransaction({ operationId, ...patch });
  }

  function addOrReplaceLote(lotes, lote) {
    const list = Array.isArray(lotes) ? lotes.slice() : [];
    const loteId = str(lote && (lote.loteId || lote.id));
    const operationId = str(lote && (lote.operationId || lote.productionOperationId));
    const sameOp = list.findIndex((row) => operationId && str(row && (row.operationId || row.productionOperationId)) === operationId);
    if (sameOp >= 0) { list[sameOp] = { ...list[sameOp], ...clone(lote) }; return { ok: true, list, duplicate: true }; }
    const sameId = list.find((row) => loteId && str(row && (row.loteId || row.id)) === loteId);
    if (sameId) return { ok: false, list, message: 'Ya existe un lote con ese código/identidad y no tiene la misma operación.' };
    list.push(clone(lote));
    return { ok: true, list, duplicate: false };
  }

  async function recoverPendingTransactionsUnlocked() {
    const terminal = new Set(['committed', 'aborted', 'rolled-back']);
    const transactions = readTransactions().filter((tx) => tx && !terminal.has(str(tx.state)));
    const results = [];
    for (const tx of transactions) {
      const operationId = str(tx.operationId);
      const loteId = str(tx.lote && (tx.lote.loteId || tx.lote.id));
      if (!operationId || !tx.lote) continue;
      const invRead = readSharedStrict(INVENTORY_KEY, defaultInventory());
      const lotRead = readSharedStrict(LOTES_KEY, []);
      if (!invRead.ok || !lotRead.ok) {
        results.push({ operationId, ok:false, state:'read-error' });
        continue;
      }
      const hasInv = !!exactInventoryOperation(invRead.data, operationId) || hasInventoryOperation(invRead.data, operationId);
      const hasLot = !!exactLoteOperation(lotRead.data, operationId, loteId);
      if (hasInv && hasLot) {
        markTransaction(operationId, { state:'committed', recoveredAt:nowIso() });
        results.push({ operationId, ok:true, state:'committed' });
        continue;
      }
      if (!hasInv && !hasLot) {
        markTransaction(operationId, { state:'aborted', recoveredAt:nowIso(), lastError:'La operación no dejó cambios parciales.' });
        results.push({ operationId, ok:true, state:'aborted' });
        continue;
      }

      const hasAtomicSnapshots = number(tx.schema) >= 2 && hasOwn(tx, 'beforeInventory') && hasOwn(tx, 'beforeLotes');
      if (hasAtomicSnapshots) {
        const hasSafeInventoryRev = !hasInv || Number.isFinite(tx.inventoryWrittenRev);
        const hasSafeLoteRev = !hasLot || Number.isFinite(tx.loteWrittenRev);
        if (!hasSafeInventoryRev || !hasSafeLoteRev) {
          const revisionError = 'No se ejecutó rollback automático porque faltan revisiones verificables y podría existir trabajo posterior.';
          markTransaction(operationId, { state:'needs-attention', lastError:revisionError });
          results.push({ operationId, ok:false, state:'needs-attention', errors:[revisionError] });
          continue;
        }
        const rollback = rollbackAtomicState({
          operationId,
          loteId,
          beforeInventory:tx.beforeInventory,
          beforeLotes:tx.beforeLotes,
          inventoryWritten:hasInv,
          lotWritten:hasLot,
          // Usar la revisión exacta escrita por la transacción. Si otro módulo
          // modificó los datos después, el CAS bloquea el rollback para no borrar
          // trabajo posterior y deja la operación marcada para atención.
          inventoryWrittenRev:tx.inventoryWrittenRev,
          lotWrittenRev:tx.loteWrittenRev
        });
        if (rollback.ok) {
          markTransaction(operationId, { state:'rolled-back', recoveredAt:nowIso(), lastError:'Se restauró una operación incompleta sin conservar cambios parciales.' });
          results.push({ operationId, ok:true, state:'rolled-back' });
        } else {
          markTransaction(operationId, { state:'needs-attention', lastError:rollback.errors.join(' ') });
          results.push({ operationId, ok:false, state:'needs-attention', errors:rollback.errors });
        }
        continue;
      }

      // Compatibilidad con operaciones pendientes creadas antes del hardening atómico.
      if (hasInv && !hasLot) {
        const add = addOrReplaceLote(lotRead.data, tx.lote);
        if (!add.ok) {
          markTransaction(operationId, { state:'needs-attention', lastError:add.message });
          results.push({ operationId, ok:false, state:'needs-attention' });
          continue;
        }
        const write = sharedReplaceExact(LOTES_KEY, add.list, lotRead.meta && lotRead.meta.rev, 'produccion-recovery-legacy');
        if (write && write.ok !== false) {
          markTransaction(operationId, { state:'committed', recoveredAt:nowIso(), legacyRecovery:true });
          results.push({ operationId, ok:true, state:'committed' });
        } else {
          markTransaction(operationId, { state:'needs-attention', lastError:(write && write.message) || 'No se pudo completar el lote heredado.' });
          results.push({ operationId, ok:false, state:'needs-attention' });
        }
        continue;
      }
      markTransaction(operationId, { state:'needs-attention', lastError:'Existe un lote heredado sin confirmación equivalente en Inventario.' });
      results.push({ operationId, ok:false, state:'needs-attention' });
    }
    return results;
  }


  async function recoverPendingTransactions(options) {
    const opts = isObject(options) ? options : {};
    let ownedLock = null;
    if (!str(opts.lockToken)) {
      ownedLock = acquireCommitLock('production-recovery');
      if (!ownedLock.ok) return [{ operationId:'', ok:false, state:'busy', skipped:true, message:ownedLock.message }];
    }
    try {
      return await recoverPendingTransactionsUnlocked();
    } finally {
      if (ownedLock && ownedLock.token) releaseCommitLock(ownedLock.token);
    }
  }

  async function commitOfficialProduction(options) {
    const opts = isObject(options) ? options : {};
    const operationId = str(opts.operationId);
    const lote = clone(opts.lote);
    const requestedItems = Array.isArray(opts.items) ? opts.items : [];
    if (!operationId || !lote) return { ok:false, diagnosticCode:'operation-validation', message:'Falta el identificador estable de la operación o el lote.' };
    const loteId = str(lote.loteId || lote.id);
    const loteCode = str(lote.codigo || lote.batchCode || lote.lotCode);
    if (!loteId || !loteCode) return { ok:false, diagnosticCode:'lot-validation', message:'El lote no tiene loteId o código estable.' };
    if (!requestedItems.length) return { ok:false, diagnosticCode:'empty-production', message:'No se puede guardar una producción vacía.' };
    if (activeLocks.has(operationId)) return { ok:false, duplicate:true, diagnosticCode:'operation-busy', message:'La producción ya se está guardando.' };

    activeLocks.add(operationId);
    const lock = acquireCommitLock(operationId);
    if (!lock.ok) {
      activeLocks.delete(operationId);
      return { ok:false, duplicate:true, diagnosticCode:'global-lock', message:lock.message };
    }

    const atomicContext = {
      operationId,
      loteId,
      beforeInventory:null,
      beforeLotes:null,
      inventoryWritten:false,
      lotWritten:false,
      inventoryWrittenRev:null,
      lotWrittenRev:null
    };

    try {
      await recoverPendingTransactions({ lockToken:lock.token });

      const invRead = readSharedStrict(INVENTORY_KEY, defaultInventory());
      if (!invRead.ok) return { ok:false, diagnosticCode:'inventory-read', message:invRead.error ? invRead.error.message : 'No se pudo leer Inventario.' };
      const lotRead = readSharedStrict(LOTES_KEY, []);
      if (!lotRead.ok) return { ok:false, diagnosticCode:'lot-read', message:lotRead.error ? lotRead.error.message : 'No se pudieron leer Lotes.' };

      atomicContext.beforeInventory = clone(invRead.data);
      atomicContext.beforeLotes = clone(lotRead.data);

      const invExists = hasInventoryOperation(invRead.data, operationId);
      const lotExists = findLoteByOperation(lotRead.data, operationId, loteId);
      if (invExists && lotExists && str(lotExists.operationId || lotExists.productionOperationId) === operationId) {
        markTransaction(operationId, { state:'committed', lote });
        return { ok:true, duplicate:true, operationId, message:'La producción ya estaba guardada; no se aplicaron movimientos adicionales.' };
      }
      if (lotExists && str(lotExists.operationId || lotExists.productionOperationId) !== operationId) {
        return { ok:false, diagnosticCode:'lot-conflict', message:'Ya existe un lote con ese código/identidad. No se aplicó Inventario para evitar duplicados.' };
      }
      if (invExists && !lotExists) {
        const recovered = await recoverPendingTransactions({ lockToken:lock.token });
        const result = recovered.find((row) => row.operationId === operationId);
        return result && result.ok && result.state === 'committed'
          ? { ok:true, recovered:true, duplicate:true, operationId, message:'La operación heredada pendiente fue recuperada sin duplicar Inventario.' }
          : { ok:false, pending:true, diagnosticCode:'pending-operation', message:'Existe una operación incompleta previa. No se aplicaron movimientos adicionales.' };
      }

      const catalog = await loadFabricableProducts();
      if (!catalog.ok) return { ok:false, validation:true, diagnosticCode:'catalog-read', errors:catalog.errors || ['No se pudieron validar los Productos.'], message:(catalog.errors || []).join('\n') };
      if (catalog.duplicateLetters && catalog.duplicateLetters.length) {
        const errors = catalog.duplicateLetters.map((row) => 'La Letra ' + row.letter + ' está repetida entre productos fabricables.');
        return { ok:false, validation:true, diagnosticCode:'duplicate-letter', errors, message:errors.join('\n') };
      }

      const currentById = new Map(catalog.items.map((item) => [str(item.productId), item]));
      const allProductsById = new Map((Array.isArray(catalog.allProducts) ? catalog.allProducts : []).map((item) => [productIdOf(item), item]));
      const currentItems = [];
      const catalogErrors = [];
      requestedItems.forEach((raw) => {
        const productId = str(raw && (raw.productId || raw.productoId || raw.id));
        const rawName = str(raw && (raw.nombreSnapshot || raw.nombre || raw.name || productId || 'Producto'));
        const amount = qty(raw && (raw.cantidad ?? raw.unidades));
        if (!productId) {
          catalogErrors.push('El producto ' + quotedProduct(rawName) + ' no tiene productId válido. Corrígelo en Catálogos → Productos.');
          return;
        }
        if (!amount) {
          catalogErrors.push('El producto ' + quotedProduct(rawName) + ' tiene una cantidad producida inválida.');
          return;
        }
        const current = currentById.get(productId);
        if (!current) {
          const sourceProduct = allProductsById.get(productId);
          const name = productName(sourceProduct || raw, productId);
          if (sourceProduct && !productIsActive(sourceProduct)) {
            catalogErrors.push('El producto seleccionado ' + quotedProduct(name) + ' está inactivo. Reactívalo en Catálogos → Productos para realizar una nueva producción.');
          } else if (sourceProduct && !productHasExplicitRecipe(sourceProduct)) {
            catalogErrors.push('No se puede confirmar la producción porque el producto ' + quotedProduct(name) + ' no tiene Receta activa. Actívala en Catálogos → Productos.');
          } else {
            catalogErrors.push('No se puede confirmar la producción porque el producto ' + quotedProduct(name) + ' ya no existe como producto fabricable en Catálogos → Productos.');
          }
          return;
        }
        const recipeSnapshot = normalizeRecipeSnapshot(raw && (raw.recipeSnapshot || raw.recetaSnapshot || current.recipeSnapshot));
        if (!recipeHasAmounts(recipeSnapshot)) {
          catalogErrors.push('No se puede confirmar la producción porque el producto ' + quotedProduct(current.nombre) + ' tiene Receta activa, pero no tiene cantidades reales configuradas. Corrígela en Calculadora de Producción.');
          return;
        }
        currentItems.push({
          ...raw,
          ...current,
          id:productId,
          productId,
          cantidad:amount,
          unidades:amount,
          nombre:current.nombre,
          nombreSnapshot:current.nombre,
          envaseId:current.envaseId,
          tapaId:current.tapaId,
          Letra:current.Letra,
          letra:current.letra,
          recipeSnapshot,
          recetaSnapshot:clone(recipeSnapshot),
          legacy:false
        });
      });
      if (catalogErrors.length) {
        return {
          ok:false,
          validation:true,
          diagnosticCode:'product-validation',
          errors:catalogErrors,
          message:'No se puede confirmar la producción:\n\n' + catalogErrors.map((text) => '• ' + text).join('\n')
        };
      }

      const calculatedIngredientTotals = calculateIngredientTotals(currentItems);
      const currentByProductId = new Map(currentItems.map((item) => [item.productId, item]));
      lote.loteId = loteId;
      lote.id = loteId;
      lote.codigo = loteCode;
      lote.batchCode = loteCode;
      lote.lotCode = loteCode;
      lote.operationId = operationId;
      lote.productionOperationId = operationId;
      lote.updatedAt = nowIso();
      lote.productosProducidos = (Array.isArray(lote.productosProducidos) ? lote.productosProducidos : currentItems).map((row) => {
        const productId = str(row && (row.productId || row.productoId || row.id));
        const current = currentByProductId.get(productId);
        return current ? {
          ...row,
          id:productId,
          productId,
          operationId,
          productionOperationId:operationId,
          nombre:current.nombre,
          nombreSnapshot:current.nombre,
          Letra:current.Letra,
          letra:current.letra,
          cantidad:qty(row && (row.cantidad ?? row.unidades)) || current.cantidad,
          unidades:qty(row && (row.cantidad ?? row.unidades)) || current.cantidad,
          envaseId:current.envaseId,
          tapaId:current.tapaId,
          recipeSnapshot:clone(current.recipeSnapshot),
          recetaSnapshot:clone(current.recipeSnapshot),
          legacy:false
        } : row;
      });
      lote.volVino = String(Math.round(calculatedIngredientTotals.vino));
      lote.volVodka = String(Math.round(calculatedIngredientTotals.vodka));
      lote.volJugo = String(Math.round(calculatedIngredientTotals.jugo));
      lote.volSirope = String(Math.round(calculatedIngredientTotals.sirope));
      lote.volAgua = String(Math.round(calculatedIngredientTotals.agua));
      const calculatedVolume = currentItems.reduce((sum, item) => sum + (qty(item.cantidad) * Math.max(0, number(item.capacidadMl || item.volumenMl))), 0);
      if (calculatedVolume > 0) lote.volTotal = String(Math.round(calculatedVolume));

      const plan = buildInventoryPlan(invRead.data, currentItems, calculatedIngredientTotals, operationId, lote);
      if (!plan.ok) {
        return {
          ok:false,
          validation:true,
          diagnosticCode:plan.diagnosticCode || 'inventory-validation',
          errors:plan.errors,
          details:plan.details || null,
          message:plan.message || plan.errors.join('\n')
        };
      }
      if (plan.after.productionOperations[operationId]) {
        plan.after.productionOperations[operationId].status = 'committed';
        plan.after.productionOperations[operationId].committedAt = nowIso();
      }

      const add = addOrReplaceLote(lotRead.data, lote);
      if (!add.ok) {
        return { ok:false, diagnosticCode:'lot-validation', message:'No se puede crear el lote. ' + (add.message || 'Revisa el código y los datos del lote en Calculadora de Producción.') };
      }

      markTransaction(operationId, {
        schema:2,
        state:'prepared',
        lote:clone(lote),
        beforeInventory:clone(invRead.data),
        beforeLotes:clone(lotRead.data),
        inventoryBaseRev:invRead.meta && invRead.meta.rev,
        lotesBaseRev:lotRead.meta && lotRead.meta.rev,
        inventoryUsage:clone(plan.usage)
      });

      const invWrite = sharedReplaceExact(INVENTORY_KEY, plan.after, invRead.meta && invRead.meta.rev, 'calculadora-produccion-atomica');
      if (!invWrite || invWrite.ok === false) {
        markTransaction(operationId, { state:'aborted', lastError:(invWrite && invWrite.message) || 'No se pudo guardar Inventario.' });
        return { ok:false, diagnosticCode:'inventory-write', message:'No se pudo registrar la producción en Inventario. No se creó ningún lote. ' + ((invWrite && invWrite.message) || 'Revisa el almacenamiento disponible e inténtalo nuevamente.') };
      }
      atomicContext.inventoryWritten = true;
      atomicContext.inventoryWrittenRev = invWrite.meta && invWrite.meta.rev;
      markTransaction(operationId, { state:'inventory-applied', inventoryWrittenRev:atomicContext.inventoryWrittenRev });

      let lotWrite = null;
      if (opts.testForceLotWriteFailure === true) {
        lotWrite = { ok:false, message:'Fallo forzado de prueba al guardar lote.' };
      } else {
        lotWrite = sharedReplaceExact(LOTES_KEY, add.list, lotRead.meta && lotRead.meta.rev, 'calculadora-produccion-atomica');
      }
      if (!lotWrite || lotWrite.ok === false) {
        const rollback = rollbackAtomicState(atomicContext);
        markTransaction(operationId, {
          state:rollback.ok ? 'rolled-back' : 'needs-attention',
          rolledBackAt:rollback.ok ? nowIso() : null,
          lastError:(lotWrite && lotWrite.message) || 'No se pudo guardar el lote.',
          rollbackErrors:rollback.errors
        });
        return rollback.ok
          ? { ok:false, rolledBack:true, diagnosticCode:'lot-write-rolled-back', message:'No se pudo guardar el lote. Inventario fue restaurado y no quedaron cambios parciales. Detalle: ' + ((lotWrite && lotWrite.message) || 'Error de almacenamiento.') }
          : { ok:false, pending:true, diagnosticCode:'rollback-failed', message:'Falló el guardado del lote y no fue posible completar el rollback automático. ' + rollback.errors.join(' ') };
      }
      atomicContext.lotWritten = true;
      atomicContext.lotWrittenRev = lotWrite.meta && lotWrite.meta.rev;
      markTransaction(operationId, { state:'lote-applied', loteWrittenRev:atomicContext.lotWrittenRev });

      const invVerify = readSharedStrict(INVENTORY_KEY, defaultInventory());
      const lotVerify = readSharedStrict(LOTES_KEY, []);
      const verifiedInventory = invVerify.ok && !!exactInventoryOperation(invVerify.data, operationId);
      const verifiedLote = lotVerify.ok && !!exactLoteOperation(lotVerify.data, operationId, loteId);
      if (!verifiedInventory || !verifiedLote) {
        const rollback = rollbackAtomicState(atomicContext);
        markTransaction(operationId, {
          state:rollback.ok ? 'rolled-back' : 'needs-attention',
          rolledBackAt:rollback.ok ? nowIso() : null,
          lastError:'La verificación posterior al guardado no confirmó Inventario y Lote.',
          rollbackErrors:rollback.errors
        });
        return rollback.ok
          ? { ok:false, rolledBack:true, diagnosticCode:'readback-rolled-back', message:'La producción no pudo verificarse. Se restauraron Inventario y Lotes; no quedaron cambios parciales.' }
          : { ok:false, pending:true, diagnosticCode:'readback-rollback-failed', message:'La producción no pudo verificarse y el rollback requiere atención. ' + rollback.errors.join(' ') };
      }

      markTransaction(operationId, { state:'committed', committedAt:nowIso(), beforeInventory:null, beforeLotes:null });
      return { ok:true, duplicate:false, operationId, inventory:invVerify.data, lote:clone(lote) };
    } catch (error) {
      let rollback = { ok:true, errors:[] };
      if (atomicContext.inventoryWritten || atomicContext.lotWritten) rollback = rollbackAtomicState(atomicContext);
      markTransaction(operationId, {
        state:rollback.ok ? 'rolled-back' : 'needs-attention',
        rolledBackAt:rollback.ok ? nowIso() : null,
        lastError:error && error.message ? error.message : String(error),
        rollbackErrors:rollback.errors
      });
      return rollback.ok
        ? { ok:false, rolledBack:true, diagnosticCode:'unexpected-error-rolled-back', message:'No se pudo completar la producción. Se restauraron los datos y no quedaron cambios parciales. Detalle: ' + (error && error.message ? error.message : 'Error interno no identificado.') }
        : { ok:false, pending:true, diagnosticCode:'unexpected-error-rollback-failed', message:'No se pudo completar la producción y el rollback requiere atención. ' + rollback.errors.join(' ') };
    } finally {
      releaseCommitLock(lock.token);
      activeLocks.delete(operationId);
    }
  }

  g.A33Production = Object.freeze({
    inventoryKey: INVENTORY_KEY,
    lotesKey: LOTES_KEY,
    transactionKey: TX_KEY,
    ingredients: INGREDIENTS.slice(),
    productIdOf,
    productIsActive,
    productHasExplicitRecipe,
    normalizeRecipeSnapshot,
    recipeHasAmounts,
    calculateIngredientTotals,
    loadFabricableProducts,
    buildInventoryPlan,
    commitOfficialProduction,
    recoverPendingTransactions,
    hasInventoryOperation,
    exactLoteOperation
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
