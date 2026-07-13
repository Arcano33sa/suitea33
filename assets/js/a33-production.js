// Suite A33 — Producción oficial dinámica por productId
(function (g) {
  'use strict';

  const INVENTORY_KEY = 'arcano33_inventario';
  const LOTES_KEY = 'arcano33_lotes';
  const TX_KEY = 'a33_production_transactions_v1';
  const ENVASES_KEY = 'a33_catalog_envases_v1';
  const TAPAS_KEY = 'a33_catalog_tapas_v1';
  const RECIPES_KEY = 'arcano33_recetas_v1';
  const INGREDIENTS = ['vino', 'vodka', 'jugo', 'sirope', 'agua'];
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
    const missing = [];
    const envasesRead = readCatalog(ENVASES_KEY);
    const tapasRead = readCatalog(TAPAS_KEY);
    if (!envasesRead.ok) missing.push(envasesRead.error.message);
    if (!tapasRead.ok) missing.push(tapasRead.error.message);
    const envases = catalogById(envasesRead.ok ? envasesRead.data : []);
    const tapas = catalogById(tapasRead.ok ? tapasRead.data : []);

    const byProductId = new Map();
    const duplicateLetterMap = new Map();
    for (const raw of items) {
      const productId = str(raw && (raw.productId || raw.productoId || raw.id));
      const amount = qty(raw && (raw.cantidad ?? raw.unidades));
      const name = str(raw && (raw.nombreSnapshot || raw.nombre || raw.name || productId || 'Producto'));
      const letter = upper(raw && (raw.Letra || raw.letra));
      if (!productId) { missing.push(name + ': falta productId válido.'); continue; }
      if (!amount) { missing.push(name + ': cantidad producida inválida.'); continue; }
      if (byProductId.has(productId)) { missing.push(name + ': productId repetido en la producción.'); continue; }
      if (!letter) missing.push(name + ': falta Letra configurada en Catálogos.');
      if (letter) {
        if (!duplicateLetterMap.has(letter)) duplicateLetterMap.set(letter, []);
        duplicateLetterMap.get(letter).push(productId);
      }
      const envaseId = str(raw && raw.envaseId);
      const tapaId = str(raw && raw.tapaId);
      if (!envaseId) missing.push(name + ': falta Envase asignado.');
      else if (!envases.has(envaseId) || !catalogRowActive(envases.get(envaseId))) missing.push(name + ': el Envase asignado no existe o está inactivo.');
      if (!tapaId) missing.push(name + ': falta Tapa o corcho asignado.');
      else if (!tapas.has(tapaId) || !catalogRowActive(tapas.get(tapaId))) missing.push(name + ': la Tapa o corcho asignado no existe o está inactivo.');
      byProductId.set(productId, { ...raw, productId, cantidad: amount, unidades: amount, nombre: name, nombreSnapshot: name, letra: letter, Letra: letter, envaseId, tapaId });
    }
    duplicateLetterMap.forEach((ids, letter) => {
      if (ids.length > 1) missing.push('La Letra ' + letter + ' está repetida entre productos fabricables.');
    });

    if (!byProductId.size) missing.push('No hay productos válidos para guardar producción.');

    const usage = { liquids: {}, bottles: {}, caps: {}, finished: {} };
    INGREDIENTS.forEach((ingredient) => {
      const used = Math.max(0, number(ingredientTotals[ingredient]));
      usage.liquids[ingredient] = used;
      const current = number(inv.liquids[ingredient] && inv.liquids[ingredient].stock);
      if (used > current) missing.push('Líquido ' + ingredient + ': disponible ' + current + ' ml, requiere ' + used + ' ml, faltan ' + (used - current) + ' ml.');
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
        missing.push(name + ': disponible ' + current + ', requiere ' + used + ', faltan ' + (used - current) + '.');
      }
    });
    Object.entries(usage.caps).forEach(([id, used]) => {
      const current = number(inv.caps[id] && inv.caps[id].stock);
      if (used > current) {
        const row = tapas.get(id);
        const name = str(row && (row.name || row.nombre)) || id;
        missing.push(name + ': disponible ' + current + ', requiere ' + used + ', faltan ' + (used - current) + '.');
      }
    });

    if (missing.length) return { ok: false, errors: missing, usage, inventory: inv };

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

  async function recoverPendingTransactions() {
    const transactions = readTransactions().filter((tx) => tx && !['committed', 'aborted'].includes(str(tx.state)));
    const results = [];
    for (const tx of transactions) {
      const operationId = str(tx.operationId);
      if (!operationId || !tx.lote) continue;
      const invRead = readSharedStrict(INVENTORY_KEY, defaultInventory());
      const lotRead = readSharedStrict(LOTES_KEY, []);
      if (!invRead.ok || !lotRead.ok) {
        results.push({ operationId, ok: false, state: 'read-error' });
        continue;
      }
      const hasInv = hasInventoryOperation(invRead.data, operationId);
      const hasLot = !!findLoteByOperation(lotRead.data, operationId, str(tx.lote.loteId || tx.lote.id));
      if (hasInv && hasLot) {
        markTransaction(operationId, { state: 'committed', recoveredAt: nowIso() });
        results.push({ operationId, ok: true, state: 'committed' });
        continue;
      }
      if (hasInv && !hasLot) {
        const add = addOrReplaceLote(lotRead.data, tx.lote);
        if (!add.ok) {
          markTransaction(operationId, { state: 'needs-attention', lastError: add.message });
          results.push({ operationId, ok: false, state: 'needs-attention' });
          continue;
        }
        const write = sharedWrite(LOTES_KEY, add.list, lotRead.meta && lotRead.meta.rev, 'produccion-recovery');
        if (write && write.ok !== false) {
          markTransaction(operationId, { state: 'committed', recoveredAt: nowIso() });
          results.push({ operationId, ok: true, state: 'committed' });
        } else {
          markTransaction(operationId, { state: 'inventory-applied', lastError: (write && write.message) || 'No se pudo completar el lote.' });
          results.push({ operationId, ok: false, state: 'inventory-applied' });
        }
        continue;
      }
      if (!hasInv && hasLot) {
        markTransaction(operationId, { state: 'needs-attention', lastError: 'Existe el lote, pero falta confirmar Inventario.' });
        results.push({ operationId, ok: false, state: 'needs-attention' });
        continue;
      }
      markTransaction(operationId, { state: 'aborted', lastError: 'La operación preparada no alcanzó a modificar Lotes ni Inventario.' });
      results.push({ operationId, ok: true, state: 'aborted' });
    }
    return results;
  }

  async function commitOfficialProduction(options) {
    const opts = isObject(options) ? options : {};
    const operationId = str(opts.operationId);
    const lote = clone(opts.lote);
    if (!operationId || !lote) return { ok: false, message: 'Falta el identificador estable de la operación o el lote.' };
    if (activeLocks.has(operationId)) return { ok: false, duplicate: true, message: 'La producción ya se está guardando.' };
    activeLocks.add(operationId);
    try {
      await recoverPendingTransactions();

      const invRead = readSharedStrict(INVENTORY_KEY, defaultInventory());
      if (!invRead.ok) return { ok: false, message: invRead.error ? invRead.error.message : 'No se pudo leer Inventario.' };
      const lotRead = readSharedStrict(LOTES_KEY, []);
      if (!lotRead.ok) return { ok: false, message: lotRead.error ? lotRead.error.message : 'No se pudieron leer Lotes.' };

      const loteId = str(lote.loteId || lote.id);
      const invExists = hasInventoryOperation(invRead.data, operationId);
      const lotExists = findLoteByOperation(lotRead.data, operationId, loteId);
      if (invExists && lotExists && str(lotExists.operationId || lotExists.productionOperationId) === operationId) {
        markTransaction(operationId, { state: 'committed', lote });
        return { ok: true, duplicate: true, message: 'La producción ya estaba guardada; no se aplicaron movimientos adicionales.' };
      }
      if (lotExists && str(lotExists.operationId || lotExists.productionOperationId) !== operationId) {
        return { ok: false, message: 'Ya existe un lote con ese código/identidad. No se aplicó Inventario para evitar duplicados.' };
      }
      if (invExists && !lotExists) {
        markTransaction(operationId, { state: 'inventory-applied', lote });
        const recovered = await recoverPendingTransactions();
        const result = recovered.find((row) => row.operationId === operationId);
        return result && result.ok
          ? { ok: true, recovered: true, message: 'La operación pendiente fue recuperada sin duplicar Inventario.' }
          : { ok: false, pending: true, message: 'Inventario ya contiene la operación; el lote quedó pendiente de recuperación.' };
      }

      // Revalidar contra el Catálogo actual en el mismo momento del guardado.
      const catalog = await loadFabricableProducts();
      if (!catalog.ok) return { ok:false, validation:true, errors:catalog.errors || ['No se pudieron validar los Productos.'], message:(catalog.errors || []).join('\n') };
      if (catalog.duplicateLetters && catalog.duplicateLetters.length) {
        const errors = catalog.duplicateLetters.map((row) => 'La Letra ' + row.letter + ' está repetida entre productos fabricables.');
        return { ok:false, validation:true, errors, message:errors.join('\n') };
      }
      const currentById = new Map(catalog.items.map((item) => [str(item.productId), item]));
      const currentItems = [];
      const catalogErrors = [];
      (Array.isArray(opts.items) ? opts.items : []).forEach((raw) => {
        const productId = str(raw && (raw.productId || raw.productoId || raw.id));
        const current = currentById.get(productId);
        if (!current) {
          catalogErrors.push((str(raw && (raw.nombreSnapshot || raw.nombre || productId)) || 'Producto') + ': ya no existe activo con Receta en Catálogos.');
          return;
        }
        const recipeSnapshot = normalizeRecipeSnapshot(raw && (raw.recipeSnapshot || raw.recetaSnapshot || current.recipeSnapshot));
        if (!recipeHasAmounts(recipeSnapshot)) {
          catalogErrors.push(current.nombre + ': la Receta está habilitada, pero no tiene cantidades reales configuradas.');
          return;
        }
        currentItems.push({
          ...raw,
          ...current,
          id:productId,
          productId,
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
      if (catalogErrors.length) return { ok:false, validation:true, errors:catalogErrors, message:catalogErrors.join('\n') };

      const calculatedIngredientTotals = calculateIngredientTotals(currentItems);
      const currentByProductId = new Map(currentItems.map((item) => [item.productId, item]));
      if (Array.isArray(lote.productosProducidos)) {
        lote.productosProducidos = lote.productosProducidos.map((row) => {
          const productId = str(row && (row.productId || row.productoId || row.id));
          const current = currentByProductId.get(productId);
          return current ? {
            ...row,
            productId,
            nombre:current.nombre,
            nombreSnapshot:current.nombre,
            Letra:current.Letra,
            letra:current.letra,
            envaseId:current.envaseId,
            tapaId:current.tapaId,
            recipeSnapshot:clone(current.recipeSnapshot),
            recetaSnapshot:clone(current.recipeSnapshot),
            legacy:false
          } : row;
        });
      }
      lote.volVino = String(Math.round(calculatedIngredientTotals.vino));
      lote.volVodka = String(Math.round(calculatedIngredientTotals.vodka));
      lote.volJugo = String(Math.round(calculatedIngredientTotals.jugo));
      lote.volSirope = String(Math.round(calculatedIngredientTotals.sirope));
      lote.volAgua = String(Math.round(calculatedIngredientTotals.agua));
      const calculatedVolume = currentItems.reduce((sum, item) => sum + (qty(item.cantidad) * Math.max(0, number(item.capacidadMl || item.volumenMl))), 0);
      if (calculatedVolume > 0) lote.volTotal = String(Math.round(calculatedVolume));

      const plan = buildInventoryPlan(invRead.data, currentItems, calculatedIngredientTotals, operationId, lote);
      if (!plan.ok) return { ok: false, validation: true, errors: plan.errors, message: plan.errors.join('\n') };

      const add = addOrReplaceLote(lotRead.data, { ...lote, operationId, productionOperationId: operationId });
      if (!add.ok) return { ok: false, message: add.message };

      markTransaction(operationId, {
        state: 'prepared',
        lote: { ...lote, operationId, productionOperationId: operationId },
        inventoryUsage: plan.usage
      });

      const invWrite = sharedWrite(INVENTORY_KEY, plan.after, invRead.meta && invRead.meta.rev, 'calculadora-produccion');
      if (!invWrite || invWrite.ok === false) {
        markTransaction(operationId, { state: 'prepared', lastError: (invWrite && invWrite.message) || 'No se pudo guardar Inventario.' });
        return { ok: false, message: (invWrite && invWrite.message) || 'No se pudo guardar Inventario.' };
      }
      markTransaction(operationId, { state: 'inventory-applied' });

      const lotWrite = sharedWrite(LOTES_KEY, add.list, lotRead.meta && lotRead.meta.rev, 'calculadora-produccion');
      if (!lotWrite || lotWrite.ok === false) {
        markTransaction(operationId, { state: 'inventory-applied', lastError: (lotWrite && lotWrite.message) || 'No se pudo guardar el lote.' });
        return {
          ok: false,
          pending: true,
          message: 'Inventario quedó protegido con una operación pendiente recuperable. Reabre Calculadora para completar el lote sin duplicar movimientos.'
        };
      }

      const finalInv = ensureInventoryShape(invWrite.data || plan.after);
      if (finalInv.productionOperations[operationId]) finalInv.productionOperations[operationId].status = 'committed';
      const latestMeta = g.A33Storage && typeof g.A33Storage.sharedGetMeta === 'function'
        ? g.A33Storage.sharedGetMeta(INVENTORY_KEY)
        : null;
      sharedWrite(INVENTORY_KEY, finalInv, latestMeta && latestMeta.rev, 'calculadora-produccion-commit');
      markTransaction(operationId, { state: 'committed', committedAt: nowIso() });
      return { ok: true, duplicate: false, operationId, inventory: finalInv, lote: { ...lote, operationId, productionOperationId: operationId } };
    } catch (error) {
      markTransaction(operationId, { state: 'needs-attention', lastError: error && error.message ? error.message : String(error) });
      return { ok: false, pending: true, message: error && error.message ? error.message : 'No se pudo completar la producción.' };
    } finally {
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
    hasInventoryOperation
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
