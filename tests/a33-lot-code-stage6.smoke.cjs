"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const lotCode = require(path.join(root, "assets/js/a33-lot-code.js"));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const compressionCases = {
  "0001":"0xx1", "0002":"0xx2", "0010":"0x10", "0011":"0x1x",
  "0111":"01xx", "1000":"10xx", "1111":"1xxx", "1010":"1010"
};
for (const [numeric, compressed] of Object.entries(compressionCases)) {
  assert.strictEqual(lotCode.compressConsecutive(numeric), compressed);
  assert.strictEqual(lotCode.expandCompressedConsecutive(compressed), numeric);
  const generated = lotCode.generate({ hebrewMonth:"Kislev", hebrewYear:5786, consecutiveNumber:Number(numeric) });
  assert.strictEqual(generated.consecutiveFormatted, numeric);
  assert.strictEqual(generated.consecutiveNumber, Number(numeric));
}

const dateCases = [
  ["2026-07-17", "A33AV5786-0xx1"],
  ["2025-12-10", "A33KIS5786-0xx1"],
  ["2024-03-01", "A33ADI5784-0xx1"],
  ["2024-03-20", "A33ADII5784-0xx1"]
];
for (const [date, expected] of dateCases) {
  const generated = lotCode.generate({ productionDate:date, consecutiveNumber:1 });
  assert.strictEqual(generated.ok, true);
  assert.strictEqual(generated.code, expected);
  assert.ok(!generated.code.includes("OFF"));
  assert.ok(!generated.code.includes(date.slice(0,4)));
}

const beforeYear = lotCode.generate({ productionDate:"2025-09-22", consecutiveNumber:42 });
const afterYear = lotCode.generate({ productionDate:"2025-09-23", consecutiveNumber:42 });
assert.strictEqual(beforeYear.hebrewYear, "5785");
assert.strictEqual(afterYear.hebrewYear, "5786");
assert.strictEqual(beforeYear.consecutiveNumber, 42);
assert.strictEqual(afterYear.consecutiveNumber, 42, "El cambio de año hebreo no reinicia el consecutivo");

const historicalLiteral = "A330xX119TEV5786";
assert.strictEqual(lotCode.display(historicalLiteral), historicalLiteral);
assert.strictEqual(lotCode.validate(historicalLiteral).format, "historical");
assert.strictEqual(lotCode.validate("A33KIS5786-0XX1").code, "A33KIS5786-0xx1");
assert.strictEqual(lotCode.identityKey("A33KIS5786-0XX1"), lotCode.identityKey("A33KIS5786-0xx1"));

const production = read("calculadora/index.html");
const temporal = read("calculadora_temporal/index.html");
for (const source of [production, temporal]) {
  assert.ok(source.includes("a33-lot-code.js?v=4.20.95&r=6"));
  assert.ok(!source.includes("function ecoMaskX"));
  assert.ok(!source.includes("function ecoUnmaskX"));
  assert.ok(!source.includes("slice(3, 7)"));
  assert.ok(source.includes(".inline-input-btn input#lote"));
  assert.ok(source.includes("font-variant-numeric: tabular-nums"));
}
assert.ok(temporal.includes('navigator.serviceWorker.register("./sw.js?v=4.20.95&r=1")'));
assert.ok(fs.existsSync(path.join(root, "calculadora_temporal/sw.js")));

const lotesCss = read("lotes/style.css");
const lotCodeCss = lotesCss.slice(lotesCss.indexOf(".lote-codecell"), lotesCss.indexOf(".lote-status-line"));
assert.ok(lotCodeCss.includes("overflow-wrap: anywhere"));
assert.ok(lotCodeCss.includes("word-break: break-word"));
assert.ok(!lotCodeCss.includes("text-overflow: ellipsis"));
assert.ok(read("analitica/style.css").includes(".analytics-lot-code"));
assert.ok(read("centro-mando/style.css").includes('.cmd-gsec[data-sec="lote"] .cmd-gsec-v'));

const pos = read("pos/app.js");
assert.ok(pos.includes("getSaleLotCodePOS(s) ? `<div class=\"muted\"><small>Lote:"), "La vista imprimible/PDF conserva el lote");
assert.ok(pos.includes("lotCodeExcelCellPOS(getSaleLotCodePOS(s))"), "Excel conserva el lote como texto");
assert.ok(read("configuracion/script.js").includes("lotCodeContract"), "JSON conserva contrato literal");
assert.ok(read("assets/js/a33-cloud-sync.js").includes("syncLots"), "Firebase conserva sincronización de lotes");

const release = read("assets/js/a33-release.js");
const build = read("assets/js/a33-build.js");
assert.ok(release.includes("const suiteVersion = '4.20.95'"));
assert.ok(build.includes("const VERSION = '4.20.95'"));
assert.ok(build.includes("calculadora:'7', catalogos:'33', inventario:'18', lotes:'21', pedidos:'19', pos:'34'"));

const swExpectations = {
  "calculadora/sw.js":"7",
  "calculadora_temporal/sw.js":"1",
  "catalogos/sw.js":"33",
  "inventario/sw.js":"18",
  "lotes/sw.js":"21",
  "pedidos/sw.js":"19",
  "pos/sw.js":"34"
};
for (const [rel, moduleRev] of Object.entries(swExpectations)) {
  const source = read(rel);
  assert.ok(source.includes("4.20.95"), `${rel} usa versión final`);
  const actualRev = Number((source.match(/MODULE_CACHE_REV\s*=\s*'([0-9]+)'/) || [])[1]);
  assert.ok(Number.isFinite(actualRev) && actualRev >= Number(moduleRev), `${rel} no debe retroceder su revisión de caché`);
  assert.ok(!source.includes("localStorage"));
  assert.ok(!source.includes("indexedDB"));
}
assert.ok(read("calculadora/sw.js").includes("a33-lot-code.js?v=4.20.95&r=6"));
assert.ok(read("calculadora_temporal/sw.js").includes("a33-lot-code.js?v=4.20.95&r=6"));
assert.ok(read("lotes/sw.js").includes("a33-lot-code.js?v=4.20.95&r=6"));
assert.ok(read("pos/sw.js").includes("a33-lot-code.js?v=4.20.95&r=6"));

console.log("A33 lot code stage 6 hardening smoke: OK");
