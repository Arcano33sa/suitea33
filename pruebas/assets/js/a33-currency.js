/*
  Suite A33 — A33Currency (core)
  Motor central seguro para Moneda:
  - Lectura defensiva de Configuración → Moneda
  - Formato monetario C$ / US$ y T/C
  - Conversión segura sin cálculos silenciosos cuando no hay T/C
*/
(function(global){
  'use strict';

  const STORAGE_KEY = 'suite_a33_currency_settings_v1';
  const ENGINE_VERSION = 2;

  const PRIMARY_CURRENCY = Object.freeze({
    name: 'Córdoba nicaragüense',
    symbol: 'C$',
    code: 'NIO'
  });

  const SECONDARY_CURRENCY = Object.freeze({
    name: 'Dólar estadounidense',
    symbol: 'US$',
    code: 'USD'
  });

  const SAFE_REASONS = Object.freeze({
    OK: 'ok',
    MISSING_RATE: 'exchange_rate_missing',
    INVALID_RATE: 'exchange_rate_invalid',
    INVALID_AMOUNT: 'amount_invalid',
    STORAGE_ERROR: 'storage_error'
  });

  function cloneCurrency(currency){
    const src = (currency && typeof currency === 'object') ? currency : {};
    return {
      name: String(src.name || '').trim(),
      symbol: String(src.symbol || '').trim(),
      code: String(src.code || '').trim().toUpperCase()
    };
  }

  function buildDefaultSettings(){
    return {
      version: 1,
      mode: 'manual',
      primary: cloneCurrency(PRIMARY_CURRENCY),
      secondary: cloneCurrency(SECONDARY_CURRENCY),
      exchangeRate: '',
      updatedAt: ''
    };
  }

  function normalizeExchangeRateValue(value){
    const raw = String(value ?? '').trim().replace(',', '.');
    if (!raw) return '';
    if (!/^\d+(?:\.\d{0,2})?$/.test(raw)) return '';
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return '';
    return num.toFixed(2);
  }

  function normalizeSettings(settings){
    const base = buildDefaultSettings();
    const src = (settings && typeof settings === 'object') ? settings : {};
    return {
      ...base,
      primary: cloneCurrency(PRIMARY_CURRENCY),
      secondary: cloneCurrency(SECONDARY_CURRENCY),
      exchangeRate: normalizeExchangeRateValue(src.exchangeRate),
      updatedAt: String(src.updatedAt || '').trim()
    };
  }

  function readRawStorage(){
    let raw = '';
    try{
      if (global.A33Storage && typeof global.A33Storage.getItem === 'function'){
        const v = global.A33Storage.getItem(STORAGE_KEY, 'local');
        if (v !== undefined && v !== null) raw = String(v);
      }
    }catch(_){ }
    if (!raw){
      try{
        const store = global.localStorage;
        if (store && typeof store.getItem === 'function') raw = store.getItem(STORAGE_KEY) || '';
      }catch(_){ raw = ''; }
    }
    return raw;
  }

  function parseStoredSettings(raw){
    if (!raw) return buildDefaultSettings();
    try{
      const parsed = JSON.parse(raw);
      return normalizeSettings(parsed);
    }catch(_){
      return normalizeSettings({ exchangeRate: raw });
    }
  }

  function readSettings(){
    return parseStoredSettings(readRawStorage());
  }

  function writeSettings(settings){
    const data = normalizeSettings(settings);
    const payload = JSON.stringify(data);
    try{
      if (global.A33Storage && typeof global.A33Storage.setItem === 'function'){
        const ok = global.A33Storage.setItem(STORAGE_KEY, payload, 'local');
        if (ok !== false) return { ok: true, data };
      } else if (global.localStorage && typeof global.localStorage.setItem === 'function'){
        global.localStorage.setItem(STORAGE_KEY, payload);
        return { ok: true, data };
      }
    }catch(_){ }
    try{
      if (global.localStorage && typeof global.localStorage.setItem === 'function'){
        global.localStorage.setItem(STORAGE_KEY, payload);
        return { ok: true, data };
      }
    }catch(_){ }
    return { ok: false, data, reason: SAFE_REASONS.STORAGE_ERROR };
  }

  function hasExchangeRate(settings){
    const data = normalizeSettings(settings || readSettings());
    return !!data.exchangeRate;
  }

  function getExchangeRate(settings){
    const data = normalizeSettings(settings || readSettings());
    if (!data.exchangeRate) return null;
    const n = Number(data.exchangeRate);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function parseAmount(value){
    if (typeof value === 'number'){
      return Number.isFinite(value) ? value : null;
    }
    let raw = String(value ?? '').trim();
    if (!raw) return null;
    raw = raw.replace(/[^0-9,.-]/g, '');
    const hasComma = raw.includes(',');
    const hasDot = raw.includes('.');
    if (hasComma && hasDot){
      raw = raw.replace(/,/g, '');
    } else if (hasComma && !hasDot){
      raw = raw.replace(',', '.');
    }
    const firstMinus = raw.indexOf('-');
    raw = raw.replace(/-/g, '');
    if (firstMinus === 0) raw = '-' + raw;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function formatNumber2(value){
    const n = parseAmount(value);
    const safe = (n === null) ? 0 : n;
    const sign = safe < 0 ? '-' : '';
    const fixed = Math.abs(safe).toFixed(2);
    const parts = fixed.split('.');
    const integer = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${sign}${integer}.${parts[1] || '00'}`;
  }

  function currencyFromKind(kind){
    const k = String(kind || '').trim().toUpperCase();
    if (k === 'USD' || k === 'US$' || k === 'SECONDARY' || k === 'DOLLARS' || k === 'DOLARES') return SECONDARY_CURRENCY;
    return PRIMARY_CURRENCY;
  }

  function formatMoney(value, kind){
    const currency = currencyFromKind(kind);
    return `${currency.symbol}${formatNumber2(value)}`;
  }

  function formatCordobas(value){
    return formatMoney(value, 'NIO');
  }

  function formatDollars(value){
    return formatMoney(value, 'USD');
  }

  function formatExchangeRate(value){
    const rate = normalizeExchangeRateValue(value);
    return rate ? `T/C ${rate}` : 'T/C no configurado';
  }

  function conversionResult(ok, value, reason, settings, from, to){
    const data = normalizeSettings(settings || readSettings());
    return {
      ok: !!ok,
      value: ok ? Number(value.toFixed(2)) : null,
      formatted: ok ? (to === 'USD' ? formatDollars(value) : formatCordobas(value)) : '',
      reason: ok ? SAFE_REASONS.OK : reason,
      from,
      to,
      hasExchangeRate: hasExchangeRate(data),
      exchangeRate: getExchangeRate(data),
      exchangeRateText: formatExchangeRate(data.exchangeRate)
    };
  }

  function convertCordobasToDollars(amount, settings){
    const data = normalizeSettings(settings || readSettings());
    const n = parseAmount(amount);
    if (n === null) return conversionResult(false, 0, SAFE_REASONS.INVALID_AMOUNT, data, 'NIO', 'USD');
    const rate = getExchangeRate(data);
    if (!rate) return conversionResult(false, 0, SAFE_REASONS.MISSING_RATE, data, 'NIO', 'USD');
    return conversionResult(true, n / rate, SAFE_REASONS.OK, data, 'NIO', 'USD');
  }

  function convertDollarsToCordobas(amount, settings){
    const data = normalizeSettings(settings || readSettings());
    const n = parseAmount(amount);
    if (n === null) return conversionResult(false, 0, SAFE_REASONS.INVALID_AMOUNT, data, 'USD', 'NIO');
    const rate = getExchangeRate(data);
    if (!rate) return conversionResult(false, 0, SAFE_REASONS.MISSING_RATE, data, 'USD', 'NIO');
    return conversionResult(true, n * rate, SAFE_REASONS.OK, data, 'USD', 'NIO');
  }

  function sanitizeExchangeRateInput(value){
    let raw = String(value ?? '').replace(/,/g, '.').replace(/\s+/g, '');
    const negative = raw.startsWith('-');
    raw = raw.replace(/[^\d.]/g, '');
    const firstDot = raw.indexOf('.');
    let integerPart = '';
    let decimalPart = '';
    let hasDot = false;
    if (firstDot >= 0){
      hasDot = true;
      integerPart = raw.slice(0, firstDot).replace(/\./g, '');
      decimalPart = raw.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
    } else {
      integerPart = raw.replace(/\./g, '');
    }
    if (hasDot && !integerPart) integerPart = '0';
    let out = (negative ? '-' : '') + integerPart;
    if (hasDot) out += '.' + decimalPart;
    return out;
  }

  function validateExchangeRate(value){
    const raw = String(value ?? '').trim().replace(',', '.');
    if (!raw) return { ok: false, value: '', message: 'Ingresá un T/C válido antes de guardar.', reason: SAFE_REASONS.MISSING_RATE };
    if (raw.includes('-')) return { ok: false, value: '', message: 'El T/C no puede ser negativo.', reason: SAFE_REASONS.INVALID_RATE };
    if (!/^\d+(?:\.\d{0,2})?$/.test(raw)) return { ok: false, value: '', message: 'El T/C debe ser numérico y tener máximo 2 decimales.', reason: SAFE_REASONS.INVALID_RATE };
    const normalized = normalizeExchangeRateValue(raw);
    if (!normalized) return { ok: false, value: '', message: 'El T/C debe ser mayor que 0.', reason: SAFE_REASONS.INVALID_RATE };
    return { ok: true, value: normalized, message: '', reason: SAFE_REASONS.OK };
  }

  function getState(settings){
    const data = normalizeSettings(settings || readSettings());
    const rate = getExchangeRate(data);
    return {
      ok: true,
      settings: data,
      primary: cloneCurrency(PRIMARY_CURRENCY),
      secondary: cloneCurrency(SECONDARY_CURRENCY),
      exchangeRate: rate,
      exchangeRateText: formatExchangeRate(data.exchangeRate),
      hasExchangeRate: !!rate,
      storageKey: STORAGE_KEY,
      engineVersion: ENGINE_VERSION
    };
  }

  const api = Object.freeze({
    version: ENGINE_VERSION,
    storageKey: STORAGE_KEY,
    reasons: SAFE_REASONS,
    defaults: buildDefaultSettings,
    normalizeSettings,
    normalizeExchangeRateValue,
    readSettings,
    saveSettings: writeSettings,
    writeSettings,
    getState,
    getPrimaryCurrency: () => cloneCurrency(PRIMARY_CURRENCY),
    getSecondaryCurrency: () => cloneCurrency(SECONDARY_CURRENCY),
    hasExchangeRate,
    getExchangeRate,
    parseAmount,
    formatMoney,
    formatCordobas,
    formatDollars,
    formatExchangeRate,
    formatRate: formatExchangeRate,
    convertCordobasToDollars,
    convertDollarsToCordobas,
    sanitizeExchangeRateInput,
    validateExchangeRate
  });

  global.A33Currency = api;
  global.A33CurrencyConfig = Object.assign({}, global.A33CurrencyConfig || {}, {
    storageKey: STORAGE_KEY,
    read: () => api.readSettings(),
    state: () => api.getState(),
    engine: api
  });
})(typeof window !== 'undefined' ? window : globalThis);
