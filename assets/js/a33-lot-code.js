/*
 * Suite A33 — Fuente oficial del Código de lote.
 * Etapa 1/6: generador central sin conexión transversal a módulos consumidores.
 *
 * Formato nuevo: A33{MES_HEBREO}{AÑO_HEBREO}-{CONSECUTIVO_COMPRIMIDO}
 * Ejemplo: A33KIS5786-0xx1
 */
(function a33LotCodeFactory(root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.A33LotCode = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createA33LotCodeApi() {
  "use strict";

  var BRAND = "A33";
  var FORMAT_VERSION = "A33_HEBREW_MONTH_YEAR_COMPRESSED_V1";
  var HISTORICAL_FORMAT_VERSION = "A33_HISTORICAL_SEQ_DAY_MONTH_YEAR";

  // Conserva las abreviaturas históricas derivadas de las primeras letras.
  // Únicas correcciones necesarias: AV admite 2 letras y Adar I/II no colisionan.
  var HEBREW_MONTHS = Object.freeze({
    TISHRI: "TIS",
    HESHVAN: "HES",
    KISLEV: "KIS",
    TEVET: "TEV",
    SHEVAT: "SHE",
    ADAR: "ADA",
    "ADAR I": "ADI",
    "ADAR II": "ADII",
    NISAN: "NIS",
    IYAR: "IYA",
    SIVAN: "SIV",
    TAMUZ: "TAM",
    AV: "AV",
    ELUL: "ELU"
  });

  var MONTH_ALIASES = Object.freeze({
    TISHRI: "TISHRI",
    TISHREI: "TISHRI",
    TIS: "TISHRI",

    HESHVAN: "HESHVAN",
    CHESHVAN: "HESHVAN",
    MARCHESHVAN: "HESHVAN",
    MARHESHVAN: "HESHVAN",
    HES: "HESHVAN",
    CHE: "HESHVAN",

    KISLEV: "KISLEV",
    KIS: "KISLEV",

    TEVET: "TEVET",
    TEV: "TEVET",

    SHEVAT: "SHEVAT",
    SHVAT: "SHEVAT",
    SHV: "SHEVAT",
    SHE: "SHEVAT",

    ADAR: "ADAR",
    ADA: "ADAR",

    "ADAR I": "ADAR I",
    "ADAR 1": "ADAR I",
    ADARI: "ADAR I",
    ADAR1: "ADAR I",
    ADI: "ADAR I",

    "ADAR II": "ADAR II",
    "ADAR 2": "ADAR II",
    ADARII: "ADAR II",
    ADAR2: "ADAR II",
    ADII: "ADAR II",

    NISAN: "NISAN",
    NISSAN: "NISAN",
    NIS: "NISAN",

    IYAR: "IYAR",
    IYYAR: "IYAR",
    IYA: "IYAR",

    SIVAN: "SIVAN",
    SIV: "SIVAN",

    TAMUZ: "TAMUZ",
    TAMMUZ: "TAMUZ",
    TAM: "TAMUZ",

    AV: "AV",

    ELUL: "ELUL",
    ELU: "ELUL"
  });

  var VALID_MONTH_CODES = Object.freeze(Object.keys(HEBREW_MONTHS).reduce(function (acc, key) {
    acc[HEBREW_MONTHS[key]] = true;
    return acc;
  }, {}));

  function normalizeText(value) {
    return String(value == null ? "" : value)
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’'._-]+/g, " ")
      .replace(/\s+/g, " ");
  }

  function normalizeHebrewMonth(value) {
    var raw = normalizeText(value);
    if (!raw) return null;
    var canonicalName = MONTH_ALIASES[raw] || MONTH_ALIASES[raw.replace(/\s+/g, "")];
    if (!canonicalName) return null;
    return Object.freeze({
      input: String(value),
      name: canonicalName,
      code: HEBREW_MONTHS[canonicalName]
    });
  }

  function normalizeHebrewYear(value) {
    var match = String(value == null ? "" : value).match(/\d{4}/);
    if (!match) return null;
    var year = Number(match[0]);
    if (!Number.isInteger(year) || year < 5000 || year > 6999) return null;
    return String(year);
  }

  function parseLocalDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
    }
    var match = String(value == null ? "" : value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var date = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function resolveHebrewFromProductionDate(productionDate) {
    var date = parseLocalDate(productionDate);
    if (!date) return Object.freeze({ ok: false, error: "INVALID_PRODUCTION_DATE" });
    try {
      var formatter = new Intl.DateTimeFormat("en-u-ca-hebrew-nu-latn", {
        month: "long",
        year: "numeric"
      });
      var parts = formatter.formatToParts(date);
      var rawMonth = ((parts.find(function (part) { return part.type === "month"; }) || {}).value || "").trim();
      var rawYear = ((parts.find(function (part) { return part.type === "year"; }) || {}).value || "").trim();
      var month = normalizeHebrewMonth(rawMonth);
      var year = normalizeHebrewYear(rawYear);
      if (!month || !year) return Object.freeze({ ok: false, error: "HEBREW_DATE_UNAVAILABLE" });
      return Object.freeze({
        ok: true,
        productionDate: String(productionDate),
        hebrewMonth: month.name,
        monthCode: month.code,
        hebrewYear: year
      });
    } catch (error) {
      return Object.freeze({ ok: false, error: "HEBREW_DATE_UNAVAILABLE" });
    }
  }

  function formatConsecutive(value) {
    var raw = typeof value === "string" ? value.trim() : value;
    if (typeof raw === "string" && !/^\d+$/.test(raw)) return null;
    var number = Number(raw);
    if (!Number.isInteger(number) || number < 1 || number > 9999) return null;
    return String(number).padStart(4, "0");
  }

  function compressConsecutive(value) {
    var formatted = formatConsecutive(value);
    if (!formatted) return null;
    var output = formatted.charAt(0);
    for (var index = 1; index < formatted.length; index += 1) {
      output += formatted.charAt(index) === formatted.charAt(index - 1) ? "x" : formatted.charAt(index);
    }
    return output;
  }

  function expandCompressedConsecutive(value) {
    var mask = String(value == null ? "" : value).trim();
    if (!/^[0-9][0-9xX]{3}$/.test(mask)) return null;
    var output = mask.charAt(0);
    for (var index = 1; index < mask.length; index += 1) {
      var character = mask.charAt(index);
      output += character.toLowerCase() === "x" ? output.charAt(index - 1) : character;
    }
    return /^\d{4}$/.test(output) ? output : null;
  }

  function resolveHebrewInput(input) {
    var suppliedMonth = input.hebrewMonth != null ? input.hebrewMonth
      : (input.mesHebreo != null ? input.mesHebreo
        : (input.monthCode != null ? input.monthCode : input.mesHebreoNormalizado));
    var suppliedYear = input.hebrewYear != null ? input.hebrewYear
      : (input.anioHebreo != null ? input.anioHebreo : input.hy4);

    var month = normalizeHebrewMonth(suppliedMonth);
    var year = normalizeHebrewYear(suppliedYear);
    if (month && year) {
      return Object.freeze({
        ok: true,
        productionDate: input.productionDate || input.fechaProduccion || null,
        hebrewMonth: month.name,
        monthCode: month.code,
        hebrewYear: year,
        source: "provided"
      });
    }

    var productionDate = input.productionDate != null ? input.productionDate : input.fechaProduccion;
    var derived = resolveHebrewFromProductionDate(productionDate);
    if (!derived.ok) return derived;
    return Object.freeze({
      ok: true,
      productionDate: derived.productionDate,
      hebrewMonth: derived.hebrewMonth,
      monthCode: derived.monthCode,
      hebrewYear: derived.hebrewYear,
      source: "production-date"
    });
  }

  function generate(input) {
    var data = input && typeof input === "object" ? input : {};
    var consecutiveValue = data.consecutiveNumber != null ? data.consecutiveNumber
      : (data.consecutivoNumerico != null ? data.consecutivoNumerico : data.consecutive);
    var consecutiveFormatted = formatConsecutive(consecutiveValue);
    if (!consecutiveFormatted) {
      return Object.freeze({ ok: false, error: "INVALID_CONSECUTIVE" });
    }

    var hebrew = resolveHebrewInput(data);
    if (!hebrew.ok) return hebrew;

    var compressed = compressConsecutive(consecutiveFormatted);
    var code = BRAND + hebrew.monthCode + hebrew.hebrewYear + "-" + compressed;
    var numeric = Number(consecutiveFormatted);

    return Object.freeze({
      ok: true,
      code: code,
      codigoLote: code,
      brand: BRAND,
      productionDate: hebrew.productionDate || null,
      hebrewSource: hebrew.source,
      hebrewMonth: hebrew.hebrewMonth,
      mesHebreo: hebrew.hebrewMonth,
      monthCode: hebrew.monthCode,
      mesHebreoNormalizado: hebrew.monthCode,
      hebrewYear: hebrew.hebrewYear,
      anioHebreo: hebrew.hebrewYear,
      compressedConsecutive: compressed,
      consecutivoComprimido: compressed,
      consecutiveNumber: numeric,
      consecutivoNumerico: numeric,
      consecutiveFormatted: consecutiveFormatted,
      consecutivoFormateado: consecutiveFormatted,
      formatVersion: FORMAT_VERSION,
      versionFormato: FORMAT_VERSION
    });
  }

  function parseNewFormat(rawCode) {
    var code = String(rawCode == null ? "" : rawCode).trim().replace(/\s+/g, "").toUpperCase();
    var match = code.match(/^A33([A-Z0-9]{2,5})(\d{4})-([0-9X]{4})$/);
    if (!match || !VALID_MONTH_CODES[match[1]]) return null;
    var expanded = expandCompressedConsecutive(match[3]);
    if (!expanded) return null;
    var numeric = Number(expanded);
    if (!Number.isInteger(numeric) || numeric < 1) return null;
    var canonicalMask = compressConsecutive(expanded);
    return Object.freeze({
      ok: true,
      format: "new",
      formatVersion: FORMAT_VERSION,
      code: BRAND + match[1] + match[2] + "-" + canonicalMask,
      monthCode: match[1],
      hebrewYear: match[2],
      compressedConsecutive: canonicalMask,
      consecutiveFormatted: expanded,
      consecutiveNumber: numeric
    });
  }

  function parseHistoricalFormat(rawCode) {
    var code = String(rawCode == null ? "" : rawCode).trim().replace(/\s+/g, "").toUpperCase();
    // Histórico: A33 + consecutivo eco + día + mes + año. Mes flexible para no asumir longitud fija.
    var match = code.match(/^A33([0-9X]{4})(\d{2})([A-Z]{2,5})(\d{4})$/);
    if (!match) return null;
    var expanded = expandCompressedConsecutive(match[1]);
    var day = Number(match[2]);
    if (!expanded || day < 1 || day > 31) return null;
    var numeric = Number(expanded);
    if (!Number.isInteger(numeric) || numeric < 1) return null;
    return Object.freeze({
      ok: true,
      format: "historical",
      formatVersion: HISTORICAL_FORMAT_VERSION,
      code: code,
      day: match[2],
      monthCode: match[3],
      hebrewYear: match[4],
      compressedConsecutive: match[1].toLowerCase(),
      consecutiveFormatted: expanded,
      consecutiveNumber: numeric
    });
  }

  function recognize(rawCode) {
    return parseNewFormat(rawCode) || parseHistoricalFormat(rawCode) || Object.freeze({
      ok: false,
      format: "unknown",
      error: "UNRECOGNIZED_LOT_CODE"
    });
  }

  function validate(rawCode) {
    return recognize(rawCode);
  }

  // Valor visible: canoniza únicamente el formato nuevo y conserva literalmente
  // códigos históricos/desconocidos para no alterar respaldos ni trazabilidad.
  function display(rawCode) {
    var literal = String(rawCode == null ? "" : rawCode).trim();
    if (!literal) return "";
    var parsed = parseNewFormat(literal);
    return parsed && parsed.ok ? parsed.code : literal;
  }

  // Identidad técnica tolerante a X/x y espacios. Nunca se usa para reescribir
  // el código almacenado; solo evita duplicados en importación/sincronización.
  function identityKey(rawCode) {
    var literal = String(rawCode == null ? "" : rawCode).trim();
    if (!literal) return "";
    var parsed = recognize(literal);
    var canonical = parsed && parsed.ok ? parsed.code : literal;
    return canonical.replace(/\s+/g, "").toLowerCase();
  }

  function searchTerms(rawCode) {
    var literal = String(rawCode == null ? "" : rawCode).trim();
    if (!literal) return Object.freeze([]);
    var parsed = recognize(literal);
    var terms = [literal, display(literal), identityKey(literal)];
    if (parsed && parsed.ok) {
      terms.push(parsed.monthCode, parsed.hebrewYear, parsed.compressedConsecutive,
        parsed.consecutiveFormatted, String(parsed.consecutiveNumber || ""));
      if (parsed.day) terms.push(parsed.day);
    }
    var seen = Object.create(null);
    return Object.freeze(terms.map(function (value) { return String(value == null ? "" : value).trim(); })
      .filter(function (value) {
        var key = value.toLowerCase();
        if (!value || seen[key]) return false;
        seen[key] = true;
        return true;
      }));
  }

  function excelTextCell(rawCode) {
    return Object.freeze({ t: "s", v: String(rawCode == null ? "" : rawCode), z: "@" });
  }

  return Object.freeze({
    BRAND: BRAND,
    FORMAT_VERSION: FORMAT_VERSION,
    HISTORICAL_FORMAT_VERSION: HISTORICAL_FORMAT_VERSION,
    HEBREW_MONTHS: HEBREW_MONTHS,
    normalizeHebrewMonth: normalizeHebrewMonth,
    normalizeHebrewYear: normalizeHebrewYear,
    resolveHebrewFromProductionDate: resolveHebrewFromProductionDate,
    formatConsecutive: formatConsecutive,
    compressConsecutive: compressConsecutive,
    expandCompressedConsecutive: expandCompressedConsecutive,
    generate: generate,
    parseNewFormat: parseNewFormat,
    parseHistoricalFormat: parseHistoricalFormat,
    recognize: recognize,
    validate: validate,
    display: display,
    identityKey: identityKey,
    searchTerms: searchTerms,
    excelTextCell: excelTextCell
  });
});
