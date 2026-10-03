// Coherencia de versiones y precache: a33-publicacion-coherencia.smoke.cjs.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const lotCode = require(path.join(root, "assets/js/a33-lot-code.js"));
const NEW_CODE = "A33KIS5786-0xx1";
const HIST_CODE = "A330xX119TEV5786";

assert.strictEqual(lotCode.display(NEW_CODE), NEW_CODE);
assert.strictEqual(lotCode.display("A33KIS5786-0XX1"), NEW_CODE);
assert.strictEqual(lotCode.display(HIST_CODE), HIST_CODE, "Los históricos se conservan literalmente");
assert.strictEqual(lotCode.identityKey("A33KIS5786-0XX1"), lotCode.identityKey(NEW_CODE));
assert.ok(lotCode.searchTerms(NEW_CODE).includes("KIS"));
assert.ok(lotCode.searchTerms(NEW_CODE).includes("5786"));
assert.ok(lotCode.searchTerms(NEW_CODE).includes("0001"));
assert.deepStrictEqual(lotCode.excelTextCell(NEW_CODE), { t:"s", v:NEW_CODE, z:"@" });
assert.strictEqual(JSON.parse(JSON.stringify({ codigoLote:NEW_CODE })).codigoLote, NEW_CODE);

const config = fs.readFileSync(path.join(root, "configuracion/script.js"), "utf8");
const configHtml = fs.readFileSync(path.join(root, "configuracion/index.html"), "utf8");
assert.ok(config.includes("lotCodeContract"), "JSON debe declarar preservación literal del lote");
assert.ok(config.includes("backupLotIdentityKey"), "Importación parcial debe deduplicar X/x sin reescribir");
assert.ok(config.includes("lotCodeLiteral:true"), "Validación JSON debe aceptar formatos históricos y nuevos");
assert.ok(configHtml.includes("a33-lot-code.js"));
assert.ok(configHtml.includes("Configuración, Catálogos y Lotes"));

const lotes = fs.readFileSync(path.join(root, "lotes/script.js"), "utf8");
assert.ok(lotes.includes("batchCodeSearchTerms"));
assert.ok(lotes.includes("batchCodeExcelText"));
assert.ok(lotes.includes("...batchCodeSearchTerms(visibleCode)"));
assert.ok(lotes.includes("...batchCodeSearchTerms(r.codigo || r.batchCode || '')"));
assert.ok(lotes.includes("index === 1 ? 24"), "Excel de Lotes debe reservar ancho suficiente");

const pos = fs.readFileSync(path.join(root, "pos/app.js"), "utf8");
assert.ok(pos.includes("lotCodeExcelCellPOS"));
assert.ok(pos.includes("'codigo_lote'"));
assert.ok(pos.includes("'Código de lote origen'"));
assert.ok(pos.includes("lotCodeExcelCellPOS(getSaleLotCodePOS(s))"));

const analytics = fs.readFileSync(path.join(root, "analitica/script.js"), "utf8");
const analyticsHtml = fs.readFileSync(path.join(root, "analitica/index.html"), "utf8");
assert.ok(analytics.includes("saleLotCodesAnalytics"));
assert.ok(analytics.includes("analyticsLotExcelCell"));
assert.ok(analyticsHtml.includes("<th>Código de lote</th>"));
assert.ok(analyticsHtml.includes("a33-lot-code.js"));

const center = fs.readFileSync(path.join(root, "centro-mando/app.js"), "utf8");
const centerHtml = fs.readFileSync(path.join(root, "centro-mando/index.html"), "utf8");
assert.ok(center.includes("__cmdLatestLotForEvent"));
assert.ok(center.includes("mkSec('lote', 'Último lote'"));
assert.ok(centerHtml.includes("a33-lot-code.js"));


console.log("A33 lot code stage 5 local smoke: OK");
