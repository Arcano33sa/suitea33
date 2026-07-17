"use strict";

const assert = require("assert");
const lotCode = require("../assets/js/a33-lot-code.js");

const compressionCases = new Map([
  ["0001", "0xx1"],
  ["0002", "0xx2"],
  ["0010", "0x10"],
  ["0011", "0x1x"],
  ["0111", "01xx"],
  ["1000", "10xx"],
  ["1111", "1xxx"],
  ["1010", "1010"]
]);

for (const [numeric, expected] of compressionCases) {
  assert.strictEqual(lotCode.compressConsecutive(numeric), expected, `${numeric} debe comprimir a ${expected}`);
  assert.strictEqual(lotCode.expandCompressedConsecutive(expected), numeric, `${expected} debe expandir a ${numeric}`);
}

const kislev = lotCode.generate({ hebrewMonth: "Kislev", hebrewYear: 5786, consecutiveNumber: 1 });
assert.strictEqual(kislev.ok, true);
assert.strictEqual(kislev.code, "A33KIS5786-0xx1");
assert.strictEqual(kislev.consecutiveNumber, 1);
assert.strictEqual(kislev.consecutiveFormatted, "0001");

const av = lotCode.generate({ hebrewMonth: "Av", hebrewYear: 5786, consecutiveNumber: 1 });
assert.strictEqual(av.ok, true);
assert.strictEqual(av.code, "A33AV5786-0xx1");
assert.ok(!av.code.includes("OFF"));
assert.ok(!av.code.includes("2026"));

const noRepeats = lotCode.generate({ hebrewMonth: "Kislev", hebrewYear: 5786, consecutiveNumber: 1010 });
assert.strictEqual(noRepeats.code, "A33KIS5786-1010");

const adarI = lotCode.generate({ hebrewMonth: "Adar I", hebrewYear: 5784, consecutiveNumber: 1 });
const adarII = lotCode.generate({ hebrewMonth: "Adar II", hebrewYear: 5784, consecutiveNumber: 1 });
assert.strictEqual(adarI.code, "A33ADI5784-0xx1");
assert.strictEqual(adarII.code, "A33ADII5784-0xx1");
assert.notStrictEqual(adarI.code, adarII.code);

const derivedKislev = lotCode.generate({ productionDate: "2025-12-10", consecutiveNumber: 1 });
assert.strictEqual(derivedKislev.code, "A33KIS5786-0xx1");

const derivedAv = lotCode.generate({ productionDate: "2026-07-20", consecutiveNumber: 1 });
assert.strictEqual(derivedAv.code, "A33AV5786-0xx1");
assert.ok(!derivedAv.code.includes("OFF"));
assert.ok(!derivedAv.code.includes("2026"));

const historical = lotCode.validate("A330XX119TEV5786");
assert.strictEqual(historical.ok, true);
assert.strictEqual(historical.format, "historical");
assert.strictEqual(historical.code, "A330XX119TEV5786");

const historicalAv = lotCode.validate("A330XX106AV5786");
assert.strictEqual(historicalAv.ok, true);
assert.strictEqual(historicalAv.monthCode, "AV");

const modern = lotCode.validate("A33KIS5786-0xx1");
assert.strictEqual(modern.ok, true);
assert.strictEqual(modern.format, "new");
assert.strictEqual(modern.code, "A33KIS5786-0xx1");

assert.strictEqual(lotCode.generate({ productionDate: "invalid", consecutiveNumber: 1 }).ok, false);
assert.strictEqual(lotCode.generate({ hebrewMonth: "OFF", hebrewYear: 2026, consecutiveNumber: 1 }).ok, false);

console.log("A33 lot code smoke: OK");
