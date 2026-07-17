"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const lotCode = require(path.join(root, "assets/js/a33-lot-code.js"));
global.A33LotCode = lotCode;

const lotesHtml = fs.readFileSync(path.join(root, "lotes/index.html"), "utf8");
const lotesJs = fs.readFileSync(path.join(root, "lotes/script.js"), "utf8");
const lotesSw = fs.readFileSync(path.join(root, "lotes/sw.js"), "utf8");
const calculadora = fs.readFileSync(path.join(root, "calculadora/index.html"), "utf8");
const productionSource = fs.readFileSync(path.join(root, "assets/js/a33-production.js"), "utf8");

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `Debe existir ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : -1;
  return source.slice(start, end > start ? end : source.length);
}

assert.ok(lotesHtml.includes('/assets/js/a33-lot-code.js?v=4.20.95&r=6'), "Lotes debe cargar el generador central");
assert.ok(lotesHtml.indexOf('a33-lot-code.js') < lotesHtml.indexOf('a33-production.js'), "Lotes debe cargar el código de lote antes de Producción");
assert.ok(lotesSw.includes("MODULE_CACHE_REV = '21'"), "Lotes debe renovar su caché PWA");
assert.ok(lotesSw.includes('a33-lot-code.js?v=4.20.95&r=6'), "Lotes debe precachear el generador central");

const canonical = functionBody(lotesJs, "canonicalBatchCode", "batchCodeIdentityKey");
assert.ok(canonical.includes("parseBatchCode"), "Lotes debe canonizar por componentes");
assert.ok(!canonical.includes("toUpperCase"), "Lotes no debe convertir las x visibles a mayúscula");
assert.ok(lotesJs.includes("stableLoteRecordId"), "Lotes debe usar una identidad estable");
assert.ok(lotesJs.includes("loteRecordIdentityCandidates"), "Lotes debe tolerar aliases históricos de identidad");
assert.ok(lotesJs.includes("lotCodeConsecutiveNumber"), "Lotes debe ordenar por consecutivo numérico cuando corresponda");
assert.ok(lotesJs.includes("compareLotesNewestFirst"), "Lotes debe tener orden cronológico robusto");
assert.ok(lotesJs.includes("batchCodeIdentityKey"), "Búsqueda y dedupe deben comparar sin alterar el código visible");
assert.ok(lotesJs.includes("codigoLoteData"), "Lotes debe conservar datos estructurados del código");

const checklistIdentity = functionBody(calculadora, "a33ChecklistLotIdentityCandidates", "a33ChecklistLotIdentity");
assert.ok(checklistIdentity.includes("loteId"), "Checklist debe preferir loteId");
assert.ok(checklistIdentity.includes("operationId"), "Checklist debe aceptar operationId como alias estable");
assert.ok(checklistIdentity.includes("a33ChecklistCodeIdentity"), "Checklist debe tener fallback por código compatible");
assert.ok(calculadora.includes("a33ChecklistCompareLots"), "Checklist debe ordenar por fecha/consecutivo y no solo por texto");
assert.ok(calculadora.includes("selectIdentity:identity"), "Después de guardar, Checklist debe seleccionar el lote recién creado");
assert.ok(calculadora.includes("loteCodigo:a33ChecklistLotCode"), "Checklist debe persistir la asociación con el código del lote");
assert.ok(calculadora.includes("loteId: stableId"), "Los productos y checklist nuevos deben conservar loteId");
assert.ok(calculadora.includes("loteCodigo: codigoGuardado"), "Los productos y checklist nuevos deben conservar loteCodigo");

assert.ok(productionSource.includes("canonicalLotCode"), "Inventario debe canonizar el código sin perder x minúsculas");
assert.ok(productionSource.includes("ultimoCodigoLote"), "Producto terminado debe conservar el último código de lote");
assert.ok(productionSource.includes("ultimoLoteId"), "Producto terminado debe conservar loteId");
assert.ok(productionSource.includes("costoUnitario: item.costoUnitario"), "Movimiento de producto terminado debe conservar costo unitario");
assert.ok(productionSource.includes("costoTotal: item.costoTotal"), "Movimiento de producto terminado debe conservar costo total");
assert.ok(productionSource.includes("movementId(operationId"), "La idempotencia de movimientos debe seguir basada en operationId");
assert.ok(productionSource.includes("if (invExists && lotExists"), "El commit debe seguir bloqueando duplicados ya aplicados");

assert.strictEqual(lotCode.validate("A33KIS5786-0XX1").code, "A33KIS5786-0xx1");
assert.strictEqual(lotCode.validate("A33AV5786-0xx2").consecutiveNumber, 2);
assert.strictEqual(lotCode.validate("A330XX119TEV5786").format, "historical");

// Ejecutar las funciones reales de Checklist en un contexto aislado.
const checklistRows = [
  {
    id:"legacy-lot-1", codigo:"A330XX119TEV5786", fecha:"2025-12-19", createdAt:"2025-12-19T12:00:00.000Z",
    volVino:"450", volVodka:"100", volJugo:"150", volSirope:"150", volAgua:"150",
    checklistProduccion:{ schema:1, items:{ vino:true, vodka:false, jugo:false, sirope:false, agua:false } }
  },
  {
    loteId:"batch_A33AV5786-0xx1", id:"batch_A33AV5786-0xx1", codigo:"A33AV5786-0XX1", fecha:"2026-07-17", createdAt:"2026-07-17T10:00:00.000Z",
    volVino:"900", volVodka:"200", volJugo:"300", volSirope:"300", volAgua:"300",
    checklistProduccion:{ schema:1, items:{ vino:false, vodka:false, jugo:false, sirope:false, agua:false } }
  },
  {
    loteId:"batch_A33AV5786-0xx2", id:"batch_A33AV5786-0xx2", codigo:"A33AV5786-0xx2", fecha:"2026-07-17", createdAt:"2026-07-17T10:00:00.000Z",
    volVino:"1350", volVodka:"300", volJugo:"450", volSirope:"450", volAgua:"450",
    checklistProduccion:{ schema:1, items:{ vino:false, vodka:true, jugo:false, sirope:false, agua:false } }
  }
];
let checklistRev = 0;
const checklistStorage = {
  sharedGet() { return JSON.parse(JSON.stringify(checklistRows)); },
  sharedRead() { return { data:JSON.parse(JSON.stringify(checklistRows)), meta:{ rev:checklistRev } }; },
  sharedReplaceExact(_key, next, options) {
    assert.strictEqual(options.baseRev, checklistRev);
    checklistRows.splice(0, checklistRows.length, ...JSON.parse(JSON.stringify(next)));
    checklistRev += 1;
    return { ok:true, data:JSON.parse(JSON.stringify(checklistRows)), meta:{ rev:checklistRev } };
  }
};
const checklistContext = {
  console, Date, Intl, String, Number, Array, Set, JSON, Object,
  A33_CHECKLIST_STORAGE_KEY:"arcano33_lotes",
  A33_CHECKLIST_SCHEMA:1,
  A33_CHECKLIST_INGREDIENTS:[
    { key:"vino", label:"Vino", direct:["volVino"] },
    { key:"vodka", label:"Vodka", direct:["volVodka"] },
    { key:"jugo", label:"Jugo", direct:["volJugo"] },
    { key:"sirope", label:"Sirope", direct:["volSirope"] },
    { key:"agua", label:"Agua pura", direct:["volAgua"] }
  ],
  A33Storage:checklistStorage,
  window:{ A33LotCode:lotCode, A33Storage:checklistStorage, localStorage:null }
};
vm.createContext(checklistContext);
const checklistFunctions = [
  functionBody(calculadora, "normalizarCodigoLote", "codigoLoteIdentityKey"),
  functionBody(calculadora, "a33ChecklistNumber", "a33ChecklistCanonicalCode"),
  functionBody(calculadora, "a33ChecklistCanonicalCode", "a33ChecklistCodeIdentity"),
  functionBody(calculadora, "a33ChecklistCodeIdentity", "a33ChecklistLotIdentityCandidates"),
  functionBody(calculadora, "a33ChecklistLotIdentityCandidates", "a33ChecklistLotIdentity"),
  functionBody(calculadora, "a33ChecklistLotIdentity", "a33ChecklistLotTimestamp"),
  functionBody(calculadora, "a33ChecklistLotTimestamp", "a33ChecklistDateText"),
  functionBody(calculadora, "a33ChecklistLotCode", "a33ChecklistConsecutiveNumber"),
  functionBody(calculadora, "a33ChecklistConsecutiveNumber", "a33ChecklistCompareLots"),
  functionBody(calculadora, "a33ChecklistCompareLots", "a33ChecklistProducts"),
  functionBody(calculadora, "a33ChecklistProducts", "a33ChecklistEmptyState"),
  functionBody(calculadora, "a33ChecklistEmptyState", "a33ChecklistState"),
  functionBody(calculadora, "a33ChecklistState", "a33ChecklistPayload"),
  functionBody(calculadora, "a33ChecklistPayload", "a33ChecklistFindIndex"),
  functionBody(calculadora, "a33ChecklistFindIndex", "a33SetChecklistStatus"),
  functionBody(calculadora, "a33ChecklistIngredients", "a33ChecklistLotVolumeMl"),
  functionBody(calculadora, "a33ChecklistLotVolumeMl", "a33ChecklistVolumeText"),
  functionBody(calculadora, "a33ReadChecklistLots", "a33WriteChecklistState"),
  functionBody(calculadora, "a33WriteChecklistState", "a33PersistChecklistChange")
].join("\n");
vm.runInContext(checklistFunctions, checklistContext);

assert.strictEqual(checklistContext.a33ChecklistLotCode(checklistRows[1]), "A33AV5786-0xx1", "Checklist debe mostrar x minúsculas");
assert.strictEqual(checklistContext.a33ChecklistFindIndex(checklistRows, "A33AV5786-0XX1"), 1, "Búsqueda exacta debe tolerar X/x");
assert.strictEqual(checklistContext.a33ChecklistFindIndex(checklistRows, "batch_A33AV5786-0xx2"), 2, "Debe buscar por loteId estable");
const orderedChecklist = checklistContext.a33ReadChecklistLots();
assert.strictEqual(orderedChecklist[0].codigo, "A33AV5786-0xx2", "Con fecha igual, el consecutivo 2 debe ir antes del 1");
assert.strictEqual(orderedChecklist[2].codigo, "A330XX119TEV5786", "El histórico debe seguir disponible");
assert.strictEqual(checklistContext.a33ChecklistLotVolumeMl(checklistRows[1]), 2000, "Debe recuperar los volúmenes del lote seleccionado");

const savedOne = checklistContext.a33WriteChecklistState("A33AV5786-0XX1", { vino:true, vodka:false, jugo:true, sirope:false, agua:false });
assert.strictEqual(savedOne.ok, true);
const savedTwo = checklistContext.a33WriteChecklistState("batch_A33AV5786-0xx2", { vino:false, vodka:true, jugo:false, sirope:true, agua:false });
assert.strictEqual(savedTwo.ok, true);
assert.strictEqual(checklistRows[1].checklistProduccion.items.vino, true);
assert.strictEqual(checklistRows[1].checklistProduccion.items.jugo, true);
assert.strictEqual(checklistRows[1].checklistProduccion.items.sirope, false);
assert.strictEqual(checklistRows[2].checklistProduccion.items.vodka, true);
assert.strictEqual(checklistRows[2].checklistProduccion.items.sirope, true);
assert.strictEqual(checklistRows[2].checklistProduccion.items.vino, false, "Los checklists no deben mezclarse entre lotes");
assert.strictEqual(checklistRows[0].checklistProduccion.items.vino, true, "El checklist histórico debe conservarse");
assert.strictEqual(checklistRows[1].checklistProduccion.loteCodigo, "A33AV5786-0xx1");
assert.strictEqual(checklistRows[2].checklistProduccion.loteId, "batch_A33AV5786-0xx2");

const storageData = {
  a33_catalog_envases_v1: JSON.stringify([{ id:"env-400", name:"Catrina 400 ml", active:true, stock:99 }]),
  a33_catalog_tapas_v1: JSON.stringify([{ id:"corcho", name:"Corcho", active:true, stock:99 }])
};
global.A33Storage = {
  getItem(key) { return Object.prototype.hasOwnProperty.call(storageData, key) ? storageData[key] : null; },
  setItem(key, value) { storageData[key] = value; return true; }
};
delete require.cache[require.resolve(path.join(root, "assets/js/a33-production.js"))];
require(path.join(root, "assets/js/a33-production.js"));

const inventory = {
  liquids: {
    vino:{stock:10000}, vodka:{stock:10000}, jugo:{stock:10000}, sirope:{stock:10000}, agua:{stock:10000}
  },
  bottles:{ "env-400":{stock:20} },
  caps:{ corcho:{stock:20,min:0} },
  finished:{}, finishedByProductId:{}, varios:[], movimientos:[], productionOperations:{}
};
const plan = global.A33Production.buildInventoryPlan(
  inventory,
  [{
    productId:"catrina-400", nombreSnapshot:"Catrina 400 ml", cantidad:2,
    Letra:"C", letra:"C", envaseId:"env-400", tapaId:"corcho", costoUnitario:55
  }],
  { vino:900, vodka:200, jugo:300, sirope:300, agua:300 },
  "production:batch_A33KIS5786-0xx1",
  { loteId:"batch_A33KIS5786-0xx1", codigo:"A33KIS5786-0XX1", fecha:"2026-07-17" }
);
assert.strictEqual(plan.ok, true, plan.message || "El plan de inventario debe ser válido");
const finished = plan.after.finishedByProductId["catrina-400"];
assert.strictEqual(finished.stock, 2);
assert.strictEqual(finished.ultimoCodigoLote, "A33KIS5786-0xx1");
assert.strictEqual(finished.ultimoLoteId, "batch_A33KIS5786-0xx1");
assert.strictEqual(finished.ultimoCostoUnitario, 55);
assert.strictEqual(finished.ultimoCostoTotal, 110);
const finishedMoves = plan.after.movimientos.filter((row) => row.tipoItem === "producto_terminado");
assert.strictEqual(finishedMoves.length, 1, "Debe crearse una sola entrada de producto terminado");
assert.strictEqual(finishedMoves[0].loteCodigo, "A33KIS5786-0xx1");
assert.strictEqual(finishedMoves[0].loteId, "batch_A33KIS5786-0xx1");
assert.strictEqual(finishedMoves[0].envaseId, "env-400");
assert.strictEqual(finishedMoves[0].tapaId, "corcho");
assert.strictEqual(finishedMoves[0].costoTotal, 110);
assert.ok(plan.after.productionOperations["production:batch_A33KIS5786-0xx1"], "La operación debe quedar trazable");


(async () => {
  const shared = {
    arcano33_inventario: JSON.parse(JSON.stringify(inventory)),
    arcano33_lotes: [],
    a33_catalog_envases_v1: [{ id:"env-400", name:"Catrina 400 ml", active:true }],
    a33_catalog_tapas_v1: [{ id:"corcho", name:"Corcho", active:true }],
    arcano33_recetas_v1: { recetas:{ "catrina-400":{ vino:450, vodka:100, jugo:150, sirope:150, agua:150 } } }
  };
  const revisions = Object.fromEntries(Object.keys(shared).map((key) => [key, 0]));
  global.A33Storage = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(shared, key) ? JSON.stringify(shared[key]) : null; },
    setItem(key, value) { shared[key] = JSON.parse(value); revisions[key] = (revisions[key] || 0) + 1; return true; },
    removeItem(key) { delete shared[key]; revisions[key] = (revisions[key] || 0) + 1; },
    sharedRead(key, fallback) {
      const data = Object.prototype.hasOwnProperty.call(shared, key) ? shared[key] : fallback;
      return { data:JSON.parse(JSON.stringify(data)), meta:{ rev:revisions[key] || 0 } };
    },
    sharedReplaceExact(key, data, options) {
      const baseRev = options && typeof options.baseRev === "number" ? options.baseRev : null;
      const currentRev = revisions[key] || 0;
      if (baseRev != null && baseRev !== currentRev) return { ok:false, conflict:true, message:"revision conflict" };
      shared[key] = JSON.parse(JSON.stringify(data));
      revisions[key] = currentRev + 1;
      return { ok:true, data:JSON.parse(JSON.stringify(shared[key])), meta:{ rev:revisions[key] } };
    },
    sharedSet(key, data, options) { return this.sharedReplaceExact(key, data, options || {}); }
  };
  global.A33Products = {
    async getAll() {
      return [{
        productId:"catrina-400", nombre:"Catrina 400 ml", active:true, receta:true,
        Letra:"C", envaseId:"env-400", tapaId:"corcho", costoReferencial:55
      }];
    },
    getProductId(product) { return product && product.productId; }
  };

  const operationId = "production:batch_A33KIS5786-0xx1";
  const commitInput = {
    operationId,
    lote:{
      loteId:"batch_A33KIS5786-0xx1", id:"batch_A33KIS5786-0xx1",
      codigo:"A33KIS5786-0XX1", batchCode:"A33KIS5786-0XX1", fecha:"2026-07-17",
      productosProducidos:[{ productId:"catrina-400", cantidad:2 }]
    },
    items:[{
      productId:"catrina-400", nombreSnapshot:"Catrina 400 ml", cantidad:2,
      Letra:"C", envaseId:"env-400", tapaId:"corcho",
      recipeSnapshot:{ vino:450, vodka:100, jugo:150, sirope:150, agua:150 }
    }],
    ingredientTotals:{ vino:900, vodka:200, jugo:300, sirope:300, agua:300 }
  };

  const first = await global.A33Production.commitOfficialProduction(commitInput);
  assert.strictEqual(first.ok, true, first.message || "El primer commit debe guardar");
  assert.strictEqual(first.duplicate, false);
  const firstMovementCount = shared.arcano33_inventario.movimientos.length;
  const firstStock = shared.arcano33_inventario.finishedByProductId["catrina-400"].stock;
  assert.strictEqual(shared.arcano33_lotes.length, 1);
  assert.strictEqual(shared.arcano33_lotes[0].codigo, "A33KIS5786-0xx1");
  assert.strictEqual(firstStock, 2);

  const second = await global.A33Production.commitOfficialProduction(commitInput);
  assert.strictEqual(second.ok, true, second.message || "El segundo commit debe reconocerse");
  assert.strictEqual(second.duplicate, true, "El segundo commit debe ser idempotente");
  assert.strictEqual(shared.arcano33_lotes.length, 1, "No debe duplicarse el lote");
  assert.strictEqual(shared.arcano33_inventario.movimientos.length, firstMovementCount, "No deben duplicarse movimientos");
  assert.strictEqual(shared.arcano33_inventario.finishedByProductId["catrina-400"].stock, firstStock, "No debe duplicarse la existencia");

  console.log("A33 lot code stage 3 integration smoke: OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
