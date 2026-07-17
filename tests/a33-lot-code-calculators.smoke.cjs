"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const lotCode = require("../assets/js/a33-lot-code.js");

const root = path.resolve(__dirname, "..");
const production = fs.readFileSync(path.join(root, "calculadora/index.html"), "utf8");
const temporal = fs.readFileSync(path.join(root, "calculadora_temporal/index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "calculadora/sw.js"), "utf8");

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `Debe existir ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : -1;
  return source.slice(start, end > start ? end : source.length);
}

for (const [label, html] of [["Producción", production], ["Temporal", temporal]]) {
  assert.ok(html.includes('/assets/js/a33-lot-code.js?v=4.20.95&r=6'), `${label} debe cargar el generador central`);
  const preview = functionBody(html, "recalcularCodigoLoteAuto", "a33WireNumericInput");
  assert.ok(preview.includes("api.generate"), `${label} debe generar mediante A33LotCode`);
  assert.ok(!preview.includes('"OFF"'), `${label} no debe usar respaldo OFF`);
  assert.ok(!preview.includes("consecMask"), `${label} no debe construir el formato histórico`);
  assert.ok(!preview.includes("STORAGE_LOTE_SEQ_LAST_KEY"), `${label} no debe comprometer consecutivo al previsualizar`);

  const validator = functionBody(html, "validarCodigoLoteFuerte", "existeCodigoEnLotes");
  assert.ok(validator.includes("api.validate"), `${label} debe validar por componentes con A33LotCode`);
  assert.ok(!validator.includes("code.length"), `${label} no debe validar por longitud fija total`);
}

assert.ok(production.includes('codigoValidado.format !== "new"'), "Producción debe impedir guardar un código histórico como lote nuevo");
assert.ok(production.includes("existeCodigoEnLotes(lotesActuales"), "Producción debe comprobar colisión antes del commit");
assert.ok(production.includes("a33RefreshChecklistAfterLotSave"), "Checklist debe seguir refrescándose solo tras guardar lote");
assert.ok(production.includes('const STORAGE_LOTE_SEQ_LAST_KEY = "arcano33_calc_ultimo_consecutivo"'), "Producción conserva su secuencia propia");
assert.ok(temporal.includes('const STORAGE_LOTE_SEQ_LAST_KEY = "arcano33_temporal_ultimo_consecutivo"'), "Temporal conserva secuencia aislada");
assert.notStrictEqual(
  production.match(/const STORAGE_LOTE_SEQ_LAST_KEY = "([^"]+)"/)[1],
  temporal.match(/const STORAGE_LOTE_SEQ_LAST_KEY = "([^"]+)"/)[1],
  "Los consecutivos no deben mezclarse"
);

const loadHistorical = functionBody(temporal, "cargarRegistroTemporal", "eliminarRegistroTemporal");
assert.ok(loadHistorical.includes('setCodigoLoteValue(reg.codigo || "")'), "Al cargar histórico debe mostrar el código original");
assert.ok(loadHistorical.includes('fechaProdInput.value = hoyLocalISO()'), "Al cargar histórico debe mantener la fecha actual de trabajo");
assert.ok(loadHistorical.includes('A33CodigoLoteMode = "HISTORICAL"'), "El histórico debe quedar protegido como consulta");
assert.ok(!loadHistorical.includes("recalcularCodigoLoteAuto"), "Cargar histórico no debe recalcular su código");
assert.ok(!loadHistorical.includes("commitConsecutivoDespuesDeGuardar"), "Cargar histórico no debe avanzar consecutivo");
assert.ok(temporal.includes("v.format !== 'new'"), "Temporal debe exigir regeneración explícita antes de guardar desde histórico");
assert.ok(temporal.includes("No se sobrescribió ni se duplicó"), "Temporal debe bloquear colisiones sin sobrescribir");

assert.ok(sw.includes("a33-lot-code.js?v=4.20.95&r=6"), "La PWA de Producción debe precachear el generador central");
assert.ok(sw.includes("MODULE_CACHE_REV = '7'"), "La PWA debe forzar renovación de caché del módulo");

const kislev = lotCode.generate({ productionDate: "2025-12-10", consecutiveNumber: 1 });
assert.strictEqual(kislev.code, "A33KIS5786-0xx1");
assert.ok(!kislev.code.includes("OFF"));
assert.ok(!kislev.code.includes("2025"));

const av = lotCode.generate({ productionDate: "2026-07-17", consecutiveNumber: 1 });
assert.strictEqual(av.code, "A33AV5786-0xx1");
assert.ok(!av.code.includes("OFF"));

let committed = 7;
const preview1 = lotCode.generate({ productionDate: "2025-12-10", consecutiveNumber: committed + 1 }).code;
const preview2 = lotCode.generate({ productionDate: "2025-12-10", consecutiveNumber: committed + 1 }).code;
assert.strictEqual(preview1, preview2, "Calcular/abrir vistas no debe consumir otro consecutivo");
assert.strictEqual(committed, 7, "La previsualización no debe alterar el consecutivo comprometido");
committed = lotCode.validate(preview1).consecutiveNumber;
assert.strictEqual(committed, 8, "Guardar exitosamente compromete exactamente el consecutivo usado");
assert.strictEqual(lotCode.generate({ productionDate: "2025-12-10", consecutiveNumber: committed + 1 }).code, "A33KIS5786-0xx9");

assert.strictEqual(lotCode.validate("A330XX119TEV5786").format, "historical");
assert.strictEqual(lotCode.validate("A33AV5786-0xx1").format, "new");

console.log("A33 calculators lot-code integration smoke: OK");
